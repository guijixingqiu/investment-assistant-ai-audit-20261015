import SwiftUI
extension GateBResearchScreen {
    @MainActor
    private func clearMembershipBoundResearchWorkspaces(_ message: String) {
        let identity = selectedMembership.map {
            "\($0.id):\($0.version):\($0.symbol):\($0.actorId):\($0.state.rawValue):\(viewModel.authorizationRevision.uuidString)"
        } ?? "unselected:\(viewModel.authorizationRevision.uuidString)"
        researchDocumentWorkspace.clearForIdentityChange(identity)
        futuFinancialWorkspace.clear(identity)
        researchFundamentalWorkspace.clearForIdentityChange()
        researchFinancialRequirementWorkspace.clearForIdentityChange()
        researchValuationScenarioWorkspace.clearForIdentityChange()
        decisionReviewHistory = nil
        decisionReviewMessage = message
    }

    @MainActor
    func hasLoadedAssistDecisionPath() -> Bool {
        selectedMembership != nil ||
            decisionIntakeModel.state != "idle" ||
            annualDecisionBriefModel.state != "idle" ||
            advisoryScopeModel.state != "idle" ||
            humanReviewWorkspaceModel.state != "idle" ||
            reviewFollowUpWorkflowModel.state != "idle" ||
            decisionNoteWorkflowModel.state != "idle" ||
            localRecordDrafts != .empty ||
            localRecordMessage != nil
    }

    @MainActor
    func refreshSelectedMembershipAfterMembershipSourceRefresh() -> String? {
        guard let currentMembership = selectedMembership else {
            return nil
        }
        guard candidateMemberships.status != .unavailable,
              let refreshedMembership = candidateMemberships.memberships.first(where: { $0.id == currentMembership.id }),
              parsedSymbol?.canonical == refreshedMembership.symbol else {
            researchContextWorkspace.rebind(
                to: nil,
                message: "研究自选来源不可用；旧行业与同业上下文已清除。"
            )
            frozenResearchEvidenceWorkspace.clearAfterMembershipSelectionLost(
                selectedMembership: &selectedMembership, message: "研究成员来源不可用或不再包含已选候选；旧冻结展示与确认已清除。"
            )
            clearMembershipBoundResearchWorkspaces("研究成员来源不可用或已移除；旧 PDF、基本面、估值与复盘历史已清除。")
            invalidateTwoLayerReport("membership 来源不可用；旧两层报告状态已清除。")
            clearReviewKnowledgeDisplay("研究自选来源不再包含已选候选；本地复盘知识显示已清除，存储未删除。")
            return nil
        }
        let identityChanged = refreshedMembership.id != currentMembership.id
            || refreshedMembership.version != currentMembership.version
            || refreshedMembership.actorId != currentMembership.actorId
            || refreshedMembership.symbol != currentMembership.symbol
            || refreshedMembership.state != currentMembership.state
        if identityChanged {
            clearMembershipBoundResearchWorkspaces(
                "研究成员身份、版本或状态已变化；旧 PDF、基本面、估值与复盘历史已清除。"
            )
        }
        researchContextWorkspace.rebind(
            to: refreshedMembership.state == .archived ? nil : refreshedMembership,
            message: refreshedMembership.state == .archived
                ? "membership 已归档；旧行业与同业上下文已清除。"
                : "membership 已变化；正在重新读取行业与同业上下文。"
        )
        selectedMembership = refreshedMembership
        synchronizeFrozenResearchBinding(
            "研究成员身份、版本或状态已变化；旧冻结展示与确认已清除。"
        )
        return refreshedMembership.id
    }

    @MainActor
    func clearCandidateDecisionPathAfterMembershipRefresh(
        state: String = "unavailable",
        message: String = "研究自选来源已刷新；请重新读取决策准备后再使用下游 ASSIST 事实。",
        membershipId: String? = nil,
        localRecordStatusMessage: String = "研究自选来源变化；本地记录隐藏，直到当前来源事实重新加载。",
        force: Bool = false
    ) {
        guard force || hasLoadedAssistDecisionPath() else {
            return
        }
        requestState.cancelDecisionIntakePath()
        let targetMembershipId = membershipId ?? selectedMembership?.id
        clearTodayResearch(message, membershipId: targetMembershipId)
        clearAnnualDecisionBrief(
            state: state,
            message: message,
            membershipId: targetMembershipId
        )
        decisionIntakeModel = candidateDecisionIntakeFailClosedModel(
            state: state,
            message: message,
            membershipId: targetMembershipId
        )
        clearDecisionIntakeDownstream(
            state: state,
            message: message,
            membershipId: targetMembershipId,
            localRecordStatusMessage: localRecordStatusMessage
        )
    }

