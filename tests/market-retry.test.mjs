// 盤中行情 MIS 重試、備援與最後有效資料（_retry.js、quote.js misFetch、_live.js misAll／marketRows）
// 全部用假資料與假 fetch，不連證交所、富果、Yahoo
import test from "node:test";
import assert from "node:assert/strict";
import { withRetry, errKind, retryable, backoff, retryErr, singleFlight } from "../api/_lib/_retry.js";
import { misFetch, misReset, MIS } from "../api/_lib/quote.js";
import { misAll, marketRows, KEEP_COMPLETE_MS } from "../api/_lib/_live.js";
import { aggregate } from "../api/_lib/intraday.js";
import { usEasternParts } from "../api/_lib/_yahoo.js";

const noSleep = async () => {};
const httpErr = s => Object.assign(new Error(`HTTP ${s}`), { status: s });
const TODAY = "2026-10-28", YDAY = "2026-10-27";
const at = hm => new Date(`${TODAY}T${hm}:00+08:00`); // 台北時間
// 1000 檔上市＋800 檔上櫃：達到 complete 門檻（各自 95%）
const BASE = [
  ...Array.from({ length: 1000 }, (_, i) => ({ code: String(1100 + i), name: `市${i}`, market: "上市", price: 100, vol: 10, date: YDAY })),
  ...Array.from({ length: 800 }, (_, i) => ({ code: String(3100 + i), name: `櫃${i}`, market: "上櫃", price: 50, vol: 10, date: YDAY })),
];
// 假 MIS：依查詢的頻道回傳；skip(code) 為 true 的不回（模擬缺漏）
const misRow = (chn, { date = TODAY, time = "10:29:55", price = 101 } = {}) => {
  const [ex, rest] = chn.split("_"), c = rest.replace(".tw", "");
  return { c, n: `名${c}`, ex, z: String(price), y: "100", o: "100", h: "102", l: "99", v: "1234", d: date.replace(/-/g, ""), t: time };
};
const fakeMis = (o = {}) => async chs => chs.filter(x => !o.skip?.(x)).map(x => misRow(x, o));
const closeMap = date => { const m = new Map(BASE.map(r => [r.code, { name: r.name, market: r.market, p: r.price, pct: 0.5, v: 10 }])); m.date = date; m.isSourceDateMatched = true; m.dateVerified = true; return m; };
const opts = (o = {}) => ({ today: TODAY, fetcher: async () => BASE, rwdFetcher: async () => closeMap(YDAY), isHoliday: () => false, misOpts: { sleep: noSleep }, ...o });

// ---------- 錯誤分類與退避 ----------
test("錯誤分類：403 不重試，429／5xx／逾時／JSON 壞掉／空資料可以重試", () => {
  assert.equal(errKind(httpErr(403)), "fatal"); assert.equal(retryable(httpErr(403)), false);
  assert.equal(errKind(httpErr(401)), "fatal");
  assert.equal(errKind(httpErr(429)), "rate"); assert.equal(retryable(httpErr(429)), true);
  assert.equal(errKind(httpErr(500)), "server"); assert.equal(errKind(httpErr(503)), "server");
  assert.equal(errKind(Object.assign(new Error("timeout"), { name: "TimeoutError" })), "timeout");
  assert.equal(errKind(new SyntaxError("Unexpected token")), "bad_json");
  assert.equal(errKind(new Error("HTTP 502")), "server", "沒有 status 屬性時看訊息");
  assert.equal(retryable(retryErr("empty")), true); assert.equal(retryable(retryErr("circuit")), false);
});

test("退避：指數成長、有 jitter、不超過上限", () => {
  const lo = n => backoff(n, { baseMs: 250, maxMs: 2000, rand: () => 0 }), hi = n => backoff(n, { baseMs: 250, maxMs: 2000, rand: () => 1 });
  assert.deepEqual([0, 1, 2, 3, 4].map(hi), [250, 500, 1000, 2000, 2000]);
  assert.deepEqual([0, 1, 2].map(lo), [125, 250, 500], "jitter 下限是一半");
  for (let i = 0; i < 50; i++) { const v = backoff(2); assert.ok(v >= 500 && v <= 1000); }
});

