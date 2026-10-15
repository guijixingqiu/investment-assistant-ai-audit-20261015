import Foundation

struct ResearchContextMembershipBinding: Equatable {
    let membershipId: String
    let membershipVersion: Int
    let symbol: String
    let actorId: String

    init(_ membership: CandidateMembershipData) {
        membershipId = membership.id
        membershipVersion = membership.version
        symbol = membership.symbol
        actorId = membership.actorId
    }
}

struct ResearchContextWorkspaceState {
    var envelope: ResearchContextEnvelope?
    var completeness: ResearchCompletenessEnvelope?
    var completenessMessage = "请先 fresh read 财务、KPI 与研究上下文覆盖。"
    var message = "请选择当前研究自选后读取行业与同业上下文。"
    var isLoading = false
    var isSaving = false
    var isLoadingCompleteness = false
    var isSavingCompleteness = false
    var isEditing = false
    var assistantDraft: String?
    var requestRevision = UUID()
    var saveRevision = UUID()
    var binding: ResearchContextMembershipBinding?
    var reservation = ResearchDocumentIdempotencyReservation()
    var completenessReservation = ResearchDocumentIdempotencyReservation()

    var isBusy: Bool { isLoading || isSaving || isLoadingCompleteness || isSavingCompleteness }

    mutating func begin(_ membership: CandidateMembershipData) -> UUID {
        let revision = UUID()
        requestRevision = revision
        binding = ResearchContextMembershipBinding(membership)
        envelope = nil
        completeness = nil
        isEditing = false
        assistantDraft = nil
        message = "正在读取行业与同业上下文..."
        isLoading = true
        isLoadingCompleteness = false
        return revision
    }

    mutating func rebind(
        to membership: CandidateMembershipData?,
        message: String
    ) {
        let incoming = membership.map(ResearchContextMembershipBinding.init)
        guard binding != incoming else { return }
        requestRevision = UUID()
        saveRevision = UUID()
        binding = incoming
        envelope = nil
        completeness = nil
        self.message = message
        isLoading = false
        isSaving = false
        isLoadingCompleteness = false
        isSavingCompleteness = false
        isEditing = false
        assistantDraft = nil
        reservation.clear()
        completenessReservation.clear()
    }

    mutating func clear(_ message: String) {
        requestRevision = UUID()
        saveRevision = UUID()
        binding = nil
        envelope = nil
        completeness = nil
        self.message = message
        isLoading = false
        isSaving = false
        isLoadingCompleteness = false
        isSavingCompleteness = false
        isEditing = false
        assistantDraft = nil
        reservation.clear()
        completenessReservation.clear()
    }

    func accepts(
        revision: UUID,
        requested membership: CandidateMembershipData,
        selected: CandidateMembershipData?,
        symbol: String?
    ) -> Bool {
        requestRevision == revision
            && binding == ResearchContextMembershipBinding(membership)
            && selected.map(ResearchContextMembershipBinding.init)
                == ResearchContextMembershipBinding(membership)
            && symbol == membership.symbol
    }

    mutating func beginSave() -> UUID {
        let revision = UUID()
        requestRevision = UUID()
        saveRevision = revision
        isLoading = false
        isSaving = true
        return revision
    }

    func hasAvailableContext(for membership: CandidateMembershipData?) -> Bool {
        guard let membership, membership.state != .archived else { return false }
        return binding == ResearchContextMembershipBinding(membership)
            && envelope?.status == .available
            && envelope?.membershipId == membership.id
            && envelope?.requestedActorId == membership.actorId
            && envelope?.requestedSymbol == membership.symbol
            && envelope?.data?.membershipVersion == membership.version
            && envelope?.data?.selectedSymbol == membership.symbol
    }
}

extension GateBResearchScreen {
    @MainActor
    func loadResearchContext(for membership: CandidateMembershipData) async {
        guard researchContextWorkspace.isSaving == false else { return }
        guard membership.state != .archived else {
            researchContextWorkspace.rebind(
                to: nil,
                message: "归档 membership 不读取行业与同业上下文；旧状态已清除。"
            )
            return
        }
        let revision = researchContextWorkspace.begin(membership)
        defer {
            if researchContextWorkspace.requestRevision == revision {
                researchContextWorkspace.isLoading = false
            }
        }
        do {
            let envelope = try await client.fetchResearchContext(membership: membership)
            guard researchContextWorkspace.accepts(
                revision: revision,
                requested: membership,
                selected: selectedMembership,
                symbol: parsedSymbol?.canonical
            ) else { return }
            researchContextWorkspace.envelope = envelope
            if let selected = twoLayerReportWorkspace.draft?.taskIntent?.selectedResearchContext,
               selected.contextId != envelope.data?.id || selected.contentHash != envelope.contentHash {
                twoLayerReportWorkspace.draft?.taskIntent?.selectedResearchContext = nil
                twoLayerReportWorkspace.draft?.taskIntent?.confirmProviderAuthorization(false)
                twoLayerReportWorkspace.message = "档案版本已变化，原勾选条目和发送确认已清除。"
#if OWNER_CLIENT
                personalFormalMaterialReviewed = false
                personalFormalReviewedMaterialBinding = nil
#endif
            }
            researchContextWorkspace.message = envelope.message
            await loadResearchCompleteness(for: membership)
        } catch {
            guard researchContextWorkspace.accepts(
                revision: revision,
                requested: membership,
                selected: selectedMembership,
                symbol: parsedSymbol?.canonical
            ) else { return }
            researchContextWorkspace.envelope = nil
            researchContextWorkspace.completeness = nil
            researchContextWorkspace.message = researchContextFailureMessage(error)
        }
    }

