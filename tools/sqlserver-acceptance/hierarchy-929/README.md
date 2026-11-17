# 929：真實 SQL2019 隔離驗收

只對 PR100 分支的 **GitHub-hosted ubuntu runner** 新建 `uqp929-ci` SQL Server2019 Developer instance。不是部署／更新工具。禁止在醫院、現有共用 DB 或 C:\UQP 執行。

執行：push 本 PR 變更，由 `Query Hierarchy 929 SQL2019 acceptance` workflow 執行；或在該分支手動 workflow_dispatch。禁止改固定 target 以使用外部環境。沒有合格環境則 NOT_RUN，不以 Mock 替代。

- 限 127.0.0.1:14339；先讀實際 SERVERNAME/MachineName/Engine15.x/DB_NAME/登入身份，DB 原先必須不存在。
- 僅建立 `UQP929_DISPOSABLE_SYNTHETIC`，Compatibility150，ExtendedProperty 綁定該 GitHub Run。憑證和 HMAC/AES/JWT keys 每次隨機生成，不使用 Repository SQL Secrets/.env；不記錄原值。
- 使用全部50份真實001–921、926、927 Migration 原始碼，只用於全新 instance 的相依 baseline；不重跑既有923/924驗收，不安裝CHART928。929獨立受控交易，不寫 SchemaMigration。
- sa僅作 CI安裝／故障注入。App929受限SQL Login非dbo、非db_owner、非sysadmin，沒有VIEW SERVER STATE；來源Source929只可SELECT合成表。
- 新表僅SELECT/INSERT/UPDATE/VIEW DEFINITION；既有授權查詢所需既有表SELECT、Audit INSERT/UPDATE、PAGE disclosure INSERT，不授予帳號密碼欄位或帳號／角色管理權限。額外權限需求須由實測證據列明，不直接給db_owner。
- TLS僅此instance使用加密及自簽憑證信任。C_COMMIT_UNKNOWN唯一明確的測試專用未加密TDS loopback連線，用於辨識並轉送真COMMIT、攔截ACK並斷線；不修改正式TLS設定，不記錄封包內容。

`report.json` 是執行產物（gitignore），每案預設NOT_RUN、只有實際assertions完成才PASS，失敗僅記固定code／SQL number。Artifact保存14天，含實際Engine/Edition/Compatibility/Image/source SHA/migration manifest/cleanup；不含SQL原文、帳密或資料列。

A：受控DDL/rollback/repeat/partial/catalog；B：最小權限及越權／visibility拒絕；C：真連線CAS、撤權、1205/1222、Audit與版本rollback、TDS commit ACK loss；D：COUNT/OFFSET/FETCH、bind、empty、nonunique、drift、ABA、range；E：真Query ACL／Dataset遮蔽／患者PAGE HMAC／Audit保存；F：沒有獨立Oracle11g+THICK，NOT_RUN。

排序鍵必須在SQL判定唯一；本次SQL Server分頁將COUNT／key witness／page置於同一SERIALIZABLE來源交易，並於後續相同搜尋/排序的頁／返回父層比對原witness。只返回該頁，不快取全部資料列；witness對上限+1筆排序後完整內容在DB計算、僅留伺服器，不交給瀏覽器。資料新增／刪除／鍵或排序值變動致witness不符時整筆拒絕並清context，不能默默重複／漏頁。改變搜尋／排序視為使用者明示的新結果集；不宣稱witness是mutation epoch或Source DDL fence，A→B→A完全恢復不產生假版本證明。Oracle尚無此交易證據，階層交付保持BLOCKED；既有單層Oracle流程不變。

錯誤後僅清理擁有正確ExtendedProperty的這一個新DB；容器清理需名稱及run label完全匹配。沒有docker prune、volumes/network刪除或其他容器操作。不操作本機Docker socket。

合格環境必須實際跑完A–E，並審查artifact；NOT_RUN不能算PASS。此CI不代替Windows/IIS、多worker及醫院來源實測，不解鎖PIN或正式部署。SQL_LOCK_VERIFIED不予發放。

已執行證據：CI [44047200088](https://github.com/Tingyi0805/universal-query-platform/actions/runs/44047200088)，來源SHA85941f21637f2fa169f339dcb2d72306d7bdda55，37 PASS/0 FAIL/Oracle 1 NOT_RUN；詳細矩陣見docs/mobile-query-phase2.md。B帳號不是完整UQP登入或管理帳號權限清單；封存由獨立CI維護身份測試，不能將DELETE授給feature帳號。
