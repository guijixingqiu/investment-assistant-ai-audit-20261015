// Read-only network diagnostic. No tokens, cookies, database writes or PDF bytes in output.
import {createHash} from 'node:crypto';
import {HkexOfficialAnnouncementProvider} from '../dist/apps/api/src/market/discovery.js';
const issuer='https://www.geelyauto.com.hk/wp-content/uploads/2026/09/Geely_2026_Aug-Sales_EN_20260901.pdf';
async function probe(url){
  const attempts=[];let current=url;
  for(let i=0;i<3;i++){
    try{
      const res=await fetch(current,{redirect:'manual',headers:{accept:'application/pdf','accept-language':'en-US,en;q=0.9','user-agent':'InvestmentAssistantResearch/1.0 (+official PDF research)'},signal:AbortSignal.timeout(15000)});
      const location=res.headers.get('location');const next=location?new URL(location,current).toString():null;
      const record={url:current,status:res.status,contentType:res.headers.get('content-type'),contentLength:res.headers.get('content-length'),redirectOrigin:next?new URL(next).origin:null,headers:{server:res.headers.get('server'),vary:res.headers.get('vary')}};
      if(res.status>=300&&res.status<400){attempts.push(record);if(!next||new URL(next).origin!==new URL(url).origin||i===2)break;current=next;continue;}
      const body=Buffer.from(await res.arrayBuffer());attempts.push({...record,bytes:body.length,magic:body.subarray(0,5).toString('ascii'),sha256:createHash('sha256').update(body).digest('hex'),prefixType:body.subarray(0,5).toString('ascii')==='%PDF-'?'PDF':body.subarray(0,80).toString('utf8').replace(/[^\x20-\x7e]/g,' ').slice(0,48)});break;
    }catch(e){attempts.push({url:current,error:e instanceof Error?`${e.name}: ${e.message}`:String(e)});break;}
  }
  return attempts;
}
const result={observedAt:new Date().toISOString(),issuer:{canonicalUrl:issuer,attempts:await probe(issuer)}};
const provider=await new HkexOfficialAnnouncementProvider().read('HK.00175');
result.hkex={providerStatus:provider.status,providerMessage:provider.message,documentUrl:provider.status==='available'?provider.items[0]?.documentUrl??null:null,attempts:provider.status==='available'&&provider.items[0]?await probe(provider.items[0].documentUrl):[]};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
