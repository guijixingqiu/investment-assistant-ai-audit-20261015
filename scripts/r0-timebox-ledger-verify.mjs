import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const LEDGER_FIELDS = [
  "version",
  "event_id",
  "event_type",
  "stage_id",
  "issue_number",
  "invocation_id",
  "recorded_at_utc",
  "interval_started_at_utc",
  "interval_stopped_at_utc",
  "active_runner_seconds_delta",
  "cumulative_codex_running_seconds",
  "cumulative_active_runner_seconds",
  "previous_event_sha256",
  "event_sha256",
  "reason",
  "commit_sha",
];

const EVENT_TYPES = new Set([
  "GENESIS",
  "CODEX_RUNNING_STARTED",
  "CODEX_RUNNING_STOPPED",
  "MANUAL_RECOVERY",
  "RECOVERY_RESUMED",
  "OWNER_COORDINATED_RECOVERY_RESUMED",
]);
const STAGE_ID = "PRODUCT-RECOVERY-REBASELINE-1";
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const MAX_CODEX_RUNNING_SECONDS = 432000;
const MAX_ACTIVE_RUNNER_SECONDS = 144000;
const OWNER_RECOVERY_PREFIX_LINE_COUNT = 7;
const OWNER_RECOVERY_PREFIX_SHA256 = "628134927c4d3352dda0dc4e9e802d5536dc22e91d628de81ac95eb2a3699277";
const OWNER_RECOVERY_PREVIOUS_SHA256 = "fc53ffd359cef9e36c92906ca6ecbc07c809efa5cc66ab9a8799214a19a88298";
const OWNER_RECOVERY_PRE_HEAD = "f17d4184e136910387247eacfee12f838ee1e923";
const OWNER_RECOVERY_EDGE_HASHES = Object.freeze([
  "c1460df868d2e5702b92f4c990578689634fa20905f2d50b1a90fad4b32c5abd",
  "c892001247a442aeaf9665569f2e2aa7c4040d6cc9c86cfbda0671a1f1c553da",
  "532e268ca4a18371019360495856ae4424743efd99734e61ed33470455e01ed3",
  "17981c953f12f69099dabb933d13d961ef2ba70898767486d39d9b9f191ed862",
]);

function fail(reason, details = {}) {
  const error = new Error(reason);
  error.code = "R0_TIMEBOX_LEDGER_INVALID";
  error.details = details;
  throw error;
}

function secondsBetween(start, stop) {
  const startMs = Date.parse(start);
  const stopMs = Date.parse(stop);
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || stopMs < startMs) {
    fail("invalid_or_reversed_interval", { start, stop });
  }
  const delta = (stopMs - startMs) / 1000;
  if (!Number.isInteger(delta)) fail("interval_must_use_whole_seconds", { start, stop });
  return delta;
}

export function computeEventSha256(event) {
  const hashInput = {};
  for (const field of LEDGER_FIELDS) {
    if (field !== "event_sha256") hashInput[field] = event[field];
  }
  return createHash("sha256")
    .update(`${JSON.stringify(hashInput)}\n`, "utf8")
    .digest("hex");
}

function parseLedger(text) {
  if (!text.endsWith("\n")) fail("ledger_must_end_with_lf");
  if (text.includes("\r")) fail("ledger_must_use_lf_only");
  const lines = text.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    fail("ledger_must_contain_one_nonempty_json_object_per_line");
  }
  return lines.map((line, index) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      fail("invalid_json_line", { line: index + 1, message: error.message });
    }
    if (JSON.stringify(event) !== line) fail("ledger_line_must_be_canonical_json", { line: index + 1 });
    if (JSON.stringify(Object.keys(event)) !== JSON.stringify(LEDGER_FIELDS)) {
      fail("event_fields_or_key_order_invalid", { line: index + 1, keys: Object.keys(event) });
    }
    return event;
  });
}

