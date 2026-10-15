#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, matchesGlob, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { isGovernedProductionSourcePath } from "./lib/architecture-source-inventory.mjs";

const REQUIRED = ["schema", "repository", "modules", "dependency_rules", "fact_authorities", "data_classifications", "runtime_boundaries", "migration_rules", "exceptions", "safety_state"];
const SAFE = { production: "NO_GO", real_trading: "NOT_USED", broker_write: "NOT_USED", official_portfolio_mutation: "NOT_USED", ios_physical_device: "NOT_USED", auto_merge: "FORBIDDEN" };
const AUTHORITIES = {
  official_server_facts: "postgresql_via_governed_api_writes",
  browser_local_records: "unofficial_local_only",
  ios_local_records: "unofficial_local_only",
  pingan_development_current_portfolio: "owner_approved_account_scoped_local_development_only",
  pingan_snapshot: "historical_last_imported_only",
  quant_output: "research_evidence_only"
};

export function collectArchitectureRepositoryFacts(startPath = process.cwd()) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).split("\0").filter(Boolean);
  const missingTrackedFiles = trackedFiles.filter((path) => !existsSync(resolve(root, path)));
  const missing = new Set(missingTrackedFiles);
  const typescriptSources = Object.fromEntries(
    trackedFiles
      .filter((path) => isTypeScriptPath(path) && !missing.has(path))
      .map((path) => [path, readFileSync(resolve(root, path), "utf8")])
  );
  return { root, trackedFiles, typescriptSources, missingTrackedFiles };
}

export function verifyArchitectureBaseline(value, suppliedRepositoryFacts) {
  const failures = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, failures: [{ reason: "invalid_root" }] };
  for (const section of REQUIRED) if (!(section in value)) failures.push({ reason: "missing_section", section });
  if (value.schema?.id !== "investment-assistant-architecture-baseline" || value.schema?.version !== 1) failures.push({ reason: "invalid_schema_identity" });
  if (value.repository?.name !== "guijixingqiu/investment-assistant-system") failures.push({ reason: "invalid_repository_identity" });

  const modules = Array.isArray(value.modules) ? value.modules : [];
  const moduleIds = modules.map((module) => module?.id);
  if (moduleIds.some((id) => typeof id !== "string") || new Set(moduleIds).size !== moduleIds.length) failures.push({ reason: "invalid_or_duplicate_module" });
  const known = new Set(moduleIds);
  const edges = value.dependency_rules?.allowed_edges;
  if (!Array.isArray(edges)) failures.push({ reason: "invalid_dependency_edges" });
  else for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2 || !known.has(edge[0]) || !known.has(edge[1])) failures.push({ reason: "unknown_module_edge", edge });
    if (edge?.[0] === "contracts") failures.push({ reason: "contracts_has_outgoing_dependency", edge });
    if ((edge?.[0] === "web" || edge?.[0] === "ios") && edge?.[1] === "database") failures.push({ reason: "client_database_dependency", edge });
  }

  let repositoryFacts = suppliedRepositoryFacts;
  if (repositoryFacts === undefined) {
    try {
      repositoryFacts = collectArchitectureRepositoryFacts();
    } catch (error) {
      failures.push({ reason: "repository_inspection_failed", message: error.message });
    }
  }
  const repositoryAnalysis = verifyRepositoryArchitecture(value, modules, edges, repositoryFacts);
  failures.push(...repositoryAnalysis.failures);

  const authorities = Array.isArray(value.fact_authorities) ? value.fact_authorities : [];
  const classes = authorities.map((entry) => entry?.class);
  if (classes.some((item) => typeof item !== "string") || new Set(classes).size !== classes.length) failures.push({ reason: "duplicate_or_invalid_fact_authority" });
  for (const [factClass, expected] of Object.entries(AUTHORITIES)) {
    const entries = authorities.filter((entry) => entry?.class === factClass);
    if (entries.length !== 1 || entries[0]?.authority !== expected || entries[0]?.exclusive !== true) failures.push({ reason: "conflicting_fact_authority", factClass, expected });
  }

  if (!Array.isArray(value.exceptions)) failures.push({ reason: "invalid_exception_ledger" });
  else for (const exception of value.exceptions) {
    const valid = exception && ["id", "scope", "classification", "justification", "status", "remediation"].every((key) => typeof exception[key] === "string" && exception[key].trim());
    if (!valid || !["accepted_boundary", "remediation_required"].includes(exception?.status)) failures.push({ reason: "malformed_exception", id: exception?.id ?? null });
  }
  for (const [key, expected] of Object.entries(SAFE)) if (value.safety_state?.[key] !== expected) failures.push({ reason: "unsafe_safety_state", key, expected, actual: value.safety_state?.[key] });
  if (value.migration_rules?.preserve_existing_system !== true || value.migration_rules?.full_rewrite_forbidden !== true || value.migration_rules?.replacement_mainline_before_proven_vertical_slice !== false) failures.push({ reason: "unsafe_migration_rules" });
  return {
    ok: failures.length === 0,
    failures,
    actual_edges: repositoryAnalysis.actualEdges
  };
}

