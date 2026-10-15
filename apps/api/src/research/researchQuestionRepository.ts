import { bindQuestionOpeningTimes } from "./researchQuestionHistory.js";
import type {Pool} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {ResearchContextError,readResearchContextSnapshot} from "./researchContextRepository.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {readResearchFundamentals} from "./researchFundamentalRepository.js";
import {fundamentalOperatingFact} from "./researchOperatingReasoning.js";
import {readDocumentFactCandidates} from "./researchFactCandidateRepository.js";
import {saveOperatingModel} from "./researchOperatingModelRepository.js";
import {emptyOperatingModel,validOperatingQuestionDraft,type OperatingFact} from "../../../../packages/contracts/src/researchOperatingModel.js";
import {projectOwnerResearchQuestions} from "../../../../packages/contracts/src/researchQuestions.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
export async function readResearchQuestions(pool:Pool,id:string,actor:AuthenticatedResearchActor,now=new Date(),sourceStore?:SourceSnapshotStoreOptions) {
  const w=await readDeepResearchWorkspace(pool,id,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore}),c=await readResearchContextSnapshot(pool,id,actor,now),f=await readResearchFundamentals(pool,id,actor,now,undefined,sourceStore);
  const facts=f.values.map(v=>fundamentalOperatingFact(v,w,true)).filter((v):v is OperatingFact=>v!==null);
  const candidates=await readDocumentFactCandidates(pool,id,actor,facts,now),identity={symbol:f.symbol,membershipId:id,membershipVersion:f.membershipVersion};
  const questions=w.data?.operatingReasoning?.researchQuestions??projectOwnerResearchQuestions(identity,c.data?.operatingModel?.researchQuestionDrafts??[],facts,candidates.candidates,c.data?.createdAt??now.toISOString());
  await bindQuestionOpeningTimes(pool,actor,questions,now.toISOString());
  return {status:"available",actorId:actor.actorId,...identity,questions};
}
export async function saveResearchQuestion(pool:Pool,id:string,body:unknown,actor:AuthenticatedResearchActor,now=new Date(),sourceStore?:SourceSnapshotStoreOptions) {
  if(!body||typeof body!=="object"||Array.isArray(body))throw new ResearchContextError(422,"INVALID_QUESTION","invalid question draft");
  const r=body as Record<string,unknown>;
  if(Object.keys(r).sort().join()!==["question","membershipVersion","baseContextId","idempotencyKey"].sort().join()||!validOperatingQuestionDraft(r.question)||typeof r.idempotencyKey!=="string")throw new ResearchContextError(422,"INVALID_QUESTION","explicit question metric, period and scope are required");
  const context=await readResearchContextSnapshot(pool,id,actor,now),f=await readResearchFundamentals(pool,id,actor,now,undefined,sourceStore);
  if((context.data?.id??null)!==r.baseContextId||f.membershipVersion!==r.membershipVersion)throw new ResearchContextError(409,"QUESTION_CONTEXT_DRIFT","reload current research context");
  const model=structuredClone(context.data?.operatingModel??emptyOperatingModel(Number(now.toISOString().slice(0,4))));
  const question=r.question;
  if(model.researchQuestionDrafts?.some(q=>q.questionId===question.questionId))throw new ResearchContextError(409,"QUESTION_ID_EXISTS","question identity is already present");
  model.researchQuestionDrafts=[...(model.researchQuestionDrafts??[]),question];
  return saveOperatingModel(pool,id,{baseContextId:r.baseContextId,membershipVersion:f.membershipVersion,selectedSymbol:f.symbol,idempotencyKey:r.idempotencyKey,operatingModel:model},actor,now,"NONE",sourceStore);
}
