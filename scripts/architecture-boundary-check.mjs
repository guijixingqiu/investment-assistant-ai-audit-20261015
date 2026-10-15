#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isGovernedProductionSourcePath } from "./lib/architecture-source-inventory.mjs";

const fileBudgets = {
  "apps/api/src/portfolio/repository.ts": 10,
  "apps/api/src/portfolio/pinganCurrentPortfolioRepository.ts": 310,
  "apps/api/src/portfolio/pinganHistoricalSnapshotRepository.ts": 310,
  "apps/api/src/research/repository.ts": 40,
  "apps/api/src/research/quantEvidenceSource.ts": 62,
  "apps/api/src/research/repositoryLocalQuantEvidenceSource.ts": 145,
  "apps/api/src/research/researchFixtureSeedRepository.ts": 343,
  "apps/api/src/research/annualPortfolioLabService.ts": 452,
  "apps/api/src/research/annualValuationQuantWorkbenchService.ts": 468,
  "apps/api/src/research/assistHumanReviewWorkspaceService.ts": 553,
  "apps/api/src/research/deepResearchGate.ts": 1104,
  "apps/api/src/research/deepResearchReadRepository.ts": 543,
  "apps/api/src/research/deepResearchReportRepository.ts": 651,
  "apps/api/src/research/deepResearchTaskRepository.ts": 658,
  "apps/api/src/research/deepResearchMaterialRepository.ts": 588,
  "apps/api/src/research/researchCompletenessRepository.ts": 434,
  "apps/api/src/research/researchContextRepository.ts": 557,
  "apps/api/src/research/researchDocumentRepository.ts": 448,
  "apps/api/src/research/todayActionInboxService.ts": 488,
  "apps/api/src/research/authorizedPortfolioDecisionContext.ts": 45,
  "apps/api/src/research/decisionSnapshotBinding.ts": 135,
  "apps/api/src/research/postDecisionPortfolioReviewBinding.ts": 80,
  "apps/api/src/routes/assistWorkflowRoutes.ts": 300,
  "apps/api/src/routes/deepResearchRoutes.ts": 437,
  "apps/api/src/routes/mobileResearch.ts": 52,
  "apps/api/src/routes/todayActionInboxRoutes.ts": 80,
  "apps/api/src/market/weinsteinTechnicalAnalysis.ts": 482,
  "packages/contracts/src/annualConditionalDecisionContract.ts": 895,
  "packages/contracts/src/annualDecisionBrief.ts": 521,
  "packages/contracts/src/annualPortfolioLab.ts": 1033,
  "packages/contracts/src/annualPortfolioLabBrowser.ts": 416,
  "packages/contracts/src/annualValuationQuantWorkbench.ts": 882,
  "packages/contracts/src/deepResearch.ts": 1272,
  "packages/contracts/src/deepResearchTask.ts": 412,
  "packages/contracts/src/deepResearchSnapshot.ts": 522,
  "packages/contracts/src/marketDiscovery.ts": 544,
  "packages/contracts/src/quantDecisionEvidenceContract.ts": 471,
  "packages/contracts/src/researchFundamentals.ts": 541,
  "packages/contracts/src/researchEvidenceQuestion.ts": 485,
  "packages/contracts/src/todayResearch.ts": 575,
  "packages/contracts/src/todayActionInbox.ts": 390,
  "packages/contracts/src/todayReviewDue.ts": 449,
  "packages/contracts/src/researchValuationScenarios.ts": 559,
  "packages/contracts/src/assistAdvisoryScope.ts": 481,
  "packages/contracts/src/assistDecisionNoteWorkflow.ts": 418,
  "packages/contracts/src/assistHumanReviewWorkspace.ts": 677,
  "packages/contracts/src/assistReviewFollowUpWorkflow.ts": 404,
  "packages/contracts/src/assistReviewKnowledge.ts": 536,
  "packages/contracts/src/decisionContextBrowser.ts": 412,
  "packages/contracts/src/decisionQuantEvidenceContract.ts": 251,
  "packages/contracts/src/decisionReview.ts": 664,
  "packages/contracts/src/postDecisionPortfolioReviewContract.ts": 496,
  "packages/contracts/src/portfolioDecisionContext.ts": 430,
  "packages/contracts/src/research.ts": 494,
  "packages/contracts/src/researchContext.ts": 596,
  "packages/contracts/src/weinsteinTechnicalAnalysis.ts": 509,
  "scripts/investment-decision-local-beta-uat-evidence.mjs": 330,
  "apps/web/src/app.ts": 799,
  "apps/web/src/deepResearchConsole.ts": 1662,
  "apps/web/src/deepResearchComparisonConsole.ts": 448,
  "apps/web/src/apiClient.ts": 652,
  "apps/web/src/decisionJourneyIngress.ts": 115,
  "apps/web/src/appPublicApi.ts": 60,
  "apps/web/src/journeyDetails.ts": 50,
  "apps/web/src/appEventBindings.ts": 173,
  "apps/web/src/assistLocalRecordController.ts": 260,
  "apps/web/src/assistReviewKnowledgeController.ts": 300,
  "apps/web/src/assistReviewKnowledgeState.ts": 551,
  "apps/web/src/assistWorkflowController.ts": 260,
  "apps/web/src/candidateWorkflowController.ts": 237,
  "apps/web/src/dailyResearchCockpit.ts": 452,
  "apps/web/src/dailyResearchCockpitBridge.ts": 624,
  "apps/web/src/marketContextConsole.ts": 598,
  "apps/web/src/contractValidation.ts": 468,
  "apps/web/src/webFeaturePanels.ts": 100,
  "apps/web/src/pinganManualSnapshotController.ts": 220,
  "apps/web/src/portfolioWorkspaceController.ts": 530,
  "apps/web/src/reportAssistantConsole.ts": 749,
  "apps/web/src/reportAssistantData.ts": 445,
  "apps/web/src/researchDocumentConsole.ts": 516,
  "apps/web/src/todayActionReviewWorkflow.ts": 426,
  "apps/web/src/coreAssistCapabilityConsoleRenderer.ts": 850,
  "apps/web/src/selectedCandidateWorkflowBridges.ts": 950,
  "apps/web/src/selectedCandidateMembershipGate.ts": 120,
  "apps/web/src/selectedCandidatePanelsRenderer.ts": 450,
  "apps/web/src/coreAssistStatusPanelsRenderer.ts": 800,
  "apps/web/src/assistWorkflowPanelsRenderer.ts": 450,
  "apps/web/src/localStoragePanelsRenderer.ts": 400,
  "apps/web/src/annualConditionalDecisionBrowser.ts": 86,
  "apps/web/src/investmentControlConsoleApiClient.ts": 300,
  "apps/web/src/investmentControlConsoleController.ts": 286,
  "apps/web/src/investmentControlConsoleCoordinator.ts": 193,
  "apps/web/src/investmentControlConsoleForms.ts": 129,
  "apps/web/src/investmentControlConsoleRenderer.ts": 308,
  "apps/web/src/investmentControlConsoleResponseValidation.ts": 87,
  "apps/ios/AnnualRingsGateA/App/GateBResearchScreen.swift": 602,
  "apps/ios/AnnualRingsGateA/App/AnnualRingsGateAApp.swift": 417,
  "apps/ios/AnnualRingsGateA/App/TodayRootView.swift": 513,
  "apps/ios/AnnualRingsGateA/App/GateAMarketScreen.swift": 516,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AssetsAlphaClient.swift": 422,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/GclPvPriceMonitor.swift": 469,
  "apps/ios/AnnualRingsGateA/App/TodayActionInboxCard.swift": 235,
  "apps/ios/AnnualRingsGateA/App/GateBResearchViewModel.swift": 80,
  "apps/ios/AnnualRingsGateA/App/GateBResearchCandidateSections.swift": 337,
  "apps/ios/AnnualRingsGateA/App/AssetsManualSnapshotSection.swift": 448,
  "apps/ios/AnnualRingsGateA/App/AssetsRootView.swift": 408,
  "apps/ios/AnnualRingsGateA/App/GateBResearchContextEditorSection.swift": 478,
  "apps/ios/AnnualRingsGateA/App/GateBResearchDocumentActions.swift": 605,
  "apps/ios/AnnualRingsGateA/App/GateBResearchDocumentsSections.swift": 487,
  "apps/ios/AnnualRingsGateA/App/GateBResearchReportFormalDecision.swift": 586,
  "apps/ios/AnnualRingsGateA/App/GateBResearchReviewHistorySections.swift": 787,
  "apps/ios/AnnualRingsGateA/App/GateBResearchFrozenTechnicalEvidenceSections.swift": 599,
  "apps/ios/AnnualRingsGateA/App/GateBResearchPortfolioReviewWorkflow.swift": 418,
  "apps/ios/AnnualRingsGateA/App/GlobalTools.swift": 518,
  "apps/ios/AnnualRingsGateA/App/GateBResearchToday.swift": 470,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/MarketDailyTechnicalClient.swift": 421,
  "apps/ios/AnnualRingsGateA/App/GateBResearchWorkspaceSections.swift": 530,
  "apps/ios/AnnualRingsGateA/App/MarketDiscoveryCard.swift": 470,
  "apps/ios/AnnualRingsGateA/App/GateBResearchAssistSections.swift": 300,
  "apps/ios/AnnualRingsGateA/App/GateBResearchDecisionSections.swift": 500,
  "apps/ios/AnnualRingsGateA/App/GateBResearchAssistWorkflow.swift": 491,
  "apps/ios/AnnualRingsGateA/App/GateBResearchLocalStateWorkflow.swift": 459,
  "apps/ios/AnnualRingsGateA/App/GateBResearchMembershipWorkflow.swift": 120,
  "apps/ios/AnnualRingsGateA/App/GateBResearchActions.swift": 465,
  "apps/ios/AnnualRingsGateA/App/GateBResearchTwoLayerReportActions.swift": 1054,
  "apps/ios/AnnualRingsGateA/App/GateBResearchDeepResearchJourneySection.swift": 511,
  "apps/ios/AnnualRingsGateA/App/GateBResearchEvidenceQuestionSections.swift": 536,
  "apps/ios/AnnualRingsGateA/App/GateBResearchTwoLayerReportSections.swift": 925,
  "apps/ios/AnnualRingsGateA/App/AnnualDecisionRingsView.swift": 320,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/PortfolioDecisionContext.swift": 500,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/PortfolioRiskImpact.swift": 420,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/PortfolioDecisionClient.swift": 240,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/QuantDecisionEvidenceRefinement.swift": 469,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchClient.swift": 639,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/TodayActionInbox.swift": 334,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchClientTodayActionInbox.swift": 180,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchFrozenTechnicalEvidenceClient.swift": 1045,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchFrozenTechnicalEvidence.swift": 708,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchContext.swift": 704,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchContextWrite.swift": 598,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchEvidenceQuestion.swift": 500,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchDocuments.swift": 546,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchValuationScenarios.swift": 453,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchTwoLayerReport.swift": 855,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchTwoLayerReportClient.swift": 974,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/DeepResearchTaskClient.swift": 939,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/WeinsteinTechnicalAnalysis.swift": 403,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/MarketDiscovery.swift": 463,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchDecisionSnapshotIngress.swift": 326,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchValidationPrimitives.swift": 30,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/FactMetadata.swift": 95,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchModels.swift": 1900,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/TodayResearch.swift": 443,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/TodayReviewDue.swift": 405,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AnnualConditionalDecision.swift": 886,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AnnualDecisionBrief.swift": 688,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AnnualPortfolioLabModels.swift": 487,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AnnualPortfolioLabValidation.swift": 675,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AnnualValuationQuantWorkbench.swift": 688,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AssistAdvisoryScope.swift": 501,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AssistDecisionNoteWorkflow.swift": 574,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AssistHumanReviewWorkspace.swift": 788,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AssistMobileWorkspaceState.swift": 3686,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchArchiveExport.swift": 1591,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchArchiveLocalMemoryRestore.swift": 500,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/AssistReviewFollowUpWorkflow.swift": 521,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/CandidateDecisionIntake.swift": 577,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/CandidateMembership.swift": 671,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/DecisionSnapshot.swift": 533,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/PostDecisionPortfolioReview.swift": 1245,
  "apps/ios/AnnualRingsGateA/App/GateBResearchPortfolioWorkflow.swift": 300,
  "apps/ios/AnnualRingsGateA/App/GateBResearchPortfolioSections.swift": 360,
  "apps/ios/AnnualRingsGateA/App/GateBResearchDailyWorkspaceSections.swift": 436,
  "apps/ios/AnnualRingsGateA/App/GateBResearchDecisionBriefSections.swift": 474,
  "apps/api/src/market/discovery.ts": 459,
  "apps/api/src/research/deepResearchPackRepository.ts": 470,
  "apps/api/src/research/researchEventRepository.ts": 423,
  "apps/ios/AnnualRingsGateA/App/GateBResearchFrozenTechnicalEvidenceActions.swift": 469,
  "apps/ios/AnnualRingsGateA/App/GateBResearchPortfolioLabSections.swift": 488,
  "apps/ios/AnnualRingsGateA/App/GateBResearchPortfolioLabWorkflow.swift": 448,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/FormalDecision.swift": 520,
  "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/PortfolioReportExplanation.swift": 445,
  "apps/web/src/researchDossierView.ts": 450,
  "packages/contracts/src/portfolioReportExplanation.ts": 463
};

