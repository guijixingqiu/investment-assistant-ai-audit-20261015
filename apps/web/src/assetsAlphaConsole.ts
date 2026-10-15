import {
  validateAssetsAlphaEnvelope,
  validateAssetsAlphaSnapshotWriteResponse,
  validateAssetsAlphaTradeWriteResponse,
  validateCreateAssetsAlphaSnapshotRequest,
  validateCreateAssetsAlphaTradeRequest,
  type AssetsAlphaEnvelope,
  type AssetsAlphaPosition,
  type AssetsAlphaSnapshot,
  type AssetsAlphaSnapshotWriteResponse,
  type AssetsAlphaTrade,
  type AssetsAlphaTradeWriteResponse,
  type CreateAssetsAlphaSnapshotRequest,
  type CreateAssetsAlphaTradeRequest
} from "../../../packages/contracts/src/assetsAlpha.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import { renderAssetsAlpha, snapshotQuality, type AssetsAlphaUiState } from "./assetsAlphaRenderer.js";
import { localDateTimeInputValue } from "./displayFormatting.js";
import { localDateTimeToIso } from "./researchDocumentTransport.js";
import { parseHongKongSymbol } from "./securitySymbol.js";
import { auth, candidateReadAuth, candidateWriteAuth } from "./webAuth.js";

const PATH = "/api/mobile/assets/alpha";
const CSV_HEADER = "symbol,quantity,market_value_hkd,as_of";
type UiState = AssetsAlphaUiState;
type SnapshotDraft = Omit<CreateAssetsAlphaSnapshotRequest, "idempotencyKey">;
interface RetryIntent { fingerprint: string; request: CreateAssetsAlphaSnapshotRequest; }

