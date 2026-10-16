// K 線互動：滑鼠十字線經過訊號時圖不跳；拖曳時頁面不做每秒重畫
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("十字線經過訊號時圖表不上下跳", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { select("2330"); setDtab("tech"); });
  await p.waitForFunction(() => kChart.D?.length > 60 && kChart.o, null, { timeout: 20000 });
  // 讓訊號一定存在：每 3 根標一個（各種長度的文字，會讓說明列換行）
  await p.evaluate(() => { kChart.o.markers = kChart.D.map((_, i) => i).filter(i => i % 3 === 0).map(i => ({ i, side: i % 2 ? "buy" : "sell", label: "很長的訊號名稱用來測試換行".repeat(1 + (i % 4)) })); kChart.draw(); });
  const box = await p.evaluate(() => { const r = kChart.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
  const sweep = async () => { const tops = []; for (let x = box.x + 12; x < box.x + box.w - 70; x += 9) { await p.mouse.move(x, box.y + 120); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); tops.push(await p.evaluate(() => Math.round(kChart.canvas.getBoundingClientRect().top))); } return tops; };
  await sweep(); const t2 = await sweep();
  assert.equal(new Set(t2).size, 1, "第二次掃過時圖表位置要固定：" + [...new Set(t2)].join(","));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("拖曳 K 線時 Chart.busy", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { select("2330"); setDtab("tech"); });
  await p.waitForFunction(() => kChart.D?.length > 60, null, { timeout: 20000 });
  assert.equal(await p.evaluate(() => Chart.busy()), false);
  await p.evaluate(() => { const cv = kChart.canvas, r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: r.left + 100, clientY: r.top + 100, bubbles: true })); });
  assert.equal(await p.evaluate(() => Chart.busy()), true);
  await p.evaluate(() => { const cv = kChart.canvas; cv.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch", bubbles: true })); });
  await p.waitForTimeout(1000); assert.equal(await p.evaluate(() => Chart.busy()), false);
  assert.equal(await p.evaluate(() => listHidden()), true);
  await ctx.close(); assert.deepEqual(errs, []);
});
