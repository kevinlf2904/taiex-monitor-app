// 今日重點卡：自選分頁最上面，盤勢、持股大漲跌、今明兩天的除權息與法說會；點了直接過去，收合狀態會記住；其他分頁不顯示
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`今日重點卡 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => {
    W.td = { at: Date.now() }; W.hold = { 1234: { sh: 1000, cost: 50 } }; W.mn = { days: [{ tw: { sum: { head: "台股跟著費半重挫" } } }] };
    W.quotes.set("T00", { ...(W.quotes.get("T00") || {}), chgPct: -1.52 }); W.quotes.set("1234", { ...(W.quotes.get("1234") || {}), chgPct: -4.2 });
    W.cal = { ok: true, rows: [{ code: "1234", name: "測試", date: twDay(), kind: "除息" }], conf: [{ code: "1234", date: nextWd(twDay()), time: "14:00" }] };
    setLt("watch"); renderList();
  });
  await p.waitForSelector("#todayCard:not([hidden]) .today");
  const t = await p.textContent("#todayCard");
  assert.match(t, /今日重點[\s\S]*盤勢[\s\S]*加權 [-+]\d+\.\d\d%：台股跟著費半重挫/); assert.match(t, /大漲跌[\s\S]*★\S*1234\S* -4\.2%|大漲跌[\s\S]*★\S+ -4\.2%/); assert.match(t, /今天 \S+ 除息[\s\S]*明天 \S+ 法說會/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await p.click("#todayCard summary"); await p.waitForFunction(() => store.get("watch:today") === false, null, { timeout: 3000 });
  await p.click("#todayCard summary");
  await p.click('#todayCard [data-tdgo="mkt"]'); assert.equal(await p.evaluate(() => W.lt), "mkt"); assert.equal(await p.isHidden("#todayCard"), true, "其他分頁不顯示");
  await ctx.close(); assert.deepEqual(errs, []);
});
