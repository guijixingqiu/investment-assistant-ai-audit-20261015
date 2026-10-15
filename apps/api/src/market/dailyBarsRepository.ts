import type { Pool, PoolClient } from "pg";
import {
  dailyTechnicalStateStatus,
  sha256Canonical,
  validateDailyTechnicalEnvelope,
  type DailyTechnicalEnvelope
} from "../../../../packages/contracts/src/marketDaily.js";
import { calculateTechnicalAnalysis } from "./technicalIndicators.js";
import { hkex2026CompletedSessionEvidence } from "./hkexCompletedSessions.js";

interface StoredDailyTechnicalRow {
  market: string;
  code: string;
  symbol: string;
  status: string;
  snapshot_sha: string | null;
  result_hash: string | null;
  envelope_payload: unknown;
}

export async function readLatestDailyTechnicalSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  cutoff: string
): Promise<DailyTechnicalEnvelope | null> {
  if (market !== "HK" || !/^\d{5}$/.test(code) || !validCalendarDate(cutoff)) return null;
  const identity = { market, code, symbol: `HK.${code}` };
  const result = await pool.query<StoredDailyTechnicalRow>(
    `select market, code, symbol, status, snapshot_sha, result_hash, envelope_payload
       from market_daily_snapshot_states
      where market = $1 and code = $2
        and envelope_payload->'dailyBars'->'request'->>'cutoff' = $3
      order by updated_at desc, id desc
      limit 1`,
    [identity.market, identity.code, cutoff]
  );
  return storedDailyTechnical(result.rows[0], identity, cutoff, false);
}

export async function readLatestLastValidDailyTechnicalSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  cutoff: string
): Promise<DailyTechnicalEnvelope | null> {
  if (market !== "HK" || !/^\d{5}$/.test(code) || !validCalendarDate(cutoff)) return null;
  const identity = { market, code, symbol: `HK.${code}` };
  const result = await pool.query<StoredDailyTechnicalRow>(
    `select market, code, symbol, status, snapshot_sha, result_hash, envelope_payload
       from market_daily_snapshot_states
      where market = $1 and code = $2 and status = 'available'
        and envelope_payload->'dailyBars'->'request'->>'cutoff' < $3
      order by envelope_payload->'dailyBars'->'request'->>'cutoff' desc, updated_at desc, id desc
      limit 1`,
    [identity.market, identity.code, cutoff]
  );
  const stored = storedDailyTechnical(result.rows[0], identity, cutoff, true);
  if (!stored?.usableForRequestedCutoff || !stored.dailyBars.snapshot) return null;
  const observedCutoff = stored.dailyBars.request.cutoff;
  const lastSession = stored.dailyBars.snapshot.lastCompletedSession;
  const message = `上次有效日线截至 ${lastSession}；当前请求截止 ${cutoff}，未把旧数据当作实时结果。`;
  const fallback: DailyTechnicalEnvelope = {
    ...stored,
    dailyBars: {
      ...stored.dailyBars,
      metadata: {
        ...stored.dailyBars.metadata,
        message
      },
      message: `${message} 原数据请求截止 ${observedCutoff}。`
    }
  };
  return validateDailyTechnicalEnvelope(fallback).ok ? fallback : null;
}

function storedDailyTechnical(
  row: StoredDailyTechnicalRow | undefined,
  identity: { market: string; code: string; symbol: string },
  cutoff: string,
  allowsEarlierCutoff: boolean
): DailyTechnicalEnvelope | null {
  if (!row) return null;
  const envelope = row.envelope_payload;
  const validation = validateDailyTechnicalEnvelope(envelope);
  if (!validation.ok) return null;
  const typed = envelope as DailyTechnicalEnvelope;
  const daily = typed.dailyBars;
  const technical = typed.technical;
  if (row.market !== identity.market || row.code !== identity.code || row.symbol !== identity.symbol
    || daily.request.market !== identity.market || daily.request.code !== identity.code
    || daily.request.symbol !== identity.symbol
    || (allowsEarlierCutoff ? daily.request.cutoff >= cutoff : daily.request.cutoff !== cutoff)
    || row.status !== dailyTechnicalStateStatus(typed)
    || row.snapshot_sha !== (daily.snapshot?.snapshotSha ?? null)
    || row.result_hash !== technical.resultHash) {
    return null;
  }
  if (typed.usableForRequestedCutoff) {
    const recomputed = calculateTechnicalAnalysis(daily);
    if (recomputed.status !== "available"
      || recomputed.resultHash !== row.result_hash
      || sha256Canonical(recomputed) !== sha256Canonical(technical)) {
      return null;
    }
  }
  return typed;
}

