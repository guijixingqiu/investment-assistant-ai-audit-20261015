import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import {
  cleanGitIntervalEvidence,
  deriveSafetyEvidence,
  deriveXcresultExecutionEvidence,
  requestLedgerFromRequests,
  stableGitIntervalEvidence
} from "./ios-gate-b-local-beta-uat-evidence.mjs";
import {
  IOS_GATE_B_UI_TEST_TARGETS,
  IOS_GATE_B_UNIT_TEST_TARGETS
} from "./ios-gate-b-test-matrix.mjs";
import { pinganSnapshotFor09926Smoke } from "./ios-gate-b-smoke-historical-fixtures.mjs";
import {
  TODAY_ACTION_INBOX_SCHEMA_VERSION,
  validateTodayActionInboxEnvelope
} from "../dist/packages/contracts/src/todayActionInbox.js";
import {
  CLOUD_AI_POLICY_SCHEMA_VERSION,
  CLOUD_AI_PROVIDER_POLICY,
  cloudAiPolicySafety
} from "../dist/packages/contracts/src/cloudAiPolicy.js";
import {
  validateCreateDeepResearchTaskRequest,
  validateDeepResearchTaskActionRequest
} from "../dist/packages/contracts/src/deepResearchTask.js";
import { computeAnnualPortfolioLabId } from "../dist/packages/contracts/src/annualPortfolioLab.js";
import {
  annualPortfolioLabFixture,
  portfolioLabSymbols
} from "../tests/unit/helpers/annual-portfolio-lab-fixtures.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const port = 4520;
const conditionalDecisionToken = "conditional-decision-read-token";
const reviewLearningSummaryToken = "review-learning-summary-read-token";
const reviewLearningReadyToken = "review-learning-ready-read-token";
const dailyContinuityColdLaunchToken = "daily-continuity-cold-launch";
const hk09926QuantEvidenceGeneratedAt = "2026-07-09T12:30:00.000Z";
const conditionalPreviewDelayMs = 3_000;
const dailyContinuityContextGeneratedAt = [
  "2026-07-19T00:00:01.000Z",
  "2026-07-19T00:00:02.000Z"
];
const uiDecisionCheckId = "9001";
const appRoot = path.join(root, "apps/ios/AnnualRingsGateA");
const smokeScheme = "AnnualRingsGateAAppSmoke";
const derivedDataPath = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "DerivedData");
const screenshotDir = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "screenshots");
const attachmentExportDir = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "xcresult-attachments");
const resultBundleDir = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "Results");
const evidenceSummaryPath = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "summary.json");
const progressEvidencePath = path.join(root, "artifacts", "ios-gate-b-ui-smoke", "eight-question-progress.json");
const landscapeScreenshotOutputNames = new Set([
  "daily-workbench-large-430.png",
  "daily-workbench-accessibility-430.png"
]);
const testLogDir = path.join(derivedDataPath, "Logs", "Test");
const minimumFreeDiskBytes = 12 * 1024 ** 3;
const eightQuestionUITest = "testAnnualRingsEightQuestionGoldenJourneyCreatesAuditedLearning";
const s1abUITest = "testS1ABTodayNeedsEvidencePackFreezesAndReturnsNeedsResearch";
const s1acUITest = "testS1ACTodayNeedsResearchSavesReportAndReturnsAwaitingConfirmation";
const s1adUITest = "testS1ADTodayConfirmReportReturnsFormalDecisionDue";
const f1dUITest = "testF1DSessionDraftAdoptSubmitRefreshesTodayOnce";
const standardUITestTimeoutMs = 300_000;
const extendedUITestTimeoutMs = 900_000;
const eightQuestionTimeoutMs = 900_000;
const xcodebuildTeardownGraceMs = 60_000;
const extendedUITests = new Set([
  s1abUITest,
  s1acUITest,
  s1adUITest,
  f1dUITest,
  "testDailyWorkbenchCompactStandardAndLargeLayoutsRemainContained",
  "testDailyWorkbenchAccessibilityTextKeepsLayerMenuAndActionsReachable",
  "testAnnualDecisionBriefGoldenJourneyKeepsResearchLayersAndNoTradingSemantics",
  "testAnnualValuationQuantGoldenJourneyRecomputesAndClearsStaleResults",
  "testAnnualPortfolioLabGoldenJourneyBindsOrderedScenariosAndClearsChangedAmounts"
]);
const valuationQuantQueryNames = [
  "metricCurrency",
  "baseMetricPerShare",
  "annualGrowthRate",
  "horizonYears",
  "terminalMultiple",
  "annualDiscountRate",
  "netCashPerShare",
  "growthRateStep",
  "multipleStep",
  "maxDrawdownMagnitude",
  "maxTurnoverOneWay",
  "minTradeCount"
];
const unitTestTargets = [...IOS_GATE_B_UNIT_TEST_TARGETS];
const uiTestTargets = [...IOS_GATE_B_UI_TEST_TARGETS];
const requestedUITest = String(process.env.IOS_GATE_B_UI_SMOKE_ONLY ?? "").trim();
const uiTestExecution = { name: requestedUITest };
const isExecutingUITest = (name) => uiTestExecution.name === name;
const s1abOrS1acOrS1adUITests = new Set([s1abUITest, s1acUITest, s1adUITest, f1dUITest]);
const isS1acUITest = requestedUITest === s1acUITest;
const isS1adUITest = requestedUITest === s1adUITest;
const requestedSimulatorUdid = String(process.env.IOS_GATE_B_SIMULATOR_UDID ?? "").trim();
await Promise.all([
  rm(evidenceSummaryPath, { force: true }),
  rm(progressEvidencePath, { force: true })
]);
if (!requestedSimulatorUdid) {
  throw new Error("IOS_GATE_B_SIMULATOR_UDID is required; automatic Simulator enumeration is prohibited");
}
const xcodebuildOutputArgs = process.env.IOS_GATE_B_XCODEBUILD_VERBOSE === "1" ? [] : ["-quiet"];
const selectedUITestTargets = requestedUITest
  ? uiTestTargets.filter((target) => target.endsWith(`/GateBResearchUITests/${requestedUITest}`))
  : uiTestTargets;
if (requestedUITest && selectedUITestTargets.length !== 1) {
  throw new Error(`unknown IOS_GATE_B_UI_SMOKE_ONLY target: ${requestedUITest}`);
}
const smokeGitStart = await readGitState();
gitIntervalEvidence(smokeGitStart, smokeGitStart, "iOS UI smoke preflight");
const requests = [];
const focusedF1BProfileResponses = [];
const focusedF1BDecisionContextResponses = [];
const focusedF1BPinganResponses = [];
const focusedF1BReviewResponses = [];
const focusedF1BPortfolioContextResponses = [];
const focusedF1BCandidateReadResponses = [];
const focusedF1CTodayResponses = [];
const focusedF1CResponseLedger = [];
const focusedF1CExactReadCounts = new Map([
  ["/api/mobile/market/daily-bars/HK/00700", 1],
  ["/api/mobile/research/today?symbol=HK.00700", 2],
  ["/api/mobile/research/today/inbox", 2],
  ["/api/mobile/research/candidates", 1],
  ["/api/mobile/research/candidate-memberships?includeArchived=true", 1],
  ["/api/mobile/research/profiles/HK/00700", 1],
  ["/api/mobile/research/decision-context/HK/00700", 1],
  ["/api/mobile/research/portfolio/pingan-current/context", 1],
  ["/api/mobile/research/portfolio/pingan-snapshot/HK/00700", 1],
  ["/api/mobile/research/profiles/HK/00700/decision-reviews", 1]
]);
const focusedF1CSupportingReadCounts = new Map([
  ["/health/ready", 2],
  ["/api/mobile/market/discovery", 2]
]);
const focusedF1BMinimumReadCounts = new Map([
  ["/health/ready", 1],
  ["/api/mobile/market/discovery", 1],
  ["/api/mobile/market/quotes/HK/00700", 1],
  ["/api/mobile/market/daily-bars/HK/00700", 1],
  ["/api/mobile/market/environment/HK/00700", 1],
  ["/api/mobile/research/today?symbol=HK.00700", 1],
  ["/api/mobile/research/today/inbox", 1],
  ["/api/mobile/research/candidates", 1],
  ["/api/mobile/research/candidate-memberships?includeArchived=true", 1],
  ["/api/mobile/research/candidate-memberships?includeArchived=false", 1],
  ["/api/mobile/research/profiles/HK/00700", 1],
  ["/api/mobile/research/decision-context/HK/00700", 1],
  // The app cold-launch refresh and the explicit Research-tab visit each re-read
  // the account-scoped context; both must fail closed independently.
  ["/api/mobile/research/portfolio/pingan-current/context", 2],
  ["/api/mobile/research/portfolio/pingan-snapshot/HK/00700", 1],
  ["/api/mobile/research/profiles/HK/00700/decision-reviews", 1],
  ["/api/mobile/assets/alpha", 1]
]);
let decisionCheckCreated = false;
let decisionReviewCreated = false;
let idempotencyKey = null;
let reviewIdempotencyKey = null;
let lastDecisionCheckRequest = null;
let lastDecisionCheck = null;
let lastDecisionReview = null;
let lastDecisionReviewRequest = null;
let lastDecisionSnapshotBinding = null;

function resetDecisionWriteFixture() {
  decisionCheckCreated = false;
  decisionReviewCreated = false;
  idempotencyKey = null;
  reviewIdempotencyKey = null;
  lastDecisionCheckRequest = null;
  lastDecisionCheck = null;
  lastDecisionReviewRequest = null;
  lastDecisionReview = null;
  lastDecisionSnapshotBinding = null;
}
// The fixture keeps the write visibly in flight without adding timing branches to the product.
const f1eReviewResponseDelayMs = () => isExecutingUITest(f1dUITest) ? 3_000 : 0;
let focusedF1EDelayedReviewResponseObserved = false;
const portfolioContextRequestCounts = new Map();
const candidateOverviewRequestCounts = new Map();
const portfolioRiskRequestCounts = new Map();
const conditionalPreviewRequestCounts = new Map();
const pendingRiskFailures = new Map();
let requestHandlerError = null;
let initialFreeDiskBytes = null;
let finalFreeDiskBytes = null;
let smokeCompleted = false;
let testExecutionEvidence = null;
let verifiedSafetyEvidence = null;
let eightQuestionRunStartedAt = null;
const eightQuestionCheckpoints = [];
let s1abFixture = null;
let s1abFrozen = false;
let s1abFreezePostCount = 0;
let s1abTodayReadStates = [];
let s1abWorkspaceReadStates = [];
let s1acFixture = null;
let s1acTaskPostCount = 0;
let s1acTaskReadCount = 0;
let s1acTaskAbsorbPostCount = 0;
let s1acTaskAbsorbed = false;
let s1acTodayReadStates = [];
let s1acWorkspaceReadStates = [];
let s1adFixture = null;
let s1adDecisionPostCount = 0;
let s1adTodayReadStates = [];
let s1adWorkspaceReadStates = [];
let s1adInboxStatuses = [];

const fixtures = {
  quote: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/live-market-quote.json"), "utf8")),
  profile: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/research-profile.json"), "utf8")),
  candidates: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/candidate-overview.json"), "utf8")),
  memberships: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/candidate-memberships.json"), "utf8")),
  todayResearch: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/today-research.json"), "utf8")),
  candidateDecisionIntake: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/candidate-decision-intake.json"), "utf8")),
  context: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/decision-context.json"), "utf8")),
  quantDecisionEvidence: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/quant-decision-evidence.json"), "utf8")),
  pinganSnapshot: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/pingan-snapshot-stale.json"), "utf8")),
  blockedPinganSnapshot: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/pingan-snapshot-unavailable.json"), "utf8")),
  reviewHistory: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/decision-review-history.json"), "utf8")),
  portfolioContext: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/portfolio-decision-context.json"), "utf8")),
  portfolioRiskImpact: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/portfolio-risk-impact.json"), "utf8")),
  annualPortfolioLab: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/annual-portfolio-lab.json"), "utf8")),
  annualConditionalDecision: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/annual-conditional-decision.json"), "utf8")),
  assistAdvisoryScope: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/assist-advisory-scope.json"), "utf8")),
  assistHumanReviewWorkspace: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/assist-human-review-workspace.json"), "utf8")),
  assistReviewFollowUp: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/assist-review-followup-workflow.json"), "utf8")),
  assistDecisionNote: JSON.parse(await readFile(path.join(appRoot, "Tests/AnnualRingsGateATests/Fixtures/assist-decision-note-workflow.json"), "utf8"))
};
const portfolioLabMemberships = requestedUITest === "testAnnualPortfolioLabGoldenJourneyBindsOrderedScenariosAndClearsChangedAmounts"
  ? {
      ...fixtures.memberships,
      memberships: fixtures.memberships.memberships.map((membership) => membership.id === "2"
        ? {
            ...membership,
            code: portfolioLabSymbols.first.code,
            symbol: portfolioLabSymbols.first.symbol,
            state: "tracked",
            version: 2,
            provenance: { ...membership.provenance, research: "research_profiles", quotes: "persisted_market_quotes" },
            research: { status: "available", profileUpdatedAt: "2026-07-03T08:30:00.000Z", name: portfolioLabSymbols.first.name },
            quote: { status: "fresh", source: "futu", fetchedAt: "2026-07-03T08:59:30.000Z", staleReason: null }
          }
        : membership)
    }
  : fixtures.memberships;
if (requestedUITest === "" || s1abOrS1acOrS1adUITests.has(requestedUITest)) {
  const { createS1abFixtureState, createS1acFixtureState, createS1adFixtureState } = await import("./ios-gate-b-s1ab-fixtures.mjs");
  if (requestedUITest === "" || requestedUITest === s1abUITest) s1abFixture = await createS1abFixtureState();
  if (requestedUITest === "" || isS1acUITest) s1acFixture = await createS1acFixtureState();
  if (requestedUITest === "" || isS1adUITest || requestedUITest === f1dUITest) {
    s1adFixture = await createS1adFixtureState();
  }
}
assertZeroPositionPortfolioComparisonParity();
const reviewLearningSummaryFixture = makeReviewLearningSummaryFixture();
const reviewLearningReadyFixture = makeReviewLearningReadyFixture();

