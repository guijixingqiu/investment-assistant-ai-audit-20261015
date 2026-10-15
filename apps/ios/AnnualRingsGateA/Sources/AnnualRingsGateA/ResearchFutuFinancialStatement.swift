import CryptoKit
import Foundation

public enum FutuFinancialTable: String, CaseIterable, Codable, Sendable {
    case income, balance_sheet, cash_flow

    public var title: String {
        switch self {
        case .income: "利润表"
        case .balance_sheet: "资产负债表"
        case .cash_flow: "现金流量表"
        }
    }

    var bridgeCode: Int {
        switch self { case .income: 1; case .balance_sheet: 2; case .cash_flow: 3 }
    }
}

public struct FutuFinancialSummary: Decodable, Sendable {
    public let periodEnd: String
    public let periodText: String
    public let financialType: String
    public let fiscalYear: Int
    public let currencyCode: String
    public let accountingStandards: String
    public let itemCount: Int
    public let reportSha256: String
}

public struct FutuFinancialPage: Decodable, Identifiable, Sendable {
    public let id: String
    public let captureId: String
    public let statementType: FutuFinancialTable
    public let pageNumber: Int
    public let requestedCursor: String?
    public let nextCursor: String
    public let capturedAt: String
    public let rawSha256: String
    public let byteLength: Int
    public let reports: [FutuFinancialSummary]
    public let originalAvailability: String
}

public struct FutuFinancialTableState: Decodable, Sendable {
    public let status: String
    public let reasonCode: String?
    public let pageCount: Int
    public let reportCount: Int
    public let requestPaginationComplete: Bool
    public let lastNextCursor: String?
    public let currentOriginalsAvailable: Bool?
}

public struct FutuFinancialTableStates: Decodable, Sendable {
    public let income: FutuFinancialTableState
    public let balance_sheet: FutuFinancialTableState
    public let cash_flow: FutuFinancialTableState

    public subscript(_ table: FutuFinancialTable) -> FutuFinancialTableState {
        switch table { case .income: income; case .balance_sheet: balance_sheet; case .cash_flow: cash_flow }
    }
}

public struct FutuFinancialUnknowns: Decodable, Sendable {
    public let periodStart: String
    public let amountUnitScale: String
    public let consolidationScope: String
    public let restatementStatus: String
    public let issuerOriginal: String
    public let latestRequiredPeriod: String
    public let historicalCoverage: String

    var remainsUnknown: Bool {
        [periodStart, amountUnitScale, consolidationScope, restatementStatus,
         issuerOriginal, latestRequiredPeriod, historicalCoverage].allSatisfy { $0 == "UNKNOWN" }
    }
}

public struct FutuFinancialCapture: Decodable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersion: Int
    public let actorType: String
    public let actorId: String
    public let symbol: String
    public let sourceClassification: String
    public let capturedAt: String
    public let pageSize: Int
    public let maxPagesPerTable: Int
    public let periodSelection: String?
    public let tables: FutuFinancialTableStates
    public let pages: [FutuFinancialPage]
    public let unknowns: FutuFinancialUnknowns

    public func validates(_ membership: CandidateMembershipData) -> Bool {
        guard id.isEmpty == false, membershipId == membership.id, symbol == membership.symbol,
              actorType == "user", actorId == membership.actorId, membershipVersion > 0,
              sourceClassification == "futu_opend_financial_statement_provider", unknowns.remainsUnknown,
              (1...20).contains(pageSize), (1...4).contains(maxPagesPerTable),
              [nil,"legacy_default","annual","half_year"].contains(periodSelection) else { return false }
        return FutuFinancialTable.allCases.allSatisfy { table in
            let state = tables[table]
            let selected = pages.filter { $0.statementType == table }
            return ["complete", "partial", "unavailable"].contains(state.status)
                && state.pageCount == selected.count
                && state.reportCount == selected.reduce(0) { $0 + $1.reports.count }
                && Set(selected.map(\.pageNumber)).count == selected.count
                && selected.allSatisfy { page in
                    page.captureId == id && !page.id.isEmpty && page.pageNumber > 0 && page.byteLength > 0
                        && page.rawSha256.count == 64 && page.rawSha256.allSatisfy { $0.isHexDigit }
                        && ["available", "unavailable", "unknown"].contains(page.originalAvailability)
                }
        }
    }
}

