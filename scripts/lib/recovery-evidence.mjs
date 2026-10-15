import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function verifyRecoveryEvidence(manifest, expectedCommitSha) {
  const failures = [];
  const schemaVersion = manifest?.schemaVersion;
  const isRecoveryManifest = schemaVersion === "2026-07-12.recovery-evidence.v1";
  const isStagingExactHeadManifest = schemaVersion === "2026-07-14.staging-exact-head-evidence.v1";
  check("schema version", isRecoveryManifest || isStagingExactHeadManifest);
  check("evidence binds exact commit", isSha(expectedCommitSha) && manifest?.commitSha === expectedCommitSha);
  check("backup path is explicit", typeof manifest?.backup?.path === "string" && manifest.backup.path.length > 0);
  check("backup checksum is valid", isSha256(manifest?.backup?.sha256));
  if (typeof manifest?.backup?.path === "string" && isSha256(manifest?.backup?.sha256)) {
    try {
      check("backup checksum matches bytes", sha256File(manifest.backup.path) === manifest.backup.sha256);
    } catch {
      check("backup file is readable", false);
    }
  }
  check("restore rehearsal passed in isolation", manifest?.restore?.status === "passed" && manifest?.restore?.target === "isolated_non_production");
  check("rollback rehearsal passed in isolation", manifest?.rollback?.status === "passed" && manifest?.rollback?.target === "isolated_non_production");
  if (isStagingExactHeadManifest) {
    const runtimeIdentity = `exact-head-${expectedCommitSha}`;
    check(
      "staging runtime binds the exact commit",
      manifest?.runtime?.ociRevision === expectedCommitSha && manifest?.runtime?.identity === runtimeIdentity
    );
    check(
      "restore content matches the isolated source",
      isSha256(manifest?.database?.normalizedSchemaSha256)
        && isSha256(manifest?.database?.normalizedDataSha256)
        && manifest.restore?.normalizedSchemaSha256 === manifest.database.normalizedSchemaSha256
        && manifest.restore?.normalizedDataSha256 === manifest.database.normalizedDataSha256
    );
    check(
      "staging database remained read-only",
      manifest?.database?.defaultTransactionReadOnly === "on"
        && manifest?.database?.writeDenied === true
        && manifest?.database?.mutated === false
    );
    check(
      "restore rehearsal remained offline and cleaned up",
      manifest?.restore?.network === "none"
        && manifest?.restore?.temporaryContainerRemoved === true
        && manifest?.restore?.temporaryVolumeRemoved === true
    );
    check(
      "rollback and candidate runtimes are ready",
      isSha(manifest?.rollback?.rollbackRevision)
        && manifest.rollback.rollbackRevision !== expectedCommitSha
        && manifest?.rollback?.rollbackRuntimeReady === true
        && manifest?.rollback?.candidateRuntimeReady === true
    );
    check(
      "production was not touched",
      manifest?.database?.source === "isolated_non_production"
        && manifest?.runtime?.publicTrafficRoutedAtPreflight === false
        && manifest?.productionDatabaseTouched === false
        && manifest?.productionTrafficChangedDuringPreflight === false
        && manifest?.credentialsPrinted === false
    );
  } else {
    check(
      "rehearsals bind the same commit",
      manifest?.restore?.commitSha === expectedCommitSha && manifest?.rollback?.fromCommitSha === expectedCommitSha
    );
    check("production was not touched", manifest?.safety?.productionTouched === false);
  }
  return { ok: failures.length === 0, expectedCommitSha, failures };

  function check(id, ok) {
    if (!ok) failures.push(id);
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