    @MainActor
    func saveResearchContext(_ draft: ResearchContextDraft) async {
        guard let envelope = researchContextWorkspace.envelope else {
            researchContextWorkspace.message = "请先读取当前研究档案。"
            return
        }
        let current = envelope.data
        let canCreateFirst = envelope.status == .notFound && envelope.history.isEmpty
        let canRebuild = current == nil && !envelope.history.isEmpty
            && researchContextWorkspace.isEditing
        guard current != nil || canCreateFirst || canRebuild else {
            researchContextWorkspace.message = "请先明确选择是否从当前 PDF 重新建立档案。"
            return
        }
        let baseContextId = current?.id ?? (canRebuild ? envelope.history.first?.id : nil)
        guard researchContextWorkspace.isSaving == false,
              let membership = selectedMembership,
              membership.state != .archived,
              researchContextWorkspace.binding == ResearchContextMembershipBinding(membership),
              let list = researchDocumentWorkspace.list,
              list.membershipId == membership.id,
              list.membershipVersion == membership.version,
              list.symbol == membership.symbol,
              let document = list.documents.first(where: {
                  $0.id == draft.documentId
                      && $0.membershipVersionAtImport == membership.version
                      && $0.isSourceAvailable
              }) else {
            researchContextWorkspace.message = "请先读取当前 membership 的 PDF，再提交研究档案版本。"
            return
        }
        let fingerprint = [
            membership.id, String(membership.version), membership.symbol,
            baseContextId ?? "first", document.sourceVersion, document.publishedAt,
            draft.semanticFingerprint
        ].joined(separator: "|")
        let idempotencyKey = researchContextWorkspace.reservation.reserve(
            for: fingerprint,
            prefix: "ios-research-context"
        )
        let revision = researchContextWorkspace.beginSave()
        researchContextWorkspace.message = "正在核对 PDF 页并保存研究档案新版本..."
        defer {
            if researchContextWorkspace.saveRevision == revision {
                researchContextWorkspace.isSaving = false
            }
        }
        do {
            let page = try await client.fetchResearchDocumentPage(
                membership: membership,
                documentId: document.id,
                pageNumber: draft.pageNumber
            )
            guard researchContextWorkspace.saveRevision == revision,
                  selectedMembership.map(ResearchContextMembershipBinding.init)
                    == ResearchContextMembershipBinding(membership),
                  parsedSymbol?.canonical == membership.symbol else { return }
            let body = try draft.request(
                membership: membership,
                document: document,
                page: page,
                current: current,
                baseContextId: baseContextId,
                idempotencyKey: idempotencyKey
            )
            let fresh = try await client.createResearchContextAndReadBack(
                membership: membership,
                requestBody: body
            )
            guard researchContextWorkspace.saveRevision == revision,
                  selectedMembership.map(ResearchContextMembershipBinding.init)
                    == ResearchContextMembershipBinding(membership),
                  parsedSymbol?.canonical == membership.symbol,
                  fresh.data?.id != nil else { return }
            researchContextWorkspace.envelope = fresh
            if twoLayerReportWorkspace.draft?.taskIntent?.selectedResearchContext != nil {
                twoLayerReportWorkspace.draft?.taskIntent?.selectedResearchContext = nil
                twoLayerReportWorkspace.draft?.taskIntent?.confirmProviderAuthorization(false)
                twoLayerReportWorkspace.message = "研究档案已保存新版本，旧条目选择和发送确认已清除。"
#if OWNER_CLIENT
                personalFormalMaterialReviewed = false
                personalFormalReviewedMaterialBinding = nil
#endif
            }
            researchContextWorkspace.isEditing = false
            researchContextWorkspace.assistantDraft = nil
            researchContextWorkspace.reservation.clear()
            researchContextWorkspace.message =
                "研究档案 v\(fresh.history.first?.revision ?? 1) 已保存并重新读取；旧综合报告会随选定证据快照变化转为历史版本。"
            researchContextWorkspace.completeness = nil
            researchContextWorkspace.completenessMessage = "研究上下文已变化；旧 completeness 已失效，请重新记录覆盖。"
            await loadTwoLayerReports()
            guard researchContextWorkspace.saveRevision == revision else { return }
            if twoLayerReportWorkspace.envelope != nil {
                twoLayerReportWorkspace.message =
                    "行业与同业上下文已进入当前选定的证据快照；现在可以准备深度研究。"
            }
            if pendingResearchReportRevisionSourceReservation != nil {
                selectedEvidenceWorkspace = .frozen
                pendingDecisionWorkspaceScrollTarget = "freezeResearchEvidenceButton"
                twoLayerReportWorkspace.message = "研究档案已更新；请重新冻结当前证据并综合修订报告。"
            } else {
                selectedEvidenceWorkspace = .brief
            }
        } catch {
            guard researchContextWorkspace.saveRevision == revision else { return }
            researchContextWorkspace.message = researchContextFailureMessage(error)
        }
    }