export async function loadAndVerify(path = "ARCHITECTURE_BASELINE.yaml") {
  try {
    const baselinePath = resolve(path);
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const repositoryFacts = collectArchitectureRepositoryFacts(dirname(baselinePath));
    return { ...verifyArchitectureBaseline(baseline, repositoryFacts), path };
  } catch (error) {
    return { ok: false, path, failures: [{ reason: "unreadable_or_invalid_baseline", message: error.message }] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await loadAndVerify(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

function verifyRepositoryArchitecture(value, modules, edges, repositoryFacts) {
  const failures = [];
  const actualEdges = [];
  if (!repositoryFacts || !Array.isArray(repositoryFacts.trackedFiles) || !repositoryFacts.typescriptSources || typeof repositoryFacts.typescriptSources !== "object") {
    return { failures: [{ reason: "invalid_repository_facts" }], actualEdges };
  }

  const trackedFiles = repositoryFacts.trackedFiles;
  const tracked = new Set(trackedFiles);
  if (tracked.size !== trackedFiles.length || trackedFiles.some((path) => !isCanonicalRepositoryPath(path))) {
    failures.push({ reason: "invalid_tracked_file_inventory" });
  }
  if (Array.isArray(repositoryFacts.missingTrackedFiles) && repositoryFacts.missingTrackedFiles.length > 0) {
    failures.push({ reason: "tracked_files_missing_from_worktree", paths: repositoryFacts.missingTrackedFiles });
  }

  const modulePaths = new Map();
  for (const module of modules) {
    const paths = Array.isArray(module?.paths) ? module.paths : [];
    const validPaths = [];
    if (!module || typeof module.id !== "string" || typeof module.owner !== "string" || typeof module.status !== "string" || !Array.isArray(module.paths)) {
      failures.push({ reason: "invalid_module_definition", module: module?.id ?? null });
    }
    if (isImplemented(module?.status) && paths.length === 0) {
      failures.push({ reason: "implemented_module_has_no_paths", module: module?.id ?? null });
    }
    for (const path of paths) {
      if (!isCanonicalRepositoryPath(path)) {
        failures.push({ reason: "invalid_module_path", module: module?.id ?? null, path });
        continue;
      }
      validPaths.push(path);
      if (isImplemented(module?.status) && !trackedFiles.some((file) => matchesModulePath(file, path))) {
        failures.push({ reason: "module_path_matches_no_tracked_files", module: module.id, path });
      }
    }
    modulePaths.set(module?.id, validPaths);
  }

  const ownership = buildOwnershipIndex(trackedFiles, modules, modulePaths);
  const overlapResult = verifyPathOverlaps(value.dependency_rules?.path_ownership, ownership, modulePaths, new Set(modules.map((module) => module?.id)));
  failures.push(...overlapResult.failures);

  const sources = repositoryFacts.typescriptSources instanceof Map
    ? repositoryFacts.typescriptSources
    : new Map(Object.entries(repositoryFacts.typescriptSources));
  const trackedProductionSources = trackedFiles.filter(isGovernedProductionSourcePath);
  for (const path of trackedProductionSources) {
    if (!ownership.get(path)?.owner) failures.push({ reason: "unowned_tracked_production_source", path });
  }
  const trackedTypeScript = trackedFiles.filter(isTypeScriptPath);
  for (const path of trackedTypeScript) {
    if (typeof sources.get(path) !== "string") failures.push({ reason: "missing_tracked_typescript_source", path });
  }

  const allowedEdges = new Set(
    (Array.isArray(edges) ? edges : [])
      .filter((edge) => Array.isArray(edge) && edge.length === 2 && typeof edge[0] === "string" && typeof edge[1] === "string")
      .map(([from, to]) => edgeKey(from, to))
  );
  const observed = new Map();
  for (const sourcePath of trackedTypeScript) {
    const source = sources.get(sourcePath);
    const sourceOwner = ownership.get(sourcePath)?.owner;
    if (typeof source !== "string" || !sourceOwner) continue;
    const parsed = parseTypeScriptImports(sourcePath, source);
    failures.push(...parsed.failures);
    for (const specifier of parsed.specifiers) {
      if (!specifier.startsWith(".")) continue;
      const targetPath = resolveTrackedImport(sourcePath, specifier, tracked);
      if (!targetPath) {
        failures.push({ reason: "unresolved_relative_typescript_import", source: sourcePath, specifier });
        continue;
      }
      const targetOwner = ownership.get(targetPath)?.owner;
      if (!targetOwner || targetOwner.module === sourceOwner.module) continue;
      const key = edgeKey(sourceOwner.module, targetOwner.module);
      const evidence = { source: sourcePath, target: targetPath, specifier };
      const entry = observed.get(key) ?? { from: sourceOwner.module, to: targetOwner.module, imports: [] };
      entry.imports.push(evidence);
      observed.set(key, entry);
    }
  }

  for (const entry of [...observed.values()].sort(compareEdges)) {
    actualEdges.push({ from: entry.from, to: entry.to, imports: entry.imports.length });
    if (!allowedEdges.has(edgeKey(entry.from, entry.to))) {
      failures.push({ reason: "actual_dependency_edge_not_allowed", ...entry });
    }
  }
  return { failures, actualEdges };
}

function buildOwnershipIndex(trackedFiles, modules, modulePaths) {
  const ownership = new Map();
  for (const file of trackedFiles) {
    const matches = [];
    for (const module of modules) {
      for (const path of modulePaths.get(module?.id) ?? []) {
        if (matchesModulePath(file, path)) matches.push({ module: module.id, path });
      }
    }
    const byModule = [...matches.reduce((longest, match) => {
      const current = longest.get(match.module);
      if (!current || match.path.length > current.path.length) longest.set(match.module, match);
      return longest;
    }, new Map()).values()];
    byModule.sort((left, right) => right.path.length - left.path.length || left.module.localeCompare(right.module));
    const winner = byModule[0];
    const ambiguous = winner && byModule.some((match) => match.module !== winner.module && match.path.length === winner.path.length);
    ownership.set(file, {
      matches: byModule,
      owner: winner && !ambiguous ? winner : null,
      ambiguous
    });
  }
  return ownership;
}

function verifyPathOverlaps(policy, ownership, modulePaths, knownModules) {
  const failures = [];
  if (policy?.resolution !== "longest_matching_module_path" || !Array.isArray(policy?.allowed_overlaps)) {
    failures.push({ reason: "invalid_path_ownership_policy" });
  }
  const allowed = [];
  const seen = new Set();
  for (const overlap of Array.isArray(policy?.allowed_overlaps) ? policy.allowed_overlaps : []) {
    const modules = overlap?.modules;
    const valid = Array.isArray(modules)
      && modules.length === 2
      && modules[0] !== modules[1]
      && modules.every((module) => knownModules.has(module))
      && modules.includes(overlap?.winner)
      && isCanonicalRepositoryPath(overlap?.path)
      && (modulePaths.get(overlap.winner) ?? []).includes(overlap.path);
    const key = valid ? `${pairKey(modules[0], modules[1])}\0${overlap.path}` : null;
    if (!valid || seen.has(key)) {
      failures.push({ reason: "malformed_allowed_path_overlap", overlap });
      continue;
    }
    seen.add(key);
    allowed.push({ ...overlap, key, used: false });
  }

  for (const [file, entry] of ownership) {
    if (entry.ambiguous) failures.push({ reason: "ambiguous_module_ownership", path: file, matches: entry.matches });
    for (let left = 0; left < entry.matches.length; left += 1) {
      for (let right = left + 1; right < entry.matches.length; right += 1) {
        const first = entry.matches[left];
        const second = entry.matches[right];
        if (first.module === second.module) continue;
        const candidates = allowed.filter((overlap) => pairKey(...overlap.modules) === pairKey(first.module, second.module) && matchesModulePath(file, overlap.path));
        if (candidates.length !== 1) {
          failures.push({ reason: "undeclared_path_overlap", path: file, modules: [first.module, second.module].sort() });
          continue;
        }
        const overlap = candidates[0];
        overlap.used = true;
        if (!entry.owner || entry.owner.module !== overlap.winner) {
          failures.push({ reason: "allowed_path_overlap_winner_mismatch", path: file, expected: overlap.winner, actual: entry.owner?.module ?? null });
        }
      }
    }
  }
  for (const overlap of allowed) if (!overlap.used) failures.push({ reason: "unused_allowed_path_overlap", overlap: { modules: overlap.modules, winner: overlap.winner, path: overlap.path } });
  return { failures };
}

function parseTypeScriptImports(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const failures = sourceFile.parseDiagnostics.map((diagnostic) => ({
    reason: "typescript_parse_error",
    path,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  }));
  const specifiers = [];
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) add(node.argument.literal);
      else failures.push({
        reason: "non_literal_module_specifier",
        path,
        kind: "import_type"
      });
    }
    else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const commonJsRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (dynamicImport || commonJsRequire) {
        const specifier = node.arguments[0];
        if (specifier && ts.isStringLiteralLike(specifier)) add(specifier);
        else failures.push({
          reason: "non_literal_module_specifier",
          path,
          kind: dynamicImport ? "dynamic_import" : "require"
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { failures, specifiers };
}

function resolveTrackedImport(sourcePath, specifier, tracked) {
  const base = posix.normalize(posix.join(posix.dirname(sourcePath), specifier));
  if (!isCanonicalRepositoryPath(base)) return null;
  const extension = extname(base);
  const candidates = [base];
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    const stem = base.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.d.ts`);
  } else if (!extension) {
    candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.mts`, `${base}/index.cts`, `${base}/index.d.ts`);
  }
  return candidates.find((candidate) => tracked.has(candidate)) ?? null;
}

function matchesModulePath(file, modulePath) {
  try {
    if (/[*?[\]{}]/.test(modulePath)) return matchesGlob(file, modulePath);
    return file === modulePath || file.startsWith(`${modulePath}/`);
  } catch {
    return false;
  }
}

function isCanonicalRepositoryPath(path) {
  return typeof path === "string"
    && path.length > 0
    && !isAbsolute(path)
    && !path.includes("\\")
    && path !== "."
    && !path.startsWith("../")
    && posix.normalize(path) === path;
}

function isImplemented(status) {
  return typeof status === "string" && status.startsWith("implemented");
}

function isTypeScriptPath(path) {
  return /\.(?:cts|mts|ts|tsx)$/.test(path);
}

function edgeKey(from, to) {
  return `${from}\0${to}`;
}

function pairKey(left, right) {
  return [left, right].sort().join("\0");
}

function compareEdges(left, right) {
  return left.from.localeCompare(right.from) || left.to.localeCompare(right.to);
}
