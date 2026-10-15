import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import {
  computePortfolioDecisionContextId,
  computePortfolioRiskImpactId,
  portfolioDecisionContextHashInput,
  portfolioRiskImpactHashInput
} from "../dist/packages/contracts/src/portfolioDecisionContext.js";
import {
  computeDecisionContextHash,
  decisionContextHashInputFromEnvelope
} from "../dist/packages/contracts/src/decisionContext.js";
import {
  computeDecisionSnapshotId,
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  decisionSnapshotSafety
} from "../dist/packages/contracts/src/decisionSnapshot.js";
import {
  assemblePostDecisionPortfolioReviewState,
  buildPostDecisionPortfolioReviewBinding
} from "../dist/packages/contracts/src/postDecisionPortfolioReview.js";
import { evaluateAnnualConditionalDecisionMonitor } from "../dist/packages/contracts/src/annualConditionalDecision.js";
import { captureAnnualReviewLearningState } from "../dist/packages/contracts/src/annualReviewLearning.js";
import { formalDecisionNotCapturedState } from "../dist/packages/contracts/src/formalDecision.js";

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
  }

  seed(id, value = "") {
    const element = new FakeElement("div");
    element.id = id;
    element.value = value;
    element.ownerDocument = this;
    this.elements.set(id, element);
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  querySelector() { return null; }
  querySelectorAll() { return []; }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.className = "";
    this._textContent = "";
    this._innerHTML = "";
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  get textContent() {
    return this._textContent;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this._textContent = String(value).replace(/<[^>]+>/g, "");
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
    this._textContent = "";
    this._innerHTML = "";
  }

  querySelector(selector) {
    if (selector !== "[data-geely-observation]") return null;
    return this.children.find((child) => child.dataset.geelyObservation !== undefined) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get("click")?.({ target: this });
    for (const listener of this.ownerDocument?.listeners.get("click") ?? []) listener({ target: this });
  }

  closest(selector) {
    const match = selector.match(/^button\[data-([a-z0-9-]+)\]$/);
    if (!match) return null;
    const key = match[1].replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    return this.dataset[key] === undefined ? null : this;
  }
}

const fixture = JSON.parse(await readFile("apps/web/test-fixtures/core-journey.json", "utf8"));
const quantDecisionEvidenceFixture = JSON.parse(await readFile(
  "apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/quant-decision-evidence.json",
  "utf8"
));
const candidateMembershipFixture = JSON.parse(await readFile("apps/web/test-fixtures/candidate-memberships.json", "utf8"));
const candidateDecisionIntakeFixture = JSON.parse(await readFile(
  "apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/candidate-decision-intake.json", "utf8"
));
const annualConditionalPreviewFixture = JSON.parse(await readFile(
  "apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/annual-conditional-decision.json", "utf8"
));
const todayResearchFixture = JSON.parse(await readFile(
  "apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/today-research.json", "utf8"
));
const upstreamRequests = [];
const serveForBrowserUat = process.env.WEB_CORE_JOURNEY_UI_SMOKE_SERVE === "1";
const browserUatStartedAt = Date.now();
const browserUatScreenshotNames = [
  "web-current-portfolio-quant-risk.png",
  "web-decision-snapshot-review.png",
  "web-malformed-symbol-fail-closed.png",
  "web-quant-snapshot-review-evidence.png",
  "web-annual-console-desktop.png",
  "web-annual-console-mobile.png"
];
const browserUatEvidenceDir = "artifacts/local-beta-uat/web";
const browserUatLedgerPath = `${browserUatEvidenceDir}/request-ledger.json`;
const browserUatDecisionCheckId = "41";
if (serveForBrowserUat) await rm(browserUatLedgerPath, { force: true });
const requestedWebPort = Number(process.env.WEB_CORE_JOURNEY_UI_SMOKE_PORT ?? 0);
if (!Number.isInteger(requestedWebPort) || requestedWebPort < 0 || requestedWebPort > 65_535) {
  throw new Error("WEB_CORE_JOURNEY_UI_SMOKE_PORT must be a valid TCP port");
}
let latestDecisionCheck = null;
let latestDecisionRequest = null;
let latestReviewRequest = null;
let latestJourneySymbol = "HK.00175";

