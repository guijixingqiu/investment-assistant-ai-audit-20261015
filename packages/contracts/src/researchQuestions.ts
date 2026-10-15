import {evidenceSeries} from "./researchEvidenceSeries.js";
import {metricRequirement,resolveEvidenceRequirement} from "./researchEvidenceRequirement.js";
import {exactRequirement,type EvidenceRequirement,type EvidenceMismatch} from "./researchFactIdentity.js";
import {factIdentity,factIdentityKey} from "./researchFactIdentity.js";
import {operatingModelFingerprint,type OperatingFact,type OperatingQuestionDraft} from "./researchOperatingModel.js";
import type {ResearchOperatingReasoning} from "./researchOperatingReasoning.js";
import type {StructuredFactCandidate} from "./researchFactCandidates.js";
import type {GapReason} from "./researchDecisionUpdate.js";
export interface ResearchQuestion {
  requirement?:EvidenceRequirement; mismatchReason?:EvidenceMismatch|null; availableDependencies?:string[]; missingDependencies?:string[];
  questionId:string;symbol:string;membershipId:string;membershipVersion:number;
  origin:"system_next_question"|"owner_question"|"thesis_test_missing_evidence"|"guidance_due"|"scenario_input_gap"|"counterevidence_followup";
  question:string;relatedThesisTestId:string|null;targetMetric:string;gapReason:GapReason|null;
  status:"OPEN"|"EVIDENCE_FOUND"|"RESOLVED"|"BLOCKED"|"UNKNOWN";
  evidenceIds:string[];candidateIds:string[];resolution:string|null;openedAt:string;resolvedAt:string|null;
}
/** Questions are projections of existing evidence / test identity, not another task database. */
export function projectResearchQuestions(v:ResearchOperatingReasoning,candidates:StructuredFactCandidate[]=v.factCandidates??[],asOf=v.calculation?.asOf??v.fact.recordedAt??v.fact.source.publishedAt):ResearchQuestion[] {
  const result:ResearchQuestion[]=projectOwnerResearchQuestions(v,v.model.researchQuestionDrafts??[],questionFacts(v),candidates,v.contextCreatedAt??v.fact.recordedAt??v.fact.source.publishedAt);
  result.push(...projectTestQuestions(v,candidates));
  const anchor=v.fact;
  const aspRequirement=aspEvidenceRequirement(v);
  const asp=resolveEvidenceRequirement(aspRequirement,v.facts,candidates);
  result.push(question(v,{origin:"system_next_question",targetMetric:"average_selling_price",relatedThesisTestId:null,requirement:aspRequirement,mismatchReason:asp.reason,availableDependencies:asp.availableDependencies,missingDependencies:asp.missingDependencies,
    question:`${anchor.period.start??anchor.period.end} 至 ${anchor.period.end} 的同口径实际售价是否改变了销量向盈利的传导？`,status:asp.status,gapReason:asp.status==="RESOLVED"?null:asp.status==="EVIDENCE_FOUND"?"NOT_EXTRACTED":"SOURCE_NOT_FOUND",evidenceIds:asp.evidenceIds,candidateIds:asp.candidateIds,resolution:asp.status==="RESOLVED"?"严格期间、币种、单位、范围及销量口径匹配；继续核查毛利率。":null,resolvedAt:asp.resolvedAt}));
  const nested=v.facts.find(f=>f.mix?.parentNode&&f.period.end===anchor.period.end);
  if(nested?.mix){
    const previousEnd=`${Number(anchor.period.end.slice(0,4))-1}${anchor.period.end.slice(4)}`;
    const series=evidenceSeries(v.facts).filter(s=>s.identity.metric==="mix_share"&&s.identity.taxonomy?.dimensionValue===nested.mix!.dimensionValue&&s.identity.taxonomy?.parentNode===nested.mix!.parentNode);
    const resolved=["total","parent"].every(b=>series.some(s=>s.shareBasis===b&&s.current?.status==="COMPARABLE"&&s.previous?.period.end===previousEnd));
    const ids=resolved?[...new Set(series.flatMap(s=>[...(s.current?.inputs??[]),...(s.previous?.inputs??[])]))]:[];
    const required=metricRequirement(nested,"product_mix_volume",{...nested.period,start:nested.period.start?`${Number(nested.period.start.slice(0,4))-1}${nested.period.start.slice(4)}`:null,end:previousEnd});
    const match=resolveEvidenceRequirement(required,v.facts,candidates);
    const matches=candidates.filter(c=>match.candidateIds.includes(c.id));
    result.push(question(v,{origin:"system_next_question",targetMetric:"mix_share",relatedThesisTestId:null,requirement:required,mismatchReason:match.reason,availableDependencies:match.availableDependencies,missingDependencies:match.missingDependencies,question:`核对上年同月 ${nested.mix.dimensionValue} 占总销量及父分类 ${nested.mix.parentNode} 的比例，是否有相同分类口径的来源？`,status:resolved?"RESOLVED":matches.length?"EVIDENCE_FOUND":"OPEN",gapReason:resolved?null:matches.length?"NOT_EXTRACTED":"SOURCE_NOT_FOUND",evidenceIds:ids,candidateIds:matches.map(c=>c.id),resolution:resolved?"已有可比前期结构；占比变化不证明 ASP 或毛利率变化。":null,resolvedAt:resolved?latestRecorded(v.facts.filter(f=>ids.includes(f.id))):null},undefined,nested));
  }
  appendAncillaryQuestions(v,result,asOf);
  return result.sort((a,b)=>(a.status==="RESOLVED"?1:0)-(b.status==="RESOLVED"?1:0)||questionPriority(a.origin)-questionPriority(b.origin));
}

