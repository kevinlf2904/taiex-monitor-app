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
const liveTagCode = extractBlock("const liveTag =", "// 每秒只更新報價") + "\r\nthis.liveTag = liveTag;";

const pollListCode = extractBlock("async function pollList()", "async function pollDetail()") + "\r\nthis.pollList = pollList;";
const pollDetailCode = extractBlock("async function pollDetail()", "// 嵌在首頁、切到別的分頁時") + "\r\nthis.pollDetail = pollDetail;";
const tagsHtmlCode = extractBlock("function tagsHtml(c, q, lim)", "$(\"#favBtn\")") + "\r\nthis.tagsHtml = tagsHtml;";

function createHarness() {
  const W = {
    lt: "mkt",
    mkHot: "value",
    mkReg: "tw",
    session: "open",
    today: "2026-10-27",
    hot: {},
    quotes: new Map(),
    prevPx: new Map(),
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
    setTimeout: (fn, ms, ...args) => {
      const timer = setTimeout(fn, ms, ...args);
      if (timer && typeof timer.unref === "function") timer.unref();
      return timer;
    },
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    encodeURIComponent,
    addEventListener: () => {},
    removeEventListener: () => {},
    W,
    isTW: code => /^\d{4,6}[A-Z]?$/.test(code),
    isUS: code => /^[A-Z]{1,5}$/.test(code),
    isIdx: code => code === "T00" || code === "O00" || code === "TXF",
    isFut: code => code === "TXF",
    cls: v => (v > 0 ? "up" : v < 0 ? "down" : ""),
    arrow: v => (v > 0 ? "▲" : v < 0 ? "▼" : ""),
    esc: s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    fmtP: p => (p != null ? Number(p).toFixed(1) : "—"),
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
    age: obj => (obj?.at ? Date.now() - obj.at : 1e9),
    pollFut: async () => {},
    renderTop: () => {},
    twDayMark: () => {},
    twDayState: () => "trade",
    store: { set() {}, get() {} },
    isEtf: () => false,
    pastDaily: () => null,
    volRatio: () => null,
    streak: () => 0,
    intelData: () => [],
    mergeDaily: () => {},
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
  vm.runInContext(liveTagCode, c);
  vm.runInContext(pollListCode, c);
  vm.runInContext(pollDetailCode, c);
  vm.runInContext(tagsHtmlCode, c);

  return {
    ctx: c,
    W,
    setGetJ: fn => { getJMock = fn; },
    getRenderCount: () => renderListCount,
    getPollCount: () => pollListCount,
  };
}

// ==========================================
// Phase A: C1 即時報價與熱門股更新鏈路測試
// ==========================================

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

  // 測試 50 檔警示代號上限截斷
  for (let i = 0; i < 50; i++) {
    W.alerts[`300${i}`] = true;
  }

  const codes = ctx.visibleCodes();
  assert.equal(codes.length, 40, "代號總數必須嚴格被截斷在 40 檔");

  // 核心項目檢查
  const expectedCore = ["T00", "O00", "0050", ...Array.from({ length: 9 }, (_, i) => `230${i}`)];
  for (const c of expectedCore) {
    assert.ok(codes.includes(c), `核心代碼 ${c} 必須存在於 visibleCodes`);
  }
  assert.deepEqual(Array.from(codes.slice(0, 12)), expectedCore, "核心代碼（指數、0050、前 9 檔熱門股）必須優先排在最前 12 檔");

  // 切換至自選分頁 -> 不應注入熱門股
  W.lt = "watch";
  const watchCodes = ctx.visibleCodes();
  assert.ok(!watchCodes.includes("2300"), "非大盤頁籤不應注入 mkHot 熱門股");
});

test("visibleCodes: 超過上限的熱門股與自選清單、優先級順序、去重且不超過 40 檔", () => {
  const { ctx, W } = createHarness();
  W.lt = "watch";

  // 自選清單有 50 檔股票（包含 0050、0056、00878 及個股）
  const userList = ["0050", "0056", "00878", ...Array.from({ length: 47 }, (_, i) => `240${i}`)];
  ctx.curList = () => userList;

  // 加入熱門股快照，模擬熱門股存在
  W.hot["rank:value"] = {
    at: Date.now(),
    rows: Array.from({ length: 30 }, (_, i) => ({ code: `230${i}` })),
  };

  const codes = ctx.visibleCodes();
  assert.equal(codes.length, 40, "自選清單超過 40 檔時總數嚴格為 40");
  assert.equal(codes[0], "T00", "首檔必須為加權指數 T00");
  assert.equal(codes[1], "O00", "第二檔必須為櫃買指數 O00");
  assert.equal(codes[2], "0050", "自選中的 0050 必須保留");
  assert.equal(codes[3], "0056", "自選中的 0056 必須保留");
  assert.equal(codes[4], "00878", "自選中的 00878 必須保留");
  assert.ok(!codes.includes("2300"), "自選分頁不得被熱門股擠壓或截斷");
  assert.equal(new Set(codes).size, 40, "輪詢清單不能有重複代碼");
});

test("liveQuote 與 mtile: 即時報價優先、失效或缺漏時平順回退、完整保留樣式與按鈕結構", () => {
  const { ctx, W } = createHarness();

  // 1. 即時報價有效
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

  // 2. 即時報價缺漏 -> 回退快照
  const raw2 = { code: "2317", name: "鴻海", price: 210, chg: -5, chgPct: -2.33, date: "2026-10-27" };
  const q2 = ctx.liveQuote(raw2);
  assert.equal(q2.price, 210, "無即時報價時應回退到排行快照價格");
  assert.equal(q2.chgPct, -2.33, "無即時報價時應回退到排行快照漲跌幅");

  const html2 = ctx.mtile(raw2);
  assert.match(html2, /class="mtile down"/, "跌幅為負應有 down 類別");
  assert.match(html2, /210\.0<\/b>/, "磁貼價格回退到 210.0");
  assert.match(html2, /▼2\.33%<\/small>/, "磁貼漲跌幅回退到 ▼2.33%");

  // 3. 報價過期（日期早於快照日期）
  W.quotes.set("2454", { code: "2454", price: 1200, chgPct: 0.5, date: "2026-10-26" });
  const raw3 = { code: "2454", name: "聯發科", price: 1300, chgPct: 3.5, date: "2026-10-27" };
  const q3 = ctx.liveQuote(raw3);
  assert.equal(q3.price, 1300, "報價日期早於快照日期時不應採信，回退快照價格");

  // 4. 即時報價為 0、null、NaN
  W.quotes.set("2382", { code: "2382", price: 0, chgPct: null, date: "2026-10-27" });
  const raw4 = { code: "2382", name: "廣達", price: 300, chgPct: 1.2, date: "2026-10-27" };
  const q4 = ctx.liveQuote(raw4);
  assert.equal(q4.price, 300, "即時報價價格非大於 0 時回退快照價格");
});

