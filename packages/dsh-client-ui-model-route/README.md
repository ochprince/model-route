# @jiangshilong/dsh-client-ui-model-route

ModelRoute 智能模型路由（`@jiangshilong/dsh-llm-model-route`）的**可视化配置面板**（客户端 UI 插件）。

## 是什么

在 Models 设置页的 "ModelRoute 智能模型路由" 卡片内渲染一个**精简面板**，只保留最常用配置：

- **档位映射**：opus / sonnet / haiku 三档各自一个"提供商 + 模型"下拉对——数据来自宿主代际模型目录（`session.modelCatalog()`）中已配置 provider 的已自定义模型；目录外的取值（配置文件指定）仍会原样显示；
- **判定模型**：先选家族（JEV / StartLux），然后是 baseURL、模型 ID，以及 **API Key 页面直存**（凭据服务写入，值不回显）。两个家族都是结构化判定端点（JEV 用 `/v1/systemone`，StartLux 用 `/v1/decisions`），**没有协议下拉**；密钥名随家族走（`JEV_API_KEY` / `BAMBOO_API_KEY`）；**每个家族的端点配置在 `router` 字典里各占一条**（`router.jev` / `router.startlux`）；
- **代理（可选）**：收在卡片最底部、默认收起；只有判定请求走它。展开后可填 `http://127.0.0.1:7897`，已配置时摘要只显示目标主机（不回显账号密码）；
- **辅助调用**：会话压缩、会话标题各自选择档位；
- **测试判定**：保存按钮旁的测试按钮，用当前表单值（含尚未保存的修改和刚粘贴的密钥）真正跑一次判定，回显档位、置信度与耗时。

切换"判定模型"只是把表单切到另一个家族的条目——各自的地址与模型互不覆盖，首次使用为空；保存时写入 `enableRouter`，**启用的就是保存时选中的家族**。待填的 API Key 会清空——密钥本身已按家族存在凭据服务里（`JEV_API_KEY` / `BAMBOO_API_KEY`），不随表单走。

进阶配置（故障转移候选、推理档位、判定超时/上下文预算、自定义提示词、凭据引用名、决策缓存 `cache.*`、访问日志 `log.*`）不进面板：直接改 `cordis.patch.yml` 对应段。

规则只有一条：选 `auto` 由判定模型判定档位；显式选 `opus` / `sonnet` / `haiku` 则精确使用该档模型，不调用判定模型。判定上下文、跨轮换模型门槛与访问日志见主包文档 `@jiangshilong/dsh-llm-model-route`。

保存通过共享 settings 文档（`configForms`）原子写入 volatile 字段——持久化进 profile 的 `cordis.patch.yml`，loader 热更新，网关对新请求即时生效。

**测试为什么需要宿主参与**：判定密钥只存在宿主的凭据服务里（对浏览器是 write-only），浏览器也无法替宿主发请求。面板因此调用宿主注册的同源路由 `POST /model-route/judge-test`（由网关插件用 `webServer.register` 注册），宿主用与真实请求同一套逻辑（同家族、同 payload、同凭据解析）跑一次判定并只返回 `{ok, tier, confidence, reason, ms}`。该路由只接受同源 JSON 请求，不写配置、不创建会话；测试文本固定为一句示例，仅用于验证端点与密钥是否连通。

## 结构

| 文件 | 说明 |
| --- | --- |
| `lib/index.js` | 宿主半边：空 `apply`，只为让插件进入 Loader 组合 |
| `lib/client.js` | 浏览器半边：`__ModuleLoader__` 工厂格式单文件 bundle，keyed 插槽 `settings.models.provider-card`（key = `llm-model-route`） |

## 约束

- 面板按网关条目的 settingsNs（`llm-model-route`）注册；若在补丁里改了网关条目的 `id`，需同步修改 `lib/client.js` 中的 `NS` 常量。
- 只编辑 volatile 字段；`route`、`fallbackTier` 等结构性字段仍在补丁里维护。
- 客户端 bundle 需在宿主启动前就位（本地安装已直接提供构建产物 `lib/client.js`）。

## 安装

本包是 bundle（`dsh.bundle.patch` 插入 `client-model-route-ui` 条目），用插件管理器安装：

```
plugin_manager → action: install_bundle → target: <本包绝对路径>
```

安装后刷新一次页面，Models 页的网关卡片即出现配置面板。`engines.dsh` 声明可运行的 dsh 版本范围；Harness 升级到范围外版本时该行会被自动禁用并提示，更新范围后重装即可。

## 测试

```bash
node test/bundle.test.mjs
```

以桩模块驱动工厂，覆盖注册契约、卡片守卫、保存计划（嵌套路径 set/unset、档位整组校验、默认值回落、按家族的凭据引用选择）、各家族条目的写入与清理，以及测试请求对草稿的合并。