const checks = [];
const blockers = [];
const warnings = [];
const largeProductionSourceThreshold = 400;
const trackedProductionSourceFiles = gitTrackedProductionSourceFiles();
const largeProductionSourceFiles = trackedProductionSourceFiles
  .map((path) => ({ path, lines: countLines(read(path)) }))
  .filter(({ lines }) => lines >= largeProductionSourceThreshold);

for (const [path, maxLines] of Object.entries(fileBudgets)) {
  if (!existsSync(path)) {
    check(`${path} exists for its ratcheting line budget`, false, {
      path,
      lines: null,
      maxLines
    }, "advisory");
    continue;
  }
  const lines = countLines(read(path));
  check(`${path} does not exceed its ratcheting line budget`, lines <= maxLines, {
    path,
    lines,
    maxLines
  }, "advisory");
}

const unbudgetedLargeProductionSources = largeProductionSourceFiles.filter(({ path }) => !(path in fileBudgets));
check("every tracked production source file with at least 400 lines has an explicit ratcheting budget", unbudgetedLargeProductionSources.length === 0, {
  threshold: largeProductionSourceThreshold,
  unbudgeted: unbudgetedLargeProductionSources
}, "advisory");

const requestPathSources = [
  "apps/api/src/research/repository.ts",
  "apps/api/src/routes/mobileResearch.ts",
  "apps/api/src/server.ts",
  "apps/api/src/research/decisionContextRepository.ts",
  "apps/api/src/research/decisionContextReadService.ts",
  "apps/api/src/research/decisionQuantEvidenceAdapter.ts",
  "apps/api/src/research/quantEvidenceManifest.ts",
  "apps/api/src/research/annualPortfolioLabQuantEvidence.ts",
  "apps/api/src/research/repositoryLocalQuantEvidenceSource.ts"
].map((path) => ({ path, source: read(path) }));

