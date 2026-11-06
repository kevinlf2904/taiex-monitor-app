// 投資組合的資料來源與更新標示：總覽、配置、績效、融資都有一行資料狀態（來源、行情日期、檔數、計算時間分開）；
// 報價抓失敗時不蓋掉上一次的資料，標示「沿用」，自動重試一次、可以手動重新載入。固定假資料、手機與桌面
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-05", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 100, price: 90, fee: 0, tax: 0 }];
const txt = p => p.evaluate(() => [...document.querySelectorAll("#lx .pfsrc")].map(e => e.innerText).join("\n"));

test("資料狀態：各頁都有；報價失敗時沿用上一次的、可以重新載入", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); store.set("pf:margin:v1", { v: 1, accounts: [{ id: "m", name: "融資", type: "margin", source: "user", loan: 10000, collateral: [{ symbol: "2330", shares: 100 }] }] }); W.lg = null; W.lgAl = null; W.lgMg = null; W.lgPx = null; W.holdView = "tx"; setLt("hold"); }, TX);
    await p.waitForSelector(".hmcard .pfsrc", { timeout: 30000 });
    let t = await txt(p);
    assert.match(t, /報價：來源 t/); assert.match(t, /行情日期 2026-10-05/); assert.match(t, /2 檔都有/); assert.match(t, /融資擔保品報價/);
    // 報價服務壞掉：按重新載入 → 畫面還在、標示沿用、數字沒有變成空的
    let calls = 0;
    await ctx.route("**/api/quote**", r => { calls++; r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "暫停服務" }) }); });
    await p.click('.hmcard [data-lg="pfreload"]');
    await p.waitForFunction(() => /這次拿不到報價/.test([...document.querySelectorAll("#lx .pfsrc")].map(e => e.innerText).join()), null, { timeout: 15000 });
    t = await txt(p); assert.match(t, /沿用 .* 取得的資料/); assert.ok(await p.$(".hmcard .pfsrc-error [data-lg=pfreload]"), "有重新載入的按鈕");
    assert.match(await p.evaluate(() => $("#lx").innerText), /總資產（台幣）\s*\$?[\d,]+/, "總資產還是上一次的數字，沒有變成空的");
    await p.waitForTimeout(4000); assert.ok(calls >= 2, "失敗後自動重試一次：" + calls);
    const before = calls; await p.waitForTimeout(3500); assert.equal(calls, before, "重試一次後就不再自己一直重試");
    await ctx.unroute("**/api/quote**");
    // 配置、績效、融資頁也有資料狀態
    for (const [v, sel, re] of [["alloc", ".alcard", /報價：/], ["perf", ".pfcard", /日 K：/], ["margin", ".mgcard, .mgacct, .pfsrc", /擔保品報價：/]]) {
      await p.click(`[data-lg=view][data-v=${v}]`); await p.waitForFunction(r => new RegExp(r).test([...document.querySelectorAll("#lx .pfsrc")].map(e => e.innerText).join()), re.source, { timeout: 30000 });
      assert.match(await txt(p), /計算時間 \d\d:\d\d/, v + "：計算時間和行情時間分開寫");
    }
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
