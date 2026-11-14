// 截圖匯入（持股轉入 kline:pf:v1＋成交對帳單匯入）後端解析與帳本匯入引擎測試。固定假資料，不連外、不呼叫付費 API。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import handler, { cleanRows, cleanTradeRows, parseTradeDate } from "../api/_lib/import.js";

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/ledger.js", import.meta.url), "utf8"), ctx);
const L = ctx.KLLedger;
const J = x => JSON.parse(JSON.stringify(x));

const KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_CLAUDE_ENABLED", "AI_CLAUDE_FALLBACK", "GEMINI_MODEL"];
async function withMockAI(env, fn, { rows = [], status = 200, claudeRows = null } = {}) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const sent = { gemini: [], claude: [] };
  globalThis.fetch = async (url, init) => {
    const u = String(url?.url || url);
    if (/\/v1beta\/models\?/.test(u)) return new Response("{}", { status: 404 });
    if (/generativelanguage\.googleapis\.com/.test(u)) {
      sent.gemini.push(JSON.parse(init.body));
      if (status !== 200) return new Response(JSON.stringify({ error: { message: "err" } }), { status, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rows }) }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/api\.anthropic\.com/.test(u)) {
      const body = JSON.parse(init.body);
      sent.claude.push(body);
      return new Response(JSON.stringify({
        id: "m1", type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "text", text: JSON.stringify({ rows: claudeRows ?? rows }) }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("測試不該連外：" + u);
  };
  try { return await fn(sent); }
  finally {
    globalThis.fetch = realFetch;
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const callApi = async (req) => {
  let code = 200, out = null;
  const res = { status(c) { code = c; return this; }, setHeader() {}, json(v) { out = v; return this; } };
  await handler({ headers: {}, query: {}, ...req }, res);
  return { status: code, out };
};

test("parseTradeDate：完整日期、民國年、缺年份自動補今年或跨年回推、缺日期與壞日期回傳今天", () => {
  assert.deepEqual(parseTradeDate("2026-05-12", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("2026/5/2 09:05:12", "2026-05-15"), { date: "2026-05-02", dateAssumed: null });
  assert.deepEqual(parseTradeDate("2026.05.12(一)", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("2026年5月12日", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("20260512", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("115/05/12 13:15", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("民國114年12月5日", "2026-05-15"), { date: "2025-12-05", dateAssumed: null });
  assert.deepEqual(parseTradeDate("05/12/2026", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  // 缺年份
  assert.deepEqual(parseTradeDate("05/12 09:05:12", "2026-05-15"), { date: "2026-05-12", dateAssumed: "year" });
  assert.deepEqual(parseTradeDate("５／２", "2026-05-15"), { date: "2026-05-02", dateAssumed: "year" });
  assert.deepEqual(parseTradeDate("5月12日", "2026-05-15"), { date: "2026-05-12", dateAssumed: "year" });
  // 跨年回推與閏年 2/29
  assert.deepEqual(parseTradeDate("12/28", "2026-01-10"), { date: "2025-12-28", dateAssumed: "year" });
  assert.deepEqual(parseTradeDate("02/29", "2025-01-10"), { date: "2024-02-29", dateAssumed: "year" });
  // 缺日期或不存在日期
  assert.deepEqual(parseTradeDate(null, "2026-05-15"), { date: "2026-05-15", dateAssumed: "today" });
  assert.deepEqual(parseTradeDate("", "2026-05-15"), { date: "2026-05-15", dateAssumed: "today" });
  assert.deepEqual(parseTradeDate("2026/02/30", "2026-05-15"), { date: "2026-05-15", dateAssumed: "today" });
  assert.deepEqual(parseTradeDate("02/30", "2026-05-15"), { date: "2026-05-15", dateAssumed: "today" });
});

test("cleanTradeRows：買賣方向、.TW/.TWO 清理、張轉股、0 與空白費稅區分、不合併同天同價分批成交", () => {
  const rows = cleanTradeRows([
    { date: "05/12", side: "現股買進", name: "台積電", code: "2330.TW", shares: "2張", price: "900", fee: 0, tax: null },
    { date: "05/12", side: "BUY", name: "台積電", code: "2330", shares: "2張", price: 900, fee: 0, tax: "" }, // 同天同價第二筆：不得去重
    { date: "115/05/12", side: "現沖賣", name: "環球晶", code: "6488.TWO", shares: "1,000股", price: 500, fee: null, tax: null },
    { date: "2026-05-10", side: "sld", name: "波克夏B", code: "brk.b", shares: 5, price: 420, fee: 0, tax: 0, note: "partial fill" },
    { date: "2026-05-10", side: "買進", name: "撤銷單", code: "2317", shares: 0, price: null }, // 股數 0 且無價：略過
    { date: "2026-05-10", side: "買賣", name: "無法辨識方向", code: "0050", shares: 1000, price: 150 },
  ], { today: "2026-05-15" });

  assert.equal(rows.length, 5, "同天同價兩筆皆保留，撤銷單被過濾");
  assert.deepEqual(rows[0], { date: "2026-05-12", dateAssumed: "year", side: "buy", name: "台積電", code: "2330", shares: 2000, price: 900, fee: 0, tax: null, dayTrade: false, note: "" });
  assert.deepEqual(rows[1], { date: "2026-05-12", dateAssumed: "year", side: "buy", name: "台積電", code: "2330", shares: 2000, price: 900, fee: 0, tax: null, dayTrade: false, note: "" });
  assert.deepEqual(rows[2], { date: "2026-05-12", dateAssumed: null, side: "sell", name: "環球晶", code: "6488", shares: 1000, price: 500, fee: null, tax: null, dayTrade: true, note: "" });
  assert.equal(rows[3].code, "BRK.B"); assert.equal(rows[3].side, "sell"); assert.equal(rows[3].fee, 0); assert.equal(rows[3].tax, 0);
  assert.equal(rows[4].side, null, "不明確的方向標成 null 給使用者選");
  // cleanRows 向後相容
  assert.equal(cleanRows([{ name: "台積電", code: "2330.TW", shares: 1000 }])[0].code, "2330");
});

test("POST /api/import：mode=trades、mode 預設 holdings、不合法 mode 回 400、Claude 開關規則一致", async () => {
  const img = "data:image/png;base64,AAAA";
  // 不支援的模式 → 400，不呼叫 AI
  const bad = await withMockAI({ GEMINI_API_KEY: "g" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img], mode: "margin" } });
    return { r, sent };
  });
  assert.equal(bad.r.status, 400); assert.equal(bad.r.out.ok, false); assert.equal(bad.sent.gemini.length, 0);

  // mode=trades 使用 Gemini 成交明細 prompt，並保留分批重複列
  const tr = await withMockAI({ GEMINI_API_KEY: "g" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img], mode: "trades" } });
    return { r, sent };
  }, { rows: [
    { date: "2026-05-10", side: "買進", name: "台積電", code: "2330", shares: 500, price: 900, fee: 0 },
    { date: "2026-05-10", side: "買進", name: "台積電", code: "2330", shares: 500, price: 900, fee: null },
  ] });
  assert.equal(tr.r.status, 200); assert.equal(tr.r.out.ok, true); assert.equal(tr.r.out.mode, "trades");
  assert.equal(tr.r.out.rows.length, 2);
  assert.match(tr.sent.gemini[0].contents[0].parts[1].text, /成交明細/);
  assert.equal(tr.r.out.rows[0].fee, 0); assert.equal(tr.r.out.rows[1].fee, null);

  // 省略 mode：保持舊 holdings 行為
  const hd = await withMockAI({ GEMINI_API_KEY: "g" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img] } });
    return { r, sent };
  }, { rows: [{ name: "輝達", code: "NVDA", shares: 10, avgCost: 120 }] });
  assert.equal(hd.r.out.ok, true); assert.equal(hd.r.out.mode, "holdings");
  assert.match(hd.sent.gemini[0].contents[0].parts[1].text, /庫存（持股）/);

  // 沒開 AI_CLAUDE_ENABLED 時 mode=trades 也不會打 Claude
  const noCl = await withMockAI({ ANTHROPIC_API_KEY: "k" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img], mode: "trades" } });
    return { r, sent };
  });
  assert.equal(noCl.r.out.ok, false); assert.equal(noCl.sent.claude.length, 0);

  // 空成交列：給成交明細專屬訊息
  const emp = await withMockAI({ GEMINI_API_KEY: "g" }, () => callApi({ method: "POST", body: { images: [img], mode: "trades" } }), { rows: [] });
  assert.equal(emp.out.ok, false); assert.match(emp.out.error, /成交明細/);
});

