import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import type { MarketQuoteData } from "./market.js";
import type { AiUpdateSuggestionData, DecisionActionIntent, EvidenceItemData, ResearchProfileData } from "./research.js";
import { DECISION_ACTION_INTENTS, RESEARCH_WRITE_SCHEMA_VERSION } from "./research.js";
import { OWNER_PROVIDED_PDF_SOURCE_TYPE, ISSUER_PUBLIC_PDF_SOURCE_TYPE,
  ISSUER_PUBLIC_HTML_SOURCE_TYPE } from "./researchMaterial.js";
import { FUTU_FINANCIAL_STATEMENT_SOURCE } from "./researchFutuFinancialStatement.js";
import type { DecisionSnapshotBinding, DecisionSnapshotState } from "./decisionSnapshotContract.js";
import { validateDecisionSnapshotBinding, validateDecisionSnapshotStateStructure } from "./decisionSnapshotContract.js";
import type { AnnualConditionalDecisionState, AnnualConditionalDecisionSubmission } from "./annualConditionalDecisionContract.js";
import { conditionalHumanCheckResult, validateAnnualConditionalDecisionStateStructure, validateAnnualConditionalDecisionSubmissionStructure } from "./annualConditionalDecisionContract.js";
import { validateDecisionQuantEvidenceInto, type DecisionQuantEvidence } from "./decisionQuantEvidenceContract.js";
import { areInstantsChronologicallyOrdered } from "./chronology.js";
import { validateResearchReportBindingRequestInto, validateResearchReportDecisionStateInto, type ResearchReportDecisionBinding, type ResearchReportDecisionState } from "./researchReportDecision.js";
import { formalDecisionNotCapturedState, validateFormalDecisionState, validateFormalOwnerDecisionInput, type FormalDecisionState, type FormalOwnerDecisionInput } from "./formalDecision.js";
export * from "./decisionQuantEvidenceContract.js";
export * from "./researchReportDecision.js";
export const DECISION_CONTEXT_SCHEMA_VERSION = "2026-06-23.core-1a.v1";
export const DECISION_CHECK_SCHEMA_VERSION = "2026-06-23.pre-trade-check.v1";
export const DECISION_QUOTE_STATUSES = ["fresh", "stale", "unavailable", "empty", "permission_denied"] as const;
export const DECISION_RESEARCH_STATUSES = ["available", "no_evidence", "stale_evidence", "unavailable", "unauthorized"] as const;
export const ADVISORY_SUMMARY_STATUSES = ["available", "uncertain", "unavailable"] as const;
export const HUMAN_CHECK_RESULTS = ["ready_to_consider", "blocked", "needs_more_evidence"] as const;
export type DecisionQuoteStatus = (typeof DECISION_QUOTE_STATUSES)[number];
export type DecisionResearchStatus = (typeof DECISION_RESEARCH_STATUSES)[number];
export type AdvisorySummaryStatus = (typeof ADVISORY_SUMMARY_STATUSES)[number];
export type HumanCheckResult = (typeof HUMAN_CHECK_RESULTS)[number];
export interface DecisionContextEnvelope {
  schemaVersion: typeof DECISION_CONTEXT_SCHEMA_VERSION;
  contextId: string;
  contextHash: string;
  generatedAt: string;
  requestedSymbol: string;
  provenance: {
    quote: "persisted_market_quotes";
    research: "research_profiles_evidence_suggestions";
    quant: "quant_research_evidence";
    portfolio: "omitted";
  };
  quote: {
    status: DecisionQuoteStatus;
    snapshotId: string | null;
    fetchedAt: string | null;
    source: string | null;
    staleReason: string | null;
    metadata: FactMetadata;
    data: MarketQuoteData | null;
    message: string;
  };
  research: {
    status: DecisionResearchStatus;
    profile: ResearchProfileData | null;
    evidence: EvidenceItemData[];
    suggestions: AiUpdateSuggestionData[];
    evidenceAsOf: string | null;
    staleReason: string | null;
    metadata: FactMetadata;
    message: string;
  };
  suggestionSummary: {
    status: AdvisorySummaryStatus;
    kind: "advisory_information";
    summary: string;
    linkedEvidenceIds: string[];
    limitations: string[];
  };
  quantEvidence: DecisionQuantEvidence;
  portfolio: {
    status: "omitted";
    reason: "authoritative_portfolio_source_not_approved";
    message: string;
  };
  message: string;
}

