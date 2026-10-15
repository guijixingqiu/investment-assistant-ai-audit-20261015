import {operatingModelFingerprint} from "./researchOperatingModel.js";
import type {MilestoneEvidenceState,ResearchFreshness} from "./researchReview.js";
import type {ScenarioPeriodType} from "./researchUnderwriting.js";

export type ResearchLoopStorageStatus="READY"|"NOT_APPLIED"|"UNAVAILABLE";
export type ResearchLoopStatus="ACTIVE"|"NOT_ENABLED"|"ENDED";
export type ResearchLoopBlockingStep="STORAGE"|"THESIS"|"CURRENT_BASE"|"BASELINE"|"MILESTONE"|"NONE";
export interface ResearchLoopReadinessProjection {
 schemaVersion:"2026-09-27.research-loop-readiness.v1";
 actorScope:{actorType:"user"|"system";actorId:string};symbol:string;membershipId:string;membershipVersion:number;
 scenarioPeriodType:ScenarioPeriodType;storageStatus:ResearchLoopStorageStatus;loopStatus:ResearchLoopStatus;blockingStep:ResearchLoopBlockingStep;
 thesis:{status:"PRESENT"|"MISSING"|"ENDED";originalThesisIdentity:string|null;lineageId:string|null}|null;
 currentBase:{status:"READY"|"MISSING"|"REVIEW_REQUIRED"|"UNKNOWN";scenarioId:string|null;version:number|null;assumptionFingerprint:string|null}|null;
 baseline:{status:"PRESENT"|"MISSING"|"DRIFTED";baselineId:string|null;scenarioPeriodType:ScenarioPeriodType;membershipVersion:number|null;thesisLineageId:string|null;createdAt:string|null}|null;
 milestone:{status:"PRESENT"|"MISSING"|"DRIFTED";milestoneId:string|null;baselineId:string|null;description:string|null;targetDate:string|null}|null;
 researchFreshness:ResearchFreshness|null;evidenceState:MilestoneEvidenceState|null;
 nextOwnerAction:{kind:ResearchLoopBlockingStep|"REVIEW";label:string;destination:"OPERATING"|"UNDERWRITING"|"REVIEW"|null};
 limitations:string[];generatedAt:string;readinessFingerprint:string;
}
export type ResearchLoopReadinessFacts=Omit<ResearchLoopReadinessProjection,"schemaVersion"|"loopStatus"|"blockingStep"|"nextOwnerAction"|"generatedAt"|"readinessFingerprint"> & {phase12Enabled:boolean;phase12Ended:boolean};

export function projectResearchLoopReadiness(facts:ResearchLoopReadinessFacts,now:Date):ResearchLoopReadinessProjection {
 const loopStatus:ResearchLoopStatus=facts.storageStatus!=="READY"?"NOT_ENABLED":facts.phase12Ended?"ENDED":facts.phase12Enabled?"ACTIVE":"NOT_ENABLED";
 const blockingStep:ResearchLoopBlockingStep=facts.storageStatus!=="READY"?"STORAGE":loopStatus!=="NOT_ENABLED"?"NONE":
  facts.thesis?.status!=="PRESENT"?"THESIS":facts.currentBase?.status!=="READY"?"CURRENT_BASE":
  facts.baseline?.status!=="PRESENT"?"BASELINE":facts.milestone?.status!=="PRESENT"?"MILESTONE":"NONE";
 const nextOwnerAction=loopStatus==="ENDED"?{kind:"NONE",label:"当前 Thesis 已结束。",destination:null} as const:
  loopStatus==="ACTIVE"&&["REVIEW_DUE","REVIEW_REQUIRED"].includes(facts.researchFreshness??"")?{kind:"REVIEW",label:"进入正式复核",destination:"REVIEW"} as const:
  loopStatus==="ACTIVE"?{kind:"NONE",label:"持续复核已启用。",destination:null} as const:
  blockingStep==="STORAGE"?{kind:"STORAGE",label:facts.storageStatus==="NOT_APPLIED"?"持续复核存储尚未启用。":"持续复核暂不可用。",destination:null} as const:
  blockingStep==="THESIS"?{kind:"THESIS",label:"先建立正式 Thesis。",destination:"OPERATING"} as const:
  blockingStep==="CURRENT_BASE"?{kind:"CURRENT_BASE",label:"先完成当前预测期间的 Base 情景。",destination:"UNDERWRITING"} as const:
  blockingStep==="BASELINE"?{kind:"BASELINE",label:"保存当前研究基线。",destination:"UNDERWRITING"} as const:
  blockingStep==="MILESTONE"?{kind:"MILESTONE",label:"建立下一验证节点。",destination:"REVIEW"} as const:
  {kind:"NONE",label:"持续复核尚未启用；请核对正式研究对象。",destination:null} as const;
 const {phase12Enabled:_enabled,phase12Ended:_ended,...stable}=facts;
 const identity={schemaVersion:"2026-09-27.research-loop-readiness.v1" as const,...stable,loopStatus,blockingStep,nextOwnerAction};
 return {...identity,generatedAt:now.toISOString(),readinessFingerprint:operatingModelFingerprint(identity)};
}

export function validateResearchLoopReadiness(value:ResearchLoopReadinessProjection):boolean {
 const {generatedAt,readinessFingerprint,...identity}=value;
 return !Number.isNaN(Date.parse(generatedAt))&&operatingModelFingerprint(identity)===readinessFingerprint&&
  ["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(value.scenarioPeriodType)&&
  ["READY","NOT_APPLIED","UNAVAILABLE"].includes(value.storageStatus)&&
  ["ACTIVE","NOT_ENABLED","ENDED"].includes(value.loopStatus)&&
  ["STORAGE","THESIS","CURRENT_BASE","BASELINE","MILESTONE","NONE"].includes(value.blockingStep)&&
  (value.storageStatus==="READY"||value.blockingStep==="STORAGE")&&
  (value.loopStatus!=="ACTIVE"||value.blockingStep==="NONE")&&
  (value.loopStatus!=="ENDED"||value.blockingStep==="NONE");
}