test("liveQuote: 無效價格（0、負數、null、NaN、字串）與舊日期資料不可覆蓋有效即時報價", () => {
  const { ctx, W } = createHarness();
  const validSnapshot = { code: "2330", name: "台積電", price: 1050, chg: 10, chgPct: 0.96, date: "2026-10-27" };

  for (const badPrice of [0, -10, null, undefined, NaN, "1000"]) {
    W.quotes.set("2330", { code: "2330", price: badPrice, date: "2026-10-27" });
    const q = ctx.liveQuote(validSnapshot);
    assert.equal(q.price, 1050, `價格為 ${badPrice} 時不可覆蓋有效快照價`);
  }

  // 舊交易日不可覆蓋當日
  W.quotes.set("2330", { code: "2330", price: 900, date: "2026-10-26" });
  const qOld = ctx.liveQuote(validSnapshot);
  assert.equal(qOld.price, 1050, "前一交易日價格不可覆蓋當日有效資料");
});

test("loadMkHot: TTL 快取控制、in-flight 請求共用、競態覆蓋防護、錯誤保留與重試冷卻", async () => {
  const { ctx, W, setGetJ } = createHarness();
  let fetchCount = 0;
  let delay = 10;
  let responseData = { rows: [{ code: "2330", name: "台積電", price: 1000 }] };

  setGetJ(async (url = "") => {
    if (String(url).includes("/api/hot")) fetchCount++;
    const curDelay = delay;
    const curData = responseData;
    await new Promise(r => setTimeout(r, curDelay));
    if (curData.error) throw new Error(curData.error);
    return curData;
  });

  // 1. 初次請求
  await ctx.loadMkHot("value");
  assert.equal(fetchCount, 1);
  assert.equal(W.hot["rank:value"]?.rows?.length, 1);
  assert.equal(W.hot["rank:value"]?.err, null);

  // 2. TTL 內重複請求 -> 命中快取
  await ctx.loadMkHot("value");
  assert.equal(fetchCount, 1, "30 秒 TTL 內重複呼叫不應發出新請求");

  // 3. force: true 強制更新
  await ctx.loadMkHot("value", true);
  assert.equal(fetchCount, 2, "force: true 應強制穿透快取重新抓取");

  // 4. In-flight 共用
  delay = 50;
  const pA = ctx.loadMkHot("gain");
  const pB = ctx.loadMkHot("gain");
  assert.equal(pA, pB, "併發呼叫相同分類應共用同一個 in-flight Promise");
  await Promise.all([pA, pB]);
  assert.equal(fetchCount, 3, "併發呼叫只應發出 1 次請求");

  // 5. 競態防護：舊請求後完成不得覆蓋新請求資料
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

  const p1 = ctx.loadMkHot("volume", true);
  const p2 = ctx.loadMkHot("volume", true);

  // 先讓新請求完成
  resolveReq2();
  await p2;
  assert.equal(W.hot["rank:volume"].rows[0].price, 1100, "新請求應寫入資料");

  // 舊請求後續完成
  resolveReq1();
  await p1;
  assert.equal(W.hot["rank:volume"].rows[0].price, 1100, "舊請求完成時不可覆蓋新一代的結果");

  // 6. 錯誤處理與冷卻
  setGetJ(async () => {
    fetchCount++;
    throw new Error("Network timeout");
  });
  await ctx.loadMkHot("volume", true);
  assert.equal(W.hot["rank:volume"].err, "Network timeout", "錯誤訊息應記錄在 err");
  assert.equal(W.hot["rank:volume"].rows[0].price, 1100, "失敗時應保留前一次成功的 rows，避免畫面空白");

  const countBeforeCooldown = fetchCount;
  await ctx.loadMkHot("volume");
  assert.equal(fetchCount, countBeforeCooldown, "錯誤冷卻時間 (15s) 內不應反覆發出請求");

  // 冷卻過後重試
  W.hot["rank:volume"].errAt = Date.now() - 16000;
  setGetJ(async () => {
    fetchCount++;
    return { rows: [{ code: "2330", name: "台積電-重試成功", price: 1200 }] };
  });
  await ctx.loadMkHot("volume");
  assert.equal(W.hot["rank:volume"].err, null, "冷卻期過後自動重試成功，清除 err");
  assert.equal(W.hot["rank:volume"].rows[0].price, 1200);
});

test("loadMkHot 競態深度驗證: 舊請求最後完成時不得清除新請求的 in-flight 狀態，亦不得觸發額外刷新", async () => {
  const { ctx, W, setGetJ } = createHarness();
  W.lt = "mkt";
  W.mkHot = "value";

  let resolveReq1, resolveReq2, resolveReq3;
  const p1Gate = new Promise(r => { resolveReq1 = r; });
  const p2Gate = new Promise(r => { resolveReq2 = r; });
  const p3Gate = new Promise(r => { resolveReq3 = r; });

  let callCount = 0;
  setGetJ(async () => {
    callCount++;
    const id = callCount;
    if (id === 1) {
      await p1Gate;
      return { rows: [{ code: "2330", name: "代1", price: 100 }] };
    } else if (id === 2) {
      await p2Gate;
      return { rows: [{ code: "2330", name: "代2", price: 200 }] };
    } else {
      await p3Gate;
      return { rows: [{ code: "2330", name: "代3", price: 300 }] };
    }
  });

  const p1 = ctx.loadMkHot("value", true);
  const p2 = ctx.loadMkHot("value", true);
  const p3 = ctx.loadMkHot("value", true);

  // inflight["value"] 應當指向最新的 p3
  assert.equal(W.mkHotInFlight["value"], p3, "最新請求 p3 應為當前 inflight");

  // 讓 req 1 先完成
  resolveReq1();
  await p1;

  // req 1 結束進入 finally 時，絕對不可把正在執行的 inflight["value"] 刪掉！
  assert.equal(W.mkHotInFlight["value"], p3, "舊請求 p1 完成時，絕對不可清除 p3 的 in-flight 狀態");
  assert.equal(W.hot["rank:value"], undefined, "舊請求 p1 完成時不得寫入資料");

  // 讓 req 2 也完成
  resolveReq2();
  await p2;
  assert.equal(W.mkHotInFlight["value"], p3, "次舊請求 p2 完成時，亦不可清除 p3 的 in-flight 狀態");

  // 最後讓 req 3 完成
  resolveReq3();
  await p3;
  assert.equal(W.mkHotInFlight["value"], undefined, "最新請求 p3 完成後，應正常清除自己的 in-flight 狀態");
  assert.equal(W.hot["rank:value"].rows[0].price, 300, "資料必須是最新一代 p3 的結果");
});

