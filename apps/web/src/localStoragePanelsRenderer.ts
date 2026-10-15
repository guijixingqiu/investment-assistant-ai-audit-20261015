import type { CoreJourneyData } from "./coreJourneyState.js";
import type { PinganManualSnapshotEnvelope } from "./pinganManualSnapshotState.js";
import { describePinganManualSnapshot } from "./pinganManualSnapshotState.js";
import type { AssistLocalRecordDrafts } from "./assistLocalRecordState.js";
import { assistLocalRecordLifecycleSemantics } from "./assistLocalRecordState.js";
import type { AssistReviewKnowledgeFields } from "../../../packages/contracts/src/assistReviewKnowledge.js";
import type { AssistReviewKnowledgeViewEntry } from "./assistReviewKnowledgeState.js";
import { describeAssistReviewKnowledgeEntry } from "./assistReviewKnowledgeState.js";
import { localDateTimeInputValue, nullableNumberText, nullablePercentText } from "./displayFormatting.js";
import { renderList } from "./domRender.js";

export interface LocalStoragePanelsRenderContext {
  data: CoreJourneyData | null;
  pinganManualSnapshot: PinganManualSnapshotEnvelope | null;
  pinganManualSnapshotState: string;
  pinganManualSnapshotMessage: string;
  pinganManualSnapshotClearSymbol: string | null;
  pinganManualSnapshotClearAccountScopeId: string | null;
  currentPinganManualSnapshotSymbol: string | null;
  currentPinganManualSnapshotAccountScopeId: string | null;
  assistLocalRecordDrafts: AssistLocalRecordDrafts;
  assistLocalRecordStatus: string;
  assistLocalRecordMessage: string;
  assistLocalRecordSnapshotSummary: string[];
  assistLocalRecordSourceSignature: string | null;
  assistReviewKnowledgeStatus: string;
  assistReviewKnowledgeMessage: string;
  assistReviewKnowledgeLoadedSymbol: string | null;
  assistReviewKnowledgeCurrentSymbol: string | null;
  assistReviewKnowledgeEntries: AssistReviewKnowledgeViewEntry[];
  assistReviewKnowledgeSelectedId: string | null;
  assistReviewKnowledgeFields: AssistReviewKnowledgeFields;
  assistReviewKnowledgeClearConfirmation: string | null;
}

export function renderLocalStoragePanels(context: LocalStoragePanelsRenderContext): void {
  renderPinganManualSnapshotPanel(context);
  renderAssistLocalRecordPanel(context);
  renderAssistReviewKnowledgePanel(context);
}

