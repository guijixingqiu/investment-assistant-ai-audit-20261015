import Foundation

extension GateBResearchScreen {
    @MainActor
    func clearAnnualDecisionBrief(
        state: String,
        message: String,
        membershipId: String? = nil,
        clearDrafts: Bool = true
    ) {
        requestState.cancelDecisionBriefLoad()
        clearAnnualValuationQuant(message: message, membershipId: membershipId)
        clearAnnualPortfolioLab(message: message, membershipId: membershipId)
        annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
            state: state,
            message: message,
            membershipId: membershipId
        )
        annualDecisionBriefWriteMessage = nil
        if clearDrafts {
            annualDecisionBriefProfileDraft = .empty
            annualDecisionBriefProfileDraftSource = nil
            annualDecisionBriefEvidenceDraft = .empty
        }
    }

    @MainActor
    func syncAnnualDecisionBriefProfileDraft(from envelope: ResearchProfileEnvelope) {
        guard let membership = selectedMembership,
              let source = AnnualDecisionBriefProfileDraftSource(
                  membershipId: membership.id,
                  membershipVersion: membership.version,
                  symbol: membership.symbol,
                  envelope: envelope
              ) else {
            annualDecisionBriefProfileDraft = .empty
            annualDecisionBriefProfileDraftSource = nil
            return
        }
        if let profile = envelope.data?.profile {
            annualDecisionBriefProfileDraft = AnnualDecisionBriefProfileDraft(profile: profile)
        } else {
            annualDecisionBriefProfileDraft = .empty
        }
        annualDecisionBriefProfileLoadedDraft = annualDecisionBriefProfileDraft
        annualDecisionBriefProfileDraftSource = source
    }

    @MainActor
    func prepareAnnualDecisionBriefEditor(for membership: CandidateMembershipData) async {
        guard selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol else {
            return
        }
        annualDecisionBriefWriteMessage = "正在读取当前候选和版本的研究档案；写入暂时禁用。"
        await loadProfile()
        guard selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol else {
            return
        }
        guard let source = annualDecisionBriefProfileDraftSource,
              source.allowsProfileWrite(
                  membershipId: membership.id,
                  membershipVersion: membership.version,
                  symbol: membership.symbol
              ) else {
            annualDecisionBriefWriteMessage = "当前候选的研究档案未能完成身份绑定；为防止覆盖未加载事实，写入保持禁用。"
            return
        }
        annualDecisionBriefWriteMessage = source.state == .missing
            ? "已确认当前候选尚无研究档案；可先保存首份研究论点，再记录证据。"
            : "当前候选和版本的研究档案已加载，可以编辑。"
    }

    @MainActor
    func loadAnnualDecisionBrief(for membership: CandidateMembershipData) async {
        guard !isWritingAnnualDecisionBriefResearch,
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol,
              parsedSymbol?.canonical == membership.symbol else {
            return
        }
        clearAnnualConditionalDecisionPreview("每日简报正在重读；旧冻结预览已清除。", membershipId: membership.id)
        let requestId = requestState.beginDecisionBriefLoad()
        annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
            state: "loading",
            message: "正在读取 \(membership.symbol) 的每日决策简报。",
            membershipId: membership.id
        )
        let envelope = await client.fetchAnnualDecisionBrief(membershipId: membership.id)
        guard requestState.isCurrentDecisionBriefLoad(requestId) else { return }
        guard selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol,
              parsedSymbol?.canonical == membership.symbol else {
            annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
                state: "superseded",
                message: "候选身份或版本已变化；旧简报响应已丢弃。",
                membershipId: membership.id
            )
            requestState.finishDecisionBriefLoad(id: requestId)
            return
        }
        if let target = envelope.data?.target,
           (target.membershipId != membership.id || target.membershipVersion != membership.version || target.symbol != membership.symbol) {
            annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
                state: "malformed",
                message: "每日简报身份与当前候选不一致，已阻止展示。",
                membershipId: membership.id
            )
        } else {
            annualDecisionBriefModel = annualDecisionBriefRenderModel(from: envelope)
        }
        requestState.finishDecisionBriefLoad(id: requestId)
    }

    @MainActor
    func submitAnnualDecisionBriefProfile() async {
        guard !isWritingAnnualDecisionBriefResearch else { return }
        if clientDestination == .manualResearch,
           (manualHandoffSession.verifiedHandoffId == nil || manualHandoffSession.verifiedHandoffId != ownerStore.personalFormalHandoff?.id) {
            annualDecisionBriefWriteMessage = "所选问题与来源尚未完成重新核验；研究草稿保留。"
            return
        }
        guard let membership = selectedMembership,
              membership.state != .archived,
              let symbol = parsedSymbol,
              membership.symbol == symbol.canonical,
              annualDecisionBriefProfileDraftSource?.allowsProfileWrite(
                  membershipId: membership.id,
                  membershipVersion: membership.version,
                  symbol: membership.symbol
              ) == true else {
            annualDecisionBriefWriteMessage = "请先读取并绑定当前未归档候选的研究档案，再保存研究简报。"
            return
        }
        let normalizedRequest: UpdateResearchProfileRequest
        do {
            normalizedRequest = try annualDecisionBriefProfileDraft.request(
                membershipId: membership.id,
                membershipVersion: membership.version,
                idempotencyKey: "fingerprint"
            )
        } catch AnnualDecisionBriefDraftError.invalid(let message) {
            annualDecisionBriefWriteMessage = message
            return
        } catch {
            annualDecisionBriefWriteMessage = "研究论点输入无效。"
            return
        }
        let fingerprint = AnnualDecisionBriefProfileSubmissionFingerprint(
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            request: normalizedRequest
        )
        guard let submission = annualDecisionBriefProfileSubmissionState.begin(fingerprint: fingerprint) else { return }
        let request = UpdateResearchProfileRequest(
            membershipId: membership.id,
            membershipVersion: membership.version,
            currentView: normalizedRequest.currentView,
            currentThesis: normalizedRequest.currentThesis,
            marketDisagreement: normalizedRequest.marketDisagreement,
            invalidationCondition: normalizedRequest.invalidationCondition,
            nextReviewOn: normalizedRequest.nextReviewOn,
            keyVariables: normalizedRequest.keyVariables,
            catalysts: normalizedRequest.catalysts,
            evidenceGaps: normalizedRequest.evidenceGaps,
            monitorRules: normalizedRequest.monitorRules,
            idempotencyKey: submission.idempotencyKey
        )
        beginAnnualDecisionBriefResearchWrite(
            membership: membership,
            message: "正在保存研究论点；旧简报事实已清除。"
        )
        let writeAuthorizationRevision = viewModel.authorizationRevision
        do {
            let response = try await client.updateProfile(market: symbol.market, code: symbol.code, request: request)
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            guard annualDecisionBriefProfileSubmissionState.isCurrent(submission) else { return }
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  response.data.symbol == membership.symbol else {
                _ = annualDecisionBriefProfileSubmissionState.finishFailurePreservingRetry(for: submission)
                return
            }
            annualDecisionBriefWriteMessage = "研究论点已通过幂等审计 API 保存；正在刷新简报事实。"
            await loadProfile()
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.symbol == membership.symbol else {
                _ = annualDecisionBriefProfileSubmissionState.finishFailurePreservingRetry(for: submission)
                return
            }
            guard (envelope.data?.profile.monitorRules ?? []) == (response.data.monitorRules ?? []) else {
                _ = annualDecisionBriefProfileSubmissionState.finishFailurePreservingRetry(for: submission)
                annualDecisionBriefWriteMessage = "保存后的监控规则未能按相同版本重新读取；未显示成功，请重试。"
                return
            }
            guard annualDecisionBriefProfileSubmissionState.finishSuccessOrReplay(for: submission) else { return }
            todayRefreshRevision &+= 1
            annualDecisionBriefWriteMessage = normalizedRequest.monitorRules == nil
                ? "研究论点已保存并重新读取。"
                : "研究论点与正式监控规则已由 Owner 确认版本并重新读取。"
            await loadAnnualDecisionBrief(for: membership)
        } catch {
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            guard annualDecisionBriefProfileSubmissionState.finishFailurePreservingRetry(for: submission) else { return }
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else {
                return
            }
            annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
                state: "unavailable",
                message: "研究论点保存失败；写入前简报不会作为当前事实复用。",
                membershipId: membership.id
            )
            annualDecisionBriefWriteMessage = "研究论点保存失败；相同内容重试会复用幂等键：\(error.localizedDescription)"
        }
    }

    @MainActor
    func submitAnnualDecisionBriefEvidence() async {
        guard !isWritingAnnualDecisionBriefResearch else { return }
        if clientDestination == .manualResearch,
           (manualHandoffSession.verifiedHandoffId == nil || manualHandoffSession.verifiedHandoffId != ownerStore.personalFormalHandoff?.id) {
            annualDecisionBriefWriteMessage = "所选问题与来源尚未完成重新核验；证据草稿保留。"
            return
        }
        guard let membership = selectedMembership,
              membership.state != .archived,
              let symbol = parsedSymbol,
              membership.symbol == symbol.canonical,
              annualDecisionBriefProfileDraftSource?.allowsEvidenceWrite(
                  membershipId: membership.id,
                  membershipVersion: membership.version,
                  symbol: membership.symbol
              ) == true else {
            annualDecisionBriefWriteMessage = "请先读取当前候选的既有研究档案；尚无档案时须先保存首份研究论点，再记录证据。"
            return
        }
        let normalizedRequest: CreateEvidenceRequest
        do {
            normalizedRequest = try annualDecisionBriefEvidenceDraft.request(
                membershipId: membership.id,
                membershipVersion: membership.version,
                idempotencyKey: "fingerprint"
            )
        } catch AnnualDecisionBriefDraftError.invalid(let message) {
            annualDecisionBriefWriteMessage = message
            return
        } catch {
            annualDecisionBriefWriteMessage = "证据输入无效。"
            return
        }
        let selectedManualSource = clientDestination == .manualResearch
            ? ownerStore.personalFormalHandoff?.manualSources.first(where: { $0.id == manualSelectedEvidenceSourceId })
            : nil
        let manualHandoffId = ownerStore.personalFormalHandoff?.id
        if clientDestination == .manualResearch, selectedManualSource == nil {
            annualDecisionBriefWriteMessage = "请先从已核验的来源中选择一条，再保存这条证据。"
            return
        }
        if let selectedManualSource {
            let expectedType = selectedManualSource.provider == nil
                ? selectedManualSource.sourceType : "futu_opend_financial_statement_provider"
            let expectedURL = selectedManualSource.provider == nil ? selectedManualSource.url : nil
            guard normalizedRequest.sourceType == expectedType,
                  normalizedRequest.sourceUrl == expectedURL else {
                annualDecisionBriefWriteMessage = "来源类型或地址已离开所选原件；请重新选择来源后再保存。"
                return
            }
        }
        let fingerprint = AnnualDecisionBriefEvidenceSubmissionFingerprint(
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            request: normalizedRequest
        )
        guard let submission = annualDecisionBriefEvidenceSubmissionState.begin(fingerprint: fingerprint) else { return }
        let request = CreateEvidenceRequest(
            membershipId: membership.id,
            membershipVersion: membership.version,
            sourceType: normalizedRequest.sourceType,
            sourceUrl: normalizedRequest.sourceUrl,
            summary: normalizedRequest.summary,
            factKind: normalizedRequest.factKind,
            stance: normalizedRequest.stance,
            variableName: normalizedRequest.variableName,
            reliability: normalizedRequest.reliability,
            materiality: normalizedRequest.materiality,
            isRead: normalizedRequest.isRead,
            idempotencyKey: submission.idempotencyKey
        )
        beginAnnualDecisionBriefResearchWrite(
            membership: membership,
            message: "正在记录证据；旧简报事实已清除。"
        )
        let writeAuthorizationRevision = viewModel.authorizationRevision
        do {
            let response = try await client.createEvidence(market: symbol.market, code: symbol.code, request: request)
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else {
                _ = annualDecisionBriefEvidenceSubmissionState.finishFailurePreservingRetry(for: submission)
                return
            }
            if let selectedManualSource {
                await loadProfile()
                guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision),
                      annualDecisionBriefEvidenceSubmissionState.isCurrent(submission),
                      ownerStore.personalFormalHandoff?.id == manualHandoffId,
                      manualHandoffSession.verifiedHandoffId == manualHandoffId,
                      selectedMembership?.id == membership.id,
                      selectedMembership?.version == membership.version,
                      envelope.data?.evidence.contains(where: { item in
                          item.id == response.data.id
                              && item.sourceType == normalizedRequest.sourceType
                              && item.sourceUrl == normalizedRequest.sourceUrl
                              && item.summary == normalizedRequest.summary
                      }) == true else {
                    _ = annualDecisionBriefEvidenceSubmissionState.finishFailurePreservingRetry(for: submission)
                    annualDecisionBriefWriteMessage = "写入响应已收到，但当前研究档案未回读到同一条证据；草稿与幂等键保留。"
                    return
                }
                guard annualDecisionBriefEvidenceSubmissionState.finishSuccessOrReplay(for: submission) else { return }
                manualHandoffSession.savedEvidenceBySource[selectedManualSource.id] = response.data.id
                manualSelectedEvidenceSourceId = nil
            } else {
                guard annualDecisionBriefEvidenceSubmissionState.finishSuccessOrReplay(for: submission) else { return }
            }
            annualDecisionBriefEvidenceDraft = .empty
            annualDecisionBriefWriteMessage = "证据已通过幂等审计 API 记录；正在刷新简报事实。"
            if selectedManualSource == nil { await loadProfile() }
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.symbol == membership.symbol else { return }
            annualDecisionBriefWriteMessage = "证据已通过幂等审计 API 记录；正在刷新简报事实。"
            await loadAnnualDecisionBrief(for: membership)
        } catch {
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            guard annualDecisionBriefEvidenceSubmissionState.finishFailurePreservingRetry(for: submission) else { return }
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else {
                return
            }
            annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
                state: "unavailable",
                message: "证据记录失败；写入前简报不会作为当前事实复用。",
                membershipId: membership.id
            )
            annualDecisionBriefWriteMessage = "证据记录失败；相同内容重试会复用幂等键：\(error.localizedDescription)"
        }
    }

    @MainActor
    private func beginAnnualDecisionBriefResearchWrite(
        membership: CandidateMembershipData,
        message: String
    ) {
        clearAnnualConditionalDecisionPreview(message, membershipId: membership.id)
        requestState.cancelDecisionBriefLoad()
        annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
            state: "loading",
            message: message,
            membershipId: membership.id
        )
        annualDecisionBriefWriteMessage = message
    }

    @MainActor
    func invalidateAnnualDecisionBriefForUpstreamChange(
        _ message: String,
        membership: CandidateMembershipData?,
        clearDrafts: Bool = false
    ) {
        clearAnnualConditionalDecisionPreview(message, membershipId: membership?.id)
        clearAnnualDecisionBrief(
            state: membership == nil ? "idle" : "loading",
            message: message,
            membershipId: membership?.id,
            clearDrafts: clearDrafts
        )
    }

    @MainActor
    func reloadAnnualDecisionBriefIfStillBound(to membership: CandidateMembershipData?) async {
        guard let membership,
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol,
              parsedSymbol?.canonical == membership.symbol else {
            return
        }
        await loadAnnualDecisionBrief(for: membership)
    }
}
