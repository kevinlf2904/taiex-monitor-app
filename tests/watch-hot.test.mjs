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
    sec: (t, body, extra = "", seg = "") => `<section class="mk"><h3>${t}${extra ? `<span class="note">${extra}</span>` : ""}</h3>${seg ? `<div class="mksegrow">${seg}</div>` : ""}${body}</section>`,
    mkSeg: (key, val, opts) => `<span class="mkseg">${opts.map(([k, t]) => (k === "|" ? `<span class="tgrp">${t}</span>` : `<button data-mk="${key}" data-v="${k}">${t}</button>`)).join("")}</span>`,
    mtile: r => `<div class="mtile">${r?.code || ""}</div>`,
    MK_HOT: [["value", "成交值"], ["vol", "成交量"]],
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

// =========================================================================
// Phase B v2.4 前端行情狀態透傳、覆蓋率與完整性判定回歸驗收
// =========================================================================

test("v2.4 情境 1: 完整行情資料在盤中正確顯示盤中即時，收盤後正確顯示收盤確認", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 盤中即時驗證
  const livePayload = {
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "證交所 MIS",
    completeness: "complete",
    coverage: { got: 1850, want: 1800 },
    dateVerified: true,
    dateConsistent: true,
  };
  const liveHtml = ctx.liveTag(livePayload);
  assert.match(liveHtml, /class="livetag"/, "完整行情在盤中必須輸出 livetag 樣式");
  assert.match(liveHtml, /盤中即時/, "完整行情在盤中必須包含「盤中即時」");
  assert.match(liveHtml, /更新於/, "必須包含更新時間戳記");

  // 收盤後確認驗證
  W.session = "closed";
  const closedPayload = {
    type: "index",
    dataDate: "2026-10-28",
    source: "證交所 MI_INDEX",
    session: "closed",
    today: "2026-10-28",
    completeness: "complete",
    coverage: { got: 1850, want: 1800 },
    dateVerified: true,
    dateConsistent: true,
  };
  const closedSt = ctx.evalDataStatus(closedPayload);
  assert.equal(closedSt.status, "confirmed");
  assert.equal(closedSt.isConfirmed, true);
  assert.equal(closedSt.isLive, false);
  assert.equal(closedSt.text, "收盤確認");
});

test("v2.4 情境 2: J.completeness === 'partial' 時，liveTag() 絕不顯示盤中即時，轉為 delayed", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  const partialPayload = {
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "證交所 MIS",
    completeness: "partial",
    coverage: { got: 1200, want: 1800 },
    dateVerified: true,
    dateConsistent: true,
  };
  const html = ctx.liveTag(partialPayload);
  assert.doesNotMatch(html, /class="livetag"/, "partial 資料絕對不可輸出 livetag");
  assert.doesNotMatch(html, /盤中即時/, "partial 資料絕對不可顯示盤中即時");
  assert.match(html, /class="mkt-tag delayed"/, "partial 資料必須標示為 delayed");
  assert.match(html, /資料不完整（partial）/, "提示必須精確包含 completeness 狀態說明");
});

test("v2.4 情境 3: J.completeness === 'degraded' 時，保留降級備註與狀態，不被視為正常即時", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  const degradedPayload = {
    live: true,
    date: "2026-10-22",
    time: "13:30:00",
    at: Date.now(),
    source: "證交所 MI_INDEX",
    completeness: "degraded",
    dataStatus: "degraded",
    coverage: { got: 1000, want: 1800 },
  };
  const html = ctx.liveTag(degradedPayload);
  assert.doesNotMatch(html, /class="livetag"/);
  assert.doesNotMatch(html, /盤中即時/);
  assert.match(html, /class="mkt-tag delayed"/);
  assert.match(html, /資料不完整（degraded）|行情資料降級/);
});

test("v2.4 情境 4: J.completeness === 'partial_tse_only' 或 'partial_otc_only' 時，不被視為完整", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 僅上市有資料
  const tseOnlyHtml = ctx.liveTag({
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    completeness: "partial_tse_only",
    coverage: { got: 1000, want: 1800 },
  });
  assert.doesNotMatch(tseOnlyHtml, /class="livetag"/);
  assert.match(tseOnlyHtml, /class="mkt-tag delayed"/);
  assert.match(tseOnlyHtml, /資料不完整（partial_tse_only）/);

  // 僅上櫃有資料
  const otcOnlyHtml = ctx.liveTag({
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    completeness: "partial_otc_only",
    coverage: { got: 800, want: 1800 },
  });
  assert.doesNotMatch(otcOnlyHtml, /class="livetag"/);
  assert.match(otcOnlyHtml, /class="mkt-tag delayed"/);
  assert.match(otcOnlyHtml, /資料不完整（partial_otc_only）/);
});

test("v2.4 情境 5: 日期未驗證或日期不一致的行情，liveTag() 不得標示為即時", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 1. 日期未經來源確認
  const unverifiedHtml = ctx.liveTag({
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    dateVerified: false,
    completeness: "complete",
  });
  assert.doesNotMatch(unverifiedHtml, /class="livetag"/);
  assert.match(unverifiedHtml, /class="mkt-tag delayed"/);
  assert.match(unverifiedHtml, /資料日期未經來源確認/);

  // 2. 上市櫃日期不一致
  const inconsistentHtml = ctx.liveTag({
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    dateConsistent: false,
    completeness: "complete",
  });
  assert.doesNotMatch(inconsistentHtml, /class="livetag"/);
  assert.match(inconsistentHtml, /class="mkt-tag delayed"/);
  assert.match(inconsistentHtml, /上市櫃資料日期不一致/);
});

