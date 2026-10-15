import Foundation

public let researchEvidenceQuestionSchemaVersion =
    "2026-08-17.research-evidence-question.v3"

/// Owner-triggered on-demand counter-review. It is a fixed question sent through the
/// existing evidence-question lane, so it stays inside the current report's bound facts.
public let researchEvidenceCounterReviewQuestion =
    "请对当前报告做一次证据范围内的反方复核（同一模型，仅使用本报告已绑定的事实与证据）："
    + "1) 列出支持当前结论最强的事实及其证据编号；"
    + "2) 列出最强反证或相反证据，并说明它是否足以推翻当前结论；"
    + "3) 指出哪些关键假设没有被现有证据覆盖，哪些必须保留为无法确认；"
    + "4) 说明出现什么新证据会改变当前结论；"
    + "5) 给出一个下一步最直接的核实动作。"
    + "不要引入本报告之外的资料，也不要声称来自独立来源或其他提供方。"

public func researchEvidenceQuestionIsCounterReview(_ question: String) -> Bool {
    question.trimmingCharacters(in: .whitespacesAndNewlines) == researchEvidenceCounterReviewQuestion
}

public struct ResearchEvidenceQuestionContextTurn: Codable, Equatable, Sendable {
    public let reportFingerprint: String
    public let question: String
    public let answer: String

    public init(reportFingerprint: String, question: String, answer: String) {
        self.reportFingerprint = reportFingerprint
        self.question = question
        self.answer = answer
    }
}

public func boundedResearchEvidenceQuestionConversation(
    _ turns: [ResearchEvidenceQuestionContextTurn]
) -> [ResearchEvidenceQuestionContextTurn] {
    var selected: [ResearchEvidenceQuestionContextTurn] = []
    var characters = 0
    for turn in turns.suffix(8).reversed() {
        let next = turn.question.utf16.count + turn.answer.utf16.count
        if characters + next > 24_000 { break }
        selected.insert(turn, at: 0)
        characters += next
    }
    return selected
}

public let researchEvidenceQuestionSessionLimit = 8

public func researchEvidenceQuestionCarrySummaryIsBounded(_ text: String) -> Bool {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return !value.isEmpty && value.utf16.count <= 1_200
}

/// This is a user-reviewed note from a prior local session, never a report fact.
public struct ResearchEvidenceQuestionCarrySummary: Codable, Equatable, Sendable {
    public let sourceSessionId: String
    public let reportFingerprint: String
    public let text: String
    public let reviewed: Bool

    public init(sourceSessionId: String, reportFingerprint: String, text: String) {
        self.sourceSessionId = sourceSessionId
        self.reportFingerprint = reportFingerprint
        self.text = text
        self.reviewed = true
    }
}

public func draftResearchEvidenceQuestionCarrySummary(
    _ responses: [ResearchEvidenceQuestionEnvelope],
    membership: CandidateMembershipData, report: TwoLayerReportData
) -> String? {
    guard !responses.isEmpty, responses.count <= researchEvidenceQuestionSessionLimit else { return nil }
    for response in responses {
        guard response.status == "available",
              (try? response.validateForDisplay(expectedMembership: membership,
                expectedReport: report, expectedQuestion: response.question)) != nil else { return nil }
    }
    let questions = responses.suffix(2).map { String($0.question.prefix(140)) }.joined(separator: "；")
    let counter = responses.reversed().flatMap(\.insights).first {
        ["weakens_current_conclusion", "raises_risk"].contains($0.impact)
    }
    let unknown = responses.reversed().flatMap(\.unknowns).first
    let lines = [
        "上个会话的用户核对提示；仅供续接，不是报告事实、引用或正式结论。",
        "已问：\(questions)",
        "反证或风险：\(String((counter?.explanation ?? counter?.statement ?? "未从回答中提取，需重新核对").prefix(220)))",
        "仍待核实：\(String((unknown ?? "未从回答中提取，需重新核对").prefix(220)))",
        "继续问题：\(String((responses.last?.question ?? "请先核对当前报告与证据缺口").prefix(160)))"
    ]
    var draft = lines.joined(separator: "\n")
    while draft.utf16.count > 1_200 { draft.removeLast() }
    return draft
}

