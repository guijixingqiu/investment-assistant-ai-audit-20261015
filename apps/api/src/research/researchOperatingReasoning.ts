import {selectOperatingAnchor} from "../../../../packages/contracts/src/researchOperatingAnchor.js";
import {evidenceSeries} from "../../../../packages/contracts/src/researchEvidenceSeries.js";
import {factIdentity,assertionIdentity,factRecency,canonicalCurrentFacts} from "../../../../packages/contracts/src/researchFactIdentity.js";
import { projectResearchQuestions } from "../../../../packages/contracts/src/researchQuestions.js";
import { compareGuidance } from "../../../../packages/contracts/src/researchGuidance.js";
import { buildThesisUpdate, researchUpdateNotice, gapReason } from "../../../../packages/contracts/src/researchDecisionUpdate.js";
import { calculateProductMix } from "../../../../packages/contracts/src/researchProductMix.js";
import type { DeepResearchWorkspaceEnvelope } from "../../../../packages/contracts/src/deepResearch.js";
import type { ResearchFundamentalsEnvelope,ResearchFundamentalValueData } from "../../../../packages/contracts/src/researchFundamentals.js";
import type { ResearchContextEnvelope } from "../../../../packages/contracts/src/researchContext.js";
import { emptyOperatingModel,type OperatingFact,type OperatingPeriod,type OperatingMarketObservation,type OperatingResearchModel } from "../../../../packages/contracts/src/researchOperatingModel.js";
import { calculateSensitivity,calculateConditionalRequirements,transmissionNodes,buildProfitBridge,buildSharesReference,calculateOperatingScenarios,calculateReverseValuation } from "../../../../packages/contracts/src/researchOperatingCalculations.js";
import { calculationProofPayload,sameThesisIdentity,calculationFingerprint,explicitThesisOptions,operatingReasoningMatches,reasoningFingerprint,type ResearchOperatingReasoning } from "../../../../packages/contracts/src/researchOperatingReasoning.js";

