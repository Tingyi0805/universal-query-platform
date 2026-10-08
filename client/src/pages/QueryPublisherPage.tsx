import { useCallback, useEffect, useState, type ComponentType, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3, CalendarDays, ClipboardList, Database, FileSpreadsheet,
  Hospital, MessageSquare, Search, Table2, Users,
} from "lucide-react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { QueryAccessEditor } from "../components/QueryAccessEditor";
import { ReportColumnsEditor } from "../components/ReportColumnsEditor";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";
import "./QueryPublisherPage.css";

type Dataset = { id: number; code: string; name: string; isActive: boolean; isArchived: boolean };

type QueryCategory = {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  queryCount: number;
};

type QueryDefinition = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  categoryId: number | null;
  category: string | null;
  categorySortOrder: number;
  icon: string;
  datasetId: number;
  datasetName?: string;
  sortOrder: number;
  allowExcelExport: boolean;
  isPublished: boolean;
  isActive: boolean;
  isArchived: boolean;
  publishedAtUtc: string | null;
  archivedAtUtc: string | null;
  archivedByUserId: number | null;
  auditCount: number;
};

type FormState = {
  id?: number;
  code: string;
  name: string;
  description: string;
  categoryId: number | "";
  icon: string;
  datasetId: number | "";
  sortOrder: number;
  allowExcelExport: boolean;
  isActive: boolean;
  isPublished: boolean;
  isArchived: boolean;
  archivedAtUtc: string | null;
};

const emptyForm: FormState = {
  code: "",
  name: "",
  description: "",
  categoryId: "",
  icon: "Table2",
  datasetId: "",
  sortOrder: 0,
  allowExcelExport: true,
  isActive: true,
  isPublished: false,
  isArchived: false,
  archivedAtUtc: null,
};

const iconOptions: { key: string; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { key: "Table2", label: "資料表", icon: Table2 },
  { key: "Search", label: "搜尋", icon: Search },
  { key: "Users", label: "使用者", icon: Users },
  { key: "Hospital", label: "醫療", icon: Hospital },
  { key: "CalendarDays", label: "日期", icon: CalendarDays },
  { key: "ClipboardList", label: "清單", icon: ClipboardList },
  { key: "BarChart3", label: "統計", icon: BarChart3 },
  { key: "FileSpreadsheet", label: "報表", icon: FileSpreadsheet },
  { key: "Database", label: "資料庫", icon: Database },
  { key: "MessageSquare", label: "訊息", icon: MessageSquare },
];

