import {comparableFacts} from "./researchEvidenceSeries.js";
import {sameCalculationBasis,canonicalCurrentFacts} from "./researchFactIdentity.js";
import { operatingModelFingerprint, operatingInputUnit, type OperatingFact, type OperatingNode, type OperatingPeriod, type OperatingResearchModel, type OperatingScenarioDraft, type OperatingScenarioResult, type OperatingResolvedInput, type OperatingScenarioKey, type OperatingMarketObservation, type OperatingReverseValuation } from "./researchOperatingModel.js";

export const TRANSMISSION_METRICS = ["sales_volume", "asp_product_mix", "revenue", "gross_margin", "gross_profit", "research_and_development_expense", "selling_and_distribution_expense", "administrative_expense", "operating_profit", "profit_attributable_to_owners", "operating_cash_flow", "capital_expenditure", "free_cash_flow"] as const;
export interface ProfitBridgeRow { metric:string; current:OperatingNode; previous:OperatingNode; change:number|null; changeRatio:number|null; comparison:"comparable"|"not_comparable"; reason:string|null }
export interface ProfitBridge { period:OperatingPeriod; previousPeriod:OperatingPeriod; rows:ProfitBridgeRow[]; quality:Array<{topic:string; assessment:"supported"|"partially_supported"|"weakened"|"insufficient_evidence"; text:string; inputs:string[]}> }