public struct FutuFinancialItem: Decodable, Sendable {
    public let field_id: Int
    public let display_name: String
    public let data: Double?
}

public struct FutuFinancialReport: Decodable, Sendable {
    public let date_time: Double
    public let date_time_str: String
    public let fiscal_year: Int
    public let financial_type: String
    public let period_text: String
    public let currency_code: String
    public let currency_info: String
    public let accounting_standards: String
    public let auditor_report: String
    public let item_list: [FutuFinancialItem]
}

public struct FutuFinancialOriginal: Decodable, Sendable {
    public let ok: Bool
    public let source: String
    public let symbol: String
    public let statement_type: Int
    public let requested_next_key: String?
    public let num: Int
    public let captured_at: String
    public let report_list: [FutuFinancialReport]
    public let next_key: String
}

public struct VerifiedFutuFinancialOriginal: Sendable {
    public let page: FutuFinancialPage
    public let body: FutuFinancialOriginal
    public let rawText: String
}

public struct FutuFinancialHistoryValue: Codable, Equatable, Identifiable, Sendable {
    public struct Source: Codable, Equatable, Sendable {
        public let captureId: String; public let pageId: String; public let rawSha256: String
        public let reportSha256: String; public let capturedAt: String
    }
    public let metric: String; public let statementType: FutuFinancialTable; public let fieldId: Int
    public let displayName: String; public let rawValue: String; public let currencyCode: String
    public let periodKind: String; public let periodStart: String?; public let periodEnd: String
    public let periodText: String; public let financialType: String; public let source: Source
    public var id: String { "\(financialType):\(periodEnd):\(statementType.rawValue):\(fieldId)" }
}

public struct FutuFinancialMaterialIdentity: Codable, Equatable, Sendable {
    public let id: String; public let revision: Int
    public let contentFingerprint: String; public let sourceVersion: String
}
public struct FutuFinancialMaterialSource: Codable, Equatable, Sendable {
    public struct Page: Codable, Equatable, Sendable {
        public let pageId: String; public let statementType: FutuFinancialTable
        public let rawSha256: String; public let reportSha256: String
    }
    public struct Row: Codable, Equatable, Sendable {
        public let metric: String; public let statementType: FutuFinancialTable; public let fieldId: Int
        public let displayName: String; public let currencyCode: String; public let periodKind: String
        public let periodStart: String?; public let periodEnd: String; public let periodText: String; public let financialType: String
    }
    public let captureId: String; public let membershipId: String; public let membershipVersion: Int
    public let symbol: String; public let capturedAt: String; public let financialType: String
    public let periodEnd: String; public let sourceFingerprint: String
    public let pages: [Page]; public let rows: [Row]; public let gaps: [String]
    public let amountUnit: String; public let amountUnitScale: Int
    public let publicationTime: String; public let issuerOriginalVerification: String; public let restatementComparability: String
    public func validates(_ membership: CandidateMembershipData) -> Bool {
        membershipId == membership.id && membershipVersion == membership.version && symbol == membership.symbol
            && researchDocumentIsPositiveIntegerString(captureId) && ["ANNUAL","Q6"].contains(financialType)
            && researchDocumentIsSha256(sourceFingerprint) && publicationTime == "UNKNOWN"
            && researchMaterialDate(capturedAt) != nil
            && amountUnit == "currency_base_unit" && amountUnitScale == 1
            && issuerOriginalVerification == "UNKNOWN" && restatementComparability == "UNKNOWN"
            && (1...3).contains(pages.count) && (1...5).contains(rows.count)
            && pages.allSatisfy { researchDocumentIsPositiveIntegerString($0.pageId)
                && researchDocumentIsSha256($0.rawSha256) && researchDocumentIsSha256($0.reportSha256) }
            && rows.allSatisfy { row in row.periodEnd == periodEnd && row.financialType == financialType
                && pages.contains { $0.statementType == row.statementType } }
    }
}
public struct FutuFinancialMaterialPreview: Codable, Equatable, Sendable {
    public let source: FutuFinancialMaterialSource; public let title: String; public let contentText: String
    public let summary: String; public let contentFingerprint: String; public let sourceVersion: String
    public let materials: [FutuFinancialMaterialIdentity]
    public let values: [FutuFinancialHistoryValue]
    public func validates(_ membership: CandidateMembershipData) -> Bool {
        source.validates(membership) && researchDocumentSha256(Data(contentText.utf8)) == contentFingerprint
            && !title.isEmpty && !summary.isEmpty && !sourceVersion.isEmpty
            && values.count == source.rows.count && values.allSatisfy { value in
                value.source.captureId == source.captureId && value.periodEnd == source.periodEnd
                    && value.financialType == source.financialType && source.pages.contains { page in
                        page.pageId == value.source.pageId && page.rawSha256 == value.source.rawSha256
                            && page.reportSha256 == value.source.reportSha256 }
            }
            && materials.allSatisfy { researchDocumentIsPositiveIntegerString($0.id) && $0.revision > 0
                && $0.contentFingerprint == contentFingerprint && $0.sourceVersion == sourceVersion }
    }
}
private struct FutuMaterialRequest: Encodable {
    let membershipVersion: Int; let financialType: String; let periodEnd: String
    let sourceFingerprint: String; let validUntil: String; let userConfirmed = true; let idempotencyKey: String
}

