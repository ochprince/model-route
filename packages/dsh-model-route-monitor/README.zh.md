---
description: "ModelRoute 的配套右栏监控大屏：实时汇总全局会话的 Opus/Sonnet/Haiku 档位调用、token 用量，并按可配置单价计算相对全部使用 Opus 的经济性。"
kind: "package-reference"
---

# @jiangshilong/dsh-model-route-monitor（ModelRoute 成本监控）

[English](README.md) | 中文

## 概述

这是 [`@jiangshilong/dsh-llm-model-route`](../dsh-llm-model-route/README.zh.md) 的配套插件。它在 DeepSeek Harness 右栏注册一个 **ModelRoute 成本监控** 页面，实时展示当前 Host 上所有会话经过 `model-route` 的模型调用：

- 每个档位（`opus` / `sonnet` / `haiku`）的请求数、会话数、输入/输出/缓存读 token；档位卡片显示实际服务的上游模型，发生故障转移、出现多个模型时用 `+N` 标出。
- 按各档位「输入 / 输出 / 缓存输入」单价计算的实际成本。
- 把同样的 token 全部按 Opus 单价计算的基准成本，以及节省金额、节省比例。
- 会话排行、最近判定、节省比例、时间窗口切换（1 小时 / 24 小时 / 7 天 / 全部）。
- 在面板内直接修改三档单价；保存后立即用新单价重算全部历史，不需要重启。

## 安装与打开

把本目录作为一个 bundle 安装进当前 profile（插件管理器 `install_bundle` 指向本目录），或在 profile 的 `dsh.profile.bundles` 里加入：

```json
"@jiangshilong/dsh-model-route-monitor"
```

安装完成后刷新一次 Harness 页面，右栏与会话头部才会加载新的浏览器半边。

打开方式有两种：

1. **会话标题栏按钮**：会话头部工具区会出现一个监控图标，点一下即可打开右栏页面（右栏已收起时会自动展开）。
2. **右栏引导页**：点右栏标签栏的「+」打开引导页，选择「ModelRoute 成本监控」。

页面是右栏的一个普通标签页，可以拖动、分栏、浮动或全屏，和文件预览等页面一样。

## 界面与一键配置

面板现在是单列布局：顶部是固定摘要栏，下面是可滚动的概览、档位、会话和最近判定。档位卡改为整行显示，字号和行距都已放大，档位占比进度条加粗；版面按财报风格排版——衬线字体做标题和金额、等宽字体做大写小标签、卡片留白更宽、模块间距更大；会话排行默认只显示前 4 条、最近判定默认只显示前 6 条路由，可用「展开全部」查看完整列表，避免一屏堆满。顶部大卡只保留一个数字——节省金额；请求数、会话数、节省比例放到紧邻下方的三联指标里，同一件事不再说两遍。「最近判定」按 judge/route 聚合，不逐条列出模型调用，行的显示时间跟随该回合最新一次完成的调用，正在进行的回合会持续置顶前进；网关有调用正在进行时，顶部时间范围旁会显示「调用中」呼吸点；行右侧显示置信度（升档时标注判定模型原本选的档位），点击一行展开用户消息 preview、判定模型、理由、三档概率、Top-2 差距、升档前档位/升档原因、聚合成本和 Token 等详情。

价格默认使用 **自动价格**：从插件自带的 `data/prices.json` 解析当前三档模型，切换网关里的档位模型后下一次刷新就会自动换成新模型的价格，不需要改 profile 配置。「档位用量」标题右侧的「修改单价」点开后会在该模块内部展开改价面板，表单第一行就是「自动 / 手动」。

面板默认停在当前生效的模式：**自动** 模式下只说明单价的来源，切到 **手动** 才出现三档单价的输入框；**保存单价** 可立即点击，保存会把数值写入配置、固定为手动模式，并立即重算历史。切回自动后手动单价仍保留在配置里，再切回手动就是原来那组数字；只有从未填过手动单价时，才会用当前自动价格做初始值，避免从 0 开始填。页面标题栏的文件图标仍会打开 profile 的 `cordis.patch.yml`（自动补齐 `config.prices` 模板），适合直接改 YAML 的场景。

