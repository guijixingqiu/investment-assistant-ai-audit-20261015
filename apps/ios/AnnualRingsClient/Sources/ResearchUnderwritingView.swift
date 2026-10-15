import Foundation
import SwiftUI

struct UnderwritingAssumption: Decodable, Identifiable {
    let assumptionId: String
    let variable: String
    let value: Double?
    let unit: String
    let currency: String?
    let origin: String
    let reason: String
    let basedOnFactIds: [String]
    let basedOnGuidanceIds: [String]
    var id: String { assumptionId }
}
struct UnderwritingScenarioVersion: Decodable {
    let scenarioId: String
    let version: Int
    let scenarioPeriodType: String
    let period: OperatingPeriod
    let assumptions: [UnderwritingAssumption]
    let changeReason: String
    let createdAt: String
    var modelCurrency: String? { assumptions.first(where: { $0.currency != nil })?.currency }
}
struct UnderwritingBaseline: Decodable {
    let baselineId: String
    let thesisLineageId: String?
    let scenarioVersion: Int
    let price: Double?
    let priceCurrency: String?
    let priceAsOf: String?
    let createdAt: String
}
struct UnderwritingGap: Decodable {
    struct Inputs: Decodable { let price: String?; let priceAsOf: String?; let shares: String?; let sharesAsOf: String?; let fx: String?; let fxAsOf: String?; let calculationVersion: String }
    let status: String
    let ownerBase: Double?
    let conditionalMarketImplied: Double?
    let absoluteGap: Double?
    let percentageGap: Double?
    let currency: String?
    let centralPE: Double?
    let peAssumptionId: String?
    let inputIdentities: Inputs
    let reasons: [String]
}
struct UnderwritingWhatMustBeTrue: Decodable {
    let status: String
    let normalizedEarningsRequired: Double?
    let revenueRequired: Double?
    let grossMarginRequired: Double?
    let fixedInputs: [String]
    let freeVariable: String?
    let solvedVariable: String?
    let assumptionIds: [String]
    let calculationVersion: String
    let explanation: String
}
struct UnderwritingPriceChange: Decodable { let baselinePrice: Double; let baselineAsOf: String; let currentPrice: Double; let currentAsOf: String; let currency: String; let changeRatio: Double }
struct UnderwritingBaselineComparison: Decodable { let factsChanged: Bool; let assumptionsChanged: Bool; let scenarioChanged: Bool; let priceChanged: Bool; let sharesChanged: Bool; let fxChanged: Bool; let testsChanged: Bool; let expectationGapChanged: Bool? }
struct UnderwritingNextEvent: Codable { let description: String; let expectedEvidence: String; let targetDate: String? }
struct UnderwritingDraft: Decodable {
    let status: String
    let originalThesis: OperatingThesisBinding?
    let baselineId: String?
    let newFactsSinceBaseline: [String]
    let counterevidence: [String]
    let unknowns: [String]
    let nextValidationEvent: UnderwritingNextEvent
    let thesisDrift: Drift
    struct Drift: Decodable { let changed: Bool; let oldReason: String; let newReason: String; let addedAssumptions: [String]; let removedAssumptions: [String]; let changedValidationEvents: Bool }
}
struct UnderwritingScenarioDiff: Decodable {
    struct Change: Decodable, Identifiable { let variable: String; let before: Double?; let after: Double?; let kind: String; let reason: String; var id: String { variable } }
    let fromVersion: Int?
    let toVersion: Int
    let assumptionChanges: [Change]
    let newFactIds: [String]
    let guidanceChanges: [String]
    let calculationChanged: Bool
    let marketInputChanges: [String]
}
struct UnderwritingCalculation: Decodable, Identifiable {
    let metric: String
    let value: Double
    let formula: String
    let derivationMethod: String
    var id: String { metric }
}
struct UnderwritingThesisAction: Decodable, Identifiable { let actionId: String; let action: String; let lineageId: String; let previousLineageId: String?; let newThesis: String?; let ownerReason: String; let endedAt: String?; let confirmedAt: String; var id: String { actionId } }
struct UnderwritingProjection: Decodable {
    struct Implied: Decodable { let status: String; let normalizedEarnings: Double?; let currency: String?; let assumedPE: Double?; let reason: String }
    struct Sensitivity: Decodable, Identifiable { let pe: Double; let perShareValue: Double?; var id: Double { pe } }
    struct Proof: Decodable { let calculationVersion: String; let formulaIdentity: String; let inputsFingerprint: String; let resultFingerprint: String }
    let status: String
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let currentBase: UnderwritingScenarioVersion?
    let previousBase: UnderwritingScenarioVersion?
    let baseline: UnderwritingBaseline?
    let draftBaseStatus: String?
    let currentBaseStatus: String?
    let baselineComparison: UnderwritingBaselineComparison?
    let scenarioDiff: UnderwritingScenarioDiff?
    let deterministicCalculations: [UnderwritingCalculation]?
    let conditionalImplied: Implied?
    let expectationGap: UnderwritingGap?
    let whatMustBeTrue: UnderwritingWhatMustBeTrue?
    let peSensitivity: [Sensitivity]?
    let priceSinceBaseline: UnderwritingPriceChange?
    let reunderwritingDraft: UnderwritingDraft?
    let thesisActions: [UnderwritingThesisAction]?
    let calculationProof: Proof?
}

