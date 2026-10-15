import { operatingModelFingerprint,type OperatingFact } from "./researchOperatingModel.js";
export interface GuidanceComparison {revision?:{previousId:string;previousStatement:string;updatedStatement:string;sourceMaterialId:string;recordedAt:string;reason:string};guidanceId:string;actualId:string|null;identity:"GUIDANCE";metric:string;period:string;publishedAt:string;expectedVerificationDate:string;lower:number|null;upper:number|null;status:"met"|"missed"|"not_comparable"|"pending"|"awaiting_actual";limitation:string}
export function compareGuidance(facts:OperatingFact[],asOf:string):GuidanceComparison[] {
  return facts.filter(f=>f.category==="guidance").map(g=>{
    const d=g.guidance;
    const candidates=facts.filter(a=>a.category==="actual"&&a.metric===g.metric);
    const exact=candidates.filter(a=>a.symbol===g.symbol&&a.membershipId===g.membershipId&&a.membershipVersion===g.membershipVersion&&operatingModelFingerprint(a.period)===operatingModelFingerprint(g.period)&&a.unit===g.unit&&a.currency===g.currency&&a.businessScope===g.businessScope&&a.measurementBasis===g.measurementBasis&&d?.definition===a.measurementBasis&&a.accountingScope===g.accountingScope&&a.comparability==="comparable");
    const a=exact.length===1?exact[0]:undefined;
    let status:GuidanceComparison["status"]="pending";
    if(!d||d.targetType==="text"||g.comparability!=="comparable")status="not_comparable";
    else if(a){const lower=d.lower===null?null:d.lower*g.unitScale,upper=d.upper===null?null:d.upper*g.unitScale,actual=a.value*a.unitScale;
      if(d.targetType==="minimum"&&lower!==null)status=actual>=lower?"met":"missed";
      else if(d.targetType==="maximum"&&upper!==null)status=actual<=upper?"met":"missed";
      else if(d.targetType==="range"&&lower!==null&&upper!==null)status=actual>=lower&&actual<=upper?"met":"missed";
      else status="not_comparable";
    }else if(asOf.slice(0,10)>g.period.end)status=candidates.some(a=>operatingModelFingerprint(a.period)===operatingModelFingerprint(g.period))?"not_comparable":"awaiting_actual";
    return {guidanceId:g.id,actualId:a?.id??null,identity:"GUIDANCE",metric:g.metric,period:g.period.end,publishedAt:g.source.publishedAt,expectedVerificationDate:d?.expectedVerificationDate??g.period.end,lower:(d?.lower??g.value)*g.unitScale,upper:d?.upper===null||d?.upper===undefined?null:d.upper*g.unitScale,status,limitation:g.limitation+"；指引不是实际业绩；验证日是研究跟进日期，不是发行人承诺日期。文本目标及定义不明确时不作达标判断。"};
  });
}
