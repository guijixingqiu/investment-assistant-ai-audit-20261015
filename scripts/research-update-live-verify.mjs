#!/usr/bin/env node
// Explicit, bounded live-provider check using public issuer facts in a disposable database.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { Pool } from "pg";
import { runMigrations } from "./migration-runner.mjs";
import { resolveLocalPostgresEndpoint } from "./gate-b-verify.mjs";
import { loadConfig } from "../dist/apps/api/src/config.js";
import { buildServer } from "../dist/apps/api/src/server.js";
import { createScopedResearchToken } from "../dist/apps/api/src/routes/researchAuth.js";
import { CLOUD_AI_PROVIDER_POLICY_VERSION } from "../dist/packages/contracts/src/cloudAiPolicy.js";
import { deepResearchPackBinding } from "../dist/packages/contracts/src/limitedResearch.js";
import { defaultDeepResearchTaskIntent } from "../dist/packages/contracts/src/deepResearchTask.js";
import { deepResearchProviderAuthorizationFingerprint } from "../dist/apps/api/src/research/deepResearchGate.js";
import { runDeepResearchTaskOnce } from "../dist/apps/api/src/research/deepResearchTaskRunner.js";
import { readCurrentDeepResearchSnapshot } from "../dist/apps/api/src/research/deepResearchSnapshotAssembler.js";
import { generateDeepResearchSynthesisWithAi } from "../dist/apps/api/src/research/deepResearchSynthesisAi.js";
import { claimDeepResearchTask, bindDeepResearchTaskSnapshot, storeDeepResearchTaskSynthesis, failDeepResearchTask } from "../dist/apps/api/src/research/deepResearchTaskRepository.js";
import { deepResearchReportSummary } from "../dist/apps/web/src/deepResearchReportSummary.js";

