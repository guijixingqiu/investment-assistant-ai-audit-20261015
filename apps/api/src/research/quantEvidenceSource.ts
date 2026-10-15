import {
  candidateDiscoveryUniverseIsValid,
  type CandidateDiscoveryUniverse
} from "../../../../packages/contracts/src/marketDiscovery.js";

export interface QuantEvidenceAddress {
  repositoryRoot: string;
  repositoryPath: string;
  expectedSha256: string | null;
}

export type QuantEvidenceSourceResult =
  | {
      ok: true;
      content: string;
      contentHash: string;
      path: string;
    }
  | {
      ok: false;
      status: "missing" | "unauthorized" | "malformed" | "unavailable";
      reason: string;
      path: string | null;
    };

export interface QuantEvidenceSource {
  read(address: QuantEvidenceAddress): Promise<QuantEvidenceSourceResult>;
}

export interface HkConnectQuantUniverse {
  binding: CandidateDiscoveryUniverse;
  members: ReadonlySet<string>;
}

export function hkConnectQuantUniverseMatches(value: unknown, expected: HkConnectQuantUniverse): value is CandidateDiscoveryUniverse {
  return candidateDiscoveryUniverseIsValid(value)
    && value.source === expected.binding.source
    && value.snapshotId === expected.binding.snapshotId
    && value.effectiveDate === expected.binding.effectiveDate
    && value.capturedAt === expected.binding.capturedAt
    && value.memberCount === expected.binding.memberCount
    && value.sourceUrls.join("|") === expected.binding.sourceUrls.join("|");
}

export interface DecisionQuantEvidenceOptions {
  address: QuantEvidenceAddress;
  source: QuantEvidenceSource;
  maxAgeDays: number;
  hkConnectUniverse?: HkConnectQuantUniverse;
}

export interface AnnualPortfolioLabQuantEvidenceOptions {
  address: QuantEvidenceAddress;
  source: QuantEvidenceSource;
  maxAgeDays: number;
  hkConnectUniverse?: HkConnectQuantUniverse;
}

export interface QuantEvidenceRuntimeOptions {
  decision: DecisionQuantEvidenceOptions | null;
  annualPortfolioLab: AnnualPortfolioLabQuantEvidenceOptions | null;
}
