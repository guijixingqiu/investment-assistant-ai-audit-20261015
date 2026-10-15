import type { Pool } from "pg";
import type {
  PinganSnapshotEnvelope,
  PinganSnapshotHashInput,
  PinganSnapshotPositionData
} from "../../../../packages/contracts/src/portfolioSnapshot.js";
import {
  computePinganSnapshotId,
  PINGAN_SNAPSHOT_SCHEMA_VERSION,
  PINGAN_SNAPSHOT_SOURCE_SYSTEM
} from "../../../../packages/contracts/src/portfolioSnapshot.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  historicalSnapshotFailClosed as failClosed,
  historicalSnapshotReadOnlySafety as readOnlySafety,
  PINGAN_HISTORICAL_LIMITATION as LIMITATION,
  PINGAN_LAST_IMPORTED_WARNING as LAST_IMPORTED_WARNING
} from "./pinganHistoricalSnapshotEnvelope.js";
import { isUnitInterval, toFiniteNumber, validIso } from "./pinganPortfolioRowValidation.js";

export interface PinganSnapshotReadOptions {
  accountScopeId: string | null;
  now?: Date;
}

export async function readPinganSnapshotEnvelope(
  pool: Pool,
  market: string,
  code: string,
  options: PinganSnapshotReadOptions
): Promise<PinganSnapshotEnvelope> {
  const normalized = normalizeMarketCode(market, code);
  const accountScopeId = options.accountScopeId?.trim() ?? "";
  if (!accountScopeId) {
    return failClosed("unauthorized", normalized.symbol, "Portfolio snapshot account scope authorization is required.");
  }

  const boundary = await pinganBoundaryAvailable(pool);
  if (!boundary) {
    return failClosed("unavailable", normalized.symbol, "Approved Pingan snapshot application boundary is unavailable or unhealthy, so no positions are returned.");
  }

  const conflict = await readPinganBoundaryConflict(pool, accountScopeId);
  if (conflict) {
    return failClosed("source_conflict", normalized.symbol, `Pingan snapshot boundary conflict: ${conflict}.`);
  }

  const result = await pool.query<PortfolioPositionRow>(
    `select market, code, symbol, name, quantity, average_cost,
            current_weight, max_weight, unrealized_pnl, status,
            source_as_of, imported_at, fetched_at, account_scope_id,
            source_system, source_class, source_label, currency, source_row_id,
            updated_at
       from pingan_imported_snapshot_positions
      where market = $1
        and code = $2
        and account_scope_id = $3
        and status = 'holding'
      order by source_as_of desc, imported_at desc, fetched_at desc, source_row_id desc
      limit 20`,
    [normalized.market, normalized.code, accountScopeId]
  );

  if (result.rows.length === 0) {
    return failClosed("empty", normalized.symbol, `No approved Pingan imported snapshot position for ${normalized.symbol}.`);
  }

  const approvedRows: ApprovedPortfolioRow[] = [];
  const rejectionReasons = new Set<string>();
  const now = options.now ?? new Date();
  for (const row of result.rows) {
    const approved = approveRow(row, accountScopeId, normalized.symbol, now);
    if (approved.ok) approvedRows.push(approved.row);
    else rejectionReasons.add(approved.reason);
  }

  if (approvedRows.length === 0) {
    if (rejectionReasons.has("account_scope_mismatch")) {
      return failClosed("unauthorized", normalized.symbol, "Portfolio snapshot account scope is not authorized for this request.");
    }
    if (rejectionReasons.has("unapproved_source")) {
      return failClosed("not_approved", normalized.symbol, "Rows for this symbol are not approved Pingan imported snapshot facts.");
    }
    if (rejectionReasons.has("provenance_conflict")) {
      return failClosed("source_conflict", normalized.symbol, "Pingan snapshot provenance is reversed or lies in the future, so no positions are returned.");
    }
    return failClosed("unavailable", normalized.symbol, "Pingan snapshot provenance is incomplete, so no positions are returned.");
  }

  const sourceKeys = new Set(approvedRows.map((row) => sourceConflictKey(row)));
  if (sourceKeys.size !== 1) {
    return failClosed("source_conflict", normalized.symbol, "Conflicting Pingan snapshot identities or times were found, so no positions are returned.");
  }

  if (approvedRows.length !== 1) {
    const quantities = new Set(approvedRows.map((row) => row.position.quantity));
    const reason = quantities.size === 1
      ? "Duplicate Pingan snapshot positions conflict for this symbol."
      : "Same-snapshot Pingan positions have conflicting quantities for this symbol.";
    return failClosed("source_conflict", normalized.symbol, reason);
  }

  const source = approvedRows[0];
  const positions = approvedRows.map((row) => row.position);
  const base: PinganSnapshotHashInput = {
    schemaVersion: PINGAN_SNAPSHOT_SCHEMA_VERSION,
    status: "stale",
    requestedSymbol: normalized.symbol,
    sourceSystem: PINGAN_SNAPSHOT_SOURCE_SYSTEM,
    sourceAsOf: source.sourceAsOf,
    importedAt: source.importedAt,
    fetchedAt: source.fetchedAt,
    freshness: "historical",
    limitation: LIMITATION,
    warning: LAST_IMPORTED_WARNING,
    positions,
    positionCount: positions.length,
    dataUse: {
      display: "allowed_with_warning",
      riskImpact: "blocked_stale_historical_only",
      brokerReconciliation: "blocked_not_live_authoritative",
      accountTruth: "blocked_not_live_authoritative",
      accounting: "blocked_not_accounting_authority",
      execution: "blocked_not_execution_input"
    },
    safety: readOnlySafety(),
    message: `Last imported Pingan snapshot for ${normalized.symbol}; display only with warning.`
  };
  const sourceSnapshotId = computePinganSnapshotId(base);
  return {
    ...base,
    sourceSnapshotId
  };
}

