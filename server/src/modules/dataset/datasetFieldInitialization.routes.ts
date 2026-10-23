import {Router} from "express";
import {authenticateJwt,requirePermission} from "../auth/auth.middleware.js";
import {z} from "zod";
import {datasetFieldInitialization,initializeFieldsCommand} from "./datasetFieldInitialization.repository.js";
import {DatasetScopeError,exactScopeId} from "./datasetScopeManagement.js";
import {SourceFenceError} from "./sqlServerSourceFence.js";
export function createDatasetFieldInitializationRouter(service=datasetFieldInitialization,auth:import("express").RequestHandler=authenticateJwt){
  const r=Router();r.use((_q,s,n)=>{s.setHeader("Cache-Control","no-store");n();},auth,requirePermission("DESIGN_QUERY"),requirePermission("CONFIRM_DATASET_CLASSIFICATION"));
  const fail=(e:unknown,s:import("express").Response)=>{
    const code=e instanceof DatasetScopeError||e instanceof SourceFenceError?e.code:e instanceof z.ZodError?"METADATA_INVALID_INPUT":"METADATA_OPERATION_UNKNOWN";
    s.status(e instanceof DatasetScopeError?e.status:e instanceof z.ZodError?400:503).json({error:{code,message:
      code==="SOURCE_PROVIDER_NOT_REGISTERED"?"尚未註冊經審查的來源 Metadata Provider；Source Fence 仍 BLOCKED。":
      "欄位初始化未完成。請確認有效 Owner/Reviewer、已儲存版本與來源 Fence；結果不明時保留 RequestId 查證，不要自動重送。"}});
  };
  r.get("/:datasetId",async(q,s)=>{try{s.json(await service.status(q.headers.authorization,exactScopeId.parse(q.params.datasetId)));}catch(e){fail(e,s);}});
  r.post("/:datasetId",async(q,s)=>{try{s.json(await service.collect(q.headers.authorization,exactScopeId.parse(q.params.datasetId),initializeFieldsCommand.parse(q.body)));}catch(e){fail(e,s);}});
  return r;
}
