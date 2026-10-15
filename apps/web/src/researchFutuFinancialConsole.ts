import {
  FUTU_FINANCIAL_STATEMENT_SOURCE, FUTU_STATEMENT_CODE, FUTU_STATEMENT_TYPES,
  type FutuFinancialBridgePage, type FutuFinancialCaptureData, type FutuFinancialPageData,
  type FutuStatementType
} from "../../../packages/contracts/src/researchFutuFinancialStatement.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import type { ExactCockpitMembership } from "./dailyResearchCockpit.js";
import { documentFailureMessage, fetchResearchDocumentJson, membershipKey, researchDocumentSha256 } from "./researchDocumentTransport.js";

const tableNames: Record<FutuStatementType, string> = {
  income: "利润表", balance_sheet: "资产负债表", cash_flow: "现金流量表"
};
const statusNames = { complete: "本次请求分页完成", partial: "部分取得", unavailable: "本次不可用" } as const;
const reasonNames: Record<string, string> = {
  NO_PAGE: "未取得页面", NO_REPORTS: "本次页面没有报告", CAPTURE_DEADLINE: "抓取时间达到上限",
  PAGE_LIMIT: "达到本次页数上限", CURSOR_LOOP: "分页游标重复", DUPLICATE_PERIOD: "报告期间重复",
  PERIOD_CONFLICT: "同一期间报告内容冲突", PERIOD_ORDER_INVALID: "报告期间顺序异常",
  MIXED_CURRENCY: "同表报告币种不一致", BRIDGE_UNAVAILABLE: "富途连接不可用",
  BRIDGE_HTTP_ERROR: "富途连接返回错误", PAGE_REQUEST_FAILED: "页面请求失败",
  PAGE_TOO_LARGE: "页面超出大小限制", PAGE_INVALID_JSON: "页面格式无效", PAGE_IDENTITY_INVALID: "页面身份校验失败"
};

function rootPath(memberId: string): string {
  return `/api/mobile/research/candidate-memberships/${encodeURIComponent(memberId)}/futu-financial-statement-captures`;
}

export function acceptFutuFinancialCapture(value: unknown, member: ExactCockpitMembership): FutuFinancialCaptureData {
  if (!value || typeof value !== "object") throw new Error("富途捕获格式无效。 ");
  const capture = value as FutuFinancialCaptureData;
  if (capture.membershipId !== member.id || capture.symbol !== member.symbol || capture.actorType !== "user"
    || !capture.actorId || !Number.isSafeInteger(capture.membershipVersion) || capture.membershipVersion < 1
    || capture.sourceClassification !== FUTU_FINANCIAL_STATEMENT_SOURCE || !Array.isArray(capture.pages)
    || !capture.tables || !capture.unknowns || !capture.id) throw new Error("富途捕获身份或来源不一致。 ");
  const unknowns = ["periodStart", "amountUnitScale", "consolidationScope", "restatementStatus", "issuerOriginal", "latestRequiredPeriod", "historicalCoverage"] as const;
  if (unknowns.some(key => capture.unknowns[key] !== "UNKNOWN")) throw new Error("富途未知字段已发生漂移。 ");
  for (const type of FUTU_STATEMENT_TYPES) {
    const state = capture.tables[type];
    const pages = capture.pages.filter(page => page.statementType === type);
    if (!state || !["complete", "partial", "unavailable"].includes(state.status)
      || !Number.isSafeInteger(state.pageCount) || state.pageCount !== pages.length
      || pages.some(page => !Array.isArray(page.reports))
      || !Number.isSafeInteger(state.reportCount) || state.reportCount !== pages.reduce((n, p) => n + p.reports.length, 0))
      throw new Error(`富途${tableNames[type]}状态与已保存页不一致。`);
    for (const page of pages) {
      if (page.captureId !== capture.id || !page.id || !Number.isSafeInteger(page.pageNumber)
        || page.pageNumber < 1 || !Number.isSafeInteger(page.byteLength) || page.byteLength < 1
        || !/^[a-f0-9]{64}$/.test(page.rawSha256) || !["available", "unavailable", "unknown"].includes(page.originalAvailability)
        || !Array.isArray(page.reports)) throw new Error("富途页身份或摘要无效。 ");
    }
  }
  return capture;
}

