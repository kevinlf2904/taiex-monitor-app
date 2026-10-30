// 加權（T00）、櫃買（O00）分 K 的價格與成交金額（api/_lib/intraday.js）：全部用假 fetch，不連富果、Yahoo
import test from "node:test";
import assert from "node:assert/strict";
import handler, { aggregate, parseFugleCandles, toYi, hhmm } from "../api/_lib/intraday.js";

const DAY = "2026-10-30";
const noSleep = async () => {};
// 富果 1 分 K：09:00 起 n 根，volume(k) 是那一分鐘的成交金額（元）
const fugleCandles = (n, volume, day = DAY) => ({ date: day, data: Array.from({ length: n }, (_, k) => ({ date: `${day}T09:${String(k).padStart(2, "0")}:00.000+08:00`, open: 45000 + k, high: 45010 + k, low: 44990 + k, close: 45005 + k, ...(volume ? { volume: volume(k) } : {}) })) });
const yahooIdx = (n, day = DAY) => { const t0 = Date.parse(`${day}T09:00:00+08:00`) / 1000, ts = Array.from({ length: n }, (_, k) => t0 + k * 60);
  return { chart: { result: [{ meta: { chartPreviousClose: 44900, shortName: "TSEC" }, timestamp: ts, indicators: { quote: [{ open: ts.map(() => 45000), high: ts.map(() => 45010), low: ts.map(() => 44990), close: ts.map(() => 45005), volume: ts.map(() => 0) }] } }] } }; };
const ok = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const fail = status => ({ ok: false, status, headers: { get: () => null }, json: async () => ({}) });

// 呼叫 /api/intraday；route(url) 回傳假回應；記錄每個網址被打幾次
async function call(query, route, { key = "test-key" } = {}) {
  const old = process.env.FUGLE_API_KEY, calls = [];
  if (key) process.env.FUGLE_API_KEY = key; else delete process.env.FUGLE_API_KEY;
  const fetchImpl = async url => { url = String(url); calls.push(url); if (!/api\.fugle\.tw|query1\.finance\.yahoo\.com/.test(url)) throw new Error("不該連到其他網站：" + url); return route(url); };
  let body; try { await handler({ query }, { setHeader() {}, status: () => ({ json: b => (body = JSON.parse(JSON.stringify(b))) }) }, { fetchImpl, sleep: noSleep }); }
  finally { if (old === undefined) delete process.env.FUGLE_API_KEY; else process.env.FUGLE_API_KEY = old; }
  return { body, calls, fugle: calls.filter(u => u.includes("/candles/")).length };
}
const VOL = k => 1e10 + k * 1e8; // 每分鐘 100 億元起，每分鐘多 1 億
const fugleOk = (sym, n = 10) => url => (url.includes(`/candles/${sym}`) ? ok(fugleCandles(n, VOL)) : url.includes("/quote/") ? ok({ previousClose: 44900, name: "加權指數" }) : fail(404));

test("T00 富果完整開高低收量：用 IX0001，成交金額換成億元、單位標「億元」", async () => {
  const { body, calls } = await call({ code: "t00", tf: "1" }, fugleOk("IX0001"));
  assert.ok(calls.some(u => u.includes("/candles/IX0001")));
  assert.equal(body.ok, true); assert.equal(body.source, "富果"); assert.equal(body.unit, "億元"); assert.equal(body.amountNa, false);
  assert.equal(body.bars.length, 10);
  assert.deepEqual(body.bars.slice(0, 3).map(b => b.v), [100, 101, 102], "1e10 元 = 100 億");
  assert.ok(body.bars.every(b => b.o > 0 && b.h >= b.l && b.c > 0));
});

test("O00 富果完整開高低收量：用 IX0043", async () => {
  const { body, calls } = await call({ code: "o00", tf: "1" }, fugleOk("IX0043"));
  assert.ok(calls.some(u => u.includes("/candles/IX0043")));
  assert.equal(body.unit, "億元"); assert.equal(body.bars[0].v, 100);
});

test("富果沒有給 volume：價格照常、成交金額是 null（不是 0）、標 amountNa", async () => {
  const { body } = await call({ code: "t00", tf: "5" }, url => (url.includes("/candles/") ? ok(fugleCandles(10, null)) : ok({ previousClose: 44900 })));
  assert.equal(body.source, "富果"); assert.equal(body.bars.length, 2);
  assert.ok(body.bars.every(b => b.v === null && b.c > 0)); assert.equal(body.amountNa, true);
});

test("富果 403：不重試，改用 Yahoo（只有價格、成交金額 null）", async () => {
  const { body, fugle } = await call({ code: "t00", tf: "1" }, url => (url.includes("fugle") ? fail(403) : ok(yahooIdx(5))));
  assert.equal(fugle, 1, "403 只打一次"); assert.match(body.source, /Yahoo/);
  assert.ok(body.bars.every(b => b.v === null && b.c === 45005)); assert.equal(body.amountNa, true); assert.equal(body.unit, "億元");
});

test("富果 429：再試一次後成功", async () => {
  let n = 0;
  const { body, fugle } = await call({ code: "t00", tf: "1" }, url => (url.includes("/candles/") ? (++n === 1 ? fail(429) : ok(fugleCandles(3, VOL))) : ok({ previousClose: 44900 })));
  assert.equal(fugle, 2); assert.equal(body.source, "富果"); assert.equal(body.bars[0].v, 100);
});

