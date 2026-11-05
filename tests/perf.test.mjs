// 績效分析引擎（learner/perf.js）：TWR、XIRR、期間報酬、最大回撤與恢復、比較基準、損益與歸因、估算標示。期望值都用另外寫的算式；固定假資料，不連外部服務。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
for (const f of ["ledger.js", "perf.js"]) vm.runInContext(readFileSync(new URL("../learner/" + f, import.meta.url), "utf8"), ctx);
const K = ctx.KLPerf, J = x => JSON.parse(JSON.stringify(x));
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;
let n = 0; const tw = o => ({ id: "t" + ++n, market: "tw", currency: "TWD", symbol: "2330", fee: 0, tax: 0, ...o });
const S = pairs => pairs.map(([d, c]) => ({ d, c }));

test("TWR：單筆買進，第一天收盤就算報酬；和直接用價格算的一樣", () => {
  const R = K.buildPerf([tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 100 })], { prices: { 2330: S([["2026-01-05", 110], ["2026-01-06", 99], ["2026-01-07", 121]]) } }).byCurrency.TWD;
  assert.ok(near(R.twr, 121 / 100 - 1)); assert.equal(R.from, "2026-01-05"); assert.equal(R.to, "2026-01-07");
  assert.equal(R.twrAnn, null, "未滿一年不年化"); assert.equal(R.annualizable, false);
});

test("TWR 不受投入時點影響、XIRR 會：先買少、漲完再加碼、之後跌", () => {
  // 1/5 買 100 股 @100；1/6 收 200（+100%）；1/6 收盤後加碼 900 股 @200；1/7 收 100（−50%）
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 100, price: 100 }), tw({ date: "2026-01-06", type: "buy", shares: 900, price: 200 })];
  const R = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 200], ["2026-01-07", 100]]) } }).byCurrency.TWD;
  assert.ok(near(R.twr, 2 * 0.5 - 1), "TWR＝(1+100%)×(1−50%)−1＝0");
  // 投資人：1/5 −10000、1/6 −180000、1/7 +100000（市值）→ 虧很多，XIRR 是很大的負數
  // 未滿一年：不年化；整段期間的資金加權報酬 rp 滿足 −10000 −180000/(1+rp)^0.5 + 100000/(1+rp) = 0
  const x = (180000 + Math.sqrt(180000 ** 2 + 4 * 100000 * 10000)) / 200000, rp = 1 / x ** 2 - 1;
  assert.equal(R.mwr.value, null); assert.equal(R.mwr.annualized, false); assert.ok(near(R.mwr.period, rp, 1e-7), `${R.mwr.period} vs ${rp}`); assert.equal(R.mwr.status, "ok");
  assert.ok(R.mwr.period < R.twr, "加碼後才跌：資金加權報酬比時間加權差");
  assert.equal(R.pnl.invested, 190000); assert.equal(R.pnl.marketValue, 100000); assert.equal(R.pnl.unrealized, -90000); assert.equal(R.pnl.total, -90000);
});

test("XIRR：投入 100、一年後市值 110 → 10%；和獨立算法一致", () => {
  assert.ok(near(K.xirr([{ d: "2025-01-01", cf: -100 }, { d: "2026-01-01", cf: 110 }]), 0.1, 1e-7));
  assert.ok(near(K.xirr([{ d: "2025-01-01", cf: -100 }, { d: "2025-01-11", cf: 105 }], 10), 0.05, 1e-7), "整段期間（不年化）");
  // 兩筆投入：解 −100 −100×(1+r)^(−0.5)… 用 NPV＝0 檢查
  const F = [{ d: "2025-01-01", cf: -100 }, { d: "2025-07-02", cf: -100 }, { d: "2026-01-01", cf: 215 }], r = K.xirr(F);
  const npv = F.reduce((s, f) => s + f.cf / Math.pow(1 + r, (Date.parse(f.d) - Date.parse(F[0].d)) / 864e5 / 365), 0); assert.ok(Math.abs(npv) < 1e-6);
  assert.equal(K.xirr([{ d: "2025-01-01", cf: -100 }]), null, "只有投入算不出來");
  assert.equal(K.xirr([{ d: "2025-01-01", cf: 100 }, { d: "2026-01-01", cf: 110 }]), null, "沒有投入算不出來");
});

