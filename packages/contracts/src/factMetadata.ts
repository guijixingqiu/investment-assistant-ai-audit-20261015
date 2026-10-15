import {
  FACT_METADATA_ALLOWS_ADDITIONAL_PROPERTIES,
  FACT_METADATA_KEYS,
  FACT_METADATA_PROPERTY_METADATA,
  FACT_METADATA_REQUIRED_KEYS,
  FACT_AUTHORITY_VALUES,
  FACT_FRESHNESS_VALUES,
  FACT_PROVENANCE_VALUES
} from "./factMetadataValues.generated.js";

export {
  FACT_METADATA_ALLOWS_ADDITIONAL_PROPERTIES,
  FACT_METADATA_BOOLEAN_KEYS,
  FACT_METADATA_DATE_TIME_KEYS,
  FACT_METADATA_KEYS,
  FACT_METADATA_NON_EMPTY_STRING_KEYS,
  FACT_METADATA_NULLABLE_KEYS,
  FACT_METADATA_PROPERTY_METADATA,
  FACT_METADATA_REQUIRED_KEYS,
  FACT_AUTHORITY_VALUES,
  FACT_FRESHNESS_VALUES,
  FACT_PROVENANCE_VALUES
} from "./factMetadataValues.generated.js";

export type FactFreshness = (typeof FACT_FRESHNESS_VALUES)[number];
export type FactProvenance = (typeof FACT_PROVENANCE_VALUES)[number];
export type FactAuthority = (typeof FACT_AUTHORITY_VALUES)[number];

export interface FactMetadata {
  source: string;
  asOf: string | null;
  fetchedAt: string | null;
  freshness: FactFreshness;
  provenance: FactProvenance;
  authority: FactAuthority;
  stale: boolean;
  missing: boolean;
  conflict: boolean;
  fixture: boolean;
  correctionOf: string | null;
  replaces: string | null;
  message: string;
}

export function makeFactMetadata(input: FactMetadata): FactMetadata {
  return input;
}

export function validateFactMetadata(
  value: unknown,
  field = "metadata"
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  validateFactMetadataInto(value, field, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateFactMetadataInto(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }

  for (const key of FACT_METADATA_REQUIRED_KEYS) {
    if (!hasOwn(value, key)) errors.push(`${field}.${key} is required`);
  }
  if (!FACT_METADATA_ALLOWS_ADDITIONAL_PROPERTIES) {
    for (const key of Object.keys(value)) {
      if (!(FACT_METADATA_KEYS as readonly string[]).includes(key)) {
        errors.push(`${field}.${key} is not allowed`);
      }
    }
  }
  for (const key of FACT_METADATA_KEYS) {
    if (!hasOwn(value, key)) continue;
    validateSchemaProperty(value[key], key, field, errors);
  }

  if (value.freshness === "fresh" && value.stale === true) {
    errors.push(`${field}.freshness fresh must not be stale`);
  }
  if (value.freshness === "missing" && value.missing !== true) {
    errors.push(`${field}.freshness missing requires missing true`);
  }
  if (value.freshness === "conflict" && value.conflict !== true) {
    errors.push(`${field}.freshness conflict requires conflict true`);
  }
  if (value.provenance === "fixture" && value.fixture !== true) {
    errors.push(`${field}.provenance fixture requires fixture true`);
  }
}

function validateSchemaProperty(
  value: unknown,
  key: (typeof FACT_METADATA_KEYS)[number],
  field: string,
  errors: string[]
): void {
  const rules = FACT_METADATA_PROPERTY_METADATA[key];
  const propertyField = `${field}.${key}`;
  if (value === null) {
    if (!rules.nullable) errors.push(`${propertyField} must not be null`);
    return;
  }
  if (rules.kind === "boolean") {
    if (typeof value !== "boolean") errors.push(`${propertyField} must be a boolean`);
    return;
  }
  if (typeof value !== "string") {
    errors.push(`${propertyField} must be${rules.nullable ? " null or" : ""} a string`);
    return;
  }
  if (rules.minLength !== null && value.length < rules.minLength) {
    errors.push(`${propertyField} must be non-empty`);
  }
  if (rules.pattern !== null && !new RegExp(rules.pattern, "u").test(value)) {
    errors.push(`${propertyField} has an invalid string format`);
  }
  if (rules.enumValues !== null && !(rules.enumValues as readonly string[]).includes(value)) {
    errors.push(`${propertyField} is invalid`);
  }
  if (rules.format === "date-time" && !isRfc3339DateTime(value)) {
    errors.push(`${propertyField} must be a valid RFC3339 date-time`);
  }
}

export function isRfc3339DateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) {
    return false;
  }
  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= monthDays[month - 1]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
