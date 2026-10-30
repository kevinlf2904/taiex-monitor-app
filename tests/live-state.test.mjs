import test from "node:test";
import assert from "node:assert/strict";
import { parseFugleSnapshot, misAll, mapCloseToRows, validateMarketRows, fetchRecentClose, marketRows } from "../api/_lib/_live.js";
import { parseMiIndex, parseMiIndexRwd, fetchMiIndex } from "../api/_lib/market.js";
import { extractTwseRwdDate, extractTpexDate, closeToday, isValidIsoDate } from "../api/_lib/daily.js";
import { todayTaipei, session } from "../api/_lib/quote.js";

// ==========================================
// 既有基礎場景回歸 (Scenarios 1 ~ 16)
// ==========================================

test("Scenario 1: 盤前交易狀態與前一交易日收盤 (08:15 無 MIS，回退前日收盤)", async () => {
  const now = new Date("2026-10-28T00:15:00Z"); // 台北時間 08:15
  const prevRows = [
    { code: "2330", name: "台積電", market: "上市", price: 1050, vol: 35000, date: "2026-10-27" },
    { code: "6547", name: "高端疫苗", market: "上櫃", price: 60, vol: 500, date: "2026-10-27" }
  ];
  let misCalled = false;
  const mockFetcher = async () => prevRows;
  const mockMis = async () => { misCalled = true; return []; };
  const mockRwd = async (dStr) => {
    const m = new Map([
      ["2330", { name: "台積電", market: "上市", p: 1050, pct: 1.45, v: 35000 }],
      ["6547", { name: "高端疫苗", market: "上櫃", p: 60, pct: 0.5, v: 500 }]
    ]);
    m.date = "2026-10-27";
    m.isSourceDateMatched = (dStr === "20261027");
    m.dateVerified = true;
    return m;
  };

  const res = await marketRows({
    now,
    today: "2026-10-28",
    fetcher: mockFetcher,
    misFetcher: mockMis,
    rwdFetcher: mockRwd
  });

  assert.equal(misCalled, false, "盤前 08:15 不應呼叫 MIS 盤中即時");
  assert.equal(res.live, false);
  assert.equal(res.date, "2026-10-27");
  assert.equal(res.dataStatus, "delayed");
});

test("Scenario 2: 盤中 MIS 成功回傳當日即時 (10:30 Session: open, date: today)", async () => {
  const now = new Date("2026-10-28T02:30:00Z"); // 台北時間 10:30
  const base = [];
  for (let i = 1000; i < 2000; i++) {
    base.push({ code: String(i), name: `市${i}`, market: "上市", date: "2026-10-27" });
  }
  for (let i = 3000; i < 3800; i++) {
    base.push({ code: String(i), name: `櫃${i}`, market: "上櫃", date: "2026-10-27" });
  }

  const mockMis = async (chs) => chs.map(ch => {
    const code = ch.split("_")[1].split(".")[0];
    const isTse = ch.startsWith("tse");
    return {
      c: code,
      n: `名稱${code}`,
      ex: isTse ? "tse" : "otc",
      z: "100",
      y: "99",
      v: "1000",
      d: "20261028",
      t: "10:29:58" // MIS 一定會帶最後成交時間 t
    };
  });

  const res = await marketRows({
    now,
    today: "2026-10-28",
    fetcher: async () => base,
    misFetcher: mockMis
  });

  assert.equal(res.live, true, "盤中應標記 live: true");
  assert.equal(res.date, "2026-10-28");
  assert.equal(res.dataStatus, "live");
  assert.equal(res.sourceDate, "2026-10-28");
  assert.ok(res.coverage.got >= 500);
});

test("Scenario 3: prevDate === today 時仍可正常執行 MIS 取得當日即時", async () => {
  const now = new Date("2026-10-28T03:00:00Z"); // 台北時間 11:00
  const base = [];
  for (let i = 1000; i < 2000; i++) {
    base.push({ code: String(i), name: `市${i}`, market: "上市", date: "2026-10-28" });
  }
  for (let i = 3000; i < 3800; i++) {
    base.push({ code: String(i), name: `櫃${i}`, market: "上櫃", date: "2026-10-28" });
  }
  let misCalled = false;
  const mockMis = async (chs) => {
    misCalled = true;
    return chs.map(ch => ({
      c: ch.split("_")[1].split(".")[0],
      ex: ch.startsWith("tse") ? "tse" : "otc",
      z: "120",
      y: "115",
      v: "500",
      d: "20261028",
      t: "10:59:50" // MIS 一定會帶最後成交時間 t
    }));
  };

  const res = await marketRows({
    now,
    today: "2026-10-28",
    fetcher: async () => base,
    misFetcher: mockMis
  });

  assert.ok(misCalled, "prevDate === today 時仍應執行 MIS");
  assert.equal(res.live, true);
  assert.equal(res.dataStatus, "live");
});

test("Scenario 4: 盤中 MIS 失敗時平順降級至最近收盤", async () => {
  const now = new Date("2026-10-28T02:30:00Z");
  const base = [];
  for (let i = 1000; i < 1600; i++) {
    base.push({ code: String(i), name: `股${i}`, market: "上市", date: "2026-10-27" });
  }
  const mockMis = async () => { throw new Error("MIS 503 Service Unavailable"); };
  const mockRwd = async (dStr) => {
    const m = new Map();
    for (let i = 1000; i < 1600; i++) {
      m.set(String(i), { name: `股${i}`, market: "上市", p: 100, pct: 1.0, v: 200 });
    }
    m.date = "2026-10-27";
    m.isSourceDateMatched = (dStr === "20261027");
    m.dateVerified = true;
    return m;
  };

  const res = await marketRows({
    now,
    today: "2026-10-28",
    fetcher: async () => base,
    misFetcher: mockMis,
    rwdFetcher: mockRwd
  });

  assert.equal(res.live, false, "降級至收盤時 live 應為 false");
  assert.equal(res.date, "2026-10-27");
  // 盤中顯示前一交易日收盤：交易日期過舊，標 stale（比 delayed 嚴重），不能只標「延遲」
  assert.equal(res.dataStatus, "stale");
  assert.ok(res.note && res.note.includes("今日即時暫未取得"));
});

test("Scenario 5: 收盤後當日收盤判定 (修正 S5 筆數與 completeness 實際對應)", async () => {
  const now = new Date("2026-10-28T06:30:00Z"); // 台北時間 14:30
  // 1. 若上游僅有上市 600 檔（低於 minTse 800）、上櫃 0 檔：判定為 degraded
  const mockRwdPartial = async (dStr) => {
    if (dStr === "20261028") {
      const m = new Map();
      for (let i = 1000; i < 1600; i++) {
        m.set(String(i), { name: `上市${i}`, market: "上市", p: 105, pct: 2.0, v: 300 });
      }
      m.date = "2026-10-28";
      m.isSourceDateMatched = true;
      m.dateVerified = true;
      return m;
    }
    return new Map();
  };

  const resPartial = await fetchRecentClose({ now, todayStr: "2026-10-28", fetcher: mockRwdPartial });
  assert.ok(resPartial);
  const rowsPartial = mapCloseToRows(resPartial.map, resPartial.date);
  const valPartial = validateMarketRows(rowsPartial, { today: "2026-10-28" });
  assert.equal(valPartial.completeness, "degraded", "僅上市 600 筆（低於上市門檻 800）時，完整度應為 degraded，非 complete");

  // 2. 若上游僅有上市 1000 檔（>= 800）、上櫃 0 檔：判定為 partial_tse_only
  const mockRwdTseOnly = async (dStr) => {
    if (dStr === "20261028") {
      const m = new Map();
      for (let i = 1000; i < 2000; i++) {
        m.set(String(i), { name: `上市${i}`, market: "上市", p: 105, pct: 2.0, v: 300 });
      }
      m.date = "2026-10-28";
      m.isSourceDateMatched = true;
      m.dateVerified = true;
      return m;
    }
    return new Map();
  };

  const resTseOnly = await fetchRecentClose({ now, todayStr: "2026-10-28", fetcher: mockRwdTseOnly });
  assert.ok(resTseOnly);
  const rowsTseOnly = mapCloseToRows(resTseOnly.map, resTseOnly.date);
  const valTseOnly = validateMarketRows(rowsTseOnly, { today: "2026-10-28" });
  assert.equal(valTseOnly.completeness, "partial_tse_only", "上市達 1000 筆但無上櫃時，完整度應為 partial_tse_only");

  // 3. 若上游具備完整雙市場 (上市 1000 檔 + 上櫃 800 檔 = 1800 檔)：判定為 complete
  const mockRwdFull = async (dStr) => {
    if (dStr === "20261028") {
      const m = new Map();
      for (let i = 1000; i < 2000; i++) m.set(String(i), { name: `上市${i}`, market: "上市", p: 100, pct: 1.0, v: 200 });
      for (let i = 3000; i < 3800; i++) m.set(String(i), { name: `上櫃${i}`, market: "上櫃", p: 50, pct: 0.5, v: 100 });
      m.date = "2026-10-28";
      m.isSourceDateMatched = true;
      m.dateVerified = true;
      m.dateConsistent = true;
      return m;
    }
    return new Map();
  };

  const resFull = await fetchRecentClose({ now, todayStr: "2026-10-28", fetcher: mockRwdFull });
  assert.ok(resFull);
  const rowsFull = mapCloseToRows(resFull.map, resFull.date);
  const valFull = validateMarketRows(rowsFull, { today: "2026-10-28" });
  assert.equal(valFull.completeness, "complete", "上市 1000 + 上櫃 800 雙市場皆達標時，完整度為 complete");
});

test("Scenario 6: 週末取得週五收盤 (週六自動跳過，回溯週五)", async () => {
  const now = new Date("2026-10-31T02:00:00Z"); // 週六
  const probedDates = [];
  const mockFetcher = async (dStr) => {
    probedDates.push(dStr);
    if (dStr === "20261030") {
      const m = new Map();
      for (let i = 1000; i < 1600; i++) m.set(String(i), { name: `股${i}`, p: 100, pct: 0, v: 10 });
      m.date = "2026-10-30";
      m.isSourceDateMatched = true;
      m.dateVerified = true;
      return m;
    }
    return new Map();
  };

  const res = await fetchRecentClose({ now, todayStr: "2026-10-31", fetcher: mockFetcher });
  assert.ok(res);
  assert.equal(res.date, "2026-10-30");
  assert.ok(!probedDates.includes("20261031"));
  assert.ok(probedDates.includes("20261030"));
});

