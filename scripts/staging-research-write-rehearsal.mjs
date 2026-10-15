#!/usr/bin/env node
import { Client } from "pg";

const baseUrl = process.env.STAGING_WRITE_BASE_URL ?? "http://127.0.0.1:4510";
const symbol = process.env.STAGING_WRITE_SYMBOL ?? "HK.09926";
const token = process.env.STAGING_WRITE_TOKEN ?? process.env.WRITE_API_TOKEN ?? "";
const authHeaderName = process.env.STAGING_WRITE_AUTH_HEADER ?? "x-internal-token";
const runId = process.env.STAGING_WRITE_RUN_ID ?? `staging-write-${Date.now()}`;
const databaseUrl = process.env.STAGING_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const decisionCheckIdempotencyKey = `${runId}-decision-check`;
const mockResponses = parseMockArray("STAGING_RESEARCH_WRITE_REHEARSAL_MOCK_RESPONSES");
const mockCounts = parseMockArray("STAGING_RESEARCH_WRITE_REHEARSAL_MOCK_COUNTS");
const capturedRequests = [];

if (!token) {
  console.error("未验证: STAGING_WRITE_TOKEN or WRITE_API_TOKEN is required for authorized staging write rehearsal.");
  process.exit(2);
}

const [market, code] = parseSymbol(symbol);
const beforeCounts = databaseUrl || mockCounts
  ? await readCounts(databaseUrl, runId, decisionCheckIdempotencyKey)
  : null;

const health = await requestJson("GET", "/health");
const profileBefore = await requestJson("GET", `/api/mobile/research/profiles/${market}/${code}`);
const unauthorized = await requestJson("PUT", `/api/mobile/research/profiles/${market}/${code}`, profileBody(`${runId}-unauthorized`), {
  expectedStatus: 401,
  auth: false
});

const profileWrite = await requestJson("PUT", `/api/mobile/research/profiles/${market}/${code}`, profileBody(`${runId}-profile`), {
  auth: true
});
const evidenceWrite = await requestJson("POST", `/api/mobile/research/profiles/${market}/${code}/evidence`, {
  sourceType: "company_disclosure",
  sourceUrl: "https://example.invalid/staging-rehearsal",
  summary: `staging 授权写入演练证据 ${runId}`,
  factKind: "fact",
  stance: "support",
  variableName: "commercialization",
  reliability: 4,
  isRead: true,
  idempotencyKey: `${runId}-evidence`
}, { auth: true });
const decisionContext = await requestJson("GET", `/api/mobile/research/decision-context/${market}/${code}`, null, { auth: true });
const decisionWrite = await requestJson("POST", `/api/mobile/research/profiles/${market}/${code}/decision-checks`, {
  decisionContextSchemaVersion: decisionContext.body?.schemaVersion,
  contextId: decisionContext.body?.contextId,
  contextHash: decisionContext.body?.contextHash,
  actionIntent: "watch",
  humanCheckResult: "needs_more_evidence",
  userFinalDecision: "staging 授权写入演练：继续观察，不创建交易。",
  idempotencyKey: decisionCheckIdempotencyKey
}, { auth: true });
const profileRepeat = await requestJson("PUT", `/api/mobile/research/profiles/${market}/${code}`, {
  ...profileBody(`${runId}-profile`),
  currentView: "重复请求不应覆盖幂等结果。",
  currentThesis: "重复请求不应覆盖幂等结果。"
}, { auth: true });
const profileAfter = await requestJson("GET", `/api/mobile/research/profiles/${market}/${code}`);
const afterCounts = databaseUrl || mockCounts
  ? await readCounts(databaseUrl, runId, decisionCheckIdempotencyKey)
  : null;