    @MainActor
    func clearDecisionIntakeDownstream(
        state: String,
        message: String,
        membershipId: String? = nil,
        localRecordStatusMessage: String
    ) {
        requestState.cancelAdvisoryScopePath()
        advisoryScopeModel = assistAdvisoryScopeFailClosedModel(
            state: state,
            message: message,
            membershipId: membershipId
        )
        clearAdvisoryScopeDownstream(
            state: state,
            message: message,
            membershipId: membershipId,
            localRecordStatusMessage: localRecordStatusMessage
        )
    }

    @MainActor
    func clearAdvisoryScopeDownstream(
        state: String,
        message: String,
        membershipId: String? = nil,
        localRecordStatusMessage: String
    ) {
        requestState.cancelHumanReviewWorkspacePath()
        humanReviewWorkspaceModel = assistHumanReviewWorkspaceFailClosedModel(
            state: state,
            message: message,
            membershipId: membershipId
        )
        clearHumanReviewWorkspaceDownstream(
            state: state,
            message: message,
            membershipId: membershipId,
            localRecordStatusMessage: localRecordStatusMessage
        )
    }

    @MainActor
    func clearHumanReviewWorkspaceDownstream(
        state: String,
        message: String,
        membershipId: String? = nil,
        localRecordStatusMessage: String
    ) {
        requestState.cancelReviewFollowUpWorkflowPath()
        clearReviewFollowUpWorkflow(
            state: state,
            message: message,
            membershipId: membershipId,
            localRecordStatusMessage: localRecordStatusMessage
        )
    }

    @MainActor
    func selectMembershipForAction(
        _ membership: CandidateMembershipData,
        layer: DailyDecisionRingLayer,
        expandResult: Bool = false,
        refreshesContext: Bool = true
    ) {
        pendingDecisionBriefMembershipAfterSymbolChange = nil
        let previousMembershipId = selectedMembership?.id
        let previousMembershipVersion = selectedMembership?.version
        let previousMembershipSymbol = selectedMembership?.symbol
        let symbolWillChange = parsedSymbol?.canonical != membership.symbol
        let membershipIdentityChanged = previousMembershipId != membership.id
            || previousMembershipVersion != membership.version
            || previousMembershipSymbol != membership.symbol
        decisionLayerAfterSymbolChange = symbolWillChange ? layer : nil
        researchContextWorkspace.rebind(
            to: membership.state == .archived ? nil : membership,
            message: membership.state == .archived
                ? "membership 已归档；旧行业与同业上下文已清除。"
                : symbolWillChange
                    ? "已切换候选；行业与同业上下文将随统一刷新重新读取。"
                    : "已切换 membership；正在重新读取行业与同业上下文。"
        )
        selectedMembership = membership
        if symbolWillChange { symbolInput = membership.symbol }
        if membershipIdentityChanged {
            invalidateTwoLayerReport("已切换候选成员；旧报告和追问回答已清除。")
            clearReviewKnowledgeDisplay("已切换候选标的；上一标的的本地复盘知识显示已清除，存储未删除。")
            requestState.cancelDecisionIntakePath()
            clearAnnualDecisionBrief(
                state: "unavailable",
                message: "已切换到 \(membership.symbol)；上一候选的每日简报事实已清除。",
                membershipId: membership.id
            )
            decisionIntakeModel = candidateDecisionIntakeFailClosedModel(
                state: "unavailable",
                message: "已切换到 \(membership.symbol)；必须为当前成员重新读取决策准备。",
                membershipId: membership.id
            )
            clearDecisionIntakeDownstream(
                state: "unavailable",
                message: "选中研究自选已变化；下游 ASSIST 事实必须为当前成员重新读取。",
                membershipId: membership.id,
                localRecordStatusMessage: "选中研究自选已变化；本地记录隐藏，直到当前 decision-note 事实重新加载。"
            )
        } else {
            syncAnnualDecisionBriefProfileDraft(from: envelope)
        }
        if refreshesContext && !symbolWillChange && membership.state != .archived {
            Task { await loadResearchContext(for: membership) }
        }
        showDailyDecisionLayer(layer, expandResult: expandResult)
    }

