# @jiangshilong/dsh-llm-model-route

**DeepSeek Harness 的智能模型路由：每轮一次判定，决定用 haiku、sonnet 还是 opus。**

[English](README.md) | 中文

## 概述

给 Harness 加一个 provider 路由（默认 `model-route`），模型选择器里只多一个 **`auto`**：选了它，每轮由一个小判定模型判断任务难度，再从你配好的三个档位里挑一个上游模型去跑。三个档位（`opus` / `sonnet` / `haiku`）各指向哪个 provider、哪个模型，完全由你决定；上游地址与模型目录沿用 Harness 原本的模型管理，不需要在这里重复配置。

显式档位别名仍然可用，只是不进选择器：

| 你选的模型 | 行为 |
| --- | --- |
| `auto` | 判定模型逐回合判档，路由到该档配置的模型 |
| `opus` / `sonnet` / `haiku` | 直接用该档的模型，不调用判定模型 |

## 三个判定节点

判定只发生在这三个节点，其余时刻一律复用已有决策：

| 节点 | 何时判定 | 为什么 |
| --- | --- | --- |
| **新用户回合** | 每条新的用户消息 | 任务可能变了，需要重新判断档位 |
| **历史压缩重建** | 上次决策时的消息尾部不再出现在原位置（压缩、摘要、重投影） | 冻结决策所依据的上下文已经不存在，无法继承 |
| **委派子智能体** | 调用 `route_tier` 时 | 子任务的上下文是全新的，与当前对话规模无关 |

回合内的工具续跑**不判定**：整个回合保持同一模型，上游前缀 KV 缓存持续命中。

### 为什么删掉了工具失败 / 工具数 / 上下文增长

这三个信号曾经作为「回合内阶段边界」实现过，现在已全部移除。原因来自实测：在 194 条真实路由记录里，它们共触发 14 次重判，**改变档位的次数是 0**，却消耗了 16.3 秒判定延迟。

根本问题是它们是**规模代理**，不是**任务变化**的证据：

- 「开了 8 个工具」说明任务**长**，不说明任务**变难**。判定模型在回合开始时看到的任务描述并没有变。
- 触发时机恰恰最不适合换档：8 个工具之后上下文已 10 万+ token，此时换模型要重建最大的那段前缀缓存。
- 工具失败确实是语义信号，但它属于**回合内证据**，而 `turnFreeze` 保证同回合同模型。是否因「上一次没做成」而升档，交给判定模型在下一轮判断——它能看到用户的原始表述。

如果确实需要更细的粒度，把 `cache.turnFreeze` 设为 `false`：每次请求都会重新判定，代价是前缀缓存持续失效。

## 委派前判定（route_tier）

HiRoute 在执行 Worker 委派时选模型，而不是在 Worker 内部逐条消息判定。本插件对应提供 `route_tier` 工具：

```text
route_tier(task="重构整个调度层", context="只改 crates/scheduler，保持公开 API", max_tier="opus")
→ { tier: "opus", provider: "aiapi", model: "glm-5.3", alternatives: [...], usage_hint: "..." }
```

- 判定读的是**任务本身**（task + 可选 context/preset），不是当前对话规模。
- 返回可直接传给 `subagent` 工具的 `provider` / `model`（需该工具开启 `modelSelectionSettings`；否则子智能体沿用父模型，`usage_hint` 会说明）。
- `max_tier` 设定上限（例如只读扫描传 `haiku`）；相同任务在 TTL 内复用上次判定。
- 判定失败也返回兜底档位并标记 `fallback`，不会让委派失败。

要让子智能体真的跑在选中的模型上，还差一步 Host 偏好（一次性配置）：

```yaml
- id: subagent-model-selection-settings
  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"
  config:
    enabled: true
    allowedModels:            # 必须覆盖 tiers 里所有可能被返回的路由
      - { provider: aiapi, model: glm-5.3 }
      - { provider: aiapi, model: deepseek-v4.1-flash-1017 }
      - { provider: aiapi, model: glm-5.3-flash }
```

