import Foundation
import PDFKit

public struct ResearchSourceSnapshotData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let sourceCategory: String
    public let canonicalUrl: String
    public let responseUrl: String
    public let publisher: String
    public let publishedAt: String?
    public let capturedAt: String
    public let mediaType: String
    public let rawSha256: String
    public let byteLength: Int
    public let normalizedText: String?
    public let textSha256: String
    public let extractionVersion: String
    public let offsetUnit: String
    public let summary: String
    public let reviewState: String
    public let rawChangeOnly: Bool

    public func validates(expected membership: CandidateMembershipData, requireText: Bool) -> Bool {
        let textValid: Bool
        if let normalizedText {
            textValid = researchDocumentSha256(Data(normalizedText.utf8)) == textSha256
        } else {
            textValid = !requireText
        }
        return researchDocumentIsPositiveIntegerString(id) && membershipId == membership.id
            && (1...membership.version).contains(membershipVersion) && symbol == membership.symbol
            && sourceCategory == "issuer_public_html" && mediaType == "text/html"
            && researchMaterialHTTPURL(canonicalUrl) && researchMaterialHTTPURL(responseUrl)
            && !publisher.isEmpty && publishedAt.map { researchMaterialDate($0) != nil } != false
            && researchMaterialDate(capturedAt) != nil
            && researchDocumentIsSha256(rawSha256) && byteLength > 0
            && researchDocumentIsSha256(textSha256) && textValid
            && extractionVersion == "parse5-visible-nfc-v1" && offsetUnit == "utf16_code_unit"
            && !summary.isEmpty && ["unconfirmed", "current", "pending_review", "historical"].contains(reviewState)
    }

    public func selectedCitation(range: NSRange) -> (ResearchSnapshotCitation, String)? {
        guard let normalizedText, range.location >= 0, range.length > 0,
              range.length <= 4_000,
              let swiftRange = Range(range, in: normalizedText) else { return nil }
        let excerpt = String(normalizedText[swiftRange])
        guard !excerpt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return (ResearchSnapshotCitation(kind: "source_snapshot", snapshotId: id,
            textSha256: textSha256, startUtf16: range.location,
            endUtf16: range.location + range.length,
            excerptSha256: researchDocumentSha256(Data(excerpt.utf8))), excerpt)
    }
}

public struct ResearchSourceSnapshotResponse<T: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    public let ok: Bool
    public let data: T
}

public struct ResearchSavedSourceSearchHit: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: String
    public let title: String
    public let excerpt: String
    public let snapshotId: String?
    public let textSha256: String?
    public let materialId: String?
    public let contentFingerprint: String?
    public let captureId: String?
    public let pageId: String?
    public let rawSha256: String
    public let citation: ResearchSnapshotCitation?
    public let reviewState: String?
    public let sourceLabel: String

    public var isValid: Bool {
        guard researchDocumentIsSha256(rawSha256), !title.isEmpty, !excerpt.isEmpty,
              !sourceLabel.isEmpty else { return false }
        switch kind {
        case "html":
            return snapshotId.map(researchDocumentIsPositiveIntegerString) == true
                && textSha256.map(researchDocumentIsSha256) == true
                && id == "html:\(snapshotId ?? "")"
                && citation?.isValid == true && citation?.snapshotId == snapshotId
                && citation?.textSha256 == textSha256
                && ["unconfirmed", "current", "pending_review", "historical"].contains(reviewState ?? "")
                && materialId == nil && contentFingerprint == nil && captureId == nil && pageId == nil
        case "futu_material":
            return materialId.map(researchDocumentIsPositiveIntegerString) == true
                && contentFingerprint.map(researchDocumentIsSha256) == true
                && captureId.map(researchDocumentIsPositiveIntegerString) == true
                && pageId.map(researchDocumentIsPositiveIntegerString) == true
                && id == "futu_material:\(materialId ?? ""):\(pageId ?? "")"
                && snapshotId == nil && textSha256 == nil && citation == nil && reviewState == nil
        default: return false
        }
    }
}

