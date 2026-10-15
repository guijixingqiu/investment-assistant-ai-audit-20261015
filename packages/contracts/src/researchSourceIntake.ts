import {operatingModelFingerprint} from "./researchOperatingModel.js";
export type ResearchSourceType="issuer_ir"|"hkex_official"|"futu_notice"|"owner_url";
export type ResearchSourceLeadStatus="DISCOVERED"|"SUPPORTED"|"IMPORTED"|"DUPLICATE"|"REJECTED"|"NEEDS_REVIEW";
export type ResearchDocumentKind="monthly_sales"|"financial_results"|"announcement"|"other";
export type DocumentReviewState="TRUSTED"|"NEEDS_REVIEW"|"REJECTED";
export interface ResearchSourceLeadEvent {sequence:number;eventId:string;leadId:string;fromStatus:ResearchSourceLeadStatus|null;toStatus:ResearchSourceLeadStatus;eventType:string;documentId:string|null;pdfSha256:string|null;previousDocumentId:string|null;previousPdfSha256:string|null;reasonCode:string|null;reasonSnapshot:string|null;reason:string|null;observedAt:string;actor:string}
export function publicationDate(value:string):string {
 const date=/^\d{4}-\d{2}-\d{2}$/.test(value)?value:value.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))||new Date(`${date}T00:00:00.000Z`).toISOString().slice(0,10)!==date)throw new TypeError("valid publication date required");
 return date;
}
export interface ResearchSourceLead {
 leadId:string;symbol:string;membershipId:string;membershipVersion:number;sourceType:ResearchSourceType;
 publisher:string;title:string;publicationDate:string;publishedAt:string;discoveredAt:string;canonicalUrl:string;
 documentKind:ResearchDocumentKind;providerCategory?:string|null;status:ResearchSourceLeadStatus;origin:string;
 documentId:string|null;documentPdfSha256:string|null;reviewReason:string|null;statusChangedAt:string;
 latestObservedDocumentId:string|null;latestObservedPdfSha256:string|null;activeTrustedDocumentId:string|null;activeTrustedPdfSha256:string|null;pendingReviewDocumentId:string|null;
 lastFetchAttemptAt:string|null;lastFetchSuccessAt:string|null;lastFetchFailureCode:string|null;consecutiveFetchFailures:number;nextRetryAt:string|null;
 lastCheckedAt:string|null;documentReviewState?:DocumentReviewState|null;versions?:Array<{documentId:string;pdfSha256:string;pageCount:number;reviewState:DocumentReviewState;importedAt:string;textFingerprint:string}>;
}
export interface DocumentVersionIdentity {publisher:string;documentKind:ResearchDocumentKind;publishedAt:string;documentPdfSha256:string;capturedUrl:string}
export function canonicalSourceUrl(raw:string):string {
 const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password||u.port||u.hostname.length>200)throw new TypeError("HTTPS publisher URL required");
 u.hash="";u.hostname=u.hostname.toLowerCase();for(const key of [...u.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(key))u.searchParams.delete(key);
 u.searchParams.sort();return u.toString();
}
/** Only an official publisher origin may be automatically captured as a document. */
export function supportedOfficialUrl(url:string,symbol:string):boolean {
 try{const u=new URL(canonicalSourceUrl(url));return (u.hostname==="www1.hkexnews.hk"||u.hostname==="www.hkexnews.hk")&&u.pathname.toLowerCase().endsWith(".pdf")||symbol==="HK.00175"&&u.hostname==="www.geelyauto.com.hk"&&u.pathname.toLowerCase().endsWith(".pdf");}catch{return false;}
}
/** Initial HTML scope is one issuer-named article, never an entire group site. */
export function supportedOfficialHtmlUrl(url:string,symbol:string):boolean {
 try {
  const u=new URL(canonicalSourceUrl(url));
  return symbol==="HK.00175"&&u.hostname==="global.geely.com"&&u.pathname==="/en/news/2025/geely-auto-2025-h1-revenues"&&!u.search;
 } catch {return false;}
}
export function sourceLeadId(identity:{symbol:string;membershipId:string;membershipVersion:number;url:string;publishedAt?:string;publicationDate?:string;documentKind:ResearchDocumentKind}):string {return operatingModelFingerprint({symbol:identity.symbol,membershipId:identity.membershipId,membershipVersion:identity.membershipVersion,url:canonicalSourceUrl(identity.url),publicationDate:publicationDate(identity.publicationDate??identity.publishedAt??""),documentKind:identity.documentKind});}
export function documentVersionIdentity(input:DocumentVersionIdentity):string{return operatingModelFingerprint({...input,capturedUrl:canonicalSourceUrl(input.capturedUrl)});}
export function proposedLeadImpact(lead:ResearchSourceLead,candidateMetrics:string[],questionTargets:string[],testMetrics:string[]){
 const candidates=new Set(candidateMetrics),questions=questionTargets.filter(x=>candidates.has(x)),tests=testMetrics.filter(x=>candidates.has(x));
 return {leadId:lead.leadId,semanticType:"CANDIDATE" as const,questionMetrics:[...new Set(questions)],thesisTestMetrics:[...new Set(tests)],limitation:"可能影响既有研究问题或配置的检验；候选不是 FACT，未改变正式判断。"};
}
