// 手機滑動：每個分頁都能用手指往下捲、再捲回最上面；手指放在圖表（分時、K 線、產業星系、動能矩陣、學堂 K 線）上下滑也會捲動頁面
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, watchFrame } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const drag = async (cdp, p, x, y0, y1) => { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] }); for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + (y1 - y0) * i / 10 }] }); await p.waitForTimeout(12); } await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(150); };

test("手機：所有分頁都能捲到底、再捲回最上面，手指放在圖表上也能捲", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 390, touch: true });
  const cdp = await ctx.newCDPSession(p), F = () => p.frames().find(x => x.url().includes("watch.html"));
  for (const [tab, lt] of [["intel", "cong"], ["intel", "ind"], ["watch", "tools"], ["watch", "mkt"], ["school", null], ["savings", null]]) {
    await p.evaluate(t => goTab(t), tab); await p.waitForTimeout(1200);
    if (lt) { await (await watchFrame(p)).evaluate(l => { showList(); setLt(l); }, lt); await p.waitForTimeout(1000); }
    await p.evaluate(() => scrollTo(0, 0)); for (let i = 0; i < 3; i++) await drag(cdp, p, 195, 800, 250);
    // 手指快速滑動後還有慣性捲動：等位置停下來再量；往回捲直到頂（慢的機器上慣性會多捲一段，固定滑 5 次可能還沒到頂）
    const still = async () => { let a = -1, b = await p.evaluate(() => scrollY); while (a !== b) { a = b; await p.waitForTimeout(250); b = await p.evaluate(() => scrollY); } return b; };
    const down = await still(); for (let i = 0; i < 12 && (await still()) > 0; i++) await drag(cdp, p, 195, 250, 800);
    assert.ok(down > 300, `${tab}/${lt} 往下捲：${down}`); assert.equal(await p.evaluate(() => scrollY), 0, `${tab}/${lt} 捲回最上面`);
  }
  const onEl = async (label, sel, inFrame = true) => {
    const fr = inFrame ? F() : p.mainFrame(), r = await fr.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + scrollY, h: b.height }; }, sel);
    const off = inFrame ? await p.evaluate(() => document.querySelector("#watchFrame").getBoundingClientRect().top + scrollY) : 0;
    await p.evaluate(y => scrollTo(0, y - 400), off + r.y + Math.min(r.h, 300) / 2); await p.waitForTimeout(250);
    const y0 = await p.evaluate(() => scrollY); await drag(cdp, p, r.x, 450, 250); const y1 = await p.evaluate(() => scrollY); await drag(cdp, p, r.x, 250, 450); const y2 = await p.evaluate(() => scrollY);
    assert.ok(y1 > y0 + 50 && y2 < y1 - 50, `${label}：${y0} → ${y1} → ${y2}`);
  };
  await p.evaluate(() => goTab("watch")); await p.waitForTimeout(1500); await (await watchFrame(p)).evaluate(() => select("2330")); await p.waitForTimeout(2000);
  await onEl("分時圖", ".ts canvas"); await F().evaluate(() => setDtab("tech")); await p.waitForTimeout(1200); await onEl("K 線圖", "#kChart canvas");
  await F().evaluate(() => { showList(); setLt("ind"); W.indS.view = "network"; renderList(); }); await p.waitForTimeout(2000); await onEl("產業星系", ".igalaxy");
  await p.evaluate(() => goTab("school")); await p.waitForTimeout(1200); await onEl("學堂 K 線", "canvas", false);
  await ctx.close(); assert.deepEqual(errs, []);
});
