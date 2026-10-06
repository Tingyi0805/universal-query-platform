import { BarChart3, Database, FileCheck2, FileSpreadsheet, LogOut, PanelsTopLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { DataSourcesPage } from "./pages/DataSourcesPage";
import { DatasetDesignerPage } from "./pages/DatasetDesignerPage";
import { LoginPage } from "./pages/LoginPage";
import { QueryPortalPage } from "./pages/QueryPortalPage";
import { QueryPublisherPage } from "./pages/QueryPublisherPage";
import { QueryRuntimePage } from "./pages/QueryRuntimePage";

const modules = [
  { title: "查詢功能", description: "使用已發布且已授權的查詢與報表。", icon: BarChart3, permission: "VIEW_QUERY", path: "/queries" },
  { title: "Query Designer", description: "建立 Dataset、SQL 與安全查詢參數。", icon: PanelsTopLeft, permission: "DESIGN_QUERY", path: "/designer/datasets" },
  { title: "Query Publisher", description: "建立查詢 Icon、權限並發布給使用者。", icon: FileCheck2, permission: "DESIGN_QUERY", path: "/designer/queries" },
  { title: "資料來源", description: "管理 SQL Server、Oracle 等資料庫連線。", icon: Database, permission: "MANAGE_DATASOURCE", path: "/admin/datasources" },
  { title: "Excel 報表", description: "已授權查詢可匯出 Excel。", icon: FileSpreadsheet, permission: "EXPORT_QUERY", path: "/queries" },
  { title: "權限管理", description: "使用角色與使用者權限控制功能。", icon: ShieldCheck, permission: "MANAGE_USERS", path: "/admin/users" },
];

function HomePage() {
  const { user, logout, hasPermission } = useAuth();
  const visibleModules = modules.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <main className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Universal Query Platform</p>
          <h1>通用資料查詢與報表平台</h1>
          <p className="subtitle">低程式碼建立查詢、報表與使用者可操作的功能入口。</p>
        </div>

        <div className="user-panel">
          <span>{user?.displayName}</span>
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
        DataSource、Dataset Designer、Parameter Designer、Query Publisher 與權限式 Query Portal 已串接。
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
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
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
          path="/admin/users"
          element={<PermissionRoute permission="MANAGE_USERS"><AdminUsersPage /></PermissionRoute>}
        />
        <Route
          path="/admin/datasources"
          element={<PermissionRoute permission="MANAGE_DATASOURCE"><DataSourcesPage /></PermissionRoute>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
