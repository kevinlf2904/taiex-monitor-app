// 交易紀錄 →「績效」：重點數字、淨值走勢與比較基準、回撤、月報酬表、歸因、估算原因；日期範圍切換；圖上提示；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [
  { id: "a", v: 1, date: "2025-01-06", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 100, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2025-03-03", type: "transfer_in", symbol: "2317", market: "tw", currency: "TWD", shares: 2000, price: 90, fee: 0, tax: 0, source: "legacy" },
  { id: "c", v: 1, date: "2025-07-10", type: "dividend", symbol: "2330", market: "tw", currency: "TWD", amount: 3000 },
  { id: "d", v: 1, date: "2026-02-02", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 400, price: 110, fee: 0, tax: 0 },
  { id: "e", v: 1, date: "2025-05-05", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];

test("績效頁：重點數字、走勢、回撤、月報酬、歸因、估算原因；範圍切換與提示", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "2026-11-01" }); W.lg = { view: "perf" }; W.lgPx = null; W.holdView = "tx"; setLt("hold"); }, TX);
    await p.waitForSelector(".pfcard", { timeout: 30000 });
    let t = await p.evaluate(() => $("#lx").innerText);
    assert.match(t, /台股（台幣）/); assert.match(t, /美股（美元）/);
    for (const k of ["總損益", "時間加權報酬", "資金加權報酬", "最大回撤", "相對比較基準", "月報酬", "誰賺誰賠", "計算口徑"]) assert.match(t, new RegExp(k), width + "：" + k);
    assert.match(t, /估算/); assert.match(t, /舊庫存轉入/); assert.match(t, /加權指數（價格指數，不含股息）/);
    assert.equal(await p.evaluate(() => document.querySelectorAll(".pfline").length >= 2), true, "組合與比較基準兩條線");
    // 日期範圍：3 個月
    await p.click('[data-lg=range][data-v="3m"]'); await p.waitForSelector('[data-lg=range][data-v="3m"][aria-pressed="true"]');
    const d0 = await p.evaluate(() => document.querySelector(".pfdates span").textContent); assert.ok(d0 >= "2026-06-01", "3 個月的起點：" + d0);
    // 圖上提示
    await p.$eval(".pfplot", el => el.scrollIntoView({ block: "center" })); const box = await (await p.$(".pfplot")).boundingBox(); await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    t = await p.evaluate(() => document.querySelector(".pftip:not([hidden])")?.innerText || ""); assert.match(t, /我的組合[\s\S]*回撤[\s\S]*市值/);
    // 切回交易紀錄
    await p.click('[data-lg=view][data-v="tx"]'); await p.waitForSelector("[data-lg=add]");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("手機觸控：手指點、左右拖曳顯示提示；在圖上上下滑仍然捲動頁面（真的觸控輸入，不是滑鼠）", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "2026-11-01" }); W.lg = { view: "perf" }; W.lgPx = null; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector(".pfcard", { timeout: 30000 });
  await p.$eval(".pfplot", el => el.scrollIntoView({ block: "center" }));
  const cdp = await ctx.newCDPSession(p), box = await (await p.$(".pfplot")).boundingBox(), y = box.y + box.height / 2;
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, yy]) => ({ x, y: yy })) });
  await touch("touchStart", [[box.x + box.width * 0.3, y]]);
  const t1 = await p.evaluate(() => document.querySelector(".pftip:not([hidden])")?.innerText || ""); assert.match(t1, /我的組合/, "點一下就出現提示");
  for (let k = 1; k <= 5; k++) await touch("touchMove", [[box.x + box.width * (0.3 + k * 0.1), y]]);
  const t2 = await p.evaluate(() => document.querySelector(".pftip:not([hidden])")?.innerText || ""); assert.notEqual(t2.split("\n")[0], t1.split("\n")[0], "左右拖曳換日期");
  await touch("touchEnd", []);
  // 上下滑：頁面（或捲動容器）要捲動
  const scrolled = () => p.evaluate(() => [document.scrollingElement, ...document.querySelectorAll("*")].reduce((s, el) => s + (el?.scrollTop || 0), 0));
  const before = await scrolled();
  await touch("touchStart", [[box.x + box.width / 2, y]]); for (let k = 1; k <= 8; k++) await touch("touchMove", [[box.x + box.width / 2, y - k * 25]]); await touch("touchEnd", []);
  await p.waitForTimeout(400);
  assert.ok(await scrolled() > before + 20, "在圖上上下滑可以捲動");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("績效狀態：合股零股未結算 → 頁面寫出「待確認」；另計匯費與未歸屬費用顯示", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  const T2 = [{ id: "a", v: 1, date: "2025-01-06", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1001, price: 100, fee: 0, tax: 0 },
    { id: "s", v: 1, date: "2025-06-02", type: "split", symbol: "2330", market: "tw", currency: "TWD", ratio: 0.1 },
    { id: "d", v: 1, date: "2025-07-10", type: "dividend", symbol: "2330", market: "tw", currency: "TWD", amount: 3000 },
    { id: "f", v: 1, date: "2025-07-10", type: "fee", market: "tw", currency: "TWD", amount: 10, ref: "d" },
    { id: "g", v: 1, date: "2025-08-01", type: "fee", market: "tw", currency: "TWD", amount: 5 }];
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "perf" }; W.lgPx = null; W.holdView = "tx"; setLt("hold"); }, T2);
  await p.waitForSelector(".pfcard", { timeout: 30000 });
  const t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /待確認：有部位合股後的零股還沒結算/); assert.match(t, /零股還沒結算/); assert.match(t, /其中另計費用/); assert.match(t, /沒有對應到個股的費用或現金：-5/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("績效狀態：「資料不足」（零成本部位轉出又沒有價格）、「無法計算」（現金流證明不了唯一解）都清楚標示，不顯示看起來有效的數字", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  // 9999：沒有任何價格；9998：固定價格，現金流 −100、+230、−140、最後市值 5（唯一解證明不了）
  await ctx.route("**/api/kline?code=9999**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: "mock" }) }));
  await ctx.route("**/api/kline?code=9998**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "9998", data: [["2026-03-02", 100], ["2026-03-03", 230], ["2026-03-04", 140], ["2026-03-05", 5]].map(([d, c]) => ({ d, o: c, h: c, l: c, c, v: 1 })) }) }));
  const run = async tx => { await p.evaluate(t => { store.set("pf:v1", { v: 1, method: "avg", transactions: t, at: "x" }); W.lg = { view: "perf" }; W.lgPx = null; W.holdView = "tx"; setLt("hold"); renderList(); }, tx); await p.waitForFunction(() => document.querySelector(".pfcard") || /沒有可以計算/.test($("#lx").innerText), null, { timeout: 30000 }).catch(async e => { throw new Error(e.message + " | " + await p.evaluate(() => $("#lx").innerText.slice(0, 300))); }); return p.evaluate(() => $("#lx").innerText); };
  let t = await run([{ id: "s", v: 1, date: "2026-03-02", type: "stock_dividend", symbol: "9999", market: "tw", currency: "TWD", shares: 10 }, { id: "o", v: 1, date: "2026-03-03", type: "transfer_out", symbol: "9999", market: "tw", currency: "TWD", shares: 10 }]);
  assert.match(t, /資料不足，無法計算/); assert.doesNotMatch(t, /時間加權報酬\s*\n?\s*[+-]\d/, "時間加權報酬不顯示數字"); assert.doesNotMatch(t, /期間內沒有回撤|-0\b|^～/m, "沒有資料時不能寫「沒有回撤」或 −0");
  t = await run([{ id: "a", v: 1, date: "2026-03-02", type: "buy", symbol: "9998", market: "tw", currency: "TWD", shares: 1, price: 100, fee: 0, tax: 0 },
    { id: "b", v: 1, date: "2026-03-03", type: "sell", symbol: "9998", market: "tw", currency: "TWD", shares: 1, price: 230, fee: 0, tax: 0 },
    { id: "c", v: 1, date: "2026-03-04", type: "buy", symbol: "9998", market: "tw", currency: "TWD", shares: 1, price: 140, fee: 0, tax: 0 }]);
  assert.match(t, /資金加權報酬無法計算/); assert.match(t, /無法計算/);
  const mw = await p.evaluate(() => [...document.querySelectorAll(".pftile")].find(x => /資金加權報酬/.test(x.innerText))?.querySelector("b")?.textContent); assert.equal(mw, "—", "資金加權報酬不顯示數字");
  await ctx.close(); assert.deepEqual(errs, []);
});
