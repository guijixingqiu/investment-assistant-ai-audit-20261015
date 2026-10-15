import type {FastifyInstance} from "fastify";
import {validatePortfolioResearchExposure} from "../../../../packages/contracts/src/portfolioResearchContext.js";
import {PortfolioResearchContextError,readPortfolioResearchContext} from "../portfolio/portfolioResearchContext.js";
import {authenticateReadOnly,derivePinganSnapshotAccountScope} from "./researchAuth.js";
import type {MobileResearchRouteOptions} from "./mobileResearch.js";

export async function registerPortfolioResearchContextRoutes(app:FastifyInstance,options:MobileResearchRouteOptions):Promise<void>{
 app.get("/api/mobile/assets/research-context",async(request,reply)=>{
  reply.header("cache-control","no-store");
  const actor=authenticateReadOnly(request.headers,options);
  if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
  try{
   const projection=await readPortfolioResearchContext(options.pool,actor,{accountScopeId:derivePinganSnapshotAccountScope(actor,options),quoteLiveMaxAgeSeconds:options.quoteLiveMaxAgeSeconds,pinganCurrentMaxAgeSeconds:options.pinganCurrentMaxAgeSeconds??300,membershipLiveMaxAgeSeconds:options.quoteLiveMaxAgeSeconds,portfolioEnabled:options.pinganCurrentPortfolioEnabled,
    sourceStore:options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
      rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined},options.now?.()??new Date());
   if(!validatePortfolioResearchExposure(projection))return reply.code(503).send({ok:false,message:"Portfolio Research Context failed validation"});
   return projection;
  }catch(error){
   if(error instanceof PortfolioResearchContextError)return reply.code(error.statusCode).send({ok:false,code:error.code,message:error.message});
   return reply.code(503).send({ok:false,message:"Portfolio Research Context unavailable"});
  }
 });
}