const server = createServer((req, res) => {
  void handleSmokeRequest(req, res).catch((error) => {
    requestHandlerError ??= error;
    console.error(`iOS smoke request validation failure: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.writableEnded) {
      respond(res, 500, { message: "iOS smoke request validation failed" });
    }
  });
});

async function handleSmokeRequest(req, res) {
  const body = await readBody(req);
  requests.push({ method: req.method, url: req.url, body, headers: req.headers });
  res.setHeader("content-type", "application/json");

  if (req.method === "GET" && req.url === "/api/mobile/market/quotes/HK/00175") {
    res.end(JSON.stringify(fixtures.quote));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/market/search?q=00175") {
    respond(res, 200, {
      schemaVersion: "2026-08-10.hk-stock-search.v2",
      status: "available",
      query: "00175",
      scope: "local_known_stocks",
      source: { provider: "local_database", fetchedAt: "2026-08-12T02:00:00.000Z", quoteDataOnly: true },
      results: [{ market: "HK", code: "00175", symbol: "HK.00175", name: "吉利汽车" }],
      message: "Futu/OpenD 暂不可用；当前仅显示本地数据库已收录的港股，不是推荐或排名。"
    });
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/market/daily-bars/HK/00175") {
    res.end(JSON.stringify(unavailableDailyTechnical("HK.00175", currentHongKongDate())));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/market/daily-bars/HK/00005") {
    res.end(JSON.stringify(unavailableDailyTechnical("HK.00005", currentHongKongDate())));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/market/quotes/HK/09926") {
    res.end(JSON.stringify(symbolizedQuote("HK.09926")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/market/quotes/HK/00700") {
    res.end(JSON.stringify(symbolizedQuote("HK.00700")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/market/daily-bars/HK/00700") {
    if (isExecutingUITest("testF1CTodayReviewDueOpensExactResearchReviewLayer")) {
      respondFocusedF1C(req, res, 401, { ok: false, message: "read authorization required" });
      return;
    }
    res.end(JSON.stringify(unavailableDailyTechnical("HK.00700", currentHongKongDate())));
    return;
  }
  if (isExecutingUITest("testF1CTodayReviewDueOpensExactResearchReviewLayer")
      && req.method === "GET"
      && req.url === "/api/mobile/research/today/inbox") {
    const token = requestToken(req);
    if (token === "today-review-due-read-token") {
      const envelope = fixtureTodayActionInbox(
        "HK.00700",
        token,
        fixtureTodayReviewDue("HK.00700").event
      );
      respondFocusedF1C(req, res, 200, envelope);
      return;
    }
    respondFocusedF1C(req, res, 401, { ok: false, message: "read authorization required" });
    return;
  }
  const s1aRequestFlow = s1aFlow(req);
  if (isExecutingUITest("testF1CTodayReviewDueOpensExactResearchReviewLayer")
      && req.method === "GET"
      && req.url === "/api/mobile/research/candidate-memberships?includeArchived=false") {
    respondFocusedF1C(req, res, 401, { ok: false, message: "read authorization required" });
    return;
  }
  if (s1aRequestFlow
      && req.method === "GET"
      && req.url === "/api/mobile/market/daily-bars/HK/09926") {
    res.end(JSON.stringify(
      s1aRequestFlow === "s1ac" ? s1acFixture.technical
        : s1aRequestFlow === "s1ad" ? s1adFixture.technical
          : s1abFixture.technical
    ));
    return;
  }
  if (s1aRequestFlow
      && req.method === "GET"
      && req.url === "/api/mobile/market/weinstein/HK/09926?analysisAsOf=2026-07-30") {
    res.end(JSON.stringify(
      s1aRequestFlow === "s1ac" ? s1acFixture.weinstein
        : s1aRequestFlow === "s1ad" ? s1adFixture.weinstein
          : s1abFixture.weinstein
    ));
    return;
  }
  if (isExecutingUITest(f1dUITest)
      && req.method === "GET"
      && req.url === "/api/mobile/research/today/inbox") {
    res.end(JSON.stringify(
      decisionCheckCreated
        ? fixtureF1dTodayActionInbox(requestToken(req))
        : s1adFixture.inbox.final
    ));
    return;
  }
  if (s1aRequestFlow
      && req.method === "GET"
      && req.url === "/api/mobile/research/today/inbox") {
    const inbox = s1aRequestFlow === "s1ac"
      ? s1acFixture.emptyInbox
      : s1aRequestFlow === "s1ad"
        ? (s1adDecisionPostCount > 0 ? s1adFixture.inbox.final : s1adFixture.inbox.initial)
        : s1abFixture.emptyInbox;
    if (s1aRequestFlow === "s1ad") s1adInboxStatuses.push(inbox.status);
    res.end(JSON.stringify(inbox));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/today?symbol=HK.00700") {
    const token = requestToken(req);
    if (token === "today-review-due-read-token") {
      const envelope = fixtureTodayReviewDue("HK.00700");
      focusedF1CTodayResponses.push({
        token,
        statusCode: 200,
        envelope: structuredClone(envelope)
      });
      respondFocusedF1C(req, res, 200, envelope);
      return;
    }
    const envelope = unavailableTodayReviewDue("HK.00700", "read authorization required");
    focusedF1CTodayResponses.push({
      token,
      statusCode: 401,
      envelope: structuredClone(envelope)
    });
    respondFocusedF1C(req, res, 401, envelope);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/today?symbol=HK.00175") {
    respond(res, 200, emptyTodayReviewDue("HK.00175"));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/today?symbol=HK.09926") {
    const envelope = decisionCheckCreated
      ? fixtureTodayReviewDue("HK.09926", lastDecisionReview, lastDecisionCheck)
      : emptyTodayReviewDue("HK.09926");
    respond(res, 200, envelope);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidates") {
    if ((isExecutingUITest("testF1BFourTabsKeepGlobalToolsReachableAndRingsReadOnly")
        && requestToken(req) === "")
      || (isExecutingUITest("testF1CTodayReviewDueOpensExactResearchReviewLayer")
        && requestToken(req) === "today-review-due-read-token")) {
      const envelope = { ok: false, message: "read authorization required" };
      focusedF1BCandidateReadResponses.push({ url: req.url, envelope: structuredClone(envelope) });
      respondFocusedF1C(req, res, 401, envelope);
      return;
    }
    respondCandidateOverview(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships?includeArchived=true") {
    if ((isExecutingUITest("testF1BFourTabsKeepGlobalToolsReachableAndRingsReadOnly")
        && requestToken(req) === "")
      || (isExecutingUITest("testF1CTodayReviewDueOpensExactResearchReviewLayer")
        && requestToken(req) === "today-review-due-read-token")) {
      const envelope = { ok: false, message: "read authorization required" };
      focusedF1BCandidateReadResponses.push({ url: req.url, envelope: structuredClone(envelope) });
      respondFocusedF1C(req, res, 401, envelope);
      return;
    }
    res.end(JSON.stringify(portfolioLabMemberships));
    return;
  }
  if (s1aRequestFlow
      && req.method === "GET"
      && req.url === "/api/mobile/research/candidate-memberships?includeArchived=false") {
    res.end(JSON.stringify(
      s1aRequestFlow === "s1ac" ? s1acFixture.memberships
        : s1aRequestFlow === "s1ad" ? s1adFixture.memberships
          : s1abFixture.memberships
    ));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships?includeArchived=false") {
    if (requestToken(req) === "") {
      respond(res, 401, { ok: false, message: "read authorization required" });
      return;
    }
    res.end(JSON.stringify(portfolioLabMemberships));
    return;
  }
  if (s1aRequestFlow === "s1ad"
      && req.method === "GET"
      && req.url === "/api/mobile/research/candidate-memberships/1/documents") {
    res.end(JSON.stringify(fixtureF1dDocumentList()));
    return;
  }
  const decisionBriefMatch = req.method === "GET"
    ? req.url?.match(/^\/api\/mobile\/research\/candidate-memberships\/(\d+)\/decision-brief$/)
    : null;
  if (decisionBriefMatch) {
    respondAnnualDecisionBrief(req, res, decisionBriefMatch[1]);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships/1/decision-intake") {
    res.end(JSON.stringify(fixtures.candidateDecisionIntake));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships/1/today") {
    if (s1aRequestFlow === "s1ab") {
      const today = s1abFrozen ? s1abFixture.today.frozen : s1abFixture.today.initial;
      s1abTodayReadStates.push(today.items[0]?.trackingState ?? "missing");
      res.end(JSON.stringify(today));
    } else if (s1aRequestFlow === "s1ac") {
      const today = s1acTaskAbsorbed ? s1acFixture.today.final : s1acFixture.today.initial;
      s1acTodayReadStates.push(today.items[0]?.trackingState ?? "missing");
      res.end(JSON.stringify(today));
    } else if (s1aRequestFlow === "s1ad") {
      if (isExecutingUITest(f1dUITest)) {
        res.end(JSON.stringify(s1adFixture.today.final));
        return;
      }
      const today = s1adDecisionPostCount > 0 ? s1adFixture.today.final : s1adFixture.today.initial;
      s1adTodayReadStates.push(today.items[0]?.trackingState ?? "missing");
      res.end(JSON.stringify(today));
    } else {
      res.end(JSON.stringify(fixtures.todayResearch));
    }
    return;
  }
  if (s1aRequestFlow
      && req.method === "GET"
      && req.url === "/api/mobile/research/candidate-memberships/1/valuation-scenarios") {
    res.end(JSON.stringify(
      s1aRequestFlow === "s1ac" ? s1acFixture.scenarioEnvelope
        : s1aRequestFlow === "s1ad" ? s1adFixture.scenarioEnvelope
          : s1abFixture.scenarioEnvelope
    ));
    return;
  }
  if (s1aRequestFlow
      && req.method === "GET"
      && req.url === "/api/mobile/research/candidate-memberships/1/completeness") {
    const fixture = s1aRequestFlow === "s1ac" ? s1acFixture
      : s1aRequestFlow === "s1ad" ? s1adFixture : s1abFixture;
    res.end(JSON.stringify(fixture.completeness));
    return;
  }
  if (s1aRequestFlow
      && req.method === "GET"
      && req.url === "/api/mobile/research/candidate-memberships/1/deep-research") {
    const workspace = s1aRequestFlow === "s1ac"
      ? (s1acTaskAbsorbed ? s1acFixture.workspace.final : s1acFixture.workspace.initial)
      : s1aRequestFlow === "s1ad"
        ? (isExecutingUITest(f1dUITest) || s1adDecisionPostCount > 0
            ? s1adFixture.workspace.final
            : s1adFixture.workspace.initial)
        : (s1abFrozen ? s1abFixture.workspace.frozen : s1abFixture.workspace.initial);
    if (s1aRequestFlow === "s1ac") {
      s1acWorkspaceReadStates.push(s1acTaskAbsorbed ? "user_confirmation_required" : "research_required");
    } else if (s1aRequestFlow === "s1ad") {
      s1adWorkspaceReadStates.push(s1adDecisionPostCount > 0 ? "confirmed" : "user_confirmation_required");
    } else {
      s1abWorkspaceReadStates.push(s1abFrozen ? "research_required" : "pack_required");
    }
    res.end(JSON.stringify(workspace));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships/1/advisory-scope") {
    res.end(JSON.stringify(fixtures.assistAdvisoryScope));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships/1/human-review-workspace") {
    res.end(JSON.stringify(fixtures.assistHumanReviewWorkspace));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships/1/human-review-workspace/follow-up-workflow") {
    res.end(JSON.stringify(fixtures.assistReviewFollowUp));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/candidate-memberships/1/human-review-workspace/follow-up-workflow/decision-note-workflow") {
    res.end(JSON.stringify(fixtures.assistDecisionNote));
    return;
  }
  const valuationQuantURL = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
  const valuationQuantMatch = req.method === "GET"
    ? valuationQuantURL.pathname.match(/^\/api\/mobile\/research\/candidate-memberships\/(\d+)\/valuation-quant-workbench$/)
    : null;
  if (valuationQuantMatch) {
    respondAnnualValuationQuant(req, res, valuationQuantMatch[1], valuationQuantURL);
    return;
  }
  const portfolioLabURL = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
  const portfolioLabMatch = req.method === "GET"
    ? portfolioLabURL.pathname.match(/^\/api\/mobile\/research\/candidate-memberships\/(\d+)\/portfolio-lab$/)
    : null;
  if (portfolioLabMatch) {
    respondAnnualPortfolioLab(req, res, portfolioLabMatch[1], portfolioLabURL);
    return;
  }
  const conditionalDecisionURL = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
  const conditionalDecisionMatch = req.method === "GET"
    ? conditionalDecisionURL.pathname.match(/^\/api\/mobile\/research\/candidate-memberships\/(\d+)\/conditional-decision-preview$/)
    : null;
  if (conditionalDecisionMatch) {
    await respondAnnualConditionalDecision(req, res, conditionalDecisionMatch[1], conditionalDecisionURL);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/00175") {
    res.end(JSON.stringify(symbolizedProfile("HK.00175")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/00005") {
    res.end(JSON.stringify(symbolizedProfile("HK.00005")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/09926") {
    res.end(JSON.stringify(symbolizedProfile("HK.09926")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/00700") {
    const envelope = unauthorizedResearchProfile("HK.00700");
    focusedF1BProfileResponses.push(structuredClone(envelope));
    respondFocusedF1C(req, res, 401, envelope);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/decision-context/HK/00175") {
    res.end(JSON.stringify(symbolizedContext("HK.00175")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/decision-context/HK/00005") {
    res.end(JSON.stringify(symbolizedContext("HK.00005")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/decision-context/HK/09926") {
    const token = requestToken(req);
    let context = token === conditionalDecisionToken
      ? fixtures.candidateDecisionIntake.decisionContext
      : symbolizedContext("HK.09926");
    if (token === dailyContinuityColdLaunchToken) {
      const contextReadCount = requests.filter((request) => (
        request.method === "GET"
          && request.url === req.url
          && requestToken(request) === dailyContinuityColdLaunchToken
      )).length;
      const generatedAt = dailyContinuityContextGeneratedAt[
        Math.min(contextReadCount, dailyContinuityContextGeneratedAt.length) - 1
      ];
      context = { ...context, generatedAt };
    }
    res.end(JSON.stringify(context));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/decision-context/HK/00700") {
    const envelope = unavailableDecisionContext("HK.00700");
    focusedF1BDecisionContextResponses.push(structuredClone(envelope));
    respondFocusedF1C(req, res, 401, envelope);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/portfolio/pingan-current/context") {
    await respondPortfolioContext(req, res);
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/api/mobile/research/portfolio/pingan-current/risk-impact?")) {
    respondPortfolioRiskImpact(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/portfolio/pingan-snapshot/HK/00175") {
    res.end(JSON.stringify(fixtures.pinganSnapshot));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/portfolio/pingan-snapshot/HK/00005") {
    res.end(JSON.stringify(fixtures.blockedPinganSnapshot));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/portfolio/pingan-snapshot/HK/09926") {
    res.end(JSON.stringify(pinganSnapshotFor09926Smoke({
      token: requestToken(req),
      staleSnapshot: fixtures.pinganSnapshot,
      unavailableSnapshot: fixtures.blockedPinganSnapshot
    })));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/portfolio/pingan-snapshot/HK/00700") {
    const envelope = {
      ...fixtures.blockedPinganSnapshot,
      status: "unauthorized",
      requestedSymbol: "HK.00700",
      positions: [],
      positionCount: 0,
      message: "Portfolio snapshot account scope authorization is required."
    };
    focusedF1BPinganResponses.push(structuredClone(envelope));
    respondFocusedF1C(req, res, 401, envelope);
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/00175/decision-reviews") {
    res.end(JSON.stringify(symbolizedReviewHistory("HK.00175")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/00005/decision-reviews") {
    res.end(JSON.stringify({ ...symbolizedReviewHistory("HK.00005"), checks: [] }));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/09926/decision-reviews") {
    if (requestToken(req) === reviewLearningReadyToken) {
      res.end(JSON.stringify(reviewLearningReadyFixture));
      return;
    }
    if (requestToken(req) === reviewLearningSummaryToken) {
      res.end(JSON.stringify(reviewLearningSummaryFixture));
      return;
    }
    const history = symbolizedReviewHistory("HK.09926");
    res.end(JSON.stringify({
      ...history,
      checks: lastDecisionCheck?.symbol === "HK.09926" ? history.checks.slice(0, 1) : []
    }));
    return;
  }
  if (req.method === "GET" && req.url === "/api/mobile/research/profiles/HK/00700/decision-reviews") {
    const envelope = unavailableDecisionReviewHistory("HK.00700");
    focusedF1BReviewResponses.push(structuredClone(envelope));
    respondFocusedF1C(req, res, 401, envelope);
    return;
  }
  if (req.method === "POST" && req.url === "/api/mobile/research/profiles/HK/09926/decision-checks") {
    const parsed = JSON.parse(body || "{}");
    assertDecisionCheckRequest(parsed);
    if (idempotencyKey && parsed.idempotencyKey !== idempotencyKey) {
      respond(res, 409, { message: "changed semantic submission identity" });
      return;
    }
    idempotencyKey = parsed.idempotencyKey;
    lastDecisionCheckRequest = structuredClone(parsed);
    lastDecisionSnapshotBinding = structuredClone(parsed.decisionSnapshotBinding);
    decisionCheckCreated = true;
    const envelope = decisionCheckEnvelope(parsed);
    lastDecisionCheck = envelope.data;
    respond(res, 200, envelope);
    return;
  }
  if (req.method === "POST" && req.url === `/api/mobile/research/profiles/HK/09926/decision-checks/${uiDecisionCheckId}/reviews`) {
    const parsed = JSON.parse(body || "{}");
    assertReviewRequest(parsed);
    if (reviewIdempotencyKey && parsed.idempotencyKey !== reviewIdempotencyKey) {
      respond(res, 409, { message: "changed review idempotency identity" });
      return;
    }
    reviewIdempotencyKey = parsed.idempotencyKey;
    lastDecisionReviewRequest = structuredClone(parsed);
    decisionReviewCreated = true;
    const envelope = decisionReviewEnvelope(parsed);
    lastDecisionReview = envelope.data;
    if (f1eReviewResponseDelayMs() > 0) {
      await new Promise((resolve) => setTimeout(resolve, f1eReviewResponseDelayMs()));
      focusedF1EDelayedReviewResponseObserved = true;
    }
    respond(res, 200, envelope);
    return;
  }
  if (s1aRequestFlow === "s1ab"
      && req.method === "POST"
      && req.url === "/api/mobile/research/candidate-memberships/1/evidence-packs") {
    if (requestToken(req) !== "s1ab-write-token") {
      respond(res, 401, { message: "S1AB fixture write authorization required" });
      return;
    }
    const parsed = JSON.parse(body || "{}");
    assertS1abFreezeRequest(parsed);
    if (s1abFrozen || s1abFreezePostCount > 0) {
      respond(res, 409, { message: "S1AB fixture evidence pack is already frozen" });
      return;
    }
    s1abFrozen = true;
    s1abFreezePostCount += 1;
    respond(res, 200, s1abFixture.writeEnvelope());
    return;
  }
  if (s1aRequestFlow === "s1ac"
      && req.method === "POST"
      && req.url === "/api/mobile/research/candidate-memberships/1/deep-research-tasks") {
    if (requestToken(req) !== "s1ac-write-token") {
      respond(res, 401, { message: "S1AC fixture write authorization required" });
      return;
    }
    const parsed = JSON.parse(body || "{}");
    assertS1acTaskRequest(parsed);
    if (s1acTaskPostCount > 0) {
      respond(res, 409, { message: "S1AC fixture task is already created" });
      return;
    }
    s1acTaskPostCount += 1;
    respond(res, 200, s1acFixture.taskEnvelope(parsed, "pending"));
    return;
  }
  if (s1aRequestFlow === "s1ac"
      && req.method === "GET"
      && req.url === "/api/mobile/research/candidate-memberships/1/deep-research-tasks/91") {
    if (requestToken(req) !== "s1ac-read-token" || s1acTaskPostCount !== 1) {
      respond(res, 401, { message: "S1AC fixture read authorization required" });
      return;
    }
    s1acTaskReadCount += 1;
    const status = s1acTaskAbsorbed ? "succeeded" : s1acTaskReadCount > 13 ? "ready_to_absorb" : "pending";
    respond(res, 200, s1acFixture.taskEnvelope(s1acFixture.taskRequest, status));
    return;
  }
  if (s1aRequestFlow === "s1ac"
      && req.method === "POST"
      && req.url === "/api/mobile/research/candidate-memberships/1/deep-research-tasks/91/absorb") {
    if (requestToken(req) !== "s1ac-write-token") {
      respond(res, 401, { message: "S1AC fixture write authorization required" });
      return;
    }
    const parsed = JSON.parse(body || "{}");
    assertS1acTaskActionRequest(parsed);
    if (s1acTaskAbsorbed || s1acTaskReadCount <= 13) {
      respond(res, 409, { message: "S1AC fixture task is not ready for absorption" });
      return;
    }
    s1acTaskAbsorbPostCount += 1;
    s1acTaskAbsorbed = true;
    respond(res, 200, s1acFixture.taskEnvelope(s1acFixture.taskRequest, "succeeded"));
    return;
  }
  if (s1aRequestFlow && req.method === "GET" && req.url === "/api/mobile/research/cloud-ai-policy") {
    const actorId = "candidate-write-token-principal";
    respond(res, 200, {
      schemaVersion: CLOUD_AI_POLICY_SCHEMA_VERSION, generatedAt: "2026-08-17T00:00:00.000Z",
      status: "available", requestedActorId: actorId, policy: CLOUD_AI_PROVIDER_POLICY,
      state: {
        actorId, status: "enabled", confirmedPolicyVersion: CLOUD_AI_PROVIDER_POLICY.policyVersion,
        confirmedBackupProvider: "none",
        confirmedAt: "2026-08-17T00:00:00.000Z", revokedAt: null,
        deletionRequest: { status: "not_requested", requestedAt: null }
      },
      message: "Cloud AI enabled for the task-owned UI fixture.", safety: cloudAiPolicySafety()
    });
    return;
  }
  if (s1aRequestFlow === "s1ad"
      && req.method === "POST"
      && req.url === "/api/mobile/research/candidate-memberships/1/deep-research-reports/41/decisions") {
    if (requestToken(req) !== "s1ad-write-token") {
      respond(res, 401, { message: "S1AD fixture write authorization required" });
      return;
    }
    const parsed = JSON.parse(body || "{}");
    assertS1adDecisionRequest(parsed);
    if (s1adDecisionPostCount > 0) {
      respond(res, 409, { message: "S1AD fixture report decision is already recorded" });
      return;
    }
    s1adDecisionPostCount += 1;
    respond(res, 200, s1adFixture.decisionWriteEnvelope());
    return;
  }
  respond(res, 404, { message: `unexpected route ${req.method} ${req.url}` });
}

let smokeError = null;
let targetSimulatorUdid = null;
try {
  initialFreeDiskBytes = await assertFreeDiskSpace("before starting the iOS UI smoke");
  console.log(`iOS UI smoke disk preflight: ${formatGiB(initialFreeDiskBytes)} GiB free.`);
  await prepareSmokeArtifacts();
  await listen(server, port);
  await run("xcodegen", ["generate", "--quiet"], { cwd: appRoot });

  const simulator = await simulatorDestination();
  targetSimulatorUdid = simulator.udid;
  const destination = simulator.destination;
  await shutdownSimulator(targetSimulatorUdid);
  const xcodebuildBaseArgs = [
    "-project", "AnnualRingsGateAApp.xcodeproj",
    "-scheme", smokeScheme,
    "-destination", destination,
    "-derivedDataPath", derivedDataPath
  ];
  const xcodebuildOptions = {
    cwd: appRoot,
    ANNUAL_RINGS_GATE_A_BASE_URL: `http://127.0.0.1:${port}`
  };
  await run("xcodebuild", [
      ...xcodebuildBaseArgs,
      "build-for-testing",
      ...xcodebuildOutputArgs
    ], xcodebuildOptions);

  if (!requestedUITest) {
    await assertFreeDiskSpace("before running iOS unit tests");
    await runXcodebuildTestWithRetry([
        ...xcodebuildBaseArgs,
        ...unitTestTargets.map((target) => `-only-testing:${target}`),
        "-resultBundlePath", path.join(resultBundleDir, "unit-tests.xcresult"),
        "test-without-building",
        ...xcodebuildOutputArgs
    ], destination, xcodebuildOptions);
  }

  for (const testTarget of selectedUITestTargets) {
    await assertFreeDiskSpace(`before ${testTarget}`);
    const testName = testTarget.split("/").at(-1);
    uiTestExecution.name = testName;
    if (testName === f1dUITest || testName === eightQuestionUITest) {
      resetDecisionWriteFixture();
    }
    const isEightQuestionJourney = testName === eightQuestionUITest;
    const uiTestTimeoutMs = extendedUITests.has(testName)
      ? extendedUITestTimeoutMs
      : standardUITestTimeoutMs;
    if (isEightQuestionJourney) {
      eightQuestionRunStartedAt = Date.now();
      console.log(
        `Eight-question UI journey started with a hard ${eightQuestionTimeoutMs / 1_000}s XCTest deadline and `
        + `${xcodebuildTeardownGraceMs / 1_000}s xcodebuild teardown grace.`
      );
    }
    await runXcodebuildTestWithRetry([
      ...xcodebuildBaseArgs,
      `-only-testing:${testTarget}`,
      "-resultBundlePath", path.join(resultBundleDir, `ui-${testName}.xcresult`),
      "test-without-building",
      ...(isEightQuestionJourney ? [] : xcodebuildOutputArgs)
    ], destination, isEightQuestionJourney ? {
      ...xcodebuildOptions,
      timeoutMs: eightQuestionTimeoutMs,
      teardownGraceMs: xcodebuildTeardownGraceMs,
      silent: true,
      onOutputLine: recordEightQuestionCheckpoint
    } : {
      ...xcodebuildOptions,
      timeoutMs: uiTestTimeoutMs,
      retryTimeout: true
    });
    if (isEightQuestionJourney) {
      await writeEightQuestionProgressEvidence("passed");
    }
    if (requestHandlerError) {
      throw requestHandlerError;
    }
  }

  testExecutionEvidence = await readXcresultExecutionEvidence();
  await exportScreenshotsFromCurrentXcresults();
  if (requestedUITest) {
    if (requestedUITest === "testAnnualReviewLearningSummaryShowsReadySourcesAndDrillsIntoTimeline") {
      assertFocusedAnnualReviewLearningSummaryRoutes(reviewLearningReadyToken);
      await assertScreenshot("annual-review-learning-ready.png");
    } else if (requestedUITest === "testAnnualReviewLearningSummaryShowsMinimumSampleBoundary") {
      assertFocusedAnnualReviewLearningSummaryRoutes(reviewLearningSummaryToken);
      await assertScreenshot("annual-review-learning-summary.png");
    } else if (requestedUITest === "testAnnualRingsEightQuestionGoldenJourneyCreatesAuditedLearning") {
      await replayDecisionCheck();
      await replayDecisionReview();
      assertFocusedDecisionSnapshotRoutes();
      await assertScreenshot("selected-symbol-decision-screen.png");
      await assertScreenshot("annual-review-learning-summary.png");
      await assertScreenshot("annual-review-learning.png");
      await assertScreenshot("annual-rings-eight-question-golden.png");
      await assertScreenshot("submitted-check-result.png");
    } else if (requestedUITest === "testQuantDecisionEvidenceRefinementShowsBoundedSamplesAndExecution") {
      assertFocusedQuantDecisionEvidenceRoutes();
      await assertScreenshot("quant-decision-evidence.png");
    } else if (requestedUITest === "testAnnualDecisionBriefGoldenJourneyKeepsResearchLayersAndNoTradingSemantics") {
      assertFocusedAnnualDecisionBriefRoutes();
      await assertScreenshot("annual-decision-rings.png");
      await assertScreenshot("annual-decision-brief.png");
    } else if (requestedUITest === "testDailyClientColdLaunchRestoresNavigationAndRereadsFacts") {
      assertFocusedDailyClientContinuityRoutes();
      await assertScreenshot("daily-client-resume.png");
    } else if (requestedUITest === "testDailyClientRetryRecoversUnauthorizedAndOfflineSources") {
      assertFocusedDailyClientRecoveryRoutes();
      await assertScreenshot("daily-client-recovery.png");
    } else if (requestedUITest === "testDailyWorkbenchCompactStandardAndLargeLayoutsRemainContained") {
      assertFocusedResponsiveRoutes("standard content size");
      await assertScreenshot("daily-workbench-compact-320.png");
      await assertScreenshot("daily-workbench-standard-390.png");
      await assertScreenshot("daily-workbench-large-430.png");
    } else if (requestedUITest === "testDailyWorkbenchAccessibilityTextKeepsLayerMenuAndActionsReachable") {
      assertFocusedAccessibilityRoutes();
      await assertScreenshot("daily-workbench-accessibility-320.png");
      await assertScreenshot("daily-workbench-accessibility-390.png");
      await assertScreenshot("daily-workbench-accessibility-430.png");
    } else if (requestedUITest === "testAnnualValuationQuantGoldenJourneyRecomputesAndClearsStaleResults") {
      assertFocusedAnnualValuationQuantRoutes();
      await assertScreenshot("annual-valuation-quant.png");
    } else if (requestedUITest === "testAnnualPortfolioLabGoldenJourneyBindsOrderedScenariosAndClearsChangedAmounts") {
      assertFocusedAnnualPortfolioLabRoutes();
      await assertScreenshot("annual-portfolio-lab.png");
    } else if (requestedUITest === "testAnnualConditionalDecisionGoldenJourneyFreezesBoundFactsAndRejectsStalePreview") {
      assertFocusedAnnualConditionalDecisionRoutes(2);
      await assertScreenshot("annual-conditional-decision.png");
      await assertScreenshot("annual-conditional-decision-fail-closed.png");
    } else if (requestedUITest === "testF1BFourTabsKeepGlobalToolsReachableAndRingsReadOnly") {
      assertFocusedF1BFourTabRoutes();
    } else if (requestedUITest === "testF1CTodayReviewDueOpensExactResearchReviewLayer") {
      assertFocusedF1CTodayReviewDueRoutes();
    } else if (requestedUITest === "testF1DSessionDraftAdoptSubmitRefreshesTodayOnce") {
      assertFocusedF1DSessionDraftFormalDecisionRoutes();
      await assertScreenshot("f1d-session-draft-formal-decision.png");
      await assertScreenshot("f1e-review-form-locked.png");
      await assertScreenshot("f1e-review-resolution-loop.png");
      await assertScreenshot("f1e-resolved-exact-review-9101.png");
    } else if (requestedUITest === s1abUITest) {
      assertFocusedS1ABTodayFreezeRoutes();
      await assertScreenshot("s1ab-today-freeze-return.png");
    } else if (isS1acUITest) {
      assertFocusedS1ACTodayReportRoutes();
      await assertScreenshot("s1ac-today-report-save-return.png");
    } else if (isS1adUITest) {
      assertFocusedS1ADTodayConfirmationRoutes();
      await assertScreenshot("s1ad-today-report-confirmation-return.png");
    }
  } else {
    await replayDecisionCheck();
    await replayDecisionReview();
    assertRoutes();
    await assertScreenshot("selected-symbol-decision-screen.png");
    await assertScreenshot("annual-review-learning-summary.png");
    await assertScreenshot("annual-review-learning-ready.png");
    await assertScreenshot("annual-review-learning.png");
    await assertScreenshot("pingan-snapshot-unavailable.png");
    await assertScreenshot("annual-decision-rings.png");
    await assertScreenshot("current-portfolio-neutral-risk.png");
    await assertScreenshot("quant-decision-evidence.png");
    await assertScreenshot("annual-decision-brief.png");
    await assertScreenshot("annual-valuation-quant.png");
    await assertScreenshot("annual-portfolio-lab.png");
    await assertScreenshot("annual-conditional-decision.png");
    await assertScreenshot("annual-conditional-decision-fail-closed.png");
    await assertScreenshot("daily-workbench-compact-320.png");
    await assertScreenshot("daily-workbench-standard-390.png");
    await assertScreenshot("daily-workbench-large-430.png");
    await assertScreenshot("daily-workbench-accessibility-320.png");
    await assertScreenshot("daily-workbench-accessibility-390.png");
    await assertScreenshot("daily-workbench-accessibility-430.png");
    await assertScreenshot("annual-rings-eight-question-golden.png");
    await assertScreenshot("submitted-check-result.png");
  }
  verifiedSafetyEvidence = assertSmokeRequestSafety(requestedUITest ? `focused ${requestedUITest}` : "full Gate B");
  finalFreeDiskBytes = await assertFreeDiskSpace("after completing the iOS UI smoke");
  smokeCompleted = true;
  console.log(`iOS UI smoke disk closeout: ${formatGiB(finalFreeDiskBytes)} GiB free.`);
  console.log(requestedUITest
    ? `Gate B focused iOS UI smoke completed ${requestedUITest} with cleanup and safety checks.`
    : "Gate B iOS UI smoke completed quote-to-assisted-decision navigation, responsive and accessibility-sized five-layer year rings, all eight investment questions, current Pingan portfolio with Futu quote provenance, user-entered neutral risk and ordered portfolio scenarios, one human-only frozen conditional decision, stale-response clearing, explicit historical disclosure, one audited check, idempotent replay, and zero order/trade/cash/fee/position/broker side effects.");
} catch (error) {
  smokeError = error;
  if (isS1acUITest) {
    console.error(`S1AC failure state: ${JSON.stringify({
      taskPosts: s1acTaskPostCount,
      taskReads: s1acTaskReadCount,
      absorbPosts: s1acTaskAbsorbPostCount,
      absorbed: s1acTaskAbsorbed,
      todayStates: s1acTodayReadStates,
      workspaceStates: s1acWorkspaceReadStates,
      recentRequests: requests.slice(-12).map(({ method, url }) => ({ method, url }))
    })}`);
  }
  if (isS1adUITest) {
    console.error(`S1AD failure state: ${JSON.stringify({
      decisionPosts: s1adDecisionPostCount,
      todayStates: s1adTodayReadStates,
      workspaceStates: s1adWorkspaceReadStates,
      inboxStatuses: s1adInboxStatuses,
      recentRequests: requests.slice(-20).map(({ method, url }) => ({ method, url }))
    })}`);
  }
  if (eightQuestionRunStartedAt !== null) {
    try {
      await writeEightQuestionProgressEvidence(error?.code === "ETIMEDOUT" ? "timed_out" : "failed", error);
    } catch (progressError) {
      console.error(`Eight-question progress evidence was unavailable: ${String(progressError)}`);
    }
  }
  try { await exportScreenshotsFromCurrentXcresults(); } catch {}
  await reportCurrentTestFailures();
  throw error;
} finally {
  const cleanupErrors = [];
  for (const cleanup of [
    () => close(server),
    () => shutdownSimulatorStable(targetSimulatorUdid),
    () => cleanupTemporaryBuildArtifacts(),
    // A test process can briefly wake the exact target after the first shutdown.
    () => shutdownSimulator(targetSimulatorUdid),
    () => assertTemporaryBuildArtifactsRemoved()
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    if (smokeError) {
      throw new AggregateError([smokeError, ...cleanupErrors], "iOS UI smoke verification and cleanup both failed");
    } else {
      throw cleanupErrors[0];
    }
  }
  if (!smokeError && smokeCompleted && targetSimulatorUdid) {
    const postCleanupFreeDiskBytes = await assertFreeDiskSpace("after cleaning iOS UI smoke build results");
    await writeSmokeEvidence(postCleanupFreeDiskBytes);
  }
}

function symbolizedProfile(symbol) {
  const [market, code] = symbol.split(".");
  return {
    ...fixtures.profile,
    requestedSymbol: symbol,
    data: fixtures.profile.data ? {
      ...fixtures.profile.data,
      profile: {
        ...fixtures.profile.data.profile,
        market,
        code,
        symbol
      }
    } : null
  };
}

function symbolizedQuote(symbol) {
  const [market, code] = symbol.split(".");
  return {
    ...fixtures.quote,
    requestedSymbol: symbol,
    data: fixtures.quote.data ? { ...fixtures.quote.data, market, code, symbol } : null,
    message: `Fixture quote for ${symbol}; this is test data, not real market data.`
  };
}

function unavailableDailyTechnical(symbol, cutoff) {
  const [market, code] = symbol.split(".");
  const message = "No stored daily snapshot exists in this fixture Simulator run; runtime evidence is UNKNOWN.";
  return {
    completeness: "incomplete",
    usableForRequestedCutoff: false,
    dailyBars: {
      schemaVersion: "2026-07-29.f1a-daily.v3",
      status: "unavailable",
      request: {
        market, code, symbol, timeframe: "1d", completedSessionsOnly: true,
        adjustment: "forward_qfq_research_only", minimumBars: 80, targetBars: 120, cutoff
      },
      source: {
        provider: "unavailable", endpoint: null, fetchedAt: null, providerCutoff: null, dataCutoffAt: null,
        rights: "unknown", retention: "unknown", derivedUse: "unknown",
        hashMethod: "sha256_canonical_json_v1", rawBytesCaptured: false,
        pageCount: 0, pageContentHashes: [], sourceContentHash: null
      },
      metadata: {
        source: "market_daily:unavailable", asOf: null, fetchedAt: null, freshness: "unavailable",
        provenance: "unavailable", authority: "unavailable", stale: false, missing: false,
        conflict: false, fixture: false, correctionOf: null, replaces: null, message
      },
      snapshot: null,
      message: `UNKNOWN: ${message}`
    },
    technical: {
      schemaVersion: "2026-07-29.f1a-technical.v3",
      status: "unavailable",
      computationVersion: "f1a.indicators.3",
      parameters: {
        ma: [20, 60],
        macd: { fast: 12, slow: 26, signal: 9 },
        bollinger: { window: 20, standardDeviations: 2, variance: "population" },
        rsi: { period: 14, smoothing: "wilder" }
      },
      inputSnapshotSha: null,
      dataCutoffAt: null,
      resultHash: null,
      points: null,
      message: `UNKNOWN: ${message}`
    }
  };
}

function unauthorizedResearchProfile(symbol, now = new Date()) {
  const asOf = now.toISOString();
  return {
    schemaVersion: "2026-06-17.gate-b.v1",
    asOf,
    requestedSymbol: symbol,
    metadata: {
      source: "research_profiles_evidence_suggestions",
      asOf,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: "research_only",
      authority: "research_evidence",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Research profile is unavailable; no research evidence metadata is synthesized."
    },
    data: null,
    message: "read authorization required"
  };
}

function fixtureTodayReviewDue(symbol, review = null, decision = null) {
  const sourceEventId = decision?.id ?? "42";
  const effectiveAt = decision?.checkedAt ?? "2026-07-29T00:30:00.000Z";
  const stateChangedAt = review?.createdAt ?? decision?.checkedAt ?? "2026-07-29T00:30:01.000Z";
  const stateAudit = review?.audit ?? decision?.audit;
  const reportBinding = decision?.researchReportDecision?.availability === "preserved"
    ? decision.researchReportDecision.binding
    : null;
  const actionType = reportBinding ? "DAILY_TRACKING" : "REVIEW_DUE";
  return {
    schemaVersion: "2026-07-30.s1i-adopted-report-daily-tracking.v1",
    status: "available",
    requestedSymbol: symbol,
    metadata: {
      source: "today_action:confirmed_reports_decision_checks_reviews_audit_events",
      asOf: stateChangedAt,
      fetchedAt: new Date().toISOString(),
      freshness: "fresh",
      provenance: "fixture",
      authority: "decision_context",
      stale: false,
      missing: false,
      conflict: false,
      fixture: true,
      correctionOf: null,
      replaces: null,
      message: "Simulator fixture only; this is not a real decision event."
    },
    event: {
      id: `${actionType}|${symbol}|${sourceEventId}|${effectiveAt}`,
      type: actionType,
      subject: symbol,
      sourceEventId,
      effectiveAt,
      priority: { severity: "attention", dueAt: effectiveAt },
      state: review ? "resolved" : "new",
      stateChangedAt,
      stateActor: {
        actorType: reportBinding?.reportDecisionActorType ?? stateAudit?.actorType ?? "user",
        actorId: reportBinding?.reportDecisionActorId ?? stateAudit?.actorId ?? "simulator-fixture-owner"
      },
      stateReason: review
        ? `post_decision_review:${review.outcome}`
        : reportBinding
          ? "adopted_report_requires_daily_tracking"
          : "decision_check_created_without_valid_review",
      bindings: { decisionCheckId: sourceEventId, reviewId: review?.id ?? null },
      humanDecision: {
        actionIntent: decision?.actionIntent ?? "watch",
        humanCheckResult: decision?.humanCheckResult ?? "needs_more_evidence",
        userFinalDecision: decision?.userFinalDecision ?? null,
        formalDecision: decision?.formalDecision ?? {
          availability: "not_captured",
          systemRecommendation: null,
          ownerDecision: null,
          differsFromSystem: null,
          limitation: "This historical decision did not capture separate system-recommendation and Owner-decision snapshots; they are not reconstructed."
        }
      },
      researchReport: reportBinding ? {
        availability: "preserved",
        binding: reportBinding,
        investmentThesis: "Simulator fixture decision-time thesis; not real runtime evidence.",
        invalidationConditions: ["Simulator fixture invalidation; not a real condition."],
        nextValidationQuestion: "Simulator fixture question; not a real provider result.",
        limitation: "Simulator fixture historical snapshot only; non-real and non-runtime."
      } : {
        availability: "not_captured",
        binding: null,
        investmentThesis: "UNKNOWN",
        invalidationConditions: [],
        nextValidationQuestion: "UNKNOWN",
        limitation: "This fixture decision did not capture a report binding."
      }
    },
    advisoryOnly: true,
    safety: todayReviewDueNoEffects(),
    message: review
      ? "Simulator fixture: append-only human review resolved this follow-up."
      : reportBinding
        ? "Simulator fixture: adopted report daily tracking and next validation."
        : "Simulator fixture: immediate post-decision review follow-up."
  };
}

function fixtureTodayActionInbox(symbol, requestedActorId, event) {
  const generatedAt = new Date().toISOString();
  const membership = fixtures.memberships.memberships.find((item) => item.symbol === symbol);
  const item = event && membership ? {
    id: `inbox:event:review_due:${membership.id}:${event.id}`,
    order: 1,
    kind: event.type === "DAILY_TRACKING" ? "daily_tracking" : "review_due",
    priority: "high",
    state: event.state,
    symbol: membership.symbol,
    membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
    source: {
      lane: "review_due", id: event.id, version: Number(event.sourceEventId), status: "available",
      sourceType: "today_review_due_projection", effectiveAt: event.effectiveAt,
      asOf: event.stateChangedAt, fetchedAt: generatedAt, validUntil: null,
      freshness: "fresh", sourceFingerprint: null
    },
    title: `${membership.symbol} 正式复盘待跟进`,
    summary: event.stateReason,
    researchTarget: null,
    reviewEvent: event
  } : null;
  const envelope = {
    schemaVersion: TODAY_ACTION_INBOX_SCHEMA_VERSION,
    generatedAt,
    status: item ? "available" : "empty",
    requestedActorId: requestedActorId || "f1d-fixture-owner",
    metadata: {
      source: "today_action_inbox", asOf: event?.stateChangedAt ?? null, fetchedAt: generatedAt,
      freshness: item ? "fresh" : "missing", provenance: "fixture", authority: "research_evidence",
      stale: false, missing: item === null, conflict: false, fixture: true,
      correctionOf: null, replaces: null,
      message: item
        ? "Fixture projection of the current tracked membership review action."
        : "No formal decision exists before the explicit fixture submission."
    },
    trackedMembershipCount: membership ? 1 : 0,
    omittedMembershipCount: 0,
    items: item ? [item] : [],
    omittedItemCount: 0,
    message: item ? "One exact review action is available." : "No action is available.",
    safety: {
      advisoryOnly: true, createsOrder: false, createsTrade: false, mutatesCash: false,
      writesFee: false, mutatesPosition: false, callsBroker: false, productionWrite: false
    }
  };
  const validation = validateTodayActionInboxEnvelope(envelope);
  if (!validation.ok) throw new Error(`F1D Today inbox fixture invalid: ${validation.errors.join("; ")}`);
  return envelope;
}

function fixtureF1dTodayActionInbox(requestedActorId) {
  const event = decisionCheckCreated
    ? fixtureTodayReviewDue("HK.09926", lastDecisionReview, lastDecisionCheck).event
    : null;
  return fixtureTodayActionInbox("HK.09926", requestedActorId, event);
}

function fixtureF1dDocumentList() {
  const material = structuredClone(s1adFixture.pack.items.find((item) => item.citation));
  if (!material) throw new Error("F1D document fixture requires the cited frozen material");
  material.verificationStatus = "unverified";
  return {
    schemaVersion: "2026-08-08.research-document.v2",
    generatedAt: new Date().toISOString(),
    status: "available",
    requestedActorId: "candidate-write-token-principal",
    membershipId: "1",
    membershipVersion: 3,
    symbol: "HK.09926",
    documents: [{
      id: "8",
      membershipId: "1",
      membershipVersionAtImport: 3,
      market: "HK",
      code: "09926",
      symbol: "HK.09926",
      title: "Owner-provided issuer disclosure",
      originalFilename: "issuer-disclosure.pdf",
      publishedAt: "2026-07-24T08:00:00.000Z",
      importedAt: "2026-07-24T08:05:00.000Z",
      sourceVersion: "2026-07-v2",
      parserName: "pdfjs-dist",
      parserVersion: "6.2.108",
      normalizationVersion: "nfkc-whitespace-v1",
      sourceClassification: "owner_declared_official",
      rightsStatus: "user_provided",
      rightsConfirmedAt: "2026-07-24T08:04:00.000Z",
      rightsDeclarationVersion: "owner-local-processing-rights-v1",
      sourceState: "available",
      pdfSha256: "c".repeat(64),
      byteLength: 1024,
      pageCount: 5
    }],
    materials: [material]
  };
}

function emptyTodayReviewDue(symbol) {
  return {
    schemaVersion: "2026-07-30.s1h-confirmed-report-action.v1",
    status: "empty",
    requestedSymbol: symbol,
    metadata: {
      source: "today_action:confirmed_reports_decision_checks_reviews_audit_events",
      asOf: null,
      fetchedAt: "2026-07-29T01:00:00.000Z",
      freshness: "missing",
      provenance: "fixture",
      authority: "decision_context",
      stale: false,
      missing: true,
      conflict: false,
      fixture: true,
      correctionOf: null,
      replaces: null,
      message: "Simulator fixture has no formal decision before explicit submission."
    },
    event: null,
    advisoryOnly: true,
    safety: todayReviewDueNoEffects(),
    message: "No actor-scoped formal decision exists for this Simulator fixture."
  };
}

function unavailableTodayReviewDue(symbol, message) {
  return {
    schemaVersion: "2026-07-30.s1h-confirmed-report-action.v1",
    status: "unavailable",
    requestedSymbol: symbol,
    metadata: {
      source: "today_review_due:unavailable",
      asOf: null,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Today REVIEW_DUE facts are unavailable; no prior event is retained."
    },
    event: null,
    advisoryOnly: true,
    safety: todayReviewDueNoEffects(),
    message
  };
}

function todayReviewDueNoEffects() {
  return {
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false
  };
}

function unavailableDecisionContext(symbol, now = new Date()) {
  const generatedAt = now.toISOString();
  const metadata = (source, provenance, authority, message) => ({
    source, asOf: null, fetchedAt: null, freshness: "unavailable", provenance, authority,
    stale: false, missing: false, conflict: false, fixture: false,
    correctionOf: null, replaces: null, message
  });
  const message = "decision context repository is unavailable";
  return {
    schemaVersion: "2026-06-23.core-1a.v1",
    contextId: `decision-context:${symbol}:unavailable`,
    contextHash: "decision-context-unavailable",
    generatedAt,
    requestedSymbol: symbol,
    provenance: {
      quote: "persisted_market_quotes",
      research: "research_profiles_evidence_suggestions",
      quant: "quant_research_evidence",
      portfolio: "omitted"
    },
    quote: {
      status: "unavailable", snapshotId: null, fetchedAt: null, source: null,
      staleReason: "decision_context_unavailable",
      metadata: metadata(
        "decision_context.quote:persisted_market_quotes", "unavailable", "market_data",
        "Decision-context quote is unavailable; no fresh quote metadata is synthesized."
      ),
      data: null,
      message
    },
    research: {
      status: "unavailable", profile: null, evidence: [], suggestions: [], evidenceAsOf: null,
      staleReason: "decision_context_unavailable",
      metadata: metadata(
        "decision_context.research:research_profiles_evidence_suggestions", "research_only", "research_evidence",
        "Decision-context research is unavailable; no research evidence metadata is synthesized."
      ),
      message
    },
    suggestionSummary: {
      status: "unavailable", kind: "advisory_information",
      summary: "Decision context is unavailable; no advisory summary is available.",
      linkedEvidenceIds: [],
      limitations: ["No stale quote, research, portfolio, order, trade, cash, fee, or position facts are exposed."]
    },
    quantEvidence: {
      status: "unavailable",
      metadata: metadata(
        "decision_context.quant:decision_context_unavailable", "quant_evidence", "quant_evidence",
        "Decision-context quant evidence is unavailable; no quant research evidence metadata is synthesized."
      ),
      identities: null,
      sampleBoundary: {
        universe: [], sourceClassification: "unavailable", finalTestPolicy: "unavailable",
        limitation: "Quant evidence is fail-closed with the decision context."
      },
      limitations: ["No stale quant, shadow portfolio, order, trade, cash, fee, position, broker, or official portfolio facts are exposed."],
      authority: {
        researchOnly: true, advisoryOnly: true, changesCandidateOrdering: false,
        changesMembershipState: false, changesHumanReviewResult: false, mutatesLocalRecord: false,
        officialReviewFact: false, officialPortfolioFact: false, brokerWrite: false,
        recommendation: false, ranking: false, score: false, allocation: false, sizing: false,
        targetPrice: false, buySellHold: false, orderTradeFillAuthority: false,
        cashFeePositionMutation: false
      },
      message: "Quant evidence is unavailable and cannot affect candidate order, review, portfolio, broker, or trading facts."
    },
    portfolio: {
      status: "omitted",
      reason: "authoritative_portfolio_source_not_approved",
      message: "Portfolio context remains omitted because no approved authoritative live portfolio source is available."
    },
    message
  };
}

function unavailableDecisionReviewHistory(symbol) {
  return {
    schemaVersion: "2026-06-28.core-1c-review.v1",
    requestedSymbol: symbol,
    metadata: {
      source: "decision_review_history:unavailable",
      asOf: null,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Decision review history metadata is unavailable; no stale review facts are exposed."
    },
    checks: [],
    advisoryOnly: true,
    safety: {
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false
    },
    message: "read authorization required"
  };
}

function currentHongKongDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function respondAnnualDecisionBrief(req, res, membershipId) {
  const token = req.headers["x-internal-token"] ?? "";
  if (token === "decision-brief-unauthorized") {
    respond(res, 401, { message: "decision brief unauthorized" });
    return;
  }
  const membership = fixtures.memberships.memberships.find((item) => item.id === membershipId);
  if (!membership) {
    respond(res, 404, { message: "candidate membership not found" });
    return;
  }
  const brief = annualDecisionBriefForMembership(membership);
  if (token === "decision-brief-malformed") {
    respond(res, 200, { ...brief, requestedSymbol: "HK.00005" });
    return;
  }
  if (token === "decision-brief-stale") {
    brief.metadata = { ...brief.metadata, freshness: "stale", stale: true };
    brief.data.readiness = {
      state: "blocked",
      reasons: ["Futu quote facts are stale."],
      hasCounterOrGap: brief.data.readiness.hasCounterOrGap,
      threeMinuteReviewReady: false
    };
  }
  respond(res, 200, brief);
}

function annualDecisionBriefForMembership(membership) {
  const profileEnvelope = symbolizedProfile(membership.symbol);
  const profile = profileEnvelope.data.profile;
  const evidence = profileEnvelope.data.evidence;
  const context = symbolizedContext(membership.symbol);
  const generatedAt = "2026-07-17T01:00:00.000Z";
  const support = evidence.filter((item) => item.stance === "support");
  const counter = evidence.filter((item) => item.stance === "refute");
  const neutral = evidence.filter((item) => item.stance === "neutral");
  const variableNames = [...new Set(profile.keyVariables ?? [])];
  const gaps = [...new Set(profile.evidenceGaps ?? [])];
  const readinessReasons = [];
  if (membership.state !== "tracked") readinessReasons.push(`Candidate lifecycle is ${membership.state}.`);
  if (!profile.currentView) readinessReasons.push("Why-now is missing.");
  if (!profile.currentThesis) readinessReasons.push("Thesis is missing.");
  if (!profile.marketDisagreement) readinessReasons.push("Market disagreement is missing.");
  if (!profile.invalidationCondition) readinessReasons.push("Invalidation condition is missing.");
  if (variableNames.length === 0) readinessReasons.push("Key variables are missing.");
  if ((profile.catalysts ?? []).length === 0) readinessReasons.push("Catalysts are missing.");
  if (support.length === 0) readinessReasons.push("Support evidence is missing.");
  if (counter.length === 0 && gaps.length === 0) readinessReasons.push("Counter evidence or an explicit gap is missing.");
  const readinessState = readinessReasons.length === 0
    ? "ready_for_three_minute_review"
    : membership.state === "archived" ? "blocked" : "research_required";
  return {
    schemaVersion: "2026-07-17.ios-annual-rings-decision-brief.v1",
    generatedAt,
    status: "available",
    membershipId: membership.id,
    requestedActorId: membership.actorId,
    requestedSymbol: membership.symbol,
    metadata: {
      source: "annual_decision_brief:candidate_intake_research_quant",
      asOf: profileEnvelope.asOf,
      fetchedAt: generatedAt,
      freshness: context.quantEvidence.metadata.freshness,
      provenance: context.quantEvidence.metadata.fixture ? "fixture" : "research_only",
      authority: "research_evidence",
      stale: false,
      missing: false,
      conflict: false,
      fixture: context.quantEvidence.metadata.fixture,
      correctionOf: null,
      replaces: null,
      message: "Decision brief groups actor-scoped research and quant facts for manual review only."
    },
    data: {
      target: {
        membershipId: membership.id,
        membershipVersion: membership.version,
        membershipState: membership.state,
        market: membership.market,
        code: membership.code,
        symbol: membership.symbol
      },
      sourceIdentity: {
        generatedAt,
        researchAsOf: profileEnvelope.asOf,
        evidenceAsOf: evidence.map((item) => item.capturedAt).sort().at(-1) ?? null,
        quoteSnapshotId: context.quote.snapshotId,
        decisionContextId: context.contextId,
        decisionContextHash: context.contextHash
      },
      whyNow: profile.currentView,
      thesis: profile.currentThesis,
      marketDisagreement: profile.marketDisagreement,
      invalidationCondition: profile.invalidationCondition,
      nextReviewOn: profile.nextReviewOn,
      keyVariables: variableNames.map((name) => {
        const linked = evidence.filter((item) => item.variableName === name);
        return {
          name,
          evidenceIds: linked.map((item) => item.id),
          supportCount: linked.filter((item) => item.stance === "support").length,
          counterCount: linked.filter((item) => item.stance === "refute").length,
          neutralCount: linked.filter((item) => item.stance === "neutral").length,
          highestReliability: maximumNullable(linked.map((item) => item.reliability)),
          highestMateriality: maximumNullable(linked.map((item) => item.materiality))
        };
      }),
      catalysts: profile.catalysts ?? [],
      evidence: {
        support,
        counter,
        neutral,
        conflicts: variableNames.flatMap((name) => {
          const supportingEvidenceIds = support.filter((item) => item.variableName === name).map((item) => item.id);
          const counterEvidenceIds = counter.filter((item) => item.variableName === name).map((item) => item.id);
          return supportingEvidenceIds.length > 0 && counterEvidenceIds.length > 0
            ? [{ variableName: name, supportingEvidenceIds, counterEvidenceIds }]
            : [];
        }),
        gaps
      },
      quantEvidence: context.quantEvidence,
      readiness: {
        state: readinessState,
        reasons: readinessReasons,
        hasCounterOrGap: counter.length > 0 || gaps.length > 0,
        threeMinuteReviewReady: readinessState === "ready_for_three_minute_review"
      }
    },
    safety: {
      advisoryOnly: true,
      changesCandidateOrdering: false,
      recommendation: false,
      ranking: false,
      targetPrice: false,
      targetPosition: false,
      tradeDirection: false,
      createsOrder: false,
      createsTrade: false,
      callsBroker: false,
      mutatesOfficialPortfolio: false
    },
    message: `Daily decision brief for ${membership.symbol}; ${readinessState}.`
  };
}

function respondAnnualValuationQuant(req, res, membershipId, url) {
  const membership = fixtures.memberships.memberships.find((item) => item.id === membershipId);
  if (!membership) {
    respond(res, 404, { message: "candidate membership not found" });
    return;
  }
  const input = parseAnnualValuationQuantInputs(url);
  respond(res, 200, annualValuationQuantForMembership(membership, input));
}

function respondAnnualPortfolioLab(req, res, membershipId, url) {
  const membership = portfolioLabMemberships.memberships.find((item) => item.id === membershipId);
  if (!membership) {
    respond(res, 404, { message: "candidate membership not found" });
    return;
  }
  const amounts = parseAnnualPortfolioLabInputs(url);
  const fixtureAmounts = fixtures.annualPortfolioLab.data.scenarios.map((item) => item.hypotheticalAmount);
  if (JSON.stringify(amounts) !== JSON.stringify(fixtureAmounts)) {
    throw new Error(`portfolio lab fixture does not match ordered user amounts: ${url.search}`);
  }
  if (requestedUITest !== "testAnnualPortfolioLabGoldenJourneyBindsOrderedScenariosAndClearsChangedAmounts") {
    if (membership.symbol !== fixtures.annualPortfolioLab.requestedSymbol
      || membership.version !== fixtures.annualPortfolioLab.data.target.membershipVersion) {
      throw new Error(`portfolio lab fixture identity does not match membership ${membershipId}`);
    }
    respond(res, 200, structuredClone(fixtures.annualPortfolioLab));
    return;
  }
  const envelope = structuredClone(annualPortfolioLabFixture({
    target: membershipId === "1" ? portfolioLabSymbols.second : portfolioLabSymbols.first,
    membershipVersion: membership.version,
    scenarioAmounts: amounts
  }));
  envelope.membershipId = membership.id;
  envelope.data.target.membershipId = membership.id;
  const { labId: _labId, generatedAt: _generatedAt, ...labHashInput } = envelope;
  envelope.labId = computeAnnualPortfolioLabId(labHashInput);
  respond(res, 200, envelope);
}

async function respondAnnualConditionalDecision(req, res, membershipId, url) {
  const read = annualConditionalDecisionRequest({
    method: req.method,
    url: `${url.pathname}${url.search}`,
    body: "",
    headers: req.headers
  });
  if (!read || read.membershipId !== membershipId) {
    throw new Error(`conditional decision preview route did not preserve membership ${membershipId}`);
  }
  assertAnnualConditionalDecisionRequest(read);
  incrementRequestCount(conditionalPreviewRequestCounts, requestToken(req));
  await sleep(conditionalPreviewDelayMs);
  respond(res, 200, structuredClone(fixtures.annualConditionalDecision));
}

function parseAnnualPortfolioLabInputs(url) {
  const names = [...url.searchParams.keys()];
  if (names.length < 1 || names.length > 4 || names.some((name) => name !== "scenarioAmount")) {
    throw new Error(`portfolio lab query keys were not exact: ${url.search}`);
  }
  const values = url.searchParams.getAll("scenarioAmount");
  if (values.length !== names.length) {
    throw new Error(`portfolio lab query did not preserve repeated amount keys: ${url.search}`);
  }
  const amounts = values.map(Number);
  if (amounts.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`portfolio lab query contained an invalid amount: ${url.search}`);
  }
  return amounts;
}

function parseAnnualValuationQuantInputs(url) {
  const names = [...url.searchParams.keys()];
  if (names.length !== valuationQuantQueryNames.length
    || valuationQuantQueryNames.some((name) => url.searchParams.getAll(name).length !== 1)
    || names.some((name) => !valuationQuantQueryNames.includes(name))) {
    throw new Error(`valuation quant query keys were not exact: ${url.search}`);
  }
  const number = (name) => {
    const value = Number(url.searchParams.get(name));
    if (!Number.isFinite(value)) throw new Error(`valuation quant query ${name} was not finite`);
    return value;
  };
  const horizonYears = number("horizonYears");
  const minTradeCount = number("minTradeCount");
  if (!Number.isSafeInteger(horizonYears) || !Number.isSafeInteger(minTradeCount)) {
    throw new Error("valuation quant integer query inputs were not integers");
  }
  return {
    valuation: {
      metricCurrency: url.searchParams.get("metricCurrency"),
      baseMetricPerShare: number("baseMetricPerShare"),
      annualGrowthRate: number("annualGrowthRate"),
      horizonYears,
      terminalMultiple: number("terminalMultiple"),
      annualDiscountRate: number("annualDiscountRate"),
      netCashPerShare: number("netCashPerShare"),
      growthRateStep: number("growthRateStep"),
      multipleStep: number("multipleStep")
    },
    quantFilter: {
      maxDrawdownMagnitude: number("maxDrawdownMagnitude"),
      maxTurnoverOneWay: number("maxTurnoverOneWay"),
      minTradeCount
    }
  };
}

function parseAnnualConditionalDecisionInputs(url) {
  const singularNames = [...valuationQuantQueryNames, "selectedPortfolioScenarioIndex"];
  const names = [...url.searchParams.keys()];
  const scenarioValues = url.searchParams.getAll("scenarioAmount");
  if (scenarioValues.length < 1 || scenarioValues.length > 4
    || names.length !== singularNames.length + scenarioValues.length
    || singularNames.some((name) => url.searchParams.getAll(name).length !== 1)
    || names.some((name) => name !== "scenarioAmount" && !singularNames.includes(name))) {
    throw new Error(`conditional decision preview query keys were not exact: ${url.search}`);
  }
  const number = (name) => {
    const value = Number(url.searchParams.get(name));
    if (!Number.isFinite(value)) throw new Error(`conditional decision preview query ${name} was not finite`);
    return value;
  };
  const horizonYears = number("horizonYears");
  const minTradeCount = number("minTradeCount");
  const selectedPortfolioScenarioIndex = number("selectedPortfolioScenarioIndex");
  if (!Number.isSafeInteger(horizonYears) || !Number.isSafeInteger(minTradeCount)
    || !Number.isSafeInteger(selectedPortfolioScenarioIndex)) {
    throw new Error("conditional decision preview integer query inputs were not integers");
  }
  const scenarioAmounts = scenarioValues.map(Number);
  if (scenarioAmounts.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`conditional decision preview query contained an invalid scenario amount: ${url.search}`);
  }
  return {
    valuation: {
      metricCurrency: url.searchParams.get("metricCurrency"),
      baseMetricPerShare: number("baseMetricPerShare"),
      annualGrowthRate: number("annualGrowthRate"),
      horizonYears,
      terminalMultiple: number("terminalMultiple"),
      annualDiscountRate: number("annualDiscountRate"),
      netCashPerShare: number("netCashPerShare"),
      growthRateStep: number("growthRateStep"),
      multipleStep: number("multipleStep")
    },
    quantFilter: {
      maxDrawdownMagnitude: number("maxDrawdownMagnitude"),
      maxTurnoverOneWay: number("maxTurnoverOneWay"),
      minTradeCount
    },
    scenarioAmounts,
    selectedPortfolioScenarioIndex
  };
}

function annualValuationQuantForMembership(membership, input) {
  const generatedAt = "2026-07-17T01:15:00.000Z";
  const context = annualValuationContext(membership.symbol);
  const evidence = structuredClone(context.quantEvidence);
  const refinement = evidence.decisionEvidence;
  const valuation = annualValuationResult(context.quote, input.valuation);
  const diagnosticGap = (subject) => ({
    status: "not_captured",
    limitation: `${subject} is not captured by the accepted quant evidence manifest; it is not inferred from adjacent artifacts.`
  });
  const filterSamples = refinement.samples.map((sample, sourceIndex) => {
    const maxDrawdownMagnitude = valuationQuantRoundSix(Math.abs(sample.metrics.simulatedMaxDrawdown));
    const turnoverOneWay = valuationQuantRoundSix(sample.metrics.simulatedTurnoverOneWay);
    const tradeCount = sample.metrics.simulatedTradeCount;
    const matchesMaxDrawdown = maxDrawdownMagnitude <= input.quantFilter.maxDrawdownMagnitude;
    const matchesMaxTurnover = turnoverOneWay <= input.quantFilter.maxTurnoverOneWay;
    const matchesMinTradeCount = tradeCount >= input.quantFilter.minTradeCount;
    return {
      sampleId: sample.id,
      sourceIndex,
      maxDrawdownMagnitude,
      turnoverOneWay,
      tradeCount,
      matchesMaxDrawdown,
      matchesMaxTurnover,
      matchesMinTradeCount,
      allCriteriaMatched: matchesMaxDrawdown && matchesMaxTurnover && matchesMinTradeCount
    };
  });
  return {
    schemaVersion: "2026-07-17.ios-annual-rings-valuation-quant.v1",
    generatedAt,
    status: "available",
    membershipId: membership.id,
    requestedActorId: membership.actorId,
    requestedSymbol: membership.symbol,
    metadata: {
      source: "annual_valuation_quant_workbench:candidate_intake_quote_quant",
      asOf: context.quote.data.quoteTime,
      fetchedAt: generatedAt,
      freshness: "historical",
      provenance: "fixture",
      authority: "research_evidence",
      stale: false,
      missing: false,
      conflict: false,
      fixture: true,
      correctionOf: null,
      replaces: null,
      message: "User-defined valuation calculations and canonical quant evidence are composed for manual research only."
    },
    data: {
      target: {
        membershipId: membership.id,
        membershipVersion: membership.version,
        membershipState: membership.state,
        market: membership.market,
        code: membership.code,
        symbol: membership.symbol
      },
      sourceIdentity: {
        decisionContextId: context.contextId,
        decisionContextHash: context.contextHash,
        generatedAt
      },
      valuation,
      quant: {
        status: evidence.status,
        evidence,
        model: {
          modelVersion: evidence.identities.baselineExperimentIdentity,
          universe: [...evidence.sampleBoundary.universe],
          sourceClassification: evidence.sampleBoundary.sourceClassification,
          adjustment: refinement.source.adjustment,
          dataCutoff: refinement.source.dataCutoff,
          snapshotId: evidence.identities.frozenSnapshot.snapshotId,
          snapshotHash: evidence.identities.frozenSnapshot.snapshotHash,
          codeIdentity: evidence.identities.baselineExperimentIdentity
        },
        diagnostics: {
          benchmark: diagnosticGap("Benchmark comparison"),
          sampleSize: diagnosticGap("Observation sample size"),
          concentration: diagnosticGap("Trade, stock, and month concentration"),
          parameterNeighborhood: diagnosticGap("Parameter-neighborhood robustness"),
          marketEnvironment: diagnosticGap("Market-environment or regime classification"),
          failedExperiments: {
            status: refinement.robustness.failedExperiments.status === "registered" ? "available" : "not_captured",
            experimentIds: [...refinement.robustness.failedExperiments.experimentIds],
            limitation: refinement.robustness.failedExperiments.limitation
          }
        },
        filter: {
          status: "available",
          criteria: input.quantFilter,
          samples: filterSamples,
          preservesSourceOrder: true,
          ranking: false,
          score: false,
          recommendation: false
        },
        limitations: [...new Set([
          ...evidence.limitations,
          ...refinement.limitations,
          "User-defined filters annotate canonical sample order only; they never rank candidates, score strategies, or select a strategy."
        ])]
      }
    },
    safety: {
      advisoryOnly: true,
      userInputsRequired: true,
      changesCandidateOrdering: false,
      recommendation: false,
      ranking: false,
      score: false,
      targetPrice: false,
      targetPosition: false,
      tradeDirection: false,
      createsOrder: false,
      createsTrade: false,
      callsBroker: false,
      mutatesOfficialPortfolio: false
    },
    message: `User-defined valuation and bounded quant evidence for ${membership.symbol}.`
  };
}

function annualValuationContext(symbol) {
  const original = symbolizedContext(symbol);
  const quoteTime = "2026-07-17T01:14:30.000Z";
  const fetchedAt = "2026-07-17T01:14:35.000Z";
  const context = {
    ...original,
    quote: {
      ...original.quote,
      status: "fresh",
      snapshotId: `${symbol}:${quoteTime}:${fetchedAt}`,
      fetchedAt,
      source: "futu",
      staleReason: null,
      metadata: {
        ...original.quote.metadata,
        source: "decision_context.quote:futu",
        asOf: quoteTime,
        fetchedAt,
        freshness: "fresh",
        provenance: "futu",
        fixture: true,
        message: "Fixture Futu quote is fresh for valuation recomputation."
      },
      data: {
        ...original.quote.data,
        price: 10.5,
        previousClose: 10,
        change: 0.5,
        changePercent: 5,
        quoteTime
      }
    }
  };
  const { contextId: _contextId, contextHash: _contextHash, generatedAt: _generatedAt, ...hashInput } = context;
  const contextHash = sha256(canonicalJson(hashInput));
  return {
    ...context,
    contextId: `decision-context:${symbol}:${contextHash.slice(0, 16)}`,
    contextHash
  };
}

function annualValuationResult(quoteEnvelope, input) {
  const projectedMetric = input.baseMetricPerShare * Math.pow(1 + input.annualGrowthRate, input.horizonYears);
  const discountFactor = Math.pow(1 + input.annualDiscountRate, input.horizonYears);
  const presentValue = projectedMetric * input.terminalMultiple / discountFactor + input.netCashPerShare;
  const impliedBase = (quoteEnvelope.data.price - input.netCashPerShare) * discountFactor
    / (input.baseMetricPerShare * input.terminalMultiple);
  const impliedGrowth = impliedBase > 0 ? Math.pow(impliedBase, 1 / input.horizonYears) - 1 : null;
  const growthRates = [
    valuationQuantClamp(input.annualGrowthRate - input.growthRateStep, -0.95, 3),
    input.annualGrowthRate,
    valuationQuantClamp(input.annualGrowthRate + input.growthRateStep, -0.95, 3)
  ].map(valuationQuantRoundSix);
  const terminalMultiples = [
    valuationQuantClamp(input.terminalMultiple - input.multipleStep, 0.1, 200),
    input.terminalMultiple,
    valuationQuantClamp(input.terminalMultiple + input.multipleStep, 0.1, 200)
  ].map(valuationQuantRoundSix);
  return {
    status: "available",
    quote: {
      snapshotId: quoteEnvelope.snapshotId,
      symbol: quoteEnvelope.data.symbol,
      currency: quoteEnvelope.data.currency,
      price: quoteEnvelope.data.price,
      quoteTime: quoteEnvelope.data.quoteTime,
      fetchedAt: quoteEnvelope.fetchedAt,
      source: quoteEnvelope.source
    },
    inputs: input,
    method: {
      id: "discounted_forward_metric_multiple_user_scenario",
      calculationVersion: "2026-07-17.discounted-forward-metric-multiple.v1",
      presentValueFormula: "baseMetricPerShare * (1 + annualGrowthRate) ^ horizonYears * terminalMultiple / (1 + annualDiscountRate) ^ horizonYears + netCashPerShare",
      impliedExpectationFormula: "((currentPrice - netCashPerShare) * (1 + annualDiscountRate) ^ horizonYears / (baseMetricPerShare * terminalMultiple)) ^ (1 / horizonYears) - 1",
      rounding: "decimal_places_6"
    },
    outputs: {
      projectedMetricPerShare: valuationQuantRoundSix(projectedMetric),
      scenarioPresentValuePerShare: valuationQuantRoundSix(presentValue),
      impliedAnnualGrowthRateAtCurrentPrice: impliedGrowth === null ? null : valuationQuantRoundSix(impliedGrowth),
      impliedExpectationStatus: impliedGrowth === null ? "not_computable" : "available"
    },
    sensitivity: {
      growthRates,
      terminalMultiples,
      cells: growthRates.flatMap((annualGrowthRate) => terminalMultiples.map((terminalMultiple) => ({
        annualGrowthRate,
        terminalMultiple,
        presentValuePerShare: valuationQuantRoundSix(
          input.baseMetricPerShare * Math.pow(1 + annualGrowthRate, input.horizonYears)
            * terminalMultiple / discountFactor + input.netCashPerShare
        )
      })))
    },
    limitations: [
      "Every assumption is supplied by the user; the system provides no default fair value or target price.",
      "The calculation is a transparent forward-metric scenario, not a forecast, recommendation, ranking, or trading instruction.",
      "Net cash per share and the selected metric are user inputs and are not verified accounting facts."
    ]
  };
}

function valuationQuantClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function valuationQuantRoundSix(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function maximumNullable(values) {
  const present = values.filter((value) => Number.isInteger(value));
  return present.length > 0 ? Math.max(...present) : null;
}

function respondCandidateOverview(req, res) {
  const token = req.headers["x-internal-token"] ?? "";
  const count = incrementRequestCount(candidateOverviewRequestCounts, token);
  if (token === "daily-continuity-recovery" && count === 1) {
    respond(res, 401, { message: "candidate authorization requires refresh" });
    return;
  }
  if (token === "candidate-empty") {
    res.end(JSON.stringify({
      ...fixtures.candidates,
      status: "empty",
      message: "No tracked candidates are currently available.",
      metadata: candidateOverviewMetadata({
        freshness: "missing",
        missing: true,
        message: "Candidate overview metadata is missing because no tracked candidates are available."
      }),
      candidates: []
    }));
    return;
  }
  if (token === "candidate-unauthorized") {
    respond(res, 401, { message: "unauthorized candidate overview" });
    return;
  }
  if (token === "candidate-unavailable") {
    res.end(JSON.stringify({
      ...fixtures.candidates,
      status: "unavailable",
      message: "Candidate overview is unavailable.",
      metadata: candidateOverviewMetadata({
        freshness: "unavailable",
        authority: "unavailable",
        message: "Candidate overview metadata is unavailable."
      }),
      candidates: []
    }));
    return;
  }
  if (token === "candidate-malformed") {
    res.end(JSON.stringify({
      ...fixtures.candidates,
      status: "available",
      provenance: { ...fixtures.candidates.provenance, portfolio: "pingan" }
    }));
    return;
  }
  if (token === "candidate-missing-quote") {
    res.end(JSON.stringify({
      ...fixtures.candidates,
      candidates: fixtures.candidates.candidates.map((candidate) => candidate.symbol === "HK.00175"
        ? {
            ...candidate,
            quote: {
              status: "unavailable",
              source: null,
              fetchedAt: null,
              staleReason: "no_persisted_quote",
              metadata: candidateQuoteMetadata({
                source: "candidate_overview.quote:persisted_market_quotes",
                asOf: null,
                fetchedAt: null,
                freshness: "missing",
                provenance: "unavailable",
                authority: "unavailable",
                missing: true,
                message: "Candidate quote metadata is missing because no persisted quote exists."
              })
            }
          }
        : candidate)
    }));
    return;
  }
  res.end(JSON.stringify(fixtures.candidates));
}

function candidateOverviewMetadata(overrides = {}) {
  return {
    ...fixtures.candidates.metadata,
    ...overrides
  };
}

function candidateQuoteMetadata(overrides = {}) {
  return {
    ...fixtures.candidates.candidates[0].quote.metadata,
    ...overrides
  };
}

async function respondPortfolioContext(req, res) {
  const token = requestToken(req);
  const count = incrementRequestCount(portfolioContextRequestCounts, token);
  if (isExecutingUITest("testF1BFourTabsKeepGlobalToolsReachableAndRingsReadOnly") && token === ""
    || isExecutingUITest("testF1CTodayReviewDueOpensExactResearchReviewLayer")
      && token === "today-review-due-read-token") {
    const envelope = failClosedPortfolioContext(
      "unauthorized",
      "Current Pingan portfolio account scope authorization is required."
    );
    focusedF1BPortfolioContextResponses.push(structuredClone(envelope));
    respondFocusedF1C(req, res, 401, envelope);
    return;
  }
  if (token === "daily-continuity-recovery") {
    const recovered = count > 1
      && await waitForRequestCount(candidateOverviewRequestCounts, token, 2, 2_000);
    if (!recovered) {
      req.socket.destroy();
      return;
    }
  }
  if (token === "portfolio-stale") {
    res.end(JSON.stringify(stalePortfolioContext()));
    return;
  }
  if (token === "portfolio-partial") {
    res.end(JSON.stringify(partialPortfolioContext()));
    return;
  }
  if (count === 1 || !token.startsWith("portfolio-")) {
    res.end(JSON.stringify(fixtures.portfolioContext));
    return;
  }
  if (token === "portfolio-risk-delay-symbol") {
    res.end(JSON.stringify(fixtures.portfolioContext));
    completePendingRiskFailure(token);
    return;
  }
  if (token === "portfolio-conflict") {
    respond(res, 409, failClosedPortfolioContext("conflict", "Current portfolio source conflict."));
    return;
  }
  if (token === "portfolio-unauthorized") {
    respond(res, 401, failClosedPortfolioContext("unauthorized", "Current portfolio authorization is unavailable."));
    return;
  }
  if (token === "portfolio-offline") {
    req.socket.destroy();
    return;
  }
  if (token === "portfolio-malformed") {
    res.end("{not-json");
    return;
  }
  res.end(JSON.stringify(fixtures.portfolioContext));
}

async function waitForRequestCount(counts, token, minimum, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while ((counts.get(token) ?? 0) < minimum && Date.now() < deadline) {
    await sleep(50);
  }
  return (counts.get(token) ?? 0) >= minimum;
}

function respondPortfolioRiskImpact(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const symbol = url.searchParams.get("symbol");
  const amount = url.searchParams.get("hypotheticalAmount");
  if (url.pathname !== "/api/mobile/research/portfolio/pingan-current/risk-impact"
    || symbol !== "HK.00175"
    || !["10000", "10000.0", "20000", "20000.0"].includes(amount)) {
    respond(res, 400, { message: "risk-impact query must use canonical HK.00175 and an exact smoke amount" });
    return;
  }

  const token = requestToken(req);
  const requestCount = incrementRequestCount(portfolioRiskRequestCounts, token);
  if (["portfolio-risk-delay-amount", "portfolio-risk-delay-symbol"].includes(token) && requestCount === 1) {
    pendingRiskFailures.set(token, res);
    return;
  }
  if (token === "portfolio-risk-delay-amount" && Number(amount) === 20000) {
    res.end(JSON.stringify(portfolioRiskImpactForAmount(20000)));
    completePendingRiskFailure(token);
    return;
  }
  if (requestCount === 1) {
    res.end(JSON.stringify(fixtures.portfolioRiskImpact));
    return;
  }

  if (token === "portfolio-risk-mismatch") {
    const mismatch = {
      ...fixtures.portfolioRiskImpact,
      contextId: `portfolio-decision-context:${"0".repeat(64)}`,
      message: "content-valid fixture intentionally bound to a different portfolio context"
    };
    res.end(JSON.stringify(withRiskImpactId(mismatch)));
    return;
  }

  res.end(JSON.stringify({
    ...fixtures.portfolioRiskImpact,
    status: "blocked",
    impactId: null,
    contextId: fixtures.portfolioContext.contextId,
    portfolioSnapshotId: fixtures.portfolioContext.portfolioSnapshotId,
    candidateSymbol: symbol,
    hypotheticalAmount: Number(amount),
    current: {
      alreadyHeld: null,
      marketValue: null,
      weight: null
    },
    scenario: {
      totalMarketValue: null,
      candidateMarketValue: null,
      candidateWeight: null,
      weightChange: null,
      largestPositionWeight: null,
      hhi: null
    },
    gaps: ["portfolio_changed_during_calculation"],
    message: "blocked: current portfolio changed during calculation; reload is required"
  }));
}

function completePendingRiskFailure(token) {
  const pending = pendingRiskFailures.get(token);
  if (!pending) {
    return;
  }
  pendingRiskFailures.delete(token);
  setTimeout(() => {
    respond(pending, 503, { message: "delayed older risk failure" });
  }, 300);
}

function portfolioRiskImpactForAmount(amount) {
  const total = fixtures.portfolioContext.summary.marketValue.amount + amount;
  return withRiskImpactId({
    ...structuredClone(fixtures.portfolioRiskImpact),
    hypotheticalAmount: amount,
    current: {
      alreadyHeld: true,
      marketValue: fixtures.portfolioContext.positions[0].marketValue,
      weight: fixtures.portfolioContext.positions[0].marketWeight
    },
    scenario: {
      totalMarketValue: total,
      candidateMarketValue: total,
      candidateWeight: 1,
      weightChange: 0,
      largestPositionWeight: 1,
      hhi: 1
    },
    message: `scenario only for exact user amount ${amount}`
  });
}

function stalePortfolioContext() {
  return withPortfolioContextId({
    ...structuredClone(fixtures.portfolioContext),
    status: "stale",
    positions: fixtures.portfolioContext.positions.map((position) => ({
      ...structuredClone(position),
      quote: { ...position.quote, status: "stale" }
    })),
    summary: {
      ...structuredClone(fixtures.portfolioContext.summary),
      marketValue: {
        ...fixtures.portfolioContext.summary.marketValue,
        status: "complete_stale"
      }
    },
    dataUse: {
      ...fixtures.portfolioContext.dataUse,
      display: "allowed_with_warning",
      advisoryRiskImpact: "blocked_stale"
    },
    gaps: ["Pingan portfolio or Futu quote is stale."],
    message: "Portfolio context is displayable with warning; neutral risk calculation is blocked."
  });
}

function partialPortfolioContext() {
  return withPortfolioContextId({
    ...structuredClone(fixtures.portfolioContext),
    status: "partial",
    positions: fixtures.portfolioContext.positions.map((position) => ({
      ...structuredClone(position),
      quote: { status: "unavailable", source: null, quoteAsOf: null, fetchedAt: null },
      latestPrice: null,
      marketValue: null,
      marketWeight: null
    })),
    summary: {
      ...structuredClone(fixtures.portfolioContext.summary),
      marketValue: {
        status: "partial",
        amount: null,
        currency: null,
        missingPositionCount: fixtures.portfolioContext.positions.length
      },
      concentration: {
        status: "unavailable",
        largestPositionWeight: null,
        topThreeWeight: null,
        hhi: null
      }
    },
    dataUse: {
      ...fixtures.portfolioContext.dataUse,
      display: "allowed_with_warning",
      advisoryRiskImpact: "blocked_incomplete"
    },
    gaps: ["Approved Futu quote is unavailable for one or more positions."],
    message: "Portfolio context is partial; neutral risk calculation is blocked."
  });
}

function zeroPositionPortfolioContext(phase, portfolioAsOf, assembledAt) {
  return withPortfolioContextId({
    ...structuredClone(fixtures.portfolioContext),
    status: "zero_position",
    contextId: null,
    portfolioSnapshotId: `pingan-current-portfolio:${phase}`,
    portfolioAsOf,
    assembledAt,
    positions: [],
    summary: {
      ...structuredClone(fixtures.portfolioContext.summary),
      positionCount: 0,
      marketValue: { status: "complete_current", amount: 0, currency: "HKD", missingPositionCount: 0 },
      concentration: { status: "unavailable", largestPositionWeight: null, topThreeWeight: null, hhi: null }
    },
    dataUse: {
      ...fixtures.portfolioContext.dataUse,
      display: "allowed",
      advisoryRiskImpact: "blocked"
    },
    gaps: ["The complete current Pingan snapshot contains zero positions."],
    message: "Zero-position portfolio facts."
  });
}

function failClosedPortfolioContext(status, message) {
  return {
    ...structuredClone(fixtures.portfolioContext),
    status,
    contextId: null,
    portfolioSnapshotId: null,
    portfolioSource: null,
    portfolioAsOf: null,
    positions: [],
    summary: {
      positionCount: 0,
      marketValue: { status: "unavailable", amount: null, currency: null, missingPositionCount: 0 },
      cash: { status: "unknown", amount: null, currency: null, reason: "not_provided_by_authoritative_snapshot" },
      concentration: { status: "unavailable", largestPositionWeight: null, topThreeWeight: null, hhi: null }
    },
    dataUse: {
      ...fixtures.portfolioContext.dataUse,
      display: "blocked",
      advisoryRiskImpact: "blocked"
    },
    gaps: [message],
    message
  };
}

function withPortfolioContextId(context) {
  const { contextId: _contextId, assembledAt: _assembledAt, ...factSet } = context;
  return {
    ...context,
    contextId: `portfolio-decision-context:${sha256(canonicalJson(factSet))}`
  };
}

function withRiskImpactId(impact) {
  const { impactId: _impactId, ...factSet } = impact;
  return {
    ...impact,
    impactId: `portfolio-risk-impact:${sha256(canonicalJson(factSet))}`
  };
}

function withDecisionSnapshotId(snapshot) {
  const { snapshotId: _snapshotId, ...factSet } = snapshot;
  return {
    ...snapshot,
    snapshotId: `decision-snapshot:${sha256(canonicalJson(factSet))}`
  };
}

function requestToken(req) {
  return String(req.headers["x-internal-token"] ?? "");
}

function s1aFlow(req) {
  const token = requestToken(req);
  if (requestedUITest === s1abUITest || token === "s1ab-read-token" || token === "s1ab-write-token") return "s1ab";
  if (isS1acUITest || token === "s1ac-read-token" || token === "s1ac-write-token") return "s1ac";
  if (isS1adUITest || isExecutingUITest(f1dUITest)
      || token === "s1ad-read-token" || token === "s1ad-write-token") return "s1ad";
  return null;
}

function incrementRequestCount(counts, key) {
  const next = (counts.get(key) ?? 0) + 1;
  counts.set(key, next);
  return next;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
    value[key] === undefined ? [] : [[key, canonicalize(value[key])]]
  )));
}

