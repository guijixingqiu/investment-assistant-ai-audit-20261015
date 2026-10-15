import type { AnnualConditionalDecisionState } from "./annualConditionalDecisionContract.js";
import type { AnnualReviewLearningState } from "./annualReviewLearning.js";
import { canonicalJson } from "./decisionContextBrowser.js";

export const ANNUAL_REVIEW_LEARNING_SUMMARY_SCHEMA_VERSION =
  "2026-07-17.annual-review-learning-summary.v1";
export const ANNUAL_REVIEW_LEARNING_MINIMUM_SAMPLE_SIZE = 5;

const CONFIDENCES = ["low", "medium", "high"] as const;
const OUTCOMES = [
  "thesis_confirmed", "thesis_weakened", "thesis_invalidated", "insufficient_evidence"
] as const;
const AVAILABILITIES = ["ready", "insufficient_sample", "learning_not_captured"] as const;

type Confidence = (typeof CONFIDENCES)[number];
type Outcome = (typeof OUTCOMES)[number];

export interface AnnualReviewLearningSummarySourceReview {
  id: string;
  outcome: Outcome;
  reviewedAt: string;
  reviewLearning: AnnualReviewLearningState;
}

export interface AnnualReviewLearningSummarySourceCheck {
  id: string;
  conditionalDecision: AnnualConditionalDecisionState;
  reviews: AnnualReviewLearningSummarySourceReview[];
}

export interface AnnualReviewLearningConfidenceOutcomeRow {
  confidence: Confidence;
  total: number;
  outcomes: Record<Outcome, number>;
  reviewIds: string[];
}

export interface AnnualReviewLearningRepeatedLesson {
  processLesson: string;
  count: number;
  reviewIds: string[];
}

export interface AnnualReviewLearningQuantSampleLimitation {
  sourceClassification: string;
  finalTestPolicy: string;
  boundaryLimitation: string;
  diagnosticStatus: string;
  diagnosticLimitation: string;
  decisionCheckIds: string[];
}

export interface AnnualReviewLearningSummary {
  schemaVersion: typeof ANNUAL_REVIEW_LEARNING_SUMMARY_SCHEMA_VERSION;
  availability: "ready" | "insufficient_sample" | "learning_not_captured";
  generatedAt: string;
  minimumSampleSize: typeof ANNUAL_REVIEW_LEARNING_MINIMUM_SAMPLE_SIZE;
  counts: {
    eligibleReviews: number;
    capturedLearningRecords: number;
    notCapturedLearningRecords: number;
  };
  confidenceOutcomes: AnnualReviewLearningConfidenceOutcomeRow[];
  repeatedProcessLessons: AnnualReviewLearningRepeatedLesson[];
  quantSampleLimitations: AnnualReviewLearningQuantSampleLimitation[];
  limitation: string;
  safety: {
    personalActorOnly: true;
    descriptiveOnly: true;
    infersCorrectness: false;
    usesProfitLoss: false;
    comparesUsers: false;
    score: false;
    recommendation: false;
    ranking: false;
    targetPrice: false;
    targetPosition: false;
    tradeDirection: false;
    createsOrder: false;
    createsTrade: false;
    callsBroker: false;
  };
}

interface CapturedRecord {
  check: AnnualReviewLearningSummarySourceCheck;
  review: AnnualReviewLearningSummarySourceReview;
  confidence: Confidence;
  processLesson: string;
}

