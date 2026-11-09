import {test,expect,type Page} from "@playwright/test";

// Tests the REAL DashboardDisplayPage/native widget path with mocked HTTP.
// It is not the standalone synthetic chart lab and never connects to SQL.
// The actual backend /charts/v1 projection release gate stays hard OFF.
async function setup(page:Page,projection:unknown={
  chartType:"BAR",showLegend:true,
  points:[{label:"診間 A",value:9},{label:"診間 B",value:6}],
}){
  const calls:{path:string;method:string;body:string|null;authorization:string|null}[]=[];
  const chart={
    id:88,profileId:22,widgetType:"CHART",title:"看診彙總圖表",
    sourceKey:"PRIMARY",staticText:null,x:40,y:40,width:600,height:360,
    fontSize:22,alignment:"CENTER",sortOrder:0,
    // Never accept rows or approval assertions from ConfigJson.
    config:{version:1,dataSourceKey:"PRIMARY",
      rows:[{PATIENT_ID:"FORBIDDEN_CONFIG_ROW"}],approved:true},
  };
  const profiles=[{id:22,dashboardId:7,name:"門診大螢幕",canvasWidth:1280,
    canvasHeight:720,isDefault:true,sortOrder:0,config:{},widgets:[chart]}];
  await page.addInitScript(()=>{
    sessionStorage.setItem("uqp.auth",JSON.stringify({
      accessToken:"designer-token-test",
      user:{id:8,username:"designer",displayName:"設計測試",
        permissions:["DESIGN_QUERY","VIEW_QUERY","EXECUTE_QUERY"]},
    }));
  });
  await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==="/api/dashboards/7/charts/v1/88/projection"){
      calls.push({path,method:request.method(),
        body:request.postData(),authorization:request.headers()["authorization"]??null});
      await route.fulfill({json:projection});return;
    }
    if(path==="/api/dashboards/7/layout"){
      await route.fulfill({json:{profiles}});return;
    }
    if(path==="/api/dashboards/7/query-sources/v1/configuration"){
      await route.fulfill({json:{primary:{
        sourceKey:"PRIMARY",parameters:{},refreshSeconds:3600,pageSeconds:30,
        pageSize:5,maxRows:100,
      },sources:[]}});return;
    }
    if(path==="/api/dashboards/7/query-sources/v1/PRIMARY/page"){
      await route.fulfill({json:{
        page:1,totalPages:1,totalRows:0,
        deliveredAtUtc:new Date().toISOString(),
        snapshotId:"11111111-1111-4111-8111-111111111111",
        snapshotExpiresAt:Date.now()+120_000,
        result:{columns:[],rows:[]},
      }});return;
    }
    await route.fulfill({json:{profiles:[],organizationName:"Test",platformName:"UQP"}});
  });
  return calls;
}

test("saved CHART in real Designer Dashboard uses only sealed server projection endpoint",async({page})=>{
  test.setTimeout(45_000);
  const calls=await setup(page);
  await page.goto("/designer/dashboards/7/display?queryPreview=1");
  await expect(page.getByRole("img",{name:"經授權之 Dashboard 彙總圖表"})).toBeVisible();
  await expect(page.getByLabel("圖表圖例")).toContainText("診間 A");
  await expect(page.locator(".dashboard-play-widget")).toHaveCount(1);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({
    path:"/api/dashboards/7/charts/v1/88/projection",method:"POST",
    body:null,authorization:"Bearer designer-token-test",
  });
  // Existing Widget ConfigJson with spoofed approval/raw patient rows was
  // not used to build chart data and was never sent to the read-only route.
  await expect(page.getByText("FORBIDDEN_CONFIG_ROW")).toHaveCount(0);
  await expect(page.getByText("PATIENT_ID")).toHaveCount(0);
});

test("untrusted server response is denied without showing row data in native playback",async({page})=>{
  test.setTimeout(45_000);
  const calls=await setup(page,{
    chartType:"BAR",showLegend:true,
    points:[{label:"診間 A",value:9}],rows:[{PATIENT_ID:"PRIVATE-001"}],
  });
  await page.goto("/designer/dashboards/7/display?queryPreview=1");
  await expect(page.getByText("圖表未取得核准的彙總資料，停止顯示")).toBeVisible();
  expect(calls).toHaveLength(1);
  await expect(page.getByText("PRIVATE-001")).toHaveCount(0);
  await expect(page.locator(".dashboard-saved-chart svg")).toHaveCount(0);
});

test("ordinary designer display path cannot request privileged Query preview projection",async({page})=>{
  const calls=await setup(page);
  await page.goto("/designer/dashboards/7/display");
  await expect(page.getByText("圖表尚未獲准在此播放模式顯示")).toBeVisible();
  expect(calls).toHaveLength(0);
});
