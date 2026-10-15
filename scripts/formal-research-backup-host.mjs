#!/usr/bin/env node
// One macOS LaunchAgent entry for the formal research snapshot CLI. This script
// renders a plist or runs one local calendar day's backup; it never installs it.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.annualrings.formal-research-backup.daily';
const HOST_SCHEMA = '2026-10-10.formal-research-host.v1';
const TIME_ZONE = 'Asia/Shanghai';
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateRoot = join(homedir(), '.local/share/investment-assistant');
const snapshotEntry = join(repositoryRoot, 'scripts/formal-research-backup.mjs');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const within = (parent, candidate) => {
  const difference = relative(parent, candidate);
  return difference === '' || (difference !== '..' && !difference.startsWith('../') && !isAbsolute(difference));
};
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${name} is required`);
  return value.trim();
};
async function regularPrivateFile(path, label) {
  if (!isAbsolute(path)) throw Error(`${label} must be absolute`);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > MAX_CONFIG_BYTES
    || (metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
    throw Error(`${label} must be an owned regular 0600 file no larger than 16 KiB`);
  }
  return realpath(path);
}
async function realDirectory(path, label) {
  if (!isAbsolute(path)) throw Error(`${label} must be absolute`);
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw Error(`${label} must be a real directory`);
  return realpath(path);
}
function loopbackDatabase(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash
    || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw Error('database URL must be loopback PostgreSQL');
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw Error('database identity is unsupported for formal backup');
}
function localDay(now = new Date()) {
  const value = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('local calendar day is unavailable');
  return value.replaceAll('-', '');
}
function assertHostTimeZone() {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== TIME_ZONE) {
    throw Error('host local time zone must be Asia/Shanghai for the LaunchAgent calendar');
  }
}
async function readConfig(path) {
  const absolute = await regularPrivateFile(path, 'formal backup config');
  const privateDirectory = await realDirectory(privateRoot, 'investment assistant private directory');
  if (!within(privateDirectory, absolute)) throw Error('formal backup config must stay in the existing private local directory');
  const value = JSON.parse(await readFile(absolute, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('formal backup config must be an object');
  const allowed = new Set(['schemaVersion', 'ownerActorId', 'databaseUrl', 'rawStoreRoot', 'syncDirectory', 'stagingDirectory', 'scheduleHour', 'scheduleMinute', 'maxRuntimeMinutes']);
  if (Object.keys(value).some((key) => !allowed.has(key)) || value.schemaVersion !== HOST_SCHEMA) throw Error('formal backup config schema is unsupported');
  const owner = required(value.ownerActorId, 'ownerActorId');
  if (owner.length > 200 || !/^[A-Za-z0-9._:/-]+$/.test(owner)) throw Error('Owner actor ID is invalid');
  const databaseUrl = required(value.databaseUrl, 'databaseUrl');
  loopbackDatabase(databaseUrl);
  const raw = await realDirectory(required(value.rawStoreRoot, 'rawStoreRoot'), 'raw store');
  const sync = await realDirectory(required(value.syncDirectory, 'syncDirectory'), 'sync directory');
  const staging = await realDirectory(required(value.stagingDirectory, 'stagingDirectory'), 'staging directory');
  const stagingMetadata = await stat(staging);
  if (stagingMetadata.uid !== process.getuid() || (stagingMetadata.mode & 0o077) !== 0) throw Error('staging directory must be owned and private');
  if (within(repositoryRoot, absolute) || within(sync, absolute)
    || within(sync, staging) || within(staging, sync)
    || within(sync, raw) || within(raw, sync) || within(staging, raw) || within(raw, staging)
    || (await stat(sync)).dev !== (await stat(staging)).dev) throw Error('formal backup private path boundaries are invalid');
  const hour = value.scheduleHour ?? 3, minute = value.scheduleMinute ?? 15;
  const maxRuntimeMinutes = value.maxRuntimeMinutes ?? 240;
  if (!Number.isSafeInteger(hour) || hour < 0 || hour > 23 || !Number.isSafeInteger(minute) || minute < 0 || minute > 59
    || !Number.isSafeInteger(maxRuntimeMinutes) || maxRuntimeMinutes < 30 || maxRuntimeMinutes > 720) throw Error('formal backup host schedule or runtime bound is invalid');
  await lstat(snapshotEntry).then((metadata) => { if (!metadata.isFile() || metadata.isSymbolicLink()) throw Error('formal backup snapshot entry is unavailable'); });
  return { configPath: absolute, owner, databaseUrl, raw, sync, staging, hour, minute, maxRuntimeMinutes };
}
async function readReceipt(config, dayKey) {
  const identity = sha(`${config.owner}\0daily\0${dayKey}`);
  const path = join(config.staging, 'events', `${identity}.json`);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw Error('formal backup receipt is unsafe');
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    return receipt.owner === config.owner && receipt.kind === 'daily' && receipt.eventId === dayKey ? receipt : null;
  } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
async function failReceipt(config, dayKey, code) {
  const prior = await readReceipt(config, dayKey);
  if (prior?.status === 'SUCCEEDED' || prior?.status === 'FAILED') return;
  const directory = join(config.staging, 'events');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const identity = sha(`${config.owner}\0daily\0${dayKey}`);
  const temporary = join(directory, `.${identity}.${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify({ owner: config.owner, kind: 'daily', eventId: dayKey, status: 'FAILED', updatedAt: new Date().toISOString(), host: hostname(), code })}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, join(directory, `${identity}.json`));
  const parent = await open(directory, constants.O_RDONLY);
  try { await parent.sync(); } finally { await parent.close(); }
}
function childEnvironment(config) {
  const names = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  return {
    ...env,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    LOCAL_ALPHA_DATABASE_URL: config.databaseUrl,
    LOCAL_ALPHA_RAW_STORE_ROOT: config.raw,
    FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID: config.owner,
    FORMAL_RESEARCH_BACKUP_SYNC_DIR: config.sync,
    FORMAL_RESEARCH_BACKUP_STAGING_DIR: config.staging,
    FORMAL_RESEARCH_BACKUP_TIMEZONE: TIME_ZONE
  };
}
async function runDaily(config) {
  assertHostTimeZone();
  const dayKey = localDay();
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [snapshotEntry, 'snapshot', 'daily', dayKey], {
      cwd: repositoryRoot, env: childEnvironment(config), stdio: ['ignore', 'pipe', 'ignore']
    });
    let output = '', finished = false;
    const done = (value) => { if (!finished) { finished = true; resolve(value); } };
    const timeout = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10_000).unref(); }, config.maxRuntimeMinutes * 60_000);
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > MAX_OUTPUT_BYTES) { child.kill('SIGTERM'); output = ''; }
    });
    child.once('error', () => { clearTimeout(timeout); done({ ok: false, code: 'HOST_CHILD_START_FAILED' }); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !output) return done({ ok: false, code: 'HOST_CHILD_FAILED' });
      try { const parsed = JSON.parse(output); done(parsed?.ok === true ? { ok: true, snapshotId: parsed.snapshotId } : { ok: false, code: 'HOST_CHILD_RESULT_INVALID' }); }
      catch { done({ ok: false, code: 'HOST_CHILD_RESULT_INVALID' }); }
    });
  });
  const receipt = await readReceipt(config, dayKey);
  if (result.ok && receipt?.status === 'SUCCEEDED' && receipt.snapshotId === result.snapshotId) {
    process.stdout.write(`${JSON.stringify({ ok: true, dayKey, snapshotId: receipt.snapshotId, status: 'VERIFIED_LOCAL_RECEIPT' })}\n`);
    return;
  }
  await failReceipt(config, dayKey, result.ok ? 'HOST_RECEIPT_MISSING' : result.code);
  throw Error('formal daily backup failed; inspect the authenticated formal backup status');
}
function launchdXml(config, logDirectory) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>${LABEL}</string>\n  <key>ProgramArguments</key><array>\n    <string>${xml(process.execPath)}</string>\n    <string>${xml(fileURLToPath(import.meta.url))}</string>\n    <string>run-daily</string>\n    <string>${xml(config.configPath)}</string>\n    <string>${xml(config.owner)}</string>\n    <string>${xml(config.staging)}</string>\n  </array>\n  <key>WorkingDirectory</key><string>${xml(repositoryRoot)}</string>\n  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>\n  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${config.hour}</integer><key>Minute</key><integer>${config.minute}</integer></dict>\n  <key>RunAtLoad</key><true/>\n  <key>ProcessType</key><string>Background</string>\n  <key>LowPriorityIO</key><true/>\n  <key>ThrottleInterval</key><integer>300</integer>\n  <key>StandardOutPath</key><string>${xml(join(logDirectory, 'annualrings-formal-research-backup.log'))}</string>\n  <key>StandardErrorPath</key><string>${xml(join(logDirectory, 'annualrings-formal-research-backup.error.log'))}</string>\n</dict></plist>\n`;
}
async function renderLaunchd(config, logPath, outputPath) {
  assertHostTimeZone();
  const logs = await realDirectory(logPath, 'log directory');
  const logMetadata = await stat(logs);
  if (logMetadata.uid !== process.getuid() || (logMetadata.mode & 0o077) !== 0) throw Error('log directory must be owned and private');
  if (!within(await realDirectory(privateRoot, 'investment assistant private directory'), logs)
    || within(config.sync, logs)) throw Error('log directory must be private and outside backup sync directory');
  if (!isAbsolute(outputPath)) throw Error('output plist path must be absolute');
  const outputParent = await realDirectory(dirname(outputPath), 'plist parent directory');
  const output = join(outputParent, basename(outputPath));
  if (within(config.sync, output) || within(repositoryRoot, output)) throw Error('plist output must be outside backup sync and repository');
  await writeFile(output, launchdXml(config, logs), { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, label: LABEL, outputPath: output, installed: false, scheduleTimeZone: TIME_ZONE, hour: config.hour, minute: config.minute })}\n`);
}
async function main(args) {
  if (args[0] === 'render-launchd' && args.length === 4) return renderLaunchd(await readConfig(args[1]), args[2], args[3]);
  if (args[0] === 'run-daily' && args.length === 4) {
    const owner = required(args[2], 'launchd Owner actor ID');
    const staging = await realDirectory(required(args[3], 'launchd staging directory'), 'launchd staging directory');
    const fallback = { owner, staging };
    const dayKey = localDay();
    try {
      const config = await readConfig(args[1]);
      if (config.owner !== owner || config.staging !== staging) throw Error('launchd config identity changed');
      return await runDaily(config);
    } catch (error) {
      await failReceipt(fallback, dayKey, 'HOST_DAILY_ENTRY_FAILED').catch(() => {});
      throw error;
    }
  }
  throw Error('usage: formal-research-backup-host.mjs render-launchd <private-config.json> <log-directory> <new-output.plist> | run-daily <private-config.json> <owner-actor-id> <staging-directory>');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'formal backup host failed'}\n`); process.exitCode = 1; }
}
