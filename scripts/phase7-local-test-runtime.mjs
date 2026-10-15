// Explicit local test actor only; same API implementation, no task runner or external writes.
import fs from 'node:fs';import {createHmac,randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
import {loadConfig} from '../dist/apps/api/src/config.js';import {buildServer} from '../dist/apps/api/src/server.js';
const actorId=process.env.PHASE7_TEST_ACTOR,database=process.env.PHASE7_TEST_DATABASE_URL,tokenPath=process.env.PHASE7_TEST_TOKEN_PATH,rawRoot=process.env.PHASE7_TEST_RAW_ROOT;
assert.match(actorId??'',/^test-/);assert.match(database??'',/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/);assert.ok(tokenPath&&rawRoot);
const key=randomBytes(48).toString('hex'),payload=Buffer.from(JSON.stringify({version:1,actorId,scopes:['read','candidate_write','research_write','review_write'],expiresAt:Math.floor(Date.now()/1000)+86400})).toString('base64url');
fs.writeFileSync(tokenPath,`v1.${payload}.${createHmac('sha256',key).update(payload).digest('base64url')}`,{mode:0o600});
const config=loadConfig({NODE_ENV:'test',DATABASE_URL:database,MARKET_PROVIDER:'futu-http',FUTU_MARKET_DATA_URL:'http://127.0.0.1:4337',API_AUTH_SIGNING_KEY:key,REQUIRE_WRITE_AUTH:'true',WRITE_API_AUTH_HEADER:'x-internal-token',STAGING_READONLY_AUTH_HEADER_NAME:'x-internal-token',RESEARCH_WRITE_ACTOR_ID:actorId,RESEARCH_DOCUMENT_RAW_STORE_ROOT:rawRoot});
const app=await buildServer(config);await app.listen({host:'127.0.0.1',port:Number(process.env.PHASE7_TEST_PORT??4047)});
process.on('SIGTERM',async()=>{await app.close();process.exit(0)});