test("Scenario 7: 國定假日取得前一交易日收盤 (跳過假日)", async () => {
  const now = new Date("2026-10-29T02:00:00Z");
  const isHoliday = iso => iso === "2026-10-29";
  const probedDates = [];
  const mockFetcher = async (dStr) => {
    probedDates.push(dStr);
    if (dStr === "20261028") {
      const m = new Map();
      for (let i = 1000; i < 1600; i++) m.set(String(i), { name: `股${i}`, p: 100, pct: 0, v: 10 });
      m.date = "2026-10-28";
      m.isSourceDateMatched = true;
      m.dateVerified = true;
      return m;
    }
    return new Map();
  };

  const res = await fetchRecentClose({ now, todayStr: "2026-10-29", isHoliday, fetcher: mockFetcher });
  assert.ok(res);
  assert.equal(res.date, "2026-10-28");
  assert.ok(!probedDates.includes("20261029"));
  assert.ok(probedDates.includes("20261028"));
});

test("Scenario 8: 連續休市多日的回溯探測 (4 天連假)", async () => {
  const now = new Date("2026-04-06T02:00:00Z");
  const isHoliday = iso => iso === "2026-04-03" || iso === "2026-04-06";
  const probed = [];
  const mockFetcher = async (dStr) => {
    probed.push(dStr);
    if (dStr === "20260402") {
      const m = new Map();
      for (let i = 1000; i < 1600; i++) m.set(String(i), { name: `股${i}`, p: 100, pct: 0, v: 10 });
      m.date = "2026-04-02";
      m.isSourceDateMatched = true;
      m.dateVerified = true;
      return m;
    }
    return new Map();
  };

  const res = await fetchRecentClose({ now, todayStr: "2026-04-06", maxCalendarDays: 10, maxTradingDays: 5, isHoliday, fetcher: mockFetcher });
  assert.ok(res);
  assert.equal(res.date, "2026-04-02");
  assert.ok(probed.includes("20260402"));
});

test("Scenario 9: 上游 RWD HTTP 200 但回傳舊快取或錯誤日期的檢驗 (拒絕偽裝)", async () => {
  const rawRwd = {
    stat: "OK",
    date: "20261022",
    tables: [{
      title: "115年10月22日 每日收盤行情",
      fields: ["證券代號", "證券名稱", "收盤價", "漲跌價差", "成交股數"],
      data: [["2330", "台積電", "1000", "0", "10000000"]]
    }]
  };
  const parsedDate = extractTwseRwdDate(rawRwd);
  assert.equal(parsedDate, "2026-10-22");

  const mockFetch = async () => rawRwd;
  const res = await closeToday("20261028", { fetchJson: mockFetch });
  assert.equal(res.date, "2026-10-22");
  assert.equal(res.requestedDate, "2026-10-28");
  assert.equal(res.isSourceDateMatched, false, "日期不符時 isSourceDateMatched 必須為 false");
});

test("Scenario 10: 查詢日期與來源內部日期不一致檢驗 (ROC Title vs Root Date 解析)", () => {
  const sampleTwse = {
    stat: "OK",
    tables: [{
      title: "115年10月27日 每日收盤行情",
      fields: ["代號"],
      data: [["2330"]]
    }]
  };
  assert.equal(extractTwseRwdDate(sampleTwse), "2026-10-27");

  const sampleTpex = {
    reportDate: "115/10/27",
    aaData: [["6547"]]
  };
  assert.equal(extractTpexDate(sampleTpex), "2026-10-27");
});

test("Scenario 11: 部分資料成功 (僅上市或僅上櫃成功) 之明確狀態標記", () => {
  const tseOnlyRows = [];
  for (let i = 1000; i < 2000; i++) {
    tseOnlyRows.push({ code: String(i), name: `上市股${i}`, market: "上市", price: 100, vol: 10, date: "2026-10-28" });
  }
  const v1 = validateMarketRows(tseOnlyRows, { today: "2026-10-28" });
  assert.equal(v1.completeness, "partial_tse_only");

  const otcOnlyRows = [];
  for (let i = 1000; i < 1800; i++) {
    otcOnlyRows.push({ code: String(i), name: `上櫃股${i}`, market: "上櫃", price: 50, vol: 10, date: "2026-10-28" });
  }
  const v2 = validateMarketRows(otcOnlyRows, { today: "2026-10-28" });
  assert.equal(v2.completeness, "partial_otc_only");
});

test("Scenario 12: 代碼重複、異常價格、缺少必要欄位的過濾與統計", () => {
  const dirtyRows = [
    { code: "2330", name: "台積電", price: 1050, vol: 100, date: "2026-10-28" },
    { code: "2330", name: "台積電重複", price: 1050, vol: 100, date: "2026-10-28" },
    { code: "2454", name: "聯發科", price: -10, vol: 50, date: "2026-10-28" },
    { code: "2317", name: "鴻海", price: 0, vol: 50, date: "2026-10-28" },
    { code: "2308", name: "台達電", price: 400, vol: -5, date: "2026-10-28" },
    { code: "2881", name: "富邦金", price: 90, vol: 10, date: "2099-01-01" },
    { code: "2882", name: "國泰金", price: 65, vol: 10, date: "2026-10-28" }
  ];

  const v = validateMarketRows(dirtyRows, { today: "2026-10-28" });
  assert.equal(v.validRows.length, 2);
  assert.equal(v.dupCount, 1);
  assert.equal(v.invalidCount, 4);
});

test("Scenario 13: 跨時區邊界 (台北時間 08:29, 08:30, 09:00, 13:35, 13:36) 交易狀態判定", () => {
  assert.equal(session(new Date("2026-10-28T00:29:00Z")), "closed");
  assert.equal(session(new Date("2026-10-28T00:30:00Z")), "pre");
  assert.equal(session(new Date("2026-10-28T01:00:00Z")), "open");
  assert.equal(session(new Date("2026-10-28T05:35:00Z")), "open");
  assert.equal(session(new Date("2026-10-28T05:36:00Z")), "closed");
});

test("Scenario 14: OpenAPI、MIS、RWD 全面失敗時之明確拋錯與降級訊息", async () => {
  const mockFetcher = async () => [];
  const mockMis = async () => { throw new Error("MIS 斷線"); };
  const mockRwd = async () => null;

  await assert.rejects(
    async () => {
      await marketRows({
        now: new Date("2026-10-28T02:00:00Z"),
        today: "2026-10-28",
        fetcher: mockFetcher,
        misFetcher: mockMis,
        rwdFetcher: mockRwd
      });
    },
    /沒有資料|MIS 斷線/
  );
});

test("Scenario 15: in-flight 請求共用與並行查詢防護", async () => {
  let callCount = 0;
  const mockFetcher = async () => {
    callCount++;
    await new Promise(r => setTimeout(r, 20));
    const rows = [];
    for (let i = 1000; i < 1600; i++) rows.push({ code: String(i), name: `股${i}`, market: "上市", price: 100, vol: 10, date: "2026-10-27" });
    return rows;
  };

  const [r1, r2] = await Promise.all([
    marketRows({ now: new Date("2026-10-28T00:00:00Z"), fetcher: mockFetcher }),
    marketRows({ now: new Date("2026-10-28T00:00:00Z"), fetcher: mockFetcher })
  ]);

  assert.equal(r1.date, r2.date);
  assert.ok(r1.rows.length >= 500);
});

test("Scenario 16: market.js 指數符號、逗號數字解析與排除報酬/槓桿/反向指數", async () => {
  const sampleOapi = [
    { 日期: "1151022", 指數: "發行量加權股價指數", 收盤指數: "46,041.43", 漲跌: "-", 漲跌點數: "846.34", 漲跌百分比: "-1.81" },
    { 日期: "1151022", 指數: "電子工業類指數", 收盤指數: "2,480.12", 漲跌: "+", 漲跌點數: "15.20", 漲跌百分比: "0.62" },
    { 日期: "1151022", 指數: "半導體類報酬指數", 收盤指數: "3,000.00", 漲跌: "+", 漲跌點數: "10", 漲跌百分比: "0.33" },
    { 日期: "1151022", 指數: "臺灣50反向1倍指數", 收盤指數: "4.50", 漲跌: "-", 漲跌點數: "0.05", 漲跌百分比: "-1.10" }
  ];

  const oapiRows = parseMiIndex(sampleOapi);
  assert.equal(oapiRows.length, 2);
  assert.equal(oapiRows[0].name, "發行量加權股價指數");
  assert.equal(oapiRows[0].close, 46041.43);
  assert.equal(oapiRows[0].chg, -846.34);
  assert.equal(oapiRows[0].chgPct, -1.81);

  const sampleRwd = {
    stat: "OK",
    date: "20261027",
    tables: [
      {
        title: "115年10月27日 價格指數(臺灣證券交易所)",
        fields: ["指數", "收盤指數", "漲跌(+/-)", "漲跌點數", "漲跌百分比(%)", "特殊處理註記"],
        data: [
          ["發行量加權股價指數", "46,096.23", "<p style ='color:red'>+</p>", "54.80", "0.12", ""],
          ["電子工業類指數", "2,495.30", "<p style ='color:red'>+</p>", "15.18", "0.61", ""],
          ["半導體類指數", "1,234.50", "<span> </span>", "0.00", "0.00", ""],
          ["航運類指數", "180.20", "<p style ='color:green'>-</p>", "2.10", "1.15", ""]
        ]
      },
      {
        title: "115年10月27日 報酬指數",
        fields: ["指數", "收盤指數", "漲跌(+/-)", "漲跌點數", "漲跌百分比(%)"],
        data: [
          ["臺灣50報酬指數", "50,000.00", "+", "100.00", "0.20"]
        ]
      }
    ]
  };

  const rwdRows = parseMiIndexRwd(sampleRwd);
  assert.equal(rwdRows.length, 4);
  assert.equal(rwdRows[0].close, 46096.23);
  assert.equal(rwdRows[0].chg, 54.80);
  assert.equal(rwdRows[2].chg, 0);
  assert.equal(rwdRows[3].chg, -2.10);
  assert.equal(rwdRows[3].chgPct, -1.15);

  const miWithMeta = await fetchMiIndex(null, { getJson: async () => sampleRwd });
  assert.equal(miWithMeta.isComplete, false);
  assert.ok(miWithMeta.missing.includes("金融保險類指數"));
});

// ==========================================
// 第二輪新修復缺陷專屬驗收測試 (Scenarios 17 ~ 32)
// ==========================================

test("Scenario 17: [問題A] 上游有資料但日期缺失時，不得以請求日期偽裝已驗證日期", async () => {
  const rawRwdNoDate = {
    stat: "OK",
    tables: [{
      fields: ["證券代號", "證券名稱", "收盤價", "漲跌價差", "成交股數"],
      data: [["2330", "台積電", "1000", "0", "10000000"]]
    }]
  };
  const res = await closeToday("20261028", { fetchJson: async () => rawRwdNoDate });
  assert.equal(res.date, null, "來源無日期時，date 必須為 null");
  assert.equal(res.dateVerified, false, "來源無日期時，dateVerified 必須為 false");
  assert.equal(res.isSourceDateMatched, false, "來源無日期時，isSourceDateMatched 不可為 true");
  assert.equal(res.requestedDate, "2026-10-28", "requestedDate 應保留原始請求日期");
});