export function sameBasis(a:OperatingFact,b:OperatingFact,compareYear=false):boolean {
  if(!compareYear)return sameCalculationBasis(a,b);
  return sameCalculationBasis({...a,period:b.period},b)&&a.period.type===b.period.type&&a.period.start?.slice(4)===b.period.start?.slice(4)&&a.period.end.slice(4)===b.period.end.slice(4)&&Number(a.period.end.slice(0,4))===Number(b.period.end.slice(0,4))+1;
}
export function factNode(f:OperatingFact):OperatingNode { return {accountingScope:f.accountingScope,businessScope:f.businessScope,measurementBasis:f.measurementBasis,metric:f.metric,semanticType:"FACT",value:f.value*f.unitScale,unit:f.unit,currency:f.currency,period:f.period,source:[f.source],inputs:[f.id],calculation:null,derivationMethod:"source_transcription",comparability:f.comparability,limitation:f.limitation}; }
export function unknownNode(metric:string, period:OperatingPeriod, reason="缺少同期间、同口径的可追溯证据"):OperatingNode {return {accountingScope:"UNKNOWN",businessScope:"UNKNOWN",measurementBasis:"UNKNOWN",metric,semanticType:"UNKNOWN",value:null,unit:metric==="sales_volume"?"vehicles":metric==="gross_margin"?"ratio":"currency",currency:null,period,source:[],inputs:[],calculation:null,derivationMethod:"missing_evidence",comparability:"not_comparable",limitation:reason};}
export function deriveNode(metric:string, inputs:OperatingFact[], formula:string, calculate:(values:number[])=>number):OperatingNode|null {
  if (!inputs.length || !inputs.every(f=>sameBasis(inputs[0]!,f))) return null;
  const value=calculate(inputs.map(f=>f.value*f.unitScale));
  if (!Number.isFinite(value)) return null;
  return {...factNode(inputs[0]!),metric,semanticType:"INTERPRETATION",unit:metric==="gross_margin"?"ratio":"currency",currency:metric==="gross_margin"?null:inputs[0]!.currency,value,source:inputs.map(f=>f.source),inputs:inputs.map(f=>f.id),calculation:formula,derivationMethod:"deterministic_calculation",limitation:"由已披露输入按所示公式计算；不构成发行人直接披露或因果解释。"};
}
export function transmissionNodes(facts:OperatingFact[], anchor:OperatingFact):OperatingNode[] {
  facts=canonicalCurrentFacts(facts);
  const samePeriod=facts.filter(f=>operatingModelFingerprint(f.period)===operatingModelFingerprint(anchor.period) && f.symbol===anchor.symbol && f.membershipId===anchor.membershipId && f.membershipVersion===anchor.membershipVersion && f.businessScope===anchor.businessScope && f.accountingScope===anchor.accountingScope && f.measurementBasis===anchor.measurementBasis && (anchor.currency===null || !["currency","currency_per_vehicle"].includes(f.unit) || f.currency===anchor.currency) && f.category==="actual" && f.comparability==="comparable" && f.measurementBasis!=="weekly_registration");
  const select=(metric:string)=>{ const matches=samePeriod.filter(f=>f.metric===metric);return matches.length===1?matches[0]:undefined; };
  return TRANSMISSION_METRICS.map(metric=>{
    const direct=select(metric==="asp_product_mix"?"average_selling_price":metric); if(direct)return {...factNode(direct),metric};
    const formula=metric==="operating_profit"?{keys:["profit_before_tax","net_finance_income","associates_profit","joint_ventures_profit"],text:"profit_before_tax − net_finance_income − share of associates − share of joint ventures (explicit analytical definition; not an issuer-reported subtotal)",fn:(v:number[])=>v[0]!-v[1]!-v[2]!-v[3]!}:metric==="gross_margin"?{keys:["gross_profit","revenue"],text:"gross_profit / revenue",fn:(v:number[])=>v[0]!/v[1]!}:
      metric==="capital_expenditure"?{keys:["property_plant_equipment_purchases","intangible_asset_purchases","land_lease_prepayments"],text:"PPE cash purchases + intangible cash purchases + land lease prepayments (outflows expressed positive)",fn:(v:number[])=>v.reduce((a,b)=>a+b,0)}:
      metric==="free_cash_flow"?{keys:["operating_cash_flow","property_plant_equipment_purchases","intangible_asset_purchases","land_lease_prepayments"],text:"operating_cash_flow - PPE purchases - intangible purchases - land lease prepayments",fn:(v:number[])=>v[0]!-v[1]!-v[2]!-v[3]!}:null;
    if(formula){const inputs=formula.keys.map(select);if(inputs.every((f):f is OperatingFact=>!!f) && (["gross_margin","operating_profit"].includes(metric) || inputs.slice(metric === "free_cash_flow" ? 1 : 0).every(f=>f.value>=0))){const derived=deriveNode(metric,inputs,formula.text,formula.fn);if(derived)return derived;}}
    return unknownNode(metric,anchor.period,metric==="asp_product_mix"?(samePeriod.some(f=>f.mix)?"同期间销量结构已提取；ASP / 实际售价仍缺可追溯证据，不能确认收入或利润增长。":"ASP / 产品结构缺少同期间证据；销量不能直接推出收入或利润增长。"):"缺少同期间、同口径披露或计算输入");
  });
}
export function buildProfitBridge(facts:OperatingFact[]):ProfitBridge|null {
  facts=canonicalCurrentFacts(facts);
  const anchors=facts.filter(f=>f.metric==="revenue" && ["interim","annual"].includes(f.period.type) && f.category==="actual" && f.comparability==="comparable").sort((a,b)=>b.period.end.localeCompare(a.period.end));
  const current=anchors[0];if(!current)return null;
  if(anchors.filter(a=>a.period.end===current.period.end).length!==1)return null;
  const previous=comparableFacts(facts,current,"previous_year");if(!previous)return null;
  const now=transmissionNodes(facts,current),before=transmissionNodes(facts,previous);
  // Core earnings / FX are disclosed measures, shown separately from statutory attributable profit.
  for(const metric of ["core_profit_attributable_to_owners","fx_effect","non_financial_impairment"]){
    for(const [rows,anchor] of [[now,current],[before,previous]] as const){const f=facts.find(f=>f.metric===metric && f.period.start===anchor.period.start && f.period.end===anchor.period.end && f.currency===anchor.currency && f.accountingScope===anchor.accountingScope && f.businessScope===anchor.businessScope && f.category==="actual" && f.comparability==="comparable");rows.push(f?factNode(f):unknownNode(metric,anchor.period));}
  }
  const rows=now.map((node,i):ProfitBridgeRow=>{const old=before[i]!;const comparable=node.value!==null&&old.value!==null&&node.comparability==="comparable"&&old.comparability==="comparable"&&node.currency===old.currency&&node.unit===old.unit;
    return {metric:node.metric,current:node,previous:old,comparison:comparable?"comparable":"not_comparable",change:comparable?node.value!-old.value!:null,changeRatio:comparable&&old.value!>0?(node.value!-old.value!)/Math.abs(old.value!):null,reason:comparable?null:"缺少可比输入，不能计算同比"};});
  const row=(key:string)=>rows.find(r=>r.metric===key)!;
  const supported=(key:string)=>row(key).change!==null&&row(key).change!>0;
  const available=(key:string)=>row(key).comparison==="comparable";
  const ids=(keys:string[])=>keys.flatMap(k=>[...row(k).current.inputs,...row(k).previous.inputs]);
  return {period:current.period,previousPeriod:previous.period,rows,quality:[
    {topic:"收入与毛利",assessment:available("gross_margin")?supported("revenue")&&supported("gross_margin")?"supported":"weakened":"insufficient_evidence",text:"核查收入与毛利率是否同向改善；不把销量变化自动解释为产品竞争力。",inputs:ids(["revenue","gross_margin"])},
    {topic:"归母利润与核心盈利",assessment:available("profit_attributable_to_owners")&&available("core_profit_attributable_to_owners")?(supported("profit_attributable_to_owners")&&supported("core_profit_attributable_to_owners")?"supported":supported("profit_attributable_to_owners")||supported("core_profit_attributable_to_owners")?"partially_supported":"weakened"):"insufficient_evidence",text:"法定归母与发行人核心盈利分开展示。核心盈利为非 HKFRS 指标，不能直接视作正常化盈利；汇兑、减值及其他一次性项目的税后归属影响仍须逐项核查。",inputs:ids(["profit_attributable_to_owners","core_profit_attributable_to_owners","fx_effect"])},
    {topic:"现金流与资本投入",assessment:available("free_cash_flow")?supported("operating_cash_flow")&&supported("free_cash_flow")?"supported":"weakened":"insufficient_evidence",text:"FCF 使用经营现金流减所列现金资本投入。营运资本时点、资本化研发及可持续性尚不能仅凭总额确认。",inputs:ids(["operating_cash_flow","capital_expenditure","free_cash_flow"])}]};
}

