import CoreTransferable
import CoreGraphics
import CoreText
import Foundation
import SwiftUI
import UniformTypeIdentifiers
private let legacyResearchArchiveExportSchemaVersion = "2026-08-14.owner-research-archive.v1"
private let localMemoryResearchArchiveExportSchemaVersion = "2026-08-17.owner-research-archive.v2"
private let deletionAwareResearchArchiveExportSchemaVersion = "2026-08-18.owner-research-archive.v3"
private let conversationRestoreResearchArchiveExportSchemaVersion = "2026-08-18.owner-research-archive.v4"
let researchArchiveExportSchemaVersion = "2026-08-19.owner-research-archive.v5"

enum ResearchArchiveExportError: Error {
    case invalidSource
    case invalidArchive
}

struct ResearchArchiveRestorePreview: Equatable {
    let exportedAt: String
    let archiveSha256: String
    let membershipId: String
    let membershipVersion: Int
    let membershipState: CandidateMembershipState
    let symbol: String
    let componentNames: [String]
    let omittedComponents: [String]

    func matches(_ membership: CandidateMembershipData) -> Bool {
        membershipId == membership.id
            && membershipVersion == membership.version
            && membershipState == membership.state
            && symbol == membership.symbol
    }
}

struct RestoredResearchArchive: Equatable, Identifiable {
    let preview: ResearchArchiveRestorePreview
    let data: Data

    var id: String { preview.archiveSha256 }
}

struct ResearchArchiveBackupRetention: Equatable {
    let daily: Int
    let weekly: Int
    let monthly: Int

    var isValid: Bool {
        (1...90).contains(daily)
            && (1...52).contains(weekly)
            && (1...36).contains(monthly)
    }
}

struct ResearchArchiveBackupResult: Equatable {
    let preview: ResearchArchiveRestorePreview
    let filename: String
    let retainedCount: Int
    let deletedCount: Int
    let originalPDFCount: Int
    let originalHTMLCount: Int
}
enum ResearchArchiveAutomaticBackupKind: String, Equatable {
    case daily, localMemory
    case reportConfirmation
    case formalDecision
    case review
    case deletion

    var label: String {
        switch self {
        case .daily: "每日读取"
        case .localMemory: "本地记忆"
        case .reportConfirmation: "报告确认"
        case .formalDecision: "正式决定"
        case .review: "复盘"
        case .deletion: "内容删除"
        }
    }
}

struct ResearchArchiveAutomaticBackupTrigger: Equatable {
    let kind: ResearchArchiveAutomaticBackupKind
    let identity: String

    static func daily(_ identity: String) -> Self { Self(kind: .daily, identity: identity) }
    static func reportConfirmation(_ identity: String) -> Self { Self(kind: .reportConfirmation, identity: identity) }
    static func formalDecision(_ identity: String) -> Self { Self(kind: .formalDecision, identity: identity) }
    static func review(_ identity: String) -> Self { Self(kind: .review, identity: identity) }
    static func deletion(_ identity: String) -> Self { Self(kind: .deletion, identity: identity) }
}

struct ResearchArchiveLocalRecordDeletion: Codable, Equatable, Sendable {
    let sourceSignature: String
    let deletedAt: String
}

struct ResearchArchiveMaterialDeletions: Codable, Equatable, Sendable {
    let items: [ResearchMaterialDeletionData]
}

struct ResearchArchiveOriginalPDFBackup {
    let document: ResearchDocumentData
    let data: Data
}

struct ResearchArchiveOriginalHTMLBackup {
    let snapshot: ResearchSourceSnapshotData
    let data: Data
}

