// 交易紀錄 →「配置」：總資產、前十大、市場／類型／幣別／產業、ETF 穿透後的實際持股、重複持有、成分股資料日期；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "a", v: 1, date: "2025-06-02", type: "buy", symbol: "0050", market: "tw", currency: "TWD", shares: 1000, price: 100, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2025-06-02", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 100, fee: 0, tax: 0 },
  { id: "c", v: 1, date: "2025-06-02", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];

test("配置：分布、ETF 穿透、重複持有、資料日期", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "TWD=X", data: [{ d: "2026-11-04", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
    await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold"); }, TX);
    await p.waitForSelector(".alcard", { timeout: 30000 });
    const t = await p.evaluate(() => $("#lx").innerText);
    for (const k of ["全部資產（台幣計價）", "最大單一持股", "有效檔數", "前十大持股", "市場", "類型", "幣別", "產業前五大", "ETF 穿透後的實際持股", "成分股資料日期", "計算口徑"]) assert.match(t, new RegExp(k), width + "：" + k);
    assert.match(t, /美元兌台幣 32\.000/); assert.match(t, /重複持有（直接買了，ETF 裡也有）：[^\n]*2330|重複持有（直接買了，ETF 裡也有）：[^\n]*台積電/);
    assert.match(t, /0050 2026-10-16（揭露 65\.6%）/, "成分股日期與揭露比例");
    // 權重加總：市場分布三格加起來 100%
    const m = await p.evaluate(() => [...document.querySelectorAll(".alcard .algrid > div:first-child .albars b")].map(b => parseFloat(b.textContent)));
    assert.ok(Math.abs(m.reduce((s, x) => s + x, 0) - 100) < 0.3, JSON.stringify(m));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("配置：ETF 沒有成分股資料時，卡片標「含估算」、警告寫出哪一檔、表格標未穿透", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/etf?code=00878**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "00878", info: {}, hold: { date: null, rows: [] } }) }));
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "alloc" }; W.lgAl = null; W.holdView = "tx"; setLt("hold"); },
    [{ id: "a", v: 1, date: "2025-06-02", type: "buy", symbol: "00878", market: "tw", currency: "TWD", shares: 1000, price: 20, fee: 0, tax: 0 }, { id: "b", v: 1, date: "2025-06-02", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 10, price: 100, fee: 0, tax: 0 }]);
  await p.waitForSelector(".alcard", { timeout: 30000 });
  const t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /含估算/); assert.match(t, /有 ETF 拿不到成分股資料，沒有穿透：[^\n]*00878/); assert.match(t, /00878（ETF，沒有成分股資料，未穿透）/);
  await ctx.close(); assert.deepEqual(errs, []);
});
