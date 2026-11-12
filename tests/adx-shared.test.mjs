// ADX 只留一份實作（#262 ARCH-01、#264 E3）：learner/quant.js 的 adxCalc 改用 core.js 的 dmiCalc。
// 這裡保留舊版 adxCalc 當對照，確認一般資料逐位元相同、資料不足時仍全部是 null，以及唯一不同的情況（開頭連續沒有波動）。
import test from "node:test";
import assert from "node:assert/strict";
import { engine } from "../scripts/_engine.mjs";

const qMean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function oldAdx(D, n = 14) { // 修改前 learner/quant.js 的 adxCalc，原樣保留
  const o = Array(D.length).fill(null); if (D.length < 2 * n + 1) return o;
  let tr = 0, pd = 0, nd = 0, adx = null; const dx = [];
  for (let i = 1; i < D.length; i++) {
    const up = D[i].h - D[i - 1].h, dw = D[i - 1].l - D[i].l, t = Math.max(D[i].h - D[i].l, Math.abs(D[i].h - D[i - 1].c), Math.abs(D[i].l - D[i - 1].c));
    const p = up > dw && up > 0 ? up : 0, m = dw > up && dw > 0 ? dw : 0;
    if (i <= n) { tr += t; pd += p; nd += m; if (i < n) continue; } else { tr = tr - tr / n + t; pd = pd - pd / n + p; nd = nd - nd / n + m; }
    const pdi = tr ? (100 * pd) / tr : 0, ndi = tr ? (100 * nd) / tr : 0, x = pdi + ndi ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0;
    if (adx == null) { dx.push(x); if (dx.length === n) adx = qMean(dx); } else adx = (adx * (n - 1) + x) / n;
    if (adx != null) o[i] = adx;
  }
  return o;
}
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const series = (len, flat = []) => { let x = 100; return Array.from({ length: len }, (_, i) => { if (flat.some(([a, b]) => i >= a && i < b)) return { o: x, h: x, l: x, c: x }; x *= 1 + (rnd() - 0.5) * 0.04; return { o: x, h: x * (1 + rnd() * 0.02), l: x * (1 - rnd() * 0.02), c: x }; }); };
const { adxCalc } = engine().Q;

test("一般資料：新舊 ADX 逐位元相同（含 n＝7、14、20 與中段停滯）", () => {
  for (const [len, n, flat] of [[300, 14, []], [500, 14, []], [120, 7, []], [260, 20, []], [200, 14, [[50, 80]]], [200, 14, [[100, 105]]]]) {
    const D = series(len, flat);
    assert.deepEqual(adxCalc(D, n), oldAdx(D, n), `len=${len} n=${n}`);
  }
});
test("資料不足 2n＋1 根：全部是 null；剛好 2n＋1 根開始有值", () => {
  for (const len of [0, 1, 27, 28]) assert.ok(adxCalc(series(len)).every(v => v == null), `len=${len}`);
  const D = series(29), a = adxCalc(D); assert.deepEqual(a, oldAdx(D)); assert.ok(a.some(v => v != null));
});
test("唯一不同：開頭連續 n 根以上沒有波動，新版等有波動才開始算，不把停滯當成 DX＝0", () => {
  const D = series(200, [[0, 20]]), a = adxCalc(D), b = oldAdx(D);
  const firstA = a.findIndex(v => v != null), firstB = b.findIndex(v => v != null);
  assert.ok(firstA > firstB, `新版起點 ${firstA} 應晚於舊版 ${firstB}`);
  assert.ok(a.slice(firstA).every(v => Number.isFinite(v) && v >= 0 && v <= 100));
});
test("marketState 一般資料結果不變（趨勢判斷沿用同一個 ADX）", () => {
  const { marketState } = engine().Q, D = series(400);
  const S = marketState(D); assert.ok(S && ["bull", "bear", "range"].includes(S.trend));
  assert.equal(S.adx, oldAdx(D, 14).at(-1)); assert.ok(Number.isFinite(S.adx));
});
