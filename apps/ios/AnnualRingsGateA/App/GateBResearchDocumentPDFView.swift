import PDFKit
import SwiftUI

struct ResearchDocumentPDFPresentation: Identifiable {
    let id = UUID()
    let title: String
    let data: Data
    let pageNumber: Int
}

struct ResearchDocumentPDFView: UIViewRepresentable {
    let data: Data
    let pageNumber: Int

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.displayMode = .singlePage
        view.autoScales = true
        return view
    }

    func updateUIView(_ pdfView: PDFView, context: Context) {
        guard let document = PDFDocument(data: data),
              let page = document.page(at: pageNumber - 1) else {
            pdfView.document = nil
            return
        }
        pdfView.document = document
        DispatchQueue.main.async {
            pdfView.go(to: page)
        }
    }
}

extension GateBResearchScreen {
    @MainActor
    func openSelectedResearchDocumentPDF(document: ResearchDocumentData, page: ResearchDocumentPageData) async {
        guard let membership = selectedMembership, document.isSourceAvailable,
              researchDocumentWorkspace.selectedPage == page,
              selectedResearchDocument?.id == document.id else { return }
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership, documentId: document.id, pageNumber: page.pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        do {
            let freshPage = try await client.fetchResearchDocumentPage(
                membership: membership, documentId: document.id, pageNumber: page.pageNumber
            )
            guard freshPage == page else { throw ResearchDocumentClientError.invalidResponse }
            let bytes = try await client.fetchResearchDocumentContent(membership: membership, document: document)
            guard researchDocumentWorkspace.requestRevision == revision,
                  operation.matches(membership: selectedMembership,
                      documentId: selectedResearchDocument?.id,
                      pageNumber: Int(researchDocumentWorkspace.pageNumberText)),
                  researchDocumentWorkspace.selectedPage == page else { return }
            presentResearchDocumentPDF(document: document, pageNumber: page.pageNumber, data: bytes)
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.pdfPresentation = nil
            researchDocumentWorkspace.message = researchDocumentClientMessage(error)
        }
    }

    @MainActor
    func openConfirmedResearchDocumentPDF(_ confirmation: ResearchDocumentConfirmationReadBack) async {
        guard confirmation.document.isSourceAvailable else {
            researchDocumentWorkspace.message = "原 PDF 缺失或校验失败；不能重新打开。"
            return
        }
        guard let membership = selectedMembership else { return }
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership,
            documentId: confirmation.document.id,
            pageNumber: confirmation.page.pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        do {
            let data = try await client.fetchResearchDocumentContent(
                membership: membership,
                document: confirmation.document
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  operation.matches(
                    membership: selectedMembership,
                    documentId: selectedResearchDocument?.id,
                    pageNumber: confirmation.page.pageNumber
                  ),
                  researchDocumentWorkspace.confirmation == confirmation else { return }
            presentResearchDocumentPDF(
                document: confirmation.document,
                pageNumber: confirmation.page.pageNumber,
                data: data
            )
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.message = researchDocumentClientMessage(error)
        }
    }

    @MainActor
    func openPersistedResearchDocumentCitation(
        document: ResearchDocumentData,
        material: ResearchMaterialData
    ) async {
        guard document.isSourceAvailable else {
            researchDocumentWorkspace.message = "原 PDF 缺失或校验失败；既有引用仍保留，但当前不能重新核对。"
            return
        }
        guard let membership = selectedMembership,
              let citation = material.citation else { return }
        let revision = UUID()
        let operation = ResearchDocumentOperationIdentity(
            membership: membership,
            documentId: document.id,
            pageNumber: citation.pageNumber
        )
        researchDocumentWorkspace.requestRevision = revision
        researchDocumentWorkspace.isLoading = true
        defer {
            if researchDocumentWorkspace.requestRevision == revision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        do {
            let readBack = try await client.readPersistedResearchDocumentCitation(
                membership: membership,
                document: document,
                material: material
            )
            guard researchDocumentWorkspace.requestRevision == revision,
                  operation.matches(
                    membership: selectedMembership,
                    documentId: selectedResearchDocument?.id,
                    pageNumber: readBack.page.pageNumber
                  ),
                  researchDocumentWorkspace.list?.materials.contains(material) == true else { return }
            researchDocumentWorkspace.selectedPage = readBack.page
            presentResearchDocumentPDF(
                document: readBack.document,
                pageNumber: readBack.page.pageNumber,
                data: readBack.pdfData
            )
        } catch {
            guard researchDocumentWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.message = researchDocumentClientMessage(error)
        }
    }

    func presentResearchDocumentPDF(document: ResearchDocumentData, pageNumber: Int, data: Data) {
        guard researchDocumentPDFContainsPage(data, pageNumber: pageNumber) else {
            researchDocumentWorkspace.pdfPresentation = nil
            researchDocumentWorkspace.message = "PDF 无法解析或不包含第 \(pageNumber) 页；未显示定位成功。"
            return
        }
        researchDocumentWorkspace.pdfPresentation = ResearchDocumentPDFPresentation(
            title: document.title,
            data: data,
            pageNumber: pageNumber
        )
        researchDocumentWorkspace.message = "PDFKit 已定位同一内容寻址 PDF 的第 \(pageNumber) 页。"
    }
}
