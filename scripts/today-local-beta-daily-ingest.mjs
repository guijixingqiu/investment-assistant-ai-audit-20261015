#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../dist/packages/contracts/src/decisionContextBrowser.js";
import { ingestResearchEvent } from "./holding-event-ingest.mjs";
import { ingestGeelySalesMonitor } from "./geely-sales-ingest.mjs";
import { ingestGclPvPriceMonitor } from "./gcl-price-ingest.mjs";
import { validateCandidateMembershipEnvelope } from "../dist/packages/contracts/src/candidateMembership.js";
import {
  validateCreateResearchMaterialRequest,
  validateDeepResearchWorkspaceEnvelope,
  validateResearchMaterialData
} from "../dist/packages/contracts/src/deepResearch.js";
import { EXCHANGE_ANNOUNCEMENT_LEAD_SOURCE_TYPE } from "../dist/packages/contracts/src/researchEvent.js";
import { researchMaterialFingerprint } from "../dist/apps/api/src/research/deepResearchGate.js";
import { validateMarketDiscoveryEnvelope } from "../dist/packages/contracts/src/marketDiscovery.js";
import { validateResearchWriteEnvelopeBase } from "../dist/packages/contracts/src/research.js";

const MANIFEST_SCHEMA = "2026-07-25.local-beta-daily-ingest.v1";
const RESULT_SCHEMA = "2026-07-25.local-beta-daily-result.v1";
const MAX_INPUT_BYTES = 4_194_304;
const TEMPLATE_PATH = "config/research-monitors/com.annualrings.local-beta-daily.plist.template";
const DISCOVER_RESULT_SCHEMA = "2026-09-12.local-beta-discover.v1";
const DISCOVER_MANIFEST_LITERAL = "discover";
// ponytail: bounded personal watchlist; explicitly expand coverage if more than 10 stocks become necessary.
const DISCOVER_MAX_SYMBOLS = 10;
const DISCOVER_TIMEOUT_MS = 20_000;
const HKEX_LEAD_SOURCE_TYPE = EXCHANGE_ANNOUNCEMENT_LEAD_SOURCE_TYPE;
const HKEX_LEAD_SOURCE_VERSION_PREFIX = "hkexnews-title-search:";
const HKEX_LEAD_VALIDITY_DAYS = 180;
const DEFAULT_API_ORIGIN = "http://127.0.0.1:4010";
const DISCOVER_OMITTED_REASON = "超出每次运行最多 10 个跟踪标的的上限；本次运行不会自动覆盖这些标的，需要在官方来源人工核对，或显式缩小范围后另行运行。";
const DISCOVER_SCOPE_NOTE = "本次只覆盖该接口返回的范围（最近 90 天、每标的最多 10 条公告元数据），不能据此判断没有新事实，需要在官方来源人工扩大范围核对。";
const DISCOVER_LIMITATION = "本次仅覆盖 HKEXnews 官方公告元数据线索（未核验）。lane 不可用、provider 缺失、公告范围上限或仅返回管理类公告都不能证明“没有新的外部事实”，需要在官方来源按标的、按期间人工扩大范围核对。";