function projectTestQuestions(v:ResearchOperatingReasoning,candidates:StructuredFactCandidate[]):ResearchQuestion[]{
  const result:ResearchQuestion[]=[];
  for(const test of [...(v.thesisUpdate?.tests??[])].sort((a,b)=>Number(v.model.thesisEvidencePlan?.requiredTestIds.includes(b.test.testId)??false)-Number(v.model.thesisEvidencePlan?.requiredTestIds.includes(a.test.testId)??false))){
    const missing=test.observations.find(o=>o.result==="UNKNOWN"||o.result==="CONFLICTED");
    const observation=missing??test.observations[0];if(!observation)continue;
    const source=observation.evidenceIds.map(id=>v.facts.find(f=>f.id===id)).filter((f):f is OperatingFact=>!!f);
    const reference=source[0]??v.facts.find(f=>f.period.type===test.test.periodType&&f.metric==="revenue")??v.fact;
    const requiredPeriod=observation.observed!==null&&test.test.referencePeriod==="previous_year"?{...reference.period,start:reference.period.start?`${Number(reference.period.start.slice(0,4))-1}${reference.period.start.slice(4)}`:null,end:`${Number(reference.period.end.slice(0,4))-1}${reference.period.end.slice(4)}`}:reference.period;
    const requirement=test.test.evidenceRequirements?.[observation.metric] ? {...test.test.evidenceRequirements[observation.metric]!,period:{mode:"exact" as const,value:requiredPeriod}} : testEvidenceRequirement(reference,observation.metric,requiredPeriod);
    if(!test.test.evidenceRequirements?.[observation.metric])requirement.accountingScope={mode:"owner_to_define"};
    const match=resolveEvidenceRequirement(requirement,questionFacts(v),candidates);
    const found=candidates.filter(c=>match.candidateIds.includes(c.id));
    result.push(question(v,{origin:"thesis_test_missing_evidence",targetMetric:observation.metric,relatedThesisTestId:test.test.testId,requirement,mismatchReason:test.result==="CONFLICTED"?"MIXED_TEST_RESULTS":match.reason,availableDependencies:match.availableDependencies,missingDependencies:match.missingDependencies,
      question:`核对 ${observation.metric} 是否具备「${test.test.comparison}」所需的同期间、同口径证据？`,
      status:test.result==="CONFLICTED"||match.status==="BLOCKED"?"BLOCKED":missing?(found.length?"EVIDENCE_FOUND":"OPEN"):"RESOLVED",gapReason:missing?(found.length?"NOT_EXTRACTED":"SOURCE_NOT_FOUND"):null,
      evidenceIds:source.map(f=>f.id),candidateIds:found.map(c=>c.id),resolution:missing||test.result==="CONFLICTED"||match.status==="BLOCKED"?null:"指定 Test 的证据已齐备；不等于原 Thesis 获得支持。",resolvedAt:missing||test.result==="CONFLICTED"||match.status==="BLOCKED"?null:latestRecorded(source)},operatingModelFingerprint(requirement)));
  }
  return result;
}

