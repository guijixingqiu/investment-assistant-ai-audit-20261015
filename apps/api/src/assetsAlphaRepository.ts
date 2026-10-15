import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ASSETS_ALPHA_SCHEMA_VERSION,
  type AssetsAlphaEnvelope,
  type AssetsAlphaSnapshot,
  type AssetsAlphaSnapshotWriteResponse,
  type AssetsAlphaTrade,
  type AssetsAlphaTradeWriteResponse,
  type CreateAssetsAlphaSnapshotRequest,
  type CreateAssetsAlphaTradeRequest
} from "../../../packages/contracts/src/assetsAlpha.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { requestFingerprint } from "./research/deepResearchGate.js";
import { IdempotencyConflictError, type AuthenticatedResearchActor } from "./research/domain.js";
import { isUniqueViolation } from "./research/writePersistence.js";

interface SnapshotRow {
  id: string;
  source: CreateAssetsAlphaSnapshotRequest["source"];
  as_of: Date | string;
  cash_hkd: number | string | null;
  positions: AssetsAlphaSnapshot["positions"];
  owner_confirmed: boolean;
  source_hash: string;
  created_at: Date | string;
}

interface TradeRow {
  id: string;
  symbol: string;
  side: CreateAssetsAlphaTradeRequest["side"];
  quantity: number | string;
  price_hkd: number | string;
  occurred_at: Date | string;
  note: string | null;
  owner_confirmed: boolean;
  source_hash: string;
  created_at: Date | string;
}

interface SnapshotReplayRow extends SnapshotRow {
  request_fingerprint: string;
}

interface TradeReplayRow extends TradeRow {
  request_fingerprint: string;
}

export async function readAssetsAlphaEnvelope(
  pool: Pick<Pool, "query">,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<AssetsAlphaEnvelope> {
  const snapshotResult = await pool.query<SnapshotRow>(
    `select id::text, source, as_of, cash_hkd::float8 as cash_hkd, positions,
            owner_confirmed, source_hash, created_at
       from assets_alpha_snapshots
      where actor_type = $1 and actor_id = $2
      order by created_at desc, id desc
      limit 100`,
    [actor.actorType, actor.actorId]
  );
  const tradeResult = await pool.query<TradeRow>(
    `select id::text, symbol, side, quantity::float8 as quantity,
            price_hkd::float8 as price_hkd, occurred_at, note,
            owner_confirmed, source_hash, created_at
       from assets_alpha_trades
      where actor_type = $1 and actor_id = $2
      order by occurred_at desc, id desc
      limit 100`,
    [actor.actorType, actor.actorId]
  );
  const snapshots = snapshotResult.rows.map(mapSnapshot);
  // Current holdings remain reachable even after more than 100 research snapshots.
  // Preserve the bounded, newest-first history while retaining its latest current revision.
  if (snapshots.length === 100 && !snapshots.some(snapshot => snapshot.source === "owner_current")) {
    const current = await pool.query<SnapshotRow>(
      `select id::text, source, as_of, cash_hkd::float8 as cash_hkd, positions,
              owner_confirmed, source_hash, created_at
         from assets_alpha_snapshots
        where actor_type = $1 and actor_id = $2 and source = 'owner_current'
        order by created_at desc, id desc limit 1`,
      [actor.actorType, actor.actorId]);
    if (current.rows[0]) {
      snapshots.pop(); snapshots.push(mapSnapshot(current.rows[0]));
      // A concurrent current revision may have been created after the first history read.
      snapshots.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || (BigInt(left.id) > BigInt(right.id) ? -1 : BigInt(left.id) < BigInt(right.id) ? 1 : 0));
    }
  }
  return {
    schemaVersion: ASSETS_ALPHA_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    requestedActorId: actor.actorId,
    authority: {
      kind: "owner_entered_unofficial_local_alpha",
      official: false,
      production: false,
      currency: "HKD"
    },
    latestSnapshot: snapshots[0] ?? null,
    snapshots,
    trades: tradeResult.rows.map(mapTrade),
    safety: {
      advisoryOnly: true,
      createsOrder: false,
      callsBroker: false,
      mutatesOfficialPortfolio: false
    }
  };
}

