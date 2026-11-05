// 資產配置（learner/alloc.js）：權重、分布、集中度、現金比重、匯率換算、ETF 穿透（曝險、未揭露、重疊、與直接持股重複）、資料日期不同與過期、沒有匯率不合併。固定假資料，期望值手算。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/alloc.js", import.meta.url), "utf8"), ctx);
const A = ctx.KLAlloc, J = x => JSON.parse(JSON.stringify(x)), near = (a, b, t = 1e-4) => Math.abs(a - b) < t;
const tw = (symbol, value, o = {}) => ({ symbol, market: "tw", currency: "TWD", value, assetType: /^00/.test(symbol) ? "etf" : "stock", ...o });
const us = (symbol, value, o = {}) => ({ symbol, market: "us", currency: "USD", value, assetType: "stock", ...o });

test("權重與分布：美元用匯率換成台幣；現金算進總資產；市場、類型、幣別、產業加總都是 100%", () => {
  const R = A.build([tw("2330", 600000, { industry: "半導體業" }), tw("2882", 100000, { industry: "金融保險業" }), us("NVDA", 5000, { industry: "Semiconductors" })], { fx: { rate: 30, date: "2026-11-04" }, cash: { TWD: 150000 } });
  assert.equal(R.status, "ok"); assert.equal(R.total, 1000000); assert.ok(near(R.cashShare, 0.15));
  assert.deepEqual(J(R.holdings.map(h => [h.symbol, h.w])), [["2330", 0.6], ["NVDA", 0.15], ["2882", 0.1]]);
  assert.deepEqual(J(R.byMarket), [{ group: "tw", w: 0.7 }, { group: "us", w: 0.15 }, { group: "cash", w: 0.15 }]);
  assert.deepEqual(J(R.byCurrency), [{ group: "TWD", w: 0.85 }, { group: "USD", w: 0.15 }]);
  for (const g of [R.byMarket, R.byType, R.byCurrency, R.byIndustry]) assert.ok(near(g.reduce((s, x) => s + x.w, 0), 1));
  assert.equal(R.concentration.top.symbol, "2330"); assert.ok(near(R.concentration.hhi, 0.36 + 0.0225 + 0.01));
  // 有效檔數用持股（不含現金）的權重：0.6/0.85、0.15/0.85、0.1/0.85
  const w = [0.6, 0.15, 0.1].map(x => x / 0.85); assert.ok(near(R.concentration.effN, 1 / w.reduce((s, x) => s + x * x, 0), 0.01));
});

test("沒有匯率：台股、美股各自算，不把美元當台幣相加", () => {
  const R = A.build([tw("2330", 100), us("NVDA", 100)], {});
  assert.equal(R.status, "no_fx"); assert.equal(R.byCurrency.TWD.total, 100); assert.equal(R.byCurrency.USD.total, 100); assert.equal(R.byCurrency.TWD.holdings[0].w, 1);
});

test("ETF 穿透：ETF 權重 × 成分股占比；加上直接持有＝實際曝險；只揭露部分的歸到「其他（未揭露）」", () => {
  const etf = { "0050": { date: "2026-11-01", rows: [{ code: "2330", name: "台積電", pct: 60 }, { code: "2317", name: "鴻海", pct: 5 }], ind: { date: "2026-10-31", rows: [{ name: "半導體", pct: 70 }, { name: "金融保險", pct: 10 }] } } };
  const R = A.build([tw("0050", 500000), tw("2330", 500000, { industry: "半導體業" })], { etf, asOf: "2026-11-05" });
  const e = Object.fromEntries(R.lookThrough.exposure.map(x => [x.code || x.name, x]));
  assert.ok(near(e["2330"].w, 0.5 + 0.5 * 0.6)); assert.ok(near(e["2330"].direct, 0.5)); assert.ok(near(e["2330"].viaEtf, 0.3));
  assert.ok(near(e["2317"].w, 0.025)); assert.ok(near(e["其他（未揭露）"].w, 0.5 * 0.35));
  assert.ok(near(R.lookThrough.exposure.reduce((s, x) => s + x.w, 0), 1), "穿透後加總仍是 100%");
  assert.deepEqual(J(R.lookThrough.dupDirect.map(d => [d.code, d.via])), [["2330", ["0050"]]], "直接持有又在 ETF 裡");
  assert.ok(R.issues.some(x => x.k === "etf_partial"), "只揭露 65%");
  // 產業穿透：ETF 的產業分布 × 權重，加上直接持股的產業
  const I = Object.fromEntries(R.byIndustryLookThrough.map(g => [g.group, g.w])); assert.ok(near(I["半導體"], 0.35 + 0.5), "「半導體業」和「半導體」合併成同一列"); assert.equal(I["半導體業"], undefined); assert.ok(near(I["其他（未揭露）"], 0.5 * 0.2));
});

test("ETF 重疊度：共同成分股占比取小的加總；兩檔資料日期不同要標示；超過 45 天標過期；沒有成分股資料的不穿透", () => {
  const etf = { "0050": { date: "2026-11-01", rows: [{ code: "2330", pct: 50 }, { code: "2454", pct: 10 }, { code: "2317", pct: 5 }] },
    "006208": { date: "2026-09-01", rows: [{ code: "2330", pct: 45 }, { code: "2454", pct: 12 }, { code: "2603", pct: 3 }] } };
  const R = A.build([tw("0050", 100), tw("006208", 100), tw("00878", 100)], { etf, asOf: "2026-11-05" });
  const p = R.lookThrough.pairs[0]; assert.equal(p.a, "0050"); assert.equal(p.b, "006208"); assert.equal(p.overlap, 45 + 10); assert.equal(p.sameDate, false);
  assert.ok(R.issues.some(x => x.k === "etf_dates_differ")); assert.ok(R.issues.some(x => x.k === "etf_holdings_stale" && x.list[0].etf === "006208"));
  assert.ok(R.issues.some(x => x.k === "etf_no_holdings" && x.codes[0] === "00878")); assert.equal(R.status, "estimated");
  assert.ok(A.ISSUE_LABEL.etf_dates_differ);
});

test("市值用成本估算的持股要標示；空的回 empty", () => {
  const R = A.build([tw("2330", 100, { valueEstimated: true })], {}); assert.equal(R.status, "estimated"); assert.ok(R.issues.some(x => x.k === "value_estimated"));
  assert.equal(A.build([], {}).status, "empty");
});

test("ETF 有報價但完全沒有成分股資料：狀態是「含估算」、列出沒穿透的 ETF、曝險保留 ETF 本身並標未穿透", () => {
  const R = A.build([tw("00878", 600), tw("2330", 400, { industry: "半導體業" })], { etf: {} });
  assert.equal(R.status, "estimated"); assert.ok(R.issues.some(x => x.k === "etf_no_holdings" && x.codes[0] === "00878"));
  const e = R.lookThrough.exposure.find(x => x.code === "00878"); assert.ok(near(e.w, 0.6)); assert.equal(e.notLookedThrough, true); assert.equal(e.viaEtf, 0, "不把 ETF 當成分股明細");
  assert.equal(R.lookThrough.exposure.find(x => x.code === "2330").notLookedThrough, undefined);
});
