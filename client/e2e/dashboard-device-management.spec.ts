import { test, expect, type Page } from "@playwright/test";
const initialVersion = "a".repeat(64);
async function setup(page: Page) {
  const state = { linkDelay:0,linkCode:"",linkStatus:503,linkReads:0,alertFail:false, linkUrl: "https://hospital.example:8443/display/dashboards/1?deviceId=7", revision: 0, mode: "LEGACY", failStatus: 0, flag: false, createAllowed: true, archived: false, revoked: false, expired: false,
    writes: [] as { path: string; method: string; body: any }[], reads: 0, oldWrites: 0,
    devices: [{ id: 7, dashboardId: 1, deviceName: "合成裝置", isActive: true, createdByUserId: 2, sharedWorkstationId: 3,
      enforceIpRestriction: true, allowedIp: "192.0.2.1" as string | null, allowedCidr: null, expiresAtUtc: null as string | null,
      revokedAtUtc: null as string | null, archivedAtUtc: null as string | null, queryModeGrantVersion: null, delegatorTokenVersion: null,
      placement: { browser: "chrome", screenNumber: 3, fullscreen: false, windowX: -2000, windowY: 100, windowWidth: 1200, windowHeight: 800 } }] };
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic", user: { id: 1, username: "synthetic", displayName: "測試", permissions: ["DESIGN_QUERY", "VIEW_QUERY", "EXECUTE_QUERY"] } })));
  await page.context().route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if(path.endsWith("/device-alerts")){
      if(state.alertFail){await route.fulfill({status:503,json:{error:{code:"PRIVATE_DIAGNOSTIC"}}});return;}
      await route.fulfill({json:{days:30,asOfUtc:new Date().toISOString(),devices:state.devices.filter(d=>d.expiresAtUtc!==null).map(d=>({...d,daysRemaining:Math.ceil((Date.parse(d.expiresAtUtc!)-Date.now())/86400000)}))}});return;
    }
    if(path.endsWith("/playback-link")){state.linkReads++;if(state.linkDelay)await new Promise(resolve=>setTimeout(resolve,state.linkDelay));if(state.linkCode){await route.fulfill({status:state.linkStatus,json:{error:{code:state.linkCode,message:"PRIVATE_SQL_TOKEN"}}});return;}const deviceId=Number(path.split("/").at(-2));await route.fulfill({json:{dashboardId:1,deviceId,url:state.linkUrl.replace("deviceId=7",`deviceId=${deviceId}`),bat:"@echo off\r\nREM synthetic public URL only\r\n"}});return;}
    if (path.includes("/device-management/v1")) {
      const version = () => state.revision === 0 ? initialVersion : String(state.revision).repeat(64);
      if (req.method() === "GET") state.reads++;
      else state.writes.push({ path, method: req.method(), body: req.postDataJSON() });
      if (state.flag || (req.method() !== "GET" && state.failStatus)) { const status = state.flag ? 404 : state.failStatus; await route.fulfill({ status, json: { error: { code: state.flag ? "QUERY_SOURCE_MANAGEMENT_DISABLED" : status === 409 ? "DASHBOARD_DEVICE_VERSION_CONFLICT" : status === 403 ? "FORBIDDEN" : "QUERY_SOURCE_STORAGE_UNAVAILABLE", message: "PRIVATE STORAGE DETAIL" } } }); return; }
      let extra = {};
      if (req.method() !== "GET") {
        const body = req.postDataJSON();
        if (body.expectedVersion !== version() || body.confirmed !== true) { await route.fulfill({ status: 409, json: { error: { code: "DASHBOARD_DEVICE_VERSION_CONFLICT" } } }); return; }
        if(path.endsWith("/renew")){state.devices[0]!.expiresAtUtc=new Date(Date.parse(state.devices[0]!.expiresAtUtc!)+body.days*86400000).toISOString();extra={deviceId:7,credentialIssued:false,deviceCredentialsInvalidated:false};}
        else if (req.method() === "POST") { state.devices.push({ ...state.devices[0]!, ...body.metadata, id: 8, sharedWorkstationId: null, createdByUserId: 1 }); extra = { deviceId: 8, credentialIssued: false }; }
        else if (path.endsWith("/metadata")) { Object.assign(state.devices[0]!, body.metadata); extra = { deviceId: 7, deviceCredentialsInvalidated: true }; }
        else { state.devices[0]!.placement = body.placement; extra = { deviceId: 7, deviceCredentialsInvalidated: false }; }
        state.revision++;
      }
      await route.fulfill({ json: { dashboardId: 1, version: version(), canCreate: state.createAllowed, devices: state.devices.map(d => ({ ...d, isActive: !state.revoked, revokedAtUtc: state.revoked ? "2020-01-01T00:00:00Z" : null, archivedAtUtc: state.archived ? "2020-01-01T00:00:00Z" : null, expiresAtUtc: state.expired ? "2000-01-01T00:00:00Z" : d.expiresAtUtc })), ...extra } }); return;
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
  await expect(panel.getByRole("button", { name: "建立未授權裝置", exact: true })).toBeEnabled();
  return { state, panel };
}
test("create metadata-only device while playback flag is off; explicit delegator, no credential or Legacy fallback", async ({ page }) => {
  const { state, panel } = await setup(page);
  await panel.getByRole("button", { name: "建立未授權裝置", exact: true }).click();
  await panel.getByLabel("裝置名稱", { exact: true }).fill("新合成裝置");
  await panel.getByLabel("裝置到期時間 UTC").fill("2099-01-01T00:00:00Z");
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
  await panel.getByLabel("裝置到期時間 UTC").fill("2099-01-01T00:00:00Z"); await panel.getByRole("button", { name: "確認保存裝置設定" }).click();
  await expect(panel.getByText(/既有裝置須明確重新授權/)).toBeVisible();
  await panel.getByRole("button", { name: "重新載入裝置設定" }).click(); await panel.getByRole("button", { name: "編輯 合成新名稱 基本設定" }).click();
  await expect(panel.getByLabel("允許 IP", { exact: true })).toHaveValue("192.0.2.20"); await expect(panel.getByLabel("裝置到期時間 UTC")).toHaveValue("2099-01-01T00:00:00Z");
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
  await expect(panel.getByRole("button", { name: "編輯 合成裝置 基本設定" })).toBeDisabled();
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
