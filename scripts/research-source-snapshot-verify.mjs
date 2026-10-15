#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {createServer} from "node:http";
import { mkdtemp, readFile, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {gzipSync,gunzipSync} from "node:zlib";
import { Pool } from "pg";
import { buildServer } from "../dist/apps/api/src/server.js";
import { deepResearchProviderAuthorizationFingerprint } from "../dist/apps/api/src/research/deepResearchGate.js";
import { readCurrentDeepResearchSnapshot } from "../dist/apps/api/src/research/deepResearchSnapshotAssembler.js";
import { runDeepResearchTaskOnce } from "../dist/apps/api/src/research/deepResearchTaskRunner.js";
import { claimDeepResearchTask,bindDeepResearchTaskSnapshot,storeDeepResearchTaskSynthesis,
  failDeepResearchTask } from "../dist/apps/api/src/research/deepResearchTaskRepository.js";
import { CLOUD_AI_PROVIDER_POLICY_VERSION,DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  defaultDeepResearchTaskIntent,evidenceBoundReportPackBinding } from "../dist/packages/contracts/src/index.js";
import { createScopedResearchToken } from "../dist/apps/api/src/routes/researchAuth.js";
import { extractGeelyOfficialHtml } from "../dist/apps/api/src/research/researchSourceSnapshotHtml.js";
import { createResearchFundamentalValue } from "../dist/apps/api/src/research/researchFundamentalWriteRepository.js";
import { readResearchFundamentals,readResearchFundamentalsExport } from "../dist/apps/api/src/research/researchFundamentalRepository.js";
import { readDeepResearchWorkspace } from "../dist/apps/api/src/research/deepResearchReadRepository.js";
import { readResearchContextSnapshot } from "../dist/apps/api/src/research/researchContextRepository.js";
import { historicalOperatingSnapshot } from "../dist/apps/api/src/research/researchHistoricalReasoning.js";
import { materialInvalidationNotice } from "../dist/apps/api/src/research/researchMaterialChangeEvents.js";
import { appendAssertionLifecycle } from "../dist/apps/api/src/research/researchAssertionLifecycle.js";
import { createAssetsAlphaSnapshot } from "../dist/apps/api/src/assetsAlphaRepository.js";
import { validateResearchFundamentalsExport } from "../dist/packages/contracts/src/researchFundamentals.js";
import { collectInvestigationEvidence } from "../dist/apps/api/src/research/personalInvestigationSources.js";
import {emptyOperatingModel} from "../dist/packages/contracts/src/researchOperatingModel.js";
import {completedWeekEnd,frozenWeinsteinEvidenceBinding} from "../dist/packages/contracts/src/weinsteinTechnicalAnalysis.js";
import {latestCompletedHongKongSession} from "../dist/apps/api/src/market/dailyBarsRepository.js";
import {persistResearchFrozenTechnicalFixture} from "./research-frozen-technical-fixture.mjs";
import { runMigrations } from "./migration-runner.mjs";
import { resolveLocalPostgresEndpoint } from "./gate-b-verify.mjs";

const endpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const name = `annual_rings_source_snapshot_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const repositoryRoot=fileURLToPath(new URL("../",import.meta.url));
const realOriginalPath=join(repositoryRoot,"docs/reviews/financial-sources-20261010/geely-2025-h1-original.html.gz");
const rawStoreRoot=await mkdtemp(join(tmpdir(),"annual-rings-source-snapshot-raw-"));
const authSigningKey="source-snapshot-isolated-test-key";
const nowSeconds=Math.floor(Date.now()/1000);
const ownerToken=createScopedResearchToken({version:2,tokenId:randomUUID(),actorId:"snapshot-owner",scopes:["read","candidate_write","research_write"],issuedAt:nowSeconds,expiresAt:nowSeconds+600},authSigningKey);
const otherToken=createScopedResearchToken({version:2,tokenId:randomUUID(),actorId:"other-owner",scopes:["read","candidate_write","research_write"],issuedAt:nowSeconds,expiresAt:nowSeconds+600},authSigningKey);
const sourceUrl="https://global.geely.com/en/news/2025/geely-auto-2025-h1-revenues";
const live=process.argv.includes("--live");
const realReplay=process.argv.includes("--real-replay");
const consumerProbe=process.argv.includes("--consumer-probe");
const runnerLossBefore=process.argv.includes("--runner-loss-before");
const runnerLossDuring=process.argv.includes("--runner-loss-during");
const runnerCorruptDuring=process.argv.includes("--runner-corrupt-during");
const runnerBodyChangeDuring=process.argv.includes("--runner-body-change-during");
assert.ok([runnerLossBefore,runnerLossDuring,runnerCorruptDuring,runnerBodyChangeDuring].filter(Boolean).length<=1);
const html=Buffer.from(`<!doctype html><html><body><div class="c-news-detail-content">
  <p>Aug 14, 2025</p><h1>Geely Auto 2025 H1 Revenues</h1>
  <p>Geely Automobile Holdings Ltd (HK.0175) reported results for the six months ended 30 June 2025.</p>
  <p>Group Six months ended 30 June 2025</p><p>Revenue RMB million 150,285</p>
  <p>Group As at 30 June 2025</p><p>Total assets RMB million 200,000</p>
  <p>Total liabilities RMB million 50,000</p>
  <p>This fixture is a local test response and is not a statement of current 2026 financial results.</p>
</div></body></html>`);
const weeklyBridge=createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname!=="/weinstein-weekly"||url.searchParams.get("ticker")!=="00175"){
    res.writeHead(404).end();return;
  }
  res.setHeader("content-type","application/json");
  res.end(JSON.stringify({ok:true,input:weeklyFixture(url.searchParams.get("analysisAsOf"))}));
});
const host = endpoint.host === "::1" ? "[::1]" : endpoint.host;
const password = endpoint.password ? `:${encodeURIComponent(endpoint.password)}` : "";
const databaseUrl = `postgresql://${encodeURIComponent(endpoint.user)}${password}@${host}:${endpoint.port}/${name}`;
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && !key.startsWith("PG")));
if (endpoint.password) environment.PGPASSWORD = endpoint.password;
delete environment.PSQLRC;
const postgres = (command, args, ignoreFailure = false) => execFileSync(command,
  ["--host", endpoint.host, "--port", endpoint.port, "--username", endpoint.user, ...args],
  { env: environment, stdio: ignoreFailure ? "ignore" : "pipe" });
