import {test,expect,type Page} from "@playwright/test";
const dataset="9007199254740993",owner="9007199254740995",reviewer="302",version="0000000000000001";
async function setup(page:Page,permission=true){
  const state={scopes:[] as any[],writes:[] as any[],fail:"",preview:0};
  await page.addInitScript(cap=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"SYNTHETIC",user:{id:303,displayName:"Synthetic",permissions:cap?["MANAGE_DATASET_SECURITY_SCOPE"]:[]}})),permission);
  await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith("/system-settings/branding")){await route.fulfill({json:{organizationName:"Synthetic",platformName:"UQP",platformTitle:"合成首頁",platformSubtitle:"合成"}});return;}
    if(p.includes("preview")||p.includes("column-candidates"))state.preview++;
    if(p.endsWith("/options")){await route.fulfill({json:{datasets:[{id:dataset,name:"合成 Dataset"}],users:[{id:owner,name:"合成 Owner"},{id:reviewer,name:"合成 Reviewer"}]}});return;}
    if(p.endsWith("/decisions")){await route.fulfill({json:{decisions:[]}});return;}
    if(p.endsWith("/scopes")){await route.fulfill({json:{dataset:{id:dataset,name:"合成 Dataset",dataSourceId:"202",definitionVersion:version,configurationVersion:version,active:true},scopes:state.scopes}});return;}
    if(route.request().method()==="PUT"){
      const body=route.request().postDataJSON();state.writes.push({path:p,...body});
      if(state.fail){await route.fulfill({status:state.fail==="SCOPE_VERSION_CONFLICT"?409:503,json:{error:{code:state.fail,message:"合成安全拒絕"}}});return;}
      const [kind,id]=p.split("/").slice(-2),old=state.scopes.find(s=>s.userId===id&&s.kind===kind);
      const row={userId:id,kind,state:body.action==="GRANT"?"ACTIVE":"REVOKED",effective:body.action==="GRANT",version:old?"0000000000000002":version,parentOwnerUserId:body.parentOwnerUserId,boundDataSourceId:"202"};
      state.scopes=state.scopes.filter(s=>s!==old);state.scopes.push(row);
      if(body.action==="REVOKE"&&kind==="OWNER")state.scopes.forEach(s=>{if(s.kind==="REVIEWER")s.effective=false;});
      await route.fulfill({json:{decisionId:"9007199254740997",auditLogId:"9007199254740999",replayed:false,deliveryAllowed:false}});return;
    }
    await route.fulfill({json:{}});
  });
  await page.goto("/admin/dataset-security");
  if(permission){await page.getByRole("combobox",{name:"Dataset",exact:true}).selectOption(dataset);await expect(page.getByRole("heading",{name:"合成 Dataset"})).toBeVisible();}
  return state;
}
test("explicit Owner/Reviewer assignment and revoke preserve exact IDs and never request preview",async({page})=>{
  const s=await setup(page);
  await page.getByRole("combobox",{name:"受指派使用者",exact:true}).selectOption(owner);await page.getByRole("button",{name:"確認指派",exact:true}).click();
  await expect(page.getByRole("button",{name:`撤銷 ${owner} OWNER`})).toBeVisible();
  expect(s.writes[0].expectedVersion).toBe("MISSING");expect(s.writes[0].path).toContain(owner);expect(s.writes[0].definitionVersion).toBe(version);
  await page.getByRole("combobox",{name:"指派類型",exact:true}).selectOption("REVIEWER");await page.getByRole("combobox",{name:"受指派使用者",exact:true}).selectOption(reviewer);
  await expect(page.getByRole("button",{name:"確認指派",exact:true})).toBeDisabled();
  await page.getByRole("combobox",{name:"有效 Owner",exact:true}).selectOption(owner);await page.getByRole("button",{name:"確認指派",exact:true}).click();
  await expect(page.getByRole("button",{name:`撤銷 ${reviewer} REVIEWER`})).toBeVisible();
  expect(s.writes[1].parentOwnerUserId).toBe(owner);expect(s.writes[1].parentOwnerVersion).toBe(version);
  await page.getByRole("button",{name:`撤銷 ${owner} OWNER`}).click();
  await expect(page.getByRole("button",{name:`撤銷 ${owner} OWNER`})).toBeDisabled();expect(s.writes[2].action).toBe("REVOKE");expect(s.preview).toBe(0);
});
test("version conflict clears stale form and requires reload",async({page})=>{
  const s=await setup(page);s.fail="SCOPE_VERSION_CONFLICT";
  await page.getByRole("combobox",{name:"受指派使用者",exact:true}).selectOption(owner);await page.getByRole("button",{name:"確認指派",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("合成安全拒絕");await expect(page.getByRole("button",{name:"確認指派",exact:true})).toHaveCount(0);expect(s.writes).toHaveLength(1);
});
test("unknown commit locks further writes and retains RequestId",async({page})=>{
  const s=await setup(page);s.fail="SCOPE_COMMIT_UNKNOWN";
  await page.getByRole("combobox",{name:"受指派使用者",exact:true}).selectOption(owner);await page.getByRole("button",{name:"確認指派",exact:true}).click();
  await expect(page.getByRole("status")).toContainText(s.writes[0].requestId);
  await page.getByRole("button",{name:"重新載入指派",exact:true}).click();await expect(page.getByRole("button",{name:"確認指派",exact:true})).toBeDisabled();expect(s.writes).toHaveLength(1);
});
test("capability absent hides management route",async({page})=>{const s=await setup(page,false);await expect(page).toHaveURL(/\/$/);expect(s.writes).toHaveLength(0);});
