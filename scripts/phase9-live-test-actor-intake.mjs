import assert from 'node:assert/strict';
import pg from 'pg';
import {createCandidateMembership} from '../dist/apps/api/src/research/candidateMembershipWriteRepository.js';
import {refreshSourceIntake} from '../dist/apps/api/src/research/researchSourceIntake.js';
const database=process.env.PHASE9_TEST_DATABASE_URL??'',rawRoot=process.env.PHASE9_TEST_RAW_ROOT??'';
assert.match(database,/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/);assert.ok(rawRoot);
const actor={actorType:'user',actorId:`test-phase9-live-${Date.now()}`},pool=new pg.Pool({connectionString:database});
const document={repositoryRoot:process.cwd(),rawStoreRoot:rawRoot,maxBytes:20*1024*1024,maxPages:300,maxPageTextCharacters:200000,maxTotalTextCharacters:5000000,executablePath:null,maxOcrPages:100,maxOcrPageTextCharacters:200000,ocrTimeoutMs:120000,maxOcrBufferBytes:64*1024*1024};
const url='https://www.geelyauto.com.hk/wp-content/uploads/2026/09/Geely_2026_Aug-Sales_EN_20260901.pdf';
const proposal={sourceType:'owner_url',publisher:'Geely Auto official IR',title:'TEST ACTOR · Live August 2026 sales',publicationDate:'2026-09-01',url,documentKind:'monthly_sales',origin:'owner_manual_url'};
try{
 const member=await createCandidateMembership(pool,{market:'HK',code:'00175',initialState:'tracked',idempotencyKey:`phase9-live-${actor.actorId}`},actor,300);
 const opts={document,maxBytes:20*1024*1024};
 const first=await refreshSourceIntake(pool,member.data.id,actor,opts,proposal);
 const second=await refreshSourceIntake(pool,member.data.id,actor,opts,proposal);
 process.stdout.write(JSON.stringify({actorId:actor.actorId,membershipId:member.data.id,officialUrl:url,first:{status:first.leads[0]?.status,documentId:first.leads[0]?.documentId,sha:first.leads[0]?.documentPdfSha256,imported:first.refresh.imported,failed:first.refresh.failed,reviewReason:first.leads[0]?.reviewReason,candidates:first.metrics.candidatesProposed},repeat:{status:second.leads[0]?.status,documentId:second.leads[0]?.documentId,duplicates:second.refresh.duplicates,imported:second.refresh.imported},factConfirmation:'NONE'},null,2)+'\n');
}finally{await pool.end();}
