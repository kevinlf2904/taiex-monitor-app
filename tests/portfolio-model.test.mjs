import test from "node:test";
import assert from "node:assert/strict";
import { PORTFOLIO_MODEL_VERSION, LEGACY_HOLDINGS_KEY, normalizePortfolioHoldings, readLegacyHoldings } from "../learner/portfolio-model.js";

test("投資組合契約：正規化台股／美股與成本基礎，不修改輸入", () => {
  const raw = { "2330": { sh: 1000, cost: 820, d: "2025-03-10" }, "00631L": { sh: "2", cost: "18.5" }, AAPL: { sh: 3.5, cost: 190, d: "2026-01-02" } };
  const before = JSON.stringify(raw), result = normalizePortfolioHoldings(raw);
  assert.equal(result.schemaVersion, PORTFOLIO_MODEL_VERSION); assert.equal(result.status, "ready");
  assert.deepEqual(result.items.map(x => [x.symbol, x.market]), [["2330", "tw"], ["00631L", "tw"], ["AAPL", "us"]]);
  assert.equal(result.items[0].costBasis, 820000); assert.equal(result.items[1].costBasis, 37); assert.equal(result.items[2].shares, 3.5);
  assert.deepEqual(result.quality.marketCounts, { tw: 2, us: 1 }); assert.equal(result.quality.acceptedCount, 3);
  assert.equal(JSON.stringify(raw), before, "adapter 不可改寫呼叫端資料");
});

test("投資組合契約：空庫存與錯誤根節點有明確狀態", () => {
  assert.equal(normalizePortfolioHoldings({}).status, "empty");
  for (const raw of [null, [], "2330", 12]) {
    const result = normalizePortfolioHoldings(raw); assert.equal(result.status, "invalid");
    assert.equal(result.items.length, 0); assert.equal(result.issues[0].code, "invalid_root");
  }
});

test("投資組合契約：缺值、零值、負值、非有限數字與成本溢位不會成為有效持股", () => {
  const result = normalizePortfolioHoldings({
    "2330": { sh: 0, cost: 800 }, "2317": { sh: -1, cost: 100 }, "2454": { sh: "abc", cost: 100 },
    "2881": { sh: 10, cost: Infinity }, "2603": { sh: 10, cost: "" }, "0050": { sh: 1, cost: 100 },
    "00900": { sh: true, cost: 10 }, "00901": { sh: 1e308, cost: 1e308 }
  });
  assert.equal(result.status, "partial"); assert.deepEqual(result.items.map(x => x.symbol), ["0050"]);
  assert.equal(result.quality.rejectedCount, 7);
  assert.equal(result.issues.filter(x => x.code === "invalid_position_values").length, 7);
});

test("投資組合契約：非法代號、非物件列與大小寫重複會被隔離", () => {
  const result = normalizePortfolioHoldings({ "bad symbol": { sh: 1, cost: 1 }, AAPL: { sh: 2, cost: 100 }, aapl: { sh: 3, cost: 110 }, MSFT: null });
  assert.equal(result.status, "partial"); assert.deepEqual(result.items.map(x => x.symbol), ["AAPL"]);
  assert.deepEqual(result.issues.map(x => x.code), ["invalid_symbol", "duplicate_symbol", "invalid_row"]);
});

test("投資組合契約：日期無效只降級日期欄位，不丟棄有效持股", () => {
  const result = normalizePortfolioHoldings({ "2330": { sh: 10, cost: 800, d: "2026-02-30" }, AAPL: { sh: 1, cost: 100 } });
  assert.equal(result.status, "ready"); assert.equal(result.items[0].openedAt, null);
  assert.equal(result.quality.missingDateCount, 1); assert.equal(result.quality.invalidDateCount, 1);
  assert.equal(result.issues[0].code, "invalid_opened_at"); assert.equal(result.issues[0].severity, "warning");
});

test("投資組合契約：只讀 adapter 使用既有 localStorage key，不寫入或遷移", () => {
  const calls = [], storage = {
    getItem(key) { calls.push(["getItem", key]); return JSON.stringify({ "2330": { sh: 100, cost: 500 } }); },
    setItem(...args) { calls.push(["setItem", ...args]); }, removeItem(...args) { calls.push(["removeItem", ...args]); }
  };
  const result = readLegacyHoldings(storage); assert.equal(result.status, "ready"); assert.equal(result.source, "legacy_local_storage");
  assert.deepEqual(calls, [["getItem", LEGACY_HOLDINGS_KEY]]);
});

test("投資組合契約：不存在的 key、錯誤 JSON、讀取例外都不會觸發寫入", () => {
  const empty = readLegacyHoldings({ getItem: () => null, setItem() { assert.fail("不可寫入"); } });
  assert.equal(empty.status, "empty");
  const malformed = readLegacyHoldings({ getItem: () => "{bad json", setItem() { assert.fail("不可寫入"); } });
  assert.equal(malformed.status, "invalid"); assert.equal(malformed.issues[0].code, "invalid_json");
  const failed = readLegacyHoldings({ getItem() { throw new Error("denied"); } });
  assert.equal(failed.status, "invalid"); assert.equal(failed.issues[0].code, "storage_read_failed");
});
