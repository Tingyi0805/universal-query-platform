import {test,expect,type Page} from "@playwright/test";
const token="A".repeat(43),version="a".repeat(64);
async function setup(page:Page){
  const state={mode:"LEGACY",revision:0,failStatus:0,revoked:false,writes:[] as {path:string;method:string;body:any}[],legacyExecutions:0};
  await page.addInitScript(()=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"synthetic",user:{id:1,username:"synthetic",displayName:"測試",permissions:["DESIGN_QUERY","VIEW_QUERY","EXECUTE_QUERY"]}})));
  const primary={sourceKey:"PRIMARY",queryDefinitionId:20,parameters:{},refreshSeconds:5,pageSeconds:5,pageSize:1,maxRows:100};
  await page.context().route(url=>url.pathname.startsWith("/api/"),async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()!=="GET")state.writes.push({path,method:req.method(),body:req.postDataJSON()});
    if(path.endsWith("/preflight")){await route.fulfill({json:{mode:state.mode,modeVersion:state.revision,version,ready:true,sourceCount:1,pendingCount:0,
      checks:[{name:"capacity",ok:true,code:null},{name:"bindings",ok:true,code:null},{name:"references",ok:true,code:null}],queries:[{sourceKey:"PRIMARY",ok:true,code:null}],delegators:[{deviceId:7,ok:true,code:null}]}});return;}
    if(path.endsWith("/query-mode/v1")){
      if(req.method()==="POST"){
        if(state.failStatus){await route.fulfill({status:state.failStatus,json:{error:{code:state.failStatus===409?"QUERY_SOURCE_VERSION_CONFLICT":state.failStatus===403?"QUERY_SOURCE_QUERY_FORBIDDEN":state.failStatus===400?"PARAMETER_REQUIRED":"QUERY_MODE_SCHEMA_REQUIRED",message:"SQL SECRET TOKEN"}}});return;}
        state.mode=req.postDataJSON().activate?"QUERY_ONLY":"QUERY_ONLY_DISABLED";state.revision++;
      }
      await route.fulfill({json:{mode:state.mode,modeVersion:state.revision,version}});return;
    }
    if(path.endsWith("/credential")){if(req.method()==="DELETE")state.revoked=true;await route.fulfill({json:req.method()==="DELETE"?{revoked:true}:{token,device:{id:7,dashboardId:1}}});return;}
    if(path==="/api/dashboards/1/devices"){await route.fulfill({json:{devices:[{id:7,deviceName:"合成平板",isActive:!state.revoked}]}});return;}
    if(path.includes("/device/1/")){
      if(state.revoked){await route.fulfill({status:401,json:{error:{code:"DASHBOARD_DEVICE_UNAUTHORIZED",message:"SECRET"}}});return;}
      if(path.endsWith("/layout")){await route.fulfill({json:{profiles:[{id:1,isDefault:true,canvasWidth:1080,canvasHeight:1920,config:{},widgets:[{id:1,widgetType:"TABLE",x:10,y:10,width:1000,height:500,fontSize:24,alignment:"LEFT",config:{},sortOrder:0}]}]}});return;}
      await route.fulfill({json:{page:1,totalPages:1,snapshotId:"snapshot",dashboard:{id:1,name:"合成播放",parameters:{},refreshSeconds:5,pageSeconds:5,pageSize:1},reportColumns:[],result:{columns:[{name:"NAME"}],rows:[{NAME:"合○測試"}]}}});return;
    }
    if(path.endsWith("/configuration")){await route.fulfill({json:{version,dashboardMode:state.mode,editable:state.mode!=="QUERY_ONLY",primary,sources:[]}});return;}
    if(path==="/api/dashboards"){await route.fulfill({json:{dashboards:[{id:1,code:"SYNTHETIC",name:"合成看板",queryDefinitionId:20,parameters:{},refreshSeconds:5,pageSize:1,pageSeconds:5,isActive:false}],total:1,totalPages:1}});return;}
    if(path.endsWith("/branding")){await route.fulfill({json:{organizationName:"Synthetic",platformName:"UQP",platformTitle:"UQP",platformSubtitle:"Synthetic"}});return;}
    await route.fulfill({json:{queryDefinitions:[],queries:[],devices:[],parameters:[],profiles:[]}});
  });
  page.on("dialog",dialog=>void dialog.accept());
  await page.goto("/designer/dashboards");await page.getByRole("button",{name:"編輯",exact:true}).first().click();
  await expect(page.getByText(/目前模式：LEGACY/)).toBeVisible();return state;
}
test("manual preflight, enable, credential handoff, reload waiting, revoke and disable",async({page})=>{
  const state=await setup(page);
  await expect(page.getByRole("button",{name:"啟用 Query-only",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"執行啟用前檢查",exact:true}).click();
  await expect(page.getByText(/委派者／工作站／Query ACL：通過/)).toBeVisible();
  await page.getByRole("button",{name:"啟用 Query-only",exact:true}).click();
  await expect(page.getByText(/目前模式：QUERY_ONLY/)).toBeVisible();
  await page.getByRole("button",{name:"核發／重新核發 合成平板",exact:true}).click();
  await expect(page.getByRole("button",{name:"顯示本次憑證",exact:true})).toBeVisible();
  const storage=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join(" "));expect(storage).not.toContain(token);
  const popupPromise=page.waitForEvent("popup");await page.getByRole("button",{name:"在此裝置開啟安全播放",exact:true}).click();const popup=await popupPromise;
  await expect(popup.getByText("合○測試",{exact:true})).toBeVisible();expect(popup.url()).not.toContain(token);expect(new URL(popup.url()).pathname).toBe("/display/dashboards/1");
  await popup.reload();await expect(popup.getByLabel("Device Token",{exact:true})).toBeVisible();await expect(popup.getByText("合○測試",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"撤銷 合成平板",exact:true}).click();
  await expect(page.getByText("裝置已撤銷，請勿重用原憑證。")).toBeVisible();
  await expect(page.getByRole("button",{name:"顯示本次憑證",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"停用 Query-only",exact:true}).click();await expect(page.getByText(/目前模式：QUERY_ONLY_DISABLED/)).toBeVisible();
  expect(state.writes.filter(item=>item.path.includes("query-mode/v1")).every(item=>item.body.expectedVersion===version)).toBe(true);
});
test("mode failures are safe, versioned and never automatically retried",async({page})=>{
  const state=await setup(page);await page.getByRole("button",{name:"執行啟用前檢查",exact:true}).click();
  for(const status of [400,403,409,503]){
    state.failStatus=status;await page.getByRole("button",{name:"啟用 Query-only",exact:true}).click();
    await expect(page.getByText(/設定未完成：/).last()).toBeVisible();await expect(page.getByText("SQL SECRET TOKEN",{exact:true})).toHaveCount(0);
    await expect(page.getByText(/目前模式：LEGACY/)).toBeVisible();
  }
  expect(state.writes.filter(item=>item.path.endsWith("query-mode/v1")).length).toBe(4);
});
