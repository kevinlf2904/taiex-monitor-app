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

test("parseTradeDate：完整日期、民國年、缺年份回推、歧義月/日標示 mdy、無效日期不退回今天", () => {
  assert.deepEqual(parseTradeDate("2026-05-12", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("2026/5/2 09:05:12", "2026-05-15"), { date: "2026-05-02", dateAssumed: null });
  assert.deepEqual(parseTradeDate("2026.05.12(一)", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("2026年5月12日", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("20260512", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("115/05/12 13:15", "2026-05-15"), { date: "2026-05-12", dateAssumed: null });
  assert.deepEqual(parseTradeDate("民國114年12月5日", "2026-05-15"), { date: "2025-12-05", dateAssumed: null });
  // 美式/歐式斜線日期：月/日與日/月皆合法時標記 mdy；唯一解不標示
  assert.deepEqual(parseTradeDate("05/12/2026", "2026-05-15"), { date: "2026-05-12", dateAssumed: "mdy", altDate: "2026-12-05", rawDate: "05/12/2026" });
  assert.deepEqual(parseTradeDate("05/06/26", "2026-05-15"), { date: "2026-05-06", dateAssumed: "mdy", altDate: "2026-06-05", rawDate: "05/06/26" });
  assert.deepEqual(parseTradeDate("25/05/2026", "2026-05-15"), { date: "2026-05-25", dateAssumed: null });
  assert.deepEqual(parseTradeDate("05/25/2026", "2026-05-15"), { date: "2026-05-25", dateAssumed: null });
  assert.deepEqual(parseTradeDate("05/05/2026", "2026-05-15"), { date: "2026-05-05", dateAssumed: null });
  assert.deepEqual(parseTradeDate("25/05/26", "2026-05-15"), { date: "2026-05-25", dateAssumed: null });
  // 缺年份
  assert.deepEqual(parseTradeDate("05/12 09:05:12", "2026-05-15"), { date: "2026-05-12", dateAssumed: "year" });
  assert.deepEqual(parseTradeDate("５／２", "2026-05-15"), { date: "2026-05-02", dateAssumed: "year" });
  assert.deepEqual(parseTradeDate("5月12日", "2026-05-15"), { date: "2026-05-12", dateAssumed: "year" });
  // 跨年回推與閏年 2/29
  assert.deepEqual(parseTradeDate("12/28", "2026-01-10"), { date: "2025-12-28", dateAssumed: "year" });
  assert.deepEqual(parseTradeDate("02/29", "2025-01-10"), { date: "2024-02-29", dateAssumed: "year" });
  // 僅空白缺日期才帶入今天
  assert.deepEqual(parseTradeDate(null, "2026-05-15"), { date: "2026-05-15", dateAssumed: "today" });
  assert.deepEqual(parseTradeDate("", "2026-05-15"), { date: "2026-05-15", dateAssumed: "today" });
  assert.deepEqual(parseTradeDate("   ", "2026-05-15"), { date: "2026-05-15", dateAssumed: "today" });
  // 壞日曆日或無法辨識字串：回傳 invalid，絕不靜默退回今天
  assert.deepEqual(parseTradeDate("2026/02/30", "2026-05-15"), { date: "", dateAssumed: "invalid", rawDate: "2026/02/30" });
  assert.deepEqual(parseTradeDate("02/30", "2026-05-15"), { date: "", dateAssumed: "invalid", rawDate: "02/30" });
  assert.deepEqual(parseTradeDate("2026-13-40", "2026-05-15"), { date: "", dateAssumed: "invalid", rawDate: "2026-13-40" });
  assert.deepEqual(parseTradeDate("20260230", "2026-05-15"), { date: "", dateAssumed: "invalid", rawDate: "20260230" });
  assert.deepEqual(parseTradeDate("115/02/30", "2026-05-15"), { date: "", dateAssumed: "invalid", rawDate: "115/02/30" });
  assert.deepEqual(parseTradeDate("31/02/2026", "2026-05-15"), { date: "", dateAssumed: "invalid", rawDate: "31/02/2026" });
  assert.deepEqual(parseTradeDate("abc", "2026-05-15"), { date: "", dateAssumed: "invalid", rawDate: "abc" });
});

test("cleanTradeRows：買賣方向、時間擷取、歧義/無效日期保留中繼、.TW/.TWO 清理、0 與空白費稅區分、不合併同天同價分批成交", () => {
  const rows = cleanTradeRows([
    { date: "05/12 09:05:12", side: "現股買進", name: "台積電", code: "2330.TW", shares: "2張", price: "900", fee: 0, tax: null },
    { date: "05/12", time: "1:30 PM", side: "BUY", name: "台積電", code: "2330", shares: "2張", price: 900, fee: 0, tax: "" }, // 同天同價第二筆：不得去重
    { date: "115/05/12 １３：１５", side: "現沖賣", name: "環球晶", code: "6488.TWO", shares: "1,000股", price: 500, fee: null, tax: null },
    { date: "05/06/2026", side: "sld", name: "波克夏B", code: "brk.b", shares: 5, price: 420, fee: 0, tax: 0, note: "partial fill" },
    { date: "2026-05-10", side: "買進", name: "撤銷單", code: "2317", shares: 0, price: null }, // 股數 0 且無價：略過
    { date: "2026/02/30", side: "買賣", name: "無法辨識方向與日期", code: "0050", shares: 1000, price: 150 },
  ], { today: "2026-05-15" });

  assert.equal(rows.length, 5, "同天同價兩筆皆保留，撤銷單被過濾");
  assert.deepEqual(rows[0], { date: "2026-05-12", dateAssumed: "year", time: "09:05:12", side: "buy", name: "台積電", code: "2330", shares: 2000, price: 900, fee: 0, tax: null, dayTrade: false, note: "" });
  assert.deepEqual(rows[1], { date: "2026-05-12", dateAssumed: "year", time: "13:30", side: "buy", name: "台積電", code: "2330", shares: 2000, price: 900, fee: 0, tax: null, dayTrade: false, note: "" });
  assert.deepEqual(rows[2], { date: "2026-05-12", dateAssumed: null, time: "13:15", side: "sell", name: "環球晶", code: "6488", shares: 1000, price: 500, fee: null, tax: null, dayTrade: true, note: "" });
  assert.equal(rows[3].code, "BRK.B"); assert.equal(rows[3].side, "sell"); assert.equal(rows[3].fee, 0); assert.equal(rows[3].tax, 0);
  assert.equal(rows[3].dateAssumed, "mdy"); assert.equal(rows[3].altDate, "2026-06-05"); assert.equal(rows[3].rawDate, "05/06/2026"); assert.equal(rows[3].time, null);
  assert.equal(rows[4].side, null, "不明確的方向標成 null 給使用者選");
  assert.equal(rows[4].date, ""); assert.equal(rows[4].dateAssumed, "invalid"); assert.equal(rows[4].rawDate, "2026/02/30");
  const invalidTime = cleanTradeRows([
    { date: "2026-05-12", time: "25:99", side: "買進", name: "台積電", code: "2330", shares: 100, price: 900 }
  ], { today: "2026-05-15" })[0];
  assert.equal(invalidTime.time, null, "無效時間不可被正規化成空白有效時間");
  assert.equal(invalidTime.timeInvalid, true);
  assert.equal(invalidTime.rawTime, "25:99", "保留 OCR 原始時間供 UI 修正");
  // cleanRows 向後相容
  assert.equal(cleanRows([{ name: "台積電", code: "2330.TW", shares: 1000 }])[0].code, "2330");
});

test("POST /api/import：mode=trades、mode 預設 holdings、無金鑰文案不含文字匯入誤導、不合法 mode 回 400、Claude 開關規則一致", async () => {
  const img = "data:image/png;base64,AAAA";
  // 不支援的模式 → 400，不呼叫 AI
  const bad = await withMockAI({ GEMINI_API_KEY: "g" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img], mode: "margin" } });
    return { r, sent };
  });
  assert.equal(bad.r.status, 400); assert.equal(bad.r.out.ok, false); assert.equal(bad.sent.gemini.length, 0);

  // mode=trades 使用 Gemini 成交明細 prompt，並保留分批重複列與 time / mdy
  const tr = await withMockAI({ GEMINI_API_KEY: "g" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img], mode: "trades" } });
    return { r, sent };
  }, { rows: [
    { date: "2026-05-10", time: "09:05:12", side: "買進", name: "台積電", code: "2330", shares: 500, price: 900, fee: 0 },
    { date: "05/10/2026", time: "09:15:00", side: "買進", name: "台積電", code: "2330", shares: 500, price: 900, fee: null },
  ] });
  assert.equal(tr.r.status, 200); assert.equal(tr.r.out.ok, true); assert.equal(tr.r.out.mode, "trades");
  assert.equal(tr.r.out.rows.length, 2);
  assert.match(tr.sent.gemini[0].contents[0].parts[1].text, /成交明細/);
  assert.equal(tr.r.out.rows[0].time, "09:05:12");
  assert.equal(tr.r.out.rows[0].fee, 0); assert.equal(tr.r.out.rows[1].fee, null);
  assert.equal(tr.r.out.rows[1].dateAssumed, "mdy"); assert.equal(tr.r.out.rows[1].altDate, "2026-10-05");

  // 省略 mode：保持舊 holdings 行為
  const hd = await withMockAI({ GEMINI_API_KEY: "g" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img] } });
    return { r, sent };
  }, { rows: [{ name: "輝達", code: "NVDA", shares: 10, avgCost: 120 }] });
  assert.equal(hd.r.out.ok, true); assert.equal(hd.r.out.mode, "holdings");
  assert.match(hd.sent.gemini[0].contents[0].parts[1].text, /庫存（持股）/);

  // 沒設 GEMINI_API_KEY 且沒開 AI_CLAUDE_ENABLED：兩種 mode 都不得提到「文字匯入」以免誤導交易紀錄入口
  const noKeyHold = await withMockAI({}, () => callApi({ method: "POST", body: { images: [img], mode: "holdings" } }));
  assert.equal(noKeyHold.out.ok, false);
  assert.doesNotMatch(noKeyHold.out.error, /文字匯入/);
  assert.match(noKeyHold.out.error, /其他匯入方式/);

  const noCl = await withMockAI({ ANTHROPIC_API_KEY: "k" }, async sent => {
    const r = await callApi({ method: "POST", body: { images: [img], mode: "trades" } });
    return { r, sent };
  });
  assert.equal(noCl.r.out.ok, false); assert.equal(noCl.sent.claude.length, 0);
  assert.doesNotMatch(noCl.r.out.error, /文字匯入/);
  assert.match(noCl.r.out.error, /手動表格輸入/);

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

