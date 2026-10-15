import CryptoKit
import Foundation

extension ResearchClient {
    public func listResearchSourceSnapshots(membership: CandidateMembershipData) async throws -> [ResearchSourceSnapshotData] {
        let url = researchSourceSnapshotsURL(membership: membership)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let result = try JSONDecoder().decode(ResearchSourceSnapshotResponse<[ResearchSourceSnapshotData]>.self, from: data)
        guard result.ok, result.data.allSatisfy({ $0.validates(expected: membership, requireText: false) }) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return result.data
    }

    public func readResearchSourceSnapshot(membership: CandidateMembershipData, snapshotId: String) async throws -> ResearchSourceSnapshotData {
        guard researchDocumentIsPositiveIntegerString(snapshotId) else { throw ResearchDocumentClientError.invalidResponse }
        var request = URLRequest(url: researchSourceSnapshotsURL(membership: membership).appending(path: snapshotId),
                                 cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let result = try JSONDecoder().decode(ResearchSourceSnapshotResponse<ResearchSourceSnapshotData>.self, from: data)
        guard result.ok, result.data.id == snapshotId,
              result.data.validates(expected: membership, requireText: true) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return result.data
    }

    public func readResearchSourceSnapshotOriginal(membership: CandidateMembershipData,
                                                   snapshot: ResearchSourceSnapshotData) async throws -> Data {
        guard snapshot.validates(expected: membership, requireText: true) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        var request = URLRequest(url: researchSourceSnapshotsURL(membership: membership)
            .appending(path: snapshot.id).appending(path: "content"), cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        guard let http = response as? HTTPURLResponse,
              http.value(forHTTPHeaderField: "x-source-raw-sha256") == snapshot.rawSha256,
              data.count == snapshot.byteLength,
              researchDocumentSha256(data) == snapshot.rawSha256 else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return data
    }

    public func captureResearchSourceSnapshot(membership: CandidateMembershipData,
                                              url: String, idempotencyKey: String) async throws -> ResearchSourceSnapshotData {
        var request = URLRequest(url: researchSourceSnapshotsURL(membership: membership))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(CaptureResearchSourceSnapshotRequest(
            membershipVersion: membership.version, url: url, idempotencyKey: idempotencyKey))
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let result = try JSONDecoder().decode(ResearchSourceSnapshotResponse<ResearchSourceSnapshotData>.self, from: data)
        guard result.ok, result.data.validates(expected: membership, requireText: true) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return result.data
    }

    public func confirmResearchSourceSnapshotMaterial(membership: CandidateMembershipData,
                                                       snapshot: ResearchSourceSnapshotData,
                                                       citation: ResearchSnapshotCitation,
                                                       validUntil: String,
                                                       idempotencyKey: String) async throws -> ResearchMaterialData {
        guard snapshot.validates(expected: membership, requireText: true),
              snapshot.membershipVersion == membership.version,
              snapshot.reviewState != "historical", snapshot.reviewState != "pending_review",
              snapshot.publishedAt != nil,
              citation.snapshotId == snapshot.id,
              citation.textSha256 == snapshot.textSha256,
              let selected = snapshot.selectedCitation(range: NSRange(location: citation.startUtf16,
                                                                      length: citation.endUtf16 - citation.startUtf16)),
              selected.0 == citation, !selected.1.isEmpty else {
            throw ResearchDocumentClientError.invalidResponse
        }
        var request = URLRequest(url: researchSourceSnapshotsURL(membership: membership)
            .appending(path: snapshot.id).appending(path: "materials"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(ConfirmResearchSourceSnapshotMaterialRequest(
            membershipVersion: membership.version, citation: citation, validUntil: validUntil,
            idempotencyKey: idempotencyKey))
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let result = try JSONDecoder().decode(ResearchSourceSnapshotResponse<ResearchWriteEnvelope<ResearchMaterialData>>.self, from: data)
        let write = result.data
        guard result.ok, write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded", write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.validates(expected: membership),
              write.data.snapshotCitation == citation,
              write.data.snapshotOriginal?.rawSha256 == snapshot.rawSha256,
              write.data.contentText == selected.1 else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard let current = fresh.data?.materials.first(where: { $0.id == write.data.id }),
              current == write.data else { throw ResearchDocumentClientError.invalidResponse }
        return current
    }

    private func researchSourceSnapshotsURL(membership: CandidateMembershipData) -> URL {
        baseURL.appending(path: "api").appending(path: "mobile")
            .appending(path: "research").appending(path: "candidate-memberships")
            .appending(path: membership.id).appending(path: "source-snapshots")
    }

    public func fetchResearchDocuments(membership: CandidateMembershipData) async throws -> ResearchDocumentListEnvelope {
        var request = URLRequest(
            url: researchDocumentsURL(membershipId: membership.id),
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let envelope = try JSONDecoder().decode(ResearchDocumentListEnvelope.self, from: data)
        try envelope.validate(expected: membership)
        return envelope
    }

    public func searchResearchDocuments(
        membership: CandidateMembershipData,
        query: String
    ) async throws -> ResearchDocumentSearchEnvelope {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var components = URLComponents(
            url: researchDocumentsURL(membershipId: membership.id).appending(path: "search"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "q", value: normalizedQuery)]
        guard let url = components?.url else { throw ResearchDocumentClientError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let envelope = try JSONDecoder().decode(ResearchDocumentSearchEnvelope.self, from: data)
        try envelope.validate(expected: membership, query: normalizedQuery)
        return envelope
    }

    public func searchSavedSources(membership: CandidateMembershipData, query: String) async throws
        -> ResearchSavedSourceSearchEnvelope {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var components = URLComponents(url: researchDocumentsURL(membershipId: membership.id)
            .appending(path: "saved-sources").appending(path: "search"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: normalizedQuery)]
        guard let url = components?.url else { throw ResearchDocumentClientError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let envelope = try JSONDecoder().decode(ResearchSavedSourceSearchEnvelope.self, from: data)
        try envelope.validate(expected: membership, query: normalizedQuery)
        return envelope
    }

    public func fetchResearchDocumentPage(
        membership: CandidateMembershipData,
        documentId: String,
        pageNumber: Int
    ) async throws -> ResearchDocumentPageData {
        let url = researchDocumentsURL(membershipId: membership.id)
            .appending(path: documentId)
            .appending(path: "pages")
            .appending(path: String(pageNumber))
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let page = try JSONDecoder().decode(ResearchDocumentPageData.self, from: data)
        guard page.documentId == documentId,
              page.pageNumber == pageNumber,
              researchDocumentIsSha256(page.pageTextSha256),
              researchDocumentSha256(Data(page.normalizedText.utf8)) == page.pageTextSha256 else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return page
    }

    public func fetchResearchDocumentContent(
        membership: CandidateMembershipData,
        document: ResearchDocumentData
    ) async throws -> Data {
        let url = researchDocumentsURL(membershipId: membership.id)
            .appending(path: document.id)
            .appending(path: "content")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let signature = Data("%PDF-".utf8)
        let prefix = data.prefix(1_024)
        guard data.count == document.byteLength,
              prefix.range(of: signature) != nil,
              researchDocumentSha256(data) == document.pdfSha256 else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return data
    }

    public func importResearchDocument(
        membership: CandidateMembershipData,
        metadata: ImportResearchDocumentMetadata,
        filename: String,
        pdfBytes: Data
    ) async throws -> ResearchWriteEnvelope<ResearchDocumentImportData> {
        guard pdfBytes.count <= ResearchDocumentClientLimits.maxPDFBytes else {
            throw ResearchDocumentClientError.pdfTooLarge
        }
        let boundary = "ResearchDocument-\(UUID().uuidString)"
        let uploadFilename = sanitizedMultipartFilename(filename)
        var body = Data()
        body.appendMultipart("--\(boundary)\r\n")
        body.appendMultipart("Content-Disposition: form-data; name=\"metadata\"\r\n")
        body.appendMultipart("Content-Type: application/json\r\n\r\n")
        body.append(try JSONEncoder().encode(metadata))
        body.appendMultipart("\r\n--\(boundary)\r\n")
        body.appendMultipart("Content-Disposition: form-data; name=\"file\"; filename=\"\(uploadFilename)\"\r\n")
        body.appendMultipart("Content-Type: application/pdf\r\n\r\n")
        body.append(pdfBytes)
        body.appendMultipart("\r\n--\(boundary)--\r\n")

        var request = URLRequest(url: researchDocumentsURL(membershipId: membership.id))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        let (data, response) = try await session.upload(for: request, from: body)
        try validateResearchDocumentResponse(response)
        let envelope = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchDocumentImportData>.self, from: data)
        let document = envelope.data.document
        guard envelope.schemaVersion == "2026-06-18.research-write.v1",
              envelope.status == "succeeded",
              envelope.source.actorType == "user",
              envelope.source.actorId == membership.actorId,
              envelope.source.correlationId == nil,
              ["created", "deduplicated"].contains(envelope.data.result),
              document.membershipId == membership.id,
              document.market == membership.market,
              document.code == membership.code,
              document.symbol == membership.symbol,
              document.membershipVersionAtImport == membership.version,
              document.title == metadata.title,
              document.originalFilename == uploadFilename,
              document.sourceVersion == metadata.sourceVersion,
              document.rightsStatus == "user_provided",
              document.sourceState == "available",
              document.byteLength == pdfBytes.count,
              document.pdfSha256 == researchDocumentSha256(pdfBytes) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let readBack = try await fetchResearchDocuments(membership: membership)
        guard readBack.documents.contains(document) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return envelope
    }

    public func confirmResearchDocumentFactAndReadBack(
        membership: CandidateMembershipData,
        document: ResearchDocumentData,
        requestBody: ConfirmResearchDocumentFactRequest
    ) async throws -> ResearchDocumentConfirmationReadBack {
        let url = researchDocumentsURL(membershipId: membership.id)
            .appending(path: document.id)
            .appending(path: "confirmed-facts")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchMaterialData>.self, from: data)
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.source.correlationId == nil,
              write.data.contentText == normalizedResearchDocumentText(requestBody.quote),
              write.data.summary == requestBody.statement,
              write.data.replacesMaterialId == requestBody.replacesMaterialId,
              write.data.revisionState == "current",
              write.data.validates(expected: membership) else {
            throw ResearchDocumentClientError.invalidResponse
        }

        let list = try await fetchResearchDocuments(membership: membership)
        guard let freshDocument = list.documents.first(where: { $0.id == document.id }),
              freshDocument == document,
              let material = list.materials.first(where: { $0.id == write.data.id }),
              material == write.data,
              material.citation?.documentId == document.id,
              material.citation?.pageNumber == requestBody.pageNumber,
              researchMaterialReplacementReadBackIsExact(
                list.materials,
                targetId: requestBody.replacesMaterialId,
                child: write.data
              ) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let page = try await fetchResearchDocumentPage(
            membership: membership,
            documentId: document.id,
            pageNumber: requestBody.pageNumber
        )
        guard material.validatesPDFCitation(document: document, page: page),
              material.contentText == normalizedResearchDocumentText(requestBody.quote),
              material.summary == requestBody.statement,
              countNormalizedResearchDocumentOccurrences(in: page.normalizedText, quote: requestBody.quote) == 1 else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return ResearchDocumentConfirmationReadBack(document: document, page: page, material: material, list: list)
    }

    public func createResearchDocumentOcrCorrectionNoteAndReadBack(
        membership: CandidateMembershipData,
        document: ResearchDocumentData,
        requestBody: CreateResearchDocumentOcrCorrectionNoteRequest
    ) async throws -> ResearchDocumentOcrCorrectionReadBack {
        guard requestBody.membershipVersion == membership.version,
              document.membershipId == membership.id,
              researchDocumentIsSha256(requestBody.pageTextSha256),
              !normalizedResearchDocumentText(requestBody.ocrExcerpt).isEmpty,
              !normalizedResearchDocumentText(requestBody.correctedText).isEmpty else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let url = researchDocumentsURL(membershipId: membership.id)
            .appending(path: document.id).appending(path: "ocr-correction-notes")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateResearchDocumentResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchMaterialData>.self, from: data)
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded", write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.source.correlationId == nil,
              write.data.contentText == requestBody.contentText,
              write.data.summary == "人工 OCR 校对备注，尚未核验原文或事实",
              write.data.replacesMaterialId == requestBody.replacesMaterialId,
              write.data.revisionState == "current",
              write.data.validates(expected: membership) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let list = try await fetchResearchDocuments(membership: membership)
        guard let freshDocument = list.documents.first(where: { $0.id == document.id }),
              freshDocument == document,
              let material = list.materials.first(where: { $0.id == write.data.id }),
              material == write.data,
              researchMaterialReplacementReadBackIsExact(
                list.materials, targetId: requestBody.replacesMaterialId, child: material
              ) else { throw ResearchDocumentClientError.invalidResponse }
        let page = try await fetchResearchDocumentPage(
            membership: membership, documentId: document.id, pageNumber: requestBody.pageNumber
        )
        guard page.pageTextSha256 == requestBody.pageTextSha256,
              countNormalizedResearchDocumentOccurrences(in: page.normalizedText,
                quote: requestBody.ocrExcerpt) > 0,
              material.validatesOcrCorrectionCitation(document: document, page: page) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return ResearchDocumentOcrCorrectionReadBack(document: document, page: page,
            material: material, list: list)
    }

    public func readPersistedResearchDocumentCitation(
        membership: CandidateMembershipData,
        document: ResearchDocumentData,
        material: ResearchMaterialData
    ) async throws -> ResearchDocumentPersistedCitationReadBack {
        guard let citation = material.citation, citation.documentId == document.id else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let page = try await fetchResearchDocumentPage(
            membership: membership,
            documentId: document.id,
            pageNumber: citation.pageNumber
        )
        guard material.sourceType == "owner_ocr_correction_note"
                ? material.validatesOcrCorrectionCitation(document: document, page: page)
                : material.validatesPDFCitation(document: document, page: page) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let pdfData = try await fetchResearchDocumentContent(membership: membership, document: document)
        return ResearchDocumentPersistedCitationReadBack(
            document: document,
            page: page,
            material: material,
            pdfData: pdfData
        )
    }

    public func deleteResearchMaterialAndReadBack(
        membership: CandidateMembershipData,
        material: ResearchMaterialData,
        requestBody: DeleteResearchMaterialRequest
    ) async throws -> ResearchMaterialDeletionReadBack {
        let url = researchMaterialDeletionURL(membershipId: membership.id, materialId: material.id)
        var writeRequest = URLRequest(url: url)
        writeRequest.httpMethod = "POST"
        writeRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &writeRequest)
        writeRequest.httpBody = try JSONEncoder().encode(requestBody)
        let (writeData, writeResponse) = try await session.data(for: writeRequest)
        try validateResearchDocumentResponse(writeResponse)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchMaterialDeletionData>.self, from: writeData)
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.source.correlationId == nil,
              write.data.validates(expected: membership, material: material) else {
            throw ResearchDocumentClientError.invalidResponse
        }

        var readRequest = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &readRequest)
        let (readData, readResponse) = try await session.data(for: readRequest)
        try validateResearchDocumentResponse(readResponse)
        let deletion = try JSONDecoder().decode(ResearchMaterialDeletionData.self, from: readData)
        guard deletion == write.data,
              deletion.validates(expected: membership, material: material) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        let list = try await fetchResearchDocuments(membership: membership)
        guard !list.materials.contains(where: { $0.id == material.id }) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return ResearchMaterialDeletionReadBack(deletion: deletion, list: list)
    }

    private func researchDocumentsURL(membershipId: String) -> URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
            .appending(path: "documents")
    }

