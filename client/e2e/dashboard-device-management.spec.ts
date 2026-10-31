import { test, expect, type Page } from "@playwright/test";
const initialVersion = "a".repeat(64);
async function setup(page: Page, execute = true, audit = false) {
  const state = { historyCalls:[] as Record<string,string>[],historyError:0,historyDelay:0,historyEmpty:false,historyMalformed:false, listCalls:[] as Record<string,string>[],listError:0,listConflict:false,listDelay:0,listPageDelay:0, safetyOnly: false, lifecycleFail: false, tokenDelay: 0, malformedToken: false, linkDelay:0,linkCode:"",linkStatus:503,linkReads:0,alertFail:false, linkUrl: "https://hospital.example:8443/display/dashboards/1?deviceId=7", revision: 0, mode: "LEGACY", failStatus: 0, flag: false, createAllowed: true, archived: false, revoked: false, expired: false,
    writes: [] as { path: string; method: string; body: any }[], reads: 0, oldWrites: 0,
    devices: [{ id: 7, dashboardId: 1, deviceName: "合成裝置", isActive: true, createdByUserId: 2, sharedWorkstationId: 3,
      enforceIpRestriction: true, allowedIp: "192.0.2.1" as string | null, allowedCidr: null, expiresAtUtc: null as string | null,
      suspendedAtUtc: null as string | null, reenrollmentRequired: null as boolean | null, revokedAtUtc: null as string | null, archivedAtUtc: null as string | null, queryModeGrantVersion: null, delegatorTokenVersion: null,
      placement: { browser: "chrome", screenNumber: 3, fullscreen: false, windowX: -2000, windowY: 100, windowWidth: 1200, windowHeight: 800 } }] };
  await page.addInitScript(({execute,audit}) => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic", user: { id: 1, username: "synthetic", displayName: "測試", permissions: ["DESIGN_QUERY", "VIEW_QUERY", ...(audit ? ["VIEW_AUDIT"] : []), ...(execute ? ["EXECUTE_QUERY"] : [])] } })), {execute,audit});
  await page.context().route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if(path.endsWith("/history")){
      const q=Object.fromEntries(new URL(req.url()).searchParams);state.historyCalls.push(q);
      if(state.historyDelay&&q.source==="LIVE")await new Promise(r=>setTimeout(r,state.historyDelay));
      if(state.historyError){await route.fulfill({status:state.historyError,json:{error:{code:"FORBIDDEN",message:"PRIVATE PARAMETERS TOKEN"}}});return;}
      const source=q.source??"LIVE",page=Number(q.page??1),pageSize=Number(q.pageSize??20);
      const rows=state.historyEmpty?[]:Array.from({length:25},(_,i)=>({id:String(25-i),createdAtUtc:"2026-10-31T00:00:00Z",eventType:i%2?"DASHBOARD_DEVICE_REVOKED":"DASHBOARD_DEVICE_SUSPENDED",username:source==="ARCHIVE"?"archiver":"admin",displayName:source==="ARCHIVE"?"封存操作者":"線上管理者",status:i%2?"FAILED":"SUCCESS",errorCode:i%2?"FORBIDDEN":null})).filter(d=>(!q.eventType||d.eventType===q.eventType)&&(!q.username||d.username.includes(q.username)));
      await route.fulfill({json:{dashboardId:state.historyMalformed?2:Number(path.split("/")[3]),deviceId:Number(path.split("/").at(-2)),source,items:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize}});return;
    }
    if(path.endsWith("/device-alerts")){
      if(state.alertFail){await route.fulfill({status:503,json:{error:{code:"PRIVATE_DIAGNOSTIC"}}});return;}
      await route.fulfill({json:{days:30,asOfUtc:new Date().toISOString(),devices:state.devices.filter(d=>d.expiresAtUtc!==null).map(d=>({...d,daysRemaining:Math.ceil((Date.parse(d.expiresAtUtc!)-Date.now())/86400000)}))}});return;
    }
    if(path.endsWith("/playback-link")){state.linkReads++;if(state.linkDelay)await new Promise(resolve=>setTimeout(resolve,state.linkDelay));if(state.linkCode){await route.fulfill({status:state.linkStatus,json:{error:{code:state.linkCode,message:"PRIVATE_SQL_TOKEN"}}});return;}const deviceId=Number(path.split("/").at(-2));await route.fulfill({json:{dashboardId:1,deviceId,url:state.linkUrl.replace("deviceId=7",`deviceId=${deviceId}`),bat:"@echo off\r\nREM synthetic public URL only\r\n"}});return;}
    if(path.endsWith("/device-management/v1/list")){
      const q=Object.fromEntries(new URL(req.url()).searchParams);state.listCalls.push(q);
      if(state.listDelay && q.search==="slow")await new Promise(r=>setTimeout(r,state.listDelay));
      if(state.listPageDelay&&q.page==="2")await new Promise(r=>setTimeout(r,state.listPageDelay));
      if(state.listError||state.flag||state.lifecycleFail||state.listConflict){const status=state.listConflict?409:state.listError||503;state.listConflict=false;await route.fulfill({status,json:{error:{code:status===409?"DASHBOARD_DEVICE_LIST_CHANGED":"FORBIDDEN",message:"PRIVATE STORAGE DETAIL"}}});return;}
      const all=state.devices.map(d=>({...d,isActive:!state.revoked&&d.isActive,revokedAtUtc:state.revoked?"2020-01-01T00:00:00Z":null,archivedAtUtc:state.archived?"2020-01-01T00:00:00Z":null,expiresAtUtc:state.expired?"2000-01-01T00:00:00Z":d.expiresAtUtc})).map(d=>({...d,status:d.archivedAtUtc?"ARCHIVED":d.revokedAtUtc?"REVOKED":d.expiresAtUtc&&Date.parse(d.expiresAtUtc)<=Date.now()?"EXPIRED":d.suspendedAtUtc?"SUSPENDED":d.reenrollmentRequired?"PENDING_REENROLLMENT":"UNVERIFIED"})).filter(d=>(q.status==="ALL"||d.status===q.status)&&(!q.search||d.deviceName.includes(q.search)||String(d.id)===q.search)).sort((a,b)=>a.id-b.id);
      const page=Number(q.page),pageSize=Number(q.pageSize);
      await route.fulfill({json:{items:all.slice((page-1)*pageSize,page*pageSize),total:all.length,page,pageSize,snapshot:"list-snapshot-"+state.revision,asOfUtc:"2026-10-31T00:00:00Z",validUntilUtc:"2026-10-31T00:05:00Z",sort:"ID_ASC",consistency:"CONTENT_CHECKED_UNTIL_EXPIRY",writeVersionIncluded:false}});return;
    }
    if (path.includes("/device-management/v1")) {
      const version = () => state.revision === 0 ? initialVersion : String(state.revision).repeat(64);
      if (req.method() === "GET") state.reads++;
      if ((state.safetyOnly && path.endsWith("/v1")) || (state.lifecycleFail && path.endsWith("/lifecycle"))) { await route.fulfill({status:state.safetyOnly?403:503,json:{error:{code:"FORBIDDEN",message:"PRIVATE STORAGE DETAIL"}}}); return; }
      if (req.method() !== "GET") state.writes.push({ path, method: req.method(), body: req.postDataJSON() });
      if (state.flag || (req.method() !== "GET" && state.failStatus)) { const status = state.flag ? 404 : state.failStatus; await route.fulfill({ status, json: { error: { code: state.flag ? "QUERY_SOURCE_MANAGEMENT_DISABLED" : status === 409 ? "DASHBOARD_DEVICE_VERSION_CONFLICT" : status === 403 ? "FORBIDDEN" : "QUERY_SOURCE_STORAGE_UNAVAILABLE", message: "PRIVATE STORAGE DETAIL" } } }); return; }
      let extra = {};
      if (req.method() !== "GET") {
        const body = req.postDataJSON();
        if (body.expectedVersion !== version() || body.confirmed !== true) { await route.fulfill({ status: 409, json: { error: { code: "DASHBOARD_DEVICE_VERSION_CONFLICT" } } }); return; }
        if (/\/(suspend|restore|credential|revoke|archive)$/.test(path)) {
          const d = state.devices[0]!;
          if (path.endsWith("/suspend")) { d.isActive = false; d.suspendedAtUtc = "2026-10-30T00:00:00Z"; d.reenrollmentRequired = true; }
          if (path.endsWith("/restore")) { d.isActive = true; d.suspendedAtUtc = null; d.reenrollmentRequired = true; }
          if (path.endsWith("/revoke")) { state.revoked = true; d.isActive = false; d.suspendedAtUtc = null; d.reenrollmentRequired = null; }
          if (path.endsWith("/archive")) state.archived = true;
          if (path.endsWith("/credential")) {
            state.revision++;
            if (state.tokenDelay) await new Promise(r => setTimeout(r, state.tokenDelay));
            await route.fulfill({json:{dashboardId:1,deviceId:7,version:version(),token:state.malformedToken?"invalid":"L".repeat(43),credentialIssued:true,reenrollmentRequired:true}}); return;
          }
          extra={deviceId:7,credentialIssued:false,deviceCredentialsInvalidated:true};
        }
        else if(path.endsWith("/renew")){state.devices[0]!.expiresAtUtc=new Date(Date.parse(state.devices[0]!.expiresAtUtc!)+body.days*86400000).toISOString();extra={deviceId:7,credentialIssued:false,deviceCredentialsInvalidated:false};}
        else if (req.method() === "POST") { state.devices.push({ ...state.devices[0]!, ...body.metadata, id: 8, sharedWorkstationId: null, createdByUserId: 1 }); extra = { deviceId: 8, credentialIssued: false }; }
        else if (path.endsWith("/metadata")) { Object.assign(state.devices[0]!, body.metadata); extra = { deviceId: 7, deviceCredentialsInvalidated: true }; }
        else { state.devices[0]!.placement = body.placement; extra = { deviceId: 7, deviceCredentialsInvalidated: false }; }
        state.revision++;
      }
      await route.fulfill({ json: { dashboardId: 1, version: version(), canCreate: state.createAllowed, devices: state.devices.map(d => ({ ...d, isActive: !state.revoked && d.isActive, revokedAtUtc: state.revoked ? "2020-01-01T00:00:00Z" : null, archivedAtUtc: state.archived ? "2020-01-01T00:00:00Z" : null, expiresAtUtc: state.expired ? "2000-01-01T00:00:00Z" : d.expiresAtUtc })), ...extra } }); return;
    }
    if (req.method() !== "GET" && path.includes("/devices")) state.oldWrites++;
    if (path.endsWith("/query-mode/v1")) { await route.fulfill({ status: 404, json: { error: { code: "QUERY_DEVICE_PLAYBACK_DISABLED" } } }); return; }
    if (path.endsWith("/configuration")) { await route.fulfill({ json: { version: initialVersion, dashboardMode: state.mode, isActive: false, editable: true,
      primary: { sourceKey: "PRIMARY", queryDefinitionId: 20, parameters: {}, refreshSeconds: 5, pageSeconds: 5, pageSize: 1, maxRows: 100 }, sources: [] } }); return; }
    if (path.endsWith("/column-approvals")) { await route.fulfill({ json: { dashboardId: 1, isActive: false, version: initialVersion, sources: [{ id: 1, sourceKey: "PRIMARY", datasetId: 3 }], deviceColumnMasks: {}, deviceColumnTypes: {}, deviceSourceColumnMasks: {} } }); return; }
    if (path === "/api/dashboards/1/devices") { await route.fulfill({ json: { devices: state.devices } }); return; }
    if (path === "/api/dashboards") { await route.fulfill({ json: { dashboards: [{ id: 1, code: "SYNTHETIC", name: "合成看板", queryDefinitionId: 20, parameters: {}, refreshSeconds: 5, pageSize: 1, pageSeconds: 5, isActive: false }], total: 1, totalPages: 1 } }); return; }
    if (path.endsWith("/branding")) { await route.fulfill({ json: { organizationName: "Synthetic", platformName: "UQP", platformTitle: "UQP", platformSubtitle: "Synthetic" } }); return; }
    await route.fulfill({ json: { queryDefinitions: [], queries: [], devices: [], parameters: [], profiles: [] } });
  });
  page.on("dialog", dialog => void dialog.accept());
  await page.goto("/designer/dashboards"); await page.getByRole("button", { name: "編輯", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "版本化裝置基本管理" });
  await expect(panel.getByRole("button", { name: execute ? "建立未授權裝置" : "暫停 合成裝置", exact: true })).toBeEnabled();
  return { state, panel };
}
test("create metadata-only device while playback flag is off; explicit delegator, no credential or Legacy fallback", async ({ page }) => {
  const { state, panel } = await setup(page);
  await panel.getByRole("button", { name: "建立未授權裝置", exact: true }).click();
  await panel.getByLabel("裝置名稱", { exact: true }).fill("新合成裝置");
  await panel.getByLabel("裝置到期時間（Asia/Taipei）").fill("2099-01-01 08:00");
  await panel.getByRole("button", { name: "確認保存裝置設定" }).click();
  await expect(panel.getByText(/裝置設定已保存；未核發憑證/)).toBeVisible();
  await expect(panel.getByText(/新合成裝置；委派者 1/)).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(state.writes[0]!.method).toBe("POST"); expect(state.writes[0]!.body.expectedVersion).toBe(initialVersion);
  expect(state.writes[0]!.body.confirmed).toBe(true); expect(state.writes[0]!.body.metadata).not.toHaveProperty("createdByUserId");
  expect(state.oldWrites).toBe(0); await expect(page.getByRole("button", { name: "清除本頁憑證" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "建立未授權裝置", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "重新載入裝置設定" }).click(); await expect(panel.getByRole("button", { name: "建立未授權裝置", exact: true })).toBeEnabled();
});
test("metadata edit saves name/IP/expiry and reloads exact values; original delegator/workstation cannot be edited", async ({ page }) => {
  const { state, panel } = await setup(page);
  await panel.getByRole("button", { name: "編輯 合成裝置 基本設定" }).click();
  await expect(panel.getByLabel("允許 IP", { exact: true })).toHaveValue("192.0.2.1");
  await panel.getByLabel("裝置名稱", { exact: true }).fill("合成新名稱"); await panel.getByLabel("允許 IP", { exact: true }).fill("192.0.2.20");
  await panel.getByLabel("裝置到期時間（Asia/Taipei）").fill("2099-01-01 08:00"); await panel.getByRole("button", { name: "確認保存裝置設定" }).click();
  await expect(panel.getByText(/既有裝置須明確重新授權/)).toBeVisible();
  await panel.getByRole("button", { name: "重新載入裝置設定" }).click(); await panel.getByRole("button", { name: "編輯 合成新名稱 基本設定" }).click();
  await expect(panel.getByLabel("允許 IP", { exact: true })).toHaveValue("192.0.2.20"); await expect(panel.getByLabel("裝置到期時間（Asia/Taipei）")).toHaveValue("2099-01-01 08:00");
  expect(state.devices[0]!.createdByUserId).toBe(2); expect(state.devices[0]!.sharedWorkstationId).toBe(3); expect(state.oldWrites).toBe(0);
});
test("existing placement loads without overwriting, preserves all fields and persists through reload", async ({ page }) => {
  const { state, panel } = await setup(page);
  await panel.getByRole("button", { name: "編輯 合成裝置 播放位置" }).click();
  await expect(panel.getByLabel("播放瀏覽器")).toHaveValue("chrome"); await expect(panel.getByLabel("指定螢幕")).toHaveValue("3");
  await expect(panel.getByLabel("視窗 X", { exact: true })).toHaveValue("-2000"); expect(state.writes).toHaveLength(0);
  await panel.getByLabel("視窗寬度").fill("1400"); await panel.getByRole("button", { name: "確認保存裝置設定" }).click();
  await expect(panel.getByText(/播放位置已保存/)).toBeVisible(); expect(state.writes[0]!.body.placement).toEqual({ browser: "chrome", screenNumber: 3, fullscreen: false, windowX: -2000, windowY: 100, windowWidth: 1400, windowHeight: 800 });
  await panel.getByRole("button", { name: "重新載入裝置設定" }).click(); await panel.getByRole("button", { name: "編輯 合成裝置 播放位置" }).click(); await expect(panel.getByLabel("視窗寬度")).toHaveValue("1400"); expect(state.oldWrites).toBe(0);
});
for (const status of [403, 409, 503]) test(`write failure ${status} preserves draft and requires explicit reload without retry`, async ({ page }) => {
  const { state, panel } = await setup(page); state.failStatus = status;
  await panel.getByRole("button", { name: "編輯 合成裝置 基本設定" }).click(); await panel.getByLabel("裝置名稱", { exact: true }).fill("未儲存草稿");
  await panel.getByRole("button", { name: "確認保存裝置設定" }).click();
  await expect(panel.getByText(/草稿已保留；請明確重新載入/)).toBeVisible(); await expect(panel.getByLabel("裝置名稱", { exact: true })).toHaveValue("未儲存草稿");
  await expect(panel.getByRole("button", { name: "確認保存裝置設定" })).toBeDisabled(); expect(state.writes).toHaveLength(1); expect(state.oldWrites).toBe(0);
  await expect(panel).not.toContainText("PRIVATE STORAGE DETAIL"); await expect(panel).not.toContainText("裝置設定已保存");
  state.failStatus = 0; await panel.getByRole("button", { name: "重新載入裝置設定" }).click(); await expect(panel.getByRole("button", { name: "建立未授權裝置", exact: true })).toBeEnabled();
});
test("metadata API disabled remains fail-closed despite available Legacy read APIs", async ({ page }) => {
  const { state, panel } = await setup(page); state.flag = true;
  await panel.getByRole("button", { name: "重新載入裝置設定" }).click();
  await expect(panel.getByRole("button", { name: "建立未授權裝置", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "編輯 合成裝置 基本設定" })).toHaveCount(0);
  expect(state.writes).toHaveLength(0); expect(state.oldWrites).toBe(0);
});
test("revoked, archived and expired devices cannot be restored by settings; active Dashboard creation denied", async ({ page }) => {
  const { state, panel } = await setup(page); state.createAllowed = false;
  for (const key of ["revoked", "archived", "expired"] as const) {
    state.revoked = state.archived = state.expired = false; state[key] = true;
    await panel.getByRole("button", { name: "重新載入裝置設定" }).click();
    await expect(panel.getByRole("button", { name: "編輯 合成裝置 基本設定" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "編輯 合成裝置 播放位置" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "建立未授權裝置", exact: true })).toBeDisabled();
  }
  expect(state.writes).toHaveLength(0);
});
test("cross-section change invalidates authority while preserving draft", async ({ page }) => {
  const { state, panel } = await setup(page);
  await panel.getByRole("button", { name: "編輯 合成裝置 基本設定" }).click(); await panel.getByLabel("裝置名稱", { exact: true }).fill("跨區草稿");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId: 1, origin: "layout" } })));
  await expect(panel.getByLabel("裝置名稱", { exact: true })).toHaveValue("跨區草稿"); await expect(panel.getByRole("button", { name: "確認保存裝置設定" })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

test("saved settings automatically show configured device URL with copy/open/BAT; no new credential",async({page})=>{
 const {state,panel}=await setup(page);await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
 await panel.getByRole("button",{name:"編輯 合成裝置 播放位置"}).click();await panel.getByRole("button",{name:"確認保存裝置設定"}).click();
 const url=panel.getByRole("textbox",{name:"裝置 7 播放網址",exact:true});await expect(url).toHaveValue(state.linkUrl);
 await panel.getByRole("button",{name:"複製播放網址",exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(state.linkUrl);
 await expect(panel.getByRole("link",{name:"開啟播放網址",exact:true})).toHaveAttribute("href",state.linkUrl);await expect(panel.getByRole("link",{name:"開啟播放網址",exact:true})).toHaveAttribute("rel","noopener noreferrer");
 const downloadPromise=page.waitForEvent("download");await panel.getByRole("button",{name:"下載 Windows BAT",exact:true}).click();expect((await downloadPromise).suggestedFilename()).toBe("UQP-device-7.bat");
 expect(state.writes).toHaveLength(1);expect(state.oldWrites).toBe(0);
});
for(const [code,status,text] of [
 ["PLAYBACK_ORIGIN_REQUIRED",503,"尚未設定播放網址"],
 ["PLAYBACK_ORIGIN_INVALID",503,"播放網址設定不正確"],
 ["PLAYBACK_PLACEMENT_INVALID",409,"播放位置設定無效"],
 ["DASHBOARD_DEVICE_NOT_EDITABLE",409,"裝置已失效"],
 ["FORBIDDEN",403,"無權限取得播放網址"],
 ["QUERY_SOURCE_STORAGE_UNAVAILABLE",503,"播放網址暫不可用"],
] as const)test(`playback URL failure ${code} is adjacent, actionable and hides private diagnostics`,async({page})=>{
 const {state,panel}=await setup(page);state.linkCode=code;state.linkStatus=status;
 await panel.getByRole("button",{name:"顯示 合成裝置 播放網址"}).click();await expect(panel.getByRole("alert")).toContainText(text);
 await expect(panel).not.toContainText("PRIVATE_SQL_TOKEN");await expect(panel.getByRole("link",{name:"開啟播放網址"})).toHaveCount(0);
 if(code.startsWith("PLAYBACK_ORIGIN"))await expect(panel.getByRole("alert")).toContainText("DASHBOARD_PUBLIC_CLIENT_ORIGIN");
 state.linkCode="";await panel.getByRole("button",{name:"顯示 合成裝置 播放網址"}).click();await expect(panel.getByRole("textbox",{name:"裝置 7 播放網址",exact:true})).toHaveValue(state.linkUrl);expect(state.writes).toHaveLength(0);
});
test("playback URL request shows progress, suppresses duplicate clicks and discards stale links on invalidation",async({page})=>{
 const{state,panel}=await setup(page);state.linkDelay=700;
 const button=panel.getByRole("button",{name:"顯示 合成裝置 播放網址"});await button.click();await expect(button).toBeDisabled();await expect(button).toHaveAttribute("aria-busy","true");await expect(panel.getByText("正在產生播放網址…",{exact:true})).toBeVisible();
 await expect(panel.getByRole("textbox",{name:"裝置 7 播放網址",exact:true})).toHaveValue(state.linkUrl);expect(state.linkReads).toBe(1);
 await button.click();await page.evaluate(()=>window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed",{detail:{dashboardId:1}})));
 await expect(panel.getByRole("textbox",{name:"裝置 7 播放網址",exact:true})).toHaveCount(0);
 await page.waitForTimeout(900);await expect(panel.getByRole("link",{name:"開啟播放網址"})).toHaveCount(0);await expect(button).toBeEnabled();
});
test("save succeeds independently of missing playback origin; administrator sees a repairable error",async({page})=>{
 const{state,panel}=await setup(page);state.linkCode="PLAYBACK_ORIGIN_REQUIRED";
 await panel.getByRole("button",{name:"建立未授權裝置",exact:true}).click();await panel.getByLabel("裝置名稱",{exact:true}).fill("待設定來源裝置");await panel.getByRole("button",{name:"確認保存裝置設定"}).click();
 await expect(panel.getByText(/裝置設定已保存；未核發憑證/)).toBeVisible();await expect(panel.getByRole("alert")).toContainText("DASHBOARD_PUBLIC_CLIENT_ORIGIN");expect(state.writes).toHaveLength(1);await expect(panel.getByRole("link",{name:"開啟播放網址"})).toHaveCount(0);
});
test("clipboard denial falls back to public field; failed fallback explains manual copy",async({page})=>{
 const{panel}=await setup(page);await panel.getByRole("button",{name:"顯示 合成裝置 播放網址"}).click();await expect(panel.getByRole("link",{name:"開啟播放網址"})).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:()=>Promise.reject(new Error("denied"))}});document.execCommand=()=>true;});
 await panel.getByRole("button",{name:"複製播放網址",exact:true}).click();await expect(panel.getByText("已複製播放網址。",{exact:true})).toBeVisible();
 await page.evaluate(()=>{document.execCommand=()=>false;});await panel.getByRole("button",{name:"複製播放網址",exact:true}).click();await expect(panel.getByRole("alert")).toContainText("請選取播放網址手動複製");
});
test("opening configured public URL creates an isolated new window",async({page})=>{
 const{panel}=await setup(page);await panel.getByRole("button",{name:"顯示 合成裝置 播放網址"}).click();await expect(panel.getByRole("link",{name:"開啟播放網址"})).toBeVisible();
 await page.context().route("https://hospital.example:8443/**",route=>route.fulfill({contentType:"text/html",body:"<p>Synthetic public playback</p>"}));
 const opened=page.waitForEvent("popup");await panel.getByRole("link",{name:"開啟播放網址"}).click();const popup=await opened;await popup.waitForLoadState();expect(await popup.evaluate(()=>window.opener===null)).toBe(true);await expect(popup.getByText("Synthetic public playback")).toBeVisible();await popup.close();
});
test("stalled playback URL request reaches a visible deadline and allows retry",async({page})=>{
 const{panel}=await setup(page);await page.clock.install();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const match="**/api/dashboards/1/device-management/v1/7/playback-link";
 await page.route(match,async route=>{await gate;await route.abort().catch(()=>{});});
 try{
  const request=page.waitForRequest(r=>r.url().endsWith("/7/playback-link"));const button=panel.getByRole("button",{name:"顯示 合成裝置 播放網址"});await button.click();await request;
  await expect(button).toBeDisabled();await page.clock.fastForward(15001);await expect(panel.getByRole("alert")).toContainText("連線逾時");await expect(button).toBeEnabled();
 }finally{release();await page.unroute(match);}
 await panel.getByRole("button",{name:"顯示 合成裝置 播放網址"}).click();await expect(panel.getByRole("link",{name:"開啟播放網址"})).toBeVisible();
});
for(const url of ["https://hospital.example/display/dashboards/2?deviceId=7","https://hospital.example/display/dashboards/1?deviceId=7&token=secret"])test(`invalid playback link is not shown: ${url}`,async({page})=>{
 const {state,panel}=await setup(page);state.linkUrl=url;await panel.getByRole("button",{name:"顯示 合成裝置 播放網址"}).click();await expect(panel.getByText(/播放網址回應格式不正確/)).toBeVisible();await expect(panel.getByRole("link",{name:"開啟播放網址"})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});

test("30/7/0 expiry reminders use existing alert API, no-expiry is explicit, renewal preserves token",async({page})=>{
 const {state,panel}=await setup(page);await expect(panel.getByText(/未設定到期日/)).toBeVisible();await expect(panel.getByRole("button",{name:"續期 合成裝置",exact:true})).toBeDisabled();
 for(const [days,text]of [[30,"30 天內到期"],[7,"7 天內到期"],[0,"已到期，不可續期"]] as const){state.devices[0]!.expiresAtUtc=new Date(Date.now()+days*86400000).toISOString();await panel.getByRole("button",{name:"重新載入裝置設定"}).click();await expect(panel.getByText(new RegExp(text))).toBeVisible();await expect(panel.getByRole("button",{name:"續期 合成裝置",exact:true}))[days===0?"toBeDisabled":"toBeEnabled"]();}
 state.devices[0]!.expiresAtUtc=new Date(Date.now()+7*86400000).toISOString();await panel.getByRole("button",{name:"重新載入裝置設定"}).click();await expect(panel.getByText(/30 天內 1 台；7 天內 1 台；已到期 0 台/)).toBeVisible();
 await panel.getByRole("button",{name:"續期 合成裝置",exact:true}).click();await panel.getByLabel("延長天數",{exact:true}).fill("30");await panel.getByRole("button",{name:"確認安全續期",exact:true}).click();await expect(panel.getByText(/裝置已安全續期；未重新核發 Token/)).toBeVisible();
 expect(state.writes).toHaveLength(1);expect(state.writes[0]!.path).toMatch(/device-management\/v1\/7\/renew$/);expect(state.writes[0]!.body).toEqual({expectedVersion:initialVersion,confirmed:true,days:30});expect(state.oldWrites).toBe(0);
 await panel.getByRole("button",{name:"重新載入裝置設定"}).click();await expect(panel.getByText(/30 天內 0 台；7 天內 0 台/)).toBeVisible();
});
for(const status of [403,409,503])test(`renewal ${status} is explicit, versioned and never retried`,async({page})=>{
 const {state,panel}=await setup(page);state.devices[0]!.expiresAtUtc=new Date(Date.now()+86400000).toISOString();await panel.getByRole("button",{name:"重新載入裝置設定"}).click();await panel.getByRole("button",{name:"續期 合成裝置",exact:true}).click();
 await panel.getByLabel("延長天數").fill("366");await expect(panel.getByRole("button",{name:"確認安全續期"})).toBeDisabled();expect(state.writes).toHaveLength(0);
 await panel.getByLabel("延長天數").fill("30");state.failStatus=status;await panel.getByRole("button",{name:"確認安全續期"}).click();await expect(panel.getByText(/續期未完成，請明確重新載入/)).toBeVisible();await expect(panel.getByRole("button",{name:"確認安全續期"})).toBeDisabled();expect(state.writes).toHaveLength(1);await expect(panel).not.toContainText("PRIVATE STORAGE DETAIL");
});
test("HTTP manual URL copies with visible-field fallback and makes persistence limitation explicit",async({page})=>{
 const {state,panel}=await setup(page);state.linkUrl="http://hospital.example:8080/display/dashboards/1?deviceId=7";
 await page.evaluate(()=>{Object.defineProperty(navigator,"clipboard",{configurable:true,value:undefined});document.execCommand=()=>true;});
 await panel.getByRole("button",{name:"顯示 合成裝置 播放網址"}).click();await expect(panel.getByRole("textbox",{name:"裝置 7 播放網址",exact:true})).toHaveValue(state.linkUrl);
 await expect(panel.getByText(/HTTP 僅供手動播放/)).toBeVisible();await panel.getByRole("button",{name:"複製播放網址",exact:true}).click();await expect(panel.getByText("已複製播放網址。",{exact:true})).toBeVisible();expect(await panel.getByRole("textbox",{name:"裝置 7 播放網址",exact:true}).evaluate((el:HTMLInputElement)=>el.selectionEnd!-el.selectionStart!)).toBe(state.linkUrl.length);
});
test("reminder read failure is explicit and never presented as zero expiring devices",async({page})=>{const{state,panel}=await setup(page);state.alertFail=true;await panel.getByRole("button",{name:"重新載入裝置設定"}).click();await expect(panel.getByText(/到期提醒暫時無法讀取/)).toBeVisible();await expect(panel.getByText(/到期提醒：30 天內/)).toHaveCount(0);expect(state.writes).toHaveLength(0);});

test("lifecycle pause confirmation, restore pending, credential once and archive use complete versions", async ({page}) => {
  const {state,panel}=await setup(page);
  const lifecycle=panel.getByLabel("裝置 7 生命週期");
  await expect(lifecycle).toContainText("未驗證");
  page.removeAllListeners("dialog");
  page.once("dialog", d=>{expect(d.message()).toContain("舊 Token");void d.dismiss();});
  await lifecycle.getByRole("button",{name:"暫停 合成裝置",exact:true}).click(); expect(state.writes).toHaveLength(0);
  page.on("dialog",d=>void d.accept());
  await lifecycle.getByRole("button",{name:"暫停 合成裝置",exact:true}).click();
  await expect(lifecycle).toContainText("暫停");
  expect(state.writes[0]!.body).toEqual({expectedVersion:initialVersion,confirmed:true});
  await expect(lifecycle.getByRole("button",{name:"恢復 合成裝置",exact:true})).toBeDisabled();
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await lifecycle.getByRole("button",{name:"恢復 合成裝置",exact:true}).click();
  await expect(lifecycle).toContainText("待重新註冊");
  await expect(lifecycle).not.toContainText("啟用設定");
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await lifecycle.getByRole("button",{name:"核發新 Token 合成裝置",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"一次性新 Token"});
  await expect(dialog.getByLabel("新 Token（僅顯示一次）")).toHaveValue("L".repeat(43));
  await expect(dialog).toContainText("原 BAT 專用瀏覽器");
  await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(value:string)=>{(window as any).__copied=value;}}}));
  await dialog.getByRole("button",{name:"複製新 Token",exact:true}).click();
  await expect(dialog).toContainText("已複製 Token");
  expect(await page.evaluate(()=>(window as any).__copied)).toBe("L".repeat(43));
  expect(await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join(" "))).not.toContain("L".repeat(43));
  expect(page.url()).not.toContain("L".repeat(43));
  await dialog.getByRole("button",{name:"關閉並清除新 Token"}).click();
  expect(await page.locator("body").innerHTML()).not.toContain("L".repeat(43));
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await expect(page.getByLabel("新 Token（僅顯示一次）")).toHaveCount(0);
  page.removeAllListeners("dialog");
  page.once("dialog",d=>{expect(d.message()).toContain("原 Token 不可恢復");void d.dismiss();});
  await lifecycle.getByRole("button",{name:"永久撤銷 合成裝置",exact:true}).click();
  expect(state.writes).toHaveLength(3);
  page.on("dialog",d=>void d.accept());
  await lifecycle.getByRole("button",{name:"永久撤銷 合成裝置",exact:true}).click();
  await expect(lifecycle).toContainText("已撤銷");
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await lifecycle.getByRole("button",{name:"封存 合成裝置",exact:true}).click();
  await expect(lifecycle).toContainText("已封存");
  await expect(lifecycle.getByRole("button")).toHaveCount(0);
  expect(state.writes.map(w=>w.path.split("/").at(-1))).toEqual(["suspend","restore","credential","revoke","archive"]);
  expect(state.writes.every((w,i)=>w.method==="POST"&&w.body.confirmed===true&&w.body.expectedVersion===(i===0?initialVersion:String(i).repeat(64)))).toBe(true);
});
for (const status of [401,403,409,503]) test(`lifecycle ${status} invalidates version without retry or private error text`,async({page})=>{
  const {state,panel}=await setup(page);state.failStatus=status;
  await panel.getByRole("button",{name:"暫停 合成裝置",exact:true}).click();
  await expect(panel).toContainText("請重新載入後再次確認，不會自動重送");
  await expect(panel.getByRole("button",{name:"暫停 合成裝置",exact:true})).toBeDisabled();
  expect(state.writes).toHaveLength(1);await expect(panel).not.toContainText("PRIVATE STORAGE DETAIL");
  state.failStatus=0;await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await panel.getByRole("button",{name:"暫停 合成裝置",exact:true}).click();
  await expect(panel.getByLabel("裝置 7 生命週期")).toContainText("暫停");expect(state.writes).toHaveLength(2);
});
test("DESIGN_QUERY safety read works when full Query ACL read is denied",async({page})=>{
  const {state,panel}=await setup(page,false);state.safetyOnly=true;
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await expect(panel.getByRole("button",{name:"暫停 合成裝置",exact:true})).toBeEnabled();
  await panel.getByRole("button",{name:"暫停 合成裝置",exact:true}).click();
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await expect(panel.getByRole("button",{name:"恢復 合成裝置",exact:true})).toHaveCount(0);
  await expect(panel.getByRole("button",{name:"核發新 Token 合成裝置",exact:true})).toHaveCount(0);
  await expect(panel.getByRole("button",{name:"永久撤銷 合成裝置",exact:true})).toBeEnabled();
});
for(const event of ["pagehide","configuration"] as const) test(`one-time Token clears on ${event} and stale credential response is ignored`,async({page})=>{
  const {state,panel}=await setup(page);state.devices[0]!.reenrollmentRequired=true;
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await panel.getByRole("button",{name:"核發新 Token 合成裝置",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"一次性新 Token"})).toBeVisible();
  await page.evaluate(event=>window.dispatchEvent(event==="pagehide"?new Event("pagehide"):new CustomEvent("uqp.dashboard.configuration.changed",{detail:{dashboardId:1}})),event);
  await expect(page.getByRole("dialog",{name:"一次性新 Token"})).toHaveCount(0);
  expect(await page.locator("body").innerHTML()).not.toContain("L".repeat(43));
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();state.tokenDelay=300;
  await panel.getByRole("button",{name:"核發新 Token 合成裝置",exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(400);await expect(page.getByRole("dialog",{name:"一次性新 Token"})).toHaveCount(0);
});
test("missing lifecycle schema offers no fallback write; malformed credential never displays",async({page})=>{
  const {state,panel}=await setup(page);state.lifecycleFail=true;
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await expect(panel.getByRole("button",{name:"暫停 合成裝置",exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
  state.lifecycleFail=false;state.devices[0]!.reenrollmentRequired=true;state.malformedToken=true;
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await panel.getByRole("button",{name:"核發新 Token 合成裝置",exact:true}).click();
  await expect(panel).toContainText("不會自動重送");await expect(page.getByRole("dialog",{name:"一次性新 Token"})).toHaveCount(0);
});
for (const close of ["escape","navigation","reload"] as const) test(`lifecycle Token cannot be recovered after ${close}`,async({page})=>{
  const {state,panel}=await setup(page);state.devices[0]!.reenrollmentRequired=true;
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await panel.getByRole("button",{name:"核發新 Token 合成裝置",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"一次性新 Token"})).toBeVisible();
  if(close==="escape") await page.keyboard.press("Escape");
  else if(close==="navigation") await page.goto("/dashboards");
  else await page.reload();
  await expect(page.getByRole("dialog",{name:"一次性新 Token"})).toHaveCount(0);
  expect(await page.locator("body").innerHTML()).not.toContain("L".repeat(43));
  expect(state.writes.filter(w=>w.path.endsWith("/credential"))).toHaveLength(1);
});
test("360px lifecycle dialog and denied clipboard preserve one-time manual copy",async({page})=>{
  await page.setViewportSize({width:360,height:800});
  const {state,panel}=await setup(page);state.devices[0]!.reenrollmentRequired=true;
  await page.evaluate(()=>{Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw new Error("denied");}}});});
  await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
  await panel.getByRole("button",{name:"核發新 Token 合成裝置",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"一次性新 Token"});
  await dialog.getByRole("button",{name:"複製新 Token",exact:true}).click();
  await expect(dialog).toContainText("無法自動複製，請選取 Token 手動複製");
  await expect(dialog.getByLabel("新 Token（僅顯示一次）")).toHaveValue("L".repeat(43));
  const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);
  await dialog.getByRole("button",{name:"關閉並清除新 Token"}).click();
  expect(await page.locator("body").innerHTML()).not.toContain("L".repeat(43));
});
for(const timezoneId of ["America/Los_Angeles","Asia/Tokyo"]) test.describe(`Taipei expiry in ${timezoneId}`,()=>{
  test.use({timezoneId});
  test("unchanged seconds survive metadata save; calendar sets explicit Taipei minute",async({page})=>{
    const {state,panel}=await setup(page);state.devices[0]!.expiresAtUtc="2099-02-28T23:59:42.123Z";
    await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
    await panel.getByRole("button",{name:"編輯 合成裝置 基本設定"}).click();
    await page.clock.setFixedTime(new Date("2099-02-28T23:59:30Z"));
    await expect(panel.getByLabel("裝置到期時間（Asia/Taipei）")).toHaveValue("2099-03-01 07:59");
    await panel.getByLabel("裝置名稱",{exact:true}).fill("保留秒數");
    await panel.getByRole("button",{name:"確認保存裝置設定"}).click();
    expect(state.writes[0]!.body.metadata.expiresAtUtc).toBe("2099-02-28T23:59:42.123Z");
    await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
    await panel.getByRole("button",{name:"編輯 保留秒數 基本設定"}).click();
    await panel.getByRole("button",{name:"開啟到期日期時間選擇器"}).click();
    const dialog=page.getByRole("dialog",{name:"選擇授權到期日期時間"});
    await dialog.getByLabel("到期日期",{exact:true}).fill("2099-03-02");
    await dialog.getByLabel("到期小時").selectOption("00");await dialog.getByLabel("到期分鐘").selectOption("01");
    await dialog.getByRole("button",{name:"套用到期時間"}).click();
    await panel.getByRole("button",{name:"確認保存裝置設定"}).click();
    expect(state.writes[1]!.body.metadata.expiresAtUtc).toBe("2099-03-01T16:01:00.000Z");
  });
});
test.describe("touch expiry",()=>{
  test.use({hasTouch:true});
test("invalid and past expiry block writes; cancel preserves original; blank saves NULL on mobile",async({page})=>{
  await page.setViewportSize({width:360,height:800});
  const {state,panel}=await setup(page);
  await panel.getByRole("button",{name:"編輯 合成裝置 基本設定"}).click();
  const input=panel.getByLabel("裝置到期時間（Asia/Taipei）");
  for(const value of ["2027-02-29 10:00","2000-01-01 12:00","2099-01-01 10:00:59"]){
    await input.fill(value);await expect(input).toHaveAttribute("aria-invalid","true");
    await expect(panel.getByRole("button",{name:"確認保存裝置設定"})).toBeDisabled();
  }
  expect(state.writes).toHaveLength(0);
  await input.fill("2099-01-01 08:00");
  await panel.getByRole("button",{name:"開啟到期日期時間選擇器"}).tap();
  const dialog=page.getByRole("dialog",{name:"選擇授權到期日期時間"});
  await dialog.getByLabel("到期小時").selectOption("23");
  await dialog.getByRole("button",{name:"取消日期選擇"}).click();
  await expect(input).toHaveValue("2099-01-01 08:00");
  await input.fill("");await panel.getByRole("button",{name:"確認保存裝置設定"}).click();
  expect(state.writes[0]!.body.metadata.expiresAtUtc).toBe(null);
});
});

