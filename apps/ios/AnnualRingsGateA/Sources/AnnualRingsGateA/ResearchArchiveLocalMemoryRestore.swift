import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct ResearchArchiveLocalMemoryRestoreSummary: Equatable {
    let localRecordId: String?
    let localRecordDeleted: Bool
    let knowledgeCount: Int
    let temporaryConversationRestored: Bool
}

private struct ResearchArchiveRestoredLocalKnowledge: Decodable {
    let entries: [AssistReviewKnowledgeEnvelope]
}

func assistMobileWorkspaceLocalRecordStorageKey(_ sourceSignature: String) -> String {
    "assist.local.record.envelope.v1.\(sourceSignature)"
}

func assistMobileWorkspaceLocalRecordDeletionKey(_ sourceSignature: String) -> String {
    "assist.local.record.deletion.v1.\(sourceSignature)"
}

func assistMobileWorkspaceLocalRecordSourceRefMatchesSignature(
    _ envelope: AssistMobileWorkspaceLocalRecordEnvelope
) -> Bool {
    let parts = envelope.sourceRef.sourceSignature
        .split(separator: "|", omittingEmptySubsequences: false)
        .map(String.init)
    guard parts.count == 9 else { return false }
    return envelope.sourceRef.decisionContextId == researchArchiveOptionalSignaturePart(parts[3], missing: "no-decision-context")
        && envelope.sourceRef.decisionContextHash == researchArchiveOptionalSignaturePart(parts[4], missing: "no-context-hash")
        && envelope.sourceRef.followUpWorkflowGeneratedAt == researchArchiveOptionalSignaturePart(parts[5], missing: "no-follow-up-generated-at")
        && envelope.sourceRef.decisionNoteWorkflowGeneratedAt == researchArchiveOptionalSignaturePart(parts[6], missing: "no-decision-note-generated-at")
}

