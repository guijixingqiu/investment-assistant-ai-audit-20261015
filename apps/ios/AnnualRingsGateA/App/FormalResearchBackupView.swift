import CryptoKit
import SwiftUI
import UniformTypeIdentifiers
import UIKit

private struct FormalBackupTrigger: Decodable, Equatable {
    let kind: String
    let eventId: String?
}

private struct FormalBackupCounts: Decodable {
    let memberships: Int
    let originals: Int
    let tables: [String: Int]
}

private struct FormalBackupFailure: Decodable {
    let code: String
    let failedAt: String?
}

private struct FormalBackupStatus: Decodable {
    let status: String
    let snapshotId: String?
    let cutoffAt: String?
    let counts: FormalBackupCounts?
    let trigger: FormalBackupTrigger?
    let failure: FormalBackupFailure?
    let lastFailure: FormalBackupFailure?
    let receiptWarning: String?
    let cloudSyncStatus: String?
}

private struct FormalBackupSubmission: Decodable {
    let status: String
    let trigger: FormalBackupTrigger
    let cloudSyncStatus: String
}

private struct FormalSnapshotList: Decodable {
    let snapshots: [FormalSnapshotItem]
}
private struct FormalSnapshotItem: Decodable, Identifiable {
    let snapshotId: String
    let status: String
    let cutoffAt: String?
    let counts: FormalBackupCounts?
    var id: String { snapshotId }
}
private struct FormalRestoreStatus: Decodable {
    let restoreId: String
    let snapshotId: String
    let attempt: Int
    let status: String
    let databaseRestore: String
    let failure: FormalBackupFailure?
}
private struct FormalRestoredCompany: Decodable, Identifiable {
    let id: String
    let market: String
    let code: String
    let version: Int
    var label: String { "\(market).\(code)" }
}
private struct FormalRestoredCompanies: Decodable {
    let restoreId: String
    let companies: [FormalRestoredCompany]
}
private struct FormalRestoredSource: Decodable, Identifiable {
    let id: String
    let publisher: String
    let responseUrl: String
    let summary: String
    let capturedAt: String
    let normalizedText: String
    let textTruncated: Bool
}
private struct FormalRestoredDocument: Decodable, Identifiable {
    let id: String
    let title: String
    let pdfSha256: String
    let pageCount: Int
    let pageText: String?
}
private struct FormalRestoredReport: Decodable, Identifiable {
    let id: String
    let evidencePackId: String?
    let status: String
    let reportText: String
    let createdAt: String
}
private struct FormalRestoredEvidenceItem: Decodable {
    let packId: String
    let evidenceId: String
    let title: String
    let citations: [TwoLayerReportCitation]
}
private struct FormalRestoredDecision: Decodable, Identifiable {
    let id: String
    let decision: String
    let note: String?
    let createdAt: String
}
private struct FormalRestoredCheck: Decodable, Identifiable {
    let id: String
    let actionIntent: String
    let verdict: String
    let userFinalDecision: String?
    let contextText: String?
}
private struct FormalRestoredReview: Decodable, Identifiable {
    let id: String
    let outcome: String
    let outcomeEvidence: String?
    let reviewNote: String?
}
private struct FormalRestoredReviewSnapshot: Decodable, Identifiable {
    let id: String
    let payloadText: String
}
private struct FormalRestoredDetail: Decodable {
    let company: FormalRestoredCompany
    let sourceSnapshots: [FormalRestoredSource]
    let documents: [FormalRestoredDocument]
    let reports: [FormalRestoredReport]
    let evidenceItems: [FormalRestoredEvidenceItem]?
    let reportDecisions: [FormalRestoredDecision]
    let decisionChecks: [FormalRestoredCheck]
    let postDecisionReviews: [FormalRestoredReview]
    let reviewSnapshots: [FormalRestoredReviewSnapshot]
    let pdfState: String
    let sourceState: String
}
private struct FormalRestoredFullSource: Decodable {
    let sourceId: String
    let normalizedText: String
    let textSha256: String
    let rawOriginalStatus: String?
}
private struct FormalRestoredTextPresentation: Identifiable {
    let id = UUID()
    let title: String
    let text: String
    let excerpt: String?
    let rawOriginalVerified: Bool
}

// A read-only projection of the saved protocol. Unknown historical shapes stay visibly incomplete.
private struct FormalRestoredNarrative {
    let judgment: String?
    let evidence: String?
    let risk: String?
    let action: String?

    var hasReadableBody: Bool { judgment != nil || evidence != nil || risk != nil || action != nil }

    private static func object(_ raw: String) -> [String: Any] {
        guard let data = raw.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return value
    }

    private static func text(_ value: Any?) -> String? {
        guard let value = value as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func strings(_ value: Any?) -> [String] {
        (value as? [Any] ?? []).compactMap { text($0) }
    }

    private static func facts(_ value: Any?) -> [String] {
        (value as? [[String: Any]] ?? []).compactMap { text($0["statement"]) }
    }

    private static func joined(_ values: [String]) -> String? {
        var seen = Set<String>()
        let unique = values.filter { seen.insert($0).inserted }
        return unique.isEmpty ? nil : unique.joined(separator: "；")
    }

    static func report(_ raw: String) -> Self {
        let body = object(raw)
        let advice = body["adviceLayer"] as? [String: Any] ?? [:]
        let research = body["researchLayer"] as? [String: Any] ?? [:]
        let longTerm = advice["longTerm"] as? [String: Any] ?? [:]
        let mediumTerm = advice["mediumShortTerm"] as? [String: Any] ?? [:]
        return Self(
            judgment: text(advice["conclusion"]) ?? text(body["investmentThesis"]),
            evidence: joined(facts(research["fundamentals"]) + facts(body["factTable"])),
            risk: joined(strings(longTerm["risks"]) + strings(mediumTerm["risks"])
                + strings(body["invalidationConditions"]) + strings(body["unknownItems"])),
            action: joined(([text(advice["direction"])].compactMap { $0 })
                + strings(advice["priceConditions"]) + strings(body["nextValidationQuestions"])
                + [text(advice["nextQuestion"])].compactMap { $0 })
        )
    }

    static func decisionContext(_ raw: String) -> Self {
        let body = object(raw)
        let summary = body["suggestionSummary"] as? [String: Any] ?? [:]
        let research = body["research"] as? [String: Any] ?? [:]
        let evidence = (research["evidence"] as? [[String: Any]] ?? []).compactMap { text($0["summary"]) }
        return Self(judgment: text(summary["summary"]), evidence: joined(evidence),
            risk: joined(strings(summary["limitations"]) + [text(research["staleReason"])].compactMap { $0 }),
            action: nil)
    }

    static func review(_ raw: String) -> Self {
        let body = object(raw)
        let payload = body["payload"] as? [String: Any] ?? [:]
        let next = payload["nextValidation"] as? [String: Any] ?? [:]
        return Self(judgment: text(body["ownerReason"]),
            evidence: joined(strings(payload["newFacts"])
                + strings(body["reviewedEvidenceIds"]).map { "证据 #\($0)" }),
            risk: joined(strings(payload["counterevidence"]) + strings(payload["unknown"])),
            action: text(next["description"]) ?? text(payload["thesisActionId"]).map { "已记录 Thesis 动作 #\($0)" })
    }
}

private struct FormalRestoredReviewContent: Decodable {
    struct BaselineChange: Decodable {
        let factsChanged: Bool?
        let assumptionsChanged: Bool?
        let scenarioChanged: Bool?
        let priceChanged: Bool?
        let sharesChanged: Bool?
        let fxChanged: Bool?
        let testsChanged: Bool?
        let expectationGapChanged: Bool?
    }
    struct ScenarioChange: Decodable {
        let variable: String?
        let before: Double?
        let after: Double?
        let kind: String?
        let reason: String?
    }
    struct ScenarioDiff: Decodable {
        let fromVersion: Int?
        let toVersion: Int?
        let assumptionChanges: [ScenarioChange]?
        let newFactIds: [String]?
        let guidanceChanges: [String]?
        let calculationChanged: Bool?
        let marketInputChanges: [String]?
    }
    struct ExpectationGap: Decodable {
        let status: String?
        let ownerBase: Double?
        let conditionalMarketImplied: Double?
        let absoluteGap: Double?
        let percentageGap: Double?
        let currency: String?
        let reasons: [String]?
    }
    struct NextValidation: Decodable {
        let description: String?
        let expectedEvidence: String?
        let targetDate: String?
    }
    struct Milestone: Decodable {
        let description: String?
        let expectedEvidence: String?
        let targetDate: String?
    }
    struct TestResult: Decodable {
        let result: String?
        let explanation: String?
        let missingMetrics: [String]?
    }
    struct Payload: Decodable {
        let milestone: Milestone?
        let whyReviewNow: [String]?
        let newFacts: [String]?
        let invalidatedEvidence: [String]?
        let testResultDelta: [TestResult]?
        let sinceBaseline: BaselineChange?
        let scenarioDiff: ScenarioDiff?
        let currentBaseStatus: String?
        let conditionalMarketImpliedStatus: String?
        let expectationGap: ExpectationGap?
        let counterevidence: [String]?
        let unknown: [String]?
        let nextValidation: NextValidation?
    }
    let scenarioPeriodType: String?
    let ownerReason: String?
    let triggerReasons: [String]?
    let evidenceState: String?
    let reviewStatusBefore: String?
    let reviewedEvidenceIds: [String]?
    let currentBaseScenarioId: String?
    let currentBaseVersion: Int?
    let expectationGapStatus: String?
    let thesisActionId: String?
    let payload: Payload?

