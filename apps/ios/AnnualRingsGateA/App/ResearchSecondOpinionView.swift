import Foundation
import SwiftUI

struct ResearchSecondOpinionView: View {
    private struct PendingRequest: Codable {
        let key: String
        let reason: String
        let sourceSetHash: String
    }
    let client: ResearchClient
    @ObservedObject var viewModel: GateBResearchViewModel
    let authorizationContext: AppResearchAuthorizationContext
    let authorizationRevision: UUID
    let membership: CandidateMembershipData
    let report: TwoLayerReportData
    let pack: FrozenResearchEvidencePack
    @Binding var activeMembership: CandidateMembershipData?
    @Binding var activeCloudAiPolicy: CloudAiPolicyEnvelope?
    let onOpenSource: (ResearchSecondOpinionBinding, String) async -> String
    let onAdoptDraft: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var preview: ResearchSecondOpinionPreview?
    @State private var result: ResearchSecondOpinionResult?
    @State private var history: ResearchSecondOpinionHistory?
    @State private var reason = "owner_requested"
    @State private var confirmed = false
    @State private var pendingKey: String?
    @State private var pendingSourceSetHash: String?
    @State private var showingAbandonConfirmation = false
    @State private var selectedFindingIds: Set<String> = []
    @State private var draft = ""
    @State private var busy = false
    @State private var message = "先读取当前报告的发送范围，再决定是否单独计费取得第二意见。"
    @State private var sourceMessage = ""

    private var identityCurrent: Bool {
        activeMembership?.id == membership.id && activeMembership?.version == membership.version
            && activeMembership?.symbol == membership.symbol
            && activeMembership?.actorId == membership.actorId
            && viewModel.authorizationRevision == authorizationRevision
            && viewModel.runtimeAuthorizationContext == authorizationContext
            && AppEnvironment.researchAuthorizationContext() == authorizationContext
            && viewModel.client === client
    }

    private var cloudAiPolicyEnabled: Bool { activeCloudAiPolicy?.isEnabled == true }