public struct FutuFinancialHistory: Decodable, Sendable {
    public struct ComparisonNotice: Decodable, Identifiable, Sendable {
        public let id: String; public let text: String; public let sourceUrl: String; public let periodEnds: [String]
    }
    public let symbol: String; public let membershipId: String; public let membershipVersion: Int
    public let sourceClassification: String; public let status: String
    public let annualCaptureId: String?; public let halfYearCaptureId: String?
    public let annualPeriodEnds: [String]; public let halfYearPeriodEnds: [String]; public let latestHalfYearPeriodEnd: String?
    public let values: [FutuFinancialHistoryValue]; public let gaps: [String]
    public let captureLimitations: [String]?
    public let observedCurrencyCode: String?
    public let comparisonNotices: [ComparisonNotice]
    public let issuerOriginalVerification: String; public let restatementComparability: String
    public let latestRequiredFiling: String

    public func validates(_ membership: CandidateMembershipData) -> Bool {
        guard symbol == membership.symbol, membershipId == membership.id,
              membershipVersion == membership.version,
              sourceClassification == "futu_opend_financial_statement_provider",
              ["available", "partial", "unavailable"].contains(status), annualPeriodEnds.count <= 5,
              halfYearPeriodEnds.count <= 2,
              captureLimitations.map({ $0.count <= 30 && $0.allSatisfy { !$0.isEmpty } }) != false,
              observedCurrencyCode.map({ $0.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil }) != false,
              (captureLimitations == nil || status != "available" ||
                (gaps.isEmpty && annualPeriodEnds.count == 5 && halfYearPeriodEnds.count == 2
                  && values.count == 35 && Set(values.map(\.currencyCode)) == Set([observedCurrencyCode].compactMap { $0 }))),
              issuerOriginalVerification == "UNKNOWN", restatementComparability == "UNKNOWN",
              latestRequiredFiling == "UNKNOWN" else { return false }
        return Set(comparisonNotices.map(\.id)).count == comparisonNotices.count
            && comparisonNotices.allSatisfy { $0.sourceUrl.hasPrefix("https://") && !$0.text.isEmpty }
            && Set(values.map(\.id)).count == values.count && values.allSatisfy { value in
            let table: FutuFinancialTable
            let field: Int
            switch value.metric {
            case "revenue": table = .income; field = 5001
            case "profit_attributable_to_owners": table = .income; field = 5051
            case "operating_cash_flow": table = .cash_flow; field = 5001
            case "total_assets": table = .balance_sheet; field = 5001
            case "total_liabilities": table = .balance_sheet; field = 5060
            default: return false
            }
            return value.statementType == table && value.fieldId == field
                && isSafeFutuFinancialHistoryDecimal(value.rawValue)
                && value.currencyCode.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil
                && value.source.rawSha256.count == 64 && value.source.reportSha256.count == 64
                && (value.financialType == "ANNUAL" && annualPeriodEnds.contains(value.periodEnd)
                    || value.financialType == "Q6" && halfYearPeriodEnds.contains(value.periodEnd))
        }
    }
}