    var hasReadableBody: Bool {
        ownerReason != nil || !(triggerReasons ?? []).isEmpty || payload?.nextValidation != nil
    }
}

private struct FormalBackupFile: Decodable {
    let path: String
    let sha256: String
    let bytes: Int
}

private struct FormalBackupManifest: Decodable {
    struct Owner: Decodable { let actorType: String; let actorId: String }
    let schemaVersion: String
    let snapshotId: String
    let cutoffAt: String
    let owner: Owner
    let trigger: FormalBackupTrigger
    let counts: FormalBackupCounts
    let cloudSyncStatus: String
    let files: [FormalBackupFile]

    var companyIds: [String] {
        files.compactMap { file in
            let parts = file.path.split(separator: "/")
            return parts.count == 3 && parts[0] == "companies" && parts[2] == "research.json"
                ? String(parts[1]) : nil
        }.sorted()
    }
    func file(_ path: String) -> FormalBackupFile? { files.first { $0.path == path } }
}

private enum FormalBackupScope: Equatable {
    case all
    case company(String)

    var label: String {
        switch self {
        case .all: "全部公司"
        case .company(let id): "单公司 #\(id)"
        }
    }
    var suffix: String {
        switch self {
        case .all: "all"
        case .company(let id): "company-\(id)"
        }
    }
}

private enum FormalBackupClientError: Error {
    case missingReadAuthorization
    case missingWriteAuthorization
    case http(Int)
    case invalidResponse
    case invalidManifest
    case authorizationChanged
}

@MainActor
private struct FormalBackupClient {
    let auth: AppResearchAuthorizationContext
    private let session = URLSession.shared

    private func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(url: auth.baseURL.appending(path: "api/mobile/research/formal-backup").appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { parts.queryItems = query }
        return parts.url!
    }
    private func request(_ url: URL, write: Bool = false) throws -> URLRequest {
        var value = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
        let token = write ? auth.writeToken : auth.readToken
        guard let token, !token.isEmpty else { throw write ? FormalBackupClientError.missingWriteAuthorization : .missingReadAuthorization }
        value.setValue(token, forHTTPHeaderField: write ? auth.writeHeaderName : auth.readHeaderName)
        return value
    }
    private func check(_ response: URLResponse, expected: Int = 200) throws {
        guard let http = response as? HTTPURLResponse else { throw FormalBackupClientError.invalidResponse }
        guard http.statusCode == expected else { throw FormalBackupClientError.http(http.statusCode) }
        guard auth == AppEnvironment.researchAuthorizationContext() else { throw FormalBackupClientError.authorizationChanged }
    }
    func status(eventId: String? = nil) async throws -> FormalBackupStatus {
        let query = eventId.map { [URLQueryItem(name: "kind", value: "manual"), URLQueryItem(name: "eventId", value: $0)] } ?? []
        let (data, response) = try await session.data(for: request(url("status", query: query)))
        try check(response)
        let value = try JSONDecoder().decode(FormalBackupStatus.self, from: data)
        guard value.cloudSyncStatus == "UNKNOWN" else { throw FormalBackupClientError.invalidResponse }
        return value
    }
    func submit(idempotencyKey: String) async throws -> FormalBackupSubmission {
        var value = try request(url("snapshots"), write: true)
        value.httpMethod = "POST"
        value.setValue("application/json", forHTTPHeaderField: "content-type")
        value.httpBody = try JSONSerialization.data(withJSONObject: ["idempotencyKey": idempotencyKey])
        let (data, response) = try await session.data(for: value)
        try check(response, expected: 202)
        let submitted = try JSONDecoder().decode(FormalBackupSubmission.self, from: data)
        guard submitted.status == "TRIGGERED_LOCAL", submitted.trigger.kind == "manual",
              submitted.trigger.eventId?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              submitted.cloudSyncStatus == "UNKNOWN" else { throw FormalBackupClientError.invalidResponse }
        return submitted
    }
    func snapshots() async throws -> [FormalSnapshotItem] {
        let (data, response) = try await session.data(for: request(url("snapshots")))
        try check(response)
        return try JSONDecoder().decode(FormalSnapshotList.self, from: data).snapshots
    }
    func submitRestore(snapshotId: String, idempotencyKey: String) async throws -> FormalRestoreStatus {
        var value = try request(url("restores"), write: true)
        value.httpMethod = "POST"
        value.setValue("application/json", forHTTPHeaderField: "content-type")
        value.httpBody = try JSONSerialization.data(withJSONObject: ["snapshotId": snapshotId, "idempotencyKey": idempotencyKey])
        let (data, response) = try await session.data(for: value)
        try check(response, expected: 202)
        let result = try JSONDecoder().decode(FormalRestoreStatus.self, from: data)
        guard result.snapshotId == snapshotId,
              result.restoreId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw FormalBackupClientError.invalidResponse }
        return result
    }
    func restoreStatus(_ restoreId: String) async throws -> FormalRestoreStatus {
        let (data, response) = try await session.data(for: request(url("restores/\(restoreId)")))
        try check(response)
        let result = try JSONDecoder().decode(FormalRestoreStatus.self, from: data)
        guard result.restoreId == restoreId else { throw FormalBackupClientError.invalidResponse }
        return result
    }
    func restoredCompanies(_ restoreId: String) async throws -> [FormalRestoredCompany] {
        let (data, response) = try await session.data(for: request(url("restores/\(restoreId)/companies")))
        try check(response)
        let result = try JSONDecoder().decode(FormalRestoredCompanies.self, from: data)
        guard result.restoreId == restoreId else { throw FormalBackupClientError.invalidResponse }
        return result.companies
    }
    func restoredDetail(_ restoreId: String, membershipId: String) async throws -> FormalRestoredDetail {
        let (data, response) = try await session.data(for: request(url("restores/\(restoreId)/companies/\(membershipId)")))
        try check(response)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let result = try decoder.decode(FormalRestoredDetail.self, from: data)
        guard result.company.id == membershipId else { throw FormalBackupClientError.invalidResponse }
        return result
    }
    func restoredPDF(_ restoreId: String, membershipId: String, document: FormalRestoredDocument) async throws -> Data {
        let (data, response) = try await session.data(for: request(url("restores/\(restoreId)/companies/\(membershipId)/originals/\(document.pdfSha256)")))
        try check(response)
        guard SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == document.pdfSha256 else { throw FormalBackupClientError.invalidManifest }
        return data
    }
    func restoredPage(_ restoreId: String, membershipId: String, documentId: String,
                      pageNumber: Int) async throws -> ResearchDocumentPageData {
        let (data, response) = try await session.data(for: request(url("restores/\(restoreId)/companies/\(membershipId)/documents/\(documentId)/pages/\(pageNumber)")))
        try check(response)
        let page = try JSONDecoder().decode(ResearchDocumentPageData.self, from: data)
        let digest = SHA256.hash(data: Data(page.normalizedText.utf8)).map { String(format: "%02x", $0) }.joined()
        guard page.documentId == documentId, page.pageNumber == pageNumber,
              digest == page.pageTextSha256 else { throw FormalBackupClientError.invalidResponse }
        return page
    }
    func restoredSource(_ restoreId: String, membershipId: String, source: FormalRestoredSource) async throws -> FormalRestoredFullSource {
        let (data, response) = try await session.data(for: request(url("restores/\(restoreId)/companies/\(membershipId)/sources/\(source.id)")))
        try check(response)
        let result = try JSONDecoder().decode(FormalRestoredFullSource.self, from: data)
        let digest = SHA256.hash(data: Data(result.normalizedText.utf8)).map { String(format: "%02x", $0) }.joined()
        guard result.sourceId == source.id, digest == result.textSha256,
              result.normalizedText.hasPrefix(source.normalizedText) else {
            throw FormalBackupClientError.invalidResponse
        }
        if let status = result.rawOriginalStatus, !["verified", "unavailable"].contains(status) {
            throw FormalBackupClientError.invalidResponse
        }
        return result
    }
    func data(snapshotId: String, path: String) async throws -> Data {
        let (data, response) = try await session.data(for: request(fileURL(snapshotId: snapshotId, path: path)))
        try check(response)
        return data
    }
    func download(snapshotId: String, file: FormalBackupFile, to destination: URL) async throws {
        let (temporary, response) = try await session.download(for: request(fileURL(snapshotId: snapshotId, path: file.path)))
        try check(response)
        let received = try digest(temporary, maximumBytes: file.bytes)
        guard received.bytes == file.bytes, received.sha256 == file.sha256 else { throw FormalBackupClientError.invalidManifest }
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: temporary, to: destination)
        let saved = try digest(destination, maximumBytes: file.bytes)
        guard saved.bytes == file.bytes, saved.sha256 == file.sha256 else { throw FormalBackupClientError.invalidManifest }
    }
    private func digest(_ url: URL, maximumBytes: Int) throws -> (bytes: Int, sha256: String) {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        var count = 0
        while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            hash.update(data: chunk)
            count += chunk.count
            guard count <= maximumBytes else { throw FormalBackupClientError.invalidManifest }
        }
        return (count, hash.finalize().map { String(format: "%02x", $0) }.joined())
    }
    private func fileURL(snapshotId: String, path: String) throws -> URL {
        guard snapshotId.range(of: "^formal-[0-9]{14}-[a-f0-9]{8}$", options: .regularExpression) != nil,
              !path.isEmpty,
              path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.range(of: "^[a-zA-Z0-9_.-]+$", options: .regularExpression) != nil }) else {
            throw FormalBackupClientError.invalidManifest
        }
        return url("snapshots/\(snapshotId)/files", query: [URLQueryItem(name: "path", value: path)])
    }
}

