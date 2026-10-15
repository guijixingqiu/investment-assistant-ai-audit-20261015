import Foundation

extension GateBResearchScreen {
    @MainActor
    func beginTwoLayerReportRevision(
        _ report: TwoLayerReportData,
        assistantDraft: String? = nil
    ) async {
        guard !twoLayerReportWorkspace.isBusy,
              !twoLayerReportWorkspace.hasActiveSynthesisTask else {
            twoLayerReportWorkspace.message = "当前深度研究任务尚未结束；处理该任务后再修订报告。"
            return
        }
        guard let membership = selectedMembership,
              membership.state != .archived,
              report.isCurrentExact else {
            invalidateTwoLayerReport("只有当前报告才能开始修订；旧报告不会带入草稿。")
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        let revisionOperationId = twoLayerReportWorkspace.requests.beginRevisionOperation()
        await loadTwoLayerReports(preservingRevisionOperation: revisionOperationId)
        guard twoLayerReportWorkspace.requests.acceptsRevisionOperation(revisionOperationId) else {
            return
        }
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              parsedSymbol?.canonical == membership.symbol,
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              let data = twoLayerReportWorkspace.envelope?.data,
              let latestPack = data.latestPack,
              latestPack.membershipId == membership.id,
              latestPack.membershipVersion == membership.version,
              latestPack.symbol == membership.symbol,
              latestPack.currentness.status == "current",
              data.latestReport?.id == report.id,
              let freshReport = data.reports.first(where: {
                  $0.id == report.id
                      && $0.version == report.version
                      && $0.reportFingerprint == report.reportFingerprint
                      && $0.evidencePackId == latestPack.id
              }),
              freshReport.isCurrentExact else {
            invalidateTwoLayerReport("报告已因 membership、报告版本、evidence pack 或 currentness 漂移；未进入修订流程。")
            return
        }
        twoLayerReportWorkspace.draft = nil
        twoLayerReportWorkspace.saveReservation.clear()
        twoLayerReportWorkspace.decisionReservation.clear()
        twoLayerReportWorkspace.pendingWriteId = nil
        setPendingResearchReportRevisionSource(.reportCard(freshReport.id))
        await loadResearchContext(for: membership)
        guard selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              parsedSymbol?.canonical == membership.symbol else { return }
        await loadResearchDocuments()
        let draft = assistantDraft?.trimmingCharacters(in: .whitespacesAndNewlines)
        researchContextWorkspace.assistantDraft = draft?.isEmpty == false ? draft : nil
        researchContextWorkspace.isEditing = true
        researchContextWorkspace.message =
            researchContextWorkspace.assistantDraft == nil
                ? "正在修订 report #\(freshReport.id)：请新增或修正一项带 PDF 页引用的档案事实，然后重新冻结并综合。"
                : "已把你的修正带入报告 #\(freshReport.id)；可明确保存为待核实研究材料，或另行补充 PDF 原文事实。"
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .facts
        pendingDecisionWorkspaceScrollTarget = "researchContextCompletionSection"
        twoLayerReportWorkspace.message =
            "已重新读取并核对报告 #\(freshReport.id) v\(freshReport.version)；请先更新可追溯研究档案，再重新冻结并综合。"
    }

    @MainActor
    func saveAssistantReportCorrection() async {
        guard !researchContextWorkspace.isBusy,
              let correction = researchContextWorkspace.assistantDraft?.trimmingCharacters(in: .whitespacesAndNewlines),
              !correction.isEmpty,
              let membership = selectedMembership,
              membership.state != .archived,
              let report = currentResearchEvidenceQuestionReport,
              report.isCurrentExact else {
            researchContextWorkspace.message = "当前修正、研究成员或报告已经变化；没有保存研究材料。"
            return
        }
        let fingerprint = [
            membership.id, String(membership.version), report.id,
            String(report.version), report.reportFingerprint, correction
        ].joined(separator: "|")
        let key = researchContextWorkspace.reservation.reserve(
            for: fingerprint,
            prefix: "ios-owner-assistant-correction"
        )
        guard let request = report.ownerAssistantCorrectionMaterialRequest(
            membership: membership,
            correction: correction,
            idempotencyKey: key
        ) else {
            researchContextWorkspace.message = "你的修正或当前报告身份无效；没有保存研究材料。"
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        let source = pendingResearchReportRevisionSourceReservation?.source ?? .reportCard(report.id)
        let revision = researchContextWorkspace.beginSave()
        researchContextWorkspace.message = "正在保存你的修正并重新核对；不会自动运行研究服务或形成决定。"
        defer {
            if researchContextWorkspace.saveRevision == revision {
                researchContextWorkspace.isSaving = false
            }
        }
        do {
            let result = try await client.createOwnerCorrectionMaterialAndReadBack(
                membership: membership,
                requestBody: request
            )
            guard researchContextWorkspace.saveRevision == revision,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else { return }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            frozenResearchEvidenceWorkspace.setOwnerConfirmation(
                false,
                for: currentFrozenResearchBindingIdentity
            )
            researchContextWorkspace.assistantDraft = nil
            researchContextWorkspace.isEditing = false
            researchContextWorkspace.reservation.clear()
            invalidateTwoLayerReport(
                "你的助手修正已成为新研究材料；旧证据和报告已转为历史版本，必须重新冻结后再综合。"
            )
            setPendingResearchReportRevisionSource(source)
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .frozen
            pendingDecisionWorkspaceScrollTarget = "freezeResearchEvidenceButton"
            frozenResearchEvidenceWorkspace.message =
                "修正材料 #\(result.material.id) 已重新读取并确认；请核对后重新冻结当前证据版本。"
            researchContextWorkspace.message =
                "修正已保存为你提供的待核实研究材料；研究服务尚未运行，也没有确认报告或正式决定。"
            todayRefreshRevision &+= 1
            await loadTodayResearch(for: membership)
        } catch {
            guard researchContextWorkspace.saveRevision == revision else { return }
            researchContextWorkspace.message =
                "修正保存结果未确认；同一幂等身份已保留，明确重试不会自动重复写入。"
        }
    }
}