function populateDevices(state: Awaited<ReturnType<typeof setup>>["state"]) {
  for(let id=8;id<=43;id++)state.devices.push({...state.devices[0]!,id,deviceName:`裝置 ${id}`});
}
test("server paging uses first snapshot, fixed sort, total and all supported sizes",async({page})=>{
 const {state,panel}=await setup(page);populateDevices(state);
 await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
 const rows=panel.getByRole("list",{name:"裝置分頁清單"}).getByRole("listitem");
 await expect(rows).toHaveCount(20);await expect(panel.getByRole("navigation",{name:"裝置清單分頁"})).toContainText("共 37 筆；第 1／2 頁");
 expect(state.listCalls.at(-1)!.snapshot).toBeUndefined();
 await panel.getByRole("button",{name:"下一頁裝置"}).click();await expect(rows).toHaveCount(17);
 expect(state.listCalls.at(-1)!.page).toBe("2");expect(state.listCalls.at(-1)!.snapshot).toBe("list-snapshot-0");
 await expect(rows.first()).toContainText("裝置 27");
 await panel.getByRole("button",{name:"上一頁裝置"}).click();await expect(rows).toHaveCount(20);
 expect(state.listCalls.at(-1)!.snapshot).toBeUndefined();
 for(const size of [10,20,50,100]){await panel.getByLabel("裝置每頁筆數").selectOption(String(size));await expect(rows).toHaveCount(Math.min(size,37));expect(state.listCalls.at(-1)!.page).toBe("1");expect(state.listCalls.at(-1)!.snapshot).toBeUndefined();}
});
test("explicit search and status changes reset snapshot; UNVERIFIED is not ACTIVE",async({page})=>{
 const {state,panel}=await setup(page);populateDevices(state);
 await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
 await panel.getByRole("button",{name:"下一頁裝置"}).click();await expect(panel.getByRole("navigation",{name:"裝置清單分頁"})).toContainText("第 2／2 頁");
 const before=state.listCalls.length;
 await panel.getByLabel("裝置搜尋關鍵字").fill("27");expect(state.listCalls).toHaveLength(before);
 await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await expect(panel.getByRole("list",{name:"裝置分頁清單"})).toContainText("裝置 27");expect(state.listCalls.at(-1)!.search).toBe("27");expect(state.listCalls.at(-1)!.snapshot).toBeUndefined();
 await panel.getByLabel("裝置狀態篩選").selectOption("ACTIVE");await expect(panel.getByText("沒有符合條件的裝置。",{exact:true})).toBeVisible();
 await panel.getByLabel("裝置狀態篩選").selectOption("UNVERIFIED");await expect(panel.getByLabel("裝置 27 生命週期")).toContainText("未驗證");
 for(const status of ["SUSPENDED","PENDING_REENROLLMENT","REVOKED","ARCHIVED","EXPIRED"]){await panel.getByLabel("裝置狀態篩選").selectOption(status);await expect(panel.getByText("沒有符合條件的裝置。",{exact:true})).toBeVisible();expect(state.listCalls.at(-1)!.status).toBe(status);}
});
test("409 discards old items and snapshot, reloads page one and never resends a write",async({page})=>{
 const {state,panel}=await setup(page);populateDevices(state);
 await panel.getByRole("button",{name:"重新載入裝置設定"}).click();
 await expect(panel.getByRole("button",{name:"下一頁裝置"})).toBeEnabled();state.listConflict=true;
 await panel.getByRole("button",{name:"下一頁裝置"}).click();
 await expect(panel.getByText("清單已更新或已到期，已清除舊清單，重新從第一頁載入。",{exact:true})).toBeVisible();
 await expect(panel.getByRole("navigation",{name:"裝置清單分頁"})).toContainText("第 1／2 頁");
 expect(state.listCalls.at(-2)!.snapshot).toBe("list-snapshot-0");expect(state.listCalls.at(-1)!.snapshot).toBeUndefined();expect(state.writes).toHaveLength(0);
});
test("quick search ignores late response; unmount discards pending list",async({page})=>{
 const {state,panel}=await setup(page);state.listDelay=400;
 await panel.getByLabel("裝置搜尋關鍵字").fill("slow");await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await expect(panel.getByText("裝置清單載入中…",{exact:true})).toBeVisible();
 await panel.getByLabel("裝置搜尋關鍵字").fill("7");await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await expect(panel.getByRole("list",{name:"裝置分頁清單"})).toContainText("合成裝置");
 await page.waitForTimeout(500);await expect(panel.getByRole("list",{name:"裝置分頁清單"})).toContainText("合成裝置");
 await panel.getByLabel("裝置搜尋關鍵字").fill("slow");await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await page.goto("/dashboards");await page.waitForTimeout(500);await expect(page.getByRole("list",{name:"裝置分頁清單"})).toHaveCount(0);
});
for(const status of [401,403,503])test(`list ${status} clears rows and offers safe retry without full-snapshot fallback`,async({page})=>{
 const {state,panel}=await setup(page);state.listError=status;
 await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await expect(panel.getByRole("button",{name:"重試裝置清單"})).toBeVisible();
 await expect(panel.getByRole("list",{name:"裝置分頁清單"}).getByRole("listitem")).toHaveCount(0);
 await expect(panel).not.toContainText("PRIVATE STORAGE DETAIL");if(status===403)await expect(panel.getByRole("alert")).toContainText("權限不足");
 state.listError=0;await panel.getByRole("button",{name:"重試裝置清單"}).click();await expect(panel.getByRole("list",{name:"裝置分頁清單"})).toContainText("合成裝置");
});
test("life operation refresh preserves filters but drops snapshot and write uses full expectedVersion",async({page})=>{
 const {state,panel}=await setup(page);await panel.getByLabel("裝置狀態篩選").selectOption("UNVERIFIED");
 await expect(panel.getByRole("button",{name:"暫停 合成裝置",exact:true})).toBeEnabled();
 await panel.getByRole("button",{name:"暫停 合成裝置",exact:true}).click();
 await expect(panel.getByText("沒有符合條件的裝置。",{exact:true})).toBeVisible();
 expect(state.writes[0]!.body).toEqual({expectedVersion:initialVersion,confirmed:true});expect(state.listCalls.at(-1)!.status).toBe("UNVERIFIED");expect(state.listCalls.at(-1)!.snapshot).toBeUndefined();
});
test.describe("touch paged list",()=>{test.use({hasTouch:true});test("narrow controls and paging fit without horizontal overflow",async({page})=>{
 const {state,panel}=await setup(page);populateDevices(state);await page.setViewportSize({width:390,height:844});
 await panel.getByRole("button",{name:"重新載入裝置設定"}).click();await expect(panel.getByRole("button",{name:"下一頁裝置"})).toBeEnabled();
 await panel.getByRole("button",{name:"下一頁裝置"}).tap();await expect(panel.getByRole("navigation",{name:"裝置清單分頁"})).toContainText("第 2／2 頁");
 const size=await panel.locator(".uqp-device-list-tools").first().evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));expect(size.scroll).toBeLessThanOrEqual(size.width+1);
});});
test("Dashboard switch rejects the former Dashboard's delayed response",async({page})=>{
 const {state}=await setup(page);state.listDelay=500;
 await page.context().route(url=>url.pathname==="/api/dashboards",route=>route.fulfill({json:{dashboards:[1,2].map(id=>({id,code:`D${id}`,name:`看板 ${id}`,queryDefinitionId:20,parameters:{},refreshSeconds:5,pageSize:1,pageSeconds:5,isActive:false})),total:2,totalPages:1}}));
 await page.context().route(url=>url.pathname==="/api/dashboards/2/device-management/v1/list",route=>route.fulfill({json:{items:[{...state.devices[0]!,dashboardId:2,deviceName:"第二看板裝置",status:"UNVERIFIED"}],total:1,page:1,pageSize:20,snapshot:"dashboard-two",asOfUtc:"2026-10-31T00:00:00Z",validUntilUtc:"2026-10-31T00:05:00Z",sort:"ID_ASC",consistency:"CONTENT_CHECKED_UNTIL_EXPIRY",writeVersionIncluded:false}}));
 await page.reload();await page.getByRole("button",{name:"編輯",exact:true}).first().click();
 const panel=page.getByRole("region",{name:"版本化裝置基本管理"});
 await panel.getByLabel("裝置搜尋關鍵字").fill("slow");await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await expect(panel.getByText("裝置清單載入中…",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"編輯",exact:true}).nth(1).click();
 const rows=panel.getByRole("list",{name:"裝置分頁清單"});await expect(rows).toContainText("第二看板裝置");
 await page.waitForTimeout(600);await expect(rows).toContainText("第二看板裝置");await expect(rows).not.toContainText("合成裝置");
 await expect(panel.getByLabel("裝置搜尋關鍵字")).toHaveValue("");
});
test("a first-page conflict recovers once with no snapshot",async({page})=>{
 const {state,panel}=await setup(page);state.listConflict=true;
 await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await expect(panel.getByText("清單已更新或已到期，已清除舊清單，重新從第一頁載入。",{exact:true})).toBeVisible();
 await expect(panel.getByRole("list",{name:"裝置分頁清單"})).toContainText("合成裝置");
 expect(state.listCalls.slice(-2).every(q=>q.page==="1"&&q.snapshot===undefined)).toBe(true);
});
test("an in-flight page clears old items and cannot overwrite a new search",async({page})=>{
 const {state,panel}=await setup(page);populateDevices(state);
 await panel.getByRole("button",{name:"重新載入裝置設定"}).click();await expect(panel.getByRole("button",{name:"下一頁裝置"})).toBeEnabled();
 const fullReads=state.reads;state.listPageDelay=400;
 await panel.getByRole("button",{name:"下一頁裝置"}).click();
 await expect(panel.getByText("裝置清單載入中…",{exact:true})).toBeVisible();
 await expect(panel.getByRole("list",{name:"裝置分頁清單"}).getByRole("listitem")).toHaveCount(0);
 await expect(panel.getByRole("button",{name:"下一頁裝置"})).toHaveCount(0);
 await panel.getByLabel("裝置搜尋關鍵字").fill("43");await panel.getByRole("button",{name:"搜尋裝置",exact:true}).click();
 await expect(panel.getByRole("list",{name:"裝置分頁清單"}).getByRole("listitem")).toHaveCount(1);
 await page.waitForTimeout(500);await expect(panel.getByRole("list",{name:"裝置分頁清單"})).toContainText("裝置 43");
 expect(state.reads).toBe(fullReads);expect(state.listCalls.at(-1)!.snapshot).toBeUndefined();
});

