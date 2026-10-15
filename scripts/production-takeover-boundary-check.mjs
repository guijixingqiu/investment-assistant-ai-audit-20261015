#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const files = {
  server: read("apps/api/src/server.ts"),
  mobileMarket: read("apps/api/src/routes/mobileMarket.ts"),
  mobileResearch: read("apps/api/src/routes/mobileResearch.ts"),
  candidateMembershipRoutes: read("apps/api/src/routes/candidateMembershipRoutes.ts"),
  internalResearchRoutes: read("apps/api/src/routes/internalResearchRoutes.ts"),
  pinganHistoricalRoutes: read("apps/api/src/routes/pinganHistoricalRoutes.ts"),
  assistWorkflowRoutes: read("apps/api/src/routes/assistWorkflowRoutes.ts"),
  decisionContextRoutes: read("apps/api/src/routes/decisionContextRoutes.ts"),
  researchProfileRoutes: read("apps/api/src/routes/researchProfileRoutes.ts"),
  decisionReviewRoutes: read("apps/api/src/routes/decisionReviewRoutes.ts"),
  deepResearchRoutes: read("apps/api/src/routes/deepResearchRoutes.ts"),
  researchEvidenceQuestionRoute: read("apps/api/src/routes/researchEvidenceQuestionRoute.ts"),
  researchEvidenceQuestionRepository: read("apps/api/src/research/researchEvidenceQuestionRepository.ts"),
  deepResearchTaskRouteHandlers: read("apps/api/src/routes/deepResearchTaskRouteHandlers.ts"),
  researchDocumentRoutes: read("apps/api/src/routes/researchDocumentRoutes.ts"),
  researchFundamentalRoutes: read("apps/api/src/routes/researchFundamentalRoutes.ts"),
  researchValuationScenarioRoutes: read("apps/api/src/routes/researchValuationScenarioRoutes.ts"),
  researchAuth: read("apps/api/src/routes/researchAuth.ts"),
  researchRouteValidation: read("apps/api/src/routes/researchRouteValidation.ts"),
  config: read("apps/api/src/config.ts"),
  aiSuggestionDecisionRepository: read("apps/api/src/research/aiSuggestionDecisionRepository.ts"),
  dataGateReconcile: read("scripts/data-gate-sample-reconcile.mjs"),
  gateBMigration: read("db/migrations/002_gate_b_research_loop.sql"),
  dataGateMigration: read("db/migrations/003_data_gate_sample_facts.sql")
};

const routeSources = {
  "apps/api/src/server.ts": files.server,
  "apps/api/src/routes/mobileMarket.ts": files.mobileMarket,
  "apps/api/src/routes/mobileResearch.ts": files.mobileResearch,
  "apps/api/src/routes/candidateMembershipRoutes.ts": files.candidateMembershipRoutes,
  "apps/api/src/routes/internalResearchRoutes.ts": files.internalResearchRoutes,
  "apps/api/src/routes/pinganHistoricalRoutes.ts": files.pinganHistoricalRoutes,
  "apps/api/src/routes/assistWorkflowRoutes.ts": files.assistWorkflowRoutes,
  "apps/api/src/routes/decisionContextRoutes.ts": files.decisionContextRoutes,
  "apps/api/src/routes/researchProfileRoutes.ts": files.researchProfileRoutes,
  "apps/api/src/routes/decisionReviewRoutes.ts": files.decisionReviewRoutes,
  "apps/api/src/routes/deepResearchRoutes.ts": files.deepResearchRoutes,
  "apps/api/src/routes/researchEvidenceQuestionRoute.ts": files.researchEvidenceQuestionRoute,
  "apps/api/src/routes/researchDocumentRoutes.ts": files.researchDocumentRoutes,
  "apps/api/src/routes/researchFundamentalRoutes.ts": files.researchFundamentalRoutes,
  "apps/api/src/routes/researchValuationScenarioRoutes.ts": files.researchValuationScenarioRoutes
};

const routes = Object.entries(routeSources).flatMap(([file, source]) => extractRoutes(file, source));
const readOnlyPostRoutes = new Set(["post /api/mobile/market/discovery/qualifications"]);
const writeRoutes = routes.filter((route) =>
  route.method !== "get" && !readOnlyPostRoutes.has(`${route.method} ${route.path}`)
);

