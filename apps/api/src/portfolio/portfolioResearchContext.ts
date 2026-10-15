import type {Pool} from "pg";
import {readAssetsAlphaEnvelope} from "../assetsAlphaRepository.js";
import {readCandidateMembershipEnvelope} from "../research/candidateMembershipReadRepository.js";
import {readResearchReview} from "../research/researchReviewRepository.js";
import {readAuthorizedPortfolioDecisionContext} from "../research/authorizedPortfolioDecisionContext.js";
import type {AuthenticatedResearchActor} from "../research/domain.js";
import {assemblePortfolioResearchExposure,type PortfolioResearchBinding} from "../../../../packages/contracts/src/portfolioResearchContext.js";
import type {SourceSnapshotStoreOptions} from "../research/researchSourceSnapshotRepository.js";

export class PortfolioResearchContextError extends Error {constructor(readonly statusCode:number,readonly code:string,message:string){super(message);}}
export async function readPortfolioResearchContext(pool:Pool,actor:AuthenticatedResearchActor,options:{accountScopeId:string|null;quoteLiveMaxAgeSeconds:number;pinganCurrentMaxAgeSeconds:number;membershipLiveMaxAgeSeconds:number;portfolioEnabled:boolean;sourceStore?:SourceSnapshotStoreOptions},now=new Date()) {
 const assets=await readAssetsAlphaEnvelope(pool,actor,now);
 const snapshot=assets.snapshots.find(x=>x.source==="owner_current")??assets.latestSnapshot;
 const memberships=await readCandidateMembershipEnvelope(pool,actor,false,options.membershipLiveMaxAgeSeconds,now);
 if(memberships.status==="unavailable")throw new PortfolioResearchContextError(503,"MEMBERSHIP_READ_UNAVAILABLE","Research membership identity is unavailable");
 const bindings:PortfolioResearchBinding[]=[];
 for(const position of snapshot?.positions??[]){
  const match=/^(HK)\.(\d{5})$/.exec(position.symbol);
  if(!match)throw new PortfolioResearchContextError(409,"HOLDING_IDENTITY_AMBIGUOUS","Holding symbol is not canonical");
  const candidates=memberships.memberships.filter(m=>m.symbol===position.symbol||m.market===match[1]&&m.code===match[2]);
  if(candidates.some(m=>m.symbol!==position.symbol||m.market!==match[1]||m.code!==match[2]))throw new PortfolioResearchContextError(409,"HOLDING_IDENTITY_AMBIGUOUS","Holding and membership identity disagree");
  const tracked=candidates.filter(m=>m.state==="tracked");
  if(tracked.length>1)throw new PortfolioResearchContextError(409,"HOLDING_IDENTITY_AMBIGUOUS","Multiple current Research memberships match one holding");
  const member=tracked[0]??null;
  const review=member?await readResearchReview(pool,member.id,actor,now,"CURRENT_FY",false,options.sourceStore):null;
  bindings.push({symbol:position.symbol,membership:member,review});
 }
 let context=null;
 if(snapshot?.source==="owner_current"&&options.portfolioEnabled&&options.accountScopeId){
  try{context=await readAuthorizedPortfolioDecisionContext(pool,{accountScopeId:options.accountScopeId,ownerCurrentActor:actor,pinganCurrentMaxAgeSeconds:options.pinganCurrentMaxAgeSeconds,quoteLiveMaxAgeSeconds:options.quoteLiveMaxAgeSeconds},now);}catch{/* Value and weight remain UNKNOWN; exact research reads above still stand. */}
 }
 return assemblePortfolioResearchExposure({actorType:actor.actorType,actorId:actor.actorId},snapshot,bindings,context,now.toISOString());
}
