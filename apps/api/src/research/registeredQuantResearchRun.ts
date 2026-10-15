import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  QUANT_REGISTERED_RUN_SCHEMA_VERSION,
  quantManifestDividendCashGate,
  quantManifestExecutionCalendarIsBounded,
  quantManifestFeePolicyGate,
  registeredQuantResearchRunCoalescingKey,
  type RegisteredQuantResearchRunRequest,
  type RegisteredQuantRunReceipt,
  type RegisteredQuantResearchTarget
} from "../../../../packages/contracts/src/quantRegisteredResearchRun.js";
import type { QuantEvidenceSource } from "./quantEvidenceSource.js";
import type { HkConnectQuantUniverse } from "./quantEvidenceSource.js";
import {
  verifyQuantEvidenceCatalog,
  type QuantEvidenceTrustedReference
} from "./quantEvidenceTrustedReference.js";

export const REGISTERED_QUANT_RUN_ARTIFACT_ROOT = "artifacts/quant-registered-runs";
export const REGISTERED_QUANT_RUN_CATALOG_PATH = `${REGISTERED_QUANT_RUN_ARTIFACT_ROOT}/decision-evidence-catalog.json`;
export const REGISTERED_QUANT_RUN_DEFAULT_TIMEOUT_MS = 600_000;
export const QUANT_DECISION_EVIDENCE_CATALOG_SCHEMA_VERSION = "2026-08-17.quant-decision-evidence-catalog.v1";