test("loadMkHot 異常回應路徑: HTTP 失敗、JSON 解析失敗、格式錯誤（非物件、rows 缺失、rows 非陣列）與合法空陣列", async () => {
  const { ctx, W, setGetJ } = createHarness();
  W.hot["rank:value"] = { at: Date.now() - 35000, rows: [{ code: "2330", price: 1000 }] };

  // 1. 回應不是預期物件 (例如 null、字串、數字)
  setGetJ(async () => null);
  await ctx.loadMkHot("value", true);
  assert.ok(W.hot["rank:value"].err, "null 回應應被捕捉為格式錯誤");
  assert.equal(W.hot["rank:value"].rows.length, 1, "錯誤時應保留既有有效資料");
  assert.ok(Date.now() - W.hot["rank:value"].errAt < 1000, "應記錄 errAt 時間以供冷卻");

  // 2. rows 缺失
  W.hot["rank:value"].errAt = Date.now() - 20000;
  setGetJ(async () => ({ ok: true, somethingElse: 123 }));
  await ctx.loadMkHot("value", true);
  assert.ok(W.hot["rank:value"].err, "缺少 rows 應被捕捉為格式錯誤");

  // 3. rows 不是陣列
  W.hot["rank:value"].errAt = Date.now() - 20000;
  setGetJ(async () => ({ ok: true, rows: "not-an-array" }));
  await ctx.loadMkHot("value", true);
  assert.ok(W.hot["rank:value"].err, "rows 非陣列應被捕捉為格式錯誤");

  // 4. 合法空陣列（例如無符合股票）
  W.hot["rank:value"].errAt = Date.now() - 20000;
  setGetJ(async () => ({ ok: true, rows: [] }));
  await ctx.loadMkHot("value", true);
  assert.equal(W.hot["rank:value"].err, null, "合法空陣列不應視為錯誤");
  assert.equal(W.hot["rank:value"].rows.length, 0, "合法空陣列成功寫入");

  // 5. 陣列內包含無效格式元素（過濾保護）
  W.hot["rank:value"].errAt = Date.now() - 20000;
  setGetJ(async () => ({
    ok: true,
    rows: [null, "invalid", { code: "2330", name: "台積電", price: 1050 }],
  }));
  await ctx.loadMkHot("value", true);
  assert.equal(W.hot["rank:value"].err, null);
  assert.equal(W.hot["rank:value"].rows.length, 1, "應只保留有效物件且包含 code 的股票");
  assert.equal(W.hot["rank:value"].rows[0].code, "2330");
});

test("liveRefresh: 大盤盤中熱門股過期或出錯時自動重刷，未過期時不重複觸發", () => {
  const { ctx, W } = createHarness();
  let loadedType = null;
  ctx.loadMkHot = t => { loadedType = t; };

  W.lt = "mkt";
  W.session = "open";
  W.mkHot = "value";

  // 快取新鮮時不刷新
  W.hot["rank:value"] = { at: Date.now(), rows: [{ code: "2330" }] };
  ctx.liveRefresh();
  assert.equal(loadedType, null, "熱門股未過期時 liveRefresh 不應重抓");

  // 快取過期 (> 30s) 時觸發重刷
  W.hot["rank:value"].at = Date.now() - 35000;
  ctx.liveRefresh();
  assert.equal(loadedType, "value", "熱門股超過 30 秒過期時 liveRefresh 應自動重抓");

  // 錯誤狀態超過 15 秒冷卻時重試
  loadedType = null;
  W.hot["rank:value"] = { at: Date.now() - 40000, err: "Failed", errAt: Date.now() - 16000, rows: [] };
  ctx.liveRefresh();
  assert.equal(loadedType, "value", "熱門股錯誤超過冷卻期時 liveRefresh 應自動重試");

  // 收盤後不進行盤中高頻刷新
  loadedType = null;
  W.session = "closed";
  ctx.liveRefresh();
  assert.equal(loadedType, null, "收盤非交易時段不應觸發盤中即時行情重刷");
});

// ==========================================
// Phase B: C2 市場資料更新狀態統一判定測試
// ==========================================

test("evalDataStatus: 交易時段內最新且有效資料標示為盤中即時，計算/指標標示為盤中估算", () => {
  const { ctx } = createHarness();
  const testNow = new Date("2026-10-27T10:30:00+08:00");

  const st1 = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: "2026-10-27",
    fetchedAt: +testNow - 5000,
    session: "open",
    dayState: "trade",
    today: "2026-10-27",
    now: testNow,
  });
  assert.equal(st1.status, "live");
  assert.equal(st1.text, "盤中即時");
  assert.ok(st1.isLive);

  // 指標與估算數據應標記為「盤中估算」
  const st2 = ctx.evalDataStatus({
    type: "indicator",
    source: "技術計算",
    dataDate: "2026-10-27",
    fetchedAt: +testNow - 5000,
    session: "open",
    dayState: "trade",
    today: "2026-10-27",
    now: testNow,
    estimated: true,
  });
  assert.equal(st2.status, "live");
  assert.equal(st2.text, "盤中估算");
});

test("evalDataStatus: 盤中資料超過合理更新期限（TTL）或日期落後標示為資料延遲", () => {
  const { ctx } = createHarness();
  const testNow = new Date("2026-10-27T10:30:00+08:00");

  // 1. 超過 TTL (30s)
  const st1 = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: "2026-10-27",
    fetchedAt: +testNow - 45000, // 45 秒前取得，超過 30 秒 TTL
    session: "open",
    dayState: "trade",
    today: "2026-10-27",
    now: testNow,
  });
  assert.equal(st1.status, "delayed");
  assert.equal(st1.text, "資料延遲");
  assert.ok(st1.isDelayed);

  // 2. 盤中開盤但回傳前一交易日資料
  const st2 = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: "2026-10-26", // 停留於昨天
    fetchedAt: +testNow - 5000,
    session: "open",
    dayState: "trade",
    today: "2026-10-27",
    now: testNow,
  });
  assert.equal(st2.status, "delayed");
  assert.equal(st2.text, "資料延遲");
  assert.match(st2.note, /2026-10-26/);
});

