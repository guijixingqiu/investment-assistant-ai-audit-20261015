export function validateProfileReviewDueShape(
  value: Record<string, unknown>,
  index: number,
  errors: string[]
): void {
  if (value.researchTarget !== null || value.reviewEvent !== null || !["new", "later"].includes(String(value.state))
    || !record(value.membership) || !record(value.source) || value.source.lane !== "candidate_membership"
    || value.source.sourceType !== "research_profiles" || value.source.id !== value.membership.id
    || value.source.version !== value.membership.version || value.source.effectiveAt === null) {
    errors.push(`items[${index}] research profile review item shape is invalid`);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
