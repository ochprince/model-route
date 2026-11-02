window.__ModuleLoader__.load({
	id: "@jiangshilong/dsh-model-route-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const Fragment = React.Fragment;

		//#region constants
		const NS = "tierGatewayMonitor";
		const KIND = "model-route-monitor";
		const ID = "@jiangshilong/dsh-model-route-monitor";
		const ENTRY_ID = "model-route-monitor";
		const SNAPSHOT_URL = "/model-route-monitor/snapshot";
		const TIERS = ["opus", "sonnet", "haiku"];
		const FIELDS = ["input", "output", "cacheRead"];
		const RANGES = ["1h", "1d", "7d", "all"];
		//#endregion

		//#region copy
		const zh = {
			"tab.title": "ModelRoute 成本",
			"guide.title": "ModelRoute 成本监控",
			"guide.description": "实时查看 Opus / Sonnet / Haiku 用量与相对全 Opus 的节省",
			"open": "打开 ModelRoute 成本监控",
			"title": "ModelRoute 成本监控",
			"subtitle": "全局会话 · 网关实时用量",
			"refresh": "立即刷新",
			"range.1h": "1 小时",
			"range.1d": "24 小时",
			"range.7d": "7 天",
			"range.all": "全部",
			"rangeLabel": "时间范围",
			"savings": "相对全 Opus 节省",
			"savingRate": "节省比例",
			"requests": "请求",
			"sessions": "会话",
			"cacheHit": "缓存命中",
			"input": "输入",
			"output": "输出",
			"cacheRead": "缓存读",
			"cost": "成本",
			"price": "单价",
			"priceTitle": "档位单价",
			"priceMode": "价格模式",
			"priceOpen": "修改单价",
			"priceClose": "收起",
			"priceAutoNote": "单价自动取自网关与内置价格表。切到手动可覆盖。",
			"priceManualNote": "手动单价会保存下来；切回自动后仍保留，随时可以切回来。",
			"more": "展开全部",
			"less": "收起",
			"openConfig": "打开配置文件",
			"configOpened": "已打开配置文件；保存 YAML 后会自动重载。",
			"configOpenFailed": "无法自动打开桌面编辑器，请手动打开配置文件。",
			"configTemplateFailed": "单价模板写入失败",
			"autoPricesLabel": "自动",
			"manualPricesLabel": "手动",
			"autoToggleFailed": "切换价格模式失败",
			"judgeModel": "判定模型",
			"judgeReason": "判定理由",
			"judgeSource": "判定来源",
			"judgeConfidence": "置信度",
			"judgeConfidenceFor": "{tier} 置信度",
			"judgeProbabilities": "三档概率",
			"judgeMargin": "Top-2 差距",
			"selectedTier": "实际档位",
			"judgeTier": "判定档位",
			"judgeHeld": "沿用档位",
			"judgeHeldBy": "保留原因",
			"heldBy.escalation": "重复失败保护（用户否定后不降档）",
			"heldBy.switch": "换档门槛（判定置信度/差距不足）",
			"judgeEscalatedFrom": "升档前档位",
			"judgeEscalation": "升档原因",
			"source.judge": "判定模型",
			"source.frozen": "回合冻结",
			"source.memo": "前缀复用",
			"source.fixed": "显式档位",
			"source.fallback": "判定失败兜底",
			"source.auxiliary": "辅助任务",
			"source.hold": "沿用上一轮",
			"source.escalate": "重复失败升档",
			"source.stage": "回合内阶段重判",
			"source.stage-escalate": "阶段重判升档",
			"source.call": "逐次调用重判",
			"source.delegate": "委派前判定",
			"judgeTrail": "本回合判定轨迹",
			"judgeTrailItem": "第 {n} 次",
			"judgeBoundary": "触发边界",
			"judgeRejudges": "已重判次数",
			"judgePerCall": "逐次调用判定",
			"boundary.tool-error": "工具执行失败",
			"boundary.rebuild": "历史重建（压缩/重投影）",
			"boundary.tool-calls": "累计工具结果",
			"boundary.char-growth": "上下文增长",
			"delegations": "委派判定",
			"delegateTask": "子任务",
			"delegateFallback": "判定不可用，已用兜底档位",
			"judgeTask": "任务类型",
			"judgeTurn": "回合",
			"judgeMs": "判定耗时",
			"judgeUnavailable": "这条调用没有逐条判定记录",
			"judgeTitle": "判定详情",
			"dismiss": "关闭提示",
			"save": "保存单价",
			"saving": "保存中…",
			"saved": "单价已保存",
			"saveFailed": "保存未被接受，请重试",
			"discard": "取消",
			"invalid": "请填写非负数字",
			"noForm": "设置服务不可用，单价暂不可编辑。",
			"readonly": "当前配置只读。",
			"loading": "读取中…",
			"empty": "网关还没有调用记录。使用 auto 档发起对话后，这里会实时出现数据。",
			"error": "读取失败",
			"retry": "重试",
			"gatewayMissing": "没有读到 model-route 配置，档位归因可能不完整。",
			"unknown": "未识别",
			"unknownTier": "未识别档位",
			"noPrice": "设置单价后计算",
			"comparable": "经济性覆盖 {priced}/{total} 次请求",
			"share": "请求占比",
			"costShare": "成本占比",
			"byTier": "档位用量",
			"bySession": "会话排行",
			"recent": "最近判定",
			"preview": "用户消息",
			"previewUnavailable": "未记录 preview（网关日志未开启或 previewChars=0）",
			"callsCount": "调用次数",
			"tokensLabel": "Token",
			"noRecentDecisions": "暂无判定记录",
			"noSessions": "暂无会话",
			"calls": "{n} 次",
			"updated": "更新于",
			"live": "调用中",
			"model": "模型",
			"status": "状态",
			"errorShort": "失败",
			"purpose": "用途",
			"cached": "缓存读",
			"total": "合计",
			"perMillion": "/ 百万",
			"default": "默认",
			"tier.opus": "Opus",
			"tier.sonnet": "Sonnet",
			"tier.haiku": "Haiku",
			"tier.unknown": "未识别",
			"savingShort": "节省",
			"noModel": "未映射",
		};
		const en = {
			"tab.title": "ModelRoute Cost",
			"guide.title": "ModelRoute cost monitor",
			"guide.description": "Live Opus / Sonnet / Haiku usage and savings versus all-Opus",
			"open": "Open ModelRoute cost monitor",
			"title": "ModelRoute cost monitor",
			"subtitle": "All sessions · live gateway usage",
			"refresh": "Refresh now",
			"range.1h": "1 hour",
			"range.1d": "24 hours",
			"range.7d": "7 days",
			"range.all": "All",
			"rangeLabel": "Time range",
			"savings": "Saved versus all-Opus",
			"savingRate": "Savings rate",
			"requests": "Requests",
			"sessions": "Sessions",
			"cacheHit": "Cache hit",
			"input": "Input",
			"output": "Output",
			"cacheRead": "Cache read",
			"cost": "Cost",
			"price": "Price",
			"priceTitle": "Tier unit prices",
			"priceMode": "Price mode",
			"priceOpen": "Edit prices",
			"priceClose": "Collapse",
			"priceAutoNote": "Prices follow the gateway and the bundled catalog. Switch to Manual to override.",
			"priceManualNote": "Manual prices are kept when you switch back to Auto, so you can return to them anytime.",
			"more": "Show all",
			"less": "Show less",
			"openConfig": "Open config file",
			"configOpened": "Config file opened; saving YAML reloads it automatically.",
			"configOpenFailed": "Could not open the desktop editor. Open the config file manually.",
			"configTemplateFailed": "Could not write the price template",
			"autoPricesLabel": "Auto",
			"manualPricesLabel": "Manual",
			"autoToggleFailed": "Could not switch the price mode",
			"judgeModel": "Judge model",
			"judgeReason": "Judge reason",
			"judgeSource": "Decision source",
			"judgeConfidence": "Confidence",
			"judgeConfidenceFor": "{tier} confidence",
			"judgeProbabilities": "Tier probabilities",
			"judgeMargin": "Top-2 margin",
			"selectedTier": "Selected tier",
			"judgeTier": "Judged tier",
			"judgeHeld": "Held tier",
			"judgeHeldBy": "Held because",
			"heldBy.escalation": "Repeated-failure protection (no downgrade after rejection)",
			"heldBy.switch": "Switch gate (judge confidence/margin too low)",
			"judgeEscalatedFrom": "Escalated from",
			"judgeEscalation": "Escalation reason",
			"source.judge": "Judge",
			"source.frozen": "Turn frozen",
			"source.memo": "Prefix memo",
			"source.fixed": "Explicit tier",
			"source.fallback": "Judge fallback",
			"source.auxiliary": "Auxiliary purpose",
			"source.hold": "Held previous",
			"source.escalate": "Repeated-failure escalation",
			"source.stage": "Stage re-judgment",
			"source.stage-escalate": "Stage escalation",
			"source.call": "Per-call judgment",
			"source.delegate": "Delegation judgment",
			"judgeTrail": "Judgments this turn",
			"judgeTrailItem": "#{n}",
			"judgeBoundary": "Boundary",
			"judgeRejudges": "Re-judgments used",
			"judgePerCall": "Judged per call",
			"boundary.tool-error": "Tool failure",
			"boundary.rebuild": "Rebuilt history (compaction)",
			"boundary.tool-calls": "Accumulated tool results",
			"boundary.char-growth": "Context growth",
			"delegations": "Delegation judgments",
			"delegateTask": "Task",
			"delegateFallback": "Judge unavailable, fallback tier used",
			"judgeTask": "Task",
			"judgeTurn": "Turn",
			"judgeMs": "Judge time",
			"judgeUnavailable": "No per-call decision record",
			"judgeTitle": "Decision details",
			"dismiss": "Dismiss",
			"save": "Save prices",
			"saving": "Saving…",
			"saved": "Prices saved",
			"saveFailed": "The save was not accepted; try again",
			"discard": "Cancel",
			"invalid": "Enter non-negative numbers",
			"noForm": "The settings service is unavailable, so prices cannot be edited here.",
			"readonly": "This configuration is read-only.",
			"loading": "Loading…",
			"empty": "No gateway calls yet. Start a conversation on the auto model and data will appear here live.",
			"error": "Could not read the monitor",
			"retry": "Retry",
			"gatewayMissing": "No model-route configuration was found; tier attribution may be incomplete.",
			"unknown": "Unrecognized",
			"unknownTier": "Unrecognized tier",
			"noPrice": "Set prices to calculate",
			"comparable": "Economics cover {priced}/{total} requests",
			"share": "Request share",
			"costShare": "Cost share",
			"byTier": "Tier usage",
			"bySession": "Sessions",
			"recent": "Recent decisions",
			"preview": "User message",
			"previewUnavailable": "No preview recorded (gateway log disabled or previewChars=0)",
			"callsCount": "Calls",
			"tokensLabel": "Tokens",
			"noRecentDecisions": "No decision records yet",
			"noSessions": "No sessions yet",
			"calls": "{n} calls",
			"updated": "Updated",
			"live": "In flight",
			"model": "Model",
			"status": "Status",
			"errorShort": "Failed",
			"purpose": "Purpose",
			"cached": "Cache read",
			"total": "Total",
			"perMillion": "/ 1M",
			"default": "Default",
			"tier.opus": "Opus",
			"tier.sonnet": "Sonnet",
			"tier.haiku": "Haiku",
			"tier.unknown": "Unrecognized",
			"savingShort": "Saved",
			"noModel": "Unmapped",
		};
		//#endregion

		//#region styles
		const CSS = `
.tgm-root{--tgm-display:'Iowan Old Style','Charter','Iowan',Georgia,'Times New Roman',serif;--tgm-mono:ui-monospace,SFMono-Regular,Menlo,monospace;--tgm-hair:0.5px solid var(--dsw-alias-border-l2);flex:1 1 0;height:100%;max-height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14.5px;line-height:1.6;overflow:hidden}
.tgm-root *,.tgm-root *::before,.tgm-root *::after{box-sizing:border-box}
.tgm-top{position:relative;z-index:2;flex:0 0 auto;display:flex;flex-direction:column;gap:14px;padding:20px 18px 16px;border-bottom:1.5px solid color-mix(in srgb,var(--dsw-alias-label-primary) 78%,transparent);background:var(--dsw-alias-bg-base)}
.tgm-title-row{display:flex;align-items:flex-start;gap:10px;min-width:0}
.tgm-title-mark{flex:none;width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent)}
.tgm-title-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.tgm-title{font-family:var(--tgm-display);font-weight:700;font-size:17.5px;line-height:24px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-subtitle{font-family:var(--tgm-mono);font-size:10.5px;line-height:15px;text-transform:uppercase;letter-spacing:.09em;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-refresh{width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.tgm-refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.tgm-refresh:disabled{opacity:.45;cursor:default}
.tgm-refresh:focus-visible,.tgm-chipbtn:focus-visible,.tgm-open:focus-visible,.tgm-button:focus-visible,.tgm-price-input:focus-visible,.tgm-section-action:focus-visible,.tgm-copy:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tgm-controls{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
.tgm-ranges{display:flex;align-items:center;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);min-width:0;overflow:hidden}
.tgm-chipbtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:22px;padding:3px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.tgm-chipbtn:hover{color:var(--dsw-alias-label-primary)}
.tgm-chipbtn[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}
.tgm-live{display:inline-flex;align-items:center;gap:5px;margin-left:auto;font-family:var(--tgm-mono);font-size:10.5px;line-height:16px;letter-spacing:.05em;color:var(--dsw-alias-brand-primary);white-space:nowrap}
.tgm-live i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:tgm-pulse 1.6s ease-in-out infinite;flex:none}
.tgm-live + .tgm-updated{margin-left:0}
@keyframes tgm-pulse{0%,100%{opacity:1}50%{opacity:.3}}
.tgm-updated{margin-left:auto;font-family:var(--tgm-mono);font-size:10.5px;line-height:16px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-top-notice{display:flex;align-items:flex-start;gap:9px;padding:9px 11px;border:var(--tgm-hair);border-radius:9px;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.tgm-top-notice[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l2))}
.tgm-top-notice[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,var(--dsw-alias-border-l2))}
.tgm-top-notice[data-tone="error"]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,var(--dsw-alias-border-l2))}
.tgm-top-notice span{flex:1;min-width:0;overflow-wrap:anywhere}
.tgm-scroll{flex:1 1 auto;min-height:0;overflow-y:scroll;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent) transparent;padding:22px 18px 56px;display:flex;flex-direction:column;gap:28px}
.tgm-scroll > *{flex:0 0 auto}
.tgm-scroll::-webkit-scrollbar{width:10px}
.tgm-scroll::-webkit-scrollbar-track{background:transparent}
.tgm-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);border:3px solid transparent;background-clip:padding-box;border-radius:999px}
.tgm-scroll::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 34%,transparent);border:3px solid transparent;background-clip:padding-box}
.tgm-banner{display:flex;align-items:flex-start;gap:9px;border:var(--tgm-hair);border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.tgm-banner[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,var(--dsw-alias-border-l2))}
.tgm-banner[data-tone="error"]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,var(--dsw-alias-border-l2))}
.tgm-banner[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l2))}
.tgm-banner-text{flex:1;min-width:0;overflow-wrap:anywhere}
.tgm-retry{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;padding:0 2px;white-space:nowrap}
.tgm-summary{display:flex;flex-direction:column;gap:14px;min-width:0}
.tgm-hero{position:relative;container-type:inline-size;overflow:hidden;border:var(--tgm-hair);border-radius:16px;padding:20px 20px 22px;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1) 62%);display:flex;flex-direction:column;gap:10px}
.tgm-hero-label{font-family:var(--tgm-mono);font-size:10.5px;line-height:16px;text-transform:uppercase;letter-spacing:.09em;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px}
.tgm-hero-value{font-family:var(--tgm-display);font-size:40px;font-size:clamp(32px,12.4cqi,44px);line-height:1.12;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-success-primary);width:auto;max-width:100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-hero-value[data-negative="true"]{color:var(--dsw-alias-state-error-primary)}
.tgm-hero-value[data-muted="true"]{font-size:22px;line-height:32px;font-weight:600;color:var(--dsw-alias-label-secondary);white-space:normal}
.tgm-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tgm-kpi{border:var(--tgm-hair);border-radius:12px;padding:14px 15px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.tgm-kpi-value{font-family:var(--tgm-display);font-size:24px;line-height:32px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-kpi-label{font-family:var(--tgm-mono);font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-section{display:flex;flex-direction:column;gap:16px;min-width:0}
.tgm-section-head{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap;padding-bottom:10px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.tgm-section-head h2{margin:0;font-family:var(--tgm-display);font-size:18.5px;line-height:26px;font-weight:700;letter-spacing:-.005em;color:var(--dsw-alias-label-primary);white-space:nowrap}
.tgm-section-action{margin-left:auto;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:11.5px;line-height:16px;padding:0 2px;cursor:pointer;white-space:nowrap}
.tgm-section-action:hover{text-decoration:underline;text-underline-offset:2px}
.tgm-tiers{display:flex;flex-direction:column;gap:12px}
.tgm-tier{position:relative;border:var(--tgm-hair);border-radius:14px;padding:16px 16px 15px;background:var(--dsw-alias-bg-layer-1);display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"top top" "model cost" "meta cost" "meter meter" "tokens save";gap:8px 16px;min-width:0;overflow:hidden}
.tgm-tier:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--tgm-accent,var(--dsw-alias-brand-primary));opacity:.85}
.tgm-tier[data-tier="opus"]{--tgm-accent:var(--dsw-alias-brand-primary)}
.tgm-tier[data-tier="sonnet"]{--tgm-accent:var(--dsw-alias-state-success-primary)}
.tgm-tier[data-tier="haiku"]{--tgm-accent:var(--dsw-alias-state-warn-primary)}
.tgm-tier[data-tier="unknown"]{--tgm-accent:var(--dsw-alias-state-idle-primary)}
.tgm-tier-top{grid-area:top;display:flex;align-items:center;gap:8px;min-width:0}
.tgm-dot{width:8px;height:8px;border-radius:50%;background:var(--tgm-accent,var(--dsw-alias-brand-primary));flex:none}
.tgm-tier-name{font-size:15px;line-height:22px;font-weight:650;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-tier-share{margin-left:auto;font-family:var(--tgm-mono);font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none}
.tgm-tier-model{grid-area:model;font-family:var(--tgm-mono);font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:18px}
.tgm-tier-cost{grid-area:cost;align-self:center;max-width:160px;text-align:right;font-family:var(--tgm-display);font-size:23px;line-height:31px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-tier-meta{grid-area:meta;font-family:var(--tgm-mono);font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-meter{grid-area:meter;height:9px;border-radius:99px;background:color-mix(in srgb,var(--tgm-accent,var(--dsw-alias-brand-primary)) 15%,transparent);overflow:hidden;margin-top:10px}
.tgm-meter span{display:block;height:100%;border-radius:99px;background:var(--tgm-accent,var(--dsw-alias-brand-primary));transition:width .45s ease}
.tgm-tier-tokens{grid-area:tokens;display:flex;gap:6px 12px;flex-wrap:wrap;font-family:var(--tgm-mono);font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);min-width:0}
.tgm-tier-tokens span{white-space:nowrap}
.tgm-tier-save{grid-area:save;max-width:52%;text-align:right;font-family:var(--tgm-mono);font-size:11.5px;line-height:17px;color:var(--dsw-alias-state-success-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-tier-save[data-negative="true"]{color:var(--dsw-alias-state-warn-primary)}
.tgm-list{display:flex;flex-direction:column;border:var(--tgm-hair);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.tgm-row{display:flex;align-items:center;gap:12px;padding:12px 14px;min-width:0;border-top:0.5px solid var(--dsw-alias-border-l1)}
.tgm-row:first-child{border-top:0}
.tgm-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}
.tgm-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.tgm-row-title{font-size:13.5px;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.tgm-row-sub{display:flex;align-items:center;gap:8px;font-family:var(--tgm-mono);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.tgm-row-cost{flex:none;text-align:right;display:flex;flex-direction:column;gap:3px;font-variant-numeric:tabular-nums}
.tgm-row-cost b{font-size:13.5px;line-height:19px;font-weight:650;white-space:nowrap}
.tgm-row-cost span{font-family:var(--tgm-mono);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tgm-call-wrap{min-width:0;border-top:0.5px solid var(--dsw-alias-border-l1)}
.tgm-call-wrap:first-child{border-top:0}
.tgm-call{display:flex;align-items:center;gap:10px;padding:11px 14px;min-width:0;cursor:pointer}
.tgm-call-wrap:hover .tgm-call{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}
.tgm-call-wrap[data-open="true"] .tgm-call{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}
.tgm-call:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:7px}
.tgm-route-preview{font-size:13.5px;line-height:19px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tgm-route-toggle{flex:none;width:18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:17px}
.tgm-call-wrap[data-open="true"] .tgm-route-toggle{color:var(--dsw-alias-brand-primary)}
.tgm-judge-panel{display:flex;flex-direction:column;gap:5px;padding:11px 14px 14px;background:var(--dsw-alias-bg-layer-2);border-top:0.5px dashed var(--dsw-alias-border-l2);font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.tgm-judge-head{font-size:12px;line-height:18px;font-weight:650;color:var(--dsw-alias-label-primary);margin-bottom:2px}
.tgm-judge-row{display:flex;align-items:flex-start;gap:10px;min-width:0}
.tgm-judge-key{flex:none;width:76px;font-family:var(--tgm-mono);font-size:10.5px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:normal;overflow-wrap:anywhere}
.tgm-judge-value{flex:1;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
.tgm-trail{align-items:flex-start}
.tgm-trail-list{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.tgm-trail-item{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.tgm-trail-item[data-source="stage"],.tgm-trail-item[data-source="stage-escalate"]{color:var(--dsw-alias-state-warning-primary)}
.tgm-trail-item[data-source="call"]{color:var(--dsw-alias-brand-primary)}
.tgm-trail-item[data-source="fallback"]{color:var(--dsw-alias-state-danger-primary)}
.tgm-delegate-row[data-fallback="true"]{opacity:.75}
.tgm-call-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.tgm-call-meta{font-family:var(--tgm-mono);font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-route-confidence{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:46px;text-align:right}
.tgm-route-confidence b{font-size:12.5px;line-height:17px;font-weight:650;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}
.tgm-route-confidence span{font-family:var(--tgm-mono);font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tgm-chip{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:46px;padding:3px 8px;border-radius:7px;font-size:11.5px;line-height:18px;font-weight:650;letter-spacing:.01em;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--tgm-accent,var(--dsw-alias-brand-primary)) 13%,transparent)}
.tgm-chip[data-tier="opus"]{--tgm-accent:var(--dsw-alias-brand-primary)}
.tgm-chip[data-tier="sonnet"]{--tgm-accent:var(--dsw-alias-state-success-primary)}
.tgm-chip[data-tier="haiku"]{--tgm-accent:var(--dsw-alias-state-warn-primary)}
.tgm-chip[data-tier="unknown"]{--tgm-accent:var(--dsw-alias-state-idle-primary)}
.tgm-dots{display:inline-flex;gap:4px;align-items:center;flex:none}
.tgm-dots i{width:6px;height:6px;border-radius:50%;background:var(--tgm-accent,var(--dsw-alias-brand-primary));display:block}
.tgm-mode{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);flex:none}
.tgm-mode .tgm-chipbtn{line-height:19px;padding:2px 9px;font-size:11.5px}
.tgm-mode .tgm-chipbtn:disabled{opacity:.5;cursor:default}
.tgm-mode .tgm-chipbtn:disabled:hover{color:var(--dsw-alias-label-secondary)}
.tgm-price-notice{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.tgm-price-notice[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.tgm-price-notice[data-tone="bad"]{color:var(--dsw-alias-state-error-primary)}
.tgm-copy{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:11.5px;line-height:16px;padding:0 2px;cursor:pointer;white-space:nowrap}
.tgm-price-panel{display:flex;flex-direction:column;gap:14px;border:var(--tgm-hair);border-radius:12px;padding:15px 16px 16px;background:var(--dsw-alias-bg-layer-1)}
.tgm-price-modes{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
.tgm-price-modes-label{font-family:var(--tgm-mono);font-size:10px;line-height:16px;text-transform:uppercase;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tgm-price-note{margin:0;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.tgm-price-toggle{margin-left:auto;border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:22px;padding:0 9px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:color .15s ease,border-color .15s ease,background .15s ease}
.tgm-price-toggle:hover{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l2))}
.tgm-price-toggle[data-open="true"]{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
.tgm-price-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tgm-price-row{display:grid;grid-template-columns:64px repeat(3,minmax(0,1fr));gap:8px;align-items:end;min-width:0}
.tgm-price-name{font-size:12.5px;line-height:19px;font-weight:650;padding-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-price-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.tgm-price-field span{font-family:var(--tgm-mono);font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.03em;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tgm-price-input{box-sizing:border-box;width:100%;height:34px;padding:0 8px;font:inherit;font-size:13.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;min-width:0}
.tgm-price-input:disabled{opacity:.5}
.tgm-price-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.tgm-button{border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:30px;padding:0 13px;border-radius:8px;cursor:pointer;white-space:nowrap}
.tgm-button:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.tgm-button[data-primary="true"]{background:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-brand-primary,#3b82f6);color:#fff}
.tgm-button[data-primary="true"]:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-brand-primary,#3b82f6);color:#fff;filter:brightness(.9)}
.tgm-button:disabled{opacity:.45;cursor:default}
.tgm-notice{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}
.tgm-notice[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.tgm-notice[data-tone="bad"]{color:var(--dsw-alias-state-error-primary)}
.tgm-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:36px 18px;border:0.5px dashed var(--dsw-alias-border-l2);border-radius:14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.tgm-empty-mark{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.tgm-open{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.tgm-open:hover{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
@media (max-width:380px){.tgm-top{padding-left:12px;padding-right:12px}.tgm-scroll{padding-left:12px;padding-right:12px;gap:22px}.tgm-tier{padding:13px 13px 12px;gap:7px 12px}.tgm-tier-cost{font-size:20px;line-height:27px;max-width:120px}.tgm-hero{padding:17px 15px 19px}.tgm-kpi{padding:12px 12px}.tgm-kpi-value{font-size:21px;line-height:28px}.tgm-price-panel{padding:13px 13px 14px}}
@media (max-width:340px){.tgm-kpis{grid-template-columns:1fr 1fr}}
@media (prefers-reduced-motion:reduce){.tgm-meter span{transition:none}.tgm-live i{animation:none}}
`;
		//#endregion

		//#region helpers
		function money(value, currency) {
			if (value === null || value === undefined || !Number.isFinite(value)) return "—";
			const magnitude = Math.abs(value);
			const digits = magnitude === 0 ? 2 : magnitude >= 1 ? 2 : magnitude >= 0.01 ? 3 : magnitude >= 0.0001 ? 4 : 6;
			try {
				return new Intl.NumberFormat(undefined, {
					style: "currency",
					currency: currency || "USD",
					minimumFractionDigits: digits,
					maximumFractionDigits: digits,
				}).format(value);
			} catch {
				return `${value.toFixed(digits)} ${currency || "USD"}`;
			}
		}

		function compact(value) {
			const number = Number(value) || 0;
			if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
			if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1)}k`;
			return String(Math.round(number));
		}

		function percent(value, digits = 1) {
			if (!Number.isFinite(value)) return "—";
			return `${(value * 100).toFixed(digits)}%`;
		}

		function shortSession(id) {
			if (!id || id === "unknown") return "—";
			return id.length > 15 ? `${id.slice(0, 9)}…${id.slice(-4)}` : id;
		}

		function timeAgo(timestamp) {
			const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
			const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
			if (seconds < 60) return formatter.format(-seconds, "second");
			const minutes = Math.round(seconds / 60);
			if (minutes < 60) return formatter.format(-minutes, "minute");
			const hours = Math.round(minutes / 60);
			if (hours < 24) return formatter.format(-hours, "hour");
			return formatter.format(-Math.round(hours / 24), "day");
		}

		function clock(timestamp) {
			try {
				return new Date(timestamp).toLocaleTimeString(undefined, {
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
					hour12: false,
				});
			} catch {
				return "";
			}
		}

		function tierName(tier, t) {
			return tier === null || tier === undefined ? t("tier.unknown") : t(`tier.${tier}`);
		}

		/**
		 * Boundary ids arrive as "tool-calls:8" / "char-growth:105327"; the label
		 * is the prefix, the tail is shown as a count.
		 */
		function boundaryLabel(boundary, t) {
			if (typeof boundary !== "string" || boundary === "") return null;
			const [kind, amount] = boundary.split(":");
			const label = t(`boundary.${kind === "tool-calls" ? "tool-calls" : kind === "char-growth" ? "char-growth" : kind}`);
			const text = label && label !== `boundary.${kind}` ? label : kind;
			return amount ? `${text} ${Number(amount).toLocaleString()}` : text;
		}

		/**
		 * The whole judgment trail of one turn: each entry is one judge call, so a
		 * stage/call-granularity turn shows every re-judgment, not just the last.
		 */
		function JudgmentTrail({ judgments, t }) {
			if (!Array.isArray(judgments) || judgments.length === 0) return null;
			return h("div", { className: "tgm-judge-row tgm-trail" },
				h("span", { className: "tgm-judge-key" }, t("judgeTrail")),
				h("div", { className: "tgm-trail-list" }, judgments.map((judgment, index) => {
					const boundary = boundaryLabel(judgment.boundary, t);
					const sourceLabel = judgment.source ? t(`source.${judgment.source}`) : "—";
					const parts = [`${index + 1}. ${sourceLabel}`];
					if (judgment.tier) parts.push(tierName(judgment.tier, t));
					if (boundary) parts.push(`${t("judgeBoundary")}: ${boundary}`);
					if (Number.isFinite(judgment.confidence)) parts.push(percent(judgment.confidence));
					if (Number.isFinite(judgment.judgeMs)) parts.push(`${(judgment.judgeMs / 1000).toFixed(1)}s`);
					return h("div", {
						className: "tgm-trail-item",
						key: `${judgment.at ?? index}-${index}`,
						"data-source": judgment.source ?? "unknown",
					}, parts.join(" · "));
				})));
		}

		/** Delegation-time judgments (route_tier), each with the task it judged. */
		function DelegationList({ rows, t }) {
			if (!Array.isArray(rows) || rows.length === 0) return null;
			return h("section", { className: "tgm-section" },
				h("div", { className: "tgm-section-head" },
					h("h2", null, t("delegations")),
					h("span", null, rows.length > 0 ? clock(rows[0].at) : "")),
				h("div", { className: "tgm-list" }, rows.slice(0, 6).map((row, index) => {
					const meta = [
						clock(row.at),
					`${row.provider ? `${row.provider}/` : ""}${row.model ?? "—"}`,
						row.source ? t(`source.${row.source}`) : null,
						row.fallback ? t("delegateFallback") : null,
					].filter(Boolean).join(" · ");
					return h("div", {
						className: "tgm-call tgm-delegate-row",
						key: `${row.at ?? index}-${index}`,
						"data-fallback": row.fallback ? "true" : "false",
					},
					h(TierChip, { tier: row.tier, t }),
					h("div", { className: "tgm-call-main" },
						h("div", { className: "tgm-route-preview" }, row.task || t("delegateTask")),
						h("div", { className: "tgm-call-meta" }, meta)));
				})));
		}

		function tierColor(tier) {
			if (tier === "opus") return "var(--dsw-alias-brand-primary)";
			if (tier === "sonnet") return "var(--dsw-alias-state-success-primary)";
			if (tier === "haiku") return "var(--dsw-alias-state-warn-primary)";
			return "var(--dsw-alias-state-idle-primary)";
		}

		function modelLabel(gateway, tier) {
			const mapping = gateway?.tiers?.[tier];
			if (!mapping) return null;
			return mapping.provider ? `${mapping.provider}/${mapping.model}` : mapping.model;
		}

		function useSnapshot(range, tick) {
			const [state, setState] = React.useState({ data: null, error: null, loading: true });
			React.useEffect(() => {
				let alive = true;
				let inFlight = false;
				let controller = null;
				const load = async () => {
					if (inFlight || (typeof document !== "undefined" && document.hidden)) return;
					inFlight = true;
					controller = new AbortController();
					try {
						const response = await fetch(`${SNAPSHOT_URL}?range=${encodeURIComponent(range)}`, {
							method: "GET",
							headers: { accept: "application/json" },
							cache: "no-store",
							signal: controller.signal,
						});
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						const payload = await response.json();
						if (payload?.ok !== true) throw new Error(String(payload?.error ?? "snapshot unavailable"));
						if (alive) setState({ data: payload, error: null, loading: false });
					} catch (error) {
						if (!alive || error?.name === "AbortError") return;
						setState((previous) => ({
							data: previous.data,
							error: error instanceof Error ? error : new Error(String(error)),
							loading: false,
						}));
					} finally {
						inFlight = false;
					}
				};
				setState((previous) => ({ ...previous, loading: previous.data === null }));
				load();
				const timer = setInterval(load, 2000);
				return () => {
					alive = false;
					clearInterval(timer);
					controller?.abort();
				};
			}, [range, tick]);
			return state;
		}

		function useFormSnapshot(form) {
			const [snapshot, setSnapshot] = React.useState(() => (form ? form.getSnapshot() : null));
			React.useEffect(() => {
				if (!form) return undefined;
				setSnapshot(form.getSnapshot());
				return form.subscribe(() => setSnapshot(form.getSnapshot()));
			}, [form]);
			return snapshot;
		}
		//#endregion

		//#region icons
		function MonitorIcon({ size = 16, strokeWidth = 1.7, className, style }) {
			return h("svg", {
				viewBox: "0 0 24 24",
				className,
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				style: { display: "block", flex: "none", ...style },
			},
			h("path", { d: "M4 19.5V5.5" }),
			h("path", { d: "M4 19.5h16" }),
			h("path", { d: "M7.2 16v-3.4" }),
			h("path", { d: "M12 16V9.2" }),
			h("path", { d: "M16.8 16V6.9" }),
			h("path", { d: "M7.2 10.4 12 7.2l4.8-2.7" }),
			h("circle", { cx: 16.8, cy: 4.5, r: 1.1, fill: "currentColor", stroke: "none" }));
		}

		function ConfigIcon({ size = 15 }) {
			return h("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				style: { display: "block" },
			},
			h("path", { d: "M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" }),
			h("path", { d: "M14 3v5h5" }),
			h("path", { d: "M8.5 13h7" }),
			h("path", { d: "M8.5 16.5h4.5" }));
		}

		function RefreshIcon({ size = 14 }) {
			return h("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.8,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				style: { display: "block" },
			},
			h("path", { d: "M20 7v5h-5" }),
			h("path", { d: "M4 17v-5h5" }),
			h("path", { d: "M6.1 9.2A7 7 0 0 1 18.6 7" }),
			h("path", { d: "M17.9 14.8A7 7 0 0 1 5.4 17" }));
		}
		//#endregion

		//#region atoms
		function RangeTabs({ range, onChange, t }) {
			return h("div", { className: "tgm-ranges", role: "tablist", "aria-label": t("rangeLabel") },
				RANGES.map((value) => h("button", {
					key: value,
					type: "button",
					role: "tab",
					className: "tgm-chipbtn",
					"aria-selected": range === value,
					"data-active": range === value,
					onClick: () => onChange(value),
				}, t(`range.${value}`))));
		}

		function Kpi({ label, value }) {
			return h("div", { className: "tgm-kpi" },
				h("div", { className: "tgm-kpi-value", title: value }, value),
				h("div", { className: "tgm-kpi-label" }, label));
		}

		function TierChip({ tier, t }) {
			return h("span", { className: "tgm-chip", "data-tier": tier ?? "unknown" }, tierName(tier, t));
		}

		function Banner({ tone = "info", children, action }) {
			return h("div", { className: "tgm-banner", "data-tone": tone, role: tone === "error" ? "alert" : "status" },
				h("span", { className: "tgm-banner-text" }, children),
				action ?? null);
		}

		function EmptyState({ t }) {
			return h("div", { className: "tgm-empty" },
				h("div", { className: "tgm-empty-mark" }, h(MonitorIcon, { size: 20 })),
				h("span", null, t("empty")));
		}
		//#endregion

		//#region tier cards
		function TierCard({ row, gateway, t, currency }) {
			const label = tierName(row.tier, t);
			const top = Array.isArray(row.models) && row.models.length > 0 ? row.models[0] : null;
			const mapped = row.tier === "unknown" ? null : modelLabel(gateway, row.tier);
			const model = top
				? `${top.provider ? `${top.provider}/` : ""}${top.model}`
				: mapped ?? (row.tier === "unknown" ? t("unknownTier") : null);
			const modelExtra = Array.isArray(row.models) && row.models.length > 1 ? ` +${row.models.length - 1}` : "";
			const hasCost = row.pricedRequests > 0;
			const hasSavings = row.comparableRequests > 0;
			return h("div", { className: "tgm-tier", "data-tier": row.tier, "data-tgm-tier": row.tier },
				h("div", { className: "tgm-tier-top" },
					h("span", { className: "tgm-dot" }),
					h("span", { className: "tgm-tier-name", title: label }, label),
					h("span", { className: "tgm-tier-share", title: t("share") }, percent(row.share))),
				h("div", { className: "tgm-tier-model", title: `${model ?? ""}${modelExtra}` }, `${model ?? t("noModel")}${modelExtra}`),
				h("div", { className: "tgm-tier-cost", title: hasCost ? money(row.cost, currency) : t("noPrice") },
					hasCost ? money(row.cost, currency) : "—"),
				h("div", { className: "tgm-tier-meta" }, t("calls", { n: row.requests })),
				h("div", { className: "tgm-meter" }, h("span", { style: { width: `${Math.max(0, Math.min(1, row.share)) * 100}%` } })),
				h("div", { className: "tgm-tier-tokens" },
					h("span", { title: `${t("input")}: ${row.inputTokens}` }, `↑${compact(row.inputTokens)}`),
					h("span", { title: `${t("output")}: ${row.outputTokens}` }, `↓${compact(row.outputTokens)}`),
					h("span", { title: `${t("cacheRead")}: ${row.cacheReadTokens}` }, `⚡${compact(row.cacheReadTokens)}`)),
				h("div", {
					className: "tgm-tier-save",
					"data-negative": hasSavings && row.savings < 0,
					title: hasSavings ? `${t("savings")} ${money(row.savings, currency)}` : t("noPrice"),
				}, hasSavings
					? `${t("savingShort")} ${money(row.savings, currency)}`
					: t("noPrice")));
		}
		//#endregion

		//#region sessions + recent
		function SessionRowView({ row, t, currency, title }) {
			const tiers = Object.entries(row.tiers ?? {}).sort((left, right) => right[1] - left[1]);
			const display = typeof title === "string" && title.trim() !== "" ? title : shortSession(row.sessionId);
			return h("div", { className: "tgm-row" },
				h("div", { className: "tgm-row-main" },
					h("div", { className: "tgm-row-title", title: row.sessionId }, display),
					h("div", { className: "tgm-row-sub" },
						h("span", null, t("calls", { n: row.requests })),
						tiers.length > 0 ? h("span", { className: "tgm-dots" }, tiers.map(([tier, count]) => h("i", {
							key: tier,
							title: `${tierName(tier, t)}: ${count}`,
							style: { background: tierColor(tier) },
						}))) : null,
						h("span", null, timeAgo(row.lastAt ?? Date.now())))),
				h("div", { className: "tgm-row-cost" },
					h("b", null, row.pricedRequests > 0 ? money(row.cost, currency) : "—"),
					h("span", null, row.comparableRequests > 0 ? `${percent(row.savingsRate)} ${t("savingShort")}` : t("noPrice"))));
		}

		function SessionRowWithTitle(props) {
			const title = props.useSessions((sessions) => sessions.byId[props.row.sessionId]?.title);
			return h(SessionRowView, { ...props, title });
		}

		function SessionRow(props) {
			return props.useSessions
				? h(SessionRowWithTitle, props)
				: h(SessionRowView, props);
		}

		function RecentRoute({ row, t, currency }) {
			const [open, setOpen] = React.useState(false);
			const model = row.model ? `${row.provider ? `${row.provider}/` : ""}${row.model}` : (row.requestedModel || t("noModel"));
			const preview = typeof row.preview === "string" && row.preview.trim() !== "" ? row.preview.trim() : t("previewUnavailable");
			const meta = `${clock(row.lastAt || row.at)} · ${t("calls", { n: row.requests ?? 1 })}${model ? ` · ${model}` : ""}`;
			const judge = row.judge;
			const confidence = judge && judge.source !== "fallback" ? judge.confidence : null;
			// Confidence belongs to the tier the judge chose. After a deterministic
			// escalation that is the pre-escalation tier, not the served tier.
			const confidenceTier = judge?.escalatedFrom ?? judge?.judgedTier ?? row.tier;
			const judgeModel = judge?.judgeModel ?? null;
			const judgeFamily = judge?.judgeFamily ?? null;
			const details = [];
			details.push([t("preview"), preview]);
			details.push([t("judgeModel"), `${judgeModel ?? "—"}${judgeFamily ? ` (${judgeFamily})` : ""}`]);
			details.push([t("selectedTier"), tierName(row.tier, t)]);
			details.push([t("judgeReason"), judge?.reason ?? "—"]);
			details.push([t("judgeSource"), judge?.source ? t(`source.${judge.source}`) : "—"]);
			if (confidence !== null && confidence !== undefined) details.push([t("judgeConfidence"), `${percent(confidence)} · ${tierName(confidenceTier, t)}`]);
			const probabilities = judge?.probabilities;
			if (probabilities && typeof probabilities === "object") {
				const probabilityText = TIERS
					.map((tier) => `${tierName(tier, t)} ${Number.isFinite(Number(probabilities[tier])) ? percent(Number(probabilities[tier])) : "—"}`)
					.join(" · ");
				details.push([t("judgeProbabilities"), probabilityText]);
			}
			if (Number.isFinite(Number(judge?.margin))) details.push([t("judgeMargin"), percent(Number(judge.margin))]);
			if (judge?.escalatedFrom) details.push([t("judgeEscalatedFrom"), tierName(judge.escalatedFrom, t)]);
			else if (judge?.judgedTier) details.push([t("judgeTier"), tierName(judge.judgedTier, t)]);
			if (judge?.escalationReason) details.push([t("judgeEscalation"), judge.escalationReason]);
			if (judge?.heldTo) details.push([t("judgeHeld"), tierName(judge.heldTo, t)]);
			if (judge?.heldBy) details.push([t("judgeHeldBy"), t(`heldBy.${judge.heldBy}`)]);
			if (judge?.turn) details.push([t("judgeTurn"), judge.turn]);
			if (Number.isFinite(judge?.judgeMs)) details.push([t("judgeMs"), `${(judge.judgeMs / 1000).toFixed(1)}s`]);
			if (row.boundary) details.push([t("judgeBoundary"), boundaryLabel(row.boundary, t) ?? row.boundary]);
			if (Number.isFinite(row.rejudges) && row.rejudges > 0) details.push([t("judgeRejudges"), String(row.rejudges)]);
			if (row.perCall === true) details.push([t("judgePerCall"), "✓"]);
			details.push([t("callsCount"), String(row.requests ?? 1)]);
			if (row.usage) details.push([t("tokensLabel"), `↑${compact(row.usage.inputTokens)} ↓${compact(row.usage.outputTokens)} ⚡${compact(row.usage.cacheReadTokens)}`]);
			details.push([t("cost"), row.cost === null ? "—" : money(row.cost, currency)]);
			return h("div", {
				className: "tgm-call-wrap",
				"data-judge": judge ? "true" : "false",
				"data-open": open ? "true" : "false",
			},
			h("div", {
				className: "tgm-call",
				role: "button",
				tabIndex: 0,
				"aria-expanded": open,
				onClick: () => setOpen((value) => !value),
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						setOpen((value) => !value);
					}
				},
			},
				h(TierChip, { tier: row.tier, t }),
				h("div", { className: "tgm-call-main" },
					h("div", { className: "tgm-route-preview" }, preview),
					h("div", { className: "tgm-call-meta" }, meta)),
				h("div", { className: "tgm-route-confidence" },
					h("b", null, confidence !== null && confidence !== undefined ? percent(confidence) : "—"),
					h("span", null, t("judgeConfidenceFor", { tier: tierName(confidenceTier, t) }))),
				h("span", { className: "tgm-route-toggle", "aria-hidden": "true" }, open ? "−" : "+")),
			open ? h("div", { className: "tgm-judge-panel", role: "region" },
				h("div", { className: "tgm-judge-head" }, t("judgeTitle")),
				details.map(([label, value]) => h("div", { className: "tgm-judge-row", key: label },
					h("span", { className: "tgm-judge-key" }, label),
					h("span", { className: "tgm-judge-value" }, value))),
				h(JudgmentTrail, { judgments: row.judgments, t })) : null);
		}
		//#endregion

		//#region price editor
		function toDraft(prices) {
			const source = prices ?? {};
			const draft = {};
			for (const tier of TIERS) {
				draft[tier] = {};
				for (const field of FIELDS) {
					const value = source?.[tier]?.[field];
					draft[tier][field] = Number.isFinite(Number(value)) ? String(Number(value)) : "0";
				}
			}
			return draft;
		}

		function hasManualPrices(prices) {
			return TIERS.some((tier) => FIELDS.some((field) => Number(prices?.[tier]?.[field]) > 0));
		}

		function PricePanel({ form, prices, manualPrices, autoPrices, onSetAuto, togglingAuto, autoNotice, onSaved, t }) {
			const formSnapshot = useFormSnapshot(form);
			const manual = formSnapshot?.value?.prices ?? manualPrices ?? {};
			const automatic = (formSnapshot?.value?.autoPrices ?? autoPrices) !== false;
			const current = automatic ? (prices ?? {}) : manual;
			const writable = form !== null && formSnapshot?.writable === true;
			const [draft, setDraft] = React.useState(null);
			const [saving, setSaving] = React.useState(false);
			const [notice, setNotice] = React.useState(null);
			const base = toDraft(current);
			const value = draft ?? base;
			const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(base);
			const busy = togglingAuto === true || saving || !writable;
			React.useEffect(() => {
				if (!automatic) return;
				setDraft(null);
				setNotice(null);
			}, [automatic]);
			const switchMode = (next) => {
				if (busy || next === automatic) return;
				setNotice(null);
				onSetAuto?.(next);
			};
			const update = (tier, field, next) => {
				setNotice(null);
				setDraft((previous) => {
					const buffer = previous ?? toDraft(current);
					return { ...buffer, [tier]: { ...buffer[tier], [field]: next } };
				});
			};
			const reset = () => {
				setDraft(null);
				setNotice(null);
			};
			const save = async () => {
				if (!form || saving) return;
				const normalized = {};
				const ops = [];
				for (const tier of TIERS) {
					normalized[tier] = {};
					for (const field of FIELDS) {
						const raw = value[tier][field];
						const number = Number(raw);
						if (String(raw).trim() === "" || !Number.isFinite(number) || number < 0) {
							setNotice({ tone: "bad", text: t("invalid") });
							return;
						}
						normalized[tier][field] = String(number);
						ops.push({ op: "set", path: ["prices", tier, field], value: number });
					}
				}
				// Saving an edited price is an explicit manual override: flip the
				// mode in the same write so the value just entered stays effective.
				ops.push({ op: "set", path: ["autoPrices"], value: false });
				setSaving(true);
				setNotice(null);
				try {
					const landed = await form.mutate(ops);
					if (!landed) {
						setNotice({ tone: "bad", text: t("saveFailed") });
						return;
					}
					setDraft(normalized);
					setNotice({ tone: "ok", text: t("saved") });
					onSaved?.();
				} catch (error) {
					setNotice({ tone: "bad", text: String(error?.message ?? error) });
				} finally {
					setSaving(false);
				}
			};
			const shownNotice = notice ?? autoNotice ?? null;
			return h("div", { className: "tgm-price-panel" },
				h("div", { className: "tgm-price-modes" },
					h("span", { className: "tgm-price-modes-label" }, t("priceMode")),
					h("div", { className: "tgm-mode", role: "group", "aria-label": t("priceMode") },
						h("button", {
							type: "button",
							className: "tgm-chipbtn",
							"data-active": automatic,
							"aria-pressed": automatic,
							disabled: busy,
							onClick: () => switchMode(true),
						}, t("autoPricesLabel")),
						h("button", {
							type: "button",
							className: "tgm-chipbtn",
							"data-active": !automatic,
							"aria-pressed": !automatic,
							disabled: busy,
							onClick: () => switchMode(false),
						}, t("manualPricesLabel")))),
				shownNotice ? h("div", { className: "tgm-price-notice", "data-tone": shownNotice.tone, role: "status" }, shownNotice.text) : null,
				automatic
					? h("p", { className: "tgm-price-note" }, t("priceAutoNote"))
					: h(Fragment, null,
						h("p", { className: "tgm-price-note" }, t("priceManualNote")),
						TIERS.map((tier) => h("div", { className: "tgm-price-row", key: tier },
							h("div", { className: "tgm-price-name" }, tierName(tier, t)),
							FIELDS.map((field) => h("label", { className: "tgm-price-field", key: field },
								h("span", null, t(field)),
								h("input", {
									className: "tgm-price-input",
									type: "number",
									inputMode: "decimal",
									min: "0",
									step: "any",
									"aria-label": `${tierName(tier, t)} ${t(field)}`,
									value: value[tier][field],
									disabled: !writable || saving,
									onChange: (event) => update(tier, field, event.target.value),
								}))))),
						h("div", { className: "tgm-price-actions" },
							h("button", {
								type: "button",
								className: "tgm-button",
								"data-primary": "true",
								disabled: !writable || saving,
								onClick: save,
							}, saving ? t("saving") : t("save")),
							dirty ? h("button", {
								type: "button",
								className: "tgm-button",
								disabled: saving,
								onClick: reset,
							}, t("discard")) : null,
							!form ? h("span", { className: "tgm-notice" }, t("noForm")) : null,
							form && formSnapshot && !writable ? h("span", { className: "tgm-notice" }, t("readonly")) : null)));
		}
		//#endregion

		//#region monitor body
		function MonitorBody(props) {
			const { t, form, useSessions } = props;
			const [range, setRange] = React.useState("all");
			const [tick, setTick] = React.useState(0);
			const { data, error, loading } = useSnapshot(range, tick);
			const [openingConfig, setOpeningConfig] = React.useState(false);
			const [configNotice, setConfigNotice] = React.useState(null);
			const [showAllSessions, setShowAllSessions] = React.useState(false);
			const [showAllRecent, setShowAllRecent] = React.useState(false);
			const [togglingAuto, setTogglingAuto] = React.useState(false);
			const [autoNotice, setAutoNotice] = React.useState(null);
			const [priceOpen, setPriceOpen] = React.useState(false);
			React.useEffect(() => {
				setShowAllSessions(false);
				setShowAllRecent(false);
			}, [range]);
			const openConfig = React.useCallback(async () => {
				if (openingConfig) return;
				setOpeningConfig(true);
				setConfigNotice(null);
				try {
					const response = await fetch("/model-route-monitor/open-config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: "{}",
					});
					const payload = await response.json();
					if (payload?.ok !== true) throw new Error(String(payload?.error ?? `HTTP ${response.status}`));
					let tone = payload.opened === true ? "ok" : "warn";
					let text = payload.opened === true ? t("configOpened") : t("configOpenFailed");
					if (payload.templateError) {
						tone = "warn";
						text = `${text} · ${t("configTemplateFailed")}: ${payload.templateError}`;
					}
					setConfigNotice({ tone, text });
				} catch (openError) {
					setConfigNotice({
						tone: "error",
						text: `${t("configOpenFailed")} ${openError instanceof Error ? openError.message : String(openError)}`,
					});
				} finally {
					setOpeningConfig(false);
				}
			}, [openingConfig, t]);

			const setAutoMode = React.useCallback(async (next) => {
				if (!form) {
					setAutoNotice({ tone: "bad", text: t("noForm") });
					return;
				}
				setTogglingAuto(true);
				setAutoNotice(null);
				try {
					const ops = [{ op: "set", path: ["autoPrices"], value: next }];
					// Manual prices are the user's own values and stay in the config across
					// an Auto round-trip. Only a manual set that was never filled in gets
					// seeded from the auto-resolved prices so the form does not open on zeros.
					if (!next && data?.autoPrices !== false && data?.prices && !hasManualPrices(data?.manualPrices)) {
						for (const tier of TIERS) {
							for (const field of FIELDS) {
								const value = Number(data.prices?.[tier]?.[field]);
								if (Number.isFinite(value) && value >= 0) ops.push({ op: "set", path: ["prices", tier, field], value });
							}
						}
					}
					const landed = await form.mutate(ops);
					if (!landed) throw new Error(t("saveFailed"));
					setAutoNotice(null);
					setTick((value) => value + 1);
				} catch (error) {
					setAutoNotice({
						tone: "bad",
						text: `${t("autoToggleFailed")}: ${error instanceof Error ? error.message : String(error)}`,
					});
				} finally {
					setTogglingAuto(false);
				}
			}, [data?.autoPrices, data?.prices, form, t]);

			const totals = data?.totals;
			const sessions = data?.sessions ?? [];
			const tiers = data?.tiers ?? [];
			const recent = (data?.recent ?? [])
			.slice(0, 12)
			.slice()
			.sort((left, right) => (right.lastAt ?? right.at ?? 0) - (left.lastAt ?? left.at ?? 0));
			const delegations = data?.delegations ?? [];
			const visibleSessions = sessions.slice(0, showAllSessions ? 12 : 4);
			const visibleRecent = recent.slice(0, showAllRecent ? 12 : 6);
			const priced = totals?.comparableRequests > 0 && (totals?.comparableOpusCost ?? 0) > 0;
			const comparable = totals?.requests > 0 && totals.comparableRequests < totals.requests;
			const savings = Number.isFinite(totals?.savings)
				? totals.savings
				: (totals?.comparableOpusCost ?? 0) - (totals?.comparableCost ?? 0);
			const savingsRate = priced
				? (Number.isFinite(totals?.savingsRate)
					? totals.savingsRate
					: (totals.comparableOpusCost > 0 ? savings / totals.comparableOpusCost : 0))
				: null;
			const lastAt = totals?.lastAt;
			return h("div", {
				className: "tgm-root",
				"data-model-route-monitor": "",
				"data-tgm-state": error ? "error" : loading && data === null ? "loading" : "ready",
			},
			h("style", null, CSS),
			h("header", { className: "tgm-top" },
				h("div", { className: "tgm-title-row" },
					h("div", { className: "tgm-title-mark" }, h(MonitorIcon, { size: 17 })),
					h("div", { className: "tgm-title-copy" },
						h("div", { className: "tgm-title" }, t("title")),
						h("div", { className: "tgm-subtitle" }, t("subtitle"))),
					h("button", {
						type: "button",
						className: "tgm-refresh",
						title: t("openConfig"),
						"aria-label": t("openConfig"),
						"data-model-route-monitor-config": "",
						disabled: openingConfig,
						onClick: openConfig,
					}, h(ConfigIcon)),
					h("button", {
						type: "button",
						className: "tgm-refresh",
						title: t("refresh"),
						"aria-label": t("refresh"),
						onClick: () => setTick((value) => value + 1),
					}, h(RefreshIcon))),
				h("div", { className: "tgm-controls" },
					h(RangeTabs, { range, onChange: setRange, t }),
					data?.pending?.count > 0 ? h("span", { className: "tgm-live", role: "status", title: data.pending.ms > 0 ? `${Math.round(data.pending.ms / 1000)}s` : "" },
						h("i", { "aria-hidden": "true" }),
						t("live"),
						data.pending.count > 1 ? ` · ${data.pending.count}` : "") : null,
					h("span", { className: "tgm-updated", title: lastAt ? clock(lastAt) : "" },
						lastAt ? `${t("updated")} ${timeAgo(lastAt)}` : "")),
				configNotice ? h("div", {
					className: "tgm-top-notice",
					"data-tone": configNotice.tone,
					role: "status",
				},
					h("span", null, configNotice.text),
					h("button", { type: "button", className: "tgm-copy", "aria-label": t("dismiss"), title: t("dismiss"), onClick: () => setConfigNotice(null) }, "×")) : null),
			h("div", { className: "tgm-scroll" },
				error ? h(Banner, {
					tone: "error",
					action: h("button", { type: "button", className: "tgm-retry", onClick: () => setTick((value) => value + 1) }, t("retry")),
				}, `${t("error")}: ${error.message}`) : null,
				data?.gateway?.found === false ? h(Banner, { tone: "warn" }, t("gatewayMissing")) : null,
				!data && loading ? h("div", { className: "tgm-empty" }, h("span", null, t("loading"))) : null,
				data && totals?.requests === 0 ? h(EmptyState, { t }) : null,
				data && totals?.requests > 0 ? h(Fragment, null,
					h("section", { className: "tgm-summary" },
						h("div", { className: "tgm-hero" },
							h("div", { className: "tgm-hero-label" }, t("savings")),
							h("div", {
								className: "tgm-hero-value",
								"data-negative": priced && savings < 0,
								"data-muted": !priced,
							}, priced ? money(savings, data.currency) : t("noPrice"))),
						h("div", { className: "tgm-kpis" },
							h(Kpi, { label: t("requests"), value: compact(totals.requests) }),
							h(Kpi, { label: t("sessions"), value: compact(totals.sessions) }),
							h(Kpi, { label: t("savingRate"), value: priced ? percent(savingsRate, 2) : "—" }))),
					comparable || (totals.pricedRequests > 0 && totals.comparableRequests === 0)
						? h(Banner, { tone: "warn" }, t("comparable", { priced: totals.comparableRequests, total: totals.requests }))
						: null,
					h("section", { className: "tgm-section" },
						h("div", { className: "tgm-section-head" },
							h("h2", null, t("byTier")),
							h("button", {
								type: "button",
								className: "tgm-price-toggle",
								"data-open": priceOpen,
								"aria-expanded": priceOpen,
								onClick: () => setPriceOpen((value) => !value),
							}, priceOpen ? t("priceClose") : t("priceOpen"))),
						priceOpen ? h(PricePanel, {
							form,
							prices: data.prices,
							manualPrices: data.manualPrices ?? data.prices,
							autoPrices: data.autoPrices !== false,
							onSaved: () => setTick((value) => value + 1),
							onSetAuto: setAutoMode,
							togglingAuto,
							autoNotice,
							t,
						}) : null,
						h("div", { className: "tgm-tiers" },
							tiers.map((row) => h(TierCard, {
								key: row.tier,
								row,
								gateway: data.gateway,
								t,
								currency: data.currency,
							})))),
					h("section", { className: "tgm-section" },
						h("div", { className: "tgm-section-head" },
							h("h2", null, t("bySession")),
							sessions.length > 4 ? h("button", {
								type: "button",
								className: "tgm-section-action",
								onClick: () => setShowAllSessions((value) => !value),
							}, showAllSessions ? t("less") : t("more")) : null),
						sessions.length > 0
							? h("div", { className: "tgm-list" }, visibleSessions.map((row) => h(SessionRow, {
								key: row.sessionId,
								row,
								t,
								currency: data.currency,
								useSessions,
							})))
							: h("div", { className: "tgm-list" }, h("div", { className: "tgm-row" }, h("div", { className: "tgm-row-main" }, h("div", { className: "tgm-row-sub" }, t("noSessions")))))),
					h("section", { className: "tgm-section" },
						h("div", { className: "tgm-section-head" },
							h("h2", null, t("recent")),
							recent.length > 6 ? h("button", {
								type: "button",
								className: "tgm-section-action",
								onClick: () => setShowAllRecent((value) => !value),
							}, showAllRecent ? t("less") : t("more")) : null),
						recent.length > 0
							? h("div", { className: "tgm-list" }, visibleRecent.map((row, index) => h(RecentRoute, {
								key: `${row.at}-${index}-${row.sessionId ?? ""}-${row.turn ?? ""}`,
								row,
								t,
								currency: data.currency,
							})))
							: h("div", { className: "tgm-list" }, h("div", { className: "tgm-row" }, h("div", { className: "tgm-row-main" }, h("div", { className: "tgm-row-sub" }, t("noRecentDecisions"))))))) : null,
				h(DelegationList, { rows: delegations, t }),
				data && totals?.requests === 0 ? h("section", { className: "tgm-section" },
					h("div", { className: "tgm-section-head" }, h("h2", null, t("priceTitle"))),
					h(PricePanel, {
						form,
						prices: data.prices,
						manualPrices: data.manualPrices ?? data.prices,
						autoPrices: data.autoPrices !== false,
						onSaved: () => setTick((value) => value + 1),
						onSetAuto: setAutoMode,
						togglingAuto,
						autoNotice,
						t,
					})) : null));
		}
		//#endregion

		//#region title + open button
		function MonitorTitle({ useTabInfo }) {
			const { tab } = useTabInfo();
			return h("span", {
				style: { display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 },
			},
			h(MonitorIcon, { size: 14 }),
			h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tab.title));
		}

		function OpenButton({ t, open }) {
			return h(Fragment, null,
				h("style", null, ".tgm-open{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}.tgm-open:hover{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}.tgm-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}"),
				h("button", {
					type: "button",
					className: "tgm-open",
					"aria-label": t("open"),
					title: t("open"),
					"data-model-route-monitor-open": "",
					onClick: () => {
						try {
							open();
						} catch (error) {
							console.error("model-route-monitor: cannot open the monitor tab", error);
						}
					},
				}, h(MonitorIcon, { size: 15 })));
		}
		//#endregion

		//#region plugin
		const inject = ["slots", "locale", "sidebarRightTabs", "sidebarRight", "configForms"];

		function monitorDefinition(t) {
			return {
				id: ID,
				kind: KIND,
				priority: "extension",
				title: () => t("tab.title"),
				guide: [{
					id: "monitor",
					order: 5,
					title: () => t("guide.title"),
					description: () => t("guide.description"),
					icon: MonitorIcon,
				}],
			};
		}

		/**
		 * Register the right-Sidebar tab type, its body/title, and the one-click
		 * opening control in the conversation header.
		 * @param ctx - Client plugin context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "model-route-monitor: dictionaries");
			ctx.effect(() => ctx.sidebarRightTabs.register(monitorDefinition(t)), "model-route-monitor: tab type");
			const form = typeof ctx.configForms?.get === "function" ? ctx.configForms.get(ENTRY_ID) : null;
			const open = () => {
				ctx.sidebarRight.openTab(KIND);
			};
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: ID,
				locale: NS,
				inject: () => ({ form }),
			}, MonitorBody)), "model-route-monitor: tab body");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: ID,
			}, MonitorTitle)), "model-route-monitor: tab title");
			ctx.effect(() => ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "model-route-monitor",
				order: 40,
				label: () => t("open"),
				locale: NS,
				inject: () => ({ open }),
			}, OpenButton)), "model-route-monitor: header open button");
		}

		exports.inject = inject;
		exports.apply = apply;
		exports.MonitorBody = MonitorBody;
		exports.PricePanel = PricePanel;
		exports.MonitorIcon = MonitorIcon;
		exports.zh = zh;
		exports.en = en;
		return module.exports;
	},
});