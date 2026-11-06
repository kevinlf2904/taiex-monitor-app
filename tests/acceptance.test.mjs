// 投資組合第 11 階段整體驗收：數學交叉驗證（用測試裡另外寫的獨立算法對照）＋邊界／壞資料＋時區＋大量資料。
// 波動率、Beta、VaR、ES 的獨立算法對照在 tests/port-risk.test.mjs；這裡補平均成本、FIFO、已實現／未實現、TWR、XIRR、最大回撤、匯率貢獻、維持率、除息。
// 全部固定假資料，不連外部服務。驗收報告：docs/portfolio/ACCEPTANCE.md
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
for (const f of ["ledger.js", "perf.js", "fx.js", "alloc.js", "margin.js", "overview.js", "pfsrc.js", "portfolio.js"]) vm.runInContext(readFileSync(new URL("../learner/" + f, import.meta.url), "utf8"), ctx);
const { KLLedger: LG, KLPerf: PF, KLFx: FX, KLAlloc: AL, KLMargin: MG, KLOverview: OV, KLPfSrc: SRC, KLPortfolio: PO } = ctx;
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m}：${a} ≠ ${b}（容許 ${t}）`);
// 固定亂數
const rng = (seed = 11) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
// 平日日期
const days = (n, start) => { const a = [], d = new Date(start + "T00:00:00Z"); while (a.length < n) { const w = d.getUTCDay(); if (w && w !== 6) a.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return a; };
const DN = d => Date.parse(d + "T00:00:00Z") / 864e5;
// 任何數字都要是有限值（null 可以）：壞資料不能變成 NaN／Infinity 跑到畫面
function finiteDeep(x, path = "$", seen = new Set()) {
  if (typeof x === "number") { assert.ok(Number.isFinite(x), `${path} 是 ${x}`); return; }
  if (!x || typeof x !== "object" || seen.has(x)) return; seen.add(x);
  if (typeof x.get === "function" && typeof x.entries === "function") { for (const [k, v] of x.entries()) finiteDeep(v, `${path}.${k}`, seen); return; }
  for (const [k, v] of Object.entries(x)) finiteDeep(v, `${path}.${k}`, seen);
}

/* ================= 數學交叉驗證 ================= */
// 隨機買賣 200 筆（不賣超），含手續費與稅
function randomTrades(seed, n = 200) {
  const r = rng(seed), D = days(n, "2024-01-02"), T = []; let held = 0;
  for (let i = 0; i < n; i++) {
    const price = +(50 + r() * 100).toFixed(2), fee = Math.round(r() * 50), sell = held > 0 && r() < 0.4;
    const shares = sell ? Math.max(1, Math.floor(held * r())) : 1 + Math.floor(r() * 500);
    T.push({ id: "t" + i, date: D[i], type: sell ? "sell" : "buy", symbol: "2330", market: "tw", currency: "TWD", shares, price, fee, tax: sell ? Math.round(shares * price * 0.003) : 0 });
    held += sell ? -shares : shares;
  }
  return T;
}
// 獨立算法：加權平均成本／FIFO
function indep(T, method) {
  let sh = 0, cost = 0, real = 0; const lots = [];
  for (const t of T) {
    if (t.type === "buy") { const c = t.shares * t.price + t.fee + t.tax; sh += t.shares; cost += c; lots.push({ n: t.shares, c }); continue; }
    let out = 0;
    if (method === "avg") out = cost * t.shares / sh;
    else { let left = t.shares; while (left > 1e-9) { const L = lots[0], k = Math.min(L.n, left), lc = L.c * k / L.n; out += lc; L.c -= lc; L.n -= k; left -= k; if (L.n < 1e-9) lots.shift(); } }
    real += t.shares * t.price - t.fee - t.tax - out; sh -= t.shares; cost -= out;
  }
  return { sh, cost, real };
}

for (const method of ["avg", "fifo"]) test(`交叉驗證：${method === "avg" ? "加權平均" : "先進先出"}的成本、已實現、未實現（200 筆隨機買賣）`, () => {
  for (const seed of [3, 17, 101]) {
    const T = randomTrades(seed), I = indep(T, method), L = LG.buildLedger(T, { method, prices: { 2330: 123.45 } }), p = L.positions[0];
    assert.equal(L.errorCount, 0);
    near(p.shares, I.sh, 1e-6, "股數"); near(p.costBasis, I.cost, 0.02, "成本"); near(L.totals.TWD.realizedPnl, I.real, 0.5, "已實現");
    if (p.shares > 0) { near(p.avgCost, I.cost / I.sh, 1e-6, "平均成本"); near(p.unrealizedPnl, I.sh * 123.45 - I.cost, 0.05, "未實現"); }
  }
});

// 一檔、兩年平日價格、分批買賣：TWR、XIRR、最大回撤都和獨立算法對照
function scenario() {
  const D = days(520, "2024-01-02"), r = rng(5); let px = 100; const P = D.map(d => { px = Math.max(5, px * (1 + (r() - 0.48) * 0.04)); return { d, c: +px.toFixed(2) }; });
  const at = d => P.find(x => x.d === d).c;
  const T = [{ id: "a", date: D[0], type: "buy", shares: 1000 }, { id: "b", date: D[120], type: "buy", shares: 500 }, { id: "c", date: D[260], type: "sell", shares: 700 }, { id: "d", date: D[400], type: "buy", shares: 300 }]
    .map(t => ({ ...t, symbol: "2330", market: "tw", currency: "TWD", price: at(t.date), fee: 0, tax: 0 }));
  return { D, P, T, at };
}
test("交叉驗證：時間加權報酬（TWR）、資金加權報酬（XIRR）、最大回撤", () => {
  const { D, P, T, at } = scenario(), R = PF.buildPerf(T, { method: "avg", today: D[D.length - 1], prices: { 2330: P } }).byCurrency.TWD;
  // 獨立 TWR：每天市值 V、當天淨投入 F，r = (V − F) / V昨 − 1；第一天 V / F − 1
  let sh = 0, prevV = null, idx = 1, peak = 1, mdd = 0;
  for (const d of D) {
    const f = T.filter(t => t.date === d).reduce((s, t) => s + (t.type === "buy" ? 1 : -1) * t.shares * t.price, 0);
    sh += T.filter(t => t.date === d).reduce((s, t) => s + (t.type === "buy" ? 1 : -1) * t.shares, 0);
    const V = sh * at(d), ret = prevV ? (V - f) / prevV - 1 : f > 0 ? V / f - 1 : 0;
    idx *= 1 + ret; peak = Math.max(peak, idx); mdd = Math.max(mdd, 1 - idx / peak); prevV = V;
  }
  near(R.twr, idx - 1, 1e-9, "TWR");
  near(Math.abs(R.maxDrawdown.dd), mdd, 1e-6, "最大回撤");
  // 獨立 XIRR（年化，二分法）：買進是付出、賣出是拿回、最後一天的市值當成拿回
  const cf = T.map(t => ({ t: DN(t.date), v: (t.type === "buy" ? -1 : 1) * t.shares * t.price })); cf.push({ t: DN(D[D.length - 1]), v: sh * at(D[D.length - 1]) });
  const npv = x => cf.reduce((s, c) => s + c.v / Math.pow(1 + x, (c.t - cf[0].t) / 365), 0);
  let lo = -0.99, hi = 10; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; (npv(lo) * npv(m) <= 0) ? (hi = m) : (lo = m); }
  assert.equal(R.mwr.status === "ok" || R.mwr.status === "estimated", true, "XIRR 有唯一解：" + R.mwr.status);
  near(R.mwr.value, (lo + hi) / 2, 1e-6, "XIRR（年化）");
});

test("交叉驗證：除息當天，股息當成拿回的現金，TWR 不因除息掉價而變成虧損", () => {
  const T = [{ id: "a", date: "2026-03-02", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 100, fee: 0, tax: 0 },
    { id: "b", date: "2026-03-03", type: "dividend", symbol: "2330", market: "tw", currency: "TWD", amount: 500, tax: 0 }];
  const R = PF.buildPerf(T, { method: "avg", today: "2026-03-03", prices: { 2330: [{ d: "2026-03-02", c: 100 }, { d: "2026-03-03", c: 95 }] } }).byCurrency.TWD;
  near(R.twr, 0, 1e-12, "除息：市值 9,500 ＋ 股息 500 ＝ 原本的 10,000");
});

test("交叉驗證：匯率貢獻（美股的台幣損益＝股價部分＋匯率部分，加總等於合併損益）", () => {
  const T = [{ id: "a", date: "2026-03-02", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
  const R = PF.buildPerf(T, { method: "avg", today: "2026-03-03", prices: { NVDA: [{ d: "2026-03-02", c: 100 }, { d: "2026-03-03", c: 110 }] } });
  const F = FX.combine(R, [{ d: "2026-03-02", c: 30 }, { d: "2026-03-03", c: 31 }]);
  // 第 2 天：股價部分 (1100 − 0 − 1000) × 31 ＝ 3,100；匯率部分 1000 × (31 − 30) ＝ 1,000；合計 1100×31 − 1000×30 ＝ 4,100
  assert.equal(F.pnl.usPrice, 3100); assert.equal(F.pnl.usFx, 1000); assert.equal(F.pnl.total, 4100);
  near(F.pnl.usPrice + F.pnl.usFx + F.pnl.twStocks, F.pnl.total, 0.01, "拆解加總＝合併損益");
});

test("交叉驗證：融資維持率＝擔保品市值 ÷ 借款，壓力測試照比例", () => {
  const A = MG.analyze({ id: "m", name: "融資", type: "margin", source: "user", loan: 400000, collateral: [{ symbol: "2330", shares: 1000 }] }, { 2330: { price: 600, date: "2026-11-05" } }, "2026-11-05");
  near(A.ratio, 600000 / 400000, 1e-4, "維持率");
  for (const s of A.stress) if (s.ratio != null) near(s.ratio, (600000 * (1 + s.shock)) / 400000, 1e-4, `跌 ${s.shock}`);
});

/* ================= 邊界與壞資料：不丟錯、不出現 NaN／Infinity、標示錯誤 ================= */
test("壞交易：NaN、Infinity、負價格、零價格、零股數、缺日期、重複編號 → 標成錯誤、不算進持股、數字都是有限值", () => {
  const base = { market: "tw", currency: "TWD", symbol: "2330", fee: 0, tax: 0 };
  const T = [{ ...base, id: "ok", date: "2026-01-02", type: "buy", shares: 10, price: 100 },
    { ...base, id: "n1", date: "2026-01-03", type: "buy", shares: NaN, price: 100 }, { ...base, id: "n2", date: "2026-01-03", type: "buy", shares: 10, price: Infinity },
    { ...base, id: "n3", date: "2026-01-03", type: "buy", shares: 10, price: -5 }, { ...base, id: "n4", date: "2026-01-03", type: "buy", shares: 10, price: 0 },
    { ...base, id: "n5", date: "2026-01-03", type: "buy", shares: 0, price: 10 }, { ...base, id: "n6", date: null, type: "buy", shares: 1, price: 10 },
    { ...base, id: "ok", date: "2026-01-04", type: "buy", shares: 1, price: 10 }, { ...base, id: "n7", date: "2026-01-05", type: "sell", shares: 999, price: 10 }];
  const L = LG.buildLedger(T, { method: "avg", prices: { 2330: NaN } });
  assert.ok(L.errorCount >= 7, "壞交易都標錯誤：" + L.errorCount); assert.equal(L.positions.find(p => p.symbol === "2330").shares, 10, "只有第一筆正常的買進算進去");
  finiteDeep(L.positions); finiteDeep(L.totals); finiteDeep(L.cash);
  assert.equal(LG.validateStore({ v: 1, method: "avg", transactions: T }).ok, false, "存檔前的檢查會擋下");
});

test("壞價格：績效、配置、總覽、融資、資料狀態遇到 NaN／Infinity／0／負價格不會算出 NaN", () => {
  const T = [{ id: "a", date: "2026-01-02", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 10, price: 100, fee: 0, tax: 0 },
    { id: "b", date: "2026-01-02", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 1, price: 100, fee: 0, tax: 0 }];
  const bad = [{ d: "2026-01-02", c: 100 }, { d: "2026-01-05", c: NaN }, { d: "2026-01-06", c: Infinity }, { d: "2026-01-07", c: 0 }, { d: "2026-01-08", c: -3 }, { d: "2026-01-09", c: 101 }];
  const R = PF.buildPerf(T, { method: "avg", today: "2026-01-09", prices: { 2330: bad, NVDA: bad } }); finiteDeep(R);
  finiteDeep(FX.combine(R, [{ d: "2026-01-02", c: NaN }, { d: "2026-01-05", c: Infinity }, { d: "2026-01-06", c: 0 }, { d: "2026-01-09", c: 31 }]));
  const L = LG.buildLedger(T, { method: "avg" });
  const Q = new Map([["2330", { price: NaN, prev: Infinity, date: "2026-01-09" }], ["NVDA", { price: -1, prev: 0, date: "2026-01-09" }]]);
  finiteDeep(OV.summarize(L, Q, { fx: { rate: NaN }, today: "2026-01-09", margin: [] }));
  finiteDeep(AL.build([{ symbol: "2330", currency: "TWD", value: NaN, assetType: "stock" }, { symbol: "NVDA", currency: "USD", value: Infinity, assetType: "stock" }], { fx: { rate: 0 }, cash: { TWD: NaN } }));
  finiteDeep(MG.analyze({ id: "m", type: "margin", source: "user", loan: NaN, collateral: [{ symbol: "2330", shares: Infinity }] }, { 2330: { price: NaN } }, "2026-01-09"));
  finiteDeep(SRC.summarize("quote", SRC.quoteItems({ ok: true, quotes: [{ code: "2330", price: NaN }, { code: "NVDA", price: Infinity, dataDate: "x" }] }, "t"), {}, ["2330", "NVDA"], { today: "2026-01-09" }));
});

test("空的投資組合：各模組都回合理的空結果", () => {
  const L = LG.buildLedger([], { method: "avg" }); assert.equal(L.status, "empty"); assert.equal(L.positions.length, 0);
  finiteDeep(PF.buildPerf([], { method: "avg", today: "2026-01-09", prices: {} }));
  const O = OV.summarize(L, new Map(), { today: "2026-01-09" }); assert.equal(O.total, 0); assert.equal(O.today, null); assert.deepEqual(JSON.parse(JSON.stringify(O.top)), []);
  finiteDeep(AL.build([], {})); finiteDeep(PO.normalizeHoldings({}, {}));
});

/* ================= 時區 ================= */
test("時區：美股行情用紐約日期、台股用台北日期判斷是不是最新", () => {
  // 台北 11-06 早上＝紐約 11-05 晚上：美股最新的收盤是 11-05，不能因為台北已經是 11-06 就說它過期
  const cal = { todayOf: m => (m === "us" ? "2026-11-05" : "2026-11-06"), tradingDay: (m, d) => ![0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()) };
  assert.equal(SRC.freshOf("NVDA", "2026-11-05", cal), "ok"); assert.equal(SRC.freshOf("2330", "2026-11-05", cal), "ok", "台股：昨天收盤、今天還沒開盤");
  assert.equal(SRC.freshOf("NVDA", "2026-11-04", cal), "ok", "美股 11-04 到紐約今天 11-05：中間沒有交易日");
  assert.equal(SRC.freshOf("2330", "2026-11-04", cal), "stale", "台股 11-05 有開盤，11-04 的行情不是最新");
  // 交易日期是字串（YYYY-MM-DD），不經過時區換算：美股 11-05 的交易就是 11-05
  const L = LG.buildLedger([{ id: "u", date: "2026-11-05", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 1, price: 1, fee: 0, tax: 0 }], { method: "avg", today: "2026-11-05" });
  assert.equal(L.errorCount, 0, "當天（美國日期）的交易不算未來交易");
});

/* ================= 大量資料 ================= */
test("大量資料：5,000 筆交易、30 檔、兩年日 K，帳本＋績效在 5 秒內算完", () => {
  const syms = Array.from({ length: 30 }, (_, i) => String(1101 + i)), D = days(500, "2024-01-02"), r = rng(9), T = [], held = {};
  for (let i = 0; i < 5000; i++) { const s = syms[i % 30], d = D[Math.floor(i / 10)], sell = (held[s] || 0) > 10 && r() < 0.3, n = sell ? Math.floor(held[s] / 2) : 10 + Math.floor(r() * 100);
    T.push({ id: "x" + i, date: d, type: sell ? "sell" : "buy", symbol: s, market: "tw", currency: "TWD", shares: n, price: 50 + (i % 50), fee: 1, tax: sell ? 1 : 0 }); held[s] = (held[s] || 0) + (sell ? -n : n); }
  const prices = Object.fromEntries(syms.map((s, k) => [s, D.map((d, i) => ({ d, c: 50 + ((i * 7 + k) % 50) }))]));
  const t0 = Date.now(), L = LG.buildLedger(T, { method: "fifo" }), R = PF.buildPerf(T, { method: "fifo", today: D[D.length - 1], prices }), ms = Date.now() - t0;
  assert.equal(L.errorCount, 0); assert.ok(R.byCurrency.TWD.series.length > 400); assert.ok(ms < 5000, `花了 ${ms} ms`);
});