## 单价配置

「档位用量」模块里的改价面板中，每个档位有三个数字：

| 字段 | 含义 |
| --- | --- |
| 输入 | 未命中缓存的输入 token 单价 |
| 输出 | 输出 token 单价 |
| 缓存读 | 命中缓存的输入 token 单价 |

单位是 **USD / 百万 token**。`0` 表示「未配置」而不是免费：未配置的档位只统计 token，不参与成本与节省计算，面板会显示「未定价」。默认 `autoPrices: true` 时以自动价格为准；在面板里保存单价会自动切到手动模式（等价于 `autoPrices: false`），也可以直接点「手动」，或在配置里预设 `autoPrices: false`。

计算方式：

```text
单次成本 = 输入 token / 1M × 输入单价
         + 输出 token / 1M × 输出单价
         + 缓存读 token / 1M × 缓存读单价
         + 缓存写 token / 1M × 输入单价

全 Opus 基准 = 同一组 token / 1M × Opus 三档单价
节省 = 全 Opus 基准 − 实际成本
```

缓存写没有单独的价格字段，按输入单价计。故障转移后的备用模型仍按所在档位的单价计；如果同一档位的不同上游模型价格差异很大，请按实际使用比例给该档位设一个加权单价。只有「实际档位单价」和「Opus 基准单价」都已配置的请求，才计入节省金额与节省比例；面板会显示经济性覆盖了多少次请求，避免把未定价请求算成 0 成本。

自动价格不需要写 profile。只有关闭 `autoPrices`（或保存过一次单价、点过「手动」）时，才使用 `prices` 里的手动单价；手动价格也可以在 `cordis.patch.yml` 预设：

```yaml
- id: model-route-monitor
  name: "@jiangshilong/dsh-model-route-monitor"
  config:
    prices:
      opus:   { input: 15, output: 75, cacheRead: 1.5 }
      sonnet: { input: 3, output: 15, cacheRead: 0.3 }
      haiku:  { input: 1, output: 5, cacheRead: 0.1 }
```

## 价格表与自动匹配

价格已经沉淀到插件自带的 [`data/prices.json`](data/prices.json)，运行时不扫描 sub2api：

- `catalog`：195 个 LiteLLM 价格条目，已从 USD / token 换算成 USD / 百万 token；
- `fallbacks.prices`：52 个代码兜底价格；
- `fallbacks.patterns`：30 条 `billing_service.go` 里的模型系列规则；
- 元数据记录了生成时间和原始文件路径。

自动价格按以下顺序解析每个档位的上游模型：

1. 在自带 `catalog` 中精确查找；
2. 精确匹配自带 `fallbacks.prices`；
3. 按自带 `fallbacks.patterns` 的系列规则匹配，例如 `glm-5.3` → `glm-5`、`glm-5.3-flash` → `glm-5`；
4. DeepSeek V4 版本/构建后缀归一化，例如 `deepseek-v4.1-flash-1017` → `deepseek-v4-flash`；
5. 以上都不可用时回退到手动价格。

切换网关槽位模型后，面板下一次 2 秒刷新就会自动使用新价格；不需要手动改 `cordis.patch.yml`。

需要更新价格表时（例如 sub2api 代码新增了模型），运行一次：

```bash
node scripts/build-price-catalog.mjs
```

脚本默认读取 `~/Workspace/colaorca/sub2api`，也可以用 `SUB2API_DIR` 指定项目目录。它只用于重新生成 `data/prices.json`；日常运行不会访问 sub2api。

当前自动匹配结果：`glm-5.3` → 代码兜底 `glm-5`（$1.00 / $3.20 / $0.20），`deepseek-v4.1-flash-1017` → 代码兜底 `deepseek-v4-flash`（$0.14 / $0.28 / $0.0028），`glm-5.3-flash` → 代码兜底 `glm-5`（$1.00 / $3.20 / $0.20）。

## 独立预览 URL（调样式用）