const upstream = createServer(async (request, response) => {
  const body = await readRequestBody(request);
  upstreamRequests.push({
    method: request.method,
    url: request.url,
    bodyBytes: Buffer.byteLength(body),
    hasAuthorizationHeader: Boolean(request.headers.authorization)
  });
  const payload = route(request.method ?? "", request.url ?? "", body);
  response.writeHead(typeof payload.status === "number" ? payload.status : 200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload.body ?? payload));
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const upstreamPort = upstream.address().port;

const webPort = requestedWebPort || await reserveEphemeralPort();
let childOutput = "";
const child = spawn(process.execPath, ["apps/web/dev-server.mjs"], {
  env: {
    ...process.env,
    WEB_PORT: String(webPort),
    WEB_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`
  },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => {
  childOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  childOutput += chunk.toString();
});

try {
  await waitFor(`http://127.0.0.1:${webPort}/apps/web/index.html`, child, () => childOutput);
  const html = await (await fetch(`http://127.0.0.1:${webPort}/apps/web/index.html`)).text();
  const appJsResponse = await fetch(`http://127.0.0.1:${webPort}/dist/apps/web/src/app.js`);
  assert.equal(appJsResponse.ok, true);
  const appJs = await appJsResponse.text();
  assert.match(html, /data-testid="symbol-input"/);
  assert.match(html, /data-testid="stage-quote"|data-testid="journey-stages"/);
  assert.match(html, /data-testid="core-next-action-card"/);
  assert.match(html, /data-testid="review-feedback-card"/);
  assert.match(html, /data-testid="portfolio-decision-workspace"/);
  assert.match(html, /data-testid="investment-control-console"/);
  assert.match(html, /data-testid="deep-research-console"/);
  assert.match(html, /data-testid="deep-research-output"/);
  assert.match(html, /id="deep-geely-period"/);
  assert.match(html, /id="deep-geely-observations"/);
  assert.match(html, /id="deep-gcl-period"/);
  assert.match(html, /id="deep-gcl-save"/);
  assert.match(html, /data-testid="investment-console-failure-matrix"/);
  assert.match(html, /id="annual-review-learning-fields"/);
  assert.match(html, /仅提供研究辅助[^<]*不能创建订单、交易、成交、现金变动、费用、持仓变动或券商调用/);
  assert(!html.includes("localStorage"));
  assert(!html.includes("sessionStorage"));
  assert(!appJs.includes("sessionStorage"));
  const servedModules = await crawlServedModuleGraph(`http://127.0.0.1:${webPort}/dist/apps/web/src/app.js`);
  assert(servedModules.length >= 6);
  assert(servedModules.some((url) => url.endsWith("/dist/apps/web/src/reviewFeedback.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/apps/web/src/assistReviewKnowledgeState.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/assistReviewKnowledgeBrowser.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/apps/web/src/portfolioWorkspaceController.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/apps/web/src/portfolioWorkspaceRenderer.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/portfolioDecisionContextBrowser.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/portfolioDecisionContextStatus.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/apps/web/src/investmentControlConsoleCoordinator.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/apps/web/src/deepResearchConsole.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/deepResearch.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/researchEvent.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/geelySalesMonitor.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/gclPvPriceMonitor.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/todayResearch.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/todayResearchQualityValidation.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/apps/web/src/annualConditionalDecisionBrowser.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/chronology.js")));
  assert(servedModules.some((url) => url.endsWith("/dist/packages/contracts/src/decisionQuantEvidenceChronology.js")));

  const repoProbe = await fetch(`http://127.0.0.1:${webPort}/PROJECT_STATE.yaml`);
  assert.equal(repoProbe.ok, false);
  const forbiddenApiProbe = await fetch(`http://127.0.0.1:${webPort}/api/mobile/orders/HK/00175`, { method: "POST" });
  assert.equal(forbiddenApiProbe.ok, false);
  if (serveForBrowserUat) {
    console.log(JSON.stringify({
      ok: true,
      smoke: "web-core-journey-ui-browser-uat-server",
      url: `http://127.0.0.1:${webPort}/apps/web/index.html`,
      fixture: "repository_local_deterministic",
      production: "NO_GO"
    }));
    await waitForStopSignal();
    const ledger = await browserUatRequestLedger();
    await mkdir(browserUatEvidenceDir, { recursive: true });
    await writeFile(
      browserUatLedgerPath,
      `${JSON.stringify({ ...ledger, recordedAt: new Date().toISOString() }, null, 2)}\n`
    );
    console.log(JSON.stringify(ledger, null, 2));
  }

  if (!serveForBrowserUat) {
  const document = installDom();
  const nativeFetch = globalThis.fetch;
  globalThis.document = document;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLAnchorElement = FakeElement;
  globalThis.HTMLButtonElement = FakeElement;
  globalThis.HTMLFieldSetElement = FakeElement;
  globalThis.HTMLInputElement = FakeElement;
  globalThis.HTMLSelectElement = FakeElement;
  globalThis.HTMLTextAreaElement = FakeElement;
  globalThis.HTMLUListElement = FakeElement;
  const proxyFetch = (url, options) => nativeFetch(String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : url, options);
  let decisionSubmitAttempts = 0;
  const instrumentedFetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if ((options?.method ?? "GET") === "POST" && /\/decision-checks$/.test(fullUrl)) decisionSubmitAttempts += 1;
    return proxyFetch(fullUrl, options);
  };
  globalThis.fetch = instrumentedFetch;
  await import(`${pathToFileURL(`${process.cwd()}/dist/apps/web/src/app.js`).href}?smoke=${Date.now()}`);
  assert.equal(document.getElementById("stages").children.length, 5);
  assert.equal(document.getElementById("next-action-card").dataset.kind, "retry_load");
  assert.equal(document.getElementById("review-feedback-card").dataset.state, "ready");
  assert(document.getElementById("review-feedback-card").innerHTML.includes("review_required"));
  assert.equal(document.getElementById("review-feedback-card").dataset.readonly, "true");
  assert.equal(document.getElementById("load-action").disabled, false);
  const contextPending = deferred();
  let contextRequest = null;
  globalThis.fetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if (fullUrl.includes("/portfolio/pingan-current/context")) {
      contextRequest = { url: fullUrl, options };
      return contextPending.promise;
    }
    return instrumentedFetch(fullUrl, options);
  };
  document.getElementById("auth-token").value = "secret";
  document.getElementById("membership-read-token").value = "secret";
  document.getElementById("load-action").click();
  await waitUntil(() => document.getElementById("next-action-card").dataset.kind === "wait_for_load");
  await waitUntil(() => document.getElementById("stages").children.every((child) => child.dataset.state !== "loading"));
  assert.deepEqual(document.getElementById("stages").children.map((child) => child.dataset.testid), [
    "stage-quote",
    "stage-research",
    "stage-pingan",
    "stage-decision",
    "stage-review"
  ]);
  await waitUntil(() => document.getElementById("portfolio-decision-workspace").dataset.state === "loading");
  assert.equal(document.getElementById("decision-submit").disabled, true);
  assert.equal(document.getElementById("portfolio-lab-run").disabled, true);
  assert.equal(document.getElementById("next-action-card").dataset.enabled, "false");
  document.getElementById("decision-submit").click();
  assert.equal(decisionSubmitAttempts, 0);
  assert.equal(latestDecisionCheck, null);
  assert(contextRequest);
  globalThis.fetch = instrumentedFetch;
  contextPending.resolve(instrumentedFetch(contextRequest.url, contextRequest.options));
  assert.equal(document.getElementById("stages").children[0].dataset.state, "ready");
  assert.equal(document.getElementById("stages").children[2].dataset.state, "stale");
  assert.equal(document.getElementById("next-action-card").dataset.kind, "continue_with_pingan_limitation");
  assert.equal(document.getElementById("next-action-card").dataset.operation, "decision");
  assert(document.getElementById("review-feedback-card").innerHTML.includes("review_required"));
  await waitUntil(() => document.getElementById("portfolio-decision-workspace").dataset.state === "available");
  assert.equal(document.getElementById("portfolio-position-rows").children.length, 1);
  assert.equal(document.getElementById("portfolio-market-value").textContent, "HKD 100,000");
  assert.equal(document.getElementById("portfolio-cash").textContent, "unknown");
  assert.equal(document.getElementById("portfolio-risk-run").disabled, false);
  const riskPending = deferred();
  let riskRequest = null;
  globalThis.fetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if (fullUrl.includes("/portfolio/pingan-current/risk-impact")) {
      riskRequest = { url: fullUrl, options };
      return riskPending.promise;
    }
    return instrumentedFetch(fullUrl, options);
  };
  document.getElementById("portfolio-risk-run").click();
  assert.equal(document.getElementById("portfolio-risk-run").disabled, true);
  assert.equal(document.getElementById("portfolio-lab-run").disabled, true);
  assert.equal(document.getElementById("decision-submit").disabled, true);
  document.getElementById("decision-submit").click();
  assert.equal(decisionSubmitAttempts, 0);
  assert.equal(latestDecisionCheck, null);
  assert(riskRequest);
  globalThis.fetch = instrumentedFetch;
  riskPending.resolve(instrumentedFetch(riskRequest.url, riskRequest.options));
  await waitUntil(() => document.getElementById("portfolio-risk-result").dataset.state === "available");
  assert(document.getElementById("portfolio-risk-result").children.some((child) => child.children.some((part) => part.textContent === "HKD 10,000")));

  document.getElementById("decision-submit").click();
  await waitUntil(() => document.getElementById("review-submit").disabled === false);
  assert.equal(decisionSubmitAttempts, 1);
  assert.equal(document.getElementById("next-action-card").dataset.kind, "research_core_review");
  document.getElementById("review-submit").click();
  await waitUntil(() => document.getElementById("stages").children[4].dataset.state === "completed");
  assert.equal(document.getElementById("next-action-card").dataset.kind, "research_membership_unknown");
  assert.equal(document.getElementById("review-feedback-card").dataset.state, "ready");
  assert(document.getElementById("review-feedback-card").innerHTML.includes("evidence_gap"));
  assert(!/\b(buy|sell|hold|price target|position-size|allocation)\b/i.test(document.getElementById("review-feedback-card").textContent));

  document.getElementById("portfolio-risk-run").click();
  await waitUntil(() => document.getElementById("portfolio-risk-result").dataset.state === "available");
  globalThis.fetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if (fullUrl.includes("/portfolio/pingan-current/risk-impact")) {
      return Promise.resolve(new Response(JSON.stringify(portfolioRiskFixture("HK.00175", 10_000, {
        status: "blocked",
        impactId: null,
        current: { alreadyHeld: null, marketValue: null, weight: null },
        scenario: { totalMarketValue: null, candidateMarketValue: null, candidateWeight: null, weightChange: null, largestPositionWeight: null, hhi: null },
        gaps: ["portfolio became stale"],
        message: "Portfolio became stale."
      })), { status: 409, headers: { "content-type": "application/json" } }));
    }
    return nativeFetch(fullUrl, options);
  };
  document.getElementById("portfolio-risk-run").click();
  await waitUntil(() => document.getElementById("portfolio-decision-workspace").dataset.state === "unavailable");
  assert.equal(document.getElementById("portfolio-position-rows").children.length, 0);
  assert.equal(document.getElementById("portfolio-risk-run").disabled, true);

  const supersededFirst = deferred();
  let quoteCalls = 0;
  globalThis.fetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if (fullUrl.includes("/api/mobile/market/quotes/")) {
      quoteCalls += 1;
      if (quoteCalls === 1) return supersededFirst.promise;
    }
    return nativeFetch(fullUrl, options);
  };
  document.getElementById("load-action").click();
  document.getElementById("symbol-input").value = "HK.175";
  document.getElementById("load-action").click();
  assert.equal(document.getElementById("next-action-card").dataset.kind, "wait_for_load");
  supersededFirst.resolve(new Response(JSON.stringify({ ...fixture.quote, requestedSymbol: "HK.09926" }), { status: 200, headers: { "content-type": "application/json" } }));
  await waitUntil(() => document.getElementById("stages").children[0].dataset.state === "ready");
  assert.equal(document.getElementById("current-symbol").textContent, "HK.00175");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.getElementById("stages").children[0].dataset.state, "ready");
  assert.equal(/HK\.09926|requestedSymbol must match/.test(document.getElementById("stages").textContent), false);
  assert.equal(upstreamRequests.some((item) => item.url.includes("/api/mobile/market/quotes/HK/00175")), true);

  document.getElementById("symbol-input").value = "HK.09926";
  document.getElementById("membership-read-token").value = "secret";
  document.getElementById("membership-refresh").click();
  await waitUntil(() => document.getElementById("membership-list").children.length > 0);
  document.getElementById("load-action").click();
  await waitUntil(() => document.getElementById("portfolio-decision-workspace").dataset.state === "available");
  const intakeButton = document.createElement("button");
  intakeButton.dataset.decisionIntakeMembershipId = "1";
  assert.equal(intakeButton.closest("button[data-decision-intake-membership-id]"), intakeButton);
  const membershipClick = document.getElementById("membership-list").listeners.get("click");
  assert(membershipClick);
  membershipClick({ target: intakeButton });
  await waitUntil(() => upstreamRequests.some((item) => item.url === "/api/mobile/research/candidate-memberships/1/decision-intake"));
  await waitUntil(() => document.getElementById("investment-control-console").dataset.state === "ready");
  assert.equal(document.getElementById("portfolio-risk-result").dataset.state, "idle");
  document.getElementById("deep-research-refresh").click();
  await waitUntil(() => renderedText(document.getElementById("deep-research-output")).includes("action:1:v3:needs_evidence_pack")).catch((error) => {
    throw new Error(`${error.message}; status=${document.getElementById("deep-research-status").textContent}; output=${renderedText(document.getElementById("deep-research-output"))}`);
  });
  assert.match(renderedText(document.getElementById("deep-research-output")), /facts=7:r2:2026-07-v2/);
  assert.match(renderedText(document.getElementById("deep-research-output")), /events=27:v2/);
  assert.match(renderedText(document.getElementById("deep-research-output")), /sourceHealth=revision_mismatch:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/);
  assert.match(renderedText(document.getElementById("deep-research-output")), /structure=not_started:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd · checks=0\/15/);
  assert.match(renderedText(document.getElementById("deep-research-output")), /secondOpinion=not_evaluated\/dependency=false/);

  let intakeRequestCount = requestCount("GET", "/api/mobile/research/candidate-memberships/1/decision-intake");
  document.getElementById("research-editor-save").click();
  await waitUntil(() => requestCount("PUT", "/api/mobile/research/profiles/HK/09926") === 1);
  await waitUntil(() => requestCount("GET", "/api/mobile/research/candidate-memberships/1/decision-intake") > intakeRequestCount);
  await waitUntil(() => document.getElementById("investment-control-console").dataset.state === "ready");

  intakeRequestCount = requestCount("GET", "/api/mobile/research/candidate-memberships/1/decision-intake");
  document.getElementById("research-evidence-add").click();
  await waitUntil(() => requestCount("POST", "/api/mobile/research/profiles/HK/09926/evidence") === 1);
  await waitUntil(() => requestCount("GET", "/api/mobile/research/candidate-memberships/1/decision-intake") > intakeRequestCount);
  await waitUntil(() => document.getElementById("investment-control-console").dataset.state === "ready");

  document.getElementById("annual-valuation-run").click();
  await waitUntil(() => document.getElementById("annual-valuation-output").dataset.state === "available");
  document.getElementById("portfolio-lab-run").click();
  await waitUntil(() => document.getElementById("portfolio-lab-result").dataset.state === "available");
  document.getElementById("annual-conditional-run").click();
  await waitUntil(() => document.getElementById("annual-conditional-output").dataset.state === "available");
  assert.equal(document.getElementById("annual-conditional-bind").checked, true);
  document.getElementById("decision-submit").click();
  await waitUntil(() => latestDecisionCheck?.symbol === "HK.09926");
  assert(latestDecisionRequest);
  const previewScenario = annualConditionalPreviewFixture.data.portfolioLab.data.scenarios[
    annualConditionalPreviewFixture.data.selectedPortfolioScenarioIndex
  ];
  assert.equal(latestDecisionRequest.conditionalDecision.preview.previewId, annualConditionalPreviewFixture.previewId);
  assert.equal(latestDecisionRequest.decisionSnapshotBinding.riskImpact.hypotheticalAmount, previewScenario.hypotheticalAmount);
  assert.equal(latestDecisionRequest.decisionSnapshotBinding.riskImpact.impactId, previewScenario.riskImpact.impactId);
  assert.notEqual(latestDecisionRequest.decisionSnapshotBinding.riskImpact.availability, "not_captured");

  document.getElementById("annual-review-judgment-correction").value = "The evidence threshold was too permissive.";
  document.getElementById("annual-review-process-lesson").value = "Require a second independent filing before forming the judgment.";
  document.getElementById("annual-review-next-question").value = "Did the next filing confirm the margin evidence?";
  document.getElementById("review-submit").click();
  await waitUntil(() => latestReviewRequest?.reviewLearning?.decisionCheckId === latestDecisionCheck.id);
  await waitUntil(() => document.getElementById("stages").children[4].dataset.state === "completed");
  assert.equal(latestReviewRequest.reviewLearning.conditionalPreviewId, annualConditionalPreviewFixture.previewId);

  document.getElementById("annual-valuation-run").click();
  await waitUntil(() => document.getElementById("annual-valuation-output").dataset.state === "available");
  const refreshedPortfolio = refreshedPortfolioContextFixture("HK.09926");
  globalThis.fetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if (fullUrl.includes("/portfolio/pingan-current/context")) {
      return Promise.resolve(new Response(JSON.stringify(refreshedPortfolio), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return instrumentedFetch(fullUrl, options);
  };
  document.getElementById("portfolio-refresh").click();
  await waitUntil(() => document.getElementById("portfolio-snapshot-time").textContent === refreshedPortfolio.portfolioAsOf);
  assert.equal(document.getElementById("annual-valuation-output").dataset.state, "idle");
  assert.equal(document.getElementById("investment-console-source-rows").children[4].children[2].textContent.includes(refreshedPortfolio.portfolioSnapshotId), true);

  document.getElementById("annual-valuation-run").click();
  await waitUntil(() => document.getElementById("annual-valuation-output").dataset.state === "available");
  globalThis.fetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if (fullUrl.includes("/portfolio/pingan-current/context")) return Promise.reject(new Error("portfolio offline"));
    return instrumentedFetch(fullUrl, options);
  };
  document.getElementById("portfolio-refresh").click();
  await waitUntil(() => document.getElementById("portfolio-decision-workspace").dataset.state === "offline");
  assert.equal(document.getElementById("annual-valuation-output").dataset.state, "idle");
  assert.equal(document.getElementById("investment-console-source-rows").children[4].children[2].textContent, "cleared");

  globalThis.fetch = instrumentedFetch;
  document.getElementById("portfolio-refresh").click();
  await waitUntil(() => document.getElementById("portfolio-decision-workspace").dataset.state === "available");
  document.getElementById("annual-conditional-run").click();
  await waitUntil(() => document.getElementById("annual-conditional-output").dataset.state === "available");
  globalThis.fetch = (url, options) => {
    const fullUrl = String(url).startsWith("/") ? `http://127.0.0.1:${webPort}${url}` : String(url);
    if (fullUrl.includes("/portfolio/pingan-current/context")) {
      return Promise.resolve(new Response(JSON.stringify({ message: "portfolio identity conflict" }), { status: 409, headers: { "content-type": "application/json" } }));
    }
    return instrumentedFetch(fullUrl, options);
  };
  document.getElementById("portfolio-refresh").click();
  await waitUntil(() => document.getElementById("portfolio-decision-workspace").dataset.state === "conflict");
  assert.equal(document.getElementById("annual-conditional-output").dataset.state, "idle");
  assert.equal(document.getElementById("annual-conditional-bind").checked, false);

  assert.equal(upstreamRequests.some((item) => forbiddenTradingRoute(item.url)), false);
  const unexpectedMutations = upstreamRequests.filter((item) => item.method !== "GET" && !allowedAdvisoryMutation(item.method, item.url));
  assert.deepEqual(unexpectedMutations.map((item) => `${item.method} ${item.url}`), []);
  assert.equal(upstreamRequests.some((item) => item.hasAuthorizationHeader), false);
  assert.equal(upstreamRequests.some((item) => item.method === "GET" && item.bodyBytes !== 0), false);

  console.log(JSON.stringify({
    ok: true,
    smoke: "web-core-journey-ui",
    url: `http://127.0.0.1:${webPort}/apps/web/index.html`,
    proxiedRequests: upstreamRequests.length,
    credentialPersistence: false,
    tradingSideEffectRequests: 0
  }, null, 2));
  }
} finally {
  child.kill("SIGTERM");
  upstream.close();
}