    private func researchMaterialDeletionURL(membershipId: String, materialId: String) -> URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
            .appending(path: "materials")
            .appending(path: materialId)
            .appending(path: "deletion")
    }

    private func validateResearchDocumentResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw ResearchDocumentClientError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            throw ResearchDocumentClientError.httpStatus(http.statusCode)
        }
    }
}

func researchMaterialReplacementReadBackIsExact(
    _ materials: [ResearchMaterialData],
    targetId: String?,
    child: ResearchMaterialData
) -> Bool {
    guard let targetId else { return true }
    guard Set(materials.map(\.id)).count == materials.count else { return false }
    let targets = materials.filter { $0.id == targetId && $0.revisionState == "replaced" }
    let children = materials.filter {
        $0.replacesMaterialId == targetId && $0.revisionState == "current"
    }
    return targets.count == 1 && children.count == 1 && children[0] == child
}

public func researchDocumentSha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func sanitizedMultipartFilename(_ value: String) -> String {
    let sanitized = value.replacingOccurrences(of: "\"", with: "")
        .replacingOccurrences(of: "\r", with: "")
        .replacingOccurrences(of: "\n", with: "")
    return sanitized.isEmpty ? "document.pdf" : String(sanitized.prefix(500))
}

private extension Data {
    mutating func appendMultipart(_ value: String) {
        append(Data(value.utf8))
    }
}
