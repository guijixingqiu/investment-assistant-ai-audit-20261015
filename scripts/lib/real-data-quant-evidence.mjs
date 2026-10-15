import { isDeepStrictEqual } from "node:util";
import { isRealDataInheritanceSafePath } from "./stage-13-20-evidence.mjs";
import {
  buildRealDataQuantRunWitness,
  canonicalJsonBytes,
  REAL_DATA_QUANT_WITNESS_SCHEMA,
  sha256,
  validateRealDataQuantRunWitness
} from "./real-data-quant-witness.mjs";

export { canonicalJsonBytes, sha256 } from "./real-data-quant-witness.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ARTIFACT_PREFIX = "artifacts/stage-13-20/real-data-quant/";
const AUTHORITY = "research_only_historical_only";
export const FORMAL_ACCOUNTING_BINDING_SCHEMA = "2026-07-19.real-data-formal-accounting-binding.v1";
const FORMAL_ACCOUNTING_PRICE_BASIS = Object.freeze({
  execution: "unadjusted_open",
  feeNotional: "unadjusted_trade_gross",
  signal: "adjusted_qfq_close",
  valuation: "unadjusted_close"
});
const FORMAL_ACCOUNTING_MISSING_BLOCKERS = Object.freeze([
  "unadjusted_accounting_snapshot_missing",
  "corporate_action_coverage_missing",
  "execution_and_valuation_basis_unbound"
]);

export const REAL_DATA_QUANT_FILES = Object.freeze({
  historicalSource: "historical-source.json",
  snapshot: "snapshot.json",
  runWitness: "run-witness.json",
  proof: "proof.json",
  sourceSection: "source-section.json",
  inheritance: "inheritance.json",
  targetSection: "target-section.json"
});

export function buildRealDataQuantSourceBundle({
  sourceCommitSha,
  approvedInput,
  approvedInputBytes,
  freezeConfig,
  buildInputs,
  buildInputBytes,
  nodeVersion,
  run,
  outputDir,
  nonTradeableProbe
}) {
  assertSha(sourceCommitSha, "source commit");
  const normalizedOutputDir = normalizeOutputDir(outputDir);
  const rows = approvedRows(approvedInput, freezeConfig);
  validateApprovedSource({ approvedInput, approvedInputBytes, freezeConfig, rows });
  const requestedFormalAccounting = run?.formalAccounting ?? approvedInput.formalAccounting;
  requireCondition(isDeepStrictEqual(requestedFormalAccounting, approvedInput.formalAccounting),
    "formal accounting binding does not match the approved historical input");
  const formalAccounting = validateFormalAccountingBinding(requestedFormalAccounting, {
    expectedDataCutoff: freezeConfig.dataCutoff,
    expectedSignalSnapshot: {
      adjustmentMode: freezeConfig.adjustment,
      dataHash: run?.frozenManifest?.dataHash,
      path: freezeConfig.sourcePath,
      sha256: sha256(approvedInputBytes),
      snapshotId: run?.frozenManifest?.snapshotId
    },
    expectedTradingDates: [...new Set(rows.map((row) => row.date))],
    expectedUniverse: freezeConfig.universe,
    expectedUniverseVersion: universeVersion(freezeConfig, rows)
  });
  const derived = deriveRunAssertions({
    run,
    sourceCommitSha,
    freezeConfig,
    rows,
    approvedInputBytes,
    nonTradeableProbe
  });
  const paths = Object.fromEntries(Object.entries(REAL_DATA_QUANT_FILES)
    .slice(0, 5)
    .map(([key, file]) => [key, `${normalizedOutputDir}/${file}`]));

  const historicalSource = {
    schemaVersion: "2026-07-15.real-data-historical-source.v1",
    commitSha: sourceCommitSha,
    provenance: freezeConfig.sourceIdentity.provenance,
    authorizationId: freezeConfig.sourceIdentity.authorizationId,
    universeVersion: universeVersion(freezeConfig, rows),
    dataCutoff: freezeConfig.dataCutoff,
    adjustmentMode: freezeConfig.adjustment,
    dataHash: derived.dataHash,
    authority: AUTHORITY
  };
  const historicalSourceFile = artifactFile(paths.historicalSource, historicalSource);

  const snapshot = {
    schemaVersion: "2026-07-15.real-data-snapshot.v2",
    commitSha: sourceCommitSha,
    id: derived.snapshotId,
    dataHash: derived.dataHash,
    snapshotHash: derived.snapshotHash,
    sourceHash: sha256(approvedInputBytes),
    adjustmentMode: freezeConfig.adjustment,
    lotSize: freezeConfig.universe[0].lotSize,
    universe: structuredClone(run.frozenSnapshot.universe),
    bars: structuredClone(run.frozenSnapshot.bars),
    authority: AUTHORITY
  };
  const snapshotFile = artifactFile(paths.snapshot, snapshot);
  const runWitness = buildRealDataQuantRunWitness({
    sourceCommitSha,
    nodeVersion,
    buildInputs,
    approvedInputPath: freezeConfig.sourcePath,
    approvedInputSha256: sha256(approvedInputBytes),
    lotSize: freezeConfig.universe[0].lotSize,
    frozenManifest: run.frozenManifest,
    frozenSnapshot: run.frozenSnapshot,
    pipelineManifest: run.pipelineManifest,
    quantAudit: run.quantAudit,
    primary: {
      manifest: run.smokeManifest,
      signals: run.signals,
      orders: run.orders,
      trades: run.trades,
      ledger: run.ledger,
      nav: run.nav,
      accountingAudit: run.accountingAudit
    },
    sampleSplitManifest: run.sampleSplitManifest,
    failedExperiments: run.failedExperiments,
    probes: nonTradeableProbe,
    summary: run.summary,
    formalAccounting
  });
  const runWitnessFile = artifactFile(paths.runWitness, runWitness);
  const buildInputHash = sha256(canonicalJsonBytes(buildInputs));
  const claims = {
    source: {
      approved: true,
      fixture: false,
      provenance: historicalSource.provenance,
      authorizationId: historicalSource.authorizationId,
      universeVersion: historicalSource.universeVersion,
      dataCutoff: historicalSource.dataCutoff,
      adjustmentMode: historicalSource.adjustmentMode,
      artifacts: [historicalSourceFile.artifact]
    },
    snapshot: {
      id: snapshot.id,
      sha256: snapshotFile.artifact.sha256,
      artifacts: [snapshotFile.artifact]
    },
    runWitness: {
      schemaVersion: REAL_DATA_QUANT_WITNESS_SCHEMA,
      sha256: runWitnessFile.artifact.sha256,
      artifacts: [runWitnessFile.artifact]
    },
    sampleSplit: { frozenBeforeFinalTest: true, overlap: false },
    costs: { total: derived.totalCosts },
    formalAccounting: structuredClone(formalAccounting),
    concentration: { trade: "reported", security: "reported", month: "reported" },
    failedExperiments: derived.failedExperiments,
    fixturePerformanceClaimed: false
  };
  const proof = {
    schemaVersion: "2026-07-19.real-data-quant-proof.v3",
    commitSha: sourceCommitSha,
    authority: AUTHORITY,
    ...structuredClone(claims),
    pipeline: {
      buildInputHash,
      exitCode: 0,
      deterministicRerun: true,
      finalTestUsedForTuning: false,
      nextTradingDayExecution: true,
      sameBarFill: false,
      nonZeroCosts: true,
      boardLotRounding: true,
      suspensionZeroVolumeHandling: true,
      cashPositionReconciled: true
    }
  };
  const proofFile = artifactFile(paths.proof, proof);
  const sourceSection = {
    commitSha: sourceCommitSha,
    artifacts: [proofFile.artifact],
    ...structuredClone(claims)
  };
  const sourceSectionFile = artifactFile(paths.sourceSection, sourceSection);
  const files = [historicalSourceFile, snapshotFile, runWitnessFile, proofFile, sourceSectionFile];
  validateRealDataQuantSourceBundle({
    files,
    sourceSection,
    proof,
    historicalSource,
    snapshot,
    runWitness,
    sourceCommitSha,
    sourceFileBytes: (path) => buildInputBytes.get(path) ?? null
  });
  return { files, sourceSection, proof, historicalSource, snapshot, runWitness };
}

