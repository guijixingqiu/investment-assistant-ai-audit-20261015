import SwiftUI

extension GlobalSearchSheet {
    func apply(tab: AnnualRingsTab) {
        guard let symbol = SecuritySymbol.parseHongKongAlias(input) else {
            message = "无法识别港股代码；可先按公司名搜索并选择结果。"
            return
        }
        clearPendingResearchNavigation()
        symbolInput = symbol.canonical
        selectedTab = tab
        dismiss()
    }

    @MainActor
    func openExistingResearch(selectedSymbol: String? = nil) async {
        let originalInput = input
        guard let symbol = SecuritySymbol.parseHongKongAlias(selectedSymbol ?? originalInput) else {
            message = "无法识别港股代码；可先按公司名搜索并选择结果。"
            return
        }
        let requestId = UUID()
        candidateNavigationRequestId = requestId
        message = "正在确认精确研究成员。"
        let context = AppEnvironment.researchAuthorizationContext()
        let memberships = await ResearchClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        ).fetchCandidateMemberships(includeArchived: false)
        guard candidateNavigationRequestId == requestId,
              AppEnvironment.researchAuthorizationContext() == context,
              input == originalInput else { return }
        clearPendingResearchNavigation()
        symbolInput = symbol.canonical
        if let target = candidateResearchNavigationTarget(for: symbol.canonical, in: memberships) {
#if OWNER_CLIENT
            OwnerClientStore.shared.selectSymbol(target.symbol)
            OwnerClientStore.shared.selectedTemplateRing = 0
            OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(symbol: target.symbol, destination: .templateHome)
            selectedTab = .research
#else
            openResearchCandidate(target)
#endif
        } else if memberships.status != .unavailable {
#if OWNER_CLIENT
            OwnerClientStore.shared.selectSymbol(symbol.canonical)
            OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(symbol: symbol.canonical, destination: .templateHome)
#endif
            selectedTab = .research
        } else {
            message = "研究成员来源不可用；未打开可能错绑的研究。"
            return
        }
        dismiss()
    }
}

extension GlobalAssistantSheet {
    @ViewBuilder
    var globalAssistantSessionControls: some View {
        Text("本会话已完成 \(activeAssistantSessionCount)/\(researchEvidenceQuestionSessionLimit) 轮回答；失败与明确重试不计入。")
            .font(.caption).accessibilityIdentifier("globalAssistantSessionCount")
        if researchTemporaryConversationRetention() == .none {
            Text("已选不保留：离页后本机会话轮数和历史无法恢复。")
                .font(.caption).foregroundStyle(.orange)
        }
        if activeAssistantSessionCount >= researchEvidenceQuestionSessionLimit {
            Text("本会话已满。核对续接摘要并明确开启新会话后才能继续提问。")
                .font(.caption).foregroundStyle(.orange)
        }
        if !conversation.isEmpty {
            Button("准备新会话与续接摘要") { prepareNewAssistantSession() }
                .disabled(isAsking).accessibilityIdentifier("globalAssistantPrepareNewSession")
        }
        if newSessionSourceIdentity != nil {
            Text("本地摘要只供续接；你须核对未知和反证，它不是报告事实。")
                .font(.caption)
            TextField("核对续接摘要", text: $newSessionDraft, axis: .vertical)
                .disabled(isAsking)
                .accessibilityIdentifier("globalAssistantCarrySummaryDraft")
                .onChange(of: newSessionDraft) { _, _ in newSessionConfirmed = false }
            Toggle("我已核对摘要和未知／反证边界", isOn: $newSessionConfirmed)
                .disabled(isAsking)
            Button("明确开启新会话") { Task { await startNewAssistantSession() } }
                .disabled(!newSessionConfirmed || !researchEvidenceQuestionCarrySummaryIsBounded(newSessionDraft)
                    || isAsking)
                .accessibilityIdentifier("globalAssistantStartNewSession")
        }
        if !historySessions.isEmpty {
            DisclosureGroup("本机会话记录（\(historySessions.count)）") {
                ForEach(historySessions, id: \.sessionId) { snapshot in
                    Button("\(snapshot.savedAt) · \(snapshot.responses.count)/8 轮") {
                        historySelection = snapshot.sessionId
                    }
                }
                if let selected = historySessions.first(where: { $0.sessionId == historySelection }) {
                    Text("本机记录只读；回答和摘要不自动变成正式报告。")
                        .font(.caption)
                    ForEach(Array(selected.responses.enumerated()), id: \.offset) { pair in
                        Text("你：\(pair.element.question)").font(.caption.weight(.semibold))
                        Text(pair.element.answer ?? "尚无回答").font(.caption).textSelection(.enabled)
                    }
                }
            }
        }
    }

