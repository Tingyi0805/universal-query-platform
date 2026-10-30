# Issue #80：純網頁與 Windows BAT 驗收

以 PR #76 `8d40fadaf4811a37ccbf9641689ece82d8728b72` 為基準；不使用 PR #78／#79、Windows Agent、.NET 或 WebView2，無資料庫結構變更或 Migration。

播放網址按鈕原本沒有 loading，所有 API 錯誤均變成同一個 409，且共用提示放在整份裝置清單後方。未設定公開來源時沒有可用網址；本次不臆測現場 .env，也不從 Host 或 localhost 推導網址。現在逐裝置顯示進度／錯誤，15 秒期限、禁止重複請求、可明確重試；重新載入、授權設定變更及離開頁面會取消過時請求並清除舊連結。設定保存成功後仍自動取得網址；取得失敗不會誤報設定保存失敗或再次寫入。

管理員須在隔離驗收環境設定既有 `DASHBOARD_PUBLIC_CLIENT_ORIGIN` 為播放裝置可連線的 canonical origin，例如 `http://hospital.example:8080`，不可有結尾斜線、路徑、帳密、query 或 fragment，並重啟 Server。此為範例，不會修改正式 .env。缺值、錯值、無效播放位置、權限不足、裝置失效與服務失敗會回傳不同分類；不回傳資料庫例外、Token 或原始設定。既有 DESIGN_QUERY、actor/Query ACL、版本衝突、原子寫入及 Audit 沿用。

驗收時保存裝置或播放位置，確認該裝置下方出現網址；測試複製（Clipboard 拒絕或 HTTP 不提供 API 時使用可見欄位 fallback）、開啟隔離新視窗、下載 BAT。BAT 僅含公開網址與已保存 Edge／Chrome、螢幕／絕對座標／大小／全螢幕；沿用 origin＋device 的固定獨立 profile。螢幕依 Windows DeviceName 排序，不保證等同「顯示設定」號碼；座標不在指定螢幕時回到該螢幕左上角。缺少指定螢幕或瀏覽器須顯示錯誤，不偷偷改用其他瀏覽器。實體多螢幕、DPI 及視窗定位仍須現機驗收。

| 情境 | 本次行為與界線 |
| --- | --- |
| HTTP 手動播放 | 保留 PR #76 功能；Token 僅頁面記憶體，F5／關閉／瀏覽器重啟／Windows 重開機後須重新輸入。到期、撤銷、IP、Query-only、遮蔽、公共政策及患者 Audit 繼續驗證。HTTP 傳輸本身不加密，不能宣稱患者資料或 Token 的網路傳輸安全。僅以合成資料驗收這個相容模式。 |
| HTTP 無人值守持久授權 | **BLOCKED**。純網頁與 BAT 無法在裸 HTTP 上安全註冊並持續交付 bearer Token／患者資料。JS 加密再把解密金鑰存在同一來源、IndexedDB、可讀 cookie 或 BAT 並無可靠保護；不新增這些替代方案。 |
| HTTPS 既有持久授權 | 保留 AES-GCM、Secure／HttpOnly／SameSite=Strict cookie、短 session、CSRF／origin／proxy 驗證及 live 權限檢查。BAT 啟動的固定 profile 首次明確授權後，瀏覽器 process/profile 重啟可恢復，仍受裝置／登錄到期及撤銷限制。需要原有 HTTPS 設定；本次不部署 HTTPS。 |
| Windows 自動開啟 BAT | BAT 不會自行建立開機排程，也不會繞過授權。HTTP 即使登入後自動執行 BAT，仍須人工 Token；HTTPS profile 能否在真實 Windows 重開機後恢復須現機驗收，非 CI process restart 的結論。 |

清理採 Git 清單與部署依賴檢查：未發現可刪除的追蹤產物／無用來源，故追蹤檔刪除清單為空。保留所有 Migration、稽核證據、遮蔽、部署腳本、文件及測試。忽略的 node_modules／dist／tsbuildinfo／Browser 測試輸出不進 Git；清除本工作區舊分支的生成產物不代表 PR 刪除了它們。Server build 先清理 dist，僅排除沒有 production import 的 `*.test.ts`／`*.testFixture.ts` 編譯輸出；typecheck 及 npm test 仍涵蓋全部來源。部署／Migration／驗收工具的編譯輸出繼續保留。舊封裝流程帶入新增 build 設定，避免來源重建缺檔。

精確 bytes、前後檔數與完整移除產物清單見 [browser-bat-80-size.json](browser-bat-80-size.json)。以 Node 24.15.0／npm 12.2.1 乾淨安裝，分別 `npm ci`、`npm run build`；在 repo 根目錄執行 `node tools/measure-browser-build.mjs` 可核對目前追蹤與兩個 dist 的未壓縮 bytes（不含 node_modules／Git／ZIP／磁碟配置單位）。基準則在獨立 PR #76 checkout 使用同一套 Node／npm／lockfile 重新 build，再用此 read-only 工具以目前工作目錄量測。追蹤大小使用 Git blob，不受 Windows CRLF checkout 影響；Build bytes 會受工具鏈與換行影響，報告記錄 Linux LF 結果。

本機驗收請下載本 Draft 至新的隔離資料夾，沿用已驗證的測試環境設定，依 PR #76 相依更新／回復程序操作；不要覆蓋現有 C:\UQP、執行 Migration 或連正式患者資料。可驗收網址 UI、純網頁手動播放及 BAT。HTTP 安全持久授權及真實 Windows 重新開機自動恢復不在已通過範圍。
