import SwiftUI

struct ThesisFormationResponse: Decodable {
    struct ActorScope: Decodable { let actorType: String; let actorId: String }
    struct Option: Decodable {
        let binding: OperatingThesisBinding
        let reportStatus: String
        let reportCreatedAt: String
        let reportCurrentness: String
        let supportingEvidence: [String]
        let counterevidence: [String]
        let unknowns: [String]
        let limitations: [String]
    }
    struct Action: Decodable { let kind: String; let label: String }
    struct CurrentLineage: Decodable {
        let state: String
        let lineageId: String
        let currentThesisText: String
        let source: String
        let latestOwnerActionId: String?
        let originalThesisIdentity: OperatingThesisBinding
    }
    let schemaVersion: String
    let actorScope: ActorScope
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let status: String
    let contextId: String?
    let currentFormalThesis: OperatingThesisBinding?
    let currentLineage: CurrentLineage?
    let options: [Option]
    let selectedOption: Option?
    let counterevidence: [String]
    let unknowns: [String]
    let nextResearchQuestion: String?
    let limitations: [String]
    let nextOwnerAction: Action
    let generatedAt: String
    let projectionFingerprint: String
}

struct ThesisFormationEntryView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let membership: CandidateMembershipData
    @State private var status: String?
    @State private var optionCount = 0
    @State private var currentText: String?
    @State private var loading = true
    var body: some View {
        NavigationLink { ThesisFormationView(membership: membership) } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text(currentText ?? "我的正式判断").font(.body.weight(.medium))
                Text(status == "BOUND" ? "已记录正式判断" :
                     status == "ENDED_REQUIRES_NEW_LINEAGE" ? "原判断已结束" :
                     status == "READY_TO_SELECT" ? "尚未记录 · 已有研究条件：\(optionCount) 条" :
                     status == "NEEDS_DEEP_RESEARCH" ? "还没有可用于正式判断的研究依据" :
                     (loading ? "正在读取正式判断…" : "正式判断暂未取得，点开后可重新读取"))
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                Text(status == "NEEDS_DEEP_RESEARCH" ? "继续研究 →" : "查看与编辑 →")
                    .font(.caption).foregroundStyle(Theme.blue)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("phase15ResearchEntry")
        .task(id: "\(membership.id)|\(membership.version)|\(api.selectedSymbol)|\(api.authorizationRevision)") {
            loading = true
            defer { loading = false }
            status = nil; optionCount = 0; currentText = nil
            guard api.selectedSymbol == membership.symbol else { return }
            let authorization = AppEnvironment.researchAuthorizationContext()
            guard let token = authorization.readToken else { return }
            var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/thesis-formation"))
            request.setValue(token, forHTTPHeaderField: authorization.readHeaderName)
            guard let (data, response) = try? await URLSession.shared.data(for: request),
                  !Task.isCancelled,
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let value = try? JSONDecoder().decode(ThesisFormationResponse.self, from: data),
                  value.membershipId == membership.id, value.membershipVersion == membership.version,
                  value.symbol == membership.symbol, value.actorScope.actorId == membership.actorId,
                  api.selectedSymbol == membership.symbol,
                  AppEnvironment.researchAuthorizationContext() == authorization else { return }
            status = value.status; optionCount = value.options.count; currentText = value.currentLineage?.currentThesisText
        }
    }
}

