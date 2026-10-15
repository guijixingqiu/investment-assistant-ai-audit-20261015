#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = await realpath(resolve("."));
const directExecutionUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (import.meta.url === directExecutionUrl) {
  try {
    const command = process.argv[2] ?? "snapshot";
    if (command === "snapshot") {
      const result = await createResearchBackupSnapshot(process.env);
      console.log(`RESEARCH_BACKUP_SNAPSHOT=${JSON.stringify(result)}`);
    } else if (command === "restore-rehearsal") {
      const result = await rehearseResearchBackupRestore(process.env);
      console.log(`RESEARCH_BACKUP_RESTORE_REHEARSAL=${JSON.stringify(result)}`);
    } else if (command === "restore") {
      const result = await restoreResearchBackupSnapshot(process.env);
      console.log(`RESEARCH_BACKUP_RESTORE=${JSON.stringify(result)}`);
    } else {
      throw new Error(`unsupported research backup command: ${command}`);
    }
  } catch (error) {
    console.error(`Research backup command failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode ??= 1;
  }
}

export async function createResearchBackupSnapshot(environment) {
  const databaseUrl = required(
    environment.LOCAL_ALPHA_DATABASE_URL ?? environment.DATABASE_URL,
    "LOCAL_ALPHA_DATABASE_URL or DATABASE_URL"
  );
  const rawStorePath = required(
    environment.LOCAL_ALPHA_RAW_STORE_ROOT ?? environment.RESEARCH_DOCUMENT_RAW_STORE_ROOT,
    "LOCAL_ALPHA_RAW_STORE_ROOT or RESEARCH_DOCUMENT_RAW_STORE_ROOT"
  );
  const syncDirectoryPath = required(environment.RESEARCH_BACKUP_SYNC_DIR, "RESEARCH_BACKUP_SYNC_DIR");
  const database = parseLocalDatabaseUrl(databaseUrl);
  const rawStoreRoot = await externalDirectory(rawStorePath, "raw store", false);
  const syncRoot = await externalDirectory(syncDirectoryPath, "backup sync directory", true);
  if (isWithin(rawStoreRoot, syncRoot) || isWithin(syncRoot, rawStoreRoot)) {
    throw new Error("backup sync directory and raw store must not contain one another");
  }
  await syncDirectory(syncRoot);

  const createdAt = new Date().toISOString();
  const snapshotId = `${createdAt.replaceAll(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  let temporaryDirectory = await mkdtemp(join(syncRoot, ".research-backup-"));
  try {
    const dumpPath = join(temporaryDirectory, "research.pgcustom");
    await dumpDatabase(database, dumpPath, environment);
    await chmod(dumpPath, 0o600);
    await syncFile(dumpPath);
    const dump = await fileIdentity(dumpPath);
    const restoreList = await runPostgresCommand("pg_restore", ["--list", dumpPath], database, environment);
    assert(restoreList.stdout.trim().length > 0, "pg_restore must recognize the custom-format dump");
    const hasResearchDocuments = /TABLE DATA\s+\S+\s+research_documents\b/i.test(restoreList.stdout);
    const referencedObjects = await researchDocumentReferencesFromDump(
      dumpPath,
      database,
      environment,
      hasResearchDocuments
    );

    const rawStore = await copyRawStore(rawStoreRoot, join(temporaryDirectory, "raw-store"), referencedObjects);
    const commitSha = (await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8"
    })).stdout.trim();
    assert(/^[a-f0-9]{40}$/.test(commitSha), "backup must bind an exact Git commit");

    const manifest = {
      schemaVersion: "2026-08-21.research-backup.v3",
      snapshotId,
      commitSha,
      createdAt,
      database: {
        format: "postgresql_custom",
        file: "research.pgcustom",
        sha256: dump.sha256,
        bytes: dump.bytes,
        restoreArchiveListVerified: true,
        includesUnabsorbedAiOutput: true
      },
      rawStore,
      cloudSyncStatus: "UNKNOWN",
      // Truthful scope: this snapshot copies the whole local research database and the
      // whole raw content-addressed store, with no table or row redaction. The
      // exclusions list names only artifacts that live outside both and therefore
      // cannot be captured here; it never means filtering inside the database.
      scope: {
        database: "entire_local_research_database_all_tables_all_rows_no_redaction",
        rawStore: "entire_research_document_content_addressed_store",
        includesDrafts: true,
        includesUnabsorbedAiOutput: true,
        includesDatabaseAssetRecords: true,
        sanitizedShareableResearchArchive: false
      },
      exclusions: [
        "os_credentials_and_keychain_entries_outside_database_and_raw_store",
        "provider_api_credentials_outside_database_and_raw_store",
        "runtime_temporary_files_outside_database_and_raw_store"
      ],
      safety: {
        sourceDatabase: "loopback_local_only",
        productionTouched: false,
        brokerOrTradingMutation: false,
        officialAssetMutation: false
      }
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const manifestSha256 = sha256(manifestBytes);
    await durableWriteFile(join(temporaryDirectory, "manifest.json"), manifestBytes);
    await durableWriteFile(
      join(temporaryDirectory, "manifest.sha256"),
      `${manifestSha256}  manifest.json\n`
    );
    await syncDirectory(temporaryDirectory);

    const finalDirectory = join(syncRoot, snapshotId);
    await rename(temporaryDirectory, finalDirectory);
    temporaryDirectory = null;
    try {
      await syncDirectory(syncRoot);
    } catch (error) {
      await rm(finalDirectory, { recursive: true, force: true }).catch(() => {});
      await syncDirectory(syncRoot).catch(() => {});
      throw error;
    }
    return {
      ok: true,
      snapshotId,
      path: finalDirectory,
      manifestSha256,
      cloudSyncStatus: "UNKNOWN",
      databaseSha256: dump.sha256,
      rawObjectCount: rawStore.objectCount
    };
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function rehearseResearchBackupRestore(environment, requiredSafetyMarkers = new Set()) {
  const databaseUrl = required(
    environment.LOCAL_ALPHA_DATABASE_URL ?? environment.DATABASE_URL,
    "LOCAL_ALPHA_DATABASE_URL or DATABASE_URL"
  );
  const database = parseLocalDatabaseUrl(databaseUrl);
  const { snapshotRoot, manifestBytes, manifestSha256, manifest } = await validatedBackupSnapshot(
    required(environment.RESEARCH_BACKUP_SNAPSHOT_DIR, "RESEARCH_BACKUP_SNAPSHOT_DIR")
  );

  const restoreDatabaseName = `research_restore_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const stagingRoot = await mkdtemp(join(tmpdir(), "research-restore-"));
  await chmod(stagingRoot, 0o700);
  const abortController = new AbortController();
  let interruptedSignal = null;
  let databaseCreationAttempted = false;
  let cleanupPromise = null;
  let references = [];
  const interrupt = (signal) => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    abortController.abort();
  };
  const interruptSigint = () => interrupt("SIGINT");
  const interruptSigterm = () => interrupt("SIGTERM");
  const cleanupDatabase = async () => {
    if (!databaseCreationAttempted) return;
    cleanupPromise ??= runPostgresCommand(
      "dropdb",
      ["--if-exists", "--force", restoreDatabaseName],
      database,
      environment
    ).then(() => { databaseCreationAttempted = false; });
    await cleanupPromise;
  };
  process.once("SIGINT", interruptSigint);
  process.once("SIGTERM", interruptSigterm);
  try {
    await durableWriteFile(join(stagingRoot, "manifest.json"), manifestBytes);
    await durableWriteFile(join(stagingRoot, "manifest.sha256"), `${manifestSha256}  manifest.json\n`);
    const dumpBytes = await readRegularFile(snapshotRoot, join(snapshotRoot, manifest.database.file));
    const dump = { sha256: sha256(dumpBytes), bytes: dumpBytes.length };
    if (dump.sha256 !== manifest.database.sha256 || dump.bytes !== manifest.database.bytes) {
      throw new Error("backup PostgreSQL dump identity does not match the manifest");
    }
    const dumpPath = join(stagingRoot, manifest.database.file);
    await durableWriteFile(dumpPath, dumpBytes);
    const objectHashes = await stageManifestRawStore(snapshotRoot, manifest.rawStore, stagingRoot);
    const commandOptions = { signal: abortController.signal };
    const restoreList = await runPostgresCommand(
      "pg_restore",
      ["--list", dumpPath],
      database,
      environment,
      commandOptions
    );
    if (restoreList.stdout.trim().length === 0) throw new Error("pg_restore must recognize the backup dump");

    databaseCreationAttempted = true;
    await runPostgresCommand("createdb", [restoreDatabaseName], database, environment, commandOptions);
    await runPostgresCommand("pg_restore", [
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname", restoreDatabaseName,
      dumpPath
    ], database, environment, commandOptions);
    const restoredSafetyMarkers = await readRestoreSafetyMarkers(
      restoreDatabaseName,
      database,
      environment,
      commandOptions
    );
    assertRestoreSafety(requiredSafetyMarkers, restoredSafetyMarkers);
    const result = await runPostgresCommand("psql", [
      "--no-psqlrc",
      "--dbname", restoreDatabaseName,
      "--tuples-only",
      "--no-align",
      "--command", "select distinct pdf_sha256 from research_documents order by pdf_sha256"
    ], database, environment, commandOptions);
    references = validatedResearchDocumentReferences(result.stdout, manifest.rawStore, objectHashes);
    await cleanupDatabase();
    if (interruptedSignal) throw new Error(`restore rehearsal interrupted by ${interruptedSignal}`);
    return {
      ok: true,
      snapshotId: manifest.snapshotId,
      sourceCommitSha: manifest.commitSha,
      manifestSha256,
      databaseSha256: dump.sha256,
      rawObjectCount: manifest.rawStore.objectCount,
      databaseReferenceCount: references.length,
      restoredTo: "isolated_task_owned_loopback_database",
      temporaryDatabaseRemoved: true,
      monotonicSafetyVerified: true,
      cloudSyncStatus: "UNKNOWN",
      productionTouched: false
    };
  } finally {
    try {
      await cleanupDatabase();
    } catch (error) {
      throw new Error(`restore rehearsal cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      process.removeListener("SIGINT", interruptSigint);
      process.removeListener("SIGTERM", interruptSigterm);
      if (interruptedSignal) process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

export async function restoreResearchBackupSnapshot(environment) {
  const databaseUrl = required(
    environment.LOCAL_ALPHA_DATABASE_URL ?? environment.DATABASE_URL,
    "LOCAL_ALPHA_DATABASE_URL or DATABASE_URL"
  );
  const rawStorePath = required(
    environment.LOCAL_ALPHA_RAW_STORE_ROOT ?? environment.RESEARCH_DOCUMENT_RAW_STORE_ROOT,
    "LOCAL_ALPHA_RAW_STORE_ROOT or RESEARCH_DOCUMENT_RAW_STORE_ROOT"
  );
  const snapshotPath = required(environment.RESEARCH_BACKUP_SNAPSHOT_DIR, "RESEARCH_BACKUP_SNAPSHOT_DIR");
  const database = parseLocalDatabaseUrl(databaseUrl);
  const selected = await validatedBackupSnapshot(snapshotPath);
  if (environment.RESEARCH_BACKUP_CONFIRM_REPLACE !== selected.manifest.snapshotId) {
    throw new Error("RESEARCH_BACKUP_CONFIRM_REPLACE must exactly match the selected snapshot ID");
  }
  if (environment.RESEARCH_BACKUP_TARGET_QUIESCED !== "YES") {
    throw new Error("RESEARCH_BACKUP_TARGET_QUIESCED=YES is required before replacing local research data");
  }

  const requiredSafetyMarkers = await readRestoreSafetyMarkers(database.name, database, environment);
  const rehearsal = await rehearseResearchBackupRestore(environment, requiredSafetyMarkers);
  if (!rehearsal.ok || rehearsal.snapshotId !== selected.manifest.snapshotId || !rehearsal.temporaryDatabaseRemoved) {
    throw new Error("selected backup did not pass isolated restore rehearsal");
  }
  const safetyReadback = await readRestoreSafetyMarkers(database.name, database, environment);
  if (!sameMarkers(requiredSafetyMarkers, safetyReadback)) {
    throw new Error("local deletion or Cloud AI safety state changed during restore rehearsal");
  }
  const protection = await createResearchBackupSnapshot(environment);
  const current = await validatedBackupSnapshot(snapshotPath);
  if (current.manifestSha256 !== selected.manifestSha256) {
    throw new Error("selected backup changed after restore rehearsal");
  }

  const activeRawStoreRoot = await externalDirectory(rawStorePath, "raw store", false);
  const stagingRoot = await mkdtemp(join(tmpdir(), "research-restore-active-"));
  await chmod(stagingRoot, 0o700);
  try {
    const dumpBytes = await readRegularFile(current.snapshotRoot, join(current.snapshotRoot, current.manifest.database.file));
    if (sha256(dumpBytes) !== current.manifest.database.sha256
      || dumpBytes.length !== current.manifest.database.bytes) {
      throw new Error("backup PostgreSQL dump identity does not match the manifest");
    }
    const dumpPath = join(stagingRoot, current.manifest.database.file);
    await durableWriteFile(dumpPath, dumpBytes);
    const objectHashes = await stageManifestRawStore(
      current.snapshotRoot,
      current.manifest.rawStore,
      stagingRoot
    );
    const rawObjectsAdded = await mergeStagedRawStoreIntoActive(
      stagingRoot,
      current.manifest.rawStore,
      activeRawStoreRoot
    );
    await runPostgresCommand("pg_restore", [
      "--clean",
      "--if-exists",
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname", database.name,
      dumpPath
    ], database, environment);
    const result = await runPostgresCommand("psql", [
      "--no-psqlrc",
      "--dbname", database.name,
      "--tuples-only",
      "--no-align",
      "--command", "select distinct pdf_sha256 from research_documents order by pdf_sha256"
    ], database, environment);
    const references = validatedResearchDocumentReferences(
      result.stdout,
      current.manifest.rawStore,
      objectHashes
    );
    const restoredSafetyMarkers = await readRestoreSafetyMarkers(database.name, database, environment);
    assertRestoreSafety(requiredSafetyMarkers, restoredSafetyMarkers);
    return {
      ok: true,
      snapshotId: current.manifest.snapshotId,
      manifestSha256: current.manifestSha256,
      protectionSnapshotId: protection.snapshotId,
      protectionSnapshotPath: protection.path,
      protectionManifestSha256: protection.manifestSha256,
      databaseReferenceCount: references.length,
      rawObjectCount: current.manifest.rawStore.objectCount,
      rawObjectsAdded,
      restoredTo: "owner_confirmed_loopback_local_research_database",
      transactionalDatabaseReplacement: true,
      freshReadbackVerified: true,
      monotonicSafetyVerified: true,
      cloudSyncStatus: "UNKNOWN",
      productionTouched: false,
      brokerOrTradingMutation: false,
      officialAssetMutation: false
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function readRestoreSafetyMarkers(databaseName, database, environment, options = {}) {
  const result = await runPostgresCommand("psql", [
    "--no-psqlrc",
    "--dbname", databaseName,
    "--tuples-only",
    "--no-align",
    "--command", restoreSafetyMarkersSql()
  ], database, environment, options);
  return new Set(result.stdout.trim().split(/\r?\n/).filter(Boolean));
}

function assertRestoreSafety(requiredMarkers, restoredMarkers) {
  if ([...restoredMarkers].some((marker) => marker.startsWith("active-task|"))) {
    throw new Error("selected backup contains an active deep-research task and requires a new Owner action instead of automatic resume");
  }
  if ([...restoredMarkers].some((marker) => marker.startsWith("unsafe-redaction|"))) {
    throw new Error("selected backup contains a deleted body that was not monotonically redacted");
  }
  const missing = [...requiredMarkers].filter((marker) => monotonicSafetyMarker(marker) && !restoredMarkers.has(marker));
  if (missing.length > 0) {
    throw new Error("selected backup would roll back deletion tombstones or Cloud AI revocation/deletion state");
  }
}

function sameMarkers(left, right) {
  const leftSafety = new Set([...left].filter(monotonicSafetyMarker));
  const rightSafety = new Set([...right].filter(monotonicSafetyMarker));
  return leftSafety.size === rightSafety.size && [...leftSafety].every((marker) => rightSafety.has(marker));
}

function monotonicSafetyMarker(marker) {
  return /^(material|report|decision|review|cloud|cloud-latest)\|/.test(marker);
}

function restoreSafetyMarkersSql() {
  return `/* research_restore_safety_markers */
    select marker from (
      select 'material|' || id || '|' || content_fingerprint || '|' || deleted_at::text as marker
        from research_materials where deleted_at is not null
      union all
      select 'report|' || id || '|' || coalesce(report_fingerprint, 'UNKNOWN') || '|' || deleted_at::text
        from deep_research_reports where deleted_at is not null
      union all
      select 'decision|' || id || '|' || deleted_at::text
        from pre_trade_decision_checks where deleted_at is not null
      union all
      select 'review|' || id || '|' || deleted_at::text
        from post_decision_reviews where deleted_at is not null
      union all
      select 'cloud|' || id || '|' || actor_type || '|' || actor_id || '|' || action || '|' || created_at::text
        from cloud_ai_provider_policy_events where action in ('disable', 'request_deletion')
      union all
      select 'cloud-latest|' || actor_type || '|' || actor_id || '|' || id || '|' || action || '|' || created_at::text
        from (
          select distinct on (actor_type, actor_id) id, actor_type, actor_id, action, created_at
            from cloud_ai_provider_policy_events
           order by actor_type, actor_id, created_at desc, id desc
        ) latest_policy where action in ('disable', 'request_deletion')
      union all
      select 'active-task|' || id || '|' || status
        from deep_research_tasks where status in ('pending', 'running', 'ready_to_absorb')
      union all
      select 'unsafe-redaction|' || material.id
        from research_materials material
       where material.deleted_at is not null and (
         exists (select 1 from research_evidence_packs pack
                  where redact_research_material_copies(pack.items, material.id::text, material.content_fingerprint) is distinct from pack.items)
         or exists (select 1 from research_evidence_packs pack
                     where pack.items @> jsonb_build_array(jsonb_build_object(
                       'id', material.id::text, 'contentFingerprint', material.content_fingerprint
                     )) and (pack.redaction_checksum is null
                       or pack.redaction_checksum <> research_evidence_pack_redaction_checksum(pack)))
         or exists (select 1 from deep_research_tasks task
                     where redact_research_material_copies(task.request_payload, material.id::text, material.content_fingerprint) is distinct from task.request_payload)
         or exists (select 1 from deep_research_reports report
                     where redact_research_material_copies(report.report_payload, material.id::text, material.content_fingerprint) is distinct from report.report_payload)
         or exists (select 1 from research_write_audit_events audit
                     where redact_research_material_copies(audit.before_payload, material.id::text, material.content_fingerprint) is distinct from audit.before_payload
                        or redact_research_material_copies(audit.after_payload, material.id::text, material.content_fingerprint) is distinct from audit.after_payload)
       )
    ) safety order by marker`;
}

async function validatedBackupSnapshot(snapshotPath) {
  const snapshotRoot = await externalDirectory(snapshotPath, "backup snapshot", false);
  const manifestBytes = await readRegularFile(snapshotRoot, join(snapshotRoot, "manifest.json"));
  const manifestHashLine = (await readRegularFile(
    snapshotRoot,
    join(snapshotRoot, "manifest.sha256")
  )).toString("utf8").trim();
  const manifestSha256 = sha256(manifestBytes);
  if (manifestHashLine !== `${manifestSha256}  manifest.json`) {
    throw new Error("backup manifest checksum does not match");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("backup manifest must be valid JSON");
  }
  validateBackupManifest(manifest, basename(snapshotRoot));
  return { snapshotRoot, manifestBytes, manifestSha256, manifest };
}

function validatedResearchDocumentReferences(stdout, rawStore, objectHashes) {
  const references = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (references.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("restored research_documents contains an invalid PDF hash");
  }
  if (references.length !== rawStore.databaseReferenceCount
    || references.some((hash) => !objectHashes.has(hash))) {
    throw new Error("restored database PDF references do not match the backup raw store");
  }
  return references;
}

function validateBackupManifest(manifest, directoryName) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.schemaVersion !== "2026-08-21.research-backup.v3"
    || !/^[0-9]{14}-[a-f0-9]{8}$/.test(manifest.snapshotId ?? "")
    || manifest.snapshotId !== directoryName
    || !/^[a-f0-9]{40}$/.test(manifest.commitSha ?? "")
    || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))
    || manifest.database?.format !== "postgresql_custom"
    || manifest.database?.file !== "research.pgcustom"
    || !/^[a-f0-9]{64}$/.test(manifest.database?.sha256 ?? "")
    || !Number.isSafeInteger(manifest.database?.bytes) || manifest.database.bytes < 1
    || manifest.database?.restoreArchiveListVerified !== true
    || manifest.database?.includesUnabsorbedAiOutput !== true
    || manifest.rawStore?.format !== "research_document_content_addressed_store"
    || manifest.rawStore?.root !== "raw-store"
    || !Array.isArray(manifest.rawStore?.objects)
    || !Number.isSafeInteger(manifest.rawStore?.objectCount)
    || manifest.rawStore.objectCount !== manifest.rawStore.objects.length
    || !Number.isSafeInteger(manifest.rawStore?.databaseReferenceCount)
    || manifest.rawStore.databaseReferenceCount < 0
    || manifest.rawStore.databaseReferencesVerified !== true
    || manifest.cloudSyncStatus !== "UNKNOWN"
    || manifest.safety?.sourceDatabase !== "loopback_local_only"
    || manifest.safety?.productionTouched !== false
    || manifest.safety?.brokerOrTradingMutation !== false
    || manifest.safety?.officialAssetMutation !== false) {
    throw new Error("backup manifest is not a supported fail-closed research backup");
  }
}

async function stageManifestRawStore(snapshotRoot, rawStore, stagingRoot) {
  const rawStorePath = join(snapshotRoot, rawStore.root);
  const rawStoreMetadata = await lstat(rawStorePath);
  if (rawStoreMetadata.isSymbolicLink() || !rawStoreMetadata.isDirectory()) {
    throw new Error("backup raw store root must be a regular directory, not a symlink");
  }
  const rawStoreRoot = await realpath(rawStorePath);
  if (!isWithin(snapshotRoot, rawStoreRoot)) throw new Error("backup raw store escapes the snapshot");
  const stagedRawStoreRoot = join(stagingRoot, rawStore.root);
  await mkdir(stagedRawStoreRoot, { mode: 0o700 });
  const expectedPaths = new Set();
  const hashes = new Set();
  let totalBytes = 0;
  for (const object of rawStore.objects) {
    if (!object || typeof object !== "object" || Array.isArray(object)
      || !/^[a-f0-9]{2}\/[a-f0-9]{64}$/.test(object.path ?? "")
      || !/^[a-f0-9]{64}$/.test(object.sha256 ?? "")
      || object.path !== `${object.sha256.slice(0, 2)}/${object.sha256}`
      || !Number.isSafeInteger(object.bytes) || object.bytes < 1
      || expectedPaths.has(object.path) || hashes.has(object.sha256)) {
      throw new Error("backup raw-store manifest contains an invalid object");
    }
    const bytes = await readCasObject(rawStoreRoot, join(rawStoreRoot, object.path));
    if (bytes.length !== object.bytes || sha256(bytes) !== object.sha256) {
      throw new Error(`backup raw-store object identity mismatch: ${object.path}`);
    }
    expectedPaths.add(object.path);
    hashes.add(object.sha256);
    totalBytes += object.bytes;
    const stagedPrefix = join(stagedRawStoreRoot, object.sha256.slice(0, 2));
    await mkdir(stagedPrefix, { recursive: true, mode: 0o700 });
    await durableWriteFile(join(stagedPrefix, object.sha256), bytes);
  }
  if (totalBytes !== rawStore.totalBytes) throw new Error("backup raw-store byte count does not match the manifest");
  const actualPaths = [];
  for (const prefix of await readdir(rawStoreRoot, { withFileTypes: true })) {
    if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) {
      throw new Error(`backup raw store contains a non-CAS entry: ${prefix.name}`);
    }
    for (const entry of await readdir(join(rawStoreRoot, prefix.name), { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error(`backup raw store contains a non-file object: ${prefix.name}/${entry.name}`);
      actualPaths.push(`${prefix.name}/${entry.name}`);
    }
  }
  if (actualPaths.length !== expectedPaths.size || actualPaths.some((path) => !expectedPaths.has(path))) {
    throw new Error("backup raw-store contents do not exactly match the manifest");
  }
  await syncDirectory(stagedRawStoreRoot);
  return hashes;
}

async function mergeStagedRawStoreIntoActive(stagingRoot, rawStore, activeRawStoreRoot) {
  const stagedRawStoreRoot = await realpath(join(stagingRoot, rawStore.root));
  let added = 0;
  for (const object of rawStore.objects) {
    const bytes = await readCasObject(stagedRawStoreRoot, join(stagedRawStoreRoot, object.path));
    const prefix = join(activeRawStoreRoot, object.sha256.slice(0, 2));
    await mkdir(prefix, { recursive: true, mode: 0o700 });
    const prefixMetadata = await lstat(prefix);
    if (prefixMetadata.isSymbolicLink() || !prefixMetadata.isDirectory()
      || !isWithin(activeRawStoreRoot, await realpath(prefix))) {
      throw new Error("active raw-store prefix is unsafe");
    }
    const destination = join(prefix, object.sha256);
    let existing = null;
    try {
      existing = await readCasObject(activeRawStoreRoot, destination);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (existing) {
      if (existing.length !== object.bytes || sha256(existing) !== object.sha256) {
        throw new Error(`active raw-store object identity mismatch: ${object.path}`);
      }
    } else {
      await durableWriteFile(destination, bytes);
      added += 1;
    }
    const readBack = await readCasObject(activeRawStoreRoot, destination);
    if (readBack.length !== object.bytes || sha256(readBack) !== object.sha256) {
      throw new Error(`active raw-store object readback mismatch: ${object.path}`);
    }
    await syncDirectory(prefix);
  }
  // ponytail: restore keeps old CAS objects; add garbage collection only when orphan bytes become material.
  await syncDirectory(activeRawStoreRoot);
  return added;
}

async function dumpDatabase(database, dumpPath, environment) {
  await runPostgresCommand("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file", dumpPath,
    database.name
  ], database, environment);
}

async function runPostgresCommand(command, args, database, environment, options = {}) {
  const inherited = Object.fromEntries(Object.entries(environment)
    .filter(([name]) => name !== "DATABASE_URL" && name !== "LOCAL_ALPHA_DATABASE_URL" && !name.startsWith("PG")));
  return execFileAsync(command, [
    "--host", database.host,
    "--port", database.port,
    ...(database.user ? ["--username", database.user] : []),
    ...args
  ], {
    cwd: repositoryRoot,
    env: { ...inherited, ...(database.password ? { PGPASSWORD: database.password } : {}) },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...(options.signal ? { signal: options.signal } : {})
  });
}

async function copyRawStore(sourceRoot, destinationRoot, referencedObjects) {
  const objects = [];
  await mkdir(destinationRoot, { mode: 0o700 });
  const prefixes = await readdir(sourceRoot, { withFileTypes: true });
  for (const prefix of prefixes.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) {
      throw new Error(`raw store contains a non-CAS entry: ${prefix.name}`);
    }
    const sourceDirectory = join(sourceRoot, prefix.name);
    const sourceDirectoryStat = await lstat(sourceDirectory);
    if (sourceDirectoryStat.isSymbolicLink() || !sourceDirectoryStat.isDirectory()
      || !isWithin(sourceRoot, await realpath(sourceDirectory))) {
      throw new Error(`raw store prefix is unsafe: ${prefix.name}`);
    }
    const destinationDirectory = join(destinationRoot, prefix.name);
    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name) || !entry.name.startsWith(prefix.name)) {
        throw new Error(`raw store contains an invalid CAS object: ${prefix.name}/${entry.name}`);
      }
      const bytes = await readCasObject(sourceRoot, join(sourceDirectory, entry.name));
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== entry.name) throw new Error(`raw store object hash mismatch: ${entry.name}`);
      await durableWriteFile(join(destinationDirectory, entry.name), bytes);
      objects.push({ path: `${prefix.name}/${entry.name}`, sha256: actualSha256, bytes: bytes.length });
    }
    await syncDirectory(destinationDirectory);
  }
  await syncDirectory(destinationRoot);
  const copiedHashes = new Set(objects.map((object) => object.sha256));
  const missingReferences = referencedObjects.filter((hash) => !copiedHashes.has(hash));
  if (missingReferences.length > 0) {
    throw new Error(`database references missing raw-store objects: ${missingReferences.join(", ")}`);
  }
  return {
    format: "research_document_content_addressed_store",
    root: "raw-store",
    objectCount: objects.length,
    databaseReferenceCount: referencedObjects.length,
    databaseReferencesVerified: true,
    totalBytes: objects.reduce((total, object) => total + object.bytes, 0),
    objects
  };
}

async function researchDocumentReferencesFromDump(dumpPath, database, environment, expected) {
  const restored = await runPostgresCommand(
    "pg_restore",
    ["--data-only", "--table=research_documents", "--file=-", dumpPath],
    database,
    environment
  );
  const references = new Set();
  let sectionCount = 0;
  const sections = restored.stdout.matchAll(
    /COPY\s+(?:"?[\w]+"?\.)?"?research_documents"?\s*\(([^)]+)\)\s+FROM stdin;\n([\s\S]*?)\\\.\n/g
  );
  for (const section of sections) {
    sectionCount += 1;
    const columns = section[1].split(",").map((column) => column.trim().replaceAll('"', ""));
    const hashIndex = columns.indexOf("pdf_sha256");
    if (hashIndex < 0) throw new Error("research_documents dump does not include pdf_sha256");
    for (const row of section[2].split("\n").filter(Boolean)) {
      const hash = row.split("\t")[hashIndex];
      if (!/^[a-f0-9]{64}$/.test(hash ?? "")) throw new Error("research_documents dump contains an invalid PDF hash");
      references.add(hash);
    }
  }
  if (expected && sectionCount === 0) {
    throw new Error("research_documents dump could not be parsed");
  }
  return [...references].sort();
}