private struct FormalBackupShare: Identifiable {
    let id = UUID()
    let directory: URL
    let parent: URL
}

private struct FormalBackupShareSheet: UIViewControllerRepresentable {
    let directory: URL
    let parent: URL
    final class Coordinator {
        let parent: URL
        let hasAccess: Bool
        init(parent: URL) {
            self.parent = parent
            hasAccess = parent.startAccessingSecurityScopedResource()
        }
        deinit { if hasAccess { parent.stopAccessingSecurityScopedResource() } }
    }
    func makeCoordinator() -> Coordinator { Coordinator(parent: parent) }
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [directory], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// All-company formal archive: this view never derives state from the selected stock.
struct FormalResearchBackupView: View {
    @AppStorage("formalBackupRestoreId") private var persistedRestoreId = ""
    @AppStorage("formalBackupRestoreKey") private var persistedRestoreKey = ""
    @AppStorage("formalBackupRestoreSnapshotId") private var persistedRestoreSnapshotId = ""
    @State private var latest: FormalBackupStatus?
    @State private var manual: FormalBackupStatus?
    @State private var eventId: String?
    @State private var retryKey: String?
    @State private var manifest: FormalBackupManifest?
    @State private var manifestBytes: Data?
    @State private var manifestDigestBytes: Data?
    @State private var companyNames: [String: String] = [:]
    @State private var selectedCompanyId = ""
    @State private var pendingScope: FormalBackupScope?
    @State private var choosingDirectory = false
    @State private var busy = false
    @State private var progress = ""
    @State private var message = ""
    @State private var savedDirectory: URL?
    @State private var savedParent: URL?
    @State private var shared: FormalBackupShare?
    @State private var generation = UUID()
    @State private var snapshots: [FormalSnapshotItem] = []
    @State private var selectedSnapshotId = ""
    @State private var restore: FormalRestoreStatus?
    @State private var restoredCompanies: [FormalRestoredCompany] = []
    @State private var selectedRestoredCompanyId = ""
    @State private var restoredDetail: FormalRestoredDetail?
    @State private var restoredPDF: ResearchDocumentPDFPresentation?
    @State private var restoredText: FormalRestoredTextPresentation?
    @State private var confirmingRestore = false