test("賣出、股息是拿回的錢：TWR 把股息算進報酬；總損益＝已實現＋未實現＋股息（費稅不重複扣）", () => {
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 1000, price: 100, fee: 100 }), tw({ date: "2026-01-06", type: "dividend", amount: 5000 }), tw({ date: "2026-01-07", type: "sell", shares: 500, price: 100, fee: 50, tax: 150 })];
  const R = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 95], ["2026-01-07", 100]]) } }).byCurrency.TWD;
  // 1/5：投入 100100，市值 100000 → r1 = 100000/100100−1；1/6：（95000 −(−5000)）/100000 −1 = 0；1/7：（50000 − (−49800)）/95000 −1
  const r1 = 100000 / 100100 - 1, r2 = (95000 + 5000) / 100000 - 1, r3 = (50000 + 49800) / 95000 - 1;
  assert.ok(near(R.twr, (1 + r1) * (1 + r2) * (1 + r3) - 1, 1e-12));
  assert.equal(R.pnl.dividends, 5000); assert.equal(R.pnl.realized, 49800 - 50050); assert.equal(R.pnl.unrealized, 50000 - 50050); assert.equal(R.pnl.total, 49800 - 50050 + 50000 - 50050 + 5000);
  assert.equal(R.pnl.fees, 150); assert.equal(R.pnl.taxes, 150); assert.equal(R.pnl.invested, 100100); assert.equal(R.pnl.returned, 54800);
});

test("期間報酬：月、季、年連乘；比較基準同期間", () => {
  const T = [tw({ date: "2025-12-30", type: "buy", shares: 10, price: 100 })];
  const px = S([["2025-12-30", 100], ["2025-12-31", 110], ["2026-01-02", 99], ["2026-02-02", 108.9]]), bx = S([["2025-12-30", 1000], ["2025-12-31", 1010], ["2026-01-02", 1000], ["2026-02-02", 1100]]);
  const R = K.buildPerf(T, { prices: { 2330: px }, bench: { TWD: bx }, benchName: { TWD: "加權指數" } }).byCurrency.TWD;
  assert.deepEqual(J(R.monthly.map(m => m.p)), ["2025-12", "2026-01", "2026-02"]);
  assert.ok(near(R.monthly[0].r, 0.1)); assert.ok(near(R.monthly[1].r, -0.1)); assert.ok(near(R.monthly[2].r, 0.1));
  assert.ok(near(R.yearly[1].r, 1.1 * 0.9 * 1.1 / 1.1 - 1 + 0, 1e-12) || near(R.yearly[1].r, 0.9 * 1.1 - 1)); assert.ok(near(R.quarterly.find(q => q.p === "2026Q1").r, 0.9 * 1.1 - 1));
  assert.ok(near(R.bench.ret, 0.1)); assert.ok(near(R.bench.excess, 0.089 - 0.1)); assert.equal(R.bench.name, "加權指數"); assert.equal(R.bench.priceIndex, true);
  assert.ok(near(R.monthly[1].bench, 1000 / 1010 - 1));
});

test("最大回撤與恢復時間：從前高跌到谷底，第一次回到前高的日子", () => {
  const idx = [["2026-01-01", 1], ["2026-01-02", 1.2], ["2026-01-03", 0.9], ["2026-01-05", 1.0], ["2026-01-10", 1.2], ["2026-01-11", 1.1]].map(([d, i]) => ({ d, i }));
  assert.deepEqual(J(K.drawdown(idx)), { dd: 0.9 / 1.2 - 1, peak: "2026-01-02", trough: "2026-01-03", recovered: "2026-01-10", recoveryDays: 7, durationDays: 8 });
  const no = K.drawdown([{ d: "2026-01-01", i: 1 }, { d: "2026-01-02", i: 0.8 }]); assert.equal(no.recovered, null); assert.equal(no.recoveryDays, null);
  assert.equal(K.drawdown([{ d: "2026-01-01", i: 1 }, { d: "2026-01-02", i: 1.1 }]).dd, 0);
});

