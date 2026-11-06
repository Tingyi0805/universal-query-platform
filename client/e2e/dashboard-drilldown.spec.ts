import { test, expect, type Page } from "@playwright/test";
async function setup(page:Page,mode="PANEL",trigger="ROW",tokenSeconds=3600) {
  const token=`x.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+tokenSeconds})).toString("base64url")}.x`;
  const state={requests:[] as {path:string;body:any;auth:string}[],depth:1,delay:0,fail:"",expiry:120000,deletes:0};
  await page.addInitScript(t=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:t,user:{id:1,username:"synthetic",displayName:"合成",permissions:["VIEW_QUERY","EXECUTE_QUERY"]}})),token);
  const dashboard={id:1,code:"SYNTHETIC",name:"合成看板",queryDefinitionId:1,refreshSeconds:30,pageSeconds:20,pageSize:20,parameters:{},isActive:true};
  const profiles=[{id:1,name:"互動版型",isDefault:true,canvasWidth:1280,canvasHeight:720,config:{},widgets:[{id:1,widgetType:"TABLE",x:0,y:0,width:1000,height:600,fontSize:20,alignment:"LEFT",config:{dataSourceKey:"PRIMARY",drilldownRoot:true},sortOrder:0}]}];
  await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path.includes("/interactive/v1/")){
      state.requests.push({path,body:req.postData()?req.postDataJSON():null,auth:req.headers().authorization??""});
      if(req.method()==="DELETE"){state.deletes++;await route.fulfill({json:{status:"OK"}});return;}
      if(state.delay)await new Promise(r=>setTimeout(r,state.delay));
      if(state.fail){await route.fulfill({status:state.fail==="TOKEN_REVOKED"?401:403,json:{error:{code:state.fail,message:"PRIVATE SQL PATIENT"}}});return;}
      state.depth=path.endsWith("/navigate")?state.depth+1:path.endsWith("/back")?state.depth-1:1;
      await route.fulfill({json:{contextId:"C".repeat(43),expiresAtUtc:new Date(Date.now()+state.expiry).toISOString(),depth:state.depth,node:`n${state.depth}`,
        result:{columns:[{name:"ID"},{name:"NAME"}],rows:[{ID:7,NAME:`合成明細_${state.depth}`}],rowCount:1},rowRefs:[String(state.depth).repeat(43)],actions:state.depth<3?[{id:"next",trigger,...(trigger==="COLUMN"?{column:"ID"}:{}),display:mode}]:[]}});return;
    }
    if(path.endsWith("/playback/v1")){await route.fulfill({json:{mode:"QUERY_ONLY",securityVersion:"a".repeat(64),authorizationExpiresAt:Date.now()+3600000,dashboard,profiles}});return;}
    if(path.endsWith("/page")){await route.fulfill({json:{sourceKey:"PRIMARY",modeVersion:"QUERY_ONLY_USER_V1:1",page:1,totalPages:1,totalRows:1,snapshotId:"synthetic-snapshot",snapshotExpiresAt:Date.now()+30000,refreshSeconds:30,pageSeconds:20,pageSize:20,dashboard,reportColumns:[],result:{columns:[{name:"NAME"}],rows:[{NAME:"合成播放列"}]}}});return;}
    if(path.endsWith("/available")){await route.fulfill({json:{dashboards:[dashboard]}});return;}
    if(path.endsWith("/branding")||path.endsWith("/public-branding")){await route.fulfill({json:{organizationName:"Synthetic",platformName:"UQP",platformTitle:"UQP",platformSubtitle:"Synthetic"}});return;}
    if(path.endsWith("/layout")){await route.fulfill({json:{profiles}});return;}
    if(path.endsWith("/preview")){await route.fulfill({json:{dashboard,reportColumns:[],result:{columns:[{name:"NAME"}],rows:[{NAME:"合成播放列"}]}}});return;}
    await route.fulfill({json:{}});
  });
  await page.goto("/dashboards/1/display");await expect(page.getByRole("button",{name:"開啟互動表格"})).toBeVisible();return state;
}
async function open(page:Page){await page.getByRole("button",{name:"開啟互動表格"}).click();await expect(page.getByText("合成明細_1",{exact:true})).toBeVisible();}
for(const mode of ["PAGE","PANEL","MODAL"])for(const trigger of ["ROW","COLUMN"])test(`${trigger} ${mode} navigates with rowRef and supports Back and root`,async({page})=>{
  const s=await setup(page,mode,trigger);await open(page);
  const click=()=>trigger==="ROW"?page.getByText("合成明細_1",{exact:true}).click():page.getByRole("button",{name:"ID 下鑽 next"}).click();await click();
  await expect(page.getByText("合成明細_2",{exact:true})).toBeVisible();await expect(page.getByLabel(mode==="PAGE"?"整頁互動查詢":mode==="PANEL"?"側邊互動查詢":"彈出互動查詢",{exact:true})).toBeVisible();
  if(trigger==="ROW")await page.getByText("合成明細_2",{exact:true}).click();else await page.getByRole("button",{name:"ID 下鑽 next"}).click();await expect(page.getByText("合成明細_3",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"返回上一層",exact:true}).click();await expect(page.getByText("合成明細_2",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"返回主層",exact:true}).click();await expect(page.getByText("合成明細_1",{exact:true})).toBeVisible();
  expect(s.requests.filter(r=>r.path.endsWith("navigate")).map(r=>r.body)).toEqual([{edge:"next",rowRef:"1".repeat(43)},{edge:"next",rowRef:"2".repeat(43)}]);
  expect(s.requests[0]!.body).toEqual({profileId:1});expect(s.requests.every(r=>r.auth.startsWith("Bearer x."))).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))).not.toContain("合成明細");expect(page.url()).not.toContain("合成明細");
  await page.getByRole("button",{name:"關閉互動查詢"}).click();await expect.poll(()=>s.deletes).toBe(1);await expect(page.getByText(/合成明細/)).toHaveCount(0);
});
for(const reason of ["PATIENT_DISCLOSURE_REQUIRED","QUERY_DELIVERY_FORBIDDEN","DRILL_CONTEXT_EXPIRED","TOKEN_REVOKED"])test(`${reason} clears all rows without raw error text`,async({page})=>{const s=await setup(page);await open(page);s.fail=reason;await page.getByText("合成明細_1",{exact:true}).click();await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect(page.locator("body")).not.toContainText("PRIVATE SQL PATIENT");await expect.poll(()=>s.deletes).toBeGreaterThan(0);});
for(const event of ["uqp-interactive-clear","uqp-auth-invalid","pagehide","visibilitychange"])test(`${event} clears immediately and deletes context`,async({page})=>{const s=await setup(page);await open(page);await page.evaluate(name=>{if(name==="visibilitychange"){Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event(name));}else window.dispatchEvent(new Event(name));},event);await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect.poll(()=>s.deletes).toBeGreaterThan(0);});
test("late create after pagehide is deleted and cannot resurrect",async({page})=>{const s=await setup(page);s.delay=300;await page.getByRole("button",{name:"開啟互動表格"}).click();await expect.poll(()=>s.requests.length).toBe(1);await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));await page.waitForTimeout(500);await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect.poll(()=>s.deletes).toBeGreaterThan(0);});
test("context TTL clears without further navigation",async({page})=>{const s=await setup(page);s.expiry=350;await open(page);await expect(page.getByText(/互動工作階段已到期/)).toBeVisible();await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect.poll(()=>s.deletes).toBeGreaterThan(0);});
test("device route never exposes interaction, even with forged layout marker and personal session",async({page})=>{const s=await setup(page);await page.goto("/display/dashboards/1");await page.waitForTimeout(150);await expect(page.getByRole("button",{name:"開啟互動表格"})).toHaveCount(0);expect(s.requests).toHaveLength(0);});
test("real AuthProvider logout deletes context before protected route disappears",async({page})=>{const s=await setup(page);await open(page);await page.getByRole("button",{name:"登出並清除互動"}).click();await expect(page).toHaveURL(/\/login/);await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect.poll(()=>s.deletes).toBeGreaterThan(0);});
test("identity route change unmounts context and late navigation cannot restore rows",async({page})=>{const s=await setup(page);await open(page);s.delay=300;await page.getByText("合成明細_1",{exact:true}).click();await expect.poll(()=>s.requests.some(r=>r.path.endsWith("navigate"))).toBe(true);await page.evaluate(()=>{history.pushState({},"","/dashboards");window.dispatchEvent(new PopStateEvent("popstate"));});await page.waitForTimeout(450);await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect.poll(()=>s.deletes).toBeGreaterThan(0);});
test("JWT deadline clears an idle context without a server roundtrip",async({page})=>{await page.clock.install({time:new Date()});const s=await setup(page,"PANEL","ROW",30);await open(page);await page.clock.fastForward(31000);await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect.poll(()=>s.deletes).toBeGreaterThan(0);});
test("Escape closes modal and restores entry focus; narrow tablet remains contained",async({page})=>{await page.setViewportSize({width:360,height:800});await setup(page,"MODAL","COLUMN");await open(page);await page.getByRole("button",{name:"ID 下鑽 next"}).click();const view=page.getByLabel("彈出互動查詢",{exact:true});await expect(view).toBeVisible();const box=await view.boundingBox();expect(box!.width).toBeLessThanOrEqual(360);await page.keyboard.press("Escape");await expect(page.getByText(/合成明細/)).toHaveCount(0);await expect(page.getByRole("button",{name:"開啟互動表格"})).toBeFocused();});
test("a late 401 from disposed identity cannot sign out a new session",async({page})=>{
 const s=await setup(page);await open(page);s.delay=1500;s.fail="TOKEN_REVOKED";
 const token2=`x.${Buffer.from(JSON.stringify({sub:"2",exp:Math.floor(Date.now()/1000)+3600})).toString("base64url")}.x`;
 await page.route("**/api/auth/login",route=>route.fulfill({json:{accessToken:token2,user:{id:2,username:"second",displayName:"第二身份",permissions:["VIEW_QUERY","EXECUTE_QUERY"]}}}));
 await page.getByText("合成明細_1",{exact:true}).click();await expect.poll(()=>s.requests.some(r=>r.path.endsWith("navigate"))).toBe(true);
 await page.evaluate(()=>{history.pushState({},"","/");window.dispatchEvent(new PopStateEvent("popstate"));});
 await page.getByRole("button",{name:"登出",exact:true}).click();await page.getByLabel("帳號",{exact:true}).fill("second");await page.getByLabel("密碼",{exact:true}).fill("synthetic-only");await page.getByRole("button",{name:"登入",exact:true}).click();
 await expect(page.getByText("第二身份",{exact:true})).toBeVisible();await page.waitForTimeout(1700);await expect(page.getByText("第二身份",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem("uqp.auth")!).user.id)).toBe(2);await expect(page.getByText(/合成明細/)).toHaveCount(0);
});
