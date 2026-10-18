// 這一版的 UX 串聯：分享圖卡在 iframe 裡也看得到預覽、全域搜尋、以股查人、隨處加自選、個股情報徽章、矩陣成分股、範例投資組合、畫線磁吸
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`首頁：全域搜尋、分享圖卡預覽畫在最上層 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch: width < 500 });
  await p.evaluate(() => goTab("school")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => !!document.querySelector("#gsTop") && getComputedStyle(document.querySelector("#gsTop")).display !== "none"), true);
  await p.click("#gsTop");
  await p.waitForFunction(() => { const f = document.querySelector("#watchFrame"); return f?.contentWindow?.document?.querySelector("#gsearch") && !f.contentWindow.document.querySelector("#gsearch").hidden; }, null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => CUR_TAB), "watch");
  // 情報局的大戶國會：在 iframe 裡按「分享情報圖卡」，預覽視窗出現在最上層頁面（看得到），有下載與複製
  const f = p.frame({ url: /watch\.html/ });
  await f.evaluate(() => { gsHide(); setLt("cong"); W.cv = "tw"; renderList(); });
  await f.waitForFunction(() => document.querySelector("#lx ol.tw-rank li"), null, { timeout: 15000 });
  await f.click('[data-sharecard="cong"]');
  await p.waitForSelector(".sc-modal img", { timeout: 15000 });
  const box = await p.evaluate(() => { const r = document.querySelector(".sc-modal .sc-box").getBoundingClientRect(); return [r.top >= 0, r.bottom <= innerHeight + 1, document.querySelector(".sc-modal").innerText]; });
  assert.ok(box[0] && box[1], "預覽視窗要在畫面內"); assert.match(box[2], /下載 PNG 圖片/);
  assert.equal(await f.evaluate(() => !!document.querySelector(".sc-modal")), false, "不是畫在 iframe 裡");
  await p.click('.sc-modal [data-sca="x"]'); assert.equal(await p.evaluate(() => !!document.querySelector(".sc-modal")), false);
  assert.match(await p.evaluate(() => $("#schoolNav").innerText), /AI 截圖診斷/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`看盤：以股查人、☆ 自選、情報徽章、矩陣成分股、範例庫存 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  // 以股查人：搜尋「台積電」或 2330 列出兩位申報持有的人
  await p.evaluate(() => { setLt("cong"); W.cv = "tw"; W.twoQ = "台積電"; renderList(); });
  await p.waitForFunction(() => /持有 \S+ 2330 的政治人物（2 位）/.test($("#lx").innerText), null, { timeout: 15000 });
  assert.match(await p.evaluate(() => $("#lx").innerText), /王小明[\s\S]*立法委員[\s\S]*3 張[\s\S]*李大華/);
  await p.evaluate(() => { W.twoQ = "2317"; renderList(); });
  assert.match(await p.evaluate(() => $("#lx").innerText), /沒有符合的人（也沒有人申報持有這檔股票）/); // 2317 是上一次申報的，最新一次沒有
  // ☆：台灣政治人物表格裡的股票旁可以直接加自選
  await p.evaluate(() => { W.twoQ = "2382"; renderList(); });
  const had = await p.evaluate(() => inWatch("2382"));
  await p.click('#lx [data-wstar="2382"]');
  assert.equal(await p.evaluate(() => inWatch("2382")), !had);
  assert.equal(await p.evaluate(() => document.querySelector('#lx [data-wstar="2382"]').textContent), had ? "☆" : "★");
  // 個股情報徽章：2330 有 2 位政治人物持有、動能矩陣的區塊
  await p.evaluate(() => { const A = [{ id: "s1", name: "半導體", kind: "產業", n: 2, q: "up", q1: "up", net1: 1e8, prev1: 0, accel1: 1e8, net5: 5e9, prev5: 0, accel: 1e9, pct1: 1, pct5: 2, f1: 0, tr1: 0, f5: 0, tr5: 0, buy1: 2, buy5: 2 }];
    const mem = c => ({ code: c, name: "股" + c, pct: [1], px: [100], amt: [3], f: [1], tr: [1] });
    W.mf.days = [{ date: "2026-10-16", rows: [] }]; W.mf.model = { T: 1, dates: ["2026-10-16"], secs: [{ id: "s1", name: "半導體", kind: "產業", mem: [mem("2330"), mem("2454")] }] }; window.flowAt = () => A; });
  await p.evaluate(() => select("2330")); await p.waitForFunction(() => /2 位政治人物申報持有/.test($("#dIntel").innerText) && /半導體：↗ 強勢突破區/.test($("#dIntel").innerText), null, { timeout: 15000 });
  // 動能矩陣點圓點：下面直接列出成分股（含 ☆）
  await p.evaluate(() => { window.flowStocks = () => []; window.flowMood = () => null; showList(); setLt("money"); W.mf.view = "bubble"; W.mf.bsel = "s1"; W.mf.bw = "5"; renderList(); });
  assert.match(await p.evaluate(() => $("#lx .binfo").innerText), /成分股[\s\S]*股2330[\s\S]*完整成分股與排序/);
  assert.equal(await p.evaluate(() => document.querySelectorAll('#lx .binfo [data-wstar]').length), 2);
  // 範例投資組合：空的庫存一鍵載入、看得到範例提示、可以清除
  await p.evaluate(() => { W.hold = {}; W.holdMkt = "tw"; setLt("hold"); });
  await p.click('[data-hdemo="load"]'); await p.waitForTimeout(400);
  assert.ok(await p.evaluate(() => Object.keys(W.hold).length >= 5 && Object.values(W.hold).every(h => h.demo)));
  await p.waitForFunction(() => /目前是範例投資組合/.test($("#lx").innerText), null, { timeout: 15000 });
  await p.click('[data-hdemo="clear"]'); assert.equal(await p.evaluate(() => Object.keys(W.hold).length), 0);
  // 自選左欄：選中的個股有明顯底色
  await p.evaluate(() => { setLt("watch"); select(curList()[0]); });
  const bg = await p.evaluate(() => getComputedStyle(document.querySelector('#wl .row[aria-current="true"]')).backgroundColor);
  assert.notEqual(bg, "rgba(0, 0, 0, 0)");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("畫線練習：點在低點附近會吸到 K 棒低點、畫好後提示看答案", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 1280 });
  await p.evaluate(() => { dr.mode = "sup"; dr.src = "sim"; goTab("draw"); }); await p.waitForFunction(() => dr.D, null, { timeout: 15000 });
  const r = await p.evaluate(() => { dr.type = "sup"; const i = 20, low = dr.D[i].l; drTap(i + 0.5, low * 1.004); return [dr.pts[0][1], low, $("#drHint").textContent, $("#drCheck").disabled]; });
  assert.equal(r[0], r[1]); assert.match(r[2], /畫好了/); assert.equal(r[3], false);
  await ctx.close(); assert.deepEqual(errs, []);
});
