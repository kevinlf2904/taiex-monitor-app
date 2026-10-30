// 加權（T00）、櫃買（O00）分 K 的價格與成交金額（api/_lib/intraday.js）：全部用假 fetch，不連富果、Yahoo
import test from "node:test";
import assert from "node:assert/strict";
import handler, { aggregate, parseFugleCandles, parseFugleHistoryCandles, toYi, hhmm } from "../api/_lib/intraday.js";

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
  const old = process.env.FUGLE_API_KEY, oldFetch = globalThis.fetch, calls = [], responseHeaders = {};
  if (key) process.env.FUGLE_API_KEY = key; else delete process.env.FUGLE_API_KEY;
  const fetchImpl = async (url, options = {}) => {
    url = String(url); calls.push(url);
    if (!/api\\.fugle\\.tw|query1\\.finance\\.yahoo\\.com/.test(url)) throw new Error("不該連到其他網站：" + url);
    return route(url, options);
  };
  globalThis.fetch = fetchImpl; // _yahoo.js 歷史請求使用 global fetch；在此一併 mock，確保不連外。
  let body;
  try {
    await handler({ query }, { setHeader: (k, v) => { responseHeaders[k] = v; }, status: () => ({ json: b => (body = JSON.parse(JSON.stringify(b))) }) }, { fetchImpl, sleep: noSleep });
  } finally {
    globalThis.fetch = oldFetch;
    if (old === undefined) delete process.env.FUGLE_API_KEY; else process.env.FUGLE_API_KEY = old;
  }
  return { body, calls, responseHeaders, fugle: calls.filter(u => u.includes("/candles/")).length };
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

const histRow = (day, time, volume) => ({
  date: `${day}T${time}:00.000+08:00`, open: 45000, high: 45010, low: 44990, close: 45005, volume,
});
const histBody = data => ({ symbol: "IX0001", timeframe: "1", sort: "asc", data });
const yahooHistory = (day = "2026-10-29") => {
  const t0 = Date.parse(`${day}T09:00:00+08:00`) / 1000, ts = [t0, t0 + 60];
  return { chart: { result: [{
    meta: { gmtoffset: 28800, chartPreviousClose: 44900, shortName: "TSEC" }, timestamp: ts,
    indicators: { quote: [{ open: [45000, 45001], high: [45010, 45011], low: [44990, 44991], close: [45005, 45006], volume: [2000, 3000] }] },
  }] } };
};
const yahooUsHistory = (day = "2026-10-29") => {
  const t0 = Date.parse(`${day}T13:30:00Z`) / 1000, ts = [t0, t0 + 60];
  return { chart: { result: [{
    meta: { gmtoffset: -14400, chartPreviousClose: 220, shortName: "Apple Inc." }, timestamp: ts,
    indicators: { quote: [{ open: [220, 221], high: [221, 222], low: [219, 220], close: [220.5, 221.5], volume: [2000, 3000] }] },
  }] } };
};

test("Fugle 歷史指數分 K：T00/O00 對應 IX0001/IX0043，五種 timeframe、區間、欄位與億元單位正確", async () => {
  for (const [code, symbol] of [["t00", "IX0001"], ["o00", "IX0043"]]) {
    for (const tf of [1, 5, 15, 30, 60]) {
      const { body, calls } = await call({ code, tf: String(tf), before: DAY }, (url, options) => {
        assert.ok(url.includes(`/historical/candles/${symbol}?`));
        assert.equal(options.headers["X-API-KEY"], "test-key");
        return ok(histBody([histRow("2026-10-29", "09:00", 100e8)]));
      });
      const q = new URL(calls[0]).searchParams;
      assert.equal(q.get("timeframe"), String(tf));
      assert.equal(q.get("from"), "2026-09-30"); assert.equal(q.get("to"), "2026-10-29");
      assert.ok(Date.parse(q.get("to")) - Date.parse(q.get("from")) < 365 * 86400e3, "每次查詢必須小於一年");
      assert.equal(q.get("fields"), "open,high,low,close,volume"); assert.equal(q.get("sort"), "asc");
      assert.equal(body.ok, true); assert.equal(body.source, "富果 Historical Candles");
      assert.equal(body.unit, "億元"); assert.equal(body.amountNa, false);
      assert.equal(body.bars[0].v, 100); assert.equal(body.bars[0].d, "2026-10-29");
    }
  }
});

