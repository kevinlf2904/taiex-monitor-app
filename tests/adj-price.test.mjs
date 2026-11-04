// 還原股價（api/_lib/kline.js 的 parseYahooEvents、adjustRows）：除息、分割（0050 一拆四）、除息日不是交易日、不合理股息、Yahoo 已調整分割的價格。固定假資料，不連外部服務。
import test from "node:test";
import assert from "node:assert/strict";
import { parseYahooEvents, adjustRows, parseRefPrices } from "../api/_lib/kline.js";

const ts = d => Date.parse(d + "T01:00:00Z") / 1000 - 28800 + 3600; // 台北當天早上
const R = (pairs) => pairs.map(([d, c]) => ({ d, o: c, h: c, l: c, c, v: 1 }));
const near = (a, b, t = 1e-3) => Math.abs(a - b) < t;

test("Yahoo 事件：除息金額、分割比例、日期換成台北日期；壞資料略過", () => {
  const j = { chart: { result: [{ meta: { gmtoffset: 28800 }, events: {
    dividends: { a: { amount: 1.5, date: ts("2026-07-16") }, b: { amount: 0, date: ts("2026-01-02") }, c: { amount: "x", date: 1 } },
    splits: { s: { date: ts("2025-06-18"), numerator: 4, denominator: 1, splitRatio: "4:1" }, t: { date: ts("2025-01-02"), numerator: 1, denominator: 1 } } } }] } };
  assert.deepEqual(parseYahooEvents(j), [{ d: "2025-06-18", kind: "split", r: 4 }, { d: "2026-07-16", kind: "div", amt: 1.5 }]);
  assert.deepEqual(parseYahooEvents({ chart: { result: [{ meta: {} }] } }), []);
  assert.equal(parseYahooEvents({}), null);
});

test("除息：除息日以前的價格乘上 1 − 股息 ÷ 前收盤；最後一根等於原始價；除息日的還原報酬等於含息報酬", () => {
  const rows = R([["2026-07-14", 100], ["2026-07-15", 102], ["2026-07-16", 99], ["2026-07-17", 100]]);
  const A = adjustRows(rows, [{ d: "2026-07-16", kind: "div", amt: 3 }]);
  const f = 1 - 3 / 102;
  assert.ok(near(A.rows[0].ac, 100 * f)); assert.ok(near(A.rows[1].ac, 102 * f)); assert.equal(A.rows[2].ac, 99); assert.equal(A.rows[3].ac, 100);
  assert.ok(near(A.rows[2].ac / A.rows[1].ac - 1, (99 + 3) / 102 - 1, 1e-5), "含息報酬");
  assert.equal(A.rows[1].c, 102, "原始收盤不動（K 線圖用）"); assert.equal(rows[0].ac, undefined, "不改動傳進來的資料");
  assert.deepEqual(A.events.map(e => [e.d, e.kind]), [["2026-07-16", "div"]]);
});

test("除息日剛好不是交易日（或缺資料）：算在下一個交易日", () => {
  const rows = R([["2026-07-14", 100], ["2026-07-17", 98]]);
  const A = adjustRows(rows, [{ d: "2026-07-16", kind: "div", amt: 2 }]);
  assert.ok(near(A.rows[0].ac, 98)); assert.equal(A.events[0].d, "2026-07-17");
});

test("分割（0050 一拆四）：證交所原始價除以 4；Yahoo 已調整過的價格不再除", () => {
  const raw = R([["2025-06-10", 188], ["2025-06-18", 47.5], ["2025-06-19", 48]]);
  const A = adjustRows(raw, [{ d: "2025-06-18", kind: "split", r: 4 }]);
  assert.ok(near(A.rows[0].ac, 47)); assert.ok(Math.abs(A.rows[1].ac / A.rows[0].ac - 1) < 0.02, "分割那天不再像跌 75%");
  assert.equal(A.events[0].applied, true);
  const Y = adjustRows(R([["2025-06-10", 47], ["2025-06-18", 47.5]]), [{ d: "2025-06-18", kind: "split", r: 4 }], true);
  assert.equal(Y.rows[0].ac, 47); assert.equal(Y.events[0].applied, false);
});

test("分割＋除息一起：股息依分割後的價格算", () => {
  const rows = R([["2025-06-10", 200], ["2025-06-18", 50], ["2025-07-21", 50], ["2025-07-22", 49]]);
  const A = adjustRows(rows, [{ d: "2025-06-18", kind: "split", r: 4 }, { d: "2025-07-22", kind: "div", amt: 1 }]), f = 1 - 1 / 50;
  assert.ok(near(A.rows[0].ac, 50 * f)); assert.ok(near(A.rows[2].ac, 50 * f)); assert.equal(A.rows[3].ac, 49);
});

