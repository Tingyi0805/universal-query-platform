import { LayoutDashboard, Maximize2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DashboardPortalPage.css";

type DashboardItem = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  displayTitle: string | null;
  displayMode: "TABLE" | "BIG_SCREEN";
  refreshSeconds: number;
  pageSeconds: number;
  pageSize: number;
  queryName: string;
};

export function DashboardPortalPage() {
  const { accessToken } = useAuth();
  const [dashboards, setDashboards] = useState<DashboardItem[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ dashboards: DashboardItem[] }>(
        "/dashboards/available",
        {},
        accessToken,
      );
      setDashboards(result.dashboards);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Dashboard 失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase();
    if (!keyword) return dashboards;
    return dashboards.filter((dashboard) =>
      [
        dashboard.name,
        dashboard.code,
        dashboard.description ?? "",
        dashboard.displayTitle ?? "",
        dashboard.queryName,
      ].some((value) => value.toLocaleLowerCase().includes(keyword))
    );
  }, [dashboards, searchText]);

  function openPlayback(dashboardId: number) {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("瀏覽器封鎖了播放視窗，請允許此網站開啟新視窗後再試一次。");
      return;
    }

    const storedAuth = sessionStorage.getItem("uqp.auth");
    if (storedAuth) {
      try {
        popup.sessionStorage.setItem("uqp.auth", storedAuth);
      } catch {
        // Login page will return to the requested playback path if handoff fails.
      }
    }

    popup.location.replace(`/dashboards/${dashboardId}/display`);
  }

  return (
    <main className="page-shell dashboard-portal-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Dashboard Portal</p>
          <h1>儀表板</h1>
          <p className="subtitle">選擇已授權的 Dashboard 後直接播放；一般使用者不需要進入版面設計。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}
      {loading && <section className="notice">載入 Dashboard…</section>}

      {!loading && dashboards.length > 0 && (
        <section className="dashboard-portal-tools" aria-label="Dashboard 搜尋">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={searchText}
            placeholder="搜尋 Dashboard 名稱、代碼或說明"
            onChange={(event) => setSearchText(event.target.value)}
          />
          {searchText && (
            <button className="secondary-button" type="button" onClick={() => setSearchText("")}>
              清除
            </button>
          )}
        </section>
      )}

      {!loading && filtered.length > 0 && (
        <section className="dashboard-portal-grid">
          {filtered.map((dashboard) => (
            <article className="dashboard-portal-card" key={dashboard.id}>
              <div className="dashboard-portal-icon"><LayoutDashboard size={28} /></div>
              <div className="dashboard-portal-card-body">
                <strong>{dashboard.displayTitle || dashboard.name}</strong>
                <p>{dashboard.description || dashboard.queryName}</p>
                <small>
                  {dashboard.displayMode === "BIG_SCREEN" ? "大螢幕" : "一般表格"}
                  {" · "}資料更新 {dashboard.refreshSeconds} 秒
                  {" · "}換頁 {dashboard.pageSeconds} 秒
                </small>
              </div>
              <button
                className="primary-button dashboard-play-button"
                type="button"
                onClick={() => openPlayback(dashboard.id)}
              >
                <Maximize2 size={17} />
                播放
              </button>
            </article>
          ))}
        </section>
      )}

      {!loading && dashboards.length > 0 && filtered.length === 0 && (
        <section className="empty-portal">
          <strong>找不到符合條件的 Dashboard。</strong>
          <button className="secondary-button" type="button" onClick={() => setSearchText("")}>清除搜尋</button>
        </section>
      )}

      {!loading && dashboards.length === 0 && (
        <section className="empty-portal">
          目前沒有可播放的 Dashboard，或目前帳號尚未取得其 Query 執行權限。
        </section>
      )}
    </main>
  );
}