test("Scenario 18: [問題A] 上游日期為非法日曆日期 (如 2026-02-30) 嚴格拒絕", () => {
  assert.equal(isValidIsoDate("2026-02-30"), false, "2 月 30 日是非法日曆日期");
  assert.equal(isValidIsoDate("2026-04-31"), false, "4 月 31 日是非法日曆日期");
  assert.equal(isValidIsoDate("2026-13-01"), false, "13 月是非法月份");
  assert.equal(isValidIsoDate("2026-10-28"), true, "2026-10-28 是有效日期");
});

test("Scenario 19: [問題A] 上游日期為未來日期時嚴格拒絕", () => {
  const today = "2026-10-28";
  assert.equal(isValidIsoDate("2026-10-29", today), false, "大於今日者為未來日期，應被拒絕");
  assert.equal(isValidIsoDate("2026-10-28", today), true, "今日為合法有效日期");
  assert.equal(isValidIsoDate("2026-10-27", today), true, "過去日期為合法有效日期");
});

test("Scenario 20: [問題A] 跨台北午夜與 UTC 日期邊界檢驗 (UTC 2026-10-27 16:30 -> 台北 2026-10-28 00:30)", () => {
  const utcNight = new Date("2026-10-27T16:30:00Z");
  assert.equal(todayTaipei(utcNight), "2026-10-28", "台北時間應已跨日為 2026-10-28");
});

test("Scenario 21: [問題A] RWD 解析不到日期但仍有指數資料時，不可宣稱已驗證", async () => {
  const sampleNoDate = {
    stat: "OK",
    tables: [{
      title: "價格指數",
      fields: ["指數", "收盤指數", "漲跌(+/-)", "漲跌點數", "漲跌百分比(%)"],
      data: [["發行量加權股價指數", "23,000.00", "+", "100.00", "0.43"]]
    }]
  };
  const rwdRows = parseMiIndexRwd(sampleNoDate);
  assert.equal(rwdRows[0].date, null, "無日期表格解析出的 date 應為 null");

  const miMeta = await fetchMiIndex("2026-10-28", { getJson: async () => sampleNoDate });
  assert.equal(miMeta.dateVerified, false, "無有效來源日期時 dateVerified 必須為 false");
  assert.equal(miMeta.isComplete, false, "無有效來源日期時 isComplete 不可為 true");
});

test("Scenario 22: [問題B] TSE 為今日、OTC 為前一交易日時，上市櫃日期不一致明確識別", async () => {
  const mockTse = {
    stat: "OK",
    date: "20261028",
    tables: [{
      fields: ["證券代號", "證券名稱", "收盤價", "漲跌價差", "成交股數"],
      data: [["2330", "台積電", "1000", "0", "10000000"]]
    }]
  };
  const mockOtc = {
    reportDate: "115/10/27", // 民國 115/10/27 = 2026-10-27
    aaData: [["6547", "高端疫苗", "60", "0", "60", "60", "60", "60", "100000"]]
  };

  const res = await closeToday("20261028", {
    fetchJson: async (url) => url.includes("twse.com.tw") ? mockTse : mockOtc
  });

  assert.equal(res.tseDate, "2026-10-28");
  assert.equal(res.otcDate, "2026-10-27");
  assert.equal(res.dateConsistent, false, "雙市場日期不同時 dateConsistent 必須為 false");
  assert.equal(res.dateVerified, false, "雙市場衝突時 dateVerified 必須為 false");
  assert.equal(res.date, null, "雙市場衝突時不可合成單一統一 date");
});

test("Scenario 23: [問題B] TSE 有日期、OTC 無日期時，不可將 dateConsistent 標為 true", async () => {
  const mockTse = {
    date: "20261028",
    tables: [{ fields: ["證券代號", "收盤價"], data: [["2330", "1000"]] }]
  };
  const mockOtcNoDate = {
    aaData: [["6547", "高端疫苗", "60", "0", "60", "60", "60", "60", "100000"]]
  };

  const res = await closeToday("20261028", {
    fetchJson: async (url) => url.includes("twse.com.tw") ? mockTse : mockOtcNoDate
  });

  assert.equal(res.tseDate, "2026-10-28");
  assert.equal(res.otcDate, null);
  assert.equal(res.dateConsistent, false, "其中一市場無日期時不可視為兩邊一致");
});

test("Scenario 24: [問題C] 600 筆資料不得僅因基準清單為 600 筆就宣稱全市場 100% 覆蓋", () => {
  const rows = [];
  const expectedCodes = new Set();
  for (let i = 1000; i < 1600; i++) {
    const c = String(i);
    rows.push({ code: c, name: `股${c}`, market: "上市", price: 100, vol: 10, date: "2026-10-28" });
    expectedCodes.add(c);
  }

  const v = validateMarketRows(rows, { expectedCodes, today: "2026-10-28" });
  assert.equal(v.coverage.benchmark.ratio, 1.0, "相對於 600 筆基準清單之 ratio 為 1.0");
  assert.equal(v.coverage.benchmark.isBenchmarkComplete, false, "基準清單僅 600 筆，基準本身不完整");
  assert.notEqual(v.coverage.ratio, 1.0, "全市場覆蓋率不可宣稱為 1.0");
  assert.equal(v.coverage.ratio, +(600 / 1800).toFixed(4), "全市場估計覆蓋率應為 600 / 1800 約 0.3333");
  assert.notEqual(v.completeness, "complete", "600 筆資料不可宣稱 complete");
});

test("Scenario 25: [問題C] 上市與上櫃皆有資料但總數不足時標記為 partial", () => {
  const rows = [];
  // 300 檔上市 + 200 檔上櫃 = 500 檔
  for (let i = 1000; i < 1300; i++) rows.push({ code: String(i), name: `上市${i}`, market: "上市", price: 100, vol: 10, date: "2026-10-28" });
  for (let i = 3000; i < 3200; i++) rows.push({ code: String(i), name: `上櫃${i}`, market: "上櫃", price: 50, vol: 10, date: "2026-10-28" });

  const v = validateMarketRows(rows, { today: "2026-10-28" });
  assert.equal(v.completeness, "partial", "雙市場皆有但總量不足門檻時應為 partial");
});

test("Scenario 26: [問題D] 第一筆無效、第二筆有效且代碼相同，有效資料必須被採納", () => {
  const dirty = [
    { code: "2330", name: "台積電無效價", price: -10, vol: 100, date: "2026-10-28" }, // 無效價格
    { code: "2330", name: "台積電有效價", price: 1050, vol: 200, date: "2026-10-28" }  // 後續有效
  ];

  const v = validateMarketRows(dirty, { today: "2026-10-28" });
  assert.equal(v.validRows.length, 1, "有效資料應成功採納");
  assert.equal(v.validRows[0].price, 1050);
  assert.equal(v.invalidCount, 1, "無效第一筆應計入 invalidCount");
  assert.equal(v.dupCount, 0, "第一筆無效未被納入，故不應算成重複");
});

test("Scenario 27: [問題D] 第一筆有效、第二筆無效且代碼相同，保留第一筆有效資料", () => {
  const dirty = [
    { code: "2330", name: "台積電有效價", price: 1050, vol: 200, date: "2026-10-28" },
    { code: "2330", name: "台積電無效價", price: -10, vol: 100, date: "2026-10-28" }
  ];

  const v = validateMarketRows(dirty, { today: "2026-10-28" });
  assert.equal(v.validRows.length, 1);
  assert.equal(v.validRows[0].price, 1050);
  assert.equal(v.invalidCount, 1);
  assert.equal(v.dupCount, 0);
});

test("Scenario 28: [問題D] 兩筆皆有效但價格不同，依策略保留成交量較大者並記錄 dupCount", () => {
  const dirty = [
    { code: "2330", name: "台積電小量", price: 1045, vol: 100, date: "2026-10-28" },
    { code: "2330", name: "台積電大量", price: 1050, vol: 500, date: "2026-10-28" }
  ];

  const v = validateMarketRows(dirty, { today: "2026-10-28" });
  assert.equal(v.validRows.length, 1);
  assert.equal(v.validRows[0].price, 1050, "應保留成交量較大之價格");
  assert.equal(v.dupCount, 1);
  assert.equal(v.invalidCount, 0);
});

test("Scenario 29: [問題D] 類股指數重複名稱，第一筆收盤價無效、第二筆有效時成功解析", () => {
  const dirtyMi = [
    { 日期: "1151028", 指數: "半導體類指數", 收盤指數: "-", 漲跌: "+", 漲跌點數: "0" }, // 無效收盤
    { 日期: "1151028", 指數: "半導體類指數", 收盤指數: "1,250.00", 漲跌: "+", 漲跌點數: "15.00", 漲跌百分比: "1.21" } // 有效收盤
  ];

  const res = parseMiIndex(dirtyMi);
  assert.equal(res.length, 1, "無效第一筆不應阻礙第二筆有效指數採納");
  assert.equal(res[0].name, "半導體類指數");
  assert.equal(res[0].close, 1250.00);
});

test("Scenario 30: [問題E] fetchMiIndex(targetDate) 指定未來日期時拒絕並標記降級", async () => {
  const res = await fetchMiIndex("2099-01-01", {
    getJson: async () => [
      { 日期: "1151028", 指數: "發行量加權股價指數", 收盤指數: "23,000.00" }
    ],
    now: new Date("2026-10-28T02:00:00Z")
  });

  assert.equal(res.dateVerified, false, "未來日期之查詢不可被標記為 dateVerified: true");
  assert.ok(res.source.includes("降級") || res.source.includes("未驗證"));
});

test("Scenario 31: [問題F] 依賴注入 isHoliday 生效，將平日盤中時段覆蓋為 closed", async () => {
  // 週三 10:30 本應為 open，若注入 isHoliday 判定為假日，必須回傳 closed
  const now = new Date("2026-10-28T02:30:00Z"); // 週三
  const isHoliday = iso => iso === "2026-10-28";

  let misCalled = false;
  const mockFetcher = async () => [
    { code: "2330", name: "台積電", market: "上市", price: 1050, vol: 10, date: "2026-10-27" }
  ];
  const mockMis = async () => { misCalled = true; return []; };
  const mockRwd = async (dStr) => {
    const m = new Map([["2330", { name: "台積電", market: "上市", p: 1050, pct: 0, v: 10 }]]);
    m.date = "2026-10-27";
    m.isSourceDateMatched = (dStr === "20261027");
    m.dateVerified = true;
    return m;
  };

  const res = await marketRows({
    now,
    today: "2026-10-28",
    isHoliday,
    fetcher: mockFetcher,
    misFetcher: mockMis,
    rwdFetcher: mockRwd
  });

  assert.equal(misCalled, false, "休市日時絕對不可呼叫 MIS 盤中查詢");
  assert.equal(res.live, false);
  assert.equal(res.dataStatus, "delayed");
});