test("evalDataStatus: 收盤後至官方資料公布前標示盤後待確認，取得完整收盤資料標示收盤確認", () => {
  const { ctx } = createHarness();
  const testNow = new Date("2026-10-27T14:30:00+08:00"); // 14:30 已收盤

  // 今日收盤資料已完整取得
  const st1 = ctx.evalDataStatus({
    type: "index",
    source: "證交所 MIS",
    dataDate: "2026-10-27",
    fetchedAt: +testNow - 60000,
    session: "closed",
    dayState: "trade",
    today: "2026-10-27",
    now: testNow,
    isComplete: true,
  });
  assert.equal(st1.status, "confirmed");
  assert.equal(st1.text, "收盤確認");
  assert.ok(st1.isConfirmed);

  // 14:30 尚未取得今日收盤資料，仍停留在昨天
  const st2 = ctx.evalDataStatus({
    type: "index",
    source: "證交所 MIS",
    dataDate: "2026-10-26",
    session: "closed",
    dayState: "trade",
    today: "2026-10-27",
    now: testNow,
  });
  assert.equal(st2.status, "pending");
  assert.equal(st2.text, "盤後待確認");
  assert.ok(st2.isPending);
});

test("evalDataStatus: 非交易日（週末、國定假日）標示收盤確認並附日期，絕不可標示為盤中即時", () => {
  const { ctx } = createHarness();
  const testNowSunday = new Date("2026-11-01T10:30:00+08:00"); // 週日 10:30

  const st = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: "2026-10-30", // 週五收盤日
    session: "closed",
    dayState: "closed", // 非交易日
    today: "2026-11-01",
    now: testNowSunday,
  });
  assert.equal(st.status, "confirmed");
  assert.equal(st.text, "收盤確認");
  assert.ok(!st.isLive, "非交易日絕對不可標記為盤中即時");
  assert.match(st.note, /非交易日・顯示 2026-10-30 收盤資料/);
});

test("evalDataStatus: API 失敗保留前一筆有效資料時，必須標示資料延遲", () => {
  const { ctx } = createHarness();
  const testNow = new Date("2026-10-27T10:30:00+08:00");

  const st = ctx.evalDataStatus({
    type: "hot",
    source: "富果行情快照",
    dataDate: "2026-10-27",
    isSuccess: false,
    err: "504 Gateway Timeout",
    lastValidAt: +testNow - 120000,
    session: "open",
    dayState: "trade",
    today: "2026-10-27",
    now: testNow,
  });
  assert.equal(st.status, "delayed");
  assert.equal(st.text, "資料延遲");
  assert.match(st.note, /504 Gateway Timeout/);
});

test("evalDataStatus: 三大法人與融資融券等盤後資料在來源未更新時保持盤後待確認", () => {
  const { ctx } = createHarness();

  // 情境 A：當天 20:00，融資融券資料仍為前一交易日 10/26 -> 盤後待確認
  const testNowEvening = new Date("2026-10-27T20:00:00+08:00");
  const stMarginPending = ctx.evalDataStatus({
    type: "margin",
    source: "證交所 MI_MARGN",
    dataDate: "2026-10-26",
    session: "closed",
    dayState: "trade",
    today: "2026-10-27",
    now: testNowEvening,
  });
  assert.equal(stMarginPending.status, "pending");
  assert.equal(stMarginPending.text, "盤後待確認", "晚上 8 點未取得今日融資融券時不可誤標收盤確認");

  // 情境 B：當天 21:30，融資融券已發布 10/27 當日數據 -> 收盤確認
  const testNowNight = new Date("2026-10-27T21:30:00+08:00");
  const stMarginConfirmed = ctx.evalDataStatus({
    type: "margin",
    source: "證交所 MI_MARGN",
    dataDate: "2026-10-27",
    session: "closed",
    dayState: "trade",
    today: "2026-10-27",
    now: testNowNight,
    isComplete: true,
  });
  assert.equal(stMarginConfirmed.status, "confirmed");
  assert.equal(stMarginConfirmed.text, "收盤確認");

  // 情境 C：盤中 11:00，三大法人仍為前一交易日 -> 盤後待確認
  const testNowMorning = new Date("2026-10-27T11:00:00+08:00");
  const stInstMorning = ctx.evalDataStatus({
    type: "inst",
    source: "證交所 T86",
    dataDate: "2026-10-26",
    session: "open",
    dayState: "trade",
    today: "2026-10-27",
    now: testNowMorning,
  });
  assert.equal(stInstMorning.status, "pending");
  assert.equal(stInstMorning.text, "盤後待確認", "盤中三大法人為前日資料，不可標示收盤確認");
});

test("evalDataStatus: 跨時區與美股獨立交易時段/日期判定，不套用台股收盤規則", () => {
  const { ctx } = createHarness();
  const testNowTaipei = new Date("2026-10-27T15:00:00+08:00"); // 台北時間 15:00（台股已收盤）

  // 美股盤中開盤（美東時間 09:30-16:00 對應台北時間夜間）
  const stUsOpen = ctx.evalDataStatus({
    type: "us",
    source: "Yahoo Finance",
    dataDate: "2026-10-27",
    fetchedAt: +testNowTaipei - 10000,
    usSession: "open",
    session: "closed", // 台股已收盤
    now: testNowTaipei,
  });
  assert.equal(stUsOpen.status, "live");
  assert.equal(stUsOpen.text, "美股盤中", "美股應依自身交易時段標記盤中，不受台股收盤影響");

  // 美股收盤
  const stUsClosed = ctx.evalDataStatus({
    type: "us",
    source: "Yahoo Finance",
    dataDate: "2026-10-26",
    usSession: "closed",
    now: testNowTaipei,
  });
  assert.equal(stUsClosed.status, "confirmed");
  assert.equal(stUsClosed.text, "收盤確認");
});

