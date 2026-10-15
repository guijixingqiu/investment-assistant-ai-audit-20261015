import { createPool } from "../dist/apps/api/src/db.js";
import { readLatestQuoteEnvelope } from "../dist/apps/api/src/market/repository.js";

const [market, code] = process.argv.slice(2);
if (!market || !code) {
  console.error("usage: node scripts/read-market-quote.mjs <market> <code>");
  process.exit(2);
}

const pool = createPool(process.env.DATABASE_URL ?? "postgres://localhost/annual_rings_candidate");
try {
  const liveMaxAgeSeconds = Number.parseInt(process.env.QUOTE_LIVE_MAX_AGE_SECONDS ?? "300", 10);
  const envelope = await readLatestQuoteEnvelope(pool, market, code, liveMaxAgeSeconds);
  console.log(JSON.stringify(envelope));
} finally {
  await pool.end();
}
