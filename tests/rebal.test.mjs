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
  assert.equal(a.action, "sell"); assert.equal(a.tradeShares, 200); assert.equal(a.fee, 28); assert.equal(a.tax, 60); assert.equal(a.weightAfter, 0.4002, "80,000 ÷ 調整後總資產 199,912（扣掉費稅 88）"); assert.equal(a.lots, 0); assert.equal(a.odd, 200);
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

test("調整後比重：扣掉費稅、用調整後總資產當分母；多檔同時買賣、最低手續費、賣出交易稅、現金變負，持股＋現金加起來都是 100%", () => {
  const POS3 = [...POS, { symbol: "0050", market: "tw", currency: "TWD", shares: 100, price: 150, assetType: "etf" }]; // 15,000
  const sum = P => P.rows.reduce((s, r) => s + r.valueAfter, 0) + P.cashAfter;
  const P = R.plan({ positions: POS3, fx: 30, cash: 70000, targets: { 2330: 30, NVDA: 25, "0050": 15 }, band: 0, costs });
  assert.equal(P.total, 215000); assert.ok(P.rows.filter(r => r.action === "buy" || r.action === "sell").length === 3, "三檔都要動");
  assert.ok(Math.abs(P.totalAfter - (P.total - P.fees)) < 0.02, "調整後總資產＝原總資產 − 費稅"); assert.ok(Math.abs(sum(P) - P.totalAfter) < 0.02);
  const W = P.rows.reduce((s, r) => s + r.weightAfter, 0) + P.cashWeightAfter; assert.ok(Math.abs(W - 1) < 0.0005, `加起來 ${W}`);
  const e = row(P, "0050"); // 目標 32,250、目前 15,000 → 買 115 股＝17,250；手續費 24.58 → 24（最低 20 不影響）
  assert.equal(e.action, "buy"); assert.equal(e.tradeShares, 115); assert.equal(e.fee, 24); assert.equal(e.tax, 0);
  const t = row(P, "2330"); // 目標 64,500 → 賣 355 股＝35,500；證交稅 0.3%＝106、手續費 50
  assert.equal(t.tradeShares, 355); assert.equal(t.tax, 106); assert.equal(t.fee, 50);
  // 小額：最低手續費 20 元
  const M = R.plan({ positions: [{ symbol: "2330", market: "tw", currency: "TWD", shares: 1, price: 100 }], cash: 900, targets: { 2330: 50 }, band: 0, costs });
  assert.equal(row(M, "2330").tradeShares, 4); assert.equal(row(M, "2330").fee, 20, "400 元的 0.1425% 不到 1 元 → 最低 20"); assert.equal(M.cashAfter, 900 - 400 - 20); assert.equal(M.totalAfter, 980);
  assert.equal(row(M, "2330").weightAfter, 0.5102, "500 ÷ 980");
  // 現金變負：比重仍加起來 100%（現金那格是負的）
  const N = R.plan({ positions: POS, fx: 30, cash: 0, targets: { NVDA: 50 }, band: 0, costs });
  assert.ok(N.cashAfter < 0 && N.cashWeightAfter < 0); assert.ok(Math.abs(N.rows.reduce((s, r) => s + r.weightAfter, 0) + N.cashWeightAfter - 1) < 0.0005);
  assert.equal(row(N, "2330").weightAfter, row(N, "2330").valueAfter / N.totalAfter > 0 ? Math.round(100000 / N.totalAfter * 1e4) / 1e4 : null, "沒設目標的也用調整後總資產算");
});

test("未知現金（cash === null）、債券 ETF 零稅與手續費折扣（discount）", () => {
  const P = R.plan({ positions: POS, fx: 30, cash: null, targets: { 2330: 50, NVDA: 50 }, band: 1, costs });
  assert.equal(P.cashKnown, false);
  assert.equal(P.cash, null);
  assert.equal(P.cashAfter, null);
  assert.equal(P.cashWeightAfter, null);
  assert.equal(P.stocks, 130000);
  assert.equal(P.total, 130000);
  assert.equal(P.netCashDelta, Math.round((P.sell - P.buy) * 100) / 100);
  assert.ok(P.issues.some(x => x.k === "no_cash"));
  assert.ok(!P.issues.some(x => x.k === "cash_short"), "未知現金不能當 0 誤報現金不夠");

  // 未知現金時忽略已存的 CASH 目標，不產生 100% 加總誤報
  const I = R.plan({ positions: POS, fx: 30, cash: null, targets: { 2330: 50, NVDA: 20, CASH: 30 }, band: 1, costs });
  assert.equal(I.cashKnown, false);
  assert.equal(I.cashTarget, null);
  assert.ok(I.issues.some(x => x.k === "cash_target_ignored"));
  assert.ok(!I.issues.some(x => x.k === "sum"));
  assert.ok(!I.issues.some(x => x.k === "cash_short"));

  // 未知現金但股票目標合計超過 100% → 報 over，不報 cash_short
  const O = R.plan({ positions: POS, fx: 30, cash: null, targets: { NVDA: 40 }, band: 1, costs });
  assert.ok(O.issues.some(x => x.k === "over" && x.sum > 100));
  assert.ok(!O.issues.some(x => x.k === "cash_short"));

  // 真正記了 0 元現金（cash: 0）：cashKnown 為 true，負數仍報 cash_short 且 netCashDelta === cashAfter
  const Z = R.plan({ positions: POS, fx: 30, cash: 0, targets: { NVDA: 50 }, band: 0, costs });
  assert.equal(Z.cashKnown, true);
  assert.equal(Z.cash, 0);
  assert.ok(Z.cashAfter < 0);
  assert.equal(Z.netCashDelta, Z.cashAfter);
  assert.ok(Z.issues.some(x => x.k === "cash_short"));

  // 債券 ETF（bond_etf）賣出證交稅為 0，券商折扣套用（0.28 折）
  const discRules = { ...LG.DEFAULT_RULES, tw: { ...LG.DEFAULT_RULES.tw, discount: 0.28 } };
  const bondPos = [{ symbol: "00679B", market: "tw", currency: "TWD", shares: 4000, price: 30, assetType: "bond_etf" }, { symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 800, assetType: "stock" }];
  const B = R.plan({ positions: bondPos, fx: null, cash: null, targets: { "00679B": 0, "2330": 100 }, band: 1, costs: t => LG.estimateCosts(t, discRules) });
  const br = row(B, "00679B"), tr = row(B, "2330");
  assert.equal(br.action, "sell");
  assert.equal(br.tradeShares, 4000);
  assert.equal(br.tax, 0, "債券 ETF 證交稅為 0");
  assert.equal(br.fee, Math.floor(120000 * 0.001425 * 0.28 + 1e-9), "手續費依折扣計算");
  assert.equal(tr.action, "buy");
  assert.equal(tr.fee, Math.floor(tr.grossBase * 0.001425 * 0.28 + 1e-9));
});