for (const { path, source } of requestPathSources) {
  check(`${path} has no synchronous filesystem I/O`, !/\b(?:readFileSync|writeFileSync|existsSync)\b/.test(source), { path });
}

const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const eslintConfig = read("eslint.config.mjs");
const ciWorkflow = read(".github/workflows/ci.yml");
check("package and lockfile names match", packageJson.name === packageLock.name && packageJson.name === packageLock.packages?.[""]?.name, {
  packageName: packageJson.name,
  lockName: packageLock.name,
  lockRootName: packageLock.packages?.[""]?.name
});
check("Node 24 is the declared runtime", packageJson.engines?.node === ">=24 <25" && read(".nvmrc").trim() === "24", {
  engines: packageJson.engines?.node,
  nvmrc: read(".nvmrc").trim()
});
check("Docker uses Node 24 in every stage", (read("Dockerfile.staging").match(/^FROM node:24-/gm) ?? []).length === 3, "Dockerfile.staging");
check("CI uses Node 24", read(".github/workflows/ci.yml").includes('node-version: "24"'), ".github/workflows/ci.yml");
check("runtime alignment and reproducible build verification runs in CI",
  packageJson.scripts?.["runtime-alignment-verify"] === "node scripts/runtime-alignment-verify.mjs"
  && ciWorkflow.includes("run: npm run runtime-alignment-verify"), {
    script: packageJson.scripts?.["runtime-alignment-verify"],
    path: ".github/workflows/ci.yml"
  });
