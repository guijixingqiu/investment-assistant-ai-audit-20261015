import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { WebApiClient } from "../dist/apps/web/src/apiClient.js";
import { candidateOverviewFromEnvelope, failClosedCandidateOverview } from "../dist/apps/web/src/candidateOverviewState.js";

const fixture = JSON.parse(await readFile("apps/web/test-fixtures/candidate-overview.json", "utf8"));
const calls = [];

globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  assert.equal(path, "/api/mobile/research/candidates");
  assert(!path.includes("/orders"));
  assert(!path.includes("/trades"));
  assert(!path.includes("/fills"));
  assert(!path.includes("/cash"));
  assert(!path.includes("/fees"));
  assert(!path.includes("/positions"));
  const headers = Object.fromEntries(new Headers(options.headers ?? {}).entries());
  calls.push({ path, method: options.method, headers });
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["x-research-write-token"], "fixture-token");
  return new Response(JSON.stringify(fixture), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

const client = new WebApiClient();
const loaded = await client.loadCandidateOverview({ headerName: "x-research-write-token", token: "fixture-token" });
assert.equal(loaded.ok, true);
const model = candidateOverviewFromEnvelope(loaded.value);
assert.deepEqual(model.candidates.map((candidate) => candidate.symbol), ["HK.00005", "HK.09926", "HK.00700"]);
assert.equal(model.candidates[0].quote.status, "stale");
assert.equal(model.candidates[2].quote.status, "unavailable");

const unauthorized = failClosedCandidateOverview("unauthorized", "Runtime token is required.");
assert.equal(unauthorized.candidates.length, 0);

console.log(JSON.stringify({
  ok: true,
  smoke: "web-candidate-overview",
  requestCount: calls.length,
  candidateSymbols: model.candidates.map((candidate) => candidate.symbol),
  quoteStates: model.candidates.map((candidate) => candidate.quote.status),
  tradingSideEffectRequests: 0,
  unauthorizedCards: unauthorized.candidates.length
}, null, 2));