    var body: some View {
        Form {
            Section("我的全部研究资料") {
                Text("一次保存我的全部公司研究记录和原件，不受当前选中股票限制。")
                    .font(.footnote)
                Button("刷新备份状态") { Task { await refresh() } }
                    .disabled(busy).accessibilityIdentifier("formalBackupRefresh")
                if let latest {
                    Text("最近备份：\(label(latest.status))")
                    if let cutoff = latest.cutoffAt { Text("资料截止：\(localDate(cutoff))") }
                    if let counts = latest.counts {
                        Text("公司记录：\(counts.memberships) · 原件：\(counts.originals)")
                    }
                }
                Text("云端是否已同步：未知。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("立即备份") {
                Button("备份我的全部研究资料") { Task { await startManual() } }
                    .disabled(busy || AppEnvironment.writeAuthToken() == nil || latest?.status == "NOT_CONFIGURED")
                    .accessibilityIdentifier("formalBackupStartManual")
                Text("开始后会继续显示完成或失败；备份不会新建或更改报告、决定与资产记录。")
                    .font(.footnote).foregroundStyle(.secondary)
                if let manual {
                    Text("本次备份：\(label(manual.status))")
                    if let cutoff = manual.cutoffAt { Text("本次资料截止：\(localDate(cutoff))") }
                }
                if eventId != nil {
                    Button("刷新本次备份") { Task { await pollManual(once: true) } }
                        .disabled(busy).accessibilityIdentifier("formalBackupRefreshManual")
                }
            }
            Section("历史备份与隔离恢复") {
                Text("选定旧档案后，可将其中全部研究资料恢复到单独的本地数据库，再逐项打开核对。此操作不会替换当前研究资料。")
                    .font(.footnote).foregroundStyle(.secondary)
                if !snapshots.contains(where: { $0.status == "VERIFIED_LOCAL_MANIFEST" }) {
                    Text("暂无可选择的历史备份。")
                }
                else {
                    Picker("选择历史备份", selection: $selectedSnapshotId) {
                        ForEach(snapshots.filter { $0.status == "VERIFIED_LOCAL_MANIFEST" }) { item in
                            Text("\(item.cutoffAt.map(localDate) ?? item.snapshotId) · \(item.counts?.memberships ?? 0) 家公司")
                                .tag(item.snapshotId)
                        }
                    }
                    Button("查看所选备份文件") { Task { await loadManifest(snapshotId: selectedSnapshotId) } }
                        .disabled(busy || selectedSnapshotId.isEmpty)
                    Button("恢复所选备份到隔离数据库") { confirmingRestore = true }
                        .disabled(busy || selectedSnapshotId.isEmpty || AppEnvironment.writeAuthToken() == nil)
                        .accessibilityIdentifier("formalBackupRestoreIsolated")
                }
                if let restore {
                    Text("隔离恢复：\(restoreLabel(restore.status)) · 第 \(restore.attempt) 次尝试")
                    if let failure = restore.failure { Text("失败代码：\(failure.code)").font(.footnote) }
                    Button("刷新本次恢复") { Task { await pollRestore(once: true) } }
                        .disabled(busy)
                    if restore.status == "FAILED_LOCAL" || restore.status == "FAILED_INTERRUPTED" {
                        Button("重试同一恢复请求") { Task { await startRestore(snapshotId: restore.snapshotId) } }
                            .disabled(busy || AppEnvironment.writeAuthToken() == nil)
                    }
                }
                if restore?.status == "VERIFIED_LOCAL_DATABASE" {
                    if restoredCompanies.isEmpty { Text("隔离数据库已验证；没有公司记录。") }
                    else {
                        Picker("查看已恢复公司", selection: $selectedRestoredCompanyId) {
                            ForEach(restoredCompanies) { company in Text(company.label).tag(company.id) }
                        }
                        Button("打开已恢复研究资料") { Task { await loadRestoredDetail() } }
                            .disabled(busy || selectedRestoredCompanyId.isEmpty)
                    }
                }
                if let restoredDetail {
                    Text("\(restoredDetail.company.label) · 已恢复资料").font(.headline)
                    if restoredDetail.pdfState == "NO_PDF" { Text("该公司没有 PDF；可继续查看网页存档文本、报告、决定和复盘。") }
                    if restoredDetail.sourceState == "NO_HTML_SOURCE" { Text("该公司没有已保存的网页存档文本。") }
                    ForEach(restoredDetail.sourceSnapshots) { source in
                        DisclosureGroup("网页存档文本 · \(source.publisher)") {
                            Text(source.summary)
                            if let url = URL(string: source.responseUrl), url.scheme == "https" { Link("原网页地址", destination: url) }
                            Text(source.normalizedText).textSelection(.enabled)
                            if source.textTruncated {
                                Text("正文较长，此处显示前 10 万字。")
                            }
                            Button("核验原始 HTML 并查看完整存档文本") { Task { await openRestoredSource(source) } }
                                .disabled(busy)
                        }
                    }
                    ForEach(restoredDetail.documents) { document in
                        DisclosureGroup("PDF 原件 · \(document.title)") {
                            Button("打开已恢复 PDF 原件") { Task { await openRestoredPDF(document) } }
                                .disabled(busy)
                            if let pageText = document.pageText { Text(pageText).textSelection(.enabled) }
                        }
                    }
                    ForEach(restoredDetail.reports) { report in
                        DisclosureGroup {
                            restoredReportCard(report)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("研究报告 · \(report.status)").font(.headline)
                                Text("保存于 \(report.createdAt) · 历史阅读，不表示当前仍有效")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    ForEach(restoredDetail.reportDecisions) { decision in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("报告决定 · \(decision.decision)").font(.headline)
                            Text("Owner 备注：\(decision.note ?? "未记录")").textSelection(.enabled)
                        }
                    }
                    ForEach(restoredDetail.decisionChecks) { check in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("决策检查 · \(check.verdict)").font(.headline)
                            Text("动作：\(check.actionIntent) · 最终决定：\(check.userFinalDecision ?? "未记录")")
                            if let context = check.contextText {
                                restoredDecisionContextCard(context)
                            } else {
                                Text("当时的决策依据未记录。")
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                    ForEach(restoredDetail.postDecisionReviews) { review in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("事后复盘 · \(review.outcome)").font(.headline)
                            Text("结果依据：\(review.outcomeEvidence ?? "未记录")").textSelection(.enabled)
                            Text("Owner 复盘：\(review.reviewNote ?? "未记录")").textSelection(.enabled)
                        }
                    }
                    ForEach(restoredDetail.reviewSnapshots) { review in
                        restoredReviewCard(review)
                    }
                }
            }
            Section("下载与分享") {
                Button("查看可下载备份") { Task { await loadManifest(snapshotId: selectedSnapshotId) } }
                    .disabled(busy || selectedSnapshotId.isEmpty)
                    .accessibilityIdentifier("formalBackupLoadManifest")
                if let manifest {
                    Text("可下载的备份 · 资料截止 \(localDate(manifest.cutoffAt))")
                    Text("完整备份包含全部公司的记录和原件；单公司文件供查看与分享。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("保存全部研究资料到文件") { choose(.all) }
                        .disabled(busy).accessibilityIdentifier("formalBackupDownloadAll")
                    if !manifest.companyIds.isEmpty {
                        Picker("选择公司", selection: $selectedCompanyId) {
                            ForEach(manifest.companyIds, id: \.self) { id in
                                Text(companyNames[id] ?? "公司资料（编号 \(id)）").tag(id)
                            }
                        }
                        Button("保存所选公司资料和原件") { choose(.company(selectedCompanyId)) }
                            .disabled(busy || selectedCompanyId.isEmpty)
                            .accessibilityIdentifier("formalBackupDownloadCompany")
                    }
                }
                if !progress.isEmpty { Text(progress).font(.footnote) }
                if !message.isEmpty { Text(message).font(.footnote).foregroundStyle(.secondary) }
                if let savedDirectory {
                    Button("分享已保存的文件夹") {
                        if let savedParent { shared = FormalBackupShare(directory: savedDirectory, parent: savedParent) }
                    }
                        .accessibilityIdentifier("formalBackupShare")
                    Text("已保存到文件：\(savedDirectory.lastPathComponent)").font(.footnote)
                }
            }
            if latest != nil || manual != nil || manifest != nil {
                Section {
                    DisclosureGroup("备份详情") {
                        if let latest {
                            Text("服务状态：\(latest.status)")
                            if let snapshotId = latest.snapshotId { Text("最近档案编号：\(snapshotId)") }
                            if let failure = latest.lastFailure { Text("最近故障代码：\(failure.code)") }
                            if let counts = latest.counts { Text("数据表数量：\(counts.tables.count)") }
                        }
                        if let manual {
                            Text("本次状态：\(manual.status)")
                            if let failure = manual.failure { Text("本次故障代码：\(failure.code)") }
                            if let warning = manual.receiptWarning { Text("主机提示代码：\(warning)") }
                        }
                        if let eventId { Text("本次事件编号：\(eventId)") }
                        if let manifest {
                            Text("已选档案编号：\(manifest.snapshotId)")
                            Text("完整备份含 JSON、CSV、原件及恢复结构；单公司文件不能单独用于完整恢复。")
                        }
                    }
                }
            }
        }
        .navigationTitle("研究资料备份")
        .fileImporter(isPresented: $choosingDirectory, allowedContentTypes: [.folder], allowsMultipleSelection: false) { result in
            guard let scope = pendingScope else { return }
            pendingScope = nil
            if case .success(let urls) = result, let directory = urls.first {
                Task { await save(scope, in: directory) }
            } else { message = "未选择保存目录；没有下载或改动备份。" }
        }
        .sheet(item: $shared) { FormalBackupShareSheet(directory: $0.directory, parent: $0.parent) }
        .sheet(item: $restoredPDF) { presentation in
            NavigationStack {
                ResearchDocumentPDFView(data: presentation.data, pageNumber: presentation.pageNumber)
                    .navigationTitle(presentation.title)
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .sheet(item: $restoredText) { presentation in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(presentation.rawOriginalVerified
                             ? "本次恢复的 HTML 原始字节已核验；下方仅显示抽取的存档文本，不执行网页脚本。"
                             : "仅有已恢复的存档文本；HTML 原件缺失或校验失败，不能作为原件重开。")
                            .font(.footnote)
                            .foregroundStyle(presentation.rawOriginalVerified ? Color.secondary : Color.orange)
                        if let excerpt = presentation.excerpt {
                            Text(presentation.rawOriginalVerified
                                 ? "本条报告引用的已核验原文片段" : "本条报告引用的存档文本片段")
                                .font(.headline)
                            Text(excerpt).textSelection(.enabled)
                            Divider()
                        }
                        Text(presentation.text).textSelection(.enabled)
                    }.padding()
                }
                    .navigationTitle(presentation.title)
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .confirmationDialog("恢复到单独的本地数据库？", isPresented: $confirmingRestore) {
            Button("开始隔离恢复") { Task { await startRestore(snapshotId: selectedSnapshotId) } }
        } message: {
            Text("将校验所选完整档案并写入新的隔离数据库；不会覆盖当前研究资料。")
        }
        .task { await refresh() }
        .onDisappear { generation = UUID() }
    }

    private func localDate(_ raw: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return "时间待核对" }
        let display = DateFormatter()
        display.locale = Locale(identifier: "zh_CN")
        display.timeZone = TimeZone(identifier: "Asia/Shanghai")
        display.dateFormat = "yyyy年M月d日 HH:mm"
        return display.string(from: date)
    }
    private func label(_ status: String) -> String {
        switch status {
        case "NOT_CONFIGURED": "未配置"
        case "UNKNOWN": "尚未确认完成"
        case "VERIFIED_LOCAL_MANIFEST": "已完成，可下载"
        case "LAST_ATTEMPT_FAILED": "最近一次未完成，旧备份仍可查看"
        case "PENDING_LOCAL": "等待开始"
        case "RUNNING_LOCAL": "正在备份"
        case "FAILED_LOCAL": "失败"
        case "FAILED_INTERRUPTED": "中断"
        case "EXPIRED_OR_UNAVAILABLE_LOCAL": "本次文件不可用"
        default: "暂时不可用"
        }
    }
    private func restoreLabel(_ status: String) -> String {
        switch status {
        case "PENDING_LOCAL": "等待开始"
        case "RUNNING_LOCAL": "正在恢复"
        case "VERIFIED_LOCAL_DATABASE": "隔离数据库已恢复并核对"
        case "FAILED_LOCAL": "恢复失败，保留失败现场"
        case "FAILED_INTERRUPTED": "恢复中断，保留失败现场"
        default: "状态不可用"
        }
    }
    private func pretty(_ raw: String) -> String {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let formatted = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
              let text = String(data: formatted, encoding: .utf8) else { return raw }
        return text
    }
    private func restoredNarrativeLine(_ title: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption.weight(.semibold))
            Text(value ?? "原记录未提供可识别内容")
                .foregroundStyle(value == nil ? .secondary : .primary)
                .textSelection(.enabled)
        }
    }

    private func restoredReportCard(_ report: FormalRestoredReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("研究报告 · \(report.status)").font(.headline)
            Text("保存于 \(report.createdAt) · 历史阅读，不表示当前仍有效")
                .font(.caption).foregroundStyle(.secondary)
            if let data = report.reportText.data(using: .utf8),
               let payload = try? JSONDecoder().decode(TwoLayerStoredPayload.self, from: data) {
                restoredNarrativeLine("研究问题", payload.researchQuestion)
                restoredNarrativeLine("资料截止", payload.cutoffAt)
                restoredNarrativeLine("当时判断", payload.adviceLayer?.conclusion ?? payload.investmentThesis)
                if let advice = payload.adviceLayer {
                    restoredNarrativeLine("适用期限", "\(advice.horizonStatement) · 至 \(advice.applicableUntil)")
                    restoredNarrativeLine("价格与方向条件", ([advice.direction, advice.priceRange,
                        advice.researchPositionRange].compactMap { $0 } + (advice.priceConditions ?? []))
                        .joined(separator: "；"))
                    restoredStringSection("假设", advice.assumptions ?? [])
                    restoredStringSection("建议中的情景", advice.scenarios ?? [])
                    restoredNarrativeLine("长期观点", advice.longTerm.view)
                    restoredStringSection("长期成立条件", advice.longTerm.conditions)
                    restoredStringSection("长期风险与失效条件", advice.longTerm.risks + advice.longTerm.invalidationConditions)
                    restoredNarrativeLine("中短期观点", advice.mediumShortTerm.view)
                    restoredStringSection("中短期成立条件", advice.mediumShortTerm.conditions)
                    restoredStringSection("中短期风险与失效条件", advice.mediumShortTerm.risks + advice.mediumShortTerm.invalidationConditions)
                    restoredNarrativeLine("长短期关系", advice.conflict.description)
                    restoredNarrativeLine("建议的下一问题", advice.nextQuestion)
                    restoredNarrativeLine("版本变化", advice.versionChange)
                } else {
                    Text("这份历史报告没有两层建议正文；以下按当时保存的研究字段阅读。")
                        .foregroundStyle(.orange)
                }
                restoredStringSection("关键驱动与因果链", payload.keyDrivers + payload.causalChain)
                restoredStringSection("估值情景", payload.valuationScenarios)
                if let valuation = payload.evidencePackBinding?.valuation {
                    let input = valuation.assumptions.values
                    restoredNarrativeLine("当时冻结的估值假设",
                        "情景 #\(valuation.scenarioId) v\(valuation.scenarioRevision) · 方法 \(input.methodId ?? "未记录") · 币种 \(input.metricCurrency ?? "未记录") · 每股基数 \(input.baseMetricPerShare) · 年增长 \(input.annualGrowthRate) · 年限 \(input.horizonYears) · 终值倍数 \(input.terminalMultiple) · 折现率 \(input.annualDiscountRate) · 每股净现金 \(input.netCashPerShare)")
                }
                restoredStringSection("隐含预期", payload.impliedExpectations)
                restoredStringSection("失效条件与未知", payload.invalidationConditions + payload.unknownItems)
                restoredNarrativeLine("来源冲突判断", payload.sourceConflictAssessment)
                restoredConflictSection(payload.researchLayer.flatMap {
                    $0.sourceConflicts.isEmpty ? nil : $0.sourceConflicts
                } ?? payload.sourceConflicts,
                    report: report)
                Text("支持证据").font(.caption.weight(.semibold))
                restoredEvidenceLinks(report: report, evidenceIds: payload.supportEvidenceIds,
                    directCitation: nil)
                Text("反证证据").font(.caption.weight(.semibold))
                restoredEvidenceLinks(report: report, evidenceIds: payload.counterEvidenceIds,
                    directCitation: nil)
                restoredFactSection("已存事实表", payload.factTable, report: report)
                if let research = payload.researchLayer {
                    restoredFactSection("基本面", research.fundamentals, report: report)
                    restoredFactSection("行业与宏观上下文", research.context ?? [], report: report)
                    restoredFactSection("估值依据", research.valuation, report: report)
                    restoredFactSection("技术与量化依据", research.technical + (research.quantPortfolio ?? []), report: report)
                    restoredFactSection("事件与催化", research.eventsAndCatalysts, report: report)
                    restoredFactSection("经营监测", research.operatingMonitor ?? [], report: report)
                    restoredFactSection("主要风险", research.risks, report: report)
                    restoredFactSection("反证", research.counterevidence, report: report)
                    restoredFactSection("待核实未知", research.unknowns, report: report)
                    restoredStringSection("下一验证问题", research.nextValidationQuestions.isEmpty
                        ? payload.nextValidationQuestions : research.nextValidationQuestions)
                } else {
                    Text("当时未保存可识别的分层研究正文。")
                        .font(.caption).foregroundStyle(.secondary)
                    restoredStringSection("下一验证问题", payload.nextValidationQuestions)
                }
                restoredFactSection("模型推断（非来源原话）", payload.modelInferences, report: report)
                restoredNarrativeLine("相对上一版", payload.changeFromPrevious)
                restoredStringSection("组合影响", payload.portfolioImpact)
            } else {
                Text("旧版报告协议不能完整解码；只展示可识别片段，缺少的章节仍是缺口。")
                    .foregroundStyle(.orange)
                let summary = FormalRestoredNarrative.report(report.reportText)
                restoredNarrativeLine("判断", summary.judgment)
                restoredNarrativeLine("依据", summary.evidence)
                restoredNarrativeLine("风险", summary.risk)
                restoredNarrativeLine("下一步", summary.action)
            }
            DisclosureGroup("查看原始报告记录") {
                Text(pretty(report.reportText)).font(.footnote.monospaced()).textSelection(.enabled)
            }
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private func restoredStringSection(_ title: String, _ values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.semibold))
            if values.isEmpty {
                Text("当时未记录").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                    Text("\(index + 1). \(value)").textSelection(.enabled)
                }
            }
        }
    }

