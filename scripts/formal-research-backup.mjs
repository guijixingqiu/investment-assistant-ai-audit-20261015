#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { FORMAL_TABLES, EXCLUDED_TABLES } from './formal-research-backup-selection.mjs';

const VERSION = '2026-10-10.formal-research.v2';
const PRE_PROVIDER_FORMAL_TABLES = FORMAL_TABLES.filter(([table]) => table !== 'research_futu_valuation_captures');
const LEGACY_FORMAL_TABLES = PRE_PROVIDER_FORMAL_TABLES.filter(([table]) => table !== 'research_financial_requirements');
/** Known R32, R33, and R41 formal table sets are restorable. */
export function formalTablesForManifest(manifest) {
  const counts = manifest?.counts?.tables;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw Error('unsupported formal table set');
  const names = Object.keys(counts);
  const known = [LEGACY_FORMAL_TABLES, PRE_PROVIDER_FORMAL_TABLES, FORMAL_TABLES].find((tables) =>
    names.length === tables.length && tables.every(([table], index) => names[index] === table));
  if (!known || names.some((name) => !Number.isSafeInteger(counts[name]) || counts[name] < 0))
    throw Error('unsupported formal table set');
  return known;
}
const execFileAsync = promisify(execFile);
const backupHost = hostname();
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const required = (value, name) => { if (!value || !value.trim()) throw Error(`${name} is required`); return value.trim(); };
const safeSegment = (value) => /^[a-zA-Z0-9_.-]+$/.test(value) && value !== '.' && value !== '..';
const serialize = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const serializeRows = (rows) => Buffer.from(`[\n${rows.join(',\n')}\n]\n`);
function parseLossless(raw) {
  let quoted = false, escaped = false, result = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { result += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; result += c; continue; }
    if (c === '-' || (c >= '0' && c <= '9')) { const match = raw.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/); if (match) { result += '"' + match[0] + '"'; i += match[0].length - 1; continue; } }
    result += c;
  }
  return JSON.parse(result);
}
function rawArrayElements(source) {
  const result = [];
  let quoted = false, escaped = false, depth = 0, start = -1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    if (c === '}') { depth--; if (depth === 0) result.push(source.slice(start, i + 1)); if (depth < 0) throw Error('invalid row array'); }
  }
  if (quoted || depth !== 0 || !Array.isArray(JSON.parse(source)) || result.length !== JSON.parse(source).length) throw Error('invalid row array');
  return result;
}
async function safeDirectory(value, name) {
  if (!isAbsolute(value)) throw Error(`${name} must be absolute`);
  await mkdir(value, { recursive: true, mode: 0o700 });
  const info = await lstat(value);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error(`${name} must be a real directory`);
  await chmod(value, 0o700);
  return realpath(value);
}
async function prospectiveDirectory(value, name) {
  if (!isAbsolute(value)) throw Error(`${name} must be absolute`);
  try {
    const metadata = await lstat(value);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw Error(`${name} must be a real directory`);
    return { path: await realpath(value), exists: true };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { path: join(await realpath(dirname(value)), basename(value)), exists: false };
  }
}
function receiptName(owner, kind, eventId) { return `${sha(`${owner}\0${kind}\0${eventId}`)}.json`; }
async function readReceipt(stageParent, owner, kind, eventId) {
  const directory = join(stageParent, 'events');
  try {
    const receipt = JSON.parse((await safeFile(directory, join(directory, receiptName(owner, kind, eventId)))).toString('utf8'));
    return receipt.owner === owner && receipt.kind === kind && receipt.eventId === eventId ? receipt : null;
  } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
async function writeReceipt(stageParent, owner, kind, eventId, status, fields = {}) {
  if (!eventId) return null;
  const directory = await safeDirectory(join(stageParent, 'events'), 'backup event receipts');
  const existing = await readReceipt(stageParent, owner, kind, eventId);
  if (existing?.status === 'SUCCEEDED' && status !== 'SUCCEEDED') return existing;
  const receipt = { owner, kind, eventId, status, updatedAt: new Date().toISOString(), ...fields };
  const temporary = join(directory, `.${receiptName(owner, kind, eventId)}.${randomUUID()}.tmp`);
  await writeFile(temporary, serialize(receipt), { flag: 'wx', mode: 0o600 });
  await rename(temporary, join(directory, receiptName(owner, kind, eventId)));
  await syncDirectory(directory);
  return receipt;
}
function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; return true; }
}
async function acquireBackupLock(stageParent, owner, environment, recoverDead = true) {
  const minutes = Number(environment.FORMAL_RESEARCH_BACKUP_LOCK_WAIT_MINUTES ?? 60);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 180) throw Error('invalid backup lock wait limit');
  const path = join(stageParent, '.formal-backup.lock');
  const deadline = Date.now() + minutes * 60_000;
  const identity = { pid: process.pid, ppid: process.ppid, host: backupHost, owner, nonce: randomUUID(), startedAt: new Date().toISOString() };
  while (Date.now() < deadline) {
    try {
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(serialize(identity)); await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(stageParent);
      return identity;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const bytes = await safeFile(stageParent, path).catch((readError) => readError?.code === 'ENOENT' ? null : Promise.reject(readError));
      if (bytes) {
        let holder;
        try { holder = JSON.parse(bytes.toString('utf8')); } catch { throw Error('backup lock identity is unreadable'); }
        if (holder.host === backupHost && !processIsAlive(holder.pid)) {
          if (!recoverDead) throw Error('backup lock requires inspection before restore');
          const recovery = `${path}.recovery`;
          let claimed = false;
          try {
            await mkdir(recovery, { mode: 0o700 });
            claimed = true;
            await writeFile(join(recovery, 'owner.json'), serialize({ pid: process.pid, host: backupHost }), { flag: 'wx', mode: 0o600 });
          } catch (claimError) {
            if (claimError?.code !== 'EEXIST') { if (claimed) await rm(recovery, { recursive: true, force: true }); throw claimError; }
            const marker = await readFile(join(recovery, 'owner.json'), 'utf8').catch((readError) => readError?.code === 'ENOENT' ? null : Promise.reject(readError));
            if (marker) {
              const claimant = JSON.parse(marker);
              if (claimant.host === backupHost && !processIsAlive(claimant.pid)) await rm(recovery, { recursive: true, force: true });
            } else if (Date.now() - (await stat(recovery)).mtimeMs > 5000) await rm(recovery, { recursive: true, force: true });
            await pause(100);
            continue;
          }
          try {
            const unchanged = await safeFile(stageParent, path).catch((readError) => readError?.code === 'ENOENT' ? null : Promise.reject(readError));
            if (unchanged && unchanged.equals(bytes)) await rm(path);
          } finally { await rm(recovery, { recursive: true, force: true }); }
          continue;
        }
      }
      await pause(1000);
    }
  }
  throw Error('backup lock wait limit reached');
}
async function releaseBackupLock(stageParent, identity) {
  if (!identity) return;
  const path = join(stageParent, '.formal-backup.lock');
  const bytes = await safeFile(stageParent, path).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!bytes) return;
  const current = JSON.parse(bytes.toString('utf8'));
  if (current.nonce === identity.nonce && current.pid === identity.pid && current.host === identity.host) {
    await rm(path);
    await syncDirectory(stageParent);
  }
}
async function safeFile(root, path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw Error(`unsafe file: ${path}`);
  if (!relative(root, await realpath(path)).startsWith('..')) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return await handle.readFile(); } finally { await handle.close(); }
  }
  throw Error(`file escapes directory: ${path}`);
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function syncTree(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await syncTree(join(path, entry.name));
  await syncDirectory(path);
}
function retentionLimit(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 366) throw Error('invalid formal backup retention limit');
  return number;
}
async function pruneFormalSnapshots(sync, env) {
  const daily = retentionLimit(env.FORMAL_RESEARCH_BACKUP_RETENTION_DAILY, 30);
  const weekly = retentionLimit(env.FORMAL_RESEARCH_BACKUP_RETENTION_WEEKLY, 12);
  const monthly = retentionLimit(env.FORMAL_RESEARCH_BACKUP_RETENTION_MONTHLY, 12);
  const names = (await readdir(sync)).filter((name) => /^formal-\d{14}-[a-f0-9]{8}$/.test(name)).sort().reverse();
  const days = new Set(), weeks = new Set(), months = new Set(), keep = new Set();
  for (const name of names) {
    const date = new Date(`${name.slice(7,11)}-${name.slice(11,13)}-${name.slice(13,15)}T${name.slice(15,17)}:${name.slice(17,19)}:${name.slice(19,21)}Z`);
    if (Number.isNaN(date.valueOf())) throw Error('invalid snapshot date');
    const day = date.toISOString().slice(0,10), month = day.slice(0,7);
    const monday = new Date(date); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const week = monday.toISOString().slice(0,10);
    const retain = names[0] === name || (!days.has(day) && days.size < daily) || (!weeks.has(week) && weeks.size < weekly) || (!months.has(month) && months.size < monthly);
    if (retain) { keep.add(name); days.add(day); weeks.add(week); months.add(month); }
  }
  let deleted = 0;
  for (const name of names) {
    if (keep.has(name)) continue;
    const path = join(sync, name), meta = await lstat(path);
    if (!meta.isDirectory() || meta.isSymbolicLink() || relative(sync, await realpath(path)) !== name) throw Error('unsafe retention target');
    await verifySnapshot(path);
    await rm(path, { recursive: true }); deleted++;
  }
  if (deleted) await syncDirectory(sync);
  return { deleted, retained: names.length - deleted, daily, weekly, monthly };
}
async function put(root, name, bytes, files) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  files.push({ path: name, sha256: sha(bytes), bytes: bytes.length });
}
function csv(rows, cols) {
  const cell = (value) => `"${String(value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : value).replaceAll('"', '""')}"`;
  return Buffer.from(`${cols.map(cell).join(',')}\n${rows.map((row) => cols.map((key) => cell(row[key])).join(',')).join('\n')}\n`);
}
export function membershipForRow(table, row, links) {
  if (table === 'candidate_memberships') return String(row.id);
  if (table === 'candidate_membership_audit_events') return row.membership_id === null ? undefined : String(row.membership_id);
  if (table === 'research_write_audit_events') return links.auditTargets.get(`${row.target_table}:${row.target_id}`);
  if (row.candidate_membership_id != null) return String(row.candidate_membership_id);
  if (table === 'research_document_pages' || table === 'research_document_review_events') return links.documents.get(String(row.document_id));
  if (table === 'research_source_lead_events') return links.leads.get(String(row.lead_id));
  if (table === 'research_futu_financial_statement_pages') return links.captures.get(String(row.capture_id));
  if (table === 'deep_research_reports') return links.packs.get(String(row.evidence_pack_id));
  if (table === 'deep_research_report_decisions') return links.reports.get(String(row.report_id));
  if (table === 'post_decision_reviews') return links.checks.get(String(row.decision_check_id));
  if (table === 'pre_trade_decision_checks') return links.checks.get(String(row.id));
  if (table === 'research_materials' && row.candidate_membership_id === null) return links.profiles.get(String(row.research_profile_id));
  if (table === 'research_profiles') return links.profiles.get(String(row.id));
  if (table === 'stocks') return links.stocks.get(String(row.id));
  if (table === 'evidence_items') return links.profiles.get(String(row.research_profile_id));
  return undefined;
}
export function buildLinks(data) {
  const links = { documents: new Map(), captures: new Map(), packs: new Map(), reports: new Map(), checks: new Map(), leads: new Map(), profiles: new Map(), stocks: new Map(), auditTargets: new Map() };
  const members = new Map(data.candidate_memberships.map((r) => [`${r.market}:${r.code}`, String(r.id)]));
  for (const r of data.stocks) { const id = members.get(`${r.market}:${r.code}`); if (id) links.stocks.set(String(r.id), id); }
  for (const r of data.research_profiles) { const id = members.get(`${r.market}:${r.code}`); if (id) links.profiles.set(String(r.id), id); }
  for (const [table, map, key] of [['research_documents',links.documents,'id'],['research_futu_financial_statement_captures',links.captures,'id'],['research_evidence_packs',links.packs,'id'],['research_source_leads',links.leads,'lead_id']]) for (const r of data[table]) map.set(String(r[key]), String(r.candidate_membership_id));
  for (const r of data.deep_research_reports) links.reports.set(String(r.id), links.packs.get(String(r.evidence_pack_id)));
  for (const r of data.pre_trade_decision_checks) links.checks.set(String(r.id), links.stocks.get(String(r.stock_id)));
  const targetTables = [
    'research_profiles', 'evidence_items', 'research_documents', 'research_materials',
    'research_financial_requirements', 'research_futu_valuation_captures', 'research_fundamental_values', 'research_valuation_scenario_sets', 'research_evidence_packs',
    'deep_research_reports', 'deep_research_report_decisions', 'research_events',
    'geely_sales_monitor_runs', 'gcl_pv_price_monitor_runs',
    'pre_trade_decision_checks', 'post_decision_reviews'
  ];
  for (const table of targetTables) for (const row of data[table] ?? []) {
    const membership = membershipForRow(table, row, links);
    if (!membership) throw Error(`formal audit target lacks an Owner company: ${table}`);
    links.auditTargets.set(`${table}:${row.id}`, membership);
  }
  for (const audit of data.research_write_audit_events) {
    const membership = membershipForRow('research_write_audit_events', audit, links);
    if (!membership || audit.candidate_membership_id !== null
      && String(audit.candidate_membership_id) !== membership) throw Error('formal audit company binding disagrees with its retained target');
  }
  return links;
}
export function assertCompanyClosure(data, links) {
  const members = new Set(data.candidate_memberships.map((row) => String(row.id)));
  const memberOf = (table, row) => membershipForRow(table, row, links);
  const assignments = new WeakMap();
  for (const [table] of FORMAL_TABLES) {
    for (const row of data[table]) {
      const home = memberOf(table, row);
      if (!members.has(home)) throw Error(`formal company export would omit a retained ${table} row`);
      assignments.set(row, new Set([home]));
    }
  }
  const materialById = new Map(data.research_materials.map((row) => [String(row.id), row]));
  const evidenceById = new Map(data.evidence_items.map((row) => [String(row.id), row]));
  const documentById = new Map(data.research_documents.map((row) => [String(row.id), row]));
  const snapshotById = new Map(data.research_source_snapshots.map((row) => [String(row.id), row]));
  const add = (member, table, row, label, publiclyShareable) => {
    if (!row) return;
    if (memberOf(table, row) !== member && !publiclyShareable(row))
      throw Error(`formal company export would omit private ${label} dependency`);
    assignments.get(row).add(member);
  };
  const publicMaterial = (row) => row.candidate_membership_id === null && row.rights_status === 'authorized_public';
  const publicEvidence = (row) => ['issuer_public_pdf', 'issuer_public_html'].includes(row.source_type);
  const publicDocument = (row) => row.source_classification === 'authorized_public_issuer_document' && row.rights_status === 'authorized_public';
  const publicSnapshot = (row) => row.source_category === 'issuer_public_html';
  const seen = new Set();
  const includeMaterial = (member, material, label) => {
    if (!material) throw Error(`formal company export missing ${label} dependency`);
    add(member, 'research_materials', material, label, publicMaterial);
    const key = `${member}:${material.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (material.evidence_item_id != null) add(member, 'evidence_items', evidenceById.get(String(material.evidence_item_id)), 'material evidence', publicEvidence);
    if (material.citation_document_id != null) {
      const document = documentById.get(String(material.citation_document_id));
      add(member, 'research_documents', document, 'material PDF original', publicDocument);
      if (!document) throw Error('formal company export missing material PDF original dependency');
      for (const page of data.research_document_pages) if (String(page.document_id) === String(document.id))
        add(member, 'research_document_pages', page, 'material PDF page', () => publicDocument(document));
    }
    if (material.citation_snapshot_id != null) {
      const snapshot = snapshotById.get(String(material.citation_snapshot_id));
      add(member, 'research_source_snapshots', snapshot, 'material HTML original', publicSnapshot);
      if (!snapshot) throw Error('formal company export missing material HTML original dependency');
    }
    if (material.replaces_material_id != null)
      includeMaterial(member, materialById.get(String(material.replaces_material_id)), 'prior material');
  };
  for (const material of data.research_materials)
    includeMaterial(memberOf('research_materials', material), material, 'material');
  for (const requirement of data.research_financial_requirements) {
    const member = memberOf('research_financial_requirements', requirement);
    for (const source of requirement.sources ?? []) includeMaterial(member, materialById.get(String(source.materialId)), 'financial requirement source');
  }
  for (const pack of data.research_evidence_packs) {
    const member = memberOf('research_evidence_packs', pack);
    for (const item of pack.items ?? []) includeMaterial(member, materialById.get(String(item.id)), 'frozen material');
  }
  for (const event of data.research_events)
    includeMaterial(memberOf('research_events', event), materialById.get(String(event.material_id)), 'research event material');
  return assignments;
}
function orderBy(table) {
  return table === 'research_source_leads' ? 'lead_id'
    : table === 'research_source_lead_events' ? 'event_sequence'
    : table === 'research_document_review_events' ? 'event_id'
    : table === 'research_document_pages' ? 'document_id, page_number'
    : table === 'research_source_refresh_state' ? 'candidate_membership_id, captured_membership_version'
    : 'id';
}
function localDatabase(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash
    || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw Error('formal backup requires a loopback PostgreSQL URL without query or fragment');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw Error('database name is unsafe');
  return { url, name, host: url.hostname, port: url.port || '5432', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}
async function postgresCommand(command, args, databaseUrl, environment) {
  const db = localDatabase(databaseUrl);
  const inherited = Object.fromEntries(Object.entries(environment).filter(([name]) =>
    name !== 'DATABASE_URL' && name !== 'LOCAL_ALPHA_DATABASE_URL' && !name.startsWith('PG')));
  return execFileAsync(command, [
    '--host', db.host, '--port', db.port,
    ...(db.user ? ['--username', db.user] : []), ...args
  ], {
    cwd: process.cwd(),
    env: { ...inherited, ...(db.password ? { PGPASSWORD: db.password } : {}) },
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
  });
}
async function assertSchemaArchive(path) {
  const { stdout } = await execFileAsync('pg_restore', ['--list', path], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (!/\bTABLE\s+public\s+candidate_memberships\b/i.test(stdout)
    || /\b(?:TABLE DATA|BLOB|USER MAPPING|FOREIGN SERVER|SUBSCRIPTION)\b/i.test(stdout)) {
    throw Error('schema archive is invalid, contains data, or contains unsupported external credentials');
  }
}
export async function assertNoControlledFixtureLineage(client, owner) {
  // A later Owner update preserves the seeded arrays when omitted and writes the
  // previous profile into before_payload. Keeping that audit history rules out a
  // safe row-only projection, so publication must stop for this exact profile.
  const seeded = await client.query(`SELECT 1 FROM research_fixture_seed_events seed
    JOIN research_profiles profile ON profile.id=seed.research_profile_id
    JOIN candidate_memberships member ON member.market=profile.market AND member.code=profile.code
    WHERE member.actor_type='user' AND member.actor_id=$1
      AND seed.provenance='controlled_test_fixture' AND seed.completed_at IS NOT NULL
    LIMIT 1`, [owner]);
  if (seeded.rowCount) throw Error('formal backup blocked: an Owner research profile has controlled fixture seed history and may retain test content in fields or audit payloads');
  const marked = await client.query(`SELECT 1 FROM evidence_items evidence
    JOIN research_profiles profile ON profile.id=evidence.research_profile_id
    JOIN candidate_memberships member ON member.market=profile.market AND member.code=profile.code
    WHERE member.actor_type='user' AND member.actor_id=$1
      AND (evidence.raw_payload->>'classification'='controlled_test_fixture'
        OR evidence.raw_payload->>'fixture'='true')
    LIMIT 1`, [owner]);
  if (marked.rowCount) throw Error('formal backup blocked: an Owner research profile has structured controlled fixture evidence provenance');
}
const profileBusinessFields = [
  'market', 'code', 'symbol', 'currentView', 'currentThesis', 'marketDisagreement',
  'invalidationCondition', 'nextReviewOn', 'keyVariables', 'catalysts',
  'evidenceGaps', 'monitorRules'
];
function profileBusinessFromAudit(payload) {
  if (payload === null) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || profileBusinessFields.some((field) => !Object.hasOwn(payload, field))
    || ['keyVariables', 'catalysts', 'evidenceGaps', 'monitorRules'].some((field) => !Array.isArray(payload[field]))) {
    throw Error('formal backup blocked: profile audit lacks a complete business-field snapshot');
  }
  return Object.fromEntries(profileBusinessFields.map((field) => [field, payload[field]]));
}
function profileBusinessFromRow(row) {
  return {
    market: row.market, code: row.code, symbol: row.symbol,
    currentView: row.current_view, currentThesis: row.current_thesis,
    marketDisagreement: row.market_disagreement, invalidationCondition: row.invalidation_condition,
    nextReviewOn: row.next_review_on, keyVariables: row.key_variables,
    catalysts: row.catalysts, evidenceGaps: row.evidence_gaps, monitorRules: row.monitor_rules
  };
}
function stableBusiness(value) {
  if (Array.isArray(value)) return value.map(stableBusiness);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableBusiness(value[key])]));
  return value;
}
const sameBusiness = (left, right) => JSON.stringify(stableBusiness(left)) === JSON.stringify(stableBusiness(right));
function blankSystemProfile(value) {
  return value.currentView === '待补充当前观点。' && value.currentThesis === '待补充投资假设。'
    && value.marketDisagreement === null && value.invalidationCondition === null && value.nextReviewOn === null
    && ['keyVariables', 'catalysts', 'evidenceGaps', 'monitorRules'].every((field) => Array.isArray(value[field]) && value[field].length === 0);
}
export function assertOwnerProfileProvenance(profiles, auditRows, owner) {
  const history = new Map(profiles.map((profile) => [String(profile.id), []]));
  for (const audit of auditRows) {
    const chain = history.get(String(audit.target_id));
    if (!chain || audit.target_table !== 'research_profiles' || audit.event_type !== 'profile_updated') throw Error('formal backup blocked: profile audit target is outside the selected Owner profiles');
    chain.push(audit);
  }
  for (const profile of profiles) {
    const current = profileBusinessFromRow(profile), chain = history.get(String(profile.id));
    if (!chain.length) {
      if (!blankSystemProfile(current)) throw Error('formal backup blocked: non-default research profile lacks Owner audit provenance');
      continue;
    }
    let previous = null;
    for (let index = 0; index < chain.length; index++) {
      const audit = chain[index];
      const before = profileBusinessFromAudit(audit.before_payload);
      const after = profileBusinessFromAudit(audit.after_payload);
      if (!after) throw Error('formal backup blocked: profile audit has no after snapshot');
      if (index === 0 && before !== null && !blankSystemProfile(before)) throw Error('formal backup blocked: first profile audit began with unattributed non-default content');
      if (index > 0 && !sameBusiness(previous, before)) throw Error('formal backup blocked: profile before/after audit chain is incomplete');
      if (audit.actor_type !== 'user' || audit.actor_id !== owner) {
        if ((before !== null && !blankSystemProfile(before)) || !blankSystemProfile(after)) throw Error('formal backup blocked: research profile history contains another actor\'s business content');
      }
      previous = after;
    }
    if (!sameBusiness(previous, current)) throw Error('formal backup blocked: current research profile differs from the last audited business snapshot');
  }
}
async function readRows(client, owner, schemaPath, databaseUrl, environment) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const cutoff = (await client.query('SELECT transaction_timestamp() AS cutoff')).rows[0].cutoff.toISOString();
    await assertNoControlledFixtureLineage(client, owner);
    const selectedProfiles = (await client.query(`SELECT to_jsonb(profile)::text AS raw FROM research_profiles profile
      JOIN candidate_memberships member ON member.market=profile.market AND member.code=profile.code
      WHERE member.actor_type='user' AND member.actor_id=$1 ORDER BY profile.id`, [owner])).rows.map((row) => parseLossless(row.raw));
    const profileIds = selectedProfiles.map((profile) => String(profile.id));
    const profileAudits = profileIds.length ? (await client.query(`SELECT target_id,target_table,event_type,actor_type,actor_id,
      before_payload::text AS before_raw,after_payload::text AS after_raw
      FROM research_write_audit_events WHERE target_table='research_profiles' AND event_type='profile_updated'
        AND target_id=ANY($1::text[]) ORDER BY id`, [profileIds])).rows.map((row) => ({ ...row,
      before_payload: row.before_raw === null ? null : parseLossless(row.before_raw),
      after_payload: parseLossless(row.after_raw)
    })) : [];
    assertOwnerProfileProvenance(selectedProfiles, profileAudits, owner);

    const exportedSnapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const postgresServerVersion = (await client.query('SHOW server_version_num')).rows[0].server_version_num;
    const migrations = (await client.query('SELECT to_jsonb(m)::text AS raw FROM schema_migrations m ORDER BY filename')).rows.map((row) => row.raw);
    await postgresCommand('pg_dump', [
      '--format=custom', '--schema-only', '--no-owner', '--no-privileges',
      '--snapshot', exportedSnapshot, '--file', schemaPath, localDatabase(databaseUrl).name
    ], databaseUrl, environment);
    await chmod(schemaPath, 0o600);
    await assertSchemaArchive(schemaPath);
    const data = {}, exact = {}, columns = {};
    for (const [table, where] of FORMAL_TABLES) {
      assert(/^[a-z_]+$/.test(table));
      const alias = table === 'research_write_audit_events' ? 'a' : 't';
      const query = `SELECT to_jsonb(${alias})::text AS raw FROM ${table} ${alias} WHERE ${where} ORDER BY ${orderBy(table)}`;
      columns[table] = (await client.query(`SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`, [table])).rows.map((r) => r.attname);
      if (!columns[table].length) throw Error(`formal table schema unavailable: ${table}`);
      exact[table] = (await client.query(query, [owner])).rows.map((r) => r.raw);
      data[table] = exact[table].map(parseLossless);
    }
    const sequences = await captureOwnedSequences(client);
    await client.query('COMMIT');
    return { cutoff, data, exact, columns, migrations, sequences, postgresServerVersion };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
function validateClosure(data, owner) {
  const set = (table, key = 'id') => new Set(data[table].map((row) => String(row[key])));
  const membershipById = new Map(data.candidate_memberships.map((row) => [String(row.id), row]));
  const documentById = new Map(data.research_documents.map((row) => [String(row.id), row]));
  const leadById = new Map(data.research_source_leads.map((row) => [String(row.lead_id), row]));
  const materialById = new Map(data.research_materials.map((row) => [String(row.id), row]));
  const evidenceById = new Map(data.evidence_items.map((row) => [String(row.id), row]));
  const packById = new Map(data.research_evidence_packs.map((row) => [String(row.id), row]));
  const captureById = new Map(data.research_futu_financial_statement_captures.map((row) => [String(row.id), row]));
  const financialPageById = new Map(data.research_futu_financial_statement_pages.map((row) => [String(row.id), row]));
  const valuationCaptureById = new Map((data.research_futu_valuation_captures ?? []).map((row) => [String(row.id), row]));
  const memberships = set('candidate_memberships'), profiles = set('research_profiles'), stocks = set('stocks');
  const documents = set('research_documents'), snapshots = set('research_source_snapshots');
  const captures = set('research_futu_financial_statement_captures');
  const valuationCaptures = new Set((data.research_futu_valuation_captures ?? []).map((row) => String(row.id)));
  const materials = set('research_materials'), evidence = set('evidence_items');
  const leads = set('research_source_leads', 'lead_id'), packs = set('research_evidence_packs');
  const reports = set('deep_research_reports'), checks = set('pre_trade_decision_checks');
  const fundamentals = set('research_fundamental_values'), scenarios = set('research_valuation_scenario_sets');
  const contexts = set('research_context_snapshots'), underwriting = set('research_underwriting_scenario_versions');
  const baselines = set('research_baseline_snapshots'), milestones = set('research_validation_milestones');
  const need = (setValue, value, label) => { if (value !== null && value !== undefined && !setValue.has(String(value))) throw Error(`formal closure missing ${label}: ${value}`); };
  for (const row of data.candidate_memberships) if (row.actor_type !== 'user' || row.actor_id !== owner) throw Error('membership identity mismatch');
  for (const row of data.research_profiles) need(stocks, row.stock_id, 'stock');
  for (const row of data.research_write_audit_events) need(stocks, row.stock_id, 'audit stock');
  for (const row of data.research_documents) { need(memberships, row.candidate_membership_id, 'document membership'); need(leads, row.source_lead_id, 'source lead'); if (Number(row.captured_membership_version) > Number(membershipById.get(String(row.candidate_membership_id)).version)) throw Error('document membership version mismatch'); if (row.source_lead_id !== null && String(leadById.get(String(row.source_lead_id)).candidate_membership_id) !== String(row.candidate_membership_id)) throw Error('document source lead membership mismatch'); }
  for (const row of data.research_document_pages) need(documents, row.document_id, 'document page');
  for (const row of data.research_source_snapshots) { need(memberships, row.candidate_membership_id, 'HTML membership'); const member = membershipById.get(String(row.candidate_membership_id)); if (row.actor_type !== 'user' || row.actor_id !== owner || row.symbol !== member.symbol || Number(row.captured_membership_version) > Number(member.version)) throw Error('HTML identity mismatch'); }
  for (const row of data.research_futu_financial_statement_captures) { need(memberships, row.candidate_membership_id, 'Futu membership'); const member = membershipById.get(String(row.candidate_membership_id)); if (row.actor_type !== 'user' || row.actor_id !== owner || row.symbol !== member.symbol || Number(row.captured_membership_version) > Number(member.version)) throw Error('Futu identity mismatch'); }
  for (const row of data.research_futu_financial_statement_pages) { need(captures, row.capture_id, 'Futu page'); const capture = captureById.get(String(row.capture_id)); if (String(row.candidate_membership_id) !== String(capture.candidate_membership_id) || row.actor_type !== capture.actor_type || row.actor_id !== capture.actor_id || String(row.captured_membership_version) !== String(capture.captured_membership_version)) throw Error('Futu page identity mismatch'); }
  for (const row of data.research_futu_valuation_captures ?? []) { need(memberships,row.candidate_membership_id,'valuation capture membership'); const member=membershipById.get(String(row.candidate_membership_id)); if(row.actor_type!=='user'||row.actor_id!==owner||row.symbol!==member.symbol||Number(row.captured_membership_version)>Number(member.version))throw Error('valuation capture identity mismatch'); }
  for (const row of data.research_source_leads) { need(memberships, row.candidate_membership_id, 'lead membership'); need(documents, row.document_id, 'lead document'); if (row.document_id !== null && String(documentById.get(String(row.document_id)).candidate_membership_id) !== String(row.candidate_membership_id)) throw Error('source lead document membership mismatch'); }
  for (const row of data.research_source_lead_events) { need(leads, row.lead_id, 'lead event'); need(documents, row.document_id, 'lead event document'); need(documents, row.previous_document_id, 'prior lead document'); }
  for (const row of data.research_document_review_events) { need(documents, row.document_id, 'document review'); need(leads, row.source_lead_id, 'document review lead'); }
  for (const row of data.research_materials) { need(profiles, row.research_profile_id, 'material profile'); need(evidence, row.evidence_item_id, 'material evidence'); need(materials, row.replaces_material_id, 'prior material'); need(documents, row.citation_document_id, 'material PDF citation'); need(snapshots, row.citation_snapshot_id, 'material HTML citation'); if (row.evidence_item_id !== null && String(evidenceById.get(String(row.evidence_item_id)).research_profile_id) !== String(row.research_profile_id)) throw Error('material evidence profile mismatch'); }
  for (const row of data.evidence_items) need(profiles, row.research_profile_id, 'evidence profile');
  for (const row of data.research_financial_requirements) {
    need(memberships,row.candidate_membership_id,'financial requirement membership');
    const member=membershipById.get(String(row.candidate_membership_id));
    if(row.actor_type!=='user'||row.actor_id!==owner||row.symbol!==member.symbol) throw Error('financial requirement identity mismatch');
    need(set('research_financial_requirements'),row.base_requirement_id,'prior financial requirement');
    if(!Array.isArray(row.sources)||row.sources.length<1||row.sources.length>4) throw Error('financial requirement source list invalid');
    for(const source of row.sources){
      need(materials,source.materialId,'financial requirement material');
      const material=materialById.get(String(source.materialId));
      if(String(material.candidate_membership_id)!==String(row.candidate_membership_id)||Number(material.revision)!==Number(source.materialRevision)
        ||material.content_fingerprint!==source.contentFingerprint)throw Error('financial requirement source identity mismatch');
      if(source.citation?.kind==='source_snapshot'){need(snapshots,source.citation.snapshotId,'financial requirement HTML original');
        const original=data.research_source_snapshots.find(item=>String(item.id)===String(source.citation.snapshotId));
        if(original.raw_sha256!==source.originalSha256||Number(original.byte_length)!==Number(source.originalByteLength))throw Error('financial requirement HTML original mismatch');
      }else{need(documents,source.citation?.documentId,'financial requirement PDF original');
        const original=documentById.get(String(source.citation.documentId));
        if(original.pdf_sha256!==source.originalSha256||Number(original.byte_length)!==Number(source.originalByteLength))throw Error('financial requirement PDF original mismatch');
      }
    }
  }
  for (const row of data.research_fundamental_values) { need(materials, row.source_material_id, 'fundamental material'); need(fundamentals, row.replaces_value_id, 'prior fundamental'); }
  for (const row of data.research_fundamental_assertion_lifecycle) { need(fundamentals, row.fundamental_value_id, 'fact lifecycle'); need(materials, row.source_material_id, 'fact lifecycle material'); }
  for (const row of data.research_valuation_scenario_sets) {
    need(scenarios,row.replaces_scenario_set_id,'prior valuation');
    if(row.basis_kind==='provider'){
      need(captures,row.provider_financial_capture_id,'provider EPS capture');
      need(valuationCaptures,row.provider_valuation_capture_id,'provider valuation capture');
      need(materials,row.provider_source_material_id,'provider source material');
      const financial=captureById.get(String(row.provider_financial_capture_id));
      const page=financialPageById.get(String(row.provider_basis?.eps?.pageId));
      const valuation=valuationCaptureById.get(String(row.provider_valuation_capture_id));
      const material=materialById.get(String(row.provider_source_material_id));
      if(row.anchor_value_id!==null||!financial||!page||!valuation||!material
        ||[financial,valuation,material].some(source=>String(source.candidate_membership_id)!==String(row.candidate_membership_id))
        ||String(page.capture_id)!==String(financial.id)
        ||page.raw_sha256!==row.provider_basis?.eps?.rawSha256
        ||!page.report_summaries?.some(report=>report.periodEnd===row.provider_basis?.eps?.periodEnd
          &&report.reportSha256===row.provider_basis?.eps?.reportSha256)
        ||valuation.raw_sha256!==row.provider_basis?.valuation?.rawSha256
        ||material.content_fingerprint!==row.provider_basis?.sourceMaterialFingerprint
        ||Number(material.revision)!==Number(row.provider_basis?.sourceMaterialRevision)
        ||row.provider_basis?.eps?.financialCaptureId!==String(row.provider_financial_capture_id)
        ||row.provider_basis?.valuation?.captureId!==String(row.provider_valuation_capture_id))throw Error('provider scenario source identity mismatch');
    }else need(fundamentals,row.anchor_value_id,'valuation anchor');
  }
  for (const row of data.research_underwriting_scenario_versions) { need(contexts, row.context_id, 'underwriting context'); need(underwriting, row.parent_version_id, 'prior underwriting'); }
  for (const row of data.research_baseline_snapshots) need(underwriting, row.scenario_version_id, 'baseline scenario');
  for (const row of data.research_validation_milestones) { need(baselines, row.baseline_id, 'milestone baseline'); need(contexts, row.context_id, 'milestone context'); need(milestones, row.supersedes_milestone_id, 'prior milestone'); }
  for (const row of data.research_review_snapshots) { need(baselines, row.baseline_id, 'review baseline'); need(milestones, row.milestone_id, 'review milestone'); }
  for (const row of data.research_evidence_packs) { need(memberships, row.candidate_membership_id, 'pack membership'); need(profiles, row.research_profile_id, 'pack profile'); for (const item of row.items ?? []) need(materials, item.id, 'frozen material'); }
  for (const row of data.deep_research_reports) { need(packs, row.evidence_pack_id, 'report pack'); need(profiles, row.research_profile_id, 'report profile'); if (String(packById.get(String(row.evidence_pack_id)).research_profile_id) !== String(row.research_profile_id)) throw Error('report evidence pack profile mismatch'); }
  for (const row of data.deep_research_report_decisions) need(reports, row.report_id, 'report decision');
  for (const row of data.research_events) { need(materials, row.material_id, 'research event material'); const material = materialById.get(String(row.material_id)); if (material.candidate_membership_id !== null && String(material.candidate_membership_id) !== String(row.candidate_membership_id)) throw Error('research event material membership mismatch'); }
  for (const row of data.post_decision_reviews) need(checks, row.decision_check_id, 'review decision check');
  const evidenceMaterials = new Map(data.research_materials.map((row) => [String(row.evidence_item_id), row]));
  for (const row of data.evidence_items) {
    const payload = row.raw_payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || payload.fixture === true || payload.classification === 'controlled_test_fixture') throw Error('evidence provenance is unsafe');
    if (payload.state === 'deleted') {
      const material = evidenceMaterials.get(String(row.id));
      if (!material || String(payload.materialId) !== String(material.id) || material.deleted_at === null) throw Error('evidence tombstone binding mismatch');
    } else if (!['production-write-api', 'research-material-api'].includes(payload.source)) {
      throw Error('evidence source is not a persisted Owner write');
    }
  }
  const targetTableByEvent = {
    profile_updated: 'research_profiles', evidence_created: 'evidence_items',
    research_document_imported: 'research_documents',
    research_material_created: 'research_materials', research_material_deleted: 'research_materials',
    research_fundamental_value_created: 'research_fundamental_values',
    research_valuation_scenario_created: 'research_valuation_scenario_sets',
    evidence_pack_frozen: 'research_evidence_packs',
    deep_research_report_created: 'deep_research_reports', deep_research_report_deleted: 'deep_research_reports',
    deep_research_report_decided: 'deep_research_report_decisions',
    research_event_created: 'research_events',
    geely_sales_monitor_created: 'geely_sales_monitor_runs',
    gcl_pv_price_monitor_created: 'gcl_pv_price_monitor_runs',
    decision_check_created: 'pre_trade_decision_checks', decision_check_deleted: 'pre_trade_decision_checks',
    post_decision_review_created: 'post_decision_reviews', post_decision_review_deleted: 'post_decision_reviews'
  };
  const targetIds = new Map(Object.keys(targetTableByEvent).map((event) => [event, set(targetTableByEvent[event])]));
  for (const row of data.research_write_audit_events) {
    if (row.actor_type !== 'user' || row.actor_id !== owner || row.target_table !== targetTableByEvent[row.event_type]) throw Error('audit event identity mismatch');
    need(targetIds.get(row.event_type), row.target_id, 'audit target');
    if (row.candidate_membership_id !== null) need(memberships, row.candidate_membership_id, 'audit membership');
    if (row.before_payload !== null && (typeof row.before_payload !== 'object' || Array.isArray(row.before_payload))) throw Error('audit before payload shape mismatch');
    const before = row.before_payload;
    const beforeIdentity = row.event_type === 'profile_updated' ? before?.id
      : row.event_type === 'research_material_deleted' ? before?.materialId
      : row.event_type === 'deep_research_report_deleted' ? before?.reportId
      : row.event_type === 'decision_check_deleted' ? before?.decisionCheckId
      : row.event_type === 'post_decision_review_deleted' ? before?.reviewId : undefined;
    if (beforeIdentity !== null && beforeIdentity !== undefined && String(beforeIdentity) !== String(row.target_id)) throw Error('audit request target mismatch');
    const after = row.after_payload;
    if (!after || typeof after !== 'object' || Array.isArray(after)) throw Error('audit after payload shape mismatch');
    const identity = after.id ?? after.document?.id ?? after.reportId ?? after.materialId
      ?? (row.target_table === 'post_decision_reviews' ? after.reviewId : after.decisionCheckId);
    if (row.event_type !== 'profile_updated' && String(identity) !== String(row.target_id)) throw Error('audit replay target mismatch');
    if (row.event_type === 'research_document_imported') {
      const document = documentById.get(String(row.target_id));
      if (after.document?.pdfSha256 !== document.pdf_sha256
        || String(after.document?.membershipId) !== String(document.candidate_membership_id)) throw Error('document audit payload mismatch');
    }
    if (row.event_type === 'deep_research_report_decided') {
      const decision = data.deep_research_report_decisions.find((item) => String(item.id) === String(row.target_id));
      if (after.decision !== decision.decision || String(after.reportId) !== String(decision.report_id)) throw Error('report decision audit payload mismatch');
    }
  }
}
function validateCapturedSequences(data, sequences) {
  for (const sequence of sequences) {
    const values = (data[sequence.table] ?? []).map((row) => row[sequence.column]).filter((value) => value !== null && value !== undefined);
    if (!values.length) continue;
    const maximum = values.reduce((left, right) => BigInt(right) > left ? BigInt(right) : left, BigInt(values[0]));
    if (sequence.isCalled ? BigInt(sequence.lastValue) < maximum : BigInt(sequence.lastValue) <= maximum) {
      throw Error(`captured sequence would collide with retained ${sequence.table} rows`);
    }
  }
}
function rawByteLengths(data) {
  const lengths = new Map();
  for (const [table, key] of [['research_documents','pdf_sha256'],['research_source_snapshots','raw_sha256'],['research_futu_financial_statement_pages','raw_sha256'],['research_futu_valuation_captures','raw_sha256']]) for (const row of data[table] ?? []) {
    const hash = row[key], size = Number(row.byte_length);
    if (!Number.isSafeInteger(size) || size < 1) throw Error(`invalid original length in ${table}`);
    if (lengths.has(hash) && lengths.get(hash) !== size) throw Error(`original length disagreement: ${hash}`);
    lengths.set(hash, size);
  }
  return lengths;
}
function rawHashes(data) {
  const hashes = new Set();
  for (const [table, key] of [['research_documents','pdf_sha256'],['research_source_snapshots','raw_sha256'],['research_futu_financial_statement_pages','raw_sha256'],['research_futu_valuation_captures','raw_sha256']]) for (const r of data[table] ?? []) {
    const hash = r[key]; if (!/^[a-f0-9]{64}$/.test(hash)) throw Error(`invalid original hash in ${table}`); hashes.add(hash);
  }
  return [...hashes].sort();
}
function containsPath(parent, candidate) {
  const difference = relative(parent, candidate);
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(difference));
}
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
async function validateForeignKeys(client) {
  const constraints = (await client.query(`SELECT con.conname, child_ns.nspname AS child_schema, child.relname AS child_table,
      parent_ns.nspname AS parent_schema, parent.relname AS parent_table,
      con.confmatchtype,
      array_agg(child_col.attname::text ORDER BY keys.ordinal) AS child_columns,
      array_agg(parent_col.attname::text ORDER BY keys.ordinal) AS parent_columns
    FROM pg_constraint con
    JOIN pg_class child ON child.oid=con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
    JOIN LATERAL unnest(con.conkey,con.confkey) WITH ORDINALITY AS keys(child_attnum,parent_attnum,ordinal) ON true
    JOIN pg_attribute child_col ON child_col.attrelid=child.oid AND child_col.attnum=keys.child_attnum
    JOIN pg_attribute parent_col ON parent_col.attrelid=parent.oid AND parent_col.attnum=keys.parent_attnum
    WHERE con.contype='f' AND child_ns.nspname NOT IN ('pg_catalog','information_schema')
      AND parent_ns.nspname NOT IN ('pg_catalog','information_schema')
    GROUP BY con.oid,con.conname,child_ns.nspname,child.relname,parent_ns.nspname,parent.relname,con.confmatchtype`)).rows;
  for (const constraint of constraints) {
    const child = `${quoteIdentifier(constraint.child_schema)}.${quoteIdentifier(constraint.child_table)}`;
    const parent = `${quoteIdentifier(constraint.parent_schema)}.${quoteIdentifier(constraint.parent_table)}`;
    const cols = constraint.child_columns.map(quoteIdentifier), refs = constraint.parent_columns.map(quoteIdentifier);
    if (constraint.confmatchtype === 'f') {
      const partialNull = await client.query(`SELECT 1 FROM ${child} c WHERE (${cols.map((col) => `c.${col} IS NULL`).join(' OR ')})
        AND (${cols.map((col) => `c.${col} IS NOT NULL`).join(' OR ')}) LIMIT 1`);
      if (partialNull.rowCount) throw Error(`restored MATCH FULL foreign key has partial nulls: ${constraint.conname}`);
    }
    const missing = await client.query(`SELECT 1 FROM ${child} c WHERE ${cols.map((col) => `c.${col} IS NOT NULL`).join(' AND ')}
      AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE ${cols.map((col, index) => `p.${refs[index]}=c.${col}`).join(' AND ')}) LIMIT 1`);
    if (missing.rowCount) throw Error(`restored foreign key is broken: ${constraint.conname}`);
  }
  return constraints.length;
}
async function ownedSequenceDescriptors(client) {
  return (await client.query(`SELECT table_name.relname AS table_name, column_name.attname AS column_name,
      pg_get_serial_sequence(format('%I.%I', table_ns.nspname, table_name.relname), column_name.attname) AS sequence_name
    FROM pg_class table_name JOIN pg_namespace table_ns ON table_ns.oid=table_name.relnamespace
    JOIN pg_attribute column_name ON column_name.attrelid=table_name.oid AND column_name.attnum>0 AND NOT column_name.attisdropped
    WHERE table_ns.nspname='public' AND table_name.relkind IN ('r','p')
      AND pg_get_serial_sequence(format('%I.%I', table_ns.nspname, table_name.relname), column_name.attname) IS NOT NULL
    ORDER BY table_name.relname,column_name.attname`)).rows;
}
async function captureOwnedSequences(client) {
  const captured = [];
  for (const row of await ownedSequenceDescriptors(client)) {
    if (!FORMAL_TABLES.some(([table]) => table === row.table_name) && row.table_name !== 'schema_migrations') continue;
    const state = (await client.query(`SELECT last_value::text AS last_value,is_called FROM ${row.sequence_name}`)).rows[0];
    captured.push({ table: row.table_name, column: row.column_name, sequence: row.sequence_name,
      lastValue: state.last_value, isCalled: state.is_called });
  }
  return captured;
}
async function restoreOwnedSequences(client, captured, tables) {
  const descriptors = await ownedSequenceDescriptors(client);
  const allowed = new Set(tables.map(([table]) => table));
  const actual = descriptors.filter((row) => allowed.has(row.table_name) || row.table_name === 'schema_migrations');
  if (actual.length !== captured.length) throw Error('restored sequence schema count mismatch');
  for (let index = 0; index < actual.length; index++) {
    const row = actual[index], saved = captured[index];
    if (row.table_name !== saved.table || row.column_name !== saved.column || row.sequence_name !== saved.sequence
      || !/^-?\d+$/.test(saved.lastValue) || typeof saved.isCalled !== 'boolean') throw Error('restored sequence identity mismatch');
    const maximum = (await client.query(`SELECT max(${quoteIdentifier(row.column_name)})::text AS value FROM ${quoteIdentifier(row.table_name)}`)).rows[0].value;
    if (maximum !== null && (saved.isCalled ? BigInt(saved.lastValue) < BigInt(maximum) : BigInt(saved.lastValue) <= BigInt(maximum))) throw Error('saved sequence would collide with restored rows');
    await client.query('SELECT setval($1::regclass,$2::bigint,$3::boolean)', [saved.sequence, saved.lastValue, saved.isCalled]);
  }
  return captured.length;
}
async function walkRegularFiles(root, directory = root) {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw Error('snapshot contains a symlink');
    if (metadata.isDirectory()) names.push(...await walkRegularFiles(root, path));
    else if (metadata.isFile()) names.push(relative(root, path).split('\\').join('/'));
    else throw Error('snapshot contains a non-file entry');
  }
  return names;
}
async function verifySnapshot(root) {
  const manifest = JSON.parse(await safeFile(root, join(root, 'manifest.json')));
  if (manifest.schemaVersion !== VERSION || !Array.isArray(manifest.files)
    || manifest.databaseSchema?.path !== 'database-schema.pgcustom'
    || manifest.databaseSchema?.migrationRowsFile !== 'schema-migrations.json'
    || manifest.databaseSchema?.sequenceRowsFile !== 'owned-sequences.json'
    || !/^\d+$/.test(String(manifest.databaseSchema?.postgresServerVersion ?? ''))
    || !/^[a-f0-9]{40}$/.test(manifest.source?.commitSha ?? '')
    || !Array.isArray(manifest.source?.files) || manifest.source.files.length !== 2) throw Error('unsupported formal manifest');
  const tables = formalTablesForManifest(manifest);
  const expected = (await safeFile(root, join(root, 'manifest.sha256'))).toString().trim();
  if (expected !== `${sha(await safeFile(root, join(root, 'manifest.json')))}  manifest.json`) throw Error('manifest hash mismatch');
  const expectedFiles = new Set(['manifest.json', 'manifest.sha256']);
  for (const file of manifest.files) {
    if (expectedFiles.has(file.path)) throw Error('duplicate manifest path');
    expectedFiles.add(file.path);
    if (!file.path.split('/').every(safeSegment)) throw Error('unsafe manifest path');
    const bytes = await safeFile(root, join(root, file.path));
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw Error(`file hash mismatch: ${file.path}`);
  }
  const actualFiles = await walkRegularFiles(root);
  if (actualFiles.length !== expectedFiles.size || actualFiles.some((name) => !expectedFiles.has(name))) throw Error('snapshot file set does not match manifest');
  if (manifest.counts?.originals !== manifest.files.filter((file) => file.path.startsWith('originals/')).length) throw Error('original count mismatch');
  const listed = new Set(manifest.files.map((file) => file.path));
  for (const [table] of tables) for (const extension of ['json', 'csv'])
    if (!listed.has(`all/${table}.${extension}`)) throw Error(`formal table file missing: ${table}`);
  const memberships = parseLossless((await safeFile(root, join(root, 'all/candidate_memberships.json'))).toString('utf8'));
  if (!Array.isArray(memberships) || memberships.length !== manifest.counts.memberships)
    throw Error('formal membership count mismatch');
  for (const member of memberships) {
    const id = String(member.id);
    if (!/^[1-9]\d*$/.test(id)) throw Error('formal membership id is invalid');
    const company = JSON.parse(await safeFile(root, join(root, `companies/${id}/research.json`)));
    if (company.membershipId !== id || !Array.isArray(company.tableFiles)
      || company.tableFiles.length !== tables.length
      || tables.some(([table], index) => company.tableFiles[index] !== `${table}.json`))
      throw Error('formal company table list mismatch');
  }
  const schema = manifest.files.find((file) => file.path === manifest.databaseSchema.path);
  const migrations = manifest.files.find((file) => file.path === manifest.databaseSchema.migrationRowsFile);
  const sequences = manifest.files.find((file) => file.path === manifest.databaseSchema.sequenceRowsFile);
  const migrationRows = migrations ? rawArrayElements((await safeFile(root, join(root, migrations.path))).toString('utf8')) : [];
  if (!schema || schema.sha256 !== manifest.databaseSchema.sha256 || schema.bytes !== manifest.databaseSchema.bytes
    || !migrations || migrations.sha256 !== manifest.databaseSchema.migrationRowsSha256
    || migrationRows.length !== manifest.databaseSchema.migrationCount
    || !sequences || sequences.sha256 !== manifest.databaseSchema.sequenceRowsSha256
    || JSON.parse((await safeFile(root, join(root, sequences.path))).toString('utf8')).length !== manifest.databaseSchema.sequenceCount) {
    throw Error('database schema or migration identity mismatch');
  }
  const hasFinancialRequirementMigration = migrationRows.some((row) =>
    JSON.parse(row).filename === '072_research_financial_requirements.sql');
  if ((tables !== LEGACY_FORMAL_TABLES) !== hasFinancialRequirementMigration)
    throw Error('formal table set disagrees with saved migrations');
  const hasProviderValuationMigration=migrationRows.some((row)=>JSON.parse(row).filename==='074_research_valuation_provider_basis.sql');
  if ((tables===FORMAL_TABLES)!==hasProviderValuationMigration)throw Error('provider valuation table set disagrees with saved migrations');
  const expectedSourcePaths = new Set(['source/formal-research-backup.mjs', 'source/formal-research-backup-selection.mjs']);
  for (const source of manifest.source.files) {
    const listed = manifest.files.find((file) => file.path === source.path);
    if (!listed || listed.sha256 !== source.sha256 || !expectedSourcePaths.delete(source.path)) throw Error('backup source identity mismatch');
  }
  if (expectedSourcePaths.size) throw Error('backup source files are incomplete');
  return manifest;
}
export async function createFormalResearchBackup(env = process.env, trigger = 'manual', eventId = null) {
  const owner = required(env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID, 'FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID');
  const databaseUrl = required(env.LOCAL_ALPHA_DATABASE_URL ?? env.DATABASE_URL, 'local database URL');
  localDatabase(databaseUrl);
  const sync = await safeDirectory(required(env.FORMAL_RESEARCH_BACKUP_SYNC_DIR, 'FORMAL_RESEARCH_BACKUP_SYNC_DIR'), 'sync');
  const stageParent = await safeDirectory(required(env.FORMAL_RESEARCH_BACKUP_STAGING_DIR, 'FORMAL_RESEARCH_BACKUP_STAGING_DIR'), 'staging');
  const raw = await safeDirectory(required(env.LOCAL_ALPHA_RAW_STORE_ROOT ?? env.RESEARCH_DOCUMENT_RAW_STORE_ROOT, 'raw store'), 'raw store');
  if (sync === stageParent || sync.startsWith(`${stageParent}/`) || stageParent.startsWith(`${sync}/`) || raw.startsWith(`${sync}/`) || sync.startsWith(`${raw}/`)) throw Error('backup directories must be separate');
  if ((await stat(sync)).dev !== (await stat(stageParent)).dev) throw Error('staging and sync must share a filesystem for atomic publish');
  let stage, lockIdentity, publishedSnapshotId = null;
  await writeReceipt(stageParent, owner, trigger, eventId, 'PENDING', { pid: process.pid, host: backupHost });
  try {
    lockIdentity = await acquireBackupLock(stageParent, owner, env);
    await writeReceipt(stageParent, owner, trigger, eventId, 'RUNNING', { pid: process.pid, host: backupHost });
    const snapshots = (await readdir(sync)).filter((name) => /^formal-\d{14}-[a-f0-9]{8}$/.test(name));
    if (eventId) for (const name of snapshots) {
      const existing = await verifySnapshot(join(sync, name));
      if (existing.owner.actorId === owner && existing.trigger.eventId === eventId && existing.trigger.kind === trigger) {
        await writeReceipt(stageParent, owner, trigger, eventId, 'SUCCEEDED', { snapshotId: existing.snapshotId, cutoffAt: existing.cutoffAt });
        return { ok: true, deduplicated: true, snapshotId: existing.snapshotId };
      }
    }
    const snapshotId = `formal-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0,14)}-${randomUUID().slice(0,8)}`;
    stage = join(stageParent, `.${snapshotId}.tmp`); await mkdir(stage, { mode: 0o700 });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    let selected;
    try { const client = await pool.connect(); try { selected = await readRows(client, owner, join(stage, 'database-schema.pgcustom'), databaseUrl, env); } finally { client.release(); } } finally { await pool.end(); }
    const files = [], data = selected.data, counts = {};
    const schemaBytes = await safeFile(stage, join(stage, 'database-schema.pgcustom'));
    const schemaFile = { path: 'database-schema.pgcustom', sha256: sha(schemaBytes), bytes: schemaBytes.length };
    files.push(schemaFile);
    await put(stage, 'schema-migrations.json', serializeRows(selected.migrations), files);
    await put(stage, 'owned-sequences.json', serialize(selected.sequences), files);
    const sourcePaths = [
      ['formal-research-backup.mjs', fileURLToPath(import.meta.url)],
      ['formal-research-backup-selection.mjs', join(dirname(fileURLToPath(import.meta.url)), 'formal-research-backup-selection.mjs')]
    ];
    const sourceFiles = [];
    for (const [name, path] of sourcePaths) {
      const bytes = await readFile(path);
      await put(stage, `source/${name}`, bytes, files);
      sourceFiles.push({ path: `source/${name}`, sha256: sha(bytes) });
    }
    const { stdout: commitOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' });
    const sourceCommitSha = commitOutput.trim();
    if (!/^[a-f0-9]{40}$/.test(sourceCommitSha)) throw Error('source Git commit identity is unavailable');
    validateClosure(data, owner);
    validateCapturedSequences(data, selected.sequences);
    const links = buildLinks(data);
    const companyAssignments = assertCompanyClosure(data, links);
    for (const [table] of FORMAL_TABLES) {
      counts[table] = data[table].length;
      await put(stage, `all/${table}.json`, serializeRows(selected.exact[table]), files);
      await put(stage, `all/${table}.csv`, csv(data[table], selected.columns[table]), files);
    }
    for (const member of data.candidate_memberships) {
      const id = String(member.id), subset = {}, subsetExact = {};
      for (const [table] of FORMAL_TABLES) {
        subset[table] = []; subsetExact[table] = [];
        data[table].forEach((row, index) => { if (companyAssignments.get(row).has(id)) { subset[table].push(row); subsetExact[table].push(selected.exact[table][index]); } });
      }
      await put(stage, `companies/${id}/research.json`, serialize({ membershipId: id, tableFiles: FORMAL_TABLES.map(([table]) => `${table}.json`) }), files);
      for (const [table] of FORMAL_TABLES) await put(stage, `companies/${id}/${table}.json`, serializeRows(subsetExact[table]), files);
      for (const [table] of FORMAL_TABLES) await put(stage, `companies/${id}/${table}.csv`, csv(subset[table], selected.columns[table]), files);
      const originals = rawHashes(subset);
      await put(stage, `companies/${id}/originals.json`, serialize(originals.map((hash) => `../../originals/${hash.slice(0,2)}/${hash}`)), files);
    }
    const hashes = rawHashes(data), lengths = rawByteLengths(data);
    for (const hash of hashes) {
      const source = join(raw, hash.slice(0,2), hash);
      const bytes = await safeFile(raw, source);
      if (sha(bytes) !== hash || bytes.length !== lengths.get(hash)) throw Error(`original CAS identity mismatch: ${hash}`);
      await put(stage, `originals/${hash.slice(0,2)}/${hash}`, bytes, files);
    }
    const manifest = { schemaVersion: VERSION, snapshotId, createdAt: new Date().toISOString(), cutoffAt: selected.cutoff, owner: { actorType: 'user', actorId: owner }, trigger: { kind: trigger, eventId }, scope: 'all_persisted_formal_research_for_owner_all_memberships', exclusions: EXCLUDED_TABLES, counts: { memberships: data.candidate_memberships.length, originals: hashes.length, tables: counts }, databaseSchema: { ...schemaFile, postgresServerVersion: selected.postgresServerVersion, migrationRowsFile: 'schema-migrations.json', migrationRowsSha256: sha(await safeFile(stage, join(stage, 'schema-migrations.json'))), migrationCount: selected.migrations.length, sequenceRowsFile: 'owned-sequences.json', sequenceRowsSha256: sha(await safeFile(stage, join(stage, 'owned-sequences.json'))), sequenceCount: selected.sequences.length }, source: { commitSha: sourceCommitSha, files: sourceFiles }, cloudSyncStatus: 'UNKNOWN', files };
    await put(stage, 'manifest.json', serialize(manifest), []);
    await put(stage, 'manifest.sha256', Buffer.from(`${sha(await safeFile(stage, join(stage, 'manifest.json')))}  manifest.json\n`), []);
    await verifySnapshot(stage);
    await syncTree(stage);
    await rename(stage, join(sync, snapshotId)); stage = null;
    await syncDirectory(sync);
    publishedSnapshotId = snapshotId;
    await writeReceipt(stageParent, owner, trigger, eventId, 'SUCCEEDED', { snapshotId, cutoffAt: selected.cutoff });
    let retention;
    if (trigger === 'daily') try { retention = await pruneFormalSnapshots(sync, env); } catch { retention = { status: 'FAILED' }; }
    return { ok: true, snapshotId, cutoffAt: selected.cutoff, counts: manifest.counts, retention, cloudSyncStatus: 'UNKNOWN' };
  } catch (error) {
    await writeReceipt(stageParent, owner, trigger, eventId, 'FAILED', { pid: process.pid, host: backupHost, code: 'FORMAL_BACKUP_FAILED', snapshotId: publishedSnapshotId }).catch(() => {});
    throw error;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await releaseBackupLock(stageParent, lockIdentity);
  }
}
export async function inspectFormalResearchBackup(env = process.env) {
  if (!env.FORMAL_RESEARCH_BACKUP_SYNC_DIR || !env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID) return { status: 'NOT_CONFIGURED', cloudSyncStatus: 'UNKNOWN' };
  const root = await safeDirectory(env.FORMAL_RESEARCH_BACKUP_SYNC_DIR, 'sync');
  const snapshots = (await readdir(root)).filter((name) => /^formal-\d{14}-[a-f0-9]{8}$/.test(name)).sort().reverse();
  if (!snapshots.length) return { status: 'UNKNOWN', cloudSyncStatus: 'UNKNOWN' };
  const manifest = await verifySnapshot(join(root, snapshots[0]));
  return { status: 'VERIFIED_LOCAL', snapshotId: manifest.snapshotId, cutoffAt: manifest.cutoffAt, counts: manifest.counts, cloudSyncStatus: 'UNKNOWN' };
}
export async function verifyFormalResearchBackup(path) { return verifySnapshot(await realpath(path)); }
export async function rehearseFormalResearchRestore(env = process.env) {
  const path = required(env.FORMAL_RESEARCH_BACKUP_SNAPSHOT_DIR, 'FORMAL_RESEARCH_BACKUP_SNAPSHOT_DIR');
  const manifest = await verifyFormalResearchBackup(path);
  if (manifest.owner.actorType !== 'user' || manifest.owner.actorId !== required(env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID, 'FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID')) throw Error('Owner identity mismatch');
  await assertSchemaArchive(join(path, manifest.databaseSchema.path));
  const tables = formalTablesForManifest(manifest);
  for (const [table] of tables) {
    const rows = JSON.parse(await safeFile(path, join(path, `all/${table}.json`)));
    if (!Array.isArray(rows) || rows.length !== manifest.counts.tables[table]) throw Error(`row count mismatch: ${table}`);
  }
  return { ok: true, mode: 'isolated_file_rehearsal', snapshotId: manifest.snapshotId, cutoffAt: manifest.cutoffAt, databaseRestore: 'NOT_RUN' };
}

export async function restoreFormalResearchToIsolatedDatabase(env = process.env) {
  const rehearsal = await rehearseFormalResearchRestore(env);
  const snapshot = required(env.FORMAL_RESEARCH_BACKUP_SNAPSHOT_DIR, 'FORMAL_RESEARCH_BACKUP_SNAPSHOT_DIR');
  const manifest = await verifyFormalResearchBackup(snapshot);
  const tables = formalTablesForManifest(manifest);
  const targetConnection = required(env.FORMAL_RESEARCH_RESTORE_DATABASE_URL, 'FORMAL_RESEARCH_RESTORE_DATABASE_URL');
  const target = localDatabase(targetConnection);
  const databaseName = target.name;
  if (!/^research_formal_restore_[a-z0-9_]{8,40}$/.test(databaseName)) throw Error('restore target must be an explicitly named isolated loopback database');
  const source = localDatabase(required(env.LOCAL_ALPHA_DATABASE_URL ?? env.DATABASE_URL, 'source database URL'));
  if (source.name === target.name && source.host === target.host && source.port === target.port) throw Error('restore target must differ from source database');
  const rawDestination = await prospectiveDirectory(required(env.FORMAL_RESEARCH_RESTORE_RAW_STORE_ROOT, 'FORMAL_RESEARCH_RESTORE_RAW_STORE_ROOT'), 'isolated restore raw store');
  const restoredRaw = rawDestination.path;
  for (const [label, value] of [
    ['active raw store', env.LOCAL_ALPHA_RAW_STORE_ROOT ?? env.RESEARCH_DOCUMENT_RAW_STORE_ROOT],
    ['backup sync', env.FORMAL_RESEARCH_BACKUP_SYNC_DIR],
    ['backup staging', env.FORMAL_RESEARCH_BACKUP_STAGING_DIR],
    ['snapshot', snapshot]
  ]) {
    if (!value) continue;
    const boundary = await realpath(value);
    if (containsPath(boundary, restoredRaw) || containsPath(restoredRaw, boundary)) throw Error(`restore raw store overlaps ${label}`);
  }
  if (rawDestination.exists && (await readdir(restoredRaw)).length) throw Error('isolated restore raw store must be empty');
  await safeDirectory(restoredRaw, 'isolated restore raw store');
  const adminUrl = new URL(targetConnection); adminUrl.pathname = '/postgres';
  const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const serverVersion = (await adminPool.query('SHOW server_version_num')).rows[0].server_version_num;
    if (String(serverVersion) !== String(manifest.databaseSchema.postgresServerVersion)) throw Error('restore PostgreSQL version differs from snapshot schema');
    const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]);
    if (exists.rowCount) throw Error('isolated restore database already exists');
  } finally { await adminPool.end(); }
  await postgresCommand('createdb', ['--maintenance-db', 'postgres', '--template', 'template0', '--encoding', 'UTF8', databaseName], targetConnection, env);
  const pool = new Pool({ connectionString: targetConnection, max: 1 });
  let client = await pool.connect();
  try {
    const actualName = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (actualName !== databaseName) throw Error('restore target identity changed');
    const objects = await client.query("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')");
    if (objects.rows[0].count !== '0') throw Error('isolated restore database is not schema-empty');
    client.release(); client = null;
    await postgresCommand('pg_restore', [
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges',
      '--dbname', databaseName, join(snapshot, manifest.databaseSchema.path)
    ], targetConnection, env);
    client = await pool.connect();
    await client.query('BEGIN');
    const migrationRows = rawArrayElements((await safeFile(snapshot, join(snapshot, manifest.databaseSchema.migrationRowsFile))).toString('utf8'));
    for (const row of migrationRows) await client.query('INSERT INTO schema_migrations SELECT * FROM jsonb_populate_record(NULL::schema_migrations, $1::jsonb)', [row]);
    const restoredMigrations = (await client.query('SELECT to_jsonb(m)::text AS raw FROM schema_migrations m ORDER BY filename')).rows.map((row) => row.raw);
    if (restoredMigrations.length !== migrationRows.length || restoredMigrations.some((row, index) => row !== migrationRows[index])) throw Error('restored migration identity mismatch');
    for (const file of manifest.files.filter((file) => file.path.startsWith('originals/'))) {
      const bytes = await safeFile(snapshot, join(snapshot, file.path));
      await put(restoredRaw, file.path.slice('originals/'.length), bytes, []);
    }
    // The target schema came from this snapshot. It is an isolated disposable database.
    // Replica mode permits the known source-lead/document FK cycle; final row and
    // identity checks below are mandatory before this transaction commits.
    await client.query("SET LOCAL session_replication_role = 'replica'");
    for (const [table] of tables) {
      const rows = rawArrayElements((await safeFile(snapshot, join(snapshot, `all/${table}.json`))).toString('utf8'));
      for (const row of rows) await client.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`, [row]);
      const count = (await client.query(`SELECT count(*)::text AS count FROM ${table}`)).rows[0].count;
      if (count !== String(rows.length)) throw Error(`restore count mismatch: ${table}`);
      const restored = (await client.query(`SELECT to_jsonb(t)::text AS raw FROM ${table} t ORDER BY ${orderBy(table)}`)).rows.map((r) => r.raw);
      if (restored.length !== rows.length || restored.some((raw, index) => raw !== rows[index])) throw Error(`restore row identity mismatch: ${table}`);
    }
    const owner = required(env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID, 'FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID');
    const wrongOwner = await client.query("SELECT 1 FROM candidate_memberships WHERE actor_type <> 'user' OR actor_id <> $1 LIMIT 1", [owner]);
    if (wrongOwner.rowCount) throw Error('restored membership identity mismatch');
    const badSource = await client.query("SELECT 1 FROM research_source_snapshots s JOIN candidate_memberships m ON m.id=s.candidate_membership_id WHERE s.actor_type <> m.actor_type OR s.actor_id <> m.actor_id OR s.symbol <> m.symbol OR s.captured_membership_version > m.version LIMIT 1");
    if (badSource.rowCount) throw Error('restored original identity mismatch');
    const badCapture = await client.query("SELECT 1 FROM research_futu_financial_statement_captures s JOIN candidate_memberships m ON m.id=s.candidate_membership_id WHERE s.actor_type <> m.actor_type OR s.actor_id <> m.actor_id OR s.symbol <> m.symbol OR s.captured_membership_version > m.version LIMIT 1");
    if (badCapture.rowCount) throw Error('restored Futu identity mismatch');
    if(tables===FORMAL_TABLES){const badValuation=await client.query("SELECT 1 FROM research_futu_valuation_captures s JOIN candidate_memberships m ON m.id=s.candidate_membership_id WHERE s.actor_type <> m.actor_type OR s.actor_id <> m.actor_id OR s.symbol <> m.symbol OR s.captured_membership_version > m.version LIMIT 1");if(badValuation.rowCount)throw Error('restored Futu valuation identity mismatch');}
    const badDocument = await client.query('SELECT 1 FROM research_documents d JOIN candidate_memberships m ON m.id=d.candidate_membership_id WHERE d.captured_membership_version > m.version LIMIT 1');
    if (badDocument.rowCount) throw Error('restored document membership version mismatch');
    const badLead = await client.query('SELECT 1 FROM research_source_leads l JOIN candidate_memberships m ON m.id=l.candidate_membership_id WHERE l.symbol <> m.symbol OR l.captured_membership_version > m.version LIMIT 1');
    if (badLead.rowCount) throw Error('restored source lead identity mismatch');
    const badReport = await client.query('SELECT 1 FROM deep_research_reports r LEFT JOIN research_evidence_packs p ON p.id=r.evidence_pack_id WHERE p.id IS NULL LIMIT 1');
    if (badReport.rowCount) throw Error('restored report lineage mismatch');
    const foreignKeyCount = await validateForeignKeys(client);
    const savedSequences = JSON.parse((await safeFile(snapshot, join(snapshot, manifest.databaseSchema.sequenceRowsFile))).toString('utf8'));
    const sequenceCount = await restoreOwnedSequences(client, savedSequences, tables);
    await client.query('COMMIT');
    return { ...rehearsal, mode: 'isolated_database_restore', databaseRestore: 'VERIFIED_LOCAL', targetDatabase: databaseName, foreignKeyCount, sequenceCount };
  } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client?.release(); await pool.end(); }
}

