import {operatingModelFingerprint,type OperatingFact,type OperatingMarketObservation,type OperatingResearchModel,type OperatingScenarioInput,type OperatingScenarioKey,type OperatingPeriod} from "./researchOperatingModel.js";
import {calculateOperatingScenarios,calculateReverseValuation,calculateConditionalRequirements,calculateSensitivity,buildSharesReference} from "./researchOperatingCalculations.js";
import type {ResearchOperatingReasoning} from "./researchOperatingReasoning.js";
import type {ThesisUpdateDraft} from "./researchDecisionUpdate.js";

export type ScenarioPeriodType="CURRENT_FY"|"NEXT_REPORTING_PERIOD";
export type UnderwritingStatus="AVAILABLE"|"INCOMPLETE"|"STALE_MARKET_INPUT"|"ASSUMPTION_REQUIRED"|"MULTIPLE_FREE_VARIABLES";
export type OwnerThesisAction="KEEP_CURRENT_THESIS"|"REVISE_THESIS"|"INSUFFICIENT_EVIDENCE_CONTINUE"|"INVALIDATE_OR_END_THESIS";
export interface ResearchAssumption {
 assumptionId:string;scenarioId:string;scenarioVersion:number;variable:string;value:number|null;unit:string;currency:string|null;period:OperatingPeriod;
 origin:"OWNER_ASSUMPTION"|"SOURCE_FACT"|"DETERMINISTIC_CALCULATION"|"UNKNOWN";basedOnFactIds:string[];basedOnGuidanceIds:string[];reason:string;
 createdAt:string;createdBy:string;supersedesAssumptionId:string|null;status:"ACTIVE"|"SUPERSEDED"|"INVALIDATED";
}
export interface ResearchScenarioVersion {
 scenarioId:string;version:number;parentVersion:number|null;contextId:string;symbol:string;membershipId:string;membershipVersion:number;
 scenarioPeriodType:ScenarioPeriodType;period:OperatingPeriod;assumptions:ResearchAssumption[];modelFingerprint:string;calculationVersion:"underwriting-calculation-v1";
 changeReason:string;createdAt:string;actor:string;model:OperatingResearchModel;
}
export interface ResearchBaselineSnapshot {
 baselineId:string;symbol:string;membershipId:string;membershipVersion:number;reportId:string|null;reportVersion:number|null;reportFingerprint:string|null;
 originalThesisIdentity:OperatingResearchModel["thesisBinding"];thesisLineageId?:string|null;currentContextId:string;factSetFingerprint:string;factIds:string[];seriesFingerprint:string;
 scenarioSetId:string;scenarioVersion:number;assumptionFingerprint:string;price:number|null;priceCurrency:string|null;priceAsOf:string|null;quoteIdentity:string|null;
 sharesIdentity:string|null;sharesAsOf:string|null;fxIdentity:string|null;fxAsOf:string|null;testsFingerprint:string|null;expectationGapAtCreation:number|null;calculationVersion:string;createdAt:string;actor:string;
}
export interface ResearchScenarioChange {variable:string;before:number|null;after:number|null;kind:"NEW_FACT"|"OWNER_ASSUMPTION_CHANGED"|"GUIDANCE_CHANGED"|"CALCULATION_CHANGED"|"MARKET_INPUT_CHANGED";reason:string}
export interface ResearchScenarioDiff {fromVersion:number|null;toVersion:number;assumptionChanges:ResearchScenarioChange[];newFactIds:string[];guidanceChanges:string[];calculationChanged:boolean;marketInputChanges:string[]}
export interface ResearchExpectationGap {
 status:UnderwritingStatus;ownerBase:number|null;conditionalMarketImplied:number|null;absoluteGap:number|null;percentageGap:number|null;currency:string|null;
 centralPE:number|null;peAssumptionId:string|null;currentBaseVersion:number|null;inputIdentities:{price:string|null;priceAsOf:string|null;shares:string|null;sharesAsOf:string|null;fx:string|null;fxAsOf:string|null;calculationVersion:string};reasons:string[];
}
export interface ResearchWhatMustBeTrue {status:UnderwritingStatus;normalizedEarningsRequired:number|null;revenueRequired:number|null;grossMarginRequired:number|null;fixedInputs:string[];freeVariable:string|null;solvedVariable:string|null;assumptionIds:string[];calculationVersion:string;explanation:string}
export interface ResearchPriceSinceBaseline {baselinePrice:number;baselineAsOf:string;currentPrice:number;currentAsOf:string;currency:string;change:number;changeRatio:number}
export interface ResearchBaselineComparison {factsChanged:boolean;assumptionsChanged:boolean;scenarioChanged:boolean;priceChanged:boolean;sharesChanged:boolean;fxChanged:boolean;testsChanged:boolean;expectationGapChanged:boolean|null}
export interface ResearchNextValidationEvent {description:string;expectedEvidence:string;targetDate:string|null}
export interface ResearchThesisActionEvent {actionId:string;action:OwnerThesisAction;originalThesisIdentity:OperatingResearchModel["thesisBinding"];lineageId:string;previousLineageId:string|null;newThesis:string|null;ownerReason:string;endedAt:string|null;triggeringFactIds:string[];nextValidationEvent:ResearchNextValidationEvent;baselineId:string|null;confirmedAt:string;actor:string}
export interface ReunderwritingDraft {status:"DRAFT";originalThesis:OperatingResearchModel["thesisBinding"];baselineId:string|null;validationTests:ThesisUpdateDraft["tests"];testResults:ThesisUpdateDraft["overallEvidence"];newFactsSinceBaseline:string[];earningsExpectationChanges:ResearchScenarioChange[];scenarioChanges:ResearchScenarioDiff|null;marketObservedChanges:string[];conditionalMarketImplied:number|null;expectationGap:ResearchExpectationGap;counterevidence:string[];unknowns:string[];nextValidationEvent:ResearchNextValidationEvent;ownerDraftInterpretation:string;thesisDrift:{changed:boolean;oldReason:string;newReason:string;addedAssumptions:string[];removedAssumptions:string[];changedValidationEvents:boolean};availableOwnerActions:OwnerThesisAction[]}
export interface UnderwritingCalculationProof {calculationVersion:"underwriting-calculation-v1";formulaIdentity:string;inputsFingerprint:string;resultFingerprint:string}
export interface ResearchUnderwritingProjection {symbol:string;membershipId:string;membershipVersion:number;currentBase:ResearchScenarioVersion|null;previousBase:ResearchScenarioVersion|null;baseline:ResearchBaselineSnapshot|null;draftBaseStatus:"complete"|"incomplete";currentBaseStatus:"NONE"|"COMPLETE"|"INCOMPLETE"|"REVIEW_REQUIRED";baselineComparison:ResearchBaselineComparison|null;scenarioDiff:ResearchScenarioDiff|null;deterministicCalculations:ScenarioResult["calculations"];marketObserved:OperatingMarketObservation|null;conditionalImplied:{status:UnderwritingStatus;normalizedEarnings:number|null;currency:string|null;assumedPE:number|null;reason:string}|null;expectationGap:ResearchExpectationGap;whatMustBeTrue:ResearchWhatMustBeTrue;peSensitivity:Array<{pe:number;perShareValue:number|null}>;priceSinceBaseline:ResearchPriceSinceBaseline|null;reunderwritingDraft:ReunderwritingDraft;thesisActions:ResearchThesisActionEvent[];calculationProof:UnderwritingCalculationProof}