test("v2.4 情境 6: coverage 不足（got < want * 0.95）時，降級為 delayed", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // got = 1600, want = 1800 (1600 < 1710 即 95%)
  const lowCoverageHtml = ctx.liveTag({
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    completeness: "complete",
    coverage: { got: 1600, want: 1800 },
  });
  assert.doesNotMatch(lowCoverageHtml, /class="livetag"/);
  assert.match(lowCoverageHtml, /class="mkt-tag delayed"/);
  assert.match(lowCoverageHtml, /資料覆蓋率不足/);
  assert.match(lowCoverageHtml, /1600/);
  assert.match(lowCoverageHtml, /1800/);
});

test("v2.4 情境 7: 舊版 API 未回傳 completeness / coverage 時的向後相容性", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 完全不帶 completeness 與 coverage 的舊版行情物件
  const legacyPayload = {
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "證交所 MIS",
  };
  assert.doesNotThrow(() => {
    const html = ctx.liveTag(legacyPayload);
    assert.match(html, /class="livetag"/);
    assert.match(html, /盤中即時/);
  }, "舊版 API 未提供完整性欄位時必須優雅相容且不拋錯");
});

test("v2.4 情境 8: /api/hot 排行標籤正確反映底層 curH 的 completeness 與 coverage", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";
  W.lt = "mkt";
  W.mkHot = "value";

  // 1. 底層 hot 資料為 partial 且 coverage 不足
  W.hot["rank:value"] = {
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "富果行情快照",
    completeness: "partial",
    coverage: { got: 500, want: 1800 },
    dataStatus: "partial",
    rows: [{ code: "2330", name: "台積電", price: 1000, chgPct: 2.0 }],
  };
  const partialHotHtml = ctx.hotSec(ctx.sec, "tw");
  assert.match(partialHotHtml, /class="mkt-tag delayed"/, "底層 partial 時熱門股標籤必須呈現 delayed");
  assert.match(partialHotHtml, /資料不完整（partial）/, "熱門股標籤必須包含資料不完整提示");
  assert.doesNotMatch(partialHotHtml, /class="mkt-tag live"/, "底層 partial 時熱門股標籤絕不可標記為 live");

  // 2. 底層 hot 資料為 complete 且 coverage 達標
  W.hot["rank:value"] = {
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "富果行情快照",
    completeness: "complete",
    coverage: { got: 1820, want: 1800 },
    dataStatus: "live",
    rows: [{ code: "2330", name: "台積電", price: 1000, chgPct: 2.0 }],
  };
  const completeHotHtml = ctx.hotSec(ctx.sec, "tw");
  assert.match(completeHotHtml, /class="mkt-tag live"/, "完整熱門股資料在盤中正確呈現 live 標籤");
  assert.match(completeHotHtml, /盤中即時/);
});

test("v2.4 情境 9: 正常全市場資料不會被誤判為降級或延遲", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  const fullPayload = {
    type: "quote",
    dataDate: "2026-10-28",
    sourceTime: "10:30:00",
    fetchedAt: Date.now(),
    source: "證交所 MIS",
    completeness: "complete",
    coverage: { got: 1820, want: 1800 },
    dateVerified: true,
    dateConsistent: true,
    session: "open",
    today: "2026-10-28",
  };
  const st = ctx.evalDataStatus(fullPayload);
  assert.equal(st.status, "live");
  assert.equal(st.isLive, true);
  assert.equal(st.isDelayed, false);
  assert.equal(st.isConfirmed, false);
  assert.equal(st.text, "盤中即時");
});

test("v2.4 情境 10: 收盤後不完整資料不得誤判為收盤確認，應標記為盤後待確認並附帶不完整提示", () => {
  const { ctx, W } = createHarness();
  W.session = "closed";
  W.today = "2026-10-28";

  // 收盤時資料不完整 (例如僅 TSE，OTC 尚未出爐)
  const closedIncomplete = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    source: "證交所 MI_INDEX",
    session: "closed",
    today: "2026-10-28",
    completeness: "partial_tse_only",
    coverage: { got: 1000, want: 1800 },
  });
  assert.notEqual(closedIncomplete.status, "confirmed", "不完整收盤資料絕不可標記為 confirmed");
  assert.equal(closedIncomplete.isConfirmed, false);
  assert.equal(closedIncomplete.status, "pending");
  assert.match(closedIncomplete.note, /等待 2026-10-28 完整收盤/);
  assert.match(closedIncomplete.note, /partial_tse_only/);
});

// =========================================================================
// Phase B v2.5 最終狀態機安全審查與邊界防禦深度測試
// =========================================================================

test("v2.5 P1-A: dataStatus: 'partial' 在 completeness 缺漏時，絕不標示為正常即時", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // completeness 缺漏，但後端給出 dataStatus: "partial"
  const st = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    sourceTime: "10:30:00",
    fetchedAt: Date.now(),
    source: "證交所 MIS",
    dataStatus: "partial",
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(st.status, "delayed", "dataStatus 為 partial 時必須降級為 delayed");
  assert.equal(st.isLive, false, "絕不可標示為即時");
  assert.match(st.note, /partial/);

  const html = ctx.liveTag({
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    dataStatus: "partial",
  });
  assert.doesNotMatch(html, /class="livetag"/);
  assert.match(html, /class="mkt-tag delayed"/);
});

