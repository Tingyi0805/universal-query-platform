import {test,expect,type Page} from "@playwright/test";
test.use({hasTouch:true});
async function setup(page:Page,policy:unknown=6){
 const state={policy,readDelay:0,writeDelay:0,writeError:"",writes:[] as any[]};
 await page.addInitScript(()=>sessionStorage.setItem("uqp.auth",JSON.stringify({accessToken:"synthetic-pin-owner",user:{id:1,username:"synthetic",displayName:"合成使用者",permissions:["MANAGE_USERS"]}})));
 await page.route(url=>url.pathname.startsWith("/api/"),async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith("/policy")||p.endsWith("/quick-pin-policy")){
   if(route.request().method()==="GET"){const value=state.policy;if(state.readDelay)await new Promise(r=>setTimeout(r,state.readDelay));await route.fulfill({json:{pinLength:value}});return;}
  }
  if(route.request().method()==="POST"||route.request().method()==="PUT"){state.writes.push({path:p,body:route.request().postDataJSON()});if(state.writeDelay)await new Promise(r=>setTimeout(r,state.writeDelay));await route.fulfill(state.writeError?{status:state.writeError==="PIN_LOCKED"?429:409,json:{error:{code:state.writeError,message:"PRIVATE PIN PASSWORD"}}}:{json:{status:"OK"}});return;}
  await route.fulfill({json:p.endsWith("branding")?{organizationName:"Synthetic",platformName:"UQP",platformTitle:"UQP",platformSubtitle:""}:{users:[],total:0,totalPages:1,roles:[]}});
 });return state;
}
for(const length of [4,5,9,10,11,12])test(`existing policy supports ${length} digits, typed and touch input`,async({page})=>{
 const s=await setup(page,length);await page.goto("/account/quick-pin");await page.getByLabel("正式登入密碼").fill("synthetic-password");const pin=page.getByLabel("個人 PIN",{exact:true});await expect(pin).toHaveAttribute("inputmode","numeric");await pin.fill("804297351268".slice(0,length));await page.getByRole("button",{name:"下一步：確認 PIN"}).click();await pin.fill("804297351268".slice(0,length));await page.getByRole("button",{name:"儲存新 PIN（取代舊 PIN）"}).click();await expect.poll(()=>s.writes.length).toBe(1);expect(s.writes[0].body.pin).toHaveLength(length);await expect(pin).toHaveValue("");expect(await page.evaluate(()=>JSON.stringify([sessionStorage,localStorage]))).not.toContain("804297");
});
for(const policy of [3,13,6.5,"6",null])test(`invalid policy ${JSON.stringify(policy)} cannot enable enrollment or policy overwrite`,async({page})=>{
 const s=await setup(page,policy);await page.goto("/account/quick-pin");await expect(page.getByRole("button",{name:"下一步：確認 PIN"})).toBeDisabled();await expect(page.getByText(/無法確認 PIN 政策/)).toBeVisible();await expect(page.getByLabel("個人 PIN",{exact:true})).toHaveCount(0);
 await page.goto("/admin/users?tab=pin");await expect(page.getByText(/讀取 PIN 政策失敗或內容無效/)).toBeVisible();await expect(page.getByRole("button",{name:"儲存 PIN 長度"})).toHaveCount(0);expect(s.writes).toHaveLength(0);
});
test("policy reload ignores older response and requires the current length",async({page})=>{
 const s=await setup(page,6);s.readDelay=250;await page.goto("/account/quick-pin");s.policy=9;s.readDelay=0;await page.getByRole("button",{name:"重新載入 PIN 政策"}).click();await expect(page.getByText(/目前設定為 9 位數/)).toBeVisible();await page.waitForTimeout(350);await expect(page.getByText(/目前設定為 9 位數/)).toBeVisible();expect(s.writes).toHaveLength(0);
});
for(const event of ["uqp-interactive-clear","pagehide","visibilitychange"])test(`${event} clears entered PIN/password without writing`,async({page})=>{
 const s=await setup(page);await page.goto("/account/quick-pin");await page.getByLabel("正式登入密碼").fill("synthetic-password");await page.getByLabel("個人 PIN",{exact:true}).fill("804297");await page.evaluate(name=>{if(name==="visibilitychange"){Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event(name));}else window.dispatchEvent(new Event(name));},event);await expect(page.getByLabel("個人 PIN",{exact:true})).toHaveValue("");await expect(page.getByLabel("正式登入密碼")).toHaveValue("");expect(s.writes).toHaveLength(0);
});
test("late PIN mutation reply after clear never restores success or resubmits",async({page})=>{
 const s=await setup(page);s.writeDelay=300;await page.goto("/account/quick-pin");await page.getByLabel("正式登入密碼").fill("synthetic-password");await page.getByLabel("個人 PIN",{exact:true}).fill("804297");await page.getByRole("button",{name:"下一步：確認 PIN"}).click();await page.getByLabel("個人 PIN",{exact:true}).fill("804297");await page.getByRole("button",{name:"儲存新 PIN（取代舊 PIN）"}).click();await expect.poll(()=>s.writes.length).toBe(1);await page.evaluate(()=>window.dispatchEvent(new Event("uqp-interactive-clear")));await page.waitForTimeout(450);await expect(page.getByLabel("個人 PIN",{exact:true})).toHaveValue("");await expect(page.getByLabel("正式登入密碼")).toHaveValue("");await expect(page.getByText(/個人 PIN 已設定或更新/)).toHaveCount(0);expect(s.writes).toHaveLength(1);
});

for(const code of ["PIN_LOCKED","PIN_POLICY_CHANGED"])test(`${code} remains explicit and cannot auto-resubmit`,async({page})=>{
 const s=await setup(page);s.writeError=code;await page.goto("/account/quick-pin");await page.getByLabel("正式登入密碼").fill("synthetic-password");await page.getByLabel("個人 PIN",{exact:true}).fill("804297");await page.getByRole("button",{name:"下一步：確認 PIN"}).click();await page.getByLabel("個人 PIN",{exact:true}).fill("804297");await page.getByRole("button",{name:"儲存新 PIN（取代舊 PIN）"}).click();await expect(page.getByText(code==="PIN_LOCKED"?/PIN 管理已暫時鎖定/:/PIN 政策已變更/)).toBeVisible();await expect(page.getByLabel("正式登入密碼")).toHaveValue("");await expect(page.locator("body")).not.toContainText("PRIVATE PIN PASSWORD");expect(s.writes).toHaveLength(1);if(code==="PIN_POLICY_CHANGED")await expect(page.getByRole("button",{name:"下一步：確認 PIN"})).toBeDisabled();
});
