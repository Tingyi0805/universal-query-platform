import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

type DatasetSnapshot = {
  dataset: {
    name: string;
    description: string | null;
    dataSourceId: number;
    sqlText: string;
    maxRows: number;
    queryTimeoutSec: number | null;
    isActive: boolean;
  };
  parameters: Array<{
    name: string;
    label: string;
    dataType: string;
    controlType: string;
    isRequired: boolean;
    defaultValue: string | null;
    displayOrder: number;
    placeholder: string | null;
    helpText: string | null;
    optionMode: string;
    fixedOptionsJson: string | null;
    lookupDatasetId: number | null;
    lookupValueField: string | null;
    lookupLabelField: string | null;
  }>;
};

type QuerySnapshot = {
  query: {
    name: string;
    description: string | null;
    categoryId: number | null;
    icon: string;
    datasetId: number;
    sortOrder: number;
    allowExcelExport: boolean;
    isActive: boolean;
  };
  reportColumns: Array<{
    columnName: string;
    displayLabel: string;
    displayOrder: number;
    isVisible: boolean;
    width: number | null;
    displayFormat: string | null;
    alignment: string;
    groupOrder: number | null;
    aggregateType: string;
  }>;
};

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

async function nextDatasetVersionNo(parent: sql.Transaction, datasetId: number): Promise<number> {
  const result = await new sql.Request(parent)
    .input("datasetId", sql.BigInt, datasetId)
    .query(`
      SELECT ISNULL(MAX(VersionNo), 0) + 1 AS NextVersionNo
      FROM uqp.DatasetVersion WITH (UPDLOCK, HOLDLOCK)
      WHERE DatasetId=@datasetId
    `);
  return Number(result.recordset[0]?.NextVersionNo ?? 1);
}

async function nextQueryVersionNo(parent: sql.Transaction, queryId: number): Promise<number> {
  const result = await new sql.Request(parent)
    .input("queryId", sql.BigInt, queryId)
    .query(`
      SELECT ISNULL(MAX(VersionNo), 0) + 1 AS NextVersionNo
      FROM uqp.QueryDefinitionVersion WITH (UPDLOCK, HOLDLOCK)
      WHERE QueryDefinitionId=@queryId
    `);
  return Number(result.recordset[0]?.NextVersionNo ?? 1);
}

