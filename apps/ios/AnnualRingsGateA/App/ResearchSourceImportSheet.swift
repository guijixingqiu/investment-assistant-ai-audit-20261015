import SwiftUI

struct ResearchSourceImportSheet: View {
    let membership: CandidateMembershipData
    let client: ResearchClient
    let maySave: () -> Bool
    let onSaved: (FrozenResearchEvidenceWorkspace) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ResearchEventCaptureDraft()
    @State private var claimType = "third_party_statement"
    @State private var reservation = ResearchDocumentIdempotencyReservation()
    @State private var saving = false
    @State private var message = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("资料 · \(membership.symbol)") {
                    TextField("标题", text: $draft.title)
                        .accessibilityIdentifier("sourceImportTitle")
                    TextField("原文链接 https://…", text: $draft.sourceURL)
                        .keyboardType(.URL).textInputAutocapitalization(.never)
                        .accessibilityIdentifier("sourceImportURL")
                    DatePicker("发布日期", selection: $draft.publishedAt, in: ...Date(), displayedComponents: .date)
                        .accessibilityIdentifier("sourceImportPublishedAt")
                    Picker("来源", selection: $claimType) {
                        Text("公司披露").tag("issuer_statement")
                        Text("媒体或其他来源").tag("third_party_statement")
                    }
                    TextField("摘录或摘要，保留数字、单位和期间", text: $draft.summary, axis: .vertical)
                        .lineLimit(6...14).accessibilityIdentifier("sourceImportSummary")
                }
                Section {
                    Text("保存你提供的摘录和原文链接。材料不会自动标为已核实；保存后可以开始有限研究，无需先设置指标或上传 PDF。")
                    DatePicker("下次核实来源有效性", selection: $draft.validUntil, in: Date()..., displayedComponents: .date)
                    if !message.isEmpty { Text(message).accessibilityIdentifier("sourceImportMessage") }
                }
            }
            .autocorrectionDisabled()
            .disabled(saving)
            .navigationTitle("添加研究资料")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : "保存") { Task { await save() } }
                        .disabled(saving || !maySave() || draft.sourceMaterialRequest(
                            membership: membership, claimType: claimType, idempotencyKey: "preview"
                        ) == nil)
                        .accessibilityIdentifier("sourceImportSave")
                }
            }
            .interactiveDismissDisabled(saving)
        }
    }

    @MainActor private func save() async {
        guard !saving, maySave() else { return }
        let key = reservation.reserve(for: "\(membership.id):\(membership.version):\(claimType):\(draft.fingerprint)", prefix: "ios-source-import")
        guard let request = draft.sourceMaterialRequest(membership: membership, claimType: claimType, idempotencyKey: key) else { return }
        saving = true
        defer { saving = false }
        do {
            let result = try await client.createOwnerCorrectionMaterialAndReadBack(membership: membership, requestBody: request)
            guard maySave() else { message = "当前标的或授权已变化；重新打开对应股票核对保存结果。"; return }
            onSaved(result.workspace)
            dismiss()
        } catch {
            message = "保存或读回未完成。输入已保留，点保存会用同一请求重试。"
        }
    }
}