test("withRetry：403 只打一次；429、500、逾時有限次重試；成功就停", async () => {
  const run = async errs => { let n = 0; const waits = []; try { const r = await withRetry(async () => { const e = errs[n++]; if (e) throw e; return "ok"; }, { attempts: 3, sleep: async ms => waits.push(ms) }); return { r, n, waits }; } catch (e) { return { e, n, waits }; } };
  const f = await run([httpErr(403), null]); assert.equal(f.n, 1, "403 不重試"); assert.equal(errKind(f.e), "fatal"); assert.equal(f.waits.length, 0);
  const r429 = await run([httpErr(429), httpErr(429), httpErr(429), null]); assert.equal(r429.n, 3, "429 最多 3 次"); assert.equal(r429.e.attempts, 3);
  const r500 = await run([httpErr(500), null]); assert.equal(r500.r, "ok"); assert.equal(r500.n, 2);
  const rto = await run([Object.assign(new Error("t"), { name: "TimeoutError" }), Object.assign(new Error("t"), { name: "TimeoutError" }), null]); assert.equal(rto.r, "ok"); assert.equal(rto.n, 3);
  assert.ok(r429.waits[1] > r429.waits[0] * 0.9, "等待時間遞增");
});

test("withRetry：整體期限到了就不再等、不再試", async () => {
  let t = 0, n = 0;
  await assert.rejects(withRetry(async () => { n++; t += 1000; throw httpErr(503); }, { attempts: 10, deadline: 2500, now: () => t, sleep: async ms => { t += ms; } }));
  assert.ok(n <= 3, `期限內最多試幾次：${n}`);
});

test("singleFlight：同時呼叫共用同一次，結束後可以再跑", async () => {
  let calls = 0, release; const gate = new Promise(r => { release = r; });
  const f = singleFlight(async () => { calls++; await gate; return calls; });
  const ps = [f(), f(), f()]; release();
  assert.deepEqual(await Promise.all(ps), [1, 1, 1]); assert.equal(calls, 1);
  assert.equal(await f(), 2);
});

// ---------- quote.js misFetch（假 fetch） ----------
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => "JSESSIONID=x; Path=/" }, json: async () => (typeof body === "string" ? JSON.parse(body) : body) });

test("misFetch：正常回傳 msgArray；JSON 壞掉或沒有 msgArray 判失敗（不當空的成功）", async () => {
  misReset();
  assert.equal((await misFetch(["tse_2330.tw"], { fetchImpl: async () => res(200, { msgArray: [misRow("tse_2330.tw")] }) })).length, 1);
  misReset();
  await assert.rejects(misFetch(["tse_2330.tw"], { fetchImpl: async () => res(200, "{bad json") }), e => errKind(e) === "bad_json");
  misReset(); let urls = [];
  await assert.rejects(misFetch(["tse_2330.tw"], { fetchImpl: async u => { urls.push(u); return res(200, { rtcode: "5001" }); } }), e => errKind(e) === "bad_json");
  assert.ok(urls.some(u => u.includes("index.jsp")), "格式不對先換 session cookie 再試");
  misReset();
});

test("misFetch：403 換 cookie 再試一次仍被拒 → fatal，斷路器 60 秒內不再打 MIS", async () => {
  misReset(); let calls = 0, t = 1e6;
  const deny = async () => { calls++; return res(403, {}); };
  await assert.rejects(misFetch(["tse_2330.tw"], { fetchImpl: deny, now: () => t }), e => errKind(e) === "fatal");
  const first = calls; assert.ok(first <= 3, `403 不反覆重試：${first} 次`);
  await assert.rejects(misFetch(["tse_2330.tw"], { fetchImpl: deny, now: () => t + 1000 }), e => errKind(e) === "circuit");
  assert.equal(calls, first, "斷路器開著不發請求");
  assert.equal((await misFetch(["tse_2330.tw"], { fetchImpl: async () => res(200, { msgArray: [] }), now: () => t + MIS.denyDownMs + 1 })).length, 0, "60 秒後恢復");
  misReset();
});

