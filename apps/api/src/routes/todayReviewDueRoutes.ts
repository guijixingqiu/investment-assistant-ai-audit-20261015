import type { FastifyInstance } from "fastify";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  TODAY_REVIEW_DUE_SCHEMA_VERSION,
  todayReviewDueSafety,
  validateTodayReviewDueEnvelope,
  type TodayReviewDueEnvelope
} from "../../../../packages/contracts/src/todayReviewDue.js";
import { readTodayReviewDue } from "../research/todayReviewDueRepository.js";
import { authenticateReadOnly } from "./researchAuth.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerTodayReviewDueRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/today", async (request, reply) => {
    const query = request.query as { symbol?: unknown };
    const requestedSymbol = typeof query.symbol === "string" ? query.symbol : "";
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      const envelope = isCanonicalHongKongSymbol(requestedSymbol)
        ? unavailableTodayReviewDue(requestedSymbol, "read authorization required")
        : { ok: false, message: "read authorization required" };
      await reply.code(401).send(envelope);
      return;
    }
    if (!isCanonicalHongKongSymbol(requestedSymbol)) {
      await reply.code(400).send({
        ok: false,
        message: "symbol must be exact canonical HK.#####"
      });
      return;
    }
    const [, code] = requestedSymbol.split(".");
    const now = options.now?.() ?? new Date();
    try {
      const envelope = await readTodayReviewDue(options.pool, "HK", code!, actor, now);
      const validation = validateTodayReviewDueEnvelope(envelope, {
        expectedSymbol: requestedSymbol,
        now
      });
      if (!validation.ok) {
        await reply.code(503).send(unavailableTodayReviewDue(
          requestedSymbol,
          "Today REVIEW_DUE projection failed contract validation."
        ));
        return;
      }
      return envelope;
    } catch {
      await reply.code(503).send(unavailableTodayReviewDue(
        requestedSymbol,
        "Today REVIEW_DUE repository is unavailable; no old decision or review facts are exposed."
      ));
    }
  });
}

export function unavailableTodayReviewDue(
  requestedSymbol: string,
  message: string
): TodayReviewDueEnvelope {
  return {
    schemaVersion: TODAY_REVIEW_DUE_SCHEMA_VERSION,
    status: "unavailable",
    requestedSymbol,
    metadata: makeFactMetadata({
      source: "today_review_due:unavailable",
      asOf: null,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Today REVIEW_DUE facts are unavailable; no prior event is retained."
    }),
    event: null,
    advisoryOnly: true,
    safety: todayReviewDueSafety(),
    message
  };
}

function isCanonicalHongKongSymbol(value: string): boolean {
  return /^HK\.\d{5}$/.test(value);
}
