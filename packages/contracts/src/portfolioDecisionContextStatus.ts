export function validatePortfolioContextDataUse(status: unknown, value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("dataUse is required"); return; }
  const expectedDisplay = status === "available" || status === "zero_position" ? "allowed" : status === "stale" || status === "partial" ? "allowed_with_warning" : "blocked";
  const expectedRisk = status === "available" ? "allowed_current_development_only" : status === "stale" ? "blocked_stale" : status === "partial" ? "blocked_incomplete" : "blocked";
  if (value.display !== expectedDisplay) errors.push("dataUse.display does not match status");
  if (value.advisoryRiskImpact !== expectedRisk) errors.push("dataUse.advisoryRiskImpact does not match status");
  if (value.productionPortfolio !== "blocked_not_production_authority") errors.push("production portfolio must remain blocked");
  for (const field of ["brokerReconciliation", "accounting", "execution"]) if (value[field] !== "blocked") errors.push(`dataUse.${field} must remain blocked`);
}

export function validatePortfolioContextStatus(
  value: Record<string, unknown>,
  positions: unknown[],
  errors: string[]
): void {
  if (["available", "stale", "partial", "zero_position"].includes(String(value.status))) {
    const hasProvenance = ["sourceAsOf", "importedAt", "fetchedAt", "freshness"].some((field) => Object.prototype.hasOwnProperty.call(value, field));
    if (value.contextId === null || value.portfolioSnapshotId === null || value.accountScopeId === null || !["pingan_imported_snapshot", "owner_entered_current"].includes(String(value.portfolioSource)) || value.portfolioAsOf === null || hasProvenance && (value.sourceAsOf === null || value.importedAt === null || value.fetchedAt === null || (value.freshness === null && value.portfolioSource !== "owner_entered_current"))) errors.push("displayable context requires portfolio identities and provenance");
    if ((value.status === "available" || value.status === "partial") && positions.length === 0) errors.push("position-bearing displayable context requires positions");
    if (value.status === "zero_position" && positions.length !== 0) errors.push("zero_position context must expose zero positions");
    return;
  }
  if (positions.length !== 0) errors.push("fail-closed context must not expose positions");
  const hasProvenance = ["sourceAsOf", "importedAt", "fetchedAt", "freshness"].some((field) => Object.prototype.hasOwnProperty.call(value, field));
  if (value.contextId !== null
    || value.portfolioSnapshotId !== null
    || value.portfolioSource !== null
    || value.portfolioAsOf !== null
    || hasProvenance && (value.sourceAsOf !== null || value.importedAt !== null || value.fetchedAt !== null || value.freshness !== null)) {
    errors.push("fail-closed context must clear portfolio fact identities");
  }
  validateFailClosedSummary(value.summary, errors);
}

export function validateZeroPositionPortfolioContext(
  status: unknown,
  marketValue: Record<string, unknown> | null,
  concentration: Record<string, unknown> | null,
  errors: string[]
): void {
  const expectedSummaryStatus = status === "zero_position" ? "complete_current" : "complete_stale";
  if ((status !== "zero_position" && status !== "stale")
    || !marketValue
    || marketValue.status !== expectedSummaryStatus
    || marketValue.amount !== 0
    || marketValue.currency !== "HKD"
    || marketValue.missingPositionCount !== 0) {
    errors.push("zero-position context requires an exact complete zero HKD market value summary");
  }
  if (!concentration
    || concentration.status !== "unavailable"
    || [concentration.largestPositionWeight, concentration.topThreeWeight, concentration.hhi].some((field) => field !== null)) {
    errors.push("zero-position context must keep concentration unavailable");
  }
}

export function validatePortfolioDisplayableProvenance(value: Record<string, unknown>, errors: string[]): void {
  if (!["sourceAsOf", "portfolioAsOf", "importedAt", "fetchedAt"].every((field) => isStrictDate(value[field]))) {
    errors.push("displayable context requires complete Pingan provenance timestamps");
    return;
  }
  if (value.sourceAsOf !== value.portfolioAsOf) errors.push("displayable context sourceAsOf must equal portfolioAsOf");
  const sourceAsOf = Date.parse(value.sourceAsOf as string);
  const importedAt = Date.parse(value.importedAt as string);
  const fetchedAt = Date.parse(value.fetchedAt as string);
  const assembledAt = Date.parse(value.assembledAt as string);
  if (sourceAsOf > fetchedAt || importedAt > assembledAt || fetchedAt > assembledAt) errors.push("displayable context provenance must not be after assembledAt and sourceAsOf must not be after fetchedAt");
  if (value.portfolioSource === "owner_entered_current" && value.freshness === null) return;
  if (!isRecord(value.freshness)) {
    errors.push("displayable context requires Pingan freshness");
    return;
  }
  if (isStrictDate(value.freshness.evaluatedAt) && Date.parse(value.freshness.evaluatedAt) > assembledAt) errors.push("displayable context freshness evaluatedAt must not be after assembledAt");
}

export function validatePortfolioUnrealizedPnl(value: Record<string, unknown>, positions: Record<string, unknown>[], errors: string[]): void {
  const summary = isRecord(value.summary) ? value.summary : null;
  if (!summary) return;
  if (!Object.prototype.hasOwnProperty.call(summary, "unrealizedPnl")) {
    errors.push("summary.unrealizedPnl is required for current Pingan provenance");
    return;
  }
  const expected = positions.length > 0 && positions.every((position) => isFiniteNumber(position.unrealizedPnl))
    ? round(positions.reduce((total, position) => total + Number(position.unrealizedPnl), 0))
    : null;
  if (summary.unrealizedPnl !== expected) errors.push("summary.unrealizedPnl must recompute from every position unrealizedPnl");
}

function validateFailClosedSummary(value: unknown, errors: string[]): void {
  const summary = isRecord(value) ? value : null;
  const marketValue = summary && isRecord(summary.marketValue) ? summary.marketValue : null;
  const concentration = summary && isRecord(summary.concentration) ? summary.concentration : null;
  if (!marketValue
    || marketValue.status !== "unavailable"
    || marketValue.amount !== null
    || marketValue.currency !== null
    || marketValue.missingPositionCount !== 0) {
    errors.push("fail-closed context must keep market value unavailable");
  }
  if (!concentration
    || concentration.status !== "unavailable"
    || [concentration.largestPositionWeight, concentration.topThreeWeight, concentration.hhi].some((field) => field !== null)) {
    errors.push("fail-closed context must keep concentration unavailable");
  }
  if (summary && Object.prototype.hasOwnProperty.call(summary, "unrealizedPnl") && summary.unrealizedPnl !== null) errors.push("fail-closed context must keep unrealized P&L unknown");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function round(value: number): number { return Math.round(value * 100) / 100; }