test("滿一年才年化；年化 TWR＝(1+TWR)^(365/天數)−1", () => {
  const R = K.buildPerf([tw({ date: "2024-01-01", type: "buy", shares: 1, price: 100 })], { prices: { 2330: S([["2024-01-01", 100], ["2025-06-30", 121]]) } }).byCurrency.TWD;
  assert.equal(R.annualizable, true); assert.ok(near(R.twrAnn, Math.pow(1.21, 365 / R.spanDays) - 1));
  assert.equal(R.mwr.status, "ok"); assert.ok(near(R.mwr.value, R.twrAnn, 1e-6), "只有一筆投入時 XIRR＝年化 TWR"); assert.ok(near(R.mwr.period, R.twr, 1e-6));
});

test("現金流不完整就標「估算」並列原因：舊庫存轉入、價格歷史被截斷、沒有價格用交易價", () => {
  const legacy = tw({ date: "2025-03-10", type: "transfer_in", shares: 1000, price: 500, source: "legacy" });
  const R = K.buildPerf([legacy], { prices: { 2330: S([["2025-06-02", 600], ["2026-01-05", 700]]) } }).byCurrency.TWD;
  assert.equal(R.mwr.status, "estimated"); assert.ok(["legacy_transfer", "transfer_at_cost", "history_truncated", "price_fallback"].every(k => R.mwr.reasons.includes(k)), JSON.stringify(R.mwr.reasons));
  assert.ok(R.issues.some(x => x.k === "history_truncated")); assert.ok(R.issues.some(x => x.k === "price_fallback"));
  assert.ok(K.REASON_LABEL.legacy_transfer);
  const N = K.buildPerf([tw({ date: "2026-01-05", type: "buy", shares: 1, price: 100 })], { prices: {} }).byCurrency.TWD;
  assert.ok(N.issues.some(x => x.k === "no_prices"));
});

test("歸因：每一檔損益加總＝總損益；依資產類型、產業加總；匯率沒有資料就是 null", () => {
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 100, price: 100 }), tw({ symbol: "0050", date: "2026-01-05", type: "buy", shares: 100, price: 50 }), tw({ symbol: "0050", date: "2026-01-06", type: "dividend", amount: 100 })];
  const R = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-07", 120]]), "0050": S([["2026-01-05", 50], ["2026-01-07", 45]]) }, classify: c => ({ assetType: c === "0050" ? "etf" : "stock", industry: c === "0050" ? "ETF" : "半導體" }) }).byCurrency.TWD;
  const A = R.attribution; assert.deepEqual(J(A.bySymbol.map(x => [x.symbol, x.pnl])), [["2330", 2000], ["0050", -400]]);
  assert.ok(near(A.bySymbol.reduce((s, x) => s + x.pnl, 0), R.pnl.total)); assert.ok(near(A.bySymbol.reduce((s, x) => s + x.share, 0), 1));
  assert.deepEqual(J(A.byType.map(x => [x.group, x.pnl])), [["stock", 2000], ["etf", -400]]); assert.deepEqual(J(A.byIndustry.map(x => x.group)), ["半導體", "ETF"]);
  assert.equal(A.dividends, 100); assert.equal(A.fx, null);
});

test("台幣美元分開；有錯誤的交易不算進去並回報；空的回 empty", () => {
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 10, price: 100 }), { id: "u1", market: "us", currency: "USD", symbol: "NVDA", date: "2026-01-05", type: "buy", shares: 1, price: 100, fee: 0, tax: 0 }, tw({ date: "2026-01-06", type: "sell", shares: 999, price: 1 })];
  const R = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100]]), NVDA: S([["2026-01-05", 110]]) } });
  assert.deepEqual(Object.keys(R.byCurrency), ["TWD", "USD"]); assert.equal(R.status, "has_errors"); assert.equal(R.ledgerErrors, 1);
  assert.ok(near(R.byCurrency.USD.twr, 0.1)); assert.equal(R.byCurrency.TWD.pnl.invested, 1000);
  assert.equal(K.buildPerf([], {}).status, "empty");
});

