import { Router } from "express";
import sql from "mssql";
import { z } from "zod";
import { env } from "../../config/env.js";
import { getPlatformDbPool } from "../../config/database.js";
import { writeAuditEvent } from "../audit/audit.repository.js";
import { requirePermission } from "../auth/auth.middleware.js";
import { createRuntimeIdentityVerifier, QueryDeliveryError } from "../queryDefinition/queryDelivery.js";
import { datasetPublicDisplayRepository } from "./datasetPublicDisplay.repository.js";
import { getDatasetSensitivitySnapshot, replaceDatasetSensitiveColumns } from "./datasetSensitiveColumn.repository.js";
import { readColumnCandidateSnapshot } from "./datasetColumnCandidate.js";
import { listDatasetColumns } from "./column.repository.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { buildSimpleNonPatientRules, simpleReviewSchema, simpleReviewEligible, SimpleReviewError } from "./datasetManagementApproval.simpleReview.js";
import { managerPlaybackGrants } from "./datasetManagementApproval.policy.js";
import { decodeDatasetApprovalRevision } from "./datasetManagementApproval.revision.js";
import { readConfirmedDatasetDeliverySnapshot } from "./datasetDeliveryPolicy.repository.js";
import { resolveDatasetPreviewSafety } from "./datasetManagementApproval.previewSafety.js";

const idSchema = z.coerce.number().int().positive().safe();
const usageSchema = z.object({
  approve: z.boolean(),
  expectedVersion: z.string().regex(/^[a-f0-9]{16}$/i),
}).strict();
const playbackSchema = z.object({
  approve: z.boolean(),
  requestId: z.string().uuid(),
}).strict();

class ApprovalError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
const verify = createRuntimeIdentityVerifier();

async function requireManager(header: string | undefined, tx?: sql.Transaction) {
  const actor = await verify(header, tx);
  if (!actor.permissions.includes("MANAGE_USERS") ||
      !actor.permissions.includes("DESIGN_QUERY")) throw new ApprovalError("FORBIDDEN", 403);
  return actor;
}
async function platformPool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new ApprovalError("PLATFORM_DB_NOT_CONFIGURED", 503);
  return pool;
}
async function readUsage(id: number, tx?: sql.Transaction, lock = false) {
  const poolOrRequest = tx ? new sql.Request(tx) : (await platformPool()).request();
  const result = await poolOrRequest.input("id", sql.BigInt, id).query(
    "SELECT IsActive,IsArchived,DefinitionRowVersion AS DefinitionVersion " +
    "FROM uqp.Dataset " + (lock ? "WITH(UPDLOCK,HOLDLOCK) " : "") + "WHERE Id=@id"
  );
  if (!result.recordset.length) throw new ApprovalError("DATASET_NOT_FOUND", 404);
  const item = result.recordset[0];
  if (item.IsArchived) throw new ApprovalError("DATASET_ARCHIVED", 409);
  const definitionVersion = decodeDatasetApprovalRevision(item.DefinitionVersion);
  if (!definitionVersion) throw new ApprovalError("DATASET_REVISION_INVALID", 503);
  return { active: Boolean(item.IsActive), definitionVersion };
}

function respondError(res: import("express").Response, e: unknown) {
  const known = e instanceof ApprovalError || e instanceof QueryDeliveryError || e instanceof SimpleReviewError;
  const code = known ? e.code : e instanceof z.ZodError ? "VALIDATION_ERROR" : "MANAGER_APPROVAL_UNAVAILABLE";
  const status = known ? e.status : e instanceof z.ZodError ? 400 : 503;
  const messages: Record<string, string> = {
    FORBIDDEN: "只有具有管理權限的帳號可核准使用及播放。",
    DATASET_NOT_FOUND: "找不到 Dataset。",
    DATASET_ARCHIVED: "已封存 Dataset 不可核准。",
    MANAGER_APPROVAL_VERSION_CONFLICT: "Dataset 已變更，請重新載入後再核准。",
    MANAGER_APPROVAL_SENSITIVITY_REQUIRED: "尚未具備可受信任的欄位遮蔽政策，不能核准公共播放。",
    MANAGER_APPROVAL_NO_SAFE_VISIBLE_COLUMNS: "沒有可安全公開的欄位，播放維持不核准。",
    DATASET_DISPLAY_MANAGEMENT_DISABLED: "公共顯示政策管理功能尚未啟用，不能核准播放。",
    MANAGER_APPROVAL_UNAVAILABLE: "安全核准未完成，既有權限與遮蔽保護維持不變。",
    REVIEW_COLUMNS_NOT_READY: "尚無可審查的已儲存欄位清單；請先於 SQL 欄位候選預覽取得並儲存設計用欄位。",
    REVIEW_COLUMN_MISMATCH: "安全審查必須逐一確認全部已儲存欄位；欄位內容已變更，請重新取得並確認。",
    REVIEW_PATIENT_SCOPE_REQUIRED: "一般非患者資料簡化審查不適用於患者資料；請先完成患者識別與揭露稽核審查。",
    REVIEW_VERSION_CONFLICT: "Dataset、來源或欄位安全政策版本已改變，請重新載入後再審查。",
    REVIEW_EXISTING_POLICY: "此 Dataset 已有安全政策；為避免覆蓋既有遮蔽規則，簡化首次審查不允許修改。",
    REVIEW_WRITE_FAILED: "安全審查未完成，維持原本的遮蔽政策；請依 Request ID 查核。",
  };
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: { code, message: messages[code] ?? messages.MANAGER_APPROVAL_UNAVAILABLE } });
}

