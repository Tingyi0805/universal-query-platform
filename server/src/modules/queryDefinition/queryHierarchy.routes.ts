import {createHash} from "node:crypto";
import {logger} from "../../config/logger.js";
import {Router} from "express";
import {z} from "zod";
import {authenticateJwt} from "../auth/auth.middleware.js";
import {getClientIp} from "../../utils/clientIp.js";
import {createRuntimeIdentityVerifier,QueryDeliveryError} from "./queryDelivery.js";
import {queryHierarchyRepository} from "./queryHierarchy.repository.js";
import {queryHierarchyService} from "./queryHierarchy.service.js";
import {hierarchyPageSchema,parseHierarchyGraph} from "./queryHierarchy.contract.js";
const id=z.coerce.number().int().positive().safe(),ref=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const atom=z.union([z.string().max(4000),z.number().finite(),z.boolean(),z.null()]);
const values=z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),z.union([atom,z.array(atom).max(500)])).refine(v=>Object.keys(v).length<=100);
export const hierarchyRouteDependencies={authenticate:authenticateJwt,identity:createRuntimeIdentityVerifier(),store:queryHierarchyRepository,service:queryHierarchyService};
export function createQueryHierarchyRouter(deps=hierarchyRouteDependencies){
 const router=Router();router.use("/:id/hierarchy",deps.authenticate);router.use("/:id/hierarchy",(_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
 const handle=(kind:"CAPABILITY"|"CONFIG"|"SAVE"|"OPTIONS"|"CREATE"|"PAGE"|"NAVIGATE"|"BACK"|"DELETE")=>async(req:import("express").Request,res:import("express").Response)=>{
  try{
   if(Object.keys(req.query).length)throw new QueryDeliveryError("VALIDATION_ERROR",400);
   const root=id.parse(req.params.id),identity=(tx?:import("mssql").Transaction)=>deps.identity(req.headers.authorization,tx);
   const actor=await identity();if(actor.pinSession)throw new QueryDeliveryError("PIN_HIERARCHY_NOT_VERIFIED",403);
   if(!actor.permissions.includes("VIEW_QUERY")||!actor.permissions.includes("EXECUTE_QUERY"))throw new QueryDeliveryError("FORBIDDEN",403);
   if(["CONFIG","SAVE","OPTIONS"].includes(kind))await deps.store.requireAdmin(identity);
   if(kind==="CAPABILITY"){
    try{const saved=await deps.store.read(root);if(saved)await deps.service.options(root,identity);res.json({available:!!saved});}catch(e){if(e instanceof QueryDeliveryError&&e.code==="HIERARCHY_SCHEMA_REQUIRED"){res.json({available:false,reason:e.code});}else throw e;}return;
   }
   if(kind==="CONFIG"){const saved=await deps.store.read(root);res.json(saved??{graph:null,revision:"MISSING"});return;}
   if(kind==="OPTIONS"){res.json(await deps.service.options(root,identity));return;}
   if(kind==="SAVE"){
    const body=z.object({graph:z.unknown(),expectedRevision:z.string().regex(/^(MISSING|[a-f0-9]{16})$/)}).strict().parse(req.body);
    const graph=parseHierarchyGraph(body.graph);await deps.service.validate(root,graph,identity);
    res.json(await deps.store.save(root,graph,body.expectedRevision,identity,async tx=>deps.service.bindingEvidence(root,graph,identity,tx)));return;
   }
   const owner=createHash("sha256").update(req.headers.authorization??"").digest("hex"),meta={ipAddress:getClientIp(req),userAgent:req.get("user-agent")??null};
   if(kind==="CREATE"){const body=z.object({values}).strict().parse(req.body);res.json(await deps.service.create(root,owner,body.values,identity,meta));return;}
   const context=ref.parse(req.params.contextId);
   if(kind==="NAVIGATE"){const body=z.object({edge:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),rowRef:ref}).strict().parse(req.body);
    res.json(await deps.service.act(root,context,owner,identity,{kind,...body},meta));return;}
   const body=kind==="PAGE"?hierarchyPageSchema.parse(req.body):z.object({}).strict().parse(req.body??{});
   res.json(await deps.service.act(root,context,owner,identity,{kind,...(kind==="PAGE"?{controls:body as z.infer<typeof hierarchyPageSchema>}:{})},meta));
  }catch(e){const code=e instanceof QueryDeliveryError?e.code:e instanceof z.ZodError?"VALIDATION_ERROR":e instanceof Error&&/^HIERARCHY_[A-Z_]+$/.test(e.message)?e.message:"HIERARCHY_DELIVERY_REJECTED";
   logger.warn({requestId:req.id,kind,code},"Hierarchy request rejected");
   res.status(e instanceof QueryDeliveryError?e.status:e instanceof z.ZodError?400:503).json({error:{code,message:"多層查詢未交付資料，請確認發布、欄位政策、映射及目前權限，重新回主層。",requestId:(req as any).id}});}
 };
 router.get("/:id/hierarchy/capabilities",handle("CAPABILITY"));
 router.get("/:id/hierarchy/configuration",handle("CONFIG"));router.put("/:id/hierarchy/configuration",handle("SAVE"));router.get("/:id/hierarchy/options",handle("OPTIONS"));
 router.post("/:id/hierarchy/contexts",handle("CREATE"));
 for(const kind of ["PAGE","NAVIGATE","BACK"] as const)router.post(`/:id/hierarchy/contexts/:contextId/${kind.toLowerCase()}`,handle(kind));
 router.delete("/:id/hierarchy/contexts/:contextId",handle("DELETE"));
 return router;
}
