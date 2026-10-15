#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateCreateResearchMaterialRequest,
  validateResearchMaterialData
} from "../dist/packages/contracts/src/deepResearch.js";
import {
  validateCreateResearchEventRequest,
  validateResearchAnnouncementEventData
} from "../dist/packages/contracts/src/researchEvent.js";
import { validateResearchWriteEnvelopeBase } from "../dist/packages/contracts/src/research.js";
import { sameResearchMonitorRuleContent } from "../dist/packages/contracts/src/researchMonitorRule.js";

const INPUT_MAX_BYTES = 1_048_576;
const OFFICIAL_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
const TOP_LEVEL_KEYS = [
  "schemaVersion", "membershipId", "membershipVersion", "market", "code",
  "ingestionKey", "eventKind", "coverageScope", "material", "officialDocument",
  "monitorRuleBinding"
];

export async function ingestResearchEvent({
  baseUrl,
  token,
  headerName = "x-internal-token",
  input,
  fetchImpl = fetch
}) {
  const api = localApiUrl(baseUrl);
  const normalized = validateInput(input);
  if (normalized.officialDocument) {
    await verifyOfficialResearchDocument(normalized.material, normalized.officialDocument, fetchImpl);
  }
  const materialRequest = {
    ...normalized.material,
    membershipId: normalized.membershipId,
    membershipVersion: normalized.membershipVersion,
    idempotencyKey: `${normalized.ingestionKey}-material`
  };
  const eventRequest = {
    membershipVersion: normalized.membershipVersion,
    eventKind: normalized.eventKind,
    coverageScope: normalized.coverageScope,
    materialId: "1",
    idempotencyKey: `${normalized.ingestionKey}-event`
  };
  if (normalized.monitorRuleBinding !== undefined && normalized.monitorRuleBinding !== null) {
    eventRequest.monitorRuleBinding = normalized.monitorRuleBinding;
  }
  const materialValidation = validateCreateResearchMaterialRequest(materialRequest);
  const eventValidation = validateCreateResearchEventRequest(eventRequest);
  if (!materialValidation.ok) throw new Error(materialValidation.errors.join("; "));
  if (!eventValidation.ok) throw new Error(eventValidation.errors.join("; "));
  if (!token?.trim() || !headerName?.trim()) throw new Error("LOCAL_BETA_API_TOKEN and a non-empty auth header are required");
  const materialEnvelope = await post(
    new URL(`/api/mobile/research/profiles/${normalized.market}/${normalized.code}/materials`, api),
    token,
    headerName,
    materialRequest,
    fetchImpl
  );
  assertEnvelope(materialEnvelope, validateResearchMaterialData, "material");
  const material = materialEnvelope.data;
  if (material.symbol !== `${normalized.market}.${normalized.code}`) throw new Error("material response symbol does not match the requested security");
  eventRequest.materialId = material.id;
  const eventEnvelope = await post(
    new URL(`/api/mobile/research/candidate-memberships/${normalized.membershipId}/research-events`, api),
    token,
    headerName,
    eventRequest,
    fetchImpl
  );
  assertEnvelope(eventEnvelope, validateResearchAnnouncementEventData, "event");
  const event = eventEnvelope.data;
  if (event.membershipId !== normalized.membershipId || event.membershipVersion !== normalized.membershipVersion
    || event.symbol !== material.symbol || event.source.materialId !== material.id
    || event.source.contentFingerprint !== material.contentFingerprint
    || event.source.sourceVersion !== material.sourceVersion) {
    throw new Error("event response does not bind the exact material, membership, and security");
  }
  if (eventRequest.monitorRuleBinding !== undefined
    && (event.monitorRuleBinding === null
      || event.monitorRuleBinding.version !== eventRequest.monitorRuleBinding.version
      || event.monitorRuleBinding.confirmedAt !== eventRequest.monitorRuleBinding.confirmedAt
      || !sameResearchMonitorRuleContent(event.monitorRuleBinding, eventRequest.monitorRuleBinding))) {
    throw new Error("event response does not bind the requested monitor rule");
  }
  return { material, event };
}

