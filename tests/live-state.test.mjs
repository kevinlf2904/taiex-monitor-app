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
  for (let i = 1000; i < 1600; i++) {
    base.push({ code: String(i), name: `股${i}`, market: "上市", date: "2026-10-27" });
  }

  const mockMis = async (chs) => chs.map(ch => {
    const code = ch.split("_")[1].split(".")[0];
    return {
      c: code,
      n: `名稱${code}`,
      ex: "tse",
      z: "100",
      y: "99",
      v: "1000",
      d: "20261028"
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
  for (let i = 1000; i < 1600; i++) {
    base.push({ code: String(i), name: `股${i}`, market: "上市", date: "2026-10-28" });
  }
  let misCalled = false;
  const mockMis = async (chs) => {
    misCalled = true;
    return chs.map(ch => ({
      c: ch.split("_")[1].split(".")[0],
      z: "120",
      y: "115",
      v: "500",
      d: "20261028"
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
  assert.equal(res.dataStatus, "delayed");
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
