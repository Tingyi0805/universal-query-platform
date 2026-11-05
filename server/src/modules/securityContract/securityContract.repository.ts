import type sql from "mssql";
import { assertSecuritySchema, type SecuritySchemaEvidence } from "./securityContract.js";

// Catalog queries only. Never compile references to optional 919 application columns here.
export const securityCatalogSql = `
SELECT t.name AS tableName FROM sys.tables t WHERE t.schema_id=SCHEMA_ID(N'uqp');
SELECT t.name AS tableName,c.name AS columnName,c.system_type_id AS typeId,c.user_type_id AS userTypeId,
 c.max_length AS maxLength,c.is_nullable AS nullable,c.is_computed AS computed,d.definition AS defaultDefinition
 FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
 LEFT JOIN sys.default_constraints d ON d.object_id=c.default_object_id WHERE t.schema_id=SCHEMA_ID(N'uqp');
SELECT t.name AS tableName,c.name,c.definition,c.is_disabled AS disabled,c.is_not_trusted AS untrusted,c.is_not_for_replication AS nfr
 FROM sys.check_constraints c JOIN sys.tables t ON t.object_id=c.parent_object_id WHERE t.schema_id=SCHEMA_ID(N'uqp');
SELECT t.name AS tableName,k.name,c.name AS columnName,i.key_ordinal AS ordinal,x.is_disabled AS disabled,
 (SELECT COUNT(*) FROM sys.index_columns z WHERE z.object_id=k.parent_object_id AND z.index_id=k.unique_index_id AND z.key_ordinal>0) AS keyCount
 FROM sys.key_constraints k JOIN sys.tables t ON t.object_id=k.parent_object_id
 JOIN sys.index_columns i ON i.object_id=k.parent_object_id AND i.index_id=k.unique_index_id
 JOIN sys.columns c ON c.object_id=i.object_id AND c.column_id=i.column_id
 JOIN sys.indexes x ON x.object_id=k.parent_object_id AND x.index_id=k.unique_index_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp') AND k.type='PK';
SELECT t.name AS tableName,f.name,pc.name AS columnName,rt.name AS referencedTable,rs.name AS referencedSchema,rc.name AS referencedColumn,
 f.is_disabled AS disabled,f.is_not_trusted AS untrusted,f.is_not_for_replication AS nfr,
 f.delete_referential_action AS deleteAction,f.update_referential_action AS updateAction,
 (SELECT COUNT(*) FROM sys.foreign_key_columns z WHERE z.constraint_object_id=f.object_id) AS keyCount
 FROM sys.foreign_keys f JOIN sys.tables t ON t.object_id=f.parent_object_id
 JOIN sys.foreign_key_columns m ON m.constraint_object_id=f.object_id
 JOIN sys.columns pc ON pc.object_id=m.parent_object_id AND pc.column_id=m.parent_column_id
 JOIN sys.tables rt ON rt.object_id=m.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
 JOIN sys.columns rc ON rc.object_id=m.referenced_object_id AND rc.column_id=m.referenced_column_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp');`;

