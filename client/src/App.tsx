import { BarChart3, Database, FileSpreadsheet, ShieldCheck } from "lucide-react";

const modules = [
  {
    title: "查詢功能",
    description: "依權限顯示可使用的查詢 Icon。",
    icon: BarChart3,
  },
  {
    title: "資料來源",
    description: "管理 SQL Server、Oracle 等資料庫連線。",
    icon: Database,
  },
  {
    title: "Excel 報表",
    description: "將查詢結果匯出為 Excel。",
    icon: FileSpreadsheet,
  },
  {
    title: "權限管理",
    description: "使用角色與使用者權限控制功能。",
    icon: ShieldCheck,
  },
];

export default function App() {
  return (
    <main className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Universal Query Platform</p>
          <h1>通用資料查詢與報表平台</h1>
          <p className="subtitle">
            統一管理資料來源、查詢功能、Excel 報表與使用權限。
          </p>
        </div>
        <span className="status">Slice 0</span>
      </header>

      <section className="module-grid" aria-label="平台模組">
        {modules.map(({ title, description, icon: Icon }) => (
          <article className="module-card" key={title}>
            <div className="icon-wrap"><Icon size={24} /></div>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="notice">
        <strong>目前狀態：</strong>
        基礎架構已建立。下一階段將加入登入、角色與查詢 Icon 權限。
      </section>
    </main>
  );
}
