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
  assert.match(r.text, /每檔 Beta 都先用 1/); assert.equal(await p.evaluate(() => W.stB), null, "還沒按：不載入日 K");
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
