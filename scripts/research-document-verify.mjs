#!/usr/bin/env node
import { deepResearchPackBinding } from "../dist/packages/contracts/src/limitedResearch.js";
import { validateDeepResearchSnapshotData } from "../dist/packages/contracts/src/deepResearchSnapshot.js";
import { synthesizedDeepResearchReportIntegrityFailures } from "../dist/apps/api/src/research/deepResearchGate.js";
import { deepResearchReportSummary } from "../dist/apps/web/src/deepResearchReportSummary.js";
import { CLOUD_AI_PROVIDER_POLICY_VERSION } from "../dist/packages/contracts/src/cloudAiPolicy.js";
import { runDeepResearchTaskOnce } from "../dist/apps/api/src/research/deepResearchTaskRunner.js";
import { claimDeepResearchTask, bindDeepResearchTaskSnapshot, storeDeepResearchTaskSynthesis, failDeepResearchTask } from "../dist/apps/api/src/research/deepResearchTaskRepository.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { completedWeekEnd, frozenWeinsteinEvidenceBinding } from "../dist/packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { evidenceBoundReportPackBinding } from "../dist/packages/contracts/src/deepResearch.js";
import { defaultDeepResearchTaskIntent } from "../dist/packages/contracts/src/deepResearchTask.js";
import { computeDeepResearchSnapshotId, deepResearchSnapshotHashInput } from "../dist/packages/contracts/src/deepResearchSnapshot.js";
import { DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION } from "../dist/packages/contracts/src/deepResearchSynthesisReport.js";
import { readCurrentDeepResearchSnapshot } from "../dist/apps/api/src/research/deepResearchSnapshotAssembler.js";
import { deepResearchProviderAuthorizationFingerprint } from "../dist/apps/api/src/research/deepResearchGate.js";
import { generateDeepResearchSynthesisWithAi } from "../dist/apps/api/src/research/deepResearchSynthesisAi.js";
import { createDeepResearchReportInTransaction } from "../dist/apps/api/src/research/deepResearchReportRepository.js";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { buildServer } from "../dist/apps/api/src/server.js";
import { latestCompletedHongKongSession } from "../dist/apps/api/src/market/dailyBarsRepository.js";
import { importResearchDocument } from "../dist/apps/api/src/research/researchDocumentWriteRepository.js";
import { createScopedResearchToken } from "../dist/apps/api/src/routes/researchAuth.js";
import { runMigrations } from "./migration-runner.mjs";
import { resolveLocalPostgresEndpoint } from "./gate-b-verify.mjs";
import { persistResearchFrozenTechnicalFixture } from "./research-frozen-technical-fixture.mjs";

const endpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const databaseName = `annual_rings_research_document_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const databaseUrl = localDatabaseUrl(databaseName);
const rawStoreRoot = await mkdtemp(join(tmpdir(), "annual-rings-research-document-raw-"));
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const authSigningKey = "research-document-local-verification-key";
const nowSeconds = Math.floor(Date.now() / 1_000);
const ownerToken = token("owner-local", ["read", "candidate_write", "research_write"]);
const otherActorToken = token("other-owner", ["read", "candidate_write", "research_write"]);
const headers = { "x-internal-token": ownerToken };
const otherHeaders = { "x-internal-token": otherActorToken };
const pdfBytes = fixturePdf([
  "Unique quote. Repeated quote. Repeated quote.",
  "Second page quote.",
  ""
]);
const metadata = {
  membershipVersion: 1,
  title: "Owner official fixture PDF",
  publishedAt: "2026-07-01T00:00:00.000Z",
  sourceVersion: "fixture-v1",
  rightsConfirmed: true,
  idempotencyKey: "document-import-1"
};
let app;
let pool;
let currentWeinstein;
let currentValuationMethods;
const weeklyBridge = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/weinstein-weekly" || url.searchParams.get("ticker") !== "09926") {
    res.writeHead(404).end(); return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, input: weeklyFixture(url.searchParams.get("analysisAsOf")) }));
});

try {
  postgres("createdb", [databaseName]);
  pool = new Pool({ connectionString: databaseUrl, max: 2, ssl: false });
  const firstMigration = await runMigrations(pool, { log: () => {} });
  assert.equal(firstMigration.applied.includes("019_research_pdf_documents.sql"), true);
  assert.equal(firstMigration.applied.includes("021_research_valuation_scenarios.sql"), true);
  const replayMigration = await runMigrations(pool, { log: () => {} });
  assert.equal(replayMigration.skipped.includes("019_research_pdf_documents.sql"), true);
  assert.equal(replayMigration.skipped.includes("021_research_valuation_scenarios.sql"), true);

  if (!weeklyBridge.listening) await new Promise((resolve) => weeklyBridge.listen(0, "127.0.0.1", resolve));
  app = await buildServer(serverConfig());

  const membership = await request("POST", "/api/mobile/research/candidate-memberships", {
    market: "HK",
    code: "09926",
    initialState: "tracked",
    idempotencyKey: "research-document-membership"
  }, 201);
  const membershipId = membership.data.id;
  metadata.membershipVersion = membership.data.version;

  const imported = await importPdf(membershipId, metadata, pdfBytes);
  assert.equal(imported.statusCode, 200, imported.body);
  const created = imported.json();
  assert.equal(created.data.result, "created");
  const document = created.data.document;
  assert.deepEqual({
    membershipId: document.membershipId,
    membershipVersionAtImport: document.membershipVersionAtImport,
    symbol: document.symbol,
    parserName: document.parserName,
    parserVersion: document.parserVersion,
    normalizationVersion: document.normalizationVersion,
    sourceClassification: document.sourceClassification,
    rightsStatus: document.rightsStatus,
    rightsDeclarationVersion: document.rightsDeclarationVersion,
    sourceState: document.sourceState
  }, {
    membershipId,
    membershipVersionAtImport: metadata.membershipVersion,
    symbol: "HK.09926",
    parserName: "pdfjs-dist",
    parserVersion: "6.2.108",
    normalizationVersion: "nfkc-whitespace-v1",
    sourceClassification: "owner_declared_official",
    rightsStatus: "user_provided",
    rightsDeclarationVersion: "owner-local-processing-rights-v1",
    sourceState: "available"
  });

  const importReplay = await importPdf(membershipId, metadata, pdfBytes);
  assert.equal(importReplay.statusCode, 200);
  assert.equal(importReplay.json().data.document.id, document.id);
  const idempotencyConflict = await importPdf(membershipId, { ...metadata, title: "Changed title" }, pdfBytes);
  assert.equal(idempotencyConflict.statusCode, 409);
  const deduplicated = await importPdf(
    membershipId,
    { ...metadata, idempotencyKey: "document-import-deduplicated" },
    pdfBytes
  );
  assert.equal(deduplicated.statusCode, 200);
  assert.equal(deduplicated.json().data.result, "deduplicated");
  assert.equal(deduplicated.json().data.document.id, document.id);
  const deduplicatedReplay = await importPdf(
    membershipId,
    { ...metadata, idempotencyKey: "document-import-deduplicated" },
    pdfBytes
  );
  assert.equal(deduplicatedReplay.statusCode, 200);
  assert.equal(deduplicatedReplay.json().data.document.id, document.id);
  const changedPdfAfterDedup = await importPdf(
    membershipId,
    { ...metadata, idempotencyKey: "document-import-deduplicated" },
    fixturePdf(["A different PDF cannot reuse the consumed dedup key."])
  );
  assert.equal(changedPdfAfterDedup.statusCode, 409);
  const metadataConflict = await importPdf(
    membershipId,
    { ...metadata, title: "Different semantic title", idempotencyKey: "document-import-metadata-conflict" },
    pdfBytes
  );
  assert.equal(metadataConflict.statusCode, 409);
  assert.equal(metadataConflict.json().code, "DOCUMENT_METADATA_CONFLICT");

  const initialList = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/documents`);
  assert.equal(initialList.documents.length, 1);
  assert.equal(initialList.documents[0].sourceState, "available");
  assert.deepEqual(initialList.materials, []);
  const page1 = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/documents/${document.id}/pages/1`);
  assert.equal(page1.normalizedText, "Unique quote. Repeated quote. Repeated quote.");
  const blankPage = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/documents/${document.id}/pages/3`);
  assert.equal(blankPage.normalizedText, "");
  const raw = await app.inject({
    method: "GET",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents/${document.id}/content`,
    headers
  });
  assert.equal(raw.statusCode, 200);
  assert.deepEqual(raw.rawPayload, pdfBytes);

  const concurrentPdf = fixturePdf(["Concurrent content-addressed import."]);
  const concurrentMetadata = {
    ...metadata,
    title: "Concurrent official fixture PDF",
    sourceVersion: "fixture-concurrent-v1"
  };
  const concurrentImports = await Promise.all([
    importPdf(membershipId, { ...concurrentMetadata, idempotencyKey: "document-import-concurrent-1" }, concurrentPdf),
    importPdf(membershipId, { ...concurrentMetadata, idempotencyKey: "document-import-concurrent-2" }, concurrentPdf)
  ]);
  assert.deepEqual(concurrentImports.map((response) => response.statusCode), [200, 200]);
  assert.deepEqual(
    concurrentImports.map((response) => response.json().data.result).sort(),
    ["created", "deduplicated"]
  );
  assert.equal(
    new Set(concurrentImports.map((response) => response.json().data.document.id)).size,
    1
  );

  const absentQuote = await confirm(membershipId, document.id, {
    membershipVersion: metadata.membershipVersion,
    pageNumber: 1,
    quote: "Absent quote",
    statement: "Absent statement",
    validUntil: "2027-07-01T00:00:00.000Z",
    idempotencyKey: "confirm-absent"
  });
  assert.equal(absentQuote.statusCode, 422);
  assert.equal(absentQuote.json().code, "QUOTE_NOT_UNIQUE");
  const multipleQuote = await confirm(membershipId, document.id, {
    membershipVersion: metadata.membershipVersion,
    pageNumber: 1,
    quote: "Repeated quote",
    statement: "Repeated statement",
    validUntil: "2027-07-01T00:00:00.000Z",
    idempotencyKey: "confirm-multiple"
  });
  assert.equal(multipleQuote.statusCode, 422);
  assert.equal(multipleQuote.json().code, "QUOTE_NOT_UNIQUE");
  const blankQuote = await confirm(membershipId, document.id, {
    membershipVersion: metadata.membershipVersion,
    pageNumber: 3,
    quote: "anything",
    statement: "Blank page statement",
    validUntil: "2027-07-01T00:00:00.000Z",
    idempotencyKey: "confirm-blank"
  });
  assert.equal(blankQuote.statusCode, 422);
  assert.equal(blankQuote.json().code, "PAGE_TEXT_UNAVAILABLE");

  const firstConfirmPayload = {
    membershipVersion: metadata.membershipVersion,
    pageNumber: 1,
    quote: "Unique quote. Repeated quote. Repeated quote.",
    statement: "The issuer included the unique quote.",
    validUntil: "2027-07-01T00:00:00.000Z",
    idempotencyKey: "confirm-page-1"
  };
  const firstConfirm = await confirm(membershipId, document.id, firstConfirmPayload);
  assert.equal(firstConfirm.statusCode, 200);
  const firstMaterial = firstConfirm.json().data;
  assert.equal(firstMaterial.contentText, firstConfirmPayload.quote);
  assert.equal(firstMaterial.summary, firstConfirmPayload.statement);
  assert.deepEqual({
    claimType: firstMaterial.claimType,
    verificationStatus: firstMaterial.verificationStatus,
    rightsStatus: firstMaterial.rightsStatus,
    stance: firstMaterial.stance,
    reliability: firstMaterial.reliability,
    materiality: firstMaterial.materiality,
    citation: firstMaterial.citation
  }, {
    claimType: "issuer_statement",
    verificationStatus: "unverified",
    rightsStatus: "user_provided",
    stance: "neutral",
    reliability: null,
    materiality: null,
    citation: {
      documentId: document.id,
      pageNumber: 1,
      pageTextSha256: page1.pageTextSha256
    }
  });
  const confirmReplay = await confirm(membershipId, document.id, firstConfirmPayload);
  assert.equal(confirmReplay.statusCode, 200);
  assert.equal(confirmReplay.json().data.id, firstMaterial.id);
  const confirmConflict = await confirm(membershipId, document.id, {
    ...firstConfirmPayload,
    pageNumber: 2,
    quote: "Second page quote."
  });
  assert.equal(confirmConflict.statusCode, 409);

  const secondConfirm = await confirm(membershipId, document.id, {
    membershipVersion: metadata.membershipVersion,
    pageNumber: 2,
    quote: "Second page quote.",
    statement: "The issuer included the second-page quote.",
    validUntil: "2027-07-01T00:00:00.000Z",
    replacesMaterialId: firstMaterial.id,
    idempotencyKey: "confirm-page-2-revision"
  });
  assert.equal(secondConfirm.statusCode, 200);
  assert.equal(secondConfirm.json().data.revision, 2);
  assert.equal(secondConfirm.json().data.replacesMaterialId, firstMaterial.id);
  const freshList = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/documents`);
  assert.equal(freshList.materials.find((item) => item.id === firstMaterial.id).revisionState, "replaced");
  assert.equal(freshList.materials.find((item) => item.id === secondConfirm.json().data.id).revisionState, "current");

  const otherMembership = await request("POST", "/api/mobile/research/candidate-memberships", {
    market: "HK",
    code: "09926",
    initialState: "tracked",
    idempotencyKey: "research-document-other-membership"
  }, 201, otherHeaders);
  const otherMembershipId = otherMembership.data.id;
  const otherMetadata = {
    ...metadata,
    membershipVersion: otherMembership.data.version,
    idempotencyKey: "other-document-import"
  };
  const otherImport = await importPdf(otherMembershipId, otherMetadata, pdfBytes, otherHeaders);
  assert.equal(otherImport.statusCode, 200, otherImport.body);
  assert.equal(otherImport.json().data.result, "created");
  const otherDocument = otherImport.json().data.document;
  assert.notEqual(otherDocument.id, document.id);
  const otherConfirm = await confirm(otherMembershipId, otherDocument.id, {
    membershipVersion: otherMembership.data.version,
    pageNumber: 1,
    quote: "Unique quote.",
    statement: "The other actor independently confirmed the same issuer text.",
    validUntil: "2027-07-01T00:00:00.000Z",
    idempotencyKey: "other-confirm-page-1"
  }, otherHeaders);
  assert.equal(otherConfirm.statusCode, 200, otherConfirm.body);
  const otherMaterial = otherConfirm.json().data;

  const staleSourceFundamental = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, firstMaterial.id, "revenue", "2024-01-01", "2024-12-31", "100"),
    idempotencyKey: "fundamental-stale-source"
  });
  assert.equal(staleSourceFundamental.statusCode, 409);
  assert.equal(staleSourceFundamental.json().code, "SOURCE_MATERIAL_SUPERSEDED");
  const staleVersionFundamental = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion + 1, secondConfirm.json().data.id, "revenue", "2024-01-01", "2024-12-31", "100"),
    idempotencyKey: "fundamental-stale-membership"
  });
  assert.equal(staleVersionFundamental.statusCode, 409);

  const revenuePriorPayload = fundamentalPayload(
    metadata.membershipVersion,
    secondConfirm.json().data.id,
    "revenue",
    "2024-01-01",
    "2024-12-31",
    "100"
  );
  const revenuePrior = await fundamental(membershipId, revenuePriorPayload);
  assert.equal(revenuePrior.statusCode, 200, revenuePrior.body);
  const revenuePriorValue = revenuePrior.json().data;
  const revenueReplay = await fundamental(membershipId, revenuePriorPayload);
  assert.equal(revenueReplay.statusCode, 200);
  assert.equal(revenueReplay.json().data.id, revenuePriorValue.id);
  const revenueDrift = await fundamental(membershipId, { ...revenuePriorPayload, value: "101" });
  assert.equal(revenueDrift.statusCode, 409);
  const revenueCurrent = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "revenue", "2025-01-01", "2025-12-31", "120"),
    idempotencyKey: "fundamental-revenue-current"
  });
  assert.equal(revenueCurrent.statusCode, 200, revenueCurrent.body);
  const profitPrior = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "profit_attributable_to_owners", "2024-01-01", "2024-12-31", "-10"),
    idempotencyKey: "fundamental-profit-prior"
  });
  assert.equal(profitPrior.statusCode, 200);
  const profitCurrent = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "profit_attributable_to_owners", "2025-01-01", "2025-12-31", "12"),
    idempotencyKey: "fundamental-profit-current"
  });
  assert.equal(profitCurrent.statusCode, 200);
  const unknownCashFlow = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "operating_cash_flow", "2025-01-01", "2025-12-31", null),
    valueStatus: "explicit_unknown",
    idempotencyKey: "fundamental-ocf-unknown"
  });
  assert.equal(unknownCashFlow.statusCode, 200);
  assert.equal(unknownCashFlow.json().data.value, null);

  const fundamentalReadBack = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`
  );
  assert.equal(fundamentalReadBack.values.length, 5);
  assert.equal(fundamentalReadBack.values.every((value) =>
    value.source.materialId === secondConfirm.json().data.id
      && value.source.documentId === document.id
      && value.source.pageNumber === 2
      && value.provenance.factKind === "issuer_reported"
      && value.provenance.transcription === "owner_manual"
      && value.provenance.verificationStatus === "unverified"
  ), true);
  const revenueYoy = fundamentalReadBack.derivations.find((item) => item.kind === "revenue_yoy");
  assert.deepEqual(
    { status: revenueYoy.status, value: revenueYoy.value, ids: revenueYoy.inputValueIds, formula: revenueYoy.formulaVersion },
    {
      status: "available",
      value: "0.2",
      ids: [revenuePriorValue.id, revenueCurrent.json().data.id],
      formula: "issuer-fundamentals-v1"
    }
  );
  const profitChange = fundamentalReadBack.derivations.find((item) => item.kind === "profit_change");
  assert.equal(profitChange.valueKind, "absolute_change");
  assert.equal(profitChange.value, "22");
  assert.match(fundamentalReadBack.derivations.find((item) => item.kind === "cash_conversion").reason, /unknown/);

  const unknownRevenue = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "revenue", "2026-01-01", "2026-12-31", null),
    valueStatus: "explicit_unknown",
    idempotencyKey: "fundamental-revenue-unknown"
  });
  assert.equal(unknownRevenue.statusCode, 200);
  const incomparableProfit = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "profit_attributable_to_owners", "2026-01-01", "2026-12-31", "15"),
    comparability: "not_comparable",
    comparabilityReason: "fixture accounting scope changed",
    idempotencyKey: "fundamental-profit-incomparable"
  });
  assert.equal(incomparableProfit.statusCode, 200);

  const revenueScenarioPayload = scenarioPayload(
    metadata.membershipVersion,
    revenueCurrent.json().data.id,
    "valuation-revenue-root"
  );
  const revenueScenario = await scenario(membershipId, revenueScenarioPayload);
  assert.equal(revenueScenario.statusCode, 200, revenueScenario.body);
  const revenueScenarioRoot = revenueScenario.json().data;
  const scenarioReplay = await scenario(membershipId, revenueScenarioPayload);
  assert.equal(scenarioReplay.statusCode, 200);
  assert.equal(scenarioReplay.json().data.id, revenueScenarioRoot.id);
  const scenarioDrift = await scenario(membershipId, {
    ...revenueScenarioPayload,
    assumptions: { ...revenueScenarioPayload.assumptions, terminalMultiple: 19 }
  });
  assert.equal(scenarioDrift.statusCode, 409);

  const assets = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "total_assets", null, "2025-12-31", "200"),
    periodKind: "instant", idempotencyKey: "fixture-assets-anchor"
  });
  assert.equal(assets.statusCode, 200, assets.body);
  const liabilities = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "total_liabilities", null, "2025-12-31", "80"),
    periodKind: "instant", idempotencyKey: "fixture-liabilities-anchor"
  });
  assert.equal(liabilities.statusCode, 200, liabilities.body);
  const assetScenario = await scenario(membershipId, {
    ...scenarioPayload(metadata.membershipVersion, assets.json().data.id, "fixture-assets-scenario"),
    assumptions: { ...revenueScenarioPayload.assumptions, methodId: "adjusted_net_asset_value_user_scenario" }
  });
  assert.equal(assetScenario.statusCode, 200, assetScenario.body);

  const concurrentProfitRoots = await Promise.all([
    scenario(membershipId, scenarioPayload(
      metadata.membershipVersion,
      profitCurrent.json().data.id,
      "valuation-profit-root-1"
    )),
    scenario(membershipId, scenarioPayload(
      metadata.membershipVersion,
      profitCurrent.json().data.id,
      "valuation-profit-root-2"
    ))
  ]);
  assert.deepEqual(concurrentProfitRoots.map((response) => response.statusCode).sort(), [200, 409]);

  const concurrentRevenueSuccessors = await Promise.all([
    scenario(membershipId, {
      ...scenarioPayload(
        metadata.membershipVersion,
        revenueCurrent.json().data.id,
        "valuation-revenue-successor-1"
      ),
      replacesScenarioSetId: revenueScenarioRoot.id,
      assumptions: { ...revenueScenarioPayload.assumptions, annualGrowthRate: 0.11 }
    }),
    scenario(membershipId, {
      ...scenarioPayload(
        metadata.membershipVersion,
        revenueCurrent.json().data.id,
        "valuation-revenue-successor-2"
      ),
      replacesScenarioSetId: revenueScenarioRoot.id,
      assumptions: { ...revenueScenarioPayload.assumptions, annualGrowthRate: 0.12 }
    })
  ]);
  assert.deepEqual(concurrentRevenueSuccessors.map((response) => response.statusCode).sort(), [200, 409]);
  const revenueScenarioSuccessor = concurrentRevenueSuccessors
    .find((response) => response.statusCode === 200).json().data;

  const scenarioReadBack = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/valuation-scenarios`
  );
  assert.equal(scenarioReadBack.membershipState, "tracked");
  assert.equal(scenarioReadBack.scenarioSets.length, 4);
  const freshRevenueScenario = scenarioReadBack.scenarioSets.find((item) => item.id === revenueScenarioSuccessor.id);
  assert.deepEqual(freshRevenueScenario.assumptions.values, revenueScenarioSuccessor.assumptions.values);
  assert.equal(Object.keys(freshRevenueScenario.assumptions.values).length, 9);
  assert.equal(freshRevenueScenario.assumptions.authority, "owner");
  assert.equal(freshRevenueScenario.anchor.anchorRole, "cited_context_only_not_calculation_input");
  assert.deepEqual({
    materialId: freshRevenueScenario.anchor.source.materialId,
    documentId: freshRevenueScenario.anchor.source.documentId,
    pdfSha256: freshRevenueScenario.anchor.source.documentPdfSha256,
    pageNumber: freshRevenueScenario.anchor.source.pageNumber,
    pageTextSha256: freshRevenueScenario.anchor.source.pageTextSha256
  }, {
    materialId: secondConfirm.json().data.id,
    documentId: document.id,
    pdfSha256: document.pdfSha256,
    pageNumber: 2,
    pageTextSha256: freshList.materials.find((item) => item.id === secondConfirm.json().data.id).citation.pageTextSha256
  });
  assert.equal(freshRevenueScenario.calculation.method.calculationVersion, "2026-07-17.discounted-forward-metric-multiple.v1");
  assert.deepEqual(freshRevenueScenario.calculation.diagonal.map((item) => item.scenario), ["bear", "base", "bull"]);
  assert.equal(freshRevenueScenario.calculation.matrix.cells.length, 9);
  assert.equal(freshRevenueScenario.recomputable, true);
  assert.equal(
    scenarioReadBack.scenarioSets.find((item) => item.id === revenueScenarioRoot.id).recomputable,
    false
  );

  const staleVersionScenario = await scenario(membershipId, {
    ...scenarioPayload(metadata.membershipVersion + 1, revenueCurrent.json().data.id, "valuation-stale-version"),
  });
  assert.equal(staleVersionScenario.statusCode, 409);
  const symbolConflictScenario = await scenario(membershipId, {
    ...scenarioPayload(metadata.membershipVersion, revenueCurrent.json().data.id, "valuation-symbol-conflict"),
    symbol: "HK.09988"
  });
  assert.equal(symbolConflictScenario.statusCode, 409);
  const unknownAnchorScenario = await scenario(membershipId, scenarioPayload(
    metadata.membershipVersion,
    unknownRevenue.json().data.id,
    "valuation-unknown-anchor"
  ));
  assert.equal(unknownAnchorScenario.statusCode, 409);
  assert.equal(unknownAnchorScenario.json().code, "ANCHOR_NOT_REPORTED");
  const incomparableAnchorScenario = await scenario(membershipId, scenarioPayload(
    metadata.membershipVersion,
    incomparableProfit.json().data.id,
    "valuation-incomparable-anchor"
  ));
  assert.equal(incomparableAnchorScenario.statusCode, 409);
  assert.equal(incomparableAnchorScenario.json().code, "ANCHOR_NOT_COMPARABLE");
  const ineligibleMetricScenario = await scenario(membershipId, scenarioPayload(
    metadata.membershipVersion,
    unknownCashFlow.json().data.id,
    "valuation-ineligible-metric"
  ));
  assert.equal(ineligibleMetricScenario.statusCode, 409);
  assert.equal(ineligibleMetricScenario.json().code, "ANCHOR_METRIC_INELIGIBLE");

  const correctedPayload = {
    ...revenuePriorPayload,
    value: "102",
    amendmentKind: "correction",
    replacesValueId: revenuePriorValue.id,
    idempotencyKey: "fundamental-revenue-correction"
  };
  const corrected = await fundamental(membershipId, correctedPayload);
  assert.equal(corrected.statusCode, 200, corrected.body);
  assert.equal(corrected.json().data.revision, 2);
  const concurrentReplacement = await Promise.all([
    fundamental(membershipId, {
      ...correctedPayload,
      value: "103",
      amendmentKind: "restatement",
      replacesValueId: corrected.json().data.id,
      idempotencyKey: "fundamental-concurrent-replacement-1"
    }),
    fundamental(membershipId, {
      ...correctedPayload,
      value: "104",
      amendmentKind: "correction",
      replacesValueId: corrected.json().data.id,
      idempotencyKey: "fundamental-concurrent-replacement-2"
    })
  ]);
  assert.deepEqual(concurrentReplacement.map((response) => response.statusCode).sort(), [200, 409]);
  const replacedAnchorScenario = await scenario(membershipId, scenarioPayload(
    metadata.membershipVersion,
    revenuePriorValue.id,
    "valuation-replaced-anchor"
  ));
  assert.equal(replacedAnchorScenario.statusCode, 409);
  assert.equal(replacedAnchorScenario.json().code, "ANCHOR_REPLACED");
  const afterReplacement = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
  assert.equal(afterReplacement.values.find((value) => value.id === revenuePriorValue.id).valueState, "replaced");
  assert.equal(afterReplacement.values.find((value) => value.id === corrected.json().data.id).valueState, "replaced");
  await app.close();
  app = await buildServer(serverConfig());
  const afterRestart = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
  assert.deepEqual(
    afterRestart.values.map((value) => [value.id, value.valueState]),
    afterReplacement.values.map((value) => [value.id, value.valueState])
  );
  const replayAfterRestart = await fundamental(membershipId, revenuePriorPayload);
  assert.equal(replayAfterRestart.statusCode, 200);
  assert.equal(replayAfterRestart.json().data.id, revenuePriorValue.id);

  await pool.query(
    `update research_materials
        set valid_until = $1
      where id = $2`,
    ["2000-01-01T00:00:00.000Z", secondConfirm.json().data.id]
  );
  const expiredSourceFundamental = await fundamental(membershipId, {
    ...fundamentalPayload(metadata.membershipVersion, secondConfirm.json().data.id, "revenue", "2026-01-01", "2026-12-31", "140"),
    idempotencyKey: "fundamental-expired-source"
  });
  assert.equal(expiredSourceFundamental.statusCode, 409);
  assert.equal(expiredSourceFundamental.json().code, "SOURCE_MATERIAL_STALE");
  const expiredSourceScenario = await scenario(membershipId, {
    ...scenarioPayload(
      metadata.membershipVersion,
      revenueCurrent.json().data.id,
      "valuation-expired-source"
    ),
    replacesScenarioSetId: revenueScenarioSuccessor.id
  });
  assert.equal(expiredSourceScenario.statusCode, 409);
  assert.equal(expiredSourceScenario.json().code, "ANCHOR_SOURCE_STALE");
  const expiredSourceReplay = await scenario(membershipId, revenueScenarioPayload);
  assert.equal(expiredSourceReplay.statusCode, 409);
  assert.equal(expiredSourceReplay.json().code, "ANCHOR_SOURCE_STALE");
  const staleScenarioReadBack = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/valuation-scenarios`
  );
  const staleScenario = staleScenarioReadBack.scenarioSets.find((item) => item.id === revenueScenarioSuccessor.id);
  assert.equal(staleScenario.recomputable, false);
  assert.deepEqual(staleScenario.invalidatedBy, ["anchor_source_stale"]);
  const staleSourceReadBack = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`
  );
  const unreplacedStaleValues = staleSourceReadBack.values.filter((value) => value.valueState !== "replaced");
  assert.equal(unreplacedStaleValues.length > 0, true);
  assert.equal(
    unreplacedStaleValues.every((value) =>
      value.valueState === "historical_source_stale"
        && value.source.materialRevisionState === "current"
        && value.source.freshness === "stale"
        && value.source.validUntil === "2000-01-01T00:00:00.000Z"
    ),
    true
  );
  assert.equal(
    staleSourceReadBack.derivations.every((item) =>
      item.status === "not_comparable"
        && item.inputValueIds.every((id) => !unreplacedStaleValues.some((value) => value.id === id))
    ),
    true
  );
  await pool.query(
    `update research_materials
        set valid_until = $1
      where id = $2`,
    ["2027-07-01T00:00:00.000Z", secondConfirm.json().data.id]
  );

  const crossActorFundamental = await fundamental(
    otherMembershipId,
    {
      ...fundamentalPayload(otherMembership.data.version, secondConfirm.json().data.id, "revenue", "2024-01-01", "2024-12-31", "100"),
      idempotencyKey: "fundamental-cross-actor"
    },
    otherHeaders
  );
  assert.equal(crossActorFundamental.statusCode, 404);
  const crossActorScenario = await scenario(
    membershipId,
    scenarioPayload(metadata.membershipVersion, revenueCurrent.json().data.id, "valuation-cross-actor"),
    otherHeaders
  );
  assert.equal(crossActorScenario.statusCode, 404);
  const crossMembershipScenario = await scenario(
    otherMembershipId,
    scenarioPayload(otherMembership.data.version, revenueCurrent.json().data.id, "valuation-cross-membership"),
    otherHeaders
  );
  assert.equal(crossMembershipScenario.statusCode, 404);
  const crossActorRead = await app.inject({
    method: "GET",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`,
    headers: otherHeaders
  });
  assert.equal(crossActorRead.statusCode, 404);

  const crossMembershipRevision = await confirm(otherMembershipId, otherDocument.id, {
    membershipVersion: otherMembership.data.version,
    pageNumber: 2,
    quote: "Second page quote.",
    statement: "Cross-membership replacement must fail closed.",
    validUntil: "2027-07-01T00:00:00.000Z",
    replacesMaterialId: firstMaterial.id,
    idempotencyKey: "other-cross-membership-revision"
  }, otherHeaders);
  assert.equal(crossMembershipRevision.statusCode, 422);

  const ownerWorkspace = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research`
  );
  assert.equal(ownerWorkspace.data.materials.some((item) => item.id === otherMaterial.id), false);
  assert.equal(ownerWorkspace.data.materials.some((item) => item.id === firstMaterial.id), true);
  const otherWorkspace = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${otherMembershipId}/deep-research`,
    undefined,
    200,
    otherHeaders
  );
  assert.equal(otherWorkspace.data.materials.some((item) => item.id === firstMaterial.id), false);
  assert.equal(otherWorkspace.data.materials.some((item) => item.id === otherMaterial.id), true);
  const otherDocumentList = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${otherMembershipId}/documents`,
    undefined,
    200,
    otherHeaders
  );
  assert.deepEqual(otherDocumentList.documents.map((item) => item.id), [otherDocument.id]);
  assert.deepEqual(otherDocumentList.materials.map((item) => item.id), [otherMaterial.id]);

  const genericProfile = await request("GET", "/api/mobile/research/profiles/HK/09926");
  assert.deepEqual(genericProfile.data.evidence, []);
  const candidateOverview = await request("GET", "/api/mobile/research/candidates");
  assert.equal(candidateOverview.candidates.find((item) => item.symbol === "HK.09926").evidenceCount, 0);

  const contextMaterial = secondConfirm.json().data;
  const asOf = contextMaterial.capturedAt;
  const provenance = { sourceType: contextMaterial.sourceType, sourceVersion: contextMaterial.sourceVersion,
    capturedAt: asOf, classification: "user_provided" };
  const citation = { documentId: document.id, pageNumber: contextMaterial.citation.pageNumber,
    pageTextSha256: contextMaterial.citation.pageTextSha256, sourceType: contextMaterial.sourceType,
    sourceUrl: "https://example.invalid/fixture-context", sourceVersion: contextMaterial.sourceVersion };
  await request("POST", `/api/mobile/research/candidate-memberships/${membershipId}/research-context`, {
    baseContextId: null, membershipVersion: metadata.membershipVersion, selectedSymbol: "HK.09926", industry: "fixture_only",
    selectedFacts: [{ id: "1", selectedSymbol: "HK.09926", symbol: "HK.09926", metric: "fixture_disclosure_count",
      value: "1", unit: "count", currency: null, asOf, cutoffAt: asOf, validUntil: contextMaterial.validUntil, citation, provenance }],
    peerFacts: [], peers: [], operatingKpis: [], macroDrivers: [], industryDrivers: [], unknowns: ["Fixture does not establish complete research"],
    provenance, asOf, cutoffAt: asOf, validUntil: contextMaterial.validUntil, idempotencyKey: "fixture-current-context"
  });
  currentValuationMethods = [freshRevenueScenario, assetScenario.json().data];
  const analysisAsOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const weeklyAnalysis = await request("GET", `/api/mobile/market/weinstein/HK/09926?analysisAsOf=${analysisAsOf}`);
  currentWeinstein = frozenWeinsteinEvidenceBinding(weeklyAnalysis);
  assert.ok(currentWeinstein, JSON.stringify(weeklyAnalysis));

  const expiringMaterialValidUntil = new Date(Date.now() + 15_000).toISOString();
  const expiringNonAnchorMaterial = await request(
    "POST",
    "/api/mobile/research/profiles/HK/09926/materials",
    {
      membershipId,
      membershipVersion: metadata.membershipVersion,
      title: "Fixture-only non-anchor source",
      contentText: "This fixture proves that natural expiry invalidates a frozen pack without changing its content address.",
      sourceType: "fixture_authorized_public",
      sourceUrl: "https://example.invalid/fixture-only-expiry",
      publishedAt: "2026-07-01T00:00:00.000Z",
      claimType: "issuer_statement",
      verificationStatus: "verified",
      rightsStatus: "authorized_public",
      sourceVersion: "fixture-expiry-v1",
      replacesMaterialId: null,
      validUntil: expiringMaterialValidUntil,
      summary: "Fixture-only expiry source.",
      variableName: null,
      stance: "neutral",
      reliability: 4,
      materiality: 3,
      isRead: true,
      idempotencyKey: "fixture-expiring-non-anchor-material"
    }
  );
  const technicalCutoff = latestCompletedHongKongSession(new Date());
  const firstTechnical = await persistResearchFrozenTechnicalFixture(pool, {
    code: "09926",
    cutoff: technicalCutoff,
    revision: 1
  });
  const freezeUrl = `/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`;
  const concurrentFreezePayload = freezePayload(
    metadata.membershipVersion,
    freshRevenueScenario,
    firstTechnical,
    "owner-pdf-evidence-pack"
  );
  const countsBeforeExpectedDrift = await evidencePackWriteCounts(pool);
  const scenarioDriftConflict = await request(
    "POST",
    freezeUrl,
    { ...concurrentFreezePayload, expectedScenarioRevision: concurrentFreezePayload.expectedScenarioRevision + 1,
      idempotencyKey: "owner-pdf-evidence-pack-scenario-drift" },
    409
  );
  assert.match(scenarioDriftConflict.message, /Owner-confirmed freeze binding/);
  const technicalDriftConflict = await request(
    "POST",
    freezeUrl,
    { ...concurrentFreezePayload, expectedTechnicalResultHash: "f".repeat(64),
      idempotencyKey: "owner-pdf-evidence-pack-technical-drift" },
    409
  );
  assert.match(technicalDriftConflict.message, /Owner-confirmed freeze binding/);
  assert.deepEqual(await evidencePackWriteCounts(pool), countsBeforeExpectedDrift);
  const concurrentFrozen = await Promise.all([
    request("POST", freezeUrl, concurrentFreezePayload),
    request("POST", freezeUrl, concurrentFreezePayload)
  ]);
  assert.equal(new Set(concurrentFrozen.map((item) => item.data.id)).size, 1);
  const frozen = concurrentFrozen[0];
  assert.deepEqual(
    new Set(frozen.data.items.map((item) => item.id)),
    new Set([secondConfirm.json().data.id, expiringNonAnchorMaterial.data.id])
  );
  assert.equal(
    frozen.data.items.find((item) => item.id === secondConfirm.json().data.id).verificationStatus,
    "unverified"
  );
  assert.equal(frozen.data.currentness.status, "current");
  assert.deepEqual(frozen.data.currentness.invalidatedBy, []);
  assert.equal(frozen.data.frozenResearchContext.membership.symbol, "HK.09926");
  assert.equal(frozen.data.frozenResearchContext.valuationScenario.id, revenueScenarioSuccessor.id);
  assert.equal(frozen.data.frozenResearchContext.valuationScenario.recomputable, true);
  assert.equal(
    Object.keys(frozen.data.frozenResearchContext.valuationScenario.assumptions.values).length,
    9
  );
  assert.equal(
    frozen.data.frozenResearchContext.valuationScenario.anchor.source.documentPdfSha256,
    document.pdfSha256
  );
  assert.equal(
    frozen.data.frozenResearchContext.valuationScenario.anchor.source.pageTextSha256,
    freshRevenueScenario.anchor.source.pageTextSha256
  );
  assert.equal(
    frozen.data.frozenResearchContext.technical.dailyBars.snapshot.snapshotSha,
    firstTechnical.dailyBars.snapshot.snapshotSha
  );
  assert.equal(
    frozen.data.frozenResearchContext.technical.technical.resultHash,
    firstTechnical.technical.resultHash
  );
  assert.deepEqual(
    Object.values(frozen.data.frozenResearchContext.unboundSources),
    Array(5).fill({ status: "source_missing", value: "UNKNOWN" })
  );
  const firstFrozenWorkspace = await request("GET", `/api/mobile/research/candidate-memberships/${membershipId}/deep-research`);
  const firstFreshPack = firstFrozenWorkspace.data.evidencePacks.find((item) => item.id === frozen.data.id);
  assert.equal(firstFreshPack.currentness.status, "current");
  assert.equal(firstFrozenWorkspace.data.latestPack.id, frozen.data.id);
  const frozenAuditCount = await pool.query(
    `select count(*)::int as count
       from research_write_audit_events
      where event_type = 'evidence_pack_frozen'
        and after_payload->>'id' = $1`,
    [frozen.data.id]
  );
  assert.equal(frozenAuditCount.rows[0].count, 1);
  const profileIdentity = (await pool.query(
    `select rp.id as profile_id, rp.updated_at as profile_updated_at,
            s.id as stock_id, s.updated_at as stock_updated_at
       from research_profiles rp
       join stocks s on s.id = rp.stock_id
      where rp.market = 'HK' and rp.code = '09926'`
  )).rows[0];
  const legacyFixtureReport = (await pool.query(
    `insert into deep_research_reports
      (research_profile_id, evidence_pack_id, version, status, report_payload, gate_failures)
     values ($1, $2, 1, 'complete_pending_confirmation', $3::jsonb, '{}'::text[])
     returning id`,
    [
      profileIdentity.profile_id,
      frozen.data.id,
      JSON.stringify(legacyReportPayload())
    ]
  )).rows[0];
  const reportRowsBeforeBindingMismatch = (await pool.query(
    "select count(*)::int as count from deep_research_reports"
  )).rows[0].count;
  const bindingMismatch = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    {
      ...reportRequest(metadata.membershipVersion, frozen.data, "report-binding-mismatch"),
      evidencePackBinding: {
        ...reportRequest(metadata.membershipVersion, frozen.data, "report-binding-mismatch")
          .evidencePackBinding,
        fingerprint: "0".repeat(64)
      }
    },
    422
  );
  assert.match(bindingMismatch.failures.join("\n"), /does not exactly match/);
  assert.equal(
    (await pool.query("select count(*)::int as count from deep_research_reports")).rows[0].count,
    reportRowsBeforeBindingMismatch
  );
  const incompleteReportRequest = reportRequest(
    metadata.membershipVersion,
    frozen.data,
    "fixture-incomplete-report-replay"
  );
  incompleteReportRequest.adviceLayer.applicableUntil =
    new Date(Date.parse(frozen.data.frozenAt) - 1).toISOString();
  const incompleteFixtureReport = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    incompleteReportRequest
  );
  assert.equal(incompleteFixtureReport.data.status, "evidence_insufficient");
  assert.match(incompleteFixtureReport.data.gateFailures.join("\n"), /applicableUntil/);
  const incompleteFixtureReplay = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    incompleteReportRequest
  );
  assert.equal(incompleteFixtureReplay.data.id, incompleteFixtureReport.data.id);
  assert.deepEqual(
    incompleteFixtureReplay.data.gateFailures,
    incompleteFixtureReport.data.gateFailures
  );
  const firstFixtureReport = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    reportRequest(metadata.membershipVersion, frozen.data, "fixture-report-bound-to-first-pack")
  );
  await verifyResearchUpdateSnapshot(membershipId, frozen.data, firstFixtureReport.data);
  const reportReplayIdentityBefore = (await pool.query(
    `select stock.updated_at as stock_updated_at,
            profile.updated_at as profile_updated_at
       from stocks stock
       join research_profiles profile on profile.stock_id = stock.id
      where profile.id = $1`,
    [profileIdentity.profile_id]
  )).rows[0];
  const firstFixtureReplay = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    reportRequest(metadata.membershipVersion, frozen.data, "fixture-report-bound-to-first-pack")
  );
  assert.equal(firstFixtureReplay.data.id, firstFixtureReport.data.id);
  assert.equal(firstFixtureReplay.data.reportFingerprint, firstFixtureReport.data.reportFingerprint);
  assert.deepEqual(
    (await pool.query(
      `select stock.updated_at as stock_updated_at,
              profile.updated_at as profile_updated_at
         from stocks stock
         join research_profiles profile on profile.stock_id = stock.id
        where profile.id = $1`,
      [profileIdentity.profile_id]
    )).rows[0],
    reportReplayIdentityBefore
  );
  const concurrentDecisionPayload = {
    membershipVersion: metadata.membershipVersion,
    decision: "rejected",
    note: "Fixture-only explicit rejection; this document fixture is not complete investment research.",
    idempotencyKey: "fixture-report-first-decision"
  };
  const incompleteConfirmation = await request(
    "POST", `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports/${firstFixtureReport.data.id}/decisions`,
    { ...concurrentDecisionPayload, decision: "confirmed", idempotencyKey: "fixture-incomplete-confirmation-blocked" }, 422
  );
  assert.match(incompleteConfirmation.message, /research completeness/);
  assert.equal((await pool.query("select count(*)::int as count from deep_research_report_decisions where report_id = $1",
    [firstFixtureReport.data.id])).rows[0].count, 0);
  const [firstFixtureDecision, firstFixtureDecisionReplay] = await Promise.all([
    request(
      "POST",
      `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports/${firstFixtureReport.data.id}/decisions`,
      concurrentDecisionPayload
    ),
    request(
      "POST",
      `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports/${firstFixtureReport.data.id}/decisions`,
      concurrentDecisionPayload
    )
  ]);
  assert.deepEqual(firstFixtureDecisionReplay.data, firstFixtureDecision.data);
  const concurrentDecisionCounts = (await pool.query(
    `select
       (select count(*)::int
          from deep_research_report_decisions
         where report_id = $1) as decisions,
       (select count(*)::int
          from research_write_audit_events
         where event_type = 'deep_research_report_decided'
           and target_id = $2) as audits`,
    [firstFixtureReport.data.id, firstFixtureDecision.data.id]
  )).rows[0];
  assert.deepEqual(concurrentDecisionCounts, { decisions: 1, audits: 1 });
  const firstReportFreshRead = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research`
  );
  assert.equal(firstReportFreshRead.data.latestReport.id, firstFixtureReport.data.id);
  assert.equal(firstReportFreshRead.data.latestReport.currentness.status, "current");
  assert.equal(firstReportFreshRead.data.userDecision.id, firstFixtureDecision.data.id);
  assert.equal(firstReportFreshRead.data.decisions[0].reportId, firstFixtureReport.data.id);
  const legacyRead = firstReportFreshRead.data.reports.find(
    (item) => item.id === String(legacyFixtureReport.id)
  );
  assert.equal(legacyRead.contractVersion, "2026-07-25.deep-research-legacy.v1");
  assert.equal(legacyRead.currentness.status, "historical");
  assert.equal(
    legacyRead.currentness.invalidatedBy.includes("legacy_contract_not_formalizable"),
    true
  );

  const secondTechnical = await persistResearchFrozenTechnicalFixture(pool, {
    code: "09926",
    cutoff: technicalCutoff,
    revision: 2
  });
  assert.notEqual(
    secondTechnical.dailyBars.snapshot.snapshotSha,
    firstTechnical.dailyBars.snapshot.snapshotSha
  );
  assert.notEqual(secondTechnical.technical.resultHash, firstTechnical.technical.resultHash);
  const replayCountsBeforeTechnicalDrift = await evidencePackWriteCounts(pool);
  const replayIdentityBeforeTechnicalDrift = (await pool.query(
    `select rp.updated_at as profile_updated_at, s.updated_at as stock_updated_at
       from research_profiles rp
       join stocks s on s.id = rp.stock_id
      where rp.id = $1`,
    [profileIdentity.profile_id]
  )).rows[0];
  const replayAfterTechnicalDrift = await request(
    "POST",
    freezeUrl,
    concurrentFreezePayload
  );
  assert.equal(replayAfterTechnicalDrift.data.id, frozen.data.id);
  assert.equal(replayAfterTechnicalDrift.data.currentness.status, "historical");
  assert.deepEqual(
    replayAfterTechnicalDrift.data.currentness.invalidatedBy,
    ["technical_snapshot_changed", "technical_result_changed"]
  );
  assert.deepEqual(await evidencePackWriteCounts(pool), replayCountsBeforeTechnicalDrift);
  assert.deepEqual(
    (await pool.query(
      `select rp.updated_at as profile_updated_at, s.updated_at as stock_updated_at
         from research_profiles rp
         join stocks s on s.id = rp.stock_id
        where rp.id = $1`,
      [profileIdentity.profile_id]
    )).rows[0],
    replayIdentityBeforeTechnicalDrift
  );
  const historicalWorkspace = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research`
  );
  const historicalPack = historicalWorkspace.data.evidencePacks.find((item) => item.id === frozen.data.id);
  assert.equal(historicalPack.currentness.status, "historical");
  assert.deepEqual(
    historicalPack.currentness.invalidatedBy,
    ["technical_snapshot_changed", "technical_result_changed"]
  );
  assert.equal(historicalWorkspace.data.latestPack.id, frozen.data.id);
  assert.equal(historicalWorkspace.data.completion.deepResearchComplete, false);
  assert.match(historicalWorkspace.data.completion.reasons.join("\n"), /historical/);
  const technicalDriftReport = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    reportRequest(metadata.membershipVersion, frozen.data, "report-after-technical-drift"),
    422
  );
  assert.deepEqual(
    technicalDriftReport.failures,
    ["technical_snapshot_changed", "technical_result_changed"]
  );
  const technicalDriftDecision = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports/${firstFixtureReport.data.id}/decisions`,
    {
      membershipVersion: metadata.membershipVersion,
      decision: "rejected",
      note: "Fixture-only currentness check.",
      idempotencyKey: "decision-after-technical-drift"
    },
    422
  );
  assert.deepEqual(
    technicalDriftDecision.failures,
    ["technical_snapshot_changed", "technical_result_changed"]
  );
  const driftedSameKeyReplay = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports/${firstFixtureReport.data.id}/decisions`,
    concurrentDecisionPayload,
    200
  );
  assert.deepEqual(driftedSameKeyReplay.data, firstFixtureDecision.data);
  assert.deepEqual(
    (await pool.query(
      `select
         (select count(*)::int
            from deep_research_report_decisions
           where report_id = $1) as decisions,
         (select count(*)::int
            from research_write_audit_events
           where event_type = 'deep_research_report_decided'
             and target_id = $2) as audits`,
      [firstFixtureReport.data.id, firstFixtureDecision.data.id]
    )).rows[0],
    { decisions: 1, audits: 1 }
  );
  const todayAfterTechnicalDrift = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/today`
  );
  assert.equal(
    todayAfterTechnicalDrift.quality.sourceHealth.issueCodes.includes("historical_evidence_pack"),
    true
  );
  assert.notEqual(todayAfterTechnicalDrift.quality.researchStructure.status, "passed");
  assert.equal(todayAfterTechnicalDrift.items[0].trackingState, "needs_evidence_pack");
  assert.equal(todayAfterTechnicalDrift.items[0].thesis, null);
  assert.deepEqual(todayAfterTechnicalDrift.items[0].invalidationConditions, []);
  assert.equal(todayAfterTechnicalDrift.items[0].versionChange, null);
  assert.equal(todayAfterTechnicalDrift.items[0].bindings.reportRef, null);
  assert.equal(todayAfterTechnicalDrift.items[0].bindings.decisionRef, null);
  assert.equal(todayAfterTechnicalDrift.items[0].bindings.evidencePackRef.id, frozen.data.id);

  const refrozen = await request(
    "POST",
    freezeUrl,
    freezePayload(
      metadata.membershipVersion,
      freshRevenueScenario,
      secondTechnical,
      "owner-pdf-evidence-pack-after-technical-change"
    )
  );
  assert.notEqual(refrozen.data.id, frozen.data.id);
  assert.equal(refrozen.data.currentness.status, "current");
  assert.equal(
    refrozen.data.frozenResearchContext.technical.dailyBars.snapshot.snapshotSha,
    secondTechnical.dailyBars.snapshot.snapshotSha
  );
  assert.equal(
    refrozen.data.frozenResearchContext.technical.technical.resultHash,
    secondTechnical.technical.resultHash
  );
  const frozenWorkspace = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research`
  );
  assert.equal(frozenWorkspace.data.latestPack.id, refrozen.data.id);
  assert.equal(frozenWorkspace.data.latestPack.currentness.status, "current");
  assert.equal(frozenWorkspace.data.evidencePacks.length, 2);
  const secondFixtureReport = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    reportRequest(metadata.membershipVersion, refrozen.data, "fixture-report-bound-to-second-pack")
  );
  const scenarioSuccessorResponse = await scenario(membershipId, {
    ...scenarioPayload(
      metadata.membershipVersion,
      revenueCurrent.json().data.id,
      "valuation-current-successor-after-freeze"
    ),
    replacesScenarioSetId: revenueScenarioSuccessor.id,
    assumptions: {
      ...freshRevenueScenario.assumptions.values,
      annualGrowthRate: freshRevenueScenario.assumptions.values.annualGrowthRate + 0.01
    }
  });
  assert.equal(scenarioSuccessorResponse.statusCode, 200, scenarioSuccessorResponse.body);
  const scenarioSuccessor = scenarioSuccessorResponse.json().data;
  const scenarioDriftWorkspace = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research`
  );
  assert.deepEqual(
    scenarioDriftWorkspace.data.evidencePacks
      .find((item) => item.id === refrozen.data.id).currentness.invalidatedBy,
    ["valuation_scenario_changed"]
  );
  const scenarioDriftReport = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports`,
    reportRequest(metadata.membershipVersion, refrozen.data, "report-after-scenario-drift"),
    422
  );
  assert.deepEqual(scenarioDriftReport.failures, ["valuation_scenario_changed"]);
  const scenarioDriftDecision = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research-reports/${secondFixtureReport.data.id}/decisions`,
    {
      membershipVersion: metadata.membershipVersion,
      decision: "rejected",
      note: "Fixture-only scenario currentness check.",
      idempotencyKey: "decision-after-scenario-drift"
    },
    422
  );
  assert.deepEqual(scenarioDriftDecision.failures, ["valuation_scenario_changed"]);
  const todayAfterScenarioDrift = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/today`
  );
  assert.equal(
    todayAfterScenarioDrift.quality.sourceHealth.issueCodes.includes("historical_evidence_pack"),
    true
  );
  assert.equal(todayAfterScenarioDrift.items[0].trackingState, "needs_evidence_pack");
  assert.equal(todayAfterScenarioDrift.items[0].thesis, null);
  assert.deepEqual(todayAfterScenarioDrift.items[0].invalidationConditions, []);
  assert.equal(todayAfterScenarioDrift.items[0].versionChange, null);
  assert.equal(todayAfterScenarioDrift.items[0].bindings.reportRef, null);
  assert.equal(todayAfterScenarioDrift.items[0].bindings.decisionRef, null);
  const currentAfterScenarioRefreeze = await request(
    "POST",
    freezeUrl,
    freezePayload(
      metadata.membershipVersion,
      scenarioSuccessor,
      secondTechnical,
      "owner-pdf-evidence-pack-after-scenario-change"
    )
  );
  assert.equal(currentAfterScenarioRefreeze.data.currentness.status, "current");
  const todayAfterScenarioRefreeze = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/today`
  );
  assert.equal(
    todayAfterScenarioRefreeze.quality.sourceHealth.issueCodes.includes("historical_evidence_pack"),
    false
  );
  assert.equal(todayAfterScenarioRefreeze.items[0].trackingState, "needs_research");
  assert.equal(
    todayAfterScenarioRefreeze.items[0].bindings.evidencePackRef.id,
    currentAfterScenarioRefreeze.data.id
  );

  const packFingerprintBeforeExpiry = currentAfterScenarioRefreeze.data.packFingerprint;
  await waitUntilAfter(expiringMaterialValidUntil);
  const countsBeforeExpiredReplay = await evidencePackWriteCounts(pool);
  const identityBeforeExpiredReplay = (await pool.query(
    `select rp.updated_at as profile_updated_at, s.updated_at as stock_updated_at
       from research_profiles rp
       join stocks s on s.id = rp.stock_id
      where rp.id = $1`,
    [profileIdentity.profile_id]
  )).rows[0];
  const replayAfterMaterialExpiry = await request(
    "POST",
    freezeUrl,
    freezePayload(
      metadata.membershipVersion,
      scenarioSuccessor,
      secondTechnical,
      "owner-pdf-evidence-pack-after-scenario-change"
    )
  );
  assert.equal(replayAfterMaterialExpiry.data.id, currentAfterScenarioRefreeze.data.id);
  assert.equal(replayAfterMaterialExpiry.data.packFingerprint, packFingerprintBeforeExpiry);
  assert.equal(replayAfterMaterialExpiry.data.currentness.status, "historical");
  assert.deepEqual(replayAfterMaterialExpiry.data.currentness.invalidatedBy, ["material_source_stale"]);
  const expiredWorkspace = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/deep-research`
  );
  assert.deepEqual(
    expiredWorkspace.data.evidencePacks
      .find((item) => item.id === currentAfterScenarioRefreeze.data.id).currentness.invalidatedBy,
    ["material_source_stale"]
  );
  assert.deepEqual(await evidencePackWriteCounts(pool), countsBeforeExpiredReplay);
  assert.deepEqual(
    (await pool.query(
      `select rp.updated_at as profile_updated_at, s.updated_at as stock_updated_at
         from research_profiles rp
         join stocks s on s.id = rp.stock_id
        where rp.id = $1`,
      [profileIdentity.profile_id]
    )).rows[0],
    identityBeforeExpiredReplay
  );
  const blockedExpiredFreeze = await request(
    "POST",
    freezeUrl,
    freezePayload(
      metadata.membershipVersion,
      scenarioSuccessor,
      secondTechnical,
      "owner-pdf-evidence-pack-expired-source-blocked"
    ),
    422
  );
  assert.match(blockedExpiredFreeze.failures.join("\n"), /stale/);
  assert.deepEqual(await evidencePackWriteCounts(pool), countsBeforeExpiredReplay);
  await assert.rejects(
    pool.query(
      "update research_evidence_packs set frozen_research_context = '{}'::jsonb where id = $1",
      [frozen.data.id]
    ),
    /append-only/
  );
  const otherAfterFreeze = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${otherMembershipId}/deep-research`,
    undefined,
    200,
    otherHeaders
  );
  assert.equal(otherAfterFreeze.data.latestPack, null);
  const crossMembershipReport = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${otherMembershipId}/deep-research-reports`,
    reportRequest(otherMembership.data.version, frozen.data, "other-cross-membership-report"),
    422,
    otherHeaders
  );
  assert.match(crossMembershipReport.message, /evidence pack does not match/);
  const crossMembershipEvent = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${otherMembershipId}/research-events`,
    {
      membershipVersion: otherMembership.data.version,
      materialId: firstMaterial.id,
      eventKind: "announcement",
      coverageScope: "research_stock",
      idempotencyKey: "other-cross-membership-event"
    },
    422,
    otherHeaders
  );
  assert.match(crossMembershipEvent.message, /material is missing/);
  const ownerPdfEvent = await request(
    "POST",
    `/api/mobile/research/candidate-memberships/${membershipId}/research-events`,
    {
      membershipVersion: metadata.membershipVersion,
      materialId: secondConfirm.json().data.id,
      eventKind: "announcement",
      coverageScope: "research_stock",
      idempotencyKey: "owner-pdf-event-remains-ineligible"
    },
    422
  );
  assert.match(ownerPdfEvent.failures.join("\n"), /event material is not verified/);

  const supersedingSource = await confirm(membershipId, document.id, {
    membershipVersion: metadata.membershipVersion,
    pageNumber: 1,
    quote: "Unique quote.",
    statement: "A later Owner transcription supersedes the prior source material.",
    validUntil: "2027-08-01T00:00:00.000Z",
    replacesMaterialId: secondConfirm.json().data.id,
    idempotencyKey: "confirm-source-after-fundamentals"
  });
  assert.equal(supersedingSource.statusCode, 200, supersedingSource.body);
  const supersededSourceScenario = await scenario(membershipId, {
    ...scenarioPayload(
      metadata.membershipVersion,
      revenueCurrent.json().data.id,
      "valuation-superseded-source"
    ),
    replacesScenarioSetId: scenarioSuccessor.id
  });
  assert.equal(supersededSourceScenario.statusCode, 409);
  assert.equal(supersededSourceScenario.json().code, "ANCHOR_SOURCE_SUPERSEDED");
  const supersededScenarioReadBack = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/valuation-scenarios`
  );
  const supersededScenario = supersededScenarioReadBack.scenarioSets.find((item) => item.id === scenarioSuccessor.id);
  assert.equal(supersededScenario.recomputable, false);
  assert.deepEqual(supersededScenario.invalidatedBy, ["anchor_source_superseded"]);
  const historicalFundamentals = await request(
    "GET",
    `/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`
  );
  assert.equal(
    historicalFundamentals.values
      .filter((value) => value.valueState !== "replaced")
      .every((value) => value.valueState === "historical_source_superseded"),
    true
  );
  assert.equal(
    historicalFundamentals.derivations.every((item) => item.status === "not_comparable"),
    true
  );

  const auditCounts = await pool.query(
    `select event_type, count(*)::int as count
       from research_write_audit_events
      where event_type in (
        'research_document_imported',
        'research_material_created',
        'research_fundamental_value_created',
        'research_valuation_scenario_created'
      )
      group by event_type`
  );
  assert.deepEqual(
    Object.fromEntries(auditCounts.rows.map((row) => [row.event_type, row.count])),
    {
      research_document_imported: 5,
      research_fundamental_value_created: 11,
      research_material_created: 5,
      research_valuation_scenario_created: 5
    }
  );
  const persistedCounts = await pool.query(
    `select
       (select count(*)::int from research_documents) as documents,
       (select count(*)::int from research_document_pages) as pages,
       (select count(*)::int from research_materials where citation_document_id is not null) as cited_materials`
  );
  assert.deepEqual(persistedCounts.rows[0], { documents: 3, pages: 7, cited_materials: 4 });
  const privateBindings = await pool.query(
    `select id, candidate_membership_id
       from research_materials
      where citation_document_id is not null
      order by id`
  );
  assert.deepEqual(
    privateBindings.rows.map((row) => String(row.candidate_membership_id)),
    [membershipId, membershipId, otherMembershipId, membershipId]
  );
  await assert.rejects(
    pool.query("update research_documents set title = 'mutated' where id = $1", [document.id]),
    /append-only/
  );

  const orphanPdf = fixturePdf(["CAS is written before the PostgreSQL transaction."]);
  const orphanHash = createHash("sha256").update(orphanPdf).digest("hex");
  const failingPool = {
    query: pool.query.bind(pool),
    async connect() {
      return {
        async query(sql) {
          if (sql === "begin") throw new Error("synthetic PostgreSQL transaction failure");
          if (sql === "rollback") return { rows: [] };
          throw new Error("unexpected query after synthetic PostgreSQL failure");
        },
        release() {}
      };
    }
  };
  await assert.rejects(
    importResearchDocument(
      failingPool,
      membershipId,
      {
        membershipVersion: metadata.membershipVersion,
        title: "Orphan visibility fixture",
        publishedAt: metadata.publishedAt,
        sourceVersion: "orphan-fixture-v1",
        rightsConfirmed: true,
        idempotencyKey: "orphan-fixture"
      },
      "orphan-fixture.pdf",
      orphanPdf,
      { actorType: "user", actorId: "owner-local" },
      {
        rawStoreRoot,
        repositoryRoot,
        maxBytes: 1_000_000,
        maxPages: 10,
        maxPageTextCharacters: 10_000,
        maxTotalTextCharacters: 20_000
      }
    ),
    /synthetic PostgreSQL transaction failure/
  );
  await access(join(rawStoreRoot, orphanHash.slice(0, 2), orphanHash));
  assert.equal((await pool.query("select count(*)::int as count from research_documents")).rows[0].count, 3);

  const otherActorRead = await app.inject({
    method: "GET",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents`,
    headers: { "x-internal-token": otherActorToken }
  });
  assert.equal(otherActorRead.statusCode, 404);

  const rawPath = join(rawStoreRoot, document.pdfSha256.slice(0, 2), document.pdfSha256);
  await writeFile(rawPath, Buffer.from("tampered"));
  const tamperedList = await app.inject({
    method: "GET",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents`,
    headers
  });
  assert.equal(tamperedList.statusCode, 200);
  assert.equal(
    tamperedList.json().documents.find((item) => item.id === document.id)?.sourceState,
    "corrupt"
  );
  const tamperedContent = await app.inject({
    method: "GET",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents/${document.id}/content`,
    headers
  });
  assert.equal(tamperedContent.statusCode, 503);
  assert.equal(tamperedContent.json().code, "RAW_CONTENT_HASH_MISMATCH");
  const tamperedPage = await app.inject({
    method: "GET",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents/${document.id}/pages/1`,
    headers
  });
  assert.equal(tamperedPage.statusCode, 503);
  assert.equal(tamperedPage.json().code, "RAW_CONTENT_HASH_MISMATCH");
  const tamperedConfirm = await confirm(membershipId, document.id, {
    ...firstConfirmPayload,
    idempotencyKey: "confirm-tampered-raw"
  });
  assert.equal(tamperedConfirm.statusCode, 503);
  assert.equal(tamperedConfirm.json().code, "RAW_CONTENT_HASH_MISMATCH");

  await rm(rawPath);
  const missingPage = await app.inject({
    method: "GET",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents/${document.id}/pages/1`,
    headers
  });
  assert.equal(missingPage.statusCode, 503);
  assert.equal(missingPage.json().code, "RAW_CONTENT_MISSING");
  const missingConfirm = await confirm(membershipId, document.id, {
    ...firstConfirmPayload,
    idempotencyKey: "confirm-missing-raw"
  });
  assert.equal(missingConfirm.statusCode, 503);
  assert.equal(missingConfirm.json().code, "RAW_CONTENT_MISSING");

  await verifyLimitedResearchJourney();
  console.log(JSON.stringify({
    ok: true,
    limitedResearchTaskApiJourney: true,
    fixtureOnly: true,
    migrations: [
      "019_research_pdf_documents.sql",
      "020_research_structured_fundamentals.sql",
      "021_research_valuation_scenarios.sql",
      "022_research_frozen_technical_evidence.sql",
      "023_deep_research_report_contract.sql"
    ],
    membershipId,
    documentId: document.id,
    pages: 3,
    citedMaterials: 4,
    actorMembershipIsolation: true,
    researchUpdateSnapshotAndReportTransaction: true,
    providerResponseIsFixtureOnly: true,
    structuredFundamentalsFreshReadBack: true,
    structuredFundamentalsRestartPersistence: true,
    structuredFundamentalsDeterministicReplacement: true,
    structuredFundamentalsStaleSourceFailClosed: true,
    citedValuationScenarioFreshGet: true,
    citedValuationScenarioSingleRootAndSuccessor: true,
    citedValuationScenarioFreshnessInvalidation: true,
    frozenTechnicalEvidenceFreshGet: true,
    frozenTechnicalEvidenceReplayReevaluatesCurrentness: true,
    frozenTechnicalEvidenceConcurrentReplaySingleAudit: true,
    frozenTechnicalEvidenceExplicitRefreeze: true,
    evidenceBoundReportBindingMismatchZeroWrite: true,
    evidenceBoundReportIdempotentReplayFreshRead: true,
    evidenceBoundReportReplayLeavesStockProfileUnchanged: true,
    evidenceBoundReportConcurrentDecisionReplaySingleAudit: true,
    incompleteResearchConfirmationBlocked: true,
    replayDecisionKind: "rejected",
    evidenceBoundReportHistoryAndLegacyMapping: true,
    evidenceBoundReportDecisionHistory: true,
    deduplicatedKeysConsumed: true,
    concurrentDedupAudited: true,
    unverifiedIssuerStatementFrozenWithoutVerificationUpgrade: true,
    pgFailureLeftInvisibleCasOrphan: true,
    rawPageAndConfirmFailClosed: true,
    realRuntime: false,
    userAcceptance: false
  }, null, 2));
} finally {
  if (app) await app.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  if (weeklyBridge.listening) await new Promise((resolve) => weeklyBridge.close(resolve));
  postgres("dropdb", ["--if-exists", "--force", databaseName], true);
  await rm(rawStoreRoot, { recursive: true, force: true });
}

function serverConfig() {
  return {
    repositoryRoot,
    databaseUrl,
    nodeEnv: "development",
    host: "127.0.0.1",
    port: 0,
    stagingReadOnlyMode: false,
    stagingIdentity: "research-document-local-verification",
    marketProvider: "futu-http",
    futuMarketDataUrl: `http://127.0.0.1:${weeklyBridge.address().port}`,
    quoteLiveMaxAgeSeconds: 300,
    pinganCurrentPortfolioEnabled: false,
    pinganCurrentMaxAgeSeconds: 300,
    quantEvidence: null,
    writeAuthToken: null,
    writeAuthHeaderName: "x-internal-token",
    stagingReadOnlyAuthToken: null,
    stagingReadOnlyAuthHeaderName: "x-internal-token",
    authSigningKey,
    authVerificationKeys: [],
    authRevokedTokenIds: new Set(),
    allowLegacyWriteTokenForScopedLanes: false,
    requireWriteAuth: true,
    writeActorId: "research-document-system",
    researchDocumentRawStoreRoot: rawStoreRoot,
    researchDocumentMaxBytes: 1_000_000,
    researchDocumentMaxPages: 10,
    researchDocumentMaxPageTextCharacters: 10_000,
    researchDocumentMaxTotalTextCharacters: 20_000
  };
}

