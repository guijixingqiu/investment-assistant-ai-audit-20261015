import Foundation

public struct OwnerReportCorrectionBindingRequest: Codable, Equatable, Sendable {
    public let decisionCheckId: String
    public let reviewId: String
    public let reviewOutcome: String
    public let reviewedAt: String
    public let reportBinding: ResearchReportDecisionBinding
}

public struct OwnerAssistantReportCorrectionBindingRequest: Codable, Equatable, Sendable {
    public let reportId: String
    public let reportVersion: Int
    public let reportFingerprint: String
    public let evidencePackId: String
    public let evidencePackFingerprint: String
}

public struct OwnerPriorDecisionBindingRequest: Codable, Equatable, Sendable {
    public let decisionCheckId: String
    public let checkedAt: String
    public let excerpt: String
    public let ownerConfirmedNonSensitive: Bool
}

public struct OwnerReportCorrectionMaterialRequest: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let title: String
    public let contentText: String
    public let sourceType: String
    public let sourceUrl: String?
    public let publishedAt: String
    public let claimType: String
    public let verificationStatus: String
    public let rightsStatus: String
    public let sourceVersion: String
    public let replacesMaterialId: String?
    public let validUntil: String
    public let summary: String
    public let variableName: String?
    public let stance: String
    public let reliability: Int?
    public let materiality: Int?
    public let isRead: Bool
    public let ownerCorrectionBinding: OwnerReportCorrectionBindingRequest?
    public let assistantCorrectionBinding: OwnerAssistantReportCorrectionBindingRequest?
    public let idempotencyKey: String
    public var priorDecisionBinding: OwnerPriorDecisionBindingRequest? = nil
}

public typealias CreateResearchMaterialRequest = OwnerReportCorrectionMaterialRequest

public extension RecordedDecisionCheckReviewState {
    var isOrdinaryPriorJudgmentSource: Bool {
        userFinalDecision?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && contextSnapshot.availability == .preserved
            && formalDecision.availability != "preserved"
            && researchReportDecision.availability != "preserved"
            && conditionalDecision?.availability != "preserved"
    }

    func priorJudgmentMaterialRequest(
        membership: CandidateMembershipData,
        excerpt rawExcerpt: String,
        ownerConfirmedNonSensitive: Bool,
        validUntil: Date,
        idempotencyKey: String
    ) -> CreateResearchMaterialRequest? {
        let excerpt = rawExcerpt.trimmingCharacters(in: .whitespacesAndNewlines)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let checkedDate = formatter.date(from: checkedAt) ?? ISO8601DateFormatter().date(from: checkedAt)
        guard isOrdinaryPriorJudgmentSource,
              market == membership.market,
              code == membership.code,
              symbol == membership.symbol,
              let original = userFinalDecision,
              !excerpt.isEmpty,
              excerpt.utf16.count <= 1_000,
              original.contains(excerpt),
              ownerConfirmedNonSensitive,
              !idempotencyKey.isEmpty,
              let checkedDate,
              validUntil > checkedDate,
              validUntil > Date() else { return nil }
        let content = "历史人工判断摘录（非当前事实或生效决定）\n来源：\(symbol) · 普通判断 #\(id) · \(checkedAt)\nOwner 明确选择的非敏感片段：\n\(excerpt)"
        var request = CreateResearchMaterialRequest(
            membershipId: membership.id,
            membershipVersion: membership.version,
            title: "历史人工判断 · \(symbol) · #\(id)",
            contentText: content,
            sourceType: "owner_prior_judgment_note",
            sourceUrl: nil,
            publishedAt: checkedAt,
            claimType: "model_inference",
            verificationStatus: "unverified",
            rightsStatus: "user_provided",
            sourceVersion: "decision-check:\(id):\(checkedAt)",
            replacesMaterialId: nil,
            validUntil: formatter.string(from: validUntil),
            summary: content,
            variableName: nil,
            stance: "neutral",
            reliability: nil,
            materiality: nil,
            isRead: true,
            ownerCorrectionBinding: nil,
            assistantCorrectionBinding: nil,
            idempotencyKey: idempotencyKey
        )
        request.priorDecisionBinding = OwnerPriorDecisionBindingRequest(
            decisionCheckId: id,
            checkedAt: checkedAt,
            excerpt: excerpt,
            ownerConfirmedNonSensitive: true
        )
        return request
    }
}

public extension TwoLayerReportData {
    /// Rehydrates only the owner-editable layer of an exact current report.
    /// Valuation, technical and evidence bindings remain server-derived.
    func revisionDraftRequest(idempotencyKey: String) -> CreateTwoLayerReportRequest? {
        guard isCurrentExact,
              contractVersion == evidenceBoundReportContractVersion,
              payload.reportContractVersion == evidenceBoundReportContractVersion,
              let evidencePackBinding = payload.evidencePackBinding,
              evidencePackBinding.id == evidencePackId,
              let reproducibility = payload.reproducibility,
              let adviceLayer = payload.adviceLayer,
              let researchLayer = payload.researchLayer else {
            return nil
        }
        return CreateTwoLayerReportRequest(
            membershipVersion: evidencePackBinding.membershipVersion,
            evidencePackId: evidencePackId,
            idempotencyKey: idempotencyKey,
            reportContractVersion: evidenceBoundReportContractVersion,
            evidencePackBinding: evidencePackBinding,
            reproducibility: reproducibility,
            adviceLayer: adviceLayer,
            researchLayer: TwoLayerResearchDraft(
                fundamentals: researchLayer.fundamentals,
                eventsAndCatalysts: researchLayer.eventsAndCatalysts,
                risks: researchLayer.risks,
                counterevidence: researchLayer.counterevidence,
                unknowns: researchLayer.unknowns,
                sourceConflicts: researchLayer.sourceConflicts,
                nextValidationQuestions: researchLayer.nextValidationQuestions
            ),
            changeFromPrevious: payload.changeFromPrevious
        )
    }

