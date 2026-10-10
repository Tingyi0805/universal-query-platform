import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
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

type QueryDefinitionRow = {
  id: number;
  code: string;
  name: string;
  isPublished: boolean;
  isActive: boolean;
  isArchived: boolean;
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

type FormState = {
  id: number | null;
  code: string;
  name: string;
  description: string;
  queryDefinitionId: string;
  refreshSeconds: string;
  displayMode: "TABLE" | "BIG_SCREEN";
  displayTitle: string;
  pageSize: string;
  pageSeconds: string;
  showClock: boolean;
  showPageNumber: boolean;
  showCountdown: boolean;
  parametersJson: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  id: null,
  code: "",
  name: "",
  description: "",
  queryDefinitionId: "",
  refreshSeconds: "10",
  displayMode: "BIG_SCREEN",
  displayTitle: "",
  pageSize: "5",
  pageSeconds: "20",
  showClock: true,
  showPageNumber: true,
  showCountdown: true,
  parametersJson: "{}",
  isActive: true,
};

function displayValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DashboardDesignerPage() {
  const { accessToken } = useAuth();

  function openPlayback(dashboardId: number) {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("瀏覽器封鎖了播放視窗，請允許此網站開啟新視窗後再試一次。");
      return;
    }

    const storedAuth = sessionStorage.getItem("uqp.auth");
    if (storedAuth) {
      try {
        popup.sessionStorage.setItem("uqp.auth", storedAuth);
      } catch {
        // If storage handoff fails, the login route will return to the requested playback path.
      }
    }

    popup.location.replace(`/designer/dashboards/${dashboardId}/display`);
  }
  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [queries, setQueries] = useState<QueryDefinitionRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewDashboardId, setPreviewDashboardId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [dashboardResult, queryResult] = await Promise.all([
        apiRequest<{ dashboards: DashboardRow[] }>("/dashboards", {}, accessToken),
        apiRequest<{ queryDefinitions: QueryDefinitionRow[] }>("/query-definitions", {}, accessToken),
      ]);
      setDashboards(dashboardResult.dashboards);
      setQueries(queryResult.queryDefinitions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Dashboard 設定失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  const usableQueries = useMemo(
    () => queries.filter((query) => query.isPublished && query.isActive && !query.isArchived),
    [queries],
  );

  const loadPreview = useCallback(async (dashboardId: number, silent = false) => {
    if (!silent) setPreviewLoading(true);
    setError("");
    try {
      const result = await apiRequest<PreviewResult>(
        `/dashboards/${dashboardId}/preview`,
        { method: "POST" },
        accessToken,
      );
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dashboard 預覽失敗。");
      if (!silent) setPreview(null);
    } finally {
      if (!silent) setPreviewLoading(false);
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
    setForm({
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description ?? "",
      queryDefinitionId: String(item.queryDefinitionId),
      refreshSeconds: String(item.refreshSeconds),
      displayMode: item.displayMode,
      displayTitle: item.displayTitle ?? "",
      pageSize: String(item.pageSize),
      pageSeconds: String(item.pageSeconds),
      showClock: item.showClock,
      showPageNumber: item.showPageNumber,
      showCountdown: item.showCountdown,
      parametersJson: JSON.stringify(item.parameters ?? {}, null, 2),
      isActive: item.isActive,
    });
    setNotice("");
    setError("");
  }

  function newDashboard() {
    setForm(emptyForm);
    setNotice("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      let parameters: Record<string, unknown>;
      try {
        const parsed = JSON.parse(form.parametersJson || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("NOT_OBJECT");
        }
        parameters = parsed;
      } catch {
        setError("預設參數必須是 JSON Object，例如 { \"ROOM_CODE\": \"OR01\" }。");
        return;
      }

      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        queryDefinitionId: Number(form.queryDefinitionId),
        refreshSeconds: Number(form.refreshSeconds),
        displayMode: form.displayMode,
        displayTitle: form.displayTitle.trim() || null,
        pageSize: Number(form.pageSize),
        pageSeconds: Number(form.pageSeconds),
        showClock: form.showClock,
        showPageNumber: form.showPageNumber,
        showCountdown: form.showCountdown,
        parameters,
        isActive: form.isActive,
      };

      if (form.id) {
        await apiRequest(`/dashboards/${form.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        }, accessToken);
        setNotice("Dashboard 已更新。");
      } else {
        await apiRequest("/dashboards", {
          method: "POST",
          body: JSON.stringify(payload),
        }, accessToken);
        setNotice("Dashboard 已建立。");
      }

      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Dashboard 失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: DashboardRow) {
    if (!window.confirm(`確定刪除 Dashboard「${item.name}」？`)) return;
    setError("");
    setNotice("");
    try {
      await apiRequest(`/dashboards/${item.id}`, { method: "DELETE" }, accessToken);
      if (previewDashboardId === item.id) {
        setPreviewDashboardId(null);
        setPreview(null);
      }
      setNotice("Dashboard 已刪除。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除 Dashboard 失敗。");
    }
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
      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      {!loading && (
        <>
          <section className="dashboard-editor-card">
            <div className="dashboard-editor-heading">
              <h2>{form.id ? "編輯 Dashboard" : "新增 Dashboard"}</h2>
              {form.id && (
                <button className="secondary-button" type="button" onClick={newDashboard}>新增另一個</button>
              )}
            </div>

            <form onSubmit={save} className="dashboard-editor-form">
              <label>
                <span>代碼</span>
                <input
                  value={form.code}
                  placeholder="例如 OR01_STATUS"
                  disabled={Boolean(form.id)}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                />
              </label>

              <label>
                <span>名稱</span>
                <input
                  value={form.name}
                  placeholder="例如 手術室 1 狀態"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>

              <label className="wide">
                <span>說明</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>

              <label>
                <span>資料 Query</span>
                <select
                  value={form.queryDefinitionId}
                  onChange={(e) => setForm({ ...form, queryDefinitionId: e.target.value })}
                >
                  <option value="">請選擇已發佈 Query</option>
                  {usableQueries.map((query) => (
                    <option key={query.id} value={query.id}>
                      {query.name} ({query.code})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>資料更新秒數</span>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={form.refreshSeconds}
                  onChange={(e) => setForm({ ...form, refreshSeconds: e.target.value })}
                />
                <small>每個 Dashboard 可獨立設定，5～3600 秒。</small>
              </label>

              <label>
                <span>顯示模式</span>
                <select
                  value={form.displayMode}
                  onChange={(e) => setForm({ ...form, displayMode: e.target.value as "TABLE" | "BIG_SCREEN" })}
                >
                  <option value="BIG_SCREEN">大螢幕看板</option>
                  <option value="TABLE">一般表格</option>
                </select>
              </label>

              <label className="wide">
                <span>播放標題</span>
                <input
                  value={form.displayTitle}
                  placeholder="例如 手術病患動態；留白則使用 Dashboard 名稱"
                  onChange={(e) => setForm({ ...form, displayTitle: e.target.value })}
                />
              </label>

              <label>
                <span>每頁筆數</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.pageSize}
                  onChange={(e) => setForm({ ...form, pageSize: e.target.value })}
                />
              </label>

              <label>
                <span>換頁秒數</span>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={form.pageSeconds}
                  onChange={(e) => setForm({ ...form, pageSeconds: e.target.value })}
                />
                <small>每個 Dashboard 可獨立設定，與資料更新秒數分開。</small>
              </label>

              <div className="dashboard-display-options wide">
                <label>
                  <input
                    type="checkbox"
                    checked={form.showClock}
                    onChange={(e) => setForm({ ...form, showClock: e.target.checked })}
                  />
                  <span>顯示系統時間</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.showPageNumber}
                    onChange={(e) => setForm({ ...form, showPageNumber: e.target.checked })}
                  />
                  <span>顯示頁碼</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.showCountdown}
                    onChange={(e) => setForm({ ...form, showCountdown: e.target.checked })}
                  />
                  <span>顯示換頁倒數</span>
                </label>
              </div>

              <label className="wide">
                <span>預設參數 JSON</span>
                <textarea
                  rows={5}
                  value={form.parametersJson}
                  spellCheck={false}
                  placeholder={'{\n  "ROOM_CODE": "OR01"\n}'}
                  onChange={(e) => setForm({ ...form, parametersJson: e.target.value })}
                />
                <small>第一階段先使用 JSON；後續會改為參數預設表單並支援 Display Profile 覆寫。</small>
              </label>

              <label className="dashboard-active-field">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span>啟用 Dashboard</span>
              </label>

              <div className="dashboard-form-actions">
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "儲存中…" : form.id ? "儲存修改" : "建立 Dashboard"}
                </button>
                {form.id && (
                  <button className="secondary-button" type="button" onClick={newDashboard}>取消編輯</button>
                )}
              </div>
            </form>
          </section>

          <section className="dashboard-list-card">
            <h2>Dashboard 清單</h2>
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
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => openPlayback(item.id)}
                        >
                          播放
                        </button>
                        <button className="danger-button" type="button" onClick={() => void remove(item)}>刪除</button>
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
