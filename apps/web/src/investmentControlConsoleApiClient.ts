import {
  validateAnnualValuationQuantWorkbenchEnvelope,
  validateAnnualQuantFilterInput,
  validateAnnualValuationScenarioInput,
  type AnnualQuantFilterInput,
  type AnnualValuationQuantWorkbenchEnvelope,
  type AnnualValuationScenarioInput
} from "../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import {
  validateCreateEvidenceRequest,
  validateEvidenceWriteEnvelope,
  validateResearchProfileWriteEnvelope,
  validateUpdateResearchProfileRequest,
  type CreateEvidenceRequest,
  type EvidenceItemData,
  type ResearchProfileData,
  type ResearchWriteEnvelope,
  type UpdateResearchProfileRequest
} from "../../../packages/contracts/src/research.js";
import type { AnnualConditionalDecisionPreviewEnvelope } from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import {
  validateCandidateDecisionIntakeEnvelope,
  type CandidateDecisionIntakeEnvelope
} from "../../../packages/contracts/src/candidateDecisionIntake.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import type { WebFailureState } from "./decisionJourneyIngress.js";
import { validateAnnualConditionalDecisionPreviewForBrowser } from "./annualConditionalDecisionBrowser.js";
import { annualConditionalReadMatchesMembership, annualValuationReadMatchesMembership } from "./investmentControlConsoleReadValidation.js";

export interface InvestmentConsoleSourceBinding {
  membershipId: string;
  membershipVersion: number;
  membershipState: "tracked" | "paused" | "archived";
  market: "HK";
  code: string;
  symbol: string;
}

export type ResearchProfileFields = Omit<UpdateResearchProfileRequest,
  "market" | "code" | "membershipId" | "membershipVersion" | "idempotencyKey">;
export type ResearchEvidenceFields = Omit<CreateEvidenceRequest,
  "membershipId" | "membershipVersion" | "idempotencyKey">;

export interface AnnualConsoleInputs {
  valuation: AnnualValuationScenarioInput;
  quantFilter: AnnualQuantFilterInput;
  scenarioAmounts: number[];
  selectedPortfolioScenarioIndex: number;
}

