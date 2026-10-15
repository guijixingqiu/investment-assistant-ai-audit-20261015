import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { candidateOverviewFromEnvelope, failClosedCandidateOverview } from "../dist/apps/web/src/candidateOverviewState.js";
import { render } from "../dist/apps/web/src/view.js";

const fixture = JSON.parse(await readFile("apps/web/test-fixtures/candidate-overview.json", "utf8"));
const coreFixture = JSON.parse(await readFile("apps/web/test-fixtures/core-journey.json", "utf8"));
const candidateModel = candidateOverviewFromEnvelope({
  ...fixture,
  candidates: [
    { ...fixture.candidates[0], name: "<script>bad()</script>" },
    ...fixture.candidates.slice(1)
  ]
});

function baseRenderModel(candidateOverview) {
  return {
    stages: [{ id: "quote", title: "Quote", state: "pending", message: "Pending." }],
    symbol: null,
    details: [],
    authMemoryOnly: true,
    decisionEnabled: false,
    reviewEnabled: false,
    busy: false,
    nextAction: {
      kind: "load_symbol",
      operation: "load",
      title: "Load symbol",
      explanation: "Load a canonical Hong Kong symbol.",
      enabled: true
    },
    reviewFeedback: {
      state: "pending",
      title: "Review feedback pending",
      detail: "No review loaded.",
      items: []
    },
    candidateOverview,
    candidateBusy: false
  };
}

function installDom() {
  const ids = [
    "current-symbol",
    "auth-mode",
    "stages",
    "next-action-card",
    "review-feedback-card",
    "details",
    "load-action",
    "candidate-refresh",
    "decision-submit",
    "review-submit",
    "candidate-overview",
    "candidate-status",
    "candidate-list",
    "auth-header-name",
    "auth-token",
    "symbol-input",
    "decision-action",
    "decision-result",
    "decision-note",
    "review-outcome",
    "review-evidence",
    "review-note"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element("div", id)]));
  elements["auth-header-name"].value = "x-research-write-token";
  elements["auth-token"].value = "runtime-only";
  elements["symbol-input"].value = "HK.00175";
  elements["decision-action"].value = "watch";
  elements["decision-result"].value = "needs_more_evidence";
  elements["decision-note"].value = "";
  elements["review-outcome"].value = "insufficient_evidence";
  elements["review-evidence"].value = "";
  elements["review-note"].value = "";
  globalThis.document = {
    getElementById(id) {
      return elements[id] ?? null;
    },
    createElement(tagName) {
      return new Element(tagName);
    }
  };
  globalThis.HTMLElement = Element;
  globalThis.HTMLButtonElement = Element;
  return elements;
}

function byId(id) {
  const element = document.getElementById(id);
  assert(element, `missing ${id}`);
  return element;
}

function findCandidateOpenButtons(root) {
  const found = [];
  visit(root);
  return found;

  function visit(element) {
    if (element.tagName === "button" && element.dataset.testid === "candidate-open") found.push(element);
    for (const child of element.children) visit(child);
  }
}

function stageState(stageId) {
  const stage = byId("stages").children.find((item) => item.dataset.testid === `stage-${stageId}`);
  return stage?.attributes["data-state"] ?? null;
}

class Element {
  constructor(tagName, id = null) {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this._textContent = "";
    this._innerHTML = "";
    this.disabled = false;
    this.type = "";
    this.className = "";
    this.value = "";
    this.parentElement = null;
    this.listeners = {};
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return [this._textContent, ...this.children.map((child) => child.textContent)].join("");
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    this._textContent = "";
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...children) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  click() {
    const event = { target: this };
    let current = this;
    while (current) {
      for (const listener of current.listeners.click ?? []) listener(event);
      current = current.parentElement;
    }
  }

  closest(selector) {
    if (selector !== "button[data-candidate-symbol]") return null;
    let current = this;
    while (current) {
      if (current.tagName === "button" && typeof current.dataset.candidateSymbol === "string") return current;
      current = current.parentElement;
    }
    return null;
  }
}

installDom();
render(baseRenderModel(candidateModel));

const section = byId("candidate-overview");
const status = byId("candidate-status");
const list = byId("candidate-list");
assert.equal(section.attributes["data-state"], "available");
assert.match(status.textContent, /Tracked Hong Kong candidates loaded/);
assert.equal(list.children.length, 3);
assert.deepEqual(list.children.map((child) => child.attributes["data-symbol"]), ["HK.00005", "HK.09926", "HK.00700"]);
assert.equal(list.children[0].textContent.includes("<script>bad()</script>"), true);
assert.equal(list.children[0].innerHTML.includes("<script>"), false);
assert.equal(list.children[0].attributes["data-quote-state"], "stale");
assert.match(list.children[0].textContent, /quote_time_exceeds_live_max_age/);
assert.equal(list.children[2].attributes["data-quote-state"], "unavailable");
assert.match(list.children[2].textContent, /missing source/);
assert.equal(findCandidateOpenButtons(list).map((button) => button.dataset.candidateSymbol).join(","), "HK.00005,HK.09926,HK.00700");

