import {test,expect,type Page} from "@playwright/test";
// Actual QueryRuntime/Publisher UI with synthetic HTTP fixtures. No database or production PIN claim.
const context="A".repeat(43),row="B".repeat(43);
async function setup(page:Page,trigger="ROW",display="PAGE"){
 const state={byDepth:{1:{page:1,search:null,sort:null},2:{page:1,search:null,sort:null}} as Record<number,{page:number;search:any;sort:any}>,depth:1,page:1,revision:"1".repeat(16),deny:false,missing:false,hold:false,release:(()=>{}) as ()=>void,
  calls:[] as {path:string;body:any;authorization:string|undefined}[],configWrites:[] as any[]};
 await page.addInitScript(()=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"synthetic-A",user:{id:8,username:"A",displayName:"合成管理員",permissions:["VIEW_QUERY","EXECUTE_QUERY","DESIGN_QUERY","PUBLISH_QUERY"]}})));
 const view=()=>({contextId:context,expiresAtUtc:new Date(Date.now()+120000).toISOString(),depth:state.depth,trail:state.depth===1?["合成主層"]:["合成主層","合成明細"],query:{name:state.depth===1?"合成主層":"合成明細"},layout:state.depth===1?"TABLE":"CARDS",
  controls:state.byDepth[state.depth],result:{columns:[{name:"ID"},{name:"NAME"}],rows:[{ID:11,NAME:state.depth===1?`主層頁${state.page}`:"合成遮蔽○"}]},
  pagination:{page:state.page,pageSize:1,totalRows:3,totalPages:3,capped:false},columns:[{key:"c0",name:"ID",label:"識別",canFilter:true,alignment:"LEFT"},{key:"c1",name:"NAME",label:"姓名",canFilter:false,alignment:"LEFT"}],rowRefs:[row],
  actions:state.depth===1?[{id:"open",label:"看明細",trigger,display,columnKey:trigger==="COLUMN"?"c0":null}]:[]});
 const options=(id:number)=>({columns:[{name:"ID",label:"識別",canBind:true},{name:"NAME",label:"姓名",canBind:false}],parameters:id===1?[]:[{name:"KEY",dataType:"NUMBER",controlType:"NUMBER"}]});
 const query=(id:number)=>({id,code:`Q${id}`,name:id===1?"合成主層":"合成子層",description:null,category:null,categoryId:null,icon:"Table2",datasetId:id,sortOrder:0,isPublished:true,isActive:true,isArchived:false,allowExcelExport:true,auditCount:0,canView:true,canExecute:true,canExport:false});
 await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;
  if(path.includes("/hierarchy/")){
   const body=r.postData()?r.postDataJSON():null;state.calls.push({path,body,authorization:r.headers().authorization});
   if(path.endsWith("/capabilities")){await route.fulfill({json:{available:!state.missing}});return;}
   if(path.endsWith("/options")){await route.fulfill({json:options(Number(path.split("/")[3]))});return;}
   if(path.endsWith("/configuration")){
    if(state.missing){await route.fulfill({status:503,json:{error:{code:"HIERARCHY_SCHEMA_REQUIRED"}}});return;}
    if(r.method()==="PUT"){state.configWrites.push(body);state.revision="2".repeat(16);await route.fulfill({json:{revision:state.revision}});return;}
    await route.fulfill({json:{graph:null,revision:"MISSING"}});return;
   }
   if(r.method()==="DELETE"){await route.fulfill({json:{status:"OK"}});return;}
   if(state.deny){await route.fulfill({status:403,json:{error:{code:"QUERY_DELIVERY_FORBIDDEN",message:"安全拒絕"}}});return;}
   if(path.endsWith("/contexts")){state.depth=1;state.byDepth[1]={page:1,search:null,sort:null};}
   if(path.endsWith("/navigate")){state.depth=2;state.byDepth[2]={page:1,search:null,sort:null};}
   if(path.endsWith("/back"))state.depth=1;
   if(path.endsWith("/page"))state.byDepth[state.depth]=body;
   state.page=state.byDepth[state.depth]!.page;
   const result=view();if(state.hold)await new Promise<void>(resolve=>{state.release=resolve;});
   await route.fulfill({json:result}).catch(()=>{});return;
  }
  if(path==="/api/auth/login"){await route.fulfill({json:{accessToken:"synthetic-B",user:{id:9,username:"B",displayName:"使用者B",permissions:["VIEW_QUERY","EXECUTE_QUERY"]}}});return;}
  if(path==="/api/queries/1"){await route.fulfill({json:{query:query(1),parameters:[],reportColumns:[]}});return;}
  if(path==="/api/queries"){await route.fulfill({json:{queries:[query(1),query(2)]}});return;}
  if(path==="/api/query-definitions"){await route.fulfill({json:{queryDefinitions:[query(1),query(2)],total:2,totalPages:1}});return;}
  if(path==="/api/datasets"){await route.fulfill({json:{datasets:[{id:1,code:"D1",name:"合成Dataset",isActive:true,isArchived:false}]}});return;}
  if(path==="/api/query-categories"){await route.fulfill({json:{categories:[]}});return;}
  if(path.endsWith("/report-columns")){await route.fulfill({json:{columns:[]}});return;}
  if(path.endsWith("/versions")){await route.fulfill({json:{versions:[]}});return;}
  await route.fulfill({json:{organizationName:"合成",platformName:"UQP",platformTitle:"合成測試平台",platformSubtitle:"離線Fixture"}});
 });return state;
}
async function open(page:Page){await page.goto("/queries/1");await page.getByRole("button",{name:"開啟多層分頁查詢"}).click();await expect(page.getByText("主層頁1",{exact:true})).toBeVisible();}
for(const [trigger,display] of [["ROW","PAGE"],["COLUMN","PANEL"],["MORE","MODAL"]])test(`${trigger} → ${display}: child binding never comes from browser; server paging/search/sort and back`,async({page})=>{
 if(display==="PANEL")await page.setViewportSize({width:390,height:844});
 const s=await setup(page,trigger,display);await open(page);
 if(trigger==="ROW")await page.getByRole("cell",{name:"主層頁1",exact:true}).click();
 if(trigger==="COLUMN")await page.getByRole("button",{name:"11",exact:true}).click();
 if(trigger==="MORE"){await page.getByText("更多操作",{exact:true}).click();await page.getByRole("button",{name:"看明細",exact:true}).click();}
 await expect(page.getByText("合成遮蔽○",{exact:true})).toBeVisible();
 if(display!=="PAGE")await expect(page.getByRole("dialog",{name:"多層資料查詢"})).toBeVisible();
 if(display==="PANEL"){const bounds=await page.getByRole("dialog",{name:"多層資料查詢"}).boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.width).toBeLessThanOrEqual(390);await expect(page.locator(".hierarchy-cards article")).toBeVisible();}
 const nav=s.calls.find(c=>c.path.endsWith("/navigate"));expect(nav?.body).toEqual({edge:"open",rowRef:row});expect(nav?.authorization).toBe("Bearer synthetic-A");
 await page.getByRole("button",{name:"下一頁",exact:true}).last().click();expect(s.calls.filter(c=>c.path.endsWith("/page")).at(-1)?.body).toEqual({page:2,search:null,sort:null});
 await expect(page.getByText("合成遮蔽○",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"返回上一層",exact:true}).click();await expect(page.getByText("主層頁1",{exact:true})).toBeVisible();
 const region=page.getByRole("region",{name:"多層資料查詢"});await region.getByLabel("本層搜尋",{exact:true}).fill("11");await region.getByRole("button",{name:"伺服器搜尋"}).click();
 expect(s.calls.filter(c=>c.path.endsWith("/page")).at(-1)?.body.search).toEqual({column:"c0",text:"11"});
 await expect(page.getByText("主層頁1",{exact:true})).toBeVisible();await region.getByRole("button",{name:"識別 ↕"}).click();
 expect(s.calls.filter(c=>c.path.endsWith("/page")).at(-1)?.body.sort).toEqual({column:"c0",direction:"ASC"});
});
test("denied child clears all patient rows and never falls back to ordinary Query execution",async({page})=>{
 const s=await setup(page);await open(page);s.deny=true;await page.getByRole("cell",{name:"主層頁1",exact:true}).click();
 await expect(page.getByText(/多層查詢未完成/)).toBeVisible();await expect(page.getByText("主層頁1",{exact:true})).toHaveCount(0);expect(s.calls.some(c=>c.path.endsWith("/execute"))).toBe(false);
});
test("identity clear aborts a delayed response, removes conditions/stack, and re-entry starts at root",async({page})=>{
 const s=await setup(page);await open(page);s.hold=true;await page.getByRole("cell",{name:"主層頁1",exact:true}).click();
 await expect.poll(()=>s.calls.some(c=>c.path.endsWith("/navigate"))).toBe(true);
 await page.evaluate(()=>window.dispatchEvent(new Event("uqp-interactive-clear")));s.release();
 await expect(page.getByText("合成遮蔽○",{exact:true})).toHaveCount(0);await expect(page.getByRole("region",{name:"多層資料查詢"})).toHaveCount(0);
 s.hold=false;s.depth=1;s.page=1;await page.reload();await page.getByRole("button",{name:"開啟多層分頁查詢"}).click();await expect(page.getByText("主層頁1",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>[...Object.values(sessionStorage),...Object.values(localStorage)].join(" "))).not.toContain("合成遮蔽");
});
test("offline and refresh do not restore saved hierarchy patient data",async({page})=>{
 const s=await setup(page);await open(page);await page.context().setOffline(true);await expect(page.getByText("主層頁1",{exact:true})).toHaveCount(0);
 await page.context().setOffline(false);await page.reload();await expect(page.getByText("主層頁1",{exact:true})).toHaveCount(0);expect(s.calls.filter(c=>c.path.endsWith("/contexts"))).toHaveLength(1);
});
test("Query Publisher configures saved published Queries, mappings, display mode and revision CAS",async({page})=>{
 const s=await setup(page);await page.goto("/designer/queries");await page.getByRole("button").filter({has:page.getByText("合成主層",{exact:true})}).click();
 await expect(page.getByRole("heading",{name:"第二階段：多層查詢設定"})).toBeVisible();await page.getByLabel("root 排序鍵").selectOption("ID");
 await page.getByLabel("子層 Query").selectOption("2");await page.getByRole("button",{name:"新增父子關聯"}).click();await page.getByLabel("q2 排序鍵").selectOption("ID");
 const field=page.getByLabel(/映射 edge.* KEY/);await field.selectOption("ID");
 await page.getByLabel(/edge.* 觸發/).selectOption("COLUMN");await page.getByLabel(/edge.* 明細顯示/).selectOption("MODAL");
 await page.getByRole("button",{name:"儲存多層查詢設定"}).click();await expect(page.getByText(/多層設定與稽核已儲存/)).toBeVisible();
 expect(s.configWrites).toHaveLength(1);const sent=s.configWrites[0];expect(sent.expectedRevision).toBe("MISSING");expect(sent.graph.edges[0].bindings).toEqual([{field:"ID",parameter:"KEY",type:"NUMBER"}]);
 expect(Object.keys(sent).sort()).toEqual(["expectedRevision","graph"]);expect(JSON.stringify(sent)).not.toContain("SELECT");
});
test("missing 929 keeps normal Query UI available and does not invent a writable configuration",async({page})=>{
 const s=await setup(page);s.missing=true;await page.goto("/queries/1");await expect(page.getByRole("heading",{name:"合成主層",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"開啟多層分頁查詢"})).toHaveCount(0);
});

