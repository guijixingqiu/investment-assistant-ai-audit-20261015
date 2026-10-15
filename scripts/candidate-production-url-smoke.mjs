import { evaluateCandidateQuoteGate } from "./lib/candidate-quote-gate.mjs";

const baseUrl = process.env.CANDIDATE_PRODUCTION_BASE_URL ?? "https://127.0.0.1:18443/candidate-api";
const symbol = process.env.CANDIDATE_PRODUCTION_SYMBOL ?? "HK.09926";
const tlsInsecure = process.env.CANDIDATE_PRODUCTION_TLS_INSECURE === "1";
const authHeaderName = process.env.CANDIDATE_PRODUCTION_AUTH_HEADER ?? "x-internal-token";
const authTokenEnv = process.env.CANDIDATE_PRODUCTION_AUTH_TOKEN_ENV ?? "CANDIDATE_PRODUCTION_AUTH_TOKEN";
const authToken = process.env[authTokenEnv] ?? "";
const mockProbes = parseMockProbes(process.env.CANDIDATE_PRODUCTION_URL_SMOKE_MOCK_PROBES ?? "");

if (tlsInsecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const health = await probeJson("/health");
const quote = await probeJson(`/api/mobile/market/quotes/${symbol.replace(".", "/")}`);
const research = await probeJson(`/api/mobile/research/profiles/${symbol.replace(".", "/")}`);
const quoteGate = evaluateCandidateQuoteGate(quote.data);

const ok = health.reachable
  && quote.reachable
  && research.reachable
  && health.data?.ok === true
  && health.data?.marketProvider === "futu"
  && quoteGate.ok
  && Boolean(research.data?.data?.profile)
  && Array.isArray(research.data?.data?.evidence);

console.log(JSON.stringify({
  ok,
  baseUrl,
  symbol,
  tlsInsecure,
  auth: {
    headerName: authHeaderName,
    tokenProvided: authToken.length > 0,
    tokenEnv: authTokenEnv
  },
  health: {
    reachable: health.reachable,
    status: health.status,
    ok: health.data?.ok,
    marketProvider: health.data?.marketProvider,
    error: health.error
  },
  quote: {
    reachable: quote.reachable,
    httpStatus: quote.status,
    status: quote.data?.status,
    provider: quote.data?.source?.provider,
    gate: quoteGate,
    error: quote.error
  },
  research: {
    reachable: research.reachable,
    httpStatus: research.status,
    profile: research.data?.data?.profile?.symbol ?? null,
    evidenceCount: research.data?.data?.evidence?.length ?? null,
    error: research.error
  },
  notes: [
    "This smoke is read-only.",
    "It expects production nginx to expose the candidate API under /candidate-api/.",
    "It accepts stale quotes only when CANDIDATE_MARKET_CLOSED=1, the provider is Futu, and source.fetchedAt is recent; the API response remains stale.",
    "The token value is never printed."
  ]
}, null, 2));

if (!ok) {
  process.exit(1);
}

async function probeJson(requestPath) {
  if (mockProbes) {
    const probe = mockProbes.shift();
    return {
      reachable: probe?.reachable ?? true,
      status: probe?.status ?? null,
      data: probe?.data ?? null,
      error: probe?.error ?? null
    };
  }

  try {
    const response = await fetch(buildUrl(baseUrl, requestPath), {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        reachable: true,
        status: response.status,
        error: `GET ${requestPath} returned ${response.status}: ${text.slice(0, 200)}`
      };
    }
    return {
      reachable: true,
      status: response.status,
      data: JSON.parse(text)
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function requestHeaders() {
  return {
    accept: "application/json",
    ...(authToken ? { [authHeaderName]: authToken } : {})
  };
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildUrl(base, requestPath) {
  return new URL(requestPath.replace(/^\/+/, ""), ensureTrailingSlash(base));
}

function parseMockProbes(value) {
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("CANDIDATE_PRODUCTION_URL_SMOKE_MOCK_PROBES must be a JSON array");
  }
  return parsed;
}
