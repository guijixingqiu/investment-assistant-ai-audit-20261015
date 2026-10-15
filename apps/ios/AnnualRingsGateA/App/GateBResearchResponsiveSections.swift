import SwiftUI

enum DailyCandidateWorkspace: String, CaseIterable, Identifiable {
    case overview
    case lifecycle

    var id: String { rawValue }
    var title: String { self == .overview ? "候选概览" : "生命周期" }
    var detail: String { self == .overview ? "候选状态与研究时点" : "跟踪、暂停、归档与研究入口" }
    var systemImage: String { self == .overview ? "list.bullet.rectangle" : "arrow.trianglehead.2.clockwise.rotate.90" }
}

// MARK: - Figma Make Version 9 workspace surface

/// Compact V9 capability row. It exposes the existing backend state without
/// sending the Owner through a second, unrelated visual system.
struct FigmaWorkspaceDirectoryCard: View {
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("研究能力 · \(ResearchWorkspace.allCases.count)")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(OwnerExperienceStyle.textPrimary)
                    Text("材料 · 分析 · 报告 · 决定 · 组合解释")
                        .font(.caption)
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Text("进入 ›")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.accent)
            }
            .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
        }
        .buttonStyle(.plain)
        .cardStyle(padding: 14)
        .accessibilityIdentifier("figmaWorkspaceDirectoryCard")
    }
}

struct FigmaWorkspaceRow: Identifiable {
    let id = UUID()
    let label: String
    let value: String
    let tone: FigmaWorkspaceTone
}

struct FigmaWorkspaceStatus {
    let badge: String
    let title: String
    let summary: String
    let rows: [FigmaWorkspaceRow]
}

enum FigmaWorkspaceTone {
    case info
    case success
    case warning

    var color: Color {
        switch self {
        case .info: OwnerExperienceStyle.accent
        case .success: OwnerExperienceStyle.success
        case .warning: OwnerExperienceStyle.warning
        }
    }
}

struct FigmaResearchWorkspaceDirectoryView: View {
    @Environment(\.dismiss) private var dismiss
    let symbol: String
    let companyName: String
    let currentLayer: String
    let currentWorkspace: ResearchWorkspace?
    let initialWorkspace: ResearchWorkspace?
    let nextStep: String
    let onSelectTab: (AnnualRingsTab) -> Void
    let onSelectWorkspace: (ResearchWorkspace) -> Void
    let workspaceStatus: (ResearchWorkspace) -> FigmaWorkspaceStatus
    @State private var selectedWorkspace: ResearchWorkspace?
    @State private var navigationPath: [ResearchWorkspace]

    init(
        symbol: String,
        companyName: String,
        currentLayer: String,
        currentWorkspace: ResearchWorkspace?,
        initialWorkspace: ResearchWorkspace?,
        nextStep: String,
        onSelectTab: @escaping (AnnualRingsTab) -> Void,
        onSelectWorkspace: @escaping (ResearchWorkspace) -> Void,
        workspaceStatus: @escaping (ResearchWorkspace) -> FigmaWorkspaceStatus
    ) {
        self.symbol = symbol
        self.companyName = companyName
        self.currentLayer = currentLayer
        self.currentWorkspace = currentWorkspace
        self.initialWorkspace = initialWorkspace
        self.nextStep = nextStep
        self.onSelectTab = onSelectTab
        self.onSelectWorkspace = onSelectWorkspace
        self.workspaceStatus = workspaceStatus
        _selectedWorkspace = State(initialValue: initialWorkspace)
        _navigationPath = State(initialValue: initialWorkspace.map { [$0] } ?? [])
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        FigmaWorkspaceHeader(title: "研究能力", subtitle: "材料 · 分析 · 决定")
                        FigmaWorkspaceContextCard(
                            symbol: symbol,
                            companyName: companyName,
                            currentLayer: currentLayer,
                            nextStep: nextStep
                        )
                        FigmaWorkspaceGroupCard(
                            title: "材料与判断依据",
                            detail: "原文、证据身份、公司事实与覆盖缺口",
                            workspaces: [.materials, .fundamentals],
                            currentWorkspace: currentWorkspace,
                            onSelect: select
                        )
                        FigmaWorkspaceGroupCard(
                            title: "分析与研究",
                            detail: "技术、估值情景、量化检视与深度研究",
                            workspaces: [.valuation, .deepResearch],
                            currentWorkspace: currentWorkspace,
                            onSelect: select
                        )
                        FigmaWorkspaceGroupCard(
                            title: "报告、决定与组合",
                            detail: "报告确认、人工决定、复盘与组合影响解释",
                            workspaces: [.report, .decisionReview, .portfolio],
                            currentWorkspace: currentWorkspace,
                            onSelect: select
                        )
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 94)
                }
                .scrollIndicators(.hidden)
                .background(OwnerExperienceStyle.pageBackground.ignoresSafeArea())
            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top) {
                HStack {
                    Button("研究") {
                        dismiss()
                        onSelectTab(.research)
                    }
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    Spacer()
                    MakeV9ThemeToggleButton()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 4)
                .background(OwnerExperienceStyle.pageBackground.opacity(0.96))
            }
            .navigationDestination(for: ResearchWorkspace.self) { workspace in
                FigmaWorkspaceDetailView(
                    workspace: workspace,
                    symbol: symbol,
                    companyName: companyName,
                    status: workspaceStatus(workspace),
                    onContinue: {
                        dismiss()
                        onSelectWorkspace(workspace)
                    }
                )
            }
        }
    }

    private func select(_ workspace: ResearchWorkspace) {
        onSelectWorkspace(workspace)
        selectedWorkspace = workspace
        navigationPath = [workspace]
    }
}