预置的 `preset-cordis` 已经在**预设作用域**内挂载了带 `modelSelectionSettings` 的 `subagent`，所以打开上面这个 Host 偏好即可生效；不要在 Host 层给 `tool-subagent` 直接加 `modelSelectionSettings: true`——它要求预设作用域，会在加载时抛错。路线清单之外的返回值会被 `subagent` 拒绝，改档位映射时记得同步这里。

## 功能

- **逐回合自动选档**：简单任务走便宜档，复杂任务走强档，不用手动切模型。
- **档位自由映射**：三档各自指向任意上游模型，每档还能配有序的故障转移候选。
- **贴合上游缓存**：同一回合内（工具续跑）冻结档位；完全相同的请求前缀复用上次决策，不重复判定。
- **判定结果即最终档位**：不设隐式升档或换档门槛，升、降都按判定执行。
- **优雅降级**：判定失败、超时或判定为"无合适档位"时回退到 `fallbackTier`，不会让请求失败。
- **辅助调用直连**：会话压缩、会话标题这类调用直接指定档位，不经过判定模型。
- **两种判定家族**：JEV（TypeSafe System One）与 StartLux（结构化判定），面板里切换。

## 快速开始

1. **安装**：把本包和配套的面板插件 `@jiangshilong/dsh-client-ui-model-route` 一起作为 bundle 装进 profile（插件管理器 `install_bundle` 指向各自目录），或写进 profile 的 `dsh.profile.bundles`，重启 Harness。只装本包也能用，但配置得手写 YAML。
2. **配置**：打开 Models 页，找到「ModelRoute 智能模型路由」卡片，按下一节填好判定模型与三个档位，保存。
3. **使用**：把默认模型指向网关，或在模型下拉里选 `auto`。

```yaml
# profile 的 cordis.patch.yml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: model-route
    model: auto
```

不写这段也行：网关装好后 `auto` 会出现在下拉里，选一次即成为之后新会话的默认值。已经发过请求的会话不受影响。

## 配置面板

Models 页的网关卡片里能改的都在这：

- **三个档位**：`opus` / `sonnet` / `haiku` 各选一个「提供商 + 模型」对，候选只列当前模型目录里已有的项。
- **判定模型**：选家族（JEV / StartLux），填 API 地址、模型 ID、API Key（存进凭据服务，不回显）。两个家族的端点各存一份，来回切换不会互相覆盖。
- **代理（可选）**：只作用于判定请求，收在卡片底部；不常用，已配置时只显示目标主机。
- **辅助调用**：会话压缩、会话标题各选一档。
- **测试**：保存旁的按钮用当前表单值（含未保存的修改和刚填的 key）真跑一次判定，回显档位、置信度与耗时——配完先点它。
- **保存**：直接写进 profile 配置并热生效，不用重启。

把某个档位指回网关自己会被拒绝：那会递归调用自己。

## 配置文件（高阶）

面板覆盖不到的项，直接写进 profile 的 `cordis.patch.yml`：

```yaml
- id: llm-model-route
  name: "@jiangshilong/dsh-llm-model-route"
  config:
    route: model-route
    tiers:
      opus:   { provider: aiapi, model: glm-5.3 }
      sonnet: { provider: aiapi, model: glm-5.3-flash, fallbacks: [{ provider: aiapi, model: deepseek-v4-flash }] }
      haiku:  { provider: aiapi, model: deepseek-v4-flash }
    enableRouter: jev
    router:
      jev:
        baseURL: https://api.typesafe.ai/v1
        model: jev-latest
        timeoutMs: 20000
        # proxy: http://127.0.0.1:7897
      # startlux:
      #   baseURL: https://api.bamboonode.dev/v1
      #   model: startlux-decision-27b-autothink
    fallbackTier: sonnet
    # 委派前判定工具
    delegate:
      enabled: true
      toolName: route_tier
      # defaultMaxTier: haiku
      memo: true
      cacheTtlMs: 3600000
      maxCandidates: 3
    auxiliary:
      compaction: haiku
      session-title: haiku
    cache:
      enabled: true
      turnFreeze: true
    log:
      enabled: false
```