test("misFetch：單次逾時不關斷路器（以前一次逾時就讓其他批次全部失敗），連續 3 次才關", async () => {
  misReset(); const to = async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); };
  await assert.rejects(misFetch(["a"], { fetchImpl: to }), e => errKind(e) === "timeout");
  assert.equal((await misFetch(["tse_2330.tw"], { fetchImpl: async () => res(200, { msgArray: [misRow("tse_2330.tw")] }) })).length, 1, "一次逾時後下一批照常查");
  for (let i = 0; i < MIS.netTrip; i++) await assert.rejects(misFetch(["a"], { fetchImpl: to }));
  await assert.rejects(misFetch(["a"], { fetchImpl: async () => res(200, { msgArray: [] }) }), e => errKind(e) === "circuit");
  misReset();
});

test("misFetch：429、500 不換 cookie、直接丟給重試分類", async () => {
  for (const s of [429, 500]) {
    misReset(); const urls = [];
    await assert.rejects(misFetch(["tse_2330.tw"], { fetchImpl: async u => { urls.push(u); return res(s, {}); } }), e => e.status === s);
    assert.equal(urls.length, 1, `${s} 只打一次，交給上層有限次重試`);
  }
  misReset();
});

// ---------- misAll ----------
test("misAll：MIS 正常回傳，全部批次成功，沒有重試", async () => {
  const rows = await misAll(BASE, fakeMis(), { sleep: noSleep });
  assert.equal(rows.length, 1800); assert.equal(rows.stats.okBatches, 18); assert.equal(rows.stats.retries, 0); assert.equal(rows.stats.failedBatches, 0);
  const r = rows.find(x => x.code === "1100");
  assert.equal(r.vol, 1234); assert.equal(r.value, +((1234 * 1000 * 101) / 1e8).toFixed(2), "成交量與成交值換算不變");
});

test("misAll：429、500、逾時有限次重試後成功；次數有上限", async () => {
  for (const e of [httpErr(429), httpErr(500), Object.assign(new Error("t"), { name: "TimeoutError" })]) {
    const seen = new Map();
    const f = async chs => { const k = chs[0], n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n === 1) throw e; return fakeMis()(chs); };
    const rows = await misAll(BASE, f, { sleep: noSleep });
    assert.equal(rows.length, 1800, `${errKind(e)} 重試後補齊`); assert.equal(rows.stats.retries, 18);
  }
  let calls = 0;
  const rows = await misAll(BASE.slice(0, 100), async () => { calls++; throw httpErr(503); }, { sleep: noSleep });
  assert.equal(rows.length, 0); assert.ok(calls <= 3 + 2 * 3, `一直 503 也有上限：${calls} 次`);
});

test("misAll：403 立刻停止，不對其他批次繼續發請求（避免請求風暴）", async () => {
  let calls = 0;
  const rows = await misAll(BASE, async () => { calls++; throw httpErr(403); }, { sleep: noSleep });
  assert.equal(rows.length, 0); assert.equal(rows.stats.aborted, true);
  assert.ok(calls <= 4, `最多同時的 4 批各一次：${calls}`); assert.equal(rows.stats.failedBatches, 18);
});

test("misAll：HTTP 200 空資料、缺一大半判失敗並重試；缺少少數照收", async () => {
  let n = 0;
  const empty = await misAll(BASE.slice(0, 100), async chs => (++n <= 1 ? [] : fakeMis()(chs)), { sleep: noSleep });
  assert.equal(empty.length, 100, "空回應重試後拿到"); assert.ok(empty.stats.errors.includes("empty"));
  let m = 0;
  const half = await misAll(BASE.slice(0, 100), async chs => (++m <= 1 ? fakeMis()(chs.slice(0, 30)) : fakeMis()(chs)), { sleep: noSleep });
  assert.equal(half.length, 100, "只回 30/100 重試"); assert.ok(half.stats.errors.includes("incomplete"));
  let k = 0;
  const most = await misAll(BASE.slice(0, 100), async chs => { k++; return fakeMis()(chs.slice(0, 95)); }, { sleep: noSleep });
  assert.equal(most.length, 95); assert.equal(k, 1, "95/100 不重試");
});

