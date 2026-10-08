import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type DatasetParameterRecord = {
  id: number;
  datasetId: number;
  name: string;
  label: string;
  dataType: "STRING" | "NUMBER" | "DATE" | "DATETIME" | "BOOLEAN";
  controlType: "TEXT" | "NUMBER" | "DATE" | "DATETIME" | "SELECT" | "MULTISELECT" | "CHECKBOX";
  isRequired: boolean;
  defaultValue: string | null;
  displayOrder: number;
  placeholder: string | null;
  helpText: string | null;
  optionMode: "NONE" | "FIXED" | "DATASET";
  fixedOptionsJson: string | null;
  lookupDatasetId: number | null;
  lookupValueField: string | null;
  lookupLabelField: string | null;
};

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

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

export async function listDatasetParameters(datasetId: number): Promise<DatasetParameterRecord[]> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("datasetId", sql.BigInt, datasetId)
    .query(`
      SELECT *
      FROM uqp.DatasetParameter
      WHERE DatasetId=@datasetId
      ORDER BY DisplayOrder, Id
    `);
  return result.recordset.map(mapParameter);
}

export async function syncDatasetParameters(datasetId: number, names: string[]): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const normalized = [...new Set(names)];
    const existing = await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id, Name FROM uqp.DatasetParameter WHERE DatasetId=@datasetId");

    const existingNames = new Set(existing.recordset.map((row) => String(row.Name)));

    for (let index = 0; index < normalized.length; index += 1) {
      const name = normalized[index]!;
      if (existingNames.has(name)) {
        await new sql.Request(tx)
          .input("datasetId", sql.BigInt, datasetId)
          .input("name", sql.NVarChar(100), name)
          .input("displayOrder", sql.Int, index)
          .query("UPDATE uqp.DatasetParameter SET DisplayOrder=@displayOrder WHERE DatasetId=@datasetId AND Name=@name");
        continue;
      }

      await new sql.Request(tx)
        .input("datasetId", sql.BigInt, datasetId)
        .input("name", sql.NVarChar(100), name)
        .input("label", sql.NVarChar(200), name)
        .input("displayOrder", sql.Int, index)
        .query(`
          INSERT INTO uqp.DatasetParameter (
            DatasetId, Name, Label, DataType, ControlType,
            IsRequired, DisplayOrder, OptionMode
          )
          VALUES (
            @datasetId, @name, @label, 'STRING', 'TEXT',
            0, @displayOrder, 'NONE'
          )
        `);
    }

    if (normalized.length === 0) {
      await new sql.Request(tx)
        .input("datasetId", sql.BigInt, datasetId)
        .query("DELETE FROM uqp.DatasetParameter WHERE DatasetId=@datasetId");
    } else {
      const request = new sql.Request(tx).input("datasetId", sql.BigInt, datasetId);
      const placeholders: string[] = [];
      normalized.forEach((name, index) => {
        const key = `name${index}`;
        request.input(key, sql.NVarChar(100), name);
        placeholders.push(`@${key}`);
      });
      await request.query(`
        DELETE FROM uqp.DatasetParameter
        WHERE DatasetId=@datasetId
          AND Name NOT IN (${placeholders.join(",")})
      `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function replaceDatasetParameters(
  datasetId: number,
  parameters: Omit<DatasetParameterRecord, "id" | "datasetId">[],
): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const dataset = await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id FROM uqp.Dataset WHERE Id=@datasetId");
    if (!dataset.recordset[0]) throw new Error("DATASET_NOT_FOUND");

    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query("DELETE FROM uqp.DatasetParameter WHERE DatasetId=@datasetId");

    for (const parameter of parameters) {
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
        UPDATE uqp.QueryDefinition
        SET IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE DatasetId=@datasetId AND IsPublished=1
      `);

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
