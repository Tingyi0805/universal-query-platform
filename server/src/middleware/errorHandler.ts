import { PatientAuditError } from "../modules/dataset/patientAuditConfig.service.js";
import type { ErrorRequestHandler } from "express";
import { safeErrorDiagnostic } from "./safeErrorDiagnostic.js";
import { logger } from "../config/logger.js";
import { SecurityContractError } from "../modules/securityContract/securityContract.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = req.id;
  if (error instanceof SecurityContractError || error instanceof PatientAuditError) {
    res.status(error.status).json({ error: { code: error.code,
      message: "安全契約驗證未通過，請確認 Schema 與版本。", requestId } });
    return;
  }

  const diagnostic = safeErrorDiagnostic(error);
  const invalidBind = diagnostic.applicationCode === "ORACLE_BIND_INVALID";
  const driverBindError = ["NJS-011", "NJS-012", "NJS-044", "ORA-01008", "ORA-01036"].includes(diagnostic.oracleCode ?? "");
  const code = invalidBind ? "ORACLE_BIND_INVALID" : driverBindError ? "ORACLE_BIND_ERROR" : "INTERNAL_SERVER_ERROR";
  logger.error(
    {
      // Driver messages/stack traces can contain SQL, bind values or connection strings.
      code,
      requestId,
      method: req.method,
      ...diagnostic,
    },
    "Unhandled request error",
  );

  res.status(invalidBind ? 400 : 500).json({
    error: {
      code,
      message: invalidBind ? "Oracle 不支援此參數值型別。請使用文字、有限數字或有效日期；布林條件請依 SQL 定義使用 0／1。" :
        driverBindError ? "Oracle 參數綁定失敗，請管理者檢查參數型別與 SQL Bind 定義。" : "伺服器發生未預期錯誤。",
      requestId,
    },
  });
};
