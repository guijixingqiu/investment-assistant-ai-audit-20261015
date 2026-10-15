import SwiftUI
import CryptoKit
import Combine

struct PersonalInvestigationSelection: Identifiable {
    let membershipId: String
    let membershipVersion: Int
    let symbol: String
    let mode: String
    let question: String
    var startAnalysis = false
    var resumeExisting = true
    var eventDate: String? = nil
    var ordinaryChangeContext: PersonalOrdinaryChangeContext? = nil
    var id: String { "\(membershipId):\(membershipVersion):\(mode):\(eventDate ?? "current")" }
}
struct InvestigationSource: Codable, Identifiable {
    let id: String; let symbol: String; let source: String; let sourceType: String
    let retrievedAt: String; let publishedAt: String?; let confidence: String; let readStatus: String
    let text: String; let contentSha256: String; let url: String?; let pageNumber: Int?; let reason: String?
    let documentId: String?
    let documentPdfSha256: String?
    let snapshotCitation: PersonalFormalSnapshotCoordinate?
    var providerMaterialSelection: PersonalFormalProviderSourceHint? = nil
}
struct InvestigationGap: Codable { let reason: String; let text: String }
private struct InvestigationEvidence: Decodable {
    let ok: Bool; let symbol: String; let membershipId: String; let membershipVersion: Int
    let fingerprint: String; let sources: [InvestigationSource]; let gaps: [InvestigationGap]; let summary: String
    let mode: String?; let eventDate: String?
    let historyScope: String?
    let receiptKeyId: String?
    let financialCalculations: InvestigationAnalysis.Finance?
}
struct InvestigationAnalysis: Codable {
    struct Report: Codable {
        struct Section: Codable {
            let heading: String; let text: String; let classification: String; let support: String
            let basis: [Claim.Basis]; let missingEvidence: String
        }
        let sections: [Section]
    }
    struct Claim: Codable, Identifiable {
        struct Basis: Codable { let sourceId: String; let quote: String }
        let text: String; let classification: String; let support: String; let basis: [Basis]; let missingEvidence: String
        var id: String { text }
    }
    let whatHappened: [Claim]; let confirmedInformation: [Claim]
    let possibleExplanations: [Claim]; let weakenedExplanations: [Claim]
    let largestUnknown: InvestigationGap; let nextCheck: String
    struct Judgment: Codable { let importance: Claim; let impact: Claim }
    struct HypothesisResult: Codable, Identifiable {
        let hypothesisId: String; let proposition: String?; let verdict: String; let explanation: String; let checked: String; let remaining: String
        let checkIndexes: [Int]; let basis: [Claim.Basis]
        var id: String { hypothesisId }
    }
    let researchJudgment: Judgment?
    let hypothesisResults: [HypothesisResult]?
    let operatingDrivers: [Claim]?
    struct Reasoning: Codable {
        struct Why: Codable { let why: String?; let ifConfirmed: String?; let ifRejected: String? }
        struct Unknown: Codable { let reason: String; let text: String; let whyThisMatters: Why }
        struct Coverage: Codable { let claim: String; let sourceIds: [String]; let assessment: String; let missingLink: String; let conclusion: String }
        struct Impact: Codable { let classification: String; let text: String; let basis: [Claim.Basis]; let missingEvidence: String }
        struct Explanation: Codable, Identifiable {
            let hypothesisId: String; let rank: Int; let supportingEvidence: [Claim.Basis]; let contradictingEvidence: [Claim.Basis]
            let missingEvidence: String; let confidenceReason: String
            let investigationPriority: Int; let whyInvestigateFirst: String; let neededEvidence: String; let potentialImpact: String
            let whyThisMatters: Why; let claimCoverage: Coverage
            var id: String { hypothesisId }
        }
        struct Step: Codable {
            let text: String; let status: String; let basis: [Claim.Basis]; let gap: InvestigationGap?
            let whyThisMatters: Why
            enum CodingKeys: String, CodingKey { case text, status, basis, gap, whyThisMatters }
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(text, forKey: .text); try container.encode(status, forKey: .status)
                try container.encode(basis, forKey: .basis)
                try container.encode(whyThisMatters, forKey: .whyThisMatters)
                if let gap { try container.encode(gap, forKey: .gap) } else { try container.encodeNil(forKey: .gap) }
            }
        }
        struct Transmission: Codable { let operatingFact: Step?; let operatingMeaning: Step?; let earnings: Step?; let cashFlow: Step?; let valuation: Step? }
        struct Question: Codable { let hypothesisId: String; let question: String; let whyImportant: String; let neededEvidence: String; let why: String?; let ifConfirmed: String?; let ifRejected: String? }
        let summary: String; let thesisImpact: Impact?; let earningsImpact: Impact?; let valuationImpact: Impact?
        let explanations: [Explanation]; let transmission: Transmission; let unknowns: [Unknown]; let nextQuestions: [Question]
    }
    struct Finance: Codable {
        struct Period: Codable { let start: String; let end: String; let type: String }
        struct Fact: Codable, Identifiable {
            struct Source: Codable { let sourceId: String; let pageNumber: Int; let url: String; let quote: String; let contentSha256: String; let periodHeader: String; let unitHeader: String }
            let id: String; let metric: String; let label: String; let value: Double; let unitScale: Double; let currency: String
            let period: Period; let accountingScope: String; let businessScope: String; let measurementBasis: String; let restated: Bool; let source: Source
        }
        struct Calculation: Codable, Identifiable {
            let id: String; let metric: String; let label: String; let value: Double; let unit: String; let unitScale: Double; let currency: String
            let period: Period; let formula: String; let operandIds: [String]
        }
        let facts: [Fact]; let calculations: [Calculation]
    }
    let reasoning: Reasoning?
    // Preserve absence in old signed payloads; never synthesize an empty report.
    let report: Report?
    let financialCalculations: Finance?
}
struct InvestigationSendManifest: Codable {
    let sourceCount: Int; let bodyReadCount: Int; let priorTurns: Int
    let holdings: Bool; let notes: Bool; let credentials: Bool; let fullPdf: Bool; let requestSha256: String
}
struct InvestigationTurn: Codable, Identifiable {
    let ok: Bool; let symbol: String; let membershipId: String; let membershipVersion: Int
    let fingerprint: String; let question: String; let analysis: InvestigationAnalysis; let receipt: String
    let receiptKeyId: String?
    let sources: [InvestigationSource]; let gaps: [InvestigationGap]; let generatedAt: String
    let rawAnswer: String?; let sent: InvestigationSendManifest?
    let anchorFingerprint: String?; let eventDate: String?
    let mode: String?
    struct Thesis: Codable { let status: String; let text: String?; let contextId: String?; let fingerprint: String }
    let currentThesis: Thesis?
    struct Investigation: Codable {
        struct Check: Codable { let task: String; let source: String; let status: String; let detail: String; let sourceIds: [String] }
        struct Plan: Codable {
            struct Hypothesis: Codable { let id: String; let explanation: String; let evidenceNeeded: String; let tasks: [String] }
            let hypotheses: [Hypothesis]; let terms: [String]
        }
        let plan: Plan; let checks: [Check]; let rawPlan: String
    }
    let investigation: Investigation?
    var id: String { receipt }
    var generatedDescription: String {
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: generatedAt) ?? ISO8601DateFormatter().date(from: generatedAt) else { return generatedAt }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong"); formatter.dateFormat = "M月d日 HH:mm"
        return formatter.string(from: date) + " 香港时间"
    }
}

