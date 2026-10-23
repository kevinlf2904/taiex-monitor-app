// 手機上很長的子頁籤：「▾ 全部 N 項」用網格一次列出、點了切過去；估值地圖全螢幕；K線學堂課程搜尋；Telegram 還沒設定時一般訪客看不到管理者說明
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const ROWS = [["2330", "台積電", "半導體業", "上市", 3300, 5.1, 36.2, 38.4, 15.2, 9300, 3980, 59.1, 49.5, 42.7], ["2303", "聯電", "半導體業", "上市", 200, 1, 8, 5, 0.8, 600, 90, 30, 20, 18],
  ["6488", "環球晶", "半導體業", "上櫃", 50, 2, -8.3, -6, 2.5, 160, 12, 30, 20, 7.5], ["3105", "穩懋", "半導體業", "上櫃", 15, 8, 45, 22, 1.2, 45, 5, 25, 12, 11]];

test("手機子頁籤「▾ 全部」、估值地圖全螢幕 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  await ctx.route("**/api/oapi?earn=1", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: ROWS }) }));
  await ctx.route("**/api/screen?bw=1", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: { 2330: [24.5, 6.8, 1.6], 2303: [12, 1.5, 4], 6488: [18.2, 2.1, 3.9], 3105: [30, 1.5, 1] } }) }));
  await p.evaluate(() => { ER().view = "sum"; ER().reg = "tw"; showList(); setLt("earn"); });
  await p.waitForSelector("#lTools + .segall, .segall");
  assert.match(await p.textContent(".segall"), /全部 1[3-9] 項/);
  await p.click(".segall"); await p.waitForSelector("#sheetExtra .segpick");
  assert.match(await p.textContent("#sheetExtra .segpick"), /總覽[\s\S]*排行[\s\S]*月營收[\s\S]*比較[\s\S]*估值地圖[\s\S]*研究/, "分組標籤一起帶過去");
  await p.click('#sheetExtra .segpick button:text-is("估值地圖")');
  assert.equal(await p.evaluate(() => ER().view), "map"); assert.equal(await p.isHidden("#sheet"), true, "選了就關掉");
  await p.waitForSelector("[data-fxfull]", { timeout: 15000 });
  await p.click("[data-fxfull]"); assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".mk.fxfull")).position), "fixed");
  await p.keyboard.press("Escape"); assert.equal(await p.evaluate(() => !!document.querySelector(".mk.fxfull")), false, "Esc 縮小");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("電腦版不加「▾ 全部」 1280", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 1280 });
  await ctx.route("**/api/oapi?earn=1", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: ROWS }) }));
  await p.evaluate(() => { showList(); setLt("earn"); }); await p.waitForSelector(".earn");
  assert.equal(await p.$(".segall"), null);
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`K線學堂課程搜尋 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch: width < 500 });
  await p.evaluate(() => switchTab("learn"));
  const n0 = await p.$$eval("#lessonList button", L => L.length);
  await p.fill("#lessonSearch", "背離");
  const T = await p.$$eval("#lessonList button", L => L.map(b => b.textContent));
  assert.ok(T.length > 0 && T.length < n0, `只列相關的課：${T.length}/${n0}`);
  await p.fill("#lessonSearch", "zzzz不存在"); assert.match(await p.textContent("#lessonList"), /找不到「zzzz不存在」/);
  await p.fill("#lessonSearch", ""); assert.equal(await p.$$eval("#lessonList button", L => L.length), n0);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("Telegram 還沒設定：說暫時不能用、可以複製今日重點 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route(/\/api\/sync\?op=cfg/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ kv: true, tg: false }) }));
  await p.evaluate(() => { W.syncCfg = null; W.td = { at: Date.now() }; W.hold = { 1234: { sh: 1000, cost: 50 } }; W.quotes.set("1234", { ...(W.quotes.get("1234") || {}), chgPct: -4.2 }); setLt("watch"); renderList(); });
  await p.click("#todayCard [data-tgone]"); await p.waitForSelector("#sheetExtra .tgone [data-tdcopy]");
  assert.match(await p.textContent("#sheetExtra .tgone"), /暫時還不能使用/);
  await ctx.close(); assert.deepEqual(errs, []);
});