function ownerRecoveryContext(text, events) {
  const indices = events
    .map((event, index) => event.event_type === "OWNER_COORDINATED_RECOVERY_RESUMED" ? index : -1)
    .filter((index) => index >= 0);
  if (indices.length === 0) return { authorized: false };
  if (indices.length !== 1 || indices[0] !== OWNER_RECOVERY_PREFIX_LINE_COUNT) {
    fail("owner_recovery_exception_position_or_count_invalid", { indices });
  }
  const prefix = `${text.slice(0, -1).split("\n").slice(0, OWNER_RECOVERY_PREFIX_LINE_COUNT).join("\n")}\n`;
  const prefixSha256 = createHash("sha256").update(prefix, "utf8").digest("hex");
  if (prefixSha256 !== OWNER_RECOVERY_PREFIX_SHA256) {
    fail("owner_recovery_exact_prefix_mismatch", { prefix_sha256: prefixSha256 });
  }
  const event = events[OWNER_RECOVERY_PREFIX_LINE_COUNT];
  const originalInvocation = events[0].invocation_id;
  if (
    event.stage_id !== STAGE_ID ||
    event.issue_number !== 157 ||
    event.previous_event_sha256 !== OWNER_RECOVERY_PREVIOUS_SHA256 ||
    event.commit_sha !== OWNER_RECOVERY_PRE_HEAD ||
    typeof event.invocation_id !== "string" ||
    event.invocation_id === originalInvocation ||
    !event.invocation_id.startsWith("r0-owner-recovery-") ||
    event.recorded_at_utc !== event.interval_started_at_utc ||
    event.interval_stopped_at_utc !== null ||
    event.active_runner_seconds_delta !== 0 ||
    event.cumulative_codex_running_seconds !== 992 ||
    event.cumulative_active_runner_seconds !== 992
  ) {
    fail("owner_recovery_exact_event_binding_invalid");
  }
  for (const required of [
    "Owner exact-prefix recovery authority",
    "Issue #157",
    "PR #158",
    "branch codex/product-recovery-rebaseline-1",
    OWNER_RECOVERY_PRE_HEAD,
    "review 4795543657",
    "Stage Runner lock evidence acquired",
    "HISTORICAL_AUDIT",
    ...OWNER_RECOVERY_EDGE_HASHES,
  ]) {
    if (!event.reason.includes(required)) {
      fail("owner_recovery_reason_binding_incomplete", { required });
    }
  }
  const expectedHistoricalHashes = [
    events[2]?.event_sha256,
    events[3]?.event_sha256,
    events[4]?.event_sha256,
    events[5]?.event_sha256,
    events[6]?.event_sha256,
  ];
  if (![
    OWNER_RECOVERY_EDGE_HASHES[0],
    OWNER_RECOVERY_EDGE_HASHES[1],
    OWNER_RECOVERY_EDGE_HASHES[2],
    OWNER_RECOVERY_EDGE_HASHES[3],
    OWNER_RECOVERY_PREVIOUS_SHA256,
  ].every((hash, index) => expectedHistoricalHashes[index] === hash)) {
    fail("owner_recovery_historical_event_identity_mismatch");
  }
  return {
    authorized: true,
    eventIndex: OWNER_RECOVERY_PREFIX_LINE_COUNT,
    invocationId: event.invocation_id,
  };
}

function isExactHistoricalInvalidStart(index, prior, event, ownerRecovery) {
  if (!ownerRecovery.authorized) return false;
  return (
    (index === 3 &&
      prior.event_sha256 === OWNER_RECOVERY_EDGE_HASHES[0] &&
      event.event_sha256 === OWNER_RECOVERY_EDGE_HASHES[1]) ||
    (index === 5 &&
      prior.event_sha256 === OWNER_RECOVERY_EDGE_HASHES[2] &&
      event.event_sha256 === OWNER_RECOVERY_EDGE_HASHES[3])
  );
}

function validatePostOwnerRecoveryContinuations(events, ownerRecovery) {
  if (!ownerRecovery.authorized) return;
  const ownerStopIndex = ownerRecovery.eventIndex + 1;
  const ownerStop = events[ownerStopIndex];
  if (
    !ownerStop ||
    ownerStop.event_type !== "CODEX_RUNNING_STOPPED" ||
    ownerStop.invocation_id !== ownerRecovery.invocationId
  ) {
    fail("owner_recovery_must_close_once");
  }

  const continuation = events.slice(ownerStopIndex + 1);
  if (continuation.length % 3 !== 0) {
    fail("post_owner_recovery_must_use_complete_triples", {
      continuation_event_count: continuation.length,
    });
  }
  const priorInvocations = new Set(
    events.slice(0, ownerStopIndex + 1).map(({ invocation_id }) => invocation_id)
  );
  for (let index = 0; index < continuation.length; index += 3) {
    const [manual, resumed, stopped] = continuation.slice(index, index + 3);
    const absoluteLine = ownerStopIndex + index + 2;
    if (
      manual.event_type !== "MANUAL_RECOVERY" ||
      resumed.event_type !== "RECOVERY_RESUMED" ||
      stopped.event_type !== "CODEX_RUNNING_STOPPED"
    ) {
      fail("post_owner_recovery_sequence_invalid", { line: absoluteLine });
    }
    if (
      manual.invocation_id !== resumed.invocation_id ||
      manual.invocation_id !== stopped.invocation_id ||
      priorInvocations.has(manual.invocation_id)
    ) {
      fail("post_owner_recovery_invocation_invalid", {
        line: absoluteLine,
        invocation_id: manual.invocation_id,
      });
    }
    priorInvocations.add(manual.invocation_id);
  }
}