const decisionRequest = capturedRequests.find((request) => request.path.endsWith("/decision-checks"));
const countChecks = beforeCounts && afterCounts
  ? {
      totalAuditDelta: afterCounts.auditCount - beforeCounts.auditCount,
      runProfileAuditDelta: afterCounts.runProfileAuditCount - beforeCounts.runProfileAuditCount,
      runEvidenceAuditDelta: afterCounts.runEvidenceAuditCount - beforeCounts.runEvidenceAuditCount,
      decisionCheckAuditDelta: afterCounts.decisionCheckAuditCount - beforeCounts.decisionCheckAuditCount,
      decisionCheckRowDelta: afterCounts.decisionCheckCount - beforeCounts.decisionCheckCount,
      portfolioPositionDelta: afterCounts.portfolioPositionCount - beforeCounts.portfolioPositionCount
    }
  : null;
const decisionSafety = decisionWrite.body?.data?.safety;

const ok = Boolean(health.status === 200
  && health.body?.ok === true
  && profileBefore.status === 200
  && unauthorized.status === 401
  && profileWrite.status === 200
  && evidenceWrite.status === 200
  && decisionContext.status === 200
  && decisionWrite.status === 200
  && profileRepeat.status === 200
  && profileRepeat.body?.message === "Idempotent write already recorded."
  && profileAfter.body?.data?.profile?.currentThesis === `staging 授权写入演练假设 ${runId}`
  && decisionRequest
  && !Object.hasOwn(decisionRequest.body, "actorType")
  && !Object.hasOwn(decisionRequest.body, "correlationId")
  && (!countChecks || (
    countChecks.runProfileAuditDelta === 1
    && countChecks.runEvidenceAuditDelta === 1
    && countChecks.decisionCheckAuditDelta === 1
    && countChecks.decisionCheckRowDelta === 1
    && countChecks.portfolioPositionDelta === 0
    && afterCounts.decisionCheckActorType === "system"
    && typeof afterCounts.decisionCheckActorId === "string"
    && afterCounts.decisionCheckActorId.length > 0
    && afterCounts.decisionCheckCorrelationId === null
  ))
  && decisionSafety
  && (
    decisionSafety.createsOrder === false
    && decisionSafety.createsTrade === false
    && decisionSafety.mutatesCash === false
    && decisionSafety.writesFee === false
    && decisionSafety.mutatesPosition === false
    && decisionSafety.callsBroker === false
  ));

console.log(JSON.stringify({
  ok,
  baseUrl,
  symbol,
  runId,
  auth: {
    headerName: authHeaderName,
    tokenProvided: token.length > 0,
    tokenPrinted: false
  },
  checks: {
    health: summarize(health),
    profileReadBefore: summarize(profileBefore),
    unauthorizedWrite: summarize(unauthorized),
    profileWrite: summarize(profileWrite),
    evidenceWrite: summarize(evidenceWrite),
    decisionContext: summarize(decisionContext),
    decisionWrite: summarize(decisionWrite),
    profileRepeat: summarize(profileRepeat),
    profileReadAfter: summarize(profileAfter)
  },
  counts: {
    before: beforeCounts,
    after: afterCounts,
    deltas: countChecks
  },
  decisionCheckRequest: {
    idempotencyKey: decisionCheckIdempotencyKey,
    keys: decisionRequest ? Object.keys(decisionRequest.body).sort() : [],
    clientActorTypeAbsent: decisionRequest ? !Object.hasOwn(decisionRequest.body, "actorType") : false,
    clientCorrelationIdAbsent: decisionRequest ? !Object.hasOwn(decisionRequest.body, "correlationId") : false
  },
  notes: [
    "This rehearsal writes only the configured candidate/staging API and database.",
    "It must not be pointed at the legacy production /api endpoint.",
    "The token value is never printed.",
    "Decision checks do not create orders, true trades, cash movements, fee writes, broker calls, or true positions."
  ]
}, null, 2));

if (!ok) {
  process.exit(1);
}