export function createDatasetManagementApprovalRouter() {
  const router = Router();
  // Parent datasetRouter already authenticates JWT and requires DESIGN_QUERY.
  router.use("/:id/management-approval", requirePermission("MANAGE_USERS"));

  router.get("/:id/management-approval", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await requireManager(req.header("Authorization"));
      const id = idSchema.parse(req.params.id);
      const usage = await readUsage(id);
      let playback: { status: "APPROVED" | "UNAPPROVED" | "STALE" | "BLOCKED"; permittedColumns: number; message: string } =
        { status: "BLOCKED", permittedColumns: 0, message: "公共顯示政策管理未開啟或安全條件尚未具備。" };
      if (env.DATASET_PUBLIC_DISPLAY_MANAGEMENT && usage.active) {
        try {
          const actor = (tx: sql.Transaction) => requireManager(req.header("Authorization"), tx);
          const state = await datasetPublicDisplayRepository.get(id, actor);
          const count = state.policy?.grants.filter(g => g.permitted).length ?? 0;
          playback = { status: state.status === "STALE" ? "STALE" :
            state.status === "CONFIRMED" && count > 0 ? "APPROVED" : "UNAPPROVED",
            permittedColumns: state.status === "CONFIRMED" ? count : 0,
            message: state.status === "STALE" ? "資料定義或政策已變動，需重新核准。" : "" };
        } catch {
          playback = { status: "BLOCKED", permittedColumns: 0, message: "安全政策尚未完成，不能核准播放。" };
        }
      }
      const previewSafety = await resolveDatasetPreviewSafety(usage.active, () => readConfirmedDatasetDeliverySnapshot(id));
      res.json({ usage, playback, previewSafety });
    } catch (e) { respondError(res, e); }
  });

  // Read-only first-review context. DatasetColumn is a design catalogue only.
  // The manager must inspect every column and positively attest nonpatient scope.
  router.get("/:id/management-approval/safety-review", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const manager=await requireManager(req.header("Authorization"));
      if (!manager.permissions.includes("EXECUTE_QUERY")) throw new ApprovalError("FORBIDDEN",403);
      const id=idSchema.parse(req.params.id);
      const source=await readColumnCandidateSnapshot(await platformPool(),id);
      if (!source || source.datasetArchived || !source.sourceActive) throw new ApprovalError("DATASET_NOT_FOUND",404);
      const [policy,columns,patient]=await Promise.all([getDatasetSensitivitySnapshot(id),listDatasetColumns(id),
        (await platformPool()).request().input("id",sql.BigInt,id).query(`
          SELECT CASE WHEN EXISTS(SELECT 1 FROM uqp.DatasetPatientAuditConfig WHERE DatasetId=@id)
            OR EXISTS(SELECT 1 FROM uqp.DatasetPatientAuditMetadata WHERE DatasetId=@id)
            THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasPatientEvidence`),
      ]);
      const patientEvidence=patient.recordset.length!==1 || Boolean(patient.recordset[0].HasPatientEvidence);
      const available=simpleReviewEligible(policy.version,policy.columns.length,columns.length,
        patientEvidence,source.sourceType);
      res.json({ expectedDefinitionVersion:source.definitionVersion,
        expectedSourceVersion:source.configurationVersion,
        expectedPolicyVersion:policy.version,
        available,
        columns:columns.map(c=>({name:c.name,dataType:c.dataType,ordinal:c.ordinal})),
        note:patientEvidence
          ? "已存在患者稽核設定或患者欄位歷史 Metadata，禁止使用非患者簡化審查；請改走患者資料專用審查。"
          : "僅限管理者明確確認的一般非患者資料；既有遮蔽政策不會被簡化審查覆寫。" });
    } catch (e) { respondError(res,e); }
  });

  router.put("/:id/management-approval/safety-review", async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    try {
      const manager=await requireManager(req.header("Authorization"));
      if (!manager.permissions.includes("EXECUTE_QUERY")) throw new ApprovalError("FORBIDDEN",403);
      const id=idSchema.parse(req.params.id);
      const input=simpleReviewSchema.parse(req.body);
      const saved=await listDatasetColumns(id);
      const rules=buildSimpleNonPatientRules(saved,input);
      const version=await replaceDatasetSensitiveColumns(id,rules,manager.userId,
        auditRequestContext(req),input.expectedPolicyVersion,[],
        {expectedDefinitionVersion:input.expectedDefinitionVersion,
         expectedSourceVersion:input.expectedSourceVersion,requestId:input.requestId,
         reauthorize:async tx=>{
           const current=await requireManager(req.header("Authorization"),tx);
           if (!current.permissions.includes("EXECUTE_QUERY") ||
               current.userId!==manager.userId || current.tokenVersion!==manager.tokenVersion)
             throw new ApprovalError("FORBIDDEN",403);
         }});
      res.json({status:"OK",version});
    } catch(e) {
      const code=e instanceof Error?e.message:"";
      if (["REVIEW_VERSION_CONFLICT","REVIEW_PATIENT_SCOPE_REQUIRED",
           "REVIEW_COLUMN_MISMATCH","REVIEW_EXISTING_POLICY"].includes(code))
        respondError(res,new ApprovalError(code));
      else if (code==="SENSITIVITY_VERSION_CONFLICT") respondError(res,new ApprovalError("REVIEW_VERSION_CONFLICT"));
      else if (code==="SENSITIVITY_COLUMN_NOT_FOUND") respondError(res,new ApprovalError("REVIEW_COLUMN_MISMATCH"));
      else respondError(res,e);
    }
  });

  router.put("/:id/management-approval/usage", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let tx: sql.Transaction | undefined;
    try {
      const id = idSchema.parse(req.params.id);
      const input = usageSchema.parse(req.body);
      tx = new sql.Transaction(await platformPool());
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await new sql.Request(tx).query("SET XACT_ABORT ON");
      const actor = await requireManager(req.header("Authorization"), tx);
      const before = await readUsage(id, tx, true);
      if (before.definitionVersion !== input.expectedVersion) {
        throw new ApprovalError("MANAGER_APPROVAL_VERSION_CONFLICT");
      }
      if (before.active !== input.approve) {
        const result = await new sql.Request(tx)
          .input("id", sql.BigInt, id)
          .input("active", sql.Bit, input.approve)
          .input("version", sql.Binary, Buffer.from(input.expectedVersion, "hex"))
          .query("UPDATE uqp.Dataset SET IsActive=@active,UpdatedAtUtc=SYSUTCDATETIME() " +
                 "WHERE Id=@id AND IsArchived=0 AND DefinitionRowVersion=@version; " +
                 "SELECT @@ROWCOUNT AS Affected;");
        if (Number(result.recordset[0]?.Affected) !== 1) throw new ApprovalError("MANAGER_APPROVAL_VERSION_CONFLICT");
        if (!input.approve) {
          await new sql.Request(tx).input("id", sql.BigInt, id).query(
            "UPDATE uqp.QueryDefinition SET IsPublished=0,PublishedAtUtc=NULL,PublishedByUserId=NULL," +
            "UpdatedAtUtc=SYSUTCDATETIME() WHERE DatasetId=@id AND IsPublished=1"
          );
        }
        const auditId = await writeAuditEvent({
          eventType: input.approve ? "DATASET_USAGE_APPROVED" : "DATASET_USAGE_REVOKED",
          userId: actor.userId, datasetId: id,
          parameters: { previousActive: before.active, approved: input.approve, revision: before.definitionVersion }
        }, tx);
        if (!Number.isSafeInteger(auditId) || auditId <= 0) throw new ApprovalError("MANAGER_APPROVAL_AUDIT_FAILED", 503);
      }
      const latestActor = await requireManager(req.header("Authorization"), tx);
      if (latestActor.userId !== actor.userId || latestActor.tokenVersion !== actor.tokenVersion) {
        throw new ApprovalError("FORBIDDEN", 403);
      }
      await tx.commit();
      res.json({ status: "OK" });
    } catch (e) {
      if (tx) try { await tx.rollback(); } catch { /* Preserve the original error. */ }
      respondError(res, e);
    }
  });

  router.put("/:id/management-approval/playback", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!env.DATASET_PUBLIC_DISPLAY_MANAGEMENT) throw new ApprovalError("DATASET_DISPLAY_MANAGEMENT_DISABLED", 503);
      const id = idSchema.parse(req.params.id);
      const input = playbackSchema.parse(req.body);
      const actor = async (tx: sql.Transaction) => {
        const user = await requireManager(req.header("Authorization"), tx);
        if (!user.permissions.includes("EXECUTE_QUERY")) throw new ApprovalError("FORBIDDEN", 403);
        return user;
      };
      const before = await datasetPublicDisplayRepository.get(id, actor);
      const sensitivity = await getDatasetSensitivitySnapshot(id);
      if (sensitivity.version !== before.sensitivityVersion) throw new ApprovalError("MANAGER_APPROVAL_VERSION_CONFLICT");
      const grants = managerPlaybackGrants(sensitivity, input.approve);
      const updated = await datasetPublicDisplayRepository.save(id, actor, {
        expectedVersion: before.version,
        expectedSensitivityVersion: before.sensitivityVersion,
        expectedDefinitionVersion: before.definitionVersion,
        expectedConfigurationVersion: before.configurationVersion,
        requestId: input.requestId,
        grants,
      });
      res.json({ status: updated.status, permittedColumns: updated.policy?.grants.filter(g => g.permitted).length ?? 0 });
    } catch (e) { respondError(res, e); }
  });
  return router;
}