let pool;
let app;
try {
  postgres("createdb", [name]);
  pool = new Pool({ connectionString: databaseUrl, max: 2, ssl: false });
  const first = await runMigrations(pool, { log: () => {} });
  assert.ok(first.applied.includes("070_research_source_snapshots.sql"));
  const second = await runMigrations(pool, { log: () => {} });
  assert.ok(second.skipped.includes("070_research_source_snapshots.sql"));
  const table = await pool.query("select count(*)::int as count from research_source_snapshots");
  assert.equal(table.rows[0].count, 0);
  await new Promise(resolve=>weeklyBridge.listen(0,"127.0.0.1",resolve));
  let fetchCount=0,currentHtml=realReplay?gunzipSync(await readFile(realOriginalPath)):html;
  const fetchImpl=async () => {fetchCount++;return new Response(currentHtml,{status:200,headers:{"content-type":"text/html; charset=utf-8"}});};
  app=await buildServer({repositoryRoot,databaseUrl,nodeEnv:"test",host:"127.0.0.1",port:0,
    stagingReadOnlyMode:false,stagingIdentity:"source-snapshot-isolated-test",marketProvider:"futu-http",
    futuMarketDataUrl:`http://127.0.0.1:${weeklyBridge.address().port}`,
    quoteLiveMaxAgeSeconds:300,pinganCurrentPortfolioEnabled:false,pinganCurrentMaxAgeSeconds:300,
    quantEvidence:null,writeAuthToken:null,writeAuthHeaderName:"x-internal-token",
    stagingReadOnlyAuthToken:null,stagingReadOnlyAuthHeaderName:"x-internal-token",
    authSigningKey,authVerificationKeys:[],authRevokedTokenIds:new Set(),allowLegacyWriteTokenForScopedLanes:false,
    requireWriteAuth:true,writeActorId:"source-snapshot-test",researchDocumentRawStoreRoot:rawStoreRoot,
    researchDocumentMaxBytes:1000000,researchDocumentMaxPages:10,researchDocumentMaxPageTextCharacters:10000,
    researchDocumentMaxTotalTextCharacters:20000},live?undefined:{sourceIntakeFetchImpl:fetchImpl,
      announcementProvider:{read:async()=>({status:"unavailable",fetchedAt:new Date().toISOString(),items:[]})}});
  const request=async (method,url,payload,token=ownerToken) => {
    const response=await app.inject({method,url,headers:{"x-internal-token":token},...(payload!==undefined?{payload}: {})});
    return {status:response.statusCode,body:response.json()};
  };
  const member=await request("POST","/api/mobile/research/candidate-memberships",{
    market:"HK",code:"00175",initialState:"tracked",idempotencyKey:"snapshot-member"});
  assert.equal(member.status,201,JSON.stringify(member.body));
  const membershipId=member.body.data.id, version=member.body.data.version;
  const base=`/api/mobile/research/candidate-memberships/${membershipId}/source-snapshots`;
  if(live){
    const captured=await request("POST",base,{membershipVersion:version,url:sourceUrl,idempotencyKey:"live-official-capture"});
    assert.equal(captured.status,200,JSON.stringify(captured.body));
    const snapshot=captured.body.data;
    const listed=await request("GET",base);
    assert.equal(listed.status,200);
    assert.equal(listed.body.data[0].id,snapshot.id);
    const reopened=await request("GET",`${base}/${snapshot.id}`);
    assert.equal(reopened.status,200);
    assert.equal(reopened.body.data.rawSha256,snapshot.rawSha256);
    const original=await app.inject({method:"GET",url:`${base}/${snapshot.id}/content`,headers:{"x-internal-token":ownerToken}});
    assert.equal(original.statusCode,200);
    assert.equal(createHash("sha256").update(original.rawPayload).digest("hex"),snapshot.rawSha256);
    assert.equal(original.rawPayload.length,snapshot.byteLength);
    await writeFile(realOriginalPath,gzipSync(original.rawPayload));
    console.log(JSON.stringify({mode:"live_official_product_route",capturedAt:snapshot.capturedAt,
      responseUrl:snapshot.responseUrl,rawSha256:snapshot.rawSha256,byteLength:snapshot.byteLength,
      textSha256:snapshot.textSha256,publishedAt:snapshot.publishedAt,listedAndReopened:true,
      originalBytesVerified:true,fixture:false,originalOwnerDatabaseTouched:false,
      candidateLines:snapshot.normalizedText.split("\n").filter(line=>/revenue|assets|liabilit|30 june|2025/.test(line.toLowerCase())).slice(0,12)}));
  }else if(realReplay){
    const captured=await request("POST",base,{membershipVersion:version,url:sourceUrl,
      idempotencyKey:"real-original-replay-capture"});
    assert.equal(captured.status,200,JSON.stringify(captured.body));
    const snapshot=captured.body.data;
    assert.equal(snapshot.rawSha256,"d035d978f65d94fd8803c0f37780518c67e97e15079e816fd1e64026ed5e4043");
    assert.equal(snapshot.byteLength,152628);
    assert.equal(snapshot.textSha256,"0d2fc0b932866281b671232e32c13a5f5407199de08c129470232c7e01fa0295");
    assert.equal(fetchCount,1);
    assert.equal((await request("GET",`${base}/${snapshot.id}`,undefined,otherToken)).status,404);
    const otherMember=await request("POST","/api/mobile/research/candidate-memberships",{
      market:"HK",code:"00700",initialState:"tracked",idempotencyKey:"real-replay-other-member"});
    assert.equal(otherMember.status,201);
    assert.equal((await request("GET",`/api/mobile/research/candidate-memberships/${otherMember.body.data.id}/source-snapshots/${snapshot.id}`)).status,404);
    const quote="revenues increased 27% YoY to 150.3 billion RMB";
    const startUtf16=snapshot.normalizedText.indexOf(quote),endUtf16=startUtf16+quote.length;
    assert.ok(startUtf16>=0);
    const wrongVersion=await request("POST",`${base}/${snapshot.id}/materials`,{
      membershipVersion:version+1,startUtf16,endUtf16,validUntil:"2027-08-14T00:00:00.000Z",
      ownerConfirmed:true,idempotencyKey:"real-replay-wrong-version"});
    assert.equal(wrongVersion.status,409);
    const materialResponse=await request("POST",`${base}/${snapshot.id}/materials`,{
      membershipVersion:version,startUtf16,endUtf16,validUntil:"2027-08-14T00:00:00.000Z",
      ownerConfirmed:true,idempotencyKey:"real-original-test-actor-material"});
    assert.equal(materialResponse.status,200,JSON.stringify(materialResponse.body));
    const material=materialResponse.body.data.data;
    const realFactPayload={
      membershipVersion:version,sourceMaterialId:material.id,metric:"revenue",periodKind:"duration",
      periodStart:"2025-01-01",periodEnd:"2025-06-30",currency:"CNY",unitScale:1000000000,
      scope:"consolidated",valueStatus:"reported",value:"150.3",comparability:"comparable",
      comparabilityReason:null,amendmentKind:"initial",replacesValueId:null,ownerConfirmed:true,
      idempotencyKey:"real-original-test-actor-fact",assertion:{unit:"currency",
        measurementBasis:"financial_statement",businessScope:"Geely Auto reported issuer scope",
        category:"actual",sourceUrl,limitation:"Test actor explicitly confirmed H1 period, unit and consolidated scope; article prose is not a statement table.",
        sourceChecked:true,structureConfirmation:{confirmedFields:["metric","period","currency","unitScale","scope"]},
        snapshotTextBinding:{snapshotId:snapshot.id,textSha256:snapshot.textSha256,startUtf16,endUtf16,
          excerptSha256:createHash("sha256").update(quote).digest("hex"),sourceExcerpt:quote,
          rawValueText:"150.3"}}};
    const wrongSpan=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`,{
      ...realFactPayload,idempotencyKey:"real-replay-wrong-span",
      assertion:{...realFactPayload.assertion,snapshotTextBinding:{...realFactPayload.assertion.snapshotTextBinding,
        startUtf16:startUtf16+1,endUtf16:endUtf16+1}}});
    assert.equal(wrongSpan.status,422);
    const fact=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`,realFactPayload);
    assert.equal(fact.status,200,JSON.stringify(fact.body));
    assert.equal(fact.body.data.provenance.verificationStatus,"source_text_verified");
    const facts=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
    assert.equal(facts.status,200,JSON.stringify(facts.body));
    assert.equal(facts.body.values[0].source.snapshotOriginal.rawSha256,snapshot.rawSha256);
    const scenario=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/valuation-scenarios`,{
      membershipVersion:version,symbol:"HK.00175",anchorValueId:fact.body.data.id,
      replacesScenarioSetId:null,assumptions:{metricCurrency:"CNY",baseMetricPerShare:12.5,
        annualGrowthRate:0.1,horizonYears:3,terminalMultiple:18,annualDiscountRate:0.12,
        netCashPerShare:2,growthRateStep:0.03,multipleStep:2},
      ownerConfirmed:true,idempotencyKey:"real-original-test-actor-valuation"});
    assert.equal(scenario.status,200,JSON.stringify(scenario.body));
    const scenarioRead=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/valuation-scenarios`);
    assert.equal(scenarioRead.status,200,JSON.stringify(scenarioRead.body));
    assert.equal(scenarioRead.body.scenarioSets[0].anchor.source.snapshotOriginal.rawSha256,snapshot.rawSha256);
    const pack=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,{
      researchMode:"limited",membershipVersion:version,idempotencyKey:"real-original-test-actor-limited-pack"});
    assert.equal(pack.status,200,JSON.stringify(pack.body));
    const reopened=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/deep-research`);
    assert.equal(reopened.status,200,JSON.stringify(reopened.body));
    assert.equal(reopened.body.data.latestPack.items[0].snapshotOriginal.rawSha256,snapshot.rawSha256);
    assert.equal(reopened.body.data.operatingReasoning?.facts.find(value=>value.metric==="revenue")?.source.snapshotTextBinding?.rawValueText,"150.3");
    const original=await app.inject({method:"GET",url:`${base}/${snapshot.id}/content`,
      headers:{"x-internal-token":ownerToken}});
    assert.equal(original.statusCode,200);
    assert.equal(createHash("sha256").update(original.rawPayload).digest("hex"),snapshot.rawSha256);
    assert.ok(original.rawPayload.equals(currentHtml));
    const exported=await readResearchFundamentalsExport(pool,membershipId,{actorType:"user",actorId:"snapshot-owner"},new Date(),{repositoryRoot,rawStoreRoot});
    assert.deepEqual(validateResearchFundamentalsExport(exported),{ok:true});
    assert.equal(exported.facts[0].citation.rawSha256,snapshot.rawSha256);
    console.log(JSON.stringify({mode:"real_original_offline_replay",rawSha256:snapshot.rawSha256,
      byteLength:snapshot.byteLength,textSha256:snapshot.textSha256,startUtf16,endUtf16,
      quote,sourceValue:"150.3",unitScale:1000000000,period:"2025-H1",
      periodAndScope:"explicit_test_actor_confirmation",factReopened:true,
      valuationReopened:true,operatingReopened:true,limitedPackReopened:true,exportValidated:true,
      crossActorAndMemberRejected:true,versionAndSpanTamperRejected:true,
      fixture:false,networkCalls:0,originalOwnerDatabaseTouched:false}));
  }else{
  const captureBody={membershipVersion:version,url:sourceUrl,idempotencyKey:"snapshot-capture-1"};
  const capture=await request("POST",base,captureBody);
  assert.equal(capture.status,200,JSON.stringify(capture.body));
  const snapshot=capture.body.data;
  assert.equal(snapshot.reviewState,"unconfirmed");
  assert.equal(snapshot.rawSha256,createHash("sha256").update(html).digest("hex"));
  assert.equal(snapshot.normalizedText,extractGeelyOfficialHtml(html).normalizedText);
  const listed=await request("GET",base);
  assert.equal(listed.status,200);
  assert.equal(listed.body.data[0].id,snapshot.id);
  assert.equal("normalizedText" in listed.body.data[0],false);
  const other=await request("GET",`${base}/${snapshot.id}`,undefined,otherToken);
  assert.equal(other.status,404);
  const original=await app.inject({method:"GET",url:`${base}/${snapshot.id}/content`,headers:{"x-internal-token":ownerToken}});
  assert.equal(original.statusCode,200);
  assert.ok(original.rawPayload.equals(html));
  const replay=await request("POST",base,captureBody);
  assert.equal(replay.status,200);
  assert.equal(replay.body.data.id,snapshot.id);
  assert.equal(fetchCount,1,"idempotent replay must not fetch the issuer again");
  const conflict=await request("POST",base,{...captureBody,url:sourceUrl+"?changed=1"});
  assert.equal(conflict.status,409);
  const excerpt="Revenue RMB million 150,285";
  const startUtf16=snapshot.normalizedText.indexOf(excerpt),endUtf16=startUtf16+excerpt.length;
  assert.ok(startUtf16>=0);
  const confirmed=await request("POST",`${base}/${snapshot.id}/materials`,{
    membershipVersion:version,startUtf16,endUtf16,validUntil:"2027-08-14T00:00:00.000Z",
    ownerConfirmed:true,idempotencyKey:"snapshot-material-1"});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  const material=confirmed.body.data.data;
  assert.equal(material.snapshotCitation.snapshotId,snapshot.id);
  assert.equal(material.citation,null);
  const factPayload={
    membershipVersion:version,sourceMaterialId:material.id,metric:"revenue",periodKind:"duration",
    periodStart:"2025-01-01",periodEnd:"2025-06-30",currency:"CNY",unitScale:1000000,
    scope:"consolidated",valueStatus:"reported",value:"150285",comparability:"comparable",
    comparabilityReason:null,amendmentKind:"initial",replacesValueId:null,ownerConfirmed:true,
    idempotencyKey:"snapshot-fact-1",assertion:{unit:"currency",measurementBasis:"financial_statement",
      businessScope:"Group",category:"actual",sourceUrl,limitation:"Owner confirmed article labels.",sourceChecked:true,
      structureBinding:{rowLabelText:"Revenue",columnHeaderText:"Six months ended 30 June 2025",
        unitHeaderText:"RMB million",scopeText:"Group",ownerScopeConfirmed:true},
      structureConfirmation:{confirmedFields:["metric","period","currency","unitScale","scope"]},
      snapshotTextBinding:{snapshotId:snapshot.id,textSha256:snapshot.textSha256,startUtf16,endUtf16,
        excerptSha256:createHash("sha256").update(excerpt).digest("hex"),sourceExcerpt:excerpt,rawValueText:"150,285"}}
  };
  const fact=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`,factPayload);
  if(fact.status===503){
    try { await createResearchFundamentalValue(pool,membershipId,factPayload,{actorType:"user",actorId:"snapshot-owner"}); }
    catch(error){ console.error("fundamental direct diagnostic:",error); }
  }
  assert.equal(fact.status,200,JSON.stringify(fact.body));
  assert.equal(fact.body.data.source.kind,"source_snapshot");
  const read=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
  assert.equal(read.status,200,JSON.stringify(read.body));
  assert.equal(read.body.values[0].source.snapshotCitation.snapshotId,snapshot.id);
  assert.equal(read.body.financialCoverage.latestRequiredStatus,"unknown");
  const valuationBase=`/api/mobile/research/candidate-memberships/${membershipId}/valuation-scenarios`;
  const valuation=await request("POST",valuationBase,{membershipVersion:version,symbol:"HK.00175",
    anchorValueId:fact.body.data.id,replacesScenarioSetId:null,assumptions:{metricCurrency:"CNY",
      baseMetricPerShare:12.5,annualGrowthRate:0.1,horizonYears:3,terminalMultiple:18,
      annualDiscountRate:0.12,netCashPerShare:2,growthRateStep:0.03,multipleStep:2},
    ownerConfirmed:true,idempotencyKey:"snapshot-html-valuation"});
  assert.equal(valuation.status,200,JSON.stringify(valuation.body));
  assert.equal(valuation.body.data.anchor.source.kind,"source_snapshot");
  assert.equal(valuation.body.data.anchor.source.snapshotOriginal.rawSha256,snapshot.rawSha256);
  assert.equal("documentId" in valuation.body.data.anchor.source,false);
  const valuationRead=await request("GET",valuationBase);
  assert.equal(valuationRead.status,200,JSON.stringify(valuationRead.body));
  assert.equal(valuationRead.body.scenarioSets[0].anchor.source.snapshotCitation.snapshotId,snapshot.id);
  assert.equal(valuationRead.body.scenarioSets[0].recomputable,true);
  const balanceFacts=[];
  for(const [metric,label,value] of [["total_assets","Total assets","200,000"],["total_liabilities","Total liabilities","50,000"]]){
    const quote=`${label} RMB million ${value}`;
    const quoteStart=snapshot.normalizedText.indexOf(quote),quoteEnd=quoteStart+quote.length;
    assert.ok(quoteStart>=0);
    const selected=await request("POST",`${base}/${snapshot.id}/materials`,{
      membershipVersion:version,startUtf16:quoteStart,endUtf16:quoteEnd,
      validUntil:"2027-08-14T00:00:00.000Z",ownerConfirmed:true,idempotencyKey:`snapshot-${metric}-material`});
    assert.equal(selected.status,200,JSON.stringify(selected.body));
    const balance=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`,{
      ...factPayload,sourceMaterialId:selected.body.data.data.id,metric,periodKind:"instant",
      periodStart:null,value:value.replaceAll(",",""),idempotencyKey:`snapshot-${metric}-fact`,
      assertion:{...factPayload.assertion,structureBinding:{rowLabelText:label,
        columnHeaderText:"As at 30 June 2025",unitHeaderText:"RMB million",
        scopeText:"Group",ownerScopeConfirmed:true},
        snapshotTextBinding:{snapshotId:snapshot.id,textSha256:snapshot.textSha256,
          startUtf16:quoteStart,endUtf16:quoteEnd,
          excerptSha256:createHash("sha256").update(quote).digest("hex"),
          sourceExcerpt:quote,rawValueText:value}}
    });
    assert.equal(balance.status,200,JSON.stringify(balance.body));
    balanceFacts.push(balance.body.data);
  }
  const balanceValuation=await request("POST",valuationBase,{membershipVersion:version,symbol:"HK.00175",
    anchorValueId:balanceFacts[0].id,replacesScenarioSetId:null,
    assumptions:{metricCurrency:"CNY",baseMetricPerShare:12.5,annualGrowthRate:0.1,horizonYears:3,
      terminalMultiple:18,annualDiscountRate:0.12,netCashPerShare:2,growthRateStep:0.03,
      multipleStep:2,methodId:"adjusted_net_asset_value_user_scenario"},
    ownerConfirmed:true,idempotencyKey:"snapshot-html-balance-valuation"});
  assert.equal(balanceValuation.status,200,JSON.stringify(balanceValuation.body));
  const exported=await readResearchFundamentalsExport(pool,membershipId,{actorType:"user",actorId:"snapshot-owner"},new Date(),{repositoryRoot,rawStoreRoot});
  assert.equal(exported.facts.length,3);
  assert.ok(exported.facts.every(item=>item.citation.rawSha256===snapshot.rawSha256
    && item.citation.snapshotId===snapshot.id && !("documentId" in item.citation)));
  assert.equal(exported.facts[0].citation.rawSha256,snapshot.rawSha256);
  assert.equal(exported.facts[0].citation.snapshotId,snapshot.id);
  assert.deepEqual(validateResearchFundamentalsExport(exported),{ok:true});
  const personal=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/personal-brief`);
  assert.equal(personal.status,200,JSON.stringify(personal.body));
  assert.equal(personal.body.status,"available");
  const revenueBriefSource=personal.body.htmlSources.find(source=>source.startUtf16===startUtf16);
  assert.equal(revenueBriefSource.snapshotId,snapshot.id);
  assert.equal(revenueBriefSource.endUtf16,endUtf16);
  assert.equal(revenueBriefSource.readEndUtf16,endUtf16);
  assert.equal(revenueBriefSource.readTruncated,false);
  assert.equal(personal.body.latestFinancialDocument,null);
  assert.deepEqual(personal.body.metrics,[]);
  const investigation=await collectInvestigationEvidence({pool,researchDocument:{repositoryRoot,rawStoreRoot}},
    membershipId,{actorType:"user",actorId:"snapshot-owner"},"earnings_quality");
  const htmlEvidence=investigation.sources.find(source=>source.sourceType==="official_body"
    && source.snapshotCitation?.startUtf16===startUtf16);
  assert.equal(htmlEvidence.snapshotCitation.snapshotId,snapshot.id);
  assert.equal(htmlEvidence.snapshotCitation.rawSha256,snapshot.rawSha256);
  assert.equal(htmlEvidence.snapshotCitation.readExcerptSha256,createHash("sha256").update(excerpt).digest("hex"));
  const pack=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,{
    researchMode:"limited",membershipVersion:version,idempotencyKey:"snapshot-limited-pack"});
  assert.equal(pack.status,200,JSON.stringify(pack.body));
  assert.equal(pack.body.data.items.filter(item=>item.snapshotCitation?.snapshotId===snapshot.id).length,3);
  assert.equal(pack.body.data.items.find(item=>item.id===material.id).citation,null);
  const reopened=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/deep-research`);
  assert.equal(reopened.status,200,JSON.stringify(reopened.body));
  assert.equal(reopened.body.data.latestPack.items.find(item=>item.id===material.id).snapshotCitation.snapshotId,snapshot.id);
  const operatingRevenue=reopened.body.data.operatingReasoning?.facts.find(item=>item.metric==="revenue");
  assert.equal(operatingRevenue?.source.snapshotCitation?.snapshotId,snapshot.id);
  assert.equal(operatingRevenue?.source.snapshotOriginal?.rawSha256,snapshot.rawSha256);
  assert.equal(operatingRevenue?.source.snapshotTextBinding?.sourceExcerpt,excerpt);
  const contextAt=new Date().toISOString();
  const context=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/research-context`,{
    baseContextId:null,membershipVersion:version,selectedSymbol:"HK.00175",industry:"fixture_only",
    selectedFacts:[],peerFacts:[],peers:[],operatingKpis:[],macroDrivers:[],industryDrivers:[],
    unknowns:["This test context contains no cited industry facts."],
    provenance:{sourceType:"fixture_context",sourceVersion:"fixture-v1",capturedAt:contextAt,
      classification:"research_only"},asOf:contextAt,cutoffAt:contextAt,
    validUntil:"2027-08-14T00:00:00.000Z",operatingModel:emptyOperatingModel(Number(contextAt.slice(0,4))),
    idempotencyKey:"snapshot-full-pack-context"});
  assert.equal(context.status,200,JSON.stringify(context.body));
  const modelUpdate=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/research-context/operating-model`,{
    baseContextId:context.body.data.id,membershipVersion:version,selectedSymbol:"HK.00175",
    operatingModel:emptyOperatingModel(Number(contextAt.slice(0,4))),idempotencyKey:"snapshot-html-operating-model"});
  assert.equal(modelUpdate.status,200,JSON.stringify(modelUpdate.body));
  const underwritingRead=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/research-underwriting`);
  assert.equal(underwritingRead.status,200,JSON.stringify(underwritingRead.body));
  const technical=await persistResearchFrozenTechnicalFixture(pool,{code:"00175",
    cutoff:latestCompletedHongKongSession(new Date()),revision:1});
  const analysisAsOf=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",
    year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const weekly=await request("GET",`/api/mobile/market/weinstein/HK/00175?analysisAsOf=${analysisAsOf}`);
  assert.equal(weekly.status,200,JSON.stringify(weekly.body));
  const expectedWeinstein=frozenWeinsteinEvidenceBinding(weekly.body);
  assert.ok(expectedWeinstein);
  const methods=(await request("GET",valuationBase)).body.scenarioSets;
  assert.equal(methods.filter(item=>item.recomputable).length,2);
  const fullFreezePayload={
    membershipVersion:version,expectedScenarioId:balanceValuation.body.data.id,
    expectedScenarioRevision:balanceValuation.body.data.revision,
    expectedValuationMethods:methods.map(item=>({scenarioId:item.id,scenarioRevision:item.revision,
      methodId:item.calculation.method.id})),expectedWeinstein,
    expectedTechnicalSnapshotSha:technical.dailyBars.snapshot.snapshotSha,
    expectedTechnicalResultHash:technical.technical.resultHash,
    idempotencyKey:"snapshot-full-pack"};
  const fullPack=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,fullFreezePayload);
  assert.equal(fullPack.status,200,JSON.stringify(fullPack.body));
  assert.equal(fullPack.body.data.researchMode,undefined);
  assert.equal(fullPack.body.data.items.filter(item=>item.snapshotCitation?.snapshotId===snapshot.id).length,3);
  const cloudPolicy=await request("POST","/api/mobile/research/cloud-ai-policy/decisions",{
    action:"enable",policyVersion:CLOUD_AI_PROVIDER_POLICY_VERSION,backupProvider:"none",
    ownerConfirmed:true,idempotencyKey:"snapshot-local-task-policy"});
  assert.equal(cloudPolicy.status,200,JSON.stringify(cloudPolicy.body));
  const intent=defaultDeepResearchTaskIntent(fullPack.body.data);
  intent.providerAuthorization.ownerConfirmed=true;
  intent.providerAuthorization.confirmedIntentFingerprint=deepResearchProviderAuthorizationFingerprint(intent);
  const task=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/deep-research-tasks`,{
    membershipVersion:version,evidencePackId:fullPack.body.data.id,
    evidencePackBinding:evidenceBoundReportPackBinding(fullPack.body.data),intent,
    reportContractVersion:DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
    idempotencyKey:"snapshot-local-html-task"});
  assert.equal(task.status,202,JSON.stringify(task.body));
  const taskExpected={membershipVersion:version,evidencePackId:fullPack.body.data.id,
    evidencePackFingerprint:fullPack.body.data.packFingerprint,intent};
  const assembled=await readCurrentDeepResearchSnapshot(pool,membershipId,taskExpected,
    {actorType:"user",actorId:"snapshot-owner"},new Date(),{repositoryRoot,rawStoreRoot});
  assert.ok(assembled.snapshotId);
  await assert.rejects(readCurrentDeepResearchSnapshot(pool,membershipId,taskExpected,
    {actorType:"user",actorId:"snapshot-owner"},new Date()),/current evidence pack/);
  const runnerRawPath=join(rawStoreRoot,snapshot.rawSha256.slice(0,2),snapshot.rawSha256);
  const runnerMovedPath=runnerRawPath+".runner-temporarily-missing";
  const runnerOriginalBytes=runnerCorruptDuring?await readFile(runnerRawPath):null;
  let runnerRawMoved=false,runnerRawCorrupted=false,fixtureSynthesized=false;
  if(runnerLossBefore){await rename(runnerRawPath,runnerMovedPath);runnerRawMoved=true;}
  let ranTask;
  try {ranTask=await runDeepResearchTaskOnce(pool,new Date(),{
    claim:claimDeepResearchTask,bindSnapshot:bindDeepResearchTaskSnapshot,
    assembleSnapshot:readCurrentDeepResearchSnapshot,storeSynthesis:storeDeepResearchTaskSynthesis,
    fail:failDeepResearchTask,sourceStore:{repositoryRoot,rawStoreRoot},
    providerConfig:{baseUrl:"https://fixture.invalid/v1/",model:"deepseek-flash",apiKey:"REDACTED_SECRET",timeoutMs:1000},
    synthesize:async (selected,_config,_fetcher,onPrepared,sendAuthorization)=>{
      fixtureSynthesized=true;
      const manifest={purpose:"deep_research_synthesis",policyVersion:CLOUD_AI_PROVIDER_POLICY_VERSION,
        provider:"deepseek",model:"deepseek-flash",snapshotId:selected.snapshotId,
        membershipId:selected.target.membershipId,membershipVersion:selected.target.membershipVersion,
        symbol:selected.target.symbol,evidencePackId:selected.evidencePack.id,
        evidencePackVersion:selected.evidencePack.version,evidencePackFingerprint:selected.evidencePack.packFingerprint,
        selectedMaterialIds:selected.intent.selectedMaterialIds,
        includedStructuredSections:selected.intent.includedStructuredSections,
        payloadFields:["selectedSnapshot","exactSourceBindings"],sourceBindingCount:0,
        requestBodySha256:"e".repeat(64),fullPdfSent:false,credentialsSent:false,
        officialAssetFactsSent:false,...(sendAuthorization?{sendAuthorization}:{})};
      await onPrepared(manifest);
      if(runnerLossDuring){await rename(runnerRawPath,runnerMovedPath);runnerRawMoved=true;}
      if(runnerCorruptDuring){await writeFile(runnerRawPath,Buffer.from("corrupt local task original"));runnerRawCorrupted=true;}
      if(runnerBodyChangeDuring){
        currentHtml=Buffer.from(html.toString().replace("Revenue RMB million 150,285","Revenue RMB million 151,285"));
        const changed=await request("POST",base,{...captureBody,idempotencyKey:"runner-body-change-during"});
        assert.equal(changed.status,200,JSON.stringify(changed.body));
        assert.equal(changed.body.data.reviewState,"pending_review");
      }
      return {payload:localFixtureSynthesis(),sendManifest:manifest,reproducibility:{
        generationMethod:"deepseek_chat_completions_selected_snapshot",provider:"deepseek",model:"deepseek-flash",
        prompt:"deep-research-snapshot-synthesis.v1",tokenUsage:"prompt=1,completion=1,total=2",cost:"UNKNOWN"}};
    }
  });}finally{
    if(runnerRawMoved)await rename(runnerMovedPath,runnerRawPath);
    if(runnerRawCorrupted)await writeFile(runnerRawPath,runnerOriginalBytes);
  }
  assert.equal(ranTask,true);
  const taskAfterRunner=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/deep-research-tasks/${task.body.data.id}`);
  console.log(JSON.stringify({probe:"html_task_local_fixture_no_cloud_send",mode:runnerLossBefore?"source_loss_before":runnerLossDuring?"source_loss_during":runnerCorruptDuring?"source_corrupt_during":runnerBodyChangeDuring?"source_body_change_during":"success",
    status:taskAfterRunner.body.data?.status,errorCode:taskAfterRunner.body.data?.errorCode,fixtureSynthesized}));
  if(runnerLossBefore||runnerLossDuring||runnerCorruptDuring||runnerBodyChangeDuring){
    assert.equal(taskAfterRunner.body.data.status,"failed",JSON.stringify(taskAfterRunner.body));
    assert.equal(taskAfterRunner.body.data.errorCode,"research_gate_failed");
    assert.equal(taskAfterRunner.body.data.report,null);
    assert.equal(fixtureSynthesized,runnerLossDuring||runnerCorruptDuring||runnerBodyChangeDuring);
  }else{
    assert.equal(taskAfterRunner.body.data.status,"ready_to_absorb",JSON.stringify(taskAfterRunner.body));
    const absorbed=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/deep-research-tasks/${task.body.data.id}/absorb`,{
      membershipVersion:version,taskRequestFingerprint:taskAfterRunner.body.data.requestFingerprint,
      snapshotId:taskAfterRunner.body.data.snapshotBinding.snapshotId,idempotencyKey:"snapshot-local-fixture-absorb"});
    assert.equal(absorbed.status,200,JSON.stringify(absorbed.body));
    assert.equal(absorbed.body.data.status,"succeeded");
    assert.ok(absorbed.body.data.report?.id);
    console.log(JSON.stringify({probe:"html_task_absorbed_local_fixture",status:absorbed.body.data.status,
      reportId:absorbed.body.data.report.id,cloudModelCalls:0,formalOwnerAcceptance:"UNKNOWN"}));
  }
  if(consumerProbe){
    const actor={actorType:"user",actorId:"snapshot-owner"};
    const storedAssets=await createAssetsAlphaSnapshot(pool,{source:"owner_current",asOf:new Date().toISOString(),cashHkd:null,
      positions:[{symbol:"HK.00175",quantity:100,marketValueHkd:null,unrealizedPnlHkd:null,
        costLots:[{quantity:100,unitCostHkd:10}]}],ownerConfirmed:true,expectedSnapshotId:null,
      idempotencyKey:"source-consumer-test-assets"},actor);
    assert.ok(storedAssets.createdRecord?.id);
    const stock=(await pool.query("select id from stocks where market='HK' and code='00175' limit 1")).rows[0];
    assert.ok(stock);
    const quoteTime=new Date();
    await pool.query(`insert into market_quotes(stock_id,market,code,symbol,provider,provider_status,name,currency,
      price,previous_close,change_amount,change_percent,quote_time,fetched_at,raw_payload)
      values($1,'HK','00175','HK.00175','futu','live','TEST FIXTURE ONLY','HKD',91,100,-9,-9,$2,$2,$3)`,
      [stock.id,quoteTime,{fixtureOnly:true}]);
    const consumerRead=async(mode)=>{
      const fundamentals=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
      const inbox=await request("GET","/api/mobile/research/today/inbox");
      const readiness=await request("GET",`/api/mobile/research/${membershipId}/loop-readiness`);
      const assets=await request("GET","/api/mobile/assets/research-context");
      const anomaly=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/market-anomaly`);
      const intake=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/source-intake`);
      const cutoff=new Date();
      const sourceStore={repositoryRoot,rawStoreRoot,availabilityCache:new Map()};
      const workspace=await readDeepResearchWorkspace(pool,membershipId,actor,cutoff,
        {accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
      const context=await readResearchContextSnapshot(pool,membershipId,actor,cutoff);
      const historical=await historicalOperatingSnapshot(pool,actor,workspace,context,cutoff.toISOString(),sourceStore);
      const historicalFacts=await readResearchFundamentals(pool,membershipId,actor,cutoff,cutoff,{repositoryRoot,rawStoreRoot});
      const result={mode,statuses:{fundamentals:fundamentals.status,inbox:inbox.status,readiness:readiness.status,
        assets:assets.status,anomaly:anomaly.status,intake:intake.status},
        availability:fundamentals.body.values.find(v=>v.id===fact.body.data.id)?.source.originalAvailability,
        inboxKinds:inbox.body.items?.map(item=>item.kind),
        inboxResearchItems:inbox.body.items?.filter(item=>item.kind==="research").map(item=>({
          id:item.id,sourceType:item.source.sourceType,sourceFingerprint:item.source.sourceFingerprint,
          membershipVersion:item.membership.version})),readinessState:readiness.body.researchFreshness,
        assetSnapshotIdentity:assets.body.portfolioSnapshotIdentity,
        holdingIdentity:assets.body.items?.[0]?.holdingIdentity,
        assetResearchState:assets.body.items?.[0]?.researchState,
        anomalyFormalStatus:anomaly.body.formalResearch?.status,
        historicalFingerprint:historical?.fingerprint,
        historicalReviewState:historicalFacts.values.find(v=>v.id===fact.body.data.id)?.source.snapshotReviewState,
        historicalOriginalAvailability:historicalFacts.values.find(v=>v.id===fact.body.data.id)?.source.originalAvailability};
      console.log(JSON.stringify({probe:"source_consumer_entrypoints",...result}));
      return result;
    };
    const originalPath=join(rawStoreRoot,snapshot.rawSha256.slice(0,2),snapshot.rawSha256);
    const movedPath=originalPath+".consumer-temporarily-missing";
    const valid=await consumerRead("available");
    const dispositionItem=valid.inboxResearchItems.find(item=>item.sourceType==="research_decision_update");
    assert.ok(dispositionItem);
    const dispositionPayload={itemId:dispositionItem.id,membershipVersion:dispositionItem.membershipVersion,
      sourceFingerprint:dispositionItem.sourceFingerprint,state:"later",snoozedUntil:new Date(Date.now()+86400000).toISOString(),
      idempotencyKey:"source-consumer-disposition-valid"};
    const dispositionValid=await request("POST","/api/mobile/research/today/inbox/material-dispositions",dispositionPayload);
    assert.equal(dispositionValid.status,200,JSON.stringify(dispositionValid.body));
    await rename(originalPath,movedPath);
    let missing;
    try{
      missing=await consumerRead("missing");
      const dispositionMissing=await request("POST","/api/mobile/research/today/inbox/material-dispositions",
        {...dispositionPayload,idempotencyKey:"source-consumer-disposition-missing"});
      assert.equal(dispositionMissing.status,409,JSON.stringify(dispositionMissing.body));
      console.log(JSON.stringify({probe:"source_consumer_disposition",validStatus:dispositionValid.status,
        missingStatus:dispositionMissing.status,itemSourceType:dispositionItem.sourceType}));
    }finally{await rename(movedPath,originalPath);}
    const originalBytes=await readFile(originalPath);
    await writeFile(originalPath,Buffer.from("corrupt consumer fixture original"));
    let corrupt;
    try{corrupt=await consumerRead("corrupt");}finally{await writeFile(originalPath,originalBytes);}
    assert.equal(valid.availability,"available");
    assert.equal(missing.availability,"unavailable");
    assert.equal(corrupt.availability,"unavailable");
    for(const result of [valid,missing,corrupt]){
      assert.deepEqual(result.statuses,{fundamentals:200,inbox:200,readiness:200,assets:200,anomaly:200,intake:200});
      assert.equal(result.historicalReviewState,"current","asOf source review chronology must not change with present CAS availability");
      assert.equal(result.historicalOriginalAvailability,result.availability);
      assert.equal(result.assetResearchState,"REVIEW_LOOP_NOT_ENABLED");
      assert.equal(result.anomalyFormalStatus,"CURRENT");
    }
    assert.ok(valid.inboxKinds.filter(kind=>kind==="research").length>missing.inboxKinds.filter(kind=>kind==="research").length);
    assert.deepEqual(missing.inboxKinds,corrupt.inboxKinds);
    assert.notEqual(valid.historicalFingerprint,missing.historicalFingerprint);
    assert.equal(missing.historicalFingerprint,corrupt.historicalFingerprint);
    assert.equal(valid.assetSnapshotIdentity,missing.assetSnapshotIdentity);
    assert.equal(valid.assetSnapshotIdentity,corrupt.assetSnapshotIdentity);
    assert.equal(valid.holdingIdentity,missing.holdingIdentity);
    assert.equal(valid.holdingIdentity,corrupt.holdingIdentity);
    const assetRows=await pool.query("select source_hash,cash_hkd,positions from assets_alpha_snapshots where actor_type=$1 and actor_id=$2",
      [actor.actorType,actor.actorId]);
    assert.equal(assetRows.rows.length,1);
    assert.equal(assetRows.rows[0].source_hash,storedAssets.createdRecord.sourceHash);
    assert.equal(assetRows.rows[0].cash_hkd,null);
    assert.equal(assetRows.rows[0].positions[0].quantity,100);
    const invalidation=await appendAssertionLifecycle(pool,membershipId,actor,{membershipVersion:version,
      fundamentalValueId:fact.body.data.id,status:"INVALID",reason:"TEST FIXTURE ONLY · source invalidation readback",
      sourceMaterialId:null});
    assert.ok(invalidation.eventId);
    const noticeRead=async()=>{
      const sourceStore={repositoryRoot,rawStoreRoot,availabilityCache:new Map()};
      const w=await readDeepResearchWorkspace(pool,membershipId,actor,new Date(),
        {accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
      return materialInvalidationNotice(pool,actor,w,sourceStore);
    };
    const validNotice=await noticeRead();
    await rename(originalPath,movedPath);
    let missingNotice;
    try{missingNotice=await noticeRead();}finally{await rename(movedPath,originalPath);}
    assert.ok(validNotice);
    assert.ok(missingNotice);
    assert.notEqual(validNotice.id,missingNotice.id);
    console.log(JSON.stringify({probe:"source_consumer_material_invalidation",eventId:invalidation.eventId,
      availableNotice:validNotice?.id??null,missingNotice:missingNotice?.id??null}));
  }
  if(!runnerBodyChangeDuring&&!consumerProbe){
  const factsForCompleteness=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
  const completeness=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/completeness`,{
    membershipVersion:version,baseSnapshotId:null,
    expectedFundamentalsDataCutoffAt:factsForCompleteness.body.dataCutoffAt,
    expectedResearchContextId:modelUpdate.body.data.id,
    externalSections:["valuation","quant","weinstein","risks","counterevidence","conflicts"].map(section=>({
      section,status:"unknown",coverage:{achieved:0,required:1},sourceBindings:[],gaps:[`${section} remains UNKNOWN in this fixture`]})),
    validUntil:"2027-08-14T00:00:00.000Z",ownerConfirmed:true,idempotencyKey:"snapshot-html-completeness"});
  assert.equal(completeness.status,200,JSON.stringify(completeness.body));
  assert.equal((await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/completeness`)).status,200);
  const fullReopen=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/deep-research`);
  assert.equal(fullReopen.status,200,JSON.stringify(fullReopen.body));
  assert.equal(fullReopen.body.data.latestPack.id,fullPack.body.data.id);
  assert.equal(fullReopen.body.data.latestPack.frozenResearchContext.valuationMethods.length,2);
  const rawPath=join(rawStoreRoot,snapshot.rawSha256.slice(0,2),snapshot.rawSha256);
  const movedRawPath=rawPath+".temporarily-missing";
  await rename(rawPath,movedRawPath);
  const missingCompleteness=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/completeness`);
  assert.equal(missingCompleteness.status,503,"missing original must invalidate current completeness readback");
  const missingRawFreeze=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,{
    researchMode:"limited",membershipVersion:version,idempotencyKey:"snapshot-freeze-missing-raw"});
  assert.notEqual(missingRawFreeze.status,200);
  const missingFullReplay=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,fullFreezePayload);
  assert.notEqual(missingFullReplay.status,200);
  await rename(movedRawPath,rawPath);
  assert.equal((await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/completeness`)).status,200);
  await writeFile(rawPath,Buffer.from("corrupt disposable test CAS"));
  const corruptCompleteness=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/completeness`);
  assert.equal(corruptCompleteness.status,503,"corrupt original must invalidate current completeness readback");
  const corruptRawFreeze=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,{
    researchMode:"limited",membershipVersion:version,idempotencyKey:"snapshot-freeze-corrupt-raw"});
  assert.notEqual(corruptRawFreeze.status,200);
  const corruptFullReplay=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,fullFreezePayload);
  assert.notEqual(corruptFullReplay.status,200);
  await writeFile(rawPath,html);
  const originalReplay=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,{
    researchMode:"limited",membershipVersion:version,idempotencyKey:"snapshot-limited-pack"});
  assert.equal(originalReplay.status,200,JSON.stringify(originalReplay.body));
  const fullReplay=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,fullFreezePayload);
  assert.equal(fullReplay.status,200,JSON.stringify(fullReplay.body));
  assert.equal(fullReplay.body.data.id,fullPack.body.data.id);
  currentHtml=Buffer.from(html.toString()+"<!-- local tracking markup changed -->");
  const rawOnly=await request("POST",base,{...captureBody,idempotencyKey:"snapshot-capture-raw-only"});
  assert.equal(rawOnly.status,200,JSON.stringify(rawOnly.body));
  assert.equal(rawOnly.body.data.textSha256,snapshot.textSha256);
  assert.equal(rawOnly.body.data.rawChangeOnly,true);
  assert.equal(rawOnly.body.data.reviewState,"current");
  const stillCurrent=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
  assert.equal(stillCurrent.body.values[0].valueState,"current");
  currentHtml=Buffer.from(html.toString().replace("Revenue RMB million 150,285","Revenue RMB million 151,285"));
  const changed=await request("POST",base,{...captureBody,idempotencyKey:"snapshot-capture-content-change"});
  assert.equal(changed.status,200,JSON.stringify(changed.body));
  assert.notEqual(changed.body.data.textSha256,snapshot.textSha256);
  assert.equal(changed.body.data.reviewState,"pending_review");
  const oldOriginal=await request("GET",`${base}/${snapshot.id}`);
  assert.equal(oldOriginal.body.data.reviewState,"historical");
  assert.equal(oldOriginal.body.data.normalizedText,snapshot.normalizedText);
  const noOldConfirm=await request("POST",`${base}/${snapshot.id}/materials`,{
    membershipVersion:version,startUtf16,endUtf16,validUntil:"2027-08-14T00:00:00.000Z",
    ownerConfirmed:true,idempotencyKey:"snapshot-old-confirm-blocked"});
  assert.equal(noOldConfirm.status,409);
  const sourceChanged=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
  assert.equal(sourceChanged.body.values[0].valueState,"historical_source_superseded");
  const personalAfterChange=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/personal-brief`);
  assert.equal(personalAfterChange.status,200);
  assert.equal(personalAfterChange.body.status,"source_insufficient");
  const packAfterChange=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/deep-research`);
  assert.equal(packAfterChange.status,200,JSON.stringify(packAfterChange.body));
  assert.equal(packAfterChange.body.data.latestPack.currentness.status,"historical");
  assert.ok(packAfterChange.body.data.latestPack.currentness.invalidatedBy.includes("source_version_review_required"));
  const blockedFreeze=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/evidence-packs`,{
    researchMode:"limited",membershipVersion:version,idempotencyKey:"snapshot-freeze-after-change"});
  assert.equal(blockedFreeze.status,422);
  const noCurrentExport=await readResearchFundamentalsExport(pool,membershipId,{actorType:"user",actorId:"snapshot-owner"},new Date(),{repositoryRoot,rawStoreRoot});
  assert.equal(noCurrentExport.facts.length,0);
  const offlineReplay=await request("POST",base,captureBody);
  assert.equal(offlineReplay.status,200);
  assert.equal(offlineReplay.body.data.id,snapshot.id);
  assert.equal(fetchCount,3,"replaying a saved key after source drift must not fetch again");
  currentHtml=html;
  const returned=await request("POST",base,{...captureBody,idempotencyKey:"snapshot-capture-body-returned"});
  assert.equal(returned.status,200,JSON.stringify(returned.body));
  assert.equal(returned.body.data.reviewState,"pending_review","A→B→A must require fresh Owner confirmation");
  const oldAfterReturn=await request("GET",`${base}/${snapshot.id}`);
  assert.equal(oldAfterReturn.body.data.reviewState,"historical");
  const renewed=await request("POST",`${base}/${returned.body.data.id}/materials`,{
    membershipVersion:version,startUtf16,endUtf16,validUntil:"2027-08-14T00:00:00.000Z",
    replacesMaterialId:material.id,ownerConfirmed:true,idempotencyKey:"snapshot-material-body-returned"});
  assert.equal(renewed.status,200,JSON.stringify(renewed.body));
  assert.notEqual(renewed.body.data.data.id,material.id);
  assert.notEqual(renewed.body.data.data.sourceVersion,material.sourceVersion);
  const afterConfirmation=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`);
  assert.equal(afterConfirmation.body.values.find(v=>v.id===fact.body.data.id).valueState,"historical_source_superseded");
  const replacementFact={...factPayload,sourceMaterialId:renewed.body.data.data.id,
    amendmentKind:"initial",replacesValueId:null,idempotencyKey:"snapshot-fact-body-returned",
    assertion:{...factPayload.assertion,snapshotTextBinding:{...factPayload.assertion.snapshotTextBinding,
      snapshotId:returned.body.data.id,textSha256:returned.body.data.textSha256}}};
  const updatedFact=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/fundamentals`,replacementFact);
  assert.equal(updatedFact.status,200,JSON.stringify(updatedFact.body));
  assert.equal(updatedFact.body.data.source.snapshotCitation.snapshotId,returned.body.data.id);
  const deleted=await request("POST",`/api/mobile/research/candidate-memberships/${membershipId}/materials/${material.id}/deletion`,{
    membershipVersion:version,idempotencyKey:"snapshot-old-material-delete"});
  assert.equal(deleted.status,200,JSON.stringify(deleted.body));
  const tombstone=await pool.query(`select citation_snapshot_id,citation_snapshot_membership_version,
    citation_snapshot_text_sha256,citation_start_utf16,citation_end_utf16,citation_excerpt_sha256
    from research_materials where id=$1`,[material.id]);
  assert.ok(Object.values(tombstone.rows[0]).every(value=>value===null));
  const originalStillReadable=await request("GET",`${base}/${snapshot.id}`);
  assert.equal(originalStillReadable.status,200);
  const longQuote="x".repeat(3299)+"😀"+"tail".repeat(200);
  currentHtml=Buffer.from(`<!doctype html><html><body><div class="c-news-detail-content">
    <p>Aug 14, 2025</p><h1>Geely Auto 2025 H1 Revenues</h1>
    <p>Geely Automobile Holdings Ltd (HK.0175) reported 2025 H1 results.</p><p>${longQuote}</p>
  </div></body></html>`);
  const longCapture=await request("POST",base,{...captureBody,idempotencyKey:"snapshot-long-utf16-capture"});
  assert.equal(longCapture.status,200,JSON.stringify(longCapture.body));
  const longStart=longCapture.body.data.normalizedText.indexOf(longQuote),longEnd=longStart+longQuote.length;
  assert.ok(longStart>=0);
  const longConfirm=await request("POST",`${base}/${longCapture.body.data.id}/materials`,{
    membershipVersion:version,startUtf16:longStart,endUtf16:longEnd,validUntil:"2027-08-14T00:00:00.000Z",
    ownerConfirmed:true,idempotencyKey:"snapshot-long-utf16-material"});
  assert.equal(longConfirm.status,200,JSON.stringify(longConfirm.body));
  const longBrief=await request("GET",`/api/mobile/research/candidate-memberships/${membershipId}/personal-brief`);
  const readLong=longBrief.body.htmlSources.find(source=>source.snapshotId===longCapture.body.data.id);
  assert.equal(readLong.readTruncated,true);
  assert.equal(readLong.readEndUtf16-readLong.readStartUtf16,3299);
  assert.equal(readLong.excerpt,"x".repeat(3299));
  console.log(JSON.stringify({ database:name,migration070:"applied_then_skipped",offlineCapture:true,
    snapshotId:snapshot.id,materialId:material.id,factId:fact.body.data.id,rawSha256:snapshot.rawSha256,
    rawOnlyChangePreservedFact:true,sourceBodyChangeInvalidatedFact:true,limitedPackWithHtml:true,
    htmlValuationReopened:true,htmlOperatingReasoningReopened:true,fullPackWithHtml:true,
    bodyReturnRequiredConfirmation:true,missingAndCorruptRawFreezeRejected:true,
    missingAndCorruptFullPackReplayRejected:true,htmlMaterialTombstoneCleared:true,
    utf16TruncationPreservesCodePoint:true,
    originalOwnerDatabaseTouched:false }));
  }
  }
} finally {
  if (app) await app.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  if(weeklyBridge.listening)await new Promise(resolve=>weeklyBridge.close(resolve));
  postgres("dropdb", ["--if-exists", "--force", name], true);
  await rm(rawStoreRoot,{recursive:true,force:true});
}