export interface RegisteredQuantRunStep {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface RegisteredQuantRunExecutor {
  runStep(step: RegisteredQuantRunStep): Promise<{ ok: boolean; stdoutTail: string; stderrTail: string }>;
}

/**
 * Fixed Node executable, known repository cwd, and a minimal environment
 * allowlist without database, AI, proxy, or token credentials.
 */
export const nodeRegisteredQuantRunExecutor: RegisteredQuantRunExecutor = {
  runStep: (step) => new Promise((resolvePromise) => {
    execFile(step.file, step.args, {
      cwd: step.cwd,
      env: step.env,
      timeout: step.timeoutMs,
      maxBuffer: 4_000_000,
      killSignal: "SIGKILL"
    }, (error, stdout, stderr) => {
      resolvePromise({ ok: !error, stdoutTail: tail(stdout), stderrTail: tail(stderr) });
    });
  })
};

export type RegisteredQuantRunOutcome =
  | {
      ok: true;
      schemaVersion: typeof QUANT_REGISTERED_RUN_SCHEMA_VERSION;
      symbol: string;
      runId: string;
      replayed: boolean;
      receipt: RegisteredQuantRunReceipt;
      manifestPath: string;
      manifestSha256: string;
      catalogPath: string;
      catalogSha256: string;
      durationMs: number;
      logTail: string;
    }
  | {
      ok: false;
      schemaVersion: typeof QUANT_REGISTERED_RUN_SCHEMA_VERSION;
      symbol: string;
      status: "failed" | "malformed" | "busy";
      message: string;
      logTail: string;
    };

/**
 * Server-derived authorization context for one registered run. The actor and
 * the membership re-verification both come from the route's own auth/membership
 * reads, never from client input.
 */
export interface RegisteredQuantRunAuthorization {
  actorId: string;
  /** Re-validate the current actor + membership + symbol + version immediately before publishing. */
  authorizePublish(): Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface RegisteredQuantRunCoordinatorOptions {
  repositoryRoot: string;
  nodeExecutable: string;
  catalogPath: string;
  catalogReference: QuantEvidenceTrustedReference;
  source: QuantEvidenceSource;
  /**
   * Freshness policy and optional official universe binding used to fully
   * validate the newly generated symbol before the catalog is published.
   */
  decisionEvidence: { maxAgeDays: number; hkConnectUniverse?: HkConnectQuantUniverse };
  executor?: RegisteredQuantRunExecutor;
  timeoutMs?: number;
  now?: () => Date;
  runId?: () => string;
}

export interface RegisteredQuantRunCoordinator {
  run(
    target: RegisteredQuantResearchTarget,
    request: RegisteredQuantResearchRunRequest,
    authorization: RegisteredQuantRunAuthorization
  ): Promise<RegisteredQuantRunOutcome>;
}

export interface RegisteredQuantRunRuntimeOptions {
  enabled: boolean;
  coordinator: RegisteredQuantRunCoordinator;
  catalogPath: string;
}

/** Bounded receipt replay store. Only the newest runs are retained in memory. */
const REGISTERED_QUANT_RUN_RECEIPT_LIMIT = 20;

/**
 * Bounded registered-run coordinator. At most one registered run executes at a
 * time: an identical in-flight request is coalesced, any other request gets an
 * explicit busy result. There is no queue, worker, lease, database, or durable
 * history store, and the store only holds the newest bounded receipts.
 */
export function createRegisteredQuantRunCoordinator(
  options: RegisteredQuantRunCoordinatorOptions
): RegisteredQuantRunCoordinator {
  const receipts = new Map<string, Extract<RegisteredQuantRunOutcome, { ok: true }>>();
  let active: { key: string; promise: Promise<RegisteredQuantRunOutcome> } | null = null;
  const executor = options.executor ?? nodeRegisteredQuantRunExecutor;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? (() => `${now().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`);
  return {
    run: (target, request, authorization) => {
      const key = `${authorization.actorId}:${registeredQuantResearchRunCoalescingKey(target, request)}`;
      const replayed = receipts.get(key);
      if (replayed) return Promise.resolve({ ...replayed, replayed: true });
      if (active) {
        if (active.key === key) return active.promise;
        return Promise.resolve({
          ok: false,
          schemaVersion: QUANT_REGISTERED_RUN_SCHEMA_VERSION,
          symbol: target.symbol,
          status: "busy",
          message: "another registered quantitative research run is already in progress; retry after it completes",
          logTail: ""
        });
      }
      const started = Date.now();
      const pending = executeStep(target, request).finally(() => {
        if (active && active.promise === pending) active = null;
      });
      active = { key, promise: pending };
      return pending;

      async function executeStep(
        selected: RegisteredQuantResearchTarget,
        _selectedRequest: RegisteredQuantResearchRunRequest
      ): Promise<RegisteredQuantRunOutcome> {
        const id = runId();
        const relativeRunDir = `${REGISTERED_QUANT_RUN_ARTIFACT_ROOT}/${selected.symbol}/${id}`;
        const runDir = join(options.repositoryRoot, relativeRunDir);
        try {
          await mkdir(dirname(runDir), { recursive: true });
          await mkdir(runDir);
        } catch {
          return failed(selected.symbol, "registered run output directory could not be created without overwriting existing artifacts", "");
        }
        const overrideConfigPath = join(runDir, "config.json");
        try {
          const base = JSON.parse(await readFile(join(options.repositoryRoot, selected.configPath), "utf8")) as Record<string, unknown>;
          // The registered build regenerates a signal-freeze snapshot through
          // `signalFreezeConfigPath`. The historical freeze config writes into
          // the historical artifact directory, so a copy is placed inside this
          // run directory and its outputDir is redirected there as well. Every
          // other freeze field (source paths, identity, dates, universe) is
          // preserved verbatim so historical as-of/cutoff facts do not change.
          const generated: Record<string, unknown> = {
            ...base,
            generatedAt: now().toISOString(),
            outputDir: relative(options.repositoryRoot, runDir)
          };
          const freezeConfigPath = base.signalFreezeConfigPath;
          if (typeof freezeConfigPath === "string" && freezeConfigPath.trim() !== "") {
            const freezeConfig = JSON.parse(
              await readFile(join(options.repositoryRoot, freezeConfigPath), "utf8")
            ) as Record<string, unknown>;
            const freezeDestination = join(runDir, "signal-freeze.json");
            await writeFile(
              freezeDestination,
              `${JSON.stringify({
                ...freezeConfig,
                outputDir: relative(options.repositoryRoot, join(runDir, "signal-snapshot"))
              }, null, 2)}\n`,
              "utf8"
            );
            generated.signalFreezeConfigPath = relative(options.repositoryRoot, freezeDestination);
          }
          await writeFile(
            overrideConfigPath,
            `${JSON.stringify(generated, null, 2)}\n`,
            "utf8"
          );
        } catch {
          return failed(selected.symbol, "registered quant config could not be prepared for the bounded run", "");
        }
        const step: RegisteredQuantRunStep = {
          file: options.nodeExecutable,
          args: [selected.scriptPath, "build"],
          cwd: options.repositoryRoot,
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
            QUANT_HK_STOCK_CONFIG: relative(options.repositoryRoot, overrideConfigPath)
          },
          timeoutMs: options.timeoutMs ?? REGISTERED_QUANT_RUN_DEFAULT_TIMEOUT_MS
        };
        const executed = await executor.runStep(step);
        const logTail = tail(`${executed.stdoutTail}\n${executed.stderrTail}`);
        if (!executed.ok) {
          return failed(selected.symbol, "registered quant operation failed before a verified manifest was produced", logTail);
        }
        const manifestRelativePath = `${relativeRunDir}/run_manifest.json`;
        let manifestBytes: Buffer;
        try {
          manifestBytes = await readFile(join(options.repositoryRoot, manifestRelativePath));
        } catch {
          return failed(selected.symbol, "registered quant operation did not write a run manifest into its own output directory", logTail);
        }
        const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
        let manifest: unknown;
        try {
          manifest = JSON.parse(manifestBytes.toString("utf8"));
        } catch {
          return failed(selected.symbol, "registered quant run manifest is not valid JSON", logTail);
        }
        const verified = verifyRunManifest(manifest, selected.symbol);
        if (!verified.ok) {
          return failed(selected.symbol, verified.message, logTail);
        }
        const authorized = await authorization.authorizePublish();
        if (!authorized.ok) {
          return failed(selected.symbol, authorized.message, logTail);
        }
        const published = await publishCatalogEntry({
          repositoryRoot: options.repositoryRoot,
          catalogPath: options.catalogPath,
          source: options.source,
          catalogReference: options.catalogReference,
          symbol: selected.symbol,
          manifestRelativePath,
          manifestSha256,
          generatedAt: now().toISOString(),
          decisionEvidence: options.decisionEvidence,
          now: now()
        });
        if (!published.ok) {
          return failed(selected.symbol, published.message, logTail);
        }
        const receipt = {
          symbol: selected.symbol,
          actorId: authorization.actorId,
          membershipVersion: request.membershipVersion,
          idempotencyKey: request.idempotencyKey,
          runId: id,
          manifestPath: manifestRelativePath,
          manifestSha256,
          catalogPath: options.catalogPath,
          catalogSha256: published.catalogSha256,
          completedAt: now().toISOString()
        } satisfies RegisteredQuantRunReceipt;
        const outcome = {
          ok: true,
          schemaVersion: QUANT_REGISTERED_RUN_SCHEMA_VERSION,
          symbol: selected.symbol,
          runId: id,
          replayed: false,
          receipt,
          manifestPath: manifestRelativePath,
          manifestSha256,
          catalogPath: options.catalogPath,
          catalogSha256: published.catalogSha256,
          durationMs: Date.now() - started,
          logTail
        } satisfies Extract<RegisteredQuantRunOutcome, { ok: true }>;
        receipts.set(key, outcome);
        while (receipts.size > REGISTERED_QUANT_RUN_RECEIPT_LIMIT) {
          const oldest = receipts.keys().next().value;
          if (oldest === undefined) break;
          receipts.delete(oldest);
        }
        return {
          ...outcome,
          durationMs: Date.now() - started
        };
      }
    }
  };

