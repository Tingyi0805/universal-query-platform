import {Router} from "express";
import {authenticateJwt,requirePermission} from "../auth/auth.middleware.js";
import {z} from "zod";
import {datasetFieldInitialization,initializeFieldsCommand} from "./datasetFieldInitialization.repository.js";
import {DatasetScopeError,exactScopeId} from "./datasetScopeManagement.js";
import {SourceFenceError} from "./sqlServerSourceFence.js";
const messages:Record<string,string>={
  SOURCE_PROVIDER_NOT_REGISTERED:"尚未註冊經審查的來源 Metadata Provider；Source Fence 仍 BLOCKED。",
  SOURCE_DEPENDENCY_UNPROVEN:"此階段僅支援單一實體表；跨資料庫、View、Synonym、Function 或未知依賴均拒絕。",
  SOURCE_SQL_UNSUPPORTED:"此階段僅接受明確欄位的 SELECT schema.table，不支援其他 SQL 組合。",
  SOURCE_COLUMN_INVALID:"欄位名稱、順序、Native Type 或來源欄位對應不符合初始化契約。",
  SOURCE_IDENTITY_CONFLICT:"來源 identity／incarnation 與核准觀測不符，請停止並由管理員查核。",
  SOURCE_SCHEMA_DRIFT:"來源結構已漂移；保留原政策與歷史欄位，停止確認及交付。",
  SOURCE_GATE_UNAVAILABLE:"無法取得來源 Gate，來源可能正在變更；本次未完成初始化。",
  METADATA_VERSION_CONFLICT:"Dataset／來源版本已改變，請重新載入並確認有效 Scope。",
  METADATA_SNAPSHOT_CONFLICT:"欄位 Snapshot 已被其他操作更新，請重新載入，不自動重送。",
  METADATA_PARAMETER_OR_SOURCE_UNSUPPORTED:"只支援無參數、已儲存且啟用的 SQL Server Dataset。",
  SCOPE_METADATA_AUTHORIZATION_REQUIRED:"需指定 Dataset 的有效 Owner／Reviewer、DESIGN_QUERY 及分類確認能力。",
};
export function createDatasetFieldInitializationRouter(service=datasetFieldInitialization,auth:import("express").RequestHandler=authenticateJwt){
  const r=Router();r.use((_q,s,n)=>{s.setHeader("Cache-Control","no-store");n();},auth,requirePermission("DESIGN_QUERY"),requirePermission("CONFIRM_DATASET_CLASSIFICATION"));
  const fail=(e:unknown,s:import("express").Response)=>{
    const code=e instanceof DatasetScopeError||e instanceof SourceFenceError?e.code:e instanceof z.ZodError?"METADATA_INVALID_INPUT":"METADATA_OPERATION_UNKNOWN";
    s.status(e instanceof DatasetScopeError?e.status:e instanceof z.ZodError?400:503).json({error:{code,message:
      messages[code]??
      "欄位初始化未完成。請確認有效 Owner/Reviewer、已儲存版本與來源 Fence；結果不明時保留 RequestId 查證，不要自動重送。"}});
  };
  r.get("/:datasetId",async(q,s)=>{try{s.json(await service.status(q.headers.authorization,exactScopeId.parse(q.params.datasetId)));}catch(e){fail(e,s);}});
  r.post("/:datasetId",async(q,s)=>{try{s.json(await service.collect(q.headers.authorization,exactScopeId.parse(q.params.datasetId),initializeFieldsCommand.parse(q.body)));}catch(e){fail(e,s);}});
  return r;
}