export function QueryPublisherPage() {
  const { accessToken, hasPermission } = useAuth();
  const [queries, setQueries] = useState<QueryDefinition[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [categories, setCategories] = useState<QueryCategory[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<QueryCategory | null>(null);
  const [newCategory, setNewCategory] = useState({ code: "", name: "", sortOrder: 0, isActive: true });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  const [queryFilter, setQueryFilter] = useState<"PUBLISHED" | "DRAFT" | "ARCHIVED">("PUBLISHED");
  const canPublish = hasPermission("PUBLISH_QUERY");
  const canManageAccess = hasPermission("MANAGE_USERS");
  const selectedIcon = iconOptions.find((item) => item.key === form.icon) ?? iconOptions[0];
  const selectedQuery = form.id ? queries.find((query) => query.id === form.id) ?? null : null;
  const filteredQueries = queries.filter((query) =>
    queryFilter === "ARCHIVED"
      ? query.isArchived
      : queryFilter === "PUBLISHED"
        ? !query.isArchived && query.isPublished
        : !query.isArchived && !query.isPublished
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [queryResult, datasetResult, categoryResult] = await Promise.all([
        apiRequest<{ queryDefinitions: QueryDefinition[] }>("/query-definitions", {}, accessToken),
        apiRequest<{ datasets: Dataset[] }>("/datasets", {}, accessToken),
        apiRequest<{ categories: QueryCategory[] }>("/query-categories", {}, accessToken),
      ]);
      setQueries(queryResult.queryDefinitions);
      setDatasets(datasetResult.datasets);
      setCategories(categoryResult.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Query Definition 失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  function applyQueryToForm(query: QueryDefinition) {
    setForm({
      id: query.id,
      code: query.code,
      name: query.name,
      description: query.description ?? "",
      categoryId: query.categoryId ?? "",
      icon: query.icon,
      datasetId: query.datasetId,
      sortOrder: query.sortOrder,
      allowExcelExport: query.allowExcelExport,
      isActive: query.isActive,
      isPublished: query.isPublished,
      isArchived: query.isArchived,
      archivedAtUtc: query.archivedAtUtc,
    });
  }

  function selectQuery(query: QueryDefinition) {
    applyQueryToForm(query);
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
    categoryId: form.categoryId === "" ? null : Number(form.categoryId),
    icon: form.icon,
    datasetId: Number(form.datasetId),
    sortOrder: Number(form.sortOrder),
    allowExcelExport: form.allowExcelExport,
    isActive: form.isActive,
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (form.isArchived) {
      setError("此 Query 已封存，請先還原後再修改。");
      return;
    }
    setError("");
    setNotice("");
    try {
      if (!form.datasetId) {
        setError("請選擇 Dataset。");
        return;
      }

      if (form.id) {
        const result = await apiRequest<{
          status: string;
          queryDefinition: QueryDefinition;
        }>(`/query-definitions/${form.id}`, {
          method: "PUT",
          body: JSON.stringify(payload()),
        }, accessToken);
        if (result.queryDefinition) applyQueryToForm(result.queryDefinition);
        setNotice(result.queryDefinition?.isPublished
          ? "Query Definition 已更新，發佈狀態維持不變。"
          : "Query Definition 已更新；若內容有變更，需重新發佈。");
      } else {
        const result = await apiRequest<{ id: number }>("/query-definitions", {
          method: "POST",
          body: JSON.stringify(payload()),
        }, accessToken);
        setForm((current) => ({ ...current, id: result.id }));
        setNotice("Query Definition 已建立。");
      }

      await load();
      setVersionRefreshKey((current) => current + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Query Definition 失敗。");
    }
  }

  async function setPublished(published: boolean) {
    if (!form.id) return;
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{
        status: string;
        queryDefinition: QueryDefinition;
      }>(`/query-definitions/${form.id}/${published ? "publish" : "unpublish"}`, {
        method: "POST",
      }, accessToken);

      if (result.queryDefinition) applyQueryToForm(result.queryDefinition);
      setNotice(result.queryDefinition?.isPublished ? "Query 已發佈。" : "Query 已取消發佈。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "發佈狀態更新失敗。");
    }
  }

  async function archiveSelected() {
    if (!form.id) return;
    if (!window.confirm(`確定封存 Query「${form.name}」？封存後不會出現在使用者查詢 Portal，但 Audit 歷史會保留。`)) return;

    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{
        status: string;
        queryDefinition: QueryDefinition;
      }>(`/query-definitions/${form.id}/archive`, { method: "POST" }, accessToken);

      if (result.queryDefinition) applyQueryToForm(result.queryDefinition);
      setQueryFilter("ARCHIVED");
      setNotice("Query 已封存，Audit 歷史已保留。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "封存 Query 失敗。");
    }
  }

  async function restoreSelected() {
    if (!form.id) return;
    if (!window.confirm(`確定還原 Query「${form.name}」？還原後會回到 Draft，需重新啟用並發佈。`)) return;

    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{
        status: string;
        queryDefinition: QueryDefinition;
      }>(`/query-definitions/${form.id}/restore`, { method: "POST" }, accessToken);

      if (result.queryDefinition) applyQueryToForm(result.queryDefinition);
      setQueryFilter("DRAFT");
      setNotice("Query 已還原為 Draft，請確認設定後重新啟用與發佈。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "還原 Query 失敗。");
    }
  }

  async function createCategory() {
    setError("");
    try {
      await apiRequest("/query-categories", {
        method: "POST",
        body: JSON.stringify({
          code: newCategory.code.trim().toUpperCase(),
          name: newCategory.name.trim(),
          sortOrder: Number(newCategory.sortOrder),
          isActive: newCategory.isActive,
        }),
      }, accessToken);
      setNewCategory({ code: "", name: "", sortOrder: 0, isActive: true });
      setNotice("分類已新增。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增分類失敗。");
    }
  }

  async function updateCategory() {
    if (!categoryDraft) return;
    setError("");
    try {
      await apiRequest(`/query-categories/${categoryDraft.id}`, {
        method: "PUT",
        body: JSON.stringify({
          code: categoryDraft.code.trim().toUpperCase(),
          name: categoryDraft.name.trim(),
          sortOrder: Number(categoryDraft.sortOrder),
          isActive: categoryDraft.isActive,
        }),
      }, accessToken);
      setCategoryDraft(null);
      setNotice("分類已更新。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新分類失敗。");
    }
  }

  async function removeCategory(category: QueryCategory) {
    setError("");
    if (category.queryCount > 0) {
      setError(`分類「${category.name}」仍有 ${category.queryCount} 個 Query 使用，請先將 Query 移到其他分類。`);
      return;
    }
    if (!window.confirm(`確定刪除分類「${category.name}」？`)) return;

    try {
      await apiRequest(`/query-categories/${category.id}`, { method: "DELETE" }, accessToken);
      if (form.categoryId === category.id) {
        setForm((current) => ({ ...current, categoryId: "" }));
      }
      setNotice("分類已刪除。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除分類失敗。");
    }
  }

  const SelectedIcon = selectedIcon.icon;

  async function remove() {
    if (!form.id) return;
    setError("");
    setNotice("");

    try {
      const impact = await apiRequest<{ canDelete: boolean; auditCount: number }>(
        `/query-definitions/${form.id}/delete-impact`,
        {},
        accessToken,
      );

      if (!impact.canDelete) {
        setError(
          `Query「${form.name}」已有 ${impact.auditCount} 筆 Audit 歷史，不能永久刪除，請改用「封存」。`,
        );
        return;
      }

      if (!window.confirm(`確定永久刪除 Query「${form.name}」？此操作無法復原。`)) return;

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
          <p className="subtitle">把 Dataset 包裝成使用者可看到的查詢 Icon，並控制發佈與權限。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      {showCategoryManager && (
        <section className="category-manager">
          <div className="section-title">
            <div>
              <h2>分類管理</h2>
              <p className="field-hint">可新增、修改、排序、停用與刪除分類；仍有 Query 使用的分類不可刪除。</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowCategoryManager(false)}>關閉</button>
          </div>

          <div className="category-create-grid">
            <label>代碼
              <input
                value={newCategory.code}
                placeholder="例如 PATIENT"
                onChange={(e) => setNewCategory({ ...newCategory, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label>名稱
              <input
                value={newCategory.name}
                placeholder="例如 病患資料"
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
              />
            </label>
            <label>排序
              <input
                type="number"
                value={newCategory.sortOrder}
                onChange={(e) => setNewCategory({ ...newCategory, sortOrder: Number(e.target.value) })}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!newCategory.code.trim() || !newCategory.name.trim()}
              onClick={() => void createCategory()}
            >
              ＋新增分類
            </button>
          </div>

          <div className="category-table">
            {categories.map((category) => {
              const editing = categoryDraft?.id === category.id;
              const current = editing ? categoryDraft : category;
              return (
                <div className="category-row" key={category.id}>
                  <input
                    value={current?.code ?? ""}
                    disabled={!editing}
                    onChange={(e) => categoryDraft && setCategoryDraft({ ...categoryDraft, code: e.target.value.toUpperCase() })}
                  />
                  <input
                    value={current?.name ?? ""}
                    disabled={!editing}
                    onChange={(e) => categoryDraft && setCategoryDraft({ ...categoryDraft, name: e.target.value })}
                  />
                  <input
                    type="number"
                    value={current?.sortOrder ?? 0}
                    disabled={!editing}
                    onChange={(e) => categoryDraft && setCategoryDraft({ ...categoryDraft, sortOrder: Number(e.target.value) })}
                  />
                  <label className="category-active-check">
                    <input
                      type="checkbox"
                      checked={Boolean(current?.isActive)}
                      disabled={!editing}
                      onChange={(e) => categoryDraft && setCategoryDraft({ ...categoryDraft, isActive: e.target.checked })}
                    />
                    啟用
                  </label>
                  <span className="category-use-count">{category.queryCount} 個 Query</span>
                  <div className="category-actions">
                    {editing ? (
                      <>
                        <button className="primary-button" type="button" onClick={() => void updateCategory()}>儲存</button>
                        <button className="secondary-button" type="button" onClick={() => setCategoryDraft(null)}>取消</button>
                      </>
                    ) : (
                      <>
                        <button className="secondary-button" type="button" onClick={() => setCategoryDraft({ ...category })}>修改</button>
                        <button
                          className="danger-button"
                          type="button"
                          disabled={category.queryCount > 0}
                          onClick={() => void removeCategory(category)}
                        >
                          刪除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {categories.length === 0 && <div className="notice">尚未建立分類。</div>}
          </div>
        </section>
      )}

      <div className="publisher-layout">
        <aside className="query-list">
          <div className="section-title">
            <h2>Queries</h2>
            <button className="secondary-button" type="button" onClick={() => { setQueryFilter("DRAFT"); reset(); }}>＋新增</button>
          </div>

          <div className="query-status-filter" role="tablist" aria-label="Query 狀態">
            <button type="button" className={queryFilter === "PUBLISHED" ? "active" : ""}
              onClick={() => { setQueryFilter("PUBLISHED"); reset(); }}>
              已發佈 <span>{queries.filter((q) => !q.isArchived && q.isPublished).length}</span>
            </button>
            <button type="button" className={queryFilter === "DRAFT" ? "active" : ""}
              onClick={() => { setQueryFilter("DRAFT"); reset(); }}>
              草稿 <span>{queries.filter((q) => !q.isArchived && !q.isPublished).length}</span>
            </button>
            <button type="button" className={queryFilter === "ARCHIVED" ? "active" : ""}
              onClick={() => { setQueryFilter("ARCHIVED"); reset(); }}>
              已封存 <span>{queries.filter((q) => q.isArchived).length}</span>
            </button>
          </div>

          {loading ? <div className="notice">載入中…</div> : filteredQueries.map((query) => (
            <button className={`query-list-item ${form.id === query.id ? "selected" : ""}`}
              type="button" key={query.id} onClick={() => selectQuery(query)}>
              <strong>{query.name}</strong>
              <small>{query.code}</small>
              <span>
                {query.category || "未分類"} · {query.isArchived ? "已封存" : query.isPublished ? "已發佈" : "草稿"}
                {query.auditCount > 0 ? ` · Audit ${query.auditCount}` : ""}
              </span>
            </button>
          ))}
        </aside>

        <section className="publisher-editor">
          <form className={form.isArchived ? "archived-form" : ""} onSubmit={save}>
            <div className="section-title">
              <h2>{form.id ? "編輯 Query" : "新增 Query"}</h2>
              <span className={form.isArchived ? "publish-badge archived" : form.isPublished ? "publish-badge live" : "publish-badge"}>
                {form.isArchived ? "Archived" : form.isPublished ? "Published" : "Draft"}
              </span>
            </div>

            {form.isArchived && (
              <div className="archive-notice">
                此 Query 已封存，只供查閱。{form.archivedAtUtc ? `封存時間：${new Date(form.archivedAtUtc).toLocaleString("zh-TW")}` : ""}
              </div>
            )}

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
              <div className="category-select-field">
                <span className="field-label">分類</span>
                <div className="category-select-row">
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : "" })}
                  >
                    <option value="">未分類</option>
                    {categories
                      .filter((category) => category.isActive || category.id === form.categoryId)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}{category.isActive ? "" : "（已停用）"}
                        </option>
                      ))}
                  </select>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setShowCategoryManager((current) => !current)}
                  >
                    分類管理
                  </button>
                </div>
              </div>
              <div className="icon-picker-field">
                <span className="field-label">Icon</span>
                <div className="icon-picker" role="radiogroup" aria-label="查詢圖示">
                  {iconOptions.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      className={`icon-option ${form.icon === key ? "selected" : ""}`}
                      aria-pressed={form.icon === key}
                      onClick={() => setForm({ ...form, icon: key })}
                    >
                      <Icon size={22} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="query-home-preview">
              <span className="field-label">首頁預覽</span>
              <div className="query-home-preview-card">
                <div className="query-home-preview-icon"><SelectedIcon size={26} /></div>
                <strong>{form.name.trim() || "查詢名稱"}</strong>
                <p>{form.description.trim() || form.code.trim() || "查詢說明"}</p>
              </div>
            </div>

            <div className="form-grid two">
              <label>Dataset
                <select value={form.datasetId}
                  onChange={(e) => setForm({ ...form, datasetId: e.target.value ? Number(e.target.value) : "" })}>
                  <option value="">請選擇</option>
                  {datasets
                    .filter((dataset) =>
                      (!dataset.isArchived && dataset.isActive) || dataset.id === form.datasetId
                    )
                    .map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.name} ({dataset.code})
                        {dataset.isArchived ? "（已封存）" : dataset.isActive ? "" : "（已停用）"}
                      </option>
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
                onChange={(e) => setForm({ ...form, allowExcelExport: e.target.checked })} />允許匯出（Excel / CSV）</label>
              <label><input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />啟用 Query</label>
            </div>

            <div className="form-actions">
              {!form.isArchived && <button className="primary-button" type="submit">儲存</button>}
              {form.id && !form.isArchived && canPublish && (
                <button className="secondary-button" type="button" onClick={() => void setPublished(!form.isPublished)}>
                  {form.isPublished ? "取消發佈" : "發佈"}
                </button>
              )}
              {form.id && !form.isArchived && (
                <button className="secondary-button" type="button" onClick={() => void archiveSelected()}>封存</button>
              )}
              {form.id && !form.isArchived && (selectedQuery?.auditCount ?? 0) === 0 && (
                <button className="danger-button" type="button" onClick={() => void remove()}>永久刪除</button>
              )}
              {form.id && form.isArchived && (
                <button className="primary-button" type="button" onClick={() => void restoreSelected()}>還原為 Draft</button>
              )}
            </div>
          </form>

          {form.id && (
            <VersionHistoryPanel
              basePath={`/query-definitions/${form.id}`}
              entityLabel={`Query「${form.name}」`}
              refreshKey={versionRefreshKey}
              disabled={form.isArchived}
              onRestored={async () => {
                const result = await apiRequest<{ queryDefinition: QueryDefinition }>(
                  `/query-definitions/${form.id}`,
                  {},
                  accessToken,
                );
                applyQueryToForm(result.queryDefinition);
                setQueryFilter("DRAFT");
                setVersionRefreshKey((current) => current + 1);
                await load();
              }}
            />
          )}

          {form.id && !form.isArchived && (
            <ReportColumnsEditor
              queryId={form.id}
              onChanged={() => setVersionRefreshKey((current) => current + 1)}
            />
          )}
          {form.id && !form.isArchived && canManageAccess && <QueryAccessEditor queryId={form.id} />}
        </section>
      </div>
    </main>
  );
}