test("v2.5 P1-A: completeness: '' 空字串時採保守判定，絕不標示為完整", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  const st = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-28",
    sourceTime: "10:30:00",
    fetchedAt: Date.now(),
    completeness: "",
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(st.status, "delayed");
  assert.equal(st.isLive, false);
});

test("v2.5 P1-A: completeness 與 dataStatus 矛盾時採保守判定 (complete vs degraded)", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // completeness 聲稱 complete，但 dataStatus 標示 degraded
  const st = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    completeness: "complete",
    dataStatus: "degraded",
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(st.status, "delayed", "欄位矛盾時必須保守降級為 delayed");
  assert.equal(st.isLive, false);
  assert.match(st.note, /行情資料降級/);
});

test("v2.5 P1-A: completeness 與 dataStatus 矛盾時採保守判定 (partial vs live)", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // dataStatus 聲稱 live，但 completeness 為 partial
  const st = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    completeness: "partial",
    dataStatus: "live",
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(st.status, "delayed");
  assert.equal(st.isLive, false);
  assert.match(st.note, /資料不完整（partial）/);
});

test("v2.5 P1-A: coverage 缺漏 got 或 want 時嚴格判定為異常，不得冒充達標", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 1. 只有 want，缺少 got
  const st1 = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-28",
    coverage: { want: 1800 },
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(st1.status, "delayed", "coverage 缺少 got 必須拒絕");
  assert.equal(st1.isLive, false);

  // 2. 只有 got，缺少 want
  const st2 = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-28",
    coverage: { got: 1800 },
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(st2.status, "delayed", "coverage 缺少 want 必須拒絕");
  assert.equal(st2.isLive, false);
});

test("v2.5 P1-A: coverage got 或 want 為非數字/NaN/負數/字串時嚴格拒絕", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 1. 字串數值
  const stStr = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-28",
    coverage: { got: "1850", want: 1800 },
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(stStr.status, "delayed");

  // 2. NaN
  const stNan = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-28",
    coverage: { got: NaN, want: 1800 },
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(stNan.status, "delayed");

  // 3. want <= 0
  const stZero = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-28",
    coverage: { got: 1850, want: 0 },
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(stZero.status, "delayed");

  // 4. got < 0
  const stNeg = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-28",
    coverage: { got: -5, want: 1800 },
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(stNeg.status, "delayed");
});

test("v2.5 P1-B: 單一核心狀態機統一判定驗證 (liveTag 與 hotSt 委託 evalDataStatus)", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 驗證 liveTag 對異常 dataStatus 自動委任核心判定為 delayed
  const liveDelayedHtml = ctx.liveTag({
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    dataStatus: "stale",
  });
  assert.match(liveDelayedHtml, /class="mkt-tag delayed"/);
  assert.match(liveDelayedHtml, /行情資料停滯/);

  // 驗證 hotSt 透過 hotSec 自動委任核心判定
  W.lt = "mkt";
  W.mkHot = "value";
  W.hot["rank:value"] = {
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "富果行情快照",
    dataStatus: "stale",
    rows: [{ code: "2330", name: "台積電", price: 1000 }],
  };
  const hotHtml = ctx.hotSec(ctx.sec, "tw");
  assert.match(hotHtml, /class="mkt-tag delayed"/);
  assert.match(hotHtml, /行情資料停滯/);
});

test("v2.5 P1-D: 盤後待確認 dataStatus: 'pending' 在盤中時段絕不可標記為 live", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  const st = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    dataStatus: "pending",
    session: "open",
    today: "2026-10-28",
  });
  assert.equal(st.isLive, false, "dataStatus 為 pending 時不可標示為 live");
  assert.equal(st.status, "delayed");
});

test("v2.5 P1-D: 收盤時段 dataStatus: 'pending' 絕不可標記為 confirmed", () => {
  const { ctx, W } = createHarness();
  W.session = "closed";
  W.today = "2026-10-28";

  const st = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    completeness: "complete",
    dataStatus: "pending",
    session: "closed",
    today: "2026-10-28",
  });
  assert.equal(st.isConfirmed, false, "dataStatus 為 pending 時收盤後不可確認");
  assert.equal(st.status, "pending");
  assert.match(st.note, /等待 2026-10-28 完整收盤/);
});

test("v2.5 回歸保證: 美股、期貨、ETF 及非交易日規則不受台股完整性強化干擾", () => {
  const { ctx } = createHarness();

  // 美股正常交易時段
  const usSt = ctx.evalDataStatus({
    type: "us",
    source: "Yahoo Finance",
    dataDate: "2026-10-28",
    usSession: "open",
    today: "2026-10-28",
  });
  assert.equal(usSt.status, "live");
  assert.equal(usSt.isLive, true);
  assert.equal(usSt.text, "美股盤中");

  // 期貨夜盤交易中
  const futSt = ctx.evalDataStatus({
    type: "futures",
    source: "期交所",
    dataDate: "2026-10-28",
    fsession: "night",
  });
  assert.equal(futSt.status, "live");
  assert.equal(futSt.isLive, true);
  assert.equal(futSt.text, "夜盤即時");
});

// =========================================================================
// Phase B v2.5.1 最終狀態機全列舉、邊界防禦與交易日曆安全驗收
// =========================================================================