const stageEvidenceSource = read("scripts/lib/stage-13-20-evidence.mjs");
check("Stage 13-20 evidence gates bind exact commits and content-addressed artifacts",
  packageJson.scripts?.["stage-13-20-evidence-verify"] === "node scripts/stage-13-20-evidence-verify.mjs"
  && packageJson.scripts?.["controlled-persistence-verify"]?.includes("CONTROLLED-PERSISTENCE-1")
  && packageJson.scripts?.["real-data-quant-verify"]?.includes("REAL-DATA-QUANT-1")
  && packageJson.scripts?.["async-capacity-decision-verify"]?.includes("ASYNC-CAPACITY-DECISION-1")
  && /manifest exact commit/.test(stageEvidenceSource)
  && /artifacts\/stage-13-20/.test(stageEvidenceSource)
  && /realpathSync\(candidate\)/.test(stageEvidenceSource)
  && /isSymbolicLink\(\)/.test(stageEvidenceSource)
  && /readFileSync\(resolved\)/.test(stageEvidenceSource)
  && /measurement\.observed > measurement\.threshold/.test(stageEvidenceSource)
  && /sourceSectionSha256/.test(stageEvidenceSource)
  && /evidenceCommitSha/.test(stageEvidenceSource)
  && /"merge-base", "--is-ancestor"/.test(stageEvidenceSource)
  && /fileBytesAtCommit/.test(stageEvidenceSource)
  && /\["show",/.test(stageEvidenceSource)
  && /"log", "--format=", "--name-only", "--no-renames", "-m", "--ancestry-path"/.test(stageEvidenceSource), {
    path: "scripts/lib/stage-13-20-evidence.mjs"
  });
const capacityProbeSource = read("scripts/lib/sync-capacity-probe.mjs");
check("capacity evidence is collected by a GET-only redacted measured probe",
  packageJson.scripts?.["sync-capacity-probe"] === "node scripts/sync-capacity-probe.mjs"
  && /method: "GET"/.test(capacityProbeSource)
  && /responseBodiesStored: false/.test(capacityProbeSource)
  && /sampleSize < 30/.test(capacityProbeSource)
  && !/method: "(?:POST|PUT|PATCH|DELETE)"/.test(capacityProbeSource), {
  path: "scripts/lib/sync-capacity-probe.mjs"
});
const capacityEvidenceGeneratorSource = read("scripts/async-capacity-evidence.mjs");
check("capacity evidence generation binds distinct immutable source evidence and target commits",
  packageJson.scripts?.["async-capacity-evidence"] === "node scripts/async-capacity-evidence.mjs"
  && /sourceCommitSha/.test(capacityEvidenceGeneratorSource)
  && /evidenceCommitSha/.test(capacityEvidenceGeneratorSource)
  && /targetCommitSha/.test(capacityEvidenceGeneratorSource)
  && /requireCommittedBytes/.test(capacityEvidenceGeneratorSource)
  && /capacityProbeAndRuntimeBuildInputDiffEmpty/.test(read("scripts/lib/async-capacity-evidence.mjs")), {
    path: "scripts/async-capacity-evidence.mjs"
  });
check("code lint is enforced with zero warnings", packageJson.scripts?.["lint:code"] === "eslint apps packages --max-warnings=0", {
  script: packageJson.scripts?.["lint:code"]
});
check("ESLint enforces a general complexity ceiling with an explicit legacy ratchet",
  /max: 40/.test(eslintConfig)
  && /coreAssistCapabilityConsoleRenderer\.ts/.test(eslintConfig)
  && /max: 220/.test(eslintConfig), {
    path: "eslint.config.mjs"
  });
check("core decision-loop boundaries have a tighter explicit complexity ratchet",
  /authorizedPortfolioDecisionContext\.ts/.test(eslintConfig)
  && /decisionJourneyIngress\.ts/.test(eslintConfig)
  && /selectedCandidateMembershipGate\.ts/.test(eslintConfig)
  && /decisionQuantEvidenceContract\.ts/.test(eslintConfig)
  && /max: 25/.test(eslintConfig), {
    path: "eslint.config.mjs"
  });
check("CI runs the complete lint gate", /run: npm run lint/.test(ciWorkflow), {
  path: ".github/workflows/ci.yml"
});
check("risk scan warnings cannot pass the lint gate", packageJson.scripts?.lint?.includes("ci-risk-scan.mjs --max-warnings=0"), {
  script: packageJson.scripts?.lint
});
const healthSource = read("apps/api/src/health.ts");
const migrationRunnerSource = read("scripts/migration-runner.mjs");
const stagingCompose = read("deploy/staging/compose.yml");
check("liveness is dependency-free and readiness probes the database",
  /app\.get\("\/health\/live", async \(\) => livePayload\(\)\)/.test(healthSource)
  && /app\.get\("\/health\/ready"/.test(healthSource)
  && /databaseReadiness\(options\.pool\)/.test(healthSource)
  && /pool\.query\("select 1 as ready"\)/.test(healthSource), {
    path: "apps/api/src/health.ts"
  });
check("migration runner binds checksums under a transaction advisory lock",
  /pg_advisory_xact_lock/.test(migrationRunnerSource)
  && /createHash\("sha256"\)/.test(migrationRunnerSource)
  && /migration checksum mismatch/.test(migrationRunnerSource)
  && /await client\.query\("rollback"\)/.test(migrationRunnerSource), {
    path: "scripts/migration-runner.mjs"
  });
check("API startup is decoupled from the one-shot migration service",
  read("Dockerfile.staging").includes('CMD ["node", "dist/apps/api/src/server.js"]')
  && !read("Dockerfile.staging").includes("npm run migrate &&")
  && /annual-rings-staging-migrate:/.test(stagingCompose)
  && /condition: service_completed_successfully/.test(stagingCompose), {
    paths: ["Dockerfile.staging", "deploy/staging/compose.yml"]
  });
const researchAuthSource = read("apps/api/src/routes/researchAuth.ts");
const appEnvironmentSource = read("apps/ios/AnnualRingsGateA/App/AppEnvironment.swift");
const appCredentialStoreSource = read("apps/ios/AnnualRingsGateA/App/AppCredentialStore.swift");
check("API v2 scoped auth keeps browsing durable and every write scope short-lived, rotatable, and revocable",
  /MAX_READ_ONLY_TOKEN_TTL_SECONDS = 30 \* 24 \* 60 \* 60/.test(researchAuthSource)
  && /MAX_WRITE_TOKEN_TTL_SECONDS = 15 \* 60/.test(researchAuthSource)
  && /payload\.scopes\.every\(\(scope\) => scope === "read"\)/.test(researchAuthSource)
  && /authVerificationKeys/.test(researchAuthSource)
  && /authRevokedTokenIds/.test(researchAuthSource)
  && /payload\.tokenId/.test(researchAuthSource)
  && /requiredScope === "read"/.test(researchAuthSource), {
    path: "apps/api/src/routes/researchAuth.ts"
  });
check("iOS production credentials come only from Keychain with Debug-only ephemeral fallback",
  /SecItemCopyMatching/.test(appCredentialStoreSource)
  && /AppCredentialStore\.readToken/.test(appEnvironmentSource)
  && /if isUITesting/.test(appEnvironmentSource)
  && /#if DEBUG[\s\S]*ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN[\s\S]*#else[\s\S]*return nil[\s\S]*#endif/.test(appEnvironmentSource)
  && /#if DEBUG[\s\S]*ANNUAL_RINGS_DEBUG_WRITE_AUTH_TOKEN[\s\S]*#else[\s\S]*return nil[\s\S]*#endif/.test(appEnvironmentSource)
  && !/UserDefaults/.test(appCredentialStoreSource + appEnvironmentSource)
  && !/ANNUAL_RINGS_(?:WRITE_)?AUTH_TOKEN/.test(appEnvironmentSource), {
    paths: ["apps/ios/AnnualRingsGateA/App/AppCredentialStore.swift", "apps/ios/AnnualRingsGateA/App/AppEnvironment.swift"]
  });
const observabilitySource = read("apps/api/src/observability.ts");
const recoveryEvidenceSource = read("scripts/lib/recovery-evidence.mjs");
check("request failures are correlation-addressable without query-string logging",
  /event: "request_failed"/.test(observabilitySource)
  && /correlationId: request\.id/.test(observabilitySource)
  && /route: request\.routeOptions\.url/.test(observabilitySource)
  && !/route: request\.url/.test(observabilitySource), {
    path: "apps/api/src/observability.ts"
  });
check("recovery evidence binds backup restore and rollback to one exact commit",
  /backup checksum matches bytes/.test(recoveryEvidenceSource)
  && /restore rehearsal passed in isolation/.test(recoveryEvidenceSource)
  && /rollback rehearsal passed in isolation/.test(recoveryEvidenceSource)
  && /rehearsals bind the same commit/.test(recoveryEvidenceSource)
  && /production was not touched/.test(recoveryEvidenceSource), {
    path: "scripts/lib/recovery-evidence.mjs"
  });
check("legacy STATUS is explicitly non-authoritative", read("STATUS.md").includes("Frozen compatibility evidence") && read("STATUS.md").includes("PROJECT_STATE.yaml"), "STATUS.md");

const researchDomainSource = read("apps/api/src/research/domain.ts");
check("research domain has no database or repository dependency", !/\b(?:pg|repository\.js|Pool|PoolClient)\b/.test(researchDomainSource), {
  path: "apps/api/src/research/domain.ts"
});
check("research repository is a compatibility facade", !/\b(?:Pool|query|insert|select|update|delete)\b/i.test(read("apps/api/src/research/repository.ts")), {
  path: "apps/api/src/research/repository.ts"
});
check("research auth depends on domain identity instead of repository", read("apps/api/src/routes/researchAuth.ts").includes('../research/domain.js')
  && !read("apps/api/src/routes/researchAuth.ts").includes('../research/repository.js'), {
  path: "apps/api/src/routes/researchAuth.ts"
});
check("profile read repository is independent from legacy repository", !read("apps/api/src/research/researchProfileReadRepository.ts").includes('./repository.js'), {
  path: "apps/api/src/research/researchProfileReadRepository.ts"
});
check("research write persistence is independent from legacy repository", !read("apps/api/src/research/writePersistence.ts").includes('./repository.js'), {
  path: "apps/api/src/research/writePersistence.ts"
});
check("profile write repository is independent from legacy repository", !read("apps/api/src/research/researchProfileWriteRepository.ts").includes('./repository.js'), {
  path: "apps/api/src/research/researchProfileWriteRepository.ts"
});
check("candidate overview repository is independent from legacy repository", !read("apps/api/src/research/candidateOverviewRepository.ts").includes('./repository.js'), {
  path: "apps/api/src/research/candidateOverviewRepository.ts"
});
check("candidate membership read repository is independent from legacy repository", !read("apps/api/src/research/candidateMembershipReadRepository.ts").includes('./repository.js'), {
  path: "apps/api/src/research/candidateMembershipReadRepository.ts"
});
check("candidate membership persistence is independent from legacy repository", !read("apps/api/src/research/candidateMembershipPersistence.ts").includes('./repository.js'), {
  path: "apps/api/src/research/candidateMembershipPersistence.ts"
});
check("candidate membership write repository is independent from legacy repository", !read("apps/api/src/research/candidateMembershipWriteRepository.ts").includes('./repository.js'), {
  path: "apps/api/src/research/candidateMembershipWriteRepository.ts"
});
check("decision review mappers are independent from legacy repository", !read("apps/api/src/research/decisionReviewMappers.ts").includes('./repository.js'), {
  path: "apps/api/src/research/decisionReviewMappers.ts"
});
check("decision review read repository is independent from legacy repository", !read("apps/api/src/research/decisionReviewReadRepository.ts").includes('./repository.js'), {
  path: "apps/api/src/research/decisionReviewReadRepository.ts"
});
check("decision review persistence is independent from legacy repository", !read("apps/api/src/research/decisionReviewPersistence.ts").includes('./repository.js'), {
  path: "apps/api/src/research/decisionReviewPersistence.ts"
});
check("decision review write repository is independent from legacy repository", !read("apps/api/src/research/decisionReviewWriteRepository.ts").includes('./repository.js'), {
  path: "apps/api/src/research/decisionReviewWriteRepository.ts"
});
check("decision check persistence is independent from legacy repository", !read("apps/api/src/research/decisionCheckPersistence.ts").includes('./repository.js'), {
  path: "apps/api/src/research/decisionCheckPersistence.ts"
});
check("decision context mappers are independent from repository implementations", !/legacyResearchRepository|\.\/repository\.js/.test(read("apps/api/src/research/decisionContextMappers.ts")), {
  path: "apps/api/src/research/decisionContextMappers.ts"
});
check("decision context read service depends on ports instead of legacy repository", !/legacyResearchRepository|\.\/repository\.js/.test(read("apps/api/src/research/decisionContextReadService.ts")), {
  path: "apps/api/src/research/decisionContextReadService.ts"
});
for (const path of ["apps/api/src/research/decisionQuantEvidenceAdapter.ts", "apps/api/src/research/decisionContextRepository.ts", "apps/api/src/research/decisionCheckWriteRepository.ts"]) {
  check(`${path} is independent from legacy repository`, !/legacyResearchRepository|\.\/repository\.js/.test(read(path)), { path });
}
check("legacy research repository has been removed", !existsSync("apps/api/src/research/legacyResearchRepository.ts"), {
  path: "apps/api/src/research/legacyResearchRepository.ts"
});
check("fixture seed repository is independent from facade and quant evidence", !/legacyResearchRepository|\.\/repository\.js|quantEvidenceManifest|loadQuantEvidenceManifest/.test(read("apps/api/src/research/researchFixtureSeedRepository.ts")), {
  path: "apps/api/src/research/researchFixtureSeedRepository.ts"
});
const quantManifestSource = read("apps/api/src/research/quantEvidenceManifest.ts");
const annualPortfolioQuantSource = read("apps/api/src/research/annualPortfolioLabQuantEvidence.ts");
const quantEvidencePortSource = read("apps/api/src/research/quantEvidenceSource.ts");
const repositoryLocalQuantSource = read("apps/api/src/research/repositoryLocalQuantEvidenceSource.ts");
const quantAdapterSource = read("apps/api/src/research/decisionQuantEvidenceAdapter.ts");
const apiConfigSource = read("apps/api/src/config.ts");
const apiServerSource = read("apps/api/src/server.ts");
const researchDocumentRoutesSource = read("apps/api/src/routes/researchDocumentRoutes.ts");
check("research repository facade does not load quant evidence manifests", !/quantEvidenceManifest|loadQuantEvidenceManifest|QUANT_RESEARCH_EVIDENCE_MANIFEST/.test(read("apps/api/src/research/repository.ts")), {
  path: "apps/api/src/research/repository.ts"
});
check("quant evidence loaders depend on one explicit source port instead of process state or filesystem APIs",
  [quantManifestSource, annualPortfolioQuantSource].every((source) =>
    /QuantEvidence(?:Address|Options)/.test(source)
    && /QuantEvidenceSource/.test(source)
    && !/process\.(?:env|cwd)/.test(source)
    && !/node:fs|createHash/.test(source)), {
    paths: [
      "apps/api/src/research/quantEvidenceManifest.ts",
      "apps/api/src/research/annualPortfolioLabQuantEvidence.ts"
    ]
  });
check("quant evidence source port requires an explicit root path and SHA-256 address",
  /repositoryRoot: string/.test(quantEvidencePortSource)
  && /repositoryPath: string/.test(quantEvidencePortSource)
  && /expectedSha256: string \| null/.test(quantEvidencePortSource), {
    path: "apps/api/src/research/quantEvidenceSource.ts"
  });
check("repository-local quant evidence adapter verifies containment and exact content bytes",
  /realpath/.test(repositoryLocalQuantSource)
  && /repository-path-outside-root/.test(repositoryLocalQuantSource)
  && /createHash\("sha256"\)/.test(repositoryLocalQuantSource)
  && /content-address-required/.test(repositoryLocalQuantSource)
  && /content-address-mismatch/.test(repositoryLocalQuantSource), {
    path: "apps/api/src/research/repositoryLocalQuantEvidenceSource.ts"
  });
check("quant evidence production reads have no cwd, environment, or legacy configuration bridge",
  !existsSync("apps/api/src/research/configuredQuantEvidence.ts")
  && !/process\.(?:env|cwd)|loadConfiguredQuantEvidence/.test(quantAdapterSource)
  && /DecisionQuantEvidenceOptions/.test(quantAdapterSource), {
    paths: [
      "apps/api/src/research/configuredQuantEvidence.ts",
      "apps/api/src/research/decisionQuantEvidenceAdapter.ts"
    ]
  });
check("API composition root validates and injects one explicit quant evidence runtime",
  /QUANT_EVIDENCE_REPOSITORY_ROOT/.test(apiConfigSource)
  && /must be an absolute repository path/.test(apiConfigSource)
  && /must be a normalized repository-relative path/.test(apiConfigSource)
  && /must be an exact SHA-256 hex digest/.test(apiConfigSource)
  && /must be a non-negative finite number/.test(apiConfigSource)
  && /buildQuantEvidenceRuntime\(config\)/.test(apiServerSource)
  && /repositoryLocalQuantEvidenceSource/.test(apiServerSource)
  && /^\s*quantEvidence\s*[,}]/m.test(apiServerSource)
  && !/process\.cwd\(\)/.test(apiConfigSource + apiServerSource), {
    paths: ["apps/api/src/config.ts", "apps/api/src/server.ts"]
  });
check("research document runtime receives one stable repository root and explicit CAS limits",
  /fileURLToPath\(import\.meta\.url\)/.test(apiConfigSource)
  && /repositoryRoot: defaultRepositoryRoot\(\)/.test(apiConfigSource)
  && /researchDocument:\s*\{\s*repositoryRoot: config\.repositoryRoot,\s*rawStoreRoot: config\.researchDocumentRawStoreRoot,\s*maxBytes: config\.researchDocumentMaxBytes,\s*maxPages: config\.researchDocumentMaxPages,\s*maxPageTextCharacters: config\.researchDocumentMaxPageTextCharacters,\s*maxTotalTextCharacters: config\.researchDocumentMaxTotalTextCharacters\s*,[^}]*\},\s*quantEvidence\s*[,}]/.test(apiServerSource)
  && /repositoryRoot: options\.researchDocument\.repositoryRoot/.test(researchDocumentRoutesSource)
  && !/process\.cwd\(\)/.test(researchDocumentRoutesSource), {
    paths: ["apps/api/src/config.ts", "apps/api/src/server.ts", "apps/api/src/routes/researchDocumentRoutes.ts"]
  });