function symbolizedContext(symbol) {
  const [market, code] = symbol.split(".");
  const quantEvidence = symbol === "HK.09926" ? {
    ...fixtures.context.quantEvidence,
    identities: {
      frozenSnapshot: {
        snapshotId: fixtures.quantDecisionEvidence.source.snapshotId,
        snapshotHash: fixtures.quantDecisionEvidence.source.snapshotHash,
        dataHash: fixtures.quantDecisionEvidence.source.dataHash,
        sourceClassification: fixtures.quantDecisionEvidence.source.sourceClassification
      },
      baselineExperimentIdentity: fixtures.quantDecisionEvidence.source.baselineExperimentIdentity,
      splitIds: fixtures.quantDecisionEvidence.samples.map((sample) => sample.id),
      shadowPortfolioIdentity: fixtures.quantDecisionEvidence.source.shadowPortfolioIdentity,
      shadowPortfolioId: "hk-09926-shadow-research-v0.1",
      generatedAt: hk09926QuantEvidenceGeneratedAt
    },
    sampleBoundary: {
      ...fixtures.context.quantEvidence.sampleBoundary,
      universe: [symbol]
    },
    decisionEvidence: structuredClone(fixtures.quantDecisionEvidence)
  } : symbol === "HK.00175" ? fixtures.context.quantEvidence : missingQuantEvidence(symbol);
  const context = {
    ...fixtures.context,
    generatedAt: symbol === "HK.09926"
      ? hk09926QuantEvidenceGeneratedAt
      : fixtures.context.generatedAt,
    requestedSymbol: symbol,
    quote: fixtures.context.quote ? {
      ...fixtures.context.quote,
      snapshotId: fixtures.context.quote.snapshotId?.replace(/^HK\.\d{5}/, symbol) ?? null,
      data: fixtures.context.quote.data ? {
        ...fixtures.context.quote.data,
        market,
        code,
        symbol
      } : null
    } : fixtures.context.quote,
    research: fixtures.context.research ? {
      ...fixtures.context.research,
      profile: fixtures.context.research.profile ? {
        ...fixtures.context.research.profile,
        market,
        code,
        symbol
      } : null
    } : fixtures.context.research,
    quantEvidence
  };
  const { contextId: _contextId, contextHash: _contextHash, generatedAt: _generatedAt, ...hashInput } = context;
  const contextHash = sha256(canonicalJson(hashInput));
  return {
    ...context,
    contextId: `decision-context:${symbol}:${contextHash.slice(0, 16)}`,
    contextHash
  };
}

