import type { AssistReviewKnowledgeFields } from "../../../packages/contracts/src/assistReviewKnowledge.js";
import type { AssistReviewKnowledgeSnapshotAvailability } from "../../../packages/contracts/src/assistReviewKnowledgeBrowser.js";
import { browserLocalStorage } from "./browserStorage.js";
import { input } from "./view.js";
import { parseHongKongSymbol } from "./securitySymbol.js";
import {
  clearAssistReviewKnowledgeCollectionFromStorage,
  clearAssistReviewKnowledgeEntryFromStorage,
  loadAssistReviewKnowledgeFromStorage,
  saveAssistReviewKnowledgeToStorage,
  type AssistReviewKnowledgeLoadResult,
  type AssistReviewKnowledgeViewEntry
} from "./assistReviewKnowledgeState.js";
import {
  AssistReviewKnowledgeConflictError,
  AssistReviewKnowledgeStorageError,
  isUsableAssistReviewKnowledgeIdentity,
  type AssistReviewKnowledgeCurrentSourceIdentity
} from "./assistReviewKnowledgeIdentity.js";

export type AssistReviewKnowledgeUiState =
  | "idle"
  | "available"
  | "loaded"
  | "saved_local"
  | "confirm_clear"
  | "missing"
  | "source_unavailable"
  | "mismatch"
  | "malformed"
  | "conflict"
  | "storage_unavailable";

export interface AssistReviewKnowledgeReferences {
  reviewHistoryAsOf: string | null;
  decisionCheckIds: string[];
  postDecisionReviewIds: string[];
  snapshotAvailability: AssistReviewKnowledgeSnapshotAvailability;
}

export interface AssistReviewKnowledgeControllerDependencies {
  currentSource: () => AssistReviewKnowledgeCurrentSourceIdentity | null;
  reviewReferences: () => AssistReviewKnowledgeReferences;
  localRecordId: () => string | null;
  renderPanel: () => void;
}

const emptyFields: AssistReviewKnowledgeFields = {
  evidenceLesson: "",
  processLesson: "",
  unresolvedQuestion: "",
  uncertaintyNote: ""
};

export class AssistReviewKnowledgeController {
  fields: AssistReviewKnowledgeFields = { ...emptyFields };
  entries: AssistReviewKnowledgeViewEntry[] = [];
  status: AssistReviewKnowledgeUiState = "idle";
  message = "Load a canonical Hong Kong symbol to inspect browser-local retrospective knowledge.";
  loadedSymbol: string | null = null;
  selectedId: string | null = null;
  clearConfirmation: string | null = null;

  constructor(private readonly dependencies: AssistReviewKnowledgeControllerDependencies) {}

  currentSymbol(): string | null {
    const parsed = parseHongKongSymbol(input("symbol-input").value);
    return parsed.ok ? parsed.value.symbol : null;
  }

  clearDisplay(message: string): void {
    this.fields = { ...emptyFields };
    this.entries = [];
    this.selectedId = null;
    this.loadedSymbol = null;
    this.clearConfirmation = null;
    this.status = "source_unavailable";
    this.message = message;
  }

  restore(symbol: string): AssistReviewKnowledgeLoadResult | null {
    this.fields = { ...emptyFields };
    this.entries = [];
    this.selectedId = null;
    this.clearConfirmation = null;
    this.loadedSymbol = symbol;
    const currentSource = this.dependencies.currentSource();
    if (!isUsableAssistReviewKnowledgeIdentity(currentSource)) {
      this.loadedSymbol = null;
      this.status = "source_unavailable";
      this.message = "Current membership and source identity are unavailable; browser localStorage was not read and no retrospective knowledge is displayed.";
      return null;
    }
    const storage = browserLocalStorage();
    if (!storage) {
      this.status = "storage_unavailable";
      this.message = "Browser localStorage is unavailable; no retrospective knowledge is displayed.";
      return null;
    }
    const result = loadAssistReviewKnowledgeFromStorage(storage, symbol, currentSource);
    if (!result.ok) {
      this.status = result.state;
      this.message = result.message;
      return result;
    }
    this.entries = result.entries;
    this.status = "loaded";
    this.message = result.message;
    return result;
  }

