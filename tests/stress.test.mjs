// 投資組合壓力情境（learner/stress.js）：Beta × 大盤、產業重挫、匯率、現金、沒有 Beta 用 1、最多跌 100%、輸入檢查。期望值手算，固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/stress.js", import.meta.url), "utf8"), ctx);
const K = ctx.KLStress, J = x => JSON.parse(JSON.stringify(x));
// 2330：100,000（Beta 1.2、半導體）；2882：50,000（Beta 0.8、金融）；NVDA：60,000 台幣（Beta 1.5）；台幣現金 40,000、美元現金 30,000（台幣）→ 280,000
const POS = [{ symbol: "2330", market: "tw", currency: "TWD", value: 100000, beta: 1.2, industry: "半導體業" }, { symbol: "2882", market: "tw", currency: "TWD", value: 50000, beta: 0.8, industry: "金融保險業" },
  { symbol: "NVDA", market: "us", currency: "USD", value: 60000, beta: 1.5, industry: null }];
const CASH = { TWD: 40000, USD: 30000 }, row = (R, c) => R.rows.find(r => r.symbol === c);

test("台股大跌 20%：每檔 Beta × −20%；美股與現金不變", () => {
  const R = K.run({ positions: POS, cash: CASH, s: { tw: -0.2 } });
  assert.equal(R.before, 280000); assert.equal(row(R, "2330").change, -24000); assert.equal(row(R, "2882").change, -8000); assert.equal(row(R, "NVDA").change, 0);
  assert.equal(R.change, -32000); assert.equal(R.pct, -0.1143); assert.deepEqual(J(R.worst), ["2330", "2882"]); assert.equal(R.status, "ok");
});

test("美元跌 10%：美股和美元現金換回台幣少 10%；全球股災是價格和匯率相乘", () => {
  const A = K.run({ positions: POS, cash: CASH, s: { fx: -0.1 } });
  assert.equal(row(A, "NVDA").change, -6000); assert.equal(A.cashChange, -3000); assert.equal(A.change, -9000);
  const C = K.run({ positions: POS, cash: CASH, s: { tw: -0.25, us: -0.25, fx: 0.05 } });
  // NVDA：60,000 ×（1 − 1.5×0.25）× 1.05 ＝ 60,000 × 0.625 × 1.05 ＝ 39,375
  assert.equal(row(C, "NVDA").after, 39375); assert.equal(C.cashChange, 1500);
  assert.equal(C.change, (100000 * 0.7 - 100000) + (50000 * 0.8 - 50000) + (39375 - 60000) + 1500);
});

test("產業重挫只影響那個產業；和大盤一起算時相加，最多跌 100%", () => {
  const A = K.run({ positions: POS, cash: CASH, s: { ind: -0.3, industry: "半導體業" } });
  assert.equal(row(A, "2330").change, -30000); assert.equal(row(A, "2330").industryHit, true); assert.equal(row(A, "2882").change, 0);
  const B = K.run({ positions: [{ symbol: "X", market: "tw", currency: "TWD", value: 1000, beta: 3, industry: "半導體業" }], s: { tw: -0.5, ind: -0.3, industry: "半導體業" } });
  assert.equal(row(B, "X").price, -1, "3 × −50% − 30% 超過 −100%：最多賠光"); assert.equal(B.after, 0);
});

test("沒有 Beta 用 1 並列出來；輸入不對、沒有資產不硬算；預設情境", () => {
  const R = K.run({ positions: [{ symbol: "6669", market: "tw", currency: "TWD", value: 10000, beta: null }], s: { tw: -0.1 } });
  assert.equal(row(R, "6669").change, -1000); assert.deepEqual(J(R.noBeta), ["6669"]); assert.equal(R.status, "estimated");
  assert.deepEqual(J(K.run({ positions: [{ symbol: "6669", market: "tw", value: 10000 }], s: { fx: -0.1 } }).noBeta), [], "大盤沒動：Beta 用不到，不列");
  assert.equal(K.run({ positions: POS, s: { tw: -2 } }).status, "invalid"); assert.equal(K.run({ positions: [], s: {} }).status, "invalid");
  assert.ok(K.PRESETS.length >= 5 && K.PRESETS.every(p => p.k && p.label));
});