function missingQuantEvidence(symbol) {
  return {
    status: "missing",
    metadata: {
      ...fixtures.context.quantEvidence.metadata,
      source: `decision_context.quant:missing:${symbol}`,
      asOf: null,
      fetchedAt: null,
      freshness: "missing",
      missing: true,
      fixture: false,
      message: `No candidate-bound quant evidence is available for ${symbol}.`
    },
    identities: null,
    sampleBoundary: {
      universe: [],
      sourceClassification: "unavailable",
      finalTestPolicy: "unavailable",
      limitation: "No quant evidence is reused from another candidate."
    },
    limitations: ["Candidate-bound quant evidence is missing and no other symbol's evidence is displayed."],
    authority: structuredClone(fixtures.context.quantEvidence.authority),
    decisionEvidence: null,
    message: `Quant evidence is missing for ${symbol}.`
  };
}

function symbolizedReviewHistory(symbol) {
  const [market, code] = symbol.split(".");
  const submittedReviews = lastDecisionReview
      && lastDecisionCheck
      && lastDecisionReview.decisionCheckId === lastDecisionCheck.id
    ? isExecutingUITest(f1dUITest)
      ? [{
          ...structuredClone(lastDecisionReview),
          id: "9100",
          outcomeEvidence: "较早的受控复盘样本，不是 Today 指定目标。",
          reviewNote: "用于证明 resolved 导航不会停在较早复盘。",
          reviewedAt: "2026-07-29T00:30:00.000Z",
          createdAt: "2026-07-29T00:30:00.000Z",
          audit: {
            ...structuredClone(lastDecisionReview.audit),
            idempotencyKey: "f1e-prior-review-fixture"
          }
        }, lastDecisionReview]
      : [lastDecisionReview]
    : [];
  const submittedCheck = lastDecisionCheck && lastDecisionCheck.symbol === symbol
    ? [(() => {
        const {
          audit: _writeAudit,
          conditionalDecision,
          ...recordedCheck
        } = lastDecisionCheck;
        return {
        ...recordedCheck,
        ...(conditionalDecision == null ? {} : { conditionalDecision }),
        contextSnapshot: {
          availability: "preserved",
          envelope: structuredClone(
            lastDecisionCheck.decisionSnapshot?.snapshot?.decisionContext
              ?? symbolizedContext(symbol)
          ),
          limitation: "Exact recorded decision context snapshot is preserved from check submission time."
        },
        reviews: submittedReviews
      };
    })()]
    : [];
  const checks = [
    ...submittedCheck,
    ...fixtures.reviewHistory.checks.map((check) => ({
      ...check,
      market,
      code,
      symbol,
      reviews: check.reviews.map((review) => ({
        ...review,
        market,
        code,
        symbol
      }))
    }))
  ];
  return {
    ...fixtures.reviewHistory,
    requestedSymbol: symbol,
    metadata: {
      ...fixtures.reviewHistory.metadata,
      message: `Fixture review history metadata for ${symbol} is append-only advisory review context only.`
    },
    checks,
    learningSummary: smokeReviewLearningSummary(checks),
    message: `Post-decision review history for ${symbol} is advisory review only and cannot create orders, trades, fills, cash movements, fees, position mutations, or broker calls.`
  };
}

function makeReviewLearningSummaryFixture() {
  const priorCheck = lastDecisionCheck;
  const priorReview = lastDecisionReview;
  try {
    const preview = structuredClone(fixtures.annualConditionalDecision);
    const source = preview.data.decisionBrief.data.sourceIdentity;
    const decisionRequest = {
      decisionContextSchemaVersion: fixtures.candidateDecisionIntake.decisionContext.schemaVersion,
      contextId: source.decisionContextId,
      contextHash: source.decisionContextHash,
      actionIntent: "watch",
      humanCheckResult: "needs_more_evidence",
      userFinalDecision: "继续观察，不自动生成交易。",
      decisionSnapshotBinding: expectedDecisionSnapshotBinding(),
      conditionalDecision: {
        preview,
        judgment: {
          confidence: "medium",
          assumptions: ["Commercial adoption remains measurable through disclosed facts."],
          invalidationConditions: ["Adoption remains below the declared threshold."],
          portfolioObservationConditions: [{
            metric: "scenario_candidate_weight",
            comparison: "at_or_above",
            threshold: 0.9,
            rationale: "Request human review if the same user amount crosses this exposure observation level.",
            purpose: "human_review_trigger_only"
          }],
          observationWindow: { startsOn: "2026-07-17", endsOn: "2026-10-17" },
          reviewOn: "2026-08-15",
          workflowState: "await_condition"
        }
      },
      idempotencyKey: "review-learning-summary-check-fixture"
    };
    lastDecisionCheck = decisionCheckEnvelope(decisionRequest).data;
    const reviewRequest = {
      outcome: "insufficient_evidence",
      outcomeEvidence: "复盘证据仍不足，保持观察。",
      reviewNote: "仅记录复盘，不生成交易。",
      portfolioReviewBinding: expectedPostDecisionPortfolioReviewBinding(),
      reviewLearning: {
        schemaVersion: "2026-07-17.annual-review-learning.v1",
        decisionCheckId: uiDecisionCheckId,
        decisionSnapshotId: lastDecisionCheck.decisionSnapshot.snapshot.snapshotId,
        conditionalPreviewId: lastDecisionCheck.conditionalDecision.preview.previewId,
        judgmentCorrection: "保留原判断，但将证据不足明确改为待核验条件。",
        processLesson: "先核对反方证据与事实时点，再解释结果。",
        nextResearchQuestion: "哪个披露事实最能区分采用趋势与短期渠道波动？"
      },
      idempotencyKey: "review-learning-summary-review-fixture"
    };
    lastDecisionReview = decisionReviewEnvelope(reviewRequest).data;
    const history = symbolizedReviewHistory("HK.09926");
    const checks = history.checks.slice(0, 1);
    return { ...history, checks, learningSummary: smokeReviewLearningSummary(checks) };
  } finally {
    lastDecisionCheck = priorCheck;
    lastDecisionReview = priorReview;
  }
}

function makeReviewLearningReadyFixture() {
  const history = structuredClone(reviewLearningSummaryFixture);
  const template = history.checks[0];
  const checks = Array.from({ length: 5 }, (_, index) => {
    const checkId = String(Number(uiDecisionCheckId) + index);
    const reviewId = `review-ready-${index + 1}`;
    const check = structuredClone(template);
    check.id = checkId;
    check.checkedAt = `2026-07-${String(17 - index).padStart(2, "0")}T03:00:00.000Z`;
    check.reviews = check.reviews.map((review) => {
      const portfolioReview = structuredClone(review.portfolioReview);
      if (portfolioReview?.availability === "preserved" && portfolioReview.snapshot) {
        const { snapshotId: _snapshotId, ...snapshotInput } = portfolioReview.snapshot;
        snapshotInput.decisionCheckId = checkId;
        portfolioReview.snapshot = {
          ...snapshotInput,
          snapshotId: `post-decision-portfolio-review:${sha256(canonicalJson(snapshotInput))}`
        };
      }
      return {
        ...review,
        id: reviewId,
        decisionCheckId: checkId,
        reviewedAt: `2026-07-${String(17 - index).padStart(2, "0")}T03:05:00.000Z`,
        createdAt: `2026-07-${String(17 - index).padStart(2, "0")}T03:05:00.000Z`,
        portfolioReview,
        reviewLearning: {
          ...review.reviewLearning,
          snapshot: {
            ...review.reviewLearning.snapshot,
            decisionCheckId: checkId
          }
        },
        audit: {
          ...review.audit,
          idempotencyKey: `review-learning-ready-${index + 1}`
        }
      };
    });
    return check;
  });
  return { ...history, checks, learningSummary: smokeReviewLearningSummary(checks) };
}

function smokeReviewLearningSummary(checks) {
  const eligible = checks.flatMap((check) => check.conditionalDecision?.availability === "preserved"
    && check.conditionalDecision.judgment
    ? check.reviews.map((review) => ({
        check,
        review,
        confidence: check.conditionalDecision.judgment.confidence
      }))
    : []);
  const captured = eligible.filter(({ review }) => review.reviewLearning?.availability === "preserved"
    && review.reviewLearning.snapshot);
  const ready = captured.length >= 5;
  return {
    schemaVersion: "2026-07-17.annual-review-learning-summary.v1",
    availability: captured.length === 0 ? "learning_not_captured" : ready ? "ready" : "insufficient_sample",
    generatedAt: "2026-07-17T03:05:00.000Z",
    minimumSampleSize: 5,
    counts: {
      eligibleReviews: eligible.length,
      capturedLearningRecords: captured.length,
      notCapturedLearningRecords: eligible.length - captured.length
    },
    confidenceOutcomes: ready ? smokeConfidenceOutcomeRows(captured) : [],
    repeatedProcessLessons: ready ? smokeRepeatedLessons(captured) : [],
    quantSampleLimitations: ready ? smokeQuantSampleLimitations(captured) : [],
    limitation: ready
      ? "This personal descriptive summary separates frozen confidence, later human review outcomes, exact repeated process lessons, and frozen quant sample limits. It does not infer correctness, attribute profit or loss, score, compare users, recommend, rank, size, direct, or execute an investment decision."
      : captured.length === 0
        ? "No captured actor-scoped review-learning records are available; historical gaps are not reconstructed from current facts."
        : `Only ${captured.length} captured actor-scoped learning records are available; at least 5 are required before descriptive aggregates are shown.`,
    safety: {
      personalActorOnly: true,
      descriptiveOnly: true,
      infersCorrectness: false,
      usesProfitLoss: false,
      comparesUsers: false,
      score: false,
      recommendation: false,
      ranking: false,
      targetPrice: false,
      targetPosition: false,
      tradeDirection: false,
      createsOrder: false,
      createsTrade: false,
      callsBroker: false
    }
  };
}

function smokeConfidenceOutcomeRows(records) {
  const outcomes = ["thesis_confirmed", "thesis_weakened", "thesis_invalidated", "insufficient_evidence"];
  return ["low", "medium", "high"].map((confidence) => {
    const matches = records.filter((record) => record.confidence === confidence);
    return {
      confidence,
      total: matches.length,
      outcomes: Object.fromEntries(outcomes.map((outcome) => [
        outcome,
        matches.filter(({ review }) => review.outcome === outcome).length
      ])),
      reviewIds: matches.map(({ review }) => review.id)
    };
  });
}

function smokeRepeatedLessons(records) {
  const grouped = new Map();
  for (const { review } of records) {
    const lesson = review.reviewLearning.snapshot.processLesson;
    grouped.set(lesson, [...(grouped.get(lesson) ?? []), review.id]);
  }
  return [...grouped.entries()]
    .filter(([, reviewIds]) => reviewIds.length >= 2)
    .map(([processLesson, reviewIds]) => ({ processLesson, count: reviewIds.length, reviewIds }))
    .sort((left, right) => right.count - left.count || left.processLesson.localeCompare(right.processLesson));
}

function smokeQuantSampleLimitations(records) {
  const grouped = new Map();
  for (const { check } of records) {
    const quant = check.conditionalDecision.preview?.data?.valuationQuant.data?.quant;
    const boundary = quant?.evidence.sampleBoundary;
    const diagnostic = quant?.diagnostics.sampleSize;
    const values = {
      sourceClassification: boundary?.sourceClassification ?? "unavailable",
      finalTestPolicy: boundary?.finalTestPolicy ?? "unavailable",
      boundaryLimitation: boundary?.limitation ?? "Frozen quant sample boundary was not captured and is not reconstructed.",
      diagnosticStatus: diagnostic?.status ?? "not_captured",
      diagnosticLimitation: diagnostic?.limitation ?? "Frozen quant sample-size diagnostic was not captured and is not reconstructed."
    };
    const key = JSON.stringify(values);
    const prior = grouped.get(key);
    if (!prior) grouped.set(key, { ...values, decisionCheckIds: [check.id] });
    else if (!prior.decisionCheckIds.includes(check.id)) prior.decisionCheckIds.push(check.id);
  }
  return [...grouped.values()];
}

