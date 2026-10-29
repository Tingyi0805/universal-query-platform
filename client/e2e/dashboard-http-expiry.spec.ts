import {test,expect} from "@playwright/test";
import {spawn,type ChildProcess} from "node:child_process";
import {request as requestHttp} from "node:http";
import {request as requestHttps} from "node:https";
import path from "node:path";
const token="A".repeat(43);
let httpFixture:ChildProcess,httpsFixture:ChildProcess,httpPort:number,httpsPort:number;
const origin=()=>`http://127.0.0.1:${httpPort}`,secure=()=>`https://127.0.0.1:${httpsPort}`;
function state(value:Record<string,unknown>,tls=false){return new Promise<void>((resolve,reject)=>{const request=tls?requestHttps:requestHttp;const req=request(`${tls?secure():origin()}/test/state`,{method:"POST",rejectUnauthorized:false,headers:{"content-type":"application/json"}},res=>{res.resume();res.on("end",()=>resolve());});req.on("error",reject);req.end(JSON.stringify(value));});}
async function start(flag:string){const process=spawn(globalThis.process.execPath,["--import","tsx","src/modules/dashboard/dashboardKiosk.testFixture.ts",flag],{cwd:path.resolve("../server"),stdio:["ignore","pipe","pipe"]});const port=await new Promise<number>((resolve,reject)=>{let output="";process.stdout!.on("data",d=>{output+=d.toString();if(/^\d+\n/.test(output))resolve(Number(output.trim()));});process.on("error",reject);process.on("exit",()=>reject(new Error("Synthetic HTTP fixture exited")));});return{process,port};}
async function activate(page:import("@playwright/test").Page,url=`${origin()}/display/dashboards/1?deviceId=7`){await page.goto(url);await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByText("合○播放",{exact:true})).toBeVisible();}
test.use({ignoreHTTPSErrors:true});
test.beforeAll(async()=>{const a=await start("--serve-http-fixture"),b=await start("--serve-kiosk-fixture");httpFixture=a.process;httpPort=a.port;httpsFixture=b.process;httpsPort=b.port;});
test.afterAll(()=>{httpFixture?.kill();httpsFixture?.kill();});
test.beforeEach(async()=>{for(const tls of [false,true])await state({revoked:false,expired:false,ipDenied:false,delegationDenied:false,policyDenied:false,auditDenied:false,mode:"QUERY_ONLY",version:4,token,expires:Date.now()+31*86400000},tls);});
test("HTTP manual playback never enrolls; F5/new browser asks for Token; attempted cookie enrollment fails closed",async({page,context,browser})=>{
 const calls:string[]=[];page.on("request",r=>{if(r.url().includes("/kiosk/"))calls.push(r.url());});await activate(page);expect(calls).toHaveLength(0);expect(await context.cookies(origin())).toHaveLength(0);
 const surface=await page.evaluate(()=>[document.cookie,...Object.values(localStorage),...Object.values(sessionStorage),document.body.textContent].join(" "));expect(surface).not.toContain(token);expect(page.url()).not.toContain(token);
 const result=await page.evaluate(async token=>{const res=await fetch(`/api/dashboards/device/1/kiosk/enrollment`,{method:"POST",headers:{"content-type":"application/json","X-UQP-Kiosk":"1"},body:JSON.stringify({deviceId:7,token})});return res.status;},token);expect(result).toBe(401);expect(await context.cookies(origin())).toHaveLength(0);
 await page.reload();await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();await expect(page.getByText(/HTTP 僅限信任的內網手動播放/)).toBeVisible();await expect(page.getByRole("checkbox",{name:/持久授權/})).toHaveCount(0);await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);
 const other=await browser.newContext();try{const p=await other.newPage();await p.goto(`${origin()}/display/dashboards/1?deviceId=7`);await expect(p.getByLabel("Device Token",{exact:true})).toBeVisible();}finally{await other.close();}
});
for(const days of [30,8,7,1])test(`HTTP expiry ${days}d warning is generic and does not interrupt a valid stream`,async({page})=>{
 await state({expires:Date.now()+days*86400000});let delivered=0;page.on("response",r=>{if(new URL(r.url()).pathname.endsWith("/page")&&r.status()===200)delivered++;});await activate(page);
 const warning=page.getByText(/播放授權將於 7 天內到期/);if(days<=7)await expect(warning).toBeVisible();else await expect(warning).toHaveCount(0);
 if(days===7)await expect.poll(()=>delivered,{timeout:10000}).toBeGreaterThan(1);await expect(page.getByText("合○播放",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:/續期|重新核發/})).toHaveCount(0);
});
test("HTTP no-expiry stays quiet, while expiry zero never returns patient rows",async({page})=>{
 await state({expires:null});await activate(page);await expect(page.getByText(/播放授權將於 7 天內到期/)).toHaveCount(0);
 await state({expires:Date.now()});await page.reload();await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);
});
for(const change of [{revoked:true},{ipDenied:true},{delegationDenied:true},{mode:"QUERY_ONLY_DISABLED"},{version:5},{policyDenied:true},{auditDenied:true}])test(`HTTP retains runtime denial ${JSON.stringify(change)}`,async({page})=>{
 await activate(page);await state(change);await page.reload();await page.getByLabel("Device Token",{exact:true}).fill(token);const denial=page.waitForResponse(r=>/\/(?:layout|page)$/.test(new URL(r.url()).pathname)&&r.status()>=400);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await denial;await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);await expect(page.locator("body")).not.toContainText("PRIVATE");
});
test("HTTP expiry deadline clears data and renewal observed before expiry keeps playback authorized",async({page})=>{
 await state({expires:Date.now()+6500});await activate(page);await expect(page.getByText(/播放授權將於 7 天內到期/)).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0,{timeout:8000});await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();
 await state({expires:Date.now()+20000});await activate(page);await state({expires:Date.now()+40*86400000});await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));await expect(page.getByText(/播放授權將於 7 天內到期/)).toHaveCount(0);await expect(page.getByText("合○播放",{exact:true})).toBeVisible();
});
test("HTTP-to-HTTPS upgrade requires fresh enrollment, then secure cookie restores after reload",async({page,context})=>{
 await activate(page);expect(await context.cookies(origin())).toHaveLength(0);await activate(page,`${secure()}/display/dashboards/1?deviceId=7`);const cookies=await context.cookies(secure());expect(cookies).toHaveLength(2);expect(cookies.every(c=>c.secure&&c.httpOnly&&c.sameSite==="Strict")).toBe(true);await page.reload();await expect(page.getByText("合○播放",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.cookie)).toBe("");
});