test("Scenario 32: [問題F] 依賴注入自訂參數時，隔離快取不污染正式環境快取", async () => {
  const customNow = new Date("2026-10-28T02:00:00Z");
  const base1 = [{ code: "2330", name: "台積電", market: "上市", price: 1050, vol: 10, date: "2026-10-28" }];
  const base2 = [{ code: "2454", name: "聯發科", market: "上市", price: 1300, vol: 20, date: "2026-10-28" }];

  const r1 = await marketRows({ now: customNow, fetcher: async () => base1 });
  const r2 = await marketRows({ now: customNow, fetcher: async () => base2 });

  assert.equal(r1.rows[0].code, "2330");
  assert.equal(r2.rows[0].code, "2454", "注入自訂 fetcher 時不應被 memo 命中舊結果");
});

// =========================================================================
// P1 缺失修復深度驗證套件：缺日期列排除、覆蓋率判定與日期 metadata 全鏈路傳遞
// =========================================================================

test("Scenario 33: [P1-1 驗證] validateMarketRows 嚴格排除缺日期資料列 (null, undefined, 空字串) 並計入 invalidCount", () => {
  const today = "2026-10-28";
  const makeRow = (i, m, d) => ({ code: String(1000 + i), name: `股${i}`, market: m, price: 100, vol: 50, date: d });

  // A. 全部 1800 筆資料日期有效且一致 (上市 1000 檔 + 上櫃 800 檔)
  const listA = [];
  for (let i = 0; i < 1000; i++) listA.push(makeRow(i, "上市", today));
  for (let i = 1000; i < 1800; i++) listA.push(makeRow(i, "上櫃", today));
  const resA = validateMarketRows(listA, { today });
  assert.equal(resA.validRows.length, 1800);
  assert.equal(resA.invalidCount, 0);
  assert.equal(resA.dateVerified, true);
  assert.equal(resA.dateConsistent, true);
  assert.equal(resA.completeness, "complete");
  assert.equal(resA.coverage.got, 1800);
  assert.equal(resA.coverage.want, 1800);

  // B. 1800 筆中只有 1 筆缺少日期 (date: null)
  const listB = [];
  for (let i = 0; i < 999; i++) listB.push(makeRow(i, "上市", today));
  listB.push(makeRow(999, "上市", null)); // 缺少日期
  for (let i = 1000; i < 1800; i++) listB.push(makeRow(i, "上櫃", today));
  const resB = validateMarketRows(listB, { today });
  assert.equal(resB.invalidCount, 1, "缺少日期的資料列必須被計入 invalidCount");
  assert.equal(resB.validRows.length, 1799, "有效資料列長度應為 1799，不得包含缺日期之列");
  assert.equal(resB.validRows.some(r => r.code === "1999"), false, "代碼 1999 缺日期不得混入 validRows");
  assert.equal(resB.dateVerified, true, "剩餘 1799 筆資料日期一致且經確認");
  assert.equal(resB.completeness, "complete", "1799 筆仍大於雙市場門檻，完整度維持 complete");

  // C. 多筆缺少日期 (上市 300 檔缺日期、上櫃 200 檔缺日期，有效剩 1300 檔 < 1400)
  const listC = [];
  for (let i = 0; i < 700; i++) listC.push(makeRow(i, "上市", today));
  for (let i = 700; i < 1000; i++) listC.push(makeRow(i, "上市", undefined)); // 300 筆 undefined
  for (let i = 1000; i < 1600; i++) listC.push(makeRow(i, "上櫃", today));
  for (let i = 1600; i < 1800; i++) listC.push(makeRow(i, "上櫃", "")); // 200 筆空字串
  const resC = validateMarketRows(listC, { today });
  assert.equal(resC.invalidCount, 500, "500 筆缺日期或空字串均計入 invalidCount");
  assert.equal(resC.validRows.length, 1300);
  assert.equal(resC.completeness, "partial", "有效筆數 1300 低於全市場門檻 1400 時，completeness 降級為 partial");
  assert.equal(resC.coverage.got, 1300);
  assert.equal(resC.coverage.want, 1800);
  assert.ok(resC.coverage.got < resC.coverage.want * 0.95, "覆蓋率不足 95%");

  // D. 上市日期一致 (2026-10-28)，但上櫃日期不同 (2026-10-27)
  const listD = [];
  for (let i = 0; i < 1000; i++) listD.push(makeRow(i, "上市", "2026-10-28"));
  for (let i = 1000; i < 1800; i++) listD.push(makeRow(i, "上櫃", "2026-10-27"));
  const resD = validateMarketRows(listD, { today: "2026-10-28" });
  assert.equal(resD.dateConsistent, false, "上市櫃日期不同時，dateConsistent 必須為 false");
  assert.equal(resD.dateVerified, false, "上市櫃日期不一致時，不可將 dateVerified 標為 true");
  assert.equal(resD.completeness, "degraded", "跨市場日期不一致時，完整度降級為 degraded");

  // E. 異常日期 (未來日期、2026-02-30 非法日曆、空值、字串異常)
  const listE = [
    makeRow(1, "上市", "2099-12-31"),
    makeRow(2, "上市", "2026-02-30"),
    makeRow(3, "上市", ""),
    makeRow(4, "上市", null),
    makeRow(5, "上市", undefined),
    makeRow(6, "上市", "INVALID_DATE"),
    makeRow(7, "上市", "2026-10-28")
  ];
  const resE = validateMarketRows(listE, { today: "2026-10-28" });
  assert.equal(resE.invalidCount, 6, "6 筆異常/缺日期均被判定為 invalid");
  assert.equal(resE.validRows.length, 1, "僅代碼 1007 有效日期留存");
  assert.equal(resE.validRows[0].code, "1007");

  // F. 全部資料皆無日期
  const listF = [makeRow(1, "上市", null), makeRow(2, "上櫃", undefined)];
  const resF = validateMarketRows(listF, { today: "2026-10-28" });
  assert.equal(resF.validRows.length, 0);
  assert.equal(resF.completeness, "empty");
  assert.equal(resF.dateVerified, false);
  assert.equal(resF.dateConsistent, false);
});

test("Scenario 34: [P1-2 驗證] marketRows() 各來源路徑完整保留 dateConsistent 與 dateVerified", async () => {
  const now = new Date("2026-10-28T02:00:00Z"); // 盤中 10:00
  const today = "2026-10-28";

  // 1. MIS 成功路徑：dateConsistent 必須為 true 且 dateVerified 必須為 true
  const prevMock = [];
  for (let i = 1000; i < 2000; i++) prevMock.push({ code: String(i), name: `上市${i}`, market: "上市", price: 100, vol: 10, date: today });
  for (let i = 3000; i < 3800; i++) prevMock.push({ code: String(i), name: `上櫃${i}`, market: "上櫃", price: 50, vol: 10, date: today });
  const misMock = async (chs) => chs.map(ch => {
    const code = ch.split("_")[1].split(".")[0];
    const isTse = ch.startsWith("tse");
    return {
      c: code,
      n: `名稱${code}`,
      ex: isTse ? "tse" : "otc",
      z: "100",
      y: "99",
      v: "1000",
      d: "20261028",
      t: "09:59:55" // MIS 一定會帶最後成交時間 t
    };
  });

  const resMis = await marketRows({ now, today, fetcher: async () => prevMock, misFetcher: misMock });
  assert.equal(resMis.dateVerified, true, "MIS 成功時 dateVerified 必須為 true");
  assert.equal(resMis.dateConsistent, true, "MIS 雙市場一致時 dateConsistent 必須為 true");
  assert.equal(resMis.dataStatus, "live");

  // 2. 最近收盤探測成功路徑：dateConsistent 與 dateVerified 必須完整傳遞
  const rwdMock = async () => {
    const m = new Map();
    for (let i = 1000; i < 2000; i++) m.set(String(i), { name: `上市${i}`, market: "上市", p: 100, pct: 1.0, v: 100 });
    for (let i = 3000; i < 3800; i++) m.set(String(i), { name: `上櫃${i}`, market: "上櫃", p: 50, pct: 0.5, v: 50 });
    m.date = "2026-10-27";
    m.isSourceDateMatched = true;
    m.dateVerified = true;
    m.dateConsistent = true;
    return m;
  };
  const resClose = await marketRows({ now: new Date("2026-10-28T08:00:00Z"), today, fetcher: async () => [], rwdFetcher: rwdMock });
  assert.equal(resClose.dateVerified, true);
  assert.equal(resClose.dateConsistent, true);
  assert.equal(resClose.dataStatus, "delayed"); // 非今日收盤，標記 delayed

  // 3. 上市櫃日期不一致時：
  // 3a. MIS 僅有上市為今日資料（上櫃日期不符被過濾）：dateConsistent 必須為 false，completeness 為 partial
  const misInconsistent = async (chs) => chs.map(ch => {
    const code = ch.split("_")[1].split(".")[0];
    const isTse = ch.startsWith("tse");
    return {
      c: code,
      n: `名稱${code}`,
      ex: isTse ? "tse" : "otc",
      z: "100",
      y: "99",
      v: "1000",
      d: isTse ? "20261028" : "20261027"
    };
  });
  const resInconsistent = await marketRows({ now, today, fetcher: async () => prevMock, misFetcher: misInconsistent });
  assert.equal(resInconsistent.dateConsistent, false, "上市櫃日期不一致時，marketRows 回傳物件 dateConsistent 必須為 false");
  assert.equal(resInconsistent.completeness, "partial_tse_only", "僅上市為今日資料時 completeness 為 partial_tse_only");

  // 3b. OpenAPI 來源上市櫃跨市場日期不一致：dateConsistent 與 dateVerified 皆為 false，completeness 為 degraded
  const inconsistentPrev = [];
  for (let i = 1000; i < 2000; i++) inconsistentPrev.push({ code: String(i), name: `市${i}`, market: "上市", price: 100, vol: 10, date: "2026-10-28" });
  for (let i = 3000; i < 3800; i++) inconsistentPrev.push({ code: String(i), name: `櫃${i}`, market: "上櫃", price: 50, vol: 10, date: "2026-10-27" });
  const resInconsistentOpenApi = await marketRows({
    now: new Date("2026-10-28T08:00:00Z"),
    today,
    fetcher: async () => inconsistentPrev,
    rwdFetcher: async () => null
  });
  assert.equal(resInconsistentOpenApi.dateConsistent, false, "OpenAPI 跨市場日期不一致時 dateConsistent 必須為 false");
  assert.equal(resInconsistentOpenApi.dateVerified, false, "OpenAPI 跨市場日期不一致時 dateVerified 必須為 false");
  assert.equal(resInconsistentOpenApi.completeness, "degraded", "OpenAPI 跨市場日期不一致時 completeness 降級為 degraded");

  // 4. OpenAPI 回退路徑：保留 dateConsistent 與 dateVerified
  const resOpenApi = await marketRows({
    now: new Date("2026-10-28T08:00:00Z"),
    today,
    fetcher: async () => prevMock,
    rwdFetcher: async () => null // 強制跳過收盤探測回退到 OpenAPI
  });
  assert.equal(resOpenApi.dateConsistent, true, "OpenAPI 回退時應保留 dateConsistent");
  assert.equal(resOpenApi.dateVerified, true, "OpenAPI 回退時應保留 dateVerified");
});

