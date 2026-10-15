import {
  deriveSafetyEvidence,
  isForbiddenRequestPath,
  requestLedgerPathname
} from "./ios-gate-b-local-beta-uat-evidence.mjs";

const webDecisionCreateRoute = "POST /api/mobile/research/profiles/HK/09926/decision-checks";
const webDecisionReviewRoutePrefix = "POST /api/mobile/research/profiles/HK/09926/decision-checks/";

export const REQUIRED_WEB_SCREENSHOTS = [
  "web-current-portfolio-quant-risk.png",
  "web-decision-snapshot-review.png",
  "web-malformed-symbol-fail-closed.png",
  "web-quant-snapshot-review-evidence.png",
  "web-annual-console-desktop.png",
  "web-annual-console-mobile.png"
];

const requiredWebRoutes = [
  "GET /api/mobile/market/quotes/HK/09926",
  "GET /api/mobile/research/decision-context/HK/09926",
  "GET /api/mobile/research/portfolio/pingan-current/context",
  "GET /api/mobile/research/profiles/HK/09926",
  "GET /api/mobile/research/profiles/HK/09926/decision-reviews",
  "PUT /api/mobile/research/profiles/HK/09926",
  "POST /api/mobile/research/profiles/HK/09926/evidence",
  webDecisionCreateRoute
];
const requiredWebRoutePrefixes = [
  "GET /api/mobile/research/candidate-memberships/1/valuation-quant-workbench?",
  "GET /api/mobile/research/candidate-memberships/1/portfolio-lab?",
  "GET /api/mobile/research/candidate-memberships/1/conditional-decision-preview?"
];

export function validateWebEvidence(value, head, errors) {
  if (value?.ok !== true || value?.smoke !== "web-core-journey-ui-browser-uat-closeout") {
    errors.push("Web browser UAT closeout is missing or invalid");
    return;
  }
  validateExactHead(value, head, "Web", errors);
  const routes = validRouteSet(value.requestLedger, "Web", errors);
  for (const route of requiredWebRoutes) {
    if (!routes.has(route)) errors.push(`Web request ledger is missing ${route}`);
  }
  for (const prefix of requiredWebRoutePrefixes) {
    if (![...routes].some((route) => route.startsWith(prefix))) {
      errors.push(`Web request ledger is missing ${prefix}`);
    }
  }
  validateWebDecisionReviewBinding(value, routes, errors);
  if (value.reviewLearningCaptured !== true) errors.push("Web review learning submission is missing");
  if (![...routes].some((route) => route.startsWith(
    "GET /api/mobile/research/portfolio/pingan-current/risk-impact?symbol=HK.09926&hypotheticalAmount="
  ))) errors.push("Web request ledger is missing HK.09926 neutral risk");
  const safety = deriveSafetyEvidence(value.requestLedger);
  if (value.tradingSideEffectRequests !== safety.tradingSideEffectRequests || safety.tradingSideEffectRequests !== 0) {
    errors.push("Web trading side effects must be ledger-derived and zero");
  }
  if (value.authorizationHeaderForwarded !== false) errors.push("Web must not forward Authorization headers");
  if (value.credentialPersistence !== false) errors.push("Web credentials must remain memory-only");
  if (value.production !== "NO_GO") errors.push("Web production status must remain NO_GO");
  validateScreenshots(value.screenshots, REQUIRED_WEB_SCREENSHOTS, "Web recorded", errors, { requireViewport: true });
  validateNamedWebViewport(
    value.screenshots,
    "web-annual-console-desktop.png",
    (viewport) => viewport.width >= 1_024 && viewport.height >= 700,
    "Web annual console desktop screenshot viewport is invalid",
    errors
  );
  validateNamedWebViewport(
    value.screenshots,
    "web-annual-console-mobile.png",
    (viewport) => viewport.width <= 500 && viewport.height >= 700,
    "Web annual console mobile screenshot viewport is invalid",
    errors
  );
  validateWebViewportCoverage(value.screenshots, "Web recorded", errors);
}