check("quant evidence metadata binds the verified content address",
  /decision_context\.quant:catalog-sha256:\$\{loaded\.catalogContentHash\}:manifest-sha256:\$\{loaded\.contentHash\}/.test(quantAdapterSource)
  && /decision_context\.quant:sha256:\$\{loaded\.contentHash\}/.test(quantAdapterSource), {
    path: "apps/api/src/research/decisionQuantEvidenceAdapter.ts"
  });
check("AI suggestion decision repository is independent from legacy repository", !/legacyResearchRepository|\.\/repository\.js/.test(read("apps/api/src/research/aiSuggestionDecisionRepository.ts")), {
  path: "apps/api/src/research/aiSuggestionDecisionRepository.ts"
});
check("candidate decision intake repository is independent from legacy repository", !/legacyResearchRepository|\.\/repository\.js/.test(read("apps/api/src/research/candidateDecisionIntakeRepository.ts")), {
  path: "apps/api/src/research/candidateDecisionIntakeRepository.ts"
});
check("assist advisory scope service is independent from legacy repository", !/legacyResearchRepository|\.\/repository\.js/.test(read("apps/api/src/research/assistAdvisoryScopeService.ts")), {
  path: "apps/api/src/research/assistAdvisoryScopeService.ts"
});
for (const path of [
  "apps/api/src/research/assistHumanReviewWorkspaceService.ts",
  "apps/api/src/research/assistReviewFollowUpWorkflowService.ts",
  "apps/api/src/research/assistDecisionNoteWorkflowService.ts"
]) {
  check(`${path} is independent from legacy repository`, !/legacyResearchRepository|\.\/repository\.js/.test(read(path)), { path });
}
check("ASSIST workflow services preserve advisory to review to follow-up to note dependency direction",
  !/assistReviewFollowUpWorkflowService|assistDecisionNoteWorkflowService/.test(read("apps/api/src/research/assistHumanReviewWorkspaceService.ts"))
  && !/assistDecisionNoteWorkflowService/.test(read("apps/api/src/research/assistReviewFollowUpWorkflowService.ts")), {
    path: "apps/api/src/research"
  });
