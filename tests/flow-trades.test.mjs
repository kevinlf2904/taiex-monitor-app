// 盤中逐筆成交分頁（#262 FIN-01、#264 C2）：富果由新到舊、用 offset 分頁。盤中新成交會插在最前面讓後面幾頁位移、
// 換日要丟掉舊的暫存、抓到上限接不上舊的不能說「完整」、頁長要用伺服器的原始筆數。全部用假的富果，不連外。
import test from "node:test";
import assert from "node:assert/strict";
import { fetchTrades, _resetFlowMemo } from "../api/_lib/flow.js";

const T0 = Date.parse("2026-11-11T01:00:00Z"); // 台北 09:00
// 第 i 筆成交（i 越大越新）：時間（微秒）、價、量、序號
const mk = (i, o = {}) => ({ time: (T0 + i * 1000) * 1000, price: 100 + (i % 7), size: 1 + (i % 5), bid: 99, ask: 101, serial: i, ...o });
// 假的富果：book 是「由舊到新」的陣列，回的是由新到舊；hooks[n] 在第 n 次呼叫前執行（模擬盤中新成交進來）
function fakeFugle(book, { date = "2026-11-11", hooks = {}, bad = new Set() } = {}) {
  const log = [];
  const fn = async url => {
    const q = new URL(url).searchParams, limit = +q.get("limit"), offset = +q.get("offset"); log.push(offset);
    if (hooks[log.length - 1]) hooks[log.length - 1](book);
    const newest = book.slice().reverse().slice(offset, offset + limit).map(x => (bad.has(x.serial) ? { ...x, price: null } : x));
    return { date, data: newest };
  };
  return { fn, log, book };
}
const ids = r => r.trades.map(t => `${t.t}|${t.serial}`);

test("基本：1,200 筆分 3 頁抓完，由舊到新、沒有重複、標完整", async () => {
  _resetFlowMemo();
  const f = fakeFugle(Array.from({ length: 1200 }, (_, i) => mk(i))), r = await fetchTrades("2330", "k", f.fn);
  assert.equal(r.trades.length, 1200); assert.equal(r.complete, true); assert.equal(r.date, "2026-11-11");
  assert.equal(new Set(ids(r)).size, 1200, "沒有重複"); assert.ok(r.trades[0].t < r.trades[1199].t, "由舊到新");
  assert.deepEqual(f.log, [0, 500, 1000]);
});

test("翻頁中途有新成交插進來：同一筆不重複算；下一次補到那幾筆", async () => {
  _resetFlowMemo();
  // 抓第 1 頁之後（第 2 次呼叫前）新增 30 筆：原本第 1 頁的最後 30 筆被擠到第 2 頁的前面
  const f = fakeFugle(Array.from({ length: 1200 }, (_, i) => mk(i)), { hooks: { 1: book => { for (let i = 1200; i < 1230; i++) book.push(mk(i)); } } });
  const r1 = await fetchTrades("2330", "k", f.fn);
  assert.equal(r1.trades.length, 1200, "只算這次看到的、不重複：" + r1.trades.length); assert.equal(new Set(ids(r1)).size, 1200);
  const r2 = await fetchTrades("2330", "k", f.fn); // 第二次：只補最新的
  assert.equal(r2.trades.length, 1230); assert.equal(new Set(ids(r2)).size, 1230); assert.equal(r2.complete, true);
  assert.ok(r2.trades.every((t, i, a) => !i || a[i - 1].t <= t.t), "還是由舊到新");
  assert.ok(f.log.slice(3).length <= 3, "第二次只抓最前面幾頁：" + f.log.join());
});

test("頁長用伺服器回的原始筆數：中間有幾列沒有價格被濾掉，不影響翻頁與完整判斷", async () => {
  _resetFlowMemo();
  const f = fakeFugle(Array.from({ length: 1000 }, (_, i) => mk(i)), { bad: new Set([990, 991, 992, 993, 994, 995, 996, 997, 998, 999]) }); // 第 1 頁（最新 500 筆）有 10 列沒價格
  const r = await fetchTrades("2330", "k", f.fn);
  assert.equal(r.trades.length, 990, "沒價格的略過"); assert.equal(new Set(ids(r)).size, 990);
  assert.deepEqual(f.log, [0, 500, 1000], "offset 照原始筆數 500 往後翻（原本會用濾完的 490）");
  assert.equal(r.complete, true);
});

test("抓到上限（16 頁）還沒碰到上一次存的資料：不接舊的、不標完整", async () => {
  _resetFlowMemo();
  const book = Array.from({ length: 100 }, (_, i) => mk(i)), f = fakeFugle(book);
  const r1 = await fetchTrades("2330", "k", f.fn); assert.equal(r1.complete, true); assert.equal(r1.trades.length, 100);
  for (let i = 100; i < 9100; i++) book.push(mk(i)); // 之後一口氣多了 9,000 筆（超過 16 頁＝8,000 筆）
  const r2 = await fetchTrades("2330", "k", f.fn);
  assert.equal(r2.trades.length, 8000, "只有最新的 8,000 筆，不接上舊的 100 筆（中間有缺口）");
  assert.equal(r2.complete, false, "沒到清單盡頭、也沒接上舊的：不能說完整");
  assert.equal(new Set(ids(r2)).size, 8000);
});

test("換日：前一天的暫存不能用，也不能繼承「完整」", async () => {
  _resetFlowMemo();
  const f1 = fakeFugle(Array.from({ length: 50 }, (_, i) => mk(i)), { date: "2026-11-10" }); await fetchTrades("2330", "k", f1.fn);
  // 隔天：只有 3 筆，而且 key 和前一天的某幾筆一模一樣（同樣的時間、序號）也不能被當成「已經有了」
  const f2 = fakeFugle(Array.from({ length: 3 }, (_, i) => mk(i)), { date: "2026-11-11" }), r = await fetchTrades("2330", "k", f2.fn);
  assert.equal(r.date, "2026-11-11"); assert.equal(r.trades.length, 3, "不含前一天的 50 筆");
  assert.equal(r.complete, true, "這次自己抓到清單盡頭");
});

test("沒有資料、伺服器回空：不出錯，標完整（0 筆）", async () => {
  _resetFlowMemo();
  const r = await fetchTrades("2330", "k", fakeFugle([]).fn); assert.deepEqual([r.trades.length, r.complete], [0, true]);
});
