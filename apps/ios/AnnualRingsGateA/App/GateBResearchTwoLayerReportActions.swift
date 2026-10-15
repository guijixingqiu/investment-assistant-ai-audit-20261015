import Foundation
import SwiftUI
extension GateBResearchScreen {
    var valuationQuantClient: AnnualValuationQuantFetching { viewModel.valuationQuantClient }
    var portfolioClient: PortfolioDecisionFetching { viewModel.portfolioClient }
    var portfolioLabClient: AnnualPortfolioLabFetching { viewModel.portfolioLabClient }
    var conditionalDecisionClient: AnnualConditionalDecisionPreviewFetching { viewModel.conditionalDecisionClient }
    var marketDailyClient: MarketDailyTechnicalFetching { viewModel.marketDailyClient }
    var parsedSymbol: SecuritySymbol? { SecuritySymbol.parseHongKongAlias(symbolInput) }
    var client: ResearchClient { viewModel.client }
    @MainActor
    func setPendingResearchReportRevisionSource(_ source: TodayReportRevisionSource?) {
        pendingResearchReportRevisionSourceReservation = source.map {
            TodayReportRevisionSourceReservation(source: $0)
        }
    }
    @MainActor
    func clearReportRevisionDecisionReservation() {
        submissionState.discardForSourceDrift()
        researchReportFormalDecisionBinding = nil
        resetResearchReportFormalDecisionDraft()
    }
    var currentTwoLayerReportPack: FrozenResearchEvidencePack? {
        twoLayerReportWorkspace.envelope?.data?.latestPack
            ?? frozenResearchEvidenceWorkspace.envelope?.data?.latestPack
    }
    var currentTwoLayerReportBindingIdentity: TwoLayerReportBindingIdentity? {
        guard let membership = selectedMembership else { return nil }
        return TwoLayerReportBindingIdentity(
            membership: membership,
            pack: currentTwoLayerReportPack
        )
    }
    var latestEligiblePriorReport: TwoLayerReportData? {
        guard !twoLayerReportWorkspace.isStaleRead,
              let membership = selectedMembership, membership.state == .tracked,
              let workspace = twoLayerReportWorkspace.envelope,
              workspace.status == "available", workspace.isFreshForCurrentResearch,
              workspace.membershipId == membership.id,
              workspace.requestedActorId == membership.actorId,
              workspace.requestedSymbol == membership.symbol,
              let data = workspace.data,
              data.target.membershipId == membership.id,
              data.target.membershipVersion == membership.version,
              data.target.membershipState == membership.state.rawValue,
              data.target.symbol == membership.symbol,
              let pack = data.latestPack,
              pack.membershipId == membership.id,
              pack.membershipVersion == membership.version,
              pack.symbol == membership.symbol,
              let report = data.latestReport,
              DeepResearchTaskIntent.eligiblePriorReport(report, for: pack,
                  decision: data.userDecision) != nil else { return nil }
        return report
    }
    var selectedPriorReportIsEligible: Bool {
        guard let selected = twoLayerReportWorkspace.draft?.taskIntent?.priorReport else { return true }
        guard let report = latestEligiblePriorReport,
              let pack = currentTwoLayerReportPack else { return false }
        return selected == DeepResearchTaskIntent.eligiblePriorReport(report, for: pack,
            decision: twoLayerReportWorkspace.envelope?.data?.userDecision)
    }
    var deepResearchForegroundRefreshIdentity: String {
        guard scenePhase == .active,
              selectedTab == .research,
              let task = twoLayerReportWorkspace.pendingSynthesisTask,
              ["pending", "running"].contains(task.status) else {
            return "inactive"
        }
        return "\(task.id):\(task.requestFingerprint):\(task.status):\(task.updatedAt):\(twoLayerReportWorkspace.synthesisTaskAutoRefreshRevision)"
    }
    @MainActor
    func invalidateTwoLayerReport(
        _ message: String,
        preservingRevisionSource: Bool = false
    ) {
#if OWNER_CLIENT
        clearPersonalFormalMaterialReview()
        personalFormalMessage = nil
#endif
        clearResearchEvidenceQuestion(message)
        if researchReportFormalDecisionBinding != nil
            || submissionState.hasResearchReportSubmission {
            submissionState.discardForSourceDrift()
        }
        if submittedDecision?.researchReportDecision.availability == "preserved" {
            clearSubmittedDecision()
        }
        researchReportFormalDecisionBinding = nil
        researchReportFormalDecisionMessage = nil
        resetResearchReportFormalDecisionDraft()
        clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
        todayReportRevisionNotice = nil
        if !preservingRevisionSource {
            setPendingResearchReportRevisionSource(nil)
        }
        pendingTodayReportConfirmationReservation = nil
        comparedReportFirstId = nil
        comparedReportSecondId = nil
        comparedMembershipId = nil
        comparedExternalWorkspace = nil
        comparedExternalReportId = nil
        comparedCurrentCrossStockReportId = nil
        comparedExternalRequestId = UUID()
        isLoadingComparedExternalReports = false
        comparedExternalMessage = "请选择另一只研究股票读取报告。"
        twoLayerReportRejectionReason = ""
        twoLayerReportWorkspace.clear(message)
    }
    @MainActor
    func loadComparedExternalReports() async {
        guard let current = selectedMembership,
              let targetId = comparedMembershipId,
              let target = candidateMemberships.memberships.first(where: {
                  $0.id == targetId
                      && $0.actorId == current.actorId
                      && $0.symbol != current.symbol
                      && $0.state != .archived
              }) else {
            comparedExternalWorkspace = nil
            comparedExternalReportId = nil
            comparedExternalMessage = "请选择另一只当前可读的研究股票。"
            return
        }
        let requestId = UUID()
        let authorizationRevision = viewModel.authorizationRevision
        comparedExternalRequestId = requestId
        isLoadingComparedExternalReports = true
        comparedExternalWorkspace = nil
        comparedExternalReportId = nil
        comparedExternalMessage = "正在读取 \(target.symbol) 的不可变报告版本…"
        defer {
            if comparedExternalRequestId == requestId { isLoadingComparedExternalReports = false }
        }
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: target)
            guard comparedExternalRequestId == requestId,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == current.id,
                  selectedMembership?.version == current.version,
                  candidateMemberships.memberships.contains(where: {
                      $0.id == target.id
                          && $0.version == target.version
                          && $0.symbol == target.symbol
                          && $0.state == target.state
                  }) else { return }
            comparedExternalWorkspace = workspace
            comparedExternalReportId = workspace.data?.reports.first?.id
            comparedExternalMessage = "已读取 \(target.symbol) 的 \(workspace.data?.reports.count ?? 0) 个报告版本。"
        } catch {
            guard comparedExternalRequestId == requestId else { return }
            comparedExternalWorkspace = nil
            comparedExternalReportId = nil
            comparedExternalMessage = "对比股票报告读取失败；未显示旧报告。"
        }
    }
    @MainActor
    func loadTwoLayerReports(preservingRevisionOperation operationId: UUID? = nil) async {
#if OWNER_CLIENT
        personalFormalTaskReadConfirmed = false
#endif
        guard let membership = selectedMembership,
              membership.state != .archived else {
            invalidateTwoLayerReport("请选择当前仍在跟踪的研究标的；旧报告状态已清除。")
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        let previousEnvelope = twoLayerReportWorkspace.envelope
        let activeTask = twoLayerReportWorkspace.hasActiveSynthesisTask
            ? twoLayerReportWorkspace.pendingSynthesisTask
            : nil
        let revision = twoLayerReportWorkspace.requests.beginLoad(
            preservingRevisionOperation: operationId
        )
        twoLayerReportWorkspace.clearFailure()
        clearResearchEvidenceQuestion("正在读取当前报告；旧追问回答已清除。")
        if researchReportFormalDecisionBinding != nil
            || submissionState.hasResearchReportSubmission {
            submissionState.discardForSourceDrift()
        }
        if submittedDecision?.researchReportDecision.availability == "preserved" {
            clearSubmittedDecision()
        }
        researchReportFormalDecisionBinding = nil
        researchReportFormalDecisionMessage = nil
        resetResearchReportFormalDecisionDraft()
        clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
        twoLayerReportWorkspace.pendingWriteId = nil
        if activeTask == nil {
            twoLayerReportWorkspace.pendingSynthesisTask = nil
            twoLayerReportWorkspace.absorptionReservation.clear()
            twoLayerReportWorkspace.cancellationReservation.clear()
        }
        pendingTodayReportConfirmationReservation = nil
        defer { twoLayerReportWorkspace.requests.finishLoad(revision) }
        do {
            let envelope = try await client.fetchFrozenResearchEvidence(
                membership: membership
            )
            guard twoLayerReportWorkspace.requests.acceptsLoad(revision) else { return }
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.state == membership.state,
                  parsedSymbol?.canonical == membership.symbol else {
                invalidateTwoLayerReport("股票、membership 或授权已经变化；旧报告状态已清除。")
                return
            }
            twoLayerReportWorkspace.envelope = envelope
            twoLayerReportWorkspace.bindingIdentity = TwoLayerReportBindingIdentity(
                membership: membership,
                pack: envelope.data?.latestPack
            )
            twoLayerReportWorkspace.message =
                "已读取 \(envelope.data?.reports.count ?? 0) 个报告版本和 \(envelope.data?.decisions.count ?? 0) 条历史确认记录。"
            viewModel.researchEvidenceQuestionMessage = currentResearchEvidenceQuestionReport == nil
                ? "当前没有可追问的报告。"
                : "当前报告已加载，可以输入问题。"
            if let pack = envelope.data?.latestPack,
               let request = pack.deterministicTwoLayerRequest(
                idempotencyKey: "current-task-read"
               ) {
                do {
                    let task = try await client.fetchCurrentDeepResearchTask(
                        membership: membership,
                        requestBody: request
                    )
                    guard twoLayerReportWorkspace.requests.acceptsLoad(revision),
                          dailyClientAuthorizationIsCurrent(authorizationRevision),
                          selectedMembership?.id == membership.id,
                          selectedMembership?.version == membership.version,
                          currentTwoLayerReportBindingIdentity
                            == twoLayerReportWorkspace.bindingIdentity else { return }
#if OWNER_CLIENT
                    personalFormalTaskReadConfirmed = true
#endif
                    if let task {
#if OWNER_CLIENT
                        clearPersonalFormalMaterialReview()
#endif
                        if activeTask?.id != task.id
                            || activeTask?.requestFingerprint != task.requestFingerprint {
                            twoLayerReportWorkspace.saveReservation.clear()
                            twoLayerReportWorkspace.retryReservation.clear()
                            twoLayerReportWorkspace.absorptionReservation.clear()
                            twoLayerReportWorkspace.cancellationReservation.clear()
                        }
                        twoLayerReportWorkspace.draft = TwoLayerEditableDraft(
                            baseRequest: request,
                            taskIntent: task.intent
                        )
                        twoLayerReportWorkspace.pendingSynthesisTask = task
                        twoLayerReportWorkspace.synthesisTaskLastReadAt = Date()
                        twoLayerReportWorkspace.synthesisTaskAutoRefreshPaused = false
                        if task.status == "failed",
                           deepResearchTaskCanExplicitlyRetry(task) {
                            twoLayerReportWorkspace.fail(
                                .synthesis,
                                message: "已恢复失败任务 #\(task.id) 及同一证据快照。\(deepResearchTaskFailureMessage(task))"
                            )
                        } else if task.status == "ready_to_absorb" {
                            twoLayerReportWorkspace.message =
                                "已恢复任务 #\(task.id) 的综合结果；请明确吸收到报告。"
                        } else if ["pending", "running"].contains(task.status) {
                            twoLayerReportWorkspace.message =
                                "已恢复任务 #\(task.id)；稍后刷新即可，不会重复发起。"
                        } else {
                            twoLayerReportWorkspace.message =
                                "任务 #\(task.id) 已结束；重新开始需要再次明确确认。"
                        }
                    } else if activeTask != nil {
                        twoLayerReportWorkspace.draft = nil
                        twoLayerReportWorkspace.pendingSynthesisTask = nil
                        twoLayerReportWorkspace.saveReservation.clear()
                        twoLayerReportWorkspace.retryReservation.clear()
                        twoLayerReportWorkspace.absorptionReservation.clear()
                        twoLayerReportWorkspace.cancellationReservation.clear()
                    }
                } catch {
                    guard twoLayerReportWorkspace.requests.acceptsLoad(revision),
                          dailyClientAuthorizationIsCurrent(authorizationRevision) else { return }
                    if let activeTask,
                       activeTask.membershipId == membership.id,
                       activeTask.membershipVersion == membership.version,
                       activeTask.evidencePackId == pack.id,
                       activeTask.evidencePackFingerprint == pack.packFingerprint {
                        twoLayerReportWorkspace.pendingSynthesisTask = activeTask
                        twoLayerReportWorkspace.message =
                            "报告已读取；任务状态刷新失败，当前任务身份已保留，可明确重试读取。"
                    } else {
                        twoLayerReportWorkspace.pendingSynthesisTask = nil
                        twoLayerReportWorkspace.message =
                            "报告已读取；当前任务状态暂不可用，未显示旧任务。"
                    }
                }
            } else if activeTask != nil {
                twoLayerReportWorkspace.draft = nil
                twoLayerReportWorkspace.pendingSynthesisTask = nil
                twoLayerReportWorkspace.saveReservation.clear()
                twoLayerReportWorkspace.retryReservation.clear()
                twoLayerReportWorkspace.absorptionReservation.clear()
                twoLayerReportWorkspace.cancellationReservation.clear()
            }
#if OWNER_CLIENT
            if envelope.data != nil && envelope.data?.latestPack == nil {
                personalFormalTaskReadConfirmed = true
            }
#endif
            await loadResearchCompleteness(for: membership)
            await loadCloudAiPolicy(expectedActorId: membership.actorId)
#if OWNER_CLIENT
            if personalFormalMaterialReviewRequired && currentFormalMaterialReviewBinding == nil {
                twoLayerReportWorkspace.draft = nil
                clearPersonalFormalMaterialReview()
                twoLayerReportWorkspace.message = "冻结材料或研究身份已变化；旧问题草稿已清除，请重新准备。"
            }
            if [.checked, .limited].contains(dailyRefreshGate.phase) {
                await reconcilePersonalFormalHandoff()
            }
#endif
        } catch {
            guard twoLayerReportWorkspace.requests.acceptsLoad(revision) else { return }
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.state == membership.state,
                  parsedSymbol?.canonical == membership.symbol else {
                invalidateTwoLayerReport("股票、membership 或授权已经变化；旧报告状态已清除。")
                return
            }
            let message = twoLayerReportErrorMessage(error)
            if let previousEnvelope {
                twoLayerReportWorkspace.preserveReadFailure(
                    previousEnvelope: previousEnvelope,
                    message: "报告读取失败；正在显示同一股票与 membership 的上次有效报告，所有正式操作已锁定。明确重试读取后才会恢复。\n\(message)"
                )
                return
            }
            if let activeTask {
                twoLayerReportWorkspace.fail(
                    .load,
                    message: "报告读取失败；任务 #\(activeTask.id) 及其请求身份已保留，可明确重试。\n\(message)"
                )
                return
            }
            invalidateTwoLayerReport(message)
            twoLayerReportWorkspace.fail(.load, message: message)
        }
    }
#if OWNER_CLIENT
    @MainActor
    func clearPersonalFormalMaterialReview() {
        personalFormalMaterialReviewRequired = false
        personalFormalMaterialReviewed = false
        personalFormalReviewedMaterialBinding = nil
        personalFormalSourceMessage = nil
        personalFormalSources = []
        personalFormalProviderSources = []
        personalFormalMaterialListExpanded = false
    }

    @MainActor
    func discardPersonalFormalHandoff() {
        ownerStore.personalFormalHandoff = nil
        personalFormalMessage = "已放弃这次问题交接；现有草稿或任务未改变。"
    }

    @MainActor
    func reconcilePersonalFormalHandoff(replacingDraft: Bool = false) async {
        guard clientDestination == .tasks,
              let handoff = ownerStore.personalFormalHandoff,
              personalFormalVerificationId == nil,
              [.checked, .limited].contains(dailyRefreshGate.phase) else { return }
        personalFormalVerificationId = handoff.id
        defer { personalFormalVerificationId = nil }
        guard let membership = selectedMembership,
              membership.state != .archived,
              membership.id == handoff.membershipId,
              membership.version == handoff.membershipVersion,
              membership.symbol == handoff.symbol,
              parsedSymbol?.canonical == handoff.symbol,
              handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope() else {
            ownerStore.personalFormalHandoff = nil
            personalFormalMessage = "公司、研究成员或连接已变化；这次问题交接已清除，请重新进入。"
            return
        }
        guard personalFormalTaskReadConfirmed, !twoLayerReportWorkspace.isStaleRead else {
            personalFormalMessage = "正式报告或任务尚未完成当前读取；问题已保留，请刷新核对。"
            return
        }
        let readback = await ownerStore.verifyPersonalFormalHandoff(handoff)
        guard ownerStore.personalFormalHandoff == handoff else { return }
        guard let currentMembership = selectedMembership,
              currentMembership.id == handoff.membershipId,
              currentMembership.version == handoff.membershipVersion,
              currentMembership.symbol == handoff.symbol,
              parsedSymbol?.canonical == handoff.symbol,
              handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope(),
              personalFormalTaskReadConfirmed,
              [.checked, .limited].contains(dailyRefreshGate.phase) else {
            ownerStore.personalFormalHandoff = nil
            personalFormalMessage = "公司、研究成员或连接在读取期间变化；问题交接已清除。"
            return
        }
        switch readback {
        case .unavailable:
            personalFormalMessage = "个人资料暂无法重新核验；问题已保留，刷新后再准备。"
            return
        case .drifted:
            ownerStore.personalFormalHandoff = nil
            personalFormalMessage = "个人资料来源已变化；这次交接已清除，请重新核对问题和原文。"
            return
        case .current:
            break
        }
        guard twoLayerReportWorkspace.pendingSynthesisTask == nil else {
            personalFormalMessage = "已有研究任务；本次问题未覆盖它。请先查看或处理现有任务。"
            return
        }
        guard handoff.providerSources.allSatisfy({ $0.materials.count == 1 }) else {
            personalFormalMessage = "当前问题已保留。所选 OpenD 期间尚无唯一匹配材料，请到下方资料区选择捕获及期间，明确保存为第三方未核实材料；不会自动选入其他材料。"
            return
        }
        guard let pack = twoLayerReportWorkspace.envelope?.data?.latestPack,
              pack.currentness.status == "current",
              pack.membershipId == membership.id,
              pack.membershipVersion == membership.version,
              pack.symbol == membership.symbol else {
            personalFormalMessage = "当前问题已保留。请在资料准备区核对并明确冻结材料，再返回准备研究。"
            return
        }
        let providerMatches = handoff.providerSources.map { personalFormalMatchingProviderMaterials($0, pack: pack) }
        guard providerMatches.allSatisfy({ $0.count == 1 }) else {
            personalFormalMessage = "当前问题已保留。所选 OpenD 材料尚未进入当前冻结包；请明确使用已有材料准备有限研究，再返回核对发送范围。"
            return
        }
        if twoLayerReportWorkspace.draft != nil && !replacingDraft {
            personalFormalMessage = "已有未提交草稿；本次问题已保留。你可以继续原草稿或明确替换。"
            return
        }
        if replacingDraft { twoLayerReportWorkspace.draft = nil }
        createTwoLayerDraft(researchQuestion: handoff.question)
        guard twoLayerReportWorkspace.draft?.taskIntent?.researchQuestion == handoff.question else {
            personalFormalMessage = "当前证据未能建立可编辑草稿；问题已保留，请刷新核对。"
            return
        }
        let matches = handoff.sources.map { personalFormalMatchingMaterials($0, pack: pack) }
        let exactIds = Array(Set((matches + providerMatches).compactMap { $0.count == 1 ? $0[0].id : nil }))
            .sorted { (Int($0) ?? 0) < (Int($1) ?? 0) }
        if pack.materialSelectionMode == "explicit",
           exactIds != pack.items.map(\.id).sorted(by: { (Int($0) ?? 0) < (Int($1) ?? 0) }) {
            personalFormalMessage = "当前问题来源与冻结材料不一致；请先按所需来源重新准备有限研究。"
            twoLayerReportWorkspace.draft = nil
            return
        }
        twoLayerReportWorkspace.draft?.taskIntent?.selectedMaterialIds = exactIds
        if !exactIds.isEmpty, matches.allSatisfy({ $0.count == 1 }) {
            personalFormalSourceMessage = "已按原文身份唯一匹配 \(exactIds.count) 项正式材料；请核对发送范围。"
        } else {
            personalFormalSourceMessage = "原始来源有 \(handoff.sources.count) 项，其中 \(matches.filter { $0.count == 1 }.count) 项唯一匹配；其余尚未选入发送范围，请逐项选择并确认。"
        }
        personalFormalMaterialReviewRequired = true
        personalFormalMaterialReviewed = false
        personalFormalMaterialListExpanded = true
        personalFormalSources = handoff.sources
        personalFormalProviderSources = handoff.providerSources
        personalFormalMessage = "已带入当前问题，尚未创建任务或发送给 AI。"
        ownerStore.personalFormalHandoff = nil
    }

    func personalFormalMatchingMaterials(_ hint: PersonalFormalSourceHint,
                                         pack: FrozenResearchEvidencePack) -> [ResearchMaterialData] {
        pack.items.filter { material in
            guard material.symbol == pack.symbol, material.sourceUrl == hint.url else { return false }
            if hint.sourceType == "official_pdf", let page = hint.pageNumber {
                return material.citation?.pageNumber == page
                    && material.citation?.pageTextSha256 == hint.pageTextSha256
            }
            guard hint.sourceType == "official_body", let snapshot = hint.snapshotCitation,
                  snapshot.isValid, material.sourceType == "issuer_public_html",
                  let citation = material.snapshotCitation,
                  let original = material.snapshotOriginal else { return false }
            return citation.snapshotId == snapshot.snapshotId
                && original.rawSha256 == snapshot.rawSha256
                && citation.textSha256 == snapshot.textSha256
                && citation.startUtf16 == snapshot.startUtf16
                && citation.endUtf16 == snapshot.endUtf16
                && citation.excerptSha256 == snapshot.excerptSha256
        }
    }
    func personalFormalMatchingProviderMaterials(_ hint: PersonalFormalProviderSourceHint,
                                                pack: FrozenResearchEvidencePack) -> [ResearchMaterialData] {
        guard hint.materials.count == 1 else { return [] }
        let identity = hint.materials[0]
        return pack.items.filter { material in
            material.id == identity.id && material.revision == identity.revision
                && material.contentFingerprint == identity.contentFingerprint && material.sourceVersion == identity.sourceVersion
                && material.sourceType == "futu_opend_financial_statement_provider"
                && material.claimType == "third_party_statement" && material.verificationStatus == "unverified"
                && material.revisionState == "current" && material.freshness == "fresh"
                && material.futuFinancialSource?.captureId == hint.captureId
                && material.futuFinancialSource?.sourceFingerprint == hint.sourceFingerprint
                && material.futuFinancialSource?.periodEnd == hint.periodEnd
                && material.futuFinancialSource?.financialType == hint.financialType
        }
    }
#endif
    @MainActor
    func createTwoLayerDraft(researchQuestion: String? = nil) {
#if OWNER_CLIENT
        clearPersonalFormalMaterialReview()
        personalFormalMessage = nil
#endif
        guard !twoLayerReportWorkspace.isStaleRead else {
            twoLayerReportWorkspace.message = "上次有效报告已标记为 stale；请先明确重试读取，再准备新的深度研究。"
            return
        }
        guard !twoLayerReportWorkspace.hasActiveSynthesisTask else {
            twoLayerReportWorkspace.message = "当前任务仍在运行或等待吸收；请先刷新、取消或处理该任务。"
            return
        }
        guard let membership = selectedMembership,
              membership.state != .archived,
              let pack = currentTwoLayerReportPack,
              pack.membershipId == membership.id,
              pack.membershipVersion == membership.version,
              pack.currentness.status == "current",
              let request = pack.deterministicTwoLayerRequest(
                idempotencyKey: "not-reserved-until-owner-save"
              ) else {
            invalidateTwoLayerReport("当前证据版本还不能生成报告；旧草稿已清除。")
            return
        }
        let priorReport = latestEligiblePriorReport
        var taskIntent = DeepResearchTaskIntent(
            pack: pack,
            priorReport: priorReport,
            priorDecision: twoLayerReportWorkspace.envelope?.data?.userDecision,
            monitorRules: envelope.data?.profile.monitorRules ?? []
        )
        if let researchQuestion = researchQuestion?.trimmingCharacters(in: .whitespacesAndNewlines),
           !researchQuestion.isEmpty {
            taskIntent.researchQuestion = researchQuestion
        }
        twoLayerReportWorkspace.draft = TwoLayerEditableDraft(
            baseRequest: request,
            taskIntent: taskIntent
        )
        twoLayerReportWorkspace.saveReservation.clear()
        twoLayerReportWorkspace.retryReservation.clear()
        twoLayerReportWorkspace.absorptionReservation.clear()
        twoLayerReportWorkspace.decisionReservation.clear()
        twoLayerReportWorkspace.pendingSynthesisTask = nil
        twoLayerReportWorkspace.pendingWriteId = nil
        twoLayerReportWorkspace.clearFailure()
        twoLayerReportWorkspace.bindingIdentity = TwoLayerReportBindingIdentity(
            membership: membership,
            pack: pack
        )
        twoLayerReportWorkspace.message =
            "已准备基于当前冻结证据发起深度研究；AI 只会收到这一个版本。"
        if cloudAiPolicy == nil { Task { await loadCloudAiPolicy(expectedActorId: membership.actorId) } }
    }
    @MainActor
    func loadCloudAiPolicy(expectedActorId: String? = nil) async {
        guard !isLoadingCloudAiPolicy,
              let actorId = expectedActorId ?? selectedMembership?.actorId else { return }
        let authorizationRevision = viewModel.authorizationRevision
        isLoadingCloudAiPolicy = true
        defer { isLoadingCloudAiPolicy = false }
        do {
            let envelope = try await client.fetchCloudAiPolicy(expectedActorId: actorId)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.actorId == actorId else { return }
            cloudAiPolicy = envelope; cloudAiNoBackupConfirmed = false
            cloudAiPolicyMessage = envelope.message
        } catch {
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.actorId == actorId else { return }
            cloudAiPolicy = nil; cloudAiNoBackupConfirmed = false
            cloudAiPolicyMessage = "Cloud AI 策略读取失败；新调用保持禁用。"
        }
    }
    @MainActor
    func decideCloudAiPolicy(_ action: CloudAiPolicyAction) async {
        guard let actorId = selectedMembership?.actorId else { return }
        guard action != .enable || cloudAiNoBackupConfirmed && cloudAiPolicy?.status == "available" && cloudAiPolicy?.requestedActorId == actorId else {
            cloudAiPolicyMessage = "请先 fresh-read 当前 Owner 策略，再明确选择初版不使用备用 AI 提供方。"
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        let key = cloudAiPolicyReservation.reserve(
            for: "\(action.rawValue)|\(cloudAiProviderPolicyVersion)|none|\(actorId)",
            prefix: "ios-cloud-ai-policy"
        )
        isLoadingCloudAiPolicy = true
        cloudAiPolicyMessage = action == .enable ? "正在确认并启用 Cloud AI…" : action == .disable ? "正在停用新的 Cloud AI 调用…" : "正在记录提供方删除请求…"
        defer { isLoadingCloudAiPolicy = false }
        do {
            let envelope = try await client.decideCloudAiPolicyAndReadBack(
                action: action,
                idempotencyKey: key,
                expectedActorId: actorId
            )
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.actorId == actorId else { return }
            cloudAiPolicy = envelope
            cloudAiPolicyReservation.clear(); cloudAiNoBackupConfirmed = false
            cloudAiPolicyMessage = envelope.message
            if !envelope.isEnabled {
                twoLayerReportWorkspace.draft?.taskIntent?.confirmProviderAuthorization(false)
            }
        } catch {
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.actorId == actorId else { return }
            cloudAiPolicyMessage = "Cloud AI 策略写入尚未精确确认；同一请求已保留，可明确重试。"
        }
    }
    @MainActor
    func refreshDeepResearchTaskStatus(automatic: Bool = false) async {
        guard !twoLayerReportWorkspace.isBusy,
              let membership = selectedMembership,
              let draft = twoLayerReportWorkspace.draft,
              let task = twoLayerReportWorkspace.pendingSynthesisTask,
              ["pending", "running"].contains(task.status),
              task.intent == draft.taskIntent,
              currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else {
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        let taskId = task.id
        let requestFingerprint = task.requestFingerprint
        twoLayerReportWorkspace.isRefreshingSynthesisTask = true
        defer { twoLayerReportWorkspace.isRefreshingSynthesisTask = false }
        do {
            let refreshed = try await client.fetchDeepResearchTask(
                membership: membership,
                taskId: taskId,
                requestBody: draft.request(idempotencyKey: "read-only-task-refresh"),
                expectedIntent: task.intent,
                expectedRequestFingerprint: requestFingerprint
            )
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  twoLayerReportWorkspace.pendingSynthesisTask?.id == taskId,
                  twoLayerReportWorkspace.pendingSynthesisTask?.requestFingerprint == requestFingerprint,
                  currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else { return }
            twoLayerReportWorkspace.pendingSynthesisTask = refreshed
            twoLayerReportWorkspace.synthesisTaskLastReadAt = Date()
            twoLayerReportWorkspace.synthesisTaskAutoRefreshPaused = false
            if !automatic {
                twoLayerReportWorkspace.synthesisTaskAutoRefreshRevision &+= 1
            }
            if refreshed.status == "ready_to_absorb" {
                twoLayerReportWorkspace.message = "任务 #\(taskId) 综合已完成；请明确吸收到报告。"
            } else if refreshed.status == "failed" {
                twoLayerReportWorkspace.fail(
                    .synthesis,
                    message: "任务 #\(taskId) 未完成。\(deepResearchTaskFailureMessage(refreshed))"
                )
            } else if refreshed.status == "canceled" {
                twoLayerReportWorkspace.message = "任务 #\(taskId) 已结束；没有生成报告。"
            } else if refreshed.status == "succeeded" {
                twoLayerReportWorkspace.message = "任务 #\(taskId) 已在另一客户端吸收到报告；请读取当前报告核对。"
            } else {
                twoLayerReportWorkspace.message = automatic
                    ? "已自动读取任务 #\(taskId) 的最新状态；不会重复发起。"
                    : "已读取任务 #\(taskId) 的最新状态；不会重复发起。"
            }
        } catch {
            guard dailyClientAuthorizationIsCurrent(authorizationRevision) else { return }
            if twoLayerReportFailureRequiresClear(error) {
                invalidateTwoLayerReport(twoLayerReportErrorMessage(error))
                return
            }
            twoLayerReportWorkspace.synthesisTaskAutoRefreshPaused = true
            twoLayerReportWorkspace.message =
                "任务状态读取失败；保留任务 #\(taskId) 的上次有效状态和更新时间，可手动重试。"
        }
    }
    @MainActor
    func refreshDeepResearchTaskWhileVisible() async {
        guard deepResearchForegroundRefreshIdentity != "inactive" else { return }
        twoLayerReportWorkspace.synthesisTaskAutoRefreshPaused = false
        for _ in 0..<24 {
            do {
                try await Task.sleep(nanoseconds: 5_000_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled,
                  scenePhase == .active,
                  selectedTab == .research,
                  let task = twoLayerReportWorkspace.pendingSynthesisTask,
                  ["pending", "running"].contains(task.status) else { return }
            await refreshDeepResearchTaskStatus(automatic: true)
            guard !twoLayerReportWorkspace.synthesisTaskAutoRefreshPaused else { return }
        }
        guard let task = twoLayerReportWorkspace.pendingSynthesisTask,
              ["pending", "running"].contains(task.status) else { return }
        twoLayerReportWorkspace.synthesisTaskAutoRefreshPaused = true
        twoLayerReportWorkspace.message =
            "前台自动刷新已暂停；任务 #\(task.id) 仍已保存，可点击刷新继续读取。"
    }
    @MainActor
    func deferDeepResearchTask() {
        guard let task = twoLayerReportWorkspace.pendingSynthesisTask,
              ["pending", "running", "ready_to_absorb"].contains(task.status) else { return }
        twoLayerReportWorkspace.message = "任务 #\(task.id) 已保留；稍后回来会按同一任务身份刷新，不会重复创建。"
    }
    @MainActor
    func cancelDeepResearchTask(reason: String) async {
        guard let membership = selectedMembership,
              let draft = twoLayerReportWorkspace.draft,
              let task = twoLayerReportWorkspace.pendingSynthesisTask,
              ["pending", "running", "ready_to_absorb"].contains(task.status),
              (reason == "user_canceled" && ["pending", "running"].contains(task.status)
                || reason == "user_rejected" && task.status == "ready_to_absorb"),
              currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else {
            invalidateTwoLayerReport("任务身份已经变化；没有取消旧任务。")
            return
        }
        let key = twoLayerReportWorkspace.cancellationReservation.reserve(
            for: "\(task.id)|\(task.requestFingerprint)|\(reason)",
            prefix: "ios-deep-research-cancel"
        )
        let revision = twoLayerReportWorkspace.requests.beginSave()
        twoLayerReportWorkspace.clearFailure()
        defer { twoLayerReportWorkspace.requests.finishSave(revision) }
        do {
            let canceled = try await client.cancelDeepResearchTaskAndReadBack(
                membership: membership,
                requestBody: draft.request(idempotencyKey: twoLayerReportWorkspace.saveReservation.key ?? "unused-cancel-readback"),
                task: task,
                reason: reason,
                idempotencyKey: key
            )
            guard twoLayerReportWorkspace.requests.acceptsSave(revision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else { return }
            twoLayerReportWorkspace.pendingSynthesisTask = canceled
            twoLayerReportWorkspace.draft = nil
            twoLayerReportWorkspace.saveReservation.clear()
            twoLayerReportWorkspace.retryReservation.clear()
            twoLayerReportWorkspace.absorptionReservation.clear()
            twoLayerReportWorkspace.cancellationReservation.clear()
            twoLayerReportWorkspace.message = reason == "user_rejected"
                ? "任务 #\(task.id) 的综合结果未被采用；没有生成报告。"
                : "任务 #\(task.id) 已取消；没有生成报告。"
        } catch {
            guard twoLayerReportWorkspace.requests.acceptsSave(revision) else { return }
            if twoLayerReportFailureRequiresClear(error) {
                invalidateTwoLayerReport(twoLayerReportErrorMessage(error))
            } else {
                twoLayerReportWorkspace.message = "取消结果尚未精确确认；原任务和同一取消请求已保留，可明确重试。"
            }
        }
    }
    @MainActor
    func deleteTwoLayerReport(_ report: TwoLayerReportData) async {
        guard let membership = selectedMembership,
              twoLayerReportWorkspace.envelope?.data?.reports.contains(report) == true,
              currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else {
            invalidateTwoLayerReport("报告身份已经变化；没有删除旧报告。")
            return
        }
        if twoLayerReportWorkspace.pendingDeletionReportId != report.id {
            twoLayerReportWorkspace.pendingDeletionReportId = report.id
            twoLayerReportWorkspace.message = "再次点击“删除报告正文”确认；正文会移出界面和 AI 上下文，只保留无正文删除凭证。旧网盘历史版本仍可能含原内容。"
            return
        }
        let key = twoLayerReportWorkspace.deletionReservation.reserve(
            for: "\(membership.id)|\(membership.version)|\(report.id)|\(report.reportFingerprint)",
            prefix: "ios-deep-research-report-delete"
        )
        let authorizationRevision = viewModel.authorizationRevision
        let revision = twoLayerReportWorkspace.requests.beginDecision()
        defer { twoLayerReportWorkspace.requests.finishDecision(revision) }
        do {
            let result = try await client.deleteTwoLayerReportAndReadBack(
                membership: membership,
                report: report,
                idempotencyKey: key
            )
            guard twoLayerReportWorkspace.requests.acceptsDecision(revision),
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  result.workspace.data?.target.membershipId == membership.id else { return }
            do {
                try clearResearchTemporaryConversation(
                    membership: membership,
                    report: report,
                    defaults: viewModel.localDefaults
                )
            } catch {
                clearAllResearchTemporaryConversations(defaults: viewModel.localDefaults)
            }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            invalidateTwoLayerReport("报告正文已删除；旧报告相关展示已清除。")
            twoLayerReportWorkspace.envelope = result.workspace
            twoLayerReportWorkspace.bindingIdentity = currentTwoLayerReportBindingIdentity
            twoLayerReportWorkspace.message = "删除凭证：report #\(result.deletion.reportId) v\(result.deletion.reportVersion) · deletedAt=\(result.deletion.deletedAt) · SHA-256=\(result.deletion.reportFingerprint)。旧网盘历史版本仍可能含原内容。"
            scheduleResearchArchiveAutomaticBackup(
                .deletion("report-\(result.deletion.reportId)-\(result.deletion.reportFingerprint)"),
                membership: membership
            )
        } catch {
            guard twoLayerReportWorkspace.requests.acceptsDecision(revision) else { return }
            if twoLayerReportFailureRequiresClear(error) {
                invalidateTwoLayerReport(twoLayerReportErrorMessage(error))
            } else {
                twoLayerReportWorkspace.pendingDeletionReportId = report.id
                twoLayerReportWorkspace.message = "删除结果尚未精确确认；同一请求已保留，可再次确认重试。"
            }
        }
    }
    @MainActor
    func saveTwoLayerDraft() async {
        guard selectedValuationSourceIncluded else {
            twoLayerReportWorkspace.message = "本次未选齐 PE 或 FCFF 情景引用的原件材料；请勾选对应材料或重新准备估值与研究包。尚未创建任务。"
            return
        }
#if OWNER_CLIENT
        guard formalMaterialReviewSatisfied else {
            twoLayerReportWorkspace.message = "请先核对本次正式材料范围；尚未创建任务。"
            return
        }
#endif
        guard let membership = selectedMembership,
              membership.state != .archived,
              let draft = twoLayerReportWorkspace.draft,
              let taskIntent = draft.taskIntent,
              taskIntent.validates(binding: draft.baseRequest.evidencePackBinding),
              (currentTwoLayerReportPack?.researchMode != "limited" || !taskIntent.selectedMaterialIds.isEmpty),
              currentTwoLayerReportBindingIdentity
                == twoLayerReportWorkspace.bindingIdentity else {
            invalidateTwoLayerReport("深度研究使用的证据已经变化；请重新准备。")
            return
        }
        guard selectedPriorReportIsEligible else {
            twoLayerReportWorkspace.draft?.taskIntent?.confirmProviderAuthorization(false)
            twoLayerReportWorkspace.message = "所选前报告已变化或不符合当前条件；请清除前版选择并重新确认发送范围。尚未创建任务。"
            return
        }
        if let selection = taskIntent.selectedResearchContext {
            do {
                let fresh = try await client.fetchResearchContext(membership: membership)
                guard selectedMembership?.id == membership.id,
                      selectedMembership?.version == membership.version,
                      fresh.status == .available,
                      fresh.requestedActorId == membership.actorId,
                      fresh.contentHash == selection.contentHash,
                      let context = fresh.data,
                      context.currentness.status == "current",
                      context.id == selection.contextId,
                      context.membershipId == membership.id,
                      context.membershipVersion == membership.version,
                      context.selectedSymbol == membership.symbol,
                      context.cutoffAt <= taskIntent.cutoffAt,
                      selection.selectedFactIds.allSatisfy({ id in context.selectedFacts.contains(where: { $0.id == id }) }),
                      (selection.peerFactIds ?? []).allSatisfy({ id in
                          fresh.peerFactSourceIssues?.contains(where: { $0.factId == id }) != true
                              && context.peerFacts.contains(where: { fact in
                              fact.id == id && context.peers.contains(where: {
                                  peer in peer.symbol == fact.symbol && peer.status == "included"
                                      && fresh.peerSourceIssues?.contains(where: { $0.peerId == peer.id }) != true
                              })
                          })
                      }),
                      selection.peerIds.allSatisfy({ id in context.peers.contains(where: { $0.id == id }) }) else {
                    twoLayerReportWorkspace.draft?.taskIntent?.confirmProviderAuthorization(false)
                    twoLayerReportWorkspace.message = "本次勾选的档案版本或条目已变化；请重新读取并确认发送范围。"
                    return
                }
                researchContextWorkspace.envelope = fresh
            } catch {
                twoLayerReportWorkspace.message = "当前档案无法重新核对；没有创建研究任务。"
                return
            }
        }
        guard cloudAiPolicy?.requestedActorId == membership.actorId,
              cloudAiPolicy?.isEnabled == true else {
            twoLayerReportWorkspace.message = "Cloud AI 尚未按当前策略启用；没有创建或继续任务。"
            return
        }
        if pendingTodayResearchReportSaveReservation == nil {
            let authorizationRevision = viewModel.authorizationRevision
            let freshToday = await client.fetchTodayResearch(membershipId: membership.id)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  freshToday.requestedActorId == membership.actorId else { return }
            todayResearch = freshToday
        }
        if pendingTodayResearchReportSaveReservation == nil,
           todayResearch.status == .available,
           todayResearch.membershipId == membership.id,
           todayResearch.membershipVersion == membership.version,
           todayResearch.requestedSymbol == membership.symbol,
           let item = todayResearch.items.first(where: {
               $0.trackingState == .needsResearch
                   && $0.bindings.membershipId == membership.id
                   && $0.bindings.membershipVersion == membership.version
                   && $0.symbol == membership.symbol
           }),
           let pack = item.bindings.evidencePackRef,
           pack.id == draft.baseRequest.evidencePackId,
           pack.version == draft.baseRequest.evidencePackBinding.version,
           pack.packFingerprint == draft.baseRequest.evidencePackBinding.fingerprint {
            let source = TodayResearchSourceNavigationTarget(item: item)
            pendingTodayResearchReportSaveReservation = TodayResearchReportSaveReservation(
                itemId: item.id,
                membershipId: membership.id,
                membershipVersion: membership.version,
                symbol: membership.symbol,
                actorId: membership.actorId,
                sourceLane: source.lane,
                sourceId: source.id,
                sourceVersion: source.version,
                sourceType: source.sourceType,
                sourceFingerprint: source.sourceFingerprint,
                evidencePackId: pack.id,
                evidencePackVersion: pack.version,
                evidencePackFingerprint: pack.packFingerprint,
                authorizationRevision: viewModel.authorizationRevision
            )
        }
        if let todayReservation = pendingTodayResearchReportSaveReservation,
           (todayResearchSaveReservationMatchesCurrentToday(todayReservation, membership: membership) == false
            || todayReservation.evidencePackId != draft.baseRequest.evidencePackId
            || todayReservation.evidencePackVersion != draft.baseRequest.evidencePackBinding.version
            || todayReservation.evidencePackFingerprint != draft.baseRequest.evidencePackBinding.fingerprint) {
            pendingTodayResearchReportSaveReservation = nil
            invalidateTwoLayerReport("Today 打开的研究事项已经变化；本次没有写入报告。")
            return
        }
        let fingerprint = String(describing: (draft.baseRequest.evidencePackBinding, taskIntent))
        let sourceReservationAtSave = pendingResearchReportRevisionSourceReservation
        let sourceAtSave = sourceReservationAtSave?.source
        let todayResearchReservationAtSave = pendingTodayResearchReportSaveReservation
        let pendingTask = twoLayerReportWorkspace.pendingSynthesisTask
        if let pendingTask, pendingTask.intent != taskIntent {
            twoLayerReportWorkspace.message = "运行中的任务已锁定原问题与证据范围；请先取消该任务，再明确开始新任务。"
            return
        }
        let key = twoLayerReportWorkspace.saveReservation.reserve(
            for: fingerprint,
            prefix: "ios-two-layer-report"
        )
        let requestBody = draft.request(idempotencyKey: key)
        let revision = twoLayerReportWorkspace.requests.beginSave()
        twoLayerReportWorkspace.clearFailure()
        let previousEnvelope = twoLayerReportWorkspace.envelope
        twoLayerReportWorkspace.envelope = nil
        twoLayerReportWorkspace.pendingWriteId = nil
        defer { twoLayerReportWorkspace.requests.finishSave(revision) }
        do {
            let result: (
                workspace: FrozenResearchEvidenceWorkspace,
                report: TwoLayerReportData
            )
            if var task = pendingTask {
                if task.status == "failed" {
                    guard deepResearchTaskCanExplicitlyRetry(task) else {
                        throw FrozenResearchEvidenceClientError.taskFailed
                    }
                    let retryKey = twoLayerReportWorkspace.retryReservation.reserve(
                        for: "\(task.id)|\(task.requestFingerprint)|\(task.snapshotBinding?.snapshotId ?? "missing")",
                        prefix: "ios-deep-research-retry"
                    )
                    task = try await client.retryDeepResearchTaskAndPoll(
                        membership: membership,
                        requestBody: requestBody,
                        task: task,
                        idempotencyKey: retryKey
                    )
                }
                if ["pending", "running"].contains(task.status) {
                    task = try await client.fetchDeepResearchTask(
                        membership: membership,
                        taskId: task.id,
                        requestBody: requestBody,
                        expectedIntent: task.intent,
                        expectedRequestFingerprint: task.requestFingerprint
                    )
                    if ["pending", "running", "ready_to_absorb"].contains(task.status) {
                        guard twoLayerReportWorkspace.requests.acceptsSave(revision) else { return }
                        twoLayerReportWorkspace.envelope = previousEnvelope
                        twoLayerReportWorkspace.pendingSynthesisTask = task
                        twoLayerReportWorkspace.message = task.status == "ready_to_absorb"
                            ? "任务 #\(task.id) 已完成；请明确吸收到报告。"
                            : "任务 #\(task.id) 仍在运行；稍后刷新即可，不会重复发起。"
                        return
                    }
                }
                if task.status == "failed", deepResearchTaskCanExplicitlyRetry(task) {
                    guard twoLayerReportWorkspace.requests.acceptsSave(revision) else { return }
                    twoLayerReportWorkspace.retryReservation.clear()
                    twoLayerReportWorkspace.envelope = previousEnvelope
                    twoLayerReportWorkspace.pendingSynthesisTask = task
                    twoLayerReportWorkspace.fail(
                        .synthesis,
                        message: "任务 #\(task.id) 未完成。\(deepResearchTaskFailureMessage(task))"
                    )
                    return
                }
                if task.status == "failed" {
                    throw FrozenResearchEvidenceClientError.taskFailed
                }
                if task.status == "ready_to_absorb" {
                    let absorptionKey = twoLayerReportWorkspace.absorptionReservation.reserve(
                        for: "\(task.id)|\(task.requestFingerprint)|\(task.snapshotBinding?.snapshotId ?? "pending")",
                        prefix: "ios-deep-research-absorb"
                    )
                    result = try await client.absorbDeepResearchTaskAndReadBack(
                        membership: membership,
                        requestBody: requestBody,
                        task: task,
                        idempotencyKey: absorptionKey
                    )
                } else {
                    guard task.status == "succeeded" else {
                        throw FrozenResearchEvidenceClientError.invalidResponse
                    }
                    result = try await client.readTwoLayerReportBack(
                        membership: membership,
                        requestBody: requestBody,
                        task: task
                    )
                }
            } else {
                let task = try await client.createDeepResearchTaskAndPoll(
                    membership: membership,
                    requestBody: requestBody,
                    intent: taskIntent
                ) { posted in
                    guard twoLayerReportWorkspace.requests.acceptsSave(revision),
                          selectedMembership?.id == membership.id,
                          selectedMembership?.version == membership.version,
                          parsedSymbol?.canonical == membership.symbol,
                          currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else { return }
                    twoLayerReportWorkspace.envelope = previousEnvelope
                    twoLayerReportWorkspace.pendingSynthesisTask = posted
                }
                if task.status == "failed", deepResearchTaskCanExplicitlyRetry(task) {
                    guard twoLayerReportWorkspace.requests.acceptsSave(revision),
                          selectedMembership?.id == membership.id,
                          selectedMembership?.version == membership.version,
                          parsedSymbol?.canonical == membership.symbol else { return }
                    twoLayerReportWorkspace.retryReservation.clear()
                    twoLayerReportWorkspace.envelope = previousEnvelope
                    twoLayerReportWorkspace.pendingSynthesisTask = task
                    twoLayerReportWorkspace.fail(
                        .synthesis,
                        message: "任务 #\(task.id) 未完成。\(deepResearchTaskFailureMessage(task))"
                    )
                    return
                }
                if task.status == "failed" {
                    throw FrozenResearchEvidenceClientError.taskFailed
                }
                if ["pending", "running", "ready_to_absorb"].contains(task.status) {
                    guard twoLayerReportWorkspace.requests.acceptsSave(revision),
                          selectedMembership?.id == membership.id,
                          selectedMembership?.version == membership.version,
                          parsedSymbol?.canonical == membership.symbol else { return }
                    twoLayerReportWorkspace.envelope = previousEnvelope
                    twoLayerReportWorkspace.pendingSynthesisTask = task
                    twoLayerReportWorkspace.message = task.status == "ready_to_absorb"
                        ? "任务 #\(task.id) 综合已完成并绑定当前快照；请明确吸收到报告。"
                        : "任务 #\(task.id) 已开始；可稍后刷新状态，当前不会重复发起。"
                    return
                }
                guard task.status == "succeeded" else {
                    throw FrozenResearchEvidenceClientError.invalidResponse
                }
                result = try await client.readTwoLayerReportBack(
                    membership: membership,
                    requestBody: requestBody,
                    task: task
                )
            }
            guard twoLayerReportWorkspace.requests.acceptsSave(revision) else {
                twoLayerReportWorkspace.message = "报告已读回，但当前操作已被较新的读取替代；未切换 Today。"
                return
            }
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else {
                invalidateTwoLayerReport("报告已读回，但股票或 membership 已变化；未展示旧报告。")
                return
            }
            guard pendingResearchReportRevisionSourceReservation == sourceReservationAtSave else {
                twoLayerReportWorkspace.message = "报告已读回，但修订来源已变化；未显示旧修订成功。"
                return
            }
            guard pendingTodayResearchReportSaveReservation == todayResearchReservationAtSave else {
                twoLayerReportWorkspace.message = "报告已读回，但 Today 来源已变化；请返回 Today 重新读取。"
                return
            }
            guard result.report.payload.evidencePackBinding == requestBody.evidencePackBinding else {
                invalidateTwoLayerReport("报告读回的证据包与本次任务不一致；未展示成功。")
                return
            }
            twoLayerReportWorkspace.envelope = result.workspace
            twoLayerReportWorkspace.draft = nil
            twoLayerReportWorkspace.pendingSynthesisTask = nil
            twoLayerReportWorkspace.pendingWriteId = result.report.id
            twoLayerReportWorkspace.saveReservation.clear()
            twoLayerReportWorkspace.retryReservation.clear()
            twoLayerReportWorkspace.absorptionReservation.clear()
            if let todayReservation = todayResearchReservationAtSave {
                pendingTodayResearchReportSaveReservation = nil
                guard result.report.isFormalizable,
                      todayReservation.evidencePackId == requestBody.evidencePackId,
                      todayReservation.evidencePackVersion == requestBody.evidencePackBinding.version,
                      todayReservation.evidencePackFingerprint == requestBody.evidencePackBinding.fingerprint,
                      todayReservation.membershipId == membership.id,
                      todayReservation.membershipVersion == membership.version,
                      todayReservation.symbol == membership.symbol,
                      todayReservation.authorizationRevision == viewModel.authorizationRevision else {
                    twoLayerReportWorkspace.message = result.report.isFormalizable
                        ? "报告已保存，但 Today 原事项已经变化；请返回 Today 重新读取。"
                        : "报告已保存，但内容仍不完整；Today 会继续提示补充研究。"
                    return
                }
                let freshToday = await client.fetchTodayResearch(membershipId: membership.id)
                guard twoLayerReportWorkspace.requests.acceptsSave(revision),
                      selectedMembership?.id == membership.id,
                      selectedMembership?.version == membership.version,
                      parsedSymbol?.canonical == membership.symbol,
                      viewModel.authorizationRevision == todayReservation.authorizationRevision,
                      freshToday.requestedActorId == membership.actorId,
                      todayResearchReportSaveSuccess(
                          freshToday,
                          reservation: todayReservation,
                          report: result.report
                      ) else {
                    twoLayerReportWorkspace.message = "报告已保存，但还未确认 Today 已出现对应下一步；请手动返回 Today 重新读取。"
                    return
                }
                todayResearch = freshToday
                todayRefreshRevision &+= 1
                selectedTab = .today
            }
            let source = sourceAtSave
            if let source,
               let nextQuestion = result.report.payload.researchLayer?.nextValidationQuestions.first,
               let pack = result.workspace.data?.evidencePacks.first(where: {
                   $0.id == result.report.evidencePackId
               }),
               result.report.isCurrentExact,
               pack.id == requestBody.evidencePackId,
               pack.packFingerprint == requestBody.evidencePackBinding.fingerprint,
               pack.currentness.status == "current",
               !nextQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                todayReportRevisionNotice = TodayReportRevisionNotice(
                    membershipId: membership.id,
                    membershipVersion: membership.version,
                    symbol: membership.symbol,
                    reportId: result.report.id,
                    reportVersion: result.report.version,
                    reportFingerprint: result.report.reportFingerprint,
                    evidencePackId: result.report.evidencePackId,
                    source: source,
                    nextValidationQuestion: nextQuestion,
                    savedAt: result.report.createdAt
                )
                pendingResearchReportReconsiderationId = nil
                setPendingResearchReportRevisionSource(nil)
                todayRefreshRevision &+= 1
                selectedTab = .today
            } else if source != nil {
                setPendingResearchReportRevisionSource(nil)
            }
            twoLayerReportWorkspace.message = result.report.isFormalizable
                ? "报告 #\(result.report.id) 已保存并核对；请审阅后确认或驳回。"
                : "报告 #\(result.report.id) 已保存，但内容仍不完整；请先查看缺失项。"
        } catch {
            guard twoLayerReportWorkspace.requests.acceptsSave(revision) else { return }
            let message = twoLayerReportErrorMessage(error)
            if twoLayerReportFailureRequiresClear(error) {
                invalidateTwoLayerReport(message)
                twoLayerReportWorkspace.fail(.synthesis, message: message)
            } else {
                let retryingAbsorption = pendingTask.map {
                    ["ready_to_absorb", "succeeded"].contains($0.status)
                } ?? false
                let postedTask = twoLayerReportWorkspace.pendingSynthesisTask
                twoLayerReportWorkspace.preserveAmbiguousWrite(
                    previousEnvelope: previousEnvelope,
                    message: retryingAbsorption
                        ? "吸收结果尚未精确确认；综合结果与同一请求身份已保留，明确重试会核对同一次写入。"
                        : postedTask.map { "任务 #\($0.id) 已创建，但精确状态尚未读取；任务身份已保留，明确刷新只会读取同一任务。" }
                            ?? "生成或任务重试结果尚未精确确认；草稿、任务与同一请求身份已保留。",
                    action: retryingAbsorption ? .absorption : .synthesis
                )
            }
        }
    }
    @MainActor
    func openRequestedTodayReportRevision() async {
        guard let target = requestedTodayReportRevision,
              let symbol = parsedSymbol,
              target.symbol == symbol.canonical else {
            requestedTodayReportRevision = nil
            todayReportRevisionNotice = nil
            researchReportFormalDecisionMessage = "Today 报告修订目标与当前标的不一致；请求已清除。"
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        await refreshDailyClient(
            restoredNavigation: false,
            preferredMembership: nil,
            preferredMembershipIdentity: TodayCandidateNavigationTarget(
                membershipId: target.membershipId,
                membershipVersion: target.membershipVersion,
                symbol: target.symbol
            )
        )
        guard requestedTodayReportRevision == target else { return }
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              parsedSymbol?.canonical == target.symbol,
              let membership = selectedMembership,
              membership.id == target.membershipId,
              membership.version == target.membershipVersion,
              membership.symbol == target.symbol,
              membership.state != .archived else {
            clearTodayReportRevisionNavigation(
                "Today 报告修订目标的标的、membership 或授权已变化；请求已清除。", expected: target)
            return
        }
        await loadTwoLayerReports()
        guard requestedTodayReportRevision == target else { return }
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              let data = twoLayerReportWorkspace.envelope?.data,
              let report = data.reports.first(where: {
                  $0.id == target.reportId
                      && $0.version == target.reportVersion
                      && $0.reportFingerprint == target.reportFingerprint
                      && $0.evidencePackId == target.evidencePackId
              }),
              let pack = data.evidencePacks.first(where: { $0.id == target.evidencePackId }),
              report.isCurrentExact,
              data.latestPack?.id == pack.id && data.latestPack?.packFingerprint == pack.packFingerprint,
              report.payload.evidencePackBinding?.fingerprint == pack.packFingerprint,
              pack.membershipId == membership.id,
              pack.membershipVersion == membership.version,
              pack.symbol == membership.symbol,
              pack.currentness.status == "current",
              (target.assistantHandoff != nil
                || report.payload.researchLayer?.nextValidationQuestions.first
                    == target.nextValidationQuestion) else {
            clearTodayReportRevisionNavigation(
                "报告修订的 report、evidence pack、membership 或下一验证问题已漂移；入口失败闭合。", expected: target)
            return
        }
        if let handoff = target.assistantHandoff {
            requestedTodayReportRevision = nil
            switch handoff {
            case .openCitation(let responseFact, let evidenceId):
                guard let fact = report.researchEvidenceQuestionFact(matching: responseFact) else {
                    twoLayerReportWorkspace.message = "这条引用已不属于当前报告；没有打开替代来源。"
                    return
                }
                selectedDecisionLayer = .evidence
                selectedEvidenceWorkspace = .frozen
                if let evidenceId,
                   let material = pack.exactReopenableMaterial(for: fact, evidenceId: evidenceId) {
                    await openTwoLayerMaterialCitation(report: report, pack: pack, material: material)
                } else if evidenceId == nil,
                          let citation = fact.citation?.reopenableDocumentCitation {
                    await openSelectedContextReportCitation(report: report, fact: fact, citation: citation)
                } else if evidenceId == nil,
                          let citation = fact.citation?.reopenablePeerOriginalCitation {
                    await openSelectedContextPeerOriginal(report: report, fact: fact, citation: citation)
                } else {
                    twoLayerReportWorkspace.message = "当前引用没有可重开的精确原件；未使用替代来源。"
                }
            case .openExternalSource(let responseFact):
                openAssistantExternalSource(responseFact, report: report, pack: pack, events: data.events)
            case .reportRevision(let draft):
                await beginTwoLayerReportRevision(report, assistantDraft: draft)
            case .researchTodo(let draft):
                reviewFollowUpDrafts.evidenceGapChecklist = draft
                refreshReviewFollowUpDraftSummary()
                selectedDecisionLayer = .review
                selectedReviewWorkspace = .followUp
                twoLayerReportWorkspace.message = "已把助手修正放入本机会话的研究待办草稿；未写入正式报告、正式决定或服务器。"
            case .reviewQuestionDraft(let handoff): await openResearchReviewQuestionDraft(handoff, symbol: symbol, authorizationRevision: authorizationRevision)
            }
            return
        }
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .brief
        pendingDecisionWorkspaceScrollTarget = twoLayerReportFormalDecisionAnchor(report.id)
        requestedTodayReportRevision = nil
        researchReportFormalDecisionMessage =
            "已打开当前报告 v\(report.version)；请审阅后决定是否修订。"
    }
    @MainActor
    private func clearTodayReportRevisionNavigation(_ message: String, expected target: TodayReportRevisionNotice) {
        guard requestedTodayReportRevision == target else { return }
        requestedTodayReportRevision = nil
        todayReportRevisionNotice = nil
        twoLayerReportWorkspace.message = message
        researchReportFormalDecisionMessage = message
    }
    @MainActor func routeTodayResearchAction(_ item: TodayResearchItem) { if item.bindings.monitorRef?.kind == "weinstein_structure" { selectedDecisionLayer = .evidence; selectedEvidenceWorkspace = .frozen; pendingDecisionWorkspaceScrollTarget = "gateBResearchWeinsteinSection"; return }
        switch todayResearchActionDestination(item) {
        case .materials, .freezeEvidence:
            selectedDecisionLayer = .evidence; selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = "researchInvestmentBriefTop"
        case .createReport:
            selectedDecisionLayer = .evidence; selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = "createTwoLayerReportDraftButton"
        case .reportDecision, .item:
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = "todayResearchItem:\(item.id)"
        }
    }
}