struct ResearchArchiveCSVDocument: Transferable, Sendable {
    let data: Data
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { document in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(document.filename)
            try document.data.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

struct ResearchArchivePDFDocument: Transferable, Sendable {
    let data: Data
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .pdf) { document in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(document.filename)
            try document.data.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

struct ResearchArchiveBulkExport: Sendable {
    let json: ResearchArchiveExportDocument
    let csv: ResearchArchiveCSVDocument
    let pdf: ResearchArchivePDFDocument
    let symbols: [String]
}

private let researchArchiveBackupBookmarkKey = "researchArchiveBackupDirectoryBookmark.v1"
private let researchArchiveBackupDirectoryNameKey = "researchArchiveBackupDirectoryName.v1"
private let researchArchiveBackupAutomaticEnabledKey = "researchArchiveBackupAutomaticEnabled.v1"
let researchArchiveBackupStateRevisionKey = "researchArchiveBackupStateRevision.v2"

struct ResearchArchiveBackupState: Equatable {
    let lastStatus: String
    let lastCompletedAt: String
}

func researchArchiveBackupState(
    symbol: String,
    bookmark: Data,
    defaults: UserDefaults = .standard
) -> ResearchArchiveBackupState {
    let scope = "\(symbol).\(researchDocumentSha256(bookmark))"
    return ResearchArchiveBackupState(
        lastStatus: defaults.string(forKey: "researchArchiveBackupLastStatus.v2.\(scope)")
            ?? "尚未完成同步目录备份。",
        lastCompletedAt: defaults.string(forKey: "researchArchiveBackupLastCompletedAt.v2.\(scope)") ?? ""
    )
}

func recordResearchArchiveBackupState(
    membership: CandidateMembershipData,
    status: String,
    completedAt: String? = nil,
    defaults: UserDefaults = .standard
) {
    guard let bookmark = defaults.data(forKey: researchArchiveBackupBookmarkKey) else { return }
    let scope = "\(membership.symbol).\(researchDocumentSha256(bookmark))"
    defaults.set(status, forKey: "researchArchiveBackupLastStatus.v2.\(scope)")
    if let completedAt {
        defaults.set(completedAt, forKey: "researchArchiveBackupLastCompletedAt.v2.\(scope)")
    }
    defaults.set(defaults.integer(forKey: researchArchiveBackupStateRevisionKey) + 1,
                 forKey: researchArchiveBackupStateRevisionKey)
}

struct ResearchArchiveBackupSection: View {
    let membership: CandidateMembershipData?
    let archive: ResearchArchiveExportDocument?
    let originalPDFLoader: @MainActor () async throws -> [ResearchArchiveOriginalPDFBackup]
    let originalHTMLLoader: @MainActor () async throws -> [ResearchArchiveOriginalHTMLBackup]
    @AppStorage("researchArchiveBackupDailyRetention.v1") private var dailyRetention = 30
    @AppStorage("researchArchiveBackupWeeklyRetention.v1") private var weeklyRetention = 12
    @AppStorage("researchArchiveBackupMonthlyRetention.v1") private var monthlyRetention = 12
    @AppStorage(researchArchiveBackupBookmarkKey) private var backupBookmark = Data()
    @AppStorage(researchArchiveBackupAutomaticEnabledKey) private var automaticBackupEnabled = false
    @State private var isSelectingDirectory = false
    @State private var isBackingUp = false
    @State private var isPreparingBulkExport = false
    @State private var bulkExportConfirmationPending = false
    @State private var bulkExport: ResearchArchiveBulkExport?
    @State private var directoryName: String?
    @State private var lastStatus = "尚未完成同步目录备份。"
    @State private var lastCompletedAt = ""
    @State private var message = "先选择一个 Files 文件夹；可选 iCloud Drive、OneDrive、Google Drive 或 Dropbox 的同步目录。"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("同步目录备份").font(.callout.weight(.semibold))
            Text("App 只负责把已校验档案原子写入你选择的目录并立即重读；第三方云盘是否完成上传仍为 UNKNOWN。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(directoryName == nil ? "选择备份目录" : "更换备份目录") {
                isSelectingDirectory = true
            }
            .buttonStyle(.bordered)
            .disabled(isBackingUp || isPreparingBulkExport)
            .accessibilityIdentifier("researchArchiveBackupSelectDirectory")
            if let directoryName {
                Text("当前目录：\(directoryName)")
                    .font(.caption.monospacedDigit())
                    .accessibilityIdentifier("researchArchiveBackupDirectoryName")
            }
            Button {
                Task { await backupNow() }
            } label: {
                Label(isBackingUp ? "正在备份" : "立即备份并验证", systemImage: "externaldrive.badge.checkmark")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isBackingUp || isPreparingBulkExport || directoryName == nil || membership == nil || archive == nil)
            .accessibilityIdentifier("researchArchiveBackupNow")
            Toggle("关键动作后自动备份", isOn: $automaticBackupEnabled)
                .disabled(isBackingUp || isPreparingBulkExport || directoryName == nil)
                .accessibilityIdentifier("researchArchiveBackupAutomaticEnabled")
            Text("开启后，每日读取、本地记忆保存、报告确认、正式决定、复盘和内容删除成功会各按精确身份去重备份；关闭时只保留手动备份。切换目录会自动关闭，需重新确认。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            DisclosureGroup("全部股票导出") {
                Text("从当前同步目录逐份重读并校验档案，只选每只股票最新版本；这是已备份历史，不冒充服务器当前事实。原始 PDF 与已存网页原字节保留在各自档案包内。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    prepareBulkExport()
                } label: {
                    Label(
                        isPreparingBulkExport
                            ? "正在准备"
                            : bulkExportConfirmationPending
                                ? "再次点击确认准备全部股票导出"
                                : "准备全部股票导出",
                        systemImage: "square.and.arrow.up.on.square"
                    )
                }
                .buttonStyle(.bordered)
                .disabled(isPreparingBulkExport || isBackingUp || directoryName == nil)
                .accessibilityIdentifier("researchArchiveBulkExportPrepare")
                if let bulkExport {
                    Text("已重读 \(bulkExport.symbols.count) 只股票：\(bulkExport.symbols.joined(separator: "、"))")
                        .font(.caption.monospacedDigit())
                        .fixedSize(horizontal: false, vertical: true)
                    ShareLink(item: bulkExport.json, preview: SharePreview(bulkExport.json.filename)) {
                        Label("导出全部 JSON", systemImage: "curlybraces")
                    }
                    .accessibilityIdentifier("researchArchiveBulkExportJSON")
                    ShareLink(item: bulkExport.csv, preview: SharePreview(bulkExport.csv.filename)) {
                        Label("导出全部 CSV", systemImage: "tablecells")
                    }
                    .accessibilityIdentifier("researchArchiveBulkExportCSV")
                    ShareLink(item: bulkExport.pdf, preview: SharePreview(bulkExport.pdf.filename)) {
                        Label("导出全部 PDF", systemImage: "doc.richtext")
                    }
                    .accessibilityIdentifier("researchArchiveBulkExportPDF")
                }
            }
            DisclosureGroup("版本保留") {
                Stepper("每日 \(dailyRetention) 份", value: $dailyRetention, in: 1...90)
                Stepper("每周 \(weeklyRetention) 份", value: $weeklyRetention, in: 1...52)
                Stepper("每月 \(monthlyRetention) 份", value: $monthlyRetention, in: 1...36)
                Text("仅清理本 App 写入、格式有效且属于同一股票的旧档案；其他文件、其他股票和损坏文件不会被删除。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(message)
                .font(.caption)
                .foregroundStyle(message.contains("完成") ? Color.green : Color.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchArchiveBackupMessage")
            Text("最近状态：\(lastStatus)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchArchiveBackupLastStatus")
        }
        .fileImporter(
            isPresented: $isSelectingDirectory,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false,
            onCompletion: selectDirectory
        )
        .task(id: "\(membership?.symbol ?? "none").\(researchDocumentSha256(backupBookmark))") {
            directoryName = storedResearchArchiveBackupDirectoryName()
            let state = membership.map {
                researchArchiveBackupState(symbol: $0.symbol, bookmark: backupBookmark)
            }
            lastStatus = state?.lastStatus ?? "尚未完成同步目录备份。"
            lastCompletedAt = state?.lastCompletedAt ?? ""
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchArchiveBackupSection")
    }

    private func selectDirectory(_ result: Result<[URL], Error>) {
        do {
            let urls = try result.get()
            guard urls.count == 1, let url = urls.first else {
                throw ResearchArchiveExportError.invalidArchive
            }
            let hasAccess = url.startAccessingSecurityScopedResource()
            defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
            guard try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
                throw ResearchArchiveExportError.invalidArchive
            }
            let bookmark = try url.bookmarkData(
                options: .minimalBookmark,
                includingResourceValuesForKeys: [.isDirectoryKey],
                relativeTo: nil
            )
            UserDefaults.standard.set(bookmark, forKey: researchArchiveBackupBookmarkKey)
            UserDefaults.standard.set(url.lastPathComponent, forKey: researchArchiveBackupDirectoryNameKey)
            automaticBackupEnabled = false
            lastStatus = "已更换目录，尚未完成首次本地备份。"
            lastCompletedAt = ""
            bulkExport = nil
            bulkExportConfirmationPending = false
            directoryName = url.lastPathComponent
            message = "目录已选择；可立即手动备份，或明确开启关键动作后的自动备份。"
        } catch {
            message = "目录选择失败或权限不可用；未写入档案。"
        }
    }

    @MainActor
    private func backupNow() async {
        guard let membership, let archive else { return }
        bulkExport = nil
        bulkExportConfirmationPending = false
        isBackingUp = true
        defer { isBackingUp = false }
        do {
            let originalPDFs = try await originalPDFLoader()
            let originalHTMLs = try await originalHTMLLoader()
            let directory = try storedResearchArchiveBackupDirectory()
            let hasAccess = directory.startAccessingSecurityScopedResource()
            defer { if hasAccess { directory.stopAccessingSecurityScopedResource() } }
            let result = try writeResearchArchiveBackup(
                archive,
                membership: membership,
                directory: directory,
                retention: ResearchArchiveBackupRetention(
                    daily: dailyRetention,
                    weekly: weeklyRetention,
                    monthly: monthlyRetention
                ),
                originalPDFs: originalPDFs,
                originalHTMLs: originalHTMLs
            )
            message = "整套备份写入并重读通过：\(result.filename)；原始 PDF \(result.originalPDFCount) 份、已存网页原件 \(result.originalHTMLCount) 份；当前保留 \(result.retainedCount) 份，清理 \(result.deletedCount) 份。云端同步状态仍为 UNKNOWN。"
            lastStatus = "\(membership.symbol) · 手动备份完成 · \(result.preview.exportedAt) · SHA \(result.preview.archiveSha256.prefix(12))… · 云端 UNKNOWN"
            lastCompletedAt = ISO8601DateFormatter().string(from: Date())
            recordResearchArchiveBackupState(
                membership: membership,
                status: lastStatus,
                completedAt: lastCompletedAt
            )
        } catch {
            message = "备份写入、重读或版本保留失败；未显示旧成功，请重新选择目录后重试。"
            lastStatus = "\(membership.symbol) · 备份失败 · 需要重新选择目录或重试"
            recordResearchArchiveBackupState(membership: membership, status: lastStatus)
        }
    }

    private func prepareBulkExport() {
        guard bulkExportConfirmationPending else {
            bulkExportConfirmationPending = true
            bulkExport = nil
            message = "再次点击确认：只导出同步目录中逐份校验通过的每股最新档案，不读取凭据，也不修改研究或资产事实。"
            return
        }
        bulkExportConfirmationPending = false
        isPreparingBulkExport = true
        Task { @MainActor in
            defer { isPreparingBulkExport = false }
            do {
                let directory = try storedResearchArchiveBackupDirectory()
                let hasAccess = directory.startAccessingSecurityScopedResource()
                defer { if hasAccess { directory.stopAccessingSecurityScopedResource() } }
                let prepared = try await Task.detached(priority: .userInitiated) {
                    try makeResearchArchiveBulkExport(in: directory)
                }.value
                bulkExport = prepared
                message = "全部股票导出已从同步目录重新读取并校验；JSON、CSV、PDF 均绑定同一份 manifest/hash。云端同步仍为 UNKNOWN。"
            } catch {
                bulkExport = nil
                message = "全部股票导出失败：目录不可用、没有有效档案或内容在读取中发生变化；未显示旧成功。"
            }
        }
    }
}

struct ResearchArchiveExportDocument: Transferable, Sendable {
    let data: Data
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .json) { archive in
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(archive.filename, isDirectory: false)
            try archive.data.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

func makeResearchArchiveCSVExport(
    _ archive: ResearchArchiveExportDocument
) throws -> ResearchArchiveCSVDocument {
    let root = try validatedResearchArchiveRoot(archive.data)
    let rows = try researchArchiveCSVRows(root)
    let data = Data(researchArchiveCSV(rows).utf8)
    return ResearchArchiveCSVDocument(
        data: data,
        filename: archive.filename.replacingOccurrences(of: ".json", with: ".csv")
    )
}

/// Proof that a human-readable report export is bound to the exact report frozen in the workspace
/// or archive. The caller must obtain it from `researchReportHumanPDFExportSource` or
/// `researchArchivePDFExportSource`, which validate the selected report and evidence pack against
/// the frozen target before any text is rendered.
struct ResearchArchivePDFExportProof {
    let membershipId: String
    let symbol: String
    let membershipState: CandidateMembershipState
    let membershipVersion: Int
    let report: TwoLayerReportData
    let packFingerprint: String
    let packFrozenAt: String
    let researchMode: String?
    let exportedAt: String
}

struct ResearchArchivePDFExportSource {
    let proof: ResearchArchivePDFExportProof
    let materials: [ResearchMaterialData]
}

/// Identity of the report the Owner selected for a human-readable export. Only these four fields
/// are read from the caller; the exported report text always comes from the workspace's own saved
/// report matched by this identity, never from a caller-supplied payload.
struct ResearchReportExportIdentity: Equatable, Sendable {
    let reportId: String
    let reportVersion: Int
    let reportFingerprint: String
    let evidencePackId: String

    init(report: TwoLayerReportData) {
        reportId = report.id
        reportVersion = report.version
        reportFingerprint = report.reportFingerprint
        evidencePackId = report.evidencePackId
    }
}

func makeResearchArchivePDFExport(
    _ archive: ResearchArchiveExportDocument,
    report: TwoLayerReportData? = nil
) throws -> ResearchArchivePDFDocument {
    guard let report else { throw ResearchArchiveExportError.invalidSource }
    let source = try researchArchivePDFExportSource(archive, report: report)
    return ResearchArchivePDFDocument(
        data: try researchReportPDFData(try researchReportPDFBlocks(source)),
        filename: archive.filename.replacingOccurrences(of: ".json", with: ".pdf")
    )
}

/**
 Human-readable report export straight from the current session.

 It validates the freshly frozen two-layer evidence workspace with the existing
 `validated(expected:)`, matches the exact report id/version/fingerprint/evidence pack and the
 exact pack binding, and renders only the workspace's own saved report. It never roundtrips a
 machine recovery archive, so an unrelated optional lane cannot drop the evidence workspace or
 block this export. Missing, stale or identity-drifted data throws instead of falling back.
 */
func researchReportHumanPDFExportSource(
    membership: CandidateMembershipData,
    workspace: FrozenResearchEvidenceWorkspace,
    identity: ResearchReportExportIdentity,
    exportedAt: Date = Date()
) throws -> ResearchArchivePDFExportSource {
    _ = try workspace.validated(expected: membership)
    guard workspace.isFreshForCurrentResearch else { throw ResearchArchiveExportError.invalidSource }
    let source = try researchReportPDFExportProof(
        membershipId: membership.id,
        membershipVersion: membership.version,
        membershipState: membership.state,
        symbol: membership.symbol,
        exportedAt: ISO8601DateFormatter().string(from: exportedAt),
        workspace: workspace,
        identity: identity
    )
    // Only a current, exact saved report is rendered; historical or superseded reports stay out.
    guard source.proof.report.isCurrentExact else {
        throw ResearchArchiveExportError.invalidSource
    }
    return source
}

func makeResearchReportHumanPDFExport(
    membership: CandidateMembershipData,
    workspace: FrozenResearchEvidenceWorkspace,
    identity: ResearchReportExportIdentity,
    exportedAt: Date = Date()
) throws -> ResearchArchivePDFDocument {
    let source = try researchReportHumanPDFExportSource(
        membership: membership,
        workspace: workspace,
        identity: identity,
        exportedAt: exportedAt
    )
    return ResearchArchivePDFDocument(
        data: try researchReportPDFData(try researchReportPDFBlocks(source)),
        filename: researchReportHumanPDFFilename(symbol: source.proof.symbol, exportedAt: exportedAt)
    )
}

private func researchReportHumanPDFFilename(symbol: String, exportedAt: Date) -> String {
    "\(symbol)-research-report-\(researchArchiveTimestamp(exportedAt)).pdf"
}

/**
 Binds the selected report identity to the exact report and evidence pack frozen in the workspace.

 The returned source always carries the workspace's own saved report and that pack's items, so the
 caller's identity only selects which frozen report is exported and can never substitute report
 text, materials or a pack binding.
 */
private func researchReportPDFExportProof(
    membershipId: String,
    membershipVersion: Int,
    membershipState: CandidateMembershipState,
    symbol: String,
    exportedAt: String,
    workspace: FrozenResearchEvidenceWorkspace,
    identity: ResearchReportExportIdentity
) throws -> ResearchArchivePDFExportSource {
    guard workspace.schemaVersion == frozenResearchEvidenceSchemaVersion,
          workspace.status == "available",
          workspace.membershipId == membershipId,
          workspace.requestedSymbol == symbol,
          let data = workspace.data,
          data.target.membershipId == membershipId,
          data.target.membershipVersion == membershipVersion,
          data.target.membershipState == membershipState.rawValue,
          data.target.symbol == symbol else {
        throw ResearchArchiveExportError.invalidSource
    }
    let reports = data.reports.filter {
        $0.id == identity.reportId
            && $0.version == identity.reportVersion
            && $0.reportFingerprint == identity.reportFingerprint
            && $0.evidencePackId == identity.evidencePackId
    }
    guard reports.count == 1, let report = reports.first else {
        throw ResearchArchiveExportError.invalidSource
    }
    let packs = data.evidencePacks.filter { $0.id == report.evidencePackId }
    guard let binding = report.payload.evidencePackBinding,
          binding.id == report.evidencePackId,
          researchDocumentIsSha256(binding.fingerprint),
          binding.membershipId == membershipId,
          binding.membershipVersion == membershipVersion,
          binding.symbol == symbol,
          packs.count == 1,
          let pack = packs.first,
          pack.packFingerprint == binding.fingerprint,
          pack.membershipId == membershipId,
          pack.membershipVersion == membershipVersion,
          pack.symbol == symbol else {
        throw ResearchArchiveExportError.invalidSource
    }
    return ResearchArchivePDFExportSource(
        proof: ResearchArchivePDFExportProof(
            membershipId: membershipId,
            symbol: symbol,
            membershipState: membershipState,
            membershipVersion: membershipVersion,
            report: report,
            packFingerprint: binding.fingerprint,
            packFrozenAt: binding.frozenAt,
            researchMode: pack.researchMode,
            exportedAt: exportedAt
        ),
        materials: pack.items
    )
}

/**
 Binds the selected report to the exact report/pack identity archived in this document.

 It never falls back to a report that happens to be selected in the current session. An archive
 whose `evidenceWorkspace` component is missing or holds a different report/pack fails clearly
 instead of packaging an unrelated report.
 */
func researchArchivePDFExportSource(
    _ archive: ResearchArchiveExportDocument,
    report: TwoLayerReportData? = nil
) throws -> ResearchArchivePDFExportSource {
    let root = try validatedResearchArchiveRoot(archive.data)
    guard let target = root["target"] as? [String: Any],
          let membershipId = target["membershipId"] as? String,
          let membershipVersion = target["membershipVersion"] as? Int,
          let stateRaw = target["membershipState"] as? String,
          let membershipState = CandidateMembershipState(rawValue: stateRaw),
          let symbol = target["symbol"] as? String,
          let exportedAt = root["exportedAt"] as? String,
          let contents = root["contents"] as? [String: Any],
          membershipVersion > 0 else {
        throw ResearchArchiveExportError.invalidArchive
    }
    guard let report else { throw ResearchArchiveExportError.invalidSource }
    guard let evidenceWorkspace = contents["evidenceWorkspace"] as? [String: Any] else {
        throw ResearchArchiveExportError.invalidSource
    }
    let workspaceData = Data(try portfolioDecisionCanonicalJSON(evidenceWorkspace).utf8)
    guard let workspace = try? JSONDecoder().decode(FrozenResearchEvidenceWorkspace.self, from: workspaceData) else {
        throw ResearchArchiveExportError.invalidSource
    }
    return try researchReportPDFExportProof(
        membershipId: membershipId,
        membershipVersion: membershipVersion,
        membershipState: membershipState,
        symbol: symbol,
        exportedAt: exportedAt,
        workspace: workspace,
        identity: ResearchReportExportIdentity(report: report)
    )
}

/**
 Human-readable report export.

 It only selects report fields (identity, judgment, changes, assumptions/price conditions,
 risk/invalidation, counterevidence/unknowns, one next action, sources). Raw JSON, hashes,
 temporary conversations, credentials, debug text and holdings are deliberately excluded,
 even when the recovery archive contains those components. Missing legacy fields stay
 missing instead of being invented.
 */
private func researchReportPDFBlocks(
    _ source: ResearchArchivePDFExportSource
) throws -> [(text: String, heading: Bool)] {
    let proof = source.proof
    let report = proof.report
    var blocks: [(text: String, heading: Bool)] = []
    func head(_ value: String) { blocks.append((text: value, heading: true)) }
    func line(_ value: String) { blocks.append((text: value, heading: false)) }
    func bullets(_ values: [String], empty: String) {
        let items = researchReportUniqueBullets(values)
        if items.isEmpty {
            line("· \(empty)")
        } else {
            for item in items { line("· \(item)") }
        }
    }

    head("\(proof.symbol) 研究报告")

    let payload = report.payload
    let advice = payload.adviceLayer
    let research = payload.researchLayer
    line("报告版本：v\(report.version) · 状态：\(researchReportStateLabel(report)) · 状态码：\(report.status)")
    line("报告标识：\(report.id) · 证据包：\(report.evidencePackId)")
    line("生成时间：\(report.createdAt) · 数据截止：\(payload.cutoffAt)")
    if let binding = payload.evidencePackBinding {
        line("候选身份：\(binding.symbol) · membership v\(binding.membershipVersion) · 冻结时间：\(binding.frozenAt)")
    }
    line("档案导出时间：\(proof.exportedAt) · 候选状态：\(proof.membershipState.rawValue)")
    line("说明：AI 归纳材料与本地冻结事实；只读研究结论，不会自动确认报告或形成正式决定。")

    head("结论与判断")
    let conclusionText = advice?.conclusion.trimmingCharacters(in: .whitespacesAndNewlines)
    if let advice {
        line("结论：\(advice.conclusion)")
        line("信心：\(researchReportUnknownValue(advice.confidence, unknown: "证据不足，未给出信心评级")) · 适用至：\(advice.applicableUntil)")
        if !advice.horizonStatement.isEmpty { line(advice.horizonStatement) }
        line("方向：\(researchReportDirectionValue(advice.direction))")
        line("长期视图：\(advice.longTerm.view)")
        line("中短期视图：\(advice.mediumShortTerm.view)")
        line("长短期关系：\(advice.conflict.status) · \(advice.conflict.description)")
        if advice.automaticTradingSignal {
            line("警告：报告带有自动交易信号标记；本机不得据此执行任何交易。")
        }
    } else {
        line("历史报告没有分层判断字段，保持缺失。")
    }
    // The research body is only printed when it is not already the displayed conclusion.
    let investmentThesis = payload.investmentThesis.trimmingCharacters(in: .whitespacesAndNewlines)
    if !investmentThesis.isEmpty, investmentThesis != conclusionText {
        head("研究正文")
        line(investmentThesis)
    }

    head("相比上一版的变化")
    bullets(
        [payload.changeFromPrevious, advice?.versionChange ?? ""],
        empty: "报告未声明变化。"
    )

    head("假设与估值/价格条件")
    bullets(advice?.assumptions ?? [], empty: "报告未记录假设。")
    bullets(advice?.scenarios ?? [], empty: "报告未记录情景。")
    bullets(payload.valuationScenarios, empty: "报告未记录估值情景。")
    bullets(advice?.priceConditions ?? [], empty: "报告未记录价格条件。")
    line("价格区间：\(researchReportUnknownValue(advice?.priceRange, unknown: "证据不足，暂不估算")) · 研究仓位范围：\(researchReportUnknownValue(advice?.researchPositionRange, unknown: "证据不足，暂不评估"))")
    if proof.researchMode == "limited" {
        line("限研究模式说明：本次未绑定估值与技术证据，价格区间与研究仓位范围不作评估，技术分析不在本报告范围内。技术值缺失不代表发行人经营风险，真实财务缺口仍按原文保留在风险与待核实条目中。")
    }
    bullets(
        (advice?.longTerm.conditions ?? []) + (advice?.mediumShortTerm.conditions ?? []),
        empty: "报告未记录适用条件。"
    )

    head("主要风险与失效")
    bullets((research?.risks ?? []).map(\.statement), empty: "报告未记录风险条目。")
    bullets(
        (advice?.longTerm.invalidationConditions ?? [])
            + (advice?.mediumShortTerm.invalidationConditions ?? [])
            + payload.invalidationConditions,
        empty: "报告未记录失效条件。"
    )

    head("反证与待核实事项")
    bullets((research?.counterevidence ?? []).map(\.statement), empty: "报告没有独立反证条目，仍需主动核对。")
    bullets((research?.unknowns ?? []).map(\.statement) + payload.unknownItems, empty: "报告未记录待核实条目。")
    if !payload.sourceConflictAssessment.isEmpty {
        line("来源冲突评估：\(payload.sourceConflictAssessment)")
    }
    bullets(payload.sourceConflicts.map(\.description), empty: "报告未记录来源冲突。")

    head("下一步动作")
    let nextActions = researchReportUniqueBullets((research?.nextValidationQuestions ?? []) + payload.nextValidationQuestions)
        .filter { $0 != "UNKNOWN" }
    let singleNextAction = advice?.nextQuestion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    // A missing or exact `UNKNOWN` next question is not a recorded action, so a real question wins.
    let recordedNextAction = !singleNextAction.isEmpty && singleNextAction != "UNKNOWN"
    let principalNextAction = recordedNextAction ? singleNextAction : nextActions.first ?? "未记录"
    line("下一步：\(principalNextAction)")
    let additionalNextActions = nextActions.filter { $0 != principalNextAction }
    if !additionalNextActions.isEmpty {
        bullets(additionalNextActions, empty: "没有更多待核实问题。")
    }

    head("来源（类型 / 文档 / 页码 / 证据 / 链接）")
    // Facts recorded as `source_missing` are gaps, not usable evidence for the source list; they
    // stay visible in the risk / pending-verification sections above.
    let facts = ((research?.fundamentals ?? [])
        + (research?.context ?? [])
        + (research?.valuation ?? [])
        + (research?.technical ?? [])
        + (research?.eventsAndCatalysts ?? [])
        + (research?.risks ?? [])
        + (research?.counterevidence ?? []))
        .filter { !researchReportMissingSourceFact($0) }
    var seenSources = Set<String>()
    for fact in facts {
        let sourceLine = researchReportSourceLine(fact, materials: source.materials)
        if seenSources.insert(sourceLine).inserted { line("· \(sourceLine)") }
    }
    if seenSources.isEmpty {
        line("· 报告未记录可核对来源。")
    }
    line("来源链接只取自本次冻结证据包材料自身记录的公开地址；缺失的链接或定位信息保留为未记录，不补造。")
    return blocks
}

private func researchReportStateLabel(_ report: TwoLayerReportData) -> String {
    switch report.presentationState {
    case .historical: "历史或已失效"
    case .currentIncomplete: "当前但未完成，不能形成正式决定"
    case .formalizable: "当前且可进入正式决定复核"
    }
}

/// Only the exact `UNKNOWN` marker of one recorded field becomes a context-specific phrase; every
/// other value, including long sourced claims, is kept verbatim so no recorded fact is rewritten.
private func researchReportUnknownValue(_ value: String?, unknown: String, missing: String = "未记录") -> String {
    guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return missing }
    return text == "UNKNOWN" ? unknown : text
}

/// The two recorded no-direction markers read as plain Chinese; any real direction stays as recorded.
private func researchReportDirectionValue(_ value: String?) -> String {
    let text = researchReportUnknownValue(value, unknown: "证据不足，暂不判断方向")
    return text == "wait_for_evidence" ? "等待更多证据，暂不判断方向" : text
}

/// Trims, drops blanks and keeps only the first occurrence of each exact duplicate value.
private func researchReportUniqueBullets(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty && seen.insert($0).inserted }
}

/// A fact whose source is recorded as missing is a gap, not a usable evidence source.
private func researchReportMissingSourceFact(_ fact: TwoLayerReportFact) -> Bool {
    fact.sourceKind == "source_missing" || fact.citation?.kind == "source_missing"
}

private func researchReportSourceLine(
    _ fact: TwoLayerReportFact,
    materials: [ResearchMaterialData]
) -> String {
    let kind = fact.sourceKind ?? fact.citation?.kind ?? "UNKNOWN"
    let document = fact.citation?.documentId ?? "未记录文档"
    let page = fact.citation?.pageNumber.map { "第\($0)页" } ?? "未记录页码"
    let evidence = fact.evidenceIds.isEmpty ? "无证据编号" : fact.evidenceIds.joined(separator: ",")
    let sourceId = fact.sourceId.map { " · 来源编号 \($0)" } ?? ""
    // Only a title/link present in the archive's own frozen pack items is shown; nothing is invented.
    let material = fact.sourceId.flatMap { sourceId in
        materials.first { $0.id == sourceId || $0.evidenceId == sourceId }
            ?? researchReportNamespacedMaterialId(sourceId).flatMap { packId in
                materials.first { $0.id == packId }
            }
    }
    let title = material.map { " · 材料标题 \($0.title)" } ?? ""
    let link = material.flatMap(researchReportSourceLink) ?? "链接未记录"
    if let peer = fact.citation?.reopenablePeerOriginalCitation {
        let source = peer.sourceMembership.map {
            "\($0.symbol) 成员 \($0.membershipId) v\($0.membershipVersion)"
        } ?? "主研究公司成员"
        let base = "\(fact.statement) — 类型 \(kind) · 来源 \(source) · 材料 \(peer.materialId) r\(peer.materialRevision) · 内容指纹 \(peer.contentFingerprint) · 来源版本 \(peer.sourceVersion) · 证据 \(evidence)\(sourceId)"
        if let snapshot = peer.snapshotCitation, let rawSha = peer.snapshotRawSha256 {
            return "\(base) · 已存网页快照 \(snapshot.snapshotId) · 正文 SHA256 \(snapshot.textSha256) · 选段 \(snapshot.startUtf16)–\(snapshot.endUtf16) · 选段 SHA256 \(snapshot.excerptSha256) · 原件 SHA256 \(rawSha) · \(peer.sourceUrl ?? "原始公开地址未记录")（在线页面可能已变化）"
        }
        if let original = peer.providerOriginal {
            return "\(base) · OpenD 第三方未核实 · 捕获 \(original.captureId) · 页 \(original.pageId) · 原始页 SHA256 \(original.rawSha256) · 报表 SHA256 \(original.reportSha256) · 本地提供商原件，无公开链接"
        }
    }
    if let snapshot = fact.citation?.reopenableSnapshotCitation {
        let citation = snapshot.0
        return "\(fact.statement) — 类型 \(kind) · 已存网页快照 \(citation.snapshotId) · 正文 SHA256 \(citation.textSha256) · 选段 \(citation.startUtf16)–\(citation.endUtf16) · 选段 SHA256 \(citation.excerptSha256) · 原件 SHA256 \(snapshot.1.rawSha256) · 证据 \(evidence)\(sourceId)\(title) · \(link)"
    }
    if let citation = material?.snapshotCitation, let original = material?.snapshotOriginal {
        return "\(fact.statement) — 类型 \(kind) · 已存网页快照 \(citation.snapshotId) · 正文 SHA256 \(citation.textSha256) · 选段 \(citation.startUtf16)–\(citation.endUtf16) · 选段 SHA256 \(citation.excerptSha256) · 原件 SHA256 \(original.rawSha256) · 证据 \(evidence)\(sourceId)\(title) · \(link)"
    }
    return "\(fact.statement) — 类型 \(kind) · 文档 \(document) · \(page) · 证据 \(evidence)\(sourceId)\(title) · \(link)"
}

/// Frozen pack items are addressed by their bare `id`; report facts may name the same item as
/// `material:<positiveId>`. Only that exact namespace is unwrapped — other namespaces match nothing.
private func researchReportNamespacedMaterialId(_ sourceId: String) -> String? {
    guard sourceId.hasPrefix("material:") else { return nil }
    let packId = String(sourceId.dropFirst("material:".count))
    guard let first = packId.first, first != "0",
          packId.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
    return packId
}

private func researchReportSourceLink(_ material: ResearchMaterialData) -> String? {
    guard let sourceUrl = material.sourceUrl,
          let url = URL(string: sourceUrl),
          url.scheme == "https",
          url.host != nil,
          url.user == nil,
          url.password == nil else { return nil }
    return url.absoluteString
}

/// Legible CJK report renderer: system font 11pt body, 13pt headings, generous margins
/// and automatic pagination. The machine archive PDF path is unchanged.
func researchReportPDFData(_ blocks: [(text: String, heading: Bool)]) throws -> Data {
    let text = NSMutableAttributedString()
    for block in blocks {
        let font: CTFont
        if block.heading {
            font = CTFontCreateUIFontForLanguage(.emphasizedSystem, 13, nil)
                ?? CTFontCreateWithName("Helvetica-Bold" as CFString, 13, nil)
        } else {
            font = CTFontCreateUIFontForLanguage(.system, 11, nil)
                ?? CTFontCreateWithName("Helvetica" as CFString, 11, nil)
        }
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
        ]
        text.append(NSAttributedString(string: block.text + "\n", attributes: attributes))
    }
    return try researchArchivePDFPages(text, margins: CGSize(width: 40, height: 44))
}

func makeResearchArchiveBulkExport(
    in directory: URL,
    exportedAt: Date = Date(),
    fileManager: FileManager = .default
) throws -> ResearchArchiveBulkExport {
    guard try directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let candidates = try fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey],
        options: [.skipsHiddenFiles]
    )
    .filter {
        $0.lastPathComponent.contains("-research-archive-")
            && ["json", "researcharchive"].contains($0.pathExtension)
    }
    var verified: [(preview: ResearchArchiveRestorePreview, data: Data, url: URL)] = []
    for url in candidates {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey])
        guard values.isSymbolicLink != true,
              url.pathExtension == "json" ? values.isRegularFile == true : values.isDirectory == true else {
            throw ResearchArchiveExportError.invalidArchive
        }
        let first = try readResearchArchiveBackup(at: url)
        let second = try readResearchArchiveBackup(at: url)
        guard first == second else { throw ResearchArchiveExportError.invalidArchive }
        verified.append((try inspectResearchArchiveForRestore(first), first, url))
    }
    let latest = verified.reduce(
        into: [String: (preview: ResearchArchiveRestorePreview, data: Data, url: URL)]()
    ) { result, item in
        guard let previous = result[item.preview.symbol] else {
            result[item.preview.symbol] = item
            return
        }
        if item.preview.exportedAt > previous.preview.exportedAt
            || item.preview.exportedAt == previous.preview.exportedAt
                && item.preview.archiveSha256 > previous.preview.archiveSha256 {
            result[item.preview.symbol] = item
        }
    }.values.sorted { $0.preview.symbol < $1.preview.symbol }
    guard !latest.isEmpty else { throw ResearchArchiveExportError.invalidArchive }

    let roots = try latest.map { try validatedResearchArchiveRoot($0.data) }
    let htmlSources = try latest.map { try researchArchiveBulkHTMLSources(bundleURL: $0.url, preview: $0.preview) }
    let manifest = latest.map { item in
        [
            "symbol": item.preview.symbol,
            "membershipId": item.preview.membershipId,
            "membershipVersion": item.preview.membershipVersion,
            "membershipState": item.preview.membershipState.rawValue,
            "exportedAt": item.preview.exportedAt,
            "archiveSha256": item.preview.archiveSha256,
            "originalPDFDirectory": "OriginalPDFs/\(item.preview.symbol)",
            "originalHTMLCount": htmlSources.first(where: { $0.symbol == item.preview.symbol })?.files.count ?? 0,
            "originalHTMLDirectory": htmlSources.first(where: { $0.symbol == item.preview.symbol })?.files.isEmpty == false
                ? "OriginalHTMLs/\(item.preview.symbol)" : "none"
        ] as [String: Any]
    }
    let payload: [String: Any] = [
        "schemaVersion": htmlSources.contains(where: { !$0.files.isEmpty })
            ? "2026-10-10.owner-research-archive-bulk.v2"
            : "2026-08-17.owner-research-archive-bulk.v1",
        "exportedAt": ISO8601DateFormatter().string(from: exportedAt),
        "selection": "latest_verified_backup_per_symbol",
        "manifest": manifest,
        "archives": roots,
        "policy": [
            "advisoryOnly": true,
            "credentialsIncluded": false,
            "officialPortfolioFactsIncluded": false,
            "originalPdfBytesIncluded": false,
            "originalPdfLocation": "selected_sync_directory/OriginalPDFs",
            "originalHtmlBytesIncluded": false,
            "originalHtmlLocation": "selected_sync_directory/*.researcharchive/OriginalHTMLs",
            "cloudSyncStatus": "UNKNOWN"
        ]
    ]
    var bundle = payload
    bundle["bundleSha256"] = try portfolioDecisionContentId(
        object: payload,
        prefix: "",
        excludingTopLevelKeys: []
    )
    let jsonData = Data(try portfolioDecisionCanonicalJSON(bundle).utf8)
    guard let verified = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
          let expectedHash = verified["bundleSha256"] as? String else {
        throw ResearchArchiveExportError.invalidArchive
    }
    var verifiedPayload = verified
    verifiedPayload.removeValue(forKey: "bundleSha256")
    guard try portfolioDecisionContentId(
        object: verifiedPayload,
        prefix: "",
        excludingTopLevelKeys: []
    ) == expectedHash else { throw ResearchArchiveExportError.invalidArchive }

    let timestamp = researchArchiveTimestamp(exportedAt)
    let csvRows = try roots.flatMap(researchArchiveCSVRows)
        + htmlSources.flatMap { item in item.files.map { file in
            [item.symbol, item.membershipId, String(item.membershipVersion), item.membershipState,
             item.exportedAt, item.archiveSha256, "originalHTMLSnapshot", "present",
             file.rawSha256, String(file.byteLength), file.metadataJSON]
        } }
    let csvData = Data(researchArchiveCSV(csvRows).utf8)
    let pdfText = "全部股票研究档案\nBundle SHA-256: \(expectedHash)\n\n"
        + String(decoding: jsonData, as: UTF8.self)
    return ResearchArchiveBulkExport(
        json: ResearchArchiveExportDocument(
            data: jsonData,
            filename: "all-research-archives-\(timestamp).json"
        ),
        csv: ResearchArchiveCSVDocument(
            data: csvData,
            filename: "all-research-archives-\(timestamp).csv"
        ),
        pdf: ResearchArchivePDFDocument(
            data: try researchArchivePDFData(pdfText),
            filename: "all-research-archives-\(timestamp).pdf"
        ),
        symbols: latest.map(\.preview.symbol)
    )
}