export interface CreatePreTradeDecisionCheckRequest {
  decisionContextSchemaVersion: typeof DECISION_CONTEXT_SCHEMA_VERSION;
  contextId: string;
  contextHash: string;
  actionIntent: DecisionActionIntent;
  humanCheckResult: HumanCheckResult;
  userFinalDecision?: string | null;
  reviewedAt?: string | null;
  reviewDueOn?: string;
  manualSourceBindings?: ManualDecisionSourceBinding[];
  researchChangeBinding?: OrdinaryResearchChangeBinding;
  decisionSnapshotBinding?: DecisionSnapshotBinding;
  conditionalDecision?: AnnualConditionalDecisionSubmission;
  researchReportBinding?: ResearchReportDecisionBinding;
  formalDecision?: FormalOwnerDecisionInput;
  idempotencyKey: string;
}

export interface PreTradeDecisionCheckData {
  id: string;
  market: string;
  code: string;
  symbol: string;
  decisionContextSchemaVersion: typeof DECISION_CONTEXT_SCHEMA_VERSION;
  decisionCheckSchemaVersion: typeof DECISION_CHECK_SCHEMA_VERSION;
  contextId: string;
  contextHash: string;
  actionIntent: DecisionActionIntent;
  humanCheckResult: HumanCheckResult;
  userFinalDecision: string | null;
  checkedAt: string;
  reviewDueOn?: string;
  manualSourceBindings?: ManualDecisionSourceBinding[];
  researchChangeBinding?: OrdinaryResearchChangeBinding;
  decisionSnapshot?: DecisionSnapshotState;
  conditionalDecision?: AnnualConditionalDecisionState;
  researchReportDecision: ResearchReportDecisionState;
  formalDecision: FormalDecisionState;
  audit: {
    actorType: "user" | "system" | "migration" | "test";
    actorId: string | null;
    idempotencyKey: string;
    correlationId: string | null;
  };
  safety: {
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
  };
}
/** The Owner-selected coordinates recorded with an ordinary manual check. */
export interface ProfileDecisionSourceBinding {
  bindingKind?: "profile_evidence";
  evidenceId: string;
  sourceId: string;
  title: string;
  sourceType: string;
  sourceUrl?: string | null;
  contentSha256: string;
  pageNumber?: number | null;
  documentId?: string;
  documentPdfSha256?: string;
  snapshotId?: string;
  snapshotRawSha256?: string;
  materialId?: string;
  materialRevision?: number;
  materialFingerprint?: string;
}
export interface SavedMaterialDecisionSourceBinding {
  bindingKind: "saved_material";
  membershipId: string;
  membershipVersion: number;
  materialId: string;
  materialRevision: number;
  materialFingerprint: string;
  sourceId: string;
  title: string;
  sourceType: typeof OWNER_PROVIDED_PDF_SOURCE_TYPE | typeof ISSUER_PUBLIC_PDF_SOURCE_TYPE
    | typeof ISSUER_PUBLIC_HTML_SOURCE_TYPE | typeof FUTU_FINANCIAL_STATEMENT_SOURCE;
  sourceUrl: string | null;
  contentSha256: string;
  pageNumber?: number;
  documentId?: string;
  documentPdfSha256?: string;
  snapshotId?: string;
  snapshotRawSha256?: string;
}
export type ManualDecisionSourceBinding = ProfileDecisionSourceBinding | SavedMaterialDecisionSourceBinding;

/** Owner-selected current research change and the earlier ordinary judgment it revisits. */
export interface OrdinaryResearchChangeBinding {
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  changeId: string;
  reasoningFingerprint: string;
  selectedFactId: string;
  sourceMaterialId: string;
  sourceMaterialRevision: number;
  sourceContentFingerprint: string;
  sourcePublishedAt: string;
  factPeriodEnd: string;
  previousDecisionCheckId: string;
  nextQuestion: string;
}

