import sql from "mssql";
import type { DataSourceType } from "./datasource.types.js";
import { evidenceId, expectedRowVersion, rowVersion, VersionFoundationError, versionRepositoryDependencies,
  versionTransaction, type VersionRepositoryDependencies } from "./versionFoundation.js";

export type DataSourceVersionEvidence = Readonly<{
  dataSourceId: string; configurationVersion: string; sourceType: DataSourceType; isActive: true;
}>;
export function validateSourceVersionExpectation(value: DataSourceVersionEvidence): void {
  if (!value || typeof value !== "object" || value.isActive !== true
    || !["SQLSERVER", "ORACLE", "MYSQL", "POSTGRESQL", "ODBC"].includes(value.sourceType)) {
    throw new VersionFoundationError("VERSION_FOUNDATION_INVALID_INPUT");
  }
  evidenceId(value.dataSourceId); expectedRowVersion(value.configurationVersion);
}
export const dataSourceVersionCatalogSql = `SELECT c.name AS columnName,c.system_type_id AS typeId,
 c.user_type_id AS userTypeId,c.max_length AS maxLength,c.is_nullable AS nullable,c.is_computed AS computed
 FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DataSource',N'U');`;
export function assertDataSourceVersionSchema(columns: Record<string, unknown>[]): void {
  const versions = columns.filter(c => c.typeId === 189);
  const c = versions[0];
  if (versions.length !== 1 || c?.columnName !== "ConfigurationRowVersion" || c.userTypeId !== 189
    || c.maxLength !== 8 || ![false, 0].includes(c.nullable as boolean) || ![false, 0].includes(c.computed as boolean)) {
    throw new VersionFoundationError("VERSION_FOUNDATION_SCHEMA_REQUIRED");
  }
}
export async function requireDataSourceVersionSchema(request: sql.Request): Promise<void> {
  try { assertDataSourceVersionSchema((await request.query(dataSourceVersionCatalogSql)).recordset); }
  catch { throw new VersionFoundationError("VERSION_FOUNDATION_SCHEMA_REQUIRED"); }
}

export function createDataSourceVersionRepository(deps: VersionRepositoryDependencies) {
  async function readDataSourceVersion(dataSourceId: string | bigint, expected?: DataSourceVersionEvidence,
    outer?: sql.Transaction): Promise<DataSourceVersionEvidence> {
    const id = evidenceId(dataSourceId);
    if (expected) validateSourceVersionExpectation(expected);
    return versionTransaction(deps, outer, async tx => {
      await requireDataSourceVersionSchema(deps.createRequest(tx));
      // Only readiness booleans leave SQL. Never select password ciphertext,
      // usernames or connection strings into the version evidence object.
      const result = await deps.createRequest(tx).input("id", sql.BigInt, id).query(`
        SELECT CONVERT(VARCHAR(20),Id) AS DataSourceId,Type,IsActive,ConfigurationRowVersion,
         CASE WHEN Type IN ('SQLSERVER','ORACLE','MYSQL','POSTGRESQL')
           AND LEN(LTRIM(RTRIM(Host)))>0 AND Port BETWEEN 1 AND 65535
           AND LEN(LTRIM(RTRIM(Username)))>0 AND DATALENGTH(EncryptedPassword)>0
           AND ((Type='ORACLE' AND LEN(LTRIM(RTRIM(OracleServiceName)))>0 AND OracleConnectionMode IN ('SERVICE_NAME','SID'))
             OR (Type IN ('SQLSERVER','MYSQL','POSTGRESQL') AND LEN(LTRIM(RTRIM(DatabaseName)))>0)) THEN 1
          WHEN Type='ODBC' AND ((OdbcConnectionMode='DSN' AND LEN(LTRIM(RTRIM(OdbcDsn)))>0)
            OR (OdbcConnectionMode='CONNECTION_STRING' AND DATALENGTH(EncryptedOdbcConnectionString)>0)) THEN 1
          ELSE 0 END AS SourceInformationValid
        FROM uqp.DataSource WITH (HOLDLOCK) WHERE Id=@id`);
      const row = result.recordset[0];
      if (result.recordset.length !== 1 || row.DataSourceId !== id || ![true, 1].includes(row.IsActive)
        || row.SourceInformationValid !== 1 || !["SQLSERVER", "ORACLE", "MYSQL", "POSTGRESQL", "ODBC"].includes(row.Type)) {
        throw new VersionFoundationError("VERSION_FOUNDATION_SOURCE_INVALID");
      }
      const value: DataSourceVersionEvidence = Object.freeze({ dataSourceId: id, sourceType: row.Type,
        configurationVersion: rowVersion(row.ConfigurationRowVersion), isActive: true });
      if (expected && (expected.dataSourceId !== id || expected.configurationVersion !== value.configurationVersion
        || expected.sourceType !== value.sourceType || expected.isActive !== true)) {
        throw new VersionFoundationError("VERSION_FOUNDATION_CONFLICT");
      }
      return value;
    });
  }
  return { readDataSourceVersion };
}
export const { readDataSourceVersion } = createDataSourceVersionRepository(versionRepositoryDependencies);