public struct ResearchSavedSourceLaneFailure: Codable, Equatable, Identifiable, Sendable {
    public let kind: String
    public let reason: String
    public var id: String { kind }
    public var isValid: Bool {
        ["html", "futu_material"].contains(kind) && reason == "search_unavailable"
    }
}

public enum ResearchSavedSourceUnavailableReason: String, Codable, Sendable {
    case originalMissing = "original_missing"
    case integrityMismatch = "integrity_mismatch"
    case originalUnreadable = "original_unreadable"

    public var title: String {
        switch self {
        case .originalMissing: "原件缺失"
        case .integrityMismatch: "原件或引用校验不一致"
        case .originalUnreadable: "原件无法读取"
        }
    }
}

public struct ResearchSavedSourceUnavailable: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: String
    public let title: String
    public let reason: ResearchSavedSourceUnavailableReason

    public var isValid: Bool {
        guard !title.isEmpty else { return false }
        switch kind {
        case "html": return id.hasPrefix("html:") && researchDocumentIsPositiveIntegerString(String(id.dropFirst(5)))
        case "futu_material": return id.hasPrefix("futu_material:") && researchDocumentIsPositiveIntegerString(String(id.dropFirst(14)))
        default: return false
        }
    }
}

public struct ResearchSavedSourceSearchEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let requestedActorId: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let query: String
    public let glossaryVersion: String?
    public let results: [ResearchSavedSourceSearchHit]
    public let unavailableSources: [ResearchSavedSourceUnavailable]
    public let laneFailures: [ResearchSavedSourceLaneFailure]

    public func validate(expected membership: CandidateMembershipData, query expectedQuery: String) throws {
        guard schemaVersion == "2026-10-11.saved-source-search.v3",
              requestedActorId == membership.actorId, membershipId == membership.id,
              membershipVersion == membership.version, symbol == membership.symbol,
              query == expectedQuery, glossaryVersion == nil || glossaryVersion == "finance-glossary-cjk-v1",
              results.count <= 20, unavailableSources.count <= 32, laneFailures.count <= 2,
              Set(results.map(\.id)).count == results.count,
              Set(unavailableSources.map(\.id)).count == unavailableSources.count,
              Set(laneFailures.map(\.id)).count == laneFailures.count,
              results.allSatisfy(\.isValid), unavailableSources.allSatisfy(\.isValid),
              laneFailures.allSatisfy(\.isValid) else {
            throw ResearchDocumentClientError.invalidResponse
        }
    }
}

public struct CaptureResearchSourceSnapshotRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let url: String
    public let idempotencyKey: String
    public init(membershipVersion: Int, url: String, idempotencyKey: String) {
        self.membershipVersion = membershipVersion; self.url = url; self.idempotencyKey = idempotencyKey
    }
}

public struct ConfirmResearchSourceSnapshotMaterialRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let startUtf16: Int
    public let endUtf16: Int
    public let validUntil: String
    public let ownerConfirmed: Bool
    public let replacesMaterialId: String?
    public let idempotencyKey: String
    public init(membershipVersion: Int, citation: ResearchSnapshotCitation, validUntil: String,
                replacesMaterialId: String? = nil, idempotencyKey: String) {
        self.membershipVersion = membershipVersion; self.startUtf16 = citation.startUtf16
        self.endUtf16 = citation.endUtf16; self.validUntil = validUntil
        self.ownerConfirmed = true; self.replacesMaterialId = replacesMaterialId
        self.idempotencyKey = idempotencyKey
    }
}

public struct ResearchMaterialCitation: Codable, Equatable, Sendable {
    public let documentId: String
    public let pageNumber: Int
    public let pageTextSha256: String
}

public struct ResearchSnapshotCitation: Codable, Equatable, Sendable {
    public let kind: String
    public let snapshotId: String
    public let textSha256: String
    public let startUtf16: Int
    public let endUtf16: Int
    public let excerptSha256: String

    public var isValid: Bool {
        kind == "source_snapshot" && researchDocumentIsPositiveIntegerString(snapshotId)
            && researchDocumentIsSha256(textSha256) && researchDocumentIsSha256(excerptSha256)
            && startUtf16 >= 0 && endUtf16 > startUtf16
    }
}

