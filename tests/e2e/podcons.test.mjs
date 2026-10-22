// 提及標的 → 共識與分歧：多個節目一起看多／看空、意見分歧、熱度上升；同一個節目講很多次只算一次
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
for (const width of [390, 1280]) test(`提及標的：共識與分歧 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  const R = await p.evaluate(() => { const t = "2026-10-22", d = n => addDays(t, -n), c = (code, dir, feed, n, quote = "") => ({ code, name: code, dir, feed, show: feed, date: d(n), quote });
    const L = [c("2330", "bull", "A", 1, "看好"), c("2330", "bull", "A", 2), c("2330", "bull", "B", 3), c("2317", "bear", "A", 5), c("2317", "bear", "C", 6), c("NVDA", "bull", "A", 4), c("NVDA", "bear", "B", 10), c("2454", "bull", "A", 40), c("2454", "bull", "B", 41),
      c("2603", "bull", "A", 1), c("2603", "bull", "B", 2), c("2603", "bull", "C", 3)];
    const r = podCons(L, 30, t); return { bull: r.bull.map(g => g.code + ":" + g.nb), bear: r.bear.map(g => g.code), split: r.split.map(g => g.code), hot: r.hot.map(g => g.code) }; });
  assert.deepEqual(R.bull, ["2603:3", "2330:2"], "同一節目講兩次只算一個；超過 30 天的不算");
  assert.deepEqual(R.bear, ["2317"]); assert.deepEqual(R.split, ["NVDA"]); assert.ok(R.hot.includes("2330") && R.hot.includes("2603"));
  await p.evaluate(() => { showList(); setLt("pod"); }); await p.waitForSelector('#podSeg [data-pv="cons"]');
  assert.match(await p.textContent("#podSeg"), /共識與分歧/);
  await p.click('#podSeg [data-pv="cons"]'); await p.waitForSelector(".pod [data-pcw]");
  assert.match(await p.textContent(".pod"), /多個節目一起看多[\s\S]*多個節目一起看空[\s\S]*意見分歧[\s\S]*熱度上升/);
  await p.click('.pod [data-pcw="7"]'); assert.equal(await p.evaluate(() => store.get("pod:prefs").cw), 7); assert.doesNotMatch(await p.textContent(".pod"), /熱度上升/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});