插件还提供一个不经过 Harness 登录页的独立预览地址，用当前 `lib/client.js` 和真实快照数据渲染同一个 `MonitorBody`：

```text
http://127.0.0.1:<当前 Harness 端口>/model-route-monitor/preview?width=400&height=1000
```

`width` 和 `height` 可以调整，用来检查窄右栏、滚动条和遮挡。预览页使用 CDN 上的 Preact 作为 React 兼容运行时，只为开发审查；正式右栏仍使用 Harness 的 React。

如果预览页显示正确、正式右栏仍是旧效果，通常说明页面还没有加载新的 client bundle，需要完整刷新或重启 Harness。

## 数据来源与归因

Host 半边监听 `llm/stream` 瀑布：

1. 只记录进入网关路由（默认 `model-route`）的外层调用，不会把网关内部转发给上游的嵌套调用重复计费。
2. 网关把 `auto` 判定为某一档后，会以该档配置的 `provider/model` 发起嵌套调用；监控据此把外层调用归到对应档位。
3. 档位到上游模型的映射从 `@jiangshilong/dsh-llm-model-route` 的实时配置读取（`configEditor.configuration()`），所以改网关映射后不需要改监控配置。
4. 辅助调用（压缩、标题）同样按实际嵌套的上游模型归到对应档位。
5. 显式选择 `opus` / `sonnet` / `haiku` 的调用直接按别名归因。
6. 归因不到唯一档位（例如两个档位映射到同一个上游模型）时，记录为「未识别」并单独展示，不猜测。

只记录 token 与路由元数据：会话 id、档位、上游 provider/model、用途、耗时、结束原因。**不记录消息内容、提示词或输出文本。**

调用记录默认追加到：

```text
$DSH_HOME/logs/model-route-monitor.jsonl
```

保留最近 `maxRecords` 条（默认 5000），文件超过 8 MB 自动轮转为 `.1`。历史只用于本面板；删除该文件即可清空历史。

## 配置项

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `prices.opus/sonnet/haiku.{input,output,cacheRead}` | `0` | 三档单价（USD / 百万 token） |
| `currency` | `USD` | 金额显示货币代码 |
| `autoPrices` | `true` | 按自带价格表自动匹配当前档位；关闭后使用 `prices` 中的手动单价 |
| `gatewayPackage` | `@jiangshilong/dsh-llm-model-route` | 从哪个包读取档位映射 |
| `gatewayRoute` | `model-route` | 读不到网关配置时使用的路由名 |
| `persist` | `true` | 是否把调用记录写入 JSONL |
| `maxRecords` | `5000` | 内存/文件保留记录上限（100–50000） |

## 采集范围与限制

- 统计的是 **本 Host 进程** 经网关产生的调用；其他 Host 进程或纯直连上游的调用不在内。
- 面板以 2 秒间隔轮询本机同源快照接口；断线时保留最后一次数据并显示错误，恢复后自动继续。
- 档位映射来自网关实时配置。若 `configEditor` 不可用或读不到网关行，仍会记录调用，但 `auto` 的档位可能显示为「未识别」。
- 归因依赖外层调用与嵌套调用的 `sessionId` 一致；这是网关转发时保留的字段。若未来网关不再传递，归因会退化而不是误记。
- 只支持 `opus` / `sonnet` / `haiku` 三个标准档位的单价；自定义档位别名会进入「未识别」。
- 最近判定的点击面板优先读网关 JSONL 的 route 记录（含 preview）；日志不可用时回退到 inspect provider。两者都不可用时会提示没有判定记录。

## 开发

```bash
node test/monitor.test.mjs
node test/sub2api.test.mjs
node --check lib/index.js
node --check lib/client.js
```

`lib/model.js` 是无依赖的纯函数层，负责价格表解析、模型匹配、成本与聚合；`lib/index.js` 负责读取内置价格表、Host 采集和同源快照路由；`lib/client.js` 是右栏 React 页面、引导页入口和会话头部按钮；`data/prices.json` 是沉淀后的价格表。