// Local isolated Simulator runtime. Generated scoped tokens are kept outside the repository.
import {randomBytes} from 'node:crypto';
import {writeFile,chmod} from 'node:fs/promises';
import {loadConfig} from '../dist/apps/api/src/config.js';
import {buildServer} from '../dist/apps/api/src/server.js';
import {createScopedResearchToken} from '../dist/apps/api/src/routes/researchAuth.js';

const db=process.env.PHASE12_UI_DATABASE_URL,actorId=process.env.PHASE12_UI_ACTOR_ID,port=Number(process.env.PHASE12_UI_PORT),tokenPath=process.env.PHASE12_UI_TOKEN_PATH;
if(!db?.startsWith('postgres://REDACTED_USER@127.0.0.1:5432/')||!actorId||!Number.isInteger(port)||port<1024||!tokenPath?.startsWith('/tmp/phase12-'))throw new Error('isolated local Phase 12 runtime arguments required');
const key=randomBytes(32).toString('hex'),now=Math.floor(Date.now()/1000);
const extraActors=(process.env.PHASE12_UI_EXTRA_ACTORS??'').split(',').filter(Boolean);
for(const [index,actor] of [actorId,...extraActors].entries()){
 const token=createScopedResearchToken({version:2,actorId:actor,scopes:['read'],issuedAt:now,expiresAt:now+3600,tokenId:`phase12-ui-${port}-${now}-${index}`},key);
 const path=index===0?tokenPath:`/tmp/phase12-ui-token-${actor}`;
 await writeFile(path,token,{mode:0o600});await chmod(path,0o600);
}
const config=loadConfig({...process.env,NODE_ENV:'test',DATABASE_URL:db,PORT:String(port),HOST:'127.0.0.1',MARKET_PROVIDER:'unavailable',API_AUTH_SIGNING_KEY:key,STAGING_READONLY_MODE:'false',STAGING_READONLY_AUTH_HEADER_NAME:'x-internal-token',REQUIRE_WRITE_AUTH:'true',RESEARCH_WRITE_ACTOR_ID:actorId});
config.researchEvidenceAi=null;
const app=await buildServer(config);
await app.listen({host:'127.0.0.1',port});
process.stdout.write(`Phase12 UI runtime listening on 127.0.0.1:${port} for ${actorId}\n`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