test("比較基準的起點：第一天之前的收盤（組合第一天從買進價算起，基準也從前一天收盤算）", () => {
  const R = K.buildPerf([tw({ date: "2026-01-06", type: "buy", shares: 1, price: 100 })], { prices: { 2330: S([["2026-01-06", 100], ["2026-01-07", 110]]) }, bench: { TWD: S([["2026-01-05", 1000], ["2026-01-06", 1020], ["2026-01-07", 1050]]) } }).byCurrency.TWD;
  assert.ok(near(R.bench.ret, 0.05)); assert.equal(R.bench.from, "2026-01-05");
});

// ===== ChatGPT 審查（#230）回歸測試 =====
test("P1-1：交易引擎有待確認部位（合股零股未結算）→ 績效狀態是 needs_confirm，不是 ok", () => {
  const T = [tw({ date: "2025-01-02", type: "buy", shares: 1001, price: 10 }), tw({ date: "2025-02-03", type: "split", ratio: 0.1 })];
  const R = K.buildPerf(T, { prices: { 2330: S([["2025-01-02", 10], ["2025-02-03", 100], ["2025-02-04", 101]]) } });
  assert.equal(R.status, "needs_confirm"); assert.equal(R.pendingCount, 1);
  const C = R.byCurrency.TWD; assert.equal(C.status, "needs_confirm"); assert.ok(C.issues.some(x => x.k === "pending" && x.codes[0] === "2330")); assert.ok(C.mwr.reasons.includes("pending_confirm")); assert.notEqual(C.mwr.status, "ok");
});

test("P1-2：股息的另計匯費：股息 1,000、匯費 10 → 淨 990；總損益、個股歸因、現金流都扣一次，不重複", () => {
  const T = [tw({ id: "b", date: "2026-01-05", type: "buy", shares: 10, price: 100 }), tw({ id: "dv", date: "2026-01-06", type: "dividend", amount: 1000 }), tw({ id: "fx", symbol: null, date: "2026-01-06", type: "fee", amount: 10, ref: "dv" })];
  const C = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 100]]) } }).byCurrency.TWD;
  assert.equal(C.pnl.total, 990); assert.equal(C.pnl.extraFees, 10); assert.equal(C.attribution.bySymbol[0].pnl, 990); assert.equal(C.attribution.unattributed, 0);
  assert.equal(C.pnl.returned, 1000); assert.equal(C.pnl.invested, 1000 + 10, "匯費是另外付出的錢");
  assert.ok(near(C.twr, (1000 + 1000 - 10) / 1000 - 1), "第二天：(市值 1000 −淨現金流(10−1000))/1000 −1 = 99%");
  const U = K.buildPerf([...T, tw({ id: "g", symbol: null, date: "2026-01-06", type: "fee", amount: 5 })], { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 100]]) } }).byCurrency.TWD;
  assert.equal(U.pnl.total, 985); assert.equal(U.attribution.unattributed, -5); assert.ok(near(U.attribution.bySymbol.reduce((s, x) => s + x.pnl, 0) + U.attribution.unattributed, U.pnl.total), "每一檔＋未歸屬＝總損益");
});