export async function snapshotDatasetVersion(
  parent: sql.Transaction,
  datasetId: number,
  userId: number | null,
  reason: string,
): Promise<number> {
  const datasetResult = await new sql.Request(parent)
    .input("datasetId", sql.BigInt, datasetId)
    .query(`
      SELECT Name, Description, DataSourceId, SqlText, MaxRows, QueryTimeoutSec, IsActive
      FROM uqp.Dataset
      WHERE Id=@datasetId
    `);

  const row = datasetResult.recordset[0];
  if (!row) throw new Error("DATASET_NOT_FOUND");

  const parameterResult = await new sql.Request(parent)
    .input("datasetId", sql.BigInt, datasetId)
    .query(`
      SELECT Name, Label, DataType, ControlType, IsRequired, DefaultValue,
             DisplayOrder, Placeholder, HelpText, OptionMode, FixedOptionsJson,
             LookupDatasetId, LookupValueField, LookupLabelField
      FROM uqp.DatasetParameter
      WHERE DatasetId=@datasetId
      ORDER BY DisplayOrder, Id
    `);

  const snapshot: DatasetSnapshot = {
    dataset: {
      name: String(row.Name),
      description: row.Description == null ? null : String(row.Description),
      dataSourceId: Number(row.DataSourceId),
      sqlText: String(row.SqlText),
      maxRows: Number(row.MaxRows),
      queryTimeoutSec: row.QueryTimeoutSec == null ? null : Number(row.QueryTimeoutSec),
      isActive: Boolean(row.IsActive),
    },
    parameters: parameterResult.recordset.map((parameter) => ({
      name: String(parameter.Name),
      label: String(parameter.Label),
      dataType: String(parameter.DataType),
      controlType: String(parameter.ControlType),
      isRequired: Boolean(parameter.IsRequired),
      defaultValue: parameter.DefaultValue == null ? null : String(parameter.DefaultValue),
      displayOrder: Number(parameter.DisplayOrder),
      placeholder: parameter.Placeholder == null ? null : String(parameter.Placeholder),
      helpText: parameter.HelpText == null ? null : String(parameter.HelpText),
      optionMode: String(parameter.OptionMode),
      fixedOptionsJson: parameter.FixedOptionsJson == null ? null : String(parameter.FixedOptionsJson),
      lookupDatasetId: parameter.LookupDatasetId == null ? null : Number(parameter.LookupDatasetId),
      lookupValueField: parameter.LookupValueField == null ? null : String(parameter.LookupValueField),
      lookupLabelField: parameter.LookupLabelField == null ? null : String(parameter.LookupLabelField),
    })),
  };

  const versionNo = await nextDatasetVersionNo(parent, datasetId);
  await new sql.Request(parent)
    .input("datasetId", sql.BigInt, datasetId)
    .input("versionNo", sql.Int, versionNo)
    .input("snapshotJson", sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
    .input("reason", sql.NVarChar(100), reason)
    .input("userId", sql.BigInt, userId)
    .query(`
      INSERT INTO uqp.DatasetVersion (
        DatasetId, VersionNo, SnapshotJson, Reason, CreatedByUserId
      )
      VALUES (@datasetId, @versionNo, @snapshotJson, @reason, @userId)
    `);

  return versionNo;
}

export async function snapshotQueryVersion(
  parent: sql.Transaction,
  queryId: number,
  userId: number | null,
  reason: string,
): Promise<number> {
  const queryResult = await new sql.Request(parent)
    .input("queryId", sql.BigInt, queryId)
    .query(`
      SELECT Name, Description, CategoryId, Icon, DatasetId,
             SortOrder, AllowExcelExport, IsActive
      FROM uqp.QueryDefinition
      WHERE Id=@queryId
    `);

  const row = queryResult.recordset[0];
  if (!row) throw new Error("QUERY_DEFINITION_NOT_FOUND");

  const columnsResult = await new sql.Request(parent)
    .input("queryId", sql.BigInt, queryId)
    .query(`
      SELECT ColumnName, DisplayLabel, DisplayOrder, IsVisible, Width,
             DisplayFormat, Alignment, GroupOrder, AggregateType
      FROM uqp.ReportColumn
      WHERE QueryDefinitionId=@queryId
      ORDER BY DisplayOrder, ColumnName
    `);

  const snapshot: QuerySnapshot = {
    query: {
      name: String(row.Name),
      description: row.Description == null ? null : String(row.Description),
      categoryId: row.CategoryId == null ? null : Number(row.CategoryId),
      icon: String(row.Icon),
      datasetId: Number(row.DatasetId),
      sortOrder: Number(row.SortOrder),
      allowExcelExport: Boolean(row.AllowExcelExport),
      isActive: Boolean(row.IsActive),
    },
    reportColumns: columnsResult.recordset.map((column) => ({
      columnName: String(column.ColumnName),
      displayLabel: String(column.DisplayLabel),
      displayOrder: Number(column.DisplayOrder),
      isVisible: Boolean(column.IsVisible),
      width: column.Width == null ? null : Number(column.Width),
      displayFormat: column.DisplayFormat == null ? null : String(column.DisplayFormat),
      alignment: String(column.Alignment),
      groupOrder: column.GroupOrder == null ? null : Number(column.GroupOrder),
      aggregateType: String(column.AggregateType),
    })),
  };

  const versionNo = await nextQueryVersionNo(parent, queryId);
  await new sql.Request(parent)
    .input("queryId", sql.BigInt, queryId)
    .input("versionNo", sql.Int, versionNo)
    .input("snapshotJson", sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
    .input("reason", sql.NVarChar(100), reason)
    .input("userId", sql.BigInt, userId)
    .query(`
      INSERT INTO uqp.QueryDefinitionVersion (
        QueryDefinitionId, VersionNo, SnapshotJson, Reason, CreatedByUserId
      )
      VALUES (@queryId, @versionNo, @snapshotJson, @reason, @userId)
    `);

  return versionNo;
}

export async function listDatasetVersions(datasetId: number) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("datasetId", sql.BigInt, datasetId)
    .query(`
      SELECT v.Id, v.VersionNo, v.Reason, v.CreatedAtUtc, v.CreatedByUserId,
             u.Username AS CreatedByUsername, u.DisplayName AS CreatedByDisplayName
      FROM uqp.DatasetVersion v
      LEFT JOIN uqp.AppUser u ON u.Id=v.CreatedByUserId
      WHERE v.DatasetId=@datasetId
      ORDER BY v.VersionNo DESC
    `);

  return result.recordset.map((row) => ({
    id: Number(row.Id),
    versionNo: Number(row.VersionNo),
    reason: row.Reason == null ? null : String(row.Reason),
    createdAtUtc: new Date(row.CreatedAtUtc).toISOString(),
    createdByUserId: row.CreatedByUserId == null ? null : Number(row.CreatedByUserId),
    createdByUsername: row.CreatedByUsername == null ? null : String(row.CreatedByUsername),
    createdByDisplayName: row.CreatedByDisplayName == null ? null : String(row.CreatedByDisplayName),
  }));
}

export async function listQueryVersions(queryId: number) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("queryId", sql.BigInt, queryId)
    .query(`
      SELECT v.Id, v.VersionNo, v.Reason, v.CreatedAtUtc, v.CreatedByUserId,
             u.Username AS CreatedByUsername, u.DisplayName AS CreatedByDisplayName
      FROM uqp.QueryDefinitionVersion v
      LEFT JOIN uqp.AppUser u ON u.Id=v.CreatedByUserId
      WHERE v.QueryDefinitionId=@queryId
      ORDER BY v.VersionNo DESC
    `);

  return result.recordset.map((row) => ({
    id: Number(row.Id),
    versionNo: Number(row.VersionNo),
    reason: row.Reason == null ? null : String(row.Reason),
    createdAtUtc: new Date(row.CreatedAtUtc).toISOString(),
    createdByUserId: row.CreatedByUserId == null ? null : Number(row.CreatedByUserId),
    createdByUsername: row.CreatedByUsername == null ? null : String(row.CreatedByUsername),
    createdByDisplayName: row.CreatedByDisplayName == null ? null : String(row.CreatedByDisplayName),
  }));
}

