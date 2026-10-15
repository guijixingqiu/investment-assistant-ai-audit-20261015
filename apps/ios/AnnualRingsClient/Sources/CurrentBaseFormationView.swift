import Foundation
import SwiftUI

struct CurrentBaseFormationResponse: Decodable {
    struct ActorScope: Decodable { let actorType: String; let actorId: String }
    struct Lineage: Decodable { let state: String; let lineageId: String; let currentThesisText: String; let source: String; let originalThesisIdentity: OperatingThesisBinding }
    struct SourceLead: Decodable, Identifiable { let id: String; let metric: String; let category: String; let value: Double; let unit: String; let currency: String?; let period: OperatingPeriod; let periodMatchesDraft: Bool; let sourceUrl: String; let publishedAt: String; let limitation: String }
    struct Input: Decodable, Identifiable { let variable: String; let classification: String; let value: Double?; let unit: String; let currency: String?; let period: OperatingPeriod?; let reason: String; let basedOnFactIds: [String]; let basedOnGuidanceIds: [String]; let sourceLeads: [SourceLead]; var id: String { variable } }
    struct Preview: Decodable { let draftOnly: Bool; let calculationVersion: String; let status: String; let calculations: [UnderwritingCalculation]; let revenue: Double?; let normalizedProfit: Double?; let equityValue: Double?; let shares: Double?; let perShareValue: Double?; let missing: [String] }
    struct Existing: Decodable { let scenarioId: String; let version: Int; let period: OperatingPeriod; let status: String; let assumptionCount: Int; let normalizedProfit: Double? }
    struct Action: Decodable { let kind: String; let label: String }
    let schemaVersion: String; let actorScope: ActorScope; let symbol: String; let membershipId: String; let membershipVersion: Int; let scenarioPeriodType: String
    let status: String; let contextId: String?; let formalThesis: Lineage?; let inputs: [Input]; let calculationPreview: Preview; let blockingUnknowns: [String]; let warnings: [String]; let existingCurrentBase: Existing?; let nextOwnerAction: Action; let generatedAt: String; let projectionFingerprint: String
}

@MainActor private func fetchCurrentBaseFormation(_ membership: CandidateMembershipData, periodType: String) async throws -> CurrentBaseFormationResponse {
    let api = OwnerClientStore.shared, authorization = AppEnvironment.researchAuthorizationContext()
    guard api.selectedSymbol == membership.symbol, let token = authorization.readToken else { throw NSError(domain: "研究读取授权或股票身份不可用", code: 401) }
    var components = URLComponents(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/current-base-formation"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "periodType", value: periodType)]
    var request = URLRequest(url: components.url!); request.setValue(token, forHTTPHeaderField: authorization.readHeaderName)
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "Current Base 工作台暂不可用", code: (response as? HTTPURLResponse)?.statusCode ?? 503) }
    let value = try JSONDecoder().decode(CurrentBaseFormationResponse.self, from: data)
    guard value.schemaVersion == "current-base-formation-v1", value.actorScope.actorId == membership.actorId,
          value.symbol == membership.symbol, value.membershipId == membership.id, value.membershipVersion == membership.version,
          value.scenarioPeriodType == periodType, api.selectedSymbol == membership.symbol,
          api.membershipEnvelope?.memberships.contains(where: { $0.id == membership.id && $0.version == membership.version && $0.symbol == membership.symbol }) == true,
          authorization == AppEnvironment.researchAuthorizationContext() else { throw NSError(domain: "研究身份或期间已变化，请重新读取", code: 409) }
    return value
}

struct CurrentBaseFormationEntryView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let membership: CandidateMembershipData
    @State private var value: CurrentBaseFormationResponse?
    var body: some View {
        NavigationLink { CurrentBaseFormationView(membership: membership) } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text("Current Base").font(.system(size: 14, weight: .semibold))
                Text(value?.status == "NEEDS_FORMAL_THESIS" ? "先建立正式 Thesis" : value?.status == "CURRENT_BASE_SAVED" ? "当前正式版本已保存" : value?.status == "CURRENT_BASE_REVIEW_REQUIRED" ? "当前 Base 需要重新审视" : "尚未建立 · 查看事实、假设与 UNKNOWN")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                if let missing = value?.blockingUnknowns, !missing.isEmpty { Text("仍缺：" + missing.prefix(2).joined(separator: "；")).font(.caption).foregroundStyle(Theme.gold).lineLimit(2) }
                Text("进入 Current Base 工作台 →").font(.caption).foregroundStyle(Theme.blue)
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).accessibilityIdentifier("phase16ResearchEntry")
            .task(id: "\(membership.id)|\(membership.version)|\(api.selectedSymbol)") {
                value = try? await fetchCurrentBaseFormation(membership, periodType: "CURRENT_FY")
            }
    }
}

