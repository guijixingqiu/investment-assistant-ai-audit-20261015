import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    var currentHoldingEventSourceIdentity: some View {
        if let membership = selectedMembership,
           let context = portfolioContext,
           context.status == .available,
           let position = context.positions.first(where: { $0.symbol == membership.symbol }) {
            VStack(alignment: .leading, spacing: 4) {
                Text("将绑定你授权的当前平安持仓").font(.caption.weight(.semibold))
                Text("快照 \(context.portfolioSnapshotId ?? "未提供") · 截止 \(context.sourceAsOf ?? "未提供")")
                Text("持仓行 \(position.sourceRowId)")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("researchEventHoldingSourceIdentity")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("当前没有可验证且包含该标的的平安持仓；不能记录持仓逻辑变化。")
                    .font(.caption)
                    .foregroundStyle(.orange)
                Button("重新读取当前持仓") { Task { await loadPortfolioDecisionContext() } }
                    .buttonStyle(.bordered)
                    .disabled(isLoadingPortfolioContext)
            }
        }
    }

    func currentHoldingEventSourceIsExact(for symbol: String) -> Bool {
        portfolioContext?.status == .available
            && portfolioContext?.accountScopeId != nil
            && portfolioContext?.portfolioSnapshotId != nil
            && portfolioContext?.sourceAsOf != nil
            && portfolioContext?.positions.contains(where: { $0.symbol == symbol }) == true
    }

    func currentHoldingEventMatches(_ event: ResearchAnnouncementEventData, symbol: String) -> Bool {
        guard event.coverageScope == "current_holding",
              event.source.sourceType == ResearchEventCaptureDraft.holdingLogicSourceType,
              event.source.revisionState == "current",
              event.source.freshness == "fresh",
              event.source.verificationStatus == "verified",
              ["user_provided", "authorized_public"].contains(event.source.rightsStatus),
              researchContextDate(event.source.validUntil).map({ $0 > Date() }) == true,
              let binding = event.holdingBinding,
              let context = portfolioContext,
              context.status == .available,
              let position = context.positions.first(where: { $0.symbol == symbol }) else { return false }
        return binding.accountScopeId == context.accountScopeId
            && binding.snapshotId == context.portfolioSnapshotId
            && binding.sourceAsOf == context.sourceAsOf
            && binding.positionSourceRowId == position.sourceRowId
            && position.sourceRowId.hasPrefix("broker_import_batches:\(binding.sourceBatchId)/")
    }

    func todayEventMatches(
        _ item: TodayResearchItem,
        event: ResearchAnnouncementEventData,
        category: TodayResearchCategory
    ) -> Bool {
        guard item.category == category,
              item.trackingState == .needsReview,
              item.priority == event.importance,
              item.bindings.factRefs.count == 1,
              item.bindings.eventRefs.count == 1,
              let factRef = item.bindings.factRefs.first,
              let eventRef = item.bindings.eventRefs.first,
              factRef.materialId == event.source.materialId,
              factRef.evidenceId == event.source.evidenceId,
              factRef.sourceType == event.source.sourceType,
              factRef.sourceVersion == event.source.sourceVersion,
              factRef.revision == event.source.revision,
              factRef.contentFingerprint == event.source.contentFingerprint,
              factRef.publishedAt == event.source.publishedAt,
              factRef.capturedAt == event.source.capturedAt,
              factRef.validUntil == event.source.validUntil,
              factRef.verificationStatus == event.source.verificationStatus,
              factRef.rightsStatus == event.source.rightsStatus else { return false }
        return eventRef.eventId == event.id
            && eventRef.eventVersion == event.eventVersion
            && eventRef.eventFingerprint == event.eventFingerprint
            && eventRef.coverageScope == event.coverageScope
            && eventRef.keyVariable == event.keyVariable
            && eventRef.hypothesisImpact == event.hypothesisImpact
            && eventRef.monitorRuleBinding == event.monitorRuleBinding
    }

    func todayHoldingEventMatches(_ item: TodayResearchItem, event: ResearchAnnouncementEventData) -> Bool {
        guard todayEventMatches(item, event: event, category: .holdingLogicChange),
              item.bindings.holdingSnapshotRefs.count == 1,
              let holdingRef = item.bindings.holdingSnapshotRefs.first,
              let binding = event.holdingBinding else { return false }
        return holdingRef.accountScopeId == binding.accountScopeId
            && holdingRef.snapshotId == binding.snapshotId
            && holdingRef.sourceBatchId == binding.sourceBatchId
            && holdingRef.sourceAsOf == binding.sourceAsOf
            && holdingRef.positionSourceRowId == binding.positionSourceRowId
    }

    func todayResearchEventMatches(_ item: TodayResearchItem, event: ResearchAnnouncementEventData) -> Bool {
        todayEventMatches(item, event: event, category: .researchChange)
            && item.bindings.holdingSnapshotRefs.isEmpty
    }

    private func holdingEventRequiresToday(_ event: ResearchAnnouncementEventData) -> Bool {
        ["high", "medium"].contains(event.importance)
            && ["supports", "weakens"].contains(event.hypothesisImpact)
    }

    private func researchEventRequiresToday(_ event: ResearchAnnouncementEventData) -> Bool {
        ["high", "medium", "low"].contains(event.importance)
            && ["supports", "weakens"].contains(event.hypothesisImpact)
    }

    @MainActor
    private func hideResearchEventWriteFacts(_ membershipId: String, _ message: String) {
        frozenResearchEvidenceWorkspace.envelope = nil
        clearTodayResearch(message, membershipId: membershipId)
        invalidateTwoLayerReport(message)
    }

    @MainActor
    func saveVerifiedResearchEvent() async {
        guard canSaveVerifiedResearchEvent, let membership = selectedMembership else { return }
        let authorizationRevision = viewModel.authorizationRevision
        let context = AppEnvironment.researchAuthorizationContext()
        let fingerprint = "\(membership.id)|\(membership.version)|\(researchEventDraft.fingerprint)"
        let materialKey = researchEventMaterialReservation.reserve(for: fingerprint, prefix: "ios-owner-verified-material")
        let eventKey = researchEventBindingReservation.reserve(for: fingerprint, prefix: "ios-owner-verified-event")
        let replacement = researchEventDraft.replacementMaterial
        let replacedMaterialId = replacement?.id
        let coverageScope = researchEventDraft.coverageScope
        let monitorRuleBinding = currentResearchEventMonitorRuleBinding
        guard researchEventDraft.monitorRuleBinding == nil || monitorRuleBinding != nil else { return }
        let holdingContextId = coverageScope == "current_holding" ? portfolioContext?.contextId : nil
        guard let request = researchEventDraft.materialRequest(
            membership: membership,
            allowedVariables: currentResearchEventVariables,
            idempotencyKey: materialKey
        ) else { return }
        isSavingResearchEvent = true
        defer { isSavingResearchEvent = false }
        do {
            guard await freshResearchEventReplacementForWrite(replacement, membership: membership, fingerprint: fingerprint) else { return }
            if coverageScope == "current_holding" {
                hideResearchEventWriteFacts(membership.id, "正在核对持仓逻辑写入；旧研究、Today 与报告事实已暂时隐藏。")
            }
            let result = try await client.createVerifiedResearchEventAndReadBack(
                membership: membership,
                materialRequest: request,
                eventKind: researchEventDraft.eventKind,
                coverageScope: coverageScope,
                monitorRuleBinding: monitorRuleBinding,
                eventIdempotencyKey: eventKey
            )
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == context,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.state == membership.state,
                  selectedMembership?.actorId == membership.actorId,
                  parsedSymbol?.canonical == membership.symbol,
                  researchEventDraft.coverageScope == coverageScope,
                  result.event.monitorRuleBinding == monitorRuleBinding,
                  (coverageScope == "research_stock"
                    ? result.event.holdingBinding == nil
                    : portfolioContext?.contextId == holdingContextId
                        && currentHoldingEventMatches(result.event, symbol: membership.symbol)),
                  result.material.replacesMaterialId == replacedMaterialId else {
                if coverageScope == "current_holding" {
                    hideResearchEventWriteFacts(membership.id, "持仓逻辑写入返回时来源已变化；旧成功态保持隐藏，可用同一幂等身份重试。")
                } else if replacedMaterialId != nil {
                    failClosedEvidenceConflict("替代写入返回时授权、membership、actor、版本或来源已变化；旧成功态已清除。")
                }
                researchEventMessage = "写入返回时研究来源已变化；请重新读取当前标的核对结果。"
                return
            }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            if coverageScope == "current_holding" {
                todayRefreshRevision &+= 1
                await loadTodayResearch(for: membership)
                guard todayResearch.status == .available,
                      !holdingEventRequiresToday(result.event) || todayResearch.items.contains(where: {
                          todayHoldingEventMatches($0, event: result.event)
                      }) else {
                    hideResearchEventWriteFacts(membership.id, "持仓逻辑事件未取得 exact Today 回读；旧成功态保持隐藏。")
                    researchEventMessage = "持仓逻辑事件已回读，但 Today 尚未确认同一事件；输入与幂等身份已保留，可明确重试。"
                    return
                }
            } else {
                frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: currentFrozenResearchBindingIdentity)
                invalidateTwoLayerReport("新研究材料已保存；旧冻结包与报告不得冒充当前版本。")
                todayRefreshRevision &+= 1
                await loadTodayResearch(for: membership)
                guard todayResearch.status == .available,
                      !researchEventRequiresToday(result.event) || todayResearch.items.contains(where: {
                          todayResearchEventMatches($0, event: result.event)
                      }) else {
                    hideResearchEventWriteFacts(membership.id, "研究事件未取得 exact Today 来源回读；旧成功态保持隐藏。")
                    researchEventMessage = "研究事件已回读，但 Today 尚未确认同一事件与材料来源；输入与幂等身份已保留，可明确重试。"
                    return
                }
            }
            let preservedVariable = researchEventDraft.variableName
            if pendingNoticeLead?.item.url == request.sourceUrl {
                pendingNoticeLead = nil
            }
            researchEventDraft.reset(preserving: preservedVariable, coverageScope: coverageScope)
            researchEventMaterialReservation.clear()
            researchEventBindingReservation.clear()
            if let replacedMaterialId {
                let todayReadback = coverageScope == "research_stock" && researchEventRequiresToday(result.event)
                    ? "，Today 已精确回读同一事件"
                    : ""
                researchEventMessage = "已用材料 #\(result.material.id) 替代 #\(replacedMaterialId) 并 fresh read\(todayReadback)；请重新冻结证据后生成报告。"
            } else if coverageScope == "current_holding" {
                researchEventMessage = holdingEventRequiresToday(result.event)
                    ? "已按当前平安快照保存持仓逻辑事件 #\(result.event.id)，Today 已精确回读；不会自动修改持仓。"
                    : "已按当前平安快照保存持仓逻辑事件 #\(result.event.id)；它未达到 Today 提醒门槛，但可在资产层查看。"
            } else {
                researchEventMessage = researchEventRequiresToday(result.event)
                    ? "已保存材料 #\(result.material.id) 并绑定事件 #\(result.event.id)，Today 已精确回读同一事件；请重新冻结证据后生成报告。"
                    : "已保存材料 #\(result.material.id) 并绑定事件 #\(result.event.id)；该事件没有方向性影响，不进入 Today。"
            }
            if coverageScope == "current_holding" {
                selectedDecisionLayer = .portfolio
                selectedPortfolioWorkspace = .current
                pendingDecisionWorkspaceScrollTarget = "holdingLogicChanges"
            } else {
                pendingDecisionWorkspaceScrollTarget = "freezeResearchEvidenceButton"
            }
        } catch {
            if coverageScope == "current_holding" {
                hideResearchEventWriteFacts(membership.id, "持仓逻辑保存未取得完整回读；旧成功态保持隐藏。")
                researchEventMessage = "保存未完整确认；输入与幂等身份已保留，可明确重试，不会重复写入同一材料或事件。"
            } else if replacedMaterialId != nil {
                failClosedEvidenceConflict("替代证据未取得可验证回读；旧 pack/report 成功态与替代草稿已清除。")
            } else {
                researchEventMessage = "保存未完整确认；输入与幂等身份已保留，可明确重试，不会重复写入同一材料或事件。"
            }
        }
    }

    @MainActor
    func openHoldingLogicCapture(
        target: TodayCandidateNavigationTarget,
        membership: CandidateMembershipData,
        authorizationRevision: UUID
    ) async -> Bool {
        await loadPortfolioDecisionContext()
        guard requestedTodayCandidateTarget == target,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version else {
            requestedTodayCandidateTarget = nil
            dailyContinuityMessage = "当前持仓来源在读取期间已变化；未打开旧持仓事件表单。"
            return false
        }
        researchEventDraft.coverageScope = "current_holding"
        isResearchEventCaptureExpanded = true
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .frozen
        pendingDecisionWorkspaceScrollTarget = "researchAnnouncementEvents"
        researchEventMessage = currentHoldingEventSourceIsExact(for: membership.symbol)
            ? "已重新读取当前平安持仓；请核对来源并明确保存持仓逻辑变化。"
            : "当前持仓不可验证；表单已打开但不会允许写入旧或缺失的持仓身份。"
        return true
    }

    func routeTodayResearchMaterialAction(_ item: TodayResearchItem) -> Bool {
        if let holdingEvent = item.bindings.eventRefs.first(where: { $0.coverageScope == "current_holding" }) {
            guard let event = frozenResearchEvidenceWorkspace.envelope?.data?.events.first(where: {
                $0.id == holdingEvent.eventId
                    && currentHoldingEventMatches($0, symbol: item.symbol)
                    && todayHoldingEventMatches(item, event: $0)
            }) else { return false }
            selectedDecisionLayer = .portfolio
            selectedPortfolioWorkspace = .current
            pendingDecisionWorkspaceScrollTarget = "holdingLogicEvent-\(event.id)"
        } else {
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = item.bindings.eventRefs.first(where: { $0.coverageScope == "research_stock" })
                .map { "twoLayerReportLatestChange-\($0.eventId)" } ?? "twoLayerReportLatestChanges"
        }
        return true
    }
}