test("prepareTradesImport（選項 2）：有時間跨區間才排序、費稅 0 vs 空白估算、當沖稅率、擋賣超與提醒重複", () => {
  const existing = [
    { v: 1, id: "t0", date: "2026-05-01", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 880, fee: 1254, tax: 0, note: "", source: "manual" },
  ];
  // 券商最新在上的降冪明細，且附可驗證成交時間（09:05 買進、10:15 賣出）→ 允許重排成先買後賣
  const descTimed = [
    { date: "2026-05-12", time: "10:15", dateAssumed: "year", side: "sell", code: "2454", shares: 1000, price: 1100, fee: null, tax: null, dayTrade: true },
    { date: "2026-05-12", time: "09:05", dateAssumed: "year", side: "buy", code: "2454", shares: 1000, price: 1050, fee: 0, tax: null },
    { date: "2026-05-10", side: "buy", code: "NVDA", shares: 2, price: 120, fee: 0, tax: 0 },
  ];
  const P = L.prepareTradesImport(descTimed, existing, { today: "2026-05-15", idPrefix: "tr-" });
  assert.equal(P.ok, true, "有明確互不重疊時間的降冪對帳單排序後不誤判賣超");
  assert.equal(P.needsOrderConfirm, false);
  assert.deepEqual(J(P.ambiguousSameDay), []);
  assert.deepEqual(P.transactions.map(t => [t.date, t.time ?? null, t.type, t.symbol]), [
    ["2026-05-10", null, "buy", "NVDA"],
    ["2026-05-12", "09:05", "buy", "2454"],
    ["2026-05-12", "10:15", "sell", "2454"],
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

  // 有時間但真的先賣後買（09:05 賣、10:15 買）：絕不翻轉，直接擋賣超
  const trueShortTimed = [
    { date: "2026-05-12", time: "09:05", side: "sell", code: "2454", shares: 1000, price: 1100 },
    { date: "2026-05-12", time: "10:15", side: "buy", code: "2454", shares: 1000, price: 1050 },
  ];
  const stRes = L.prepareTradesImport(trueShortTimed, existing, { today: "2026-05-15" });
  assert.equal(stRes.ok, false);
  assert.equal(stRes.items[0].errors[0].code, "oversell");

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

test("prepareTradesImport（高風險對抗案例）：無時間/同分鐘重疊之同日買賣不盲目反轉、序號排序、mdy/無效日期/無效時間皆擋下", () => {
  // 1. 期初持股 0，無時間且「先賣後買」：絕不盲翻，擋賣超＋標示 sameDayOversell（即使 orderConfirmed: true 也不放行）
  const noTimeSellFirst = [
    { date: "2026-05-12", side: "sell", code: "2454", shares: 100, price: 1100 },
    { date: "2026-05-12", side: "buy", code: "2454", shares: 100, price: 1050 },
  ];
  const r1 = L.prepareTradesImport(noTimeSellFirst, [], { today: "2026-05-15", orderConfirmed: true });
  assert.equal(r1.ok, false);
  assert.equal(r1.errorCount, 1);
  assert.equal(r1.sameDayOversell, true);
  assert.equal(r1.items[0].errors[0].code, "oversell");

  // 2. 期初持股 0，無時間且「先買後賣」：回報 ambiguousSameDay (affectsOversell: true)，未確認前 needsOrderConfirm 擋下；勾選確認後放行
  const noTimeBuyFirst = [
    { date: "2026-05-12", side: "buy", code: "2454", shares: 100, price: 1050 },
    { date: "2026-05-12", side: "sell", code: "2454", shares: 100, price: 1100 },
  ];
  const r2a = L.prepareTradesImport(noTimeBuyFirst, [], { today: "2026-05-15" });
  assert.equal(r2a.ok, false);
  assert.equal(r2a.errorCount, 0);
  assert.equal(r2a.needsOrderConfirm, true);
  assert.equal(r2a.ambiguousSameDay.length, 1);
  assert.equal(r2a.ambiguousSameDay[0].affectsOversell, true);
  const r2b = L.prepareTradesImport(noTimeBuyFirst, [], { today: "2026-05-15", orderConfirmed: true });
  assert.equal(r2b.ok, true);
  assert.equal(r2b.needsOrderConfirm, false);

  // 3. 期初持股 100，無時間賣 100＋買 100（會影響 FIFO／平均成本基準）：兩種順序都需要 orderConfirmed；若賣 200 買 100 仍直接擋賣超
  const init100 = [{ v: 1, id: "init100", date: "2026-05-01", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 800, fee: 0, tax: 0, source: "manual" }];
  const r3a = L.prepareTradesImport([
    { date: "2026-05-12", side: "sell", code: "2330", shares: 100, price: 900 },
    { date: "2026-05-12", side: "buy", code: "2330", shares: 100, price: 850 },
  ], init100, { today: "2026-05-15", method: "fifo" });
  assert.equal(r3a.ok, false);
  assert.equal(r3a.needsOrderConfirm, true);
  assert.equal(r3a.ambiguousSameDay.length, 1);
  assert.equal(r3a.ambiguousSameDay[0].affectsOversell, false);
  assert.equal(L.prepareTradesImport([
    { date: "2026-05-12", side: "sell", code: "2330", shares: 100, price: 900 },
    { date: "2026-05-12", side: "buy", code: "2330", shares: 100, price: 850 },
  ], init100, { today: "2026-05-15", method: "fifo", orderConfirmed: true }).ok, true);

  const r3Over = L.prepareTradesImport([
    { date: "2026-05-12", side: "sell", code: "2330", shares: 200, price: 900 },
    { date: "2026-05-12", side: "buy", code: "2330", shares: 100, price: 850 },
  ], init100, { today: "2026-05-15", orderConfirmed: true });
  assert.equal(r3Over.ok, false);
  assert.equal(r3Over.sameDayOversell, true);
  assert.equal(r3Over.items[0].errors[0].code, "oversell");

  // 4. 只有分到分鐘、且落於同一分鐘內（09:05 vs 09:05 或 09:05:10）：區間重疊 → 不重排，依歧義或賣超處理
  const sameMinOverlap = L.prepareTradesImport([
    { date: "2026-05-12", time: "09:05:10", side: "sell", code: "2454", shares: 100, price: 1100 },
    { date: "2026-05-12", time: "09:05", side: "buy", code: "2454", shares: 100, price: 1050 },
  ], [], { today: "2026-05-15" });
  assert.equal(sameMinOverlap.ok, false);
  assert.equal(sameMinOverlap.sameDayOversell, true);
  assert.equal(sameMinOverlap.items[0].errors[0].code, "oversell");

  const sameMinBuyFirst = L.prepareTradesImport([
    { date: "2026-05-12", time: "09:05", side: "buy", code: "2454", shares: 100, price: 1050 },
    { date: "2026-05-12", time: "09:05", side: "sell", code: "2454", shares: 100, price: 1100 },
  ], [], { today: "2026-05-15" });
  assert.equal(sameMinBuyFirst.ok, false);
  assert.equal(sameMinBuyFirst.needsOrderConfirm, true);

  // 同分鐘但兩筆都精確到秒且時間不同（09:05:05 買、09:05:10 賣）：互不重疊，可安全排序
  const secDisjoint = L.prepareTradesImport([
    { date: "2026-05-12", time: "09:05:10", side: "sell", code: "2454", shares: 100, price: 1100 },
    { date: "2026-05-12", time: "09:05:05", side: "buy", code: "2454", shares: 100, price: 1050 },
  ], [], { today: "2026-05-15" });
  assert.equal(secDisjoint.ok, true);
  assert.equal(secDisjoint.needsOrderConfirm, false);
  assert.deepEqual(secDisjoint.transactions.map(t => t.type), ["buy", "sell"]);

  // 5. 同分鐘無秒但提供不重複 seq 序號：可驗證排序
  const seqOk = L.prepareTradesImport([
    { date: "2026-05-12", time: "09:05", seq: 2, side: "sell", code: "2454", shares: 100, price: 1100 },
    { date: "2026-05-12", time: "09:05", seq: 1, side: "buy", code: "2454", shares: 100, price: 1050 },
  ], [], { today: "2026-05-15" });
  assert.equal(seqOk.ok, true);
  assert.equal(seqOk.needsOrderConfirm, false);

  // 6. 同日同方向多筆買進（無買賣混合）：無需順序確認
  const twoBuys = L.prepareTradesImport([
    { date: "2026-05-12", side: "buy", code: "2454", shares: 500, price: 1050 },
    { date: "2026-05-12", side: "buy", code: "2454", shares: 500, price: 1060 },
  ], [], { today: "2026-05-15" });
  assert.equal(twoBuys.ok, true);
  assert.deepEqual(J(twoBuys.ambiguousSameDay), []);
  assert.equal(twoBuys.needsOrderConfirm, false);

  const fifoTwoBuys = L.prepareTradesImport([
    { date: "2026-05-12", side: "buy", code: "2454", shares: 500, price: 1050 },
    { date: "2026-05-12", side: "buy", code: "2454", shares: 500, price: 1060 },
  ], [], { today: "2026-05-15", method: "fifo" });
  assert.equal(fifoTwoBuys.ok, false, "FIFO 同日多筆買進會改變批次先後，無可靠順序時必須確認");
  assert.equal(fifoTwoBuys.needsOrderConfirm, true);
  assert.equal(fifoTwoBuys.ambiguousSameDay.length, 1);
  assert.equal(fifoTwoBuys.ambiguousSameDay[0].affectsFifo, true);
  assert.equal(fifoTwoBuys.ambiguousSameDay[0].mixedSides, false);
  const fifoTwoBuysConfirmed = L.prepareTradesImport([
    { date: "2026-05-12", side: "buy", code: "2454", shares: 500, price: 1050 },
    { date: "2026-05-12", side: "buy", code: "2454", shares: 500, price: 1060 },
  ], [], { today: "2026-05-15", method: "fifo", orderConfirmed: true });
  assert.equal(fifoTwoBuysConfirmed.ok, true);
  const fifoTimedBuys = L.prepareTradesImport([
    { date: "2026-05-12", time: "09:05", side: "buy", code: "2454", shares: 500, price: 1050 },
    { date: "2026-05-12", time: "09:10", side: "buy", code: "2454", shares: 500, price: 1060 },
  ], [], { today: "2026-05-15", method: "fifo" });
  assert.equal(fifoTimedBuys.ok, true, "FIFO 同方向交易有不重疊成交時間可自動排序");
  assert.equal(fifoTimedBuys.needsOrderConfirm, false);

  // 7. 歧義 mdy、無效日期與無效時間皆阻擋
  const mdyErr = L.prepareTradesImport([{ date: "2026-05-06", dateAssumed: "mdy", altDate: "2026-06-05", rawDate: "05/06/2026", side: "buy", code: "2330", shares: 100, price: 900 }], [], { today: "2026-05-15" });
  assert.equal(mdyErr.ok, false);
  assert.equal(mdyErr.items[0].errors[0].code, "unconfirmed_date_format");

  const badDateErr = L.prepareTradesImport([{ date: "", dateAssumed: "invalid", rawDate: "2026/02/30", side: "buy", code: "2330", shares: 100, price: 900 }], [], { today: "2026-05-15" });
  assert.equal(badDateErr.ok, false);
  assert.equal(badDateErr.items[0].errors[0].code, "invalid_date");

  const badTimeErr = L.prepareTradesImport([{ date: "2026-05-12", time: "25:99", side: "buy", code: "2330", shares: 100, price: 900 }], [], { today: "2026-05-15" });
  assert.equal(badTimeErr.ok, false);
  assert.equal(badTimeErr.items[0].errors[0].code, "invalid_time");
});

