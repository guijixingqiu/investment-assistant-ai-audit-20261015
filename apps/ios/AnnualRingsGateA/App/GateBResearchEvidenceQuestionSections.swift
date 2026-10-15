import SwiftUI
import Combine

private struct ResearchTemporaryClearObserver: ViewModifier {
    let defaults: UserDefaults
    let hasStaleConversation: (String?) -> Bool
    let onClear: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var observation = ResearchTemporaryClearObservation()

    func body(content: Content) -> some View {
        content
            .onAppear { checkMarker() }
            .onReceive(NotificationCenter.default.publisher(for: researchTemporaryConversationDidClearNotification)) { notification in
                guard let source = notification.object as? UserDefaults, source === defaults else { return }
                _ = observation.observe(researchTemporaryConversationClearMarker(defaults: defaults))
                onClear()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { checkMarker() }
            }
    }

    private func checkMarker() {
        let marker = researchTemporaryConversationClearMarker(defaults: defaults)
        let changed = observation.observe(marker)
        if changed || hasStaleConversation(marker) { onClear() }
    }
}

extension GateBResearchScreen {
    var currentResearchEvidenceQuestionReport: TwoLayerReportData? {
        twoLayerReportWorkspace.envelope?.data?.reports.first(where: { $0.isCurrentExact })
    }
    @ViewBuilder
    func researchEvidenceQuestionSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("研究助手")
                .font(.headline)
            Text("追问会发送当前报告的判断、假设和已绑定的事实、反证及待核实项；判断是审查对象，不是证据。只有你明确保存修正，才会写入研究材料。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(cloudAiPolicy?.isEnabled == true ? "Cloud AI 已按当前 Owner 策略启用。" : "Cloud AI 未启用；新追问不会发送给提供方。")
                .font(.caption.weight(.semibold))
                .foregroundStyle(cloudAiPolicy?.isEnabled == true ? .green : .orange)
            Text("单次追问输出上限 800 tokens；输入上界和预计成本会在本次发送清单中记录。")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let report = currentResearchEvidenceQuestionReport,
               let pack = currentTwoLayerReportPack,
               !viewModel.researchEvidenceQuestionConversation.isEmpty {
                ForEach(viewModel.researchEvidenceQuestionConversation) { turn in
                    researchEvidenceQuestionTurn(turn, report: report, pack: pack)
                }
            }
            researchEvidenceQuestionSessionControls()
            TextField("继续追问，例如：这项反证会怎样影响结论？", text: viewModel.binding(\.researchEvidenceQuestion), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .focused($isTwoLayerReportFieldFocused)
                .disabled(viewModel.isAskingResearchEvidenceQuestion
                    || viewModel.researchEvidenceQuestionConversation.count >= researchEvidenceQuestionSessionLimit)
                .accessibilityIdentifier("researchEvidenceQuestionField")
            if let handoff = researchReviewQuestionHandoff {
                researchReviewQuestionHandoffSection(handoff)
            }
            Button {
                Task { await askResearchEvidenceQuestion() }
            } label: {
                Label(
                    viewModel.isAskingResearchEvidenceQuestion ? "回答中" : "追问当前报告",
                    systemImage: "text.bubble"
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(
                viewModel.isAskingResearchEvidenceQuestion
                    || viewModel.researchEvidenceQuestionConversation.count >= researchEvidenceQuestionSessionLimit
                    || viewModel.researchEvidenceQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || selectedMembership == nil
                    || currentResearchEvidenceQuestionReport == nil
                    || cloudAiPolicy?.isEnabled != true
            )
            .accessibilityIdentifier("askResearchEvidenceQuestionButton")

            Button {
                Task { await askResearchEvidenceQuestion(counterReview: true) }
            } label: {
                Label(
                    viewModel.isAskingResearchEvidenceQuestion ? "复核中" : "反方复核（同模型）",
                    systemImage: "arrow.left.arrow.right.circle"
                )
            }
            .buttonStyle(.bordered)
            .disabled(
                viewModel.isAskingResearchEvidenceQuestion
                    || viewModel.researchEvidenceQuestionConversation.count >= researchEvidenceQuestionSessionLimit
                    || selectedMembership == nil
                    || currentResearchEvidenceQuestionReport == nil
                    || cloudAiPolicy?.isEnabled != true
            )
            .accessibilityIdentifier("researchEvidenceCounterReviewButton")
            Text("点击后，用报告已有证据质疑当前判断与假设，不携带草稿或此前对话。这是同模型复核，不代表独立来源或其他提供方的意见。")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchEvidenceCounterReviewScope")

            Text(viewModel.researchEvidenceQuestionMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchEvidenceQuestionMessage")

            if let response = viewModel.researchEvidenceQuestionResponse,
               response.status != "available" {
                Text("未取得可用回答：\(response.message)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("researchEvidenceQuestionFailClosed")
                if let manifest = response.sendManifest {
                    researchEvidenceQuestionSendManifestDetails(manifest)
                        .accessibilityIdentifier("researchEvidenceQuestionFailedSendManifest")
                    Text("本次实际 provider 用量与 cost=UNKNOWN；提供方是否收到仍为 UNKNOWN。")
                        .font(.caption.monospaced()).textSelection(.enabled)
                }
            }

            if let latest = viewModel.researchEvidenceQuestionConversation.last,
               let report = currentResearchEvidenceQuestionReport {
                Divider()
                Text("把你的修正带入下一步")
                    .font(.subheadline.weight(.semibold))
                TextField("写下要修正或继续核实的内容", text: viewModel.binding(\.researchEvidenceQuestionCorrection), axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("researchEvidenceQuestionCorrection")
                HStack {
                    Button("形成报告修订草稿") {
                        let correction = viewModel.researchEvidenceQuestionCorrection.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task { await beginTwoLayerReportRevision(report, assistantDraft: correction) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(!validResearchEvidenceQuestionCorrection)
                    .accessibilityIdentifier("researchEvidenceQuestionToRevision")

                    Button("加入研究待办") {
                        let correction = viewModel.researchEvidenceQuestionCorrection.trimmingCharacters(in: .whitespacesAndNewlines)
                        reviewFollowUpDrafts.evidenceGapChecklist = correction
                        refreshReviewFollowUpDraftSummary()
                        selectedDecisionLayer = .review
                        selectedReviewWorkspace = .followUp
                        viewModel.researchEvidenceQuestionMessage = "已把本轮修正放入本机会话的研究待办草稿；未写入服务器、正式报告或正式决定。"
                    }
                    .buttonStyle(.bordered)
                    .disabled(!validResearchEvidenceQuestionCorrection)
                    .accessibilityIdentifier("researchEvidenceQuestionToTodo")
                }
                Text("当前承接回答：\(latest.response.question)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            DisclosureGroup("本机临时对话") {
                Picker("保留期", selection: $researchTemporaryConversationRetentionRaw) {
                    ForEach(ResearchTemporaryConversationRetention.allCases, id: \.rawValue) {
                        Text($0.title).tag($0.rawValue)
                    }
                }
                Button("恢复当前报告临时对话") {
                    Task { await restoreCurrentResearchTemporaryConversation() }
                }
                .disabled(viewModel.isAskingResearchEvidenceQuestion || selectedMembership == nil)
                Button("保存当前临时对话") {
                    saveCurrentResearchTemporaryConversationWithMessage()
                }
                .disabled(selectedMembership == nil || currentResearchEvidenceQuestionReport == nil)
                Button(
                    researchTemporaryConversationDeletionPending
                        ? "再次点击确认删除全部本机临时研究"
                        : "删除全部本机临时研究"
                ) {
                    deleteAllCurrentResearchTemporaryConversations()
                }
                .foregroundStyle(.red)
                Text("默认 30 天，可改为 7 天或不保留。删除全部同时清除报告助手与个人调查的本机回答、追问、草稿和原始响应；正式报告、决定与持仓不受影响。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchEvidenceQuestionSection")
        .id("researchEvidenceQuestionSection")
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("收起追问键盘") { isTwoLayerReportFieldFocused = false }
                    .accessibilityIdentifier("researchEvidenceQuestionKeyboardDone")
            }
        }
        .onChange(of: researchTemporaryConversationRetentionRaw) { _, rawValue in
            researchTemporaryConversationDeletionPending = false
            if ResearchTemporaryConversationRetention(rawValue: rawValue)
                == ResearchTemporaryConversationRetention.none {
                let cleared = clearAllLocalTemporaryResearch(defaults: viewModel.localDefaults)
                clearResearchEvidenceQuestion(cleared ? "已选择不保留；全部本机临时研究已删除。"
                    : "本机临时研究清除未完成；旧对话已从当前页面移除，请重试。")
            } else {
                try? persistCurrentResearchTemporaryConversation()
            }
        }
        .modifier(ResearchTemporaryClearObserver(
            defaults: viewModel.localDefaults,
            hasStaleConversation: { marker in
                (viewModel.researchEvidenceQuestionResponse != nil
                    || !viewModel.researchEvidenceQuestionConversation.isEmpty)
                    && viewModel.researchEvidenceQuestionClearMarker != marker
            }
        ) {
            clearResearchEvidenceQuestion("全部本机临时研究已清除；新问题不会携带旧对话。")
        })
        .task(id: selectedMembership.flatMap { membership in
            currentResearchEvidenceQuestionReport.map {
                researchTemporaryConversationIdentity(membership: membership, report: $0)
            }
        }) {
            if let membership = selectedMembership,
               let report = currentResearchEvidenceQuestionReport,
               !viewModel.researchEvidenceQuestionConversation.isEmpty,
               viewModel.researchEvidenceQuestionConversationIdentity !=
                researchTemporaryConversationIdentity(membership: membership, report: report) {
                clearResearchEvidenceQuestion("研究身份或报告已变化；旧会话已从当前页清除。")
            }
            if researchTemporaryConversationRetention(defaults: viewModel.localDefaults) != .none,
               researchReviewQuestionHandoff == nil,
               viewModel.researchEvidenceQuestion.isEmpty,
               viewModel.researchEvidenceQuestionConversation.isEmpty {
                await restoreCurrentResearchTemporaryConversation()
            }
        }
    }

    @ViewBuilder
    private func researchEvidenceQuestionSessionControls() -> some View {
        let count = viewModel.researchEvidenceQuestionConversation.count
        Text("本会话已完成 \(count)/\(researchEvidenceQuestionSessionLimit) 轮回答；失败与明确重试不计入。")
            .font(.caption)
            .accessibilityIdentifier("researchEvidenceSessionCount")
        if researchTemporaryConversationRetention(defaults: viewModel.localDefaults) == .none {
            Text("已选不保留：离页后本机会话轮数和历史无法恢复。")
                .font(.caption).foregroundStyle(.orange)
        }
        if count >= researchEvidenceQuestionSessionLimit {
            Text("本会话已满。请核对续接摘要，再明确开启新会话；旧会话仍按本机保留期可读。")
                .font(.caption).foregroundStyle(.orange)
        }
        if count > 0 {
            Button("准备新会话与续接摘要") { prepareNewResearchEvidenceQuestionSession() }
                .disabled(viewModel.isAskingResearchEvidenceQuestion)
                .accessibilityIdentifier("researchEvidencePrepareNewSession")
        }
        if viewModel.researchEvidenceQuestionNewSessionSourceIdentity != nil {
            Text("以下是上个会话的本地整理，须由你核对；它不会变成报告事实或正式结论。")
                .font(.caption).foregroundStyle(.secondary)
            TextField("核对续接摘要", text: viewModel.binding(\.researchEvidenceQuestionNewSessionDraft), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(viewModel.isAskingResearchEvidenceQuestion)
                .accessibilityIdentifier("researchEvidenceCarrySummaryDraft")
                .onChange(of: viewModel.researchEvidenceQuestionNewSessionDraft) { _, _ in
                    viewModel.researchEvidenceQuestionNewSessionConfirmed = false
                }
            Toggle("我已核对摘要和未知／反证边界", isOn: viewModel.binding(\.researchEvidenceQuestionNewSessionConfirmed))
                .disabled(viewModel.isAskingResearchEvidenceQuestion)
            Button("明确开启新会话") { Task { await startNewResearchEvidenceQuestionSession() } }
                .disabled(!viewModel.researchEvidenceQuestionNewSessionConfirmed
                    || !researchEvidenceQuestionCarrySummaryIsBounded(viewModel.researchEvidenceQuestionNewSessionDraft)
                    || viewModel.isAskingResearchEvidenceQuestion)
                .accessibilityIdentifier("researchEvidenceStartNewSession")
        }
        if !viewModel.researchEvidenceQuestionHistory.isEmpty {
            DisclosureGroup("本机会话记录（\(viewModel.researchEvidenceQuestionHistory.count)）") {
                ForEach(viewModel.researchEvidenceQuestionHistory, id: \.sessionId) { snapshot in
                    Button("\(snapshot.savedAt) · \(snapshot.responses.count)/8 轮") {
                        viewModel.researchEvidenceQuestionHistorySelection = snapshot.sessionId
                    }
                }
                if let selected = viewModel.researchEvidenceQuestionHistory.first(where: {
                    $0.sessionId == viewModel.researchEvidenceQuestionHistorySelection
                }) {
                    Text("本机记录只读；续接摘要不等于证据。")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(selected.responses.enumerated()), id: \.offset) { pair in
                        Text("你：\(pair.element.question)").font(.caption.weight(.semibold))
                        Text(pair.element.answer ?? "尚无回答").font(.caption).textSelection(.enabled)
                    }
                }
            }
        }
    }

    @MainActor
    private func prepareNewResearchEvidenceQuestionSession() {
        guard let membership = selectedMembership,
              let report = currentResearchEvidenceQuestionReport,
              let draft = draftResearchEvidenceQuestionCarrySummary(
                viewModel.researchEvidenceQuestionConversation.map(\.response),
                membership: membership, report: report
              ) else {
            viewModel.researchEvidenceQuestionMessage = "当前回答或报告身份无法核对；请重新读取后再开启新会话。"
            return
        }
        viewModel.researchEvidenceQuestionNewSessionSourceIdentity =
            researchTemporaryConversationIdentity(membership: membership, report: report)
        viewModel.researchEvidenceQuestionNewSessionDraft = draft
        viewModel.researchEvidenceQuestionNewSessionConfirmed = false
    }

    @MainActor
    private func startNewResearchEvidenceQuestionSession() async {
        guard !viewModel.isAskingResearchEvidenceQuestion,
              viewModel.researchEvidenceQuestionNewSessionConfirmed,
              let membership = selectedMembership,
              let report = currentResearchEvidenceQuestionReport,
              viewModel.researchEvidenceQuestionNewSessionSourceIdentity ==
                researchTemporaryConversationIdentity(membership: membership, report: report),
              draftResearchEvidenceQuestionCarrySummary(
                viewModel.researchEvidenceQuestionConversation.map(\.response),
                membership: membership, report: report
              ) != nil else { return }
        let summary = viewModel.researchEvidenceQuestionNewSessionDraft
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard researchEvidenceQuestionCarrySummaryIsBounded(summary) else { return }
        let sourceSessionId = viewModel.researchEvidenceQuestionSessionId
        let sourceResponses = viewModel.researchEvidenceQuestionConversation.map(\.response)
        let clearMarker = researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults)
        let requestId = UUID()
        viewModel.researchEvidenceQuestionRequestId = requestId
        viewModel.isAskingResearchEvidenceQuestion = true
        defer {
            if viewModel.researchEvidenceQuestionRequestId == requestId {
                viewModel.isAskingResearchEvidenceQuestion = false
            }
        }
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard viewModel.researchEvidenceQuestionRequestId == requestId,
                  selectedMembership == membership,
                  viewModel.researchEvidenceQuestionSessionId == sourceSessionId,
                  viewModel.researchEvidenceQuestionConversation.map(\.response) == sourceResponses,
                  clearMarker == researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults),
                  let fresh = workspace.data?.reports.first(where: \.isCurrentExact),
                  fresh.id == report.id, fresh.version == report.version,
                  fresh.reportFingerprint == report.reportFingerprint,
                  fresh.evidencePackId == report.evidencePackId,
                  fresh.payload.evidencePackBinding?.fingerprint == report.payload.evidencePackBinding?.fingerprint else {
                viewModel.researchEvidenceQuestionMessage = "报告或证据包已变化；旧摘要未开启新会话。"
                return
            }
            let retention = researchTemporaryConversationRetention(defaults: viewModel.localDefaults)
            if retention != .none {
                guard let latest = try loadResearchTemporaryConversation(
                    membership: membership, report: fresh, defaults: viewModel.localDefaults
                ), latest.sessionId == sourceSessionId,
                    latest.responses == sourceResponses else {
                    viewModel.researchEvidenceQuestionMessage =
                        "另一入口已有更新的会话；请恢复并核对全部轮数后再明确开启新会话。旧记录未覆盖。"
                    return
                }
                try persistCurrentResearchTemporaryConversation()
            }
            let newSessionId = UUID().uuidString
            if retention != .none {
                try saveResearchTemporaryConversation(
                    membership: membership, report: fresh, responses: [],
                    questionDraft: "", correctionDraft: "", retention: retention,
                    sessionId: newSessionId, carrySummary: summary,
                    carryFromSessionId: sourceSessionId, defaults: viewModel.localDefaults
                )
            }
            viewModel.researchEvidenceQuestionSessionId = newSessionId
            viewModel.researchEvidenceQuestionCarrySummary = summary
            viewModel.researchEvidenceQuestionCarryFromSessionId = sourceSessionId
            viewModel.researchEvidenceQuestionConversation = []
            viewModel.researchEvidenceQuestionResponse = nil
            viewModel.researchEvidenceQuestion = ""
            viewModel.researchEvidenceQuestionCorrection = ""
            viewModel.researchEvidenceQuestionConversationIdentity =
                researchTemporaryConversationIdentity(membership: membership, report: fresh)
            twoLayerReportWorkspace.envelope = workspace
            researchReviewQuestionHandoff = nil
            viewModel.researchEvidenceQuestionClearMarker = clearMarker
            viewModel.researchEvidenceQuestionNewSessionSourceIdentity = nil
            viewModel.researchEvidenceQuestionNewSessionDraft = ""
            viewModel.researchEvidenceQuestionNewSessionConfirmed = false
            researchEvidenceQuestionReservation.clear()
            refreshResearchEvidenceQuestionHistory(membership: membership, report: fresh)
            viewModel.researchEvidenceQuestionMessage = retention == .none
                ? "已开启新会话；选择了不保留，离页后无法恢复旧会话。摘要仍不是事实。"
                : "已开启新会话并保留旧会话；续接摘要只作待核对提示，不是事实。"
        } catch {
            guard viewModel.researchEvidenceQuestionRequestId == requestId else { return }
            viewModel.researchEvidenceQuestionMessage = "新会话保存或回读失败；旧会话仍保留，未开启新会话。"
        }
    }

    private func refreshResearchEvidenceQuestionHistory(
        membership: CandidateMembershipData, report: TwoLayerReportData
    ) {
        viewModel.researchEvidenceQuestionHistory = (try? listResearchTemporaryConversations(
            membership: membership, report: report, defaults: viewModel.localDefaults)) ?? []
        viewModel.researchEvidenceQuestionHistorySelection = nil
    }

    private var validResearchEvidenceQuestionCorrection: Bool {
        let value = viewModel.researchEvidenceQuestionCorrection.trimmingCharacters(in: .whitespacesAndNewlines)
        return !value.isEmpty && value.count <= 4000
    }

    @ViewBuilder
    private func researchReviewQuestionHandoffSection(
        _ handoff: ResearchReviewQuestionHandoff
    ) -> some View {
        let draft = handoff.selectedQuestionDraft
        let isWithinQuestionLimit = handoff.selectedQuestionDraftIsWithinQuestionLimit
        VStack(alignment: .leading, spacing: 6) {
            Text("已载入复盘问题草稿；可以编辑，尚未提问。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchReviewQuestionDraftBoundary")
            Text("来源：复盘 #\(handoff.target.reviewId ?? "UNKNOWN") · 检查 #\(handoff.target.decisionCheckId) · 复盘时间 \(handoff.reviewReviewedAt)")
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchReviewQuestionSourceAttribution")
            Toggle("带入判断修正（含遗漏反证）", isOn: researchReviewJudgmentCorrectionSelection)
                .disabled(!handoff.canCarryJudgmentCorrection || viewModel.isAskingResearchEvidenceQuestion)
                .accessibilityIdentifier("researchReviewCarryJudgmentCorrection")
            Toggle("带入流程教训", isOn: researchReviewProcessLessonSelection)
                .disabled(!handoff.canCarryProcessLesson || viewModel.isAskingResearchEvidenceQuestion)
                .accessibilityIdentifier("researchReviewCarryProcessLesson")
            if !handoff.canCarryJudgmentCorrection && !handoff.canCarryProcessLesson {
                Text("这条复盘没有保存可带入的判断修正或流程教训原文；只携带下一研究问题。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchReviewCarryUnavailable")
            } else {
                Button {
                    applyResearchReviewQuestionHandoffSelection()
                } label: {
                    Label("把所选复盘材料带入草稿", systemImage: "text.badge.plus")
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.isAskingResearchEvidenceQuestion)
                .accessibilityIdentifier("researchReviewCarrySelectionApply")
            }
            Text(
                isWithinQuestionLimit
                    ? "草稿合计 \(draft.utf16.count)/\(ResearchReviewQuestionHandoff.maximumQuestionLength) 字符（未勾选则只携带下一步研究问题）。"
                    : handoff.carriesSelectedReviewLearning
                        ? "所选复盘原文与问句合计 \(draft.utf16.count) 字符，超过单次追问 \(ResearchReviewQuestionHandoff.maximumQuestionLength) 字符上限；草稿不会被截断，请取消勾选或先手动缩短。"
                        : "这份复盘的下一研究问题本身 \(draft.utf16.count) 字符，已超过单次追问 \(ResearchReviewQuestionHandoff.maximumQuestionLength) 字符上限；草稿不会被截断，请先手动缩短。"
            )
            .font(.caption2)
            .foregroundStyle(isWithinQuestionLimit ? Color.secondary : Color.orange)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("researchReviewCarrySelectionLength")
        }
        .accessibilityElement(children: .contain)
    }

    private var researchReviewJudgmentCorrectionSelection: Binding<Bool> {
        Binding(
            get: { researchReviewQuestionHandoff?.includesJudgmentCorrection == true },
            set: { newValue in
                guard researchReviewQuestionHandoff?.includesJudgmentCorrection != newValue else { return }
                researchReviewQuestionHandoff?.includesJudgmentCorrection = newValue
            }
        )
    }

    private var researchReviewProcessLessonSelection: Binding<Bool> {
        Binding(
            get: { researchReviewQuestionHandoff?.includesProcessLesson == true },
            set: { newValue in
                guard researchReviewQuestionHandoff?.includesProcessLesson != newValue else { return }
                researchReviewQuestionHandoff?.includesProcessLesson = newValue
            }
        )
    }

    /// Applies the Owner's explicit selection to the editable draft. It never runs on
    /// render, and it rebuilds the draft from the bare saved question plus only the
    /// selected preserved material, so an explicit request is the only thing that changes it.
    @MainActor
    func applyResearchReviewQuestionHandoffSelection() {
        guard let handoff = researchReviewQuestionHandoff else { return }
        let draft = handoff.selectedQuestionDraft
        guard draft.utf16.count <= ResearchReviewQuestionHandoff.maximumQuestionLength else {
            viewModel.researchEvidenceQuestionMessage =
                handoff.carriesSelectedReviewLearning
                    ? "所选复盘原文与问句合计 \(draft.utf16.count) 字符，超过单次追问 \(ResearchReviewQuestionHandoff.maximumQuestionLength) 字符上限；草稿未改变，请取消勾选或先手动缩短问题。"
                    : "这份复盘的下一研究问题本身 \(draft.utf16.count) 字符，超过单次追问 \(ResearchReviewQuestionHandoff.maximumQuestionLength) 字符上限；草稿未改变，请先手动缩短问题。"
            return
        }
        viewModel.researchEvidenceQuestion = draft
        viewModel.researchEvidenceQuestionMessage = handoff.carriesSelectedReviewLearning
            ? "已把所选复盘材料原文带入可编辑草稿（来源：复盘 #\(handoff.target.reviewId ?? "UNKNOWN") · 检查 #\(handoff.target.decisionCheckId) · 复盘时间 \(handoff.reviewReviewedAt)）；只携带该复盘所选原文，尚未提问、不会自动发送或写入。"
            : "已恢复为只携带下一研究问题（未选复盘材料）；尚未提问。"
    }

    @ViewBuilder
    private func researchEvidenceQuestionTurn(
        _ turn: ResearchEvidenceQuestionConversationTurn,
        report: TwoLayerReportData,
        pack: FrozenResearchEvidencePack
    ) -> some View {
        let response = turn.response
        let isCounterReview = researchEvidenceQuestionIsCounterReview(response.question)
        VStack(alignment: .leading, spacing: 8) {
            if isCounterReview {
                Text("反方复核（同模型）")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("researchEvidenceCounterReviewLabel")
                Text("仅依据当前报告已绑定的事实与证据；不是独立外部来源调研，也不是不同提供方模型的意见。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if isCounterReview {
                DisclosureGroup("问题与引用摘录") {
                    Text(response.question).font(.caption)
                    Text(response.answer ?? "尚未形成回答")
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("researchEvidenceQuestionAnswer")
                }
            } else {
                Text("你：\(response.question)")
                    .font(.subheadline.weight(.semibold))
                Text(response.answer ?? "尚未形成回答")
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchEvidenceQuestionAnswer")
            }
            if !response.insights.isEmpty {
                Text("这意味着")
                    .font(.caption.weight(.semibold))
                ForEach(response.insights) { insight in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(insight.title)
                            .font(.caption.weight(.semibold))
                        Text(insight.statement)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let explanation = insight.explanation {
                            Text("模型解读（非事实/来源）：\(explanation)")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("researchEvidenceQuestionInsightExplanation-\(insight.impact)")
                        }
                    }
                    .accessibilityIdentifier("researchEvidenceQuestionInsight-\(insight.impact)")
                }
            }
            if !response.unknowns.isEmpty {
                BulletList(title: "仍待核实", items: response.unknowns)
                    .accessibilityIdentifier("researchEvidenceQuestionUnknowns")
            }
            if isCounterReview, let binding = response.binding {
                Text("报告版本：report #\(binding.reportId) v\(binding.reportVersion) · pack #\(binding.evidencePackId) · 证据截止 \(binding.cutoffAt)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchEvidenceCounterReviewBinding")
                Text("来源证据 ID：\(response.sourceEvidenceIds.isEmpty ? "无" : response.sourceEvidenceIds.joined(separator: ", "))")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("模型：\(response.reproducibility.provider)/\(response.reproducibility.model) · \(response.reproducibility.tokenUsage) · cost=\(response.reproducibility.cost)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchEvidenceCounterReviewProvenance")
                Text(response.insights.isEmpty
                    ? "与当前结论的差异：本轮没有取得可标注的支持或削弱项。"
                    : "与当前结论的差异：\(response.insights.map(\.title).joined(separator: "；"))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchEvidenceCounterReviewDifferences")
                Text("结果只是一条独立可追溯的复核记录；吸收与否仍由你显式修正决定，不会自动写入报告或正式决定。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(response.answerFacts.indices, id: \.self) { index in
                let fact = response.answerFacts[index]
                if let reportFact = report.researchEvidenceQuestionFact(matching: fact) {
                    ForEach(fact.evidenceIds, id: \.self) { evidenceId in
                        if pack.reopenableMaterials(for: reportFact).contains(where: { $0.evidenceId == evidenceId }) {
                            Button {
                                openResearchEvidenceQuestionCitation(
                                    fact,
                                    evidenceId: evidenceId,
                                    response: response,
                                    report: report
                                )
                            } label: {
                                Label("重开引用 \(evidenceId)", systemImage: "doc.text.magnifyingglass")
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("researchEvidenceQuestionCitation-\(evidenceId)")
                        }
                    }
                    if let citation = reportFact.citation?.reopenableDocumentCitation {
                        Button("重开档案快照引用 · PDF p\(citation.pageNumber)") {
                            openResearchEvidenceQuestionCitation(
                                fact,
                                evidenceId: nil,
                                response: response,
                                report: report
                            )
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("researchEvidenceQuestionSnapshotCitation-\(index)")
                    }
                    if pack.reopenableMaterials(for: reportFact).isEmpty,
                       pack.exactExternalSourceURL(
                        for: reportFact,
                        events: twoLayerReportWorkspace.envelope?.data?.events ?? []
                       ) != nil {
                        Button {
                            Task {
                                await openTwoLayerExternalSource(
                                    report: report,
                                    fact: reportFact
                                )
                            }
                        } label: {
                            Label("重开绑定网页来源", systemImage: "safari")
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("researchEvidenceQuestionExternalSource-\(index)")
                    }
                }
            }
            DisclosureGroup("来源与截止") {
                VStack(alignment: .leading, spacing: 6) {
                    if let binding = response.binding {
                        Text("证据截止：\(binding.cutoffAt)")
                        Text("report #\(binding.reportId) v\(binding.reportVersion) · pack #\(binding.evidencePackId)")
                    }
                    if !report.payload.invalidationConditions.isEmpty {
                        Text("失效条件：\(report.payload.invalidationConditions.joined(separator: "；"))")
                    }
                    Text("\(response.reproducibility.provider) · \(response.reproducibility.model) · \(response.reproducibility.tokenUsage) · cost=\(response.reproducibility.cost)")
                    if let manifest = response.sendManifest {
                        researchEvidenceQuestionSendManifestDetails(manifest)
                    }
                    Text("只读研究回答；不修改正式报告、正式决定、持仓或交易。")
                }
                .font(.caption.monospaced())
                .textSelection(.enabled)
            }
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private func researchEvidenceQuestionSendManifestDetails(
        _ manifest: ResearchEvidenceQuestionEnvelope.SendManifest
    ) -> some View {
        Text("实际发送：\(manifest.factCount) 条报告事实 · \(manifest.unknownCount) 项 UNKNOWN · \(manifest.conversationTurnCount) 轮上下文")
        Text("本地准备时间：\(manifest.preparedAt ?? "UNKNOWN")")
        if let input = manifest.inputTokenUpperBound,
           let output = manifest.maxOutputTokens,
           let cost = manifest.estimatedMaxCostUsd,
           let pricing = manifest.pricingIdentity {
            Text("发送前成本上界：输入 ≤\(input) tokens（按 UTF-8 字节数保守估算）+ 输出 ≤\(output) tokens · 最多约 US$\(String(format: "%.8f", cost)) · \(pricing)")
        }
        Text("证据 ID：\(manifest.sourceEvidenceIds.joined(separator: ", "))")
        Text("字段：\(manifest.payloadFields.joined(separator: ", "))")
        Text("policy \(manifest.policyVersion) · request SHA \(manifest.requestBodySha256)")
        Text(manifest.policySnapshot?.sendManifestSummary ?? "历史发送未固化地区、保留与训练条款。")
        Text(manifest.sendAuthorization?.sendAuthorizationSummary ?? "历史发送未固化发送时 Owner 授权状态。")
        Text("未发送整份 PDF、凭据或正式资产事实。")
    }

    @MainActor
    private func openResearchEvidenceQuestionCitation(
        _ fact: ResearchEvidenceQuestionEnvelope.Fact,
        evidenceId: String?,
        response: ResearchEvidenceQuestionEnvelope,
        report: TwoLayerReportData
    ) {
        guard let membershipVersion = response.membershipVersion,
              let symbol = response.symbol,
              response.binding?.reportId == report.id,
              response.binding?.reportVersion == report.version,
              response.binding?.reportFingerprint == report.reportFingerprint,
              response.binding?.evidencePackId == report.evidencePackId else {
            viewModel.researchEvidenceQuestionMessage =
                "引用与当前报告身份不一致；未打开缓存或替代来源。"
            return
        }
        requestedTodayReportRevision = TodayReportRevisionNotice(
            membershipId: response.membershipId,
            membershipVersion: membershipVersion,
            symbol: symbol,
            reportId: report.id,
            reportVersion: report.version,
            reportFingerprint: report.reportFingerprint,
            evidencePackId: report.evidencePackId,
            source: .reportCard(report.id),
            nextValidationQuestion: report.payload.researchLayer?.nextValidationQuestions.first
                ?? response.question,
            savedAt: report.createdAt,
            assistantHandoff: .openCitation(fact, evidenceId: evidenceId)
        )
        viewModel.researchEvidenceQuestionMessage = "正在重新核对当前报告与引用身份。"
    }

    @MainActor
    func openResearchReviewQuestionDraft(
        _ handoff: ResearchReviewQuestionHandoff,
        symbol: SecuritySymbol,
        authorizationRevision: UUID
    ) async {
        await refreshDecisionReviewHistoryAfterWrite(for: symbol)
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              parsedSymbol?.canonical == handoff.target.canonicalSymbol,
              let membership = selectedMembership,
              let workspace = twoLayerReportWorkspace.envelope?.data,
              let question = handoff.resolveQuestion(
                history: decisionReviewHistory,
                membership: membership,
                workspace: workspace
              ) else {
            clearResearchEvidenceQuestion("复盘问题的 review、check、decision、report、pack、membership 或授权身份已变化；草稿已清除。")
            twoLayerReportWorkspace.message = viewModel.researchEvidenceQuestionMessage
            return
        }
        researchReviewQuestionHandoff = handoff
        viewModel.researchEvidenceQuestion = question
        viewModel.researchEvidenceQuestionMessage = "已从精确复盘来源创建可编辑问句草稿；请再次明确点击“追问当前报告”。"
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .brief
        pendingDecisionWorkspaceScrollTarget = "researchEvidenceQuestionSection"
        twoLayerReportWorkspace.message = "复盘问题已成为本机会话草稿；未自动发送、写入或形成决定。"
    }
    @MainActor
    /// One implementation for both lanes: a normal question uses the Owner's draft and the
    /// current conversation; `counterReview` swaps in the fixed counter-review question and
    /// sends an empty conversation so it cannot inherit prior turns.
    func askResearchEvidenceQuestion(counterReview: Bool = false) async {
        guard !viewModel.isAskingResearchEvidenceQuestion else { return }
        guard let membership = selectedMembership,
              let report = currentResearchEvidenceQuestionReport else {
            if researchReviewQuestionHandoff != nil {
                clearResearchEvidenceQuestion("当前报告或 membership 不可用；复盘问句草稿已清除。")
            }
            return
        }
        guard viewModel.researchEvidenceQuestionConversation.count < researchEvidenceQuestionSessionLimit else {
            viewModel.researchEvidenceQuestionMessage = "本会话已完成 8 轮；请明确开启新会话，反方复核也不能绕过上限。"
            return
        }
        if researchTemporaryConversationRetention(defaults: viewModel.localDefaults) != .none {
            do {
                if let latest = try loadResearchTemporaryConversation(
                    membership: membership, report: report, defaults: viewModel.localDefaults
                ), latest.sessionId != viewModel.researchEvidenceQuestionSessionId
                    || latest.responses.count != viewModel.researchEvidenceQuestionConversation.count {
                    viewModel.researchEvidenceQuestionMessage =
                        "另一入口或上次使用留下了更新的会话；请先恢复本机临时对话，未发送新追问。"
                    return
                }
            } catch {
                viewModel.researchEvidenceQuestionMessage = "本机会话读取失败；未发送新追问。"
                return
            }
        }
        let sourceHandoff = counterReview ? nil : researchReviewQuestionHandoff
        if let sourceHandoff,
           sourceHandoff.resolveQuestion(
            history: decisionReviewHistory,
            membership: membership,
            workspace: twoLayerReportWorkspace.envelope?.data
           ) == nil {
            clearResearchEvidenceQuestion("复盘问题来源已经漂移或不再唯一；草稿已清除，未发送提问。")
            return
        }
        let question = counterReview
            ? researchEvidenceCounterReviewQuestion
            : viewModel.researchEvidenceQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        guard question.utf16.count <= ResearchReviewQuestionHandoff.maximumQuestionLength else {
            viewModel.researchEvidenceQuestionMessage =
                "问句共 \(question.utf16.count) 字符，超过单次追问 \(ResearchReviewQuestionHandoff.maximumQuestionLength) 字符上限；未发送，请先精简问句或取消带入的复盘材料。"
            return
        }
        guard cloudAiPolicy?.requestedActorId == membership.actorId,
              cloudAiPolicy?.isEnabled == true else {
            viewModel.researchEvidenceQuestionMessage = "Cloud AI 未按当前策略启用；问题没有发送。"
            return
        }
        let clearMarker = researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults)
        let requestId = UUID()
        let currentTurns = viewModel.researchEvidenceQuestionConversation
        let currentIdentity = researchTemporaryConversationIdentity(membership: membership, report: report)
        if viewModel.researchEvidenceQuestionCarrySummary != nil,
           viewModel.researchEvidenceQuestionConversationIdentity != currentIdentity {
            clearResearchEvidenceQuestion("报告身份已变化；旧会话摘要已清除，未发送追问。")
            return
        }
        let canReuseTurns = currentTurns.isEmpty || (
            viewModel.researchEvidenceQuestionConversationIdentity == currentIdentity
                && canContinueResearchTemporaryConversation(
                    currentTurns.map(\.response), membership: membership, report: report,
                    recordedClearMarker: viewModel.researchEvidenceQuestionClearMarker,
                    defaults: viewModel.localDefaults
                )
        )
        if !currentTurns.isEmpty && !canReuseTurns {
            clearResearchEvidenceQuestion("本机会话身份已变化；请重新读取当前报告，未发送追问。")
            return
        }
        let conversation = counterReview || !canReuseTurns
            ? [] : boundedResearchEvidenceQuestionConversation(currentTurns.compactMap(\.context))
        let sessionId = viewModel.researchEvidenceQuestionSessionId
        let carrySummary: ResearchEvidenceQuestionCarrySummary? =
            counterReview ? nil : viewModel.researchEvidenceQuestionCarrySummary.flatMap { text in
                viewModel.researchEvidenceQuestionCarryFromSessionId.map {
                    ResearchEvidenceQuestionCarrySummary(sourceSessionId: $0,
                        reportFingerprint: report.reportFingerprint, text: text)
                }
            }
        let conversationJSON = (try? String(decoding: JSONEncoder().encode(conversation), as: UTF8.self)) ?? "[]"
        let semantic = [membership.id, String(membership.version), report.id, report.reportFingerprint,
            sessionId, question, conversationJSON, carrySummary?.text ?? ""].joined(separator: "\u{0}")
        let idempotencyKey = researchEvidenceQuestionReservation.reserve(for: semantic, prefix: "ios-evidence-question")
        viewModel.researchEvidenceQuestionRequestId = requestId
        viewModel.isAskingResearchEvidenceQuestion = true
        viewModel.researchEvidenceQuestionResponse = nil
        viewModel.researchEvidenceQuestionMessage = counterReview
            ? "正在基于当前 report #\(report.id) 的绑定事实发起反方复核（同模型）；本轮不携带此前对话上下文，你的草稿保持不变。"
            : "正在基于当前 report #\(report.id) 和本次对话生成回答。"
        defer {
            if viewModel.researchEvidenceQuestionRequestId == requestId {
                viewModel.isAskingResearchEvidenceQuestion = false
            }
        }
        do {
            let response = try await client.askResearchEvidenceQuestion(
                membershipId: membership.id,
                request: ResearchEvidenceQuestionRequest(
                    membershipVersion: membership.version,
                    reportId: report.id,
                    reportFingerprint: report.reportFingerprint,
                    question: question,
                    conversation: conversation,
                    carrySummary: carrySummary,
                    idempotencyKey: idempotencyKey
                )
            )
            if researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) != clearMarker {
                if viewModel.researchEvidenceQuestionRequestId == requestId {
                    clearResearchEvidenceQuestion("本机临时研究已清除；旧请求返回未加入新会话。")
                }
                return
            }
            guard viewModel.researchEvidenceQuestionRequestId == requestId,
                  researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) == clearMarker,
                  selectedMembership == membership,
                  viewModel.researchEvidenceQuestionSessionId == sessionId else {
                if viewModel.researchEvidenceQuestionRequestId == requestId,
                   researchReviewQuestionHandoff == sourceHandoff {
                    clearResearchEvidenceQuestion("提问返回前来源身份已经变化；复盘问句草稿已清除。")
                }
                return
            }
            let freshWorkspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            if researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) != clearMarker {
                if viewModel.researchEvidenceQuestionRequestId == requestId {
                    clearResearchEvidenceQuestion("本机临时研究已清除；旧请求返回未加入新会话。")
                }
                return
            }
            guard viewModel.researchEvidenceQuestionRequestId == requestId,
                  researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) == clearMarker,
                  selectedMembership == membership,
                  viewModel.researchEvidenceQuestionSessionId == sessionId else { return }
            guard let freshReport = freshWorkspace.data?.reports.first(where: \.isCurrentExact),
                  freshReport.id == report.id,
                  freshReport.version == report.version,
                  freshReport.reportFingerprint == report.reportFingerprint else {
                clearResearchEvidenceQuestion("回答返回后当前报告已变化；旧回答已清除，请基于新报告重新提问。")
                return
            }
            try response.validateForDisplay(
                expectedMembership: membership,
                expectedReport: freshReport,
                expectedQuestion: question
            )
            researchEvidenceQuestionReservation.clear()
            twoLayerReportWorkspace.envelope = freshWorkspace
            viewModel.researchEvidenceQuestionResponse = response
            if response.status == "available" {
                guard viewModel.researchEvidenceQuestionConversation.count < researchEvidenceQuestionSessionLimit else {
                    viewModel.researchEvidenceQuestionMessage = "会话已满；迟到回答未加入当前会话。"
                    return
                }
                viewModel.researchEvidenceQuestionConversation.append(.init(response: response))
                viewModel.researchEvidenceQuestionClearMarker = clearMarker
                viewModel.researchEvidenceQuestionConversationIdentity = currentIdentity
                if !counterReview {
                    viewModel.researchEvidenceQuestion = ""
                    viewModel.researchEvidenceQuestionCorrection = ""
                    researchReviewQuestionHandoff = nil
                }
            }
            viewModel.researchEvidenceQuestionMessage = counterReview
                ? "反方复核（同模型）已完成，并作为独立一轮保留在下面的对话里：\(response.message) 这只是一次同模型的证据范围自查，不是独立来源调研或不同提供方的第二意见；报告、正式决定与资产事实未变。"
                : response.message
            if response.status == "available" {
                do {
                    try persistCurrentResearchTemporaryConversation()
                    refreshResearchEvidenceQuestionHistory(membership: membership, report: freshReport)
                } catch {
                    viewModel.researchEvidenceQuestionMessage =
                        "\(response.message)；本机临时对话保存失败，当前回答仍保持只读显示。"
                }
            }
        } catch {
            guard viewModel.researchEvidenceQuestionRequestId == requestId,
                  researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) == clearMarker else { return }
            if sourceHandoff != nil, researchReviewQuestionHandoff == sourceHandoff {
                viewModel.researchEvidenceQuestionResponse = nil
                viewModel.researchEvidenceQuestionMessage =
                    "未取得可验证回答，可明确重试：\(error.localizedDescription)"
                return
            }
            viewModel.researchEvidenceQuestionResponse = nil
            viewModel.researchEvidenceQuestionMessage = counterReview
                ? "反方复核（同模型）未取得可验证回答；此前对话与你的草稿都保留，可明确重试：\(error.localizedDescription)"
                : "证据追问失败；未展示旧回答或部分回答：\(error.localizedDescription)"
        }
    }
    @MainActor
    func clearResearchEvidenceQuestion(_ message: String) {
        if researchReviewQuestionHandoff != nil { viewModel.researchEvidenceQuestion = "" }
        researchReviewQuestionHandoff = nil
        viewModel.researchEvidenceQuestionRequestId = UUID()
        viewModel.isAskingResearchEvidenceQuestion = false
        viewModel.researchEvidenceQuestionResponse = nil
        viewModel.researchEvidenceQuestionConversation = []
        viewModel.researchEvidenceQuestionSessionId = "legacy"
        viewModel.researchEvidenceQuestionCarrySummary = nil
        viewModel.researchEvidenceQuestionCarryFromSessionId = nil
        viewModel.researchEvidenceQuestionHistory = []
        viewModel.researchEvidenceQuestionHistorySelection = nil
        viewModel.researchEvidenceQuestionNewSessionSourceIdentity = nil
        viewModel.researchEvidenceQuestionNewSessionDraft = ""
        viewModel.researchEvidenceQuestionNewSessionConfirmed = false
        viewModel.researchEvidenceQuestionClearMarker = researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults)
        viewModel.researchEvidenceQuestionConversationIdentity = nil
        viewModel.researchEvidenceQuestionCorrection = ""
        researchEvidenceQuestionReservation.clear()
        viewModel.researchEvidenceQuestionMessage = message
    }
    func persistCurrentResearchTemporaryConversation() throws {
        guard let membership = selectedMembership,
              let report = currentResearchEvidenceQuestionReport else { return }
        let responses = viewModel.researchEvidenceQuestionConversation.map(\.response)
        if !responses.isEmpty {
            guard viewModel.researchEvidenceQuestionConversationIdentity ==
                    researchTemporaryConversationIdentity(membership: membership, report: report),
                  canContinueResearchTemporaryConversation(
                    responses, membership: membership, report: report,
                    recordedClearMarker: viewModel.researchEvidenceQuestionClearMarker,
                    defaults: viewModel.localDefaults
                  ) else { throw ResearchTemporaryConversationStoreError.invalidRecord }
        }
        try saveResearchTemporaryConversation(
            membership: membership,
            report: report,
            responses: responses,
            questionDraft: viewModel.researchEvidenceQuestion,
            correctionDraft: viewModel.researchEvidenceQuestionCorrection,
            retention: ResearchTemporaryConversationRetention(
                rawValue: researchTemporaryConversationRetentionRaw
            ) ?? .thirtyDays,
            sessionId: viewModel.researchEvidenceQuestionSessionId,
            carrySummary: viewModel.researchEvidenceQuestionCarrySummary,
            carryFromSessionId: viewModel.researchEvidenceQuestionCarryFromSessionId,
            defaults: viewModel.localDefaults
        )
    }
    func saveCurrentResearchTemporaryConversationWithMessage() {
        do {
            try persistCurrentResearchTemporaryConversation()
            viewModel.researchEvidenceQuestionMessage =
                "当前 exact report 临时对话已写入本机保留期；未上传服务器或备份。"
        } catch {
            viewModel.researchEvidenceQuestionMessage =
                "本机临时对话保存失败；旧保存状态未冒充为成功。"
        }
    }
    @MainActor
    func restoreCurrentResearchTemporaryConversation() async {
        guard !viewModel.isAskingResearchEvidenceQuestion,
              let membership = selectedMembership else { return }
        let requestId = UUID()
        viewModel.researchEvidenceQuestionRequestId = requestId
        viewModel.isAskingResearchEvidenceQuestion = true
        defer {
            if viewModel.researchEvidenceQuestionRequestId == requestId {
                viewModel.isAskingResearchEvidenceQuestion = false
            }
        }
        let clearMarker = researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults)
        viewModel.researchEvidenceQuestionMessage =
            "正在 fresh read 当前 report，再恢复精确绑定的本机临时对话。"
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard viewModel.researchEvidenceQuestionRequestId == requestId,
                  selectedMembership == membership,
                  researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) == clearMarker,
                  let report = workspace.data?.reports.first(where: \.isCurrentExact) else { return }
            guard let snapshot = try loadResearchTemporaryConversation(
                membership: membership,
                report: report,
                defaults: viewModel.localDefaults
            ) else {
                clearResearchEvidenceQuestion("当前 exact report 没有未过期的本机临时对话。")
                return
            }
            guard researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) == clearMarker else { return }
            twoLayerReportWorkspace.envelope = workspace
            viewModel.researchEvidenceQuestionConversation = snapshot.responses.map {
                .init(response: $0)
            }
            viewModel.researchEvidenceQuestionSessionId = snapshot.sessionId
            viewModel.researchEvidenceQuestionCarrySummary = snapshot.carrySummary
            viewModel.researchEvidenceQuestionCarryFromSessionId = snapshot.carryFromSessionId
            viewModel.researchEvidenceQuestionClearMarker = clearMarker
            viewModel.researchEvidenceQuestionConversationIdentity =
                researchTemporaryConversationIdentity(membership: membership, report: report)
            viewModel.researchEvidenceQuestionResponse = snapshot.responses.last
            viewModel.researchEvidenceQuestion = snapshot.questionDraft
            viewModel.researchEvidenceQuestionCorrection = snapshot.correctionDraft
            viewModel.researchEvidenceQuestionMessage =
                "已恢复当前 exact report 的本机临时对话；到期 \(snapshot.expiresAt)。"
            refreshResearchEvidenceQuestionHistory(membership: membership, report: report)
        } catch {
            guard viewModel.researchEvidenceQuestionRequestId == requestId,
                  researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults) == clearMarker else { return }
            clearResearchEvidenceQuestion("本机临时对话读取失败或身份漂移；旧对话已清除。")
        }
    }
    func deleteAllCurrentResearchTemporaryConversations() {
        guard researchTemporaryConversationDeletionPending else {
            researchTemporaryConversationDeletionPending = true
            viewModel.researchEvidenceQuestionMessage =
                "再次点击确认：删除报告助手和个人调查的全部本机临时回答、追问与草稿；不触碰正式资料。"
            return
        }
        let cleared = clearAllLocalTemporaryResearch(defaults: viewModel.localDefaults)
        researchTemporaryConversationDeletionPending = false
        clearResearchEvidenceQuestion(cleared ? "全部本机临时研究已删除；报告、决定与服务器事实未变。"
            : "本机临时研究清除未完成；旧对话已从当前页面移除，请重试。")
    }
}
