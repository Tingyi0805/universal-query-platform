import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DataSourcesPage.css";

type DataSourceType = "SQLSERVER" | "ORACLE" | "MYSQL" | "POSTGRESQL" | "ODBC";
type OracleConnectionMode = "SERVICE_NAME" | "SID";
type OdbcConnectionMode = "DSN" | "CONNECTION_STRING";

type DataSourceRow = {
  id: number;
  code: string;
  name: string;
  type: DataSourceType;
  host: string;
  port: number;
  databaseName: string | null;
  oracleServiceName: string | null;
  oracleConnectionMode: OracleConnectionMode | null;
  odbcConnectionMode: OdbcConnectionMode | null;
  odbcDsn: string | null;
  username: string;
  connectionTimeoutSec: number;
  queryTimeoutSec: number;
  encryptConnection: boolean;
  trustServerCertificate: boolean;
  isActive: boolean;
  hasPassword: boolean;
  hasOdbcConnectionString: boolean;
};

type FormState = Omit<DataSourceRow, "id" | "hasPassword" | "hasOdbcConnectionString"> & {
  id?: number;
  password: string;
  odbcConnectionString: string;
  hasOdbcConnectionString?: boolean;
};

type ConnectionTestResult = {
  ok: boolean;
  message: string;
  serverVersion?: string;
  driverName?: string;
  driverVersion?: string;
  driverMode?: string;
  configuredDriverMode?: string;
  clientVersion?: string;
  compatibilityStatus?: "VERIFIED" | "NEEDS_CONFIGURATION" | "UNSUPPORTED" | "UNKNOWN";
  errorCode?: string;
  recommendation?: string;
};

function dataSourceTypeLabel(type: DataSourceType): string {
  switch (type) {
    case "SQLSERVER": return "SQL Server";
    case "ORACLE": return "Oracle";
    case "MYSQL": return "MySQL";
    case "POSTGRESQL": return "PostgreSQL";
    case "ODBC": return "ODBC";
  }
}

const emptyForm: FormState = {
  code: "",
  name: "",
  type: "SQLSERVER",
  host: "",
  port: 1433,
  databaseName: "",
  oracleServiceName: "",
  oracleConnectionMode: "SERVICE_NAME",
  odbcConnectionMode: "DSN",
  odbcDsn: "",
  odbcConnectionString: "",
  username: "",
  password: "",
  connectionTimeoutSec: 10,
  queryTimeoutSec: 30,
  encryptConnection: false,
  trustServerCertificate: true,
  isActive: true,
};