private struct ResearchArchiveBulkHTMLSource {
    struct File {
        let rawSha256: String
        let byteLength: Int
        let metadataJSON: String
    }
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let membershipState: String
    let exportedAt: String
    let archiveSha256: String
    let files: [File]
}

private func researchArchiveBulkHTMLSources(
    bundleURL: URL, preview: ResearchArchiveRestorePreview
) throws -> ResearchArchiveBulkHTMLSource {
    var files: [ResearchArchiveBulkHTMLSource.File] = []
    if bundleURL.pathExtension == "researcharchive" {
        let manifestURL = bundleURL.appendingPathComponent("OriginalHTMLs", isDirectory: true)
            .appendingPathComponent(preview.symbol, isDirectory: true)
            .appendingPathComponent("Manifests", isDirectory: true)
            .appendingPathComponent("\(preview.archiveSha256).json", isDirectory: false)
        if FileManager.default.fileExists(atPath: manifestURL.path) {
            let data = try Data(contentsOf: manifestURL, options: .mappedIfSafe)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let entries = object["files"] as? [[String: Any]] else {
                throw ResearchArchiveExportError.invalidArchive
            }
            files = try entries.map { entry in
                guard let snapshot = entry["snapshot"] as? [String: Any],
                      let rawSha = snapshot["rawSha256"] as? String,
                      let byteLength = snapshot["byteLength"] as? Int else {
                    throw ResearchArchiveExportError.invalidArchive
                }
                return ResearchArchiveBulkHTMLSource.File(rawSha256: rawSha,
                    byteLength: byteLength, metadataJSON: try portfolioDecisionCanonicalJSON(snapshot))
            }
        }
    }
    return ResearchArchiveBulkHTMLSource(symbol: preview.symbol, membershipId: preview.membershipId,
        membershipVersion: preview.membershipVersion, membershipState: preview.membershipState.rawValue,
        exportedAt: preview.exportedAt, archiveSha256: preview.archiveSha256, files: files)
}