test("v2.5.1 項目 A: dataStatus 全列舉邊界測試 (合法、已知非健康、未知、空字串、空白、null、缺欄位)", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  const baseOpts = {
    type: "quote",
    dataDate: "2026-10-28",
    sourceTime: "10:30:00",
    fetchedAt: Date.now(),
    source: "證交所 MIS",
    session: "open",
    today: "2026-10-28",
  };

  // 1. 合法健康狀態: "live"
  const stLive = ctx.evalDataStatus({ ...baseOpts, dataStatus: "live" });
  assert.equal(stLive.status, "live");
  assert.equal(stLive.isLive, true);

  // 2. 舊 API 缺少 dataStatus (null / undefined): 保留向下相容
  const stNull = ctx.evalDataStatus({ ...baseOpts, dataStatus: null });
  assert.equal(stNull.status, "live", "null dataStatus 在符合其他所有條件時相容為 live");
  const stUndef = ctx.evalDataStatus({ ...baseOpts });
  assert.equal(stUndef.status, "live", "undefined dataStatus 在符合其他所有條件時相容為 live");

  // 3. 已知非健康狀態: "partial", "degraded", "stale", "delayed", "pending"
  for (const bad of ["partial", "degraded", "stale", "delayed", "pending"]) {
    const stBad = ctx.evalDataStatus({ ...baseOpts, dataStatus: bad });
    assert.equal(stBad.status, "delayed", `dataStatus: "${bad}" 必須降級為 delayed`);
    assert.equal(stBad.isLive, false, `dataStatus: "${bad}" 絕不可為 live`);
  }

  // 4. 空字串與空白字串: 絕不可視為健康
  const stEmpty = ctx.evalDataStatus({ ...baseOpts, dataStatus: "" });
  assert.equal(stEmpty.status, "delayed", "dataStatus: '' 必須降級為 delayed");
  assert.equal(stEmpty.isLive, false);

  const stWhitespace = ctx.evalDataStatus({ ...baseOpts, dataStatus: "   " });
  assert.equal(stWhitespace.status, "delayed", "空白 dataStatus 必須降級為 delayed");
  assert.equal(stWhitespace.isLive, false);

  // 5. 未知非空狀態 (如 "unknown", "broken", "malicious")
  const stUnknown = ctx.evalDataStatus({ ...baseOpts, dataStatus: "unknown" });
  assert.equal(stUnknown.status, "delayed", "未知 dataStatus 必須降級為 delayed");
  assert.equal(stUnknown.isLive, false);
  assert.match(stUnknown.note, /行情狀態異常（unknown）/);
});

test("v2.5.1 項目 B: completeness 多型別防禦測試 (字串、空白、數字、布林、物件、null、undefined)", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";
  const base = { type: "quote", dataDate: "2026-10-28", session: "open", today: "2026-10-28" };

  // 1. 合法完整: "complete"
  assert.equal(ctx.evalDataStatus({ ...base, completeness: "complete" }).status, "live");

  // 2. 合法部分: "partial"
  assert.equal(ctx.evalDataStatus({ ...base, completeness: "partial" }).status, "delayed");

  // 3. 空白字串: "" 與 "   "
  assert.equal(ctx.evalDataStatus({ ...base, completeness: "" }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, completeness: "   " }).status, "delayed");

  // 4. 非字串值: 數字、布林、陣列、物件
  assert.equal(ctx.evalDataStatus({ ...base, completeness: 1 }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, completeness: true }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, completeness: false }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, completeness: ["complete"] }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, completeness: { status: "complete" } }).status, "delayed");

  // 5. null 與 undefined (舊 API 相容)
  assert.equal(ctx.evalDataStatus({ ...base, completeness: null }).status, "live");
  assert.equal(ctx.evalDataStatus({ ...base, completeness: undefined }).status, "live");
});

test("v2.5.1 項目 B: coverage 畸形結構與 got > want 邊界測試", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";
  const base = { type: "quote", dataDate: "2026-10-28", session: "open", today: "2026-10-28" };

  // 1. 合法達標: got: 1800, want: 1800 (100%)
  assert.equal(ctx.evalDataStatus({ ...base, coverage: { got: 1800, want: 1800 } }).status, "live");

  // 2. got > want: 台股全市場實際檔數 (如 1850) 超過保守基準 (1800) 屬正常現象
  const stMore = ctx.evalDataStatus({ ...base, coverage: { got: 1850, want: 1800 } });
  assert.equal(stMore.status, "live", "got > want 必須視為達標 (1850/1800)");
  assert.equal(stMore.isLive, true);

  // 3. 非物件型別: 陣列、字串、數字、布林
  assert.equal(ctx.evalDataStatus({ ...base, coverage: [1800, 1800] }).status, "delayed", "coverage 為陣列必須拒絕");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: "1800/1800" }).status, "delayed", "coverage 為字串必須拒絕");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: 1800 }).status, "delayed", "coverage 為數字必須拒絕");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: true }).status, "delayed", "coverage 為布林必須拒絕");

  // 4. 數值異常: Infinity, NaN, 負數, 零
  assert.equal(ctx.evalDataStatus({ ...base, coverage: { got: Infinity, want: 1800 } }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: { got: 1800, want: Infinity } }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: { got: NaN, want: 1800 } }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: { got: -10, want: 1800 } }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: { got: 1800, want: 0 } }).status, "delayed");
  assert.equal(ctx.evalDataStatus({ ...base, coverage: { got: 1800, want: -100 } }).status, "delayed");
});

