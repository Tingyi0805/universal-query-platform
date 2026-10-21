import sql from "mssql";
import { parameterPreview, validateParameterSync } from "./parameterSync.js";
import { getPlatformDbPool } from "../../config/database.js";
import { snapshotDatasetVersion } from "../version/version.repository.js";

export type DatasetParameterRecord = {
  id: number;
  datasetId: number;
  name: string;
  label: string;
  dataType: "STRING" | "NUMBER" | "DATE" | "DATETIME" | "BOOLEAN";
  controlType: "TEXT" | "NUMBER" | "DATE" | "DATETIME" | "SELECT" | "MULTISELECT" | "CHECKBOX";
  isRequired: boolean;
  defaultValue: string | null;
  dateOutputMode: "NATIVE" | "STRING";
  dateCalendar: "GREGORIAN" | "ROC";
  dateFormat: string | null;
  displayOrder: number;
  placeholder: string | null;
  helpText: string | null;
  optionMode: "NONE" | "FIXED" | "DATASET";
  fixedOptionsJson: string | null;
  lookupDatasetId: number | null;
  lookupValueField: string | null;
  lookupLabelField: string | null;
};

function mapParameter(row: any): DatasetParameterRecord {
  return {
    id: Number(row.Id),
    datasetId: Number(row.DatasetId),
    name: String(row.Name),
    label: String(row.Label),
    dataType: row.DataType,
    controlType: row.ControlType,
    isRequired: Boolean(row.IsRequired),
    defaultValue: row.DefaultValue == null ? null : String(row.DefaultValue),
    dateOutputMode: String(row.DateOutputMode ?? "NATIVE") as "NATIVE" | "STRING",
    dateCalendar: String(row.DateCalendar ?? "GREGORIAN") as "GREGORIAN" | "ROC",
    dateFormat: row.DateFormat == null ? null : String(row.DateFormat),
    displayOrder: Number(row.DisplayOrder),
    placeholder: row.Placeholder == null ? null : String(row.Placeholder),
    helpText: row.HelpText == null ? null : String(row.HelpText),
    optionMode: row.OptionMode,
    fixedOptionsJson: row.FixedOptionsJson == null ? null : String(row.FixedOptionsJson),
    lookupDatasetId: row.LookupDatasetId == null ? null : Number(row.LookupDatasetId),
    lookupValueField: row.LookupValueField == null ? null : String(row.LookupValueField),
    lookupLabelField: row.LookupLabelField == null ? null : String(row.LookupLabelField),
  };
}

