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
async function call(query, route, { key = "test-key", yahooBarsImpl } = {}) {
  const old = process.env.FUGLE_API_KEY, calls = [];
  if (key) process.env.FUGLE_API_KEY = key; else delete process.env.FUGLE_API_KEY;
  const fetchImpl = async url => { url = String(url); calls.push(url); if (!/api\.fugle\.tw|query1\.finance\.yahoo\.com/.test(url)) throw new Error("不該連到其他網站：" + url); return route(url); };
  let body; const headers = {}; try { await handler({ query }, { setHeader: (name, value) => { headers[name] = value; }, status: () => ({ json: b => (body = JSON.parse(JSON.stringify(b))) }) }, { fetchImpl, sleep: noSleep, yahooBarsImpl }); }
  finally { if (old === undefined) delete process.env.FUGLE_API_KEY; else process.env.FUGLE_API_KEY = old; }
  return { body, calls, headers, fugle: calls.filter(u => u.includes("/candles/")).length };
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

const historyFixture = items => ({ data: items.map((item, k) => ({
  date: `${item.d}T${item.t || "09:00"}:00.000+08:00`,
  open: 45000 + k, high: 45010 + k, low: 44990 + k, close: 45005 + k,
  ...(Object.hasOwn(item, "volume") ? { volume: item.volume } : { volume: VOL(k) }),
})) });
const yahooHistoryMock = async () => ({
  bars: [{ d: "2026-10-29", t: "09:00", o: 45000, h: 45010, l: 44990, c: 45005, v: null }],
  prev: 44900, meta: { shortName: "TSEC" }, session: { open: "09:30", close: "16:00" },
});
test("歷史 T00 使用 Fugle IX0001：日期區間、欄位及升冪排序參數正確", async () => {
  const { body, calls } = await call({ code: "t00", tf: "1", before: "2026-10-31" }, () => ok(historyFixture([{ d: "2026-10-30" }])));
  const u = new URL(calls[0]);
  assert.equal(u.pathname, "/marketdata/v1.0/stock/historical/candles/IX0001");
  assert.equal(u.searchParams.get("timeframe"), "1");
  assert.equal(u.searchParams.get("from"), "2026-10-01");
  assert.equal(u.searchParams.get("to"), "2026-10-30");
  assert.equal(u.searchParams.get("fields"), "open,high,low,close,volume");
  assert.equal(u.searchParams.get("sort"), "asc");
  assert.equal(body.source, "Fugle Historical Candles");
  assert.equal(body.unit, "億元");
  assert.equal(body.bars[0].v, 100);
});
test("歷史 O00 使用 Fugle IX0043", async () => {
  const { body, calls } = await call({ code: "o00", tf: "5", before: "2026-10-31" }, () => ok(historyFixture([{ d: "2026-10-30", volume: 2e10 }])));
  assert.ok(calls[0].includes("/historical/candles/IX0043"));
  assert.equal(body.bars[0].v, 200);
  assert.equal(body.unit, "億元");
});
test("歷史指數 1／5／15／30／60 分直接請求對應 timeframe，日期區間均小於一年", async () => {
  for (const tf of [1, 5, 15, 30, 60]) {
    const { calls } = await call({ code: "t00", tf: String(tf), before: "2026-10-31" }, () => ok(historyFixture([{ d: "2026-10-30" }])));
    const u = new URL(calls[0]);
    assert.equal(u.searchParams.get("timeframe"), String(tf));
    assert.ok((Date.parse(u.searchParams.get("to")) - Date.parse(u.searchParams.get("from"))) / 86400000 < 365);
  }
});
test("歷史指數成交金額保留原始元數值後換算億元，不重複加總", async () => {
  const raw = 12345678912;
  const { body } = await call({ code: "t00", tf: "15", before: "2026-10-31" }, () => ok(historyFixture([{ d: "2026-10-30", volume: raw }])));
  assert.equal(body.bars.length, 1);
  assert.equal(body.bars[0].v, toYi(raw));
  assert.equal(body.amountNa, false);
});
test("歷史 Fugle 多日資料依日期優先、同日時間其次排序", async () => {
  const { body } = await call({ code: "t00", tf: "1", before: "2026-10-31" }, () => ok(historyFixture([
    { d: "2026-10-30", t: "09:01" }, { d: "2026-10-29", t: "09:02" }, { d: "2026-10-30", t: "09:00" },
  ])));
  assert.deepEqual(body.bars.map(b => [b.d, b.t]), [["2026-10-29", "09:02"], ["2026-10-30", "09:00"], ["2026-10-30", "09:01"]]);
});
test("歷史分頁游標銜接 chunk 邊界：不重複、不漏資料", async () => {
  const fixtures = [historyFixture([{ d: "2026-10-30" }, { d: "2026-10-01" }]), historyFixture([{ d: "2026-09-30" }]), historyFixture([{ d: "2026-08-31" }])];
  const seen = []; let idx = 0, before = "2026-10-31";
  for (let page = 0; page < 3; page++) {
    const { body } = await call({ code: "t00", tf: "1", before }, () => ok(fixtures[idx++]));
    seen.push(...body.bars.map(b => b.d)); before = body.next;
  }
  assert.deepEqual(seen, ["2026-10-01", "2026-10-30", "2026-09-30", "2026-08-31"]);
  assert.equal(new Set(seen).size, seen.length);
});
test("Fugle 404 是無資料 chunk：empty、no-store 並前進游標，不當成終點", async () => {
  let yahooCalls = 0;
  const { body, headers, calls } = await call({ code: "t00", tf: "1", before: "2026-10-31" }, () => fail(404), { yahooBarsImpl: async () => { yahooCalls++; return null; } });
  assert.equal(calls.length, 1); assert.equal(yahooCalls, 0); assert.equal(body.ok, true);
  assert.equal(body.empty, true); assert.equal(body.end, false); assert.equal(body.next, "2026-10-01");
  assert.equal(headers["Cache-Control"], "no-store, max-age=0");
});
test("Fugle 歷史資料起始日 2023-05-23：最後 chunk 包含起始日並標記 end", async () => {
  const { body, calls } = await call({ code: "o00", tf: "60", before: "2023-05-24" }, () => ok(historyFixture([{ d: "2023-05-23", volume: 5e9 }])));
  const u = new URL(calls[0]); assert.equal(u.searchParams.get("from"), "2023-05-23"); assert.equal(u.searchParams.get("to"), "2023-05-23");
  assert.equal(body.end, true); assert.equal(body.bars[0].v, 50);
  const terminal = await call({ code: "o00", tf: "60", before: "2023-05-23" }, () => { throw new Error("起始日之前不應再呼叫 Fugle"); });
  assert.equal(terminal.body.empty, true); assert.equal(terminal.body.end, true); assert.equal(terminal.calls.length, 0);
});
test("Fugle 歷史 429 有限重試一次，成功後不呼叫 Yahoo", async () => {
  let n = 0, yahooCalls = 0;
  const { body, fugle } = await call({ code: "t00", tf: "5", before: "2026-10-31" }, () => (++n === 1 ? fail(429) : ok(historyFixture([{ d: "2026-10-30" }])), { yahooBarsImpl: async () => { yahooCalls++; return null; } });
  assert.equal(fugle, 2); assert.equal(body.source, "Fugle Historical Candles"); assert.equal(yahooCalls, 0);
});
test("Fugle 歷史 5xx／timeout 有限重試後改用 Yahoo 價格備援，成交金額為 null", async () => {
  for (const failure of [() => fail(503), () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }]) {
    let yahooCalls = 0;
    const { body, fugle } = await call({ code: "t00", tf: "15", before: "2026-10-31" }, failure, { yahooBarsImpl: async () => { yahooCalls++; return yahooHistoryMock(); } });
    assert.equal(fugle, 2); assert.equal(yahooCalls, 1); assert.match(body.source, /Yahoo Finance/);
    assert.equal(body.amountNa, true); assert.ok(body.bars.every(b => b.v === null && b.c > 0));
  }
});
test("Fugle 歷史 401／403 不重試，改用 Yahoo 價格備援", async () => {
  for (const status of [401, 403]) {
    let yahooCalls = 0;
    const { body, fugle } = await call({ code: "o00", tf: "30", before: "2026-10-31" }, () => fail(status), { yahooBarsImpl: async () => { yahooCalls++; return yahooHistoryMock(); } });
    assert.equal(fugle, 1); assert.equal(yahooCalls, 1); assert.match(body.source, /Yahoo Finance/);
    assert.equal(body.amountNa, true); assert.ok(body.bars.every(b => b.v === null));
  }
});
test("沒有 FUGLE_API_KEY 時歷史大盤以 Yahoo 補價格，不假造成交金額", async () => {
  const { body, calls } = await call({ code: "t00", tf: "1", before: "2026-10-31" }, () => { throw new Error("未設定金鑰時不可呼叫 Fugle"); }, { key: "", yahooBarsImpl: yahooHistoryMock });
  assert.equal(calls.length, 0); assert.match(body.source, /Yahoo Finance/); assert.equal(body.unit, "億元"); assert.equal(body.amountNa, true);
  assert.ok(body.bars.every(b => b.v === null && b.v !== 0));
});
test("歷史 Fugle 回傳空陣列時標示 empty 並禁止快取", async () => {
  const { body, headers } = await call({ code: "t00", tf: "1", before: "2026-10-31" }, () => ok({ data: [] }));
  assert.equal(body.empty, true); assert.equal(body.end, false); assert.equal(headers["Cache-Control"], "no-store, max-age=0");
});
test("個股及美股歷史仍走 Yahoo，原有成交量單位維持不變", async () => {
  const stock = await call({ code: "2330", tf: "5", before: "2026-10-30" }, () => { throw new Error("個股歷史不得改走 Fugle"); },
    { yahooBarsImpl: async () => ({ bars: [{ d: "2026-10-29", t: "09:00", o: 1000, h: 1010, l: 990, c: 1005, v: 12 }], prev: 990 }) });
  assert.equal(stock.calls.length, 0); assert.equal(stock.body.source, "Yahoo Finance"); assert.equal(stock.body.unit, "張"); assert.equal(stock.body.bars[0].v, 12);
  const us = await call({ code: "AAPL", tf: "5", before: "2026-10-30" }, () => { throw new Error("美股歷史不得呼叫 Fugle"); },
    { yahooBarsImpl: async () => ({ bars: [{ d: "2026-10-29", t: "09:30", o: 250, h: 251, l: 249, c: 250.5, v: 123 }], prev: 249, meta: {}, session: { open: "09:30", close: "16:00" } }) });
  assert.equal(us.calls.length, 0); assert.equal(us.body.unit, "千股"); assert.equal(us.body.bars[0].v, 123);
});