export function validateOrdinaryResearchChangeBinding(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${field} must be an object`); return; }
  const keys = ["membershipId", "membershipVersion", "symbol", "changeId", "reasoningFingerprint",
    "selectedFactId", "sourceMaterialId", "sourceMaterialRevision", "sourceContentFingerprint",
    "sourcePublishedAt", "factPeriodEnd", "previousDecisionCheckId", "nextQuestion"];
  rejectUnknownKeys(value, field, keys, errors);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${field}.${key} is required`);
  for (const key of ["membershipId", "selectedFactId", "sourceMaterialId", "previousDecisionCheckId"])
    if (typeof value[key] !== "string" || !/^[1-9][0-9]*$/.test(value[key])) errors.push(`${field}.${key} must be a positive ID`);
  for (const key of ["membershipVersion", "sourceMaterialRevision"])
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) errors.push(`${field}.${key} must be positive`);
  if (typeof value.symbol !== "string" || !/^HK\.[0-9]{5}$/.test(value.symbol)) errors.push(`${field}.symbol is invalid`);
  for (const key of ["changeId", "reasoningFingerprint", "sourceContentFingerprint"])
    if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key])) errors.push(`${field}.${key} must be lowercase SHA-256`);
  validateDateTime(value.sourcePublishedAt, `${field}.sourcePublishedAt`, errors);
  if (!validDecisionReviewDueOn(value.factPeriodEnd)) errors.push(`${field}.factPeriodEnd must be a calendar date`);
  if (typeof value.nextQuestion !== "string" || !value.nextQuestion.trim() || value.nextQuestion.length > 4000)
    errors.push(`${field}.nextQuestion must be 1-4000 characters`);
}

export function validateManualDecisionSourceBindings(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    errors.push(`${field} must contain 1-20 selected sources`);
    return;
  }
  const evidenceIds = new Set<string>();
  const sourceIds = new Set<string>();
  value.forEach((item, index) => {
    const label = `${field}[${index}]`;
    if (!isRecord(item)) { errors.push(`${label} must be an object`); return; }
    if (typeof item.sourceId === "string") {
      if (sourceIds.has(item.sourceId)) errors.push(`${label}.sourceId repeats a selected source`);
      sourceIds.add(item.sourceId);
    }
    if (item.bindingKind === "saved_material") {
      validateSavedMaterialDecisionSourceBinding(item, label, errors);
      return;
    }
    rejectUnknownKeys(item, label, ["bindingKind", "evidenceId", "sourceId", "title", "sourceType", "sourceUrl",
      "contentSha256", "pageNumber", "documentId", "documentPdfSha256", "snapshotId", "snapshotRawSha256",
      "materialId", "materialRevision", "materialFingerprint"], errors);
    if (item.bindingKind !== undefined && item.bindingKind !== "profile_evidence")
      errors.push(`${label}.bindingKind is invalid`);
    for (const key of ["evidenceId", "sourceId", "title", "sourceType"]) {
      requireNonEmptyString(item[key], `${label}.${key}`, errors);
    }
    if (typeof item.evidenceId === "string") {
      if (evidenceIds.has(item.evidenceId)) errors.push(`${label}.evidenceId repeats a selected evidence`);
      evidenceIds.add(item.evidenceId);
    }
    if (typeof item.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.contentSha256))
      errors.push(`${label}.contentSha256 must be lowercase SHA-256`);
    if (item.sourceUrl !== undefined && item.sourceUrl !== null) {
      if (typeof item.sourceUrl !== "string") {
        errors.push(`${label}.sourceUrl must be a URL string`);
      } else {
      try {
        const url = new URL(item.sourceUrl);
        if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password)
          errors.push(`${label}.sourceUrl must be a public HTTP(S) URL`);
      } catch { errors.push(`${label}.sourceUrl must be a valid URL`); }
      }
    }
    if (item.pageNumber !== undefined && item.pageNumber !== null
      && (!Number.isSafeInteger(item.pageNumber) || (item.pageNumber as number) < 1))
      errors.push(`${label}.pageNumber must be positive`);
    if (item.sourceType === "official_pdf" && (!Number.isSafeInteger(item.pageNumber) || (item.pageNumber as number) < 1))
      errors.push(`${label}.pageNumber is required for official PDF`);
    if ((item.documentId === undefined) !== (item.documentPdfSha256 === undefined))
      errors.push(`${label} saved PDF identity must include document ID and raw hash`);
    if (item.documentId !== undefined && (item.sourceType !== "official_pdf"
      || typeof item.documentId !== "string" || !/^[1-9][0-9]*$/.test(item.documentId)
      || typeof item.documentPdfSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.documentPdfSha256)))
      errors.push(`${label} saved PDF identity is invalid`);
    if ((item.snapshotId === undefined) !== (item.snapshotRawSha256 === undefined))
      errors.push(`${label} snapshot identity must include ID and raw hash`);
    if (item.snapshotId !== undefined && (typeof item.snapshotId !== "string" || !/^[1-9][0-9]*$/.test(item.snapshotId)))
      errors.push(`${label}.snapshotId is invalid`);
    if (item.snapshotRawSha256 !== undefined && (typeof item.snapshotRawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.snapshotRawSha256)))
      errors.push(`${label}.snapshotRawSha256 is invalid`);
    const materialFields = [item.materialId, item.materialRevision, item.materialFingerprint];
    if (materialFields.some((entry) => entry !== undefined)) {
      if (typeof item.materialId !== "string" || !/^[1-9][0-9]*$/.test(item.materialId)
        || !Number.isSafeInteger(item.materialRevision) || (item.materialRevision as number) < 1
        || typeof item.materialFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.materialFingerprint))
        errors.push(`${label} saved material identity is invalid`);
    }
    if (item.sourceType === "futu_opend_financial_statement_provider" && materialFields.some((entry) => entry === undefined))
      errors.push(`${label} provider source requires saved material identity`);
  });
}

