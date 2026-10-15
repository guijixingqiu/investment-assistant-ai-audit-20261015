import { createHash } from "node:crypto";

const passingResult = /^(?:passed|success|succeeded)$/i;
const skippedResult = /skip/i;
const tradingRoute = /(?:^|\/)(?:orders?|trades?|fills?)(?:\/|\?|$)/i;
const brokerRoute = /(?:^|\/)(?:brokers?|brokerage)(?:\/|\?|$)/i;
const cashFeePositionRoute = /(?:^|\/)(?:cash|fees?|positions?)(?:\/|\?|$)/i;
const portfolioRoute = /(?:^|\/)(?:portfolio|positions?|cash|fees?)(?:\/|\?|$)/i;
const productionRoute = /(?:^|\/)(?:production|prod)(?:\/|\?|$)/i;

export function requestLedgerPathname(methodPath) {
  if (typeof methodPath !== "string") return null;
  const separator = methodPath.indexOf(" ");
  if (separator <= 0) return null;
  const method = methodPath.slice(0, separator).trim();
  const route = methodPath.slice(separator + 1).trim();
  if (!/^[A-Z]+$/.test(method) || !route.startsWith("/")) return null;
  try {
    return decodeURIComponent(new URL(route, "http://localhost").pathname);
  } catch {
    return null;
  }
}

export function isForbiddenRequestPath(pathname) {
  return tradingRoute.test(pathname)
    || brokerRoute.test(pathname)
    || cashFeePositionRoute.test(pathname)
    || productionRoute.test(pathname);
}

export function requestLedgerFromRequests(requests) {
  const counts = new Map();
  for (const request of requests) {
    const methodPath = `${String(request?.method ?? "").toUpperCase()} ${String(request?.url ?? "")}`.trim();
    counts.set(methodPath, (counts.get(methodPath) ?? 0) + 1);
  }
  return normalizeRequestLedger([...counts].map(([methodPath, count]) => ({ methodPath, count })));
}

export function normalizeRequestLedger(entries) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry?.methodPath !== "string" || !Number.isInteger(entry?.count) || entry.count < 1) continue;
    const methodPath = entry.methodPath.trim();
    counts.set(methodPath, (counts.get(methodPath) ?? 0) + entry.count);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([methodPath, count]) => ({ methodPath, count }));
}

export function deriveSafetyEvidence(entries) {
  const ledger = normalizeRequestLedger(entries);
  const safety = {
    tradingSideEffectRequests: 0,
    brokerCalls: 0,
    cashFeePositionMutations: 0,
    officialPortfolioMutations: 0,
    productionWrites: 0,
    production: "NO_GO",
    requestLedgerSha256: sha256(JSON.stringify(ledger))
  };
  for (const { methodPath, count } of ledger) {
    const separator = methodPath.indexOf(" ");
    const method = separator > 0 ? methodPath.slice(0, separator).toUpperCase() : "";
    const route = requestLedgerPathname(methodPath) ?? "";
    const writes = !["GET", "HEAD", "OPTIONS"].includes(method);
    if (tradingRoute.test(route)) safety.tradingSideEffectRequests += count;
    if (brokerRoute.test(route)) safety.brokerCalls += count;
    if (writes && cashFeePositionRoute.test(route)) safety.cashFeePositionMutations += count;
    if (writes && portfolioRoute.test(route)) safety.officialPortfolioMutations += count;
    if (writes && productionRoute.test(route)) safety.productionWrites += count;
  }
  return safety;
}

export function validateSafetyEvidenceBinding(value, entries, label, errors) {
  const expected = deriveSafetyEvidence(entries);
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value?.[field] !== expectedValue) errors.push(`${label} safety ${field} does not match its request ledger`);
  }
  for (const field of [
    "tradingSideEffectRequests",
    "brokerCalls",
    "cashFeePositionMutations",
    "officialPortfolioMutations",
    "productionWrites"
  ]) {
    if (expected[field] !== 0) errors.push(`${label} safety ${field} must be zero`);
  }
  return expected;
}

