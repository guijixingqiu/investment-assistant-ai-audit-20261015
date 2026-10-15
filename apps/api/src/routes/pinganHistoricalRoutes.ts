import type { FastifyInstance } from "fastify";
import {
  PINGAN_SNAPSHOT_SCHEMA_VERSION,
  validatePinganSnapshotEnvelope
} from "../../../../packages/contracts/src/portfolioSnapshot.js";
import { readPinganSnapshotEnvelope } from "../portfolio/pinganHistoricalSnapshotRepository.js";
import { authenticateReadOnly, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import { canonicalHongKongSymbol, isSupportedHongKongSymbol } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

const PINGAN_FAIL_CLOSED_LIMITATION = "Pingan imported snapshot is historical display only when valid; unavailable fallback exposes no positions and is not live, not authoritative, not broker reconciliation, not account truth, not accounting authority, not execution input, and not risk-impact authority.";

export async function registerPinganHistoricalRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/portfolio/pingan-snapshot/:market/:code", async (request, reply) => {
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(pinganSnapshotFailClosedEnvelope(
        canonicalHongKongSymbol(params.market, params.code),
        "Portfolio snapshot account scope authorization is required.",
        "unauthorized"
      ));
      return;
    }
    try {
      const envelope = await readPinganSnapshotEnvelope(options.pool, params.market, params.code, {
        accountScopeId: derivePinganSnapshotAccountScope(actor, options)
      });
      const validation = validatePinganSnapshotEnvelope(envelope);
      if (!validation.ok) {
        await reply.code(503).send(pinganSnapshotFailClosedEnvelope(
          canonicalHongKongSymbol(params.market, params.code),
          "Assembled Pingan snapshot failed contract validation before response."
        ));
        return;
      }
      return envelope;
    } catch {
      await reply.code(503).send(pinganSnapshotFailClosedEnvelope(
        canonicalHongKongSymbol(params.market, params.code),
        "Pingan snapshot repository is unavailable; historical positions are not exposed."
      ));
    }
  });
}

function pinganSnapshotFailClosedEnvelope(
  requestedSymbol: string,
  message: string,
  status: "unavailable" | "unauthorized" = "unavailable"
) {
  return {
    schemaVersion: PINGAN_SNAPSHOT_SCHEMA_VERSION,
    status,
    requestedSymbol,
    sourceSystem: null,
    sourceSnapshotId: null,
    sourceAsOf: null,
    importedAt: null,
    fetchedAt: null,
    freshness: null,
    limitation: PINGAN_FAIL_CLOSED_LIMITATION,
    warning: null,
    positions: [],
    positionCount: 0,
    dataUse: {
      display: "blocked",
      riskImpact: "blocked",
      brokerReconciliation: "blocked",
      accountTruth: "blocked",
      accounting: "blocked",
      execution: "blocked"
    },
    safety: {
      readOnly: true,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false
    },
    message
  };
}