if (!process.argv.includes("--execute")) {
  console.log("Use --execute for two DeepSeek calls with bounded public issuer summaries; no private research or asset facts are sent.");
  process.exit(0);
}
const sources = [
  { title: "吉利汽车2025年度业绩新闻稿：历史基线", publishedAt: "2026-03-18T00:00:00.000Z",
    url: "https://www.geelyauto.com.hk/wp-content/uploads/2026/03/e_20260318_Press-Release_Geely_2025-Annual-Results.pdf",
    summary: "发行人2026年3月18日披露：2025全年收入3452亿元人民币，同比增长25%；核心归母利润144.1亿元人民币，同比增长36%，核心口径剔除外汇、减值及若干处置损益，不等同法定净利润。全年销量3024567辆，同比增长39%；当时提出2026销量目标345万辆。这里是历史基线，不代表最新预测或当前价格。" },
  { title: "吉利汽车2026年8月销量新闻稿：增量资料", publishedAt: "2026-09-01T00:00:00.000Z",
    url: "https://www.geelyauto.com.hk/wp-content/uploads/2026/09/Geely_2026_Aug-Sales_EN_20260901.pdf",
    summary: "发行人2026年9月1日披露：2026年8月销量270194辆，同比约增长8%；2026年1至8月累计1943313辆，同比增长约2%。8月出口110094辆，同比增长205%；累计出口690985辆，同比增长170%。单月与累计口径不同；月度销量为未审计数据。该资料没有收入、利润率、现金流、估值或当前报价，不能由销量直接推出利润增长或价格条件。" }
];
const endpoint = resolveLocalPostgresEndpoint(process.env, userInfo().username);
const db = `annual_rings_step5_${Date.now()}`;
const host = endpoint.host === "::1" ? "[::1]" : endpoint.host;
const databaseUrl = `postgresql://${encodeURIComponent(endpoint.user)}${endpoint.password ? `:${encodeURIComponent(endpoint.password)}` : ""}@${host}:${endpoint.port}/${db}`;
const commandEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && !key.startsWith("PG")));
if (endpoint.password) commandEnv.PGPASSWORD = endpoint.password;
const postgres = (command, args) => execFileSync(command, ["--host", endpoint.host, "--port", endpoint.port, "--username", endpoint.user, ...args], { env: commandEnv, stdio: "pipe" });
const apiKey = process.env.RESEARCH_AI_API_KEY || execFileSync("security", ["find-generic-password", "-s", "investment-assistant-system-ai-provider", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const providerConfig = { apiKey, baseUrl: "https://api.deepseek.com/", model: "deepseek-flash", timeoutMs: 60000 };
const actorId = "step5-public-source-validation";
const authSigningKey = randomBytes(32).toString("hex");
const now = Math.floor(Date.now() / 1000);
const headers = { "x-internal-token": createScopedResearchToken({ version: 2, tokenId: randomUUID(), actorId,
  scopes: ["read", "candidate_write", "research_write"], issuedAt: now, expiresAt: now + 600 }, authSigningKey) };
let app, pool;
const evidence = { checkedAt: new Date().toISOString(), codeHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingDiffSha256: createHash("sha256").update(execFileSync("git", ["diff", "HEAD", "--binary"])).digest("hex"),
  sourceKind: "public_issuer_summaries_manually_verified", sources, realProvider: true, nativeRuntime: false, ownerAcceptance: false, runs: [] };
async function request(method, url, payload, status = 200) {
  const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  assert.equal(response.statusCode, status, `${method} ${url}: ${response.body}`);
  return response.json();
}
try {
  postgres("createdb", [db]);
  pool = new Pool({ connectionString: databaseUrl, max: 4 });
  await runMigrations(pool, { log: () => {} });
  app = await buildServer({ ...loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, API_AUTH_SIGNING_KEY: authSigningKey }), repositoryRoot: process.cwd(), stagingReadOnlyAuthHeaderName: "x-internal-token" });
  const membership = (await request("POST", "/api/mobile/research/candidate-memberships", { market: "HK", code: "00175", initialState: "tracked", idempotencyKey: randomUUID() }, 201)).data;
  const base = `/api/mobile/research/candidate-memberships/${membership.id}`;
  await request("POST", "/api/mobile/research/cloud-ai-policy/decisions", { action: "enable", policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION, backupProvider: "none", ownerConfirmed: true, idempotencyKey: randomUUID() });
  let previous = null;
  for (const source of sources) {
    await request("POST", "/api/mobile/research/profiles/HK/00175/materials", { membershipId: membership.id, membershipVersion: membership.version,
      title: source.title, contentText: source.summary, summary: source.summary, sourceType: "issuer_press_release_summary", sourceUrl: source.url,
      publishedAt: source.publishedAt, claimType: "issuer_statement", verificationStatus: "unverified", rightsStatus: "authorized_public",
      sourceVersion: source.publishedAt.slice(0, 10), replacesMaterialId: null, validUntil: new Date(Date.now() + 86400000).toISOString(),
      variableName: null, stance: "neutral", reliability: 4, materiality: 4, isRead: true, idempotencyKey: randomUUID() });
    const pack = (await request("POST", `${base}/evidence-packs`, { researchMode: "limited", membershipVersion: membership.version, idempotencyKey: randomUUID() })).data;
    const prior = previous ? { id: previous.id, version: previous.version, evidencePackId: previous.evidencePackId, reportFingerprint: previous.reportFingerprint } : null;
    const intent = defaultDeepResearchTaskIntent(pack, prior);
    intent.researchQuestion = previous
      ? "新增2026年8月资料相对上次研究改变了什么？分别核对单月与累计、销量与利润、2025全年与2026部分期间；解释影响哪个增长假设、为什么还不能形成价格判断，给出一个核实动作。"
      : "仅根据选定历史资料，说明吉利增长逻辑能支持什么、核心利润口径的限制、尚缺什么以及下一步核实动作。不得当作完整首次研究。";
    intent.providerAuthorization.ownerConfirmed = true;
    intent.providerAuthorization.confirmedIntentFingerprint = deepResearchProviderAuthorizationFingerprint(intent);
    const task = (await request("POST", `${base}/deep-research-tasks`, { membershipVersion: membership.version, evidencePackId: pack.id,
      evidencePackBinding: deepResearchPackBinding(pack), intent, reportContractVersion: "2026-08-05.deep-research-synthesis-report.v1", idempotencyKey: randomUUID() }, 202)).data;
    await runDeepResearchTaskOnce(pool, new Date(), { claim: claimDeepResearchTask, bindSnapshot: bindDeepResearchTaskSnapshot,
      assembleSnapshot: readCurrentDeepResearchSnapshot, synthesize: async (snapshot, config, _fetcher, prepared, authorization) => {
        try {
          return await generateDeepResearchSynthesisWithAi(snapshot, config, async (url, options) => {
            const response = await fetch(url, options);
            evidence.lastProviderResponse = await response.clone().json().catch(() => ({ status: response.status, bodyUnreadable: true }));
            return response;
          }, prepared, authorization);
        } catch (error) { evidence.providerFailure = { code: error.code, message: error.message }; throw error; }
      }, providerConfig,
      storeSynthesis: storeDeepResearchTaskSynthesis, fail: failDeepResearchTask });
    const ready = (await request("GET", `${base}/deep-research-tasks/${task.id}`)).data;
    evidence.runs.push({ task: ready });
    assert.equal(ready.status, "ready_to_absorb", `Live task failed: ${ready.errorCode}`);
    await request("POST", `${base}/deep-research-tasks/${task.id}/absorb`, { membershipVersion: membership.version,
      taskRequestFingerprint: ready.requestFingerprint, snapshotId: ready.snapshotBinding.snapshotId, idempotencyKey: randomUUID() });
    const workspace = (await request("GET", `${base}/deep-research`)).data;
    previous = workspace.latestReport;
    assert.equal(previous.currentness.status, "current");
    assert.equal(previous.status, "evidence_insufficient");
    assert.equal(previous.payload.adviceLayer.direction, "wait_for_evidence");
    assert.ok(deepResearchReportSummary(workspace));
    evidence.runs.at(-1).report = previous;
    console.log(JSON.stringify({ round: evidence.runs.length, status: previous.status, tokens: ready.synthesis.tokenUsage, cost: ready.synthesis.cost }));
  }
  evidence.completed = true;
} finally {
  await mkdir("artifacts/research-update-live", { recursive: true });
  const output = JSON.stringify(evidence, null, 2) + "\n";
  await writeFile(`artifacts/research-update-live/${evidence.checkedAt.replaceAll(":", "-")}.json`, output, { mode: 0o600 });
  await writeFile("artifacts/research-update-live/latest.json", output, { mode: 0o600 });
  await app?.close(); await pool?.end();
  try { postgres("dropdb", ["--if-exists", db]); } catch { console.error("Disposable database cleanup failed:", db); }
}
