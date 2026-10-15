import type {
  AiUpdateSuggestionData,
  EvidenceItemData,
  ResearchProfileData,
  SuggestionStatus
} from "../../../../packages/contracts/src/research.js";
import type { ResearchMonitorRule } from "../../../../packages/contracts/src/researchMonitorRule.js";

export interface ResearchProfileRow {
  id: string;
  market: string;
  code: string;
  symbol: string;
  name: string | null;
  current_view: string;
  current_thesis: string;
  market_disagreement: string | null;
  invalidation_condition: string | null;
  next_review_on: Date | string | null;
  key_variables?: string[];
  catalysts?: string[];
  evidence_gaps?: string[];
  monitor_rules?: ResearchMonitorRule[];
  updated_at: Date | string;
  fixture?: boolean;
}

export interface EvidenceRow {
  id: string;
  source_type: string;
  source_url: string | null;
  published_at: Date | string | null;
  captured_at: Date | string;
  summary: string;
  fact_kind: "fact" | "inference";
  variable_name: string | null;
  stance: "support" | "refute" | "neutral";
  reliability: number | null;
  materiality?: number | null;
  is_read: boolean;
}

export interface SuggestionRow {
  id: string;
  status: SuggestionStatus;
  summary: string;
  supports: string[];
  weakens: string[];
  counter_evidence: string[];
  changed_variables: string[];
  missing_evidence: string[];
  created_at: Date | string;
  decided_at: Date | string | null;
  decision_note: string | null;
}

export function rowToProfile(row: ResearchProfileRow): ResearchProfileData {
  return {
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    name: row.name,
    currentView: row.current_view,
    currentThesis: row.current_thesis,
    marketDisagreement: row.market_disagreement,
    invalidationCondition: row.invalidation_condition,
    nextReviewOn: row.next_review_on instanceof Date ? formatCalendarDate(row.next_review_on) : row.next_review_on,
    keyVariables: row.key_variables ?? [],
    catalysts: row.catalysts ?? [],
    evidenceGaps: row.evidence_gaps ?? [],
    monitorRules: row.monitor_rules ?? []
  };
}

export function rowToEvidence(row: EvidenceRow): EvidenceItemData {
  return {
    id: String(row.id),
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    publishedAt: row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at,
    capturedAt: new Date(row.captured_at).toISOString(),
    summary: row.summary,
    factKind: row.fact_kind,
    variableName: row.variable_name,
    stance: row.stance,
    reliability: row.reliability,
    materiality: row.materiality ?? null,
    isRead: row.is_read
  };
}

export function rowToSuggestion(row: SuggestionRow): AiUpdateSuggestionData {
  return {
    id: String(row.id),
    status: row.status,
    summary: row.summary,
    supports: row.supports ?? [],
    weakens: row.weakens ?? [],
    counterEvidence: row.counter_evidence ?? [],
    changedVariables: row.changed_variables ?? [],
    missingEvidence: row.missing_evidence ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    decidedAt: row.decided_at instanceof Date ? row.decided_at.toISOString() : row.decided_at,
    decisionNote: row.decision_note
  };
}

export function researchEvidenceFreshness(evidence: EvidenceItemData[], now: Date) {
  const evidenceAsOf = latestIso(evidence.map((item) => item.capturedAt));
  const missing = evidenceAsOf === null;
  const stale = evidenceAsOf !== null
    && now.getTime() - new Date(evidenceAsOf).getTime() > 90 * 24 * 60 * 60 * 1_000;
  return {
    evidenceAsOf,
    freshness: stale ? "stale" as const : missing ? "missing" as const : "fresh" as const,
    stale,
    missing
  };
}

export function latestIso(values: string[]): string | null {
  const timestamps = values.map((value) => new Date(value).getTime()).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function formatCalendarDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
