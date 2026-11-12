// 供應鏈題材內頁的「法人資金」：和資金雷達同一份模型、只有台股題材有、拿不到資料不顯示成 0；和資金雷達板塊細節互相連結
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const openTheme = (p, id) => p.evaluate(id => { showList(); W.indS.open = id; setLt("ind"); }, id);

for (const width of [390, 1280]) test(`題材內頁法人資金：數字、連到資金雷達再連回來 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  // 10 個交易日的假法人資料：tw-cowos 的代表股每天外資買 1000 張、投信買 500 張、收盤 100 → 每檔每天 1.5 億
  const n = await p.evaluate(() => {
    const T = INDT.get("tw-cowos"), codes = [...new Set(T.segs.flatMap(g => g.c.map(x => x[0])))];
    W.mf.days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(5 + i).padStart(2, "0")}`, rows: codes.map(c => [c, "測試" + c, 100, 1, 1000, 500, 0, 9000]) }));
    W.mf.model = null; return codes.length;
  });
  await openTheme(p, "tw-cowos"); await p.waitForSelector("[data-iflowbox] .bgrid");
  const txt = (await p.textContent("[data-iflowbox]")).replace(/\s+/g, " ");
  assert.match(txt, new RegExp(`代表股 ${n} 檔合計・10/14`));
  assert.match(txt, /不是整個產業/); assert.match(txt, /不能相加/);
  const A = await p.evaluate(() => flowAt(mfModel()).find(x => x.id === "tw-cowos"));
  assert.ok(Math.abs(A.net1 - 1.5 * n) < 1e-9 && Math.abs(A.net5 - 7.5 * n) < 1e-9, "和資金雷達同一份數字");
  assert.equal(await p.evaluate(() => document.querySelector("[data-iflowbox] .bgrid b").textContent), await p.evaluate(a => flowFmt(a), A.net1));
  assert.match(txt, new RegExp(`今日買超家數\\s*${n}／${n}`));
  assert.ok(await noHOverflow(p), "沒有橫向溢出");
  // → 資金雷達這個題材的板塊細節 → 題材內頁
  await p.click("[data-iflow]"); await p.waitForSelector(".gback [data-iopen-ext]");
  assert.deepEqual(await p.evaluate(() => [W.lt, W.mf.view, W.mf.sec]), ["money", "sector", "tw-cowos"]);
  await p.click(".gback [data-iopen-ext]"); await p.waitForSelector("[data-iflowbox]");
  assert.deepEqual(await p.evaluate(() => [W.lt, W.indS.open]), ["ind", "tw-cowos"]);
  // 美股題材沒有法人資料：不顯示這一塊
  const us = await p.evaluate(() => [...INDT.values()].find(t => t.mk === "us").id);
  await openTheme(p, us); await p.waitForSelector(".ihead"); assert.equal(await p.$("[data-iflowbox]"), null);
  assert.deepEqual(errs, []); await ctx.close();
});

test("題材內頁法人資金：沒載過會自己載；拿不到資料顯示原因，不顯示成 0", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  let hits = 0; await ctx.route("**/api/daily**", r => { hits++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "測試：來源暫時沒有回應" }) }); });
  await p.evaluate(() => { const F = W.mf; F.days = []; F.model = null; F.tried = new Set(); F.err = null; F.loading = false; F.indFlowTried = false; });
  await openTheme(p, "tw-cowos"); await p.waitForFunction(() => /拿不到法人資料/.test(document.querySelector("[data-iflowbox]")?.textContent || ""), null, { timeout: 15000 });
  assert.equal(await p.$("[data-iflowbox] .bgrid"), null, "沒有資料時不畫數字");
  const h1 = hits; await p.evaluate(() => { renderInd(); renderInd(); }); await p.waitForTimeout(300);
  assert.equal(hits, h1, "失敗後重畫不會一直重抓");
  assert.ok(h1 > 0 && h1 <= 4, `只試幾次就停（${h1}）`);
  assert.deepEqual(errs, []); await ctx.close();
});

