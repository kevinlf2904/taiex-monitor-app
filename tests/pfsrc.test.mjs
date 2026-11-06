// 資料來源與更新標示（learner/pfsrc.js）：每檔自己的來源、行情日期、取得時間；沿用時時間不刷新；整批失敗也保留上次的來源；
// 過期依交易日（週末、休市日不算），日曆不知道就標「無法確認」。期望值手算；固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/pfsrc.js", import.meta.url), "utf8"), ctx);
const S = ctx.KLPfSrc, J = x => JSON.parse(JSON.stringify(x));
const q = (code, o = {}) => ({ code, price: 100, dataDate: "2026-11-05", source: "證交所 MIS", updateMode: "after_close", ...o });
// 交易日曆（假資料）：週末不開；台股 2026-11-02（一）休市；2026-10-xx 不知道
const cal = { today: "2026-11-05", tradingDay: (m, d) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); if (w === 0 || w === 6) return false; if (d < "2026-11-01") return null; return !(m === "tw" && d === "2026-11-02"); } };
// 一次抓取：這次結果＋上一次的每檔紀錄 → { items, meta }
const step = (resp, prevItems, codes, at, o = cal) => { const cur = S.quoteItems(resp, at), M = S.mergeItems(prevItems, cur.items, codes); return { items: M.items, meta: S.summarize("quote", cur, M.items, codes, o) }; };

test("全部拿到：來源、盤後、行情日期、取得時間 → ok", () => {
  const { meta } = step({ ok: true, fetchedAt: "2026-11-05T06:40:00Z", quotes: [q("2330"), q("2317")] }, null, ["2330", "2317"]);
  const D = S.describe(meta); assert.equal(D.level, "ok");
  assert.deepEqual(J(D.parts), ["來源 證交所 MIS", "盤後", "行情日期 2026-11-05", "取得 11-05 14:40", "2 檔都有"]);
});

test("連續部分失敗：沿用的那檔一直標當初真正取得的時間，不被後來的抓取刷新", () => {
  const codes = ["2330", "2317"];
  const a = step({ ok: true, fetchedAt: "2026-11-05T02:00:00Z", quotes: [q("2330"), q("2317")] }, null, codes, "x");           // 10:00 兩檔都有
  const b = step({ ok: true, fetchedAt: "2026-11-05T02:10:00Z", quotes: [q("2330")] }, a.items, codes, "x");                     // 10:10 2317 沒拿到
  const c = step({ ok: true, fetchedAt: "2026-11-05T02:20:00Z", quotes: [q("2330")] }, b.items, codes, "x");                     // 10:20 2317 還是沒拿到
  assert.deepEqual(J(c.meta.kept), [{ code: "2317", at: "2026-11-05T02:00:00Z" }], "2317 是 10:00 的資料，不是 10:10");
  assert.equal(c.items["2330"].at, "2026-11-05T02:20:00Z"); assert.equal(c.meta.fetchedAt, "2026-11-05T02:20:00Z");
  const t = S.describe(c.meta).parts.join("・"); assert.match(t, /2317 沿用 11-05 10:00 取得的資料/); assert.match(t, /取得 11-05 10:20/); assert.equal(S.describe(c.meta).level, "warn");
  // 不同時間沿用的分開寫
  const d = step({ ok: true, fetchedAt: "2026-11-05T02:30:00Z", quotes: [] }, c.items, codes, "x");
  assert.match(S.describe(d.meta).parts.join("・"), /2317 沿用 11-05 10:00 取得的資料；2330 沿用 11-05 10:20 取得的資料/);
});

test("整批失敗：保留上一次的來源、即時／盤後、行情日期；沒有之前的資料也照實說", () => {
  const codes = ["2330", "NVDA"];
  const a = step({ ok: true, fetchedAt: "2026-11-05T02:00:00Z", quotes: [q("2330"), q("NVDA", { dataDate: "2026-11-04", source: "Yahoo Finance", updateMode: "scheduled" })] }, null, codes, "x");
  const b = step(null, a.items, codes, "x");
  assert.equal(b.meta.ok, false); assert.deepEqual(J(b.meta.sources), ["證交所 MIS", "Yahoo Finance"]); assert.deepEqual(J(b.meta.modes), ["after_close", "scheduled"]);
  assert.equal(b.meta.dataFrom, "2026-11-04"); assert.equal(b.meta.dataTo, "2026-11-05"); assert.equal(b.meta.fetchedAt, null, "這次沒有取得時間");
  const D = S.describe(b.meta); assert.equal(D.level, "error"); assert.equal(D.parts[0], "這次拿不到報價");
  assert.match(D.parts[1], /2330、NVDA 沿用 11-05 10:00 取得的資料/); assert.ok(D.parts.includes("來源 證交所 MIS、Yahoo Finance"));
  const e = step({ ok: false, error: "暫停服務" }, null, codes, "x"); assert.equal(S.describe(e.meta).parts[0], "這次拿不到報價（暫停服務），也沒有之前的資料"); assert.deepEqual(J(e.meta.missing), codes);
});

