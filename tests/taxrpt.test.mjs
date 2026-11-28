// 年度報稅彙整（learner/taxrpt.js）：用 KLLedger 真的算一次帳本，再檢查年度股利、扣款、已實現、手續費、海外所得與 CSV。期望值手算。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
for (const f of ["ledger.js", "taxrpt.js"]) vm.runInContext(readFileSync(new URL(`../learner/${f}`, import.meta.url), "utf8"), ctx);
const { KLLedger: LG, KLTaxRpt: T } = ctx, J = x => JSON.parse(JSON.stringify(x));
const tx = (id, date, type, symbol, o = {}) => ({ v: 1, id, date, type, symbol, market: /^\d/.test(symbol) ? "tw" : "us", currency: /^\d/.test(symbol) ? "TWD" : "USD", fee: 0, tax: 0, ...o });
const TXS = [
  tx("a", "2025-03-01", "buy", "2330", { shares: 1000, price: 500, fee: 712 }),
  tx("b", "2025-07-10", "dividend", "2330", { amount: 30000, tax: 633 }),            // 單筆 3 萬，有扣二代健保
  tx("c", "2025-10-09", "dividend", "2330", { amount: 25000 }),                      // 單筆 2.5 萬，帳本沒記扣款
  tx("d", "2025-11-01", "sell", "2330", { shares: 400, price: 600, fee: 342, tax: 720 }),
  tx("e", "2025-02-01", "buy", "NVDA", { shares: 100, price: 100, fee: 1 }),
  tx("f", "2025-06-01", "dividend", "NVDA", { amount: 40, tax: 12 }),                // 預扣 30%
  tx("g", "2025-09-01", "sell", "NVDA", { shares: 50, price: 160, fee: 1 }),
  tx("h", "2025-04-01", "buy", "AAPL", { shares: 10, price: 200 }),
  tx("i", "2025-12-01", "sell", "AAPL", { shares: 10, price: 150 }),
  tx("j", "2026-01-15", "dividend", "2330", { amount: 5000 }),
];
const L = LG.buildLedger(TXS, { method: "avg" });

test("年度彙整：台股股利總額、扣款、漏記二代健保提醒、已實現、手續費與證交稅", () => {
  const R = T.build({ L, txs: TXS, year: 2025, fx: 32 });
  assert.equal(R.year, "2025");
  assert.deepEqual(J([R.tw.divGross, R.tw.divTax, R.tw.divNet, R.tw.divN]), [55000, 633, 54367, 2], "2026 年的股息不算");
  // 賣 400 股：收入 240,000 − 342 − 720 ＝ 238,938；成本 (500,000 ＋ 712) × 0.4 ＝ 200,284.8
  assert.equal(R.tw.realized, 38653.2); assert.deepEqual(J([R.tw.fees, R.tw.tradeTax, R.tw.sold]), [1054, 720, 240000]);
  assert.deepEqual(J(R.nhiMiss), [{ symbol: "2330", date: "2025-10-09", amount: 25000, est: 528 }], "2.5 萬 × 2.11% ≈ 528");
});

test("美股：股息與預扣、已實現盈虧互抵、海外所得換算與 100 萬門檻", () => {
  const R = T.build({ L, txs: TXS, year: "2025", fx: 32 });
  assert.deepEqual(J([R.us.divGross, R.us.divTax, R.us.divN]), [40, 12, 1]);
  // NVDA 賣 50 股：8,000 − 1 − (10,001 × 0.5 ＝ 5,000.5) ＝ 2,998.5；AAPL：1,500 − 2,000 ＝ −500
  assert.deepEqual(J([R.us.realized, R.us.gain, R.us.loss]), [2498.5, 2998.5, -500]);
  assert.deepEqual(J(R.overseas), { usd: 2538.5, twd: 81232, fx: 32, over: false, min: 1000000 });
  assert.equal(T.build({ L, txs: TXS, year: 2025 }).overseas.twd, null, "沒有匯率不換算");
  assert.equal(T.build({ L, txs: TXS, year: 2025, fx: 400 }).overseas.over, true);
  // 美股全年虧損：海外所得只算股息
  const L2 = LG.buildLedger([TXS[7], TXS[8]], { method: "avg" });
  assert.equal(T.build({ L: L2, txs: [TXS[7], TXS[8]], year: 2025, fx: 30 }).overseas.usd, 0);
});

test("每檔明細、年份清單、沒有資料的年份、CSV 跳脫與 BOM", () => {
  const R = T.build({ L, txs: TXS, year: 2025, fx: 32 });
  assert.deepEqual(J(R.rows.map(r => [r.symbol, r.divGross, r.divTax, r.realized])), [["2330", 55000, 633, 38653.2], ["NVDA", 40, 12, 2998.5], ["AAPL", 0, 0, -500]]);
  assert.deepEqual(J(T.years(TXS)), ["2026", "2025"]);
  assert.equal(T.build({ L, txs: TXS, year: 2024 }).empty, true);
  const csv = T.toCSV(R, c => (c === "2330" ? "=台積電" : c));
  assert.ok(csv.startsWith("﻿年度,市場,代號")); assert.match(csv, /2025,台股,2330,'=台積電,TWD,55000,633,38653\.2/); assert.match(csv, /美股小計,,,USD,40,12,2498\.5/); assert.match(csv, /海外所得（估）,,,TWD,81232/);
});
