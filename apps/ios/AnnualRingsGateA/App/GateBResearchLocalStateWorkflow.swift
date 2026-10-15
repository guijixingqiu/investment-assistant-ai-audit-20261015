import SwiftUI

extension GateBResearchScreen {
    func localRecordBinding(_ keyPath: WritableKeyPath<AssistMobileWorkspaceLocalRecordDrafts, String>) -> Binding<String> {
        Binding(
            get: {
                localRecordDrafts[keyPath: keyPath]
            },
            set: { value in
                localRecordClearConfirmationSourceSignature = nil
                localRecordSnapshotSummary = [
                    "Unsaved local-record draft: SwiftUI-memory-only until saving writes a validated source-scoped UserDefaults envelope."
                ]
                localRecordDrafts[keyPath: keyPath] = String(value.prefix(4000))
                localRecordMessage = "本地记录草稿只在当前界面变化；点击保存后才写入本机 UserDefaults。"
            }
        )
    }

    func currentLocalRecordSourceSignature() -> String {
        guard let selectedMembership else { return "unavailable" }
        return assistMobileWorkspaceLocalRecordSourceSignature(
            selectedMembership: selectedMembership,
            decisionContext: decisionContext,
            followUpWorkflow: reviewFollowUpWorkflowModel,
            decisionNoteWorkflow: decisionNoteWorkflowModel
        )
    }

    @MainActor
    func saveLocalRecord(sourceSignature: String) {
        localRecordClearConfirmationSourceSignature = nil
        guard sourceSignature != "unavailable", let selectedMembership else {
            localRecordDrafts = .empty
            localRecordSnapshotSummary = []
            localRecordEnvelopeId = nil
            localRecordEnvelopeSourceSignature = nil
            localRecordMessage = "本地记录保存被阻止：当前事实来源不可用，旧记录不会展示。"
            return
        }
        guard currentLocalRecordSourceSignature() == sourceSignature else {
            localRecordDrafts = .empty
            localRecordSnapshotSummary = []
            localRecordEnvelopeId = nil
            localRecordEnvelopeSourceSignature = nil
            localRecordMessage = "本地记录保存被阻止：source signature 已变化，旧草稿已清除。"
            return
        }
        let defaults = viewModel.localDefaults
        do {
            let envelope = try assistMobileWorkspaceBuildLocalRecordEnvelope(
                sourceSignature: sourceSignature,
                selectedMembership: selectedMembership,
                decisionContext: decisionContext,
                followUpWorkflow: reviewFollowUpWorkflowModel,
                decisionNoteWorkflow: decisionNoteWorkflowModel,
                fields: localRecordDrafts,
                nowIso: ISO8601DateFormatter().string(from: Date())
            )
            let data = try JSONEncoder().encode(envelope)
            guard let raw = String(data: data, encoding: .utf8) else {
                throw AssistMobileWorkspaceLocalRecordValidationError.invalid(["encoded local record must be UTF-8"])
            }
            defaults.set(raw, forKey: GateBLocalRecordStorage.envelopeKey(sourceSignature))
            guard defaults.string(forKey: GateBLocalRecordStorage.envelopeKey(sourceSignature)) == raw else { throw AssistMobileWorkspaceLocalRecordValidationError.invalid(["saved local record readback must match"]) }
            defaults.removeObject(forKey: GateBLocalRecordStorage.deletionKey(sourceSignature))
            guard defaults.object(forKey: GateBLocalRecordStorage.deletionKey(sourceSignature)) == nil else {
                throw AssistMobileWorkspaceLocalRecordValidationError.invalid(["deletion tombstone must clear after an explicit new save"])
            }
            GateBLocalRecordStorage.clearLegacyFields(defaults, sourceSignature: sourceSignature)
            localRecordDrafts = envelope.fields
            localRecordSnapshotSummary = assistMobileWorkspaceLocalRecordSnapshotSummary(envelope)
            localRecordEnvelopeId = envelope.recordId
            localRecordEnvelopeSourceSignature = envelope.sourceRef.sourceSignature
            localRecordMessage = "本地记录已保存为本机 UserDefaults envelope；非官方、不发送、不写服务器、不连券商、不构成组合事实。"
            scheduleResearchArchiveAutomaticBackup(ResearchArchiveAutomaticBackupTrigger(kind: .localMemory, identity: "local-record-\(envelope.recordId)-\(envelope.updatedAt)"), membership: selectedMembership)
        } catch {
            localRecordDrafts = .empty
            localRecordSnapshotSummary = []
            localRecordEnvelopeId = nil
            localRecordEnvelopeSourceSignature = nil
            localRecordMessage = "本地记录保存失败：envelope validation 未通过，旧显示已清除。"
        }
    }