export function buildRealDataQuantTargetBundle({
  sourceSection,
  sourceSectionArtifact,
  sourceCommitSha,
  evidenceCommitSha,
  targetCommitSha,
  changedPaths,
  inheritancePath,
  targetSectionPath
}) {
  for (const [value, label] of [[sourceCommitSha, "source"], [evidenceCommitSha, "evidence"], [targetCommitSha, "target"]]) {
    assertSha(value, `${label} commit`);
  }
  if (new Set([sourceCommitSha, evidenceCommitSha, targetCommitSha]).size !== 3) {
    throw new Error("source, evidence, and target commits must be distinct");
  }
  validateSourceSectionShape(sourceSection, sourceCommitSha);
  validateArtifact(sourceSectionArtifact);
  const normalizedPaths = normalizeChangedPaths(changedPaths);
  const normalizedInheritancePath = normalizeArtifactPath(inheritancePath);
  const normalizedTargetSectionPath = normalizeArtifactPath(targetSectionPath);
  const protectedPaths = new Set([
    sourceSectionArtifact.path,
    ...sourceSection.artifacts.map((artifact) => artifact.path),
    ...sourceSection.source.artifacts.map((artifact) => artifact.path),
    ...sourceSection.snapshot.artifacts.map((artifact) => artifact.path),
    ...sourceSection.runWitness.artifacts.map((artifact) => artifact.path)
  ]);
  if (normalizedInheritancePath === normalizedTargetSectionPath
    || protectedPaths.has(normalizedInheritancePath)
    || protectedPaths.has(normalizedTargetSectionPath)) {
    throw new Error("target outputs must be distinct and must not overwrite committed source evidence");
  }
  const inheritance = {
    schemaVersion: "2026-07-15.real-data-quant-inheritance.v2",
    commitSha: targetCommitSha,
    sourceCommitSha,
    evidenceCommitSha,
    sourceSectionPath: sourceSectionArtifact.path,
    sourceSectionSha256: sourceSectionArtifact.sha256,
    changedPaths: normalizedPaths,
    contentHashesReverified: true,
    currentQuantPipelinesPassed: true,
    approvedHistoricalInputChanged: false,
    fixturePerformanceClaimed: false,
    authority: AUTHORITY,
    reason: "fresh exact-byte S-R-T replay from owner-approved Pingan historical-only research data"
  };
  const inheritanceFile = artifactFile(normalizedInheritancePath, inheritance);
  const targetSection = {
    ...structuredClone(sourceSection),
    commitSha: targetCommitSha,
    artifacts: [inheritanceFile.artifact, ...sourceSection.artifacts],
    inheritance
  };
  const targetSectionFile = artifactFile(normalizedTargetSectionPath, targetSection);
  return { inheritance, inheritanceFile, targetSection, targetSectionFile };
}

