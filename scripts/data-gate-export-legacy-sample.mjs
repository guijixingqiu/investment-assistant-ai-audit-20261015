import { writeFile } from "node:fs/promises";
import { Client } from "pg";

const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL;
if (!sourceDatabaseUrl) {
  console.error("未验证: SOURCE_DATABASE_URL is required for read-only legacy sample export.");
  process.exit(2);
}

const requestedSymbol = process.env.DATA_GATE_SYMBOL ?? "";
const requestedSymbols = parseSymbolList(process.env.DATA_GATE_SYMBOLS ?? "");
const outputPath = process.env.DATA_GATE_OUTPUT_PATH ?? "";
const researchLimit = parseResearchLimit(process.env.DATA_GATE_RESEARCH_LIMIT, 20);
const includeGlobalResearch = process.env.DATA_GATE_INCLUDE_GLOBAL_RESEARCH === "1";
const sourceLabel = process.env.DATA_GATE_SOURCE_LABEL ?? "legacy-readonly-export";

const client = new Client({
  connectionString: sourceDatabaseUrl,
  application_name: "annual-rings-data-gate-readonly-export"
});

await client.connect();

try {
  await client.query("begin transaction isolation level repeatable read read only");
  await client.query("set local statement_timeout = '10s'");
  await client.query("set local lock_timeout = '1s'");

  const stocks = requestedSymbols.length > 0
    ? await findRequestedStocks(requestedSymbols)
    : requestedSymbol
      ? [await findRequestedStock(requestedSymbol)]
      : [await chooseSampleStock()];

  if (stocks.some((stock) => !stock)) {
    throw new Error("one or more requested legacy stocks were not found");
  }
  const foundStocks = stocks.filter(Boolean);
  if (foundStocks.length === 0) {
    throw new Error(requestedSymbol ? `no legacy stock found for ${requestedSymbol}` : "no eligible legacy sample stock found");
  }

  const samples = [];
  for (const stock of foundStocks) {
    const positions = await loadPositions(stock);
    const decisionChecks = await loadDecisionChecks(stock);
    const researchEvents = await loadResearchEvents(stock, researchLimit);
    const totals = await loadTotals(stock);
    samples.push({
      symbol: {
        market: stock.market,
        code: stock.ticker,
        name: stock.name
      },
      expectedCounts: {
        positions: positions.length,
        decisionChecks: decisionChecks.length,
        researchEvents: researchEvents.length,
        trades: 0,
        reviews: 0
      },
      sourceTotals: totals,
      positions,
      decisionChecks,
      researchEvents,
      trades: [],
      reviews: []
    });
  }
  const globalResearchEvents = includeGlobalResearch ? await loadGlobalResearchEvents() : [];

  await client.query("commit");

  const sample = {
    sourceLabel,
    ...(samples.length === 1 ? samples[0] : {
      expectedCounts: {
        ...aggregateCounts(samples.map((item) => item.expectedCounts)),
        globalResearchEvents: globalResearchEvents.length
      },
      sourceTotals: {
        ...aggregateCounts(samples.map((item) => item.sourceTotals)),
        globalResearchEvents: globalResearchEvents.length
      },
      samples
    }),
    ...(globalResearchEvents.length > 0 ? { globalResearchEvents } : {}),
    notes: [
      "Exported through a repeatable-read read-only transaction.",
      "Research event content and source bodies are not exported; summary/title metadata only.",
      "Trades and reviews are intentionally empty unless a later data-gate task explicitly handles them."
    ]
  };

  const text = `${JSON.stringify(sample, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, text, "utf8");
    console.log(JSON.stringify({
      ok: true,
      outputPath,
      symbol: samples.map((item) => `${item.symbol.market}.${item.symbol.code}`).join(","),
      expectedCounts: sample.expectedCounts,
      sourceTotals: sample.sourceTotals
    }, null, 2));
  } else {
    process.stdout.write(text);
  }
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    // Ignore rollback failure while reporting the original error.
  }
  throw error;
} finally {
  await client.end();
}

async function loadGlobalResearchEvents() {
  const result = await client.query(
    `select id, source, title, summary, event_type,
            coalesce(impact_direction, 'neutral') as impact_direction,
            coalesce(confidence, 'medium') as confidence,
            created_at
       from research_events
      order by created_at desc, id desc`
  );
  return result.rows.map((row) => ({
    legacyId: `research_events:${row.id}`,
    sourceType: row.source ?? "legacy",
    title: row.title,
    summary: row.summary ?? row.title ?? "Legacy research event summary unavailable in safe export.",
    eventType: row.event_type ?? "note",
    impactDirection: normalizeImpact(row.impact_direction),
    confidence: normalizeConfidence(row.confidence),
    capturedAt: dateString(row.created_at)
  }));
}

async function findRequestedStocks(symbols) {
  const stocks = [];
  for (const symbol of symbols) {
    stocks.push(await findRequestedStock(symbol));
  }
  return stocks;
}

async function findRequestedStock(symbol) {
  const parsed = parseSymbol(symbol);
  const result = await client.query(
    `select id, market, ticker, name
       from stocks
      where upper(market) = $1 and upper(ticker) = $2
      limit 1`,
    [parsed.market, parsed.code]
  );
  return result.rows[0] ?? null;
}

async function chooseSampleStock() {
  const result = await client.query(
    `select s.id, s.market, s.ticker, s.name,
            count(distinct p.id)::integer as position_count,
            count(distinct dc.id)::integer as decision_count,
            count(distinct res.event_id)::integer as research_count
       from stocks s
       left join positions p on p.stock_id = s.id
       left join decision_checks dc on dc.stock_id = s.id
       left join research_event_stocks res on res.stock_id = s.id
      group by s.id, s.market, s.ticker, s.name
     having count(distinct p.id) > 0
         or count(distinct dc.id) > 0
         or count(distinct res.event_id) > 0
      order by count(distinct p.id) desc,
               count(distinct dc.id) desc,
               count(distinct res.event_id) desc,
               s.updated_at desc nulls last,
               s.id desc
      limit 1`
  );
  return result.rows[0] ?? null;
}

async function loadPositions(stock) {
  const result = await client.query(
    `select id, average_cost, quantity, current_weight, max_weight,
            unrealized_pnl, status, updated_at, created_at
       from positions
      where stock_id = $1
      order by updated_at desc nulls last, id desc`,
    [stock.id]
  );
  return result.rows.map((row) => ({
    legacyId: `positions:${row.id}`,
    quantity: decimalString(row.quantity, "0"),
    averageCost: decimalString(row.average_cost, null),
    currentWeight: decimalString(row.current_weight, null),
    maxWeight: decimalString(row.max_weight, null),
    unrealizedPnl: decimalString(row.unrealized_pnl, null),
    status: row.status ?? "holding",
    snapshotAsOf: dateString(row.updated_at ?? row.created_at)
  }));
}

async function loadDecisionChecks(stock) {
  const result = await client.query(
    `select id, action_intent, verdict, requested_price, requested_quantity,
            current_price, current_quantity, average_cost, market_value,
            current_weight, user_final_decision, decided_at, created_at
       from decision_checks
      where stock_id = $1
      order by created_at desc, id desc`,
    [stock.id]
  );
  return result.rows.map((row) => ({
    legacyId: `decision_checks:${row.id}`,
    actionIntent: row.action_intent,
    verdict: row.verdict,
    requestedPrice: decimalString(row.requested_price, null),
    requestedQuantity: decimalString(row.requested_quantity, null),
    currentPrice: decimalString(row.current_price, null),
    currentQuantity: decimalString(row.current_quantity, null),
    averageCost: decimalString(row.average_cost, null),
    marketValue: decimalString(row.market_value, null),
    currentWeight: decimalString(row.current_weight, null),
    userFinalDecision: row.user_final_decision,
    decidedAt: row.decided_at ? dateString(row.decided_at) : null,
    checkedAt: dateString(row.created_at)
  }));
}

async function loadResearchEvents(stock, limit) {
  const limitSql = limit ? "limit $2" : "";
  const params = limit ? [stock.id, limit] : [stock.id];
  const result = await client.query(
    `select re.id, re.source, re.title, re.summary, re.event_type,
            coalesce(re.impact_direction, 'neutral') as impact_direction,
            coalesce(re.confidence, 'medium') as confidence,
            re.created_at
       from research_events re
       join research_event_stocks res on res.event_id = re.id
      where res.stock_id = $1
      order by re.created_at desc, re.id desc
      ${limitSql}`,
    params
  );
  return result.rows.map((row) => ({
    legacyId: `research_events:${row.id}:stock:${stock.id}`,
    sourceType: row.source ?? "legacy",
    title: row.title,
    summary: row.summary ?? row.title ?? "Legacy research event summary unavailable in safe export.",
    eventType: row.event_type ?? "note",
    impactDirection: normalizeImpact(row.impact_direction),
    confidence: normalizeConfidence(row.confidence),
    capturedAt: dateString(row.created_at)
  }));
}

async function loadTotals(stock) {
  const result = await client.query(
    `select
       (select count(*)::integer from positions where stock_id = $1) as positions,
       (select count(*)::integer from decision_checks where stock_id = $1) as "decisionChecks",
       (select count(*)::integer from research_event_stocks where stock_id = $1) as "researchEvents",
       (select count(*)::integer from trades where stock_id = $1) as trades,
       (select count(*)::integer from reviews where stock_id = $1) as reviews`,
    [stock.id]
  );
  return result.rows[0];
}

function parseSymbol(symbol) {
  const parts = String(symbol).trim().toUpperCase().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`invalid DATA_GATE_SYMBOL: ${symbol}`);
  }
  return { market: parts[0], code: parts[1] };
}

function parseSymbolList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function aggregateCounts(countsList) {
  return countsList.reduce((result, item) => ({
    positions: result.positions + Number(item.positions ?? 0),
    decisionChecks: result.decisionChecks + Number(item.decisionChecks ?? 0),
    researchEvents: result.researchEvents + Number(item.researchEvents ?? 0),
    globalResearchEvents: result.globalResearchEvents + Number(item.globalResearchEvents ?? 0),
    trades: result.trades + Number(item.trades ?? 0),
    reviews: result.reviews + Number(item.reviews ?? 0)
  }), {
    positions: 0,
    decisionChecks: 0,
    researchEvents: 0,
    globalResearchEvents: 0,
    trades: 0,
    reviews: 0
  });
}

function decimalString(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function dateString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeImpact(value) {
  return ["positive", "negative", "mixed", "neutral", "unknown"].includes(value) ? value : "neutral";
}

function normalizeConfidence(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function parsePositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseResearchLimit(value, fallback) {
  if (value === "all") return null;
  return parsePositiveInteger(value, fallback);
}