    @MainActor
    func loadLocalRecord(sourceSignature: String) {
        localRecordClearConfirmationSourceSignature = nil
        guard sourceSignature != "unavailable" else {
            localRecordDrafts = .empty
            localRecordSnapshotSummary = []
            localRecordEnvelopeId = nil
            localRecordEnvelopeSourceSignature = nil
            localRecordMessage = "本地记录读取被阻止：当前事实来源不可用，旧记录不会展示。"
            return
        }
        let defaults = viewModel.localDefaults
        if defaults.string(forKey: GateBLocalRecordStorage.deletionKey(sourceSignature)) != nil {
            defaults.removeObject(forKey: GateBLocalRecordStorage.envelopeKey(sourceSignature))
            GateBLocalRecordStorage.clearLegacyFields(defaults, sourceSignature: sourceSignature)
            localRecordDrafts = .empty
            localRecordSnapshotSummary = []
            localRecordEnvelopeId = nil
            localRecordEnvelopeSourceSignature = nil
            localRecordMessage = "本地记录已由 Owner 删除；保留内容为空的本机 tombstone，旧归档或残留 envelope 不会恢复显示。"
            return
        }
        let result = assistMobileWorkspaceLoadLocalRecordEnvelope(
            raw: defaults.string(forKey: GateBLocalRecordStorage.envelopeKey(sourceSignature)),
            expectedSourceSignature: sourceSignature
        )
        localRecordDrafts = result.fields
        localRecordSnapshotSummary = result.envelope.map(assistMobileWorkspaceLocalRecordSnapshotSummary) ?? []
        localRecordEnvelopeId = result.envelope?.recordId
        localRecordEnvelopeSourceSignature = result.envelope?.sourceRef.sourceSignature
        localRecordMessage = result.message
        if result.state == .mismatch || result.state == .malformed {
            defaults.removeObject(forKey: GateBLocalRecordStorage.envelopeKey(sourceSignature))
            localRecordEnvelopeId = nil
            localRecordEnvelopeSourceSignature = nil
            localRecordMessage = "\(result.message) Rejected saved local record was removed from this device for the current source signature only."
        }
    }

