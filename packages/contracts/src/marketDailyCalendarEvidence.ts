import { areInstantsChronologicallyOrdered } from "./chronology.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { isRfc3339DateTime } from "./factMetadata.js";
import { sha256Hex } from "./sha256.js";

export interface HkexCompletedSessionEvidence {
  source: "independent_hkex_calendar";
  fixture: false;
  calendar: { id: "HKEX"; version: string; timezone: "Asia/Hong_Kong" };
  cutoff: string;
  lastCompletedSession: string;
  marketCloseAt: string;
  evaluatedAt: string;
  completedThroughCutoff: true;
  completedSessions: string[];
}

export function hkexCompletedSessionEvidenceVersion(cutoff: string, completedSessions: string[]): string {
  const sessionsHash = sha256Hex(canonicalJson(completedSessions));
  return `hkex_completed_sessions_v1:${cutoff}:${sessionsHash}`;
}

export function validateCompletedSessionEvidence(
  evidence: unknown,
  snapshot: Record<string, unknown>,
  request: Record<string, unknown>,
  source: Record<string, unknown>,
  errors: string[]
): void {
  if (evidence === null) return;
  if (!record(evidence)) { errors.push("completed-session evidence is invalid"); return; }
  const calendar = record(evidence.calendar) ? evidence.calendar : {};
  const snapshotCalendar = record(snapshot.calendar) ? snapshot.calendar : {};
  const expectedVersion = Array.isArray(evidence.completedSessions)
    ? hkexCompletedSessionEvidenceVersion(String(evidence.cutoff), evidence.completedSessions.map(String))
    : "";
  if (evidence.source !== "independent_hkex_calendar" || evidence.fixture !== false
    || calendar.id !== "HKEX" || calendar.timezone !== "Asia/Hong_Kong"
    || calendar.version !== expectedVersion || canonicalJson(calendar) !== canonicalJson(snapshotCalendar)) {
    errors.push("completed-session evidence must be independent, non-fixture, and version-bound to HKEX");
  }
  if (!date(evidence.cutoff) || evidence.cutoff !== request.cutoff
    || evidence.completedThroughCutoff !== true
    || !date(evidence.lastCompletedSession)
    || String(evidence.lastCompletedSession) > String(evidence.cutoff)
    || evidence.lastCompletedSession !== snapshot.lastCompletedSession
    || snapshot.lastSession !== evidence.lastCompletedSession) {
    errors.push("completed-session evidence must prove the last completed session through the requested cutoff");
  }
  if (!Array.isArray(evidence.completedSessions)
    || canonicalJson(evidence.completedSessions) !== canonicalJson(snapshot.expectedSessions)
    || evidence.completedSessions.at(-1) !== evidence.lastCompletedSession) {
    errors.push("independent completed sessions must exactly bind expected-session coverage");
  }
  if (evidence.marketCloseAt !== `${String(evidence.lastCompletedSession)}T16:10:00+08:00`
    || !strictInstant(evidence.evaluatedAt)
    || !areInstantsChronologicallyOrdered([evidence.marketCloseAt, source.dataCutoffAt, source.fetchedAt])
    || !areInstantsChronologicallyOrdered([evidence.marketCloseAt, evidence.evaluatedAt, source.fetchedAt])) {
    errors.push("completed-session evidence must be evaluated after the bound HK market close");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function strictInstant(value: unknown): value is string {
  return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value));
}
