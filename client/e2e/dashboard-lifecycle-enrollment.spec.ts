import { test, expect } from "@playwright/test";
const token = "R".repeat(43);
for (const allowed of [true, false]) test(`explicit lifecycle Enrollment ${allowed ? "success" : "denial"} uses proof without a legacy fallback`, async ({page}) => {
  const writes: {path: string; body: unknown; headers: Record<string,string>}[] = [];
  let proofCommitted = false, prematureRead = false;
  await page.route("https://kiosk.test/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) {
      await route.fulfill({response: await route.fetch({url: `http://127.0.0.1:4173${url.pathname}${url.search}`})}); return;
    }
    if (req.method() === "POST") writes.push({path:url.pathname,body:req.postDataJSON(),headers:req.headers()});
    if (url.pathname.endsWith("/session")) { await route.fulfill({status:401,json:{error:{code:"KIOSK_AUTHORIZATION_REQUIRED"}}});return; }
    if (url.pathname.endsWith("/enrollment-proof")) {
      proofCommitted=allowed;
      await route.fulfill(allowed ? {json:{dashboardId:1,deviceId:7,authorizationExpiresAt:Date.now()+300000}} : {status:401,json:{error:{code:"KIOSK_AUTHORIZATION_REQUIRED",message:"PRIVATE TOKEN DETAIL"}}}); return;
    }
    if (/\/(layout|page)$/.test(url.pathname)) {
      if (!proofCommitted) prematureRead = true;
      if (url.pathname.endsWith("/layout")) { await route.fulfill({json:{profiles:[{id:1,isDefault:true,canvasWidth:1080,canvasHeight:1920,config:{},widgets:[{id:1,widgetType:"TABLE",x:10,y:10,width:1000,height:500,fontSize:24,alignment:"LEFT",config:{},sortOrder:0}]}]}});return; }
      await route.fulfill({json:{page:1,totalPages:1,snapshotId:"snapshot",dashboard:{id:1,name:"重新授權播放",parameters:{},refreshSeconds:5,pageSeconds:5,pageSize:1},reportColumns:[],result:{columns:[{name:"NAME"}],rows:[{NAME:"合○播放"}]}}});return;
    }
    await route.fulfill({json:{}});
  });
  await page.goto("https://kiosk.test/display/dashboards/1?deviceId=7");
  await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();
  await page.getByLabel("使用恢復後的新 Token 重新授權",{exact:true}).check();
  await page.getByLabel("Device Token",{exact:true}).fill(token);
  await page.getByRole("button",{name:"驗證並啟用播放",exact:true}).click();
  if (allowed) await expect(page.getByText("合○播放",{exact:true})).toBeVisible();
  else { await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByText("合○播放",{exact:true})).toHaveCount(0); }
  const proofs=writes.filter(w=>w.path.endsWith("/enrollment-proof"));
  expect(proofs).toHaveLength(1);expect(proofs[0]!.body).toEqual({deviceId:7,token});
  expect(proofs[0]!.headers["x-uqp-kiosk"]).toBe("1");expect(proofs[0]!.headers).not.toHaveProperty("x-dashboard-device-token");
  expect(writes.filter(w=>w.path.endsWith("/enrollment"))).toHaveLength(0);expect(prematureRead).toBe(false);
  expect(page.url()).not.toContain(token);
  expect(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))).not.toContain(token);
  await expect(page.locator("body")).not.toContainText("PRIVATE TOKEN DETAIL");
});
test("HTTP offers no lifecycle proof enrollment",async({page})=>{
  await page.route(url=>url.pathname.startsWith("/api/"),r=>r.fulfill({json:{}}));
  await page.goto("/display/dashboards/1?deviceId=7");
  await expect(page.getByLabel("Device Token",{exact:true})).toBeVisible();
  await expect(page.getByLabel("使用恢復後的新 Token 重新授權",{exact:true})).toHaveCount(0);
  await expect(page.getByText(/暫停／恢復後，請使用原 BAT 專用瀏覽器/)).toBeVisible();
});