export function stableGitIntervalEvidence(start, end, label, { requireClean = false } = {}) {
  const errors = [];
  validateGitState(start, `${label} start`, errors, requireClean);
  validateGitState(end, `${label} end`, errors, requireClean);
  const startStatusSha256 = statusFingerprint(start?.status);
  const endStatusSha256 = statusFingerprint(end?.status);
  if (start?.head !== end?.head) errors.push(`${label} HEAD changed during evidence capture`);
  if (startStatusSha256 !== endStatusSha256) errors.push(`${label} worktree changed during evidence capture`);
  if (start?.worktreeSha256 !== end?.worktreeSha256) errors.push(`${label} worktree content changed during evidence capture`);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return {
    startHead: start.head,
    endHead: end.head,
    startStatusSha256,
    endStatusSha256,
    startWorktreeSha256: start.worktreeSha256,
    endWorktreeSha256: end.worktreeSha256,
    startClean: String(start.status).trim() === "",
    endClean: String(end.status).trim() === "",
    stable: true
  };
}

export function cleanGitIntervalEvidence(start, end, label) {
  return stableGitIntervalEvidence(start, end, label, { requireClean: true });
}

export function validateGitIntervalEvidence(value, head, label, errors) {
  if (value?.startHead !== head || value?.endHead !== head) errors.push(`${label} interval is not bound to the current HEAD`);
  if (value?.startClean !== true || value?.endClean !== true) errors.push(`${label} interval was not clean`);
  if (!/^[0-9a-f]{64}$/.test(value?.startStatusSha256 ?? "")
    || value?.startStatusSha256 !== value?.endStatusSha256) {
    errors.push(`${label} worktree changed during evidence capture`);
  }
  if (value?.startStatusSha256 !== statusFingerprint("") || value?.endStatusSha256 !== statusFingerprint("")) {
    errors.push(`${label} interval status fingerprints are not clean`);
  }
  if (!/^[0-9a-f]{64}$/.test(value?.startWorktreeSha256 ?? "")
    || value?.startWorktreeSha256 !== value?.endWorktreeSha256) {
    errors.push(`${label} worktree content changed during evidence capture`);
  }
  if (value?.startWorktreeSha256 !== sha256("") || value?.endWorktreeSha256 !== sha256("")) {
    errors.push(`${label} interval worktree content is not clean`);
  }
  if (value?.stable !== true || value?.startHead !== value?.endHead) errors.push(`${label} HEAD changed during evidence capture`);
}