test("misAll：整體時間上限，慢的 MIS 不會拖垮函式", async () => {
  let t = 0;
  const slow = async () => { t += 4000; throw Object.assign(new Error("t"), { name: "TimeoutError" }); };
  const rows = await misAll(BASE, slow, { budgetMs: 15000, now: () => t, sleep: async ms => { t += ms; } });
  assert.equal(rows.length, 0); assert.ok(t <= 15000 + 4000 * 4 + 2000, `模擬耗時 ${t}ms`);
  assert.ok(rows.stats.timedOut || rows.stats.failedBatches === 18);
});

// ---------- marketRows：狀態、最後有效資料、跨日、休市 ----------
test("MIS 正常：盤中即時，來源時間新 → live", async () => {
  const r = await marketRows(opts({ now: at("10:30"), misFetcher: fakeMis(), store: {} }));
  assert.equal(r.live, true); assert.equal(r.dataStatus, "live"); assert.equal(r.date, TODAY); assert.equal(r.time, "10:29:55"); assert.equal(r.completeness, "complete");
  assert.ok(r.misStats && r.misStats.retries === 0);
});

test("MIS 全部失敗、有今天最後有效資料：沿用它、標延遲，不退回昨天收盤", async () => {
  const store = {};
  await marketRows(opts({ now: at("10:30"), misFetcher: fakeMis(), store }));
  const r = await marketRows(opts({ now: at("10:31"), misFetcher: async () => { throw httpErr(503); }, store }));
  assert.equal(r.date, TODAY, "不是昨天"); assert.equal(r.live, false); assert.equal(r.isLastGood, true);
  assert.equal(r.dataStatus, "delayed"); assert.equal(r.time, "10:29:55", "保留原始來源時間");
  assert.match(r.note, /最後一筆有效資料/); assert.ok(r.fallbackReason);
  const old = await marketRows(opts({ now: at("10:45"), misFetcher: async () => { throw httpErr(503); }, store }));
  assert.equal(old.dataStatus, "stale", "來源時間落後超過 6 分鐘：停滯"); assert.equal(old.live, false);
});

test("MIS 403：不重試、改用最後有效資料", async () => {
  const store = {}; let calls = 0;
  await marketRows(opts({ now: at("10:30"), misFetcher: fakeMis(), store }));
  const r = await marketRows(opts({ now: at("10:31"), misFetcher: async () => { calls++; throw httpErr(403); }, store }));
  assert.ok(calls <= 4); assert.equal(r.isLastGood, true); assert.equal(r.date, TODAY);
});

test("部分資料不覆蓋 2 分鐘內的完整資料；超過 2 分鐘才用部分資料（標 partial）", async () => {
  const store = {};
  await marketRows(opts({ now: at("10:30"), misFetcher: fakeMis(), store }));
  const partial = fakeMis({ skip: x => x.startsWith("otc_") && +x.slice(4, 8) >= 3600, time: "10:30:55" }); // 上櫃只剩 500 檔
  const kept = await marketRows(opts({ now: at("10:31"), misFetcher: partial, store }));
  assert.equal(kept.completeness, "complete"); assert.equal(kept.isLastGood, true); assert.equal(kept.dataStatus, "delayed"); assert.match(kept.note, /部分資料/);
  assert.equal(store.lastGood.completeness, "complete", "完整資料沒被蓋掉");
  const later = new Date(at("10:30").getTime() + KEEP_COMPLETE_MS + 60000);
  const p = await marketRows(opts({ now: later, misFetcher: fakeMis({ skip: x => x.startsWith("otc_") && +x.slice(4, 8) >= 3600, time: "10:32:55" }), store }));
  assert.notEqual(p.completeness, "complete"); assert.equal(p.dataStatus, "partial"); assert.equal(p.isLastGood, undefined);
});

