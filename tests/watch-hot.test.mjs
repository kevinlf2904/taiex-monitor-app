import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const htmlPath = fileURLToPath(new URL("../learner/watch.html", import.meta.url));
const html = fs.readFileSync(htmlPath, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error("Marker not found: " + startMarker);
  const end = html.indexOf(endMarker, start);
  if (end === -1) throw new Error("End marker not found: " + endMarker);
  return html.slice(start, end);
}

const visibleCodesCode = extractBlock("function visibleCodes()", "// 台指期近月") + "\r\nthis.visibleCodes = visibleCodes;";
const liveQuoteMtileCode = extractBlock("function liveQuote(r)", "const scrRow =") + "\r\nthis.liveQuote = liveQuote;\r\nthis.mtile = mtile;";
const loadMkHotCode = extractBlock("const MK_HOT_TTL =", "// 選項裡的 [") +
  "\r\nthis.loadMkHot = loadMkHot;\r\nthis.hotSec = hotSec;\r\nthis.MK_HOT_TTL = MK_HOT_TTL;\r\nthis.MK_HOT_ERR_TTL = MK_HOT_ERR_TTL;";
const liveRefreshCode = extractBlock("function liveRefresh()", "// 大盤盤中只重抓個股統計與期貨") + "\r\nthis.liveRefresh = liveRefresh;";

function createHarness() {
  const W = {
    lt: "mkt",
    mkHot: "value",
    mkReg: "tw",
    session: "open",
    hot: {},
    quotes: new Map(),
    names: {},
    alerts: {},
    hold: {},
    holdMkt: "tw",
    scr: null,
    mkt: { at: Date.now() },
    mks: { at: Date.now() },
    off: false,
    mkHotInFlight: {},
    mkHotGen: {},
  };

  let getJMock = async () => ({ rows: [] });
  let renderListCount = 0;
  let pollListCount = 0;
  let liveLoadedType = null;

  const stub = new Proxy(function () {}, {
    get: (t, k) => {
      if (k === "dataset") return {};
      if (k === "classList") return { add() {}, remove() {}, contains: () => false };
      if (k === "style") return {};
      if (k === Symbol.toPrimitive) return () => "";
      return stub;
    },
    apply: () => stub,
    construct: () => stub
  });

  const c = {
    console,
    Math,
    Date,
    JSON,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    isFinite,
    parseFloat,
    parseInt,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    encodeURIComponent,
    addEventListener: () => {},
    removeEventListener: () => {},
    W,
    isTW: code => /^\d{4,6}[A-Z]?$/.test(code),
    isIdx: code => code === "T00" || code === "O00" || code === "TXF",
    isFut: code => code === "TXF",
    cls: v => (v > 0 ? "up" : v < 0 ? "down" : ""),
    arrow: v => (v > 0 ? "▲" : v < 0 ? "▼" : ""),
    nameOf: code => (c.isIdx(code) ? { T00: "加權指數", O00: "櫃買指數", TXF: "台指期近月" }[code] : W.quotes.get(code)?.name || W.names[code] || code),
    curList: () => [],
    mktOf: () => "tw",
    etfVisible: () => [],
    getJ: (...args) => getJMock(...args),
    renderList: () => { renderListCount++; },
    pollList: async () => {
      pollListCount++;
      for (const code of c.visibleCodes()) {
        if (!W.quotes.has(code)) {
          W.quotes.set(code, { code, price: 100, chgPct: 1.0, date: "2026-10-27" });
        }
      }
    },
    loadMktLive: () => {},
    loadMktStats: () => {},
    lazyOk: () => false,
  };

  c.window = c;
  c.top = c;
  c.location = { protocol: "http:", search: "" };
  c.document = stub;
  c.navigator = { userAgent: "" };

  const L = f => fileURLToPath(new URL(`../learner/${f}`, import.meta.url));
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(L("core.js"), "utf8"), c);

  // Run extracted code from watch.html
  vm.runInContext(visibleCodesCode, c);
  vm.runInContext(liveQuoteMtileCode, c);
  vm.runInContext(loadMkHotCode, c);
  vm.runInContext(liveRefreshCode, c);

  return {
    ctx: c,
    W,
    setGetJ: fn => { getJMock = fn; },
    getRenderCount: () => renderListCount,
    getPollCount: () => pollListCount,
  };
}