private func researchArchiveCSVRows(_ root: [String: Any]) throws -> [[String]] {
    guard let exportedAt = root["exportedAt"] as? String,
          let archiveSha256 = root["archiveSha256"] as? String,
          let target = root["target"] as? [String: Any],
          let membershipId = target["membershipId"] as? String,
          let membershipVersion = target["membershipVersion"] as? Int,
          let membershipState = target["membershipState"] as? String,
          let symbol = target["symbol"] as? String,
          let manifest = root["manifest"] as? [[String: Any]],
          let omitted = root["omittedComponents"] as? [String],
          let contents = root["contents"] as? [String: Any] else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let present = try manifest.map { item -> [String] in
        guard let name = item["name"] as? String,
              let hash = item["sha256"] as? String,
              let content = contents[name] else { throw ResearchArchiveExportError.invalidArchive }
        let contentData = Data(try portfolioDecisionCanonicalJSON(content).utf8)
        return [
            symbol, membershipId, String(membershipVersion), membershipState, exportedAt,
            archiveSha256, name, "present", hash, String(contentData.count),
            String(decoding: contentData, as: UTF8.self)
        ]
    }
    let absent = omitted.map {
        [symbol, membershipId, String(membershipVersion), membershipState, exportedAt,
         archiveSha256, $0, "omitted", "", "", ""]
    }
    return present + absent
}

private func researchArchiveCSV(_ rows: [[String]]) -> String {
    let header = [
        "symbol", "membership_id", "membership_version", "membership_state", "exported_at",
        "archive_sha256", "component", "status", "component_sha256", "byte_count", "content_json"
    ]
    return ([header] + rows).map { row in
        row.map { "\"\($0.replacingOccurrences(of: "\"", with: "\"\""))\"" }.joined(separator: ",")
    }.joined(separator: "\r\n") + "\r\n"
}

private func researchArchivePDFData(_ text: String) throws -> Data {
    let attributed = NSAttributedString(
        string: text,
        attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Menlo" as CFString, 8, nil),
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
        ]
    )
    return try researchArchivePDFPages(attributed, margins: CGSize(width: 36, height: 36))
}

/// Shared A4 pagination for both the readable report body and the legacy Menlo archive dump.
private func researchArchivePDFPages(
    _ text: NSAttributedString,
    margins: CGSize
) throws -> Data {
    let data = NSMutableData()
    var page = CGRect(x: 0, y: 0, width: 595, height: 842)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
          let context = CGContext(consumer: consumer, mediaBox: &page, nil) else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let framesetter = CTFramesetterCreateWithAttributedString(text)
    let framePath = CGPath(rect: page.insetBy(dx: margins.width, dy: margins.height), transform: nil)
    var location = 0
    repeat {
        context.beginPDFPage(nil)
        context.textMatrix = .identity
        let frame = CTFramesetterCreateFrame(
            framesetter,
            CFRange(location: location, length: 0),
            framePath,
            nil
        )
        CTFrameDraw(frame, context)
        let visible = CTFrameGetVisibleStringRange(frame)
        guard visible.length > 0 else { throw ResearchArchiveExportError.invalidArchive }
        location += visible.length
        context.endPDFPage()
    } while location < text.length
    context.closePDF()
    let result = data as Data
    guard result.starts(with: Data("%PDF-".utf8)) else {
        throw ResearchArchiveExportError.invalidArchive
    }
    return result
}

private struct ResearchArchiveLocalKnowledge: Encodable {
    let entries: [AssistReviewKnowledgeEnvelope]
}

struct ResearchArchiveTemporaryConversation: Codable {
    var sessionId: String? = nil
    var carrySummary: String? = nil
    var carryFromSessionId: String? = nil
    let membershipId: String
    let membershipVersion: Int
    let membershipState: String
    let symbol: String
    let reportId: String
    let reportVersion: Int
    let reportFingerprint: String
    let evidencePackId: String
    let evidencePackFingerprint: String
    let responses: [ResearchEvidenceQuestionEnvelope]
    let questionDraft: String
    let correctionDraft: String
    let savedAt: String
    let expiresAt: String

    init(
        membership: CandidateMembershipData,
        report: TwoLayerReportData,
        snapshot: ResearchTemporaryConversationSnapshot
    ) {
        sessionId = snapshot.sessionId == "legacy" ? nil : snapshot.sessionId
        carrySummary = snapshot.carrySummary
        carryFromSessionId = snapshot.carryFromSessionId
        membershipId = membership.id
        membershipVersion = membership.version
        membershipState = membership.state.rawValue
        symbol = membership.symbol
        reportId = report.id
        reportVersion = report.version
        reportFingerprint = report.reportFingerprint
        evidencePackId = report.evidencePackId
        evidencePackFingerprint = report.payload.evidencePackBinding?.fingerprint ?? ""
        responses = snapshot.responses
        questionDraft = snapshot.questionDraft
        correctionDraft = snapshot.correctionDraft
        savedAt = snapshot.savedAt
        expiresAt = snapshot.expiresAt
    }
}

