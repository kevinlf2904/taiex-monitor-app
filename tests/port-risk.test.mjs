// 投資組合風險 v2（learner/quant.js 的 portRisk）：接手 GPT PR #219／#220 後，兩輪審查發現的問題逐項用固定假資料檢查。
// 公式和獨立算法對照；缺日、短歷史、壞價格、重複日期、基準缺日、極端單日、VaR 樣本、市值覆蓋率、盤中最後一天。不連外部服務。
import test from "node:test";
import assert from "node:assert/strict";
import { engine } from "../scripts/_engine.mjs";

const { portRisk } = engine().Q;
const J = x => JSON.parse(JSON.stringify(x)); // 沙盒（vm）裡建的陣列原型不同，比較前先轉成一般資料
const days = (n, start = "2025-06-02") => { const a = []; const d = new Date(start + "T00:00:00Z"); while (a.length < n) { const w = d.getUTCDay(); if (w && w !== 6) a.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return a; };
// 固定亂數：基準 r_m，三檔 r = β·r_m + ε
function world(N = 200, seed = 7) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, nrm = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const D = days(N), betas = [1.3, 0.7, 1.0], px = [50, 80, 120], H = [[], [], []], BM = []; let pm = 100;
  for (let i = 0; i < N; i++) { const rm = i ? 0.012 * nrm() : 0; pm *= 1 + rm; BM.push({ d: D[i], c: pm }); for (let k = 0; k < 3; k++) { const r = i ? betas[k] * rm + 0.01 * nrm() : 0; px[k] *= 1 + r; H[k].push({ d: D[i], c: px[k] }); } }
  return { D, BM, H };
}
const MV = [500000, 300000, 200000];
const base = W => [0, 1, 2].map(k => ({ c: ["2330", "2317", "2454"][k], mv: MV[k], D: W.H[k].map(x => ({ ...x })) }));
const counts = (P, items) => P.codes.length + P.excluded.length === items.length;
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const cv = (a, b) => { const ma = avg(a), mb = avg(b); let z = 0; for (let i = 0; i < a.length; i++) z += (a[i] - ma) * (b[i] - mb); return z / (a.length - 1); };
const near = (x, y, t = 1e-10) => Math.abs(x - y) < t;

test("公式：波動率、Beta、相關、風險貢獻、VaR（內插）、ES、最差 20 日、跌 20% 都和獨立算法一致", () => {
  const W = world(), items = base(W), P = portRisk(items, W.BM, 120);
  assert.equal(P.status, "ready"); assert.equal(P.n, 120); assert.ok(counts(P, items));
  const ds = W.D.slice(-121), ret = a => ds.slice(1).map((d, i) => a.find(x => x.d === d).c / a.find(x => x.d === ds[i]).c - 1);
  const rb = ret(W.BM), ra = W.H.map(ret), tot = 1e6, w = MV.map(v => v / tot), rp = rb.map((_, t) => w.reduce((s, wk, k) => s + wk * ra[k][t], 0));
  assert.ok(near(P.vol, Math.sqrt(cv(rp, rp) * 252))); assert.ok(near(P.beta, cv(rp, rb) / cv(rb, rb)));
  ["2330", "2317", "2454"].forEach((c, k) => { const r = P.rows.find(x => x.c === c); assert.ok(near(r.beta, cv(ra[k], rb) / cv(rb, rb)), c + " Beta"); assert.ok(near(r.ctr, w[k] * cv(ra[k], rp) / cv(rp, rp)), c + " 風險貢獻"); });
  assert.ok(near(P.rows.reduce((s, r) => s + r.ctr, 0), 1));
  const i = P.codes.indexOf("2330"), j = P.codes.indexOf("2317"); assert.ok(near(P.C[i][j], cv(ra[0], ra[1]) / Math.sqrt(cv(ra[0], ra[0]) * cv(ra[1], ra[1]))));
  const so = [...rp].sort((a, b) => a - b), q = 119 * 0.05, lo = Math.floor(q), v95 = so[lo] + (so[lo + 1] - so[lo]) * (q - lo);
  assert.ok(near(P.var95, v95)); assert.ok(near(P.es95, avg(so.slice(0, 6))), "ES＝最差 6 筆平均（120 × 5%）");
  assert.ok(near(P.stress, P.beta * -0.2));
  let wb = null; for (let t = 0; t + 20 <= rb.length; t++) { const v = rb.slice(t, t + 20).reduce((p, x) => p * (1 + x), 1) - 1; if (!wb || v < wb.v) wb = { v, from: ds[t], to: ds[t + 20] }; }
  assert.deepEqual(J([P.worst.from, P.worst.to]), [wb.from, wb.to]); assert.ok(near(P.worst.b, wb.v));
  assert.equal(P.cov.ratio, 1);
});

test("短歷史新股不會縮短整個組合的期間：不納入並標示（原 P1）", () => {
  for (const len of [40, 110]) {
    const W = world(), items = [...base(W), { c: "6919", mv: 1000, D: W.H[0].slice(-len).map(x => ({ ...x })) }], P = portRisk(items, W.BM, 120);
    assert.equal(P.n, 120, len + " 天新股：期間仍是 120"); assert.equal(P.status, "partial");
    assert.deepEqual(J(P.excluded.map(e => [e.c, e.why])), [["6919", "short_history"]]); assert.ok(counts(P, items));
    assert.ok(P.cov.ratio > 0.99 && P.cov.ratio < 1);
  }
});