test("Scenario 35: [P1-2 驗證] /api/market 與 /api/hot 頂層 JSON 完整回傳 dateVerified 與 dateConsistent", async () => {
  // 動態載入 market handler
  const marketMod = await import("../api/_lib/market.js");
  const hotMod = await import("../api/_lib/hot.js");

  // 模擬 req, res 接收 JSON 結果
  function createMockRes() {
    const r = {
      statusCode: 200,
      headers: {},
      jsonPayload: null,
      status(c) { r.statusCode = c; return r; },
      setHeader(k, v) { r.headers[k] = v; return r; },
      json(j) { r.jsonPayload = j; return r; }
    };
    return r;
  }

  // 測試不連外部網站（AGENTS.md）：大盤資料用注入的假資料，其他對外請求一律擋掉（handler 用 allSettled，擋掉的部分會略過）
  const fake = async () => ({ rows: [{ code: "2330", name: "台積電", market: "上市", price: 1000, chg: 10, chgPct: 1, vol: 1000, value: 1e9, date: "2026-10-28" }, { code: "6488", name: "環球晶", market: "上櫃", price: 500, chg: -5, chgPct: -1, vol: 500, value: 2.5e8, date: "2026-10-28" }],
    date: "2026-10-28", live: false, source: "測試", dateVerified: true, dateConsistent: true, completeness: "complete", dataStatus: "confirmed", coverage: null });
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("測試不連外部網站"); };
  try {
  const resMarket = createMockRes();
  await marketMod.default({ query: {}, headers: {} }, resMarket, { marketFetcher: fake });
  assert.equal(resMarket.statusCode, 200);
  assert.ok("dateVerified" in resMarket.jsonPayload, "/api/market 必須包含 dateVerified 頂層欄位");
  assert.ok("dateConsistent" in resMarket.jsonPayload, "/api/market 必須包含 dateConsistent 頂層欄位");
  assert.ok("indicesVerified" in resMarket.jsonPayload, "indicesVerified 必須存在且獨立");
  assert.ok("completeness" in resMarket.jsonPayload, "completeness 欄位必須存在");
  assert.ok("coverage" in resMarket.jsonPayload, "coverage 欄位必須存在");

  const resHot = createMockRes();
  await hotMod.default({ query: { market: "tw", type: "value" } }, resHot, { marketFetcher: fake });
  assert.equal(resHot.statusCode, 200);
  assert.ok("dateVerified" in resHot.jsonPayload, "/api/hot 必須包含 dateVerified 頂層欄位");
  assert.ok("dateConsistent" in resHot.jsonPayload, "/api/hot 必須包含 dateConsistent 頂層欄位");
  } finally { globalThis.fetch = realFetch; }
});


test("Scenario 36: [第三輪驗證] marketRows() Fugle 快照全情境 Mock 測試 (健全、部分、日期異常、降級)", async () => {
  const now = new Date("2026-10-28T02:00:00Z"); // 盤中 10:00
  const today = "2026-10-28";
  const tsTodayMicros = new Date("2026-10-28T02:00:00Z").getTime() * 1000;
  const tsYestMicros = new Date("2026-10-27T02:00:00Z").getTime() * 1000;

  const makeFugleData = (start, count, market, ts) => {
    const list = [];
    for (let i = start; i < start + count; i++) {
      list.push({
        symbol: String(i),
        name: `${market}${i}`,
        closePrice: 100,
        tradeVolume: 10,
        tradeValue: 1000000,
        lastUpdated: ts
      });
    }
    return list;
  };

  // 1. 上市與上櫃完整且日期一致：live: true, dataStatus: 'live', completeness: 'complete'
  const getFugleComplete = async (url) => {
    if (url.includes("TSE")) return { data: makeFugleData(1000, 1000, "上市", tsTodayMicros) };
    return { data: makeFugleData(3000, 800, "上櫃", tsTodayMicros) };
  };
  const resComplete = await marketRows({ now, today, fugleFetcher: getFugleComplete });
  assert.equal(resComplete.live, true);
  assert.equal(resComplete.dataStatus, "live");
  assert.equal(resComplete.completeness, "complete");
  assert.equal(resComplete.dateVerified, true);
  assert.equal(resComplete.dateConsistent, true);
  assert.equal(resComplete.coverage.got, 1800);

  // 2. 只有上市資料（上櫃為空）：dataStatus 必須為 degraded，絕對不得為 live
  const getFugleTseOnly = async (url) => {
    if (url.includes("TSE")) return { data: makeFugleData(1000, 1000, "上市", tsTodayMicros) };
    return { data: [] };
  };
  const resTseOnly = await marketRows({ now, today, fugleFetcher: getFugleTseOnly });
  assert.equal(resTseOnly.live, true, "時效性仍為盤中即時");
  assert.notEqual(resTseOnly.dataStatus, "live", "資料不完整時 dataStatus 絕對不可宣告為 live");
  assert.notEqual(resTseOnly.dataStatus, "confirmed");
  assert.equal(resTseOnly.dataStatus, "degraded");
  assert.equal(resTseOnly.completeness, "partial_tse_only");
  assert.equal(resTseOnly.dateConsistent, false);
  assert.equal(resTseOnly.dateVerified, true);

  // 3. 只有上櫃資料（上市為空）：dataStatus 絕對不得為 live
  const getFugleOtcOnly = async (url) => {
    if (url.includes("TSE")) return { data: [] };
    return { data: makeFugleData(3000, 800, "上櫃", tsTodayMicros) };
  };
  const resOtcOnly = await marketRows({ now, today, fugleFetcher: getFugleOtcOnly });
  assert.equal(resOtcOnly.live, true);
  assert.notEqual(resOtcOnly.dataStatus, "live");
  assert.equal(resOtcOnly.dataStatus, "degraded");
  assert.equal(resOtcOnly.completeness, "partial_otc_only");
  assert.equal(resOtcOnly.dateConsistent, false);

  // 4. 部分資料缺日期（上市 500 檔缺 lastUpdated，有效 500 + 400 = 900 檔）
  const getFugleMissingDate = async (url) => {
    if (url.includes("TSE")) {
      const good = makeFugleData(1000, 500, "上市", tsTodayMicros);
      const nodate = makeFugleData(1500, 500, "上市", null);
      return { data: [...good, ...nodate] };
    }
    return { data: makeFugleData(3000, 400, "上櫃", tsTodayMicros) };
  };
  const resMissingDate = await marketRows({ now, today, fugleFetcher: getFugleMissingDate });
  assert.equal(resMissingDate.coverage.got, 900);
  assert.equal(resMissingDate.completeness, "partial");
  assert.notEqual(resMissingDate.dataStatus, "live", "總覆蓋率不足時不得為 live");
  assert.equal(resMissingDate.dataStatus, "partial");

  // 5. 資料日期為舊日期 (2026-10-27)
  const getFugleYesterday = async () => ({
    data: [
      ...makeFugleData(1000, 1000, "上市", tsYestMicros),
      ...makeFugleData(3000, 800, "上櫃", tsYestMicros)
    ]
  });
  const resYesterday = await marketRows({ now, today, fugleFetcher: getFugleYesterday });
  assert.equal(resYesterday.live, false, "非當日資料 live 必須為 false");
  assert.equal(resYesterday.dataStatus, "delayed", "舊資料必須標示 delayed，絕對不可標示 confirmed");
  assert.notEqual(resYesterday.dataStatus, "confirmed");
  assert.equal(resYesterday.date, "2026-10-27");

  // 6. 快照資料不足 (<500 檔) 拋錯或平順 fallback
  const getFugleSmall = async () => ({ data: makeFugleData(1000, 50, "上市", tsTodayMicros) });
  const prevMock = makeFugleData(1000, 1000, "上市", tsTodayMicros).map(r => ({ code: r.symbol, name: r.name, market: "上市", price: 100, vol: 10, date: today }));
  const resFallback = await marketRows({ now, today, fugleFetcher: getFugleSmall, fetcher: async () => prevMock, rwdFetcher: async () => null });
  assert.ok(resFallback.source.includes("OpenAPI") || resFallback.source.includes("MIS"), "快照不足 500 檔時應平順 fallback");
});

test("Scenario 37: [第三輪驗證] /api/screen 契約注入測試 (包含 dateVerified/dateConsistent 嚴格布林值驗證)", async () => {
  const screenMod = await import("../api/_lib/screen.js");

  function createMockRes() {
    const r = {
      statusCode: 200,
      headers: {},
      jsonPayload: null,
      status(c) { r.statusCode = c; return r; },
      setHeader(k, v) { r.headers[k] = v; return r; },
      json(j) { r.jsonPayload = j; return r; }
    };
    return r;
  }

  // A. 模擬注入降級行情 (dateVerified: false, dateConsistent: false)
  const degradedFetcher = async () => ({
    rows: [{ code: "2330", name: "台積電", price: 1000, chgPct: 1.5, date: "2026-10-28" }],
    date: "2026-10-28",
    live: true,
    time: "10:30:00",
    source: "富果行情快照",
    completeness: "degraded",
    dataStatus: "degraded",
    coverage: { got: 500, want: 1800 },
    dateVerified: false,
    dateConsistent: false
  });
  const resDegraded = createMockRes();
  await screenMod.default({ query: {} }, resDegraded, { marketFetcher: degradedFetcher });
  assert.equal(resDegraded.statusCode, 200);
  assert.strictEqual(resDegraded.jsonPayload.dateVerified, false, "dateVerified: false 必須完整保留為 false");
  assert.strictEqual(resDegraded.jsonPayload.dateConsistent, false, "dateConsistent: false 必須完整保留為 false");
  assert.strictEqual(resDegraded.jsonPayload.dataStatus, "degraded");
  assert.strictEqual(resDegraded.jsonPayload.completeness, "degraded");

  // B. 模擬注入健康行情 (dateVerified: true, dateConsistent: true)
  const healthyFetcher = async () => ({
    rows: [{ code: "2330", name: "台積電", price: 1000, chgPct: 1.5, date: "2026-10-28" }],
    date: "2026-10-28",
    live: true,
    time: "10:30:00",
    source: "證交所 MIS",
    completeness: "complete",
    dataStatus: "live",
    coverage: { got: 1800, want: 1800 },
    dateVerified: true,
    dateConsistent: true
  });
  const resHealthy = createMockRes();
  await screenMod.default({ query: {} }, resHealthy, { marketFetcher: healthyFetcher });
  assert.strictEqual(resHealthy.jsonPayload.dateVerified, true);
  assert.strictEqual(resHealthy.jsonPayload.dateConsistent, true);
  assert.strictEqual(resHealthy.jsonPayload.dataStatus, "live");
  assert.strictEqual(resHealthy.jsonPayload.completeness, "complete");

  // C. 模擬舊版未定義情境 (dateVerified: undefined)
  const undefinedFetcher = async () => ({
    rows: [{ code: "2330", name: "台積電", price: 1000, chgPct: 1.5, date: "2026-10-28" }],
    date: "2026-10-28",
    live: true
  });
  const resUndef = createMockRes();
  await screenMod.default({ query: {} }, resUndef, { marketFetcher: undefinedFetcher });
  assert.strictEqual(resUndef.jsonPayload.dateVerified, null, "未提供時安全回退至 null");
  assert.strictEqual(resUndef.jsonPayload.dateConsistent, null, "未提供時安全回退至 null");
});

