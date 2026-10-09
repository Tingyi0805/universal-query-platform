import {
  BarChart3, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Database,
  Clock3, FileSpreadsheet, Hospital, MessageSquare, Search, Star, Table2, Users,
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
  categorySortOrder: number;
  icon: string;
  sortOrder: number;
  canView: boolean;
  canExecute: boolean;
  canExport: boolean;
  isFavorite: boolean;
  lastUsedAtUtc: string | null;
};

const icons: Record<string, ComponentType<{ size?: number }>> = {
  Table2, Search, Users, Hospital, CalendarDays, ClipboardList,
  BarChart3, FileSpreadsheet, Database, MessageSquare,
};

const ALL_CATEGORIES = "__ALL__";
const FAVORITE_CATEGORY = "__FAVORITES__";
const RECENT_CATEGORY = "__RECENT__";
const FAVORITE_PREVIEW_COUNT = 8;
const RECENT_PREVIEW_COUNT = 8;

export function QueryPortalPage() {
  const { accessToken } = useAuth();
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [favoriteUpdating, setFavoriteUpdating] = useState<Set<number>>(new Set());
  const [showAllFavorites, setShowAllFavorites] = useState(false);

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
    return [...counts.entries()].sort(([a], [b]) => {
      const aOrder = Math.min(...queries.filter((query) => (query.category?.trim() || "其他") === a).map((query) => query.categorySortOrder));
      const bOrder = Math.min(...queries.filter((query) => (query.category?.trim() || "其他") === b).map((query) => query.categorySortOrder));
      return aOrder - bOrder || a.localeCompare(b, "zh-Hant");
    });
  }, [queries]);

  const filteredQueries = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase();

    return queries.filter((query) => {
      const category = query.category?.trim() || "其他";

      if (selectedCategory === FAVORITE_CATEGORY && !query.isFavorite) return false;
      if (selectedCategory === RECENT_CATEGORY && !query.lastUsedAtUtc) return false;
      if (
        selectedCategory !== ALL_CATEGORIES &&
        selectedCategory !== FAVORITE_CATEGORY &&
        selectedCategory !== RECENT_CATEGORY &&
        category !== selectedCategory
      ) {
        return false;
      }

      if (!keyword) return true;

      return [
        query.name,
        query.code,
        query.description ?? "",
        category,
      ].some((value) => value.toLocaleLowerCase().includes(keyword));
    });
  }, [queries, searchText, selectedCategory]);

  const favoriteCount = useMemo(
    () => queries.filter((query) => query.isFavorite).length,
    [queries],
  );

  const recentCount = useMemo(
    () => queries.filter((query) => Boolean(query.lastUsedAtUtc)).length,
    [queries],
  );

  const favoriteQueries = useMemo(
    () => filteredQueries.filter((query) => query.isFavorite),
    [filteredQueries],
  );

  const recentQueries = useMemo(
    () => filteredQueries
      .filter((query) => Boolean(query.lastUsedAtUtc))
      .sort((a, b) =>
        new Date(b.lastUsedAtUtc!).getTime() - new Date(a.lastUsedAtUtc!).getTime()
      ),
    [filteredQueries],
  );

  const visibleFavoriteQueries = useMemo(() => {
    if (selectedCategory === FAVORITE_CATEGORY || showAllFavorites) return favoriteQueries;
    return favoriteQueries.slice(0, FAVORITE_PREVIEW_COUNT);
  }, [favoriteQueries, selectedCategory, showAllFavorites]);

  const visibleRecentQueries = useMemo(
    () => recentQueries.slice(0, RECENT_PREVIEW_COUNT),
    [recentQueries],
  );

  const groups = useMemo(() => {
    const map = new Map<string, QueryItem[]>();
    for (const query of filteredQueries) {
      const category = query.category?.trim() || "其他";
      map.set(category, [...(map.get(category) ?? []), query]);
    }
    return [...map.entries()].sort(([a, aItems], [b, bItems]) =>
      (aItems[0]?.categorySortOrder ?? 0) - (bItems[0]?.categorySortOrder ?? 0)
      || a.localeCompare(b, "zh-Hant")
    );
  }, [filteredQueries]);

  async function toggleFavorite(query: QueryItem) {
    setFavoriteUpdating((current) => new Set(current).add(query.id));
    setError("");
    try {
      const nextFavorite = !query.isFavorite;
      await apiRequest(
        `/queries/${query.id}/favorite`,
        {
          method: "PUT",
          body: JSON.stringify({ isFavorite: nextFavorite }),
        },
        accessToken,
      );
      setQueries((current) => current.map((item) =>
        item.id === query.id ? { ...item, isFavorite: nextFavorite } : item
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新我的最愛失敗。");
    } finally {
      setFavoriteUpdating((current) => {
        const next = new Set(current);
        next.delete(query.id);
        return next;
      });
    }
  }

  function renderQueryCard(query: QueryItem, showRecentTime = false) {
    const Icon = icons[query.icon] ?? Table2;
    const updating = favoriteUpdating.has(query.id);

    return (
      <article className="query-icon-card" key={query.id}>
        <button
          className={`query-favorite-button${query.isFavorite ? " active" : ""}`}
          type="button"
          aria-label={query.isFavorite ? `從我的最愛移除 ${query.name}` : `加入我的最愛 ${query.name}`}
          title={query.isFavorite ? "從我的最愛移除" : "加入我的最愛"}
          disabled={updating}
          onClick={() => void toggleFavorite(query)}
        >
          <Star size={19} fill={query.isFavorite ? "currentColor" : "none"} />
        </button>

        <Link className="query-card-link" to={`/queries/${query.id}`}>
          <div className="query-icon"><Icon size={28} /></div>
          <strong>{query.name}</strong>
          <p>{query.description || query.code}</p>
          {showRecentTime && query.lastUsedAtUtc && (
            <small className="query-last-used">
              最近使用：{new Date(query.lastUsedAtUtc).toLocaleString()}
            </small>
          )}
        </Link>
      </article>
    );
  }

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
            <button
              type="button"
              className={selectedCategory === FAVORITE_CATEGORY ? "active" : ""}
              onClick={() => setSelectedCategory(FAVORITE_CATEGORY)}
            >
              ★ 我的最愛 <span>{favoriteCount}</span>
            </button>
            <button
              type="button"
              className={selectedCategory === RECENT_CATEGORY ? "active" : ""}
              onClick={() => setSelectedCategory(RECENT_CATEGORY)}
            >
              最近使用 <span>{recentCount}</span>
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

      {!loading &&
        (selectedCategory === ALL_CATEGORIES || selectedCategory === FAVORITE_CATEGORY) &&
        favoriteQueries.length > 0 && (
        <section className="query-category query-favorites">
          <div className="query-category-heading static">
            <span className="query-category-title">
              <Star size={21} fill="currentColor" aria-hidden="true" />
              <strong>我的最愛</strong>
            </span>
            <span className="query-category-count">{favoriteQueries.length} 個查詢</span>
          </div>

          <div className="query-icon-grid">
            {visibleFavoriteQueries.map((query) => renderQueryCard(query))}
          </div>

          {selectedCategory === ALL_CATEGORIES && favoriteQueries.length > FAVORITE_PREVIEW_COUNT && (
            <div className="query-section-more">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowAllFavorites((current) => !current)}
              >
                {showAllFavorites
                  ? "收合我的最愛"
                  : `查看全部 ${favoriteQueries.length} 個我的最愛`}
              </button>
            </div>
          )}
        </section>
      )}

      {!loading &&
        (selectedCategory === ALL_CATEGORIES || selectedCategory === RECENT_CATEGORY) &&
        recentQueries.length > 0 && (
        <section className="query-category query-recent">
          <div className="query-category-heading static">
            <span className="query-category-title">
              <Clock3 size={21} aria-hidden="true" />
              <strong>最近使用</strong>
            </span>
            <span className="query-category-count">
              最近 {Math.min(recentQueries.length, RECENT_PREVIEW_COUNT)} 個
            </span>
          </div>

          <div className="query-icon-grid">
            {visibleRecentQueries.map((query) => renderQueryCard(query, true))}
          </div>
        </section>
      )}

      {!loading &&
        selectedCategory !== FAVORITE_CATEGORY &&
        selectedCategory !== RECENT_CATEGORY &&
        groups.map(([category, items]) => {
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
                {items.map(renderQueryCard)}
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
