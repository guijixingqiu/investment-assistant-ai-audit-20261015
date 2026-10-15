import {createHash} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {canonicalJson} from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type {ResearchMaterialData} from "../../../../packages/contracts/src/deepResearch.js";
import {DeepResearchGateError,type AuthenticatedResearchActor} from "./domain.js";
import {readResearchDocumentContent} from "./researchDocumentRepository.js";
import {countNormalizedQuote} from "./researchDocumentPdf.js";
import {OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE} from "../../../../packages/contracts/src/researchMaterial.js";
import {readFutuFinancialMaterialPreview} from "./researchFutuFinancialStatementRepository.js";
import {readResearchSourceSnapshot,type SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";

type Reader=Pick<Pool|PoolClient,"query">;
const sha=(text:string|Buffer)=>createHash("sha256").update(text).digest("hex");

/** Re-read selected originals before freeze, replay, and explicit-pack currentness checks. */
export async function assertFrozenMaterialOriginals(client:Reader,membershipId:string,
  actor:AuthenticatedResearchActor,items:ResearchMaterialData[],sourceStore?:SourceSnapshotStoreOptions,
  verifyPdf=false):Promise<void>{
  for(const item of items){
    if(item.futuFinancialSource){
      const source=item.futuFinancialSource;
      if(!sourceStore)throw new DeepResearchGateError("OpenD saved originals must be readable before freezing");
      const preview=await readFutuFinancialMaterialPreview(client,membershipId,source.captureId,source.financialType,
        source.periodEnd,actor,sourceStore);
      if(canonicalJson(preview.source)!==canonicalJson(source)||preview.contentFingerprint!==item.contentFingerprint
        ||preview.sourceVersion!==item.sourceVersion||preview.contentText!==item.contentText)
        throw new DeepResearchGateError("OpenD material source changed before freezing");
    }
    if(item.sourceType==="issuer_public_html"){
      const citation=item.snapshotCitation,original=item.snapshotOriginal;
      if(!sourceStore||!citation||!original)throw new DeepResearchGateError("HTML source original store and citation are required before freezing");
      const source=await readResearchSourceSnapshot(client,membershipId,citation.snapshotId,actor,sourceStore);
      const excerpt=source.normalizedText.slice(citation.startUtf16,citation.endUtf16);
      if(source.membershipId!==membershipId||source.symbol!==item.symbol||source.reviewState==="historical"
        ||source.rawSha256!==original.rawSha256||source.byteLength!==original.byteLength
        ||source.mediaType!==original.mediaType||source.canonicalUrl!==original.canonicalUrl
        ||source.responseUrl!==original.responseUrl||source.textSha256!==citation.textSha256
        ||citation.endUtf16>source.normalizedText.length||excerpt!==item.contentText
        ||sha(excerpt)!==citation.excerptSha256)
        throw new DeepResearchGateError("HTML source original, material, or cited text changed before freezing");
    }
    if(needsPdfOriginalCheck(item,verifyPdf))await assertPdfMaterialOriginal(client,membershipId,actor,item,sourceStore);
  }
}

function needsPdfOriginalCheck(item:ResearchMaterialData,verifyPdf:boolean):boolean{
  return item.sourceType===OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE
    ||verifyPdf&&(item.sourceType==="issuer_public_pdf"||item.sourceType==="owner_provided_pdf");
}

async function assertPdfMaterialOriginal(client:Reader,membershipId:string,actor:AuthenticatedResearchActor,
  item:ResearchMaterialData,sourceStore?:SourceSnapshotStoreOptions):Promise<void>{
  const citation=item.citation;
  if(!sourceStore||!citation)throw new DeepResearchGateError("selected PDF original store and page citation are required");
  const {document,bytes}=await readResearchDocumentContent(client as Pool,membershipId,citation.documentId,actor,
    {repositoryRoot:sourceStore.repositoryRoot,rawStoreRoot:sourceStore.rawStoreRoot});
  const page=(await client.query<{normalized_text:string;text_sha256:string;ocr_applied:boolean}>(
    `select normalized_text,text_sha256,ocr_applied from research_document_pages
     where document_id=$1 and page_number=$2 limit 1`,[citation.documentId,citation.pageNumber])).rows[0];
  const ocrNote=item.sourceType===OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE;
  if(document.symbol!==item.symbol||document.pdfSha256!==sha(bytes)||!page
    ||page.text_sha256!==citation.pageTextSha256||sha(page.normalized_text)!==citation.pageTextSha256
    ||(ocrNote
      ? !page.ocr_applied||item.claimType!=="model_inference"||item.verificationStatus!=="unverified"
        ||item.sourceVersion!==`ocr-note:pdf:${document.pdfSha256}:p${citation.pageNumber}:${citation.pageTextSha256.slice(0,16)}:${sha(item.contentText).slice(0,16)}`
      : item.sourceVersion!==`pdf:${document.pdfSha256}:p${citation.pageNumber}:${citation.pageTextSha256.slice(0,16)}`
        ||countNormalizedQuote(page.normalized_text,item.contentText)!==1))
    throw new DeepResearchGateError("selected PDF original, page, or material changed before freezing");
}
