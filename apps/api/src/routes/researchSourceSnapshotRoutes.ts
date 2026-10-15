import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { validCaptureResearchSourceSnapshotRequest, validConfirmResearchSourceSnapshotMaterialRequest } from "../../../../packages/contracts/src/researchSourceSnapshot.js";
import { createResearchMaterial } from "../research/deepResearchMaterialRepository.js";
import { captureResearchSourceSnapshot, listResearchSourceSnapshots, readResearchSourceSnapshot, readResearchSourceSnapshotOriginal, type SourceSnapshotStoreOptions } from "../research/researchSourceSnapshotRepository.js";
import { ResearchDocumentError } from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite, type ResearchAuthOptions } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";

interface Options extends ResearchAuthOptions, SourceSnapshotStoreOptions { pool: Pool; now?: () => Date }
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ResearchDocumentError) return reply.code(error.statusCode).send({ ok: false, code: error.code, message: error.message });
  const known = error as { statusCode?: number; code?: string; message?: string };
  if (known?.statusCode && known.statusCode >= 400 && known.statusCode < 500)
    return reply.code(known.statusCode).send({ ok: false, code: known.code ?? "SOURCE_BINDING_FAILED", message: known.message });
  return reply.code(503).send({ ok: false, code: "SOURCE_SNAPSHOT_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) });
}
function offsetBoundary(text: string, offset: number) {
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
}

export async function registerResearchSourceSnapshotRoutes(app: FastifyInstance, options: Options): Promise<void> {
  const base = "/api/mobile/research/candidate-memberships/:id/source-snapshots";
  app.get(base, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options), id = (request.params as {id:string}).id;
    if (!actor) return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ok:false,code:"INVALID_MEMBERSHIP"});
    try { return {ok:true,data:await listResearchSourceSnapshots(options.pool,id,actor)}; }
    catch(error) { return fail(reply,error); }
  });
  app.post(base, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write"), id = (request.params as {id:string}).id;
    if (!actor || actor.actorType !== "user") return reply.code(401).send({ok:false,code:"OWNER_WRITE_REQUIRED"});
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ok:false,code:"INVALID_MEMBERSHIP"});
    if (!validCaptureResearchSourceSnapshotRequest(request.body)) return reply.code(422).send({ok:false,code:"INVALID_SNAPSHOT_CAPTURE"});
    try { return {ok:true,data:await captureResearchSourceSnapshot(options.pool,id,request.body,actor,options,options.now?.())}; }
    catch(error) { return fail(reply,error); }
  });
  app.get(base+"/:snapshotId", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options), {id,snapshotId} = request.params as {id:string;snapshotId:string};
    if (!actor) return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if (!isCanonicalMembershipId(id) || !isCanonicalMembershipId(snapshotId)) return reply.code(400).send({ok:false,code:"INVALID_SOURCE_ID"});
    try { return {ok:true,data:await readResearchSourceSnapshot(options.pool,id,snapshotId,actor,options)}; }
    catch(error) { return fail(reply,error); }
  });
  app.get(base+"/:snapshotId/content", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options), {id,snapshotId} = request.params as {id:string;snapshotId:string};
    if (!actor) return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if (!isCanonicalMembershipId(id) || !isCanonicalMembershipId(snapshotId)) return reply.code(400).send({ok:false,code:"INVALID_SOURCE_ID"});
    try {
      const original=await readResearchSourceSnapshotOriginal(options.pool,id,snapshotId,actor,options);
      return reply.header("content-type","application/octet-stream").header("content-disposition",`attachment; filename="source-snapshot-${snapshotId}.html"`)
        .header("x-content-type-options","nosniff").header("x-source-raw-sha256",original.snapshot.rawSha256).send(original.bytes);
    } catch(error) { return fail(reply,error); }
  });
  app.post(base+"/:snapshotId/materials", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write"), {id,snapshotId} = request.params as {id:string;snapshotId:string};
    if (!actor || actor.actorType !== "user") return reply.code(401).send({ok:false,code:"OWNER_WRITE_REQUIRED"});
    if (!isCanonicalMembershipId(id) || !isCanonicalMembershipId(snapshotId)) return reply.code(400).send({ok:false,code:"INVALID_SOURCE_ID"});
    if (!validConfirmResearchSourceSnapshotMaterialRequest(request.body)) return reply.code(422).send({ok:false,code:"INVALID_SNAPSHOT_CONFIRMATION"});
    try {
      const input = request.body, source = await readResearchSourceSnapshot(options.pool,id,snapshotId,actor,options);
      if (source.membershipVersion !== input.membershipVersion || !source.publishedAt || source.reviewState === "historical")
        throw new ResearchDocumentError(409,"SNAPSHOT_VERSION_CONFLICT","source does not match current membership version or lacks publication date");
      if (input.endUtf16 > source.normalizedText.length || !offsetBoundary(source.normalizedText,input.startUtf16)
        || !offsetBoundary(source.normalizedText,input.endUtf16))
        throw new ResearchDocumentError(422,"SNAPSHOT_RANGE_INVALID","UTF-16 excerpt boundary is outside text or splits a code point");
      const contentText = source.normalizedText.slice(input.startUtf16,input.endUtf16);
      if (!contentText.trim() || contentText.length > 100000) throw new ResearchDocumentError(422,"SNAPSHOT_RANGE_INVALID","selected excerpt is empty or too long");
      const version = `html:snapshot-${source.id}:${source.rawSha256}:${source.textSha256.slice(0,16)}:${input.startUtf16}-${input.endUtf16}`;
      const material = await createResearchMaterial(options.pool,"HK",source.symbol.slice(3),{
        membershipId:id,membershipVersion:input.membershipVersion,title:source.normalizedText.split("\n").filter(Boolean)[1]?.slice(0,300) ?? "Official issuer article",
        contentText,sourceType:"issuer_public_html",sourceUrl:source.responseUrl,publishedAt:source.publishedAt,
        claimType:"issuer_statement",verificationStatus:"unverified",rightsStatus:"authorized_public",sourceVersion:version,
        replacesMaterialId:input.replacesMaterialId ?? null,validUntil:input.validUntil,summary:contentText.slice(0,300),
        variableName:null,stance:"neutral",reliability:null,materiality:null,isRead:true,idempotencyKey:input.idempotencyKey
      },actor,options.now?.(),{kind:"source_snapshot",snapshotId,textSha256:source.textSha256,startUtf16:input.startUtf16,
        endUtf16:input.endUtf16,excerptSha256:sha(contentText)});
      return {ok:true,data:material};
    } catch(error) { return fail(reply,error); }
  });
}
