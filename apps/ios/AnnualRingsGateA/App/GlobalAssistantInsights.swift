import SwiftUI

extension GlobalAssistantSheet {
    @ViewBuilder
    func globalAssistantInsights(_ insights: [ResearchEvidenceQuestionEnvelope.Insight]) -> some View {
        if !insights.isEmpty {
            Text("这意味着").font(.caption.weight(.semibold))
            ForEach(insights) { insight in
                VStack(alignment: .leading, spacing: 2) {
                    Text(insight.title).font(.caption.weight(.semibold))
                    Text(insight.statement).font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("globalAssistantInsight-\(insight.impact)")
            }
        }
    }
}