/// Honest caller-side availability for one already-loaded optional archive lane. A lane that is still
/// loading, unavailable or drifted for the selected target is omitted (`nil`) instead of failing the
/// shared strict archive and silently reducing an export that still holds valid research to fewer
/// components. It adds no data and uses the same strict validators, so validation is not weakened.
func researchArchiveAvailableLane<Lane>(
    _ lane: Lane?,
    validated: (Lane) throws -> Void
) -> Lane? {
    guard let lane, (try? validated(lane)) != nil else { return nil }
    return lane
}

func makeResearchArchiveExport(
    membership: CandidateMembershipData,
    profile: ResearchProfileEnvelope?,
    fundamentals: ResearchFundamentalsEnvelope?,
    context: ResearchContextEnvelope?,
    completeness: ResearchCompletenessEnvelope?,
    valuationScenarios: ResearchValuationScenariosEnvelope?,
    evidenceWorkspace: FrozenResearchEvidenceWorkspace?,
    decisionReviewHistory: DecisionReviewHistoryEnvelope?,
    localReviewKnowledge: [AssistReviewKnowledgeEnvelope],
    localRecord: AssistMobileWorkspaceLocalRecordEnvelope? = nil,
    localRecordDeletion: ResearchArchiveLocalRecordDeletion? = nil,
    materialDeletions: ResearchArchiveMaterialDeletions? = nil,
    temporaryConversation: ResearchArchiveTemporaryConversation? = nil,
    exportedAt: Date = Date()
) throws -> ResearchArchiveExportDocument {
    try validateResearchArchiveSources(
        membership: membership,
        profile: profile,
        fundamentals: fundamentals,
        context: context,
        completeness: completeness,
        valuationScenarios: valuationScenarios,
        evidenceWorkspace: evidenceWorkspace,
        decisionReviewHistory: decisionReviewHistory,
        localReviewKnowledge: localReviewKnowledge,
        localRecord: localRecord,
        localRecordDeletion: localRecordDeletion,
        materialDeletions: materialDeletions,
        temporaryConversation: temporaryConversation
    )

    let sources: [(String, (any Encodable)?)] = [
        ("researchProfile", profile),
        ("fundamentals", fundamentals),
        ("researchContext", context),
        ("researchCompleteness", completeness),
        ("valuationScenarios", valuationScenarios),
        ("evidenceWorkspace", evidenceWorkspace),
        ("decisionReviewHistory", decisionReviewHistory),
        ("localReviewKnowledge", localReviewKnowledge.isEmpty ? nil : ResearchArchiveLocalKnowledge(entries: localReviewKnowledge)),
        ("localRecord", localRecord),
        ("localRecordDeletion", localRecordDeletion),
        ("materialDeletions", materialDeletions),
        ("temporaryConversation", temporaryConversation)
    ]
    var contents: [String: Any] = [:]
    var manifest: [[String: Any]] = []
    var omitted: [String] = []
    for (name, source) in sources {
        guard let source else {
            omitted.append(name)
            continue
        }
        let data = try encodeResearchArchiveComponent(source)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ResearchArchiveExportError.invalidSource
        }
        contents[name] = object
        manifest.append([
            "name": name,
            "sha256": try portfolioDecisionContentId(
                object: object,
                prefix: "",
                excludingTopLevelKeys: []
            ),
            "byteCount": try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]).count
        ])
    }
    guard !contents.isEmpty else { throw ResearchArchiveExportError.invalidSource }

    let payload: [String: Any] = [
        "schemaVersion": researchArchiveExportSchemaVersion,
        "exportedAt": ISO8601DateFormatter().string(from: exportedAt),
        "target": [
            "membershipId": membership.id,
            "membershipVersion": membership.version,
            "membershipState": membership.state.rawValue,
            "symbol": membership.symbol
        ],
        "manifest": manifest,
        "omittedComponents": omitted,
        "contents": contents,
        "policy": [
            "advisoryOnly": true,
            "credentialsIncluded": false,
            "officialPortfolioFactsIncluded": false,
            "originalPdfBytesIncluded": false,
            "cloudSyncStatus": "UNKNOWN"
        ]
    ]
    var root = payload
    root["archiveSha256"] = try portfolioDecisionContentId(
        object: payload,
        prefix: "",
        excludingTopLevelKeys: []
    )
    // Canonical bytes, so the persisted numeric text matches the archiveSha256 hash input exactly.
    let data = Data(try portfolioDecisionCanonicalJSON(root).utf8)
    try validateResearchArchiveExport(data)
    return ResearchArchiveExportDocument(
        data: data,
        filename: researchArchiveFilename(symbol: membership.symbol, exportedAt: exportedAt)
    )
}

func validateResearchArchiveExport(_ data: Data) throws {
    _ = try validatedResearchArchiveRoot(data)
}

func inspectResearchArchiveForRestore(_ data: Data) throws -> ResearchArchiveRestorePreview {
    let root = try validatedResearchArchiveRoot(data)
    guard let exportedAt = root["exportedAt"] as? String,
          let archiveSha256 = root["archiveSha256"] as? String,
          let target = root["target"] as? [String: Any],
          Set(target.keys) == Set(["membershipId", "membershipVersion", "membershipState", "symbol"]),
          let membershipId = target["membershipId"] as? String,
          let membershipVersion = target["membershipVersion"] as? Int,
          let stateRaw = target["membershipState"] as? String,
          let membershipState = CandidateMembershipState(rawValue: stateRaw),
          let symbol = target["symbol"] as? String,
          let manifest = root["manifest"] as? [[String: Any]],
          let omitted = root["omittedComponents"] as? [String],
          let policy = root["policy"] as? [String: Any],
          Set(policy.keys) == Set(["advisoryOnly", "credentialsIncluded", "officialPortfolioFactsIncluded", "originalPdfBytesIncluded", "cloudSyncStatus"]),
          policy["advisoryOnly"] as? Bool == true,
          policy["credentialsIncluded"] as? Bool == false,
          policy["officialPortfolioFactsIncluded"] as? Bool == false,
          policy["originalPdfBytesIncluded"] as? Bool == false,
          policy["cloudSyncStatus"] as? String == "UNKNOWN" else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let names = manifest.compactMap { $0["name"] as? String }
    let legacyAllowed = Set(["researchProfile", "fundamentals", "researchContext", "researchCompleteness", "valuationScenarios", "evidenceWorkspace", "decisionReviewHistory", "localReviewKnowledge"])
    let localMemoryAllowed = legacyAllowed.union(["localRecord", "temporaryConversation"])
    let allowed = switch root["schemaVersion"] as? String {
    case legacyResearchArchiveExportSchemaVersion: legacyAllowed
    case localMemoryResearchArchiveExportSchemaVersion: localMemoryAllowed
    case deletionAwareResearchArchiveExportSchemaVersion: localMemoryAllowed.union(["localRecordDeletion"])
    default: localMemoryAllowed.union(["localRecordDeletion", "materialDeletions"])
    }
    guard names.count == manifest.count,
          Set(names).count == names.count,
          Set(omitted).count == omitted.count,
          Set(names).isDisjoint(with: omitted),
          Set(names).union(omitted) == allowed else {
        throw ResearchArchiveExportError.invalidArchive
    }
    return ResearchArchiveRestorePreview(
        exportedAt: exportedAt,
        archiveSha256: archiveSha256,
        membershipId: membershipId,
        membershipVersion: membershipVersion,
        membershipState: membershipState,
        symbol: symbol,
        componentNames: names,
        omittedComponents: omitted
    )
}

func restoreResearchArchive(
    _ data: Data,
    membership: CandidateMembershipData,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
) throws -> RestoredResearchArchive {
    let preview = try inspectResearchArchiveForRestore(data)
    guard preview.matches(membership) else { throw ResearchArchiveExportError.invalidArchive }
    let directory = try researchArchiveRestoreDirectory(
        membership: membership,
        rootDirectory: rootDirectory,
        fileManager: fileManager
    )
    let url = directory.appendingPathComponent("\(preview.archiveSha256).json", isDirectory: false)
    #if os(iOS)
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    #else
    try data.write(to: url, options: .atomic)
    #endif
    let readBack = try Data(contentsOf: url, options: .mappedIfSafe)
    let readBackPreview = try inspectResearchArchiveForRestore(readBack)
    guard readBackPreview == preview else { throw ResearchArchiveExportError.invalidArchive }
    return RestoredResearchArchive(preview: readBackPreview, data: readBack)
}

func loadRestoredResearchArchive(
    membership: CandidateMembershipData,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
) throws -> RestoredResearchArchive? {
    let directory = try researchArchiveRestoreDirectory(
        membership: membership,
        rootDirectory: rootDirectory,
        fileManager: fileManager
    )
    return try fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
    )
    .filter { $0.pathExtension == "json" }
    .compactMap { url in
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe),
              let preview = try? inspectResearchArchiveForRestore(data),
              preview.matches(membership) else { return nil }
        return RestoredResearchArchive(preview: preview, data: data)
    }
    .max { $0.preview.exportedAt < $1.preview.exportedAt }
}

func deleteRestoredResearchArchive(
    _ archive: RestoredResearchArchive,
    membership: CandidateMembershipData,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
) throws -> RestoredResearchArchive? {
    let preview = try inspectResearchArchiveForRestore(archive.data)
    guard preview == archive.preview, preview.matches(membership) else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let directory = try researchArchiveRestoreDirectory(
        membership: membership,
        rootDirectory: rootDirectory,
        fileManager: fileManager
    )
    let url = directory.appendingPathComponent("\(preview.archiveSha256).json", isDirectory: false)
    let stored = try Data(contentsOf: url, options: .mappedIfSafe)
    guard try inspectResearchArchiveForRestore(stored) == preview else {
        throw ResearchArchiveExportError.invalidArchive
    }
    try fileManager.removeItem(at: url)
    guard !fileManager.fileExists(atPath: url.path) else {
        throw ResearchArchiveExportError.invalidArchive
    }
    return try loadRestoredResearchArchive(
        membership: membership,
        rootDirectory: rootDirectory,
        fileManager: fileManager
    )
}

