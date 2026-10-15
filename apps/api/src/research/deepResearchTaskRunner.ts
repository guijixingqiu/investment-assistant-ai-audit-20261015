import type { Pool } from "pg";
import type { CloudAiSendAuthorizationSnapshot } from "../../../../packages/contracts/src/cloudAiPolicy.js";
import {
  validateDeepResearchTaskSendManifest,
  validateCreateDeepResearchTaskRequest,
  type CreateDeepResearchTaskRequest,
  type DeepResearchTaskSendManifest
} from "../../../../packages/contracts/src/deepResearchTask.js";
import { deepResearchProviderAuthorizationIsConfirmed } from "../../../../packages/contracts/src/deepResearchSnapshot.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  validateDeepResearchSynthesisProviderPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import type { ResearchEvidenceAiConfig } from "../config.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  DeepResearchGateError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { readCurrentDeepResearchSnapshot } from "./deepResearchSnapshotAssembler.js";
import {
  DeepResearchProviderError,
  generateDeepResearchSynthesisWithAi
} from "./deepResearchSynthesisAi.js";
import {
  DEEP_RESEARCH_TASK_LEASE_MILLISECONDS,
  bindDeepResearchTaskSnapshot,
  claimDeepResearchTask,
  storeDeepResearchTaskSynthesis,
  failDeepResearchTask
} from "./deepResearchTaskRepository.js";
import { deepResearchProviderAuthorizationMatches } from "./deepResearchGate.js";
import {
  cloudAiPolicyIsEnabled,
  withCloudAiPolicySendAuthorization
} from "./cloudAiPolicyRepository.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

export interface DeepResearchTaskExecutionDependencies {
  claim: typeof claimDeepResearchTask;
  bindSnapshot: typeof bindDeepResearchTaskSnapshot;
  assembleSnapshot: typeof readCurrentDeepResearchSnapshot;
  synthesize: typeof generateDeepResearchSynthesisWithAi;
  providerConfig: ResearchEvidenceAiConfig | null;
  storeSynthesis: typeof storeDeepResearchTaskSynthesis;
  fail: typeof failDeepResearchTask;
  authorize?: typeof cloudAiPolicyIsEnabled;
  sendAuthorized?: typeof withCloudAiPolicySendAuthorization;
  recordAttempt?: typeof recordDeepResearchTaskSendAttempt;
  sourceStore?: SourceSnapshotStoreOptions;
}

const defaultDependencies: DeepResearchTaskExecutionDependencies = {
  claim: claimDeepResearchTask,
  bindSnapshot: bindDeepResearchTaskSnapshot,
  assembleSnapshot: readCurrentDeepResearchSnapshot,
  synthesize: generateDeepResearchSynthesisWithAi,
  providerConfig: null,
  storeSynthesis: storeDeepResearchTaskSynthesis,
  fail: failDeepResearchTask
};

function freshSourceStore(options?:SourceSnapshotStoreOptions):SourceSnapshotStoreOptions|undefined {
  return options?{...options,availabilityCache:new Map()}:undefined;
}