export function deriveXcresultExecutionEvidence({ unitTree, uiTrees, plannedUnitTargets, plannedUiTargets }) {
  const unitCases = plannedUnitTargets.length === 0 ? [] : collectTestCases(unitTree);
  if (plannedUnitTargets.length > 0) assertPassedCases(unitCases, "unit-tests.xcresult");
  const plannedUnitBySuite = new Map(plannedUnitTargets.map((target) => [target.split("/").at(-1), target]));
  const actualUnitSuites = new Set(unitCases.flatMap((testCase) => (
    testCase.suites.filter((suite) => plannedUnitBySuite.has(suite))
  )));
  const unitTargets = [...actualUnitSuites].map((suite) => plannedUnitBySuite.get(suite));
  if (!sameTargets(unitTargets, plannedUnitTargets)) throw new Error("xcresult omitted one or more planned unit test suites");
  const unexpectedUnit = unitCases.filter((testCase) => (
    !testCase.suites.some((suite) => plannedUnitBySuite.has(suite))
  ));
  if (unexpectedUnit.length > 0) throw new Error(`xcresult ran an unexpected unit test: ${unexpectedUnit[0].identity}`);

  const uiBundles = [];
  const uiTargets = [];
  let uiTestCaseCount = 0;
  for (const entry of uiTrees) {
    const cases = collectTestCases(entry.tree);
    assertPassedCases(cases, entry.bundle);
    const [bundleTarget, suite, method] = entry.expectedTarget.split("/");
    if (!bundleTarget || !suite || !method || !cases.every((testCase) => (
      testCase.name === method && testCase.suites.includes(suite)
    ))) {
      throw new Error(`${entry.bundle} ran a UI test outside ${entry.expectedTarget}`);
    }
    uiTargets.push(`${bundleTarget}/${suite}/${method}`);
    uiTestCaseCount += cases.length;
    uiBundles.push(bundleEvidence(entry.bundle, [entry.expectedTarget], cases));
  }
  if (!sameTargets(uiTargets, plannedUiTargets)) throw new Error("xcresult UI test targets differ from the planned matrix");

  const counts = {
    unitTestCases: unitCases.length,
    uiTestCases: uiTestCaseCount,
    totalTestCases: unitCases.length + uiTestCaseCount,
    passed: unitCases.length + uiTestCaseCount,
    skipped: 0,
    failed: 0,
    unknown: 0
  };
  const evidence = {
    source: "xcresulttool-test-results",
    plannedUnit: [...plannedUnitTargets],
    plannedUi: [...plannedUiTargets],
    unit: unitTargets,
    ui: uiTargets,
    counts,
    bundles: [
      ...(plannedUnitTargets.length > 0 ? [bundleEvidence("unit-tests.xcresult", unitTargets, unitCases)] : []),
      ...uiBundles
    ]
  };
  return { ...evidence, executionSha256: executionEvidenceSha256(evidence) };
}

export function validateXcresultExecutionEvidence(value, expectedUnit, expectedUi, label, errors) {
  if (value?.source !== "xcresulttool-test-results") errors.push(`${label} tests are not derived from xcresult`);
  for (const [field, expected] of [
    ["plannedUnit", expectedUnit], ["plannedUi", expectedUi], ["unit", expectedUnit], ["ui", expectedUi]
  ]) {
    if (!sameTargets(value?.[field], expected)) errors.push(`${label} ${field} test matrix is inconsistent`);
  }
  const counts = value?.counts;
  if (!Number.isInteger(counts?.totalTestCases) || counts.totalTestCases < expectedUnit.length + expectedUi.length) {
    errors.push(`${label} xcresult contains zero or too few executed tests`);
  }
  if (counts?.unitTestCases + counts?.uiTestCases !== counts?.totalTestCases) errors.push(`${label} test counts do not add up`);
  if (counts?.passed !== counts?.totalTestCases) errors.push(`${label} not every executed test passed`);
  for (const field of ["skipped", "failed", "unknown"]) {
    if (counts?.[field] !== 0) errors.push(`${label} xcresult ${field} test count must be zero`);
  }
  const bundles = value?.bundles;
  if (!Array.isArray(bundles) || bundles.length !== expectedUi.length + 1) errors.push(`${label} xcresult bundle evidence is incomplete`);
  else {
    for (const bundle of bundles) {
      if (!Number.isInteger(bundle?.testCaseCount) || bundle.testCaseCount < 1 || bundle.passed !== bundle.testCaseCount
        || bundle.skipped !== 0 || bundle.failed !== 0 || bundle.unknown !== 0) {
        errors.push(`${label} xcresult bundle ${bundle?.bundle ?? "unknown"} is incomplete or non-passing`);
      }
    }
    const unitBundle = bundles.find((bundle) => bundle?.bundle === "unit-tests.xcresult");
    if (!unitBundle || !sameTargets(unitBundle.targets, expectedUnit)) {
      errors.push(`${label} xcresult unit bundle targets are inconsistent`);
    }
    for (const target of expectedUi) {
      const method = target.split("/").at(-1);
      const matching = bundles.filter((bundle) => (
        bundle?.bundle === `ui-${method}.xcresult` && sameTargets(bundle?.targets, [target])
      ));
      if (matching.length !== 1) errors.push(`${label} xcresult UI bundle is inconsistent for ${target}`);
    }
    const unitCount = unitBundle?.testCaseCount ?? 0;
    const uiCount = bundles.filter((bundle) => bundle !== unitBundle)
      .reduce((sum, bundle) => sum + (bundle?.testCaseCount ?? 0), 0);
    if (counts?.unitTestCases !== unitCount || counts?.uiTestCases !== uiCount) {
      errors.push(`${label} xcresult aggregate test counts do not match its bundles`);
    }
    for (const field of ["passed", "skipped", "failed", "unknown"]) {
      const bundleCount = bundles.reduce((sum, bundle) => sum + (bundle?.[field] ?? 0), 0);
      if (counts?.[field] !== bundleCount) errors.push(`${label} xcresult ${field} count does not match its bundles`);
    }
  }
  const unsigned = value && typeof value === "object" ? { ...value } : {};
  delete unsigned.executionSha256;
  if (value?.executionSha256 !== executionEvidenceSha256(unsigned)) errors.push(`${label} test execution digest is invalid`);
}

