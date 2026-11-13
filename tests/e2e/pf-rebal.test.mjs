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
  const HOLD = { 2330: { sh: 1000, cost: 500 }, "00679B": { sh: 4000, cost: 30 }, NVDA: { sh: 10, cost: 100 }, "9958": { sh: 100, cost: 100, demo: true } };
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
  assert.match(txt0, /舊庫存/); assert.match(txt0, /現金未知/); assert.match(txt0, /已略過 1 筆範例持股/);
  assert.doesNotMatch(txt0, /9958/);

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
    const P = KLRebal.plan({ positions: pos, fx, cash: null, targets: { 2330: 50, "00679B": 10, NVDA: 40 }, targetBasis: "holdings", band: 1, costs: t => KLLedger.estimateCosts(t, rules) });
    const bondLiText = [...document.querySelectorAll("#lx .rbcard .rblist li")].find(li => li.innerText.includes("00679B"))?.innerText || "";
    return { P, rbText: $(".rbcard").innerText, bondLiText, pf: localStorage.getItem("kline:pf:v1"), hold: localStorage.getItem("kline:watch:hold"), br: P.rows.find(x => x.symbol === "00679B"), st: JSON.parse(localStorage.getItem("kline:pf:targets:v1") || "{}") };
  });
  assert.equal(r.st.basis, "holdings");
  assert.equal(r.br.action, "sell"); assert.equal(r.br.tax, 0, "00679B 賣出證交稅應為 0");
  assert.equal(r.P.cashKnown, false);
  assert.match(r.rbText, new RegExp(`費用與稅（估算）\\s*\\$?${r.P.fees.toLocaleString()}`), "舊庫存畫面費用與 00679B 零稅試算一致");
  assert.match(r.bondLiText, new RegExp(`費稅 ${r.br.costBase.toLocaleString()}(\\s|$)`), "00679B 單列僅含手續費不含 0.1% 證交稅");
  assert.doesNotMatch(txt0, /bond_etf/, "配置類型統計（KLAlloc）維持 ETF 分類而不顯示未翻譯的 bond_etf");
  assert.match(r.rbText, /預估淨現金變動/);
  assert.doesNotMatch(r.rbText, /調整後現金/);
  assert.doesNotMatch(r.rbText, /現金不夠/);
  assert.doesNotMatch(r.rbText, /9958/, "範例持股不進入再平衡列表");
  for (const x of r.P.rows) if (x.action === "buy" || x.action === "sell") assert.match(r.rbText, new RegExp(`${x.action === "buy" ? "買進" : "賣出"} ${x.tradeShares.toLocaleString()} 股`));
  assert.equal(r.pf, null, "不偷建交易紀錄"); assert.equal(r.hold, beforeHold, "不改動舊庫存");
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("舊庫存邊界：全空導引、缺報價與無效資料明確警告", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  // 1) 全空舊庫存 + 無交易紀錄 → 維持導引畫面
  await p.evaluate(() => { localStorage.removeItem("kline:pf:v1"); store.set("watch:hold", {}); W.hold = {}; W.holdOwn = {}; W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold"); });
  await p.waitForSelector("#lx .lgintro", { timeout: 20000 });

  // 2) 舊庫存含缺報價（2454）與無效資料（BAD1 cost:0）→ 明確警告，不默默略過或假設 0
  await ctx.route("**/api/quote**", r => { const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(Boolean).filter(c => c !== "2454");
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", today: "2026-10-05", quotes: codes.map((c, i) => ({ code: c, name: "股" + c, price: 100 + i, prev: 99, date: "2026-10-05", time: "10:30:05" })) }) }); });
  await p.evaluate(() => {
    localStorage.setItem("kline:pf:targets:v1", JSON.stringify({ v: 1, targets: { 2330: 50, 2454: 50 }, band: 1 }));
    const H = { 2330: { sh: 1000, cost: 90 }, 2454: { sh: 500, cost: 100 }, BAD1: { sh: 10, cost: 0 }, TXF: { sh: 1, cost: 20000 } };
    store.set("watch:hold", H); W.hold = H; W.holdOwn = H; W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold");
  });
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 30000 });
  const badTxt = await p.evaluate(() => $("#lx").innerText);
  assert.match(badTxt, /略過 2 筆無法算入的舊庫存/); assert.match(badTxt, /BAD1/);
  assert.match(badTxt, /TXF（期貨不納入配置與再平衡）/);
  assert.match(badTxt, /沒有報價.*2454/);
  assert.ok(!(await p.evaluate(() => $("#lx .rbcard .rblist").innerText)).includes("TXF"), "期貨不應進入再平衡清單");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("交易紀錄邊界：追蹤美元現金缺匯率不清為 0，00679B 賣出證交稅 0", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  const TX_USD_CASH = [
    { id: "d1", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 100000 },
    { id: "d2", v: 1, date: "2026-01-02", type: "deposit", market: "us", currency: "USD", amount: 2000 },
    { id: "b1", v: 1, date: "2026-01-05", type: "buy", symbol: "00679B", market: "tw", currency: "TWD", shares: 3000, price: 30, fee: 0, tax: 0 },
    { id: "b2", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 }
  ];
  await p.evaluate(tx => {
    localStorage.setItem("kline:pf:targets:v1", JSON.stringify({ v: 1, targets: { "00679B": 10, "2330": 90 }, band: 1 }));
    store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" });
    W.hdisc = 1; W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold");
  }, TX_USD_CASH);
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 30000 });
  const rbTxt = await p.evaluate(() => $(".rbcard").innerText);
  assert.match(rbTxt, /預估淨現金變動/, "美元現金缺匯率時不拿 0 當總現金");
  assert.match(rbTxt, /缺少匯率/);
  // 驗證交易紀錄模式下 00679B 賣出稅為 0 且與畫面顯示費用一致（若誤當一般 ETF 會多出 0.1% 證交稅）
  const ledgerCheck = await p.evaluate(() => {
    const X = W.lgAl, p0 = X.px.get("00679B").price, p1 = X.px.get("2330").price;
    const pos = [{ symbol: "00679B", market: "tw", currency: "TWD", shares: 3000, price: p0, assetType: "bond_etf" }, { symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: p1, assetType: "stock" }];
    const P = KLRebal.plan({ positions: pos, fx: null, cash: null, targets: { "00679B": 10, "2330": 90 }, band: 1, costs: t => KLLedger.estimateCosts(t) });
    return { tax: P.rows.find(r => r.symbol === "00679B")?.tax, fees: P.fees };
  });
  assert.equal(ledgerCheck.tax, 0);
  assert.match(rbTxt, new RegExp(`費用與稅（估算）\\s*\\$?${ledgerCheck.fees.toLocaleString()}`), "畫面費用不含 00679B 交易稅");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("審查 P2：已選舊庫存且舊庫存為空時顯示舊庫存空狀態，不退回交易帳本", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => {
    store.set("watch:hold", {});
    store.set("pf:v1", { v: 1, method: "avg", transactions: [{ id: "b1", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 }], at: "x" });
    W.hold = {}; W.holdOwn = {}; W.holdLg = true; W.hsrcLegacy = true;
    W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold");
  });
  await p.waitForSelector('#lx [data-lg="hsrcLedger"]', { timeout: 20000 });
  const txt = await p.evaluate(() => $("#lx").innerText);
  assert.match(txt, /目前看的是舊庫存/);
  assert.match(txt, /目前沒有持股，沒有配置可以看/);
  assert.doesNotMatch(txt, /全部資產（台幣計價）/);
  assert.doesNotMatch(txt, /台積電|2330/);
  await p.click('#lx [data-lg="hsrcLedger"]');
  await p.waitForSelector("#lx .alcard", { timeout: 30000 });
  const backTxt = await p.evaluate(() => $("#lx").innerText);
  assert.match(backTxt, /全部資產（台幣計價）/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("審查 P2：現金未知時儲存其他目標不刪除既有 CASH 目標；按清除才刪除", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => {
    localStorage.setItem("kline:pf:targets:v1", JSON.stringify({ v: 1, targets: { 2330: 50, CASH: 20 }, band: 5 }));
    const H = { 2330: { sh: 1000, cost: 90 } };
    store.set("watch:hold", H); W.hold = H; W.holdOwn = H; W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold");
  });
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 30000 });
  const initTxt = await p.evaluate(() => $(".rbcard").innerText);
  assert.match(initTxt, /現金未知，已存的現金目標本次不套用/);
  await p.click('[data-rb="edit"]');
  await p.fill('#rbForm input[name="t_2330"]', "60");
  await p.click('#rbForm button[type="submit"]');
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 20000 });
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:targets:v1") || "{}"));
  assert.equal(saved.targets["2330"], 60);
  assert.equal(saved.targets.CASH, 20, "現金未知模式下儲存其他目標不得刪掉既有 CASH 目標");
  const afterTxt = await p.evaluate(() => $(".rbcard").innerText);
  assert.match(afterTxt, /現金未知，已存的現金目標本次不套用/);
  await p.click('[data-rb="edit"]');
  await p.click('[data-rb="clear"]');
  await p.waitForSelector('#lx .rbcard [data-rb="edit"]', { timeout: 20000 });
  const cleared = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:targets:v1") || "{}"));
  assert.deepEqual(cleared.targets, {});
  await ctx.close(); assert.deepEqual(errs, []);
});

