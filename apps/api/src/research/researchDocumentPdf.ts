import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { getDocument, PasswordException } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ResearchDocumentError } from "./domain.js";
import {
  ocrResearchDocumentPages,
  RESEARCH_DOCUMENT_OCR_ENGINE,
  type ResearchDocumentOcrLimits
} from "./researchDocumentOcr.js";

const require = createRequire(import.meta.url);
const PDFJS_STANDARD_FONT_DATA_URL = `${join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")}${sep}`;

export interface ParsedResearchDocumentPage {
  pageNumber: number;
  normalizedText: string;
  pageTextSha256: string;
  textSource: "text_layer" | "ocr" | "blank";
}

export interface ParsedResearchDocumentOcr {
  status: "none" | "applied" | "unavailable";
  engine: typeof RESEARCH_DOCUMENT_OCR_ENGINE | null;
  engineVersion: string | null;
  pageNumbers: number[];
  appliedAt: string | null;
}

export interface ParsedResearchDocument {
  pdfSha256: string;
  byteLength: number;
  pageCount: number;
  pages: ParsedResearchDocumentPage[];
  ocr: ParsedResearchDocumentOcr;
}

export interface ResearchDocumentPdfLimits {
  maxBytes: number;
  maxPages: number;
  maxPageTextCharacters: number;
  maxTotalTextCharacters: number;
}

export async function parseResearchDocumentPdf(
  bytes: Buffer,
  limits: ResearchDocumentPdfLimits,
  ocr?: ResearchDocumentOcrLimits
): Promise<ParsedResearchDocument> {
  if (bytes.length === 0 || bytes.length > limits.maxBytes) {
    throw new ResearchDocumentError(413, "PDF_BYTE_LIMIT", "PDF exceeds the configured byte limit");
  }
  if (!bytes.subarray(0, Math.min(bytes.length, 1024)).includes(Buffer.from("%PDF-"))) {
    throw new ResearchDocumentError(415, "PDF_SIGNATURE_INVALID", "file does not contain a PDF signature");
  }

  let pdf;
  let loadingTask;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(bytes),
      password: "",
      standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL
    });
    pdf = await loadingTask.promise;
  } catch (error) {
    if (error instanceof PasswordException || errorName(error) === "PasswordException") {
      throw new ResearchDocumentError(422, "PDF_ENCRYPTED", "encrypted or password-protected PDFs are not accepted");
    }
    throw new ResearchDocumentError(422, "PDF_UNPARSEABLE", "PDF could not be parsed");
  }

  try {
    if (await pdf.getPermissions() !== null) {
      throw new ResearchDocumentError(422, "PDF_ENCRYPTED", "encrypted or password-protected PDFs are not accepted");
    }
    if (pdf.numPages <= 0) throw new ResearchDocumentError(422, "PDF_UNPARSEABLE", "PDF has no pages");
    if (pdf.numPages > limits.maxPages) {
      throw new ResearchDocumentError(413, "PDF_PAGE_LIMIT", "PDF exceeds the configured page limit");
    }

    const pages: ParsedResearchDocumentPage[] = [];
    let totalTextCharacters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const normalizedText = normalizePdfText(content.items
        .map((item) => typeof item === "object" && item !== null && "str" in item ? String(item.str) : "")
        .join(" "));
      const textSource: ParsedResearchDocumentPage["textSource"] =
        normalizedText.length === 0 || isPageMarkerText(normalizedText) ? "blank" : "text_layer";
      const storedText = textSource === "blank" ? "" : normalizedText;
      if (storedText.length > limits.maxPageTextCharacters) {
        throw new ResearchDocumentError(413, "PDF_PAGE_TEXT_LIMIT", "a PDF page exceeds the configured text limit");
      }
      totalTextCharacters += storedText.length;
      if (totalTextCharacters > limits.maxTotalTextCharacters) {
        throw new ResearchDocumentError(413, "PDF_TOTAL_TEXT_LIMIT", "PDF exceeds the configured total text limit");
      }
      pages.push({
        pageNumber,
        normalizedText: storedText,
        pageTextSha256: sha256Text(storedText),
        textSource
      });
      page.cleanup();
    }
    const ocrResult = await applyLocalOcr(pages, bytes, ocr);
    // The text-layer total was checked before OCR. Recount the final stored
    // text once so text-layer pages are not charged a second time.
    totalTextCharacters = 0;
    for (const page of pages) {
      if (page.normalizedText.length > limits.maxPageTextCharacters) {
        throw new ResearchDocumentError(413, "PDF_PAGE_TEXT_LIMIT", "a PDF page exceeds the configured text limit");
      }
      totalTextCharacters += page.normalizedText.length;
      if (totalTextCharacters > limits.maxTotalTextCharacters) {
        throw new ResearchDocumentError(413, "PDF_TOTAL_TEXT_LIMIT", "PDF exceeds the configured total text limit");
      }
    }
    if (!pages.some((page) => page.normalizedText.length > 0)) {
      throw new ResearchDocumentError(
        422,
        "PDF_TEXT_LAYER_REQUIRED",
        ocrResult.status === "applied" || ocrResult.status === "unavailable"
          ? "PDF page images produced no usable text; import needs page images with legible scanned text"
          : "PDF has no usable searchable text layer and local OCR is unavailable on this host; import a text PDF or enable local OCR"
      );
    }
    return {
      pdfSha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      pageCount: pdf.numPages,
      pages,
      ocr: ocrResult
    };
  } catch (error) {
    if (error instanceof ResearchDocumentError) throw error;
    throw new ResearchDocumentError(422, "PDF_UNPARSEABLE", "PDF text could not be parsed");
  } finally {
    await loadingTask?.destroy();
  }
}

