// Local read journey against the pre-existing Owner-copy research actor. No formal FACT write is scripted.
import fs from 'node:fs';
import {createHmac,randomBytes} from 'node:crypto';
import {loadConfig} from '../dist/apps/api/src/config.js';
import {buildServer} from '../dist/apps/api/src/server.js';
const actorId='step6-public-research-verified',database=process.env.PHASE9_TEST_DATABASE_URL??'',tokenPath=process.env.PHASE9_OWNER_TOKEN_PATH??'',rawRoot=process.env.PHASE9_OWNER_RAW_ROOT??'';
if(!/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/.test(database)||!tokenPath||!rawRoot)throw new Error('isolated local runtime settings required');
const key=randomBytes(48).toString('hex'),payload=Buffer.from(JSON.stringify({version:1,actorId,scopes:['read','research_write'],expiresAt:Math.floor(Date.now()/1000)+86400})).toString('base64url');
fs.writeFileSync(tokenPath,`v1.${payload}.${createHmac('sha256',key).update(payload).digest('base64url')}`,{mode:0o600});
const config=loadConfig({NODE_ENV:'test',DATABASE_URL:database,MARKET_PROVIDER:'futu-http',FUTU_MARKET_DATA_URL:'http://127.0.0.1:4337',API_AUTH_SIGNING_KEY:key,REQUIRE_WRITE_AUTH:'true',WRITE_API_AUTH_HEADER:'x-internal-token',STAGING_READONLY_AUTH_HEADER_NAME:'x-internal-token',RESEARCH_WRITE_ACTOR_ID:actorId,RESEARCH_DOCUMENT_RAW_STORE_ROOT:rawRoot});
const app=await buildServer(config);await app.listen({host:'127.0.0.1',port:4011});
process.stdout.write(JSON.stringify({status:'ready',port:4011,actorId,pid:process.pid})+'\n');process.on('SIGTERM',async()=>{await app.close();process.exit(0)});
