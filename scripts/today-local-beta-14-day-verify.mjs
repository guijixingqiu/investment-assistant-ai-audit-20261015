#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../dist/packages/contracts/src/decisionContextBrowser.js";
import { DEEP_RESEARCH_OBJECTIVE_CHECK_IDS } from "../dist/packages/contracts/src/todayResearchQualityValidation.js";
import {
  TODAY_RESEARCH_SCHEMA_VERSION,
  todayResearchSafety,
  validateTodayResearchEnvelope
} from "../dist/packages/contracts/src/todayResearch.js";

const INPUT_SCHEMA = "2026-07-25.local-beta-14-day-replay.v1";
const RESULT_SCHEMA = "2026-07-25.local-beta-14-day-result.v1";
const TEMPLATE_PATH = "config/research-monitors/com.annualrings.local-beta-daily.plist.template";

export function evaluateFourteenDayReplay(input) {
  exact(input, ["schemaVersion", "replayId", "classification", "days"], "replay");
  if (input.schemaVersion !== INPUT_SCHEMA || input.classification !== "repository_local_replay_fixture") {
    throw new Error("replay identity or classification is invalid");
  }
  if (typeof input.replayId !== "string" || !/^[A-Za-z0-9._:-]{1,180}$/.test(input.replayId)
    || !Array.isArray(input.days) || input.days.length !== 14) throw new Error("replay must contain exactly fourteen identified days");
  const seenAlerts = new Set();
  const alerts = [];
  let previousStatus = null;
  let duplicateAlertsSuppressed = 0;
  let lowPriorityItemsSuppressed = 0;
  let sourceFailureDays = 0;
  for (const [index, day] of input.days.entries()) {
    exact(day, ["date", "envelope"], `days[${index}]`);
    const expected = new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10);
    if (day.date !== expected || day.envelope.generatedAt.slice(0, 10) !== day.date) {
      throw new Error(`days[${index}] is not the expected consecutive replay date`);
    }
    const validation = validateTodayResearchEnvelope(day.envelope);
    if (!validation.ok) throw new Error(`days[${index}] Today envelope is invalid: ${validation.errors.join("; ")}`);
    if (day.envelope.metadata.fixture !== (day.envelope.status === "available"
      || day.envelope.status === "stale" || day.envelope.status === "conflict")) {
      throw new Error(`days[${index}] does not preserve replay-fixture provenance`);
    }
    lowPriorityItemsSuppressed += day.envelope.omittedItemCount;
    if (day.envelope.status === "available") {
      if (previousStatus && previousStatus !== "available") {
        addAlert(alerts, seenAlerts, {
          key: `recovery:${day.envelope.membershipId}:${day.envelope.quality.sourceHealth.id}`,
          kind: "source_recovery",
          date: day.date
        }, () => { duplicateAlertsSuppressed += 1; });
      }
      for (const item of day.envelope.items) {
        addAlert(alerts, seenAlerts, {
          key: `item:${sha256(canonicalJson(item))}`,
          kind: item.category,
          date: day.date
        }, () => { duplicateAlertsSuppressed += 1; });
      }
    } else {
      sourceFailureDays += 1;
      addAlert(alerts, seenAlerts, {
        key: `source:${day.envelope.status}:${day.envelope.quality?.sourceHealth.id ?? day.envelope.message}`,
        kind: "source_failure",
        date: day.date
      }, () => { duplicateAlertsSuppressed += 1; });
    }
    previousStatus = day.envelope.status;
  }
  const core = {
    schemaVersion: RESULT_SCHEMA,
    replayId: input.replayId,
    classification: input.classification,
    inputFingerprint: sha256(canonicalJson(input)),
    dayCount: input.days.length,
    deliveredAlerts: alerts.length,
    actionableItemAlerts: alerts.filter((item) =>
      ["user_action", "holding_logic_change", "research_change"].includes(item.kind)).length,
    userActionAlerts: alerts.filter((item) => item.kind === "user_action").length,
    holdingLogicAlerts: alerts.filter((item) => item.kind === "holding_logic_change").length,
    researchChangeAlerts: alerts.filter((item) => item.kind === "research_change").length,
    sourceFailureAlerts: alerts.filter((item) => item.kind === "source_failure").length,
    sourceRecoveryAlerts: alerts.filter((item) => item.kind === "source_recovery").length,
    sourceFailureDays,
    duplicateAlertsSuppressed,
    lowPriorityItemsSuppressed,
    noiseAlerts: alerts.filter((item) => ![
      "user_action", "holding_logic_change", "research_change", "source_failure", "source_recovery"
    ].includes(item.kind)).length,
    alerts,
    safety: {
      replayFixtureOnly: true,
      currentHoldingTruth: false,
      advisoryOnly: true,
      callsBroker: false,
      createsOrder: false,
      createsTrade: false,
      mutatesCashFeesPositions: false,
      productionWrite: false
    }
  };
  return { ...core, resultFingerprint: sha256(canonicalJson(core)) };
}