    func prepareNewAssistantSession() {
        guard let membership = answeredMembership, let report = answeredReport,
              let draft = draftResearchEvidenceQuestionCarrySummary(
                conversation.map(\.response), membership: membership, report: report
              ) else {
            message = "当前回答或报告身份无法核对；请恢复本机会话后重试。"
            return
        }
        newSessionSourceIdentity = researchTemporaryConversationIdentity(membership: membership, report: report)
        newSessionDraft = draft
        newSessionConfirmed = false
    }

    @MainActor
    func startNewAssistantSession() async {
        guard !isAsking, newSessionConfirmed,
              let membership = answeredMembership, let report = answeredReport,
              newSessionSourceIdentity == researchTemporaryConversationIdentity(membership: membership, report: report),
              draftResearchEvidenceQuestionCarrySummary(conversation.map(\.response),
                membership: membership, report: report) != nil else { return }
        let summary = newSessionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard researchEvidenceQuestionCarrySummaryIsBounded(summary) else { return }
        let sourceSessionId = sessionId
        let sourceResponses = conversation.map(\.response)
        let sourceSymbol = membership.symbol
        let marker = researchTemporaryConversationClearMarker()
        let revision = requestLane.begin()
        isAsking = true
        defer { if requestLane.accepts(revision) { isAsking = false } }
        do {
            let memberships = await client.fetchCandidateMemberships(includeArchived: false)
            let matches = memberships.memberships.filter {
                $0.symbol == membership.symbol && $0.state != .archived
            }
            guard requestLane.accepts(revision),
                  memberships.status == .available,
                  matches.count == 1, let current = matches.first,
                  current.actorId == membership.actorId,
                  current.id == membership.id,
                  current.version == membership.version,
                  current.state == membership.state,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == sourceSymbol,
                  marker == researchTemporaryConversationClearMarker() else {
                guard requestLane.accepts(revision) else { return }
                message = "研究身份或本机清除状态已变化；未开启新会话。"
                return
            }
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard requestLane.accepts(revision),
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == sourceSymbol,
                  sessionId == sourceSessionId,
                  conversation.map(\.response) == sourceResponses,
                  marker == researchTemporaryConversationClearMarker(),
                  let fresh = workspace.data?.reports.first(where: \.isCurrentExact),
                  fresh.id == report.id, fresh.version == report.version,
                  fresh.reportFingerprint == report.reportFingerprint,
                  fresh.evidencePackId == report.evidencePackId,
                  fresh.payload.evidencePackBinding?.fingerprint == report.payload.evidencePackBinding?.fingerprint else {
                guard requestLane.accepts(revision) else { return }
                message = "报告、证据包或当前标的已变化；未开启新会话。"
                return
            }
            let retention = researchTemporaryConversationRetention()
            if retention != .none {
                guard let latest = try loadResearchTemporaryConversation(
                    membership: membership, report: fresh
                ), latest.sessionId == sourceSessionId,
                    latest.responses == sourceResponses else {
                    message = "另一入口已有更新的会话；请恢复并核对全部轮数后再明确开启新会话。旧记录未覆盖。"
                    return
                }
                try persistTemporaryConversation()
            }
            let newSessionId = UUID().uuidString
            if retention != .none {
                try saveResearchTemporaryConversation(membership: membership, report: fresh,
                    responses: [], questionDraft: "", correctionDraft: "", retention: retention,
                    sessionId: newSessionId, carrySummary: summary,
                    carryFromSessionId: sourceSessionId)
            }
            sessionId = newSessionId
            carrySummary = summary
            carryFromSessionId = sourceSessionId
            conversation = []
            response = nil
            question = ""
            correction = ""
            answeredReport = fresh
            answeredMembership = membership
            answeredMembershipKey = [membership.actorId, membership.id, String(membership.version),
                membership.state.rawValue, membership.symbol].joined(separator: "|")
            observedTemporaryClearMarker = marker
            pendingQuestionRetry = nil
            evidenceQuestionReservation.clear()
            newSessionSourceIdentity = nil
            newSessionDraft = ""
            newSessionConfirmed = false
            refreshAssistantSessionHistory(membership: membership, report: fresh)
            message = retention == .none
                ? "已开启新会话；选择了不保留，离页后无法恢复旧会话。摘要不是事实。"
                : "已开启新会话并保留旧会话；摘要只是待核对提示。"
        } catch {
            guard requestLane.accepts(revision) else { return }
            message = "新会话保存或回读失败；旧会话保持，未开启新会话。"
        }
    }