export type ConsoleApiResult<T> = { ok: true; value: T } | { ok: false; state: WebFailureState; reason: string };
const MAX_UNRESOLVED_WRITE_RETRIES = 64;
const RETRY_VALIDATION_KEY = "web-validation-only";
type RetryRecord = Readonly<{ identity: string; key: string; auth: WebApiAuth }>;
type RetryReservation = { ok: true; record: RetryRecord } | { ok: false; result: ConsoleApiResult<never> };
type WriteOutcome = Readonly<{ result: ConsoleApiResult<unknown>; terminalClientResponse: boolean }>;
export class InvestmentControlConsoleApiClient {
  private readonly retries = new Map<string, RetryRecord>();
  private readonly fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher.bind(globalThis);
  }
  async updateResearchProfile(
    auth: WebApiAuth,
    source: InvestmentConsoleSourceBinding,
    fields: ResearchProfileFields
  ): Promise<ConsoleApiResult<ResearchWriteEnvelope<ResearchProfileData>>> {
    const path = `/api/mobile/research/profiles/${source.market}/${source.code}`;
    const validationRequest: UpdateResearchProfileRequest = {
      market: source.market,
      code: source.code,
      membershipId: source.membershipId,
      membershipVersion: source.membershipVersion,
      ...fields,
      idempotencyKey: RETRY_VALIDATION_KEY
    };
    const validation = validateUpdateResearchProfileRequest(validationRequest);
    if (!validation.ok) return malformed(validation.errors);
    const { market: _market, code: _code, idempotencyKey: _validationKey, ...wireBody } = validationRequest;
    const reservation = this.retryRecord("profile", "PUT", path, wireBody, auth);
    if (!reservation.ok) return reservation.result;
    const retry = reservation.record;
    const outcome = await this.write(path, "PUT", auth, { ...wireBody, idempotencyKey: retry.key });
    const result = outcome.result;
    if (!result.ok) {
      if (outcome.terminalClientResponse) this.clearRetry(retry);
      return result;
    }
    const envelopeValidation = validateResearchProfileWriteEnvelope(result.value, source.symbol);
    if (!envelopeValidation.ok) return malformed(envelopeValidation.errors);
    const envelope = result.value as ResearchWriteEnvelope<ResearchProfileData>;
    if (!profileMatches(envelope.data, source, fields)) return conflict("Research profile success does not match the submitted source-bound fields.");
    this.clearRetry(retry);
    return { ok: true, value: envelope };
  }
  async createResearchEvidence(
    auth: WebApiAuth,
    source: InvestmentConsoleSourceBinding,
    fields: ResearchEvidenceFields
  ): Promise<ConsoleApiResult<ResearchWriteEnvelope<EvidenceItemData>>> {
    const path = `/api/mobile/research/profiles/${source.market}/${source.code}/evidence`;
    const validationRequest: CreateEvidenceRequest = {
      membershipId: source.membershipId,
      membershipVersion: source.membershipVersion,
      ...fields,
      idempotencyKey: RETRY_VALIDATION_KEY
    };
    const validation = validateCreateEvidenceRequest(validationRequest);
    if (!validation.ok) return malformed(validation.errors);
    const { idempotencyKey: _validationKey, ...wireBody } = validationRequest;
    const reservation = this.retryRecord("evidence", "POST", path, wireBody, auth);
    if (!reservation.ok) return reservation.result;
    const retry = reservation.record;
    const outcome = await this.write(path, "POST", auth, { ...wireBody, idempotencyKey: retry.key });
    const result = outcome.result;
    if (!result.ok) {
      if (outcome.terminalClientResponse) this.clearRetry(retry);
      return result;
    }
    const envelopeValidation = validateEvidenceWriteEnvelope(result.value);
    if (!envelopeValidation.ok) return malformed(envelopeValidation.errors);
    const envelope = result.value as ResearchWriteEnvelope<EvidenceItemData>;
    if (!evidenceMatches(envelope.data, fields)) return conflict("Research evidence success does not match the submitted source-bound fields.");
    this.clearRetry(retry);
    return { ok: true, value: envelope };
  }

  async loadValuationQuant(
    auth: WebApiAuth,
    source: InvestmentConsoleSourceBinding,
    inputs: Pick<AnnualConsoleInputs, "valuation" | "quantFilter">
  ): Promise<ConsoleApiResult<AnnualValuationQuantWorkbenchEnvelope>> {
    const inputErrors = validateAnnualInputs(source, inputs.valuation, inputs.quantFilter);
    if (inputErrors.length > 0) return malformed(inputErrors);
    const query = annualInputQuery(inputs.valuation, inputs.quantFilter);
    const result = await this.read(`/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/valuation-quant-workbench?${query}`, auth, (value) => annualValuationReadMatchesMembership(value, source.membershipId));
    if (!result.ok) return result;
    const validation = validateAnnualValuationQuantWorkbenchEnvelope(result.value);
    if (!validation.ok) return malformed(validation.errors);
    const envelope = result.value as AnnualValuationQuantWorkbenchEnvelope;
    if (envelope.membershipId !== source.membershipId) return conflict("Valuation and quant response does not match the current membership.");
    if (envelope.status !== "available" || !envelope.data) return failureFor(envelope.status, envelope.message);
    if (envelope.data.target.membershipVersion !== source.membershipVersion
      || envelope.data.target.symbol !== source.symbol || !same(envelope.data.valuation.inputs, inputs.valuation)
      || !same(envelope.data.quant.filter.criteria, inputs.quantFilter)) {
      return conflict("Valuation and quant success does not match the current membership or user inputs.");
    }
    return { ok: true, value: envelope };
  }

  /**
   * Explicitly run the registered quantitative research operation for this
   * exact source membership. The operation is preregistered and fixed, so no
   * user valuation scenario or quant filter is parsed, required, or sent; the
   * response is the existing candidate decision-intake envelope, whose decision
   * context carries the frozen historical quant evidence the run published.
   * Viewing the report never calls this.
   */
  async runRegisteredValuationQuant(
    writeAuth: WebApiAuth,
    source: InvestmentConsoleSourceBinding
  ): Promise<ConsoleApiResult<CandidateDecisionIntakeEnvelope>> {
    const path = `/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/valuation-quant-workbench/refresh`;
    const idempotencyKey = `web-run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const outcome = await this.write(path, "POST", writeAuth, {
      membershipVersion: source.membershipVersion,
      ownerConfirmed: true,
      idempotencyKey
    });
    if (!outcome.result.ok) return outcome.result;
    const validation = validateCandidateDecisionIntakeEnvelope(outcome.result.value);
    if (!validation.ok) return malformed(validation.errors);
    const envelope = outcome.result.value as CandidateDecisionIntakeEnvelope;
    // The shared validator covers the internal actor contract; the browser only
    // holds the membership, symbol and version it submitted, so the external
    // binding is rechecked here before any registered-run success is shown.
    if (envelope.membershipId !== source.membershipId
      || envelope.requestedSymbol !== source.symbol
      || envelope.membership?.version !== source.membershipVersion) {
      return conflict("Registered research response does not match the current membership, symbol, or version.");
    }
    if (envelope.status !== "available" || !envelope.decisionContext) {
      return failureFor(envelope.status, envelope.message);
    }
    if (envelope.decisionContext.quantEvidence.status !== "available") {
      return failureFor("unavailable", "The registered research run did not publish readable quant evidence for this membership.");
    }
    return { ok: true, value: envelope };
  }

  async loadConditionalPreview(
    auth: WebApiAuth,
    source: InvestmentConsoleSourceBinding,
    inputs: AnnualConsoleInputs
  ): Promise<ConsoleApiResult<AnnualConditionalDecisionPreviewEnvelope>> {
    const inputErrors = validateAnnualInputs(source, inputs.valuation, inputs.quantFilter);
    if (inputs.scenarioAmounts.length < 1 || inputs.scenarioAmounts.length > 4
      || inputs.scenarioAmounts.some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000)
      || !Number.isInteger(inputs.selectedPortfolioScenarioIndex)
      || inputs.selectedPortfolioScenarioIndex < 0 || inputs.selectedPortfolioScenarioIndex >= inputs.scenarioAmounts.length) {
      inputErrors.push("Conditional preview requires one to four non-negative amounts and one selected scenario index.");
    }
    if (inputErrors.length > 0) return malformed(inputErrors);
    const query = new URLSearchParams(annualInputQuery(inputs.valuation, inputs.quantFilter));
    inputs.scenarioAmounts.forEach((amount) => query.append("scenarioAmount", String(amount)));
    query.set("selectedPortfolioScenarioIndex", String(inputs.selectedPortfolioScenarioIndex));
    const result = await this.read(`/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/conditional-decision-preview?${query}`, auth, (value) => annualConditionalReadMatchesMembership(value, source.membershipId));
    if (!result.ok) return result;
    const validation = await validateAnnualConditionalDecisionPreviewForBrowser(result.value);
    if (!validation.ok) return malformed(validation.errors);
    const envelope = validation.value;
    if (envelope.membershipId !== source.membershipId) return conflict("Conditional preview response does not match the current membership.");
    if (envelope.status !== "available" || !envelope.data) return failureFor(envelope.status, envelope.message);
    const workbench = envelope.data.valuationQuant.data;
    const lab = envelope.data.portfolioLab.data;
    if (envelope.requestedSymbol !== source.symbol
      || !workbench || workbench.target.membershipVersion !== source.membershipVersion
      || !same(workbench.valuation.inputs, inputs.valuation) || !same(workbench.quant.filter.criteria, inputs.quantFilter)
      || !lab || envelope.data.selectedPortfolioScenarioIndex !== inputs.selectedPortfolioScenarioIndex
      || lab.scenarios.length !== inputs.scenarioAmounts.length
      || lab.scenarios.some((scenario, index) => scenario.sourceIndex !== index || scenario.hypotheticalAmount !== inputs.scenarioAmounts[index])) {
      return conflict("Conditional preview success does not match the current membership or user-selected inputs.");
    }
    return { ok: true, value: envelope };
  }

  invalidateAuthorizationRetries(): void { this.retries.clear(); }

  private retryRecord(kind: "profile" | "evidence", method: "PUT" | "POST", path: string, body: unknown, auth: WebApiAuth): RetryReservation {
    const identity = canonicalJson({ method, path, body });
    const existing = this.retries.get(identity);
    if (existing && sameWebApiAuth(existing.auth, auth)) return { ok: true, record: existing };
    if (!existing && this.retries.size >= MAX_UNRESOLVED_WRITE_RETRIES) {
      return {
        ok: false,
        result: {
          ok: false,
          state: "unavailable",
          reason: `Write retry ledger is full (${MAX_UNRESOLVED_WRITE_RETRIES}); resolve an existing write before submitting a distinct request.`
        }
      };
    }
    const record = { identity, key: `web-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`, auth: { ...auth } };
    this.retries.set(identity, record);
    return { ok: true, record };
  }
  private clearRetry(retry: RetryRecord): void {
    if (this.retries.get(retry.identity)?.key === retry.key) this.retries.delete(retry.identity);
  }

  private async read(path: string, auth: WebApiAuth, acceptsFailureEnvelope: (value: unknown) => boolean | Promise<boolean>): Promise<ConsoleApiResult<unknown>> {
    try {
      const response = await this.fetcher(path, { headers: authHeaders(auth) });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) return httpFailure(response.status, value, await acceptsFailureEnvelope(value));
      return { ok: true, value };
    } catch (error) {
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }

  private async write(path: string, method: "PUT" | "POST", auth: WebApiAuth, body: unknown): Promise<WriteOutcome> {
    try {
      const response = await this.fetcher(path, {
        method,
        headers: { "content-type": "application/json", ...authHeaders(auth) },
        body: JSON.stringify(body)
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          result: httpFailure(response.status, value, true),
          terminalClientResponse: response.status >= 400 && response.status < 500
        };
      }
      return { result: { ok: true, value }, terminalClientResponse: false };
    } catch (error) {
      return {
        result: { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." },
        terminalClientResponse: false
      };
    }
  }
}

function validateAnnualInputs(source: InvestmentConsoleSourceBinding, valuation: AnnualValuationScenarioInput, quant: AnnualQuantFilterInput): string[] {
  const errors: string[] = [];
  if (!/^[1-9]\d*$/.test(source.membershipId) || !Number.isSafeInteger(source.membershipVersion) || source.membershipVersion < 1
    || !/^HK\.\d{5}$/.test(source.symbol) || source.symbol !== `${source.market}.${source.code}` || source.membershipState === "archived") {
    errors.push("Annual workbench source binding is invalid or archived.");
  }
  const valuationValidation = validateAnnualValuationScenarioInput(valuation);
  if (!valuationValidation.ok) errors.push(...valuationValidation.errors);
  const quantValidation = validateAnnualQuantFilterInput(quant);
  if (!quantValidation.ok) errors.push(...quantValidation.errors);
  return errors;
}

function annualInputQuery(valuation: AnnualValuationScenarioInput, quant: AnnualQuantFilterInput): URLSearchParams {
  return new URLSearchParams(Object.entries({ ...valuation, ...quant }).map(([key, value]) => [key, String(value)]));
}

function profileMatches(profile: ResearchProfileData, source: InvestmentConsoleSourceBinding, fields: ResearchProfileFields): boolean {
  return profile.symbol === source.symbol && profile.market === source.market && profile.code === source.code
    && profile.name === (fields.name ?? null) && profile.currentView === fields.currentView
    && profile.currentThesis === fields.currentThesis && profile.marketDisagreement === (fields.marketDisagreement ?? null)
    && profile.invalidationCondition === (fields.invalidationCondition ?? null) && profile.nextReviewOn === (fields.nextReviewOn ?? null)
    && same(profile.keyVariables ?? [], fields.keyVariables ?? []) && same(profile.catalysts ?? [], fields.catalysts ?? [])
    && same(profile.evidenceGaps ?? [], fields.evidenceGaps ?? [])
    && (fields.monitorRules === undefined || canonicalJson(profile.monitorRules ?? []) === canonicalJson(fields.monitorRules));
}

function evidenceMatches(evidence: EvidenceItemData, fields: ResearchEvidenceFields): boolean {
  return evidence.sourceType === fields.sourceType && evidence.sourceUrl === (fields.sourceUrl ?? null)
    && evidence.publishedAt === (fields.publishedAt ?? null) && evidence.summary === fields.summary
    && evidence.factKind === fields.factKind && evidence.variableName === (fields.variableName ?? null)
    && evidence.stance === fields.stance && evidence.reliability === (fields.reliability ?? null)
    && (evidence.materiality ?? null) === (fields.materiality ?? null) && evidence.isRead === (fields.isRead ?? false);
}

function authHeaders(auth: WebApiAuth): Record<string, string> {
  return auth.headerName.trim() && auth.token ? { [auth.headerName.trim()]: auth.token } : {};
}

function httpFailure(status: number, value: unknown, trustResponseMessage: boolean): ConsoleApiResult<never> {
  const state: WebFailureState = status === 401 || status === 403 ? "unauthorized" : status === 404 ? "not_found"
    : status === 409 ? "conflict" : status === 400 || status === 422 ? "malformed" : status >= 500 ? "unavailable" : "offline";
  return { ok: false, state, reason: trustResponseMessage && isRecord(value) && typeof value.message === "string" ? value.message : `HTTP ${status}` };
}

function failureFor(status: string, message: string): ConsoleApiResult<never> {
  if (status === "unauthorized") return { ok: false, state: "unauthorized", reason: message };
  if (status === "not_found") return { ok: false, state: "not_found", reason: message };
  if (status === "malformed") return { ok: false, state: "malformed", reason: message };
  if (status === "blocked") return { ok: false, state: "conflict", reason: message };
  return { ok: false, state: "unavailable", reason: message };
}

function malformed(errors: string[]): ConsoleApiResult<never> { return { ok: false, state: "malformed", reason: errors.join("; ") }; }
function conflict(reason: string): ConsoleApiResult<never> { return { ok: false, state: "conflict", reason }; }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