type CatalogRow = Record<string, unknown>;
const normalize = (value: unknown) => typeof value === "string" ? value.toLowerCase().replace(/[\[\]()\s]/g, "") : "";
const off = (value: unknown) => value === false || value === 0;
export function catalogEvidence(sets: CatalogRow[][]): SecuritySchemaEvidence {
  const [tables = [], columns = [], checks = [], keys = [], fks = []] = sets;
  const col = (table: string, name: string, type: number, length?: number) => columns.some(c => c.tableName === table && c.columnName === name &&
    c.typeId === type && c.userTypeId === type && off(c.nullable) && off(c.computed) && (length === undefined || c.maxLength === length));
  const check = (table: string, name: string, definition: string) => checks.some(c => c.tableName === table && c.name === name &&
    off(c.disabled) && off(c.untrusted) && off(c.nfr) && normalize(c.definition) === definition);
  const datasetPk = (table: string) => keys.some(k => k.tableName === table && k.columnName === "DatasetId" && k.ordinal === 1 && k.keyCount === 1 && off(k.disabled));
  const datasetFk = (table: string) => fks.some(f => f.tableName === table && f.columnName === "DatasetId" && f.referencedSchema === "uqp" &&
    f.referencedTable === "Dataset" && f.referencedColumn === "Id" && f.keyCount === 1 && f.deleteAction === 1 && f.updateAction === 0 && off(f.disabled) && off(f.untrusted) && off(f.nfr));
  return {
    prerequisites: ["Dataset", "DatasetColumn", "DatasetSensitiveColumn", "DatasetSensitivePolicyVersion", "Dashboard", "DashboardDataSource", "AuditLog", "DatasetPatientAuditConfig", "DatasetPatientAuditMetadata"]
      .every(name => tables.some(t => t.tableName === name)) && col("Dataset", "Id", 127) && col("Dataset", "DataSourceId", 127) && col("Dataset", "SqlText", 231) &&
      col("DatasetPatientAuditConfig", "DatasetId", 127) && col("DatasetPatientAuditConfig", "IsEnabled", 104) && col("DatasetPatientAuditConfig", "PatientKeyColumn", 231, 256) && col("DatasetPatientAuditConfig", "UpdatedAtUtc", 42) &&
      datasetPk("DatasetPatientAuditConfig") && datasetFk("DatasetPatientAuditConfig") &&
      check("DatasetPatientAuditConfig", "CK_DatasetPatientAuditConfig_Key", "lenltrimrtrimpatientkeycolumn>0"),
    configurationVersion: col("DatasetPatientAuditConfig", "ConfigurationVersion", 127, 8),
    configurationDefault: columns.some(c => c.tableName === "DatasetPatientAuditConfig" && c.columnName === "ConfigurationVersion" && normalize(c.defaultDefinition) === "1"),
    configurationCheck: check("DatasetPatientAuditConfig", "CK_DatasetPatientAuditConfig_Version", "configurationversion>=1"),
    dashboardRowVersion: col("Dashboard", "ApprovalRowVersion", 189, 8) && columns.filter(c => c.tableName === "Dashboard" && c.typeId === 189).length === 1,
    sourceRowVersion: col("DashboardDataSource", "ApprovalRowVersion", 189, 8) && columns.filter(c => c.tableName === "DashboardDataSource" && c.typeId === 189).length === 1,
    metadataColumns: col("DatasetPatientAuditMetadata", "DatasetId", 127, 8) && col("DatasetPatientAuditMetadata", "DefinitionHash", 175, 64) &&
      col("DatasetPatientAuditMetadata", "ColumnsJson", 231, -1) && columns.filter(c => c.tableName === "DatasetPatientAuditMetadata").length === 3,
    metadataPrimaryKey: keys.some(k => k.tableName === "DatasetPatientAuditMetadata" && k.name === "PK_DatasetPatientAuditMetadata" && k.columnName === "DatasetId" && k.ordinal === 1 && k.keyCount === 1 && off(k.disabled)),
    metadataForeignKey: fks.some(f => f.tableName === "DatasetPatientAuditMetadata" && f.name === "FK_DatasetPatientAuditMetadata_Dataset" &&
      f.columnName === "DatasetId" && f.referencedSchema === "uqp" && f.referencedTable === "Dataset" && f.referencedColumn === "Id" && f.keyCount === 1 &&
      f.deleteAction === 1 && f.updateAction === 0 && off(f.disabled) && off(f.untrusted) && off(f.nfr)),
    metadataJsonCheck: check("DatasetPatientAuditMetadata", "CK_DatasetPatientAuditMetadata_Json", "isjsoncolumnsjson=1"),
    trustedConstraints: ![...checks, ...fks].some(c => ["DatasetPatientAuditConfig", "DatasetPatientAuditMetadata"].includes(String(c.tableName)) && (!off(c.disabled) || !off(c.untrusted))),
  };
}
export async function requireSecuritySchema(request: sql.Request): Promise<void> {
  const result = await request.query(securityCatalogSql);
  assertSecuritySchema(catalogEvidence(result.recordsets as unknown as CatalogRow[][]));
}