public struct ResearchEvidenceQuestionConversationTurn: Equatable, Identifiable, Sendable {
    public let response: ResearchEvidenceQuestionEnvelope

    public init(response: ResearchEvidenceQuestionEnvelope) {
        self.response = response
    }

    public var id: String { "\(response.generatedAt)|\(response.question)" }
    public var context: ResearchEvidenceQuestionContextTurn? {
        guard let answer = response.answer,
              let fingerprint = response.binding?.reportFingerprint else { return nil }
        return .init(
            reportFingerprint: fingerprint,
            question: response.question,
            answer: answer
        )
    }
}

public enum ResearchAssistantHandoff: Equatable, Hashable, Sendable {
    case openCitation(ResearchEvidenceQuestionEnvelope.Fact, evidenceId: String?)
    case openExternalSource(ResearchEvidenceQuestionEnvelope.Fact)
    case reportRevision(String), researchTodo(String), reviewQuestionDraft(ResearchReviewQuestionHandoff)
}
struct GlobalAssistantEvidenceQuestionRequestLane: Equatable, Sendable {
    private var revision = UUID()
    init() {}
    mutating func begin() -> UUID {
        revision = UUID()
        return revision
    }
    mutating func invalidate() { revision = UUID() }
    func accepts(_ revision: UUID) -> Bool { self.revision == revision }
}

public struct ResearchEvidenceQuestionRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let reportId: String
    public let reportFingerprint: String
    public let question: String
    public let conversation: [ResearchEvidenceQuestionContextTurn]
    public let carrySummary: ResearchEvidenceQuestionCarrySummary?
    public let idempotencyKey: String

    public init(
        membershipVersion: Int,
        reportId: String,
        reportFingerprint: String,
        question: String,
        conversation: [ResearchEvidenceQuestionContextTurn] = [],
        carrySummary: ResearchEvidenceQuestionCarrySummary? = nil,
        idempotencyKey: String
    ) {
        self.membershipVersion = membershipVersion
        self.reportId = reportId
        self.reportFingerprint = reportFingerprint
        self.question = question
        self.conversation = conversation
        self.carrySummary = carrySummary
        self.idempotencyKey = idempotencyKey
    }
}
public struct ResearchEvidenceQuestionEnvelope: Codable, Equatable, Sendable {
    public struct SendManifest: Codable, Equatable, Sendable {
        public let purpose: String; public var preparedAt: String? = nil
        public let policyVersion: String
        public var policySnapshot: CloudAiProviderPolicy? = nil
        public var sendAuthorization: CloudAiPolicyState? = nil
        public let provider: String
        public let model: String
        public let membershipId: String
        public let membershipVersion: Int
        public let symbol: String
        public let reportId: String
        public let reportVersion: Int
        public let reportFingerprint: String
        public let evidencePackId: String
        public let evidencePackFingerprint: String
        public let sourceEvidenceIds: [String]
        public let factCount: Int
        public let unknownCount: Int
        public let conversationTurnCount: Int
        public let payloadFields: [String]
        public var reportContextFields: [String]? = nil
        public let requestBodySha256: String
        public let pricingIdentity: String?
        public let inputTokenUpperBound: Int?
        public let maxOutputTokens: Int?
        public let estimatedMaxCostUsd: Double?
        public let fullPdfSent: Bool
        public let credentialsSent: Bool
        public let officialAssetFactsSent: Bool
    }
    public struct Fact: Codable, Equatable, Hashable, Identifiable, Sendable {
        public var id: String {
            [statement, evidenceIds.joined(separator: ","), sourceKind, sourceId ?? "", claimType, stance]
                .joined(separator: "|")
        }
        public let statement: String
        public let evidenceIds: [String]
        public let sourceKind: String
        public let sourceId: String?
        public let claimType: String
        public let stance: String