function validateWebDecisionReviewBinding(value, routes, errors) {
  const entries = value?.requestLedger;
  const createEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry?.methodPath === webDecisionCreateRoute)
    : [];
  if (createEntries.length !== 1 || createEntries[0]?.count !== 1) {
    errors.push("Web decision-create ledger must contain exactly one request result");
  }
  const decisionCheckId = createEntries[0]?.result?.decisionCheckId;
  if (typeof decisionCheckId !== "string" || !/^[1-9]\d*$/.test(decisionCheckId)) {
    errors.push("Web decision-create ledger result must contain one canonical positive-integer decisionCheckId");
    return;
  }
  if (value.decisionCheckId !== decisionCheckId) {
    errors.push("Web decisionCheckId must match the decision-create ledger result");
  }
  const expectedReviewRoute = `${webDecisionReviewRoutePrefix}${decisionCheckId}/reviews`;
  if (!routes.has(expectedReviewRoute)) {
    errors.push(`Web request ledger is missing review for created decision check ${decisionCheckId}`);
  }
  const observedReviewRoutes = [...routes].filter((route) => (
    route.startsWith(webDecisionReviewRoutePrefix) && route.endsWith("/reviews")
  ));
  if (observedReviewRoutes.length !== 1 || observedReviewRoutes[0] !== expectedReviewRoute) {
    errors.push("Web review request must bind exactly to the decision-create ledger result");
  }
}

function validateNamedWebViewport(entries, name, predicate, message, errors) {
  const entry = Array.isArray(entries) ? entries.find((item) => item?.name === name) : null;
  if (entry && (!validPngViewport(entry.viewport) || !predicate(entry.viewport))) errors.push(message);
}

export function validRouteSet(entries, label, errors) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${label} request ledger must be non-empty`);
    return new Set();
  }
  const routes = new Set();
  for (const entry of entries) {
    if (typeof entry?.methodPath !== "string" || !Number.isInteger(entry?.count) || entry.count < 1) {
      errors.push(`${label} request ledger contains an invalid entry`);
      continue;
    }
    const pathname = requestLedgerPathname(entry.methodPath);
    if (pathname === null) {
      errors.push(`${label} request ledger contains an invalid method or route: ${entry.methodPath}`);
      continue;
    }
    if (isForbiddenRequestPath(pathname)) {
      errors.push(`${label} request ledger contains a forbidden route: ${entry.methodPath}`);
    }
    routes.add(entry.methodPath);
  }
  return routes;
}

export function validateScreenshots(entries, requiredNames, label, errors, options = {}) {
  if (!Array.isArray(entries)) {
    errors.push(`${label} screenshots are missing`);
    return;
  }
  for (const name of requiredNames) {
    const entry = entries.find((item) => item?.name === name);
    if (!entry) {
      errors.push(`${label} screenshot is missing ${name}`);
      continue;
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes < 1_024) errors.push(`${label} screenshot ${name} is too small`);
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) errors.push(`${label} screenshot ${name} hash is invalid`);
    if (options.requireViewport && !validPngViewport(entry.viewport)) {
      errors.push(`${label} screenshot ${name} must record a PNG-derived viewport`);
    }
  }
}

export function validateWebViewportCoverage(entries, label, errors) {
  if (!Array.isArray(entries)) return;
  const viewports = entries.map((entry) => entry?.viewport).filter(validPngViewport);
  if (!viewports.some((viewport) => viewport.width >= 1_024)) {
    errors.push(`${label} screenshots must include a PNG-derived desktop viewport`);
  }
  if (!viewports.some((viewport) => viewport.width <= 500)) {
    errors.push(`${label} screenshots must include a PNG-derived mobile viewport`);
  }
}

function validPngViewport(value) {
  return value?.source === "png_ihdr"
    && Number.isInteger(value.width) && value.width > 0 && value.width <= 32_768
    && Number.isInteger(value.height) && value.height > 0 && value.height <= 32_768;
}

export function validateExactHead(value, head, label, errors) {
  if (value?.head !== head) errors.push(`${label} evidence is not bound to the current HEAD`);
  if (value?.exactHeadClean !== true) errors.push(`${label} evidence was not captured from a clean HEAD`);
}

export function validateScreenshotMatch(recorded, actual, requiredNames, label, errors, options = {}) {
  for (const name of requiredNames) {
    const left = recorded?.find((item) => item?.name === name);
    const right = actual?.find((item) => item?.name === name);
    const viewportMatches = !options.requireViewport
      || left?.viewport?.source === right?.viewport?.source
        && left?.viewport?.width === right?.viewport?.width
        && left?.viewport?.height === right?.viewport?.height;
    if (!left || !right || left.bytes !== right.bytes || left.sha256 !== right.sha256 || !viewportMatches) {
      errors.push(`${label} screenshot evidence does not match ${name}`);
    }
  }
}

export function pngViewportFromBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("screenshot must be a PNG with a leading IHDR chunk");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const viewport = { width, height, source: "png_ihdr" };
  if (!validPngViewport(viewport)) throw new Error("screenshot PNG viewport is outside the supported range");
  return viewport;
}
