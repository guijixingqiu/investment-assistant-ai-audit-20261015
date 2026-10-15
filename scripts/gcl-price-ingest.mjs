#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateCreateGclPvPriceMonitorRequest,
  validateGclPvPriceMonitorData
} from "../dist/packages/contracts/src/gclPvPriceMonitor.js";
import { validateResearchWriteEnvelopeBase } from "../dist/packages/contracts/src/research.js";

const INPUT_MAX_BYTES = 1_048_576;
const TOP_LEVEL_KEYS = [
  "schemaVersion", "membershipId", "membershipVersion", "period", "referencePeriod",
  "priceObservations", "contextObservations", "ingestionKey"
];

export async function ingestGclPvPriceMonitor({
  baseUrl,
  token,
  headerName = "x-internal-token",
  input,
  fetchImpl = fetch
}) {
  const api = localApiUrl(baseUrl);
  const normalized = validateInput(input);
  const request = {
    membershipVersion: normalized.membershipVersion,
    period: normalized.period,
    referencePeriod: normalized.referencePeriod,
    priceObservations: normalized.priceObservations,
    contextObservations: normalized.contextObservations,
    idempotencyKey: `${normalized.ingestionKey}-monitor`
  };
  const validation = validateCreateGclPvPriceMonitorRequest(request);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  if (!token?.trim() || !headerName?.trim()) throw new Error("LOCAL_BETA_API_TOKEN and a non-empty auth header are required");
  const response = await fetchImpl(
    new URL(`/api/mobile/research/candidate-memberships/${normalized.membershipId}/gcl-pv-price-monitors`, api),
    {
      method: "POST",
      headers: { "content-type": "application/json", [headerName]: token },
      body: JSON.stringify(request)
    }
  );
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    const message = record(envelope) && typeof envelope.message === "string" ? envelope.message : `HTTP ${response.status}`;
    const failures = record(envelope) && Array.isArray(envelope.failures) ? envelope.failures.filter((item) => typeof item === "string") : [];
    throw new Error([message, ...failures].join("; "));
  }
  const errors = validateResearchWriteEnvelopeBase(envelope, "GCL photovoltaic price monitor envelope");
  const result = validateGclPvPriceMonitorData(record(envelope) ? envelope.data : undefined);
  if (errors.length || !result.ok) throw new Error([...errors, ...(result.ok ? [] : result.errors)].join("; "));
  if (envelope.data.membershipId !== normalized.membershipId
    || envelope.data.membershipVersion !== normalized.membershipVersion
    || envelope.data.period !== normalized.period
    || envelope.data.referencePeriod !== normalized.referencePeriod
    || envelope.data.symbol !== "HK.03800") {
    throw new Error("GCL photovoltaic response does not bind the requested candidate, version, and periods");
  }
  return envelope.data;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("usage: npm run gcl-price-ingest -- /absolute/path/to/input.json");
  const absolute = resolve(inputPath);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > INPUT_MAX_BYTES) {
    throw new Error("input must be a regular non-symlink JSON file no larger than 1 MiB");
  }
  const data = await ingestGclPvPriceMonitor({
    baseUrl: process.env.LOCAL_BETA_API_URL ?? "http://127.0.0.1:4010",
    token: process.env.LOCAL_BETA_API_TOKEN,
    headerName: process.env.LOCAL_BETA_API_AUTH_HEADER ?? "x-internal-token",
    input: JSON.parse(await readFile(absolute, "utf8"))
  });
  console.log(JSON.stringify({ ok: true, monitor: data }, null, 2));
}

function validateInput(value) {
  if (!record(value)) throw new Error("input must be an object");
  const unknown = Object.keys(value).filter((key) => !TOP_LEVEL_KEYS.includes(key));
  if (unknown.length) throw new Error(`input contains unsupported keys: ${unknown.join(", ")}`);
  if (value.schemaVersion !== "2026-07-25.gcl-price-ingest.v1") throw new Error("input schemaVersion is invalid");
  if (!/^[1-9]\d*$/.test(String(value.membershipId)) || !Number.isSafeInteger(value.membershipVersion) || value.membershipVersion <= 0) {
    throw new Error("input membership identity is invalid");
  }
  if (typeof value.ingestionKey !== "string" || !/^[A-Za-z0-9._:-]{1,180}$/.test(value.ingestionKey)) {
    throw new Error("ingestionKey must use 1-180 stable ASCII identifier characters");
  }
  return value;
}

function localApiUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "::1", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("LOCAL_BETA_API_URL must be a credential-free loopback origin");
  }
  return url;
}

function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