export function buildFourteenDayReplayFixture() {
  const days = [];
  const add = (day, envelope) => days.push({ date: `2026-07-${String(day).padStart(2, "0")}`, envelope });
  add(1, available(1, "1", "HK.00175", missingQuality("1"), [actionItem("1", "needs_material")]));
  add(2, available(2, "1", "HK.00175", missingQuality("1"), [actionItem("1", "needs_material")]));
  add(3, available(3, "1", "HK.00175", revisionQuality("1"), [actionItem("1", "needs_evidence_pack", fact("11", "21"))]));
  add(4, available(4, "1", "HK.00175", revisionQuality("1"), [actionItem("1", "needs_evidence_pack", fact("11", "21"))]));
  add(5, available(5, "1", "HK.00175", healthyQuality("geely-v1", "1"), [monitorItem("geely_sales", "31", 1, "1", "HK.00175")]));
  add(6, available(6, "1", "HK.00175", healthyQuality("geely-v1", "1"), [monitorItem("geely_sales", "31", 1, "1", "HK.00175")]));
  add(7, available(7, "2", "HK.03800", healthyQuality("gcl-v1", "2"), [monitorItem("gcl_pv_price", "41", 1, "2", "HK.03800")]));
  add(8, failed(8, "2", "HK.03800", "stale", "stale_materials", "source-stale-gcl", "PV source is stale."));
  add(9, failed(9, "2", "HK.03800", "stale", "stale_materials", "source-stale-gcl", "PV source is stale."));
  add(10, unavailable(10, "2", "Local source collection is unavailable."));
  add(11, unavailable(11, "2", "Local source collection is unavailable."));
  add(12, available(12, "2", "HK.03800", healthyQuality("holding-recovery", "2"), [holdingEventItem("2", "HK.03800")]));
  add(13, available(13, "1", "HK.00175", healthyQuality("geely-v2", "1"), [monitorItem("geely_sales", "31", 2, "1", "HK.00175")], 3));
  add(14, failed(14, "1", "HK.00175", "conflict", "conflicting_materials", "source-conflict-geely", "Geely sources conflict."));
  return {
    schemaVersion: INPUT_SCHEMA,
    replayId: "holding-evidence-research-beta-v1-july-rehearsal",
    classification: "repository_local_replay_fixture",
    days
  };
}

export function validateLaunchdTemplate(template) {
  for (const token of [
    "com.annualrings.local-beta-daily",
    "today-local-beta-daily-ingest",
    "LOCAL_BETA_API_TOKEN_FILE",
    "http://127.0.0.1:4010",
    "StartCalendarInterval",
    "ThrottleInterval",
    "__REPOSITORY_ROOT__",
    "__MANIFEST_PATH__",
    "__TOKEN_FILE_PATH__",
    "__LOG_DIRECTORY__"
  ]) if (!template.includes(token)) throw new Error(`launchd template is missing ${token}`);
  if (/LOCAL_BETA_API_TOKEN<\/key>/.test(template) || /launchctl|bootstrap|KeepAlive/.test(template)) {
    throw new Error("launchd template must not persist a token, self-install, or keep a process alive");
  }
  return sha256(template);
}