test("evalDataStatus: 期貨日盤與夜盤交易時段各自獨立判定", () => {
  const { ctx } = createHarness();
  const testNowNight = new Date("2026-10-27T20:00:00+08:00");

  const stNight = ctx.evalDataStatus({
    type: "futures",
    source: "期交所",
    dataDate: "2026-10-27",
    fetchedAt: +testNowNight - 5000,
    fsession: "night",
    session: "closed", // 現貨收盤
    now: testNowNight,
  });
  assert.equal(stNight.status, "live");
  assert.equal(stNight.text, "夜盤即時");

  // 夜盤過期
  const stNightDelayed = ctx.evalDataStatus({
    type: "futures",
    source: "期交所",
    dataDate: "2026-10-27",
    fetchedAt: +testNowNight - 40000,
    fsession: "night",
    session: "closed",
    now: testNowNight,
  });
  assert.equal(stNightDelayed.status, "delayed");
  assert.equal(stNightDelayed.text, "資料延遲");
});

test("evalDataStatus: 缺少資料功能標示為未提供（unavailable），不可假裝為資料延遲或收盤確認", () => {
  const { ctx } = createHarness();
  const st = ctx.evalDataStatus({
    type: "other",
    unimplemented: true,
  });
  assert.equal(st.status, "unavailable");
  assert.equal(st.text, "未提供");
  assert.ok(!st.isDelayed, "未實作功能不得假裝為資料延遲");
  assert.ok(!st.isConfirmed, "未實作功能不得標記為收盤確認");
});

test("mktStatusTag 與 liveTag: 正確產生無障礙文字、自適應樣式與更新時間標示，不擠壓版面", () => {
  const { ctx } = createHarness();
  const statusObj = {
    status: "live",
    text: "盤中即時",
    note: "盤中行情持續更新",
    date: "2026-10-27",
    time: "10:30:15",
  };

  const html = ctx.mktStatusTag(statusObj, { showTime: true });
  assert.match(html, /class="mkt-tag live"/);
  assert.match(html, /盤中即時/);
  assert.match(html, /10:30<\/small>/);
  assert.match(html, /title="盤中行情持續更新 \(10:30\)"/);

  // liveTag 向下相容整合驗證
  const liveHtml = ctx.liveTag({
    live: true,
    at: Date.now(),
    date: "2026-10-27",
  });
  assert.match(liveHtml, /class="livetag"/);
  assert.match(liveHtml, /盤中即時/);
});


// ==========================================
// Phase A/B 深度擴充測試 (Round 2 獨立審查新增)
// ==========================================

test("visibleCodes: 完整跨頁面支援 (mkt, watch, hold, etf, tw, rank) 與頁面切換動態更新", () => {
  const { ctx, W } = createHarness();

  // 1. mkt 分頁：核心指數 T00, O00 + 0050 + 前 9 檔熱門股
  W.lt = "mkt";
  W.mkHot = "value";
  W.hot["rank:value"] = {
    at: Date.now(),
    rows: Array.from({ length: 15 }, (_, i) => ({ code: `110${i}` })),
  };
  const mktCodes = ctx.visibleCodes();
  assert.equal(mktCodes[0], "T00");
  assert.equal(mktCodes[1], "O00");
  assert.equal(mktCodes[2], "0050");
  assert.equal(mktCodes[3], "1100");
  assert.equal(mktCodes[11], "1108");
  assert.equal(mktCodes.length, 12);

  // 2. watch 分頁：核心指數 + curList()
  W.lt = "watch";
  ctx.curList = () => ["2330", "2317", "2454"];
  const watchCodes = ctx.visibleCodes();
  assert.deepEqual(Array.from(watchCodes), ["T00", "O00", "2330", "2317", "2454"]);

  // 3. hold 分頁：核心指數 + 庫存持股
  W.lt = "hold";
  W.holdMkt = "tw";
  W.hold = { "2330": { sh: 1000 }, "0050": { sh: 2000 } };
  ctx.mktOf = () => "tw";
  const holdCodes = ctx.visibleCodes();
  assert.deepEqual(Array.from(holdCodes), ["T00", "O00", "2330", "0050"]);

  // 4. etf 分頁：核心指數 + etfVisible()
  W.lt = "etf";
  ctx.etfVisible = () => ["0056", "00878", "00919"];
  const etfCodes = ctx.visibleCodes();
  assert.deepEqual(Array.from(etfCodes), ["T00", "O00", "0056", "00878", "00919"]);

  // 5. tw 分頁：核心指數 + W.hot.tw
  W.lt = "tw";
  W.hot.tw = { rows: [{ code: "2603" }, { code: "2609" }] };
  const twCodes = ctx.visibleCodes();
  assert.deepEqual(Array.from(twCodes), ["T00", "O00", "2603", "2609"]);

  // 6. rank 分頁：核心指數 + W.hot['rank:'+W.rankType] 最多 30 檔
  W.lt = "rank";
  W.rankType = "gain";
  W.hot["rank:gain"] = {
    rows: Array.from({ length: 40 }, (_, i) => ({ code: `330${i}` })),
  };
  const rankCodes = ctx.visibleCodes();
  assert.equal(rankCodes[0], "T00");
  assert.equal(rankCodes[1], "O00");
  assert.equal(rankCodes.length, 32); // 2 core + 30 rank
});

test("visibleCodes: 嚴格 40 檔上限、代碼去重、警示清單排在最末優先級且超額截斷", () => {
  const { ctx, W } = createHarness();
  W.lt = "watch";

  // 自選 38 檔股票
  const userList = Array.from({ length: 38 }, (_, i) => `23${i < 10 ? "0" + i : i}`);
  ctx.curList = () => userList;

  // 警示清單有 10 檔，其中 2 檔與指數或自選重複
  W.alerts = {
    "T00": true, // 與核心指數重複
    "2300": true, // 與自選重複
    "9901": true,
    "9902": true,
    "9903": true,
    "9904": true,
    "9905": true,
  };

  const codes = ctx.visibleCodes();
  assert.equal(codes.length, 40, "總數不可超過 40 檔");
  assert.equal(codes[0], "T00");
  assert.equal(codes[1], "O00");
  assert.equal(new Set(codes).size, 40, "必須完全去重，無重複代碼");
  assert.ok(!codes.includes("9901"), "因核心指數 (2) + 自選 (38) 已滿 40 檔，警示清單必須被安全截斷");
});