    @MainActor
    func openMobileWorkspace(for membership: CandidateMembershipData) async {
        selectMembershipForAction(
            membership,
            layer: .review,
            expandResult: true,
            refreshesContext: false
        )
        await loadResearchContext(for: membership)
        await loadProfile()
        await loadAnnualDecisionBrief(for: membership)
        await loadCandidateDecisionIntake(for: membership)
        await loadAssistAdvisoryScope(for: membership)
        await loadAssistHumanReviewWorkspace(for: membership)
        await loadAssistReviewFollowUpWorkflow(for: membership)
        await loadAssistDecisionNoteWorkflow(for: membership)
    }

    @MainActor
    func refreshCandidates() async {
        let requestId = requestState.beginCandidateLoad()
        let overview = await client.fetchCandidateOverview()
        guard requestState.isCurrentCandidateLoad(requestId) else {
            return
        }
        candidateOverview = overview
        requestState.finishCandidateLoad(id: requestId)
    }

    @MainActor
    @discardableResult
    func refreshMemberships() async -> ResearchContextMembershipBinding? {
        let requestId = requestState.beginMembershipLoad()
        clearCandidateDecisionPathAfterMembershipRefresh(
            message: "正在刷新研究自选来源；下游 ASSIST 事实必须在刷新后重新读取。",
            localRecordStatusMessage: "研究自选来源正在刷新；本地记录隐藏，直到当前来源事实重新加载。"
        )
        let memberships = await client.fetchCandidateMemberships(includeArchived: includeArchivedMemberships)
        guard requestState.isCurrentMembershipLoad(requestId) else {
            return nil
        }
        candidateMemberships = memberships
        let refreshedMembershipId = refreshSelectedMembershipAfterMembershipSourceRefresh()
        let contextMembership = selectedMembership?.state == .archived ? nil : selectedMembership
        if let contextMembership {
            await loadResearchContext(for: contextMembership)
        }
        if memberships.status == .unavailable {
            clearCandidateDecisionPathAfterMembershipRefresh(
                state: "unavailable",
                message: memberships.message,
                membershipId: refreshedMembershipId,
                localRecordStatusMessage: "研究自选读取失败；本地记录隐藏，直到当前来源事实重新可用。",
                force: true
            )
        } else {
            clearCandidateDecisionPathAfterMembershipRefresh(
                state: "unavailable",
                message: "研究自选来源已刷新；请重新读取决策准备后再使用下游 ASSIST 事实。",
                membershipId: refreshedMembershipId,
                localRecordStatusMessage: "研究自选来源已刷新；本地记录隐藏，直到当前来源事实重新加载。"
            )
        }
        requestState.finishMembershipLoad(id: requestId)
        return contextMembership.map(ResearchContextMembershipBinding.init)
    }
    @MainActor
    func loadCandidateDecisionIntake(for membership: CandidateMembershipData) async {
        await loadTodayResearch(for: membership)
        let requestId = requestState.beginDecisionIntakeLoad()
        clearAnnualPortfolioLab(message: "正在刷新候选决策准备；旧组合实验室的报价绑定已清除。", membershipId: membership.id)
        decisionIntakeModel = candidateDecisionIntakeFailClosedModel(state: "loading", message: "正在读取 \(membership.symbol) 的决策准备。", membershipId: membership.id)
        clearDecisionIntakeDownstream(
            state: "unavailable", message: "决策准备来源正在读取；下游 ASSIST 事实必须为当前成员重新加载。", membershipId: membership.id,
            localRecordStatusMessage: "决策准备来源正在读取；本地记录隐藏，直到当前下游事实重新加载。"
        )
        let envelope = await client.fetchCandidateDecisionIntake(membershipId: membership.id)
        guard requestState.isCurrentDecisionIntakeLoad(requestId) else { return }
        let responseIsBound = envelope.membershipId == membership.id && (envelope.status != .available || candidateMembershipIdentityMatches(membership, membershipIds: [envelope.membership?.id], symbol: envelope.membership?.symbol, version: envelope.membership?.version))
        guard candidateMembershipIdentityMatches(membership, membershipIds: [selectedMembership?.id], symbol: selectedMembership?.symbol, version: selectedMembership?.version), responseIsBound else {
            decisionIntakeModel = candidateDecisionIntakeFailClosedModel(state: "malformed", message: "候选身份或响应来源不一致；事实和本地草稿已清除。", membershipId: membership.id)
            clearDecisionIntakeDownstream(state: "malformed", message: "候选身份或响应来源不一致；事实和本地草稿已清除。", membershipId: membership.id, localRecordStatusMessage: "候选身份或响应来源不一致；事实和本地草稿已清除。")
            requestState.finishDecisionIntakeLoad(id: requestId)
            return
        }
        decisionIntakeModel = candidateDecisionIntakeRenderModel(from: envelope)
        if envelope.status != .available {
            clearDecisionIntakeDownstream(
                state: decisionIntakeModel.state,
                message: envelope.message,
                membershipId: envelope.membershipId,
                localRecordStatusMessage: "决策准备读取失败；本地记录隐藏，直到当前来源事实可用。"
            )
        }
        requestState.finishDecisionIntakeLoad(id: requestId)
    }

