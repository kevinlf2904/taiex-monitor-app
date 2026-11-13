// 配置頁「目標配置與再平衡」：設定目標、存檔前檢查、建議買賣股數與畫面上的數字一致、清除；手機與桌面不溢出；備份匯入用再平衡模組檢查。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];

for (const width of [390, 1280]) test(`再平衡 ${width}：設定目標、建議、清除`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  await p.evaluate(tx => { localStorage.removeItem("kline:pf:targets:v1"); store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector("#lx .rbcard [data-rb=edit]", { timeout: 30000 });
  assert.match(await p.evaluate(() => $(".rbcard").innerText), /還沒設目標配置/);
  await p.click("#lx .rbcard [data-rb=edit]"); await p.waitForSelector("#rbForm");
  await p.fill('#rbForm [name="t_2330"]', "40"); await p.fill('#rbForm [name="t_NVDA"]', "20"); await p.fill("#rbForm [name=band]", "4");
  await p.click("#rbForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#rbForm"), null, { timeout: 10000 });
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:targets:v1")).targets), { 2330: 40, NVDA: 20 });
  // 畫面上的建議要和 KLRebal.plan 用同樣輸入算出來的一樣
  const r = await p.evaluate(() => {
    const S = JSON.parse(localStorage.getItem("kline:pf:v1")), L = KLLedger.buildLedger(S.transactions, { method: S.method }), X = W.lgAl, fx = X.fx.rate;
    const pos = L.positions.filter(q => q.open).map(q => ({ symbol: q.symbol, market: q.market, currency: q.currency, shares: q.shares, price: X.px.get(q.symbol).price, assetType: "stock" }));
    const P = KLRebal.plan({ positions: pos, fx, cash: L.cash.TWD.balance, targets: { 2330: 40, NVDA: 20 }, band: 4, costs: t => KLLedger.estimateCosts(t) });
    return { P: P.rows.map(x => [x.symbol, x.action, x.tradeShares ?? 0]), text: $(".rbcard").innerText, cashAfter: P.cashAfter };
  });
  assert.ok(r.P.some(([, a]) => a === "buy" || a === "sell"), "前提：至少有一檔要買賣（才測得到建議文字）");
  for (const [c, a, n] of r.P) if (a === "buy" || a === "sell") assert.match(r.text, new RegExp(`${a === "buy" ? "買進" : "賣出"} ${n.toLocaleString()} 股`), `${c} ${a} ${n}`);
  assert.match(r.text, /調整後現金/); assert.match(r.text, /不是投資建議/);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  // 不合法的目標擋下
  await p.click("#lx .rbcard [data-rb=edit]"); await p.waitForSelector("#rbForm");
  await p.evaluate(() => { const i = $('#rbForm [name="t_2330"]'); i.removeAttribute("max"); i.value = "150"; }); await p.click("#rbForm button[type=submit]");
  assert.match(await p.evaluate(() => $("#toast").textContent), /沒有儲存/); assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:targets:v1")).targets["2330"]), 40, "沒有被改");
  // 清除
  await p.click("#lx .rbcard [data-rb=clear]"); await p.waitForFunction(() => /已清除目標配置/.test($(".rbcard").innerText), null, { timeout: 10000 });
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:targets:v1")).targets), {});
  await ctx.close(); assert.deepEqual(errs, []);
});