test("Fugle 歷史資料依完整日期與時間排序；各週期 K 棒不跨日重組、不重複累加 volume", async () => {
  const data = [
    histRow("2026-10-29", "09:01", 300e8),
    histRow("2026-10-28", "09:00", 100e8),
    histRow("2026-10-29", "09:00", 200e8),
  ];
  const { body } = await call({ code: "t00", tf: "5", before: DAY }, url => ok(histBody(data)));
  assert.deepEqual(body.bars.map(b => [b.d, b.t, b.v]), [
    ["2026-10-28", "09:00", 100], ["2026-10-29", "09:00", 200], ["2026-10-29", "09:01", 300],
  ]);
  assert.equal(parseFugleHistoryCandles(histBody(data)).length, 3);
});

test("Fugle 歷史成交金額保留零與缺值語意：0 是 0，缺 volume 是 null", async () => {
  const { body } = await call({ code: "o00", tf: "1", before: DAY }, url => ok(histBody([
    histRow("2026-10-29", "09:00", 0), { ...histRow("2026-10-29", "09:01", null), volume: undefined },
  ])));
  assert.equal(body.bars[0].v, 0); assert.equal(body.bars[1].v, null);
  assert.equal(body.amountNa, false);
});

test("Fugle 404 空 chunk 不當成歷史終點：empty:true、no-store，next 往前推進", async () => {
  const first = await call({ code: "t00", tf: "1", before: DAY }, url => fail(404));
  assert.equal(first.body.ok, true); assert.deepEqual(first.body.bars, []);
  assert.equal(first.body.empty, true); assert.equal(first.body.end, false);
  assert.equal(first.body.next, "2026-09-30");
  assert.equal(first.responseHeaders["Cache-Control"], "no-store");
  assert.equal(first.calls.length, 1, "Fugle 404 應視為空 chunk，不要再用 Yahoo 覆蓋游標");
  const next = await call({ code: "t00", tf: "1", before: first.body.next }, url => ok(histBody([histRow("2026-09-29", "09:00", 50e8)])));
  assert.equal(next.body.bars[0].d, "2026-09-29");
  assert.equal(next.body.next, "2026-08-31");
});

test("Fugle 分頁游標採相鄰日期區間：相鄰頁面不重疊、不漏掉日期", async () => {
  const a = await call({ code: "t00", tf: "1", before: DAY }, url => ok(histBody([
    histRow("2026-10-29", "09:00", 1e8), histRow("2026-10-01", "09:00", 2e8),
  ])));
  const b = await call({ code: "t00", tf: "1", before: a.body.next }, url => {
    const q = new URL(url).searchParams;
    assert.equal(q.get("to"), "2026-09-29"); assert.equal(q.get("from"), "2026-08-31");
    return ok(histBody([histRow("2026-09-29", "09:00", 3e8)]));
  });
  const dates = [...b.body.bars, ...a.body.bars].map(x => x.d);
  assert.deepEqual(dates, ["2026-09-29", "2026-10-01", "2026-10-29"]);
  assert.equal(new Set(dates).size, dates.length);
});

test("只有抵達 2023-05-23 邊界才回報 Fugle 歷史終點", async () => {
  const boundary = await call({ code: "t00", tf: "1", before: "2023-05-24" }, url => fail(404));
  assert.equal(new URL(boundary.calls[0]).searchParams.get("from"), "2023-05-23");
  assert.equal(boundary.body.end, true); assert.equal(boundary.body.next, "2023-05-23");
  const earlier = await call({ code: "t00", tf: "1", before: "2023-05-23" }, () => { throw new Error("不應呼叫 API"); });
  assert.equal(earlier.body.end, true); assert.equal(earlier.calls.length, 0);
});