public struct ResearchSnapshotOriginal: Codable, Equatable, Sendable {
    public let rawSha256: String
    public let byteLength: Int
    public let mediaType: String
    public let canonicalUrl: String
    public let responseUrl: String

    public var isValid: Bool {
        researchDocumentIsSha256(rawSha256) && byteLength > 0 && mediaType == "text/html"
            && researchMaterialHTTPURL(canonicalUrl) && researchMaterialHTTPURL(responseUrl)
    }
}

public struct ResearchMaterialData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let evidenceId: String
    public let market: String
    public let code: String
    public let symbol: String
    public let materialKind: String
    public let title: String
    public let contentText: String
    public let sourceType: String
    public let sourceUrl: String?
    public let publishedAt: String?
    public let capturedAt: String
    public let contentFingerprint: String
    public let claimType: String
    public let verificationStatus: String
    public let rightsStatus: String
    public let sourceVersion: String
    public let replacesMaterialId: String?
    public let revision: Int
    public let revisionState: String
    public let validUntil: String
    public let freshness: String
    public let summary: String
    public let variableName: String?
    public let stance: String
    public let reliability: Int?
    public let materiality: Int?
    public let isRead: Bool
    public let citation: ResearchMaterialCitation?
    public var snapshotCitation: ResearchSnapshotCitation? = nil
    public var snapshotOriginal: ResearchSnapshotOriginal? = nil
    public var futuFinancialSource: FutuFinancialMaterialSource? = nil

    public func validatesPDFCitation(document: ResearchDocumentData, page: ResearchDocumentPageData) -> Bool {
        (sourceType == "owner_provided_pdf" && rightsStatus == "user_provided"
            || sourceType == "issuer_public_pdf" && rightsStatus == "authorized_public"
                && document.sourceClassification == "authorized_public_issuer_document"
                && document.rightsStatus == "authorized_public")
            && claimType == "issuer_statement"
            && ["unverified", "conflict", "rejected"].contains(verificationStatus)
            && market == document.market
            && code == document.code
            && symbol == document.symbol
            && citation?.documentId == document.id
            && citation?.pageNumber == page.pageNumber
            && citation?.pageTextSha256 == page.pageTextSha256
    }

    public func validatesOcrCorrectionCitation(document: ResearchDocumentData, page: ResearchDocumentPageData) -> Bool {
        sourceType == "owner_ocr_correction_note"
            && claimType == "model_inference" && verificationStatus == "unverified"
            && rightsStatus == "user_provided" && sourceUrl == nil && isRead
            && page.textSource == "ocr"
            && document.ocrPageNumbers.contains(page.pageNumber)
            && market == document.market && code == document.code && symbol == document.symbol
            && citation?.documentId == document.id && citation?.pageNumber == page.pageNumber
            && citation?.pageTextSha256 == page.pageTextSha256
            && contentFingerprint == researchDocumentSha256(Data(contentText.utf8))
            && sourceVersion == "ocr-note:pdf:\(document.pdfSha256):p\(page.pageNumber):\(page.pageTextSha256.prefix(16)):\(contentFingerprint.prefix(16))"
    }

    public func validates(expected membership: CandidateMembershipData) -> Bool {
        guard let captured = researchMaterialDate(capturedAt),
              let expiry = researchMaterialDate(validUntil) else { return false }
        let published = publishedAt.flatMap(researchMaterialDate)
        let isFutu = sourceType == "futu_opend_financial_statement_provider"
        guard published != nil || isFutu && publishedAt == nil && futuFinancialSource?.validates(membership) == true
                || sourceType == "deleted" && publishedAt == nil,
              !isFutu || claimType == "third_party_statement" && verificationStatus == "unverified"
                && rightsStatus == "user_provided" && sourceUrl == nil && publishedAt == nil else { return false }
        let citationIsValid = citation.map {
            (sourceType == "owner_provided_pdf" && rightsStatus == "user_provided"
                || sourceType == "issuer_public_pdf" && rightsStatus == "authorized_public"
                || sourceType == "owner_ocr_correction_note" && rightsStatus == "user_provided")
                && snapshotCitation == nil && snapshotOriginal == nil
                && researchDocumentIsPositiveIntegerString($0.documentId)
                && $0.pageNumber > 0
                && researchDocumentIsSha256($0.pageTextSha256)
        } ?? (sourceType == "issuer_public_html"
            ? rightsStatus == "authorized_public" && snapshotCitation?.isValid == true
                && snapshotOriginal?.isValid == true && sourceUrl == snapshotOriginal?.responseUrl
            : sourceType != "owner_provided_pdf" && sourceType != "issuer_public_pdf"
                && sourceType != "owner_ocr_correction_note"
                && snapshotCitation == nil && snapshotOriginal == nil)
        return researchDocumentIsPositiveIntegerString(id)
            && researchDocumentIsPositiveIntegerString(evidenceId)
            && market == membership.market
            && code == membership.code
            && symbol == membership.symbol
            && materialKind == "text"
            && (1...500).contains(title.count)
            && (1...100_000).contains(contentText.count)
            && (1...200).contains(sourceType.count)
            && (1...200).contains(sourceVersion.count)
            && sourceUrl.map(researchMaterialHTTPURL) != false
            && (published.map { $0 <= captured } ?? true)
            && expiry > (published ?? captured)
            && researchDocumentIsSha256(contentFingerprint)
            && ["verified_fact", "issuer_statement", "third_party_statement", "model_inference"].contains(claimType)
            && (sourceType != "owner_ocr_correction_note" || claimType == "model_inference"
                && verificationStatus == "unverified" && rightsStatus == "user_provided"
                && sourceUrl == nil && isRead)
            && ["verified", "unverified", "conflict", "rejected"].contains(verificationStatus)
            && (claimType != "verified_fact" || verificationStatus == "verified")
            && ["user_provided", "authorized_public", "restricted", "unknown"].contains(rightsStatus)
            && replacesMaterialId.map(researchDocumentIsPositiveIntegerString) != false
            && revision > 0
            && ["current", "replaced"].contains(revisionState)
            && ["fresh", "stale"].contains(freshness)
            && (1...4_000).contains(summary.count)
            && variableName.map { (1...500).contains($0.count) } != false
            && ["support", "refute", "neutral"].contains(stance)
            && reliability.map { (1...5).contains($0) } != false
            && materiality.map { (1...5).contains($0) } != false
            && citationIsValid
    }
}