function fundamentalPayload(membershipVersion, sourceMaterialId, metric, periodStart, periodEnd, value) {
  return {
    membershipVersion,
    sourceMaterialId,
    metric,
    periodKind: "duration",
    periodStart,
    periodEnd,
    currency: "HKD",
    unitScale: 1_000_000,
    scope: "consolidated",
    valueStatus: "reported",
    value,
    comparability: "comparable",
    comparabilityReason: null,
    amendmentKind: "initial",
    replacesValueId: null,
    ownerConfirmed: true,
    idempotencyKey: `fundamental-${metric}-${periodEnd}`
  };
}

async function fundamental(membershipId, payload, requestHeaders = headers) {
  return app.inject({
    method: "POST",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`,
    headers: requestHeaders,
    payload
  });
}

function scenarioPayload(membershipVersion, anchorValueId, idempotencyKey) {
  return {
    membershipVersion,
    symbol: "HK.09926",
    anchorValueId,
    replacesScenarioSetId: null,
    assumptions: {
      metricCurrency: "HKD",
      baseMetricPerShare: 12.5,
      annualGrowthRate: 0.1,
      horizonYears: 3,
      terminalMultiple: 18,
      annualDiscountRate: 0.12,
      netCashPerShare: 2,
      growthRateStep: 0.03,
      multipleStep: 2
    },
    ownerConfirmed: true,
    idempotencyKey
  };
}

async function scenario(membershipId, payload, requestHeaders = headers) {
  return app.inject({
    method: "POST",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/valuation-scenarios`,
    headers: requestHeaders,
    payload
  });
}