export function scenarioPeriod(model:OperatingResearchModel):{type:ScenarioPeriodType;period:OperatingPeriod}|null {
 const base=model.scenarios.find(s=>s.name==="base");if(!base)return null;
 const type=base.scenarioPeriodType??"CURRENT_FY";
 if(model.scenarios.some(s=>(s.scenarioPeriodType??"CURRENT_FY")!==type||operatingModelFingerprint(s.period)!==operatingModelFingerprint(base.period)))return null;
 if(type==="CURRENT_FY"&&base.period.type!=="annual"||type==="NEXT_REPORTING_PERIOD"&&base.period.type!=="interim")return null;
 return {type,period:base.period};
}
export function keyAssumptions(model:OperatingResearchModel):Array<{variable:string;input:OperatingScenarioInput}>{
 const base=model.scenarios.find(s=>s.name==="base");if(!base)return [];
 const keys:[OperatingScenarioKey,...OperatingScenarioKey[]]=["sales_volume","asp","revenue","gross_margin","opex","net_adjustments","normalized_profit","pe"];
 return [...keys.map(variable=>({variable,input:base.inputs[variable]})),...(base.revenueComposition?[{variable:"other_revenue",input:base.revenueComposition.otherRevenue}]:[])];
}
function assumptionMeaning(a:ResearchAssumption) {
 return {variable:a.variable,value:a.value,unit:a.unit,currency:a.currency,period:a.period,origin:a.origin,basedOnFactIds:[...a.basedOnFactIds].sort(),basedOnGuidanceIds:[...a.basedOnGuidanceIds].sort(),reason:a.reason};
}
export function semanticAssumptionFingerprint(assumptions:ResearchAssumption[]):string {
 return operatingModelFingerprint(assumptions.filter(a=>a.variable!=="fx").map(assumptionMeaning).sort((a,b)=>a.variable.localeCompare(b.variable)));
}
export function assumptionLedger(model:OperatingResearchModel,scenarioId:string,version:number,actor:string,createdAt:string,prior:ResearchScenarioVersion|null):ResearchAssumption[]{
 const period=scenarioPeriod(model)?.period??model.scenarios[1]!.period,currency=model.scenarios[1]!.currency;
 const entries:ResearchAssumption[]=keyAssumptions(model).map(({variable,input})=>{
  const previous=prior?.assumptions.find(a=>a.variable===variable);
  const origin:ResearchAssumption["origin"]=input.origin==="owner_assumption"?"OWNER_ASSUMPTION":input.origin==="source_fact"?"SOURCE_FACT":"UNKNOWN";
  const basedOnFactIds=[...(input.sourceValueId?[input.sourceValueId]:[]),...(input.rationale?.basedOnFactIds??[])];
  const reason=input.rationale?.reason??input.note;
  const meaning={variable,value:input.value,unit:input.unit,currency:["currency","currency_per_vehicle"].includes(input.unit)?currency:null,period,origin,basedOnFactIds:[...new Set(basedOnFactIds)],basedOnGuidanceIds:input.rationale?.basedOnGuidanceIds??[],reason};
  const unchanged=previous&&operatingModelFingerprint(assumptionMeaning(previous))===operatingModelFingerprint({...meaning,basedOnFactIds:[...meaning.basedOnFactIds].sort(),basedOnGuidanceIds:[...meaning.basedOnGuidanceIds].sort()});
  return {assumptionId:unchanged?previous.assumptionId:operatingModelFingerprint({scenarioId,meaning}),scenarioId,scenarioVersion:version,...meaning,createdAt,createdBy:actor,supersedesAssumptionId:unchanged?null:previous?.assumptionId??null,status:"ACTIVE"};
 });
 if(model.fx){const previous=prior?.assumptions.find(a=>a.variable==="fx");const meaning={variable:"fx",value:model.fx.rate,unit:"exchange_rate",currency:model.fx.to,period,origin:"OWNER_ASSUMPTION" as const,basedOnFactIds:[],basedOnGuidanceIds:[],reason:model.fx.note};const unchanged=previous&&operatingModelFingerprint(assumptionMeaning(previous))===operatingModelFingerprint(meaning);entries.push({assumptionId:unchanged?previous.assumptionId:operatingModelFingerprint({scenarioId,meaning,fxIdentity:model.fx}),scenarioId,scenarioVersion:version,...meaning,createdAt,createdBy:actor,supersedesAssumptionId:unchanged?null:previous?.assumptionId??null,status:"ACTIVE"});}
 return entries;
}
export function scenarioChanges(current:ResearchScenarioVersion,previous:ResearchScenarioVersion|null):ResearchScenarioDiff {
 const changes:ResearchScenarioChange[]=current.assumptions.flatMap(a=>{const old=previous?.assumptions.find(p=>p.variable===a.variable);if(a.variable==="fx"||!old||operatingModelFingerprint(assumptionMeaning(old))===operatingModelFingerprint(assumptionMeaning(a)))return [];return [{variable:a.variable,before:old.value,after:a.value,kind:a.basedOnGuidanceIds.some(id=>!old.basedOnGuidanceIds.includes(id))?"GUIDANCE_CHANGED" as const:a.origin==="SOURCE_FACT"?"NEW_FACT" as const:"OWNER_ASSUMPTION_CHANGED" as const,reason:a.reason}];});
 const oldFacts=new Set(previous?.assumptions.flatMap(a=>a.basedOnFactIds)??[]);
 return {fromVersion:previous?.version??null,toVersion:current.version,assumptionChanges:changes,newFactIds:[...new Set(current.assumptions.flatMap(a=>a.basedOnFactIds).filter(id=>!oldFacts.has(id)))],guidanceChanges:[...new Set(current.assumptions.flatMap(a=>a.basedOnGuidanceIds).filter(id=>!previous?.assumptions.some(p=>p.basedOnGuidanceIds.includes(id))))],calculationChanged:previous!==null&&previous.calculationVersion!==current.calculationVersion,marketInputChanges:previous===null?[]:[...(previous.model.sharesValueId!==current.model.sharesValueId||previous.model.sharesClass!==current.model.sharesClass?["shares_reference"]:[]),...(operatingModelFingerprint(previous.model.fx)!==operatingModelFingerprint(current.model.fx)?["fx_reference"]:[])]};
}
export function validNextValidationEvent(v:unknown):v is ResearchNextValidationEvent {if(!v||typeof v!=="object"||Array.isArray(v))return false;const o=v as Record<string,unknown>;return Object.keys(o).sort().join()===["description","expectedEvidence","targetDate"].sort().join()&&typeof o.description==="string"&&o.description.trim().length>0&&o.description.length<=1000&&typeof o.expectedEvidence==="string"&&o.expectedEvidence.trim().length>0&&o.expectedEvidence.length<=1000&&(o.targetDate===null||typeof o.targetDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(o.targetDate)&&!Number.isNaN(Date.parse(o.targetDate)));}