export async function createAssetsAlphaSnapshot(
  pool: Pool,
  request: CreateAssetsAlphaSnapshotRequest,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<AssetsAlphaSnapshotWriteResponse> {
  if (actor.actorType !== "user") throw new Error("an explicit user actor is required");
  const fingerprint = requestFingerprint("assets_alpha_snapshot_create", { actor, request });
  const sourceHash = hashPayload({
    source: request.source,
    asOf: request.asOf,
    cashHkd: request.cashHkd,
    positions: request.positions,
    ownerConfirmed: request.ownerConfirmed
  });
  return createSnapshotInTransaction(pool, request, actor, fingerprint, sourceHash, now);
}

export async function createAssetsAlphaTrade(
  pool: Pool,
  request: CreateAssetsAlphaTradeRequest,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<AssetsAlphaTradeWriteResponse> {
  if (actor.actorType !== "user") throw new Error("an explicit user actor is required");
  const fingerprint = requestFingerprint("assets_alpha_trade_create", { actor, request });
  const sourceHash = hashPayload({
    symbol: request.symbol,
    side: request.side,
    quantity: request.quantity,
    priceHkd: request.priceHkd,
    occurredAt: request.occurredAt,
    note: request.note,
    ownerConfirmed: request.ownerConfirmed
  });
  return createTradeInTransaction(pool, request, actor, fingerprint, sourceHash, now);
}

async function createSnapshotInTransaction(
  pool: Pool,
  request: CreateAssetsAlphaSnapshotRequest,
  actor: AuthenticatedResearchActor,
  fingerprint: string,
  sourceHash: string,
  now: Date
): Promise<AssetsAlphaSnapshotWriteResponse> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findSnapshotReplay(client, actor, request.idempotencyKey);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint) throw idempotencyConflict();
      const response = await snapshotWriteResponse(client, actor, replay, now);
      await client.query("commit");
      return response;
    }
    if (request.source === "owner_current") {
      // Serialize only this actor's manual-current revisions, preserving append-only history.
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`owner-current:${actor.actorType}:${actor.actorId}`]);
      const lockedReplay = await findSnapshotReplay(client, actor, request.idempotencyKey);
      if (lockedReplay) {
        if (lockedReplay.request_fingerprint !== fingerprint) throw idempotencyConflict();
        const response = await snapshotWriteResponse(client, actor, lockedReplay, now);
        await client.query("commit"); return response;
      }
      const current = await client.query<{ id: string }>(
        "select id::text from assets_alpha_snapshots where actor_type=$1 and actor_id=$2 and source='owner_current' order by created_at desc,id desc limit 1",
        [actor.actorType, actor.actorId]);
      if ((current.rows[0]?.id ?? null) !== request.expectedSnapshotId) throw new IdempotencyConflictError("current holdings changed; reload before saving");
    }
    const inserted = await client.query<SnapshotRow>(
      `insert into assets_alpha_snapshots
         (actor_type, actor_id, source, as_of, cash_hkd, positions,
          owner_confirmed, idempotency_key, request_fingerprint, source_hash, created_at)
       values ($1, $2, $3, $4::timestamptz, $5, $6::jsonb,
               $7, $8, $9, $10, $11)
       returning id::text, source, as_of, cash_hkd::float8 as cash_hkd, positions,
                 owner_confirmed, source_hash, created_at`,
      [
        actor.actorType,
        actor.actorId,
        request.source,
        request.asOf,
        request.cashHkd,
        JSON.stringify(request.positions),
        request.ownerConfirmed,
        request.idempotencyKey,
        fingerprint,
        sourceHash,
        now
      ]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Assets Alpha snapshot insert returned no record");
    const response = await snapshotWriteResponse(client, actor, row, now);
    await client.query("commit");
    return response;
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findSnapshotReplay(pool, actor, request.idempotencyKey);
      if (replay?.request_fingerprint === fingerprint) return snapshotWriteResponse(pool, actor, replay, now);
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

async function createTradeInTransaction(
  pool: Pool,
  request: CreateAssetsAlphaTradeRequest,
  actor: AuthenticatedResearchActor,
  fingerprint: string,
  sourceHash: string,
  now: Date
): Promise<AssetsAlphaTradeWriteResponse> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findTradeReplay(client, actor, request.idempotencyKey);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint) throw idempotencyConflict();
      const response = await tradeWriteResponse(client, actor, replay, now);
      await client.query("commit");
      return response;
    }
    const inserted = await client.query<TradeRow>(
      `insert into assets_alpha_trades
         (actor_type, actor_id, symbol, side, quantity, price_hkd,
          occurred_at, note, owner_confirmed, idempotency_key, request_fingerprint,
          source_hash, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8,
               $9, $10, $11, $12, $13)
       returning id::text, symbol, side, quantity::float8 as quantity,
                 price_hkd::float8 as price_hkd, occurred_at, note,
                 owner_confirmed, source_hash, created_at`,
      [
        actor.actorType,
        actor.actorId,
        request.symbol,
        request.side,
        request.quantity,
        request.priceHkd,
        request.occurredAt,
        request.note,
        request.ownerConfirmed,
        request.idempotencyKey,
        fingerprint,
        sourceHash,
        now
      ]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Assets Alpha trade insert returned no record");
    const response = await tradeWriteResponse(client, actor, row, now);
    await client.query("commit");
    return response;
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findTradeReplay(pool, actor, request.idempotencyKey);
      if (replay?.request_fingerprint === fingerprint) return tradeWriteResponse(pool, actor, replay, now);
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

async function findSnapshotReplay(
  client: Pick<Pool | PoolClient, "query">,
  actor: AuthenticatedResearchActor,
  idempotencyKey: string
): Promise<SnapshotReplayRow | null> {
  const result = await client.query<SnapshotReplayRow>(
    `select id::text, source, as_of, cash_hkd::float8 as cash_hkd, positions,
            owner_confirmed, source_hash, created_at, request_fingerprint
       from assets_alpha_snapshots
      where actor_type = $1 and actor_id = $2 and idempotency_key = $3
      limit 1`,
    [actor.actorType, actor.actorId, idempotencyKey]
  );
  return result.rows[0] ?? null;
}

async function findTradeReplay(
  client: Pick<Pool | PoolClient, "query">,
  actor: AuthenticatedResearchActor,
  idempotencyKey: string
): Promise<TradeReplayRow | null> {
  const result = await client.query<TradeReplayRow>(
    `select id::text, symbol, side, quantity::float8 as quantity,
            price_hkd::float8 as price_hkd, occurred_at, note,
            owner_confirmed, source_hash, created_at, request_fingerprint
       from assets_alpha_trades
      where actor_type = $1 and actor_id = $2 and idempotency_key = $3
      limit 1`,
    [actor.actorType, actor.actorId, idempotencyKey]
  );
  return result.rows[0] ?? null;
}

async function snapshotWriteResponse(
  client: Pick<Pool | PoolClient, "query">,
  actor: AuthenticatedResearchActor,
  row: SnapshotRow,
  now: Date
): Promise<AssetsAlphaSnapshotWriteResponse> {
  return { createdRecord: mapSnapshot(row), envelope: await readAssetsAlphaEnvelope(client, actor, now) };
}

async function tradeWriteResponse(
  client: Pick<Pool | PoolClient, "query">,
  actor: AuthenticatedResearchActor,
  row: TradeRow,
  now: Date
): Promise<AssetsAlphaTradeWriteResponse> {
  return { createdRecord: mapTrade(row), envelope: await readAssetsAlphaEnvelope(client, actor, now) };
}

function mapSnapshot(row: SnapshotRow): AssetsAlphaSnapshot {
  return {
    id: row.id,
    source: row.source,
    asOf: asDate(row.as_of),
    cashHkd: nullableNumber(row.cash_hkd),
    positions: row.positions,
    ownerConfirmed: confirmed(row.owner_confirmed),
    sourceHash: row.source_hash,
    createdAt: asDate(row.created_at)
  };
}

function mapTrade(row: TradeRow): AssetsAlphaTrade {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    quantity: Number(row.quantity),
    priceHkd: Number(row.price_hkd),
    occurredAt: asDate(row.occurred_at),
    note: row.note,
    ownerConfirmed: confirmed(row.owner_confirmed),
    sourceHash: row.source_hash,
    createdAt: asDate(row.created_at)
  };
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function asDate(value: Date | string): string {
  return new Date(value).toISOString();
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function confirmed(value: boolean): true {
  if (!value) throw new Error("Assets Alpha owner confirmation is invalid");
  return true;
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key already exists with a different Assets Alpha payload");
}