test("archived device more menu opens scoped LIVE/ARCHIVE history with filters, dates and paging",async({page})=>{
 const {state,panel}=await setup(page,true,true);state.revoked=true;state.archived=true;
 await panel.getByLabel("裝置狀態篩選").selectOption("ARCHIVED");
 await panel.getByText("更多操作",{exact:true}).click();await panel.getByRole("button",{name:"查看操作歷史 合成裝置",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"裝置操作歷史"});await expect(dialog).toContainText("共 25 筆");await expect(dialog).toContainText("2026-10-31 08");
 await expect(dialog.getByRole("button",{name:"上一頁歷史"})).toBeDisabled();
 await dialog.getByRole("button",{name:"下一頁歷史"}).click();await expect(dialog).toContainText("第 2／2 頁");expect(state.historyCalls.at(-1)!.page).toBe("2");
 await dialog.getByLabel("歷史資料區").selectOption("ARCHIVE");await expect(dialog).toContainText("封存操作者");expect(state.historyCalls.at(-1)!.page).toBe("1");
 for(const size of [10,20,50,100]){await dialog.getByLabel("歷史每頁筆數").selectOption(String(size));await expect(dialog.locator("tbody tr")).toHaveCount(Math.min(size,25));expect(state.historyCalls.at(-1)!.pageSize).toBe(String(size));}
 await dialog.getByLabel("歷史操作類型").selectOption("DASHBOARD_DEVICE_REVOKED");await expect(dialog).toContainText("共 12 筆");
 await dialog.getByLabel("歷史起日").fill("2026-10-30");await dialog.getByLabel("歷史迄日").fill("2026-10-31");await dialog.getByLabel("歷史操作人員").fill("archiver");
 const before=state.historyCalls.length;await dialog.getByRole("button",{name:"查詢操作歷史",exact:true}).click();await expect.poll(()=>state.historyCalls.length).toBeGreaterThan(before);
 expect(state.historyCalls.at(-1)).toMatchObject({source:"ARCHIVE",eventType:"DASHBOARD_DEVICE_REVOKED",startDate:"2026-10-30",endDate:"2026-10-31",username:"archiver",page:"1"});
 await expect(dialog).not.toContainText("ParametersJson");await expect(dialog).not.toContainText("TokenHash");
 await dialog.getByRole("button",{name:"關閉操作歷史"}).click();await expect(dialog).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test("no VIEW_AUDIT provides no history entry or global Audit fallback",async({page})=>{
 const {state,panel}=await setup(page);await expect(panel.getByText("更多操作",{exact:true})).toHaveCount(0);expect(state.historyCalls).toHaveLength(0);
});
for(const status of [403,503])test(`history ${status} clears records and offers safe retry`,async({page})=>{
 const {state,panel}=await setup(page,true,true);state.historyError=status;
 await panel.getByText("更多操作",{exact:true}).click();await panel.getByRole("button",{name:"查看操作歷史 合成裝置",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"裝置操作歷史"});await expect(dialog.getByRole("alert")).toBeVisible();await expect(dialog).not.toContainText("PRIVATE PARAMETERS TOKEN");await expect(dialog.locator("tbody tr")).toHaveCount(0);
 if(status===403)await expect(dialog).toContainText("權限不足");state.historyError=0;await dialog.getByRole("button",{name:"重試操作歷史"}).click();await expect(dialog).toContainText("共 25 筆");
});
test("history empty, invalid date interval and malformed scope never show unrelated records",async({page})=>{
 const {state,panel}=await setup(page,true,true);state.historyEmpty=true;
 await panel.getByText("更多操作",{exact:true}).click();await panel.getByRole("button",{name:"查看操作歷史 合成裝置",exact:true}).click();const dialog=page.getByRole("dialog",{name:"裝置操作歷史"});
 await expect(dialog).toContainText("沒有符合條件的操作歷史");const calls=state.historyCalls.length;
 await dialog.getByLabel("歷史起日").fill("2026-11-02");await dialog.getByLabel("歷史迄日").fill("2026-11-01");await dialog.getByRole("button",{name:"查詢操作歷史",exact:true}).click();await expect(dialog).toContainText("起日不可晚於迄日");expect(state.historyCalls).toHaveLength(calls);
 state.historyEmpty=false;state.historyMalformed=true;await dialog.getByLabel("歷史起日").fill("");await dialog.getByLabel("歷史迄日").fill("");await dialog.getByRole("button",{name:"查詢操作歷史",exact:true}).click();await expect(dialog).toContainText("操作歷史讀取失敗");await expect(dialog.locator("tbody tr")).toHaveCount(0);
});
test("history source changes and closing ignore late responses",async({page})=>{
 const {state,panel}=await setup(page,true,true);state.historyDelay=400;
 await panel.getByText("更多操作",{exact:true}).click();await panel.getByRole("button",{name:"查看操作歷史 合成裝置",exact:true}).click();const dialog=page.getByRole("dialog",{name:"裝置操作歷史"});
 await expect(dialog).toContainText("操作歷史載入中");await dialog.getByLabel("歷史資料區").selectOption("ARCHIVE");await expect(dialog).toContainText("封存操作者");await page.waitForTimeout(500);await expect(dialog).not.toContainText("線上管理者");
 await dialog.getByLabel("歷史資料區").selectOption("LIVE");await dialog.getByRole("button",{name:"關閉操作歷史"}).click();await page.waitForTimeout(500);await expect(dialog).toHaveCount(0);
});
test.describe("touch history",()=>{test.use({hasTouch:true});test("history filters, rows and paging fit a narrow tablet",async({page})=>{
 const {panel}=await setup(page,true,true);await page.setViewportSize({width:390,height:844});
 await panel.getByText("更多操作",{exact:true}).tap();await panel.getByRole("button",{name:"查看操作歷史 合成裝置",exact:true}).tap();const dialog=page.getByRole("dialog",{name:"裝置操作歷史"});
 await expect(dialog).toContainText("共 25 筆");const size=await dialog.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));expect(size.scroll).toBeLessThanOrEqual(size.width+1);
 await dialog.getByRole("button",{name:"下一頁歷史"}).tap();await expect(dialog).toContainText("第 2／2 頁");await dialog.getByRole("button",{name:"關閉操作歷史"}).tap();
});});
