import {operatingModelFingerprint,operatingInputUnit,type OperatingFact,type OperatingPeriod,type OperatingResearchModel,type OperatingScenarioKey,type OperatingScenarioResult} from "./researchOperatingModel.js";
import {keyAssumptions,scenarioPeriod,type ResearchScenarioVersion,type ScenarioPeriodType} from "./researchUnderwriting.js";
import {calculateOperatingScenarios} from "./researchOperatingCalculations.js";
import type {ResearchOperatingReasoning} from "./researchOperatingReasoning.js";
import type {ThesisFormationProjection} from "./thesisFormation.js";
import {currentThesisText} from "./thesisFormation.js";

export type CurrentBaseFormationStatus="NEEDS_FORMAL_THESIS"|"READY_FOR_INPUT"|"BLOCKED_BY_UNKNOWN"|"READY_TO_SAVE"|"CURRENT_BASE_SAVED"|"CURRENT_BASE_REVIEW_REQUIRED"|"UNAVAILABLE";
export type FormationInputClass="OBSERVED_FACT"|"GUIDANCE"|"OWNER_ASSUMPTION"|"DETERMINISTIC"|"UNKNOWN";
export interface FormationSourceLead {id:string;metric:string;category:"OBSERVED_FACT"|"GUIDANCE";value:number;unit:string;currency:string|null;period:OperatingPeriod;periodMatchesDraft:boolean;sourceUrl:string;publishedAt:string;limitation:string}
export interface FormationInput {variable:string;classification:FormationInputClass;value:number|null;unit:string;currency:string|null;period:OperatingPeriod|null;reason:string;basedOnFactIds:string[];basedOnGuidanceIds:string[];sourceLeads:FormationSourceLead[]}
export interface CurrentBaseFormationProjection {
 schemaVersion:"current-base-formation-v1";actorScope:{actorType:string;actorId:string};symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType;
 status:CurrentBaseFormationStatus;contextId:string|null;formalThesis:ThesisFormationProjection["currentLineage"];
 inputs:FormationInput[];calculationPreview:{draftOnly:true;calculationVersion:"underwriting-calculation-v1";status:"complete"|"incomplete"|"unavailable";calculations:OperatingScenarioResult["calculations"];revenue:number|null;normalizedProfit:number|null;equityValue:number|null;shares:number|null;perShareValue:number|null;missing:string[]};
 blockingUnknowns:string[];warnings:string[];existingCurrentBase:{scenarioId:string;version:number;period:OperatingPeriod;status:"COMPLETE"|"INCOMPLETE"|"REVIEW_REQUIRED";assumptionCount:number;normalizedProfit:number|null}|null;
 nextOwnerAction:{kind:"FORM_THESIS"|"ENTER_INPUTS"|"SAVE_CURRENT_BASE"|"VIEW_CURRENT_BASE"|"REUNDERWRITE"|"RELOAD";label:string};
 generatedAt:string;projectionFingerprint:string;
}
const metricFor=(variable:string)=>variable==="asp"?"average_selling_price":variable;
function sourceLeads(variable:string,facts:OperatingFact[],period:OperatingPeriod|null):FormationSourceLead[]{
 if(variable==="pe"||variable==="fx")return [];
 const metrics=variable==="shares"?["shares_outstanding","issued_shares"]:[metricFor(variable)];
 return facts.filter(f=>metrics.includes(f.metric)).sort((a,b)=>b.period.end.localeCompare(a.period.end)).slice(0,4).map(f=>({id:f.id,metric:f.metric,category:f.category==="guidance"?"GUIDANCE" as const:"OBSERVED_FACT" as const,value:f.value*f.unitScale,unit:f.unit,currency:f.currency,period:f.period,periodMatchesDraft:!!period&&operatingModelFingerprint(f.period)===operatingModelFingerprint(period),sourceUrl:f.source.sourceUrl,publishedAt:f.source.publishedAt,limitation:f.limitation}));
}
function draftInputs(model:OperatingResearchModel|null,facts:OperatingFact[],period:ScenarioPeriodType):FormationInput[]{
 const selected=model&&scenarioPeriod(model)?.type===period?model:null;
 const draft=selected?.scenarios.find(s=>s.name==="base")??null;
 const periodValue=draft?.period??null,currency=draft?.currency??null;
 const keys=model?keyAssumptions(model).map(a=>a.variable):["sales_volume","asp","revenue","gross_margin","opex","net_adjustments","normalized_profit","pe"];
 const inputs:FormationInput[]=keys.map((variable):FormationInput=>{
  const input=draft?(variable==="other_revenue"?draft.revenueComposition?.otherRevenue:draft.inputs[variable as OperatingScenarioKey]):null;
  const fact=input?.sourceValueId?facts.find(f=>f.id===input.sourceValueId):null;
  const classification:FormationInputClass=input?.origin==="owner_assumption"?"OWNER_ASSUMPTION":input?.origin==="source_fact"&&fact?.category==="actual"?"OBSERVED_FACT":input?.origin==="source_fact"&&fact?.category==="guidance"?"GUIDANCE":"UNKNOWN";
  return {variable,classification,value:input?.value??null,unit:input?.unit??(variable==="other_revenue"?"currency":operatingInputUnit(variable as OperatingScenarioKey)),currency:["currency","currency_per_vehicle"].includes(input?.unit??"")?currency:null,period:periodValue,reason:input?.rationale?.reason??input?.note??"",basedOnFactIds:[...(input?.sourceValueId?[input.sourceValueId]:[]),...(input?.rationale?.basedOnFactIds??[])],basedOnGuidanceIds:input?.rationale?.basedOnGuidanceIds??[],sourceLeads:sourceLeads(variable,facts,periodValue)};
 });
 const sharesFact=selected?.sharesValueId?facts.find(f=>f.id===selected.sharesValueId):null;
 inputs.push({variable:"shares",classification:selected?.sharesReferenceConfirmed&&sharesFact?"OBSERVED_FACT":"UNKNOWN",value:selected?.sharesReferenceConfirmed&&sharesFact?sharesFact.value*sharesFact.unitScale:null,unit:"shares",currency:null,period:sharesFact?.period??null,reason:selected?.sharesReferenceConfirmed?"Owner 已确认有日期的股本参考":"尚未确认有日期的股本参考",basedOnFactIds:sharesFact?[sharesFact.id]:[],basedOnGuidanceIds:[],sourceLeads:sourceLeads("shares",facts,null)});
 inputs.push({variable:"fx",classification:selected?.fx?.ownerConfirmed?"OWNER_ASSUMPTION":"UNKNOWN",value:selected?.fx?.rate??null,unit:"ratio",currency:selected?.fx?.to??null,period:null,reason:selected?.fx?.note??"",basedOnFactIds:[],basedOnGuidanceIds:[],sourceLeads:[]});
 return inputs;
}
function withDeterministicRows(inputs:FormationInput[],base:OperatingScenarioResult|null):FormationInput[]{
 const calculations=base?.calculations??[];
 const rows=inputs.map(input=>{
  const calculated=calculations.find(c=>c.metric===input.variable);
  return calculated&&input.classification==="UNKNOWN"?{...input,classification:"DETERMINISTIC" as const,value:calculated.value,reason:calculated.formula}:input;
 });
 for(const metric of ["automotive_revenue","gross_profit"]){
  const calculated=calculations.find(c=>c.metric===metric);
  if(calculated&&base)rows.push({variable:metric,classification:"DETERMINISTIC",value:calculated.value,unit:"currency",currency:base.currency,period:base.period,reason:calculated.formula,basedOnFactIds:[],basedOnGuidanceIds:[],sourceLeads:[]});
 }
 const order=["sales_volume","asp","automotive_revenue","other_revenue","revenue","gross_margin","gross_profit","opex","net_adjustments","normalized_profit","shares","fx","pe"];
 return rows.sort((a,b)=>order.indexOf(a.variable)-order.indexOf(b.variable));
}
function nextAction(status:CurrentBaseFormationStatus):CurrentBaseFormationProjection["nextOwnerAction"]{
 switch(status){
  case "NEEDS_FORMAL_THESIS":return {kind:"FORM_THESIS",label:"先明确建立正式 Thesis"};
  case "READY_FOR_INPUT":case "BLOCKED_BY_UNKNOWN":return {kind:"ENTER_INPUTS",label:"补齐明确的 Owner 假设与来源"};
  case "READY_TO_SAVE":return {kind:"SAVE_CURRENT_BASE",label:"核对并正式保存 Current Base"};
  case "CURRENT_BASE_SAVED":return {kind:"VIEW_CURRENT_BASE",label:"查看当前正式 Current Base"};
  case "CURRENT_BASE_REVIEW_REQUIRED":return {kind:"REUNDERWRITE",label:"当前 Base 需要重新审视"};
  default:return {kind:"RELOAD",label:"研究身份或读取不可用；重新读取"};
 }
}
function previewFor(base:OperatingScenarioResult|null):CurrentBaseFormationProjection["calculationPreview"]{
 return {draftOnly:true,calculationVersion:"underwriting-calculation-v1",status:base?.status??"unavailable",calculations:base?.calculations??[],revenue:base?.revenue??null,normalizedProfit:base?.normalizedProfit??null,equityValue:base?.equityValue??null,shares:base?.shares??null,perShareValue:base?.perShareValue??null,missing:base?.missing??[]};
}
function blockersFor(periodMatches:boolean,base:OperatingScenarioResult|null,model:OperatingResearchModel|null):string[]{
 return [...new Set([...(!periodMatches?["所选期间尚无独立草稿；需明确切换并重新输入假设"]:base?.missing??[]),...(periodMatches&&!model?.sharesClass?["股本类别尚未由 Owner 确认"]:[])])];
}
function existingFor(current:ResearchScenarioVersion|null,currentBaseStatus:"NONE"|"COMPLETE"|"INCOMPLETE"|"REVIEW_REQUIRED",thesis:ThesisFormationProjection,reasoning:ResearchOperatingReasoning|null):CurrentBaseFormationProjection["existingCurrentBase"]{
 if(!current)return null;
 const savedLineage=current.model.thesisOwnerAction?.lineageId??(current.model.thesisBinding?operatingModelFingerprint(current.model.thesisBinding):null);
 const savedText=currentThesisText(current.model);
 const textDrift=savedText!==thesis.currentLineage?.currentThesisText;
 const savedStatus=savedLineage!==thesis.currentLineage?.lineageId||textDrift?"REVIEW_REQUIRED":currentBaseStatus;
 const recalculated=reasoning?calculateOperatingScenarios(current.model,reasoning.facts,reasoning.reverseValuation.observed?.currency??current.model.fx?.to??null).find(s=>s.name==="base"):null;
 return {scenarioId:current.scenarioId,version:current.version,period:current.period,status:savedStatus==="NONE"?"INCOMPLETE":savedStatus,assumptionCount:current.assumptions.length,normalizedProfit:recalculated?.normalizedProfit??null};
}
function formationStatus(thesis:ThesisFormationProjection,existing:CurrentBaseFormationProjection["existingCurrentBase"],reasoning:ResearchOperatingReasoning|null,periodMatches:boolean,base:OperatingScenarioResult|null,blockers:string[],inputs:FormationInput[]):CurrentBaseFormationStatus{
 if(thesis.status==="UNAVAILABLE")return "UNAVAILABLE";
 if(thesis.status!=="BOUND"||thesis.currentLineage?.state!=="ACTIVE")return "NEEDS_FORMAL_THESIS";
 if(existing?.status==="REVIEW_REQUIRED")return "CURRENT_BASE_REVIEW_REQUIRED";
 if(existing)return "CURRENT_BASE_SAVED";
 if(!reasoning)return "UNAVAILABLE";
 if(periodMatches&&base?.status==="complete"&&blockers.length===0)return "READY_TO_SAVE";
 return inputs.some(i=>i.classification!=="UNKNOWN"||i.sourceLeads.some(f=>f.category==="OBSERVED_FACT"))?"BLOCKED_BY_UNKNOWN":"READY_FOR_INPUT";
}
export function projectCurrentBaseFormation(thesis:ThesisFormationProjection,reasoning:ResearchOperatingReasoning|null,period:ScenarioPeriodType,current:ResearchScenarioVersion|null,currentBaseStatus:"NONE"|"COMPLETE"|"INCOMPLETE"|"REVIEW_REQUIRED",now=new Date()):CurrentBaseFormationProjection{
 const model=reasoning?.model??null,periodMatches=!!model&&scenarioPeriod(model)?.type===period;
 const base=periodMatches?reasoning?.scenarios.find(s=>s.name==="base")??null:null;
 const inputs=withDeterministicRows(draftInputs(model,reasoning?.facts??[],period),base);
 const preview=previewFor(base),blockers=blockersFor(periodMatches,base,model),existing=existingFor(current,currentBaseStatus,thesis,reasoning);
 const status=formationStatus(thesis,existing,reasoning,periodMatches,base,blockers,inputs);
 const warnings=[...(periodMatches?[]:["本财年与下一个报告期的草稿及假设互不继承。"]),"销量事实不能自动推出收入或利润；历史 ASP、Guidance、PE 与 FX 均不会自动填入。"];
 const content={schemaVersion:"current-base-formation-v1" as const,actorScope:thesis.actorScope,symbol:thesis.symbol,membershipId:thesis.membershipId,membershipVersion:thesis.membershipVersion,scenarioPeriodType:period,status,contextId:thesis.contextId,formalThesis:thesis.currentLineage,inputs,calculationPreview:preview,blockingUnknowns:blockers,warnings,existingCurrentBase:existing,nextOwnerAction:nextAction(status)};
 return {...content,generatedAt:now.toISOString(),projectionFingerprint:operatingModelFingerprint(content)};
}
export function unavailableCurrentBaseFormation(scope:{actorScope:{actorType:string;actorId:string};symbol:string;membershipId:string;membershipVersion:number},period:ScenarioPeriodType,now=new Date()):CurrentBaseFormationProjection{
 const content={schemaVersion:"current-base-formation-v1" as const,...scope,scenarioPeriodType:period,status:"UNAVAILABLE" as const,contextId:null,formalThesis:null,inputs:[],calculationPreview:{draftOnly:true as const,calculationVersion:"underwriting-calculation-v1" as const,status:"unavailable" as const,calculations:[],revenue:null,normalizedProfit:null,equityValue:null,shares:null,perShareValue:null,missing:[]},blockingUnknowns:[],warnings:["研究身份或读取暂不可用；未使用不一致结果。"],existingCurrentBase:null,nextOwnerAction:nextAction("UNAVAILABLE")};
 return {...content,generatedAt:now.toISOString(),projectionFingerprint:operatingModelFingerprint(content)};
}