private struct FigmaWorkspaceHeader: View {
    let title: String
    let subtitle: String

    init(title: String, subtitle: String = "判断 · 证据 · 复盘") {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 26, weight: .bold, design: .serif))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
            Text(subtitle)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(OwnerExperienceStyle.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }
}

private struct FigmaWorkspaceContextCard: View {
    let symbol: String
    let companyName: String
    let currentLayer: String
    let nextStep: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(symbol) · \(companyName)")
                .font(.headline.weight(.bold))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
            Text("当前层：\(currentLayer) · 唯一步骤：\(nextStep)")
                .font(.caption)
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
        .cardStyle(padding: 20)
    }
}

private struct FigmaWorkspaceGroupCard: View {
    let title: String
    let detail: String
    let workspaces: [ResearchWorkspace]
    let currentWorkspace: ResearchWorkspace?
    let onSelect: (ResearchWorkspace) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline.weight(.bold))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
            Text(detail)
                .font(.caption)
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(workspaces) { workspace in
                Button { onSelect(workspace) } label: {
                    HStack(spacing: 8) {
                        Text(workspace.title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(OwnerExperienceStyle.textPrimary)
                        Spacer(minLength: 4)
                        if currentWorkspace == workspace {
                            Text("当前")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(OwnerExperienceStyle.accent)
                        }
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("figmaWorkspace-\(workspace.rawValue)")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
        .cardStyle(padding: 20)
    }
}

private struct FigmaWorkspaceDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let workspace: ResearchWorkspace
    let symbol: String
    let companyName: String
    let status: FigmaWorkspaceStatus
    let onContinue: () -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    FigmaWorkspaceHeader(title: status.title, subtitle: "\(symbol) · \(companyName)")
                    HStack(spacing: 8) {
                        Text(status.summary)
                            .font(.caption)
                            .foregroundStyle(OwnerExperienceStyle.textSecondary)
                            .lineLimit(2)
                        Spacer(minLength: 4)
                        FigmaWorkspaceStatusPill(text: status.badge, tone: status.rows.first?.tone ?? .info)
                    }
                    .padding(.horizontal, 2)
                    FigmaWorkspaceSpecificCards(workspace: workspace, status: status)
                    HStack(spacing: 8) {
                        Button("返回研究能力") { dismiss() }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OwnerExperienceStyle.accent)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(OwnerExperienceStyle.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .buttonStyle(.plain)
                        Button(workspaceActionTitle) { onContinue() }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.white)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(OwnerExperienceStyle.gold, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .buttonStyle(.plain)
                    }
                    Text("正式确认、正式决定与资产事实写入仍需 Owner 明确操作。")
                        .font(.caption2)
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 94)
            }
            .scrollIndicators(.hidden)
            .background(OwnerExperienceStyle.pageBackground.ignoresSafeArea())
            FigmaLightTabBar(selected: .research) { _ in dismiss() }
                .ignoresSafeArea(.container, edges: .bottom)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var workspaceActionTitle: String {
        switch workspace {
        case .materials: "进入材料核验"
        case .fundamentals: "进入事实核对"
        case .valuation: "进入估值情景"
        case .deepResearch: "进入深度研究"
        case .report: "进入报告确认"
        case .decisionReview: "进入决定复盘"
        case .portfolio: "进入组合解释"
        }
    }
}

