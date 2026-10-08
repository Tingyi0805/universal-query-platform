import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type BrandingSettings = {
  organizationName: string;
  platformName: string;
  platformTitle: string;
  platformSubtitle: string;
};

const defaults: BrandingSettings = {
  organizationName: "",
  platformName: "Universal Query Platform",
  platformTitle: "通用資料查詢與報表平台",
  platformSubtitle: "低程式碼建立查詢、報表與使用者可操作的功能入口。",
};

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function keyToProperty(key: string): keyof BrandingSettings | null {
  switch (key) {
    case "ORGANIZATION_NAME": return "organizationName";
    case "PLATFORM_NAME": return "platformName";
    case "PLATFORM_TITLE": return "platformTitle";
    case "PLATFORM_SUBTITLE": return "platformSubtitle";
    default: return null;
  }
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT SettingKey, SettingValue
    FROM uqp.SystemSetting
    WHERE SettingKey IN (
      'ORGANIZATION_NAME',
      'PLATFORM_NAME',
      'PLATFORM_TITLE',
      'PLATFORM_SUBTITLE'
    )
  `);

  const settings = { ...defaults };
  for (const row of result.recordset) {
    const property = keyToProperty(String(row.SettingKey));
    if (property) settings[property] = String(row.SettingValue ?? "");
  }
  return settings;
}

export async function updateBrandingSettings(input: BrandingSettings): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const values: [string, string][] = [
      ["ORGANIZATION_NAME", input.organizationName],
      ["PLATFORM_NAME", input.platformName],
      ["PLATFORM_TITLE", input.platformTitle],
      ["PLATFORM_SUBTITLE", input.platformSubtitle],
    ];

    for (const [key, value] of values) {
      await new sql.Request(tx)
        .input("key", sql.NVarChar(100), key)
        .input("value", sql.NVarChar(1000), value)
        .query(`
          UPDATE uqp.SystemSetting
          SET SettingValue=@value, UpdatedAtUtc=SYSUTCDATETIME()
          WHERE SettingKey=@key
        `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}


export type VersionRetentionSettings = {
  retentionCount: number;
  retentionDays: number;
};

export async function getVersionRetentionSettings(): Promise<VersionRetentionSettings> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT SettingKey, SettingValue
    FROM uqp.SystemSetting
    WHERE SettingKey IN ('VERSION_RETENTION_COUNT','VERSION_RETENTION_DAYS')
  `);

  let retentionCount = 30;
  let retentionDays = 365;

  for (const row of result.recordset) {
    const value = Number(row.SettingValue);
    if (row.SettingKey === "VERSION_RETENTION_COUNT" && Number.isInteger(value) && value >= 1) {
      retentionCount = value;
    }
    if (row.SettingKey === "VERSION_RETENTION_DAYS" && Number.isInteger(value) && value >= 1) {
      retentionDays = value;
    }
  }

  return { retentionCount, retentionDays };
}

export async function updateVersionRetentionSettings(
  input: VersionRetentionSettings,
): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const values: [string, string][] = [
      ["VERSION_RETENTION_COUNT", String(input.retentionCount)],
      ["VERSION_RETENTION_DAYS", String(input.retentionDays)],
    ];

    for (const [key, value] of values) {
      await new sql.Request(tx)
        .input("key", sql.NVarChar(100), key)
        .input("value", sql.NVarChar(1000), value)
        .query(`
          UPDATE uqp.SystemSetting
          SET SettingValue=@value, UpdatedAtUtc=SYSUTCDATETIME()
          WHERE SettingKey=@key
        `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
