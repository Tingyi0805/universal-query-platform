import {test,expect,type Page} from "@playwright/test";
async function setup(page:Page){
 const state={writes:[] as any[],fail:false};
 await page.addInitScript(()=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"synthetic-admin",user:{id:1,username:"synthetic",displayName:"合成管理員",permissions:["VIEW_QUERY","EXECUTE_QUERY","DESIGN_QUERY"]}})));
 const profiles=[{id:1,name:"測試版型",canvasWidth:1280,canvasHeight:720,isDefault:true,sortOrder:0,config:{vendorSetting:{keep:true}},widgets:[{id:10,widgetType:"TABLE",title:null,sourceKey:null,staticText:null,x:0,y:0,width:900,height:500,fontSize:24,alignment:"LEFT",sortOrder:0,config:{dataSourceKey:"PRIMARY"}}]}];
 const primary={sourceKey:"PRIMARY",queryDefinitionId:20,parameters:{},refreshSeconds:30,pageSeconds:20,pageSize:20,maxRows:100,requiresConversion:false};
 await page.route(url=>url.pathname.startsWith("/api/"),async route=>{const path=new URL(route.request().url()).pathname,method=route.request().method();
  if(path==="/api/queries"){await route.fulfill({json:{queries:[{id:20,name:"根層 Query",canExecute:true},{id:21,name:"授權明細 Query",canExecute:true},{id:22,name:"不可執行 Query",canExecute:false}]}});return;}
  if(/^\/api\/queries\/\d+$/.test(path)){const id=Number(path.split("/").pop());await route.fulfill({json:{query:{id,isPublished:true},reportColumns:[{columnName:"ID",displayLabel:"ID",displayOrder:0,isVisible:true,alignment:"LEFT"}],parameters:id===20?[]:[{name:"ID",dataType:"NUMBER"}]}});return;}
  if(path.endsWith("/query-sources/v1/layout")&&method==="PUT"){state.writes.push(route.request().postDataJSON());await route.fulfill({status:state.fail?409:200,json:state.fail?{error:{code:"QUERY_SOURCE_VERSION_CONFLICT",message:"PRIVATE SQL PATIENT"}}:{version:"b".repeat(64)}});return;}
  if(path.endsWith("/configuration")){await route.fulfill({json:{version:"a".repeat(64),dashboardMode:"LEGACY",editable:true,isActive:false,primary,sources:[]}});return;}
  if(path.endsWith("/layout")){await route.fulfill({json:{profiles}});return;}
  if(path.endsWith("/page")||path.endsWith("/preview")){await route.fulfill({json:{dashboard:{id:1,name:"測試",parameters:{},pageSize:20,pageSeconds:20},reportColumns:[],result:{columns:[{name:"ID"}],rows:[{ID:7}]}}});return;}
  if(path.endsWith("/branding")){await route.fulfill({json:{organizationName:"Synthetic",platformName:"UQP"}});return;}
  await route.fulfill({json:{}});
 });
 await page.goto("/designer/dashboards/1/layout");await page.locator(".layout-widget").first().click();await expect(page.getByRole("region",{name:"TABLE 下鑽設定"})).toBeVisible();return state;
}
test("TABLE editor saves multilevel typed graph through original complete versioned payload",async({page})=>{
 const s=await setup(page);await page.getByLabel("下一層已授權 Query").selectOption("21");await expect(page.getByRole("option",{name:"不可執行 Query"})).toHaveCount(0);await expect(page.getByRole("button",{name:"加入下鑽層級"})).toBeDisabled();
 await page.getByRole("button",{name:"儲存版面",exact:true}).click();await expect(page.getByText(/下鑽設定尚未完成/)).toBeVisible();expect(s.writes).toHaveLength(0);
 await page.getByLabel("對應參數 ID").selectOption("ID");await page.getByLabel("明細顯示方式").selectOption("PAGE");await page.getByRole("button",{name:"加入下鑽層級"}).click();
 await page.getByLabel("父層節點").selectOption("node_1");await page.getByLabel("下一層已授權 Query").selectOption("21");await page.getByLabel("下鑽觸發").selectOption("COLUMN");await page.getByLabel("觸發欄位",{exact:true}).selectOption("ID");await page.getByLabel("明細顯示方式").selectOption("MODAL");await page.getByLabel("對應參數 ID").selectOption("ID");await page.getByRole("button",{name:"加入下鑽層級"}).click();
 await page.getByRole("button",{name:"儲存版面",exact:true}).click();await expect.poll(()=>s.writes.length).toBe(1);
 const body=s.writes[0];expect(body.expectedVersion).toBe("a".repeat(64));expect(body.profiles[0].config.vendorSetting).toEqual({keep:true});expect(body.profiles[0].widgets[0].config.drilldownRoot).toBe(true);
 expect(body.profiles[0].config.interactiveDrilldown.edges).toMatchObject([{from:"root",to:"node_1",trigger:"ROW",display:"PAGE",bindings:[{field:"ID",parameter:"ID",type:"NUMBER"}]},{from:"node_1",to:"node_2",trigger:"COLUMN",column:"ID",display:"MODAL"}]);
});
test("graph version conflict never auto-retries or discards profile draft",async({page})=>{const s=await setup(page);await page.getByLabel("下一層已授權 Query").selectOption("21");await page.getByLabel("對應參數 ID").selectOption("ID");await page.getByRole("button",{name:"加入下鑽層級"}).click();s.fail=true;await page.getByRole("button",{name:"儲存版面",exact:true}).click();await expect(page.getByText(/QUERY_SOURCE_VERSION_CONFLICT/)).toBeVisible();expect(s.writes).toHaveLength(1);await expect(page.getByText("edge_1：root → node_1（ROW／PANEL）",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"儲存版面",exact:true})).toBeDisabled();await expect(page.locator("body")).not.toContainText("PRIVATE SQL PATIENT");});
