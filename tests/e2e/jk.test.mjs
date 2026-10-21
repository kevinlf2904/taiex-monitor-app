// 日股、韓股：產業地圖的 6981.T、005930.KS 這類代號可以抓報價、開個股頁；首頁「回到最上面」按鈕；嵌入的看盤頁自己不捲動
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("日股、韓股報價與個股頁", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  assert.deepEqual(await p.evaluate(() => ["6981.T", "005930.KS", "000660.KQ", "2330", "AAPL"].map(c => [okCode(c), indQuotable(c)])), [[true, true], [true, true], [true, true], [true, true], [true, true]]);
  const seen = []; p.on("request", q => { if (q.url().includes("/api/quote")) seen.push(decodeURIComponent(q.url())); });
  await p.evaluate(() => { showList(); setLt("ind"); W.indS.open = "jp-mlcc"; renderList(); });
  await p.waitForFunction(() => W.quotes.get("6981.T")?.price != null, null, { timeout: 15000 });
  assert.ok(seen.some(u => u.includes("6981.T")), "產業地圖的日股有去抓報價");
  await p.evaluate(() => select("005930.KS")); await p.waitForFunction(() => W.sel === "005930.KS");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("首頁：往下捲出現「回到最上面」，嵌入的看盤頁不自己捲動", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html#congress", { width: 390, touch: true });
  await p.waitForTimeout(2500); // #congress 會先捲到情報區（看內容高度，可能已超過門檻），先回到最上面再測
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForFunction(() => document.getElementById("toTop").hidden);
  await p.evaluate(() => scrollTo(0, 900)); await p.waitForFunction(() => !document.getElementById("toTop").hidden);
  await p.click("#toTop"); await p.waitForFunction(() => scrollY === 0, null, { timeout: 5000 });
  const f = p.frames().find(x => x.url().includes("watch.html"));
  assert.equal(await f.evaluate(() => getComputedStyle(document.documentElement).overflowY), "hidden");
  assert.equal(await p.getAttribute("#watchFrame", "scrolling"), "no");
  await ctx.close(); assert.deepEqual(errs, []);
});
