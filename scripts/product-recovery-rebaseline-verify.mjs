import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COMPLETION_LEVELS = new Set([
  "implemented",
  "integrated",
  "user-accepted",
  "runtime-verified",
]);
const CAPABILITY_EVIDENCE_STATES = new Set([
  "OWNER_CONFIRMED",
  "VERIFIED_CURRENT",
  "HISTORICAL_AUDIT",
  "INFERRED",
  "UNKNOWN",
]);
export const PRODUCT_BASELINE_SEMANTIC_ROOT = "c5a60ec036439c63760587c02a8265b85916ea5a384c6e6b51a4b486b9c33d4";
const PRODUCT_BASELINE_INTERVAL_SHA256 = "405fdf7e101d842038e318a57e894c7ff8cf4247aea405880fb681c6acf07038";
const REQUIRED_RECOVERY_FILES = [
  "docs/product/recovery/README.md",
  "docs/product/recovery/GOVERNANCE-REPLACEMENT-MATRIX.md",
  "docs/product/recovery/CAPABILITY-RECOVERY-MATRIX.md",
  "docs/product/recovery/LEGACY-INVENTORY-EVIDENCE.md",
  "docs/product/recovery/PRODUCT-CONTRACTS.md",
  "docs/product/recovery/FUNCTIONAL-LOOP-ALPHA-ACCEPTANCE.md",
  "docs/product/recovery/NEXT-FUNCTIONAL-STAGE-DRAFT.md",
  "docs/product/recovery/R0-TIMEBOX-LEDGER.jsonl",
  "docs/product/recovery/four-tab-prototype/index.html",
  "docs/product/recovery/four-tab-prototype/styles.css",
  "docs/product/recovery/four-tab-prototype/prototype.js",
];
export const PROTOTYPE_CONTENT_PATHS = Object.freeze([
  "docs/product/recovery/four-tab-prototype/index.html",
  "docs/product/recovery/four-tab-prototype/styles.css",
  "docs/product/recovery/four-tab-prototype/prototype.js",
]);
export const R0_AUTHORIZED_DIRTY_FILES = Object.freeze([
  "AGENTS.md",
  "CHANGELOG.md",
  "PROJECT_STATE.yaml",
  "ROADMAP.yaml",
  "docs/product/recovery/CAPABILITY-RECOVERY-MATRIX.md",
  "docs/product/recovery/GOVERNANCE-REPLACEMENT-MATRIX.md",
  "docs/product/recovery/R0-TIMEBOX-LEDGER.jsonl",
  "scripts/codex-stage-report.mjs",
  "scripts/codex-stage-task-validate.mjs",
  "scripts/lib/codex-stage.mjs",
  "scripts/product-goal-check.mjs",
  "scripts/product-recovery-rebaseline-verify.mjs",
  "scripts/r0-timebox-ledger-verify.mjs",
  "tests/unit/codex-stage-report.test.mjs",
  "tests/unit/codex-stage-task-validate.test.mjs",
  "tests/unit/product-recovery-rebaseline.test.mjs",
  "tests/unit/r0-timebox-ledger.test.mjs",
]);

function fail(reason, details = {}) {
  const error = new Error(reason);
  error.code = "PRODUCT_RECOVERY_REBASELINE_INVALID";
  error.details = details;
  throw error;
}