export async function runLocalBetaDailyIngest({
  manifest,
  baseUrl = "http://127.0.0.1:4010",
  token,
  headerName = "x-internal-token",
  fetchImpl = fetch,
  ingestors = {
    holding: ingestResearchEvent,
    geely: ingestGeelySalesMonitor,
    gcl: ingestGclPvPriceMonitor
  }
}) {
  validateManifest(manifest);
  if (typeof token !== "string" || !token.trim()) throw new Error("a non-empty Local Beta API token is required");
  const apiToken = token.trim();
  const operations = [
    ...manifest.holdingEvents.map((input, index) => ({ kind: "holding_event", index, input })),
    ...manifest.geelySales.map((input, index) => ({ kind: "geely_sales", index, input })),
    ...manifest.gclPrices.map((input, index) => ({ kind: "gcl_pv_price", index, input }))
  ];
  const results = [];
  for (const operation of operations) {
    try {
      const value = operation.kind === "holding_event"
        ? await ingestors.holding({ baseUrl, token: apiToken, headerName, input: operation.input, fetchImpl })
        : operation.kind === "geely_sales"
          ? await ingestors.geely({ baseUrl, token: apiToken, headerName, input: operation.input, fetchImpl })
          : await ingestors.gcl({ baseUrl, token: apiToken, headerName, input: operation.input, fetchImpl });
      results.push(success(operation, value));
    } catch (error) {
      results.push({
        kind: operation.kind,
        index: operation.index,
        status: "failed",
        error: safeError(error, apiToken)
      });
    }
  }
  const core = {
    schemaVersion: RESULT_SCHEMA,
    runDate: manifest.runDate,
    runId: manifest.runId,
    inputFingerprint: sha256(canonicalJson(manifest)),
    ok: results.every((item) => item.status === "succeeded"),
    processed: results.length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
    safety: {
      loopbackOnly: true,
      advisoryOnly: true,
      callsBroker: false,
      createsOrder: false,
      createsTrade: false,
      mutatesCashFeesPositions: false,
      productionWrite: false
    }
  };
  return { ...core, resultFingerprint: sha256(canonicalJson(core)) };
}

export async function collectDiscoveryLeads({
  baseUrl = DEFAULT_API_ORIGIN,
  token,
  headerName = "x-internal-token",
  fetchImpl = fetch,
  maxSymbols = DISCOVER_MAX_SYMBOLS,
  now = () => new Date()
}) {
  const origin = localApiUrl(baseUrl);
  if (typeof token !== "string" || !token.trim()) throw new Error("a non-empty Local Beta API token is required");
  if (typeof headerName !== "string" || !headerName.trim()) throw new Error("a non-empty Local Beta API auth header name is required");
  if (!Number.isSafeInteger(maxSymbols) || maxSymbols < 1 || maxSymbols > DISCOVER_MAX_SYMBOLS) {
    throw new Error(`maxSymbols must be an integer between 1 and ${DISCOVER_MAX_SYMBOLS}`);
  }
  const apiToken = token.trim();
  const runCutoff = now().toISOString();
  const membershipEnvelope = await getJson(
    new URL("/api/mobile/research/candidate-memberships?includeArchived=false", origin), apiToken, headerName, fetchImpl);
  const membershipValidation = validateCandidateMembershipEnvelope(membershipEnvelope);
  if (!membershipValidation.ok) {
    throw new Error(`candidate membership response failed contract validation: ${membershipValidation.errors.join("; ")}`);
  }
  if (membershipEnvelope.status === "unavailable") throw new Error("candidate membership read is unavailable");
  const tracked = membershipEnvelope.memberships.filter((item) => item.state === "tracked");
  const processed = tracked.slice(0, maxSymbols);
  const omitted = tracked.slice(maxSymbols);
  const results = [];
  for (const membership of processed) {
    results.push(await collectMembershipLeads({ membership, origin, apiToken, headerName, fetchImpl }));
  }
  const totals = {
    collected: sum(results, "collected"),
    unchanged: sum(results, "unchanged"),
    administrativeSkipped: sum(results, "administrativeSkipped"),
    failed: sum(results, "failed")
  };
  const failedSymbols = results.filter((item) => item.status === "failed").length;
  const core = {
    schemaVersion: DISCOVER_RESULT_SCHEMA,
    mode: "discover",
    runCutoff,
    scope: {
      trackedMemberships: tracked.length,
      processedMemberships: processed.length,
      maxSymbolsPerRun: maxSymbols,
      omitted: {
        count: omitted.length,
        symbols: omitted.map((item) => item.symbol),
        reason: omitted.length ? DISCOVER_OMITTED_REASON : null
      },
      emptyScope: tracked.length === 0
    },
    coverage: {
      automatedSource: "hkexnews_official_announcement_metadata",
      futuNoticeLeads: "not_used_in_this_version",
      exhaustive: false,
      note: DISCOVER_LIMITATION
    },
    ok: failedSymbols === 0 && totals.failed === 0 && omitted.length === 0,
    totals,
    results,
    safety: {
      loopbackOnly: true,
      advisoryOnly: true,
      verifiedFactsCreated: false,
      eventsCreated: false,
      callsBroker: false,
      createsOrder: false,
      createsTrade: false,
      mutatesCashFeesPositions: false,
      productionWrite: false
    }
  };
  return { ...core, resultFingerprint: sha256(canonicalJson(core)) };
}