function scenarioSourceMatches(s:OperatingScenarioDraft,key:OperatingScenarioKey,f:OperatingFact|undefined,value:number|null):boolean {
 return !!f&&f.value*f.unitScale===value&&f.metric===(key==="asp"?"average_selling_price":key)&&f.category==="actual"&&f.comparability==="comparable"&&operatingModelFingerprint(f.period)===operatingModelFingerprint(s.period)&&(["currency","currency_per_vehicle"].includes(f.unit)?f.currency===s.currency:true)&&!!s.basis&&f.accountingScope===s.basis.accountingScope&&f.businessScope===s.basis.businessScope&&f.measurementBasis===(['sales_volume','asp'].includes(key)?s.basis.salesMeasurementBasis:'financial_statement');
}
function scenarioOtherRevenue(s:OperatingScenarioDraft,facts:OperatingFact[],missing:string[]):number|null {
 const input=s.revenueComposition?.otherRevenue;if(!input)return null;
 if(input.origin==="unknown"){missing.push("other_revenue");return null;}
 if(input.unit!=="currency"||!s.basis||input.origin==="owner_assumption"&&!input.note.trim()){missing.push("other_revenue: explicit Owner reason and basis required");return null;}
 if(input.origin==="source_fact"){
  const f=facts.find(f=>f.id===input.sourceValueId);
  if(!f||f.metric!=="other_revenue"||f.value*f.unitScale!==input.value||f.currency!==s.currency||f.category!=="actual"||f.comparability!=="comparable"||operatingModelFingerprint(f.period)!==operatingModelFingerprint(s.period)||f.accountingScope!==s.basis.accountingScope||f.businessScope!==s.basis.businessScope||f.measurementBasis!=="financial_statement"){missing.push("other_revenue: source period/currency/basis mismatch");return null;}
 }
 return input.value;
}
export function calculateOperatingScenarios(model:OperatingResearchModel,facts:OperatingFact[],marketCurrency:string|null):OperatingScenarioResult[] {
  const share=buildSharesReference(model,facts);
  return model.scenarios.map(s=>{
    const missing:string[]=s.basis?[]:["explicit business and accounting scope"],calculations:OperatingScenarioResult["calculations"]=[];
    const read=(key:keyof typeof s.inputs):number|null=>{const input=s.inputs[key]; if(input.origin==="unknown")return null;
      if(input.origin==="owner_assumption"&&!input.note.trim()){missing.push(`${key}: Owner assumption reason required`);return null;}
      if(input.unit!==operatingInputUnit(key) || !s.basis){missing.push(`${key}: explicit unit and scope required`);return null;}
      if(input.origin==="source_fact"&&!scenarioSourceMatches(s,key,facts.find(f=>f.id===input.sourceValueId),input.value)){missing.push(`${key}: source period/currency/basis mismatch`);return null;}
      return mixedCutoff?null:input.value;};
    const resolvedInputs:Record<OperatingScenarioKey,OperatingResolvedInput>=structuredClone(s.inputs);
    const calc=(metric:string,value:number,formula:string,inputs:string[])=>{if(metric==="revenue"||metric==="normalized_profit")resolvedInputs[metric]={...s.inputs[metric],value,origin:"system_calculation",sourceValueId:null,note:formula};calculations.push({metric,value,formula,inputs,semanticType:"INTERPRETATION",derivationMethod:"deterministic_calculation"});return value;};
    const sourceInputs=[...Object.values(s.inputs),...(s.revenueComposition?[s.revenueComposition.otherRevenue]:[])].filter(i=>i.origin==="source_fact").map(i=>facts.find(f=>f.id===i.sourceValueId)).filter((f):f is OperatingFact=>!!f);
    const mixedCutoff=new Set(sourceInputs.map(f=>f.source.cutoffAt)).size>1;
    if(mixedCutoff)missing.push("source cutoff mismatch");
    const volume=read("sales_volume"),asp=read("asp");
    const automotiveRevenue=volume!==null&&asp!==null?calc("automotive_revenue",volume*asp,"sales_volume × ASP",["sales_volume","asp"]):null;
    const explicitRevenue=read("revenue");
    const otherRevenue=explicitRevenue===null?scenarioOtherRevenue(s,facts,missing):null;
    const revenue=explicitRevenue!==null?explicitRevenue:automotiveRevenue!==null&&otherRevenue!==null?calc("revenue",automotiveRevenue+otherRevenue,"automotive_revenue + other_revenue",["automotive_revenue","other_revenue"]):null;
    if(revenue===null)missing.push("group total revenue requires explicit Total Revenue or explicit Other Revenue");
    const margin=read("gross_margin"),opex=read("opex"),adjustments=read("net_adjustments");
    const grossProfit=revenue!==null&&margin!==null?calc("gross_profit",revenue*margin,"revenue × gross_margin",["revenue","gross_margin"]):null;
    const normalizedProfit=read("normalized_profit")??(grossProfit!==null&&opex!==null&&adjustments!==null?calc("normalized_profit",grossProfit-opex+adjustments,"gross_profit − opex + net_adjustments (tax/minority/one-offs must be included explicitly)",["gross_profit","opex","net_adjustments"]):null);
    const pe=read("pe");if(normalizedProfit===null)missing.push("normalized_profit");if(pe===null)missing.push("Owner PE assumption");
    const equityValue=normalizedProfit!==null&&normalizedProfit>0&&pe!==null?calc("equity_value",normalizedProfit*pe,"normalized_profit × Owner PE",["normalized_profit","pe"]):null;
    if(normalizedProfit!==null&&normalizedProfit<=0)missing.push("PE method requires positive normalized profit");
    if(!share)missing.push("dated, source-bound shares reference with Owner confirmation");
    const conversion=fxRate(model,s.currency,marketCurrency);if(conversion===null)missing.push("explicit dated FX");
    const perShareValue=equityValue!==null&&share&&conversion!==null?calc("per_share_value",equityValue/share.value!*conversion,"equity_value / confirmed shares × explicit FX",["equity_value",...share.inputs,"FX"]):null;
    return {name:s.name,semanticType:"HYPOTHESIS",status:missing.length?"incomplete":"complete",currency:s.currency,period:s.period,inputs:resolvedInputs,revenue,normalizedProfit,equityValue,shares:share?.value??null,perShareValue,perShareCurrency:marketCurrency,calculations,missing};
  });
}
export function buildSharesReference(model:OperatingResearchModel,facts:OperatingFact[]):OperatingNode|null {
  const f=facts.find(f=>f.id===model.sharesValueId);
  if(!model.sharesReferenceConfirmed || !f || f.measurementBasis!=="issued_shares" || f.unit!=="shares" || f.period.kind!=="instant" || f.value<=0 || f.category!=="actual") return null;
  if(f.metric==="shares_outstanding")return factNode(f);
  if(f.metric!=="issued_shares")return null;
  const treasury=facts.filter(t=>t.metric==="treasury_shares"&&sameBasis(f,t));
  if(treasury.length!==1||treasury[0]!.value<0||treasury[0]!.value>=f.value)return null;
  const node=deriveNode("shares_outstanding",[f,treasury[0]!],"issued shares − treasury shares (same reference date)",v=>v[0]!-v[1]!);
  return node?{...node,unit:"shares",currency:null,limitation:"发行人同日已发行股份减库存股份；仅是有日期的流通在外股数参考，Owner 需确认能否用于当前情景。"}:null;
}
function fxRate(model:OperatingResearchModel,from:string,to:string|null):number|null {if(!to)return null;if(from===to)return 1;const fx=model.fx;return fx?.from===from&&fx.to===to&&fx.ownerConfirmed?fx.rate:null;}
export function calculateReverseValuation(model:OperatingResearchModel,facts:OperatingFact[],observed:OperatingMarketObservation|null,scenarios:OperatingScenarioResult[],asOf:string):OperatingReverseValuation {
  const base=scenarios.find(s=>s.name==="base"),draft=model.scenarios.find(s=>s.name==="base"),share=buildSharesReference(model,facts),reasons:string[]=[];
  if(!observed?.fresh || Date.parse(observed.asOf)>Date.parse(asOf))reasons.push("fresh current price unavailable");
  if(!share)reasons.push("confirmed reliable shares unavailable");
  const pe=draft?.inputs.pe.origin==="owner_assumption"?draft.inputs.pe.value:null;if(!pe||pe<=0)reasons.push("Owner PE assumption missing");
  const conversion=draft?fxRate(model,draft.currency,observed?.currency??null):null;if(conversion===null)reasons.push("explicit dated FX missing");
  if(share&&observed&&share.period.end>observed.asOf.slice(0,10))reasons.push("shares reference is later than price");
  const marketCap=observed&&share?observed.price*share.value!:null;
  const implied=!reasons.length&&marketCap!==null&&pe&&conversion?{semanticType:"INTERPRETATION" as const,derivationMethod:"deterministic_calculation" as const,assumedPE:pe,marketCap,marketCapCurrency:observed!.currency,normalizedEarnings:marketCap/pe/conversion,currency:draft!.currency,formula:"observed price × confirmed shares / Owner assumed PE / explicit FX"}:null;
  const ownerView=base?.normalizedProfit!==null&&base?.normalizedProfit!==undefined?{normalizedEarnings:base.normalizedProfit,currency:base.currency}:null;
  return {status:implied?"available":"UNKNOWN",observed,implied,ownerView,gap:implied&&ownerView?implied.normalizedEarnings-ownerView.normalizedEarnings:null,reasons,limitation:"给定 Owner PE 条件下的市场隐含盈利，不代表投资者真实共同预期；股本、汇率和报价时点须单独审阅。"};
}