export function verifyR0AuthorizedDirtySnapshot(snapshot) {
  const expected = {
    head: "f17d4184e136910387247eacfee12f838ee1e923",
    branch: "codex/product-recovery-rebaseline-1",
    tracked_modified_files: [...R0_AUTHORIZED_DIRTY_FILES].sort(),
    untracked_files: 0,
    git_operation_in_progress: false,
    binary_diff_sha256: "ab57a40f81067daf0126ea4a9c7c938dfe7a712664a7279d2f4a5ef38b117053",
    ledger_raw_sha256: "a1d15e83ad5202fe49645a5a06a5f3381c507c48280b0563629772661f3ea28a",
    ledger_final_event_sha256: "e0c54771986451935c32c839fe947a82338a6ffaaf9a8aaa86fdffb275c9d863",
  };
  const actual = {
    ...snapshot,
    tracked_modified_files: Array.isArray(snapshot?.tracked_modified_files)
      ? [...snapshot.tracked_modified_files].sort()
      : snapshot?.tracked_modified_files,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("r0_authorized_dirty_snapshot_mismatch", { actual, expected });
  }
  return {
    ok: true,
    exception_scope: "PRODUCT-RECOVERY-REBASELINE-1_PRECOMMIT_ONLY",
    tracked_modified_files: expected.tracked_modified_files.length,
  };
}