        public init(
            statement: String,
            evidenceIds: [String],
            sourceKind: String,
            sourceId: String? = nil,
            claimType: String,
            stance: String
        ) {
            self.statement = statement
            self.evidenceIds = evidenceIds
            self.sourceKind = sourceKind
            self.sourceId = sourceId
            self.claimType = claimType
            self.stance = stance
        }
    }

    public struct Insight: Codable, Equatable, Identifiable, Sendable {
        public var id: String {
            [impact, source, statement, evidenceIds.joined(separator: ",")]
                .joined(separator: "|")
        }
        public let impact: String
        public let source: String
        public let statement: String
        public let evidenceIds: [String]
        /// Optional bounded MODEL INTERPRETATION; never a fact, source or citation.
        public let explanation: String?

        public var title: String {
            switch impact {
            case "supports_current_conclusion": "支持当前结论"
            case "weakens_current_conclusion": "削弱当前结论"
            case "raises_risk": "增加风险"
            case "changes_valuation": "影响估值判断"
            case "changes_timing": "影响验证时点"
            case "limits_confidence": "降低结论信心"
            case "requires_follow_up": "需要继续核实"
            default: "影响待核实"
            }
        }
    }

    public struct Binding: Codable, Equatable, Sendable {
        public let reportId: String
        public let reportVersion: Int
        public let reportFingerprint: String
        public let evidencePackId: String
        public let evidencePackFingerprint: String
        public let cutoffAt: String
    }

    public struct Reproducibility: Codable, Equatable, Sendable {
        public let generationMethod: String
        public let model: String
        public let provider: String
        public let prompt: String
        public let tokenUsage: String
        public let cost: String
    }

    public struct Safety: Codable, Equatable, Sendable {
        public let advisoryOnly: Bool
        public let readOnly: Bool
        public let createsOrder: Bool
        public let createsTrade: Bool
        public let callsBroker: Bool
        public let mutatesPortfolio: Bool
        public let mutatesOfficialConclusion: Bool
    }

    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let membershipId: String
    public let membershipVersion: Int?
    public let symbol: String?
    public let question: String
    public let answer: String?
    public let topic: String?
    public let facts: [Fact]
    public let unknowns: [String]
    public let insights: [Insight]
    public let sourceEvidenceIds: [String]
    public let sendManifest: SendManifest?
    public let binding: Binding?
    public let reproducibility: Reproducibility
    public let safety: Safety
    public let message: String

    public var citedEvidenceIds: [String] {
        researchEvidenceQuestionCitations(answer ?? "")
    }

    public var answerFacts: [Fact] {
        guard let answer else { return [] }
        let answerLines = Set(answer.components(separatedBy: "\n"))
        let factsByLine = Dictionary(grouping: facts, by: researchEvidenceQuestionFactLine)
        return facts.filter {
            let line = researchEvidenceQuestionFactLine($0)
            return answerLines.contains(line) && factsByLine[line]?.count == 1
        }
    }