  function failed(symbol: string, message: string, logTail: string): RegisteredQuantRunOutcome {
    return { ok: false, schemaVersion: QUANT_REGISTERED_RUN_SCHEMA_VERSION, symbol, status: "failed", message, logTail };
  }
}

export function verifyRunManifest(manifest: unknown, expectedSymbol: string):
  | { ok: true }
  | { ok: false; message: string } {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { ok: false, message: "registered quant run manifest is malformed" };
  }
  const record = manifest as Record<string, unknown>;
  const feePolicy = quantManifestFeePolicyGate(record);
  if (!feePolicy.ok) return { ok: false, message: feePolicy.message };
  const dividendCash = quantManifestDividendCashGate(record);
  if (!dividendCash.ok) return { ok: false, message: dividendCash.message };
  if (!quantManifestExecutionCalendarIsBounded(record)) {
    return { ok: false, message: "registered quant run manifest does not carry bounded execution calendar metadata" };
  }
  const data = record.dataIdentity;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, message: "registered quant run manifest has no data identity" };
  }
  const universe = (data as Record<string, unknown>).universe;
  const symbols = Array.isArray(universe)
    ? universe.map((item) => (typeof item === "object" && item !== null
      ? `${String((item as Record<string, unknown>).market)}.${String((item as Record<string, unknown>).code)}`
      : ""))
    : [];
  if (!symbols.includes(expectedSymbol)) {
    return { ok: false, message: `registered quant run manifest is not bound to the requested symbol ${expectedSymbol}` };
  }
  if (typeof record.experimentIdentity !== "string" || record.experimentIdentity.trim() === "") {
    return { ok: false, message: "registered quant run manifest has no experiment identity" };
  }
  return { ok: true };
}

interface PublishCatalogOptions {
  repositoryRoot: string;
  catalogPath: string;
  source: QuantEvidenceSource;
  catalogReference: QuantEvidenceTrustedReference;
  symbol: string;
  manifestRelativePath: string;
  manifestSha256: string;
  generatedAt: string;
  decisionEvidence: { maxAgeDays: number; hkConnectUniverse?: HkConnectQuantUniverse };
  now: Date;
}