test("visibleCodes: 大盤頁面包含熱門股前 9 檔、嚴格不超過 40 檔、核心代碼優先不被擠壓", () => {
  const { ctx, W } = createHarness();
  W.lt = "mkt";
  W.mkHot = "value";
  W.hot["rank:value"] = {
    at: Date.now(),
    rows: Array.from({ length: 20 }, (_, i) => ({
      code: `230${i}`,
      name: `股票${i}`,
      price: 100 + i,
      chgPct: 1.5,
    })),
  };

  // Add 50 alert codes to test limit
  for (let i = 0; i < 50; i++) {
    W.alerts[`300${i}`] = true;
  }

  const codes = ctx.visibleCodes();
  assert.equal(codes.length, 40, "代號總數必須嚴格被截斷在 40 檔");

  // Core codes check
  const expectedCore = ["T00", "O00", "0050", ...Array.from({ length: 9 }, (_, i) => `230${i}`)];
  for (const c of expectedCore) {
    assert.ok(codes.includes(c), `核心代碼 ${c} 必須存在於 visibleCodes`);
  }
  assert.deepEqual(Array.from(codes.slice(0, 12)), expectedCore, "核心代碼（指數、0050、前 9 檔熱門股）必須優先排在最前 12 檔");

  // Switch to watch tab -> hot stocks should not be present
  W.lt = "watch";
  const watchCodes = ctx.visibleCodes();
  assert.ok(!watchCodes.includes("2300"), "非大盤頁籤不應注入 mkHot 熱門股");
});

test("liveQuote 與 mtile: 即時報價優先、失效或缺漏時平順回退、完整保留樣式與按鈕結構", () => {
  const { ctx, W } = createHarness();

  // 1. Valid quote available
  W.quotes.set("2330", { code: "2330", name: "台積電", price: 1060, chg: 25, chgPct: 2.42, date: "2026-10-27" });
  const raw1 = { code: "2330", name: "台積電", price: 1000, chgPct: 1.0, date: "2026-10-27" };
  const q1 = ctx.liveQuote(raw1);
  assert.equal(q1.price, 1060, "有即時報價時應採用即時價格");
  assert.equal(q1.chgPct, 2.42, "有即時報價時應採用即時漲跌幅");

  const html1 = ctx.mtile(raw1);
  assert.match(html1, /class="mtile up"/, "漲幅為正應有 up 類別");
  assert.match(html1, /1060<\/b>/, "磁貼價格應顯示即時報價 1060");
  assert.match(html1, /▲2\.42%<\/small>/, "磁貼漲跌幅應顯示即時 ▲2.42%");
  assert.match(html1, /data-sel="2330"/, "按鈕必須帶有 data-sel");

  // 2. Quote missing -> fallback to snapshot
  const raw2 = { code: "2317", name: "鴻海", price: 210, chg: -5, chgPct: -2.33, date: "2026-10-27" };
  const q2 = ctx.liveQuote(raw2);
  assert.equal(q2.price, 210, "無即時報價時應回退到排行快照價格");
  assert.equal(q2.chgPct, -2.33, "無即時報價時應回退到排行快照漲跌幅");

  const html2 = ctx.mtile(raw2);
  assert.match(html2, /class="mtile down"/, "跌幅為負應有 down 類別");
  assert.match(html2, /210\.0<\/b>/, "磁貼價格回退到 210.0");
  assert.match(html2, /▼2\.33%<\/small>/, "磁貼漲跌幅回退到 ▼2.33%");

  // 3. Stale quote (quote date < snapshot date) -> fallback to snapshot
  W.quotes.set("2454", { code: "2454", price: 1200, chgPct: 0.5, date: "2026-10-26" });
  const raw3 = { code: "2454", name: "聯發科", price: 1300, chgPct: 3.5, date: "2026-10-27" };
  const q3 = ctx.liveQuote(raw3);
  assert.equal(q3.price, 1300, "報價日期早於快照日期時不應採信，回退快照價格");

  // 4. Invalid quote price (0, null, NaN) -> fallback to snapshot
  W.quotes.set("2382", { code: "2382", price: 0, chgPct: null, date: "2026-10-27" });
  const raw4 = { code: "2382", name: "廣達", price: 300, chgPct: 1.2 };
  const q4 = ctx.liveQuote(raw4);
  assert.equal(q4.price, 300, "即時報價價格非大於 0 時回退快照價格");
});