func writeResearchArchiveBackup(
    _ archive: ResearchArchiveExportDocument,
    membership: CandidateMembershipData,
    directory: URL,
    retention: ResearchArchiveBackupRetention,
    originalPDFs: [ResearchArchiveOriginalPDFBackup] = [],
    originalHTMLs: [ResearchArchiveOriginalHTMLBackup] = [],
    fileManager: FileManager = .default
) throws -> ResearchArchiveBackupResult {
    guard retention.isValid,
          try directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let preview = try inspectResearchArchiveForRestore(archive.data)
    guard preview.matches(membership) else { throw ResearchArchiveExportError.invalidArchive }
    guard let backupContents = try validatedResearchArchiveRoot(archive.data)["contents"] as? [String: Any], backupContents["temporaryConversation"] == nil else { throw ResearchArchiveExportError.invalidArchive }
    let bundleName = URL(fileURLWithPath: archive.filename)
        .deletingPathExtension().lastPathComponent + ".researcharchive"
    let finalURL = directory.appendingPathComponent(bundleName, isDirectory: true)
    let stagingURL = directory.appendingPathComponent(
        ".\(bundleName).staging-\(UUID().uuidString)",
        isDirectory: true
    )
    try fileManager.createDirectory(at: stagingURL, withIntermediateDirectories: false)
    defer {
        if fileManager.fileExists(atPath: stagingURL.path) {
            try? fileManager.removeItem(at: stagingURL)
        }
    }
    let originalPDFCount = try writeResearchArchiveOriginalPDFBackups(
        originalPDFs,
        membership: membership,
        archive: preview,
        directory: stagingURL,
        fileManager: fileManager
    )
    let originalHTMLCount = try writeResearchArchiveOriginalHTMLBackups(
        originalHTMLs, membership: membership, archive: preview,
        directory: stagingURL, fileManager: fileManager
    )
    let archiveURL = stagingURL.appendingPathComponent("archive.json", isDirectory: false)
    try archive.data.write(to: archiveURL, options: .atomic)
    let pdfManifestURL = researchArchiveOriginalPDFManifestURL(
        directory: stagingURL,
        membership: membership,
        archiveSha256: preview.archiveSha256
    )
    let pdfManifest = try Data(contentsOf: pdfManifestURL, options: .mappedIfSafe)
    let htmlManifestURL = researchArchiveOriginalHTMLManifestURL(
        directory: stagingURL, membership: membership, archiveSha256: preview.archiveSha256
    )
    let htmlManifest = originalHTMLs.isEmpty ? nil : try Data(contentsOf: htmlManifestURL, options: .mappedIfSafe)
    let bundleManifest = try researchArchiveBundleManifest(
        archive: archive,
        preview: preview,
        originalPDFCount: originalPDFCount,
        originalPDFManifest: pdfManifest,
        originalHTMLCount: originalHTMLCount,
        originalHTMLManifest: htmlManifest
    )
    let bundleManifestURL = stagingURL.appendingPathComponent("manifest.json", isDirectory: false)
    try bundleManifest.write(to: bundleManifestURL, options: .atomic)
    let readBack = try Data(contentsOf: archiveURL, options: .mappedIfSafe)
    guard readBack == archive.data,
          try inspectResearchArchiveForRestore(readBack) == preview,
          try Data(contentsOf: bundleManifestURL, options: .mappedIfSafe) == bundleManifest else {
        throw ResearchArchiveExportError.invalidArchive
    }
    if fileManager.fileExists(atPath: finalURL.path) {
        let existing = try Data(contentsOf: finalURL.appendingPathComponent("archive.json"), options: .mappedIfSafe)
        guard existing == archive.data,
              try inspectResearchArchiveForRestore(existing) == preview else {
            throw ResearchArchiveExportError.invalidArchive
        }
    } else {
        try fileManager.moveItem(at: stagingURL, to: finalURL)
    }
    let finalHTMLManifest = originalHTMLs.isEmpty ? nil : try Data(contentsOf: researchArchiveOriginalHTMLManifestURL(
        directory: finalURL, membership: membership, archiveSha256: preview.archiveSha256), options: .mappedIfSafe)
    guard try Data(contentsOf: finalURL.appendingPathComponent("archive.json"), options: .mappedIfSafe) == archive.data,
          try Data(contentsOf: finalURL.appendingPathComponent("manifest.json"), options: .mappedIfSafe) == bundleManifest,
          try Data(contentsOf: researchArchiveOriginalPDFManifestURL(
            directory: finalURL,
            membership: membership,
            archiveSha256: preview.archiveSha256
          ), options: .mappedIfSafe) == pdfManifest,
          researchArchiveOriginalPDFBackupsMatch(
            originalPDFs,
            membership: membership,
            directory: finalURL
          ),
          researchArchiveOriginalHTMLBackupsMatch(originalHTMLs, membership: membership, directory: finalURL),
          finalHTMLManifest == htmlManifest else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let pruning = try pruneResearchArchiveBackups(
        in: directory,
        symbol: membership.symbol,
        retention: retention,
        protectedURL: finalURL,
        fileManager: fileManager
    )
    return ResearchArchiveBackupResult(
        preview: preview,
        filename: bundleName,
        retainedCount: pruning.retained,
        deletedCount: pruning.deleted,
        originalPDFCount: originalPDFCount,
        originalHTMLCount: originalHTMLCount
    )
}

private func researchArchiveBundleManifest(
    archive: ResearchArchiveExportDocument,
    preview: ResearchArchiveRestorePreview,
    originalPDFCount: Int,
    originalPDFManifest: Data,
    originalHTMLCount: Int,
    originalHTMLManifest: Data?
) throws -> Data {
    var payload: [String: Any] = [
        "schemaVersion": originalHTMLManifest == nil ? "2026-08-19.research-archive-bundle.v1" : "2026-10-10.research-archive-bundle.v2",
        "exportedAt": preview.exportedAt,
        "archiveFilename": archive.filename,
        "archiveSha256": preview.archiveSha256,
        "archiveByteCount": archive.data.count,
        "originalPDFCount": originalPDFCount,
        "originalPDFManifestSha256": researchDocumentSha256(originalPDFManifest),
        "cloudSyncStatus": "UNKNOWN"
    ]
    if let originalHTMLManifest {
        payload["originalHTMLCount"] = originalHTMLCount
        payload["originalHTMLManifestSha256"] = researchDocumentSha256(originalHTMLManifest)
    }
    var manifest = payload
    manifest["manifestSha256"] = try portfolioDecisionContentId(
        object: payload,
        prefix: "",
        excludingTopLevelKeys: []
    )
    return try JSONSerialization.data(
        withJSONObject: manifest,
        options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    )
}

func readResearchArchiveBackup(at url: URL) throws -> Data {
    guard try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
        return try Data(contentsOf: url, options: .mappedIfSafe)
    }
    guard url.pathExtension == "researcharchive" else {
        throw ResearchArchiveExportError.invalidArchive
    }
    let archive = try Data(contentsOf: url.appendingPathComponent("archive.json"), options: .mappedIfSafe)
    let preview = try inspectResearchArchiveForRestore(archive)
    let manifestData = try Data(contentsOf: url.appendingPathComponent("manifest.json"), options: .mappedIfSafe)
    guard let manifest = try JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
          let bundleVersion = manifest["schemaVersion"] as? String,
          ["2026-08-19.research-archive-bundle.v1", "2026-10-10.research-archive-bundle.v2"].contains(bundleVersion),
          Set(manifest.keys) == Set([
            "schemaVersion", "exportedAt", "archiveFilename", "archiveSha256", "archiveByteCount",
            "originalPDFCount", "originalPDFManifestSha256", "cloudSyncStatus", "manifestSha256"
          ] + (bundleVersion == "2026-10-10.research-archive-bundle.v2"
                ? ["originalHTMLCount", "originalHTMLManifestSha256"] : [])),
          manifest["exportedAt"] as? String == preview.exportedAt,
          manifest["archiveSha256"] as? String == preview.archiveSha256,
          manifest["archiveByteCount"] as? Int == archive.count,
          manifest["cloudSyncStatus"] as? String == "UNKNOWN",
          let manifestSha256 = manifest["manifestSha256"] as? String,
          let originalPDFCount = manifest["originalPDFCount"] as? Int,
          originalPDFCount >= 0,
          let expectedPDFManifestSha256 = manifest["originalPDFManifestSha256"] as? String else {
        throw ResearchArchiveExportError.invalidArchive
    }
    var manifestPayload = manifest
    manifestPayload.removeValue(forKey: "manifestSha256")
    guard try portfolioDecisionContentId(
        object: manifestPayload,
        prefix: "",
        excludingTopLevelKeys: []
    ) == manifestSha256 else { throw ResearchArchiveExportError.invalidArchive }

    let pdfManifestURL = url
        .appendingPathComponent("OriginalPDFs", isDirectory: true)
        .appendingPathComponent(preview.symbol, isDirectory: true)
        .appendingPathComponent("Manifests", isDirectory: true)
        .appendingPathComponent("\(preview.archiveSha256).json", isDirectory: false)
    let pdfManifestData = try Data(contentsOf: pdfManifestURL, options: .mappedIfSafe)
    guard researchDocumentSha256(pdfManifestData) == expectedPDFManifestSha256,
          let pdfManifest = try JSONSerialization.jsonObject(with: pdfManifestData) as? [String: Any],
          let files = pdfManifest["files"] as? [[String: Any]],
          files.count == originalPDFCount,
          let pdfManifestSha256 = pdfManifest["manifestSha256"] as? String else {
        throw ResearchArchiveExportError.invalidArchive
    }
    var pdfManifestPayload = pdfManifest
    pdfManifestPayload.removeValue(forKey: "manifestSha256")
    guard try portfolioDecisionContentId(
        object: pdfManifestPayload,
        prefix: "",
        excludingTopLevelKeys: []
    ) == pdfManifestSha256 else { throw ResearchArchiveExportError.invalidArchive }
    let pdfRoot = url
        .appendingPathComponent("OriginalPDFs", isDirectory: true)
        .appendingPathComponent(preview.symbol, isDirectory: true)
    for file in files {
        guard let filename = file["filename"] as? String,
              let sha256 = file["pdfSha256"] as? String,
              filename == "\(sha256).pdf",
              let byteLength = file["byteLength"] as? Int,
              byteLength > 0 else { throw ResearchArchiveExportError.invalidArchive }
        let data = try Data(contentsOf: pdfRoot.appendingPathComponent(filename), options: .mappedIfSafe)
        guard data.count == byteLength, researchDocumentSha256(data) == sha256 else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }
    if bundleVersion == "2026-10-10.research-archive-bundle.v2" {
        guard let htmlCount = manifest["originalHTMLCount"] as? Int, htmlCount > 0,
              let htmlManifestHash = manifest["originalHTMLManifestSha256"] as? String else {
            throw ResearchArchiveExportError.invalidArchive
        }
        try validateResearchArchiveOriginalHTMLReadBack(directory: url, preview: preview,
            count: htmlCount, manifestHash: htmlManifestHash)
    }
    return archive
}

private func validateResearchArchiveOriginalHTMLReadBack(
    directory: URL, preview: ResearchArchiveRestorePreview,
    count: Int, manifestHash: String
) throws {
    let root = directory.appendingPathComponent("OriginalHTMLs", isDirectory: true)
        .appendingPathComponent(preview.symbol, isDirectory: true)
    let manifestURL = root.appendingPathComponent("Manifests", isDirectory: true)
        .appendingPathComponent("\(preview.archiveSha256).json", isDirectory: false)
    let data = try Data(contentsOf: manifestURL, options: .mappedIfSafe)
    guard researchDocumentSha256(data) == manifestHash,
          let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(manifest.keys) == Set(["schemaVersion", "exportedAt", "archiveSha256", "target", "files", "manifestSha256"]),
          manifest["schemaVersion"] as? String == "2026-10-10.research-archive-original-html.v1",
          manifest["exportedAt"] as? String == preview.exportedAt,
          manifest["archiveSha256"] as? String == preview.archiveSha256,
          let target = manifest["target"] as? [String: Any],
          target["membershipId"] as? String == preview.membershipId,
          target["membershipVersion"] as? Int == preview.membershipVersion,
          target["symbol"] as? String == preview.symbol,
          let files = manifest["files"] as? [[String: Any]], files.count == count,
          let expectedHash = manifest["manifestSha256"] as? String else {
        throw ResearchArchiveExportError.invalidArchive
    }
    var payload = manifest
    payload.removeValue(forKey: "manifestSha256")
    guard try portfolioDecisionContentId(object: payload, prefix: "", excludingTopLevelKeys: []) == expectedHash else {
        throw ResearchArchiveExportError.invalidArchive
    }
    var ids = Set<String>()
    for file in files {
        guard Set(file.keys) == Set(["snapshot", "filename"]),
              let snapshotObject = file["snapshot"] as? [String: Any],
              let filename = file["filename"] as? String,
              let snapshot = try? JSONDecoder().decode(ResearchSourceSnapshotData.self,
                  from: JSONSerialization.data(withJSONObject: snapshotObject)),
              ids.insert(snapshot.id).inserted,
              filename == "\(snapshot.rawSha256).html",
              snapshot.membershipId == preview.membershipId,
              snapshot.membershipVersion <= preview.membershipVersion,
              snapshot.symbol == preview.symbol,
              snapshot.sourceCategory == "issuer_public_html",
              snapshot.mediaType == "text/html",
              snapshot.byteLength > 0,
              let text = snapshot.normalizedText,
              researchDocumentSha256(Data(text.utf8)) == snapshot.textSha256 else {
            throw ResearchArchiveExportError.invalidArchive
        }
        let raw = try Data(contentsOf: root.appendingPathComponent(filename), options: .mappedIfSafe)
        guard raw.count == snapshot.byteLength,
              researchDocumentSha256(raw) == snapshot.rawSha256 else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }
}