async function reserveEphemeralPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitFor(url, processHandle, output) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`server exited before becoming ready (${processHandle.exitCode}): ${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server did not become ready: ${url}\n${output()}`);
}

async function waitForStopSignal() {
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  assert.equal(response.ok, true);
  return response.json();
}

async function crawlServedModuleGraph(entryUrl) {
  const visited = new Set();
  const pending = [entryUrl];
  while (pending.length > 0) {
    const url = pending.pop();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const response = await fetch(url);
    assert.equal(response.ok, true, `browser module was not served: ${url} (${response.status})`);
    const source = await response.text();
    assert.equal(/\bfrom\s+["']node:|import\s*\(\s*["']node:/.test(source), false);
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith("node:")) assert.fail(`browser graph imports ${specifier}`);
      if (!specifier.startsWith(".")) continue;
      pending.push(new URL(specifier, url).href);
    }
  }
  return [...visited];
}

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^"']*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function route(method, path, body) {
  const quoteMatch = path.match(/^\/api\/mobile\/market\/quotes\/HK\/(00175|09926)$/);
  if (method === "GET" && quoteMatch) { latestJourneySymbol = `HK.${quoteMatch[1]}`; return journeyFixture(latestJourneySymbol).quote; }
  if (method === "GET" && path === "/api/mobile/research/candidate-memberships") return candidateMembershipFixture;
  if (method === "GET" && path === "/api/mobile/research/candidate-memberships/1/decision-intake") return candidateDecisionIntakeFixture;
  if (method === "GET" && path === "/api/mobile/research/candidate-memberships/1/deep-research") return deepResearchWorkspaceFixture();
  if (method === "GET" && path === "/api/mobile/research/candidate-memberships/1/today") {
    return { ...todayResearchFixture, requestedActorId: "candidate-write-token-principal" };
  }
  if (method === "GET" && path.startsWith("/api/mobile/research/candidate-memberships/1/portfolio-lab?")) return annualConditionalPreviewFixture.data.portfolioLab;
  if (method === "GET" && path.startsWith("/api/mobile/research/candidate-memberships/1/valuation-quant-workbench?")) return annualConditionalPreviewFixture.data.valuationQuant;
  if (method === "GET" && path.startsWith("/api/mobile/research/candidate-memberships/1/conditional-decision-preview?")) return annualConditionalPreviewFixture;
  const profileMatch = path.match(/^\/api\/mobile\/research\/profiles\/HK\/(00175|09926)$/);
  if (method === "GET" && profileMatch) return journeyFixture(`HK.${profileMatch[1]}`).research;
  if (method === "PUT" && profileMatch) return writeEnvelope(researchProfileWriteFixture(parseJsonBody(body, "research profile"), `HK.${profileMatch[1]}`));
  const evidenceMatch = path.match(/^\/api\/mobile\/research\/profiles\/HK\/(00175|09926)\/evidence$/);
  if (method === "POST" && evidenceMatch) return writeEnvelope(researchEvidenceWriteFixture(parseJsonBody(body, "research evidence")));
  const contextMatch = path.match(/^\/api\/mobile\/research\/decision-context\/HK\/(00175|09926)$/);
  if (method === "GET" && contextMatch) return journeyFixture(`HK.${contextMatch[1]}`).decisionContext;
  const pinganMatch = path.match(/^\/api\/mobile\/research\/portfolio\/pingan-snapshot\/HK\/(00175|09926)$/);
  if (method === "GET" && pinganMatch) return journeyFixture(`HK.${pinganMatch[1]}`).pingan;
  if (method === "GET" && path === "/api/mobile/research/portfolio/pingan-current/context") return portfolioContextFixture(latestJourneySymbol);
  if (method === "GET" && path.startsWith("/api/mobile/research/portfolio/pingan-current/risk-impact?")) {
    const url = new URL(path, "http://127.0.0.1");
    return portfolioRiskFixture(
      url.searchParams.get("symbol") ?? "HK.00175",
      Number(url.searchParams.get("hypotheticalAmount") ?? 0)
    );
  }
  const historyMatch = path.match(/^\/api\/mobile\/research\/profiles\/HK\/(00175|09926)\/decision-reviews$/);
  if (method === "GET" && historyMatch) return journeyFixture(`HK.${historyMatch[1]}`).reviewHistory;
  const checkMatch = path.match(/^\/api\/mobile\/research\/profiles\/HK\/(00175|09926)\/decision-checks$/);
  if (method === "POST" && checkMatch) {
    latestDecisionRequest = parseJsonBody(body, "decision check");
    latestDecisionCheck = decisionCheckFixture(latestDecisionRequest, `HK.${checkMatch[1]}`);
    return writeEnvelope(latestDecisionCheck);
  }
  const reviewMatch = path.match(/^\/api\/mobile\/research\/profiles\/HK\/(00175|09926)\/decision-checks\/([1-9]\d*)\/reviews$/);
  if (method === "POST" && reviewMatch) {
    assert.equal(decodeURIComponent(reviewMatch[2]), latestDecisionCheck?.id);
    latestReviewRequest = parseJsonBody(body, "decision review");
    return writeEnvelope(reviewFixture(latestReviewRequest, `HK.${reviewMatch[1]}`));
  }
  return { status: 404, body: { message: `unexpected ${method} ${path}` } };
}

