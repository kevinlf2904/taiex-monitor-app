// 融資與擔保品風險（learner/margin.js）：維持率、利息、可用額度、跌多少會追繳、壓力測試、單一擔保品連續跌停、補多少錢、門檻與資料來源標示、存檔檢查。期望值手算；固定假資料。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/margin.js", import.meta.url), "utf8"), ctx);
const M = ctx.KLMargin, J = x => JSON.parse(JSON.stringify(x)), near = (a, b, t = 1e-4) => Math.abs(a - b) < t;
const acct = o => ({ id: "a", name: "融資", type: "margin", source: "user", loan: 600000, rate: 0.065, startDate: "2026-01-01", rules: { call: 1.3, topUpTo: 1.66, maxLtv: 0.6, source: "我的券商", asOf: "2026-10-01" },
  collateral: [{ symbol: "2330", shares: 1000 }, { symbol: "2317", shares: 2000 }], ...o });
const PX = { 2330: { price: 700, date: "2026-11-04" }, 2317: { price: 150, date: "2026-11-04" } };

test("維持率＝擔保品市值 ÷ 借款；利息用簡單利息；可用額度＝市值×成數−借款；結果標「不是券商正式通知」", () => {
  const R = M.analyze(acct(), PX, "2026-11-04");
  assert.equal(R.collateralValue, 1000000); assert.ok(near(R.ratio, 1000000 / 600000)); assert.equal(R.state, "ok"); assert.equal(R.official, false); assert.equal(R.source, "user");
  assert.equal(R.days, 307); assert.equal(R.interest, Math.round(600000 * 0.065 * 307 / 365 * 100) / 100); assert.equal(R.available, 0, "1000000×0.6−600000＝0");
  assert.ok(near(R.dropToCall, 1 - 1.3 * 600000 / 1000000), "跌 22% 會碰到 130%"); assert.equal(R.rules.isDefault, false);
});

test("壓力測試：整體跌 5～30% 的維持率與狀態；低於追繳線時算出要補多少現金或還多少錢", () => {
  const R = M.analyze(acct(), PX, "2026-11-04"), s30 = R.stress.find(x => x.shock === -0.3);
  assert.deepEqual(J(R.stress.map(x => x.shock)), [-0.05, -0.1, -0.15, -0.2, -0.3]);
  assert.equal(s30.value, 700000); assert.ok(near(s30.ratio, 700000 / 600000)); assert.equal(s30.state, "call");
  assert.equal(s30.need.cash, Math.round((1.66 * 600000 - 700000) * 100) / 100, "補到 166%"); assert.equal(s30.need.repay, Math.round((600000 - 700000 / 1.66) * 100) / 100, "或還款到 166%");
  assert.equal(R.stress.find(x => x.shock === -0.2).state, "near", "跌 20%：133%，接近追繳線（130%～143%）");
});

test("單一擔保品連續三根跌停（約 −27.1%）：找出影響最大的那一檔", () => {
  const R = M.analyze(acct(), PX, "2026-11-04"), L3 = 1 - 0.9 ** 3;
  assert.equal(R.riskiest.symbol, "2330"); assert.ok(near(R.riskiest.ratio, (1000000 - 700000 * L3) / 600000)); assert.ok(near(R.riskiest.weight, 0.7));
});

test("沒有現價用手填價格並標示；兩者都沒有就不算進市值、狀態不完整；預設門檻要提醒；現金擔保不跌", () => {
  const R = M.analyze(acct({ rules: undefined, cashCollateral: 100000, collateral: [{ symbol: "2330", shares: 1000, price: 600 }, { symbol: "9999", shares: 1 }] }), {}, "2026-11-04");
  assert.equal(R.status, "incomplete"); assert.ok(R.issues.some(x => x.k === "user_price")); assert.ok(R.issues.some(x => x.k === "no_price" && x.codes[0] === "9999")); assert.ok(R.issues.some(x => x.k === "default_rules"));
  assert.equal(R.collateralValue, 700000); assert.equal(R.rules.call, 1.3); assert.equal(R.rules.isDefault, true);
  assert.equal(R.stress[0].value, 600000 * 0.95 + 100000, "現金擔保不跌");
  assert.ok(near(R.dropToCall, 1 - (1.3 * 600000 - 100000) / 600000));
});

test("斷頭線、期限；存檔檢查擋下壞資料", () => {
  const R = M.analyze(acct({ type: "pledge", rules: { call: 1.3, topUpTo: 1.4, liquidate: 1.2 }, termDays: 300 }), PX, "2026-11-04");
  assert.ok(R.issues.some(x => x.k === "term_expired")); assert.ok(near(R.dropToLiquidate, 1 - 1.2 * 600000 / 1000000));
  assert.equal(R.stress.find(x => x.shock === -0.3).state, "liquidate", "116.7% < 120%");
  assert.equal(M.validateStore({ v: 1, accounts: [acct()] }).ok, true);
  const bad = M.validateStore({ v: 1, accounts: [acct({ loan: -1 }), acct({ rate: 5 }), acct({ rules: { call: 1.5, topUpTo: 1.3 } })] });
  assert.deepEqual(J(bad.errors.map(e => e.code)), ["invalid_loan", "duplicate_or_missing_id", "invalid_rate", "duplicate_or_missing_id", "topup_below_call"]);
  assert.equal(M.validateStore({ v: 2, accounts: [] }).code, "unsupported_version");
});

test("審查修正：沒有任何擔保品 → incomplete 並說明、存檔擋下；用手填價格 → estimated；價格超過 5 天 → estimated 並列出代號", () => {
  const E = M.analyze(acct({ collateral: [], cashCollateral: 0 }), PX, "2026-11-04");
  assert.equal(E.status, "incomplete"); assert.ok(E.issues.some(x => x.k === "no_collateral")); assert.equal(E.ratio, null);
  assert.ok(M.validateStore({ v: 1, accounts: [acct({ collateral: [] })] }).errors.some(e => e.code === "no_collateral"));
  assert.equal(M.validateStore({ v: 1, accounts: [acct({ collateral: [], cashCollateral: 1000 })] }).ok, true, "只有現金擔保也可以");
  const U = M.analyze(acct({ collateral: [{ symbol: "2330", shares: 1000, price: 700, priceDate: "2026-11-03" }] }), {}, "2026-11-04");
  assert.equal(U.status, "estimated"); assert.equal(U.collateral[0].priceSource, "user"); assert.equal(U.collateral[0].priceDate, "2026-11-03");
  const O = M.analyze(acct(), { 2330: { price: 700, date: "2026-10-20" }, 2317: { price: 150, date: "2026-11-04" } }, "2026-11-04");
  assert.equal(O.status, "estimated"); assert.ok(O.issues.some(x => x.k === "stale_price" && x.codes.join() === "2330"));
  assert.equal(M.analyze(acct(), PX, "2026-11-04").status, "ok");
});
