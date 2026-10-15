import type { CloudAiProviderPolicySnapshot, CloudAiSendAuthorizationSnapshot } from "../../../packages/contracts/src/cloudAiPolicy.js";

export function localDateTimeInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function nullableNumberText(value: number | null): string {
  return value === null ? "" : String(value);
}

export function nullablePercentText(value: number | null): string {
  return value === null ? "" : String(value * 100);
}

export function cloudAiPolicySnapshotSummary(value: CloudAiProviderPolicySnapshot | undefined): string {
  return value
    ? `region=${value.processingRegion} · crossBorder=${value.crossBorderProcessing} · retention=${value.retention} · training=${value.training} · noTraining=${value.noTrainingGuaranteed} · backup=${value.backupProvider} · deletion=${value.deletionContact}`
    : "policy snapshot not captured for this historical send";
}

export function cloudAiSendAuthorizationSummary(value: CloudAiSendAuthorizationSnapshot | undefined): string {
  return value
    ? `send-time Owner authorization=${value.status} · confirmedAt=${value.confirmedAt} · policy=${value.confirmedPolicyVersion} · backup=${value.confirmedBackupProvider} · revokedAt=none · deletion=not_requested`
    : "send-time Owner authorization not captured for this historical send";
}