async function collectMembershipLeads({ membership, origin, apiToken, headerName, fetchImpl }) {
  const base = { symbol: membership.symbol, membershipId: membership.id, membershipVersion: membership.version };
  try {
    const envelope = await getJson(
      new URL(`/api/mobile/market/discovery?symbol=${encodeURIComponent(membership.symbol)}`, origin), apiToken, headerName, fetchImpl);
    const validation = validateMarketDiscoveryEnvelope(envelope, membership.symbol);
    if (!validation.ok) {
      return { ...base, status: "failed", collected: 0, unchanged: 0, administrativeSkipped: 0, failed: 1, items: [], reason: `discovery response failed contract validation: ${validation.errors[0] ?? "unknown"}` };
    }
    if (envelope.announcements.status !== "available") {
      return {
        ...base,
        status: "failed",
        collected: 0,
        unchanged: 0,
        administrativeSkipped: 0,
        failed: 1,
        items: [],
        reason: `HKEXnews 官方公告元数据不可用：${text(envelope.announcements.message)}；本次不能判断是否有新事实，需要在官方来源人工核对。`
      };
    }
    const actionable = envelope.announcements.items.filter((item) => item.category !== "administrative");
    const administrativeSkipped = envelope.announcements.items.length - actionable.length;
    if (actionable.length === 0) {
      return {
        ...base,
        status: "skipped",
        collected: 0,
        unchanged: 0,
        administrativeSkipped,
        failed: 0,
        items: [],
        reason: envelope.announcements.items.length === 0
          ? `本次 HKEXnews 返回 0 条公告元数据。${DISCOVER_SCOPE_NOTE}`
          : `本次仅为管理类公告，已按规则跳过并计数。${DISCOVER_SCOPE_NOTE}`
      };
    }
    const existing = await readExistingSourceVersions({ membership, origin, apiToken, headerName, fetchImpl });
    const items = [];
    for (const lead of actionable) {
      const sourceVersion = leadSourceVersion(lead);
      if (existing.has(sourceVersion)) {
        items.push({ id: lead.id, status: "unchanged", sourceVersion });
        continue;
      }
      try {
        const request = leadMaterialRequest(membership, lead);
        const requestValidation = validateCreateResearchMaterialRequest(request);
        if (!requestValidation.ok) throw new Error(requestValidation.errors.join("; "));
        const writeEnvelope = await postJson(
          new URL(`/api/mobile/research/profiles/HK/${membership.code}/materials`, origin), apiToken, headerName, request, fetchImpl);
        assertMaterialEnvelope(writeEnvelope, request, membership.symbol);
        existing.add(sourceVersion);
        items.push({ id: lead.id, status: "collected", sourceVersion, materialId: writeEnvelope.data.id });
      } catch (error) {
        items.push({ id: lead.id, status: "failed", sourceVersion, reason: safeError(error, apiToken) });
      }
    }
    const failed = items.filter((item) => item.status === "failed").length;
    const collected = items.filter((item) => item.status === "collected").length;
    return {
      ...base,
      status: failed === 0 ? (collected > 0 ? "collected" : "unchanged") : (collected > 0 || items.length > failed ? "partial" : "failed"),
      collected,
      unchanged: items.filter((item) => item.status === "unchanged").length,
      administrativeSkipped,
      failed,
      items,
      reason: null
    };
  } catch (error) {
    return { ...base, status: "failed", collected: 0, unchanged: 0, administrativeSkipped: 0, failed: 1, items: [], reason: safeError(error, apiToken) };
  }
}