    @MainActor
    func loadAssistAdvisoryScope(for membership: CandidateMembershipData) async {
        let requestId = requestState.beginAdvisoryScopeLoad()
        advisoryScopeModel = assistAdvisoryScopeFailClosedModel(state: "loading", message: "正在读取 \(membership.symbol) 的 ASSIST 范围。", membershipId: membership.id)
        clearAdvisoryScopeDownstream(
            state: "unavailable", message: "ASSIST 范围来源正在读取；下游工作台事实必须为当前成员重新加载。", membershipId: membership.id,
            localRecordStatusMessage: "ASSIST 范围来源正在读取；本地记录隐藏，直到当前工作台事实重新加载。"
        )
        let envelope = await client.fetchAssistAdvisoryScope(membershipId: membership.id)
        guard requestState.isCurrentAdvisoryScopeLoad(requestId) else { return }
        let responseIsBound = envelope.status != .available || candidateMembershipIdentityMatches(membership, membershipIds: [envelope.candidateMembershipId, envelope.target.candidateMembershipId], symbol: envelope.target.symbol)
        guard candidateMembershipIdentityMatches(membership, membershipIds: [selectedMembership?.id], symbol: selectedMembership?.symbol, version: selectedMembership?.version), responseIsBound else {
            requestState.finishAdvisoryScopeLoad(id: requestId)
            clearDecisionIntakeDownstream(state: "malformed", message: "候选身份或响应来源不一致；事实和本地草稿已清除。", membershipId: membership.id, localRecordStatusMessage: "候选身份或响应来源不一致；事实和本地草稿已清除。")
            return
        }
        advisoryScopeModel = assistAdvisoryScopeRenderModel(from: envelope)
        if envelope.status != .available {
            clearAdvisoryScopeDownstream(
                state: advisoryScopeModel.state,
                message: envelope.message,
                membershipId: advisoryScopeModel.membershipId,
                localRecordStatusMessage: "ASSIST 范围读取失败；本地记录隐藏，直到当前来源事实可用。"
            )
        }
        requestState.finishAdvisoryScopeLoad(id: requestId)
    }

    @MainActor
    func loadAssistHumanReviewWorkspace(for membership: CandidateMembershipData) async {
        let requestId = requestState.beginHumanReviewWorkspaceLoad()
        humanReviewWorkspaceModel = assistHumanReviewWorkspaceFailClosedModel(state: "loading", message: "正在读取 \(membership.symbol) 的本地人工复核工作台。", membershipId: membership.id)
        clearHumanReviewWorkspaceDownstream(
            state: "unavailable", message: "人工复核工作台来源正在读取；follow-up 和 decision-note 事实必须为当前成员重新加载。", membershipId: membership.id,
            localRecordStatusMessage: "人工复核工作台来源正在读取；本地记录隐藏，直到当前 follow-up 事实重新加载。"
        )
        let envelope = await client.fetchAssistHumanReviewWorkspace(membershipId: membership.id)
        guard requestState.isCurrentHumanReviewWorkspaceLoad(requestId) else { return }
        let responseIsBound = envelope.status != .available || candidateMembershipIdentityMatches(membership, membershipIds: [envelope.target.candidateMembershipId, envelope.sourceEnvelopeRef.candidateMembershipId], symbol: envelope.target.symbol)
        guard candidateMembershipIdentityMatches(membership, membershipIds: [selectedMembership?.id], symbol: selectedMembership?.symbol, version: selectedMembership?.version), responseIsBound else {
            requestState.finishHumanReviewWorkspaceLoad(id: requestId)
            clearAdvisoryScopeDownstream(state: "malformed", message: "候选身份或响应来源不一致；事实和本地草稿已清除。", membershipId: membership.id, localRecordStatusMessage: "候选身份或响应来源不一致；事实和本地草稿已清除。")
            return
        }
        humanReviewWorkspaceModel = assistHumanReviewWorkspaceRenderModel(from: envelope)
        if envelope.status != .available {
            clearHumanReviewWorkspaceDownstream(
                state: humanReviewWorkspaceModel.state,
                message: envelope.message,
                membershipId: humanReviewWorkspaceModel.membershipId,
                localRecordStatusMessage: "人工复核工作台读取失败；本地记录隐藏，直到当前来源事实可用。"
            )
        }
        requestState.finishHumanReviewWorkspaceLoad(id: requestId)
    }