export async function verifyFutuFinancialOriginal(bytes: Uint8Array, headerHash: string | null,
  capture: FutuFinancialCaptureData, page: FutuFinancialPageData): Promise<{ body: FutuFinancialBridgePage; text: string }> {
  if (page.captureId !== capture.id || !capture.pages.some(item => item.id === page.id && item.rawSha256 === page.rawSha256)
    || headerHash !== page.rawSha256 || bytes.length !== page.byteLength
    || await researchDocumentSha256(bytes) !== page.rawSha256) throw new Error("原始页身份、长度或 SHA-256 校验失败。 ");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const body = JSON.parse(text) as FutuFinancialBridgePage;
  if (body.ok !== true || body.source !== FUTU_FINANCIAL_STATEMENT_SOURCE || body.symbol !== capture.symbol
    || body.statement_type !== FUTU_STATEMENT_CODE[page.statementType] || body.num !== capture.pageSize
    || body.requested_next_key !== page.requestedCursor || body.next_key !== page.nextCursor
    || Date.parse(body.captured_at) !== Date.parse(page.capturedAt) || !Array.isArray(body.report_list)
    || body.report_list.length !== page.reports.length) throw new Error("原始页与捕获身份或页摘要不一致。 ");
  if (body.report_list.some((report, index) => report.period_text !== page.reports[index].periodText
    || report.financial_type !== page.reports[index].financialType
    || report.fiscal_year !== page.reports[index].fiscalYear
    || report.currency_code !== page.reports[index].currencyCode
    || !Array.isArray(report.item_list) || report.item_list.length !== page.reports[index].itemCount))
    throw new Error("原始报告与页摘要不一致。 ");
  return { body, text };
}

function child<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

export class ResearchFutuFinancialConsole {
  private member: ExactCockpitMembership | null = null;
  private captures: FutuFinancialCaptureData[] = [];
  private current: FutuFinancialCaptureData | null = null;
  private original: { page: FutuFinancialPageData; body: FutuFinancialBridgePage; text: string } | null = null;
  private generation = 0;
  private runRevision = 0;
  private busy = false;
  private retry: { fingerprint: string; key: string } | null = null;
  private message = "请选择当前研究公司。";
  private doc: Document | null = null;

  constructor(private readonly readAuth: () => WebApiAuth | null, private readonly writeAuth: () => WebApiAuth | null) {}

  mount(doc: Document): void {
    this.doc = doc;
    this.el("research-futu-refresh")?.addEventListener("click", () => void this.run(() => this.refresh(), "读取"));
    this.el("research-futu-capture")?.addEventListener("click", () => void this.run(() => this.capture(), "抓取"));
    this.el("research-futu-captures")?.addEventListener("click", event => {
      const target = event.target;
      if (target instanceof Element) {
        const id = target.closest<HTMLElement>("[data-futu-capture]")?.dataset.futuCapture;
        if (id) void this.run(() => this.openCapture(id), "捕获详情");
      }
    });
    this.el("research-futu-detail")?.addEventListener("click", event => {
      const target = event.target;
      if (target instanceof Element) {
        const id = target.closest<HTMLElement>("[data-futu-page]")?.dataset.futuPage;
        if (id) void this.run(() => this.openPage(id), "原始页");
      }
    });
    this.render();
  }

  syncMembership(next: ExactCockpitMembership | null): void {
    if (membershipKey(next) === membershipKey(this.member)) return;
    this.generation++;
    this.runRevision++;
    this.busy = false;
    this.member = next;
    this.clear();
    this.retry = null;
    this.message = next ? `当前 ${next.symbol}。点击读取最近财报。` : "请选择当前研究公司。";
    this.render();
  }

  invalidateAuthorization(message: string): void {
    this.generation++;
    this.runRevision++;
    this.busy = false;
    this.clear();
    this.retry = null;
    this.message = `${message} 富途旧内容已清除。`;
    this.render();
  }

  private el(id: string): HTMLElement | null { return this.doc?.getElementById(id) ?? null; }
  private clear(): void { this.captures = []; this.current = null; this.original = null; }
  private requireMember(): ExactCockpitMembership {
    if (!this.member) throw new Error("请先选择当前研究公司。 ");
    return { ...this.member };
  }
  private requireAuth(write: boolean): WebApiAuth {
    const auth = write ? this.writeAuth() : this.readAuth();
    if (!auth) throw new Error(write ? "需要研究写入授权。" : "需要读取授权。");
    return auth;
  }
  private ensure(member: ExactCockpitMembership, generation: number, auth: WebApiAuth, write: boolean): void {
    if (generation !== this.generation || membershipKey(member) !== membershipKey(this.member)) {
      throw new Error("成员、连接或授权已变化；旧富途结果已清除。 ");
    }
    if (!sameWebApiAuth(auth, write ? this.writeAuth() : this.readAuth())) {
      this.invalidateAuthorization("连接或授权已变化；");
      throw new Error("连接或授权已变化。 ");
    }
  }