function deepResearchWorkspaceFixture() {
  const material = {
    id: "7", evidenceId: "17", market: "HK", code: "09926", symbol: "HK.09926", materialKind: "text",
    title: "Issuer source revision", contentText: "The supplied issuer source changed the revenue-growth evidence.",
    sourceType: "issuer_disclosure", sourceUrl: "https://example.invalid/akeso/revenue",
    publishedAt: "2026-07-24T08:00:00.000Z", capturedAt: "2026-07-24T08:05:00.000Z",
    contentFingerprint: "a".repeat(64), claimType: "issuer_statement", verificationStatus: "verified",
    rightsStatus: "authorized_public", sourceVersion: "2026-07-v2", replacesMaterialId: "6",
    revision: 2, revisionState: "current", validUntil: "2026-08-24T08:00:00.000Z", freshness: "fresh",
    summary: "The issuer source weakens the prior revenue-growth evidence.", variableName: "revenue_growth",
    stance: "refute", reliability: 4, materiality: 4, isRead: false
  };
  return {
    schemaVersion: "2026-07-30.deep-research-beta.v5",
    generatedAt: "2026-07-25T10:00:00.000Z",
    status: "available",
    membershipId: "1",
    requestedActorId: "candidate-write-token-principal",
    requestedSymbol: "HK.09926",
    metadata: {
      source: "deep-research:web-smoke", asOf: "2026-07-25T10:00:00.000Z",
      fetchedAt: "2026-07-25T10:00:00.000Z", freshness: "fresh", provenance: "fixture",
      authority: "research_evidence", stale: false, missing: false, conflict: false, fixture: true,
      correctionOf: null, replaces: null, message: "Web-only contract fixture; never current portfolio truth."
    },
    data: {
      target: {
        membershipId: "1", membershipVersion: 3, membershipState: "tracked",
        market: "HK", code: "09926", symbol: "HK.09926"
      },
      materials: [material],
      events: [{
        id: "27", eventVersion: 2, eventFingerprint: "b".repeat(64), membershipId: "1", membershipVersion: 3,
        market: "HK", code: "09926", symbol: "HK.09926", eventKind: "news", coverageScope: "research_stock",
        keyVariable: "revenue_growth", importance: "medium",
        importanceReasons: ["Materiality and reliability are both at least 3."], hypothesisImpact: "weakens",
        source: {
          materialId: material.id, evidenceId: material.evidenceId, sourceType: material.sourceType,
          sourceUrl: material.sourceUrl, publishedAt: material.publishedAt, capturedAt: material.capturedAt,
          claimType: material.claimType, verificationStatus: material.verificationStatus,
          rightsStatus: material.rightsStatus, sourceVersion: material.sourceVersion,
          contentFingerprint: material.contentFingerprint, validUntil: material.validUntil,
          freshness: material.freshness, revision: material.revision, revisionState: material.revisionState,
          variableName: material.variableName, stance: material.stance,
          reliability: material.reliability, materiality: material.materiality
        },
        holdingBinding: null, createdAt: "2026-07-24T08:06:00.000Z",
        safety: {
          createsOrder: false, createsTrade: false, mutatesCash: false, writesFee: false,
          mutatesPosition: false, callsBroker: false, productionWrite: false
        }
      }],
      latestGeelySalesMonitor: null,
      latestGclPvPriceMonitor: null,
      latestPack: null,
      evidencePacks: [],
      latestReport: null,
      reports: [],
      userDecision: null,
      decisions: [],
      classification: {
        verifiedFactMaterialIds: [], issuerStatementMaterialIds: ["7"], thirdPartyStatementMaterialIds: [],
        modelInferenceMaterialIds: [], userDecisionId: null
      },
      completion: {
        state: "pack_required", deepResearchComplete: false,
        reasons: ["Research materials changed after the latest frozen evidence pack."]
      }
    },
    message: "Deep research workspace for HK.09926."
  };
}

