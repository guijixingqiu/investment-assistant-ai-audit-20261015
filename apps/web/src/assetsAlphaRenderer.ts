import type {
  AssetsAlphaEnvelope,
  AssetsAlphaPosition,
  AssetsAlphaSnapshot
} from "../../../packages/contracts/src/assetsAlpha.js";

export type AssetsAlphaUiState = "idle" | "loading" | "available" | "unknown" | "unauthorized" | "conflict" | "offline" | "malformed" | "unavailable";

export function renderAssetsAlpha(documentRef: Document, state: AssetsAlphaUiState, message: string, envelope: AssetsAlphaEnvelope | null, busy: boolean): void {
  const host = documentRef.getElementById("assets-alpha-console");
  const status = documentRef.getElementById("assets-alpha-status");
  const latest = documentRef.getElementById("assets-alpha-latest");
  const history = documentRef.getElementById("assets-alpha-history");
  if (!host || !status || !latest || !history) return;
  host.dataset.state = state;
  status.textContent = `${state}: ${message}`;
  for (const id of ["assets-alpha-refresh", "assets-alpha-save", "assets-alpha-zero"]) {
    const button = documentRef.getElementById(id); if (button instanceof HTMLButtonElement) button.disabled = busy;
  }
  latest.replaceChildren(); history.replaceChildren();
  if (!envelope) {
    latest.textContent = busy ? "Fresh operation in progress; old success is hidden." : "Latest unofficial Alpha is UNKNOWN.";
    return;
  }
  const snapshot = envelope.latestSnapshot;
  const quality = snapshotQuality(snapshot);
  latest.append(heading(documentRef, "Latest unofficial snapshot"), paragraph(documentRef,
    snapshot ? `${quality === "complete" ? "complete" : "UNKNOWN"} · ${snapshot.source} · asOf ${snapshot.asOf} · record ${snapshot.id}` : "UNKNOWN · no snapshot recorded."));
  if (snapshot) {
    const summary = quality === "complete" ? completeSummary(snapshot) : null;
    latest.append(paragraph(documentRef, quality === "complete"
      ? `Cash ${money(snapshot.cashHkd)} · total assets ${money(summary?.totalAssets ?? null)} · largest weight ${percent(summary?.largestWeight ?? null)} · HHI ${number(summary?.hhi ?? null)}`
      : "Cash UNKNOWN · positions UNKNOWN · total assets UNKNOWN · concentration UNKNOWN."));
    if (quality === "complete") latest.append(list(documentRef, snapshot.positions.map(positionLine)));
    latest.append(researchActions(documentRef, snapshot.positions.map((item) => item.symbol), `alpha-latest:${snapshot.id}:${snapshot.sourceHash}`));
  }
  latest.append(paragraph(documentRef, `Authority ${envelope.authority.kind} · official=${envelope.authority.official} · production=${envelope.authority.production} · actor ${envelope.requestedActorId}.`));
  history.append(heading(documentRef, `Immutable history (${envelope.snapshots.length})`));
  for (const item of envelope.snapshots) history.append(historyItem(documentRef, item, busy));
}

export function snapshotQuality(snapshot: AssetsAlphaSnapshot | null): "missing" | "stale" | "incomplete" | "complete" {
  if (!snapshot) return "missing";
  const age = Date.now() - Date.parse(snapshot.asOf);
  if (!Number.isFinite(age) || age < 0 || age > 86_400_000) return "stale";
  if (snapshot.cashHkd === null || snapshot.positions.some((item) => item.marketValueHkd === null || item.unrealizedPnlHkd === null)) return "incomplete";
  return "complete";
}

function completeSummary(snapshot: AssetsAlphaSnapshot): { totalAssets: number; largestWeight: number; hhi: number } | null { const values = snapshot.positions.map((item) => item.marketValueHkd); if (snapshot.cashHkd === null || values.some((item) => item === null)) return null; const market = values.reduce<number>((sum, item) => sum + (item ?? 0), 0); const totalAssets = market + snapshot.cashHkd; const weights = market > 0 ? values.map((item) => (item ?? 0) / market) : []; return { totalAssets, largestWeight: weights.length ? Math.max(...weights) : 0, hhi: weights.reduce((sum, item) => sum + item * item, 0) }; }
function heading(documentRef: Document, text: string): HTMLElement { const value = documentRef.createElement("h3"); value.textContent = text; return value; }
function paragraph(documentRef: Document, text: string): HTMLElement { const value = documentRef.createElement("p"); value.textContent = text; return value; }
function list(documentRef: Document, lines: string[]): HTMLElement { const value = documentRef.createElement("ul"); value.append(...lines.map((text) => { const item = documentRef.createElement("li"); item.textContent = text; return item; })); return value; }
function positionLine(item: AssetsAlphaPosition): string { return `${item.symbol} · quantity ${item.quantity} · market ${money(item.marketValueHkd)} · unrealized P/L ${money(item.unrealizedPnlHkd)}`; }
function historyItem(documentRef: Document, snapshot: AssetsAlphaSnapshot, busy: boolean): HTMLElement { const details = documentRef.createElement("details"); const summary = documentRef.createElement("summary"); summary.textContent = `${snapshot.id} · ${snapshot.source} · ${snapshot.asOf} · ${snapshot.positions.length} position(s)`; const body = paragraph(documentRef, `Cash ${money(snapshot.cashHkd)} · SHA-256 ${snapshot.sourceHash} · created ${snapshot.createdAt}`); const positions = list(documentRef, snapshot.positions.map(positionLine)); const button = documentRef.createElement("button"); button.type = "button"; button.dataset.assetsAlphaRestore = snapshot.id; button.textContent = "Append this history as a new snapshot"; button.disabled = busy; details.append(summary, body, positions, researchActions(documentRef, snapshot.positions.map((item) => item.symbol), `alpha-history:${snapshot.id}:${snapshot.sourceHash}`), button); return details; }
function researchActions(documentRef: Document, symbols: string[], sourceKey: string): HTMLElement { const actions = documentRef.createElement("div"); actions.className = "console-actions"; for (const symbol of new Set(symbols)) { const button = documentRef.createElement("button"); button.type = "button"; button.dataset.assetsResearchSymbol = symbol; button.dataset.assetsResearchSourceKey = sourceKey; button.textContent = `${symbol} → Research 看当前报告组合影响`; actions.append(button); } return actions; }
function money(value: number | null): string { return value === null ? "UNKNOWN" : `HKD ${new Intl.NumberFormat("en-HK", { maximumFractionDigits: 2 }).format(value)}`; }
function percent(value: number | null): string { return value === null ? "UNKNOWN" : `${(value * 100).toFixed(2)}%`; }
function number(value: number | null): string { return value === null ? "UNKNOWN" : new Intl.NumberFormat("en-HK", { maximumFractionDigits: 4 }).format(value); }
