import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type DashboardWidgetInput = {
  id?: number | null;
  widgetType: "TEXT" | "PARAMETER" | "FIELD" | "CLOCK" | "PAGE_INFO" | "COUNTDOWN" | "TABLE";
  title: string | null;
  sourceKey: string | null;
  staticText: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  alignment: "LEFT" | "CENTER" | "RIGHT";
  config: Record<string, unknown>;
  sortOrder: number;
};

export type DashboardProfileInput = {
  id?: number | null;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  isDefault: boolean;
  sortOrder: number;
  widgets: DashboardWidgetInput[];
};

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function parseConfig(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapWidget(row: any) {
  return {
    id: Number(row.Id),
    profileId: Number(row.ProfileId),
    widgetType: String(row.WidgetType),
    title: row.Title == null ? null : String(row.Title),
    sourceKey: row.SourceKey == null ? null : String(row.SourceKey),
    staticText: row.StaticText == null ? null : String(row.StaticText),
    x: Number(row.X),
    y: Number(row.Y),
    width: Number(row.Width),
    height: Number(row.Height),
    fontSize: Number(row.FontSize),
    alignment: String(row.Alignment),
    config: parseConfig(row.ConfigJson),
    sortOrder: Number(row.SortOrder),
  };
}

export async function getDashboardLayout(dashboardId: number) {
  const pool = await requirePool();

  const profileResult = await pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .query(`
      SELECT Id, DashboardId, Name, CanvasWidth, CanvasHeight, IsDefault, SortOrder
      FROM uqp.DashboardDisplayProfile
      WHERE DashboardId=@dashboardId
      ORDER BY IsDefault DESC, SortOrder, Id
    `);

  const profileIds = profileResult.recordset.map((row) => Number(row.Id));
  if (profileIds.length === 0) return { profiles: [] };

  const widgetsResult = await pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .query(`
      SELECT w.Id, w.ProfileId, w.WidgetType, w.Title, w.SourceKey, w.StaticText,
             w.X, w.Y, w.Width, w.Height, w.FontSize, w.Alignment,
             w.ConfigJson, w.SortOrder
      FROM uqp.DashboardWidget w
      INNER JOIN uqp.DashboardDisplayProfile p ON p.Id=w.ProfileId
      WHERE p.DashboardId=@dashboardId
      ORDER BY w.ProfileId, w.SortOrder, w.Id
    `);

  const widgetsByProfile = new Map<number, ReturnType<typeof mapWidget>[]>();
  for (const row of widgetsResult.recordset) {
    const profileId = Number(row.ProfileId);
    widgetsByProfile.set(profileId, [
      ...(widgetsByProfile.get(profileId) ?? []),
      mapWidget(row),
    ]);
  }

  return {
    profiles: profileResult.recordset.map((row) => ({
      id: Number(row.Id),
      dashboardId: Number(row.DashboardId),
      name: String(row.Name),
      canvasWidth: Number(row.CanvasWidth),
      canvasHeight: Number(row.CanvasHeight),
      isDefault: Boolean(row.IsDefault),
      sortOrder: Number(row.SortOrder),
      widgets: widgetsByProfile.get(Number(row.Id)) ?? [],
    })),
  };
}

export async function replaceDashboardLayout(
  dashboardId: number,
  profiles: DashboardProfileInput[],
): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const dashboard = await new sql.Request(tx)
      .input("dashboardId", sql.BigInt, dashboardId)
      .query("SELECT Id FROM uqp.Dashboard WITH (UPDLOCK, HOLDLOCK) WHERE Id=@dashboardId");
    if (!dashboard.recordset[0]) throw new Error("DASHBOARD_NOT_FOUND");

    await new sql.Request(tx)
      .input("dashboardId", sql.BigInt, dashboardId)
      .query(`
        DELETE w
        FROM uqp.DashboardWidget w
        INNER JOIN uqp.DashboardDisplayProfile p ON p.Id=w.ProfileId
        WHERE p.DashboardId=@dashboardId;

        DELETE FROM uqp.DashboardDisplayProfile
        WHERE DashboardId=@dashboardId;
      `);

    let defaultUsed = false;
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
      const profile = profiles[profileIndex];
      const isDefault = profile.isDefault && !defaultUsed;
      if (isDefault) defaultUsed = true;

      const profileResult = await new sql.Request(tx)
        .input("dashboardId", sql.BigInt, dashboardId)
        .input("name", sql.NVarChar(100), profile.name)
        .input("canvasWidth", sql.Int, profile.canvasWidth)
        .input("canvasHeight", sql.Int, profile.canvasHeight)
        .input("isDefault", sql.Bit, isDefault)
        .input("sortOrder", sql.Int, profile.sortOrder)
        .query(`
          INSERT INTO uqp.DashboardDisplayProfile (
            DashboardId, Name, CanvasWidth, CanvasHeight, IsDefault, SortOrder
          )
          OUTPUT INSERTED.Id
          VALUES (
            @dashboardId,@name,@canvasWidth,@canvasHeight,@isDefault,@sortOrder
          )
        `);

      const profileId = Number(profileResult.recordset[0].Id);

      for (const widget of profile.widgets) {
        await new sql.Request(tx)
          .input("profileId", sql.BigInt, profileId)
          .input("widgetType", sql.NVarChar(30), widget.widgetType)
          .input("title", sql.NVarChar(200), widget.title)
          .input("sourceKey", sql.NVarChar(256), widget.sourceKey)
          .input("staticText", sql.NVarChar(1000), widget.staticText)
          .input("x", sql.Int, widget.x)
          .input("y", sql.Int, widget.y)
          .input("width", sql.Int, widget.width)
          .input("height", sql.Int, widget.height)
          .input("fontSize", sql.Int, widget.fontSize)
          .input("alignment", sql.NVarChar(10), widget.alignment)
          .input("configJson", sql.NVarChar(sql.MAX), JSON.stringify(widget.config ?? {}))
          .input("sortOrder", sql.Int, widget.sortOrder)
          .query(`
            INSERT INTO uqp.DashboardWidget (
              ProfileId, WidgetType, Title, SourceKey, StaticText,
              X, Y, Width, Height, FontSize, Alignment, ConfigJson, SortOrder
            )
            VALUES (
              @profileId,@widgetType,@title,@sourceKey,@staticText,
              @x,@y,@width,@height,@fontSize,@alignment,@configJson,@sortOrder
            )
          `);
      }
    }

    if (profiles.length > 0 && !defaultUsed) {
      await new sql.Request(tx)
        .input("dashboardId", sql.BigInt, dashboardId)
        .query(`
          UPDATE uqp.DashboardDisplayProfile
          SET IsDefault=CASE WHEN Id=(
            SELECT TOP (1) Id
            FROM uqp.DashboardDisplayProfile
            WHERE DashboardId=@dashboardId
            ORDER BY SortOrder, Id
          ) THEN 1 ELSE 0 END
          WHERE DashboardId=@dashboardId
        `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