function portfolioContextFixture(symbol = "HK.00175") {
  if (symbol === "HK.09926") return structuredClone(annualConditionalPreviewFixture.data.portfolioLab.data.portfolio);
  const envelope = {
    schemaVersion: "2026-07-15.portfolio-decision-context.v1",
    status: "available",
    contextId: null,
    portfolioSnapshotId: "pingan-current-portfolio:web-smoke",
    accountScopeId: "web-smoke",
    portfolioSource: "pingan_imported_snapshot",
    portfolioAsOf: "2026-07-15T01:39:00.000Z",
    assembledAt: "2026-07-15T01:40:00.000Z",
    positions: [{
      market: "HK", code: "00175", symbol: "HK.00175", name: "Geely",
      quantity: 1000, averageCost: 90, unrealizedPnl: 10000, sourceWeight: 1, currency: "HKD",
      sourceRowId: "broker_import_batches:42/broker_trades:1/position_snapshots:11",
      quote: { status: "current", source: "futu", quoteAsOf: "2026-07-15T01:39:00.000Z", fetchedAt: "2026-07-15T01:39:01.000Z" },
      latestPrice: 100, marketValue: 100000, marketWeight: 1
    }],
    summary: {
      positionCount: 1,
      marketValue: { status: "complete_current", amount: 100000, currency: "HKD", missingPositionCount: 0 },
      cash: { status: "unknown", amount: null, currency: null, reason: "not_provided_by_authoritative_snapshot" },
      concentration: { status: "available", largestPositionWeight: 1, topThreeWeight: 1, hhi: 1 }
    },
    dataUse: {
      display: "allowed", advisoryRiskImpact: "allowed_current_development_only",
      productionPortfolio: "blocked_not_production_authority",
      brokerReconciliation: "blocked", accounting: "blocked", execution: "blocked"
    },
    gaps: [],
    message: "Current local-development portfolio context."
  };
  return {
    ...envelope,
    contextId: computePortfolioDecisionContextId(portfolioDecisionContextHashInput(envelope))
  };
}

function refreshedPortfolioContextFixture(symbol) {
  const value = structuredClone(portfolioContextFixture(symbol));
  value.portfolioSnapshotId = `${value.portfolioSnapshotId}:refreshed`;
  value.portfolioAsOf = "2026-07-19T02:10:00.000Z";
  value.assembledAt = "2026-07-19T02:11:00.000Z";
  value.contextId = computePortfolioDecisionContextId(portfolioDecisionContextHashInput(value));
  return value;
}

function portfolioRiskFixture(candidateSymbol = "HK.00175", hypotheticalAmount = 10_000, overrides = {}) {
  if (candidateSymbol === "HK.09926" && Object.keys(overrides).length === 0) {
    const scenario = annualConditionalPreviewFixture.data.portfolioLab.data.scenarios.find((item) => item.hypotheticalAmount === hypotheticalAmount);
    if (scenario) return structuredClone(scenario.riskImpact);
  }
  const portfolio = portfolioContextFixture(candidateSymbol);
  const heldPosition = portfolio.positions.find((position) => position.symbol === candidateSymbol);
  const currentCandidateMarketValue = heldPosition?.marketValue ?? 0;
  const totalMarketValue = portfolio.summary.marketValue.amount + hypotheticalAmount;
  const candidateMarketValue = currentCandidateMarketValue + hypotheticalAmount;
  const candidateWeight = round(candidateMarketValue / totalMarketValue, 8);
  const weightChange = round(candidateWeight - (heldPosition?.marketWeight ?? 0), 8);
  const otherWeights = portfolio.positions
    .filter((position) => position.symbol !== candidateSymbol)
    .map((position) => position.marketValue / totalMarketValue);
  const scenarioWeights = [candidateWeight, ...otherWeights];
  const envelope = {
    schemaVersion: "2026-07-15.portfolio-risk-impact.v1",
    calculationVersion: "portfolio-risk-impact.v1",
    status: "available",
    impactId: null,
    contextId: portfolio.contextId,
    portfolioSnapshotId: "pingan-current-portfolio:web-smoke",
    candidateSymbol,
    hypotheticalAmount,
    currency: "HKD",
    current: {
      alreadyHeld: Boolean(heldPosition),
      marketValue: currentCandidateMarketValue,
      weight: heldPosition?.marketWeight ?? 0
    },
    scenario: {
      totalMarketValue,
      candidateMarketValue,
      candidateWeight,
      weightChange,
      largestPositionWeight: round(Math.max(...scenarioWeights), 8),
      hhi: round(scenarioWeights.reduce((sum, weight) => sum + weight ** 2, 0), 8)
    },
    gaps: [],
    guardrails: {
      advisoryOnly: true, userProvidedAmountOnly: true, generatesDirection: false,
      recommendsAmount: false, recommendsTargetWeight: false, recommendsTiming: false,
      promisesReturn: false, createsOrder: false, productionWrite: false
    },
    message: "User-provided exposure scenario only.",
    ...overrides
  };
  return envelope.status === "available" ? {
    ...envelope,
    impactId: computePortfolioRiskImpactId(portfolioRiskImpactHashInput(envelope))
  } : envelope;
}