render(baseRenderModel(failClosedCandidateOverview("unauthorized", "Runtime token is required before loading tracked candidates.")));
assert.equal(byId("candidate-overview").attributes["data-state"], "unauthorized");
assert.equal(byId("candidate-list").children.length, 1);
assert.equal(byId("candidate-list").children[0].dataset.testid, "candidate-empty-state");

installDom();
const fetchCalls = [];
let candidateDeferred = deferred();
const pendingInitialJourney = new Map();
let holdInitialJourney = true;

globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  assert(!path.includes("/orders"));
  assert(!path.includes("/trades"));
  assert(!path.includes("/fills"));
  assert(!path.includes("/cash"));
  assert(!path.includes("/fees"));
  assert(!path.includes("/positions"));
  fetchCalls.push({ path, headers: Object.fromEntries(new Headers(options.headers ?? {}).entries()) });
  if (path === "/api/mobile/research/candidates") return candidateDeferred.promise;
  const match = path.match(/^\/api\/mobile\/(?:market\/quotes|research\/(?:profiles|decision-context|portfolio\/pingan-snapshot))\/HK\/(\d{5})(?:\/decision-reviews)?$/);
  if (!match) return jsonResponse({ message: "not found" }, 404);
  const symbol = { market: "HK", code: match[1], symbol: `HK.${match[1]}` };
  const journey = retargetJourneyFixture(coreFixture, symbol);
  if (holdInitialJourney && symbol.symbol === "HK.00175") {
    const response = deferred();
    pendingInitialJourney.set(path, response);
    return response.promise;
  }
  if (path.includes("/market/quotes/")) return jsonResponse(journey.quote);
  if (path.includes("/decision-context/")) return jsonResponse(journey.decisionContext);
  if (path.includes("/portfolio/pingan-snapshot/")) return jsonResponse(journey.pingan);
  if (path.endsWith("/decision-reviews")) return jsonResponse(journey.reviewHistory);
  return jsonResponse(journey.research);
};

await import("../dist/apps/web/src/app.js");
byId("candidate-refresh").click();
byId("load-action").click();
await waitUntil(() => pendingInitialJourney.size === 5);
candidateDeferred.resolve(jsonResponse(fixture));
await waitUntil(() => findCandidateOpenButtons(byId("candidate-list")).length === 3);
assert.equal(byId("candidate-overview").attributes["data-state"], "available");
assert.deepEqual(byId("stages").children.map((stage) => stage.attributes["data-state"]), ["loading", "loading", "loading", "loading", "loading"]);
holdInitialJourney = false;
for (const [path, response] of pendingInitialJourney) {
  const symbol = { market: "HK", code: "00175", symbol: "HK.00175" };
  const journey = retargetJourneyFixture(coreFixture, symbol);
  if (path.includes("/market/quotes/")) response.resolve(jsonResponse(journey.quote));
  else if (path.includes("/decision-context/")) response.resolve(jsonResponse(journey.decisionContext));
  else if (path.includes("/portfolio/pingan-snapshot/")) response.resolve(jsonResponse(journey.pingan));
  else if (path.endsWith("/decision-reviews")) response.resolve(jsonResponse(journey.reviewHistory));
  else response.resolve(jsonResponse(journey.research));
}
await waitUntil(() => byId("current-symbol").textContent === "HK.00175");
assert.equal(byId("candidate-overview").attributes["data-state"], "available");
assert.equal(byId("stages").children.some((stage) => stage.attributes["data-state"] === "ready"), true);

byId("decision-submit").click();
await waitUntil(() => stageState("decision") === "not_found");
candidateDeferred = deferred();
byId("candidate-refresh").click();
await waitUntil(() => byId("candidate-overview").attributes["data-state"] === "loading");
assert.equal(stageState("decision"), "not_found");
candidateDeferred.resolve(jsonResponse(fixture));
await waitUntil(() => byId("candidate-overview").attributes["data-state"] === "available");
assert.equal(stageState("decision"), "not_found");

const openButtons = findCandidateOpenButtons(byId("candidate-list"));
assert.equal(openButtons[0].dataset.candidateSymbol, "HK.00005");
openButtons[0].click();
await waitUntil(() => byId("current-symbol").textContent === "HK.00005");
assert.equal(byId("symbol-input").value, "HK.00005");
assert.equal(byId("stages").children.some((stage) => stage.attributes["data-state"] === "ready"), true);
assert.equal(fetchCalls.some((call) => call.path === "/api/mobile/research/candidates"), true);
assert.equal(fetchCalls.some((call) => call.path === "/api/mobile/market/quotes/HK/00005"), true);
assert.equal(fetchCalls.every((call) => call.headers.authorization === undefined), true);

console.log(JSON.stringify({
  ok: true,
  smoke: "web-candidate-overview-ui",
  renderedCards: 3,
  unauthorizedCards: 0,
  appCandidateClickLoadedSymbol: byId("current-symbol").textContent,
  selectedSymbols: ["HK.00005", "HK.09926", "HK.00700"],
  persistedCredentialApis: 0,
  tradingSideEffectRequests: 0
}, null, 2));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function retargetJourneyFixture(base, symbol) {
  return JSON.parse(
    JSON.stringify(base)
      .replaceAll("HK.00175", symbol.symbol)
      .replaceAll("00175", symbol.code)
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(predicate(), true);
}