test("prepareHoldingsImport（選項 1）：帳本已持有部位預設不勾選並標示、已全數賣出可再匯入、手續費與稅為 0、不改動原陣列", () => {
  const existing = [
    { v: 1, id: "e1", date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 800, fee: 1140, tax: 0, note: "", source: "manual" },
    { v: 1, id: "e2", date: "2026-01-10", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 1000, price: 150, fee: 213, tax: 0, note: "", source: "manual" },
    { v: 1, id: "e3", date: "2026-02-01", type: "sell", symbol: "2317", market: "tw", currency: "TWD", shares: 1000, price: 160, fee: 228, tax: 480, note: "", source: "manual" },
  ];
  const rawRows = [
    { code: "2330", name: "台積電", sh: 1000, cost: 850 }, // 帳本已有未平倉 1000 股 → 預設 on: false
    { code: "0050", name: "元大台灣50", shares: 2000, avgCost: 180, d: "2026-04-01" },
    { code: "2317", name: "鴻海", shares: 1000, avgCost: 155 }, // 以前買過但已全數賣出 → 非未平倉，預設 on: true
    { code: "NVDA", name: "輝達", shares: 5.5, avgCost: 120 }, // 美股可零碎股數
  ];
  const beforeEx = JSON.stringify(existing), beforeRaw = JSON.stringify(rawRows);
  const P = L.prepareHoldingsImport(rawRows, existing, { today: "2026-05-15", idPrefix: "h-" });
  assert.equal(JSON.stringify(existing), beforeEx); assert.equal(JSON.stringify(rawRows), beforeRaw);
  assert.equal(P.ok, true);
  assert.equal(P.existingOpenCount, 1);
  assert.equal(P.selectedCount, 3);
  assert.equal(P.items[0].on, false); assert.equal(P.items[0].duplicateOpen, true); assert.match(P.items[0].skipReason, /帳本已有 1000 股/);
  assert.equal(P.items[1].on, true); assert.equal(P.items[1].dateAssumed, null);
  assert.equal(P.items[2].on, true); assert.equal(P.items[2].duplicateOpen, false);
  assert.equal(P.items[3].on, true); assert.equal(P.items[3].tx.currency, "USD"); assert.equal(P.items[3].dateAssumed, "today");
  assert.deepEqual(J(P.transactions.map(t => [t.symbol, t.type, t.fee, t.tax, t.source])), [
    ["0050", "transfer_in", 0, 0, "import"],
    ["2317", "transfer_in", 0, 0, "import"],
    ["NVDA", "transfer_in", 0, 0, "import"],
  ]);
  // 驗證寫進存檔能過 validateStore
  const V = L.validateStore({ v: 1, method: "avg", transactions: [...existing, ...P.transactions] }, { today: "2026-05-15" });
  assert.equal(V.ok, true);

  // 若使用者刻意勾選已有持股仍可匯入；缺成本會被擋下
  const forced = L.prepareHoldingsImport([{ code: "2330", shares: 500, avgCost: 900, on: true }], existing, { today: "2026-05-15" });
  assert.equal(forced.ok, true); assert.equal(forced.transactions[0].shares, 500);
  const noCost = L.prepareHoldingsImport([{ code: "0050", shares: 1000, avgCost: null }], existing, { today: "2026-05-15" });
  assert.equal(noCost.ok, false); assert.equal(noCost.items[0].errors[0].code, "invalid_price");
});

