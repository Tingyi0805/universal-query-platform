import {test,expect,type Page} from "@playwright/test";
async function setup(page:Page){
 const state={revision:1,sources:[] as any[],active:false,mode:"LEGACY",fail:"",accept:true,credentialDelay:0,credentials:0,executions:0,writes:[] as {path:string;body:any}[],
  primary:{sourceKey:"PRIMARY",queryDefinitionId:20,parameters:{WARD:"ORIGINAL",LIST:[1,2]},refreshSeconds:30,pageSeconds:20,pageSize:10,maxRows:123,requiresConversion:false},
  profiles:[{id:1,name:"原版型",isDefault:true,sortOrder:0,canvasWidth:1280,canvasHeight:720,config:{vendorSetting:{keep:true}},widgets:[{id:11,widgetType:"TEXT",title:null,sourceKey:null,staticText:"固定資訊",x:10,y:10,width:300,height:60,fontSize:24,alignment:"LEFT",config:{},sortOrder:0},{id:12,widgetType:"TABLE",title:null,sourceKey:null,staticText:null,x:10,y:100,width:800,height:400,fontSize:24,alignment:"LEFT",config:{dataSourceKey:"PRIMARY"},sortOrder:1}]}],
  device:{id:7,dashboardId:1,deviceName:"合成裝置",createdByUserId:1,sharedWorkstationId:null,isActive:true,suspendedAtUtc:null,reenrollmentRequired:null as boolean|null,revokedAtUtc:null,archivedAtUtc:null,queryModeGrantVersion:null as number|null,delegatorTokenVersion:null as number|null,enforceIpRestriction:false,allowedIp:null,allowedCidr:null,expiresAtUtc:null,placement:null},
 };
 const version=()=>state.revision.toString(16).padStart(64,"0"),managementVersion="a".repeat(64);
 const config=()=>({version:version(),dashboardMode:state.mode,isActive:state.active,editable:!state.active,overCapacity:false,presentation:{name:"Tabs 看板",description:null,displayMode:"TABLE",displayTitle:"標題",showClock:false,showPageNumber:true,showCountdown:true},primary:state.primary,sources:state.sources});
 await page.addInitScript(()=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"synthetic-admin",user:{id:1,username:"synthetic",displayName:"測試",permissions:["DESIGN_QUERY","VIEW_QUERY","EXECUTE_QUERY","VIEW_AUDIT"]}})));
 page.on("dialog",d=>void (state.accept?d.accept():d.dismiss()));
 await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
  if(path.endsWith("/branding")){await route.fulfill({json:{organizationName:"Synthetic",platformName:"UQP"}});return;}
  if(path==="/api/queries"){await route.fulfill({json:{queries:[{id:20,name:"原 Query",code:"Q20",canExecute:true},{id:21,name:"新 Query",code:"Q21",canExecute:true}]}});return;}
  if(path==="/api/dashboards"){await route.fulfill({json:{dashboards:[1,2].map(id=>({id,code:`D${id}`,name:`看板 ${id}`,queryDefinitionId:20,parameters:{},refreshSeconds:30,pageSeconds:20,pageSize:10,isActive:state.active})),total:2,totalPages:1}});return;}
  if(path.endsWith("/device-alerts")){await route.fulfill({json:{asOfUtc:new Date().toISOString(),devices:[]}});return;}
  if(method!=="GET"&&!path.endsWith("/page")&&!path.endsWith("/preview")){
   const body=req.postDataJSON();state.writes.push({path,body});
   if(state.fail){await route.fulfill({status:409,json:{error:{code:"QUERY_SOURCE_VERSION_CONFLICT",message:"PRIVATE SQL PATIENT"}}});return;}
   if(path.endsWith("/credential")){state.credentials++;if(state.credentialDelay)await new Promise(r=>setTimeout(r,state.credentialDelay));state.device.reenrollmentRequired=true;await route.fulfill({json:{dashboardId:1,deviceId:7,version:managementVersion,credentialIssued:true,reenrollmentRequired:true,token:"T".repeat(43)}});return;}
   expect(body.expectedVersion).toBe(version());
   if(path.endsWith("/primary")){Object.assign(state.primary,body);delete (state.primary as any).expectedVersion;}
   if(path.endsWith("/layout"))state.profiles=body.profiles;
   state.revision++;await route.fulfill({json:{...config(),version:version()}});return;
  }
  if(path.endsWith("/configuration")){await route.fulfill({json:config()});return;}
  if(path.endsWith("/layout")){await route.fulfill({json:{profiles:state.profiles}});return;}
  if(path.endsWith("/page")||path.endsWith("/preview")){state.executions++;const body=req.postDataJSON();await route.fulfill({json:{page:body.page??1,totalPages:1,totalRows:1,snapshotId:"00000000-0000-4000-8000-000000000001",snapshotExpiresAt:Date.now()+60000,deliveredAtUtc:new Date().toISOString(),refreshSeconds:30,pageSeconds:20,pageSize:10,query:{id:20,name:"已核准 Query",code:"Q20"},result:{columns:[{name:"LABEL"}],rows:[{LABEL:"MASKED_SYNTHETIC_ROW"}],elapsedMs:1,truncated:false}}});return;}
  if(path.endsWith("/device-management/v1/list")){await route.fulfill({json:{items:[{...state.device,status:state.device.reenrollmentRequired?"PENDING_REENROLLMENT":"UNVERIFIED"}],total:1,page:1,pageSize:20,snapshot:"tabs-list",asOfUtc:"2026-11-03T00:00:00Z",validUntilUtc:"2026-11-03T00:05:00Z",sort:"ID_ASC",consistency:"CONTENT_CHECKED_UNTIL_EXPIRY",writeVersionIncluded:false}});return;}
  if(path.includes("/device-management/v1")){await route.fulfill({json:{dashboardId:1,version:managementVersion,canCreate:!state.active,devices:[state.device]}});return;}
  if(path.endsWith("/query-mode/v1")){await route.fulfill({json:{mode:state.mode,modeVersion:1,version:version()}});return;}
  if(path.endsWith("/devices")){await route.fulfill({json:{devices:[state.device]}});return;}
  await route.fulfill({json:{devices:[],profiles:[],queryDefinitions:[],parameters:[],columns:[]}});
 });
 await page.goto("/designer/dashboards");await page.getByRole("button",{name:"編輯",exact:true}).first().click();await expect(page.getByLabel("名稱",{exact:true})).toHaveValue("Tabs 看板");
 return state;
}
const tab=(page:Page,name:string)=>page.getByRole("tab",{name,exact:true});
test("four admin tabs share Query, parameters and timing without hidden execution or separate saves",async({page})=>{
 const state=await setup(page);await expect(page.getByRole("tablist",{name:"Dashboard 管理設定"}).getByRole("tab")).toHaveCount(4);
 await page.getByRole("button",{name:"編輯 PRIMARY",exact:true}).click();await page.getByLabel("已發布 Query",{exact:true}).selectOption("21");await page.getByRole("textbox",{name:"查詢參數 JSON",exact:true}).fill('{"WARD":"DRAFT","LIST":[1,2]}');
 await tab(page,"播放設定").click();await expect(page.getByLabel("更新秒數",{exact:true})).toHaveValue("30");await page.getByLabel("更新秒數",{exact:true}).fill("45");await page.getByLabel("換頁秒數",{exact:true}).fill("19");
 expect(state.executions).toBe(0);expect(state.writes).toHaveLength(0);
 await tab(page,"資料設定").click();await expect(page.getByLabel("已發布 Query",{exact:true})).toHaveValue("21");await expect(page.getByRole("textbox",{name:"查詢參數 JSON",exact:true})).toHaveValue('{"WARD":"DRAFT","LIST":[1,2]}');
 await tab(page,"播放設定").click();await page.getByRole("button",{name:"儲存目前來源",exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);
 expect(state.writes[0]!.body).toMatchObject({queryDefinitionId:21,parameters:{WARD:"DRAFT",LIST:[1,2]},refreshSeconds:45,pageSeconds:19,pageSize:10,maxRows:123});expect(state.writes[0]!.path).toMatch(/\/primary$/);
});
test("layout and timestamp controls share the complete profile draft and clear hidden clinical previews",async({page})=>{
 const state=await setup(page);await tab(page,"版面設計").click();await expect(page.getByText("MASKED_SYNTHETIC_ROW",{exact:true})).toBeVisible();
 await page.locator(".layout-widget").first().click();await page.getByRole("textbox",{name:"文字內容",exact:true}).fill("未儲存版型內容");
 await tab(page,"播放設定").click();await expect.poll(()=>page.locator("body").innerHTML()).not.toContain("MASKED_SYNTHETIC_ROW");await page.getByLabel("最後成功更新時間位置",{exact:true}).selectOption("TOP_LEFT");await page.getByLabel("最後成功更新時間格式",{exact:true}).selectOption("DATE_TIME");
 await tab(page,"版面設計").click();await expect(page.getByRole("textbox",{name:"文字內容",exact:true})).toHaveValue("未儲存版型內容");
 await tab(page,"播放設定").click();await page.getByRole("button",{name:"儲存版面",exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);
 expect(state.writes[0]!.body.profiles[0].config).toEqual({vendorSetting:{keep:true},lastSuccessPosition:"TOP_LEFT",lastSuccessFormat:"DATE_TIME"});expect(state.writes[0]!.body.profiles[0].widgets[0].staticText).toBe("未儲存版型內容");
});
test("hidden layout drafts survive source version changes and conflicts never auto-rebase or resend",async({page})=>{
 const state=await setup(page);await tab(page,"版面設計").click();await page.locator(".layout-widget").first().click();await page.getByRole("textbox",{name:"文字內容",exact:true}).fill("保留版型草稿");
 await tab(page,"資料設定").click();await page.getByRole("button",{name:"編輯 PRIMARY",exact:true}).click();await page.getByRole("textbox",{name:"查詢參數 JSON",exact:true}).fill('{"WARD":"NEW"}');await page.getByRole("button",{name:"儲存目前來源",exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);
 await tab(page,"版面設計").click();await expect(page.getByRole("textbox",{name:"文字內容",exact:true})).toHaveValue("保留版型草稿");await expect(page.getByRole("button",{name:"儲存版面",exact:true})).toBeDisabled();await expect(page.getByText(/設定已變更；版型草稿保留/)).toBeVisible();
 await tab(page,"資料設定").click();await page.getByRole("button",{name:"編輯 PRIMARY",exact:true}).click();await page.getByRole("textbox",{name:"查詢參數 JSON",exact:true}).fill('{"WARD":"CONFLICT"}');state.fail="409";await tab(page,"播放設定").click();await page.getByRole("button",{name:"儲存目前來源",exact:true}).click();await expect(page.getByText(/設定未完成：QUERY_SOURCE_VERSION_CONFLICT/)).toBeVisible();
 await tab(page,"資料設定").click();await expect(page.getByRole("textbox",{name:"查詢參數 JSON",exact:true})).toHaveValue('{"WARD":"CONFLICT"}');expect(state.writes).toHaveLength(2);await expect(page.locator("body")).not.toContainText("PRIVATE SQL PATIENT");
});
test("device metadata drafts survive tabs while visible and late one-time credentials are cleared",async({page})=>{
 const state=await setup(page);state.mode="QUERY_ONLY";state.active=true;await tab(page,"裝置管理").click();await page.getByRole("button",{name:"編輯 合成裝置 基本設定",exact:true}).click();await page.getByLabel("裝置名稱",{exact:true}).fill("保留裝置草稿");
 await tab(page,"資料設定").click();await tab(page,"裝置管理").click();await expect(page.getByLabel("裝置名稱",{exact:true})).toHaveValue("保留裝置草稿");
 await page.getByRole("button",{name:"重新載入裝置設定",exact:true}).click();await page.getByRole("button",{name:"首次核發新 Token 合成裝置",exact:true}).click();await expect(page.locator("dialog textarea")).toHaveValue("T".repeat(43));
 await tab(page,"資料設定").evaluate(e=>(e as HTMLButtonElement).click());await expect.poll(()=>page.locator("body").innerHTML()).not.toContain("T".repeat(43));await tab(page,"裝置管理").click();await expect(page.locator("dialog textarea")).toHaveCount(0);expect(state.credentials).toBe(1);
 expect(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))).not.toContain("T".repeat(43));
});
test("pending credential reply after leaving the tab cannot resurrect its Token or retry",async({page})=>{
 const state=await setup(page);state.mode="QUERY_ONLY";state.active=true;state.credentialDelay=350;await tab(page,"裝置管理").click();await page.getByRole("button",{name:"首次核發新 Token 合成裝置",exact:true}).click();await expect.poll(()=>state.credentials).toBe(1);
 await tab(page,"資料設定").click();await page.waitForTimeout(500);await tab(page,"裝置管理").click();await expect(page.locator("dialog textarea")).toHaveCount(0);expect(state.credentials).toBe(1);await expect(page.locator("body")).not.toContainText("T".repeat(43));
});
test("keyboard tabs and Dashboard switching preserve or explicitly discard drafts",async({page})=>{
 const state=await setup(page);await page.getByLabel("名稱",{exact:true}).fill("未儲存名稱");await tab(page,"資料設定").focus();await page.keyboard.press("ArrowRight");await expect(tab(page,"版面設計")).toHaveAttribute("aria-selected","true");await page.keyboard.press("Home");await expect(page.getByLabel("名稱",{exact:true})).toHaveValue("未儲存名稱");
 state.accept=false;await page.getByRole("button",{name:"編輯",exact:true}).nth(1).click();await expect(page.getByLabel("名稱",{exact:true})).toHaveValue("未儲存名稱");state.accept=true;await page.getByRole("button",{name:"編輯",exact:true}).nth(1).click();await expect(page.getByLabel("名稱",{exact:true})).toHaveValue("Tabs 看板");expect(state.writes).toHaveLength(0);
});
for(const width of [360,768])test(`integrated tabs fit ${width}px touch viewports without page overflow`,async({browser})=>{
 const context=await browser.newContext({baseURL:"http://127.0.0.1:4173",viewport:{width,height:1000},hasTouch:true});const page=await context.newPage();
 try{await setup(page);for(const name of ["資料設定","版面設計","播放設定","裝置管理"]){await tab(page,name).tap();await expect(tab(page,name)).toHaveAttribute("aria-selected","true");
  if(name==="版面設計")await expect(page.locator(".layout-canvas-inner")).toBeVisible();
  if(name==="播放設定"){await expect(page.getByLabel("換頁秒數",{exact:true})).toHaveValue("20");await expect(page.getByLabel("最後成功更新時間位置",{exact:true})).toBeVisible();if(width===360)await page.screenshot({path:test.info().outputPath("playback-tabs.png")});}
  if(name==="裝置管理")await expect(page.getByRole("list",{name:"裝置分頁清單"})).toContainText("合成裝置");
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const box=await tab(page,name).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);}}
 finally{await context.close();}
});
test("authentication invalidation clears hidden drafts and a late credential response",async({page})=>{
 const state=await setup(page);state.mode="QUERY_ONLY";state.active=true;state.credentialDelay=300;await tab(page,"裝置管理").click();await page.getByRole("button",{name:"首次核發新 Token 合成裝置",exact:true}).click();await expect.poll(()=>state.credentials).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent("uqp-auth-invalid")));await expect(page).toHaveURL(/\/login/);await page.waitForTimeout(400);await expect(page.locator("body")).not.toContainText("T".repeat(43));await expect(page.getByRole("tablist",{name:"Dashboard 管理設定"})).toHaveCount(0);expect(state.credentials).toBe(1);
});
test("a pending source removal keeps its original version across tabs",async({page})=>{
 const state=await setup(page);state.sources.push({...state.primary,id:10,sourceKey:"WARD",queryDefinitionId:21,isEnabled:true});await page.getByRole("button",{name:"重新載入來源版本",exact:true}).click();
 await page.getByRole("button",{name:"移除 WARD",exact:true}).click();await tab(page,"版面設計").click();await page.getByRole("button",{name:"儲存版面",exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);
 await tab(page,"資料設定").click();await expect(page.getByRole("button",{name:"確認移除來源",exact:true})).toBeDisabled();await expect(page.getByText(/待移除來源版本已變更/)).toBeVisible();expect(state.writes).toHaveLength(1);
});