test("審查 P1／P3：total 與 holdings 目標基準切換不誤買賣；全範例／期貨顯示略過空狀態", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/api/quote**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, quotes: [
    { code: "0050", name: "元大台灣50", price: 200 },
    { code: "2330", name: "台積電", price: 1000 }
  ] }) }));
  await ctx.route("**/api/etf**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await p.evaluate(() => {
    localStorage.removeItem("kline:pf:targets:v1");
    const H = { "0050": { sh: 1000, cost: 200 }, "2330": { sh: 100, cost: 1000 } };
    store.set("watch:hold", H); W.hold = H; W.holdOwn = H;
    store.set("pf:v1", { v: 1, method: "avg", transactions: [
      { id: "d1", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 385714 },
      { id: "b1", v: 1, date: "2026-01-05", type: "buy", symbol: "0050", market: "tw", currency: "TWD", shares: 1000, price: 200, fee: 0, tax: 0 },
      { id: "b2", v: 1, date: "2026-01-06", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 1000, fee: 0, tax: 0 }
    ], at: "x" });
    W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold");
  });
  await p.waitForSelector('#lx .rbcard [data-rb="edit"]', { timeout: 30000 });
  await p.click('#lx .rbcard [data-rb="edit"]'); await p.waitForSelector("#rbForm");
  await p.fill('#rbForm [name="t_0050"]', "40"); await p.fill('#rbForm [name="t_2330"]', "30"); await p.fill('#rbForm [name="t_CASH"]', "30"); await p.fill("#rbForm [name=band]", "2");
  await p.click("#rbForm button[type=submit]");
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 20000 });
  const savedTotal = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:targets:v1") || "{}"));
  assert.equal(savedTotal.basis, "total");

  // 切換到舊庫存（無現金）：total 目標不得在 holdings 基準下給出買賣股數
  await p.evaluate(() => { W.hsrcLegacy = true; W.lgAl = null; renderList(); });
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 30000 });
  const totalToHold = await p.evaluate(() => ({ card: $("#lx .rbcard").innerText, list: $("#lx .rbcard .rblist").innerText }));
  assert.match(totalToHold.card, /總資產（含現金）/);
  assert.match(totalToHold.card, /現金未知，已存的現金目標本次不套用/);
  assert.doesNotMatch(totalToHold.list, /買進|賣出|調整後/);
  assert.equal(await p.evaluate(() => $("#lx .rbcard .pftiles") === null), true, "基準不一致時不顯示買賣試算彙總卡");

  // 在舊庫存重新確認儲存 → basis 改為 "holdings"，之後切回交易帳本（有現金）不得拿全部現金去買
  await p.click('#lx .rbcard [data-rb="edit"]'); await p.waitForSelector("#rbForm");
  assert.match(await p.evaluate(() => $("#rbForm").innerText), /原本的目標基準/);
  await p.fill('#rbForm [name="t_0050"]', "60"); await p.fill('#rbForm [name="t_2330"]', "40");
  await p.click("#rbForm button[type=submit]");
  await p.waitForSelector("#lx .rbcard .pftiles", { timeout: 20000 });
  const savedHold = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:targets:v1") || "{}"));
  assert.equal(savedHold.basis, "holdings");
  assert.equal(savedHold.targets.CASH, 30);

  await p.click('#lx [data-lg="hsrcLedger"]');
  await p.waitForSelector("#lx .rbcard .rblist", { timeout: 30000 });
  const holdToTotal = await p.evaluate(() => ({ card: $("#lx .rbcard").innerText, list: $("#lx .rbcard .rblist").innerText }));
  assert.match(holdToTotal.card, /僅納入持股合計/);
  assert.doesNotMatch(holdToTotal.list, /買進|賣出|調整後/);
  assert.equal(await p.evaluate(() => $("#lx .rbcard .pftiles") === null), true, "切回總資產時同樣攔截 holdings 目標");

  // 全範例＋期貨舊庫存：都應略過並顯示可理解的空狀態，不留殘留
  await p.evaluate(() => {
    const H = { "9958": { sh: 100, cost: 100, demo: true }, TXF: { sh: 1, cost: 20000 } };
    store.set("watch:hold", H); W.hold = H; W.holdOwn = H; W.holdLg = true; W.hsrcLegacy = true; W.lgAl = null; renderList();
  });
  await p.waitForSelector("#lx .alissues", { timeout: 20000 });
  const emptyTxt = await p.evaluate(() => $("#lx").innerText);
  assert.match(emptyTxt, /已略過 1 筆範例持股（不是真實部位）；如不需要請到「持股 → 編輯庫存」移除/);
  assert.match(emptyTxt, /略過 1 筆無法算入的舊庫存：.*TXF（期貨不納入配置與再平衡）/);
  assert.match(emptyTxt, /目前沒有可納入計算的持股/);
  await ctx.close(); assert.deepEqual(errs, []);
});