export function validateRealDataQuantSourceBundle({
  files,
  sourceSection,
  proof,
  historicalSource,
  snapshot,
  runWitness,
  sourceCommitSha,
  sourceFileBytes
}) {
  if (!Array.isArray(files) || files.length !== 5) throw new Error("source bundle must contain exactly five files");
  for (const file of files) {
    validateArtifact(file?.artifact);
    if (!Buffer.isBuffer(file?.bytes)
      || sha256(file.bytes) !== file.artifact.sha256
      || !canonicalJsonBytes(file.value).equals(file.bytes)) {
      throw new Error(`source bundle artifact hash mismatch: ${file?.artifact?.path ?? "unknown"}`);
    }
  }
  validateSourceSectionShape(sourceSection, sourceCommitSha);
  strictKeys(historicalSource, ["adjustmentMode", "authority", "authorizationId", "commitSha", "dataCutoff", "dataHash", "provenance", "schemaVersion", "universeVersion"], "historical source");
  strictKeys(snapshot, ["adjustmentMode", "authority", "bars", "commitSha", "dataHash", "id", "lotSize", "schemaVersion", "snapshotHash", "sourceHash", "universe"], "snapshot");
  strictKeys(proof, ["authority", "commitSha", "concentration", "costs", "failedExperiments", "fixturePerformanceClaimed", "formalAccounting", "pipeline", "runWitness", "sampleSplit", "schemaVersion", "snapshot", "source"], "proof");
  strictKeys(proof.pipeline, ["boardLotRounding", "buildInputHash", "cashPositionReconciled", "deterministicRerun", "exitCode", "finalTestUsedForTuning", "nextTradingDayExecution", "nonZeroCosts", "sameBarFill", "suspensionZeroVolumeHandling"], "proof pipeline");
  strictKeys(proof.source, ["adjustmentMode", "approved", "artifacts", "authorizationId", "dataCutoff", "fixture", "provenance", "universeVersion"], "proof source");
  strictKeys(proof.snapshot, ["artifacts", "id", "sha256"], "proof snapshot");
  strictKeys(proof.runWitness, ["artifacts", "schemaVersion", "sha256"], "proof run witness");
  strictKeys(proof.sampleSplit, ["frozenBeforeFinalTest", "overlap"], "proof sample split");
  strictKeys(proof.costs, ["total"], "proof costs");
  strictKeys(proof.concentration, ["month", "security", "trade"], "proof concentration");
  if (historicalSource.schemaVersion !== "2026-07-15.real-data-historical-source.v1"
    || snapshot.schemaVersion !== "2026-07-15.real-data-snapshot.v2"
    || proof.schemaVersion !== "2026-07-19.real-data-quant-proof.v3"
    || historicalSource.commitSha !== sourceCommitSha
    || snapshot.commitSha !== sourceCommitSha
    || proof.commitSha !== sourceCommitSha
    || historicalSource.authority !== AUTHORITY
    || snapshot.authority !== AUTHORITY
    || proof.authority !== AUTHORITY
    || snapshot.dataHash !== historicalSource.dataHash
    || !isDeepStrictEqual(proof.source.artifacts, [files[0].artifact])
    || !isDeepStrictEqual(proof.snapshot.artifacts, [files[1].artifact])
    || !isDeepStrictEqual(proof.runWitness.artifacts, [files[2].artifact])
    || !isDeepStrictEqual(sourceSection.artifacts, [files[3].artifact])
    || !isDeepStrictEqual(proof.source, sourceSection.source)
    || !isDeepStrictEqual(proof.snapshot, sourceSection.snapshot)
    || !isDeepStrictEqual(proof.runWitness, sourceSection.runWitness)
    || !isDeepStrictEqual(proof.formalAccounting, sourceSection.formalAccounting)
    || !isDeepStrictEqual(proof.formalAccounting, runWitness.formalAccounting)) {
    throw new Error("source bundle does not satisfy the strict Stage 19 contract");
  }
  const derived = validateRealDataQuantRunWitness({
    witness: runWitness,
    witnessBytes: files[2].bytes,
    sourceCommitSha,
    historicalSource,
    snapshot,
    sourceFileBytes
  });
  const expectedPipeline = {
    exitCode: 0,
    deterministicRerun: true,
    finalTestUsedForTuning: false,
    nextTradingDayExecution: true,
    sameBarFill: false,
    nonZeroCosts: true,
    boardLotRounding: true,
    suspensionZeroVolumeHandling: true,
    cashPositionReconciled: true
  };
  if (proof.pipeline.buildInputHash !== derived.buildInputHash
    || !Object.entries(expectedPipeline).every(([key, value]) => proof.pipeline[key] === value)
    || proof.source.approved !== true || proof.source.fixture !== false
    || proof.source.provenance !== historicalSource.provenance
    || proof.source.authorizationId !== historicalSource.authorizationId
    || proof.source.universeVersion !== historicalSource.universeVersion
    || proof.source.dataCutoff !== historicalSource.dataCutoff
    || proof.source.adjustmentMode !== historicalSource.adjustmentMode
    || proof.snapshot.id !== snapshot.id
    || proof.snapshot.sha256 !== files[1].artifact.sha256
    || proof.runWitness.schemaVersion !== REAL_DATA_QUANT_WITNESS_SCHEMA
    || proof.runWitness.sha256 !== files[2].artifact.sha256
    || proof.sampleSplit.frozenBeforeFinalTest !== true || proof.sampleSplit.overlap !== false
    || !Number.isFinite(proof.costs.total) || proof.costs.total <= 0
    || validateFormalAccountingBinding(proof.formalAccounting, {
      expectedDataCutoff: historicalSource.dataCutoff,
      expectedSignalSnapshot: {
        adjustmentMode: snapshot.adjustmentMode,
        dataHash: snapshot.dataHash,
        path: proof.formalAccounting?.signalSnapshot?.path,
        sha256: snapshot.sourceHash,
        snapshotId: snapshot.id
      },
      expectedTradingDates: [...new Set(snapshot.bars.map((bar) => bar.tradeDate))],
      expectedUniverse: snapshot.universe,
      expectedUniverseVersion: historicalSource.universeVersion
    }) !== proof.formalAccounting
    || derived.accountingSnapshotId !== proof.formalAccounting.accountingSnapshot.snapshotId
    || derived.accountingDataHash !== proof.formalAccounting.accountingSnapshot.dataHash
    || derived.corporateActionLedgerId !== proof.formalAccounting.corporateActionCoverage.ledgerId
    || derived.corporateActionLedgerHash !== proof.formalAccounting.corporateActionCoverage.ledgerHash
    || !["trade", "security", "month"].every((key) => proof.concentration[key] === "reported")
    || proof.failedExperiments !== derived.failedExperimentCount
    || proof.fixturePerformanceClaimed !== false) {
    throw new Error("source bundle proof assertions are inconsistent");
  }
  return true;
}

