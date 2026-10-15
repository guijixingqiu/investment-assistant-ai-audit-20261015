import type { Pool, PoolClient } from "pg";
import {
  frozenWeinsteinEvidenceBinding,
  validateWeinsteinTechnicalAnalysisEnvelope,
  type FrozenWeinsteinEvidenceBinding,
  type WeinsteinTechnicalAnalysisEnvelope
} from "../../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { sha256Canonical } from "../../../../packages/contracts/src/marketDaily.js";

export interface PendingWeinsteinStructureChange {
  id: string;
  version: number;
  fingerprint: string;
  priority: "action" | "high" | "medium";
  title: string;
  summary: string;
}

interface SnapshotRow {
  id: string;
  envelope_payload: unknown;
}

export async function persistWeinsteinTechnicalSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  envelope: WeinsteinTechnicalAnalysisEnvelope
): Promise<void> {
  const validation = validateWeinsteinTechnicalAnalysisEnvelope(envelope, {
    symbol: envelope.symbol,
    analysisAsOf: envelope.analysisAsOf
  });
  if (!validation.ok || envelope.status !== "available" || !envelope.completedWeekEnd
    || !envelope.resultHash || !envelope.inputHash || !envelope.datasetHash) {
    throw new TypeError("only a contract-valid available Weinstein snapshot may be persisted");
  }
  await pool.query(
    `insert into weinstein_technical_snapshots (
       symbol, analysis_as_of, completed_week_end, result_hash, input_hash, dataset_hash, envelope_payload
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (result_hash) do nothing`,
    [envelope.symbol, envelope.analysisAsOf, envelope.completedWeekEnd, envelope.resultHash,
      envelope.inputHash, envelope.datasetHash, JSON.stringify(envelope)]
  );
}

export async function readLatestWeinsteinEvidenceBinding(
  pool: Pick<Pool | PoolClient, "query">,
  symbol: string,
  analysisAsOf: string
): Promise<FrozenWeinsteinEvidenceBinding | null> {
  if (!/^HK\.\d{5}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(analysisAsOf)) return null;
  const result = await pool.query<SnapshotRow>(
    `select id::text, envelope_payload
       from weinstein_technical_snapshots
      where symbol = $1 and analysis_as_of <= $2::date
      order by analysis_as_of desc, id desc
      limit 1`,
    [symbol, analysisAsOf]
  );
  const snapshot = result.rows[0] ? typedSnapshot(result.rows[0].envelope_payload, symbol) : null;
  return snapshot ? frozenWeinsteinEvidenceBinding(snapshot) : null;
}

/** Read a full previously saved weekly envelope at its exact analysis date. */
export async function readExactWeinsteinTechnicalSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  symbol: string,
  analysisAsOf: string
): Promise<WeinsteinTechnicalAnalysisEnvelope | null> {
  if (!/^HK\.\d{5}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(analysisAsOf)) return null;
  const result = await pool.query<SnapshotRow>(
    `select id::text, envelope_payload
       from weinstein_technical_snapshots
      where symbol = $1 and analysis_as_of = $2::date
      order by id desc limit 1`,
    [symbol, analysisAsOf]
  );
  const snapshot = result.rows[0] ? typedSnapshot(result.rows[0].envelope_payload, symbol) : null;
  return snapshot?.analysisAsOf === analysisAsOf ? snapshot : null;
}

