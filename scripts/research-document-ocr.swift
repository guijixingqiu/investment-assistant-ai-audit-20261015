// Local scanned-PDF OCR helper for the investment-assistant research document lane.
//
// Usage: research-document-ocr <absolute-pdf-path> <comma-separated-page-numbers>
//
// Renders only the requested (textless) PDF pages with PDFKit and recognizes text
// with Apple Vision, then prints one JSON object on stdout:
//   {"engine":"apple_vision_pdfkit","engineVersion":"...","revision":N,
//    "pages":[{"pageNumber":1,"text":"..."}]}
//
// The "pages" array must contain every requested page exactly once (empty text
// is allowed); the backend rejects a subset, a duplicate, or an extra page.
//
// Guardrails: no network, no cloud service, no OCR of client-supplied text. The
// helper only reads the local PDF bytes handed to it by the trusted backend.

import Foundation
import PDFKit
import Vision
import CoreGraphics
import AppKit

let maxRenderedPagePixels = 12_000_000
let renderScale: CGFloat = 2.5
let maxCharactersPerPage = 200_000

enum HelperFailure: Error {
    case usage(String)
    case pdf(String)
    case render(String)
    case vision(String)
}

func fail(_ failure: HelperFailure) -> Never {
    let message: String
    switch failure {
    case .usage(let value): message = "OCR_HELPER_USAGE: \(value)"
    case .pdf(let value): message = "OCR_HELPER_PDF: \(value)"
    case .render(let value): message = "OCR_HELPER_RENDER: \(value)"
    case .vision(let value): message = "OCR_HELPER_VISION: \(value)"
    }
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(2)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fail(.usage("expected <absolute-pdf-path> <comma-separated-page-numbers>"))
}

let pdfPath = arguments[1]
guard pdfPath.hasPrefix("/"), !pdfPath.contains("\0") else {
    fail(.usage("pdf path must be an absolute path"))
}

let pageNumbers: [Int] = arguments[2].split(separator: ",").map(String.init).compactMap { raw in
    guard let value = Int(raw), value > 0 else { return nil }
    return value
}
guard !pageNumbers.isEmpty, pageNumbers.count <= 100 else {
    fail(.usage("expected 1 to 100 positive page numbers"))
}

guard let document = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
    fail(.pdf("PDF could not be opened locally"))
}
guard !document.isEncrypted else {
    fail(.pdf("encrypted PDFs are not accepted"))
}
guard !document.isLocked else {
    fail(.pdf("locked PDFs are not accepted"))
}

let osVersion = ProcessInfo.processInfo.operatingSystemVersion
let engineVersion = "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"

struct RenderedPage {
    let pageNumber: Int
    let image: CGImage
}

func render(_ pageNumber: Int) -> CGImage {
    guard pageNumber <= document.pageCount, let page = document.page(at: pageNumber - 1) else {
        fail(.render("page \(pageNumber) does not exist in the PDF"))
    }
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0, bounds.height > 0 else {
        fail(.render("page \(pageNumber) has no renderable bounds"))
    }
    let scale = min(renderScale, max(1.0, sqrt(Double(maxRenderedPagePixels) / Double(bounds.width * bounds.height))))
    let pixelWidth = Int((bounds.width * CGFloat(scale)).rounded())
    let pixelHeight = Int((bounds.height * CGFloat(scale)).rounded())
    guard pixelWidth > 0, pixelHeight > 0, pixelWidth * pixelHeight <= maxRenderedPagePixels else {
        fail(.render("page \(pageNumber) exceeds the bounded render area"))
    }
    guard let context = CGContext(
        data: nil,
        width: pixelWidth,
        height: pixelHeight,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else {
        fail(.render("page \(pageNumber) rendering context could not be created"))
    }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
    context.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    context.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: context)
    guard let image = context.makeImage() else {
        fail(.render("page \(pageNumber) could not be rasterized"))
    }
    return image
}

func recognize(_ image: CGImage, pageNumber: Int) -> (text: String, revision: Int) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fail(.vision("page \(pageNumber) recognition failed: \((error as NSError).localizedDescription)"))
    }
    let observations = request.results ?? []
    let text = observations
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n")
    return (text, request.revision)
}

var payloadPages: [[String: Any]] = []
var revision = 0
for pageNumber in pageNumbers {
    let image = render(pageNumber)
    let recognized = recognize(image, pageNumber: pageNumber)
    revision = recognized.revision
    let trimmed = recognized.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count <= maxCharactersPerPage else {
        fail(.vision("page \(pageNumber) exceeded the bounded OCR character count"))
    }
    payloadPages.append(["pageNumber": pageNumber, "text": trimmed])
}

let payload: [String: Any] = [
    "engine": "apple_vision_pdfkit",
    "engineVersion": engineVersion,
    "revision": revision,
    "pages": payloadPages
]
guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
    fail(.vision("OCR result could not be serialized"))
}
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