function token(actorId, scopes) {
  return createScopedResearchToken({
    version: 2,
    tokenId: `${actorId}-${randomUUID()}`,
    actorId,
    scopes,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 600
  }, authSigningKey);
}

async function request(method, url, payload, expectedStatus = 200, requestHeaders = headers) {
  const response = await app.inject({
    method,
    url,
    headers: requestHeaders,
    ...(payload === undefined ? {} : { payload })
  });
  assert.equal(response.statusCode, expectedStatus, `${method} ${url}: ${response.body}`);
  return response.json();
}

async function importPdf(membershipId, documentMetadata, bytes, requestHeaders = headers) {
  const upload = multipart([
    fieldPart("metadata", JSON.stringify(documentMetadata)),
    filePart("file", "official-report.pdf", "application/pdf", bytes)
  ]);
  return app.inject({
    method: "POST",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents`,
    headers: { ...requestHeaders, "content-type": upload.contentType },
    payload: upload.body
  });
}

async function confirm(membershipId, documentId, payload, requestHeaders = headers) {
  return app.inject({
    method: "POST",
    url: `/api/mobile/research/candidate-memberships/${membershipId}/documents/${documentId}/confirmed-facts`,
    headers: requestHeaders,
    payload
  });
}

function freezePayload(membershipVersion, valuationScenario, technical, idempotencyKey) {
  return {
    membershipVersion,
    expectedScenarioId: valuationScenario.id,
    expectedScenarioRevision: valuationScenario.revision,
    expectedValuationMethods: [valuationScenario, ...currentValuationMethods.filter((item) => item.calculation.method.id !== valuationScenario.calculation.method.id)]
      .map((item) => ({ scenarioId: item.id, scenarioRevision: item.revision, methodId: item.calculation.method.id })),
    expectedWeinstein: currentWeinstein,
    expectedTechnicalSnapshotSha: technical.dailyBars.snapshot.snapshotSha,
    expectedTechnicalResultHash: technical.technical.resultHash,
    idempotencyKey
  };
}

async function evidencePackWriteCounts(database) {
  const result = await database.query(
    `select
       (select count(*)::int from research_evidence_packs) as packs,
       (select count(*)::int
          from research_write_audit_events
         where event_type = 'evidence_pack_frozen') as audits`
  );
  return result.rows[0];
}

async function waitUntilAfter(value) {
  const remaining = Date.parse(value) - Date.now() + 50;
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function reportRequest(membershipVersion, pack, idempotencyKey) {
  const materialClaims = pack.items.map((item) => ({
    statement: item.summary,
    evidenceIds: [item.evidenceId],
    sourceKind: "material",
    claimType: item.claimType,
    stance: item.stance
  }));
  const unknowns = ["macro", "industry", "event", "risk", "counterevidence"]
    .map((key) => ({
      statement: `${key}=source_missing/UNKNOWN`,
      evidenceIds: [],
      sourceKind: "source_missing",
      claimType: "UNKNOWN",
      stance: "UNKNOWN"
    }));
  const applicableUntil = pack.items
    .map((item) => item.validUntil)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  return {
    membershipVersion,
    evidencePackId: pack.id,
    reportContractVersion: "2026-07-30.s1e-evidence-bound-two-layer-report.v1",
    evidencePackBinding: evidenceBoundReportPackBinding(pack),
    reproducibility: {
      generationMethod: "deterministic_frozen_fact_framework",
      model: "NOT_USED",
      prompt: "NOT_USED",
      provider: "NOT_USED",
      tokenUsage: "NOT_USED",
      cost: "NOT_USED"
    },
    adviceLayer: {
      conclusion: "Fixture-only Owner-edited neutral conclusion; not a trade signal.",
      confidence: "UNKNOWN",
      applicableUntil,
      horizonStatement: "Long-term and medium-short-term views are explicitly separate.",
      longTerm: {
        view: "Long-term neutral pending exact source verification.",
        conditions: ["The exact frozen valuation assumptions remain current."],
        invalidationConditions: ["Scenario or evidence pack binding drifts."],
        risks: ["risk=source_missing/UNKNOWN"]
      },
      mediumShortTerm: {
        view: "Medium-short-term neutral; technical context is research-only.",
        conditions: ["The exact technical snapshot and result remain current."],
        invalidationConditions: ["Technical snapshot or result drifts."],
        risks: ["risk=source_missing/UNKNOWN"]
      },
      conflict: {
        status: "UNKNOWN",
        description: "counterevidence=source_missing/UNKNOWN"
      },
      automaticTradingSignal: false
    },
    researchLayer: {
      fundamentals: materialClaims,
      eventsAndCatalysts: [],
      risks: [],
      counterevidence: [],
      unknowns,
      sourceConflicts: [],
      nextValidationQuestions: ["Which exact missing source should the Owner verify next?"]
    },
    changeFromPrevious: "Initial fixture.",
    idempotencyKey
  };
}

function legacyReportPayload() {
  return {
    researchQuestion: "Historical legacy fixture.",
    cutoffAt: new Date().toISOString(),
    investmentThesis: "Legacy rows remain readable only as historical.",
    factTable: [],
    supportEvidenceIds: [],
    counterEvidenceIds: [],
    sourceConflictAssessment: "UNKNOWN",
    sourceConflicts: [],
    unknownItems: ["UNKNOWN"],
    keyDrivers: [],
    causalChain: [],
    valuationScenarios: [],
    impliedExpectations: [],
    invalidationConditions: ["Legacy contract is not formalizable."],
    changeFromPrevious: "Historical fixture.",
    portfolioImpact: ["No portfolio mutation."],
    nextValidationQuestions: ["Migrate only through a new explicit report version."],
    modelInferences: []
  };
}

function multipart(parts) {
  const boundary = `ResearchDocument-${randomUUID()}`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      ...parts.flatMap((part) => [Buffer.from(`--${boundary}\r\n`), part, Buffer.from("\r\n")]),
      Buffer.from(`--${boundary}--\r\n`)
    ])
  };
}

function fieldPart(name, value) {
  return Buffer.from(
    `Content-Disposition: form-data; name="${name}"\r\n`
    + "Content-Type: application/json\r\n\r\n"
    + value
  );
}

function filePart(name, filename, mime, bytes) {
  return Buffer.concat([
    Buffer.from(
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`
      + `Content-Type: ${mime}\r\n\r\n`
    ),
    bytes
  ]);
}

