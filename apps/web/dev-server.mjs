import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.WEB_PORT ?? 4173);
const upstream = new URL(process.env.WEB_API_BASE_URL ?? "http://127.0.0.1:3000");
const allowedStaticFiles = new Set([
  "/apps/web/index.html",
  "/apps/web/styles.css"
]);
const allowedStaticModules = new Set([
  "/dist/apps/web/src/annualPortfolioLabApiClient.js",
  "/dist/apps/web/src/annualConditionalDecisionBrowser.js",
  "/dist/apps/web/src/apiClient.js",
  "/dist/apps/web/src/app.js",
  "/dist/apps/web/src/appEventBindings.js",
  "/dist/apps/web/src/appPublicApi.js",
  "/dist/apps/web/src/assetsAlphaConsole.js",
  "/dist/apps/web/src/assetsAlphaRenderer.js",
  "/dist/apps/web/src/dailyResearchCockpit.js",
  "/dist/apps/web/src/dailyResearchCockpitBridge.js",
  "/dist/apps/web/src/dailyResearchCockpitData.js",
  "/dist/apps/web/src/assistAdvisoryScopeState.js",
  "/dist/apps/web/src/assistDecisionNoteWorkflowState.js",
  "/dist/apps/web/src/assistHumanReviewWorkspaceState.js",
  "/dist/apps/web/src/assistLocalArchive.js",
  "/dist/apps/web/src/assistLocalRecordController.js",
  "/dist/apps/web/src/assistLocalRecordState.js",
  "/dist/apps/web/src/assistReviewFollowUpWorkflowState.js",
  "/dist/apps/web/src/assistReviewKnowledgeController.js",
  "/dist/apps/web/src/assistReviewKnowledgeIdentity.js",
  "/dist/apps/web/src/assistReviewKnowledgeState.js",
  "/dist/apps/web/src/assistWorkflowController.js",
  "/dist/apps/web/src/assistWorkflowPanelsRenderer.js",
  "/dist/apps/web/src/browserStorage.js",
  "/dist/apps/web/src/candidateDecisionIntakeState.js",
  "/dist/apps/web/src/candidateMembershipState.js",
  "/dist/apps/web/src/candidateOverviewState.js",
  "/dist/apps/web/src/candidateWorkflowController.js",
  "/dist/apps/web/src/config.js",
  "/dist/apps/web/src/contractValidation.js",
  "/dist/apps/web/src/coreAssistCapabilityConsoleRenderer.js",
  "/dist/apps/web/src/coreAssistStatusPanelsRenderer.js",
  "/dist/apps/web/src/coreAssistUnifiedFailureState.js",
  "/dist/apps/web/src/coreJourneyNextAction.js",
  "/dist/apps/web/src/coreJourneyState.js",
  "/dist/apps/web/src/decisionSubmission.js",
  "/dist/apps/web/src/decisionJourneyIngress.js",
  "/dist/apps/web/src/deepResearchConsole.js",
  "/dist/apps/web/src/deepResearchConsoleSupport.js",
  "/dist/apps/web/src/deepResearchComparisonConsole.js",
  "/dist/apps/web/src/deepResearchFreezeBinding.js",
  "/dist/apps/web/src/deepResearchReportSummary.js",
  "/dist/apps/web/src/decisionBriefConsole.js",
  "/dist/apps/web/src/decisionReviewCaseFileConsole.js",
  "/dist/apps/web/src/evidenceConflictConsole.js",
  "/dist/apps/web/src/evidenceConflictData.js",
  "/dist/apps/web/src/displayFormatting.js",
  "/dist/apps/web/src/domRender.js",
  "/dist/apps/web/src/journeyDetails.js",
  "/dist/apps/web/src/investmentControlConsoleApiClient.js",
  "/dist/apps/web/src/investmentControlConsoleController.js",
  "/dist/apps/web/src/investmentControlConsoleCoordinator.js",
  "/dist/apps/web/src/investmentControlConsoleForms.js",
  "/dist/apps/web/src/investmentControlConsoleKeyboard.js",
  "/dist/apps/web/src/investmentControlConsoleReadValidation.js",
  "/dist/apps/web/src/investmentControlConsoleRenderer.js",
  "/dist/apps/web/src/investmentControlConsoleResponseValidation.js",
  "/dist/apps/web/src/marketContextConsole.js",
  "/dist/apps/web/src/marketContextRefresh.js",
  "/dist/apps/web/src/localStoragePanelsRenderer.js",
  "/dist/apps/web/src/manualFormValues.js",
  "/dist/apps/web/src/pinganManualSnapshotController.js",
  "/dist/apps/web/src/pinganManualSnapshotState.js",
  "/dist/apps/web/src/portfolioWorkspaceController.js",
  "/dist/apps/web/src/portfolioWorkspaceRenderer.js",
  "/dist/apps/web/src/portfolioReportExplanationCard.js",
  "/dist/apps/web/src/postDecisionPortfolioReviewSubmission.js",
  "/dist/apps/web/src/quantDecisionEvidencePresentation.js",
  "/dist/apps/web/src/researchDocumentConsole.js",
  "/dist/apps/web/src/researchFutuFinancialConsole.js",
  "/dist/apps/web/src/researchSourceSnapshotWeb.js",
  "/dist/apps/web/src/researchDocumentConsoleView.js",
  "/dist/apps/web/src/researchDocumentTransport.js",
  "/dist/apps/web/src/researchDocumentValidation.js",
  "/dist/apps/web/src/researchDossierConsole.js",
  "/dist/apps/web/src/researchDossierData.js",
  "/dist/apps/web/src/researchDossierView.js",
  "/dist/apps/web/src/reportAssistantConsole.js",
  "/dist/apps/web/src/reportAssistantData.js",
  "/dist/apps/web/src/reportReviewQuestionHandoff.js",
  "/dist/apps/web/src/reviewFeedback.js",
  "/dist/apps/web/src/securitySymbol.js",
  "/dist/apps/web/src/selectedCandidateDecisionBridge.js",
  "/dist/apps/web/src/selectedCandidateMembershipGate.js",
  "/dist/apps/web/src/selectedCandidatePanelsRenderer.js",
  "/dist/apps/web/src/selectedCandidateWorkflowBridges.js",
  "/dist/apps/web/src/todayActionReviewWorkflow.js",
  "/dist/apps/web/src/view.js",
  "/dist/apps/web/src/webAuth.js",
  "/dist/apps/web/src/webFeaturePanels.js",
  "/dist/packages/contracts/src/decisionContextBrowser.js",
  "/dist/packages/contracts/src/decisionReview.js",
  "/dist/packages/contracts/src/deepResearch.js",
  "/dist/packages/contracts/src/limitedResearch.js",
  "/dist/packages/contracts/src/deepResearchTask.js",
  "/dist/packages/contracts/src/deepResearchSourceGap.js",
  "/dist/packages/contracts/src/deepResearchSnapshot.js",
  "/dist/packages/contracts/src/deepResearchSynthesisReport.js",
  "/dist/packages/contracts/src/assistAdvisoryScope.js",
  "/dist/packages/contracts/src/assistAdvisoryScopeBrowser.js",
  "/dist/packages/contracts/src/assistDecisionNoteWorkflow.js",
  "/dist/packages/contracts/src/assistDecisionNoteWorkflowBrowser.js",
  "/dist/packages/contracts/src/assistHumanReviewWorkspace.js",
  "/dist/packages/contracts/src/assistHumanReviewWorkspaceBrowser.js",
  "/dist/packages/contracts/src/assistLocalRecord.js",
  "/dist/packages/contracts/src/assistLocalRecordBrowser.js",
  "/dist/packages/contracts/src/assistReviewKnowledge.js",
  "/dist/packages/contracts/src/assistReviewKnowledgeBrowser.js",
  "/dist/packages/contracts/src/assistReviewFollowUpWorkflow.js",
  "/dist/packages/contracts/src/assistReviewFollowUpWorkflowBrowser.js",
  "/dist/packages/contracts/src/annualConditionalDecisionContract.js",
  "/dist/packages/contracts/src/annualPortfolioLabBrowser.js",
  "/dist/packages/contracts/src/annualPortfolioLabPairSummary.js",
  "/dist/packages/contracts/src/annualDecisionBrief.js",
  "/dist/packages/contracts/src/annualReviewLearning.js",
  "/dist/packages/contracts/src/annualReviewLearningSummary.js",
  "/dist/packages/contracts/src/annualValuationQuantWorkbench.js",
  "/dist/packages/contracts/src/annualValuationScenarioMargin.js",
  "/dist/packages/contracts/src/annualValuationScenarioGrid.js",
  "/dist/packages/contracts/src/assetsAlpha.js",
  "/dist/packages/contracts/src/candidateDecisionIntake.js",
  "/dist/packages/contracts/src/candidateMembership.js",
  "/dist/packages/contracts/src/candidateOverview.js",
  "/dist/packages/contracts/src/chronology.js",
  "/dist/packages/contracts/src/cloudAiPolicy.js",
  "/dist/packages/contracts/src/market.js",
  "/dist/packages/contracts/src/marketDiscovery.js",
  "/dist/packages/contracts/src/marketEnvironment.js",
  "/dist/packages/contracts/src/marketDaily.js",
  "/dist/packages/contracts/src/marketDailyCalendarEvidence.js",
  "/dist/packages/contracts/src/marketDailyHashes.js",
  "/dist/packages/contracts/src/weinsteinTechnicalAnalysis.js",
  "/dist/packages/contracts/src/decisionQuantEvidenceContract.js",
  "/dist/packages/contracts/src/decisionQuantEvidenceChronology.js",
  "/dist/packages/contracts/src/decisionSnapshotBrowser.js",
  "/dist/packages/contracts/src/decisionSnapshotContract.js",
  "/dist/packages/contracts/src/postDecisionPortfolioComparison.js",
  "/dist/packages/contracts/src/postDecisionPortfolioReviewBrowser.js",
  "/dist/packages/contracts/src/postDecisionPortfolioReviewContract.js",
  "/dist/packages/contracts/src/portfolioDecisionContextBrowser.js",
  "/dist/packages/contracts/src/portfolioDecisionFreshnessBrowser.js",
  "/dist/packages/contracts/src/portfolioDecisionContextStatus.js",
  "/dist/packages/contracts/src/portfolioReportExplanation.js",
  "/dist/packages/contracts/src/quantDecisionEvidenceBrowser.js",
  "/dist/packages/contracts/src/quantDecisionEvidenceContract.js",
  "/dist/packages/contracts/src/factMetadata.js",
  "/dist/packages/contracts/src/factMetadataValues.generated.js",
  "/dist/packages/contracts/src/research.js",
  "/dist/packages/contracts/src/researchCompleteness.js",
  "/dist/packages/contracts/src/researchContext.js",
  "/dist/packages/contracts/src/researchDocument.js",
  "/dist/packages/contracts/src/researchFutuFinancialStatement.js",
  "/dist/packages/contracts/src/researchOperatingReasoning.js",
  "/dist/packages/contracts/src/researchDecisionUpdate.js",
  "/dist/packages/contracts/src/researchEvidenceSeries.js",
  "/dist/packages/contracts/src/researchFactIdentity.js",
  "/dist/packages/contracts/src/researchFinancialCoverage.js",
  "/dist/packages/contracts/src/researchOperatingCalculations.js",
  "/dist/packages/contracts/src/researchOperatingModel.js",
  "/dist/packages/contracts/src/researchProductMix.js",
  "/dist/packages/contracts/src/researchThesisEvaluator.js",
  "/dist/packages/contracts/src/researchThesisTests.js",
  "/dist/packages/contracts/src/researchEvent.js",
  "/dist/packages/contracts/src/researchEvidenceQuestion.js",
  "/dist/packages/contracts/src/researchFundamentals.js",
  "/dist/packages/contracts/src/researchMaterial.js",
  "/dist/packages/contracts/src/researchMonitorRule.js",
  "/dist/packages/contracts/src/formalDecision.js",
  "/dist/packages/contracts/src/researchReportDecision.js",
  "/dist/packages/contracts/src/sha256.js",
  "/dist/packages/contracts/src/researchValuationScenarios.js",
  "/dist/packages/contracts/src/geelySalesMonitor.js",
  "/dist/packages/contracts/src/gclPvPriceMonitor.js",
  "/dist/packages/contracts/src/todayResearch.js",
  "/dist/packages/contracts/src/todayResearchQualityValidation.js",
  "/dist/packages/contracts/src/todayActionInbox.js",
  "/dist/packages/contracts/src/todayActionInboxProfileReviewValidation.js",
  "/dist/packages/contracts/src/todayActionInboxTask.js",
  "/dist/packages/contracts/src/todayMaterialChangeDisposition.js",
  "/dist/packages/contracts/src/todayReviewDue.js",
  "/dist/packages/contracts/src/todayReviewDueIdentity.js",
  "/dist/packages/contracts/src/todayReviewDueReportValidation.js"
]);
const allowedProxyRoutes = [
  { method: "GET", pattern: /^\/api\/mobile\/assets\/alpha$/ },
  { method: "POST", pattern: /^\/api\/mobile\/assets\/alpha\/snapshots$/ },
  { method: "POST", pattern: /^\/api\/mobile\/assets\/alpha\/trades$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/today\/inbox$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/today\/inbox\/material-dispositions$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/cloud-ai-policy$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/cloud-ai-policy\/decisions$/ },
  { method: "GET", pattern: /^\/api\/mobile\/market\/discovery$/ },
  { method: "POST", pattern: /^\/api\/mobile\/market\/discovery\/qualifications$/ },
  { method: "GET", pattern: /^\/api\/mobile\/market\/search$/ },
  { method: "GET", pattern: /^\/api\/mobile\/market\/daily-bars\/HK\/[0-9]{5}$/ },
  { method: "GET", pattern: /^\/api\/mobile\/market\/weinstein\/HK\/[0-9]{5}$/ },
  { method: "GET", pattern: /^\/api\/mobile\/market\/environment\/HK\/[0-9]{5}$/ },
  { method: "POST", pattern: /^\/api\/internal\/market\/refresh\/HK\/[0-9]{5}$/ },
  { method: "POST", pattern: /^\/api\/internal\/market\/daily-bars\/refresh\/HK\/[0-9]{5}$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidates$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/documents$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/futu-financial-statement-captures$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/futu-financial-statement-captures$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/futu-financial-statement-captures\/[0-9]+$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/futu-financial-statement-captures\/[0-9]+\/pages\/[0-9]+(?:\/content)?$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/source-snapshots$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/source-snapshots$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/source-snapshots\/[0-9]+(?:\/content)?$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/source-snapshots\/[0-9]+\/materials$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/research-context$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/research-context$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/fundamentals$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/fundamentals$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/valuation-scenarios$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/valuation-scenarios$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/completeness$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/completeness$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/documents\/[0-9]+\/pages\/[0-9]+$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/documents\/[0-9]+\/content$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/decision-intake$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/decision-brief$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/portfolio-lab$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/portfolio-report-explanation$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/valuation-quant-workbench$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/conditional-decision-preview$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research-tasks$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research-tasks\/[0-9]+$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research-tasks\/[0-9]+\/retry$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research-tasks\/[0-9]+\/absorb$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research-tasks\/[0-9]+\/cancel$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/today$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/documents$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/documents\/[0-9]+\/confirmed-facts$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/evidence-packs$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/research-events$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/geely-sales-monitors$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/gcl-pv-price-monitors$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research-reports$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/deep-research-reports\/[0-9]+\/decisions$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/evidence-questions$/ },
  { method: "PATCH", pattern: /^\/api\/mobile\/research\/candidate-memberships\/[0-9]+\/state$/ },
  { method: "GET", pattern: /^\/api\/mobile\/market\/quotes\/HK\/[0-9]{5}$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/profiles\/HK\/[0-9]{5}$/ },
  { method: "PUT", pattern: /^\/api\/mobile\/research\/profiles\/HK\/[0-9]{5}$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/profiles\/HK\/[0-9]{5}\/evidence$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/profiles\/HK\/[0-9]{5}\/materials$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/decision-context\/HK\/[0-9]{5}$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/portfolio\/pingan-snapshot\/HK\/[0-9]{5}$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/portfolio\/pingan-current\/context$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/portfolio\/pingan-current\/risk-impact$/ },
  { method: "GET", pattern: /^\/api\/mobile\/research\/profiles\/HK\/[0-9]{5}\/decision-reviews$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/profiles\/HK\/[0-9]{5}\/decision-checks$/ },
  { method: "POST", pattern: /^\/api\/mobile\/research\/profiles\/HK\/[0-9]{5}\/decision-checks\/[^/]+\/reviews$/ }
];