function latestRecorded(facts:OperatingFact[]):string|null{return facts.map(f=>f.recordedAt??f.source.publishedAt).sort().at(-1)??null;}
function question(v:ResearchOperatingReasoning,data:Omit<ResearchQuestion,"questionId"|"symbol"|"membershipId"|"membershipVersion"|"openedAt">,scopeKey?:string,openingFact:OperatingFact=v.fact):ResearchQuestion {
  const identity={symbol:v.symbol,membershipId:v.membershipId,membershipVersion:v.membershipVersion,origin:data.origin,targetMetric:data.relatedThesisTestId?null:data.targetMetric,test:data.relatedThesisTestId,scope:scopeKey??(data.origin==="system_next_question"?data.requirement?.period:v.fact.period)};
  const key=factIdentityKey(factIdentity(openingFact));
  const sourceOpening=(v.assertionHistory??v.facts).filter(f=>factIdentityKey(factIdentity(f))===key).map(f=>f.recordedAt??f.source.publishedAt).sort()[0]??openingFact.recordedAt??openingFact.source.publishedAt;
  return {...data,...{symbol:v.symbol,membershipId:v.membershipId,membershipVersion:v.membershipVersion},questionId:operatingModelFingerprint(identity),openedAt:data.origin==="thesis_test_missing_evidence"||data.origin==="counterevidence_followup"?v.thesisReportCreatedAt??v.contextCreatedAt??v.fact.source.publishedAt:data.origin==="scenario_input_gap"?v.contextCreatedAt??v.fact.source.publishedAt:data.origin==="system_next_question"?sourceOpening:v.fact.recordedAt??v.fact.source.publishedAt};
}

export function projectOwnerResearchQuestions(identity:{symbol:string;membershipId:string;membershipVersion:number},drafts:OperatingQuestionDraft[],facts:OperatingFact[],candidates:StructuredFactCandidate[],openedAt:string):ResearchQuestion[] {
  const bound={symbol:identity.symbol,membershipId:identity.membershipId,membershipVersion:identity.membershipVersion};
  return drafts.map(d=>{
    const base=facts.find(f=>f.businessScope===d.businessScope&&f.measurementBasis===d.measurementBasis);
    const requirement=d.requirement??legacyQuestionRequirement(bound,d,base);
    const match=resolveEvidenceRequirement(requirement,facts,candidates);
    return {...bound,questionId:operatingModelFingerprint({...bound,id:d.questionId}),origin:"owner_question",question:d.question,relatedThesisTestId:null,targetMetric:d.targetMetric,requirement,mismatchReason:match.reason,availableDependencies:match.availableDependencies,missingDependencies:match.missingDependencies,gapReason:match.status==="RESOLVED"?null:match.status==="EVIDENCE_FOUND"?"NOT_EXTRACTED":"SOURCE_NOT_FOUND",status:match.status,evidenceIds:match.evidenceIds,candidateIds:match.candidateIds,resolution:match.status==="RESOLVED"?"已满足明确 Evidence Requirement；不修改原 Thesis。":match.status==="BLOCKED"?"证据冲突，不能自动选取。":null,openedAt,resolvedAt:match.resolvedAt};
  });
}

