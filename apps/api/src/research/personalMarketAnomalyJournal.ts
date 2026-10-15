import { createHash } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import type { AuthenticatedResearchActor } from "./domain.js";
import { detectMarketAnomaly, hongKongTradingDate, type MarketAnomaly } from "./personalMarketAnomaly.js";

// Local observation receipts only. Never a research fact, formal decision or database.
// The local runtime has one API writer; serialize its read/replace operations.
type Receipt = {
  actor: AuthenticatedResearchActor; event: MarketAnomaly;
  firstDetectedAt: string; latestObservedAt: string;
  highestSeverity: MarketAnomaly["thresholdBand"];
};
type Journal = { version: 1; receipts: Receipt[] };
const writes = new Map<string, Promise<unknown>>();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sameActor = (a: AuthenticatedResearchActor, b: AuthenticatedResearchActor) =>
  a.actorType === b.actorType && a.actorId === b.actorId;

async function readJournal(path: string): Promise<Journal> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, receipts: [] }; throw error; }
  const stored = JSON.parse(text);
  if (stored?.data?.version !== 1 || !Array.isArray(stored.data.receipts)
    || stored.sha256 !== digest(stored.data)) throw new Error("ANOMALY_JOURNAL_INVALID");
  return stored.data;
}

function validEvent(receipt: Receipt, now: Date, liveMaxAgeSeconds: number): MarketAnomaly | null {
  const e = receipt.event;
  const rebuilt = detectMarketAnomaly({ membershipId: e.membershipId, membershipVersion: e.membershipVersion,
    symbol: e.symbol, now, liveMaxAgeSeconds, benchmark: e.benchmark,
    quote: { symbol: e.symbol, price: String(e.quote.price), previous_close: String(e.quote.previousClose),
      change_percent: String(e.quote.changePercent), quote_time: e.quote.quoteTime, fetched_at: e.quote.fetchedAt,
      provider: "futu", provider_status: "live" } });
  if (!rebuilt || rebuilt.id !== e.id || rebuilt.fingerprint !== e.fingerprint
    || receipt.highestSeverity !== e.thresholdBand
    || !Number.isFinite(Date.parse(receipt.firstDetectedAt)) || !Number.isFinite(Date.parse(receipt.latestObservedAt))
    || Date.parse(receipt.firstDetectedAt) > Date.parse(receipt.latestObservedAt)
    || Date.parse(receipt.latestObservedAt) > now.getTime()) return null;
  return { ...rebuilt, observation: { firstDetectedAt: receipt.firstDetectedAt,
    latestObservedAt: receipt.latestObservedAt, highestSeverity: receipt.highestSeverity } };
}

export async function readAnomalyReceipt(path: string, actor: AuthenticatedResearchActor,
  membership: { id: string; version: number; symbol: string }, now: Date, liveMaxAgeSeconds: number, eventDate?: string): Promise<MarketAnomaly | null> {
  const targetDate = eventDate ?? hongKongTradingDate(now);
  if (!/^20\d\d-\d\d-\d\d$/.test(targetDate) || targetDate > hongKongTradingDate(now)) return null;
  const journal = await readJournal(path);
  const matches = journal.receipts.filter((r) => sameActor(r.actor, actor)
    && r.event.membershipId === membership.id && r.event.membershipVersion === membership.version
    && r.event.symbol === membership.symbol && r.event.tradingDate === targetDate
    && Date.parse(r.latestObservedAt) <= now.getTime());
  // A stock can move both ways in a session. Today exposes one highest-severity event;
  // ties select the latest detected direction, with the triggering snapshot unchanged.
  matches.sort((a, b) => Number(b.highestSeverity === "eight_plus") - Number(a.highestSeverity === "eight_plus")
    || b.firstDetectedAt.localeCompare(a.firstDetectedAt));
  if (!matches.length) return null;
  // An explicitly selected historical event is validated at its recorded observation
  // time, and exposed as stored data. Today still calls this without eventDate.
  const historical = targetDate < hongKongTradingDate(now);
  const event = validEvent(matches[0], historical ? new Date(matches[0].latestObservedAt) : now, liveMaxAgeSeconds);
  return event && historical ? { ...event, freshness: "stored_day_observation" } : event;
}

export async function recordAnomalyReceipt(path: string, actor: AuthenticatedResearchActor,
  event: MarketAnomaly, now: Date): Promise<void> {
  const previous = writes.get(path) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    const journal = await readJournal(path);
    const sameEvent = journal.receipts.find((r) => sameActor(r.actor, actor)
      && r.event.id === event.id && r.event.symbol === event.symbol);
    if (sameEvent) sameEvent.latestObservedAt = now.toISOString();
    else journal.receipts.push({ actor, event, firstDetectedAt: now.toISOString(),
      latestObservedAt: now.toISOString(), highestSeverity: event.thresholdBand });
    // Keep the first triggering snapshot of each band. The read projection selects
    // the highest band, so an upgrade cannot erase history or create two Today cards.
    const temporary = `${path}.${process.pid}.part`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ data: journal, sha256: digest(journal) })); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  });
  writes.set(path, task);
  try { await task; } finally { if (writes.get(path) === task) writes.delete(path); }
}
