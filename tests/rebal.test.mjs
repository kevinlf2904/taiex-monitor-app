// 目標配置與再平衡試算（learner/rebal.js）：偏離、買賣股數（整數、賣不超過持有）、費用（用帳本的費用規則）、調整後現金、容許範圍、沒設目標不動、加總檢查、現金不夠、沒有匯率／報價。期望值手算
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
for (const f of ["ledger.js", "rebal.js"]) vm.runInContext(readFileSync(new URL("../learner/" + f, import.meta.url), "utf8"), ctx);
const { KLRebal: R, KLLedger: LG } = ctx, J = x => JSON.parse(JSON.stringify(x)), costs = t => LG.estimateCosts(t);
// 2330：1,000 股 × 100 ＝ 100,000；NVDA：10 股 × US$100 × 30 ＝ 30,000；現金 70,000 → 總資產 200,000
const POS = [{ symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 100 }, { symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100 }];
const row = (P, c) => P.rows.find(r => r.symbol === c);

test("偏離超過容許範圍：算出買賣股數、費用、調整後現金", () => {
  const P = R.plan({ positions: POS, fx: 30, cash: 70000, targets: { 2330: 40, NVDA: 20 }, band: 4, costs });
  assert.equal(P.total, 200000);
  const a = row(P, "2330"), b = row(P, "NVDA");
  // 2330 目前 50%、目標 40% → 要減 20,000 → 賣 200 股；手續費 20,000×0.1425%＝28.5 → 28（無條件捨去）、證交稅 0.3%＝60
  assert.equal(a.action, "sell"); assert.equal(a.tradeShares, 200); assert.equal(a.fee, 28); assert.equal(a.tax, 60); assert.equal(a.weightAfter, 0.4); assert.equal(a.lots, 0); assert.equal(a.odd, 200);
  // NVDA 目前 15%、目標 20%（差 5 > 4）→ 要加 10,000 → 10,000 ÷（100×30）＝3.33 → 買 3 股＝US$300＝9,000；美股預設零佣金
  assert.equal(b.action, "buy"); assert.equal(b.tradeShares, 3); assert.equal(b.grossBase, 9000); assert.equal(b.costBase, 0);
  assert.equal(P.cashAfter, 70000 + (20000 - 88) - 9000, "70,000 ＋ 賣出淨得 19,912 − 買進 9,000"); assert.equal(P.fees, 88); assert.equal(P.turnover, 29000);
});

test("容許範圍內不動；沒設目標的持股維持原樣；不到一股不動", () => {
  const P = R.plan({ positions: POS, fx: 30, cash: 70000, targets: { 2330: 48 }, band: 5, costs });
  assert.equal(row(P, "2330").action, "hold"); assert.equal(row(P, "2330").reason, "within_band");
  assert.equal(row(P, "NVDA").action, "keep"); assert.equal(row(P, "NVDA").reason, "no_target");
  const Q = R.plan({ positions: [{ symbol: "2330", market: "tw", currency: "TWD", shares: 10, price: 1000 }], cash: 10, targets: { 2330: 0 }, band: 0, costs });
  assert.equal(row(Q, "2330").action, "sell"); assert.equal(row(Q, "2330").tradeShares, 10, "目標 0%：全部賣掉，不超過持有");
  const S = R.plan({ positions: [{ symbol: "2330", market: "tw", currency: "TWD", shares: 1, price: 1000 }], cash: 9000, targets: { 2330: 12 }, band: 0, costs });
  assert.equal(row(S, "2330").reason, "less_than_one_share", "差 200 元，不到一股 1,000 元");
});

test("加總檢查、現金不夠、沒有記現金、沒有匯率或報價", () => {
  const A = R.plan({ positions: POS, fx: 30, cash: 70000, targets: { 2330: 50, NVDA: 30, CASH: 30 }, costs });
  assert.ok(A.issues.some(x => x.k === "sum" && x.sum === 110));
  const B = R.plan({ positions: POS, fx: 30, cash: 0, targets: { 2330: 50, NVDA: 50 }, band: 1, costs });
  // 總資產 130,000：NVDA 目標 65,000、目前 30,000 → 要買 11 股＝33,000；2330 目標 65,000、目前 100,000 → 賣 350 股＝35,000 拿回（扣費）→ 現金仍是正的
  assert.equal(row(B, "NVDA").tradeShares, 11); assert.equal(row(B, "2330").tradeShares, 350); assert.ok(!B.issues.some(x => x.k === "cash_short"));
  const C = R.plan({ positions: POS, fx: 30, cash: 0, targets: { NVDA: 50 }, band: 1, costs });
  assert.ok(C.issues.some(x => x.k === "cash_short" && x.need > 30000), "只加碼不賣：現金不夠");
  assert.ok(C.issues.some(x => x.k === "over" && x.sum > 100), "2330 沒設目標（目前約 77%）＋ NVDA 50% 超過 100% → 標示");
  const D = R.plan({ positions: POS, fx: null, cash: null, targets: { 2330: 50 }, costs });
  assert.ok(D.issues.some(x => x.k === "no_fx" && x.codes.includes("NVDA"))); assert.ok(D.issues.some(x => x.k === "no_cash")); assert.equal(D.total, 100000);
  const E = R.plan({ positions: [{ symbol: "2330", market: "tw", currency: "TWD", shares: 1, price: null }], cash: null, targets: {} });
  assert.equal(E.status, "invalid");
});

test("存檔檢查", () => {
  assert.equal(R.validateStore({ v: 1, targets: { 2330: 40, CASH: 10 }, band: 5 }).ok, true);
  assert.equal(R.validateStore({ v: 2, targets: {} }).code, "unsupported_version");
  const bad = R.validateStore({ v: 1, targets: { "壞 代號": 1, NVDA: 120, AAPL: -1 }, band: 99 });
  assert.equal(bad.ok, false); assert.deepEqual(J(bad.errors.map(e => e.error)).sort(), ["invalid_band", "invalid_code", "invalid_weight", "invalid_weight"]);
});