const portfolioRepositoryFacadeSource = read("apps/api/src/portfolio/repository.ts");
const currentPortfolioRepositorySource = read("apps/api/src/portfolio/pinganCurrentPortfolioRepository.ts");
const historicalPortfolioRepositorySource = read("apps/api/src/portfolio/pinganHistoricalSnapshotRepository.ts");
check("portfolio repository compatibility facade contains no fact reads or mapping logic",
  /pinganCurrentPortfolioRepository\.js/.test(portfolioRepositoryFacadeSource)
  && /pinganHistoricalSnapshotRepository\.js/.test(portfolioRepositoryFacadeSource)
  && !/\b(?:select|query|Pool|compute|validate|freshness)\b/i.test(portfolioRepositoryFacadeSource), {
    path: "apps/api/src/portfolio/repository.ts"
  });
check("development-current and historical Pingan readers have independent repository modules",
  /readPinganCurrentPortfolioEnvelope/.test(currentPortfolioRepositorySource)
  && !/PinganSnapshotEnvelope|PINGAN_SNAPSHOT_SCHEMA_VERSION|readPinganSnapshotEnvelope|normalizeMarketCode/.test(currentPortfolioRepositorySource)
  && /readPinganSnapshotEnvelope/.test(historicalPortfolioRepositorySource)
  && !/PinganCurrentPortfolio|PINGAN_CURRENT_PORTFOLIO|evaluatePinganPortfolioFreshness/.test(historicalPortfolioRepositorySource), {
    paths: [
      "apps/api/src/portfolio/pinganCurrentPortfolioRepository.ts",
      "apps/api/src/portfolio/pinganHistoricalSnapshotRepository.ts"
    ]
  });