func restoreResearchArchiveLocalMemory(
    _ archive: RestoredResearchArchive,
    membership: CandidateMembershipData,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity,
    localDefaults: UserDefaults,
    knowledgeStorage: AssistReviewKnowledgeLocalStorage,
    currentReport: TwoLayerReportData? = nil,
    now: Date = Date()
) throws -> ResearchArchiveLocalMemoryRestoreSummary {
    let preview = try inspectResearchArchiveForRestore(archive.data)
    guard archive.preview == preview,
          preview.matches(membership),
          currentIdentity.symbol == membership.symbol,
          currentIdentity.membershipId == membership.id,
          currentIdentity.membershipVersion == membership.version,
          assistReviewKnowledgeIdentityErrors(currentIdentity, expectedSymbol: membership.symbol).isEmpty,
          let root = try JSONSerialization.jsonObject(with: archive.data) as? [String: Any],
          let contents = root["contents"] as? [String: Any] else {
        throw ResearchArchiveExportError.invalidArchive
    }

    let localRecord = try researchArchiveComponent(
        AssistMobileWorkspaceLocalRecordEnvelope.self,
        named: "localRecord",
        contents: contents
    )
    let localRecordDeletion = try researchArchiveComponent(
        ResearchArchiveLocalRecordDeletion.self,
        named: "localRecordDeletion",
        contents: contents
    )
    let restoredKnowledge = try researchArchiveComponent(
        ResearchArchiveRestoredLocalKnowledge.self,
        named: "localReviewKnowledge",
        contents: contents
    )
    let temporaryConversation = try researchArchiveComponent(
        ResearchArchiveTemporaryConversation.self,
        named: "temporaryConversation",
        contents: contents
    )
    guard localRecord != nil || localRecordDeletion != nil || restoredKnowledge != nil
        || temporaryConversation != nil else {
        throw ResearchArchiveExportError.invalidArchive
    }

    if let localRecord {
        try localRecord.validateForUserDefaults()
        guard localRecord.recordId == "assist-local-record:\(currentIdentity.sourceSignature)",
              localRecord.sourceRef.sourceSignature == currentIdentity.sourceSignature,
              assistMobileWorkspaceLocalRecordSourceRefMatchesSignature(localRecord),
              localRecord.sourceRef.decisionContextId == currentIdentity.decisionContextId,
              localRecord.sourceRef.decisionContextHash == currentIdentity.decisionContextHash,
              localRecord.target.market == membership.market,
              localRecord.target.code == membership.code,
              localRecord.target.symbol == membership.symbol,
              localRecord.target.candidateMembershipId == membership.id else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }
    if let localRecordDeletion {
        guard localRecord == nil,
              localRecordDeletion.sourceSignature == currentIdentity.sourceSignature,
              parseInstant(localRecordDeletion.deletedAt) != nil else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }

    let entries = restoredKnowledge?.entries.sorted(by: assistReviewKnowledgePrecedes) ?? []
    guard restoredKnowledge == nil || !entries.isEmpty else {
        throw ResearchArchiveExportError.invalidArchive
    }
    for entry in entries {
        try entry.validateForUserDefaults()
        guard entry.target.symbol == membership.symbol,
              entry.target.candidateMembershipId == membership.id,
              entry.target.candidateMembershipVersion <= membership.version else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }
    let collection = entries.isEmpty ? nil : try assistReviewKnowledgeBuildCollection(
        symbol: membership.symbol,
        membershipId: membership.id,
        entries: entries
    )
    let temporarySnapshot: ResearchTemporaryConversationSnapshot?
    if let temporaryConversation {
        let formatter = ISO8601DateFormatter()
        guard let currentReport,
              temporaryConversation.membershipId == membership.id,
              temporaryConversation.membershipVersion == membership.version,
              temporaryConversation.membershipState == membership.state.rawValue,
              temporaryConversation.symbol == membership.symbol,
              temporaryConversation.reportId == currentReport.id,
              temporaryConversation.reportVersion == currentReport.version,
              temporaryConversation.reportFingerprint == currentReport.reportFingerprint,
              temporaryConversation.evidencePackId == currentReport.evidencePackId,
              temporaryConversation.evidencePackFingerprint == currentReport.payload.evidencePackBinding?.fingerprint,
              let expiresAt = formatter.date(from: temporaryConversation.expiresAt),
              expiresAt > now else {
            throw ResearchArchiveExportError.invalidArchive
        }
        temporarySnapshot = ResearchTemporaryConversationSnapshot(
            responses: temporaryConversation.responses,
            questionDraft: temporaryConversation.questionDraft,
            correctionDraft: temporaryConversation.correctionDraft,
            savedAt: temporaryConversation.savedAt,
            expiresAt: temporaryConversation.expiresAt,
            sessionId: temporaryConversation.sessionId ?? "legacy",
            carrySummary: temporaryConversation.carrySummary,
            carryFromSessionId: temporaryConversation.carryFromSessionId
        )
    } else {
        temporarySnapshot = nil
    }

    let recordKey = assistMobileWorkspaceLocalRecordStorageKey(currentIdentity.sourceSignature)
    let deletionKey = assistMobileWorkspaceLocalRecordDeletionKey(currentIdentity.sourceSignature)
    let knowledgeKey = try assistReviewKnowledgeStorageKey(
        membershipId: membership.id,
        symbol: membership.symbol
    )
    let existingRecordRaw = localDefaults.string(forKey: recordKey)
    let existingDeletionRaw = localDefaults.string(forKey: deletionKey)
    let existingKnowledge = collection == nil ? nil : try knowledgeStorage.readString(forKey: knowledgeKey)
    if let localRecord, let deletedAt = localDefaults.string(forKey: deletionKey) {
        guard let deletedDate = parseInstant(deletedAt),
              let recordDate = parseInstant(localRecord.updatedAt),
              deletedDate < recordDate else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }
    if let localRecordDeletion,
       let existingRecordRaw {
        let existing = assistMobileWorkspaceLoadLocalRecordEnvelope(
            raw: existingRecordRaw,
            expectedSourceSignature: currentIdentity.sourceSignature
        )
        guard existing.ok,
              let envelope = existing.envelope,
              let existingDate = parseInstant(envelope.updatedAt),
              let deletionDate = parseInstant(localRecordDeletion.deletedAt),
              existingDate <= deletionDate else {
            throw ResearchArchiveExportError.invalidArchive
        }
    }
    guard localDefaults.object(forKey: recordKey) == nil || existingRecordRaw != nil,
          localRecord == nil || existingRecordRaw == nil,
          existingKnowledge == nil else {
        throw ResearchArchiveExportError.invalidArchive
    }

    let recordRaw = try localRecord.map { record -> String in
        guard let raw = String(data: try JSONEncoder().encode(record), encoding: .utf8) else {
            throw ResearchArchiveExportError.invalidArchive
        }
        return raw
    }
    let knowledgeRaw = try collection.map { collection -> String in
        let data = try JSONEncoder().encode(collection)
        guard data.count <= ASSIST_REVIEW_KNOWLEDGE_MAX_RAW_BYTES,
              let raw = String(data: data, encoding: .utf8) else {
            throw ResearchArchiveExportError.invalidArchive
        }
        return raw
    }

    var wroteRecord = false
    var wroteDeletion = false
    var wroteKnowledge = false
    do {
        if let knowledgeRaw {
            wroteKnowledge = true
            try knowledgeStorage.writeString(knowledgeRaw, forKey: knowledgeKey)
        }
        if let localRecordDeletion {
            wroteDeletion = true
            let deletedAt: String
            if let existingDeletionRaw,
               let existingDate = parseInstant(existingDeletionRaw),
               let archiveDate = parseInstant(localRecordDeletion.deletedAt),
               existingDate >= archiveDate {
                deletedAt = existingDeletionRaw
            } else {
                deletedAt = localRecordDeletion.deletedAt
            }
            localDefaults.set(deletedAt, forKey: deletionKey)
            localDefaults.removeObject(forKey: recordKey)
            guard localDefaults.string(forKey: deletionKey) == deletedAt,
                  localDefaults.object(forKey: recordKey) == nil else {
                throw ResearchArchiveExportError.invalidArchive
            }
        }
        if let recordRaw {
            wroteRecord = true
            localDefaults.set(recordRaw, forKey: recordKey)
            guard localDefaults.string(forKey: recordKey) == recordRaw else {
                throw ResearchArchiveExportError.invalidArchive
            }
        }
        if let localRecord {
            let readBack = assistMobileWorkspaceLoadLocalRecordEnvelope(
                raw: localDefaults.string(forKey: recordKey),
                expectedSourceSignature: currentIdentity.sourceSignature
            )
            guard readBack.ok, readBack.envelope == localRecord else {
                throw ResearchArchiveExportError.invalidArchive
            }
            localDefaults.removeObject(forKey: deletionKey)
            guard localDefaults.object(forKey: deletionKey) == nil else {
                throw ResearchArchiveExportError.invalidArchive
            }
        }
        if let collection {
            let readBack = assistReviewKnowledgeLoad(
                storage: knowledgeStorage,
                symbol: membership.symbol,
                currentIdentity: currentIdentity
            )
            guard readBack.ok, readBack.collection == collection else {
                throw ResearchArchiveExportError.invalidArchive
            }
        }
        if let temporarySnapshot, let currentReport {
            try restoreResearchTemporaryConversationSnapshot(
                membership: membership,
                report: currentReport,
                snapshot: temporarySnapshot,
                now: now,
                defaults: localDefaults
            )
        }
        return ResearchArchiveLocalMemoryRestoreSummary(
            localRecordId: localRecord?.recordId,
            localRecordDeleted: localRecordDeletion != nil,
            knowledgeCount: collection?.entries.count ?? 0,
            temporaryConversationRestored: temporarySnapshot != nil
        )
    } catch {
        if wroteRecord || wroteDeletion {
            if let existingRecordRaw {
                localDefaults.set(existingRecordRaw, forKey: recordKey)
            } else {
                localDefaults.removeObject(forKey: recordKey)
            }
            if let existingDeletionRaw {
                localDefaults.set(existingDeletionRaw, forKey: deletionKey)
            } else {
                localDefaults.removeObject(forKey: deletionKey)
            }
        }
        if wroteKnowledge { try? knowledgeStorage.removeValue(forKey: knowledgeKey) }
        let recordWasRestored = !wroteRecord && !wroteDeletion
            || localDefaults.string(forKey: recordKey) == existingRecordRaw
        let deletionWasRestored = !wroteRecord && !wroteDeletion
            || localDefaults.string(forKey: deletionKey) == existingDeletionRaw
        let knowledgeWasRemoved = !wroteKnowledge || (try? knowledgeStorage.readString(forKey: knowledgeKey)) == nil
        guard recordWasRestored, deletionWasRestored, knowledgeWasRemoved else {
            throw ResearchArchiveExportError.invalidArchive
        }
        throw ResearchArchiveExportError.invalidArchive
    }
}

