import SwiftUI

public struct AuditLogSection: View {
    public let provider: String
    public let cutoff: String
    public let evidenceHash: String
    public let taskStatus: String
    public let provenance: DataProvenance
    
    @State private var isExpanded: Bool = false
    
    public init(provider: String, cutoff: String, evidenceHash: String, taskStatus: String, provenance: DataProvenance) {
        self.provider = provider
        self.cutoff = cutoff
        self.evidenceHash = evidenceHash
        self.taskStatus = taskStatus
        self.provenance = provenance
    }
    
    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            }) {
                HStack {
                    Image(systemName: isExpanded ? "chevron.down.circle.fill" : "chevron.right.circle")
                        .foregroundColor(Theme.blue)
                        .font(.system(size: 14))
                    Text("依据与审计记录 (工程诊断)")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Theme.textSecondary)
                    Spacer()
                    StatusBadgeView(provenance)
                }
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            
            if isExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    Divider().background(Theme.border)
                    
                    auditRow(label: "数据源通道", value: provider)
                    auditRow(label: "事实数据截止", value: cutoff)
                    auditRow(label: "证据包指纹", value: evidenceHash, isMonospace: true)
                    auditRow(label: "Deep Research 状态", value: taskStatus)
                    auditRow(label: "决策边界", value: "个人辅助判断 · 无自动交易权限")
                    
                    Text("当前概览未返回的证据索引与任务状态，请在完整研究工作台中核对。")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.textTertiary)
                        .padding(.top, 4)
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
        .templateCardStyle()
    }
    
    private func auditRow(label: String, value: String, isMonospace: Bool = false) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.system(size: 12))
                .foregroundColor(Theme.textTertiary)
                .frame(width: 120, alignment: .leading)
            Spacer()
            Text(value)
                .font(isMonospace ? .system(size: 11, design: .monospaced) : .system(size: 12))
                .foregroundColor(Theme.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }
}