export async function persistDailyTechnicalSnapshot(
  pool: Pick<Pool, "connect">,
  envelope: DailyTechnicalEnvelope
): Promise<void> {
  const validation = validateDailyTechnicalEnvelope(envelope);
  const daily = envelope.dailyBars;
  const snapshot = daily.snapshot;
  const technical = envelope.technical;
  if (!validation.ok || !envelope.usableForRequestedCutoff || !snapshot || !technical.resultHash) {
    throw new TypeError("only a complete contract-valid daily technical snapshot may be persisted");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into market_daily_snapshots (
         snapshot_sha, market, code, symbol, timeframe, completed_sessions_only,
         adjustment, minimum_bars, target_bars, cutoff, provider, source_endpoint,
         fetched_at, provider_cutoff, data_cutoff_at, last_completed_session,
         calendar_id, calendar_version, calendar_timezone, rights_status,
         retention_status, derived_use_status, hash_method, raw_bytes_captured,
         source_content_hash, data_hash, page_content_hashes, bar_count,
         first_session, last_session, quality_payload, snapshot_payload
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16,
         $17, $18, $19, $20,
         $21, $22, $23, $24,
         $25, $26, $27::jsonb, $28,
         $29, $30, $31::jsonb, $32::jsonb
       ) on conflict (snapshot_sha) do nothing`,
      [
        snapshot.snapshotSha, daily.request.market, daily.request.code, daily.request.symbol,
        daily.request.timeframe, daily.request.completedSessionsOnly, daily.request.adjustment,
        daily.request.minimumBars, daily.request.targetBars, daily.request.cutoff,
        daily.source.provider, daily.source.endpoint, daily.source.fetchedAt,
        daily.source.providerCutoff, daily.source.dataCutoffAt, snapshot.lastCompletedSession,
        snapshot.calendar.id, snapshot.calendar.version, snapshot.calendar.timezone,
        daily.source.rights, daily.source.retention, daily.source.derivedUse,
        daily.source.hashMethod, daily.source.rawBytesCaptured, daily.source.sourceContentHash,
        snapshot.dataHash, JSON.stringify(daily.source.pageContentHashes), snapshot.barCount,
        snapshot.firstSession, snapshot.lastSession, JSON.stringify(snapshot.quality),
        JSON.stringify(snapshot)
      ]
    );
    await client.query(
      `insert into market_daily_bars (
         snapshot_sha, session, open, high, low, close, volume, turnover, suspension
       ) select $1, bar.session::date, bar.open, bar.high, bar.low, bar.close,
                bar.volume, bar.turnover, bar.suspension
           from jsonb_to_recordset($2::jsonb) as bar(
             session text, open numeric, high numeric, low numeric, close numeric,
             volume numeric, turnover numeric, suspension boolean
           )
       on conflict (snapshot_sha, session) do nothing`,
      [snapshot.snapshotSha, JSON.stringify(snapshot.bars)]
    );
    await client.query(
      `insert into market_technical_snapshots (
         result_hash, input_snapshot_sha, computation_version, parameters_payload,
         data_cutoff_at, result_payload
       ) values ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
       on conflict (result_hash) do nothing`,
      [
        technical.resultHash, snapshot.snapshotSha, technical.computationVersion,
        JSON.stringify(technical.parameters), technical.dataCutoffAt, JSON.stringify(technical)
      ]
    );
    await client.query(
      `insert into market_daily_snapshot_states (
         market, code, symbol, status, snapshot_sha, result_hash, message, envelope_payload
       ) select $1, $2, $3, $4, $5, $6, $7, $8::jsonb
        where not exists (
          select 1 from market_daily_snapshot_states
           where market = $1 and code = $2 and snapshot_sha = $5 and result_hash = $6
        )`,
      [
        daily.request.market, daily.request.code, daily.request.symbol,
        dailyTechnicalStateStatus(envelope), snapshot.snapshotSha, technical.resultHash,
        daily.message, JSON.stringify(envelope)
      ]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function currentHongKongDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new TypeError("now must be a valid instant");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function latestCompletedHongKongSession(now: Date): string {
  return hkex2026CompletedSessionEvidence(currentHongKongDate(now), now).lastCompletedSession;
}