test("Fugle 歷史 429／5xx 最多重試一次，成功後採用 Fugle 資料", async () => {
  for (const status of [429, 503]) {
    let attempts = 0;
    const { body, fugle } = await call({ code: "t00", tf: "1", before: DAY }, url => {
      if (url.includes("/historical/candles/") && ++attempts === 1) return fail(status);
      return ok(histBody([histRow("2026-10-29", "09:00", 80e8)]));
    });
    assert.equal(fugle, 2); assert.equal(body.source, "富果 Historical Candles"); assert.equal(body.bars[0].v, 80);
  }
});

test("Fugle 歷史 401／403 不重試，改用 Yahoo 價格備援且成交金額保持 null", async () => {
  for (const status of [401, 403]) {
    const { body, fugle } = await call({ code: "t00", tf: "1", before: DAY }, url => {
      if (url.includes("/historical/candles/")) return fail(status);
      if (url.includes("query1.finance.yahoo.com")) return ok(yahooHistory());
      throw new Error("不預期的 fallback URL");
    });
    assert.equal(fugle, 1); assert.match(body.source, /Yahoo Finance.*價格備援/);
    assert.equal(body.amountNa, true); assert.ok(body.bars.length > 0);
    assert.ok(body.bars.every(b => b.v === null && b.c != null));
  }
});

test("Fugle 歷史逾時重試一次後改用 Yahoo；Yahoo 僅提供價格，成交金額不假造", async () => {
  const { body, fugle } = await call({ code: "o00", tf: "1", before: DAY }, url => {
    if (url.includes("/historical/candles/")) throw Object.assign(new Error("mock timeout"), { name: "TimeoutError" });
    if (url.includes("query1.finance.yahoo.com")) return ok(yahooHistory());
    throw new Error("不預期的 fallback URL");
  });
  assert.equal(fugle, 2); assert.match(body.source, /Yahoo Finance/);
  assert.equal(body.amountNa, true); assert.ok(body.bars.every(b => b.v === null && b.c != null));
});

test("沒有 FUGLE_API_KEY 時，指數歷史退回 Yahoo 價格，成交金額 null 且來源明確", async () => {
  const { body, calls, fugle } = await call({ code: "t00", tf: "1", before: DAY }, url => ok(yahooHistory()), { key: "" });
  assert.equal(fugle, 0); assert.ok(calls.every(u => u.includes("yahoo")));
  assert.match(body.source, /Yahoo Finance.*價格備援/); assert.equal(body.amountNa, true);
  assert.ok(body.bars.every(b => b.v === null));
});

test("個股歷史仍使用原有 Yahoo 路徑及「張」單位，不受指數 Fugle 歷史修改影響", async () => {
  const { body, fugle } = await call({ code: "2330", tf: "1", before: DAY }, url => ok(yahooHistory()));
  assert.equal(fugle, 0); assert.equal(body.unit, "張"); assert.equal(body.source, "Yahoo Finance");
  assert.deepEqual(body.bars.map(b => b.v), [2, 3]); assert.equal(body.amountNa, undefined);
});

test("美股歷史仍使用原有 Yahoo 東部時區與「千股」單位", async () => {
  const { body, fugle } = await call({ code: "AAPL", tf: "1", before: DAY }, url => ok(yahooUsHistory()));
  assert.equal(fugle, 0); assert.equal(body.unit, "千股"); assert.equal(body.source, "Yahoo Finance");
  assert.deepEqual(body.bars.map(b => [b.d, b.t, b.v]), [["2026-10-29", "09:30", 2], ["2026-10-29", "09:31", 3]]);
});