test("cross-tab workstation clear logs out the old JWT view; next login cannot restore its stack",async({page})=>{
 const s=await setup(page);await open(page);await page.evaluate(async()=>{const c=new BroadcastChannel("uqp-workstation-identity");c.postMessage("clear");await new Promise(r=>setTimeout(r,20));c.close();});
 await expect(page).toHaveURL(/\/login/);await expect(page.getByText("主層頁1",{exact:true})).toHaveCount(0);
 await page.getByLabel("帳號",{exact:true}).fill("B");await page.getByLabel("密碼",{exact:true}).fill("synthetic-password");await page.getByRole("button",{name:"登入",exact:true}).click();
 await expect(page).not.toHaveURL(/\/login/);
 expect(s.calls.filter(c=>c.path.endsWith("/navigate"))).toHaveLength(0);await expect(page.getByText("主層頁1",{exact:true})).toHaveCount(0);
});
test("hierarchy TTL clears current patient view and cannot silently renew the stack",async({page})=>{
 await page.clock.install();const s=await setup(page);await open(page);await page.clock.runFor(120100);
 await expect(page.getByText("主層頁1",{exact:true})).toHaveCount(0);await expect(page.getByText(/查詢階層已到期/)).toBeVisible();
 expect(s.calls.filter(c=>c.path.endsWith("/contexts"))).toHaveLength(1);
});
