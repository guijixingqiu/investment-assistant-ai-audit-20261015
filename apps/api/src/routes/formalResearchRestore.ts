import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import type { FormalManifest } from "./formalResearchBackup.js";
import { readResearchRawBytes } from "../research/researchDocumentCas.js";
import { extractGeelyOfficialHtml } from "../research/researchSourceSnapshotHtml.js";

type Receipt = {
  owner: string; restoreId: string; snapshotId: string; attempt: number;
  targetDatabase: string; status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  updatedAt: string; host?: string; pid?: number; code?: string;
  databaseRestore?: string;
};
type ReadManifest = (root: string, snapshotId: string) => Promise<{ manifest: FormalManifest; bytes: Buffer }>;
const snapshotName = /^formal-\d{14}-[a-f0-9]{8}$/;
const restoreName = /^[a-f0-9]{64}$/;
const membershipName = /^[1-9]\d*$/;
const shaName = /^[a-f0-9]{64}$/;
const base = "/api/mobile/research/formal-backup/restores";
const idFor = (owner: string, snapshotId: string, key: string): string =>
  createHash("sha256").update(`${owner}\0${snapshotId}\0${key}`).digest("hex");
const targetFor = (restoreId: string, attempt: number): string => `research_formal_restore_${restoreId.slice(0, 20)}_${attempt}`;
const inside = (parent: string, path: string): boolean => path === parent || (!relative(parent, path).startsWith("..") && !isAbsolute(relative(parent, path)));

async function readRestoredHtmlBytes(rawParent: string, restoreId: string, attempt: number,
  rawSha256: string, byteLength: number): Promise<Buffer> {
  if (!restoreName.test(restoreId) || !Number.isSafeInteger(attempt) || attempt < 1
    || !shaName.test(rawSha256) || !Number.isSafeInteger(byteLength) || byteLength < 1) throw new Error("invalid restored HTML identity");
  const directoryName = `${restoreId}-attempt-${attempt}`;
  const rawRoot = join(rawParent, directoryName);
  const parentInfo = await lstat(rawParent);
  const rootInfo = await lstat(rawRoot);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()
    || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()
    || relative(await realpath(rawParent), await realpath(rawRoot)) !== directoryName) {
    throw new Error("restored HTML store is not the requested restore instance");
  }
  return readResearchRawBytes(rawRoot, process.cwd(), rawSha256, byteLength);
}

export async function readVerifiedRestoredSource(
  pool: Pick<Pool, "query">, rawParent: string, restoreId: string, attempt: number,
  membershipId: string, sourceId: string, actorId: string
): Promise<{ sourceId: string; normalizedText: string; textSha256: string;
  rawOriginalStatus: "verified" | "unavailable" } | null> {
  const source = (await pool.query<{ id: string; normalized_text: string; text_sha256: string;
    raw_sha256: string; byte_length: number; extraction_version: string; summary: string }>(`select s.id::text,s.normalized_text,s.text_sha256,s.raw_sha256,s.byte_length,
        s.extraction_version,s.summary
      from research_source_snapshots s join candidate_memberships m on m.id=s.candidate_membership_id
      where s.id=$1 and m.id=$2 and m.actor_type='user' and m.actor_id=$3 and s.actor_type='user'
        and s.actor_id=$3 and s.symbol=m.symbol and s.media_type='text/html'`,
      [sourceId, membershipId, actorId])).rows[0];
  if (!source) return null;
  if (createHash("sha256").update(source.normalized_text).digest("hex") !== source.text_sha256) {
    throw new Error("restored source text hash mismatch");
  }
  let rawOriginalStatus: "verified" | "unavailable" = "unavailable";
  try {
    const bytes = await readRestoredHtmlBytes(rawParent, restoreId, attempt, source.raw_sha256,
      Number(source.byte_length));
    const extracted = extractGeelyOfficialHtml(bytes);
    if (extracted.normalizedText !== source.normalized_text
      || extracted.textSha256 !== source.text_sha256
      || extracted.extractionVersion !== source.extraction_version
      || extracted.summary !== source.summary) throw new Error("restored HTML text differs from original bytes");
    rawOriginalStatus = "verified";
  } catch { /* The saved text remains readable, but the HTML original is unavailable. */ }
  return { sourceId: source.id, normalizedText: source.normalized_text,
    textSha256: source.text_sha256, rawOriginalStatus };
}

