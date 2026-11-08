// 投資組合報告（learner/report.js）：市值、台幣換算、比重（含現金）、未實現、沒有報價用成本、沒有匯率不換算、論點摘要與到期。期望值手算，固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/report.js", import.meta.url), "utf8"), ctx);
const R = ctx.KLReport, J = x => JSON.parse(JSON.stringify(x));
const POS = [{ symbol: "2330", market: "tw", currency: "TWD", shares: 1000, costBasis: 90000, avgCost: 90, open: true },
  { symbol: "NVDA", market: "us", currency: "USD", shares: 10, costBasis: 1000, avgCost: 100, open: true },
  { symbol: "6669", market: "tw", currency: "TWD", shares: 10, costBasis: 20000, avgCost: 2000, open: true }];
const PX = new Map([["2330", { price: 100 }], ["NVDA", { price: 120 }]]);

test("市值、台幣換算、比重含現金、未實現；沒有報價用成本估並標示", () => {
  const B = R.build({ positions: POS, px: PX, fx: 30, cash: 50000, today: "2026-11-08" });
  // 2330 100,000；NVDA 1,200 美元 × 30 ＝ 36,000；6669 沒有報價用成本 20,000 → 持股 156,000 ＋ 現金 50,000 ＝ 206,000
  assert.equal(B.stocks, 156000); assert.equal(B.gross, 206000);
  assert.deepEqual(J(B.rows.map(r => [r.symbol, r.valueBase, r.w, r.unreal, r.unrealPct])), [["2330", 100000, 0.4854, 10000, 0.1111], ["NVDA", 36000, 0.1748, 200, 0.2], ["6669", 20000, 0.0971, null, null]]);
  assert.deepEqual(J(B.priceEst), ["6669"]); assert.deepEqual(J(B.noFx), []);
});

test("沒有匯率：美股不換算、不算比重並列出；負現金照扣", () => {
  const B = R.build({ positions: POS, px: PX, fx: null, cash: -10000 });
  assert.equal(B.rows.find(r => r.symbol === "NVDA").valueBase, null); assert.equal(B.rows.find(r => r.symbol === "NVDA").w, null); assert.deepEqual(J(B.noFx), ["NVDA"]);
  assert.equal(B.gross, 110000, "100,000 ＋ 20,000 − 10,000");
});

test("論點摘要：狀態、到期、為什麼買截 80 字；沒寫的列出來", () => {
  const thesis = { v: 1, items: { 2330: { reason: "x".repeat(100), status: "weak", review: "2026-11-01" }, NVDA: { watch: ["GPU"], review: "2026-12-01" }, 6669: {} } };
  const B = R.build({ positions: POS, px: PX, fx: 30, thesis, today: "2026-11-08" });
  const t = c => B.rows.find(r => r.symbol === c).thesis;
  assert.equal(t("2330").status, "weak"); assert.equal(t("2330").due, true); assert.equal(t("2330").reason.length, 81); assert.equal(t("NVDA").status, "hold"); assert.equal(t("NVDA").due, false);
  assert.equal(t("6669"), null); assert.equal(B.thesis.written, 2); assert.deepEqual(J(B.thesis.due), ["2330"]); assert.deepEqual(J(B.thesis.missing), ["6669"]); assert.equal(B.thesis.byStatus.weak, 1);
  assert.deepEqual(J(R.build({}).rows), []);
});