enum InvestigationFinancialDisplay {
    static func number(_ value: Double) -> String {
        guard value.isFinite else { return "待核对" }
        if value != 0 && abs(value) < 0.000001 { return String(format: "%.6g", value) }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = value != 0 && abs(value) < 0.01 ? 6 : 2
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
    static func amount(_ value: Double, scale: Double, currency: String) -> String {
        let amount = value * scale
        guard value.isFinite, scale.isFinite, scale > 0, amount.isFinite else { return "金额待核对" }
        let divisor = abs(amount) >= 100_000_000 ? 100_000_000.0 : abs(amount) >= 10_000 ? 10_000.0 : 1.0
        let magnitude = divisor == 100_000_000 ? "亿" : divisor == 10_000 ? "万" : ""
        let unit = ["CNY": "元人民币", "HKD": "港元", "USD": "美元"][currency] ?? (currency.isEmpty ? "（币种待核对）" : " " + currency)
        return number(amount / divisor) + " " + magnitude + unit
    }
    static func calculation(_ value: Double, unit: String, scale: Double, currency: String) -> String {
        if unit == "currency" { return amount(value, scale: scale, currency: currency) }
        if unit == "percent" { return number(value) + "%" }
        if unit == "percentage_points" { return number(value) + " 个百分点" }
        return number(value) + " " + unit
    }
}

@MainActor
enum InvestigationTemporaryRetention {
    static func policy(defaults: UserDefaults = .standard) -> ResearchTemporaryConversationRetention {
        researchTemporaryConversationRetention(defaults: defaults)
    }
    static func date(_ value: String) -> Date? {
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return precise.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    static func keeps(_ savedAt: String, now: Date = Date(), defaults: UserDefaults = .standard) -> Bool {
        guard let interval = policy(defaults: defaults).interval, let saved = date(savedAt),
              saved <= now.addingTimeInterval(300) else { return false }
        return saved.addingTimeInterval(interval) > now
    }
    static func isKnownExpired(_ savedAt: String, now: Date = Date(), defaults: UserDefaults = .standard) -> Bool {
        guard let saved = date(savedAt), let interval = policy(defaults: defaults).interval else { return false }
        return saved.addingTimeInterval(interval) <= now
    }
}

@MainActor
enum InvestigationResultCache {
    private static func clearMarkerKey(_ id: String, _ version: Int, mode: String, eventDate: String?) -> String {
        key(id, version, mode: mode, eventDate: eventDate) + ":cleared-at"
    }
    static func afterLastClear(_ turn: InvestigationTurn, id: String, version: Int, mode: String,
                               eventDate: String?, defaults: UserDefaults = .standard) -> Bool {
        guard let marker = defaults.string(forKey: clearMarkerKey(id, version, mode: mode, eventDate: eventDate)),
              let clearedAt = InvestigationTemporaryRetention.date(marker) else { return true }
        guard let generatedAt = InvestigationTemporaryRetention.date(turn.generatedAt) else { return false }
        return generatedAt >= clearedAt
    }
    static func isRetained(_ turn: InvestigationTurn, now: Date = Date(), defaults: UserDefaults = .standard) -> Bool {
        turn.ok && !turn.receipt.isEmpty && InvestigationTemporaryRetention.keeps(turn.generatedAt, now: now, defaults: defaults)
    }
    private static func retainedTurns(forKey storageKey: String, now: Date, defaults: UserDefaults) -> [InvestigationTurn] {
        guard let data = defaults.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([InvestigationTurn].self, from: data) else { return [] }
        let stored = decoded.filter { !InvestigationTemporaryRetention.isKnownExpired($0.generatedAt, now: now, defaults: defaults) }
        if stored.count != decoded.count {
            if stored.isEmpty { defaults.removeObject(forKey: storageKey) }
            else if let bytes = try? JSONEncoder().encode(stored) { defaults.set(bytes, forKey: storageKey) }
        }
        // Undated or malformed legacy turns stay in local storage for an explicit
        // user decision, but never become current history or a follow-up prior.
        return stored.filter { isRetained($0, now: now, defaults: defaults) }
    }
    private static func retainedTurn(forKey storageKey: String, now: Date, defaults: UserDefaults) -> InvestigationTurn? {
        guard let data = defaults.data(forKey: storageKey),
              let turn = try? JSONDecoder().decode(InvestigationTurn.self, from: data) else { return nil }
        if InvestigationTemporaryRetention.isKnownExpired(turn.generatedAt, now: now, defaults: defaults) {
            defaults.removeObject(forKey: storageKey)
            return nil
        }
        return isRetained(turn, now: now, defaults: defaults) ? turn : nil
    }
    static func canResume(_ turn: InvestigationTurn, fingerprint: String, receiptKeyId: String?) -> Bool {
        guard let receiptKeyId, receiptKeyId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return false }
        return turn.fingerprint == fingerprint && turn.receiptKeyId == receiptKeyId
    }
    static func archiveKey(scope: String?, id: String, version: Int, mode: String, eventDate: String?) -> String? {
        guard let scope, scope.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        let identity = AppEnvironment.baseURL().absoluteString + ":" + scope
        let originScope = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return "investigation-history-v6:\(originScope):\(id):\(version):\(mode):\(eventDate ?? "")"
    }
    static func key(_ id: String, _ version: Int, mode: String = "earnings_quality", eventDate: String? = nil) -> String {
        let identity = AppEnvironment.baseURL().absoluteString + (AppEnvironment.researchAuthorizationContext().readToken ?? "")
        let scope = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return "investigation-summary-v5:\(scope):\(id):\(version):\(mode):\(eventDate ?? "")"
    }
    static func legacyKey(_ id: String, _ version: Int) -> String {
        let identity = AppEnvironment.baseURL().absoluteString + (AppEnvironment.researchAuthorizationContext().readToken ?? "")
        let scope = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return "investigation-summary-v4:\(scope):\(id):\(version)"
    }
    static func history(id: String, version: Int, symbol: String, mode: String, eventDate: String?,
                        archiveKey: String? = nil, now: Date = Date(), defaults: UserDefaults = .standard) -> [InvestigationTurn] {
        guard InvestigationTemporaryRetention.policy(defaults: defaults) != .none else { return [] }
        let storageKey = key(id, version, mode: mode, eventDate: eventDate)
        var values = retainedTurns(forKey: storageKey + ":history", now: now, defaults: defaults)
        if let latest = retainedTurn(forKey: storageKey, now: now, defaults: defaults),
           !values.contains(where: { $0.receipt == latest.receipt }) { values.append(latest) }
        if let archiveKey {
            let archived = retainedTurns(forKey: archiveKey, now: now, defaults: defaults)
            for turn in archived where !values.contains(where: { $0.receipt == turn.receipt }) { values.append(turn) }
        }
        return values.filter { $0.ok && $0.membershipId == id && $0.membershipVersion == version && $0.symbol == symbol
            && ($0.mode ?? ($0.eventDate == nil ? "earnings_quality" : "price_move")) == mode && $0.eventDate == eventDate
            && afterLastClear($0, id: id, version: version, mode: mode, eventDate: eventDate, defaults: defaults) }
            .sorted { $0.generatedAt < $1.generatedAt }
    }
    @discardableResult
    static func archiveCurrentHistory(id: String, version: Int, symbol: String, mode: String, eventDate: String?,
                                      archiveKey: String?, defaults: UserDefaults = .standard) -> Bool {
        // Called only after the existing authenticated evidence response has
        // matched the current connection and selection. Never scan old tokens.
        guard let archiveKey, InvestigationTemporaryRetention.policy(defaults: defaults) != .none else { return true }
        var values: [InvestigationTurn] = []
        if let bytes = defaults.data(forKey: archiveKey) {
            guard let decoded = try? JSONDecoder().decode([InvestigationTurn].self, from: bytes) else { return false }
            values = decoded
        }
        if defaults.string(forKey: clearMarkerKey(id, version, mode: mode, eventDate: eventDate)) != nil {
            values = values.filter { afterLastClear($0, id: id, version: version, mode: mode,
                                                      eventDate: eventDate, defaults: defaults) }
        }
        for turn in history(id: id, version: version, symbol: symbol, mode: mode, eventDate: eventDate, defaults: defaults)
        where !values.contains(where: { $0.receipt == turn.receipt }) { values.append(turn) }
        if values.isEmpty {
            defaults.removeObject(forKey: archiveKey)
            return defaults.data(forKey: archiveKey) == nil
        }
        guard let bytes = try? JSONEncoder().encode(values) else { return false }
        defaults.set(bytes, forKey: archiveKey)
        return defaults.data(forKey: archiveKey) == bytes
    }
    @discardableResult
    static func save(_ answer: InvestigationTurn, archiveKey: String? = nil,
                     defaults: UserDefaults = .standard) -> Bool {
        guard isRetained(answer, defaults: defaults) else { return false }
        let mode = answer.mode ?? (answer.eventDate == nil ? "earnings_quality" : "price_move")
        guard afterLastClear(answer, id: answer.membershipId, version: answer.membershipVersion,
                             mode: mode, eventDate: answer.eventDate, defaults: defaults) else { return false }
        let storageKey = key(answer.membershipId, answer.membershipVersion, mode: mode, eventDate: answer.eventDate)
        let historyKey = storageKey + ":history"
        var archived: [InvestigationTurn] = []
        if let bytes = defaults.data(forKey: historyKey) {
            guard let decoded = try? JSONDecoder().decode([InvestigationTurn].self, from: bytes) else { return false }
            archived = decoded
        }
        archived.removeAll { InvestigationTemporaryRetention.isKnownExpired($0.generatedAt, defaults: defaults) }
        for turn in history(id: answer.membershipId, version: answer.membershipVersion, symbol: answer.symbol,
                            mode: mode, eventDate: answer.eventDate, defaults: defaults)
        where !archived.contains(where: { $0.receipt == turn.receipt }) { archived.append(turn) }
        if !archived.contains(where: { $0.receipt == answer.receipt }) { archived.append(answer) }
        guard let historyData = try? JSONEncoder().encode(archived),
              let answerData = try? JSONEncoder().encode(answer) else { return false }
        let previousHistory = defaults.data(forKey: historyKey)
        let previousAnswer = defaults.data(forKey: storageKey)
        let previousArchive = archiveKey.flatMap { defaults.data(forKey: $0) }
        defaults.set(historyData, forKey: historyKey)
        defaults.set(answerData, forKey: storageKey)
        let archiveSaved = archiveCurrentHistory(id: answer.membershipId, version: answer.membershipVersion,
            symbol: answer.symbol, mode: mode, eventDate: answer.eventDate, archiveKey: archiveKey, defaults: defaults)
        let saved = archiveSaved && defaults.data(forKey: storageKey) == answerData
            && defaults.data(forKey: historyKey) == historyData
            && history(id: answer.membershipId, version: answer.membershipVersion, symbol: answer.symbol,
                       mode: mode, eventDate: answer.eventDate, archiveKey: archiveKey, defaults: defaults)
            .contains(where: { $0.receipt == answer.receipt })
        if !saved {
            if let previousHistory { defaults.set(previousHistory, forKey: historyKey) }
            else { defaults.removeObject(forKey: historyKey) }
            if let previousAnswer { defaults.set(previousAnswer, forKey: storageKey) }
            else { defaults.removeObject(forKey: storageKey) }
            if let archiveKey {
                if let previousArchive { defaults.set(previousArchive, forKey: archiveKey) }
                else { defaults.removeObject(forKey: archiveKey) }
            }
        }
        return saved
    }
    @discardableResult
    static func saveSession(_ values: [InvestigationTurn], forKey storageKey: String,
                            defaults: UserDefaults = .standard) -> Bool {
        guard InvestigationTemporaryRetention.policy(defaults: defaults) != .none,
              !values.isEmpty, values.allSatisfy({ isRetained($0, defaults: defaults) }),
              let currentData = try? JSONEncoder().encode(Array(values.suffix(2))) else { return false }
        var quarantined: [InvestigationTurn] = []
        if let bytes = defaults.data(forKey: storageKey) {
            guard let decoded = try? JSONDecoder().decode([InvestigationTurn].self, from: bytes) else { return false }
            quarantined = decoded.filter { !isRetained($0, defaults: defaults)
                && !InvestigationTemporaryRetention.isKnownExpired($0.generatedAt, defaults: defaults) }
        }
        let data = quarantined.isEmpty ? currentData : (try? JSONEncoder().encode(quarantined + Array(values.suffix(2))))
        guard let data else { return false }
        defaults.set(data, forKey: storageKey)
        return defaults.data(forKey: storageKey) == data
            && retainedTurns(forKey: storageKey, now: Date(), defaults: defaults).map(\.receipt)
            == Array(values.suffix(2)).map(\.receipt)
    }
    static func session(forKey storageKey: String, now: Date = Date(), defaults: UserDefaults = .standard) -> [InvestigationTurn] {
        guard InvestigationTemporaryRetention.policy(defaults: defaults) != .none else { return [] }
        return retainedTurns(forKey: storageKey, now: now, defaults: defaults)
    }
    @discardableResult
    static func saveRawResponse(_ data: Data, forKey storageKey: String, defaults: UserDefaults = .standard) -> Bool {
        guard InvestigationTemporaryRetention.policy(defaults: defaults) != .none else { return false }
        let key = storageKey + ":raw-response"
        let savedAt = ISO8601DateFormatter().string(from: Date())
        defaults.set(data, forKey: key)
        defaults.set(savedAt, forKey: key + "-saved-at")
        return defaults.data(forKey: key) == data && defaults.string(forKey: key + "-saved-at") == savedAt
    }
    static func pruneRawResponses(now: Date = Date(), defaults: UserDefaults = .standard) {
        guard InvestigationTemporaryRetention.policy(defaults: defaults) != .none else { return }
        let keys = defaults.dictionaryRepresentation().keys.filter {
            $0.hasPrefix("investigation-summary-v5:") && $0.hasSuffix(":raw-response")
        }
        for key in keys {
            let dateKey = key + "-saved-at"
            if let savedAt = defaults.string(forKey: dateKey),
               InvestigationTemporaryRetention.isKnownExpired(savedAt, now: now, defaults: defaults) {
                defaults.removeObject(forKey: key)
                defaults.removeObject(forKey: dateKey)
            }
            // Old raw responses without a trustworthy date remain quarantined
            // until the user explicitly clears their temporary scope.
        }
    }
    @discardableResult
    static func clearCurrent(id: String, version: Int, mode: String, eventDate: String?,
                             archiveKey: String?, defaults: UserDefaults = .standard) -> Bool {
        let base = key(id, version, mode: mode, eventDate: eventDate)
        let keys = defaults.dictionaryRepresentation().keys.filter { key in
            key == base || key == base + ":history"
                || key == base + ":draft" || key == base + ":new-question-draft"
                || key.hasPrefix(base + ":turns:") || key.hasPrefix(base + ":reading-chapter-v1:")
        }
        for key in keys { defaults.removeObject(forKey: key) }
        if let archiveKey { defaults.removeObject(forKey: archiveKey) }
        let priorScope = SHA256.hash(data: Data((AppEnvironment.researchAuthorizationContext().readToken ?? "").utf8))
            .map { String(format: "%02x", $0) }.joined()
        let selectionId = "\(id):\(version):\(mode):\(eventDate ?? "current")"
        let priorPrefix = "real-investigation-v4:\(priorScope):\(selectionId):\(eventDate ?? ""):"
        let priorKeys = defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix(priorPrefix) }
        for key in priorKeys { defaults.removeObject(forKey: key) }
        // v4 predates mode/date keys. Its exact connection + membership key is
        // explicitly included in this clear, even if its payload cannot decode.
        let oldKey = legacyKey(id, version)
        defaults.removeObject(forKey: oldKey)
        let marker = ISO8601DateFormatter().string(from: Date())
        let markerKey = clearMarkerKey(id, version, mode: mode, eventDate: eventDate)
        defaults.set(marker, forKey: markerKey)
        return keys.allSatisfy { defaults.object(forKey: $0) == nil }
            && (archiveKey == nil || defaults.object(forKey: archiveKey!) == nil)
            && priorKeys.allSatisfy { defaults.object(forKey: $0) == nil }
            && defaults.string(forKey: markerKey) == marker
            && defaults.object(forKey: oldKey) == nil
    }
    @discardableResult
    static func clearAllTemporary(defaults: UserDefaults = .standard) -> Bool {
        clearAllLocalTemporaryResearch(defaults: defaults)
    }
    static func read(id: String, version: Int, symbol: String, anchor: String? = nil,
                     mode: String = "earnings_quality", eventDate: String? = nil) async -> InvestigationTurn? {
        let clearMarker = researchTemporaryConversationClearMarker()
        guard InvestigationTemporaryRetention.policy() != .none,
              let turn = retainedTurn(forKey: key(id, version, mode: mode, eventDate: eventDate), now: Date(), defaults: .standard)
                ?? retainedTurn(forKey: legacyKey(id, version), now: Date(), defaults: .standard),
              turn.membershipId == id, turn.membershipVersion == version, turn.symbol == symbol,
              turn.eventDate == eventDate, turn.mode == nil || turn.mode == mode,
              afterLastClear(turn, id: id, version: version, mode: mode, eventDate: eventDate),
              anchor == nil || turn.anchorFingerprint == anchor, turn.analysis.reasoning != nil else { return nil }
        guard await isCurrent(turn, mode: mode),
              researchTemporaryConversationClearMarker() == clearMarker else { return nil }
        return turn
    }
    private static func isCurrent(_ turn: InvestigationTurn, mode: String) async -> Bool {
        let url = AppEnvironment.baseURL().appending(path: "api/mobile/research/candidate-memberships/\(turn.membershipId)/personal-brief/investigations")
            .appending(queryItems: [URLQueryItem(name: "mode", value: mode)] + (mode == "price_move" ? [URLQueryItem(name: "eventDate", value: turn.eventDate)] : []))
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        let auth = AppEnvironment.researchAuthorizationContext()
        if let token = auth.readToken { request.setValue(token, forHTTPHeaderField: auth.readHeaderName) }
        guard let (bytes, response) = try? await URLSession.shared.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200,
              let evidence = try? JSONDecoder().decode(InvestigationEvidence.self, from: bytes) else { return false }
        return evidence.ok && evidence.symbol == turn.symbol && evidence.membershipId == turn.membershipId
            && evidence.membershipVersion == turn.membershipVersion && canResume(turn, fingerprint: evidence.fingerprint, receiptKeyId: evidence.receiptKeyId)
            && evidence.mode == mode && evidence.eventDate == turn.eventDate
    }
    static func currentPrice(id: String, version: Int, symbol: String) async -> InvestigationTurn? {
        let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong"); formatter.dateFormat = "yyyy-MM-dd"
        return await read(id: id, version: version, symbol: symbol, mode: "price_move", eventDate: formatter.string(from: Date()))
    }
}