test("loadMkHot: TTL 快取控制、in-flight 請求共用、競態覆蓋防護、錯誤保留與重試冷卻", async () => {
  const { ctx, W, setGetJ } = createHarness();
  let fetchCount = 0;
  let delay = 10;
  let responseData = { rows: [{ code: "2330", name: "台積電", price: 1000 }] };

  setGetJ(async url => {
    fetchCount++;
    const curDelay = delay;
    const curData = responseData;
    await new Promise(r => setTimeout(r, curDelay));
    if (curData.error) throw new Error(curData.error);
    return curData;
  });

  // 1. Initial fetch
  await ctx.loadMkHot("value");
  assert.equal(fetchCount, 1);
  assert.equal(W.hot["rank:value"]?.rows?.length, 1);
  assert.equal(W.hot["rank:value"]?.err, null);

  // 2. Immediate second call -> cache hit within TTL (30s), no fetch
  await ctx.loadMkHot("value");
  assert.equal(fetchCount, 1, "30 秒 TTL 內重複呼叫不應發出新請求");

  // 3. force = true -> bypasses TTL
  await ctx.loadMkHot("value", true);
  assert.equal(fetchCount, 2, "force: true 應強制穿透快取重新抓取");

  // 4. In-flight sharing: concurrent calls share single promise
  delay = 50;
  const pA = ctx.loadMkHot("gain");
  const pB = ctx.loadMkHot("gain");
  assert.equal(pA, pB, "併發呼叫相同分類應共用同一個 in-flight Promise");
  await Promise.all([pA, pB]);
  assert.equal(fetchCount, 3, "併發呼叫只應發出 1 次請求");

  // 5. Race condition protection: older generation does not overwrite newer generation
  let resolveReq1, resolveReq2;
  const req1Promise = new Promise(r => { resolveReq1 = r; });
  const req2Promise = new Promise(r => { resolveReq2 = r; });

  setGetJ(async () => {
    fetchCount++;
    if (fetchCount === 4) {
      await req1Promise;
      return { rows: [{ code: "2330", name: "台積電-舊資料", price: 900 }] };
    } else {
      await req2Promise;
      return { rows: [{ code: "2330", name: "台積電-新資料", price: 1100 }] };
    }
  });

  // Launch req 1 (force)
  const p1 = ctx.loadMkHot("volume", true);
  // Launch req 2 (force) -> newer generation
  const p2 = ctx.loadMkHot("volume", true);

  // Resolve req 2 first (newer)
  resolveReq2();
  await p2;
  assert.equal(W.hot["rank:volume"].rows[0].price, 1100, "新請求應寫入資料");

  // Resolve req 1 later (older) -> should be discarded
  resolveReq1();
  await p1;
  assert.equal(W.hot["rank:volume"].rows[0].price, 1100, "舊請求完成時不可覆蓋新一代的結果");

  // 6. Error handling: preserves previous rows, records err, enforces retry backoff
  setGetJ(async () => {
    fetchCount++;
    throw new Error("Network timeout");
  });
  await ctx.loadMkHot("volume", true);
  assert.equal(W.hot["rank:volume"].err, "Network timeout", "錯誤訊息應記錄在 err");
  assert.equal(W.hot["rank:volume"].rows[0].price, 1100, "失敗時應保留前一次成功的 rows，避免畫面空白");

  // Subsequent call within error cooldown (15s) -> should be rejected by backoff
  const countBeforeCooldown = fetchCount;
  await ctx.loadMkHot("volume");
  assert.equal(fetchCount, countBeforeCooldown, "錯誤冷卻時間 (15s) 內不應反覆發出請求");

  // After cooldown expires -> allows retry
  W.hot["rank:volume"].errAt = Date.now() - 16000;
  setGetJ(async () => {
    fetchCount++;
    return { rows: [{ code: "2330", name: "台積電-重試成功", price: 1200 }] };
  });
  await ctx.loadMkHot("volume");
  assert.equal(W.hot["rank:volume"].err, null, "冷卻期過後自動重試成功，清除 err");
  assert.equal(W.hot["rank:volume"].rows[0].price, 1200);
});

test("liveRefresh: 大盤盤中熱門股過期或出錯時自動重刷，未過期時不重複觸發", () => {
  const { ctx, W } = createHarness();
  let loadedType = null;
  ctx.loadMkHot = t => { loadedType = t; };

  W.lt = "mkt";
  W.session = "open";
  W.mkHot = "value";

  // Fresh cache -> not triggered
  W.hot["rank:value"] = { at: Date.now(), rows: [{ code: "2330" }] };
  ctx.liveRefresh();
  assert.equal(loadedType, null, "熱門股未過期時 liveRefresh 不應重抓");

  // Expired cache (> 30s) -> triggered
  W.hot["rank:value"].at = Date.now() - 35000;
  ctx.liveRefresh();
  assert.equal(loadedType, "value", "熱門股超過 30 秒過期時 liveRefresh 應自動重抓");

  // Errored cache (> 15s) -> triggered for retry
  loadedType = null;
  W.hot["rank:value"] = { at: Date.now() - 40000, err: "Failed", errAt: Date.now() - 16000, rows: [] };
  ctx.liveRefresh();
  assert.equal(loadedType, "value", "熱門股錯誤超過冷卻期時 liveRefresh 應自動重試");
});