export function fundamentalOperatingFact(value:ResearchFundamentalValueData,workspace:DeepResearchWorkspaceEnvelope,includeHistory=false):OperatingFact|null {
  const a=value.assertion;
  if(!a||!factWithinWorkspace(value,workspace,includeHistory))return null;
  if(incompleteStructuredVerification(a))return null;
  const material=workspace.data!.materials.find(m=>m.id===value.source.materialId);
  if(!material||material.publishedAt===null||material.revision!==value.source.materialRevision||(!includeHistory&&material.revisionState!=="current")||!["unverified","verified"].includes(material.verificationStatus)||!["authorized_public","user_provided"].includes(material.rightsStatus)||!["issuer_statement","verified_fact"].includes(material.claimType)||Date.parse(material.publishedAt)>Date.parse(workspace.generatedAt))return null;
  const period=fundamentalPeriod(value);
  return {evidenceValidity:value.valueState==="retracted"?"RETRACTED":value.valueState==="invalid"?"INVALID":value.valueState==="replaced"?(value.amendmentKind==="restatement"?"RESTATED":"SUPERSEDED"):value.valueState==="historical_source_superseded"?"SUPERSEDED":"VALID",recordedAt:value.createdAt,amendmentKind:value.amendmentKind,replacesValueId:value.replacesValueId,id:value.id,semanticType:"FACT",derivationMethod:"source_transcription",symbol:value.symbol,membershipId:value.membershipId,membershipVersion:value.membershipVersionAtWrite,metric:value.metric,value:Number(value.value),unit:a.unit,unitScale:value.unitScale,currency:["currency","currency_per_vehicle"].includes(a.unit)?value.currency:null,period,accountingScope:value.scope,businessScope:a.businessScope,measurementBasis:a.measurementBasis,category:a.category,comparability:value.comparability,comparabilityReason:value.comparabilityReason,limitation:a.limitation,revision:value.revision,...(a.mix?{mix:a.mix}:{}),...(a.guidance?{guidance:a.guidance}:{}),
    source:{...(a.verification?{verification:a.verification}:{}),...(a.structureBinding?{structureBinding:a.structureBinding}:{}),...(a.provenanceKind?{provenanceKind:a.provenanceKind}:{}),materialId:material.id,revision:material.revision,contentFingerprint:material.contentFingerprint,sourceClassification:material.claimType,verificationStatus:material.verificationStatus,assertionVerificationStatus:value.provenance.verificationStatus,capturedSourceUrl:a.capturedSourceUrl??material.sourceUrl??null,ownerSuppliedReferenceUrl:a.ownerSuppliedReferenceUrl??(a.sourceUrl!==material.sourceUrl?a.sourceUrl:null),sourceUrl:a.sourceUrl,publishedAt:material.publishedAt,cutoffAt:material.publishedAt,validUntil:material.validUntil,...(value.source.kind==="source_snapshot"
      ? {snapshotCitation:value.source.snapshotCitation,snapshotOriginal:value.source.snapshotOriginal,
        snapshotTextBinding:a.snapshotTextBinding!}
      : {documentId:value.source.documentId,pageNumber:value.source.pageNumber,
        pageTextSha256:value.source.pageTextSha256,documentPdfSha256:value.source.documentPdfSha256,
        ...(a.textBinding?{textBinding:a.textBinding}:{})})}};
}
export function buildOperatingReasoning(workspace:DeepResearchWorkspaceEnvelope,fundamentals?:ResearchFundamentalsEnvelope,context?:ResearchContextEnvelope,observed:OperatingMarketObservation|null=null):ResearchOperatingReasoning|null {
  const target=workspace.data?.target;if(!target||!fundamentals||fundamentals.symbol!==target.symbol||fundamentals.membershipId!==target.membershipId||fundamentals.membershipVersion!==target.membershipVersion||fundamentals.requestedActorId!==workspace.requestedActorId)return null;
  const facts=fundamentals.values.map(v=>fundamentalOperatingFact(v,workspace)).filter((f):f is OperatingFact=>!!f);
  for(const f of facts){f.identity=factIdentity(f);f.assertionIdentity=assertionIdentity(f);f.researchRecency=factRecency(f,facts,workspace.generatedAt);}
  const historicalFacts=fundamentals.values.map(v=>fundamentalOperatingFact(v,workspace,true)).filter((f):f is OperatingFact=>!!f);
  const anchorSelection=selectOperatingAnchor(facts);
  const anchor=anchorSelection.selectedFactId?facts.find(f=>f.id===anchorSelection.selectedFactId)??null:null;
  markHistoricalRestatements(historicalFacts);
  if(!anchor)return null;
  const c=currentOperatingContext(context, workspace);
  const model=c?.operatingModel??emptyOperatingModel(Number(workspace.generatedAt.slice(0,4)));
  const {thesisOptions,binding,validBinding,currentModel}=resolveThesisModel(workspace,model);
  const steps=transmissionNodes(facts,anchor),stoppedAt=steps.find(n=>n.semanticType==="UNKNOWN")?.metric??null;
  const scenarios=calculateOperatingScenarios(currentModel,facts,observed?.currency??(target.market==="HK"?"HKD":null));
  const reverseValuation=calculateReverseValuation(currentModel,facts,observed?.symbol===target.symbol?observed:null,scenarios,workspace.generatedAt);
  const revenueAnchor=anchorSelection.metric==="revenue";
  const questions=rankOperatingQuestions(steps,!!validBinding,scenarios,reverseValuation.status,currentModel.thesisBinding?.thesisDimension,anchorSelection.metric);
  const growth=matchingGrowthFact(facts,anchor);
  const material=workspace.data!.materials.find(m=>m.id===anchor.source.materialId)!;
  const draft:ResearchOperatingReasoning={kind:"operating_valuation_draft",generationMethod:"deterministic_evidence_framework",actorId:workspace.requestedActorId,membershipId:target.membershipId,membershipVersion:target.membershipVersion,symbol:target.symbol,growthFactId:growth?.id??null,anchorSelection,contextId:c?.id??null,...contextCreationMetadata(c),...(currentModel.thesisBinding?{thesisReportCreatedAt:workspace.data!.reports.find(r=>r.id===currentModel.thesisBinding?.reportId)?.createdAt}:{}),inputFingerprint:"",facts,
    fact:{...anchor,materialId:material.id,contentFingerprint:material.contentFingerprint,text:operatingAnchorText(anchor,growth)},
    operatingMeaning:{semanticType:"INTERPRETATION",text:revenueAnchor
      ? "本期收入原值可能受销量、价格、产品结构、确认时点或合并口径影响；缺少同口径比较时，不能从单期收入归因。发行人披露的收入原值不证明这些解释。"
      : "销量变化可能反映需求或产品竞争力，也可能源于价格、渠道或交付节奏。引用发行人披露不能把这些解释升级为事实。"},
    profitTransmission:{semanticType:"HYPOTHESIS",text:revenueAnchor
      ? "本期收入需结合同期间毛利率、费用、税项与现金流核查利润传导；销量、ASP 和产品结构若无同口径证据，只是待验证驱动。其他期间的财务数据仅在独立利润桥展示，不代入本期收入链。"
      : "同期间销量需结合 ASP / 产品结构才能验证收入传导；收入再结合毛利率、费用、税项与现金流。其他期间的财务数据只在独立利润桥展示，不代入本次销量链。",stoppedAt,profitGrowthConclusionAllowed:false,steps},
    thesisImpact:validBinding?{...binding!,hypothesis:binding!.conditionText,assessment:"insufficient_evidence",explanation:revenueAnchor
      ? "Owner 显式选定的原假设保持原文。单期收入本身不能验证盈利、毛利率或现金流改善；同期间证据不足，等待核查。"
      : "Owner 显式选定的原假设保持原文。销量本身不能验证盈利、毛利率或现金流改善；同期间证据不足，等待核查。",mutation:"none"}:null,
    thesisOptions,unknown:{semanticType:"UNKNOWN",text:stoppedAt?steps.find(n=>n.metric===stoppedAt)!.limitation:"因果解释与可持续性尚未确认"},nextResearchQuestion:questions[0]!.question,questions,sharesReference:buildSharesReference(currentModel,facts),profitBridge:buildProfitBridge(facts),model:currentModel,scenarios,reverseValuation};
  draft.assertionHistory=historicalFacts;
  draft.evidenceSeries=evidenceSeries(historicalFacts);
  draft.guidance=compareGuidance(facts,workspace.generatedAt);
  draft.thesisUpdate=buildThesisUpdate(draft,workspace.data!.reports.find(r=>r.id===currentModel.thesisBinding?.reportId)?.createdAt);
  attachCounterevidence(draft,workspace);
  if(draft.thesisImpact && draft.thesisUpdate){draft.thesisImpact.assessment=draft.thesisUpdate.assessment;draft.thesisImpact.explanation=draft.thesisUpdate.explanation;}
  draft.gaps=steps.filter(s=>s.semanticType==="UNKNOWN").map(s=>({metric:s.metric,reason:classifyGap(s.metric,facts,anchor,fundamentals,workspace)}));
  draft.researchQuestions=projectResearchQuestions(draft,[],workspace.generatedAt);
  const next=draft.researchQuestions.find(q=>q.status!=="RESOLVED");
  if(next)draft.nextResearchQuestion=next.question;
  draft.researchUpdate=researchUpdateNotice(draft,workspace.generatedAt);
  draft.productMix=calculateProductMix(facts,anchor);
  const marketCurrency=observed?.currency??(target.market==="HK"?"HKD":null);
  draft.sensitivity=calculateSensitivity(currentModel,facts,marketCurrency);
  draft.conditionalRequirements=calculateConditionalRequirements(currentModel,reverseValuation,scenarios);
  draft.calculation={version:"operating-calculation-v1",asOf:workspace.generatedAt,marketCurrency,canonicalPayload:calculationProofPayload(draft,workspace.generatedAt,marketCurrency),fingerprint:calculationFingerprint(draft,workspace.generatedAt,marketCurrency)};
  draft.inputFingerprint=reasoningFingerprint(draft);
  return operatingReasoningMatches(draft,workspace)?draft:null;
}
function currentOperatingContext(context:ResearchContextEnvelope|undefined, workspace:DeepResearchWorkspaceEnvelope) {
  const target=workspace.data!.target;
  return context?.status==="available"&&context.requestedActorId===workspace.requestedActorId&&context.data?.currentness.status==="current"&&context.data.membershipVersion===target.membershipVersion&&context.data.membershipId===target.membershipId&&context.data.selectedSymbol===target.symbol?context.data:null;
}
function resolveThesisModel(workspace:DeepResearchWorkspaceEnvelope,model:OperatingResearchModel){
  const thesisOptions=explicitThesisOptions(workspace),binding=model.thesisBinding;
  const validBinding=!!binding&&thesisOptions.some(option=>sameThesisIdentity(option,binding));
  // A drifted selection is not silently rebound to a new report or condition.
  const currentModel=validBinding||!binding?model:{...model,thesisBinding:null,thesisTests:[],thesisEvidencePlan:{requiredTestIds:[],aggregationRule:"owner_review" as const}};
  return {thesisOptions,binding,validBinding,currentModel};
}
function factWithinWorkspace(value:ResearchFundamentalValueData,workspace:DeepResearchWorkspaceEnvelope,includeHistory:boolean):boolean {
  const target=workspace.data?.target,a=value.assertion;
  return !!a?.sourceChecked&&!!target&&(includeHistory||["current","historical_source_stale"].includes(value.valueState))
    &&(value.source.kind!=="source_snapshot"||value.source.originalAvailability==="available")
    &&value.valueStatus==="reported"&&value.value!==null&&["verified","owner_confirmed","source_text_verified"].includes(value.provenance.verificationStatus)&&value.symbol===target.symbol&&value.membershipId===target.membershipId&&value.membershipVersionAtWrite===target.membershipVersion&&(a.category!=="actual"||value.periodEnd<=workspace.generatedAt.slice(0,10))&&Date.parse(value.createdAt)<=Date.parse(workspace.generatedAt);
}
function matchingGrowthFact(facts:OperatingFact[],anchor:OperatingFact):OperatingFact|undefined {
  if(anchor.metric!=="sales_volume")return undefined;
  const matches=facts.filter(f=>f.metric==="sales_volume_yoy"&&f.period.start===anchor.period.start&&f.period.end===anchor.period.end&&f.businessScope===anchor.businessScope&&f.accountingScope===anchor.accountingScope&&f.measurementBasis===anchor.measurementBasis&&f.source.cutoffAt===anchor.source.cutoffAt&&f.category==="actual"&&f.comparability==="comparable");
  return matches.length===1?matches[0]:undefined;
}

