import Foundation
import SwiftUI

struct ReviewMilestone: Decodable {
    let milestoneId: String
    let scenarioPeriodType: String
    let baselineId: String
    let thesisLineageId: String
    let description: String
    let expectedEvidence: String
    let targetDate: String?
    let linkedQuestionIds: [String]
    let linkedThesisTestIds: [String]
}
struct ReviewCompletedSnapshot: Decodable {
    let reviewId: String
    let scenarioPeriodType: String
    let thesisActionId: String
    let createdAt: String
}
struct ResearchReviewProjectionClient: Decodable {
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let scenarioPeriodType: String
    let enabled: Bool
    let status: String
    let evidenceState: String
    let activeMilestone: ReviewMilestone?
    let latestReview: ReviewCompletedSnapshot?
    let triggerReasons: [String]
    let triggerFingerprint: String?
    let relevantEvidenceIds: [String]
    let sinceBaselineDelta: UnderwritingBaselineComparison?
    let underwriting: UnderwritingProjection?
    let maxUnknown: String?
}

@MainActor extension OwnerClientStore {
    func researchReview(_ initial: ResearchOperatingReasoning, periodType: String = "CURRENT_FY") async throws -> ResearchReviewProjectionClient {
        try JSONDecoder().decode(ResearchReviewProjectionClient.self, from: try await reviewData(initial, suffix: "", body: nil, periodType: periodType))
    }
    func createValidationMilestone(_ initial: ResearchOperatingReasoning, periodType: String, baseline: UnderwritingBaseline, description: String, expectedEvidence: String, targetDate: String?, questionId: String?, testId: String?) async throws {
        guard let contextId = initial.contextId, let lineage = baseline.thesisLineageId else { throw NSError(domain: "先保存正式 Thesis 与研究基线", code: 409) }
        _ = try await reviewData(initial, suffix: "/milestones", body: ["membershipVersion": initial.membershipVersion, "scenarioPeriodType": periodType, "baselineId": baseline.baselineId, "contextId": contextId, "thesisLineageId": lineage, "description": description, "expectedEvidence": expectedEvidence, "requirement": NSNull(), "linkedQuestionIds": questionId.map { [$0] } ?? [], "linkedThesisTestIds": testId.map { [$0] } ?? [], "targetDate": targetDate as Any? ?? NSNull(), "confirmed": true, "idempotencyKey": "milestone-\(UUID().uuidString)"])
    }
    func completeValidationReview(_ initial: ResearchOperatingReasoning, projection: ResearchReviewProjectionClient, action: String, newThesis: String?, ownerReason: String, triggeringFactIds: [String], nextDescription: String, nextEvidence: String, nextDate: String?, questionId: String?, testId: String?) async throws {
        guard let milestone = projection.activeMilestone, let baseline = projection.underwriting?.baseline, let trigger = projection.triggerFingerprint, let context = initial.contextId, let binding = initial.model.thesisBinding else { throw NSError(domain: "研究状态已变化，请重新加载", code: 409) }
        let original = try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding))
        let event: [String: Any] = ["description": nextDescription, "expectedEvidence": nextEvidence, "targetDate": nextDate as Any? ?? NSNull()]
        _ = try await reviewData(initial, suffix: "/complete", body: ["membershipVersion": initial.membershipVersion, "baselineId": baseline.baselineId, "milestoneId": milestone.milestoneId, "triggerFingerprint": trigger, "baseContextId": context, "thesisLineageId": milestone.thesisLineageId, "originalThesisIdentity": original, "action": action, "newThesis": newThesis as Any? ?? NSNull(), "ownerReason": ownerReason, "triggeringFactIds": triggeringFactIds, "nextValidationEvent": event, "nextRequirement": NSNull(), "nextLinkedQuestionIds": questionId.map { [$0] } ?? [], "nextLinkedThesisTestIds": testId.map { [$0] } ?? [], "confirmed": true, "idempotencyKey": "review-\(UUID().uuidString)"])
    }
    private func reviewData(_ initial: ResearchOperatingReasoning, suffix: String, body: [String: Any]?, periodType: String? = nil) async throws -> Data {
        guard selectedSymbol == initial.symbol, let member = membershipEnvelope?.memberships.first(where: { $0.id == initial.membershipId && $0.symbol == initial.symbol && $0.version == initial.membershipVersion }), boundOperatingReasoning(symbol: initial.symbol)?.inputFingerprint == initial.inputFingerprint else { throw NSError(domain: "研究股票或版本已变化", code: 409) }
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = body == nil ? authorization.readToken : authorization.writeToken else { throw NSError(domain: "研究授权不可用", code: 401) }
        let base = authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(member.id)/research-review" + suffix)
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        if body == nil, let periodType { components.queryItems = [URLQueryItem(name: "periodType", value: periodType)] }
        var request = URLRequest(url: components.url!)
        request.setValue(token, forHTTPHeaderField: body == nil ? authorization.readHeaderName : authorization.writeHeaderName)
        if let body { request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data,response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 503
        guard (200..<300).contains(status), selectedSymbol == initial.symbol, authorization == AppEnvironment.researchAuthorizationContext(), member.version == membershipEnvelope?.memberships.first(where: { $0.id == member.id })?.version else {
            let message = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])? ["message"] as? String
            throw NSError(domain: message ?? "研究状态已变化，请重新加载", code: status)
        }
        return data
    }
}

