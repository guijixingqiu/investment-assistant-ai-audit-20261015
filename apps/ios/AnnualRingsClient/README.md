# 年轮 · 决策客户端

iOS 17+ 原生 SwiftUI。直接恢复指定 Antigravity 原版的四首页、投研分栏、个股详情和证据弹窗布局；真实数据使用项目现有类型化 API 客户端。模板中的样例数据与本地假写入不参与运行。

## 编译与运行

在本目录执行 `xcodegen generate --spec project.yml`，然后打开 `AnnualRingsClient.xcodeproj`，选择 `AnnualRingsClient` scheme 和 iOS Simulator。工程引用同级 `../AnnualRingsGateA/Sources`、`App` 与资源，需保留仓库结构。

专用模拟器可通过现有脚本构建、安装并启动：

```sh
ANNUAL_RINGS_BASE_URL=http://127.0.0.1:4037 \
ANNUAL_RINGS_TOKEN_FILE=/本机私有令牌文件 \
./run-simulator.sh 00000000-0000-0000-0000-000000000000
```

脚本不启动或停止后端。令牌由脚本从本机文件注入模拟器进程；不要放进源文件、命令参数或截图。

## 后端连接

`Sources/APIService.swift` 通过现有的 `ResearchClient`、`MarketQuoteClient`、`MarketEnvironmentClient`、`MarketDailyTechnicalClient`、`WeinsteinTechnicalAnalysisClient` 与 `AssetsAlphaClient` 读取今日、市场、研究和 Alpha 资产数据。行情新鲜度、服务状态与缺失字段按响应展示，不用模板值补齐。

四个 Tab 分别维护导航栈：今日处理待办；市场查看行情、环境和公告；研究承载个股判断及报告、估值、资料、财务、更新任务和决定复盘；资产承载快照与组合背景。跨 Tab 的研究入口统一进入“研究”，返回和切换 Tab 保留当前位置。搜索与 AI 助手位于全局工具栏。

二、三级页面复用 `AnnualRingsGateA` 业务组件及请求处理，保留候选、报告、证据、估值、正式决定、复盘和资产写入的既有授权、版本校验、幂等与回读行为。今日事项保留其标的、版本和目标绑定，不用普通报告页替代目标处理流程。AI 设置与诊断折叠展示。

资产 Alpha 明确为非官方本地账本，不是券商持仓或生产账户。模拟器核验只读取数据并往返工作台，没有提交写入、交易或付费 AI 请求。当前构建、UI 核验和截图记录见 [DELIVERY.md](DELIVERY.md)。

当前来源与必要适配见 [ANTIGRAVITY_SOURCE_MAP.md](ANTIGRAVITY_SOURCE_MAP.md)。此前重新设计的紧凑版已被 Owner 否定，不再作为主页面入口。

功能入口与真实执行范围见 [FUNCTIONAL_AUDIT.md](FUNCTIONAL_AUDIT.md)：市场右上角显式刷新报价和日线；研究左上角工具菜单进入财务、任务、估值、组合与决定；AI助手真实问答，研究任务需核对发送清单后明确开始。完整结构化报告建议8000输出预算。
