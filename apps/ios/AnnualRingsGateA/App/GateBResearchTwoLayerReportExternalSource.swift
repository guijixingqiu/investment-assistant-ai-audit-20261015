import SwiftUI

extension GateBResearchScreen {
    @MainActor
    func openAssistantExternalSource(
        _ responseFact: ResearchEvidenceQuestionEnvelope.Fact,
        report: TwoLayerReportData,
        pack: FrozenResearchEvidencePack,
        events: [ResearchAnnouncementEventData]
    ) {
        guard let fact = report.researchEvidenceQuestionFact(matching: responseFact),
              let url = pack.exactExternalSourceURL(for: fact, events: events) else {
            twoLayerReportWorkspace.message =
                "当前网页来源不再唯一、安全或属于该事实；未打开替代来源。"
            return
        }
        openURL(url)
        twoLayerReportWorkspace.message = "已重新核对当前报告、证据包和网页来源。"
    }

    @MainActor
    func openTwoLayerExternalSource(
        report: TwoLayerReportData,
        fact: TwoLayerReportFact
    ) async {
        guard let membership = selectedMembership,
              report.isCurrentExact,
              currentResearchEvidenceQuestionReport?.id == report.id,
              currentResearchEvidenceQuestionReport?.version == report.version,
              currentResearchEvidenceQuestionReport?.reportFingerprint == report.reportFingerprint,
              currentTwoLayerReportPack?.id == report.evidencePackId,
              report.researchEvidenceQuestionFacts.contains(fact) else {
            twoLayerReportWorkspace.message = "当前报告或来源身份已经变化；未打开缓存或替代网页。"
            return
        }
        do {
            let envelope = try await client.fetchFrozenResearchEvidence(membership: membership)
            let reports = envelope.data?.reports.filter {
                $0.id == report.id
                    && $0.version == report.version
                    && $0.reportFingerprint == report.reportFingerprint
                    && $0.evidencePackId == report.evidencePackId
            } ?? []
            let packs = envelope.data?.evidencePacks.filter {
                $0.id == report.evidencePackId
                    && $0.membershipId == membership.id
                    && $0.membershipVersion == membership.version
                    && $0.symbol == membership.symbol
            } ?? []
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  reports.count == 1,
                  packs.count == 1,
                  let data = envelope.data,
                  let freshReport = reports.first,
                  let freshPack = packs.first,
                  freshReport.isCurrentExact,
                  data.latestPack?.id == freshPack.id,
                  data.latestPack?.packFingerprint == freshPack.packFingerprint,
                  freshPack.currentness.status == "current",
                  freshReport.payload.evidencePackBinding?.fingerprint == freshPack.packFingerprint,
                  let freshFact = freshReport.researchEvidenceQuestionFacts.first(where: { $0 == fact }),
                  let url = freshPack.exactExternalSourceURL(for: freshFact, events: data.events) else {
                twoLayerReportWorkspace.message = "当前报告、证据包或网页来源已经变化；未打开缓存或替代网页。"
                return
            }
            openURL(url)
            twoLayerReportWorkspace.message = "已重新核对当前报告和证据包，并交给系统打开绑定网页来源。"
        } catch {
            twoLayerReportWorkspace.message =
                "网页来源重新核对失败；未打开缓存或替代网页：\(twoLayerReportErrorMessage(error))"
        }
    }

    @ViewBuilder
    func twoLayerExternalSourceButton(
        pack: FrozenResearchEvidencePack,
        fact: TwoLayerReportFact
    ) -> some View {
        if pack.reopenableMaterials(for: fact).isEmpty,
           let report = currentResearchEvidenceQuestionReport,
           report.evidencePackId == pack.id,
           report.researchEvidenceQuestionFacts.contains(fact),
           pack.exactExternalSourceURL(
            for: fact,
            events: twoLayerReportWorkspace.envelope?.data?.events ?? []
           ) != nil {
            Button {
                Task { await openTwoLayerExternalSource(report: report, fact: fact) }
            } label: {
                Label("打开绑定网页来源", systemImage: "safari")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("twoLayerReportExternalSource-\(fact.sourceId ?? fact.evidenceIds.joined(separator: "-"))")
        }
    }
}