    @MainActor
    func loadAssistReviewFollowUpWorkflow(for membership: CandidateMembershipData) async {
        let requestId = requestState.beginReviewFollowUpWorkflowLoad()
        requestState.cancelDecisionNoteWorkflowLoad()
        clearReviewFollowUpWorkflow(
            state: "loading", message: "正在读取 \(membership.symbol) 的本地复核后续 workflow。", membershipId: membership.id,
            localRecordStatusMessage: "复核后续 workflow 正在读取；本地记录隐藏，直到当前 decision-note 事实重新加载。"
        )
        let envelope = await client.fetchAssistReviewFollowUpWorkflow(membershipId: membership.id)
        guard requestState.isCurrentReviewFollowUpWorkflowLoad(requestId) else { return }
        let exposesFacts = envelope.status == .available || envelope.status == .blockedWorkspace
        let responseIsBound = !exposesFacts || candidateMembershipIdentityMatches(membership, membershipIds: [envelope.target.candidateMembershipId], symbol: envelope.target.symbol)
        guard candidateMembershipIdentityMatches(membership, membershipIds: [selectedMembership?.id], symbol: selectedMembership?.symbol, version: selectedMembership?.version), responseIsBound else {
            clearReviewFollowUpWorkflow(state: "malformed", message: "候选身份或响应来源不一致；事实和本地草稿已清除。", membershipId: membership.id, localRecordStatusMessage: "候选身份或响应来源不一致；事实和本地草稿已清除。")
            requestState.finishReviewFollowUpWorkflowLoad(id: requestId)
            return
        }
        if exposesFacts {
            reviewFollowUpWorkflowModel = assistReviewFollowUpWorkflowRenderModel(from: envelope, drafts: reviewFollowUpDrafts)
        } else {
            clearReviewFollowUpWorkflow(
                state: assistReviewFollowUpWorkflowRenderModel(from: envelope).state,
                message: envelope.message,
                membershipId: envelope.target.candidateMembershipId,
                localRecordStatusMessage: "复核后续 workflow 读取失败；本地记录隐藏，直到当前来源事实可用。"
            )
        }
        requestState.finishReviewFollowUpWorkflowLoad(id: requestId)
    }

    @MainActor
    func loadAssistDecisionNoteWorkflow(for membership: CandidateMembershipData) async {
        let requestId = requestState.beginDecisionNoteWorkflowLoad()
        clearDecisionNoteWorkflow(
            state: "loading", message: "正在读取 \(membership.symbol) 的本地 decision note workflow。", membershipId: membership.id,
            localRecordStatusMessage: "Decision-note workflow 正在读取；本地记录隐藏，直到当前来源事实被接受。"
        )
        let envelope = await client.fetchAssistDecisionNoteWorkflow(membershipId: membership.id)
        guard requestState.isCurrentDecisionNoteWorkflowLoad(requestId) else { return }
        let exposesFacts = envelope.status == .available || envelope.status == .blockedFollowUp
        let responseIsBound = !exposesFacts || candidateMembershipIdentityMatches(membership, membershipIds: [envelope.target.candidateMembershipId], symbol: envelope.target.symbol)
        guard candidateMembershipIdentityMatches(membership, membershipIds: [selectedMembership?.id], symbol: selectedMembership?.symbol, version: selectedMembership?.version), responseIsBound else {
            clearDecisionNoteWorkflow(state: "malformed", message: "候选身份或响应来源不一致；事实和本地草稿已清除。", membershipId: membership.id, localRecordStatusMessage: "候选身份或响应来源不一致；事实和本地草稿已清除。")
            requestState.finishDecisionNoteWorkflowLoad(id: requestId)
            return
        }
        if exposesFacts {
            decisionNoteWorkflowModel = assistDecisionNoteWorkflowRenderModel(from: envelope, drafts: decisionNoteDrafts)
            localRecordClearConfirmationSourceSignature = nil
            localRecordMessage = "当前 source signature 已可用；可保存或读取本机非官方记录。"
        } else {
            clearDecisionNoteWorkflow(
                state: assistDecisionNoteWorkflowRenderModel(from: envelope).state,
                message: envelope.message,
                membershipId: envelope.target.candidateMembershipId,
                localRecordStatusMessage: "Decision-note workflow 读取失败；本地记录隐藏，直到当前来源事实可用。"
            )
        }
        loadReviewKnowledgeForSelectedCandidate()
        requestState.finishDecisionNoteWorkflowLoad(id: requestId)
    }