export function rankOperatingQuestions(steps:ReturnType<typeof transmissionNodes>,bound:boolean,scenarios:ReturnType<typeof calculateOperatingScenarios>,reverseStatus:string,dimension?:string,anchorMetric:"sales_volume"|"revenue"="sales_volume"):ResearchOperatingReasoning["questions"] {
  const result:ResearchOperatingReasoning["questions"]=[];
  if(dimension==="cash_flow")result.push({priority:120,question:"经营现金流的变化有多少来自营运资本时点，扣除所列现金资本投入后的代理值是否可持续？",reason:"现金流命题优先核查营运资本和资本投入；不把现金流代理值等同可分配现金"});
  if(dimension==="profitability")result.push({priority:120,question:anchorMetric==="revenue"
    ? "本期收入与同期间毛利率、费用及所选盈利指标为何出现分歧？销量、价格和结构各自贡献有何可核对证据？"
    : "同期间 ASP 与产品结构变化是否抵消销量增长，毛利率与所选盈利指标为何出现分歧？",reason:"依据盈利命题定位价格、结构与利润的传导缺口"});
  if(dimension==="product_mix")result.push({priority:120,question:"能否从同口径前期公告提取相同分类及父节点，验证占比是否真正提升？",reason:"单期 mix 不能证明提升；先补同 taxonomy 的比较期"});
  if(dimension==="non_operating_quality")result.push({priority:120,question:"汇兑、减值与核心盈利调整的税后归属及经常性依据分别是什么？",reason:"区分发行人非 HKFRS 口径与正常化盈利"});
  if(steps.find(n=>n.metric==="asp_product_mix")?.semanticType==="UNKNOWN")result.push({priority:100,question:anchorMetric==="revenue"
    ? "本期收入对应的销量、ASP、产品结构和促销是否有同期间、同口径证据，能否解释毛利润变化？"
    : "本次新增销量对应的 ASP、车型结构和促销是否变化，能否真正传导到毛利润？",reason:anchorMetric==="revenue"
    ? "收入原值不足以确认价格或结构归因；先补同口径驱动证据"
    : "最早未闭合的经营传导节点；阻止将销量直接等同利润增长"});
  if(steps.find(n=>n.metric==="gross_margin")?.semanticType==="UNKNOWN")result.push({priority:90,question:"同期间毛利率是否改善，还是受到折扣与产品结构压制？",reason:"盈利传导缺口"});
  if(!bound)result.push({priority:80,question:"这条经营事实应由 Owner 关联到哪条已有报告假设？",reason:"未显式绑定 Thesis"});
  if(scenarios.some(s=>s.normalizedProfit===null))result.push({priority:70,question:"剔除汇兑、一次性收益和资本化影响后，可持续盈利的可核查依据是什么？",reason:"正常化盈利尚无明确情景假设"});
  if(reverseStatus==="UNKNOWN")result.push({priority:60,question:"以什么明确的 PE、股本与汇率假设检验当前价格？",reason:"反推条件不足"});
  if(!result.length)result.push({priority:50,question:"什么新增证据最可能推翻当前 Base 情景的盈利持续性？",reason:"核查模型脆弱点"});
  return result.sort((a,b)=>b.priority-a.priority);
}

