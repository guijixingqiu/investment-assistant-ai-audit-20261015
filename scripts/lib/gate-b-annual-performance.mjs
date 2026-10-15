const MINIMUM_SAMPLE_SIZE = 30;

export const GATE_B_LOCAL_PERFORMANCE_INTERPRETATION =
  "local_regression_guard_not_staging_or_production_capacity_evidence";

export async function collectGateBAnnualPerformance(options) {
  const {
    routes,
    request,
    sampleSize = MINIMUM_SAMPLE_SIZE,
    warmupCount = 3,
    budgetMs = 2_000,
    clock = performance
  } = options;
  validateCollectionOptions({ routes, request, sampleSize, warmupCount, budgetMs, clock });

  for (let warmup = 0; warmup < warmupCount; warmup += 1) {
    for (const route of routes) {
      const response = await request(route);
      assertSuccessfulResponse(route, response);
    }
  }

  const observations = new Map(routes.map((route) => [route.name, {
    durations: [],
    statuses: new Map(),
    failures: 0
  }]));

  for (let sample = 0; sample < sampleSize; sample += 1) {
    for (const route of routes) {
      const observation = observations.get(route.name);
      const started = clock.now();
      let response;
      let requestFailed = false;
      try {
        response = await request(route);
      } catch {
        requestFailed = true;
      }
      const duration = clock.now() - started;
      assertFiniteDuration(duration, route.name);
      observation.durations.push(duration);
      if (requestFailed) {
        observation.failures += 1;
        incrementStatus(observation.statuses, "request_error");
        continue;
      }
      incrementStatus(observation.statuses, response?.status ?? "missing_status");
      try {
        assertSuccessfulResponse(route, response);
      } catch {
        observation.failures += 1;
      }
    }
  }

  const routeResults = routes.map((route) => {
    const observation = observations.get(route.name);
    return summarizeGateBRouteSamples({
      name: route.name,
      path: route.path,
      samples: observation.durations,
      statuses: Object.fromEntries(observation.statuses),
      failures: observation.failures,
      budgetMs
    });
  });
  const failures = routeResults.reduce((total, route) => total + route.failures, 0);
  return {
    schemaVersion: "2026-07-18.gate-b-local-performance.v1",
    interpretation: GATE_B_LOCAL_PERFORMANCE_INTERPRETATION,
    environment: "disposable_local_postgresql_restore",
    measurement: "full_json_response_parse_elapsed_ms",
    warmupSamplesPerRoute: warmupCount,
    measuredSamplesPerRoute: sampleSize,
    totalMeasuredRequests: sampleSize * routes.length,
    budget: { metric: "per-route-p95-ms", thresholdMs: budgetMs },
    failures,
    breached: failures > 0 || routeResults.some((route) => route.breached),
    routes: routeResults
  };
}

export function summarizeGateBRouteSamples({ name, path, samples, statuses = {}, failures = 0, budgetMs }) {
  if (typeof name !== "string" || name.length === 0) throw new Error("route name is required");
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("route path must be absolute");
  if (!Array.isArray(samples) || samples.length < MINIMUM_SAMPLE_SIZE) {
    throw new Error(`route ${name} requires at least ${MINIMUM_SAMPLE_SIZE} measured samples`);
  }
  if (!Number.isInteger(failures) || failures < 0 || failures > samples.length) {
    throw new Error(`route ${name} failures must be an integer within the sample count`);
  }
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("performance budget must be positive");
  for (const sample of samples) assertFiniteDuration(sample, name);
  const sorted = [...samples].sort((left, right) => left - right);
  const p50 = nearestRank(sorted, 0.50);
  const p95 = nearestRank(sorted, 0.95);
  const p50Ms = rounded(p50);
  const p95Ms = rounded(p95);
  const maxMs = rounded(sorted.at(-1));
  return {
    name,
    method: "GET",
    path,
    sampleCount: samples.length,
    statuses,
    failures,
    p50Ms,
    p95Ms,
    maxMs,
    budgetMs,
    breached: failures > 0 || p95 > budgetMs
  };
}

function validateCollectionOptions({ routes, request, sampleSize, warmupCount, budgetMs, clock }) {
  if (!Array.isArray(routes) || routes.length === 0) throw new Error("at least one performance route is required");
  const names = new Set();
  for (const route of routes) {
    if (!route || typeof route.name !== "string" || route.name.length === 0) throw new Error("each route requires a name");
    if (names.has(route.name)) throw new Error(`duplicate performance route name: ${route.name}`);
    names.add(route.name);
    if (typeof route.path !== "string" || !route.path.startsWith("/")) throw new Error(`route ${route.name} path must be absolute`);
    if (typeof route.assertBody !== "function") throw new Error(`route ${route.name} requires a semantic response assertion`);
  }
  if (typeof request !== "function") throw new Error("performance request function is required");
  if (!Number.isInteger(sampleSize) || sampleSize < MINIMUM_SAMPLE_SIZE) {
    throw new Error(`sampleSize must be an integer of at least ${MINIMUM_SAMPLE_SIZE}`);
  }
  if (!Number.isInteger(warmupCount) || warmupCount < 0) throw new Error("warmupCount must be a non-negative integer");
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("performance budget must be positive");
  if (!clock || typeof clock.now !== "function") throw new Error("performance clock must expose now()");
}

function assertSuccessfulResponse(route, response) {
  if (!response || response.status !== 200) throw new Error(`${route.name} did not return HTTP 200`);
  route.assertBody(response.body);
}

function assertFiniteDuration(value, routeName) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`route ${routeName} produced an invalid duration`);
}

function nearestRank(sorted, quantile) {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function incrementStatus(statuses, status) {
  const key = String(status);
  statuses.set(key, (statuses.get(key) ?? 0) + 1);
}