export function DataSourcesPage() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<DataSourceRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connectionTest, setConnectionTest] = useState<ConnectionTestResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ dataSources: DataSourceRow[] }>("/datasources", {}, accessToken);
      setRows(result.dataSources);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入資料來源失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  function selectRow(row: DataSourceRow) {
    setForm({
      ...row,
      password: "",
      odbcConnectionString: "",
      hasOdbcConnectionString: row.hasOdbcConnectionString,
    });
    setNotice("");
    setError("");
    setConnectionTest(null);
  }

  function resetForm(type: DataSourceType = "SQLSERVER") {
    setForm({
      ...emptyForm,
      type,
      port: type === "ODBC" ? 1 : type === "ORACLE" ? 1521 : type === "MYSQL" ? 3306 : type === "POSTGRESQL" ? 5432 : 1433,
      oracleConnectionMode: type === "ORACLE" ? "SERVICE_NAME" : null,
      odbcConnectionMode: type === "ODBC" ? "DSN" : null,
    });
    setError("");
    setNotice("");
    setConnectionTest(null);
  }

  function changeType(type: DataSourceType) {
    setForm((current) => ({
      ...current,
      type,
      port: type === "ODBC" ? 1 : type === "ORACLE" ? 1521 : type === "MYSQL" ? 3306 : type === "POSTGRESQL" ? 5432 : 1433,
      databaseName: type === "ORACLE" || type === "ODBC" ? null : current.databaseName,
      oracleServiceName: type === "ORACLE" ? current.oracleServiceName : null,
      oracleConnectionMode: type === "ORACLE" ? (current.oracleConnectionMode ?? "SERVICE_NAME") : null,
      odbcConnectionMode: type === "ODBC" ? (current.odbcConnectionMode ?? "DSN") : null,
      odbcDsn: type === "ODBC" ? current.odbcDsn : null,
      odbcConnectionString: type === "ODBC" ? current.odbcConnectionString : "",
      encryptConnection: type === "ORACLE" || type === "ODBC" ? false : current.encryptConnection,
      trustServerCertificate: type === "ORACLE" || type === "ODBC" ? true : current.trustServerCertificate,
    }));
  }

  const payload = () => ({
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    type: form.type,
    host: form.type === "ODBC" ? "ODBC" : form.host.trim(),
    port: form.type === "ODBC" ? 1 : Number(form.port),
    databaseName: form.type === "ORACLE" || form.type === "ODBC" ? null : (form.databaseName?.trim() || null),
    oracleServiceName: form.type === "ORACLE" ? (form.oracleServiceName?.trim() || null) : null,
    oracleConnectionMode: form.type === "ORACLE" ? form.oracleConnectionMode : null,
    odbcConnectionMode: form.type === "ODBC" ? form.odbcConnectionMode : null,
    odbcDsn: form.type === "ODBC" && form.odbcConnectionMode === "DSN" ? (form.odbcDsn?.trim() || null) : null,
    ...(form.type === "ODBC" && form.odbcConnectionMode === "CONNECTION_STRING" && form.odbcConnectionString.trim()
      ? { odbcConnectionString: form.odbcConnectionString.trim() }
      : {}),
    username: form.username.trim(),
    ...(form.password ? { password: form.password } : {}),
    connectionTimeoutSec: Number(form.connectionTimeoutSec),
    queryTimeoutSec: Number(form.queryTimeoutSec),
    encryptConnection: form.type === "ORACLE" || form.type === "ODBC" ? false : form.encryptConnection,
    trustServerCertificate: form.type === "ORACLE" || form.type === "ODBC" ? true : form.trustServerCertificate,
    isActive: form.isActive,
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (form.id) {
        await apiRequest(`/datasources/${form.id}`, {
          method: "PUT",
          body: JSON.stringify(payload()),
        }, accessToken);
        setNotice("資料來源已更新。");
      } else {
        if (form.type !== "ODBC" && !form.password) {
          setError("新增資料來源時密碼必填。");
          return;
        }
        if (form.type === "ODBC" && form.odbcConnectionMode === "CONNECTION_STRING" && !form.odbcConnectionString.trim()) {
          setError("新增 ODBC Connection String 模式時連線字串必填。");
          return;
        }
        await apiRequest("/datasources", {
          method: "POST",
          body: JSON.stringify(payload()),
        }, accessToken);
        setNotice("資料來源已建立。");
      }
      await load();
      resetForm(form.type);
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setError("");
    setNotice("");
    setConnectionTest(null);
    try {
      let result: ConnectionTestResult;

      if (form.id && !form.password) {
        result = await apiRequest(`/datasources/${form.id}/test`, { method: "POST" }, accessToken);
      } else {
        if (form.type !== "ODBC" && !form.password) {
          setError("測試尚未儲存的連線時必須輸入密碼。");
          return;
        }
        if (form.type === "ODBC" && form.odbcConnectionMode === "CONNECTION_STRING" && !form.odbcConnectionString.trim()) {
          setError("測試 ODBC Connection String 模式時連線字串必填。");
          return;
        }
        result = await apiRequest("/datasources/test", {
          method: "POST",
          body: JSON.stringify(payload()),
        }, accessToken);
      }

      setConnectionTest(result);
      if (result.ok) {
        setNotice(result.message);
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "測試連線失敗。");
    }
  }

  async function remove(row: DataSourceRow) {
    setError("");
    setNotice("");
    try {
      const impact = await apiRequest<{ canDelete: boolean; datasetCount: number }>(
        `/datasources/${row.id}/delete-impact`,
        {},
        accessToken,
      );

      if (!impact.canDelete) {
        setError(
          `資料來源「${row.name}」目前被 ${impact.datasetCount} 個 Dataset 使用，不能直接刪除。請先解除關聯，或取消「啟用」後儲存。`,
        );
        return;
      }

      if (!window.confirm(`確定永久刪除資料來源「${row.name}」？此操作無法復原。`)) return;

      await apiRequest(`/datasources/${row.id}`, { method: "DELETE" }, accessToken);
      if (form.id === row.id) resetForm();
      setNotice("資料來源已刪除。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除失敗。");
    }
  }

  return (
    <main className="page-shell">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">DataSource Manager</p>
          <h1>資料來源管理</h1>
          <p className="subtitle">集中管理查詢設計可使用的 SQL Server、Oracle、MySQL、PostgreSQL 與 ODBC 連線。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      <div className="datasource-layout">
        <section className="datasource-list">
          <div className="section-title">
            <h2>資料來源</h2>
            <button className="secondary-button" type="button" onClick={() => resetForm()}>＋新增</button>
          </div>

          {loading ? <div className="notice">載入中…</div> : rows.map((row) => (
            <article
              className={`datasource-item ${form.id === row.id ? "selected" : ""}`}
              key={row.id}
              onClick={() => selectRow(row)}
            >
              <div>
                <strong>{row.name}</strong>
                <small>{row.code}</small>
              </div>
              <div className="datasource-meta">
                <span>{dataSourceTypeLabel(row.type)}</span>
                <span className={row.isActive ? "state-ok" : "state-off"}>
                  {row.isActive ? "啟用" : "停用"}
                </span>
              </div>
            </article>
          ))}

          {!loading && rows.length === 0 && <div className="empty-state">尚未建立資料來源。</div>}
        </section>

        <section className="datasource-editor">
          <div className="section-title">
            <h2>{form.id ? "編輯資料來源" : "新增資料來源"}</h2>
            {form.id && <button className="secondary-button" type="button" onClick={() => resetForm(form.type)}>取消編輯</button>}
          </div>

          <form className="datasource-form" onSubmit={save}>
            <div className="form-grid two">
              <label>代碼
                <input value={form.code} disabled={Boolean(form.id)}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </label>
              <label>名稱
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
            </div>

            <div className="form-grid two">
              <label>資料庫類型
                <select value={form.type} onChange={(e) => changeType(e.target.value as DataSourceType)}>
                  <option value="SQLSERVER">SQL Server</option>
                  <option value="ORACLE">Oracle</option>
                  <option value="MYSQL">MySQL</option>
                  <option value="POSTGRESQL">PostgreSQL</option>
                  <option value="ODBC">ODBC（通用相容模式）</option>
                </select>
              </label>
              {form.type !== "ODBC" ? (
                <label>Port
                  <input type="number" min={1} max={65535} value={form.port}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
                </label>
              ) : (
                <label>ODBC 模式
                  <select value={form.odbcConnectionMode ?? "DSN"}
                    onChange={(e) => setForm({
                      ...form,
                      odbcConnectionMode: e.target.value as OdbcConnectionMode,
                    })}>
                    <option value="DSN">DSN</option>
                    <option value="CONNECTION_STRING">Connection String</option>
                  </select>
                </label>
              )}
            </div>

            {form.type !== "ODBC" && (
              <label>Host / IP
                <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
              </label>
            )}

            {form.type === "ODBC" ? (
              form.odbcConnectionMode === "DSN" ? (
                <label>ODBC DSN
                  <input
                    value={form.odbcDsn ?? ""}
                    placeholder="例如 HIS_DB"
                    onChange={(e) => setForm({ ...form, odbcDsn: e.target.value })}
                  />
                </label>
              ) : (
                <label>ODBC Connection String
                  <textarea
                    rows={4}
                    value={form.odbcConnectionString}
                    placeholder={form.id && form.hasOdbcConnectionString
                      ? "已設定；留白則保留原連線字串"
                      : "Driver={...};Server=...;Database=...;"}
                    onChange={(e) => setForm({ ...form, odbcConnectionString: e.target.value })}
                  />
                  <small>連線字串會加密儲存，讀取編輯頁時不回傳原始內容。</small>
                </label>
              )
            ) : form.type === "ORACLE" ? (
              <div className="form-grid two">
                <label>連線模式
                  <select value={form.oracleConnectionMode ?? "SERVICE_NAME"}
                    onChange={(e) => setForm({ ...form, oracleConnectionMode: e.target.value as OracleConnectionMode })}>
                    <option value="SERVICE_NAME">Service Name</option>
                    <option value="SID">SID</option>
                  </select>
                </label>
                <label>{form.oracleConnectionMode === "SID" ? "SID" : "Service Name"}
                  <input value={form.oracleServiceName ?? ""}
                    onChange={(e) => setForm({ ...form, oracleServiceName: e.target.value })} />
                </label>
              </div>
            ) : (
              <>
                <label>Database
                  <input value={form.databaseName ?? ""} onChange={(e) => setForm({ ...form, databaseName: e.target.value })} />
                </label>
                <div className="check-row">
                  <label><input type="checkbox" checked={form.encryptConnection}
                    onChange={(e) => setForm({ ...form, encryptConnection: e.target.checked })} />
                    {form.type === "SQLSERVER" ? "Encrypt connection" : "使用 SSL / TLS"}
                  </label>
                  <label><input type="checkbox" checked={form.trustServerCertificate}
                    onChange={(e) => setForm({ ...form, trustServerCertificate: e.target.checked })} />
                    {form.type === "SQLSERVER" ? "Trust server certificate" : "允許未受信任憑證"}
                  </label>
                </div>
              </>
            )}

            {!(form.type === "ODBC" && form.odbcConnectionMode === "CONNECTION_STRING") && (
              <div className="form-grid two">
                <label>Username {form.type === "ODBC" && <small>（可選，視 DSN 驗證方式）</small>}
                  <input autoComplete="off" value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </label>
                <label>Password {form.id && <small>（留白則保留原密碼）</small>}
                  <input type="password" autoComplete="new-password" value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </label>
              </div>
            )}

            <div className="form-grid two">
              <label>Connection Timeout（秒）
                <input type="number" min={1} max={300} value={form.connectionTimeoutSec}
                  onChange={(e) => setForm({ ...form, connectionTimeoutSec: Number(e.target.value) })} />
              </label>
              <label>Query Timeout（秒）
                <input type="number" min={1} max={3600} value={form.queryTimeoutSec}
                  onChange={(e) => setForm({ ...form, queryTimeoutSec: Number(e.target.value) })} />
              </label>
            </div>

            <label className="inline-check">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              啟用此資料來源
            </label>

            {connectionTest && (
              <section className={`connection-diagnostics ${connectionTest.ok ? "success" : "failure"}`}>
                <div className="diagnostics-header">
                  <strong>{connectionTest.ok ? "連線診斷：成功" : "連線診斷：失敗"}</strong>
                  {connectionTest.compatibilityStatus && (
                    <span>{connectionTest.compatibilityStatus === "VERIFIED" ? "已驗證可用" :
                      connectionTest.compatibilityStatus === "NEEDS_CONFIGURATION" ? "需要調整設定" :
                      connectionTest.compatibilityStatus === "UNSUPPORTED" ? "不支援" : "待確認"}</span>
                  )}
                </div>
                <dl>
                  {connectionTest.serverVersion && <><dt>Database Server</dt><dd>{connectionTest.serverVersion}</dd></>}
                  {connectionTest.driverName && <><dt>Driver</dt><dd>{connectionTest.driverName}{connectionTest.driverVersion ? ` ${connectionTest.driverVersion}` : ""}</dd></>}
                  {connectionTest.configuredDriverMode && <><dt>設定模式</dt><dd>{connectionTest.configuredDriverMode}</dd></>}
                  {connectionTest.driverMode && <><dt>實際模式</dt><dd>{connectionTest.driverMode}</dd></>}
                  {connectionTest.clientVersion && <><dt>Oracle Client</dt><dd>{connectionTest.clientVersion}</dd></>}
                  {connectionTest.errorCode && <><dt>錯誤碼</dt><dd>{connectionTest.errorCode}</dd></>}
                </dl>
                <p>{connectionTest.message}</p>
                {connectionTest.recommendation && (
                  <div className="diagnostics-recommendation">
                    <strong>建議處理方式</strong>
                    <p>{connectionTest.recommendation}</p>
                  </div>
                )}
              </section>
            )}

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</button>
              <button className="secondary-button" type="button" onClick={() => void testConnection()}>測試連線</button>
              {form.id && (
                <button className="danger-button" type="button"
                  onClick={() => {
                    const row = rows.find((x) => x.id === form.id);
                    if (row) void remove(row);
                  }}>
                  刪除
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