test("目標基準（basis）：total 與 holdings 切換時不給錯誤買賣建議，僅顯示偏離", () => {
  // validateStore 支援選填 basis（total | holdings），不合法的值擋下
  assert.equal(R.validateStore({ v: 1, basis: "total", targets: { 2330: 50, CASH: 20 }, band: 5 }).ok, true);
  assert.equal(R.validateStore({ v: 1, basis: "holdings", targets: { 2330: 100 }, band: 5 }).ok, true);
  assert.equal(R.validateStore({ v: 1, basis: "invalid_mode", targets: { 2330: 50 }, band: 5 }).errors[0]?.error, "invalid_basis");

  // Claude 審查 P1 重現案例：0050 1000 股 @100、2330 100 股 @1000、目標 {0050: 40, 2330: 30, CASH: 30}、band 5
  const pos = [
    { symbol: "0050", market: "tw", currency: "TWD", shares: 1000, price: 100, assetType: "etf" },
    { symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 1000, assetType: "stock" }
  ];
  // 1) 現金已知（85,714 → 總資產 285,714，0050 佔 35%、2330 佔 35%）：僅 2330 賣 14 股
  const K = R.plan({ positions: pos, cash: 85714, targets: { "0050": 40, 2330: 30, CASH: 30 }, targetBasis: "total", band: 5, costs });
  assert.equal(K.basisMismatch, false);
  assert.equal(row(K, "0050").action, "hold");
  assert.equal(row(K, "2330").action, "sell");
  assert.equal(row(K, "2330").tradeShares, 14);

  // 2) 切到現金未知（cash: null）：basis: "total" 與目前 holdings 模式不符 → 不得建議賣出 0050 200 股／2330 40 股
  const M1 = R.plan({ positions: pos, cash: null, targets: { "0050": 40, 2330: 30, CASH: 30 }, targetBasis: "total", band: 5, costs });
  assert.equal(M1.basisMismatch, true);
  assert.equal(M1.status, "estimated");
  assert.ok(M1.issues.some(x => x.k === "basis_mismatch"));
  assert.ok(M1.issues.some(x => x.k === "cash_target_ignored"));
  assert.equal(M1.buy, 0);
  assert.equal(M1.sell, 0);
  assert.equal(M1.fees, 0);
  assert.equal(M1.netCashDelta, 0);
  assert.ok(M1.rows.every(r => r.action === "hold" && r.reason === "basis_mismatch" && r.tradeShares == null));
  assert.equal(row(M1, "0050").diff, -0.1);
  assert.equal(row(M1, "2330").diff, -0.2);

  // 2b) 舊格式未存 basis 但含 CASH 目標 → 亦推斷原基準為 total，切到 cash: null 一樣阻擋誤賣
  const M1b = R.plan({ positions: pos, cash: null, targets: { "0050": 40, 2330: 30, CASH: 30 }, band: 5, costs });
  assert.equal(M1b.basisMismatch, true);
  assert.equal(M1b.sell, 0);

  // 3) 反方向：在舊庫存模式存 holdings 目標 {0050: 60, 2330: 40}，切回有現金的帳本（cash: 85714）→ 不得建議把現金全買光
  const M2 = R.plan({ positions: pos, cash: 85714, targets: { "0050": 60, 2330: 40 }, targetBasis: "holdings", band: 5, costs });
  assert.equal(M2.basisMismatch, true);
  assert.ok(M2.issues.some(x => x.k === "basis_mismatch"));
  assert.equal(M2.buy, 0);
  assert.equal(M2.sell, 0);
  assert.ok(M2.rows.every(r => r.action === "hold" && r.reason === "basis_mismatch"));
});
