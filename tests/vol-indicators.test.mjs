// 量能指標遇到缺量的 K 棒（#262 FIN-04、#264 C6）：OBV／VR／MFI 原本把來源沒給量的棒（vNa）當成 0 量，
// 算出看起來正常、其實少了一天量的數字。現在算不出來的那格是 null；沒有缺量時結果和以前逐位元相同。
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// 把 learner/core.js 載進沙盒（和 scripts/_engine.mjs 同一種方式：畫面相關的全域用空殼代替）
const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : stub), apply: () => stub, construct: () => stub });
const c = { console, Math, Date, JSON, Map, Set, WeakMap, Array, Object, Number, String, isFinite, parseFloat, parseInt, setTimeout, clearTimeout, Promise };
Object.assign(c, { window: c, document: stub, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { userAgent: "" }, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, requestAnimationFrame: () => 0, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => "" }) });
vm.createContext(c); vm.runInContext(readFileSync(new URL("../learner/core.js", import.meta.url), "utf8"), c, { filename: "core.js" });
const { obvCalc, vrCalc, mfiCalc } = Object.fromEntries(["obvCalc", "vrCalc", "mfiCalc"].map(n => [n, vm.runInContext(n, c)]));
const J = x => JSON.parse(JSON.stringify(x)); // 沙盒的陣列轉成一般陣列再比較
const bars = (cl, v, na = []) => cl.map((x, i) => ({ o: x, h: x, l: x, c: x, v: v[i], ...(na.includes(i) ? { vNa: 1 } : {}) }));

test("OBV：漲加量、跌減量、平盤不動；缺量的那天（有漲跌）是 null、累計不加，之後照常接續；平盤那天缺量不受影響", () => {
  const cl = [10, 11, 10, 10, 12], v = [100, 200, 300, 400, 500];
  assert.deepEqual(J(obvCalc(bars(cl, v))), [0, 200, -100, -100, 400], "手算：0、+200、−300、平盤、+500");
  assert.deepEqual(J(obvCalc(bars(cl, v, [2]))), [0, 200, null, 200, 700], "第 3 根（下跌）缺量：該格 null，累計不扣，之後接續");
  assert.deepEqual(J(obvCalc(bars(cl, v, [3]))), [0, 200, -100, -100, 400], "平盤那天缺量：OBV 本來就不加量，不受影響");
  assert.deepEqual(J(obvCalc(bars(cl, v, [0]))), [0, 200, -100, -100, 400], "第一根不算漲跌，缺量不影響");
  assert.deepEqual(J(obvCalc(bars(cl, v, [1, 2, 4]))), [0, null, null, 0, null]);
});

test("VR：視窗裡有任何一根缺量就是 null；不含缺量棒的視窗照常", () => {
  const cl = [10, 11, 12, 11, 11, 12], v = [10, 20, 30, 40, 50, 60];
  const ok = J(vrCalc(bars(cl, v), 3));
  assert.deepEqual(ok.slice(0, 3), [null, null, null]);
  assert.ok(Math.abs(ok[3] - 125) < 1e-9 && Math.abs(ok[4] - 55 / 65 * 100) < 1e-9 && Math.abs(ok[5] - 85 / 65 * 100) < 1e-9, "手算 125、84.615…、130.769…：" + ok);
  const na = J(vrCalc(bars(cl, v, [2]), 3));
  assert.deepEqual([na[3], na[4]], [null, null], "視窗含第 3 根（缺量）：null");
  assert.ok(Math.abs(na[5] - ok[5]) < 1e-9, "視窗 4～6 不含缺量棒：和沒有缺量時一樣");
});

test("MFI：視窗裡有漲跌的那天缺量就是 null；平盤那天缺量不受影響", () => {
  const cl = [10, 11, 12, 11, 11, 12], v = [10, 20, 30, 40, 50, 60];
  const ok = J(mfiCalc(bars(cl, v), 3)), want3 = 100 - 100 / (1 + 580 / 440), want5 = 100 - 100 / (1 + 720 / 440);
  assert.ok(Math.abs(ok[3] - want3) < 1e-9 && Math.abs(ok[5] - want5) < 1e-9, "手算 56.86、62.07：" + ok);
  const na = J(mfiCalc(bars(cl, v, [2]), 3)); assert.deepEqual([na[3], na[4]], [null, null]); assert.ok(Math.abs(na[5] - want5) < 1e-9);
  assert.deepEqual(J(mfiCalc(bars(cl, v, [4]), 3)), ok, "第 5 根是平盤（典型價沒變）：缺量不影響");
});

test("沒有缺量的資料：和修改前的公式逐位元相同（300 根隨機資料）", () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; let p = 100;
  const D = Array.from({ length: 300 }, () => { const o = p, cc = +(o * (1 + (rnd() - 0.5) * 0.05)).toFixed(1), h = Math.max(o, cc) + 0.5, l = Math.min(o, cc) - 0.5; p = cc; return { o, h, l, c: cc, v: Math.floor(rnd() * 5000) + (rnd() < 0.05 ? 0 : 1) }; });
  // 修改前的公式（原樣）
  const oldObv = D => { let s = 0; return D.map((x, i) => (i ? (s += x.c > D[i - 1].c ? x.v || 0 : x.c < D[i - 1].c ? -(x.v || 0) : 0) : (s = 0))); };
  const oldVr = (D, n = 26) => D.map((_, i) => { if (i < n) return null; let u = 0, d = 0, f = 0; for (let k = i - n + 1; k <= i; k++) { const v = D[k].v || 0; if (D[k].c > D[k - 1].c) u += v; else if (D[k].c < D[k - 1].c) d += v; else f += v; } return d + f / 2 ? ((u + f / 2) / (d + f / 2)) * 100 : null; });
  const oldMfi = (D, n = 14) => { const tp = D.map(x => (x.h + x.l + x.c) / 3); return D.map((_, i) => { if (i < n) return null; let p = 0, q = 0; for (let k = i - n + 1; k <= i; k++) { const f = tp[k] * (D[k].v || 0); if (tp[k] > tp[k - 1]) p += f; else if (tp[k] < tp[k - 1]) q += f; } return q ? 100 - 100 / (1 + p / q) : p ? 100 : 50; }); };
  assert.deepEqual(J(obvCalc(D)), oldObv(D)); assert.deepEqual(J(vrCalc(D)), oldVr(D)); assert.deepEqual(J(mfiCalc(D)), oldMfi(D)); assert.deepEqual(J(vrCalc(D, 10)), oldVr(D, 10)); assert.deepEqual(J(mfiCalc(D, 5)), oldMfi(D, 5));
});