    @MainActor
    func clearLocalRecord(sourceSignature: String) {
        if localRecordClearConfirmationSourceSignature != sourceSignature {
            localRecordClearConfirmationSourceSignature = sourceSignature
            localRecordMessage = sourceSignature == "unavailable"
                ? "再次点击清除本地记录，只清空当前界面显示的本地记录草稿；没有当前 source signature，因此不会复用任何旧记录。"
                : "再次点击清除本地记录，将只删除当前 source signature 的本机 UserDefaults envelope；不会删除 API 事实或官方 review history。"
            return
        }
        localRecordClearConfirmationSourceSignature = nil
        if sourceSignature != "unavailable" {
            let defaults = viewModel.localDefaults
            let deletedAt = ISO8601DateFormatter().string(from: Date())
            defaults.set(deletedAt, forKey: GateBLocalRecordStorage.deletionKey(sourceSignature))
            guard defaults.string(forKey: GateBLocalRecordStorage.deletionKey(sourceSignature)) == deletedAt else {
                localRecordMessage = "本地记录删除失败：无法持久化删除 tombstone，原记录未删除。"
                return
            }
            defaults.removeObject(forKey: GateBLocalRecordStorage.envelopeKey(sourceSignature))
            GateBLocalRecordStorage.clearLegacyFields(defaults, sourceSignature: sourceSignature)
            localRecordMessage = "本地记录显示已清除；正文已删除，并保留当前 source signature 的内容为空 tombstone，旧归档不会复活该记录。已启用关键动作自动备份时会保存删除后状态。"
            if let membership = selectedMembership {
                scheduleResearchArchiveAutomaticBackup(
                    .deletion("local-record-\(sourceSignature)-\(deletedAt)"),
                    membership: membership
                )
            }
        } else {
            localRecordMessage = "本地记录显示已清除；没有当前 source signature，因此未触碰任何已保存的 UserDefaults envelope。"
        }
        localRecordDrafts = .empty
        localRecordSnapshotSummary = []
        localRecordEnvelopeId = nil
        localRecordEnvelopeSourceSignature = nil
    }
#if false
    func reviewKnowledgeBinding(_ keyPath: WritableKeyPath<AssistReviewKnowledgeFields, String>) -> Binding<String> {
        Binding(
            get: { reviewKnowledgeFields[keyPath: keyPath] },
            set: { value in
                reviewKnowledgeFields[keyPath: keyPath] = String(value.prefix(4000))
                reviewKnowledgeClearConfirmationId = nil
                reviewKnowledgeInvalidCollectionConfirmationSymbol = nil
                reviewKnowledgeMessage = "复盘知识草稿只在当前界面变化；保存后才写入本机 UserDefaults。"
            }
        )
    }
#endif
    var reviewKnowledgeFieldsValue: AssistReviewKnowledgeFields {
        AssistReviewKnowledgeFields(
            evidenceLesson: reviewKnowledgeEvidenceLesson,
            processLesson: reviewKnowledgeProcessLesson,
            unresolvedQuestion: reviewKnowledgeUnresolvedQuestion,
            uncertaintyNote: reviewKnowledgeUncertaintyNote
        )
    }

    func clearReviewKnowledgeFields() {
        reviewKnowledgeEvidenceLesson = ""
        reviewKnowledgeProcessLesson = ""
        reviewKnowledgeUnresolvedQuestion = ""
        reviewKnowledgeUncertaintyNote = ""
    }
    func currentReviewKnowledgeSourceSignature() -> String? {
        let signature = currentLocalRecordSourceSignature()
        return signature == "unavailable" ? nil : signature
    }

    func currentReviewKnowledgeIdentity() -> AssistReviewKnowledgeCurrentIdentity? {
        guard let membership = selectedMembership,
              parsedSymbol?.canonical == membership.symbol,
              let sourceSignature = currentReviewKnowledgeSourceSignature(),
              let context = decisionContext,
              context.requestedSymbol == membership.symbol,
              !context.contextId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !context.contextHash.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              reviewFollowUpWorkflowModel.membershipId == membership.id,
              reviewFollowUpWorkflowModel.symbol == membership.symbol,
              decisionNoteWorkflowModel.membershipId == membership.id,
              decisionNoteWorkflowModel.symbol == membership.symbol else {
            return nil
        }
        return AssistReviewKnowledgeCurrentIdentity(
            symbol: membership.symbol,
            membershipId: membership.id,
            membershipVersion: membership.version,
            sourceSignature: sourceSignature,
            decisionContextId: context.contextId,
            decisionContextHash: context.contextHash
        )
    }

    @MainActor
    func clearReviewKnowledgeDisplay(_ message: String) {
        clearReviewKnowledgeFields()
        reviewKnowledgeEntries = []
        reviewKnowledgeLoadState = .missing
        reviewKnowledgeMessage = message
        selectedReviewKnowledgeId = nil
        reviewKnowledgeLineageMode = .newEntry
        reviewKnowledgeClearConfirmationId = nil
        reviewKnowledgeInvalidCollectionConfirmationSymbol = nil
    }

