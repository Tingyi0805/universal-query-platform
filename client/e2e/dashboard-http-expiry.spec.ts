import {test,expect,chromium} from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {spawn,type ChildProcess} from "node:child_process";
import {request as requestHttp} from "node:http";
import {request as requestHttps} from "node:https";
import path from "node:path";
const token="A".repeat(43);
let httpFixture:ChildProcess,httpsFixture:ChildProcess,httpPort:number,httpsPort:number;
const origin=()=>`http://127.0.0.1:${httpPort}`,secure=()=>`https://127.0.0.1:${httpsPort}`;
function state(value:Record<string,unknown>,tls=false){return new Promise<void>((resolve,reject)=>{const request=tls?requestHttps:requestHttp;const req=request(`${tls?secure():origin()}/test/state`,{method:"POST",rejectUnauthorized:false,headers:{"content-type":"application/json"}},res=>{res.resume();res.on("end",()=>resolve());});req.on("error",reject);req.end(JSON.stringify(value));});}
async function start(flag:string){const process=spawn(globalThis.process.execPath,["--import","tsx","src/modules/dashboard/dashboardKiosk.testFixture.ts",flag],{cwd:path.resolve("../server"),stdio:["ignore","pipe","pipe"]});const port=await new Promise<number>((resolve,reject)=>{let output="";process.stdout!.on("data",d=>{output+=d.toString();if(/^\d+\n/.test(output))resolve(Number(output.trim()));});process.on("error",reject);process.on("exit",()=>reject(new Error("Synthetic HTTP fixture exited")));});return{process,port};}
// Windows first HTTPS navigation can still be compiling Vite modules after load.
// Allow form readiness; authorization/data/expiry assertions keep their existing deadlines.
async function activate(page:import("@playwright/test").Page,url=`${secure()}/display/dashboards/1?deviceId=7`){await page.goto(url);await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible({timeout:15000});if(new URL(url).protocol==="https:")await page.getByRole("checkbox",{name:/持久授權/}).uncheck();await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByText("合○播放",{exact:true})).toBeVisible();}
test.use({ignoreHTTPSErrors:true});
test.beforeAll(async()=>{const a=await start("--serve-http-fixture"),b=await start("--serve-kiosk-fixture");httpFixture=a.process;httpPort=a.port;httpsFixture=b.process;httpsPort=b.port;});
test.afterAll(()=>{httpFixture?.kill();httpsFixture?.kill();});
test.beforeEach(async()=>{for(const tls of [false,true])await state({revoked:false,expired:false,ipDenied:false,delegationDenied:false,policyDenied:false,auditDenied:false,mode:"QUERY_ONLY",version:4,token,expires:Date.now()+31*86400000},tls);});
test("HTTP playback is blocked before Token entry or handoff, including F5 and a new browser",async({page,context,browser})=>{
 const calls:string[]=[];page.on("request",r=>{if(r.url().includes("/api/dashboards/device/"))calls.push(r.url());});
 await page.goto(`${origin()}/display/dashboards/1?deviceId=7&handoff=1`);
 await expect(page.getByRole("heading",{name:"HTTP 裝置播放尚未開放"})).toBeVisible();await expect(page.getByRole("alert")).toContainText("BLOCKED");
 await expect(page.getByLabel("Device Token",{exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"驗證並啟用播放",exact:true})).toHaveCount(0);
 await page.reload();expect(calls).toHaveLength(0);expect(await context.cookies(origin())).toHaveLength(0);
 const other=await browser.newContext();try{const p=await other.newPage();await p.goto(`${origin()}/display/dashboards/1?deviceId=7`);await expect(p.getByRole("alert")).toContainText("BLOCKED");await expect(p.locator("input")).toHaveCount(0);}finally{await other.close();}
});
test("HTTP API client and handoff cannot send a credential; direct forged requests return no rows",async({page})=>{
 const calls:string[]=[];page.on("request",r=>{if(r.url().includes("/api/dashboards/device/"))calls.push(r.url());});
 await page.goto(`${origin()}/display/dashboards/1?deviceId=7`);
 const result=await page.evaluate(async token=>{
  const apiPath="/src/api/client.ts",handoffPath="/src/security/dashboardToken.ts";
  const {apiRequest}=await import(apiPath),{prepareDashboardTokenHandoff,requestDashboardTokenHandoff}=await import(handoffPath);
  let failure=0,sent=0;
  prepareDashboardTokenHandoff({postMessage:()=>sent++} as unknown as Window,1,token,()=>failure++);
  requestDashboardTokenHandoff(1,()=>sent++,()=>failure++);
  let code="";try{await apiRequest("/dashboards/device/1/kiosk/enrollment",{method:"POST",body:JSON.stringify({deviceId:7,token})});}catch(error){code=(error as {code:string}).code;}
  return{code,failure,sent};
 },token);
 expect(result).toEqual({code:"DASHBOARD_PROTECTED_TRANSPORT_REQUIRED",failure:2,sent:0});expect(calls).toHaveLength(0);
 for(const suffix of ["layout","page","data-sources/PRIMARY/page","kiosk/enrollment","kiosk/session"]){
  const response=await page.request.fetch(`${origin()}/api/dashboards/device/1/${suffix}`,{method:suffix==="layout"?"GET":"POST",headers:{"X-Forwarded-Proto":"https","X-UQP-Agent":"1","X-UQP-Kiosk":"1","X-Dashboard-Device-Token":token}});
  expect(response.status()).toBe(426);expect(response.headers()["cache-control"]).toBe("no-store");expect(await response.text()).not.toContain(token);expect(await response.text()).not.toContain("合○播放");
 }
});
for(const channel of [undefined,"msedge","chrome"] as const)test(`HTTP remains blocked after actual ${channel??"Chromium"} process/profile restart`,async()=>{
 test.skip(!!channel&&process.platform!=="win32","Installed Edge/Chrome are checked on Windows CI only");
 const directory=await mkdtemp(path.join(tmpdir(),"uqp77-http-profile-"));
 let context:import("@playwright/test").BrowserContext|undefined;
 try{
  for(let attempt=0;attempt<2;attempt++){
   context=await chromium.launchPersistentContext(directory,{headless:true,...(channel?{channel}:{executablePath:process.env.CHROMIUM_PATH})});
   if(attempt===0)await context.addInitScript(()=>{localStorage.setItem("uqp.dashboard.device.1","A".repeat(43));sessionStorage.setItem("uqp.dashboard.device.1","A".repeat(43));});
   const page=await context.newPage();const requests:string[]=[];page.on("request",r=>{if(r.url().includes("/api/dashboards/device/"))requests.push(r.url());});
   await page.goto(`${origin()}/display/dashboards/1?deviceId=7`);await expect(page.getByRole("alert")).toContainText("BLOCKED");
   await expect(page.locator("input")).toHaveCount(0);expect(requests).toHaveLength(0);expect(await context.cookies(origin())).toHaveLength(0);
   expect(await page.evaluate(()=>[localStorage.getItem("uqp.dashboard.device.1"),sessionStorage.getItem("uqp.dashboard.device.1")])).toEqual([null,null]);
   await context.close();context=undefined;
  }
 }finally{await context?.close();await rm(directory,{recursive:true,force:true});}
});
for(const days of [30,8,7,1])test(`HTTPS manual expiry ${days}d warning is generic and does not interrupt a valid stream`,async({page})=>{
 await state({expires:Date.now()+days*86400000},true);let delivered=0;page.on("response",r=>{if(new URL(r.url()).pathname.endsWith("/page")&&r.status()===200)delivered++;});await activate(page);
 const warning=page.getByText(/播放授權將於 7 天內到期/);if(days<=7)await expect(warning).toBeVisible();else await expect(warning).toHaveCount(0);
 if(days===7)await expect.poll(()=>delivered,{timeout:10000}).toBeGreaterThan(1);await expect(page.getByText("合○播放",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:/續期|重新核發/})).toHaveCount(0);
});
test("HTTPS manual no-expiry stays quiet, while expiry zero never returns patient rows",async({page})=>{
 await state({expires:null},true);await activate(page);await expect(page.getByText(/播放授權將於 7 天內到期/)).toHaveCount(0);
 await state({expires:Date.now()},true);await page.reload();await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);
});
for(const change of [{revoked:true},{ipDenied:true},{delegationDenied:true},{mode:"QUERY_ONLY_DISABLED"},{version:5},{policyDenied:true},{auditDenied:true}])test(`HTTPS manual retains runtime denial ${JSON.stringify(change)}`,async({page})=>{
 await activate(page);await state(change,true);await page.reload();await page.getByRole("checkbox",{name:/持久授權/}).uncheck();await page.getByLabel("Device Token",{exact:true}).fill(token);const denial=page.waitForResponse(r=>/\/(?:layout|page)$/.test(new URL(r.url()).pathname)&&r.status()>=400);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await denial;await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);await expect(page.locator("body")).not.toContainText("PRIVATE");
});
test("HTTPS manual expiry deadline clears data and renewal observed before expiry keeps playback authorized",async({page})=>{
 await state({expires:Date.now()+6500},true);await activate(page);await expect(page.getByText(/播放授權將於 7 天內到期/)).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0,{timeout:8000});await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();
 await state({expires:Date.now()+20000},true);await activate(page);await state({expires:Date.now()+40*86400000},true);await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));await expect(page.getByText(/播放授權將於 7 天內到期/)).toHaveCount(0);await expect(page.getByText("合○播放",{exact:true})).toBeVisible();
});
test("blocked HTTP does not enroll; existing HTTPS cookie flow still restores after reload",async({page,context})=>{
 await page.goto(`${origin()}/display/dashboards/1?deviceId=7`);await expect(page.getByRole("alert")).toContainText("BLOCKED");expect(await context.cookies(origin())).toHaveLength(0);
 await page.goto(`${secure()}/display/dashboards/1?deviceId=7`);await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByText("合○播放",{exact:true})).toBeVisible();
 const cookies=await context.cookies(secure());expect(cookies).toHaveLength(2);expect(cookies.every(c=>c.secure&&c.httpOnly&&c.sameSite==="Strict")).toBe(true);await page.reload();await expect(page.getByText("合○播放",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.cookie)).toBe("");
});
