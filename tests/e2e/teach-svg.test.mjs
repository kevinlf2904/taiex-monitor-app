// 教學圖示：標籤不壓到線、不被切掉；複盤資產曲線手機不被壓扁（#333 B1、B2）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, days } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`教學圖示與資產曲線 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch: width < 500 });
  const K = days("2025-01-01", "2025-08-01");
  const r = await p.evaluate(K => {
    const box = document.createElement("div"); box.style.cssText = "position:absolute;left:0;top:0;width:min(100%,700px)"; document.body.append(box);
    const put = h => { box.innerHTML = h; return box.querySelector("svg"); }, rc = e => e.getBoundingClientRect(), txt = (svg, s) => [...svg.querySelectorAll("text")].find(t => t.textContent.includes(s));
    const hitsY = (t, y, svg) => { const b = rc(t), m = svg.getScreenCTM(), py = y * m.d + m.f; return py > b.top + 1 && py < b.bottom - 1; };
    const o = {};
    // 綠K：上影線在實體上方（y 28～48），標籤要在那個高度，不在實體中段
    let svg = put(anatomySVG); const m1 = svg.getScreenCTM(), up = rc(txt(svg, "上影線")); o.upper = (up.top + up.bottom) / 2 < 52 * m1.d + m1.f;
    // 斐波那契：「回檔到黃金區止跌」不壓 78.6% 和 100% 的線
    svg = put(fibSVG); const t = txt(svg, "回檔到黃金區止跌"); o.fib = !hitsY(t, 80 + 110 * 0.786, svg) && !hitsY(t, 190, svg);
    // BOS／CHoCH：第二個 HL 在轉折點（185,115）下方，不壓線
    svg = put(smcStructSVG); const hl = [...svg.querySelectorAll("text")].filter(e => e.textContent === "HL")[1], m3 = svg.getScreenCTM(); o.hl = rc(hl).top > 115 * m3.d + m3.f;
    // 逆時鐘曲線：旋轉的「24 日均價 →」不能超出圖的上緣
    svg = put(ccwSVG(K)); const cc = txt(svg, "24 日均價"); o.ccw = svg ? rc(cc).top - rc(svg).top : null;
    // 資產曲線：手機不能被水平壓扁（字的寬高比和桌機一樣）
    const n = 40, eq = Array.from({ length: n }, (_, i) => 1 + i / 100); lab.D = K.map(k => ({ d: k.d }));
    svg = put(lxCurve({ eqW: eq, eqD: eq.map(v => v * 0.99), eqB: eq.map(v => v * 0.98), wins: [{ oa: 0 }, { oa: 20 }], isLen: 0, N: n }));
    const vb = svg.viewBox.baseVal, b = rc(svg); o.lx = (b.width / vb.width) / (b.height / vb.height);
    box.remove(); return o;
  }, K);
  assert.ok(r.upper, "上影線標籤要在實體上方"); assert.ok(r.fib, "黃金區說明壓到虛線"); assert.ok(r.hl, "第二個 HL 壓到線");
  assert.ok(r.ccw >= 0, `24 日均價超出上緣 ${r.ccw}px`); assert.ok(Math.abs(r.lx - 1) < 0.05, `資產曲線變形比 ${r.lx.toFixed(2)}`);
  await ctx.close(); assert.deepEqual(errs, []);
});
