import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func deepResearchReviewSummary(_ research: TwoLayerResearch) -> some View {
        let allEvidence = research.fundamentals
            + (research.context ?? [])
            + research.valuation
            + research.technical
            + (research.quantPortfolio ?? [])
            + research.eventsAndCatalysts
            + (research.operatingMonitor ?? [])
            + research.risks
        let evidence = allEvidence.filter { $0.sourceKind != "source_missing" }
        let counterevidence = research.counterevidence.filter { $0.sourceKind != "source_missing" }
        let missingCount = research.unknowns.count
            + (allEvidence + research.counterevidence).filter { $0.sourceKind == "source_missing" }.count

        VStack(alignment: .leading, spacing: 6) {
            Text("审阅摘要")
                .font(.subheadline.weight(.semibold))
            Text("已绑定 \(evidence.count) 条依据 · \(counterevidence.count) 条反证 · \(missingCount) 项待核实")
                .font(.caption.weight(.semibold))
            ForEach(Array(evidence.prefix(3).enumerated()), id: \.offset) { _, fact in
                Label(fact.statement, systemImage: "doc.text")
                    .font(.caption)
            }
            if let fact = counterevidence.first {
                Label("反证：\(fact.statement)", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            if let question = research.nextValidationQuestions.first {
                Label("下一步核实：\(question)", systemImage: "questionmark.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("deepResearchReviewSummary")
    }
}