export function validateFormalAccountingBinding(formalAccounting, {
  expectedDataCutoff,
  expectedSignalSnapshot,
  expectedTradingDates,
  expectedUniverse,
  expectedUniverseVersion
} = {}) {
  requireCondition(formalAccounting && typeof formalAccounting === "object",
    `formal accounting evidence is blocked: ${FORMAL_ACCOUNTING_MISSING_BLOCKERS.join(",")}`);
  strictKeys(formalAccounting, [
    "accountingSnapshot",
    "blockers",
    "corporateActionCoverage",
    "priceBasis",
    "schemaVersion",
    "signalSnapshot",
    "status"
  ], "formal accounting binding");
  requireCondition(formalAccounting.schemaVersion === FORMAL_ACCOUNTING_BINDING_SCHEMA,
    "formal accounting binding schema is invalid");
  requireCondition(formalAccounting.status === "verified",
    `formal accounting evidence is blocked: ${Array.isArray(formalAccounting.blockers)
      ? formalAccounting.blockers.join(",")
      : "invalid_blockers"}`);
  requireCondition(Array.isArray(formalAccounting.blockers) && formalAccounting.blockers.length === 0,
    "verified formal accounting binding cannot retain blockers");

  const signal = formalAccounting.signalSnapshot;
  strictKeys(signal, ["adjustmentMode", "dataHash", "path", "sha256", "snapshotId"],
    "formal accounting signal snapshot");
  requireCondition(signal.adjustmentMode === "forward"
    && validSourceIdentityPath(signal.path)
    && SHA256_PATTERN.test(signal.sha256 ?? "")
    && SHA256_PATTERN.test(signal.dataHash ?? "")
    && nonPlaceholderIdentity(signal.snapshotId),
  "formal accounting signal snapshot must identify the adjusted QFQ research input");

  const accounting = formalAccounting.accountingSnapshot;
  strictKeys(accounting, [
    "adjustmentMode",
    "authorizationId",
    "dataCutoff",
    "dataHash",
    "dateRange",
    "path",
    "sha256",
    "snapshotId",
    "universeVersion"
  ], "formal accounting unadjusted snapshot");
  requireCondition(accounting.adjustmentMode === "none"
    && validApprovedDataPath(accounting.path)
    && SHA256_PATTERN.test(accounting.sha256 ?? "")
    && SHA256_PATTERN.test(accounting.dataHash ?? "")
    && nonPlaceholderIdentity(accounting.snapshotId)
    && nonPlaceholderIdentity(accounting.authorizationId)
    && nonPlaceholderIdentity(accounting.universeVersion)
    && validTimestampValue(accounting.dataCutoff)
    && validClosedDateRange(accounting.dateRange),
  "formal accounting requires an independently identified unadjusted accounting snapshot");

  const corporateActions = formalAccounting.corporateActionCoverage;
  strictKeys(corporateActions, [
    "authorizationId",
    "coverage",
    "dataCutoff",
    "ledgerHash",
    "ledgerId",
    "path",
    "sha256",
    "universeVersion"
  ], "formal accounting corporate-action ledger");
  strictKeys(corporateActions.coverage, [
    "complete",
    "coveredTradingDates",
    "dateRange",
    "eventCount",
    "universe",
    "zeroEventCoverageDeclared"
  ], "formal accounting corporate-action coverage");
  const coveredDates = corporateActions.coverage.coveredTradingDates;
  requireCondition(validApprovedDataPath(corporateActions.path)
    && SHA256_PATTERN.test(corporateActions.sha256 ?? "")
    && SHA256_PATTERN.test(corporateActions.ledgerHash ?? "")
    && nonPlaceholderIdentity(corporateActions.ledgerId)
    && nonPlaceholderIdentity(corporateActions.authorizationId)
    && nonPlaceholderIdentity(corporateActions.universeVersion)
    && validTimestampValue(corporateActions.dataCutoff)
    && corporateActions.coverage.complete === true
    && validClosedDateRange(corporateActions.coverage.dateRange)
    && validUniverse(corporateActions.coverage.universe)
    && validCoveredTradingDates(coveredDates, corporateActions.coverage.dateRange)
    && Number.isSafeInteger(corporateActions.coverage.eventCount)
    && corporateActions.coverage.eventCount >= 0
    && corporateActions.coverage.zeroEventCoverageDeclared
      === (corporateActions.coverage.eventCount === 0),
  "formal accounting requires a complete corporate-action coverage ledger");

  strictKeys(formalAccounting.priceBasis, ["execution", "feeNotional", "signal", "valuation"],
    "formal accounting price basis");
  requireCondition(isDeepStrictEqual(formalAccounting.priceBasis, FORMAL_ACCOUNTING_PRICE_BASIS),
    "formal accounting price roles must separate QFQ signals from unadjusted execution and valuation");
  requireCondition(signal.path !== accounting.path
    && signal.sha256 !== accounting.sha256
    && signal.snapshotId !== accounting.snapshotId
    && signal.dataHash !== accounting.dataHash
    && accounting.path !== corporateActions.path,
  "formal accounting signal, accounting snapshot, and corporate-action ledger identities must be independent");
  requireCondition(accounting.authorizationId !== signal.snapshotId
    && corporateActions.authorizationId !== signal.snapshotId,
  "formal accounting authorization identities are invalid");
  requireCondition(accounting.universeVersion === corporateActions.universeVersion
    && accounting.dataCutoff === corporateActions.dataCutoff
    && isDeepStrictEqual(accounting.dateRange, corporateActions.coverage.dateRange),
  "formal accounting snapshot and corporate-action coverage identity mismatch");

  if (expectedSignalSnapshot !== undefined) {
    strictKeys(expectedSignalSnapshot, ["adjustmentMode", "dataHash", "path", "sha256", "snapshotId"],
      "expected formal accounting signal snapshot");
    requireCondition(isDeepStrictEqual(signal, expectedSignalSnapshot),
      "formal accounting signal snapshot does not match the research snapshot");
  }
  if (expectedUniverse !== undefined) {
    requireCondition(validUniverse(expectedUniverse)
      && isDeepStrictEqual(corporateActions.coverage.universe, expectedUniverse),
    "formal accounting corporate-action universe does not match the research snapshot");
  }
  if (expectedTradingDates !== undefined) {
    requireCondition(validCoveredTradingDates(expectedTradingDates, accounting.dateRange)
      && isDeepStrictEqual(coveredDates, expectedTradingDates),
    "formal accounting corporate-action dates do not cover the research and accounting snapshots");
  }
  if (expectedUniverseVersion !== undefined) {
    requireCondition(nonPlaceholderIdentity(expectedUniverseVersion)
      && accounting.universeVersion === expectedUniverseVersion,
    "formal accounting universe version does not match the research source");
  }
  if (expectedDataCutoff !== undefined) {
    requireCondition(validTimestampValue(expectedDataCutoff)
      && accounting.dataCutoff === expectedDataCutoff,
    "formal accounting data cutoff does not match the research source");
  }
  return formalAccounting;
}