async function durableWriteFile(path, contents) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readCasObject(root, path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || !isWithin(root, await realpath(path))) {
    throw new Error(`raw store object must be a contained regular file: ${relative(root, path)}`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error("raw store object changed while being read");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readRegularFile(root, path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || !isWithin(root, await realpath(path))) {
    throw new Error("backup file must be a contained regular file");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error("backup file changed while being read");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function externalDirectory(path, label, create) {
  if (!isAbsolute(path) || path.includes("\0")) throw new Error(`${label} must be an absolute path`);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await stat(path);
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory`);
  const resolved = await realpath(path);
  if (isWithin(repositoryRoot, resolved)) throw new Error(`${label} must be outside the repository`);
  return resolved;
}

function parseLocalDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("database URL must be a valid PostgreSQL URL");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || url.search || url.hash) {
    throw new Error("database URL must be a PostgreSQL URL without query parameters or fragments");
  }
  const host = url.hostname.toLowerCase();
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(host)) {
    throw new Error("research backup accepts loopback PostgreSQL only");
  }
  const port = url.port || "5432";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("database port is invalid");
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = url.username ? decodeURIComponent(url.username) : null;
  const password = url.password ? decodeURIComponent(url.password) : null;
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || user && !/^[a-zA-Z0-9._-]+$/.test(user)) {
    throw new Error("database name or user is unsafe");
  }
  return { host, port, name, user, password };
}

async function fileIdentity(path) {
  const bytes = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).then(async (handle) => {
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  });
  assert(bytes.length > 0, "PostgreSQL dump must not be empty");
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(parent, candidate) {
  const fromParent = relative(parent, candidate);
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function required(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} is required`);
  return value.trim();
}
