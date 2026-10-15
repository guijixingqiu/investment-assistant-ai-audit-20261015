export function parseBooleanQuery(value: string | boolean | undefined): boolean | null {
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

export function isCanonicalMembershipId(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

export function isSupportedHongKongSymbol(market: string, code: string): boolean {
  return market.trim().toUpperCase() === "HK" && /^\d{5}$/.test(code.trim());
}

export function canonicalHongKongSymbol(market: string, code: string): string {
  return `${market.trim().toUpperCase()}.${code.trim()}`;
}

export function rejectClientControlledAuditFields(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const errors: string[] = [];
  for (const key of ["actorType", "actorId", "correlationId"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${key} is not allowed`);
    }
  }
  return errors;
}

export function validateInternalSeedFixtureBody(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object" || Array.isArray(value)) {
    return ["request body must be an object when present"];
  }
  const errors = rejectClientControlledAuditFields(value);
  const record = value as Record<string, unknown>;
  for (const key of ["source", "audit", "metadata", "rawPayload"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      errors.push(`request.${key} is not allowed`);
    }
  }
  for (const key of Object.keys(record)) {
    errors.push(`seed-fixture request body must be empty; unexpected field ${key}`);
  }
  return errors;
}