function settings(): { sync: string; staging: string; rawParent: string; source: string } | null {
  const { FORMAL_RESEARCH_BACKUP_SYNC_DIR: sync, FORMAL_RESEARCH_BACKUP_STAGING_DIR: staging,
    FORMAL_RESEARCH_RESTORE_RAW_PARENT: rawParent, LOCAL_ALPHA_DATABASE_URL: source } = process.env;
  return sync && staging && rawParent && source ? { sync, staging, rawParent, source } : null;
}
function targetUrl(source: string, database: string): string {
  const url = new URL(source);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) throw new Error("source database must be local PostgreSQL");
  if (!/^research_formal_restore_[a-z0-9_]{8,40}$/.test(database)) throw new Error("invalid isolated database");
  url.pathname = `/${database}`;
  return url.toString();
}
async function safeRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("restore directory must be absolute");
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("restore directory is unsafe");
  return realpath(path);
}
async function checkedSettings(value: NonNullable<ReturnType<typeof settings>>): Promise<NonNullable<ReturnType<typeof settings>>> {
  const paths = await Promise.all([safeRoot(value.sync), safeRoot(value.staging), safeRoot(value.rawParent)]);
  const active = process.env.LOCAL_ALPHA_RAW_STORE_ROOT ?? process.env.RESEARCH_DOCUMENT_RAW_STORE_ROOT;
  if (paths.some((path, index) => index !== 2 && (inside(path, paths[2]) || inside(paths[2], path)))) throw new Error("restore raw parent overlaps backup");
  if (active) {
    const activePath = await safeRoot(active);
    if (inside(activePath, paths[2]) || inside(paths[2], activePath)) throw new Error("restore raw parent overlaps active originals");
  }
  targetUrl(value.source, targetFor("a".repeat(64), 1));
  return { sync: paths[0], staging: paths[1], rawParent: paths[2], source: value.source };
}
function receiptDir(staging: string, restoreId: string): string { return join(staging, "restore-requests", restoreId); }
function receiptFile(staging: string, restoreId: string, attempt: number): string { return join(receiptDir(staging, restoreId), `attempt-${attempt}.json`); }
async function readReceipt(staging: string, restoreId: string, attempt: number, owner: string): Promise<Receipt | null> {
  try {
    const path = receiptFile(staging, restoreId, attempt);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe restore receipt");
    const row = JSON.parse(await readFile(path, "utf8")) as Receipt;
    if (row.restoreId !== restoreId || row.owner !== owner || row.attempt !== attempt || !snapshotName.test(row.snapshotId)
      || row.targetDatabase !== targetFor(restoreId, attempt) || !["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].includes(row.status)) throw new Error("restore receipt identity mismatch");
    return row;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function latestReceipt(staging: string, restoreId: string, owner: string): Promise<Receipt | null> {
  let names: string[];
  try {
    const root = join(staging, "restore-requests");
    const parent = await lstat(root);
    const directory = await lstat(receiptDir(staging, restoreId));
    if (!parent.isDirectory() || parent.isSymbolicLink() || !directory.isDirectory() || directory.isSymbolicLink()
      || relative(await realpath(root), await realpath(receiptDir(staging, restoreId))) !== restoreId) throw new Error("unsafe restore request directory");
    names = await readdir(receiptDir(staging, restoreId));
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const attempts = names.map((name) => /^attempt-([1-3])\.json$/.exec(name)).filter((match) => match !== null).map((match) => Number(match![1]));
  if (!attempts.length) return null;
  return readReceipt(staging, restoreId, Math.max(...attempts), owner);
}
function effectiveStatus(row: Receipt): string {
  if (row.status === "SUCCEEDED") return row.databaseRestore === "VERIFIED_LOCAL" ? "VERIFIED_LOCAL_DATABASE" : "FAILED_LOCAL";
  if (row.status === "FAILED") return "FAILED_LOCAL";
  if (Date.now() - Date.parse(row.updatedAt) > 24 * 60 * 60 * 1000) return "FAILED_INTERRUPTED";
  if (row.status === "PENDING" && Date.now() - Date.parse(row.updatedAt) > 10_000) return "FAILED_INTERRUPTED";
  if (row.host === hostname() && row.pid) {
    try { process.kill(row.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return "FAILED_INTERRUPTED"; }
  }
  return row.status === "RUNNING" ? "RUNNING_LOCAL" : "PENDING_LOCAL";
}
function publicStatus(row: Receipt): Record<string, unknown> {
  const status = effectiveStatus(row);
  return { restoreId: row.restoreId, snapshotId: row.snapshotId, attempt: row.attempt, status,
    databaseRestore: status === "VERIFIED_LOCAL_DATABASE" ? "VERIFIED_LOCAL" : "NOT_VERIFIED",
    failure: status.startsWith("FAILED") ? { code: row.code ?? status, failedAt: row.updatedAt } : null,
    target: "ISOLATED_LOCAL_DATABASE", activeResearchChanged: false };
}
async function verifiedReceipt(staging: string, restoreId: string, owner: string): Promise<Receipt | null> {
  if (!restoreName.test(restoreId)) return null;
  const row = await latestReceipt(staging, restoreId, owner);
  return row && effectiveStatus(row) === "VERIFIED_LOCAL_DATABASE" ? row : null;
}
async function restoredPool(row: Receipt, source: string): Promise<Pool> {
  const pool = new Pool({ connectionString: targetUrl(source, row.targetDatabase), max: 1, options: "-c default_transaction_read_only=on" });
  try {
    const actual = await pool.query<{ name: string }>("select current_database() as name");
    if (actual.rows[0]?.name !== row.targetDatabase) throw new Error("restored database identity mismatch");
    return pool;
  } catch (error) { await pool.end(); throw error; }
}

export async function registerFormalResearchRestoreRoutes(app: FastifyInstance, options: MobileResearchRouteOptions, readManifest: ReadManifest): Promise<void> {
  const readOwner = (headers: Parameters<typeof authenticateReadOnly>[0]) => authenticateReadOnly(headers, options);
  const writeOwner = (headers: Parameters<typeof authenticateWrite>[0]) => authenticateWrite(headers, options, "research_write");
  app.post(base, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = writeOwner(request.headers);
    if (!actor) return reply.code(401).send({ ok: false, code: "WRITE_AUTH_REQUIRED" });
    if (actor.actorType !== "user" || actor.actorId !== process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(403).send({ ok: false, code: "OWNER_REQUIRED" });
    const body = request.body as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || Object.keys(body).sort().join() !== "idempotencyKey,snapshotId"
      || typeof body.snapshotId !== "string" || !snapshotName.test(body.snapshotId)
      || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 1 || body.idempotencyKey.length > 200) return reply.code(400).send({ ok: false, code: "INVALID_RESTORE_REQUEST" });
    const configured = settings();
    if (!configured) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    try {
      const config = await checkedSettings(configured);
      await readManifest(config.sync, body.snapshotId);
      const restoreId = idFor(actor.actorId, body.snapshotId, body.idempotencyKey);
      const parent = join(config.staging, "restore-requests");
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const parentInfo = await lstat(parent);
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("unsafe restore request root");
      const directory = receiptDir(config.staging, restoreId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryInfo = await lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || relative(await realpath(parent), await realpath(directory)) !== restoreId) throw new Error("unsafe restore request directory");
      const previous = await latestReceipt(config.staging, restoreId, actor.actorId);
      if (previous && previous.snapshotId !== body.snapshotId) throw new Error("restore identity collision");
      if (previous && !["FAILED_LOCAL", "FAILED_INTERRUPTED"].includes(effectiveStatus(previous))) return reply.code(202).send(publicStatus(previous));
      const attempt = (previous?.attempt ?? 0) + 1;
      if (attempt > 3) return reply.code(409).send({ ok: false, status: "RETRY_LIMIT_REACHED", restoreId });
      const targetDatabase = targetFor(restoreId, attempt);
      const file = receiptFile(config.staging, restoreId, attempt);
      const row: Receipt = { owner: actor.actorId, restoreId, snapshotId: body.snapshotId, attempt, targetDatabase,
        status: "PENDING", updatedAt: new Date().toISOString(), host: hostname() };
      const temporary = join(directory, `.attempt-${attempt}.${randomUUID()}.tmp`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(`${JSON.stringify(row)}\n`); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const existing = await readReceipt(config.staging, restoreId, attempt, actor.actorId);
          if (existing) return reply.code(202).send(publicStatus(existing));
        }
        throw error;
      } finally { await unlink(temporary); }
      const directoryHandle = await open(directory, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      const child = spawn(process.execPath, [resolve(process.cwd(), "scripts/formal-research-backup.mjs"), "restore-request"], {
        cwd: process.cwd(), detached: true, stdio: "ignore", env: {
          ...process.env, FORMAL_RESEARCH_BACKUP_SNAPSHOT_DIR: join(config.sync, body.snapshotId),
          FORMAL_RESEARCH_RESTORE_DATABASE_URL: targetUrl(config.source, targetDatabase),
          FORMAL_RESEARCH_RESTORE_RAW_STORE_ROOT: join(config.rawParent, `${restoreId}-attempt-${attempt}`),
          FORMAL_RESEARCH_RESTORE_RECEIPT_PATH: file,
        }
      });
      child.on("error", (error) => { process.stderr.write(`formal restore child failed: ${error.message}\n`); });
      child.unref();
      return reply.code(202).send(publicStatus(row));
    } catch (error) {
      process.stderr.write(`formal restore submission failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return reply.code(503).send({ ok: false, status: "UNAVAILABLE" });
    }
  });
  app.get(`${base}/:restoreId`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = readOwner(request.headers);
    if (!actor) return reply.code(401).send({ ok: false, code: "READ_AUTH_REQUIRED" });
    if (actor.actorType !== "user" || actor.actorId !== process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(403).send({ ok: false, code: "OWNER_REQUIRED" });
    const staging = process.env.FORMAL_RESEARCH_BACKUP_STAGING_DIR;
    if (!staging) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    const { restoreId } = request.params as { restoreId: string };
    if (!restoreName.test(restoreId)) return reply.code(400).send({ ok: false, code: "INVALID_RESTORE_ID" });
    try {
      const row = await latestReceipt(staging, restoreId, actor.actorId);
      if (!row) return reply.code(404).send({ ok: false, status: "NOT_FOUND" });
      return publicStatus(row);
    } catch { return reply.code(503).send({ ok: false, status: "UNAVAILABLE" }); }
  });
  app.get(`${base}/:restoreId/companies`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = readOwner(request.headers);
    if (!actor) return reply.code(401).send({ ok: false, code: "READ_AUTH_REQUIRED" });
    if (actor.actorType !== "user" || actor.actorId !== process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(403).send({ ok: false, code: "OWNER_REQUIRED" });
    const config = settings();
    if (!config) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    const { restoreId } = request.params as { restoreId: string };
    try {
      const row = await verifiedReceipt(config.staging, restoreId, actor.actorId);
      if (!row) return reply.code(409).send({ ok: false, status: "RESTORE_NOT_VERIFIED" });
      const pool = await restoredPool(row, config.source);
      try {
        const companies = await pool.query(`select id::text, market, code, version from candidate_memberships
          where actor_type='user' and actor_id=$1 order by market,code,id`, [actor.actorId]);
        return { restoreId, snapshotId: row.snapshotId, companies: companies.rows };
      } finally { await pool.end(); }
    } catch { return reply.code(503).send({ ok: false, status: "RESTORED_DATABASE_UNAVAILABLE" }); }
  });
  app.get(`${base}/:restoreId/companies/:membershipId`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = readOwner(request.headers);
    if (!actor) return reply.code(401).send({ ok: false, code: "READ_AUTH_REQUIRED" });
    if (actor.actorType !== "user" || actor.actorId !== process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(403).send({ ok: false, code: "OWNER_REQUIRED" });
    const config = settings();
    if (!config) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    const { restoreId, membershipId } = request.params as { restoreId: string; membershipId: string };
    if (!restoreName.test(restoreId) || !membershipName.test(membershipId)) return reply.code(400).send({ ok: false, code: "INVALID_ID" });
    try {
      const row = await verifiedReceipt(config.staging, restoreId, actor.actorId);
      if (!row) return reply.code(409).send({ ok: false, status: "RESTORE_NOT_VERIFIED" });
      const pool = await restoredPool(row, config.source);
      try {
        const member = (await pool.query(`select id::text,market,code,version from candidate_memberships
          where id=$1 and actor_type='user' and actor_id=$2`, [membershipId, actor.actorId])).rows[0];
        if (!member) return reply.code(404).send({ ok: false, status: "COMPANY_NOT_FOUND" });
        const hasReviewSnapshots = (await pool.query<{ exists: boolean }>("select to_regclass('public.research_review_snapshots') is not null as exists")).rows[0]?.exists;
        const [sources, documents, reports, decisions, checks, reviews, milestones, packs] = await Promise.all([
          pool.query(`select id::text,publisher,response_url,summary,captured_at,left(normalized_text,100000) as normalized_text,
            length(normalized_text)>100000 as text_truncated from research_source_snapshots where candidate_membership_id=$1 order by captured_at desc,id desc`, [membershipId]),
          pool.query(`select d.id::text,d.title,d.published_at,d.pdf_sha256,d.page_count,
            (select left(string_agg(left(p.normalized_text,10000),E'\\n\\n' order by p.page_number),100000) from research_document_pages p where p.document_id=d.id) as page_text
            from research_documents d where d.candidate_membership_id=$1 order by d.imported_at desc,d.id desc`, [membershipId]),
          pool.query(`select r.id::text,r.evidence_pack_id::text,r.status,r.report_payload::text as report_text,r.created_at from deep_research_reports r
            join research_evidence_packs p on p.id=r.evidence_pack_id where p.candidate_membership_id=$1 order by r.created_at desc,r.id desc`, [membershipId]),
          pool.query(`select d.id::text,d.report_id::text,d.decision,d.note,d.created_at from deep_research_report_decisions d
            join deep_research_reports r on r.id=d.report_id join research_evidence_packs p on p.id=r.evidence_pack_id
            where p.candidate_membership_id=$1 and d.actor_type='user' and d.actor_id=$2 order by d.created_at desc,d.id desc`, [membershipId, actor.actorId]),
          pool.query(`select c.id::text,c.action_intent,c.verdict,c.user_final_decision,c.checked_at,c.decision_context_snapshot::text as context_text
            from pre_trade_decision_checks c join candidate_memberships m on m.market=c.market and m.code=c.code
            where m.id=$1 order by c.checked_at desc,c.id desc`, [membershipId]),
          pool.query(`select r.id::text,r.outcome,r.outcome_evidence,r.review_note,r.reviewed_at from post_decision_reviews r
            join pre_trade_decision_checks c on c.id=r.decision_check_id
            join candidate_memberships m on m.market=c.market and m.code=c.code
            where m.id=$1 and r.actor_type='user' and r.actor_id=$2 order by r.reviewed_at desc,r.id desc`, [membershipId, actor.actorId]),
          hasReviewSnapshots
            ? pool.query(`select id::text,payload::text as payload_text,created_at from research_review_snapshots where candidate_membership_id=$1 and actor_type='user' and actor_id=$2 order by created_at desc`, [membershipId, actor.actorId])
            : Promise.resolve({ rows: [] }),
          pool.query<{ id: string; items: unknown }>(`select p.id::text,p.items from research_evidence_packs p
            where p.candidate_membership_id=$1 and exists(select 1 from deep_research_reports r where r.evidence_pack_id=p.id)`, [membershipId]),
        ]);
        const evidenceItems = packs.rows.flatMap((pack) => Array.isArray(pack.items)
          ? pack.items.flatMap((raw: unknown) => {
            if (!raw || typeof raw !== "object") return [];
            const item = raw as Record<string, unknown>;
            if (typeof item.evidenceId !== "string") return [];
            const citations: Record<string, unknown>[] = [];
            if (item.citation && typeof item.citation === "object") {
              const citation = item.citation as Record<string, unknown>;
              if (typeof citation.documentId === "string" && membershipName.test(citation.documentId)
                && typeof citation.pageNumber === "number" && Number.isSafeInteger(citation.pageNumber)
                && citation.pageNumber > 0 && typeof citation.pageTextSha256 === "string"
                && shaName.test(citation.pageTextSha256)) citations.push({ kind: "document_page",
                  documentId: citation.documentId, pageNumber: citation.pageNumber,
                  pageTextSha256: citation.pageTextSha256 });
            }
            if (item.snapshotCitation && typeof item.snapshotCitation === "object") {
              const citation = item.snapshotCitation as Record<string, unknown>;
              if (typeof citation.snapshotId === "string" && membershipName.test(citation.snapshotId)
                && typeof citation.textSha256 === "string" && shaName.test(citation.textSha256)
                && typeof citation.startUtf16 === "number" && Number.isSafeInteger(citation.startUtf16)
                && citation.startUtf16 >= 0 && typeof citation.endUtf16 === "number"
                && Number.isSafeInteger(citation.endUtf16) && citation.endUtf16 > citation.startUtf16
                && typeof citation.excerptSha256 === "string" && shaName.test(citation.excerptSha256)) {
                citations.push({ kind: "source_snapshot", snapshotId: citation.snapshotId,
                  textSha256: citation.textSha256, startUtf16: citation.startUtf16,
                  endUtf16: citation.endUtf16, excerptSha256: citation.excerptSha256 });
              }
            }
            return [{ packId: pack.id, evidenceId: item.evidenceId,
              title: typeof item.title === "string" ? item.title : item.evidenceId, citations }];
          }) : []);
        return { restoreId, snapshotId: row.snapshotId, company: member, sourceSnapshots: sources.rows,
          documents: documents.rows, reports: reports.rows, evidenceItems, reportDecisions: decisions.rows,
          decisionChecks: checks.rows, postDecisionReviews: reviews.rows, reviewSnapshots: milestones.rows,
          pdfState: documents.rowCount ? "ORIGINALS_AVAILABLE" : "NO_PDF",
          sourceState: sources.rowCount ? "RESTORED_SOURCE_READABLE" : "NO_HTML_SOURCE" };
      } finally { await pool.end(); }
    } catch { return reply.code(503).send({ ok: false, status: "RESTORED_DATABASE_UNAVAILABLE" }); }
  });
  app.get(`${base}/:restoreId/companies/:membershipId/documents/:documentId/pages/:pageNumber`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = readOwner(request.headers);
    if (!actor) return reply.code(401).send({ ok: false, code: "READ_AUTH_REQUIRED" });
    if (actor.actorType !== "user" || actor.actorId !== process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(403).send({ ok: false, code: "OWNER_REQUIRED" });
    const config = settings();
    if (!config) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    const { restoreId, membershipId, documentId, pageNumber } = request.params as Record<string, string>;
    if (!restoreName.test(restoreId) || !membershipName.test(membershipId)
      || !membershipName.test(documentId) || !membershipName.test(pageNumber)) return reply.code(400).send({ ok: false, code: "INVALID_ID" });
    try {
      const row = await verifiedReceipt(config.staging, restoreId, actor.actorId);
      if (!row) return reply.code(409).send({ ok: false, status: "RESTORE_NOT_VERIFIED" });
      const pool = await restoredPool(row, config.source);
      try {
        const page = (await pool.query<{ document_id: string; page_number: number; normalized_text: string; text_sha256: string; ocr_applied: boolean }>(
          `select p.document_id::text,p.page_number,p.normalized_text,p.text_sha256,p.ocr_applied
             from research_document_pages p join research_documents d on d.id=p.document_id
             join candidate_memberships m on m.id=d.candidate_membership_id
            where m.id=$1 and m.actor_type='user' and m.actor_id=$2 and d.id=$3 and p.page_number=$4`,
          [membershipId, actor.actorId, documentId, pageNumber])).rows[0];
        if (!page) return reply.code(404).send({ ok: false, status: "PAGE_NOT_FOUND" });
        if (createHash("sha256").update(page.normalized_text).digest("hex") !== page.text_sha256) throw new Error("restored page hash mismatch");
        return { documentId: page.document_id, pageNumber: page.page_number,
          normalizedText: page.normalized_text, pageTextSha256: page.text_sha256,
          textSource: page.ocr_applied ? "ocr" : page.normalized_text.length ? "text_layer" : "blank" };
      } finally { await pool.end(); }
    } catch { return reply.code(503).send({ ok: false, status: "RESTORED_PAGE_UNAVAILABLE" }); }
  });
  app.get(`${base}/:restoreId/companies/:membershipId/originals/:sha256`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = readOwner(request.headers);
    if (!actor) return reply.code(401).send({ ok: false, code: "READ_AUTH_REQUIRED" });
    if (actor.actorType !== "user" || actor.actorId !== process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(403).send({ ok: false, code: "OWNER_REQUIRED" });
    const config = settings();
    if (!config) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    const { restoreId, membershipId, sha256 } = request.params as { restoreId: string; membershipId: string; sha256: string };
    if (!restoreName.test(restoreId) || !membershipName.test(membershipId) || !shaName.test(sha256)) return reply.code(400).send({ ok: false, code: "INVALID_ID" });
    try {
      const row = await verifiedReceipt(config.staging, restoreId, actor.actorId);
      if (!row) return reply.code(409).send({ ok: false, status: "RESTORE_NOT_VERIFIED" });
      const pool = await restoredPool(row, config.source);
      try {
        const match = await pool.query(`select d.byte_length from research_documents d join candidate_memberships m on m.id=d.candidate_membership_id
          where m.id=$1 and m.actor_type='user' and m.actor_id=$2 and d.pdf_sha256=$3 limit 1`, [membershipId, actor.actorId, sha256]);
        if (!match.rowCount) return reply.code(404).send({ ok: false, status: "ORIGINAL_NOT_FOUND" });
        const rawRoot = join(config.rawParent, `${restoreId}-attempt-${row.attempt}`);
        const file = join(rawRoot, sha256.slice(0, 2), sha256);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || !inside(await realpath(rawRoot), await realpath(file))) throw new Error("unsafe restored original");
        const bytes = await readFile(file);
        if (bytes.length !== Number(match.rows[0].byte_length) || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("restored original hash mismatch");
        return reply.type("application/pdf").send(bytes);
      } finally { await pool.end(); }
    } catch { return reply.code(503).send({ ok: false, status: "RESTORED_ORIGINAL_UNAVAILABLE" }); }
  });
  app.get(`${base}/:restoreId/companies/:membershipId/sources/:sourceId`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = readOwner(request.headers);
    if (!actor) return reply.code(401).send({ ok: false, code: "READ_AUTH_REQUIRED" });
    if (actor.actorType !== "user" || actor.actorId !== process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return reply.code(403).send({ ok: false, code: "OWNER_REQUIRED" });
    const config = settings();
    if (!config) return reply.code(503).send({ ok: false, status: "NOT_CONFIGURED" });
    const { restoreId, membershipId, sourceId } = request.params as { restoreId: string; membershipId: string; sourceId: string };
    if (!restoreName.test(restoreId) || !membershipName.test(membershipId) || !membershipName.test(sourceId)) return reply.code(400).send({ ok: false, code: "INVALID_ID" });
    try {
      const row = await verifiedReceipt(config.staging, restoreId, actor.actorId);
      if (!row) return reply.code(409).send({ ok: false, status: "RESTORE_NOT_VERIFIED" });
      const pool = await restoredPool(row, config.source);
      try {
        const source = await readVerifiedRestoredSource(pool, config.rawParent, restoreId,
          row.attempt, membershipId, sourceId, actor.actorId);
        if (!source) return reply.code(404).send({ ok: false, status: "SOURCE_NOT_FOUND" });
        return source;
      } finally { await pool.end(); }
    } catch { return reply.code(503).send({ ok: false, status: "RESTORED_SOURCE_UNAVAILABLE" }); }
  });
}
