import {
  validateAnnualPortfolioLabForBrowser,
  type AnnualPortfolioLabEnvelope
} from "../../../packages/contracts/src/annualPortfolioLabBrowser.js";
import type { WebApiAuth, WebFailureState } from "./apiClient.js";

export type WebAnnualPortfolioLabResponse =
  | { ok: true; value: AnnualPortfolioLabEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export function parseAnnualPortfolioLabAmountText(value: string): number[] | null {
  const fields = value.split(",");
  if (fields.length < 1 || fields.length > 4) return null;
  const amounts: number[] = [];
  for (const field of fields) {
    const normalized = field.trim();
    if (normalized.length === 0) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) return null;
    amounts.push(amount);
  }
  return amounts;
}

export async function loadAnnualPortfolioLab(
  auth: WebApiAuth,
  membershipId: string,
  membershipVersion: number,
  symbol: string,
  scenarioAmounts: number[],
  fetcher: typeof fetch = fetch
): Promise<WebAnnualPortfolioLabResponse> {
  if (!/^[1-9]\d*$/.test(membershipId)) return { ok: false, state: "malformed", reason: "Portfolio lab membership id is invalid." };
  if (!Number.isSafeInteger(membershipVersion) || membershipVersion < 1 || !/^HK\.\d{5}$/.test(symbol)) {
    return { ok: false, state: "malformed", reason: "Portfolio lab membership version or symbol is invalid." };
  }
  if (scenarioAmounts.length < 1 || scenarioAmounts.length > 4 || scenarioAmounts.some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000)) {
    return { ok: false, state: "malformed", reason: "Portfolio lab requires one to four non-negative user amounts." };
  }
  const query = new URLSearchParams();
  scenarioAmounts.forEach((amount) => query.append("scenarioAmount", String(amount)));
  try {
    const response = await fetcher(
      `/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/portfolio-lab?${query.toString()}`,
      { cache: "no-store", headers: { [auth.headerName]: auth.token } }
    );
    const payload: unknown = await response.json();
    const validation = await validateAnnualPortfolioLabForBrowser(payload);
    if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
    const envelope = validation.value;
    if (envelope.membershipId !== membershipId) return { ok: false, state: "conflict", reason: "Portfolio lab membership changed during the request." };
    if (!response.ok || envelope.status !== "available" || !envelope.data) {
      return { ok: false, state: failureState(envelope.status, response.status), reason: envelope.message };
    }
    if (envelope.data.target.membershipVersion !== membershipVersion || envelope.data.target.symbol !== symbol) {
      return { ok: false, state: "conflict", reason: "Portfolio lab membership version or symbol changed during the request." };
    }
    if (envelope.data.scenarios.length !== scenarioAmounts.length
      || envelope.data.scenarios.some((scenario, index) => scenario.sourceIndex !== index || scenario.hypotheticalAmount !== scenarioAmounts[index])) {
      return { ok: false, state: "conflict", reason: "Portfolio lab scenarios do not match the user-selected amount order." };
    }
    return { ok: true, value: envelope };
  } catch (error) {
    return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Portfolio lab request failed." };
  }
}

function failureState(status: AnnualPortfolioLabEnvelope["status"], httpStatus: number): WebFailureState {
  if (status === "unauthorized" || httpStatus === 401 || httpStatus === 403) return "unauthorized";
  if (status === "not_found" || httpStatus === 404) return "not_found";
  if (status === "blocked" || httpStatus === 409) return "conflict";
  if (status === "malformed" || httpStatus === 400 || httpStatus === 422) return "malformed";
  return "unavailable";
}