    @MainActor
    @discardableResult
    func loadReviewKnowledgeForSelectedCandidate() -> Bool {
        guard let membership = selectedMembership,
              let currentIdentity = currentReviewKnowledgeIdentity(),
              currentIdentity.membershipId == membership.id,
              currentIdentity.symbol == membership.symbol else {
            clearReviewKnowledgeDisplay("本地复盘知识读取被阻止：当前候选成员和来源身份不可用，未读取 UserDefaults，旧显示已清除。")
            reviewKnowledgeLoadState = .sourceUnavailable
            return false
        }
        let result = assistReviewKnowledgeLoad(
            storage: viewModel.reviewKnowledgeStorage,
            symbol: membership.symbol,
            currentIdentity: currentIdentity
        )
        guard result.ok else {
            clearReviewKnowledgeDisplay(result.message)
            reviewKnowledgeLoadState = result.state
            return false
        }
        reviewKnowledgeLoadState = result.state
        reviewKnowledgeEntries = result.entries
        reviewKnowledgeMessage = result.message
        reviewKnowledgeClearConfirmationId = nil
        reviewKnowledgeInvalidCollectionConfirmationSymbol = nil
        let visibleEntries = result.entries.filter { !$0.envelope.isDeletionTombstone }
        if let selectedReviewKnowledgeId,
           visibleEntries.contains(where: { $0.envelope.knowledgeId == selectedReviewKnowledgeId }) {
            return true
        }
        selectedReviewKnowledgeId = visibleEntries.first?.envelope.knowledgeId
        if visibleEntries.isEmpty { reviewKnowledgeLineageMode = .newEntry }
        return true
    }

    @MainActor
    func saveReviewKnowledge(sourceSignature: String) {
        reviewKnowledgeClearConfirmationId = nil
        reviewKnowledgeInvalidCollectionConfirmationSymbol = nil
        guard let membership = selectedMembership,
              let currentIdentity = currentReviewKnowledgeIdentity(),
              currentIdentity.symbol == membership.symbol,
              currentIdentity.membershipId == membership.id,
              currentIdentity.membershipVersion == membership.version,
              currentIdentity.sourceSignature == sourceSignature else {
            clearReviewKnowledgeDisplay("复盘知识保存被阻止：当前 source signature 不可用或已变化，草稿已清除。")
            reviewKnowledgeLoadState = .mismatch
            return
        }
        guard !reviewKnowledgeFieldsValue.isEmpty else {
            reviewKnowledgeMessage = "至少填写一项复盘知识后才能保存。"
            return
        }
        let selectedTargetId = selectedReviewKnowledgeId.flatMap { selectedId in
            reviewKnowledgeEntries.contains(where: { $0.envelope.knowledgeId == selectedId && !$0.envelope.isDeletionTombstone }) ? selectedId : nil
        }
        if reviewKnowledgeLineageMode != .newEntry && selectedTargetId == nil {
            reviewKnowledgeMessage = "纠正或替换保存冲突：所选历史条目已不存在，请重新读取集合。"
            reviewKnowledgeLoadState = .mismatch
            return
        }

        let references = currentReviewKnowledgeReferences(for: membership.symbol)
        let correctionId = reviewKnowledgeLineageMode == .correction || reviewKnowledgeLineageMode == .correctionAndReplacement
            ? selectedTargetId
            : nil
        let replacesId = reviewKnowledgeLineageMode == .replacement || reviewKnowledgeLineageMode == .correctionAndReplacement
            ? selectedTargetId
            : nil
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let localRecordId = localRecordEnvelopeSourceSignature == sourceSignature ? localRecordEnvelopeId : nil

        do {
            let saved = try assistReviewKnowledgeSave(
                storage: viewModel.reviewKnowledgeStorage,
                input: AssistReviewKnowledgeBuildInput(
                    symbol: membership.symbol,
                    membershipId: membership.id,
                    membershipVersion: membership.version,
                    sourceSignature: sourceSignature,
                    decisionContextId: currentIdentity.decisionContextId,
                    decisionContextHash: currentIdentity.decisionContextHash,
                    localRecordId: localRecordId,
                    reviewHistoryAsOf: references.asOf,
                    decisionCheckIds: references.checkIds,
                    postDecisionReviewIds: references.reviewIds,
                    snapshotAvailability: references.snapshotAvailability,
                    correctionOfKnowledgeId: correctionId,
                    replacesKnowledgeId: replacesId,
                    fields: reviewKnowledgeFieldsValue,
                    nowIso: formatter.string(from: Date())
                ),
                currentIdentity: currentIdentity
            )
            clearReviewKnowledgeFields()
            reviewKnowledgeLineageMode = .newEntry
            let reloaded = assistReviewKnowledgeLoad(
                storage: viewModel.reviewKnowledgeStorage,
                symbol: membership.symbol,
                currentIdentity: currentIdentity
            )
            reviewKnowledgeEntries = reloaded.entries
            reviewKnowledgeLoadState = reloaded.state
            guard reloaded.ok else {
                clearReviewKnowledgeDisplay("复盘知识写入后读取验证失败：\(reloaded.message) 旧显示已清除，未宣称保存成功。")
                reviewKnowledgeLoadState = reloaded.state
                return
            }
            selectedReviewKnowledgeId = saved.entry.knowledgeId
            reviewKnowledgeMessage = references.omissionMessage.map {
                "本地复盘知识已保存；\($0) 条目仍是非官方本机历史辅助。"
            } ?? "本地复盘知识已保存；官方复核仅记录 ID 引用，未复制事实，不上传 API、不写数据库、不改变候选顺序。"
            scheduleResearchArchiveAutomaticBackup(ResearchArchiveAutomaticBackupTrigger(kind: .localMemory, identity: "knowledge-\(saved.entry.knowledgeId)-\(saved.entry.updatedAt)"), membership: membership)
        } catch AssistReviewKnowledgeMutationError.conflict(let message) {
            clearReviewKnowledgeDisplay("复盘知识保存冲突：\(message) 旧显示已清除，请重新读取。")
            reviewKnowledgeLoadState = .mismatch
        } catch AssistReviewKnowledgeMutationError.storageUnavailable(let message) {
            clearReviewKnowledgeDisplay("复盘知识存储不可用：\(message)。旧显示已清除。")
            reviewKnowledgeLoadState = .storageUnavailable
        } catch {
            clearReviewKnowledgeDisplay("复盘知识保存失败：payload validation 未通过，旧显示已清除。")
            reviewKnowledgeLoadState = .malformed
        }
    }