test("Scenario 38: [第三輪驗證] 反矛盾契約測試 (四來源路徑於降級情境嚴格禁止回傳 live 或 confirmed)", async () => {
  const now = new Date("2026-10-28T02:00:00Z"); // 盤中
  const today = "2026-10-28";
  const prevMock = [];
  for (let i = 1000; i < 2000; i++) prevMock.push({ code: String(i), name: `市${i}`, market: "上市", price: 100, vol: 10, date: today });
  for (let i = 3000; i < 3800; i++) prevMock.push({ code: String(i), name: `櫃${i}`, market: "上櫃", price: 50, vol: 10, date: today });

  // 1. MIS degraded 情境：只有上市今日資料（上櫃昨日被過濾）
  const misInconsistent = async (chs) => chs.map(ch => ({
    c: ch.split("_")[1].split(".")[0],
    n: "名",
    ex: ch.startsWith("tse") ? "tse" : "otc",
    z: "100", y: "99", v: "1000",
    d: ch.startsWith("tse") ? "20261028" : "20261027"
  }));
  const resMis = await marketRows({ now, today, fetcher: async () => prevMock, misFetcher: misInconsistent });
  assert.notEqual(resMis.dataStatus, "live", "MIS 上市櫃日期不一致時 dataStatus 絕對不可為 live");
  assert.notEqual(resMis.dataStatus, "confirmed");
  assert.equal(resMis.dataStatus, "degraded");
  assert.equal(resMis.live, true, "時效性旗標仍保留盤中即時輪詢");
  assert.equal(resMis.dateConsistent, false);
  assert.equal(resMis.completeness, "partial_tse_only");

  // 2. Recent close degraded 情境：收盤日期為今日，但上市櫃不一致
  const rwdDegraded = async () => {
    const map = new Map();
    for (let i = 1000; i < 1800; i++) map.set(String(i), { name: `市${i}`, market: "上市", p: 100, pct: 1.0, v: 100 });
    map.date = today;
    map.isSourceDateMatched = true;
    map.dateVerified = true;
    map.dateConsistent = false; // 不一致
    return map;
  };
  const resRwd = await marketRows({ now: new Date("2026-10-28T08:00:00Z"), today, fetcher: async () => [], rwdFetcher: rwdDegraded });
  assert.notEqual(resRwd.dataStatus, "confirmed", "RWD 上市櫃日期不一致時 dataStatus 絕對不可標記 confirmed");
  assert.notEqual(resRwd.dataStatus, "live");
  assert.equal(resRwd.dataStatus, "degraded");
  assert.equal(resRwd.dateConsistent, false);

  // 3. /api/market 與 /api/hot 透過注入 degraded marketFetcher 驗證頂層 JSON 絕不回傳矛盾狀態
  const marketMod = await import("../api/_lib/market.js");
  const hotMod = await import("../api/_lib/hot.js");
  function createMockRes() {
    const r = {
      statusCode: 200,
      jsonPayload: null,
      status(c) { r.statusCode = c; return r; },
      setHeader() { return r; },
      json(j) { r.jsonPayload = j; return r; }
    };
    return r;
  }

  const degradedMktFetcher = async () => resMis;
  const resMktJson = createMockRes();
  await marketMod.default({ query: {}, headers: {} }, resMktJson, { marketFetcher: degradedMktFetcher });
  assert.notEqual(resMktJson.jsonPayload.dataStatus, "live", "頂層 /api/market 在降級時 dataStatus 絕對不得為 live");
  assert.notEqual(resMktJson.jsonPayload.dataStatus, "confirmed");
  assert.strictEqual(resMktJson.jsonPayload.dataStatus, "degraded");
  assert.strictEqual(resMktJson.jsonPayload.dateConsistent, false);
  assert.strictEqual(resMktJson.jsonPayload.completeness, "partial_tse_only");

  const resHotJson = createMockRes();
  await hotMod.default({ query: { market: "tw", type: "value" } }, resHotJson, { marketFetcher: degradedMktFetcher });
  assert.notEqual(resHotJson.jsonPayload.dataStatus, "live", "頂層 /api/hot 在降級時 dataStatus 絕對不得為 live");
  assert.notEqual(resHotJson.jsonPayload.dataStatus, "confirmed");
  assert.strictEqual(resHotJson.jsonPayload.dataStatus, "degraded");
  assert.strictEqual(resHotJson.jsonPayload.dateConsistent, false);
});

test("Scenario 39: [第三輪驗證] Metadata 三態 (undefined, null, false, true) 邊界契約測試", async () => {
  const marketMod = await import("../api/_lib/market.js");
  function createMockRes() {
    const r = {
      statusCode: 200,
      jsonPayload: null,
      status(c) { r.statusCode = c; return r; },
      setHeader() { return r; },
      json(j) { r.jsonPayload = j; return r; }
    };
    return r;
  }

  const testState = async (val) => {
    const fetcher = async () => ({
      rows: [{ code: "2330", name: "台積電", price: 1000, market: "上市", date: "2026-10-28" }],
      date: "2026-10-28",
      live: true,
      completeness: val === true ? "complete" : "degraded",
      dataStatus: val === true ? "live" : "degraded",
      dateVerified: val,
      dateConsistent: val
    });
    const res = createMockRes();
    await marketMod.default({ query: {}, headers: {} }, res, { marketFetcher: fetcher });
    return res.jsonPayload;
  };

  // 1. 明確失敗 false
  const rFalse = await testState(false);
  assert.strictEqual(rFalse.dateVerified, false, "false 必須保持嚴格布林值 false");
  assert.strictEqual(rFalse.dateConsistent, false, "false 必須保持嚴格布林值 false");

  // 2. 明確成功 true
  const rTrue = await testState(true);
  assert.strictEqual(rTrue.dateVerified, true, "true 必須保持嚴格布林值 true");
  assert.strictEqual(rTrue.dateConsistent, true, "true 必須保持嚴格布林值 true");

  // 3. 明確未知 null
  const rNull = await testState(null);
  assert.strictEqual(rNull.dateVerified, null, "null 必須保持 null");
  assert.strictEqual(rNull.dateConsistent, null, "null 必須保持 null");

  // 4. 欄位缺失 undefined
  const rUndef = await testState(undefined);
  assert.strictEqual(rUndef.dateVerified, null, "undefined 序列化為 null 避免欄位遺失");
  assert.strictEqual(rUndef.dateConsistent, null, "undefined 序列化為 null 避免欄位遺失");
});

test("Scenario 41: [第四輪可信度一致性驗證] OpenAPI 回退路徑與最近收盤路徑嚴格遵守可信度契約", async () => {
  const nowIntraday = new Date("2026-10-28T02:30:00Z"); // 台北時間 10:30 (盤中)
  const nowAfterHours = new Date("2026-10-28T07:00:00Z"); // 台北時間 15:00 (收盤後)

  // 1. 盤中 MIS 失敗回退最近收盤：live 必須為 false，dataStatus 絕不可為 live 或 confirmed
  const mockRwdYesterday = async () => {
    const m = new Map();
    for (let i = 1000; i < 1600; i++) {
      m.set(String(i), { name: `市${i}`, market: "上市", p: 100, pct: 1.0, v: 200 });
    }
    m.date = "2026-10-27";
    m.isSourceDateMatched = true;
    m.dateVerified = true;
    return m;
  };

  const resRecentClose = await marketRows({
    now: nowIntraday,
    today: "2026-10-28",
    fetcher: async () => [{ code: "2330", name: "台積電", market: "上市", date: "2026-10-27" }],
    misFetcher: async () => { throw new Error("MIS 503"); },
    rwdFetcher: mockRwdYesterday
  });

  assert.equal(resRecentClose.live, false, "回退最近收盤時 live 必須為 false");
  assert.equal(resRecentClose.dataStatus, "stale", "盤中回退昨日收盤時 dataStatus 必須為 stale（交易日期過舊）");
  assert.notEqual(resRecentClose.dataStatus, "live", "回退收盤絕對不得冒充 live");
  assert.notEqual(resRecentClose.dataStatus, "confirmed", "盤中回退昨日收盤絕對不得標為 confirmed");

  // 2. 收盤後 (15:00) 取得當日收盤，但僅上市無上櫃 (partial_tse_only)：dataStatus 絕不可為 confirmed
  const mockRwdPartialToday = async () => {
    const m = new Map();
    for (let i = 1000; i < 1850; i++) {
      m.set(String(i), { name: `市${i}`, market: "上市", p: 100, pct: 1.0, v: 200 });
    }
    m.date = "2026-10-28";
    m.isSourceDateMatched = true;
    m.dateVerified = true;
    return m;
  };

  const resPartialToday = await marketRows({
    now: nowAfterHours,
    today: "2026-10-28",
    fetcher: async () => [],
    rwdFetcher: mockRwdPartialToday
  });

  assert.equal(resPartialToday.live, false);
  assert.equal(resPartialToday.completeness, "partial_tse_only");
  assert.equal(resPartialToday.dateConsistent, false);
  assert.notEqual(resPartialToday.dataStatus, "confirmed", "不完整收盤資料絕對不可宣告 confirmed");
  assert.equal(resPartialToday.dataStatus, "degraded", "跨市場缺失時 dataStatus 必須為 degraded");

  // 3. OpenAPI 備援路徑：在任何情境下 live 均為 false，dataStatus 必為 delayed
  const openApiRows = [];
  for (let i = 1000; i < 2000; i++) openApiRows.push({ code: String(i), name: `市${i}`, market: "上市", date: "2026-10-27" });
  for (let i = 3000; i < 3800; i++) openApiRows.push({ code: String(i), name: `櫃${i}`, market: "上櫃", date: "2026-10-27" });

  const resOpenApi = await marketRows({
    now: nowIntraday,
    today: "2026-10-28",
    fetcher: async () => openApiRows,
    misFetcher: async () => { throw new Error("MIS 503"); },
    rwdFetcher: async () => null // 強制跳過收盤探測
  });

  assert.equal(resOpenApi.live, false, "OpenAPI 回退路徑 live 必為 false");
  assert.equal(resOpenApi.dataStatus, "stale", "盤中 OpenAPI 回退（前一交易日）dataStatus 必為 stale（交易日期過舊）");
  // 非盤中（收盤後）OpenAPI 回退維持 delayed
  const resOpenApiAfter = await marketRows({ now: nowAfterHours, today: "2026-10-28", fetcher: async () => openApiRows, rwdFetcher: async () => null });
  assert.equal(resOpenApiAfter.live, false);
  assert.equal(resOpenApiAfter.dataStatus, "delayed", "收盤後 OpenAPI 回退路徑 dataStatus 必為 delayed");
  assert.notEqual(resOpenApi.dataStatus, "live", "OpenAPI 絕不可標記為 live");
  assert.notEqual(resOpenApi.dataStatus, "confirmed", "OpenAPI 絕不可標記為 confirmed");
  assert.ok(resOpenApi.source.includes("OpenAPI"));
});


