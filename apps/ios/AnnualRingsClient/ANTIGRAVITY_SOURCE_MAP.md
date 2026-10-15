# 原版来源与适配边界

2026-09-21，Owner 否定此前的紧凑版和详情重做后，直接以指定 Antigravity 原始 SwiftUI 文件重建当前入口。保留原版布局顺序、深色金色主题、字号、卡片和投研五个分栏。以下哈希记录原始文件，不表示适配后的文件逐字相同。

| 原始文件 | 当前实现 | 原始 SHA256 |
| --- | --- | --- |
| `/Users/REDACTED/.codex/antigravity-ui-preview/20260917_091500/Sources/Views/TodayView.swift` | `Sources/Antigravity/AntigravityTodayView.swift` | `6c3e3cd793ca407608e8a30938dca2d74cbc54009e7c099d67ce6de514f0fbfc` |
| `/Users/REDACTED/.codex/antigravity-ui-preview/20260917_091500/Sources/Views/MarketView.swift` | `Sources/Antigravity/AntigravityMarketView.swift` | `0475984715e138587119b5cade10d6354fa4bb4b95d01be2f6f3c5702a4d3837` |
| `/Users/REDACTED/.codex/antigravity-ui-preview/20260917_091500/Sources/Views/ResearchView.swift` | `Sources/Antigravity/AntigravityResearchView.swift` | `a9749ab06c66d2c821a432b041d7e9c9a3bc251cefa191bef349ff0610255b82` |
| `/Users/REDACTED/.codex/antigravity-ui-preview/20260917_091500/Sources/Views/AssetsView.swift` | `Sources/Antigravity/AntigravityAssetsView.swift` | `8bb18f5620757c4ed1a917e06c190da522d57f648254c8208af8945dff91f86f` |
| `/Users/REDACTED/.codex/antigravity-ui-preview/20260917_091500/Sources/Views/StockDetailView.swift` | `Sources/Antigravity/AntigravityStockDetailView.swift` | `7a6ced4d1daacbc4d176e0f8a21a78af1273900925cd0b0b8bf9bdebe7a2e208` |
| `/Users/REDACTED/.codex/antigravity-ui-preview/20260917_091500/Sources/Views/EvidenceDetailSheet.swift` | `Sources/Antigravity/AntigravityEvidenceDetailSheet.swift` | `34993448e909fb4661ae7639968f0500b57d318f19e6f022948c2a1bfcdc3077` |

`DesignSystem.swift` 来自原版；新增 MainActor 隔离并修复 UIColor 动态颜色跨线程访问。`Components/FiveQuestionCard.swift` 对应 `Sources/Antigravity/AntigravityFiveQuestionCard.swift`；价格条件缺失时保留明确空态，不补模板数值。

搜索与 AI 助手采用原版 `GlobalSearchSheet.swift` / `AIAssistantSheet.swift` 的布局，分别在 `AntigravitySearchPresentation.swift` / `AntigravityAssistantPresentation.swift` 绑定原生既有真实请求、身份校验、报告预检、保存与删除处理。

适配差异：类型命名隔离；由四个既有 NavigationStack 承载；移除 MockData 和本地假确认；映射真实报告、原文、估值、复盘、行情及资产上下文。原版未实现的录入、研究任务、审阅等完整操作继续复用 GateA 业务页面，其布局不属于原版复刻范围。不能把这些操作页面称为逐像素复刻。

工程沿用模板 XcodeGen / SwiftUI 结构，并引入现有 GateA 源码、授权配置和运行资源；没有复制模板独立假后端或改写后端契约。
