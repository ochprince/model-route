<div align="center">

# ModelRoute

**让每一轮对话，都用得起的最便宜模型。**

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的智能模型路由插件：
每次提问先花一次很便宜的判定，决定这一轮该用 `haiku` / `sonnet` / `opus`，
于是日常琐碎工作不再按顶配模型的价格计费。

[快速开始](#快速开始2-分钟) · [怎么省钱](#怎么省钱) · [工作原理](#工作原理) · [配置](#配置) · [English](README.md)

</div>

---

## 问题

一次长编码会话里，九成是琐碎工作：改变量名、读一个文件、修错别字、再跑一遍测试。
如果每一轮都跑在最强模型上，这些活都在按最贵价格付费。

手动切模型在真实会话里撑不住——你会忘，或者任务中途变了，或者干脆「保险起见」就一直留着贵的那个。

## 思路

ModelRoute 只注册**一个** provider 路由，里面只有一个模型：`auto`。

```
你的提问 ─► 判定模型（约 1 秒、很便宜）─► haiku | sonnet | opus ─► 你为这档配置的模型
```

- **判定模型**读当前请求和更早的用户消息，挑出能完成它的最便宜档位。
- **档位由你定**：`opus` / `sonnet` / `haiku` 指向你已有的任意 provider / 模型。
- **一轮对话一个模型**：工具续跑沿用这个决策，上游前缀缓存持续命中——路由不会把你的缓存打掉。

## 怎么省钱

下表是一组示例单价（输入 / 输出 / 命中缓存的输入，每 100 万 token）。同样一轮 137k token、大部分命中缓存的对话：

| 档位 | 单价 | 这一轮成本 | 相对 opus |
| --- | --- | --- | --- |
| `opus` | $1.40 / $4.40 / $0.26 | **$0.0489** | 基准 |
| `haiku` | $0.15 / $0.50 / $0.03 | **$0.0055** | 便宜约 9 倍 |
| `sonnet` | $0.15 / $0.60 / $0.006 | **$0.0026** | 便宜约 19 倍 |

真实倍数取决于你的档位映射和单价——装上自带的[成本监控](#看看你省了多少)，它会告诉你真实数字。

关键不是「每一轮都更便宜」，而是**贵的档位只用在真正需要它的那几轮**，而不是所有轮的默认。

## 快速开始（2 分钟）

**1. 克隆**

```bash
git clone https://github.com/ochprince/model-route.git
cd model-route
```

**2. 安装三个 bundle** —— 直接让 Harness 的 Agent 帮你装：

> 帮我安装这三个 bundle：
> `/绝对路径/model-route/packages/dsh-llm-model-route`（网关，必需）
> `/绝对路径/model-route/packages/dsh-client-ui-model-route`（配置面板，可选）
> `/绝对路径/model-route/packages/dsh-model-route-monitor`（成本监控，可选）

（也可以在 Harness 的插件管理里逐个安装。第一个是必需的，后两个可选：一个配置卡片、一个成本看板。）

**3. 把这段加进 profile 补丁**（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`），把两个端点换成你自己的模型：

```yaml
- id: llm-model-route
  name: "@jiangshilong/dsh-llm-model-route"
  config:
    route: model-route
    tiers:
      opus:   { provider: my-provider, model: strong-model }
      sonnet: { provider: my-provider, model: mid-model }
      haiku:  { provider: my-provider, model: cheap-model }
    enableRouter: jev
    router:
      jev:
        baseURL: https://api.typesafe.ai/v1   # 判定模型地址
        model: jev-latest
```

`provider` 就是你在 Harness Models 页已经配好的 provider 路由——ModelRoute 不要求你重新声明地址、密钥或协议。

**4. 把默认模型指过来**

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: model-route
    model: auto
```

重启一次 Harness。新会话从 `auto` 开始，模型选择器里多出一个 **ModelRoute**。

> 还没有判定模型的 key？把 `router.jev.baseURL` 留空即可：每轮都跑 `fallbackTier`
> （默认 `sonnet`）——依然比一直用 opus 便宜，之后想开判定也不用改别的东西。

## 看看你省了多少

监控 bundle 会在右侧栏加一个面板：按档位统计实时花费、相对「全部用 opus」的节省，以及最近 24 次路由决策（判定档位、置信度、理由）。
打开 **auto prices** 可以让它从公开价目表自动匹配单价，不用手填。

把 `log.enabled` 打开后，每次决策还会写进 `$DSH_HOME/logs/model-route.jsonl`。

## 工作原理

三个包，彼此独立、可分别安装：

| 包 | 作用 |
| --- | --- |
| [`dsh-llm-model-route`](packages/dsh-llm-model-route/README.zh.md) | 网关本体。注册 `model-route` provider，逐轮判定，分发到选定档位。 |
| [`dsh-client-ui-model-route`](packages/dsh-client-ui-model-route/README.zh.md) | provider 卡片上的配置面板：档位、判定端点、API Key、测试按钮。 |
| [`dsh-model-route-monitor`](packages/dsh-model-route-monitor/README.zh.md) | 成本看板：按档位花费、节省额、决策轨迹。 |

### 什么时候判定

判定只发生在三个节点，别处一律不判：

| 节点 | 原因 |
| --- | --- |
| **新的用户回合** | 任务可能变了。 |
| **历史被重建** | 压缩替换掉了冻结决策所依据的上下文。 |
| **委派**（`route_tier`） | 子任务该有自己的档位，与当前对话的规模无关。 |

回合内的工具续跑**不再判定**。这是刻意的：一轮一个模型能让上游前缀缓存保持命中；
而「任务可能变了」这类回合内信号（工具调用次数、上下文增长）实测下来没有带来任何档位变化，
却每次都要多付一次判定。

### 判定模型看到什么

只给判定所需要的东西——当前请求、更早的用户消息、上一轮档位：

```json
{
  "latest_user": "把配置字段改名，并更新所有调用点",
  "prior_user_turns": ["修一下 parser 里失败的测试", "…"],
  "previous_tier": "sonnet"
}
```

不给助手回答、不给工具输入输出、不给 Agent 的系统提示词，也没有任何正则派生字段。
这些内容会与请求争夺判定模型的注意力，却不会告诉它这个请求有多难——此前助手的冗长回答占了请求体的 72%。

提示词写的是原则（什么抬高所需能力、什么降低它、如何看待历史），而不是罗列场景。
可以直接读：[`docs/judge-prompt.zh.md`](docs/judge-prompt.zh.md)。

### 判定即最终

没有隐藏的升档保底、没有置信度闸门、没有「沿用上一轮」。判定说 `haiku`，这一轮就跑 `haiku`。
判错只损失一次重试；而便宜模型重读整段上下文，仍然比贵模型读缓存便宜。

判定端点不可用 → 跑 `fallbackTier`（默认 `sonnet`），请求绝不因此失败。

## 配置

```yaml
- id: llm-model-route
  name: "@jiangshilong/dsh-llm-model-route"
  config:
    route: model-route                # 选择器里显示的 provider 名
    tiers:                            # 必填：三个上游
      opus:   { provider: aiapi, model: glm-5.3, fallbacks: [{ provider: aiapi, model: backup }] }
      sonnet: { provider: aiapi, model: glm-5.3-flash }
      haiku:  { provider: aiapi, model: deepseek-v4-flash }
    enableRouter: jev                 # jev | startlux
    router:
      jev: { baseURL: https://…, model: jev-latest, proxy: "" }
    fallbackTier: sonnet              # 判定失败时使用
    auxiliary:                        # 压缩 / 会话标题不经过判定
      compaction: haiku
      session-title: haiku
    cache:
      turnFreeze: true                # 一轮一个模型（对前缀缓存友好）
      memoMaxEntries: 512
    delegate:
      toolName: route_tier            # 委派时的判定工具
      maxCandidates: 3
    log:
      enabled: false
```

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `tiers` | — | `opus` / `sonnet` / `haiku` → provider + 模型，可选有序 `fallbacks` |
| `enableRouter` | `jev` | 启用哪个判定家族 |
| `router.<family>` | — | 判定端点（`baseURL`、`model`、可选 `proxy`）或已注册的 `provider` 路由 |
| `fallbackTier` | `sonnet` | 判定失败时使用的档位 |
| `auxiliary` | 压缩/标题 → `haiku` | 不经过判定的辅助调用 |
| `cache.turnFreeze` | `true` | 一轮一个模型；设为 `false` 则每次请求都判定 |
| `delegate.toolName` | `route_tier` | 委派判定工具名 |

完整参考：[`packages/dsh-llm-model-route/README.zh.md`](packages/dsh-llm-model-route/README.zh.md)。

## 委派路由

在把任务交给子智能体之前，主 Agent 可以先问「这个子任务该用哪档」：

```
route_tier(task="重构调度层", context="只改 crates/scheduler，保持公开 API")
→ { tier: "opus", provider: "aiapi", model: "glm-5.3", alternatives: [...], usage_hint: "…" }
```

返回的 `provider` / `model` 可以直接传给支持模型选择的 `subagent` 工具。判定读的是**任务本身**，不是当前对话有多大。

## 环境要求

- 装有 DeepSeek Harness（桌面或 Web），并且能编辑 profile
- 为三个档位准备好 provider 路由——端点、密钥、协议、模型探测都交给 Harness 的 Models 页
- 一个判定模型端点：支持 TypeSafe System One（`jev`）或 StartLux 结构化判定（`startlux`）；
  任何 OpenAI/Anthropic 兼容的 chat 路由也可以通过 `router.<family>.provider` 充当判定

## 常见问题

**会破坏 prompt 缓存吗？**
不会。一轮只用一个模型，工具续跑沿用决策；历史被压缩时缓存本来就失效了，所以才重新判定。

**会不会把该用强模型的活降级掉？**
判定读的是请求本身，不是对话长度，而且提示词明确告诉它「延续先前工作不是难度证据」。
真判错了，你能在决策轨迹里看到，代价是一次重试——仍然比所有轮都跑 opus 便宜。

**不装面板和监控能用吗？**
能。只装网关就够，配置就是普通 YAML。

**必须用 JEV 吗？**
不必。判定是可插拔的：JEV、StartLux，或经由已注册 provider 路由的任意 chat 模型。

## 开发

```bash
npm run test          # 网关：判定核心（不需要 Harness 运行时）
npm run test:panel    # 配置面板
npm run test:monitor  # 成本模型
```

`packages/dsh-llm-model-route/test/adapter.test.mjs` 还会跑真实的 Harness LLM seam，
需要 Harness 应用内置的 `@deepseek-ai/*` 对等包。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。
