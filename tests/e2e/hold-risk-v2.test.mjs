// 庫存風險 v2：有持股資料不夠時，畫面寫出哪幾檔沒算進來、原因和納入市值占比；風險值旁邊有期望損失（ES）；手機不溢出
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("庫存風險：資料不夠的持股不納入並說明原因、納入市值占比；有期望損失（ES）", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    // 6919 只有 20 根日 K（新上市）
    await ctx.route("**/api/kline?code=6919**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "6919", name: "康霈", data: Array.from({ length: 20 }, (_, i) => ({ d: `2026-09-${String(i + 1).padStart(2, "0")}`, o: 100, h: 101, l: 99, c: 100 + i, v: 1000 })) }) }));
    await p.evaluate(() => { W.hold = { 2330: { sh: 1000, cost: 90 }, 2317: { sh: 3000, cost: 100 }, 6919: { sh: 100, cost: 100 }, 9999: { sh: -5, cost: 10 } }; W.holdMkt = "tw"; W.holdView = "risk"; setLt("hold"); });
    await p.waitForSelector(".hrisk", { timeout: 20000 });
    const t = await p.evaluate(() => $("#lx").innerText);
    assert.match(t, /未納入計算：.*6919|未納入計算：.*康霈/s, width + "：寫出沒算進來的持股");
    assert.match(t, /上市或有資料的日子不夠/); assert.match(t, /納入的市值占 \d+%/); assert.match(t, /期望損失（ES）/);
    assert.doesNotMatch(t, /9999/, "股數是負的壞資料不列入");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