test("pollList 與 W.quotes: 舊日期、舊時間戳記及無效價格不可覆蓋 W.quotes 有效即時資料", async () => {
  const { ctx, W, setGetJ } = createHarness();

  // 初始：已有一筆當日 13:30 有效報價
  W.quotes.set("2330", { code: "2330", name: "台積電", price: 1060, chg: 25, chgPct: 2.42, date: "2026-10-27", time: "13:30:00" });

  // 1. 返回舊日期報價 (2026-10-26) -> 不得覆蓋
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1000, date: "2026-10-26", time: "13:30:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").price, 1060, "舊日期報價不可覆蓋當日報價");

  // 2. 返回同一天但較舊時間戳記 (13:20:00) -> 不得覆蓋
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1040, date: "2026-10-27", time: "13:20:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").price, 1060, "同一天內較舊時間戳記的過期報價不可覆蓋最新報價");

  // 3. 返回無效價格 (price: null 或 0) -> 不得沖銷已有之有效價格
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 0, date: "2026-10-27", time: "13:31:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").price, 1060, "價格為 0 之異常資料不可覆蓋有效即時價格");

  // 4. 返回正常最新報價 (13:31:00, price: 1065) -> 正常更新
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1065, chg: 30, chgPct: 2.9, date: "2026-10-27", time: "13:31:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").price, 1065, "有效之最新報價正常更新");
});

test("liveQuote: 相同交易日下較舊時間戳記不可覆蓋快照，回退資料新鮮度檢驗", () => {
  const { ctx, W } = createHarness();

  // 快照為 13:30:00 的價格 1060
  const raw = { code: "2330", name: "台積電", price: 1060, chg: 25, chgPct: 2.42, date: "2026-10-27", time: "13:30:00" };

  // W.quotes 存有同日但為 13:20:00 的舊資料
  W.quotes.set("2330", { code: "2330", price: 1040, date: "2026-10-27", time: "13:20:00" });

  const q = ctx.liveQuote(raw);
  assert.equal(q.price, 1060, "即時報價時間若早於快照時間，不可覆蓋快照價格");
  assert.equal(q.time, "13:30:00");
});

test("UI 接線驗證: tagsHtml 正確嵌入 mktStatusTag，包含各市場類型之狀態標示", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-27";

  // 1. 台股盤中即時個股
  const qLive = { code: "2330", price: 1060, date: "2026-10-27", time: "10:30:00" };
  const tags1 = ctx.tagsHtml("2330", qLive);
  assert.match(tags1, /class="mkt-tag live"/, "個股抽屜標籤應顯示盤中即時");
  assert.match(tags1, /盤中即時/, "文字應為盤中即時");

  // 2. 台股收盤個股
  W.session = "closed";
  const qClosed = { code: "2330", price: 1060, date: "2026-10-27", time: "13:30:00" };
  const tags2 = ctx.tagsHtml("2330", qClosed);
  assert.match(tags2, /class="mkt-tag confirmed"/, "收盤後個股抽屜標籤應顯示收盤確認");

  // 3. 美股個股
  const qUs = { code: "AAPL", price: 230, date: "2026-10-27", market: "美股", session: { state: "open" } };
  const tags3 = ctx.tagsHtml("AAPL", qUs);
  assert.match(tags3, /class="mkt-tag live"/, "美股盤中應顯示美股盤中即時");
});

test("evalDataStatus: 休市日表未知 (unknown) 時採保守判定，不誤判盤中即時", () => {
  const { ctx } = createHarness();

  // 颱風假情境：mktSession 因時間為 10:00 判定 open，但 twDayState 為 unknown，報價日期停留於昨日
  const st = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: "2026-10-26", // 昨日
    today: "2026-10-27",    // 今日
    dayState: "unknown",
    session: "open",
    now: new Date("2026-10-27T10:00:00+08:00"),
  });

  assert.equal(st.status, "delayed", "休市日未知且資料日期落後時，絕對不可標示為盤中即時");
  assert.equal(st.text, "資料延遲");
  assert.ok(st.isDelayed);
  assert.ok(!st.isLive);
});
// ==========================================
// Phase C: P0 精準修復與深度回歸測試
// ==========================================

test("P0-1: parseTimeToSec 支援前導零/非前導零、秒數解析、ISO 格式及無效時間拒絕", () => {
  const { ctx } = createHarness();
  const parse = ctx.parseTimeToSec;

  // 1. 各式合法格式轉換為正確秒數 (9:35 = 9*3600 + 35*60 = 34500)
  assert.equal(parse("9:35"), 34500);
  assert.equal(parse("09:35"), 34500);
  assert.equal(parse("9:35:00"), 34500);
  assert.equal(parse("09:35:00"), 34500);
  assert.equal(parse(" 09:35:00 "), 34500, "前後空白應被正確 trim");
  assert.equal(parse("10:30:00"), 37800);
  assert.equal(parse("13:30:00"), 48600);
  assert.equal(parse("2026-10-27T09:35:00+08:00"), 34500, "+08:00 台北 ISO 格式時間應為 34500");
  assert.equal(parse("2026-10-27T01:35:00Z"), 34500, "UTC 01:35Z 對應台北 09:35 應為 34500");
  assert.equal(parse("2026-10-27T09:35:00Z"), 63300, "UTC 09:35Z 對應台北 17:35 應為 63300");

  // 2. 前導零與非前導零比較結果完全一致
  assert.equal(parse("9:35"), parse("09:35:00"));
  assert.equal(parse("9:35:00"), parse("09:35"));

  // 3. 無效格式、超出範圍、缺少時間均回傳 null
  assert.equal(parse(""), null);
  assert.equal(parse(null), null);
  assert.equal(parse(undefined), null);
  assert.equal(parse("invalid"), null);
  assert.equal(parse("25:00"), null, "超過 24 時為無效");
  assert.equal(parse("12:60"), null, "超過 59 分為無效");
  assert.equal(parse("12:30:60"), null, "超過 59 秒為無效");
  assert.equal(parse("24:01"), null, "24:01 為無效");
});