async function readExistingSourceVersions({ membership, origin, apiToken, headerName, fetchImpl }) {
  const envelope = await getJson(
    new URL(`/api/mobile/research/candidate-memberships/${membership.id}/deep-research`, origin), apiToken, headerName, fetchImpl);
  const validation = validateDeepResearchWorkspaceEnvelope(envelope);
  if (!validation.ok) {
    throw new Error(`research workspace response failed contract validation: ${validation.errors.slice(0, 3).join("; ")}`);
  }
  const data = record(envelope.data) ? envelope.data : null;
  const target = data && record(data.target) ? data.target : null;
  if (envelope.status !== "available" || !data || !target || !Array.isArray(data.materials)) {
    throw new Error(`research workspace is ${text(envelope.status)}; skipped writes to avoid duplicate leads`);
  }
  if (target.membershipId !== membership.id || target.membershipVersion !== membership.version
    || target.symbol !== membership.symbol) {
    throw new Error("research workspace target does not match the requested candidate membership identity and version");
  }
  return new Set(data.materials
    .filter((item) => record(item) && item.sourceType === HKEX_LEAD_SOURCE_TYPE && typeof item.sourceVersion === "string")
    .map((item) => item.sourceVersion));
}

function leadMetadataFingerprint(lead) {
  return sha256(canonicalJson({ id: lead.id, title: lead.title, publishedDate: lead.publishedDate, documentUrl: lead.documentUrl }));
}

function leadSourceVersion(lead) {
  return `${HKEX_LEAD_SOURCE_VERSION_PREFIX}${leadMetadataFingerprint(lead)}`;
}

function leadMaterialRequest(membership, lead) {
  const sourceVersion = leadSourceVersion(lead);
  const publishedAt = `${lead.publishedDate}T00:00:00.000Z`;
  return {
    membershipId: membership.id,
    membershipVersion: membership.version,
    title: lead.title,
    contentText: [
      "未核验公告线索，需打开原文核对，不能据此确认投资影响。",
      `标题：${lead.title}`,
      `公告日期：${lead.publishedDate}`,
      `链接：${lead.documentUrl}`
    ].join("\n"),
    sourceType: HKEX_LEAD_SOURCE_TYPE,
    sourceUrl: lead.documentUrl,
    publishedAt,
    claimType: "issuer_statement",
    verificationStatus: "unverified",
    rightsStatus: "unknown",
    sourceVersion,
    validUntil: new Date(Date.parse(publishedAt) + HKEX_LEAD_VALIDITY_DAYS * 86_400_000).toISOString(),
    summary: `HKEXnews 官方公告元数据线索（未核验）：${lead.title}；仅有标题、公告日期与链接，需打开原文核对后再判断影响。`,
    stance: "neutral",
    isRead: false,
    idempotencyKey: `discover-hkex-${sha256(`${membership.id}|${membership.version}|${leadMetadataFingerprint(lead)}`).slice(0, 40)}`
  };
}

function assertMaterialEnvelope(envelope, request, symbol) {
  const errors = validateResearchWriteEnvelopeBase(envelope, "discover material envelope");
  const data = record(envelope) ? envelope.data : undefined;
  const validation = validateResearchMaterialData(data);
  if (errors.length || !validation.ok || !record(data)) {
    throw new Error(`material response failed contract validation: ${[...errors, ...(validation.ok ? [] : validation.errors)].join("; ")}`);
  }
  if (data.symbol !== symbol || data.sourceType !== HKEX_LEAD_SOURCE_TYPE
    || data.sourceVersion !== request.sourceVersion || data.sourceUrl !== request.sourceUrl
    || data.contentFingerprint !== researchMaterialFingerprint(request.contentText)
    || data.publishedAt !== request.publishedAt || data.verificationStatus !== "unverified"
    || data.rightsStatus !== "unknown" || data.claimType !== "issuer_statement" || data.stance !== "neutral"
    || data.materiality !== null) {
    throw new Error("material response does not bind the requested unverified announcement lead");
  }
}

