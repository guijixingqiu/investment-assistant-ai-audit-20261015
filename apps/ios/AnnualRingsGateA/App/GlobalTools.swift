import SwiftUI
import Combine
enum GlobalToolSheet: String, Identifiable {
    case search
    case assistant
    case connection
    var id: String { rawValue }
}

struct ConnectionSettingsToolbarButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "gearshape")
                .font(.system(size: 15, weight: .semibold))
#if OWNER_CLIENT
                .foregroundStyle(Theme.textPrimary)
#else
                .foregroundStyle(.primary)
#endif
        }
        .accessibilityLabel("连接设置")
        .accessibilityIdentifier("globalConnectionSettings")
    }
}

struct GlobalToolButtons: ToolbarContent {
    @Binding var presentedSheet: GlobalToolSheet?
    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                presentedSheet = .search
            } label: {
                Image(systemName: "magnifyingglass")
            }
            .accessibilityLabel("全局港股搜索")
            .help("全局港股搜索")
            .accessibilityIdentifier("globalHongKongSearch")
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                presentedSheet = .connection
            } label: {
                Image(systemName: "antenna.radiowaves.left.and.right")
            }
            .accessibilityLabel("连接设置")
            .help("连接设置")
            .accessibilityIdentifier("globalConnectionSettings")
            Button {
                presentedSheet = .assistant
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                    Text("助手")
                }
            }
            // Platform blue keeps this native toolbar control on its default contrast.
            .tint(.blue)
            .accessibilityLabel("研究报告助手")
            .help("研究报告助手")
            .accessibilityIdentifier("globalAssistant")
        }
    }
}
struct GlobalToolsToolbarModifier: ViewModifier {
    @Binding var presentedSheet: GlobalToolSheet?
    func body(content: Content) -> some View {
        content.toolbar {
            GlobalToolButtons(presentedSheet: $presentedSheet)
        }
    }
}
extension View {
    func globalToolsToolbar(_ presentedSheet: Binding<GlobalToolSheet?>) -> some View {
        modifier(GlobalToolsToolbarModifier(presentedSheet: presentedSheet))
    }
}
struct GlobalSearchSheet: View {
    @Binding var symbolInput: String
    @Binding var selectedTab: AnnualRingsTab
    let clearPendingResearchNavigation: () -> Void
    let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void
    @Environment(\.dismiss) var dismiss
    @State var input = ""
    @State var message = "可输入 HK.#####、#####.hk 或公司名。优先读取 Futu/OpenD 港股基础资料；不可用时会明确降级到本地已收录股票。结果不是推荐或排名。"
    @State var results: [KnownHongKongStock] = []
    @State var isSearching = false
    @State private var searchRequestId = UUID()
    @State var candidateNavigationRequestId = UUID()
    private let client = MarketQuoteClient(baseURL: AppEnvironment.baseURL(), authToken: AppEnvironment.authToken(), authHeaderName: AppEnvironment.authHeaderName())
    var body: some View {
        NavigationStack {
            Group {
#if OWNER_CLIENT
                antigravitySearchBody
#else
            Form {
                TextField("HK.#####", text: $input)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("globalSearchInput")
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    Task { await search() }
                } label: {
                    Label(isSearching ? "搜索中" : "搜索港股", systemImage: "text.magnifyingglass")
                }
                .disabled(isSearching || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("globalKnownStockSearch")
                if !results.isEmpty {
                    Section("港股搜索结果") {
                        ForEach(results, id: \.symbol) { result in
                            Button {
                                input = result.symbol
                                message = "已选择 \(result.name ?? "公司名未记录")（\(result.symbol)）。"
                            } label: {
                                HStack {
                                    Text(result.name ?? "公司名未记录")
                                    Spacer()
                                    Text(result.symbol).font(.caption.monospaced())
                                }
                            }
                            .accessibilityIdentifier("globalSearchResult-\(result.symbol)")
                        }
                    }
                }
                Button("到市场查看并选择是否加入研究自选") { apply(tab: .market) }
                Button("打开已有研究") {
                    Task { await openExistingResearch() }
                }
            }
#endif
            }
            .scrollContentBackground(.hidden)
            .background(Color(.systemGroupedBackground))
            .navigationTitle("全局港股搜索")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .onChange(of: input) { _, _ in
                searchRequestId = UUID()
                candidateNavigationRequestId = UUID()
                isSearching = false
                results = []
            }
            .onDisappear {
                searchRequestId = UUID()
                candidateNavigationRequestId = UUID()
                isSearching = false
            }
        }
    }
    @MainActor
    func search() async {
        let query = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, query.count <= 80 else {
            message = "搜索内容必须为 1 到 80 个字符。"
            return
        }
        let requestId = UUID()
        searchRequestId = requestId
        isSearching = true
        results = []
        message = "正在读取 Futu/OpenD 港股基础资料。"
        defer {
            if searchRequestId == requestId { isSearching = false }
        }
        do {
            let envelope = try await client.searchHongKongStocks(query: query)
            guard searchRequestId == requestId, input.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            results = envelope.status == .available ? envelope.results : []
            message = envelope.message
        } catch {
            guard searchRequestId == requestId else { return }
            message = "港股搜索不可用：\(error.localizedDescription)"
        }
    }
}
struct GlobalAssistantSheet: View {
    @Environment(\.scenePhase) var scenePhase
    @Binding var symbolInput: String
    @Binding var selectedTab: AnnualRingsTab
    @Binding var selectedDecisionLayer: DailyDecisionRingLayer
    let clearPendingResearchNavigation: () -> Void
    let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void
    let openReportRevision: (TodayReportRevisionNotice) -> Void
    @Environment(\.dismiss) var dismiss
    @State var question = ""
    @State var correction = ""
    @State var response: ResearchEvidenceQuestionEnvelope?
    @State var answeredReport: TwoLayerReportData?
    @State var answeredMembership: CandidateMembershipData?
    @State var answeredMembershipKey: String?
    struct QuestionRetryContext {
        let question: String
        let report: TwoLayerReportData?
        let membershipKey: String?
        let conversation: [ResearchEvidenceQuestionConversationTurn]
        let sessionId: String
        let carrySummary: String?
        let carryFromSessionId: String?
    }
    @State var pendingQuestionRetry: QuestionRetryContext?
    @State var conversation: [ResearchEvidenceQuestionConversationTurn] = []
    var activeAssistantSessionCount: Int { pendingQuestionRetry?.conversation.count ?? conversation.count }
    @State var sessionId = "legacy"
    @State var carrySummary: String?
    @State var carryFromSessionId: String?
    @State var historySessions: [ResearchTemporaryConversationSnapshot] = []
    @State var historySelection: String?
    @State var newSessionDraft = ""
    @State var newSessionConfirmed = false
    @State var newSessionSourceIdentity: String?
    @AppStorage(researchTemporaryConversationRetentionDefaultsKey)
    var temporaryConversationRetentionRaw = ResearchTemporaryConversationRetention.thirtyDays.rawValue
    @State var temporaryConversationDeletionPending = false
    @State var observedTemporaryClearMarker: String?
    @State var message = "基于当前研究报告中的已核实事实、反证和待核实项回答；回答本身只读，只有你再次明确保存修正才会写入研究材料。"
    @State var isAsking = false
    @State var requestLane = GlobalAssistantEvidenceQuestionRequestLane()
    @State var evidenceQuestionReservation = ResearchDocumentIdempotencyReservation()
    @State var candidateNavigationRequestId = UUID()
    @State var cloudAiPolicy: CloudAiPolicyEnvelope?
    @State var cloudAiPolicyMessage = "正在读取当前 Owner 的 Cloud AI 授权。"
    @State var currentResearchReportReady = false
    @State var currentResearchReportMessage = "正在核对当前版本研究报告。"
    @State var cloudAiPolicyRequestId = UUID()
    @State var isLoadingCloudAiPolicy = false
    let client = ResearchClient(
        baseURL: AppEnvironment.baseURL(),
        authToken: AppEnvironment.authToken(),
        authHeaderName: AppEnvironment.authHeaderName(),
        writeAuthToken: AppEnvironment.writeAuthToken(),
        writeAuthHeaderName: AppEnvironment.writeAuthHeaderName()
    )
    var body: some View {
        NavigationStack {
            Group {
#if OWNER_CLIENT
                antigravityAssistantBody
#else
            Form {
                Section("当前研究标的") {
                    Text(SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical ?? "未选择有效港股")
                        .font(.headline.monospaced())
                    Button("打开研究工作区") {
                        Task { await openCurrentResearch() }
                    }
                    .disabled(SecuritySymbol.parseHongKongAlias(symbolInput) == nil)
                }
                globalAssistantCloudAiPolicySection
                Section("追问当前报告") {
                    globalAssistantSessionControls
                    if let report = answeredReport {
                        ForEach(conversation) { turn in
                            globalAssistantTurn(turn, report: report)
                        }
                    }
                    TextField("继续追问，例如：这项反证会怎样影响结论？", text: $question, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .disabled(isAsking || activeAssistantSessionCount >= researchEvidenceQuestionSessionLimit)
                        .accessibilityIdentifier("globalAssistantQuestion")
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            Button("核查失效条件") {
                                question = "根据当前报告，最关键的失效条件是什么？对应的可观测证据有哪些？"
                            }
                            .accessibilityIdentifier("globalAssistantQuickInvalidation")
                            Button("总结主要反证") {
                                question = "当前报告中最强的反证是什么？它会怎样改变当前判断？"
                            }
                            .accessibilityIdentifier("globalAssistantQuickCounterevidence")
                            Button("列出证据缺口") {
                                question = "哪些关键事实仍未核实？下一步最该补齐什么来源？"
                            }
                            .accessibilityIdentifier("globalAssistantQuickEvidenceGaps")
                        }
                        .buttonStyle(.bordered)
                        .font(.caption)
                    }
                    .disabled(isAsking || activeAssistantSessionCount >= researchEvidenceQuestionSessionLimit
                        || cloudAiPolicy?.isEnabled != true
                        || !currentResearchReportReady || AppEnvironment.writeAuthToken() == nil)
                    Text(currentResearchReportMessage)
                        .font(.caption)
                        .foregroundStyle(currentResearchReportReady ? .green : .orange)
                        .accessibilityIdentifier("globalAssistantReportReadiness")
                    Button {
                        Task { await ask() }
                    } label: {
                        Label(isAsking ? "回答中" : "询问助手", systemImage: "text.bubble")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isAsking || activeAssistantSessionCount >= researchEvidenceQuestionSessionLimit
                        || cloudAiPolicy?.isEnabled != true
                        || !currentResearchReportReady
                        || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || AppEnvironment.authToken() == nil || AppEnvironment.writeAuthToken() == nil)
                    .accessibilityIdentifier("globalAssistantAsk")
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("globalAssistantMessage")
                    if AppEnvironment.authToken() == nil || AppEnvironment.writeAuthToken() == nil {
                        Text("此客户端独立于日常 App，尚未配置后端读取与写入令牌。请关闭助手，使用右上角齿轮打开连接设置。")
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .accessibilityIdentifier("globalAssistantMissingCredentials")
                    }
                    if let response, response.status != "available" {
                        Text("当前无法完成回答")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                            .accessibilityIdentifier("globalAssistantFailClosed")
                        Text(response.message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        globalAssistantSendManifest(response)
                        Text("没有采用旧回答，也没有修改报告、决定或资产记录。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let latest = conversation.last?.response,
                       let report = answeredReport {
                        TextField("写下要修正或继续核实的内容", text: $correction, axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("globalAssistantCorrection")
                        HStack {
                            Button("形成报告修订草稿") {
                                openAssistantHandoff(
                                    .reportRevision(correction.trimmingCharacters(in: .whitespacesAndNewlines)),
                                    response: latest,
                                    report: report
                                )
                            }
                            .buttonStyle(.bordered)
                            .disabled(!validAssistantCorrection)
                            .accessibilityIdentifier("globalAssistantOpenCurrentReportRevision")
                            Button("加入研究待办") {
                                openAssistantHandoff(
                                    .researchTodo(correction.trimmingCharacters(in: .whitespacesAndNewlines)),
                                    response: latest,
                                    report: report
                                )
                            }
                            .buttonStyle(.bordered)
                            .disabled(!validAssistantCorrection)
                            .accessibilityIdentifier("globalAssistantCreateResearchTodo")
                        }
                    }
                }
                Section("安全边界") {
                    Text("回答只读、仅供研究；你明确保存的修正可进入研究材料，但不会自动确认报告、形成正式决定、修改账户或生成交易。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("本机临时对话") {
                    Picker("保留期", selection: $temporaryConversationRetentionRaw) {
                        ForEach(ResearchTemporaryConversationRetention.allCases, id: \.rawValue) {
                            Text($0.title).tag($0.rawValue)
                        }
                    }
                    Button("恢复当前报告临时对话") {
                        Task { await restoreTemporaryConversation() }
                    }
                    .disabled(isAsking)
                    Button("保存当前临时对话") {
                        saveTemporaryConversationWithMessage()
                    }
                    .disabled(answeredMembership == nil || answeredReport == nil)
                    Button(
                        temporaryConversationDeletionPending
                            ? "再次点击确认删除全部本机临时研究"
                            : "删除全部本机临时研究"
                    ) {
                        deleteAllTemporaryConversations()
                    }
                    .foregroundStyle(.red)
                    Text("默认保留 30 天，可改为 7 天或不保留。删除全部同时清除报告助手与个人调查的本机回答、追问、草稿和原始响应；正式资料不受影响。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
#endif
            }
            .scrollContentBackground(.hidden)
            .background(Color(.systemGroupedBackground))
#if OWNER_CLIENT
            .navigationTitle("AI 投资助手 · \(OwnerClientStore.shared.currentCandidate.name)")
#else
            .navigationTitle("助手")
#endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .accessibilityIdentifier("globalAssistantSheet")
            .task(id: SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical ?? "") {
                await loadCloudAiPolicy()
                if researchTemporaryConversationRetention() != .none {
                    await restoreTemporaryConversation()
                }
            }
            .onChange(of: symbolInput) { _, _ in
                candidateNavigationRequestId = UUID()
                cloudAiPolicyRequestId = UUID()
                isLoadingCloudAiPolicy = false
                cloudAiPolicy = nil
                cloudAiPolicyMessage = "当前标的已变化；Cloud AI 授权需重新读取。"
                currentResearchReportReady = false
                currentResearchReportMessage = "当前标的已变化；需重新核对研究报告。"
                invalidateAnswer("当前标的已变化；旧回答已清除。")
            }
            .onChange(of: temporaryConversationRetentionRaw) { _, rawValue in
                temporaryConversationDeletionPending = false
                if ResearchTemporaryConversationRetention(rawValue: rawValue)
                    == ResearchTemporaryConversationRetention.none {
                    let cleared = clearAllLocalTemporaryResearch()
                    observedTemporaryClearMarker = researchTemporaryConversationClearMarker()
                    invalidateAnswer(cleared ? "已选择不保留；全部本机临时研究已删除。"
                        : "本机临时研究清除未完成；旧对话已从当前页面移除，请重试。")
                } else {
                    try? persistTemporaryConversation()
                }
            }
            .onAppear {
                let marker = researchTemporaryConversationClearMarker()
                if let observedTemporaryClearMarker, observedTemporaryClearMarker != marker {
                    invalidateAnswer("本机临时研究已清除；旧对话不再恢复。")
                }
                observedTemporaryClearMarker = marker
            }
            .onReceive(NotificationCenter.default.publisher(for: researchTemporaryConversationDidClearNotification)) { notification in
                guard let source = notification.object as? UserDefaults,
                      source === UserDefaults.standard else { return }
                observedTemporaryClearMarker = researchTemporaryConversationClearMarker()
                invalidateAnswer("全部本机临时研究已清除；新问题不会携带旧对话。")
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                let marker = researchTemporaryConversationClearMarker()
                if observedTemporaryClearMarker != marker {
                    observedTemporaryClearMarker = marker
                    invalidateAnswer("本机临时研究已清除；旧对话不再恢复。")
                }
            }
            .onDisappear {
                if !isAsking { try? persistTemporaryConversation() }
                candidateNavigationRequestId = UUID()
                cloudAiPolicyRequestId = UUID()
                requestLane.invalidate()
                isAsking = false
                isLoadingCloudAiPolicy = false
                cloudAiPolicy = nil
                currentResearchReportReady = false
                currentResearchReportMessage = "助手已关闭；下次打开时会重新读取当前报告。"
                response = nil
                answeredReport = nil
                answeredMembership = nil
                answeredMembershipKey = nil
                conversation = []
                sessionId = "legacy"
                carrySummary = nil
                carryFromSessionId = nil
                historySessions = []
                historySelection = nil
                correction = ""
            }
        }
    }
    @MainActor
    func ask() async {
        guard !isAsking,
              let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            message = "请先选择一只有效港股。"
            return
        }
        guard AppEnvironment.authToken() != nil, AppEnvironment.writeAuthToken() != nil else {
            invalidateAnswer("后端读取或写入令牌未配置；请关闭助手并在右上角连接设置中补齐，再重新打开。")
            return
        }
        guard currentResearchReportReady else {
            invalidateAnswer(currentResearchReportMessage)
            return
        }
        let submittedQuestion = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !submittedQuestion.isEmpty, submittedQuestion.utf16.count <= 1000 else {
            message = "请输入1至1000字符的问题；超出部分请拆成下一次追问。"
            return
        }
        let clearMarker = researchTemporaryConversationClearMarker()
        if observedTemporaryClearMarker != clearMarker {
            observedTemporaryClearMarker = clearMarker
            invalidateAnswer("本机临时研究已清除；本次从新对话开始。")
        }
        // A changed question starts a new request, not a new eight-answer session.
        let retry = pendingQuestionRetry
        let priorAnsweredReport = retry?.report ?? answeredReport
        let priorMembershipKey = retry?.membershipKey ?? answeredMembershipKey
        let priorConversation = retry?.conversation ?? conversation
        let priorSessionId = retry?.sessionId ?? sessionId
        let priorCarrySummary = retry?.carrySummary ?? carrySummary
        let priorCarryFromSessionId = retry?.carryFromSessionId ?? carryFromSessionId
        guard priorConversation.count < researchEvidenceQuestionSessionLimit else {
            message = "本会话已完成 8 轮；请核对摘要并明确开启新会话。"
            return
        }
        pendingQuestionRetry = .init(question: submittedQuestion, report: priorAnsweredReport,
            membershipKey: priorMembershipKey, conversation: priorConversation,
            sessionId: priorSessionId, carrySummary: priorCarrySummary,
            carryFromSessionId: priorCarryFromSessionId)
        sessionId = priorSessionId
        carrySummary = priorCarrySummary
        carryFromSessionId = priorCarryFromSessionId
        let revision = requestLane.begin()
        isAsking = true
        response = nil
        answeredReport = nil
        answeredMembership = nil
        answeredMembershipKey = nil
        conversation = []
        correction = ""
        message = "正在读取 \(symbol.canonical) 的当前报告并生成只读回答。"
        defer {
            if requestLane.accepts(revision) { isAsking = false }
        }
        do {
            let memberships = await client.fetchCandidateMemberships(includeArchived: false)
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            guard memberships.status == .available else {
                message = "研究自选暂不可用：\(memberships.message)；旧回答未展示，保留请求供重试。"
                return
            }
            let matchingMemberships = memberships.memberships.filter {
                $0.symbol == symbol.canonical && $0.state != .archived
            }
            guard matchingMemberships.count == 1,
                  let membership = matchingMemberships.first else {
                if matchingMemberships.count > 1 {
                    invalidateAnswer("当前股票存在多个有效研究身份；旧回答已清除，请先到研究页核对后再提问。")
                    return
                }
                invalidateAnswer("当前股票尚未加入研究；旧回答已清除，请先到市场加入研究。")
                return
            }
            let membershipKey = [membership.actorId, membership.id, String(membership.version), membership.state.rawValue, membership.symbol].joined(separator: "|")
            if let priorMembershipKey, priorMembershipKey != membershipKey {
                invalidateAnswer("当前研究身份已变化；旧回答已清除，请重新提问。")
                return
            }
            let policy = try await client.fetchCloudAiPolicy(expectedActorId: membership.actorId)
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            cloudAiPolicy = policy
            cloudAiPolicyMessage = policy.isEnabled
                ? "Cloud AI 已由当前 Owner 启用；本次回答会显示实际发送清单。"
                : "Cloud AI 尚未启用；请在 Research 工作区查看条款并明确确认。"
            guard policy.isEnabled else {
                invalidateAnswer("Cloud AI 尚未启用；旧回答已清除，未向提供方发送问题。")
                return
            }
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            guard let report = workspace.data?.reports.first(where: \.isCurrentExact) else {
                invalidateAnswer("当前股票还没有可追问的最新研究报告；旧回答已清除，请先在研究工作区完成报告。")
                return
            }
            if researchTemporaryConversationRetention() != .none {
                let latest = try loadResearchTemporaryConversation(membership: membership, report: report)
                if let latest, latest.sessionId != priorSessionId
                    || latest.responses.count != priorConversation.count {
                    invalidateAnswer("另一入口或上次使用留下了更新的会话；请先恢复当前报告临时对话，未发送新追问。")
                    return
                }
            }
            let safePriorConversation = canContinueResearchTemporaryConversation(
                priorConversation.map(\.response), membership: membership, report: report,
                recordedClearMarker: observedTemporaryClearMarker
            ) ? priorConversation : []
            if !priorConversation.isEmpty && safePriorConversation.isEmpty {
                invalidateAnswer("当前会话身份已变化；旧对话已清除，未发送追问。")
                return
            }
            if let priorAnsweredReport,
               (priorAnsweredReport.id != report.id
                || priorAnsweredReport.version != report.version
                || priorAnsweredReport.reportFingerprint != report.reportFingerprint
                || priorAnsweredReport.evidencePackId != report.evidencePackId
                || priorAnsweredReport.payload.evidencePackBinding?.fingerprint !=
                    report.payload.evidencePackBinding?.fingerprint) {
                invalidateAnswer("当前报告已变化；旧对话已清除，请基于新报告重新提问。")
                return
            }
            if priorCarrySummary != nil && priorAnsweredReport == nil {
                invalidateAnswer("续接摘要的来源报告无法核对；未发送追问。")
                return
            }
            pendingQuestionRetry = .init(question: submittedQuestion, report: report,
                membershipKey: membershipKey, conversation: safePriorConversation,
                sessionId: priorSessionId, carrySummary: priorCarrySummary,
                carryFromSessionId: priorCarryFromSessionId)
            let context = boundedResearchEvidenceQuestionConversation(safePriorConversation.compactMap(\.context))
            let carry: ResearchEvidenceQuestionCarrySummary? = priorCarrySummary.flatMap { text in
                priorCarryFromSessionId.map { sourceId in
                    ResearchEvidenceQuestionCarrySummary(sourceSessionId: sourceId,
                        reportFingerprint: report.reportFingerprint, text: text)
                }
            }
            let conversationJSON = (try? String(decoding: JSONEncoder().encode(context), as: UTF8.self)) ?? "[]"
            let semantic = [membership.id, String(membership.version), report.id,
                report.reportFingerprint, priorSessionId, submittedQuestion,
                conversationJSON, carry?.text ?? ""].joined(separator: "\u{0}")
            let idempotencyKey = evidenceQuestionReservation.reserve(for: semantic, prefix: "ios-global-evidence-question")
            let result = try await client.askResearchEvidenceQuestion(
                membershipId: membership.id,
                request: ResearchEvidenceQuestionRequest(
                    membershipVersion: membership.version,
                    reportId: report.id,
                    reportFingerprint: report.reportFingerprint,
                    question: submittedQuestion,
                    conversation: context,
                    carrySummary: carry,
                    idempotencyKey: idempotencyKey
                )
            )
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            guard question.trimmingCharacters(in: .whitespacesAndNewlines) == submittedQuestion,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical,
                  sessionId == priorSessionId else {
                invalidateAnswer("问题或标的已变化；旧回答未展示。")
                return
            }
            let freshWorkspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            guard let freshReport = freshWorkspace.data?.reports.first(where: \.isCurrentExact),
                  freshReport.id == report.id,
                  freshReport.version == report.version,
                  freshReport.reportFingerprint == report.reportFingerprint else {
                invalidateAnswer("回答返回后当前报告已变化；旧回答未展示，请基于新报告重新提问。")
                return
            }
            try result.validateForDisplay(
                expectedMembership: membership,
                expectedReport: freshReport,
                expectedQuestion: submittedQuestion
            )
            evidenceQuestionReservation.clear()
            guard result.status == "available" else {
                let retryContext = pendingQuestionRetry
                invalidateAnswer(result.message)
                // A recorded provider failure needs a new attempt key, but retains exact question context.
                pendingQuestionRetry = retryContext
                response = result
                return
            }
            pendingQuestionRetry = nil
            response = result
            conversation = safePriorConversation
            sessionId = priorSessionId
            carrySummary = priorCarrySummary
            carryFromSessionId = priorCarryFromSessionId
            conversation.append(.init(response: result))
            answeredReport = freshReport
            answeredMembership = membership
            answeredMembershipKey = membershipKey
            question = ""
            correction = ""
            message = result.message
            do {
                try persistTemporaryConversation()
                refreshAssistantSessionHistory(membership: membership, report: freshReport)
            } catch {
                message = "\(result.message)；本机临时对话保存失败，当前回答仍保持只读显示。"
            }
        } catch {
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            response = nil
            conversation = []
            answeredReport = nil
            answeredMembership = nil
            answeredMembershipKey = nil
            message = "助手回答失败，未继续显示旧回答。保留同一请求身份供安全重试：\(error.localizedDescription)"
        }
    }
}
