# 共用工作站跨平台支援與安全邊界

支援 Windows 10/11、Android 平板及 iPadOS/iOS 的現代瀏覽器，使用相同 React 觸控介面。
管理員登記的 PlatformCode (WINDOWS/ANDROID/IOS/UNKNOWN) 僅是資產清冊欄位，**不是裝置驗證依據**。User-Agent、工作站代碼、localStorage 與裝置名稱均可被冒用。

## 憑證部署策略

- Windows：可考慮受管裝置憑證、Windows 憑證存放區或受控 kiosk 代理程式。
- Android：受管裝置透過 MDM、Android Keystore／原生應用程式提供裝置身分證明。
- iPadOS/iOS：受管裝置透過 MDM、Keychain／原生應用程式或受支援的裝置身分驗證方式。
- 純瀏覽器模式：不能假定可安全保存長期裝置私鑰；在完成可靠裝置證明前，不開放 PIN-only 登入。

## 後續啟用條件

1. 管理員核准裝置及其可使用員工清單。
2. 驗證裝置持有有效且未撤銷的憑證，不只接受工作站代碼。
3. PIN 使用者驗證必須有速率限制、帳號鎖定與稽核。
4. 員工切換時撤銷舊 Session，清除前端病患資料及查詢快取。
5. 高敏感資訊、匯出及管理功能必須要求正式密碼 step-up。
6. 經醫院資安審核及各平台實機測試後才開放。

目前 PR 僅增加平台分類，沒有啟用 PIN 快速登入。
