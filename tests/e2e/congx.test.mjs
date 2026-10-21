// 大戶國會延伸：大戶共識榜、我的追蹤（☆ 追蹤、新申報）、申報延遲、勝率卡、13F 主題熱圖
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`大戶國會延伸功能 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await p.evaluate(() => { showList(); setLt("cong"); });
  await p.waitForFunction(() => W.cong?.trades?.length, null, { timeout: 15000 });
  const lx = () => p.evaluate(() => document.getElementById("lx").innerText);
  // 大戶共識：台股（政治人物持有＋內部人）
  await p.click('#lTools [data-cv="cons"]'); await p.waitForFunction(() => /大戶共識榜/.test(document.getElementById("lx").innerText));
  await p.click('[data-rkset="cxReg:tw"]'); await p.waitForFunction(() => /2330/.test(document.getElementById("lx").innerText), null, { timeout: 15000 });
  assert.match(await lx(), /2 位持有[\s\S]*內部人近 90 天申報轉讓 1 筆/);
  // 申報延遲
  await p.evaluate(() => { W.cv = "home"; W.cview = "lag"; renderList(); }); assert.match(await lx(), /申報延遲：從交易到公開的天數/);
  // 人物頁：追蹤、延遲、勝率卡
  const pid = await p.evaluate(() => { const c = new Map(); W.cong.trades.filter(t => t.k === "buy").forEach(t => c.set(t.pid, (c.get(t.pid) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0][0]; });
  await p.evaluate(pid => { W.cv = "person:" + pid; renderList(); }, pid);
  await p.waitForSelector('#lx [data-cxfol]'); assert.match(await lx(), /申報延遲：中位數 \d+ 天/);
  await p.click('#lx [data-cxfol]'); assert.equal(await p.getAttribute('#lx [data-cxfol]', "aria-pressed"), "true");
  assert.ok(await p.evaluate(pid => !!store.get("watch:follow").cong[pid], pid), "追蹤存起來");
  await p.waitForFunction(() => /議員本人/.test(document.querySelector(".cxwin")?.innerText || ""), null, { timeout: 20000 });
  // 我的追蹤：列出追蹤的人、自選股的內部人申報
  await p.evaluate(() => { W.cv = "fol"; renderList(); }); await p.waitForFunction(() => /我的追蹤/.test(document.getElementById("lx").innerText));
  assert.ok((await lx()).includes(await p.evaluate(pid => pName(pid), pid)));
  // 13F 主題熱圖
  await p.evaluate(() => { W.cv = "f13"; W.f13v = "heat"; renderList(); }); await p.waitForSelector(".cxheat");
  assert.match(await lx(), /主題熱圖/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});