async function replayDecisionCheck() {
  if (!lastDecisionCheckRequest || !lastDecisionCheck) {
    throw new Error("decision-check replay is missing the exact initial conditional request");
  }
  const response = await fetchJson(`http://127.0.0.1:${port}/api/mobile/research/profiles/HK/09926/decision-checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lastDecisionCheckRequest)
  });
  if (response.data.audit.idempotencyKey !== idempotencyKey) {
    throw new Error("idempotent replay did not preserve the same decision-check key");
  }
}

async function replayDecisionReview() {
  if (!lastDecisionReviewRequest) {
    throw new Error("decision-review replay is missing the exact initial request");
  }
  const response = await fetchJson(`http://127.0.0.1:${port}/api/mobile/research/profiles/HK/09926/decision-checks/${uiDecisionCheckId}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lastDecisionReviewRequest)
  });
  if (response.data.audit.idempotencyKey !== reviewIdempotencyKey) {
    throw new Error("idempotent replay did not preserve the same decision-review key");
  }
}

function assertDecisionCheckRequest(parsed) {
  const allowedHumanCheckResults = new Set(["ready_to_consider", "blocked", "needs_more_evidence"]);
  if (!allowedHumanCheckResults.has(parsed.humanCheckResult)) {
    throw new Error(`decision-check humanCheckResult is outside the backend contract: ${parsed.humanCheckResult}`);
  }
  const expected = isExecutingUITest(f1dUITest) ? {
    decisionContextSchemaVersion: symbolizedContext("HK.09926").schemaVersion,
    contextId: symbolizedContext("HK.09926").contextId,
    contextHash: symbolizedContext("HK.09926").contextHash,
    actionIntent: "wait_for_evidence",
    humanCheckResult: "needs_more_evidence"
  } : {
    decisionContextSchemaVersion: fixtures.candidateDecisionIntake.decisionContext.schemaVersion,
    contextId: fixtures.candidateDecisionIntake.decisionContext.contextId,
    contextHash: fixtures.candidateDecisionIntake.decisionContext.contextHash,
    actionIntent: "watch",
    humanCheckResult: "needs_more_evidence",
    userFinalDecision: "继续观察，不自动生成交易。"
  };
  for (const [key, value] of Object.entries(expected)) {
    if (parsed[key] !== value) {
      throw new Error(`decision-check ${key} mismatch: expected ${value}, got ${parsed[key]}`);
    }
  }
  if (!parsed.idempotencyKey) {
    throw new Error("decision-check idempotencyKey is required");
  }
  for (const forbidden of ["actorType", "actorId", "correlationId"]) {
    if (Object.hasOwn(parsed, forbidden)) {
      throw new Error(`decision-check request leaked client-controlled ${forbidden}`);
    }
  }
  if (isExecutingUITest(f1dUITest)) {
    const expectedBinding = s1adFixture.inbox.final.items[0].reviewEvent.reportBinding;
    const expectedFormalDecision = {
      reason: "正式决定理由：继续等待当前利润率证据。",
      horizon: "Separated horizons.",
      priceConditions: "Wait for current margin evidence.",
      positionRange: "0%; research-only until missing evidence is resolved.",
      mainRisks: "UNKNOWN margin\nUNKNOWN timing",
      invalidationConditions: "Revenue source changes.\nContext expires.",
      reviewOn: currentHongKongDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
      positionBasis: "research_only",
      personalRisk: {
        limits: {
          maxCandidateWeight: null,
          maxLargestPositionWeight: null,
          maxPortfolioHhi: null,
          maxUnrealizedLossHkd: null
        },
        overrideReason: null,
        secondConfirmed: false
      }
    };
    if (parsed.userFinalDecision !== expectedFormalDecision.reason
      || canonicalJson(parsed.decisionSnapshotBinding) !== canonicalJson(expectedF1DDecisionSnapshotBinding())
      || parsed.conditionalDecision != null
      || canonicalJson(parsed.researchReportBinding) !== canonicalJson(expectedBinding)
      || canonicalJson(parsed.formalDecision) !== canonicalJson(expectedFormalDecision)) {
      throw new Error(
        `F1D decision-check did not preserve the exact report-bound Owner decision: actual=${canonicalJson({ userFinalDecision: parsed.userFinalDecision, decisionSnapshotBinding: parsed.decisionSnapshotBinding, conditionalDecision: parsed.conditionalDecision, researchReportBinding: parsed.researchReportBinding, formalDecision: parsed.formalDecision })} expected=${canonicalJson({ userFinalDecision: expectedFormalDecision.reason, decisionSnapshotBinding: expectedF1DDecisionSnapshotBinding(), conditionalDecision: null, researchReportBinding: expectedBinding, formalDecision: expectedFormalDecision })}`
      );
    }
    return;
  }
  const conditional = parsed.conditionalDecision;
  if (!conditional || conditional.preview.previewId !== fixtures.annualConditionalDecision.previewId
    || conditional.preview.requestedSymbol !== "HK.09926"
    || conditional.judgment.workflowState !== "continue_research"
    || conditional.judgment.portfolioObservationConditions?.length !== 1) {
    throw new Error("decision-check request did not preserve the exact frozen conditional decision and human judgment");
  }
  const observation = conditional.judgment.portfolioObservationConditions[0];
  if (observation.metric !== "scenario_candidate_weight" || observation.comparison !== "at_or_above"
    || observation.threshold !== 0.9 || observation.purpose !== "human_review_trigger_only") {
    throw new Error("decision-check request changed the user-defined portfolio human-review threshold");
  }
  const expectedBinding = expectedDecisionSnapshotBinding();
  if (canonicalJson(parsed.decisionSnapshotBinding) !== canonicalJson(expectedBinding)) {
    throw new Error(`decision-check snapshot binding mismatch: ${canonicalJson(parsed.decisionSnapshotBinding)}`);
  }
}

function expectedDecisionSnapshotBinding() {
  const preview = fixtures.annualConditionalDecision;
  const lab = preview.data.portfolioLab.data;
  const risk = lab.scenarios[preview.data.selectedPortfolioScenarioIndex].riskImpact;
  return {
    schemaVersion: "2026-07-16.decision-snapshot.v1",
    portfolioContext: {
      state: "current",
      contextId: lab.portfolio.contextId,
      portfolioSnapshotId: lab.portfolio.portfolioSnapshotId,
      accountScopeId: lab.portfolio.accountScopeId
    },
    riskImpact: {
      availability: "captured",
      impactId: risk.impactId,
      calculationVersion: risk.calculationVersion,
      contextId: risk.contextId,
      portfolioSnapshotId: risk.portfolioSnapshotId,
      candidateSymbol: risk.candidateSymbol,
      hypotheticalAmount: risk.hypotheticalAmount
    }
  };
}

function expectedF1DDecisionSnapshotBinding() {
  return {
    schemaVersion: "2026-07-16.decision-snapshot.v1",
    portfolioContext: {
      state: "current",
      contextId: fixtures.portfolioContext.contextId,
      portfolioSnapshotId: fixtures.portfolioContext.portfolioSnapshotId,
      accountScopeId: fixtures.portfolioContext.accountScopeId
    },
    riskImpact: {
      availability: "not_captured",
      impactId: null,
      calculationVersion: null,
      contextId: null,
      portfolioSnapshotId: null,
      candidateSymbol: null,
      hypotheticalAmount: null
    }
  };
}

function assertReviewRequest(parsed) {
  if (isExecutingUITest(f1dUITest)) {
    const expectedBinding = s1adFixture.inbox.final.items[0].reviewEvent.reportBinding;
    if (parsed.outcome !== "insufficient_evidence"
      || parsed.outcomeEvidence !== "人工复核：当前证据仍不足。"
      || parsed.reviewNote !== "人工明确记录，不生成交易。"
      || canonicalJson(parsed.portfolioReviewBinding) !== canonicalJson(expectedPostDecisionPortfolioReviewBinding())
      || parsed.reviewLearning != null
      || canonicalJson(parsed.dailyTrackingBinding) !== canonicalJson(expectedBinding)
      || !parsed.idempotencyKey) {
      throw new Error(
        `F1E review request did not preserve the exact daily-tracking report binding: actual=${canonicalJson(parsed)} expectedBinding=${canonicalJson(expectedBinding)}`
      );
    }
    for (const forbidden of ["actorType", "actorId", "correlationId"]) {
      if (Object.hasOwn(parsed, forbidden)) {
        throw new Error(`F1E review request leaked client-controlled ${forbidden}`);
      }
    }
    return;
  }
  if (parsed.outcome !== "insufficient_evidence") {
    throw new Error(`decision-review outcome mismatch: ${parsed.outcome}`);
  }
  if (parsed.outcomeEvidence !== "复盘证据仍不足，保持观察。") {
    throw new Error("decision-review evidence mismatch");
  }
  if (parsed.reviewNote !== "仅记录复盘，不生成交易。") {
    throw new Error("decision-review note mismatch");
  }
  if (!parsed.idempotencyKey) {
    throw new Error("decision-review idempotencyKey is required");
  }
  const expectedBinding = expectedPostDecisionPortfolioReviewBinding();
  if (canonicalJson(parsed.portfolioReviewBinding) !== canonicalJson(expectedBinding)) {
    throw new Error(`decision-review portfolio binding mismatch: ${canonicalJson(parsed.portfolioReviewBinding)}`);
  }
  const expectedLearning = {
    schemaVersion: "2026-07-17.annual-review-learning.v1",
    decisionCheckId: uiDecisionCheckId,
    decisionSnapshotId: lastDecisionCheck?.decisionSnapshot?.snapshot?.snapshotId,
    conditionalPreviewId: lastDecisionCheck?.conditionalDecision?.preview?.previewId,
    judgmentCorrection: "保留原判断，但将证据不足明确改为待核验条件。",
    processLesson: "先核对反方证据与事实时点，再解释结果。",
    nextResearchQuestion: "哪个披露事实最能区分采用趋势与短期渠道波动？"
  };
  if (canonicalJson(parsed.reviewLearning) !== canonicalJson(expectedLearning)) {
    throw new Error(`decision-review learning mismatch: ${canonicalJson(parsed.reviewLearning)}`);
  }
  for (const forbidden of ["actorType", "actorId", "correlationId"]) {
    if (Object.hasOwn(parsed, forbidden)) {
      throw new Error(`decision-review request leaked client-controlled ${forbidden}`);
    }
  }
}

function decisionReviewEnvelope(parsed) {
  const symbol = lastDecisionCheck?.symbol ?? "HK.09926";
  const [market, code] = symbol.split(".");
  const reviewedAt = new Date(Date.parse(lastDecisionCheck?.checkedAt ?? "2026-07-29T00:30:00.000Z") + 60_000).toISOString();
  return {
    schemaVersion: "2026-06-18.research-write.v1",
    status: "succeeded",
    asOf: reviewedAt,
    source: {
      actorType: "system",
      actorId: "candidate-write-token-principal",
      correlationId: null
    },
    data: {
      id: "9101",
      decisionCheckId: uiDecisionCheckId,
      market,
      code,
      symbol,
      outcome: parsed.outcome,
      outcomeEvidence: parsed.outcomeEvidence,
      reviewNote: parsed.reviewNote,
      reviewedAt,
      createdAt: reviewedAt,
      portfolioReview: parsed.portfolioReviewBinding
        ? postDecisionPortfolioReviewState()
        : {
            availability: "portfolio_review_not_captured",
            snapshot: null,
            limitation: "This historical post-decision portfolio review was not captured and is not reconstructed from current or later portfolio, quote, cash, fee, trade, or market facts."
          },
      reviewLearning: annualReviewLearningState(parsed.reviewLearning),
      audit: {
        actorType: "system",
        actorId: "candidate-write-token-principal",
        idempotencyKey: parsed.idempotencyKey,
        correlationId: null
      },
      safety: {
        createsOrder: false,
        createsTrade: false,
        mutatesCash: false,
        writesFee: false,
        mutatesPosition: false,
        callsBroker: false
      }
    },
    message: "Post-decision review recorded without creating an order, trade, cash movement, fee, position mutation, or broker call."
  };
}

function annualReviewLearningState(request) {
  if (!request || !lastDecisionCheck?.conditionalDecision?.monitor) {
    return {
      availability: "review_learning_not_captured",
      snapshot: null,
      limitation: "This historical review-learning snapshot was not captured and is not reconstructed from current facts."
    };
  }
  const monitor = structuredClone(lastDecisionCheck.conditionalDecision.monitor);
  monitor.evaluatedAt = "2026-07-17T03:05:00.000Z";
  return {
    availability: "preserved",
    snapshot: {
      ...structuredClone(request),
      reviewedFactsAt: monitor.evaluatedAt,
      monitor
    },
    limitation: "This append-only learning record preserves the user correction, process lesson, and authoritative factual monitor at review time; it does not score, recommend, rank, transition, or execute an investment decision."
  };
}

function expectedPostDecisionPortfolioReviewBinding() {
  const snapshot = lastDecisionCheck?.decisionSnapshot?.snapshot;
  const decisionTime = snapshot?.portfolioContext?.envelope;
  if (!snapshot || !decisionTime) {
    throw new Error("decision-review binding requires the preserved decision snapshot and portfolio facts");
  }
  const comparison = postDecisionPortfolioComparison(decisionTime, fixtures.portfolioContext, snapshot.candidateSymbol);
  return {
    schemaVersion: "2026-07-16.post-decision-portfolio-review.v1",
    decisionCheckId: uiDecisionCheckId,
    decisionSnapshotId: snapshot.snapshotId,
    candidateSymbol: snapshot.candidateSymbol,
    decisionTimePortfolio: postDecisionPortfolioIdentity(decisionTime),
    reviewTimePortfolio: postDecisionPortfolioIdentity(fixtures.portfolioContext),
    comparison: {
      calculationVersion: comparison.calculationVersion,
      comparisonId: comparison.comparisonId
    }
  };
}

function postDecisionPortfolioReviewState() {
  const decisionSnapshot = lastDecisionCheck?.decisionSnapshot?.snapshot;
  const decisionTime = decisionSnapshot?.portfolioContext?.envelope;
  if (!decisionSnapshot || !decisionTime) {
    throw new Error("portfolio-review response requires preserved decision-time facts");
  }
  const reviewTime = structuredClone(fixtures.portfolioContext);
  const comparison = postDecisionPortfolioComparison(decisionTime, reviewTime, decisionSnapshot.candidateSymbol);
  const snapshotInput = {
    schemaVersion: "2026-07-16.post-decision-portfolio-review.v1",
    capturedAt: "2026-07-17T03:05:00.000Z",
    decisionCheckId: uiDecisionCheckId,
    decisionSnapshotId: decisionSnapshot.snapshotId,
    candidateSymbol: decisionSnapshot.candidateSymbol,
    reviewTimePortfolio: {
      state: postDecisionPortfolioState(reviewTime.status),
      envelope: reviewTime,
      limitation: "These are exact authorized read-only Pingan portfolio and Futu quote facts re-read at review time; they are not broker reconciliation, accounting, execution, or production authority."
    },
    comparison,
    safety: {
      ...postDecisionPortfolioComparisonSafety(),
      readOnlyPortfolioFacts: true,
      appendOnlyHumanReview: true,
      mutatesOriginalDecision: false
    }
  };
  const snapshot = {
    ...snapshotInput,
    snapshotId: `post-decision-portfolio-review:${sha256(canonicalJson(snapshotInput))}`
  };
  return {
    availability: "preserved",
    snapshot,
    limitation: "Decision-time facts remain immutable; review-time facts and neutral deltas are separately preserved without performance attribution, recommendations, accounting, or execution."
  };
}

function assertZeroPositionPortfolioComparisonParity() {
  const decisionTime = zeroPositionPortfolioContext(
    "decision-zero-position",
    "2026-07-15T01:39:00.000Z",
    "2026-07-15T01:40:00.000Z"
  );
  const reviewTime = zeroPositionPortfolioContext(
    "review-zero-position",
    "2026-07-15T01:59:00.000Z",
    "2026-07-15T02:00:00.000Z"
  );
  for (const context of [decisionTime, reviewTime]) {
    if (!context.contextId || !context.portfolioSnapshotId || !context.portfolioAsOf
      || context.accountScopeId !== fixtures.portfolioContext.accountScopeId
      || context.portfolioSource !== fixtures.portfolioContext.portfolioSource) {
      throw new Error("zero-position smoke fixture did not preserve its source-bound portfolio identity");
    }
  }

  const zeroToZero = postDecisionPortfolioComparison(decisionTime, reviewTime, "HK.00175");
  const comparableZero = { availability: "comparable", decisionTime: 0, reviewTime: 0, delta: 0 };
  for (const key of ["candidateQuantity", "candidateExposure", "positionCount", "totalExposure"]) {
    if (canonicalJson(zeroToZero.metrics[key]) !== canonicalJson(comparableZero)) {
      throw new Error(`zero-position comparison did not preserve comparable zero ${key}`);
    }
  }
  for (const key of ["candidateWeight", "largestPositionWeight", "topThreeWeight", "hhi"]) {
    if (zeroToZero.metrics[key].availability !== "unavailable") {
      throw new Error(`zero-position comparison exposed unavailable ${key}`);
    }
  }
  if (zeroToZero.decisionTime.state !== "zero_position" || zeroToZero.reviewTime.state !== "zero_position"
    || zeroToZero.decisionTime.contextId !== decisionTime.contextId
    || zeroToZero.reviewTime.contextId !== reviewTime.contextId) {
    throw new Error("zero-position comparison did not preserve decision and review fact identity");
  }
  const zeroGapText = zeroToZero.gaps.join(" ");
  if (!zeroGapText.includes("weight and concentration deltas are unavailable")
    || zeroGapText.includes("complete portfolio valuation, weight")) {
    throw new Error(`zero-position comparison misstated unavailable dimensions: ${zeroGapText}`);
  }

  const available = fixtures.portfolioContext;
  const availableCandidate = available.positions.find((position) => position.symbol === "HK.00175");
  if (!availableCandidate) throw new Error("available portfolio fixture is missing HK.00175");
  for (const [label, comparison, direction] of [
    ["zero-to-available", postDecisionPortfolioComparison(decisionTime, available, "HK.00175"), 1],
    ["available-to-zero", postDecisionPortfolioComparison(available, reviewTime, "HK.00175"), -1]
  ]) {
    const expected = {
      candidateQuantity: availableCandidate.quantity,
      candidateExposure: availableCandidate.marketValue,
      positionCount: available.summary.positionCount,
      totalExposure: available.summary.marketValue.amount
    };
    for (const [key, magnitude] of Object.entries(expected)) {
      const metric = comparison.metrics[key];
      if (metric.availability !== "comparable" || metric.delta !== direction * magnitude) {
        throw new Error(`${label} comparison did not preserve comparable ${key}`);
      }
    }
    for (const key of ["candidateWeight", "largestPositionWeight", "topThreeWeight", "hhi"]) {
      if (comparison.metrics[key].availability !== "unavailable") {
        throw new Error(`${label} comparison exposed unavailable ${key}`);
      }
    }
  }
}

function postDecisionPortfolioComparison(decisionTime, reviewTime, candidateSymbol) {
  const quantityComparable = postDecisionPortfolioDisplayable(decisionTime)
    && postDecisionPortfolioDisplayable(reviewTime);
  const currentValuationComparable = decisionTime.status === "available" && reviewTime.status === "available";
  const currentTotalExposureComparable = postDecisionPortfolioCurrentTotalExposure(decisionTime)
    && postDecisionPortfolioCurrentTotalExposure(reviewTime);
  const decisionCandidate = decisionTime.positions.find((position) => position.symbol === candidateSymbol);
  const reviewCandidate = reviewTime.positions.find((position) => position.symbol === candidateSymbol);
  const metrics = {
    candidateQuantity: quantityComparable
      ? postDecisionPortfolioMetric(decisionCandidate?.quantity ?? 0, reviewCandidate?.quantity ?? 0, 8)
      : postDecisionPortfolioUnavailableMetric(),
    candidateExposure: postDecisionPortfolioMetric(
      postDecisionCandidateExposure(decisionTime, candidateSymbol),
      postDecisionCandidateExposure(reviewTime, candidateSymbol),
      2
    ),
    candidateWeight: currentValuationComparable
      ? postDecisionPortfolioMetric(decisionCandidate?.marketWeight ?? 0, reviewCandidate?.marketWeight ?? 0, 8)
      : postDecisionPortfolioUnavailableMetric(),
    positionCount: quantityComparable
      ? postDecisionPortfolioMetric(decisionTime.summary.positionCount, reviewTime.summary.positionCount, 0)
      : postDecisionPortfolioUnavailableMetric(),
    totalExposure: currentTotalExposureComparable
      ? postDecisionPortfolioMetric(decisionTime.summary.marketValue.amount, reviewTime.summary.marketValue.amount, 2)
      : postDecisionPortfolioUnavailableMetric(),
    missingQuoteCount: quantityComparable
      ? postDecisionPortfolioMetric(decisionTime.summary.marketValue.missingPositionCount, reviewTime.summary.marketValue.missingPositionCount, 0)
      : postDecisionPortfolioUnavailableMetric(),
    nonCurrentQuoteCount: quantityComparable
      ? postDecisionPortfolioMetric(postDecisionNonCurrentQuoteCount(decisionTime), postDecisionNonCurrentQuoteCount(reviewTime), 0)
      : postDecisionPortfolioUnavailableMetric(),
    largestPositionWeight: currentValuationComparable
      ? postDecisionPortfolioMetric(decisionTime.summary.concentration.largestPositionWeight, reviewTime.summary.concentration.largestPositionWeight, 8)
      : postDecisionPortfolioUnavailableMetric(),
    topThreeWeight: currentValuationComparable
      ? postDecisionPortfolioMetric(decisionTime.summary.concentration.topThreeWeight, reviewTime.summary.concentration.topThreeWeight, 8)
      : postDecisionPortfolioUnavailableMetric(),
    hhi: currentValuationComparable
      ? postDecisionPortfolioMetric(decisionTime.summary.concentration.hhi, reviewTime.summary.concentration.hhi, 8)
      : postDecisionPortfolioUnavailableMetric()
  };
  const comparableCount = Object.values(metrics).filter((metric) => metric.availability === "comparable").length;
  const input = {
    calculationVersion: "post-decision-portfolio-comparison.v1",
    status: comparableCount === Object.keys(metrics).length ? "comparable" : comparableCount > 0 ? "partial" : "unavailable",
    candidateSymbol,
    decisionTime: postDecisionPortfolioFactReference(decisionTime),
    reviewTime: postDecisionPortfolioFactReference(reviewTime),
    metrics,
    cash: {
      status: "unknown",
      decisionTime: null,
      reviewTime: null,
      delta: null,
      reason: "not_provided_by_authoritative_snapshot"
    },
    gaps: postDecisionPortfolioComparisonGaps(decisionTime, reviewTime, candidateSymbol, currentValuationComparable),
    safety: postDecisionPortfolioComparisonSafety()
  };
  const identity = structuredClone(input);
  delete identity.decisionTime.assembledAt;
  delete identity.reviewTime.assembledAt;
  return {
    ...input,
    comparisonId: `post-decision-portfolio-comparison:${sha256(canonicalJson(identity))}`
  };
}

function postDecisionPortfolioMetric(decisionTime, reviewTime, precision) {
  if (!Number.isFinite(decisionTime) || !Number.isFinite(reviewTime)) {
    return postDecisionPortfolioUnavailableMetric();
  }
  const factor = 10 ** precision;
  const delta = Math.round((reviewTime - decisionTime + Number.EPSILON) * factor) / factor;
  return { availability: "comparable", decisionTime, reviewTime, delta };
}

function postDecisionPortfolioUnavailableMetric() {
  return { availability: "unavailable", decisionTime: null, reviewTime: null, delta: null };
}

function postDecisionCandidateExposure(context, candidateSymbol) {
  if (context.status !== "available" && context.status !== "partial" && context.status !== "zero_position") return null;
  const candidate = context.positions.find((position) => position.symbol === candidateSymbol);
  if (!candidate) return 0;
  return candidate.quote.status === "current" && Number.isFinite(candidate.marketValue)
    ? candidate.marketValue
    : null;
}

function postDecisionPortfolioIdentity(context) {
  return {
    state: postDecisionPortfolioState(context.status),
    contextId: context.contextId,
    portfolioSnapshotId: context.portfolioSnapshotId,
    accountScopeId: context.accountScopeId
  };
}

function postDecisionPortfolioFactReference(context) {
  return {
    ...postDecisionPortfolioIdentity(context),
    portfolioAsOf: context.portfolioAsOf,
    assembledAt: context.assembledAt
  };
}

function postDecisionPortfolioState(status) {
  return status === "available" ? "current" : status;
}

function postDecisionPortfolioDisplayable(context) {
  return ["available", "stale", "partial", "zero_position"].includes(context.status);
}

function postDecisionPortfolioCurrentTotalExposure(context) {
  return context.status === "available" || context.status === "zero_position";
}

function postDecisionPortfolioUnavailableValuationDimensions(context) {
  return context.status === "zero_position" ? "weight and concentration" : "complete portfolio valuation, weight, and concentration";
}

function postDecisionNonCurrentQuoteCount(context) {
  return context.positions.filter((position) => position.quote.status !== "current").length;
}

function postDecisionPortfolioComparisonGaps(decisionTime, reviewTime, candidateSymbol, currentValuationComparable) {
  const gaps = ["Cash is unknown at decision and review time because the authoritative snapshot does not provide cash facts."];
  if (decisionTime.status !== "available") gaps.push(`Decision-time portfolio state is ${postDecisionPortfolioState(decisionTime.status)}; ${postDecisionPortfolioUnavailableValuationDimensions(decisionTime)} deltas are unavailable.`);
  if (reviewTime.status !== "available") gaps.push(`Review-time portfolio state is ${postDecisionPortfolioState(reviewTime.status)}; ${postDecisionPortfolioUnavailableValuationDimensions(reviewTime)} deltas are unavailable.`);
  if (decisionTime.summary.marketValue.missingPositionCount > 0) gaps.push(`Decision-time facts have ${decisionTime.summary.marketValue.missingPositionCount} position quote gap(s).`);
  if (reviewTime.summary.marketValue.missingPositionCount > 0) gaps.push(`Review-time facts have ${reviewTime.summary.marketValue.missingPositionCount} position quote gap(s).`);
  const decisionNonCurrent = postDecisionNonCurrentQuoteCount(decisionTime);
  const reviewNonCurrent = postDecisionNonCurrentQuoteCount(reviewTime);
  if (decisionNonCurrent > 0) gaps.push(`Decision-time facts have ${decisionNonCurrent} non-current Futu quote(s).`);
  if (reviewNonCurrent > 0) gaps.push(`Review-time facts have ${reviewNonCurrent} non-current Futu quote(s).`);
  const decisionSymbols = new Set(decisionTime.positions.map((position) => position.symbol));
  const reviewSymbols = new Set(reviewTime.positions.map((position) => position.symbol));
  const absentAtReview = [...decisionSymbols].filter((symbol) => !reviewSymbols.has(symbol)).sort();
  const absentAtDecision = [...reviewSymbols].filter((symbol) => !decisionSymbols.has(symbol)).sort();
  if (absentAtReview.length > 0) gaps.push(`Position symbol(s) present only at decision time: ${absentAtReview.join(", ")}.`);
  if (absentAtDecision.length > 0) gaps.push(`Position symbol(s) present only at review time: ${absentAtDecision.join(", ")}.`);
  if (postDecisionPortfolioDisplayable(decisionTime) && !decisionTime.positions.some((position) => position.symbol === candidateSymbol)) gaps.push("The candidate is absent from the complete decision-time position set and is represented as zero quantity only for neutral comparison.");
  if (postDecisionPortfolioDisplayable(reviewTime) && !reviewTime.positions.some((position) => position.symbol === candidateSymbol)) gaps.push("The candidate is absent from the complete review-time position set and is represented as zero quantity only for neutral comparison.");
  if (decisionTime.portfolioSnapshotId !== null && decisionTime.portfolioSnapshotId === reviewTime.portfolioSnapshotId) gaps.push("The review-time Pingan portfolio snapshot identity is unchanged from decision time; zero deltas do not prove decision impact or quality.");
  if (!currentValuationComparable && gaps.length === 1) gaps.push("Current complete valuation facts are unavailable for one or both fact sets.");
  return gaps;
}