assertEvidenceQuestionWriteBoundary(files.researchEvidenceQuestionRoute, files.researchEvidenceQuestionRepository, files.config);
assertMarketDiscoveryQualificationReadBoundary(files.mobileMarket, files.config);
assertNoForbiddenMobileWrites(writeRoutes);
assertAllowedWriteRoutes(writeRoutes);
assertWriteAuthBoundary(`${files.candidateMembershipRoutes}\n${files.researchProfileRoutes}\n${files.decisionReviewRoutes}\n${files.deepResearchRoutes}\n${files.researchEvidenceQuestionRoute}\n${files.deepResearchTaskRouteHandlers}\n${files.researchDocumentRoutes}\n${files.researchFundamentalRoutes}\n${files.researchValuationScenarioRoutes}`, files.researchAuth, files.config);
assert.match(`${files.deepResearchRoutes}\n${files.deepResearchTaskRouteHandlers}`, /actor\.actorType !== "user"[\s\S]*explicit user-scoped actor/);
assertMarketRefreshBoundary(files.mobileMarket);
assertSeedFixtureBoundary(files.internalResearchRoutes, files.researchRouteValidation);
assertSuggestionDecisionBoundary(files.internalResearchRoutes, files.aiSuggestionDecisionRepository);
assertDataGateDoesNotFabricateOutOfScopeFacts(files.dataGateReconcile, files.dataGateMigration);

const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  productionTakeoverScope: {
    allowedWrites: [
      "PUT /api/mobile/research/profiles/:market/:code updates a research profile with audit",
      "POST /api/mobile/research/profiles/:market/:code/evidence creates evidence with audit",
      "POST /api/mobile/research/profiles/:market/:code/decision-checks creates a pre-trade decision check with audit",
      "POST /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews appends an actor-scoped review with audit",
      "POST /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/deletion removes one user-owned formal-decision body while preserving its tombstone",
      "POST /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews/:reviewId/deletion removes one user-owned review body while preserving its tombstone",
      "POST /api/mobile/research/candidate-memberships creates an actor-scoped candidate membership with audit",
      "PATCH /api/mobile/research/candidate-memberships/:id/state updates actor-scoped candidate state with audit",
      "POST /api/mobile/research/profiles/:market/:code/materials creates traceable research-only material with audit",
      "POST /api/mobile/research/candidate-memberships/:id/documents imports one user-authorized PDF with audit and research-only provenance",
      "POST /api/mobile/research/candidate-memberships/:id/documents/:documentId/confirmed-facts creates one cited unverified issuer statement with audit",
      "POST /api/mobile/research/candidate-memberships/:id/materials/:materialId/deletion removes one user-owned material body while preserving its tombstone and audit",
      "POST /api/mobile/research/candidate-memberships/:id/fundamentals appends one cited unverified Owner-transcribed issuer value with audit",
      "POST /api/mobile/research/candidate-memberships/:id/valuation-scenarios appends one cited advisory-only Owner-assumption scenario with audit",
      "POST /api/mobile/research/candidate-memberships/:id/evidence-packs freezes a content-addressed research-only pack with audit",
      "POST /api/mobile/research/candidate-memberships/:id/deep-research-tasks enqueues one actor-scoped research-only task with audit",
      "POST /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/retry explicitly retries one user-scoped research-only task",
      "POST /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/absorb explicitly absorbs one user-scoped research-only synthesis into a report",
      "POST /api/mobile/research/candidate-memberships/:id/deep-research-reports creates a gated research-only report with audit",
      "POST /api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/decisions records an explicit user-scoped decision with audit",
      "POST /api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/deletion removes one user-owned report body while preserving its tombstone",
      "POST /api/mobile/research/candidate-memberships/:id/research-events creates an evidence-bound research-only event with audit",
      "POST /api/mobile/research/candidate-memberships/:id/geely-sales-monitors creates a deterministic research-only pilot result with audit",
      "POST /api/mobile/research/candidate-memberships/:id/gcl-pv-price-monitors creates a deterministic research-only pilot result with audit",
      "POST /api/mobile/research/candidate-memberships/:id/evidence-questions sends one explicit Owner question and persists only its idempotency audit",
      "POST /api/internal/research/suggestions/:id/decision records accepted/rejected AI suggestion decisions only",
      "POST /api/internal/market/refresh/:market/:code refreshes candidate market quotes",
      "POST /api/internal/research/seed-fixture remains an internal fixture/testing route"
    ],
    readOnlyOrMigratedFacts: [
      "POST /api/mobile/market/discovery/qualifications performs one read-authorized, non-persisted current-candidate qualification",
      "research_profiles",
      "evidence_items",
      "research_materials",
      "research_fundamental_values",
      "research_valuation_scenario_sets",
      "research_evidence_packs",
      "deep_research_tasks",
      "deep_research_reports",
      "deep_research_report_decisions",
      "research_events",
      "geely_sales_monitor_runs",
      "gcl_pv_price_monitor_runs",
      "portfolio_positions",
      "pre_trade_decision_checks",
      "migrated_research_events",
      "legacy_research_events"
    ],
    explicitlyOutOfScopeWrites: [
      "/api/mobile/trades*",
      "/api/mobile/positions*",
      "/api/mobile/reviews*",
      "true trades",
      "true positions",
      "reviews"
    ]
  },
  routes,
  checks: [
    "No mobile write route exists for trades, positions, or standalone portfolio reviews.",
    "The evidence-question POST requires research-write authorization and persists only an idempotency audit, never report or portfolio facts.",
    "The discovery-qualification POST is read-authorized, development-only when configured, and performs no repository write.",
    "Mobile writes are limited to candidate membership, research evidence/deep-research workflow, decision-check, and append-only decision-review paths.",
    "Deep-research final decisions require an explicit user-scoped actor and cannot mutate portfolio or trading facts.",
    "Staging/production write auth is enabled by default and enforced with separate candidate, research, and review scopes.",
    "Internal market refresh rejects request bodies and protected client metadata before provider or repository access.",
    "Internal seed-fixture rejects request bodies and protected client metadata before repository access.",
    "AI suggestion decisions accept only accepted/rejected.",
    "AI suggestion decisions insert an audit row.",
    "AI suggestion decisions do not update research_profiles.current_thesis.",
    "Data gate importer asserts trades/reviews are empty and does not insert them."
  ]
};