/** One durable API restore attempt. A successful file rehearsal is never recorded as a database restore. */
export async function runFormalRestoreRequest(env = process.env, restore = restoreFormalResearchToIsolatedDatabase) {
  const stage = await safeDirectory(required(env.FORMAL_RESEARCH_BACKUP_STAGING_DIR, 'restore staging'), 'restore staging');
  const path = required(env.FORMAL_RESEARCH_RESTORE_RECEIPT_PATH, 'restore receipt path');
  const directory = await realpath(dirname(path));
  if (!containsPath(join(stage, 'restore-requests'), directory) || !/^attempt-[1-3]\.json$/.test(basename(path))) throw Error('restore receipt path is outside staging');
  const receipt = JSON.parse((await safeFile(directory, path)).toString('utf8'));
  if (receipt.owner !== required(env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID, 'restore Owner')
    || !/^[a-f0-9]{64}$/.test(receipt.restoreId)
    || !/^formal-\d{14}-[a-f0-9]{8}$/.test(receipt.snapshotId)
    || ![1, 2, 3].includes(receipt.attempt)
    || receipt.targetDatabase !== `research_formal_restore_${receipt.restoreId.slice(0, 20)}_${receipt.attempt}`
    || basename(path) !== `attempt-${receipt.attempt}.json`
    || basename(directory) !== receipt.restoreId
    || basename(env.FORMAL_RESEARCH_BACKUP_SNAPSHOT_DIR ?? '') !== receipt.snapshotId
    || new URL(required(env.FORMAL_RESEARCH_RESTORE_DATABASE_URL, 'restore database URL')).pathname !== `/${receipt.targetDatabase}`
    || receipt.status !== 'PENDING') throw Error('restore request identity mismatch');
  const update = async (status, fields = {}) => {
    const next = { ...receipt, status, updatedAt: new Date().toISOString(), host: hostname(), pid: process.pid, ...fields };
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    await writeFile(temporary, serialize(next), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
    await syncDirectory(directory);
    return next;
  };
  await update('RUNNING');
  let lockIdentity;
  try {
    // Serializing with daily retention keeps the selected snapshot in place
    // until its database and originals have been restored and verified.
    lockIdentity = await acquireBackupLock(stage, receipt.owner, env, false);
    const result = await restore(env);
    if (result?.databaseRestore !== 'VERIFIED_LOCAL' || result.snapshotId !== receipt.snapshotId
      || result.targetDatabase !== receipt.targetDatabase) throw Error('isolated database restore result identity mismatch');
    return await update('SUCCEEDED', { databaseRestore: 'VERIFIED_LOCAL' });
  } catch (error) {
    const code = error instanceof Error && error.message === 'backup lock requires inspection before restore'
      ? 'BACKUP_LOCK_REQUIRES_INSPECTION' : 'ISOLATED_DATABASE_RESTORE_FAILED';
    await update('FAILED', { code, databaseRestore: 'NOT_VERIFIED' });
    throw error;
  } finally {
    await releaseBackupLock(stage, lockIdentity);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    const command = process.argv[2] ?? 'snapshot';
    const trigger = process.argv[3] ?? 'manual';
    const eventId = process.argv[4] ?? (trigger === 'daily' ? new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.FORMAL_RESEARCH_BACKUP_TIMEZONE ?? 'Asia/Shanghai' }).format(new Date()).replaceAll('-', '') : null);
    const result = command === 'snapshot' ? await createFormalResearchBackup(process.env, trigger, eventId)
      : command === 'status' ? await inspectFormalResearchBackup()
      : command === 'verify' ? await verifyFormalResearchBackup(required(process.argv[3], 'snapshot path'))
      : command === 'restore-rehearsal' ? await rehearseFormalResearchRestore()
      : command === 'restore-isolated' ? await restoreFormalResearchToIsolatedDatabase()
      : command === 'restore-request' ? await runFormalRestoreRequest()
      : null;
    if (!result) throw Error(`unknown command: ${command}`);
    console.log(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message); process.exitCode = 1;
    if (process.argv[2] === 'snapshot' || !process.argv[2]) {
      const directory = process.env.FORMAL_RESEARCH_BACKUP_STAGING_DIR;
      if (directory && isAbsolute(directory)) {
        try { await mkdir(directory, { recursive: true, mode: 0o700 }); await writeFile(join(directory, 'last-failure.json'), serialize({ owner: process.env.FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID ?? null, failedAt: new Date().toISOString(), kind: process.argv[3] ?? 'manual', eventId: process.argv[4] ?? null, code: 'FORMAL_BACKUP_FAILED' }), { mode: 0o600 }); } catch { /* preserve primary failure */ }
      }
    }
  }
}
