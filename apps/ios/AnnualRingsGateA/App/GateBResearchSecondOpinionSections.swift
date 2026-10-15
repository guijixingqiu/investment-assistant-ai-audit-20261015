import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func researchSecondOpinionEntry() -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("按需第二意见").font(.callout.bold())
            if let membership = selectedMembership,
               let report = currentResearchEvidenceQuestionReport,
               let pack = currentTwoLayerReportPack,
               !twoLayerReportWorkspace.isStaleRead,
               viewModel.runtimeAuthorizationContext == AppEnvironment.researchAuthorizationContext(),
               report.isCurrentExact,
               pack.currentness.status == "current",
               report.evidencePackId == pack.id {
                let sessionClient = client
                let sessionContext = AppEnvironment.researchAuthorizationContext()
                let sessionRevision = viewModel.authorizationRevision
                NavigationLink {
                    ResearchSecondOpinionView(client: sessionClient, viewModel: viewModel,
                        authorizationContext: sessionContext,
                        authorizationRevision: sessionRevision,
                        membership: membership,
                        report: report, pack: pack, activeMembership: $selectedMembership,
                        activeCloudAiPolicy: $cloudAiPolicy,
                        onOpenSource: { binding, evidenceId in
                            await openResearchSecondOpinionSource(binding: binding, evidenceId: evidenceId,
                                membership: membership, sessionClient: sessionClient,
                                sessionContext: sessionContext, sessionRevision: sessionRevision)
                        }, onAdoptDraft: { text in
                            guard researchSecondOpinionSessionIsCurrent(membership: membership,
                                sessionClient: sessionClient, sessionContext: sessionContext,
                                sessionRevision: sessionRevision) else { return }
                            Task {
                                guard researchSecondOpinionSessionIsCurrent(membership: membership,
                                    sessionClient: sessionClient, sessionContext: sessionContext,
                                    sessionRevision: sessionRevision) else { return }
                                await beginTwoLayerReportRevision(report, assistantDraft: text)
                            }
                        })
                } label: {
                    Label("核对同一冻结证据并单独发起", systemImage: "text.magnifyingglass")
                }
                .accessibilityIdentifier("researchSecondOpinionEntry")
                Text("从当前报告读取选定材料摘录，先看发送范围和费用；只在你明确发起时调用模型。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("先读取当前 exact 研究报告和证据包；历史报告不能发起第二意见。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @MainActor
    private func researchSecondOpinionSessionIsCurrent(membership: CandidateMembershipData,
        sessionClient: ResearchClient, sessionContext: AppResearchAuthorizationContext,
        sessionRevision: UUID) -> Bool {
        selectedMembership?.id == membership.id && selectedMembership?.version == membership.version
            && selectedMembership?.symbol == membership.symbol
            && selectedMembership?.actorId == membership.actorId
            && viewModel.authorizationRevision == sessionRevision
            && viewModel.runtimeAuthorizationContext == sessionContext
            && AppEnvironment.researchAuthorizationContext() == sessionContext
            && viewModel.client === sessionClient
    }

    @MainActor
    private func openResearchSecondOpinionSource(binding: ResearchSecondOpinionBinding, evidenceId: String,
        membership: CandidateMembershipData, sessionClient: ResearchClient,
        sessionContext: AppResearchAuthorizationContext, sessionRevision: UUID) async -> String {
        let current = { researchSecondOpinionSessionIsCurrent(membership: membership,
            sessionClient: sessionClient, sessionContext: sessionContext,
            sessionRevision: sessionRevision) }
        guard current(), binding.membershipId == membership.id,
              binding.symbol == membership.symbol else {
            return "当前连接、actor 或成员已变化；未打开旧来源。"
        }
        do {
            let workspace = try await sessionClient.fetchFrozenResearchEvidence(membership: membership)
            guard current(), workspace.requestedActorId == membership.actorId,
                  let data = workspace.data,
                  data.target.membershipId == membership.id,
                  data.target.membershipVersion == membership.version,
                  data.target.symbol == membership.symbol else {
                return "历史来源读取期间身份已变化；未打开替代资料。"
            }
            guard let resolved = researchSecondOpinionHistoricalSource(data: data,
                binding: binding, evidenceId: evidenceId) else {
                return "这条历史意见绑定的报告、证据包或唯一来源 \(evidenceId) 已不可读取；没有改用当前版本。"
            }
            let (report, pack, material) = resolved
            if let citation = material.snapshotCitation,
               let original = material.snapshotOriginal {
                let opened = await openStoredSourceCitation(citation, original: original)
                guard current() else {
                    researchStoredTextPresentation = nil
                    return "连接在来源读取期间变化；旧结果已丢弃。"
                }
                return opened ? "已按历史证据包 #\(pack.id) 打开来源 \(evidenceId) 的原文选段。"
                    : "历史网页原件或选段无法通过哈希核验；未打开替代网页。"
            }
            guard let citation = material.citation else {
                return "该历史材料没有可重开的 PDF 页或网页选段坐标；已保留来源编号和摘录。"
            }
            let list = try await sessionClient.fetchResearchDocuments(membership: membership)
            guard current(), let document = list.documents.first(where: { $0.id == citation.documentId }),
                  document.isSourceAvailable else {
                return "历史来源所引的 PDF 原件已不可用；未打开同名或当前版本替代。"
            }
            let reread = try await sessionClient.readPersistedResearchDocumentCitation(
                membership: membership, document: document, material: material)
            guard current(), reread.material == material,
                  reread.page.documentId == citation.documentId,
                  reread.page.pageNumber == citation.pageNumber else {
                return "历史 PDF 页在回读期间发生变化；未展示旧内容。"
            }
            researchDocumentWorkspace.list = list
            researchDocumentWorkspace.selectedDocumentId = document.id
            researchDocumentWorkspace.selectedPage = reread.page
            presentResearchDocumentPDF(document: reread.document,
                pageNumber: reread.page.pageNumber, data: reread.pdfData)
            return "已按历史报告 #\(report.id) 与证据包 #\(pack.id) 打开来源 \(evidenceId) 的 PDF 原页。"
        } catch {
            return "历史来源重开失败；未使用当前版本替代。\(researchDocumentClientMessage(error))"
        }
    }
}
