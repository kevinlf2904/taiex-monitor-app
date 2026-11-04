// 投資組合資料基礎（learner/portfolio.js）：讀對舊版存檔、市場與資產類型、每筆資料狀態、金額計算、台幣美元分開統計、不改動原始資料。固定假資料。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/portfolio.js", import.meta.url), "utf8"), ctx);
const P = ctx.KLPortfolio, J = x => JSON.parse(JSON.stringify(x));
const MASTER = [["2330", "台積電", "上市", "半導體業"], ["6488", "環球晶", "上櫃", "半導體業"], ["0050", "元大台灣50", "上市"]];
const Q = (price, date = "2026-11-04", o = {}) => ({ price, date, time: "13:30:00", source: "證交所", ...o });
const quotes = new Map([["2330", Q(1100)], ["6488", Q(400)], ["0050", Q(200)], ["NVDA", Q(200, "2026-11-03")], ["2317", Q(150, "2026-10-30")]]);
const opts = { master: MASTER, quotes, expectedDate: { tw: "2026-11-04", us: "2026-11-03" } };
const one = (raw, o = opts) => P.normalizeHoldings(raw, o).items[0];

test("讀舊版存檔：讀的是 kline:watch:hold（store 會加 kline: 前綴），只讀不寫", () => {
  const writes = [], store = { "kline:watch:hold": JSON.stringify({ 2330: { sh: 1000, cost: 820 } }), "watch:hold": JSON.stringify({ 9999: { sh: 1, cost: 1 } }) };
  const storage = { getItem: k => store[k] ?? null, setItem: (k) => writes.push(k), removeItem: k => writes.push(k) };
  const r = P.readLegacy(storage);
  assert.equal(r.ok, true); assert.deepEqual(Object.keys(r.raw), ["2330"]); assert.equal(writes.length, 0, "不能寫入或刪除");
  assert.equal(P.LEGACY_KEY, "kline:watch:hold"); assert.equal(P.NEXT_KEY, "kline:pf:v1");
  assert.equal(P.readLegacy({ getItem: () => "{壞掉" }).code, "invalid_json");
  assert.equal(P.readLegacy({ getItem: () => { throw new Error("x"); } }).code, "storage_read_failed");
  assert.deepEqual(J(P.readLegacy({ getItem: () => null }).raw), {});
  assert.equal(P.readLegacy(null).code, "no_storage");
});

test("市場與資產類型：先查股票清單（上市／上櫃），查不到才依代號推測並標示", () => {
  assert.deepEqual(J(P.classify("2330", new Map([["2330", { name: "台積電", exchange: "上市", industry: "半導體業" }]]))), { market: "tw", exchange: "twse", assetType: "stock", name: "台積電", industry: "半導體業", source: "master" });
  const it = one({ 6488: { sh: 100, cost: 300 } }); assert.equal(it.exchange, "tpex"); assert.equal(it.classifiedBy, "master"); assert.equal(it.currency, "TWD");
  assert.equal(one({ "0050": { sh: 1000, cost: 150 } }).assetType, "etf");
  assert.equal(P.classify("TXF", new Map()).assetType, "future", "台指期不能被當成美股");
  const us = P.classify("NVDA", new Map()); assert.equal(us.market, "us"); assert.equal(us.source, "heuristic");
  assert.equal(P.classify("SPY", new Map()).assetType, "etf");
});

