// 交易紀錄、績效的「全部／台股／美股」切換：清單、各幣別小計、持股、績效卡片跟著篩選；台幣合併只在「全部」；
// 上方舊庫存的台股／美股切換在交易紀錄藏起來；錯誤提醒不因切換而藏起來。固定假資料、手機與桌面
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 900, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const lx = p => p.evaluate(() => $("#lx").innerText);

test("全部／台股／美股：交易紀錄與績效", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
    await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "tx" }; W.holdView = "tx"; setLt("hold"); }, TX);
    await p.waitForSelector(".lgmkt", { timeout: 30000 });
    assert.equal(await p.evaluate(() => $("#holdSeg")?.hidden), true, "舊庫存的台股／美股切換藏起來");
    let t = await lx(p); assert.match(t, /交易紀錄（3 筆）/); assert.match(t, /台股（台幣）/); assert.match(t, /美股（美元）/);
    await p.click("[data-lg=mkt][data-v=us]"); t = await lx(p);
    assert.match(t, /交易紀錄（1 筆，只顯示美股；全部 3 筆）/); assert.doesNotMatch(t, /台股（台幣）/); assert.match(t, /NVDA/); assert.doesNotMatch(t, /\b2330\b/);
    await p.click("[data-lg=mkt][data-v=tw]"); t = await lx(p);
    assert.match(t, /交易紀錄（2 筆，只顯示台股；全部 3 筆）/, "入金是台幣，算台股"); assert.doesNotMatch(t, /美股（美元）/); assert.doesNotMatch(t, /NVDA/);
    // 績效：切換跟著帶過去；台幣合併只在「全部」
    await p.click("[data-lg=view][data-v=perf]"); await p.waitForSelector(".pfcard", { timeout: 30000 });
    t = await lx(p); assert.match(t, /台股（台幣）/); assert.doesNotMatch(t, /美股（美元）|合併（台幣計價）/);
    await p.click("[data-lg=mkt][data-v=all]"); await p.waitForSelector(".pffx", { timeout: 30000 });
    t = await lx(p); assert.match(t, /台股（台幣）/); assert.match(t, /美股（美元）/); assert.match(t, /合併（台幣計價）/);
    assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, width + "：沒有水平溢出");
    // 總覽、配置沒有市場切換（看整個投資組合）
    await p.click("[data-lg=view][data-v=home]"); await p.waitForSelector(".hmcard", { timeout: 30000 }); assert.equal(await p.$(".lgmkt"), null);
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("切到美股時，台股的錯誤交易提醒仍然顯示", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  const bad = [...TX, { id: "x", v: 1, date: "2026-02-01", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 999, price: 1, fee: 0, tax: 0 }];
  await p.evaluate(tx => { localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: tx, at: "x" })); W.lg = { view: "tx", mkt: "us" }; W.holdView = "tx"; setLt("hold"); }, bad);
  await p.waitForSelector(".lgmkt", { timeout: 30000 });
  assert.match(await lx(p), /1 筆交易有錯誤/);
  await ctx.close(); assert.deepEqual(errs, []);
});
