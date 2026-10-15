import { readDocumentFactCandidates } from "./researchFactCandidateRepository.js";
import { projectResearchQuestions } from "../../../../packages/contracts/src/researchQuestions.js";
import { bindQuestionOpeningTimes } from "./researchQuestionHistory.js";
import { projectOwnerResearchQuestions } from "../../../../packages/contracts/src/researchQuestions.js";
import { operatingModelFingerprint, type OperatingFact } from "../../../../packages/contracts/src/researchOperatingModel.js";
import { researchStateFingerprint } from "../../../../packages/contracts/src/researchDecisionUpdate.js";
import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import type {DeepResearchWorkspaceEnvelope} from "../../../../packages/contracts/src/deepResearch.js";
import type {ResearchContextEnvelope} from "../../../../packages/contracts/src/researchContext.js";
import {readResearchMaterials,readDeepResearchReportRows} from "./deepResearchPersistence.js";
import {rowToDeepResearchReport} from "./deepResearchMappers.js";
import {readResearchFundamentals} from "./researchFundamentalRepository.js";
import {rowToResearchContextSnapshot,type ResearchContextRow} from "./researchContextRepository.js";
import {readLatestQuoteEnvelope} from "../market/repository.js";
import {buildOperatingReasoning,fundamentalOperatingFact} from "./researchOperatingReasoning.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
/** API event timestamps have millisecond precision: a cutoff includes that entire millisecond bucket.
 * Both sides of an event use their own cutoff. No today's freshness, model or report projection. */
export async function historicalOperatingSnapshot(pool:Pick<Pool|PoolClient,"query">,actor:AuthenticatedResearchActor,workspace:DeepResearchWorkspaceEnvelope,contextEnvelope:ResearchContextEnvelope,cutoff:string,sourceStore?:SourceSnapshotStoreOptions) {
  if(!workspace.data)return null;
  const time=new Date(cutoff),target=workspace.data.target;
  const profile=await pool.query<{id:string}>("select id from research_profiles where market=$1 and code=$2 limit 1",[target.market,target.code]);
  if(!profile.rows[0])return null;
  const [materials,facts,reportRows,contexts,quote]=await Promise.all([
    readResearchMaterials(pool,profile.rows[0].id,target.membershipId,time,time),
    readResearchFundamentals(pool,target.membershipId,actor,time,time,sourceStore),
    readDeepResearchReportRows(pool,profile.rows[0].id,target.membershipId,time),
    pool.query<ResearchContextRow>(`select * from research_context_snapshots where candidate_membership_id=$1 and captured_membership_version=$2 and selected_symbol=$3 and actor_type=$4 and actor_id=$5 and created_at < $6::timestamptz + interval '1 millisecond' order by created_at desc,id desc limit 1`,[target.membershipId,target.membershipVersion,target.symbol,actor.actorType,actor.actorId,time]),
    readLatestQuoteEnvelope(pool,target.market,target.code,300,time,time)
  ]);
  const row=contexts.rows[0],data=row?rowToResearchContextSnapshot(row,time):null;
  // A historical context cannot borrow today's currentness or live after its own expiry.
  const usable=data&&Date.parse(data.validUntil)>time.getTime()&&!JSON.stringify(data.operatingModel??{}).includes("TEST FIXTURE ONLY");
  const c=usable?{...contextEnvelope,status:"available" as const,generatedAt:cutoff,data}:undefined;
  const reports=reportRows.map(r=>rowToDeepResearchReport(r));
  const w={...workspace,generatedAt:cutoff,data:{...workspace.data,materials,reports,latestReport:reports[0]??null}};
  const observed=quote.data?{symbol:quote.data.symbol,price:quote.data.price,currency:quote.data.currency,asOf:quote.data.quoteTime,fetchedAt:quote.source.fetchedAt!,source:quote.source.provider,fresh:quote.status==="live"&&!quote.metadata.fixture}:null;
  const reasoning=buildOperatingReasoning(w,facts,c,observed);
  const values=facts.values.map(f=>fundamentalOperatingFact(f,w,true)).filter((f):f is OperatingFact=>f!==null);
  const candidates=(await readDocumentFactCandidates(pool,target.membershipId,actor,values,time,true)).candidates;
  if(reasoning)reasoning.researchQuestions=projectResearchQuestions(reasoning,candidates,cutoff);
  const questions=reasoning?.researchQuestions??projectOwnerResearchQuestions({symbol:target.symbol,membershipId:target.membershipId,membershipVersion:target.membershipVersion},c?.data?.operatingModel?.researchQuestionDrafts??[],values,candidates,c?.data?.createdAt??cutoff);
  await bindQuestionOpeningTimes(pool,actor,questions,cutoff);
  return {reasoning,questions,fingerprint:reasoning?researchStateFingerprint(reasoning):operatingModelFingerprint({symbol:target.symbol,membershipId:target.membershipId,membershipVersion:target.membershipVersion,contextId:c?.data?.id??null,questions,materials:materials.map(m=>({id:m.id,revision:m.revision,state:m.revisionState,freshness:m.freshness})),facts:values.map(f=>({id:f.id,revision:f.revision}))})};
}

export async function historicalOperatingReasoning(...args:Parameters<typeof historicalOperatingSnapshot>){return (await historicalOperatingSnapshot(...args))?.reasoning??null;}
