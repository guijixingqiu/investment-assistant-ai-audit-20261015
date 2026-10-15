import Foundation
import SwiftUI

struct ResearchBaselineConfirmationResponse: Decodable {
    struct ActorScope: Decodable { let actorType: String; let actorId: String }
    struct CurrentBase: Decodable { let scenarioId: String; let version: Int; let contextId: String; let period: OperatingPeriod; let status: String; let assumptionCount: Int }
    struct Preview: Decodable {
        let originalThesisIdentity: OperatingThesisBinding?
        let thesisLineageId: String?
        let currentContextId: String
        let factSetFingerprint: String
        let seriesFingerprint: String
        let scenarioSetId: String
        let scenarioVersion: Int
        let assumptionFingerprint: String
        let price: Double?
        let priceCurrency: String?
        let priceAsOf: String?
        let quoteIdentity: String?
        let sharesIdentity: String?
        let sharesAsOf: String?
        let fxIdentity: String?
        let fxAsOf: String?
        let testsFingerprint: String?
        let calculationVersion: String
    }
    struct Source: Decodable, Identifiable { let kind: String; let id: String; let label: String; let requirement: OperatingJSON; var selectionId: String { kind + ":" + id } }
    struct Validation: Decodable { let milestone: ReviewMilestone?; let freshness: String?; let evidenceState: String?; let structuredSources: [Source] }
    struct Action: Decodable { let kind: String; let label: String }
    let schemaVersion: String
    let actorScope: ActorScope
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let scenarioPeriodType: String
    let status: String
    let contextId: String?
    let currentThesis: CurrentBaseFormationResponse.Lineage?
    let currentBase: CurrentBase?
    let existingBaseline: UnderwritingBaseline?
    let snapshotPreview: Preview?
    let validation: Validation
    let blockingReasons: [String]
    let warnings: [String]
    let nextOwnerAction: Action
    let generatedAt: String
    let projectionFingerprint: String
}

@MainActor private func fetchBaselineConfirmation(_ membership: CandidateMembershipData, periodType: String) async throws -> ResearchBaselineConfirmationResponse {
    let api = OwnerClientStore.shared, authorization = AppEnvironment.researchAuthorizationContext()
    guard api.selectedSymbol == membership.symbol, let token = authorization.readToken else { throw NSError(domain: "研究读取授权或股票身份不可用", code: 401) }
    var components = URLComponents(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/research-baseline-confirmation"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "periodType", value: periodType)]
    var request = URLRequest(url: components.url!); request.setValue(token, forHTTPHeaderField: authorization.readHeaderName)
    let (data,response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "研究基线工作台暂不可用", code: (response as? HTTPURLResponse)?.statusCode ?? 503) }
    let value = try JSONDecoder().decode(ResearchBaselineConfirmationResponse.self, from: data)
    guard value.schemaVersion == "research-baseline-confirmation-v1", value.actorScope.actorId == membership.actorId,
          value.symbol == membership.symbol, value.membershipId == membership.id, value.membershipVersion == membership.version,
          value.scenarioPeriodType == periodType, api.selectedSymbol == membership.symbol,
          api.membershipEnvelope?.memberships.contains(where: { $0.id == membership.id && $0.version == membership.version && $0.symbol == membership.symbol }) == true,
          authorization == AppEnvironment.researchAuthorizationContext() else { throw NSError(domain: "研究身份或期间已变化，请重新读取", code: 409) }
    return value
}

struct ResearchBaselineActivationEntryView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let membership: CandidateMembershipData
    @State private var value: ResearchBaselineConfirmationResponse?
    var body: some View {
        NavigationLink { ResearchBaselineActivationView(membership: membership) } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text("研究基线与验证").font(.system(size: 14, weight: .semibold))
                Text(value?.nextOwnerAction.label ?? "核对基线与下一验证节点").font(.caption).foregroundStyle(Theme.textSecondary)
                Text("进入研究基线工作台 →").font(.caption).foregroundStyle(Theme.blue)
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).accessibilityIdentifier("phase17ResearchEntry")
            .task(id: "\(membership.id)|\(membership.version)|\(api.selectedSymbol)") {
                value = try? await fetchBaselineConfirmation(membership, periodType: "CURRENT_FY")
            }
    }
}

