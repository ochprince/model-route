# @jiangshilong/dsh-client-ui-model-route

**ModelRoute 网关的配置面板，渲染在 Harness 的 Models 页里。**

[English](README.md) | 中文

## 概述

在 `model-route` 这一行 provider 上加一张卡片：档位槽位、判定模型端点与凭据、辅助调用档位，以及一次性的判定测试。

它是可选的——只装网关、手写 YAML 也能用——而且不发明配置：卡片保存的每个字段，网关都本来就会读取。

## 快速开始

1. 先装网关：[`@jiangshilong/dsh-llm-model-route`](../dsh-llm-model-route/README.zh.md)。
2. 把本目录作为 bundle 安装。
3. 刷新 Harness 页面，打开 **Models → ModelRoute**。

## 卡片能配置什么

| 区域 | 写入的字段 | 说明 |
| --- | --- | --- |
| 档位槽位 | `tiers.{opus,sonnet,haiku}.provider` + `.model` | 候选来自当前已配置 provider 的模型目录；网关自身路由被排除，否则会自我递归 |
| 判定端点 | `enableRouter`、`router.<family>.baseURL`、`router.<family>.model` | JEV 与 StartLux 两个家族各存一条，切换互不覆盖 |
| 判定凭据 | 凭据 `JEV_API_KEY` / `BAMBOO_API_KEY` | 直接写入凭据服务，值不回显 |
| 判定代理 | `router.<family>.proxy` | 只作用于判定请求 |
| 辅助档位 | `auxiliary.compaction`、`auxiliary.session-title` | 这些调用不经过判定 |
| 测试按钮 | — | 用表单里当前的值（含尚未保存的 key）真跑一次判定 |

## 哪些留给 YAML

故障转移候选、推理档位、判定超时与上下文预算、自定义提示词、凭据引用名、决策缓存、访问日志，都只在配置文件里。
见网关的[配置参考](../dsh-llm-model-route/README.zh.md#配置)。

## 值得知道的行为

- 切换判定家族只是把表单切到另一个条目；保存时写入 `enableRouter`，**保存时选中的家族才会生效**。
- 只填了 provider 的档位、或只填了一半的故障转移候选会被拒绝，不会写进半成品配置。
- 卡片只写你改过的字段，它不管理的 YAML 段落保持原样。
- 测试会花掉一次判定请求，用的是合成提示词，不会发送你的对话。

## 限制

- 依赖网关包；只在那一行 provider 上渲染。
- 候选取自 harness 的模型目录。写在 YAML 里但不在目录中的模型仍会显示，但无法从下拉里选。
- 测试按钮需要判定端点可达。

## 开发

```bash
node test/bundle.test.mjs
```

## 许可证

Apache-2.0，见 [LICENSE](../../LICENSE)。