export function renderLaunchdTemplate(template, paths) {
  for (const [name, value] of Object.entries(paths)) {
    if (name === "apiOrigin") continue;
    if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) {
      if (name === "manifestPath" && value === DISCOVER_MANIFEST_LITERAL) continue;
      throw new Error(`${name} must be an absolute path`);
    }
  }
  const apiOrigin = paths.apiOrigin ?? DEFAULT_API_ORIGIN;
  localApiUrl(apiOrigin);
  const replacements = {
    "__REPOSITORY_ROOT__": paths.repositoryRoot,
    "__MANIFEST_PATH__": paths.manifestPath,
    "__TOKEN_FILE_PATH__": paths.tokenFilePath,
    "__LOG_DIRECTORY__": paths.logDirectory,
    "__API_ORIGIN__": apiOrigin
  };
  let rendered = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!rendered.includes(placeholder)) {
      if (placeholder === "__API_ORIGIN__") continue;
      throw new Error(`launchd template is missing ${placeholder}`);
    }
    rendered = rendered.replaceAll(placeholder, xml(value));
  }
  if (/__[A-Z_]+__/.test(rendered)) throw new Error("launchd template contains an unresolved placeholder");
  return rendered;
}

function success(operation, value) {
  if (operation.kind === "holding_event") {
    return {
      kind: operation.kind,
      index: operation.index,
      status: "succeeded",
      identity: {
        materialId: value.material.id,
        eventId: value.event.id,
        eventVersion: value.event.eventVersion,
        eventFingerprint: value.event.eventFingerprint
      }
    };
  }
  return {
    kind: operation.kind,
    index: operation.index,
    status: "succeeded",
    identity: {
      runId: value.id,
      runVersion: value.runVersion,
      runFingerprint: value.runFingerprint,
      assessmentStatus: value.assessment.status
    }
  };
}

function validateManifest(value) {
  exact(value, ["schemaVersion", "runDate", "runId", "holdingEvents", "geelySales", "gclPrices"], "manifest");
  if (value.schemaVersion !== MANIFEST_SCHEMA) throw new Error("manifest schemaVersion is invalid");
  const timestamp = Date.parse(`${value.runDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.runDate) || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value.runDate) throw new Error("manifest runDate is invalid");
  if (typeof value.runId !== "string" || !/^[A-Za-z0-9._:-]{1,180}$/.test(value.runId)) {
    throw new Error("manifest runId is invalid");
  }
  for (const key of ["holdingEvents", "geelySales", "gclPrices"]) {
    if (!Array.isArray(value[key]) || value[key].length > 50) throw new Error(`manifest ${key} must contain at most 50 rows`);
  }
  if (value.holdingEvents.length + value.geelySales.length + value.gclPrices.length === 0) {
    throw new Error("manifest must contain at least one bounded ingestion input");
  }
}

async function readJsonFile(path) {
  const absolute = resolve(path);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("manifest must be a regular non-symlink JSON file no larger than 4 MiB");
  }
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function readToken() {
  const path = process.env.LOCAL_BETA_API_TOKEN_FILE;
  if (!path) throw new Error("LOCAL_BETA_API_TOKEN_FILE is required");
  const absolute = resolve(path);
  const metadata = await lstat(absolute);
  if (!isSecureTokenFile(metadata)) {
    throw new Error("LOCAL_BETA_API_TOKEN_FILE must be non-empty, at most 4 KiB, owner-readable, regular, non-symlink, and mode 0600 or stricter");
  }
  const token = (await readFile(absolute, "utf8")).trim();
  if (!token) throw new Error("LOCAL_BETA_API_TOKEN_FILE is empty");
  return token;
}

async function renderLaunchd(args) {
  if (args.length !== 5) {
    throw new Error("usage: render-launchd <manifest.json|discover> <token-file> <log-directory> <new-output.plist>");
  }
  const manifestPath = args[1] === DISCOVER_MANIFEST_LITERAL ? DISCOVER_MANIFEST_LITERAL : resolve(args[1]);
  const [tokenFilePath, logDirectory, outputPath] = args.slice(2).map((value) => resolve(value));
  const apiOrigin = process.env.LOCAL_BETA_API_URL ?? DEFAULT_API_ORIGIN;
  localApiUrl(apiOrigin);
  if (manifestPath !== DISCOVER_MANIFEST_LITERAL) validateManifest(await readJsonFile(manifestPath));
  const tokenMetadata = await lstat(tokenFilePath);
  const logMetadata = await lstat(logDirectory);
  if (!isSecureTokenFile(tokenMetadata)) {
    throw new Error("launchd token file must be non-empty, at most 4 KiB, owner-readable, regular, non-symlink, and mode 0600 or stricter");
  }
  if (!logMetadata.isDirectory() || logMetadata.isSymbolicLink()) throw new Error("launchd log directory must be a regular directory");
  const repositoryRoot = resolve(".");
  const template = await readFile(resolve(repositoryRoot, TEMPLATE_PATH), "utf8");
  const rendered = renderLaunchdTemplate(template, { repositoryRoot, manifestPath, tokenFilePath, logDirectory, apiOrigin });
  await writeFile(outputPath, rendered, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: manifestPath === DISCOVER_MANIFEST_LITERAL ? "discover" : "manifest",
    apiOrigin,
    outputPath,
    installed: false,
    bootstrapRequired: true
  })}\n`);
}

