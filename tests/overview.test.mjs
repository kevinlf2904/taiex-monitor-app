// 投資組合總覽（learner/overview.js）：總資產換台幣、今日損益（昨收持有＋今天買進＋今天賣出）、舊報價不算今日、累積損益、現金比例、市場分布、風險警示、沒有匯率不相加。期望值手算；固定假資料。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
for (const f of ["ledger.js", "overview.js"]) vm.runInContext(readFileSync(new URL("../learner/" + f, import.meta.url), "utf8"), ctx);
const { KLLedger: LG, KLOverview: O } = ctx, J = x => JSON.parse(JSON.stringify(x)), near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
let n = 0; const tw = o => ({ id: "t" + ++n, market: "tw", currency: "TWD", symbol: "2330", fee: 0, tax: 0, ...o }), us = o => ({ id: "u" + ++n, market: "us", currency: "USD", symbol: "NVDA", fee: 0, tax: 0, ...o });
const run = (txs, quotes, o = {}) => O.summarize(LG.buildLedger(txs), new Map(Object.entries(quotes)), { today: "2026-11-05", ...o });

test("總資產換台幣、現金比例、市場分布；累積損益＝已實現＋未實現＋股息", () => {
  const T = [tw({ symbol: null, date: "2026-01-02", type: "deposit", amount: 300000 }), tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 100 }), us({ date: "2026-01-05", type: "buy", shares: 10, price: 100 }),
    tw({ date: "2026-03-01", type: "dividend", amount: 2000 }), tw({ symbol: "2317", date: "2026-02-01", type: "buy", shares: 100, price: 50 }), tw({ symbol: "2317", date: "2026-04-01", type: "sell", shares: 100, price: 60 })];
  const R = run(T, { 2330: { price: 120, prev: 118, date: "2026-11-05", time: "13:30:00" }, NVDA: { price: 150, prev: 140, date: "2026-11-05", time: "09:30:00" } }, { fx: { rate: 32, date: "2026-11-05" } });
  // 股票 120,000 ＋ 150×10×32＝48,000；現金 300,000 −100,000 −5,000 +6,000 +2,000 ＝ 203,000（台幣，美元帳沒有入金不算現金）
  assert.equal(R.stocks, 168000); assert.equal(R.cash, 203000); assert.equal(R.total, 371000); assert.ok(near(R.cashShare, 203000 / 371000, 1e-4));
  assert.deepEqual(J(R.marketShare.map(x => x.group)), ["cash", "tw", "us"]);
  assert.equal(R.cumulative.byCurrency.TWD, 1000 + 20000 + 2000, "已實現 1,000＋未實現 20,000＋股息 2,000"); assert.equal(R.cumulative.byCurrency.USD, 500); assert.equal(R.cumulative.base, 23000 + 500 * 32); assert.equal(R.cumulative.atCurrentFx, true);
  assert.equal(R.updated.quotesFrom, "2026-11-05 09:30:00"); assert.equal(R.updated.fx.rate, 32);
});

test("今日損益：昨收就持有的用昨收、今天買進的從買進價、今天賣出的從昨收到賣出價；舊報價不算", () => {
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 100 }), tw({ date: "2026-11-05", type: "buy", shares: 500, price: 121 }), tw({ date: "2026-11-05", type: "sell", shares: 200, price: 119 }),
    tw({ symbol: "2317", date: "2026-01-05", type: "buy", shares: 100, price: 50 })];
  const R = run(T, { 2330: { price: 120, prev: 118, date: "2026-11-05" }, 2317: { price: 55, prev: 50, date: "2026-11-04" } });
  // 2330：昨收持有 1000 股 → 1000×(120−118)＝2,000；今天買 500@121 → 500×(120−121)＝−500；今天賣 200@119 → 200×(119−118)＝200；合計 1,700
  assert.equal(R.today.pnl, 1700); assert.equal(R.today.counted, 1); assert.equal(R.today.of, 2); assert.ok(near(R.today.pct, 1700 / (1000 * 118)));
  assert.ok(R.issues.some(x => x.k === "stale_quote" && x.codes.join() === "2317"), "2317 的報價是昨天的，不算進今日損益");
  // 今天全部賣光：已經不在持股裡，也要算
  const S = run([tw({ date: "2026-01-05", type: "buy", shares: 100, price: 100 }), tw({ date: "2026-11-05", type: "sell", shares: 100, price: 105 })], { 2330: { price: 106, prev: 100, date: "2026-11-05" } });
  assert.equal(S.today.pnl, 500, "今天全部賣光：100×(105−100)"); assert.equal(S.positions, 0);
});