test("P1-3：XIRR 有多個解（10%、20%、30% 都讓 NPV＝0）→ 不任選一個，標 multiple / 無法計算", () => {
  // (x−1/1.1)(x−1/1.2)(x−1/1.3) 展開，x＝1/(1+r)，係數當成第 0～3 年的現金流
  const a = 1 / 1.1, b = 1 / 1.2, c = 1 / 1.3, k = 1e6, cf = [-a * b * c, a * b + a * c + b * c, -(a + b + c), 1].map(v => v * k);
  const F = ["2020-01-01", "2020-12-31", "2021-12-31", "2022-12-31"].map((d, i) => ({ d, cf: cf[i] }));
  const X = K.xirrInfo(F); assert.equal(X.status, "multiple"); assert.equal(X.roots.length, 3);
  [0.1, 0.2, 0.3].forEach((r, i) => assert.ok(Math.abs(X.roots[i] - r) < 0.01, `${X.roots[i]} ≈ ${r}`));
  assert.equal(K.xirr(F), null, "多解時 xirr 不回傳任何一個");
  assert.equal(K.xirrInfo([{ d: "2025-01-01", cf: -100 }, { d: "2026-01-01", cf: 110 }]).status, "ok");
});

test("P1-3 補強：XIRR 偶數重根／切線根不能被網格漏掉後誤報唯一解", () => {
  // NPV = -100 + 220/(1+r) - 121/(1+r)^2，r=10% 是切線根，不會穿越 0。
  const F = [{ d: "2025-01-01", cf: -100 }, { d: "2026-01-01", cf: 220 }, { d: "2027-01-01", cf: -121 }];
  const X = K.xirrInfo(F);
  assert.equal(X.status, "ambiguous");
  assert.equal(K.xirr(F), null);
});

test("XIRR：同一天的正負現金流先淨額合併，不因輸入順序誤判多重解", () => {
  const F = [{ d: "2025-01-01", cf: 50 }, { d: "2025-01-01", cf: -100 }, { d: "2026-01-01", cf: 110 }];
  const X = K.xirrInfo(F);
  assert.equal(X.status, "ok");
  assert.ok(near(X.roots[0], 1.2, 1e-6));
});

test("P1-4：已出清的部位，價格資料延伸超過一年也不年化（用實際有投資的期間）", () => {
  const T = [tw({ date: "2025-01-02", type: "buy", shares: 10, price: 100 }), tw({ date: "2025-03-03", type: "sell", shares: 10, price: 110 })];
  const C = K.buildPerf(T, { prices: { 2330: S([["2025-01-02", 100], ["2025-03-03", 110], ["2026-06-01", 200]]) } }).byCurrency.TWD;
  assert.equal(C.activeTo, "2025-03-03"); assert.ok(C.spanDays < 365); assert.equal(C.annualizable, false); assert.equal(C.twrAnn, null); assert.equal(C.mwr.annualized, false); assert.equal(C.mwr.value, null);
  assert.ok(near(C.twr, 0.1)); assert.ok(near(C.mwr.period, 0.1, 1e-7));
});

test("P1-5：價格停在超過 7 天前 → 結果標「估算」並說明，不會顯示 ok", () => {
  const C = K.buildPerf([tw({ date: "2026-01-05", type: "buy", shares: 10, price: 100 })], { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 101]]) }, asOf: "2026-01-30", bench: { TWD: S([["2026-01-05", 1], ["2026-01-30", 1]]) } }).byCurrency.TWD;
  assert.ok(C.issues.some(x => x.k === "stale_prices" && x.maxDays > 7)); assert.equal(C.mwr.status, "estimated"); assert.ok(C.mwr.reasons.includes("stale_prices")); assert.equal(C.status, "estimated");
  assert.ok(K.REASON_LABEL.stale_prices);
});

test("P1-4 補強：價格歷史晚於首次投入時，MWR 年化仍依完整現金流跨度判斷", () => {
  const T = [tw({ date: "2025-01-05", type: "transfer_in", shares: 10, price: 100 })];
  const C = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 110]]) }, asOf: "2026-01-05" }).byCurrency.TWD;
  assert.ok(C.mwr.reasons.includes("history_truncated"));
  assert.equal(C.mwr.annualized, true);
  assert.ok(near(C.mwr.value, 0.1, 1e-6));
  assert.equal(C.annualizable, true, "以交易成本代替缺失的初始價格後，TWR 期間也從首次投入日起算");
});