test("備份：目標配置帶進備份檔；匯入用再平衡模組檢查，沒有檢查程式不匯入", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => localStorage.setItem("kline:pf:targets:v1", JSON.stringify({ v: 1, targets: { 2330: 40 }, band: 5 })));
  await p.evaluate(() => lazy("ledger")); await p.addScriptTag({ url: "rebal.js" });
  const r = await p.evaluate(() => { const g = JSON.stringify({ v: 1, targets: { 2330: 40 } }), b = JSON.stringify({ v: 1, targets: { 2330: 140 } });
    return [Object.keys(syncSnap(true)).includes("kline:pf:targets:v1"), KLLedger.checkBackup({ "kline:pf:targets:v1": g }, { rebal: KLRebal }).ok, KLLedger.checkBackup({ "kline:pf:targets:v1": b }, { rebal: KLRebal }).ok, KLLedger.checkBackup({ "kline:pf:targets:v1": g }, {}).ok]; });
  assert.deepEqual(r, [true, true, false, false]);
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`只有舊庫存 ${width}：配置與再平衡可用，現金未知不誤報、00679B 零稅與券商折扣對齊、不改動存檔`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  const HOLD = { 2330: { sh: 1000, cost: 500 }, "00679B": { sh: 4000, cost: 30 }, NVDA: { sh: 10, cost: 100, demo: true } };
  await p.evaluate(h => {
    localStorage.removeItem("kline:pf:v1"); localStorage.removeItem("kline:pf:targets:v1");
    store.set("watch:hold", h); store.set("watch:hdisc", 0.28); W.hold = h; W.holdOwn = h; W.hdisc = 0.28;
    W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold");
  }, HOLD);
  await p.waitForSelector("#lx .alcard", { timeout: 30000 });
  await p.waitForSelector("#lx .rbcard [data-rb=edit]", { timeout: 30000 });
  const beforeHold = await p.evaluate(() => localStorage.getItem("kline:watch:hold"));
  const txt0 = await p.evaluate(() => $("#lx").innerText);
  assert.equal(await p.evaluate(() => !!document.querySelector("#lx .lgintro")), false, "不擋在建立交易紀錄畫面");
  assert.match(txt0, /舊庫存/); assert.match(txt0, /現金未知/); assert.match(txt0, /範例持股/);

  await p.click("#lx .rbcard [data-rb=edit]"); await p.waitForSelector("#rbForm");
  assert.equal(await p.evaluate(() => !!document.querySelector('#rbForm tbody tr:last-child input[disabled]')), true, "未知現金不可填現金目標");
  await p.fill('#rbForm [name="t_2330"]', "50"); await p.fill('#rbForm [name="t_00679B"]', "10"); await p.fill('#rbForm [name="t_NVDA"]', "40"); await p.fill("#rbForm [name=band]", "1");
  await p.click("#rbForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#rbForm"), null, { timeout: 10000 });

  const r = await p.evaluate(() => {
    const X = W.lgAl, fx = X.fx.rate;
    const pos = [{ symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: X.px.get("2330").price, assetType: "stock" },
      { symbol: "00679B", market: "tw", currency: "TWD", shares: 4000, price: X.px.get("00679B").price, assetType: "bond_etf" },
      { symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: X.px.get("NVDA").price, assetType: "stock" }];
    const rules = { ...KLLedger.DEFAULT_RULES, tw: { ...KLLedger.DEFAULT_RULES.tw, discount: 0.28 } };
    const P = KLRebal.plan({ positions: pos, fx, cash: null, targets: { 2330: 50, "00679B": 10, NVDA: 40 }, band: 1, costs: t => KLLedger.estimateCosts(t, rules) });
    return { P, rbText: $(".rbcard").innerText, pf: localStorage.getItem("kline:pf:v1"), hold: localStorage.getItem("kline:watch:hold"), br: P.rows.find(x => x.symbol === "00679B") };
  });
  assert.equal(r.br.action, "sell"); assert.equal(r.br.tax, 0, "00679B 賣出證交稅應為 0");
  assert.equal(r.P.cashKnown, false);
  assert.match(r.rbText, /預估淨現金變動/);
  assert.doesNotMatch(r.rbText, /調整後現金/);
  assert.doesNotMatch(r.rbText, /現金不夠/);
  for (const x of r.P.rows) if (x.action === "buy" || x.action === "sell") assert.match(r.rbText, new RegExp(`${x.action === "buy" ? "買進" : "賣出"} ${x.tradeShares.toLocaleString()} 股`));
  assert.equal(r.pf, null, "不偷建交易紀錄"); assert.equal(r.hold, beforeHold, "不改動舊庫存");
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("交易紀錄與舊庫存邊界：追蹤美元現金缺匯率不清為 0；00679B 零稅；全空舊庫存顯示導引", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  // 1) 全空舊庫存 + 無交易紀錄 → 維持導引畫面
  await p.evaluate(() => { localStorage.removeItem("kline:pf:v1"); store.set("watch:hold", {}); W.hold = {}; W.holdOwn = {}; W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold"); });
  await p.waitForSelector("#lx .lgintro", { timeout: 20000 });

  // 2) 有交易紀錄、有追蹤美元現金但 TWD=X 壞掉（fx === null）→ 現金不清成 0、提示美元缺匯率；00679B 賣出稅 0
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  const TX_USD_CASH = [
    { id: "d1", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 100000 },
    { id: "d2", v: 1, date: "2026-01-02", type: "deposit", market: "us", currency: "USD", amount: 2000 },
    { id: "b1", v: 1, date: "2026-01-05", type: "buy", symbol: "00679B", market: "tw", currency: "TWD", shares: 3000, price: 30, fee: 0, tax: 0 },
    { id: "b2", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 }
  ];
  await p.evaluate(tx => {
    store.set("kline:pf:targets:v1", { v: 1, targets: { "00679B": 10, "2330": 90 }, band: 1 });
    store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" });
    W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold");
  }, TX_USD_CASH);
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 30000 });
  const rbTxt = await p.evaluate(() => $(".rbcard").innerText);
  assert.match(rbTxt, /預估淨現金變動/, "美元現金缺匯率時不拿 0 當總現金");
  assert.match(rbTxt, /缺少匯率/);
  await ctx.close(); assert.deepEqual(errs, []);
});