function validateSavedMaterialDecisionSourceBinding(item: Record<string, unknown>, label: string, errors: string[]): void {
  rejectUnknownKeys(item, label, ["bindingKind", "membershipId", "membershipVersion", "materialId",
    "materialRevision", "materialFingerprint", "sourceId", "title", "sourceType", "sourceUrl",
    "contentSha256", "pageNumber", "documentId", "documentPdfSha256", "snapshotId", "snapshotRawSha256"], errors);
  for (const key of ["membershipId", "materialId"])
    if (typeof item[key] !== "string" || !/^[1-9]\d*$/.test(item[key])) errors.push(`${label}.${key} must be a positive ID`);
  for (const key of ["membershipVersion", "materialRevision"])
    if (!Number.isSafeInteger(item[key]) || Number(item[key]) < 1) errors.push(`${label}.${key} must be positive`);
  for (const key of ["sourceId", "title", "sourceType"]) requireNonEmptyString(item[key], `${label}.${key}`, errors);
  for (const key of ["materialFingerprint", "contentSha256"])
    if (typeof item[key] !== "string" || !/^[a-f0-9]{64}$/.test(item[key])) errors.push(`${label}.${key} must be SHA-256`);
  if (item.sourceUrl !== null && (typeof item.sourceUrl !== "string" || !validPublicSourceUrl(item.sourceUrl)))
    errors.push(`${label}.sourceUrl must be null or a public HTTP(S) URL`);
  const pdf = item.sourceType === OWNER_PROVIDED_PDF_SOURCE_TYPE || item.sourceType === ISSUER_PUBLIC_PDF_SOURCE_TYPE;
  const html = item.sourceType === ISSUER_PUBLIC_HTML_SOURCE_TYPE;
  const provider = item.sourceType === FUTU_FINANCIAL_STATEMENT_SOURCE;
  if (!pdf && !html && !provider) errors.push(`${label}.sourceType is not a supported saved original`);
  if (pdf && (!Number.isSafeInteger(item.pageNumber) || Number(item.pageNumber) < 1
    || typeof item.documentId !== "string" || !/^[1-9]\d*$/.test(item.documentId)
    || typeof item.documentPdfSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.documentPdfSha256)
    || item.snapshotId !== undefined || item.snapshotRawSha256 !== undefined))
    errors.push(`${label} PDF original coordinates are incomplete or mixed`);
  if (html && (typeof item.snapshotId !== "string" || !/^[1-9]\d*$/.test(item.snapshotId)
    || typeof item.snapshotRawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.snapshotRawSha256)
    || item.pageNumber !== undefined || item.documentId !== undefined || item.documentPdfSha256 !== undefined))
    errors.push(`${label} HTML original coordinates are incomplete or mixed`);
  if (provider && (item.sourceUrl !== null || item.contentSha256 !== item.materialFingerprint
    || [item.pageNumber, item.documentId, item.documentPdfSha256, item.snapshotId, item.snapshotRawSha256]
      .some((entry) => entry !== undefined))) errors.push(`${label} provider original must bind only its saved material`);
}

function validPublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
export type DecisionContextHashInput = Omit<DecisionContextEnvelope, "contextId" | "contextHash" | "generatedAt">;
export function decisionContextHashInputFromEnvelope(envelope: DecisionContextEnvelope): DecisionContextHashInput {
  return {
    schemaVersion: envelope.schemaVersion,
    requestedSymbol: envelope.requestedSymbol,
    provenance: envelope.provenance,
    quote: envelope.quote,
    research: envelope.research,
    suggestionSummary: envelope.suggestionSummary,
    quantEvidence: envelope.quantEvidence,
    portfolio: envelope.portfolio,
    message: envelope.message
  };
}
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
export function validateDecisionContextEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== DECISION_CONTEXT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${DECISION_CONTEXT_SCHEMA_VERSION}`);
  requireNonEmptyString(value.contextId, "contextId", errors);
  requireNonEmptyString(value.contextHash, "contextHash", errors);
  validateDateTime(value.generatedAt, "generatedAt", errors);
  requireNonEmptyString(value.requestedSymbol, "requestedSymbol", errors);
  if (!isRecord(value.provenance) || value.provenance.quote !== "persisted_market_quotes" || value.provenance.research !== "research_profiles_evidence_suggestions" || value.provenance.quant !== "quant_research_evidence" || value.provenance.portfolio !== "omitted") {
    errors.push("provenance must identify persisted quote, research facts, quant research evidence, and omitted portfolio context");
  }
  validateQuote(value.quote, value.generatedAt, errors);
  validateResearch(value.research, errors);
  validateDecisionQuantEvidenceInto(value.quantEvidence, value.requestedSymbol, errors, value.generatedAt);
  validateNestedFactIdentity(value.requestedSymbol, value.quote, value.research, errors);
  validateSummary(value.suggestionSummary, errors);
  if (!isRecord(value.portfolio) || value.portfolio.status !== "omitted" || value.portfolio.reason !== "authoritative_portfolio_source_not_approved" || typeof value.portfolio.message !== "string") {
    errors.push("portfolio must be omitted because authoritative_portfolio_source_not_approved");
  }
  if (typeof value.message !== "string") errors.push("message must be a string");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
export function validateCreatePreTradeDecisionCheckRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", [
    "decisionContextSchemaVersion",
    "contextId",
    "contextHash",
    "actionIntent",
    "humanCheckResult",
    "userFinalDecision",
    "reviewedAt",
    "reviewDueOn", "manualSourceBindings", "researchChangeBinding",
    "decisionSnapshotBinding", "conditionalDecision", "researchReportBinding", "formalDecision",
    "idempotencyKey"
  ], errors);
  if (value.decisionContextSchemaVersion !== DECISION_CONTEXT_SCHEMA_VERSION) errors.push(`decisionContextSchemaVersion must be ${DECISION_CONTEXT_SCHEMA_VERSION}`);
  requireNonEmptyString(value.contextId, "contextId", errors);
  requireNonEmptyString(value.contextHash, "contextHash", errors);
  if (!DECISION_ACTION_INTENTS.includes(value.actionIntent as DecisionActionIntent)) errors.push(`actionIntent must be one of ${DECISION_ACTION_INTENTS.join(", ")}`);
  if (!HUMAN_CHECK_RESULTS.includes(value.humanCheckResult as HumanCheckResult)) errors.push("humanCheckResult must be ready_to_consider, blocked, or needs_more_evidence");
  validateOptionalString(value.userFinalDecision, "userFinalDecision", errors);
  validateOptionalString(value.reviewedAt, "reviewedAt", errors);
  if (typeof value.reviewedAt === "string" && !Number.isFinite(Date.parse(value.reviewedAt))) {
    errors.push("reviewedAt must be a valid date-time");
  }
  if (value.reviewDueOn !== undefined) {
    if (!validDecisionReviewDueOn(value.reviewDueOn)) errors.push("reviewDueOn must be a valid YYYY-MM-DD calendar date");
    if (value.researchReportBinding !== undefined || value.conditionalDecision !== undefined || value.formalDecision !== undefined)
      errors.push("reviewDueOn is only available for an ordinary unbound decision check");
  }
  if (value.manualSourceBindings !== undefined) {
    if (value.researchReportBinding !== undefined || value.conditionalDecision !== undefined || value.formalDecision !== undefined)
      errors.push("manualSourceBindings require an ordinary unbound decision check");
    validateManualDecisionSourceBindings(value.manualSourceBindings, "manualSourceBindings", errors);
  }
  if (value.researchChangeBinding !== undefined) {
    if (value.researchReportBinding !== undefined || value.conditionalDecision !== undefined || value.formalDecision !== undefined)
      errors.push("researchChangeBinding requires an ordinary unbound decision check");
    if (typeof value.userFinalDecision !== "string" || !value.userFinalDecision.trim())
      errors.push("researchChangeBinding requires an explicit new Owner judgment");
    validateOrdinaryResearchChangeBinding(value.researchChangeBinding, "researchChangeBinding", errors);
    if (isRecord(value.researchChangeBinding) && typeof value.reviewedAt === "string"
      && Date.parse(String(value.researchChangeBinding.sourcePublishedAt)) > Date.parse(value.reviewedAt))
      errors.push("researchChangeBinding source must precede the stated judgment time");
  }
  if (value.decisionSnapshotBinding !== undefined) {
    const snapshotValidation = validateDecisionSnapshotBinding(value.decisionSnapshotBinding);
    if (!snapshotValidation.ok) errors.push(...snapshotValidation.errors);
  }
  if (value.conditionalDecision !== undefined) {
    const conditional = validateAnnualConditionalDecisionSubmissionStructure(value.conditionalDecision);
    if (!conditional.ok) errors.push(...conditional.errors);
    else if (value.actionIntent !== "watch" || value.humanCheckResult !== conditionalHumanCheckResult(conditional.value.judgment.workflowState) || value.decisionSnapshotBinding === undefined) errors.push("conditionalDecision requires neutral watch semantics, matching human result, and a decision snapshot binding");
  }
  validateResearchReportBindingRequestInto(value.researchReportBinding, value.conditionalDecision, value.decisionSnapshotBinding, errors);
  if (value.formalDecision === undefined) {
    if (value.researchReportBinding !== undefined) errors.push("formalDecision is required with researchReportBinding");
  } else {
    const formal = validateFormalOwnerDecisionInput(value.formalDecision, "formalDecision", true);
    if (!formal.ok) errors.push(...formal.errors);
    if (value.researchReportBinding === undefined) errors.push("formalDecision requires researchReportBinding");
  }
  requireNonEmptyString(value.idempotencyKey, "idempotencyKey", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
export function validatePreTradeDecisionCheckWriteEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["write envelope must be an object"] };
  if (value.schemaVersion !== RESEARCH_WRITE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${RESEARCH_WRITE_SCHEMA_VERSION}`);
  if (value.status !== "succeeded") errors.push("status must be succeeded");
  validateDateTime(value.asOf, "asOf", errors);
  validateWriteSource(value.source, errors);
  validatePreTradeDecisionCheckData(value.data, "data", value.source, errors);
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("message must be a non-empty string");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
function validateQuote(value: unknown, generatedAt: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quote must be an object");
    return;
  }
  if (!DECISION_QUOTE_STATUSES.includes(value.status as DecisionQuoteStatus)) errors.push("quote.status is invalid");
  validateOptionalString(value.snapshotId, "quote.snapshotId", errors);
  validateOptionalString(value.fetchedAt, "quote.fetchedAt", errors);
  validateOptionalString(value.source, "quote.source", errors);
  validateOptionalString(value.staleReason, "quote.staleReason", errors);
  validateFactMetadataInto(value.metadata, "quote.metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.status === "fresh" && value.metadata.freshness !== "fresh") errors.push("quote.metadata.freshness must be fresh when quote.status is fresh");
    if (value.status === "stale" && value.metadata.freshness !== "stale") errors.push("quote.metadata.freshness must be stale when quote.status is stale");
    if (value.status === "empty" && value.metadata.freshness !== "missing") errors.push("quote.metadata.freshness must be missing when quote.status is empty");
    if ((value.status === "unavailable" || value.status === "permission_denied") && value.metadata.freshness === "fresh") errors.push("quote.metadata.freshness must not be fresh when quote is unavailable");
  }
  if ((value.status === "fresh" || value.status === "stale") && !isRecord(value.data)) errors.push("quote.data is required for fresh or stale quote");
  if (!(value.status === "fresh" || value.status === "stale") && value.data !== null) errors.push("quote.data must be null when quote is not available");
  if ((value.status === "fresh" || value.status === "stale") && isRecord(value.data) && isRecord(value.metadata)) {
    if (!areInstantsChronologicallyOrdered([value.data.quoteTime, value.fetchedAt, generatedAt])) errors.push("quote must satisfy quoteTime <= fetchedAt <= generatedAt");
    if (value.metadata.asOf !== value.data.quoteTime || value.metadata.fetchedAt !== value.fetchedAt) errors.push("quote metadata timestamps must bind quote data and fetchedAt");
  } else if (!(value.status === "fresh" || value.status === "stale") && (value.snapshotId !== null || value.fetchedAt !== null || value.data !== null || (isRecord(value.metadata) && (value.metadata.asOf !== null || value.metadata.fetchedAt !== null)))) errors.push("unavailable quote must clear snapshotId, timestamps, and data");
  if ((value.status === "unavailable" || value.status === "permission_denied") && value.source !== null) errors.push("unavailable quote must clear source");
  if (typeof value.message !== "string") errors.push("quote.message must be a string");
}

