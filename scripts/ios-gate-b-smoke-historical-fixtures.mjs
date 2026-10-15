const DAILY_CONTINUITY_RECOVERY_TOKEN = "daily-continuity-recovery";
const RECOVERY_SYMBOL = "HK.09926";

export function pinganSnapshotFor09926Smoke({ token, staleSnapshot, unavailableSnapshot }) {
  const recovery = token === DAILY_CONTINUITY_RECOVERY_TOKEN;
  const template = recovery ? staleSnapshot : unavailableSnapshot;
  const expectedStatus = recovery ? "stale" : "unavailable";
  if (template?.status !== expectedStatus) {
    throw new Error(`HK.09926 smoke fixture requires a ${expectedStatus} Pingan template`);
  }

  const snapshot = structuredClone(template);
  snapshot.requestedSymbol = RECOVERY_SYMBOL;
  if (!recovery) return snapshot;

  snapshot.positions = snapshot.positions.map((position) => ({
    ...position,
    market: "HK",
    code: "09926",
    symbol: RECOVERY_SYMBOL,
    sourceRowId: "broker_raw_transactions:approved-pingan-row-09926",
    name: "HK.09926 recovery fixture"
  }));
  snapshot.positionCount = snapshot.positions.length;
  snapshot.message = "Last imported Pingan snapshot for HK.09926; display only with warning.";
  return snapshot;
}