export function buildAnnualReviewLearningSummary(
  checks: AnnualReviewLearningSummarySourceCheck[],
  generatedAt: string
): AnnualReviewLearningSummary {
  const eligible = checks.flatMap((check) => {
    const conditional = check?.conditionalDecision;
    if (conditional?.availability !== "preserved" || !conditional.judgment || !Array.isArray(check?.reviews)) return [];
    return check.reviews.map((review) => ({ check, review, confidence: conditional.judgment!.confidence }));
  });
  const captured: CapturedRecord[] = eligible.flatMap(({ check, review, confidence }) => {
    const snapshot = review?.reviewLearning?.availability === "preserved"
      ? review.reviewLearning.snapshot
      : null;
    return snapshot && typeof snapshot.processLesson === "string"
      ? [{ check, review, confidence, processLesson: snapshot.processLesson }]
      : [];
  });
  const ready = captured.length >= ANNUAL_REVIEW_LEARNING_MINIMUM_SAMPLE_SIZE;
  const availability = captured.length === 0
    ? "learning_not_captured"
    : ready ? "ready" : "insufficient_sample";
  return {
    schemaVersion: ANNUAL_REVIEW_LEARNING_SUMMARY_SCHEMA_VERSION,
    availability,
    generatedAt,
    minimumSampleSize: ANNUAL_REVIEW_LEARNING_MINIMUM_SAMPLE_SIZE,
    counts: {
      eligibleReviews: eligible.length,
      capturedLearningRecords: captured.length,
      notCapturedLearningRecords: eligible.length - captured.length
    },
    confidenceOutcomes: ready ? confidenceOutcomeRows(captured) : [],
    repeatedProcessLessons: ready ? repeatedLessons(captured) : [],
    quantSampleLimitations: ready ? quantSampleLimitations(captured) : [],
    limitation: ready
      ? "This personal descriptive summary separates frozen confidence, later human review outcomes, exact repeated process lessons, and frozen quant sample limits. It does not infer correctness, attribute profit or loss, score, compare users, recommend, rank, size, direct, or execute an investment decision."
      : captured.length === 0
        ? "No captured actor-scoped review-learning records are available; historical gaps are not reconstructed from current facts."
        : `Only ${captured.length} captured actor-scoped learning records are available; at least ${ANNUAL_REVIEW_LEARNING_MINIMUM_SAMPLE_SIZE} are required before descriptive aggregates are shown.`,
    safety: {
      personalActorOnly: true,
      descriptiveOnly: true,
      infersCorrectness: false,
      usesProfitLoss: false,
      comparesUsers: false,
      score: false,
      recommendation: false,
      ranking: false,
      targetPrice: false,
      targetPosition: false,
      tradeDirection: false,
      createsOrder: false,
      createsTrade: false,
      callsBroker: false
    }
  };
}

export function validateAnnualReviewLearningSummary(
  value: unknown,
  checks?: AnnualReviewLearningSummarySourceCheck[]
): { ok: true; value: AnnualReviewLearningSummary } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["learningSummary must be an object"] };
  exactKeys(value, [
    "schemaVersion", "availability", "generatedAt", "minimumSampleSize", "counts",
    "confidenceOutcomes", "repeatedProcessLessons", "quantSampleLimitations", "limitation", "safety"
  ], "learningSummary", errors);
  if (value.schemaVersion !== ANNUAL_REVIEW_LEARNING_SUMMARY_SCHEMA_VERSION) errors.push("learningSummary schemaVersion is invalid");
  if (!AVAILABILITIES.includes(value.availability as AnnualReviewLearningSummary["availability"])) errors.push("learningSummary availability is invalid");
  if (!isUtcInstant(value.generatedAt)) errors.push("learningSummary generatedAt must be an ISO instant");
  if (value.minimumSampleSize !== ANNUAL_REVIEW_LEARNING_MINIMUM_SAMPLE_SIZE) errors.push("learningSummary minimumSampleSize is invalid");
  validateCounts(value.counts, errors);
  validateConfidenceRows(value.confidenceOutcomes, errors);
  validateRepeatedLessons(value.repeatedProcessLessons, errors);
  validateQuantLimitations(value.quantSampleLimitations, errors);
  if (typeof value.limitation !== "string" || value.limitation.trim().length === 0) errors.push("learningSummary limitation is required");
  validateSafety(value.safety, errors);
  validateAggregateState(value, errors);
  if (checks && isUtcInstant(value.generatedAt)) {
    try {
      const expected = buildAnnualReviewLearningSummary(checks, value.generatedAt as string);
      if (canonicalJson(value) !== canonicalJson(expected)) errors.push("learningSummary must derive exactly from actor-scoped immutable review history");
    } catch {
      errors.push("learningSummary source history is invalid and cannot be derived");
    }
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualReviewLearningSummary }
    : { ok: false, errors };
}

function confidenceOutcomeRows(records: CapturedRecord[]): AnnualReviewLearningConfidenceOutcomeRow[] {
  return CONFIDENCES.map((confidence) => {
    const matches = records.filter((record) => record.confidence === confidence);
    return {
      confidence,
      total: matches.length,
      outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [
        outcome, matches.filter((record) => record.review.outcome === outcome).length
      ])) as Record<Outcome, number>,
      reviewIds: matches.map((record) => record.review.id)
    };
  });
}

