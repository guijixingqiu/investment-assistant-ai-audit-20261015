import type { PinganSnapshotEnvelope } from "../../../packages/contracts/src/portfolioSnapshot.js";
import type { CoreJourneyData } from "./coreJourneyState.js";
import { browserLocalStorage } from "./browserStorage.js";
import { input } from "./view.js";
import { nullableInputValue, optionalManualNumber, requiredManualNumber } from "./manualFormValues.js";
import { clearPinganManualSnapshotFromStorage, loadPinganManualSnapshotFromStorage, PinganManualSnapshotStorageError, savePinganManualSnapshotToStorage, type PinganManualSnapshotEnvelope } from "./pinganManualSnapshotState.js";
import { parseHongKongSymbol } from "./securitySymbol.js";

export type PinganManualSnapshotUiState = "idle" | "account_scope_unavailable" | "missing" | "loaded" | "saved_local" | "confirm_clear" | "mismatch" | "malformed" | "legacy_unscoped" | "storage_unavailable";

export interface PinganManualSnapshotAccountScope { accountScopeId: string; symbol: string }
export interface PinganManualSnapshotControllerDependencies { currentAccountScope: () => PinganManualSnapshotAccountScope | null; currentJourney: () => CoreJourneyData | null; apiSnapshot: () => PinganSnapshotEnvelope | null; repaintJourney: () => void; renderPanel: () => void }

export class PinganManualSnapshotController {
  envelope: PinganManualSnapshotEnvelope | null = null;
  state: PinganManualSnapshotUiState = "idle";
  message = "选择有效港股标的后，可以读取或更新浏览器本地历史快照。";
  clearSymbol: string | null = null;
  clearAccountScopeId: string | null = null;

  constructor(private readonly dependencies: PinganManualSnapshotControllerDependencies) {}

  currentSymbol(): string | null {
    const parsed = parseHongKongSymbol(input("symbol-input").value);
    return parsed.ok ? parsed.value.symbol : null;
  }

  currentAccountScope(): PinganManualSnapshotAccountScope | null {
    const symbol = this.currentSymbol();
    return symbol ? this.accountScopeFor(symbol) : null;
  }

  invalidate(message: string): void {
    this.envelope = null;
    this.clearSymbol = this.clearAccountScopeId = null;
    this.state = "account_scope_unavailable";
    this.message = message;
  }

  restore(symbol: string): void {
    this.clearSymbol = this.clearAccountScopeId = null;
    const scope = this.accountScopeFor(symbol);
    if (!scope) {
      this.invalidate("已验证的当前账号范围不可用；不会读取或显示任何手工历史快照。");
      return;
    }
    const storage = browserLocalStorage();
    if (!storage) {
      this.envelope = null;
      this.state = "storage_unavailable";
      this.message = "浏览器 localStorage 不可用，不能读取手工历史快照。";
      return;
    }
    const result = loadPinganManualSnapshotFromStorage(storage, scope.accountScopeId, symbol);
    if (!result.ok) {
      this.envelope = null;
      this.state = result.state;
      this.message = result.message;
      if (result.state === "malformed" || result.state === "mismatch") {
        try {
          clearPinganManualSnapshotFromStorage(storage, scope.accountScopeId, symbol);
          this.message = `${result.message} 已清除当前标的的无效本地快照。`;
        } catch {
          this.state = "storage_unavailable";
          this.message = `${result.message} 浏览器 localStorage 清除失败；无效快照未显示，但仍保留在本地。`;
        }
      }
      return;
    }
    this.envelope = result.envelope;
    this.state = "loaded";
    this.message = result.message;
  }

  applyToCurrentJourney(): void {
    const journey = this.dependencies.currentJourney();
    const scope = journey ? this.accountScopeFor(journey.symbol.symbol) : null;
    if (!journey || !this.envelope || !scope || this.envelope.targetSymbol !== scope.symbol || this.envelope.accountScopeId !== scope.accountScopeId) {
      if (journey) journey.pingan = this.dependencies.apiSnapshot();
      if (this.envelope) this.invalidate("手工历史快照与当前已验证账号范围不匹配；已隐藏本地快照。");
      return;
    }
    journey.pingan = this.envelope.snapshot;
  }

