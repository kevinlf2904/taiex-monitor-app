// 交易紀錄引擎（learner/ledger.js）：驗證、加權平均與 FIFO 成本、已實現損益、股息、拆股合股、配股、轉入轉出、現金、費用規則、重複與賣超、搬移預覽、存檔檢查。固定假資料，不連外部服務。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/ledger.js", import.meta.url), "utf8"), ctx);
const L = ctx.KLLedger, J = x => JSON.parse(JSON.stringify(x));
let n = 0; const tw = (o) => ({ id: "t" + ++n, market: "tw", currency: "TWD", symbol: "2330", fee: 0, tax: 0, ...o });
const us = (o) => ({ id: "u" + ++n, market: "us", currency: "USD", symbol: "NVDA", fee: 0, tax: 0, ...o });
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const pos = (R, s = "2330") => R.positions.find(p => p.symbol === s);
const codes = x => x.errors.map(e => e.code);

test("加權平均：分批買進、部分賣出、全數賣出；成本含買進手續費，賣出扣手續費與交易稅", () => {
  const R = L.buildLedger([tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 500, fee: 712 }), tw({ date: "2026-02-05", type: "buy", shares: 1000, price: 600, fee: 855 }),
    tw({ date: "2026-03-05", type: "sell", shares: 500, price: 700, fee: 498, tax: 1050 }), tw({ date: "2026-04-01", type: "sell", shares: 1500, price: 650, fee: 1389, tax: 2925 })], { method: "avg" });
  assert.equal(R.status, "ok");
  const basis = 500712 + 600855, avg = basis / 2000, p1 = 500 * 700 - 498 - 1050 - avg * 500, p2 = 1500 * 650 - 1389 - 2925 - avg * 1500;
  const p = pos(R); assert.equal(p.shares, 0); assert.equal(p.open, false); assert.ok(near(p.realizedPnl, Math.round((p1 + p2) * 100) / 100, 0.011));
  assert.equal(p.history[2].shares, 1500); assert.ok(near(p.history[2].avgCost, avg), "部分賣出後平均成本不變");
  assert.equal(R.totals.TWD.fees, 712 + 855 + 498 + 1389); assert.equal(R.totals.TWD.taxes, 1050 + 2925);
});

test("FIFO：先賣最早的批次，已實現損益和加權平均不同；兩種方法不混用", () => {
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 500 }), tw({ date: "2026-02-05", type: "buy", shares: 1000, price: 600 }), tw({ date: "2026-03-05", type: "sell", shares: 1500, price: 700 })];
  const F = L.buildLedger(T, { method: "fifo" }), A = L.buildLedger(T, { method: "avg" });
  assert.equal(pos(F).realizedPnl, 1500 * 700 - 500000 - 500 * 600); assert.equal(pos(F).costBasis, 500 * 600); assert.deepEqual(J(pos(F).lots.map(l => [l.shares, l.cost])), [[500, 300000]]);
  assert.equal(pos(A).realizedPnl, 1500 * 700 - 1500 * 550); assert.equal(pos(A).lots, null);
  assert.equal(L.buildLedger(T, { method: "lifo" }).error, "invalid_method");
  assert.equal(L.validateStore({ v: 1, method: "mixed", transactions: [] }).code, "invalid_method");
});