function validateResearch(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("research must be an object");
    return;
  }
  if (!DECISION_RESEARCH_STATUSES.includes(value.status as DecisionResearchStatus)) errors.push("research.status is invalid");
  if (value.profile !== null && !isRecord(value.profile)) errors.push("research.profile must be null or an object");
  if (!Array.isArray(value.evidence)) errors.push("research.evidence must be an array");
  if (!Array.isArray(value.suggestions)) errors.push("research.suggestions must be an array");
  validateOptionalString(value.evidenceAsOf, "research.evidenceAsOf", errors);
  validateOptionalString(value.staleReason, "research.staleReason", errors);
  validateFactMetadataInto(value.metadata, "research.metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.status === "available" && value.metadata.freshness !== "fresh") errors.push("research.metadata.freshness must be fresh when research.status is available");
    if (value.status === "stale_evidence" && value.metadata.freshness !== "stale") errors.push("research.metadata.freshness must be stale when research.status is stale_evidence");
    if (value.status === "no_evidence" && value.metadata.freshness !== "missing") errors.push("research.metadata.freshness must be missing when research.status is no_evidence");
    if ((value.status === "unavailable" || value.status === "unauthorized") && value.metadata.freshness === "fresh") errors.push("research.metadata.freshness must not be fresh when research is unavailable");
  }
  if (typeof value.message !== "string") errors.push("research.message must be a string");
}