function validSourceIdentityPath(path) {
  return typeof path === "string"
    && path.length > 0
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").includes("..");
}

function validApprovedDataPath(path) {
  return validSourceIdentityPath(path) && path.startsWith("data/quant-approved/");
}

function nonPlaceholderIdentity(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && !/^(unknown|missing|none|n\/?a|not[_ -]?available|unavailable|placeholder|example)$/i.test(value.trim());
}

function validTimestampValue(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function validClosedDateRange(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), ["end", "start"])
    && validDate(value.start)
    && validDate(value.end)
    && value.start <= value.end;
}

function validUniverse(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const symbols = new Set();
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || !isDeepStrictEqual(Object.keys(entry).sort(), ["code", "lotSize", "market", "name", "symbol"])
      || !nonPlaceholderIdentity(entry.market)
      || !nonPlaceholderIdentity(entry.code)
      || !nonPlaceholderIdentity(entry.symbol)
      || !nonPlaceholderIdentity(entry.name)
      || !Number.isSafeInteger(entry.lotSize)
      || entry.lotSize <= 0
      || symbols.has(entry.symbol)) return false;
    symbols.add(entry.symbol);
    return true;
  });
}

function validCoveredTradingDates(value, dateRange) {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length
    || !value.every(validDate)) return false;
  const sorted = [...value].sort();
  return isDeepStrictEqual(value, sorted)
    && value[0] === dateRange.start
    && value.at(-1) === dateRange.end;
}