test("P0-1: pollList 與 isQuoteStale 時間與日期先後嚴格判定（9:35:00 不得覆蓋 10:30:00）", async () => {
  const { ctx, W, setGetJ } = createHarness();

  // 初始：已有一筆 10:30:00 的有效即時報價
  const original = { code: "2330", name: "台積電", price: 1060, chg: 25, chgPct: 2.42, vol: 15000, date: "2026-10-27", time: "10:30:00" };
  W.quotes.set("2330", { ...original });

  // 1. 9:35:00（早期時間）不得覆蓋 10:30:00（在舊字串比較中 \"9:35:00\" > \"10:30:00\" 曾發生致命覆蓋）
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1050, vol: 8000, date: "2026-10-27", time: "9:35:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").time, "10:30:00", "9:35:00 絕對不得覆蓋 10:30:00");
  assert.equal(W.quotes.get("2330").price, 1060);
  assert.equal(W.quotes.get("2330").vol, 15000);

  // 2. 09:35:00 亦不得覆蓋 10:30:00
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1050, vol: 8000, date: "2026-10-27", time: "09:35:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").time, "10:30:00");

  // 3. 10:30:00 可以取代 9:35:00
  W.quotes.set("2330", { code: "2330", name: "台積電", price: 1050, vol: 8000, date: "2026-10-27", time: "9:35:00" });
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1060, vol: 15000, date: "2026-10-27", time: "10:30:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").time, "10:30:00", "較新之 10:30:00 成功更新");
  assert.equal(W.quotes.get("2330").price, 1060);

  // 4. 舊交易日不得覆蓋新交易日
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1000, date: "2026-10-26", time: "13:30:00" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").date, "2026-10-27", "昨日資料不得覆蓋今日資料");

  // 5. 無效時間或缺少時間不得覆蓋有效時間戳記
  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1070, date: "2026-10-27", time: "invalid-time" }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").time, "10:30:00", "無效時間字串不得覆蓋具有有效時間之報價");
  assert.equal(W.quotes.get("2330").price, 1060);

  setGetJ(async () => ({
    session: "open",
    today: "2026-10-27",
    quotes: [{ code: "2330", price: 1070, date: "2026-10-27", time: null }],
  }));
  await ctx.pollList();
  assert.equal(W.quotes.get("2330").time, "10:30:00", "缺少時間欄位之報價不得被推定為較新而覆蓋");
  assert.equal(W.quotes.get("2330").price, 1060);
});

test("P0-2: pollList 對無效價格（0, 負數, null, undefined, NaN, Infinity, 非數字字串）整筆拒絕更新，絕不混拼假報價", async () => {
  const { ctx, W, setGetJ } = createHarness();

  const originalQuote = Object.freeze({
    code: "2330",
    name: "台積電",
    price: 1060,
    chg: 25,
    chgPct: 2.42,
    vol: 25000,
    date: "2026-10-27",
    time: "10:30:00",
  });

  const invalidPrices = [
    0,
    -1,
    -100.5,
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    "invalid",
    "",
    "   ",
    false,
    {},
  ];

  for (const badPrice of invalidPrices) {
    W.quotes.set("2330", { ...originalQuote });

    setGetJ(async () => ({
      session: "open",
      today: "2026-10-27",
      quotes: [{
        code: "2330",
        price: badPrice,
        chg: 999,
        chgPct: 99.9,
        vol: 999999,
        time: "11:00:00",
        date: "2026-10-27",
      }],
    }));

    await ctx.pollList();

    const q = W.quotes.get("2330");
    assert.equal(q.price, 1060, `price 為 ${badPrice} 時原價不可變動`);
    assert.equal(q.time, "10:30:00", `price 為 ${badPrice} 時 time 不可被更新為 11:00:00`);
    assert.equal(q.vol, 25000, `price 為 ${badPrice} 時 vol 不可被更新為 999999`);
    assert.equal(q.chg, 25, `price 為 ${badPrice} 時 chg 不可被更新`);
    assert.equal(q.chgPct, 2.42, `price 為 ${badPrice} 時 chgPct 不可被更新`);
  }
});

test("P0-3: evalDataStatus 禁止把 estimated: true 標記為收盤確認（回傳 pending 收盤估算，isConfirmed 為 false）", () => {
  const { ctx } = createHarness();

  // 1. 收盤後傳入 estimated: true -> 不得為 confirmed，text 不含「收盤確認」，isConfirmed 必須為 false
  const estStatus = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: "2026-10-27",
    today: "2026-10-27",
    session: "closed",
    isComplete: true,
    estimated: true,
  });

  assert.notEqual(estStatus.status, "confirmed", "帶有 estimated: true 的資料即使已收盤亦絕不可標記為 confirmed");
  assert.equal(estStatus.status, "pending");
  assert.equal(estStatus.text, "收盤估算");
  assert.equal(estStatus.isConfirmed, false, "isConfirmed 必須嚴格為 false");
  assert.equal(estStatus.isPending, true);
  assert.ok(!estStatus.text.includes("收盤確認"));

  // 2. 收盤後傳入正式非估算資料 -> 正常收盤確認
  const realStatus = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: "2026-10-27",
    today: "2026-10-27",
    session: "closed",
    isComplete: true,
    estimated: false,
  });

  assert.equal(realStatus.status, "confirmed");
  assert.equal(realStatus.text, "收盤確認");
  assert.equal(realStatus.isConfirmed, true);
  assert.equal(realStatus.isPending, false);

  // 3. 非交易日傳入 estimated: true 亦不得為 confirmed
  const holEst = ctx.evalDataStatus({
    type: "quote",
    dayState: "closed",
    session: "closed",
    estimated: true,
    dataDate: "2026-10-25",
  });
  assert.notEqual(holEst.status, "confirmed");
  assert.equal(holEst.isConfirmed, false);
  assert.equal(holEst.text, "收盤估算");

  // 4. 三大法人盤後資料若帶有 estimated: true 亦不得為 confirmed
  const instEst = ctx.evalDataStatus({
    type: "inst",
    source: "證交所",
    dataDate: "2026-10-27",
    today: "2026-10-27",
    session: "closed",
    isComplete: true,
    estimated: true,
  });
  assert.notEqual(instEst.status, "confirmed");
  assert.equal(instEst.isConfirmed, false);
});

test("P0-3: evalDataStatus 在 curDayState === 'unknown' 且無資料日期時採保守判定，不誤判盤中即時", () => {
  const { ctx } = createHarness();

  // 交易日曆未知且沒有 dataDate
  const st = ctx.evalDataStatus({
    type: "quote",
    source: "證交所 MIS",
    dataDate: null, // 無資料日期
    today: "2026-10-27",
    dayState: "unknown",
    session: "open",
    now: new Date("2026-10-27T10:00:00+08:00"),
  });

  assert.notEqual(st.status, "live", "無資料日期且日曆未知時絕不可標示為盤中即時");
  assert.equal(st.status, "delayed");
  assert.equal(st.isLive, false);
  assert.equal(st.isDelayed, true);
});