    @MainActor
    func openResearchContextCitation(_ citation: ResearchContextCitation,
        requireFreshDocumentList: Bool = false) async {
        guard let rootMembership = selectedMembership else { return }
        let membership: CandidateMembershipData
        if let source = citation.sourceMembership {
#if OWNER_CLIENT
            guard let peer = ownerStore.membershipEnvelope?.memberships.first(where: {
                $0.id == source.membershipId && $0.version == source.membershipVersion
                    && $0.symbol == source.symbol && $0.actorId == rootMembership.actorId
                    && $0.state == .tracked
            }) else {
                researchContextWorkspace.message = "同行原件所属研究成员已变化；未重开旧引用。"
                return
            }
            membership = peer
#else
            researchContextWorkspace.message = "同行原件需要在 Owner 研究客户端重新核对。"
            return
#endif
        } else { membership = rootMembership }
        let revision = UUID()
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        do {
            let list: ResearchDocumentListEnvelope
            if membership.id == rootMembership.id, !requireFreshDocumentList,
               let current = researchDocumentWorkspace.list,
               current.membershipId == membership.id,
               current.membershipVersion == membership.version {
                list = current
            } else {
                list = try await client.fetchResearchDocuments(membership: membership)
                guard researchDocumentWorkspace.requestRevision == revision,
                      selectedMembership?.id == rootMembership.id,
                      selectedMembership?.version == rootMembership.version else { return }
                if membership.id == rootMembership.id { researchDocumentWorkspace.list = list }
            }
            guard let document = list.documents.first(where: { $0.id == citation.documentId }) else {
                researchContextWorkspace.message = "当前 fresh PDF 列表无法匹配该引用。"
                return
            }
            guard document.isSourceAvailable,
                  (citation.sourceType == "synthesis_snapshot_citation"
                    || document.sourceClassification == "owner_declared_official"
                      && document.rightsStatus == "user_provided"
                      && document.sourceVersion == citation.sourceVersion) else {
                researchContextWorkspace.message = "引用身份仍保留，但原 PDF 缺失或校验失败，当前不能重新打开。"
                return
            }
            let page = try await client.fetchResearchDocumentPage(
                membership: membership,
                documentId: document.id,
                pageNumber: citation.pageNumber
            )
            guard page.pageTextSha256 == citation.pageTextSha256 else {
                throw ResearchDocumentClientError.invalidResponse
            }
            let data = try await client.fetchResearchDocumentContent(
                membership: membership,
                document: document
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  selectedMembership?.id == rootMembership.id,
                  selectedMembership?.version == rootMembership.version else { return }
#if OWNER_CLIENT
            if citation.sourceMembership != nil,
               ownerStore.membershipEnvelope?.memberships.contains(where: {
                   $0.id == membership.id && $0.version == membership.version
                       && $0.symbol == membership.symbol && $0.actorId == rootMembership.actorId
                       && $0.state == .tracked
               }) != true {
                researchContextWorkspace.message = "同行来源成员版本已变化；未展示旧原件。"
                return
            }
#endif
            if membership.id == rootMembership.id {
                researchDocumentWorkspace.selectedDocumentId = document.id
                researchDocumentWorkspace.selectedPage = page
            }
            presentResearchDocumentPDF(
                document: document,
                pageNumber: page.pageNumber,
                data: data
            )
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchContextWorkspace.message = "引用原文已变化或暂不可打开。"
        }
    }

    private func researchContextFailureMessage(_ error: Error) -> String {
        if case ResearchContextDraftError.invalid(let errors) = error {
            return "上下文输入不完整：\(errors.joined(separator: "；"))"
        }
        if case ResearchDocumentClientError.httpStatus(let status) = error {
            return status == 404
                ? "所选 PDF 页不存在；请核对页码。"
                : "PDF 页读取失败（HTTP \(status)）。"
        }
        if case ResearchContextClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403: return "行业与同业上下文未获读取授权。"
            case 400: return "行业与同业上下文请求与当前候选不匹配。"
            case 404: return "当前候选或行业与同业上下文不存在。"
            case 409: return "候选版本已变化；请刷新后重新读取上下文。"
            case 500...599: return "行业与同业上下文服务暂不可用。"
            default: return "行业与同业上下文请求失败（HTTP \(status)）。"
            }
        }
        if case ResearchContextClientError.invalidResponse = error {
            return "行业与同业上下文响应格式无效。"
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet:
                return "当前离线；行业与同业上下文未读取。"
            case .timedOut, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost:
                return "网络暂不可用；行业与同业上下文未读取。"
            default:
                return "行业与同业上下文网络请求失败。"
            }
        }
        return "行业与同业上下文读取失败。"
    }
}
