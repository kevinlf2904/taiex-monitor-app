// 投資組合「股利」分頁：未來 12 個月每月股利（已公告＋預估）、畫面數字和 KLDivCal.plan 一致、只送代號查公開資料、資料拿不到標示並重抓；
// 手機與桌面不溢出。全部固定假資料（配息紀錄、除權息公告都用 mock）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 2000, price: 900, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-05", type: "buy", symbol: "0056", market: "tw", currency: "TWD", shares: 10000, price: 35, fee: 0, tax: 0 },
  { id: "c", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const day = n => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10); // 台北日期往後 n 天
async function page(width, { yieldFail = false } = {}) {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  const Y = { 2330: [[day(-300), 5], [day(-200), 5], [day(-100), 5], [day(-400), 4]], "0056": [[day(-330), 1], [day(-150), 0.8]] };
  const ok = r => { const cs = (new URL(r.request().url()).searchParams.get("codes") || "").split(","); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: cs.filter(c => Y[c]).map(c => ({ code: c, cash12: 1, divs: Y[c] })) }) }); };
  const bad = r => r.fulfill({ status: 500, body: "x" });
  await ctx.route("**/api/yield**", yieldFail ? bad : ok);
  await ctx.route("**/api/calendar**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: [{ date: day(20), code: "2330", name: "台積電", kind: "除息", cash: 6 }, { date: day(10), code: "9999", kind: "除息", cash: 9 }], conf: [], hol: [] }) }));
  await p.evaluate(tx => { W.cal = null; W.dvD = null; store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "div" }; W.holdView = "tx"; setLt("hold"); }, TX);
  return { ctx, p, errs, ok, bad };
}

for (const width of [390, 1280]) test(`股利分頁 ${width}：每月合計、已公告取代同一次的預估、和計算一致、不溢出`, async () => {
  const { ctx, p, errs } = await page(width);
  await p.waitForSelector("#lx .dvbars", { timeout: 30000 });
  const r = await p.evaluate(() => {
    const S = JSON.parse(localStorage.getItem("kline:pf:v1")), L = KLLedger.buildLedger(S.transactions, { method: S.method }), open = L.positions.filter(q => q.open);
    const P = KLDivCal.plan({ positions: open.map(q => ({ symbol: q.symbol, market: q.market, shares: q.shares })), hist: W.dvD.hist, upcoming: W.dvD.cal, today: lgToday() });
    return { P: P.events.map(e => [e.code, e.kind, e.amount]), total: P.total, text: $("#lx").innerText, rows: document.querySelectorAll("#lx .dvev li").length, months: document.querySelectorAll("#lx .dvbars li").length };
  });
  // 2330：-300、-200、-100 天的三次往後推一年＝+65、+165、+265 天；+20 天公告 6 元，和 +65 天相差 45 天（同一次）→ 用公告的；-400 天超過 12 個月不算
  assert.deepEqual(r.P, [["2330", "announced", 12000], ["0056", "est", 10000], ["2330", "est", 10000], ["0056", "est", 8000], ["2330", "est", 10000]]);
  assert.equal(r.total, 50000); assert.equal(r.rows, 5); assert.equal(r.months, 12);
  assert.match(r.text, /未來 12 個月\s*\$?50,000/); assert.match(r.text, /已公告/); assert.match(r.text, /美股不估：.*NVDA|美股不估：.*輝達/);
  assert.doesNotMatch(r.text, /9999/, "只列持股");
  assert.match(r.text, /不是投資建議/);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("配息紀錄拿不到：標「拿不到」不說成沒有配息；1 分鐘後重抓成功", async () => {
  const { ctx, p, errs, ok, bad } = await page(390, { yieldFail: true });
  await p.waitForFunction(() => /配息紀錄這次拿不到/.test($("#lx").innerText), null, { timeout: 30000 });
  assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /沒有找到配息/);
  await ctx.unroute("**/api/yield**", bad); await ctx.route("**/api/yield**", ok);
  await p.evaluate(() => { W.fresh = Date.now() + 36e5; W.dvD.at = Date.now() - 61e3; renderList(); });
  await p.waitForSelector("#lx .dvbars", { timeout: 30000 });
  await ctx.close(); assert.deepEqual(errs, []);
});
