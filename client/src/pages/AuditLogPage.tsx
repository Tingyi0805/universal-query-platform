import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AuditLogPage.css";

type AuditRow = {
  id: number;
  eventType: string;
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
      if (username.trim()) search.set("username", username.trim());

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
  }, [accessToken, eventType, page, username]);

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
          <p className="subtitle">查詢與 Excel 匯出的稽核紀錄。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      <form className="audit-filter" onSubmit={search}>
        <label>事件
          <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">全部</option>
            <option value="QUERY_EXECUTE">QUERY_EXECUTE</option>
            <option value="QUERY_EXPORT_EXCEL">QUERY_EXPORT_EXCEL</option>
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
