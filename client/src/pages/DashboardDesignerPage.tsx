import { dashboardOperationError } from "../dashboard/managementStatus";
import { SecurityManagementLinks } from "../components/SecurityManagementLinks";
import { DashboardBasicSettingsEditor } from "../components/DashboardBasicSettingsEditor";
import { sourcePreviewFailure } from "../dashboard/dataSettings";
import { DashboardQueryPlaybackManager } from "../components/DashboardQueryPlaybackManager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { trustedConfiguration, type QuerySourceConfiguration } from "../dashboard/querySourceManagement";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ManagementListToolbar } from "../components/ManagementListToolbar";
import { DashboardDataSourcesEditor } from "../components/DashboardDataSourcesEditor";
import "./DashboardDesignerPage.css";

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
  query: { id: number; code: string; name: string };
  reportColumns: ReportColumn[];
  result: {
    columns: { name: string; dataType?: string }[];
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
    elapsedMs: number;
  };
};

type FormState = { id: number | null; code: string };
const emptyForm: FormState = { id: null, code: "" };

function displayValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DashboardDesignerPage() {
  const { accessToken } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedEditor = Number(searchParams.get("dashboardId"));
  const openedFromLink = useRef<number | null>(null);

  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewDashboardId, setPreviewDashboardId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [listStatus, setListStatus] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [listDisplayMode, setListDisplayMode] = useState<"" | "TABLE" | "BIG_SCREEN">("");
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(20);
  const [listTotal, setListTotal] = useState(0);
  const [listTotalPages, setListTotalPages] = useState(1);
  const listRead = useRef(0);
  const load = useCallback(async (background = false) => {
    const read = ++listRead.current;
    if (!background) { setLoading(true); setError(""); }
    try {
      const params = new URLSearchParams({
        page: String(listPage),
        pageSize: String(listPageSize),
        status: listStatus,
      });
      if (listSearch) params.set("search", listSearch);
      if (listDisplayMode) params.set("displayMode", listDisplayMode);

      const dashboardResult = await apiRequest<{ dashboards: DashboardRow[]; total: number; totalPages: number }>(`/dashboards?${params.toString()}`, {}, accessToken);
      if (read !== listRead.current) return;
      setDashboards(dashboardResult.dashboards);
      setListTotal(dashboardResult.total);
      setListTotalPages(dashboardResult.totalPages);
    } catch (e) {
      if (read === listRead.current && !background) setError(e instanceof Error ? e.message : "載入 Dashboard 設定失敗。");
    } finally {
      if (read === listRead.current) setLoading(false);
    }
  }, [accessToken, listDisplayMode, listPage, listPageSize, listSearch, listStatus]);

  useEffect(() => {
    void load();
    const changed = () => { void load(true); };
    window.addEventListener("uqp.dashboard.configuration.changed", changed);
    return () => { ++listRead.current; window.removeEventListener("uqp.dashboard.configuration.changed", changed); };
  }, [load]);
  useEffect(() => {
    const selected = dashboards.find(item => item.id === requestedEditor);
    if (selected && openedFromLink.current !== requestedEditor) { openedFromLink.current = requestedEditor; editDashboard(selected); }
  }, [dashboards, requestedEditor]);

  const previewSequence = useRef(0);
  const loadPreview = useCallback(async (dashboardId: number, silent = false) => {
    const sequence = ++previewSequence.current;
    if (!silent) setPreviewLoading(true);
    setError("");
    try {
      const configuration = trustedConfiguration(await apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`, {}, accessToken));
      const page = await apiRequest<PreviewResult>(`/dashboards/${dashboardId}/query-sources/v1/PRIMARY/preview`, { method: "POST", body: JSON.stringify({ page: 1 }) }, accessToken);
      const result = { ...page, reportColumns: [], dashboard: { id: dashboardId, code: "", name: configuration.presentation?.name ?? "Query-only 設計預覽", refreshSeconds: configuration.primary.refreshSeconds } } as unknown as PreviewResult;
      if (sequence !== previewSequence.current) return;
      setPreview(result);
    } catch (e) {
      if (sequence !== previewSequence.current) return;
      const code = (e as { code?: string })?.code;
      setError(code === "QUERY_SOURCE_MANAGEMENT_DISABLED" || code === "QUERY_DEVICE_PLAYBACK_DISABLED" ? dashboardOperationError(e) : sourcePreviewFailure("PRIMARY", e));
      setPreview(null);
    } finally {
      if (sequence === previewSequence.current) setPreviewLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!previewDashboardId) return;

    const dashboard = dashboards.find((item) => item.id === previewDashboardId);
    if (!dashboard) return;

    const timer = window.setInterval(
      () => void loadPreview(previewDashboardId, true),
      Math.max(5, dashboard.refreshSeconds) * 1000,
    );

    return () => window.clearInterval(timer);
  }, [dashboards, loadPreview, previewDashboardId]);

  function editDashboard(item: DashboardRow) {
    setForm({ id: item.id, code: item.code });
    setNotice("");
    setError("");
  }

  function newDashboard() {
    setForm(emptyForm);
    setNotice("");
    setError("");
  }

  async function startPreview(item: DashboardRow) {
    setPreviewDashboardId(item.id);
    await loadPreview(item.id);
  }


  const previewColumns = useMemo(() => {
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

  return (
    <main className="page-shell dashboard-designer-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Dashboard Designer</p>
          <h1>資料顯示儀表板</h1>
          <p className="subtitle">建立 Dashboard、設定預設參數、資料更新秒數與大螢幕自動換頁。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {loading && <section className="notice">載入中…</section>}
      {error && <section className="form-error">{error}<SecurityManagementLinks dashboardId={form.id} /></section>}
      {notice && <section className="notice">{notice}</section>}

      {!loading && (
        <>
          <button type="button" onClick={newDashboard}>新增另一個／取消編輯</button>
          <DashboardBasicSettingsEditor key={`basic-${form.id}`} dashboardId={form.id} code={form.code} accessToken={accessToken}
            onCreated={(id, code) => { setForm({ id, code }); setNotice("已建立停用草稿；請完成 PRIMARY 設定，公共顯示政策請在 Dataset 管理。"); void load(); }} />
          {form.id && <nav aria-label="Dashboard 管理步驟"><p>停用草稿 → PRIMARY／額外來源 → <Link to={`/designer/dashboards/${form.id}/layout`}>版型設計／設計預覽</Link> → <a href="#dashboard-device-management">預檢、啟用與裝置授權</a></p><p>操作順序不代表已完成核准；以各區後端版本、核准與預檢結果為準。</p></nav>}
          {form.id && <DashboardDataSourcesEditor key={form.id} dashboardId={form.id} accessToken={accessToken} />}
          {form.id && <DashboardQueryPlaybackManager key={`playback-${form.id}`} dashboardId={form.id} accessToken={accessToken} />}

          <section className="dashboard-list-card">
            <h2>Dashboard 清單</h2>
            <ManagementListToolbar
              search={listSearch}
              onSearch={(value) => { setListSearch(value); setListPage(1); }}
              page={listPage}
              pageSize={listPageSize}
              total={listTotal}
              totalPages={listTotalPages}
              onPageChange={setListPage}
              onPageSizeChange={(value) => { setListPageSize(value); setListPage(1); }}
              filters={
                <>
                  <label>
                    <span>狀態</span>
                    <select
                      value={listStatus}
                      onChange={(event) => {
                        setListStatus(event.target.value as "ACTIVE" | "INACTIVE" | "ALL");
                        setListPage(1);
                      }}
                    >
                      <option value="ACTIVE">啟用</option>
                      <option value="INACTIVE">停用</option>
                      <option value="ALL">全部</option>
                    </select>
                  </label>
                  <label>
                    <span>模式</span>
                    <select
                      value={listDisplayMode}
                      onChange={(event) => {
                        setListDisplayMode(event.target.value as "" | "TABLE" | "BIG_SCREEN");
                        setListPage(1);
                      }}
                    >
                      <option value="">全部</option>
                      <option value="BIG_SCREEN">大螢幕</option>
                      <option value="TABLE">一般表格</option>
                    </select>
                  </label>
                </>
              }
            />
            <div className="dashboard-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>代碼</th>
                    <th>名稱</th>
                    <th>Query</th>
                    <th>資料更新</th>
                    <th>換頁</th>
                    <th>模式</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboards.map((item) => (
                    <tr key={item.id}>
                      <td>{item.code}</td>
                      <td>{item.name}</td>
                      <td>{item.queryName}<small>{item.queryCode}</small></td>
                      <td>{item.refreshSeconds} 秒</td>
                      <td>{item.pageSeconds} 秒 / {item.pageSize} 筆</td>
                      <td>{item.displayMode === "BIG_SCREEN" ? "大螢幕" : "表格"}</td>
                      <td>{item.isActive ? "啟用" : "停用"}</td>
                      <td className="actions">
                        <button className="secondary-button" type="button" onClick={() => editDashboard(item)}>編輯</button>
                        <button className="secondary-button" type="button" onClick={() => void startPreview(item)}>
                          預覽
                        </button>
                        <Link
                          className="secondary-button link-button"
                          to={`/designer/dashboards/${item.id}/layout`}
                        >
                          版面設計
                        </Link>
                        <button className="secondary-button" type="button" onClick={() => { editDashboard(item); window.setTimeout(() => document.getElementById("dashboard-device-management")?.scrollIntoView(), 0); }}>裝置管理</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dashboards.length === 0 && <div className="empty-state">尚未建立 Dashboard。</div>}
          </section>

          {previewDashboardId && (
            <section className="dashboard-preview-card">
              <div className="dashboard-preview-heading">
                <div>
                  <p className="eyebrow">Live Preview</p>
                  <h2>{preview?.dashboard.name ?? "Dashboard 預覽"}</h2>
                  {preview && (
                    <p>
                      {preview.result.rowCount} 筆 · {preview.result.elapsedMs} ms ·
                      每 {preview.dashboard.refreshSeconds} 秒自動更新
                    </p>
                  )}
                </div>
                <div className="actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={previewLoading}
                    onClick={() => void loadPreview(previewDashboardId)}
                  >
                    {previewLoading ? "更新中…" : "立即更新"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setPreviewDashboardId(null);
                      setPreview(null);
                    }}
                  >
                    關閉預覽
                  </button>
                </div>
              </div>

              {preview && (
                <div className="dashboard-preview-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {previewColumns.map((column) => (
                          <th key={column.columnName}>{column.displayLabel}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {previewColumns.map((column) => (
                            <td
                              key={column.columnName}
                              style={{
                                textAlign: column.alignment.toLowerCase() as "left" | "center" | "right",
                              }}
                            >
                              {displayValue(row[column.columnName])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.result.rows.length === 0 && (
                    <div className="empty-state">目前沒有資料。</div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