test("過期依交易日：週末、休市日不算；中間隔了交易日才算過期；日曆不知道就是「無法確認」", () => {
  const f = (c, d, today = "2026-11-05") => S.freshOf(c, d, { ...cal, today });
  assert.equal(f("2330", "2026-11-05"), "ok");
  assert.equal(f("2330", "2026-11-04"), "ok", "昨天收盤、今天還沒有新行情");
  assert.equal(f("2330", "2026-11-03"), "stale", "中間的 11-04 是交易日");
  assert.equal(f("2330", "2026-10-30", "2026-11-03"), "ok", "週五 → 週二：週末＋週一（台股休市）都不算");
  assert.equal(f("NVDA", "2026-10-30", "2026-11-03"), "stale", "美股週一有開盤");
  assert.equal(f("2330", "2026-10-28", "2026-11-02"), "unsure", "10-29、10-30 日曆不知道");
  assert.equal(f("2330", null), "stale", "沒有日期"); assert.equal(f("2330", "2026-08-01"), "stale", "超過 40 天");
  assert.equal(S.freshOf("2330", "2026-11-04", {}), "unsure", "不知道今天是哪天");
  // 沒給交易日曆：只知道週末，平日不知道 → 無法確認，不當成正常
  assert.equal(S.freshOf("2330", "2026-11-03", { today: "2026-11-05" }), "unsure"); assert.equal(S.freshOf("2330", "2026-10-30", { today: "2026-11-02" }), "ok", "只隔週末");
  // 同市場比其他持股舊也算過期；美股只和美股比
  const { meta } = step({ ok: true, quotes: [q("2330"), q("2317", { dataDate: "2026-11-04" }), q("2454", { dataDate: null, date: null }), q("NVDA", { dataDate: "2026-11-04" })] }, null, ["2330", "2317", "2454", "NVDA", "2603"], "x");
  assert.deepEqual(J(meta.stale), ["2317", "2454"]); assert.deepEqual(J(meta.missing), ["2603"]);
  const t = S.describe(meta).parts.join("・"); for (const k of ["4/5 檔有資料", "缺 2603", "2317、2454 的行情不是最新的"]) assert.ok(t.includes(k), k);
  const u = step({ ok: true, quotes: [q("2330", { dataDate: "2026-10-28" })] }, null, ["2330"], "x", { ...cal, today: "2026-11-02" });
  assert.deepEqual(J(u.meta.unsure), ["2330"]); assert.match(S.describe(u.meta).parts.join(), /2330 無法確認是不是最新（沒有交易日曆）/); assert.equal(S.describe(u.meta).level, "warn");
});

test("價格表沿用、備援、離線快取、日 K", () => {
  const P = S.keepLast(new Map([["2330", 99], ["2317", 50]]), new Map([["2330", 101]]), ["2330", "2317"]);
  assert.equal(P.data.get("2330"), 101); assert.equal(P.data.get("2317"), 50); assert.deepEqual(J(P.kept), ["2317"]);
  assert.deepEqual(J(S.keepLast(null, {}, ["2330"])), { data: {}, kept: [] }, "上一次也沒有：不編資料");
  const { meta } = step({ ok: true, isFallback: true, swCachedAt: Date.parse("2026-11-05T01:00:00Z"), quotes: [q("2330")] }, null, ["2330"], "x");
  const t = S.describe(meta).parts.join("・"); assert.match(t, /用了備援來源/); assert.match(t, /含離線快取（11-05 09:00 存的），不是最新/);
  const k = (d, o = {}) => ({ ok: true, source: "證交所", data: [{ d: "2026-11-03", c: 1 }, { d, c: 1 }], ...o });
  const cur = S.klineItems({ 2330: k("2026-11-05"), 2454: null }, "2026-11-05T07:00:00Z"), M = S.mergeItems(null, cur.items, ["2330", "2454"]), K = S.summarize("kline", cur, M.items, ["2330", "2454"], cal);
  assert.deepEqual(J(K.missing), ["2454"]); assert.match(S.describe(K).parts.join(), /日收盤/);
  const F = S.klineItems({ 2330: null }, "x"); assert.equal(F.ok, false); assert.match(S.describe(S.summarize("kline", F, {}, ["2330"], cal)).parts[0], /這次拿不到日 K/);
});
