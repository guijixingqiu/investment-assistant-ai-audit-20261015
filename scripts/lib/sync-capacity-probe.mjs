export async function collectSyncCapacityMetrics(options) {
  const {
    url,
    environment,
    sampleSize,
    thresholdMs,
    fetchImpl = fetch,
    clock = performance,
    headers = {},
    timeoutMs = 8_000
  } = options;
  validateOptions({ url, environment, sampleSize, thresholdMs });
  const durations = [];
  const statuses = new Map();
  let failures = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const started = clock.now();
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs)
      });
      durations.push(Math.max(0, clock.now() - started));
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      if (!response.ok) failures += 1;
    } catch {
      durations.push(Math.max(0, clock.now() - started));
      failures += 1;
      statuses.set("network_error", (statuses.get("network_error") ?? 0) + 1);
    }
  }
  const observed = percentile(durations, 0.95);
  return {
    schemaVersion: "2026-07-12.sync-capacity-probe.v1",
    environment,
    request: { method: "GET", origin: new URL(url).origin, pathname: new URL(url).pathname, queryStored: false },
    metric: "synchronous-read-p95-ms",
    observed,
    threshold: thresholdMs,
    breached: observed > thresholdMs || failures > 0,
    sampleSize,
    failures,
    statuses: Object.fromEntries(statuses),
    responseBodiesStored: false,
    credentialsPrinted: false
  };
}

function validateOptions({ url, environment, sampleSize, thresholdMs }) {
  if (!["staging", "production"].includes(environment)) throw new Error("environment must be staging or production");
  if (!Number.isInteger(sampleSize) || sampleSize < 30 || sampleSize > 500) throw new Error("sampleSize must be an integer from 30 to 500");
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) throw new Error("thresholdMs must be positive");
  const parsed = new URL(url);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("capacity probe requires HTTPS or loopback HTTP");
  }
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return Number(sorted[index].toFixed(3));
}
