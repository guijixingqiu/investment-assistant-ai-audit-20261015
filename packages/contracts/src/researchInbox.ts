export type ResearchInboxItemType =
 "VERSION_REVIEW_REQUIRED"|"QUESTION_EVIDENCE_READY"|"THESIS_TEST_EVIDENCE_READY"|
 "POSSIBLE_CORRECTION"|"CONFLICTING_ASSERTIONS"|"EVIDENCE_INVALIDATED"|"NEW_FINANCIAL_DISCLOSURE"|
 "NEW_OPERATING_DISCLOSURE"|"UNSUPPORTED_DOCUMENT"|"ADMINISTRATIVE_DISCLOSURE"|
 "DUPLICATE_RESOLVED"|"LEAD_ONLY";
export type ResearchInboxActionability="REQUIRED"|"REVIEW_WHEN_RELEVANT"|"INFORMATIONAL"|"RESOLVED";
export type ResearchDocumentRelevance="ACTIVE_RESEARCH"|"GENERAL_RESEARCH"|"ADMINISTRATIVE"|"UNSUPPORTED"|"UNKNOWN";
export type FactReviewAction="CONFIRM_NEW_FACT"|"REVIEW_CORRECTION"|"REVIEW_CONFLICT"|"VERIFY_ADDITIONAL_SOURCE"|"NO_ACTION";
export interface FactReviewGroup {
 id:string;factIdentity:string;currentFactIds:string[];candidateIds:string[];assertionSourceCount:number;
 classification:string;activeQuestionIds:string[];activeThesisTestIds:string[];recommendedAction:FactReviewAction;
 title:string;leadIds:string[];
}
export interface ResearchInboxItem {
 id:string;leadId:string;type:ResearchInboxItemType;actionability:ResearchInboxActionability;
 relevance:ResearchDocumentRelevance;title:string;summary:string;effectiveAt:string;
 eventId:string|null;eventSequence:number|null;documentId:string|null;factGroupIds:string[];questionIds:string[];thesisTestIds:string[];
}
export interface ResearchInboxProjection {
 symbol:string;membershipId:string;membershipVersion:number;requiredCount:number;otherCount:number;
 items:ResearchInboxItem[];factGroups:FactReviewGroup[];
 counts:{required:number;reviewWhenRelevant:number;informational:number;resolved:number};
}