function appendAncillaryQuestions(v:ResearchOperatingReasoning,result:ResearchQuestion[],asOf:string):void {
  const base=v.scenarios.find(s=>s.name==="base");
  if(base&&Object.values(base.inputs).some(i=>i.origin!=="unknown")){const resolved=base.status==="complete";result.push(question(v,{origin:"scenario_input_gap",targetMetric:"normalized_profit",relatedThesisTestId:null,question:"Base 情景的经营、盈利及估值输入，哪些仍需要 Owner 明确给出依据？",gapReason:resolved?null:"OWNER_ASSUMPTION_REQUIRED",status:resolved?"RESOLVED":"OPEN",evidenceIds:Object.values(base.inputs).flatMap(i=>i.sourceValueId?[i.sourceValueId]:[]),candidateIds:[],resolution:resolved?"Owner 已明确条件情景输入；这不是已验证盈利预测。":null,resolvedAt:resolved?v.contextCreatedAt??null:null},`base:${base.period.start}:${base.period.end}`));}
  for(const g of v.guidance??[]){
    if(asOf.slice(0,10)<g.expectedVerificationDate)continue;
    const resolved=["met","missed","partially_met"].includes(g.status);
    const q=question(v,{origin:"guidance_due",targetMetric:g.metric,relatedThesisTestId:null,question:`管理层 ${g.period} 的 ${g.metric} 指引是否已有同口径 Actual 可核对？`,gapReason:resolved?null:g.status==="not_comparable"?"MEASUREMENT_MISMATCH":"SOURCE_NOT_FOUND",status:resolved?"RESOLVED":g.status==="not_comparable"?"BLOCKED":"OPEN",evidenceIds:[g.guidanceId,...(g.actualId?[g.actualId]:[])],candidateIds:[],resolution:resolved?`Guidance 对照结果：${g.status}；不自动变成 Owner 情景。`:null,resolvedAt:resolved?latestRecorded(v.facts.filter(f=>f.id===g.actualId)):null},`guidance:${g.guidanceId}`);
    q.openedAt=`${g.expectedVerificationDate}T00:00:00.000Z`;result.push(q);
  }
  const update=v.thesisUpdate;
  if(update){const ids=update.counterevidence.slice(0,3);result.push(question(v,{origin:"counterevidence_followup",targetMetric:"counterevidence",relatedThesisTestId:null,question:"哪条可追溯的新证据最可能否定当前明确检验的命题？",gapReason:ids.length?"NOT_EXTRACTED":"SOURCE_NOT_FOUND",status:ids.length?"EVIDENCE_FOUND":"OPEN",evidenceIds:ids.map(id=>`material:${id}`),candidateIds:[],resolution:null, resolvedAt:null},`counter:${update.originalThesis.reportFingerprint}:${update.originalThesis.conditionIndex}`));}
}

function questionPriority(origin:ResearchQuestion["origin"]):number{return {thesis_test_missing_evidence:0,owner_question:1,scenario_input_gap:2,guidance_due:3,counterevidence_followup:4,system_next_question:5}[origin];}

function legacyQuestionRequirement(identity:{symbol:string;membershipVersion:number},d:OperatingQuestionDraft,base:OperatingFact|undefined):EvidenceRequirement {
 const r=exactRequirement({symbol:identity.symbol,membershipVersion:identity.membershipVersion,metric:d.targetMetric,period:d.period,category:"actual",unit:base?.unit??"unknown",currency:base?.currency??null,accountingScope:"unknown",businessScope:d.businessScope,measurementBasis:d.measurementBasis,taxonomy:null,guidanceDefinition:null,shareBasis:null});
 r.currency={mode:"owner_to_define"};r.accountingScope={mode:"owner_to_define"};return r;
}

function aspEvidenceRequirement(v:ResearchOperatingReasoning):EvidenceRequirement {const currencies=[...new Set(v.facts.filter(f=>f.currency).map(f=>f.currency))];return metricRequirement(v.fact,"average_selling_price",v.fact.period,currencies.length===1?currencies[0]!:null);}

function questionFacts(v:ResearchOperatingReasoning):OperatingFact[]{return v.assertionHistory??v.facts;}

function testEvidenceRequirement(reference:OperatingFact,metric:string,period:OperatingFact["period"]):EvidenceRequirement {const r=metricRequirement(reference,metric,period);if(metric==="mix_share")r.shareBasis={mode:"exact",value:"total"};return r;}