test("v2.5.1 項目 C: 週末與國定假日收盤確認 vs 異常降級完整測試", () => {
  const { ctx } = createHarness();
  const sundayNow = new Date("2026-11-01T10:30:00+08:00"); // 週日 10:30

  // 1. 週末顯示週五正常收盤 (健康收盤)
  const stSunGood = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-30", // 週五收盤日
    session: "closed",
    dayState: "closed",
    today: "2026-11-01",
    now: sundayNow,
    completeness: "complete",
    coverage: { got: 1820, want: 1800 },
    dateVerified: true,
    dateConsistent: true,
  });
  assert.equal(stSunGood.status, "confirmed", "週末正常前營業日收盤必須為 confirmed");
  assert.equal(stSunGood.isConfirmed, true);
  assert.equal(stSunGood.isLive, false, "非交易日絕對不可標示為 live");
  assert.match(stSunGood.note, /非交易日・顯示 2026-10-30 收盤資料/);

  // 2. 週末收盤資料不完整 (如週五只有 TSE，OTC 缺失)
  const stSunPartial = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-30",
    session: "closed",
    dayState: "closed",
    today: "2026-11-01",
    now: sundayNow,
    completeness: "partial_tse_only",
    coverage: { got: 1000, want: 1800 },
  });
  assert.equal(stSunPartial.status, "delayed", "週末資料不完整必須標示為 delayed，不可宣稱 confirmed");
  assert.equal(stSunPartial.isConfirmed, false);
  assert.match(stSunPartial.note, /非交易日・資料不完整（partial_tse_only）/);

  // 3. 國定假日正常收盤
  const holidayNow = new Date("2026-10-10T11:00:00+08:00"); // 雙十節
  const stHolGood = ctx.evalDataStatus({
    type: "quote",
    dataDate: "2026-10-09", // 前一日收盤
    session: "closed",
    dayState: "closed",
    today: "2026-10-10",
    now: holidayNow,
  });
  assert.equal(stHolGood.status, "confirmed");
  assert.equal(stHolGood.isConfirmed, true);
  assert.equal(stHolGood.isLive, false);
});

test("v2.5.1 項目 C: 交易日收盤確認 vs 盤後待確認嚴格時間線測試", () => {
  const { ctx } = createHarness();
  const postCloseNow = new Date("2026-10-28T13:40:00+08:00"); // 13:40 剛收盤

  // 1. 13:40 剛收盤，官方資料尚未公布 (資料日期仍為昨日 10-27)
  const stWaiting = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-27",
    session: "closed",
    dayState: "trade",
    today: "2026-10-28",
    now: postCloseNow,
  });
  assert.equal(stWaiting.status, "pending", "尚未公布今日收盤必須為 pending");
  assert.equal(stWaiting.isConfirmed, false);
  assert.match(stWaiting.note, /等待 2026-10-28 收盤資料確認/);

  // 2. 14:00 官方公布今日收盤，完整度確認
  const stDone = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    session: "closed",
    dayState: "trade",
    today: "2026-10-28",
    completeness: "complete",
    coverage: { got: 1820, want: 1800 },
  });
  assert.equal(stDone.status, "confirmed");
  assert.equal(stDone.isConfirmed, true);
  assert.equal(stDone.isLive, false);

  // 3. 14:00 今日收盤但為估算值 (estimated: true)
  const stEst = ctx.evalDataStatus({
    type: "index",
    dataDate: "2026-10-28",
    session: "closed",
    dayState: "trade",
    today: "2026-10-28",
    estimated: true,
  });
  assert.equal(stEst.status, "pending", "估算值絕不可為 confirmed");
  assert.equal(stEst.isConfirmed, false);
  assert.equal(stEst.text, "收盤估算");
});

// =========================================================================
// Phase B v2.5.2 阻斷問題 A、B、C 深度驗證與回歸測試
// =========================================================================

test("v2.5.2 阻斷問題 A: 週末與休市日非健康行情絕不繞過檢查被標記為 confirmed", () => {
  const { ctx, W } = createHarness();
  W.dayState = "closed";
  W.today = "2026-10-25"; // 週日

  const baseWeekend = {
    type: "index",
    dataDate: "2026-10-23", // 週五收盤日
    dayState: "closed",
    session: "closed",
    today: "2026-10-25",
    source: "證交所 MIS",
  };

  // 1. 各種非健康 dataStatus 在週末不可標記為 confirmed
  for (const badStatus of ["partial", "stale", "pending", "delayed", "unknown", "", "   "]) {
    const st = ctx.evalDataStatus({ ...baseWeekend, dataStatus: badStatus });
    assert.equal(st.status, "delayed", `週末 dataStatus=${badStatus} 必須為 delayed`);
    assert.equal(st.isConfirmed, false, `週末 dataStatus=${badStatus} 絕不可為 confirmed`);
    assert.equal(st.isLive, false);
    assert.match(st.note, /非交易日/);
  }

  // 2. 日期未驗證 (dateVerified: false)
  const stUnverified = ctx.evalDataStatus({ ...baseWeekend, dateVerified: false });
  assert.equal(stUnverified.status, "delayed");
  assert.equal(stUnverified.isConfirmed, false);
  assert.match(stUnverified.note, /資料日期未經來源確認/);

  // 3. 上市櫃日期不一致 (dateConsistent: false)
  const stInconsistent = ctx.evalDataStatus({ ...baseWeekend, dateConsistent: false });
  assert.equal(stInconsistent.status, "delayed");
  assert.equal(stInconsistent.isConfirmed, false);
  assert.match(stInconsistent.note, /上市櫃資料日期不一致/);

  // 4. completeness 異常 (partial / degraded / 空白)
  for (const badComp of ["partial", "degraded", "partial_tse_only", ""]) {
    const stComp = ctx.evalDataStatus({ ...baseWeekend, completeness: badComp });
    assert.equal(stComp.status, "delayed");
    assert.equal(stComp.isConfirmed, false);
  }

  // 5. coverage 不足 (got 1000, want 2000)
  const stCov = ctx.evalDataStatus({ ...baseWeekend, coverage: { got: 1000, want: 2000 } });
  assert.equal(stCov.status, "delayed");
  assert.equal(stCov.isConfirmed, false);
  assert.match(stCov.note, /資料覆蓋率不足/);

  // 6. isComplete: false 顯式未完成
  const stIncomp = ctx.evalDataStatus({ ...baseWeekend, isComplete: false });
  assert.equal(stIncomp.status, "delayed");
  assert.equal(stIncomp.isConfirmed, false);

  // 7. 正常健康週末資料：前一交易日資料完整收盤 -> 正確標記為 confirmed
  const stHealthy = ctx.evalDataStatus({
    ...baseWeekend,
    completeness: "complete",
    coverage: { got: 2000, want: 2000 },
    dateVerified: true,
    dateConsistent: true,
    dataStatus: "confirmed",
  });
  assert.equal(stHealthy.status, "confirmed");
  assert.equal(stHealthy.isConfirmed, true);
  assert.equal(stHealthy.text, "收盤確認");
  assert.equal(stHealthy.note, "非交易日・顯示 2026-10-23 收盤資料");
});