function numberedIds(body, prefix, end) {
  const matches = [...body.matchAll(new RegExp(`\\*\\*${prefix}(\\d{2})\\*\\*`, "g"))]
    .map((match) => `${prefix}${match[1]}`);
  const expected = Array.from({ length: end }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
  if (JSON.stringify(matches) !== JSON.stringify(expected)) {
    fail(`${prefix}_owner_decision_sequence_invalid`, { matches, expected });
  }
}

export function extractProductBaselineSemanticInterval(body) {
  if (typeof body !== "string") fail("product_baseline_body_invalid");
  const normalized = body
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
  const startHeading = "## 3. Owner-confirmed decisions";
  const starts = [...normalized.matchAll(/^## 3\. Owner-confirmed decisions$/gm)];
  const ends = [...normalized.matchAll(/^## 5\. Proposed.*$/gm)];
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index <= starts[0].index) {
    fail("product_baseline_semantic_interval_not_unique", {
      start_count: starts.length,
      end_count: ends.length,
    });
  }
  const interval = normalized.slice(starts[0].index, ends[0].index);
  if (!interval.startsWith(startHeading)) fail("product_baseline_semantic_interval_start_invalid");
  return interval;
}

export function computeProductBaselineSemanticRoot(
  body,
  { expectedIntervalSha256 = PRODUCT_BASELINE_INTERVAL_SHA256 } = {}
) {
  const interval = extractProductBaselineSemanticInterval(body);
  numberedIds(interval, "D", 57);
  numberedIds(interval, "B", 18);
  const intervalSha256 = createHash("sha256").update(interval, "utf8").digest("hex");
  if (intervalSha256 !== expectedIntervalSha256) {
    fail("product_baseline_semantic_root_mismatch", {
      expected_root: PRODUCT_BASELINE_SEMANTIC_ROOT,
      interval_sha256: intervalSha256,
    });
  }
  return {
    semantic_root: PRODUCT_BASELINE_SEMANTIC_ROOT,
    normalized_interval_sha256: intervalSha256,
  };
}

export function verifyBaselineBody(
  body,
  {
    baselineIssue = 156,
    stageIssue = 157,
    expectedSemanticIntervalSha256 = PRODUCT_BASELINE_INTERVAL_SHA256,
  } = {}
) {
  if (!body.includes("baseline_id: PRODUCT-BASELINE-1")) fail("baseline_id_missing");
  if (!body.includes("baseline_status: BOOTSTRAP_PENDING_R0")) fail("bootstrap_status_missing");
  if (!body.includes(`github_issue_number: ${baselineIssue}`)) fail("baseline_issue_number_mismatch");
  if (!body.includes(`r0_stage_issue_number: ${stageIssue}`)) fail("stage_issue_number_mismatch");
  if (!body.includes("OWNER_CONFIRMED")) fail("owner_confirmed_authority_missing");
  const semantic = computeProductBaselineSemanticRoot(body, {
    expectedIntervalSha256: expectedSemanticIntervalSha256,
  });
  for (let index = 1; index <= 12; index += 1) {
    if (!body.includes(`GOV-MECH-${String(index).padStart(2, "0")}`)) {
      fail("governance_mechanism_missing", { index });
    }
  }
  return {
    ok: true,
    baseline_status: "BOOTSTRAP_PENDING_R0",
    owner_decisions: 57,
    owner_principles: 18,
    governance_mechanisms: 12,
    semantic_root: semantic.semantic_root,
    normalized_semantic_interval_sha256: semantic.normalized_interval_sha256,
  };
}

function requireText(path, patterns) {
  const text = readFileSync(path, "utf8");
  for (const pattern of patterns) {
    if (!pattern.test(text)) fail("required_artifact_content_missing", { path, pattern: String(pattern) });
  }
  return text;
}

export function verifyCapabilityMatrix(capabilityMatrix) {
  const lines = capabilityMatrix.split("\n");
  const count = (prefix, columns) => lines.filter((line) => {
    if (!line.startsWith(`| ${prefix}`)) return false;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== columns) fail("capability_matrix_column_count_invalid", { line });
    return true;
  }).length;
  const productRows = count("P", 6);
  const apiRows = count("A", 5);
  const legacyRows = count("L", 4);
  if (!productRows || !apiRows || !legacyRows) fail("capability_matrix_rows_missing");
  if (!/Owner baseline: `OWNER_CONFIRMED`/.test(capabilityMatrix)
    || !/Legacy evidence remains `HISTORICAL_AUDIT` or `UNKNOWN`/.test(capabilityMatrix)
    || !/Production: `NO_GO`/.test(capabilityMatrix)) {
    fail("capability_evidence_taxonomy_missing");
  }
  return { product_rows: productRows, api_rows: apiRows, legacy_rows: legacyRows };
}

export function computePrototypeContentSha256(contentsByPath) {
  const canonical = {};
  for (const path of PROTOTYPE_CONTENT_PATHS) {
    if (typeof contentsByPath[path] !== "string") {
      fail("prototype_digest_content_missing", { path });
    }
    canonical[path] = contentsByPath[path];
  }
  return createHash("sha256")
    .update(`${JSON.stringify(canonical)}\n`, "utf8")
    .digest("hex");
}

function htmlAttribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}=(?:\"([^\"]*)\"|'([^']*)')`, "i"))?.slice(1).find((value) => value !== undefined) ?? null;
}

function visibleStaticTag(tag) {
  const className = htmlAttribute(tag, "class") || "";
  return !/\bhidden\b/i.test(className) && !/\shidden(?:\s|>|=)/i.test(tag) && htmlAttribute(tag, "aria-hidden") !== "true";
}

export function verifyStaticPrototypeContents(contentsByPath) {
  const html = contentsByPath[PROTOTYPE_CONTENT_PATHS[0]];
  const css = contentsByPath[PROTOTYPE_CONTENT_PATHS[1]];
  const script = contentsByPath[PROTOTYPE_CONTENT_PATHS[2]];
  if (![html, css, script].every((value) => typeof value === "string")) {
    fail("prototype_static_content_missing");
  }

  const ids = [...html.matchAll(/\sid=(?:"([^"]+)"|'([^']+)')/gi)]
    .map((match) => match[1] ?? match[2]);
  if (new Set(ids).size !== ids.length) fail("prototype_duplicate_id_forbidden");

  const bottomNavs = [...html.matchAll(/<nav\b[^>]*class=(?:"[^"]*\bbottom-tabs\b[^"]*"|'[^']*\bbottom-tabs\b[^']*')[^>]*>([\s\S]*?)<\/nav>/gi)];
  if (bottomNavs.length !== 1 || !visibleStaticTag(bottomNavs[0][0])) {
    fail("prototype_bottom_navigation_invalid");
  }
  const tabTags = [...bottomNavs[0][1].matchAll(/<button\b[^>]*\bdata-tab=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/button>/gi)];
  const tabIds = tabTags.map((match) => match[1] ?? match[2]);
  const tabLabels = tabTags.map((match) => match[3].replace(/<[^>]+>/g, "").trim());
  if (
    JSON.stringify(tabIds) !== JSON.stringify(["today", "market", "research", "assets"]) ||
    JSON.stringify(tabLabels) !== JSON.stringify(["今日", "市场", "研究", "资产"]) ||
    tabTags.some((match) => !visibleStaticTag(match[0])) ||
    (html.match(/\bdata-tab=/g) || []).length !== 4
  ) {
    fail("prototype_bottom_tabs_must_be_exact_visible_unique_four");
  }

  const viewTags = [...html.matchAll(/<section\b[^>]*class=(?:"[^"]*\bview\b[^"]*"|'[^']*\bview\b[^']*')[^>]*>/gi)];
  const viewIds = viewTags.map((match) => htmlAttribute(match[0], "id"));
  if (
    JSON.stringify(viewIds) !== JSON.stringify(["today", "market", "research", "assets"]) ||
    viewTags.some((match) => !visibleStaticTag(match[0]))
  ) {
    fail("prototype_views_must_be_exact_visible_unique_four");
  }

  const utilitySurfaces = [...html.matchAll(/<div\b[^>]*class=(?:"[^"]*\butility-surface\b[^"]*"|'[^']*\butility-surface\b[^']*')[^>]*>([\s\S]*?)<\/div>/gi)];
  if (utilitySurfaces.length !== 1 || !visibleStaticTag(utilitySurfaces[0][0])) {
    fail("prototype_global_utility_surface_invalid");
  }
  const utility = utilitySurfaces[0][0];
  for (const requiredId of ["global-search", "global-assistant"]) {
    if ((html.match(new RegExp(`\\bid=[\"']${requiredId}[\"']`, "g")) || []).length !== 1) {
      fail("prototype_global_utility_missing_or_duplicate", { requiredId });
    }
  }
  if (/\bdata-(?:tab|next)=/i.test(utility)) fail("prototype_global_utility_navigation_forbidden");

  const ringTags = [...html.matchAll(/<li\b[^>]*class=(?:"[^"]*\bstatus-ring\b[^"]*"|'[^']*\bstatus-ring\b[^']*')[^>]*>[\s\S]*?<\/li>/gi)];
  if (
    ringTags.length !== 5 ||
    ringTags.some((match) => !visibleStaticTag(match[0]) || /<(?:button|a|nav)\b|\bdata-(?:tab|next)=/i.test(match[0]))
  ) {
    fail("prototype_five_rings_must_be_visible_read_only_non_navigational");
  }

  const localStyles = [...html.matchAll(/<link\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>/gi)]
    .map((match) => match[1] ?? match[2]);
  const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')[^>]*>/gi)]
    .map((match) => match[1] ?? match[2]);
  if (
    JSON.stringify(localStyles) !== JSON.stringify(["styles.css"]) ||
    JSON.stringify(localScripts) !== JSON.stringify(["prototype.js"]) ||
    /<(?:img|iframe|object|embed|audio|video|source)\b/i.test(html) ||
    /(?:https?:)?\/\//i.test(`${html}\n${css}\n${script}`) ||
    /@import|url\s*\(/i.test(css)
  ) {
    fail("prototype_external_resource_forbidden");
  }
  if (
    /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bimport\s*\(|\bserviceWorker\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b|\bcaches\./i.test(script) ||
    /\b(?:action|href|src|data-route)=[\"'][^\"']*(?:runtime|broker|trade|trading)[^\"']*[\"']/i.test(html)
  ) {
    fail("prototype_network_storage_runtime_or_trading_path_forbidden");
  }
  const directListenerSelectors = [...script.matchAll(
    /document\.querySelector\(\s*["']([^"']+)["']\s*\)\.addEventListener\s*\(/g
  )].map((match) => match[1]);
  for (const selector of directListenerSelectors) {
    if (!selector.startsWith("#")) {
      fail("prototype_direct_listener_selector_must_be_static_id", { selector });
    }
    const id = selector.slice(1);
    const targetCount = ids.filter((candidate) => candidate === id).length;
    if (targetCount !== 1) {
      fail("prototype_direct_listener_target_missing_or_duplicate", {
        selector,
        target_count: targetCount,
      });
    }
  }
  return {
    bottom_tabs: tabLabels,
    views: viewIds,
    global_utilities: ["global-search", "global-assistant"],
    read_only_status_rings: ringTags.length,
    direct_listener_targets: directListenerSelectors.length,
    page_memory_only: true,
  };
}

export function verifyRecoveryReadmeTaxonomy(recoveryReadme) {
  if (!/\| Legacy AnnualRings copy \|[^|]+\| `HISTORICAL_AUDIT`; completion `UNKNOWN` \|/.test(recoveryReadme)) {
    fail("legacy_annual_rings_taxonomy_invalid");
  }
  return { legacy_annual_rings_evidence: "HISTORICAL_AUDIT", completion: "UNKNOWN" };
}

export function verifyLocalRecoveryArtifacts(root = process.cwd()) {
  for (const relative of REQUIRED_RECOVERY_FILES) {
    if (!existsSync(resolve(root, relative))) fail("required_recovery_file_missing", { relative });
  }
  if (existsSync(resolve(root, "docs/product/recovery/R0-TIMEBOX-LEDGER.json"))) {
    fail("second_or_legacy_timebox_ledger_forbidden");
  }
  const contracts = requireText(resolve(root, "docs/product/recovery/PRODUCT-CONTRACTS.md"), [
    /Today/, /Market/, /Research/, /Assets/, /Assistant/, /privacy/i,
    /K-line|K 线/, /成交量/, /\bMA\b/, /\bMACD\b/, /Bollinger|布林线/, /\bRSI\b/,
  ]);
  const prototypeContents = Object.fromEntries(
    PROTOTYPE_CONTENT_PATHS.map((path) => [path, readFileSync(resolve(root, path), "utf8")])
  );
  const prototype = [
    prototypeContents["docs/product/recovery/four-tab-prototype/index.html"],
    prototypeContents["docs/product/recovery/four-tab-prototype/prototype.js"],
  ].join("\n");
  for (const required of ["today", "market", "research", "assets", "FUNCTIONAL_LOOP_ALPHA_STATIC_V1"]) {
    if (!prototype.toLowerCase().includes(required.toLowerCase())) fail("prototype_surface_missing", { required });
  }
  const prototypeIa = verifyStaticPrototypeContents(prototypeContents);
  const draft = requireText(resolve(root, "docs/product/recovery/NEXT-FUNCTIONAL-STAGE-DRAFT.md"), [
    /FUNCTIONAL-LOOP-ALPHA-F1-REAL-SINGLE-STOCK-1/,
    /status: OWNER_AUTHORIZED_GOAL_PURSUIT_G0_COMPLETE_AWAITING_SHARED_LOCK/,
    /expected_main_sha: c4bd3264a46303cf9ca8cd46871ba68852d0aa5b/,
    /github_issue: NOT_CREATED/,
    /functional_start_gate: CENTRAL_CONTROLLER_HOLDS_EXISTING_GLOBAL_MODIFICATION_LOCK/,
    /target_bottom_tabs: \[Today, Market, Research, Assets\]/,
    /five_ring_role: READONLY_STATUS_OVERVIEW_NON_NAVIGATIONAL/,
    /g0_completion: IMPLEMENTED_LOCAL_GOVERNANCE_ONLY/,
    /four_tab_swiftui: UNKNOWN/,
    /f1_runtime: UNKNOWN/,
    /owner_runtime_acceptance: UNKNOWN/,
  ]);
  const acceptance = requireText(resolve(root, "docs/product/recovery/FUNCTIONAL-LOOP-ALPHA-ACCEPTANCE.md"), [
    /selected_real_hk_stock: UNKNOWN_PENDING_OWNER_DECISION/,
    /central_recommendation_classification: INFERRED/,
    /owner_user_accepted: USER_ACCEPTED_STATIC_ONLY/,
    /runtime_verified: UNKNOWN/,
    /global HK-stock search/,
    /global assistant/,
    /five-item read-only status-ring overview/,
    /FUNCTIONAL_LOOP_ALPHA_STATIC_V1/,
  ]);
  const recoveryReadme = readFileSync(resolve(root, "docs/product/recovery/README.md"), "utf8");
  const readmeTaxonomy = verifyRecoveryReadmeTaxonomy(recoveryReadme);
  const capabilityMatrix = requireText(
    resolve(root, "docs/product/recovery/CAPABILITY-RECOVERY-MATRIX.md"),
    [
      /Formal product capability matrix/,
      /Legacy API and service matrix/,
      /Legacy UI, runtime, and data disposition matrix/,
      /legacy/,
      /OWNER_CONFIRMED/,
      /HISTORICAL_AUDIT/,
      /UNKNOWN/,
      /Production: `NO_GO`/,
    ]
  );
  const capabilityEvidence = verifyCapabilityMatrix(capabilityMatrix);
  for (const text of [contracts, draft, acceptance, capabilityMatrix]) {
    for (const match of text.matchAll(/completion_level:\s*([a-z-]+)/g)) {
      if (!COMPLETION_LEVELS.has(match[1])) fail("completion_level_invalid", { value: match[1] });
    }
  }
  const legacy = requireText(resolve(root, "docs/product/recovery/LEGACY-INVENTORY-EVIDENCE.md"), [
    /inspected_entries: 694/,
    /writes_attempted: false/,
    /execution_attempted: false/,
    /network_accessed: false/,
    /symlinks_followed: false/,
    /sensitive_content_read: false/,
  ]);
  const digest = computePrototypeContentSha256(prototypeContents);
  return {
    ok: true,
    required_files: REQUIRED_RECOVERY_FILES.length,
    prototype_content_sha256: digest,
    prototype_information_architecture: prototypeIa,
    recovery_readme_taxonomy: readmeTaxonomy,
    legacy_audit_present: legacy.length > 0,
    capability_evidence: capabilityEvidence,
  };
}

function ghJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselineIssue = Number(args["baseline-issue"]);
  const stageIssue = Number(args["stage-issue"]);
  if (baselineIssue !== 156 || stageIssue !== 157) fail("exact_issue_numbers_required");
  const baseline = ghJson(["issue", "view", String(baselineIssue), "--repo", "guijixingqiu/investment-assistant-system", "--json", "number,state,title,body"]);
  const matches = ghJson(["issue", "list", "--repo", "guijixingqiu/investment-assistant-system", "--state", "all", "--search", "\"[product-baseline] Investment Assistant System\" in:title", "--limit", "100", "--json", "number,state,title"]);
  if (matches.length !== 1 || matches[0].number !== baselineIssue || baseline.state !== "OPEN") fail("product_baseline_must_be_unique_and_open", { matches });
  const stage = ghJson(["issue", "view", String(stageIssue), "--repo", "guijixingqiu/investment-assistant-system", "--json", "number,state,body,labels"]);
  const status = stage.body.match(/"status":\s*"([^"]+)"/)?.[1];
  if (!["CODEX_RUNNING", "READY_FOR_CHATGPT_REVIEW"].includes(status)) fail("stage_status_invalid_for_r0_verification", { status });
  const labels = stage.labels.map((label) => label.name).sort();
  const expectedLabels = status === "CODEX_RUNNING" ? ["codex:running"] : ["chatgpt:review"];
  if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) fail("stage_label_set_invalid", { labels, expectedLabels });
  const result = {
    ok: true,
    baseline: verifyBaselineBody(baseline.body, { baselineIssue, stageIssue }),
    local: verifyLocalRecoveryArtifacts(),
    stage_status: status,
    labels,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code, reason: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exit(1);
  }
}
