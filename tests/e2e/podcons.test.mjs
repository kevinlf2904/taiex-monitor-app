// 節目 → 共識與分歧：多個節目一起看多／看空、意見分歧、熱度上升；同一個節目講很多次只算一次
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
for (const width of [390, 1280]) test(`節目：共識與分歧 ${width}`, async () => {
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

test("節目單集：背景正在整理別集時，按「AI 看完整支影片整理」會排在下一個，前一集好了自動開始", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  const sent = [];
  await ctx.route("**/api/podcast", async r => { if (r.request().method() !== "POST") return r.fulfill({ json: { ok: false, error: "mock" } }); const b = JSON.parse(r.request().postData()); sent.push(b.title + "|" + (b.video ? "video" : "notes"));
    await new Promise(x => setTimeout(x, b.title === "影片A" ? 3000 : 300)); r.fulfill({ json: { ok: true, tldr: "重點 " + b.title, points: ["一"], calls: [], mode: b.video ? "video" : "notes", model: "t" } }); });
  await p.evaluate(() => { showList(); setLt("pod"); });
  await p.waitForSelector("#podSeg");
  const [ka, kb] = await p.evaluate(() => { const feed = "https://www.youtube.com/feeds/videos.xml?channel_id=UCtest", eps = ["A", "B"].map((t, i) => ({ guid: "g" + t, title: "影片" + t, date: "2026-10-2" + i, desc: "", audio: "", video: "https://www.youtube.com/watch?v=" + t }));
    POD.cfg = { notes: true, audio: true }; podIndex(feed, { eps }); POD.feeds.set(feed, { at: Date.now(), show: { name: "測試頻道" }, eps }); return eps.map(e => podKey(feed, e.guid)); });
  await p.evaluate(([ka, kb]) => { podSum(ka, "video"); Object.assign(POD, { view: "ep", key: kb }); podRender(); }, [ka, kb]); // 背景在整理 A，畫面開著 B
  await p.click('#lx [data-psopen] summary'); await p.evaluate(() => podRender()); assert.ok(await p.evaluate(() => document.querySelector("#lx [data-psopen]").open), "重畫後還是打開的");
  await p.click('#lx [data-psum="video"]');
  await p.waitForFunction(() => /排在下一個：正在整理「影片A」/.test(document.getElementById("lx").innerText));
  await p.waitForFunction(kb => podSums()[kb]?.tldr === "重點 影片B" && !POD.job && /重點/.test(document.getElementById("lx").innerText), kb, { timeout: 10000 });
  assert.deepEqual(sent, ["影片A|video", "影片B|video"]);
  await ctx.close(); assert.deepEqual(errs, []);
});