test("沒有匯率：美股不換算、不相加，標示；有報價缺漏用成本並提醒", () => {
  const R = run([tw({ date: "2026-01-05", type: "buy", shares: 10, price: 100 }), us({ date: "2026-01-05", type: "buy", shares: 1, price: 100 }), tw({ symbol: "9999", date: "2026-01-05", type: "buy", shares: 1, price: 10 })], { 2330: { price: 100, prev: 100, date: "2026-11-05" } });
  assert.equal(R.stocks, 1010, "美股沒算進台幣總額"); assert.equal(R.usdNotConverted, 100); assert.ok(R.issues.some(x => x.k === "no_fx")); assert.equal(R.cumulative.base, null); assert.ok(R.issues.some(x => x.k === "cum_no_fx"));
  assert.ok(R.alerts.some(x => x.k === "no_price" && x.codes.includes("9999") && x.codes.includes("NVDA")));
});

test("風險警示：單一持股 > 30%、前五大 > 80%、融資接近或低於追繳線", () => {
  const T = ["2330", "2317", "2454", "2303", "2882", "2603"].map((s, i) => tw({ symbol: s, date: "2026-01-05", type: "buy", shares: 1, price: [600, 100, 100, 100, 50, 50][i] }));
  const q = Object.fromEntries(["2330", "2317", "2454", "2303", "2882", "2603"].map((s, i) => [s, { price: [600, 100, 100, 100, 50, 50][i], prev: 1, date: "2026-11-05" }]));
  const R = run(T, q, { margin: [{ name: "融資", state: "near", ratio: 1.35 }, { name: "質押", state: "ok", ratio: 2 }] });
  assert.deepEqual(J(R.alerts.map(a => a.k)), ["single_concentration", "top5_concentration", "margin"]); assert.equal(R.alerts[0].symbol, "2330"); assert.equal(R.alerts[0].level, "high", "600/1000＝60% > 50%");
  assert.ok(O.ALERT_LABEL.margin && O.ISSUE_LABEL.no_fx);
});

test("累積損益扣掉另計費用（例如股息匯費）", () => {
  const R = run([tw({ id: "b", date: "2026-01-05", type: "buy", shares: 10, price: 100 }), tw({ id: "d", date: "2026-02-05", type: "dividend", amount: 100 }), tw({ id: "f", symbol: null, date: "2026-02-05", type: "fee", amount: 10, ref: "d" })], { 2330: { price: 100, prev: 100, date: "2026-11-05" } });
  assert.equal(R.cumulative.byCurrency.TWD, 90);
});

test("今日損益只用今天的行情：沒有日期的報價不算；今天賣光的，報價不是今天的也不算", () => {
  const R = run([tw({ date: "2026-01-05", type: "buy", shares: 100, price: 100 })], { 2330: { price: 110, prev: 100 } });
  assert.equal(R.today, null, "報價沒有日期，不能當成今天的行情"); assert.ok(R.issues.some(x => x.k === "stale_quote" && x.codes.includes("2330")));
  const S = run([tw({ date: "2026-01-05", type: "buy", shares: 100, price: 100 }), tw({ date: "2026-11-05", type: "sell", shares: 100, price: 105 })], { 2330: { price: 99, prev: 90, date: "2026-11-04" } });
  assert.equal(S.today, null, "今天賣光但報價是昨天的：昨收是前天的，不能拿來算"); assert.ok(S.issues.some(x => x.k === "stale_quote" && x.codes.includes("2330")));
  const D = run([tw({ date: "2026-01-05", type: "buy", shares: 100, price: 100 })], { 2330: { price: 110, prev: 100, dataDate: "2026-11-05" } });
  assert.equal(D.today.pnl, 1000, "dataDate 也算行情日期");
});

test("今日損益只用帳本實際套用的交易：賣超（帳本判定錯誤）不算", () => {
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 100, price: 100 }), tw({ date: "2026-11-05", type: "sell", shares: 500, price: 130 })];
  const L = LG.buildLedger(T); assert.ok(L.txs.some(x => x.tx.date === "2026-11-05" && (!x.applied || x.errors.length)), "前提：帳本不套用賣超");
  const R = run(T, { 2330: { price: 120, prev: 118, date: "2026-11-05" } });
  assert.equal(R.today.pnl, 200, "只算昨收持有的 100×(120−118)，不把錯誤的賣出算進來");
});

test("負現金（買進多於入金）要從總資產扣掉並標示；占比不超過 100%", () => {
  const R = run([tw({ symbol: null, date: "2026-01-02", type: "deposit", amount: 50000 }), tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 100 })], { 2330: { price: 100, prev: 100, date: "2026-11-05" } });
  assert.equal(R.stocks, 100000); assert.equal(R.cash, -50000); assert.equal(R.total, 50000, "淨資產＝股票 100,000 − 50,000");
  assert.equal(R.cashShare, 0); assert.equal(R.top[0].w, 1, "占比用正的資產當分母"); assert.ok(R.issues.some(x => x.k === "cash_negative")); assert.ok(O.ISSUE_LABEL.cash_negative);
});