function localFixtureSynthesis(){
  return {adviceLayer:{conclusion:"OFFLINE FIXTURE ONLY; evidence remains incomplete.",
    confidence:"UNKNOWN",applicableUntil:"2027-08-14T00:00:00.000Z",
    horizonStatement:"Separate long and short research horizons.",
    longTerm:{view:"UNKNOWN",conditions:[],invalidationConditions:[],risks:[]},
    mediumShortTerm:{view:"UNKNOWN",conditions:[],invalidationConditions:[],risks:[]},
    conflict:{status:"UNKNOWN",description:"UNKNOWN"},automaticTradingSignal:false,
    direction:"wait_for_evidence",priceConditions:["Wait for current evidence."],
    priceRange:"UNKNOWN",researchPositionRange:"0%; fixture research only.",
    assumptions:["Original source remains available."],scenarios:["Unknown until reviewed."],
    nextQuestion:"Which official source closes the gap?",versionChange:"Offline fixture task."},
    researchLayer:{fundamentals:[],context:[],eventsAndCatalysts:[],operatingMonitor:[],risks:[],
      counterevidence:[],unknowns:[],sourceConflicts:[],nextValidationQuestions:[]},
    changeFromPrevious:"Offline fixture only."};
}

function weeklyFixture(analysisAsOf){
  const end=Date.parse(`${completedWeekEnd(analysisAsOf)}T00:00:00.000Z`);
  const series=(symbol,initial,growth,adjustment)=>({symbol,name:`Fixture-only ${symbol}`,adjustment,
    bars:Array.from({length:60},(_,index)=>{
      const close=initial*(1+growth)**Math.max(0,index-39)*(1+Math.sin(index*2*Math.PI/3)*0.01);
      return {session:new Date(end-(59-index)*7*86400000).toISOString().slice(0,10),
        open:close*0.99,high:close*1.02,low:close*0.98,close,volume:index===59?2000000:1000000};
    })});
  return {provider:"futu_opend",endpoint:"weinstein-weekly",rights:"confirmed",retention:"confirmed",
    derivedUse:"confirmed",fetchedAt:`${analysisAsOf}T00:00:00+08:00`,analysisAsOf,
    sectorIdentityAsOf:analysisAsOf,
    stock:series("HK.00175",10,0.012,"forward_qfq_research_only"),
    marketBenchmark:series("HK.800000",30000,-0.002,"none_index_or_sector"),
    sectorBenchmark:series("HK.LIST123",1000,0.006,"none_index_or_sector")};
}