    public func validateForDisplay(
        expectedMembership: CandidateMembershipData,
        expectedReport: TwoLayerReportData,
        expectedQuestion: String
    ) throws {
        var errors: [String] = []
        if schemaVersion != researchEvidenceQuestionSchemaVersion { errors.append("schemaVersion is invalid") }
        if !researchEvidenceQuestionIsDateTime(generatedAt) { errors.append("generatedAt is invalid") }
        if membershipId != expectedMembership.id { errors.append("membershipId does not match") }
        if question != expectedQuestion.trimmingCharacters(in: .whitespacesAndNewlines) { errors.append("question does not match") }
        if !["available", "not_found", "conflict", "unavailable"].contains(status) { errors.append("status is invalid") }
        if status == "available" {
            if membershipVersion != expectedMembership.version || symbol != expectedMembership.symbol { errors.append("membership binding is stale") }
            let allowedTopics = ["overview", "fundamentals", "valuation", "technical", "quant", "events", "risks", "counterevidence", "unknowns"]
            if answer?.isEmpty != false || answer?.count ?? 0 > 12000 || !allowedTopics.contains(topic ?? "") { errors.append("answer is incomplete") }
            if binding?.reportId != expectedReport.id
                || binding?.reportVersion != expectedReport.version
                || binding?.reportFingerprint != expectedReport.reportFingerprint
                || binding?.evidencePackId != expectedReport.evidencePackId
                || binding?.evidencePackFingerprint != expectedReport.payload.evidencePackBinding?.fingerprint
                || binding?.cutoffAt != expectedReport.payload.cutoffAt {
                errors.append("report binding does not match")
            }
            if binding?.reportFingerprint.researchEvidenceQuestionIsSHA256 != true
                || binding?.evidencePackFingerprint.researchEvidenceQuestionIsSHA256 != true
                || !researchEvidenceQuestionIsDateTime(binding?.cutoffAt) {
                errors.append("binding provenance is invalid")
            }
            let reportFacts = expectedReport.researchEvidenceQuestionFacts
            let reportFactIds = Set(reportFacts.map {
                researchEvidenceQuestionFactIdentity(
                    $0.statement, $0.evidenceIds, $0.sourceKind, $0.sourceId, $0.claimType, $0.stance
                )
            })
            let responseFactIds = facts.map {
                researchEvidenceQuestionFactIdentity(
                    $0.statement, $0.evidenceIds, $0.sourceKind, $0.sourceId, $0.claimType, $0.stance
                )
            }
            let validSourceKinds = [
                "material", "fundamental", "research_context", "event", "operating_monitor",
                "valuation_context", "technical_context", "quant_portfolio_context"
            ]
            let validStances = ["support", "refute", "neutral"]
            if facts.count > 24 || facts.reduce(0, { $0 + $1.statement.count }) > 18000
                || facts.contains(where: { $0.statement.isEmpty || $0.statement.count > 4000
                    || !validSourceKinds.contains($0.sourceKind) || $0.claimType.isEmpty
                    || $0.sourceId?.isEmpty == true || ($0.sourceId?.count ?? 0) > 500
                    || $0.claimType == "UNKNOWN"
                    || $0.claimType.count > 100 || !validStances.contains($0.stance)
                    || Set($0.evidenceIds).count != $0.evidenceIds.count })
                || !Set(responseFactIds).isSubset(of: reportFactIds) {
                errors.append("facts are outside the exact report")
            }
            let exactSourceIds = Set(facts.flatMap(\.evidenceIds))
            if Set(sourceEvidenceIds) != exactSourceIds { errors.append("source evidence ids do not match facts") }
            let reportUnknowns = Set(expectedReport.payload.researchLayer?.unknowns.map(\.statement) ?? [])
            if unknowns.count > 24 || unknowns.reduce(0, { $0 + $1.count }) > 18000
                || unknowns.contains(where: { $0.isEmpty || !reportUnknowns.contains($0) }) {
                errors.append("unknowns are outside the exact report")
            }
            let validImpacts = [
                "supports_current_conclusion", "weakens_current_conclusion", "raises_risk",
                "changes_valuation", "changes_timing", "limits_confidence", "requires_follow_up"
            ]
            let insightIds = insights.map(\.id)
            let insightAnswerLines = Set((answer ?? "").components(separatedBy: "\n"))
            if insights.count > 8 || Set(insightIds).count != insightIds.count {
                errors.append("insights are invalid")
            }
            for insight in insights {
                if !validImpacts.contains(insight.impact) || insight.statement.isEmpty
                    || insight.statement.count > 4000 || Set(insight.evidenceIds).count != insight.evidenceIds.count {
                    errors.append("insight is invalid")
                    continue
                }
                if let explanation = insight.explanation,
                    explanation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || explanation.count > 400 {
                    errors.append("insight explanation is invalid")
                    continue
                }
                if insight.source == "unknown" {
                    if !unknowns.contains(insight.statement) || !insight.evidenceIds.isEmpty
                        || !insightAnswerLines.contains("UNKNOWN：\(insight.statement)")
                        || !["limits_confidence", "requires_follow_up"].contains(insight.impact) {
                        errors.append("unknown insight is outside the exact report")
                    }
                } else if insight.source == "fact" {
                    guard let fact = facts.first(where: {
                        $0.statement == insight.statement && $0.evidenceIds == insight.evidenceIds
                    }), insightAnswerLines.contains(researchEvidenceQuestionFactLine(fact)) else {
                        errors.append("fact insight is outside the exact report")
                        continue
                    }
                    if (fact.stance == "support" && insight.impact == "weakens_current_conclusion")
                        || (fact.stance == "refute" && insight.impact == "supports_current_conclusion") {
                        errors.append("fact insight contradicts its report stance")
                    }
                } else {
                    errors.append("insight source is invalid")
                }
            }
            let citations = researchEvidenceQuestionCitations(answer ?? "")
            if !Set(citations).isSubset(of: Set(sourceEvidenceIds)) {
                errors.append("answer citations are outside the exact report")
            }
            let allowedAnswerLines = Set(
                facts.map(researchEvidenceQuestionFactLine)
                    + unknowns.map { "UNKNOWN：\($0)" }
                    + [researchEvidenceQuestionNoSupportedAnswer]
            )
            let answerLines = (answer ?? "").components(separatedBy: "\n")
            if Set(answerLines).count != answerLines.count
                || answerLines.contains(where: { !allowedAnswerLines.contains($0) }) {
                errors.append("answer contains statements outside the exact report")
            }
        } else if membershipVersion != nil || symbol != nil || answer != nil || topic != nil
            || binding != nil || !facts.isEmpty || !unknowns.isEmpty || !insights.isEmpty
            || !sourceEvidenceIds.isEmpty {
            errors.append("fail-closed response exposes partial facts")
        }
        let deterministic = reproducibility.generationMethod == "deterministic_current_report_evidence_lookup"
            && [reproducibility.model, reproducibility.provider, reproducibility.prompt,
                reproducibility.tokenUsage, reproducibility.cost].allSatisfy { $0 == "NOT_USED" }
        let deepSeek = reproducibility.generationMethod == "deepseek_chat_completions_current_report_evidence"
            && ["deepseek-v4-flash", "deepseek-flash"].contains(reproducibility.model)
            && reproducibility.provider == "deepseek"
            && ["research-evidence-answer.v4", "research-evidence-answer.v5", "research-evidence-answer.v6", "research-evidence-answer.v7"]
                .contains(reproducibility.prompt)
            && (status == "available"
                ? reproducibility.tokenUsage.range(
                    of: "^prompt=[0-9]+,completion=[0-9]+,total=[0-9]+$",
                    options: .regularExpression
                ) != nil
                : reproducibility.tokenUsage == "UNKNOWN")
            && (reproducibility.cost == "UNKNOWN"
                || reproducibility.cost.range(
                    of: "^estimated_usd=[0-9]+\\.[0-9]{8};pricing=(2026-08-13|2026-09-10\\.peak)$",
                    options: .regularExpression
                ) != nil && reproducibility.cost.hasSuffix(reproducibility.model == "deepseek-flash"
                    ? "pricing=2026-09-10.peak" : "pricing=2026-08-13"))
        if !deterministic && !deepSeek { errors.append("reproducibility is invalid") }
        if deepSeek {
            if let manifest = sendManifest {
                let malformed = manifest.purpose != "report_evidence_question"
                    || (manifest.preparedAt != nil && !areDateTimeInstantsChronologicallyOrdered([manifest.preparedAt!, generatedAt]))
                    || !cloudAiModelPolicyMatches(manifest.model, manifest.policyVersion)
                    || (manifest.policySnapshot != nil && (manifest.policySnapshot?.isKnownPolicy != true || manifest.policySnapshot?.policyVersion != manifest.policyVersion || manifest.policySnapshot?.model != manifest.model))
                    || (manifest.sendAuthorization != nil && manifest.sendAuthorization?.isKnownSendAuthorizationSnapshot(policyVersion: manifest.policyVersion) != true)
                    || manifest.provider != reproducibility.provider
                    || manifest.model != reproducibility.model
                    || Int(manifest.membershipId).map { $0 > 0 } != true || manifest.membershipVersion <= 0
                    || manifest.symbol.range(of: "^HK\\.[0-9]{5}$", options: .regularExpression) == nil
                    || Int(manifest.reportId).map { $0 > 0 } != true || manifest.reportVersion <= 0
                    || manifest.reportFingerprint.researchEvidenceQuestionIsSHA256 != true
                    || Int(manifest.evidencePackId).map { $0 > 0 } != true
                    || manifest.evidencePackFingerprint.researchEvidenceQuestionIsSHA256 != true
                    || !(0...24).contains(manifest.factCount) || !(0...24).contains(manifest.unknownCount)
                    || !(0...8).contains(manifest.conversationTurnCount)
                    || ![["question", "conversation", "symbol", "reportBinding", "facts", "unknowns"],
                        ["question", "conversation", "symbol", "reportBinding", "facts", "unknowns", "reportContext"],
                        ["question", "conversation", "symbol", "reportBinding", "facts", "unknowns", "carrySummary"],
                        ["question", "conversation", "symbol", "reportBinding", "facts", "unknowns", "carrySummary", "reportContext"]
                    ].contains(manifest.payloadFields)
                    || (manifest.payloadFields.contains("reportContext")
                        ? manifest.reportContextFields != ["conclusion", "confidence", "assumptions", "priceConditions", "nextQuestion"]
                        : manifest.reportContextFields != nil)
                    || manifest.requestBodySha256.researchEvidenceQuestionIsSHA256 != true
                    || !researchEvidenceQuestionCostEstimateIsValid(manifest)
                    || manifest.fullPdfSent || manifest.credentialsSent || manifest.officialAssetFactsSent
                let wrongIdentity = manifest.membershipId != expectedMembership.id
                    || manifest.membershipVersion != expectedMembership.version || manifest.symbol != expectedMembership.symbol
                    || manifest.reportId != expectedReport.id || manifest.reportVersion != expectedReport.version
                    || manifest.reportFingerprint != expectedReport.reportFingerprint
                    || manifest.evidencePackId != expectedReport.evidencePackId
                    || manifest.evidencePackFingerprint != expectedReport.payload.evidencePackBinding?.fingerprint
                let mismatched = wrongIdentity || status == "available" && (
                    manifest.reportId != binding?.reportId || manifest.reportVersion != binding?.reportVersion
                    || manifest.sourceEvidenceIds != sourceEvidenceIds
                    || manifest.factCount != facts.count || manifest.unknownCount != unknowns.count)
                if malformed || mismatched {
                    errors.append("send manifest is invalid")
                }
            } else {
                errors.append("AI answer requires send manifest")
            }
        } else if sendManifest != nil {
            errors.append("non-AI answer must clear send manifest")
        }
        if deepSeek && status == "available" && answer != researchEvidenceQuestionNoSupportedAnswer
            && insights.isEmpty {
            errors.append("AI answer must explain at least one bounded impact")
        }
        if !safety.advisoryOnly || !safety.readOnly || safety.createsOrder || safety.createsTrade
            || safety.callsBroker || safety.mutatesPortfolio || safety.mutatesOfficialConclusion {
            errors.append("safety boundary is invalid")
        }
        if Set(sourceEvidenceIds).count != sourceEvidenceIds.count { errors.append("source evidence ids are duplicated") }
        if !errors.isEmpty { throw ResearchEvidenceQuestionValidationError.invalid(errors) }
    }
}