test("短歷史的持股市值超過一半：改用能涵蓋它們的較短期間並標示", () => {
  const W = world(), items = [...base(W), { c: "6919", mv: 2e6, D: W.H[1].slice(-80).map(x => ({ ...x })) }], P = portRisk(items, W.BM, 120);
  assert.equal(P.n, 79); assert.ok(P.issues.some(x => x.k === "window_shortened" && x.n === 79 && x.full === 120)); assert.equal(P.excluded.length, 0); assert.equal(P.cov.ratio, 1);
});

test("缺日：期間內缺一天整檔不納入（不把兩天的漲跌當一天）；期間外缺一天照常納入", () => {
  const W = world(); let items = base(W); items[1].D.splice(170, 1); let P = portRisk(items, W.BM, 120);
  assert.deepEqual(J(P.excluded.map(e => [e.c, e.why, e.count])), [["2317", "missing_days", 1]]); assert.equal(P.n, 120); assert.ok(P.issues.some(x => x.k === "low_coverage" && near(x.ratio, 0.7)));
  items = base(W); items[1].D.splice(20, 1); P = portRisk(items, W.BM, 120); assert.equal(P.excluded.length, 0); assert.equal(P.status, "ready");
});

test("壞價格：期間內價格 0 不納入；期間外的壞價格不影響", () => {
  const W = world(); let items = base(W); items[2].D[190].c = 0; let P = portRisk(items, W.BM, 120);
  assert.deepEqual(J(P.excluded.map(e => [e.c, e.why])), [["2454", "bad_price"]]);
  items = base(W); items[2].D[5].c = 0; P = portRisk(items, W.BM, 120); assert.equal(P.excluded.length, 0);
  items = base(W); items[2].D[150].c = NaN; P = portRisk(items, W.BM, 120); assert.equal(P.excluded[0].why, "bad_price");
});

test("同一天兩個不同價格（期間內）不納入；完全相同的重複資料照常", () => {
  const W = world(); let items = base(W); items[0].D.push({ d: W.D[180], c: 1 }); let P = portRisk(items, W.BM, 120);
  assert.deepEqual(J(P.excluded.map(e => [e.c, e.why])), [["2330", "conflict"]]);
  items = base(W); items[0].D.push({ ...items[0].D[180] }); P = portRisk(items, W.BM, 120); assert.equal(P.excluded.length, 0);
});

test("基準缺一天（持股都有）：標示 bench_gap", () => {
  const W = world(), BM = W.BM.filter((_, i) => i !== 150), P = portRisk(base(W), BM, 120);
  assert.ok(P.issues.some(x => x.k === "bench_gap" && x.count === 1 && x.dates[0] === W.D[150])); assert.equal(P.status, "partial");
});

test("極端單日（台股 +40%，多半是減資或資料錯誤）：那一天從所有序列拿掉，持股仍納入（不因此低估風險）", () => {
  const W = world(), items = base(W); for (let i = 185; i < 200; i++) items[0].D[i].c *= 1.4;
  const P = portRisk(items, W.BM, 120);
  assert.equal(P.excluded.length, 0); assert.equal(P.n, 119); assert.ok(P.issues.some(x => x.k === "extreme_day" && x.c === "2330" && x.d === W.D[185]));
  const clean = portRisk(base(W), W.BM, 120); assert.ok(Math.abs(P.vol - clean.vol) < 0.01, "拿掉一天後的波動率和乾淨資料接近");
});

test("VaR 尾端樣本少於 5 筆不計算", () => {
  const W = world(); let P = portRisk(base(W), W.BM, 80); assert.equal(P.var95, null); assert.equal(P.es95, null); assert.ok(P.issues.some(x => x.k === "var_sample"));
  P = portRisk(base(W), W.BM, 100); assert.ok(P.var95 < 0);
});

test("市值：沒有市值的不納入；用成本代替市值要標示；覆蓋率只算這次傳進來的持股", () => {
  const W = world(), items = [...base(W), { c: "2603", mv: null, D: W.H[1] }]; items[2].mvEst = true;
  const P = portRisk(items, W.BM, 120);
  assert.deepEqual(J(P.excluded.map(e => [e.c, e.why])), [["2603", "no_value"]]); assert.ok(P.issues.some(x => x.k === "cost_as_value" && x.c === "2454"));
  assert.equal(P.cov.mvAll, 1e6); assert.equal(P.tot, 1e6); assert.ok(counts(P, items));
});

test("盤中：基準有今天、持股都還沒有 → 日曆退到前一天，持股全部納入", () => {
  const W = world(), items = base(W).map(x => ({ ...x, D: x.D.slice(0, -1) })), P = portRisk(items, W.BM, 120);
  assert.equal(P.excluded.length, 0); assert.equal(P.trimmed, 1); assert.equal(P.to, W.D[198]);
  const one = base(W); one[2].D = one[2].D.slice(0, -1); const Q = portRisk(one, W.BM, 120);
  assert.equal(Q.trimmed, 0); assert.deepEqual(J(Q.excluded.map(e => [e.c, e.why])), [["2454", "missing_days"]], "只有少數幾檔落後：那幾檔不納入");
});

test("連續 5 天價格不變標示可能停牌；沒有基準時用多數持股都有的日期", () => {
  const W = world(), items = base(W); for (let i = 160; i < 166; i++) items[1].D[i].c = items[1].D[159].c;
  const P = portRisk(items, W.BM, 120); assert.ok(P.issues.some(x => x.k === "possible_halt" && x.c === "2317" && x.days >= 5));
  const N = portRisk(base(W), null, 120); assert.equal(N.n, 120); assert.equal(N.beta, null); assert.equal(N.status, "ready");
});

test("全部資料不足時回 short，不硬算", () => {
  const W = world(); assert.equal(portRisk([{ c: "2330", mv: 1, D: W.H[0].slice(-20) }], W.BM, 120).short, true);
  assert.equal(portRisk([], W.BM, 120).short, true);
});
