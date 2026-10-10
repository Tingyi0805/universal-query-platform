import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DashboardDisplayPage.css";

type DashboardRow = {
  id: number;
  code: string;
  name: string;
  refreshSeconds: number;
  pageSize: number;
  pageSeconds: number;
  parameters: Record<string, unknown>;
};

type ReportColumn = {
  columnName: string;
  displayLabel: string;
  displayOrder: number;
  isVisible: boolean;
  alignment: "LEFT" | "CENTER" | "RIGHT";
};

type PreviewResult = {
  dashboard: DashboardRow;
  reportColumns: ReportColumn[];
  result: {
    columns: { name: string }[];
    rows: Record<string, unknown>[];
  };
};

type LayoutWidget = {
  id: number;
  profileId: number;
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

type LayoutProfile = {
  id: number;
  dashboardId: number;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  isDefault: boolean;
  sortOrder: number;
  widgets: LayoutWidget[];
};

type MaskMode = "NONE" | "NAME" | "MRN" | "PHONE" | "GENERIC";

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function maskText(value: unknown, mode: unknown): string {
  const text = textValue(value);
  const maskMode = String(mode ?? "NONE") as MaskMode;
  if (!text || maskMode === "NONE") return text;

  if (maskMode === "NAME") {
    const chars = Array.from(text);
    if (chars.length <= 1) return "○";
    if (chars.length === 2) return `${chars[0]}○`;
    return `${chars[0]}${"○".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
  }

  if (maskMode === "MRN") {
    if (text.length <= 4) return "○".repeat(text.length);
    const head = text.slice(0, Math.min(4, text.length - 2));
    const tail = text.slice(-2);
    return `${head}${"○".repeat(Math.max(1, text.length - head.length - tail.length))}${tail}`;
  }

  if (maskMode === "PHONE") {
    if (text.length <= 5) return "○".repeat(text.length);
    return `${text.slice(0, 4)}${"○".repeat(Math.max(1, text.length - 7))}${text.slice(-3)}`;
  }

  if (text.length <= 2) return "○".repeat(text.length);
  return `${text.slice(0, 1)}${"○".repeat(text.length - 2)}${text.slice(-1)}`;
}

function tableColumnMask(widget: LayoutWidget, columnName: string): MaskMode {
  const masks = widget.config?.columnMasks;
  if (!masks || typeof masks !== "object" || Array.isArray(masks)) return "NONE";
  const value = (masks as Record<string, unknown>)[columnName];
  return String(value ?? "NONE") as MaskMode;
}

export function DashboardDisplayPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const dashboardId = Number(id);
  const requestedProfileId = Number(searchParams.get("profileId"));
  const { accessToken } = useAuth();

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [profiles, setProfiles] = useState<LayoutProfile[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [now, setNow] = useState(new Date());
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const loadData = useCallback(async () => {
    if (!Number.isFinite(dashboardId)) return;
    try {
      const result = await apiRequest<PreviewResult>(
        `/dashboards/${dashboardId}/preview`,
        { method: "POST" },
        accessToken,
      );
      setPreview(result);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dashboard 載入失敗。");
    }
  }, [accessToken, dashboardId]);

  const loadLayout = useCallback(async () => {
    if (!Number.isFinite(dashboardId)) return;
    try {
      const result = await apiRequest<{ profiles: LayoutProfile[] }>(
        `/dashboards/${dashboardId}/layout`,
        {},
        accessToken,
      );
      setProfiles(result.profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dashboard 版面載入失敗。");
    }
  }, [accessToken, dashboardId]);

  useEffect(() => {
    void Promise.all([loadData(), loadLayout()]);
  }, [loadData, loadLayout]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleResize = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const activeProfile = useMemo(() => {
    if (Number.isFinite(requestedProfileId)) {
      const requested = profiles.find((profile) => profile.id === requestedProfileId);
      if (requested) return requested;
    }

    if (profiles.length === 0) return null;

    const viewportRatio = viewport.width / Math.max(1, viewport.height);
    const ranked = profiles
      .map((profile) => {
        const profileRatio = profile.canvasWidth / Math.max(1, profile.canvasHeight);
        const ratioPenalty = Math.abs(Math.log(profileRatio / viewportRatio));
        const scale = Math.min(
          viewport.width / profile.canvasWidth,
          viewport.height / profile.canvasHeight,
        );
        const scalePenalty = Math.abs(Math.log(Math.max(scale, 0.01)));
        const defaultBonus = profile.isDefault ? -0.02 : 0;
        return { profile, score: ratioPenalty * 4 + scalePenalty + defaultBonus };
      })
      .sort((a, b) => a.score - b.score);

    return ranked[0]?.profile
      ?? profiles.find((profile) => profile.isDefault)
      ?? profiles[0];
  }, [profiles, requestedProfileId, viewport]);

  const pageSize = Math.max(1, preview?.dashboard.pageSize ?? 5);
  const pageSeconds = Math.max(5, preview?.dashboard.pageSeconds ?? 20);
  const refreshSeconds = Math.max(5, preview?.dashboard.refreshSeconds ?? 10);
  const totalPages = Math.max(1, Math.ceil((preview?.result.rows.length ?? 0) / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    if (!preview) return [];
    const start = (safePage - 1) * pageSize;
    return preview.result.rows.slice(start, start + pageSize);
  }, [pageSize, preview, safePage]);

  const visibleColumns = useMemo(() => {
    if (!preview) return [];
    const resultNames = new Set(preview.result.columns.map((column) => column.name));
    const configured = preview.reportColumns
      .filter((column) => column.isVisible && resultNames.has(column.columnName))
      .sort((a, b) => a.displayOrder - b.displayOrder);

    if (preview.reportColumns.length > 0) return configured;

    return preview.result.columns.map((column, index) => ({
      columnName: column.name,
      displayLabel: column.name,
      displayOrder: index,
      isVisible: true,
      alignment: "LEFT" as const,
    }));
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    const timer = window.setInterval(() => void loadData(), refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [loadData, refreshSeconds, Boolean(preview)]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!preview) return;
    setCountdown(pageSeconds);
  }, [dashboardId, pageSeconds, Boolean(preview)]);

  useEffect(() => {
    if (!preview) return;
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          setPage((currentPage) => currentPage >= totalPages ? 1 : currentPage + 1);
          return pageSeconds;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pageSeconds, totalPages, Boolean(preview)]);

  const scale = useMemo(() => {
    if (!activeProfile) return 1;
    return Math.min(
      viewport.width / activeProfile.canvasWidth,
      viewport.height / activeProfile.canvasHeight,
    );
  }, [activeProfile, viewport]);

  function renderWidget(widget: LayoutWidget) {
    const firstRow = pageRows[0] ?? preview?.result.rows[0] ?? {};
    const parameters = preview?.dashboard.parameters ?? {};

    if (widget.widgetType === "TABLE") {
      return (
        <div className="dashboard-play-table">
          <table>
            <thead>
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column.columnName}>{column.displayLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {visibleColumns.map((column) => (
                    <td
                      key={column.columnName}
                      style={{ textAlign: column.alignment.toLowerCase() as "left" | "center" | "right" }}
                    >
                      {maskText(row[column.columnName], tableColumnMask(widget, column.columnName))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {pageRows.length === 0 && <div className="dashboard-play-empty">目前沒有資料</div>}
        </div>
      );
    }

    let value = "";
    switch (widget.widgetType) {
      case "TEXT":
        value = widget.staticText ?? "";
        break;
      case "PARAMETER":
        value = widget.sourceKey ? textValue(parameters[widget.sourceKey]) : "";
        break;
      case "FIELD":
        value = widget.sourceKey
          ? maskText(firstRow[widget.sourceKey], widget.config?.maskMode)
          : "";
        break;
      case "CLOCK":
        value = now.toLocaleString("zh-TW", { hour12: false });
        break;
      case "PAGE_INFO":
        value = `目前頁數：${safePage} / ${totalPages}`;
        break;
      case "COUNTDOWN":
        value = `換頁倒數：${countdown} 秒`;
        break;
    }

    return (
      <div className="dashboard-play-value">
        {widget.title && widget.widgetType !== "TEXT" && (
          <span className="dashboard-play-label">{widget.title}</span>
        )}
        <strong>{value}</strong>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <main className="dashboard-display-screen">
        <div className="dashboard-display-error">
          <h1>Dashboard 無法顯示</h1>
          <p>{error}</p>
          <Link to="/dashboards">返回 Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!preview || !activeProfile) {
    return (
      <main className="dashboard-display-screen">
        <div className="dashboard-display-loading">
          {profiles.length === 0 && preview ? "尚未建立螢幕版型。" : "載入中…"}
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-display-screen">
      <div
        className="dashboard-display-profile-shell"
        style={{
          width: activeProfile.canvasWidth * scale,
          height: activeProfile.canvasHeight * scale,
        }}
      >
        <div
          className="dashboard-display-profile-canvas"
          style={{
            width: activeProfile.canvasWidth,
            height: activeProfile.canvasHeight,
            transform: `scale(${scale})`,
          }}
        >
          {activeProfile.widgets
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((widget) => (
              <div
                className="dashboard-play-widget"
                key={widget.id}
                style={{
                  left: widget.x,
                  top: widget.y,
                  width: widget.width,
                  height: widget.height,
                  fontSize: widget.fontSize,
                  textAlign: widget.alignment.toLowerCase() as "left" | "center" | "right",
                }}
              >
                {renderWidget(widget)}
              </div>
            ))}
        </div>
      </div>

      <button
        className="dashboard-fullscreen-button"
        type="button"
        onClick={() => document.documentElement.requestFullscreen?.()}
      >
        全螢幕
      </button>
    </main>
  );
}