    func currentReviewKnowledgeReferences(for symbol: String) -> (
        asOf: String?,
        checkIds: [String],
        reviewIds: [String],
        snapshotAvailability: AssistReviewKnowledgeSnapshotAvailability,
        omissionMessage: String?
    ) {
        guard let history = decisionReviewHistory, history.requestedSymbol == symbol else {
            return (nil, [], [], .notReferenced, "当前没有可验证的官方复核历史，因此没有保存 review ID 引用。")
        }
        let checkIds = history.checks.map(\.id)
        let reviewIds = history.checks.flatMap { $0.reviews.map(\.id) }
        guard !checkIds.isEmpty || !reviewIds.isEmpty else {
            return (nil, [], [], .notReferenced, "官方复核历史为空，因此没有保存 review ID 引用。")
        }
        guard let asOf = history.metadata.asOf ?? history.metadata.fetchedAt else {
            return (nil, [], [], .notReferenced, "官方复核历史缺少 as-of/fetched-at，已失败关闭并省略全部 review ID 引用。")
        }
        let snapshotAvailability: AssistReviewKnowledgeSnapshotAvailability = history.checks.allSatisfy {
            $0.contextSnapshot.availability == .preserved
        } ? .preserved : .partiallyUnavailable
        return (asOf, checkIds, reviewIds, snapshotAvailability, nil)
    }
    @MainActor
    func selectReviewKnowledgeEntry(_ entry: AssistReviewKnowledgeViewEntry) {
        selectedReviewKnowledgeId = entry.envelope.knowledgeId
        reviewKnowledgeClearConfirmationId = nil
        reviewKnowledgeInvalidCollectionConfirmationSymbol = nil
        reviewKnowledgeMessage = "已读取所选本地历史条目；内容未写入当前草稿，也未被当作当前事实复用。"
    }