check("portfolio production readers bypass the mixed compatibility facade",
  read("apps/api/src/routes/pinganCurrentPortfolioRoutes.ts").includes('../portfolio/pinganCurrentPortfolioRepository.js')
  && read("apps/api/src/research/authorizedPortfolioDecisionContext.ts").includes('../portfolio/pinganCurrentPortfolioRepository.js')
  && read("apps/api/src/routes/pinganHistoricalRoutes.ts").includes('../portfolio/pinganHistoricalSnapshotRepository.js'), {
    paths: [
      "apps/api/src/routes/pinganCurrentPortfolioRoutes.ts",
      "apps/api/src/research/authorizedPortfolioDecisionContext.ts",
      "apps/api/src/routes/pinganHistoricalRoutes.ts"
    ]
  });
const authorizedPortfolioContextSource = read("apps/api/src/research/authorizedPortfolioDecisionContext.ts");
const decisionSnapshotBindingSource = read("apps/api/src/research/decisionSnapshotBinding.ts");
const portfolioReviewBindingSource = read("apps/api/src/research/postDecisionPortfolioReviewBinding.ts");
check("API decision and review snapshot bindings share one authorized read-only portfolio ingress",
  decisionSnapshotBindingSource.includes('./authorizedPortfolioDecisionContext.js')
  && portfolioReviewBindingSource.includes('./authorizedPortfolioDecisionContext.js')
  && !/readPinganCurrentPortfolioEnvelope|assemblePortfolioDecisionContext|validatePinganCurrentPortfolioEnvelope/.test(decisionSnapshotBindingSource + portfolioReviewBindingSource)
  && /readPinganCurrentPortfolioEnvelope/.test(authorizedPortfolioContextSource)
  && /assemblePortfolioDecisionContext/.test(authorizedPortfolioContextSource), {
    paths: [
      "apps/api/src/research/authorizedPortfolioDecisionContext.ts",
      "apps/api/src/research/decisionSnapshotBinding.ts",
      "apps/api/src/research/postDecisionPortfolioReviewBinding.ts"
    ]
  });
check("authorized portfolio ingress cannot depend on routes writes persistence or broker execution",
  !/\.\/routes\/|WriteRepository|Persistence|insert|update|delete|begin|commit|rollback|broker|order|trade|fill/i.test(authorizedPortfolioContextSource), {
    path: "apps/api/src/research/authorizedPortfolioDecisionContext.ts"
  });
