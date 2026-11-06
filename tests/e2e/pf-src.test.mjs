// 投資組合的資料來源與更新標示：總覽、配置、績效、融資都有一行資料狀態（來源、行情日期、檔數、計算時間分開）；
// 報價抓失敗時不蓋掉上一次的資料，標示「沿用」與當初的取得時間（連續部分失敗也不刷新），自動重試一次、手動重新載入後再給一次；
// 晚回來的舊請求不覆蓋新資料；pfsrc.js 載入失敗時數字照樣顯示。固定假資料、手機與桌面
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
    await ctx.route("**/api/quote**", r => { if (/2317/.test(r.request().url())) calls++; r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "暫停服務" }) }); });
    await p.click('.hmcard [data-lg="pfreload"]');
    await p.waitForFunction(() => /這次拿不到報價/.test([...document.querySelectorAll("#lx .pfsrc")].map(e => e.innerText).join()), null, { timeout: 15000 });
    t = await txt(p); assert.match(t, /沿用 \d\d-\d\d \d\d:\d\d 取得的資料/); assert.ok(await p.$(".hmcard .pfsrc-error [data-lg=pfreload]"), "有重新載入的按鈕");
    assert.match(await p.evaluate(() => $("#lx").innerText), /總資產（台幣）\s*\$?[\d,]+/, "總資產還是上一次的數字，沒有變成空的");
    await p.waitForTimeout(4000); assert.equal(calls, 2, "總覽的報價：失敗一次＋自動重試一次");
    const before = calls; await p.waitForTimeout(3500); assert.equal(calls, before, "重試一次後就不再自己一直重試");
    // 手動重新載入：重新給一次自動重試
    await p.click('.hmcard .pfsrc [data-lg="pfreload"]'); await p.waitForTimeout(4500); assert.equal(calls, before + 2, "手動一次＋自動重試一次");
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

test("連續部分失敗：沿用的那檔標的是當初真正取得的時間；晚回來的舊請求不覆蓋新資料", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = null; W.lgAl = null; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector(".hmcard .pfsrc", { timeout: 30000 });
  const first = await p.evaluate(() => W.lgAl.items["2317"].at);
  // 之後只拿得到 2330（兩次）
  await ctx.route("**/api/quote**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", quotes: [{ code: "2330", price: 120, prev: 119, date: "2026-10-05" }] }) }));
  for (let i = 0; i < 2; i++) {
    await p.waitForTimeout(1100); await p.click('.hmcard [data-lg="pfreload"]');
    await p.waitForFunction(n => W.lgAl && !W.lgAl.refreshing && W.lgAl.tok === n, await p.evaluate(() => W.lgTok), { timeout: 15000 });
  }
  const st = await p.evaluate(() => ({ at: W.lgAl.items["2317"].at, kept: W.lgAl.meta.kept, now: W.lgAl.meta.fetchedAt, px: W.lgAl.px.get("2317")?.price }));
  assert.equal(st.at, first, "2317 的取得時間還是第一次的"); assert.deepEqual(st.kept.map(k => k.code), ["2317"]); assert.ok(st.now > first, "這次的取得時間比較新"); assert.ok(st.px > 0, "2317 的價格沿用");
  assert.match(await txt(p), /股2317 沿用 \d\d-\d\d \d\d:\d\d 取得的資料/);
  // 舊請求晚回來：先送出 A 組合（很慢），再送出 B 組合（很快）；A 回來後不能蓋掉 B
  await ctx.unroute("**/api/quote**");
  await ctx.route("**/api/quote**", async r => { const slow = /2454/.test(r.request().url()); if (slow) await new Promise(ok => setTimeout(ok, 2500)); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: slow ? "慢" : "快", quotes: [{ code: slow ? "2454" : "2603", price: 50, date: "2026-10-05" }] }) }); });
  await p.evaluate(() => { W.lt = "x"; lgAllocData([{ symbol: "2454", currency: "TWD" }]); lgAllocData([{ symbol: "2603", currency: "TWD" }]); });
  await p.waitForTimeout(3500);
  assert.deepEqual(await p.evaluate(() => [W.lgAl.key, W.lgAl.meta.sources]), ["2603", ["快"]], "最後一次的請求才算數");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("pfsrc.js 載入失敗：數字照樣顯示，標示無法確認資料來源", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/pfsrc.js*", r => r.fulfill({ status: 404, body: "" }));
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = null; W.lgAl = null; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector(".hmcard", { timeout: 30000 });
  assert.match(await p.evaluate(() => $("#lx").innerText), /總資產（台幣）\s*\$?[\d,]+/);
  assert.match(await txt(p), /資料狀態標示沒有載入，無法確認資料來源與是不是最新/);
  await ctx.close(); assert.deepEqual(errs, []);
});
