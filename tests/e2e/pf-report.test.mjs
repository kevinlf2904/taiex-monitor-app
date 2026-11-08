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
  const vis = await p.evaluate(() => [getComputedStyle(document.querySelector("#lx .rpt")).visibility, getComputedStyle(document.querySelector("#lx .lgview")).visibility, getComputedStyle(document.querySelector("[data-rpt=print]")).visibility]);
  assert.deepEqual(vis, ["visible", "hidden", "hidden"], "列印時：報告看得到，分頁按鈕與列印按鈕不印");
  await p.emulateMedia({ media: "screen" });
  await p.evaluate(() => document.querySelector('#lx .rptbar [data-v=home]').click()); await p.waitForSelector("#lx .hmcard", { timeout: 30000 });
  await ctx.close(); assert.deepEqual(errs, []);
});
