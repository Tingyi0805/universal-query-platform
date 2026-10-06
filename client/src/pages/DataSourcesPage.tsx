import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DataSourcesPage.css";

type DataSourceType = "SQLSERVER" | "ORACLE" | "MYSQL" | "POSTGRESQL";
type OracleConnectionMode = "SERVICE_NAME" | "SID";

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
  username: string;
  connectionTimeoutSec: number;
  queryTimeoutSec: number;
  encryptConnection: boolean;
  trustServerCertificate: boolean;
  isActive: boolean;
  hasPassword: boolean;
};

type FormState = Omit<DataSourceRow, "id" | "hasPassword"> & {
  id?: number;
  password: string;
};

const emptyForm: FormState = {
  code: "",
  name: "",
  type: "SQLSERVER",
  host: "",
  port: 1433,
  databaseName: "",
  oracleServiceName: "",
  oracleConnectionMode: "SERVICE_NAME",
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
    });
    setNotice("");
    setError("");
  }

  function resetForm(type: DataSourceType = "SQLSERVER") {
    setForm({
      ...emptyForm,
      type,
      port: type === "ORACLE" ? 1521 : type === "MYSQL" ? 3306 : type === "POSTGRESQL" ? 5432 : 1433,
      oracleConnectionMode: type === "ORACLE" ? "SERVICE_NAME" : null,
    });
    setError("");
    setNotice("");
  }

  function changeType(type: DataSourceType) {
    setForm((current) => ({
      ...current,
      type,
      port: type === "ORACLE" ? 1521 : type === "MYSQL" ? 3306 : type === "POSTGRESQL" ? 5432 : 1433,
      databaseName: type === "ORACLE" ? null : current.databaseName,
      oracleServiceName: type === "ORACLE" ? current.oracleServiceName : null,
      oracleConnectionMode: type === "ORACLE" ? (current.oracleConnectionMode ?? "SERVICE_NAME") : null,
      encryptConnection: type === "ORACLE" ? false : current.encryptConnection,
      trustServerCertificate: type === "ORACLE" ? true : current.trustServerCertificate,
    }));
  }

  const payload = () => ({
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    type: form.type,
    host: form.host.trim(),
    port: Number(form.port),
    databaseName: form.type === "ORACLE" ? null : (form.databaseName?.trim() || null),
    oracleServiceName: form.type === "ORACLE" ? (form.oracleServiceName?.trim() || null) : null,
    oracleConnectionMode: form.type === "ORACLE" ? form.oracleConnectionMode : null,
    username: form.username.trim(),
    ...(form.password ? { password: form.password } : {}),
    connectionTimeoutSec: Number(form.connectionTimeoutSec),
    queryTimeoutSec: Number(form.queryTimeoutSec),
    encryptConnection: form.type === "ORACLE" ? false : form.encryptConnection,
    trustServerCertificate: form.type === "ORACLE" ? true : form.trustServerCertificate,
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
        if (!form.password) {
          setError("新增資料來源時密碼必填。");
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
    try {
      let result: { ok: boolean; message: string; serverVersion?: string };

      if (form.id && !form.password) {
        result = await apiRequest(`/datasources/${form.id}/test`, { method: "POST" }, accessToken);
      } else {
        if (!form.password) {
          setError("測試尚未儲存的連線時必須輸入密碼。");
          return;
        }
        result = await apiRequest("/datasources/test", {
          method: "POST",
          body: JSON.stringify(payload()),
        }, accessToken);
      }

      setNotice(result.serverVersion ? `${result.message} ${result.serverVersion}` : result.message);
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
          <p className="subtitle">集中管理查詢設計可使用的 SQL Server、Oracle、MySQL 與 PostgreSQL 連線。</p>
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
                <span>{
                  row.type === "SQLSERVER" ? "SQL Server" :
                  row.type === "ORACLE" ? "Oracle" :
                  row.type === "MYSQL" ? "MySQL" : "PostgreSQL"
                }</span>
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
                </select>
              </label>
              <label>Port
                <input type="number" min={1} max={65535} value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
              </label>
            </div>

            <label>Host / IP
              <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </label>

            {form.type === "ORACLE" ? (
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

            <div className="form-grid two">
              <label>Username
                <input autoComplete="off" value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </label>
              <label>Password {form.id && <small>（留白則保留原密碼）</small>}
                <input type="password" autoComplete="new-password" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </label>
            </div>

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
