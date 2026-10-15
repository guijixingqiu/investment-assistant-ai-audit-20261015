import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, resolve, join, relative } from "node:path";
import type { FastifyInstance } from "fastify";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import { registerFormalResearchRestoreRoutes } from "./formalResearchRestore.js";

const safePath = (path: string): boolean => path.split("/").every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..");
const snapshotName = /^formal-\d{14}-[a-f0-9]{8}$/;
function ownerMatches(actor: { actorType: string; actorId: string } | null): boolean {
  return actor?.actorType === "user" && actor.actorId === process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID;
}
interface BackupReceipt {
  owner: string;
  kind: string;
  eventId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  updatedAt: string;
  pid?: number;
  host?: string;
  snapshotId?: string;
  cutoffAt?: string;
  code?: string;
}
function receiptPath(owner: string, kind: string, eventId: string): string | null {
  const root = process.env.FORMAL_RESEARCH_BACKUP_STAGING_DIR;
  if (!root) return null;
  const identity = createHash("sha256").update(`${owner}\0${kind}\0${eventId}`).digest("hex");
  return join(root, "events", `${identity}.json`);
}
async function readEventReceipt(owner: string, kind: string, eventId: string): Promise<BackupReceipt | null> {
  const path = receiptPath(owner, kind, eventId);
  if (!path) return null;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as BackupReceipt;
    return value.owner === owner && value.kind === kind && value.eventId === eventId ? value : null;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeEventReceipt(actor: { actorId: string }, kind: string, eventId: string, status: BackupReceipt["status"], fields: Partial<BackupReceipt> = {}): Promise<void> {
  const path = receiptPath(actor.actorId, kind, eventId);
  if (!path) throw new Error("formal backup staging is not configured");
  const existing = await readEventReceipt(actor.actorId, kind, eventId);
  if (existing?.status === "SUCCEEDED" && status !== "SUCCEEDED") return;
  if (existing?.status === "RUNNING" && status === "PENDING") return;
  const directory = join(process.env.FORMAL_RESEARCH_BACKUP_STAGING_DIR!, "events");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receipt: BackupReceipt = { owner: actor.actorId, kind, eventId, status, updatedAt: new Date().toISOString(), ...fields };
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(receipt)}\n`); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  const parent = await open(directory, "r");
  try { await parent.sync(); } finally { await parent.close(); }
}
function receiptProcessAlive(receipt: BackupReceipt): boolean {
  if (receipt.host !== hostname() || !receipt.pid || !Number.isSafeInteger(receipt.pid)) return true;
  try { process.kill(receipt.pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export async function triggerFormalResearchBackup(actor: { actorType: string; actorId: string }, kind: string, eventId: string): Promise<boolean> {
  if (!ownerMatches(actor) || !/^[a-z_]+$/.test(kind) || !/^(?:[0-9]+|[a-f0-9]{64})$/.test(eventId)) return false;
  if (!process.env.FORMAL_RESEARCH_BACKUP_SYNC_DIR || !process.env.FORMAL_RESEARCH_BACKUP_STAGING_DIR) return false;
  try {
    await writeEventReceipt(actor, kind, eventId, "PENDING", { host: hostname() });
    const script = resolve(process.cwd(), "scripts/formal-research-backup.mjs");
    const child = spawn(process.execPath, [script, "snapshot", kind, eventId], { cwd: process.cwd(), env: process.env, detached: true, stdio: "ignore" });
    if (child.pid !== undefined) await writeEventReceipt(actor, kind, eventId, "PENDING", { pid: child.pid, host: hostname() });
    child.on("error", (error) => {
      process.stderr.write(`formal backup trigger failed: ${error.message}\n`);
      void writeEventReceipt(actor, kind, eventId, "FAILED", { pid: child.pid, host: hostname(), code: "CHILD_START_FAILED" }).catch(() => {});
    });
    child.on("exit", (code) => {
      void readEventReceipt(actor.actorId, kind, eventId).then((receipt) => {
        if (receipt && (receipt.status === "PENDING" || receipt.status === "RUNNING")) {
          return writeEventReceipt(actor, kind, eventId, "FAILED", { pid: child.pid, host: hostname(), code: code === 0 ? "NO_SNAPSHOT_RESULT" : "CHILD_EXIT_FAILED" });
        }
      }).catch(() => {});
    });
    child.unref();
    if (child.pid !== undefined) return true;
    await writeEventReceipt(actor, kind, eventId, "FAILED", { host: hostname(), code: "CHILD_START_FAILED" });
    return false;
  } catch (error) {
    process.stderr.write(`formal backup trigger failed: ${error instanceof Error ? error.message : String(error)}\n`);
    await writeEventReceipt(actor, kind, eventId, "FAILED", { host: hostname(), code: "TRIGGER_FAILED" }).catch(() => {});
    return false;
  }
}
export interface FormalManifest {
  schemaVersion: string;
  snapshotId: string;
  createdAt: string;
  cutoffAt: string;
  owner: { actorType: string; actorId: string };
  trigger: { kind: string; eventId: string | null };
  counts: unknown;
  files: { path: string; sha256: string; bytes: number }[];
}
async function readManifest(root: string, snapshotId: string): Promise<{ manifest: FormalManifest; bytes: Buffer }> {
  if (!snapshotName.test(snapshotId)) throw new Error("invalid snapshot ID");
  const directory = join(root, snapshotId);
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || relative(await realpath(root), await realpath(directory)) !== snapshotId) throw new Error("unsafe snapshot directory");
  const bytes = await readFile(join(directory, "manifest.json"));
  const digest = await readFile(join(directory, "manifest.sha256"), "utf8");
  if (digest.trim() !== `${createHash("sha256").update(bytes).digest("hex")}  manifest.json`) throw new Error("manifest mismatch");
  const manifest = JSON.parse(bytes.toString("utf8")) as FormalManifest;
  if (manifest.schemaVersion !== "2026-10-10.formal-research.v2" || manifest.snapshotId !== snapshotId || !ownerMatches(manifest.owner)) throw new Error("snapshot identity mismatch");
  return { manifest, bytes };
}
async function readTriggeredStatus(root: string, owner: string, kind: string, eventId: string): Promise<Record<string, unknown> | null> {
  const receipt = await readEventReceipt(owner, kind, eventId);
  if (!receipt) return null;
  const trigger = { kind, eventId };
  if (receipt.status === "FAILED") {
    if (receipt.snapshotId) {
      try {
        const { manifest } = await readManifest(root, receipt.snapshotId);
        if (manifest.trigger.kind === kind && manifest.trigger.eventId === eventId) return { status: "VERIFIED_LOCAL_MANIFEST", snapshotId: manifest.snapshotId, cutoffAt: manifest.cutoffAt, counts: manifest.counts, trigger, receiptWarning: receipt.code, cloudSyncStatus: "UNKNOWN" };
      } catch { /* retain the trigger-bound failure below */ }
    }
    return { status: "FAILED_LOCAL", trigger, failure: { code: receipt.code ?? "FORMAL_BACKUP_FAILED", failedAt: receipt.updatedAt }, cloudSyncStatus: "UNKNOWN" };
  }
  if (receipt.status === "PENDING" || receipt.status === "RUNNING") {
    if (Date.now() - Date.parse(receipt.updatedAt) > 24 * 60 * 60 * 1000) return { status: "FAILED_INTERRUPTED", trigger, failure: { code: "BACKUP_RECEIPT_STALE", failedAt: receipt.updatedAt }, cloudSyncStatus: "UNKNOWN" };
    if (!receipt.pid && Date.now() - Date.parse(receipt.updatedAt) > 5000) return { status: "FAILED_INTERRUPTED", trigger, failure: { code: "BACKUP_PROCESS_NOT_STARTED", failedAt: receipt.updatedAt }, cloudSyncStatus: "UNKNOWN" };
    if (!receiptProcessAlive(receipt) && receipt.pid) return { status: "FAILED_INTERRUPTED", trigger, failure: { code: "BACKUP_PROCESS_EXITED", failedAt: receipt.updatedAt }, cloudSyncStatus: "UNKNOWN" };
    return { status: receipt.status === "RUNNING" ? "RUNNING_LOCAL" : "PENDING_LOCAL", trigger, cloudSyncStatus: "UNKNOWN" };
  }
  if (receipt.status === "SUCCEEDED") {
    if (!receipt.snapshotId) return { status: "UNAVAILABLE", trigger, cloudSyncStatus: "UNKNOWN" };
    try {
      const { manifest } = await readManifest(root, receipt.snapshotId);
      if (manifest.trigger.kind !== kind || manifest.trigger.eventId !== eventId) throw new Error("trigger identity mismatch");
      return { status: "VERIFIED_LOCAL_MANIFEST", snapshotId: manifest.snapshotId, cutoffAt: manifest.cutoffAt, counts: manifest.counts, trigger, cloudSyncStatus: "UNKNOWN" };
    } catch { return { status: "EXPIRED_OR_UNAVAILABLE_LOCAL", trigger, cloudSyncStatus: "UNKNOWN" }; }
  }
  return null;
}
export async function registerFormalResearchBackupRoutes(app: FastifyInstance, options: MobileResearchRouteOptions): Promise<void> {
  await registerFormalResearchRestoreRoutes(app, options, readManifest);
  app.get("/api/mobile/research/formal-backup/snapshots", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "research-read authorization required" });
    if (!process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID || !process.env.FORMAL_RESEARCH_BACKUP_SYNC_DIR) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    if (!ownerMatches(actor)) return reply.code(403).send({ ok: false, message: "Owner scope required" });
    try {
      const root = process.env.FORMAL_RESEARCH_BACKUP_SYNC_DIR;
      const names = (await readdir(root)).filter((name) => snapshotName.test(name)).sort().reverse();
      const snapshots = [];
      for (const name of names) {
        try {
          const { manifest } = await readManifest(root, name);
          snapshots.push({ snapshotId: name, status: "VERIFIED_LOCAL_MANIFEST", cutoffAt: manifest.cutoffAt, counts: manifest.counts, trigger: manifest.trigger });
        } catch { snapshots.push({ snapshotId: name, status: "UNAVAILABLE" }); }
      }
      return { snapshots, cloudSyncStatus: "UNKNOWN" };
    } catch { return reply.code(503).send({ ok: false, status: "UNAVAILABLE" }); }
  });
  app.post("/api/mobile/research/formal-backup/snapshots", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (!process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    if (!ownerMatches(actor)) return reply.code(403).send({ ok: false, message: "Owner scope required" });
    const body = request.body as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 1 || body.idempotencyKey.length > 200) return reply.code(400).send({ ok: false, message: "idempotencyKey is required" });
    const eventId = createHash("sha256").update(`${actor.actorId}\0${body.idempotencyKey}`).digest("hex");
    if (!await triggerFormalResearchBackup(actor, "manual", eventId)) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED_OR_UNAVAILABLE" });
    return reply.code(202).send({ status: "TRIGGERED_LOCAL", trigger: { kind: "manual", eventId }, cloudSyncStatus: "UNKNOWN" });
  });
  app.get("/api/mobile/research/formal-backup/snapshots/:snapshotId/files", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "research-read authorization required" });
    if (!process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    if (!ownerMatches(actor)) return reply.code(403).send({ ok: false, message: "Owner scope required" });
    const root = process.env.FORMAL_RESEARCH_BACKUP_SYNC_DIR;
    if (!root) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    const { snapshotId } = request.params as { snapshotId: string };
    const { path } = request.query as { path?: string };
    if (!snapshotName.test(snapshotId) || typeof path !== "string" || !safePath(path)) return reply.code(400).send({ ok: false, message: "invalid snapshot file" });
    try {
      const { manifest, bytes: manifestBytes } = await readManifest(root, snapshotId);
      const meta = manifest.files.find((file) => file.path === path);
      if (!meta && path !== "manifest.json" && path !== "manifest.sha256") return reply.code(404).send({ ok: false, message: "snapshot file not found" });
      const absolute = join(root, snapshotId, path);
      const info = await lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink() || relative(join(root, snapshotId), await realpath(absolute)).startsWith("..")) throw new Error("unsafe snapshot file");
      const bytes = path === "manifest.json" ? manifestBytes : await readFile(absolute);
      if (meta && (bytes.length !== meta.bytes || createHash("sha256").update(bytes).digest("hex") !== meta.sha256)) throw new Error("snapshot file hash mismatch");
      reply.header("content-disposition", `attachment; filename="${basename(path)}"`);
      return reply.type(path.endsWith(".json") ? "application/json" : path.endsWith(".csv") ? "text/csv" : "application/octet-stream").send(bytes);
    } catch { return reply.code(503).send({ ok: false, status: "UNAVAILABLE" }); }
  });
  app.get("/api/mobile/research/formal-backup/status", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "research-read authorization required" });
    if (!process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID && actor.actorType === "user") return { status: "NOT_CONFIGURED", cloudSyncStatus: "UNKNOWN" };
    if (!ownerMatches(actor)) return reply.code(403).send({ ok: false, message: "Owner scope required" });
    const root = process.env.FORMAL_RESEARCH_BACKUP_SYNC_DIR;
    if (!root) return { status: "NOT_CONFIGURED", cloudSyncStatus: "UNKNOWN" };
    try {
      const names = (await readdir(root)).filter((name) => snapshotName.test(name)).sort().reverse();
      const { eventId, kind } = request.query as { eventId?: string; kind?: string };
      if (eventId !== undefined && (!/^(?:[0-9]+|[a-f0-9]{64})$/.test(eventId) || typeof kind !== "string" || !/^[a-z_]+$/.test(kind))) return reply.code(400).send({ ok: false, message: "invalid trigger identity" });
      if (eventId !== undefined) {
        const triggered = await readTriggeredStatus(root, actor.actorId, kind!, eventId);
        if (triggered) return triggered;
      }
      if (!names.length) {
        const failure = await lastFailure();
        return { status: failure ? "LAST_ATTEMPT_FAILED" : "UNKNOWN", cloudSyncStatus: "UNKNOWN", lastFailure: failure };
      }
      let manifest: FormalManifest | null = null;
      for (const name of names) {
        const candidate = (await readManifest(root, name)).manifest;
        if (eventId === undefined || (candidate.trigger.eventId === eventId && candidate.trigger.kind === kind)) { manifest = candidate; break; }
      }
      const failure = await lastFailure();
      if (!manifest) return { status: "UNKNOWN", trigger: { kind, eventId }, lastFailure: failure, cloudSyncStatus: "UNKNOWN" };
      return { status: failure?.failedAt && failure.failedAt > manifest.createdAt && eventId === undefined ? "LAST_ATTEMPT_FAILED" : "VERIFIED_LOCAL_MANIFEST", snapshotId: manifest.snapshotId, cutoffAt: manifest.cutoffAt, counts: manifest.counts, trigger: manifest.trigger, lastFailure: failure, cloudSyncStatus: "UNKNOWN" };
    } catch {
      return reply.code(503).send({ status: "UNAVAILABLE", cloudSyncStatus: "UNKNOWN" });
    }
  });
}

async function lastFailure(): Promise<{ failedAt: string; code: string; eventId: string | null } | null> {
  const root = process.env.FORMAL_RESEARCH_BACKUP_STAGING_DIR;
  if (!root) return null;
  try {
    const value = JSON.parse(await readFile(join(root, "last-failure.json"), "utf8")) as { owner: string; kind: string; failedAt: string; code: string; eventId?: string | null };
    return value.owner === process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID && value.code === "FORMAL_BACKUP_FAILED" && !Number.isNaN(Date.parse(value.failedAt)) ? { failedAt: value.failedAt, code: value.code, eventId: value.eventId ?? null } : null;
  } catch { return null; }
}
