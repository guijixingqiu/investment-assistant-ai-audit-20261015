export const RESEARCH_MONITOR_CATEGORIES = [
  "announcement", "financial_report", "corporate_action", "major_news", "price_volume_anomaly",
  "operating_kpi", "industry_chain_price", "competition", "policy", "macro"
] as const;
export const RESEARCH_MONITOR_CADENCES = ["on_event", "daily", "weekly", "monthly", "quarterly"] as const;
export const SCHEDULED_OFFICIAL_MONITOR_CATEGORIES = ["announcement", "financial_report", "corporate_action"] as const;

export interface ResearchMonitorRule {
  variableName: string;
  category: typeof RESEARCH_MONITOR_CATEGORIES[number];
  source: string;
  cadence: typeof RESEARCH_MONITOR_CADENCES[number];
  threshold: string;
  reason: string;
  enabled: boolean;
  version?: number;
  confirmedAt?: string;
}

/** A confirmed rule selects an official disclosure category, never a URL from its free-text source. */
export function scheduledOfficialMonitorRule(rule: ResearchMonitorRule): boolean {
  return rule.enabled && (rule.version ?? 0) > 0 && Number.isFinite(Date.parse(rule.confirmedAt ?? ""))
    && SCHEDULED_OFFICIAL_MONITOR_CATEGORIES.some((category) => category === rule.category);
}

/** Calendar windows are anchored to Owner confirmation, so a 24-hour retry cap cannot shorten a monthly rule. */
export function nextOfficialMonitorCheckAt(rule: ResearchMonitorRule, lastAttemptAt: string | null): string | null {
  if (!scheduledOfficialMonitorRule(rule)) return null;
  const anchor = new Date(rule.confirmedAt!);
  const last = lastAttemptAt === null ? NaN : Date.parse(lastAttemptAt);
  if (!Number.isFinite(last) || last < anchor.getTime()) return anchor.toISOString();
  const fixed = rule.cadence === "on_event" ? 6 * 60 * 60 * 1000
    : rule.cadence === "daily" ? 24 * 60 * 60 * 1000
      : rule.cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 : null;
  if (fixed !== null) {
    const windows = Math.floor((last - anchor.getTime()) / fixed) + 1;
    return new Date(anchor.getTime() + windows * fixed).toISOString();
  }
  const step = rule.cadence === "monthly" ? 1 : 3;
  const previous = new Date(last);
  const monthDistance = (previous.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + previous.getUTCMonth() - anchor.getUTCMonth();
  let months = Math.max(0, Math.floor(monthDistance / step) * step);
  let next = calendarMonthAfter(anchor, months);
  while (next.getTime() <= last) { months += step; next = calendarMonthAfter(anchor, months); }
  return next.toISOString();
}

function calendarMonthAfter(anchor: Date, months: number): Date {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1,
    anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return first;
}

export function researchMonitorRuleErrors(value: unknown, keyVariables: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return ["monitorRules must contain at most 20 rules"];
  if (!Array.isArray(keyVariables)) return ["monitorRules require keyVariables in the same profile write"];
  const allowedVariables = new Set(keyVariables);
  const variables = new Set<string>();
  const errors: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!record(item) || !exact(item, ["variableName", "category", "source", "cadence", "threshold", "reason", "enabled"], ["version", "confirmedAt"])) {
      errors.push(`monitorRules.${index} has an invalid shape`);
      continue;
    }
    if (!bounded(item.variableName, 500) || !allowedVariables.has(item.variableName) || variables.has(String(item.variableName))) {
      errors.push(`monitorRules.${index}.variableName must uniquely bind a key variable`);
    } else variables.add(String(item.variableName));
    if (!RESEARCH_MONITOR_CATEGORIES.includes(item.category as ResearchMonitorRule["category"])) errors.push(`monitorRules.${index}.category is invalid`);
    if (!bounded(item.source, 1_000)) errors.push(`monitorRules.${index}.source is invalid`);
    if (!RESEARCH_MONITOR_CADENCES.includes(item.cadence as ResearchMonitorRule["cadence"])) errors.push(`monitorRules.${index}.cadence is invalid`);
    if (!bounded(item.threshold, 2_000)) errors.push(`monitorRules.${index}.threshold is invalid`);
    if (!bounded(item.reason, 2_000)) errors.push(`monitorRules.${index}.reason is invalid`);
    if (typeof item.enabled !== "boolean") errors.push(`monitorRules.${index}.enabled must be boolean`);
    const hasVersion = item.version !== undefined;
    const hasConfirmation = item.confirmedAt !== undefined;
    if (hasVersion !== hasConfirmation
      || (hasVersion && (!Number.isSafeInteger(item.version) || Number(item.version) <= 0))
      || (hasConfirmation && (!bounded(item.confirmedAt, 100) || Number.isNaN(Date.parse(String(item.confirmedAt)))))) {
      errors.push(`monitorRules.${index} version and confirmedAt must be a valid confirmed pair`);
    }
  }
  return errors;
}

export function sameResearchMonitorRuleContent(left: ResearchMonitorRule, right: ResearchMonitorRule): boolean {
  return left.variableName === right.variableName && left.category === right.category
    && left.source === right.source && left.cadence === right.cadence
    && left.threshold === right.threshold && left.reason === right.reason
    && left.enabled === right.enabled;
}

function bounded(value: unknown, max: number): boolean {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= max;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, required: string[], optional: string[]): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}