test("富果逾時：再試一次，仍逾時就改用 Yahoo；次數有上限", async () => {
  const to = () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); };
  const { body, fugle } = await call({ code: "o00", tf: "1" }, url => (url.includes("fugle") ? to() : ok(yahooIdx(3))));
  assert.equal(fugle, 2, "逾時最多 2 次"); assert.match(body.source, /Yahoo/); assert.ok(body.bars.every(b => b.v === null));
});

test("Yahoo 有價格沒有量（沒有富果金鑰）：K 線照常、成交金額 null", async () => {
  const { body, calls } = await call({ code: "t00", tf: "5" }, url => ok(yahooIdx(10)), { key: "" });
  assert.ok(calls.every(u => u.includes("yahoo")));
  assert.equal(body.bars.length, 2); assert.ok(body.bars.every(b => b.v === null && b.o === 45000)); assert.equal(body.amountNa, true);
});

test("1 分 K 合成 5、15、30、60 分 K：成交金額＝各分鐘相加（先用元加總再換億元），沒有重複累加", async () => {
  const one = parseFugleCandles(fugleCandles(60, VOL), true).bars.map(b => ({ d: DAY, ...b }));
  const total = one.reduce((s, b) => s + b.v, 0);
  for (const tf of [5, 15, 30, 60]) {
    const { body } = await call({ code: "t00", tf: String(tf) }, fugleOk("IX0001", 60));
    assert.equal(body.bars.length, 60 / tf);
    const want = aggregate(one, tf).map(b => toYi(b.v));
    assert.deepEqual(body.bars.map(b => b.v), want);
    assert.equal(+body.bars.reduce((s, b) => s + b.v, 0).toFixed(2), toYi(total), `${tf} 分合計等於 1 分合計，不會多算`);
    assert.equal(body.bars[0].v, toYi(one.slice(0, tf).reduce((s, b) => s + b.v, 0)));
  }
});

test("合成時桶內有一根缺成交金額：整桶是 null，不當成 0", () => {
  const bars = [{ d: DAY, t: "09:00", o: 1, h: 1, l: 1, c: 1, v: 5e9 }, { d: DAY, t: "09:01", o: 1, h: 1, l: 1, c: 1, v: null }, { d: DAY, t: "09:05", o: 1, h: 1, l: 1, c: 1, v: 3e9 }];
  assert.deepEqual(aggregate(bars, 5).map(b => toYi(b.v)), [null, 30]);
});

test("台灣時區跨日：前一天與今天同一時間的分 K 不會合進同一根；UTC 時間換成台北時間", () => {
  const bars = [{ d: "2026-10-29", t: "13:29", o: 1, h: 1, l: 1, c: 1, v: 1e8 }, { d: DAY, t: "09:00", o: 2, h: 2, l: 2, c: 2, v: 2e8 }, { d: DAY, t: "09:01", o: 2, h: 2, l: 2, c: 2, v: 3e8 }];
  assert.deepEqual(aggregate(bars, 5).map(b => [b.d, b.t, toYi(b.v)]), [["2026-10-29", "13:25", 1], [DAY, "09:00", 5]]);
  assert.equal(hhmm(Date.parse("2026-10-30T01:00:00Z") / 1000), "09:00");
  assert.equal(hhmm("2026-10-30T09:00:00.000+08:00"), "09:00");
});

test("盤後或休市：回傳的日期是資料自己的日期（前一個交易日），不冒充今天", async () => {
  const prevDay = "2026-10-29";
  const { body } = await call({ code: "t00", tf: "1" }, url => (url.includes("/candles/") ? ok(fugleCandles(3, VOL, prevDay)) : ok({ previousClose: 44900 })));
  assert.equal(body.date, prevDay); assert.ok(body.bars.every(b => b.d === prevDay));
});

test("個股單位不受影響：個股仍是「張」、不換算", async () => {
  const stk = await call({ code: "2330", tf: "1" }, url => (url.includes("/candles/") ? ok(fugleCandles(2, k => 100 + k)) : ok({ previousClose: 1000 })));
  assert.equal(stk.body.unit, "張"); assert.deepEqual(stk.body.bars.map(b => b.v), [100, 101], "個股的量照原值（張），不換算");
  assert.equal(stk.body.amountNa, undefined);
});

test("收盤集合競價 13:25～13:29 成交金額是 0：60 分 K 最後一小時仍有金額（0 不當成缺值）", async () => {
  // 13:00～13:30 共 31 根：13:25～13:29 是 0，13:30 是集合競價成交（富果 10/30 實際就是這樣）
  const data = Array.from({ length: 31 }, (_, k) => ({ date: `${DAY}T13:${String(k).padStart(2, "0")}:00.000+08:00`, open: 45000, high: 45010, low: 44990, close: 45005, volume: k >= 25 && k <= 29 ? 0 : k === 30 ? 818e8 : 25e8 }));
  const { body } = await call({ code: "t00", tf: "60" }, url => (url.includes("/candles/") ? ok({ date: DAY, data }) : ok({ previousClose: 44900 })));
  assert.equal(body.bars.length, 1); assert.equal(body.bars[0].t, "13:00");
  assert.equal(body.bars[0].v, 25 * 25 + 818, "25 根各 25 億＋收盤 818 億");
  const five = await call({ code: "t00", tf: "5" }, url => (url.includes("/candles/") ? ok({ date: DAY, data }) : ok({ previousClose: 44900 })));
  assert.deepEqual(five.body.bars.slice(-2).map(b => [b.t, b.v]), [["13:25", 0], ["13:30", 818]]);
});