console.log(JSON.stringify(report, null, 2));

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function extractRoutes(file, source) {
  const routes = [];
  const routePattern = /app\.(get|post|put|patch|delete)\(\s*["`]([^"`]+)["`]/g;
  let match;
  while ((match = routePattern.exec(source)) !== null) {
    routes.push({ file, method: match[1], path: match[2] });
  }
  const objectRoutePattern = /app\.route\(\s*\{[\s\S]*?method:\s*["`](GET|POST|PUT|PATCH|DELETE)["`][\s\S]*?url:\s*["`]([^"`]+)["`][\s\S]*?\}\s*\);/g;
  while ((match = objectRoutePattern.exec(source)) !== null) {
    routes.push({ file, method: match[1].toLowerCase(), path: match[2] });
  }
  return routes;
}

function assertEvidenceQuestionWriteBoundary(routeSource, repositorySource, configSource) {
  const routePath = "/api/mobile/research/candidate-memberships/:id/evidence-questions";
  const route = extractRouteHandler(routeSource, routePath);
  assert.match(route, /authenticateWrite\(request\.headers, options, "research_write"\)/);
  assert.match(route, /readDeepResearchWorkspace/);
  assert.match(route, /generateResearchEvidenceQuestionWithAi/);
  assert.match(route, /runIdempotentResearchEvidenceQuestion/);
  assert.match(repositorySource, /insertWriteAudit/);
  assert.doesNotMatch(repositorySource, /insert\s+into\s+(?:deep_research_reports|research_materials|portfolio_positions|pre_trade_decision_checks)/i);
  assert.match(configSource, /RESEARCH_AI_API_KEY may only be enabled when NODE_ENV=development/);
}

function assertMarketDiscoveryQualificationReadBoundary(routeSource, configSource) {
  const route = extractRouteHandler(routeSource, "/api/mobile/market/discovery/qualifications");
  assert.match(route, /authenticateReadOnly\(request\.headers, researchAuthOptions\(options\)\)/);
  assert.doesNotMatch(route, /authenticateWrite/);
  assert.match(route, /options\.discoveryProvider\?\.read\(/);
  assert.match(route, /generateMarketDiscoveryQualification/);
  assert.doesNotMatch(route, /options\.pool|\b(?:create|insert|update|delete)\b/i);
  assert.match(configSource, /RESEARCH_AI_API_KEY may only be enabled when NODE_ENV=development/);
}

function assertNoForbiddenMobileWrites(writeRoutes) {
  const allowedMobileWrites = new Set([
    "put /api/mobile/research/profiles/:market/:code",
    "post /api/mobile/research/profiles/:market/:code/evidence",
    "post /api/mobile/research/profiles/:market/:code/decision-checks",
    "post /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews",
    "post /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/deletion",
    "post /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews/:reviewId/deletion",
    "post /api/mobile/research/candidate-memberships",
    "patch /api/mobile/research/candidate-memberships/:id/state",
    "post /api/mobile/research/profiles/:market/:code/materials",
    "post /api/mobile/research/candidate-memberships/:id/documents",
    "post /api/mobile/research/candidate-memberships/:id/documents/:documentId/confirmed-facts",
    "post /api/mobile/research/candidate-memberships/:id/materials/:materialId/deletion",
    "post /api/mobile/research/candidate-memberships/:id/fundamentals",
    "post /api/mobile/research/candidate-memberships/:id/valuation-scenarios",
    "post /api/mobile/research/candidate-memberships/:id/evidence-packs",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/retry",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/absorb",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/cancel",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-reports",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/decisions",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/deletion",
    "post /api/mobile/research/candidate-memberships/:id/research-events",
    "post /api/mobile/research/candidate-memberships/:id/geely-sales-monitors",
    "post /api/mobile/research/candidate-memberships/:id/gcl-pv-price-monitors",
    "post /api/mobile/research/candidate-memberships/:id/evidence-questions"
  ]);
  const forbiddenMobileWrites = writeRoutes.filter((route) =>
    route.path.startsWith("/api/mobile/")
    && !allowedMobileWrites.has(`${route.method} ${route.path}`)
  );
  assert.deepEqual(
    forbiddenMobileWrites,
    [],
    `candidate must not expose mobile production writes for core facts: ${JSON.stringify(forbiddenMobileWrites)}`
  );
}

function assertAllowedWriteRoutes(writeRoutes) {
  const allowed = new Set([
    "put /api/mobile/research/profiles/:market/:code",
    "post /api/mobile/research/profiles/:market/:code/evidence",
    "post /api/mobile/research/profiles/:market/:code/decision-checks",
    "post /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews",
    "post /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/deletion",
    "post /api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews/:reviewId/deletion",
    "post /api/mobile/research/candidate-memberships",
    "patch /api/mobile/research/candidate-memberships/:id/state",
    "post /api/mobile/research/profiles/:market/:code/materials",
    "post /api/mobile/research/candidate-memberships/:id/documents",
    "post /api/mobile/research/candidate-memberships/:id/documents/:documentId/confirmed-facts",
    "post /api/mobile/research/candidate-memberships/:id/materials/:materialId/deletion",
    "post /api/mobile/research/candidate-memberships/:id/fundamentals",
    "post /api/mobile/research/candidate-memberships/:id/valuation-scenarios",
    "post /api/mobile/research/candidate-memberships/:id/evidence-packs",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/retry",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/absorb",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/cancel",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-reports",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/decisions",
    "post /api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/deletion",
    "post /api/mobile/research/candidate-memberships/:id/research-events",
    "post /api/mobile/research/candidate-memberships/:id/geely-sales-monitors",
    "post /api/mobile/research/candidate-memberships/:id/gcl-pv-price-monitors",
    "post /api/mobile/research/candidate-memberships/:id/evidence-questions",
    "post /api/internal/market/refresh/:market/:code",
    "post /api/internal/research/seed-fixture",
    "post /api/internal/research/suggestions/:id/decision"
  ]);
  const actual = writeRoutes.map((route) => `${route.method} ${route.path}`).sort();
  assert.deepEqual(actual, [...allowed].sort(), `unexpected write route set: ${JSON.stringify(actual)}`);
}

function assertWriteAuthBoundary(routeSource, authSource, configSource) {
  assert.match(configSource, /requireWriteAuth/);
  assert.match(configSource, /NODE_ENV[\s\S]*!== "development"/);
  assert.match(configSource, /WRITE_API_TOKEN/);
  assert.match(configSource, /INTERNAL_API_TOKEN/);
  assert.match(configSource, /RESEARCH_WRITE_ACTOR_ID/);
  assert.match(routeSource, /authenticateWrite\(request\.headers, options, "candidate_write"\)/);
  assert.match(routeSource, /authenticateWrite\(request\.headers, options, "research_write"\)/);
  assert.match(routeSource, /authenticateWrite\(request\.headers, options, "review_write"\)/);
  assert.match(routeSource, /const actor = authenticateWrite\(request\.headers, options, "(?:candidate|research|review)_write"\)/);
  assert.match(routeSource, /createDecisionCheck\([\s\S]*actor,[\s\S]*options\.quoteLiveMaxAgeSeconds/);
  assert.match(routeSource, /write authorization required/);
  assert.match(authSource, /options\.requireWriteAuth/);
}

function assertMarketRefreshBoundary(routeSource) {
  const route = extractRouteHandler(routeSource, "/api/internal/market/refresh/:market/:code");
  assert.match(route, /authenticateWrite\(request\.headers, options\)/);
  assert.match(route, /write authorization required/);
  assert.match(route, /validateInternalMarketRefreshBody\(request\.body\)/);
  assert.match(route, /bodyErrors\.length > 0/);
  const validator = extractFunction(routeSource, "validateInternalMarketRefreshBody");
  assert.match(validator, /"actorType", "actorId", "correlationId"/);
  assert.match(validator, /"source", "audit", "metadata", "rawPayload"/);
  assert.match(validator, /market refresh request body must be empty/);
}

function assertSeedFixtureBoundary(routeSource, validationSource) {
  const route = extractRouteHandler(routeSource, "/api/internal/research/seed-fixture");
  assert.match(route, /authenticateWrite\(request\.headers, options\)/);
  assert.match(route, /write authorization required/);
  assert.match(route, /validateInternalSeedFixtureBody\(request\.body\)/);
  assert.match(route, /bodyErrors\.length > 0/);
  const validator = extractFunction(validationSource, "validateInternalSeedFixtureBody");
  assert.match(validator, /rejectClientControlledAuditFields\(value\)/);
  assert.match(validator, /"source", "audit", "metadata", "rawPayload"/);
  assert.match(validator, /seed-fixture request body must be empty/);
}

function assertSuggestionDecisionBoundary(routeSource, repositorySource) {
  assert.match(routeSource, /suggestion id must be a positive integer/);
  assert.match(routeSource, /rejectClientControlledAuditFields\(bodyRecord\)/);
  assert.match(routeSource, /bodyRecord\.action !== "accepted" && bodyRecord\.action !== "rejected"/);
  assert.match(routeSource, /action must be accepted or rejected/);
  assert.match(routeSource, /note must be null or a string/);
  assert.match(routeSource, /The current thesis was not auto-modified/);

  const decisionFunction = extractFunction(repositorySource, "decideAiSuggestion");
  assert.match(decisionFunction, /update ai_update_suggestions/);
  assert.match(decisionFunction, /insert into ai_suggestion_decisions/);
  assert.doesNotMatch(decisionFunction, /research_profiles/i);
  assert.doesNotMatch(decisionFunction, /current_thesis/i);
}

function extractRouteHandler(source, routePath) {
  const start = source.indexOf(`app.post("${routePath}"`);
  assert.notEqual(start, -1, `route ${routePath} not found`);
  const nextRoute = source.indexOf("\n  app.", start + 1);
  return source.slice(start, nextRoute === -1 ? undefined : nextRoute);
}

function assertDataGateDoesNotFabricateOutOfScopeFacts(reconcileSource, migrationSource) {
  assert.match(reconcileSource, /must not fabricate trades/);
  assert.match(reconcileSource, /must not fabricate reviews/);
  assert.doesNotMatch(reconcileSource, /insert\s+into\s+(?:public\.)?trades\b/i);
  assert.doesNotMatch(reconcileSource, /insert\s+into\s+(?:public\.)?reviews\b/i);
  assert.doesNotMatch(migrationSource, /create\s+table\s+(?:if\s+not\s+exists\s+)?trades\b/i);
  assert.doesNotMatch(migrationSource, /create\s+table\s+(?:if\s+not\s+exists\s+)?reviews\b/i);
}

function extractFunction(source, exportedName) {
  let start = source.indexOf(`export async function ${exportedName}`);
  if (start === -1) start = source.indexOf(`function ${exportedName}`);
  assert.notEqual(start, -1, `function ${exportedName} not found`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  const candidates = [nextFunction, nextExport].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : undefined;
  return source.slice(start, end);
}
