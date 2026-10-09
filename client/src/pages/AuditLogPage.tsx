import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AuditLogPage.css";

type AuditRow = {
  id: number;
  eventType: string;
  eventCategory: "SECURITY" | "CONFIG" | "USAGE" | "SYSTEM";
  isImportant: boolean;
  status: string;
  parametersJson: string | null;
  rowCount: number | null;
  durationMs: number | null;
  ipAddress: string | null;
  errorCode: string | null;
  createdAtUtc: string;
  completedAtUtc: string | null;
  username: string | null;
  displayName: string | null;
  queryCode: string | null;
  queryName: string | null;
};

export function AuditLogPage() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState("");
  const [username, setUsername] = useState("");
  const [eventCategory, setEventCategory] = useState("");
  const [source, setSource] = useState<"LIVE" | "ARCHIVE">("LIVE");
  const [error, setError] = useState("");
  const pageSize = 50;

  const load = useCallback(async (targetPage = page) => {
    setError("");
    try {
      const search = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(pageSize),
      });
      if (eventType.trim()) search.set("eventType", eventType.trim());
      if (eventCategory) search.set("eventCategory", eventCategory);
      if (username.trim()) search.set("username", username.trim());
      search.set("source", source);

      const result = await apiRequest<{ items: AuditRow[]; total: number }>(
        `/audit?${search.toString()}`,
        {},
        accessToken,
      );
      setItems(result.items);
      setTotal(result.total);
      setPage(targetPage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Audit Log 失敗。");
    }
  }, [accessToken, eventCategory, eventType, page, source, username]);

  useEffect(() => { void load(1); }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    void load(1);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="page-shell audit-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Audit</p>
          <h1>Audit Log</h1>
          <p className="subtitle">查詢線上與封存 Audit Log，支援事件分類與重要紀錄識別。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      <form className="audit-filter" onSubmit={search}>
        <label>資料區
          <select value={source} onChange={(e) => setSource(e.target.value as "LIVE" | "ARCHIVE")}>
            <option value="LIVE">線上 Audit</option>
            <option value="ARCHIVE">Archive</option>
          </select>
        </label>
        <label>分類
          <select value={eventCategory} onChange={(e) => setEventCategory(e.target.value)}>
            <option value="">全部</option>
            <option value="SECURITY">SECURITY</option>
            <option value="CONFIG">CONFIG</option>
            <option value="USAGE">USAGE</option>
            <option value="SYSTEM">SYSTEM</option>
          </select>
        </label>
        <label>事件
          <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">全部</option>
            <optgroup label="登入 / 帳號">
              <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
              <option value="LOGIN_FAILED">LOGIN_FAILED</option>
              <option value="USER_CREATED">USER_CREATED</option>
              <option value="USER_UPDATED">USER_UPDATED</option>
              <option value="USER_DELETED">USER_DELETED</option>
              <option value="USER_PASSWORD_RESET">USER_PASSWORD_RESET</option>
              <option value="USER_PASSWORD_CHANGED">USER_PASSWORD_CHANGED</option>
              <option value="USER_PASSWORD_CHANGE_FAILED">USER_PASSWORD_CHANGE_FAILED</option>
              <option value="ROLE_CREATED">ROLE_CREATED</option>
              <option value="ROLE_UPDATED">ROLE_UPDATED</option>
            </optgroup>
            <optgroup label="DataSource">
              <option value="DATASOURCE_CREATED">DATASOURCE_CREATED</option>
              <option value="DATASOURCE_UPDATED">DATASOURCE_UPDATED</option>
              <option value="DATASOURCE_DELETED">DATASOURCE_DELETED</option>
            </optgroup>
            <optgroup label="Dataset / Version">
              <option value="DATASET_ARCHIVED">DATASET_ARCHIVED</option>
              <option value="DATASET_RESTORED">DATASET_RESTORED</option>
              <option value="DATASET_VERSION_RESTORED">DATASET_VERSION_RESTORED</option>
              <option value="VERSION_DATASET_PIN_CHANGED">VERSION_DATASET_PIN_CHANGED</option>
            </optgroup>
            <optgroup label="Query">
              <option value="QUERY_EXECUTE">QUERY_EXECUTE</option>
              <option value="QUERY_EXPORT_EXCEL">QUERY_EXPORT_EXCEL</option>
              <option value="QUERY_EXPORT_CSV">QUERY_EXPORT_CSV</option>
              <option value="QUERY_PUBLISHED">QUERY_PUBLISHED</option>
              <option value="QUERY_UNPUBLISHED">QUERY_UNPUBLISHED</option>
              <option value="QUERY_ARCHIVED">QUERY_ARCHIVED</option>
              <option value="QUERY_RESTORED">QUERY_RESTORED</option>
              <option value="QUERY_VERSION_RESTORED">QUERY_VERSION_RESTORED</option>
              <option value="QUERY_ACCESS_UPDATED">QUERY_ACCESS_UPDATED</option>
              <option value="VERSION_QUERY_PIN_CHANGED">VERSION_QUERY_PIN_CHANGED</option>
            </optgroup>
            <optgroup label="系統治理">
              <option value="SETTING_BRANDING_UPDATED">SETTING_BRANDING_UPDATED</option>
              <option value="SETTING_VERSION_RETENTION_UPDATED">SETTING_VERSION_RETENTION_UPDATED</option>
              <option value="SETTING_AUDIT_RETENTION_UPDATED">SETTING_AUDIT_RETENTION_UPDATED</option>
              <option value="VERSION_CLEANUP_EXECUTED">VERSION_CLEANUP_EXECUTED</option>
              <option value="AUDIT_ARCHIVE_EXECUTED">AUDIT_ARCHIVE_EXECUTED</option>
              <option value="AUDIT_ARCHIVE_CLEANUP_EXECUTED">AUDIT_ARCHIVE_CLEANUP_EXECUTED</option>
            </optgroup>
          </select>
        </label>
        <label>帳號
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
        </label>
        <button className="primary-button" type="submit">查詢</button>
      </form>

      {error && <section className="form-error">{error}</section>}

      <section className="audit-table-card">
        <div className="audit-table-wrap">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>使用者</th>
                <th>分類</th>
                <th>事件</th>
                <th>Query</th>
                <th>狀態</th>
                <th>筆數</th>
                <th>耗時</th>
                <th>IP</th>
                <th>條件</th>
                <th>錯誤</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAtUtc).toLocaleString()}</td>
                  <td>{item.displayName || item.username || "—"}<small>{item.username}</small></td>
                  <td>
                    <span>{item.eventCategory}</span>
                    {item.isImportant && <small>重要</small>}
                  </td>
                  <td>{item.eventType}</td>
                  <td>{item.queryName || item.queryCode || "—"}<small>{item.queryCode}</small></td>
                  <td><span className={`audit-status ${item.status.toLowerCase()}`}>{item.status}</span></td>
                  <td>{item.rowCount ?? "—"}</td>
                  <td>{item.durationMs == null ? "—" : `${item.durationMs} ms`}</td>
                  <td>{item.ipAddress || "—"}</td>
                  <td><code>{item.parametersJson || "{}"}</code></td>
                  <td>{item.errorCode || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="audit-pagination">
          <span>共 {total} 筆 · 第 {page}/{pageCount} 頁</span>
          <div>
            <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => void load(page - 1)}>上一頁</button>
            <button className="secondary-button" type="button" disabled={page >= pageCount} onClick={() => void load(page + 1)}>下一頁</button>
          </div>
        </div>
      </section>
    </main>
  );
}