    func refreshAssistantSessionHistory(membership: CandidateMembershipData, report: TwoLayerReportData) {
        historySessions = (try? listResearchTemporaryConversations(
            membership: membership, report: report)) ?? []
        historySelection = nil
    }

    var validAssistantCorrection: Bool {
        let value = correction.trimmingCharacters(in: .whitespacesAndNewlines)
        return !value.isEmpty && value.count <= 4000
    }

    @ViewBuilder
    func globalAssistantTurn(
        _ turn: ResearchEvidenceQuestionConversationTurn,
        report: TwoLayerReportData
    ) -> some View {
        let item = turn.response
        VStack(alignment: .leading, spacing: 7) {
            Text("你：\(item.question)")
                .font(.subheadline.weight(.semibold))
            Text(item.answer ?? "尚未形成回答").textSelection(.enabled).accessibilityIdentifier("globalAssistantAnswer")
            globalAssistantInsights(item.insights)
            if !item.unknowns.isEmpty {
                BulletList(title: "仍待核实", items: item.unknowns)
            }
            ForEach(item.answerFacts.indices, id: \.self) { index in
                let fact = item.answerFacts[index]
                ForEach(fact.evidenceIds, id: \.self) { evidenceId in
                    Button {
                        openAssistantHandoff(
                            .openCitation(fact, evidenceId: evidenceId),
                            response: item,
                            report: report
                        )
                    } label: { Label("重开引用 \(evidenceId)", systemImage: "doc.text.magnifyingglass") }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("globalAssistantCitation-\(evidenceId)")
                }
                if let reportFact = report.researchEvidenceQuestionFact(matching: fact),
                   let citation = reportFact.citation?.reopenableDocumentCitation {
                    Button {
                        openAssistantHandoff(
                            .openCitation(fact, evidenceId: nil),
                            response: item,
                            report: report
                        )
                    } label: { Label("重开档案快照引用 · PDF p\(citation.pageNumber)", systemImage: "doc.text.magnifyingglass") }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("globalAssistantSnapshotCitation-\(index)")
                }
                if (fact.sourceKind == "material"
                    && report.researchEvidenceQuestionFact(matching: fact)?.citation?.kind == "pack_evidence")
                    || (fact.sourceKind == "event" && fact.sourceId != nil) {
                    Button { openAssistantHandoff(.openExternalSource(fact), response: item, report: report) } label: { Label("重开绑定网页来源", systemImage: "safari") }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("globalAssistantExternalSource-\(index)")
                }
            }
            DisclosureGroup("来源与截止") {
                if let binding = item.binding {
                    Text("资料截止 \(binding.cutoffAt) · 报告 v\(binding.reportVersion) · 证据包 #\(binding.evidencePackId)")
                }
                if !report.payload.invalidationConditions.isEmpty {
                    Text("失效条件：\(report.payload.invalidationConditions.joined(separator: "；"))")
                }
                Text("生成方式：\(item.reproducibility.provider) · \(item.reproducibility.model) · 用量 \(item.reproducibility.tokenUsage) · cost \(item.reproducibility.cost)")
                globalAssistantSendManifest(item)
                Text("只读研究回答；不修改正式报告、正式决定、持仓或交易。")
            }
            .font(.caption.monospaced())
        }
        .padding(.vertical, 4)
    }

