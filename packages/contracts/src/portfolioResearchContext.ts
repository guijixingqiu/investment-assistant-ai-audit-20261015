import {createHash} from "node:crypto";
import {canonicalJson} from "./decisionContext.js";
import type {AssetsAlphaSnapshot} from "./assetsAlpha.js";
import type {CandidateMembershipData} from "./candidateMembership.js";
import type {PortfolioDecisionContextEnvelope} from "./portfolioDecisionContext.js";
import type {ResearchReviewProjection} from "./researchReview.js";
import type {ResearchUnderwritingProjection,ResearchPriceSinceBaseline} from "./researchUnderwriting.js";

export type PortfolioResearchState="CURRENT"|"REVIEW_DUE"|"REVIEW_REQUIRED"|"ENDED"|"REVIEW_LOOP_NOT_ENABLED"|"UNTRACKED";
export const PORTFOLIO_RESEARCH_STATES:PortfolioResearchState[]=["REVIEW_REQUIRED","REVIEW_DUE","ENDED","REVIEW_LOOP_NOT_ENABLED","CURRENT","UNTRACKED"];
export interface PortfolioResearchExposureItem {
 symbol:string;companyName:string|null;market:"HK";holdingIdentity:string;assetSnapshotIdentity:string;assetAsOf:string;
 positionValue:number|null;positionCurrency:string|null;portfolioWeight:number|null;valuationAsOf:string|null;
 membershipId:string|null;membershipVersion:number|null;researchState:PortfolioResearchState;evidenceState:ResearchReviewProjection["evidenceState"]|null;
 scenarioPeriodType:ResearchReviewProjection["scenarioPeriodType"]|null;baselineId:string|null;
 activeMilestone:{milestoneId:string;description:string;targetDate:string|null}|null;latestReviewAt:string|null;
 thesisLineageState:"ACTIVE"|"ENDED"|"UNKNOWN";currentBaseStatus:ResearchUnderwritingProjection["currentBaseStatus"]|null;
 priceSinceBaseline:Pick<ResearchPriceSinceBaseline,"baselinePrice"|"currentPrice"|"changeRatio"|"currency">|null;
 limitations:string[];reviewTriggerFingerprint:string|null;thesisLineageId:string|null;
}
export interface PortfolioResearchExposureProjection {
 schemaVersion:"2026-09-27.portfolio-research-exposure.v1";status:"available"|"empty"|"unavailable";
 actorScope:{actorType:string;actorId:string};portfolioSnapshotIdentity:string|null;portfolioAsOf:string|null;
 portfolioSource:"owner_current"|"manual"|"csv"|null;portfolioFreshness:"AS_OF_RECORDED"|"HISTORICAL_SNAPSHOT"|"UNAVAILABLE";
 items:PortfolioResearchExposureItem[];summary:{totalHoldings:number;trackedResearchCount:number;untrackedCount:number;currentCount:number;reviewDueCount:number;reviewRequiredCount:number;endedCount:number;reviewLoopNotEnabledCount:number;exposureByResearchState:Record<PortfolioResearchState,{amount:number|null;percentage:number|null}>;valuationStatus:"AVAILABLE"|"UNKNOWN";valuationLimitation:string|null};
 generatedAt:string;projectionFingerprint:string;marketFingerprint:string;limitations:string[];
}
export interface PortfolioResearchBinding {symbol:string;membership:CandidateMembershipData|null;review:ResearchReviewProjection|null}
const fingerprint=(value:unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
function researchStateFor(member:CandidateMembershipData|null,review:ResearchReviewProjection|null):PortfolioResearchState {
 if(!member)return "UNTRACKED";
 if(!review||!review.enabled&&review.status!=="ENDED")return "REVIEW_LOOP_NOT_ENABLED";
 return review.status;
}
function assertBinding(symbol:string,actorId:string,member:CandidateMembershipData|null,review:ResearchReviewProjection|null):void {
 const parts=/^(HK)\.(\d{5})$/.exec(symbol);if(!parts)throw new Error("INVALID_HOLDING_IDENTITY");
 if(member&&(member.actorId!==actorId||member.state!=="tracked"||member.market!==parts[1]||member.code!==parts[2]||member.symbol!==symbol||!Number.isSafeInteger(member.version)||member.version<1))throw new Error("MEMBERSHIP_IDENTITY_DRIFT");
 if(member&&review&&(review.membershipId!==member.id||review.membershipVersion!==member.version||review.symbol!==symbol))throw new Error("REVIEW_IDENTITY_DRIFT");
}
function reviewDetails(review:ResearchReviewProjection|null,researchState:PortfolioResearchState):Pick<PortfolioResearchExposureItem,"evidenceState"|"scenarioPeriodType"|"baselineId"|"activeMilestone"|"latestReviewAt"|"thesisLineageState"|"currentBaseStatus"|"priceSinceBaseline"|"limitations"|"reviewTriggerFingerprint"|"thesisLineageId"> {
 const milestone=review?.activeMilestone,price=review?.underwriting?.priceSinceBaseline;
 return {evidenceState:review?.enabled?review.evidenceState:null,scenarioPeriodType:review?.enabled?review.scenarioPeriodType:null,baselineId:review?.underwriting?.baseline?.baselineId??null,activeMilestone:milestone?{milestoneId:milestone.milestoneId,description:milestone.description,targetDate:milestone.targetDate}:null,latestReviewAt:review?.latestReview?.createdAt??null,thesisLineageState:researchState==="ENDED"?"ENDED":milestone?"ACTIVE":"UNKNOWN",currentBaseStatus:review?.underwriting?.currentBaseStatus??null,priceSinceBaseline:price?{baselinePrice:price.baselinePrice,currentPrice:price.currentPrice,changeRatio:price.changeRatio,currency:price.currency}:null,limitations:researchState==="UNTRACKED"?["当前持仓尚未纳入 Research tracking。"]:researchState==="REVIEW_LOOP_NOT_ENABLED"?["持续复核尚未启用；请在 Research 核对 Thesis、Baseline 与 Milestone。"]:[],reviewTriggerFingerprint:review?.triggerFingerprint??null,thesisLineageId:milestone?.thesisLineageId??review?.latestReview?.thesisLineageId??null};
}
function exposureItem(position:AssetsAlphaSnapshot["positions"][number],snapshot:AssetsAlphaSnapshot,identity:string,actorId:string,binding:PortfolioResearchBinding,market:PortfolioDecisionContextEnvelope["positions"][number]|null):PortfolioResearchExposureItem {
 const symbol=position.symbol;
 const member=binding.membership,review=binding.review;
 assertBinding(symbol,actorId,member,review);
 const researchState=researchStateFor(member,review);
 return {symbol,companyName:member?.research?.name??null,market:"HK",holdingIdentity:fingerprint({identity,symbol,quantity:position.quantity,costLots:position.costLots??null}),assetSnapshotIdentity:identity,assetAsOf:snapshot.asOf,positionValue:market?.marketValue??null,positionCurrency:market?"HKD":null,portfolioWeight:market?.marketWeight??null,valuationAsOf:market?.quote.quoteAsOf??null,membershipId:member?.id??null,membershipVersion:member?.version??null,researchState,...reviewDetails(review,researchState)};
}
export function assemblePortfolioResearchExposure(actorScope:{actorType:string;actorId:string},snapshot:AssetsAlphaSnapshot|null,bindings:PortfolioResearchBinding[],context:PortfolioDecisionContextEnvelope|null,generatedAt:string):PortfolioResearchExposureProjection {
 const identity=snapshot?`${snapshot.source==="owner_current"?"owner-current":"assets-alpha"}:${snapshot.id}:${snapshot.sourceHash}`:null;
 if(new Set(bindings.map(binding=>binding.symbol)).size!==bindings.length)throw new Error("AMBIGUOUS_HOLDING_BINDING");
 if(new Set((snapshot?.positions??[]).map(position=>position.symbol)).size!==(snapshot?.positions.length??0))throw new Error("AMBIGUOUS_HOLDING_IDENTITY");
 const usable=context&&identity===context.portfolioSnapshotId&&context.status==="available"&&context.summary.marketValue.status==="complete_current"&&context.summary.marketValue.currency==="HKD"&&context.positions.length===snapshot?.positions.length;
 const marketBySymbol=new Map(usable?context.positions.map(p=>[p.symbol,p] as const):[]);
 const valued=!!usable&&snapshot!.positions.every(p=>{const current=marketBySymbol.get(p.symbol);return !!current&&current.quantity===p.quantity&&current.marketValue!==null&&current.marketWeight!==null&&current.quote.status==="current"&&current.currency==="HKD";});
 const items:PortfolioResearchExposureItem[]=(snapshot?.positions??[]).map(position=>{const binding=bindings.find(b=>b.symbol===position.symbol);if(!binding||!snapshot||!identity)throw new Error("MISSING_HOLDING_BINDING");return exposureItem(position,snapshot,identity,actorScope.actorId,binding,valued?marketBySymbol.get(position.symbol)??null:null);});
 const indexed=items.map((item,index)=>({item,index})).sort((a,b)=>PORTFOLIO_RESEARCH_STATES.indexOf(a.item.researchState)-PORTFOLIO_RESEARCH_STATES.indexOf(b.item.researchState)||a.index-b.index).map(x=>x.item);
 const denominator=valued?context!.summary.marketValue.amount:null;
 const exposureByResearchState=Object.fromEntries(PORTFOLIO_RESEARCH_STATES.map(state=>{const group=indexed.filter(x=>x.researchState===state),amount=denominator!==null?group.reduce((n,x)=>n+(x.positionValue??0),0):null;return [state,{amount,percentage:denominator&&amount!==null?amount/denominator:null}];})) as PortfolioResearchExposureProjection["summary"]["exposureByResearchState"];
 const count=(state:PortfolioResearchState)=>indexed.filter(x=>x.researchState===state).length;
 const summary={totalHoldings:indexed.length,trackedResearchCount:indexed.length-count("UNTRACKED"),untrackedCount:count("UNTRACKED"),currentCount:count("CURRENT"),reviewDueCount:count("REVIEW_DUE"),reviewRequiredCount:count("REVIEW_REQUIRED"),endedCount:count("ENDED"),reviewLoopNotEnabledCount:count("REVIEW_LOOP_NOT_ENABLED"),exposureByResearchState,valuationStatus:denominator!==null?"AVAILABLE" as const:"UNKNOWN" as const,valuationLimitation:denominator!==null?null:"比例不可用，因为当前组合估值/币种口径不足。"};
 const status=snapshot?indexed.length?"available" as const:"empty" as const:"unavailable" as const;
 return {schemaVersion:"2026-09-27.portfolio-research-exposure.v1",status,actorScope,portfolioSnapshotIdentity:identity,portfolioAsOf:snapshot?.asOf??null,portfolioSource:snapshot?.source??null,portfolioFreshness:!snapshot?"UNAVAILABLE":snapshot.source==="owner_current"?"AS_OF_RECORDED":"HISTORICAL_SNAPSHOT",items:indexed,summary,generatedAt,projectionFingerprint:fingerprint({actorScope,identity,holdings:indexed.map(x=>({holdingIdentity:x.holdingIdentity,membershipId:x.membershipId,membershipVersion:x.membershipVersion,researchState:x.researchState,reviewTriggerFingerprint:x.reviewTriggerFingerprint,thesisLineageId:x.thesisLineageId,baselineId:x.baselineId,activeMilestoneId:x.activeMilestone?.milestoneId??null}))}),marketFingerprint:fingerprint({identity,values:indexed.map(x=>({symbol:x.symbol,value:x.positionValue,weight:x.portfolioWeight,valuationAsOf:x.valuationAsOf}))}),limitations:status==="unavailable"?["没有可用的非官方持仓快照。"]:[]};
}
export function validatePortfolioResearchExposure(value:PortfolioResearchExposureProjection):boolean {
 const s=value.summary,states=PORTFOLIO_RESEARCH_STATES;
 return value.schemaVersion==="2026-09-27.portfolio-research-exposure.v1"&&/^[a-f0-9]{64}$/.test(value.projectionFingerprint)&&/^[a-f0-9]{64}$/.test(value.marketFingerprint)&&s.totalHoldings===value.items.length&&s.trackedResearchCount+s.untrackedCount===s.totalHoldings&&states.reduce((n,state)=>n+value.items.filter(item=>item.researchState===state).length,0)===s.totalHoldings&&new Set(value.items.map(item=>item.symbol)).size===s.totalHoldings&&value.items.every(item=>item.assetSnapshotIdentity===value.portfolioSnapshotIdentity&&(!item.membershipId||item.membershipVersion!==null))&&(s.valuationStatus==="AVAILABLE"?value.items.every(item=>item.positionValue!==null&&item.portfolioWeight!==null&&item.positionCurrency==="HKD"):value.items.every(item=>item.portfolioWeight===null));
}