`tiers.<档位>`：`provider` + `model` 必填，`reasoningEffort` 可选（覆盖上游推理档位），`fallbacks` 是首个 chunk 前失败时依次尝试的候选。

`router.<家族>`（只有 `enableRouter` 选中的那份生效）：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `baseURL` / `model` | 空 | 判定端点地址与模型 id；任一为空则判定不可用。`jev` 自动补 `/v1/systemone`，`startlux` 自动补 `/v1/decisions`，贴完整路径则原样使用 |
| `proxy` | 空 | 判定请求的 HTTP(S) 代理；支持 `http://user:pass@host:port`，不支持 SOCKS |
| `provider` | 空 | 备选：复用已注册的 provider 路由，以 chat 模型当判定（`baseURL` 优先） |
| `temperature` | `0` | 判定采样温度（仅 `provider` 方式） |
| `timeoutMs` | `20000` | 判定超时 |
| `maxRequestChars` | `24000` | 判定上下文预算（字符），超出从最旧历史截断 |
| `prompt` | 空 | 自定义判定提示词（仅 `provider` 方式） |
| `thinkMode` / `thinkBudget` / `gate` / `mix` / `noneThreshold` | `auto` / 省略 / `0.6` / `0.75` / `0.2` | 仅 `startlux`：思考时机与预算、触发思考的置信度阈值、思考后读数权重、"无合适档位"的阈值 |

`fallbackTier`（默认 `sonnet`）：判定不可用或失败时的兜底档位。判定端点没配（`baseURL` 与 `model` 为空）时，`auto` 直接走它——先让会话能用，之后再补判定配置。

`relayToPrimary`（默认 `true`）：低档候选全部失败后，是否继续尝试请求档位的候选；`false` 则失败即报错。

`auxiliary`（默认 `{ compaction: haiku, session-title: haiku }`）：辅助调用直接使用的档位。

`cache`：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 决策缓存总开关 |
| `turnFreeze` | `true` | 同回合冻结：轮内续跑沿用同一档位 |
| `memoTtlMs` / `memoMaxEntries` | 6 小时 / `512` | 前缀备忘的有效期与容量 |
| `replayRewrite` | `true` | 把网关产出的 assistant 历史改写到上游名下，尽量保留上游原生 replay |
| `delegate.enabled` | `true` | 注册 `route_tier` 委派判定工具 |
| `delegate.toolName` | `route_tier` | 工具名（改配置即时生效，无需重载插件） |
| `delegate.maxCandidates` | `3` | 返回的候选模型上限 |


### 置信度与三档概率

结构化判定（JEV / StartLux）本来就是在三个档位里三选一。`confidence` 是“被选中那一档”的置信度：JEV 用服务端校准置信度，StartLux 用该选项的概率份额。现在网关还会保留完整分布，并把 `probabilities`（haiku/sonnet/opus）、`topAlternative` 与 `margin`（Top-2 差距）写进决策日志和监控详情。

判定结果就是最终档位：网关不再用置信度、跨度或上一轮档位去否决它。降档与升档一样正常——判定说 haiku，就换 haiku。

`log`：`enabled`（默认 `false`）、`path`（留空 = `$DSH_HOME/logs/model-route.jsonl`）、`maxBytes`（默认 16 MB，超过轮转为 `.1`）、`previewChars`（默认 `400`，`0` 表示不记内容）。见「日志与排错」。

另有 `displayName`（卡片显示名）与 `logDecisions`（是否把决策写进 Harness 日志）。

## 路由行为

