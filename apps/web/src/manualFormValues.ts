import { input } from "./view.js";

export function nullableInputValue(id: string): string | null {
  const value = input(id).value.trim();
  return value ? value : null;
}

export function requiredManualNumber(id: string, label: string): number {
  const raw = input(id).value.trim();
  if (!raw) throw new Error(`${label}不能为空`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有效数字`);
  return value;
}

export function optionalManualNumber(id: string, label: string, divisor = 1): number | null {
  const raw = input(id).value.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有效数字`);
  return value / divisor;
}