  private async refresh(): Promise<void> {
    const member = this.requireMember(), auth = this.requireAuth(false), generation = ++this.generation;
    this.clear(); this.message = "正在读取最近 20 次捕获…"; this.render();
    const envelope = await fetchResearchDocumentJson(rootPath(member.id), auth, { cache: "no-store" }) as { ok?: boolean; data?: unknown };
    this.ensure(member, generation, auth, false);
    if (!envelope.ok || !Array.isArray(envelope.data) || envelope.data.length > 20) throw new Error("富途列表格式无效。 ");
    this.captures = envelope.data.map(value => acceptFutuFinancialCapture(value, member));
    this.message = this.captures.length ? `最近 ${this.captures.length} 次捕获；请选择一次查看。` : "当前公司尚无富途财报捕获。";
    this.render();
  }

  private async capture(): Promise<void> {
    const member = this.requireMember(), auth = this.requireAuth(true), generation = this.generation;
    const pageSize = Number((this.el("research-futu-page-size") as HTMLInputElement | null)?.value);
    const maxPagesPerTable = Number((this.el("research-futu-max-pages") as HTMLInputElement | null)?.value);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 20 || !Number.isSafeInteger(maxPagesPerTable)
      || maxPagesPerTable < 1 || maxPagesPerTable > 4) throw new Error("每页报告数须为 1–20，每表页数须为 1–4。 ");
    const fingerprint = `${membershipKey(member)}:${pageSize}:${maxPagesPerTable}`;
    if (!this.retry || this.retry.fingerprint !== fingerprint) this.retry = { fingerprint, key: crypto.randomUUID() };
    this.current = null; this.original = null;
    this.message = "正在按明确请求抓取三表…"; this.render();
    const envelope = await fetchResearchDocumentJson(rootPath(member.id), auth, {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipVersion: member.version, pageSize, maxPagesPerTable,
        userRequested: true, idempotencyKey: this.retry.key })
    }) as { ok?: boolean; data?: unknown };
    this.ensure(member, generation, auth, true);
    if (!envelope.ok) throw new Error("富途抓取响应无效。 ");
    const saved = acceptFutuFinancialCapture(envelope.data, member);
    if (saved.membershipVersion !== member.version) throw new Error("抓取回读版本漂移。 ");
    const readAuth = this.requireAuth(false);
    const reread = await fetchResearchDocumentJson(`${rootPath(member.id)}/${encodeURIComponent(saved.id)}`, readAuth,
      { cache: "no-store" }) as { ok?: boolean; data?: unknown };
    this.ensure(member, generation, readAuth, false);
    if (!reread.ok || acceptFutuFinancialCapture(reread.data, member).id !== saved.id)
      throw new Error("抓取后回读失败。 ");
    this.retry = null;
    await this.refresh();
    if (this.member && membershipKey(member) === membershipKey(this.member)) await this.openCapture(saved.id);
  }

  private async openCapture(id: string): Promise<void> {
    const member = this.requireMember(), auth = this.requireAuth(false), generation = ++this.generation;
    this.current = null; this.original = null; this.render();
    const envelope = await fetchResearchDocumentJson(`${rootPath(member.id)}/${encodeURIComponent(id)}`, auth, { cache: "no-store" }) as { ok?: boolean; data?: unknown };
    this.ensure(member, generation, auth, false);
    if (!envelope.ok) throw new Error("富途详情响应无效。 ");
    const capture = acceptFutuFinancialCapture(envelope.data, member);
    if (capture.id !== id) throw new Error("捕获 ID 漂移。 ");
    this.current = capture;
    this.message = capture.membershipVersion === member.version ? "已重新读取财报详情。" : "已打开历史记录。";
    this.render();
  }

  private async openPage(id: string): Promise<void> {
    const member = this.requireMember(), capture = this.current, auth = this.requireAuth(false), generation = ++this.generation;
    if (!capture) throw new Error("请先重新读取捕获详情。 ");
    const page = capture.pages.find(value => value.id === id);
    if (!page || page.originalAvailability !== "available") throw new Error("当前原始页不可用；请重新读取详情。 ");
    this.original = null; this.render();
    const response = await fetch(`${rootPath(member.id)}/${encodeURIComponent(capture.id)}/pages/${encodeURIComponent(page.id)}/content`, {
      cache: "no-store", headers: { [auth.headerName]: auth.token, accept: "application/octet-stream" }
    });
    this.ensure(member, generation, auth, false);
    if (!response.ok) throw new Error(`原始页读取失败：HTTP ${response.status}。`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.ensure(member, generation, auth, false);
    const { body, text } = await verifyFutuFinancialOriginal(bytes, response.headers.get("x-source-raw-sha256"), capture, page);
    this.ensure(member, generation, auth, false);
    if (this.current?.id !== capture.id) throw new Error("当前捕获已变化。 ");
    this.original = { page, body, text };
    this.message = `${tableNames[page.statementType]}第 ${page.pageNumber} 页原字节已核验；金额单位倍率未知。`;
    this.render();
  }

  private async run(action: () => Promise<void>, label: string): Promise<void> {
    if (this.busy) return;
    const revision = ++this.runRevision;
    this.busy = true; this.render();
    try { await action(); }
    catch (error) {
      if (revision !== this.runRevision) return;
      this.original = null;
      this.message = `${label}失败：${documentFailureMessage(error)}`;
    } finally {
      if (revision === this.runRevision) { this.busy = false; this.render(); }
    }
  }

  private render(): void {
    if (!this.doc) return;
    const host = this.el("research-futu-financial-console");
    if (host) host.dataset.state = !this.member ? "blocked" : this.current ? "available" : "idle";
    const membership = this.el("research-futu-membership");
    if (membership) membership.textContent = this.member ? this.member.symbol : "请选择当前研究公司。";
    const status = this.el("research-futu-status"); if (status) status.textContent = this.message;
    for (const id of ["research-futu-refresh", "research-futu-capture"]) {
      const button = this.el(id) as HTMLButtonElement | null;
      if (button) button.disabled = this.busy || !this.member;
    }
    const list = this.el("research-futu-captures");
    if (list) list.replaceChildren(...this.captures.map(capture => {
      const row = child("li"), button = child("button", `${capture.capturedAt} · ${capture.pages.length} 页${capture.membershipVersion !== this.member?.version ? " · 历史记录" : ""}`);
      button.type = "button"; button.dataset.futuCapture = capture.id; button.disabled = this.busy; row.append(button); return row;
    }));
    const detail = this.el("research-futu-detail");
    if (detail) {
      detail.replaceChildren();
      if (this.current) {
        const capture = this.current;
        detail.append(child("p", `富途提供方 · ${capture.symbol} · ${capture.capturedAt}${capture.membershipVersion !== this.member?.version ? " · 历史记录" : ""}`));
        for (const type of FUTU_STATEMENT_TYPES) {
          const state = capture.tables[type], section = child("section"), title = child("h3", `${tableNames[type]} · ${statusNames[state.status]}`);
          section.append(title, child("p", `${state.reportCount} 份报告，${state.pageCount} 页；${state.reasonCode ? `${reasonNames[state.reasonCode] ?? "提供方页面不可用"}（${state.reasonCode}）` : "无附加原因"}。分页完成仅指本次请求。`));
          for (const page of capture.pages.filter(item => item.statementType === type)) {
            const periods = page.reports.map(report => report.periodText || report.periodEnd);
            const span = periods.length > 1 ? `${periods[0]} 至 ${periods.at(-1)}` : periods[0] ?? "无报告";
            const availability = page.originalAvailability === "available" ? "可打开原件" :
              page.originalAvailability === "unavailable" ? "原件缺失或损坏" : "原件待核验";
            const button = child("button", `第 ${page.pageNumber} 页 · ${page.reports.length} 份报告 · ${span} · ${availability}`);
            button.type = "button"; button.dataset.futuPage = page.id; button.disabled = this.busy || page.originalAvailability !== "available";
            section.append(button);
          }
          detail.append(section);
        }
        const evidence = child("details"), summary = child("summary", "捕获身份与待核对口径");
        evidence.append(summary,
          child("p", `成员 ${capture.membershipId} · 捕获时 v${capture.membershipVersion} · 当前 v${this.member?.version ?? "?"} · ${capture.id} · 每页 ${capture.pageSize} 份报告 · 每表最多 ${capture.maxPagesPerTable} 页`),
          child("p", "期间起日、金额单位倍率、合并口径、重述、发行人原文、最新应有期与历史覆盖范围仍未知。请另行核对发行人原文。"));
        detail.append(evidence);
      }
      if (this.original) {
        const { page, body } = this.original;
        detail.append(child("h3", `${tableNames[page.statementType]} · 第 ${page.pageNumber} 页`));
        for (const [index, report] of body.report_list.entries()) {
          const summary = page.reports[index], section = child("details");
          section.append(child("summary", `${report.period_text} · ${summary.periodEnd} · ${report.currency_code || "币种未知"} · ${report.financial_type}`),
            child("p", "以下为提供方原数值；金额单位倍率未知，未换算。"));
          const table = child("table"), head = child("tr");
          head.append(child("th", "科目"), child("th", "原数值")); table.append(head);
          for (const item of report.item_list) {
            const row = child("tr"); row.append(child("td", item.display_name), child("td", item.data === null ? "未提供" : String(item.data))); table.append(row);
          }
          section.append(table); detail.append(section);
        }
      }
    }
    const original = this.el("research-futu-original"); if (original) original.textContent = this.original?.text ?? "尚未打开并核验原始页。";
    const panel = this.el("research-futu-original-panel") as HTMLDetailsElement | null;
    if (panel && !this.original) panel.open = false;
  }
}