export async function runDeepResearchTaskOnce(
  pool: Pool,
  now = new Date(),
  dependencies: DeepResearchTaskExecutionDependencies = defaultDependencies,
  clock: () => Date = () => new Date()
): Promise<boolean> {
  const claimed = await dependencies.claim(pool, now);
  if (!claimed) return false;
  let completionNow: Date | null = null;
  const currentCompletionTime = () => completionNow ??= clock();
  let providerSendPrepared = false;
  let providerResponseReceived = false;
  const validation = validateCreateDeepResearchTaskRequest(claimed.request);
  if (!validation.ok) {
    await dependencies.fail(pool, claimed, "stored_request_invalid", true, now);
    return true;
  }
  try {
    const taskRequest = claimed.request as CreateDeepResearchTaskRequest;
    if (!deepResearchProviderAuthorizationIsConfirmed(taskRequest.intent)
      || !deepResearchProviderAuthorizationMatches(taskRequest.intent)) {
      throw new DeepResearchGateError("explicit provider authorization is required before cloud synthesis");
    }
    const expected = {
      membershipVersion: taskRequest.membershipVersion,
      evidencePackId: taskRequest.evidencePackId,
      evidencePackFingerprint: taskRequest.evidencePackBinding.fingerprint,
      intent: taskRequest.intent,
      analysisContentVersion: claimed.snapshot ? claimed.snapshot.analysisContentVersion ?? null : undefined
    };
    const currentSnapshot = await dependencies.assembleSnapshot(
      pool, claimed.data.membershipId, expected, claimed.actor, now, freshSourceStore(dependencies.sourceStore)
    );
    if (claimed.snapshot && claimed.snapshot.snapshotId !== currentSnapshot.snapshotId) {
      throw new DeepResearchGateError("deep research snapshot changed before explicit retry");
    }
    const snapshot = claimed.snapshot ?? currentSnapshot;
    const boundTask = claimed.snapshot
      ? claimed
      : await dependencies.bindSnapshot(pool, claimed, snapshot, now);
    if (!dependencies.providerConfig) throw new DeepResearchProviderError("deep research provider is not configured");
    const sendAuthorized: typeof withCloudAiPolicySendAuthorization = dependencies.sendAuthorized ?? (dependencies.authorize
      ? async <T>(sendPool: Pool, actor: AuthenticatedResearchActor, send: (authorization?: CloudAiSendAuthorizationSnapshot) => Promise<T>) =>
          await dependencies.authorize!(sendPool, actor) ? send() : null
      : withCloudAiPolicySendAuthorization);
    const synthesis = await sendAuthorized(pool, claimed.actor, (sendAuthorization) => dependencies.synthesize(
      snapshot, dependencies.providerConfig!, undefined, async (manifest) => {
        await (dependencies.recordAttempt ?? recordDeepResearchTaskSendAttempt)(pool, boundTask, manifest, clock());
        providerSendPrepared = true;
      }, sendAuthorization
    ));
    if (!synthesis) throw new DeepResearchGateError("cloud AI provider is disabled or requires current Owner confirmation");
    providerResponseReceived = true;
    if (!await (dependencies.authorize ?? cloudAiPolicyIsEnabled)(pool, claimed.actor)) {
      throw new DeepResearchGateError("cloud AI provider authorization was revoked during synthesis");
    }
    const providerValidation = validateDeepResearchSynthesisProviderPayload(synthesis.payload);
    if (!providerValidation.ok) throw new DeepResearchProviderError("deep research provider draft failed schema validation");
    const freshSnapshot = await dependencies.assembleSnapshot(
      pool, claimed.data.membershipId, expected, claimed.actor, currentCompletionTime(), freshSourceStore(dependencies.sourceStore)
    );
    if (freshSnapshot.snapshotId !== snapshot.snapshotId) {
      throw new DeepResearchGateError("deep research snapshot changed during provider synthesis");
    }
    await dependencies.storeSynthesis(pool, boundTask, {
      reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
      reproducibility: synthesis.reproducibility,
      providerPayload: synthesis.payload,
      sendManifest: synthesis.sendManifest
    }, currentCompletionTime());
  } catch (error) {
    await dependencies.fail(
      pool,
      claimed,
      providerSendPrepared && !providerResponseReceived && !(error instanceof DeepResearchProviderError && error.receiptKnown)
        ? "provider_receipt_unknown" : taskErrorCode(error),
      providerSendPrepared || terminalTaskError(error),
      currentCompletionTime()
    );
  }
  return true;
}