test("P0-1 & 跨時區: evalDataStatus 美股跨時區交易日判定，不依台灣日期判斷為延遲", () => {
  const { ctx } = createHarness();

  // 台北時間 2026-10-27 上午 10:00 (UTC 02:00)，美東為 2026-10-26 22:00 (已收盤)
  // 美股最新交易日為 2026-10-26
  const st = ctx.evalDataStatus({
    type: "us",
    source: "Yahoo Finance",
    dataDate: "2026-10-26", // 美東當前/最近交易日
    usSession: "closed",
    now: new Date("2026-10-27T02:00:00Z"),
  });

  assert.equal(st.status, "confirmed", "美股交易日為 10-26，在台北 10-27 上午美股已收盤，應為收盤確認，不可因台灣日期為 10-27 而被誤判延遲");
  assert.equal(st.isConfirmed, true);
  assert.equal(st.isDelayed, false);
});
test("P0-1 & 跨時區 ISO: parseTimeToSec、quoteTimestamp 與 isQuoteStale 支援帶時區 ISO 時間精確比對", () => {
  const { ctx } = createHarness();
  const parse = ctx.parseTimeToSec;
  const isStale = ctx.isQuoteStale;

  // 1. UTC 01:35:00Z 換算台北時間為 09:35:00 (34500 秒)
  assert.equal(parse("2026-10-27T01:35:00Z"), 34500, "UTC 01:35 應正確換算為台北時間 09:35 (34500秒)");
  assert.equal(parse("2026-10-27T09:35:00+08:00"), 34500, "+08:00 台北時間 09:35 應為 34500秒");
  assert.equal(parse("2026-10-27T01:30:00Z"), 34200, "UTC 01:30 應為台北時間 09:30 (34200秒)");

  // 2. 與本地牆鐘時間 (09:35:00) 的等價性
  assert.equal(parse("2026-10-27T01:35:00Z"), parse("09:35:00"));
  assert.equal(parse("2026-10-27T09:35:00+08:00"), parse("9:35"));

  // 3. isQuoteStale 在 ISO 時間與本地時間混用情境下精確比對
  const qExisting = { date: "2026-10-27", time: "09:35:00" };
  const qOlderIso = { date: "2026-10-27", time: "2026-10-27T01:30:00Z" }; // 台北 09:30
  const qSameIso = { date: "2026-10-27", time: "2026-10-27T01:35:00Z" };  // 台北 09:35
  const qNewerIso = { date: "2026-10-27", time: "2026-10-27T01:40:00Z" }; // 台北 09:40

  assert.equal(isStale(qOlderIso, qExisting), true, "ISO 01:30Z (09:30) 早於 09:35，應判定為過期");
  assert.equal(isStale(qSameIso, qExisting), false, "ISO 01:35Z (09:35) 與 09:35 同時間，不應判定為過期");
  assert.equal(isStale(qNewerIso, qExisting), false, "ISO 01:40Z (09:40) 晚於 09:35，為最新資料");
});

test("報價入口一致性: pollDetail() 嚴格檢查價格有效性與防舊資料覆蓋", async () => {
  const { ctx, W, setGetJ } = createHarness();

  W.sel = "2330";
  // 初始：已有一筆當日 10:30 有效詳情報價
  W.detailQ = { code: "2330", name: "台積電", price: 1060, chg: 25, chgPct: 2.42, date: "2026-10-27", time: "10:30:00" };

  // 1. pollDetail 收到無效價格 (0, null, 負數, NaN, 字串) -> 拒絕覆蓋 W.detailQ
  const invalidPrices = [0, -1, null, undefined, NaN, "invalid"];
  for (const badPx of invalidPrices) {
    setGetJ(async () => ({
      ok: true,
      source: "證交所 MIS",
      quotes: [{ code: "2330", price: badPx, date: "2026-10-27", time: "10:35:00" }],
    }));
    await ctx.pollDetail();
    assert.equal(W.detailQ.price, 1060, `pollDetail 收到價格 ${badPx} 時不得覆蓋原有有效價格`);
    assert.equal(W.detailQ.time, "10:30:00", `pollDetail 收到價格 ${badPx} 時不得更新時間`);
  }

  // 2. pollDetail 收到同日較舊時間戳 (09:35:00) -> 拒絕覆蓋
  setGetJ(async () => ({
    ok: true,
    source: "證交所 MIS",
    quotes: [{ code: "2330", price: 1050, date: "2026-10-27", time: "09:35:00" }],
  }));
  await ctx.pollDetail();
  assert.equal(W.detailQ.price, 1060, "pollDetail 收到較舊時間報價不得覆蓋最新報價");
  assert.equal(W.detailQ.time, "10:30:00");

  // 3. pollDetail 收到較舊 ISO 時間 (01:30:00Z = 09:30) -> 拒絕覆蓋
  setGetJ(async () => ({
    ok: true,
    source: "證交所 MIS",
    quotes: [{ code: "2330", price: 1050, date: "2026-10-27", time: "2026-10-27T01:30:00Z" }],
  }));
  await ctx.pollDetail();
  assert.equal(W.detailQ.price, 1060, "pollDetail 收到較舊 ISO 時間報價不得覆蓋最新報價");

  // 4. pollDetail 收到較新有效報價 (10:35:00, 1065) -> 正常更新
  setGetJ(async () => ({
    ok: true,
    source: "證交所 MIS",
    quotes: [{ code: "2330", price: 1065, chg: 30, chgPct: 2.9, date: "2026-10-27", time: "10:35:00" }],
  }));
  await ctx.pollDetail();
  assert.equal(W.detailQ.price, 1065, "pollDetail 收到較新有效報價應成功更新");
  assert.equal(W.detailQ.time, "10:35:00");
});

test("報價入口一致性: liveQuote() 支援帶時區 ISO 時間進行新鮮度比對與回退", () => {
  const { ctx, W } = createHarness();

  // 快照為 09:35:00 價格 1060
  const raw = { code: "2330", name: "台積電", price: 1060, chg: 25, chgPct: 2.42, date: "2026-10-27", time: "09:35:00" };

  // W.quotes 存有 ISO 01:30Z (09:30) 的較舊資料
  W.quotes.set("2330", { code: "2330", price: 1050, date: "2026-10-27", time: "2026-10-27T01:30:00Z" });
  const qOld = ctx.liveQuote(raw);
  assert.equal(qOld.price, 1060, "W.quotes 的 ISO 時間早於快照時，應保留快照價格");
  assert.equal(qOld.time, "09:35:00");

  // W.quotes 存有 ISO 01:40Z (09:40) 的較新資料
  W.quotes.set("2330", { code: "2330", price: 1070, date: "2026-10-27", time: "2026-10-27T01:40:00Z" });
  const qNew = ctx.liveQuote(raw);
  assert.equal(qNew.price, 1070, "W.quotes 的 ISO 時間晚於快照時，應採用最新即時價格");
  assert.equal(qNew.isLive, true);
});