test("v2.5.2 阻斷問題 B: dataStatus: 'unavailable' 專屬處理與最高優先級", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 1. evalDataStatus 直接傳入 dataStatus: "unavailable"
  const st1 = ctx.evalDataStatus({ dataStatus: "unavailable" });
  assert.equal(st1.status, "unavailable");
  assert.equal(st1.text, "未提供");
  assert.equal(st1.note, "此項資料功能目前未提供");
  assert.equal(st1.isLive, false);
  assert.equal(st1.isConfirmed, false);
  assert.equal(st1.isDelayed, false);
  assert.equal(st1.isPending, false);

  // 2. 優先級測試：即使在週末、收盤、或同時帶有 dateVerified: true、completeness: "complete"
  const st2 = ctx.evalDataStatus({
    dataStatus: "unavailable",
    session: "closed",
    dayState: "closed",
    today: "2026-10-25",
    dataDate: "2026-10-23",
    dateVerified: true,
    completeness: "complete",
  });
  assert.equal(st2.status, "unavailable");
  assert.equal(st2.text, "未提供");
  assert.equal(st2.isConfirmed, false);

  // 3. liveTag() 渲染 unavailable 驗證
  const htmlLive = ctx.liveTag({ dataStatus: "unavailable", live: false });
  assert.match(htmlLive, /class="mkt-tag unavailable"/);
  assert.match(htmlLive, /未提供/);
  assert.match(htmlLive, /此項資料功能目前未提供/);

  // 4. mktStatusTag() 渲染 unavailable 驗證
  const htmlMkt = ctx.mktStatusTag(st1);
  assert.equal(htmlMkt, '<span class="mkt-tag unavailable" title="此項資料功能目前未提供"><i></i>未提供</span>');
});

test("v2.5.2 阻斷問題 C: 舊版相容性與缺漏組合 8 項驗證", () => {
  const { ctx, W } = createHarness();
  const baseTrade = { session: "open", dayState: "trade", today: "2026-10-28" };

  // 1. metadata 缺漏，但交易時段且日期為當日 -> 允許即時
  const c1 = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-28" });
  assert.equal(c1.status, "live");
  assert.equal(c1.isLive, true);

  // 2. metadata 缺漏，但資料日期已過期 -> 拒絕即時，標記延遲
  const c2 = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-22" });
  assert.equal(c2.status, "delayed");
  assert.equal(c2.isLive, false);
  assert.match(c2.note, /盤中尚未取得今日行情（停留於 2026-10-22）/);

  // 3. dateVerified: false -> 拒絕即時
  const c3 = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-28", dateVerified: false });
  assert.equal(c3.status, "delayed");
  assert.equal(c3.isLive, false);
  assert.match(c3.note, /資料日期未經來源確認/);

  // 4. dateConsistent: false -> 拒絕即時
  const c4 = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-28", dateConsistent: false });
  assert.equal(c4.status, "delayed");
  assert.equal(c4.isLive, false);
  assert.match(c4.note, /上市櫃資料日期不一致/);

  // 5. isSuccess: false -> 拒絕即時
  const c5 = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-28", isSuccess: false });
  assert.equal(c5.status, "delayed");
  assert.equal(c5.isLive, false);
  assert.match(c5.note, /來源資料回應異常/);

  // 6. dataStatus: ""、空白字串、未知字串 -> 拒絕即時
  for (const badDs of ["", "   ", "unknown"]) {
    const c6 = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-28", dataStatus: badDs });
    assert.equal(c6.status, "delayed");
    assert.equal(c6.isLive, false);
  }

  // 7. dataStatus: "live" 但 completeness 或 coverage 不合格 -> 拒絕即時
  const c7a = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-28", dataStatus: "live", completeness: "partial" });
  assert.equal(c7a.status, "delayed");
  assert.equal(c7a.isLive, false);
  assert.match(c7a.note, /資料不完整（partial）/);

  const c7b = ctx.evalDataStatus({ ...baseTrade, dataDate: "2026-10-28", dataStatus: "live", coverage: { got: 1000, want: 1800 } });
  assert.equal(c7b.status, "delayed");
  assert.equal(c7b.isLive, false);
  assert.match(c7b.note, /資料覆蓋率不足/);

  // 8. dataStatus: "confirmed" 但日期未驗證或資料不完整 (收盤後) -> 拒絕收盤確認
  const baseClosed = { session: "closed", dayState: "trade", today: "2026-10-28", dataDate: "2026-10-28", dataStatus: "confirmed" };
  const c8a = ctx.evalDataStatus({ ...baseClosed, dateVerified: false });
  assert.equal(c8a.status, "pending");
  assert.equal(c8a.isConfirmed, false);

  const c8b = ctx.evalDataStatus({ ...baseClosed, completeness: "degraded" });
  assert.equal(c8b.status, "pending");
  assert.equal(c8b.isConfirmed, false);
});

