# PR #67 — Ubuntu 24.04 全新 VM 操作手冊

目前 SQL_ACCEPTANCE=NOT_RUN。**現在只做第 1～5 步；VM 準備妥當並確認後，才執行第 6 步實際驗收。**

此手冊只適用全新獨立測試 VM，不能在目前的 UQP 電腦／Windows Server／共用 SQL Server 上執行。不複製或掛載 C:\UQP，不連 HIS／Oracle，不修改既有資料庫或 .env。Docker 權限只授予新 VM 的管理員；這不代表核准存取既有環境的 daemon。

## 1. 建立 VM

- Ubuntu Server 24.04 LTS **amd64/x86-64**，4 vCPU、8 GB RAM、至少 30 GB 磁碟且保留 15 GB 可用空間。不要使用 ARM 模擬 SQL Server。
- 使用 NAT 網路供 apt/npm/MCR/GitHub 下載；不要連正式系統 VLAN/VPN，不設定 1433/14336 的外部 port forwarding。
- 不共享正式磁碟、Windows 資料夾或 production secrets。新 VM 不應有任何既有容器／SQL Instance／UQP 服務。
- 安裝完成先做 VM snapshot。記錄管理員、VM 識別與核准範圍，這是環境隔離證據；程式的確認字串不能代替管理員查核。

在新 VM 的一般管理員帳號執行：

```bash
set -euo pipefail
. /etc/os-release
test "$ID:$VERSION_ID" = "ubuntu:24.04"
test "$(uname -m)" = "x86_64"
hostnamectl
free -h
df -h /
sudo apt-get update
sudo apt-get install -y ca-certificates curl git xz-utils jq build-essential python3 unixodbc-dev iproute2
```

## 2. 安裝 Docker Engine（只在新 VM）

使用 Docker 官方 Ubuntu noble apt repository：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable' | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

**登出再登入新 VM**，讓群組生效。docker 群組有主機管理能力，不要在既有環境套用上述授權。

```bash
id -nG
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock version
```

之後使用一般帳號跑測試；不要 sudo 執行 UQP／npm／驗收腳本。這裡只檢查新 VM daemon，尚未建立 SQL。

## 3. 安裝 Node.js 22

下載官方 Linux x64 套件並核對 SHA-256；不執行遠端安裝 shell：

```bash
set -euo pipefail
uqp_node_tmp="$(mktemp -d)"
cd "$uqp_node_tmp"
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
uqp_node_archive="$(awk '$2 ~ /^node-v22[.][0-9]+[.][0-9]+-linux-x64[.]tar[.]xz$/ {print $2}' SHASUMS256.txt)"
test -n "$uqp_node_archive"
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$uqp_node_archive"
awk -v archive="$uqp_node_archive" '$2 == archive {print}' SHASUMS256.txt | sha256sum --check -
sudo tar -xJf "$uqp_node_archive" -C /usr/local --strip-components=1
cd "$HOME"
rm -rf -- "$uqp_node_tmp"
node --version
npm --version
```

應顯示 Node v22.x。不要關閉 TLS 驗證；遇下載／checksum 錯誤就停止。

## 4. 取得 PR 分支與安裝測試依賴

從全新目錄 clone；若 repository 需要驗證，使用 GitHub 正常授權方式，不把 token 放進 URL 或報告。

```bash
set -euo pipefail
mkdir -p "$HOME/uqp-acceptance"
cd "$HOME/uqp-acceptance"
git clone --single-branch --branch feature/shared-workstation-h0-session-contract https://github.com/Tingyi0805/universal-query-platform.git uqp
cd uqp
git fetch origin feature/shared-workstation-h0-session-contract
git checkout --detach origin/feature/shared-workstation-h0-session-contract
git rev-parse HEAD
git status --short
npm --prefix server install --package-lock=false
npm --prefix server run typecheck
npm --prefix server run build
bash -n tools/sqlserver-acceptance/h0-926/run-isolated.sh
(cd server && node --import tsx --test src/scripts/workstation926Isolation.test.ts src/scripts/workstation926Launcher.test.ts)
```

核對 HEAD 等於本階段交付 SHA；若已出現其他提交，先審查差異。不要 reset/覆蓋修改，不執行 db:migrate、npm start/dev 或任何正式 API。測試依賴包含其他資料來源 driver，但這些步驟不會連接 Oracle 或患者資料。

## 5. 準入檢查與回報（目前做到這裡）

- 回報新 VM 的 OS／CPU／RAM／磁碟、Docker／Node 版本及 Commit SHA。
- 管理員確認 VM 無正式資料、無 production secrets、無 HIS/VPN 網路及共享掛載。
- 確認 VM 上沒有要保留的容器／服務，且 14336 未被使用；只查新 VM，不掃描任何遠端 SQL。
- 保存 VM snapshot。不要在 SQL Container 中掛載主機資料，也不要手動建測試表或弱化歷史 Legacy 限制。

