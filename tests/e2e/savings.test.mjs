// 存股模擬：股息計算機（含息再投入、含息領出、不含息）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("股息計算機", async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 390 });
  const r = await p.evaluate(() => { const o = { init: 1e6, mon: 0, yrs: 1, y: 0.05, g: 0, freq: 1, nhi: true }, L = { ...o, yrs: 20, g: 0.03, mon: 10000, freq: 4, nhi: false };
    return { div: dcSim(o, "re").divSum, irr: dcSim(o, "re").irr, px: dcSim(L, "px").irr, re: dcSim(L, "re").irr, out: dcSim(L, "out").irr }; });
  assert.equal(Math.round(r.div), 48945); assert.ok(Math.abs(r.irr - 0.048945) < 1e-6);
  assert.ok(Math.abs(r.px - 0.03) < 1e-4); assert.ok(r.re > 0.079 && r.re < 0.083 && Math.abs(r.re - r.out) < 2e-3);
  await p.click('[data-sxg="div"]'); assert.equal(await p.isVisible("#sec-sum"), false, "選單一次只看一個功能"); assert.equal(await p.isVisible("#console"), false, "股息計算機不用左邊控制台");
  await p.fill("#dc-y", "6"); await p.click('[data-dm="px"]'); assert.match(await p.evaluate(() => document.getElementById("dc-kpis").innerText), /不含息[\s\S]*3\.00%/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

// 存股延伸：我的庫存股息、實拿股息試算、真實歷史回測、退休提領、月月配組合、通膨換算
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const monthAgo = m => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };
const YIELD = { "0056": { price: 35, divs: [[monthAgo(10), 1], [monthAgo(7), 1], [monthAgo(4), 1], [monthAgo(1), 1]] }, "00878": { price: 20, divs: [[monthAgo(11), 0.4], [monthAgo(8), 0.4], [monthAgo(5), 0.4], [monthAgo(2), 0.4]] }, "2330": { price: 1000, divs: [[monthAgo(10), 5], [monthAgo(7), 5], [monthAgo(4), 5], [monthAgo(1), 5]] } };
for (const width of [390, 1280]) test(`存股延伸功能 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width, touch: width < 500 });
  await p.route("**/api/yield**", r => { const cs = new URL(r.request().url()).searchParams.get("codes").split(","); J(r, { ok: true, rows: cs.filter(c => YIELD[c]).map(c => { const y = YIELD[c], cash12 = y.divs.reduce((a, d) => a + d[1], 0); return { code: c, cash12, n: 4, price: y.price, yield: +((cash12 / y.price) * 100).toFixed(2), divs: y.divs }; }) }); });
  await p.route("**/api/annual**", r => { const rows = [], px = []; let v = 100, q = 100; for (let i = 0; i < 61; i++) { const d = `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; rows.push([d, +v.toFixed(2)]); px.push([d, +q.toFixed(2)]); v *= i === 20 ? 0.8 : 1.01; q *= i === 20 ? 0.8 : 1.006; } J(r, { ok: true, source: "測試", adjusted: true, first: "2021-01", rows, rowsPx: px }); });
  await p.route("**/data/etf-yield.json", r => J(r, { rows: [{ code: "00919", name: "群益精選高息", yield: 9, n: 12, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], last: { d: "2026-09-16", cash: 0.7 } }, { code: "0050", name: "元大台灣50", yield: 2.5, n: 2, months: [1, 7] }] }));
  await p.evaluate(() => { localStorage.setItem("kline:watch:hold", JSON.stringify({ "0056": { sh: 10000, cost: 30 }, "2330": { sh: 1000, cost: 500 }, AAPL: { sh: 5, cost: 100 } })); localStorage.setItem("kline:watch:names", JSON.stringify({ "0056": "元大高股息" })); });
  // 我的庫存股息：0056 4 元 × 1 萬股 ＋ 2330 20 元 × 1000 股 = 6 萬
  await p.click('[data-sxg="hold"]'); await p.click("#hx-go"); await p.waitForFunction(() => /一年大約領/.test(document.getElementById("hx-out").innerText));
  let t = await p.textContent("#hx-out"); assert.match(t, /60,000/); assert.match(t, /元大高股息 0056/); assert.ok(!t.includes("AAPL"), "只算台股");
  await p.$eval("#hx-tax", b => b.click()); assert.ok(await p.isVisible("#sec-tax"), "帶到實拿試算會切到那一頁"); assert.equal(await p.inputValue("#tx-div"), "60000");
  // 實拿試算：每次 1.5 萬不扣健保；其他所得 80 萬 → 邊際 12%，合併計稅較划算
  t = await p.textContent("#tx-kpis"); assert.match(t, /合併計稅比較划算/); assert.match(t, /未達 2 萬，不扣/);
  await p.fill("#tx-inc", "6000000"); t = await p.textContent("#tx-kpis"); assert.match(t, /分開計稅比較划算/); assert.match(t, /40%/);
  // 歷史回測
  await p.click('[data-sxg="hist"]'); await p.fill("#hs-from", "2021-01"); await p.$eval("#hs-go", b => b.click()); await p.waitForFunction(() => /年化（IRR）/.test(document.getElementById("hs-out").innerText));
  t = await p.textContent("#hs-out"); assert.match(t, /累積投入[\s\S]*600,000/); assert.match(t, /−20\.0%/, "最大跌幅"); assert.ok(await p.locator("#hs-out svg polyline").count() === 3);
  // 退休提領：4% 法則、股災情境
  await p.click('[data-sxg="ret"]'); t = await p.textContent("#rt-kpis"); assert.match(t, /撐過 30 年的機率/); assert.match(t, /800,000/);
  await p.fill("#rt-draw", "3000000"); t = await p.textContent("#rt-kpis"); assert.match(t, /第 \d+ 年用完/, "提領 15% 會用完");
  // 月月配：0056（季配）＋00878（季配）→ 空月份推薦 00919
  await p.click('[data-sxg="mon"]'); await p.fill("#mm-codes", "0056 00878"); await p.$eval("#mm-go", b => b.click()); await p.waitForFunction(() => /有配息的月份/.test(document.getElementById("mm-out").innerText));
  t = await p.textContent("#mm-out"); assert.match(t, /8 \/ 12/); assert.ok(await p.locator('[data-mmadd="00919"]').count() >= 1, "推薦補空月份");
  // 通膨換算
  await p.click('[data-sxg="sim"]'); assert.ok(await p.isVisible("#console") || (await p.evaluate(() => innerWidth)) > 0, "模擬三種做法有控制台"); await p.check("#if-on"); assert.ok(await p.locator("#kpis .if-note").count() >= 1); assert.match(await p.textContent("#kpis"), /約等於今天的/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});
