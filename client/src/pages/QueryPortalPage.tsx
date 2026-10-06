import {
  BarChart3, CalendarDays, ClipboardList, Database, FileSpreadsheet,
  Hospital, MessageSquare, Search, Table2, Users,
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

export function QueryPortalPage() {
  const { accessToken } = useAuth();
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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

  const groups = useMemo(() => {
    const map = new Map<string, QueryItem[]>();
    for (const query of queries) {
      const category = query.category?.trim() || "其他";
      map.set(category, [...(map.get(category) ?? []), query]);
    }
    return [...map.entries()];
  }, [queries]);

  return (
    <main className="page-shell">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Query Portal</p>
          <h1>資料查詢</h1>
          <p className="subtitle">僅顯示目前帳號已被授權且已發布的查詢功能。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}
      {loading && <section className="notice">載入中…</section>}

      {!loading && groups.map(([category, items]) => (
        <section className="query-category" key={category}>
          <h2>{category}</h2>
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
        </section>
      ))}

      {!loading && queries.length === 0 && (
        <section className="empty-portal">
          目前沒有已授權的查詢功能。
        </section>
      )}
    </main>
  );
}
