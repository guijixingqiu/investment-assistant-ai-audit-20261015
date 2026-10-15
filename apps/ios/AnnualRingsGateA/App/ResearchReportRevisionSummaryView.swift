import SwiftUI

struct ResearchReportRevisionSummaryView: View {
    let summary: ResearchReportRevisionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label("研究报告修订摘要 · \(versionLabel)", systemImage: "arrow.triangle.2.circlepath")
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("researchReportRevisionSummaryTitle")
            Text("你的变化说明：\(summary.declaredChange)")
                .font(.caption)
                .accessibilityIdentifier("researchReportRevisionDeclaredChange")
            if let reason = summary.comparisonUnavailableReason {
                Text(reason).font(.caption).foregroundStyle(.orange)
                    .accessibilityIdentifier("researchReportRevisionIncomparable")
            } else if summary.hasPreviousVersion {
                if summary.hasStructuralChange {
                    Text("检测到结构化变化：\(summary.changedSections.joined(separator: "、"))")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("researchReportRevisionChangedSections")
                } else {
                    Text("未检测到结构化字段变化；请核对你的变化说明。")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("researchReportRevisionNoStructuralChange")
                }
                if summary.bindingChanged == true {
                    Text("证据绑定也发生变化；是否为当前版本以重新读取的证据包为准。")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("researchReportRevisionBindingChanged")
                } else if summary.bindingChanged == false {
                    Text("证据绑定未变化；估值与技术事实继续由当前证据版本生成。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("researchReportRevisionBindingStable")
                } else {
                    Text("证据绑定暂无法判断；历史版本缺少可比较的证据版本绑定。")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("researchReportRevisionBindingUnknown")
                }
                if !summary.unchangedSections.isEmpty {
                    Text("未变化：\(summary.unchangedSections.joined(separator: "、"))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("researchReportRevisionUnchangedSections")
                }
            } else {
                Text("这是当前已读取到的首个版本，没有可比较的上一版。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("researchReportRevisionFirstVersion")
            }
            Text("仅比较服务端返回的两个不可变版本；不生成新结论、不自动确认，也不触发交易。")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchReportRevisionReadOnlyBoundary")
        }
        .padding(8)
        .background(Color.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchReportRevisionSummary")
    }

    private var versionLabel: String {
        if let previousVersion = summary.previousVersion {
            return "版本变化 v\(previousVersion) → v\(summary.currentVersion)"
        }
        return "版本变化 v\(summary.currentVersion) · 首版"
    }
}
