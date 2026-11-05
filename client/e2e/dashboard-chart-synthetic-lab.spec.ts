import {test,expect} from "@playwright/test";

test("Stage 18 standalone synthetic charts add edit, rearrange and preview fullscreen without API",async({page})=>{
 const apiCalls:string[]=[];
 await page.route(/\/api\//,route=>{
   apiCalls.push(route.request().url());
   return route.abort();
 });
 await page.goto("/chart-lab.html");
 await expect(page.getByRole("heading",{name:"Dashboard 圖表功能實測區"})).toBeVisible();
 await expect(page.getByText(/沒有查詢 API/)).toBeVisible();
 const canvas=page.getByLabel("合成圖表編排畫布");
 await expect(canvas.locator(".chart-lab-item")).toHaveCount(1);
 await page.getByLabel("圖表類型").selectOption("LINE");
 await expect(canvas.getByRole("img",{name:"候診統計（合成資料），僅合成資料"})).toBeVisible();
 await page.getByLabel("圖表標題").fill("合成門診狀態");
 await page.getByLabel("合成資料情境").selectOption("rooms");
 await page.getByLabel("資料來源標籤").selectOption("OR");
 await page.getByLabel("位置 X").fill("170");
 await expect(page.getByLabel("位置 X")).toHaveValue("170");
 await page.getByRole("button",{name:"＋新增圖表"}).click();
 await expect(canvas.locator(".chart-lab-item")).toHaveCount(2);
 await expect(page.getByLabel("圖表標題")).toHaveValue("合成圖表 2");
 await page.getByLabel("圖表類型").selectOption("PIE");
 await page.getByLabel("合成資料情境").selectOption("capacity");
 await expect(canvas.getByRole("img",{name:"合成圖表 2，僅合成資料"})).toBeVisible();
 await page.getByRole("button",{name:"複製選取圖表"}).click();
 await expect(canvas.locator(".chart-lab-item")).toHaveCount(3);
 await page.getByRole("button",{name:"移除選取圖表"}).click();
 await expect(canvas.locator(".chart-lab-item")).toHaveCount(2);
 await page.getByLabel("螢幕版型").selectOption("1080x1920");
 await expect(page.getByRole("heading",{name:/合成畫布 · 1080 × 1920/})).toBeVisible();
 await page.getByRole("button",{name:"開啟合成全螢幕預覽"}).click();
 const preview=page.getByRole("dialog",{name:"合成圖表全螢幕預覽"});
 await expect(preview).toBeVisible();
 await expect(preview.getByLabel("合成圖表播放畫布").locator(".chart-lab-item")).toHaveCount(2);
 await preview.getByRole("button",{name:"退出全螢幕"}).click();
 await expect(preview).toHaveCount(0);
 expect(apiCalls).toEqual([]);
 await page.reload();
 await expect(page.getByLabel("合成圖表編排畫布").locator(".chart-lab-item")).toHaveCount(1);
 await expect(page.getByLabel("圖表標題")).toHaveValue("候診統計（合成資料）");
 expect(apiCalls).toEqual([]);
});

test("Stage 18 chart lab remains permission guarded inside UQP but standalone needs no login",async({page})=>{
 await page.goto("/designer/dashboards/chart-lab");
 await expect(page).toHaveURL(/\/login/);
 await page.goto("/chart-lab.html");
 await expect(page.getByRole("heading",{name:"Dashboard 圖表功能實測區"})).toBeVisible();
 await expect(page.getByText(/離開／重新整理後不保留/)).toBeVisible();
});