function deriveRunAssertions({ run, sourceCommitSha, freezeConfig, rows, approvedInputBytes, nonTradeableProbe }) {
  const { frozenManifest, frozenSnapshot, pipelineManifest, smokeManifest, sampleSplitManifest, summary, trades } = run ?? {};
  requireCondition(frozenManifest?.schemaVersion === "2026-07-09.quant-freeze-manifest.v2", "frozen manifest schema is invalid");
  requireCondition(frozenManifest.rows === rows.length, "frozen manifest row count does not match approved input");
  requireCondition(frozenManifest.adjustment === freezeConfig.adjustment, "frozen adjustment does not match configuration");
  requireCondition(frozenManifest.dataCutoff === freezeConfig.dataCutoff
    && isDeepStrictEqual(frozenManifest.dateRange, freezeConfig.dateRange),
  "frozen cutoff or date range drifted from configuration");
  requireCondition(frozenManifest.sourceClassification === "approved_real_historical", "frozen source is not approved historical data");
  requireCondition(frozenManifest.sourceIdentity?.authorizationId === freezeConfig.sourceIdentity.authorizationId, "frozen authorization drifted");
  requireCondition(frozenManifest.sourcePath === freezeConfig.sourcePath
    && frozenManifest.sourceIdentity?.sourcePath === freezeConfig.sourcePath
    && frozenManifest.sourceHash === sha256(approvedInputBytes)
    && frozenManifest.sourceIdentity?.sourceHash === frozenManifest.sourceHash,
  "frozen source path or bytes drifted from the tracked approved input");
  requireCondition(isDeepStrictEqual(approvedRows(frozenSnapshot, freezeConfig), rows), "frozen snapshot rows drifted from approved input");
  requireCondition(pipelineManifest?.schemaVersion === "2026-06-20.quant-pipeline.run.v1"
    && pipelineManifest.ok === true
    && pipelineManifest.goNoGo === "quant_pipeline_passed"
    && pipelineManifest.linkage?.smokeUsesFrozenSnapshot === true
    && pipelineManifest.linkage?.dataHashesMatch === true
    && pipelineManifest.linkage?.frozenDataHash === frozenManifest.dataHash
    && pipelineManifest.linkage?.smokeDataHash === frozenManifest.dataHash,
  "quant pipeline did not pass with frozen data linkage");
  requireOfflineSafety(pipelineManifest.safety, "pipeline");
  requireCondition(smokeManifest?.schemaVersion === "2026-06-20.quant-smoke.run.v1"
    && smokeManifest.commit === sourceCommitSha
    && smokeManifest.snapshotId === frozenManifest.snapshotId
    && smokeManifest.dataHash === frozenManifest.dataHash,
  "smoke manifest is not bound to the source commit and snapshot");
  requireOfflineSafety(smokeManifest.safety, "smoke");
  const audit = pipelineManifest.steps?.audit;
  const rerun = audit?.checks?.find((check) => check.id === "rerun core result hashes match");
  requireCondition(audit?.ok === true && rerun?.ok === true && rerun.evidence?.ok === true
    && Array.isArray(rerun.evidence.mismatches) && rerun.evidence.mismatches.length === 0
    && isDeepStrictEqual(rerun.evidence.before, rerun.evidence.after),
  "deterministic pipeline rerun evidence is missing or mismatched");
  const requiredAuditChecks = [
    "orders are next-day or later", "trades are next-day or later", "no same-bar executions",
    "fees are nonzero", "lot rounding is valid", "cash never negative", "nav final equity matches manifest"
  ];
  requireCondition(requiredAuditChecks.every((id) => audit.checks.some((check) => check.id === id && check.ok === true)),
    "pipeline accounting audit is incomplete");
  requireCondition(sampleSplitManifest?.schemaVersion === "2026-07-10.quant-sample-split-baseline.run.v2"
    && sampleSplitManifest.ok === true
    && sampleSplitManifest.codeIdentity?.commit === sourceCommitSha
    && sampleSplitManifest.failureReport?.ok === true
    && sampleSplitManifest.failureReport?.hiddenFailures === false
    && sampleSplitManifest.failureReport?.finalTestTuning === false,
  "sample-split run did not pass at the source commit");
  requireCondition(sampleSplitManifest.dataIdentity?.snapshotId === frozenManifest.snapshotId
    && sampleSplitManifest.dataIdentity?.dataHash === frozenManifest.dataHash
    && sampleSplitManifest.dataIdentity?.dataCutoff === frozenManifest.dataCutoff
    && sampleSplitManifest.dataIdentity?.sourceClassification === "approved_real_historical"
    && sampleSplitManifest.dataIdentity?.sourceIdentity?.authorizationId === freezeConfig.sourceIdentity.authorizationId,
  "sample-split data identity drifted from the frozen approved source");
  requireOfflineSafety(sampleSplitManifest.safety, "sample split");
  const splits = sampleSplitManifest.splitRegistry?.splits;
  requireCondition(validFrozenSplits(splits, sampleSplitManifest.parameterPolicy), "sample splits are not frozen and non-overlapping");
  const accounting = Object.values(sampleSplitManifest.accountingAudit ?? {});
  requireCondition(accounting.length === 3 && accounting.every((item) => item?.ok === true
    && item.cashNeverNegative === true
    && item.allOrdersNextDayOrLater === true
    && item.allTradesNextDayOrLater === true
    && item.boardLotRounded === true
    && item.nonzeroFeesWhenTraded === true
    && item.noTradesOnNonTradeableBars === true
    && item.noImplicitLeverage === true),
  "sample-split accounting assertions did not all pass");
  requireCondition(Array.isArray(trades) && trades.length > 0 && trades.every((trade) => trade.sameBarExecution === false
    && trade.signalDate < trade.tradeDate
    && Number.isInteger(trade.quantity) && trade.quantity > 0
    && trade.quantity % freezeConfig.universe[0].lotSize === 0
    && Number.isFinite(trade.totalFees) && trade.totalFees > 0),
  "primary trades do not prove next-day execution and non-zero costs");
  requireCondition(nonTradeableProbe?.zeroVolume?.run?.orders?.[0]?.reason === "zero_or_missing_volume"
    && nonTradeableProbe.zeroVolume.run.trades?.length === 0
    && nonTradeableProbe?.suspended?.run?.orders?.[0]?.reason === "suspended_bar"
    && nonTradeableProbe.suspended.run.trades?.length === 0,
    "explicit zero-volume and suspension probes did not reject fills");
  requireCondition(summary?.schemaVersion === "2026-07-19.real-data-quant-summary.v2"
    && summary.snapshotId === frozenManifest.snapshotId
    && typeof summary.source === "string" && summary.source.toLowerCase().includes("pingan")
    && summary.fixturePerformanceClaimed === false
    && summary.finalTestRetuned === false
    && summary.advisoryOnly === true
    && summary.researchBoundary?.adjustmentMode === "forward"
    && summary.researchBoundary?.priceBasis === "adjusted_qfq_close"
    && summary.researchBoundary?.role === "signal_generation_only"
    && summary.researchBoundary?.formalPerformanceAuthority === false
    && summary.corporateActions?.status === "formal_accounting_replayed"
    && summary.corporateActions?.accountingSnapshotId === run.formalAccounting?.accountingSnapshot?.snapshotId
    && summary.corporateActions?.corporateActionLedgerId === run.formalAccounting?.corporateActionCoverage?.ledgerId
    && summary.corporateActions?.signalPriceBasis === "adjusted_qfq_close"
    && summary.corporateActions?.executionPriceBasis === "unadjusted_open"
    && summary.corporateActions?.valuationPriceBasis === "unadjusted_close"
    && summary.corporateActions?.feeNotionalBasis === "unadjusted_trade_gross"
    && summary.corporateActions?.simulatedResearchOnly === true
    && summary.corporateActions?.officialFactsMutated === false
    && isDeepStrictEqual(summary.formalAccounting, run.formalAccounting)
    && ["trade", "security", "month"].every((key) => summary.concentration?.[key]?.reported === true)
    && Number.isInteger(summary.failedExperimentCount) && summary.failedExperimentCount > 0
    && summary.failedExperimentCount === summary.failedExperiments?.filter((item) => item.rejected === true).length
    && summary.failedExperiments.every((item) => item.rejected === item.expectedRejected && item.tuningImpact === "none_final_test_remained_locked"),
  "summary does not prove concentration, corporate actions, and retained failed experiments");
  const totalCosts = Object.values(sampleSplitManifest.metrics ?? {})
    .reduce((sum, metrics) => sum + Math.round(Number(metrics?.totalFees ?? 0) * 100), 0) / 100;
  requireCondition(Number.isFinite(totalCosts) && totalCosts > 0, "sample-split costs must be non-zero");
  return {
    snapshotId: frozenManifest.snapshotId,
    snapshotHash: frozenManifest.snapshotHash,
    dataHash: frozenManifest.dataHash,
    totalCosts,
    failedExperiments: summary.failedExperimentCount
  };
}

