import {test,expect,chromium,type BrowserContext,type Page} from "@playwright/test";
import {spawn,type ChildProcess} from "node:child_process";
import {request as httpRequest} from "node:https";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
let fixture:ChildProcess,port:number;
const origin=()=>`https://127.0.0.1:${port}`;
test.use({ignoreHTTPSErrors:true});
const token="A".repeat(43);
function http(url:string,method:string,headers:Record<string,string>,body?:Buffer|string):Promise<{status:number;headers:Record<string,string>;body:Buffer}>{return new Promise((resolve,reject)=>{
 const req=httpRequest(url,{method,headers,rejectUnauthorized:false},res=>{const chunks:Buffer[]=[];res.on("data",c=>chunks.push(c));res.on("end",()=>{const h:Record<string,string>={};for(const[key,value]of Object.entries(res.headers))if(value!==undefined)h[key]=Array.isArray(value)?value.join("\n"):value;delete h["transfer-encoding"];delete h["content-length"];resolve({status:res.statusCode!,headers:h,body:Buffer.concat(chunks)});});});req.on("error",reject);req.end(body);
});}
async function state(value:Record<string,unknown>){await http(`${origin()}/test/state`,"POST",{"content-type":"application/json"},JSON.stringify(value));}
async function enroll(page:Page){await page.goto(`${origin()}/display/dashboards/1?deviceId=7`);await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByText("合○播放",{exact:true})).toBeVisible();}
test.beforeAll(async()=>{
 fixture=spawn(process.execPath,["--import","tsx","src/modules/dashboard/dashboardKiosk.testFixture.ts","--serve-kiosk-fixture"],{cwd:path.resolve("../server"),stdio:["ignore","pipe","pipe"]});
 port=await new Promise<number>((resolve,reject)=>{let text="";fixture.stdout!.on("data",data=>{text+=data.toString();if(/^\d+\n/.test(text))resolve(Number(text.trim()));});fixture.on("error",reject);fixture.on("exit",code=>reject(new Error(`Kiosk fixture exited ${code}`)));});
});
test.beforeEach(async()=>state({revoked:false,expired:false,ipDenied:false,delegationDenied:false,policyDenied:false,auditDenied:false,mode:"QUERY_ONLY",version:4,token,expires:Date.now()+86400000}));
test.afterAll(()=>{fixture.kill();});
test("HTTPS cookie enrollment survives F5 and a real browser process/profile restart; no JS-readable secret",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"uqp-kiosk-"));let context:BrowserContext|undefined;
 try{
  const launch=()=>chromium.launchPersistentContext(dir,{headless:true,executablePath:process.env.CHROMIUM_PATH,ignoreHTTPSErrors:true});
  context=await launch();const page=await context.newPage();await enroll(page);
  const cookies=await context.cookies(origin());expect(cookies).toHaveLength(2);for(const c of cookies){expect(c.httpOnly&&c.secure).toBe(true);expect(c.sameSite).toBe("Strict");expect(c.expires).toBeGreaterThan(Date.now()/1000);expect(c.value).not.toContain(token);}
  expect(await page.evaluate(()=>JSON.stringify([document.cookie,localStorage,sessionStorage]))).not.toContain(token);expect(await page.evaluate(()=>document.cookie)).toBe("");expect(page.url()).not.toContain(token);
  await page.reload();await expect(page.getByText("合○播放",{exact:true})).toBeVisible();await expect(page.getByLabel("Device Token",{exact:true})).toHaveCount(0);
  await context.close();context=await launch();const restarted=await context.newPage();await restarted.goto(`${origin()}/display/dashboards/1?deviceId=7`);await expect(restarted.getByText("合○播放",{exact:true})).toBeVisible();
  await restarted.getByRole("button",{name:"清除此瀏覽器持久授權"}).click();await expect(restarted.getByLabel("Device Token",{exact:true})).toBeVisible();expect(await context.cookies(origin())).toHaveLength(0);await restarted.reload();await expect(restarted.getByLabel("Device Token",{exact:true})).toBeVisible();
 }finally{await context?.close();await rm(dir,{recursive:true,force:true});}
});
for(const change of [{revoked:true},{expired:true},{ipDenied:true},{delegationDenied:true},{policyDenied:true},{mode:"QUERY_ONLY_DISABLED"},{version:5},{token:"B".repeat(43)}])test(`restart does not restore invalid authority ${JSON.stringify(change)}`,async({context,page})=>{
 await enroll(page);await state(change);await page.reload();await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);expect(await context.cookies(origin())).toHaveLength(0);await expect(page.locator("body")).not.toContainText("PRIVATE");
});
test("device identity isolates enrollments in the same dashboard and a separate browser",async({context,page,browser})=>{
 await enroll(page);await page.goto(`${origin()}/display/dashboards/1?deviceId=8`);await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);
 const other=await browser.newContext();try{const p=await other.newPage();await p.goto(`${origin()}/display/dashboards/1?deviceId=7`);await expect(p.getByLabel("Device Token",{exact:true})).toBeVisible();await expect(p.getByText("合○播放",{exact:true})).toHaveCount(0);}finally{await other.close();}
});
test("visible playback purges on policy/revocation recheck and disclosure failure",async({context,page})=>{
 await enroll(page);await state({policyDenied:true});await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0,{timeout:20000});await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();
 await state({policyDenied:false,auditDenied:true});await page.getByLabel("Device Token",{exact:true}).fill(token);await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);
});
test("server expiry deadline clears displayed patient data without waiting for the next refresh",async({context,page})=>{
 await state({expires:Date.now()+4500});await enroll(page);await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0,{timeout:7000});await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();
});
test("cross-origin form/fetch cannot enroll or clear the authorized browser cookies",async({context,page})=>{
 await enroll(page);await context.route("https://evil.test/**",r=>r.fulfill({contentType:"text/html",body:"<!doctype html><title>Untrusted origin</title>"}));
 const other=await context.newPage();await other.goto("https://evil.test/");
 const result=await other.evaluate(async(origin)=>{
  try{await fetch(`${origin}/api/dashboards/device/1/kiosk/forget`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json","X-UQP-Kiosk":"1"},body:JSON.stringify({deviceId:7})});return "unexpected";}catch{return "blocked";}
 },origin());expect(result).toBe("blocked");expect(await context.cookies(origin())).toHaveLength(2);await expect(page.getByText("合○播放",{exact:true})).toBeVisible();await other.close();
});
test("pagehide purges primary patient snapshots synchronously and bfcache restoration revalidates",async({context,page})=>{
 await enroll(page);const text=await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));return document.body.textContent;});expect(text).not.toContain("合○播放");await state({revoked:true});await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true})));await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0);
});
