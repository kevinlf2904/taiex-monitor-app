// 證交所 BFI82U（三大法人買賣金額統計）解析（#262 FIN-08、#264 E3）：單位名稱整個比對，不靠「包含」與規則順序；缺的類別是 null、不是 0。
import test from "node:test";
import assert from "node:assert/strict";
import { parseBfi82u } from "../api/_lib/market.js";

// 真實格式：單位名稱、買進金額、賣出金額、買賣差額（元）
const row = (n, diff) => [n, "1,000", "1,000", diff.toLocaleString("en-US")];
const REAL = { stat: "OK", fields: ["單位名稱", "買進金額", "賣出金額", "買賣差額"], data: [
  row("自營商(自行買賣)", 1e8), row("自營商(避險)", -3e8), row("投信", 5e8),
  row("外資及陸資(不含外資自營商)", 20e8), row("外資自營商", 2e8), row("合計", 25e8),
] };

test("真實 6 列：外資＝外資及陸資＋外資自營商、自營商＝自行買賣＋避險，四類加總一致", () => {
  assert.deepEqual(parseBfi82u(REAL), { foreign: 22, trust: 5, dealer: -2, total: 25 });
});
test("「外資自營商」只算進外資，不會因為含「自營商」被算進自營商（列的順序打亂也一樣）", () => {
  const r = parseBfi82u({ ...REAL, data: [...REAL.data].reverse() });
  assert.equal(r.dealer, -2); assert.equal(r.foreign, 22);
});
test("名稱含全形括號或空白也認得", () => {
  const data = REAL.data.map(r => [r[0].replace("(", "（").replace(")", "）").replace("商", "商 "), ...r.slice(1)]);
  assert.deepEqual(parseBfi82u({ ...REAL, data }), { foreign: 22, trust: 5, dealer: -2, total: 25 });
});
test("名稱只是「包含」關鍵字的其他列不算進去", () => {
  const r = parseBfi82u({ ...REAL, data: [...REAL.data, row("外資及陸資合計（參考）", 99e8), row("自營商合計", 99e8)] });
  assert.deepEqual(r, { foreign: 22, trust: 5, dealer: -2, total: 25 });
});
test("某一類找不到是 null，不是 0；全部都不認得回 null", () => {
  const r = parseBfi82u({ ...REAL, data: REAL.data.filter(x => x[0] !== "投信") });
  assert.equal(r.trust, null); assert.equal(r.foreign, 22);
  assert.equal(parseBfi82u({ stat: "OK", data: [row("其他", 1e8)] }), null);
  assert.equal(parseBfi82u({ stat: "很抱歉，沒有符合條件的資料!", data: [] }), null);
});
test("明細與舊版彙總列同時出現：明細優先，不重複加總（列的順序不影響）", () => {
  const mixed = [...REAL.data, row("外資及陸資", 22e8), row("自營商", -2e8)];
  assert.deepEqual(parseBfi82u({ ...REAL, data: mixed }), { foreign: 22, trust: 5, dealer: -2, total: 25 });
  assert.deepEqual(parseBfi82u({ ...REAL, data: [...mixed].reverse() }), { foreign: 22, trust: 5, dealer: -2, total: 25 });
});
test("只有一類有明細：該類用明細，另一類沒明細才用彙總列", () => {
  const data = [row("外資及陸資(不含外資自營商)", 20e8), row("外資自營商", 2e8), row("外資及陸資", 99e8), row("自營商", 1e8), row("投信", 5e8), row("合計", 28e8)];
  assert.deepEqual(parseBfi82u({ stat: "OK", data }), { foreign: 22, trust: 5, dealer: 1, total: 28 });
});
test("舊版單位名稱（外資及陸資、自營商，沒有括號說明）仍可解析", () => {
  const r = parseBfi82u({ stat: "OK", data: [row("自營商", 1e8), row("投信", 2e8), row("外資及陸資", 3e8), row("合計", 6e8)] });
  assert.deepEqual(r, { foreign: 3, trust: 2, dealer: 1, total: 6 });
});