async function pinganBoundaryAvailable(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query<{ ready: boolean }>(
      `select exists (
         select 1
           from information_schema.views
          where table_schema = current_schema()
            and table_name = 'pingan_imported_snapshot_positions'
       ) and coalesce((
         select source_tables_available
           from pingan_imported_snapshot_boundary_health
          limit 1
       ), false) as ready`
    );
    return result.rows[0]?.ready === true;
  } catch {
    return false;
  }
}

async function readPinganBoundaryConflict(pool: Pool, accountScopeId: string): Promise<string | null> {
  try {
    const result = await pool.query<{ conflict_reason: string }>(
      `select conflict_reason
       from pingan_imported_snapshot_conflicts
        where account_scope_id = $1
        limit 1`,
      [accountScopeId]
    );
    return result.rows[0]?.conflict_reason ?? null;
  } catch {
    return "conflict_query_failed";
  }
}

function approveRow(
  row: PortfolioPositionRow,
  accountScopeId: string,
  requestedSymbol: string,
  now: Date
): { ok: true; row: ApprovedPortfolioRow } | { ok: false; reason: string } {
  const sourceSystem = row.source_system;
  const sourceClass = row.source_class;
  const sourceLabel = row.source_label;
  if (sourceSystem !== PINGAN_SNAPSHOT_SOURCE_SYSTEM || sourceClass !== "owner_selected_imported_snapshot") {
    return { ok: false, reason: "unapproved_source" };
  }
  if (sourceLabel && /sample|fixture|migrated|shadow|quant|research|unknown-stale/i.test(sourceLabel)) {
    return { ok: false, reason: "unapproved_source" };
  }

  const rowAccountScopeId = row.account_scope_id;
  if (!rowAccountScopeId || rowAccountScopeId !== accountScopeId) return { ok: false, reason: "account_scope_mismatch" };
  const [requestedMarket, requestedCode] = requestedSymbol.split(".");
  if (row.market !== requestedMarket || row.code !== requestedCode || row.symbol !== requestedSymbol) {
    return { ok: false, reason: "ambiguous_symbol" };
  }

  const sourceAsOf = validIso(row.source_as_of);
  const importedAt = validIso(row.imported_at);
  const fetchedAt = validIso(row.fetched_at);
  if (!sourceAsOf || !importedAt || !fetchedAt) return { ok: false, reason: "missing_provenance_time" };
  if (Date.parse(sourceAsOf) > Date.parse(fetchedAt)
    || Date.parse(sourceAsOf) > now.getTime()
    || Date.parse(importedAt) > now.getTime()
    || Date.parse(fetchedAt) > now.getTime()) {
    return { ok: false, reason: "provenance_conflict" };
  }

  const quantity = toFiniteNumber(row.quantity);
  const averageCost = toFiniteNumber(row.average_cost);
  const currentWeight = toFiniteNumber(row.current_weight);
  const maxWeight = toFiniteNumber(row.max_weight);
  const unrealizedPnl = toFiniteNumber(row.unrealized_pnl);
  if (quantity === null || quantity <= 0
    || row.currency !== "HKD"
    || !row.source_row_id
    || averageCost !== null && averageCost < 0
    || currentWeight !== null && !isUnitInterval(currentWeight)
    || maxWeight !== null && !isUnitInterval(maxWeight)
    || row.average_cost !== null && averageCost === null
    || row.current_weight !== null && currentWeight === null
    || row.max_weight !== null && maxWeight === null
    || row.unrealized_pnl !== null && unrealizedPnl === null) {
    return { ok: false, reason: "malformed_position" };
  }

  return {
    ok: true,
    row: {
      sourceAsOf,
      importedAt,
      fetchedAt,
      position: {
        market: row.market,
        code: row.code,
        symbol: row.symbol,
        sourceRowId: row.source_row_id,
        name: row.name,
        quantity,
        averageCost,
        currentWeight,
        maxWeight,
        unrealizedPnl,
        currency: row.currency
      }
    }
  };
}

function sourceConflictKey(row: ApprovedPortfolioRow): string {
  return `${row.sourceAsOf}|${row.importedAt ?? ""}|${row.fetchedAt ?? ""}`;
}

interface ApprovedPortfolioRow {
  sourceAsOf: string;
  importedAt: string | null;
  fetchedAt: string | null;
  position: PinganSnapshotPositionData;
}

interface PortfolioPositionRow {
  market: string;
  code: string;
  symbol: string;
  name: string | null;
  quantity: string;
  average_cost: string | null;
  current_weight: string | null;
  max_weight: string | null;
  unrealized_pnl: string | null;
  status: string;
  source_as_of: string;
  imported_at: string | null;
  fetched_at: string | null;
  account_scope_id: string;
  source_system: string;
  source_class: string;
  source_label: string | null;
  currency: string | null;
  source_row_id: string;
  updated_at: string;
}