test("資料狀態：valid、warning、incomplete、stale、invalid 各自正確", () => {
  const r = P.normalizeHoldings({
    2330: { sh: 1000, cost: 820, d: "2025-03-10" },          // 正常
    NVDA: { sh: 30, cost: 120 },                             // 美股推測市場 → warning
    1234: { sh: 100, cost: 50 },                             // 沒有報價 → incomplete
    2317: { sh: 2000, cost: 160 },                           // 報價日期比應有交易日舊 → stale
    6488: { sh: 100, cost: 300, d: "2025-02-30" },           // 建倉日期不存在 → warning
    "0050": { sh: 3000, cost: 150, demo: true },             // 範例持股 → warning
    2454: { sh: -5, cost: 100 }, 2603: { sh: 100, cost: 0 }, 2881: { sh: "", cost: 10 }, 2882: { sh: NaN, cost: 10 }, "bad code!": { sh: 1, cost: 1 }, 3008: "x"
  }, opts), st = Object.fromEntries(r.items.map(i => [i.symbol, i.status]));
  assert.deepEqual(J(st), { 2330: "valid", NVDA: "warning", 1234: "incomplete", 2317: "stale", 6488: "warning", "0050": "warning", 2454: "invalid", 2603: "invalid", 2881: "invalid", 2882: "invalid", "bad code!": "invalid", 3008: "invalid" });
  assert.deepEqual(J(r.summary.byStatus), { valid: 1, warning: 3, incomplete: 1, stale: 1, invalid: 6 });
  assert.equal(r.status, "partial");
  assert.ok(r.items.find(i => i.symbol === "6488").issues.some(x => x.code === "invalid_opened_at")); assert.equal(r.items.find(i => i.symbol === "6488").openedAt, null);
  assert.equal(P.normalizeHoldings({ X: { sh: 1, cost: 1 } }, { quotes: new Map([["X", Q(1, "2026-11-04", { isStale: true })]]), expectedDate: {} }).items[0].status, "stale", "來源標示過期也算 stale");
});

test("大小寫不同的同一代號：保留第一筆，後面那筆標 invalid", () => {
  const r = P.normalizeHoldings({ nvda: { sh: 1, cost: 1 }, NVDA: { sh: 2, cost: 2 } }, opts);
  assert.deepEqual(J(r.items.map(i => [i.symbol, i.status, i.issues[0]?.code ?? null])), [["NVDA", "warning", "market_inferred"], ["NVDA", "invalid", "duplicate_symbol"]]);
});

test("金額：總成本、市值、未實現損益與報酬率算對；缺價格時是 null 不是 0", () => {
  const it = one({ 2330: { sh: 1000, cost: 820 } });
  assert.equal(it.costBasis, 820000); assert.equal(it.marketValue, 1100000); assert.equal(it.unrealizedPnl, 280000); assert.ok(Math.abs(it.unrealizedPct - 280000 / 820000) < 1e-12);
  assert.equal(it.priceDate, "2026-11-04"); assert.equal(it.priceSource, "證交所");
  const m = one({ 1234: { sh: 100, cost: 50 } }); assert.equal(m.marketValue, null); assert.equal(m.unrealizedPnl, null);
  assert.equal(one({ 2330: { sh: "1000", cost: "820" } }).shares, 1000, "舊資料裡的數字字串可以讀");
});

test("現價和成本差 50 倍以上提醒（股票分割、減資或成本打錯）", () => {
  const it = one({ 2330: { sh: 1, cost: 10 } }); assert.equal(it.status, "warning"); assert.ok(it.issues.some(x => x.code === "price_far_from_cost"));
});

test("統計：台幣和美元分開加總；範例持股和錯誤資料不算", () => {
  const s = P.normalizeHoldings({ 2330: { sh: 1000, cost: 820 }, NVDA: { sh: 30, cost: 120 }, "0050": { sh: 3000, cost: 150, demo: true }, 2454: { sh: -1, cost: 1 } }, opts).summary;
  assert.deepEqual(J(s.byCurrency), { TWD: { positions: 1, costBasis: 820000, marketValue: 1100000, valuedPositions: 1 }, USD: { positions: 1, costBasis: 3600, marketValue: 6000, valuedPositions: 1 } });
  assert.equal(s.demoCount, 1);
});

test("不改動原始資料；空的、錯誤的根節點", () => {
  const raw = { 2330: { sh: 1000, cost: 820, d: "2025-03-10" } }, before = JSON.stringify(raw);
  P.normalizeHoldings(raw, opts); assert.equal(JSON.stringify(raw), before);
  assert.equal(P.normalizeHoldings({}, opts).status, "empty");
  assert.equal(P.normalizeHoldings(null, opts).status, "invalid"); assert.equal(P.normalizeHoldings([], opts).status, "invalid");
});
