import type { Pool, PoolClient } from "pg";
import type {
  PinganCurrentPortfolioEnvelope,
  PinganCurrentPortfolioHashInput
} from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import {
  computePinganCurrentPortfolioSnapshotId,
  PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION,
  PINGAN_CURRENT_PORTFOLIO_SOURCE_SYSTEM,
  PINGAN_DEVELOPMENT_AUTHORITY_SCOPE
} from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import { PINGAN_CURRENT_PORTFOLIO_READ_QUERY } from "./pinganCurrentPortfolioQuery.js";
import {
  currentPortfolioDataUse,
  currentPortfolioFailClosed,
  currentPortfolioSafety
} from "./pinganCurrentPortfolioEnvelope.js";
import { evaluatePinganPortfolioFreshness } from "./pinganFreshness.js";
import { isUnitInterval, toFiniteNumber, validIso } from "./pinganPortfolioRowValidation.js";

type CurrentPortfolioPosition = PinganCurrentPortfolioEnvelope["positions"][number];

export interface PinganCurrentPortfolioReadOptions {
  accountScopeId: string | null;
  tradingMaxAgeSeconds: number;
  now?: Date;
}

export async function readPinganCurrentPortfolioEnvelope(
  pool: Pick<Pool | PoolClient, "query">,
  options: PinganCurrentPortfolioReadOptions
): Promise<PinganCurrentPortfolioEnvelope> {
  const accountScopeId = options.accountScopeId?.trim() ?? "";
  if (!accountScopeId) {
    return currentPortfolioFailClosed("unauthorized", null, "Current Pingan portfolio account scope authorization is required.");
  }

  let result;
  try {
    result = await pool.query<CurrentPortfolioPositionRow>(
      PINGAN_CURRENT_PORTFOLIO_READ_QUERY,
      [accountScopeId]
    );
  } catch {
    return currentPortfolioFailClosed("unavailable", accountScopeId, "The approved Pingan current-portfolio boundary is unavailable.");
  }

  const first = result.rows[0];
  if (!first || first.boundary_ready !== true) {
    return currentPortfolioFailClosed("unavailable", accountScopeId, "The approved Pingan current-portfolio boundary is unavailable or unhealthy.");
  }
  if (first.conflict_reason) {
    const reasons = first.conflict_reason.split(",").filter(Boolean);
    const incompleteReasons = new Set([
      "incomplete_account_snapshot",
      "incomplete_batch_manifest"
    ]);
    const conflicts = reasons.filter((reason) => !incompleteReasons.has(reason));
    if (conflicts.length > 0) {
      return currentPortfolioFailClosed("conflict", accountScopeId, `Pingan account snapshot conflict: ${conflicts.join(",")}.`);
    }
    return currentPortfolioFailClosed(
      "unavailable",
      accountScopeId,
      "The latest Pingan import batch does not prove complete coverage of all account holdings; partial portfolio data and risk-impact calculation are blocked."
    );
  }
  const rows = result.rows.filter((row) => row.market !== null);
  if (rows.length === 0) {
    return emptyCurrentPortfolio(first, accountScopeId, options.tradingMaxAgeSeconds, options.now ?? new Date());
  }

  const now = options.now ?? new Date();
  const approved: ApprovedCurrentPortfolioRow[] = [];
  for (const row of rows) {
    const checked = approveCurrentPortfolioRow(row, accountScopeId, now);
    if (!checked.ok) {
      const status = checked.reason === "account_scope_mismatch" ? "unauthorized"
        : checked.reason === "identity_conflict" || checked.reason === "batch_conflict" || checked.reason === "provenance_conflict" ? "conflict"
          : "unavailable";
      return currentPortfolioFailClosed(status, accountScopeId, `Pingan account snapshot rejected: ${checked.reason}.`);
    }
    approved.push(checked.row);
  }

  const sourceKeys = new Set(approved.map(currentPortfolioSourceKey));
  if (sourceKeys.size !== 1) {
    return currentPortfolioFailClosed("conflict", accountScopeId, "Pingan positions do not share one account snapshot identity and time.");
  }
  const symbols = new Set<string>();
  for (const row of approved) {
    if (symbols.has(row.position.symbol)) {
      return currentPortfolioFailClosed("conflict", accountScopeId, `Duplicate Pingan position for ${row.position.symbol}.`);
    }
    symbols.add(row.position.symbol);
  }

  const source = approved[0];
  const freshness = evaluatePinganPortfolioFreshness(new Date(source.sourceAsOf), now, {
    tradingMaxAgeSeconds: options.tradingMaxAgeSeconds
  });
  const status = freshness.state;
  const positions = approved.map((row) => row.position);
  const base: PinganCurrentPortfolioHashInput = {
    schemaVersion: PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION,
    status,
    authorityScope: PINGAN_DEVELOPMENT_AUTHORITY_SCOPE,
    accountScopeId,
    sourceSystem: PINGAN_CURRENT_PORTFOLIO_SOURCE_SYSTEM,
    sourceBatchId: source.sourceBatchId,
    sourceAsOf: source.sourceAsOf,
    importedAt: source.importedAt,
    fetchedAt: source.fetchedAt,
    freshness,
    positions,
    positionCount: positions.length,
    dataUse: currentPortfolioDataUse(status),
    safety: currentPortfolioSafety(),
    message: status === "current"
      ? "Pingan account snapshot is current for local investment-decision assistance."
      : "Pingan account snapshot is stale; display remains available with warning and risk-impact calculation is blocked."
  };
  return {
    ...base,
    snapshotId: computePinganCurrentPortfolioSnapshotId(base)
  };
}