@MainActor
@discardableResult
func writeResearchArchiveAutomaticBackup(
    _ archive: ResearchArchiveExportDocument,
    membership: CandidateMembershipData,
    trigger: ResearchArchiveAutomaticBackupTrigger,
    originalPDFs: [ResearchArchiveOriginalPDFBackup] = [],
    originalHTMLs: [ResearchArchiveOriginalHTMLBackup] = [],
    defaults: UserDefaults = .standard,
    fileManager: FileManager = .default,
    now: Date = Date()
) throws -> ResearchArchiveBackupResult? {
    let identity = trigger.identity.trimmingCharacters(in: .whitespacesAndNewlines)
    guard researchArchiveAutomaticBackupIsEnabled(defaults: defaults),
          !identity.isEmpty,
          let bookmark = defaults.data(forKey: researchArchiveBackupBookmarkKey) else { return nil }
    let triggerKey = "researchArchiveBackupLastTrigger.v2.\(membership.id).\(trigger.kind.rawValue)"
    let scopedTrigger = "\(identity):\(researchDocumentSha256(bookmark))"
    guard defaults.string(forKey: triggerKey) != scopedTrigger else { return nil }
    let directory = try storedResearchArchiveBackupDirectory(defaults: defaults)
    let hasAccess = directory.startAccessingSecurityScopedResource()
    defer { if hasAccess { directory.stopAccessingSecurityScopedResource() } }
    let result = try writeResearchArchiveBackup(
        archive,
        membership: membership,
        directory: directory,
        retention: ResearchArchiveBackupRetention(
            daily: defaults.object(forKey: "researchArchiveBackupDailyRetention.v1") as? Int ?? 30,
            weekly: defaults.object(forKey: "researchArchiveBackupWeeklyRetention.v1") as? Int ?? 12,
            monthly: defaults.object(forKey: "researchArchiveBackupMonthlyRetention.v1") as? Int ?? 12
        ),
        originalPDFs: originalPDFs,
        originalHTMLs: originalHTMLs,
        fileManager: fileManager
    )
    defaults.set(scopedTrigger, forKey: triggerKey)
    recordResearchArchiveBackupState(
        membership: membership,
        status:
        "\(membership.symbol) · \(trigger.kind.label)自动备份完成 · \(result.preview.exportedAt) · SHA \(result.preview.archiveSha256.prefix(12))… · 云端 UNKNOWN",
        completedAt: ISO8601DateFormatter().string(from: now),
        defaults: defaults
    )
    return result
}

func researchArchiveAutomaticBackupIsEnabled(defaults: UserDefaults = .standard) -> Bool {
    defaults.bool(forKey: researchArchiveBackupAutomaticEnabledKey)
        && defaults.data(forKey: researchArchiveBackupBookmarkKey) != nil
}

func recordResearchArchiveAutomaticBackupFailure(
    membership: CandidateMembershipData,
    trigger: ResearchArchiveAutomaticBackupTrigger,
    defaults: UserDefaults = .standard
) {
    guard researchArchiveAutomaticBackupIsEnabled(defaults: defaults) else { return }
    recordResearchArchiveBackupState(
        membership: membership,
        status: "\(membership.symbol) · \(trigger.kind.label)自动备份失败 · 请到研究页重试或重新选择目录",
        defaults: defaults
    )
}

func researchArchiveBackupAttentionMessage(
    bookmark: Data,
    lastStatus: String,
    lastCompletedAt: String,
    now: Date = Date()
) -> String? {
    guard !bookmark.isEmpty else { return nil }
    if lastStatus.contains("失败") {
        return "同步目录本地备份失败；请到研究页重新选择目录或重试。云端同步状态仍为 UNKNOWN。"
    }
    guard let completedAt = ISO8601DateFormatter().date(from: lastCompletedAt) else {
        return "已选择同步目录，但尚未完成首次本地备份；云端同步状态仍为 UNKNOWN。"
    }
    guard now.timeIntervalSince(completedAt) > 48 * 60 * 60 else { return nil }
    return "同步目录本地备份已超过 48 小时未成功；请到研究页重试。云端同步状态仍为 UNKNOWN。"
}

private func writeResearchArchiveOriginalPDFBackups(
    _ originals: [ResearchArchiveOriginalPDFBackup],
    membership: CandidateMembershipData,
    archive: ResearchArchiveRestorePreview,
    directory: URL,
    fileManager: FileManager
) throws -> Int {
    guard Set(originals.map(\.document.id)).count == originals.count else {
        throw ResearchArchiveExportError.invalidSource
    }
    for original in originals {
        let document = original.document
        guard document.membershipId == membership.id,
              document.symbol == membership.symbol,
              document.isSourceAvailable,
              original.data.count == document.byteLength,
              original.data.prefix(1_024).range(of: Data("%PDF-".utf8)) != nil,
              researchDocumentSha256(original.data) == document.pdfSha256 else {
            throw ResearchArchiveExportError.invalidSource
        }
    }
    let root = directory
        .appendingPathComponent("OriginalPDFs", isDirectory: true)
        .appendingPathComponent(membership.symbol, isDirectory: true)
    let manifests = root.appendingPathComponent("Manifests", isDirectory: true)
    try fileManager.createDirectory(at: manifests, withIntermediateDirectories: true)
    var files: [[String: Any]] = []
    for original in originals {
        let document = original.document
        let filename = "\(document.pdfSha256).pdf"
        let url = root.appendingPathComponent(filename, isDirectory: false)
        if !fileManager.fileExists(atPath: url.path) {
            try original.data.write(to: url, options: .atomic)
        }
        let readBack = try Data(contentsOf: url, options: .mappedIfSafe)
        guard readBack.count == document.byteLength,
              researchDocumentSha256(readBack) == document.pdfSha256 else {
            throw ResearchArchiveExportError.invalidArchive
        }
        files.append([
            "documentId": document.id,
            "title": document.title,
            "originalFilename": document.originalFilename,
            "publishedAt": document.publishedAt,
            "sourceVersion": document.sourceVersion,
            "pdfSha256": document.pdfSha256,
            "byteLength": document.byteLength,
            "filename": filename
        ])
    }
    let payload: [String: Any] = [
        "schemaVersion": "2026-08-17.research-archive-original-pdfs.v1",
        "exportedAt": archive.exportedAt,
        "archiveSha256": archive.archiveSha256,
        "target": [
            "membershipId": membership.id,
            "membershipVersion": membership.version,
            "symbol": membership.symbol
        ],
        "files": files
    ]
    var manifest = payload
    manifest["manifestSha256"] = try portfolioDecisionContentId(
        object: payload,
        prefix: "",
        excludingTopLevelKeys: []
    )
    let manifestData = try JSONSerialization.data(
        withJSONObject: manifest,
        options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    )
    let manifestURL = manifests.appendingPathComponent("\(archive.archiveSha256).json", isDirectory: false)
    try manifestData.write(to: manifestURL, options: .atomic)
    guard try Data(contentsOf: manifestURL, options: .mappedIfSafe) == manifestData else {
        throw ResearchArchiveExportError.invalidArchive
    }
    return originals.count
}

private func writeResearchArchiveOriginalHTMLBackups(
    _ originals: [ResearchArchiveOriginalHTMLBackup],
    membership: CandidateMembershipData,
    archive: ResearchArchiveRestorePreview,
    directory: URL,
    fileManager: FileManager
) throws -> Int {
    guard Set(originals.map(\.snapshot.id)).count == originals.count else {
        throw ResearchArchiveExportError.invalidSource
    }
    if originals.isEmpty { return 0 }
    let root = directory.appendingPathComponent("OriginalHTMLs", isDirectory: true)
        .appendingPathComponent(membership.symbol, isDirectory: true)
    let manifests = root.appendingPathComponent("Manifests", isDirectory: true)
    try fileManager.createDirectory(at: manifests, withIntermediateDirectories: true)
    var files: [[String: Any]] = []
    for original in originals {
        let snapshot = original.snapshot
        guard snapshot.validates(expected: membership, requireText: true),
              original.data.count == snapshot.byteLength,
              researchDocumentSha256(original.data) == snapshot.rawSha256 else {
            throw ResearchArchiveExportError.invalidSource
        }
        let filename = "\(snapshot.rawSha256).html"
        let url = root.appendingPathComponent(filename, isDirectory: false)
        if !fileManager.fileExists(atPath: url.path) {
            try original.data.write(to: url, options: .atomic)
        }
        let readBack = try Data(contentsOf: url, options: .mappedIfSafe)
        guard readBack.count == snapshot.byteLength,
              researchDocumentSha256(readBack) == snapshot.rawSha256,
              let snapshotObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as? [String: Any] else {
            throw ResearchArchiveExportError.invalidArchive
        }
        files.append(["snapshot": snapshotObject, "filename": filename])
    }
    let payload: [String: Any] = [
        "schemaVersion": "2026-10-10.research-archive-original-html.v1",
        "exportedAt": archive.exportedAt,
        "archiveSha256": archive.archiveSha256,
        "target": ["membershipId": membership.id, "membershipVersion": membership.version,
                   "symbol": membership.symbol],
        "files": files
    ]
    var manifest = payload
    manifest["manifestSha256"] = try portfolioDecisionContentId(
        object: payload, prefix: "", excludingTopLevelKeys: [])
    let data = try JSONSerialization.data(withJSONObject: manifest,
        options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    let manifestURL = manifests.appendingPathComponent("\(archive.archiveSha256).json", isDirectory: false)
    try data.write(to: manifestURL, options: .atomic)
    guard try Data(contentsOf: manifestURL, options: .mappedIfSafe) == data else {
        throw ResearchArchiveExportError.invalidArchive
    }
    return originals.count
}

private func researchArchiveOriginalHTMLManifestURL(
    directory: URL, membership: CandidateMembershipData, archiveSha256: String
) -> URL {
    directory.appendingPathComponent("OriginalHTMLs", isDirectory: true)
        .appendingPathComponent(membership.symbol, isDirectory: true)
        .appendingPathComponent("Manifests", isDirectory: true)
        .appendingPathComponent("\(archiveSha256).json", isDirectory: false)
}

private func researchArchiveOriginalHTMLBackupsMatch(
    _ originals: [ResearchArchiveOriginalHTMLBackup],
    membership: CandidateMembershipData, directory: URL
) -> Bool {
    originals.allSatisfy { original in
        let snapshot = original.snapshot
        let url = directory.appendingPathComponent("OriginalHTMLs", isDirectory: true)
            .appendingPathComponent(membership.symbol, isDirectory: true)
            .appendingPathComponent("\(snapshot.rawSha256).html", isDirectory: false)
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return false }
        return data.count == snapshot.byteLength && researchDocumentSha256(data) == snapshot.rawSha256
    }
}

private func researchArchiveOriginalPDFManifestURL(
    directory: URL,
    membership: CandidateMembershipData,
    archiveSha256: String
) -> URL {
    directory
        .appendingPathComponent("OriginalPDFs", isDirectory: true)
        .appendingPathComponent(membership.symbol, isDirectory: true)
        .appendingPathComponent("Manifests", isDirectory: true)
        .appendingPathComponent("\(archiveSha256).json", isDirectory: false)
}

private func researchArchiveOriginalPDFBackupsMatch(
    _ originals: [ResearchArchiveOriginalPDFBackup],
    membership: CandidateMembershipData,
    directory: URL
) -> Bool {
    originals.allSatisfy { original in
        let url = directory
            .appendingPathComponent("OriginalPDFs", isDirectory: true)
            .appendingPathComponent(membership.symbol, isDirectory: true)
            .appendingPathComponent("\(original.document.pdfSha256).pdf", isDirectory: false)
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return false }
        return data.count == original.document.byteLength
            && researchDocumentSha256(data) == original.document.pdfSha256
    }
}

private func storedResearchArchiveBackupDirectoryName(
    defaults: UserDefaults = .standard
) -> String? {
    guard defaults.data(forKey: researchArchiveBackupBookmarkKey) != nil else { return nil }
    return defaults.string(forKey: researchArchiveBackupDirectoryNameKey)
}

private func storedResearchArchiveBackupDirectory(
    defaults: UserDefaults = .standard
) throws -> URL {
    guard let bookmark = defaults.data(forKey: researchArchiveBackupBookmarkKey) else {
        throw ResearchArchiveExportError.invalidArchive
    }
    var isStale = false
    let url = try URL(
        resolvingBookmarkData: bookmark,
        options: .withoutUI,
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
    )
    guard !isStale else { throw ResearchArchiveExportError.invalidArchive }
    return url
}

