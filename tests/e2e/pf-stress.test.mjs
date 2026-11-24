// 配置頁「壓力情境」：預設情境、換情境、產業重挫、自訂、畫面數字和 KLStress.run 一致；按了才用日 K 算 Beta；手機與桌面不溢出。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
// 和頁面同樣的輸入再算一次
const calc = p => p.evaluate(() => {
  const S = JSON.parse(localStorage.getItem("kline:pf:v1")), L = KLLedger.buildLedger(S.transactions, { method: S.method }), X = W.lgAl, fx = X.fx.rate, st = W.lg.st || { k: "tw20" };
  const pre = KLStress.PRESETS.find(q => q.k === st.k), s = st.k === "custom" ? { tw: st.tw, us: st.us, fx: st.fx } : { tw: pre.tw, us: pre.us, fx: pre.fx };
  const pos = L.positions.filter(q => q.open).map(q => ({ symbol: q.symbol, market: q.market, currency: q.currency, value: q.shares * X.px.get(q.symbol).price * (q.currency === "USD" ? fx : 1), beta: W.stB?.beta?.[q.symbol] ?? null }));
  const R = KLStress.run({ positions: pos, cash: { TWD: L.cash.TWD.balance, USD: 0 }, s });
  return { change: R.change, text: $(".stcard").innerText };
});
// 先捲到畫面中間再點（固定在下方的「返回」按鈕會蓋住剛好捲到底邊的元素）
const tap = async (p, sel) => { await p.evaluate(s => document.querySelector(s).scrollIntoView({ block: "center" }), sel); await p.click(sel); };
const fmt = v => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`;

for (const width of [390, 1280]) test(`壓力情境 ${width}：預設、換情境、自訂，數字和計算一致`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "alloc" }; W.lgAl = null; W.stB = null; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector("#lx .stcard [data-pst=tw20]", { timeout: 30000 });
  let r = await calc(p); assert.ok(r.change < 0, "台股大跌：資產變少"); assert.match(r.text, new RegExp(fmt(r.change).replace("+", "\\+")));
  assert.match(r.text, /每檔 Beta 都先用 1/); assert.match(r.text, /估算：Beta＝1/); assert.match(r.text, /美元現金：沒有入金、出金紀錄，未納入/, "有美股但沒有美元現金紀錄：美元現金未知"); assert.match(r.text, /目前持股＋已追蹤現金合計/); assert.doesNotMatch(r.text, /目前總資產/, "部分現金已知時不叫總資產（ChatGPT 審查 #361）"); assert.equal(await p.evaluate(() => W.stB), null, "還沒按：不載入日 K");
  await tap(p, "#lx [data-pst=twdup]"); r = await calc(p);
  assert.equal(r.change, await p.evaluate(() => { const X = W.lgAl; return -Math.round(10 * X.px.get("NVDA").price * X.fx.rate * 0.1 * 100) / 100; }), "台幣升值 10%：只有美股換回台幣變少");
  assert.match(r.text, new RegExp(fmt(r.change)));
  await tap(p, "#lx [data-pst=custom]"); await p.waitForSelector("#stForm");
  await p.fill("#stForm [name=tw]", "-10"); await p.fill("#stForm [name=us]", "5"); await p.fill("#stForm [name=fx]", "0"); await tap(p, "#stForm button[type=submit]");
  await p.waitForFunction(() => W.lg.st?.tw === -0.1); r = await calc(p); assert.match(r.text, new RegExp(fmt(r.change).replace("+", "\\+")));
  assert.match(r.text, /不是預測，也不是投資建議/);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  // 按了才算 Beta：算完（或算不出來）畫面要說明，不會壞掉
  await tap(p, "#lx .stcard [data-pst=beta]");
  await p.waitForFunction(() => W.stB && !W.stB.busy, null, { timeout: 60000 });
  const t = await p.evaluate(() => $(".stcard").innerText);
  assert.match(t, /近 120 個交易日|Beta 這次算不出來/);
  if (await p.evaluate(() => !!W.stB.beta)) { r = await calc(p); assert.match(r.text, new RegExp(fmt(r.change).replace("+", "\\+"))); }
  await ctx.close(); assert.deepEqual(errs, []);
});

test("壓力情境（#300 第 2 組）：只有舊庫存也能用、標示現金未納入與用成本估的持股、按了用日 K 算 Beta", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/quote**", r => { const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(c => c && c !== "2454");
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", today: "2026-10-05", quotes: codes.map(c => ({ code: c, name: "股" + c, price: 100, prev: 99, date: "2026-10-05", time: "10:30:05" })) }) }); });
  await p.evaluate(() => { localStorage.removeItem("kline:pf:v1"); const H = { 2330: { sh: 1000, cost: 90 }, 2454: { sh: 500, cost: 100 } };
    store.set("watch:hold", H); W.hold = H; W.holdOwn = H; W.lg = { view: "alloc" }; W.lgAl = null; W.stB = null; W.holdView = "tx"; setLt("hold"); });
  await p.waitForSelector("#lx .stcard [data-pst=tw20]", { timeout: 30000 });
  const t = await p.evaluate(() => $(".stcard").innerText);
  assert.match(t, /估算：Beta＝1/); assert.match(t, /舊庫存沒有現金資料，未納入/); assert.match(t, /用成本估市值：.*2454/); assert.match(t, /目前持股合計/);
  assert.doesNotMatch(t, /目前總資產/, "現金未知時不叫總資產");
  // 情境數字：2330 市值 100,000、2454 用成本 50,000，Beta 都是 1，台股跌 20% → −30,000
  assert.match(t, /-30,000/);
  await p.evaluate(() => document.querySelector("#lx .stcard [data-pst=beta]").scrollIntoView({ block: "center" })); await p.click("#lx .stcard [data-pst=beta]");
  assert.ok(await p.evaluate(() => !!W.stB), "只有舊庫存：按了也會開始算 Beta");
  await p.waitForFunction(() => W.stB && !W.stB.busy, null, { timeout: 60000 });
  assert.match(await p.evaluate(() => $(".stcard").innerText), /近 120 個交易日|Beta 這次算不出來/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 391), "沒有水平溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("壓力情境（ChatGPT 審查 #361）：現金逐幣別判斷；Beta 一檔都沒算出來仍標估算；一邊大盤拿不到，另一邊照用", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  // 台幣、美元都有入出金紀錄 → 才叫總資產
  const TX2 = [...TX, { id: "u", v: 1, date: "2026-01-02", type: "deposit", market: "us", currency: "USD", amount: 2000 }];
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "alloc" }; W.lgAl = null; W.stB = null; W.holdView = "tx"; setLt("hold"); }, TX2);
  await p.waitForSelector("#lx .stcard [data-pst=tw20]", { timeout: 30000 });
  let t = await p.evaluate(() => $(".stcard").innerText);
  assert.match(t, /目前總資產/); assert.doesNotMatch(t, /現金：/, "兩種現金都有紀錄：不列未納入");
  // 跑過但一檔都沒算出來：仍是「估算」，並說明
  await p.evaluate(() => { W.stB = { key: W.stOpen.map(q => q.symbol).sort().join(","), beta: {}, fails: [], at: Date.now() }; renderList(); });
  await p.waitForFunction(() => /一檔都算不出來/.test($(".stcard").innerText));
  t = await p.evaluate(() => $(".stcard h4").innerText); assert.match(t, /估算：Beta＝1/); assert.doesNotMatch(t, /部分估算/);
  // 只算出一檔：部分估算
  await p.evaluate(() => { W.stB = { key: W.stOpen.map(q => q.symbol).sort().join(","), beta: { NVDA: 1.5 }, fails: [], at: Date.now() }; renderList(); });
  await p.waitForFunction(() => /部分估算：Beta＝1/.test($(".stcard h4").innerText));
  // 加權指數拿不到、美股照算：不整個失敗，美股的 Beta 照用、說明台股那邊用 1
  await p.evaluate(() => { W.stB = null; const days = Array.from({ length: 150 }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10), c: 100 + Math.sin(i / 3) * 5 + i * 0.1 }));
    const mk = k => ({ D: days.map((x, i) => ({ d: x.d, o: x.c, h: x.c, l: x.c, c: x.c * (1 + k * Math.sin(i / 2) * 0.01), v: 1 })) });
    window.dailyFresh = async () => null; window.dailyAdj = async c => mk(c === "SPY" ? 1 : 2); renderList(); });
  await p.waitForSelector("#lx .stcard [data-pst=beta]"); await p.evaluate(() => document.querySelector("#lx .stcard [data-pst=beta]").click());
  await p.waitForFunction(() => W.stB && !W.stB.busy, null, { timeout: 30000 });
  const st = await p.evaluate(() => ({ err: W.stB.err || null, beta: W.stB.beta, fails: W.stB.fails, t: $(".stcard").innerText }));
  assert.equal(st.err, null, "一邊失敗不算整個失敗"); assert.equal(typeof st.beta.NVDA, "number"); assert.equal(st.beta["2330"], undefined);
  assert.match(st.t, /加權指數日 K 拿不到，那邊的持股先用 1/); assert.match(st.t, /部分估算：Beta＝1/);
  await ctx.close(); assert.deepEqual(errs, []);
});
