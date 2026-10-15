import SwiftUI
struct TodayActionInboxCard: View {
    let refreshRevision: UInt64; let fallbackSymbol: String?
    let client: any TodayActionInboxFetching
    let openResearch: (String) -> Void; let openMarket: (String?) -> Void; let openAssets: () -> Void
    let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void; let openResearchToday: (TodayResearchNavigationTarget) -> Void
    let openResearchReview: (TodayReviewNavigationTarget) -> Void; let openResearchFormalDecision: (TodayFormalDecisionNavigationTarget) -> Void
    /// Figma 首屏把“研究进度”卡排在主行动卡与折叠队列行之间。由 Today 根视图注入视图，不复制收件箱状态。
    var progressSlot: AnyView? = nil
    @State var envelope = TodayActionInboxEnvelope.unavailable(message: "尚未读取 Today 行动收件箱。")
    @State var isLoading = false; @State var generation = 0
    @State var readIssue: String?
    @ObservedObject private var notificationRouter = TodayHighImpactNotificationRouter.shared; @State private var notificationNavigationMessage: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            primaryActionCard
            if let progressSlot { progressSlot }
            queuedWorkRow
        } .accessibilityElement(children: .contain) .accessibilityIdentifier("todayActionInboxCard") .task(id: "\(refreshRevision):\(notificationRouter.pendingTarget?.itemId ?? "none")") {
            await load()
        }
    }

    /// Figma 首屏第二条卡：一个标题、一行选择理由、一个全宽主按钮；长解释、来源与写操作仍全部保留在卡内展开项。
    private var primaryActionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(primaryActionableItem == nil ? "今日待办" : "今天最重要", systemImage: primaryActionableItem == nil ? "tray.full" : "star.fill") .font(.headline) .accessibilityIdentifier(primaryActionIdentifier)
                    .accessibilityLabel(primaryActionableItem.map(primaryActionVoiceOverLabel) ?? "今日待办")
                Spacer(minLength: 8)
            }
            if isLoading {
                ProgressView("正在读取最新行动")
                fallbackActions
            } else if sourceUnavailable {
                Label("今日行动暂不可用", systemImage: "exclamationmark.triangle.fill").font(.callout.weight(.semibold)).foregroundStyle(.orange).accessibilityIdentifier("todayActionInboxUnavailable")
                Text(envelope.status == .unauthorized ? "当前连接没有读取研究待办的权限；请检查连接设置后重试。" : "研究待办读取失败；没有把失败误报成“暂无待办”。").font(.caption).foregroundStyle(.secondary)
                Button("重新读取今日行动") { Task { await load() } }.buttonStyle(OwnerPrimaryActionButtonStyle()).disabled(isLoading)
                fallbackActions
            } else if let nextItem = primaryActionableItem {
                itemView(nextItem, isPrimary: true)
            } else {
                fallbackActions
                if envelope.status != .available {
                    DisclosureGroup("读取详情") {
                        Text(envelope.message) .font(.caption) .foregroundStyle(envelope.status == .empty ? Color.secondary : Color.orange) .fixedSize(horizontal: false, vertical: true) .padding(.top, 6) .accessibilityIdentifier("todayActionInboxUnavailable")
                    }
                }
            }
        }
        .cardStyle()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("todayPrimaryActionCard")
    }

    /// 只有真实存在主行动时才声称“今天最重要”；没有主行动时保留原来的待办标题。
    private var primaryActionIdentifier: String {
        guard let item = primaryActionableItem else { return "todayActionInboxHeader" }
        return item.kind == .researchCompleted ? "todayResearchOutcomeAction" : "todayNextAction"
    }

    /// 视觉首屏沿用 Figma 的“★ 今天最重要”，VoiceOver 仍说明这条行动是哪一类，文案语义与原来一致。
    private func primaryActionVoiceOverLabel(_ nextItem: TodayActionInboxItem) -> String {
        nextItem.kind == .researchCompleted ? "今天只做什么" : nextItem.kind == .materialChange ? "今天做什么" : "下一步"
    }

    /// Figma 首屏第四条：折叠队列行，只显示计数与“展开”；队列明细、比较范围、提醒设置和省略说明收在展开项里。
    private var queuedWorkRow: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 12) {
                Text(portfolioScopeSummary) .font(.caption) .foregroundStyle(.secondary).accessibilityIdentifier("todayPortfolioScopeSummary")
                if !secondaryActionableItems.isEmpty {
                    DisclosureGroup("其他待办 \(secondaryActionableItems.count) 项") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(secondaryActionableItems) { item in
                                itemView(item)
                            }
                        } .padding(.top, 8)
                    }
                }
                if let primary = primaryActionableItem {
                    DisclosureGroup("主行动依据与完成标准") {
                        primaryDetailsSection(primary)
                            .padding(.top, 6)
                    }
                    .accessibilityIdentifier("todayPrimaryDetails")
                }
                if !blockedItems.isEmpty {
                    DisclosureGroup("暂不可用的来源 \(blockedItems.count) 项") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(blockedItems) { item in
                                itemView(item)
                            }
                        } .padding(.top, 8)
                    }
                }
                if !completedItems.isEmpty {
                    DisclosureGroup("已处理 / 已完成 \(completedItems.count) 项") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(completedItems) { item in
                                itemView(item)
                            }
                        } .padding(.top, 8)
                    }
                }
                if !expiredItems.isEmpty {
                    DisclosureGroup("已过期 \(expiredItems.count) 项") { VStack(alignment: .leading, spacing: 8) { ForEach(expiredItems) { item in itemView(item) } }.padding(.top, 8) }.accessibilityIdentifier("todayExpiredActions")
                }
                if !laterItems.isEmpty {
                    DisclosureGroup("稍后处理 \(laterItems.count) 项") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(laterItems) { item in
                                itemView(item)
                            }
                        } .padding(.top, 8)
                    }.accessibilityIdentifier("todayLaterActions")
                }
                if let notificationNavigationMessage { Text(notificationNavigationMessage).font(.caption.weight(.semibold)).foregroundStyle(.orange).accessibilityIdentifier("todayNotificationNavigationStatus") }
                DisclosureGroup("提醒设置") {
                    TodayHighImpactNotificationControls(envelope: envelope, isLoading: isLoading)
                        .padding(.top, 8)
                }
                if envelope.omittedItemCount > 0 || envelope.omittedMembershipCount > 0 {
                    Text("已按固定上限省略 \(omissionLabel(envelope.omittedItemCount, cap: 500)) 项、\(omissionLabel(envelope.omittedMembershipCount, cap: 100)) 个成员。") .font(.caption) .foregroundStyle(.secondary)
                }
            } .padding(.top, 8)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("其他待办 \(secondaryActionableItems.count) · 阻塞 \(blockedItems.count) · 已处理/完成 \(completedItems.count)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                    .accessibilityIdentifier("todayActionInboxQueueSummary")
                Spacer(minLength: 8)
                Text("展开").font(.caption.weight(.semibold)).foregroundStyle(OwnerExperienceStyle.accent)
            } .frame(minHeight: 30)
        }
        .cardStyle(padding: 14)
    }
    private var actionableItems: [TodayActionInboxItem] { TodayMaterialChangePresentation.nextFirst(envelope.items.filter { $0.state == .new }) }; private var laterItems: [TodayActionInboxItem] { TodayMaterialChangePresentation.nextFirst(envelope.items.filter { $0.state == .later }) }; private var sourceUnavailable: Bool { envelope.status == .unavailable || envelope.status == .unauthorized }
    private var primaryActionableItem: TodayActionInboxItem? { actionableItems.first }
    private var secondaryActionableItems: [TodayActionInboxItem] { guard let primary = primaryActionableItem else { return [] }; return actionableItems.filter { $0.id != primary.id } }
    private var blockedItems: [TodayActionInboxItem] { envelope.items.filter { $0.state == .blocked } }; private var completedItems: [TodayActionInboxItem] { envelope.items.filter { $0.state == .resolved } }; private var expiredItems: [TodayActionInboxItem] { envelope.items.filter { $0.state == .expired } }
    private var fallbackActions: some View {
        let symbol = fallbackSymbol
        return VStack(alignment: .leading, spacing: 10) {
            Text(canClaimSavedMaterialsNoChange ? "已存资料暂无待处理变化" : noTrackedMembership ? "选择一只港股开始研究" : laterOnlyPending ? "已收起的待办仍在" : symbol.map { "继续关注 \($0)" } ?? "选择一只港股开始研究") .font(.callout.weight(.semibold))
            Text(isLoading
                 ? "读取行动时，仍可继续当前研究。"
                 : sourceUnavailable ? "今日行动尚未核对；先查看当前行情或研究判断，读取恢复后再更新优先顺序。" : canClaimSavedMaterialsNoChange ? "当前已保存资料未发现新的待处理事项；外部来源尚需按研究档案监控清单核对。今天只做什么：核对研究档案监控清单，确认外部来源没有遗漏，再继续观察。" : noTrackedMembership ? "当前没有持续跟踪的港股；去市场选择一只后开始研究。" : laterOnlyPending ? "有 \(laterItems.count) 项已折叠在“稍后处理”，仍属待处理；展开后可立即恢复为优先事项。" : blockedItems.isEmpty ? "存在过期或未完成事项，不能声称组合判断未变；请先重新读取对应股票。" : "当前有来源读取失败，请进入对应股票重新读取最新事实。") .font(.caption) .foregroundStyle(.secondary).accessibilityIdentifier(canClaimSavedMaterialsNoChange ? "todayNoChangeSummary" : "todayFallbackSummary")
            if let symbol, !noTrackedMembership { Button { openResearch(symbol) } label: { Label("继续研究", systemImage: "doc.text.magnifyingglass") } .buttonStyle(OwnerPrimaryActionButtonStyle()) .accessibilityIdentifier("todayFallbackResearch") }
            if symbol == nil || noTrackedMembership { Button { openMarket(nil) } label: { Label("选择市场标的", systemImage: "chart.line.uptrend.xyaxis") } .buttonStyle(OwnerPrimaryActionButtonStyle()).accessibilityIdentifier("todayFallbackMarket") }
            DisclosureGroup("其他入口") {
                HStack {
                    if let symbol { Button { openMarket(symbol) } label: { Label("查看市场", systemImage: "chart.line.uptrend.xyaxis") } .buttonStyle(.bordered).accessibilityIdentifier("todayFallbackMarket") }
                    Button { openAssets() } label: { Label("查看资产", systemImage: "briefcase") } .buttonStyle(.bordered).accessibilityIdentifier("todayFallbackAssets")
                }.padding(.top, 6)
            }
        } .ownerSubtleSurface() .accessibilityIdentifier("todayFallbackActions")
    }
    @ViewBuilder
    private func itemView(_ item: TodayActionInboxItem, isPrimary: Bool = false) -> some View {
        if isPrimary {
            primaryItemContent(item)
        } else {
            secondaryItemContent(item)
        }
    }

    /// 首屏主行动卡内容：标题 + 一行选择理由 + 调用既有主行动导航的按钮，其余解释折叠但不删除。
    private func primaryItemContent(_ item: TodayActionInboxItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(item.kind == .materialChange ? item.symbol : "\(item.symbol) · \(TodayMaterialChangePresentation.localizedResearchTitle(item.title))")
                .font(.title3.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
            Text(primarySelectionReason(item))
                .font(.caption)
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("todayPrimarySelectionReason")
            Button {
                open(item)
            } label: {
                Text("查看并处理")
                    .frame(maxWidth: .infinity, minHeight: 52)
            } .buttonStyle(OwnerPrimaryActionButtonStyle()) .accessibilityIdentifier("todayActionInboxOpen-\(item.order)")
        }
    }

    /// 长说明属于证据与记录层；首屏主行动卡只保留 Figma 的标题、理由和一个主按钮。
    private func primaryDetailsSection(_ item: TodayActionInboxItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            DisclosureGroup("发生了什么 / 为什么重要") {
                itemExplanation(item).padding(.top, 6)
            }
            DisclosureGroup("判断依据与完成标准") {
                itemDecisionBasis(item).padding(.top, 6)
            }
            sourceStatusDisclosure(item)
            if TodayMaterialChangeDispositionControls.supportsDisposition(item) {
                DisclosureGroup("稍后处理 / 已处理") {
                    TodayMaterialChangeDispositionControls(item: item, client: client, envelope: $envelope)
                        .padding(.top, 6)
                }
            }
        }
    }

    /// 其他 queue 条目沿用既有浅色底面；只有首屏主行动卡使用白色卡片样式。
    private func secondaryItemContent(_ item: TodayActionInboxItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            itemHeadline(item)
            if item.kind == .materialChange {
                TodayMaterialChangeSummaryView(item: item)
            } else {
                Text(TodayMaterialChangePresentation.userSummary(for: item)).font(.caption).fixedSize(horizontal: false, vertical: true)
            }
            sourceStatusDisclosure(item)
            if item.state == .expired {
                Text("来源已过期；不会打开旧事实。新版本来源出现后会自动重新进入 Today。") .font(.caption.weight(.semibold)) .foregroundStyle(.orange) .accessibilityIdentifier("todayActionInboxExpired-\(item.order)")
                Button { openResearch(item.symbol) } label: { Label("去研究读取新来源", systemImage: "arrow.clockwise.circle") } .buttonStyle(.bordered) .accessibilityIdentifier("todayActionInboxExpiredRefresh-\(item.order)")
            } else if item.state != .blocked {
                Button {
                    open(item)
                } label: {
                    Label(TodayMaterialChangePresentation.openLabel(for: item), systemImage: "arrow.right.circle")
                } .buttonStyle(OwnerPrimaryActionButtonStyle()) .accessibilityIdentifier("todayActionInboxOpen-\(item.order)")
                if TodayMaterialChangeDispositionControls.supportsDisposition(item) {
                    TodayMaterialChangeDispositionControls(item: item, client: client, envelope: $envelope)
                }
            } else {
                Text(item.source.lane == "market_quote" ? "行情来源不可用；请到 Market 明确刷新。" : "来源失败：未展示旧事实或部分事实；请进入该股票重新读取。") .font(.caption.weight(.semibold)) .foregroundStyle(.orange) .accessibilityIdentifier("todayActionInboxSourceFailure-\(item.order)")
                Button {
                    if item.source.lane == "market_quote" { openMarket(item.symbol) }
                    else { openResearch(item.symbol) }
                } label: {
                    Label(item.source.lane == "market_quote" ? "去市场重新读取" : "去研究重新读取", systemImage: "arrow.right.circle")
                } .buttonStyle(.bordered) .accessibilityIdentifier("todayActionInboxRecover-\(item.order)")
            }
        }
        .ownerSubtleSurface()
    }

    private func itemHeadline(_ item: TodayActionInboxItem) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(item.kind == .materialChange ? item.symbol : "\(item.symbol) · \(TodayMaterialChangePresentation.localizedResearchTitle(item.title))") .font(item.kind == .materialChange ? .title3.weight(.bold) : .callout.weight(.semibold)) .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Text("\(TodayMaterialChangePresentation.stageLabel(for: item)) · \(sourceResearchStateLabel(for: item))").font(.caption2.weight(.semibold)).foregroundStyle(item.state == .blocked ? .orange : .secondary)
        }
    }

    @ViewBuilder
    private func itemExplanation(_ item: TodayActionInboxItem) -> some View {
        if item.kind == .materialChange {
            VStack(alignment: .leading, spacing: 6) {
                TodayMaterialChangeSummaryView(item: item)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("发生了什么").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(TodayMaterialChangePresentation.userSummary(for: item)).font(.caption).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier(item.kind == .researchCompleted ? "todayResearchOutcomeWhat" : "todayPrimarySummary")
                Text("为什么重要：\(primaryImportance(item))").font(.caption.weight(.semibold)).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("todayPrimaryImportance")
            }
        }
    }

    private func itemDecisionBasis(_ item: TodayActionInboxItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("今天只做什么：\(primaryOnlyAction(item))")
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("todayPrimaryOnlyAction")
            Text("影响哪个假设：\(primaryHypothesisImpact(item))")
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("todayPrimaryHypothesis")
            Text("做到什么算完成：\(primaryCompletionHint(item))")
                .font(.caption.weight(.semibold))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("todayPrimaryCompletion")
            Text("研究机会成本：\(primaryOpportunityCost(item))")
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("todayPrimaryOpportunityCost")
            if item.kind != .researchCompleted && item.kind != .materialChange {
                Text("判断变化状态：需读取已保存报告并与上一版比较，不能由待办状态推断。")
                    .font(.caption.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayResearchOutcomeUnchanged")
                Text("下一观察条件：出现新公告、核心经营事实变化，或现有来源过期。")
                    .font(.caption)
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayResearchOutcomeNextObservation")
            }
        }
    }

    private func sourceStatusDisclosure(_ item: TodayActionInboxItem) -> some View {
        DisclosureGroup("来源与状态") {
            VStack(alignment: .leading, spacing: 4) {
                TodayActionContinuityView(item: item)
                Text(TodayMaterialChangeDispositionControls.isSourceResearchChange(item)
                     ? "此条来源提醒可单独处理或重开；研究核对、报告与正式复盘状态不因此改变。"
                     : TodayMaterialChangePresentation.completionHint(for: item)).font(.caption.weight(.semibold)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("第 \(item.order) 项 · \(item.symbol) · \(TodayMaterialChangePresentation.stageLabel(for: item)) · \(sourceResearchStateLabel(for: item))") .accessibilityIdentifier("todayActionInboxIdentity-\(item.order)")
                Text("成员 \(item.membership.id) v\(item.membership.version) · 优先级 \(item.priority)") .accessibilityIdentifier("todayActionInboxMembership-\(item.order)")
                Text("来源 \(TodayMaterialChangePresentation.sourceTypeLabel(item.source.sourceType)) · 截止 \(item.source.effectiveAt ?? "未记录") · 数据时点 \(item.source.asOf ?? "未记录") · \(TodayMaterialChangePresentation.freshnessLabel(item.source.freshness))") .accessibilityIdentifier("todayActionInboxSource-\(item.order)")
                Text("来源身份：\(sourceIdentityLine(item.source))") .fixedSize(horizontal: false, vertical: true) .accessibilityIdentifier("todayActionInboxSourceIdentity-\(item.order)")
                if let task = item.researchTarget?.task {
                    Text("任务 #\(task.id) · pack #\(task.evidencePackId) · \(task.completedAt.map { "完成 \($0)" } ?? "处理中")") .accessibilityIdentifier("todayActionInboxTask-\(item.order)")
                }
            } .padding(.top, 4) .font(.caption2.monospaced()) .foregroundStyle(.secondary)
        }
    }
    private func sourceResearchStateLabel(for item: TodayActionInboxItem) -> String {
        if TodayMaterialChangeDispositionControls.isSourceResearchChange(item), item.state == .resolved {
            return "提醒已处理"
        }
        return TodayMaterialChangePresentation.stateLabel(for: item)
    }
    private func open(_ item: TodayActionInboxItem) {
        if item.kind == .candidateFound || item.kind == .researchProfileReviewDue || ["research_decision_update", "weekly_research_review"].contains(item.source.sourceType) {
            openResearchCandidate(
                TodayCandidateNavigationTarget(
                    membershipId: item.membership.id,
                    membershipVersion: item.membership.version,
                    symbol: item.symbol, opensResearchProfileReview: item.kind == .researchProfileReviewDue
                )
            )
        } else if let target = item.researchTarget {
            openResearchToday(
                TodayResearchNavigationTarget(
                    requestId: UUID(),
                    symbol: item.symbol,
                    membershipId: item.membership.id,
                    membershipVersion: item.membership.version,
                    itemId: target.itemId,
                    preferredLayer: target.preferredLayer == "portfolio" ? .portfolio : .evidence,
                    report: target.report.map { TodayResearchReportNavigationTarget(id: $0.id, version: $0.version, evidencePackId: $0.evidencePackId) },
                    task: target.task,
                    source: TodayResearchSourceNavigationTarget(source: item.source)
                )
            )
        } else if let event = item.reviewEvent {
            if item.kind == .formalDecisionDue, let target = TodayFormalDecisionNavigationTarget(event: event) {
                openResearchFormalDecision(target)
            } else if let target = TodayReviewNavigationTarget(
                event: event,
                membershipId: item.membership.id,
                membershipVersion: item.membership.version
            ) {
                openResearchReview(target)
            }
        }
    }
    private func omissionLabel(_ count: Int, cap: Int) -> String { count >= cap ? "至少 \(cap)" : "\(count)" }
    private var portfolioScopeSummary: String {
        if noTrackedMembership { return "当前还没有持续跟踪的港股；去市场选择一只后开始研究。" }
        guard envelope.status == .available || envelope.status == .empty else {
            return "正在从全部持续跟踪股票中读取今天最值得处理的一件事。"
        }
        return "已比较 \(envelope.trackedMembershipCount) 只持续跟踪股票，只显示最优先的一件事；其他事项保持折叠。"
    }
    private var canClaimSavedMaterialsNoChange: Bool {
        (envelope.status == .available || envelope.status == .empty)
            && envelope.trackedMembershipCount > 0
            && actionableItems.isEmpty
            && laterItems.isEmpty
            && blockedItems.isEmpty
            && expiredItems.isEmpty
            && readIssue == nil
    }
    private var laterOnlyPending: Bool {
        actionableItems.isEmpty && blockedItems.isEmpty && expiredItems.isEmpty && !laterItems.isEmpty
    }
    private var noTrackedMembership: Bool {
        (envelope.status == .available || envelope.status == .empty)
            && envelope.trackedMembershipCount == 0
    }
    private func primarySelectionReason(_ item: TodayActionInboxItem) -> String {
        if item.kind == .materialChange {
            return "出现实质情景变化，先核对它是否支持或削弱当前假设。"
        }
        let tiedCount = secondaryActionableItems.filter { $0.priority == item.priority }.count
        if item.source.freshness == "missing" && tiedCount > 0 {
            return "这项与另外 \(tiedCount) 项并列为最高研究机会成本；按稳定顺序先处理一只。"
        }
        return "这是当前组合待办中优先级最高的一项；不会据此自动形成正式决定。"
    }
    private func primaryImportance(_ item: TodayActionInboxItem) -> String {
        if item.kind == .research {
            if item.summary.contains("超过任务租约") { return "研究任务可能停滞；不先刷新同一任务，就不能知道结果是否已经可用。" }
            if item.summary.contains("已绑定当前冻结证据") { return "综合结果已经准备好；只有你明确吸收后才会形成可审阅的报告修订。" }
            if item.state == .later || item.summary.contains("仍在处理中") { return "研究任务仍在处理中；读取同一任务的最新状态，不会重复发起。" }
            return "这是当前证据链最先需要补齐或核对的一步，完成后才能形成可审阅判断。"
        }
        return switch item.kind {
        case .candidateFound: "组合研究范围出现新成员，需要先建立可持续复核的研究档案。"
        case .researchProfileReviewDue: "研究档案已到复核时间，继续沿用前需要确认假设和观察条件是否仍成立。"
        case .research: "这是当前证据链最先需要补齐或核对的一步，完成后才能形成可审阅判断。"
        case .researchCompleted: "新报告尚未由你明确处理，系统不会自动把它当成正式判断。"
        case .materialChange: "这条变化可能影响当前假设，需要先核对再决定是否更新判断。"
        case .marketAnomaly: "市场价格出现异常，先核对公开来源；价格本身不改变正式研究。"
        case .formalDecisionDue: "报告已经确认，但尚未由你明确形成正式行动记录。"
        case .reviewDue: "正式决定已经发生，只有复盘后才能知道当时判断和过程是否需要修正。"
        case .dailyTracking: "当前判断需要按下一验证条件复核；没有复核结果就不能说判断仍然成立。"
        case .sourceFailure: "关键来源暂不可用，恢复前不能把旧事实当作今天的结论。"
        }
    }
    private func primaryHypothesisImpact(_ item: TodayActionInboxItem) -> String {
        if item.summary.hasSuffix(" Hypothesis impact: supports.") { return "目前证据更支持当前假设，仍需核对后再决定是否更新判断。" }
        if item.summary.hasSuffix(" Hypothesis impact: weakens.") { return "目前证据对当前假设不利，应先复核风险和反证。" }
        if item.summary.hasSuffix(" Hypothesis impact: unknown.") { return "目前还不能判断会支持还是削弱当前假设，先核对这条变化。" }
        if item.kind == .research, item.title == "Add traceable research material" {
            return "影响能否用可追溯材料验证当前假设；材料补齐前不改变判断。"
        }
        return switch item.kind {
        case .candidateFound, .researchProfileReviewDue: "影响研究假设能否被持续复核；方向待核对。"
        case .research, .researchCompleted: "影响现有证据是否足以支持可审阅判断；不会自动改变判断。"
        case .materialChange: "目前还不能判断会支持还是削弱当前假设，先核对这条变化。"
        case .marketAnomaly: "价格变化的公司特异性根因仍未知；不自动触发正式 Review。"
        case .formalDecisionDue: "不改变研究假设；等待 Owner 明确记录是否采用已确认报告。"
        case .reviewDue, .dailyTracking: "影响是否继续沿用原判断及其下一验证条件。"
        case .sourceFailure: "恢复来源前不能确认判断是否变化。"
        }
    }
    private func primaryOnlyAction(_ item: TodayActionInboxItem) -> String {
        if item.kind == .researchCompleted { return "核对研究结果并决定判断是否变化；今天只处理 \(item.symbol) 的这份结果，不自动形成正式决定或交易动作。" }
        if item.kind == .research, item.summary.contains("超过任务租约") { return "先刷新 \(item.symbol) 的同一研究任务；若仍停滞，再由你明确取消并重新准备，不重复发起。" }
        if item.kind == .research, item.summary.contains("已绑定当前冻结证据") { return "明确吸收 \(item.symbol) 的综合结果，生成报告修订后再审阅。" }
        if item.kind == .research, (item.state == .later || item.summary.contains("仍在处理中")) { return "稍后刷新 \(item.symbol) 的同一研究任务，读取最新状态，不重复发起。" }
        if item.kind == .research, item.title == "Add traceable research material" {
            return "只为 \(item.symbol) 导入并核对一条公司官方材料；今天不同时展开其他股票。"
        }
        if item.kind == .materialChange { return "只核对 \(item.symbol) 这条变化是否影响当前假设。" }
        return "只完成“\(TodayMaterialChangePresentation.localizedResearchTitle(item.title))”；不自动生成正式判断或交易动作。"
    }
    private func primaryOpportunityCost(_ item: TodayActionInboxItem) -> String {
        let deferred = uniqueSymbols(in: secondaryActionableItems)
        guard !deferred.isEmpty else { return "当前没有其他未处理行动需要暂缓。" }
        let tied = uniqueSymbols(in: secondaryActionableItems.filter { $0.priority == item.priority })
        let symbols = deferred.joined(separator: "、")
        if !tied.isEmpty {
            return "\(tied.joined(separator: "、")) 与 \(item.symbol) 同属当前最高研究缺口；先处理 \(item.symbol) 的代价是 \(symbols) 的判断稍后复核。"
        }
        return "暂缓 \(symbols)；代价是这些股票的新变化或研究缺口会稍后复核，不代表预期收益更低。"
    }
    private func primaryCompletionHint(_ item: TodayActionInboxItem) -> String {
        if TodayMaterialChangeDispositionControls.isSourceResearchChange(item) {
            return "核对来源后，可单独标记这条提醒已处理；研究判断、报告和正式复盘仍按各自流程记录。"
        }
        return item.kind == .researchCompleted
            ? "由你明确标记判断增强、削弱、不变或仍待核对，并保留下一观察条件；未确认前不会成为正式判断。"
            : TodayMaterialChangePresentation.completionHint(for: item)
    }
    private func uniqueSymbols<S: Sequence>(in items: S) -> [String] where S.Element == TodayActionInboxItem {
        items.reduce(into: [String]()) { symbols, item in
            if !symbols.contains(item.symbol) { symbols.append(item.symbol) }
        }
    }
    private func sourceIdentityLine(_ source: TodayActionInboxSourceRef) -> String {
        "\(source.lane):\(source.id) · \(source.version.map { "v\($0)" } ?? "版本未记录") · \(source.sourceFingerprint.map { "指纹 \($0)" } ?? "指纹未记录")"
    }
    func openPendingNotification(in loaded: TodayActionInboxEnvelope) {
        guard let target = notificationRouter.pendingTarget else { return }
        guard loaded.status == .available || loaded.status == .empty else { notificationNavigationMessage = "Today 读取失败；已保留通知事项，请重试。"; return }
        let matches = loaded.items.filter(target.matches); notificationRouter.consume(target)
        guard matches.count == 1, let item = matches.first, item.state == .new else { notificationNavigationMessage = "通知对应事项已变化；已重新读取 Today，未打开旧事实。"; return }
        notificationNavigationMessage = nil; open(item)
    }
}

extension TodayActionInboxCard {
    /// 与既有初始化器相同，只额外注入排在主行动卡与折叠队列行之间的进度卡视图。
    init(
        refreshRevision: UInt64, fallbackSymbol: String?, client: any TodayActionInboxFetching,
        openResearch: @escaping (String) -> Void, openMarket: @escaping (String?) -> Void, openAssets: @escaping () -> Void,
        openResearchCandidate: @escaping (TodayCandidateNavigationTarget) -> Void,
        openResearchToday: @escaping (TodayResearchNavigationTarget) -> Void,
        openResearchReview: @escaping (TodayReviewNavigationTarget) -> Void,
        openResearchFormalDecision: @escaping (TodayFormalDecisionNavigationTarget) -> Void,
        progressSlot: AnyView?
    ) {
        self.refreshRevision = refreshRevision; self.fallbackSymbol = fallbackSymbol
        self.client = client
        self.openResearch = openResearch; self.openMarket = openMarket; self.openAssets = openAssets
        self.openResearchCandidate = openResearchCandidate; self.openResearchToday = openResearchToday
        self.openResearchReview = openResearchReview; self.openResearchFormalDecision = openResearchFormalDecision
        self.progressSlot = progressSlot
    }
}
