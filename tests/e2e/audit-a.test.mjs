// 稽核修正 A 批（Gemini Spark／Antigravity 報告查證後）：資金雷達空資料、盤前資料標示、快捷選單焦點、圖表讀螢幕說明、
// 搜尋清除鈕、離線提示可關、雲端同步入口、圖表實驗室資料來源標示、課後去實驗室、存股 A／B 相同時的說明
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("資金雷達：載完卻沒有任何交易日資料時，說找不到並給「重新載入」，不會一直顯示載入中", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/daily?date=**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, empty: true, rows: [] }) }));
  await p.evaluate(() => { W.mf.days = []; W.mf.tried = new Set(); W.mf.model = null; W.mf.err = null; W.mf.loading = false; setLt("money"); });
  await p.waitForFunction(() => /找不到最近交易日的法人資料/.test(document.querySelector("#lx")?.textContent || ""), null, { timeout: 15000 });
  assert.ok(await p.$('#lx [data-gx="mfRefresh"]'), "有重新載入鈕");
  await p.evaluate(() => { W.mf.err = "HTTP 500"; renderList(); });
  assert.match(await p.textContent("#lx"), /法人資料載入失敗：HTTP 500/);
  assert.ok(await p.$('#lx [data-gx="mfRefresh"]'), "失敗時也有重新載入鈕");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("盤前：加權是前一交易日收盤時標示「前一交易日收盤」，更舊才是「過期資料」", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  const r = await p.evaluate(() => { const tx = d => ({ market: { taiex: { price: 23000, close: 23000, high: 23100, low: 22900, chgPct: 0.5, date: d, source: "twse" } }, session: "pre", tradeDate: "2026-10-27", now: Date.parse("2026-10-27T08:00:00+08:00") });
    const a = evaluateDataStatus(tx("2026-10-26")), b = evaluateDataStatus(tx("2026-10-21")), h = evaluateDataStatus({ ...tx("2026-10-23"), tradeDate: "2026-10-27", holidays: [{ date: "2026-10-26" }] });
    return [a.dataStatusLabel, a.dataStatus, b.dataStatusLabel, h.dataStatusLabel]; });
  assert.deepEqual(r, ["前一交易日收盤", "stale", "過期資料", "前一交易日收盤"]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("快捷選單：Tab 只在選單裡繞，Esc 關掉後焦點回到「選單」按鈕；選單有備份與雲端同步入口", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.focus("#menuBtn"); await p.keyboard.press("Enter"); await p.waitForSelector("#sheet:not([hidden])");
  const inSheet = () => p.evaluate(() => $("#sheet").contains(document.activeElement));
  await p.keyboard.press("Shift+Tab"); assert.equal(await inSheet(), true, "從第一個往回到最後一個");
  for (let i = 0; i < 25; i++) { await p.keyboard.press("Tab"); assert.equal(await inSheet(), true, "Tab 第 " + (i + 1) + " 次還在選單裡"); }
  await p.keyboard.press("Escape");
  assert.equal(await p.evaluate(() => document.activeElement?.id), "menuBtn");
  await p.click("#menuBtn"); await p.click('#sheet [data-m="sync"]');
  assert.deepEqual(await p.evaluate(() => [W.lt, W.tv, $("#sheet").hidden]), ["tools", "sync", true]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("個股圖表：分時圖與 K 線圖的讀螢幕說明含股票名稱", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => select("2330")); await p.waitForTimeout(1200);
  const ts = await p.getAttribute("#tsCanvas", "aria-label"); assert.match(ts, /當日分時走勢/); assert.ok(ts.includes(await p.evaluate(() => nameOf("2330"))), ts);
  await p.evaluate(() => setDtab?.("tech")); await p.waitForTimeout(1200);
  const k = await p.evaluate(() => document.querySelector("#kChart canvas[aria-label]")?.getAttribute("aria-label"));
  assert.match(k, /2330.*K線圖|K線圖/); assert.ok(k.includes(await p.evaluate(() => nameOf("2330"))), k);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("搜尋：有字才出現清除鈕，按了清空並留在輸入框", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => gsOpen()); await p.waitForSelector("#gsearch:not([hidden])");
  assert.equal(await p.isVisible("#gsClear"), false);
  await p.fill("#gsInput", "台積"); assert.equal(await p.isVisible("#gsClear"), true);
  const box = await p.$eval("#gsClear", b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }); assert.ok(box[0] >= 36 && box[1] >= 36, "清除鈕夠大：" + box);
  await p.click("#gsClear");
  assert.deepEqual(await p.evaluate(() => [$("#gsInput").value, document.activeElement?.id, $("#gsClear").hidden]), ["", "gsInput", true]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("離線提示：可以按 × 關掉，這次離線期間不再跳出；連回網路後下次離線會再提示", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.setOffline(true); await p.waitForSelector("#netBar", { timeout: 6000 });
  await p.click('#netBar button[aria-label="關閉離線提示"]'); assert.equal(await p.$("#netBar"), null);
  await p.evaluate(() => dispatchEvent(new Event("offline"))); await p.waitForTimeout(3500); assert.equal(await p.$("#netBar"), null, "關掉後同一段離線不再跳");
  await ctx.setOffline(false); await p.waitForTimeout(300);
  await ctx.setOffline(true); await p.waitForSelector("#netBar", { timeout: 6000 });
  await ctx.setOffline(false); await ctx.close(); assert.deepEqual(errs, []);
});

test("K線學堂：圖表實驗室的圖上方標出模擬或真實資料；每課最後有「去圖表實驗室試試」", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 390, touch: true });
  await p.evaluate(() => goTab("lab")); await p.waitForSelector("#view-lab:not([hidden])");
  assert.match(await p.textContent("#labSrcNote"), /模擬走勢（電腦隨機產生，不是真實股價）/);
  const order = await p.evaluate(() => !!($("#labSrcNote").compareDocumentPosition($("#labChart")) & Node.DOCUMENT_POSITION_FOLLOWING)); assert.equal(order, true);
  await p.evaluate(() => goTab("learn")); await p.waitForSelector("#view-learn:not([hidden])");
  await p.click("#lessonLab"); await p.waitForSelector("#view-lab:not([hidden])");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("存股：A 和 B 的假設年化都一樣時，畫面說明為什麼結果相同；改了衛星年化就不顯示", async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 390, touch: true }); await p.waitForTimeout(500);
  assert.match(await p.textContent("#ledger-lead"), /A 和 B 結果一樣，是因為.*假設年化都是 8%/);
  await p.evaluate(() => { const a = ASSETS.find(x => x.id === G.sat); a.r = 12; renderAll(); });
  assert.equal(await p.$("#sav-same"), null);
  await ctx.close(); assert.deepEqual(errs.filter(e => !/Failed to load resource/.test(e)), []);
});
