import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { datasetScopeManagement } from "./datasetScopeManagement.repository.js";
import { DatasetScopeError, exactScopeId, scopeKind, scopeCommand } from "./datasetScopeManagement.js";

const messages:Record<string,string>={
  SCOPE_MANAGEMENT_NOT_CONFIGURED:"Dataset Scope 管理尚未啟用或缺少平台 incarnation 設定。",
  SCOPE_924_OR_IMMUTABLE_LEDGER_REQUIRED:"需先審核獨立 924 草稿與受限資料庫身分；不可使用 dbo 執行 Scope 管理。",
  SCOPE_ADMIN_REQUIRED:"需要有效 SYSTEM_ADMIN 與明確的 Dataset Scope 管理能力。",
  SCOPE_VERSION_CONFLICT:"指派版本已變更，請重新載入後審查。",
  SCOPE_DATASET_VERSION_CONFLICT:"Dataset 或來源版本已變更，請重新載入後審查。",
  SCOPE_OWNER_INVALID:"Reviewer 必須綁定目前有效且版本相符的 Owner。",
  SCOPE_SUBJECT_INELIGIBLE:"此帳號尚未啟用或缺少資料分類確認能力。",
  SCOPE_COMMIT_UNKNOWN:"提交結果未能確認。請保留原 RequestId，重新載入查證；不要建立新請求重送。",
};
export function createDatasetScopeManagementRouter(service=datasetScopeManagement,auth:RequestHandler=authenticateJwt){
  const router=Router();
  router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
  router.use(auth,requirePermission("MANAGE_DATASET_SECURITY_SCOPE"));
  router.get("/options",async(req,res)=>{
    try{
      const search=z.string().max(100).parse(req.query.search??"");
      res.json(await service.options(req.headers.authorization,search));
    }catch(e){error(e,res,req.id);}
  });
  router.get("/datasets/:datasetId/scopes",async(req,res)=>{
    try{res.json(await service.list(req.headers.authorization,exactScopeId.parse(req.params.datasetId)));}
    catch(e){error(e,res,req.id);}
  });
  router.get("/datasets/:datasetId/decisions",async(req,res)=>{
    try{res.json(await service.history(req.headers.authorization,exactScopeId.parse(req.params.datasetId),z.string().uuid().optional().parse(req.query.requestId)));}
    catch(e){error(e,res,req.id);}
  });
  router.put("/datasets/:datasetId/scopes/:kind/:userId",async(req,res)=>{
    try{res.json(await service.mutate(req.headers.authorization,exactScopeId.parse(req.params.datasetId),exactScopeId.parse(req.params.userId),scopeKind.parse(req.params.kind),scopeCommand.parse(req.body)));}
    catch(e){error(e,res,req.id);}
  });
  return router;
}
function error(e:unknown,res:import("express").Response,requestId:unknown){
  const known=e instanceof DatasetScopeError,invalid=e instanceof z.ZodError;
  const code=known?e.code:invalid?"SCOPE_INVALID_INPUT":"SCOPE_OPERATION_FAILED";
  res.status(known?e.status:invalid?400:503).json({error:{code,message:messages[code]??"Dataset 指派未完成，請確認權限與版本後重新載入。",requestId}});
}