export async function readPendingWeinsteinStructureChange(
  pool: Pick<Pool | PoolClient, "query">,
  symbol: string,
  frozen: FrozenWeinsteinEvidenceBinding | null
): Promise<PendingWeinsteinStructureChange | null> {
  if (!/^HK\.\d{5}$/.test(symbol) || !frozen || frozen.symbol !== symbol) return null;
  const result = await pool.query<SnapshotRow>(
    `select id::text, envelope_payload
       from weinstein_technical_snapshots
      where symbol = $1 and (result_hash = $2 or id = (
        select id from weinstein_technical_snapshots where symbol = $1 order by analysis_as_of desc, id desc limit 1
      ))
      order by analysis_as_of desc, id desc`,
    [symbol, frozen.resultHash]
  );
  const currentRow = result.rows[0];
  const frozenRow = result.rows.find((row) => isSnapshot(row.envelope_payload, symbol, frozen.resultHash));
  if (!currentRow || !frozenRow) return null;
  const current = typedSnapshot(currentRow.envelope_payload, symbol);
  const previous = typedSnapshot(frozenRow.envelope_payload, symbol);
  const version = Number(currentRow.id);
  if (!current || !previous || current.resultHash === previous.resultHash
    || !Number.isSafeInteger(version) || version < 1) return null;
  const changes = structuralChanges(previous, current);
  if (!changes.length) return null;
  const priority = changes.some((change) => change.priority === "action")
    ? "action" : changes.some((change) => change.priority === "high") ? "high" : "medium";
  return {
    id: currentRow.id,
    version,
    fingerprint: sha256Canonical({ frozenResultHash: previous.resultHash, currentResultHash: current.resultHash, changes: changes.map(({ message }) => message) }),
    priority,
    title: `${symbol} Weinstein 结构发生待审核变化`,
    summary: `${changes.map(({ message }) => message).join("；")}。当前结果仅是待审核技术快照；旧冻结证据保持不变。`
  };
}

function structuralChanges(previous: WeinsteinTechnicalAnalysisEnvelope, current: WeinsteinTechnicalAnalysisEnvelope) {
  const changes: Array<{ priority: PendingWeinsteinStructureChange["priority"]; message: string }> = [];
  if (current.stockStage !== previous.stockStage) {
    changes.push({ priority: "action", message: `阶段 ${previous.stockStage} → ${current.stockStage}` });
  }
  if (previous.stockStage === "STAGE_1" && current.stockStage === "STAGE_2"
    && current.breakoutStatus === "CONFIRMED" && current.tripleConfirmation === "3/3") {
    changes.push({ priority: "action", message: "Stage 1→2 高质量突破达到 3/3 确认" });
  }
  if (previous.breakoutStatus !== "FAILED" && current.breakoutStatus === "FAILED") {
    changes.push({ priority: "action", message: "突破确认失败" });
  }
  if (previous.entryState !== "RETEST_WATCH" && current.entryState === "RETEST_WATCH") {
    changes.push({ priority: "medium", message: "健康回踩达到观察条件" });
  }
  if (previous.exitWarning !== current.exitWarning
    && ["STAGE_3_WARNING", "STAGE_4_CONFIRMATION"].includes(current.exitWarning)) {
    changes.push({ priority: "action", message: current.exitWarning === "STAGE_4_CONFIRMATION" ? "Stage 4 已确认" : "Stage 3 预警出现" });
  }
  const currentClose = current.weeklyChart.at(-1)?.close;
  const previousClose = previous.weeklyChart.at(-1)?.close;
  const previousFloor = previous.invalidationZone?.lower ?? previous.supportZones[0]?.lower;
  if (typeof currentClose === "number" && typeof previousClose === "number"
    && typeof previousFloor === "number" && previousClose >= previousFloor && currentClose < previousFloor) {
    changes.push({ priority: "high", message: `完成周线收盘 ${currentClose} 跌破旧关键区下限 ${previousFloor}` });
  }
  return changes;
}

function typedSnapshot(value: unknown, symbol: string): WeinsteinTechnicalAnalysisEnvelope | null {
  const candidate = value as WeinsteinTechnicalAnalysisEnvelope;
  const validation = validateWeinsteinTechnicalAnalysisEnvelope(candidate, { symbol, analysisAsOf: candidate?.analysisAsOf });
  return validation.ok && candidate.status === "available" ? candidate : null;
}

function isSnapshot(value: unknown, symbol: string, resultHash: string): boolean {
  return typedSnapshot(value, symbol)?.resultHash === resultHash;
}