private struct InvestigationDraft: Codable {
    let question: String
    let issue: String?
    let entryQuestion: String?
    let startsNewConversation: Bool?
    let savedAt: String?
}

private enum InvestigationDraftRead {
    case available(InvestigationDraft)
    case undatedLegacy
    case expired
    case unavailable
}

@MainActor
private enum InvestigationDraftStore {
    @discardableResult
    static func save(_ draft: InvestigationDraft, forKey key: String, defaults: UserDefaults = .standard) -> Bool {
        guard InvestigationTemporaryRetention.policy(defaults: defaults) != .none,
              !draft.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let bytes = try? JSONEncoder().encode(draft) else { return false }
        defaults.set(bytes, forKey: key)
        return defaults.data(forKey: key) == bytes
    }
    static func read(forKey key: String, entryQuestion: String, now: Date = Date(),
                     defaults: UserDefaults = .standard) -> InvestigationDraftRead {
        guard InvestigationTemporaryRetention.policy(defaults: defaults) != .none,
              let bytes = defaults.data(forKey: key),
              let draft = try? JSONDecoder().decode(InvestigationDraft.self, from: bytes) else { return .unavailable }
        guard let savedAt = draft.savedAt else { return .undatedLegacy }
        if InvestigationTemporaryRetention.isKnownExpired(savedAt, now: now, defaults: defaults) {
            defaults.removeObject(forKey: key)
            return .expired
        }
        guard InvestigationTemporaryRetention.keeps(savedAt, now: now, defaults: defaults),
              (draft.entryQuestion == nil || draft.entryQuestion == entryQuestion || draft.question == entryQuestion)
        else { return .unavailable }
        return .available(draft)
    }
}

struct InvestigationResultSummary: View {
    let turn: InvestigationTurn
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("核心结论").font(.headline)
                Spacer()
                Text("AI 解释").font(.caption).foregroundStyle(Theme.gold)
            }
            Text(turn.analysis.reasoning?.summary ?? turn.analysis.whatHappened.first?.text ?? "本次还没有可引用的结论。")
                .font(.title3.weight(.semibold)).textSelection(.enabled)
            Text("分析于 \(turn.generatedDescription)\(turn.eventDate.map { " · 事件日 \($0)" } ?? "")")
                .font(.footnote).foregroundStyle(Theme.textSecondary)
            Divider()
            Text("原文依据").font(.headline)
            ForEach(Array(turn.analysis.confirmedInformation.prefix(3))) { fact in
                VStack(alignment: .leading, spacing: 10) {
                    Text(fact.text).font(.body).textSelection(.enabled)
                    ForEach(fact.basis.indices, id: \.self) { index in
                        DisclosureGroup("查看引用原文") {
                            Text(fact.basis[index].quote).font(.callout).textSelection(.enabled)
                            if let source = turn.sources.first(where: { $0.id == fact.basis[index].sourceId }),
                               let raw = source.url, let url = URL(string: raw), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                                Link(source.pageNumber.map { "打开原始来源 · 引用第\($0)页" } ?? "打开原始来源", destination: url)
                                    .frame(minHeight: 44)
                            } else { Text("当前引用未提供可打开的来源网址。").font(.footnote) }
                        }.font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
                Divider()
            }
            Text("仍未解决的问题").font(.headline)
            Text(turn.analysis.largestUnknown.text).font(.body).textSelection(.enabled)
            Text(turn.analysis.nextCheck).font(.callout).foregroundStyle(Theme.textSecondary)
        }.accessibilityIdentifier("investigationResultSummary")
    }
}

