// 申報：美國國會「誰買了什麼、賺賠多少」與台灣政治人物持股損益
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("國會買進損益", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { setLt("cong"); }); await p.waitForTimeout(1500); await p.evaluate(() => { W.cv = "bt"; renderList(); });
  await p.click('#lx [data-cbt="60"]'); await p.waitForFunction(() => W.cbt && !W.cbt.busy, null, { timeout: 90000 });
  const r = await p.evaluate(() => W.cbt.rows.filter(x => x.pnl != null).map(x => [x.mid, x.nT, x.pnl, x.pT, x.last]));
  assert.ok(r.length > 10); for (const [mid, nT, pnl, pT, last] of r) { assert.ok(Math.abs(pnl - mid * nT) < 1e-6); assert.ok(Math.abs(nT - (last / pT - 1)) < 1e-9); }
  await p.click('#lx [data-cpl="sort:loss"]'); const who = await p.$eval('#lx [data-cpl^="who:"]', b => b.dataset.cpl); await p.click(`#lx [data-cpl="${who}"]`);
  assert.equal(await p.evaluate(() => W.cpl.who), who.slice(4));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("台灣政治人物持股損益", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { setLt("cong"); W.cv = "tw"; renderList(); }); await p.waitForTimeout(1500);
  await p.click('#lx [data-twbt="1"]'); await p.waitForFunction(() => W.twoBt && !W.twoBt.busy, null, { timeout: 30000 });
  const x = await p.evaluate(() => { const P = twoPeople().find(p => p.pid === "王小明"), X = twoPnl(P); return { n: X.ok.length, pnl: X.pnl, sum: X.ok.reduce((a, r) => a + r.sh * (r.p1 - r.p0), 0), d0: X.ok.map(r => r.d0) }; });
  assert.equal(x.n, 2); assert.ok(Math.abs(x.pnl - x.sum) < 1e-6); assert.ok(x.d0.every(d => d > "2026-06-29"));
  await p.evaluate(() => { W.cv = "tw:p:王小明"; renderList(); }); await p.waitForTimeout(500);
  assert.match(await p.evaluate(() => $("#lx").innerText), /持股損益/);
  await ctx.close(); assert.deepEqual(errs, []);
});
