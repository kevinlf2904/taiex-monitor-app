// 交易紀錄 →「績效」：重點數字、淨值走勢與比較基準、回撤、月報酬表、歸因、估算原因；日期範圍切換；圖上提示；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [
  { id: "a", v: 1, date: "2025-01-06", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 100, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2025-03-03", type: "transfer_in", symbol: "2317", market: "tw", currency: "TWD", shares: 2000, price: 90, fee: 0, tax: 0, source: "legacy" },
  { id: "c", v: 1, date: "2025-07-10", type: "dividend", symbol: "2330", market: "tw", currency: "TWD", amount: 3000 },
  { id: "d", v: 1, date: "2026-02-02", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 400, price: 110, fee: 0, tax: 0 },
  { id: "e", v: 1, date: "2025-05-05", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];

test("績效頁：重點數字、走勢、回撤、月報酬、歸因、估算原因；範圍切換與提示", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "2026-11-01" }); W.lg = { view: "perf" }; W.lgPx = null; W.holdView = "tx"; setLt("hold"); }, TX);
    await p.waitForSelector(".pfcard", { timeout: 30000 });
    let t = await p.evaluate(() => $("#lx").innerText);
    assert.match(t, /台股（台幣）/); assert.match(t, /美股（美元）/);
    for (const k of ["總損益", "時間加權報酬", "資金加權報酬", "最大回撤", "相對比較基準", "月報酬", "誰賺誰賠", "計算口徑"]) assert.match(t, new RegExp(k), width + "：" + k);
    assert.match(t, /估算/); assert.match(t, /舊庫存轉入/); assert.match(t, /加權指數（價格指數，不含股息）/);
    assert.equal(await p.evaluate(() => document.querySelectorAll(".pfline").length >= 2), true, "組合與比較基準兩條線");
    // 日期範圍：3 個月
    await p.click('[data-lg=range][data-v="3m"]'); await p.waitForSelector('[data-lg=range][data-v="3m"][aria-pressed="true"]');
    const d0 = await p.evaluate(() => document.querySelector(".pfdates span").textContent); assert.ok(d0 >= "2026-06-01", "3 個月的起點：" + d0);
    // 圖上提示
    await p.$eval(".pfplot", el => el.scrollIntoView({ block: "center" })); const box = await (await p.$(".pfplot")).boundingBox(); await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    t = await p.evaluate(() => document.querySelector(".pftip:not([hidden])")?.innerText || ""); assert.match(t, /我的組合[\s\S]*回撤[\s\S]*市值/);
    // 切回交易紀錄
    await p.click('[data-lg=view][data-v="tx"]'); await p.waitForSelector("[data-lg=add]");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
