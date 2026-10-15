import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { ResearchDocumentError } from "./domain.js";

const execFileAsync = promisify(execFile);

export const RESEARCH_DOCUMENT_OCR_ENGINE = "apple_vision_pdfkit" as const;
export const RESEARCH_DOCUMENT_OCR_MODE = "local_pdfkit_vision" as const;

export interface ResearchDocumentOcrLimits {
  /** Absolute path of the trusted, explicitly configured helper binary. Null disables OCR. */
  executablePath: string | null | undefined;
  maxOcrPages: number;
  maxOcrPageTextCharacters: number;
  ocrTimeoutMs: number;
  ocrMaxBufferBytes: number;
}

export interface ResearchDocumentOcrPage {
  pageNumber: number;
  text: string;
}

export interface ResearchDocumentOcrResult {
  engine: typeof RESEARCH_DOCUMENT_OCR_ENGINE;
  engineVersion: string;
  pages: ResearchDocumentOcrPage[];
}

/**
 * Recognizes text locally for the requested pages using the configured Apple
 * PDFKit + Vision helper. The helper location is explicitly configured by the
 * trusted runtime; nothing here is taken from client input, and the PDF bytes
 * are written to a bounded private temp file instead of being interpolated into
 * a shell command.
 */
export async function ocrResearchDocumentPages(
  pdfBytes: Buffer,
  pageNumbers: number[],
  limits: ResearchDocumentOcrLimits
): Promise<ResearchDocumentOcrResult> {
  const executablePath = limits.executablePath;
  if (!executablePath || !isAbsolute(executablePath) || executablePath.includes("\0")) {
    throw new ResearchDocumentError(
      503,
      "OCR_UNAVAILABLE",
      "local OCR helper is not configured; scanned pages stay unsearchable on this host"
    );
  }
  if (pdfBytes.length === 0) {
    throw new ResearchDocumentError(422, "OCR_INPUT_INVALID", "OCR requires non-empty PDF bytes");
  }
  const uniquePages = [...new Set(pageNumbers)].sort((left, right) => left - right);
  if (uniquePages.length === 0 || uniquePages.length > limits.maxOcrPages
    || uniquePages.some((pageNumber) => !Number.isSafeInteger(pageNumber) || pageNumber <= 0)) {
    throw new ResearchDocumentError(413, "OCR_PAGE_LIMIT", "requested OCR pages exceed the configured OCR page limit");
  }
  try {
    await access(executablePath, constants.X_OK);
  } catch {
    throw new ResearchDocumentError(503, "OCR_UNAVAILABLE", "local OCR helper is missing or not executable");
  }

  const directory = await mkdtemp(join(tmpdir(), "research-document-ocr-"));
  const pdfPath = join(directory, "input.pdf");
  try {
    await writeFile(pdfPath, pdfBytes, { mode: 0o600, flag: "wx" });
    let stdout: string;
    try {
      const result = await execFileAsync(
        executablePath,
        [pdfPath, uniquePages.join(",")],
        {
          timeout: limits.ocrTimeoutMs,
          maxBuffer: limits.ocrMaxBufferBytes,
          windowsHide: true,
          env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" }
        }
      );
      stdout = result.stdout;
    } catch (error) {
      throw new ResearchDocumentError(503, "OCR_FAILED", ocrFailureMessage(error));
    }
    return parseOcrOutput(stdout, uniquePages, limits);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseOcrOutput(
  stdout: string,
  requestedPages: number[],
  limits: ResearchDocumentOcrLimits
): ResearchDocumentOcrResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ResearchDocumentError(503, "OCR_OUTPUT_INVALID", "local OCR helper returned malformed JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ResearchDocumentError(503, "OCR_OUTPUT_INVALID", "local OCR helper returned an unexpected payload");
  }
  const record = parsed as Record<string, unknown>;
  const engineVersion = record.engineVersion;
  if (record.engine !== RESEARCH_DOCUMENT_OCR_ENGINE
    || typeof engineVersion !== "string" || engineVersion.length === 0 || engineVersion.length > 100
    || !Array.isArray(record.pages)) {
    throw new ResearchDocumentError(503, "OCR_OUTPUT_INVALID", "local OCR helper provenance is invalid");
  }
  const requested = new Set(requestedPages);
  const pages: ResearchDocumentOcrPage[] = [];
  for (const entry of record.pages) {
    if (typeof entry !== "object" || entry === null) {
      throw new ResearchDocumentError(503, "OCR_OUTPUT_INVALID", "local OCR helper page entry is invalid");
    }
    const page = entry as Record<string, unknown>;
    const pageNumber = page.pageNumber;
    const text = page.text;
    if (!Number.isSafeInteger(pageNumber) || !requested.has(Number(pageNumber))
      || typeof text !== "string" || text.length > limits.maxOcrPageTextCharacters) {
      throw new ResearchDocumentError(503, "OCR_OUTPUT_INVALID", "local OCR helper page facts are out of bounds");
    }
    if (pages.some((existing) => existing.pageNumber === Number(pageNumber))) {
      throw new ResearchDocumentError(503, "OCR_OUTPUT_INVALID", "local OCR helper returned a duplicate page result");
    }
    pages.push({ pageNumber: Number(pageNumber), text });
  }
  // Every requested page must come back exactly once (empty text is valid);
  // a subset would silently mark missing pages as confirmed-OCR'd.
  if (pages.length !== requested.size || requestedPages.some(
    (pageNumber) => !pages.some((page) => page.pageNumber === pageNumber)
  )) {
    throw new ResearchDocumentError(503, "OCR_OUTPUT_INVALID", "local OCR helper did not return every requested page exactly once");
  }
  return { engine: RESEARCH_DOCUMENT_OCR_ENGINE, engineVersion, pages };
}

function ocrFailureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = "code" in error ? String(error.code) : "";
    const killed = "killed" in error && error.killed === true;
    if (code === "ETIMEDOUT" || killed) {
      return "local OCR helper exceeded the configured timeout";
    }
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return "local OCR helper exceeded the configured output bound";
    }
  }
  return "local OCR helper failed on this host";
}
