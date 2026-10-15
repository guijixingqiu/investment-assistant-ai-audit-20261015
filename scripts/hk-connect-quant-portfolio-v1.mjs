#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inputs = process.argv.slice(2);
if (inputs.length !== 2) throw new Error("usage: node scripts/hk-connect-quant-portfolio-v1.mjs <HK.00175 capture> <HK.00700 capture>");
const captures = await Promise.all(inputs.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const expected = ["HK.00175", "HK.00700"];
for (const [index, capture] of captures.entries()) validateCapture(capture, expected[index]);
if (captures[0].dateRange.start !== captures[1].dateRange.start
  || captures[0].dateRange.end !== captures[1].dateRange.end
  || captures[0].completedTradingDates.join("|") !== captures[1].completedTradingDates.join("|")) {
  throw new Error("captures do not share one exact trading-date window");
}

const endKey = captures[0].dateRange.end.replaceAll("-", "");
const sourcePath = `data/quant-approved/futu-hk-00175-00700-qfq-${endKey}.json`;
const configPath = `config/quant-freeze-snapshot.futu-hk-00175-00700-${endKey}.json`;
const fetchedAt = captures.map((item) => item.fetchedAt).sort().at(-1);
const source = {
  schemaVersion: "2026-08-17.hk-connect-two-stock-quant-source.v1",
  provider: "futu_opend_read_only_quote_data",
  symbols: expected,
  asOf: captures[0].asOf,
  fetchedAt,
  dateRange: captures[0].dateRange,
  bars: captures.flatMap((item) => item.qfqBars)
};
const config = {
  schemaVersion: "2026-06-20.quant-freeze-snapshot.v1",
  sourceKind: "futu_request_history_kline_qfq",
  sourceIdentity: {
    source: "futu_request_history_kline_qfq",
    classification: "approved_real_historical",
    provenance: "owner_authorized_vps_opend_readonly_request_history_kline_qfq_two_stock",
    authority: "research_only",
    authorizationId: "owner-authorized-vps-opend-hk-connect-two-stock-20260817",
    asOf: captures[0].asOf,
    fetchedAt,
    externalFetch: true
  },
  sourcePath,
  outputDir: "artifacts/hk-connect-quant-portfolio-v1/snapshot",
  hkConnectUniversePath: "config/hk-connect-universe.southbound.json",
  market: "HK",
  adjustment: "forward",
  dataCutoff: fetchedAt,
  dateRange: captures[0].dateRange,
  universe: captures.map((item) => ({
    market: "HK",
    code: item.symbol.slice(3),
    symbol: item.symbol,
    name: item.name,
    lotSize: item.lotSize
  }))
};
await writeImmutable(sourcePath, source);
await writeImmutable(configPath, config);
console.log(JSON.stringify({ ok: true, sourcePath, configPath, rows: source.bars.length, symbols: expected, dateRange: source.dateRange }, null, 2));

function validateCapture(value, symbol) {
  if (value?.schemaVersion !== "2026-08-08.futu-quant-opend-capture.v1"
    || value.provider !== "futu_opend_read_only_quote_data" || value.symbol !== symbol
    || value.rights?.derivedUse !== "confirmed" || value.rights?.retention !== "confirmed"
    || value.rights?.rights !== "confirmed" || !Array.isArray(value.qfqBars) || value.qfqBars.length < 40
    || !Array.isArray(value.completedTradingDates) || value.completedTradingDates.length !== value.qfqBars.length
    || value.qfqBars.some((bar) => `${bar.market}.${bar.code}` !== symbol || bar.adjustment !== "forward")) {
    throw new Error(`${symbol} capture is invalid or lacks confirmed research-use rights`);
  }
}

async function writeImmutable(path, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const absolute = join(root, path);
  try {
    const existing = await readFile(absolute, "utf8");
    if (existing !== bytes) throw new Error(`${path} already exists with different content`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(absolute, bytes, { flag: "wx" });
  }
}
