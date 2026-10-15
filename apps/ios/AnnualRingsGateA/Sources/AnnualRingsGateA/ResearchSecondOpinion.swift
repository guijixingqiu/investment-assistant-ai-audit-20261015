import Foundation
import CryptoKit

public let researchSecondOpinionVersion = "2026-10-11.second-opinion.v1"

public func researchSecondOpinionConnectionScope(baseURL: URL, readHeader: String, readToken: String?,
    writeHeader: String, writeToken: String?, actorId: String) -> String {
    let parts = [baseURL.absoluteString, readHeader, readToken ?? "", writeHeader, writeToken ?? "", actorId]
    let digest = SHA256.hash(data: Data(parts.joined(separator: "\u{0}").utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}

public struct ResearchSecondOpinionBinding: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let reportId: String
    public let reportVersion: Int
    public let reportFingerprint: String
    public let evidencePackId: String
    public let evidencePackFingerprint: String
    public let snapshotId: String
    public let sourceSetHash: String

    public func matches(_ membership: CandidateMembershipData, report: TwoLayerReportData,
                        pack: FrozenResearchEvidencePack) -> Bool {
        membershipId == membership.id && membershipVersion == membership.version
            && symbol == membership.symbol && reportId == report.id
            && reportVersion == report.version && reportFingerprint == report.reportFingerprint
            && evidencePackId == pack.id && evidencePackFingerprint == pack.packFingerprint
            && report.isCurrentExact && pack.currentness.status == "current"
    }
}

public struct ResearchSecondOpinionSource: Codable, Equatable, Identifiable, Sendable {
    public let materialId: String
    public let evidenceId: String
    public let title: String
    public let sourceType: String
    public let sourceUrl: String?
    public let contentFingerprint: String
    public let excerpt: String
    public let excerptTruncated: Bool
    public let stance: String
    public let claimType: String
    public let verificationStatus: String
    public var id: String { materialId }
}

public struct ResearchSecondOpinionPreview: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let binding: ResearchSecondOpinionBinding
    public let reportConclusion: String
    public let assumptions: [String]
    public let reportCounterEvidenceIds: [String]
    public let provider: String
    public let model: String
    public let maxOutputTokens: Int
    public let inputTokenUpperBound: Int
    public let estimatedMaxCostUsd: Double
    public let sources: [ResearchSecondOpinionSource]
    public let limitations: [String]

    public func validates(_ membership: CandidateMembershipData, report: TwoLayerReportData,
                          pack: FrozenResearchEvidencePack) -> Bool {
        schemaVersion == researchSecondOpinionVersion && binding.matches(membership, report: report, pack: pack)
            && provider == "deepseek" && !model.isEmpty && maxOutputTokens == 1600
            && assumptions.count <= 20 && reportCounterEvidenceIds.count <= 100
            && inputTokenUpperBound > 0 && estimatedMaxCostUsd >= 0
            && !sources.isEmpty && sources.count <= 40
            && sources.allSatisfy { source in
                pack.items.contains { $0.id == source.materialId && $0.evidenceId == source.evidenceId
                    && $0.contentFingerprint == source.contentFingerprint }
            }
    }
}

public struct ResearchSecondOpinionRequest: Codable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let reportId: String
    public let reportVersion: Int
    public let reportFingerprint: String
    public let evidencePackId: String
    public let evidencePackFingerprint: String
    public let snapshotId: String
    public let sourceSetHash: String
    public let reason: String
    public let ownerConfirmedSend: Bool
    public let idempotencyKey: String

    public init(binding: ResearchSecondOpinionBinding, reason: String, idempotencyKey: String) {
        membershipId = binding.membershipId; membershipVersion = binding.membershipVersion
        symbol = binding.symbol; reportId = binding.reportId; reportVersion = binding.reportVersion
        reportFingerprint = binding.reportFingerprint; evidencePackId = binding.evidencePackId
        evidencePackFingerprint = binding.evidencePackFingerprint; snapshotId = binding.snapshotId
        sourceSetHash = binding.sourceSetHash; self.reason = reason
        ownerConfirmedSend = true; self.idempotencyKey = idempotencyKey
    }
}

