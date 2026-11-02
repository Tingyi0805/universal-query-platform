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
  dashboard: Pick<DashboardRow,"id"|"name"|"refreshSeconds"|"pageSeconds"|"pageSize">;
  refreshSeconds?:number; pageSeconds?:number; pageSize?:number;
  page: number; totalPages: number; totalRows?: number; snapshotId: string;
  query: { id: number; code: string; name: string };
  reportColumns: ReportColumn[];
  result: {
    columns: { name: string; dataType?: string }[];
    rows: Record<string, unknown>[];
    rowCount?: number;
    truncated: boolean;
    elapsedMs?: number | null;
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
  const [previewValue, setPreview] = useState<(PreviewResult & {viewer:string|null}) | null>(null);
  const preview=previewValue?.viewer===accessToken?previewValue:null;
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

  const previewSequence = useRef(0), previewRequest=useRef<AbortController|null>(null), previewPage=useRef(1), previewLive=useRef<PreviewResult|null>(null);
  const loadPreview = useCallback(async (dashboardId: number, silent = false, requestedPage=previewPage.current) => {
    const sequence = ++previewSequence.current;
    previewRequest.current?.abort();const controller=new AbortController();previewRequest.current=controller;
    if (!silent) setPreviewLoading(true);
    setError("");
    try {
      const configuration = trustedConfiguration(await apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`, {signal:controller.signal}, accessToken));
      const fetchPage=(body:{page:number;snapshotId?:string})=>apiRequest<Omit<PreviewResult,"dashboard"|"reportColumns">>(`/dashboards/${dashboardId}/query-sources/v1/PRIMARY/preview`, {method:"POST",signal:controller.signal,body:JSON.stringify(body)},accessToken);
      // Refresh the short-lived snapshot, then select the desired page within it. The page clock is independent.
      const first=await fetchPage({page:1});
      if(!Number.isSafeInteger(first.totalPages)||first.totalPages<1||first.page!==1||typeof first.snapshotId!=="string"||!first.snapshotId)throw new Error("PREVIEW_INVALID");
      const wanted=Math.min(Math.max(1,requestedPage),first.totalPages);
      const page=wanted===1?first:await fetchPage({page:wanted,snapshotId:first.snapshotId});
      if(page.page!==wanted||page.snapshotId!==first.snapshotId||page.totalPages!==first.totalPages||!Array.isArray(page.result?.rows)||!Array.isArray(page.result.columns))throw new Error("PREVIEW_INVALID");
      const result:PreviewResult={...page,reportColumns:[],dashboard:{id:dashboardId,name:configuration.presentation?.name??"Query-only 設計預覽",refreshSeconds:page.refreshSeconds??configuration.primary.refreshSeconds,pageSeconds:page.pageSeconds??configuration.primary.pageSeconds,pageSize:page.pageSize??configuration.primary.pageSize}};
      if (sequence !== previewSequence.current) return;
      previewPage.current=wanted;previewLive.current=result;setPreview({...result,viewer:accessToken});
    } catch (e) {
      if (sequence !== previewSequence.current) return;
      const code = (e as { code?: string })?.code;
      setError(code === "QUERY_SOURCE_MANAGEMENT_DISABLED" || code === "QUERY_DEVICE_PLAYBACK_DISABLED" ? dashboardOperationError(e) : sourcePreviewFailure("PRIMARY", e));
      previewLive.current=null;setPreview(null);
    } finally {
      if (sequence === previewSequence.current) setPreviewLoading(false);
    }
  }, [accessToken]);

  const refreshSeconds=preview?.dashboard.refreshSeconds??dashboards.find(d=>d.id===previewDashboardId)?.refreshSeconds??0;
  const pageSeconds=preview?.dashboard.pageSeconds??0;
  useEffect(()=>{
    if(!previewDashboardId||!refreshSeconds)return;
    const timer=window.setInterval(()=>void loadPreview(previewDashboardId,true),Math.max(5,refreshSeconds)*1000);
    return()=>window.clearInterval(timer);
  },[previewDashboardId,refreshSeconds,loadPreview]);
  useEffect(()=>{
    if(!previewDashboardId||!pageSeconds)return;
    const timer=window.setInterval(()=>{const current=previewLive.current;if(!current||current.totalPages<2)return;
      previewPage.current=previewPage.current%current.totalPages+1;void loadPreview(previewDashboardId,true,previewPage.current);
    },Math.max(5,pageSeconds)*1000);
    return()=>window.clearInterval(timer);
  },[previewDashboardId,pageSeconds,loadPreview]);
  function stopPreview(){++previewSequence.current;previewRequest.current?.abort();previewLive.current=null;previewPage.current=1;setPreview(null);setPreviewDashboardId(null);setPreviewLoading(false);}
  useEffect(()=>{
    stopPreview();
    const changed=(event:Event)=>{if((event as CustomEvent).detail?.dashboardId===previewLive.current?.dashboard.id)stopPreview();};
    window.addEventListener("uqp.dashboard.configuration.changed",changed);
    return()=>{++previewSequence.current;previewRequest.current?.abort();window.removeEventListener("uqp.dashboard.configuration.changed",changed);};
  },[accessToken]);

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
    previewPage.current=1;previewLive.current=null;setPreview(null);setPreviewDashboardId(item.id);
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
                      {typeof preview.totalRows==="number"&&Number.isSafeInteger(preview.totalRows)&&preview.totalRows>=0?`快照共 ${preview.totalRows} 筆`:"總筆數未提供"}；本頁 {preview.result.rows.length} 筆 · 查詢 {typeof preview.result.elapsedMs==="number"&&Number.isFinite(preview.result.elapsedMs)&&preview.result.elapsedMs>=0?`${preview.result.elapsedMs} ms`:"時間未提供"} ·
                      每 {preview.dashboard.refreshSeconds} 秒自動更新；每 {preview.dashboard.pageSeconds} 秒換頁{preview.result.truncated?"（資料已截斷）":""}
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
                    onClick={stopPreview}
                  >
                    關閉預覽
                  </button>
                </div>
              </div>

              {preview && <nav className="uqp-device-actions" aria-label="LIVE PREVIEW 分頁"><span>第 {preview.page}／{preview.totalPages} 頁</span>
                <button type="button" disabled={previewLoading||preview.page<=1} onClick={()=>{previewPage.current=preview.page-1;void loadPreview(previewDashboardId,false,previewPage.current);}}>上一頁預覽</button>
                <button type="button" disabled={previewLoading||preview.page>=preview.totalPages} onClick={()=>{previewPage.current=preview.page+1;void loadPreview(previewDashboardId,false,previewPage.current);}}>下一頁預覽</button>
              </nav>}
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