function validateApprovedSource({ approvedInput, approvedInputBytes, freezeConfig, rows }) {
  requireCondition(Buffer.isBuffer(approvedInputBytes), "approved input bytes are required");
  let parsedInput;
  try {
    parsedInput = JSON.parse(approvedInputBytes.toString("utf8"));
  } catch {
    throw new Error("approved input bytes must contain valid JSON");
  }
  requireCondition(isDeepStrictEqual(parsedInput, approvedInput), "approved input object differs from its governed bytes");
  requireCondition(approvedInput?.schemaVersion === "2026-07-12.pingan-real-history.v1"
    && approvedInput.sourceClass === "owner_approved_historical_only"
    && approvedInput.fixture === false
    && approvedInput.authorizationId === freezeConfig?.sourceIdentity?.authorizationId
    && approvedInput.adjustment === freezeConfig.adjustment
    && approvedInput.dataCutoff === freezeConfig.dataCutoff,
  "input is not the approved Pingan historical-only source");
  const identity = `${freezeConfig.sourceIdentity?.provenance ?? ""} ${freezeConfig.sourceIdentity?.authorizationId ?? ""}`.toLowerCase();
  requireCondition(freezeConfig?.schemaVersion === "2026-06-20.quant-freeze-snapshot.v1"
    && typeof freezeConfig.sourcePath === "string"
    && freezeConfig.sourcePath.startsWith("data/quant-approved/")
    && !freezeConfig.sourcePath.startsWith("/")
    && !freezeConfig.sourcePath.includes("\\")
    && !freezeConfig.sourcePath.split("/").includes("..")
    && freezeConfig.sourceIdentity?.classification === "approved_real_historical"
    && freezeConfig.sourceIdentity?.authority === "research_only"
    && Array.isArray(freezeConfig.universe) && freezeConfig.universe.length === 1
    && freezeConfig.universe[0]?.market === "HK" && freezeConfig.universe[0]?.symbol === "HK.09926"
    && Array.isArray(approvedInput.universe) && approvedInput.universe.length === 1
    && approvedInput.universe[0]?.market === freezeConfig.universe[0].market
    && approvedInput.universe[0]?.code === freezeConfig.universe[0].code
    && approvedInput.universe[0]?.symbol === freezeConfig.universe[0].symbol
    && Number.isSafeInteger(approvedInput.universe[0]?.lotSize)
    && approvedInput.universe[0].lotSize === 100
    && Number.isSafeInteger(freezeConfig.universe[0]?.lotSize)
    && freezeConfig.universe[0].lotSize === approvedInput.universe[0].lotSize
    && approvedInput.corporateActionPolicy?.researchPrices === "futu_AuType_QFQ"
    && approvedInput.corporateActionPolicy?.accountingAuthority === false
    && approvedInput.corporateActionPolicy?.cashDividendAccounting === false
    && approvedInput.corporateActionPolicy?.positionMutation === false
    && Number.isFinite(Date.parse(freezeConfig.dataCutoff))
    && Date.parse(freezeConfig.dataCutoff) <= Date.now()
    && identity.includes("pingan") && /histor(?:y|ical)/.test(identity)
    && !/(?:live|broker|official|current[_ -]?(?:holdings?|portfolio)|account[_ -]?truth)/.test(identity),
  "freeze configuration does not preserve historical-only authority");
  requireCondition(rows.length > 0
    && rows[0].date === freezeConfig.dateRange?.start
    && rows.at(-1).date === freezeConfig.dateRange?.end,
  "approved rows do not match the governed date range");
}