private func isSafeFutuFinancialHistoryDecimal(_ raw: String) -> Bool {
    guard raw.count <= 128,
          raw.range(of: "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$", options: .regularExpression) != nil
    else { return false }
    let digits = raw.utf8.filter { $0 >= 48 && $0 <= 57 }
    let significant = Array(digits.drop(while: { $0 == 48 }))
    let safeMaximum = Array("9007199254740991".utf8)
    return significant.count < safeMaximum.count
        || significant.count == safeMaximum.count
            && (significant == safeMaximum || significant.lexicographicallyPrecedes(safeMaximum))
}

struct FutuFinancialAcquisitionProgress {
    private(set) var fingerprint: String?
    private(set) var annualCaptureId: String?
    private(set) var halfYearCaptureId: String?
    private var annualReservation = ResearchDocumentIdempotencyReservation()
    private var halfYearReservation = ResearchDocumentIdempotencyReservation()

    var hasPendingRequest: Bool { annualReservation.key != nil || halfYearReservation.key != nil }
    var isComplete: Bool { annualCaptureId != nil && halfYearCaptureId != nil }

    mutating func clear() {
        fingerprint = nil
        annualCaptureId = nil
        halfYearCaptureId = nil
        annualReservation.clear()
        halfYearReservation.clear()
    }

    mutating func bind(_ value: String) {
        if fingerprint != value { clear(); fingerprint = value }
    }

    mutating func adoptReadHistory(annualCaptureId annual: String?, halfYearCaptureId halfYear: String?) {
        guard fingerprint != nil else { return }
        if self.annualCaptureId == nil && annualReservation.key == nil,
           let annual, researchDocumentIsPositiveIntegerString(annual) { self.annualCaptureId = annual }
        if self.halfYearCaptureId == nil && halfYearReservation.key == nil,
           let halfYear, researchDocumentIsPositiveIntegerString(halfYear) { self.halfYearCaptureId = halfYear }
    }

    func captureId(for selection: String) -> String? {
        switch selection {
        case "annual": annualCaptureId
        case "half_year": halfYearCaptureId
        default: nil
        }
    }

    mutating func reserve(for selection: String, fingerprint expected: String) -> String? {
        guard fingerprint == expected, captureId(for: selection) == nil else { return nil }
        let request = "\(expected):\(selection)"
        return switch selection {
        case "annual": annualReservation.reserve(for: request, prefix: "ios-futu-annual")
        case "half_year": halfYearReservation.reserve(for: request, prefix: "ios-futu-half-year")
        default: nil
        }
    }

    mutating func markReadBack(_ selection: String, id: String, fingerprint expected: String) -> Bool {
        guard fingerprint == expected, researchDocumentIsPositiveIntegerString(id) else { return false }
        switch selection {
        case "annual":
            guard annualReservation.key != nil else { return false }
            annualCaptureId = id
            annualReservation.clear()
        case "half_year":
            guard halfYearReservation.key != nil else { return false }
            halfYearCaptureId = id
            halfYearReservation.clear()
        default: return false
        }
        return true
    }