function available(day, membershipId, symbol, quality, items, omittedItemCount = 0) {
  return envelope(day, "available", membershipId, symbol, quality, items, omittedItemCount, "Only material research changes and user actions are shown.");
}
function failed(day, membershipId, symbol, status, issue, sourceIdentity, message) {
  return envelope(day, status, membershipId, symbol, quality(sourceIdentity, membershipId, status, [issue], 1), [], 0, message);
}
function unavailable(day, membershipId, message) {
  return envelope(day, "unavailable", membershipId, null, null, [], 0, message);
}
function envelope(day, status, membershipId, symbol, qualityValue, items, omittedItemCount, message) {
  const generatedAt = `2026-07-${String(day).padStart(2, "0")}T08:00:00.000Z`;
  const sourceBound = ["available", "stale", "conflict"].includes(status);
  return {
    schemaVersion: TODAY_RESEARCH_SCHEMA_VERSION,
    generatedAt,
    status,
    membershipId,
    membershipVersion: sourceBound ? 1 : null,
    requestedActorId: "local-beta-replay-fixture",
    requestedSymbol: sourceBound ? symbol : null,
    metadata: {
      source: "local_beta_14_day_replay",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: status === "available" ? "fresh" : status,
      provenance: sourceBound ? "fixture" : "unavailable",
      authority: sourceBound ? "research_evidence" : "unavailable",
      stale: status === "stale",
      missing: false,
      conflict: status === "conflict",
      fixture: sourceBound,
      correctionOf: null,
      replaces: null,
      message
    },
    quality: qualityValue,
    items: items.map((item, index) => ({ ...item, order: index + 1 })),
    omittedItemCount,
    message,
    safety: todayResearchSafety()
  };
}

function missingQuality(membershipId) { return quality(`missing-${membershipId}`, membershipId, "missing", ["missing_materials"], 0); }
function revisionQuality(membershipId) { return quality(`revision-${membershipId}`, membershipId, "revision_mismatch", ["unfrozen_revision"], 1); }
function healthyQuality(identity, membershipId) { return quality(identity, membershipId, "healthy", [], 1); }
function quality(identity, membershipId, status, issueCodes, materialCount) {
  return {
    sourceHealth: {
      id: sha256(`source:${identity}`),
      status,
      issueCodes,
      totalMaterialCount: materialCount,
      currentMaterialCount: materialCount,
      evidencePackRef: null
    },
    researchStructure: {
      id: sha256(`structure:${membershipId}:not-started`),
      status: "not_started",
      checks: DEEP_RESEARCH_OBJECTIVE_CHECK_IDS.map((id) => ({ id, passed: false })),
      gateFailures: [],
      reportRef: null
    },
    secondOpinion: {
      status: "not_evaluated",
      dependencyIncluded: false,
      reason: "No authorized real-sample blinded evaluation has demonstrated stable added value."
    }
  };
}