    @MainActor
    func clearReviewFollowUpWorkflow(
        state: String,
        message: String,
        membershipId: String? = nil,
        localRecordStatusMessage: String? = nil
    ) {
        requestState.cancelDecisionNoteWorkflowLoad()
        reviewFollowUpDrafts = .empty
        reviewFollowUpWorkflowModel = assistReviewFollowUpWorkflowFailClosedModel(
            state: state,
            message: message,
            membershipId: membershipId
        )
        clearDecisionNoteWorkflow(
            state: state,
            message: message,
            membershipId: membershipId,
            localRecordStatusMessage: localRecordStatusMessage
        )
    }

    @MainActor
    func clearDecisionNoteWorkflow(
        state: String,
        message: String,
        membershipId: String? = nil,
        localRecordStatusMessage: String? = nil
    ) {
        decisionNoteDrafts = .empty
        localRecordDrafts = .empty
        localRecordClearConfirmationSourceSignature = nil
        localRecordSnapshotSummary = []
        localRecordEnvelopeId = nil
        localRecordEnvelopeSourceSignature = nil
        localRecordMessage = localRecordStatusMessage ?? "本地记录显示已清除：decision-note workflow \(state)。"
        clearReviewKnowledgeDisplay("本地复盘知识显示已清除：decision-note workflow \(state)，存储未删除。")
        decisionNoteWorkflowModel = assistDecisionNoteWorkflowFailClosedModel(
            state: state,
            message: message,
            membershipId: membershipId
        )
    }

    @MainActor
    func refreshReviewFollowUpDraftSummary() {
        reviewFollowUpWorkflowModel = AssistReviewFollowUpWorkflowRenderModel(
            state: reviewFollowUpWorkflowModel.state,
            membershipId: reviewFollowUpWorkflowModel.membershipId,
            symbol: reviewFollowUpWorkflowModel.symbol,
            title: reviewFollowUpWorkflowModel.title,
            message: reviewFollowUpWorkflowModel.message,
            reviewState: reviewFollowUpWorkflowModel.reviewState,
            steps: reviewFollowUpWorkflowModel.steps,
            intents: reviewFollowUpWorkflowModel.intents,
            evidenceGaps: reviewFollowUpWorkflowModel.evidenceGaps,
            suggestedLocalViews: reviewFollowUpWorkflowModel.suggestedLocalViews,
            blockedExternalActions: reviewFollowUpWorkflowModel.blockedExternalActions,
            draftSummary: assistReviewFollowUpDraftSummary(reviewFollowUpDrafts),
            safety: reviewFollowUpWorkflowModel.safety,
            failClosedExplanation: reviewFollowUpWorkflowModel.failClosedExplanation,
            generatedAt: reviewFollowUpWorkflowModel.generatedAt
        )
    }
    @MainActor
    func refreshDecisionNoteDraftSummary() {
        decisionNoteWorkflowModel = AssistDecisionNoteWorkflowRenderModel(
            state: decisionNoteWorkflowModel.state,
            membershipId: decisionNoteWorkflowModel.membershipId,
            symbol: decisionNoteWorkflowModel.symbol,
            title: decisionNoteWorkflowModel.title,
            message: decisionNoteWorkflowModel.message,
            noteState: decisionNoteWorkflowModel.noteState,
            factReferences: decisionNoteWorkflowModel.factReferences,
            unresolvedEvidenceGaps: decisionNoteWorkflowModel.unresolvedEvidenceGaps,
            laterReviewEntry: decisionNoteWorkflowModel.laterReviewEntry,
            blockedExternalActions: decisionNoteWorkflowModel.blockedExternalActions,
            draftSummary: assistDecisionNoteDraftSummary(decisionNoteDrafts),
            safety: decisionNoteWorkflowModel.safety,
            failClosedExplanation: decisionNoteWorkflowModel.failClosedExplanation,
            generatedAt: decisionNoteWorkflowModel.generatedAt
        )
    }
}