struct ResearchReviewView: View {
    let initial: ResearchOperatingReasoning
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var periodType: String
    @State private var projection: ResearchReviewProjectionClient?
    @State private var creationUnderwriting: UnderwritingProjection?
    @State private var message = ""
    @State private var description = ""
    @State private var expectedEvidence = ""
    @State private var targetDate = ""
    @State private var selectedQuestion = ""
    @State private var selectedTest = ""
    @State private var action = "INSUFFICIENT_EVIDENCE_CONTINUE"
    @State private var ownerReason = ""
    @State private var revisedThesis = ""
    @State private var chosenFacts: Set<String> = []
    @State private var noTriggerFact = false
    init(initial: ResearchOperatingReasoning, initialPeriodType: String = "CURRENT_FY") {
        self.initial = initial
        self._periodType = State(initialValue: initialPeriodType)
    }
    var body: some View {
        OperatingBoundPage(initial: initial, title: "持续验证与复核") { bound in
            if bound.actorId.hasPrefix("test-phase12-") { Text("TEST FIXTURE ONLY · 隔离测试数据").foregroundStyle(Theme.gold).accessibilityIdentifier("phase12TestFixtureBanner") }
            if let value = projection, value.symbol == bound.symbol, value.membershipId == bound.membershipId, value.membershipVersion == bound.membershipVersion {
                Text(freshnessTitle(value.status, value.enabled)).font(.headline).accessibilityIdentifier("phase12Freshness")
                if let active = value.activeMilestone { Text("当前验证期间：\(periodTitle(active.scenarioPeriodType))").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("phase12ActivePeriod") }
                if !value.enabled && value.status != "ENDED" {
                    Text(bound.model.thesisBinding == nil ? "尚未建立正式 Thesis；系统不会自动制造原判断。" : value.underwriting?.baseline == nil ? "先保存研究基线，再建立持续验证节点。" : "请由你明确建立下一个验证节点。")
                }
                if let milestone = value.activeMilestone {
                    Text("下一验证：\(milestone.description)").foregroundStyle(Theme.blue)
                    Text("预期证据：\(milestone.expectedEvidence)").font(.caption)
                    if let date = milestone.targetDate { Text("计划检查：\(date)").font(.caption).foregroundStyle(.secondary) }
                    Text(evidenceTitle(value.evidenceState)).foregroundStyle(value.evidenceState == "CONFLICTING" || value.evidenceState == "INVALIDATED" ? Theme.gold : Theme.blue)
                    if value.status != "CURRENT" && value.status != "ENDED" {
                        Text("为什么现在复核：\(value.triggerReasons.map(reasonTitle).joined(separator: "、"))").accessibilityIdentifier("phase12ReviewWhyNow")
                        if let delta = value.sinceBaselineDelta { DisclosureGroup("自研究基线以来") {
                            Text("新事实：\(delta.factsChanged ? "有" : "无") · 假设：\(delta.assumptionsChanged ? "变化" : "未变") · Tests：\(delta.testsChanged ? "变化" : "未变")")
                            Text("市场输入：\(delta.priceChanged ? "变化" : "未变") · 价格单独变化不会触发复核")
                        } }
                        if let underwriting = value.underwriting { DisclosureGroup("盈利、估值与预期差") { Text("当前 Base：\(underwritingTitle(underwriting.currentBaseStatus))"); Text("条件隐含：\(underwritingTitle(underwriting.conditionalImplied?.status))"); Text("预期差：\(underwritingTitle(underwriting.expectationGap?.status))") } }
                        DisclosureGroup("反证与未知") { Text("最大未知：\(value.maxUnknown ?? "仍需核查")"); Text("证据充分仅表示满足指定要求，不代表 Thesis 已证明。") }
                        completionControls(bound,value)
                    } else if value.status == "CURRENT" { Text("当前无需重新审视同一组变化。").font(.caption).foregroundStyle(.secondary) }
                }
                if value.status == "CURRENT", bound.model.thesisBinding != nil { milestoneControls(bound,value) }
                if let latest = value.latestReview { DisclosureGroup("最近一次正式复核") { Text("已由 Owner 复核 · \(latest.createdAt.prefix(16))"); Text("下一组关键变化出现前，不重复提醒。") } }
                if value.status == "ENDED" { Text("原判断已结束；新投资逻辑需要新 Thesis lineage、显式基线和新验证节点。").foregroundStyle(Theme.gold) }
            } else { Text("正在读取持续复核状态…").foregroundStyle(.secondary) }
            if !message.isEmpty { Text(message).font(.caption).foregroundStyle(Theme.gold).accessibilityIdentifier("phase12Status") }
        }.task(id: periodType) { await reload() }
    }
    @ViewBuilder private func milestoneControls(_ bound: ResearchOperatingReasoning,_ value: ResearchReviewProjectionClient) -> some View {
        DisclosureGroup(value.activeMilestone == nil ? "建立验证节点" : "建立新的验证节点") {
            Picker("验证期间", selection: $periodType) { Text("本财年").tag("CURRENT_FY"); Text("下一个报告期").tag("NEXT_REPORTING_PERIOD") }.pickerStyle(.segmented).accessibilityIdentifier("phase12PeriodPicker")
            if let baseline = creationUnderwriting?.baseline, creationUnderwriting?.currentBase?.scenarioPeriodType == periodType {
                Text("对应研究基线 · \(baseline.baselineId.prefix(8)) · Base v\(baseline.scenarioVersion)").font(.caption).foregroundStyle(Theme.blue).accessibilityIdentifier("phase12PeriodBaselineReady")
            } else { Text("先保存该预测期间的研究基线。").font(.caption).foregroundStyle(Theme.gold).accessibilityIdentifier("phase12PeriodBaselineMissing") }
            TextField("下一次要核验什么", text: $description, axis: .vertical)
            TextField("预期出现的证据", text: $expectedEvidence, axis: .vertical)
            TextField("可选检查日期 YYYY-MM-DD", text: $targetDate)
            requirementControls(bound)
            Text("只写文字也可以；没有严格证据要求时，系统不会猜测证据已到。").font(.caption2).foregroundStyle(.secondary)
            Button("确认建立验证节点") { Task { await createMilestone(bound) } }.disabled(creationUnderwriting?.baseline == nil || creationUnderwriting?.currentBase?.scenarioPeriodType != periodType || description.trimmingCharacters(in: .whitespaces).isEmpty || expectedEvidence.trimmingCharacters(in: .whitespaces).isEmpty).accessibilityIdentifier("phase12CreateMilestone")
        }
    }
    @ViewBuilder private func requirementControls(_ bound: ResearchOperatingReasoning) -> some View {
        Picker("结构化证据要求", selection: $selectedQuestion) {
            Text("暂不绑定 · 证据状态未知").tag("")
            ForEach(bound.researchQuestions ?? []) { q in if strictRequirement(q.requirement) { Text("研究问题：\(q.targetMetric)").tag(q.questionId) } }
        }.onChange(of: selectedQuestion) { _,new in if !new.isEmpty { selectedTest = "" } }
        Picker("或绑定 Thesis Test", selection: $selectedTest) {
            Text("暂不绑定").tag("")
            ForEach(bound.model.thesisTests ?? [], id: \.testId) { t in if t.status == "ACTIVE", t.evidenceRequirements?.count == 1, strictRequirement(t.evidenceRequirements?.values.first) { Text("Thesis Test：\(t.metrics.joined(separator: "、"))").tag(t.testId) } }
        }.onChange(of: selectedTest) { _,new in if !new.isEmpty { selectedQuestion = "" } }
    }
    @ViewBuilder private func completionControls(_ bound: ResearchOperatingReasoning,_ value: ResearchReviewProjectionClient) -> some View {
        DisclosureGroup("Owner 明确完成本次复核") {
            Picker("原判断动作", selection: $action) { Text("保留原判断").tag("KEEP_CURRENT_THESIS"); Text("修订判断").tag("REVISE_THESIS"); Text("证据不足，继续观察").tag("INSUFFICIENT_EVIDENCE_CONTINUE"); Text("结束原判断").tag("INVALIDATE_OR_END_THESIS") }
            TextField("Owner 理由（必填）", text: $ownerReason, axis: .vertical)
            if action == "REVISE_THESIS" { TextField("新的 Thesis 文本", text: $revisedThesis, axis: .vertical) }
            TextField("下一验证事件", text: $description, axis: .vertical).accessibilityIdentifier("phase12NextValidation")
            TextField("预期证据", text: $expectedEvidence, axis: .vertical)
            TextField("可选检查日期 YYYY-MM-DD", text: $targetDate)
            if action != "INVALIDATE_OR_END_THESIS" { requirementControls(bound) }
            ForEach(bound.facts) { fact in Button("\(chosenFacts.contains(fact.id) ? "已选择" : "选择") · \(operatingMetricTitle(fact.metric)) · \(fact.period.end)") { if chosenFacts.contains(fact.id) { chosenFacts.remove(fact.id) } else { chosenFacts.insert(fact.id); noTriggerFact = false } } }
            Button(noTriggerFact ? "已确认：无触发事实" : "明确确认：本次无触发事实") { chosenFacts.removeAll(); noTriggerFact = true }
            Button("确认完成本次复核") { Task { await complete(bound,value) } }.disabled(ownerReason.trimmingCharacters(in: .whitespaces).count < 3 || description.trimmingCharacters(in: .whitespaces).isEmpty || expectedEvidence.trimmingCharacters(in: .whitespaces).isEmpty || chosenFacts.isEmpty && !noTriggerFact || action == "REVISE_THESIS" && revisedThesis.trimmingCharacters(in: .whitespaces).count < 3).accessibilityIdentifier("phase12CompleteReview")
            Text("保存 Owner Thesis 动作和不可变复核快照；不执行交易。研究基线须另行明确保存。") .font(.caption2).foregroundStyle(.secondary)
        }
    }
    private func reload() async {
        let selected = periodType
        do {
            let current = try await api.researchReview(initial, periodType: selected)
            guard periodType == selected else { return }
            let readiness: UnderwritingProjection?
            if current.scenarioPeriodType == selected { readiness = current.underwriting }
            else { readiness = try? await api.underwriting(initial, periodType: selected) }
            guard periodType == selected else { return }
            projection = current
            creationUnderwriting = readiness
            message = ""
        } catch { guard periodType == selected else { return }; projection = nil; creationUnderwriting = nil; message = (error as NSError).domain }
    }
    private func createMilestone(_ bound:ResearchOperatingReasoning) async { do { guard let baseline = creationUnderwriting?.baseline, creationUnderwriting?.currentBase?.scenarioPeriodType == periodType else { throw NSError(domain: "先保存该预测期间的研究基线。", code: 409) }; try await api.createValidationMilestone(bound,periodType:periodType,baseline:baseline,description:description,expectedEvidence:expectedEvidence,targetDate:targetDate.isEmpty ? nil : targetDate,questionId:selectedQuestion.isEmpty ? nil : selectedQuestion,testId:selectedTest.isEmpty ? nil : selectedTest); await reload(); message = "验证节点已保存。" } catch { message = (error as NSError).domain } }
    private func complete(_ bound:ResearchOperatingReasoning,_ value:ResearchReviewProjectionClient) async { do { try await api.completeValidationReview(bound,projection:value,action:action,newThesis:action == "REVISE_THESIS" ? revisedThesis : nil,ownerReason:ownerReason,triggeringFactIds:chosenFacts.sorted(),nextDescription:description,nextEvidence:expectedEvidence,nextDate:targetDate.isEmpty ? nil : targetDate,questionId:action == "INVALIDATE_OR_END_THESIS" || selectedQuestion.isEmpty ? nil : selectedQuestion,testId:action == "INVALIDATE_OR_END_THESIS" || selectedTest.isEmpty ? nil : selectedTest); await reload(); message = "本次复核已保存；同一组变化不再重复提醒。" } catch { message = (error as NSError).domain } }
    private func freshnessTitle(_ state:String,_ enabled:Bool)->String { if !enabled && state != "ENDED" { return "持续复核尚未启用" }; return ["CURRENT":"当前无需重新审视","REVIEW_DUE":"验证节点已到","REVIEW_REQUIRED":"需要重新审视","ENDED":"原判断已结束"][state] ?? "研究状态待核查" }
    private func periodTitle(_ value:String)->String { value == "NEXT_REPORTING_PERIOD" ? "下一个报告期" : "本财年" }
    private func evidenceTitle(_ state:String)->String { ["SUFFICIENT":"指定证据结构上已齐备","INSUFFICIENT":"预期证据仍不完整","CONFLICTING":"相关正式证据存在冲突","INVALIDATED":"既有研究证据已失效","UNKNOWN":"尚无可自动核验的证据要求"][state] ?? "证据状态待核查" }
    private func underwritingTitle(_ state:String?)->String { ["NONE":"尚未建立","COMPLETE":"已建立","INCOMPLETE":"输入仍不完整","REVIEW_REQUIRED":"需要复核","AVAILABLE":"条件结果可用","STALE_MARKET_INPUT":"市场输入过期","ASSUMPTION_REQUIRED":"仍缺 Owner 假设","MULTIPLE_FREE_VARIABLES":"待确认变量不止一个"][state ?? ""] ?? "尚缺信息" }
    private func reasonTitle(_ reason:String)->String { ["MILESTONE_EVIDENCE_ARRIVED":"预期证据已到","MILESTONE_DUE_EVIDENCE_MISSING":"验证日期已到","THESIS_TEST_STATE_CHANGED":"Thesis 检验结果变化","EVIDENCE_INVALIDATED":"既有证据失效","CURRENT_BASE_REVIEW_REQUIRED":"当前 Base 需复核","RELEVANT_EVIDENCE_CONFLICT":"相关正式证据冲突"][reason] ?? "关键研究变化" }
    private func strictRequirement(_ value: OperatingJSON?) -> Bool {
        guard let value, case .object(let fields) = value else { return false }
        for key in ["symbol","membershipVersion","metric","period","category","unit","currency","accountingScope","businessScope","measurementBasis","comparability"] {
            guard case .object(let rule)? = fields[key], case .string("exact")? = rule["mode"] else { return false }
        }
        return !fields.values.contains { value in if case .object(let rule) = value, case .string("owner_to_define")? = rule["mode"] { return true }; return false }
    }
}
