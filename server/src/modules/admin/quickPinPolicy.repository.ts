import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { DEFAULT_PIN_LENGTH, isAllowedPinLength } from "../auth/quickPin.service.js";

export async function readQuickPinPolicy() {
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  const result = await pool.request().query("SELECT TOP (1) PinLength FROM uqp.QuickPinPolicy WHERE Id=1");
  return { pinLength: Number(result.recordset[0]?.PinLength ?? DEFAULT_PIN_LENGTH) };
}

export async function updateQuickPinPolicy(length: number): Promise<boolean> {
  if (!isAllowedPinLength(length)) throw new Error("INVALID_PIN_LENGTH");
  const pool = await getPlatformDbPool();
  if (!pool) return false;
  await pool.request().input("length", sql.Int, length).query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    DECLARE @oldLength INT;
    SELECT @oldLength=PinLength FROM uqp.QuickPinPolicy WITH (UPDLOCK, HOLDLOCK) WHERE Id=1;
    IF @oldLength IS NULL THROW 50001, 'PIN_POLICY_MISSING', 1;
    IF @oldLength <> @length
    BEGIN
      UPDATE uqp.QuickPinPolicy SET PinLength=@length, UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=1;
      UPDATE uqp.UserQuickPin SET IsEnabled=0, PinVersion=PinVersion+1, UpdatedAtUtc=SYSUTCDATETIME();
      UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME() WHERE RevokedAtUtc IS NULL;
    END
    COMMIT TRANSACTION;
  `);
  return true;
}
