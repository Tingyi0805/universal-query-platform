import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { decryptSecret, encryptSecret } from "../../security/secretCrypto.js";
import type { DataSourceConfig, DataSourceListItem } from "./datasource.types.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function mapRow(row: any): DataSourceListItem {
  return {
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    type: row.Type,
    host: String(row.Host),
    port: Number(row.Port),
    databaseName: row.DatabaseName ? String(row.DatabaseName) : null,
    oracleServiceName: row.OracleServiceName ? String(row.OracleServiceName) : null,
    oracleConnectionMode: row.OracleConnectionMode ?? null,
    odbcConnectionMode: row.OdbcConnectionMode ?? null,
    odbcDsn: row.OdbcDsn ? String(row.OdbcDsn) : null,
    username: String(row.Username),
    connectionTimeoutSec: Number(row.ConnectionTimeoutSec),
    queryTimeoutSec: Number(row.QueryTimeoutSec),
    encryptConnection: Boolean(row.EncryptConnection),
    trustServerCertificate: Boolean(row.TrustServerCertificate),
    isActive: Boolean(row.IsActive),
    hasPassword: Boolean(row.EncryptedPassword),
    hasOdbcConnectionString: Boolean(row.EncryptedOdbcConnectionString),
  };
}

export async function listDataSources(): Promise<DataSourceListItem[]> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT Id, Code, Name, Type, Host, Port, DatabaseName, OracleServiceName,
           OracleConnectionMode, OdbcConnectionMode, OdbcDsn,
           EncryptedOdbcConnectionString, Username, EncryptedPassword,
           ConnectionTimeoutSec, QueryTimeoutSec, EncryptConnection,
           TrustServerCertificate, IsActive
    FROM uqp.DataSource
    ORDER BY Name, Code
  `);
  return result.recordset.map(mapRow);
}

export async function getDataSourceConfig(id: number): Promise<DataSourceConfig | null> {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id).query(`
    SELECT TOP (1) *
    FROM uqp.DataSource
    WHERE Id=@id
  `);
  const row = result.recordset[0];
  if (!row) return null;

  return {
    ...mapRow(row),
    password: decryptSecret(String(row.EncryptedPassword)),
    odbcConnectionString: row.EncryptedOdbcConnectionString
      ? decryptSecret(String(row.EncryptedOdbcConnectionString))
      : null,
  };
}

export async function createDataSource(config: DataSourceConfig): Promise<number> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("code", sql.NVarChar(100), config.code)
    .input("name", sql.NVarChar(200), config.name)
    .input("type", sql.NVarChar(20), config.type)
    .input("host", sql.NVarChar(255), config.host)
    .input("port", sql.Int, config.port)
    .input("databaseName", sql.NVarChar(255), config.databaseName)
    .input("oracleServiceName", sql.NVarChar(255), config.oracleServiceName)
    .input("oracleConnectionMode", sql.NVarChar(20), config.oracleConnectionMode)
    .input("odbcConnectionMode", sql.NVarChar(30), config.odbcConnectionMode)
    .input("odbcDsn", sql.NVarChar(255), config.odbcDsn)
    .input("encryptedOdbcConnectionString", sql.NVarChar(4000),
      config.odbcConnectionString ? encryptSecret(config.odbcConnectionString) : null)
    .input("username", sql.NVarChar(200), config.username)
    .input("encryptedPassword", sql.NVarChar(2000), encryptSecret(config.password))
    .input("connectionTimeoutSec", sql.Int, config.connectionTimeoutSec)
    .input("queryTimeoutSec", sql.Int, config.queryTimeoutSec)
    .input("encryptConnection", sql.Bit, config.encryptConnection)
    .input("trustServerCertificate", sql.Bit, config.trustServerCertificate)
    .input("isActive", sql.Bit, config.isActive)
    .query(`
      INSERT INTO uqp.DataSource (
        Code, Name, Type, Host, Port, DatabaseName, OracleServiceName,
        OracleConnectionMode, OdbcConnectionMode, OdbcDsn,
        EncryptedOdbcConnectionString, Username, EncryptedPassword,
        ConnectionTimeoutSec, QueryTimeoutSec, EncryptConnection,
        TrustServerCertificate, IsActive
      )
      OUTPUT INSERTED.Id
      VALUES (
        @code,@name,@type,@host,@port,@databaseName,@oracleServiceName,
        @oracleConnectionMode,@odbcConnectionMode,@odbcDsn,
        @encryptedOdbcConnectionString,@username,@encryptedPassword,
        @connectionTimeoutSec,@queryTimeoutSec,@encryptConnection,
        @trustServerCertificate,@isActive
      )
    `);
  return Number(result.recordset[0].Id);
}

export async function updateDataSource(
  id: number,
  input: Omit<DataSourceConfig, "password"> & { password?: string },
): Promise<void> {
  const pool = await requirePool();
  const existing = await pool.request().input("id", sql.BigInt, id)
    .query("SELECT EncryptedPassword, EncryptedOdbcConnectionString FROM uqp.DataSource WHERE Id=@id");
  if (!existing.recordset[0]) throw new Error("DATASOURCE_NOT_FOUND");

  const encryptedPassword = input.password
    ? encryptSecret(input.password)
    : String(existing.recordset[0].EncryptedPassword);

  const encryptedOdbcConnectionString = input.odbcConnectionString
    ? encryptSecret(input.odbcConnectionString)
    : existing.recordset[0].EncryptedOdbcConnectionString
      ? String(existing.recordset[0].EncryptedOdbcConnectionString)
      : null;

  if (
    input.type === "ODBC" &&
    input.odbcConnectionMode === "CONNECTION_STRING" &&
    !encryptedOdbcConnectionString
  ) {
    throw new Error("ODBC_CONNECTION_STRING_REQUIRED");
  }

  await pool.request()
    .input("id", sql.BigInt, id)
    .input("code", sql.NVarChar(100), input.code)
    .input("name", sql.NVarChar(200), input.name)
    .input("type", sql.NVarChar(20), input.type)
    .input("host", sql.NVarChar(255), input.host)
    .input("port", sql.Int, input.port)
    .input("databaseName", sql.NVarChar(255), input.databaseName)
    .input("oracleServiceName", sql.NVarChar(255), input.oracleServiceName)
    .input("oracleConnectionMode", sql.NVarChar(20), input.oracleConnectionMode)
    .input("odbcConnectionMode", sql.NVarChar(30), input.odbcConnectionMode)
    .input("odbcDsn", sql.NVarChar(255), input.odbcDsn)
    .input("encryptedOdbcConnectionString", sql.NVarChar(4000), encryptedOdbcConnectionString)
    .input("username", sql.NVarChar(200), input.username)
    .input("encryptedPassword", sql.NVarChar(2000), encryptedPassword)
    .input("connectionTimeoutSec", sql.Int, input.connectionTimeoutSec)
    .input("queryTimeoutSec", sql.Int, input.queryTimeoutSec)
    .input("encryptConnection", sql.Bit, input.encryptConnection)
    .input("trustServerCertificate", sql.Bit, input.trustServerCertificate)
    .input("isActive", sql.Bit, input.isActive)
    .query(`
      UPDATE uqp.DataSource SET
        Code=@code, Name=@name, Type=@type, Host=@host, Port=@port,
        DatabaseName=@databaseName, OracleServiceName=@oracleServiceName,
        OracleConnectionMode=@oracleConnectionMode,
        OdbcConnectionMode=@odbcConnectionMode, OdbcDsn=@odbcDsn,
        EncryptedOdbcConnectionString=@encryptedOdbcConnectionString,
        Username=@username, EncryptedPassword=@encryptedPassword,
        ConnectionTimeoutSec=@connectionTimeoutSec, QueryTimeoutSec=@queryTimeoutSec,
        EncryptConnection=@encryptConnection,
        TrustServerCertificate=@trustServerCertificate,
        IsActive=@isActive, UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id
    `);
}

export async function deleteDataSource(id: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id)
    .query("DELETE FROM uqp.DataSource WHERE Id=@id; SELECT @@ROWCOUNT AS Affected;");
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("DATASOURCE_NOT_FOUND");
  }
}


export async function getDataSourceDeleteImpact(id: number) {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id).query(`
    SELECT
      CASE WHEN EXISTS (SELECT 1 FROM uqp.DataSource WHERE Id=@id) THEN 1 ELSE 0 END AS ExistsFlag,
      (SELECT COUNT(1) FROM uqp.Dataset WHERE DataSourceId=@id) AS DatasetCount
  `);
  const row = result.recordset[0];
  if (!row || !Boolean(row.ExistsFlag)) throw new Error("DATASOURCE_NOT_FOUND");
  const datasetCount = Number(row.DatasetCount ?? 0);
  return { canDelete: datasetCount === 0, datasetCount };
}