export function acceptAssetsAlphaEnvelope(value: unknown, expectedActorId: string | null = null): AssetsAlphaEnvelope {
  const validation = validateAssetsAlphaEnvelope(value);
  if (!validation.ok) throw new Error(`Assets Alpha response is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as AssetsAlphaEnvelope;
  if (expectedActorId !== null && envelope.requestedActorId !== expectedActorId) throw new Error("Assets Alpha actor identity changed.");
  return envelope;
}

export async function readAssetsAlpha(
  requestAuth: WebApiAuth,
  expectedActorId: string | null = null,
  fetcher: typeof fetch = fetch
): Promise<AssetsAlphaEnvelope> {
  const value = await json(PATH, requestAuth, { cache: "no-store" }, fetcher);
  return acceptAssetsAlphaEnvelope(value, expectedActorId);
}

export async function postAssetsAlphaSnapshot(
  request: CreateAssetsAlphaSnapshotRequest,
  requestAuth: WebApiAuth,
  expectedActorId: string,
  fetcher: typeof fetch = fetch
): Promise<AssetsAlphaSnapshotWriteResponse> {
  const requestValidation = validateCreateAssetsAlphaSnapshotRequest(request);
  if (!requestValidation.ok) throw new Error(requestValidation.errors.join("; "));
  const value = await json(`${PATH}/snapshots`, requestAuth, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", "x-research-expected-actor-id": expectedActorId },
    body: JSON.stringify(request)
  }, fetcher);
  const validation = validateAssetsAlphaSnapshotWriteResponse(value);
  if (!validation.ok) throw new Error(`Assets Alpha write response is malformed: ${validation.errors.join("; ")}`);
  const response = value as AssetsAlphaSnapshotWriteResponse;
  if (response.envelope.requestedActorId !== expectedActorId || !snapshotMatchesRequest(response.createdRecord, request)
    || response.envelope.latestSnapshot?.id !== response.createdRecord.id
    || response.envelope.snapshots.filter((item) => sameSnapshot(item, response.createdRecord)).length !== 1) {
    throw new Error("Assets Alpha write response does not bind the exact actor, request, latest snapshot, and source identity.");
  }
  return response;
}

export async function postAssetsAlphaTrade(
  request: CreateAssetsAlphaTradeRequest,
  requestAuth: WebApiAuth,
  expectedActorId: string,
  fetcher: typeof fetch = fetch
): Promise<AssetsAlphaTradeWriteResponse> {
  const requestValidation = validateCreateAssetsAlphaTradeRequest(request);
  if (!requestValidation.ok) throw new Error(requestValidation.errors.join("; "));
  const value = await json(`${PATH}/trades`, requestAuth, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", "x-research-expected-actor-id": expectedActorId },
    body: JSON.stringify(request)
  }, fetcher);
  const validation = validateAssetsAlphaTradeWriteResponse(value);
  if (!validation.ok) throw new Error(`Assets Alpha trade response is malformed: ${validation.errors.join("; ")}`);
  const response = value as AssetsAlphaTradeWriteResponse;
  if (response.envelope.requestedActorId !== expectedActorId || !tradeMatchesRequest(response.createdRecord, request)
    || response.envelope.trades.filter((item) => sameTrade(item, response.createdRecord)).length !== 1) {
    throw new Error("Assets Alpha trade response does not bind the exact actor, request, and source identity.");
  }
  return response;
}

export function parseAssetsAlphaCsv(text: string): { asOf: string; positions: AssetsAlphaPosition[] } {
  const rows = normalizedRows(text);
  if (rows.length < 2 || rows.length > 101 || rows[0] !== CSV_HEADER) throw new Error("CSV header or row count is invalid.");
  let asOf = "";
  const positions = rows.slice(1).map((row, index) => {
    const fields = csvFields(row, 4, index + 2);
    const currentAsOf = fields[3];
    if (!currentAsOf || asOf && currentAsOf !== asOf) throw new Error("All CSV rows must use one as_of timestamp.");
    asOf = currentAsOf;
    return position(fields[0], fields[1], fields[2], "", index + 2);
  });
  uniqueSymbols(positions);
  return { asOf, positions };
}

export function parseAssetsAlphaManualRows(text: string): AssetsAlphaPosition[] {
  const rows = normalizedRows(text);
  if (rows.length > 100) throw new Error("Manual positions must contain at most 100 rows.");
  const positions = rows.map((row, index) => {
    const fields = csvFields(row, 4, index + 1);
    return position(fields[0], fields[1], fields[2], fields[3], index + 1);
  });
  uniqueSymbols(positions);
  return positions;
}

export class AssetsAlphaConsole {
  private envelope: AssetsAlphaEnvelope | null = null;
  private state: UiState = "idle";
  private message = "Fresh-read the Owner-entered unofficial local Alpha before using it.";
  private generation = 0;
  private busy = 0;
  private draftRevision = 0;
  private retry: RetryIntent | null = null;

  constructor(private readonly documentRef: Document) {}

  mount(): void {
    this.element("assets-alpha-refresh")?.addEventListener("click", () => void this.refresh());
    this.element("assets-alpha-save")?.addEventListener("click", () => void this.saveDraft());
    this.element("assets-alpha-zero")?.addEventListener("click", () => void this.saveZero());
    this.element("assets-alpha-history")?.addEventListener("click", (event) => void this.restore(event));
    this.file("assets-alpha-csv-file").addEventListener("change", () => void this.importFile());
    for (const id of ["assets-alpha-as-of", "assets-alpha-cash", "assets-alpha-positions", "assets-alpha-owner-confirmed"]) {
      this.element(id)?.addEventListener("input", () => { this.draftRevision += 1; this.renderDraftSource(); });
    }
    for (const id of ["membership-read-header-name", "membership-read-token", "membership-write-header-name", "membership-write-token", "auth-header-name", "auth-token"]) {
      this.element(id)?.addEventListener("input", () => this.invalidate("Authorization changed; old Assets Alpha success was cleared."));
    }
    if (!this.input("assets-alpha-as-of").value) this.input("assets-alpha-as-of").value = localDateTimeInputValue(new Date().toISOString());
    this.render();
  }

  async refresh(): Promise<void> {
    if (this.busy) return;
    await this.run("Fresh-reading latest and immutable history…", async (token) => {
      const readAuth = this.requireReadAuth();
      const envelope = await readAssetsAlpha(readAuth);
      this.assertCurrent(token, readAuth, null, this.draftRevision);
      this.accept(envelope, "Fresh Assets Alpha read confirmed.");
    });
  }

  private async saveDraft(): Promise<void> {
    if (this.busy) return;
    try { await this.write(this.draft(), "New unofficial local Alpha snapshot fresh-read and confirmed."); }
    catch (error) { this.draftFailure(error); }
  }

  private async saveZero(): Promise<void> {
    if (this.busy) return;
    try {
      await this.write({ source: "manual", asOf: this.asOf(), cashHkd: this.cash(), positions: [], ownerConfirmed: true },
        "Explicit zero-position snapshot appended; it remains unofficial and does not reconcile a broker account.");
    } catch (error) { this.draftFailure(error); }
  }


  private async restore(event: Event): Promise<void> {
    if (this.busy) return;
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-assets-alpha-restore]") : null;
    const matches = this.envelope?.snapshots.filter((item) => item.id === button?.dataset.assetsAlphaRestore) ?? [];
    if (matches.length !== 1) return;
    const snapshot = matches[0];
    try {
      await this.write({ source: "manual", asOf: snapshot.asOf, cashHkd: snapshot.cashHkd, positions: snapshot.positions, ownerConfirmed: true },
        `History snapshot ${snapshot.id} was appended as a new snapshot; the old record was not modified.`);
    } catch (error) { this.draftFailure(error); }
  }

  private async write(draft: SnapshotDraft, success: string): Promise<void> {
    if (!this.checkbox("assets-alpha-owner-confirmed").checked) throw new Error("Explicit Owner confirmation is required before any snapshot write.");
    if (Date.parse(draft.asOf) > Date.now()) throw new Error("Snapshot asOf cannot be in the future.");
    const intent = this.reserve(draft);
    const revision = this.draftRevision;
    await this.run("Preflighting actor and immutable history before the explicit write…", async (token) => {
      const readAuth = this.requireReadAuth();
      const writeAuth = this.requireWriteAuth();
      const before = await readAssetsAlpha(readAuth);
      this.assertCurrent(token, readAuth, writeAuth, revision);
      const priorIds = new Set(before.snapshots.map((item) => item.id));
      let response: AssetsAlphaSnapshotWriteResponse | null = null;
      let postError: unknown = null;
      try { response = await postAssetsAlphaSnapshot(intent.request, writeAuth, before.requestedActorId); }
      catch (error) { postError = error; }
      this.assertCurrent(token, readAuth, writeAuth, revision);
      const after = await readAssetsAlpha(readAuth, before.requestedActorId);
      this.assertCurrent(token, readAuth, writeAuth, revision);
      const target = reconcileSnapshot(before, after, intent.request, response, priorIds);
      if (!target) throw postError ?? new Error("Fresh readback did not return one exact newly appended snapshot.");
      this.retry = null;
      this.checkbox("assets-alpha-owner-confirmed").checked = false;
      this.accept(after, `${success} Record ${target.id} · SHA-256 ${target.sourceHash}.`);
    });
  }


  private async importFile(): Promise<void> {
    if (this.busy) return;
    const file = this.file("assets-alpha-csv-file").files?.[0];
    if (!file) return;
    const revision = ++this.draftRevision;
    try {
      if (file.size === 0 || file.size > 64 * 1024) throw new Error("CSV must be non-empty and at most 64 KB.");
      const text = await file.text();
      if (revision !== this.draftRevision) return;
      const parsed = parseAssetsAlphaCsv(text);
      this.textarea("assets-alpha-positions").value = text;
      this.input("assets-alpha-as-of").value = localDateTimeInputValue(parsed.asOf);
      this.message = `CSV ${file.name} loaded locally (${parsed.positions.length} positions); explicit confirmation and Save are still required.`;
      this.render();
      this.renderDraftSource();
    } catch (error) { this.message = `CSV UNKNOWN: ${failureMessage(error)}`; this.render(); }
  }

  private async run(progress: string, action: (token: number) => Promise<void>): Promise<void> {
    if (this.busy) return;
    const token = ++this.generation;
    this.busy = token;
    this.envelope = null;
    this.state = "loading";
    this.message = `${progress} Previous success is hidden.`;
    this.render();
    try { await action(token); }
    catch (error) {
      if (token !== this.generation) return;
      this.envelope = null;
      this.state = failureState(error);
      this.message = `Assets Alpha UNKNOWN: ${failureMessage(error)}`;
    } finally {
      if (this.busy === token) { this.busy = 0; this.render(); }
    }
  }

  private accept(envelope: AssetsAlphaEnvelope, prefix: string): void {
    this.envelope = envelope;
    const quality = snapshotQuality(envelope.latestSnapshot);
    this.state = quality === "complete" ? "available" : "unknown";
    this.message = quality === "complete" ? prefix : `${prefix} Latest snapshot is ${quality}; summaries remain UNKNOWN.`;
  }

  private invalidate(message: string): void { this.generation += 1; this.busy = 0; this.envelope = null; this.state = "idle"; this.message = message; this.render(); }
  private draftFailure(error: unknown): void { this.message = `Draft not sent: ${failureMessage(error)}`; this.render(); }
  private draft(): SnapshotDraft {
    const text = this.textarea("assets-alpha-positions").value;
    const csv = text.replace(/^\uFEFF/, "").startsWith(CSV_HEADER);
    const parsed = csv ? parseAssetsAlphaCsv(text) : { asOf: this.asOf(), positions: parseAssetsAlphaManualRows(text) };
    return { source: csv ? "csv" : "manual", asOf: parsed.asOf, cashHkd: this.cash(), positions: parsed.positions, ownerConfirmed: true };
  }
  private reserve(draft: SnapshotDraft): RetryIntent {
    const fingerprint = JSON.stringify(draft);
    if (this.retry?.fingerprint === fingerprint) return this.retry;
    const request = { ...draft, idempotencyKey: `web-assets-alpha-${crypto.randomUUID()}` };
    const validation = validateCreateAssetsAlphaSnapshotRequest(request);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    return this.retry = { fingerprint, request };
  }
  private assertCurrent(token: number, readAuth: WebApiAuth, writeAuth: WebApiAuth | null, revision: number): void {
    if (token !== this.generation || revision !== this.draftRevision || !sameWebApiAuth(readAuth, this.readAuth())
      || writeAuth !== null && !sameWebApiAuth(writeAuth, this.writeAuth())) throw new Error("Authorization or form input changed during the operation.");
  }
  private asOf(): string { return localDateTimeToIso(this.input("assets-alpha-as-of").value, "Snapshot asOf"); }
  private cash(): number | null { const text = this.input("assets-alpha-cash").value.trim(); if (!text) return null; const value = Number(text); if (!Number.isFinite(value) || value < 0) throw new Error("cashHkd must be empty or non-negative."); return value; }
  private requireReadAuth(): WebApiAuth { const value = this.readAuth(); if (!value) throw new Error("Read authorization is required."); return value; }
  private requireWriteAuth(): WebApiAuth { const value = this.writeAuth(); if (!value) throw new Error("Research-write authorization is required."); return value; }
  private readAuth(): WebApiAuth | null { return candidateReadAuth() ?? auth(); }
  private writeAuth(): WebApiAuth | null { return candidateWriteAuth() ?? auth(); }
  private render(): void { renderAssetsAlpha(this.documentRef, this.state, this.message, this.envelope, Boolean(this.busy)); }
  private renderDraftSource(): void { const badge = this.element("assets-alpha-draft-source"); if (badge) badge.textContent = this.textarea("assets-alpha-positions").value.replace(/^\uFEFF/, "").startsWith(CSV_HEADER) ? "csv" : "manual"; }
  private element(id: string): HTMLElement | null { return this.documentRef.getElementById(id); }
  private input(id: string): HTMLInputElement { const value = this.element(id); if (!(value instanceof HTMLInputElement)) throw new Error(`Missing #${id}.`); return value; }
  private textarea(id: string): HTMLTextAreaElement { const value = this.element(id); if (!(value instanceof HTMLTextAreaElement)) throw new Error(`Missing #${id}.`); return value; }
  private checkbox(id: string): HTMLInputElement { return this.input(id); }
  private file(id: string): HTMLInputElement { return this.input(id); }
}

function reconcileSnapshot(before: AssetsAlphaEnvelope, after: AssetsAlphaEnvelope, request: CreateAssetsAlphaSnapshotRequest, response: AssetsAlphaSnapshotWriteResponse | null, priorIds: Set<string>): AssetsAlphaSnapshot | null {
  const retainedHistory = before.snapshots.slice(0, before.snapshots.length === 100 ? 99 : before.snapshots.length);
  if (!retainedHistory.every((old) => after.snapshots.some((current) => sameSnapshot(old, current)))) return null;
  const candidates = response
    ? after.snapshots.filter((item) => item.id === response.createdRecord.id && sameSnapshot(item, response.createdRecord))
    : after.snapshots.filter((item) => !priorIds.has(item.id) && snapshotMatchesRequest(item, request));
  return candidates.length === 1 && after.latestSnapshot?.id === candidates[0].id ? candidates[0] : null;
}
export function reconcileTrade(before: AssetsAlphaEnvelope, after: AssetsAlphaEnvelope, request: CreateAssetsAlphaTradeRequest, response: AssetsAlphaTradeWriteResponse | null, priorIds: Set<string>): AssetsAlphaTrade | null {
  if (JSON.stringify([before.latestSnapshot, before.snapshots]) !== JSON.stringify([after.latestSnapshot, after.snapshots])) return null;
  const retainedHistory = before.trades.slice(0, before.trades.length === 100 ? 99 : before.trades.length);
  if (!retainedHistory.every((old) => after.trades.some((current) => sameTrade(old, current)))) return null;
  const candidates = response
    ? after.trades.filter((item) => item.id === response.createdRecord.id && sameTrade(item, response.createdRecord))
    : after.trades.filter((item) => !priorIds.has(item.id) && tradeMatchesRequest(item, request));
  return candidates.length === 1 ? candidates[0] : null;
}
function snapshotMatchesRequest(snapshot: AssetsAlphaSnapshot, request: CreateAssetsAlphaSnapshotRequest): boolean { return snapshot.source === request.source && sameInstant(snapshot.asOf, request.asOf) && snapshot.cashHkd === request.cashHkd && JSON.stringify(snapshot.positions) === JSON.stringify(request.positions) && snapshot.ownerConfirmed === true; }
function tradeMatchesRequest(trade: AssetsAlphaTrade, request: CreateAssetsAlphaTradeRequest): boolean { return trade.symbol === request.symbol && trade.side === request.side && trade.quantity === request.quantity && trade.priceHkd === request.priceHkd && sameInstant(trade.occurredAt, request.occurredAt) && trade.note === request.note && trade.ownerConfirmed === true; }
function sameSnapshot(left: AssetsAlphaSnapshot, right: AssetsAlphaSnapshot): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function sameTrade(left: AssetsAlphaTrade, right: AssetsAlphaTrade): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function sameFacts(left: AssetsAlphaEnvelope, right: AssetsAlphaEnvelope): boolean { return left.requestedActorId === right.requestedActorId && JSON.stringify([left.authority, left.latestSnapshot, left.snapshots, left.trades, left.safety]) === JSON.stringify([right.authority, right.latestSnapshot, right.snapshots, right.trades, right.safety]); }
function sameInstant(left: string, right: string): boolean { return Date.parse(left) === Date.parse(right); }
function normalizedRows(text: string): string[] { if (!text || new TextEncoder().encode(text).length > 64 * 1024 || text.includes('"')) throw new Error("Input must be non-empty unquoted UTF-8 at most 64 KB."); const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); const rows = normalized.split("\n"); if (rows.at(-1) === "") rows.pop(); if (rows.some((row) => !row.trim())) throw new Error("Blank rows are not allowed."); return rows; }
function csvFields(row: string, count: number, line: number): string[] { const fields = row.split(",").map((item) => item.trim()); if (fields.length !== count) throw new Error(`Row ${line} must contain ${count} comma-separated fields.`); return fields; }
function position(symbolText: string, quantityText: string, valueText: string, pnlText: string, line: number): AssetsAlphaPosition { const parsed = parseHongKongSymbol(symbolText); const quantity = Number(quantityText); const marketValueHkd = nullableNumber(valueText, false); const unrealizedPnlHkd = nullableNumber(pnlText, true); if (!parsed.ok || !Number.isFinite(quantity) || quantity <= 0) throw new Error(`Row ${line} symbol or quantity is invalid.`); return { symbol: parsed.value.symbol, quantity, marketValueHkd, unrealizedPnlHkd }; }
function nullableNumber(text: string, negative: boolean): number | null { if (!text) return null; const value = Number(text); if (!Number.isFinite(value) || !negative && value < 0) throw new Error("Optional numeric value is invalid."); return value; }
function positiveNumber(text: string, label: string): number { const value = Number(text.trim()); if (!text.trim() || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`); return value; }
function uniqueSymbols(positions: AssetsAlphaPosition[]): void { if (new Set(positions.map((item) => item.symbol)).size !== positions.length) throw new Error("Position symbols must be unique."); }
async function json(path: string, requestAuth: WebApiAuth, init: RequestInit, fetcher: typeof fetch): Promise<unknown> { let response: Response; try { const headers = new Headers(init.headers); headers.set("accept", "application/json"); headers.set(requestAuth.headerName, requestAuth.token); response = await fetcher(path, { ...init, headers }); } catch (error) { throw new AssetsAlphaHttpError(0, failureMessage(error)); } const value = await response.json().catch(() => null); if (!response.ok || value === null) throw new AssetsAlphaHttpError(response.status, record(value) && typeof value.message === "string" ? value.message : `HTTP ${response.status}`); return value; }
class AssetsAlphaHttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function failureState(error: unknown): UiState { if (error instanceof AssetsAlphaHttpError) { if (error.status === 0) return "offline"; if (error.status === 401 || error.status === 403) return "unauthorized"; if (error.status === 409) return "conflict"; if (error.status >= 500) return "unavailable"; } return "malformed"; }
function failureMessage(error: unknown): string { return error instanceof Error ? error.message : "operation failed"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
if (typeof document !== "undefined") new AssetsAlphaConsole(document).mount();