  load(): void {
    const symbol = this.currentSymbol();
    if (!symbol) {
      this.clearDisplay("Invalid symbol; no retrospective knowledge collection is read.");
      this.status = "malformed";
    } else {
      this.restore(symbol);
    }
    this.dependencies.renderPanel();
  }

  save(replaceSelected: boolean): void {
    const symbol = this.currentSymbol();
    const currentSource = this.dependencies.currentSource();
    this.clearConfirmation = null;
    if (!symbol || !isUsableAssistReviewKnowledgeIdentity(currentSource)) {
      this.clearDisplay("Knowledge save is blocked until the selected membership and current source signature are available; old knowledge display is cleared.");
      if (!symbol) this.status = "malformed";
      this.dependencies.renderPanel();
      return;
    }
    const storage = browserLocalStorage();
    if (!storage) {
      this.status = "storage_unavailable";
      this.message = "Browser localStorage is unavailable; retrospective knowledge was not saved.";
      this.dependencies.renderPanel();
      return;
    }
    if (replaceSelected && !this.selectedId) {
      this.status = "conflict";
      this.message = "Select one existing knowledge entry before saving a correction/replacement.";
      this.dependencies.renderPanel();
      return;
    }
    try {
      const saved = saveAssistReviewKnowledgeToStorage(storage, {
        symbol,
        membershipId: currentSource.membershipId,
        membershipVersion: currentSource.membershipVersion,
        sourceSignature: currentSource.sourceSignature,
        decisionContextId: currentSource.decisionContextId,
        decisionContextHash: currentSource.decisionContextHash,
        localRecordId: this.dependencies.localRecordId(),
        ...this.dependencies.reviewReferences(),
        correctionOfKnowledgeId: replaceSelected ? this.selectedId : null,
        replacesKnowledgeId: replaceSelected ? this.selectedId : null,
        fields: this.fields,
        nowIso: new Date().toISOString()
      }, currentSource);
      const reloadResult = this.restore(symbol);
      const reloadedEntry = reloadResult?.ok
        ? reloadResult.entries.find((candidate) => candidate.envelope.knowledgeId === saved.entry.knowledgeId)
        : null;
      if (!reloadResult?.ok || !reloadedEntry) {
        if (reloadResult?.ok) this.status = "conflict";
        this.message = `Knowledge write could not be verified after reload; success is not shown. ${this.message}`;
      } else {
        this.selectedId = saved.entry.knowledgeId;
        this.fields = { ...saved.entry.fields };
        this.status = "saved_local";
        this.message = replaceSelected
          ? "Saved a new browser-local correction/replacement entry; the older entry remains historical and unchanged."
          : "Saved a new browser-local retrospective knowledge entry; no API or database write occurred.";
      }
    } catch (error) {
      this.entries = [];
      this.selectedId = null;
      this.fields = { ...emptyFields };
      this.status = error instanceof AssistReviewKnowledgeStorageError
        ? "storage_unavailable"
        : error instanceof AssistReviewKnowledgeConflictError
          ? "conflict"
          : "malformed";
      this.message = `Knowledge save failed closed: ${error instanceof Error ? error.message : "invalid local knowledge"}`;
    }
    this.dependencies.renderPanel();
  }

  select(knowledgeId: string): void {
    this.clearConfirmation = null;
    if (!isUsableAssistReviewKnowledgeIdentity(this.dependencies.currentSource())) {
      this.clearDisplay("Current membership and source identity are unavailable; old knowledge display is cleared.");
      this.dependencies.renderPanel();
      return;
    }
    const selected = this.entries.find((entry) => entry.envelope.knowledgeId === knowledgeId) ?? null;
    if (!selected) {
      this.selectedId = null;
      this.fields = { ...emptyFields };
      this.status = "conflict";
      this.message = "Selected knowledge entry is no longer present; old editor content is cleared.";
    } else {
      this.selectedId = selected.envelope.knowledgeId;
      this.fields = { ...selected.envelope.fields };
      this.status = "loaded";
      this.message = selected.message;
    }
    this.dependencies.renderPanel();
  }