test("所有來源都失敗、沒有今天的資料：顯示昨天收盤並標 stale，不冒充今天", async () => {
  const r = await marketRows(opts({ now: at("10:30"), misFetcher: async () => { throw httpErr(500); }, store: {} }));
  assert.equal(r.date, YDAY); assert.equal(r.live, false); assert.equal(r.dataStatus, "stale"); assert.match(r.note, /今日即時暫未取得/);
  assert.ok(r.misStats.failedBatches > 0);
});

test("昨天的 MIS 資料（d 是前一天）不會標成今天即時", async () => {
  const r = await marketRows(opts({ now: at("10:30"), misFetcher: fakeMis({ date: YDAY }), store: {} }));
  assert.notEqual(r.live, true); assert.notEqual(r.dataStatus, "live"); assert.equal(r.date, YDAY);
});

test("跨日：昨天的最後有效資料今天不能用", async () => {
  const store = {};
  await marketRows(opts({ today: YDAY, now: new Date(`${YDAY}T10:30:00+08:00`), misFetcher: fakeMis({ date: YDAY }), store }));
  assert.equal(store.lastGood.dataDate, YDAY);
  const r = await marketRows(opts({ now: at("09:10"), misFetcher: async () => { throw httpErr(503); }, store }));
  assert.notEqual(r.isLastGood, true, "不沿用昨天的盤中資料"); assert.equal(r.dataStatus, "stale"); assert.equal(r.date, YDAY);
  const ok = await marketRows(opts({ now: at("09:11"), misFetcher: fakeMis({ time: "09:10:58" }), store }));
  assert.equal(ok.date, TODAY); assert.equal(store.lastGood.dataDate, TODAY, "今天的資料取代昨天的");
});

test("OpenAPI 清單拿不到：用今天最後有效資料的股票清單繼續問 MIS", async () => {
  const store = {};
  await marketRows(opts({ now: at("10:30"), misFetcher: fakeMis(), store }));
  const r = await marketRows(opts({ now: at("10:31"), fetcher: async () => { throw new Error("OpenAPI down"); }, misFetcher: fakeMis({ time: "10:30:58" }), store }));
  assert.equal(r.live, true); assert.equal(r.time, "10:30:58"); assert.equal(r.rows.length, 1800);
});

test("台股休市：不呼叫 MIS、不產生今天的即時行情", async () => {
  let called = false;
  const r = await marketRows(opts({ now: at("10:30"), isHoliday: d => d === TODAY, misFetcher: async () => { called = true; return []; }, store: {} }));
  assert.equal(called, false); assert.equal(r.live, false); assert.notEqual(r.date, TODAY); assert.notEqual(r.dataStatus, "live");
});

test("美股跨時區：美東夏令／冬令時間判斷各自正確（不用台灣時間或 UTC）", () => {
  const edt = usEasternParts(Date.parse("2026-10-30T13:30:00Z")), est = usEasternParts(Date.parse("2026-11-02T14:30:00Z"));
  assert.equal(edt.hm, "09:30"); assert.equal(edt.tzAbbr, "EDT"); assert.equal(edt.date, "2026-10-30");
  assert.equal(est.hm, "09:30"); assert.equal(est.tzAbbr, "EST"); assert.equal(est.date, "2026-11-02");
  const twMorning = usEasternParts(Date.parse("2026-10-30T01:00:00Z")); // 台北 10/30 09:00＝美東 10/29 21:00
  assert.equal(twMorning.date, "2026-10-29");
});

test("分時 K：合成 5 分 K 不重複、不跨日合併、成交量加總正確", () => {
  const bars = [["2026-10-27", "13:29", 5], ["2026-10-28", "09:00", 1], ["2026-10-28", "09:01", 2], ["2026-10-28", "09:04", 3], ["2026-10-28", "09:05", 4]]
    .map(([d, t, v]) => ({ d, t, o: 10, h: 11, l: 9, c: 10, v }));
  const out = aggregate(bars, 5);
  assert.deepEqual(out.map(b => `${b.d} ${b.t} ${b.v}`), ["2026-10-27 13:25 5", "2026-10-28 09:00 6", "2026-10-28 09:05 4"]);
  assert.equal(new Set(out.map(b => b.d + b.t)).size, out.length, "沒有重複的時間");
});
