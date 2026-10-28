import { test, expect, type Page } from "@playwright/test";
const version="a".repeat(64);
const primary={sourceKey:"PRIMARY",queryDefinitionId:20,parameters:{},refreshSeconds:30,pageSeconds:15,pageSize:10,maxRows:1000};
async function setup(page:Page) {
  const state={fail:false,writes:[] as {path:string;body:any}[],config:{version,editable:true,isActive:false,dashboardMode:"LEGACY",presentation:{name:"合成看板",description:null,displayMode:"TABLE",displayTitle:"保留標題",showClock:false,showPageNumber:true,showCountdown:false},overCapacity:false,primary,sources:[{...primary,id:10,sourceKey:"WARD",queryDefinitionId:null,bindingState:"PENDING_CONVERSION",isEnabled:true}]}};
  await page.addInitScript(()=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"synthetic",user:{id:1,username:"synthetic",displayName:"測試",permissions:["DESIGN_QUERY","VIEW_QUERY","EXECUTE_QUERY"]}})));
  await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()!=="GET"&&!path.endsWith("/page")&&!path.endsWith("/preview")){
      state.writes.push({path,body:route.request().postDataJSON()});
      await route.fulfill(state.fail?{status:409,json:{error:{code:"QUERY_SOURCE_VERSION_CONFLICT",message:"SQL SECRET"}}}:{json:{...state.config,version:"b".repeat(64)}});return;
    }
    if(path.endsWith("/branding")){await route.fulfill({json:{organizationName:"Synthetic",platformName:"UQP",platformTitle:"Synthetic",platformSubtitle:"Synthetic"}});return;}
    if(path.endsWith("/configuration")){await route.fulfill({json:state.config});return;}
    if(path==="/api/queries"){await route.fulfill({json:{queries:[{id:20,name:"合成 Query",code:"Q20",canExecute:true},{id:21,name:"另一 Query",code:"Q21",canExecute:true}]}});return;}
    if(path.endsWith("/layout")){await route.fulfill({json:{profiles:[{id:1,name:"合成版型",isDefault:true,sortOrder:0,canvasWidth:1920,canvasHeight:1080,config:{},widgets:[{id:1,widgetType:"TEXT",title:null,sourceKey:null,staticText:"固定診間科別",x:10,y:10,width:300,height:60,fontSize:24,alignment:"LEFT",config:{},sortOrder:0}]}]}});return;}
    if(path.endsWith("/page")||path.endsWith("/preview")){await route.fulfill({status:400,json:{error:{code:"PARAMETER_REQUIRED"}}});return;}
    if(path==="/api/dashboards"){await route.fulfill({json:{dashboards:[{id:1,code:"SYNTHETIC",name:"合成看板",queryDefinitionId:20,parameters:{},refreshSeconds:30,pageSize:10,pageSeconds:15,isActive:false}]}});return;}
    await route.fulfill({json:{queryDefinitions:[],datasets:[],devices:[],parameters:[],columns:[],reportColumns:[],categories:[],profiles:[]}});
  });return state;
}
test("source conversion and PRIMARY preserve stable key and conflict draft",async({page})=>{
  const state=await setup(page);page.on("dialog", dialog => void dialog.accept());await page.goto("/designer/dashboards");
  await page.getByRole("button",{name:"編輯",exact:true}).first().click();
  await page.getByRole("button",{name:"編輯 WARD",exact:true}).click();
  await expect(page.getByLabel("來源代碼",{exact:true})).toBeDisabled();
  await page.getByLabel(/^已發布 Query/).selectOption("21");
  await page.getByRole("textbox",{name:"查詢參數 JSON",exact:true}).fill('{"WARD":"SYNTHETIC"}');
  state.fail=true;await page.getByRole("button",{name:"儲存目前來源",exact:true}).click();
  await expect(page.getByText(/設定未完成：QUERY_SOURCE_VERSION_CONFLICT/)).toBeVisible();
  await expect(page.getByRole("textbox",{name:"查詢參數 JSON",exact:true})).toHaveValue('{"WARD":"SYNTHETIC"}');
  expect(state.writes[0]!.body.upserts[0]).toMatchObject({id:10,sourceKey:"WARD",queryDefinitionId:21});
  expect(state.writes[0]!.body.removals).toEqual([]);
  await expect(page.getByText("SQL SECRET",{exact:true})).toHaveCount(0);
  state.fail=false;await page.getByRole("button",{name:"重新載入來源版本",exact:true}).click();
  await page.getByRole("button",{name:"編輯 PRIMARY",exact:true}).click();
  await page.getByRole("button",{name:"儲存目前來源",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1]!.path).toMatch(/\/primary$/);
});
test("canvas survives preview errors and saves through versioned API",async({page})=>{
  const state=await setup(page);state.config.sources=[];await page.goto("/designer/dashboards/1/layout");
  await expect(page.getByText("固定診間科別",{exact:true})).toBeVisible();
  await expect(page.locator(".layout-canvas-inner")).toHaveCSS("width","1920px");
  await page.getByRole("button",{name:"儲存版面",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0]!.path).toMatch(/query-sources\/v1\/layout$/);
  expect(state.writes[0]!.body.expectedVersion).toBe(version);
  expect(state.writes[0]!.body.profiles[0].widgets[0].staticText).toBe("固定診間科別");
  await page.getByLabel("畫布寬度",{exact:true}).fill("1080");await page.getByLabel("畫布高度",{exact:true}).fill("1920");
  await expect(page.locator(".layout-canvas-inner")).toHaveCSS("width","1080px");
  await expect(page.locator(".layout-canvas-inner")).toHaveCSS("height","1920px");
  await page.getByRole("button",{name:"適合視窗",exact:true}).click();
  await expect(page.getByRole("button",{name:"預覽此版型",exact:true})).toBeEnabled();
  const canvas=await page.locator(".layout-canvas").boundingBox();
  const viewport=await page.locator(".layout-canvas-scroll").boundingBox();
  expect(canvas!.height).toBeLessThanOrEqual(viewport!.height);
  const fitTransform=await page.locator(".layout-canvas-inner").evaluate(element=>element.style.transform);
  await page.getByRole("button",{name:"＋",exact:true}).click();
  expect(await page.locator(".layout-canvas-inner").evaluate(element=>element.style.transform)).not.toBe(fitTransform);
  await page.locator(".layout-widget").click();
  await page.getByLabel("元件排序").fill("50");
  await page.getByRole("button",{name:"儲存版面",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(2);
  expect(state.writes[1]!.body.profiles[0].widgets[0].sortOrder).toBe(50);
});
test("Query-only independent preview uses JWT-only Query pages and preserves fixed layout",async({page})=>{
  const state=await setup(page);state.config.sources=[];
  const calls: {path:string;authorization:string|undefined}[]=[];
  await page.context().route(url=>url.pathname.startsWith("/api/"),async route=>{
    const path=new URL(route.request().url()).pathname;calls.push({path,authorization:route.request().headers().authorization});
    if(path.endsWith("/configuration")){await route.fulfill({json:state.config});return;}
    if(path.endsWith("/query-sources/v1/PRIMARY/page")){
      expect(route.request().postDataJSON()).toEqual({page:1});
      expect(route.request().headers()["x-dashboard-device-token"]).toBeUndefined();
      await route.fulfill({json:{query:{id:20,name:"合成預覽",code:"Q20"},page:1,totalPages:1,snapshotId:"11111111-1111-4111-8111-111111111111",refreshSeconds:30,pageSeconds:15,pageSize:10,result:{columns:[{name:"NAME"}],rows:[{NAME:"合○測試"}]}}});return;
    }
    await route.fulfill({status:404,json:{error:{code:"UNEXPECTED_LEGACY_PATH"}}});
  });
  await page.goto("/designer/dashboards/1/layout");
  await expect(page.getByText("固定診間科別",{exact:true})).toBeVisible();
  const pending=page.waitForEvent("popup");await page.getByRole("button",{name:"預覽此版型",exact:true}).click();const popup=await pending;
  await expect(popup.getByText("固定診間科別",{exact:true})).toBeVisible();
  await expect.poll(()=>calls.some(call=>call.path.endsWith("/query-sources/v1/PRIMARY/page"))).toBe(true);
  expect(calls.filter(call=>call.path.endsWith("/page")).every(call=>call.authorization==="Bearer synthetic")).toBe(true);
  expect(calls.some(call=>/\/preview$|\/device\//.test(call.path))).toBe(false);
  expect(popup.url()).toContain("queryPreview=1");expect(popup.url()).not.toContain("synthetic");
  await popup.close();
});
