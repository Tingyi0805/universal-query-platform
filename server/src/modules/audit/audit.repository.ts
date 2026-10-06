import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type AuditStartInput = {
  eventType: string;
  userId?: number | null;
  queryDefinitionId?: number | null;
  datasetId?: number | null;
  parameters?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export async function startAudit(input: AuditStartInput): Promise<number> {
  const pool = await requirePool();
  const parametersJson = input.parameters == null
    ? null
    : JSON.stringify(input.parameters).slice(0, 20000);

  const result = await pool.request()
    .input("eventType", sql.NVarChar(50), input.eventType)
    .input("userId", sql.BigInt, input.userId ?? null)
    .input("queryDefinitionId", sql.BigInt, input.queryDefinitionId ?? null)
    .input("datasetId", sql.BigInt, input.datasetId ?? null)
    .input("parametersJson", sql.NVarChar(sql.MAX), parametersJson)
    .input("ipAddress", sql.NVarChar(100), input.ipAddress ?? null)
    .input("userAgent", sql.NVarChar(500), input.userAgent?.slice(0, 500) ?? null)
    .query(`
      INSERT INTO uqp.AuditLog (
        EventType, UserId, QueryDefinitionId, DatasetId,
        Status, ParametersJson, IpAddress, UserAgent
      )
      OUTPUT INSERTED.Id
      VALUES (
        @eventType,@userId,@queryDefinitionId,@datasetId,
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
      SET Status='SUCCESS', RowCount=@rowCount, DurationMs=@durationMs,
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
  username?: string;
}) {
  const pool = await requirePool();
  const offset = (input.page - 1) * input.pageSize;

  const request = pool.request()
    .input("offset", sql.Int, offset)
    .input("pageSize", sql.Int, input.pageSize)
    .input("eventType", sql.NVarChar(50), input.eventType ?? null)
    .input("username", sql.NVarChar(100), input.username ?? null);

  const result = await request.query(`
    SELECT a.Id, a.EventType, a.Status, a.ParametersJson, a.RowCount,
           a.DurationMs, a.IpAddress, a.ErrorCode, a.CreatedAtUtc,
           a.CompletedAtUtc, u.Username, u.DisplayName,
           q.Code AS QueryCode, q.Name AS QueryName
    FROM uqp.AuditLog a
    LEFT JOIN uqp.AppUser u ON u.Id=a.UserId
    LEFT JOIN uqp.QueryDefinition q ON q.Id=a.QueryDefinitionId
    WHERE (@eventType IS NULL OR a.EventType=@eventType)
      AND (@username IS NULL OR u.Username LIKE '%' + @username + '%')
    ORDER BY a.CreatedAtUtc DESC, a.Id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(1) AS Total
    FROM uqp.AuditLog a
    LEFT JOIN uqp.AppUser u ON u.Id=a.UserId
    WHERE (@eventType IS NULL OR a.EventType=@eventType)
      AND (@username IS NULL OR u.Username LIKE '%' + @username + '%');
  `);

  const recordsets = result.recordsets as sql.IRecordSet<any>[];
  return {
    items: (recordsets[0] ?? []).map((row) => ({
      id: Number(row.Id),
      eventType: String(row.EventType),
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