public struct DeleteResearchMaterialRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let idempotencyKey: String

    public init(membershipVersion: Int, idempotencyKey: String) {
        self.membershipVersion = membershipVersion
        self.idempotencyKey = idempotencyKey
    }
}

public struct ResearchMaterialDeletionData: Codable, Equatable, Sendable {
    public let materialId: String
    public let evidenceId: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let contentFingerprint: String
    public let deletedAt: String
    public let state: String

    public func validates(expected membership: CandidateMembershipData) -> Bool {
        researchDocumentIsPositiveIntegerString(materialId)
            && researchDocumentIsPositiveIntegerString(evidenceId)
            && membershipId == membership.id
            && (1...membership.version).contains(membershipVersion)
            && symbol == membership.symbol
            && researchDocumentIsSha256(contentFingerprint)
            && researchMaterialDate(deletedAt) != nil
            && state == "deleted"
    }

    public func validates(expected membership: CandidateMembershipData, material: ResearchMaterialData) -> Bool {
        validates(expected: membership)
            && materialId == material.id
            && evidenceId == material.evidenceId
            && membershipVersion == membership.version
            && contentFingerprint == material.contentFingerprint
    }
}

public struct ResearchMaterialDeletionReadBack: Equatable, Sendable {
    public let deletion: ResearchMaterialDeletionData
    public let list: ResearchDocumentListEnvelope
}

