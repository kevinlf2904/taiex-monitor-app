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

test("往左連續滑：載入更早資料時不會彈回、可以一路滑", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  // 更早的資料：每次給 before 之前 200 個交易日，延遲 300ms（模擬網路）
  await ctx.route("**/api/kline**", async r => { const u = new URL(r.request().url()), before = u.searchParams.get("before") || "2026-10-06", out = []; const d = new Date(before + "T00:00:00Z");
    while (out.length < 200) { d.setUTCDate(d.getUTCDate() - 1); if (d.getUTCDay() % 6) { const i = d.getTime() / 864e5, c = +(500 + Math.sin(i / 9) * 40).toFixed(1); out.unshift({ d: d.toISOString().slice(0, 10), o: c, h: c * 1.01, l: c * 0.99, c, v: 1000 }); } }
    if (u.searchParams.get("before")) await new Promise(f => setTimeout(f, 300));
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "2330", name: "台積電", source: "t", data: out }) }); });
  await p.evaluate(() => { select("2330"); setDtab("tech"); });
  await p.waitForFunction(() => kChart.D?.length > 100 && kChart.view, null, { timeout: 20000 });
  const left = () => p.evaluate(() => kChart.D[Math.floor(kChart.vw.fa)].d);
  const start = await left(); let prev = start, back = 0;
  for (let s = 0; s < 8; s++) {
    await p.evaluate(() => { const cv = kChart.canvas, r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, pointerType: "touch", isPrimary: true, clientX: r.left + 40, clientY: r.top + 120, bubbles: true })); });
    for (let k = 1; k <= 20; k++) { await p.evaluate(k => { const cv = kChart.canvas, r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, pointerType: "touch", isPrimary: true, clientX: r.left + 40 + k * 15, clientY: r.top + 121, bubbles: true })); }, k);
      await p.waitForTimeout(30); const l = await left(); if (l > prev) back++; prev = l; }
    await p.evaluate(() => { const cv = kChart.canvas; cv.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, pointerType: "touch", isPrimary: true, bubbles: true })); });
    await p.waitForTimeout(400); prev = await left();
  }
  const end = await left();
  assert.equal(back, 0, "拖曳中畫面被彈回 " + back + " 次");
  assert.ok(end < start && (Date.parse(start) - Date.parse(end)) / 864e5 > 150, `只從 ${start} 滑到 ${end}`);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("空心 K：紅綠 K 實體都只畫外框", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { select("2330"); setDtab("tech"); });
  await p.waitForFunction(() => kChart.D?.length > 60 && kChart.geo, null, { timeout: 20000 });
  const r = await p.evaluate(() => {
    const D = Array.from({ length: 30 }, (_, i) => { const up = i % 2 === 0, o = up ? 100 : 130, c = up ? 130 : 100; return { d: `2026-01-${String(i + 1).padStart(2, "0")}`, o, c, h: 132, l: 98, v: 1 }; });
    const div = document.createElement("div"); div.style.width = "600px"; document.body.append(div);
    Chart.prefs.kt = "hollow"; const ch = new Chart(div).set(D, { noVol: true, ma: [] });
    const g = ch.geo, ctx = ch.ctx, dpr = ch.canvas.width / div.clientWidth, X = i => g.L + g.bw * (i - g.fa + 0.5), y = g.top0 + g.mainH / 2;
    const px = i => [...ctx.getImageData(Math.round(X(i) + g.bw * 0.2) * dpr, Math.round(y) * dpr, 1, 1).data];
    const bg = [...ctx.getImageData(2, 2, 1, 1).data];
    Chart.prefs.kt = "candle"; return { up: px(10), down: px(11), bg };
  });
  // 實體中間（偏右一點避開影線）應該是透明（沒有填色）
  assert.equal(r.up[3], 0, "紅 K 實體中間有填色"); assert.equal(r.down[3], 0, "綠 K 實體中間有填色");
  await ctx.close(); assert.deepEqual(errs, []);
});
