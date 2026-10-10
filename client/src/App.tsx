import { BarChart3, ClipboardList, Database, FileCheck2, FileSpreadsheet, LayoutDashboard, LogOut, PanelsTopLeft, Settings, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import { apiRequest } from "./api/client";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DataSourcesPage } from "./pages/DataSourcesPage";
import { DashboardDesignerPage } from "./pages/DashboardDesignerPage";
import { DashboardDisplayPage } from "./pages/DashboardDisplayPage";
import { DatasetDesignerPage } from "./pages/DatasetDesignerPage";
import { LoginPage } from "./pages/LoginPage";
import { QueryPortalPage } from "./pages/QueryPortalPage";
import { QueryPublisherPage } from "./pages/QueryPublisherPage";
import { QueryRuntimePage } from "./pages/QueryRuntimePage";
import { SetupPage } from "./pages/SetupPage";
import { SystemSettingsPage } from "./pages/SystemSettingsPage";

const modules = [
  { title: "查詢功能", description: "使用已發布且已授權的查詢與報表。", icon: BarChart3, permission: "VIEW_QUERY", path: "/queries" },
  { title: "查詢設計", description: "建立 Dataset、SQL 與安全查詢參數。", icon: PanelsTopLeft, permission: "DESIGN_QUERY", path: "/designer/datasets" },
  { title: "查詢發佈", description: "建立查詢圖示、權限並發佈給使用者。", icon: FileCheck2, permission: "DESIGN_QUERY", path: "/designer/queries" },
  { title: "儀表板設計", description: "建立資料顯示 Dashboard、預設參數與自動更新。", icon: LayoutDashboard, permission: "DESIGN_QUERY", path: "/designer/dashboards" },
  { title: "資料來源", description: "管理 SQL Server、Oracle 等資料庫連線。", icon: Database, permission: "MANAGE_DATASOURCE", path: "/admin/datasources" },
  { title: "Excel 報表", description: "已授權查詢可匯出 Excel。", icon: FileSpreadsheet, permission: "EXPORT_QUERY", path: "/queries" },
  { title: "權限管理", description: "使用角色與使用者權限控制功能。", icon: ShieldCheck, permission: "MANAGE_USERS", path: "/admin/users" },
  { title: "稽核紀錄", description: "查看查詢與匯出的稽核紀錄。", icon: ClipboardList, permission: "VIEW_AUDIT", path: "/admin/audit" },
  { title: "系統設定", description: "設定機構名稱與平台顯示文字。", icon: Settings, permission: "MANAGE_SETTINGS", path: "/admin/settings" },
];

function HomePage() {
  const { user, logout, hasPermission, accessToken } = useAuth();
  const visibleModules = modules.filter((item) => !item.permission || hasPermission(item.permission));
  const [branding, setBranding] = useState({
    organizationName: "",
    platformName: "Universal Query Platform",
    platformTitle: "通用資料查詢與報表平台",
    platformSubtitle: "低程式碼建立查詢、報表與使用者可操作的功能入口。",
  });

  useEffect(() => {
    apiRequest<typeof branding>("/system-settings/branding", {}, accessToken)
      .then(setBranding)
      .catch(() => undefined);
  }, [accessToken]);

  const eyebrow = [branding.organizationName.trim(), branding.platformName.trim()]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">{eyebrow || "Universal Query Platform"}</p>
          <h1>{branding.platformTitle}</h1>
          <p className="subtitle">{branding.platformSubtitle}</p>
        </div>

        <div className="user-panel">
          <span>{user?.displayName}</span>
          <Link className="secondary-button link-button" to="/account/password">變更密碼</Link>
          <button className="secondary-button" type="button" onClick={logout}>
            <LogOut size={16} />
            登出
          </button>
        </div>
      </header>

      <section className="module-grid" aria-label="平台模組">
        {visibleModules.map(({ title, description, icon: Icon, path }) => {
          const content = (
            <>
              <div className="icon-wrap"><Icon size={24} /></div>
              <h2>{title}</h2>
              <p>{description}</p>
            </>
          );

          return path ? (
            <Link className="module-card module-link" key={title} to={path}>{content}</Link>
          ) : (
            <article className="module-card" key={title}>{content}</article>
          );
        })}
      </section>

      <section className="notice">
        <strong>目前狀態：</strong>
        資料來源、查詢設計、參數設計、查詢發佈與權限式查詢入口已串接。
      </section>
    </main>
  );
}

function PermissionRoute({ permission, children }: { permission: string; children: ReactNode }) {
  const { hasPermission } = useAuth();
  return hasPermission(permission) ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
        <Route
          path="/queries"
          element={<PermissionRoute permission="VIEW_QUERY"><QueryPortalPage /></PermissionRoute>}
        />
        <Route
          path="/queries/:id"
          element={<PermissionRoute permission="VIEW_QUERY"><QueryRuntimePage /></PermissionRoute>}
        />
        <Route
          path="/designer/datasets"
          element={<PermissionRoute permission="DESIGN_QUERY"><DatasetDesignerPage /></PermissionRoute>}
        />
        <Route
          path="/designer/queries"
          element={<PermissionRoute permission="DESIGN_QUERY"><QueryPublisherPage /></PermissionRoute>}
        />
        <Route
          path="/designer/dashboards"
          element={<PermissionRoute permission="DESIGN_QUERY"><DashboardDesignerPage /></PermissionRoute>}
        />
        <Route
          path="/designer/dashboards/:id/display"
          element={<PermissionRoute permission="DESIGN_QUERY"><DashboardDisplayPage /></PermissionRoute>}
        />
        <Route
          path="/admin/users"
          element={<PermissionRoute permission="MANAGE_USERS"><AdminUsersPage /></PermissionRoute>}
        />
        <Route
          path="/admin/datasources"
          element={<PermissionRoute permission="MANAGE_DATASOURCE"><DataSourcesPage /></PermissionRoute>}
        />
        <Route
          path="/admin/audit"
          element={<PermissionRoute permission="VIEW_AUDIT"><AuditLogPage /></PermissionRoute>}
        />
        <Route
          path="/admin/settings"
          element={<PermissionRoute permission="MANAGE_SETTINGS"><SystemSettingsPage /></PermissionRoute>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
