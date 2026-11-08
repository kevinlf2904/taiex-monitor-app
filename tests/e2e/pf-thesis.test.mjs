// 投資組合「論點」分頁：持股的近期事件（除權息、法說會、美股財報、論點檢視；只列持股）、寫論點、加檢視紀錄（狀態、下次檢視日）、
// 過期的檢視排最前面、存檔前檢查、備份匯入時用論點模組檢查；手機與桌面不溢出。全部固定假資料（行事曆、美股財報都用 mock）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 900, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const day = n => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10); // 台北日期往後 n 天
async function page(width) {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route("**/api/calendar**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: [{ date: day(12), code: "2330", name: "台積電", kind: "除息", cash: 5 }, { date: day(5), code: "9999", kind: "除息" }], conf: [{ date: day(7), code: "2330", time: "14:00", place: "台北" }], hol: [] }) }));
  await ctx.route("**/data/us-earn.json*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, at: new Date().toISOString(), rows: [[day(10), "NVDA", "NVIDIA", 4000, null, 1.2, null, "盤後", "Q3"], [day(10), "AAPL", "Apple", 3000, null, 2, null, "盤後", "Q4"]] }) }));
  await p.evaluate(tx => { localStorage.removeItem("kline:pf:thesis:v1"); W.cal = null; W.thD = null; /* 開頁時大盤可能已經用預設的假資料載入過行事曆 */ store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "thesis" }; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector("#lx .thev, #lx .thsum", { timeout: 30000 });
  await p.waitForFunction(() => /近期事件/.test($("#lx").innerText) && !/載入持股的除權息/.test($("#lx").innerText), null, { timeout: 30000 });
  return { ctx, p, errs };
}
const lx = p => p.evaluate(() => $("#lx").innerText);

for (const width of [390, 1280]) test(`論點分頁 ${width}：近期事件、寫論點、檢視紀錄、過期排前面`, async () => {
  const { ctx, p, errs } = await page(width);
  let t = await lx(p);
  assert.match(t, /已寫論點\s*0\/2/);
  // 逐筆比對事件（不能只找字：底下的說明也有「除權息」「法說會」這些字）
  const ev = await p.evaluate(() => [...document.querySelectorAll("#lx .thev li")].map(li => [li.querySelector(".thd").innerText, li.querySelector(".linkbtn").dataset.sel, li.querySelector(".thk").innerText]));
  assert.deepEqual(ev, [[day(7).slice(5), "2330", "法說會"], [day(10).slice(5), "NVDA", "財報（美股）"], [day(12).slice(5), "2330", "除權息"]]);
  assert.ok(await p.evaluate(() => [...document.querySelectorAll("#lx .thev .thd")].every(e => e.getBoundingClientRect().height < 30)), "日期一行");
  assert.doesNotMatch(t, /9999|Apple|AAPL/, "只列持股");
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  // 寫 2330 的論點
  await p.click('[data-th=edit][data-c="2330"]'); await p.waitForSelector("#thForm");
  await p.fill("#thForm [name=reason]", "先進製程領先、AI 需求"); await p.fill("#thForm [name=watch]", "毛利率\n\n海外廠進度"); await p.fill("#thForm [name=kill]", "毛利率連兩季低於 50%");
  await p.click("#thForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thForm"), null, { timeout: 10000 });
  const s1 = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:thesis:v1")));
  assert.equal(s1.items["2330"].reason, "先進製程領先、AI 需求"); assert.deepEqual(s1.items["2330"].watch, ["毛利率", "海外廠進度"]); assert.equal(s1.items["2330"].status, "hold");
  t = await lx(p); assert.match(t, /已儲存 .*的投資論點/); assert.match(t, /已寫論點\s*1\/2/); assert.match(t, /論點成立/);
  // 加檢視紀錄：狀態改成動搖，下次檢視 90 天後
  await p.click('[data-th=log][data-c="2330"]'); await p.waitForSelector("#thLogForm");
  await p.selectOption("#thLogForm [name=status]", "weak"); await p.fill("#thLogForm [name=note]", "毛利率季減 2 個百分點");
  await p.click("#thLogForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thLogForm"), null, { timeout: 10000 });
  const s2 = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:thesis:v1")).items["2330"]);
  assert.equal(s2.status, "weak"); assert.equal(s2.log.length, 1); assert.equal(s2.review, await p.evaluate(() => KLThesis.addDays(lgToday(), 90)));
  t = await lx(p); assert.match(t, /論點動搖/); assert.match(t, /最近檢視 .*毛利率季減 2 個百分點/); assert.match(t, /論點動搖／失效\s*1／0/);
  // 檢視日改成已過：排在近期事件最前面、標該檢視
  await p.evaluate(d => { const s = JSON.parse(localStorage.getItem("kline:pf:thesis:v1")); s.items["2330"].review = d; localStorage.setItem("kline:pf:thesis:v1", JSON.stringify(s)); renderList(); }, day(-3));
  const first = await p.evaluate(() => $("#lx .thev li").innerText); assert.match(first, /論點檢視/); assert.match(first, /已過 3 天/);
  assert.match(await lx(p), /該檢視\s*1/);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出（有內容後）");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("存檔前檢查擋下太長的內容；備份匯入要用論點模組檢查（沒有檢查程式不匯入）", async () => {
  const { ctx, p, errs } = await page(1280);
  await p.click('[data-th=edit][data-c="2330"]'); await p.waitForSelector("#thForm");
  await p.evaluate(() => { $("#thForm [name=reason]").removeAttribute("maxlength"); $("#thForm [name=reason]").value = "x".repeat(2001); });
  // fromForm 會截到 2000 字：仍然能存（不讓使用者打的字整段消失），但不會超過上限
  await p.click("#thForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thForm"), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:thesis:v1")).items["2330"].reason.length), 2000);
  const r = await p.evaluate(() => {
    const good = JSON.stringify({ v: 1, items: { 2330: { reason: "x", status: "hold" } } }), bad = JSON.stringify({ v: 1, items: { 2330: { status: "爆了" } } });
    return [KLLedger.checkBackup({ "kline:pf:thesis:v1": good }, { thesis: KLThesis }).ok, KLLedger.checkBackup({ "kline:pf:thesis:v1": bad }, { thesis: KLThesis }).ok, KLLedger.checkBackup({ "kline:pf:thesis:v1": good }, {}).ok,
      Object.keys(syncSnap(true)).includes("kline:pf:thesis:v1")];
  });
  assert.deepEqual(r, [true, false, false, true], "好的可以、壞的不行、沒有檢查程式不行；備份檔會帶論點");
  await ctx.close(); assert.deepEqual(errs, []);
});
