// 分頁自訂：⚙ 自訂 打開編輯，取消勾選藏分頁、↑↓ 改順序、恢復預設；記在瀏覽器，重新整理還在；目前所在的分頁不能藏
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`分頁自訂順序與隱藏 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  const tabs = () => p.evaluate(() => [...document.querySelectorAll("#lTabs [data-l]")].filter(b => !b.hidden).map(b => b.dataset.l));
  const t0 = await tabs(); assert.ok(t0.includes("etf") && t0.includes("rank"));
  await p.click("#lTabs [data-tabcfg]"); await p.waitForSelector(".tabcfg");
  assert.equal(await p.locator(`.tabcfg [data-tcshow="${await p.evaluate(() => W.lt)}"]`).isDisabled(), true, "目前的分頁不能藏");
  await p.uncheck('.tabcfg [data-tcshow="etf"]'); assert.ok(!(await tabs()).includes("etf"), "ETF 藏起來");
  await p.click('.tabcfg [data-tcmv="rank:-1"]'); const t1 = await tabs(); assert.ok(t1.indexOf("rank") < t1.indexOf("cong"), `排行往前：${t1}`);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await p.reload(); await p.waitForTimeout(600); assert.deepEqual(await tabs(), t1, "重新整理後還在");
  await p.click("#lTabs [data-tabcfg]"); await p.click("[data-tcreset]"); assert.deepEqual(await tabs(), t0, "恢復預設");
  await ctx.close(); assert.deepEqual(errs, []);
});