function postDecisionPortfolioComparisonSafety() {
  return {
    advisoryOnly: true,
    neutralFactsOnly: true,
    infersCausality: false,
    performanceAttribution: false,
    infersDecisionQuality: false,
    recommendsDirection: false,
    recommendsAmount: false,
    recommendsWeight: false,
    recommendsTiming: false,
    promisesReturn: false,
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    productionWrite: false
  };
}

function decisionCheckEnvelope(parsed) {
  const conditional = parsed.conditionalDecision;
  const symbol = conditional?.preview?.requestedSymbol ?? "HK.09926";
  const [market, code] = symbol.split(".");
  const ordinary = conditional == null;
  const reportBound = parsed.researchReportBinding != null && parsed.formalDecision != null;
  const report = reportBound ? s1adFixture.report : null;
  const advice = report?.payload.adviceLayer;
  const ownerDecision = reportBound ? {
    ...parsed.formalDecision,
    divergenceReason: parsed.formalDecision.divergenceReason ?? null
  } : null;
  const checkedAt = reportBound
    ? new Date(Date.parse(parsed.researchReportBinding.decidedAt) + 60_000).toISOString()
    : ordinary ? "2026-07-29T00:30:00.000Z" : conditional.preview.generatedAt;
  const systemRecommendation = reportBound && advice ? {
    source: "deep_research_report_advice_layer",
    direction: advice.direction,
    conclusion: advice.conclusion,
    confidence: advice.confidence,
    horizon: advice.horizonStatement,
    priceConditions: advice.priceConditions,
    priceRange: advice.priceRange,
    researchPositionRange: advice.researchPositionRange,
    assumptions: advice.assumptions,
    scenarios: advice.scenarios,
    risks: [...new Set([...advice.longTerm.risks, ...advice.mediumShortTerm.risks])],
    invalidationConditions: [...new Set([
      ...advice.longTerm.invalidationConditions,
      ...advice.mediumShortTerm.invalidationConditions
    ])],
    nextQuestion: advice.nextQuestion,
    versionChange: advice.versionChange,
    reportId: report.id,
    reportVersion: report.version,
    reportFingerprint: report.reportFingerprint,
    nonExecuting: true
  } : null;
  return {
    schemaVersion: "2026-06-18.research-write.v1",
    status: "succeeded",
    asOf: checkedAt,
    source: {
      actorType: "system",
      actorId: "candidate-write-token-principal",
      correlationId: null
    },
    data: {
      id: uiDecisionCheckId,
      market,
      code,
      symbol,
      decisionContextSchemaVersion: parsed.decisionContextSchemaVersion,
      decisionCheckSchemaVersion: "2026-06-23.pre-trade-check.v1",
      contextId: parsed.contextId,
      contextHash: parsed.contextHash,
      actionIntent: parsed.actionIntent,
      humanCheckResult: parsed.humanCheckResult,
      userFinalDecision: parsed.userFinalDecision,
      checkedAt,
      decisionSnapshot: reportBound
        ? reportDecisionSnapshotState(symbol, parsed.decisionSnapshotBinding, checkedAt)
        : ordinary
        ? ordinaryDecisionSnapshotState(symbol)
        : decisionSnapshotState(parsed.decisionSnapshotBinding, fixtures.annualConditionalDecision),
      conditionalDecision: ordinary ? null : conditionalDecisionState(conditional),
      researchReportDecision: reportBound ? {
        availability: "preserved",
        binding: parsed.researchReportBinding,
        limitation: "This formal human decision preserves the exact confirmed report and evidence-pack identities; it does not create an order, trade, or automatic signal."
      } : {
        availability: "not_captured",
        binding: null,
        limitation: "This decision did not capture a research-report binding and is not reconstructed."
      },
      formalDecision: reportBound ? {
        availability: "preserved",
        systemRecommendation,
        ownerDecision,
        differsFromSystem: systemRecommendation.direction !== parsed.actionIntent,
        personalRiskAssessment: {
          status: "not_requested",
          warnings: [],
          unavailableMetrics: [],
          requiresOverride: false,
          limitation: "No personal risk limit was supplied for this formal decision."
        },
        limitation: "The system recommendation and Owner decision are preserved separately; neither executes a trade or mutates official portfolio facts."
      } : {
        availability: "not_captured",
        systemRecommendation: null,
        ownerDecision: null,
        differsFromSystem: null,
        limitation: "This historical decision did not capture separate system-recommendation and Owner-decision snapshots; they are not reconstructed."
      },
      audit: {
        actorType: "system",
        actorId: "candidate-write-token-principal",
        idempotencyKey: parsed.idempotencyKey,
        correlationId: null
      },
      safety: {
        createsOrder: false,
        createsTrade: false,
        mutatesCash: false,
        writesFee: false,
        mutatesPosition: false,
        callsBroker: false
      }
    },
    message: "Audited human pre-trade check recorded without creating an order, trade, cash movement, fee, or position mutation."
  };
}

function ordinaryDecisionSnapshotState(symbol) {
  const decisionContext = symbolizedContext(symbol);
  const snapshot = withDecisionSnapshotId({
    schemaVersion: "2026-07-16.decision-snapshot.v1",
    capturedAt: "2026-07-29T00:30:00.000Z",
    candidateSymbol: symbol,
    decisionContext,
    portfolioContext: {
      state: "not_captured",
      envelope: null,
      limitation: "No portfolio binding was captured; an ordinary formal decision does not require a holding."
    },
    riskImpact: {
      availability: "not_captured",
      envelope: null,
      limitation: "No portfolio risk impact was captured without a portfolio binding."
    },
    safety: {
      advisoryOnly: true,
      officialPortfolioMutation: false,
      officialReviewMutation: false,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false,
      productionWrite: false
    }
  });
  return {
    availability: "preserved",
    snapshot,
    limitation: "Exact decision-time context is preserved; absent portfolio and risk facts remain explicitly not captured."
  };
}

function reportDecisionSnapshotState(symbol, binding, capturedAt) {
  const snapshot = withDecisionSnapshotId({
    schemaVersion: "2026-07-16.decision-snapshot.v1",
    capturedAt,
    candidateSymbol: symbol,
    decisionContext: symbolizedContext(symbol),
    portfolioContext: {
      state: binding.portfolioContext.state,
      envelope: structuredClone(fixtures.portfolioContext),
      limitation: "Exact authorized read-only portfolio facts visible at decision time."
    },
    riskImpact: {
      availability: "not_captured",
      envelope: null,
      limitation: "No neutral user-amount scenario was captured at decision time."
    },
    safety: {
      advisoryOnly: true,
      officialPortfolioMutation: false,
      officialReviewMutation: false,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false,
      productionWrite: false
    }
  });
  return {
    availability: "preserved",
    snapshot,
    limitation: "Exact report-bound decision facts are preserved without mutating official facts."
  };
}

function decisionSnapshotState(binding, preview) {
  const lab = preview.data.portfolioLab.data;
  const risk = lab.scenarios[preview.data.selectedPortfolioScenarioIndex].riskImpact;
  const snapshot = withDecisionSnapshotId({
    schemaVersion: "2026-07-16.decision-snapshot.v1",
    capturedAt: preview.generatedAt,
    candidateSymbol: preview.requestedSymbol,
    decisionContext: structuredClone(fixtures.candidateDecisionIntake.decisionContext),
    portfolioContext: {
      state: binding.portfolioContext.state,
      envelope: structuredClone(lab.portfolio),
      limitation: "Exact authorized read-only portfolio facts visible at decision time."
    },
    riskImpact: binding.riskImpact.availability === "captured"
      ? {
          availability: "captured",
          envelope: structuredClone(risk),
          limitation: "Exact neutral user-amount scenario visible at decision time."
        }
      : {
          availability: "not_captured",
          envelope: null,
          limitation: "No neutral user-amount scenario was captured at decision time."
        },
    safety: {
      advisoryOnly: true,
      officialPortfolioMutation: false,
      officialReviewMutation: false,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false,
      productionWrite: false
    }
  });
  return {
    availability: "preserved",
    snapshot,
    limitation: "Exact decision-time facts are preserved without mutating official facts."
  };
}

function conditionalDecisionState(submission) {
  // Swift omits nil optionals when it encodes the request. Restore the server's
  // explicit nullable fields before returning the preserved wire contract.
  const preview = structuredClone(fixtures.annualConditionalDecision);
  const judgment = structuredClone(submission.judgment);
  const target = preview.data.decisionBrief.data.target;
  const source = preview.data.decisionBrief.data.sourceIdentity;
  const valuation = preview.data.valuationQuant.data.valuation;
  const quant = preview.data.valuationQuant.data.quant;
  const lab = preview.data.portfolioLab.data;
  const scenario = lab.scenarios[preview.data.selectedPortfolioScenarioIndex];
  return {
    availability: "preserved",
    preview,
    judgment,
    monitor: {
      evaluatedAt: preview.generatedAt,
      state: "watching",
      reasons: [],
      changes: [],
      currentFacts: {
        membershipId: target.membershipId,
        membershipVersion: target.membershipVersion,
        membershipState: target.membershipState,
        decisionContextId: source.decisionContextId,
        decisionContextHash: source.decisionContextHash,
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
      },
      invalidationReminder: "human_observation_required",
      humanReviewRequested: false,
      automaticDecision: false,
      automaticWorkflowTransition: false,
      createsOrder: false,
      createsTrade: false,
      callsBroker: false
    },
    limitation: "The exact user-confirmed conditional preview and human judgment are append-only; later facts can request human review but cannot overwrite or transition this decision."
  };
}