function decisionCheckFixture(request, symbol) {
  const journey = journeyFixture(symbol);
  const portfolio = portfolioContextFixture(symbol);
  const risk = request.decisionSnapshotBinding.riskImpact.availability === "captured"
    ? portfolioRiskFixture(symbol, request.decisionSnapshotBinding.riskImpact.hypotheticalAmount)
    : null;
  assert.equal(request.contextId, journey.decisionContext.contextId);
  assert.equal(request.contextHash, journey.decisionContext.contextHash);
  assert.equal(request.decisionSnapshotBinding.portfolioContext.contextId, portfolio.contextId);
  assert.equal(request.decisionSnapshotBinding.portfolioContext.portfolioSnapshotId, portfolio.portfolioSnapshotId);
  if (risk) assert.equal(request.decisionSnapshotBinding.riskImpact.impactId, risk.impactId);
  const snapshotInput = {
    schemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: request.reviewedAt,
    candidateSymbol: symbol,
    decisionContext: structuredClone(journey.decisionContext),
    portfolioContext: {
      state: request.decisionSnapshotBinding.portfolioContext.state,
      envelope: portfolio,
      limitation: "Exact authorized read-only portfolio facts visible at decision time."
    },
    riskImpact: {
      availability: request.decisionSnapshotBinding.riskImpact.availability,
      envelope: risk,
      limitation: risk
        ? "Exact neutral user-amount scenario visible at decision time."
        : "No neutral user-amount scenario was captured at decision time."
    },
    safety: decisionSnapshotSafety()
  };
  const conditionalDecision = request.conditionalDecision ? {
    availability: "preserved",
    preview: request.conditionalDecision.preview,
    judgment: request.conditionalDecision.judgment,
    monitor: evaluateAnnualConditionalDecisionMonitor(
      request.conditionalDecision.preview,
      request.conditionalDecision.judgment,
      annualConditionalCurrentFacts(request.conditionalDecision.preview, request.reviewedAt)
    ),
    limitation: "The exact conditional preview and human judgment remain append-only and advisory only."
  } : undefined;
  return {
    ...structuredClone(journey.decisionCheck),
    id: browserUatDecisionCheckId,
    actionIntent: request.actionIntent,
    humanCheckResult: request.humanCheckResult,
    userFinalDecision: request.userFinalDecision,
    checkedAt: request.reviewedAt,
    researchReportDecision: request.researchReportBinding ? {
      availability: "preserved",
      binding: request.researchReportBinding,
      limitation: "The exact explicitly adopted research report binding is preserved."
    } : {
      availability: "not_captured",
      binding: null,
      limitation: "No research report binding was adopted for this decision."
    },
    formalDecision: formalDecisionNotCapturedState(),
    decisionSnapshot: {
      availability: "preserved",
      snapshot: { ...snapshotInput, snapshotId: computeDecisionSnapshotId(snapshotInput) },
      limitation: "Exact decision-time facts are preserved without mutating official facts."
    },
    ...(conditionalDecision ? { conditionalDecision } : {}),
    audit: {
      ...journey.decisionCheck.audit,
      idempotencyKey: request.idempotencyKey
    }
  };
}

function researchProfileWriteFixture(request, symbol) {
  const [market, code] = symbol.split(".");
  return {
    market, code, symbol,
    name: request.name ?? null,
    currentView: request.currentView,
    currentThesis: request.currentThesis,
    marketDisagreement: request.marketDisagreement ?? null,
    invalidationCondition: request.invalidationCondition ?? null,
    nextReviewOn: request.nextReviewOn ?? null,
    keyVariables: request.keyVariables ?? [],
    catalysts: request.catalysts ?? [],
    evidenceGaps: request.evidenceGaps ?? []
  };
}

function researchEvidenceWriteFixture(request) {
  return {
    id: "evidence-web-smoke",
    sourceType: request.sourceType,
    sourceUrl: request.sourceUrl ?? null,
    publishedAt: request.publishedAt ?? null,
    capturedAt: "2026-07-19T02:00:00.000Z",
    summary: request.summary,
    factKind: request.factKind,
    variableName: request.variableName ?? null,
    stance: request.stance,
    reliability: request.reliability ?? null,
    materiality: request.materiality ?? null,
    isRead: request.isRead ?? false
  };
}

function reviewFixture(request, symbol) {
  assert(latestDecisionCheck, "decision review requires the preserved decision check");
  assert.equal(latestDecisionCheck.symbol, symbol);
  const journey = journeyFixture(symbol);
  const reviewTime = portfolioContextFixture(symbol);
  const expectedBinding = buildPostDecisionPortfolioReviewBinding(
    latestDecisionCheck.id,
    latestDecisionCheck.decisionSnapshot,
    reviewTime
  );
  assert.deepEqual(request.portfolioReviewBinding, expectedBinding);
  const reviewLearning = request.reviewLearning && latestDecisionCheck.conditionalDecision
    ? captureAnnualReviewLearningState(
      request.reviewLearning,
      latestDecisionCheck.conditionalDecision.monitor,
      latestDecisionCheck.decisionSnapshot,
      latestDecisionCheck.conditionalDecision
    )
    : undefined;
  return {
    ...structuredClone(journey.review),
    decisionCheckId: latestDecisionCheck.id,
    outcome: request.outcome,
    outcomeEvidence: request.outcomeEvidence,
    reviewNote: request.reviewNote,
    reviewedAt: request.reviewedAt,
    createdAt: request.reviewedAt,
    portfolioReview: assemblePostDecisionPortfolioReviewState(
      latestDecisionCheck.id,
      latestDecisionCheck.decisionSnapshot,
      reviewTime,
      request.reviewedAt
    ),
    ...(reviewLearning ? { reviewLearning } : {}),
    audit: {
      ...journey.review.audit,
      idempotencyKey: request.idempotencyKey
    }
  };
}

function journeyFixture(symbol) {
  if (symbol === "HK.00175") return fixture;
  assert.equal(symbol, "HK.09926");
  const [market, code] = symbol.split(".");
  const quantEvidence = {
    ...structuredClone(fixture.decisionContext.quantEvidence),
    identities: {
      frozenSnapshot: {
        snapshotId: quantDecisionEvidenceFixture.source.snapshotId,
        snapshotHash: quantDecisionEvidenceFixture.source.snapshotHash,
        dataHash: quantDecisionEvidenceFixture.source.dataHash,
        sourceClassification: quantDecisionEvidenceFixture.source.sourceClassification
      },
      baselineExperimentIdentity: quantDecisionEvidenceFixture.source.baselineExperimentIdentity,
      splitIds: quantDecisionEvidenceFixture.samples.map((sample) => sample.id),
      shadowPortfolioIdentity: quantDecisionEvidenceFixture.source.shadowPortfolioIdentity,
      shadowPortfolioId: "hk-09926-shadow-research-v0.1",
      generatedAt: "2026-07-09T12:30:00.000Z"
    },
    sampleBoundary: {
      ...structuredClone(fixture.decisionContext.quantEvidence.sampleBoundary),
      universe: [symbol]
    },
    decisionEvidence: structuredClone(quantDecisionEvidenceFixture)
  };
  const contextWithoutIdentity = {
    ...structuredClone(fixture.decisionContext),
    requestedSymbol: symbol,
    quote: {
      ...structuredClone(fixture.decisionContext.quote),
      data: { ...structuredClone(fixture.decisionContext.quote.data), market, code, symbol }
    },
    research: {
      ...structuredClone(fixture.decisionContext.research),
      profile: { ...structuredClone(fixture.decisionContext.research.profile), market, code, symbol }
    },
    quantEvidence
  };
  const contextHash = computeDecisionContextHash(decisionContextHashInputFromEnvelope(contextWithoutIdentity));
  const decisionContext = symbol === "HK.09926" ? structuredClone(candidateDecisionIntakeFixture.decisionContext) : {
    ...contextWithoutIdentity,
    contextId: `decision-context:${symbol}:${contextHash.slice(0, 16)}`,
    contextHash
  };
  return {
    quote: retargetEnvelopeIdentity(fixture.quote, symbol),
    research: {
      ...structuredClone(fixture.research),
      requestedSymbol: symbol,
      data: {
        ...structuredClone(fixture.research.data),
        profile: { ...structuredClone(fixture.research.data.profile), market, code, symbol }
      }
    },
    decisionContext,
    pingan: {
      ...structuredClone(fixture.pingan),
      requestedSymbol: symbol,
      positions: fixture.pingan.positions.map((position) => ({
        ...structuredClone(position), market, code, symbol, name: "HK.09926 fixture candidate"
      }))
    },
    reviewHistory: {
      ...structuredClone(fixture.reviewHistory),
      requestedSymbol: symbol
    },
    decisionCheck: {
      ...structuredClone(fixture.decisionCheck),
      market,
      code,
      symbol,
      contextId: decisionContext.contextId,
      contextHash: decisionContext.contextHash
    },
    review: {
      ...structuredClone(fixture.review),
      market,
      code,
      symbol
    }
  };
}