struct PersonalInvestigationView: View {
    let selection: PersonalInvestigationSelection
    @ObservedObject private var store = OwnerClientStore.shared
    @AppStorage(researchTemporaryConversationRetentionDefaultsKey) private var temporaryRetentionRaw =
        ResearchTemporaryConversationRetention.thirtyDays.rawValue
    @State private var operationRevision = UUID()
    @State private var loadedScope: String?
    @State private var history: [InvestigationTurn] = []
    @State private var historyArchiveKey: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var evidence: InvestigationEvidence?
    @State private var turns: [InvestigationTurn] = []
    @State private var oldAnswer: InvestigationTurn?
    @State private var readFinancial: InvestigationAnalysis.Finance?
    @FocusState private var questionFocused: Bool
    @State private var question = ""
    @State private var issue: String?
    @State private var busy = false
    @State private var needsReload = false
    @State private var initialAnalysisPending = false
    @State private var draftReady = false
    @State private var composing = false
    @State private var startsNewConversation = false
    @State private var preparingSources = false
    @State private var selectedDate = Date()
    @State private var selectedProviderSourceIds: Set<String> = []
    @State private var selectedManualSourceIds: Set<String> = []
    @State private var visibleReportChapter: String?
    @State private var readingReceipt: String?
    @State private var sourceCitation: ReportCitation?
    @State private var clearingCurrentConversation = false
    @State private var temporaryConversationNotice: String?
    @State private var pendingRetentionRaw: String?
    @State private var observedClearMarker: String?
    private var requestedDate: String? {
        guard selection.mode == "price_move" else { return nil }
        let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: selectedDate)
    }

    private func matchesChangeSource(_ source: InvestigationSource, fact: OperatingFact) -> Bool {
        guard source.symbol == fact.symbol, source.readStatus == "BODY_READ",
              source.publishedAt.map({ String($0.prefix(10)) }) == String(fact.source.publishedAt.prefix(10)),
              fact.source.hasValidCitation else { return false }
        if let citation = fact.source.snapshotCitation, let original = fact.source.snapshotOriginal,
           let selected = source.snapshotCitation {
            return source.sourceType == "official_body"
                && selected.snapshotId == citation.snapshotId
                && selected.rawSha256 == original.rawSha256
                && selected.textSha256 == citation.textSha256
                && selected.excerptSha256 == citation.excerptSha256
                && source.contentSha256 == citation.textSha256
        }
        return source.sourceType == "official_pdf"
            && source.documentId == fact.source.documentId
            && source.pageNumber == fact.source.pageNumber
            && source.documentPdfSha256 == fact.source.documentPdfSha256
            && source.contentSha256 == fact.source.pageTextSha256
    }

    private func changeSourceRole(_ source: InvestigationSource) -> String? {
        guard let context = selection.ordinaryChangeContext else { return nil }
        if let comparison = context.comparison {
            if matchesChangeSource(source, fact: comparison.earlier) { return "较早披露原件" }
            if matchesChangeSource(source, fact: comparison.later) { return "较新披露原件" }
        }
        if context.sourceFacts.contains(where: { matchesChangeSource(source, fact: $0) }) {
            return "资料变化候选原件"
        }
        return nil
    }

    private var selectedChangeSourcesAreComplete: Bool {
        guard let context = selection.ordinaryChangeContext else { return true }
        guard let sources = evidence?.sources else { return false }
        let facts = context.comparison.map { [$0.earlier, $0.later] }
            ?? context.sourceFacts.filter { $0.id == context.selectedFactId }
        guard !facts.isEmpty else { return false }
        return facts.allSatisfy { fact in
            sources.contains { selectedManualSourceIds.contains($0.id) && matchesChangeSource($0, fact: fact) }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(selection.symbol).font(.caption).foregroundStyle(Theme.textSecondary)
                    DisclosureGroup("临时会话与草稿") {
                        Picker("本机保留期", selection: $temporaryRetentionRaw) {
                            ForEach(ResearchTemporaryConversationRetention.allCases, id: \.rawValue) { policy in
                                Text(policy.title).tag(policy.rawValue)
                            }
                        }.disabled(busy).accessibilityIdentifier("investigationTemporaryRetention")
                        Text("默认 30 天，可改为 7 天或不保留。管理本机临时回答、历史追问、草稿及原始响应；正式报告、独立导出与开发验证原件不在此范围。")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                        Button("清除当前临时会话", role: .destructive) { clearingCurrentConversation = true }
                            .disabled(busy || evidence == nil).accessibilityIdentifier("clearCurrentInvestigationConversation")
                        if evidence == nil {
                            Text("先读取当前资料以确认连接范围，再清除这一会话；选择不保留会清除全部本机临时会话。")
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        if let temporaryConversationNotice {
                            Text(temporaryConversationNotice).font(.footnote).foregroundStyle(Theme.textSecondary)
                                .accessibilityIdentifier("investigationTemporaryConversationNotice")
                        }
                    }.font(.caption)
                    if selection.mode == "price_move" {
                        HStack {
                            DatePicker("事件日期", selection: $selectedDate, in: ...Date(), displayedComponents: .date)
                                .environment(\.timeZone, TimeZone(identifier: "Asia/Hong_Kong")!)
                                .environment(\.locale, Locale(identifier: "zh_CN"))
                                .disabled(busy)
                                .onChange(of: selectedDate) { _, _ in
                                    if draftReady {
                                        evidence = nil; turns = []; issue = nil; needsReload = false; initialAnalysisPending = false
                                        startsNewConversation = !selection.resumeExisting
                                        restoreDraft()
                                    }
                                }
                            Button("读取") { Task { await load() } }.disabled(busy)
                        }.font(.caption)
                        Text("调查指定日期已保存的异常观察；不会把历史行情标作今天。")
                            .font(.caption2).foregroundStyle(Theme.textSecondary)
                    }
                    if !history.isEmpty {
                        DisclosureGroup("历史报告（\(history.count)）") {
                            if let current = turns.last, let previous = history.last(where: { $0.receipt != current.receipt }) {
                                NavigationLink("查看最近两次研究的变化") {
                                    InvestigationReportComparison(previous: previous, current: current)
                                }.font(.headline).padding(.vertical, 8)
                            }
                            Text("保留历史观点供比较。资料或连接更新后，历史报告仅供阅读，不会自动作为本轮追问依据。").font(.footnote).foregroundStyle(Theme.textSecondary)
                            ForEach(Array(history.reversed())) { previous in
                                NavigationLink {
                                    InvestigationHistoryReader(turn: previous, archived: true) { text in
                                        startsNewConversation = true; turns = []
                                        question = "请重新核对历史研究问题：" + previous.question + "。进一步分析：" + text
                                        composing = true; questionFocused = true
                                    }
                                } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(previous.question)
                                        Text(previous.generatedDescription).font(.caption)
                                    }.padding(.vertical, 8)
                                }
                            }
                        }
                    }
                    if let oldAnswer {
                        DisclosureGroup("旧版分析已过期（仅供历史查看）") {
                            Text("这份历史回答尚未按当前资料和校验规则重新确认，仅供查阅，不作为本轮追问依据。").font(.caption)
                            Text(oldAnswer.question); Text(oldAnswer.analysis.reasoning?.summary ?? "")
                        }.font(.caption).accessibilityIdentifier("expiredInvestigationHistory")
                    }
                    if let evidence {
                        if turns.isEmpty {
                            Text(issue == nil ? "尚未生成这次研究的报告" : "这次研究尚未完成").font(.title3.bold())
                            Text(hasUsableEvidence ? "提出你想弄清的问题，研究助手会结合资料形成分析，并保留可查证的依据。下方可以先阅读原始资料。" : "先获取公司的公开资料，再提出研究问题。")
                                .font(.subheadline).foregroundStyle(Theme.textSecondary)
                            Text(readingCoverage(evidence.sources))
                                .font(.subheadline).accessibilityIdentifier("investigationReadingCoverage")
                            Button("获取或补充公司资料") { preparingSources = true }.frame(minHeight: 44).disabled(busy)
                            Text("从公开来源获取财报并核对是否可用于研究；返回后自动重新读取。仅上传本地 PDF 不会自动授权 AI 使用。")
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                            Button("重新读取资料") { Task { await load() } }.disabled(busy)
                            ForEach(evidence.gaps, id: \.text) { gap in
                                Text(gap.text).font(.caption).foregroundStyle(Theme.textSecondary)
                            }
                        }
                        if turns.isEmpty, let financial = readFinancial, !financial.facts.isEmpty {
                            Text("以下为已读财务原文与可复算数值，不代表 AI 分析已通过。")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                            financialDetails(financial)
                        }
                        let providerFinancial = evidence.sources.filter { $0.sourceType == "provider_financial_statement" }
                        if !providerFinancial.isEmpty {
                            Text("OpenD 已保存财务历史 · 提供商原值").font(.headline)
                            Text("币种以各项原始响应为准；未支持的币种不用于量化结论。最新应有披露期、发行人原件、重述可比性和正式事实仍须分别核对。")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                            ForEach(providerFinancial) { source in
                                DisclosureGroup(source.source) {
                                    Text(source.text).font(.caption).textSelection(.enabled)
                                    Text("捕获时间 \(source.retrievedAt)").font(.caption2)
                                    if let selection = source.providerMaterialSelection {
                                        Toggle("正式研究准备使用此期间", isOn: Binding(
                                            get: { selectedProviderSourceIds.contains(source.id) },
                                            set: { use in if use { selectedProviderSourceIds.insert(source.id) }
                                                else { selectedProviderSourceIds.remove(source.id) } }
                                        ))
                                        Text(selection.materials.count == 1 ? "已匹配保存的第三方未核实材料；进入准备页后仍须确认发送范围。"
                                             : "尚无唯一匹配材料；进入准备页可前往 OpenD 资料明确保存，当前问题会保留。")
                                            .font(.caption).foregroundStyle(Theme.textSecondary)
                                    }
                                }
                            }
                        }
                        if let turn = turns.last {
                            InvestigationReportReader(turn: turn) { followup in
                                question = followup
                                composing = true
                                questionFocused = true
                            }.accessibilityIdentifier("realInvestigationAnswer")
                            if turns.count > 1 {
                                DisclosureGroup("此前的研究与追问（\(turns.count - 1)）") {
                                    ForEach(Array(turns.dropLast().reversed())) { previous in
                                        NavigationLink {
                                            InvestigationHistoryReader(turn: previous, archived: false) { followup in
                                                question = followup; composing = true; questionFocused = true
                                            }
                                        } label: {
                                            VStack(alignment: .leading, spacing: 6) {
                                                Text(previous.question)
                                                Text(previous.generatedDescription).font(.caption)
                                            }.padding(.vertical, 8)
                                        }
                                    }
                                }
                            }
                            if let financial = turn.analysis.financialCalculations { financialDetails(financial) }
                        }
                        DisclosureGroup("已检查的来源与原文（\((turns.last?.sources ?? evidence.sources).count)）") {
                            if let comparison = selection.ordinaryChangeContext?.comparison {
                                ForEach([comparison.earlier, comparison.later], id: \.id) { fact in
                                    let role = fact.id == comparison.earlier.id ? "较早" : "较新"
                                    if let source = evidence.sources.first(where: { matchesChangeSource($0, fact: fact) }) {
                                        Text("\(role)披露候选：\(source.source) · \(String(fact.source.publishedAt.prefix(10)))；请展开核对并勾选。")
                                            .font(.caption).foregroundStyle(Theme.blue)
                                    } else {
                                        Text("\(role)披露原件未在本次已读资料中匹配；请补充原件后重新读取。")
                                            .font(.caption).foregroundStyle(Theme.gold)
                                    }
                                }
                            } else if let context = selection.ordinaryChangeContext {
                                ForEach(context.sourceFacts) { fact in
                                    if let source = evidence.sources.first(where: { matchesChangeSource($0, fact: fact) }) {
                                        Text("资料变化候选：\(source.source) · 公开于 \(String(fact.source.publishedAt.prefix(10)))；请展开核对后自行勾选。")
                                            .font(.caption).foregroundStyle(Theme.blue)
                                    } else {
                                        Text("这条历史资料原件未在本次已读来源中匹配；可补充原件，也可选择其他已核对来源记录普通判断。")
                                            .font(.caption).foregroundStyle(Theme.gold)
                                    }
                                }
                            }
                            ForEach(turns.last?.sources ?? evidence.sources) { source in
                                DisclosureGroup("\(source.id) · \(source.source)\(source.pageNumber.map { " · 第\($0)页" } ?? "")") {
                                    if let role = changeSourceRole(source) {
                                        Text("与本次经营变化的\(role)匹配；请打开原件核对，再自行勾选。")
                                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.blue)
                                    }
                                    Text(source.sourceType == "provider_financial_statement" ? "OpenD 提供商原值已读 · 非发行人核验" : source.readStatus == "BODY_READ" ? "正文／行情已读" : source.readStatus == "LEAD_ONLY" ? "只有标题 · 未核验线索" : "检索范围记录")
                                        .font(.caption.bold()).foregroundStyle(Theme.gold)
                                    if let reason = source.reason { Text(reason).font(.caption) }
                                    Text(source.text).font(.caption).textSelection(.enabled)
                                    Text("取得时间 \(source.retrievedAt)").font(.caption2)
                                    if source.readStatus == "BODY_READ" && source.sourceType != "provider_financial_statement" {
                                        Button("核对已读原件") {
                                            sourceCitation = ReportCitation(source: source, quote: nil)
                                        }.frame(minHeight: 44).accessibilityIdentifier("investigationReadOriginal-\(source.id)")
                                    }
                                    if source.readStatus == "BODY_READ",
                                       ["official_pdf", "official_body", "provider_financial_statement"].contains(source.sourceType),
                                       (source.sourceType != "official_pdf" || source.documentId != nil && source.documentPdfSha256 != nil),
                                       evidence.sources.contains(where: { current in
                                           current.id == source.id && current.sourceType == source.sourceType
                                               && current.contentSha256 == source.contentSha256
                                               && current.url == source.url && current.pageNumber == source.pageNumber
                                               && current.documentId == source.documentId
                                               && current.documentPdfSha256 == source.documentPdfSha256
                                               && current.providerMaterialSelection == source.providerMaterialSelection
                                       }) {
                                        Toggle("手动研究使用这条来源", isOn: Binding(
                                            get: { selectedManualSourceIds.contains(source.id) },
                                            set: { use in if use { selectedManualSourceIds.insert(source.id) }
                                                else { selectedManualSourceIds.remove(source.id) } }
                                        ))
                                        .accessibilityIdentifier("manualSourceSelection-\(source.id)")
                                    }
                                    if source.sourceType == "official_pdf", source.documentId == nil {
                                        Text("这份在线 PDF 尚未保存原件。请到资料区导入并核对官方 PDF，再重新选材。")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    if let raw = source.url, let url = URL(string: raw) { Link("打开原始来源", destination: url).font(.caption) }
                                }.font(.caption).padding(.vertical, 5)
                            }
                        }.padding(12).templateCardStyle()
                        DisclosureGroup("技术详情") {
                            Text("资料指纹：\(evidence.fingerprint)").textSelection(.enabled)
                            Text("研究服务：已授权 DeepSeek。先提出候选解释，再在统一预算内核查并分析。发送公开资料、当前正式研究判断（若存在）和此前两轮问答；不发送持仓或笔记。")
                            if let loop = turns.last?.investigation {
                                ForEach(loop.checks.indices, id: \.self) { index in
                                    Text("\(loop.checks[index].source)：\(loop.checks[index].detail)")
                                }
                            }
                        }.font(.caption2)
                    } else if busy { ProgressView("正在读取官方资料、新闻正文与行情…") }
                    else { Button("重新读取资料") { Task { await load() } } }
                    if needsReload { Button("重新读取更新后的资料") { Task { await load() } }.buttonStyle(.bordered) }
                    if evidence == nil, let issue { Text(issue).font(.body).foregroundStyle(Theme.amber).accessibilityIdentifier("investigationIssue") }
                }.padding(24)
            }.scrollPosition(id: $visibleReportChapter, anchor: .top)
                .safeAreaInset(edge: .top, spacing: 0) {
                if let turn = turns.last {
                    InvestigationReportDirectory(turn: turn) { target in
                        withAnimation { visibleReportChapter = target }
                    }
                }
            }.safeAreaInset(edge: .bottom) {
                if evidence != nil {
                    if dynamicTypeSize.isAccessibilitySize {
                        Button { composing = true; questionFocused = true } label: {
                            Label(composerLabel, systemImage: "bubble.left.and.text.bubble.right")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(.borderedProminent).accessibilityIdentifier("openInvestigationQuestionComposer")
                            .padding(.horizontal, 24).padding(.vertical, 8).background(Theme.bgPrimary)
                    } else if composing || busy {
                        questionComposer.padding(.horizontal, 24).padding(.vertical, 8).background(Theme.bgPrimary)
                    } else {
                        Button { composing = true; questionFocused = true } label: {
                            Label(composerLabel, systemImage: "bubble.left.and.text.bubble.right")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(.borderedProminent).accessibilityIdentifier("openInvestigationQuestionComposer")
                            .padding(.horizontal, 24).padding(.vertical, 8).background(Theme.bgPrimary)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.bgPrimary.ignoresSafeArea()).navigationTitle(turns.isEmpty ? "深度研究" : "研究报告")
                .navigationBarTitleDisplayMode(.inline)
                .tint(Theme.gold)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        if !turns.isEmpty {
                            Menu("研究操作") {
                                Button("提出新的研究问题") {
                                    startsNewConversation = true
                                    turns = []; question = ""; issue = nil; composing = true; questionFocused = true
                                    saveDraft()
                                }
                                Button("检查资料更新") { Task { await load() } }
                                Button("获取或补充资料") { preparingSources = true }
                            }.disabled(busy)
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) { Button("完成") { dismiss() }.disabled(busy) }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("收起键盘") { questionFocused = false } }
                }
                .sheet(isPresented: Binding(
                    get: { composing && dynamicTypeSize.isAccessibilitySize },
                    set: { if !$0 { composing = false; questionFocused = false } }
                )) {
                    NavigationStack {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                Text(selection.symbol).font(.footnote).foregroundStyle(Theme.textSecondary)
                                questionComposer
                            }.padding(20)
                        }.scrollDismissesKeyboard(.interactively)
                            .navigationTitle(turns.isEmpty ? "研究问题" : "继续追问")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar {
                                ToolbarItem(placement: .confirmationAction) {
                                    Button(turns.isEmpty ? "返回资料" : "返回报告") { composing = false; questionFocused = false }.disabled(busy)
                                }
                                ToolbarItemGroup(placement: .keyboard) {
                                    Spacer(); Button("收起键盘") { questionFocused = false }
                                }
                            }
                    }.interactiveDismissDisabled(busy)
                }
                .sheet(isPresented: $preparingSources, onDismiss: { Task { await load() } }) {
                    NavigationStack { ResearchSourceIntakeView(symbol: selection.symbol, researchPreparation: true) }
                }
                .sheet(item: $sourceCitation) { citation in
                    InvestigationCitationSheet(citation: citation, membershipId: selection.membershipId,
                        membershipVersion: selection.membershipVersion, symbol: selection.symbol,
                        returnLabel: turns.isEmpty ? "返回资料" : "返回报告")
                }
                .confirmationDialog("清除当前临时会话？", isPresented: $clearingCurrentConversation,
                                    titleVisibility: .visible) {
                    Button("清除当前公司与日期的临时回答、追问和草稿", role: .destructive) {
                        clearCurrentTemporaryConversation()
                    }
                } message: {
                    Text("清除当前连接、公司、会员版本、研究模式及事件日期下的本机临时内容；旧版记录未区分模式和日期，也会按当前连接与公司版本一并清除。正式报告、独立导出和开发验证文件仍保留。")
                }
                .interactiveDismissDisabled(busy)
                .task(id: "\(selection.id):\(store.authorizationRevision)") {
                    draftReady = false
                    InvestigationResultCache.pruneRawResponses()
                    if InvestigationTemporaryRetention.policy() == .none {
                        let cleared = InvestigationResultCache.clearAllTemporary()
                        temporaryConversationNotice = cleared ? "当前设置为不保留；本机临时会话已清除。" : "临时会话清除未完成，请重试。"
                    }
                    observedClearMarker = researchTemporaryConversationClearMarker()
                    startsNewConversation = !selection.resumeExisting
                    question = selection.question
                    if let date = selection.eventDate, let value = ISO8601DateFormatter().date(from: date + "T12:00:00+08:00") { selectedDate = value }
                    initialAnalysisPending = selection.startAnalysis
                    restoreDraft()
                    if selection.ordinaryChangeContext != nil { question = selection.question }
                    await load()
                }
                .onChange(of: turns.last?.receipt) { _, _ in
                    guard evidence != nil, let turn = turns.last else {
                        readingReceipt = nil; visibleReportChapter = nil
                        return
                    }
                    readingReceipt = turn.receipt
                    visibleReportChapter = InvestigationReadingPosition.read(for: turn, history: false) ?? "report-start"
                }
                .onChange(of: visibleReportChapter) { _, chapter in
                    guard let chapter, let turn = turns.last, evidence != nil,
                          readingReceipt == turn.receipt else { return }
                    InvestigationReadingPosition.save(chapter, for: turn, history: false)
                }
                .onChange(of: question) { _, _ in if draftReady && !busy { saveDraft() } }
                .onChange(of: temporaryRetentionRaw) { _, rawValue in
                    clearingCurrentConversation = false
                    if rawValue == ResearchTemporaryConversationRetention.none.rawValue {
                        applyTemporaryRetention(rawValue)
                    } else if busy {
                        pendingRetentionRaw = rawValue
                        temporaryConversationNotice = "当前操作完成后将应用新的本机保留期。"
                    } else {
                        applyTemporaryRetention(rawValue)
                    }
                }
                .onChange(of: busy) { _, isBusy in
                    if !isBusy, let pendingRetentionRaw {
                        self.pendingRetentionRaw = nil
                        applyTemporaryRetention(pendingRetentionRaw)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: researchTemporaryConversationDidClearNotification)) { notification in
                    guard let source = notification.object as? UserDefaults,
                          source === UserDefaults.standard else { return }
                    observedClearMarker = researchTemporaryConversationClearMarker()
                    clearAllTemporaryPresentation("全部本机临时研究已清除；新问题不会携带旧会话。")
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    let marker = researchTemporaryConversationClearMarker()
                    if observedClearMarker != marker {
                        observedClearMarker = marker
                        clearAllTemporaryPresentation("本机临时研究已清除；旧会话不再恢复。")
                    }
                }
                .onDisappear { saveDraft() }
        }
    }
    private var hasUsableEvidence: Bool {
        evidence?.sources.contains { $0.readStatus == "BODY_READ" } == true
    }
    private var canPrepareFormalResearch: Bool {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !needsReload, trimmed.utf16.count >= 3, trimmed.utf16.count <= 1000,
              let evidence, evidence.ok, evidence.symbol == selection.symbol,
              evidence.membershipId == selection.membershipId,
              evidence.membershipVersion == selection.membershipVersion,
              evidence.mode == selection.mode, evidence.eventDate == requestedDate,
              loadedScope == InvestigationResultCache.key(selection.membershipId,
                  selection.membershipVersion, mode: selection.mode, eventDate: requestedDate) else { return false }
        return true
    }
    private func prepareFormalResearchFromQuestion() {
        guard canPrepareFormalResearch, let evidence else { return }
        let hints = evidence.sources.compactMap { source -> PersonalFormalSourceHint? in
            guard source.symbol == selection.symbol,
                  ["official_pdf", "official_body", "news_body"].contains(source.sourceType),
                  source.readStatus == "BODY_READ", let raw = source.url,
                  let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  url.user == nil, url.password == nil,
                  source.pageNumber.map({ $0 > 0 }) != false,
                  source.sourceType != "official_pdf" || source.pageNumber != nil,
                  source.contentSha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  source.snapshotCitation?.isValid != false,
                  source.snapshotCitation.map({ $0.textSha256 == source.contentSha256 }) != false else { return nil }
            var hint = PersonalFormalSourceHint(sourceType: source.sourceType, url: raw, pageNumber: source.pageNumber,
                                                pageTextSha256: source.contentSha256)
            hint.snapshotCitation = source.snapshotCitation
            return hint
        }
        let uniqueHints = hints.reduce(into: [PersonalFormalSourceHint]()) { values, hint in
            if !values.contains(hint) { values.append(hint) }
        }
        store.stagePersonalFormalHandoff(PersonalFormalResearchHandoff(
            symbol: selection.symbol, membershipId: selection.membershipId,
            membershipVersion: selection.membershipVersion, mode: selection.mode,
            eventDate: requestedDate, question: question.trimmingCharacters(in: .whitespacesAndNewlines),
            readSourceScope: PersonalFormalResearchHandoff.sourceScope(evidence.sources.filter { $0.sourceType != "provider_financial_statement" }.map {
                PersonalFormalReadSource(symbol: $0.symbol, sourceType: $0.sourceType, readStatus: $0.readStatus,
                    url: $0.url, pageNumber: $0.pageNumber, contentSha256: $0.contentSha256,
                    snapshotCitation: $0.snapshotCitation)
            }),
            connectionScope: PersonalFormalResearchHandoff.currentConnectionScope(),
            sources: uniqueHints,
            providerSources: evidence.sources.filter { selectedProviderSourceIds.contains($0.id) }
                .compactMap(\.providerMaterialSelection)
        ))
        dismiss()
    }
    private func prepareManualResearchFromQuestion() {
        guard canPrepareFormalResearch, let evidence else { return }
        let selected = evidence.sources.filter { selectedManualSourceIds.contains($0.id) && $0.readStatus == "BODY_READ" }
        let manualSources = selected.compactMap { source -> PersonalManualSelectedSource? in
            guard source.symbol == selection.symbol,
                  ["official_pdf", "official_body", "provider_financial_statement"].contains(source.sourceType),
                  source.contentSha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  source.snapshotCitation.map({ $0.isValid && $0.textSha256 == source.contentSha256 }) != false else { return nil }
            if source.sourceType == "provider_financial_statement" {
                guard source.providerMaterialSelection?.materials.count == 1 else { return nil }
            } else if source.sourceType == "official_pdf" {
                guard let documentId = source.documentId, Int(documentId).map({ $0 > 0 }) == true,
                      let pdfSha = source.documentPdfSha256,
                      pdfSha.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                      source.pageNumber.map({ $0 > 0 }) == true else { return nil }
                if let raw = source.url {
                    guard let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                          url.user == nil, url.password == nil else { return nil }
                }
            } else {
                guard let raw = source.url, let url = URL(string: raw),
                      ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                      url.user == nil, url.password == nil,
                      source.pageNumber.map({ $0 > 0 }) != false else { return nil }
            }
            return PersonalManualSelectedSource(
                id: source.id, title: source.source, sourceType: source.sourceType,
                url: source.url, retrievedAt: source.retrievedAt, publishedAt: source.publishedAt,
                contentSha256: source.contentSha256, pageNumber: source.pageNumber,
                documentId: source.documentId, documentPdfSha256: source.documentPdfSha256,
                snapshotCitation: source.snapshotCitation,
                provider: source.providerMaterialSelection
            )
        }
        guard !manualSources.isEmpty, manualSources.count == selected.count else {
            issue = "所选来源缺少可核对原件或唯一已保存材料；请取消该来源并重新选择。"
            return
        }
        var changeContext = selection.ordinaryChangeContext
        changeContext?.changeSourcesSelected = selectedChangeSourcesAreComplete
        store.stagePersonalFormalHandoff(PersonalFormalResearchHandoff(
            symbol: selection.symbol, membershipId: selection.membershipId,
            membershipVersion: selection.membershipVersion, mode: selection.mode,
            eventDate: requestedDate, question: question.trimmingCharacters(in: .whitespacesAndNewlines),
            readSourceScope: PersonalFormalResearchHandoff.sourceScope(evidence.sources.filter { $0.sourceType != "provider_financial_statement" }.map {
                PersonalFormalReadSource(symbol: $0.symbol, sourceType: $0.sourceType, readStatus: $0.readStatus,
                    url: $0.url, pageNumber: $0.pageNumber, contentSha256: $0.contentSha256,
                    snapshotCitation: $0.snapshotCitation)
            }),
            connectionScope: PersonalFormalResearchHandoff.currentConnectionScope(),
            sources: [], providerSources: manualSources.compactMap(\.provider),
            purpose: .manualJudgment, manualSources: manualSources,
            ordinaryChangeContext: changeContext
        ))
        dismiss()
    }
    private func readingCoverage(_ sources: [InvestigationSource]) -> String {
        let read = sources.filter { $0.readStatus == "BODY_READ" }
        let pages = read.filter { $0.sourceType == "official_pdf" && $0.pageNumber != nil }
        let providerCount = read.filter { $0.sourceType == "provider_financial_statement" }.count
        let pageCount = Set(pages.map { "\($0.url ?? $0.source):\($0.pageNumber!)" }).count
        let documents = Set(pages.compactMap(\.url)).count
        var parts: [String] = []
        if pageCount > 0 {
            parts.append(pages.allSatisfy { $0.url != nil }
                         ? "已读 \(documents) 份财报中的 \(pageCount) 页"
                         : "已读财报 \(pageCount) 页")
        }
        if providerCount > 0 { parts.append("OpenD 提供商财务期间 \(providerCount) 条") }
        let other = read.count - pages.count - providerCount
        if other > 0 { parts.append("其他正文或行情记录 \(other) 条") }
        let leads = sources.filter { $0.readStatus == "LEAD_ONLY" }.count
        if leads > 0 { parts.append("另有 \(leads) 条标题线索，尚未读取正文") }
        return parts.isEmpty ? "尚未取得可供分析的正文资料。" : parts.joined(separator: "；") + "。"
    }
    private var composerLabel: String {
        if issue != nil { return "查看未完成的问题" }
        return turns.isEmpty ? "提出研究问题" : "围绕这份报告追问"
    }
    private var questionComposer: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(turns.isEmpty ? "提出研究问题" : "继续追问").font(.headline)
                Spacer()
                if !busy && !dynamicTypeSize.isAccessibilitySize {
                    Button(turns.isEmpty ? "先阅读资料" : "继续阅读") { composing = false; questionFocused = false }
                        .accessibilityIdentifier("investigationReturnToReading")
                }
            }
            TextField("你最想弄清什么？", text: $question, axis: .vertical)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 3).focused($questionFocused).disabled(busy).accessibilityIdentifier("realInvestigationQuestion")
            if !question.isEmpty {
                Text(question.utf16.count > 1000
                     ? "问题过长（\(question.utf16.count)/1000），请缩短后发送；原草稿会保留。"
                     : "输入长度 \(question.utf16.count)/1000")
                    .font(.caption).foregroundStyle(question.utf16.count > 1000 ? Theme.amber : Theme.textSecondary)
                    .accessibilityIdentifier("investigationQuestionLength")
            }
            if let issue {
                Text(issue).font(.footnote).foregroundStyle(Theme.amber)
                    .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("investigationIssue")
            }
            if !busy && !hasUsableEvidence {
                Text("尚无可用于分析的正文或行情依据，请先获取资料再重新读取。").font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            if AppEnvironment.writeAuthToken() == nil { Text("尚未取得研究调用授权，请在连接与授权中核对。").font(.footnote) }
            if busy { ProgressView("正在核对资料并处理，请稍候；本次完成前不会重复提交。") }
            Button(busy ? "正在读取依据并分析…" : turns.isEmpty ? "深入分析" : "继续追问") {
                let submitted = question
                Task { await ask(submitted) }
            }.buttonStyle(.borderedProminent).disabled(busy || needsReload || !hasUsableEvidence || AppEnvironment.writeAuthToken() == nil || question.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || question.utf16.count > 1000)
                .accessibilityIdentifier("realInvestigationAsk")
            Button("用当前问题准备正式研究") { prepareFormalResearchFromQuestion() }
                .buttonStyle(.bordered)
                .disabled(!canPrepareFormalResearch)
                .accessibilityIdentifier("prepareFormalResearchFromQuestion")
            Text("进入准备页核对材料和发送范围；此处不会调用 AI 或创建正式任务。")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            Button("用已选来源记录我的判断") { prepareManualResearchFromQuestion() }
                .buttonStyle(.bordered)
                .disabled(!canPrepareFormalResearch || selectedManualSourceIds.isEmpty)
                .accessibilityIdentifier("prepareManualResearchFromQuestion")
            Text(selection.ordinaryChangeContext == nil
                 ? "请先在已检查来源中勾选原件。此路径保留你的问题与来源坐标；档案、证据和决定均由你核对后分别保存。"
                 : selectedChangeSourcesAreComplete
                    ? "候选原件已由你选择；进入后仍须分别保存证据，并自行编辑和确认判断。"
                    : "仍可用已核对来源记录普通判断；缺少同口径比较原件时，不把数值比较或变化关联当成已核实结果。")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            if !questionFocused, let last = turns.last {
                Text("上一轮引用和回答会一并带入；资料变化时会提示重新核对。")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                Text("上次分析 \(last.generatedDescription)").font(.caption2).foregroundStyle(Theme.textSecondary)
            }
        }.padding(12).templateCardStyle()
    }
    private func claims(_ title: String, _ items: [InvestigationAnalysis.Claim]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            if items.isEmpty { Text("当前已读资料还不足以支持这一项，未补造结论。").font(.caption).foregroundStyle(Theme.textSecondary) }
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 5) {
                    Text(item.text).font(.subheadline)
                    Text("\(classification(item.classification)) · \(support(item.support))").font(.caption).foregroundStyle(Theme.gold)
                    ForEach(item.basis.indices, id: \.self) { index in
                        DisclosureGroup("查看原文依据") {
                            Text(item.basis[index].sourceId).font(.caption2)
                            Text(item.basis[index].quote).font(.caption).textSelection(.enabled)
                        }.font(.caption)
                    }
                    if !item.missingEvidence.isEmpty { Text("仍需核查：\(item.missingEvidence)").font(.caption).foregroundStyle(Theme.textSecondary) }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12).templateCardStyle()
    }
    private func financialDetails(_ financial: InvestigationAnalysis.Finance) -> some View {
        DisclosureGroup("财务原文与计算出处") {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(financial.calculations.filter { !$0.id.hasPrefix("amount:") }) { calculation in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(calculation.formula).font(.footnote).foregroundStyle(Theme.textSecondary)
                            ForEach(financial.facts.filter { calculation.operandIds.contains($0.id) }) { fact in
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(fact.label + "：" + InvestigationFinancialDisplay.amount(fact.value, scale: fact.unitScale, currency: fact.currency)).font(.callout.weight(.medium))
                                    Text(fact.period.start + " 至 " + fact.period.end).font(.caption).foregroundStyle(Theme.textSecondary)
                                    Text("PDF第\(fact.source.pageNumber)页 · 原文").font(.caption)
                                    Text(fact.source.quote).font(.footnote).textSelection(.enabled)
                                    if let url = URL(string: fact.source.url), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                                        Link("打开原始来源", destination: url).frame(minHeight: 44)
                                    }
                                }
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(calculation.label).font(.callout)
                            Text(InvestigationFinancialDisplay.calculation(calculation.value, unit: calculation.unit, scale: calculation.unitScale, currency: calculation.currency)).font(.headline)
                            Text(calculation.period.start + " 至 " + calculation.period.end).font(.caption).foregroundStyle(Theme.textSecondary)
                        }.padding(.vertical, 6)
                    }
                    Divider()
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.font(.callout).accessibilityIdentifier("financialCalculationProvenance")
    }
    private func reasoningDetails(_ r: InvestigationAnalysis.Reasoning, turn: InvestigationTurn) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DisclosureGroup("先查什么，为什么") {
                ForEach(r.explanations.sorted { $0.investigationPriority < $1.investigationPriority }) { e in
                    Text("先查第\(e.investigationPriority)项：" + e.claimCoverage.claim).bold()
                    Text("为什么先查：" + e.whyInvestigateFirst)
                    Text("需要原件：" + e.neededEvidence)
                    if e.potentialImpact != e.whyInvestigateFirst { Text("可能影响：" + e.potentialImpact) }
                }
            }.accessibilityIdentifier("investigationPriorities")
            DisclosureGroup("解释比较与反证") {
                ForEach(r.explanations) { e in
                    VStack(alignment: .leading, spacing: 5) {
                        let result = turn.analysis.hypothesisResults?.first { $0.hypothesisId == e.hypothesisId }
                        Text("\(e.rank). \(result?.explanation ?? "待核查的候选解释")").bold()
                        Text("当前支持程度：" + (["supported":"现有原文支持", "partial":"部分支持", "weakened":"已被弱化", "unresolved":"尚无法判断"][result?.verdict ?? ""] ?? "尚无法判断"))
                        if e.confidenceReason != result?.explanation { Text(e.confidenceReason) }
                        if let result { Text("已核查：" + result.checked) }
                        basis("支持原文", e.supportingEvidence)
                        if e.contradictingEvidence.isEmpty { Text("已读资料未提供明确反证；不等于解释已被证实。") }
                        else { basis("相反原文", e.contradictingEvidence) }
                        if !e.claimCoverage.missingLink.isEmpty { Text("缺失证据：" + e.claimCoverage.missingLink) }
                        DisclosureGroup("这条引用支持到哪里") {
                            Text("待核查主张：" + e.claimCoverage.claim)
                            basis("对应原文", (e.supportingEvidence + e.contradictingEvidence).filter { e.claimCoverage.sourceIds.contains($0.sourceId) })
                            Text("原文支持的结论：" + e.claimCoverage.conclusion)
                            if !e.claimCoverage.missingLink.isEmpty { Text("尚缺的环节：" + e.claimCoverage.missingLink) }
                            Text(["direct":"这些引文直接支持该项结论。", "partial":"引文只支持部分环节，不能据此确认完整主张。", "insufficient":"引文不足以支持该主张，目前保留为待核查解释。"][e.claimCoverage.assessment] ?? "尚需核对引用范围。")
                        }
                    }.padding(.vertical, 6)
                }
            }
            if r.thesisImpact != nil || r.earningsImpact != nil || r.valuationImpact != nil
                || r.transmission.operatingFact != nil || r.transmission.operatingMeaning != nil
                || r.transmission.earnings != nil || r.transmission.cashFlow != nil || r.transmission.valuation != nil {
            DisclosureGroup("研究影响与盈利传导") {
                Text("当前正式判断").bold()
                Text(turn.currentThesis?.text ?? (turn.currentThesis?.status == "none" ? "尚未建立正式判断，分析不会代填。" : "当前正式判断尚无法校验，分析不作比较。"))
                if turn.currentThesis?.status == "ended" { Text("这条正式判断已结束，仅保留历史对照。") }
                if turn.currentThesis?.status == "active", let value = r.thesisImpact { impact("研究影响", value) }
                if let value = r.earningsImpact { impact("盈利影响", value) }
                if let scope = turn.gaps.first(where: { $0.reason == "NOT_CHECKED" && $0.text.contains("估值假设") }) {
                    Text("估值相关性").bold(); Text("本轮未核对已有估值假设，无法量化其影响；不能据此判断你是否已设置。")
                    Text(scope.text)
                } else if let value = r.valuationImpact { impact("估值相关性", value) }
                if let value = r.transmission.operatingFact { transmission("经营事实", value) }
                if let value = r.transmission.operatingMeaning { transmission("经营含义", value) }
                if let value = r.transmission.earnings { transmission("盈利传导", value) }
                if let value = r.transmission.cashFlow { transmission("经营现金流", value) }
                if !turn.gaps.contains(where: { $0.reason == "NOT_CHECKED" && $0.text.contains("估值假设") }), let value = r.transmission.valuation {
                    transmission("估值相关性", value)
                }
                ForEach(r.unknowns, id: \.text) { gap in
                    if gap.text.contains("估值"), turn.gaps.contains(where: { $0.reason == "NOT_CHECKED" && $0.text.contains("估值假设") }) {
                        Text("尚未知：本轮未核对已有估值假设，因此不能量化影响。")
                    } else { Text("尚未知：" + gap.text) }
                    matters(gap.whyThisMatters)
                }
            }
            }
            DisclosureGroup("建议追问 · 选择后可编辑") {
                ForEach(r.nextQuestions, id: \.question) { q in
                    Text(q.question).bold(); Text("为什么重要：" + q.whyImportant)
                    Text("所需证据：" + q.neededEvidence)
                    if let confirmed = q.ifConfirmed { Text(confirmed) }
                    if let rejected = q.ifRejected { Text(rejected) }
                    Button("追问：" + q.question) {
                        let submitted = q.question
                        question = submitted
                    }.disabled(busy || needsReload)
                        .accessibilityIdentifier("suggestedFollowup-" + q.hypothesisId)
                }
            }
        }.font(.caption)
    }
    private func matters(_ value: InvestigationAnalysis.Reasoning.Why) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("为什么重要").bold()
            if let why = value.why { Text(why) }
            if let confirmed = value.ifConfirmed { Text(confirmed) }
            if let rejected = value.ifRejected { Text(rejected) }
        }
    }
    private func basis(_ title: String, _ values: [InvestigationAnalysis.Claim.Basis]) -> some View {
        DisclosureGroup(title + "（\(values.count)）") {
            ForEach(values.indices, id: \.self) { i in Text(values[i].quote).textSelection(.enabled) }
        }
    }
    private func impact(_ title: String, _ value: InvestigationAnalysis.Reasoning.Impact) -> some View {
        VStack(alignment: .leading) { Text(title).bold()
            Text(["NO_CONFIRMED_IMPACT":"证据的适用范围见下方分析。", "SUPPORTS_EXISTING_VIEW":"新证据与当前研究方向一致。", "CHALLENGES_EXISTING_VIEW":"新证据与当前研究假设存在冲突。", "REQUIRES_FURTHER_REVIEW":"出现重要变化，但证据不足。"][value.classification] ?? "目前还需要核查更多证据。")
            Text(value.text); basis("相关证据", value.basis)
            if !value.missingEvidence.isEmpty { Text("仍缺：" + value.missingEvidence) }
        }.padding(.vertical, 5)
    }
    private func transmission(_ title: String, _ value: InvestigationAnalysis.Reasoning.Step) -> some View {
        VStack(alignment: .leading) {
            Text(title + " · " + (["confirmed":"已确认", "interpretation":"分析解释", "unresolved":"尚未判断"][value.status] ?? "待核查")).bold()
            Text(value.text); if let gap = value.gap { Text(gap.text) }; basis("原文依据", value.basis)
            matters(value.whyThisMatters)
        }.padding(.vertical, 5)
    }
    private func classification(_ value: String) -> String {
        ["FACT":"原始事实", "SOURCE_SUPPORTED":"来源支持 · 待交叉核验", "INTERPRETATION":"分析解释", "HYPOTHESIS":"待核验假说"][value] ?? "待核验"
    }
    private func support(_ value: String) -> String { ["strong":"依据较强", "partial":"部分支持", "insufficient":"证据不足"][value] ?? "尚待核对" }
    private var url: URL { AppEnvironment.baseURL().appending(path: "api/mobile/research/candidate-memberships/\(selection.membershipId)/personal-brief/investigations") }
    private var scopeKey: String {
        InvestigationResultCache.key(selection.membershipId, selection.membershipVersion, mode: selection.mode, eventDate: requestedDate)
            + ":turns:\(evidence?.fingerprint ?? "")"
    }
    private var draftKey: String {
        InvestigationResultCache.key(selection.membershipId, selection.membershipVersion, mode: selection.mode, eventDate: requestedDate) + (selection.resumeExisting ? ":draft" : ":new-question-draft")
    }
    private func applyTemporaryRetention(_ rawValue: String) {
        if rawValue == ResearchTemporaryConversationRetention.none.rawValue {
            let cleared = InvestigationResultCache.clearAllTemporary()
            observedClearMarker = researchTemporaryConversationClearMarker()
            clearAllTemporaryPresentation(cleared
                ? "已选择不保留；本机临时回答、追问和草稿已清除。"
                : "临时会话清除未完成；旧前文已从当前页面移除，请重试。")
        } else {
            InvestigationResultCache.pruneRawResponses()
            temporaryConversationNotice = "保留期已改为 \(ResearchTemporaryConversationRetention(rawValue: rawValue)?.title ?? "30 天")；正在核对可恢复内容。"
            Task { await load() }
        }
    }
    private func clearAllTemporaryPresentation(_ notice: String) {
        operationRevision = UUID()
        busy = false
        turns = []; history = []; oldAnswer = nil; question = ""; issue = nil
        composing = false; startsNewConversation = true; readingReceipt = nil
        visibleReportChapter = nil; sourceCitation = nil; initialAnalysisPending = false
        pendingRetentionRaw = nil; questionFocused = false
        temporaryConversationNotice = notice
    }
    private func clearCurrentTemporaryConversation() {
        let cleared = InvestigationResultCache.clearCurrent(
            id: selection.membershipId, version: selection.membershipVersion, mode: selection.mode,
            eventDate: requestedDate, archiveKey: historyArchiveKey
        )
        if cleared {
            operationRevision = UUID()
            turns = []; history = []; oldAnswer = nil; question = ""; issue = nil
            composing = false; startsNewConversation = true; readingReceipt = nil; visibleReportChapter = nil
            temporaryConversationNotice = "当前临时会话已清除；可以提出新的研究问题。"
        } else {
            temporaryConversationNotice = "当前临时会话清除未完成，旧内容不会作为追问前文；请重试。"
            turns = []; startsNewConversation = true
        }
    }
    private func saveDraft() {
        guard draftReady && !busy else { return }
        guard InvestigationTemporaryRetention.policy() != .none else { return }
        if question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { UserDefaults.standard.removeObject(forKey: draftKey) }
        else if !InvestigationDraftStore.save(InvestigationDraft(question: question, issue: issue,
                entryQuestion: selection.question, startsNewConversation: startsNewConversation,
                savedAt: ISO8601DateFormatter().string(from: Date())), forKey: draftKey) {
            temporaryConversationNotice = "草稿在本机保存失败；重开后不会假称已恢复。"
        }
    }
    private func restoreDraft() {
        switch InvestigationDraftStore.read(forKey: draftKey, entryQuestion: selection.question) {
        case .unavailable:
            return
        case .undatedLegacy:
            temporaryConversationNotice = "旧草稿没有保存日期，未自动恢复；原字节保留，可选择清除当前临时会话。"
            return
        case .expired:
            temporaryConversationNotice = "旧草稿已超过保留期，未恢复。"
            return
        case .available(let draft):
            initialAnalysisPending = false
            question = draft.question
            startsNewConversation = draft.startsNewConversation ?? !selection.resumeExisting
            composing = true
            if issue == nil, let previous = draft.issue {
                issue = previous.hasPrefix("上次分析未完成：") ? previous : "上次分析未完成：" + previous
            }
        }
    }
    private func request(_ write: Bool) -> URLRequest {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: write ? 540 : 45)
        let auth = AppEnvironment.researchAuthorizationContext()
        if let token = write ? auth.writeToken : auth.readToken { r.setValue(token, forHTTPHeaderField: write ? auth.writeHeaderName : auth.readHeaderName) }
        return r
    }
    private func load() async {
        let currentMarker = researchTemporaryConversationClearMarker()
        if observedClearMarker != currentMarker {
            observedClearMarker = currentMarker
            clearAllTemporaryPresentation("本机临时研究已清除；旧会话不再恢复。")
        }
        selectedProviderSourceIds = []
        let revision = UUID(); operationRevision = revision
        let auth = AppEnvironment.researchAuthorizationContext()
        let clearMarker = researchTemporaryConversationClearMarker()
        let loadDate = requestedDate
        let contextKey = InvestigationResultCache.key(selection.membershipId, selection.membershipVersion, mode: selection.mode, eventDate: loadDate)
        let previousManualSources = loadedScope == contextKey
            ? (evidence?.sources.filter { selectedManualSourceIds.contains($0.id) } ?? []) : []
        selectedManualSourceIds = []
        let retainedTurns = loadedScope == contextKey && !startsNewConversation
            ? turns.filter { InvestigationResultCache.isRetained($0)
                && InvestigationResultCache.afterLastClear($0, id: selection.membershipId,
                    version: selection.membershipVersion, mode: selection.mode, eventDate: loadDate) } : []
        history = InvestigationResultCache.history(id: selection.membershipId, version: selection.membershipVersion, symbol: selection.symbol, mode: selection.mode, eventDate: loadDate)
        historyArchiveKey = nil
        busy = true; issue = nil; evidence = nil; turns = []; oldAnswer = nil; readFinancial = nil; needsReload = false
        do {
            var query = [URLQueryItem(name: "mode", value: selection.mode)]
            if let date = requestedDate { query.append(URLQueryItem(name: "eventDate", value: date)) }
            var r = request(false); r.url = url.appending(queryItems: query)
            let (data, response) = try await URLSession.shared.data(for: r)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            guard !Task.isCancelled, operationRevision == revision,
                  auth == AppEnvironment.researchAuthorizationContext(), loadDate == requestedDate,
                  researchTemporaryConversationClearMarker() == clearMarker else {
                if operationRevision == revision && researchTemporaryConversationClearMarker() != clearMarker {
                    clearAllTemporaryPresentation("本机临时研究已清除；旧会话未恢复。")
                }
                return
            }
            let value = try JSONDecoder().decode(InvestigationEvidence.self, from: data)
            guard value.ok, value.symbol == selection.symbol, value.membershipId == selection.membershipId,
                  value.membershipVersion == selection.membershipVersion, value.mode == selection.mode,
                  value.eventDate == requestedDate else { throw URLError(.cannotParseResponse) }
            evidence = value
            selectedManualSourceIds = Set(value.sources.filter { current in
                previousManualSources.contains { prior in
                    prior.id == current.id && prior.sourceType == current.sourceType
                        && prior.contentSha256 == current.contentSha256
                        && prior.url == current.url && prior.pageNumber == current.pageNumber
                        && prior.providerMaterialSelection == current.providerMaterialSelection
                }
            }.map(\.id))
            historyArchiveKey = InvestigationResultCache.archiveKey(scope: value.historyScope, id: selection.membershipId, version: selection.membershipVersion, mode: selection.mode, eventDate: loadDate)
            InvestigationResultCache.archiveCurrentHistory(id: selection.membershipId, version: selection.membershipVersion, symbol: selection.symbol, mode: selection.mode, eventDate: loadDate, archiveKey: historyArchiveKey)
            history = InvestigationResultCache.history(id: selection.membershipId, version: selection.membershipVersion, symbol: selection.symbol, mode: selection.mode, eventDate: loadDate, archiveKey: historyArchiveKey)
            loadedScope = contextKey
            turns = retainedTurns.filter { $0.symbol == value.symbol && $0.membershipId == value.membershipId
                && $0.membershipVersion == value.membershipVersion && InvestigationResultCache.canResume($0, fingerprint: value.fingerprint, receiptKeyId: value.receiptKeyId)
                && $0.eventDate == loadDate && ($0.mode ?? "earnings_quality") == selection.mode }
            readFinancial = value.financialCalculations
            let legacyKey = InvestigationResultCache.legacyKey(selection.membershipId, selection.membershipVersion)
            if selection.resumeExisting, let data = UserDefaults.standard.data(forKey: legacyKey), let old = try? JSONDecoder().decode(InvestigationTurn.self, from: data),
               InvestigationResultCache.isRetained(old),
               InvestigationResultCache.afterLastClear(old, id: selection.membershipId, version: selection.membershipVersion,
                   mode: selection.mode, eventDate: loadDate),
               old.symbol == selection.symbol, old.membershipId == selection.membershipId, old.membershipVersion == selection.membershipVersion,
               old.eventDate == requestedDate {
                oldAnswer = old
            }
            let priorScope = SHA256.hash(data: Data((AppEnvironment.researchAuthorizationContext().readToken ?? "").utf8)).map { String(format: "%02x", $0) }.joined()
            let priorKey = "real-investigation-v4:\(priorScope):\(selection.id):\(requestedDate ?? ""):\(value.fingerprint)"
            if turns.isEmpty, selection.resumeExisting, !startsNewConversation {
                let previous = (InvestigationResultCache.session(forKey: scopeKey)
                    + InvestigationResultCache.session(forKey: priorKey)).reduce(into: [InvestigationTurn]()) { values, turn in
                        if !values.contains(where: { $0.receipt == turn.receipt }) { values.append(turn) }
                    }
                turns = previous.filter { $0.symbol == value.symbol && $0.membershipId == value.membershipId && $0.membershipVersion == value.membershipVersion
                    && InvestigationResultCache.canResume($0, fingerprint: value.fingerprint, receiptKeyId: value.receiptKeyId)
                    && InvestigationResultCache.afterLastClear($0, id: selection.membershipId, version: selection.membershipVersion,
                        mode: selection.mode, eventDate: loadDate)
                    && $0.eventDate == requestedDate
                    && ($0.mode ?? ($0.eventDate == nil ? "earnings_quality" : "price_move")) == selection.mode }
                if !turns.isEmpty && !selection.startAnalysis { question = "" }
            }
            // Stable archives are read-only. A rotated connection must not
            // promote an old receipt into an active follow-up automatically.
            let currentConnectionHistory = InvestigationResultCache.history(id: selection.membershipId, version: selection.membershipVersion, symbol: selection.symbol, mode: selection.mode, eventDate: loadDate)
            if selection.resumeExisting && !startsNewConversation && turns.isEmpty, let current = currentConnectionHistory.last(where: { InvestigationResultCache.canResume($0, fingerprint: value.fingerprint, receiptKeyId: value.receiptKeyId) }) {
                turns = [current]; question = ""
            }
        } catch {
            guard !Task.isCancelled, operationRevision == revision,
                  auth == AppEnvironment.researchAuthorizationContext(),
                  researchTemporaryConversationClearMarker() == clearMarker else { return }
            // Retain the session for a later retry; without current evidence it is not sent or shown as current.
            turns = retainedTurns
            issue = "本次资料读取未完成，请检查连接后重试。历史报告仍可查看，其资料尚未重新核验。"
        }
        guard operationRevision == revision, auth == AppEnvironment.researchAuthorizationContext(),
              researchTemporaryConversationClearMarker() == clearMarker else { return }
        busy = false
        restoreDraft()
        draftReady = true
        if initialAnalysisPending {
            initialAnalysisPending = false
            if evidence != nil && turns.last?.question != selection.question.trimmingCharacters(in: .whitespacesAndNewlines) {
                // The loading .task is view-scoped. Starting research separately
                // keeps ordinary navigation from cancelling an authorized send.
                Task { await ask(selection.question) }
            }
        }
    }
    private func ask(_ submitted: String) async {
        let currentMarker = researchTemporaryConversationClearMarker()
        guard observedClearMarker == currentMarker else {
            observedClearMarker = currentMarker
            clearAllTemporaryPresentation("本机临时研究已清除；请重新输入问题。")
            return
        }
        let submittedQuestion = submitted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !needsReload, hasUsableEvidence, AppEnvironment.writeAuthToken() != nil, submittedQuestion.utf16.count >= 3, submittedQuestion.utf16.count <= 1000, let evidence else { return }
        if !turns.isEmpty && !turns.allSatisfy({ InvestigationResultCache.canResume($0, fingerprint: evidence.fingerprint, receiptKeyId: evidence.receiptKeyId)
                && (InvestigationTemporaryRetention.policy() == .none || InvestigationResultCache.isRetained($0)) }) {
            issue = "这份报告的会话凭据需要重新核对。请重新读取资料；历史报告仍可查看。"
            needsReload = true
            return
        }
        let submittedDate = requestedDate
        let revision = UUID(); operationRevision = revision
        let auth = AppEnvironment.researchAuthorizationContext()
        let clearMarker = researchTemporaryConversationClearMarker()
        let storageKey = scopeKey
        question = submittedQuestion
        saveDraft()
        busy = true; issue = nil
        defer {
            if operationRevision == revision {
                busy = false
                if researchTemporaryConversationClearMarker() == clearMarker { saveDraft() }
            }
        }
        do {
            var r = request(true); r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "content-type")
            r.setValue("sections-v1", forHTTPHeaderField: "x-research-report-format")
            let prior: [[String: Any]] = try turns.suffix(2).map { turn in
                var answer = try JSONSerialization.jsonObject(with: JSONEncoder().encode(turn.analysis)) as! [String: Any]
                // The server receipt binds the answer and its quotes. The
                // deterministic financial footer is display-only and reread.
                answer.removeValue(forKey: "financialCalculations")
                return ["question": turn.question, "analysis": answer, "fingerprint": turn.fingerprint, "receipt": turn.receipt]
            }
            guard try priorLength(prior) <= 48000 else {
                throw NSError(domain: "Research", code: 1, userInfo: [NSLocalizedDescriptionKey:
                    "前文较长，暂无法连同这次问题一起发送。原报告和问题草稿已保留；可以另开研究问题。"])
            }
            var body: [String: Any] = ["mode": selection.mode, "question": submittedQuestion,
                "fingerprint": evidence.fingerprint, "priorTurns": prior]
            if let date = submittedDate { body["eventDate"] = date }
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 540
            configuration.timeoutIntervalForResource = 540
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let (data, response) = try await session.data(for: r)
            guard !Task.isCancelled, operationRevision == revision,
                  auth == AppEnvironment.researchAuthorizationContext(), submittedDate == requestedDate,
                  researchTemporaryConversationClearMarker() == clearMarker else {
                if operationRevision == revision && researchTemporaryConversationClearMarker() != clearMarker {
                    clearAllTemporaryPresentation("本机临时研究已清除；旧请求返回未加入新会话。")
                }
                return
            }
            #if DEBUG
            // This on-device copy is temporary, including rejected responses.
            // Development validation originals live outside UserDefaults.
            InvestigationResultCache.saveRawResponse(data, forKey: storageKey)
            #endif
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                let failure = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                needsReload = failure?["code"] as? String == "SOURCE_CHANGED" || failure?["code"] as? String == "PRIOR_TURN_MISMATCH"
                struct ReadFailure: Decodable { let question: String?; let financialCalculations: InvestigationAnalysis.Finance? }
                if let checked = try? JSONDecoder().decode(ReadFailure.self, from: data), checked.question == submittedQuestion,
                   let financial = checked.financialCalculations { readFinancial = financial }
                let error = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                throw NSError(domain: "Research", code: 1, userInfo: [NSLocalizedDescriptionKey: error?["message"] as? String ?? "分析暂不可用，请重新读取资料。"])
            }
            let answer = try JSONDecoder().decode(InvestigationTurn.self, from: data)
            guard answer.ok, answer.symbol == selection.symbol, answer.membershipId == selection.membershipId,
                  answer.membershipVersion == selection.membershipVersion, answer.fingerprint == evidence.fingerprint,
                  answer.question == submittedQuestion, answer.mode == selection.mode, answer.eventDate == submittedDate,
                  InvestigationResultCache.canResume(answer, fingerprint: evidence.fingerprint, receiptKeyId: evidence.receiptKeyId)
            else { throw URLError(.cannotParseResponse) }
            turns.append(answer)
            startsNewConversation = false
            let saved = InvestigationResultCache.save(answer, archiveKey: historyArchiveKey)
            history = InvestigationResultCache.history(id: selection.membershipId, version: selection.membershipVersion, symbol: selection.symbol, mode: selection.mode, eventDate: submittedDate, archiveKey: historyArchiveKey)
            if saved && !InvestigationResultCache.saveSession(turns, forKey: storageKey) {
                temporaryConversationNotice = "回答与历史已保存，但追问数组回读未完成；重开后请先核对恢复的前文。"
            } else if !saved && InvestigationTemporaryRetention.policy() != .none {
                temporaryConversationNotice = "回答已显示，但临时会话保存或回读未完成；旧记录未覆盖，重开前文不可保证。"
            }
            question = ""; composing = false; questionFocused = false
        } catch {
            guard operationRevision == revision, auth == AppEnvironment.researchAuthorizationContext(),
                  researchTemporaryConversationClearMarker() == clearMarker else { return }
            issue = error.localizedDescription
            composing = true
        }
    }
    private func priorLength(_ prior: [[String: Any]]) throws -> Int {
        let data = try JSONSerialization.data(withJSONObject: prior)
        // Match the existing server's JSON.stringify(...).length limit. The
        // reader separately budgets the actual UTF-8 bytes sent to the model.
        return String(decoding: data, as: UTF8.self).utf16.count
    }
}