test("Scenario 42: 全市場 complete 必須達到 95% 覆蓋率，基準清單不得縮小分母", () => {
  const today = "2026-10-28";
  const makeRows = (tseCount, otcCount) => {
    const rows = [];
    for (let i = 0; i < tseCount; i++) rows.push({ code: String(1000 + i), name: `上市${i}`, market: "上市", price: 100, vol: 10, date: today });
    for (let i = 0; i < otcCount; i++) rows.push({ code: String(3000 + i), name: `上櫃${i}`, market: "上櫃", price: 50, vol: 10, date: today });
    return rows;
  };

  const belowThresholdRows = makeRows(800, 600);
  const expectedCodes = new Set(belowThresholdRows.map(row => row.code));
  const belowThreshold = validateMarketRows(belowThresholdRows, { expectedCodes, today });
  assert.equal(belowThreshold.coverage.want, 1800, "基準清單不得取代全市場母體分母");
  assert.equal(belowThreshold.coverage.ratio, +(1400 / 1800).toFixed(4));
  assert.equal(belowThreshold.completeness, "partial", "1400 / 1800 未達 95%，不可標記 complete");
  assert.equal(belowThreshold.coverage.benchmark.isBenchmarkComplete, false, "1400 檔基準清單也未達全市場 95% 門檻");

  // 方案 B：上市、上櫃各自也要 95%（950／1000、760／800），合計 1710 剛好是全市場 95%
  const lopsided = validateMarketRows(makeRows(1000, 710), { today });
  assert.equal(lopsided.coverage.ratio, 0.95); assert.equal(lopsided.completeness, "partial", "全市場剛好 95% 但上櫃只有 710／800：不算完整（P2-03 方案 B）");
  const atThresholdRows = makeRows(950, 760);
  const atThresholdCodes = new Set(atThresholdRows.map(row => row.code));
  const atThreshold = validateMarketRows(atThresholdRows, { expectedCodes: atThresholdCodes, today });
  assert.equal(atThreshold.coverage.ratio, 0.95);
  assert.equal(atThreshold.coverage.benchmark.isBenchmarkComplete, true, "1710 檔基準清單達全市場 95% 門檻");
  assert.equal(atThreshold.completeness, "complete", "1710 / 1800 恰達 95%、上市櫃各自 95% 且雙市場日期一致時可標記 complete");
});

test("部分成功（稽核 F-04／F-05）：/api/market 列出抓失敗的附帶資料並縮短快取；/api/daily 缺上櫃不快取 30 天、法人未公布標 pending", async () => {
  const mockRes = () => { const r = { statusCode: 200, headers: {}, body: null, status(c) { r.statusCode = c; return r; }, setHeader(k, v) { r.headers[k] = v; return r; }, json(j) { r.body = j; return r; } }; return r; };
  const realFetch = globalThis.fetch;
  try {
    // 測試不連外部網站：大盤用注入的假資料，其他對外請求一律失敗 → 法人、美股、世界指數、產業、新高新低都拿不到
    globalThis.fetch = async () => { throw new Error("測試不連外部網站"); };
    const marketMod = await import("../api/_lib/market.js");
    const fake = async () => ({ rows: [{ code: "2330", name: "台積電", market: "上市", price: 1000, chg: 10, chgPct: 1, vol: 1000, value: 1e9, date: "2026-10-28" }], date: "2026-10-28", live: false, source: "測試", dateVerified: true, dateConsistent: true, completeness: "complete", dataStatus: "confirmed", coverage: null });
    const m = mockRes(); await marketMod.default({ query: {}, headers: {} }, m, { marketFetcher: fake });
    assert.equal(m.body.ok, true);
    assert.deepEqual([...m.body.failed].sort(), ["hilo", "inst", "sectors", "us", "world"].sort(), "抓失敗的附帶資料都要列出來");
    assert.match(m.headers["Cache-Control"], /s-maxage=30\b/, "缺資料時收盤後只快取 30 秒（原本 300 秒）");

    // /api/daily：證交所行情與法人有、上櫃抓不到（過去的日子）
    const MI = { stat: "OK", tables: [{ fields: ["證券代號", "證券名稱", "成交股數", "收盤價", "漲跌(+/-)", "漲跌價差"], data: [["2330", "台積電", "1,000,000", "1000", "+", "10"]] }] };
    const T86 = { stat: "OK", fields: ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數"], data: [["2330", "台積電", "1,000", "2,000", "3,000"]] };
    const NONE = { stat: "很抱歉，沒有符合條件的資料!" };
    const route = map => async u => { const s = String(u); for (const [k, v] of map) if (s.includes(k)) return { ok: true, status: 200, json: async () => v }; throw new Error("測試不連外部網站：" + s); };
    const dailyMod = await import("../api/_lib/daily.js");
    globalThis.fetch = route([["MI_INDEX", MI], ["T86", T86]]);
    const d1 = mockRes(); await dailyMod.default({ query: { date: "20261005" } }, d1);
    assert.equal(d1.body.rows.length, 1); assert.equal(d1.body.tpex, false); assert.deepEqual(d1.body.partial, ["tpex"]);
    assert.doesNotMatch(d1.headers["Cache-Control"], /2592000/, "少了上櫃的結果不能快取 30 天");
    // 行情有、法人還沒公布：不是休市，標 pending
    globalThis.fetch = route([["MI_INDEX", MI], ["T86", NONE]]);
    const d2 = mockRes(); await dailyMod.default({ query: { date: "20261005" } }, d2);
    assert.equal(d2.body.empty, true); assert.equal(d2.body.pending, "inst"); assert.doesNotMatch(d2.headers["Cache-Control"], /2592000/);
    // 真的休市：兩邊都說沒有資料 → 照舊快取 30 天、沒有 pending
    globalThis.fetch = route([["MI_INDEX", NONE], ["T86", NONE]]);
    const d3 = mockRes(); await dailyMod.default({ query: { date: "20261004" } }, d3);
    assert.equal(d3.body.empty, true); assert.equal(d3.body.pending, undefined); assert.match(d3.headers["Cache-Control"], /2592000/);
  } finally { globalThis.fetch = realFetch; }
});

// ==========================================
// P1-01：行情新鮮度要看來源時間（sourceTime），不是伺服器或瀏覽器收到的時間
// ==========================================
import { sourceAt, sourceFresh, SRC_LAG } from "../api/_lib/_fresh.js";
import { deriveDataStatus } from "../api/_lib/_live.js";
import vm from "node:vm";
import fs from "node:fs";

// 前端 core.js 的同一套規則（twSourceFresh、evalDataStatus）載進沙盒
const coreCtx = (() => { const c = { console, Math, Date, JSON, Map, Set, Array, Object, Number, String, isFinite, parseFloat, parseInt, RegExp, Error, Symbol, Intl, globalThis: null, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, documentElement: { classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, style: {} } }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), navigator: {}, location: { search: "", hash: "", href: "" } };
  c.globalThis = c; c.window = c; vm.createContext(c); vm.runInContext(fs.readFileSync(new URL("../learner/core.js", import.meta.url), "utf8"), c); return c; })();
const T = iso => new Date(iso);

test("P1-01 sourceAt：台北時間與 UTC 換算、跨午夜、無效日期時間", () => {
  assert.equal(sourceAt("2026-10-28", "10:30:00"), Date.parse("2026-10-28T02:30:00Z"), "台北 10:30 = UTC 02:30");
  assert.equal(sourceAt("2026-10-28", "00:00:05"), Date.parse("2026-10-27T16:00:05Z"), "台北凌晨是 UTC 前一天");
  assert.equal(sourceAt("2026-10-28", "10:30"), Date.parse("2026-10-28T02:30:00Z"), "可省略秒");
  for (const [d, t] of [["2026-02-30", "10:00:00"], ["2026-10-28", "25:00:00"], ["2026-10-28", "10:61:00"], ["2026-10-28", "abc"], ["20261028", "10:00:00"], ["2026-10-28", "2026-10-28T10:00:00Z"]]) assert.equal(sourceAt(d, t), null, `${d} ${t}`);
});

test("P1-01 sourceFresh：最新、過舊、缺時間、無效、未來、跨午夜；前後端結果一致", () => {
  const now = T("2026-10-28T10:30:05+08:00");
  const cases = [
    [{ dataDate: "2026-10-28", sourceTime: "10:30:00", maxLagMs: SRC_LAG.market }, "fresh"],
    [{ dataDate: "2026-10-28", sourceTime: "10:15:00", maxLagMs: SRC_LAG.market }, "old"],
    [{ dataDate: "2026-10-27", sourceTime: "13:30:00", maxLagMs: SRC_LAG.market }, "old"], // 前一交易日
    [{ dataDate: "2026-10-28", sourceTime: null, maxLagMs: SRC_LAG.market }, "missing"],
    [{ dataDate: null, sourceTime: "10:30:00", maxLagMs: SRC_LAG.market }, "missing"],
    [{ dataDate: "2026-10-28", sourceTime: "99:00:00", maxLagMs: SRC_LAG.market }, "invalid"],
    [{ dataDate: "2026-10-28", sourceTime: "10:40:00", maxLagMs: SRC_LAG.market }, "future"],
    [{ dataDate: "2026-10-28", sourceTime: "10:30:30", maxLagMs: SRC_LAG.market }, "fresh"], // 時鐘差 25 秒內不算未來
    [{ dataDate: "2026-10-28", sourceTime: "09:00:00", maxLagMs: SRC_LAG.quote }, "fresh"], // 個股是最後成交時間，不判斷落後
  ];
  for (const [inp, want] of cases) {
    assert.equal(sourceFresh({ ...inp, now }).state, want, JSON.stringify(inp));
    assert.equal(coreCtx.twSourceFresh({ ...inp, now }).state, want, "前端 twSourceFresh 結果要一樣：" + JSON.stringify(inp));
  }
  // 跨午夜：23:59:50 的資料在隔天 00:00:05 只落後 15 秒
  assert.equal(sourceFresh({ dataDate: "2026-10-28", sourceTime: "23:59:50", now: T("2026-10-29T00:00:05+08:00"), maxLagMs: 60e3 }).state, "fresh");
  assert.equal(sourceFresh({ dataDate: "2026-10-28", sourceTime: "23:59:50", now: T("2026-10-29T00:10:00+08:00"), maxLagMs: 60e3 }).state, "old");
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(TW_SRC_LAG)", coreCtx)), SRC_LAG, "前後端的延遲門檻一樣");
});