function validateSummary(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("suggestionSummary must be an object");
    return;
  }
  if (!ADVISORY_SUMMARY_STATUSES.includes(value.status as AdvisorySummaryStatus)) errors.push("suggestionSummary.status is invalid");
  if (value.kind !== "advisory_information") errors.push("suggestionSummary.kind must be advisory_information");
  if (typeof value.summary !== "string") errors.push("suggestionSummary.summary must be a string");
  if (!Array.isArray(value.linkedEvidenceIds) || !value.linkedEvidenceIds.every((item) => typeof item === "string")) errors.push("suggestionSummary.linkedEvidenceIds must be strings");
  if (!Array.isArray(value.limitations) || !value.limitations.every((item) => typeof item === "string")) errors.push("suggestionSummary.limitations must be strings");
}

function validateNestedFactIdentity(requestedSymbol: unknown, quote: unknown, research: unknown, errors: string[]): void {
  if (typeof requestedSymbol !== "string") return;
  const [market, code] = requestedSymbol.split(".");
  if (!market || !code) return;
  const quoteData = isRecord(quote) ? quote.data : null;
  const researchProfile = isRecord(research) ? research.profile : null;
  validateMarketCodeSymbol(quoteData, market, code, requestedSymbol, "quote.data", errors);
  validateMarketCodeSymbol(researchProfile, market, code, requestedSymbol, "research.profile", errors);
}

function validateMarketCodeSymbol(
  value: unknown,
  expectedMarket: string,
  expectedCode: string,
  expectedSymbol: string,
  field: string,
  errors: string[]
): void {
  if (value === null || value === undefined) return;
  if (!isRecord(value)) return;
  if (value.market !== expectedMarket || value.code !== expectedCode || value.symbol !== expectedSymbol) {
    errors.push(`${field} identity must match requestedSymbol`);
  }
}

