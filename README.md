# Universal Query Platform

通用資料查詢與報表平台。

## 目標

- 支援 SQL Server、Oracle 等資料來源
- 由管理者設定查詢 SQL、參數、顯示欄位與功能圖示
- 依使用者 / 角色控制可使用的查詢功能
- 查詢結果分頁顯示並可匯出 Excel
- 查詢與匯出操作保留 Audit Log

## 技術架構

- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Platform DB: SQL Server（後續 Slice）
- External DB: SQL Server / Oracle（後續 Slice）

## 開發階段

- Slice 0: 基礎架構
- Slice 1: Authentication / RBAC
- Slice 2: DataSource Manager
- Slice 3: Query Definition / Parameters / Icon
- Slice 4: Dynamic Query Engine / UI
- Slice 5: Excel Export
- Slice 6: Audit / Security
- Slice 7: Deployment / Hardening

## 啟動

### Backend
```bash
cd server
copy .env.example .env
npm install
npm run dev
```

### Frontend
```bash
cd client
npm install
npm run dev
```

Backend 預設：http://localhost:3000  
Frontend 預設：http://localhost:5173
