import type {
  PinganSnapshotEnvelope,
  PinganSnapshotStatus
} from "../../../../packages/contracts/src/portfolioSnapshot.js";
import { PINGAN_SNAPSHOT_SCHEMA_VERSION } from "../../../../packages/contracts/src/portfolioSnapshot.js";

export const PINGAN_LAST_IMPORTED_WARNING = "Pingan portfolio context is the last imported historical snapshot. It is not live, not authoritative, not broker-reconciled, not account truth, and not approved for risk-impact calculations.";
export const PINGAN_HISTORICAL_LIMITATION = "Approved only for last-imported and historical display context; no broker reconciliation, no account truth, no execution input, no accounting authority, and no cash, fee, or position mutation authority.";

export function historicalSnapshotFailClosed(
  status: Exclude<PinganSnapshotStatus, "available" | "stale">,
  requestedSymbol: string,
  message: string
): PinganSnapshotEnvelope {
  return {
    schemaVersion: PINGAN_SNAPSHOT_SCHEMA_VERSION,
    status,
    requestedSymbol,
    sourceSystem: null,
    sourceSnapshotId: null,
    sourceAsOf: null,
    importedAt: null,
    fetchedAt: null,
    freshness: null,
    limitation: PINGAN_HISTORICAL_LIMITATION,
    warning: null,
    positions: [],
    positionCount: 0,
    dataUse: {
      display: "blocked",
      riskImpact: "blocked",
      brokerReconciliation: "blocked",
      accountTruth: "blocked",
      accounting: "blocked",
      execution: "blocked"
    },
    safety: historicalSnapshotReadOnlySafety(),
    message
  };
}

export function historicalSnapshotReadOnlySafety(): PinganSnapshotEnvelope["safety"] {
  return {
    readOnly: true,
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false
  };
}