function renderPinganManualSnapshotPanel(context: LocalStoragePanelsRenderContext): void {
  const { data, pinganManualSnapshot, pinganManualSnapshotState, pinganManualSnapshotMessage, pinganManualSnapshotClearSymbol, pinganManualSnapshotClearAccountScopeId, currentPinganManualSnapshotSymbol, currentPinganManualSnapshotAccountScopeId } = context;
  if (typeof document === "undefined") return;
  ensurePinganManualSnapshotPanel();
  const section = document.getElementById("pingan-manual-snapshot");
  const status = document.getElementById("pingan-manual-snapshot-status");
  const symbol = document.getElementById("pingan-manual-snapshot-symbol");
  const summary = document.getElementById("pingan-manual-snapshot-summary");
  if (!section || !status || !symbol || !summary) return;
  const currentSymbol = currentPinganManualSnapshotSymbol;
  const displaySnapshot = pinganManualSnapshot?.targetSymbol === currentSymbol && pinganManualSnapshot.accountScopeId === currentPinganManualSnapshotAccountScopeId ? pinganManualSnapshot : null;
  const applied = Boolean(data && displaySnapshot?.targetSymbol === data.symbol.symbol);
  section.setAttribute("data-state", pinganManualSnapshotState);
  section.setAttribute("data-storage", "browser_local_storage_only");
  section.setAttribute("data-source", "owner_manual_pingan_snapshot");
  section.setAttribute("data-provenance", "browser_local_manual_import");
  section.setAttribute("data-authority", "historical_only_not_live_not_authoritative");
  section.setAttribute("data-freshness", "historical");
  section.setAttribute("data-api-uploaded", "false");
  section.setAttribute("data-database-written", "false");
  section.setAttribute("data-official-portfolio-fact", "false");
  section.setAttribute("data-risk-impact-authority", "false");
  section.setAttribute("data-account-scope-state", currentPinganManualSnapshotAccountScopeId ? "verified" : "unavailable");
  section.setAttribute("data-applied-to-current-journey", String(applied));
  status.textContent = `${pinganManualSnapshotState}: ${pinganManualSnapshotMessage}`;
  symbol.textContent = currentSymbol && currentPinganManualSnapshotAccountScopeId
    ? `当前更新标的：${currentSymbol}；已绑定当前验证账号范围，只替代本浏览器中的历史显示。`
    : "当前标的或已验证账号范围不可用；不会读取、保存、应用或清除任何快照。";
  renderList(summary, displaySnapshot
    ? describePinganManualSnapshot(displaySnapshot)
    : [
      "当前标的没有可显示的浏览器本地手工快照。",
      "API 上次导入快照保持独立；本地手工快照不会上传、不会写数据库，也不会成为官方持仓。"
    ], "没有本地手工历史快照。");
  if (displaySnapshot) {
    const position = displaySnapshot.snapshot.positions[0];
    setPinganManualField("pingan-manual-name", position.name ?? "");
    setPinganManualField("pingan-manual-source-as-of", localDateTimeInputValue(displaySnapshot.snapshot.sourceAsOf));
    setPinganManualField("pingan-manual-quantity", String(position.quantity));
    setPinganManualField("pingan-manual-average-cost", nullableNumberText(position.averageCost));
    setPinganManualField("pingan-manual-current-weight", nullablePercentText(position.currentWeight));
    setPinganManualField("pingan-manual-max-weight", nullablePercentText(position.maxWeight));
    setPinganManualField("pingan-manual-unrealized-pnl", nullableNumberText(position.unrealizedPnl));
    setPinganManualField("pingan-manual-currency", position.currency ?? "HKD");
  } else if (["account_scope_unavailable", "mismatch", "malformed", "legacy_unscoped", "storage_unavailable"].includes(pinganManualSnapshotState)) {
    for (const id of ["pingan-manual-name", "pingan-manual-source-as-of", "pingan-manual-quantity", "pingan-manual-average-cost", "pingan-manual-current-weight", "pingan-manual-max-weight", "pingan-manual-unrealized-pnl", "pingan-manual-currency"]) setPinganManualField(id, "");
  }
  for (const button of section.querySelectorAll<HTMLButtonElement>("button[data-pingan-manual-action]")) {
    button.disabled = !currentSymbol || !currentPinganManualSnapshotAccountScopeId;
    if (button.dataset.pinganManualAction === "clear") {
      button.textContent = pinganManualSnapshotClearSymbol === currentSymbol && pinganManualSnapshotClearAccountScopeId === currentPinganManualSnapshotAccountScopeId ? "确认清除" : "清除本地快照";
    }
  }
}