private func researchEvidenceQuestionCostEstimateIsValid(
    _ manifest: ResearchEvidenceQuestionEnvelope.SendManifest
) -> Bool {
    let hasEstimate = manifest.pricingIdentity != nil || manifest.inputTokenUpperBound != nil
        || manifest.maxOutputTokens != nil || manifest.estimatedMaxCostUsd != nil
    guard hasEstimate else { return true }
    guard let input = manifest.inputTokenUpperBound, input > 0,
          manifest.maxOutputTokens == 800,
          let cost = manifest.estimatedMaxCostUsd else { return false }
    let expected = cloudAiCostEstimate(input, 800, model: manifest.model, pricing: manifest.pricingIdentity)
    return cost == expected
}
public extension TwoLayerReportData {
    var researchEvidenceQuestionFacts: [TwoLayerReportFact] {
        guard let research = payload.researchLayer else { return [] }
        return research.fundamentals
            + (research.context ?? [])
            + research.valuation
            + research.technical
            + (research.quantPortfolio ?? [])
            + research.eventsAndCatalysts
            + (research.operatingMonitor ?? [])
            + research.risks
            + research.counterevidence
    }
    func researchEvidenceQuestionFact(
        matching fact: ResearchEvidenceQuestionEnvelope.Fact
    ) -> TwoLayerReportFact? {
        let matches = researchEvidenceQuestionFacts.filter {
            researchEvidenceQuestionFactIdentity(
                $0.statement, $0.evidenceIds, $0.sourceKind, $0.sourceId, $0.claimType, $0.stance
            ) == researchEvidenceQuestionFactIdentity(
                fact.statement, fact.evidenceIds, fact.sourceKind, fact.sourceId, fact.claimType, fact.stance
            )
        }
        return matches.count == 1 ? matches[0] : nil
    }
}
private let researchEvidenceQuestionNoSupportedAnswer =
    "UNKNOWN：当前报告没有足够的绑定事实回答该问题。"