    func ownerCorrectionMaterialRequest(
        membership: CandidateMembershipData,
        decisionCheckId: String,
        reviewId: String,
        reviewOutcome: String,
        reviewedAt: String,
        reportBinding: ResearchReportDecisionBinding,
        correction: String,
        nextQuestion: String,
        counterevidence: String,
        idempotencyKey: String
    ) -> OwnerReportCorrectionMaterialRequest? {
        let correction = correction.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextQuestion = nextQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        let counterevidence = counterevidence.trimmingCharacters(in: .whitespacesAndNewlines)
        let reviewedAtFormatter = ISO8601DateFormatter()
        reviewedAtFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard isCurrentExact,
              membership.id == payload.evidencePackBinding?.membershipId,
              membership.version == payload.evidencePackBinding?.membershipVersion,
              membership.symbol == payload.evidencePackBinding?.symbol,
              reportBinding.membershipId == membership.id,
              reportBinding.membershipVersion == membership.version,
              reportBinding.symbol == membership.symbol,
              reportBinding.evidencePackId == evidencePackId,
              reportBinding.reportId == id,
              reportBinding.reportVersion == version,
              reportBinding.reportFingerprint == reportFingerprint,
              !correction.isEmpty,
              !nextQuestion.isEmpty,
              correction.count <= 4_000,
              nextQuestion.count <= 4_000,
              counterevidence.count <= 4_000,
              let reviewedDate = reviewedAtFormatter.date(from: reviewedAt)
                ?? ISO8601DateFormatter().date(from: reviewedAt) else {
            return nil
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let sourceVersion = "report:\(id):v\(version):\(reportFingerprint):review:\(reviewId)"
        let content = """
        exact report: #\(id) v\(version) \(reportFingerprint)
        review: #\(reviewId) \(reviewOutcome)
        你的修正：\(correction)
        next validation: \(nextQuestion)
        counterevidence/unknown: \(counterevidence.isEmpty ? "UNKNOWN" : counterevidence)
        """
        return OwnerReportCorrectionMaterialRequest(
            membershipId: membership.id,
            membershipVersion: membership.version,
            title: "我的复盘修正 · 报告 #\(id) v\(version)",
            contentText: content,
            sourceType: "owner_report_review_correction",
            sourceUrl: nil,
            publishedAt: reviewedAt,
            claimType: "model_inference",
            verificationStatus: "unverified",
            rightsStatus: "user_provided",
            sourceVersion: sourceVersion,
            replacesMaterialId: nil,
            validUntil: formatter.string(from: reviewedDate.addingTimeInterval(90 * 24 * 60 * 60)),
            summary: correction,
            variableName: "report_revision_correction",
            stance: "refute",
            reliability: nil,
            materiality: nil,
            isRead: true,
            ownerCorrectionBinding: OwnerReportCorrectionBindingRequest(
                decisionCheckId: decisionCheckId,
                reviewId: reviewId,
                reviewOutcome: reviewOutcome,
                reviewedAt: reviewedAt,
                reportBinding: reportBinding
            ),
            assistantCorrectionBinding: nil,
            idempotencyKey: idempotencyKey
        )
    }

    func ownerAssistantCorrectionMaterialRequest(
        membership: CandidateMembershipData,
        correction: String,
        idempotencyKey: String,
        now: Date = Date()
    ) -> OwnerReportCorrectionMaterialRequest? {
        let correction = correction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isCurrentExact,
              membership.id == payload.evidencePackBinding?.membershipId,
              membership.version == payload.evidencePackBinding?.membershipVersion,
              membership.symbol == payload.evidencePackBinding?.symbol,
              let pack = payload.evidencePackBinding,
              pack.id == evidencePackId,
              !correction.isEmpty,
              correction.count <= 4_000 else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return OwnerReportCorrectionMaterialRequest(
            membershipId: membership.id,
            membershipVersion: membership.version,
            title: "我的助手修正 · 报告 #\(id) v\(version)",
            contentText: "当前报告：#\(id) v\(version) \(reportFingerprint)\n你的修正：\(correction)",
            sourceType: "owner_assistant_report_correction",
            sourceUrl: nil,
            publishedAt: formatter.string(from: now),
            claimType: "model_inference",
            verificationStatus: "unverified",
            rightsStatus: "user_provided",
            sourceVersion: "report:\(id):v\(version):\(idempotencyKey)",
            replacesMaterialId: nil,
            validUntil: formatter.string(from: now.addingTimeInterval(90 * 24 * 60 * 60)),
            summary: correction,
            variableName: "report_revision_correction",
            stance: "neutral",
            reliability: nil,
            materiality: nil,
            isRead: true,
            ownerCorrectionBinding: nil,
            assistantCorrectionBinding: OwnerAssistantReportCorrectionBindingRequest(
                reportId: id,
                reportVersion: version,
                reportFingerprint: reportFingerprint,
                evidencePackId: pack.id,
                evidencePackFingerprint: pack.fingerprint
            ),
            idempotencyKey: idempotencyKey
        )
    }
}