function ensurePinganManualSnapshotPanel(): void {
  if (document.getElementById("pingan-manual-snapshot")) return;
  const host = document.getElementById("review-feedback-card") ?? document.getElementById("next-action-card");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "pingan-manual-snapshot";
  section.className = "pingan-manual-snapshot";
  section.dataset.testid = "pingan-manual-snapshot";
  section.setAttribute("aria-label", "平安手工历史快照更新");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>平安手工历史快照</h2>",
    "</div>",
    "<p id=\"pingan-manual-snapshot-status\" data-testid=\"pingan-manual-snapshot-status\" aria-live=\"polite\"></p>",
    "<p id=\"pingan-manual-snapshot-symbol\" data-testid=\"pingan-manual-snapshot-symbol\"></p>",
    "<div class=\"pingan-manual-snapshot-grid\" data-testid=\"pingan-manual-snapshot-fields\">",
    "<label>名称<input id=\"pingan-manual-name\" data-testid=\"pingan-manual-name\" autocomplete=\"off\" maxlength=\"120\"></label>",
    "<label>快照截至时间<input id=\"pingan-manual-source-as-of\" data-testid=\"pingan-manual-source-as-of\" type=\"datetime-local\" step=\"60\"></label>",
    "<label>数量<input id=\"pingan-manual-quantity\" data-testid=\"pingan-manual-quantity\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\"></label>",
    "<label>平均成本<input id=\"pingan-manual-average-cost\" data-testid=\"pingan-manual-average-cost\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\"></label>",
    "<label>当前权重（%）<input id=\"pingan-manual-current-weight\" data-testid=\"pingan-manual-current-weight\" type=\"number\" min=\"0\" max=\"100\" step=\"any\" inputmode=\"decimal\"></label>",
    "<label>历史最高权重（%）<input id=\"pingan-manual-max-weight\" data-testid=\"pingan-manual-max-weight\" type=\"number\" min=\"0\" max=\"100\" step=\"any\" inputmode=\"decimal\"></label>",
    "<label>未实现盈亏<input id=\"pingan-manual-unrealized-pnl\" data-testid=\"pingan-manual-unrealized-pnl\" type=\"number\" step=\"any\" inputmode=\"decimal\"></label>",
    "<label>币种<input id=\"pingan-manual-currency\" data-testid=\"pingan-manual-currency\" autocomplete=\"off\" maxlength=\"12\" value=\"HKD\"></label>",
    "</div>",
    "<div class=\"pingan-manual-snapshot-actions\" data-testid=\"pingan-manual-snapshot-actions\">",
    "<button type=\"button\" data-pingan-manual-action=\"save\" data-testid=\"pingan-manual-snapshot-save\">更新历史快照</button>",
    "<button type=\"button\" data-pingan-manual-action=\"load\" data-testid=\"pingan-manual-snapshot-load\">读取本地快照</button>",
    "<button type=\"button\" data-pingan-manual-action=\"clear\" data-testid=\"pingan-manual-snapshot-clear\">清除本地快照</button>",
    "</div>",
    "<ul id=\"pingan-manual-snapshot-summary\" data-testid=\"pingan-manual-snapshot-summary\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function setPinganManualField(id: string, value: string): void {
  const field = document.getElementById(id);
  if (field instanceof HTMLInputElement && document.activeElement !== field) field.value = value;
}