async function recordDeepResearchTaskSendAttempt(
  pool: Pool,
  task: Awaited<ReturnType<typeof bindDeepResearchTaskSnapshot>>,
  manifest: DeepResearchTaskSendManifest,
  now: Date
): Promise<void> {
  const snapshot = task.snapshot;
  if (!snapshot || !validateDeepResearchTaskSendManifest(manifest).ok
    || manifest.snapshotId !== snapshot.snapshotId || manifest.membershipId !== snapshot.target.membershipId
    || manifest.membershipVersion !== snapshot.target.membershipVersion || manifest.symbol !== snapshot.target.symbol
    || manifest.evidencePackId !== snapshot.evidencePack.id || manifest.evidencePackVersion !== snapshot.evidencePack.version
    || manifest.evidencePackFingerprint !== snapshot.evidencePack.packFingerprint) {
    throw new DeepResearchGateError("deep-research send attempt is not bound to the current snapshot");
  }
  const leaseExpiresAt = new Date(now.getTime() + DEEP_RESEARCH_TASK_LEASE_MILLISECONDS);
  const result = await pool.query(
    `update deep_research_tasks set request_payload = jsonb_set(request_payload, '{attemptManifest}', $4::jsonb, true),
            model_usage = 'UNKNOWN', updated_at = $5, lease_expires_at = $6
      where id = $1 and status = 'running' and attempt_count = $2 and claim_token = $3
        and lease_expires_at > $5 and request_payload->'snapshot' is not null
        and (select policy.action = 'enable' and policy.policy_version = $7 and policy.backup_provider = 'none' from cloud_ai_provider_policy_events policy where policy.actor_type = deep_research_tasks.actor_type and policy.actor_id = deep_research_tasks.actor_id order by policy.created_at desc, policy.id desc limit 1) = true
        and not exists (select 1 from cloud_ai_provider_policy_events deletion where deletion.actor_type = deep_research_tasks.actor_type and deletion.actor_id = deep_research_tasks.actor_id and deletion.action = 'request_deletion')`,
    [task.data.id, task.data.attemptCount, task.claimToken, JSON.stringify(manifest), now, leaseExpiresAt, manifest.policyVersion]
  );
  if (result.rowCount !== 1) throw new Error("deep-research send attempt binding failed");
}

export class DeepResearchTaskRunner {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly pool: Pool,
    providerConfig: ResearchEvidenceAiConfig | null,
    private readonly pollMilliseconds = 1000,
    private readonly now: () => Date = () => new Date(),
    sourceStore?: SourceSnapshotStoreOptions
  ) {
    this.dependencies = { ...defaultDependencies, providerConfig, sourceStore };
  }

  private readonly dependencies: DeepResearchTaskExecutionDependencies;

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.kick();
  }

  kick(): void {
    if (this.stopped || this.inFlight) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.drain().catch(() => {}).finally(() => {
        this.inFlight = null;
        if (!this.stopped) this.schedule(this.pollMilliseconds);
      });
    }, 0);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  private schedule(delay: number): void {
    if (this.stopped || this.timer || this.inFlight) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, delay);
    this.timer.unref();
  }

  private async drain(): Promise<void> {
    while (!this.stopped && await runDeepResearchTaskOnce(this.pool, this.now(), this.dependencies, this.now)) {
      // Drain this one narrow PostgreSQL task lane before polling again.
    }
  }
}

function terminalTaskError(error: unknown): boolean {
  return taskTimedOut(error)
    || error instanceof DeepResearchGateError
    || error instanceof DeepResearchProviderError
    || error instanceof CandidateMembershipConflictError
    || error instanceof CandidateMembershipNotFoundError
    || error instanceof CandidateMembershipVersionConflictError
    || error instanceof IdempotencyConflictError;
}

function taskErrorCode(error: unknown): string {
  if (taskTimedOut(error)) return "provider_timeout";
  if (error instanceof DeepResearchGateError) return "research_gate_failed";
  if (error instanceof DeepResearchProviderError) return error.code;
  if (error instanceof CandidateMembershipNotFoundError) return "membership_not_found";
  if (error instanceof CandidateMembershipVersionConflictError) return "membership_version_conflict";
  if (error instanceof CandidateMembershipConflictError) return "membership_conflict";
  if (error instanceof IdempotencyConflictError) return "idempotency_conflict";
  return "task_execution_failed";
}

function taskTimedOut(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