- 新的一轮用户提问 → 判定一次档位。
- 同一轮内的工具续跑 → 沿用该档位，不重复判定；system prompt 里的时钟/附件刷新不会改变回合指纹。
- 请求前缀与之前完全相同 → 复用上次决策。
- 上下文被压缩过（历史重建）→ 旧决策的依据已不存在，重新判定。
- 判定结果**就是最终档位**：升档、降档都按判定执行，没有额外门槛，也不与上一轮对齐。
- 判定端点失败 → 用 `fallbackTier`（默认 sonnet），请求照常完成；显式指定了档位时仍受该上限约束。
- 显式选 `opus` / `sonnet` / `haiku` → 完全绕过判定。

## 日志与排错

把 `log.enabled` 设为 `true`，网关会把每次决策与结果写成 JSONL（一轮一条 `route`，每次模型调用一条 `result`，用 `turn` 关联）：

```json
{"kind":"route","turn":"3f9a1c2e","alias":"auto","tier":"sonnet","source":"judge","upstream":{"provider":"aiapi","model":"glm-5.3-flash"},"confidence":0.61,"probabilities":{"haiku":0.12,"sonnet":0.72,"opus":0.16},"topAlternative":"opus","margin":0.56,"task":"…","reason":"…","judgeMs":2608,"preview":"继续"}
```

`source` 说明这一档是怎么来的：`judge` 判定命中、`memo` 前缀备忘、`frozen` 同回合冻结、`fallback` 判定失败或判为无合适档位、`fixed` 显式档位或未配判定、`auxiliary` 辅助调用。更早的日志里还可能出现 `hold` / `escalate`——那是已删除的确定性升档保底留下的历史记录，监控仍能正确显示。

```bash
# 判定是不是一直在失败
jq -r 'select(.kind=="route" and .source=="fallback") | .reason' ~/.dsh/logs/model-route.jsonl | tail -5
# 各上游模型的使用分布
jq -r 'select(.kind=="route" and .error==null) | .upstream.model' ~/.dsh/logs/model-route.jsonl | sort | uniq -c | sort -rn
```

常见问题：

- **判定从不生效、日志里一直是 `fallback`**：判定端点的地址/模型/key 有问题，先点面板的「测试」；`451` 之类是判定服务端的地区限制。
- **面板里档位下拉是空的**：上游 provider 的模型目录还没就绪，等目录刷新或先在对应 provider 下配置模型。
- **想固定用某档**：直接选具体上游模型，不要用 `auto`。
- **换了模型但感觉没省到缓存**：确认 `cache.turnFreeze` 没有被关掉。

日志写入失败只告警一次，不影响请求；文件里只有元数据与被截断的消息预览。最近判定按 `sessionId + turn` 聚合：同一轮的重复 route 记录只显示一行，preview 取该轮最早的非空值。

## 限制

- 每轮首次请求会多一次判定调用（少量时延），续跑由冻结与备忘消除。
- 判定结果直接生效，没有兜底校正；判定错误只会在下一轮被纠正，代价是一次重试。
- 判定输入只含用户消息与上一轮档位：像「把它改回去」这种指代助手改动的追问，判定模型要靠更早的用户消息推断所指，看不到助手的实际改动。这是为了不让长回答压过当前请求而做的取舍。
- 上下文预算按字符估算而非 token；预算不足时先丢最旧的用户消息，当前请求本身不裁剪。
- 会话识别依赖 `options.sessionId`；缺失时只有前缀备忘生效。

## 开发

```bash
node test/smoke.mjs        # 判定核心，不需要 Harness 运行时
node test/adapter.test.mjs # 真实 harness LLM seam（需要应用内置的 @deepseek-ai 对等包）
```

## 版本兼容

`package.json` 用 `engines.dsh` 声明可运行的 Harness 版本（当前 `>=0.2.0-rc.2 <0.3.0`）。跨出范围时启动会提示并自动禁用本插件，不会崩溃：更新本包后重新安装即可。

## 许可证

Apache-2.0，见 [LICENSE](../../LICENSE)。