export type ParameterRepositoryDependencies = {
  getPool: typeof getPlatformDbPool;
  createTransaction: (pool: sql.ConnectionPool) => sql.Transaction;
  createRequest: (tx: sql.Transaction) => sql.Request;
  snapshotVersion: typeof snapshotDatasetVersion;
};
export function createParameterRepository(deps: ParameterRepositoryDependencies) {
  async function requirePool() {
    const pool = await deps.getPool();
    if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
    return pool;
  }

  async function listDatasetParameters(datasetId: number, transaction?: sql.Transaction): Promise<DatasetParameterRecord[]> {
    const request = transaction ? deps.createRequest(transaction) : (await requirePool()).request();
    const result = await request
      .input("datasetId", sql.BigInt, datasetId)
      .query(`
        SELECT *
        FROM uqp.DatasetParameter
        WHERE DatasetId=@datasetId
        ORDER BY DisplayOrder, Id
      `);
    return result.recordset.map(mapParameter);
  }

  async function syncDatasetParameters(
    datasetId: number, previewToken: string, removeNames: string[] = [], userId?: number,
  ): Promise<void> {
    const pool = await requirePool();
    const tx = deps.createTransaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const dataset = await deps.createRequest(tx).input("datasetId", sql.BigInt, datasetId)
        .query("SELECT SqlText, IsArchived FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId");
      if (!dataset.recordset[0]) throw new Error("DATASET_NOT_FOUND");
      if (dataset.recordset[0].IsArchived) throw new Error("DATASET_ARCHIVED");
      const existing = await deps.createRequest(tx).input("datasetId", sql.BigInt, datasetId)
        .query("SELECT * FROM uqp.DatasetParameter WITH (UPDLOCK, HOLDLOCK) WHERE DatasetId=@datasetId ORDER BY DisplayOrder, Id");
      const parameters = existing.recordset.map(mapParameter);
      const preview = parameterPreview(datasetId, String(dataset.recordset[0].SqlText), parameters);
      validateParameterSync(preview, previewToken, removeNames);
      const nextOrder = parameters.reduce((max, p) => Math.max(max, p.displayOrder), -1) + 1;
      if (preview.added.length && nextOrder + preview.added.length - 1 > 10000) throw new Error("PARAMETER_SYNC_LIMIT");
      if (userId && (preview.added.length || removeNames.length)) {
        await deps.snapshotVersion(tx, datasetId, userId, "PARAMETER_UPDATE");
      }
      for (const [index, name] of preview.added.entries()) {
        await deps.createRequest(tx).input("datasetId", sql.BigInt, datasetId)
          .input("name", sql.NVarChar(100), name).input("displayOrder", sql.Int, nextOrder + index)
          .query(`INSERT INTO uqp.DatasetParameter
            (DatasetId, Name, Label, DataType, ControlType, IsRequired, DisplayOrder, OptionMode)
            VALUES (@datasetId, @name, @name, 'STRING', 'TEXT', 0, @displayOrder, 'NONE')`);
      }
      for (const name of removeNames) {
        await deps.createRequest(tx).input("datasetId", sql.BigInt, datasetId).input("name", sql.NVarChar(100), name)
          .query("DELETE FROM uqp.DatasetParameter WHERE DatasetId=@datasetId AND Name=@name");
      }
      if (preview.added.length || removeNames.length) {
        await touchDatasetDefinition(tx, datasetId);
        await unpublishParameterQueries(tx, datasetId);
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  async function unpublishParameterQueries(tx: sql.Transaction, datasetId: number) {
    await deps.createRequest(tx).input("datasetId", sql.BigInt, datasetId).query(`
      UPDATE uqp.QueryDefinition SET IsPublished=0, PublishedAtUtc=NULL,
        PublishedByUserId=NULL, UpdatedAtUtc=SYSUTCDATETIME()
      WHERE DatasetId=@datasetId AND IsPublished=1`);
  }

  async function touchDatasetDefinition(tx: sql.Transaction, datasetId: number) {
    // A self-assignment leaves user-visible data unchanged while advancing the
    // SQL Server ROWVERSION added by migration 920. It remains harmless on a
    // pre-920 schema and participates in the surrounding transaction.
    await deps.createRequest(tx).input("datasetId", sql.BigInt, datasetId)
      .query("UPDATE uqp.Dataset SET UpdatedAtUtc=UpdatedAtUtc WHERE Id=@datasetId");
  }

  async function saveDatasetParameters(
    datasetId: number,
    parameters: Omit<DatasetParameterRecord, "id" | "datasetId">[],
    userId: number,
    previewToken: string,
  ): Promise<void> {
    const pool = await requirePool();
    const tx = deps.createTransaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const dataset = await deps.createRequest(tx)
        .input("datasetId", sql.BigInt, datasetId)
        .query("SELECT Id, SqlText, IsArchived FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId");
      if (!dataset.recordset[0]) throw new Error("DATASET_NOT_FOUND");
      if (dataset.recordset[0].IsArchived) throw new Error("DATASET_ARCHIVED");
      const saved = await deps.createRequest(tx).input("datasetId", sql.BigInt, datasetId)
        .query("SELECT * FROM uqp.DatasetParameter WITH (UPDLOCK, HOLDLOCK) WHERE DatasetId=@datasetId ORDER BY DisplayOrder, Id");
      const current = saved.recordset.map(mapParameter);
      const preview = parameterPreview(datasetId, String(dataset.recordset[0].SqlText), current);
      if (preview.previewToken !== previewToken) throw new Error("PARAMETER_PREVIEW_STALE");
      const names = parameters.map(p => p.name);
      if (new Set(names).size !== names.length || names.length !== current.length ||
        current.some(p => !names.includes(p.name))) throw new Error("PARAMETER_DEFINITION_MISMATCH");

      if (userId) {
        await deps.snapshotVersion(tx, datasetId, userId, "PARAMETER_UPDATE");
      }

      const lookupDatasetIds = [...new Set(
        parameters
          .filter((parameter) => parameter.optionMode === "DATASET" && parameter.lookupDatasetId)
          .map((parameter) => parameter.lookupDatasetId as number),
      )];

      for (const lookupDatasetId of lookupDatasetIds) {
        const lookup = await deps.createRequest(tx)
          .input("lookupDatasetId", sql.BigInt, lookupDatasetId)
          .query("SELECT Id, IsArchived FROM uqp.Dataset WHERE Id=@lookupDatasetId");
        if (!lookup.recordset[0] || lookup.recordset[0].IsArchived) {
          throw new Error("PARAMETER_LOOKUP_DATASET_ARCHIVED");
        }
      }

      for (const parameter of parameters) {
        await deps.createRequest(tx)
          .input("datasetId", sql.BigInt, datasetId)
          .input("name", sql.NVarChar(100), parameter.name)
          .input("label", sql.NVarChar(200), parameter.label)
          .input("dataType", sql.NVarChar(20), parameter.dataType)
          .input("controlType", sql.NVarChar(30), parameter.controlType)
          .input("isRequired", sql.Bit, parameter.isRequired)
          .input("defaultValue", sql.NVarChar(1000), parameter.defaultValue)
          .input("dateOutputMode", sql.NVarChar(20), parameter.dateOutputMode)
          .input("dateCalendar", sql.NVarChar(20), parameter.dateCalendar)
          .input("dateFormat", sql.NVarChar(100), parameter.dateFormat)
          .input("displayOrder", sql.Int, parameter.displayOrder)
          .input("placeholder", sql.NVarChar(200), parameter.placeholder)
          .input("helpText", sql.NVarChar(500), parameter.helpText)
          .input("optionMode", sql.NVarChar(20), parameter.optionMode)
          .input("fixedOptionsJson", sql.NVarChar(sql.MAX), parameter.fixedOptionsJson)
          .input("lookupDatasetId", sql.BigInt, parameter.lookupDatasetId)
          .input("lookupValueField", sql.NVarChar(128), parameter.lookupValueField)
          .input("lookupLabelField", sql.NVarChar(128), parameter.lookupLabelField)
          .query(`
            UPDATE uqp.DatasetParameter SET
              Label=@label, DataType=@dataType, ControlType=@controlType, IsRequired=@isRequired,
              DefaultValue=@defaultValue, DateOutputMode=@dateOutputMode, DateCalendar=@dateCalendar,
              DateFormat=@dateFormat, DisplayOrder=@displayOrder, Placeholder=@placeholder,
              HelpText=@helpText, OptionMode=@optionMode, FixedOptionsJson=@fixedOptionsJson,
              LookupDatasetId=@lookupDatasetId, LookupValueField=@lookupValueField, LookupLabelField=@lookupLabelField
            WHERE DatasetId=@datasetId AND Name=@name
          `);
      }

      await touchDatasetDefinition(tx, datasetId);
      await unpublishParameterQueries(tx, datasetId);

      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  return { listDatasetParameters, syncDatasetParameters, saveDatasetParameters };
}
const repository = createParameterRepository({ getPool: getPlatformDbPool,
  createTransaction: pool => new sql.Transaction(pool), createRequest: tx => new sql.Request(tx),
  snapshotVersion: snapshotDatasetVersion });
export const { listDatasetParameters, syncDatasetParameters, saveDatasetParameters } = repository;