if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error("Web development server refuses non-loopback WEB_HOST by default.");
}
if (upstream.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(upstream.hostname)) {
  throw new Error("Web development proxy accepts only loopback http upstreams.");
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url) throw new Error("missing url");
    const url = new URL(request.url, `http://${host}:${port}`);
    if (isAllowedProxyRoute(request.method ?? "", url.pathname)) {
      await proxy(request, response, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) throw new Error("API route is not allowed by this Web candidate");
    const pathname = url.pathname === "/" ? "/apps/web/index.html" : url.pathname;
    await serveFile(pathname, response);
  } catch (error) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "not found");
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ ok: true, url: `http://${host}:${port}`, upstream: upstream.origin }));
});

async function proxy(request, response, url) {
  const target = new URL(url.pathname + url.search, upstream);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value || key.toLowerCase() === "host") continue;
    if (key.toLowerCase() === "authorization") continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  const proxied = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
    duplex: "half"
  });
  response.writeHead(proxied.status, Object.fromEntries(proxied.headers.entries()));
  if (proxied.body) {
    for await (const chunk of proxied.body) response.write(chunk);
  }
  response.end();
}

async function serveFile(pathname, response) {
  const candidate = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  if (!isAllowedStaticPath(candidate)) throw new Error("static file is not allowed by this Web candidate");
  const fullPath = resolve(join(root, candidate));
  if (!fullPath.startsWith(root)) throw new Error("path escapes repository");
  const info = await stat(fullPath);
  if (!info.isFile()) throw new Error("not a file");
  response.writeHead(200, { "content-type": contentType(fullPath) });
  createReadStream(fullPath).pipe(response);
}

function isAllowedProxyRoute(method, pathname) {
  return allowedProxyRoutes.some((route) => route.method === method && route.pattern.test(pathname));
}

function isAllowedStaticPath(pathname) {
  if (allowedStaticFiles.has(pathname)) return true;
  const withoutMap = pathname.endsWith(".map") ? pathname.slice(0, -4) : pathname;
  return allowedStaticModules.has(withoutMap);
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}