test("prepareTradesImport（選項 2）：降冪對帳單排序、費稅 0 vs 空白估算、當沖稅率、擋賣超與提醒重複", () => {
  const existing = [
    { v: 1, id: "t0", date: "2026-05-01", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 880, fee: 1254, tax: 0, note: "", source: "manual" },
  ];
  // 券商最新在上的降冪明細（賣在前、買在後）
  const descRows = [
    { date: "2026-05-12", dateAssumed: "year", side: "sell", code: "2454", shares: 1000, price: 1100, fee: null, tax: null, dayTrade: true },
    { date: "2026-05-12", dateAssumed: "year", side: "buy", code: "2454", shares: 1000, price: 1050, fee: 0, tax: null },
    { date: "2026-05-10", side: "buy", code: "NVDA", shares: 2, price: 120, fee: 0, tax: 0 },
  ];
  const P = L.prepareTradesImport(descRows, existing, { today: "2026-05-15", idPrefix: "tr-" });
  assert.equal(P.ok, true, "降冪對帳單正規化後同一天先買後賣不誤判賣超");
  assert.deepEqual(P.transactions.map(t => [t.date, t.type, t.symbol]), [
    ["2026-05-10", "buy", "NVDA"],
    ["2026-05-12", "buy", "2454"],
    ["2026-05-12", "sell", "2454"],
  ]);
  // 2454 sell: fee/tax 空白 → 估算且當沖稅 0.15%
  assert.equal(P.items[0].tx.fee, null); assert.equal(P.items[0].tx.tax, null);
  assert.equal(P.items[0].computed.feeEstimated, true);
  assert.equal(P.items[0].computed.tax, Math.floor(1100000 * 0.0015));
  // 2454 buy: fee=0 明確為 0 → 不算估算
  assert.equal(P.items[1].tx.fee, 0);
  assert.equal(P.items[1].computed.feeEstimated, false);
  // NVDA buy: fee=0, tax=0
  assert.equal(P.items[2].computed.fee, 0); assert.equal(P.items[2].computed.feeEstimated, false);
  assert.equal(L.validateStore({ v: 1, method: "avg", transactions: [...existing, ...P.transactions] }, { today: "2026-05-15" }).ok, true);

  // 真實賣超：擋下
  const over = L.prepareTradesImport([{ date: "2026-05-12", side: "sell", code: "2330", shares: 2000, price: 920 }], existing, { today: "2026-05-15" });
  assert.equal(over.ok, false); assert.equal(over.errorCount, 1); assert.equal(over.items[0].errors[0].code, "oversell");

  // 可能重複：和既有交易同天、同代號、同股數、同價（即使一張沒寫手續費）要提醒
  const dup = L.prepareTradesImport([{ date: "2026-05-01", side: "buy", code: "2330", shares: 1000, price: 880, fee: null }], existing, { today: "2026-05-15" });
  assert.equal(dup.ok, true); assert.equal(dup.duplicates.length, 1); assert.ok(dup.duplicates[0].warnings.some(w => w.code === "possible_duplicate"));

  // 同代號幣別衝突：擋下
  const clash = L.prepareTradesImport([{ date: "2026-05-12", side: "buy", code: "2330", market: "us", shares: 10, price: 30 }], existing, { today: "2026-05-15" });
  assert.equal(clash.ok, false); assert.equal(clash.items[0].errors[0].code, "currency_conflict");
});
