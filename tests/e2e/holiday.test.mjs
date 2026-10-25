// 休市日判斷：平日的國定假日不跑每秒的報價；休市日表抓不到時 30 秒一次、頁首寫「交易日待確認」；正常交易日照舊每秒；報價佐證確認開盤後恢復
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

// 呼叫 fn（schedule 或 liveSchedule）時排的第一個計時器是幾毫秒
const delayOf = (p, fn) => p.evaluate(fn => { const st = window.setTimeout; let ms = null; window.setTimeout = (f, d, ...a) => { if (ms == null) ms = d; return st(f, d, ...a); }; try { window[fn](); } finally { window.setTimeout = st; } return ms; }, fn);
const setHol = (p, hol) => p.evaluate(hol => { Object.assign(TWHOL, { set: null, year: "", mark: null, failAt: Date.now() }); if (hol) twHolSet(hol); }, hol);

test("看盤：交易日每秒、國定假日 5 分鐘、休市日表抓不到 30 秒並標示待確認，報價佐證開盤後恢復每秒 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-27T10:00:00+08:00")); // 週二 10:00
  await setHol(p, [{ date: "2026-01-01", name: "開國紀念日" }]);
  assert.equal(await p.evaluate(() => twDayState()), "trade"); assert.equal(await delayOf(p, "schedule"), 1000, "正常交易日：照舊每秒");
  await setHol(p, [{ date: "2026-01-01", name: "開國紀念日" }, { date: "2026-10-27", name: "測試假日" }]);
  assert.equal(await p.evaluate(() => mktSession()), "closed"); assert.equal(await delayOf(p, "schedule"), 300000, "國定假日：和週末一樣 5 分鐘");
  await setHol(p, [{ date: "2026-01-01", name: "開國紀念日" }, { date: "2026-10-27", name: "國曆新年開始交易日" }]);
  assert.equal(await delayOf(p, "schedule"), 1000, "「開始交易日」有開盤");
  await setHol(p, null); // 表抓不到
  assert.equal(await p.evaluate(() => twDayState()), "unknown"); assert.equal(await delayOf(p, "schedule"), 30000, "不知道有沒有開盤：不跑每秒，30 秒一次");
  await p.evaluate(() => { W.session = "open"; W.err = null; renderTop(); });
  assert.equal(await p.textContent("#statText"), "交易日待確認"); assert.equal(await p.evaluate(() => $("#dot").classList.contains("on")), false, "不顯示盤中即時的紅點");
  // 報價佐證：加權的報價日期是今天（測試報價的日期是 2026-10-05，所以把時間調到那天）→ 確定開盤、恢復每秒
  await p.clock.setFixedTime(new Date("2026-10-05T10:00:00+08:00")); await setHol(p, null);
  await p.evaluate(() => pollList());
  assert.equal(await p.evaluate(() => twDayState()), "trade"); assert.equal(await delayOf(p, "schedule"), 1000);
  await p.evaluate(() => { renderTop(); }); assert.notEqual(await p.textContent("#statText"), "交易日待確認");
  await p.evaluate(() => clearTimeout(W.timer));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("休市日表抓不到、09:10 後加權報價還停在前一天（颱風假這類臨時休市）：當成沒開盤，降到 5 分鐘 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/quote**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", session: "open", today: "2026-10-06", quotes: [{ code: "T00", name: "加權指數", price: 100, prev: 101, chg: -1, chgPct: -1, date: "2026-10-05", time: "13:30:00" }] }) }));
  await p.clock.setFixedTime(new Date("2026-10-06T09:05:00+08:00")); await setHol(p, null);
  await p.evaluate(() => pollList()); assert.equal(await p.evaluate(() => twDayState()), "unknown", "09:10 之前不下結論");
  await p.clock.setFixedTime(new Date("2026-10-06T09:20:00+08:00"));
  await p.evaluate(() => pollList()); assert.equal(await p.evaluate(() => twDayState()), "closed"); assert.equal(await delayOf(p, "schedule"), 300000);
  await p.evaluate(() => clearTimeout(W.timer));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("首頁即時列：國定假日 5 分鐘一次，交易日 10 秒（照舊） 1280", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 1280 });
  await p.clock.setFixedTime(new Date("2026-10-27T10:00:00+08:00"));
  await p.evaluate(() => { LIVE.off = false; });
  await setHol(p, [{ date: "2026-01-01", name: "開國紀念日" }]); assert.equal(await delayOf(p, "liveSchedule"), 10000);
  await setHol(p, [{ date: "2026-01-01", name: "開國紀念日" }, { date: "2026-10-27", name: "測試假日" }]); assert.equal(await delayOf(p, "liveSchedule"), 300000);
  await p.evaluate(() => { clearTimeout(LIVE.timer); LIVE.off = true; });
  await ctx.close(); assert.deepEqual(errs, []);
});