function fixturePdf(pageTexts) {
  const objects = [];
  const pageObjectNumbers = pageTexts.map((_, index) => 3 + index * 2);
  const fontObjectNumber = 3 + pageTexts.length * 2;
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers.map((value) => `${value} 0 R`).join(" ")}] /Count ${pageTexts.length} >>\nendobj\n`);
  pageTexts.forEach((text, index) => {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = pageObjectNumber + 1;
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "";
    objects.push(
      `${pageObjectNumber} 0 obj\n`
      + `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] `
      + `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> `
      + `/Contents ${contentObjectNumber} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentObjectNumber} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\n`
      + `stream\n${stream}\nendstream\nendobj\n`
    );
  });
  objects.push(`${fontObjectNumber} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output);
}

function localDatabaseUrl(name) {
  const host = endpoint.host === "::1" ? "[::1]" : endpoint.host;
  const password = endpoint.password ? `:${encodeURIComponent(endpoint.password)}` : "";
  return `postgresql://${encodeURIComponent(endpoint.user)}${password}@${host}:${endpoint.port}/${name}`;
}

function postgres(command, args, ignoreFailure = false) {
  try {
    execFileSync(command, ["--host", endpoint.host, "--port", endpoint.port, "--username", endpoint.user, ...args], {
      env: commandEnvironment(),
      stdio: ignoreFailure ? "ignore" : "pipe"
    });
  } catch (error) {
    if (!ignoreFailure) throw error;
  }
}

function commandEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && !key.startsWith("PG")));
  if (endpoint.password) env.PGPASSWORD = endpoint.password;
  delete env.PSQLRC;
  return env;
}

function weeklyFixture(analysisAsOf) {
  const end = Date.parse(`${completedWeekEnd(analysisAsOf)}T00:00:00.000Z`);
  const series = (symbol, initial, growth, adjustment) => ({
    symbol, name: `Fixture-only ${symbol}`, adjustment,
    bars: Array.from({ length: 60 }, (_, index) => {
      const close = initial * (1 + growth) ** Math.max(0, index - 39) * (1 + Math.sin(index * 2 * Math.PI / 3) * 0.01);
      return { session: new Date(end - (59 - index) * 7 * 86400000).toISOString().slice(0, 10),
        open: close * 0.99, high: close * 1.02, low: close * 0.98, close, volume: index === 59 ? 2000000 : 1000000 };
    })
  });
  return { provider: "futu_opend", endpoint: "weinstein-weekly", rights: "confirmed", retention: "confirmed", derivedUse: "confirmed",
    fetchedAt: `${analysisAsOf}T00:00:00+08:00`, analysisAsOf, sectorIdentityAsOf: analysisAsOf,
    stock: series("HK.09926", 10, 0.012, "forward_qfq_research_only"),
    marketBenchmark: series("HK.800000", 30000, -0.002, "none_index_or_sector"),
    sectorBenchmark: series("HK.LIST123", 1000, 0.006, "none_index_or_sector") };
}