async function main(args = process.argv.slice(2)) {
  if (args[0] === "render-launchd") return renderLaunchd(args);
  if (args[0] === "discover") {
    if (args.length !== 1) throw new Error("usage: today-local-beta-daily-ingest discover");
    const result = await collectDiscoveryLeads({
      baseUrl: process.env.LOCAL_BETA_API_URL ?? DEFAULT_API_ORIGIN,
      token: await readToken(),
      headerName: process.env.LOCAL_BETA_API_AUTH_HEADER
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (args.length !== 1) throw new Error("usage: today-local-beta-daily-ingest <manifest.json>");
  const result = await runLocalBetaDailyIngest({
    manifest: await readJsonFile(args[0]),
    baseUrl: process.env.LOCAL_BETA_API_URL,
    token: await readToken(),
    headerName: process.env.LOCAL_BETA_API_AUTH_HEADER
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

function safeError(error, token) {
  return (error instanceof Error ? error.message : String(error)).replaceAll(token, "[redacted]").slice(0, 1000);
}
function localApiUrl(value) {
  let url;
  try {
    url = new URL(typeof value === "string" ? value : "");
  } catch {
    throw new Error("LOCAL_BETA_API_URL must be a credential-free loopback origin");
  }
  if (!["http:", "https:"].includes(url.protocol)
    || !["127.0.0.1", "::1", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("LOCAL_BETA_API_URL must be a credential-free loopback origin");
  }
  return url;
}
async function getJson(url, token, headerName, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", [headerName]: token },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS)
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${record(value) && typeof value.message === "string" ? value.message.slice(0, 300) : "request failed"}`);
  }
  if (!record(value)) throw new Error("response is not a JSON object");
  return value;
}
async function postJson(url, token, headerName, body, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", [headerName]: token },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS)
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const failures = record(value) && Array.isArray(value.failures) ? value.failures.filter((item) => typeof item === "string").slice(0, 5) : [];
    const message = record(value) && typeof value.message === "string" ? value.message.slice(0, 300) : `HTTP ${response.status}`;
    throw new Error([message, ...failures.map((item) => item.slice(0, 200))].join("; "));
  }
  if (!record(value)) throw new Error("response is not a JSON object");
  return value;
}
function record(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function text(value) { return typeof value === "string" ? value.slice(0, 300) : "unknown"; }
function sum(items, key) { return items.reduce((total, item) => total + (Number.isSafeInteger(item[key]) ? item[key] : 0), 0); }
function isSecureTokenFile(metadata) {
  return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0 && metadata.size <= 4096
    && (metadata.mode & 0o400) !== 0 && (metadata.mode & 0o077) === 0;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function xml(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} fields are invalid`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
