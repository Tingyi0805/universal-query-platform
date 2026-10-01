# Universal Query Platform

通用低程式碼資料查詢與報表平台。

## 產品定位

本專案定位為類似企業級 Smart Query 類型的查詢／報表平台。重點不是單純執行固定 SQL，而是讓具權限的設計者可在瀏覽器中快速建立查詢頁面與報表，再發布成使用者可操作的功能 Icon。

## 核心目標

- 支援 SQL Server、Oracle 等異質資料來源
- 提供 DataSource Manager 管理資料庫連線
- 提供 Dataset / Query Designer 建立 SQL、欄位、排序與篩選
- 提供 Parameter Designer 設定 Text、Date、Select、Checkbox 等查詢條件
- 提供 Report Designer 設計表格、群組、彙總與版面
- 提供 Dynamic Query，允許使用者在授權範圍內自行增加篩選條件
- 預留 Pivot／樞紐分析與圖表功能
- 將設計完成的查詢／報表發布成首頁 Icon
- 依 User / Role 控制可見 Icon、查詢、匯出與設計權限
- 查詢結果採 Server-side 分頁／限制筆數
- 支援 Excel 匯出，後續可擴充 CSV / PDF
- 查詢、匯出與管理異動保留 Audit Log
- 報表定義支援 Draft / Published 與版本管理

## 角色

### 使用者
使用已發布的查詢／報表、輸入條件、瀏覽結果與匯出允許的格式。

### 設計者
建立 Dataset、查詢條件、顯示欄位、群組、彙總、報表版面與 Icon。

### 系統管理者
管理資料來源、使用者、角色、權限、系統設定、Audit Log 與發布版本。

## 技術架構

- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Platform DB: SQL Server
- External DB: SQL Server / Oracle
- Query execution: Server-side only
- Export: ExcelJS（後續 Slice）

## 開發階段

- Slice 0: 基礎架構
- Slice 1: Platform DB + Authentication + RBAC
- Slice 2: DataSource Manager + SQL Server / Oracle Adapter
- Slice 3: Dataset / Query Designer
- Slice 4: Parameter Designer + Dynamic Query Runtime
- Slice 5: Report Designer + Group / Aggregate / Layout
- Slice 6: Excel Export + Pivot / Chart foundation
- Slice 7: Publish / Icon Portal + Audit / Security
- Slice 8: Deployment / Hardening

## 安全原則

- 一般使用者不得提交、修改或看到 SQL
- 查詢 SQL 僅由後端依已發布的 Query Definition 執行
- 所有查詢條件使用 Bind Parameter
- 正式資料來源原則上使用唯讀帳號
- DataSource 密碼不得存入 Git
- 查詢、匯出、發布與管理異動保留 Audit Log

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