function approvedRows(input, freezeConfig) {
  const bars = input?.bars;
  if (!Array.isArray(bars) || bars.length === 0) throw new Error("approved historical bars are required");
  const expectedSymbol = freezeConfig?.universe?.[0]?.symbol;
  const seen = new Set();
  let previous = "";
  return bars.map((bar) => {
    const symbol = `${bar?.market}.${bar?.code}`;
    const date = bar?.tradeDate;
    if (symbol !== expectedSymbol || !validDate(date) || date < previous || seen.has(`${symbol}\0${date}`)
      || Date.parse(`${date}T00:00:00.000Z`) > Date.parse(freezeConfig.dataCutoff)
      || !Number.isFinite(Number(bar?.close)) || Number(bar.close) <= 0
      || !Number.isFinite(Number(bar?.volume)) || Number(bar.volume) < 0) {
      throw new Error("approved historical bars contain invalid, duplicate, future, or unsorted rows");
    }
    previous = date;
    seen.add(`${symbol}\0${date}`);
    return { close: Number(bar.close), date, symbol, volume: Number(bar.volume) };
  });
}

function validFrozenSplits(splits, policy) {
  if (!Array.isArray(splits) || splits.length !== 3) return false;
  const expected = ["train", "validation", "final_test"];
  if (!isDeepStrictEqual(splits.map((split) => split.id), expected)
    || policy?.finalTestUsedForParameterSelection !== false
    || policy?.finalTestUsedForAcceptanceThresholdFitting !== false
    || policy?.finalTestRole !== "locked_report_only"
    || policy?.allowedSelectionSplits?.includes("final_test")) return false;
  for (let index = 0; index < splits.length; index += 1) {
    const split = splits[index];
    if (!validDate(split.start) || !validDate(split.end) || split.start > split.end) return false;
    if (index > 0 && splits[index - 1].end >= split.start) return false;
  }
  const finalTest = splits[2];
  return finalTest.finalTestLocked === true && finalTest.parameterSelectionAllowed === false;
}

function requireOfflineSafety(safety, label) {
  requireCondition(safety?.sendsLiveNetworkRequests === false
    && safety?.writesProductionDatabase === false
    && safety?.enablesTrading === false
    && safety?.touchesRealTradesPositionsReviews !== true
    && safety?.mutatesOfficialPortfolio !== true
    && safety?.mutatesOfficialReview !== true,
  `${label} safety boundary is not offline and advisory-only`);
}

function validateSourceSectionShape(section, sourceCommitSha) {
  strictKeys(section, ["artifacts", "commitSha", "concentration", "costs", "failedExperiments", "fixturePerformanceClaimed", "formalAccounting", "runWitness", "sampleSplit", "snapshot", "source"], "source section");
  if (section.commitSha !== sourceCommitSha || !Array.isArray(section.artifacts) || section.artifacts.length !== 1) {
    throw new Error("source section is not bound to its source commit and proof");
  }
  validateArtifact(section.artifacts[0]);
}

function normalizeChangedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("S-R-T history must change at least one path");
  const normalized = [...new Set(paths)].sort();
  if (normalized.length !== paths.length || !normalized.every(isRealDataInheritanceSafePath)) {
    throw new Error("S-R-T history contains duplicate or unsafe changed paths");
  }
  return normalized;
}

function artifactFile(path, value) {
  const bytes = canonicalJsonBytes(value);
  return { path, value, bytes, artifact: { path, sha256: sha256(bytes) } };
}

function validateArtifact(artifact) {
  normalizeArtifactPath(artifact?.path);
  if (!SHA256_PATTERN.test(artifact?.sha256 ?? "")) throw new Error("artifact SHA-256 is invalid");
}

function normalizeOutputDir(path) {
  const normalized = normalizeArtifactPath(`${String(path ?? "").replace(/\/$/, "")}/placeholder.json`);
  return normalized.slice(0, -"/placeholder.json".length);
}

function normalizeArtifactPath(path) {
  if (typeof path !== "string" || !path.startsWith(ARTIFACT_PREFIX) || path.startsWith("/")
    || path.includes("\\") || path.split("/").includes("..") || path.endsWith("/")) {
    throw new Error(`Stage 19 artifacts must stay under ${ARTIFACT_PREFIX}`);
  }
  return path;
}

function universeVersion(freezeConfig, rows) {
  const symbol = freezeConfig.universe[0].symbol.toLowerCase();
  return `hk-${symbol}-${rows[0].date}-${rows.at(-1).date}`;
}

function strictKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    throw new Error(`${label} contains missing or unsupported fields`);
  }
}

function validDate(value) {
  if (!DATE_PATTERN.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertSha(value, label) {
  if (!SHA_PATTERN.test(value ?? "")) throw new Error(`${label} must be an exact 40-character SHA`);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