private func researchArchiveOptionalSignaturePart(_ value: String, missing: String) -> String? {
    value == missing ? nil : value
}

private func researchArchiveComponent<T: Decodable>(
    _ type: T.Type,
    named name: String,
    contents: [String: Any]
) throws -> T? {
    guard let object = contents[name] else { return nil }
    guard JSONSerialization.isValidJSONObject(object) else {
        throw ResearchArchiveExportError.invalidArchive
    }
    return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: object))
}

struct ResearchArchiveRestoreSection: View {
    let membership: CandidateMembershipData?
    let restoreLocalMemory: (RestoredResearchArchive) throws -> Void
    @State private var isImporting = false
    @State private var preview: ResearchArchiveRestorePreview?
    @State private var pendingData: Data?
    @State private var restoredArchive: RestoredResearchArchive?
    @State private var pendingDeleteHash: String?
    @State private var pendingLocalMemoryHash: String?
    @State private var restoredLocalMemoryHash: String?
    @State private var message = "选择此前导出的 JSON 或 .researcharchive bundle；先验证清单、SHA-256、PDF 与当前研究身份，不写数据库或覆盖现有内容。"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("恢复预检").font(.callout.weight(.semibold))
            Button("选择研究档案并验证") { isImporting = true }
                .buttonStyle(.bordered)
                .disabled(membership == nil)
                .accessibilityIdentifier("researchArchiveRestorePreviewButton")
            Text(message)
                .font(.caption)
                .foregroundStyle(preview == nil ? Color.secondary : Color.green)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchArchiveRestorePreviewMessage")
            if let preview {
                Text("\(preview.symbol) · membership #\(preview.membershipId) v\(preview.membershipVersion) · \(preview.componentNames.count) 项可验证内容 · \(preview.omittedComponents.count) 项未导出 · \(preview.exportedAt) · SHA \(preview.archiveSha256.prefix(12))…")
                    .font(.caption.monospacedDigit())
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchArchiveRestorePreviewIdentity")
                if pendingData != nil {
                    Button("确认恢复为本机只读历史档案", action: restore)
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("researchArchiveRestoreConfirmButton")
                }
            }
            if let restoredArchive {
                restoredHistory(restoredArchive)
            }
        }
        .fileImporter(
            isPresented: $isImporting,
            allowedContentTypes: [.json, .folder],
            allowsMultipleSelection: false,
            onCompletion: inspect
        )
        .task(id: membership.map { "\($0.id):\($0.version):\($0.state.rawValue):\($0.symbol)" } ?? "none") {
            pendingDeleteHash = nil
            pendingLocalMemoryHash = nil
            restoredLocalMemoryHash = nil
            restoredArchive = membership.flatMap { try? loadRestoredResearchArchive(membership: $0) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchArchiveRestorePreviewSection")
    }

    @ViewBuilder
    private func restoredHistory(_ restoredArchive: RestoredResearchArchive) -> some View {
        let filename = "\(restoredArchive.preview.symbol)-restored-\(restoredArchive.preview.archiveSha256.prefix(12)).json"
        DisclosureGroup("已恢复的只读历史档案") {
            Text(restoredArchive.preview.componentNames.joined(separator: "、"))
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            Text("只供本机历史核对，不会替换当前研究、报告、决定或复盘。")
                .font(.caption)
                .foregroundStyle(.secondary)
            if restoredArchive.preview.componentNames.contains(where: {
                ["localRecord", "localRecordDeletion", "localReviewKnowledge", "temporaryConversation"].contains($0)
            }) {
                Button(action: { restoreMemory(restoredArchive) }) {
                    Label(localMemoryButtonTitle(restoredArchive), systemImage: "arrow.clockwise.icloud")
                }
                .buttonStyle(.bordered)
                .disabled(restoredLocalMemoryHash == restoredArchive.preview.archiveSha256)
                .accessibilityIdentifier("researchArchiveRestoreLocalMemory")
            }
            ScrollView(.horizontal) {
                Text(String(decoding: restoredArchive.data, as: UTF8.self))
                    .font(.caption2.monospaced())
                    .textSelection(.enabled)
            }
            ShareLink(
                item: ResearchArchiveExportDocument(data: restoredArchive.data, filename: filename),
                subject: Text("\(restoredArchive.preview.symbol) 已恢复研究档案"),
                message: Text("本机只读历史档案；不替换当前研究或服务器事实。"),
                preview: SharePreview(filename)
            ) {
                Label("导出这份已恢复档案", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.bordered)
            Button(role: .destructive, action: deleteRestoredArchive) {
                Label(
                    pendingDeleteHash == restoredArchive.preview.archiveSha256
                        ? "再次点击确认删除本机副本"
                        : "删除这份本机恢复副本",
                    systemImage: "trash"
                )
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchArchiveRestoredDelete")
        }
        .accessibilityIdentifier("researchArchiveRestoredHistory")
    }

    private func localMemoryButtonTitle(_ archive: RestoredResearchArchive) -> String {
        if restoredLocalMemoryHash == archive.preview.archiveSha256 { return "本机 ASSIST 记忆已应用" }
        if pendingLocalMemoryHash == archive.preview.archiveSha256 { return "再次确认应用本机 ASSIST 记忆" }
        return "应用本机 ASSIST 记忆与临时对话"
    }

    private func inspect(_ result: Result<[URL], Error>) {
        preview = nil
        pendingData = nil
        pendingLocalMemoryHash = nil
        restoredLocalMemoryHash = nil
        do {
            let urls = try result.get()
            guard urls.count == 1, let url = urls.first, let membership else {
                throw ResearchArchiveExportError.invalidArchive
            }
            let hasAccess = url.startAccessingSecurityScopedResource()
            defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
            let data = try readResearchArchiveBackup(at: url)
            let inspected = try inspectResearchArchiveForRestore(data)
            guard inspected.matches(membership) else { throw ResearchArchiveExportError.invalidArchive }
            preview = inspected
            pendingData = data
            message = "恢复预检通过：容器、逐项哈希和当前研究身份一致。请明确确认后保存为本机只读历史档案。"
        } catch {
            message = "恢复预检失败：档案损坏、身份不一致或不是当前版本；未读取旧成功，也未写入任何数据。"
        }
    }

    private func restore() {
        guard let membership, let pendingData else { return }
        do {
            let restored = try restoreResearchArchive(pendingData, membership: membership)
            restoredArchive = restored
            preview = restored.preview
            self.pendingData = nil
            pendingDeleteHash = nil
            pendingLocalMemoryHash = nil
            restoredLocalMemoryHash = nil
            message = "研究档案已恢复为本机只读历史副本并完成重新读取；当前研究和服务器事实未被覆盖。"
        } catch {
            restoredArchive = nil
            message = "恢复失败：写入后的档案未通过身份或哈希重读；未显示旧恢复成功。"
        }
    }

    private func restoreMemory(_ archive: RestoredResearchArchive) {
        let hash = archive.preview.archiveSha256
        guard pendingLocalMemoryHash == hash else {
            pendingLocalMemoryHash = hash
            message = "再次点击确认：先保存并重读当前本机保护快照，再恢复档案里的本机记录、复盘知识与当前 exact report 临时对话；不会写 API、数据库或正式事实。"
            return
        }
        do {
            try restoreLocalMemory(archive)
            pendingLocalMemoryHash = nil
            restoredLocalMemoryHash = hash
            message = "当前保护快照已保存；本机 ASSIST 记录、复盘知识与临时对话已恢复并重新读取，仍不会写服务器或正式事实。"
        } catch {
            pendingLocalMemoryHash = nil
            restoredLocalMemoryHash = nil
            message = "本机 ASSIST 记忆恢复失败：当前身份已变化、目标位置已有内容或重读未通过；没有覆盖现有本机内容。"
        }
    }

    private func deleteRestoredArchive() {
        guard let membership, let restoredArchive else { return }
        let hash = restoredArchive.preview.archiveSha256
        guard pendingDeleteHash == hash else {
            pendingDeleteHash = hash
            message = "再次点击确认：只删除这份 App 内本机恢复副本；此前导出到 Files、云盘或其他备份位置的副本不受影响。"
            return
        }
        do {
            self.restoredArchive = try deleteRestoredResearchArchive(restoredArchive, membership: membership)
            pendingDeleteHash = nil
            pendingLocalMemoryHash = nil
            message = "本机恢复副本已删除并完成重新读取；外部导出副本和已明确恢复的本机 ASSIST 记忆不受影响。"
        } catch {
            self.restoredArchive = nil
            message = "本机恢复副本删除后的重读失败；旧恢复成功已清除。"
        }
    }
}
