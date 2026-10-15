import {validFutuValuationBridge,type FutuValuationBridge,type FutuValuationType} from "../../../../packages/contracts/src/researchValuationProvider.js";

export class FutuValuationProviderError extends Error {
  constructor(readonly code:string,message:string){super(message);}
}

/** Bounded reader for the existing localhost OpenD bridge; its bytes become the saved original. */
export class FutuValuationProvider {
  private readonly baseUrl:URL;
  constructor(baseUrl:string,private readonly fetchImpl:typeof fetch=fetch,private readonly now:()=>Date=()=>new Date()){
    const url=new URL(baseUrl);
    if(url.protocol!=="http:"||!["127.0.0.1","localhost","[::1]"].includes(url.hostname)
      ||url.username||url.password||url.search||url.hash)
      throw new Error("Futu valuation detail requires the configured loopback quote bridge");
    this.baseUrl=url;
  }
  async read(symbol:string,type:FutuValuationType):Promise<{bytes:Buffer;data:FutuValuationBridge}>{
    if(!/^HK\.\d{5}$/.test(symbol)||!["PE","PB"].includes(type))
      throw new FutuValuationProviderError("INVALID_REQUEST","canonical HK symbol and PE/PB type are required");
    const url=new URL("/valuation-detail",this.baseUrl);
    url.searchParams.set("symbol",symbol);url.searchParams.set("valuationType",type);
    let response:Response;
    try{response=await this.fetchImpl(url,{signal:AbortSignal.timeout(8_000)});}
    catch{throw new FutuValuationProviderError("BRIDGE_UNAVAILABLE","OpenD valuation detail did not return");}
    if(!response.ok)throw new FutuValuationProviderError("BRIDGE_HTTP_ERROR",`OpenD valuation detail returned HTTP ${response.status}`);
    const length=Number(response.headers.get("content-length"));
    if(Number.isFinite(length)&&length>524_288)throw new FutuValuationProviderError("RESPONSE_TOO_LARGE","valuation detail exceeds the bounded source size");
    if(!response.body)throw new FutuValuationProviderError("RESPONSE_EMPTY","OpenD valuation detail has no body");
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
    try{
      while(true){
        const {value,done}=await reader.read();if(done)break;
        total+=value.length;
        if(total>524_288){await reader.cancel();throw new FutuValuationProviderError("RESPONSE_TOO_LARGE","valuation detail exceeds the bounded source size");}
        chunks.push(value);
      }
    }finally{reader.releaseLock();}
    const bytes=Buffer.concat(chunks,total);
    if(!bytes.length||bytes.length>524_288)throw new FutuValuationProviderError("RESPONSE_TOO_LARGE","valuation detail is empty or too large");
    let data:unknown;
    try{data=JSON.parse(bytes.toString("utf8"));}
    catch{throw new FutuValuationProviderError("INVALID_JSON","OpenD valuation detail is not JSON");}
    if(!validFutuValuationBridge(data,symbol,type,this.now()))
      throw new FutuValuationProviderError("SOURCE_INVALID","OpenD valuation detail source identity or five-year trend is invalid");
    return {bytes,data};
  }
}