test("P1-2 前端端到端整合驗證: API 回傳之 dateVerified 與 dateConsistent 在 liveTag() 與 hotSt() 完整透傳並驅動降級", () => {
  const { ctx, W } = createHarness();
  W.session = "open";
  W.today = "2026-10-28";

  // 1. liveTag() 收到 dateConsistent: false (跨市場日期不一致)
  const payloadInconsistent = {
    live: true,
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "證交所 MIS 即時行情（上市、上櫃）",
    completeness: "complete",
    coverage: { got: 1800, want: 1800 },
    dateVerified: false,
    dateConsistent: false
  };
  const liveTagHtml = ctx.liveTag(payloadInconsistent);
  assert.doesNotMatch(liveTagHtml, /class="livetag"/, "dateConsistent: false 絕不可輸出 livetag");
  assert.doesNotMatch(liveTagHtml, /盤中即時/, "dateConsistent: false 絕不可標示盤中即時");
  assert.match(liveTagHtml, /class="mkt-tag delayed"/, "dateConsistent: false 必須降級為 delayed");
  assert.match(liveTagHtml, /資料日期未經來源確認|上市櫃資料日期不一致/, "標籤說明文字必須包含日期未確認或不一致原因");

  // 2. hotSec / hotSt 收到 dateVerified: false
  W.lt = "mkt";
  W.mkHot = "value";
  W.hot["rank:value"] = {
    date: "2026-10-28",
    time: "10:30:00",
    at: Date.now(),
    source: "富果行情快照",
    completeness: "complete",
    coverage: { got: 1800, want: 1800 },
    dateVerified: false,
    dateConsistent: true,
    rows: [{ code: "2330", name: "台積電", price: 1000 }]
  };
  const hotHtml = ctx.hotSec(ctx.sec, "tw");
  assert.doesNotMatch(hotHtml, /class="livetag"/, "dateVerified: false 絕不可輸出 livetag");
  assert.doesNotMatch(hotHtml, /盤中即時/, "dateVerified: false 絕不可標示盤中即時");
  assert.match(hotHtml, /class="mkt-tag delayed"/, "dateVerified: false 必須降級為 delayed");
  assert.match(hotHtml, /資料日期未經來源確認/, "hotSt 必須透傳 dateVerified 並呈現警示說明");

  // 3. 收盤後 (closed) dateConsistent: false 絕不可為 confirmed
  W.session = "closed";
  const closedSt = ctx.evalDataStatus({
    session: "closed",
    dayState: "trade",
    today: "2026-10-28",
    dataDate: "2026-10-28",
    dateVerified: false,
    dateConsistent: false,
    completeness: "complete",
    coverage: { got: 1800, want: 1800 }
  });
  assert.notEqual(closedSt.status, "confirmed");
  assert.equal(closedSt.isConfirmed, false);
  assert.equal(closedSt.status, "pending");
  assert.match(closedSt.note, /資料日期未經來源確認|上市櫃資料日期不一致/);
});