private struct FigmaWorkspaceSpecificCards: View {
    let workspace: ResearchWorkspace
    let status: FigmaWorkspaceStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch workspace {
            case .materials:
                FigmaWorkspaceDetailCard(title: "当前材料", badge: status.badge, rows: status.rows)
                FigmaWorkspaceDetailCard(title: "PDF 预览", badge: "只读", rows: [
                    .init(label: "原文页码", value: status.rows.first?.value ?? "当前无页码", tone: .info),
                    .init(label: "可核对事实", value: status.rows.dropFirst().first?.value ?? "当前无候选事实", tone: .warning),
                    .init(label: "正式绑定", value: "沿用当前确认状态", tone: .info)
                ])
                FigmaWorkspaceDetailCard(title: "候选事实 · 还未写入正式证据", badge: "待确认", rows: status.rows)
            case .fundamentals:
                FigmaWorkspaceDetailCard(title: "当前材料绑定", badge: status.badge, rows: status.rows)
                FigmaWorkspaceDetailCard(title: "报告事实与可用性", badge: "需核对", rows: [
                    .init(label: "Revenue", value: status.rows.first?.value ?? "待读取", tone: .info),
                    .init(label: "Profit attributable", value: status.rows.dropFirst().first?.value ?? "待读取", tone: .info),
                    .init(label: "Total liabilities", value: "当前数据源未提供", tone: .warning)
                ])
                FigmaWorkspaceDetailCard(title: "行业背景与可比公司", badge: "待核查", rows: [
                    .init(label: "同业样本", value: "可比性原因待补充", tone: .warning),
                    .init(label: "驱动因素", value: "沿用上下文工作区状态", tone: .info)
                ])
                FigmaWorkspaceDetailCard(title: "证据完整性", badge: status.badge, rows: [
                    .init(label: "当前状态", value: status.summary, tone: .info),
                    .init(label: "下一步", value: "补齐负债可比性说明", tone: .warning)
                ])
            case .valuation:
                FigmaWorkspaceDetailCard(title: "估值方法", badge: "用户情景 · 草稿", rows: [
                    .init(label: "方法", value: "Forward multiple", tone: .info),
                    .init(label: "币种", value: "由 Owner 输入", tone: .warning),
                    .init(label: "目标", value: "不读取目标价", tone: .warning)
                ])
                FigmaWorkspaceDetailCard(title: "情景输入", badge: "需 Owner 输入", rows: status.rows)
                FigmaWorkspaceDetailCard(title: "用户情景估值", badge: "非目标价", rows: [
                    .init(label: "结果", value: "运行试算后显示", tone: .info),
                    .init(label: "敏感性", value: "由 Owner 输入增长与倍数步长", tone: .warning)
                ])
                FigmaWorkspaceDetailCard(title: "量化检视", badge: "仅研究约束", rows: [
                    .init(label: "最大回撤", value: "当前量化结果未返回", tone: .warning),
                    .init(label: "换手率", value: "当前量化结果未返回", tone: .warning),
                    .init(label: "最少交易数", value: "沿用量化约束设置", tone: .info)
                ])
            case .deepResearch:
                FigmaWorkspaceDetailCard(title: "深度研究任务", badge: status.badge, rows: status.rows)
                FigmaWorkspaceDetailCard(title: "任务进度与恢复", badge: "可核验", rows: [
                    .init(label: "已请求", value: "scope 已确认", tone: .success),
                    .init(label: "运行中", value: "使用现有任务状态", tone: .info),
                    .init(label: "可吸收", value: status.badge, tone: status.rows.first?.tone ?? .info)
                ])
                FigmaWorkspaceDetailCard(title: "综合结论预览", badge: "引用沿用现有报告", rows: [
                    .init(label: "报告状态", value: status.summary, tone: .info),
                    .init(label: "下一动作", value: "人工核验后吸收", tone: .warning)
                ])
                FigmaWorkspaceDetailCard(title: "吸收边界", badge: "只读", rows: [
                    .init(label: "写入范围", value: "不会自动写入报告、决定或资产", tone: .warning),
                    .init(label: "失败处理", value: "保留证据，不把成功误报为完成", tone: .info)
                ])
            case .report:
                FigmaWorkspaceDetailCard(title: "核心结论", badge: status.badge, rows: status.rows)
                FigmaWorkspaceDetailCard(title: "条件与失效线索", badge: "需 Owner 审阅", rows: [
                    .init(label: "支持条件", value: "沿用报告与证据包", tone: .success),
                    .init(label: "反方证据", value: "价格竞争与盈利假设变化", tone: .warning),
                    .init(label: "失效条件", value: "关键事实无法核验", tone: .warning)
                ])
                FigmaWorkspaceDetailCard(title: "引用与证据", badge: "当前绑定", rows: [
                    .init(label: "版本", value: status.rows.first?.value ?? "当前报告无版本", tone: .info),
                    .init(label: "来源", value: "沿用现有证据包", tone: .info)
                ])
                FigmaWorkspaceDetailCard(title: "针对报告追问", badge: "只读问答", rows: [
                    .init(label: "问题", value: "如果盈利口径无法统一，结论应如何降级？", tone: .info),
                    .init(label: "确认", value: "不会自动修改正式报告", tone: .warning)
                ])
            case .decisionReview:
                FigmaWorkspaceDetailCard(title: "正式决定草稿", badge: status.badge, rows: [
                    .init(label: "决定结论", value: hasDecisionText(status) ? "沿用已记录决定" : "等待人工判断", tone: status.rows.first?.tone ?? .warning),
                    .init(label: "唯一下一步", value: "确认盈利口径与负债事实来源", tone: .info),
                    .init(label: "绑定", value: "报告与证据包沿用现有版本", tone: .info)
                ])
                FigmaWorkspaceDetailCard(title: "跟踪条件", badge: "需持续观察", rows: [
                    .init(label: "支持条件", value: "现有盘口与经营事实保持一致", tone: .success),
                    .init(label: "失效条件", value: "来源无法验证", tone: .warning),
                    .init(label: "下次复核", value: "提交后显示", tone: .info)
                ])
                FigmaWorkspaceDetailCard(title: "后续复盘", badge: "到期后填写", rows: [
                    .init(label: "结果", value: "证据不足 / 判断偏差 / 流程问题", tone: .info),
                    .init(label: "证据变化", value: "记录新增、失效与冲突证据", tone: .info),
                    .init(label: "下一研究问题", value: "写明可执行的后续问题", tone: .warning)
                ])
            case .portfolio:
                FigmaWorkspaceDetailCard(title: "本地 Beta 组合快照", badge: status.badge, rows: status.rows)
                FigmaWorkspaceDetailCard(title: "精确研究成员", badge: "已绑定", rows: [
                    .init(label: "研究标的", value: "报告与研究身份绑定", tone: .success),
                    .init(label: "组合解释", value: "不自动扩展为官方持仓", tone: .warning)
                ])
                FigmaWorkspaceDetailCard(title: "Owner 情景金额", badge: "用户输入", rows: [
                    .init(label: "假设金额", value: "由 Owner 输入", tone: .info),
                    .init(label: "当前价格", value: "沿用最新可用行情", tone: .info)
                ])
                FigmaWorkspaceDetailCard(title: "组合影响解释", badge: "只读", rows: [
                    .init(label: "单股集中度", value: "沿用当前组合快照", tone: .info),
                    .init(label: "缺失事实", value: "按来源状态保留", tone: .warning)
                ])
            }
        }
    }

    private func hasDecisionText(_ status: FigmaWorkspaceStatus) -> Bool {
        status.badge == "已记录"
    }
}

