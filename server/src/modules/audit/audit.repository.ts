import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { logger } from "../../config/logger.js";

export type AuditStartInput = {
  eventType: string;
  userId?: number | null;
  queryDefinitionId?: number | null;
  datasetId?: number | null;
  parameters?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function classifyEvent(eventType: string): { category: "SECURITY" | "CONFIG" | "USAGE" | "SYSTEM"; important: boolean } {
  if (["QUERY_EXECUTE","QUERY_EXPORT_EXCEL","QUERY_EXPORT_CSV"].includes(eventType)) {
    return { category: "USAGE", important: false };
  }
  if (/^(LOGIN|AUTH_|USER_|ROLE_|PERMISSION_)/.test(eventType)) {
    return { category: "SECURITY", important: true };
  }
  if (/^(DATASOURCE_|DATASET_|QUERY_|REPORT_|SETTING_|VERSION_|AUDIT_)/.test(eventType)) {
    return { category: "CONFIG", important: true };
  }
  return { category: "SYSTEM", important: false };
}

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export async function writeAuditEvent(input: AuditStartInput & {
  status?: "SUCCESS" | "FAILED";
  errorCode?: string | null;
}): Promise<number> {
  const pool = await requirePool();
  const parametersJson = input.parameters == null
    ? null
    : JSON.stringify(input.parameters).slice(0, 20000);
  const classification = classifyEvent(input.eventType);
  const status = input.status ?? "SUCCESS";

  const result = await pool.request()
    .input("eventType", sql.NVarChar(50), input.eventType)
    .input("eventCategory", sql.NVarChar(20), classification.category)
    .input("isImportant", sql.Bit, classification.important)
    .input("userId", sql.BigInt, input.userId ?? null)
    .input("queryDefinitionId", sql.BigInt, input.queryDefinitionId ?? null)
    .input("datasetId", sql.BigInt, input.datasetId ?? null)
    .input("status", sql.NVarChar(20), status)
    .input("parametersJson", sql.NVarChar(sql.MAX), parametersJson)
    .input("ipAddress", sql.NVarChar(100), input.ipAddress ?? null)
    .input("userAgent", sql.NVarChar(500), input.userAgent?.slice(0, 500) ?? null)
    .input("errorCode", sql.NVarChar(200), input.errorCode?.slice(0, 200) ?? null)
    .query(`
      INSERT INTO uqp.AuditLog (
        EventType, EventCategory, IsImportant, UserId, QueryDefinitionId, DatasetId,
        Status, ParametersJson, IpAddress, UserAgent, ErrorCode, CompletedAtUtc
      )
      OUTPUT INSERTED.Id
      VALUES (
        @eventType,@eventCategory,@isImportant,@userId,@queryDefinitionId,@datasetId,
        @status,@parametersJson,@ipAddress,@userAgent,@errorCode,SYSUTCDATETIME()
      )
    `);

  return Number(result.recordset[0].Id);
}

export async function tryWriteAuditEvent(input: AuditStartInput & {
  status?: "SUCCESS" | "FAILED";
  errorCode?: string | null;
}): Promise<void> {
  try {
    await writeAuditEvent(input);
  } catch (error) {
    logger.warn(
      { err: error, eventType: input.eventType },
      "Failed to write management Audit event",
    );
  }
}

export async function startAudit(input: AuditStartInput): Promise<number> {
  const pool = await requirePool();
  const parametersJson = input.parameters == null
    ? null
    : JSON.stringify(input.parameters).slice(0, 20000);

  const classification = classifyEvent(input.eventType);

  const result = await pool.request()
    .input("eventType", sql.NVarChar(50), input.eventType)
    .input("eventCategory", sql.NVarChar(20), classification.category)
    .input("isImportant", sql.Bit, classification.important)
    .input("userId", sql.BigInt, input.userId ?? null)
    .input("queryDefinitionId", sql.BigInt, input.queryDefinitionId ?? null)
    .input("datasetId", sql.BigInt, input.datasetId ?? null)
    .input("parametersJson", sql.NVarChar(sql.MAX), parametersJson)
    .input("ipAddress", sql.NVarChar(100), input.ipAddress ?? null)
    .input("userAgent", sql.NVarChar(500), input.userAgent?.slice(0, 500) ?? null)
    .query(`
      INSERT INTO uqp.AuditLog (
        EventType, EventCategory, IsImportant, UserId, QueryDefinitionId, DatasetId,
        Status, ParametersJson, IpAddress, UserAgent
      )
      OUTPUT INSERTED.Id
      VALUES (
        @eventType,@eventCategory,@isImportant,@userId,@queryDefinitionId,@datasetId,
        'STARTED',@parametersJson,@ipAddress,@userAgent
      )
    `);

  return Number(result.recordset[0].Id);
}

export async function completeAuditSuccess(
  id: number,
  input: { rowCount?: number; durationMs?: number },
): Promise<void> {
  const pool = await requirePool();
  await pool.request()
    .input("id", sql.BigInt, id)
    .input("rowCount", sql.Int, input.rowCount ?? null)
    .input("durationMs", sql.Int, input.durationMs ?? null)
    .query(`
      UPDATE uqp.AuditLog
      SET Status='SUCCESS', ResultRowCount=@rowCount, DurationMs=@durationMs,
          CompletedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id
    `);
}

export async function completeAuditFailure(
  id: number,
  input: { errorCode?: string; durationMs?: number },
): Promise<void> {
  const pool = await requirePool();
  await pool.request()
    .input("id", sql.BigInt, id)
    .input("errorCode", sql.NVarChar(200), input.errorCode?.slice(0, 200) ?? null)
    .input("durationMs", sql.Int, input.durationMs ?? null)
    .query(`
      UPDATE uqp.AuditLog
      SET Status='FAILED', ErrorCode=@errorCode, DurationMs=@durationMs,
          CompletedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id
    `);
}

export async function listAuditLogs(input: {
  page: number;
  pageSize: number;
  eventType?: string;
  eventCategory?: string;
  username?: string;
  source?: "LIVE" | "ARCHIVE";
}) {
  const pool = await requirePool();
  const offset = (input.page - 1) * input.pageSize;

  const request = pool.request()
    .input("offset", sql.Int, offset)
    .input("pageSize", sql.Int, input.pageSize)
    .input("eventType", sql.NVarChar(50), input.eventType ?? null)
    .input("eventCategory", sql.NVarChar(20), input.eventCategory ?? null)
    .input("username", sql.NVarChar(100), input.username ?? null);

  const archive = input.source === "ARCHIVE";
  const result = await request.query(archive ? `
    SELECT a.Id, a.EventType, a.EventCategory, a.IsImportant, a.Status, a.ParametersJson,
           a.ResultRowCount AS [RowCount], a.DurationMs, a.IpAddress, a.ErrorCode,
           a.CreatedAtUtc, a.CompletedAtUtc, a.Username, a.DisplayName,
           a.QueryCode, a.QueryName
    FROM uqp.AuditLogArchive a
    WHERE (@eventType IS NULL OR a.EventType=@eventType)
      AND (@eventCategory IS NULL OR a.EventCategory=@eventCategory)
      AND (@username IS NULL OR a.Username LIKE '%' + @username + '%')
    ORDER BY a.CreatedAtUtc DESC, a.Id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(1) AS Total
    FROM uqp.AuditLogArchive a
    WHERE (@eventType IS NULL OR a.EventType=@eventType)
      AND (@eventCategory IS NULL OR a.EventCategory=@eventCategory)
      AND (@username IS NULL OR a.Username LIKE '%' + @username + '%');
  ` : `
    SELECT a.Id, a.EventType, a.EventCategory, a.IsImportant, a.Status, a.ParametersJson,
           a.ResultRowCount AS [RowCount], a.DurationMs, a.IpAddress, a.ErrorCode, a.CreatedAtUtc,
           a.CompletedAtUtc, u.Username, u.DisplayName,
           q.Code AS QueryCode, q.Name AS QueryName
    FROM uqp.AuditLog a
    LEFT JOIN uqp.AppUser u ON u.Id=a.UserId
    LEFT JOIN uqp.QueryDefinition q ON q.Id=a.QueryDefinitionId
    WHERE (@eventType IS NULL OR a.EventType=@eventType)
      AND (@eventCategory IS NULL OR a.EventCategory=@eventCategory)
      AND (@username IS NULL OR u.Username LIKE '%' + @username + '%')
    ORDER BY a.CreatedAtUtc DESC, a.Id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(1) AS Total
    FROM uqp.AuditLog a
    LEFT JOIN uqp.AppUser u ON u.Id=a.UserId
    WHERE (@eventType IS NULL OR a.EventType=@eventType)
      AND (@eventCategory IS NULL OR a.EventCategory=@eventCategory)
      AND (@username IS NULL OR u.Username LIKE '%' + @username + '%');
  `);

  const recordsets = result.recordsets as any[];
  return {
    items: (recordsets[0] ?? []).map((row: any) => ({
      id: Number(row.Id),
      eventType: String(row.EventType),
      eventCategory: String(row.EventCategory),
      isImportant: Boolean(row.IsImportant),
      status: String(row.Status),
      parametersJson: row.ParametersJson == null ? null : String(row.ParametersJson),
      rowCount: row.RowCount == null ? null : Number(row.RowCount),
      durationMs: row.DurationMs == null ? null : Number(row.DurationMs),
      ipAddress: row.IpAddress == null ? null : String(row.IpAddress),
      errorCode: row.ErrorCode == null ? null : String(row.ErrorCode),
      createdAtUtc: new Date(row.CreatedAtUtc).toISOString(),
      completedAtUtc: row.CompletedAtUtc ? new Date(row.CompletedAtUtc).toISOString() : null,
      username: row.Username == null ? null : String(row.Username),
      displayName: row.DisplayName == null ? null : String(row.DisplayName),
      queryCode: row.QueryCode == null ? null : String(row.QueryCode),
      queryName: row.QueryName == null ? null : String(row.QueryName),
    })),
    total: Number(recordsets[1]?.[0]?.Total ?? 0),
  };
}


async function readAuditRetentionSettings() {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT SettingKey, SettingValue
    FROM uqp.SystemSetting
    WHERE SettingKey IN (
      'AUDIT_ONLINE_RETENTION_DAYS',
      'AUDIT_ARCHIVE_RETENTION_DAYS',
      'AUDIT_IMPORTANT_PERMANENT'
    )
  `);

  let onlineRetentionDays = 365;
  let archiveRetentionDays = 1825;
  let importantPermanent = true;

  for (const row of result.recordset) {
    const key = String(row.SettingKey);
    const value = String(row.SettingValue ?? "");
    if (key === "AUDIT_ONLINE_RETENTION_DAYS" && Number.isInteger(Number(value)) && Number(value) >= 30) {
      onlineRetentionDays = Number(value);
    }
    if (key === "AUDIT_ARCHIVE_RETENTION_DAYS" && Number.isInteger(Number(value)) && Number(value) >= 365) {
      archiveRetentionDays = Number(value);
    }
    if (key === "AUDIT_IMPORTANT_PERMANENT") {
      importantPermanent = value.toLowerCase() !== "false";
    }
  }

  return { onlineRetentionDays, archiveRetentionDays, importantPermanent };
}

export async function previewAuditLifecycle() {
  const pool = await requirePool();
  const settings = await readAuditRetentionSettings();
  const result = await pool.request()
    .input("onlineDays", sql.Int, settings.onlineRetentionDays)
    .input("archiveDays", sql.Int, settings.archiveRetentionDays)
    .input("importantPermanent", sql.Bit, settings.importantPermanent)
    .query(`
      SELECT
        (SELECT COUNT(1)
         FROM uqp.AuditLog
         WHERE CreatedAtUtc < DATEADD(DAY, -@onlineDays, SYSUTCDATETIME())
           AND Status<>'STARTED') AS ArchiveCount,
        (SELECT COUNT(1)
         FROM uqp.AuditLogArchive
         WHERE CreatedAtUtc < DATEADD(DAY, -@archiveDays, SYSUTCDATETIME())
           AND (@importantPermanent=0 OR IsImportant=0)) AS DeleteCount
    `);

  return {
    ...settings,
    archiveCount: Number(result.recordset[0]?.ArchiveCount ?? 0),
    deleteCount: Number(result.recordset[0]?.DeleteCount ?? 0),
  };
}

export async function archiveOldAuditLogs() {
  const pool = await requirePool();
  const settings = await readAuditRetentionSettings();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const result = await new sql.Request(tx)
      .input("onlineDays", sql.Int, settings.onlineRetentionDays)
      .query(`
        INSERT INTO uqp.AuditLogArchive (
          Id, EventType, EventCategory, IsImportant, UserId, Username, DisplayName,
          QueryDefinitionId, QueryCode, QueryName, DatasetId, DatasetCode, DatasetName,
          Status, ParametersJson, ResultRowCount, DurationMs, IpAddress, UserAgent,
          ErrorCode, CreatedAtUtc, CompletedAtUtc
        )
        SELECT
          a.Id, a.EventType, a.EventCategory, a.IsImportant, a.UserId, u.Username, u.DisplayName,
          a.QueryDefinitionId, q.Code, q.Name, a.DatasetId, d.Code, d.Name,
          a.Status, a.ParametersJson, a.ResultRowCount, a.DurationMs, a.IpAddress, a.UserAgent,
          a.ErrorCode, a.CreatedAtUtc, a.CompletedAtUtc
        FROM uqp.AuditLog a
        LEFT JOIN uqp.AppUser u ON u.Id=a.UserId
        LEFT JOIN uqp.QueryDefinition q ON q.Id=a.QueryDefinitionId
        LEFT JOIN uqp.Dataset d ON d.Id=a.DatasetId
        WHERE a.CreatedAtUtc < DATEADD(DAY, -@onlineDays, SYSUTCDATETIME())
          AND a.Status<>'STARTED'
          AND NOT EXISTS (SELECT 1 FROM uqp.AuditLogArchive x WHERE x.Id=a.Id);

        DECLARE @Inserted INT = @@ROWCOUNT;

        DELETE a
        FROM uqp.AuditLog a
        WHERE a.CreatedAtUtc < DATEADD(DAY, -@onlineDays, SYSUTCDATETIME())
          AND a.Status<>'STARTED'
          AND EXISTS (SELECT 1 FROM uqp.AuditLogArchive x WHERE x.Id=a.Id);

        SELECT @Inserted AS ArchivedCount;
      `);

    await tx.commit();
    return { archivedCount: Number(result.recordset[0]?.ArchivedCount ?? 0) };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function cleanupAuditArchive() {
  const pool = await requirePool();
  const settings = await readAuditRetentionSettings();
  const result = await pool.request()
    .input("archiveDays", sql.Int, settings.archiveRetentionDays)
    .input("importantPermanent", sql.Bit, settings.importantPermanent)
    .query(`
      DELETE FROM uqp.AuditLogArchive
      WHERE CreatedAtUtc < DATEADD(DAY, -@archiveDays, SYSUTCDATETIME())
        AND (@importantPermanent=0 OR IsImportant=0);
      SELECT @@ROWCOUNT AS DeletedCount;
    `);

  return { deletedCount: Number(result.recordset[0]?.DeletedCount ?? 0) };
}