private func researchEvidenceQuestionFactLine(
    _ fact: ResearchEvidenceQuestionEnvelope.Fact
) -> String {
    guard !fact.evidenceIds.isEmpty else { return "\(fact.statement) [context]" }
    return "\(fact.statement) \(fact.evidenceIds.map { "[evidence:\($0)]" }.joined(separator: " "))"
}
private func researchEvidenceQuestionFactIdentity(
    _ statement: String,
    _ evidenceIds: [String],
    _ sourceKind: String?,
    _ sourceId: String?,
    _ claimType: String?,
    _ stance: String?
) -> String {
    [statement, evidenceIds.joined(separator: ","), sourceKind ?? "", sourceId ?? "", claimType ?? "", stance ?? ""]
        .joined(separator: "\u{0}")
}
private func researchEvidenceQuestionCitations(_ answer: String) -> [String] {
    guard let expression = try? NSRegularExpression(pattern: #"\[evidence:([^\]]+)\]"#) else { return [] }
    let value = answer as NSString
    return expression.matches(in: answer, range: NSRange(location: 0, length: value.length)).map {
        value.substring(with: $0.range(at: 1))
    }
}
public enum ResearchEvidenceQuestionValidationError: Error, Equatable, Sendable {
    case invalid([String])
}
private func researchEvidenceQuestionIsDateTime(_ value: String?) -> Bool {
    guard let value else { return false }
    return isParseableDateTime(value)
}

private extension String {
    var researchEvidenceQuestionIsSHA256: Bool {
        range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }
}