@MainActor extension OwnerClientStore {
    func underwriting(_ initial: ResearchOperatingReasoning, periodType: String) async throws -> UnderwritingProjection {
        try await underwritingRequest(initial, periodType: periodType, suffix: "", body: nil)
    }
    func saveBaseVersion(_ initial: ResearchOperatingReasoning, periodType: String, changeReason: String) async throws -> UnderwritingScenarioVersion {
        let data = try await underwritingData(initial, periodType: periodType, suffix: "/base-versions", body: ["contextId": initial.contextId as Any? ?? NSNull(), "membershipVersion": initial.membershipVersion, "scenarioPeriodType": periodType, "changeReason": changeReason, "idempotencyKey": "base-\(UUID().uuidString)"])
        return try JSONDecoder().decode(UnderwritingScenarioVersion.self, from: data)
    }
    func saveBaseline(_ initial: ResearchOperatingReasoning, periodType: String, version: Int) async throws -> UnderwritingBaseline {
        let data = try await underwritingData(initial, periodType: periodType, suffix: "/baselines", body: ["scenarioVersion": version, "scenarioPeriodType": periodType, "confirmed": true, "idempotencyKey": "baseline-\(UUID().uuidString)"])
        return try JSONDecoder().decode(UnderwritingBaseline.self, from: data)
    }
    func saveThesisAction(_ initial: ResearchOperatingReasoning, action: String, reason: String, newThesis: String?, triggeringFactIds: [String], next: UnderwritingNextEvent, baselineId: String?, idempotencyKey: String = "thesis-\(UUID().uuidString)") async throws -> ResearchContextData {
        guard let binding = initial.model.thesisBinding else { throw NSError(domain: "请先选择原 Thesis", code: 422) }
        let original = try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding))
        let event = try JSONSerialization.jsonObject(with: JSONEncoder().encode(next))
        let body: [String: Any] = ["action": action, "originalThesisIdentity": original, "newThesis": newThesis as Any? ?? NSNull(), "ownerReason": reason, "triggeringFactIds": triggeringFactIds, "nextValidationEvent": event, "baselineId": baselineId as Any? ?? NSNull(), "baseContextId": initial.contextId as Any? ?? NSNull(), "membershipVersion": initial.membershipVersion, "confirmed": true, "idempotencyKey": idempotencyKey]
        let data = try await underwritingData(initial, periodType: "CURRENT_FY", suffix: "/thesis-actions", body: body)
        guard let member = membershipEnvelope?.memberships.first(where: { $0.id == initial.membershipId && $0.version == initial.membershipVersion && $0.symbol == initial.symbol }) else { throw NSError(domain: "研究身份已变化，保存结果尚未核对", code: 409) }
        do { return try validatedThesisActionReceipt(data, membership: member, initialModel: initial.model, request: body) }
        catch { throw NSError(domain: "保存回执尚未核对，请保留当前内容并重新读取", code: 409) }
    }
    private func underwritingRequest(_ initial: ResearchOperatingReasoning, periodType: String, suffix: String, body: [String: Any]?) async throws -> UnderwritingProjection {
        let data = try await underwritingData(initial, periodType: periodType, suffix: suffix, body: body)
        return try JSONDecoder().decode(UnderwritingProjection.self, from: data)
    }
    private func underwritingData(_ initial: ResearchOperatingReasoning, periodType: String, suffix: String, body: [String: Any]?) async throws -> Data {
        guard selectedSymbol == initial.symbol, let member = membershipEnvelope?.memberships.first(where: { $0.symbol == initial.symbol }), member.id == initial.membershipId, member.version == initial.membershipVersion, boundOperatingReasoning(symbol: initial.symbol)?.inputFingerprint == initial.inputFingerprint else { throw NSError(domain: "研究股票或版本已变化", code: 409) }
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = body == nil ? authorization.readToken : authorization.writeToken else { throw NSError(domain: "研究授权不可用", code: 401) }
        let base = authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(member.id)/research-underwriting" + suffix)
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        if body == nil { components.queryItems = [URLQueryItem(name: "periodType", value: periodType)] }
        var request = URLRequest(url: components.url!)
        request.setValue(token, forHTTPHeaderField: body == nil ? authorization.readHeaderName : authorization.writeHeaderName)
        if let body { request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 503
        guard (200..<300).contains(status), selectedSymbol == initial.symbol, authorization == AppEnvironment.researchAuthorizationContext(), member.version == membershipEnvelope?.memberships.first(where: { $0.id == member.id })?.version else {
            let message = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["message"] as? String
            throw NSError(domain: message ?? "研究状态已变化，请重新打开", code: status)
        }
        return data
    }
}