test("P1-01 deriveDataStatus：盤中要有新的來源時間才是 live；盤後確認不會變成即時", () => {
  const healthy = { completeness: "complete", dateConsistent: true, dateVerified: true };
  assert.equal(deriveDataStatus({ isLiveSession: true, isToday: true, ...healthy, sourceState: "fresh" }), "live");
  assert.equal(deriveDataStatus({ isLiveSession: true, isToday: true, ...healthy, sourceState: "old" }), "delayed", "日期是今天但來源時間過舊");
  assert.equal(deriveDataStatus({ isLiveSession: true, isToday: true, ...healthy, sourceState: "missing" }), "delayed", "沒有來源時間不能假裝即時");
  assert.equal(deriveDataStatus({ isLiveSession: true, isToday: true, ...healthy }), "delayed", "呼叫端沒給來源時間證據＝沒有證據");
  assert.equal(deriveDataStatus({ isLiveSession: true, isToday: true, ...healthy, sourceState: "future" }), "degraded");
  assert.equal(deriveDataStatus({ isLiveSession: true, isToday: true, ...healthy, sourceState: "invalid" }), "degraded");
  assert.equal(deriveDataStatus({ isLiveSession: true, isToday: true, completeness: "partial", dateConsistent: true, dateVerified: true, sourceState: "fresh" }), "partial", "新鮮但不完整仍然不是 live");
  assert.equal(deriveDataStatus({ isLiveSession: false, isToday: true, ...healthy, sourceState: "fresh" }), "confirmed", "盤後是收盤確認，不是即時");
  assert.equal(deriveDataStatus({ isLiveSession: false, isToday: false, ...healthy, sourceState: "fresh" }), "delayed");
});

// 盤中 MIS：來源時間 t 決定是不是 live
const misBase = date => { const b = []; for (let i = 1000; i < 2000; i++) b.push({ code: String(i), name: `上市${i}`, market: "上市", price: 100, vol: 10, date }); for (let i = 3000; i < 3800; i++) b.push({ code: String(i), name: `上櫃${i}`, market: "上櫃", price: 50, vol: 10, date }); return b; };
const misMock = (t, d = "20261028", f = () => ({})) => async chs => chs.map(ch => { const code = ch.split("_")[1].split(".")[0]; return { c: code, n: `名${code}`, ex: ch.startsWith("tse") ? "tse" : "otc", z: "100", y: "99", v: "1000", d, ...(t ? { t } : {}), ...f(code) }; });
test("P1-01 marketRows（MIS 盤中）：來源時間新→live；過舊、缺時間→delayed；未來時間→degraded", async () => {
  const now = T("2026-10-28T10:30:05+08:00"), today = "2026-10-28", fetcher = async () => misBase(today);
  const fresh = await marketRows({ now, today, fetcher, misFetcher: misMock("10:30:00") });
  assert.deepEqual([fresh.live, fresh.dataStatus, fresh.sourceTime, fresh.sourceState, fresh.sourceAgeSec], [true, "live", "10:30:00", "fresh", 5]);
  const old = await marketRows({ now, today, fetcher, misFetcher: misMock("10:10:00") });
  assert.equal(old.dataStatus, "delayed", "當日但 20 分鐘沒更新"); assert.equal(old.sourceState, "old");
  const none = await marketRows({ now, today, fetcher, misFetcher: misMock(null) });
  assert.equal(none.dataStatus, "delayed", "來源沒有時間"); assert.equal(none.sourceState, "missing");
  const fut = await marketRows({ now, today, fetcher, misFetcher: misMock("11:30:00") });
  assert.equal(fut.dataStatus, "degraded", "未來時間"); assert.equal(fut.sourceState, "future");
  // 沒成交的股票帶前一天的日期與 13:30 的時間：不能拿來當今天的更新時間
  const mixed = await marketRows({ now, today, fetcher, misFetcher: misMock("10:29:59", "20261028", code => (code === "1000" ? { d: "20261027", t: "13:30:00" } : {})) });
  assert.equal(mixed.sourceTime, "10:29:59"); assert.equal(mixed.dataStatus, "live");
});

test("P1-01 marketRows（富果快照）：lastUpdated 過舊時不是 live；fetchedAt 是伺服器時間、不能代替來源時間", async () => {
  const now = T("2026-10-28T10:30:05+08:00"), today = "2026-10-28";
  const mk = (ms, start, n, mkt) => Array.from({ length: n }, (_, k) => ({ symbol: String(start + k), name: `${mkt}${k}`, closePrice: 100, tradeVolume: 10, tradeValue: 1e6, lastUpdated: ms * 1000 }));
  const F = ms => async url => ({ data: url.includes("TSE") ? mk(ms, 1000, 1000, "上市") : mk(ms, 3000, 800, "上櫃") });
  const ok = await marketRows({ now, today, fugleFetcher: F(+now - 3000) });
  assert.equal(ok.dataStatus, "live"); assert.equal(ok.fetchedAt, now.toISOString());
  const stale = await marketRows({ now, today, fugleFetcher: F(+now - 30 * 60e3) });
  assert.equal(stale.dataStatus, "delayed", "富果快照 30 分鐘前的資料，伺服器剛抓也不是即時"); assert.equal(stale.fetchedAt, now.toISOString()); assert.equal(stale.sourceTime, "10:00:05");
});

test("P1-01 前端 evalDataStatus：瀏覽器剛收到（receivedAt＝現在）也不能讓過期資料變成 live；舊快取重新取得一樣是舊的", () => {
  const now = T("2026-10-28T10:30:05+08:00"), base = { type: "breadth", srcKind: "market", dataDate: "2026-10-28", completeness: "complete", coverage: { got: 1800, want: 1800 }, dateVerified: true, dateConsistent: true, dataStatus: "live", session: "open", dayState: "trade", today: "2026-10-28", now };
  const fresh = coreCtx.evalDataStatus({ ...base, sourceTime: "10:30:00", receivedAt: +now, fetchedAt: "2026-10-28T02:30:01Z" });
  assert.equal(fresh.status, "live"); assert.equal(fresh.receivedAt, +now); assert.equal(fresh.fetchedAt, "2026-10-28T02:30:01Z", "四種時間各自保留");
  const stale = coreCtx.evalDataStatus({ ...base, sourceTime: "10:05:00", receivedAt: +now });
  assert.equal(stale.status, "delayed"); assert.match(stale.note, /來源最後更新 10:05:00/);
  // 同一份回應（來源 10:30:00），過了 20 分鐘再重新收到一次（快取）：receivedAt 是新的，但來源時間舊了
  const later = T("2026-10-28T10:50:00+08:00");
  assert.equal(coreCtx.evalDataStatus({ ...base, now: later, sourceTime: "10:30:00", receivedAt: +later }).status, "delayed");
  assert.equal(coreCtx.evalDataStatus({ ...base, sourceTime: "10:40:00", receivedAt: +now }).status, "delayed", "未來時間");
  assert.equal(coreCtx.evalDataStatus({ ...base, sourceTime: "bad", receivedAt: +now }).status, "delayed", "無效時間");
  assert.equal(coreCtx.evalDataStatus({ ...base, sourceTime: null, receivedAt: +now }).status, "delayed", "無來源時間");
  // 前一交易日、週末、收盤後：都不會是 live
  assert.equal(coreCtx.evalDataStatus({ ...base, dataDate: "2026-10-27", sourceTime: "13:30:00", receivedAt: +now }).status, "delayed");
  assert.notEqual(coreCtx.evalDataStatus({ ...base, sourceTime: "10:30:00", session: "closed", dayState: "closed", today: "2026-10-31", now: T("2026-10-31T10:30:05+08:00"), receivedAt: Date.parse("2026-10-31T02:30:05Z") }).status, "live", "週六");
  assert.equal(coreCtx.evalDataStatus({ ...base, sourceTime: "13:30:00", session: "closed", now: T("2026-10-28T14:30:00+08:00"), receivedAt: Date.parse("2026-10-28T06:30:00Z") }).status, "confirmed", "收盤後是確認，不是即時");
});

// ==========================================
// P2-03：上市櫃完整度（方案 B，使用者 2026-10-30 選定）：上市、上櫃要各自達估計母體（上市 1000、上櫃 800）的 95%，
// 加上全市場 ≥ 95%、上市 ≥ 800 檔、上櫃 ≥ 600 檔、日期一致且驗證，才是 complete
// ==========================================
const mkRows = (tse, otc, date = "2026-10-28") => [...Array.from({ length: tse }, (_, i) => ({ code: String(1000 + i), market: "上市", price: 10, vol: 1, date })), ...Array.from({ length: otc }, (_, i) => ({ code: String(5000 + i), market: "上櫃", price: 10, vol: 1, date }))];
const cmp = (tse, otc) => validateMarketRows(mkRows(tse, otc), { today: "2026-10-28" });
test("P2-03 完整度：上市櫃都完整、只有一邊、兩邊都不足、筆數不足、部分 API 失敗", () => {
  assert.equal(cmp(1000, 800).completeness, "complete", "上市櫃都完整");
  assert.equal(cmp(1000, 0).completeness, "partial_tse_only", "上市完整、上櫃整批失敗");
  assert.equal(cmp(0, 800).completeness, "partial_otc_only", "上櫃完整、上市整批失敗");
  assert.equal(cmp(1000, 500).completeness, "partial", "上櫃低於 600 檔");
  assert.equal(cmp(700, 800).completeness, "partial", "上市低於 800 檔");
  assert.equal(cmp(700, 500).completeness, "partial", "兩個市場都不足");
  assert.equal(cmp(100, 100).completeness, "partial", "筆數遠低於門檻");
  assert.equal(cmp(0, 0).completeness, "empty");
  const r = cmp(1000, 600); assert.equal(r.completeness, "partial", "上櫃剛好 600 檔，但全市場 1600/1800 < 95%");
  assert.deepEqual([r.coverage.tseRatio, r.coverage.otcRatio], [1, 0.75], "回傳各市場自己的覆蓋率，前端可分開顯示");
  // 部分 API 失敗（MIS 某批 100 檔失敗）：其他批照算，少的會反映在覆蓋率
  assert.equal(cmp(1000, 700).completeness, "partial", "上櫃少 100 檔：1700/1800 < 95%");
});
test("P2-03 方案 B：全市場 ≥ 95% 但單一市場只有約 90% 時不算完整", () => {
  assert.equal(cmp(1000, 720).completeness, "partial", "上櫃 720/800＝90%（全市場 95.6%）→ partial");
  assert.equal(cmp(900, 820).completeness, "partial", "上市 900/1000＝90%（全市場 95.6%）→ partial");
  assert.equal(cmp(950, 760).completeness, "complete", "兩邊剛好 95% → complete");
  assert.equal(cmp(949, 800).completeness, "partial", "上市差一檔到 95% → partial");
  assert.equal(cmp(1000, 759).completeness, "partial", "上櫃差一檔到 95% → partial");
});
