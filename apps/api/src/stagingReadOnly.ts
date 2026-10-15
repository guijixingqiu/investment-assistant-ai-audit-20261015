import type { FastifyInstance, FastifyRequest } from "fastify";

export const READ_ONLY_ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface StagingReadOnlyOptions {
  enabled: boolean;
  identity: string;
}

export function registerStagingReadOnlyGuard(
  app: FastifyInstance,
  options: StagingReadOnlyOptions
): void {
  if (!options.enabled) {
    return;
  }

  app.addHook("onRequest", async (request, reply) => {
    if (isReadOnlyRequest(request)) {
      return;
    }

    await reply.code(403).send({
      ok: false,
      code: "STAGING_READ_ONLY_MODE",
      message: "staging read-only mode rejects mutating requests",
      staging: {
        readOnly: true,
        identity: options.identity
      }
    });
  });
}

export function isReadOnlyRequest(request: Pick<FastifyRequest, "method">): boolean {
  return READ_ONLY_ALLOWED_METHODS.has(request.method.toUpperCase());
}