function attachCounterevidence(draft:ResearchOperatingReasoning,w:DeepResearchWorkspaceEnvelope):void {
  if(!draft.thesisUpdate)return;
  draft.thesisUpdate.counterevidence=w.data!.materials.filter(m=>m.stance==="refute"&&m.symbol===draft.symbol&&m.revisionState==="current"&&m.freshness==="fresh"&&m.citation&&["issuer_statement","verified_fact"].includes(m.claimType)&&["authorized_public","user_provided"].includes(m.rightsStatus)).slice(0,3).map(m=>m.id);
}

function classifyGap(metric:string,facts:OperatingFact[],anchor:OperatingFact,fundamentals:ResearchFundamentalsEnvelope,w:DeepResearchWorkspaceEnvelope):ReturnType<typeof gapReason> {
  const key=metric==="asp_product_mix"?"average_selling_price":metric;
  if(!facts.some(f=>f.metric===key)){
    if(fundamentals.values.some(f=>f.metric===key&&f.valueState==="historical_source_stale"))return "STALE";
    if(w.data!.materials.some(m=>m.variableName===key&&m.revisionState==="current"&&m.freshness==="fresh"))return "NOT_EXTRACTED";
  }
  return gapReason(metric,facts,anchor);
}

function operatingAnchorText(anchor:OperatingFact,growth:OperatingFact|undefined):string { return `${anchor.period.start??anchor.period.end} 至 ${anchor.period.end} · ${anchor.metric==="sales_volume"?"销量":"收入"}：${anchor.value.toLocaleString("en-US")} ${anchor.unit==="vehicles"?"辆":anchor.currency}${anchor.unitScale===1?"":`（单位倍数 ${anchor.unitScale}）`}${growth?`；发行人披露同比 ${growth.value>=0?"+":""}${(growth.value*100).toFixed(0)}%`:""}`; }

function contextCreationMetadata(context:{createdAt:string}|null|undefined):{contextCreatedAt?:string}{return context?.createdAt?{contextCreatedAt:context.createdAt}:{};}

function incompleteStructuredVerification(a:NonNullable<ResearchFundamentalValueData["assertion"]>):boolean{return !!a.structureBinding?.structureExcerpt&&a.verification?.structureVerification==="unverified";}

function fundamentalPeriod(value:ResearchFundamentalValueData):OperatingPeriod {
  const days=value.periodStart?(Date.parse(value.periodEnd)-Date.parse(value.periodStart))/86400000+1:0;
  return {kind:value.periodKind,start:value.periodStart,end:value.periodEnd,type:value.periodKind==="instant"?"instant":days>=365&&days<=366?"annual":days>=180&&days<=184?"interim":days>=28&&days<=31?"monthly":days===7?"weekly":value.periodStart===`${value.periodEnd.slice(0,4)}-01-01`?"ytd":"other"};
}

function markHistoricalRestatements(facts:OperatingFact[]):void {for(const f of facts){if(facts.some(child=>child.replacesValueId===f.id&&child.amendmentKind==="restatement"))f.evidenceValidity="RESTATED";}}