struct ResearchBaselineActivationView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let membership: CandidateMembershipData
    @State private var periodType: String
    @State private var projection: ResearchBaselineConfirmationResponse?
    @State private var message: String?
    @State private var description = ""
    @State private var expectedEvidence = ""
    @State private var targetDate = ""
    @State private var selectedSource = ""
    @State private var saving = false
    @State private var confirmBaseline = false
    @State private var confirmMilestone = false
    @State private var baselineKey = "phase17-baseline-\(UUID().uuidString)"
    @State private var milestoneKey = "phase17-milestone-\(UUID().uuidString)"
    init(membership: CandidateMembershipData, initialPeriodType: String = "CURRENT_FY") { self.membership = membership; self._periodType = State(initialValue: initialPeriodType) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("研究基线与验证").font(.title2.bold()).accessibilityIdentifier("phase17Title")
                Picker("预测期间", selection: $periodType) { Text("本财年").tag("CURRENT_FY"); Text("下一个报告期").tag("NEXT_REPORTING_PERIOD") }
                    .pickerStyle(.segmented).accessibilityIdentifier("phase17Period")
                if let value = projection {
                    if value.actorScope.actorId.hasPrefix("test-phase17-") { Text("TEST FIXTURE ONLY · 隔离测试数据").font(.caption).foregroundStyle(Theme.gold) }
                    Text(statusTitle(value.status)).font(.headline).foregroundStyle(Theme.gold).accessibilityIdentifier("phase17Status")
                    if let thesis = value.currentThesis { Text("当前正式 Thesis").font(.subheadline.bold()); Text(thesis.currentThesisText); if thesis.source == "OWNER_REVISION" { Text("原始 Thesis · \(thesis.originalThesisIdentity.conditionText)").font(.caption).foregroundStyle(.secondary) } }
                    if let base = value.currentBase { Text("Current Base · v\(base.version) · \(periodType == "CURRENT_FY" ? "本财年" : "下一个报告期")").font(.subheadline.bold()); Text("Owner 假设与来源已冻结在正式 Base；\(base.assumptionCount) 项输入需核对。").font(.caption).foregroundStyle(.secondary) }
                    if let baseline = value.existingBaseline { Text("已保存研究基线 · Base v\(baseline.scenarioVersion)").font(.subheadline.bold()).foregroundStyle(Theme.blue); Text("旧基线保留原事实和市场观察，不自动回填。").font(.caption).foregroundStyle(.secondary) }
                    switch value.status {
                    case "NEEDS_FORMAL_THESIS": NavigationLink("先建立正式 Thesis") { ThesisFormationView(membership: membership) }
                    case "NEEDS_CURRENT_BASE": NavigationLink("先建立 Current Base") { CurrentBaseFormationView(membership: membership, initialPeriodType: periodType) }
                    case "CURRENT_BASE_REVIEW_REQUIRED":
                        Text("Current Base 需要重新审视，不能建立新的研究基线。").foregroundStyle(Theme.gold)
                        if let reasoning = api.boundOperatingReasoning(symbol: membership.symbol) { NavigationLink("进入 Re-underwriting") { ResearchUnderwritingView(initial: reasoning, initialPeriodType: periodType) } }
                    case "UNAVAILABLE": Text("研究身份或数据不可用；重新读取后再继续。").foregroundStyle(Theme.gold)
                    default:
                        if let preview = value.snapshotPreview,
                           value.status == "READY_TO_CONFIRM_BASELINE" || value.status == "BASELINE_CONFIRMED" ||
                           value.status == "ACTIVE" && value.existingBaseline?.scenarioVersion != preview.scenarioVersion { previewSection(preview) }
                        if value.status == "READY_TO_CONFIRM_BASELINE" || value.status == "BASELINE_CONFIRMED" { baselineAction(value) }
                        if value.status == "ACTIVE", let preview = value.snapshotPreview, value.existingBaseline?.scenarioVersion != preview.scenarioVersion { baselineAction(value) }
                        if value.status == "NEEDS_VALIDATION_MILESTONE" || value.status == "BASELINE_CONFIRMED" { validationSection(value) }
                        if value.status == "ACTIVE" { activeSection(value) }
                    }
                    ForEach(value.warnings, id: \.self) { Text($0).font(.caption2).foregroundStyle(.secondary) }
                } else { Text(message ?? "正在读取研究基线…").foregroundStyle(Theme.gold) }
                if let message, projection != nil { Text(message).font(.caption).foregroundStyle(Theme.gold) }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }.navigationTitle("研究基线与验证")
            .task(id: "\(membership.id)|\(membership.version)|\(periodType)|\(api.selectedSymbol)") { await reload() }
            .confirmationDialog("确认保存研究基线？", isPresented: $confirmBaseline, titleVisibility: .visible) {
                Button("确认保存研究基线") { Task { await saveBaseline() } }
                Button("取消", role: .cancel) {}
            } message: { Text(baselineConfirmationText) }
            .confirmationDialog("建立下一验证节点？", isPresented: $confirmMilestone, titleVisibility: .visible) {
                Button("建立下一验证节点") { Task { await saveMilestone() } }
                Button("取消", role: .cancel) {}
            } message: { Text(milestoneConfirmationText) }
    }
    private func statusTitle(_ status: String) -> String { ["NEEDS_FORMAL_THESIS":"正式 Thesis 尚未建立","NEEDS_CURRENT_BASE":"当前期间还缺 Current Base","CURRENT_BASE_REVIEW_REQUIRED":"Current Base 需要重新审视","READY_TO_CONFIRM_BASELINE":"准备确认研究基线","BASELINE_CONFIRMED":"已有研究基线 · 新 Base 可另行确认","NEEDS_VALIDATION_MILESTONE":"下一验证节点尚未建立","ACTIVE":"持续复核已启用","UNAVAILABLE":"工作台暂不可用"][status] ?? "状态不可用" }
    @ViewBuilder private func previewSection(_ preview: ResearchBaselineConfirmationResponse.Preview) -> some View {
        Text("将冻结的研究快照 · 尚未正式保存").font(.headline).accessibilityIdentifier("phase17Preview")
        Text("事实与来源 · Owner 假设 · \(preview.calculationVersion)").font(.caption).foregroundStyle(Theme.blue)
        Text("市场观察：\(preview.price.map { "\($0.formatted()) \(preview.priceCurrency ?? "")" } ?? "UNKNOWN") · \(preview.priceAsOf ?? "日期 UNKNOWN")").font(.caption)
        Text("股本：\(preview.sharesAsOf ?? "UNKNOWN") · FX：\(preview.fxAsOf ?? "UNKNOWN")").font(.caption)
        DisclosureGroup("精确冻结身份与来源") {
            Text("原始 Thesis：\(preview.originalThesisIdentity?.conditionText ?? "UNKNOWN")")
            Text("lineage：\(preview.thesisLineageId ?? "UNKNOWN")")
            Text("Base v\(preview.scenarioVersion) · Context \(preview.currentContextId)")
            Text("事实集：\(preview.factSetFingerprint) · 证据序列：\(preview.seriesFingerprint)")
            Text("假设：\(preview.assumptionFingerprint) · Tests：\(preview.testsFingerprint ?? "UNKNOWN")")
            Text("报价：\(preview.quoteIdentity ?? "UNKNOWN") · 股本：\(preview.sharesIdentity ?? "UNKNOWN") · FX：\(preview.fxIdentity ?? "UNKNOWN")")
        }.font(.caption2)
    }
    @ViewBuilder private func baselineAction(_ value: ResearchBaselineConfirmationResponse) -> some View {
        Button(value.existingBaseline == nil ? "确认保存研究基线" : "确认新的研究基线") { confirmBaseline = true }
            .buttonStyle(.borderedProminent).disabled(saving || value.snapshotPreview == nil || !value.blockingReasons.isEmpty)
            .accessibilityIdentifier("phase17ConfirmBaseline")
        Text("只冻结一次研究快照；不会自动建立验证节点。").font(.caption).foregroundStyle(.secondary)
    }
    @ViewBuilder private func validationSection(_ value: ResearchBaselineConfirmationResponse) -> some View {
        if value.existingBaseline != nil {
            Text("下一验证节点").font(.headline)
            TextField("下一次要核验什么", text: $description, axis: .vertical).accessibilityIdentifier("phase17Description")
            TextField("预期出现的证据", text: $expectedEvidence, axis: .vertical).accessibilityIdentifier("phase17ExpectedEvidence")
            TextField("可选检查日期 YYYY-MM-DD", text: $targetDate).accessibilityIdentifier("phase17TargetDate")
            Picker("结构化来源（最多一项）", selection: $selectedSource) {
                Text("暂不绑定 · 证据 UNKNOWN").tag("")
                ForEach(value.validation.structuredSources) { source in Text(source.label).tag(source.selectionId) }
            }.accessibilityIdentifier("phase17SourcePicker")
            if let source = chosenSource(value) { sourcePreview(source) }
            else { Text("自由文字节点可启用持续复核；不会根据语义相似自动判定证据已到。").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("phase17FreeTextUnknown") }
            Button("建立下一验证节点") { confirmMilestone = true }
                .buttonStyle(.borderedProminent).disabled(saving || description.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || expectedEvidence.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                .accessibilityIdentifier("phase17CreateMilestone")
        }
    }
    @ViewBuilder private func sourcePreview(_ source: ResearchBaselineConfirmationResponse.Source) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("精确证据要求 · \(source.label)").font(.caption.bold())
            Text("指标：\(exactValue(source.requirement,"metric")) · 期间：\(exactValue(source.requirement,"period"))")
            Text("单位：\(exactValue(source.requirement,"unit")) · 币种：\(exactValue(source.requirement,"currency"))")
            Text("范围：\(exactValue(source.requirement,"businessScope")) / \(exactValue(source.requirement,"accountingScope"))")
            Text("计量口径：\(exactValue(source.requirement,"measurementBasis"))")
        }.font(.caption).foregroundStyle(Theme.blue).accessibilityElement(children: .combine).accessibilityIdentifier("phase17StructuredPreview")
    }
    private func exactValue(_ requirement: OperatingJSON, _ key: String) -> String {
        guard case .object(let fields) = requirement, case .object(let rule)? = fields[key], let value = rule["value"] else { return "UNKNOWN" }
        switch value {
        case .string(let text): return text
        case .number(let number): return number.formatted()
        case .null: return "UNKNOWN"
        case .object(let period):
            let start: String = { if case .string(let text)? = period["start"] { return text }; return "" }()
            let end: String = { if case .string(let text)? = period["end"] { return text }; return "UNKNOWN" }()
            return start.isEmpty ? end : "\(start) 至 \(end)"
        default: return "请查看精确来源"
        }
    }
    @ViewBuilder private func activeSection(_ value: ResearchBaselineConfirmationResponse) -> some View {
        Text("下一验证：\(value.validation.milestone?.description ?? "正在核对")").font(.subheadline.bold())
        Text("当前：\(value.validation.freshness ?? "UNKNOWN") · 证据：\(value.validation.evidenceState ?? "UNKNOWN")").foregroundStyle(Theme.blue).accessibilityIdentifier("phase17Freshness")
        if let reasoning = api.boundOperatingReasoning(symbol: membership.symbol) { NavigationLink("查看 Phase 12 正式复核") { ResearchReviewView(initial: reasoning, initialPeriodType: periodType) } }
    }
    private func chosenSource(_ value: ResearchBaselineConfirmationResponse) -> ResearchBaselineConfirmationResponse.Source? { value.validation.structuredSources.first(where: { $0.selectionId == selectedSource }) }
    private var baselineConfirmationText: String {
        guard let value = projection, let preview = value.snapshotPreview else { return "研究快照待读取" }
        return "期间：\(periodType == "CURRENT_FY" ? "本财年" : "下一个报告期")；Current Base v\(preview.scenarioVersion)；当前 Thesis：\(value.currentThesis?.currentThesisText ?? "UNKNOWN")；事实、假设、计算版本和市场观察将冻结。不会自动建立验证节点或投资 Decision。"
    }
    private var milestoneConfirmationText: String {
        guard let value = projection else { return "验证节点待读取" }
        return "基线 Base v\(value.existingBaseline?.scenarioVersion ?? 0)；\(description)；预期证据：\(expectedEvidence)；\(chosenSource(value)?.label ?? "自由文字 · 证据 UNKNOWN")。"
    }
    private func reload() async {
        do { projection = try await fetchBaselineConfirmation(membership, periodType: periodType); message = nil }
        catch { projection = nil; message = (error as NSError).domain }
    }
    private func post(_ suffix: String, body: [String: Any]) async throws -> Data {
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = authorization.writeToken, api.selectedSymbol == membership.symbol,
              api.membershipEnvelope?.memberships.contains(where: { $0.id == membership.id && $0.version == membership.version && $0.symbol == membership.symbol }) == true else { throw NSError(domain: "研究写入授权或股票身份不可用", code: 401) }
        var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/\(suffix)"))
        request.httpMethod = "POST"; request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data,response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, authorization == AppEnvironment.researchAuthorizationContext(), api.selectedSymbol == membership.symbol else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw NSError(domain: object?["message"] as? String ?? "研究确认失败，请重新读取", code: (response as? HTTPURLResponse)?.statusCode ?? 503)
        }
        return data
    }
    private func saveBaseline() async {
        guard let old = projection, let preview = old.snapshotPreview, old.blockingReasons.isEmpty,
              old.status == "READY_TO_CONFIRM_BASELINE" || old.status == "BASELINE_CONFIRMED" || old.status == "ACTIVE" && old.existingBaseline?.scenarioVersion != preview.scenarioVersion else { message = "研究基线条件已变化，请重新读取"; return }
        saving = true; defer { saving = false }
        do {
            let fresh = try await fetchBaselineConfirmation(membership, periodType: periodType)
            guard fresh.projectionFingerprint == old.projectionFingerprint, fresh.snapshotPreview?.scenarioSetId == preview.scenarioSetId,
                  fresh.snapshotPreview?.scenarioVersion == preview.scenarioVersion, fresh.currentThesis?.lineageId == old.currentThesis?.lineageId else { throw NSError(domain: "事实、Thesis 或 Base 已变化，请重新读取", code: 409) }
            let data = try await post("research-underwriting/baselines", body:["scenarioVersion":preview.scenarioVersion,"scenarioPeriodType":periodType,"confirmed":true,"idempotencyKey":baselineKey])
            let saved = try JSONDecoder().decode(UnderwritingBaseline.self, from: data)
            let after = try await fetchBaselineConfirmation(membership, periodType: periodType)
            guard after.existingBaseline?.baselineId == saved.baselineId, after.existingBaseline?.scenarioVersion == preview.scenarioVersion else { throw NSError(domain: "基线保存后身份尚未核对，请重新读取", code: 503) }
            projection = after; baselineKey = "phase17-baseline-\(UUID().uuidString)"; message = "研究基线已显式保存；下一验证节点尚未建立。"
        } catch { message = (error as NSError).domain }
    }
    private func saveMilestone() async {
        guard let old = projection, let baseline = old.existingBaseline,
              old.status == "NEEDS_VALIDATION_MILESTONE" || old.status == "BASELINE_CONFIRMED",
              let lineage = baseline.thesisLineageId, let contextId = old.contextId else { message = "研究基线或 Thesis 已变化，请重新读取"; return }
        saving = true; defer { saving = false }
        do {
            let fresh = try await fetchBaselineConfirmation(membership, periodType: periodType)
            guard fresh.projectionFingerprint == old.projectionFingerprint, fresh.existingBaseline?.baselineId == baseline.baselineId,
                  fresh.currentThesis?.lineageId == lineage, fresh.contextId == contextId else { throw NSError(domain: "基线、期间或 Thesis 已变化，请重新读取", code: 409) }
            let source = chosenSource(old)
            let direct: Any = source?.kind == "DIRECT_REQUIREMENT" ? try JSONSerialization.jsonObject(with: JSONEncoder().encode(source!.requirement)) : NSNull()
            let body: [String: Any] = ["membershipVersion":membership.version,"scenarioPeriodType":periodType,"baselineId":baseline.baselineId,"contextId":contextId,"thesisLineageId":lineage,
                "description":description.trimmingCharacters(in: .whitespacesAndNewlines),"expectedEvidence":expectedEvidence.trimmingCharacters(in: .whitespacesAndNewlines),"requirement":direct,
                "linkedQuestionIds":source?.kind == "RESEARCH_QUESTION" ? [source!.id] : [],"linkedThesisTestIds":source?.kind == "THESIS_TEST" ? [source!.id] : [],"targetDate":targetDate.isEmpty ? NSNull() : targetDate as Any,
                "confirmed":true,"idempotencyKey":milestoneKey]
            let data = try await post("research-review/milestones",body:body)
            let saved = try JSONDecoder().decode(ReviewMilestone.self, from: data)
            let after = try await fetchBaselineConfirmation(membership, periodType: periodType)
            guard after.status == "ACTIVE", after.validation.milestone?.milestoneId == saved.milestoneId else { throw NSError(domain: "验证节点保存后状态尚未核对，请重新读取", code: 503) }
            projection = after; milestoneKey = "phase17-milestone-\(UUID().uuidString)"; message = "持续复核已启用；当前状态以 Phase 12 正式投影为准。"
        } catch { message = (error as NSError).domain }
    }
}