async function publishCatalogEntry(options: PublishCatalogOptions):
  Promise<{ ok: true; catalogSha256: string } | { ok: false; message: string }> {
  const absoluteCatalogPath = resolve(options.repositoryRoot, options.catalogPath);
  type CatalogEntry = { symbol: string; repositoryPath: string; sha256: string };
  let entries: CatalogEntry[] | null = null;
  let catalogFileMissing = false;
  try {
    const existing = JSON.parse(await readFile(absoluteCatalogPath, "utf8")) as Record<string, unknown>;
    if (existing.schemaVersion !== QUANT_DECISION_EVIDENCE_CATALOG_SCHEMA_VERSION || !Array.isArray(existing.entries)) {
      return { ok: false, message: "existing registered run catalog artifact is malformed" };
    }
    entries = existing.entries as CatalogEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
      return { ok: false, message: "existing registered run catalog artifact is malformed" };
    }
    catalogFileMissing = true;
  }
  if (!entries) {
    const base = options.catalogReference.current();
    const loaded = await options.source.read({ ...base, expectedSha256: base.expectedSha256 });
    if (!loaded.ok) {
      // A first run with no accepted catalog at all must still be able to
      // publish the single verified result it just produced. Missing old
      // configuration is not a permanent blocker for this bounded local run.
      if (catalogFileMissing && loaded.status === "missing") {
        entries = [];
      } else {
        return { ok: false, message: `accepted quant evidence catalog cannot be read before publishing: ${loaded.status}:${loaded.reason}` };
      }
    } else {
      const parsed = JSON.parse(loaded.content) as Record<string, unknown>;
      if (parsed.schemaVersion !== QUANT_DECISION_EVIDENCE_CATALOG_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
        return { ok: false, message: "accepted quant evidence catalog has an unexpected schema" };
      }
      entries = parsed.entries as CatalogEntry[];
    }
  }
  const next = entries.filter((entry) => entry.symbol !== options.symbol);
  next.push({ symbol: options.symbol, repositoryPath: options.manifestRelativePath, sha256: options.manifestSha256 });
  next.sort((left, right) => left.symbol.localeCompare(right.symbol));
  const content = `${JSON.stringify({
    schemaVersion: QUANT_DECISION_EVIDENCE_CATALOG_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    entries: next
  }, null, 2)}\n`;
  const temporaryPath = `${absoluteCatalogPath}.tmp-${randomBytes(4).toString("hex")}`;
  try {
    await mkdir(dirname(absoluteCatalogPath), { recursive: true });
    await writeFile(temporaryPath, content, "utf8");
  } catch {
    return { ok: false, message: "registered run catalog artifact could not be prepared" };
  }
  const catalogSha256 = createHash("sha256").update(content).digest("hex");
  // Verify the fully prepared catalog BEFORE the atomic rename: the existing
  // catalog/manifest loader resolves the new symbol's entry, and the decision
  // evidence adapter then validates that manifest's schema, identity, metrics,
  // chronology, and policy. A prepared artifact that fails never replaces the
  // accepted catalog pointer.
  const prepared = await verifyQuantEvidenceCatalog(options.source, {
    repositoryRoot: options.repositoryRoot,
    repositoryPath: relative(options.repositoryRoot, temporaryPath),
    expectedSha256: catalogSha256
  }, {
    symbol: options.symbol,
    maxAgeDays: options.decisionEvidence.maxAgeDays,
    now: options.now,
    ...(options.decisionEvidence.hkConnectUniverse ? { hkConnectUniverse: options.decisionEvidence.hkConnectUniverse } : {})
  });
  if (!prepared.ok) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    return { ok: false, message: `prepared catalog artifact did not verify before publish: ${prepared.reason}` };
  }
  try {
    await rename(temporaryPath, absoluteCatalogPath);
  } catch {
    return { ok: false, message: "registered run catalog artifact could not be published atomically" };
  }
  // The rename is the publication. The accepted in-memory reference is then
  // updated synchronously, so a failed post-rename re-read can never leave a
  // reported failure behind a catalog that is already the accepted pointer.
  options.catalogReference.publish({
    repositoryRoot: options.repositoryRoot,
    repositoryPath: options.catalogPath,
    expectedSha256: catalogSha256
  });
  return { ok: true, catalogSha256 };
}

function tail(value: string | Buffer): string {
  return value.toString("utf8").trim().slice(-2_000);
}