test("期間外的事件不處理；股息大於前收盤一半視為資料錯誤略過", () => {
  const rows = R([["2026-07-14", 100], ["2026-07-15", 40]]);
  const A = adjustRows(rows, [{ d: "2026-07-01", kind: "div", amt: 5 }, { d: "2026-07-15", kind: "div", amt: 60 }, { d: "2026-08-01", kind: "split", r: 2 }]);
  assert.equal(A.rows[0].ac, 100); assert.equal(A.events.length, 0); assert.deepEqual(A.skipped.map(x => x.why), ["bad_factor"]);
  assert.deepEqual(adjustRows([], []).rows, []);
});

test("證交所官方參考價（TWT49U 除權息、TWTAUU 減資）：民國日期、只取這一檔、因子＝參考價 ÷ 前收盤", () => {
  const twt49u = { stat: "OK", fields: ["資料日期", "股票代號", "股票名稱", "除權息前收盤價", "除權息參考價", "權值+息值", "權/息"],
    data: [["115年07月16日", "2330", "台積電", "1,000.00", "995.00", "5.00", "息"], ["115年07月16日", "2317", "鴻海", "200.00", "190.00", "10", "權息"], ["115年08月20日", "2330", "台積電", "--", "--", "", ""]] };
  assert.deepEqual(parseRefPrices(twt49u, "2330", "除權息"), [{ d: "2026-07-16", kind: "ref", f: 0.995, why: "除權息" }]);
  const twtauu = { stat: "OK", fields: ["恢復買賣日期", "股票代號", "名稱", "停止買賣前收盤價格", "恢復買賣參考價", "漲停價格"], data: [["115/03/02", "2317", "鴻海", "70.00", "100.00", "110"]] };
  assert.equal(parseRefPrices(twtauu, "2317", "減資")[0].f, 100 / 70);
  assert.deepEqual(parseRefPrices({ stat: "很抱歉，沒有符合條件的資料!" }, "2330", "x"), []);
  assert.deepEqual(parseRefPrices({ fields: ["a"], data: [["1"]] }, "2330", "x"), [], "欄位對不上就不用");
});

test("官方參考價：配股（除權）也還原；同一天 Yahoo 的除息、分割不再重複用；減資讓之前的價格往上調", () => {
  const rows = R([["2026-07-15", 200], ["2026-07-16", 172], ["2026-07-17", 175]]);
  // 配股＋配息：官方參考價 172.73（前收盤 200）；Yahoo 只記了 2 元股息，還把配股記成 1.15 分割
  const A = adjustRows(rows, [{ d: "2026-07-16", kind: "ref", f: 172.73 / 200, why: "除權息" }, { d: "2026-07-16", kind: "div", amt: 2 }, { d: "2026-07-16", kind: "split", r: 1.15 }]);
  assert.ok(near(A.rows[0].ac, 172.73)); assert.deepEqual(A.events.map(e => e.kind), ["ref"]); assert.deepEqual(A.suspect, []);
  const C = adjustRows(R([["2026-03-01", 70], ["2026-03-02", 100], ["2026-03-03", 101]]), [{ d: "2026-03-02", kind: "ref", f: 100 / 70, why: "減資" }]);
  assert.ok(near(C.rows[0].ac, 100)); assert.deepEqual(C.suspect, [], "減資恢復買賣那天不再像漲 43%");
  const Y = adjustRows(R([["2026-07-15", 200], ["2026-07-16", 172]]), [{ d: "2026-07-16", kind: "ref", f: 0.86 }], true);
  assert.equal(Y.rows[0].ac, 200, "Yahoo 已調整過的價格不套官方參考價（避免和 Yahoo 的調整重複）");
});

test("還原後仍超過漲跌幅限制的單日列為可疑（多半是沒還原到的配股、減資）", () => {
  const A = adjustRows(R([["2026-07-15", 200], ["2026-07-16", 150], ["2026-07-17", 151]]), []);
  assert.deepEqual(A.suspect, [{ d: "2026-07-16", r: -0.25 }]);
  assert.deepEqual(adjustRows(R([["2026-07-15", 200], ["2026-07-16", 150]]), [], true, { limit: 0.5 }).suspect, [], "美股門檻 50%");
});