public struct ResearchDocumentData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersionAtImport: Int
    public let market: String
    public let code: String
    public let symbol: String
    public let title: String
    public let originalFilename: String
    public let publishedAt: String
    public let importedAt: String
    public let sourceVersion: String
    public let parserName: String
    public let parserVersion: String
    public let normalizationVersion: String
    public let sourceClassification: String
    public let rightsStatus: String
    public let rightsConfirmedAt: String
    public let rightsDeclarationVersion: String
    public let capturedSourceUrl:String?
    public let publisher:String?
    public let documentKind:String?
    public let sourceLeadId:String?
    public let sourceState: String
    public let pdfSha256: String
    public let byteLength: Int
    public let pageCount: Int
    /// Absent for documents imported before local OCR provenance existed.
    public let ocr: ResearchDocumentOcrProvenance?

    public var isSourceAvailable: Bool { sourceState == "available" }
    public var ocrPageNumbers: [Int] { ocr?.status == "applied" ? (ocr?.pageNumbers ?? []) : [] }
}

public struct ResearchDocumentOcrProvenance: Codable, Equatable, Sendable {
    public let status: String
    public let engine: String?
    public let engineVersion: String?
    public let pageNumbers: [Int]
    public let appliedAt: String?
}

public struct ResearchDocumentImportData: Codable, Equatable, Sendable {
    public let result: String
    public let document: ResearchDocumentData
}

public struct ResearchDocumentPageData: Codable, Equatable, Sendable {
    public let documentId: String
    public let pageNumber: Int
    public let normalizedText: String
    public let pageTextSha256: String
    /// `ocr` pages were recognized locally by Apple PDFKit + Vision and still
    /// require manual verification against the original PDF page.
    public let textSource: String?

    public var isOcrText: Bool { textSource == "ocr" }
    public var isTextless: Bool { normalizedText.isEmpty }
}

public struct ResearchDocumentListEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-30.research-document.v1"
    public static let schemaVersionV2 = "2026-08-08.research-document.v2"
    public static let schemaVersionV3 = "2026-08-19.research-document.v3"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let requestedActorId: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let documents: [ResearchDocumentData]
    public let materials: [ResearchMaterialData]
    public let materialDeletions: [ResearchMaterialDeletionData]?

    public func validate(expected membership: CandidateMembershipData) throws {
        var errors: [String] = []
        if ![Self.schemaVersionV1, Self.schemaVersionV2, Self.schemaVersionV3].contains(schemaVersion) {
            errors.append("document schemaVersion is invalid")
        }
        if status != "available" { errors.append("document list status must be available") }
        if requestedActorId != membership.actorId { errors.append("document actor does not match current membership") }
        if membershipId != membership.id || membershipVersion != membership.version || symbol != membership.symbol {
            errors.append("document list does not match current membership identity")
        }
        let documentIds = Set(documents.map(\.id))
        let materialIds = Set(materials.map(\.id))
        let sourceStates = schemaVersion == Self.schemaVersionV1
            ? Set(["available"])
            : Set(["available", "missing", "corrupt"])
        if documentIds.count != documents.count { errors.append("document ids must be unique") }
        if materialIds.count != materials.count { errors.append("document material ids must be unique") }
        if let materialDeletions {
            if Set(materialDeletions.map(\.materialId)).count != materialDeletions.count
                || Set(materialDeletions.map(\.evidenceId)).count != materialDeletions.count {
                errors.append("material deletion identities must be unique")
            }
            let generated = researchMaterialDate(generatedAt)
            for deletion in materialDeletions where !deletion.validates(expected: membership)
                || researchMaterialDate(deletion.deletedAt).flatMap({ deletedAt in
                    generated.map { deletedAt <= $0 }
                }) != true {
                errors.append("material deletion identity or chronology is invalid")
            }
        } else if schemaVersion == Self.schemaVersionV3 {
            errors.append("document v3 list must include material deletions")
        }
        for document in documents {
            if document.membershipId != membership.id
                || document.market != membership.market
                || document.code != membership.code
                || document.symbol != membership.symbol
                || !["user_provided", "authorized_public"].contains(document.rightsStatus)
                || document.parserName != "pdfjs-dist"
                || document.parserVersion != "6.2.108"
                || document.normalizationVersion != "nfkc-whitespace-v1"
                || !["owner_declared_official", "authorized_public_issuer_document"].contains(document.sourceClassification)
                || !["owner-local-processing-rights-v1", "official-public-local-research-v1"].contains(document.rightsDeclarationVersion)
                || !sourceStates.contains(document.sourceState)
                || document.byteLength <= 0
                || document.pageCount <= 0
                || !researchDocumentIsPositiveIntegerString(document.id)
                || !researchDocumentIsSha256(document.pdfSha256) {
                errors.append("document identity or provenance is invalid")
            }
        }
        for material in materials {
            guard let citation = material.citation,
                  material.validates(expected: membership),
                  let document = documents.first(where: { $0.id == citation.documentId }),
                  researchDocumentIsPositiveIntegerString(material.id),
                  citation.pageNumber > 0,
                  researchDocumentIsSha256(citation.pageTextSha256),
                  material.market == membership.market,
                  material.code == membership.code,
                  material.symbol == membership.symbol,
                  (material.sourceType == "owner_ocr_correction_note"
                    ? material.claimType == "model_inference" && material.verificationStatus == "unverified"
                        && material.rightsStatus == "user_provided" && material.sourceUrl == nil
                        && material.publishedAt == document.publishedAt
                        && document.ocrPageNumbers.contains(citation.pageNumber)
                        && material.contentFingerprint == researchDocumentSha256(Data(material.contentText.utf8))
                        && material.sourceVersion == "ocr-note:pdf:\(document.pdfSha256):p\(citation.pageNumber):\(citation.pageTextSha256.prefix(16)):\(material.contentFingerprint.prefix(16))"
                    : material.claimType == "issuer_statement"
                        && ["unverified", "conflict", "rejected"].contains(material.verificationStatus)
                        && (material.sourceType == "owner_provided_pdf" && material.rightsStatus == "user_provided"
                    || material.sourceType == "issuer_public_pdf" && material.rightsStatus == "authorized_public"
                        && document.sourceClassification == "authorized_public_issuer_document"
                        && document.rightsStatus == "authorized_public")) else {
                errors.append("document material citation is invalid")
                continue
            }
        }
        if !errors.isEmpty { throw ResearchDocumentValidationError.invalid(errors) }
    }
}

