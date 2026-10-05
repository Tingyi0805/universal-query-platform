import { BarChart3, Database, FileSpreadsheet, LogOut, ShieldCheck } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";

const modules = [
  { title: "查詢功能", description: "依權限顯示可使用的查詢 Icon。", icon: BarChart3 },
  { title: "資料來源", description: "管理 SQL Server、Oracle 等資料庫連線。", icon: Database, permission: "MANAGE_DATASOURCE" },
  { title: "Excel 報表", description: "將查詢結果匯出為 Excel。", icon: FileSpreadsheet, permission: "EXPORT_QUERY" },
  { title: "權限管理", description: "使用角色與使用者權限控制功能。", icon: ShieldCheck, permission: "MANAGE_USERS" },
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
        {visibleModules.map(({ title, description, icon: Icon }) => (
          <article className="module-card" key={title}>
            <div className="icon-wrap"><Icon size={24} /></div>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="notice">
        <strong>目前狀態：</strong>
        Slice 1 正在建立登入與 RBAC；首頁已可依 Permission 隱藏管理功能。
      </section>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