function emptyCurrentPortfolio(
  row: CurrentPortfolioPositionRow,
  accountScopeId: string,
  tradingMaxAgeSeconds: number,
  now: Date
): PinganCurrentPortfolioEnvelope {
  if (row.validated_account_scope_id !== accountScopeId) {
    return currentPortfolioFailClosed(
      row.validated_account_scope_id === null ? "unavailable" : "unauthorized",
      accountScopeId,
      "No validated zero-position Pingan account snapshot is available."
    );
  }
  const sourceBatchId = row.validated_batch_id?.trim() ?? "";
  const sourceAsOf = validIso(row.validated_source_as_of);
  const importedAt = validIso(row.validated_imported_at);
  const fetchedAt = validIso(row.validated_fetched_at);
  if (!sourceBatchId || !sourceAsOf || !importedAt || !fetchedAt) {
    return currentPortfolioFailClosed("unavailable", accountScopeId, "No validated zero-position Pingan account snapshot is available.");
  }
  if (Date.parse(sourceAsOf) > Date.parse(fetchedAt)
    || [sourceAsOf, importedAt, fetchedAt].some((value) => Date.parse(value) > now.getTime())) {
    return currentPortfolioFailClosed("conflict", accountScopeId, "The zero-position Pingan snapshot has conflicting provenance.");
  }

  const freshness = evaluatePinganPortfolioFreshness(new Date(sourceAsOf), now, { tradingMaxAgeSeconds });
  const status = freshness.state === "current" ? "zero_position" : "stale";
  const base: PinganCurrentPortfolioHashInput = {
    schemaVersion: PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION,
    status,
    authorityScope: PINGAN_DEVELOPMENT_AUTHORITY_SCOPE,
    accountScopeId,
    sourceSystem: PINGAN_CURRENT_PORTFOLIO_SOURCE_SYSTEM,
    sourceBatchId,
    sourceAsOf,
    importedAt,
    fetchedAt,
    freshness,
    positions: [],
    positionCount: 0,
    dataUse: currentPortfolioDataUse(status),
    safety: currentPortfolioSafety(),
    message: status === "zero_position"
      ? "The current Pingan account snapshot confirms zero positions for local investment-decision assistance."
      : "The Pingan account snapshot confirms zero positions but is stale; display remains available with warning and risk-impact calculation is blocked."
  };
  return {
    ...base,
    snapshotId: computePinganCurrentPortfolioSnapshotId(base)
  };
}