struct CurrentBaseFormationView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let membership: CandidateMembershipData
    @State private var periodType: String
    @State private var projection: CurrentBaseFormationResponse?
    @State private var message: String?
    @State private var editingVariable: String?
    @State private var assumptionValue = ""
    @State private var assumptionReason = ""
    @State private var saving = false
    @State private var showSaveConfirmation = false
    @State private var requestKey = "phase16-base-\(UUID().uuidString)"
    init(membership: CandidateMembershipData, initialPeriodType: String = "CURRENT_FY") { self.membership = membership; self._periodType = State(initialValue: initialPeriodType) }
    private var bound: ResearchOperatingReasoning? { api.boundOperatingReasoning(symbol: membership.symbol) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Current Base 工作台").font(.title2.bold()).accessibilityIdentifier("phase16Title")
                Picker("预测期间", selection: $periodType) { Text("本财年").tag("CURRENT_FY"); Text("下一个报告期").tag("NEXT_REPORTING_PERIOD") }
                    .pickerStyle(.segmented).accessibilityIdentifier("phase16Period")
                if let value = projection {
                    if value.actorScope.actorId.hasPrefix("test-phase16-") { Text("TEST FIXTURE ONLY · 隔离测试数据").font(.caption).foregroundStyle(Theme.gold) }
                    Text(statusTitle(value.status)).font(.headline).foregroundStyle(Theme.gold).accessibilityIdentifier("phase16Status")
                    if let lineage = value.formalThesis {
                        Text("当前正式 Thesis").font(.subheadline.bold())
                        Text(lineage.currentThesisText).accessibilityIdentifier("phase16CurrentThesis")
                        if lineage.source == "OWNER_REVISION" { Text("原始 Thesis · \(lineage.originalThesisIdentity.conditionText)").font(.caption).foregroundStyle(.secondary) }
                    }
                    if value.status == "NEEDS_FORMAL_THESIS" {
                        NavigationLink("先选择正式 Thesis") { ThesisFormationView(membership: membership) }
                    } else if value.status == "UNAVAILABLE" {
                        Text("研究身份或数据不可用；重新读取后再继续。").foregroundStyle(Theme.gold)
                    } else {
                        if let existing = value.existingCurrentBase { existingSection(existing, value) }
                        else { missingSection(value); inputBridge(value); previewSection(value); saveSection(value) }
                    }
                    ForEach(value.warnings, id: \.self) { warning in Text(warning).font(.caption).foregroundStyle(.secondary) }
                } else { Text(message ?? "正在读取 Current Base…").foregroundStyle(Theme.gold) }
                if let message, projection != nil { Text(message).font(.caption).foregroundStyle(Theme.gold) }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }.navigationTitle("Current Base")
            .task(id: "\(membership.id)|\(membership.version)|\(periodType)|\(api.selectedSymbol)") { await reload() }
            .confirmationDialog("正式保存 Current Base？", isPresented: $showSaveConfirmation, titleVisibility: .visible) {
                Button("正式保存 Current Base") { Task { await saveFormalBase() } }
                Button("取消", role: .cancel) {}
            } message: { Text(confirmationSummary) }
    }
    private var confirmationSummary: String {
        guard let value = projection else { return "研究状态待读取" }
        let owner = value.inputs.filter { $0.classification == "OWNER_ASSUMPTION" }.map { variableTitle($0.variable) }
        let facts = value.inputs.flatMap(\.basedOnFactIds).count, guidance = value.inputs.flatMap(\.basedOnGuidanceIds).count
        let currency = bound?.model.scenarios.first(where: { $0.name == "base" })?.currency
        let earnings = value.calculationPreview.normalizedProfit.map { operatingValue($0, currency: currency) } ?? "UNKNOWN"
        return "期间：\(periodType == "CURRENT_FY" ? "本财年" : "下一个报告期")；当前 Thesis：\(value.formalThesis?.currentThesisText ?? "UNKNOWN")；Owner 假设：\(owner.joined(separator: "、"))；事实依赖 \(facts) 项、Guidance 依赖 \(guidance) 项；剩余 UNKNOWN \(value.blockingUnknowns.count) 项；\(value.calculationPreview.calculationVersion)；正常化利润预览：\(earnings)。不会自动建立 Baseline 或投资 Decision。"
    }
    private func statusTitle(_ status: String) -> String { ["NEEDS_FORMAL_THESIS":"正式 Thesis 尚未建立","READY_FOR_INPUT":"等待明确输入","BLOCKED_BY_UNKNOWN":"关键输入仍为 UNKNOWN","READY_TO_SAVE":"草稿完整 · 待你正式确认","CURRENT_BASE_SAVED":"当前正式 Current Base 已保存","CURRENT_BASE_REVIEW_REQUIRED":"当前 Base 需要重新审视","UNAVAILABLE":"工作台暂不可用"][status] ?? "状态不可用" }
    private func variableTitle(_ variable: String) -> String { ["sales_volume":"销量","asp":"ASP / 产品结构","automotive_revenue":"汽车收入","other_revenue":"其他收入","revenue":"总收入","gross_margin":"毛利率","gross_profit":"毛利","opex":"费用","net_adjustments":"正常化调整","normalized_profit":"正常化利润","shares":"股本","fx":"汇率","pe":"Owner PE"][variable] ?? variable }
    private func classTitle(_ category: String) -> String { ["OBSERVED_FACT":"事实","GUIDANCE":"管理层指引","OWNER_ASSUMPTION":"Owner 假设","DETERMINISTIC":"确定性计算","UNKNOWN":"UNKNOWN"][category] ?? "UNKNOWN" }
    private func blockerTitle(_ reason: String) -> String {
        if reason.contains("explicit business and accounting scope") { return "需要明确业务与会计范围" }
        if reason.contains("group total revenue requires") { return "总收入缺口：需明确总收入或其他收入" }
        if reason.contains("normalized_profit") { return "正常化利润缺少上游输入" }
        if reason.contains("Owner PE assumption") { return "需要 Owner 明确 PE" }
        if reason.contains("dated, source-bound shares") { return "需要已确认且有日期的股本参考" }
        if reason.contains("explicit dated FX") { return "需要有日期的汇率换算" }
        if reason.contains("source cutoff mismatch") { return "来源截止时间不一致，需核对" }
        if reason.hasPrefix("所选期间") || reason.hasPrefix("股本类别") { return reason }
        return "计算条件仍不完整，请查看下方输入与公式"
    }
    @ViewBuilder private func existingSection(_ existing: CurrentBaseFormationResponse.Existing, _ value: CurrentBaseFormationResponse) -> some View {
        Text("当前正式 Current Base · v\(existing.version) · \(periodType == "CURRENT_FY" ? "本财年" : "下一个报告期")").font(.headline)
        Text("假设 \(existing.assumptionCount) 项 · 正常化利润 \(existing.normalizedProfit.map { operatingValue($0, currency: bound?.model.scenarios.first(where: { $0.name == "base" })?.currency) } ?? "需按原计算重算")")
            .font(.caption).foregroundStyle(.secondary)
        if value.status == "CURRENT_BASE_REVIEW_REQUIRED" { Text("当前 Base 需要重新审视；初次保存入口已关闭。").foregroundStyle(Theme.gold) }
        if let reasoning = bound { NavigationLink(value.status == "CURRENT_BASE_REVIEW_REQUIRED" ? "进入 Re-underwriting" : "查看 Current Base / 新草稿") { ResearchUnderwritingView(initial: reasoning, initialPeriodType: periodType) } }
    }
    @ViewBuilder private func missingSection(_ value: CurrentBaseFormationResponse) -> some View {
        if value.blockingUnknowns.isEmpty { Text("必要输入已核对；仍需正式确认保存。").foregroundStyle(Theme.blue) }
        else {
            Text("还缺 \(value.blockingUnknowns.count) 项").font(.headline)
            ForEach(value.blockingUnknowns, id: \.self) { item in Text("• " + blockerTitle(item)).font(.caption).foregroundStyle(Theme.gold) }
            Text("ASP UNKNOWN → 收入预测可能 UNKNOWN；毛利率 UNKNOWN → 毛利与正常化利润可能 UNKNOWN。销量变化不能直接代表利润变化。")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
    @ViewBuilder private func inputBridge(_ value: CurrentBaseFormationResponse) -> some View {
        Text("经营到盈利的传导").font(.headline)
        Text("销量 → ASP / 产品结构 → 汽车收入 → 其他收入 → 总收入 → 毛利率 → 毛利 → 费用 → 正常化利润 → 股本 / FX / PE")
            .font(.caption).foregroundStyle(Theme.blue)
        let missing = value.inputs.filter { $0.classification == "UNKNOWN" }
        let completed = value.inputs.filter { $0.classification != "UNKNOWN" }
        ForEach(missing) { input in inputRow(input) }
        if !completed.isEmpty {
            DisclosureGroup("已具备 / 已明确输入（\(completed.count) 项）") {
                ForEach(completed) { input in inputRow(input) }
            }.accessibilityIdentifier("phase16CompletedInputs")
        }
        if let reasoning = bound { NavigationLink("展开完整模型编辑：期间、范围、其他收入、股本与 FX") { OperatingModelEditor(initial: reasoning) }.font(.caption) }
    }
    @ViewBuilder private func inputRow(_ input: CurrentBaseFormationResponse.Input) -> some View {
            VStack(alignment: .leading, spacing: 5) {
                HStack { Text(variableTitle(input.variable)).font(.subheadline.bold()); Spacer(); Text(classTitle(input.classification)).font(.caption).foregroundStyle(input.classification == "UNKNOWN" ? Theme.gold : Theme.blue) }
                Text(input.value.map { number in
                    if input.variable == "fx", let fx = bound?.model.fx { return "\(number.formatted()) \(fx.from) → \(fx.to) · \(fx.asOf)" }
                    return operatingValue(number, unit: input.unit, currency: input.currency)
                } ?? "UNKNOWN").font(.caption)
                if !input.reason.isEmpty { Text(input.reason).font(.caption2).foregroundStyle(.secondary) }
                if !input.sourceLeads.isEmpty { DisclosureGroup("查看精确来源与期间") {
                    ForEach(input.sourceLeads) { lead in
                        Text("\(classTitle(lead.category)) · \(lead.period.end) · \(lead.periodMatchesDraft ? "期间匹配" : "历史/其他期间参考，未自动填入")").font(.caption)
                        if let fact = bound?.facts.first(where: { $0.id == lead.id }) { NavigationLink("查看来源、口径与引文") { OperatingFactDetail(fact: fact) } }
                    }
                }.font(.caption) }
                if input.classification == "UNKNOWN", !["shares","fx","other_revenue"].contains(input.variable) {
                    Button("明确填写 Owner 假设") { editingVariable = input.variable; assumptionValue = ""; assumptionReason = "" }
                        .font(.caption).accessibilityIdentifier("phase16Edit-\(input.variable)")
                }
                if editingVariable == input.variable { assumptionEditor(input) }
            }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
    }
    @ViewBuilder private func assumptionEditor(_ input: CurrentBaseFormationResponse.Input) -> some View {
        TextField("明确数值 · \(input.unit)", text: $assumptionValue).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("phase16AssumptionValue")
        TextField("Owner 假设理由（必填）", text: $assumptionReason, axis: .vertical).accessibilityIdentifier("phase16AssumptionReason")
        Button("保存研究草稿假设") { Task { await saveDraftAssumption(input.variable) } }
            .disabled(saving || assumptionReason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || Double(assumptionValue) == nil)
            .accessibilityIdentifier("phase16SaveDraftAssumption")
        Text("仅保存 Research Context 草稿；尚未建立正式 Current Base。").font(.caption2).foregroundStyle(.secondary)
    }
    @ViewBuilder private func previewSection(_ value: CurrentBaseFormationResponse) -> some View {
        Text("确定性预览 · 草稿 / 尚未正式保存").font(.headline).accessibilityIdentifier("phase16DraftPreview")
        Text("总收入：\(value.calculationPreview.revenue.map { operatingValue($0, currency: bound?.model.scenarios.first(where: { $0.name == "base" })?.currency) } ?? "UNKNOWN") · 正常化利润：\(value.calculationPreview.normalizedProfit.map { operatingValue($0, currency: bound?.model.scenarios.first(where: { $0.name == "base" })?.currency) } ?? "UNKNOWN")")
            .font(.caption)
        DisclosureGroup("公式与计算版本") {
            Text(value.calculationPreview.calculationVersion).font(.caption2)
            ForEach(value.calculationPreview.calculations) { item in Text("\(variableTitle(item.metric)) · \(item.formula) · \(item.value.formatted())").font(.caption) }
        }.font(.caption)
    }
    @ViewBuilder private func saveSection(_ value: CurrentBaseFormationResponse) -> some View {
        Button("核对并正式保存 Current Base") { showSaveConfirmation = true }
            .buttonStyle(.borderedProminent).disabled(saving || value.status != "READY_TO_SAVE" || !value.blockingUnknowns.isEmpty)
            .accessibilityIdentifier("phase16SaveCurrentBase")
        Text("初次保存只产生追加式 Scenario Version；Baseline 和 Milestone 仍需分别确认。").font(.caption).foregroundStyle(.secondary)
    }
    private func reload() async {
        do { projection = try await fetchCurrentBaseFormation(membership, periodType: periodType); message = nil; editingVariable = nil }
        catch { projection = nil; message = (error as NSError).domain }
    }
    private func saveDraftAssumption(_ variable: String) async {
        guard let old = projection, old.status != "CURRENT_BASE_SAVED", old.status != "CURRENT_BASE_REVIEW_REQUIRED",
              let reasoning = bound, reasoning.contextId == old.contextId,
              let number = Double(assumptionValue), number.isFinite, let index = reasoning.model.scenarios.firstIndex(where: { $0.name == "base" }),
              reasoning.model.scenarios[index].scenarioPeriodType == periodType,
              var input = reasoning.model.scenarios[index].inputs[variable] else { message = "草稿身份或期间已变化，请重新读取"; return }
        let reason = assumptionReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard reason.count >= 3, number >= 0, (variable != "gross_margin" || number <= 1), (variable != "pe" || number > 0) else { message = "数值或理由不符合当前模型口径"; return }
        saving = true; defer { saving = false }
        do {
            let fresh = try await fetchCurrentBaseFormation(membership, periodType: periodType)
            guard fresh.projectionFingerprint == old.projectionFingerprint, fresh.contextId == old.contextId, fresh.formalThesis?.lineageId == old.formalThesis?.lineageId else { throw NSError(domain: "研究事实或 Thesis 已变化，请重新读取", code: 409) }
            var model = reasoning.model
            input.value = number; input.origin = "owner_assumption"; input.sourceValueId = nil; input.note = reason
            input.rationale = OperatingAssumptionRationale(reason: reason, basedOnFactIds: [], confidence: "low")
            model.scenarios[index].inputs[variable] = input
            try await api.saveOperatingModel(model, for: reasoning, idempotencyKey: "phase16-draft-\(UUID().uuidString)")
            await reload(); message = "Owner 假设已保存为研究草稿；正式 Current Base 尚未建立。"
        } catch { message = (error as NSError).domain }
    }
    private func saveFormalBase() async {
        guard let old = projection, old.status == "READY_TO_SAVE", old.blockingUnknowns.isEmpty, let contextId = old.contextId else { message = "草稿仍有阻断项，请重新核对"; return }
        saving = true; defer { saving = false }
        do {
            let fresh = try await fetchCurrentBaseFormation(membership, periodType: periodType)
            guard fresh.status == "READY_TO_SAVE", fresh.projectionFingerprint == old.projectionFingerprint, fresh.contextId == contextId,
                  fresh.formalThesis?.lineageId == old.formalThesis?.lineageId, fresh.existingCurrentBase == nil else { throw NSError(domain: "期间、Thesis 或草稿版本已变化，请重新读取", code: 409) }
            let authorization = AppEnvironment.researchAuthorizationContext()
            guard let token = authorization.writeToken, api.selectedSymbol == membership.symbol else { throw NSError(domain: "研究写入授权或股票身份不可用", code: 401) }
            var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/research-underwriting/base-versions"))
            request.httpMethod = "POST"; request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["contextId": contextId,"membershipVersion": membership.version,"scenarioPeriodType": periodType,"changeReason": "Owner explicitly confirmed initial Current Base in Phase 16 workbench","idempotencyKey": requestKey])
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                throw NSError(domain: object?["message"] as? String ?? "Current Base 保存失败", code: (response as? HTTPURLResponse)?.statusCode ?? 503)
            }
            let saved = try JSONDecoder().decode(UnderwritingScenarioVersion.self, from: data)
            guard saved.scenarioPeriodType == periodType, saved.version >= 1, authorization == AppEnvironment.researchAuthorizationContext(), api.selectedSymbol == membership.symbol else { throw NSError(domain: "Base 保存回读的期间或身份不符", code: 409) }
            await api.load(tab: .research, symbol: membership.symbol)
            let after = try await fetchCurrentBaseFormation(membership, periodType: periodType)
            guard after.status == "CURRENT_BASE_SAVED", after.existingCurrentBase?.version == saved.version else { throw NSError(domain: "保存后 Current Base 尚未核对，请重新读取", code: 503) }
            projection = after; requestKey = "phase16-base-\(UUID().uuidString)"; message = "正式 Current Base v\(saved.version) 已保存；Baseline 尚未自动建立。"
        } catch { message = (error as NSError).domain }
    }
}