function assertRoutes() {
  const routeSet = new Set(requests.map((request) => `${request.method} ${request.url}`));
  for (const route of [
    "GET /api/mobile/market/quotes/HK/00175",
    "GET /api/mobile/research/candidates",
    "GET /api/mobile/research/candidate-memberships?includeArchived=true",
    "GET /api/mobile/research/candidate-memberships/1/decision-brief",
    "GET /api/mobile/research/profiles/HK/00175",
    "GET /api/mobile/research/decision-context/HK/00175",
    "GET /api/mobile/research/portfolio/pingan-current/context",
    "GET /api/mobile/research/portfolio/pingan-snapshot/HK/00175",
    "GET /api/mobile/research/portfolio/pingan-snapshot/HK/00005",
    "GET /api/mobile/research/profiles/HK/00175/decision-reviews",
    "GET /api/mobile/research/decision-context/HK/09926",
    "POST /api/mobile/research/profiles/HK/09926/decision-checks",
    `POST /api/mobile/research/profiles/HK/09926/decision-checks/${uiDecisionCheckId}/reviews`
  ]) {
    if (!routeSet.has(route)) {
      throw new Error(`missing required route ${route}`);
    }
  }
  const valuationQuantReads = requests.map(annualValuationQuantRequest).filter(Boolean);
  if (valuationQuantReads.length < 3) {
    throw new Error(`expected standard and conditional valuation quant GETs, got ${valuationQuantReads.length}`);
  }
  valuationQuantReads.forEach(assertAnnualValuationQuantRequest);
  const portfolioLabReads = requests.map(annualPortfolioLabRequest).filter(Boolean);
  if (portfolioLabReads.length < 3) {
    throw new Error(`expected standard and conditional portfolio lab GETs, got ${portfolioLabReads.length}`);
  }
  portfolioLabReads.forEach(assertAnnualPortfolioLabRequest);
  const conditionalReads = requests.map(annualConditionalDecisionRequest).filter(Boolean);
  if (conditionalReads.length < 3) {
    throw new Error(`expected frozen, stale-response, and submission conditional preview GETs, got ${conditionalReads.length}`);
  }
  conditionalReads.forEach(assertAnnualConditionalDecisionRequest);

  const portfolioReads = requests.filter((request) => request.url === "/api/mobile/research/portfolio/pingan-current/context"
    || request.url.startsWith("/api/mobile/research/portfolio/pingan-current/risk-impact?"));
  if (portfolioReads.length === 0) {
    throw new Error("current portfolio GET routes were not exercised");
  }
  for (const request of portfolioReads) {
    if (request.method !== "GET") {
      throw new Error(`current portfolio route used a non-GET method: ${request.method} ${request.url}`);
    }
    if (request.body !== "") {
      throw new Error(`current portfolio GET request carried a body: ${request.url}`);
    }
  }
  const riskReads = portfolioReads.filter((request) => request.url.startsWith("/api/mobile/research/portfolio/pingan-current/risk-impact?"));
  const countedRiskReads = [...portfolioRiskRequestCounts.values()].reduce((sum, count) => sum + count, 0);
  if (riskReads.length !== countedRiskReads || portfolioRiskRequestCounts.get("") !== 2) {
    throw new Error(`expected the default available and blocked neutral-risk GETs exactly twice, got ${JSON.stringify(Object.fromEntries(portfolioRiskRequestCounts))}`);
  }
  for (const [token, expectedCount] of [
    ["portfolio-risk-mismatch", 2],
    ["portfolio-risk-delay-amount", 2],
    ["portfolio-risk-delay-symbol", 1]
  ]) {
    if (portfolioRiskRequestCounts.get(token) !== expectedCount) {
      throw new Error(`expected ${expectedCount} risk requests for ${token}, got ${portfolioRiskRequestCounts.get(token) ?? 0}`);
    }
  }
  for (const request of riskReads) {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname !== "/api/mobile/research/portfolio/pingan-current/risk-impact"
      || url.searchParams.get("symbol") !== "HK.00175"
      || !["10000", "10000.0", "20000", "20000.0"].includes(url.searchParams.get("hypotheticalAmount"))) {
      throw new Error(`risk-impact GET query was not exact: ${request.url}`);
    }
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`candidate UI smoke left the exact method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method === "GET" && request.body !== "") {
      throw new Error(`GET request carried a body: ${request.url}`);
    }
    if (request.url.includes(".hk")) {
      throw new Error(`request used non-canonical symbol path: ${request.method} ${request.url}`);
    }
    if (request.url === "/api/mobile/research/candidates" && request.method !== "GET") {
      throw new Error(`candidate overview used a write route: ${request.method} ${request.url}`);
    }
    if (request.url.includes("orders") || request.url.includes("trades") || request.url.includes("cash") || request.url.includes("fees") || request.url.includes("positions") || request.url.includes("broker")) {
      throw new Error(`candidate UI smoke touched forbidden route: ${request.method} ${request.url}`);
    }
  }
  if (!requests.some((request) => request.url === "/api/mobile/research/candidates"
    && request.headers["x-internal-token"] === "normal-debug-read-token")) {
    throw new Error("normal non-UI-testing launch did not send its ephemeral Debug read credential");
  }
  const writes = requests.filter((request) => request.method === "POST" && request.url.endsWith("/decision-checks"));
  if (writes.length !== 3 || !decisionCheckCreated) {
    throw new Error(`expected F1D create plus eight-question create and replay, got ${writes.length}`);
  }
  const reviewWrites = requests.filter((request) => request.method === "POST" && request.url.endsWith("/reviews"));
  if (reviewWrites.length !== 3 || !decisionReviewCreated) {
    throw new Error(`expected F1E create plus eight-question create and replay, got ${reviewWrites.length}`);
  }
}

function assertSmokeRequestSafety(label) {
  if (requests.length === 0) throw new Error(`${label} smoke produced an empty request ledger`);
  const unexpected = [...new Set(
    requests
      .filter((request) => !isAllowedSmokeRequest(request))
      .map((request) => `${request.method} ${request.url}`)
  )];
  if (unexpected.length > 0) {
    throw new Error(`${label} smoke left the exact method/path allowlist: ${unexpected.join(", ")}`);
  }
  for (const request of requests) {
    if (request.method === "GET" && request.body !== "") {
      throw new Error(`${label} smoke sent a GET body: ${request.url}`);
    }
    if (request.url.includes(".hk")) {
      throw new Error(`${label} smoke used a non-canonical symbol path: ${request.method} ${request.url}`);
    }
  }
  const safety = deriveSafetyEvidence(requestLedgerFromRequests(requests));
  for (const field of [
    "tradingSideEffectRequests",
    "brokerCalls",
    "cashFeePositionMutations",
    "officialPortfolioMutations",
    "productionWrites"
  ]) {
    if (safety[field] !== 0) throw new Error(`${label} smoke recorded ${safety[field]} ${field}`);
  }
  return safety;
}

function assertS1abFreezeRequest(value) {
  const expectedKeys = [
    "membershipVersion",
    "expectedScenarioId",
    "expectedScenarioRevision",
    "expectedValuationMethods",
    "expectedTechnicalSnapshotSha",
    "expectedTechnicalResultHash",
    "expectedWeinstein",
    "expectedQuantPortfolio",
    "idempotencyKey"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expectedKeys].sort())
      || value.membershipVersion !== 3
      || value.expectedScenarioId !== s1abFixture.pack.frozenResearchContext.valuationScenario.id
      || value.expectedScenarioRevision !== s1abFixture.pack.frozenResearchContext.valuationScenario.revision
      || sha256(canonicalJson(value.expectedValuationMethods)) !== sha256(canonicalJson(
        s1abFixture.pack.frozenResearchContext.valuationMethods
          .map((scenario) => ({
            scenarioId: scenario.id,
            scenarioRevision: scenario.revision,
            methodId: scenario.calculation.method.id
          }))
          .sort((left, right) => left.methodId.localeCompare(right.methodId))
      ))
      || value.expectedTechnicalSnapshotSha !== s1abFixture.technical.dailyBars.snapshot.snapshotSha
      || value.expectedTechnicalResultHash !== s1abFixture.technical.technical.resultHash
      || sha256(canonicalJson(value.expectedWeinstein)) !== sha256(canonicalJson(s1abFixture.pack.frozenResearchContext.weinstein))
      || sha256(canonicalJson(value.expectedQuantPortfolio)) !== sha256(canonicalJson({}))
      || typeof value.idempotencyKey !== "string"
      || value.idempotencyKey.length < 8) {
    throw new Error(`S1AB freeze request did not preserve the exact current binding: ${JSON.stringify(value)}`);
  }
}

function assertFocusedS1ABTodayFreezeRoutes() {
  if (!s1abFrozen || s1abFreezePostCount !== 1) {
    throw new Error(`S1AB expected exactly one explicit evidence-pack POST, got frozen=${s1abFrozen} count=${s1abFreezePostCount}`);
  }
  const writes = requests.filter((request) => (
    request.method === "POST"
      && request.url === "/api/mobile/research/candidate-memberships/1/evidence-packs"
  ));
  if (writes.length !== 1 || requestToken(writes[0]) !== "s1ab-write-token") {
    throw new Error("S1AB freeze write did not use exactly one explicit write authorization");
  }
  assertS1abFreezeRequest(JSON.parse(writes[0].body || "{}"));
  if (s1abTodayReadStates[0] !== "needs_evidence_pack"
      || !s1abTodayReadStates.includes("needs_research")) {
    throw new Error(`S1AB Today did not transition through needs_evidence_pack to needs_research: ${JSON.stringify(s1abTodayReadStates)}`);
  }
  if (s1abWorkspaceReadStates[0] !== "pack_required"
      || !s1abWorkspaceReadStates.includes("research_required")) {
    throw new Error(`S1AB Research fresh reads did not transition through pack_required to research_required: ${JSON.stringify(s1abWorkspaceReadStates)}`);
  }
  const forbiddenWrites = requests.filter((request) => (
    request.method !== "GET"
      && !(request.method === "POST" && request.url === "/api/mobile/research/candidate-memberships/1/evidence-packs")
  ));
  if (forbiddenWrites.length > 0) {
    throw new Error(`S1AB emitted an unexpected mutation: ${forbiddenWrites.map((request) => `${request.method} ${request.url}`).join(", ")}`);
  }
  for (const request of requests) {
    if (request.method === "GET" && request.body !== "") {
      throw new Error(`S1AB GET carried a body: ${request.url}`);
    }
    if (request.url.includes("orders") || request.url.includes("trades")
        || request.url.includes("cash") || request.url.includes("fees")
        || request.url.includes("positions") || request.url.includes("broker")) {
      throw new Error(`S1AB touched a forbidden trading or portfolio route: ${request.method} ${request.url}`);
    }
  }
}

function assertS1acTaskRequest(value) {
  const validation = validateCreateDeepResearchTaskRequest(value);
  if (!validation.ok
      || value.membershipVersion !== 3
      || value.evidencePackId !== "31"
      || value.reportContractVersion !== "2026-08-05.deep-research-synthesis-report.v1"
      || typeof value.idempotencyKey !== "string"
      || value.idempotencyKey.length < 8
      || value.evidencePackBinding?.id !== "31"
      || value.evidencePackBinding?.version !== 1
      || value.evidencePackBinding?.fingerprint !== s1acFixture.pack.packFingerprint
      || value.evidencePackBinding?.membershipId !== "1"
      || value.evidencePackBinding?.membershipVersion !== 3
      || value.evidencePackBinding?.symbol !== "HK.09926"
      || value.evidencePackBinding?.technical?.snapshotSha !== s1acFixture.technical.dailyBars.snapshot.snapshotSha
      || value.evidencePackBinding?.technical?.resultHash !== s1acFixture.technical.technical.resultHash) {
    throw new Error(`S1AC task request did not preserve the selected snapshot binding: ${JSON.stringify(value)}`);
  }
}

function assertS1acTaskActionRequest(value) {
  const validation = validateDeepResearchTaskActionRequest(value);
  if (!validation.ok
      || value.membershipVersion !== 3
      || value.taskRequestFingerprint !== s1acFixture.taskEnvelope(s1acFixture.taskRequest, "ready_to_absorb").data.requestFingerprint
      || value.snapshotId !== s1acFixture.report.payload.snapshotBinding.snapshotId) {
    throw new Error(`S1AC absorb did not preserve the exact task identity: ${JSON.stringify(value)}`);
  }
}

function assertFocusedS1ACTodayReportRoutes() {
  if (s1acTaskPostCount !== 1) {
    throw new Error(`S1AC expected exactly one explicit task POST, got ${s1acTaskPostCount}`);
  }
  if (s1acTaskReadCount < 14) {
    throw new Error(`S1AC expected foreground GET refresh through ready state, got ${s1acTaskReadCount}`);
  }
  if (s1acTaskAbsorbPostCount !== 1 || !s1acTaskAbsorbed) {
    throw new Error(`S1AC expected exactly one explicit absorb POST, got ${s1acTaskAbsorbPostCount}`);
  }
  const writes = requests.filter((request) => (
    request.method === "POST"
      && request.url === "/api/mobile/research/candidate-memberships/1/deep-research-tasks"
  ));
  if (writes.length !== 1 || requestToken(writes[0]) !== "s1ac-write-token") {
    throw new Error("S1AC task create did not use exactly one explicit write authorization");
  }
  assertS1acTaskRequest(JSON.parse(writes[0].body || "{}"));
  const absorbWrites = requests.filter((request) => (
    request.method === "POST"
      && request.url === "/api/mobile/research/candidate-memberships/1/deep-research-tasks/91/absorb"
  ));
  if (absorbWrites.length !== 1 || requestToken(absorbWrites[0]) !== "s1ac-write-token") {
    throw new Error("S1AC absorb did not use exactly one explicit write authorization");
  }
  assertS1acTaskActionRequest(JSON.parse(absorbWrites[0].body || "{}"));
  if (s1acTodayReadStates[0] !== "needs_research"
      || !s1acTodayReadStates.includes("awaiting_user_confirmation")) {
    throw new Error(`S1AC Today did not transition through needs_research to awaiting_user_confirmation: ${JSON.stringify(s1acTodayReadStates)}`);
  }
  if (s1acWorkspaceReadStates[0] !== "research_required"
      || !s1acWorkspaceReadStates.includes("user_confirmation_required")) {
    throw new Error(`S1AC Research fresh reads did not transition through research_required to user_confirmation_required: ${JSON.stringify(s1acWorkspaceReadStates)}`);
  }
  const forbiddenWrites = requests.filter((request) => (
    request.method !== "GET"
      && !(request.method === "POST" && request.url === "/api/mobile/research/candidate-memberships/1/deep-research-tasks")
      && !(request.method === "POST" && request.url === "/api/mobile/research/candidate-memberships/1/deep-research-tasks/91/absorb")
  ));
  if (forbiddenWrites.length > 0) {
    throw new Error(`S1AC emitted an unexpected mutation: ${forbiddenWrites.map((request) => `${request.method} ${request.url}`).join(", ")}`);
  }
  for (const request of requests) {
    if (request.method === "GET" && request.body !== "") {
      throw new Error(`S1AC GET carried a body: ${request.url}`);
    }
    if (request.url.includes("orders") || request.url.includes("trades")
        || request.url.includes("cash") || request.url.includes("fees")
        || request.url.includes("positions") || request.url.includes("broker")) {
      throw new Error(`S1AC touched a forbidden trading or portfolio route: ${request.method} ${request.url}`);
    }
  }
}

function assertS1adDecisionRequest(value) {
  const expectedKeys = ["membershipVersion", "decision", "note", "idempotencyKey"];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expectedKeys].sort())
      || value.membershipVersion !== 3
      || value.decision !== "confirmed"
      || value.note !== "你从今日事项中确认了这份报告。"
      || typeof value.idempotencyKey !== "string"
      || value.idempotencyKey.length < 8) {
    throw new Error(`S1AD decision request did not preserve the exact explicit confirmation shape: ${JSON.stringify(value)}`);
  }
}

function assertFocusedS1ADTodayConfirmationRoutes() {
  if (s1adDecisionPostCount !== 1) {
    throw new Error(`S1AD expected exactly one explicit report decision POST, got ${s1adDecisionPostCount}`);
  }
  const writes = requests.filter((request) => (
    request.method === "POST"
      && request.url === "/api/mobile/research/candidate-memberships/1/deep-research-reports/41/decisions"
  ));
  if (writes.length !== 1 || requestToken(writes[0]) !== "s1ad-write-token") {
    throw new Error("S1AD report decision write did not use exactly one explicit write authorization");
  }
  assertS1adDecisionRequest(JSON.parse(writes[0].body || "{}"));
  if (s1adTodayReadStates[0] !== "awaiting_user_confirmation"
      || !s1adTodayReadStates.includes("confirmed")) {
    throw new Error(`S1AD Today did not transition through awaiting_user_confirmation to confirmed: ${JSON.stringify(s1adTodayReadStates)}`);
  }
  if (s1adWorkspaceReadStates[0] !== "user_confirmation_required"
      || !s1adWorkspaceReadStates.includes("confirmed")) {
    throw new Error(`S1AD report workspace did not transition through confirmation to fresh confirmed state: ${JSON.stringify(s1adWorkspaceReadStates)}`);
  }
  if (s1adInboxStatuses[0] !== "empty" || !s1adInboxStatuses.includes("available")) {
    throw new Error(`S1AD action inbox did not transition from empty to formal decision due: ${JSON.stringify(s1adInboxStatuses)}`);
  }
  for (const [label, envelope] of [
    ["initial", s1adFixture.inbox.initial],
    ["final", s1adFixture.inbox.final]
  ]) {
    if (envelope.metadata?.provenance !== "fixture" || envelope.metadata?.fixture !== true) {
      throw new Error(`S1AD ${label} action inbox did not preserve fixture provenance`);
    }
  }
  const forbiddenWrites = requests.filter((request) => (
    request.method !== "GET"
      && !(request.method === "POST"
        && request.url === "/api/mobile/research/candidate-memberships/1/deep-research-reports/41/decisions")
  ));
  if (forbiddenWrites.length > 0) {
    throw new Error(`S1AD emitted an unexpected mutation: ${forbiddenWrites.map((request) => `${request.method} ${request.url}`).join(", ")}`);
  }
  for (const request of requests) {
    if (request.method === "GET" && request.body !== "") {
      throw new Error(`S1AD GET carried a body: ${request.url}`);
    }
    if (request.url.includes("orders") || request.url.includes("trades")
        || request.url.includes("cash") || request.url.includes("fees")
        || request.url.includes("positions") || request.url.includes("broker")
        || request.url.includes("decision-check")) {
      throw new Error(`S1AD touched a forbidden trading or formal-decision-check route: ${request.method} ${request.url}`);
    }
  }
}

function assertFocusedF1BFourTabRoutes() {
  assertFocusedF1BReadCoverage(requests);
  for (const [url] of focusedF1BMinimumReadCounts) {
    const reads = requests.filter((request) => request.method === "GET" && request.url === url);
    for (const request of reads) {
      if (request.body !== "") throw new Error(`focused F1B GET carried a body: ${url}`);
      if (requestToken(request) !== "") {
        throw new Error(`focused F1B GET unexpectedly carried an authorization token: ${url}`);
      }
    }
  }
  const writes = requests.filter((request) => request.method !== "GET");
  if (writes.length > 0) {
    throw new Error(`focused F1B four-tab smoke performed writes: ${writes.map((request) => `${request.method} ${request.url}`).join(", ")}`);
  }
  const allowedReadSet = new Set(focusedF1BMinimumReadCounts.keys());
  const outOfJourney = [...new Set(
    requests
      .filter((request) => request.method !== "GET" || !allowedReadSet.has(request.url))
      .map((request) => `${request.method} ${request.url}`)
  )];
  if (outOfJourney.length > 0) {
    throw new Error(`focused F1B four-tab smoke made out-of-journey requests: ${outOfJourney.join(", ")}`);
  }
  if (focusedF1BCandidateReadResponses.length < 2
    || focusedF1BCandidateReadResponses.some(({ envelope }) =>
      envelope.ok !== false
      || envelope.message !== "read authorization required"
      || Object.keys(envelope).some((key) => !["ok", "message"].includes(key))
    )) {
    throw new Error("focused F1B unauthorized candidate reads exposed candidate or membership facts");
  }
  if (focusedF1BProfileResponses.length === 0
    || focusedF1BProfileResponses.some((response) =>
      response.data !== null
      || response.metadata?.freshness !== "unavailable"
      || "profile" in response
      || "evidence" in response
      || "suggestions" in response
    )) {
    throw new Error("focused F1B unauthorized profile response exposed research data");
  }
  if (focusedF1BDecisionContextResponses.length === 0
    || focusedF1BDecisionContextResponses.some((response) =>
      response.quote?.data !== null
      || response.research?.profile !== null
      || response.research?.evidence?.length !== 0
      || response.research?.suggestions?.length !== 0
      || response.quantEvidence?.status !== "unavailable"
      || response.portfolio?.status !== "omitted"
    )) {
    throw new Error("focused F1B decision-context response exposed persisted facts");
  }
  if (focusedF1BPinganResponses.length === 0
    || focusedF1BPinganResponses.some((response) =>
      response.status !== "unauthorized"
      || response.positions?.length !== 0
      || response.positionCount !== 0
      || response.dataUse?.display !== "blocked"
    )) {
    throw new Error("focused F1B unauthorized Pingan response exposed portfolio facts");
  }
  if (focusedF1BPortfolioContextResponses.length === 0
    || focusedF1BPortfolioContextResponses.some((response) =>
      response.status !== "unauthorized"
      || response.contextId !== null
      || response.portfolioSnapshotId !== null
      || response.portfolioSource !== null
      || response.positions?.length !== 0
      || response.dataUse?.display !== "blocked"
    )) {
    throw new Error("focused F1B unauthorized current-portfolio response exposed portfolio facts");
  }
  if (focusedF1BReviewResponses.length === 0
    || focusedF1BReviewResponses.some((response) =>
      response.metadata?.freshness !== "unavailable"
      || response.checks?.length !== 0
      || response.advisoryOnly !== true
    )) {
    throw new Error("focused F1B unauthorized review response exposed decision facts");
  }
  const unauthenticatedToday = focusedF1CTodayResponses.filter(({ token }) => token === "");
  if (unauthenticatedToday.length < 1
    || unauthenticatedToday.some(({ statusCode, envelope }) =>
      statusCode !== 401
      || envelope.status !== "unavailable"
      || envelope.event !== null
      || envelope.metadata?.freshness !== "unavailable"
      || envelope.metadata?.fixture !== false
    )) {
    throw new Error("focused F1B unauthorized Today response exposed decision or review facts");
  }
  assertSmokeRequestSafety("focused F1B four-tab");
}

function assertFocusedF1CTodayReviewDueRoutes() {
  const expectedExactCount = [...focusedF1CExactReadCounts.values()].reduce((sum, count) => sum + count, 0);
  const expectedRequestCount = [
    ...focusedF1CExactReadCounts.values(),
    ...focusedF1CSupportingReadCounts.values()
  ].reduce((sum, count) => sum + count, 0);
  if (requests.length !== expectedRequestCount || focusedF1CResponseLedger.length !== expectedExactCount) {
    const requestSummary = requests.map(({ method, url }) => `${method} ${url}`).join(", ");
    const responseSummary = focusedF1CResponseLedger
      .map(({ statusCode, url }) => `${statusCode} ${url}`).join(", ");
    throw new Error(
      `focused F1C smoke expected ${expectedRequestCount} requests and ${expectedExactCount} exact responses, got ${requests.length}/${focusedF1CResponseLedger.length}; `
        + `requests=[${requestSummary}]; responses=[${responseSummary}]`
    );
  }
  for (const [url, routeCount] of focusedF1CExactReadCounts) {
    const routeRequests = requests.filter((request) => request.method === "GET" && request.url === url);
    const routeResponses = focusedF1CResponseLedger.filter((response) => response.url === url);
    if (routeRequests.length !== routeCount || routeResponses.length !== routeCount) {
      throw new Error(
        `focused F1C smoke expected ${routeCount} pair(s) for ${url}, got ${routeRequests.length}/${routeResponses.length}`
      );
    }
    if (routeRequests.some((request) =>
      request.body !== "" || requestToken(request) !== "today-review-due-read-token")) {
      throw new Error(`focused F1C read did not preserve the exact read-only boundary: ${url}`);
    }
  }
  for (const [url, routeCount] of focusedF1CSupportingReadCounts) {
    const routeRequests = requests.filter((request) => request.method === "GET" && request.url === url);
    if (routeRequests.length !== routeCount || routeRequests.some((request) => request.body !== "")) {
      throw new Error(`focused F1C supporting read expected ${routeCount} body-free GETs for ${url}, got ${routeRequests.length}`);
    }
  }
  const exactRoutes = new Set(focusedF1CExactReadCounts.keys());
  const supportingRoutes = new Set(focusedF1CSupportingReadCounts.keys());
  const outOfJourney = requests.filter((request) =>
    request.method !== "GET" || (!exactRoutes.has(request.url) && !supportingRoutes.has(request.url)));
  if (outOfJourney.length > 0) {
    throw new Error(
      `focused F1C smoke made out-of-journey requests: ${outOfJourney.map((request) => `${request.method} ${request.url}`).join(", ")}`
    );
  }

  const [{ statusCode: todayStatusCode, envelope: todayEnvelope }] = focusedF1CResponseLedger.filter(({ url }) =>
    url === "/api/mobile/research/today?symbol=HK.00700");
  if (todayStatusCode !== 200
    || todayEnvelope.status !== "available"
    || todayEnvelope.requestedSymbol !== "HK.00700"
    || todayEnvelope.metadata?.provenance !== "fixture"
    || todayEnvelope.metadata?.fixture !== true
    || todayEnvelope.event?.state !== "new"
    || Object.values(todayEnvelope.safety ?? {}).some((value) => value !== false)) {
    throw new Error("focused F1C smoke exposed a malformed or non-fixture REVIEW_DUE event");
  }
  const [{ statusCode: inboxStatusCode, envelope: inboxEnvelope }] = focusedF1CResponseLedger.filter(({ url }) =>
    url === "/api/mobile/research/today/inbox");
  if (inboxStatusCode !== 200
    || inboxEnvelope.status !== "available"
    || inboxEnvelope.requestedActorId !== "today-review-due-read-token"
    || inboxEnvelope.metadata?.provenance !== "fixture"
    || inboxEnvelope.metadata?.fixture !== true
    || inboxEnvelope.items?.length !== 1
    || inboxEnvelope.items[0]?.symbol !== "HK.00700"
    || inboxEnvelope.items[0]?.kind !== "review_due"
    || inboxEnvelope.items[0]?.reviewEvent?.state !== "new"
    || inboxEnvelope.safety?.advisoryOnly !== true
    || Object.entries(inboxEnvelope.safety ?? {}).some(([key, value]) => key !== "advisoryOnly" && value !== false)) {
    throw new Error("focused F1C smoke exposed a malformed or non-fixture Today action inbox");
  }
  for (const response of focusedF1CResponseLedger) {
    if (![
      "/api/mobile/research/today?symbol=HK.00700",
      "/api/mobile/research/today/inbox"
    ].includes(response.url)) {
      assertFocusedF1CFactFreeResponse(response);
    }
  }
  assertSmokeRequestSafety("focused F1C Today REVIEW_DUE");
}

function assertFocusedF1DSessionDraftFormalDecisionRoutes() {
  assertSmokeRequestSafety("focused F1D");
  const decisionWrites = requests.filter((request) => (
    request.method === "POST"
      && request.url === "/api/mobile/research/profiles/HK/09926/decision-checks"
  ));
  const reviewWrites = requests.filter((request) => (
    request.method === "POST"
      && request.url === `/api/mobile/research/profiles/HK/09926/decision-checks/${uiDecisionCheckId}/reviews`
  ));
  if (decisionWrites.length !== 1 || !decisionCheckCreated) {
    throw new Error(`focused F1D double tap must create exactly one decision POST, got ${decisionWrites.length}`);
  }
  if (reviewWrites.length !== 1 || !decisionReviewCreated) {
    throw new Error(`focused F1E double tap must create exactly one review POST, got ${reviewWrites.length}`);
  }
  if (requestToken(decisionWrites[0]) !== "f1d-fixture-write-actor-a"
    || requestToken(reviewWrites[0]) !== "f1d-fixture-write-actor-a") {
    throw new Error("focused F1D POST did not use the distinct write credential");
  }
  const decisionPostIndex = requests.indexOf(decisionWrites[0]);
  const decisionTodayReads = requests.slice(decisionPostIndex + 1).filter((request) => (
    request.method === "GET"
      && request.url === "/api/mobile/research/today?symbol=HK.09926"
      && requests.indexOf(request) < requests.indexOf(reviewWrites[0])
  ));
  if (decisionTodayReads.length !== 1) {
    throw new Error(
      `focused F1D formal-decision handoff must use exactly one Today GET, got ${decisionTodayReads.length}`
    );
  }
  if (!focusedF1EDelayedReviewResponseObserved) {
    throw new Error("focused F1E journey did not hold the review POST response long enough to verify form locking");
  }
  const reviewPostIndex = requests.indexOf(reviewWrites[0]);
  const resolvedTodayReads = requests.slice(reviewPostIndex + 1).filter((request) => (
    request.method === "GET"
      && request.url === "/api/mobile/research/today?symbol=HK.09926"
  ));
  if (resolvedTodayReads.length !== 1) {
    throw new Error(`focused F1E success must cause exactly one resolved Today GET, got ${resolvedTodayReads.length}`);
  }
  if ([...decisionTodayReads, ...resolvedTodayReads].some((request) =>
    requestToken(request) !== "f1d-fixture-read-actor-a")) {
    throw new Error("focused F1D Today refresh did not use the distinct read credential");
  }
  if (requests.slice(reviewPostIndex + 1).some((request) => request.method === "POST")) {
    throw new Error("focused F1E post-success Today refresh replayed a write");
  }
  const snapshot = lastDecisionCheck?.decisionSnapshot;
  const expectedSnapshotBinding = expectedF1DDecisionSnapshotBinding();
  if (snapshot?.availability !== "preserved" || !snapshot.snapshot
    || snapshot.snapshot.portfolioContext?.state !== expectedSnapshotBinding.portfolioContext.state
    || snapshot.snapshot.portfolioContext?.envelope?.contextId !== expectedSnapshotBinding.portfolioContext.contextId
    || snapshot.snapshot.portfolioContext?.envelope?.portfolioSnapshotId !== expectedSnapshotBinding.portfolioContext.portfolioSnapshotId
    || snapshot.snapshot.portfolioContext?.envelope?.accountScopeId !== expectedSnapshotBinding.portfolioContext.accountScopeId
    || snapshot.snapshot.riskImpact?.availability !== "not_captured"
    || snapshot.snapshot.riskImpact?.envelope !== null) {
    throw new Error("focused F1D response did not preserve the exact current portfolio and explicit not-captured risk facts");
  }
  const expectedBinding = s1adFixture.inbox.final.items[0].reviewEvent.reportBinding;
  if (lastDecisionCheck.researchReportDecision?.availability !== "preserved"
    || canonicalJson(lastDecisionCheck.researchReportDecision.binding) !== canonicalJson(expectedBinding)
    || lastDecisionCheck.formalDecision?.availability !== "preserved"
    || lastDecisionCheck.formalDecision.systemRecommendation?.direction !== "wait_for_evidence"
    || canonicalJson(lastDecisionCheck.formalDecision.ownerDecision) !== canonicalJson({
      ...lastDecisionCheckRequest.formalDecision,
      divergenceReason: lastDecisionCheckRequest.formalDecision.divergenceReason ?? null
    })
    || lastDecisionCheck.formalDecision.personalRiskAssessment?.status !== "not_requested"
    || lastDecisionCheck.formalDecision.personalRiskAssessment?.requiresOverride !== false
    || lastDecisionCheck.formalDecision.differsFromSystem !== false) {
    throw new Error("focused F1D response did not preserve the exact system recommendation and Owner decision");
  }
}

function assertFocusedF1CFactFreeResponse({ url, statusCode, envelope }) {
  if (statusCode !== 401) {
    throw new Error(`focused F1C non-Today read did not fail closed with 401: ${url}`);
  }
  const factFree = url === "/api/mobile/market/daily-bars/HK/00700"
      || url === "/api/mobile/research/today/inbox"
      || url === "/api/mobile/research/candidates"
      || url === "/api/mobile/research/candidate-memberships?includeArchived=true"
      || url === "/api/mobile/research/candidate-memberships?includeArchived=false"
    ? envelope.ok === false
      && envelope.message === "read authorization required"
      && Object.keys(envelope).every((key) => ["ok", "message"].includes(key))
    : url === "/api/mobile/research/profiles/HK/00700"
      ? envelope.data === null
        && envelope.metadata?.freshness === "unavailable"
        && !("profile" in envelope)
        && !("evidence" in envelope)
        && !("suggestions" in envelope)
      : url === "/api/mobile/research/decision-context/HK/00700"
        ? envelope.quote?.data === null
          && envelope.research?.profile === null
          && envelope.research?.evidence?.length === 0
          && envelope.research?.suggestions?.length === 0
          && envelope.quantEvidence?.status === "unavailable"
          && envelope.portfolio?.status === "omitted"
        : url === "/api/mobile/research/portfolio/pingan-current/context"
          ? envelope.status === "unauthorized"
            && envelope.contextId === null
            && envelope.portfolioSnapshotId === null
            && envelope.portfolioSource === null
            && envelope.positions?.length === 0
          : url === "/api/mobile/research/portfolio/pingan-snapshot/HK/00700"
            ? envelope.status === "unauthorized"
              && envelope.positions?.length === 0
              && envelope.positionCount === 0
            : url === "/api/mobile/research/profiles/HK/00700/decision-reviews"
              ? envelope.metadata?.freshness === "unavailable"
                && envelope.checks?.length === 0
              : false;
  if (!factFree) {
    throw new Error(`focused F1C unauthorized read exposed facts: ${url}`);
  }
}

function assertFocusedF1BReadCoverage(candidateRequests) {
  for (const [url, minimumCount] of focusedF1BMinimumReadCounts) {
    const reads = candidateRequests.filter((request) => request.method === "GET" && request.url === url);
    if (reads.length < minimumCount) {
      throw new Error(`focused F1B four-tab smoke expected GET ${url} at least ${minimumCount} time(s), got ${reads.length}`);
    }
  }
}

function assertFocusedResponsiveRoutes(mode) {
  const actual = new Set(requests.map((request) => `${request.method} ${request.url}`));
  for (const route of [
    "GET /api/mobile/research/candidates",
    "GET /api/mobile/research/portfolio/pingan-current/context"
  ]) {
    if (!actual.has(route)) throw new Error(`focused ${mode} smoke missed ${route}`);
  }
  assertSmokeRequestSafety(`focused ${mode}`);
}

function assertFocusedAccessibilityRoutes() {
  assertFocusedResponsiveRoutes("accessibility");
}

function assertFocusedDecisionSnapshotRoutes() {
  const writes = requests.filter((request) => request.method === "POST" && request.url.endsWith("/decision-checks"));
  const reviewWrites = requests.filter((request) => request.method === "POST" && request.url.endsWith("/reviews"));
  if (writes.length !== 2 || reviewWrites.length !== 2 || !decisionCheckCreated || !decisionReviewCreated) {
    throw new Error(`focused decision snapshot smoke expected one write and replay per route, got checks=${writes.length}, reviews=${reviewWrites.length}`);
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`focused decision snapshot smoke left the method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method === "GET" && request.body !== "") {
      throw new Error(`focused decision snapshot smoke sent a GET body: ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`focused decision snapshot smoke touched a forbidden route: ${request.method} ${request.url}`);
    }
  }
}

function assertFocusedAnnualReviewLearningSummaryRoutes(expectedToken) {
  const historyReads = requests.filter((request) => request.method === "GET"
    && request.url === "/api/mobile/research/profiles/HK/09926/decision-reviews"
    && requestToken(request) === expectedToken);
  if (historyReads.length !== 1) {
    throw new Error(`focused review-learning summary smoke expected one actor-scoped history read, got ${historyReads.length}`);
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`focused review-learning summary smoke left the method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`focused review-learning summary smoke used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`focused review-learning summary smoke touched a forbidden route: ${request.url}`);
    }
  }
}

function assertFocusedQuantDecisionEvidenceRoutes() {
  const required = new Set([
    "GET /api/mobile/research/decision-context/HK/09926"
  ]);
  const actual = new Set(requests.map((request) => `${request.method} ${request.url}`));
  for (const route of required) {
    if (!actual.has(route)) throw new Error(`focused quant decision-evidence smoke missed ${route}`);
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`focused quant decision-evidence smoke left the method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`focused quant decision-evidence smoke used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`focused quant decision-evidence smoke touched a forbidden route: ${request.url}`);
    }
  }
}

function assertFocusedAnnualDecisionBriefRoutes() {
  const actual = new Set(requests.map((request) => `${request.method} ${request.url}`));
  for (const route of [
    "GET /api/mobile/research/candidate-memberships?includeArchived=true",
    "GET /api/mobile/research/candidate-memberships/1/decision-brief"
  ]) {
    if (!actual.has(route)) throw new Error(`focused annual decision brief smoke missed ${route}`);
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`focused annual decision brief smoke left the method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`focused annual decision brief smoke used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`focused annual decision brief smoke touched a forbidden route: ${request.url}`);
    }
  }
}

function assertFocusedDailyClientContinuityRoutes() {
  const requiredReads = [
    "/api/mobile/research/candidates",
    "/api/mobile/research/candidate-memberships?includeArchived=true",
    "/api/mobile/research/candidate-memberships/1/decision-brief",
    "/api/mobile/research/candidate-memberships/1/today",
    "/api/mobile/research/candidate-memberships/1/decision-intake",
    "/api/mobile/research/candidate-memberships/1/advisory-scope",
    "/api/mobile/research/candidate-memberships/1/human-review-workspace",
    "/api/mobile/research/candidate-memberships/1/human-review-workspace/follow-up-workflow",
    "/api/mobile/research/candidate-memberships/1/human-review-workspace/follow-up-workflow/decision-note-workflow",
    "/api/mobile/research/profiles/HK/09926",
    "/api/mobile/research/decision-context/HK/09926",
    "/api/mobile/research/portfolio/pingan-current/context",
    "/api/mobile/research/portfolio/pingan-snapshot/HK/09926",
    "/api/mobile/research/profiles/HK/09926/decision-reviews"
  ];
  for (const route of requiredReads) {
    const count = requests.filter((request) => request.method === "GET" && request.url === route).length;
    if (count < 2) {
      throw new Error(`daily resume must reread ${route} on first launch and cold launch; got ${count}`);
    }
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`daily resume left the exact method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`daily resume used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`daily resume touched a forbidden route: ${request.url}`);
    }
  }
}

function assertFocusedDailyClientRecoveryRoutes() {
  const candidateReads = requests.filter((request) => request.method === "GET"
    && request.url === "/api/mobile/research/candidates"
    && requestToken(request) === "daily-continuity-recovery");
  if (candidateReads.length !== 2) {
    throw new Error(`daily recovery expected one unauthorized and one successful candidate GET, got ${candidateReads.length}`);
  }
  const portfolioReads = requests.filter((request) => request.method === "GET"
    && request.url === "/api/mobile/research/portfolio/pingan-current/context"
    && requestToken(request) === "daily-continuity-recovery");
  if (portfolioReads.length < 2) {
    throw new Error(`daily recovery expected transport retries followed by one successful portfolio GET, got ${portfolioReads.length}`);
  }
  const todayReads = requests.filter((request) => request.method === "GET"
    && request.url === "/api/mobile/research/candidate-memberships/1/today"
    && requestToken(request) === "daily-continuity-recovery");
  if (todayReads.length !== 1) {
    throw new Error(`daily recovery expected one Today GET after candidate recovery, got ${todayReads.length}`);
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`daily recovery left the exact method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`daily recovery used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`daily recovery touched a forbidden route: ${request.url}`);
    }
  }
}

function assertFocusedAnnualValuationQuantRoutes() {
  const valuationQuantReads = requests.map(annualValuationQuantRequest).filter(Boolean);
  if (valuationQuantReads.length !== 1) {
    throw new Error(`focused valuation quant smoke expected one workbench GET, got ${valuationQuantReads.length}`);
  }
  assertAnnualValuationQuantRequest(valuationQuantReads[0]);
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`focused valuation quant smoke left the method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`focused valuation quant smoke used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`focused valuation quant smoke touched a forbidden route: ${request.url}`);
    }
  }
}

function assertFocusedAnnualPortfolioLabRoutes() {
  const portfolioLabReads = requests.map(annualPortfolioLabRequest).filter(Boolean);
  if (portfolioLabReads.length !== 2) {
    throw new Error(`focused portfolio lab smoke expected two exact-stock workbench GETs, got ${portfolioLabReads.length}`);
  }
  portfolioLabReads.forEach(assertAnnualPortfolioLabRequest);
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`focused portfolio lab smoke left the method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`focused portfolio lab smoke used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`focused portfolio lab smoke touched a forbidden route: ${request.url}`);
    }
  }
}

function assertFocusedAnnualConditionalDecisionRoutes(expectedCount) {
  const reads = requests.map(annualConditionalDecisionRequest).filter(Boolean);
  if (reads.length !== expectedCount) {
    throw new Error(`focused conditional-decision smoke expected ${expectedCount} preview GETs, got ${reads.length}`);
  }
  reads.forEach(assertAnnualConditionalDecisionRequest);
  if (conditionalPreviewRequestCounts.get(conditionalDecisionToken) !== expectedCount) {
    throw new Error("conditional-decision preview requests did not preserve the dedicated read identity");
  }
  for (const request of requests) {
    if (!isAllowedSmokeRequest(request)) {
      throw new Error(`focused conditional-decision smoke left the method/path allowlist: ${request.method} ${request.url}`);
    }
    if (request.method !== "GET" || request.body !== "") {
      throw new Error(`focused conditional-decision smoke used a write or GET body: ${request.method} ${request.url}`);
    }
    if (/orders|trades|cash|fees|positions|broker/.test(request.url)) {
      throw new Error(`focused conditional-decision smoke touched a forbidden route: ${request.url}`);
    }
  }
}

function annualConditionalDecisionRequest(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const match = url.pathname.match(/^\/api\/mobile\/research\/candidate-memberships\/(\d+)\/conditional-decision-preview$/);
  if (!match) return null;
  return { membershipId: match[1], input: parseAnnualConditionalDecisionInputs(url), request };
}

function assertAnnualConditionalDecisionRequest(read) {
  const expected = {
    valuation: {
      metricCurrency: "HKD",
      baseMetricPerShare: 2,
      annualGrowthRate: 0.15,
      horizonYears: 3,
      terminalMultiple: 18,
      annualDiscountRate: 0.1,
      netCashPerShare: 1,
      growthRateStep: 0.05,
      multipleStep: 2
    },
    quantFilter: { maxDrawdownMagnitude: 0.5, maxTurnoverOneWay: 10, minTradeCount: 1 },
    scenarioAmounts: [25_000, 5_000],
    selectedPortfolioScenarioIndex: 0
  };
  if (read.membershipId !== "1" || JSON.stringify(read.input) !== JSON.stringify(expected)) {
    throw new Error(`conditional-decision GET did not preserve every exact user input: ${read.request.url}`);
  }
  if (requestToken(read.request) !== conditionalDecisionToken) {
    throw new Error("conditional-decision GET did not use the dedicated read identity");
  }
}

function annualValuationQuantRequest(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const match = url.pathname.match(/^\/api\/mobile\/research\/candidate-memberships\/(\d+)\/valuation-quant-workbench$/);
  if (!match) return null;
  return { membershipId: match[1], input: parseAnnualValuationQuantInputs(url), request };
}

function assertAnnualValuationQuantRequest(read) {
  const standard = {
    valuation: {
      metricCurrency: "HKD",
      baseMetricPerShare: 1,
      annualGrowthRate: 0.1,
      horizonYears: 3,
      terminalMultiple: 10,
      annualDiscountRate: 0.08,
      netCashPerShare: 0.5,
      growthRateStep: 0.05,
      multipleStep: 2
    },
    quantFilter: {
      maxDrawdownMagnitude: 0.05,
      maxTurnoverOneWay: 0.6,
      minTradeCount: 2
    }
  };
  const conditional = {
    valuation: {
      metricCurrency: "HKD",
      baseMetricPerShare: 2,
      annualGrowthRate: 0.15,
      horizonYears: 3,
      terminalMultiple: 18,
      annualDiscountRate: 0.1,
      netCashPerShare: 1,
      growthRateStep: 0.05,
      multipleStep: 2
    },
    quantFilter: { maxDrawdownMagnitude: 0.5, maxTurnoverOneWay: 10, minTradeCount: 1 }
  };
  const input = JSON.stringify(read.input);
  if (read.membershipId !== "1" || ![JSON.stringify(standard), JSON.stringify(conditional)].includes(input)) {
    throw new Error(`valuation quant GET did not preserve the exact user inputs: ${read.request.url}`);
  }
}

function annualPortfolioLabRequest(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const match = url.pathname.match(/^\/api\/mobile\/research\/candidate-memberships\/(\d+)\/portfolio-lab$/);
  if (!match) return null;
  return { membershipId: match[1], amounts: parseAnnualPortfolioLabInputs(url), request };
}

function assertAnnualPortfolioLabRequest(read) {
  if (!["1", "2"].includes(read.membershipId)
    || JSON.stringify(read.amounts) !== JSON.stringify([25_000, 5_000])) {
    throw new Error(`portfolio lab GET did not preserve exact user amount order: ${read.request.url}`);
  }
  if (!["owner-read-token", conditionalDecisionToken].includes(requestToken(read.request))) {
    throw new Error("portfolio lab GET did not use the exact account-scoped read authorization");
  }
}

function isAllowedSmokeRequest(request) {
  const exactReads = new Set([
    "/health/ready",
    "/api/mobile/market/search?q=00175",
    "/api/mobile/market/discovery",
    "/api/mobile/market/discovery?symbol=HK.00175",
    "/api/mobile/market/environment/HK/00175",
    "/api/mobile/market/environment/HK/00700",
    "/api/mobile/market/quotes/HK/00175",
    "/api/mobile/market/daily-bars/HK/00175",
    "/api/mobile/market/daily-bars/HK/00005",
    "/api/mobile/market/quotes/HK/09926",
    "/api/mobile/market/quotes/HK/00700",
    "/api/mobile/market/daily-bars/HK/00700",
    "/api/mobile/market/daily-bars/HK/09926",
    "/api/mobile/market/weinstein/HK/09926?analysisAsOf=2026-07-30",
    "/api/mobile/assets/alpha",
    "/api/mobile/research/today?symbol=HK.00700",
    "/api/mobile/research/today?symbol=HK.00175",
    "/api/mobile/research/today?symbol=HK.09926",
    "/api/mobile/research/today/inbox",
    "/api/mobile/research/candidates",
    "/api/mobile/research/candidate-memberships?includeArchived=true",
    "/api/mobile/research/candidate-memberships?includeArchived=false",
    "/api/mobile/research/candidate-memberships/1/decision-brief",
    "/api/mobile/research/candidate-memberships/1/today",
    "/api/mobile/research/candidate-memberships/1/decision-intake",
    "/api/mobile/research/candidate-memberships/1/fundamentals",
    "/api/mobile/research/candidate-memberships/1/research-context",
    "/api/mobile/research/candidate-memberships/1/documents",
    "/api/mobile/research/candidate-memberships/1/valuation-scenarios",
    "/api/mobile/research/candidate-memberships/1/completeness",
    "/api/mobile/research/candidate-memberships/1/deep-research",
    "/api/mobile/research/candidate-memberships/1/deep-research-tasks/91",
    "/api/mobile/research/candidate-memberships/1/advisory-scope",
    "/api/mobile/research/candidate-memberships/1/human-review-workspace",
    "/api/mobile/research/candidate-memberships/1/human-review-workspace/follow-up-workflow",
    "/api/mobile/research/candidate-memberships/1/human-review-workspace/follow-up-workflow/decision-note-workflow",
    "/api/mobile/research/profiles/HK/00175",
    "/api/mobile/research/profiles/HK/00005",
    "/api/mobile/research/profiles/HK/09926",
    "/api/mobile/research/profiles/HK/00700",
    "/api/mobile/research/cloud-ai-policy",
    "/api/mobile/research/decision-context/HK/00175",
    "/api/mobile/research/decision-context/HK/00005",
    "/api/mobile/research/decision-context/HK/09926",
    "/api/mobile/research/decision-context/HK/00700",
    "/api/mobile/research/portfolio/pingan-current/context",
    "/api/mobile/research/portfolio/pingan-snapshot/HK/00175",
    "/api/mobile/research/portfolio/pingan-snapshot/HK/00005",
    "/api/mobile/research/portfolio/pingan-snapshot/HK/09926",
    "/api/mobile/research/portfolio/pingan-snapshot/HK/00700",
    "/api/mobile/research/profiles/HK/00175/decision-reviews",
    "/api/mobile/research/profiles/HK/00005/decision-reviews",
    "/api/mobile/research/profiles/HK/09926/decision-reviews",
    "/api/mobile/research/profiles/HK/00700/decision-reviews"
  ]);
  if (request.method === "GET" && exactReads.has(request.url)) {
    return true;
  }
  const focusedTaskFixture = isS1acUITest ? s1acFixture
    : isS1adUITest || isExecutingUITest(f1dUITest) ? s1adFixture : s1abFixture;
  if (request.method === "GET" && focusedTaskFixture
      && request.url === `/api/mobile/research/candidate-memberships/1/deep-research-tasks/current?membershipVersion=3&evidencePackId=31&evidencePackFingerprint=${focusedTaskFixture.pack.packFingerprint}`) {
    return true;
  }
  if (annualValuationQuantRequest(request)) {
    return true;
  }
  if (annualPortfolioLabRequest(request)) {
    return true;
  }
  if (annualConditionalDecisionRequest(request)) {
    return true;
  }
  const exactRiskReads = new Set([
    "/api/mobile/research/portfolio/pingan-current/risk-impact?symbol=HK.00175&hypotheticalAmount=10000",
    "/api/mobile/research/portfolio/pingan-current/risk-impact?symbol=HK.00175&hypotheticalAmount=10000.0",
    "/api/mobile/research/portfolio/pingan-current/risk-impact?symbol=HK.00175&hypotheticalAmount=20000",
    "/api/mobile/research/portfolio/pingan-current/risk-impact?symbol=HK.00175&hypotheticalAmount=20000.0"
  ]);
  if (request.method === "GET" && exactRiskReads.has(request.url)) {
    return true;
  }
  const exactWrites = new Set([
    "/api/mobile/research/profiles/HK/09926/decision-checks",
    `/api/mobile/research/profiles/HK/09926/decision-checks/${uiDecisionCheckId}/reviews`,
    "/api/mobile/research/candidate-memberships/1/evidence-packs",
    "/api/mobile/research/candidate-memberships/1/deep-research-tasks",
    "/api/mobile/research/candidate-memberships/1/deep-research-tasks/91/absorb",
    "/api/mobile/research/candidate-memberships/1/deep-research-reports/41/decisions"
  ]);
  return request.method === "POST" && exactWrites.has(request.url);
}

async function simulatorDestination() {
  const requested = await simulatorByUdid(requestedSimulatorUdid);
  if (!requested || requested.isAvailable === false) {
    throw new Error(`requested iOS simulator is unavailable: ${requestedSimulatorUdid}`);
  }
  if (!String(requested.deviceTypeIdentifier).startsWith("com.apple.CoreSimulator.SimDeviceType.iPhone-")) {
    throw new Error(`requested iOS simulator is not an iPhone: ${requestedSimulatorUdid}`);
  }
  return {
    udid: requested.udid,
    destination: `platform=iOS Simulator,id=${requested.udid}`
  };
}

async function shutdownSimulator(udid) {
  if (!udid) return;
  await run("xcrun", ["simctl", "shutdown", udid], { silent: true, allowFailure: true });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await simulatorState(udid);
    if (state === null || state === "Shutdown") {
      return;
    }
    await sleep(500);
  }
  throw new Error(`simulator cleanup left the target active: ${udid}:${await simulatorState(udid)}`);
}

async function shutdownSimulatorStable(udid) {
  if (!udid) return;
  let stableSince = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await simulatorState(udid);
    if (state === null || state === "Shutdown") {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 3_000) return;
    } else {
      stableSince = null;
      await run("xcrun", ["simctl", "shutdown", udid], { silent: true, allowFailure: true });
    }
    await sleep(500);
  }
  throw new Error(`simulator cleanup did not hold Shutdown state for the exact target: ${udid}:${await simulatorState(udid)}`);
}

async function simulatorState(udid) {
  return (await simulatorByUdid(udid))?.state ?? null;
}

async function simulatorByUdid(udid) {
  const result = await run("xcrun", ["simctl", "list", "devices", udid, "-j"], { silent: true });
  const payload = JSON.parse(result.stdout);
  return Object.values(payload.devices).flat().find((device) => device.udid === udid) ?? null;
}

async function prepareSmokeArtifacts() {
  await Promise.all([
    rm(testLogDir, { recursive: true, force: true }),
    rm(resultBundleDir, { recursive: true, force: true }),
    rm(screenshotDir, { recursive: true, force: true }),
    rm(attachmentExportDir, { recursive: true, force: true })
  ]);
  await Promise.all([
    mkdir(resultBundleDir, { recursive: true }),
    mkdir(screenshotDir, { recursive: true })
  ]);
}

async function cleanupTemporaryBuildArtifacts() {
  await Promise.all([
    rm(derivedDataPath, { recursive: true, force: true }),
    rm(resultBundleDir, { recursive: true, force: true }),
    rm(attachmentExportDir, { recursive: true, force: true })
  ]);
}

async function assertTemporaryBuildArtifactsRemoved() {
  for (const target of [derivedDataPath, resultBundleDir, attachmentExportDir]) {
    try {
      await stat(target);
      throw new Error(`iOS UI smoke cleanup left temporary artifacts: ${target}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function reportCurrentTestFailures() {
  try {
    const entries = await readdir(resultBundleDir);
    const bundles = entries
      .filter((entry) => entry.startsWith("ui-") && entry.endsWith(".xcresult"))
      .sort();
    for (const bundle of bundles) {
      const result = await run("xcrun", [
        "xcresulttool", "get", "test-results", "summary",
        "--path", path.join(resultBundleDir, bundle), "--compact"
      ], { silent: true, allowFailure: true });
      if (!result.stdout.trim()) continue;
      const failures = collectFailureTexts(JSON.parse(result.stdout));
      for (const failure of failures) {
        console.error(`iOS UI test failure: ${failure}`);
      }
      const tests = await run("xcrun", [
        "xcresulttool", "get", "test-results", "tests",
        "--path", path.join(resultBundleDir, bundle), "--compact"
      ], { silent: true, allowFailure: true });
      if (tests.stdout.trim()) {
        for (const diagnostic of collectFailedTestDiagnostics(JSON.parse(tests.stdout))) {
          console.error(`iOS UI test diagnostic: ${diagnostic}`);
        }
      }
    }
  } catch (error) {
    console.error(`iOS UI failure diagnostics were unavailable: ${String(error)}`);
  }
}

async function readXcresultExecutionEvidence() {
  const plannedUnitTargets = requestedUITest ? [] : unitTestTargets;
  const unitTree = requestedUITest
    ? null
    : await readXcresultTestTree(path.join(resultBundleDir, "unit-tests.xcresult"));
  const uiTrees = [];
  for (const expectedTarget of selectedUITestTargets) {
    const testName = expectedTarget.split("/").at(-1);
    const bundle = `ui-${testName}.xcresult`;
    uiTrees.push({
      bundle,
      expectedTarget,
      tree: await readXcresultTestTree(path.join(resultBundleDir, bundle))
    });
  }
  return deriveXcresultExecutionEvidence({
    unitTree,
    uiTrees,
    plannedUnitTargets,
    plannedUiTargets: selectedUITestTargets
  });
}

async function readXcresultTestTree(bundlePath) {
  const result = await run("xcrun", [
    "xcresulttool", "get", "test-results", "tests",
    "--path", bundlePath, "--compact"
  ], { silent: true });
  if (!result.stdout.trim()) throw new Error(`xcresult contains no test tree: ${path.basename(bundlePath)}`);
  return JSON.parse(result.stdout);
}

function collectFailedTestDiagnostics(value) {
  if (Array.isArray(value)) return value.flatMap(collectFailedTestDiagnostics);
  if (!value || typeof value !== "object") return [];
  const current = value.nodeType === "Failure Message" || value.nodeType === "Source Code Reference"
    ? [`${value.nodeType}: ${value.name ?? ""} ${value.details ?? ""} ${value.nodeIdentifierURL ?? ""}`.trim()]
    : value.result === "Failed" && value.nodeType === "Test Case"
      ? [`Failed test case: ${value.name ?? "unknown"} ${value.details ?? ""}`.trim()]
      : [];
  return current.concat(Object.values(value).flatMap(collectFailedTestDiagnostics));
}

function collectFailureTexts(value) {
  if (Array.isArray(value)) return value.flatMap(collectFailureTexts);
  if (!value || typeof value !== "object") return [];
  const current = typeof value.failureText === "string" ? [value.failureText] : [];
  return current.concat(Object.values(value).flatMap(collectFailureTexts));
}

async function writeSmokeEvidence(postCleanupFreeDiskBytes) {
  if (!testExecutionEvidence || !verifiedSafetyEvidence) throw new Error("verified XCTest or safety evidence is missing");
  const gitEnd = await readGitState();
  const gitInterval = gitIntervalEvidence(smokeGitStart, gitEnd, "iOS UI smoke");
  const screenshotNames = (await readdir(screenshotDir)).filter((name) => name.endsWith(".png")).sort();
  const screenshots = [];
  for (const name of screenshotNames) {
    const bytes = await readFile(path.join(screenshotDir, name));
    screenshots.push({
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }
  const requestLedger = requestLedgerFromRequests(requests);
  const safety = deriveSafetyEvidence(requestLedger);
  if (JSON.stringify(safety) !== JSON.stringify(verifiedSafetyEvidence)) throw new Error("safety evidence changed after validation");
  const summary = {
    schemaVersion: "2026-07-16.investment-decision-local-beta-ios-uat.v1",
    ok: true,
    head: smokeGitStart.head,
    exactHeadClean: requestedUITest ? false : gitInterval.startClean && gitInterval.endClean && gitInterval.stable,
    gitInterval,
    mode: requestedUITest ? "focused" : "full",
    requestedUITest: requestedUITest || null,
    simulator: {
      udid: targetSimulatorUdid,
      deviceFamily: "iPhone",
      shutdownVerified: true
    },
    disk: {
      minimumFreeGiB: minimumFreeDiskBytes / 1024 ** 3,
      initialFreeGiB: Number(formatGiB(initialFreeDiskBytes)),
      completedFreeGiB: Number(formatGiB(finalFreeDiskBytes)),
      postCleanupFreeGiB: Number(formatGiB(postCleanupFreeDiskBytes))
    },
    tests: testExecutionEvidence,
    requestLedger,
    screenshots,
    cleanup: {
      derivedDataRemoved: true,
      resultBundlesRemoved: true,
      attachmentExportsRemoved: true
    },
    safety
  };
  await writeFile(evidenceSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  try {
    gitIntervalEvidence(smokeGitStart, await readGitState(), "iOS UI smoke summary");
  } catch (error) {
    await rm(evidenceSummaryPath, { force: true });
    throw error;
  }
}

function gitIntervalEvidence(start, end, label) {
  return requestedUITest
    ? stableGitIntervalEvidence(start, end, label)
    : cleanGitIntervalEvidence(start, end, label);
}

async function readGitState() {
  const [head, status, diff, untracked] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], { silent: true }),
    run("git", ["status", "--porcelain", "--untracked-files=all"], { silent: true }),
    run("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], { silent: true }),
    run("git", ["ls-files", "--others", "--exclude-standard", "-z"], { silent: true })
  ]);
  const worktree = createHash("sha256").update(diff.stdout);
  const untrackedPaths = untracked.stdout.split("\0").filter(Boolean).sort();
  for (const relativePath of untrackedPaths) {
    worktree.update("\0").update(relativePath).update("\0");
    worktree.update(await readFile(path.join(root, relativePath)));
  }
  return {
    head: head.stdout.trim(),
    status: status.stdout,
    worktreeSha256: worktree.digest("hex")
  };
}

async function assertFreeDiskSpace(stage) {
  const stats = await statfs(root);
  const freeBytes = stats.bavail * stats.bsize;
  if (freeBytes < minimumFreeDiskBytes) {
    throw new Error(`${stage} requires at least ${formatGiB(minimumFreeDiskBytes)} GiB free; only ${formatGiB(freeBytes)} GiB remains`);
  }
  return freeBytes;
}

function formatGiB(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

async function runXcodebuildTestWithRetry(args, destination, options) {
  const udid = destination.match(/id=([^,]+)/)?.[1];
  const resultBundlePathIndex = args.indexOf("-resultBundlePath");
  const resultBundlePath = resultBundlePathIndex >= 0 ? args[resultBundlePathIndex + 1] : null;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (udid) {
        await restartSimulator(udid);
      }
      return await run("xcodebuild", args, options);
    } catch (error) {
      lastError = error;
      const combined = `${error.stderr ?? ""}\n${error.stdout ?? ""}`;
      const retryableTimeout = options.retryTimeout === true && error.code === "ETIMEDOUT";
      const retryableLaunchFailure = retryableTimeout || (
        combined.includes("Application failed preflight checks") && combined.includes("Busy")
      ) || combined.includes("Invalid device state")
        || combined.includes("(ipc/mig) server died")
        || combined.includes("Failed to install or launch the test runner")
        || combined.includes("blessSimulatorHub failed")
        || combined.includes("Unable to lookup in current state: Shutting Down")
        || combined.includes("Early unexpected exit, operation never finished bootstrapping")
        || combined.includes("signal term before establishing connection");
      if (!retryableLaunchFailure || attempt === 3 || (retryableTimeout && attempt === 2)) {
        throw error;
      }
      if (resultBundlePath) {
        await rm(resultBundlePath, { recursive: true, force: true });
      }
      if (udid) await shutdownSimulator(udid);
      await sleep(1_000);
    }
  }
  throw lastError;
}

function recordEightQuestionCheckpoint(line) {
  const match = line.match(/EIGHT_QUESTION_CHECKPOINT\s+(\S+)\s+elapsedMs=(\d+)/);
  if (!match) return;
  const checkpoint = {
    name: match[1],
    xctestElapsedMs: Number(match[2]),
    runnerElapsedMs: eightQuestionRunStartedAt === null ? null : Date.now() - eightQuestionRunStartedAt
  };
  const prior = eightQuestionCheckpoints.at(-1);
  if (prior?.name === checkpoint.name && prior.xctestElapsedMs === checkpoint.xctestElapsedMs) return;
  eightQuestionCheckpoints.push(checkpoint);
  console.log(
    `Eight-question checkpoint ${checkpoint.name}: XCTest ${checkpoint.xctestElapsedMs}ms, runner ${checkpoint.runnerElapsedMs}ms.`
  );
}

async function writeEightQuestionProgressEvidence(outcome, error = null) {
  if (eightQuestionRunStartedAt === null) return;
  const evidence = {
    schemaVersion: "2026-07-19.ios-eight-question-progress.v1",
    test: eightQuestionUITest,
    timeoutMs: eightQuestionTimeoutMs,
    outcome,
    runnerElapsedMs: Date.now() - eightQuestionRunStartedAt,
    checkpoints: eightQuestionCheckpoints,
    lastCheckpoint: eightQuestionCheckpoints.at(-1) ?? null,
    error: error ? {
      code: error.code ?? null,
      message: error.message ?? String(error)
    } : null
  };
  await writeFile(progressEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function restartSimulator(udid) {
  await shutdownSimulator(udid);
  await run("xcrun", ["simctl", "boot", udid], { silent: true });
  await run("xcrun", ["simctl", "bootstatus", udid, "-b"], { silent: true });
  await sleep(1_000);
}

async function assertScreenshot(name) {
  const file = await readFile(path.join(screenshotDir, name));
  if (file.length < 1024) {
    throw new Error(`screenshot ${name} was not written or is too small`);
  }
}

async function run(command, args, options = {}) {
  if (options.timeoutMs) {
    return runBounded(command, args, options);
  }
  let result;
  try {
    result = await execFileAsync(command, args, {
      cwd: options.cwd ?? root,
      env: {
        ...process.env,
        ...(options.ANNUAL_RINGS_GATE_A_BASE_URL ? {
          ANNUAL_RINGS_GATE_A_BASE_URL: options.ANNUAL_RINGS_GATE_A_BASE_URL,
          ANNUAL_RINGS_GATE_A_SYMBOL: "00175.hk",
          ANNUAL_RINGS_UI_AUTH_TOKEN: "",
          ANNUAL_RINGS_UI_AUTH_HEADER: "x-internal-token",
          OS_ACTIVITY_MODE: "disable"
        } : {})
      },
      maxBuffer: 30 * 1024 * 1024
    });
  } catch (error) {
    if (!options.allowFailure) throw error;
    result = { stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
  if (!options.silent) {
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
  }
  return result;
}

function runBounded(command, args, options) {
  return new Promise((resolve, reject) => {
    const maxBuffer = 30 * 1024 * 1024;
    const processTimeoutMs = options.timeoutMs + (options.teardownGraceMs ?? 0);
    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";
    let stderrRemainder = "";
    let settled = false;
    let timedOut = false;
    let overflowed = false;
    let terminationPromise = null;
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: commandEnvironment(options),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const observeLines = (chunk, stream) => {
      const text = chunk.toString();
      if (stream === "stdout") {
        stdout += text;
        stdoutRemainder += text;
        const lines = stdoutRemainder.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? "";
        for (const line of lines) options.onOutputLine?.(line);
      } else {
        stderr += text;
        stderrRemainder += text;
        const lines = stderrRemainder.split(/\r?\n/);
        stderrRemainder = lines.pop() ?? "";
        for (const line of lines) options.onOutputLine?.(line);
      }
      if (!overflowed && Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
        overflowed = true;
        terminationPromise ??= terminateProcessGroup(child);
      }
    };
    child.stdout.on("data", (chunk) => observeLines(chunk, "stdout"));
    child.stderr.on("data", (chunk) => observeLines(chunk, "stderr"));
    const timer = setTimeout(() => {
      timedOut = true;
      terminationPromise ??= terminateProcessGroup(child);
    }, processTimeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (terminationPromise) await terminationPromise;
      } catch (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      if (stdoutRemainder) options.onOutputLine?.(stdoutRemainder);
      if (stderrRemainder) options.onOutputLine?.(stderrRemainder);
      if (timedOut || overflowed || code !== 0) {
        const reason = timedOut
          ? `${command} exceeded its hard ${processTimeoutMs}ms process deadline`
          : overflowed
            ? `${command} exceeded the ${maxBuffer}-byte output limit`
            : `${command} exited with code ${code}${signal ? ` (${signal})` : ""}`;
        const error = new Error(reason);
        error.code = timedOut ? "ETIMEDOUT" : overflowed ? "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" : code;
        error.signal = signal;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      const result = { stdout, stderr };
      if (!options.silent) {
        if (stdout.trim()) console.log(stdout.trim());
        if (stderr.trim()) console.error(stderr.trim());
      }
      resolve(result);
    });
  });
}

async function terminateProcessGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(-child.pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await sleep(50);
  }
  throw new Error(`process group ${child.pid} remained alive after SIGKILL`);
}

function commandEnvironment(options) {
  return {
    ...process.env,
    ...(options.ANNUAL_RINGS_GATE_A_BASE_URL ? {
      ANNUAL_RINGS_GATE_A_BASE_URL: options.ANNUAL_RINGS_GATE_A_BASE_URL,
      ANNUAL_RINGS_GATE_A_SYMBOL: "00175.hk",
      ANNUAL_RINGS_UI_AUTH_TOKEN: "",
      ANNUAL_RINGS_UI_AUTH_HEADER: "x-internal-token",
      OS_ACTIVITY_MODE: "disable"
    } : {})
  };
}

async function exportScreenshotsFromCurrentXcresults() {
  const entries = await readdir(resultBundleDir);
  const xcresults = entries
    .filter((entry) => entry.startsWith("ui-") && entry.endsWith(".xcresult"))
    .sort()
    .map((entry) => path.join(resultBundleDir, entry));
  if (xcresults.length === 0) {
    throw new Error("xcodebuild did not produce an xcresult bundle");
  }
  await rm(attachmentExportDir, { recursive: true, force: true });
  await mkdir(attachmentExportDir, { recursive: true });
  const allRequiredAttachments = [
    ["selected-symbol-decision-screen", "selected-symbol-decision-screen.png"],
    ["annual-review-learning-summary", "annual-review-learning-summary.png"],
    ["annual-review-learning", "annual-review-learning.png"],
    ["pingan-snapshot-unavailable", "pingan-snapshot-unavailable.png"],
    ["annual-decision-rings", "annual-decision-rings.png"],
    ["current-portfolio-neutral-risk", "current-portfolio-neutral-risk.png"],
    ["quant-decision-evidence", "quant-decision-evidence.png"],
    ["annual-decision-brief", "annual-decision-brief.png"],
    ["annual-valuation-quant", "annual-valuation-quant.png"],
    ["annual-portfolio-lab", "annual-portfolio-lab.png"],
    ["annual-conditional-decision", "annual-conditional-decision.png"],
    ["annual-conditional-decision-fail-closed", "annual-conditional-decision-fail-closed.png"],
    ["annual-review-learning-ready", "annual-review-learning-ready.png"],
    ["daily-client-resume", "daily-client-resume.png"],
    ["daily-client-recovery", "daily-client-recovery.png"],
    ["daily-workbench-compact-320", "daily-workbench-compact-320.png"],
    ["daily-workbench-standard-390", "daily-workbench-standard-390.png"],
    ["daily-workbench-large-430", "daily-workbench-large-430.png"],
    ["daily-workbench-accessibility-320", "daily-workbench-accessibility-320.png"],
    ["daily-workbench-accessibility-390", "daily-workbench-accessibility-390.png"],
    ["daily-workbench-accessibility-430", "daily-workbench-accessibility-430.png"],
    ["annual-rings-eight-question-golden", "annual-rings-eight-question-golden.png"],
    ["submitted-check-result", "submitted-check-result.png"],
    ["f1d-session-draft-formal-decision", "f1d-session-draft-formal-decision.png"],
    ["f1e-review-resolution-loop", "f1e-review-resolution-loop.png"],
    ["f1e-resolved-exact-review-9101", "f1e-resolved-exact-review-9101.png"],
    ["f1e-review-form-locked", "f1e-review-form-locked.png"],
    ["s1ab-today-freeze-return", "s1ab-today-freeze-return.png"],
    ["s1ac-today-report-save-return", "s1ac-today-report-save-return.png"],
    ["s1ad-today-report-confirmation-return", "s1ad-today-report-confirmation-return.png"]
  ];
  const focusedRequiredAttachments = {
    testAnnualReviewLearningSummaryShowsMinimumSampleBoundary: [allRequiredAttachments[1]],
    testAnnualReviewLearningSummaryShowsReadySourcesAndDrillsIntoTimeline: [allRequiredAttachments[12]],
    testAnnualRingsEightQuestionGoldenJourneyCreatesAuditedLearning: [
      ...allRequiredAttachments.slice(0, 3),
      allRequiredAttachments[21],
      allRequiredAttachments[22]
    ],
    testPinganSnapshotUnavailableShowsNoPositionRows: allRequiredAttachments.slice(3, 4),
    testCurrentPortfolioNeutralRiskClearsFactsAfterBlockedRecalculation: allRequiredAttachments.slice(4, 6),
    testQuantDecisionEvidenceRefinementShowsBoundedSamplesAndExecution: allRequiredAttachments.slice(6, 7),
    testAnnualDecisionBriefGoldenJourneyKeepsResearchLayersAndNoTradingSemantics: [
      allRequiredAttachments[4],
      allRequiredAttachments[7]
    ],
    testAnnualValuationQuantGoldenJourneyRecomputesAndClearsStaleResults: allRequiredAttachments.slice(8, 9),
    testAnnualPortfolioLabGoldenJourneyBindsOrderedScenariosAndClearsChangedAmounts: allRequiredAttachments.slice(9, 10),
    testAnnualConditionalDecisionGoldenJourneyFreezesBoundFactsAndRejectsStalePreview: allRequiredAttachments.slice(10, 12),
    testDailyClientColdLaunchRestoresNavigationAndRereadsFacts: allRequiredAttachments.slice(13, 14),
    testDailyClientRetryRecoversUnauthorizedAndOfflineSources: allRequiredAttachments.slice(14, 15),
    testDailyWorkbenchCompactStandardAndLargeLayoutsRemainContained: allRequiredAttachments.slice(15, 18),
    testDailyWorkbenchAccessibilityTextKeepsLayerMenuAndActionsReachable: allRequiredAttachments.slice(18, 21),
    testF1DSessionDraftAdoptSubmitRefreshesTodayOnce: allRequiredAttachments.slice(23, 27),
    [s1abUITest]: [allRequiredAttachments.at(-3)],
    [s1acUITest]: [allRequiredAttachments.at(-2)],
    [s1adUITest]: [allRequiredAttachments.at(-1)]
  };
  const requiredAttachments = new Map(requestedUITest
    ? focusedRequiredAttachments[requestedUITest] ?? []
    : allRequiredAttachments);
  for (const [index, xcresult] of xcresults.entries()) {
    const exportDir = path.join(attachmentExportDir, String(index));
    await mkdir(exportDir, { recursive: true });
    await run("xcrun", [
      "xcresulttool",
      "export",
      "attachments",
      "--path",
      xcresult,
      "--output-path",
      exportDir
    ], { silent: true });
    const manifest = JSON.parse(await readFile(path.join(exportDir, "manifest.json"), "utf8"));
    const attachments = collectAttachments(manifest);
    for (const [attachmentName, outputName] of [...requiredAttachments]) {
      const match = attachments.find((attachment) => (
        attachment.name === attachmentName || attachment.name.startsWith(`${attachmentName}_`)
      ) && attachment.filename);
      if (!match) {
        continue;
      }
      const outputPath = path.join(screenshotDir, outputName);
      await copyFile(path.join(exportDir, match.filename), outputPath);
      if (landscapeScreenshotOutputNames.has(outputName)) {
        await normalizeLandscapeScreenshot(outputPath);
      }
      requiredAttachments.delete(attachmentName);
    }
  }
  if (requiredAttachments.size > 0) {
    throw new Error(`xcresult attachments were not exported: ${[...requiredAttachments.keys()].join(", ")}`);
  }
}

async function normalizeLandscapeScreenshot(file) {
  const normalizedFile = `${file}.normalized.png`;
  await rm(normalizedFile, { force: true });
  try {
    await run("sips", ["-r", "-90", file, "--out", normalizedFile], { silent: true });
    const bytes = await readFile(normalizedFile);
    if (bytes.length < 24
      || bytes.readUInt32BE(8) !== 13
      || bytes.toString("ascii", 12, 16) !== "IHDR"
      || bytes.readUInt32BE(16) <= bytes.readUInt32BE(20)) {
      throw new Error(`landscape screenshot normalization did not produce a landscape PNG: ${file}`);
    }
    await rename(normalizedFile, file);
  } finally {
    await rm(normalizedFile, { force: true });
  }
}

function collectAttachments(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectAttachments);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const name = value.name ?? value.suggestedHumanReadableName;
  const filename = value.filename ?? value.exportedFileName;
  const current = typeof name === "string" && typeof filename === "string"
    ? [{ name, filename }]
    : [];
  return current.concat(Object.values(value).flatMap(collectAttachments));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function respond(res, statusCode, body) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

function respondFocusedF1C(req, res, statusCode, body) {
  if (isExecutingUITest("testF1CTodayReviewDueOpensExactResearchReviewLayer")
    && req.method === "GET"
    && focusedF1CExactReadCounts.has(req.url)) {
    focusedF1CResponseLedger.push({
      method: req.method,
      url: req.url,
      statusCode,
      envelope: structuredClone(body)
    });
  }
  respond(res, statusCode, body);
}

function listen(instance, portNumber) {
  return new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(portNumber, "127.0.0.1", () => {
      instance.off("error", reject);
      resolve();
    });
  });
}

function close(instance) {
  if (!instance.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    instance.close((error) => error ? reject(error) : resolve());
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method} ${url} returned ${response.status}: ${body}`);
  }
  return JSON.parse(body);
}