export async function verifyOfficialResearchDocument(material, officialDocument, fetchImpl = fetch) {
  const url = new URL(material.sourceUrl);
  const response = await fetchImpl(url, {
    headers: { accept: "application/pdf" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`official document fetch failed: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/pdf") throw new Error("official document must use application/pdf");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > OFFICIAL_DOCUMENT_MAX_BYTES) {
    throw new Error("official document exceeds 20 MiB");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > OFFICIAL_DOCUMENT_MAX_BYTES
    || !bytes.subarray(0, Math.min(bytes.length, 1024)).includes(Buffer.from("%PDF-"))) {
    throw new Error("official document is not a bounded PDF");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== officialDocument.sha256) throw new Error("official document SHA-256 does not match the bound source version");
  return { sourceUrl: url.href, sha256, byteLength: bytes.length };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("usage: npm run holding-event-ingest -- /absolute/path/to/input.json");
  const absolute = resolve(inputPath);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > INPUT_MAX_BYTES) {
    throw new Error("input must be a regular non-symlink JSON file no larger than 1 MiB");
  }
  const input = JSON.parse(await readFile(absolute, "utf8"));
  const result = await ingestResearchEvent({
    baseUrl: process.env.LOCAL_BETA_API_URL ?? "http://127.0.0.1:4010",
    token: process.env.LOCAL_BETA_API_TOKEN,
    headerName: process.env.LOCAL_BETA_API_AUTH_HEADER ?? "x-internal-token",
    input
  });
  console.log(JSON.stringify({ ok: true, materialId: result.material.id, event: result.event }, null, 2));
}

function validateInput(value) {
  if (!record(value)) throw new Error("input must be an object");
  const unknown = Object.keys(value).filter((key) => !TOP_LEVEL_KEYS.includes(key));
  if (unknown.length) throw new Error(`input contains unsupported keys: ${unknown.join(", ")}`);
  if (value.schemaVersion !== "2026-07-25.holding-event-ingest.v1") throw new Error("input schemaVersion is invalid");
  if (!/^[1-9]\d*$/.test(String(value.membershipId)) || !Number.isSafeInteger(value.membershipVersion)
    || value.membershipVersion <= 0 || value.market !== "HK" || !/^\d{5}$/.test(String(value.code))) {
    throw new Error("input membership and Hong Kong security identity are invalid");
  }
  if (typeof value.ingestionKey !== "string" || !/^[A-Za-z0-9._:-]{1,180}$/.test(value.ingestionKey)) {
    throw new Error("ingestionKey must use 1-180 stable ASCII identifier characters");
  }
  if (!record(value.material)) throw new Error("input.material is required");
  if (value.officialDocument !== undefined) validateOfficialDocument(value.officialDocument, value.material);
  if (value.monitorRuleBinding !== undefined && !record(value.monitorRuleBinding)) {
    throw new Error("monitorRuleBinding must be an object when present");
  }
  return value;
}

function validateOfficialDocument(value, material) {
  if (!record(value) || Object.keys(value).length !== 1 || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("officialDocument must contain exactly one lowercase SHA-256");
  }
  let url;
  try { url = new URL(material.sourceUrl); } catch { throw new Error("official document sourceUrl is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || material.sourceType !== "issuer_disclosure" || material.claimType !== "issuer_statement"
    || material.verificationStatus !== "verified" || material.rightsStatus !== "authorized_public"
    || material.sourceVersion !== `official-pdf-sha256:${value.sha256}`) {
    throw new Error("official document must bind one HTTPS authorized issuer PDF and its exact SHA-256 source version");
  }
}

function localApiUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)
    || !["127.0.0.1", "::1", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("LOCAL_BETA_API_URL must be a credential-free loopback origin");
  }
  return url;
}

async function post(url, token, headerName, body, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", [headerName]: token },
    body: JSON.stringify(body)
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = record(value) && typeof value.message === "string" ? value.message : `HTTP ${response.status}`;
    const failures = record(value) && Array.isArray(value.failures) ? value.failures.filter((item) => typeof item === "string") : [];
    throw new Error([message, ...failures].join("; "));
  }
  return value;
}

function assertEnvelope(envelope, validateData, label) {
  const errors = validateResearchWriteEnvelopeBase(envelope, `${label} envelope`);
  const validation = validateData(record(envelope) ? envelope.data : undefined);
  if (errors.length || !validation.ok) throw new Error(`${label} response failed contract validation: ${[...errors, ...(validation.ok ? [] : validation.errors)].join("; ")}`);
}

function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