  clear(): void {
    const symbol = this.currentSymbol();
    const currentSource = this.dependencies.currentSource();
    if (!symbol || !isUsableAssistReviewKnowledgeIdentity(currentSource)) {
      this.clearDisplay(symbol
        ? "Current membership and source identity are unavailable; no retrospective knowledge was cleared."
        : "Invalid symbol; no retrospective knowledge was cleared.");
      this.status = symbol ? "source_unavailable" : "malformed";
      this.dependencies.renderPanel();
      return;
    }
    const collectionTarget = `${symbol}|collection`;
    const clearInvalidCollection = this.status === "malformed"
      || this.status === "mismatch"
      || this.clearConfirmation === collectionTarget;
    const target = clearInvalidCollection ? collectionTarget : this.selectedId ? `${symbol}|${this.selectedId}` : null;
    if (!target) {
      this.status = "conflict";
      this.message = "Select one knowledge entry before clearing, or load an invalid collection that requires explicit cleanup.";
      this.dependencies.renderPanel();
      return;
    }
    if (this.clearConfirmation !== target) {
      this.clearConfirmation = target;
      this.status = "confirm_clear";
      this.message = clearInvalidCollection
        ? `Click clear again to remove only the invalid browser-local ${symbol} knowledge collection.`
        : "Click clear again to remove only the selected browser-local knowledge entry; API facts and official review history are untouched.";
      this.dependencies.renderPanel();
      return;
    }
    const storage = browserLocalStorage();
    if (!storage) {
      this.status = "storage_unavailable";
      this.message = "Browser localStorage is unavailable; retrospective knowledge was not cleared.";
      this.dependencies.renderPanel();
      return;
    }
    try {
      if (clearInvalidCollection) clearAssistReviewKnowledgeCollectionFromStorage(storage, symbol, currentSource);
      else clearAssistReviewKnowledgeEntryFromStorage(storage, symbol, this.selectedId ?? "", currentSource);
      this.restore(symbol);
      this.message = clearInvalidCollection
        ? "Invalid browser-local symbol knowledge collection cleared; API and official facts were untouched."
        : "Selected browser-local knowledge entry cleared; other entries and official facts were untouched.";
    } catch (error) {
      this.entries = [];
      this.selectedId = null;
      this.fields = { ...emptyFields };
      this.status = error instanceof AssistReviewKnowledgeStorageError ? "storage_unavailable" : "conflict";
      this.message = `Knowledge clear failed closed: ${error instanceof Error ? error.message : "local clear failed"}`;
    }
    this.clearConfirmation = null;
    this.dependencies.renderPanel();
  }

  updateFields(fields: AssistReviewKnowledgeFields): void {
    if (!isUsableAssistReviewKnowledgeIdentity(this.dependencies.currentSource())) {
      this.clearDisplay("Current membership and source identity are unavailable; old knowledge display and editor content are cleared.");
      this.dependencies.renderPanel();
      return;
    }
    this.fields = fields;
    this.clearConfirmation = null;
    this.status = this.dependencies.currentSource() ? "available" : "source_unavailable";
    this.message = this.dependencies.currentSource()
      ? "Retrospective knowledge draft changed in browser memory; save creates a new local-only entry."
      : "Current source is unavailable; historical knowledge remains reference-only and edits cannot be saved.";
    this.dependencies.renderPanel();
  }

  clearSelection(): void {
    if (!isUsableAssistReviewKnowledgeIdentity(this.dependencies.currentSource())) {
      this.clearDisplay("Current membership and source identity are unavailable; old knowledge display is cleared.");
      this.dependencies.renderPanel();
      return;
    }
    this.selectedId = null;
    this.fields = { ...emptyFields };
    this.clearConfirmation = null;
    this.status = this.dependencies.currentSource() ? "available" : "source_unavailable";
    this.message = "No retrospective knowledge entry is selected; the editor is cleared.";
    this.dependencies.renderPanel();
  }
}
