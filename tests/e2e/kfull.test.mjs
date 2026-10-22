// K 線圖「⛶ 放大」：嵌在首頁（iframe）時整個 iframe 固定成螢幕大小，手機直拿、橫拿、轉向、電腦都塞得進畫面；縮小後還原
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
// 放大框與 K 線畫布：畫布下緣要在放大框（扣掉下方留白）裡面，放大框要等於螢幕
const fit = F => F.evaluate(() => { const f = document.querySelector(".chart-fullscreen"), r = f.getBoundingClientRect(), c = kChart.canvas.getBoundingClientRect(), pb = parseFloat(getComputedStyle(f).paddingBottom);
  return { boxH: Math.round(r.height), ih: innerHeight, canvasBottom: Math.round(c.bottom), limit: Math.round(r.bottom - pb + 1), canvasW: Math.round(c.width), boxW: Math.round(r.width), scroll: f.scrollHeight - f.clientHeight }; });

test("K 線放大：首頁裡直拿、橫拿、轉向都塞得進螢幕，縮小還原", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html#watch", { width: 390, touch: true });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1200);
  const F = () => p.frames().find(x => x.url().includes("watch.html"));
  await F().evaluate(() => select("2330")); await p.waitForTimeout(800); await F().evaluate(() => setDtab("tech"));
  await F().waitForFunction(() => typeof kChart !== "undefined" && kChart?.D?.length, null, { timeout: 15000 });
  await p.evaluate(() => scrollTo(0, 500)); const h0 = await p.evaluate(() => document.querySelector("#watchFrame").offsetHeight);
  await F().evaluate(() => kChart.bar.querySelector("[data-z=expand]").click()); await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#watchFrame")).position), "fixed", "iframe 固定在螢幕上");
  for (const [w, h] of [[390, 844], [844, 390], [390, 844]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500);
    const m = await fit(F()); assert.equal(m.boxH, h, `${w}x${h} 放大框＝螢幕高 ${JSON.stringify(m)}`);
    assert.ok(m.canvasBottom <= m.limit, `${w}x${h} K 線畫在畫面內 ${JSON.stringify(m)}`); assert.ok(m.scroll <= 1, `${w}x${h} 不用捲動`); assert.ok(m.canvasW >= m.boxW - 40, `${w}x${h} 寬度填滿`);
  }
  await F().evaluate(() => kChart.bar.querySelector("[data-z=expand]").click()); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#watchFrame")).position), "static", "縮小後還原");
  assert.ok(await p.evaluate(h0 => Math.abs(document.querySelector("#watchFrame").offsetHeight - h0) < 400, h0), "iframe 高度回到內容高度");
  // Esc 也能縮小並還原 iframe
  await F().evaluate(() => kChart.bar.querySelector("[data-z=expand]").click()); await p.waitForTimeout(300); await F().evaluate(() => dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  await p.waitForTimeout(300); assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#watchFrame")).position), "static", "Esc 縮小後還原");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("K 線放大：單獨開看盤頁（電腦）也塞得進畫面", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => select("2330")); await p.waitForTimeout(800); await p.evaluate(() => setDtab("tech")); await p.waitForFunction(() => typeof kChart !== "undefined" && kChart?.D?.length, null, { timeout: 15000 });
  await p.evaluate(() => kChart.bar.querySelector("[data-z=expand]").click()); await p.waitForTimeout(400);
  const m = await fit(p.mainFrame()); assert.equal(m.boxH, 1000); assert.ok(m.canvasBottom <= m.limit && m.scroll <= 1, JSON.stringify(m));
  await ctx.close(); assert.deepEqual(errs, []);
});
