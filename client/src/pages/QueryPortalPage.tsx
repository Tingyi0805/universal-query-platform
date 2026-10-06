import {
  BarChart3, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Database,
  FileSpreadsheet, Hospital, MessageSquare, Search, Table2, Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./QueryPortalPage.css";

type QueryItem = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string;
  sortOrder: number;
  canView: boolean;
  canExecute: boolean;
  canExport: boolean;
};

const icons: Record<string, ComponentType<{ size?: number }>> = {
  Table2, Search, Users, Hospital, CalendarDays, ClipboardList,
  BarChart3, FileSpreadsheet, Database, MessageSquare,
};

const ALL_CATEGORIES = "__ALL__";

export function QueryPortalPage() {
  const { accessToken } = useAuth();
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ queries: QueryItem[] }>("/queries", {}, accessToken);
      setQueries(result.queries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入查詢功能失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const query of queries) {
      const category = query.category?.trim() || "其他";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-Hant"));
  }, [queries]);

  const filteredQueries = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase();

    return queries.filter((query) => {
      const category = query.category?.trim() || "其他";
      if (selectedCategory !== ALL_CATEGORIES && category !== selectedCategory) return false;
      if (!keyword) return true;

      return [
        query.name,
        query.code,
        query.description ?? "",
        category,
      ].some((value) => value.toLocaleLowerCase().includes(keyword));
    });
  }, [queries, searchText, selectedCategory]);

  const groups = useMemo(() => {
    const map = new Map<string, QueryItem[]>();
    for (const query of filteredQueries) {
      const category = query.category?.trim() || "其他";
      map.set(category, [...(map.get(category) ?? []), query]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-Hant"));
  }, [filteredQueries]);

  function toggleCategory(category: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function clearFilters() {
    setSearchText("");
    setSelectedCategory(ALL_CATEGORIES);
  }

  return (
    <main className="page-shell">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Query Portal</p>
          <h1>資料查詢</h1>
          <p className="subtitle">僅顯示目前帳號已被授權且已發佈的查詢功能。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}
      {loading && <section className="notice">載入中…</section>}

      {!loading && queries.length > 0 && (
        <section className="query-portal-tools" aria-label="查詢篩選">
          <div className="query-search-box">
            <Search size={20} aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              placeholder="搜尋查詢名稱、代碼、說明或分類"
              aria-label="搜尋查詢功能"
              onChange={(e) => setSearchText(e.target.value)}
            />
            {searchText && (
              <button type="button" onClick={() => setSearchText("")}>清除</button>
            )}
          </div>

          <div className="query-category-filter" aria-label="分類篩選">
            <button
              type="button"
              className={selectedCategory === ALL_CATEGORIES ? "active" : ""}
              onClick={() => setSelectedCategory(ALL_CATEGORIES)}
            >
              全部 <span>{queries.length}</span>
            </button>
            {categories.map(([category, count]) => (
              <button
                type="button"
                key={category}
                className={selectedCategory === category ? "active" : ""}
                onClick={() => setSelectedCategory(category)}
              >
                {category} <span>{count}</span>
              </button>
            ))}
          </div>

          <div className="query-result-summary">
            顯示 {filteredQueries.length} / {queries.length} 個查詢
          </div>
        </section>
      )}

      {!loading && groups.map(([category, items]) => {
        const collapsed = collapsedCategories.has(category);
        return (
          <section className="query-category" key={category}>
            <button
              type="button"
              className="query-category-heading"
              aria-expanded={!collapsed}
              onClick={() => toggleCategory(category)}
            >
              <span className="query-category-title">
                {collapsed ? <ChevronRight size={21} /> : <ChevronDown size={21} />}
                <strong>{category}</strong>
              </span>
              <span className="query-category-count">{items.length} 個查詢</span>
            </button>

            {!collapsed && (
              <div className="query-icon-grid">
                {items.map((query) => {
                  const Icon = icons[query.icon] ?? Table2;
                  return (
                    <Link className="query-icon-card" to={`/queries/${query.id}`} key={query.id}>
                      <div className="query-icon"><Icon size={28} /></div>
                      <strong>{query.name}</strong>
                      <p>{query.description || query.code}</p>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {!loading && queries.length > 0 && filteredQueries.length === 0 && (
        <section className="empty-portal">
          <strong>找不到符合條件的查詢。</strong>
          <p>可以更換搜尋文字或分類。</p>
          <button className="secondary-button" type="button" onClick={clearFilters}>清除篩選</button>
        </section>
      )}

      {!loading && queries.length === 0 && (
        <section className="empty-portal">
          目前沒有已授權的查詢功能。
        </section>
      )}
    </main>
  );
}