function profileBody(idempotencyKey) {
  return {
    currentView: `staging 授权写入演练观点 ${runId}`,
    currentThesis: `staging 授权写入演练假设 ${runId}`,
    marketDisagreement: "staging 演练：竞争和商业化节奏仍需跟踪。",
    invalidationCondition: "staging 演练：销售失速或关键证据反转。",
    nextReviewOn: "2026-07-18",
    idempotencyKey
  };
}

async function requestJson(method, path, body = null, options = {}) {
  const expectedStatus = options.expectedStatus ?? 200;
  capturedRequests.push({ method, path, body });
  if (mockResponses) {
    const mocked = mockResponses.shift();
    if (!mocked) throw new Error(`missing mock response for ${method} ${path}`);
    if (mocked.status !== expectedStatus) {
      throw new Error(`${method} ${path} returned mock ${mocked.status}, expected ${expectedStatus}`);
    }
    return mocked;
  }
  const response = await fetch(buildUrl(path), {
    method,
    headers: {
      accept: "application/json",
      ...(options.auth ? { [authHeaderName]: token } : {}),
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000)
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path} returned ${response.status}, expected ${expectedStatus}: ${text.slice(0, 200)}`);
  }
  return {
    status: response.status,
    body: parsed
  };
}

async function readCounts(connectionString, correlationId, decisionIdempotencyKey) {
  if (mockCounts) {
    const mocked = mockCounts.shift();
    if (!mocked) throw new Error("missing mock database counts");
    return mocked;
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`
      select
        (select count(*)::int from research_write_audit_events) as audit_count,
        (select count(*)::int from research_write_audit_events
          where correlation_id = $1 and event_type = 'profile_updated'
            and idempotency_key = $2) as run_profile_audit_count,
        (select count(*)::int from research_write_audit_events
          where correlation_id = $1 and event_type = 'evidence_created'
            and idempotency_key = $3) as run_evidence_audit_count,
        (select count(*)::int from research_write_audit_events
          where event_type = 'decision_check_created'
            and idempotency_key = $4) as decision_check_audit_count,
        (select actor_type from research_write_audit_events
          where event_type = 'decision_check_created'
            and idempotency_key = $4 limit 1) as decision_check_actor_type,
        (select actor_id from research_write_audit_events
          where event_type = 'decision_check_created'
            and idempotency_key = $4 limit 1) as decision_check_actor_id,
        (select correlation_id from research_write_audit_events
          where event_type = 'decision_check_created'
            and idempotency_key = $4 limit 1) as decision_check_correlation_id,
        (select count(*)::int from pre_trade_decision_checks
          where legacy_id = $5) as decision_check_count,
        (select count(*)::int from portfolio_positions) as portfolio_position_count
    `, [
      correlationId,
      `${correlationId}-profile`,
      `${correlationId}-evidence`,
      decisionIdempotencyKey,
      `candidate:${decisionIdempotencyKey}`
    ]);
    return {
      auditCount: result.rows[0].audit_count,
      runProfileAuditCount: result.rows[0].run_profile_audit_count,
      runEvidenceAuditCount: result.rows[0].run_evidence_audit_count,
      decisionCheckAuditCount: result.rows[0].decision_check_audit_count,
      decisionCheckActorType: result.rows[0].decision_check_actor_type,
      decisionCheckActorId: result.rows[0].decision_check_actor_id,
      decisionCheckCorrelationId: result.rows[0].decision_check_correlation_id,
      decisionCheckCount: result.rows[0].decision_check_count,
      portfolioPositionCount: result.rows[0].portfolio_position_count
    };
  } finally {
    await client.end();
  }
}

function summarize(result) {
  return {
    status: result.status,
    ok: result.body?.ok ?? result.body?.status ?? null,
    message: result.body?.message ?? null
  };
}

function parseSymbol(value) {
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`symbol must look like HK.09926, got ${value}`);
  }
  return parts;
}

function buildUrl(path) {
  return new URL(path.replace(/^\/+/, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function parseMockArray(name) {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed;
}
