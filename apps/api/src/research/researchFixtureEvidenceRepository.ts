import type { PoolClient } from "pg";

interface FixtureEvidenceInput {
  sourceType: string;
  summary: string;
  factKind: "fact" | "inference";
  stance: "support" | "refute" | "neutral";
  variableName: string;
  reliability: number;
  materiality: number;
  isRead: boolean;
  rawPayload: Record<string, unknown>;
}

export async function insertFixtureEvidence(
  client: PoolClient,
  profileId: string | undefined,
  evidence: FixtureEvidenceInput
): Promise<void> {
  await client.query(
    `insert into evidence_items
      (research_profile_id, source_type, summary, fact_kind, stance, variable_name, reliability, materiality, is_read, raw_payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      profileId,
      evidence.sourceType,
      evidence.summary,
      evidence.factKind,
      evidence.stance,
      evidence.variableName,
      evidence.reliability,
      evidence.materiality,
      evidence.isRead,
      JSON.stringify(evidence.rawPayload)
    ]
  );
}
