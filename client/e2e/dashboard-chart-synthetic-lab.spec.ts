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
 const legend=page.locator(".chart-lab-editor label.chart-lab-check");
 const checkbox=legend.getByRole("checkbox",{name:"顯示圖例"});
 const legendText=legend.locator("span");
 await expect(legend).toBeVisible();
 const checkRect=await checkbox.boundingBox(),textRect=await legendText.boundingBox();
 expect(checkRect).not.toBeNull();expect(textRect).not.toBeNull();
 expect(textRect!.x-(checkRect!.x+checkRect!.width)).toBeGreaterThanOrEqual(0);
 expect(textRect!.x-(checkRect!.x+checkRect!.width)).toBeLessThan(16);
 expect(Math.abs((checkRect!.y+checkRect!.height/2)-(textRect!.y+textRect!.height/2))).toBeLessThan(6);
 await checkbox.check();await expect(checkbox).toBeChecked();
 await checkbox.uncheck();await expect(checkbox).not.toBeChecked();
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


test("Stage 19 coordinates support ordinary select-all and digit-by-digit width/height entry",async({page})=>{
 await page.goto("/chart-lab.html");
 const width=page.getByLabel("位置 WIDTH");
 const height=page.getByLabel("位置 HEIGHT");
 // Before this regression fix, the first digit 3 was clamped to 160,
 // so subsequent input could not become 300 by typing normally.
 await width.click();
 await width.press("ControlOrMeta+A");
 await width.pressSequentially("300");
 await expect(width).toHaveValue("300");
 await width.press("Enter");
 await expect(width).toHaveValue("300");
 await height.click();
 await height.press("ControlOrMeta+A");
 await height.pressSequentially("200");
 await expect(height).toHaveValue("200");
 await height.press("Tab");
 await expect(height).toHaveValue("200");
 // Edited dimensions survive selecting another chart, confirming actual
 // geometry was updated instead of just showing uncommitted input text.
 await page.getByRole("button",{name:"＋新增圖表"}).click();
 await page.getByLabel("選取圖表").selectOption("1");
 await expect(page.getByLabel("位置 WIDTH")).toHaveValue("300");
 await expect(page.getByLabel("位置 HEIGHT")).toHaveValue("200");
 // An unfinished empty edit must restore the last valid value, not min.
 await width.fill("");
 await width.press("Tab");
 await expect(width).toHaveValue("300");
 // Out-of-bounds final value still clamps only after editing has finished.
 await height.fill("5");
 await expect(height).toHaveValue("5");
 await height.press("Tab");
 await expect(height).toHaveValue("120");
});


test("Stage 19 custom screen width and height apply only after validation, across landscape and portrait",async({page})=>{
 await page.goto("/chart-lab.html");
 const selector=page.getByLabel("螢幕版型");
 const canvas=page.getByLabel("合成圖表編排畫布");
 await expect(page.getByRole("heading",{name:"合成畫布 · 1920 × 1080"})).toBeVisible();
 await selector.selectOption("custom");
 const width=page.getByLabel("自訂畫布寬度");
 const height=page.getByLabel("自訂畫布高度");
 await width.fill("1600");
 await height.fill("900");
 // The draft is independent: no partial resizing while typing.
 await expect(page.getByRole("heading",{name:"合成畫布 · 1920 × 1080"})).toBeVisible();
 await page.getByRole("button",{name:"套用自訂尺寸"}).click();
 await expect(page.getByRole("heading",{name:"合成畫布 · 1600 × 900"})).toBeVisible();
 await expect(canvas.locator(".chart-lab-item")).toHaveCount(1);
 // Portrait size can also be arbitrary, not merely a fixed preset.
 await width.fill("900");
 await height.fill("1600");
 await page.getByRole("button",{name:"套用自訂尺寸"}).click();
 await expect(page.getByRole("heading",{name:"合成畫布 · 900 × 1600"})).toBeVisible();
 // Invalid values are rejected without changing any existing chart.
 await width.fill("100");
 await page.getByRole("button",{name:"套用自訂尺寸"}).click();
 await expect(page.getByRole("alert")).toContainText("寬度 320～7680");
 await expect(page.getByRole("heading",{name:"合成畫布 · 900 × 1600"})).toBeVisible();
 await width.fill("3840");
 await height.fill("2160");
 await page.getByRole("button",{name:"套用自訂尺寸"}).click();
 await expect(page.getByRole("alert")).toHaveCount(0);
 await expect(page.getByRole("heading",{name:"合成畫布 · 3840 × 2160"})).toBeVisible();
 await selector.selectOption("1366x768");
 await expect(page.getByRole("heading",{name:"合成畫布 · 1366 × 768"})).toBeVisible();
 await page.getByRole("button",{name:"開啟合成全螢幕預覽"}).click();
 await expect(page.getByRole("dialog",{name:"合成圖表全螢幕預覽"})).toContainText("1366 × 768");
 await page.getByRole("button",{name:"退出全螢幕"}).click();
 await page.getByRole("button",{name:"重設所有合成設定"}).click();
 await expect(selector).toHaveValue("1920x1080");
 await expect(page.getByRole("heading",{name:"合成畫布 · 1920 × 1080"})).toBeVisible();
});