public enum ResearchDocumentSearchHitKind: String, Codable, Equatable, Sendable {
    case document
    case page
    case material
}

public struct ResearchDocumentSearchHit: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: ResearchDocumentSearchHitKind
    public let documentId: String
    public let pageNumber: Int
    public let materialId: String?
    public let title: String
    public let excerpt: String
    public let sourceVersion: String
    public let publishedAt: String
    public let pageTextSha256: String
    public let capturedSourceUrl:String?
    public let publisher:String?
    public let documentKind:String?
    public let sourceLeadId:String?
    public let sourceState: String
    public let evidenceStatus: String
}

public struct ResearchDocumentSearchProvenance: Codable, Equatable, Sendable {
    public let engine: String
    public let configuration: String
    public let ocrUsed: Bool
    public let glossaryVersion: String?
    public let suggestedQueries: [String]?
}

public struct ResearchDocumentSearchEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let requestedActorId: String
    public let membershipId: String
    public let membershipVersion: Int?
    public let symbol: String?
    public let query: String
    public let search: ResearchDocumentSearchProvenance
    public let results: [ResearchDocumentSearchHit]
    public let message: String

    public func validate(expected membership: CandidateMembershipData, query expectedQuery: String) throws {
        var errors: [String] = []
        guard let generated = researchMaterialDate(generatedAt) else {
            throw ResearchDocumentValidationError.invalid(["search generatedAt is invalid"])
        }
        if schemaVersion != "2026-08-13.research-document-search.v1" || status != "available" {
            errors.append("search envelope status is invalid")
        }
        if requestedActorId != membership.actorId || membershipId != membership.id
            || membershipVersion != membership.version || symbol != membership.symbol {
            errors.append("search envelope does not match current membership identity")
        }
        if query != expectedQuery || !(1...80).contains(query.count) {
            errors.append("search query identity is invalid")
        }
        if search.engine != "postgresql_native_fts" || search.configuration != "simple" {
            errors.append("search provenance is invalid")
        }
        if let suggestions = search.suggestedQueries,
           suggestions.count > 4 || Set(suggestions).count != suggestions.count
            || suggestions.contains(where: { !(1...80).contains($0.count)
                || $0.trimmingCharacters(in: .whitespacesAndNewlines) != $0 || $0 == query }) {
            errors.append("search keyword suggestions are invalid")
        }
        if results.count > 20 || Set(results.map(\.id)).count != results.count {
            errors.append("search result identities are invalid")
        }
        for hit in results {
            let expectedId = hit.kind == .material ? "material:\(hit.materialId ?? "")"
                : hit.kind == .page ? "page:\(hit.documentId):\(hit.pageNumber)"
                : "document:\(hit.documentId)"
            let materialBindingIsValid = hit.kind == .material
                ? hit.materialId.map(researchDocumentIsPositiveIntegerString) == true
                : hit.materialId == nil
            guard researchDocumentIsPositiveIntegerString(hit.documentId),
                  hit.pageNumber > 0,
                  hit.id == expectedId,
                  materialBindingIsValid,
                  (1...500).contains(hit.title.count),
                  (1...500).contains(hit.excerpt.count),
                  (1...200).contains(hit.sourceVersion.count),
                  let published = researchMaterialDate(hit.publishedAt),
                  published <= generated,
                  researchDocumentIsSha256(hit.pageTextSha256),
                  hit.sourceState == "available",
                  ["searchable_text_only", "ocr_text_pending_manual_verification", "owner_ocr_correction_note_unverified"].contains(hit.evidenceStatus),
                  hit.evidenceStatus != "owner_ocr_correction_note_unverified" || hit.kind == .material else {
                errors.append("search result is invalid or not fresh searchable text")
                continue
            }
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("search message is required")
        }
        if !errors.isEmpty { throw ResearchDocumentValidationError.invalid(errors) }
    }
}