function renderAssistLocalRecordPanel(context: LocalStoragePanelsRenderContext): void {
  const { data, pinganManualSnapshot, pinganManualSnapshotState, pinganManualSnapshotMessage, pinganManualSnapshotClearSymbol, currentPinganManualSnapshotSymbol, assistLocalRecordDrafts, assistLocalRecordStatus, assistLocalRecordMessage, assistLocalRecordSnapshotSummary, assistLocalRecordSourceSignature, assistReviewKnowledgeStatus, assistReviewKnowledgeMessage, assistReviewKnowledgeLoadedSymbol, assistReviewKnowledgeCurrentSymbol, assistReviewKnowledgeEntries, assistReviewKnowledgeSelectedId, assistReviewKnowledgeFields, assistReviewKnowledgeClearConfirmation } = context;
  if (typeof document === "undefined") return;
  ensureAssistLocalRecordPanel();
  const section = document.getElementById("assist-local-records");
  const status = document.getElementById("assist-local-records-status");
  const source = document.getElementById("assist-local-records-source-signature");
  const summary = document.getElementById("assist-local-records-summary");
  const safety = document.getElementById("assist-local-records-safety");
  const researchThought = document.getElementById("assist-local-record-research-thought");
  const decisionThought = document.getElementById("assist-local-record-decision-thought");
  const evidenceGapNote = document.getElementById("assist-local-record-evidence-gap-note");
  const laterReviewNote = document.getElementById("assist-local-record-later-review-note");
  if (!section || !status || !source || !summary || !safety) return;
  if (!(researchThought instanceof HTMLTextAreaElement) || !(decisionThought instanceof HTMLTextAreaElement) || !(evidenceGapNote instanceof HTMLTextAreaElement) || !(laterReviewNote instanceof HTMLTextAreaElement)) return;

  const sourceSignature = assistLocalRecordSourceSignature;
  const enabled = Boolean(sourceSignature);
  section.setAttribute("data-state", enabled ? assistLocalRecordStatus : "fail_closed");
  section.setAttribute("data-storage", "browser_local_storage_only");
  section.setAttribute("data-official-record", "false");
  section.setAttribute("data-server-persisted", "false");
  section.setAttribute("data-sent", "false");
  section.setAttribute("data-broker-synced", "false");
  section.setAttribute("data-portfolio-fact", "false");
  section.setAttribute("data-source-signature-state", sourceSignature ? "current" : "unavailable");
  section.setAttribute("data-testid", "assist-local-records");

  status.textContent = enabled
    ? `${assistLocalRecordStatus}: ${assistLocalRecordMessage}`
    : "fail_closed: Load current decision-note workflow facts before showing or saving local records.";
  source.textContent = sourceSignature
    ? `Current source signature is present and scoped to this membership/workflow; full signature is not displayed as an authority claim.`
    : "No current source signature; no-selected-candidate, source-mismatch, conflict, unauthorized, offline, malformed, unavailable, stale, or superseded states hide stale local records.";

  researchThought.disabled = !enabled;
  decisionThought.disabled = !enabled;
  evidenceGapNote.disabled = !enabled;
  laterReviewNote.disabled = !enabled;
  researchThought.value = enabled ? assistLocalRecordDrafts.researchThought : "";
  decisionThought.value = enabled ? assistLocalRecordDrafts.decisionThought : "";
  evidenceGapNote.value = enabled ? assistLocalRecordDrafts.evidenceGapNote : "";
  laterReviewNote.value = enabled ? assistLocalRecordDrafts.laterReviewNote : "";

  renderList(summary, [
    assistLocalRecordDrafts.researchThought.trim() ? "Research thought exists in local record draft." : "Research thought is empty.",
    assistLocalRecordDrafts.decisionThought.trim() ? "Decision thought exists in local record draft." : "Decision thought is empty.",
    assistLocalRecordDrafts.evidenceGapNote.trim() ? "Evidence-gap note exists in local record draft." : "Evidence-gap note is empty.",
    assistLocalRecordDrafts.laterReviewNote.trim() ? "Later-review note exists in local record draft." : "Later-review note is empty.",
    ...assistLocalRecordSnapshotSummary,
    "Save stores only in this browser localStorage under the current source signature, including the selected membership version; it is not uploaded to any API, not written to any database, not an official review record, not server persisted, not sent, not broker synced, and not a portfolio fact."
  ], "Local record summary is unavailable.");
  renderList(safety, [
    "Local record safety: local-only, unofficial, browser-local storage only, source-scoped, not API uploaded, and not database written.",
    "Source signature binds selected membership version, decision context, follow-up workflow, and decision-note workflow before saved thoughts can load.",
    ...assistLocalRecordLifecycleSemantics().map((entry) => `Lifecycle ${entry.key}: Web=${entry.webState}; iOS=${entry.iosState}; ${entry.display}`),
    "Clear confirmation: clearing requires a second click, removes only the current source-signature browser record, and does not touch API facts or official review history.",
    "Fail-closed behavior: no-selected-candidate, unavailable, conflict, malformed, offline, unauthorized, not found, superseded, source-mismatch, stale, or source-change reads clear displayed record fields and do not restore stale saved thoughts.",
    "No recommendation, ranking, scoring, buy/sell/hold instruction, price objective, loss-limit, profit-objective, return forecast, timing, sizing, allocation, order, trade, fill, cash, fee, position, broker call, portfolio mutation, production claim, or real-account behavior."
  ], "Local record safety is unavailable.");
  for (const button of section.querySelectorAll<HTMLButtonElement>("button[data-local-record-action]")) {
    button.disabled = !enabled && button.dataset.localRecordAction !== "clear";
  }
  for (const button of section.querySelectorAll<HTMLButtonElement>("button[data-local-archive-action]")) button.disabled = !enabled;
  const archiveImport = document.getElementById("assist-local-archive-import");
  if (archiveImport instanceof HTMLInputElement) archiveImport.disabled = !enabled;
}