const decisionContextContractSource = read("packages/contracts/src/decisionContextBrowser.ts");
const decisionQuantContractSource = read("packages/contracts/src/decisionQuantEvidenceContract.ts");
check("decision context delegates outer quant validation in one-way contract dependency order",
  decisionContextContractSource.includes('./decisionQuantEvidenceContract.js')
  && /validateDecisionQuantEvidenceInto\(value\.quantEvidence/.test(decisionContextContractSource)
  && !/decisionContextBrowser|node:crypto|apps\/|database|pg\b/.test(decisionQuantContractSource), {
    paths: [
      "packages/contracts/src/decisionContextBrowser.ts",
      "packages/contracts/src/decisionQuantEvidenceContract.ts"
    ]
  });
check("Node browser and Swift quant identity verifiers remain independent",
  /node:crypto/.test(read("packages/contracts/src/quantDecisionEvidence.ts"))
  && /crypto\.subtle/.test(read("packages/contracts/src/quantDecisionEvidenceBrowser.ts"))
  && /portfolioDecisionContentId/.test(read("apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/QuantDecisionEvidenceRefinement.swift"))
  && /SHA256\.hash/.test(read("apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/PortfolioDecisionCanonical.swift")), {
    paths: [
      "packages/contracts/src/quantDecisionEvidence.ts",
      "packages/contracts/src/quantDecisionEvidenceBrowser.ts",
      "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/QuantDecisionEvidenceRefinement.swift",
      "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/PortfolioDecisionCanonical.swift"
    ]
  });
check("Web browser storage adapter has no business or network behavior", !/fetch\(|local-record|pingan|knowledge/i.test(read("apps/web/src/browserStorage.ts")), {
  path: "apps/web/src/browserStorage.ts"
});
check("selected-candidate workflow bridges remain pure state mappings", !/document\.|getElementById|querySelector|addEventListener|fetch\(|localStorage|sessionStorage|from "\.\/app\.js"/.test(read("apps/web/src/selectedCandidateWorkflowBridges.ts")), {
  path: "apps/web/src/selectedCandidateWorkflowBridges.ts"
});
const webJourneyIngressSource = read("apps/web/src/decisionJourneyIngress.ts");
const selectedCandidateMembershipGateSource = read("apps/web/src/selectedCandidateMembershipGate.ts");
const selectedCandidateWorkflowSource = read("apps/web/src/selectedCandidateWorkflowBridges.ts");
check("Web API orchestration delegates canonical journey ingress validation",
  read("apps/web/src/apiClient.ts").includes('./decisionJourneyIngress.js')
  && !/fetch\s*\(|document\.|localStorage|sessionStorage|WebApiClient|from "\.\/app\.js"/.test(webJourneyIngressSource), {
    paths: ["apps/web/src/apiClient.ts", "apps/web/src/decisionJourneyIngress.ts"]
  });
check("selected-candidate bridges use one fail-closed membership identity gate",
  selectedCandidateWorkflowSource.includes('./selectedCandidateMembershipGate.js')
  && !/memberships\.memberships\.find/.test(selectedCandidateWorkflowSource)
  && !/fetch\s*\(|document\.|localStorage|sessionStorage|WebApiClient|from "\.\/app\.js"/.test(selectedCandidateMembershipGateSource), {
    paths: [
      "apps/web/src/selectedCandidateWorkflowBridges.ts",
      "apps/web/src/selectedCandidateMembershipGate.ts"
    ]
  });
check("CORE ASSIST capability console renderer has presentation-only dependencies", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/coreAssistCapabilityConsoleRenderer.ts")), {
  path: "apps/web/src/coreAssistCapabilityConsoleRenderer.ts"
});
check("selected-candidate panels renderer has presentation-only dependencies", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/selectedCandidatePanelsRenderer.ts")), {
  path: "apps/web/src/selectedCandidatePanelsRenderer.ts"
});
check("CORE ASSIST status panels renderer has presentation-only dependencies", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/coreAssistStatusPanelsRenderer.ts")), {
  path: "apps/web/src/coreAssistStatusPanelsRenderer.ts"
});
check("ASSIST workflow panels renderer has presentation-only dependencies", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/assistWorkflowPanelsRenderer.ts")), {
  path: "apps/web/src/assistWorkflowPanelsRenderer.ts"
});
check("local storage panels renderer has presentation-only dependencies", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/localStoragePanelsRenderer.ts")), {
  path: "apps/web/src/localStoragePanelsRenderer.ts"
});
check("Web event bindings only route DOM events", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/appEventBindings.ts")), {
  path: "apps/web/src/appEventBindings.ts"
});
check("Web public API barrel has no runtime side effects", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|new WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/appPublicApi.ts")), {
  path: "apps/web/src/appPublicApi.ts"
});
check("Journey details remain pure formatting", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|new WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/journeyDetails.ts")), {
  path: "apps/web/src/journeyDetails.ts"
});
check("Pingan manual snapshot controller has no API database or app dependency", !/fetch\s*\(|pool\.query|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/pinganManualSnapshotController.ts")), {
  path: "apps/web/src/pinganManualSnapshotController.ts"
});
check("ASSIST local record controller has no API database or app dependency", !/fetch\s*\(|pool\.query|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/assistLocalRecordController.ts")), {
  path: "apps/web/src/assistLocalRecordController.ts"
});
check("ASSIST review knowledge controller has no API database or app dependency", !/fetch\s*\(|pool\.query|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/assistReviewKnowledgeController.ts")), {
  path: "apps/web/src/assistReviewKnowledgeController.ts"
});
check("ASSIST workflow controller uses the API port without persistence or app dependency", !/pool\.query|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|from "\.\/app\.js"/.test(read("apps/web/src/assistWorkflowController.ts")), {
  path: "apps/web/src/assistWorkflowController.ts"
});
check("candidate workflow controller uses the API port without persistence or app reverse dependency", !/pool\.query|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|from "\.\/app\.js"/.test(read("apps/web/src/candidateWorkflowController.ts")), {
  path: "apps/web/src/candidateWorkflowController.ts"
});
check("Web feature panel composition has presentation-only dependencies", !/fetch\s*\(|(?:window\.)?localStorage\.|(?:window\.)?sessionStorage\.|import .*WebApiClient|from "\.\/app\.js"/.test(read("apps/web/src/webFeaturePanels.ts")), {
  path: "apps/web/src/webFeaturePanels.ts"
});
check("Web auth remains input-memory-only", !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(read("apps/web/src/webAuth.ts")), {
  path: "apps/web/src/webAuth.ts"
});
check("iOS research screen is a thin View without direct client or storage construction", !/ResearchClient\s*\(|UserDefaults\.standard|AssistReviewKnowledgeUserDefaultsStorage\s*\(/.test(read("apps/ios/AnnualRingsGateA/App/GateBResearchScreen.swift")), {
  path: "apps/ios/AnnualRingsGateA/App/GateBResearchScreen.swift"
});
check("iOS research ViewModel owns client and local storage dependencies", /(?:let|var) client: ResearchClient/.test(read("apps/ios/AnnualRingsGateA/App/GateBResearchViewModel.swift"))
  && /let localDefaults: UserDefaults/.test(read("apps/ios/AnnualRingsGateA/App/GateBResearchViewModel.swift"))
  && /let reviewKnowledgeStorage: AssistReviewKnowledgeUserDefaultsStorage/.test(read("apps/ios/AnnualRingsGateA/App/GateBResearchViewModel.swift")), {
    path: "apps/ios/AnnualRingsGateA/App/GateBResearchViewModel.swift"
  });
check("iOS local-state workflow uses injected storage adapters", !/UserDefaults\.standard|AssistReviewKnowledgeUserDefaultsStorage\s*\(/.test(read("apps/ios/AnnualRingsGateA/App/GateBResearchLocalStateWorkflow.swift")), {
  path: "apps/ios/AnnualRingsGateA/App/GateBResearchLocalStateWorkflow.swift"
});
const iosResearchClientSource = read("apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchClient.swift");
const iosSnapshotIngressSource = read("apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchDecisionSnapshotIngress.swift");
const iosValidationPrimitivesSource = read("apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchValidationPrimitives.swift");
check("iOS ResearchClient delegates raw canonical snapshot verification to a pure ingress",
  /validateDecisionCheckSnapshotIdentities\(rawData\)/.test(iosResearchClientSource)
  && /validateDecisionReviewSnapshotIdentities\(data\)/.test(iosResearchClientSource)
  && !/JSONSerialization|portfolioDecisionContentId|postDecisionPortfolioComparisonContentId/.test(iosResearchClientSource)
  && /JSONSerialization/.test(iosSnapshotIngressSource)
  && !/URLSession|URLRequest|UserDefaults|ResearchClient/.test(iosSnapshotIngressSource), {
    paths: [
      "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchClient.swift",
      "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchDecisionSnapshotIngress.swift"
    ]
  });
check("iOS research date validation uses one shared primitive boundary",
  countMatches(iosValidationPrimitivesSource, /func isParseableDateTime/g) === 1
  && countMatches(iosValidationPrimitivesSource, /func isStrictUtcDateTime/g) === 1
  && !/func isParseableDateTime|func isStrictUtcDateTime/.test(read("apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/FactMetadata.swift") + read("apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchModels.swift")), {
    paths: [
      "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchValidationPrimitives.swift",
      "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/FactMetadata.swift",
      "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchModels.swift"
    ]
  });

const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
check("unimplemented queue infrastructure is absent", !runtimeDependencies.some((name) => /^(?:redis|ioredis|bull|bullmq)$/.test(name)), {
  runtimeDependencies
});

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  checks,
  blockers,
  warnings,
  fileBudgets,
  largeProductionSourceThreshold,
  largeProductionSourceFiles
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function read(path) {
  return readFileSync(path, "utf8");
}

function check(id, ok, evidence, severity = "blocking") {
  const item = { id, ok, evidence, severity };
  checks.push(item);
  if (!ok) (severity === "advisory" ? warnings : blockers).push(item);
}

function countMatches(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\n|\r/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function gitTrackedProductionSourceFiles() {
  return execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split("\0")
    .filter(Boolean)
    .filter(isGovernedProductionSourcePath);
}