export async function restoreDatasetVersion(
  datasetId: number,
  versionNo: number,
  userId: number,
): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const current = await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id, IsArchived FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId");
    if (!current.recordset[0]) throw new Error("DATASET_NOT_FOUND");
    if (current.recordset[0].IsArchived) throw new Error("DATASET_ARCHIVED");

    const versionResult = await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .input("versionNo", sql.Int, versionNo)
      .query("SELECT SnapshotJson FROM uqp.DatasetVersion WHERE DatasetId=@datasetId AND VersionNo=@versionNo");
    if (!versionResult.recordset[0]) throw new Error("DATASET_VERSION_NOT_FOUND");

    const snapshot = JSON.parse(String(versionResult.recordset[0].SnapshotJson)) as DatasetSnapshot;

    const source = await new sql.Request(tx)
      .input("dataSourceId", sql.BigInt, snapshot.dataset.dataSourceId)
      .query("SELECT Id FROM uqp.DataSource WHERE Id=@dataSourceId");
    if (!source.recordset[0]) throw new Error("DATASOURCE_NOT_FOUND");

    for (const parameter of snapshot.parameters) {
      if (parameter.optionMode !== "DATASET" || !parameter.lookupDatasetId) continue;
      const lookup = await new sql.Request(tx)
        .input("lookupDatasetId", sql.BigInt, parameter.lookupDatasetId)
        .query("SELECT Id, IsArchived FROM uqp.Dataset WHERE Id=@lookupDatasetId");
      if (!lookup.recordset[0] || lookup.recordset[0].IsArchived) {
        throw new Error("PARAMETER_LOOKUP_DATASET_ARCHIVED");
      }
    }

    await snapshotDatasetVersion(tx, datasetId, userId, `RESTORE_FROM_V${versionNo}`);

    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .input("name", sql.NVarChar(200), snapshot.dataset.name)
      .input("description", sql.NVarChar(1000), snapshot.dataset.description)
      .input("dataSourceId", sql.BigInt, snapshot.dataset.dataSourceId)
      .input("sqlText", sql.NVarChar(sql.MAX), snapshot.dataset.sqlText)
      .input("maxRows", sql.Int, snapshot.dataset.maxRows)
      .input("queryTimeoutSec", sql.Int, snapshot.dataset.queryTimeoutSec)
      .query(`
        UPDATE uqp.Dataset
        SET Name=@name,
            Description=@description,
            DataSourceId=@dataSourceId,
            SqlText=@sqlText,
            MaxRows=@maxRows,
            QueryTimeoutSec=@queryTimeoutSec,
            IsActive=0,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE Id=@datasetId
      `);

    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query("DELETE FROM uqp.DatasetParameter WHERE DatasetId=@datasetId");

    for (const parameter of snapshot.parameters) {
      await new sql.Request(tx)
        .input("datasetId", sql.BigInt, datasetId)
        .input("name", sql.NVarChar(100), parameter.name)
        .input("label", sql.NVarChar(200), parameter.label)
        .input("dataType", sql.NVarChar(20), parameter.dataType)
        .input("controlType", sql.NVarChar(30), parameter.controlType)
        .input("isRequired", sql.Bit, parameter.isRequired)
        .input("defaultValue", sql.NVarChar(1000), parameter.defaultValue)
        .input("displayOrder", sql.Int, parameter.displayOrder)
        .input("placeholder", sql.NVarChar(200), parameter.placeholder)
        .input("helpText", sql.NVarChar(500), parameter.helpText)
        .input("optionMode", sql.NVarChar(20), parameter.optionMode)
        .input("fixedOptionsJson", sql.NVarChar(sql.MAX), parameter.fixedOptionsJson)
        .input("lookupDatasetId", sql.BigInt, parameter.lookupDatasetId)
        .input("lookupValueField", sql.NVarChar(128), parameter.lookupValueField)
        .input("lookupLabelField", sql.NVarChar(128), parameter.lookupLabelField)
        .query(`
          INSERT INTO uqp.DatasetParameter (
            DatasetId, Name, Label, DataType, ControlType, IsRequired,
            DefaultValue, DisplayOrder, Placeholder, HelpText, OptionMode,
            FixedOptionsJson, LookupDatasetId, LookupValueField, LookupLabelField
          )
          VALUES (
            @datasetId,@name,@label,@dataType,@controlType,@isRequired,
            @defaultValue,@displayOrder,@placeholder,@helpText,@optionMode,
            @fixedOptionsJson,@lookupDatasetId,@lookupValueField,@lookupLabelField
          )
        `);
    }

    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query(`
        UPDATE q
        SET IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        FROM uqp.QueryDefinition q
        WHERE q.DatasetId=@datasetId
      `);

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function restoreQueryVersion(
  queryId: number,
  versionNo: number,
  userId: number,
): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const current = await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .query("SELECT Id, IsArchived FROM uqp.QueryDefinition WITH (UPDLOCK, HOLDLOCK) WHERE Id=@queryId");
    if (!current.recordset[0]) throw new Error("QUERY_DEFINITION_NOT_FOUND");
    if (current.recordset[0].IsArchived) throw new Error("QUERY_ARCHIVED");

    const versionResult = await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .input("versionNo", sql.Int, versionNo)
      .query("SELECT SnapshotJson FROM uqp.QueryDefinitionVersion WHERE QueryDefinitionId=@queryId AND VersionNo=@versionNo");
    if (!versionResult.recordset[0]) throw new Error("QUERY_VERSION_NOT_FOUND");

    const snapshot = JSON.parse(String(versionResult.recordset[0].SnapshotJson)) as QuerySnapshot;

    const dataset = await new sql.Request(tx)
      .input("datasetId", sql.BigInt, snapshot.query.datasetId)
      .query("SELECT Id, IsArchived FROM uqp.Dataset WHERE Id=@datasetId");
    if (!dataset.recordset[0] || dataset.recordset[0].IsArchived) {
      throw new Error("DATASET_ARCHIVED_OR_NOT_FOUND");
    }

    await snapshotQueryVersion(tx, queryId, userId, `RESTORE_FROM_V${versionNo}`);

    await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .input("name", sql.NVarChar(200), snapshot.query.name)
      .input("description", sql.NVarChar(1000), snapshot.query.description)
      .input("categoryId", sql.BigInt, snapshot.query.categoryId)
      .input("icon", sql.NVarChar(100), snapshot.query.icon)
      .input("datasetId", sql.BigInt, snapshot.query.datasetId)
      .input("sortOrder", sql.Int, snapshot.query.sortOrder)
      .input("allowExcelExport", sql.Bit, snapshot.query.allowExcelExport)
      .query(`
        UPDATE uqp.QueryDefinition
        SET Name=@name,
            Description=@description,
            CategoryId=@categoryId,
            Icon=@icon,
            DatasetId=@datasetId,
            SortOrder=@sortOrder,
            AllowExcelExport=@allowExcelExport,
            IsActive=0,
            IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE Id=@queryId
      `);

    await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .query("DELETE FROM uqp.ReportColumn WHERE QueryDefinitionId=@queryId");

    for (const column of snapshot.reportColumns) {
      await new sql.Request(tx)
        .input("queryId", sql.BigInt, queryId)
        .input("columnName", sql.NVarChar(256), column.columnName)
        .input("displayLabel", sql.NVarChar(256), column.displayLabel)
        .input("displayOrder", sql.Int, column.displayOrder)
        .input("isVisible", sql.Bit, column.isVisible)
        .input("width", sql.Int, column.width)
        .input("displayFormat", sql.NVarChar(100), column.displayFormat)
        .input("alignment", sql.NVarChar(10), column.alignment)
        .input("groupOrder", sql.Int, column.groupOrder)
        .input("aggregateType", sql.NVarChar(10), column.aggregateType)
        .query(`
          INSERT INTO uqp.ReportColumn (
            QueryDefinitionId, ColumnName, DisplayLabel, DisplayOrder,
            IsVisible, Width, DisplayFormat, Alignment, GroupOrder, AggregateType
          )
          VALUES (
            @queryId,@columnName,@displayLabel,@displayOrder,
            @isVisible,@width,@displayFormat,@alignment,@groupOrder,@aggregateType
          )
        `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