function actionItem(membershipId, state, sourceFact = null) {
  return item({
    id: `action:${membershipId}:v1:${state}`,
    category: "user_action",
    priority: "action",
    trackingState: state,
    membershipId,
    symbol: "HK.00175",
    title: state === "needs_material" ? "Add traceable research material" : "Freeze the current evidence version",
    factRefs: sourceFact ? [sourceFact] : []
  });
}
function monitorItem(kind, id, runVersion, membershipId, symbol) {
  const holding = kind === "gcl_pv_price";
  return item({
    id: `${kind}:${id}:v${runVersion}`,
    category: holding ? "holding_logic_change" : "research_change",
    priority: holding ? "high" : "medium",
    trackingState: "needs_review",
    membershipId,
    symbol,
    title: holding ? "GCL photovoltaic value-chain change" : "Geely new-energy sales change",
    factRefs: [fact(holding ? "12" : "11", holding ? "22" : "21")],
    eventRefs: [eventRef(holding ? "42" : "32", holding)],
    monitorRef: { kind, id, runVersion, runFingerprint: sha256(`${kind}:${id}:${runVersion}`) },
    holdingSnapshotRefs: holding ? [holdingRef()] : []
  });
}
function holdingEventItem(membershipId, symbol) {
  return item({
    id: "event:52:v1",
    category: "holding_logic_change",
    priority: "high",
    trackingState: "needs_review",
    membershipId,
    symbol,
    title: "Holding announcement changed a key variable",
    factRefs: [fact("13", "23")],
    eventRefs: [eventRef("52", true)],
    holdingSnapshotRefs: [holdingRef()]
  });
}
function item({
  id, category, priority, trackingState, membershipId, symbol, title,
  factRefs = [], eventRefs = [], monitorRef = null, holdingSnapshotRefs = []
}) {
  return {
    id,
    order: 0,
    category,
    priority,
    trackingState,
    symbol,
    title,
    summary: "Repository-local replay fixture; never current portfolio truth.",
    thesis: null,
    invalidationConditions: [],
    nextCheckpoint: "Review the exact source-bound version.",
    versionChange: null,
    bindings: {
      membershipId,
      membershipVersion: 1,
      factRefs,
      eventRefs,
      monitorRef,
      evidencePackRef: null,
      reportRef: null,
      decisionRef: null,
      holdingSnapshotRefs
    }
  };
}
function fact(materialId, evidenceId) {
  return {
    materialId,
    evidenceId,
    sourceType: "authorized_replay_fixture",
    sourceVersion: "replay-v1",
    revision: 1,
    contentFingerprint: sha256(`material:${materialId}`),
    publishedAt: "2026-06-30T08:00:00.000Z",
    capturedAt: "2026-06-30T08:05:00.000Z",
    validUntil: "2026-08-01T08:00:00.000Z",
    verificationStatus: "verified",
    rightsStatus: "user_provided"
  };
}
function eventRef(eventId, holding) {
  return {
    eventId,
    eventVersion: 1,
    eventFingerprint: sha256(`event:${eventId}`),
    coverageScope: holding ? "current_holding" : "research_stock",
    keyVariable: holding ? "photovoltaic value chain" : "new-energy sales",
    hypothesisImpact: "weakens",
    monitorRuleBinding: null
  };
}
function holdingRef() {
  return {
    accountScopeId: "replay-fixture-account",
    snapshotId: "replay-fixture-snapshot",
    sourceBatchId: "fixture-batch",
    sourceAsOf: "2026-06-30T08:00:00.000Z",
    positionSourceRowId: "broker_import_batches:fixture-batch/replay-row"
  };
}

function addAlert(alerts, seen, alert, duplicate) {
  if (seen.has(alert.key)) duplicate();
  else { seen.add(alert.key); alerts.push(alert); }
}
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} fields are invalid`);
  }
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function main() {
  const input = buildFourteenDayReplayFixture();
  const first = evaluateFourteenDayReplay(input);
  const replay = evaluateFourteenDayReplay(structuredClone(input));
  assert.deepEqual(replay, first);
  assert.deepEqual({
    dayCount: first.dayCount,
    deliveredAlerts: first.deliveredAlerts,
    actionableItemAlerts: first.actionableItemAlerts,
    userActionAlerts: first.userActionAlerts,
    holdingLogicAlerts: first.holdingLogicAlerts,
    researchChangeAlerts: first.researchChangeAlerts,
    sourceFailureAlerts: first.sourceFailureAlerts,
    sourceRecoveryAlerts: first.sourceRecoveryAlerts,
    sourceFailureDays: first.sourceFailureDays,
    duplicateAlertsSuppressed: first.duplicateAlertsSuppressed,
    lowPriorityItemsSuppressed: first.lowPriorityItemsSuppressed,
    noiseAlerts: first.noiseAlerts
  }, {
    dayCount: 14,
    deliveredAlerts: 10,
    actionableItemAlerts: 6,
    userActionAlerts: 2,
    holdingLogicAlerts: 2,
    researchChangeAlerts: 2,
    sourceFailureAlerts: 3,
    sourceRecoveryAlerts: 1,
    sourceFailureDays: 5,
    duplicateAlertsSuppressed: 5,
    lowPriorityItemsSuppressed: 3,
    noiseAlerts: 0
  });
  const template = await readFile(resolve(TEMPLATE_PATH), "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    replay: first,
    scheduler: {
      template: TEMPLATE_PATH,
      templateFingerprint: validateLaunchdTemplate(template),
      installed: false,
      installationRequiresExplicitLocalActivation: true
    }
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