    private var pendingStorageKey: String {
        let scope = researchSecondOpinionConnectionScope(baseURL: authorizationContext.baseURL,
            readHeader: authorizationContext.readHeaderName, readToken: authorizationContext.readToken,
            writeHeader: authorizationContext.writeHeaderName, writeToken: authorizationContext.writeToken,
            actorId: membership.actorId)
        return "research-second-opinion-pending-v2:\(scope):\(membership.id):\(report.id):\(report.reportFingerprint)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("按需第二意见").font(.title3.bold())
                Text("同一已选冻结证据，单独提示与运行；当前配置若仍是同一模型提供方，结果不代表跨模型共识。不会自动确认报告、决定或交易。")
                    .font(.caption).foregroundStyle(.secondary)
                Text("当前报告 #\(report.id) v\(report.version) · \(membership.symbol)")
                    .font(.caption).monospacedDigit()
                if !identityCurrent {
                    Text("研究标的、actor、连接或授权已改变；旧页面已失效。请返回并在当前连接重新进入。")
                        .foregroundStyle(.orange)
                }
                if !cloudAiPolicyEnabled {
                    Text("Cloud AI 当前未确认启用；发送前需要在研究设置中完成 Owner 授权。")
                        .foregroundStyle(.orange)
                }
                Button("读取当前发送范围") { Task { await loadPreview() } }
                    .disabled(busy || !identityCurrent)
                    .accessibilityIdentifier("secondOpinionReadPreview")
                if pendingKey != nil {
                    Button("结束此未决请求，重新选择发送范围") { showingAbandonConfirmation = true }
                        .disabled(busy || !identityCurrent)
                        .confirmationDialog("原请求可能已产生费用。结束后再次发起会是新的付费请求。",
                            isPresented: $showingAbandonConfirmation) {
                            Button("结束原请求", role: .destructive) {
                                guard identityCurrent else { return }
                                pendingKey = nil; pendingSourceSetHash = nil; preview = nil
                                confirmed = false
                                UserDefaults.standard.removeObject(forKey: pendingStorageKey)
                                message = "原请求已从本机待续状态移除；服务器尝试记录仍保留。"
                            }
                        }
                }
                if identityCurrent, let preview {
                    previewSection(preview)
                }
                if identityCurrent, let result {
                    resultSection(result)
                }
                if !sourceMessage.isEmpty {
                    Text(sourceMessage).font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("secondOpinionSourceMessage")
                }
                historySection
                Text(message).font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("secondOpinionMessage")
            }
            .padding()
        }
        .navigationTitle("第二意见")
        .task {
            guard identityCurrent else { return }
            if let data = UserDefaults.standard.data(forKey: pendingStorageKey),
               let pending = try? JSONDecoder().decode(PendingRequest.self, from: data) {
                pendingKey = pending.key
                pendingSourceSetHash = pending.sourceSetHash
                reason = pending.reason
                message = "已恢复原第二意见请求键。可读取当前范围，再查询同一请求；不会自动重发。"
            }
        }
        .onChange(of: viewModel.authorizationRevision) { _, _ in invalidateForAuthorizationChange() }
        .onChange(of: activeMembership?.actorId) { _, _ in invalidateForAuthorizationChange() }
        .onChange(of: activeMembership?.id) { _, _ in invalidateForAuthorizationChange() }
        .onChange(of: activeMembership?.version) { _, _ in invalidateForAuthorizationChange() }
        .onChange(of: cloudAiPolicyEnabled) { _, enabled in
            if !enabled { confirmed = false }
        }
        .onChange(of: scenePhase) { _, _ in
            if !identityCurrent { invalidateForAuthorizationChange() }
        }
        .accessibilityIdentifier("researchSecondOpinionView")
    }

    @ViewBuilder
    private func previewSection(_ preview: ResearchSecondOpinionPreview) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("发送前核对").font(.headline)
            Text("判断：\(preview.reportConclusion)")
            Text("以下假设原样进入模型（\(preview.assumptions.count) 项）：").font(.caption.bold())
            if preview.assumptions.isEmpty { Text("无") .font(.caption) }
            ForEach(preview.assumptions, id: \.self) { Text("• " + $0).font(.caption).textSelection(.enabled) }
            Text("报告已经列为反证的来源 ID：\(preview.reportCounterEvidenceIds.isEmpty ? "无" : preview.reportCounterEvidenceIds.joined(separator: "、"))")
                .font(.caption).textSelection(.enabled)
            Text("提供方 / 模型：\(preview.provider) / \(preview.model)")
            DisclosureGroup("发送身份与字段说明") {
                Text("membership \(preview.binding.membershipId) v\(preview.binding.membershipVersion) · \(preview.binding.symbol)")
                Text("报告 #\(preview.binding.reportId) v\(preview.binding.reportVersion) · 报告指纹 \(preview.binding.reportFingerprint)")
                Text("证据包 #\(preview.binding.evidencePackId) · 指纹 \(preview.binding.evidencePackFingerprint)")
                Text("快照 \(preview.binding.snapshotId) · 选材摘要 \(preview.binding.sourceSetHash)")
                Text("模型收到上述判断、假设、已有反证 ID、以下来源字段与摘录；来源网址只供本机打开，不发送。")
            }.font(.caption).textSelection(.enabled)
            Text("本次最多输出 \(preview.maxOutputTokens) tokens；输入上界 \(preview.inputTokenUpperBound) tokens，预计最高约 $\(preview.estimatedMaxCostUsd, specifier: "%.4f")。实际用量在结果中回读。")
                .font(.caption)
            ForEach(preview.limitations, id: \.self) { Text(previewBullet($0)).font(.caption).foregroundStyle(.secondary) }
            DisclosureGroup("将发送的 \(preview.sources.count) 项选定材料摘录与来源") {
                ForEach(preview.sources) { source in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(source.title) · \(source.evidenceId)").font(.callout.bold())
                        Text(source.excerpt).font(.caption).textSelection(.enabled)
                        if source.excerptTruncated { Text("仅发送以上摘录，其余正文未发送。")
                            .font(.caption2).foregroundStyle(.orange) }
                        Text("材料 #\(source.materialId) · \(source.sourceType) · \(source.verificationStatus)")
                            .font(.caption2).foregroundStyle(.secondary)
                        Text("证据 \(source.evidenceId) · 指纹 \(source.contentFingerprint) · \(source.claimType) · \(source.stance) · 截断 \(source.excerptTruncated ? "是" : "否")")
                            .font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
                        Button("在研究原件中打开") {
                            Task { await openSource(preview.binding, evidenceId: source.evidenceId) }
                        }
                            .disabled(!identityCurrent)
                        if let url = URL(string: source.sourceUrl ?? ""),
                           ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                            Link("查看来源网址", destination: url).disabled(!identityCurrent)
                        }
                    }.padding(.vertical, 5)
                }
            }
            Picker("发起原因", selection: $reason) {
                Text("Owner 主动要求").tag("owner_requested")
                Text("高权重研究").tag("high_weight")
                Text("重要建仓前").tag("pre_position")
                Text("存在重大分歧").tag("material_disagreement")
            }.disabled(pendingKey != nil)
            Toggle("我已核对发送摘录、同模型限制与单次费用上界，明确发起", isOn: $confirmed)
                .disabled(pendingKey != nil)
            Button(pendingKey == nil ? "单独运行第二意见" : "读取同一请求结果") {
                Task { await runOpinion() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || !identityCurrent || !cloudAiPolicyEnabled || !confirmed
                || !preview.validates(membership, report: report, pack: pack))
            .accessibilityIdentifier("secondOpinionRun")
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private func resultSection(_ result: ResearchSecondOpinionResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(result.status == "available" ? "已保存的独立分析" : "发送尝试未完成")
                .font(.headline)
            Text(result.message).font(.caption)
            Text("\(result.provider) / \(result.model) · \(result.tokenUsage) · 费用 \(result.costUsd)")
                .font(.caption).monospacedDigit()
            DisclosureGroup("发送清单与预算记录") {
                Text("证据包 \(result.binding.evidencePackId) · 快照 \(result.binding.snapshotId)")
                Text("请求 SHA-256 \(result.sendManifest.payloadSha256)")
                Text("预计上界 $\(result.sendManifest.estimatedMaxCostUsd, specifier: "%.4f")；整份 PDF / 凭据 / 正式资产事实均未发送。")
            }.font(.caption).textSelection(.enabled)
            if result.status == "available" {
                ForEach(["support", "disagreement", "new_counterevidence", "unknown"], id: \.self) { kind in
                    let rows = result.findings.filter { $0.kind == kind }
                    VStack(alignment: .leading, spacing: 5) {
                        Text(kindTitle(kind)).font(.subheadline.bold())
                        if rows.isEmpty { Text("UNKNOWN：本次没有可验证条目。")
                            .font(.caption).foregroundStyle(.secondary) }
                        ForEach(rows) { finding in
                            Button {
                                if selectedFindingIds.contains(finding.id) { selectedFindingIds.remove(finding.id) }
                                else { selectedFindingIds.insert(finding.id) }
                                draft = selectedDraft(from: result)
                            } label: {
                                Label(finding.explanation,
                                      systemImage: selectedFindingIds.contains(finding.id) ? "checkmark.circle.fill" : "circle")
                            }.buttonStyle(.plain)
                            Text("来源：\(finding.sourceEvidenceIds.isEmpty ? "无；保留 UNKNOWN" : finding.sourceEvidenceIds.joined(separator: "、"))")
                                .font(.caption2).foregroundStyle(.secondary)
                            ForEach(finding.sourceEvidenceIds, id: \.self) { id in
                                Button("打开来源 \(id)") {
                                    Task { await openSource(result.binding, evidenceId: id) }
                                }.font(.caption)
                            }
                        }
                    }
                }
                Text("选择要带入的条目，可先编辑；正式材料、报告与决定须在原流程另行确认。")
                    .font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $draft).frame(minHeight: 120)
                    .accessibilityIdentifier("secondOpinionDraft")
                Button("把所选意见带入可编辑修订草稿") {
                    onAdoptDraft(draft)
                    dismiss()
                }
                    .disabled(!identityCurrent || !result.validates(membership, report: report, pack: pack)
                        || selectedFindingIds.isEmpty || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                ShareLink("导出本次第二意见", item: exportText(result))
                    .disabled(!identityCurrent)
            }
        }
    }

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button("读取已存第二意见与失败尝试") { Task { await loadHistory() } }
                .disabled(busy || !identityCurrent)
            if identityCurrent, let history {
                Text("成功 \(history.results.count) 次；失败尝试 \(history.attempts.count) 次。失败不计入成功意见。")
                    .font(.caption)
                ForEach(history.results.indices, id: \.self) { index in
                    let item = history.results[index]
                    Button("报告 #\(item.binding.reportId) · \(item.generatedAt) · \(item.model)") {
                        guard identityCurrent else { return }
                        result = item; selectedFindingIds = []; draft = ""
                    }
                }
                ForEach(history.attempts.indices, id: \.self) { index in
                    let item = history.attempts[index]
                    Text("未完成 · \(item.generatedAt) · \(item.message)").font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    @MainActor private func loadPreview() async {
        guard identityCurrent, !busy else { return }
        busy = true; preview = nil; result = nil; confirmed = pendingKey != nil
        defer { busy = false }
        do {
            let fresh = try await client.readResearchSecondOpinionPreview(membership: membership)
            guard identityCurrent, fresh.validates(membership, report: report, pack: pack) else {
                message = "报告或证据身份已变化；旧预览已清除。"; return
            }
            guard pendingSourceSetHash == nil || pendingSourceSetHash == fresh.binding.sourceSetHash else {
                message = "未决请求的选定材料已变化；仅保留原请求键与历史，不续发。"; return
            }
            preview = fresh
            message = "已读取同一冻结证据的发送范围；尚未调用模型。"
        } catch { message = "发送范围读取失败；未调用模型。\(error.localizedDescription)" }
    }

    @MainActor private func runOpinion() async {
        guard identityCurrent, !busy, confirmed, cloudAiPolicyEnabled,
              let preview, preview.validates(membership, report: report, pack: pack) else { return }
        let key = pendingKey ?? "ios-second-opinion-\(UUID().uuidString.lowercased())"
        pendingKey = key; pendingSourceSetHash = preview.binding.sourceSetHash
        if let data = try? JSONEncoder().encode(PendingRequest(key: key, reason: reason,
            sourceSetHash: preview.binding.sourceSetHash)) {
            UserDefaults.standard.set(data, forKey: pendingStorageKey)
        }
        busy = true
        defer { busy = false }
        do {
            let returned = try await client.runResearchSecondOpinion(membership: membership,
                request: ResearchSecondOpinionRequest(binding: preview.binding, reason: reason, idempotencyKey: key))
            guard identityCurrent, returned.validates(membership, report: report, pack: pack),
                  returned.binding == preview.binding else {
                message = "报告或来源在发送期间改变；旧结果未显示。请求键保留供核对。"; return
            }
            if returned.status == "available" {
                let reread = try await client.readResearchSecondOpinionHistory(membership: membership)
                guard identityCurrent, reread.schemaVersion == researchSecondOpinionVersion,
                      reread.results.contains(where: { $0.binding == returned.binding
                          && $0.sendManifest.payloadSha256 == returned.sendManifest.payloadSha256
                          && $0.generatedAt == returned.generatedAt }) else {
                    message = "模型已返回，但独立保存结果未能读回；保留原请求键，不将它显示为成功。"; return
                }
                history = reread
                pendingKey = nil
                pendingSourceSetHash = nil
                UserDefaults.standard.removeObject(forKey: pendingStorageKey)
            }
            result = returned
            message = returned.message
        } catch { message = "请求状态未知，原请求键已保留；再次点击只查询或续用同一请求。\(error.localizedDescription)" }
    }

    @MainActor private func loadHistory() async {
        guard identityCurrent, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let fetched = try await client.readResearchSecondOpinionHistory(membership: membership)
            guard identityCurrent, fetched.schemaVersion == researchSecondOpinionVersion else { return }
            history = fetched
        } catch { history = nil; message = "已存第二意见读取失败：\(error.localizedDescription)" }
    }

    @MainActor private func invalidateForAuthorizationChange() {
        guard !identityCurrent else { return }
        preview = nil; result = nil; history = nil; confirmed = false; sourceMessage = ""
        pendingKey = nil; pendingSourceSetHash = nil; selectedFindingIds = []; draft = ""
        message = "连接、actor 或授权已改变；旧页面已清除，未决请求仍留在原连接的本机范围中。"
    }

    @MainActor private func openSource(_ binding: ResearchSecondOpinionBinding, evidenceId: String) async {
        guard identityCurrent else { return }
        sourceMessage = "正在按第二意见绑定重开来源 \(evidenceId)。"
        let outcome = await onOpenSource(binding, evidenceId)
        guard identityCurrent else { sourceMessage = ""; return }
        sourceMessage = outcome
    }

    private func selectedDraft(from result: ResearchSecondOpinionResult) -> String {
        result.findings.filter { selectedFindingIds.contains($0.id) }
            .map { "\(kindTitle($0.kind))：\($0.explanation)；来源 \($0.sourceEvidenceIds.joined(separator: "、"))" }
            .joined(separator: "\n")
    }

    private func exportText(_ result: ResearchSecondOpinionResult) -> String {
        (["第二意见 · \(result.binding.symbol) · 报告 #\(result.binding.reportId)",
          "\(result.provider) / \(result.model) · \(result.generatedAt)",
          "成本 \(result.costUsd) · \(result.tokenUsage)", result.message]
         + result.findings.map { "\(kindTitle($0.kind))：\($0.explanation) [\($0.sourceEvidenceIds.joined(separator: ","))]" })
            .joined(separator: "\n")
    }

    private func kindTitle(_ kind: String) -> String {
        switch kind {
        case "support": "支持"
        case "disagreement": "分歧"
        case "new_counterevidence": "报告遗漏的反证"
        default: "UNKNOWN / 待核实"
        }
    }

    private func previewBullet(_ value: String) -> String { "• " + value }
}