test("P2 補強：股票轉出要把市價與成本差額計入已實現損益及個股歸因", () => {
  const T = [tw({ id: "b", date: "2026-01-05", type: "buy", shares: 10, price: 100 }), tw({ id: "o", date: "2026-01-06", type: "transfer_out", shares: 10 })];
  const C = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 120]]) } }).byCurrency.TWD;
  assert.equal(C.pnl.transferOutPnl, 200);
  assert.equal(C.pnl.realized, 200);
  assert.equal(C.pnl.total, 200);
  assert.equal(C.pnl.returned, 1200);
  assert.ok(near(C.pnl.totalPct, 0.2));
  assert.equal(C.attribution.bySymbol.find(x => x.symbol === "2330").pnl, 200);
});

test("P2 補強：轉出完全沒有市價時以成本估算並標記，不得當成零元流出", () => {
  const T = [tw({ id: "b", date: "2026-01-05", type: "buy", shares: 10, price: 100 }), tw({ id: "o", date: "2026-01-06", type: "transfer_out", shares: 10 })];
  const C = K.buildPerf(T, { prices: {} }).byCurrency.TWD;
  assert.equal(C.pnl.returned, 1000);
  assert.equal(C.mwr.status, "estimated");
  assert.ok(C.mwr.reasons.includes("transfer_out_no_price"));
  assert.ok(C.issues.some(x => x.k === "transfer_out_no_price" && x.fallback === "cost"));
});

test("轉出零成本部位又沒有市價時，不可把零成本當成零元市值", () => {
  const T = [tw({ id: "s", date: "2026-01-05", type: "stock_dividend", shares: 10, price: 0 }), tw({ id: "o", date: "2026-01-06", type: "transfer_out", shares: 10 })];
  const C = K.buildPerf(T, { prices: {} }).byCurrency.TWD;
  assert.equal(C.pnl.total, null);
  assert.equal(C.mwr.status, "unavailable");
  assert.equal(C.twr, null);
  assert.ok(C.issues.some(x => x.k === "transfer_out_no_price" && x.fallback === "unavailable"));
});

test("P2：轉出那天沒有收盤價、用之前的收盤 → 標估算並記下用的是哪天的價格；其他公司行動現金計入總損益並標示", () => {
  const T = [tw({ date: "2026-01-05", type: "buy", shares: 10, price: 100 }), tw({ date: "2026-01-08", type: "transfer_out", shares: 5 }), tw({ date: "2026-01-09", type: "other", amount: 50 })];
  const C = K.buildPerf(T, { prices: { 2330: S([["2026-01-05", 100], ["2026-01-06", 102], ["2026-01-09", 104]]) } }).byCurrency.TWD;
  assert.ok(C.issues.some(x => x.k === "transfer_out_prev_price" && x.priceDate === "2026-01-06")); assert.ok(C.mwr.reasons.includes("transfer_out_prev_price"));
  assert.equal(C.pnl.otherCash, 50); assert.ok(C.mwr.reasons.includes("other_action"));
  assert.ok(near(C.attribution.bySymbol.reduce((s, x) => s + x.pnl, 0) + C.attribution.unattributed, C.pnl.total));
});

test("一般投資組合：買、領股息、再買、部分賣出（現金流正負來回好幾次）仍然算得出唯一的資金加權報酬，不會一律標無法計算", () => {
  const F = [{ d: "2024-01-02", cf: -100000 }, { d: "2024-07-15", cf: 2000 }, { d: "2024-09-02", cf: -50000 }, { d: "2025-01-15", cf: 2500 }, { d: "2025-03-03", cf: 40000 }, { d: "2025-07-15", cf: 1800 }, { d: "2026-01-02", cf: 140000 }];
  const X = K.xirrInfo(F); assert.equal(X.status, "ok"); assert.equal(X.roots.length, 1);
  const r = X.roots[0], npv = F.reduce((s, f) => s + f.cf / Math.pow(1 + r, (Date.parse(f.d) - Date.parse(F[0].d)) / 864e5 / 365), 0); assert.ok(Math.abs(npv) < 1e-4);
});