export function calculateSensitivity(model:OperatingResearchModel,facts:OperatingFact[],currency:string|null) {
  const range=model.sensitivity,base=calculateOperatingScenarios(model,facts,currency).find(s=>s.name==="base");
  if(base?.status!=="complete")return [];
  const choices=[...(model.peSensitivityValues??[]).map(value=>({key:"pe" as const,value})),...(range?[range.lower,range.upper].map(value=>({key:range.variable,value})):[])];
  return choices.map(({key,value})=>{
    const changed=structuredClone(model),scenario=changed.scenarios.find(s=>s.name==="base")!;
    scenario.inputs[key]={...scenario.inputs[key],value,origin:"owner_assumption",sourceValueId:null,note:"Owner selected sensitivity boundary"};
    if(key==="asp"){scenario.inputs.revenue={...scenario.inputs.revenue,value:null,origin:"unknown",sourceValueId:null};}
    if(key==="asp"||key==="gross_margin")scenario.inputs.normalized_profit={...scenario.inputs.normalized_profit,value:null,origin:"unknown",sourceValueId:null};
    const result=calculateOperatingScenarios(changed,facts,currency).find(s=>s.name==="base")!;
    return {variable:key,value,perShareValue:result.perShareValue,normalizedProfit:result.normalizedProfit,semanticType:"INTERPRETATION" as const,limitation:"Assumption sensitivity：单变量变化，其余 Owner 条件固定，不是价格预测。"};
  });
}
export function calculateConditionalRequirements(model:OperatingResearchModel,reverse:OperatingReverseValuation,scenarios:OperatingScenarioResult[]) {
  const s=model.scenarios.find(s=>s.name==="base"),base=scenarios.find(s=>s.name==="base"),target=reverse.implied?.normalizedEarnings;
  if(!s||target===undefined)return {margin:null,revenue:null,label:"conditional implied"};
  const owner=(key:OperatingScenarioKey)=>s.inputs[key].origin==="owner_assumption"?s.inputs[key].value:null;
  const opex=owner("opex"),adjustments=owner("net_adjustments"),margin=owner("gross_margin");
  if(opex===null||adjustments===null)return {margin:null,revenue:null,label:"conditional implied"};
  const needed=target+opex-adjustments;
  return {margin:base?.revenue&&base.revenue>0?needed/base.revenue:null,revenue:margin&&margin>0?needed/margin:null,label:"conditional implied"};
}