// 來源有回資料、但法人欄位缺值（/api/daily 把缺值留成 null）：全部缺值顯示「—」與說明，不顯示 0；部分缺值寫出有幾檔有資料
for (const width of [390, 1280]) test(`題材內頁法人資金：法人欄位全部缺值、部分缺值 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  const setDays = fn => p.evaluate(src => { const f = eval(src), T = INDT.get("tw-cowos"), codes = [...new Set(T.segs.flatMap(g => g.c.map(x => x[0])))];
    W.mf.days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(5 + i).padStart(2, "0")}`, rows: codes.map((c, k) => f(c, k, i)) })); W.mf.model = null; return codes.length; }, `(${fn})`);
  // 全部缺值：有收盤與漲跌，三大法人都是 null
  const n = await setDays((c, k, i) => [c, "測試" + c, 100, 1, null, null, null, 9000]);
  await openTheme(p, "tw-cowos"); await p.waitForSelector("[data-iflowbox]");
  let txt = (await p.textContent("[data-iflowbox]")).replace(/\s+/g, " ");
  assert.match(txt, /都沒有法人資料/); assert.match(txt, /不是買賣超 0/);
  assert.equal(await p.$("[data-iflowbox] .bgrid"), null, "全部缺值時不畫數字"); assert.doesNotMatch(txt, /[+-]?0(\.0)?億/);
  // 只有今天缺值（前幾天有）：今日顯示「—」，近 5 日照有資料的日子加總
  await setDays((c, k, i) => (i === 9 ? [c, "測試" + c, 100, 1, null, null, null, 9000] : [c, "測試" + c, 100, 1, 1000, 500, 0, 9000]));
  await p.evaluate(() => renderInd()); await p.waitForSelector("[data-iflowbox] .bgrid");
  let cells = await p.$$eval("[data-iflowbox] .bgrid b", L => L.map(b => b.textContent));
  assert.equal(cells[0], "—", "今日法人淨額缺值"); assert.equal(cells[1], await p.evaluate(v => flowFmt(v), 1.5 * 4 * n)); assert.equal(cells[4], "—", "今日買超家數缺值");
  assert.match((await p.textContent(".iflowcov")).replace(/\s+/g, " "), new RegExp(`今日 0／${n} 檔、近 5 日 ${n}／${n} 檔`));
  // 部分股票缺值：第一檔整段沒有法人資料 → 寫出有幾檔有資料，買超家數的分母是有資料的檔數
  await setDays((c, k, i) => (k === 0 ? [c, "測試" + c, 100, 1, null, null, null, 9000] : [c, "測試" + c, 100, 1, 1000, 500, 0, 9000]));
  await p.evaluate(() => renderInd()); await p.waitForSelector(".iflowcov");
  cells = await p.$$eval("[data-iflowbox] .bgrid b", L => L.map(b => b.textContent));
  assert.equal(cells[0], await p.evaluate(v => flowFmt(v), 1.5 * (n - 1))); assert.equal(cells[4], `${n - 1}／${n - 1}`);
  assert.match((await p.textContent(".iflowcov")).replace(/\s+/g, " "), new RegExp(`今日 ${n - 1}／${n} 檔、近 5 日 ${n - 1}／${n} 檔`));
  // 外資有、投信缺：投信那一格是「—」
  await setDays((c, k, i) => [c, "測試" + c, 100, 1, 1000, null, 0, 9000]);
  await p.evaluate(() => renderInd()); await p.waitForSelector("[data-iflowbox] .bgrid");
  cells = await p.$$eval("[data-iflowbox] .bgrid b", L => L.map(b => b.textContent));
  assert.notEqual(cells[2], "—"); assert.equal(cells[3], "—", "投信 5 日缺值");
  assert.equal(await p.$(".iflowcov"), null, "資料齊全時不顯示覆蓋率");
  assert.ok(await noHOverflow(p)); assert.deepEqual(errs, []); await ctx.close();
});
