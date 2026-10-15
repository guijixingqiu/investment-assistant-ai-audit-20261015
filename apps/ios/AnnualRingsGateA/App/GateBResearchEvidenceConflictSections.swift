import SwiftUI

extension GateBResearchScreen {
    var currentEvidenceConflictMaterials: [ResearchMaterialData] {
        (frozenResearchEvidenceWorkspace.envelope?.data?.materials ?? [])
            .filter {
                $0.revisionState == "current"
                    && ["conflict", "rejected"].contains($0.verificationStatus)
            }
            .sorted { (Int($0.id) ?? 0) > (Int($1.id) ?? 0) }
    }

    @ViewBuilder
    func researchEvidenceConflictSection() -> some View {
        let materials = currentEvidenceConflictMaterials
        if !materials.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("证据冲突待处置")
                    .font(.headline)
                Text("这些是当前版本仍冲突或已拒绝的材料；历史和已被替代材料不会出现在这里。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(materials) { material in
                    researchEvidenceConflictCard(material)
                }
            }
            .padding(12)
            .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("researchEvidenceConflicts")
        }
    }

    @ViewBuilder
    private func researchEvidenceConflictCard(_ material: ResearchMaterialData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(
                material.verificationStatus == "conflict"
                    ? "当前证据存在冲突，研究继续阻塞"
                    : "当前证据已拒绝，不能进入新证据包",
                systemImage: "exclamationmark.triangle.fill"
            )
            .font(.callout.weight(.semibold))
            .foregroundStyle(.orange)
            Text(material.summary)
                .font(.body.weight(.semibold))
            Text("下一步：重新核对精确来源，添加同一来源的新版本，或明确继续待核。")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                if material.citation != nil || material.sourceUrl?.exactHTTPSURL != nil {
                    Button {
                        Task { await openEvidenceConflictSource(material) }
                    } label: {
                        Label(
                            material.citation == nil ? "重开 HTTPS 来源" : "重开 PDF 原页",
                            systemImage: material.citation == nil ? "safari" : "doc.text.magnifyingglass"
                        )
                    }
                    .buttonStyle(.bordered)
                }
                if evidenceConflictCanAddReplacement(material) {
                    Button {
                        Task { await prepareEvidenceConflictReplacement(material) }
                    } label: {
                        Label("添加替代证据", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.borderedProminent)
                }
                Button("继续待核") {
                    Task { await keepEvidenceConflictPending(material) }
                }
                .buttonStyle(.bordered)
            }
            .disabled(evidenceConflictOperationIsBusy)
            DisclosureGroup("来源与当前身份") {
                InfoBlock(
                    title: "当前材料",
                    value: "material=\(material.id) · evidence=\(material.evidenceId) · revision=\(material.revision) · \(material.verificationStatus)",
                    valueIdentifier: "evidenceConflictIdentity-\(material.id)"
                )
                InfoBlock(
                    title: "来源",
                    value: "type=\(material.sourceType) · version=\(material.sourceVersion) · URL=\(material.sourceUrl ?? "无")",
                    valueIdentifier: "evidenceConflictSource-\(material.id)"
                )
            }
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchEvidenceConflict-\(material.id)")
    }

    @MainActor
    func freshCurrentEvidenceConflict(
        matching material: ResearchMaterialData
    ) async -> ResearchMaterialData? {
        guard let membership = selectedMembership,
              membership.state != .archived else {
            failClosedEvidenceConflict("membership、版本或当前冲突材料已变化；旧成功态已清除。")
            return nil
        }
        guard currentEvidenceConflictMaterials.contains(material) else { return nil }
        let authorizationRevision = viewModel.authorizationRevision
        let context = AppEnvironment.researchAuthorizationContext()
        let revision = frozenResearchEvidenceWorkspace.requests.beginLoad()
        frozenResearchEvidenceWorkspace.envelope = nil
        defer { frozenResearchEvidenceWorkspace.requests.finishLoad(revision) }
        do {
            let fresh = try await client.fetchFrozenResearchEvidence(membership: membership)
            let matches = fresh.data?.materials.filter {
                $0 == material
                    && $0.revisionState == "current"
                    && ["conflict", "rejected"].contains($0.verificationStatus)
            } ?? []
            guard frozenResearchEvidenceWorkspace.requests.acceptsLoad(revision) else { return nil }
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == context,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.state == membership.state,
                  selectedMembership?.actorId == membership.actorId,
                  parsedSymbol?.canonical == membership.symbol,
                  matches.count == 1 else {
                failClosedEvidenceConflict("membership、actor、版本、授权或材料来源已变化；旧冲突成功态已清除。")
                return nil
            }
            frozenResearchEvidenceWorkspace.envelope = fresh
            frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: nil)
            invalidateTwoLayerReport("已 fresh read 当前冲突材料；旧报告与正式动作已清除，请重新读取。")
            frozenResearchEvidenceWorkspace.message = "已 fresh read 当前冲突材料 #\(material.id)。"
            return matches[0]
        } catch {
            guard frozenResearchEvidenceWorkspace.requests.acceptsLoad(revision) else { return nil }
            failClosedEvidenceConflict(evidenceConflictFailureMessage(error))
            return nil
        }
    }

    @MainActor
    func freshResearchDocumentReplacementForWrite(
        _ replacement: ResearchMaterialData?,
        revision: UUID,
        operation: ResearchDocumentOperationIdentity
    ) async -> Bool {
        guard let replacement else { return true }
        guard await freshCurrentEvidenceConflict(matching: replacement) == replacement else { return false }
        guard researchDocumentWorkspace.requestRevision == revision,
              researchDocumentWorkspace.replacementMaterial == replacement,
              operation.matches(
                membership: selectedMembership,
                documentId: selectedResearchDocument?.id,
                pageNumber: Int(researchDocumentWorkspace.pageNumberText)
              ) else {
            failClosedEvidenceConflict("替代证据 POST 前 membership、actor、PDF 页或来源已变化；旧成功态已清除。")
            return false
        }
        return true
    }

    @MainActor
    func freshResearchEventReplacementForWrite(
        _ replacement: ResearchMaterialData?,
        membership: CandidateMembershipData,
        fingerprint: String
    ) async -> Bool {
        guard let replacement else { return true }
        guard await freshCurrentEvidenceConflict(matching: replacement) == replacement else { return false }
        guard selectedMembership == membership,
              researchEventDraft.replacementMaterial == replacement,
              fingerprint == "\(membership.id)|\(membership.version)|\(researchEventDraft.fingerprint)" else {
            failClosedEvidenceConflict("替代事件 POST 前 membership、actor、表单或来源已变化；旧成功态已清除。")
            return false
        }
        return true
    }

    @MainActor
    private func openEvidenceConflictSource(_ material: ResearchMaterialData) async {
        researchDocumentWorkspace.pdfPresentation = nil
        guard let fresh = await freshCurrentEvidenceConflict(matching: material) else { return }
        if let citation = fresh.citation {
            await loadResearchDocuments()
            let matches = researchDocumentWorkspace.list?.materials.filter { $0 == fresh } ?? []
            guard currentEvidenceConflictMaterials.contains(fresh),
                  matches.count == 1,
                  let document = researchDocumentWorkspace.list?.documents.first(where: {
                      $0.id == citation.documentId
                  }) else {
                failClosedEvidenceConflict("PDF 来源、页或材料身份已变化；旧 PDF 页与 pack/report 已清除。")
                return
            }
            researchDocumentWorkspace.selectedDocumentId = document.id
            researchDocumentWorkspace.pageNumberText = String(citation.pageNumber)
            await openPersistedResearchDocumentCitation(document: document, material: fresh)
            if researchDocumentWorkspace.pdfPresentation == nil {
                failClosedEvidenceConflict("PDF 页或内容身份重新核对失败；旧冲突成功态已清除。")
            }
            return
        }
        guard let url = fresh.sourceUrl?.exactHTTPSURL else {
            frozenResearchEvidenceWorkspace.message = "当前材料没有唯一安全的 HTTPS 或 PDF 来源；未选择替代来源。"
            return
        }
        openURL(url)
        frozenResearchEvidenceWorkspace.message = "已重新核对 current material 与 HTTPS 来源后交给系统打开。"
    }

    @MainActor
    private func prepareEvidenceConflictReplacement(_ material: ResearchMaterialData) async {
        guard let fresh = await freshCurrentEvidenceConflict(matching: material) else { return }
        if let citation = fresh.citation {
            await loadResearchDocuments()
            let matches = researchDocumentWorkspace.list?.materials.filter { $0 == fresh } ?? []
            guard currentEvidenceConflictMaterials.contains(fresh),
                  matches.count == 1,
                  researchDocumentWorkspace.list?.documents.contains(where: {
                      $0.id == citation.documentId
                  }) == true else {
                failClosedEvidenceConflict("PDF 材料、文档或页身份已变化；替代入口已清除。")
                return
            }
            researchDocumentWorkspace.replacementMaterial = fresh
            researchDocumentWorkspace.selectedDocumentId = citation.documentId
            researchDocumentWorkspace.pageNumberText = String(citation.pageNumber)
            researchDocumentWorkspace.selectedPage = nil
            researchDocumentWorkspace.confirmation = nil
            researchDocumentWorkspace.quote = ""
            researchDocumentWorkspace.statement = ""
            researchDocumentWorkspace.confirmReservation.clear()
            researchEventDraft.reset(preserving: "")
            researchEventMaterialReservation.clear()
            researchEventBindingReservation.clear()
            researchDocumentWorkspace.message = "已绑定替代材料 #\(fresh.id)；请选择同类 PDF 的新版本或新页并再次明确确认。"
            selectedEvidenceWorkspace = .documents
            pendingDecisionWorkspaceScrollTarget = "researchDocumentsWorkspaceAnchor"
            return
        }
        guard fresh.sourceUrl?.exactHTTPSURL != nil, let publication = fresh.publishedAt,
              let publishedAt = evidenceConflictDate(publication),
              ["user_provided", "authorized_public"].contains(fresh.rightsStatus) else {
            failClosedEvidenceConflict("当前材料没有可复用的安全 HTTPS 来源或写入权利；未创建替代草稿。")
            return
        }
        var draft = ResearchEventCaptureDraft()
        draft.title = fresh.title
        draft.sourceURL = fresh.sourceUrl ?? ""
        draft.publishedAt = publishedAt
        draft.validUntil = evidenceConflictDate(fresh.validUntil)
            ?? Date().addingTimeInterval(90 * 24 * 60 * 60)
        let boundEventKinds = (frozenResearchEvidenceWorkspace.envelope?.data?.events ?? [])
            .filter { $0.source.materialId == fresh.id }
            .map(\.eventKind)
        draft.eventKind = boundEventKinds.count == 1
            ? boundEventKinds[0]
            : ResearchEventCaptureDraft.eventKind(forSourceType: fresh.sourceType) ?? "announcement"
        let variables = envelope.data?.profile.keyVariables ?? []
        draft.variableName = fresh.variableName.flatMap {
            variables.contains($0) ? $0 : nil
        } ?? variables.first ?? ""
        draft.stance = fresh.stance
        draft.reliability = fresh.reliability ?? 3
        draft.materiality = fresh.materiality ?? 3
        draft.replacementMaterial = fresh
        researchDocumentWorkspace.replacementMaterial = nil
        researchEventDraft = draft
        researchEventMaterialReservation.clear()
        researchEventBindingReservation.clear()
        researchEventMessage = "已绑定替代材料 #\(fresh.id) 并锁定来源；请填写新来源版本、新摘要与发布时间，再明确核对和保存。"
        isResearchEventCaptureExpanded = true
        pendingDecisionWorkspaceScrollTarget = "researchAnnouncementEvents"
    }

    @MainActor
    private func keepEvidenceConflictPending(_ material: ResearchMaterialData) async {
        guard let fresh = await freshCurrentEvidenceConflict(matching: material) else { return }
        frozenResearchEvidenceWorkspace.message = "材料 #\(fresh.id) 继续待核；没有写服务器状态，研究仍被阻塞。下一步请核对原始来源或添加同来源的新版本。"
    }

    @MainActor
    func failClosedEvidenceConflict(_ message: String) {
        frozenResearchEvidenceWorkspace.clear(message)
        researchDocumentWorkspace.clearForIdentityChange(researchDocumentWorkspace.identity ?? "")
        resetResearchEventCapture(message)
        researchDocumentWorkspace.message = message
        invalidateTwoLayerReport("证据冲突来源已变化；旧 pack/report 成功态已清除。")
    }

    private var evidenceConflictOperationIsBusy: Bool {
        frozenResearchEvidenceWorkspace.isBusy || researchDocumentWorkspace.isBusy || isSavingResearchEvent
    }

    private func evidenceConflictCanAddReplacement(_ material: ResearchMaterialData) -> Bool {
        material.citation != nil
            || material.sourceUrl?.exactHTTPSURL != nil
                && ["user_provided", "authorized_public"].contains(material.rightsStatus)
    }

    private func evidenceConflictFailureMessage(_ error: Error) -> String {
        if case FrozenResearchEvidenceClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403: return "授权已变化；旧冲突成功态与替代入口已清除。"
            case 404: return "当前 membership 或材料已不存在；旧成功态已清除。"
            case 409: return "membership、版本或材料来源冲突；请 fresh read 后重试。"
            default: return "冲突材料服务不可用；旧成功态已清除。"
            }
        }
        return "冲突材料响应 malformed 或网络离线；旧成功态已清除。"
    }

    private func evidenceConflictDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