export function executionEvidenceSha256(value) {
  return sha256(JSON.stringify(value));
}

function collectTestCases(value, ancestors = [], suites = []) {
  if (Array.isArray(value)) return value.flatMap((item) => collectTestCases(item, ancestors, suites));
  if (!value || typeof value !== "object") return [];
  const descriptor = [value.nodeType, value.name, value.nodeIdentifier, value.nodeIdentifierURL]
    .filter((item) => typeof item === "string" && item.length > 0)
    .join(":");
  const path = descriptor ? [...ancestors, descriptor] : ancestors;
  const suitePath = value.nodeType === "Test Suite" && typeof value.name === "string"
    ? [...suites, value.name]
    : suites;
  const current = value.nodeType === "Test Case"
    ? [{
        name: canonicalXCTestMethodName(value.name),
        result: String(value.result ?? ""),
        suites: suitePath,
        identity: path.join(" / ")
      }]
    : [];
  return current.concat(Object.values(value).flatMap((item) => collectTestCases(item, path, suitePath)));
}

function canonicalXCTestMethodName(value) {
  return String(value ?? "").replace(/\(\)$/, "");
}

function assertPassedCases(cases, label) {
  if (cases.length === 0) throw new Error(`${label} contains zero executed test cases`);
  for (const testCase of cases) {
    if (skippedResult.test(testCase.result)) throw new Error(`${label} skipped ${testCase.identity}`);
    if (!passingResult.test(testCase.result)) throw new Error(`${label} did not pass ${testCase.identity}: ${testCase.result || "unknown"}`);
  }
}

function bundleEvidence(bundle, targets, cases) {
  return {
    bundle,
    targets,
    testCaseCount: cases.length,
    passed: cases.filter((item) => passingResult.test(item.result)).length,
    skipped: cases.filter((item) => skippedResult.test(item.result)).length,
    failed: cases.filter((item) => item.result && !passingResult.test(item.result) && !skippedResult.test(item.result)).length,
    unknown: cases.filter((item) => !item.result).length
  };
}

function validateGitState(value, label, errors, requireClean) {
  if (!/^[0-9a-f]{40}$/.test(value?.head ?? "")) errors.push(`${label} Git SHA is invalid`);
  if (typeof value?.status !== "string") errors.push(`${label} Git status is invalid`);
  if (!/^[0-9a-f]{64}$/.test(value?.worktreeSha256 ?? "")) errors.push(`${label} worktree fingerprint is invalid`);
  if (requireClean && String(value?.status ?? "").trim() !== "") errors.push(`${label} worktree is not clean`);
}

function statusFingerprint(value) {
  return sha256(String(value ?? ""));
}

function sameTargets(value, expected) {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const actual = new Set(value);
  return actual.size === expected.length && expected.every((target) => actual.has(target));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
