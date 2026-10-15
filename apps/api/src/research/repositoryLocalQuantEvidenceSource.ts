import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  QuantEvidenceAddress,
  QuantEvidenceSource,
  QuantEvidenceSourceResult
} from "./quantEvidenceSource.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export const repositoryLocalQuantEvidenceSource: QuantEvidenceSource = {
  read: readRepositoryLocalQuantEvidence
};

async function readRepositoryLocalQuantEvidence(
  address: QuantEvidenceAddress
): Promise<QuantEvidenceSourceResult> {
  const lexical = validateAddress(address);
  if (!lexical.ok) return lexical.result;

  const root = await canonicalRepositoryRoot(lexical.repositoryRoot, lexical.path);
  if (!root.ok) return root.result;

  let sourcePath: string;
  try {
    sourcePath = await realpath(lexical.path);
  } catch (error) {
    return readFailure(error, lexical.path, "not-generated");
  }
  if (!isWithinRoot(root.path, sourcePath)) {
    return malformed("repository-path-outside-root", lexical.path);
  }
  try {
    if (!(await stat(sourcePath)).isFile()) {
      return malformed("repository-path-not-file", lexical.path);
    }
  } catch (error) {
    return readFailure(error, lexical.path, "not-generated");
  }

  let content: Buffer;
  try {
    content = await readFile(sourcePath);
  } catch (error) {
    return readFailure(error, lexical.path, "not-generated");
  }

  if (!address.expectedSha256 || !SHA256_PATTERN.test(address.expectedSha256)) {
    return malformed("content-address-required", lexical.path);
  }
  const contentHash = createHash("sha256").update(content).digest("hex");
  if (contentHash !== address.expectedSha256.toLowerCase()) {
    return malformed("content-address-mismatch", lexical.path);
  }
  return { ok: true, content: content.toString("utf8"), contentHash, path: lexical.path };
}

function validateAddress(address: QuantEvidenceAddress):
  | { ok: true; repositoryRoot: string; path: string }
  | { ok: false; result: QuantEvidenceSourceResult } {
  if (!address.repositoryRoot || !isAbsolute(address.repositoryRoot)) {
    return { ok: false, result: malformed("repository-root-must-be-absolute", null) };
  }
  if (!address.repositoryPath || isAbsolute(address.repositoryPath) || address.repositoryPath.includes("\0")) {
    return { ok: false, result: malformed("repository-path-must-be-relative", null) };
  }
  const repositoryRoot = resolve(address.repositoryRoot);
  const path = resolve(repositoryRoot, address.repositoryPath);
  if (!isWithinRoot(repositoryRoot, path)) {
    return { ok: false, result: malformed("repository-path-outside-root", path) };
  }
  return { ok: true, repositoryRoot, path };
}

async function canonicalRepositoryRoot(
  repositoryRoot: string,
  requestedPath: string
): Promise<{ ok: true; path: string } | { ok: false; result: QuantEvidenceSourceResult }> {
  let path: string;
  try {
    path = await realpath(repositoryRoot);
    if (!(await stat(path)).isDirectory()) {
      return { ok: false, result: malformed("repository-root-not-directory", requestedPath) };
    }
  } catch (error) {
    const failure = readFailure(error, requestedPath, "repository-root-unavailable");
    return {
      ok: false,
      result: failure.status === "missing"
        ? { ...failure, status: "unavailable", reason: "repository-root-unavailable" }
        : failure
    };
  }
  return { ok: true, path };
}

function isWithinRoot(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function readFailure(
  error: unknown,
  path: string,
  missingReason: string
): Extract<QuantEvidenceSourceResult, { ok: false }> {
  const code = errorCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") {
    return { ok: false, status: "missing", reason: missingReason, path };
  }
  if (code === "EACCES" || code === "EPERM") {
    return { ok: false, status: "unauthorized", reason: "source-read", path };
  }
  return { ok: false, status: "unavailable", reason: "source-read", path };
}

function malformed(
  reason: string,
  path: string | null
): Extract<QuantEvidenceSourceResult, { ok: false }> {
  return { ok: false, status: "malformed", reason, path };
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
