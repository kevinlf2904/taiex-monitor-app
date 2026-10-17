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
  await p.click('#lx [data-rkset="cbtv:pnl"]'); await p.click('#lx [data-cpl="sort:loss"]'); const who = await p.$eval('#lx [data-cpl^="who:"]', b => b.dataset.cpl); await p.click(`#lx [data-cpl="${who}"]`);
  assert.equal(await p.evaluate(() => W.cpl.who), who.slice(4));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("台灣政治人物持股損益", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { setLt("cong"); W.cv = "tw"; renderList(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { const b = $('#lx [data-twbt="1"]'); b.closest("details").open = true; }); await p.click('#lx [data-twbt="1"]'); await p.waitForFunction(() => W.twoBt && !W.twoBt.busy, null, { timeout: 30000 });
  const x = await p.evaluate(() => { const P = twoPeople().find(p => p.pid === "王小明"), X = twoPnl(P); return { n: X.ok.length, pnl: X.pnl, sum: X.ok.reduce((a, r) => a + r.sh * (r.p1 - r.p0), 0), d0: X.ok.map(r => r.d0) }; });
  assert.equal(x.n, 2); assert.ok(Math.abs(x.pnl - x.sum) < 1e-6); assert.ok(x.d0.every(d => d > "2026-06-29"));
  await p.evaluate(() => { W.cv = "tw:p:王小明"; renderList(); }); await p.waitForTimeout(500);
  assert.match(await p.evaluate(() => $("#lx").innerText), /持股損益/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("台灣政治人物：持股市值排行、分類、億萬、個人頁", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { W.cv = "tw"; setLt("cong"); });
  await p.waitForFunction(() => document.querySelectorAll(".tw-rank li").length === 2 && /NT\$ [1-9]/.test($(".tw-rank").innerText), null, { timeout: 20000 });
  const vals = await p.evaluate(() => [...document.querySelectorAll(".tw-rank .tw-v b")].map(b => +b.textContent.replace(/[^\d]/g, "")));
  assert.ok(vals[0] >= vals[1], "依市值排序");
  await p.click('[data-twamt="short"]'); await p.waitForTimeout(150); assert.match(await p.evaluate(() => $(".tw-rank").innerText), /萬/);
  await p.click('.tw-ctl [data-twgrp="ly"]'); await p.waitForTimeout(150); assert.equal(await p.evaluate(() => document.querySelectorAll(".tw-rank li").length), 1);
  await p.click(".tw-rank li button"); await p.waitForSelector(".tw-p .tw-top");
  assert.match(await p.evaluate(() => $(".tw-p").innerText), /股票市值[\s\S]*張[\s\S]*持股[\s\S]*變動紀錄/);
  await p.click('[data-twtab="chg"]'); await p.waitForTimeout(150); assert.match(await p.evaluate(() => $(".tw-p").innerText), /差額/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("申報歷史：國會全部期間與月份、內部人期間、台灣政治人物歷次申報", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => setLt("cong")); await p.waitForFunction(() => W.cong?.trades?.length, null, { timeout: 15000 });
  await p.evaluate(() => { W.cv = "home"; W.cview = "feed"; renderList(); });
  await p.click('#lx [data-cw="0"]'); await p.waitForTimeout(200);
  assert.match(await p.evaluate(() => $(".tw-sums").innerText), /全部期間/);
  const mons = await p.evaluate(() => [...document.querySelectorAll('#lx [data-rkset^="cmon:"]')].map(b => b.dataset.rkset));
  assert.ok(mons.length > 2, "要能按月份往前翻");
  await p.click(`#lx [data-rkset="${mons.at(-1)}"]`); await p.waitForTimeout(200);
  assert.match(await p.evaluate(() => $("#lx h4").innerText), /公開的交易/);
  // 台灣政治人物：有兩次申報的人可以切換
  await p.evaluate(() => { W.cv = "tw:p:王小明"; renderList(); }); await p.waitForSelector(".tw-p");
  const n = await p.evaluate(() => document.querySelectorAll('[data-rkset^="twoDi:"]').length);
  if (n > 1) { await p.click('[data-rkset="twoDi:1"]'); await p.waitForTimeout(200); assert.match(await p.evaluate(() => $(".tw-tabs").innerText), /持股（/); }
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});