    func openAssistantHandoff(
        _ handoff: ResearchAssistantHandoff,
        response: ResearchEvidenceQuestionEnvelope,
        report: TwoLayerReportData
    ) {
        guard let membershipVersion = response.membershipVersion,
              let symbol = response.symbol else { return }
        openReportRevision(TodayReportRevisionNotice(
            membershipId: response.membershipId,
            membershipVersion: membershipVersion,
            symbol: symbol,
            reportId: report.id,
            reportVersion: report.version,
            reportFingerprint: report.reportFingerprint,
            evidencePackId: report.evidencePackId,
            source: .reportCard(report.id),
            nextValidationQuestion: report.payload.researchLayer?.nextValidationQuestions.first ?? response.question,
            savedAt: report.createdAt,
            assistantHandoff: handoff
        ))
        dismiss()
    }

    @ViewBuilder
    var globalAssistantCloudAiPolicySection: some View {
        Section("Cloud AI 授权") {
            Text(cloudAiPolicyMessage)
                .font(.caption)
                .foregroundStyle(cloudAiPolicy?.isEnabled == true ? .green : .orange)
                .accessibilityIdentifier("globalAssistantCloudAiPolicy")
            if let policy = cloudAiPolicy {
                DisclosureGroup("发送与隐私边界") {
                    Text("\(policy.policy.provider) / \(policy.policy.model) · \(policy.policy.processingRegion) · 保留期限不固定 · no-training 未保证")
                    Text("用途：\(policy.policy.purposes.joined(separator: "、"))")
                    Text("确认：\(policy.state?.confirmedAt ?? "未确认") · 撤权：\(policy.state?.revokedAt ?? "未撤权") · 删除请求：\(policy.state?.deletionRequest.status ?? "未知")")
                    Text("不发送整份 PDF、凭证或正式资产事实；不自动切换供应商。")
                    if let privacyURL = URL(string: policy.policy.privacyPolicyUrl),
                       let pricingURL = URL(string: policy.policy.pricingUrl) {
                        Link("隐私政策", destination: privacyURL)
                        Link("价格说明", destination: pricingURL)
                    }
                }
                .font(.caption)
            }
            Button(isLoadingCloudAiPolicy ? "读取中" : "重新读取授权") {
                Task { await loadCloudAiPolicy() }
            }
            .disabled(isAsking || isLoadingCloudAiPolicy)
            .accessibilityIdentifier("globalAssistantRefreshCloudAiPolicy")
        }
    }

    @ViewBuilder
    func globalAssistantSendManifest(_ item: ResearchEvidenceQuestionEnvelope) -> some View {
        if let manifest = item.sendManifest {
            Text("\(item.status == "available" ? "实际发送" : "发送尝试（提供方是否收到仍 UNKNOWN）")：\(manifest.factCount) 项事实、\(manifest.unknownCount) 项 UNKNOWN、\(manifest.conversationTurnCount) 轮上下文；证据 \(manifest.sourceEvidenceIds.joined(separator: ","))")
                .accessibilityIdentifier("globalAssistantSendManifest")
            Text("本地准备时间：\(manifest.preparedAt ?? "UNKNOWN")")
            if let input = manifest.inputTokenUpperBound,
               let output = manifest.maxOutputTokens,
               let cost = manifest.estimatedMaxCostUsd,
               let pricing = manifest.pricingIdentity {
                Text("发送前成本上界：输入 ≤\(input) + 输出 ≤\(output) tokens · 最多约 US$\(String(format: "%.8f", cost)) · \(pricing)")
            }
            Text("请求 SHA-256：\(manifest.requestBodySha256)").textSelection(.enabled)
            Text(manifest.policySnapshot?.sendManifestSummary ?? "历史发送未固化地区、保留与训练条款。")
            Text(manifest.sendAuthorization?.sendAuthorizationSummary ?? "历史发送未固化发送时 Owner 授权状态。")
            Text("未发送整份 PDF、凭证或正式资产事实。")
        } else {
            Text("本回答未经过 Cloud AI；没有外发清单。")
        }
    }

