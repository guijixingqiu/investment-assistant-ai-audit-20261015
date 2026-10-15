import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func twoLayerReportRevisionAction(for report: TwoLayerReportData) -> some View {
        if report.isCurrentExact {
            Button {
                Task { await beginTwoLayerReportRevision(report) }
            } label: {
                Label("吸收到研究档案并修订", systemImage: "arrow.triangle.2.circlepath.doc.on.clipboard")
            }
            .buttonStyle(.bordered)
            .disabled(twoLayerReportWorkspace.isBusy)
            .accessibilityIdentifier("twoLayerReportStartRevision-\(report.id)")
        }
    }
}
