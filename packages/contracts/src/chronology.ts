export function areInstantsChronologicallyOrdered(values: readonly unknown[]): boolean {
  let previous = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const current = instantMilliseconds(value);
    if (current === null || current < previous) return false;
    previous = current;
  }
  return true;
}

function instantMilliseconds(value: unknown): number | null {
  const milliseconds = value instanceof Date
    ? value.getTime()
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}