public struct ImportResearchDocumentMetadata: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let title: String
    public let publishedAt: String
    public let sourceVersion: String
    public let rightsConfirmed: Bool
    public let idempotencyKey: String
}

public struct ConfirmResearchDocumentFactRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let pageNumber: Int
    public let quote: String
    public let statement: String
    public let validUntil: String
    public let replacesMaterialId: String?
    public let idempotencyKey: String
}

public struct CreateResearchDocumentOcrCorrectionNoteRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let pageNumber: Int
    public let pageTextSha256: String
    public let ocrExcerpt: String
    public let correctedText: String
    public let note: String?
    public let validUntil: String
    public let replacesMaterialId: String?
    public let idempotencyKey: String

    public init(membershipVersion: Int, pageNumber: Int, pageTextSha256: String,
                ocrExcerpt: String, correctedText: String, note: String?, validUntil: String,
                replacesMaterialId: String?, idempotencyKey: String) {
        self.membershipVersion = membershipVersion
        self.pageNumber = pageNumber
        self.pageTextSha256 = pageTextSha256
        self.ocrExcerpt = ocrExcerpt
        self.correctedText = correctedText
        self.note = note
        self.validUntil = validUntil
        self.replacesMaterialId = replacesMaterialId
        self.idempotencyKey = idempotencyKey
    }

    public var contentText: String {
        let excerpt = normalizedResearchDocumentText(ocrExcerpt)
        let corrected = normalizedResearchDocumentText(correctedText)
        let explanation = note.map(normalizedResearchDocumentText) ?? ""
        return "OCR 识别片段：\(excerpt)\n人工校对建议：\(corrected)"
            + (explanation.isEmpty ? "" : "\n校对说明：\(explanation)")
    }
}

public struct ResearchDocumentOcrCorrectionReadBack: Equatable, Sendable {
    public let document: ResearchDocumentData
    public let page: ResearchDocumentPageData
    public let material: ResearchMaterialData
    public let list: ResearchDocumentListEnvelope
}

public struct ResearchDocumentConfirmationReadBack: Equatable, Sendable {
    public let document: ResearchDocumentData
    public let page: ResearchDocumentPageData
    public let material: ResearchMaterialData
    public let list: ResearchDocumentListEnvelope
}

public struct ResearchDocumentPersistedCitationReadBack: Equatable, Sendable {
    public let document: ResearchDocumentData
    public let page: ResearchDocumentPageData
    public let material: ResearchMaterialData
    public let pdfData: Data
}

public enum ResearchDocumentClientLimits {
    public static let maxPDFBytes = 20 * 1024 * 1024
}