function repeatedLessons(records: CapturedRecord[]): AnnualReviewLearningRepeatedLesson[] {
  const grouped = new Map<string, string[]>();
  for (const record of records) grouped.set(record.processLesson, [...(grouped.get(record.processLesson) ?? []), record.review.id]);
  return [...grouped.entries()]
    .filter(([, reviewIds]) => reviewIds.length >= 2)
    .map(([processLesson, reviewIds]) => ({ processLesson, count: reviewIds.length, reviewIds }))
    .sort((left, right) => right.count - left.count
      || (left.processLesson < right.processLesson ? -1 : left.processLesson > right.processLesson ? 1 : 0));
}

function quantSampleLimitations(records: CapturedRecord[]): AnnualReviewLearningQuantSampleLimitation[] {
  const grouped = new Map<string, AnnualReviewLearningQuantSampleLimitation>();
  for (const record of records) {
    const quant = record.check.conditionalDecision.preview?.data?.valuationQuant.data?.quant;
    const boundary = quant?.evidence.sampleBoundary;
    const diagnostic = quant?.diagnostics.sampleSize;
    const item = {
      sourceClassification: boundary?.sourceClassification ?? "unavailable",
      finalTestPolicy: boundary?.finalTestPolicy ?? "unavailable",
      boundaryLimitation: boundary?.limitation ?? "Frozen quant sample boundary was not captured and is not reconstructed.",
      diagnosticStatus: diagnostic?.status ?? "not_captured",
      diagnosticLimitation: diagnostic?.limitation ?? "Frozen quant sample-size diagnostic was not captured and is not reconstructed."
    };
    const key = JSON.stringify(item);
    const prior = grouped.get(key);
    if (!prior) grouped.set(key, { ...item, decisionCheckIds: [record.check.id] });
    else if (!prior.decisionCheckIds.includes(record.check.id)) prior.decisionCheckIds.push(record.check.id);
  }
  return [...grouped.values()];
}

function validateCounts(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return void errors.push("learningSummary counts must be an object");
  exactKeys(value, ["eligibleReviews", "capturedLearningRecords", "notCapturedLearningRecords"], "learningSummary counts", errors);
  for (const key of ["eligibleReviews", "capturedLearningRecords", "notCapturedLearningRecords"]) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0) errors.push(`learningSummary counts.${key} must be a non-negative integer`);
  }
}

function validateConfidenceRows(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) return void errors.push("learningSummary confidenceOutcomes must be an array");
  if (value.length !== 0 && value.length !== CONFIDENCES.length) errors.push("learningSummary confidenceOutcomes must be empty or contain low, medium, and high rows");
  for (const [index, row] of value.entries()) {
    if (!isRecord(row)) { errors.push(`learningSummary confidenceOutcomes[${index}] must be an object`); continue; }
    exactKeys(row, ["confidence", "total", "outcomes", "reviewIds"], `learningSummary confidenceOutcomes[${index}]`, errors);
    if (!CONFIDENCES.includes(row.confidence as Confidence) || !Number.isInteger(row.total) || Number(row.total) < 0) errors.push(`learningSummary confidenceOutcomes[${index}] is invalid`);
    if (value.length === CONFIDENCES.length && row.confidence !== CONFIDENCES[index]) errors.push(`learningSummary confidenceOutcomes[${index}] is out of canonical order`);
    const outcomes = row.outcomes;
    if (!isRecord(outcomes)) errors.push(`learningSummary confidenceOutcomes[${index}].outcomes must be an object`);
    else {
      exactKeys(outcomes, [...OUTCOMES], `learningSummary confidenceOutcomes[${index}].outcomes`, errors);
      for (const outcome of OUTCOMES) if (!Number.isInteger(outcomes[outcome]) || Number(outcomes[outcome]) < 0) errors.push(`learningSummary outcome count ${outcome} is invalid`);
      if (OUTCOMES.every((outcome) => Number.isInteger(outcomes[outcome]))
        && Number.isInteger(row.total)
        && OUTCOMES.reduce((sum, outcome) => sum + Number(outcomes[outcome]), 0) !== row.total) {
        errors.push(`learningSummary confidenceOutcomes[${index}] total must equal its outcome counts`);
      }
    }
    stringArray(row.reviewIds, `learningSummary confidenceOutcomes[${index}].reviewIds`, errors);
    if (Array.isArray(row.reviewIds) && Number.isInteger(row.total) && row.reviewIds.length !== row.total) errors.push(`learningSummary confidenceOutcomes[${index}] reviewIds must match total`);
  }
}

