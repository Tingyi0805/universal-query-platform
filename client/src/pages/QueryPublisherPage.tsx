import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { QueryAccessEditor } from "../components/QueryAccessEditor";
import { ReportColumnsEditor } from "../components/ReportColumnsEditor";
import "./QueryPublisherPage.css";

type Dataset = { id: number; code: string; name: string; isActive: boolean };

type QueryDefinition = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string;
  datasetId: number;
  datasetName?: string;
  sortOrder: number;
  allowExcelExport: boolean;
  isPublished: boolean;
  isActive: boolean;
  publishedAtUtc: string | null;
};

type FormState = {
  id?: number;
  code: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  datasetId: number | "";
  sortOrder: number;
  allowExcelExport: boolean;
  isActive: boolean;
  isPublished: boolean;
};

const emptyForm: FormState = {
  code: "",
  name: "",
  description: "",
  category: "",
  icon: "Table2",
  datasetId: "",
  sortOrder: 0,
  allowExcelExport: true,
  isActive: true,
  isPublished: false,
};

const iconOptions = ["Table2","Search","Users","Hospital","CalendarDays","ClipboardList","BarChart3","FileSpreadsheet","Database","MessageSquare"];

export function QueryPublisherPage() {
  const { accessToken, hasPermission } = useAuth();
  const [queries, setQueries] = useState<QueryDefinition[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const canPublish = hasPermission("PUBLISH_QUERY");
  const canManageAccess = hasPermission("MANAGE_USERS");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [queryResult, datasetResult] = await Promise.all([
        apiRequest<{ queryDefinitions: QueryDefinition[] }>("/query-definitions", {}, accessToken),
        apiRequest<{ datasets: Dataset[] }>("/datasets", {}, accessToken),
      ]);
      setQueries(queryResult.queryDefinitions);
      setDatasets(datasetResult.datasets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Query Definition 失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  function selectQuery(query: QueryDefinition) {
    setForm({
      id: query.id,
      code: query.code,
      name: query.name,
      description: query.description ?? "",
      category: query.category ?? "",
      icon: query.icon,
      datasetId: query.datasetId,
      sortOrder: query.sortOrder,
      allowExcelExport: query.allowExcelExport,
      isActive: query.isActive,
      isPublished: query.isPublished,
    });
    setError("");
    setNotice("");
  }

  function reset() {
    setForm(emptyForm);
    setError("");
    setNotice("");
  }

  const payload = () => ({
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category.trim() || null,
    icon: form.icon,
    datasetId: Number(form.datasetId),
    sortOrder: Number(form.sortOrder),
    allowExcelExport: form.allowExcelExport,
    isActive: form.isActive,
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      if (!form.datasetId) {
        setError("請選擇 Dataset。");
        return;
      }

      if (form.id) {
        await apiRequest(`/query-definitions/${form.id}`, {
          method: "PUT",
          body: JSON.stringify(payload()),
        }, accessToken);
        setNotice("Query Definition 已更新。");
      } else {
        const result = await apiRequest<{ id: number }>("/query-definitions", {
          method: "POST",
          body: JSON.stringify(payload()),
        }, accessToken);
        setForm((current) => ({ ...current, id: result.id }));
        setNotice("Query Definition 已建立。");
      }

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Query Definition 失敗。");
    }
  }

  async function setPublished(published: boolean) {
    if (!form.id) return;
    setError("");
    setNotice("");
    try {
      await apiRequest(`/query-definitions/${form.id}/${published ? "publish" : "unpublish"}`, {
        method: "POST",
      }, accessToken);
      setForm((current) => ({ ...current, isPublished: published }));
      setNotice(published ? "Query 已發布。" : "Query 已取消發布。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "發布狀態更新失敗。");
    }
  }

  async function remove() {
    if (!form.id || !window.confirm(`確定刪除 Query「${form.name}」？`)) return;
    setError("");
    try {
      await apiRequest(`/query-definitions/${form.id}`, { method: "DELETE" }, accessToken);
      reset();
      setNotice("Query Definition 已刪除。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除 Query Definition 失敗。");
    }
  }

  return (
    <main className="page-shell publisher-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Publish</p>
          <h1>Query Publisher</h1>
          <p className="subtitle">把 Dataset 包裝成使用者可看到的查詢 Icon，並控制發布與權限。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      <div className="publisher-layout">
        <aside className="query-list">
          <div className="section-title">
            <h2>Queries</h2>
            <button className="secondary-button" type="button" onClick={reset}>＋新增</button>
          </div>

          {loading ? <div className="notice">載入中…</div> : queries.map((query) => (
            <button className={`query-list-item ${form.id === query.id ? "selected" : ""}`}
              type="button" key={query.id} onClick={() => selectQuery(query)}>
              <strong>{query.name}</strong>
              <small>{query.code}</small>
              <span>{query.category || "未分類"} · {query.isPublished ? "已發布" : "草稿"}</span>
            </button>
          ))}
        </aside>

        <section className="publisher-editor">
          <form onSubmit={save}>
            <div className="section-title">
              <h2>{form.id ? "編輯 Query" : "新增 Query"}</h2>
              <span className={form.isPublished ? "publish-badge live" : "publish-badge"}>{form.isPublished ? "Published" : "Draft"}</span>
            </div>

            <div className="form-grid two">
              <label>代碼
                <input value={form.code} disabled={Boolean(form.id)}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </label>
              <label>名稱
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
            </div>

            <label>說明
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>

            <div className="form-grid two">
              <label>分類
                <input value={form.category} placeholder="例如：HIS、PACS、行政"
                  onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </label>
              <label>Icon
                <select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                  {iconOptions.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                </select>
              </label>
            </div>

            <div className="form-grid two">
              <label>Dataset
                <select value={form.datasetId}
                  onChange={(e) => setForm({ ...form, datasetId: e.target.value ? Number(e.target.value) : "" })}>
                  <option value="">請選擇</option>
                  {datasets.filter((dataset) => dataset.isActive).map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{dataset.name} ({dataset.code})</option>
                  ))}
                </select>
              </label>
              <label>排序
                <input type="number" value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
              </label>
            </div>

            <div className="check-row">
              <label><input type="checkbox" checked={form.allowExcelExport}
                onChange={(e) => setForm({ ...form, allowExcelExport: e.target.checked })} />允許 Excel 匯出</label>
              <label><input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />啟用 Query</label>
            </div>

            <div className="form-actions">
              <button className="primary-button" type="submit">儲存</button>
              {form.id && canPublish && (
                <button className="secondary-button" type="button" onClick={() => void setPublished(!form.isPublished)}>
                  {form.isPublished ? "取消發布" : "發布"}
                </button>
              )}
              {form.id && (
                <button className="danger-button" type="button" onClick={() => void remove()}>刪除</button>
              )}
            </div>
          </form>

          {form.id && <ReportColumnsEditor queryId={form.id} />}
          {form.id && canManageAccess && <QueryAccessEditor queryId={form.id} />}
        </section>
      </div>
    </main>
  );
}