test("防止：賣超、負股數、無效價格、不合理日期、幣別錯誤、台股零碎股數、重複編號；錯誤的交易不套用", () => {
  const R = L.buildLedger([tw({ id: "a", date: "2026-01-05", type: "buy", shares: 100, price: 10 }), tw({ date: "2026-01-06", type: "sell", shares: 200, price: 10 }),
    tw({ date: "2026-01-07", type: "buy", shares: -5, price: 10 }), tw({ date: "2026-01-07", type: "buy", shares: 5, price: 0 }), tw({ date: "2026-02-30", type: "buy", shares: 5, price: 1 }),
    tw({ date: "2027-01-01", type: "buy", shares: 5, price: 1 }), tw({ date: "2026-01-08", type: "buy", shares: 5, price: 1, currency: "USD" }), tw({ date: "2026-01-08", type: "buy", shares: 1.5, price: 1 }),
    tw({ id: "a", date: "2026-01-09", type: "buy", shares: 5, price: 1 }), tw({ date: "1980-01-01", type: "buy", shares: 5, price: 1 })], { today: "2026-11-04" });
  assert.deepEqual(J(R.txs.map(x => codes(x)[0] ?? null)), [null, "oversell", "invalid_shares", "invalid_price", "invalid_date", "future_date", "currency_mismatch", "fractional_shares", "duplicate_id", "date_too_old"]);
  assert.equal(pos(R).shares, 100, "只有第一筆套用"); assert.equal(R.status, "has_errors"); assert.equal(R.errorCount, 9);
  assert.equal(L.buildLedger([us({ date: "2026-01-05", type: "buy", shares: 0.5, price: 100 })]).status, "ok", "美股可以有零股");
});

test("同一代號前後市場或幣別不同 → 錯誤；內容完全一樣的兩筆 → 提醒可能重複", () => {
  const R = L.buildLedger([tw({ date: "2026-01-05", type: "buy", shares: 100, price: 10 }), us({ symbol: "2330", date: "2026-01-06", type: "buy", shares: 1, price: 1 }), tw({ date: "2026-01-05", type: "buy", shares: 100, price: 10 })]);
  assert.equal(codes(R.txs[1])[0], "currency_conflict"); assert.ok(R.txs[2].warnings.some(w => w.code === "possible_duplicate")); assert.equal(pos(R).shares, 200);
});

test("手續費：沒填才依規則估算並標示；填 0 就是 0；另計的費用不能和交易本身的手續費重複", () => {
  const R = L.buildLedger([tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 100, fee: null, tax: null }), tw({ date: "2026-01-06", type: "sell", shares: 1000, price: 110, fee: null, tax: null })]);
  const b = R.txs[0].tx, s = R.txs[1].tx;
  assert.equal(b.fee, 142); assert.equal(b.tax, 0); assert.equal(b.feeEstimated, true); assert.equal(s.fee, 156); assert.equal(s.tax, 330, "股票證交稅 0.3%");
  assert.ok(R.txs[0].warnings.some(w => w.code === "fee_estimated"));
  assert.equal(L.estimateCosts({ type: "sell", market: "tw", shares: 1000, price: 100, assetType: "etf" }).tax, 100, "ETF 0.1%");
  assert.equal(L.estimateCosts({ type: "buy", market: "tw", shares: 10, price: 50 }).fee, 20, "最低手續費");
  assert.equal(L.estimateCosts({ type: "buy", market: "tw", shares: 10, price: 50 }, { tw: { ...L.DEFAULT_RULES.tw, minFee: 1 } }).fee, 1, "規則可換");
  assert.equal(L.buildLedger([tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 100, fee: 0 })]).txs[0].tx.fee, 0);
  const D = L.buildLedger([tw({ id: "b1", date: "2026-01-05", type: "buy", shares: 1000, price: 100, fee: 142 }), tw({ symbol: null, date: "2026-01-05", type: "fee", amount: 142, ref: "b1" })]);
  assert.equal(codes(D.txs[1])[0], "duplicate_fee");
  const E = L.buildLedger([tw({ id: "b2", date: "2026-01-05", type: "buy", shares: 1000, price: 100, fee: null, tax: null }), tw({ symbol: null, date: "2026-01-05", type: "fee", amount: 100, ref: "b2" })]);
  assert.equal(E.txs[0].tx.fee, 0, "另外記了費用，原交易不再估算"); assert.equal(E.totals.TWD.fees, 100);
});