struct ResearchUnderwritingView: View {
    let initial: ResearchOperatingReasoning
    let editJudgment: Bool
    @State private var actionsExpanded = false
    @State private var savingAction = false
    @Environment(\.dismiss) private var dismiss
    @State private var savedContext: ResearchContextData?
    @State private var saveAuthorization: AppResearchAuthorizationContext?
    @State private var checkingSavedContext = false
    @State private var savedContextVerified = false
    @State private var actionReservation = ResearchDocumentIdempotencyReservation()
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var periodType: String
    @State private var projection: UnderwritingProjection?
    @State private var message = ""
    @State private var baseChangeReason = ""
    @State private var action = "INSUFFICIENT_EVIDENCE_CONTINUE"
    @State private var actionReason = ""
    @State private var revisedThesis = ""
    @State private var nextDescription = ""
    @State private var expectedEvidence = ""
    @State private var nextDate = ""
    @State private var selectedFactIds: Set<String> = []
    @State private var explicitlyNoFact = false
    init(initial: ResearchOperatingReasoning, initialPeriodType: String = "CURRENT_FY", editJudgment: Bool = false) {
        self.initial = initial
        self.editJudgment = editJudgment
        self._periodType = State(initialValue: initialPeriodType)
        self._action = State(initialValue: editJudgment ? "REVISE_THESIS" : "INSUFFICIENT_EVIDENCE_CONTINUE")
        self._actionsExpanded = State(initialValue: editJudgment)
    }
    private var currentPeriod: String { initial.model.scenarios.first(where: { $0.name == "base" })?.scenarioPeriodType ?? "CURRENT_FY" }
    var body: some View {
        Group {
            if let receipt = savedContext { savedJudgment(receipt) }
            else { editor }
        }
        .onChange(of: api.authorizationRevision) { _, _ in
            savedContextVerified = false
            if savedContext != nil { message = "授权已变化，请返回研究重新核对。" }
        }
        .onChange(of: api.selectedSymbol) { _, symbol in
            if symbol != initial.symbol { savedContextVerified = false; message = "公司已切换，请返回研究重新核对。" }
        }
        .safeAreaInset(edge: .bottom) {
            if savedContext == nil && !message.isEmpty {
                Text(message).font(.callout).foregroundStyle(Theme.textSecondary)
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Theme.bgPrimary)
                    .accessibilityIdentifier("phase11Status")
            }
        }
    }
    private var editor: some View {
        OperatingBoundPage(initial: initial, title: editJudgment ? "编辑判断" : "盈利预期与判断复核") { bound in
            if bound.actorId.hasPrefix("test-phase11-") { Text("TEST FIXTURE ONLY · 隔离测试数据").font(.headline).foregroundStyle(Theme.gold).accessibilityIdentifier("phase11TestFixtureBanner") }
            if !editJudgment { Picker("预测期间", selection: $periodType) { Text("本财年").tag("CURRENT_FY"); Text("下一个报告期").tag("NEXT_REPORTING_PERIOD") }.pickerStyle(.segmented).accessibilityIdentifier("phase11PeriodPicker") }
            if let value = projection, value.symbol == bound.symbol, value.membershipId == bound.membershipId, value.membershipVersion == bound.membershipVersion {
                if editJudgment {
                    Text("修改自己的判断并保留历史；确认保存前不会写入。").font(.body)
                    if let draft = value.reunderwritingDraft { draftSection(draft, value, bound) }
                    else { Text("当前判断的编辑条件尚未取得，请返回重新读取。").foregroundStyle(Theme.textSecondary) }
                } else {
                if let base = value.currentBase { baseSection(base, value) }
                else { Text("Current Base 尚未正式保存 · \(periodType == "CURRENT_FY" ? "本财年" : "下个报告期")").foregroundStyle(Theme.gold); Text("历史财务事实只是参考，不会自动填入预测。") }
                if value.currentBaseStatus == "REVIEW_REQUIRED" { Text("已保存 Base 引用的事实已失效或修订，估值需先复核。").foregroundStyle(Theme.gold) }
                if currentPeriod == periodType {
                    NavigationLink("编辑 Bear / Base / Bull 草稿") { OperatingModelEditor(initial: bound) }
                    if value.currentBase == nil {
                        Text("Current Base 尚未正式建立").foregroundStyle(Theme.gold)
                        if let member = api.membershipEnvelope?.memberships.first(where: { $0.id == bound.membershipId && $0.version == bound.membershipVersion && $0.symbol == bound.symbol }) {
                            NavigationLink("进入 Current Base 工作台 →") { CurrentBaseFormationView(membership: member, initialPeriodType: periodType) }
                                .accessibilityIdentifier("phase16InitialBaseWorkbench")
                        } else { Text("研究身份已变化，请重新读取后进入工作台。").font(.caption).foregroundStyle(Theme.gold) }
                    } else {
                        TextField("正式版本变化理由", text: $baseChangeReason).accessibilityIdentifier("phase11BaseChangeReason")
                        Button("正式保存 Current Base 新版本") { Task { await saveBase(bound) } }.accessibilityIdentifier("phase11SaveBase")
                    }
                } else { Text("当前研究草稿属于另一预测期间。先编辑期间并保存草稿，再正式保存 Base。").font(.caption).foregroundStyle(.secondary) }
                if let baseline = value.baseline { Text("研究基线 · \(baseline.baselineId.prefix(8)) · Base v\(baseline.scenarioVersion)").font(.caption).foregroundStyle(Theme.blue) }
                if let comparison = value.baselineComparison { DisclosureGroup("研究基线 vs 当前") {
                    Text("事实：\(comparison.factsChanged ? "已变化" : "未变化") · 假设：\(comparison.assumptionsChanged ? "已变化" : "未变化")")
                    Text("情景：\(comparison.scenarioChanged ? "已变化" : "未变化") · 价格：\(comparison.priceChanged ? "已变化" : "未变化")")
                    Text("股本：\(comparison.sharesChanged ? "已变化" : "未变化") · 汇率：\(comparison.fxChanged ? "已变化" : "未变化")")
                    Text("Tests：\(comparison.testsChanged ? "已变化" : "未变化") · 预期差：\(comparison.expectationGapChanged.map { $0 ? "已变化" : "未变化" } ?? "尚缺信息")")
                } }
                if value.currentBase != nil {
                    if let member = api.membershipEnvelope?.memberships.first(where: { $0.id == bound.membershipId && $0.version == bound.membershipVersion && $0.symbol == bound.symbol }) {
                        NavigationLink("核对并保存研究基线 →") { ResearchBaselineActivationView(membership: member, initialPeriodType: periodType) }
                            .accessibilityIdentifier("phase17BaselineEntry")
                    } else { Text("研究身份已变化，请重新读取后核对基线。").font(.caption).foregroundStyle(Theme.gold) }
                }
                gapSection(value)
                if let draft = value.reunderwritingDraft { draftSection(draft, value, bound) }
                if let latest = value.thesisActions?.last { Text("Owner 当前动作：\(actionTitle(latest.action)) · \(latest.confirmedAt.prefix(16))").foregroundStyle(latest.action == "INVALIDATE_OR_END_THESIS" ? Theme.gold : Theme.blue); Text("判断脉络：\(latest.lineageId.prefix(8)) · \(latest.ownerReason)").font(.caption).foregroundStyle(.secondary) }
                if let history = value.thesisActions, !history.isEmpty { DisclosureGroup("Owner 动作历史（\(history.count)）") {
                    ForEach(history) { event in
                        Text("\(actionTitle(event.action)) · \(event.confirmedAt.prefix(16))").font(.callout)
                        Text("\(event.ownerReason) · lineage \(event.lineageId.prefix(8))").font(.caption).foregroundStyle(.secondary)
                        if let endedAt = event.endedAt { Text("结束于 \(endedAt.prefix(16))").font(.caption).foregroundStyle(Theme.gold) }
                    }
                }.accessibilityIdentifier("phase11ThesisActionHistory") }
                if let proof = value.calculationProof { DisclosureGroup("计算依据与版本") { Text("\(proof.calculationVersion) · \(proof.formulaIdentity)").font(.caption2).foregroundStyle(.secondary) } }
                }
            } else { Text(message.isEmpty ? "正在读取当前研究版本…" : "当前研究版本暂未取得").foregroundStyle(.secondary) }
        }.task(id: periodType) { await reload() }
    }
    @ViewBuilder private func baseSection(_ base: UnderwritingScenarioVersion, _ value: UnderwritingProjection) -> some View {
        Text("唯一 Current Base · v\(base.version) · \(base.period.start ?? "") 至 \(base.period.end)").font(.headline)
        Text("历史版本只追加；Bear / Bull 是辅助敏感性情景。").font(.caption).foregroundStyle(.secondary)
        ForEach(base.assumptions) { a in
            let calculated = value.deterministicCalculations?.first(where: { $0.metric == a.variable })
            let displayValue = a.value ?? calculated?.value
            let displayOrigin = a.value == nil && calculated != nil ? "DETERMINISTIC_CALCULATION" : a.origin
            HStack { Text(operatingMetricTitle(a.variable)); Spacer(); Text(assumptionValueTitle(displayValue, unit: a.unit, variable: a.variable, currency: base.modelCurrency)) }
            Text("\(originTitle(displayOrigin)) · \(calculated?.formula ?? (a.reason.isEmpty ? "尚无依据" : a.reason))").font(.caption2).foregroundStyle(.secondary)
        }
        if let calculations = value.deterministicCalculations, !calculations.isEmpty { DisclosureGroup("系统确定性计算") { ForEach(calculations) { c in Text("\(operatingMetricTitle(c.metric))：\(operatingValue(c.value, currency: base.modelCurrency)) · \(c.formula)") } } }
        if let diff = value.scenarioDiff, !diff.assumptionChanges.isEmpty || !diff.marketInputChanges.isEmpty || !diff.newFactIds.isEmpty || !diff.guidanceChanges.isEmpty || diff.calculationChanged { DisclosureGroup("相对上一 Base 的变化") { ForEach(diff.assumptionChanges) { c in Text("\(changeTitle(c.kind)) · \(operatingMetricTitle(c.variable))：\(c.before.map(String.init(describing:)) ?? "尚缺信息") → \(c.after.map(String.init(describing:)) ?? "尚缺信息") · \(c.reason)") }; ForEach(diff.newFactIds, id: \.self) { Text("新增事实 · \($0)") }; ForEach(diff.guidanceChanges, id: \.self) { Text("管理层指引变化 · \($0)") }; if diff.calculationChanged { Text("计算版本变化") }; ForEach(diff.marketInputChanges, id: \.self) { Text("市场输入变化 · \($0)") } } }
    }
    @ViewBuilder private func gapSection(_ value: UnderwritingProjection) -> some View {
        Text("估值 / 预期差").font(.headline)
        if let gap = value.expectationGap {
            if gap.status == "AVAILABLE" {
                Text("Owner Base：\(operatingValue(gap.ownerBase, currency: gap.currency))")
                Text("条件隐含盈利：\(operatingValue(gap.conditionalMarketImplied, currency: gap.currency))")
                Text("预期差：\(operatingValue(gap.absoluteGap, currency: gap.currency))").foregroundStyle(Theme.blue)
                Text("计算使用 Owner 中心 PE = \(gap.centralPE?.formatted() ?? "UNKNOWN")×；不是市场真实预期。").font(.caption).foregroundStyle(.secondary)
            } else { Text(gapStatusTitle(gap.status)).foregroundStyle(Theme.gold); Text(gap.reasons.map(reasonTitle).joined(separator: "；")).font(.caption).foregroundStyle(.secondary) }
            Text("价格截至 \(gap.inputIdentities.priceAsOf ?? "尚缺信息") · 股本截至 \(gap.inputIdentities.sharesAsOf ?? "尚缺信息") · 汇率截至 \(gap.inputIdentities.fxAsOf ?? "同币种 / 尚缺信息")").font(.caption2).foregroundStyle(.secondary)
        }
        if let price = value.priceSinceBaseline { Text("基线后价格：\(price.currency) \(price.baselinePrice.formatted()) → \(price.currentPrice.formatted())（\((price.changeRatio * 100).formatted(.number.precision(.fractionLength(1))))%）").font(.caption); Text("\(price.baselineAsOf) → \(price.currentAsOf) · 价格变化不自动修改 Thesis，也不生成研究提醒。").font(.caption2).foregroundStyle(.secondary) }
        if let must = value.whatMustBeTrue, must.status == "AVAILABLE" || must.status == "MULTIPLE_FREE_VARIABLES" { Text("条件隐含正常化盈利：\(operatingValue(must.normalizedEarningsRequired, currency: value.expectationGap?.currency))"); Text(must.explanation).font(.caption).foregroundStyle(.secondary); if must.solvedVariable == "gross_margin", let margin = must.grossMarginRequired { Text("在其它 Current Base 输入及 Owner PE 不变的条件下，对应毛利率约 \((margin * 100).formatted(.number.precision(.fractionLength(1))))%") }; if must.solvedVariable == "revenue", let revenue = must.revenueRequired { Text("在其它 Current Base 输入及 Owner PE 不变的条件下，对应收入约 \(operatingValue(revenue, currency: value.expectationGap?.currency))") } }
        if let sensitivity = value.peSensitivity, !sensitivity.isEmpty { DisclosureGroup("Owner 指定 PE 单变量敏感性") { ForEach(sensitivity) { item in Text("\(item.pe.formatted())× · 每股条件值 \(item.perShareValue?.formatted() ?? "尚缺信息")") } } }
    }
    @ViewBuilder private func draftSection(_ draft: UnderwritingDraft, _ value: UnderwritingProjection, _ bound: ResearchOperatingReasoning) -> some View {
        Text("重新审视原判断 · 系统草稿").font(.headline)
        Text(draft.originalThesis?.conditionText ?? "尚未显式绑定原 Thesis").foregroundStyle(Theme.blue)
        Text("基线后新事实：\(draft.newFactsSinceBaseline.count) · 仍未知：\(draft.unknowns.first ?? "需继续核查")").font(.caption)
        Text("最重要反证：\(draft.counterevidence.first ?? "当前未找到可靠反证 ≠ Thesis 已被证明")").font(.caption)
        Text("下一验证节点：\(draft.nextValidationEvent.description)").font(.caption).foregroundStyle(Theme.gold)
        if draft.thesisDrift.changed { DisclosureGroup("原判断与当前研究理由的变化") { Text("原理由：\(draft.thesisDrift.oldReason)"); Text("当前理由：\(draft.thesisDrift.newReason)"); Text("新增假设：\(draft.thesisDrift.addedAssumptions.joined(separator: "、"))"); Text("放弃假设：\(draft.thesisDrift.removedAssumptions.joined(separator: "、"))") } }
        if bound.model.thesisBinding != nil {
            DisclosureGroup("选择与确认", isExpanded: $actionsExpanded) {
                Picker("我的选择", selection: $action) { Text("保留原判断").tag("KEEP_CURRENT_THESIS"); Text("修订判断").tag("REVISE_THESIS"); Text("证据不足，继续观察").tag("INSUFFICIENT_EVIDENCE_CONTINUE"); Text("结束原判断").tag("INVALIDATE_OR_END_THESIS") }
                TextField("修改理由（必填）", text: $actionReason, axis: .vertical)
                if action == "REVISE_THESIS" { TextField("新的判断", text: $revisedThesis, axis: .vertical) }
                TextField("下一验证事件", text: $nextDescription)
                TextField("预期证据", text: $expectedEvidence)
                TextField("可选日期 YYYY-MM-DD", text: $nextDate)
                Text("明确选择触发事实").font(.caption)
                ForEach(bound.facts) { fact in
                    Button("\(selectedFactIds.contains(fact.id) ? "已选择" : "选择") · \(operatingMetricTitle(fact.metric)) · \(fact.period.end)") {
                        if selectedFactIds.contains(fact.id) { selectedFactIds.remove(fact.id) } else { selectedFactIds.insert(fact.id); explicitlyNoFact = false }
                    }
                }
                Button(explicitlyNoFact ? "已确认：无触发事实" : "明确确认：本次无触发事实") { selectedFactIds.removeAll(); explicitlyNoFact = true }
                Button(savingAction ? "正在保存…" : "确认保存判断") { Task { await saveAction(bound, value) } }.disabled(savingAction || actionReason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || (action == "REVISE_THESIS" && revisedThesis.trimmingCharacters(in: .whitespacesAndNewlines).count < 3) || (selectedFactIds.isEmpty && !explicitlyNoFact)).accessibilityIdentifier("phase11ConfirmThesisAction")
                Text("此动作保留原报告和历史决定，不执行交易。结束后新投资逻辑需新的 lineage。") .font(.caption2).foregroundStyle(.secondary)
            }.disabled(savingAction)
        }
    }
    private func reload() async {
        do { projection = try await api.underwriting(initial, periodType: periodType); message = "" }
        catch { projection = nil; message = (error as NSError).domain }
    }
    private func actionTitle(_ value: String) -> String { ["KEEP_CURRENT_THESIS":"保留原判断","REVISE_THESIS":"已修订判断","INSUFFICIENT_EVIDENCE_CONTINUE":"证据不足，继续观察","INVALIDATE_OR_END_THESIS":"原判断已结束"][value] ?? value }
    private func originTitle(_ value: String) -> String { ["OWNER_ASSUMPTION":"Owner 假设", "SOURCE_FACT":"来源事实", "DETERMINISTIC_CALCULATION":"系统确定性计算", "UNKNOWN":"尚缺信息"][value] ?? "尚缺信息" }
    private func assumptionValueTitle(_ value: Double?, unit: String, variable: String, currency: String?) -> String {
        guard let value else { return "尚缺信息" }
        if variable == "pe" { return "\(value.formatted())×" }
        if unit == "ratio" { return String(format: "%.1f%%", value * 100) }
        return operatingValue(value, unit: unit, currency: ["currency", "currency_per_vehicle"].contains(unit) ? currency : nil)
    }
    private func changeTitle(_ value: String) -> String { ["NEW_FACT":"新增事实", "OWNER_ASSUMPTION_CHANGED":"Owner 假设变化", "GUIDANCE_CHANGED":"管理层指引变化", "CALCULATION_CHANGED":"计算变化", "MARKET_INPUT_CHANGED":"市场输入变化"][value] ?? "变化" }
    private func gapStatusTitle(_ value: String) -> String { ["INCOMPLETE":"预期差尚未形成 · Current Base 未完整建立","STALE_MARKET_INPUT":"预期差暂不可用 · 报价不够新","ASSUMPTION_REQUIRED":"预期差暂不可用 · 需要明确 Owner PE、股本或汇率","MULTIPLE_FREE_VARIABLES":"预期差暂不可用 · 待确认变量不止一个"][value] ?? "预期差暂不可用" }
    private func reasonTitle(_ value: String) -> String {
        if value.contains("Current Base Scenario version unavailable") { return "尚无正式 Current Base 版本" }
        if value.contains("fresh current price") { return "缺少新鲜的当前报价" }
        if value.contains("shares class") { return "股本类别尚未确认" }
        if value.contains("confirmed reliable shares") { return "缺少已确认的股本口径" }
        if value.contains("Owner PE assumption") { return "缺少 Owner 明确设定的中心 PE" }
        if value.contains("dated FX") { return "缺少有日期的汇率" }
        if value.contains("next reporting period") { return "下个报告期盈利不能直接套用全年 PE" }
        if value.contains("invalidated") { return "Base 引用的事实已失效，需要复核" }
        return "估值输入仍需核对"
    }
    private func saveBase(_ bound: ResearchOperatingReasoning) async {
        do { _ = try await api.saveBaseVersion(bound, periodType: periodType, changeReason: baseChangeReason); await reload(); message = "Current Base 新版本已保存；可选择保存研究基线。" }
        catch { message = (error as NSError).domain }
    }
    private func saveAction(_ bound: ResearchOperatingReasoning, _ value: UnderwritingProjection) async {
        guard !savingAction else { return }
        savingAction = true
        defer { savingAction = false }
        do {
            let event = UnderwritingNextEvent(description: nextDescription.isEmpty ? value.reunderwritingDraft?.nextValidationEvent.description ?? bound.nextResearchQuestion : nextDescription, expectedEvidence: expectedEvidence.isEmpty ? bound.nextResearchQuestion : expectedEvidence, targetDate: nextDate.isEmpty ? nil : nextDate)
            let fingerprintBody: [String: Any] = [
                "actor": bound.actorId, "membership": bound.membershipId, "version": bound.membershipVersion,
                "context": bound.contextId as Any? ?? NSNull(), "input": bound.inputFingerprint,
                "server": AppEnvironment.researchAuthorizationContext().baseURL.absoluteString,
                "action": action, "reason": actionReason, "newThesis": action == "REVISE_THESIS" ? revisedThesis : "",
                "facts": selectedFactIds.sorted(), "event": try JSONSerialization.jsonObject(with: JSONEncoder().encode(event)),
                "baseline": value.baseline?.baselineId as Any? ?? NSNull()]
            let fingerprint = String(decoding: try JSONSerialization.data(withJSONObject: fingerprintBody, options: [.sortedKeys]), as: UTF8.self)
            let key = actionReservation.reserve(for: fingerprint, prefix: "thesis")
            let authorization = AppEnvironment.researchAuthorizationContext()
            let receipt = try await api.saveThesisAction(bound, action: action, reason: actionReason, newThesis: action == "REVISE_THESIS" ? revisedThesis : nil, triggeringFactIds: selectedFactIds.sorted(), next: event, baselineId: value.baseline?.baselineId, idempotencyKey: key)
            savedContext = receipt; saveAuthorization = authorization
            await verifySavedContext(receipt)
        } catch {
            let failure = error as NSError
            message = failure.domain == NSURLErrorDomain ? "网络请求未完成，保存结果尚未确认。请保留当前内容后重试。" : failure.domain
        }
    }
    private func savedJudgment(_ receipt: ResearchContextData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(initial.symbol).font(.subheadline).foregroundStyle(Theme.textSecondary)
                Text(savedContextVerified ? "判断已保存并核对" : "已收到保存回执").font(.title2.bold())
                Text(savedContextVerified ? "最新研究已回读，原判断和修改历史均保留。" : "服务端返回了匹配本次修改的回执；最新研究仍需读取核对，请勿重复提交。")
                if checkingSavedContext { ProgressView("正在核对最新研究…") }
                else if !savedContextVerified {
                    Button("重新读取保存结果") { Task { await verifySavedContext(receipt) } }.frame(minHeight: 44)
                }
                if !message.isEmpty { Text(message).font(.callout).foregroundStyle(Theme.textSecondary) }
                WorkspacePrimaryButton(title: "返回研究") { dismiss() }
            }.padding(24)
        }.background(Theme.bgPrimary).navigationTitle("保存结果").navigationBarTitleDisplayMode(.inline)
    }
    private func verifySavedContext(_ receipt: ResearchContextData) async {
        guard !checkingSavedContext else { return }
        checkingSavedContext = true; savedContextVerified = false
        defer { checkingSavedContext = false }
        guard saveAuthorization == AppEnvironment.researchAuthorizationContext(), api.selectedSymbol == initial.symbol else {
            message = "公司或授权已变化，请返回研究重新核对。"; return
        }
        await api.load(tab: .research, symbol: initial.symbol)
        guard saveAuthorization == AppEnvironment.researchAuthorizationContext(), api.selectedSymbol == initial.symbol,
              let current = api.boundOperatingReasoning(symbol: initial.symbol),
              current.membershipId == receipt.membershipId, current.membershipVersion == receipt.membershipVersion,
              current.contextId == receipt.id, current.model == receipt.operatingModel else {
            message = "尚未取得与回执一致的最新研究。可以重新读取；此操作不会再次保存判断。"; return
        }
        savedContextVerified = true; message = ""
    }
}
