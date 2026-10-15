import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

export interface HealthRouteOptions {
  pool: Pick<Pool, "query">;
  marketProvider: string;
  stagingReadOnly: boolean;
  stagingIdentity: string;
  marketDataProbe?: () => Promise<boolean>;
  rawStoreProbe?: () => Promise<boolean>;
  researchAiConfigured?: boolean;
  taskRunnerEnabled?: boolean;
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions): void {
  const livePayload = () => ({
    ok: true,
    service: "annual-rings-api",
    gate: "A",
    marketProvider: options.marketProvider,
    staging: {
      readOnly: options.stagingReadOnly,
      identity: options.stagingIdentity
    }
  });

  app.get("/health", async () => livePayload());
  app.get("/health/live", async () => livePayload());
  app.get("/health/ready", async (_request, reply) => {
    const [database, marketData, rawStore] = await Promise.all([
      databaseReadiness(options.pool),
      dependencyReadiness(options.marketDataProbe),
      dependencyReadiness(options.rawStoreProbe)
    ]);
    const ready = database.database === "ready" && database.schema === "ready";
    await reply.code(ready ? 200 : 503).send({
      ...livePayload(),
      ok: ready,
      readiness: {
        ...database,
        marketData,
        rawStore,
        researchAi: options.researchAiConfigured ? "configured" : "disabled",
        taskRunner: options.taskRunnerEnabled ? "running" : "disabled"
      }
    });
  });
}

async function databaseReadiness(pool: Pick<Pool, "query">): Promise<{
  database: "ready" | "unavailable";
  schema: "ready" | "unavailable";
}> {
  try {
    await pool.query("select 1 as ready");
    const result = await pool.query(
      "select to_regclass('public.candidate_memberships')::text as candidate_memberships, to_regclass('public.deep_research_tasks')::text as deep_research_tasks"
    );
    const row = result.rows[0];
    return {
      database: "ready",
      schema: row?.candidate_memberships && row?.deep_research_tasks ? "ready" : "unavailable"
    };
  } catch {
    return { database: "unavailable", schema: "unavailable" };
  }
}

async function dependencyReadiness(
  probe: (() => Promise<boolean>) | undefined
): Promise<"ready" | "unavailable" | "not_configured"> {
  if (!probe) return "not_configured";
  try {
    return await probe() ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}