  save(): void {
    const parsed = parseHongKongSymbol(input("symbol-input").value);
    if (!parsed.ok) {
      this.envelope = null;
      this.state = "malformed";
      this.message = `标的格式无效：${parsed.message}`;
      this.dependencies.renderPanel();
      return;
    }
    const scope = this.accountScopeFor(parsed.value.symbol);
    if (!scope) {
      this.invalidate("已验证的当前账号范围不可用；手工历史快照未保存。");
      this.dependencies.renderPanel();
      return;
    }
    const storage = browserLocalStorage();
    if (!storage) {
      this.state = "storage_unavailable";
      this.message = "浏览器 localStorage 不可用，手工快照未保存。";
      this.dependencies.renderPanel();
      return;
    }
    try {
      const importedAt = new Date().toISOString();
      const sourceAsOfRaw = input("pingan-manual-source-as-of").value.trim();
      if (!sourceAsOfRaw) throw new Error("必须填写快照截至时间");
      const payload = savePinganManualSnapshotToStorage(storage, {
        accountScopeId: scope.accountScopeId,
        symbol: parsed.value.symbol,
        sourceAsOf: sourceAsOfRaw,
        importedAt,
        name: nullableInputValue("pingan-manual-name"),
        quantity: requiredManualNumber("pingan-manual-quantity", "数量"),
        averageCost: optionalManualNumber("pingan-manual-average-cost", "平均成本"),
        currentWeight: optionalManualNumber("pingan-manual-current-weight", "当前权重", 100),
        maxWeight: optionalManualNumber("pingan-manual-max-weight", "历史最高权重", 100),
        unrealizedPnl: optionalManualNumber("pingan-manual-unrealized-pnl", "未实现盈亏"),
        currency: nullableInputValue("pingan-manual-currency"),
        replacesSnapshotId: this.envelope?.targetSymbol === parsed.value.symbol && this.envelope.accountScopeId === scope.accountScopeId ? this.envelope.snapshot.sourceSnapshotId : null
      });
      this.envelope = payload;
      this.state = "saved_local";
      this.message = `已更新 ${parsed.value.symbol} 的浏览器本地历史快照；未上传 API，未写数据库。`;
      this.clearSymbol = this.clearAccountScopeId = null;
      this.applyToCurrentJourney();
      if (this.dependencies.currentJourney()?.symbol.symbol === parsed.value.symbol) this.dependencies.repaintJourney();
      else this.dependencies.renderPanel();
    } catch (error) {
      this.state = error instanceof PinganManualSnapshotStorageError ? "storage_unavailable" : "malformed";
      this.message = `手工快照未保存：${error instanceof Error ? error.message : "输入无效"}`;
      this.dependencies.renderPanel();
    }
  }

  load(): void {
    const symbol = this.currentSymbol();
    if (!symbol) {
      this.envelope = null;
      this.state = "malformed";
      this.message = "标的格式无效，未读取本地历史快照。";
      this.dependencies.renderPanel();
      return;
    }
    this.restore(symbol);
    const journey = this.dependencies.currentJourney();
    if (journey?.symbol.symbol === symbol) {
      journey.pingan = this.dependencies.apiSnapshot();
      this.applyToCurrentJourney();
      this.dependencies.repaintJourney();
    } else {
      this.dependencies.renderPanel();
    }
  }

  clear(): void {
    const symbol = this.currentSymbol();
    if (!symbol) {
      this.state = "malformed";
      this.message = "标的格式无效，未清除任何本地历史快照。";
      this.dependencies.renderPanel();
      return;
    }
    const scope = this.accountScopeFor(symbol);
    if (!scope) {
      this.invalidate("已验证的当前账号范围不可用；未清除任何本地历史快照。");
      this.dependencies.renderPanel();
      return;
    }
    if (this.clearSymbol !== symbol || this.clearAccountScopeId !== scope.accountScopeId) {
      this.clearSymbol = symbol; this.clearAccountScopeId = scope.accountScopeId;
      this.state = "confirm_clear";
      this.message = `再次点击确认清除 ${symbol} 的浏览器本地历史快照。`;
      this.dependencies.renderPanel();
      return;
    }
    const storage = browserLocalStorage();
    if (!storage) {
      this.state = "storage_unavailable";
      this.message = `浏览器 localStorage 不可用，${symbol} 的本地历史快照未清除。`;
      this.dependencies.renderPanel();
      return;
    }
    try {
      clearPinganManualSnapshotFromStorage(storage, scope.accountScopeId, symbol);
    } catch {
      this.state = "storage_unavailable";
      this.message = `浏览器 localStorage 清除失败，${symbol} 的本地历史快照未删除。`;
      this.dependencies.renderPanel();
      return;
    }
    this.envelope = null;
    this.clearSymbol = this.clearAccountScopeId = null;
    this.state = "missing";
    this.message = `已清除 ${symbol} 的浏览器本地历史快照；API 和数据库事实未修改。`;
    const journey = this.dependencies.currentJourney();
    if (journey?.symbol.symbol === symbol) {
      journey.pingan = this.dependencies.apiSnapshot();
      this.dependencies.repaintJourney();
    } else {
      this.dependencies.renderPanel();
    }
  }

  displayProvenance(symbol: string): string {
    const scope = this.accountScopeFor(symbol);
    return scope && this.envelope?.targetSymbol === symbol && this.envelope.accountScopeId === scope.accountScopeId
      ? "browser_local_manual_import (historical-only, not uploaded, not database-backed)"
      : "authenticated_api_last_imported_snapshot";
  }

  private accountScopeFor(symbol: string): PinganManualSnapshotAccountScope | null {
    const scope = this.dependencies.currentAccountScope();
    return scope?.symbol === symbol ? scope : null;
  }
}
