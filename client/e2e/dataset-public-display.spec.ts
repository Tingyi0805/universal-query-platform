import {test,expect,type Page} from "@playwright/test";
async function setup(page:Page){
 const state={publicWrites:[] as any[],policyVersion:1,publicVersion:null as string|null,grants:[] as any[],conflict:false,templates:[{id:"9007199254740993",revision:"1",version:"0000000000000001",name:"病歷號",aliases:["MRN"],mode:"CUSTOM",customMask:{prefix:0,suffix:2,symbol:"*"},isActive:true,suggestedPublicAllowed:false,uses:[]}],templateWrites:0};
 await page.addInitScript(()=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"synthetic",user:{id:5,username:"synth",displayName:"合成",permissions:["DESIGN_QUERY","EXECUTE_QUERY","MANAGE_SETTINGS"]}})));
 await page.route(url=>url.pathname.startsWith("/api/"),async route=>{const req=route.request(),path=new URL(req.url()).pathname;
 if(path.endsWith("/public-display-policy")){
  if(req.method()==="PUT"){if(state.conflict){await route.fulfill({status:409,json:{error:{code:"DATASET_DISPLAY_VERSION_CONFLICT",message:"政策版本衝突，請重載。",requestId:"synthetic-public-conflict"}}});return;}const body=req.postDataJSON();expect(body.confirm).toBe(true);state.publicWrites.push(body);state.grants=body.grants;state.publicVersion="0000000000000002";}
  await route.fulfill({json:{status:state.publicVersion?"CONFIRMED":"UNCONFIRMED",version:state.publicVersion,sensitivityVersion:state.policyVersion,definitionVersion:"0000000000000001",configurationVersion:"0000000000000001",policy:state.publicVersion?{grants:state.grants}:null,confirmedBy:"5",confirmedAtUtc:null}});return;
 }
 if(path==="/api/dataset-mask-templates"||path.startsWith("/api/dataset-mask-templates/")){
  if(req.method()!=="GET"){const body=req.postDataJSON();state.templateWrites++;state.templates[0]={...state.templates[0]!,...body,revision:"2",version:"0000000000000002"};}
  await route.fulfill({json:{templates:state.templates}});return;
 }
 if(path.endsWith("/sensitive-columns")){await route.fulfill({json:{version:1,columns:[{columnName:"NAME",sensitivityType:"OTHER",deviceMaskMode:"CUSTOM",customMask:{prefix:1,suffix:0,symbol:"*"}},{columnName:"PHONE",sensitivityType:"OTHER",deviceMaskMode:"NONE"},{columnName:"MRN",sensitivityType:"MRN",deviceMaskMode:"FULL"},{columnName:"SECRET",sensitivityType:"OTHER",deviceMaskMode:"OMIT"}],availableColumns:[{name:"NAME"},{name:"PHONE"},{name:"MRN"},{name:"SECRET"},{name:"NEW"}]}});return;}
 if(path==="/api/datasets"){await route.fulfill({json:{datasets:[{id:2,code:"SYNTHETIC",name:"合成Dataset",dataSourceId:4,sqlText:"SELECT synthetic",isActive:true,isArchived:false,maxRows:100}],total:1,totalPages:1}});return;}
 if(path.endsWith("/datasource-options")){await route.fulfill({json:{dataSources:[{id:4,name:"合成來源",type:"SQLSERVER"}]}});return;}
 if(path.endsWith("/parameters")){await route.fulfill({json:{parameters:[],preview:{detected:[],added:[],retained:[],unused:[],detectionStatus:"OK"}}});return;}
 await route.fulfill({json:{versions:[],config:null,columns:[]}});
 });return state;
}
test("Dataset owns explicit public grants: default deny, OMIT disabled, confirmation, CAS conflict preserves draft",async({page})=>{
 const s=await setup(page);await page.goto("/designer/datasets");await page.getByRole("button",{name:/合成Dataset/}).click();const panel=page.getByRole("region",{name:"Dataset 公共顯示政策"});
 await expect(panel.getByText(/狀態：未核准/)).toBeVisible();await expect(panel.getByRole("checkbox",{name:"NAME 允許公共顯示",exact:true})).not.toBeChecked();await expect(panel.getByRole("checkbox",{name:"SECRET 允許公共顯示",exact:true})).toBeDisabled();await expect(panel.getByRole("checkbox",{name:"NEW 允許公共顯示",exact:true})).toHaveCount(0);
 await panel.getByRole("checkbox",{name:"NAME 允許公共顯示",exact:true}).check();await expect(panel.getByRole("button",{name:"儲存公共顯示政策"})).toBeDisabled();expect(s.publicWrites).toEqual([]);
 await panel.getByRole("checkbox",{name:/我確認所選欄位/}).check();await panel.getByRole("button",{name:"儲存公共顯示政策"}).click();await expect(panel.getByText(/狀態：已核准/)).toBeVisible();expect(s.publicWrites[0].grants).toEqual([{columnName:"NAME",permitted:true},{columnName:"PHONE",permitted:false},{columnName:"MRN",permitted:false},{columnName:"SECRET",permitted:false}]);
 s.conflict=true;await panel.getByRole("checkbox",{name:"PHONE 允許公共顯示",exact:true}).check();await panel.getByRole("checkbox",{name:/我確認所選欄位/}).check();await panel.getByRole("button",{name:"儲存公共顯示政策"}).click();await expect(panel.getByRole("alert")).toContainText("草稿保留");await expect(panel.getByRole("checkbox",{name:"PHONE 允許公共顯示",exact:true})).toBeChecked();expect(s.publicWrites.length).toBe(1);
});
test("administrator maintains template, custom synthetic preview and disable without touching Dataset policy",async({page})=>{
 const s=await setup(page);await page.goto("/admin/mask-templates");await page.getByRole("button",{name:"編輯 病歷號",exact:true}).click();await page.getByLabel("範本名稱",{exact:true}).fill("病歷號更新");await page.getByLabel("指定遮蔽位置",{exact:true}).check();await page.getByLabel("開始位置",{exact:true}).fill("2");await page.getByLabel("結束位置",{exact:true}).fill("3");await page.getByLabel("範本啟用",{exact:true}).uncheck();await page.getByRole("button",{name:"儲存範本",exact:true}).click();await expect(page.getByText(/已發布 Dataset 的規則及公共政策未變更/)).toBeVisible();expect(s.templateWrites).toBe(1);expect(s.publicWrites.length).toBe(0);expect(s.templates[0]!.isActive).toBe(false);
});