function ensureAssistLocalRecordPanel(): void {
  if (document.getElementById("assist-local-records")) return;
  const host = document.getElementById("assist-decision-note-workflow")
    ?? document.getElementById("assist-review-follow-up-workflow")
    ?? document.getElementById("assist-human-review-workspace")
    ?? document.getElementById("assist-advisory-scope")
    ?? document.getElementById("candidate-decision-intake")
    ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-local-records";
  section.className = "assist-local-records";
  section.dataset.testid = "assist-local-records";
  section.setAttribute("aria-label", "ASSIST local records");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST local records</h2>",
    "</div>",
    "<p id=\"assist-local-records-status\" data-testid=\"assist-local-records-status\"></p>",
    "<p id=\"assist-local-records-source-signature\" data-testid=\"assist-local-records-source-signature\"></p>",
    "<div class=\"local-record-grid\" data-testid=\"assist-local-records-fields\">",
    "<label>Research thought (browser-local unofficial record)<textarea id=\"assist-local-record-research-thought\" data-testid=\"assist-local-record-research-thought\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "<label>Decision thought (not official, not sent)<textarea id=\"assist-local-record-decision-thought\" data-testid=\"assist-local-record-decision-thought\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "<label>Evidence-gap note (source-scoped)<textarea id=\"assist-local-record-evidence-gap-note\" data-testid=\"assist-local-record-evidence-gap-note\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "<label>Later-review note (local only)<textarea id=\"assist-local-record-later-review-note\" data-testid=\"assist-local-record-later-review-note\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "</div>",
    "<div class=\"local-record-actions\" data-testid=\"assist-local-records-actions\">",
    "<button type=\"button\" data-local-record-action=\"save\" data-testid=\"assist-local-record-save\">Save local record</button>",
    "<button type=\"button\" data-local-record-action=\"load\" data-testid=\"assist-local-record-load\">Load saved local record</button>",
    "<button type=\"button\" data-local-record-action=\"clear\" data-testid=\"assist-local-record-clear\">Clear local record</button>",
    "<button type=\"button\" data-local-archive-action=\"export\" data-testid=\"assist-local-archive-export\">Export local memory</button>",
    "<label>Import local memory<input id=\"assist-local-archive-import\" data-testid=\"assist-local-archive-import\" type=\"file\" accept=\"application/json,.json\"></label>",
    "</div>",
    "<h3>Local record summary</h3>",
    "<ul id=\"assist-local-records-summary\" data-testid=\"assist-local-records-summary\"></ul>",
    "<h3>Safety boundary</h3>",
    "<ul id=\"assist-local-records-safety\" data-testid=\"assist-local-records-safety\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderAssistReviewKnowledgePanel(context: LocalStoragePanelsRenderContext): void {
  const { data, pinganManualSnapshot, pinganManualSnapshotState, pinganManualSnapshotMessage, pinganManualSnapshotClearSymbol, currentPinganManualSnapshotSymbol, assistLocalRecordDrafts, assistLocalRecordStatus, assistLocalRecordMessage, assistLocalRecordSnapshotSummary, assistLocalRecordSourceSignature, assistReviewKnowledgeStatus, assistReviewKnowledgeMessage, assistReviewKnowledgeLoadedSymbol, assistReviewKnowledgeCurrentSymbol, assistReviewKnowledgeEntries, assistReviewKnowledgeSelectedId, assistReviewKnowledgeFields, assistReviewKnowledgeClearConfirmation } = context;
  if (typeof document === "undefined") return;
  ensureAssistReviewKnowledgePanel();
  const section = document.getElementById("assist-review-knowledge");
  const status = document.getElementById("assist-review-knowledge-status");
  const source = document.getElementById("assist-review-knowledge-source");
  const history = document.getElementById("assist-review-knowledge-history");
  const details = document.getElementById("assist-review-knowledge-details");
  const safety = document.getElementById("assist-review-knowledge-safety");
  const evidenceLesson = document.getElementById("assist-review-knowledge-evidence-lesson");
  const processLesson = document.getElementById("assist-review-knowledge-process-lesson");
  const unresolvedQuestion = document.getElementById("assist-review-knowledge-unresolved-question");
  const uncertaintyNote = document.getElementById("assist-review-knowledge-uncertainty-note");
  if (!section || !status || !source || !details || !safety) return;
  if (!(history instanceof HTMLSelectElement)) return;
  if (!(evidenceLesson instanceof HTMLTextAreaElement) || !(processLesson instanceof HTMLTextAreaElement)) return;
  if (!(unresolvedQuestion instanceof HTMLTextAreaElement) || !(uncertaintyNote instanceof HTMLTextAreaElement)) return;

  const symbol = assistReviewKnowledgeCurrentSymbol;
  const sourceSignature = assistLocalRecordSourceSignature;
  const displayMatchesSymbol = symbol !== null && assistReviewKnowledgeLoadedSymbol === symbol;
  const entries = displayMatchesSymbol ? assistReviewKnowledgeEntries : [];
  const selected = entries.find((entry) => entry.envelope.knowledgeId === assistReviewKnowledgeSelectedId) ?? null;
  const currentCount = entries.filter((entry) => entry.relation === "current_source").length;
  const historicalCount = entries.filter((entry) => entry.relation === "historical_source").length;
  const unavailableCount = entries.filter((entry) => entry.relation === "source_unavailable").length;
  const editable = Boolean(symbol && sourceSignature);
  const invalidCollection = assistReviewKnowledgeStatus === "malformed"
    || assistReviewKnowledgeStatus === "mismatch"
    || (symbol !== null && assistReviewKnowledgeClearConfirmation === `${symbol}|collection`);

  section.dataset.state = displayMatchesSymbol ? assistReviewKnowledgeStatus : "source_unavailable";
  section.dataset.storage = "browser_local_storage_only";
  section.dataset.authority = "unofficial_local_only";
  section.dataset.officialReviewFact = "false";
  section.dataset.apiUploaded = "false";
  section.dataset.databaseWritten = "false";
  section.dataset.portfolioFact = "false";
  section.dataset.brokerSynced = "false";
  section.dataset.sourceSignatureState = sourceSignature ? "current" : "unavailable";
  status.textContent = displayMatchesSymbol
    ? `${assistReviewKnowledgeStatus}: ${assistReviewKnowledgeMessage}`
    : "source_unavailable: Symbol selection changed; load this symbol's local collection before displaying any entry.";
  source.textContent = symbol
    ? `Symbol=${symbol}; entries=${entries.length}; current_source=${currentCount}; historical_source=${historicalCount}; source_unavailable=${unavailableCount}. Exact source-signature match is required for current-source classification.`
    : "No canonical Hong Kong symbol is selected; no local retrospective knowledge is displayed.";

  history.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = entries.length === 0 ? "No browser-local knowledge entries" : "Select one local knowledge entry";
  history.append(placeholder);
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.envelope.knowledgeId;
    option.textContent = `${entry.relation} | ${entry.envelope.updatedAt} | ${entry.envelope.knowledgeId}`;
    option.selected = entry.envelope.knowledgeId === assistReviewKnowledgeSelectedId;
    history.append(option);
  }
  history.disabled = entries.length === 0;

  evidenceLesson.disabled = !editable;
  processLesson.disabled = !editable;
  unresolvedQuestion.disabled = !editable;
  uncertaintyNote.disabled = !editable;
  evidenceLesson.value = displayMatchesSymbol ? assistReviewKnowledgeFields.evidenceLesson : "";
  processLesson.value = displayMatchesSymbol ? assistReviewKnowledgeFields.processLesson : "";
  unresolvedQuestion.value = displayMatchesSymbol ? assistReviewKnowledgeFields.unresolvedQuestion : "";
  uncertaintyNote.value = displayMatchesSymbol ? assistReviewKnowledgeFields.uncertaintyNote : "";

  renderList(details, selected
    ? describeAssistReviewKnowledgeEntry(selected)
    : [
      `Collection status: ${entries.length} local entr${entries.length === 1 ? "y" : "ies"}; none selected.`,
      "Historical-source and source-unavailable entries remain explicit local references and are never silently reused as current facts.",
      "Selecting an entry only loads its local fields into this panel; saving always creates a new immutable entry."
    ], "Retrospective knowledge details are unavailable.");
  renderList(safety, [
    "Retrospective knowledge is source-scoped, browser-local, unofficial, historical assistance only.",
    "Official decision-check and post-decision-review IDs are references only; official facts are not copied, fabricated, mutated, or converted into local authority.",
    "Correction/replacement creates a new entry and preserves the earlier entry and lineage; scoped clear requires a second click.",
    "No API upload, server persistence, database write, official review mutation, official portfolio mutation, broker sync, trading instruction, execution, cash, fee, or position authority."
  ], "Retrospective knowledge safety boundary is unavailable.");

  for (const button of section.querySelectorAll<HTMLButtonElement>("button[data-review-knowledge-action]")) {
    const action = button.dataset.reviewKnowledgeAction;
    if (action === "load") button.disabled = symbol === null;
    if (action === "save") button.disabled = !editable;
    if (action === "replace") button.disabled = !editable || selected === null;
    if (action === "clear") button.disabled = selected === null && !invalidCollection;
  }
}

