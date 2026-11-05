// 匯率與台幣合併（learner/fx.js）：美股部位用當天匯率換台幣、損益拆成股價與匯率且可對帳、合併 TWR／MWR、匯率缺漏與過期標估算。固定假資料，不連外部服務。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../learner/", import.meta.url);
const ctx = {}; vm.createContext(ctx);
for (const f of ["ledger.js", "perf.js", "fx.js"]) vm.runInContext(readFileSync(new URL(f, ROOT), "utf8"), ctx);
const { KLPerf: P, KLFx: X } = ctx;
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const S = pairs => pairs.map(([d, c]) => ({ d, c }));
const tw = o => ({ market: "tw", currency: "TWD", symbol: "2330", fee: 0, tax: 0, ...o }), us = o => ({ market: "us", currency: "USD", symbol: "NVDA", fee: 0, tax: 0, ...o });

test("只有美股：股價不動、美元升值 10% → 台幣報酬 10%，全部是匯率貢獻", () => {
  const R = P.buildPerf([us({ id: "u", date: "2026-01-05", type: "buy", shares: 10, price: 100 })], { prices: { NVDA: S([["2026-01-05", 100], ["2026-01-06", 100]]) } });
  const C = X.combine(R, S([["2026-01-05", 30], ["2026-01-06", 33]]));
  assert.ok(near(C.twr, 0.1)); assert.equal(C.pnl.usFx, 3000); assert.equal(C.pnl.usPrice, 0); assert.equal(C.pnl.total, 3000); assert.equal(C.marketValue, 33000); assert.ok(near(C.usdShare, 1));
  assert.equal(C.fx.rate, 33); assert.ok(near(C.fx.change, 0.1));
});

test("台股＋美股：合併損益＝台股損益＋美股股價＋匯率，每一部分對得上 perf.js；美股股價部分用當天匯率", () => {
  const T = [tw({ id: "a", date: "2026-01-05", type: "buy", shares: 1000, price: 100 }), us({ id: "b", date: "2026-01-05", type: "buy", shares: 10, price: 100 })];
  const R = P.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 110], ["2026-01-07", 105]]), NVDA: S([["2026-01-05", 100], ["2026-01-06", 120], ["2026-01-07", 120]]) } });
  const C = X.combine(R, S([["2026-01-05", 30], ["2026-01-06", 31], ["2026-01-07", 32]]));
  assert.equal(C.pnl.twStocks, R.byCurrency.TWD.pnl.total);
  // 美股：1/6 股價 +200 美元 × 31 ＝ 6200；匯率：1/6 昨天市值 1000 ×(31−30)＝1000，1/7 1200 ×(32−31)＝1200
  assert.equal(C.pnl.usPrice, 6200); assert.equal(C.pnl.usFx, 2200);
  assert.equal(C.pnl.total, C.pnl.twStocks + C.pnl.usPrice + C.pnl.usFx);
  assert.ok(near(C.pnl.total, C.marketValue - C.pnl.invested), "總損益＝市值 − 投入（沒有拿回的錢時）");
  assert.equal(C.pnl.usPrice + C.pnl.usFx, 1200 * 32 - 1000 * 30, "美股部位台幣損益＝現在台幣市值 − 當初台幣投入");
  // 合併 TWR 和逐日手算一致
  const V = [100000 + 1000 * 30, 110000 + 1200 * 31, 105000 + 1200 * 32], r1 = V[0] / 130000 - 1, r2 = V[1] / V[0] - 1, r3 = V[2] / V[1] - 1;
  assert.ok(near(C.twr, (1 + r1) * (1 + r2) * (1 + r3) - 1, 1e-12));
});

test("台美休市日不同：沒開市的一邊沿用前一天市值；美股的現金流用當天匯率換算", () => {
  const T = [tw({ id: "a", date: "2026-01-05", type: "buy", shares: 100, price: 100 }), us({ id: "b", date: "2026-01-06", type: "buy", shares: 1, price: 100 })];
  const R = P.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-07", 100]]), NVDA: S([["2026-01-06", 100], ["2026-01-07", 100]]) } });
  const C = X.combine(R, S([["2026-01-05", 30], ["2026-01-06", 31], ["2026-01-07", 31]]));
  const d6 = C.series.find(x => x.d === "2026-01-06"); assert.equal(d6.v, 10000 + 3100); assert.equal(d6.flow, 3100);
  assert.equal(C.pnl.invested, 10000 + 3100); assert.ok(near(C.twr, 0));
});

test("匯率缺漏或過期：標估算並說明；沒有匯率資料：無法合併；沒有美股：不需要換匯", () => {
  const T = [us({ id: "b", date: "2026-01-05", type: "buy", shares: 1, price: 100 })], R = P.buildPerf(T, { prices: { NVDA: S([["2026-01-05", 100], ["2026-01-20", 110]]) } });
  const C = X.combine(R, S([["2026-01-05", 30]])); assert.equal(C.status, "estimated"); assert.ok(C.reasons.includes("fx_stale")); assert.equal(C.mwr.status, "estimated");
  const E = X.combine(R, S([["2026-01-20", 30]])); assert.ok(E.reasons.includes("fx_missing_early"));
  assert.equal(X.combine(R, []).status, "unavailable");
  assert.equal(X.combine(P.buildPerf([tw({ id: "a", date: "2026-01-05", type: "buy", shares: 1, price: 1 })], { prices: { 2330: S([["2026-01-05", 1]]) } }), S([["2026-01-05", 30]])).status, "no_usd");
  assert.ok(X.REASON_LABEL.fx_stale);
});

test("沿用 perf.js 的估算原因（例如舊庫存轉入）；股息與賣出的美元用當天匯率換成台幣", () => {
  const T = [us({ id: "b", date: "2026-01-05", type: "buy", shares: 10, price: 100 }), us({ id: "d", date: "2026-01-06", type: "dividend", amount: 10 }), us({ id: "s", date: "2026-01-07", type: "sell", shares: 10, price: 100 }),
    tw({ id: "l", date: "2026-01-05", type: "transfer_in", shares: 1, price: 50, source: "legacy" })];
  const R = P.buildPerf(T, { prices: { NVDA: S([["2026-01-05", 100], ["2026-01-06", 100], ["2026-01-07", 100]]), 2330: S([["2026-01-05", 50], ["2026-01-07", 50]]) } });
  const C = X.combine(R, S([["2026-01-05", 30], ["2026-01-06", 31], ["2026-01-07", 32]]));
  assert.ok(C.reasons.includes("legacy_transfer"));
  // 美股：股價不動；股息 10 美元 × 31＝310 是股價與股息部分；匯率：1/6 1000×1、1/7 1000×1 ＝ 2000（1/7 收盤後賣出）
  assert.equal(C.pnl.usPrice, 310); assert.equal(C.pnl.usFx, 2000);
});

test("美股部位資料不足（零成本轉出又沒有價格）→ 合併也標無法計算，不硬算", () => {
  const R = P.buildPerf([us({ id: "s", date: "2026-01-05", type: "stock_dividend", shares: 1 }), us({ id: "o", date: "2026-01-06", type: "transfer_out", shares: 1 })], { prices: {} });
  const C = X.combine(R, S([["2026-01-05", 30]])); assert.equal(C.status, "unavailable"); assert.deepEqual([...C.reasons], ["sleeve_unavailable"]);
});