test("Scenario 40: [第三輪驗證] 前端 UI 降級提示語測試 (watch.html lines 2062 & 2095 消除誤導)", () => {
  const evalMktNote = (mktObj) => {
    const W = { mkt: mktObj };
    const mktHealthy = W.mkt?.live && (W.mkt.dataStatus == null || W.mkt.dataStatus === "live") && (W.mkt.completeness == null || W.mkt.completeness === "complete") && W.mkt.dateConsistent !== false && W.mkt.dateVerified !== false;
    const mktNoteText = mktHealthy
      ? "加權、櫃買、漲跌分佈、產業、貢獻點數都是盤中即時（每 30 秒自動更新）；法人買賣超是最近一次收盤後公布"
      : W.mkt?.live
        ? (W.mkt.completeness === "partial_tse_only" ? "僅上市為盤中即時（上櫃缺漏，統計為部分涵蓋）；法人買賣超是最近一次收盤後公布" : "部分行情為盤中即時（資料不完整或降級更新）；法人買賣超是最近一次收盤後公布")
        : "加權、櫃買為即時；漲跌分佈、產業、貢獻點數與法人是最近交易日收盤後的統計";
    return { mktHealthy, mktNoteText };
  };

  const evalHotNote = (hotObj) => {
    const H = hotObj;
    const hotHealthy = H && (H.dataStatus == null || H.dataStatus === "live") && (H.completeness == null || H.completeness === "complete") && H.dateConsistent !== false && H.dateVerified !== false;
    const note = H ? `${H.live ? (hotHealthy ? "盤中即時排行（依每秒報價重新排序，名單每 15 秒更新）" : "盤中排行（部分資料降級或不完整，依每秒報價排序）") : H.date ? H.date.replace(/-/g, "/") + " 收盤後統計" : ""}${H.source ? "・" + H.source : ""}；右邊的價格是即時價` : "";
    return { hotHealthy, note };
  };

  // 1. 全健全即時行情: 提示包含「都是盤中即時」
  const mkt1 = evalMktNote({ live: true, dataStatus: "live", completeness: "complete", dateConsistent: true, dateVerified: true });
  assert.equal(mkt1.mktHealthy, true);
  assert.match(mkt1.mktNoteText, /都是盤中即時/);

  // 2. 僅上市完整、上櫃缺漏 (partial_tse_only): 提示「僅上市為盤中即時（上櫃缺漏，統計為部分涵蓋）」
  const mkt2 = evalMktNote({ live: true, dataStatus: "live", completeness: "partial_tse_only", dateConsistent: false, dateVerified: true });
  assert.equal(mkt2.mktHealthy, false);
  assert.match(mkt2.mktNoteText, /僅上市為盤中即時（上櫃缺漏，統計為部分涵蓋）/);
  assert.doesNotMatch(mkt2.mktNoteText, /都是盤中即時/);

  // 3. 降級行情 (completeness: degraded): 提示「部分行情為盤中即時（資料不完整或降級更新）」
  const mkt3 = evalMktNote({ live: true, dataStatus: "degraded", completeness: "degraded", dateConsistent: true, dateVerified: true });
  assert.equal(mkt3.mktHealthy, false);
  assert.match(mkt3.mktNoteText, /部分行情為盤中即時（資料不完整或降級更新）/);
  assert.doesNotMatch(mkt3.mktNoteText, /都是盤中即時/);

  // 4. 跨市場日期不一致 (dateConsistent: false): 提示「部分行情為盤中即時（資料不完整或降級更新）」
  const mkt4 = evalMktNote({ live: true, dataStatus: "degraded", completeness: "complete", dateConsistent: false, dateVerified: true });
  assert.equal(mkt4.mktHealthy, false);
  assert.match(mkt4.mktNoteText, /部分行情為盤中即時（資料不完整或降級更新）/);
  assert.doesNotMatch(mkt4.mktNoteText, /都是盤中即時/);

  // 5. 日期未驗證 (dateVerified: false): 提示「部分行情為盤中即時（資料不完整或降級更新）」
  const mkt5 = evalMktNote({ live: true, dataStatus: "delayed", completeness: "complete", dateConsistent: true, dateVerified: false });
  assert.equal(mkt5.mktHealthy, false);
  assert.match(mkt5.mktNoteText, /部分行情為盤中即時（資料不完整或降級更新）/);
  assert.doesNotMatch(mkt5.mktNoteText, /都是盤中即時/);

  // 6. 非即時行情 (live: false): 正確回到收盤後統計提示
  const mkt6 = evalMktNote({ live: false, dataStatus: "confirmed", completeness: "complete", dateConsistent: true, dateVerified: true });
  assert.equal(mkt6.mktHealthy, false);
  assert.match(mkt6.mktNoteText, /加權、櫃買為即時；漲跌分佈、產業、貢獻點數與法人是最近交易日收盤後的統計/);

  // 7. 熱門股健全排行: 標示「盤中即時排行（依每秒報價重新排序，名單每 15 秒更新）」
  const hot1 = evalHotNote({ live: true, dataStatus: "live", completeness: "complete", dateConsistent: true, dateVerified: true, source: "富果行情快照" });
  assert.equal(hot1.hotHealthy, true);
  assert.match(hot1.note, /^盤中即時排行（依每秒報價重新排序，名單每 15 秒更新）/);

  // 8. 熱門股降級排行 (completeness: degraded / dateConsistent: false): 標示「盤中排行（部分資料降級或不完整，依每秒報價排序）」
  const hot2 = evalHotNote({ live: true, dataStatus: "degraded", completeness: "degraded", dateConsistent: false, dateVerified: true, source: "富果行情快照" });
  assert.equal(hot2.hotHealthy, false);
  assert.match(hot2.note, /^盤中排行（部分資料降級或不完整，依每秒報價排序）/);
  assert.doesNotMatch(hot2.note, /^盤中即時排行/);

  // 9. 熱門股 dateVerified: false: 嚴格降級，絕不可稱即時排行
  const hot3 = evalHotNote({ live: true, dataStatus: "delayed", completeness: "complete", dateConsistent: true, dateVerified: false, source: "富果行情快照" });
  assert.equal(hot3.hotHealthy, false);
  assert.match(hot3.note, /^盤中排行（部分資料降級或不完整，依每秒報價排序）/);
  assert.doesNotMatch(hot3.note, /^盤中即時排行/);

  // 10. 三態邊界相容性 (dateVerified / dateConsistent: null 或 undefined): 向後相容支援
  const mktLegacy = evalMktNote({ live: true, dataStatus: "live", completeness: "complete", dateConsistent: null, dateVerified: undefined });
  assert.equal(mktLegacy.mktHealthy, true);
  const hotLegacy = evalHotNote({ live: true, dataStatus: "live", completeness: "complete", dateConsistent: undefined, dateVerified: null });
  assert.equal(hotLegacy.hotHealthy, true);

  // 11. 原始 watch.html 原始碼驗證: 確認誤導性即時判斷已徹底自原始碼中替換
  assert.match(html, /const mktHealthy = W\.mkt\?\.live &&/);
  assert.match(html, /僅上市為盤中即時（上櫃缺漏，統計為部分涵蓋）/);
  assert.match(html, /部分行情為盤中即時（資料不完整或降級更新）/);
  assert.match(html, /const hotHealthy = H &&/);
  assert.match(html, /盤中排行（部分資料降級或不完整，依每秒報價排序）/);
});