    private func restoredFactSection(_ title: String, _ facts: [TwoLayerReportFact],
                                     report: FormalRestoredReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold))
            if facts.isEmpty { Text("当时未记录").font(.caption).foregroundStyle(.secondary) }
            ForEach(Array(facts.enumerated()), id: \.offset) { index, fact in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(index + 1). \(fact.statement)").textSelection(.enabled)
                    if fact.sourceKind != nil || fact.claimType != nil || fact.stance != nil {
                        Text("来源 \(fact.sourceKind ?? "未记录") · 主张 \(fact.claimType ?? "未记录") · 立场 \(fact.stance ?? "未记录")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    restoredEvidenceLinks(report: report, evidenceIds: fact.evidenceIds,
                        directCitation: fact.citation)
                }
            }
        }
    }

    private func restoredConflictSection(_ conflicts: [TwoLayerReportConflict],
                                         report: FormalRestoredReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("来源冲突").font(.caption.weight(.semibold))
            if conflicts.isEmpty { Text("当时未记录").font(.caption).foregroundStyle(.secondary) }
            ForEach(Array(conflicts.enumerated()), id: \.offset) { _, conflict in
                Text(conflict.description).textSelection(.enabled)
                restoredEvidenceLinks(report: report, evidenceIds: conflict.evidenceIds,
                    directCitation: nil)
            }
        }
    }

    private func restoredEvidenceLinks(report: FormalRestoredReport, evidenceIds: [String],
                                       directCitation: TwoLayerReportCitation?) -> some View {
        let items = (restoredDetail?.evidenceItems ?? []).filter {
            $0.packId == report.evidencePackId && evidenceIds.contains($0.evidenceId)
        }
        let citations = ([directCitation].compactMap { $0 } + items.flatMap(\.citations))
            .filter(restoredCitationIsAddressable)
        return VStack(alignment: .leading, spacing: 3) {
            if !evidenceIds.isEmpty {
                Text("证据编号：\(evidenceIds.joined(separator: "、"))")
                    .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
            ForEach(Array(citations.enumerated()), id: \.offset) { _, citation in
                Button(citation.kind == "document_page"
                    ? "打开已恢复 PDF 第 \(citation.pageNumber ?? 0) 页"
                    : "核验已恢复网页引用片段") {
                    Task { await openRestoredCitation(citation) }
                }.disabled(busy)
            }
            if citations.isEmpty && (!evidenceIds.isEmpty || directCitation != nil) {
                Text("这条证据没有可从已恢复库核验的原件引用。")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
    }

    private func restoredCitationIsAddressable(_ citation: TwoLayerReportCitation) -> Bool {
        let positiveId = "^[1-9][0-9]*$"
        let sha = "^[a-f0-9]{64}$"
        if citation.kind == "document_page" {
            return citation.documentId?.range(of: positiveId, options: .regularExpression) != nil
                && citation.pageNumber.map({ $0 > 0 }) == true
                && citation.pageTextSha256?.range(of: sha, options: .regularExpression) != nil
        }
        if citation.kind == "source_snapshot" {
            return citation.snapshotId?.range(of: positiveId, options: .regularExpression) != nil
                && citation.textSha256?.range(of: sha, options: .regularExpression) != nil
                && citation.excerptSha256?.range(of: sha, options: .regularExpression) != nil
                && citation.startUtf16.map({ $0 >= 0 }) == true
                && citation.endUtf16.map({ $0 > (citation.startUtf16 ?? Int.max) }) == true
        }
        return false
    }

    private func restoredDecisionContextCard(_ raw: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("当时的决策依据").font(.headline)
            if let data = raw.data(using: .utf8),
               let context = try? JSONDecoder().decode(DecisionContextEnvelope.self, from: data) {
                restoredNarrativeLine("公司与生成时间", "\(context.requestedSymbol) · \(context.generatedAt)")
                restoredNarrativeLine("当时报价状态", "\(context.quote.status) · \(context.quote.message)")
                if let quote = context.quote.data {
                    restoredNarrativeLine("当时报价", "\(quote.price) \(quote.currency) · 报价时间 \(quote.quoteTime)")
                }
                restoredNarrativeLine("报价来源与抓取时间",
                    "\(context.quote.source ?? "未记录") · \(context.quote.fetchedAt ?? "未记录")")
                restoredNarrativeLine("报价过期原因", context.quote.staleReason)
                restoredNarrativeLine("研究证据状态", "\(context.research.status) · \(context.research.message)")
                restoredNarrativeLine("研究证据截止", context.research.evidenceAsOf)
                restoredStringSection("当时引用的研究证据", context.research.evidence.map { $0.summary })
                restoredStringSection("当时的待审建议", context.research.suggestions.map { $0.summary })
                restoredNarrativeLine("辅助判断", context.suggestionSummary.summary)
                restoredStringSection("判断所连证据编号", context.suggestionSummary.linkedEvidenceIds)
                restoredStringSection("辅助判断的限制", context.suggestionSummary.limitations)
                restoredNarrativeLine("量化证据状态", "\(context.quantEvidence.status) · \(context.quantEvidence.message)")
                restoredNarrativeLine("量化样本边界", context.quantEvidence.sampleBoundary.limitation)
                restoredStringSection("量化限制", context.quantEvidence.limitations)
                restoredNarrativeLine("组合边界", context.portfolio.message)
                Text("以上是当时保存的决策上下文，不代表当前报价或研究状态。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("旧版决策上下文结构不能完整解码；以下仅展示可识别内容，缺失部分仍是缺口。")
                    .foregroundStyle(.orange)
                let summary = FormalRestoredNarrative.decisionContext(raw)
                restoredNarrativeLine("判断", summary.judgment)
                restoredNarrativeLine("依据", summary.evidence)
                restoredNarrativeLine("风险", summary.risk)
            }
            DisclosureGroup("查看原始决策上下文") {
                Text(pretty(raw)).font(.footnote.monospaced()).textSelection(.enabled)
            }
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private func restoredReviewCard(_ review: FormalRestoredReviewSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("研究复盘快照").font(.headline)
            if let data = review.payloadText.data(using: .utf8),
               let content = try? JSONDecoder().decode(FormalRestoredReviewContent.self, from: data),
               content.hasReadableBody {
                restoredNarrativeLine("Owner 当时的复盘理由", content.ownerReason)
                restoredNarrativeLine("研究期间", content.scenarioPeriodType.map(restoredReviewLabel))
                restoredStringSection("为什么现在复盘", (content.triggerReasons ?? content.payload?.whyReviewNow ?? [])
                    .map(restoredReviewLabel))
                restoredNarrativeLine("当时证据状态", content.evidenceState.map(restoredReviewLabel))
                restoredNarrativeLine("复盘前研究状态", content.reviewStatusBefore.map(restoredReviewLabel))
                restoredNarrativeLine("当时写入的 Thesis 动作编号", content.thesisActionId)
                restoredNarrativeLine("验证节点", content.payload?.milestone?.description)
                restoredNarrativeLine("节点期待的证据", content.payload?.milestone?.expectedEvidence)
                restoredNarrativeLine("节点原定日期", content.payload?.milestone?.targetDate)
                restoredStringSection("复核的证据编号", content.reviewedEvidenceIds ?? [])
                restoredStringSection("新事实", content.payload?.newFacts ?? [])
                restoredStringSection("已失效证据编号", content.payload?.invalidatedEvidence ?? [])
                if let baseline = content.payload?.sinceBaseline {
                    let changed: [(String, Bool?)] = [
                        ("事实", baseline.factsChanged), ("Owner 假设", baseline.assumptionsChanged),
                        ("情景", baseline.scenarioChanged), ("价格", baseline.priceChanged),
                        ("股份基数", baseline.sharesChanged), ("汇率", baseline.fxChanged),
                        ("论点检验", baseline.testsChanged), ("预期差", baseline.expectationGapChanged)
                    ]
                    let present = changed.compactMap { $0.1 == true ? $0.0 : nil }
                    restoredStringSection("相对原基线的变化", present.isEmpty && changed.contains(where: { $0.1 != nil })
                        ? ["各项均未标记变化"] : present)
                } else {
                    restoredNarrativeLine("相对原基线的变化", nil)
                }
                if let diff = content.payload?.scenarioDiff {
                    restoredNarrativeLine("情景版本",
                        "原版 \(diff.fromVersion.map { String($0) } ?? "未记录") → 本版 \(diff.toVersion.map { String($0) } ?? "未记录")")
                    restoredStringSection("假设变化", (diff.assumptionChanges ?? []).map { change in
                        "\(change.variable ?? "未记录变量")：\(change.before.map { String($0) } ?? "未知") → \(change.after.map { String($0) } ?? "未知") · \(change.kind ?? "未记录类型") · \(change.reason ?? "未记录原因")"
                    })
                    restoredStringSection("情景中的新事实编号", diff.newFactIds ?? [])
                    restoredStringSection("指引变化", diff.guidanceChanges ?? [])
                    restoredStringSection("市场输入变化", diff.marketInputChanges ?? [])
                    restoredNarrativeLine("计算口径是否变化", diff.calculationChanged.map { $0 ? "是" : "否" })
                } else {
                    restoredNarrativeLine("情景差异", nil)
                }
                restoredNarrativeLine("当时 Base 状态", content.payload?.currentBaseStatus)
                let baseParts = [content.currentBaseScenarioId,
                    content.currentBaseVersion.map { "v\($0)" }].compactMap { $0 }
                restoredNarrativeLine("当时 Base 情景",
                    baseParts.isEmpty ? nil : baseParts.joined(separator: " · "))
                restoredNarrativeLine("市场隐含状态", content.payload?.conditionalMarketImpliedStatus.map(restoredReviewLabel))
                if let gap = content.payload?.expectationGap {
                    restoredNarrativeLine("预期差状态", gap.status.map(restoredReviewLabel))
                    restoredNarrativeLine("当时的 Base / 市场隐含 / 差额",
                        "\(gap.ownerBase.map { String($0) } ?? "未知") / \(gap.conditionalMarketImplied.map { String($0) } ?? "未知") / \(gap.absoluteGap.map { String($0) } ?? "未知") \(gap.currency ?? "币种未记录")")
                    restoredNarrativeLine("差额比例", gap.percentageGap.map { String($0) })
                    restoredStringSection("预期差限制", gap.reasons ?? [])
                } else {
                    restoredNarrativeLine("预期差", content.expectationGapStatus.map(restoredReviewLabel))
                }
                restoredStringSection("论点检验变化", (content.payload?.testResultDelta ?? []).map {
                    "\($0.result ?? "未记录结果") · \($0.explanation ?? "未记录解释") · 缺项：\(($0.missingMetrics ?? []).joined(separator: "、"))"
                })
                restoredStringSection("反证", content.payload?.counterevidence ?? [])
                restoredStringSection("未知", content.payload?.unknown ?? [])
                if let next = content.payload?.nextValidation {
                    restoredNarrativeLine("下一验证", next.description)
                    restoredNarrativeLine("预期证据", next.expectedEvidence)
                    restoredNarrativeLine("目标日期", next.targetDate)
                } else {
                    restoredNarrativeLine("下一验证", nil)
                }
            } else {
                Text("旧版研究复盘结构不能完整解码；以下仅展示可识别内容，缺失部分仍是缺口。")
                    .foregroundStyle(.orange)
                let summary = FormalRestoredNarrative.review(review.payloadText)
                restoredNarrativeLine("复盘理由", summary.judgment)
                restoredNarrativeLine("证据", summary.evidence)
                restoredNarrativeLine("风险与未知", summary.risk)
                restoredNarrativeLine("下一验证", summary.action)
            }
            DisclosureGroup("查看原始复盘记录") {
                Text(pretty(review.payloadText)).font(.footnote.monospaced()).textSelection(.enabled)
            }
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private func restoredReviewLabel(_ code: String) -> String {
        let labels = ["CURRENT_FY": "当财年", "NEXT_REPORTING_PERIOD": "下个报告期",
         "MILESTONE_EVIDENCE_ARRIVED": "验证节点证据已到",
         "MILESTONE_DUE_EVIDENCE_MISSING": "验证日期已到但证据仍缺",
         "THESIS_TEST_STATE_CHANGED": "论点检验结果变化",
         "EVIDENCE_INVALIDATED": "既有证据失效",
         "CURRENT_BASE_REVIEW_REQUIRED": "当前 Base 需要复核",
         "RELEVANT_EVIDENCE_CONFLICT": "相关证据冲突",
         "SUFFICIENT": "证据充分", "INSUFFICIENT": "证据不足",
         "CONFLICTING": "证据冲突", "INVALIDATED": "证据失效",
         "UNKNOWN": "未知", "REVIEW_DUE": "到期复核", "REVIEW_REQUIRED": "需要复核",
         "CURRENT": "当时为当前", "ENDED": "研究已结束"]
        return labels[code] ?? code
    }
    private func refresh() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        latest = nil; snapshots = []; manifest = nil; savedDirectory = nil; savedParent = nil; shared = nil; message = ""
        let client = FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
        do { latest = try await client.status() }
        catch { message = "最近备份状态暂不可读取。" }
        do {
            snapshots = try await client.snapshots()
            let available = snapshots.filter { $0.status == "VERIFIED_LOCAL_MANIFEST" }
            if !available.contains(where: { $0.snapshotId == selectedSnapshotId }) {
                selectedSnapshotId = available.first?.snapshotId ?? ""
            }
        } catch { message = "历史备份目录暂不可读取，请检查连接和读取权限。" }
        do {
            if persistedRestoreId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil {
                let status = try await client.restoreStatus(persistedRestoreId)
                guard status.snapshotId == persistedRestoreSnapshotId else { throw FormalBackupClientError.invalidResponse }
                restore = status
                if status.status == "VERIFIED_LOCAL_DATABASE" {
                    restoredCompanies = try await client.restoredCompanies(status.restoreId)
                    selectedRestoredCompanyId = restoredCompanies.first?.id ?? ""
                }
            }
        }
        catch { message = "本次隔离恢复状态暂不可读取，可稍后刷新。" }
    }
    private func startRestore(snapshotId: String) async {
        guard !busy, snapshotId.range(of: "^formal-[0-9]{14}-[a-f0-9]{8}$", options: .regularExpression) != nil else { return }
        let key = persistedRestoreSnapshotId == snapshotId && !persistedRestoreKey.isEmpty
            ? persistedRestoreKey : UUID().uuidString
        persistedRestoreSnapshotId = snapshotId
        persistedRestoreKey = key
        busy = true
        restoredDetail = nil; restoredCompanies = []; restore = nil; message = ""
        do {
            let status = try await FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
                .submitRestore(snapshotId: snapshotId, idempotencyKey: key)
            persistedRestoreId = status.restoreId
            restore = status
            message = "隔离恢复请求已提交，正在校验和写入单独的数据库。"
        } catch {
            message = "恢复提交结果尚未确认。可重试同一请求；失败现场不会被当作完成。"
            busy = false
            return
        }
        busy = false
        await pollRestore(once: false)
    }
    private func pollRestore(once: Bool) async {
        guard !busy, !persistedRestoreId.isEmpty else { return }
        let current = persistedRestoreId
        let revision = generation
        busy = true; defer { busy = false }
        let client = FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
        for attempt in 0..<(once ? 1 : 30) {
            do {
                let status = try await client.restoreStatus(current)
                guard revision == generation, status.restoreId == current,
                      status.snapshotId == persistedRestoreSnapshotId else { throw FormalBackupClientError.invalidResponse }
                restore = status
                if status.status == "VERIFIED_LOCAL_DATABASE" {
                    restoredCompanies = try await client.restoredCompanies(current)
                    selectedRestoredCompanyId = restoredCompanies.first?.id ?? ""
                    persistedRestoreKey = ""
                    message = "已恢复到隔离数据库。请选择公司，打开资料逐项核对。"
                    return
                }
                if status.status == "FAILED_LOCAL" || status.status == "FAILED_INTERRUPTED" {
                    message = "本次隔离恢复未完成，失败现场已保留；可重试同一请求。"
                    return
                }
            } catch {
                if revision == generation { message = "恢复状态暂不可读取，请稍后刷新本次恢复。" }
                return
            }
            if !once && attempt < 29 { try? await Task.sleep(for: .seconds(2)) }
            if revision != generation { return }
        }
        message = "恢复尚未确认完成，请稍后刷新本次恢复。"
    }
    private func loadRestoredDetail() async {
        guard !busy, let restore, restore.status == "VERIFIED_LOCAL_DATABASE",
              !selectedRestoredCompanyId.isEmpty else { return }
        busy = true; defer { busy = false }
        restoredDetail = nil
        do {
            restoredDetail = try await FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
                .restoredDetail(restore.restoreId, membershipId: selectedRestoredCompanyId)
        } catch { message = "已恢复数据库中的公司资料暂不可读取，请查看状态并重试。" }
    }
    private func openRestoredPDF(_ document: FormalRestoredDocument) async {
        guard !busy, let restore, let restoredDetail else { return }
        busy = true; defer { busy = false }
        do {
            let bytes = try await FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
                .restoredPDF(restore.restoreId, membershipId: restoredDetail.company.id, document: document)
            restoredPDF = ResearchDocumentPDFPresentation(title: document.title, data: bytes, pageNumber: 1)
        } catch { message = "已恢复 PDF 原件缺失或校验失败，暂不能打开。" }
    }
    private func openRestoredCitation(_ citation: TwoLayerReportCitation) async {
        guard !busy, let restore, restore.status == "VERIFIED_LOCAL_DATABASE",
              let detail = restoredDetail, selectedRestoredCompanyId == detail.company.id else { return }
        busy = true; defer { busy = false }
        let restoreId = restore.restoreId
        let membershipId = detail.company.id
        let auth = AppEnvironment.researchAuthorizationContext()
        let reader = FormalBackupClient(auth: auth)
        do {
            if citation.kind == "document_page", let documentId = citation.documentId,
               let pageNumber = citation.pageNumber, let pageHash = citation.pageTextSha256,
               let document = detail.documents.first(where: { $0.id == documentId }),
               (1...document.pageCount).contains(pageNumber) {
                let page = try await reader.restoredPage(restoreId, membershipId: membershipId,
                    documentId: documentId, pageNumber: pageNumber)
                guard page.pageTextSha256 == pageHash else { throw FormalBackupClientError.invalidResponse }
                let bytes = try await reader.restoredPDF(restoreId, membershipId: membershipId,
                    document: document)
                guard !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext(),
                      self.restore?.restoreId == restoreId,
                      restoredDetail?.company.id == membershipId,
                      selectedRestoredCompanyId == membershipId else { return }
                restoredPDF = ResearchDocumentPDFPresentation(title: document.title,
                    data: bytes, pageNumber: pageNumber)
                return
            }
            if citation.kind == "source_snapshot", let sourceId = citation.snapshotId,
               let textHash = citation.textSha256, let excerptHash = citation.excerptSha256,
               let start = citation.startUtf16, let end = citation.endUtf16,
               let source = detail.sourceSnapshots.first(where: { $0.id == sourceId }) {
                let saved = try await reader.restoredSource(restoreId, membershipId: membershipId,
                    source: source)
                let text = saved.normalizedText
                let utf16 = text as NSString
                guard start >= 0, end > start, end <= utf16.length,
                      SHA256.hash(data: Data(text.utf8)).map({ String(format: "%02x", $0) }).joined() == textHash else {
                    throw FormalBackupClientError.invalidResponse
                }
                let excerpt = utf16.substring(with: NSRange(location: start, length: end - start))
                guard SHA256.hash(data: Data(excerpt.utf8)).map({ String(format: "%02x", $0) }).joined() == excerptHash else {
                    throw FormalBackupClientError.invalidResponse
                }
                guard !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext(),
                      self.restore?.restoreId == restoreId,
                      restoredDetail?.company.id == membershipId,
                      selectedRestoredCompanyId == membershipId else { return }
                restoredText = FormalRestoredTextPresentation(title: source.publisher,
                    text: text, excerpt: excerpt,
                    rawOriginalVerified: saved.rawOriginalStatus == "verified")
                return
            }
            throw FormalBackupClientError.invalidResponse
        } catch {
            message = "该引用无法从已恢复数据库核对原页或原文片段；没有打开当前研究库的资料。"
        }
    }
    private func openRestoredSource(_ source: FormalRestoredSource) async {
        guard !busy, let restore, let restoredDetail else { return }
        busy = true; defer { busy = false }
        do {
            let saved = try await FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
                .restoredSource(restore.restoreId, membershipId: restoredDetail.company.id, source: source)
            restoredText = FormalRestoredTextPresentation(title: source.publisher,
                text: saved.normalizedText, excerpt: nil,
                rawOriginalVerified: saved.rawOriginalStatus == "verified")
        } catch { message = "已恢复网页存档文本缺失或校验失败，暂不能打开。" }
    }
    private func startManual() async {
        guard !busy else { return }
        let key = retryKey ?? UUID().uuidString
        retryKey = key; busy = true; defer { busy = false }
        manual = nil; eventId = nil; message = ""
        do {
            let result = try await FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext()).submit(idempotencyKey: key)
            eventId = result.trigger.eventId
            retryKey = nil
            message = "备份已开始，正在确认是否完成。"
        } catch {
            message = "手动备份未确认触发。可再次点击重试同一请求；不会把旧档案显示为本次成功。"
            return
        }
        busy = false
        await pollManual(once: false)
    }
    private func pollManual(once: Bool) async {
        guard !busy, let eventId else { return }
        let revision = generation
        busy = true; defer { busy = false }
        for attempt in 0..<(once ? 1 : 30) {
            do {
                let result = try await FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext()).status(eventId: eventId)
                guard revision == generation, result.trigger?.kind == "manual", result.trigger?.eventId == eventId else {
                    throw FormalBackupClientError.invalidResponse
                }
                manual = result
                if result.status == "VERIFIED_LOCAL_MANIFEST" {
                    if let snapshotId = result.snapshotId {
                        snapshots = try await FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext()).snapshots()
                        selectedSnapshotId = snapshotId
                    }
                    message = "本次备份已完成，可以保存到文件；云端是否同步仍未知。"
                    return
                }
                if ["FAILED_LOCAL", "FAILED_INTERRUPTED", "EXPIRED_OR_UNAVAILABLE_LOCAL", "UNAVAILABLE"].contains(result.status) {
                    message = "本次备份未完成，请查看失败状态。"
                    return
                }
            } catch {
                if revision == generation { message = "本次备份状态暂不可读取，可稍后刷新。" }
                return
            }
            if attempt < 29 && !once { try? await Task.sleep(for: .seconds(2)) }
            if revision != generation { return }
        }
        message = "本次备份仍未确认完成；稍后刷新本次备份。"
    }
    private func loadManifest(snapshotId: String) async {
        guard !busy, snapshots.contains(where: { $0.snapshotId == snapshotId && $0.status == "VERIFIED_LOCAL_MANIFEST" }) else { return }
        busy = true; defer { busy = false }
        manifest = nil; manifestBytes = nil; manifestDigestBytes = nil; savedDirectory = nil; savedParent = nil; shared = nil; companyNames = [:]
        do {
            let client = FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
            let bytes = try await client.data(snapshotId: snapshotId, path: "manifest.json")
            let digestBytes = try await client.data(snapshotId: snapshotId, path: "manifest.sha256")
            let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            guard String(decoding: digestBytes, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) == "\(digest)  manifest.json" else {
                throw FormalBackupClientError.invalidManifest
            }
            let value = try JSONDecoder().decode(FormalBackupManifest.self, from: bytes)
            guard value.schemaVersion == "2026-10-10.formal-research.v2", value.snapshotId == snapshotId,
                  value.owner.actorType == "user", !value.owner.actorId.isEmpty,
                  value.cloudSyncStatus == "UNKNOWN", value.counts.memberships >= 0, value.counts.originals >= 0,
                  Set(value.files.map(\.path)).count == value.files.count,
                  value.files.allSatisfy({ file in
                      file.bytes >= 0 && file.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
                          && !file.path.isEmpty && file.path.split(separator: "/", omittingEmptySubsequences: false)
                              .allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".."
                                  && $0.range(of: "^[a-zA-Z0-9_.-]+$", options: .regularExpression) != nil })
                  }),
                  value.file("all/candidate_memberships.json") != nil,
                  value.companyIds.count == value.counts.memberships,
                  Set(value.companyIds).count == value.companyIds.count else { throw FormalBackupClientError.invalidManifest }
            if let eventId, manual?.snapshotId == snapshotId {
                guard value.trigger.kind == "manual", value.trigger.eventId == eventId else { throw FormalBackupClientError.invalidManifest }
            }
            manifest = value; manifestBytes = bytes; manifestDigestBytes = digestBytes
            selectedCompanyId = value.companyIds.first ?? ""
            if let membershipFile = value.file("all/candidate_memberships.json") {
                let contents = try await client.data(snapshotId: snapshotId, path: membershipFile.path)
                if contents.count == membershipFile.bytes,
                   SHA256.hash(data: contents).map({ String(format: "%02x", $0) }).joined() == membershipFile.sha256,
                   let rows = try? JSONSerialization.jsonObject(with: contents) as? [[String: Any]] {
                    for row in rows {
                        let id = String(describing: row["id"] ?? "")
                        let market = row["market"] as? String ?? ""
                        let code = row["code"] as? String ?? ""
                        if value.companyIds.contains(id), !market.isEmpty, !code.isEmpty {
                            companyNames[id] = "\(market).\(code)"
                        }
                    }
                }
            }
            message = "备份可下载；请选择全部或单公司资料并保存到文件。"
        } catch {
            manifest = nil; message = "备份未能安全读取，因此暂不能下载。"
        }
    }
    private func choose(_ scope: FormalBackupScope) {
        pendingScope = scope; choosingDirectory = true; savedDirectory = nil; savedParent = nil; shared = nil; message = ""
    }
    private func save(_ scope: FormalBackupScope, in directory: URL) async {
        guard !busy, let manifest, let manifestBytes, let manifestDigestBytes else { return }
        let access = directory.startAccessingSecurityScopedResource()
        defer { if access { directory.stopAccessingSecurityScopedResource() } }
        busy = true; progress = "准备下载…"; defer { busy = false; progress = "" }
        let client = FormalBackupClient(auth: AppEnvironment.researchAuthorizationContext())
        let manager = FileManager.default
        let name = "\(manifest.snapshotId)-\(scope.suffix)"
        let staging = directory.appendingPathComponent(".\(name)-\(UUID().uuidString).tmp", isDirectory: true)
        let final = directory.appendingPathComponent("\(name)-\(UUID().uuidString.prefix(8))", isDirectory: true)
        do {
            guard try directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { throw FormalBackupClientError.invalidManifest }
            let selected = try await selectedFiles(scope, manifest: manifest, client: client)
            try manager.createDirectory(at: staging, withIntermediateDirectories: false)
            try manifestBytes.write(to: staging.appendingPathComponent("manifest.json"), options: .atomic)
            try manifestDigestBytes.write(to: staging.appendingPathComponent("manifest.sha256"), options: .atomic)
            for (index, file) in selected.enumerated() {
                progress = "正在保存 \(index + 1)/\(selected.count) 份资料"
                try await client.download(snapshotId: manifest.snapshotId, file: file,
                                          to: staging.appendingPathComponent(file.path))
            }
            if case .company(let id) = scope {
                let selection = ["scope": "single_company_extract", "snapshotId": manifest.snapshotId,
                                 "membershipId": id, "sourceManifestSha256": SHA256.hash(data: manifestBytes).map { String(format: "%02x", $0) }.joined()]
                let bytes = try JSONSerialization.data(withJSONObject: selection, options: [.prettyPrinted, .sortedKeys])
                try bytes.write(to: staging.appendingPathComponent("selection.json"), options: .atomic)
            }
            guard AppEnvironment.researchAuthorizationContext() == client.auth else { throw FormalBackupClientError.authorizationChanged }
            try manager.moveItem(at: staging, to: final)
            savedDirectory = final
            savedParent = directory
            message = "已保存 \(selected.count + (scope == .all ? 2 : 3)) 份资料到文件；可打开或分享文件夹。云端是否同步仍未知。"
        } catch {
            try? manager.removeItem(at: staging)
            savedDirectory = nil
            savedParent = nil
            message = "保存未完成；没有把不完整文件标成已完成备份。"
        }
    }
    private func selectedFiles(_ scope: FormalBackupScope, manifest: FormalBackupManifest,
                               client: FormalBackupClient) async throws -> [FormalBackupFile] {
        if scope == .all { return manifest.files }
        guard case .company(let id) = scope, manifest.companyIds.contains(id),
              let originals = manifest.file("companies/\(id)/originals.json") else { throw FormalBackupClientError.invalidManifest }
        let contents = try await client.data(snapshotId: manifest.snapshotId, path: originals.path)
        let digest = SHA256.hash(data: contents).map { String(format: "%02x", $0) }.joined()
        guard contents.count == originals.bytes, digest == originals.sha256,
              let references = try JSONSerialization.jsonObject(with: contents) as? [String] else {
            throw FormalBackupClientError.invalidManifest
        }
        var selected = manifest.files.filter { $0.path.hasPrefix("companies/\(id)/") }
        for reference in references {
            guard reference.hasPrefix("../../originals/") else { throw FormalBackupClientError.invalidManifest }
            let path = String(reference.dropFirst(6))
            guard let file = manifest.file(path), path.hasPrefix("originals/") else { throw FormalBackupClientError.invalidManifest }
            if !selected.contains(where: { $0.path == path }) { selected.append(file) }
        }
        return selected.sorted { $0.path < $1.path }
    }
}
