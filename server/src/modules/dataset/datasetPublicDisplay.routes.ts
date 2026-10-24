import {Router} from "express";
import {z} from "zod";
import {env} from "../../config/env.js";
import {authenticateJwt} from "../auth/auth.middleware.js";
import {QueryDeliveryError,createRuntimeIdentityVerifier} from "../queryDefinition/queryDelivery.js";
import {datasetPublicDisplayRepository} from "./datasetPublicDisplay.repository.js";
import {DatasetDisplayError} from "./datasetDisplaySchema.js";
const input=z.object({expectedVersion:z.string().regex(/^[0-9a-f]{16}$/).nullable(),expectedSensitivityVersion:z.number().int().positive().safe(),
  expectedDefinitionVersion:z.string().regex(/^[0-9a-f]{16}$/),expectedConfigurationVersion:z.string().regex(/^[0-9a-f]{16}$/),requestId:z.string().uuid(),confirm:z.literal(true),
  grants:z.array(z.object({columnName:z.string().min(1).max(256).refine(s=>s.trim()===s&&!/[\x00-\x1f\x7f]/u.test(s)),permitted:z.boolean()}).strict()).max(300)}).strict();
export function createDatasetPublicDisplayRouter(deps={repository:datasetPublicDisplayRepository,identity:createRuntimeIdentityVerifier(),enabled:()=>env.DATASET_PUBLIC_DISPLAY_MANAGEMENT,authenticate:authenticateJwt}){
 const router=Router();router.use(deps.authenticate);
 for(const method of ["get","put"] as const)router[method]("/:id/public-display-policy",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");try{
   if(!deps.enabled())throw new DatasetDisplayError("DATASET_DISPLAY_MANAGEMENT_DISABLED",503);
   const id=z.coerce.number().int().positive().safe().parse(req.params.id);
   const actor=(tx:import("mssql").Transaction)=>deps.identity(req.header("Authorization"),tx);
   const result=method==="get"?await deps.repository.get(id,actor):await deps.repository.save(id,actor,input.parse(req.body));
   res.json(result);
  }catch(e){const code=e instanceof DatasetDisplayError||e instanceof QueryDeliveryError?e.code:e instanceof z.ZodError?"VALIDATION_ERROR":"DATASET_DISPLAY_UNAVAILABLE";
   const status=e instanceof DatasetDisplayError||e instanceof QueryDeliveryError?e.status:e instanceof z.ZodError?400:503;
   const guidance:Record<string,string>={DATASET_DISPLAY_SCHEMA_REQUIRED:"925 Schema 尚未安裝、可見性不足或定義不符；請管理者依專用預檢程序處理，不可跳過檢查。",DATASET_DISPLAY_SENSITIVITY_REQUIRED:"請先同步欄位並明確儲存 Dataset 遮蔽政策，再設定公共顯示。",DATASET_DISPLAY_SENSITIVITY_INVALID:"Dataset 遮蔽政策無效；已設定的患者稽核專用識別鍵必須為不傳送（OMIT）。如需顯示識別資料，請另外使用顯示欄位別名並明確設定規則，不可公開稽核專用鍵。"};
   res.status(status).json({error:{code,message:guidance[code]??(code.endsWith("VERSION_CONFLICT")?"政策或資料來源版本已改變，草稿保留；請重新載入確認。":"公共顯示政策未完成，請檢查權限、925 Schema 與欄位政策；資料不會自動公開。"),requestId:req.id}});
  }
 });return router;
}
