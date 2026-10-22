// 大戶國會：千張大戶點得進去、台股個股頁（千張大戶走勢＋集保網站補更早週次、內部人、政治人物）、期間選擇、國會年份檔、查個股
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const wk = (d, p1, p50, ppl) => [d, p1, p1 + 3, p50, ppl, 1400];
const DATES = ["2026-10-16", "2026-10-08", "2026-10-02", "2026-09-25", "2026-09-18"];

for (const width of [390, 1280]) test(`大戶國會：千張大戶、台股個股頁、期間、年份檔 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  const tdccCalls = [];
  await p.route("**/data/tdcc/rank.json", r => J(r, { date: "2026-10-16", up: [["2330", 1.2, 85, -0.3, -100]], down: [["2317", -0.8, 40, 0.5, 200]], n: 2,
    per: { 4: { from: "2026-09-18", n: 2, up: [["2454", 2.5, 60, -1, -50]], down: [["2317", -1.5, 40, 1, 300]] } }, dates: DATES, shards: ["23"] }));
  await p.route("**/data/tdcc/23.json", r => J(r, { "2330": DATES.slice().reverse().map((d, i) => wk(d, 84 + i * 0.2, 9 - i * 0.1, 3e6 + i)), "2317": DATES.slice().reverse().map((d, i) => wk(d, 42 - i * 0.5, 20 + i * 0.3, 8e5)) }));
  await p.route("**/api/tdcc**", r => { tdccCalls.push(r.request().url()); J(r, { ok: true, code: "2330", rows: [wk("2025-11-07", 80, 10.5, 2.9e6), wk("2026-03-06", 82, 10, 2.95e6), wk("2026-09-11", 83.5, 9.2, 3e6)], dates: DATES }); });
  await p.route("**/data/congress-arch/index.json", r => J(r, { years: { 2025: { n: 1, done: true } } }));
  await p.route("**/data/congress-arch/2025.json", r => J(r, { year: 2025, people: { "h-old-member": { name: "Old Member", chamber: "眾議院", state: "CA" } },
    trades: [{ ticker: "OLDX", asset: "Old Co", assetType: "股票", k: "buy", owner: "本人", traded: "2025-02-03", filed: "2025-03-01", amount: [1001, 15000], pid: "h-old-member", doc: "x" }] }));
  await p.evaluate(() => { showList(); setLt("cong"); });
  await p.waitForFunction(() => W.cong?.trades?.length, null, { timeout: 15000 });
  const lx = () => p.evaluate(() => document.getElementById("lx").innerText);

  // 千張大戶：點列（之前點了沒反應）→ 台股個股頁
  await p.click('#lTools [data-cv="tdcc"]'); await p.waitForFunction(() => /集保千張大戶每週動向/.test(document.getElementById("lx").innerText));
  await p.locator("#lx .tw-rank li > button").first().click();
  assert.equal(await p.evaluate(() => W.cv), "tw:s:2330", "點千張大戶的股票會打開台股個股頁");
  await p.waitForFunction(() => /千張大戶持股走勢/.test(document.getElementById("lx").innerText));
  assert.match(await lx(), /內部人申報轉讓[\s\S]*政治人物申報持有/);
  // 預設看一年：比排程累積的早，向集保網站補更早的週次，併在一起畫圖
  await p.waitForFunction(() => /已向集保網站補 3 週/.test(document.getElementById("lx").innerText), null, { timeout: 10000 });
  assert.ok(tdccCalls.some(u => /code=2330/.test(u) && /to=2026-09-17/.test(u)), "只補排程資料之前的週次：" + tdccCalls.join(" "));
  assert.equal(await p.evaluate(() => cxTdHist("2330").length), 8);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .cxtd svg polyline").length), 2, "千張大戶、散戶兩條走勢");
  await p.click('#lx [data-rkset="cxTdW:13"]'); assert.equal(await p.evaluate(() => store.get("watch:cxTdW")), "13", "期間記住");
  assert.ok(await p.evaluate(() => document.querySelectorAll("#lx details.tw-more tbody tr").length) <= 6, "一季只列一季內的週次");
  assert.equal(tdccCalls.length, 1, "同一檔不重複查集保網站");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "台股個股頁沒有橫向溢出");

  // 千張大戶期間：4 週用排程算好的排行；自訂兩個週次讀全部分片現算
  await p.evaluate(() => { W.cv = "tdcc"; renderList(); });
  await p.click('#lx [data-rkset="tdccP:4"]'); await p.waitForFunction(() => /千張大戶持股比例 4 週增加最多/.test(document.getElementById("lx").innerText));
  assert.match(await lx(), /2454/); assert.match(await lx(), /4 週大戶增持冠軍/);
  await p.click('#lx [data-rkset="tdccP:-1"]'); await p.waitForSelector('[data-tdccd="from"]');
  await p.waitForFunction(() => W.tdccAll === "ok"); await p.selectOption('[data-tdccd="from"]', "2026-09-18");
  await p.waitForFunction(() => /比較 2026\/09\/18 → 2026\/10\/16/.test(document.getElementById("lx").innerText));
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#lx .tw-rank li > button[data-cv]")].map(b => b.dataset.cv)), ["tw:s:2330", "tw:s:2317"], "區間內 2330 增、2317 減");
  await p.click('#lx [data-rkset="tdccV:heat"]'); await p.waitForSelector(".cxheat"); assert.match(await lx(), /各產業千張大戶區間增減動向/);
  await p.click('#lx [data-rkset="tdccP:1"]');

  // 大戶共識、我的追蹤也有期間
  await p.click('#lTools [data-cv="cons"]'); await p.waitForSelector('[data-cxw="cons:365"]'); await p.click('[data-cxw="cons:365"]');
  assert.equal(await p.evaluate(() => [W.consW, store.get("watch:consW")].join()), "365,365");
  await p.click('#lTools [data-cv="fol"]'); await p.waitForSelector('[data-cxw="fol:90"]');

  // 美國國會：選「全部」→ 自動讀更早的年份檔，併進交易
  await p.evaluate(() => { W.cv = "home"; renderList(); }); await p.click('[data-cxw="cong:0"]');
  await p.waitForFunction(() => W.cong.trades.some(t => t.ticker === "OLDX"), null, { timeout: 10000 });
  await p.waitForFunction(() => /2025 ✓/.test(document.getElementById("lx").innerText));
  assert.equal(await p.evaluate(() => W.cong.trades.filter(t => t.ticker === "OLDX").length), 1);
  await p.click('[data-cxw="cong:30"]');
  for (const v of ["home", "f13", "tw", "ins"]) { await p.evaluate(v => { W.cv = v; W.insF = "all"; renderList(); }, v); assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#lx .cx-row > .cx-lab")].map(x => x.textContent)), ["期間", "篩選", "看"], v); }

  // 查個股：台股到台股個股頁，美股到國會個股頁（多了 13F 機構）
  await p.fill("#lTools .cx-go input", "2317"); await p.press("#lTools .cx-go input", "Enter"); await p.waitForFunction(() => W.cv === "tw:s:2317");
  await p.fill("#lTools .cx-go input", "nvda"); await p.press("#lTools .cx-go input", "Enter"); await p.waitForFunction(() => W.cv === "stock:NVDA");
  await p.waitForFunction(() => /13F 機構：1 家持有/.test(document.getElementById("lx").innerText)); assert.match(await lx(), /測試機構[\s\S]*新進/);
  // 內部人分頁點股票也先到台股個股頁
  await p.evaluate(() => { W.cv = "ins"; W.insF = "all"; W.insW = 0; W.insv = "feed"; renderList(); }); await p.waitForSelector('#lx [data-tsel="2330"]');
  await p.click('#lx [data-tsel="2330"]'); assert.equal(await p.evaluate(() => [W.lt, W.cv].join()), "cong,tw:s:2330");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});
