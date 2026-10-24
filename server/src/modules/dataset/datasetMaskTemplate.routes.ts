import {Router} from "express";
import {env} from "../../config/env.js";
import {authenticateJwt} from "../auth/auth.middleware.js";
import {createRuntimeIdentityVerifier,QueryDeliveryError} from "../queryDefinition/queryDelivery.js";
import {maskTemplateInput,maskTemplateRepository} from "./datasetMaskTemplate.repository.js";
import {DatasetDisplayError,exactPositiveId} from "./datasetDisplaySchema.js";
import {z} from "zod";
export function createMaskTemplateRouter(deps={repository:maskTemplateRepository,identity:createRuntimeIdentityVerifier(),authenticate:authenticateJwt,enabled:()=>env.DATASET_MASK_TEMPLATE_MANAGEMENT}){
 const router=Router();router.use(deps.authenticate);
 for(const [method,path] of [["get","/"],["post","/"],["put","/:id"]] as const)router[method](path,async(req,res)=>{
  res.setHeader("Cache-Control","no-store");try{if(!deps.enabled())throw new DatasetDisplayError("MASK_TEMPLATE_MANAGEMENT_DISABLED",503);const actor=(tx:import("mssql").Transaction)=>deps.identity(req.header("Authorization"),tx);
   if(method==="get")res.json({templates:await deps.repository.list(actor)});
   else{const id=method==="put"?(req.params as Record<string,string>).id!:null;if(id&&!exactPositiveId(id))throw new DatasetDisplayError("VALIDATION_ERROR",400);res.json(await deps.repository.save(actor,id,maskTemplateInput.parse(req.body)));}
  }catch(e){const typed=e instanceof DatasetDisplayError||e instanceof QueryDeliveryError;res.status(typed?e.status:e instanceof z.ZodError?400:503).json({error:{code:typed?e.code:e instanceof z.ZodError?"VALIDATION_ERROR":"MASK_TEMPLATE_UNAVAILABLE",message:"範本操作未完成；請檢查權限、版本與 Schema。現有 Dataset 不會被範本更新覆寫。",requestId:req.id}});}
 });return router;
}