public struct ResearchSecondOpinionFinding: Codable, Equatable, Identifiable, Sendable {
    public let kind: String
    public let explanation: String
    public let sourceEvidenceIds: [String]
    public var id: String { "\(kind):\(sourceEvidenceIds.joined(separator: ",")):\(explanation)" }
}

public struct ResearchSecondOpinionSendManifest: Codable, Equatable, Sendable {
    public let purpose: String
    public let policyPurpose: String
    public let provider: String
    public let model: String
    public let policyVersion: String
    public let binding: ResearchSecondOpinionBinding
    public let sourceEvidenceIds: [String]
    public let payloadSha256: String
    public let inputTokenUpperBound: Int
    public let maxOutputTokens: Int
    public let estimatedMaxCostUsd: Double
    public let fullPdfSent: Bool
    public let credentialsSent: Bool
    public let officialAssetFactsSent: Bool
}

public struct ResearchSecondOpinionResult: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: String
    public let generatedAt: String
    public let binding: ResearchSecondOpinionBinding
    public let reason: String
    public let provider: String
    public let model: String
    public let findings: [ResearchSecondOpinionFinding]
    public let sendManifest: ResearchSecondOpinionSendManifest
    public let tokenUsage: String
    public let costUsd: String
    public let message: String

    public func validates(_ membership: CandidateMembershipData, report: TwoLayerReportData,
                          pack: FrozenResearchEvidencePack) -> Bool {
        schemaVersion == researchSecondOpinionVersion && ["available", "attempted"].contains(status)
            && binding.matches(membership, report: report, pack: pack)
            && sendManifest.binding == binding && sendManifest.purpose == "independent_same_evidence_second_opinion"
            && sendManifest.policyPurpose == "report_evidence_question"
            && sendManifest.provider == provider && sendManifest.model == model
            && !sendManifest.fullPdfSent && !sendManifest.credentialsSent
            && !sendManifest.officialAssetFactsSent
            && findings.allSatisfy { finding in
                finding.sourceEvidenceIds.allSatisfy(sendManifest.sourceEvidenceIds.contains)
            }
            && (status == "available" ? !findings.isEmpty : findings.isEmpty)
    }
}

public struct ResearchSecondOpinionHistory: Codable, Sendable {
    public let schemaVersion: String
    public let results: [ResearchSecondOpinionResult]
    public let attempts: [ResearchSecondOpinionResult]
}

public func researchSecondOpinionHistoricalSource(
    data: FrozenResearchEvidenceWorkspace.DataPayload,
    binding: ResearchSecondOpinionBinding,
    evidenceId: String
) -> (report: TwoLayerReportData, pack: FrozenResearchEvidencePack, material: ResearchMaterialData)? {
    guard let report = data.reports.first(where: { $0.id == binding.reportId
        && $0.version == binding.reportVersion
        && $0.reportFingerprint == binding.reportFingerprint
        && $0.evidencePackId == binding.evidencePackId }),
          let pack = data.evidencePacks.first(where: { $0.id == binding.evidencePackId
            && $0.packFingerprint == binding.evidencePackFingerprint
            && $0.membershipId == binding.membershipId
            && $0.membershipVersion == binding.membershipVersion
            && $0.symbol == binding.symbol }),
          report.payload.evidencePackBinding?.id == pack.id,
          report.payload.evidencePackBinding?.version == pack.version,
          report.payload.evidencePackBinding?.fingerprint == pack.packFingerprint,
          report.payload.snapshotBinding?.snapshotId == binding.snapshotId else { return nil }
    let matches = pack.items.filter { $0.evidenceId == evidenceId }
    guard matches.count == 1 else { return nil }
    return (report, pack, matches[0])
}