test("股息、配股（除權）、拆股、合股：成本與股數正確；股息另計不改成本", () => {
  const R = L.buildLedger([tw({ date: "2025-01-02", type: "buy", shares: 1000, price: 100 }), tw({ date: "2025-07-10", type: "dividend", amount: 5000 }),
    tw({ date: "2025-08-01", type: "stock_dividend", shares: 100 }), tw({ date: "2025-09-01", type: "split", ratio: 4 }), tw({ date: "2025-10-01", type: "split", ratio: 0.5 })]);
  const p = pos(R); assert.equal(p.shares, 2200); assert.equal(p.costBasis, 100000); assert.ok(near(p.avgCost, 100000 / 2200)); assert.equal(p.dividends, 5000); assert.equal(R.totals.TWD.dividends, 5000);
  const U = L.buildLedger([us({ date: "2025-01-02", type: "buy", shares: 10, price: 100 }), us({ date: "2025-03-01", type: "dividend", amount: 10, tax: 3 })]);
  assert.equal(pos(U, "NVDA").dividends, 7, "美股股息扣掉預扣稅"); assert.equal(U.totals.USD.taxes, 3);
  const Z = L.buildLedger([tw({ date: "2025-01-02", type: "buy", shares: 1001, price: 10 }), tw({ date: "2025-02-01", type: "split", ratio: 0.1 })]);
  assert.ok(Z.txs[1].warnings.some(w => w.code === "fractional_after_split"));
  const S = L.buildLedger([tw({ date: "2025-09-01", type: "split", ratio: 4 }), tw({ date: "2025-09-01", type: "buy", shares: 100, price: 50 })]);
  assert.equal(pos(S).shares, 100, "同一天：拆股先生效，當天的買進不會被拆");
});

test("轉入轉出、入金出金：現金分幣別、台幣美元不相加；轉入不動現金", () => {
  const R = L.buildLedger([tw({ symbol: null, date: "2026-01-02", type: "deposit", amount: 1e6 }), tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 500, fee: 712 }),
    tw({ symbol: "0050", date: "2026-01-06", type: "transfer_in", shares: 2000, price: 150 }), tw({ symbol: "0050", date: "2026-02-01", type: "transfer_out", shares: 500 }),
    tw({ symbol: "0050", date: "2026-02-02", type: "transfer_out", shares: 5000 }), us({ symbol: null, date: "2026-01-02", type: "deposit", amount: 1000 }), tw({ symbol: null, date: "2026-03-01", type: "withdraw", amount: 100000 })]);
  assert.deepEqual(J(R.cash.TWD), { balance: 1e6 - 500712 - 100000, deposits: 1e6, withdrawals: 100000, tracked: true }); assert.equal(R.cash.USD.balance, 1000);
  assert.equal(pos(R, "0050").shares, 1500); assert.equal(pos(R, "0050").costBasis, 225000); assert.equal(pos(R, "0050").realizedPnl, 0, "轉出不算已實現");
  assert.equal(codes(R.txs[4])[0], "over_transfer");
});

test("未實現損益：有現價才算，沒有是 null 不是 0；已出清的部位市值 0", () => {
  const R = L.buildLedger([tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 500 }), tw({ symbol: "2317", date: "2026-01-05", type: "buy", shares: 1000, price: 100 }), tw({ symbol: "2454", date: "2026-01-05", type: "buy", shares: 10, price: 1000 }), tw({ symbol: "2454", date: "2026-02-05", type: "sell", shares: 10, price: 1100 })],
    { prices: new Map([["2330", 600]]) });
  assert.equal(pos(R).unrealizedPnl, 100000); assert.equal(pos(R, "2317").marketValue, null); assert.equal(pos(R, "2317").unrealizedPnl, null); assert.equal(pos(R, "2454").marketValue, 0);
  assert.deepEqual(J(R.positions.map(p => p.symbol)), ["2317", "2330", "2454"], "持有中的在前，出清的在後");
});