    @MainActor
    func loadCloudAiPolicy() async {
        let requestId = UUID()
        cloudAiPolicyRequestId = requestId
        currentResearchReportReady = false
        currentResearchReportMessage = "正在核对当前版本研究报告。"
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            cloudAiPolicy = nil
            cloudAiPolicyMessage = "请先选择一只有效港股，再读取 Cloud AI 授权。"
            currentResearchReportMessage = "请先选择一只有效港股。"
            return
        }
        guard AppEnvironment.authToken() != nil else {
            cloudAiPolicy = nil
            cloudAiPolicyMessage = "尚未配置读取 API 令牌；请先关闭助手并在右上角连接设置中配置。"
            currentResearchReportMessage = "缺少读取授权，无法核对当前报告。"
            return
        }
        isLoadingCloudAiPolicy = true
        cloudAiPolicy = nil
        cloudAiPolicyMessage = "正在读取当前 Owner 的 Cloud AI 授权。"
        defer {
            if cloudAiPolicyRequestId == requestId { isLoadingCloudAiPolicy = false }
        }
        do {
            let memberships = await client.fetchCandidateMemberships(includeArchived: false)
            guard cloudAiPolicyRequestId == requestId,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
            let matches = memberships.status == .available
                ? memberships.memberships.filter { $0.symbol == symbol.canonical && $0.state != .archived }
                : []
            guard matches.count == 1, let membership = matches.first else {
                cloudAiPolicyMessage = memberships.status == .available
                    ? "当前股票没有唯一有效研究身份；无法绑定 Cloud AI 授权。"
                    : "研究身份暂不可用；Cloud AI 授权未读取。"
                currentResearchReportMessage = memberships.status == .available
                    ? "没有唯一有效研究身份；请先到 Research 工作区核对。"
                    : "研究身份读取失败：\(memberships.message)"
                return
            }
            let policy = try await client.fetchCloudAiPolicy(expectedActorId: membership.actorId)
            guard cloudAiPolicyRequestId == requestId,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
            cloudAiPolicy = policy
            if policy.isEnabled && AppEnvironment.writeAuthToken() == nil {
                cloudAiPolicyMessage = "Owner 已启用 Cloud AI；此客户端缺少写入令牌，当前不能提交问题。请先补齐连接设置。"
            } else {
                cloudAiPolicyMessage = policy.isEnabled
                    ? "Cloud AI 已由当前 Owner 启用；提问前仍会再次 fresh-read。"
                    : "Cloud AI 尚未启用；请在 Research 工作区查看条款并明确确认。"
            }
            guard policy.isEnabled, AppEnvironment.writeAuthToken() != nil else {
                currentResearchReportMessage = policy.isEnabled
                    ? "缺少写入授权，不能向 AI 提交问题。"
                    : "Cloud AI 尚未启用；未读取或外发报告内容。"
                return
            }
            do {
                let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
                guard cloudAiPolicyRequestId == requestId,
                      SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
                currentResearchReportReady = workspace.data?.reports.contains(where: \.isCurrentExact) == true
                currentResearchReportMessage = currentResearchReportReady
                    ? "已读取当前版本研究报告；可以基于其中证据提问。"
                    : "当前没有可追问的最新版研究报告；先进入研究工作区补齐材料并生成报告。"
            } catch {
                guard cloudAiPolicyRequestId == requestId else { return }
                currentResearchReportMessage = "当前研究报告读取失败；请先在研究工作区检查，助手保持禁用。"
            }
        } catch {
            guard cloudAiPolicyRequestId == requestId else { return }
            cloudAiPolicyMessage = "Cloud AI 授权读取失败：\(error.localizedDescription)"
        }
    }

    func invalidateAnswer(_ newMessage: String) {
        requestLane.invalidate()
        isAsking = false
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
        newSessionSourceIdentity = nil
        newSessionDraft = ""
        newSessionConfirmed = false
        correction = ""
        evidenceQuestionReservation.clear()
        pendingQuestionRetry = nil
        message = newMessage
    }

    func persistTemporaryConversation() throws {
        guard let membership = answeredMembership,
              let report = answeredReport else { return }
        guard observedTemporaryClearMarker == researchTemporaryConversationClearMarker() else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
        try saveResearchTemporaryConversation(
            membership: membership,
            report: report,
            responses: conversation.map(\.response),
            questionDraft: question,
            correctionDraft: correction,
            retention: ResearchTemporaryConversationRetention(
                rawValue: temporaryConversationRetentionRaw
            ) ?? .thirtyDays,
            sessionId: sessionId,
            carrySummary: carrySummary,
            carryFromSessionId: carryFromSessionId
        )
    }

    func saveTemporaryConversationWithMessage() {
        do {
            try persistTemporaryConversation()
            message = "当前 exact report 临时对话已写入本机保留期；未上传服务器或备份。"
        } catch {
            message = "本机临时对话保存失败；旧保存状态未冒充为成功。"
        }
    }

    func deleteAllTemporaryConversations() {
        guard temporaryConversationDeletionPending else {
            temporaryConversationDeletionPending = true
            message = "再次点击确认：删除报告助手和个人调查的全部本机临时回答、追问与草稿；不触碰正式资料。"
            return
        }
        let cleared = clearAllLocalTemporaryResearch()
        observedTemporaryClearMarker = researchTemporaryConversationClearMarker()
        temporaryConversationDeletionPending = false
        invalidateAnswer(cleared ? "全部本机临时研究已删除；报告、决定与服务器事实未变。"
            : "本机临时研究清除未完成；旧对话已从当前页面移除，请重试。")
    }

    func acceptsTemporaryConversationRevision(_ revision: UUID, marker: String?) -> Bool {
        requestLane.accepts(revision) && researchTemporaryConversationClearMarker() == marker
    }

    @MainActor
    func restoreTemporaryConversation() async {
        guard !isAsking,
              let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else { return }
        let clearMarker = researchTemporaryConversationClearMarker()
        if observedTemporaryClearMarker != clearMarker {
            observedTemporaryClearMarker = clearMarker
            invalidateAnswer("本机临时研究已清除；旧对话不再恢复。")
        }
        let revision = requestLane.begin()
        isAsking = true
        message = "正在 fresh read 当前 membership 与 report，再恢复精确绑定的本机临时对话。"
        defer { if requestLane.accepts(revision) { isAsking = false } }
        do {
            let memberships = await client.fetchCandidateMemberships(includeArchived: false)
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker),
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
            guard memberships.status == .available else {
                invalidateAnswer("研究清单暂不可用，未恢复旧对话；请重试读取。")
                return
            }
            let matches = memberships.memberships.filter {
                $0.symbol == symbol.canonical && $0.state != .archived
            }
            guard matches.count == 1, let membership = matches.first else {
                invalidateAnswer("当前股票没有唯一有效 membership；未恢复临时对话。")
                return
            }
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            guard let report = workspace.data?.reports.filter(\.isCurrentExact).max(by: { $0.version < $1.version }) else {
                invalidateAnswer("没有可核对的当前报告，未恢复旧对话；请打开研究核对资料。")
                return
            }
            guard let snapshot = try loadResearchTemporaryConversation(
                membership: membership,
                report: report
            ) else {
                invalidateAnswer("当前 exact report 没有未过期的本机临时对话。")
                return
            }
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            conversation = snapshot.responses.map(ResearchEvidenceQuestionConversationTurn.init)
            pendingQuestionRetry = nil
            sessionId = snapshot.sessionId
            carrySummary = snapshot.carrySummary
            carryFromSessionId = snapshot.carryFromSessionId
            response = snapshot.responses.last
            answeredReport = report
            answeredMembership = membership
            answeredMembershipKey = [
                membership.actorId, membership.id, String(membership.version),
                membership.state.rawValue, membership.symbol
            ].joined(separator: "|")
            question = snapshot.questionDraft
            correction = snapshot.correctionDraft
            message = "已恢复当前 exact report 的本机临时对话；到期 \(snapshot.expiresAt)，未写服务器或正式记录。"
            refreshAssistantSessionHistory(membership: membership, report: report)
        } catch {
            guard acceptsTemporaryConversationRevision(revision, marker: clearMarker) else { return }
            invalidateAnswer("本机临时对话读取失败或身份漂移；旧对话已清除。")
        }
    }

    @MainActor
    func openCurrentResearch() async {
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else { return }
        let requestId = UUID()
        candidateNavigationRequestId = requestId
        message = "正在确认精确研究成员。"
        let context = AppEnvironment.researchAuthorizationContext()
        let memberships = await ResearchClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        ).fetchCandidateMemberships(includeArchived: false)
        guard candidateNavigationRequestId == requestId,
              AppEnvironment.researchAuthorizationContext() == context,
              SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
        let target = candidateResearchNavigationTarget(for: symbol.canonical, in: memberships)
        guard target != nil || memberships.status != .unavailable else {
            message = "研究成员来源不可用；未打开可能错绑的研究。"
            return
        }
        clearPendingResearchNavigation()
        selectedDecisionLayer = .evidence
        if let target {
            openResearchCandidate(target)
        } else {
            selectedTab = .research
        }
        dismiss()
    }
}