function annualConditionalCurrentFacts(value, evaluatedAt) {
  const target = value.data.decisionBrief.data.target;
  const valuation = value.data.valuationQuant.data.valuation;
  const quant = value.data.valuationQuant.data.quant;
  const lab = value.data.portfolioLab.data;
  const scenario = lab.scenarios[value.data.selectedPortfolioScenarioIndex];
  return {
    evaluatedAt,
    membershipId: target.membershipId,
    membershipVersion: target.membershipVersion,
    membershipState: target.membershipState,
    decisionContextId: value.data.decisionBrief.data.sourceIdentity.decisionContextId,
    decisionContextHash: value.data.decisionBrief.data.sourceIdentity.decisionContextHash,
    valuationQuoteSnapshotId: valuation.quote.snapshotId,
    valuationQuotePrice: valuation.quote.price,
    valuationCalculationVersion: valuation.method.calculationVersion,
    quantSnapshotId: quant.model.snapshotId,
    quantSnapshotHash: quant.model.snapshotHash,
    quantModelVersion: quant.model.modelVersion,
    quantCodeIdentity: quant.model.codeIdentity,
    portfolioLabQuantEvidenceId: lab.quant.evidence.evidenceId,
    portfolioContextId: lab.sourceIdentity.portfolioContextId,
    portfolioSnapshotId: lab.sourceIdentity.portfolioSnapshotId,
    riskImpactId: scenario.riskImpact.impactId,
    scenarioCandidateWeight: scenario.riskImpact.scenario.candidateWeight,
    scenarioLargestPositionWeight: scenario.riskImpact.scenario.largestPositionWeight,
    scenarioHhi: scenario.riskImpact.scenario.hhi
  };
}

function retargetEnvelopeIdentity(value, symbol) {
  const [market, code] = symbol.split(".");
  return {
    ...structuredClone(value),
    requestedSymbol: symbol,
    data: value.data ? { ...structuredClone(value.data), market, code, symbol } : null
  };
}

async function browserUatRequestLedger() {
  const routeCounts = new Map();
  for (const request of upstreamRequests) {
    if (request.hasAuthorizationHeader) throw new Error("Web UAT forwarded an Authorization header");
    if (request.method === "GET" && request.bodyBytes !== 0) {
      throw new Error(`Web UAT sent a GET body to ${request.url}`);
    }
    if (forbiddenTradingRoute(request.url)) {
      throw new Error(`Web UAT touched a forbidden route: ${request.method} ${request.url}`);
    }
    const key = `${request.method} ${request.url}`;
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }
  const decisionCreateRoute = "POST /api/mobile/research/profiles/HK/09926/decision-checks";
  if (!latestDecisionCheck || !/^[1-9]\d*$/.test(latestDecisionCheck.id)) {
    throw new Error("Web browser UAT decision-create result is missing a canonical decision check id");
  }
  const decisionReviewRoute = `POST /api/mobile/research/profiles/HK/09926/decision-checks/${latestDecisionCheck.id}/reviews`;
  for (const route of [
    "GET /api/mobile/market/quotes/HK/09926",
    "GET /api/mobile/research/profiles/HK/09926",
    "GET /api/mobile/research/decision-context/HK/09926",
    "GET /api/mobile/research/portfolio/pingan-snapshot/HK/09926",
    "GET /api/mobile/research/portfolio/pingan-current/context",
    "GET /api/mobile/research/profiles/HK/09926/decision-reviews",
    "GET /api/mobile/research/candidate-memberships/1/deep-research",
    "GET /api/mobile/research/candidate-memberships/1/today",
    decisionCreateRoute,
    decisionReviewRoute,
    "PUT /api/mobile/research/profiles/HK/09926",
    "POST /api/mobile/research/profiles/HK/09926/evidence"
  ]) {
    if (!routeCounts.has(route)) throw new Error(`Web browser UAT missed ${route}`);
  }
  for (const routePrefix of [
    "GET /api/mobile/research/candidate-memberships/1/valuation-quant-workbench?",
    "GET /api/mobile/research/candidate-memberships/1/portfolio-lab?",
    "GET /api/mobile/research/candidate-memberships/1/conditional-decision-preview?"
  ]) {
    if (![...routeCounts.keys()].some((route) => route.startsWith(routePrefix))) {
      throw new Error(`Web browser UAT missed ${routePrefix}`);
    }
  }
  if (!latestDecisionCheck?.id) throw new Error("Web browser UAT did not create a decision check identity");
  if (latestReviewRequest?.reviewLearning?.decisionCheckId !== latestDecisionCheck.id) {
    throw new Error("Web browser UAT did not submit review learning for the created decision check");
  }
  if (latestReviewRequest.reviewLearning.conditionalPreviewId !== annualConditionalPreviewFixture.previewId) {
    throw new Error("Web browser UAT review learning did not bind the exercised conditional preview");
  }
  if (![...routeCounts.keys()].some((route) => route.startsWith(
    "GET /api/mobile/research/portfolio/pingan-current/risk-impact?symbol=HK.09926&hypotheticalAmount="
  ))) {
    throw new Error("Web browser UAT missed the HK.09926 neutral risk request");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const screenshots = await Promise.all(browserUatScreenshotNames.map(async (name) => {
    const file = `${browserUatEvidenceDir}/${name}`;
    const [bytes, metadata] = await Promise.all([readFile(file), stat(file)]);
    if (metadata.mtimeMs + 1_000 < browserUatStartedAt) {
      throw new Error(`Web browser UAT screenshot was not refreshed in this session: ${name}`);
    }
    return {
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      viewport: pngViewportFromBytes(bytes)
    };
  }));
  const requestLedger = [...routeCounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([methodPath, count]) => methodPath === decisionCreateRoute
      ? { methodPath, count, result: { decisionCheckId: latestDecisionCheck.id } }
      : { methodPath, count });
  return {
    ok: true,
    smoke: "web-core-journey-ui-browser-uat-closeout",
    head,
    exactHeadClean: status === "",
    requestLedger,
    decisionCheckId: latestDecisionCheck.id,
    reviewLearningCaptured: true,
    screenshots,
    credentialPersistence: false,
    authorizationHeaderForwarded: false,
    tradingSideEffectRequests: 0,
    production: "NO_GO"
  };
}

function forbiddenTradingRoute(url) {
  const pathname = new URL(url, "http://127.0.0.1").pathname;
  return /\/(?:orders|trades|fills|cash|fees|positions|broker|production)(?:\/|$)/i.test(pathname);
}

function pngViewportFromBytes(bytes) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Web browser UAT screenshot must be a PNG with a leading IHDR chunk");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || width > 32_768 || height < 1 || height > 32_768) {
    throw new Error("Web browser UAT screenshot PNG viewport is outside the supported range");
  }
  return { width, height, source: "png_ihdr" };
}

