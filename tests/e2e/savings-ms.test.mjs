// 存錢里程碑時間軸：手機字不能縮到看不清楚，金額標籤不壓到 A/B/C 名稱，不互相重疊（#333 C1c）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`里程碑時間軸 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width, touch: width < 500 });
  await p.click('[data-sxg="ms"]'); await p.waitForSelector("#c-ms circle");
  const r = await p.evaluate(() => {
    const T = [...document.querySelectorAll("#c-ms text")].map(t => ({ s: t.textContent, b: t.getBoundingClientRect() })).filter(x => x.b.width);
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    let ov = 0; for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) if (hit(T[i].b, T[j].b)) ov++;
    const sv = document.querySelector("#c-ms").getBoundingClientRect(), out = Math.max(...T.map(x => Math.max(x.b.right - sv.right, sv.left - x.b.left)));
    return { h: Math.min(...T.map(x => x.b.height)), ov, out };
  });
  assert.ok(r.h >= 9, `最小字高 ${r.h}px`); assert.equal(r.ov, 0, "文字互相重疊"); assert.ok(r.out <= 0.5, `文字超出圖框 ${r.out}px`);
  assert.ok(await noHOverflow(p)); await ctx.close(); assert.deepEqual(errs, []);
});

// 視窗跨過 600px（手機轉向、桌機縮放）時重畫成對應寬度的畫布
test("里程碑時間軸：視窗跨過 600px 時重畫", async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 1280 });
  await p.click('[data-sxg="ms"]'); await p.waitForSelector("#c-ms circle");
  const vb = () => p.evaluate(() => document.getElementById("c-ms").viewBox.baseVal.width);
  assert.equal(await vb(), 760);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForFunction(() => document.getElementById("c-ms").viewBox.baseVal.width === 380, null, { timeout: 3000 });
  await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForFunction(() => document.getElementById("c-ms").viewBox.baseVal.width === 760, null, { timeout: 3000 });
  await ctx.close(); assert.deepEqual(errs, []);
});
