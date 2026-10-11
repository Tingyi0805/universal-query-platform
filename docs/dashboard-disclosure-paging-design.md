# Dashboard 患者曝光：輪播分頁與資料遮蔽整合規劃

## 已確認的現況

`client/src/pages/DashboardDisplayPage.tsx` 會透過 Dashboard preview API 取得完整的 `result.rows`，再由瀏覽器依 `pageSize` 與 `pageSeconds` 切割及輪播。資料每隔 `refreshSeconds` 重新取得。

後端目前在 preview 回應前，以完整 `result.rows` 建立曝光稽核；此紀錄代表「已傳送到瀏覽器的患者資料」，**不等於每一頁實際出現在螢幕上**。

前端的 `maskText`、TABLE `columnMasks`、FIELD `maskMode` 是顯示階段的遮蔽。API 回傳的 `result.rows` 仍可能包含未遮蔽資料。因此現有後端稽核採 `masked: false`，不能以 UI 遮蔽宣稱網路傳輸已遮蔽。

## 下一階段實作原則

1. 將「資料交付」與「實際播放頁面」拆為兩種事件，不覆寫既有曝光紀錄。
2. 裝置播放使用已驗證的 DashboardDeviceId；登入模式使用 JWT UserId。不能以 WorkstationId 冒充 DashboardDeviceId。
3. 每次顯示新頁時，前端提交伺服器核發的資料快照識別與頁碼；伺服器依保存的快照計算該頁患者識別，不信任瀏覽器自行傳送的患者姓名或病歷號。
4. 快照應具短效期限、裝置/使用者綁定、不可猜測識別碼，且不在日誌中儲存患者原始資料。
5. 若需要嚴格保證「先稽核後顯示」，應改為後端分頁 API：每頁完成 fail-closed 稽核後才交付該頁。只靠前端頁面切換後再回報，無法保證記錄成功才顯示。
6. 如需在 API 層實現真正遮蔽，必須在伺服器依授權的欄位遮蔽規則處理後再傳輸；不得將前端遮蔽當作伺服器資料保護。
7. 驗證輪播、手動換頁、背景分頁、網路中斷重試、Token 失效、權限撤銷及重新整理時的重複稽核行為。
8. 資料庫 migration 909 需先於新版後端部署，並以真實 SQL Server 驗證外鍵及 transaction。

## 不應宣稱已完成

目前沒有逐頁顯示事件的持久化紀錄，也沒有伺服器端逐頁資料交付或伺服器端遮蔽。本文件僅定義下一階段可驗證的整合邊界。
