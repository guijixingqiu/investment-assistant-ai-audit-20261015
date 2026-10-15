export function todayReviewDueIdentity(
  subject: string,
  sourceEventId: string,
  effectiveAt: string
): string {
  return `REVIEW_DUE|${subject}|${sourceEventId}|${effectiveAt}`;
}

export function todayDailyTrackingIdentity(
  subject: string,
  sourceEventId: string,
  effectiveAt: string
): string {
  return `DAILY_TRACKING|${subject}|${sourceEventId}|${effectiveAt}`;
}

export function todayFormalDecisionDueIdentity(
  subject: string,
  reportDecisionId: string,
  decidedAt: string
): string {
  return `FORMAL_DECISION_DUE|${subject}|${reportDecisionId}|${decidedAt}`;
}
