// 投資組合報告：從總覽打開、持股明細和 KLReport.build 一致、論點摘要、列印按鈕、列印時只印報告；手機與桌面不溢出。全部固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const TH = { v: 1, items: { 2330: { reason: "先進製程領先", status: "weak", review: "2026-01-01", watch: ["毛利率"] } } };

for (const width of [390, 1280]) test(`報告 ${width}：從總覽打開、明細和計算一致、論點摘要、列印`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  await p.evaluate(([tx, th]) => { localStorage.setItem("kline:pf:thesis:v1", JSON.stringify(th)); store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "home" }; W.lgAl = null; W.holdView = "tx"; setLt("hold"); }, [TX, TH]);
  await p.waitForSelector('#lx [data-lg=view][data-v=report]', { timeout: 30000 });
  await p.evaluate(() => document.querySelector('#lx [data-v=report]').scrollIntoView({ block: "center" })); await p.click('#lx [data-lg=view][data-v=report]');
  await p.waitForSelector("#lx .rpt .rpttbl", { timeout: 30000 });
  const r = await p.evaluate(() => {
    const S = JSON.parse(localStorage.getItem("kline:pf:v1")), L = KLLedger.buildLedger(S.transactions, { method: S.method, today: lgToday() }), X = W.lgAl;
    const R = KLReport.build({ positions: L.positions.filter(q => q.open), px: X.px, fx: X.fx.rate, cash: L.cash.TWD.balance, thesis: JSON.parse(localStorage.getItem("kline:pf:thesis:v1")), today: lgToday() });
    return { rows: R.rows.map(x => [x.symbol, Math.round(x.valueBase).toLocaleString(), (x.w * 100).toFixed(1) + "%"]), tbl: [...document.querySelectorAll("#lx .rpttbl tbody tr")].map(tr => [...tr.cells].map(c => c.innerText)), text: $("#lx .rpt").innerText };
  });
  assert.equal(r.tbl.length, 2);
  for (const [c, v, w] of r.rows) { const tr = r.tbl.find(t => t[0].includes(c)); assert.ok(tr, c); assert.ok(tr[4].includes(v), `${c} 市值 ${v}：${tr[4]}`); assert.equal(tr[5], w); }
  assert.match(r.tbl.find(t => t[0].includes("2330"))[7], /論點動搖・該檢視/); assert.match(r.tbl.find(t => t[0].includes("NVDA"))[7], /沒寫/);
  assert.match(r.text, /寫了 1\/2 檔，1 檔該檢視/); assert.match(r.text, /先進製程領先/); assert.match(r.text, /不是投資建議/);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  // 列印按鈕呼叫 window.print；列印時只看得到報告
  const printed = await p.evaluate(() => { let n = 0; const o = window.print; window.print = () => { n++; }; document.querySelector("[data-rpt=print]").click(); window.print = o; return n; });
  assert.equal(printed, 1);
  await p.emulateMedia({ media: "print" });
  const vis = await p.evaluate(() => [getComputedStyle(document.querySelector("#lx .rpt")).visibility, getComputedStyle(document.querySelector("#hvSeg")).visibility, getComputedStyle(document.querySelector("[data-rpt=print]")).visibility]);
  assert.deepEqual(vis, ["visible", "hidden", "hidden"], "列印時：報告看得到，分頁按鈕與列印按鈕不印");
  await p.emulateMedia({ media: "screen" });
  await p.evaluate(() => document.querySelector('#lx .rptbar [data-v=home]').click()); await p.waitForSelector("#lx .hmcard", { timeout: 30000 });
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`報告 ${width}：年度報稅彙整（預設前一年、切年份、二代健保提醒、CSV）`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  await p.clock.setFixedTime(new Date("2026-11-25T10:00:00+08:00"));
  const tx = [...TX, { id: "x1", v: 1, date: "2025-03-01", type: "buy", symbol: "0056", market: "tw", currency: "TWD", shares: 10000, price: 30, fee: 0, tax: 0 },
    { id: "x2", v: 1, date: "2025-07-10", type: "dividend", symbol: "0056", market: "tw", currency: "TWD", amount: 25000, fee: 0, tax: 0 },
    { id: "x3", v: 1, date: "2025-09-01", type: "sell", symbol: "0056", market: "tw", currency: "TWD", shares: 5000, price: 36, fee: 100, tax: 180 },
    { id: "x4", v: 1, date: "2026-03-01", type: "dividend", symbol: "NVDA", market: "us", currency: "USD", amount: 10, fee: 0, tax: 3 }];
  await p.evaluate(t => { store.set("pf:v1", { v: 1, method: "avg", transactions: t, at: "x" }); W.lg = { view: "report" }; W.lgAl = null; W.rptTaxY = null; W.holdView = "tx"; setLt("hold"); }, tx);
  await p.waitForSelector("#lx .rpt .rpttx-tbl", { timeout: 30000 });
  let t = await p.textContent("#lx .rpt");
  assert.match(t, /年度報稅彙整/); assert.match(t, /現金股利（總額）\s*25,000/); assert.match(t, /0056[\s\S]*可能被扣 2\.11%，約 528/);
  // 賣 5000 股：180,000 − 100 − 180 − 150,000 ＝ 29,720
  assert.match(t, /已實現損益\s*\+29,720/);
  assert.equal(await p.getAttribute('#lx [data-rpttx="2025"]', "aria-pressed"), "true", "預設前一年");
  const dl = p.waitForEvent("download"); await p.click("#lx [data-rpttx-csv]"); const d = await dl;
  assert.equal(d.suggestedFilename(), "tax-summary-2025.csv");
  await p.click('#lx [data-rpttx="2026"]'); await p.waitForFunction(() => document.querySelector('#lx [data-rpttx="2026"]')?.getAttribute("aria-pressed") === "true");
  t = await p.textContent("#lx .rpt"); assert.match(t, /股息（總額）\s*US\$10[\s\S]*預扣 US\$3/); assert.ok(!/可能被扣 2\.11%/.test(t));
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  await p.emulateMedia({ media: "print" }); assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#lx .rpttx-bar")).display), "none", "列印時不印年度按鈕");
  await ctx.close(); assert.deepEqual(errs, []);
});