function validateRepeatedLessons(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) return void errors.push("learningSummary repeatedProcessLessons must be an array");
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) { errors.push(`learningSummary repeatedProcessLessons[${index}] must be an object`); continue; }
    exactKeys(item, ["processLesson", "count", "reviewIds"], `learningSummary repeatedProcessLessons[${index}]`, errors);
    if (typeof item.processLesson !== "string" || item.processLesson.trim() !== item.processLesson || item.processLesson.length === 0 || item.processLesson.length > 4000 || !Number.isInteger(item.count) || Number(item.count) < 2) errors.push(`learningSummary repeatedProcessLessons[${index}] is invalid`);
    stringArray(item.reviewIds, `learningSummary repeatedProcessLessons[${index}].reviewIds`, errors);
    if (Array.isArray(item.reviewIds) && Number.isInteger(item.count) && item.reviewIds.length !== item.count) errors.push(`learningSummary repeatedProcessLessons[${index}] reviewIds must match count`);
  }
}

function validateQuantLimitations(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) return void errors.push("learningSummary quantSampleLimitations must be an array");
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) { errors.push(`learningSummary quantSampleLimitations[${index}] must be an object`); continue; }
    exactKeys(item, ["sourceClassification", "finalTestPolicy", "boundaryLimitation", "diagnosticStatus", "diagnosticLimitation", "decisionCheckIds"], `learningSummary quantSampleLimitations[${index}]`, errors);
    for (const key of ["sourceClassification", "finalTestPolicy", "boundaryLimitation", "diagnosticStatus", "diagnosticLimitation"]) if (typeof item[key] !== "string" || String(item[key]).trim().length === 0) errors.push(`learningSummary quantSampleLimitations[${index}].${key} is required`);
    stringArray(item.decisionCheckIds, `learningSummary quantSampleLimitations[${index}].decisionCheckIds`, errors);
    if (Array.isArray(item.decisionCheckIds) && item.decisionCheckIds.length === 0) errors.push(`learningSummary quantSampleLimitations[${index}] decisionCheckIds must not be empty`);
  }
}

function validateAggregateState(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.counts)) return;
  const eligible = value.counts.eligibleReviews;
  const captured = value.counts.capturedLearningRecords;
  const notCaptured = value.counts.notCapturedLearningRecords;
  if (![eligible, captured, notCaptured].every((count) => Number.isInteger(count) && Number(count) >= 0)) return;
  if (Number(captured) + Number(notCaptured) !== eligible) errors.push("learningSummary counts must partition eligible reviews");
  const expectedAvailability = Number(captured) === 0
    ? "learning_not_captured"
    : Number(captured) >= ANNUAL_REVIEW_LEARNING_MINIMUM_SAMPLE_SIZE ? "ready" : "insufficient_sample";
  if (value.availability !== expectedAvailability) errors.push("learningSummary availability must match captured sample count");
  const aggregateKeys = ["confidenceOutcomes", "repeatedProcessLessons", "quantSampleLimitations"];
  if (expectedAvailability !== "ready" && aggregateKeys.some((key) => Array.isArray(value[key]) && value[key].length > 0)) {
    errors.push("learningSummary aggregates must remain empty below the minimum sample size");
  }
  if (expectedAvailability === "ready" && Array.isArray(value.confidenceOutcomes)) {
    const rowTotal = value.confidenceOutcomes.reduce((sum, row) => sum + (isRecord(row) && Number.isInteger(row.total) ? Number(row.total) : 0), 0);
    if (rowTotal !== captured) errors.push("learningSummary confidence totals must equal captured learning records");
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return void errors.push("learningSummary safety must be an object");
  const trueKeys = ["personalActorOnly", "descriptiveOnly"];
  const falseKeys = ["infersCorrectness", "usesProfitLoss", "comparesUsers", "score", "recommendation", "ranking", "targetPrice", "targetPosition", "tradeDirection", "createsOrder", "createsTrade", "callsBroker"];
  exactKeys(value, [...trueKeys, ...falseKeys], "learningSummary safety", errors);
  for (const key of trueKeys) if (value[key] !== true) errors.push(`learningSummary safety.${key} must be true`);
  for (const key of falseKeys) if (value[key] !== false) errors.push(`learningSummary safety.${key} must be false`);
}

function stringArray(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0) || new Set(value).size !== value.length) errors.push(`${label} must contain unique non-empty strings`);
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const keys = new Set(expected);
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of expected) if (!Object.hasOwn(value, key)) errors.push(`${label} is missing field ${key}`);
}

function isUtcInstant(value: unknown): value is string {
  return typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
