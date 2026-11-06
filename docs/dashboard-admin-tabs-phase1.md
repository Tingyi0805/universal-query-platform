# Dashboard 管理員四頁籤整合：第一階段

基準 `cb73828defbb0aff86f8e6366c75b2fbe8584b24`。依[核准設計](dashboard-admin-tabs-drilldown-design.md)只做管理介面整合；不實作下鑽、圖表、PIN，不修改Server、SQL、Migration、一般使用者Dashboard入口或播放端。未操作正式DB／C:\UQP，不提供或核准正式更新包。

| 頁籤 | 沿用元件／原有契約 |
|---|---|
| 資料設定 | DashboardBasicSettingsEditor、DashboardDataSourcesEditor；保留名稱／顯示設定、已發布Query、參數、來源、maxRows，政策與發布連至原Dataset／Query管理，不另建政策或直接執行Dataset。 |
| 版面設計 | 同一DashboardLayoutDesignerPage支援內嵌；保留既有八種Widget、位置大小、profile及完整ConfigJson。舊獨立網址仍可使用。 |
| 播放設定 | DataSourcesEditor的同一份來源草稿提供更新／換頁／筆數；LayoutDesigner的同一份版型草稿提供成功時間位置／格式。Portal只改呈現位置，不建立第二份草稿；LIVE PREVIEW沿用原控制器、時鐘與安全期限。 |
| 裝置管理 | DashboardQueryPlaybackManager與DashboardDeviceMetadataManager；原預檢、啟用、CAS、一次性Token、BAT、Enrollment指引、證據、生命週期、分頁與歷史均保留。 |

## 狀態與安全

- 頁籤切換不卸載已開啟的設定Editor，保留未保存草稿；同一來源的資料與播放欄位、同一profile的版型與時間欄位由原元件統一保存完整payload，沒有新的「全部儲存」交易。
- 原版本仍由原API驗證。其他區保存後，既有事件令舊版本失效但保留草稿；衝突／權限／服務錯誤明確顯示，不自動rebase、合併或重送。待確認的來源移除也綁定選取時版本，不能在其他頁籤保存後偷偷改用新版本。不同Dashboard或取消編輯時須明確確認捨棄；身份變更清空Editor。
- 未選Dashboard前其他頁籤停用；重用原DESIGN_QUERY入口與各API原權限，沒有增加授權。預覽／預檢只讀已保存設定，不會隱式保存草稿或啟用裝置。
- 版型及裝置模組首次訪問才載入；播放設定讀版型不執行隱藏Query。離開版型頁清除preview rows並取消請求，保留純版型草稿；原獨立版型頁仍有main/h1與原操作。
- 離開裝置頁同步清除Token ref、DOM、dialog及handoff；晚到核發回應不能重新顯示Token，也不會自動重核。metadata／播放位置草稿保留；若離開時寫入結果未確認，要求明確重載。登入失效／換身份亦清除。
- 長流程說明改為可展開區；關鍵Token、Enrollment及安全提示保持可見。360／768px觸控、ARIA頁籤及鍵盤方向鍵／Home／End驗證；保留先前避免Dataset全域nowrap樣式干擾的scope。

## 修改檔案

- 新增 `client/src/components/DashboardAdminWorkspace.tsx`／`.css`：頁籤、dirty協調、延遲掛載與共用呈現容器。
- 修改 `client/src/pages/DashboardDesignerPage.tsx`：同頁管理入口、原LIVE PREVIEW插槽、切換Dashboard確認；清單載入不再卸載Editor而丟草稿。
- 修改 `client/src/pages/DashboardLayoutDesignerPage.tsx`：內嵌、共用profile／成功時間控制、分離設定讀取與preview、安全清除、dirty baseline。
- 修改 `client/src/components/DashboardBasicSettingsEditor.tsx`／`DashboardDataSourcesEditor.tsx`：dirty通知與同一來源草稿的播放欄位呈現，原保存契約不變。
- 修改 `client/src/components/DashboardQueryPlaybackManager.tsx`／`DashboardDeviceMetadataManager.tsx`：離開頁籤清除及pending回應防護，保留裝置草稿。
- 新增 `client/e2e/dashboard-admin-tabs.spec.ts`；調整既有 `dashboard-basic-management.spec.ts`、`dashboard-device-management.spec.ts`、`dashboard-query-mode.spec.ts`，依新頁籤進入原操作，不移除原安全斷言。
- 修改`.github/workflows/ci.yml`：上述顯式UI-only安全範圍驗證，避免本階段執行SQL及封裝；非標記CI保留原行為。
- 本次一併將上一階段本機設計文件納入版控；該文件描述設計時基準，第一階段實作以本報告為準。

## CI：本階段不執行Migration或封裝

PR83既有CI原本會跑disposable SQL Migration與staging封裝。本階段以Commit標記`[ui-only-no-migrations]`明確啟用限定模式：`.github/workflows/ci.yml`的新scope工作核對相對已通過完整CI #1262之基準`cb73828`的全部差異，只接受Client、文件與此workflow；並確認基準為HEAD祖先、PR base已包含於基準。任何Server／SQL／其他路徑或祖先檢查不符即失敗，不會轉而執行Migration。未標記或非PR83的原CI行為不變。

此模式保留Linux／Windows Server全套unit、Typecheck、Build、Client unit／Typecheck／Build／完整Browser及Windows BAT／原生依賴驗證；跳過SQL acceptance、SQL smoke與staging封裝，因此沒有正式或staging更新包。原Schema／SQL證據沿用已驗證基準，不將跳過的工作宣稱為本次重新PASS。

## 驗證與界線

本機 Client unit 75/75、Server安全／交付／Enrollment專項165/165、Client Typecheck／Build通過。新增四頁籤10個Browser案例通過；原管理回歸初輪找出的入口與訊息定位問題已修正，相關15項及最後10項專項重驗通過。最終完整Server／Client／Browser與CI結果以此Commit的GitHub Actions為準，不把單次局部結果冒充完整CI。

尚未整合：多層Graph／rowRef／後端可信參數來源與互動導覽、真正CHART、PIN切換／閒置工作站session。Dataset／Query政策管理仍是原介面連結，不複製內嵌另一套。OR_001可信患者ID及受控metadata初始化仍BLOCKED_BY_DATA_OWNER。

下一階段可依原設計著手JWT下鑽後端，但目前沒有可直接啟用的下鑽執行能力；必須先完成Graph驗證、rowRef、逐層授權／遮蔽／交付Audit及Device隔離，PIN與患者鍵各自保留gate。第一階段完成後停止，不自行開始下階段或部署。