function allowedAdvisoryMutation(method, url) {
  const path = new URL(url, "http://127.0.0.1").pathname;
  return (method === "PUT" && /^\/api\/mobile\/research\/profiles\/HK\/09926$/.test(path))
    || (method === "POST" && /^\/api\/mobile\/research\/profiles\/HK\/(?:00175|09926)\/(?:evidence|decision-checks)$/.test(path))
    || (method === "POST" && /^\/api\/mobile\/research\/profiles\/HK\/(?:00175|09926)\/decision-checks\/[^/]+\/reviews$/.test(path));
}

function requestCount(method, url) {
  return upstreamRequests.filter((item) => item.method === method && item.url === url).length;
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseJsonBody(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} body must be JSON`);
  }
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Web UAT fixture request body is too large");
  }
  return body;
}

function writeEnvelope(data) {
  return {
    schemaVersion: "2026-06-18.research-write.v1",
    status: "succeeded",
    asOf: "2026-06-29T03:00:00.000Z",
    source: { actorType: "test", actorId: "web-smoke", correlationId: null },
    data,
    message: "Recorded."
  };
}

function installDom() {
  const document = new FakeDocument();
  for (const [id, value = ""] of [
    ["symbol-input", "HK.00175"],
    ["load-action"],
    ["auth-header-name", "x-research-write-token"],
    ["auth-token"],
    ["membership-read-header-name", "x-research-read-token"],
    ["membership-read-token"],
    ["membership-write-header-name", "x-research-write-token"],
    ["membership-write-token", "secret"],
    ["safety-statement"],
    ["current-symbol"],
    ["auth-mode"],
    ["stages"],
    ["next-action-card"],
    ["review-feedback-card"],
    ["candidate-refresh"],
    ["candidate-overview"],
    ["candidate-status"],
    ["candidate-list"],
    ["membership-refresh"],
    ["membership-include-archived"],
    ["membership-create"],
    ["candidate-memberships"],
    ["membership-status"],
    ["membership-action-status"],
    ["membership-list"],
    ["portfolio-decision-workspace"],
    ["portfolio-refresh"],
    ["portfolio-workspace-status"],
    ["portfolio-position-count"],
    ["portfolio-market-value"],
    ["portfolio-cash"],
    ["portfolio-concentration"],
    ["portfolio-snapshot-time"],
    ["portfolio-position-rows"],
    ["portfolio-risk-amount", "10000"],
    ["portfolio-risk-run"],
    ["portfolio-risk-result"],
    ["portfolio-gaps"],
    ["portfolio-lab-amounts", "25000,5000"],
    ["portfolio-lab-run"],
    ["portfolio-lab-result"],
    ["investment-control-console"],
    ["deep-research-console"],
    ["deep-research-status"],
    ["deep-research-output"],
    ["deep-research-refresh"],
    ["deep-geely-observations"],
    ["deep-report-payload"],
    ["research-dossier-context-kind", "selected_fact"],
    ["investment-console-source-status"],
    ["investment-console-health"],
    ["investment-console-source-rows"],
    ["research-editor-status"],
    ["research-editor-name", "HK.09926 research"],
    ["research-editor-next-review", "2026-08-18"],
    ["research-editor-current-view", "Continue evidence-bound observation."],
    ["research-editor-current-thesis", "Durable margin evidence remains the central uncertainty."],
    ["research-editor-market-disagreement", "The market may overstate near-term certainty."],
    ["research-editor-invalidation", "Comparable filings disconfirm the margin thesis."],
    ["research-editor-key-variables", "margin\ndeliveries"],
    ["research-editor-catalysts", "next filing"],
    ["research-editor-evidence-gaps", "independent margin evidence"],
    ["research-editor-save"],
    ["research-evidence-status"],
    ["research-evidence-source-type", "filing"],
    ["research-evidence-published-at", "2026-07-18T00:00:00.000Z"],
    ["research-evidence-source-url", "https://example.invalid/hk-09926-filing"],
    ["research-evidence-summary", "The filing adds bounded margin evidence for human review."],
    ["research-evidence-fact-kind", "fact"],
    ["research-evidence-stance", "neutral"],
    ["research-evidence-variable", "margin"],
    ["research-evidence-reliability", "4"],
    ["research-evidence-materiality", "3"],
    ["research-evidence-read"],
    ["research-evidence-add"],
    ["annual-valuation-status"],
    ["annual-valuation-run"],
    ["annual-valuation-output"],
    ["annual-sensitivity-rows"],
    ["annual-quant-filter-rows"],
    ["annual-valuation-limitations"],
    ["annual-conditional-status"],
    ["annual-conditional-run"],
    ["annual-conditional-bind"],
    ["annual-conditional-output"],
    ["annual-metric-currency", "HKD"],
    ["annual-base-metric", "2"],
    ["annual-growth-rate", "0.15"],
    ["annual-horizon-years", "3"],
    ["annual-terminal-multiple", "18"],
    ["annual-discount-rate", "0.1"],
    ["annual-net-cash", "1"],
    ["annual-growth-step", "0.05"],
    ["annual-multiple-step", "2"],
    ["annual-max-drawdown", "0.5"],
    ["annual-max-turnover", "10"],
    ["annual-min-trades", "1"],
    ["annual-scenario-amounts", "25000,5000"],
    ["annual-selected-scenario", "0"],
    ["annual-condition-confidence", "medium"],
    ["annual-observation-start", "2026-07-18"],
    ["annual-observation-end", "2026-08-18"],
    ["annual-review-on", "2026-08-01"],
    ["annual-condition-workflow-state", "await_condition"],
    ["annual-condition-assumptions", "Disclosure remains comparable."],
    ["annual-condition-invalidations", "Bound evidence changes."],
    ["annual-portfolio-condition-enabled"],
    ["annual-portfolio-condition-metric", "scenario_candidate_weight"],
    ["annual-portfolio-condition-comparison", "at_or_above"],
    ["annual-portfolio-condition-threshold", "0.15"],
    ["annual-portfolio-condition-rationale", "Request human review when the user-defined scenario crosses this observation threshold."],
    ["decision-action", "watch"],
    ["decision-result", "needs_more_evidence"],
    ["decision-note", "Wait"],
    ["decision-submit"],
    ["review-outcome", "insufficient_evidence"],
    ["review-evidence", "No new evidence yet."],
    ["review-note", "Keep watching."],
    ["review-submit"],
    ["annual-review-learning-fields"],
    ["annual-review-judgment-correction"],
    ["annual-review-process-lesson"],
    ["annual-review-next-question"],
    ["details"]
  ]) {
    document.seed(id, value);
  }
  document.getElementById("annual-portfolio-condition-enabled").checked = true;
  const geelyObservation = document.createElement("div");
  geelyObservation.dataset.geelyObservation = "";
  document.getElementById("deep-geely-observations").append(geelyObservation);
  document.getElementById("research-evidence-read").checked = true;
  document.getElementById("research-editor-save").dataset.controlAction = "save-profile";
  document.getElementById("research-evidence-add").dataset.controlAction = "add-evidence";
  document.getElementById("annual-valuation-run").dataset.controlAction = "run-valuation";
  document.getElementById("annual-conditional-run").dataset.controlAction = "run-conditional";
  return document;
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition was not met before timeout");
}

function renderedText(element) {
  return [element?.textContent ?? "", ...(element?.children ?? []).map(renderedText)].join(" ");
}

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
