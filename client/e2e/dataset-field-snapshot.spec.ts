import {test,expect,type Page} from "@playwright/test";
const v="0000000000000001";
async function setup(page:Page,cap=true){
  const state={posts:[] as any[],rows:0,policies:0,unknown:false};
  await page.addInitScript(allowed=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"SYNTHETIC",user:{id:303,displayName:"Synthetic",permissions:allowed?["DESIGN_QUERY","CONFIRM_DATASET_CLASSIFICATION"]:["DESIGN_QUERY"]}})),cap);
  await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
    const q=route.request(),p=new URL(q.url()).pathname;
    if(p.includes("/dataset-field-initialization/")){
      if(q.method()==="POST"){state.posts.push(q.postDataJSON());await route.fulfill({status:503,json:{error:{code:"METADATA_OPERATION_UNKNOWN",message:"合成提交結果不明"}}});return;}
      await route.fulfill({json:{dataset:{definitionVersion:v,configurationVersion:v},collectorConfigured:true,trust:"UNBOUND_CANDIDATE",deliveryAllowed:false,sourceFence:"BLOCKED_PRIVILEGED_DDL_PATHS",snapshot:{id:"9007199254740995",state:"DESCRIBED",version:v,current:false,columns:[{name:"自選欄位",dataType:"nvarchar(30)",ordinal:1}]}}});return;
    }
    if(p.includes("preview/run"))state.rows++;
    if(p.endsWith("sensitive-columns")&&q.method()!=="GET")state.policies++;
    if(p==="/api/datasets"){await route.fulfill({json:{datasets:[{id:2,code:"F3_TEST",name:"F3合成",sqlText:"SELECT Id FROM f3.Records",dataSourceId:4,maxRows:100,isActive:true,isArchived:false}],total:1,totalPages:1}});return;}
    if(p.endsWith("datasource-options")){await route.fulfill({json:{dataSources:[{id:4,name:"合成",type:"SQLSERVER"}]}});return;}
    if(p.endsWith("parameters")){await route.fulfill({json:{parameters:[],preview:{detected:[],added:[],retained:[],unused:[],detectionStatus:"OK",previewToken:"a".repeat(64)}}});return;}
    if(p.endsWith("sensitive-columns")){await route.fulfill({json:{columns:[],version:0}});return;}
    if(p.endsWith("patient-audit-config")){await route.fulfill({json:{config:null,version:"0",status:"NOT_CONFIGURED",metadataStatus:"METADATA_UNCONFIRMED",columns:[]}});return;}
    await route.fulfill({json:{versions:[]}});
  });
  await page.goto("/designer/datasets");await page.getByRole("button",{name:/F3合成/}).click();return state;
}
test("persisted descriptors stay untrusted, stale and separate from policy/row delivery",async({page})=>{
  const state=await setup(page),panel=page.getByRole("region",{name:"已儲存欄位 Snapshot"});
  await page.getByRole("button",{name:"查詢欄位 Snapshot 狀態"}).click();
  await expect(page.getByRole("cell",{name:"自選欄位"})).toBeVisible();
  await expect(page.getByText("DESCRIBED · UNBOUND_CANDIDATE · 分類未確認")).toBeVisible();
  await expect(page.getByText(/Dataset／來源版本已失效/)).toBeVisible();
  expect(state.rows).toBe(0);expect(state.policies).toBe(0);expect(state.posts).toHaveLength(0);
  await page.locator("textarea").first().fill("SELECT Label FROM f3.Records");
  await expect(page.getByRole("button",{name:"保存候選欄位描述（非可信發證）"})).toBeDisabled();expect(state.posts).toHaveLength(0);void panel;
});
test("unknown collection retains RequestId and prevents automatic resend",async({page})=>{
  const state=await setup(page);await page.getByRole("button",{name:"查詢欄位 Snapshot 狀態"}).click();
  await page.getByRole("button",{name:"保存候選欄位描述（非可信發證）"}).click();
  await expect(page.getByText(/合成提交結果不明/)).toBeVisible();expect(state.posts).toHaveLength(1);
  await expect(page.getByText(new RegExp(state.posts[0].requestId))).toBeVisible();
  await page.getByRole("button",{name:"查詢欄位 Snapshot 狀態"}).click();await expect(page.getByRole("button",{name:"保存候選欄位描述（非可信發證）"})).toBeDisabled();expect(state.rows).toBe(0);
});
test("global design permission alone cannot initialize stored Snapshot",async({page})=>{
  const state=await setup(page,false);await expect(page.getByRole("button",{name:"查詢欄位 Snapshot 狀態"})).toBeDisabled();expect(state.posts).toHaveLength(0);
});
