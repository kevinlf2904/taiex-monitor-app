// 分頁用到才載入的程式：還沒載好就打開財報、大盤的上市／櫃買／官方公告、工具官方資料、選股條件組合、庫存總經敏感度，都會先顯示「載入中」再畫出來，不會出錯
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`分頁程式延後載入：打開就自動載、不出錯 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500, lazy: false });
  const loaded = () => p.evaluate(() => [...document.scripts].map(s => (s.getAttribute("src") || "").split("?")[0]).filter(Boolean));
  assert.ok(!(await loaded()).includes("earn.js"), "一打開不載財報的程式");
  const steps = [["earn", () => { setLt("earn"); }, () => typeof ER === "function" && !/載入中/.test($("#lx").textContent)],
    ["mkx", () => { W.mkReg = "off"; setLt("mkt"); }, () => typeof renderOff === "function" && !/載入中/.test($("#lx").textContent)],
    ["oapi", () => { W.tv = "oapi"; setLt("tools"); }, () => typeof oaToolsBody === "function"]];
  for (const [g, go, done] of steps) {
    await p.evaluate(go); await p.waitForFunction(done, null, { timeout: 15000 });
    assert.ok(await p.evaluate(g => lazyOk(g), g), `${g} 載好了`);
  }
  assert.ok((await loaded()).filter(f => f === "earn.js").length === 1, "同一個檔只載一次");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("分頁程式延後載入：網址直接開財報（#earnings/eps）、事件提醒在背景用到財報資料", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html#earnings/eps", { width: 1280, lazy: false });
  await p.waitForFunction(() => typeof ER === "function" && W.lt === "earn" && !/載入中/.test($("#lx").textContent), null, { timeout: 15000 });
  await p.evaluate(() => evData().catch(() => null));
  await ctx.close(); assert.deepEqual(errs, []);
});