test("新增前預覽與刪除影響範圍：刪掉買進會讓後面的賣出變成賣超", () => {
  const T = [tw({ id: "x1", date: "2026-01-05", type: "buy", shares: 1000, price: 500 }), tw({ id: "x2", date: "2026-01-06", type: "buy", shares: 1000, price: 520 }), tw({ id: "x3", date: "2026-02-05", type: "sell", shares: 1500, price: 600 })];
  const before = JSON.stringify(T);
  assert.equal(L.previewAdd(T, tw({ id: "x4", date: "2026-03-01", type: "sell", shares: 1000, price: 1 })).errors[0].code, "oversell");
  const D = L.deleteImpact(T, "x2"); assert.deepEqual(J(D.affected), ["x3"]); assert.deepEqual(J(D.newErrors.map(e => [e.id, e.errors[0].code])), [["x3", "oversell"]]);
  assert.equal(D.position.before.shares, 500); assert.equal(D.position.after.shares, 1000);
  assert.equal(JSON.stringify(T), before, "不改動傳進來的資料"); assert.equal(L.deleteImpact(T, "zz").code, "not_found");
});

test("舊庫存搬移預覽：每筆變成股票轉入；範例與錯誤資料不搬；沒有日期用今天並標示；不改動原始資料", () => {
  const raw = { 2330: { sh: 1000, cost: 820, d: "2025-03-10" }, nvda: { sh: 30, cost: 120 }, "0050": { sh: 3000, cost: 150, demo: true }, 2454: { sh: -5, cost: 100 }, "bad!": { sh: 1, cost: 1 } }, before = JSON.stringify(raw);
  const M = L.previewMigration(raw, { today: "2026-11-04", idPrefix: "m", now: "2026-11-04T10:00:00+08:00" });
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(J(M.items.map(i => [i.symbol, i.action, i.problems[0]?.code ?? null])), [["2330", "migrate", null], ["2454", "skip", "invalid_shares"], ["NVDA", "migrate", "date_assumed"], ["0050", "skip", "demo"], [null, "skip", "invalid_symbol"]]);
  assert.equal(M.ok, true); assert.deepEqual(J(M.summary), { migrate: 2, skip: 3 });
  assert.deepEqual(J(M.store.transactions[1]), { v: 1, id: "m2", date: "2026-11-04", type: "transfer_in", symbol: "NVDA", market: "us", currency: "USD", shares: 30, price: 120, fee: 0, tax: 0, note: M.store.transactions[1].note, source: "legacy" });
  assert.equal(M.store.migratedFrom, "kline:watch:hold"); assert.equal(L.STORE_KEY, "kline:pf:v1");
  const V = L.validateStore(M.store); assert.equal(V.ok, true); assert.equal(V.ledger.positions.find(p => p.symbol === "2330").costBasis, 820000);
  assert.equal(L.validateStore({ v: 2, method: "avg", transactions: [] }).code, "unsupported_version"); assert.equal(L.validateStore(null).code, "invalid_root");
  assert.equal(L.previewMigration([]).code, "invalid_root");
});

test("交易格式：缺編號、壞類型、拆股比例 1、金額 0、負手續費都擋下；makeTx 補版本與編號", () => {
  const c = o => L.checkTx({ market: "tw", currency: "TWD", date: "2026-01-05", ...o }).errors.map(e => e.code);
  assert.ok(c({ type: "buy", symbol: "2330", shares: 1, price: 1 }).includes("missing_id"));
  assert.ok(c({ id: "a", type: "swap" }).includes("invalid_type")); assert.ok(c({ id: "a", type: "split", symbol: "2330", ratio: 1 }).includes("invalid_ratio"));
  assert.ok(c({ id: "a", type: "dividend", symbol: "2330", amount: 0 }).includes("invalid_amount")); assert.ok(c({ id: "a", type: "buy", symbol: "2330", shares: 1, price: 1, fee: -1 }).includes("invalid_fee"));
  assert.ok(c({ id: "a", type: "buy", symbol: "2330", shares: 1, price: 1, market: "jp" }).includes("invalid_market"));
  const t = L.makeTx({ type: "buy" }, { id: "fixed" }); assert.equal(t.id, "fixed"); assert.equal(t.v, 1);
  assert.equal(L.buildLedger([]).status, "empty");
});