function ensureAssistReviewKnowledgePanel(): void {
  if (document.getElementById("assist-review-knowledge")) return;
  const host = document.getElementById("assist-local-records")
    ?? document.getElementById("assist-decision-note-workflow")
    ?? document.getElementById("assist-review-follow-up-workflow")
    ?? document.getElementById("assist-human-review-workspace")
    ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-review-knowledge";
  section.className = "assist-review-knowledge";
  section.dataset.testid = "assist-review-knowledge";
  section.setAttribute("aria-label", "ASSIST local retrospective knowledge");
  section.innerHTML = [
    "<div class=\"section-heading\"><h2>Local retrospective knowledge</h2></div>",
    "<p id=\"assist-review-knowledge-status\" data-testid=\"assist-review-knowledge-status\"></p>",
    "<p id=\"assist-review-knowledge-source\" data-testid=\"assist-review-knowledge-source\"></p>",
    "<label for=\"assist-review-knowledge-history\">Local knowledge history</label>",
    "<select id=\"assist-review-knowledge-history\" data-testid=\"assist-review-knowledge-history\"></select>",
    "<div class=\"assist-review-knowledge-grid\" data-testid=\"assist-review-knowledge-fields\">",
    "<label>Evidence lesson<textarea id=\"assist-review-knowledge-evidence-lesson\" data-testid=\"assist-review-knowledge-evidence-lesson\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "<label>Process lesson<textarea id=\"assist-review-knowledge-process-lesson\" data-testid=\"assist-review-knowledge-process-lesson\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "<label>Unresolved question<textarea id=\"assist-review-knowledge-unresolved-question\" data-testid=\"assist-review-knowledge-unresolved-question\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "<label>Uncertainty note<textarea id=\"assist-review-knowledge-uncertainty-note\" data-testid=\"assist-review-knowledge-uncertainty-note\" rows=\"3\" maxlength=\"4000\"></textarea></label>",
    "</div>",
    "<div class=\"assist-review-knowledge-actions\" data-testid=\"assist-review-knowledge-actions\">",
    "<button type=\"button\" data-review-knowledge-action=\"load\" data-testid=\"assist-review-knowledge-load\">Load local history</button>",
    "<button type=\"button\" data-review-knowledge-action=\"save\" data-testid=\"assist-review-knowledge-save\">Save new entry</button>",
    "<button type=\"button\" data-review-knowledge-action=\"replace\" data-testid=\"assist-review-knowledge-replace\">Save correction</button>",
    "<button type=\"button\" data-review-knowledge-action=\"clear\" data-testid=\"assist-review-knowledge-clear\">Clear selected entry</button>",
    "</div>",
    "<h3>Selected entry and lineage</h3>",
    "<ul id=\"assist-review-knowledge-details\" data-testid=\"assist-review-knowledge-details\"></ul>",
    "<h3>Safety boundary</h3>",
    "<ul id=\"assist-review-knowledge-safety\" data-testid=\"assist-review-knowledge-safety\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}
