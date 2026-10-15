import Foundation
struct ResearchSavedOriginalPresentation: Identifiable {
    let id = UUID()
    let title: String
    let body: String
    let verification: String
    let highlightRange: NSRange?
}
struct ResearchDocumentWorkspaceState {
    var identity: String?
    var list: ResearchDocumentListEnvelope?
    var selectedDocumentId: String?
    var selectedPage: ResearchDocumentPageData?
    var confirmation: ResearchDocumentConfirmationReadBack?
    var ocrNoteConfirmation: ResearchDocumentOcrCorrectionReadBack?
    var searchEnvelope: ResearchDocumentSearchEnvelope?
    var savedSearchEnvelope: ResearchSavedSourceSearchEnvelope?
    var savedOriginal: ResearchSavedOriginalPresentation?
    var searchQuery = ""
    var originalSearchQuestion: String?
    var suggestedSearchQueries: [String] = []
    var searchStatus = "输入问题或关键词搜索当前公司已存资料。"
    var savedOpenStatus: String?
    var message = "请选择当前研究成员后读取你提供的 PDF。"
    var pageNumberText = "1"
    var quote = ""
    var statement = ""
    var replacementMaterial: ResearchMaterialData?
    var replacementOcrNote: ResearchMaterialData?
    var ocrExcerpt = ""
    var correctedOcrText = ""
    var ocrNoteExplanation = ""
    var showOcrNoteEditor = false
    var ocrNoteValidUntil = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    var validUntil = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    var importTitle = ""
    var importSourceVersion = ""
    var importPublishedAt = Date()
    var pendingImport: ResearchDocumentPendingImport?
    var rightsConfirmed = false
    var isImporterPresented = false
    var isLoading = false
    var isImporting = false
    var isConfirming = false
    var isSavingOcrNote = false
    var isDeleting = false
    var isSearching = false
    var isOpeningSavedSource = false
    var searchRevision = UUID()
    var savedOpenRevision = UUID()
    var requestRevision = UUID()
    var importReservation = ResearchDocumentIdempotencyReservation()
    var confirmReservation = ResearchDocumentIdempotencyReservation()
    var ocrNoteReservation = ResearchDocumentIdempotencyReservation()
    var deletionReservation = ResearchDocumentIdempotencyReservation()
    var pendingDeletionMaterialId: String?
    var materialDeletions: [ResearchMaterialDeletionData] = []
    var pdfPresentation: ResearchDocumentPDFPresentation?
    var isBusy: Bool { isLoading || isImporting || isConfirming || isSavingOcrNote || isDeleting || isSearching || isOpeningSavedSource }
    mutating func setSearchQuery(_ nextQuery: String, keepingOriginalQuestion: Bool = false) {
        guard nextQuery != searchQuery else { return }
        searchRevision = UUID()
        savedOpenRevision = UUID()
        searchEnvelope = nil
        savedSearchEnvelope = nil
        savedOriginal = nil
        searchStatus = "输入问题或关键词搜索当前公司已存资料。"
        savedOpenStatus = nil
        isSearching = false
        isOpeningSavedSource = false
        searchQuery = nextQuery
        if !keepingOriginalQuestion {
            originalSearchQuestion = nil
            suggestedSearchQueries = []
        }
    }
    mutating func clearForIdentityChange(_ nextIdentity: String) {
        identity = nextIdentity
        requestRevision = UUID()
        list = nil
        selectedDocumentId = nil
        selectedPage = nil
        confirmation = nil
        ocrNoteConfirmation = nil
        searchEnvelope = nil
        savedSearchEnvelope = nil
        savedOriginal = nil
        searchQuery = ""
        originalSearchQuestion = nil
        suggestedSearchQueries = []
        searchStatus = "输入问题或关键词搜索当前公司已存资料。"
        savedOpenStatus = nil
        message = "正在读取当前研究成员的 PDF..."
        pageNumberText = "1"
        quote = ""
        statement = ""
        replacementMaterial = nil
        replacementOcrNote = nil
        ocrExcerpt = ""
        correctedOcrText = ""
        ocrNoteExplanation = ""
        showOcrNoteEditor = false
        clearPendingImport()
        isLoading = false
        isImporting = false
        isConfirming = false
        isSavingOcrNote = false
        isDeleting = false
        isSearching = false
        isOpeningSavedSource = false
        searchRevision = UUID()
        savedOpenRevision = UUID()
        confirmReservation.clear()
        ocrNoteReservation.clear()
        deletionReservation.clear()
        pendingDeletionMaterialId = nil
        materialDeletions = []
        pdfPresentation = nil
        importTitle = ""
        importSourceVersion = ""
        importPublishedAt = Date()
        isImporterPresented = false
    }
    mutating func clearPendingImport() {
        pendingImport = nil
        rightsConfirmed = false
        importReservation.clear()
    }
    mutating func clearOcrNoteDraft() {
        ocrNoteConfirmation = nil
        replacementOcrNote = nil
        ocrExcerpt = ""
        correctedOcrText = ""
        ocrNoteExplanation = ""
        showOcrNoteEditor = false
        ocrNoteReservation.clear()
    }
}
extension GateBResearchScreen {
    @MainActor
    func resetAndLoadResearchDocuments(identity: String) async {
        researchDocumentWorkspace.clearForIdentityChange(identity)
        researchFundamentalWorkspace.clearForIdentityChange()
        researchFinancialRequirementWorkspace.clearForIdentityChange()
        researchValuationScenarioWorkspace.clearForIdentityChange()
        await loadResearchDocuments()
        await loadResearchFundamentals(refreshDocuments: false)
    }
    @MainActor
    func loadResearchDocuments(preservingCurrent: Bool = false) async {
        guard let membership = selectedMembership else {
            researchDocumentWorkspace.message = "请选择当前研究成员后读取你提供的 PDF。"
            return
        }
        let revision = UUID()
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        let previousList = researchDocumentWorkspace.list
        let previousSelection = researchDocumentWorkspace.selectedDocumentId
        if !preservingCurrent {
            researchDocumentWorkspace.list = nil
            researchDocumentWorkspace.materialDeletions = []
            researchDocumentWorkspace.selectedPage = nil
            researchDocumentWorkspace.confirmation = nil
            researchDocumentWorkspace.ocrNoteConfirmation = nil
        }
        do {
            let list = try await client.fetchResearchDocuments(membership: membership)
            guard researchDocumentWorkspace.requestRevision == revision,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else { return }
            researchDocumentWorkspace.list = list
            researchDocumentWorkspace.materialDeletions = list.materialDeletions ?? []
            researchFundamentalWorkspace.reconcileSource(
                materials: list.materials,
                serverAsOf: list.generatedAt,
                fundamentalValues: researchFundamentalWorkspace.envelope?.values ?? []
            )
            researchDocumentWorkspace.selectedDocumentId = previousSelection.flatMap { selected in
                list.documents.contains(where: { $0.id == selected }) ? selected : nil
            } ?? list.documents.first(where: \.isSourceAvailable)?.id ?? list.documents.first?.id
            if previousList != list {
                researchDocumentWorkspace.selectedPage = nil
                researchDocumentWorkspace.confirmation = nil
                researchDocumentWorkspace.clearOcrNoteDraft()
                researchDocumentWorkspace.pdfPresentation = nil
                researchDocumentWorkspace.searchEnvelope = nil
                researchDocumentWorkspace.savedSearchEnvelope = nil
            }
            let unavailableCount = list.documents.filter { !$0.isSourceAvailable }.count
            researchDocumentWorkspace.message = list.documents.isEmpty
                ? "当前研究自选尚未导入 PDF。"
                : unavailableCount == 0
                    ? "已读取并核对 \(list.documents.count) 份 PDF 与 \(list.materials.count) 条引用材料。"
                    : "已读取 \(list.documents.count) 份 PDF 元数据与 \(list.materials.count) 条引用材料；其中 \(unavailableCount) 份原 PDF 缺失或校验失败，已禁止打开和确认。"
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.searchEnvelope = nil
            researchDocumentWorkspace.savedSearchEnvelope = nil
            researchDocumentWorkspace.message = preservingCurrent && previousList != nil
                ? "刷新失败，继续显示上次读取的同一研究资料；请稍后重试。"
                : researchDocumentClientMessage(error)
        }
    }
    @MainActor
    func searchResearchDocumentText() async {
        guard let membership = selectedMembership else { return }
        let query = researchDocumentWorkspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...80).contains(query.count) else {
            researchDocumentWorkspace.searchRevision = UUID()
            researchDocumentWorkspace.savedOpenRevision = UUID()
            researchDocumentWorkspace.isSearching = false
            researchDocumentWorkspace.isOpeningSavedSource = false
            researchDocumentWorkspace.searchEnvelope = nil
            researchDocumentWorkspace.savedSearchEnvelope = nil
            researchDocumentWorkspace.savedOriginal = nil
            researchDocumentWorkspace.searchStatus = "请输入 1 到 80 个字符搜索已存资料。"
            researchDocumentWorkspace.savedOpenStatus = nil
            researchDocumentWorkspace.message = researchDocumentWorkspace.searchStatus
            return
        }
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(membership: membership)
        let identity = researchDocumentTaskIdentity
        researchDocumentWorkspace.searchRevision = revision
        researchDocumentWorkspace.isSearching = true
        researchDocumentWorkspace.savedOpenRevision = UUID()
        researchDocumentWorkspace.isOpeningSavedSource = false
        researchDocumentWorkspace.searchEnvelope = nil
        researchDocumentWorkspace.savedSearchEnvelope = nil
        researchDocumentWorkspace.savedOriginal = nil
        researchDocumentWorkspace.searchStatus = "正在搜索 PDF 和已存来源。"
        researchDocumentWorkspace.savedOpenStatus = nil
        defer {
            if researchDocumentWorkspace.searchRevision == revision {
                researchDocumentWorkspace.isSearching = false
            }
        }
        var pdfEnvelope: ResearchDocumentSearchEnvelope?
        var savedEnvelope: ResearchSavedSourceSearchEnvelope?
        var failures: [String] = []
        do {
            pdfEnvelope = try await client.searchResearchDocuments(membership: membership, query: query)
        } catch {
            failures.append("PDF 搜索失败：\(researchDocumentClientMessage(error))")
        }
        guard researchDocumentWorkspace.searchRevision == revision,
              researchDocumentTaskIdentity == identity,
              operation.matches(membership: selectedMembership),
              researchDocumentWorkspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
        do {
            savedEnvelope = try await client.searchSavedSources(membership: membership, query: query)
        } catch {
            failures.append("已存网页和富途材料搜索失败：\(researchDocumentClientMessage(error))")
        }
        guard researchDocumentWorkspace.searchRevision == revision,
              researchDocumentTaskIdentity == identity,
              operation.matches(membership: selectedMembership),
              researchDocumentWorkspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
        researchDocumentWorkspace.searchEnvelope = pdfEnvelope
        researchDocumentWorkspace.savedSearchEnvelope = savedEnvelope
        if let suggestions = pdfEnvelope?.search.suggestedQueries, !suggestions.isEmpty,
           (researchDocumentWorkspace.originalSearchQuestion == nil
            || researchDocumentWorkspace.originalSearchQuestion == query) {
            researchDocumentWorkspace.originalSearchQuestion = query
            researchDocumentWorkspace.suggestedSearchQueries = suggestions
        }
        let total = (pdfEnvelope?.results.count ?? 0) + (savedEnvelope?.results.count ?? 0)
        let unavailableCount = savedEnvelope?.unavailableSources.count ?? 0
        let savedLaneFailures = savedEnvelope?.laneFailures.map { $0.kind == "html" ? "已存网页搜索暂不可用" : "富途材料搜索暂不可用" } ?? []
        let resultMessage = total > 0
            ? "找到 \(total) 条命中。打开时会重新核对对应原件；OCR 和第三方声明仍需人工核验。"
            : unavailableCount > 0
                ? "没有可打开的已存原件命中；部分来源核验失败，不能当作零结果。"
            : pdfEnvelope != nil || savedEnvelope != nil
                ? "本次已完成的来源没有命中；没有旧结果回退。"
                : "本次搜索均失败；没有旧结果回退。"
        let unavailableMessage = unavailableCount > 0 ? ["\(unavailableCount) 份已存来源不可用，详见下方；其余有效命中仍可打开。"] : []
        let selectedKeyword = researchDocumentWorkspace.originalSearchQuestion != nil
            && researchDocumentWorkspace.originalSearchQuestion != query
        let queryContext = "当前搜索词「\(query)」。" + (selectedKeyword
            ? "这是你选择的关键词定位；命中不等于回答原问题，年份和变化方向仍需逐项核对。" : "")
        researchDocumentWorkspace.searchStatus = ([queryContext, resultMessage] + unavailableMessage + savedLaneFailures + failures).joined(separator: " ")
        researchDocumentWorkspace.message = researchDocumentWorkspace.searchStatus
    }

    @MainActor
    func openSavedSourceSearchHit(_ hit: ResearchSavedSourceSearchHit) async {
        let currentQuery = researchDocumentWorkspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let membership = selectedMembership,
              researchDocumentWorkspace.savedSearchEnvelope?.query == currentQuery,
              researchDocumentWorkspace.savedSearchEnvelope?.results.contains(hit) == true else { return }
        let identity = researchDocumentTaskIdentity
        let searchRevision = researchDocumentWorkspace.searchRevision
        let openRevision = UUID()
        researchDocumentWorkspace.savedOpenRevision = openRevision
        researchDocumentWorkspace.savedOriginal = nil
        researchDocumentWorkspace.savedOpenStatus = nil
        researchDocumentWorkspace.isOpeningSavedSource = true
        defer {
            if researchDocumentWorkspace.savedOpenRevision == openRevision {
                researchDocumentWorkspace.isOpeningSavedSource = false
            }
        }
        do {
            let freshSearch = try await client.searchSavedSources(membership: membership, query: currentQuery)
            guard researchDocumentTaskIdentity == identity,
                  researchDocumentWorkspace.searchRevision == searchRevision,
                  researchDocumentWorkspace.savedOpenRevision == openRevision,
                  researchDocumentWorkspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) == currentQuery,
                  researchDocumentWorkspace.savedSearchEnvelope?.query == currentQuery,
                  researchDocumentWorkspace.savedSearchEnvelope?.results.contains(hit) == true,
                  freshSearch.results.contains(hit) else { throw ResearchDocumentClientError.invalidResponse }
            let presentation: ResearchSavedOriginalPresentation
            if hit.kind == "html", let snapshotId = hit.snapshotId {
                let snapshot = try await client.readResearchSourceSnapshot(membership: membership, snapshotId: snapshotId)
                _ = try await client.readResearchSourceSnapshotOriginal(membership: membership, snapshot: snapshot)
                guard snapshot.textSha256 == hit.textSha256, snapshot.rawSha256 == hit.rawSha256,
                      snapshot.reviewState == hit.reviewState,
                      let text = snapshot.normalizedText, let citation = hit.citation,
                      let selected = snapshot.selectedCitation(range: NSRange(location: citation.startUtf16,
                          length: citation.endUtf16 - citation.startUtf16)),
                      selected.0 == citation else { throw ResearchDocumentClientError.invalidResponse }
                presentation = ResearchSavedOriginalPresentation(title: "已保存官方网页 · \(snapshot.publisher)",
                    body: text, verification: "已重新核对原始网页字节、正文和命中选段 SHA-256，并定位原文；\(snapshot.reviewState == "historical" ? "历史原文" : snapshot.reviewState == "pending_review" ? "待重新核对" : "当前已存原文")。",
                    highlightRange: NSRange(location: citation.startUtf16,
                        length: citation.endUtf16 - citation.startUtf16))
            } else if hit.kind == "futu_material", let captureId = hit.captureId,
                      let pageId = hit.pageId {
                let capture = try await client.readFutuFinancialCapture(membership: membership, captureId: captureId)
                guard let page = capture.pages.first(where: { $0.id == pageId && $0.rawSha256 == hit.rawSha256 })
                    else { throw ResearchDocumentClientError.invalidResponse }
                let original = try await client.readFutuFinancialOriginal(membership: membership, capture: capture, page: page)
                presentation = ResearchSavedOriginalPresentation(title: "富途提供方原始页 · \(page.statementType.title)",
                    body: original.rawText, verification: "材料命中行：\(hit.excerpt)。已重新核对对应原始页；材料中的表述未逐字定位到原始页，请对照核验。第三方声明，未核实；不是发行人原文或正式财务事实。",
                    highlightRange: nil)
            } else {
                throw ResearchDocumentClientError.invalidResponse
            }
            guard researchDocumentTaskIdentity == identity,
                  researchDocumentWorkspace.searchRevision == searchRevision,
                  researchDocumentWorkspace.savedOpenRevision == openRevision,
                  researchDocumentWorkspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) == currentQuery,
                  researchDocumentWorkspace.savedSearchEnvelope?.query == currentQuery,
                  researchDocumentWorkspace.savedSearchEnvelope?.results.contains(hit) == true else { return }
            researchDocumentWorkspace.savedOriginal = presentation
        } catch {
            guard researchDocumentTaskIdentity == identity,
                  researchDocumentWorkspace.searchRevision == searchRevision,
                  researchDocumentWorkspace.savedOpenRevision == openRevision,
                  researchDocumentWorkspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) == currentQuery,
                  researchDocumentWorkspace.savedSearchEnvelope?.query == currentQuery,
                  researchDocumentWorkspace.savedSearchEnvelope?.results.contains(hit) == true else { return }
            researchDocumentWorkspace.savedOriginal = nil
            let failureMessage = "原件缺失、身份变化或校验失败；未打开旧内容。\(researchDocumentClientMessage(error))"
            researchDocumentWorkspace.savedOpenStatus = failureMessage
            researchDocumentWorkspace.message = failureMessage
        }
    }
    @MainActor
    func openResearchDocumentSearchHit(_ hit: ResearchDocumentSearchHit) async {
        guard let membership = selectedMembership,
              researchDocumentWorkspace.searchEnvelope?.results.contains(hit) == true else { return }
        let searchRevision = researchDocumentWorkspace.searchRevision
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership,
            documentId: hit.documentId,
            pageNumber: hit.pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        researchDocumentWorkspace.pdfPresentation = nil
        researchDocumentWorkspace.selectedPage = nil
        researchDocumentWorkspace.confirmation = nil
        researchDocumentWorkspace.clearOcrNoteDraft()
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        do {
            let list = try await client.fetchResearchDocuments(membership: membership)
            guard researchDocumentWorkspace.requestRevision == revision,
                  researchDocumentWorkspace.searchRevision == searchRevision,
                  researchDocumentWorkspace.searchEnvelope?.results.contains(hit) == true,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.actorId == membership.actorId,
                  selectedMembership?.state == membership.state,
                  selectedMembership?.symbol == membership.symbol,
                  let document = list.documents.first(where: { $0.id == hit.documentId && $0.isSourceAvailable }),
                  (1...document.pageCount).contains(hit.pageNumber) else {
                throw ResearchDocumentClientError.invalidResponse
            }
            if hit.kind == .material {
                guard let materialId = hit.materialId,
                      list.materials.contains(where: {
                          $0.id == materialId
                              && $0.citation?.documentId == hit.documentId
                              && $0.citation?.pageNumber == hit.pageNumber
                              && $0.citation?.pageTextSha256 == hit.pageTextSha256
                              && $0.sourceVersion == hit.sourceVersion
                              && ($0.sourceType == "owner_ocr_correction_note")
                                  == (hit.evidenceStatus == "owner_ocr_correction_note_unverified")
                      }) else { throw ResearchDocumentClientError.invalidResponse }
            }
            let page = try await client.fetchResearchDocumentPage(
                membership: membership,
                documentId: document.id,
                pageNumber: hit.pageNumber
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  researchDocumentWorkspace.searchRevision == searchRevision,
                  operation.matches(
                    membership: selectedMembership,
                    documentId: hit.documentId,
                    pageNumber: hit.pageNumber
                  ),
                  page.pageTextSha256 == hit.pageTextSha256 else {
                throw ResearchDocumentClientError.invalidResponse
            }
            if hit.evidenceStatus == "owner_ocr_correction_note_unverified" {
                guard let materialId = hit.materialId,
                      let note = list.materials.first(where: { $0.id == materialId }),
                      note.validatesOcrCorrectionCitation(document: document, page: page) else {
                    throw ResearchDocumentClientError.invalidResponse
                }
            }
            researchDocumentWorkspace.list = list
            researchDocumentWorkspace.selectedDocumentId = document.id
            researchDocumentWorkspace.pageNumberText = String(hit.pageNumber)
            researchDocumentWorkspace.selectedPage = page
            let pdfData: Data
            do {
                pdfData = try await client.fetchResearchDocumentContent(
                    membership: membership,
                    document: document
                )
            } catch {
                guard researchDocumentWorkspace.requestRevision == revision else { return }
                researchDocumentWorkspace.pdfPresentation = nil
                researchDocumentWorkspace.message = "原始 PDF 内容读取或校验失败；命中页文本仍在，但未显示原始 PDF 页。"
                return
            }
            guard researchDocumentWorkspace.requestRevision == revision,
                  researchDocumentWorkspace.searchRevision == searchRevision,
                  researchDocumentWorkspace.searchEnvelope?.results.contains(hit) == true,
                  operation.matches(
                    membership: selectedMembership,
                    documentId: hit.documentId,
                    pageNumber: hit.pageNumber
                  ) else { return }
            presentResearchDocumentPDF(
                document: document,
                pageNumber: hit.pageNumber,
                data: pdfData
            )
            let openedOriginalPage = researchDocumentWorkspace.pdfPresentation != nil
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.message = openedOriginalPage
                ? "已按搜索结果重新读取 \(document.title) 第 \(hit.pageNumber) 页，并打开原 PDF；\(hit.evidenceStatus == "owner_ocr_correction_note_unverified" ? "命中是未核验的人工 OCR 校对备注，不是原 PDF 文字。" : "命中仍不是已核验事实，请对照原页人工核验。")"
                : "已按搜索结果重新读取第 \(hit.pageNumber) 页文本，但 PDFKit 未能定位同一原 PDF 页；命中仍不是已核验事实。"
            pendingDecisionWorkspaceScrollTarget = "researchDocumentsWorkspaceAnchor"
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.searchEnvelope = nil
            researchDocumentWorkspace.savedSearchEnvelope = nil
            researchDocumentWorkspace.pdfPresentation = nil
            researchDocumentWorkspace.selectedPage = nil
            researchDocumentWorkspace.confirmation = nil
            researchDocumentWorkspace.message = "搜索结果的 membership、来源或页文本已变化；旧结果已清除。"
        }
    }
    @MainActor
    func handleResearchDocumentSelection(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first, urls.count == 1 else {
            researchDocumentWorkspace.clearPendingImport()
            researchDocumentWorkspace.message = "未选择 PDF；未保留可复用的权利确认。"
            return
        }
        Task { @MainActor in
            guard let membership = selectedMembership else { return }
            let operation = ResearchDocumentOperationIdentity(membership: membership)
            let title = researchDocumentWorkspace.importTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let sourceVersion = researchDocumentWorkspace.importSourceVersion.trimmingCharacters(in: .whitespacesAndNewlines)
            let publishedAt = ISO8601DateFormatter().string(from: researchDocumentWorkspace.importPublishedAt)
            let filename = url.lastPathComponent
            let revision = UUID()
            researchDocumentWorkspace.requestRevision = revision
            researchDocumentWorkspace.isImporting = true
            researchDocumentWorkspace.clearPendingImport()
            defer {
                if researchDocumentWorkspace.requestRevision == revision {
                    researchDocumentWorkspace.isImporting = false
                }
            }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            do {
                let (bytes, pdfSha256) = try await Task.detached(priority: .userInitiated) {
                    let resourceValues = try? url.resourceValues(forKeys: [.fileSizeKey])
                    if let resourceSize = resourceValues?.fileSize,
                       resourceSize > ResearchDocumentClientLimits.maxPDFBytes {
                        throw ResearchDocumentClientError.pdfTooLarge
                    }
                    let bytes = try Data(contentsOf: url, options: [.mappedIfSafe])
                    guard bytes.count <= ResearchDocumentClientLimits.maxPDFBytes else {
                        throw ResearchDocumentClientError.pdfTooLarge
                    }
                    return (bytes, researchDocumentSha256(bytes))
                }.value
                guard researchDocumentWorkspace.requestRevision == revision else { return }
                guard operation.matches(membership: selectedMembership),
                      title == researchDocumentWorkspace.importTitle.trimmingCharacters(in: .whitespacesAndNewlines),
                      sourceVersion == researchDocumentWorkspace.importSourceVersion.trimmingCharacters(in: .whitespacesAndNewlines),
                      publishedAt == ISO8601DateFormatter().string(from: researchDocumentWorkspace.importPublishedAt) else {
                    researchDocumentWorkspace.clearPendingImport()
                    return
                }
                researchDocumentWorkspace.pendingImport = ResearchDocumentPendingImport(
                    membership: membership,
                    title: title,
                    publishedAt: publishedAt,
                    sourceVersion: sourceVersion,
                    filename: filename,
                    pdfSha256: pdfSha256,
                    pdfBytes: bytes
                )
                researchDocumentWorkspace.message = "已读取 \(filename) 并计算 SHA-256；请确认对这一精确文件的本地处理权利。"
            } catch {
                guard researchDocumentWorkspace.requestRevision == revision else { return }
                researchDocumentWorkspace.clearPendingImport()
                researchDocumentWorkspace.message = researchDocumentClientMessage(error)
            }
        }
    }
    @MainActor
    func uploadPendingResearchDocument() async {
        guard let membership = selectedMembership,
              let pending = researchDocumentWorkspace.pendingImport,
              researchDocumentWorkspace.rightsConfirmed else { return }
        let title = researchDocumentWorkspace.importTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceVersion = researchDocumentWorkspace.importSourceVersion.trimmingCharacters(in: .whitespacesAndNewlines)
        let publishedAt = ISO8601DateFormatter().string(from: researchDocumentWorkspace.importPublishedAt)
        guard pending.matches(
            membership: membership,
            title: title,
            publishedAt: publishedAt,
            sourceVersion: sourceVersion
        ) else {
            researchDocumentWorkspace.clearPendingImport()
            researchDocumentWorkspace.message = "文件或研究身份已改变；请重新选择 PDF 并确认权利。"
            return
        }
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(membership: membership)
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isImporting = true
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isImporting = false
            }
        }
        let semantic = researchDocumentImportSemantic(
            membership: membership,
            title: pending.title,
            publishedAt: pending.publishedAt,
            sourceVersion: pending.sourceVersion,
            rightsConfirmed: true,
            filename: pending.filename,
            pdfSha256: pending.pdfSha256
        )
        let key = researchDocumentWorkspace.importReservation.reserve(for: semantic, prefix: "ios-pdf-import")
        let metadata = ImportResearchDocumentMetadata(
            membershipVersion: membership.version,
            title: pending.title,
            publishedAt: pending.publishedAt,
            sourceVersion: pending.sourceVersion,
            rightsConfirmed: true,
            idempotencyKey: key
        )
        do {
            _ = try await client.importResearchDocument(
                membership: membership,
                metadata: metadata,
                filename: pending.filename,
                pdfBytes: pending.pdfBytes
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  operation.matches(membership: selectedMembership),
                  researchDocumentWorkspace.pendingImport?.id == pending.id else { return }
            researchDocumentWorkspace.clearPendingImport()
            researchValuationScenarioWorkspace.clearFreshSuccess()
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "新 PDF 已导入；旧冻结展示与确认已清除。"
            )
            invalidateTwoLayerReport("新 PDF 已导入；旧研究报告状态已清除。")
            researchDocumentWorkspace.message = "PDF 导入成功；正在重新读取服务器文档列表。"
            researchDocumentWorkspace.isImporting = false
            await loadResearchDocuments()
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision,
                  researchDocumentWorkspace.pendingImport?.id == pending.id else { return }
            researchDocumentWorkspace.message = researchDocumentClientMessage(error)
        }
    }
    @MainActor
    func loadSelectedResearchDocumentPage() async {
        guard let membership = selectedMembership,
              let document = selectedResearchDocument,
              let pageNumber = Int(researchDocumentWorkspace.pageNumberText),
              (1...document.pageCount).contains(pageNumber) else {
            researchDocumentWorkspace.message = "请输入 PDF 范围内的正整数页码。"
            return
        }
        guard document.isSourceAvailable else {
            researchDocumentWorkspace.selectedPage = nil
            researchDocumentWorkspace.confirmation = nil
            researchDocumentWorkspace.clearOcrNoteDraft()
            researchDocumentWorkspace.message = "原 PDF 缺失或校验失败；已保留资料身份，但不能读取或确认原文。"
            return
        }
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership,
            documentId: document.id,
            pageNumber: pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        researchDocumentWorkspace.selectedPage = nil
        researchDocumentWorkspace.confirmation = nil
        researchDocumentWorkspace.ocrNoteConfirmation = nil
        do {
            let page = try await client.fetchResearchDocumentPage(
                membership: membership,
                documentId: document.id,
                pageNumber: pageNumber
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  operation.matches(
                    membership: selectedMembership,
                    documentId: selectedResearchDocument?.id,
                    pageNumber: Int(researchDocumentWorkspace.pageNumberText)
                  ) else { return }
            researchDocumentWorkspace.selectedPage = page
            researchDocumentWorkspace.message = page.normalizedText.isEmpty
                ? "第 \(pageNumber) 页为空白页；文档仍保留，但此页不能引用。"
                : "已读取第 \(pageNumber) 页规范化原文。"
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.message = researchDocumentClientMessage(error)
        }
    }
    @MainActor
    func confirmSelectedResearchDocumentFact(
        document: ResearchDocumentData,
        page: ResearchDocumentPageData
    ) async {
        guard let membership = selectedMembership else { return }
        guard document.isSourceAvailable else {
            researchDocumentWorkspace.confirmation = nil
            researchDocumentWorkspace.message = "原 PDF 缺失或校验失败；不能新增确认事实。"
            return
        }
        let validUntil = ISO8601DateFormatter().string(from: researchDocumentWorkspace.validUntil)
        let quote = researchDocumentWorkspace.quote.trimmingCharacters(in: .whitespacesAndNewlines)
        let statement = researchDocumentWorkspace.statement.trimmingCharacters(in: .whitespacesAndNewlines)
        let replacement = researchDocumentWorkspace.replacementMaterial
        let semantic = [
            membership.id, String(membership.version), document.id, String(page.pageNumber),
            page.pageTextSha256, quote, statement, validUntil,
            replacement?.id ?? ""
        ].joined(separator: "|")
        let key = researchDocumentWorkspace.confirmReservation.reserve(for: semantic, prefix: "ios-pdf-confirm")
        let request = ConfirmResearchDocumentFactRequest(
            membershipVersion: membership.version,
            pageNumber: page.pageNumber,
            quote: quote,
            statement: statement,
            validUntil: validUntil,
            replacesMaterialId: replacement?.id,
            idempotencyKey: key
        )
        let authorization = (revision: viewModel.authorizationRevision, context: AppEnvironment.researchAuthorizationContext())
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership,
            documentId: document.id,
            pageNumber: page.pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isConfirming = true
        defer { if researchDocumentWorkspace.requestRevision == revision { researchDocumentWorkspace.isConfirming = false } }
        researchDocumentWorkspace.confirmation = nil
        do {
            guard await freshResearchDocumentReplacementForWrite(replacement, revision: revision, operation: operation) else { return }
            let readBack = try await client.confirmResearchDocumentFactAndReadBack(
                membership: membership,
                document: document,
                requestBody: request
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  dailyClientAuthorizationIsCurrent(authorization.revision) && AppEnvironment.researchAuthorizationContext() == authorization.context,
                  operation.matches(
                    membership: selectedMembership,
                    documentId: selectedResearchDocument?.id,
                    pageNumber: Int(researchDocumentWorkspace.pageNumberText)
                  ) else { if request.replacesMaterialId != nil { failClosedEvidenceConflict("授权、membership、actor、版本或 PDF 来源已变化；旧成功态已清除。") }; return }
            researchDocumentWorkspace.list = readBack.list
            researchFundamentalWorkspace.reconcileSource(
                materials: readBack.list.materials,
                serverAsOf: readBack.list.generatedAt,
                fundamentalValues: researchFundamentalWorkspace.envelope?.values ?? []
            )
            researchDocumentWorkspace.selectedPage = readBack.page
            researchDocumentWorkspace.confirmation = readBack
            let replacedMaterialId = request.replacesMaterialId
            researchDocumentWorkspace.replacementMaterial = nil
            researchDocumentWorkspace.confirmReservation.clear()
            researchValuationScenarioWorkspace.clearFreshSuccess()
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "新引用材料已保存；旧冻结展示与确认已清除。"
            )
            invalidateTwoLayerReport("新引用材料已保存；旧研究报告状态已清除。")
            researchDocumentWorkspace.message = replacedMaterialId.map {
                "替代材料 #\($0) 已保存并 fresh read；旧证据包与报告已失效，请重新冻结。"
            } ?? "原文与事实已保存；下一步录入一条基本面原值。"
            pendingDecisionWorkspaceScrollTarget = "researchFundamentalsAnchor"
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            if request.replacesMaterialId != nil { failClosedEvidenceConflict("替代证据未取得可验证回读；旧 pack/report 成功态已清除。") } else { researchDocumentWorkspace.message = researchDocumentClientMessage(error) }
        }
    }

    @MainActor
    func prepareResearchDocumentOcrNoteRevision(
        document: ResearchDocumentData,
        material: ResearchMaterialData
    ) async {
        guard let membership = selectedMembership, let citation = material.citation,
              material.sourceType == "owner_ocr_correction_note",
              material.revisionState == "current", citation.documentId == document.id else { return }
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership, documentId: document.id, pageNumber: citation.pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        defer { if researchDocumentWorkspace.requestRevision == revision { researchDocumentWorkspace.isLoading = false } }
        do {
            let list = try await client.fetchResearchDocuments(membership: membership)
            let page = try await client.fetchResearchDocumentPage(
                membership: membership, documentId: document.id, pageNumber: citation.pageNumber
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  operation.matches(membership: selectedMembership,
                      documentId: document.id, pageNumber: citation.pageNumber),
                  list.documents.contains(document), list.materials.contains(material),
                  material.validatesOcrCorrectionCitation(document: document, page: page) else {
                throw ResearchDocumentClientError.invalidResponse
            }
            researchDocumentWorkspace.list = list
            researchDocumentWorkspace.selectedDocumentId = document.id
            researchDocumentWorkspace.pageNumberText = String(citation.pageNumber)
            researchDocumentWorkspace.selectedPage = page
            researchDocumentWorkspace.clearOcrNoteDraft()
            researchDocumentWorkspace.replacementOcrNote = material
            researchDocumentWorkspace.showOcrNoteEditor = true
            researchDocumentWorkspace.ocrNoteValidUntil = ISO8601DateFormatter().date(from: material.validUntil)
                ?? (Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date())
            researchDocumentWorkspace.message = "已核对当前备注 #\(material.id) 与原始 OCR 页；填写新的校对建议后保存修订。旧版保留。"
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.replacementOcrNote = nil
            researchDocumentWorkspace.message = "备注或原页已变化；请刷新后再修订。\(researchDocumentClientMessage(error))"
        }
    }

    @MainActor
    func saveSelectedResearchDocumentOcrCorrectionNote(
        document: ResearchDocumentData,
        page: ResearchDocumentPageData
    ) async {
        guard let membership = selectedMembership,
              document.isSourceAvailable, page.textSource == "ocr",
              researchDocumentWorkspace.selectedPage == page,
              selectedResearchDocument?.id == document.id else { return }
        let excerpt = researchDocumentWorkspace.ocrExcerpt.trimmingCharacters(in: .whitespacesAndNewlines)
        let corrected = researchDocumentWorkspace.correctedOcrText.trimmingCharacters(in: .whitespacesAndNewlines)
        let explanation = researchDocumentWorkspace.ocrNoteExplanation.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !excerpt.isEmpty, !corrected.isEmpty,
              countNormalizedResearchDocumentOccurrences(in: page.normalizedText, quote: excerpt) > 0 else {
            researchDocumentWorkspace.message = "请填写本页 OCR 中实际出现的错误片段及校对建议。"
            return
        }
        let replacement = researchDocumentWorkspace.replacementOcrNote
        let validUntil = ISO8601DateFormatter().string(from: researchDocumentWorkspace.ocrNoteValidUntil)
        let semantic = [membership.id, String(membership.version), document.id,
            String(page.pageNumber), page.pageTextSha256, excerpt, corrected, explanation,
            validUntil, replacement?.id ?? ""].joined(separator: "|")
        let key = researchDocumentWorkspace.ocrNoteReservation.reserve(for: semantic, prefix: "ios-ocr-note")
        let request = CreateResearchDocumentOcrCorrectionNoteRequest(
            membershipVersion: membership.version, pageNumber: page.pageNumber,
            pageTextSha256: page.pageTextSha256, ocrExcerpt: excerpt, correctedText: corrected,
            note: explanation.isEmpty ? nil : explanation, validUntil: validUntil,
            replacesMaterialId: replacement?.id, idempotencyKey: key
        )
        let authorization = (revision: viewModel.authorizationRevision,
            context: AppEnvironment.researchAuthorizationContext())
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership, documentId: document.id, pageNumber: page.pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isSavingOcrNote = true
        researchDocumentWorkspace.ocrNoteConfirmation = nil
        defer { if researchDocumentWorkspace.requestRevision == revision { researchDocumentWorkspace.isSavingOcrNote = false } }
        do {
            let freshList = try await client.fetchResearchDocuments(membership: membership)
            let freshPage = try await client.fetchResearchDocumentPage(
                membership: membership, documentId: document.id, pageNumber: page.pageNumber
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  operation.matches(membership: selectedMembership,
                      documentId: selectedResearchDocument?.id,
                      pageNumber: Int(researchDocumentWorkspace.pageNumberText)),
                  freshList.documents.contains(document), freshPage == page,
                  replacement == nil || freshList.materials.contains(where: {
                    $0 == replacement && $0.revisionState == "current"
                        && $0.citation?.documentId == document.id
                        && $0.citation?.pageNumber == page.pageNumber
                        && $0.citation?.pageTextSha256 == page.pageTextSha256
                  }) else { throw ResearchDocumentClientError.invalidResponse }
            let readBack = try await client.createResearchDocumentOcrCorrectionNoteAndReadBack(
                membership: membership, document: document, requestBody: request
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  dailyClientAuthorizationIsCurrent(authorization.revision),
                  AppEnvironment.researchAuthorizationContext() == authorization.context,
                  operation.matches(membership: selectedMembership,
                      documentId: selectedResearchDocument?.id,
                      pageNumber: Int(researchDocumentWorkspace.pageNumberText)) else { return }
            researchDocumentWorkspace.list = readBack.list
            researchDocumentWorkspace.selectedPage = readBack.page
            researchDocumentWorkspace.ocrNoteConfirmation = readBack
            researchDocumentWorkspace.replacementOcrNote = nil
            researchDocumentWorkspace.ocrNoteReservation.clear()
            researchDocumentWorkspace.ocrExcerpt = ""
            researchDocumentWorkspace.correctedOcrText = ""
            researchDocumentWorkspace.ocrNoteExplanation = ""
            researchDocumentWorkspace.showOcrNoteEditor = false
            researchDocumentWorkspace.searchEnvelope = nil
            researchDocumentWorkspace.savedSearchEnvelope = nil
            researchFundamentalWorkspace.reconcileSource(materials: readBack.list.materials,
                serverAsOf: readBack.list.generatedAt,
                fundamentalValues: researchFundamentalWorkspace.envelope?.values ?? [])
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "OCR 校对备注已保存；旧冻结展示与确认已清除。")
            invalidateTwoLayerReport("OCR 校对备注已保存；旧报告展示状态已清除。")
            researchDocumentWorkspace.message = "人工 OCR 校对备注已保存并核对原页。原 PDF、OCR 文字和旧材料版本保留；备注仍未核验。"
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.message = "OCR 校对备注未取得可核对的保存结果：\(researchDocumentClientMessage(error))"
        }
    }

    @MainActor
    func deletePersistedResearchMaterial(_ material: ResearchMaterialData) async {
        guard let membership = selectedMembership,
              researchDocumentWorkspace.list?.materials.contains(material) == true else {
            researchDocumentWorkspace.pendingDeletionMaterialId = nil
            researchDocumentWorkspace.message = "材料已变化；请重新读取后再删除。"
            return
        }
        if researchDocumentWorkspace.pendingDeletionMaterialId != material.id {
            researchDocumentWorkspace.pendingDeletionMaterialId = material.id
            researchDocumentWorkspace.message = "再次点击“删除这条材料正文”确认；仅这条摘录材料正文会移出当前材料、搜索材料索引和 AI 上下文，并保留无正文删除记录。独立保存的原始 PDF 或网页原件及旧备份不在本次删除范围。"
            return
        }
        let semantic = [membership.id, String(membership.version), material.id, material.contentFingerprint]
            .joined(separator: "|")
        let key = researchDocumentWorkspace.deletionReservation.reserve(
            for: semantic,
            prefix: "ios-material-delete"
        )
        let request = DeleteResearchMaterialRequest(
            membershipVersion: membership.version,
            idempotencyKey: key
        )
        let authorization = (revision: viewModel.authorizationRevision, context: AppEnvironment.researchAuthorizationContext())
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(membership: membership)
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isDeleting = true
        researchDocumentWorkspace.pendingDeletionMaterialId = nil
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isDeleting = false
            }
        }
        do {
            let readBack = try await client.deleteResearchMaterialAndReadBack(
                membership: membership,
                material: material,
                requestBody: request
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  dailyClientAuthorizationIsCurrent(authorization.revision),
                  AppEnvironment.researchAuthorizationContext() == authorization.context,
                  operation.matches(membership: selectedMembership) else { return }
            researchDocumentWorkspace.list = readBack.list
            researchDocumentWorkspace.searchEnvelope = nil
            researchDocumentWorkspace.savedSearchEnvelope = nil
            if researchDocumentWorkspace.confirmation?.material.id == material.id {
                researchDocumentWorkspace.confirmation = nil
            }
            if researchDocumentWorkspace.ocrNoteConfirmation?.material.id == material.id {
                researchDocumentWorkspace.ocrNoteConfirmation = nil
            }
            if researchDocumentWorkspace.replacementMaterial?.id == material.id {
                researchDocumentWorkspace.replacementMaterial = nil
            }
            if researchDocumentWorkspace.replacementOcrNote?.id == material.id {
                researchDocumentWorkspace.replacementOcrNote = nil
                researchDocumentWorkspace.ocrNoteReservation.clear()
            }
            researchDocumentWorkspace.deletionReservation.clear()
            researchDocumentWorkspace.materialDeletions.removeAll {
                $0.materialId == readBack.deletion.materialId
            }
            researchDocumentWorkspace.materialDeletions.append(readBack.deletion)
            researchDocumentWorkspace.isDeleting = false
            researchFundamentalWorkspace.reconcileSource(
                materials: readBack.list.materials,
                serverAsOf: readBack.list.generatedAt,
                fundamentalValues: researchFundamentalWorkspace.envelope?.values ?? []
            )
            researchValuationScenarioWorkspace.clearFreshSuccess()
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "材料正文已删除；旧冻结展示与确认已清除。"
            )
            invalidateTwoLayerReport("材料正文已删除；旧研究报告状态已清除。")
            await loadResearchFundamentals(refreshDocuments: false)
            let deletion = readBack.deletion
            researchDocumentWorkspace.message =
                "删除凭证：\(deletion.symbol) · material #\(deletion.materialId) · evidence #\(deletion.evidenceId) · state=\(deletion.state) · deletedAt=\(deletion.deletedAt) · SHA-256=\(deletion.contentFingerprint)。这条摘录材料正文已从当前材料、搜索索引和 AI 上下文移除；已启用关键动作自动备份时会保存此删除凭证，也可显式点击“立即备份并验证”。独立保存的原始 PDF 或网页原件及此前备份仍可能保留旧内容。"
            scheduleResearchArchiveAutomaticBackup(
                .deletion("material-\(deletion.materialId)-\(deletion.contentFingerprint)"),
                membership: membership
            )
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.pendingDeletionMaterialId = material.id
            researchDocumentWorkspace.message = researchDocumentClientMessage(error)
        }
    }

    func researchDocumentClientMessage(_ error: Error) -> String {
        if error as? ResearchDocumentClientError == .pdfTooLarge {
            return "PDF 超过客户端导入上限，未发起上传。"
        }
        if case ResearchDocumentClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403: return "未认证或无 user-scoped 权限；旧 PDF 状态已清除。"
            case 404: return "当前 membership、PDF 或页不存在；旧状态已清除。"
            case 409: return "membership、hash、幂等或版本绑定冲突；请刷新后重试。"
            case 413: return "PDF 超过本地服务配置的有界大小、页数或文本限额。"
            case 415: return "文件 MIME 或 PDF signature 无效。"
            case 422: return "PDF 权利、原页、引用原文或 OCR 校对片段校验失败；请重新读取原页。"
            default: return "PDF raw store 或数据库不可用；未显示旧成功。"
            }
        }
        return "PDF 响应无效或网络不可用；未显示旧成功。"
    }
}
