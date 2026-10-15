import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { WebApiClient } from "../dist/apps/web/src/apiClient.js";
import { deriveCoreJourneyNextAction } from "../dist/apps/web/src/coreJourneyNextAction.js";
import { deriveCoreJourneyStages } from "../dist/apps/web/src/coreJourneyState.js";
import { deriveReviewFeedback } from "../dist/apps/web/src/reviewFeedback.js";

const fixture = JSON.parse(await readFile("apps/web/test-fixtures/core-journey.json", "utf8"));
const symbol = { market: "HK", code: "00175", symbol: "HK.00175" };

globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  assert(!path.includes("/orders"));
  assert(!path.includes("/trades"));
  assert(!path.includes("/fills"));
  assert(!path.includes("/cash"));
  assert(!path.includes("/fees"));
  assert(!path.includes("/positions/mutate"));
  const headers = Object.fromEntries(new Headers(options.headers ?? {}).entries());
  assert.equal(headers.authorization, undefined);
  const body = route(path, options);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

const client = new WebApiClient();
const loaded = await client.loadJourney(symbol, { headerName: "x-research-write-token", token: "fixture-token" });
assert.equal(loaded.ok, true);
const stages = deriveCoreJourneyStages({
  symbol,
  quote: loaded.quote,
  research: loaded.research,
  decisionContext: loaded.decisionContext,
  pingan: loaded.pingan,
  reviewHistory: loaded.reviewHistory,
  submittedCheck: null,
  submittedReview: null
});
assert.deepEqual(stages.map((stage) => stage.id), ["quote", "research", "pingan", "decision", "review"]);
assert.deepEqual(stages.map((stage) => stage.state), ["ready", "ready", "stale", "pending", "pending"]);
const nextAction = deriveCoreJourneyNextAction({
  stages,
  decisionEnabled: true,
  reviewEnabled: false,
  loadEnabled: true
});
assert.equal(nextAction.kind, "continue_with_pingan_limitation");
assert.equal(nextAction.operation, "decision");
assert.equal(nextAction.enabled, true);
const feedback = deriveReviewFeedback({
  stages,
  symbol: symbol.symbol,
  currentDecisionContext: loaded.decisionContext,
  submittedCheck: fixture.decisionCheck,
  submittedReview: fixture.review,
  reviewHistory: loaded.reviewHistory,
  pingan: {
    ...loaded.pingan,
    positions: [{ ...loaded.pingan.positions[0], currentWeight: 0.12, maxWeight: 0.12 }]
  }
});
assert.equal(feedback.state, "ready");
assert.deepEqual(feedback.items.map((item) => item.kind), ["evidence_gap", "historical_concentration"]);
assert(!/\b(buy|sell|hold|price target|position-size|allocation)\b/i.test(JSON.stringify(feedback)));

const malformed = await client.loadJourney({ market: "HK", code: "00000", symbol: "HK.00000" }, null);
assert.equal(malformed.ok, false);

console.log(JSON.stringify({
  ok: true,
  smoke: "web-core-journey",
  symbol: symbol.symbol,
  stages: stages.map((stage) => ({ id: stage.id, state: stage.state })),
  nextAction: nextAction.kind,
  feedbackKinds: feedback.items.map((item) => item.kind),
  tradingSideEffectRequests: 0
}, null, 2));

function route(path, options) {
  if (path.endsWith("/HK/00000")) return { ...fixture.quote, schemaVersion: "bad" };
  if (path === "/api/mobile/market/quotes/HK/00175") return fixture.quote;
  if (path === "/api/mobile/research/profiles/HK/00175") return fixture.research;
  if (path === "/api/mobile/research/decision-context/HK/00175") return fixture.decisionContext;
  if (path === "/api/mobile/research/portfolio/pingan-snapshot/HK/00175") return fixture.pingan;
  if (path === "/api/mobile/research/profiles/HK/00175/decision-reviews") return fixture.reviewHistory;
  if (path === "/api/mobile/research/profiles/HK/00175/decision-checks") {
    const body = JSON.parse(options.body);
    assert.equal(body.contextId, fixture.decisionContext.contextId);
    return fixture.decisionCheck;
  }
  throw new Error(`unexpected route ${path}`);
}
