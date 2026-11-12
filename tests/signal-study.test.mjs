// 訊號回測（選股條件的歷史勝率）：learner/sigstudy.js 的計算核心與 scripts/signal-study.mjs。全部用固定假資料。
// 重點：不偷看未來、隔天開盤進場、扣成本、一字漲停買不到、缺值與價格異常不算、去重、流動性。
import test from "node:test";
import assert from "node:assert/strict";
import { engine } from "../scripts/_engine.mjs";

const E = engine(), G = E.G || {}, plain = v => JSON.parse(JSON.stringify(v)); // 沙盒（vm）裡產生的物件換成一般物件再比
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const flat = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => ({ d: day(i), o: 100, h: 101, l: 99, c: 100, v: 1000, ...f(i) }));
const noInd = () => ({}), always = [{ id: "a", group: "t", name: "每天", hit: () => true }];

test("訊號回測：隔天開盤進場、第 n 根收盤出場、扣成本", () => {
  const D = flat(12, i => (i === 5 ? { o: 110, h: 112, l: 108, c: 111 } : i === 6 ? { o: 104, h: 106, l: 103, c: 105 } : i === 10 ? { c: 120, h: 121 } : {}));
  assert.equal(G.SIG_COST, 0.001425 * 2 + 0.003);
  assert.ok(Math.abs(G.sigForward(D, 5, 5) - (120 / 104 - 1 - G.SIG_COST)) < 1e-12, "第 6 根開盤 104 買、第 10 根收盤 120 賣");
  assert.equal(G.sigForward(D, 5, 20), null, "後面資料不夠");
});
test("訊號回測：一字漲停買不到、價格異常不算", () => {
  const L = flat(12, i => (i === 6 ? { o: 110, h: 110, l: 110, c: 110 } : i > 6 ? { o: 110, h: 111, l: 109, c: 110 } : {}));
  assert.equal(G.sigForward(L, 5, 3), null, "隔天一字漲停");
  const J = flat(12, i => (i >= 8 ? { o: 40, h: 41, l: 39, c: 40 } : {}));
  assert.equal(G.sigForward(J, 5, 5), null, "單日跳動超過 50% 視為未還原的減資／分割");
  assert.notEqual(G.sigForward(flat(12), 5, 5), null, "正常資料算得出來");
});
test("訊號回測：缺值不算、不產生 NaN", () => {
  for (const f of [i => (i === 6 ? { o: null } : {}), i => (i === 10 ? { c: 0 } : {}), i => (i === 8 ? { c: null } : {}), i => (i === 5 ? { c: null } : {})])
    assert.equal(G.sigForward(flat(12, f), 5, 5), null);
  const R = plain(G.sigStudy([{ c: "1111", n: "缺", bars: flat(100, i => (i % 7 === 0 ? { o: null, c: null } : {})) }], always, noInd));
  assert.ok(!JSON.stringify(R).includes("NaN")); for (const n of [5, 10, 20]) assert.ok(R[0].stats[n] === null || Number.isFinite(R[0].stats[n].avg));
});
test("訊號回測：不偷看未來（改掉訊號日之後的 K 棒，訊號不變）", () => {
  const mk = tail => flat(100, i => (i === 70 ? { c: 108, h: 109 } : i > 70 ? tail(i) : {}));
  const defs = [{ id: "up5", hit: P => P.at(-1).c / P.at(-2).c - 1 > 0.05 }];
  const pick = D => plain(G.sigScan(D, defs, noInd)).filter(x => x.i <= 70).map(x => x.i);
  assert.deepEqual(pick(mk(() => ({}))), [70]); assert.deepEqual(pick(mk(i => ({ o: 300 + i, h: 310 + i, l: 290 + i, c: 305 + i }))), [70]);
  const seen = [], inds = []; G.sigScan(flat(100), [{ id: "len", hit: (P, I) => { seen.push(P.length); inds.push(I.len); return false; } }], P => ({ len: P.length }));
  assert.deepEqual(seen, Array.from({ length: 40 }, (_, k) => 61 + k), "第 i 天只收到到那天為止的 i + 1 根"); assert.deepEqual(inds, seen, "指標也只用到那天為止的 K 棒");
});
test("訊號回測：gap 內重複成立只算一次、量不足不算、條件丟例外視為不成立", () => {
  assert.deepEqual(plain(G.sigScan(flat(100), always, noInd)).map(x => x.i), [60, 65, 70, 75, 80, 85, 90, 95]);
  assert.equal(G.sigScan(flat(100, () => ({ v: 100 })), always, noInd).length, 0);
  assert.equal(G.sigScan(flat(100), [{ id: "x", hit: () => { throw new Error("壞掉"); } }], noInd).length, 0);
});
test("訊號回測：sigStudy 的統計、分佈、最近案例；不到 61 根略過", () => {
  const up = flat(100, i => ({ o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i })), dn = flat(100, i => ({ o: 300 - i, h: 301 - i, l: 299 - i, c: 300 - i }));
  const R = plain(G.sigStudy([{ c: "1111", n: "漲", bars: up }, { c: "2222", n: "跌", bars: dn }], always, noInd));
  const s5 = R[0].stats[5]; assert.equal(s5.n, 14, "每檔 60～90 共 7 次（95 那次後面不夠 5 根）"); assert.equal(s5.win, 0.5); assert.equal(R[0].stats[20].n, 8);
  assert.equal(R[0].hist.length, 10); assert.equal(R[0].hist.reduce((a, b) => a + b, 0), R[0].stats[20].n); assert.equal(R[0].recent[0].length, 6);
  assert.ok(s5.exWin === 0.5 && Math.abs(s5.ex) < 0.02, "一漲一跌，贏大盤的機率一半");
  const S = plain(G.sigStudy([{ c: "3333", n: "短", bars: flat(50) }, { c: "4444", n: "空", bars: null }], always, noInd));
  assert.deepEqual(S[0].stats, { 5: null, 10: null, 20: null }); assert.deepEqual(S[0].recent, []);
});
test("訊號回測：真實條件接得上（COND、KPAT）", () => {
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; let p = 100;
  const D = Array.from({ length: 200 }, (_, i) => { const o = p; p = Math.max(5, p * (1 + (rnd() - 0.49) * 0.06)); return { d: day(i), o, h: Math.max(o, p) * 1.01, l: Math.min(o, p) * 0.99, c: p, v: 1000 + Math.round(rnd() * 3000) }; });
  const C = E.COND.find(x => x[0] === "macdgc"), K = E.KPAT[0];
  const R = plain(G.sigStudy([{ c: "1111", n: "亂數", bars: D }], [{ id: "c:macdgc", group: "tech", name: C[1], hit: (P, I) => C[4](P, I, C[3]) }, { id: "k:" + K.id, group: "kline", side: K.side, name: K.name, desc: K.desc, hit: P => K.hit(P) }], E.indicators));
  assert.equal(R.length, 2); assert.ok(R[0].stats[5]?.n > 0, "200 根亂數走勢一定有 MACD 金叉"); assert.equal(R[1].side, K.side);
  for (const x of R) for (const n of [5, 10, 20]) assert.ok(x.stats[n] === null || x.stats[n].n > 0);
});