export function verifyLedgerText(text, { previousText = null } = {}) {
  const events = parseLedger(text);
  const ownerRecovery = ownerRecoveryContext(text, events);
  validatePostOwnerRecoveryContinuations(events, ownerRecovery);
  if (previousText !== null) {
    const previousEvents = parseLedger(previousText);
    if (previousEvents.length > events.length) fail("ledger_history_shortened");
    for (let index = 0; index < previousEvents.length; index += 1) {
      if (JSON.stringify(previousEvents[index]) !== JSON.stringify(events[index])) {
        fail("ledger_is_not_first_parent_prefix_extension", { index });
      }
    }
  }

  const ids = new Set();
  let prior = null;
  let open = null;
  let lastRecorded = null;
  for (const [index, event] of events.entries()) {
    const line = index + 1;
    if (event.version !== 1) fail("version_must_equal_one", { line });
    if (!EVENT_TYPES.has(event.event_type)) fail("unsupported_event_type", { line });
    if (event.stage_id !== STAGE_ID || event.issue_number !== 157) fail("stage_or_issue_mismatch", { line });
    if (typeof event.event_id !== "string" || event.event_id.length === 0 || ids.has(event.event_id)) {
      fail("event_id_missing_or_duplicate", { line });
    }
    ids.add(event.event_id);
    if (typeof event.invocation_id !== "string" || event.invocation_id.length === 0) fail("invocation_id_missing", { line });
    if (!UTC_SECONDS.test(event.recorded_at_utc) || (lastRecorded && event.recorded_at_utc < lastRecorded)) {
      fail("recorded_time_invalid_or_regressed", { line });
    }
    lastRecorded = event.recorded_at_utc;
    for (const field of [
      "active_runner_seconds_delta",
      "cumulative_codex_running_seconds",
      "cumulative_active_runner_seconds",
    ]) {
      if (!Number.isInteger(event[field]) || event[field] < 0) fail("seconds_must_be_nonnegative_integers", { line, field });
    }
    if (!SHA256.test(event.previous_event_sha256) || !SHA256.test(event.event_sha256)) fail("sha256_format_invalid", { line });
    if (!SHA1.test(event.commit_sha)) fail("commit_sha_invalid", { line });
    if (typeof event.reason !== "string" || event.reason.trim().length === 0) fail("reason_missing", { line });
    if (computeEventSha256(event) !== event.event_sha256) fail("event_hash_mismatch", { line });
    if (prior && event.previous_event_sha256 !== prior.event_sha256) fail("hash_chain_broken", { line });

    if (index === 0) {
      if (event.event_type !== "GENESIS") fail("first_event_must_be_genesis");
      if (event.previous_event_sha256 !== "0".repeat(64)) fail("genesis_previous_hash_invalid");
      if (
        event.interval_started_at_utc !== null ||
        event.interval_stopped_at_utc !== null ||
        event.active_runner_seconds_delta !== 0 ||
        event.cumulative_codex_running_seconds !== 0 ||
        event.cumulative_active_runner_seconds !== 0
      ) fail("genesis_values_invalid");
    } else if (event.event_type === "GENESIS") {
      fail("genesis_must_be_unique_and_first", { line });
    } else {
      const expectedWallBefore = prior.cumulative_codex_running_seconds;
      const expectedActiveBefore = prior.cumulative_active_runner_seconds;
      if (
        event.event_type === "CODEX_RUNNING_STARTED" ||
        event.event_type === "RECOVERY_RESUMED" ||
        event.event_type === "OWNER_COORDINATED_RECOVERY_RESUMED"
      ) {
        if (open) fail("multiple_open_intervals", { line });
        if (
          event.interval_started_at_utc !== event.recorded_at_utc ||
          event.interval_stopped_at_utc !== null ||
          event.active_runner_seconds_delta !== 0 ||
          event.cumulative_codex_running_seconds !== expectedWallBefore ||
          event.cumulative_active_runner_seconds !== expectedActiveBefore
        ) fail("start_or_resume_values_invalid", { line });
        if (event.event_type === "CODEX_RUNNING_STARTED") {
          if (
            prior.event_type !== "GENESIS" &&
            !isExactHistoricalInvalidStart(index, prior, event, ownerRecovery)
          ) {
            fail("plain_started_after_stopped_forbidden", { line });
          }
        } else if (event.event_type === "RECOVERY_RESUMED") {
          if (prior.event_type !== "MANUAL_RECOVERY" || prior.invocation_id !== event.invocation_id) {
            fail("recovery_resume_pair_invalid", { line });
          }
        } else if (
          !ownerRecovery.authorized ||
          index !== ownerRecovery.eventIndex ||
          event.invocation_id !== ownerRecovery.invocationId
        ) {
          fail("owner_recovery_exception_not_exact", { line });
        }
        open = event;
      } else if (event.event_type === "CODEX_RUNNING_STOPPED") {
        if (!open || open.invocation_id !== event.invocation_id) {
          fail("stopped_without_matching_open_interval", { line });
        }
        if (event.interval_started_at_utc !== open.interval_started_at_utc || !UTC_SECONDS.test(event.interval_stopped_at_utc)) {
          fail("stopped_interval_identity_invalid", { line });
        }
        if (Date.parse(event.interval_stopped_at_utc) > Date.parse(event.recorded_at_utc)) {
          fail("stopped_time_after_recorded_time", { line });
        }
        const delta = secondsBetween(event.interval_started_at_utc, event.interval_stopped_at_utc);
        if (
          event.active_runner_seconds_delta !== delta ||
          event.cumulative_codex_running_seconds !== expectedWallBefore + delta ||
          event.cumulative_active_runner_seconds !== expectedActiveBefore + delta
        ) fail("stopped_delta_or_cumulative_invalid", { line, delta });
        open = null;
      } else if (event.event_type === "MANUAL_RECOVERY") {
        if (!open && prior.event_type !== "CODEX_RUNNING_STOPPED") fail("manual_recovery_without_recoverable_boundary", { line });
        if (!/failure/i.test(event.reason) || !/lock/i.test(event.reason) || !/authori[sz]ation/i.test(event.reason) || !/event/i.test(event.reason)) {
          fail("manual_recovery_evidence_incomplete", { line });
        }
        const expectedStart = open ? open.interval_started_at_utc : prior.interval_stopped_at_utc;
        if (event.interval_started_at_utc !== expectedStart || !UTC_SECONDS.test(event.interval_stopped_at_utc)) {
          fail("manual_recovery_interval_invalid", { line });
        }
        const delta = secondsBetween(expectedStart, event.interval_stopped_at_utc);
        if (
          event.active_runner_seconds_delta !== delta ||
          event.cumulative_codex_running_seconds !== expectedWallBefore + delta ||
          event.cumulative_active_runner_seconds !== expectedActiveBefore + delta
        ) fail("manual_recovery_delta_or_cumulative_invalid", { line, delta });
        open = null;
      }
    }
    if (event.cumulative_codex_running_seconds >= MAX_CODEX_RUNNING_SECONDS) fail("codex_running_budget_expired", { line });
    if (event.cumulative_active_runner_seconds >= MAX_ACTIVE_RUNNER_SECONDS) fail("active_runner_budget_expired", { line });
    prior = event;
  }
  if (open) fail("final_open_interval", { event_id: open.event_id });
  return {
    ok: true,
    event_count: events.length,
    open_interval: null,
    cumulative_codex_running_seconds: prior.cumulative_codex_running_seconds,
    cumulative_active_runner_seconds: prior.cumulative_active_runner_seconds,
    final_event_sha256: prior.event_sha256,
  };
}

function readFirstParentVersion(path) {
  const result = spawnSync("git", ["show", `HEAD^:${path}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function main() {
  const path = process.argv[2];
  if (!path) fail("ledger_path_required");
  const result = verifyLedgerText(readFileSync(path, "utf8"), {
    previousText: readFirstParentVersion(path),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code, reason: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exit(1);
  }
}
