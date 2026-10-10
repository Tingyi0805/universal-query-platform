import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DashboardDisplayPage.css";

type DashboardRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  queryDefinitionId: number;
  queryCode: string;
  queryName: string;
  refreshSeconds: number;
  displayMode: "TABLE" | "BIG_SCREEN";
  displayTitle: string | null;
  pageSize: number;
  pageSeconds: number;
  showClock: boolean;
  showPageNumber: boolean;
  showCountdown: boolean;
  parameters: Record<string, unknown>;
  isActive: boolean;
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
    columns: { name: string; dataType?: string }[];
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
    elapsedMs: number;
  };
};

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DashboardDisplayPage() {
  const { id } = useParams();
  const dashboardId = Number(id);
  const { accessToken } = useAuth();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [now, setNow] = useState(new Date());

  const load = useCallback(async () => {
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

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const timer = window.setInterval(
      () => void load(),
      refreshSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [load, refreshSeconds, Boolean(preview)]);

  const columns = useMemo(() => {
    if (!preview) return [];
    const names = new Set(preview.result.columns.map((column) => column.name));
    const configured = preview.reportColumns
      .filter((column) => column.isVisible && names.has(column.columnName))
      .sort((a, b) => a.displayOrder - b.displayOrder);

    if (preview.reportColumns.length > 0) return configured;

    return preview.result.columns.map((column, index) => ({
      columnName: column.name,
      displayLabel: column.name,
      displayOrder: index,
      isVisible: true,
      alignment: "CENTER" as const,
    }));
  }, [preview]);

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

  if (!preview && !error) {
    return <main className="dashboard-display-screen"><div className="dashboard-display-loading">載入中…</div></main>;
  }

  if (error) {
    return (
      <main className="dashboard-display-screen">
        <div className="dashboard-display-error">
          <h1>Dashboard 無法顯示</h1>
          <p>{error}</p>
          <Link to="/designer/dashboards">返回 Dashboard 設計</Link>
        </div>
      </main>
    );
  }

  const dashboard = preview!.dashboard;
  const bigScreen = dashboard.displayMode === "BIG_SCREEN";

  return (
    <main className={`dashboard-display-screen ${bigScreen ? "big-screen" : "table-screen"}`}>
      <header className="dashboard-display-header">
        <h1>{dashboard.displayTitle || dashboard.name}</h1>

        <div className="dashboard-display-meta">
          {dashboard.showPageNumber && (
            <span>目前頁數：{safePage} / {totalPages}</span>
          )}
          {dashboard.showClock && (
            <span>{now.toLocaleString("zh-TW", { hour12: false })}</span>
          )}
          {dashboard.showCountdown && (
            <span className="dashboard-display-countdown">換頁倒數：{countdown} 秒</span>
          )}
        </div>
      </header>

      <section className="dashboard-display-content">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.columnName}>{column.displayLabel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td
                    key={column.columnName}
                    style={{
                      textAlign: column.alignment.toLowerCase() as "left" | "center" | "right",
                    }}
                  >
                    {formatValue(row[column.columnName])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {pageRows.length === 0 && (
          <div className="dashboard-display-empty">目前沒有資料</div>
        )}
      </section>

      <footer className="dashboard-display-footer">
        <span>資料更新：每 {refreshSeconds} 秒</span>
        <span>換頁：每 {pageSeconds} 秒</span>
        <button type="button" onClick={() => document.documentElement.requestFullscreen?.()}>
          全螢幕
        </button>
      </footer>
    </main>
  );
}