struct ThesisFormationView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let membership: CandidateMembershipData
    @State private var projection: ThesisFormationResponse?
    @State private var selectedIndex: Int?
    @State private var showConfirmation = false
    @State private var saving = false
    @State private var message: String?
    @State private var requestKey = "thesis-formation-\(UUID().uuidString)"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(membership.symbol).font(.subheadline).foregroundStyle(Theme.textSecondary).accessibilityIdentifier("phase15Title")
                Text("先选择一条与你观点一致的研究条件，查看依据与不确定之处，再确认保存。记录判断不会生成投资决定。")
                    .font(.caption).foregroundStyle(.secondary)
                if let value = projection {
                    if value.actorScope.actorId.hasPrefix("test-phase15-") {
                        Text("TEST FIXTURE ONLY · 隔离测试数据").font(.caption).foregroundStyle(Theme.gold)
                            .accessibilityIdentifier("phase15FixtureBanner")
                    }
                    statusContent(value)
                } else {
                    Text(message ?? "正在读取正式判断条件…").foregroundStyle(Theme.gold)
                    if message != nil {
                        Button("重新读取") { Task { await reload() } }
                            .disabled(saving)
                            .accessibilityIdentifier("phase15Reload")
                    }
                }
                if let message, projection != nil { Text(message).font(.caption).foregroundStyle(Theme.gold) }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("我的正式判断")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(membership.id)|\(membership.version)|\(api.selectedSymbol)") { await reload() }
        .confirmationDialog("设为正式判断？", isPresented: $showConfirmation, titleVisibility: .visible) {
            Button("确认设为正式判断") { Task { await confirm() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("只保存你选中的研究条件，并保留其报告来源。研究基准、跟踪节点和投资决定需要之后分别确认。")
        }
    }

    @ViewBuilder private func statusContent(_ value: ThesisFormationResponse) -> some View {
        switch value.status {
        case "NEEDS_DEEP_RESEARCH":
            Text("当前没有可用于正式判断的研究条件。").accessibilityIdentifier("phase15NeedsResearch")
            NavigationLink("继续研究") { ResearchSourceIntakeView(symbol: membership.symbol) }
        case "READY_TO_SELECT":
            Text("已有可选研究条件：\(value.options.count) 条").font(.subheadline)
            ForEach(Array(value.options.enumerated()), id: \.offset) { index, option in
                Button {
                    selectedIndex = index
                    message = nil
                } label: {
                    HStack {
                        Text(option.binding.conditionText).multilineTextAlignment(.leading)
                        Spacer()
                        if selectedIndex == index { Image(systemName: "checkmark.circle.fill") }
                    }
                    .padding(12).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .disabled(saving)
                .accessibilityIdentifier("phase15Option-\(index)")
                if selectedIndex == index {
                    optionDetails(option)
                    Button(saving ? "正在保存…" : "设为正式判断") { showConfirmation = true }
                        .disabled(saving)
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("phase15ConfirmSelected")
                }
            }
        case "BOUND":
            if let lineage = value.currentLineage {
                Text("当前正式判断").font(.headline)
                Text(lineage.currentThesisText).accessibilityIdentifier("phase15CurrentLineageThesis")
                if lineage.source == "OWNER_REVISION" {
                    Text("原始判断 · \(lineage.originalThesisIdentity.conditionText)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("报告 \(lineage.originalThesisIdentity.reportId) · v\(lineage.originalThesisIdentity.reportVersion) · 条件 \(lineage.originalThesisIdentity.conditionIndex + 1)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let option = value.selectedOption { optionDetails(option) }
            if let reasoning = api.boundOperatingReasoning(symbol: membership.symbol) {
                NavigationLink("查看本期研究数据") { CurrentBaseFormationView(membership: membership) }
                NavigationLink("复核与修改判断") { ResearchUnderwritingView(initial: reasoning) }
                NavigationLink("下一步如何验证？") { OperatingResearchQuestionsView(initial: reasoning) }
            } else {
                Text("正式研究上下文待读取；请重新加载后查看本期研究数据。").font(.caption)
            }
            Text("修改已有判断请进入复核页面，原判断和修改历史会保留。")
                .font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("phase15NoOverwrite")
        case "ENDED_REQUIRES_NEW_LINEAGE":
            Text("当前判断已结束。请进入判断复核，明确修订后再建立新的判断。")
                .accessibilityIdentifier("phase15Ended")
            if let lineage = value.currentLineage {
                Text("已结束的判断 · \(lineage.currentThesisText)")
                if lineage.source == "OWNER_REVISION" { Text("原始判断 · \(lineage.originalThesisIdentity.conditionText)").font(.caption).foregroundStyle(.secondary) }
            }
            if let reasoning = api.boundOperatingReasoning(symbol: membership.symbol) {
                NavigationLink("进入正式判断复核") { ResearchReviewView(initial: reasoning) }
            }
        default:
            Text("研究身份或读取暂不可用，请重新读取。").accessibilityIdentifier("phase15Unavailable")
        }
        if let question = value.nextResearchQuestion, !question.isEmpty {
            Text("下一研究问题：\(question)").font(.caption).foregroundStyle(Theme.textSecondary)
        }
    }

    private func optionDetails(_ option: ThesisFormationResponse.Option) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("来源报告 \(option.binding.reportId) · v\(option.binding.reportVersion) · 条件 \(option.binding.conditionIndex + 1)")
                .font(.caption)
            Text(option.reportCreatedAt).font(.caption2).foregroundStyle(.secondary)
            if option.reportStatus == "evidence_insufficient" {
                Text("证据仍不充分 · 尚不能确认这条判断").foregroundStyle(Theme.gold)
                    .accessibilityIdentifier("phase15EvidenceInsufficient")
            }
            Text(option.binding.conditionText).font(.subheadline)
            ForEach(option.supportingEvidence, id: \.self) { Text("支持线索：\($0)") }
            ForEach(option.counterevidence, id: \.self) { Text("反方证据：\($0)") }
            ForEach(option.unknowns, id: \.self) { Text("尚未核实：\($0)") }
            ForEach(option.limitations, id: \.self) { Text("限制：\($0)") }
        }
        .font(.caption).padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
    }

    private func reload() async {
        projection = nil; selectedIndex = nil; message = nil
        do {
            let value = try await fetch()
            projection = value
        } catch { message = (error as NSError).domain }
    }

    private func fetch() async throws -> ThesisFormationResponse {
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = authorization.readToken else { throw NSError(domain: "研究读取授权不可用", code: 401) }
        var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/thesis-formation"))
        request.setValue(token, forHTTPHeaderField: authorization.readHeaderName)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "正式判断条件读取失败", code: 503) }
        let value = try JSONDecoder().decode(ThesisFormationResponse.self, from: data)
        guard value.schemaVersion == "thesis-formation-v1", value.symbol == membership.symbol,
              value.membershipId == membership.id, value.membershipVersion == membership.version,
              value.actorScope.actorId == membership.actorId, value.actorScope.actorType == "user",
              api.selectedSymbol == membership.symbol, authorization == AppEnvironment.researchAuthorizationContext(),
              api.membershipEnvelope?.memberships.contains(where: { $0.id == membership.id && $0.version == membership.version && $0.symbol == membership.symbol }) == true
        else { throw NSError(domain: "正式判断范围已变化，请重新读取", code: 409) }
        return value
    }

    private func confirm() async {
        guard !saving, let value = projection, value.status == "READY_TO_SELECT",
              let index = selectedIndex, value.options.indices.contains(index) else { return }
        saving = true; defer { saving = false }
        let chosen = value.options[index].binding
        do {
            let authorization = AppEnvironment.researchAuthorizationContext()
            guard let token = authorization.writeToken else { throw NSError(domain: "需要明确研究写入授权", code: 401) }
            let body: [String: Any] = ["membershipVersion": value.membershipVersion, "selectedSymbol": value.symbol,
                "baseContextId": value.contextId as Any? ?? NSNull(), "projectionFingerprint": value.projectionFingerprint,
                "option": try JSONSerialization.jsonObject(with: JSONEncoder().encode(chosen)),
                "confirmed": true, "idempotencyKey": requestKey]
            var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/thesis-formation/confirm"))
            request.httpMethod = "POST"; request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                let detail = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                throw NSError(domain: detail?["code"] as? String ?? "正式判断保存失败，请重新读取", code: (response as? HTTPURLResponse)?.statusCode ?? 503)
            }
            let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchContextData>.self, from: data)
            guard write.status == "succeeded", write.data.membershipId == membership.id,
                  write.data.membershipVersion == membership.version, write.data.selectedSymbol == membership.symbol,
                  write.data.operatingModel?.thesisBinding == chosen else {
                throw NSError(domain: "保存回读与所选研究条件不一致", code: 409)
            }
            await api.load(tab: .research, symbol: membership.symbol)
            let fresh = try await fetch()
            guard fresh.status == "BOUND", fresh.currentFormalThesis == chosen, fresh.contextId == write.data.id else {
                throw NSError(domain: "已提交，但最新正式判断尚未核对，请重新读取", code: 503)
            }
            projection = fresh; selectedIndex = nil; requestKey = "thesis-formation-\(UUID().uuidString)"
            message = "正式判断已保存并核对。下一步由你查看本期研究数据。"
        } catch {
            message = (error as NSError).domain
            projection = nil; selectedIndex = nil
        }
    }
}