private struct FigmaWorkspaceDetailCard: View {
    let title: String
    let badge: String
    let rows: [FigmaWorkspaceRow]

    init(title: String, badge: String, rows: [FigmaWorkspaceRow]) {
        self.title = title
        self.badge = badge
        self.rows = rows
    }

    init(status: FigmaWorkspaceStatus) {
        self.init(title: status.title, badge: status.badge, rows: status.rows)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.callout.weight(.bold))
                Spacer(minLength: 8)
                FigmaWorkspaceStatusPill(text: badge, tone: rows.first?.tone ?? .info)
            }
            ForEach(rows) { row in
                HStack(spacing: 10) {
                    Text(row.label)
                        .font(.caption)
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    Spacer(minLength: 4)
                    Text(row.value)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(row.tone.color)
                        .multilineTextAlignment(.trailing)
                }
                .frame(minHeight: 24)
            }
        }
        .cardStyle(padding: 14)
    }
}

private struct FigmaWorkspaceStatusPill: View {
    let text: String
    let tone: FigmaWorkspaceTone

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tone.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tone.color.opacity(0.10), in: Capsule())
    }
}

private struct FigmaLightTabBar: View {
    let selected: AnnualRingsTab
    let onSelect: (AnnualRingsTab) -> Void

    var body: some View {
        HStack(spacing: 0) {
            item(.today, "今日", "calendar")
            item(.market, "市场", "chart.bar.xaxis")
            item(.research, "研究", "magnifyingglass")
            item(.assets, "资产", "chart.pie")
        }
        .padding(.top, 6)
        .padding(.bottom, 0)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .background(OwnerExperienceStyle.pageBackground.opacity(0.92))
        .overlay(alignment: .top) {
            Rectangle().fill(OwnerExperienceStyle.subtleBorder).frame(height: 1)
        }
    }

