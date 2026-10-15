import type { DeepResearchWorkspaceEnvelope } from "./deepResearch.js";
import { explicitThesisOptions, sameThesisIdentity } from "./researchOperatingReasoning.js";
import { operatingModelFingerprint, type ExplicitThesisBinding, type OperatingResearchModel } from "./researchOperatingModel.js";

export type ThesisFormationStatus = "NEEDS_DEEP_RESEARCH" | "READY_TO_SELECT" | "BOUND" | "ENDED_REQUIRES_NEW_LINEAGE" | "UNAVAILABLE";
export interface ThesisFormationOption {
  binding: ExplicitThesisBinding;
  reportStatus: "evidence_insufficient" | "complete_pending_confirmation";
  reportCreatedAt: string;
  reportCurrentness: "current" | "historical";
  supportingEvidence: string[];
  counterevidence: string[];
  unknowns: string[];
  limitations: string[];
}
export interface ThesisFormationProjection {
  schemaVersion: "thesis-formation-v1";
  actorScope: { actorType: string; actorId: string };
  symbol: string;
  membershipId: string;
  membershipVersion: number;
  status: ThesisFormationStatus;
  contextId: string | null;
  currentFormalThesis: ExplicitThesisBinding | null;
  currentLineage: {state:"ACTIVE"|"ENDED";lineageId:string;currentThesisText:string;source:"ORIGINAL_REPORT_CONDITION"|"OWNER_REVISION";latestOwnerActionId:string|null;originalThesisIdentity:ExplicitThesisBinding} | null;
  options: ThesisFormationOption[];
  selectedOption: ThesisFormationOption | null;
  counterevidence: string[];
  unknowns: string[];
  nextResearchQuestion: string | null;
  limitations: string[];
  nextOwnerAction: { kind: "DEEP_RESEARCH" | "SELECT_THESIS" | "CURRENT_BASE" | "REVISE_THESIS" | "RELOAD"; label: string };
  generatedAt: string;
  projectionFingerprint: string;
}
export function currentThesisText(model:OperatingResearchModel|null):string|null {
  const current=model?.thesisBinding;if(!current)return null;
  if(model.thesisOwnerAction?.action==="REVISE_THESIS"&&model.thesisOwnerAction.newThesis?.trim())return model.thesisOwnerAction.newThesis;
  return model.thesisRevision?.status==="OWNER_CONFIRMED"&&model.thesisRevision.newThesis?.trim()?model.thesisRevision.newThesis:current.conditionText;
}
function projectCurrentLineage(model:OperatingResearchModel|null,current:ExplicitThesisBinding|null){
  if(!current)return null;
  const text=currentThesisText(model)??current.conditionText,revised=text!==current.conditionText;
  return {state:model?.thesisOwnerAction?.action==="INVALIDATE_OR_END_THESIS"?"ENDED" as const:"ACTIVE" as const,
    lineageId:model?.thesisOwnerAction?.lineageId??operatingModelFingerprint(current),
    currentThesisText:text,
    source:revised?"OWNER_REVISION" as const:"ORIGINAL_REPORT_CONDITION" as const,
    latestOwnerActionId:model?.thesisOwnerAction?.actionId??null,originalThesisIdentity:current};
}
export function projectThesisFormation(workspace: DeepResearchWorkspaceEnvelope, contextId: string | null, contextModel: OperatingResearchModel | null, now = new Date(), actorType: "user" | "system" = "user"): ThesisFormationProjection {
  const data = workspace.data;
  const identity = {actorScope:{actorType,actorId:workspace.requestedActorId},symbol:data?.target.symbol??workspace.requestedSymbol??"",membershipId:workspace.membershipId,membershipVersion:data?.target.membershipVersion??0};
  const options: ThesisFormationOption[] = data ? explicitThesisOptions(workspace).flatMap(binding => {
    const report=data.reports.find(item=>item.id===binding.reportId&&item.version===binding.reportVersion&&item.reportFingerprint===binding.reportFingerprint);
    if(!report)return [];
    const payload=report.payload;
    const layer="researchLayer" in payload?payload.researchLayer:null;
    return [{binding,reportStatus:report.status,reportCreatedAt:report.createdAt,reportCurrentness:report.currentness.status,
      supportingEvidence:payload.factTable.filter(f=>f.evidenceIds.some(id=>payload.supportEvidenceIds.includes(id))).map(f=>f.statement).slice(0,3),
      counterevidence:[...(layer?.counterevidence.map(f=>f.statement)??[]),...payload.sourceConflicts.map(c=>c.description),...payload.counterEvidenceIds.map(id=>`反方证据 ${id}`)].slice(0,5),
      unknowns:[...(layer?.unknowns.map(f=>f.statement)??[]),...payload.unknownItems].slice(0,5),
      limitations:[...(report.status==="evidence_insufficient"?["证据仍不充分；此条件尚未被证明。"]:[]),...(report.currentness.status==="historical"?["报告当前性已变化；请核对历史来源。"]:[]),...report.gateFailures.slice(0,3)]}];
  }) : [];
  const reasoning=data?.operatingReasoning??null;
  const current=contextModel?.thesisBinding??null;
  const ended=contextModel?.thesisOwnerAction?.action==="INVALIDATE_OR_END_THESIS";
  const currentLineage=projectCurrentLineage(contextModel,current);
  const unavailable=workspace.status!=="available"||!data||data.target.membershipState!=="tracked"||!identity.symbol||data.target.membershipId!==workspace.membershipId;
  const status:ThesisFormationStatus=unavailable?"UNAVAILABLE":ended?"ENDED_REQUIRES_NEW_LINEAGE":current?"BOUND":options.length?"READY_TO_SELECT":"NEEDS_DEEP_RESEARCH";
  const selectedOption=current?options.find(option=>sameThesisIdentity(option.binding,current))??null:null;
  const nextOwnerAction= status==="READY_TO_SELECT"?{kind:"SELECT_THESIS" as const,label:"明确选择一条正式 Thesis"}:
    status==="NEEDS_DEEP_RESEARCH"?{kind:"DEEP_RESEARCH" as const,label:"继续已有 Deep Research / Research Question 流程"}:
    status==="BOUND"?{kind:"CURRENT_BASE" as const,label:"进入 Current Base / Re-underwriting"}:
    status==="ENDED_REQUIRES_NEW_LINEAGE"?{kind:"REVISE_THESIS" as const,label:"进入正式 Thesis revision / new lineage"}:
    {kind:"RELOAD" as const,label:"研究身份或读取不可用；重新读取"};
  const base={schemaVersion:"thesis-formation-v1" as const,...identity,status,contextId,currentFormalThesis:current,currentLineage,options,selectedOption,
    counterevidence:selectedOption?.counterevidence??[],unknowns:selectedOption?.unknowns??[],nextResearchQuestion:reasoning?.nextResearchQuestion??null,
    limitations:status==="UNAVAILABLE"?["研究身份或读取不可用；没有选择或写入。"]:selectedOption?.limitations??[],nextOwnerAction};
  return {...base,generatedAt:now.toISOString(),projectionFingerprint:operatingModelFingerprint(base)};
}