function marketStatus(reason:string[]):UnderwritingStatus {if(reason.some(r=>r.includes("price")))return "STALE_MARKET_INPUT";if(reason.some(r=>r.includes("PE")||r.includes("FX")||r.includes("shares")))return "ASSUMPTION_REQUIRED";return "INCOMPLETE";}
function baselinePrice(b:ResearchBaselineSnapshot|null,observed:OperatingMarketObservation|null):ResearchPriceSinceBaseline|null {if(!b?.price||!b.priceAsOf||!b.priceCurrency||!observed||b.priceCurrency!==observed.currency)return null;return {baselinePrice:b.price,baselineAsOf:b.priceAsOf,currentPrice:observed.price,currentAsOf:observed.asOf,currency:observed.currency,change:observed.price-b.price,changeRatio:(observed.price-b.price)/b.price};}
type ScenarioResult=ReturnType<typeof calculateOperatingScenarios>[number];
type ReverseResult=ReturnType<typeof calculateReverseValuation>;
type SharesReference=ReturnType<typeof buildSharesReference>;
type ImpliedResult=NonNullable<ReverseResult["implied"]>;
export function underwritingSharesIdentity(model:OperatingResearchModel|null,share:SharesReference):string|null {return model?.sharesClass&&share?operatingModelFingerprint({share,shareClass:model.sharesClass}):null;}
function gapIdentities(model:OperatingResearchModel|null,observed:OperatingMarketObservation|null,share:SharesReference):ResearchExpectationGap["inputIdentities"] {
 const fx=model?.fx??null;
 return {price:observed?operatingModelFingerprint(observed):null,priceAsOf:observed?.asOf??null,shares:underwritingSharesIdentity(model,share),sharesAsOf:share?.period.end??null,fx:fx?operatingModelFingerprint(fx):model&&observed&&model.scenarios[1]?.currency===observed.currency?"same_currency":null,fxAsOf:fx?.asOf??null,calculationVersion:"underwriting-calculation-v1"};
}
function gapValues(status:UnderwritingStatus,current:ResearchScenarioVersion|null,model:OperatingResearchModel|null,base:ScenarioResult|null,implied:ImpliedResult|null,observed:OperatingMarketObservation|null,share:SharesReference,reasons:string[]):ResearchExpectationGap {
 const ownerBase=status==="AVAILABLE"?base?.normalizedProfit??null:null,marketImplied=status==="AVAILABLE"?implied?.normalizedEarnings??null:null;
 const centralPE=model?.scenarios.find(s=>s.name==="base")?.inputs.pe.value??null;
 return {status,ownerBase,conditionalMarketImplied:marketImplied,absoluteGap:ownerBase!==null&&marketImplied!==null?ownerBase-marketImplied:null,percentageGap:ownerBase!==null&&marketImplied!==null&&marketImplied!==0?(ownerBase-marketImplied)/Math.abs(marketImplied):null,currency:ownerBase!==null?base?.currency??null:null,centralPE,peAssumptionId:current?.assumptions.find(a=>a.variable==="pe")?.assumptionId??null,currentBaseVersion:current?.version??null,inputIdentities:gapIdentities(model,observed,share),reasons};
}
function gapProjection(current:ResearchScenarioVersion|null,model:OperatingResearchModel|null,base:ScenarioResult|null,reverse:ReverseResult|null,observed:OperatingMarketObservation|null,share:SharesReference,stale:boolean,annual:boolean) {
 const shareClassReady=!!model?.sharesClass;
 const implied=annual&&!stale&&shareClassReady?reverse?.implied??null:null;
 const reasons=[...(reverse?.reasons??["Current Base Scenario version unavailable"]),...(!annual&&current?["PE annual basis cannot use a next reporting period without explicit annualization"]:[])];
 if(stale)reasons.push("Current Base cites an invalidated or superseded source fact; review required");
 if(model?.sharesReferenceConfirmed&&!shareClassReady)reasons.push("confirmed shares class required");
 const status:UnderwritingStatus=!current||stale?"INCOMPLETE":!annual?"ASSUMPTION_REQUIRED":!implied?marketStatus(reasons):base?.status!=="complete"?"INCOMPLETE":"AVAILABLE";
 const centralPE=model?.scenarios.find(s=>s.name==="base")?.inputs.pe.value??null;
 const gap=gapValues(status,current,model,base,implied,observed,share,reasons);
 const conditional:ResearchUnderwritingProjection["conditionalImplied"]=reverse&&annual?{status:implied?"AVAILABLE":marketStatus(reasons),normalizedEarnings:implied?.normalizedEarnings??null,currency:implied?.currency??null,assumedPE:implied?.assumedPE??centralPE,reason:implied?`在 Owner PE = ${implied.assumedPE}×、当前价格 / 股本 / FX 条件下对应的正常化盈利；不是市场真实共同预期。`:reasons.join("；")}:null;
 return {gap,conditional,implied};
}
function requiredInputs(model:OperatingResearchModel|null,base:ScenarioResult|null):string[] {
 if(!model)return [];
 return keyAssumptions(model).filter(a=>["revenue","gross_margin","opex","net_adjustments"].includes(a.variable)&&a.input.origin==="unknown"&&(a.variable!=="revenue"||base?.revenue===null)).map(a=>a.variable);
}
function whatMustBeTrue(model:OperatingResearchModel|null,current:ResearchScenarioVersion|null,base:ScenarioResult|null,reverse:ReverseResult|null,scenarios:ReturnType<typeof calculateOperatingScenarios>,implied:ImpliedResult|null,gapStatus:UnderwritingStatus):ResearchWhatMustBeTrue {
 const requirements=model&&reverse?calculateConditionalRequirements(model,reverse,scenarios):null,free=requiredInputs(model,base),multiple=free.length>=2;
 const solved=free.length===1&&["revenue","gross_margin"].includes(free[0]!)?free[0]!:null;
 return {status:!implied?gapStatus:multiple?"MULTIPLE_FREE_VARIABLES":free.length>0&&!solved?"INCOMPLETE":"AVAILABLE",normalizedEarningsRequired:implied?.normalizedEarnings??null,revenueRequired:solved==="revenue"?requirements?.revenue??null:null,grossMarginRequired:solved==="gross_margin"?requirements?.margin??null:null,fixedInputs:multiple||free.length>0&&!solved?[]:solved==="revenue"?["Gross Margin","Opex","adjustments","Owner central PE","shares","FX"]:solved==="gross_margin"?["Revenue","Opex","adjustments","Owner central PE","shares","FX"]:["Current Base","Owner central PE","shares","FX"],freeVariable:free.length===1?free[0]!:null,solvedVariable:solved,assumptionIds:current?.assumptions.filter(a=>a.variable!=="fx").map(a=>a.assumptionId)??[],calculationVersion:"underwriting-calculation-v1",explanation:implied?multiple?"收入和毛利率均未固定，不能反解单一要求。":solved?"在其它 Current Base 输入及 Owner PE 不变的条件下，对应单变量条件值。":free.length?"该自由变量没有已定义的单变量反解；条件隐含盈利仍可参考。":"当前没有可反解的自由变量；只显示条件隐含盈利、预期差和敏感性。":"缺少可复算的当前价格、股本、FX 或 Owner PE。"};
}
function compareBaseline(reasoning:ResearchOperatingReasoning,current:ResearchScenarioVersion|null,baseline:ResearchBaselineSnapshot|null,observed:OperatingMarketObservation|null,share:SharesReference,gap:ResearchExpectationGap):ResearchBaselineComparison|null {
 if(!baseline)return null;
 const facts=reasoning.facts,model=current?.model,tests=reasoning.thesisUpdate?.tests;
 const factSetFingerprint=operatingModelFingerprint(facts.map(f=>({id:f.id,revision:f.revision,identity:f.identity})));
 return {factsChanged:baseline.factSetFingerprint!==factSetFingerprint,assumptionsChanged:baseline.assumptionFingerprint!==semanticAssumptionFingerprint(current?.assumptions??[]),scenarioChanged:baseline.scenarioSetId!==current?.scenarioId||baseline.scenarioVersion!==current?.version,priceChanged:baseline.quoteIdentity!==(observed?operatingModelFingerprint(observed):null),sharesChanged:baseline.sharesIdentity!==underwritingSharesIdentity(model??null,share),fxChanged:baseline.fxIdentity!==(model?.fx?operatingModelFingerprint(model.fx):null),testsChanged:baseline.testsFingerprint!==(tests?operatingModelFingerprint(tests):null),expectationGapChanged:baseline.expectationGapAtCreation===null||gap.absoluteGap===null?null:baseline.expectationGapAtCreation!==gap.absoluteGap};
}
function reunderwritingDraft(reasoning:ResearchOperatingReasoning,baseline:ResearchBaselineSnapshot|null,changes:ResearchScenarioDiff|null,observed:OperatingMarketObservation|null,conditional:ResearchUnderwritingProjection["conditionalImplied"],gap:ResearchExpectationGap,base:ScenarioResult|null):ReunderwritingDraft {
 const revision=reasoning.model.thesisRevision,oldText=reasoning.model.thesisBinding?.conditionText??"",newText=revision?.newThesis??oldText;
 const validation:ResearchNextValidationEvent={description:reasoning.thesisUpdate?.nextValidationEvent??reasoning.nextResearchQuestion,expectedEvidence:reasoning.nextResearchQuestion,targetDate:null};
 const changedFacts=baseline?reasoning.facts.map(f=>f.id).filter(id=>!baseline.factIds.includes(id)):[];
 return {status:"DRAFT",originalThesis:reasoning.model.thesisBinding,baselineId:baseline?.baselineId??null,validationTests:reasoning.thesisUpdate?.tests,testResults:reasoning.thesisUpdate?.overallEvidence,newFactsSinceBaseline:changedFacts,earningsExpectationChanges:changes?.assumptionChanges??[],scenarioChanges:changes,marketObservedChanges:baseline&&observed&&baseline.quoteIdentity!==operatingModelFingerprint(observed)?["Price observation changed; no Thesis or Today action solely from price"]:[],conditionalMarketImplied:conditional?.normalizedEarnings??null,expectationGap:gap,counterevidence:(reasoning.thesisUpdate?.counterevidence??[]).slice(0,3),unknowns:[...(reasoning.thesisUpdate?.unknown??[]),...(base?.missing??[])],nextValidationEvent:validation,ownerDraftInterpretation:"",thesisDrift:{changed:oldText.trim()!==newText.trim(),oldReason:oldText,newReason:newText,addedAssumptions:revision?.addedHypotheses??[],removedAssumptions:revision?.abandonedHypotheses??[],changedValidationEvents:!!revision&&revision.previousValidationEvent!==revision.nextValidationEvent},availableOwnerActions:["KEEP_CURRENT_THESIS","REVISE_THESIS","INSUFFICIENT_EVIDENCE_CONTINUE","INVALIDATE_OR_END_THESIS"]};
}
function proofFor(reasoning:ResearchOperatingReasoning,current:ResearchScenarioVersion|null,baseline:ResearchBaselineSnapshot|null,observed:OperatingMarketObservation|null,share:SharesReference,asOf:string,result:unknown):UnderwritingCalculationProof {
 const facts=reasoning.facts.map(f=>({id:f.id,identity:f.identity,value:f.value,unitScale:f.unitScale,source:f.source,revision:f.revision}));
 const inputs={symbol:reasoning.symbol,membershipId:reasoning.membershipId,membershipVersion:reasoning.membershipVersion,scenarioVersion:current?.version??null,model:current?.model??null,facts,observed,asOf,baseline,share,fx:current?.model.fx??null};
 return {calculationVersion:"underwriting-calculation-v1",formulaIdentity:"operating-scenarios/reverse/conditional-requirements/expectation-gap:v1",inputsFingerprint:operatingModelFingerprint(inputs),resultFingerprint:operatingModelFingerprint(result)};
}
export function calculateUnderwriting(reasoning:ResearchOperatingReasoning,current:ResearchScenarioVersion|null,previous:ResearchScenarioVersion|null,baseline:ResearchBaselineSnapshot|null,actions:ResearchThesisActionEvent[],asOf:string):ResearchUnderwritingProjection {
 const observed=reasoning.reverseValuation.observed,model=current?.model??null,facts=reasoning.facts;
 const scenarios=model?calculateOperatingScenarios(model,facts,observed?.currency??null):[],base=scenarios.find(s=>s.name==="base")??null;
 const reverse=model?calculateReverseValuation(model,facts,observed,scenarios,asOf):null,share=model?buildSharesReference(model,facts):null;
 const ids=new Set(facts.map(f=>f.id)),stale=current?.assumptions.some(a=>a.basedOnFactIds.some(id=>!ids.has(id)))??false,annual=model?scenarioPeriod(model)?.type==="CURRENT_FY":false;
 const {gap,conditional,implied}=gapProjection(current,model,base,reverse,observed,share,stale,annual);
 const what=whatMustBeTrue(model,current,base,reverse,scenarios,implied,gap.status),changes=current?scenarioChanges(current,previous):null;
 const comparison=compareBaseline(reasoning,current,baseline,observed,share,gap);
 if(changes&&comparison?.priceChanged)changes.marketInputChanges.push("price_observation");
 const draft=reunderwritingDraft(reasoning,baseline,changes,observed,conditional,gap,base);
 const sensitivity=model&&base?.status==="complete"?calculateSensitivity(model,facts,observed?.currency??null).filter(s=>s.variable==="pe").map(s=>({pe:s.value,perShareValue:s.perShareValue})):[];
 const priceSinceBaseline=baselinePrice(baseline,observed),result={scenarios,reverse,gap,what,sensitivity,priceSinceBaseline};
 const proof=proofFor(reasoning,current,baseline,observed,share,asOf,result);
 const currentBaseStatus:ResearchUnderwritingProjection["currentBaseStatus"]=!current?"NONE":stale?"REVIEW_REQUIRED":base?.status==="complete"&&!!model?.sharesClass?"COMPLETE":"INCOMPLETE";
 return {symbol:reasoning.symbol,membershipId:reasoning.membershipId,membershipVersion:reasoning.membershipVersion,currentBase:current,previousBase:previous,baseline,draftBaseStatus:reasoning.scenarios.find(s=>s.name==="base")?.status??"incomplete",currentBaseStatus,baselineComparison:comparison,scenarioDiff:changes,deterministicCalculations:base?.calculations.filter(c=>["automotive_revenue","revenue","gross_profit","normalized_profit"].includes(c.metric))??[],marketObserved:observed,conditionalImplied:conditional,expectationGap:gap,whatMustBeTrue:what,peSensitivity:sensitivity,priceSinceBaseline,reunderwritingDraft:draft,thesisActions:actions,calculationProof:proof};
}
export function validateUnderwritingProjection(v:ResearchUnderwritingProjection,reasoning:ResearchOperatingReasoning,asOf:string):boolean {
 const expected=calculateUnderwriting(reasoning,v.currentBase,v.previousBase,v.baseline,v.thesisActions,asOf);
 return operatingModelFingerprint(expected.calculationProof)===operatingModelFingerprint(v.calculationProof)&&operatingModelFingerprint(expected.expectationGap)===operatingModelFingerprint(v.expectationGap)&&operatingModelFingerprint(expected.whatMustBeTrue)===operatingModelFingerprint(v.whatMustBeTrue)&&operatingModelFingerprint(expected.peSensitivity)===operatingModelFingerprint(v.peSensitivity)&&operatingModelFingerprint(expected.deterministicCalculations)===operatingModelFingerprint(v.deterministicCalculations)&&expected.currentBaseStatus===v.currentBaseStatus&&operatingModelFingerprint(expected.baselineComparison)===operatingModelFingerprint(v.baselineComparison);
}