function validatePreTradeDecisionCheckData(value: unknown, field: string, source: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  requireNonEmptyString(value.id, `${field}.id`, errors);
  requireNonEmptyString(value.market, `${field}.market`, errors);
  requireNonEmptyString(value.code, `${field}.code`, errors);
  requireNonEmptyString(value.symbol, `${field}.symbol`, errors);
  if (typeof value.market === "string" && typeof value.code === "string" && value.symbol !== `${value.market}.${value.code}`) {
    errors.push(`${field}.symbol must equal canonical market/code identity`);
  }
  if (value.decisionContextSchemaVersion !== DECISION_CONTEXT_SCHEMA_VERSION) {
    errors.push(`${field}.decisionContextSchemaVersion must be ${DECISION_CONTEXT_SCHEMA_VERSION}`);
  }
  if (value.decisionCheckSchemaVersion !== DECISION_CHECK_SCHEMA_VERSION) {
    errors.push(`${field}.decisionCheckSchemaVersion must be ${DECISION_CHECK_SCHEMA_VERSION}`);
  }
  requireNonEmptyString(value.contextId, `${field}.contextId`, errors);
  requireNonEmptyString(value.contextHash, `${field}.contextHash`, errors);
  if (!DECISION_ACTION_INTENTS.includes(value.actionIntent as DecisionActionIntent)) errors.push(`${field}.actionIntent is invalid`);
  if (!HUMAN_CHECK_RESULTS.includes(value.humanCheckResult as HumanCheckResult)) errors.push(`${field}.humanCheckResult is invalid`);
  validateOptionalString(value.userFinalDecision, `${field}.userFinalDecision`, errors);
  validateDateTime(value.checkedAt, `${field}.checkedAt`, errors);
  if (value.reviewDueOn !== undefined && !validDecisionReviewDueOn(value.reviewDueOn))
    errors.push(`${field}.reviewDueOn must be a valid YYYY-MM-DD calendar date`);
  if (value.manualSourceBindings !== undefined)
    validateManualDecisionSourceBindings(value.manualSourceBindings, `${field}.manualSourceBindings`, errors);
  if (value.researchChangeBinding !== undefined) {
    validateOrdinaryResearchChangeBinding(value.researchChangeBinding, `${field}.researchChangeBinding`, errors);
    if (isRecord(value.researchChangeBinding) && (value.researchChangeBinding.symbol !== value.symbol
      || value.researchChangeBinding.previousDecisionCheckId === value.id
      || Date.parse(String(value.researchChangeBinding.sourcePublishedAt)) > Date.parse(String(value.checkedAt))))
      errors.push(`${field}.researchChangeBinding identity or chronology is invalid`);
  }
  if (value.decisionSnapshot !== undefined) {
    const snapshotValidation = validateDecisionSnapshotStateStructure(value.decisionSnapshot);
    if (!snapshotValidation.ok) errors.push(...snapshotValidation.errors.map((error) => `${field}.${error}`));
  }
  if (value.conditionalDecision !== undefined) {
    const conditional = validateAnnualConditionalDecisionStateStructure(value.conditionalDecision);
    if (!conditional.ok) errors.push(...conditional.errors.map((error) => `${field}.${error}`));
  }
  validateResearchReportDecisionStateInto(value.researchReportDecision, field, errors);
  const formal = validateFormalDecisionState(value.formalDecision ?? formalDecisionNotCapturedState(), `${field}.formalDecision`);
  if (!formal.ok) errors.push(...formal.errors);
  validateDecisionCheckAudit(value.audit, `${field}.audit`, source, errors);
  validateNoSideEffectSafety(value.safety, `${field}.safety`, errors);
}

function validateDecisionCheckAudit(value: unknown, field: string, source: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  validateWriteSource(value, errors, field);
  requireNonEmptyString(value.idempotencyKey, `${field}.idempotencyKey`, errors);
  if (isRecord(source)) {
    if (value.actorType !== source.actorType) errors.push(`${field}.actorType must match source.actorType`);
    if (value.actorId !== source.actorId) errors.push(`${field}.actorId must match source.actorId`);
    if (value.correlationId !== source.correlationId) errors.push(`${field}.correlationId must match source.correlationId`);
  }
}

function validateWriteSource(value: unknown, errors: string[], field = "source"): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (value.actorType !== "user" && value.actorType !== "system" && value.actorType !== "migration" && value.actorType !== "test") {
    errors.push(`${field}.actorType must be user, system, migration, or test`);
  }
  validateOptionalString(value.actorId, `${field}.actorId`, errors);
  if (typeof value.actorId === "string" && value.actorId.trim().length === 0) errors.push(`${field}.actorId must be non-empty when present`);
  validateOptionalString(value.correlationId, `${field}.correlationId`, errors);
  if (typeof value.correlationId === "string" && value.correlationId.trim().length === 0) errors.push(`${field}.correlationId must be non-empty when present`);
}

function validateNoSideEffectSafety(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  for (const key of ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"]) {
    if (value[key] !== false) errors.push(`${field}.${key} must be false`);
  }
}

function validateDateTime(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    errors.push(`${field} must be a valid date-time`);
  }
}

export function validDecisionReviewDueOn(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined && value !== null && typeof value !== "string") errors.push(`${field} must be a string or null`);
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowedKeys: string[], errors: string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) result[key] = canonicalize(child);
  }
  return result;
}