public struct ResearchDocumentPendingImport: Equatable, Identifiable, Sendable {
    public let id: UUID
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let title: String
    public let publishedAt: String
    public let sourceVersion: String
    public let filename: String
    public let pdfSha256: String
    public let pdfBytes: Data

    public init(
        membership: CandidateMembershipData,
        title: String,
        publishedAt: String,
        sourceVersion: String,
        filename: String,
        pdfSha256: String,
        pdfBytes: Data
    ) {
        id = UUID()
        membershipId = membership.id
        membershipVersion = membership.version
        symbol = membership.symbol
        self.title = title
        self.publishedAt = publishedAt
        self.sourceVersion = sourceVersion
        self.filename = filename
        self.pdfSha256 = pdfSha256
        self.pdfBytes = pdfBytes
    }

    public func matches(
        membership: CandidateMembershipData?,
        title: String,
        publishedAt: String,
        sourceVersion: String
    ) -> Bool {
        membership?.id == membershipId
            && membership?.version == membershipVersion
            && membership?.symbol == symbol
            && title == self.title
            && publishedAt == self.publishedAt
            && sourceVersion == self.sourceVersion
    }
}

public func researchDocumentImportSemantic(
    membership: CandidateMembershipData,
    title: String,
    publishedAt: String,
    sourceVersion: String,
    rightsConfirmed: Bool,
    filename: String,
    pdfSha256: String
) -> String {
    [
        membership.id, String(membership.version), title, publishedAt, sourceVersion,
        String(rightsConfirmed), filename, pdfSha256
    ].joined(separator: "|")
}

public struct ResearchDocumentOperationIdentity: Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let membershipState: CandidateMembershipState
    public let actorId: String
    public let symbol: String
    public let documentId: String?
    public let pageNumber: Int?

    public init(membership: CandidateMembershipData, documentId: String? = nil, pageNumber: Int? = nil) {
        membershipId = membership.id
        membershipVersion = membership.version
        membershipState = membership.state
        actorId = membership.actorId
        symbol = membership.symbol
        self.documentId = documentId
        self.pageNumber = pageNumber
    }

    public func matches(
        membership: CandidateMembershipData?,
        documentId: String? = nil,
        pageNumber: Int? = nil
    ) -> Bool {
        membership?.id == membershipId
            && membership?.version == membershipVersion
            && membership?.state == membershipState
            && membership?.actorId == actorId
            && membership?.symbol == symbol
            && documentId == self.documentId
            && pageNumber == self.pageNumber
    }
}

public enum ResearchDocumentValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public enum ResearchDocumentClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidResponse
    case pdfTooLarge
}

public func normalizedResearchDocumentText(_ value: String) -> String {
    value.precomposedStringWithCompatibilityMapping
        .split(whereSeparator: \.isWhitespace)
        .joined(separator: " ")
}

public func countNormalizedResearchDocumentOccurrences(in pageText: String, quote: String) -> Int {
    let page = normalizedResearchDocumentText(pageText)
    let needle = normalizedResearchDocumentText(quote)
    guard !needle.isEmpty else { return 0 }
    var count = 0
    var searchStart = page.startIndex
    while searchStart < page.endIndex,
          let range = page.range(of: needle, range: searchStart..<page.endIndex) {
        count += 1
        searchStart = page.index(after: range.lowerBound)
    }
    return count
}

public func researchDocumentPDFContainsPage(_ data: Data, pageNumber: Int) -> Bool {
    guard pageNumber > 0, let document = PDFDocument(data: data) else { return false }
    return document.page(at: pageNumber - 1) != nil
}

func researchDocumentIsPositiveIntegerString(_ value: String) -> Bool {
    Int(value).map { $0 > 0 && String($0) == value } == true
}

func researchDocumentIsSha256(_ value: String) -> Bool {
    value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
}

private func researchMaterialHTTPURL(_ value: String) -> Bool {
    guard value.count <= 2_000, let components = URLComponents(string: value) else { return false }
    return ["http", "https"].contains(components.scheme?.lowercased() ?? "")
        && components.host?.isEmpty == false
}

func researchMaterialDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}