async function verifyResearchUpdateSnapshot(membershipId, pack, priorReport) {
  const actor = { actorType: "user", actorId: "owner-local" };
  const intent = defaultDeepResearchTaskIntent(pack, {
    id: priorReport.id, version: priorReport.version, evidencePackId: priorReport.evidencePackId,
    reportFingerprint: priorReport.reportFingerprint
  });
  intent.providerAuthorization.ownerConfirmed = true;
  intent.providerAuthorization.confirmedIntentFingerprint = deepResearchProviderAuthorizationFingerprint(intent);
  const expected = { membershipVersion: pack.membershipVersion, evidencePackId: pack.id,
    evidencePackFingerprint: pack.packFingerprint, intent };
  const snapshot = await readCurrentDeepResearchSnapshot(pool, membershipId, expected, actor);
  assert.equal(snapshot.priorReportSummary.conclusion, priorReport.payload.investmentThesis);
  const legacy = await readCurrentDeepResearchSnapshot(pool, membershipId, { ...expected, analysisContentVersion: null }, actor);
  assert.equal(legacy.analysisContentVersion, undefined);
  assert.equal(legacy.priorReportSummary, undefined);
  assert.notEqual(legacy.snapshotId, snapshot.snapshotId);
  assert.equal((await readCurrentDeepResearchSnapshot(pool, membershipId, { ...expected, analysisContentVersion: null }, actor)).snapshotId, legacy.snapshotId);
  const providerPayload = {
    adviceLayer: { ...priorReport.payload.adviceLayer,
      direction: "wait_for_evidence", priceConditions: ["UNKNOWN until company evidence is complete"], priceRange: "UNKNOWN",
      researchPositionRange: "UNKNOWN", assumptions: ["Fixture-only assumptions"], scenarios: ["Fixture-only limited case"],
      nextQuestion: "Which missing source should be verified?", versionChange: "Prior provisional judgment remains unconfirmed." },
    researchLayer: { fundamentals: [], context: [], eventsAndCatalysts: [], operatingMonitor: [], risks: [], counterevidence: [],
      unknowns: [], sourceConflicts: [], nextValidationQuestions: ["Verify the missing company evidence."] },
    changeFromPrevious: "Fixture-only response: prior provisional judgment remains unconfirmed."
  };
  const synthesis = await generateDeepResearchSynthesisWithAi(snapshot, {
    baseUrl: "https://example.invalid/fixture-only", apiKey: "REDACTED_SECRET", model: "deepseek-flash", timeoutMs: 1000
  }, async (_url, init) => {
    const sent = JSON.parse(JSON.parse(init.body).messages[1].content).selectedSnapshot;
    assert.deepEqual(sent.priorReportSummary, snapshot.priorReportSummary);
    assert.match(sent.analysis.valuation[0].statement, /每股研究情景值/);
    return { ok: true, json: async () => ({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(providerPayload) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) };
  });
  const request = { membershipVersion: pack.membershipVersion, evidencePackId: pack.id, idempotencyKey: "fixture-update-absorption",
    reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION, snapshot,
    reproducibility: synthesis.reproducibility, sendManifest: synthesis.sendManifest, providerPayload: synthesis.payload };
  const client = await pool.connect();
  try {
    await client.query("begin");
    const forged = structuredClone(snapshot);
    forged.priorReportSummary.conclusion = "Tampered previous judgment";
    forged.snapshotId = computeDeepResearchSnapshotId(deepResearchSnapshotHashInput(forged));
    await assert.rejects(createDeepResearchReportInTransaction(client, membershipId, { ...request, snapshot: forged }, actor),
      /does not match current server evidence and prior judgment/);
    const report = await createDeepResearchReportInTransaction(client, membershipId, request, actor);
    assert.equal(report.data.payload.snapshot.snapshotId, snapshot.snapshotId);
    assert.equal(report.data.status, "evidence_insufficient");
    assert.match(report.data.payload.researchLayer.valuation[0].statement, /每股研究情景值/);
    assert.equal(report.data.payload.changeFromPrevious, providerPayload.changeFromPrevious);
  } finally {
    try { await client.query("rollback"); } finally { client.release(); }
  }
}

async function verifyLimitedResearchJourney() {
  // Run the real worker once with a simulated provider; disable the background worker in this disposable test server.
  await app.close();
  app = await buildServer({ ...serverConfig(), nodeEnv: "test" });
  const member = (await request("POST", "/api/mobile/research/candidate-memberships", {
    market: "HK", code: "00700", initialState: "tracked", idempotencyKey: "limited-membership"
  }, 201)).data;
  const base = `/api/mobile/research/candidate-memberships/${member.id}`;
  await request("POST", `${base}/evidence-packs`, {
    researchMode: "limited", membershipVersion: member.version, idempotencyKey: "limited-empty"
  }, 422);
  await request("POST", "/api/mobile/research/profiles/HK/00700/materials", {
    membershipId: member.id, membershipVersion: member.version, title: "Limited fixture source",
    contentText: "Fixture-only issuer statement: subscription revenue increased; margins and valuation are not provided.",
    sourceType: "fixture_authorized_public", sourceUrl: "https://example.invalid/limited-source",
    publishedAt: "2026-07-01T00:00:00.000Z", claimType: "issuer_statement", verificationStatus: "verified",
    rightsStatus: "authorized_public", sourceVersion: "limited-v1", replacesMaterialId: null,
    validUntil: new Date(Date.now() + 86400000).toISOString(), summary: "Issuer reports subscription growth; margin evidence is missing.",
    variableName: null, stance: "support", reliability: 4, materiality: 3, isRead: true, idempotencyKey: "limited-material"
  });
  const freeze = { researchMode: "limited", membershipVersion: member.version, idempotencyKey: "limited-freeze" };
  const pack = (await request("POST", `${base}/evidence-packs`, freeze)).data;
  assert.equal(pack.researchMode, "limited");
  assert.equal(pack.frozenResearchContext, null);
  assert.equal(pack.currentness.status, "current");
  assert.equal((await request("POST", `${base}/evidence-packs`, freeze)).data.id, pack.id);
  await request("POST", "/api/mobile/research/cloud-ai-policy/decisions", {
    action: "enable", policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION, backupProvider: "none", ownerConfirmed: true,
    idempotencyKey: "limited-fixture-cloud-policy"
  });
  const intent = defaultDeepResearchTaskIntent(pack);
  intent.providerAuthorization.ownerConfirmed = true;
  intent.providerAuthorization.confirmedIntentFingerprint = deepResearchProviderAuthorizationFingerprint(intent);
  const body = { membershipVersion: member.version, evidencePackId: pack.id, evidencePackBinding: deepResearchPackBinding(pack),
    intent, reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION, idempotencyKey: "limited-task" };
  let task = (await request("POST", `${base}/deep-research-tasks`, body, 202)).data;
  assert.equal(task.status, "pending");
  assert.equal((await request("POST", `${base}/deep-research-tasks`, body, 202)).data.id, task.id);
  await readCurrentDeepResearchSnapshot(pool, member.id, { membershipVersion: member.version, evidencePackId: pack.id, evidencePackFingerprint: pack.packFingerprint, intent }, { actorType: "user", actorId: "owner-local" });
  let observedSnapshot;
  const providerConfig = { baseUrl: "https://example.invalid/fixture-only", apiKey: "REDACTED_SECRET", model: "deepseek-flash", timeoutMs: 1000 };
  const execution = {
    claim: claimDeepResearchTask, bindSnapshot: bindDeepResearchTaskSnapshot, assembleSnapshot: readCurrentDeepResearchSnapshot,
    storeSynthesis: storeDeepResearchTaskSynthesis, fail: failDeepResearchTask, providerConfig,
    synthesize: async (snapshot, config, _fetch, onPrepared, authorization) => {
      observedSnapshot = snapshot;
      assert.equal(snapshot.researchContext, null);
      assert.equal(snapshot.fundamentals.facts.length, 0);
      assert.equal(snapshot.fundamentals.dataCutoffAt, null);
      return generateDeepResearchSynthesisWithAi(snapshot, config, async (_url, init) => {
        const input = JSON.parse(JSON.parse(init.body).messages[1].content);
        assert.equal(input.selectedSnapshot.evidencePack.researchMode, "limited");
        assert.equal(input.selectedSnapshot.fundamentals, null);
        assert.deepEqual(input.selectedSnapshot.analysis.valuation, []);
        assert.equal(input.selectedSnapshot.analysis.technical, null);
        const source = input.exactSourceBindings.find((item) => item.sourceKind === "material");
        const view = { view: "Growth is an issuer claim that needs margin corroboration.", conditions: ["Source remains valid."],
          invalidationConditions: ["A later disclosure contradicts growth."], risks: ["Missing margin evidence."] };
        const payload = {
          adviceLayer: { conclusion: "Subscription growth supports further research; profitability remains unproven.", confidence: "low",
            applicableUntil: pack.items[0].validUntil, horizonStatement: "Limited review of one source.", longTerm: view, mediumShortTerm: view,
            conflict: { status: "UNKNOWN", description: "Independent corroboration missing." }, direction: "wait_for_evidence",
            priceConditions: ["Obtain valuation and current quote before price judgment."], priceRange: "UNKNOWN", researchPositionRange: "UNKNOWN",
            assumptions: ["Issuer statement requires verification."], scenarios: ["Growth without margin improvement may not improve value."],
            nextQuestion: "Verify the latest disclosed margin.", versionChange: "First limited review.", automaticTradingSignal: false },
          researchLayer: { fundamentals: [{ statement: "Issuer material reports subscription growth; margins remain unverified.", ...source }], context: [], eventsAndCatalysts: [], operatingMonitor: [],
            risks: [{ statement: "Growth claim does not establish profitability.", ...source }], counterevidence: [], unknowns: [], sourceConflicts: [],
            nextValidationQuestions: ["Verify the latest disclosed margin."] }, changeFromPrevious: "First limited review."
        };
        return { ok: true, json: async () => ({ model: config.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) };
      }, onPrepared, authorization);
    }
  };
  assert.equal(await runDeepResearchTaskOnce(pool, new Date(), execution), true);
  let ready = (await request("GET", `${base}/deep-research-tasks/${task.id}`)).data;
  assert.equal(ready.status, "ready_to_absorb", JSON.stringify(ready));
  const canceled = (await request("POST", `${base}/deep-research-tasks/${task.id}/cancel`, {
    membershipVersion: member.version, taskRequestFingerprint: ready.requestFingerprint,
    reason: "user_rejected", idempotencyKey: "limited-reject-draft"
  })).data;
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.synthesis.tokenUsage, ready.synthesis.tokenUsage);
  assert.equal(canceled.synthesis.cost, ready.synthesis.cost);
  assert.deepEqual(canceled.synthesis.sendManifest, ready.synthesis.sendManifest);
  const canceledStorage = (await pool.query("select request_payload from deep_research_tasks where id = $1", [task.id])).rows[0].request_payload;
  assert.equal(canceledStorage.synthesis, undefined);
  assert.equal(canceledStorage.sendReceipt.tokenUsage, ready.synthesis.tokenUsage);
  const previousTaskId = task.id;
  task = (await request("POST", `${base}/deep-research-tasks`, { ...body, idempotencyKey: "limited-restart" }, 202)).data;
  assert.equal(task.previousTaskId, previousTaskId);
  assert.equal(task.synthesis, null);
  assert.equal(await runDeepResearchTaskOnce(pool, new Date(), execution), true);
  ready = (await request("GET", `${base}/deep-research-tasks/${task.id}`)).data;
  assert.equal(ready.status, "ready_to_absorb");

  const absorb = { membershipVersion: member.version, taskRequestFingerprint: ready.requestFingerprint,
    snapshotId: observedSnapshot.snapshotId, idempotencyKey: "limited-absorb" };
  const absorbed = (await request("POST", `${base}/deep-research-tasks/${task.id}/absorb`, absorb)).data;
  assert.equal(absorbed.status, "succeeded");
  assert.equal((await request("POST", `${base}/deep-research-tasks/${task.id}/absorb`, absorb)).data.report.id, absorbed.report.id);
  const workspace = await request("GET", `${base}/deep-research`);
  const report = workspace.data.latestReport;
  assert.equal(report.currentness.status, "current", JSON.stringify(report.currentness));
  assert.equal(report.status, "evidence_insufficient");
  assert.equal(report.payload.adviceLayer.direction, "wait_for_evidence");
  assert.deepEqual(report.payload.researchLayer.valuation, []);
  assert.deepEqual(report.payload.researchLayer.technical, []);
  assert.equal(deepResearchReportSummary(workspace.data).conclusion, report.payload.adviceLayer.conclusion);
  await request("POST", `${base}/deep-research-reports/${report.id}/decisions`, {
    membershipVersion: member.version, decision: "confirmed", idempotencyKey: "limited-confirm-forbidden"
  }, 422);
  assert.equal((await pool.query("select count(*)::int as count from deep_research_report_decisions where report_id = $1", [report.id])).rows[0].count, 0);
  const forged = structuredClone(report.payload);
  forged.adviceLayer.direction = "buy";
  assert.ok(synthesizedDeepResearchReportIntegrityFailures(forged, pack).length > 0);
  const wrongTarget = structuredClone(observedSnapshot);
  wrongTarget.target.symbol = "HK.00175";
  wrongTarget.snapshotId = computeDeepResearchSnapshotId(deepResearchSnapshotHashInput(wrongTarget));
  assert.equal(validateDeepResearchSnapshotData(wrongTarget).ok, false);
  const promoted = structuredClone(observedSnapshot);
  delete promoted.evidencePack.researchMode;
  promoted.snapshotId = computeDeepResearchSnapshotId(deepResearchSnapshotHashInput(promoted));
  assert.equal(validateDeepResearchSnapshotData(promoted).ok, false);
  await pool.query("update research_materials set valid_until = $1 where id = $2", [new Date(Date.now() - 1000), pack.items[0].id]);
  const stale = await request("GET", `${base}/deep-research`);
  assert.equal(stale.data.latestPack.currentness.status, "historical");
  assert.equal(stale.data.latestReport.currentness.status, "historical");
  assert.equal(deepResearchReportSummary(stale.data), null);

}