function approveCurrentPortfolioRow(
  row: CurrentPortfolioPositionRow,
  accountScopeId: string,
  now: Date
): { ok: true; row: ApprovedCurrentPortfolioRow } | { ok: false; reason: string } {
  if (row.account_scope_id !== accountScopeId) return { ok: false, reason: "account_scope_mismatch" };
  if (row.source_system !== PINGAN_CURRENT_PORTFOLIO_SOURCE_SYSTEM || row.source_class !== "owner_selected_imported_snapshot") {
    return { ok: false, reason: "unapproved_source" };
  }
  if (row.source_label && /sample|fixture|migrated|shadow|quant|research|unknown-stale/i.test(row.source_label)) {
    return { ok: false, reason: "unapproved_source" };
  }
  if (row.market !== "HK" || !row.code || !/^\d{5}$/.test(row.code) || row.symbol !== `HK.${row.code}`) {
    return { ok: false, reason: "identity_conflict" };
  }
  const sourceRowId = row.source_row_id;
  if (!sourceRowId) return { ok: false, reason: "batch_conflict" };
  const batchMatch = sourceRowId.match(/^broker_import_batches:([^/]+)\/broker_trades:\d+\/position_snapshots:[^/]+$/);
  if (!batchMatch) return { ok: false, reason: "batch_conflict" };
  const sourceAsOf = validIso(row.source_as_of);
  const importedAt = validIso(row.imported_at);
  // fetchedAt is position_snapshots.created_at; importedAt is the independent import-batch clock.
  const fetchedAt = validIso(row.fetched_at);
  if (!sourceAsOf || !importedAt || !fetchedAt) return { ok: false, reason: "missing_provenance" };
  if (Date.parse(sourceAsOf) > Date.parse(fetchedAt)
    || Date.parse(sourceAsOf) > now.getTime()
    || Date.parse(importedAt) > now.getTime()
    || Date.parse(fetchedAt) > now.getTime()) {
    return { ok: false, reason: "provenance_conflict" };
  }
  const quantity = toFiniteNumber(row.quantity);
  if (quantity === null || quantity <= 0) return { ok: false, reason: "malformed_position" };
  const averageCost = toFiniteNumber(row.average_cost);
  const currentWeight = toFiniteNumber(row.current_weight);
  const maxWeight = toFiniteNumber(row.max_weight);
  const unrealizedPnl = toFiniteNumber(row.unrealized_pnl);
  if (row.currency !== "HKD"
    || averageCost !== null && averageCost < 0
    || currentWeight !== null && !isUnitInterval(currentWeight)
    || maxWeight !== null && !isUnitInterval(maxWeight)
    || row.average_cost !== null && averageCost === null
    || row.current_weight !== null && currentWeight === null
    || row.max_weight !== null && maxWeight === null
    || row.unrealized_pnl !== null && unrealizedPnl === null) {
    return { ok: false, reason: "malformed_position" };
  }
  const position: CurrentPortfolioPosition = {
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    sourceRowId,
    name: row.name,
    quantity,
    averageCost,
    currentWeight,
    maxWeight,
    unrealizedPnl,
    currency: row.currency
  };
  return {
    ok: true,
    row: {
      accountScopeId,
      sourceBatchId: batchMatch[1],
      sourceAsOf,
      importedAt,
      fetchedAt,
      position
    }
  };
}

function currentPortfolioSourceKey(row: ApprovedCurrentPortfolioRow): string {
  return `${row.accountScopeId}|${row.sourceBatchId}|${row.sourceAsOf}|${row.importedAt}|${row.fetchedAt}`;
}

interface ApprovedCurrentPortfolioRow {
  accountScopeId: string;
  sourceBatchId: string;
  sourceAsOf: string;
  importedAt: string;
  fetchedAt: string;
  position: CurrentPortfolioPosition;
}

interface CurrentPortfolioPositionRow {
  market: string | null;
  code: string | null;
  symbol: string | null;
  name: string | null;
  quantity: string | null;
  average_cost: string | null;
  current_weight: string | null;
  max_weight: string | null;
  unrealized_pnl: string | null;
  status: string | null;
  source_as_of: string | null;
  imported_at: string | null;
  fetched_at: string | null;
  account_scope_id: string | null;
  source_system: string | null;
  source_class: string | null;
  source_label: string | null;
  currency: string | null;
  source_row_id: string | null;
  updated_at: string | null;
  validated_batch_id: string | null;
  validated_account_scope_id: string | null;
  validated_source_as_of: string | null;
  validated_imported_at: string | null;
  validated_fetched_at: string | null;
  validated_snapshot_group_id: string | null;
  boundary_ready: boolean;
  conflict_reason: string | null;
}