**將上述準備結果交回審查。未進入第 6 步前，SQL_ACCEPTANCE 必須保持 NOT_RUN。**

## 6. 實際 SQL 驗收（待另行確認）

確認可接受 SQL Server Developer 測試映像的條款；腳本只在新 VM 建立一次性 Engine 15 Container。以下兩個字串是管理員對「拋棄式驗收」與「新 VM」的明確聲明，不是正式 Runtime 開關。

在 repository 根目錄：

```bash
set -euo pipefail
mkdir -p "$HOME/uqp926-evidence"
if UQP926_APPROVE=CREATE_DISPOSABLE_SYNTHETIC_926_ONLY UQP926_VM_APPROVE=NEW_UBUNTU_2404_VM_ONLY bash tools/sqlserver-acceptance/h0-926/run-isolated.sh 2>&1 | tee "$HOME/uqp926-evidence/console.log"; then uqp_run_rc=0; else uqp_run_rc=$?; fi
printf 'LAUNCHER_EXIT_CODE=%s\n' "$uqp_run_rc"
cp tools/sqlserver-acceptance/h0-926/last-report.json "$HOME/uqp926-evidence/report-$(date -u +%Y%m%dT%H%M%SZ).json"
jq '{SQL_ACCEPTANCE,startedAtUtc,finishedAtUtc,environment,launcher,summary,databaseCleanup,launcherCleanup,cleanup,legacyWriterCoverage,productionSafety,cases}' tools/sqlserver-acceptance/h0-926/last-report.json
```

腳本使用隨機密碼、獨立 internal Network、loopback 14336、固定受驗證的 hostname，並要求 Instance 初次連線時沒有使用者 DB；只建立 nonce 命名的 UQP926_* DB。安裝完整 48 個 001～921 原始 Migration 與 926 草稿；不安裝 922/923/924/925，不寫 926 ledger，不呼叫正式 Runner。

初始化 sa 與受限 Writer 帳號分開。Writer 不應有 sysadmin/db_owner/CONTROL DATABASE/VIEW SERVER STATE；報告會觀測並驗證。SQL 登入只存在於這個 Container，密碼不印出、不儲存、不放命令列。

## 7. 判讀報告

- 每次已核准啟動都先寫入新的 **21 個 NOT_RUN** 案例。每個實際執行案例才得到起訖時間及 PASS 或 FAIL；提前失敗後，其餘仍是 NOT_RUN。
- environment.build / edition / engine 是 SQL SERVERPROPERTY 實際回傳；compatibility 是建 DB 後再查 sys.databases 的值。未取得證據時不填假版本。
- launcher 保存 runId、Commit、Container/Network/Image ID 及可取得的 registry digest；sourceManifest / draftSha256 綁定測試 SQL 原始碼。
- SQL_ACCEPTANCE=PASS_ISOLATED_REVOCATION_CASES_ONLY 只允許在 21 項均 PASS、觀測 Engine 15／Build 15.x／Compatibility 150 時出現。還必須檢查程序 exit code=0、databaseCleanup=COMPLETE、launcherCleanup 無失敗、cleanup=COMPLETE。
- FAIL、任一 NOT_RUN、清理 REFUSED/FAILED/UNKNOWN、缺失版本、報告時間或 runId 不符，都不能當作驗收完成。先保存去敏報告再調查；不要盲目重跑 Commit Unknown。
- 報告是可追溯的測試紀錄，不是不可偽造的簽章，也不是完整 SQL 鎖定／正式安全證明。

**即使 21 項全數 PASS，legacyWriterCoverage／productionSafety 仍是 BLOCKED，Runtime 與 Feature Flag 仍 OFF。** 舊 Writer、權限異動、DBA／直接 SQL、混合部署及還原 incarnation 的缺口不會自動解除。不要部署 926 到共用 UQP DB。

## 8. 清理與故障

正常／錯誤／INT／TERM 結束時，只允許移除本次 CID 且 label=runId 的 Container；Network 必須另有相同 label 且沒有任何連線中的 Container。腳本不呼叫 stop-all、system/network/volume prune，也不移除任何其他 Volume。

Ownership 不符或有其他 Container 使用 Network 時拒絕清理；daemon 無法使用時記為 UNKNOWN。清理失敗不得回報成功。SIGKILL、VM 當機可能無法執行 trap。

先保存報告並核對 runId。只可由新 VM 管理員核對該次資源後處理；不要複製通用刪除命令。若不能證明資源歸屬，停止，不擴大清理。這是一部全新拋棄式 VM，證據保存完畢後可直接還原 snapshot／刪除該 VM；不可還原或清理目前 UQP 主機。