    mutating func adoptManualReadBack(_ selection: String, id: String, fingerprint expected: String) {
        guard fingerprint == expected, researchDocumentIsPositiveIntegerString(id) else { return }
        if selection == "annual" && annualReservation.key == nil { annualCaptureId = id }
        if selection == "half_year" && halfYearReservation.key == nil { halfYearCaptureId = id }
    }
}

private struct FutuEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T
}

private struct FutuCaptureRequest: Encodable {
    let membershipVersion: Int
    let pageSize: Int
    let maxPagesPerTable: Int
    let userRequested: Bool
    let idempotencyKey: String
    let periodSelection: String?
}

extension ResearchClient {
    private func futuFinancialURL(_ membership: CandidateMembershipData) -> URL {
        baseURL.appending(path: "api").appending(path: "mobile").appending(path: "research")
            .appending(path: "candidate-memberships").appending(path: membership.id)
            .appending(path: "futu-financial-statement-captures")
    }

    public func readFutuFinancialHistory(membership: CandidateMembershipData) async throws -> FutuFinancialHistory {
        var request = URLRequest(url: futuFinancialURL(membership).appending(path: "history"), cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try futuResponse(response)
        let result = try JSONDecoder().decode(FutuEnvelope<FutuFinancialHistory>.self, from: data)
        guard result.ok, result.data.validates(membership) else { throw ResearchDocumentClientError.invalidResponse }
        return result.data
    }

    public func readFutuFinancialMaterialPreview(membership: CandidateMembershipData, captureId: String,
                                                financialType: String, periodEnd: String) async throws -> FutuFinancialMaterialPreview {
        let url = futuFinancialURL(membership).appending(path: captureId).appending(path: "material-preview")
            .appending(queryItems: [URLQueryItem(name: "financialType", value: financialType), URLQueryItem(name: "periodEnd", value: periodEnd)])
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (bytes, response) = try await session.data(for: request)
        try futuResponse(response)
        let result = try JSONDecoder().decode(FutuEnvelope<FutuFinancialMaterialPreview>.self, from: bytes)
        guard result.ok, result.data.validates(membership), result.data.source.captureId == captureId,
              result.data.source.financialType == financialType, result.data.source.periodEnd == periodEnd else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return result.data
    }

    public func saveFutuFinancialMaterialAndReadBack(membership: CandidateMembershipData,
        preview: FutuFinancialMaterialPreview, validUntil: String, idempotencyKey: String) async throws -> (ResearchMaterialData, FrozenResearchEvidenceWorkspace) {
        guard preview.validates(membership) else { throw ResearchDocumentClientError.invalidResponse }
        var request = URLRequest(url: futuFinancialURL(membership).appending(path: preview.source.captureId).appending(path: "materials"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(FutuMaterialRequest(membershipVersion: membership.version,
            financialType: preview.source.financialType, periodEnd: preview.source.periodEnd,
            sourceFingerprint: preview.source.sourceFingerprint, validUntil: validUntil, idempotencyKey: idempotencyKey))
        let (bytes, response) = try await session.data(for: request)
        try futuResponse(response)
        let result = try JSONDecoder().decode(FutuEnvelope<ResearchMaterialData>.self, from: bytes)
        guard result.ok, result.data.validates(expected: membership), result.data.futuFinancialSource == preview.source,
              result.data.contentFingerprint == preview.contentFingerprint, result.data.sourceVersion == preview.sourceVersion,
              result.data.contentText == preview.contentText else { throw ResearchDocumentClientError.invalidResponse }
        let workspace = try await fetchFrozenResearchEvidence(membership: membership)
        guard let material = workspace.data?.materials.first(where: { $0.id == result.data.id }),
              material == result.data else { throw ResearchDocumentClientError.invalidResponse }
        return (material, workspace)
    }

    private func futuResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw ResearchDocumentClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw ResearchDocumentClientError.httpStatus(http.statusCode) }
    }

    public func listFutuFinancialCaptures(membership: CandidateMembershipData) async throws -> [FutuFinancialCapture] {
        var request = URLRequest(url: futuFinancialURL(membership), cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try futuResponse(response)
        let result = try JSONDecoder().decode(FutuEnvelope<[FutuFinancialCapture]>.self, from: data)
        guard result.ok, result.data.count <= 20,
              result.data.allSatisfy({ $0.validates(membership) }) else { throw ResearchDocumentClientError.invalidResponse }
        return result.data
    }

    public func readFutuFinancialCapture(membership: CandidateMembershipData, captureId: String) async throws -> FutuFinancialCapture {
        var request = URLRequest(url: futuFinancialURL(membership).appending(path: captureId), cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try futuResponse(response)
        let result = try JSONDecoder().decode(FutuEnvelope<FutuFinancialCapture>.self, from: data)
        guard result.ok, result.data.id == captureId, result.data.validates(membership) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return result.data
    }

    public func captureFutuFinancialStatements(membership: CandidateMembershipData, pageSize: Int,
                                                maxPagesPerTable: Int, idempotencyKey: String,
                                                periodSelection: String? = nil) async throws -> FutuFinancialCapture {
        guard (1...20).contains(pageSize), (1...4).contains(maxPagesPerTable), !idempotencyKey.isEmpty,
              [nil,"annual","half_year"].contains(periodSelection) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        var request = URLRequest(url: futuFinancialURL(membership), cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(FutuCaptureRequest(membershipVersion: membership.version,
            pageSize: pageSize, maxPagesPerTable: maxPagesPerTable, userRequested: true, idempotencyKey: idempotencyKey,
            periodSelection: periodSelection))
        let (data, response) = try await session.data(for: request)
        try futuResponse(response)
        let result = try JSONDecoder().decode(FutuEnvelope<FutuFinancialCapture>.self, from: data)
        guard result.ok, result.data.validates(membership), result.data.membershipVersion == membership.version else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return result.data
    }

    public func readFutuFinancialOriginal(membership: CandidateMembershipData, capture: FutuFinancialCapture,
                                           page: FutuFinancialPage) async throws -> VerifiedFutuFinancialOriginal {
        guard capture.validates(membership), page.captureId == capture.id,
              capture.pages.contains(where: { $0.id == page.id && $0.rawSha256 == page.rawSha256 }),
              page.originalAvailability == "available" else { throw ResearchDocumentClientError.invalidResponse }
        var request = URLRequest(url: futuFinancialURL(membership).appending(path: capture.id)
            .appending(path: "pages").appending(path: page.id).appending(path: "content"),
            cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try futuResponse(response)
        let dates = ISO8601DateFormatter()
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let http = response as? HTTPURLResponse,
              http.value(forHTTPHeaderField: "x-source-raw-sha256") == page.rawSha256,
              data.count == page.byteLength, researchDocumentSha256(data) == page.rawSha256,
              let text = String(data: data, encoding: .utf8),
              let body = try? JSONDecoder().decode(FutuFinancialOriginal.self, from: data),
              body.ok, body.source == capture.sourceClassification, body.symbol == capture.symbol,
              body.statement_type == page.statementType.bridgeCode, body.num == capture.pageSize,
              let rawCaptured = dates.date(from: body.captured_at),
              let pageCaptured = dates.date(from: page.capturedAt),
              abs(rawCaptured.timeIntervalSince(pageCaptured)) < 0.001,
              body.requested_next_key == page.requestedCursor, body.next_key == page.nextCursor,
              body.report_list.count == page.reports.count,
              zip(body.report_list, page.reports).allSatisfy({ report, summary in
                  report.period_text == summary.periodText && report.financial_type == summary.financialType
                      && report.fiscal_year == summary.fiscalYear && report.currency_code == summary.currencyCode
                      && report.item_list.count == summary.itemCount
              }) else { throw ResearchDocumentClientError.invalidResponse }
        return VerifiedFutuFinancialOriginal(page: page, body: body, rawText: text)
    }
}