/**
 * Textless pages are OCR'd locally when the trusted helper is configured. Real
 * blank pages may stay blank; an all-empty document remains an actionable
 * failure handled by the caller. OCR text never replaces text-layer text and
 * never rewrites an already-stored page hash.
 */
async function applyLocalOcr(
  pages: ParsedResearchDocumentPage[],
  bytes: Buffer,
  ocr: ResearchDocumentOcrLimits | undefined
): Promise<ParsedResearchDocumentOcr> {
  const empty: ParsedResearchDocumentOcr = {
    status: "none",
    engine: null,
    engineVersion: null,
    pageNumbers: [],
    appliedAt: null
  };
  const textlessPages = pages.filter((page) => page.textSource === "blank");
  if (!ocr || textlessPages.length === 0) return empty;
  const requested = pages.every((page) => page.normalizedText.length === 0)
    ? pages.map((page) => page.pageNumber)
    : textlessPages.map((page) => page.pageNumber);
  if (requested.length > ocr.maxOcrPages) {
    throw new ResearchDocumentError(413, "OCR_PAGE_LIMIT", "PDF needs OCR on more pages than the configured OCR page limit");
  }
  let recognized;
  try {
    recognized = await ocrResearchDocumentPages(bytes, requested, ocr);
  } catch (error) {
    if (pages.some((page) => page.normalizedText.length > 0)) {
      return { ...empty, status: "unavailable" };
    }
    throw error;
  }
  const byPage = new Map(recognized.pages.map((page) => [page.pageNumber, page.text]));
  const ocrPageNumbers: number[] = [];
  for (const page of pages) {
    if (page.normalizedText.length > 0) continue;
    const text = normalizePdfText(byPage.get(page.pageNumber) ?? "");
    if (!text) continue;
    page.normalizedText = text;
    page.pageTextSha256 = sha256Text(text);
    page.textSource = "ocr";
    ocrPageNumbers.push(page.pageNumber);
  }
  // Zero recognized text means no OCR text was stored; report no provenance
  // rather than an "applied" status with an empty page list, which the storage
  // provenance check rejects.
  if (ocrPageNumbers.length === 0) return { ...empty, status: "unavailable" };
  return {
    status: "applied",
    engine: recognized.engine,
    engineVersion: recognized.engineVersion,
    pageNumbers: ocrPageNumbers,
    appliedAt: new Date().toISOString()
  };
}

/**
 * True when a page's digitized text is only a short footer/section marker such
 * as "F-2", "F-10", "- 2 -" or "第2页". Real scans keep a digital page marker
 * on an otherwise image-only page; such a marker is not usable searchable text,
 * so the page is treated as textless (and OCR'd) instead of being kept. Genuine
 * text pages keep their text; nothing is truncated or rewritten here.
 */
export function isPageMarkerText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 24) return false;
  if (/^[\p{L}\p{Script=Han}]{0,6}[\s._\-–—]*\d{1,4}[\s._\-–—]*$/u.test(trimmed)) return true;
  return /^第\s*\d{1,4}\s*[页頁][之總总]*$/u.test(trimmed);
}

export function normalizePdfText(value: string): string {
  return value.normalize("NFKC").replaceAll(/\s+/gu, " ").trim();
}

export function countNormalizedQuote(pageText: string, quote: string): number {
  const normalizedQuote = normalizePdfText(quote);
  if (!normalizedQuote) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= pageText.length - normalizedQuote.length) {
    const found = pageText.indexOf(normalizedQuote, offset);
    if (found < 0) break;
    count += 1;
    offset = found + 1;
  }
  return count;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorName(error: unknown): string | null {
  return typeof error === "object" && error !== null && "name" in error ? String(error.name) : null;
}