private func pruneResearchArchiveBackups(
    in directory: URL,
    symbol: String,
    retention: ResearchArchiveBackupRetention,
    protectedURL: URL,
    fileManager: FileManager
) throws -> (retained: Int, deleted: Int) {
    let prefix = "\(symbol)-research-archive-"
    let archives = try fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
    )
    .filter {
        $0.lastPathComponent.hasPrefix(prefix)
            && ($0.pathExtension == "json" || $0.pathExtension == "researcharchive")
    }
    .compactMap { url -> (url: URL, date: Date, archiveSha256: String, bundled: Bool)? in
        let bundled = url.pathExtension == "researcharchive"
        let archiveURL = bundled ? url.appendingPathComponent("archive.json", isDirectory: false) : url
        guard let data = try? Data(contentsOf: archiveURL, options: .mappedIfSafe),
              let preview = try? inspectResearchArchiveForRestore(data),
              preview.symbol == symbol,
              let date = ISO8601DateFormatter().date(from: preview.exportedAt) else { return nil }
        return (url, date, preview.archiveSha256, bundled)
    }
    .sorted {
        $0.date == $1.date ? $0.bundled && !$1.bundled : $0.date > $1.date
    }

    var seenHashes = Set<String>()
    let uniqueArchives = archives.filter { seenHashes.insert($0.archiveSha256).inserted }
    let duplicateArchives = archives.filter { archive in
        uniqueArchives.contains { $0.archiveSha256 == archive.archiveSha256 && $0.url != archive.url }
    }

    var calendar = Calendar(identifier: .iso8601)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    func canonical(_ url: URL) -> URL { url.resolvingSymlinksInPath().standardizedFileURL }
    var kept: Set<URL> = [canonical(protectedURL)]
    func keepNewest(limit: Int, key: (Date) -> String) {
        var periods = Set<String>()
        for archive in uniqueArchives where periods.count < limit {
            if periods.insert(key(archive.date)).inserted { kept.insert(canonical(archive.url)) }
        }
    }
    keepNewest(limit: retention.daily) { date in
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year ?? 0):\(parts.month ?? 0):\(parts.day ?? 0)"
    }
    keepNewest(limit: retention.weekly) { date in
        let parts = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        return "\(parts.yearForWeekOfYear ?? 0):\(parts.weekOfYear ?? 0)"
    }
    keepNewest(limit: retention.monthly) { date in
        let parts = calendar.dateComponents([.year, .month], from: date)
        return "\(parts.year ?? 0):\(parts.month ?? 0)"
    }
    let obsolete = uniqueArchives.filter { !kept.contains(canonical($0.url)) } + duplicateArchives
    for archive in obsolete {
        try fileManager.removeItem(at: archive.url)
        if !archive.bundled {
            let manifest = directory
                .appendingPathComponent("OriginalPDFs/\(symbol)/Manifests", isDirectory: true)
                .appendingPathComponent("\(archive.archiveSha256).json", isDirectory: false)
            if fileManager.fileExists(atPath: manifest.path) { try fileManager.removeItem(at: manifest) }
        }
    }
    return (kept.count, obsolete.count)
}

private func researchArchiveRestoreDirectory(
    membership: CandidateMembershipData,
    rootDirectory: URL?,
    fileManager: FileManager
) throws -> URL {
    let root = rootDirectory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let directory = root
        .appendingPathComponent("ResearchArchiveHistory", isDirectory: true)
        .appendingPathComponent(membership.id, isDirectory: true)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableDirectory = directory
    try mutableDirectory.setResourceValues(values)
    return directory
}

private func validatedResearchArchiveRoot(_ data: Data) throws -> [String: Any] {
    guard let originalRoot = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(originalRoot.keys) == Set(["schemaVersion", "exportedAt", "target", "manifest", "omittedComponents", "contents", "policy", "archiveSha256"]),
          let schemaVersion = originalRoot["schemaVersion"] as? String,
          [
            legacyResearchArchiveExportSchemaVersion,
            localMemoryResearchArchiveExportSchemaVersion,
            deletionAwareResearchArchiveExportSchemaVersion,
            conversationRestoreResearchArchiveExportSchemaVersion,
            researchArchiveExportSchemaVersion
          ].contains(schemaVersion),
          let exportedAt = originalRoot["exportedAt"] as? String,
          isParseableDateTime(exportedAt),
          let expectedHash = originalRoot["archiveSha256"] as? String,
          let manifest = originalRoot["manifest"] as? [[String: Any]],
          let contents = originalRoot["contents"] as? [String: Any],
          manifest.count == contents.count else {
        throw ResearchArchiveExportError.invalidArchive
    }
    var root = originalRoot
    root.removeValue(forKey: "archiveSha256")
    let actualHash = try portfolioDecisionContentId(
        object: root,
        prefix: "",
        excludingTopLevelKeys: []
    )
    guard actualHash == expectedHash else { throw ResearchArchiveExportError.invalidArchive }
    for item in manifest {
        guard Set(item.keys) == Set(["name", "sha256", "byteCount"]),
              let name = item["name"] as? String,
              let expected = item["sha256"] as? String,
              let byteCount = item["byteCount"] as? Int,
              let component = contents[name] as? [String: Any],
              try portfolioDecisionContentId(
                object: component,
                prefix: "",
                excludingTopLevelKeys: []
              ) == expected,
              try JSONSerialization.data(
                withJSONObject: component,
                options: [.sortedKeys, .withoutEscapingSlashes]
              ).count == byteCount else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }
    return originalRoot
}

private func validateResearchArchiveSources(
    membership: CandidateMembershipData,
    profile: ResearchProfileEnvelope?,
    fundamentals: ResearchFundamentalsEnvelope?,
    context: ResearchContextEnvelope?,
    completeness: ResearchCompletenessEnvelope?,
    valuationScenarios: ResearchValuationScenariosEnvelope?,
    evidenceWorkspace: FrozenResearchEvidenceWorkspace?,
    decisionReviewHistory: DecisionReviewHistoryEnvelope?,
    localReviewKnowledge: [AssistReviewKnowledgeEnvelope],
    localRecord: AssistMobileWorkspaceLocalRecordEnvelope?,
    localRecordDeletion: ResearchArchiveLocalRecordDeletion?,
    materialDeletions: ResearchArchiveMaterialDeletions?,
    temporaryConversation: ResearchArchiveTemporaryConversation?
) throws {
    try profile?.validateForDisplay(market: membership.market, code: membership.code)
    try fundamentals?.validate(expected: membership)
    try context?.validate(expected: membership)
    try completeness?.validate(expected: membership)
    _ = try valuationScenarios?.validated(expected: membership)
    _ = try evidenceWorkspace?.validated(expected: membership)
    try validateResearchArchiveDecisionReviewHistory(decisionReviewHistory, membership: membership)
    for entry in localReviewKnowledge {
        try entry.validateForUserDefaults()
        guard entry.target.candidateMembershipId == membership.id,
              entry.target.candidateMembershipVersion <= membership.version,
              entry.target.symbol == membership.symbol else {
            throw ResearchArchiveExportError.invalidSource
        }
    }
    if let localRecord {
        try localRecord.validateForUserDefaults()
        guard localRecord.recordId == "assist-local-record:\(localRecord.sourceRef.sourceSignature)",
              localRecord.target.market == membership.market,
              localRecord.target.code == membership.code,
              localRecord.target.symbol == membership.symbol,
              localRecord.target.candidateMembershipId == membership.id else {
            throw ResearchArchiveExportError.invalidSource
        }
    }
    if let localRecordDeletion {
        let parts = localRecordDeletion.sourceSignature
            .split(separator: "|", omittingEmptySubsequences: false)
            .map(String.init)
        guard localRecord == nil,
              parts.count == 9,
              parts[0] == membership.id,
              parts[1] == "membership-version-\(membership.version)",
              parts[2] == membership.symbol,
              isParseableDateTime(localRecordDeletion.deletedAt) else {
            throw ResearchArchiveExportError.invalidSource
        }
    }
    if let materialDeletions {
        guard !materialDeletions.items.isEmpty,
              Set(materialDeletions.items.map(\.materialId)).count == materialDeletions.items.count,
              Set(materialDeletions.items.map(\.evidenceId)).count == materialDeletions.items.count else {
            throw ResearchArchiveExportError.invalidSource
        }
        for deletion in materialDeletions.items {
            guard researchDocumentIsPositiveIntegerString(deletion.materialId),
                  researchDocumentIsPositiveIntegerString(deletion.evidenceId),
                  deletion.membershipId == membership.id,
                  deletion.membershipVersion == membership.version,
                  deletion.symbol == membership.symbol,
                  researchDocumentIsSha256(deletion.contentFingerprint),
                  isParseableDateTime(deletion.deletedAt),
                  deletion.state == "deleted" else {
                throw ResearchArchiveExportError.invalidSource
            }
        }
    }
    if let temporaryConversation {
        let formatter = ISO8601DateFormatter()
        guard temporaryConversation.membershipId == membership.id,
              temporaryConversation.membershipVersion == membership.version,
              temporaryConversation.membershipState == membership.state.rawValue,
              temporaryConversation.symbol == membership.symbol,
              researchDocumentIsPositiveIntegerString(temporaryConversation.reportId),
              temporaryConversation.reportVersion > 0,
              researchDocumentIsSha256(temporaryConversation.reportFingerprint),
              researchDocumentIsPositiveIntegerString(temporaryConversation.evidencePackId),
              researchDocumentIsSha256(temporaryConversation.evidencePackFingerprint),
              temporaryConversation.responses.count <= 8,
              (temporaryConversation.sessionId == nil
                || UUID(uuidString: temporaryConversation.sessionId!) != nil),
              (temporaryConversation.carrySummary == nil
                && temporaryConversation.carryFromSessionId == nil
                || temporaryConversation.carrySummary.map(researchEvidenceQuestionCarrySummaryIsBounded) == true
                    && (temporaryConversation.carryFromSessionId == "legacy"
                        || temporaryConversation.carryFromSessionId.flatMap(UUID.init(uuidString:)) != nil)),
              temporaryConversation.questionDraft.count <= 4_000,
              temporaryConversation.correctionDraft.count <= 4_000,
              let savedAt = formatter.date(from: temporaryConversation.savedAt),
              let expiresAt = formatter.date(from: temporaryConversation.expiresAt),
              savedAt <= expiresAt,
              !temporaryConversation.responses.isEmpty
                || !temporaryConversation.questionDraft.isEmpty
                || !temporaryConversation.correctionDraft.isEmpty
                || temporaryConversation.carrySummary != nil else {
            throw ResearchArchiveExportError.invalidSource
        }
        for response in temporaryConversation.responses {
            guard response.status == "available",
                  response.membershipId == membership.id,
                  response.membershipVersion == membership.version,
                  response.symbol == membership.symbol,
                  response.binding?.reportId == temporaryConversation.reportId,
                  response.binding?.reportVersion == temporaryConversation.reportVersion,
                  response.binding?.reportFingerprint == temporaryConversation.reportFingerprint,
                  response.binding?.evidencePackId == temporaryConversation.evidencePackId,
                  response.binding?.evidencePackFingerprint == temporaryConversation.evidencePackFingerprint else {
                throw ResearchArchiveExportError.invalidSource
            }
        }
    }
}

private func validateResearchArchiveDecisionReviewHistory(
    _ history: DecisionReviewHistoryEnvelope?,
    membership: CandidateMembershipData
) throws {
    guard let history else { return }
    guard history.requestedSymbol == membership.symbol,
          history.metadata.provenance == "real",
          !history.metadata.fixture,
          history.checks.allSatisfy({ check in
              if let binding = check.researchReportDecision.binding {
                  return check.researchReportDecision.availability == "preserved"
                      && binding.membershipId == membership.id
                      && binding.membershipVersion == membership.version
                      && binding.symbol == membership.symbol
              }
              return check.researchReportDecision.availability == "not_captured"
          }) else {
        throw ResearchArchiveExportError.invalidSource
    }
    if (try? history.validateForDisplay(market: membership.market, code: membership.code)) != nil {
        return
    }
    let reviews = history.checks.flatMap(\.reviews)
    guard history.advisoryOnly,
          !history.checks.isEmpty,
          Set(history.checks.map(\.id)).count == history.checks.count,
          Set(reviews.map(\.id)).count == reviews.count,
          researchArchiveSafetyIsReadOnly(history.safety) else {
        throw ResearchArchiveExportError.invalidSource
    }
    for check in history.checks {
        guard !check.id.isEmpty,
              check.market == membership.market,
              check.code == membership.code,
              check.symbol == membership.symbol,
              !check.contextId.isEmpty,
              !check.contextHash.isEmpty,
              isParseableDateTime(check.checkedAt),
              researchArchiveSafetyIsReadOnly(check.safety) else {
            throw ResearchArchiveExportError.invalidSource
        }
        try check.researchReportDecision.validate(expectedSymbol: membership.symbol)
        for review in check.reviews {
            guard !review.id.isEmpty,
                  review.decisionCheckId == check.id,
                  review.market == membership.market,
                  review.code == membership.code,
                  review.symbol == membership.symbol,
                  isParseableDateTime(review.reviewedAt),
                  isParseableDateTime(review.createdAt),
                  researchArchiveSafetyIsReadOnly(review.safety) else {
                throw ResearchArchiveExportError.invalidSource
            }
        }
    }
}

private func researchArchiveSafetyIsReadOnly(_ safety: DecisionCheckSafety) -> Bool {
    !safety.createsOrder && !safety.createsTrade && !safety.mutatesCash
        && !safety.writesFee && !safety.mutatesPosition && !safety.callsBroker
}

private func encodeResearchArchiveComponent(_ value: any Encodable) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
}

private func researchArchiveFilename(symbol: String, exportedAt: Date) -> String {
    "\(symbol)-research-archive-\(researchArchiveTimestamp(exportedAt)).json"
}

private func researchArchiveTimestamp(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
    return formatter.string(from: date)
}