    @MainActor
    func clearSelectedReviewKnowledgeEntry() async {
        guard let membership = selectedMembership,
              let currentIdentity = currentReviewKnowledgeIdentity(),
              let knowledgeId = selectedReviewKnowledgeId,
              reviewKnowledgeEntries.contains(where: { $0.envelope.knowledgeId == knowledgeId && !$0.envelope.isDeletionTombstone }) else {
            clearReviewKnowledgeDisplay("清除冲突：所选本地条目已不存在，旧显示已清除，请重新读取。")
            reviewKnowledgeLoadState = .mismatch
            return
        }
        if reviewKnowledgeClearConfirmationId != knowledgeId {
            reviewKnowledgeClearConfirmationId = knowledgeId
            reviewKnowledgeMessage = "再次点击“删除所选正文”确认；正文将从界面和本机知识上下文移除，只保留无正文删除记录。官方 review、API 事实和其他条目不变。"
            return
        }
        reviewKnowledgeClearConfirmationId = nil
        do {
            _ = try assistReviewKnowledgeClearEntry(
                storage: viewModel.reviewKnowledgeStorage,
                symbol: membership.symbol,
                knowledgeId: knowledgeId,
                currentIdentity: currentIdentity
            )
            guard loadReviewKnowledgeForSelectedCandidate() else { return }
            guard reviewKnowledgeEntries.contains(where: { $0.envelope.knowledgeId == knowledgeId && $0.envelope.isDeletionTombstone }) else {
                clearReviewKnowledgeDisplay("复盘知识删除后的读取身份不匹配；旧显示已清除，未宣称删除完成。")
                reviewKnowledgeLoadState = .mismatch
                return
            }
            reviewKnowledgeMessage =
                "所选本地复盘知识正文已删除并完成重新读取；仅保留无正文删除记录。已启用关键动作自动备份时会保存删除后状态，也可显式点击“立即备份并验证”。此前备份副本仍可能含旧正文。"
            scheduleResearchArchiveAutomaticBackup(
                .deletion("knowledge-\(knowledgeId)"),
                membership: membership
            )
        } catch AssistReviewKnowledgeMutationError.storageUnavailable(let message) {
            clearReviewKnowledgeDisplay("复盘知识清除存储不可用：\(message)。旧显示已清除。")
            reviewKnowledgeLoadState = .storageUnavailable
        } catch {
            clearReviewKnowledgeDisplay("复盘知识清除冲突或集合无效；旧显示已清除，请重新读取或显式清除无效集合。")
            reviewKnowledgeLoadState = .mismatch
        }
    }

    @MainActor
    func clearInvalidReviewKnowledgeCollection() {
        guard let membership = selectedMembership,
              let currentIdentity = currentReviewKnowledgeIdentity(),
              currentIdentity.membershipId == membership.id,
              currentIdentity.symbol == membership.symbol else {
            clearReviewKnowledgeDisplay("无效集合清除被阻止：当前候选成员和来源身份不可用，未访问 UserDefaults。")
            reviewKnowledgeLoadState = .sourceUnavailable
            return
        }
        if reviewKnowledgeInvalidCollectionConfirmationSymbol != membership.symbol {
            reviewKnowledgeInvalidCollectionConfirmationSymbol = membership.symbol
            reviewKnowledgeMessage = "再次点击“清除无效本地集合”确认；只删除 \(membership.symbol) 的本机无效集合，不触碰 API 或官方 review。"
            return
        }
        do {
            try assistReviewKnowledgeClearCollection(
                storage: viewModel.reviewKnowledgeStorage,
                symbol: membership.symbol,
                currentIdentity: currentIdentity
            )
            clearReviewKnowledgeDisplay("\(membership.symbol) 的无效本地复盘知识集合已清除；未触碰任何官方事实。")
        } catch {
            clearReviewKnowledgeDisplay("无效本地集合清除失败：UserDefaults 不可用，旧显示保持清空。")
            reviewKnowledgeLoadState = .storageUnavailable
        }
    }

}
