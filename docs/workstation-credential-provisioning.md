# 工作站憑證核發操作與限制

API 限具 MANAGE_USERS 權限且持有正式 JWT 的管理員呼叫：

- GET /api/v1/admin/shared-workstations/:id/credentials：列出憑證 ID、建立及撤銷時間，不顯示密鑰。
- POST /api/v1/admin/shared-workstations/:id/credentials：只對已啟用的工作站核發 256-bit 隨機密鑰；**僅回傳一次**，DB 儲存 SHA-256 雜湊。
- DELETE /api/v1/admin/shared-workstations/:id/credentials/:credentialId：撤銷指定憑證，並撤銷該工作站 Session。

需經 HTTPS、受控管理員端點與禁止代理/應用程式記錄回應內容。密鑰不應儲存於瀏覽器 localStorage、sessionStorage 或普通 Cookie。核發 API 目前僅供安全部署流程整合，尚未提供一般員工操作介面。

**安全限制**：純網頁瀏覽器無法保證長期裝置密鑰不被複製。Windows、Android、iPadOS/iOS 需要搭配受管理裝置及原生憑證安全儲存/裝置證明，或改用企業受管裝置認證。此功能只是憑證生命週期基礎，**尚未啟用 PIN-only 登入**。

部署前仍需補上正式密碼 step-up、管理員核發雙重確認、限流、稽核檢視與平台實機測試。對裝置憑證外洩應立即撤銷。
