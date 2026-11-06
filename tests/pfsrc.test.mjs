// 資料來源與更新標示（learner/pfsrc.js）：來源、即時／盤後、行情日期、取得時間、完整、過期、備援、離線快取；失敗時沿用上一次的資料。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/pfsrc.js", import.meta.url), "utf8"), ctx);
const S = ctx.KLPfSrc, J = x => JSON.parse(JSON.stringify(x));
const q = (code, o = {}) => ({ code, price: 100, dataDate: "2026-11-05", source: "證交所 MIS", updateMode: "after_close", ...o });

test("報價：來源、盤後、行情日期、取得時間、全部都有 → ok", () => {
  const M = S.quoteMeta({ ok: true, fetchedAt: "2026-11-05T06:40:00Z", quotes: [q("2330"), q("2317")] }, ["2330", "2317"], { today: "2026-11-05" });
  assert.equal(M.ok, true); assert.equal(M.got, 2); assert.deepEqual(J(M.missing), []); assert.deepEqual(J(M.stale), []); assert.equal(M.dataTo, "2026-11-05");
  const D = S.describe(M); assert.equal(D.level, "ok");
  assert.deepEqual(J(D.parts), ["來源 證交所 MIS", "盤後", "行情日期 2026-11-05", "取得 11-05 14:40", "2 檔都有"]);
});

test("部分資料、過期、沒有日期、備援來源 → warn，並列出代號", () => {
  const M = S.quoteMeta({ ok: true, isFallback: true, quotes: [q("2330"), q("2317", { dataDate: "2026-11-04" }), q("2454", { dataDate: null, date: null }), q("NVDA", { dataDate: "2026-11-04", source: "Yahoo Finance", updateMode: "scheduled" })] },
    ["2330", "2317", "2454", "2603", "NVDA"], { today: "2026-11-05" });
  assert.deepEqual(J(M.missing), ["2603"]); assert.deepEqual(J(M.stale), ["2317", "2454"], "比同市場最新的舊、沒有日期；美股只和美股比");
  assert.deepEqual(J(M.sources), ["證交所 MIS", "Yahoo Finance"]); assert.deepEqual(J(M.modes), ["after_close", "scheduled"]);
  const D = S.describe(M); assert.equal(D.level, "warn"); const t = D.parts.join("・");
  for (const k of ["4/5 檔", "缺 2603", "2317、2454 的行情不是最新的", "用了備援來源", "盤後／定時更新（可能延遲）", "行情日期 2026-11-04～2026-11-05"]) assert.ok(t.includes(k), k);
  // 比今天早超過 5 天也算過期（就算同市場只有它一檔）
  assert.deepEqual(J(S.quoteMeta({ ok: true, quotes: [q("2330", { dataDate: "2026-10-20" })] }, ["2330"], { today: "2026-11-05" }).stale), ["2330"]);
});

test("抓失敗：沿用上一次的資料，標示沿用與當時的取得時間 → error", () => {
  const prev = new Map([["2330", { price: 99 }], ["2317", { price: 50 }]]);
  const M = S.quoteMeta(null, ["2330", "2317"]); assert.equal(M.ok, false); assert.equal(M.got, 0);
  const K = S.keepLast(prev, new Map(), ["2330", "2317"]); assert.equal(K.data.get("2330").price, 99); assert.deepEqual(J(K.kept), ["2330", "2317"]);
  M.kept = K.kept; M.keptAt = "2026-11-05T05:00:00Z";
  const D = S.describe(M); assert.equal(D.level, "error"); assert.match(D.parts[0], /這次拿不到報價，沿用 11-05 13:00 取得的資料/);
  // 部分成功：只有沒拿到的沿用，拿到的用新的
  const P = S.keepLast({ 2330: { price: 99 }, 2317: { price: 50 } }, { 2330: { price: 101 } }, ["2330", "2317"]);
  assert.equal(P.data["2330"].price, 101); assert.equal(P.data["2317"].price, 50); assert.deepEqual(J(P.kept), ["2317"]);
  // 上一次也沒有：不編資料
  assert.deepEqual(J(S.keepLast(null, {}, ["2330"])), { data: {}, kept: [] });
});

test("日 K：最後一根的日期、缺的代號、離線快取標示", () => {
  const k = (d, o = {}) => ({ ok: true, source: "證交所", data: [{ d: "2026-11-03", c: 1 }, { d, c: 1 }], ...o });
  const M = S.klineMeta({ 2330: k("2026-11-05"), 2317: k("2026-11-04", { swCachedAt: Date.parse("2026-11-04T08:00:00Z") }), 2454: null }, ["2330", "2317", "2454"], { today: "2026-11-05", now: "2026-11-05T07:00:00Z" });
  assert.equal(M.ok, true); assert.deepEqual(J(M.missing), ["2454"]); assert.deepEqual(J(M.stale), ["2317"]); assert.ok(M.cachedAt);
  const t = S.describe(M).parts.join("・"); assert.match(t, /日收盤/); assert.match(t, /離線快取（11-04 16:00 存的），不是最新/); assert.match(t, /2\/3 檔/);
  const F = S.klineMeta({ 2330: null }, ["2330"]); assert.equal(F.ok, false); assert.match(S.describe(F).parts[0], /這次拿不到日 K/);
});