    private func item(_ tab: AnnualRingsTab, _ title: String, _ icon: String) -> some View {
        Button { onSelect(tab) } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .regular))
                Text(title)
                    .font(.caption2.weight(selected == tab ? .medium : .regular))
            }
            .foregroundStyle(selected == tab ? OwnerExperienceStyle.gold : OwnerExperienceStyle.textTertiary)
            .frame(maxWidth: .infinity, minHeight: 42)
            .overlay(alignment: .bottom) {
                if selected == tab {
                    Capsule().fill(OwnerExperienceStyle.gold).frame(width: 18, height: 2)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

enum DailyPortfolioWorkspace: String, CaseIterable, Identifiable {
    case current
    case risk
    case lab

    var id: String { rawValue }

    var title: String {
        switch self {
        case .current: "当前组合"
        case .risk: "风险情景"
        case .lab: "组合实验"
        }
    }

    var detail: String {
        switch self {
        case .current: "Pingan 持仓与 Futu 报价"
        case .risk: "单一用户金额的中性影响"
        case .lab: "并列金额、历史风险与机会成本"
        }
    }

    var systemImage: String {
        switch self {
        case .current: "chart.pie"
        case .risk: "shield.lefthalf.filled"
        case .lab: "rectangle.split.3x1"
        }
    }
}

enum DailyHumanDecisionWorkspace: String, CaseIterable, Identifiable {
    case conditions
    case snapshot
    case boundaries

    var id: String { rawValue }

    var title: String {
        switch self {
        case .conditions: "条件判断"
        case .snapshot: "决策快照"
        case .boundaries: "边界检查"
        }
    }

    var detail: String {
        switch self {
        case .conditions: "条件、失效条件与人工确认"
        case .snapshot: "不可变决策时事实"
        case .boundaries: "辅助范围与人工复核项"
        }
    }

    var systemImage: String {
        switch self {
        case .conditions: "person.crop.circle.badge.checkmark"
        case .snapshot: "lock.doc"
        case .boundaries: "checklist"
        }
    }
}

enum DailyReviewWorkspace: String, CaseIterable, Identifiable {
    case learning
    case timeline
    case followUp
    case local

    var id: String { rawValue }

    var title: String {
        switch self {
        case .learning: "学习摘要"
        case .timeline: "复盘时间线"
        case .followUp: "后续记录"
        case .local: "本地知识"
        }
    }

    var detail: String {
        switch self {
        case .learning: "后来事实与描述性学习"
        case .timeline: "append-only 复盘事实"
        case .followUp: "follow-up 与 decision note"
        case .local: "来源绑定的本地草稿"
        }
    }

    var systemImage: String {
        switch self {
        case .learning: "chart.line.text.clipboard"
        case .timeline: "clock.arrow.circlepath"
        case .followUp: "note.text"
        case .local: "square.and.pencil"
        }
    }
}

struct DailyWorkspaceOption: Identifiable {
    let id: String
    let title: String
    let detail: String
    let systemImage: String
}

/// 研究页的一级工作区。每个工作区都直接对应既有的年轮层与证据子工作区状态，
/// 不引入新的读取、写入或缓存引擎。
enum ResearchWorkspace: String, CaseIterable, Identifiable, Hashable {
    case materials
    case fundamentals
    case valuation
    case deepResearch
    case report
    case decisionReview
    case portfolio

    var id: String { rawValue }

    var title: String {
        switch self {
        case .materials: "材料与证据"
        case .fundamentals: "基本面与完整性"
        case .valuation: "估值与量化"
        case .deepResearch: "深度研究"
        case .report: "报告与追问"
        case .decisionReview: "决定与复盘"
        case .portfolio: "组合解释"
        }
    }

    var detail: String {
        switch self {
        case .materials: "导入材料 · PDF 原文 · 证据身份"
        case .fundamentals: "报告事实 · 行业背景 · 覆盖缺口"
        case .valuation: "用户情景估值 · 历史量化"
        case .deepResearch: "研究任务 · 论点变量 · 结果吸收"
        case .report: "核心结论 · 引用 · 追问与确认"
        case .decisionReview: "人工决定 · 正式动作 · 后续复盘"
        case .portfolio: "组合研究 · 风险情景 · 组合实验"
        }
    }

    var systemImage: String {
        switch self {
        case .materials: "folder.badge.plus"
        case .fundamentals: "list.bullet.clipboard"
        case .valuation: "function"
        case .deepResearch: "sparkle.magnifyingglass"
        case .report: "doc.text"
        case .decisionReview: "person.crop.circle.badge.checkmark"
        case .portfolio: "chart.pie"
        }
    }

    var tint: Color {
        switch self {
        case .decisionReview: return DailyDecisionRingLayer.decision.tint
        case .portfolio: return DailyDecisionRingLayer.portfolio.tint
        default: return DailyDecisionRingLayer.evidence.tint
        }
    }

    static func workspace(for evidenceWorkspace: DailyEvidenceWorkspace) -> ResearchWorkspace {
        switch evidenceWorkspace {
        case .brief: return .report
        case .valuation: return .valuation
        case .research: return .deepResearch
        case .documents, .frozen: return .materials
        case .facts: return .fundamentals
        }
    }

    func evidenceWorkspace(selected: DailyEvidenceWorkspace) -> DailyEvidenceWorkspace? {
        switch self {
        case .materials: return selected == .frozen ? .frozen : .documents
        case .fundamentals: return .facts
        case .valuation: return .valuation
        case .deepResearch: return .research
        case .report: return .brief
        case .decisionReview, .portfolio: return nil
        }
    }
}

struct DailyResponsiveActionGroup<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private let spacing: CGFloat
    private let content: () -> Content

    init(
        spacing: CGFloat = 8,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.spacing = spacing
        self.content = content
    }

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            verticalActions
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: spacing) {
                    content()
                }
                .fixedSize(horizontal: true, vertical: false)

                verticalActions
            }
        }
    }

    private var verticalActions: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DailyWorkspacePicker: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let options: [DailyWorkspaceOption]
    let selectedID: String
    let tint: Color
    let accessibilityPrefix: String
    let onSelect: (String) -> Void

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 4) {
                    workspaceButtons
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        workspaceButtons
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var workspaceButtons: some View {
        ForEach(options) { option in
            Button {
                onSelect(option.id)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: option.systemImage)
                        .font(.caption.weight(.semibold))
                    Text(option.title)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(selectedID == option.id ? Color.white : .secondary)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(
                    selectedID == option.id ? tint : Color(.secondarySystemGroupedBackground),
                    in: Capsule()
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(option.title)
            .accessibilityValue(option.detail)
            .accessibilityIdentifier("\(accessibilityPrefix)-\(option.id)")
            .accessibilityAddTraits(selectedID == option.id ? .isSelected : [])
            .accessibilityRemoveTraits(selectedID == option.id ? [] : .isSelected)
        }
    }
}

extension GateBResearchScreen {
    func candidateMembershipAnchor(_ canonicalSymbol: String) -> String {
        "candidateMembershipAnchor-\(canonicalSymbol)"
    }

    @ViewBuilder
    func candidateMembershipLocateCurrentButton() -> some View {
        let currentSymbol = parsedSymbol?.canonical
        let canLocateCurrent = currentSymbol != nil
            && candidateMemberships.memberships.contains { $0.symbol == currentSymbol }
        Button {
            focusesCurrentMembership.toggle()
            if focusesCurrentMembership {
                guard let currentSymbol, canLocateCurrent else {
                    focusesCurrentMembership = false
                    return
                }
                pendingDecisionWorkspaceScrollTarget = candidateMembershipAnchor(currentSymbol)
            }
        } label: {
            Label(focusesCurrentMembership ? "显示全部" : "定位当前标的", systemImage: "scope")
        }
        .buttonStyle(.bordered)
        .disabled(!focusesCurrentMembership && !canLocateCurrent)
        .accessibilityIdentifier("candidateMembershipLocateCurrent")
    }

    func currentCandidateMembership() -> CandidateMembershipData? {
        guard let currentSymbol = parsedSymbol?.canonical else { return nil }
        return uniqueActiveCandidateMembership(for: currentSymbol, in: candidateMemberships)
    }

    func dailyWorkspacePicker(
        _ options: [DailyWorkspaceOption],
        selectedID: String,
        tint: Color,
        accessibilityPrefix: String,
        onSelect: @escaping (String) -> Void
    ) -> some View {
        DailyWorkspacePicker(
            options: options,
            selectedID: selectedID,
            tint: tint,
            accessibilityPrefix: accessibilityPrefix,
            onSelect: onSelect
        )
    }

    func dailyDecisionRingsHero(layout: DailyWorkbenchLayoutMetrics) -> some View {
        let nextStep = dailyDecisionNextStep
        return VStack(spacing: 12) {
            HStack(spacing: 8) {
                Text("五层研究年轮")
                    .font((layout.accessibilityText ? Font.callout : Font.caption).weight(.bold))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualDecisionRingsTitle")
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 4)

            ZStack {
                StatusRingsOverview(
                    canonicalSymbol: parsedSymbol?.canonical ?? "未选择",
                    statusByLayer: dailyDecisionRingStatuses,
                    layout: layout,
                    selectedLayer: selectedDecisionLayer,
                    nextStepLayer: nextStep.layer
                )
                .scaleEffect(layout.accessibilityText ? 0.9 : 0.68)
            }
            .frame(maxWidth: .infinity, minHeight: 220, maxHeight: 220)
            .clipped()
        }
        .cardStyle(padding: layout.cardPadding)
    }

    var researchFigmaHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("研究")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
            Spacer(minLength: 8)
            Text("只读 / Advisory Only")
                .font(.caption.weight(.medium))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .padding(.horizontal, 12)
                .frame(width: 136, height: 32)
                .background(OwnerExperienceStyle.cardBackground, in: Capsule())
                .overlay(Capsule().stroke(OwnerExperienceStyle.subtleBorder, lineWidth: 1))
        }
        .frame(height: 72)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("研究，只读 / Advisory Only")
    }

    var researchFigmaIdentityCard: some View {
        HStack(alignment: .center, spacing: 12) {
            StockMonogram(text: researchFigmaMonogram, size: 64)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(selectedMembership?.research.name ?? "名称待补齐")
                        .font(.headline)
                    Text(parsedSymbol?.canonical ?? "未选择")
                        .font(.headline.monospaced())
                }
                Text(selectedMembership == nil ? "尚未加入研究自选" : "owner-local / tracked · 证据包已冻结")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(selectedMembership == nil ? OwnerExperienceStyle.warning : OwnerExperienceStyle.success)
            }
            Spacer(minLength: 0)
        }
        .cardStyle(padding: 14)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchFigmaIdentityCard")
    }

    private var researchFigmaMonogram: String {
        let digits = (parsedSymbol?.canonical ?? "HK").filter(\.isNumber)
        let trimmed = String(digits.drop { $0 == "0" })
        return trimmed.isEmpty ? "HK" : trimmed
    }

    var researchFigmaCurrentLayerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("当前层 · \(selectedDecisionLayer.title)")
                    .font(.headline)
                Spacer(minLength: 8)
                Text(currentResearchWorkspaceTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.accent)
            }
            Text(selectedDecisionLayer == .evidence ? "官方材料 → 确认 → 冻结证据包" : "当前年轮只显示事实与可核对动作")
                .font(.caption)
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
            HStack(spacing: 8) {
                researchFigmaLayerButton("导入材料", workspace: .materials)
                researchFigmaLayerButton("确认材料", workspace: .fundamentals)
                researchFigmaLayerButton("冻结证据", workspace: .deepResearch)
            }
        }
        .cardStyle(padding: 14)
        .accessibilityIdentifier("researchFigmaCurrentLayerCard")
    }

    private func researchFigmaLayerButton(_ title: String, workspace: ResearchWorkspace) -> some View {
        Button(title) { selectResearchWorkspace(workspace) }
            .font(.caption.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 34)
            .background(workspace == currentResearchWorkspace ? OwnerExperienceStyle.accent : OwnerExperienceStyle.softBackground, in: Capsule())
            .foregroundStyle(workspace == currentResearchWorkspace ? Color.white : OwnerExperienceStyle.textPrimary)
            .buttonStyle(.plain)
            .accessibilityIdentifier("researchFigmaLayer-\(workspace.rawValue)")
    }

    func dailyWorkbenchBackdrop() -> some View {
        OwnerExperienceStyle.pageBackground
            .ignoresSafeArea()
    }

    func dailyDecisionLayerMenu() -> some View {
        Menu {
            dailyDecisionLayerMenuOptions()
        } label: {
            HStack(spacing: 10) {
                Label("切换年轮", systemImage: "circle.grid.2x2")
                    .font(.callout.weight(.semibold))
                Spacer(minLength: 8)
                Text(selectedDecisionLayer.title)
                    .foregroundStyle(selectedDecisionLayer.tint)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: OwnerExperienceStyle.compactCornerRadius))
            .overlay {
                RoundedRectangle(cornerRadius: OwnerExperienceStyle.compactCornerRadius)
                    .stroke(selectedDecisionLayer.tint.opacity(0.18), lineWidth: 1)
            }
        }
        .accessibilityIdentifier("dailyDecisionLayerMenu")
    }

    func dailyDecisionLayerToolbarMenu() -> some View {
        Menu {
            dailyDecisionLayerMenuOptions()
        } label: {
            Image(systemName: "circle.grid.2x2")
        }
        .accessibilityIdentifier("dailyDecisionLayerToolbarMenu")
        .accessibilityLabel("切换年轮")
        .accessibilityValue(selectedDecisionLayer.title)
        .help("切换年轮")
    }

    @ViewBuilder
    private func dailyDecisionLayerMenuOptions() -> some View {
        ForEach(DailyDecisionRingLayer.allCases) { layer in
            Button {
                showDailyDecisionLayer(layer)
            } label: {
                Label(layer.title, systemImage: layer.systemImage)
            }
            .accessibilityIdentifier("dailyDecisionLayerMenuOption-\(layer.rawValue)")
        }
    }

    func dailyDecisionLayerHeader() -> some View {
        HStack(spacing: 9) {
            Image(systemName: selectedDecisionLayer.systemImage)
                .foregroundStyle(selectedDecisionLayer.tint)
                .frame(width: 28, height: 28)
            Text(selectedDecisionLayer.title)
                .font(.headline)
            Spacer(minLength: 8)
            Circle()
                .fill(selectedDecisionLayer.tint)
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(dailyDecisionRingStatuses[selectedDecisionLayer] ?? "待查看")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityValue(parsedSymbol?.canonical ?? "未绑定标的")
        .accessibilityIdentifier("dailyDecisionLayerHeader")
    }

    // MARK: - 研究一级工作区

    /// 一级工作区完全由既有的年轮层与证据子工作区推导，不新增独立状态。
    var currentResearchWorkspace: ResearchWorkspace? {
        switch selectedDecisionLayer {
        case .candidate: return nil
        case .evidence: return ResearchWorkspace.workspace(for: selectedEvidenceWorkspace)
        case .portfolio: return .portfolio
        case .decision, .review: return .decisionReview
        }
    }

    var currentResearchWorkspaceTitle: String {
        currentResearchWorkspace?.title ?? "研究自选管理"
    }

    @ViewBuilder
    func researchWorkspaceChooser() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("研究工作区")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                Spacer(minLength: 8)
                Text(currentResearchWorkspaceTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.accent)
                    .accessibilityIdentifier("researchWorkspaceCurrentTitle")
            }
            dailyWorkspacePicker(
                ResearchWorkspace.allCases.map {
                    DailyWorkspaceOption(
                        id: $0.rawValue,
                        title: $0.title,
                        detail: $0.detail,
                        systemImage: $0.systemImage
                    )
                },
                selectedID: currentResearchWorkspace?.rawValue ?? "",
                tint: OwnerExperienceStyle.accent,
                accessibilityPrefix: "researchWorkspace"
            ) { rawValue in
                guard let workspace = ResearchWorkspace(rawValue: rawValue) else { return }
                selectResearchWorkspace(workspace)
            }
        }
        .padding(.horizontal, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchWorkspaceChooser")
    }

    func selectResearchWorkspace(_ workspace: ResearchWorkspace) {
        switch workspace {
        case .decisionReview:
            if selectedDecisionLayer != .review { selectedDecisionLayer = .decision }
        case .portfolio:
            selectedDecisionLayer = .portfolio
        default:
            selectedDecisionLayer = .evidence
            if let target = workspace.evidenceWorkspace(selected: selectedEvidenceWorkspace) {
                selectedEvidenceWorkspace = target
            }
        }
        // 显式选择工作区后再滚动到工作区顶部，不在标的或授权重载时自动滚动。
        pendingDecisionWorkspaceScrollTarget = "dailyWorkbenchTop"
    }

    @ViewBuilder
    func researchFocusedWorkspace(layout: DailyWorkbenchLayoutMetrics) -> some View {
        VStack(alignment: .leading, spacing: layout.sectionSpacing) {
            HStack(spacing: 8) {
                Image(systemName: currentResearchWorkspace?.systemImage ?? "text.badge.checkmark")
                    .foregroundStyle(currentResearchWorkspace?.tint ?? OwnerExperienceStyle.accent)
                Text(currentResearchWorkspaceTitle)
                    .font(.headline)
                Spacer(minLength: 8)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("researchWorkspaceTitle")
            Button {
                pendingDecisionWorkspaceScrollTarget = "researchInvestmentBriefTop"
            } label: {
                Label("返回当前判断", systemImage: "arrow.up.to.line")
                    .font(.callout)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchWorkspaceBackToJudgment")

            researchWorkspaceMembershipGap(layout: layout)
            researchWorkspaceContent(layout: layout)
        }
        .accessibilityIdentifier("researchFocusedWorkspace")
    }

    @ViewBuilder
    func researchWorkspaceMembershipGap(layout: DailyWorkbenchLayoutMetrics) -> some View {
        if parsedSymbol == nil {
            researchWorkspaceGapCard(
                title: "当前工作区还没有标的",
                missing: "缺失：材料、报告、估值与复盘都绑定具体标的；没有有效标的时工作区没有可核对的内容。",
                remedy: "补救：先在搜索里输入港股代码或别名，选中后再回到同一工作区核对。",
                actionTitle: nil,
                layout: layout
            )
        } else if selectedMembership == nil {
            researchWorkspaceGapCard(
                title: "当前工作区缺少研究身份",
                missing: "缺失：材料、报告、估值与复盘都绑定研究自选的标的与版本；这个标的还没有加入研究自选，所以工作区里没有可核对的内容。",
                remedy: "补救：把它加入研究自选，再加入后回到同一工作区核对。",
                actionTitle: "管理研究自选",
                layout: layout
            )
        }
    }

    @ViewBuilder
    private func researchWorkspaceGapCard(
        title: String,
        missing: String,
        remedy: String,
        actionTitle: String?,
        layout: DailyWorkbenchLayoutMetrics
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: "exclamationmark.triangle")
                .font(.callout.weight(.semibold))
                .foregroundStyle(OwnerExperienceStyle.warning)
            Text(missing)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(remedy)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle {
                Button {
                    showDailyDecisionLayer(.candidate, expandResult: true)
                } label: {
                    Label(actionTitle, systemImage: "plus.circle")
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("researchWorkspaceMembershipRemedy")
            }
        }
        .cardStyle(padding: layout.cardPadding)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchWorkspaceMembershipGap")
    }

    @ViewBuilder
    func researchWorkspaceContent(layout: DailyWorkbenchLayoutMetrics) -> some View {
        if let workspace = currentResearchWorkspace {
            switch workspace {
            case .materials:
                dailyWorkspacePicker(
                    [DailyEvidenceWorkspace.documents, .frozen].map {
                        DailyWorkspaceOption(id: $0.rawValue, title: $0.title, detail: $0.detail, systemImage: $0.systemImage)
                    },
                    selectedID: selectedEvidenceWorkspace.rawValue,
                    tint: DailyDecisionRingLayer.evidence.tint,
                    accessibilityPrefix: "researchMaterialsWorkspace"
                ) { rawValue in
                    guard let subWorkspace = DailyEvidenceWorkspace(rawValue: rawValue),
                          subWorkspace == .documents || subWorkspace == .frozen else { return }
                    selectedEvidenceWorkspace = subWorkspace
                }
                evidenceWorkspaceContent(selectedEvidenceWorkspace == .frozen ? .frozen : .documents)
            case .fundamentals:
                evidenceWorkspaceContent(.facts)
            case .valuation:
                evidenceWorkspaceContent(.valuation)
            case .deepResearch:
                researchQuestionTaskOverview()
                evidenceWorkspaceContent(.research)
            case .report:
                evidenceWorkspaceContent(.brief)
                todayResearchSection(layout: layout)
            case .decisionReview:
                dailyWorkspacePicker(
                    [DailyDecisionRingLayer.decision, .review].map {
                        DailyWorkspaceOption(
                            id: $0.rawValue,
                            title: $0.title,
                            detail: $0 == .decision
                                ? "条件判断 · 决策快照 · 边界检查"
                                : "学习摘要 · 复盘时间线 · 后续记录 · 本地知识",
                            systemImage: $0.systemImage
                        )
                    },
                    selectedID: selectedDecisionLayer.rawValue,
                    tint: DailyDecisionRingLayer.decision.tint,
                    accessibilityPrefix: "researchDecisionReviewWorkspace"
                ) { rawValue in
                    guard let layer = DailyDecisionRingLayer(rawValue: rawValue),
                          layer == .decision || layer == .review else { return }
                    selectedDecisionLayer = layer
                    if layer == .review, hasCurrentDecision {
                        selectedReviewWorkspace = currentSubmittedReview == nil ? .timeline : .learning
                    }
                }
                dailyDecisionLayerContent()
                researchOwnerActionReviewCard(layout: layout)
            case .portfolio:
                researchPortfolioWorkspace(layout: layout)
                dailyDecisionLayerContent()
            }
        } else {
            // 候选层（研究自选管理）继续沿用既有年轮内容路由。
            dailyDecisionLayerContent()
        }
    }
}
