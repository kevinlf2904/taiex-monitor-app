// 全市場行情（上市＋上櫃每檔一列）：給 /api/market（大盤）、/api/hot（台股熱門、排行）、/api/screen（選股）共用。
// 順序：1. 富果「快照」API（需要 FUGLE_API_KEY 且方案支援）→ 2. 證交所 MIS 一次查全部（盤中即時、收盤後是今天收盤）
//       → 3. 收盤後的證交所／櫃買當天收盤行情 → 4. OpenAPI（前一個交易日，只有今天還沒開盤或全部失敗時才會用到）。
// 回傳 { rows, live, date, time, source, note, coverage, dataStatus, completeness, sourceDate, sourceCapabilities }；
// rows 的格式和 hot.js 的 parseTwseAll 一樣：
//   { code, name, market, price, chg, chgPct, vol（張）, value（億元）, o, h, l, date }

import { parseTwseAll, parseTpexAll, isStockOrEtf } from "./hot.js";
import { session, todayTaipei, misFetch, parseMis } from "./quote.js";
import { closeToday, isValidIsoDate } from "./daily.js";
import { holWarm, holState } from "./calendar.js";
import { getJSON as _getJ, num as n } from "./_tw.js";
import { sourceFresh, SRC_LAG } from "./_fresh.js";
const getJSON = (url, headers = {}, ms = 12000) => _getJ(url, headers, ms);

// 富果快照格式：{ data: [{ symbol, name, closePrice, change, changePercent, tradeVolume, tradeValue, openPrice, highPrice, lowPrice, lastUpdated }, ...] }
// 把富果快照的欄位轉成跟 parseTwseAll 一樣的統一格式，讓後面各模組不用改寫
export function parseFugleSnapshot(j, market) {
  if (!j || !Array.isArray(j.data)) return [];
  return j.data.map(r => {
    const code = String(r.symbol || "").trim(), price = n(r.closePrice), chg = n(r.change), vol = n(r.tradeVolume), value = n(r.tradeValue);
    const ts = r.lastUpdated ? new Date(Number(r.lastUpdated) / 1000) : null;
    const date = ts ? new Date(ts.getTime() + 8 * 3600e3).toISOString().slice(0, 10) : null;
    // 富果的 tradeVolume 有時是股有時是張：用成交值推算，如果 vol * price 大約等於 value 那 vol 就是股（除以 1000 變張）
    const lots = vol != null && value != null && price ? value / (price * vol) > 100 : true, volLots = vol == null ? null : lots ? vol : Math.round(vol / 1000);
    const pct = n(r.changePercent) ?? (price != null && chg != null && price - chg ? +((chg / (price - chg)) * 100).toFixed(2) : null);
    return { code, name: String(r.name || "").trim(), market, price, chg, chgPct: pct, vol: volLots, value: value != null ? +(value / 1e8).toFixed(2) : null, o: n(r.openPrice), h: n(r.highPrice), l: n(r.lowPrice), date };
  }).filter(x => isStockOrEtf(x.code) && x.price > 0);
}

// 行情完整性與市場覆蓋率驗證
// 嚴格先進行資料有效性檢驗，再依明確優先順序去重，杜絕無效列佔用代碼排除後續有效列之缺陷
export function validateMarketRows(rows, { expectedCodes = null, minTse = 800, minOtc = 600, today = todayTaipei(), now = new Date() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const validByCode = new Map();
  let dupCount = 0;
  let invalidCount = 0;

  for (const r of list) {
    const code = String(r?.code || "").trim();
    if (!isStockOrEtf(code)) {
      invalidCount++;
      continue;
    }

    const price = r.price;
    const vol = r.vol;
    const date = r.date;
    const isPriceValid = typeof price === "number" && Number.isFinite(price) && price > 0;
    const isVolValid = vol == null || (typeof vol === "number" && Number.isFinite(vol) && vol >= 0);
    const isDateValid = Boolean(date && isValidIsoDate(date, today));

    if (!isPriceValid || !isVolValid || !isDateValid) {
      invalidCount++;
      continue; // 無效列直接統計並跳過，絕不寫入 validByCode 影響後續有效列
    }

    // 欄位皆有效，依明確策略去重：保留成交量較大者；若量相同則保留先出現者
    if (validByCode.has(code)) {
      dupCount++;
      const existing = validByCode.get(code);
      const curVol = r.vol ?? -1;
      const exVol = existing.vol ?? -1;
      if (curVol > exVol) {
        validByCode.set(code, r);
      }
    } else {
      validByCode.set(code, r);
    }
  }

  const validRows = Array.from(validByCode.values());
  let tseCount = 0;
  let otcCount = 0;
  const tseDates = new Set();
  const otcDates = new Set();

  for (const r of validRows) {
    if (r.market === "上櫃") {
      otcCount++;
      if (r.date) otcDates.add(r.date);
    } else {
      tseCount++;
      if (r.date) tseDates.add(r.date);
    }
  }

  const totalCount = validRows.length;
  const allDates = new Set([...tseDates, ...otcDates]);
  const primaryDate = allDates.size === 1 ? [...allDates][0] : null;

  // 上市與上櫃日期分別驗證
  let dateConsistent = false;
  let dateVerified = false;

  const hasTse = tseCount > 0;
  const hasOtc = otcCount > 0;
  const tseDate = tseDates.size === 1 ? [...tseDates][0] : null;
  const otcDate = otcDates.size === 1 ? [...otcDates][0] : null;

  if (hasTse && hasOtc) {
    if (tseDate && otcDate && tseDate === otcDate && isValidIsoDate(tseDate, today)) {
      dateConsistent = true;
      dateVerified = true;
    } else {
      dateConsistent = false;
      dateVerified = false;
    }
  } else if (hasTse && !hasOtc) {
    // 僅上市有資料，無法宣稱跨市場一致
    dateConsistent = false;
    dateVerified = Boolean(tseDate && isValidIsoDate(tseDate, today));
  } else if (!hasTse && hasOtc) {
    // 僅上櫃有資料，無法宣稱跨市場一致
    dateConsistent = false;
    dateVerified = Boolean(otcDate && isValidIsoDate(otcDate, today));
  } else {
    dateConsistent = false;
    dateVerified = false;
  }

  // 市場覆蓋率計算：嚴格區分「全市場母體估計覆蓋率」與「基準清單比對覆蓋率」
  const ESTIMATED_UNIVERSE = { tse: 1000, otc: 800, total: 1800 };
  const estimatedTseWant = minTse > 0 ? Math.max(minTse, ESTIMATED_UNIVERSE.tse) : ESTIMATED_UNIVERSE.tse;
  const estimatedOtcWant = minOtc > 0 ? Math.max(minOtc, ESTIMATED_UNIVERSE.otc) : ESTIMATED_UNIVERSE.otc;
  const estimatedTotalWant = estimatedTseWant + estimatedOtcWant;

  const marketRatio = +(totalCount / estimatedTotalWant).toFixed(4);
  const tseMarketRatio = +(tseCount / estimatedTseWant).toFixed(4);
  const otcMarketRatio = +(otcCount / estimatedOtcWant).toFixed(4);

  let benchmark = null;
  if (expectedCodes && expectedCodes.size > 0) {
    let matchedExpectedCount = 0;
    for (const code of validByCode.keys()) {
      if (expectedCodes.has(code)) matchedExpectedCount++;
    }
    benchmark = {
      got: matchedExpectedCount,
      want: expectedCodes.size,
      ratio: +(matchedExpectedCount / expectedCodes.size).toFixed(4),
      isBenchmarkComplete: expectedCodes.size >= Math.ceil(estimatedTotalWant * 0.95)
    };
  }

  // 全市場 coverage 的分母固定使用估計母體；基準清單只供 benchmark 比對，不能縮小全市場分母。
  const effectiveWant = estimatedTotalWant;
  const effectiveRatio = +(totalCount / effectiveWant).toFixed(4);

  // 完整性狀態判定：complete 必須同時符合資料量、上市櫃雙市場門檻、日期一致且已驗證
  // 上市、上櫃要「各自」達到估計母體的 95%（P2-03 方案 B）：全市場 95% 會掩蓋單一市場缺 10% 以上的情況
  let completeness = "empty";
  if (totalCount === 0) {
    completeness = "empty";
  } else if (
    marketRatio >= 0.95 &&
    tseMarketRatio >= 0.95 &&
    otcMarketRatio >= 0.95 &&
    tseCount >= minTse &&
    otcCount >= minOtc &&
    dateConsistent &&
    dateVerified
  ) {
    completeness = "complete";
  } else if (tseCount >= minTse && otcCount < 200) {
    completeness = "partial_tse_only";
  } else if (otcCount >= minOtc && tseCount < 200) {
    completeness = "partial_otc_only";
  } else if (tseCount > 0 && otcCount > 0 && (tseCount < minTse || otcCount < minOtc || marketRatio < 0.95 || tseMarketRatio < 0.95 || otcMarketRatio < 0.95)) {
    completeness = "partial";
  } else {
    completeness = "degraded";
  }

  return {
    validRows,
    totalCount,
    tseCount,
    otcCount,
    dupCount,
    invalidCount,
    dates: Array.from(allDates),
    primaryDate,
    dateConsistent,
    dateVerified,
    completeness,
    coverage: {
      got: totalCount,
      want: effectiveWant,
      ratio: effectiveRatio,
      tseGot: tseCount,
      tseWant: estimatedTseWant,
      otcGot: otcCount,
      otcWant: estimatedOtcWant,
      tseRatio: tseMarketRatio,
      otcRatio: otcMarketRatio,
      marketRatio,
      benchmark,
      universe: {
        tse: estimatedTseWant,
        otc: estimatedOtcWant,
        total: estimatedTotalWant,
        isEstimated: true
      }
    },
    markets: {
      tse: { count: tseCount, date: tseDate, valid: tseDates.size === 1 },
      otc: { count: otcCount, date: otcDate, valid: otcDates.size === 1 }
    }
  };
}

// MIS 一次查很多檔（每批 100 檔、同時 4 批），盤中與收盤後當天都有當天的價（收盤後 z 就是收盤價）
// 某一批失敗時拆成兩半再試一次（之前失敗會整批 100 檔默默不見，漲跌家數、產業漲跌就會少算）
export async function misAll(base, fetcher = misFetch) {
  const list = base.filter(r => isStockOrEtf(r.code)), out = [], B = 100;
  const batches = []; for (let i = 0; i < list.length; i += B) batches.push(list.slice(i, i + B));
  const ch = r => `${r.market === "上櫃" ? "otc" : "tse"}_${r.code}.tw`;
  const one = async (bt, depth = 0) => {
    try { out.push(...(await fetcher(bt.map(ch))).map(parseMis)); }
    catch { if (depth < 2 && bt.length > 1) { const h = Math.ceil(bt.length / 2); await one(bt.slice(0, h), depth + 1); await one(bt.slice(h), depth + 1); } }
  };
  let k = 0; const worker = async () => { while (k < batches.length) await one(batches[k++]); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const by = new Map(base.map(r => [r.code, r]));
  let latestTime = null;
  const latestByDate = {}; // 每個交易日各自最新的來源時間：沒成交的股票會帶前一天的日期與時間，不能拿來當今天的更新時間
  for (const q of out) {
    if (q?.time && /^\d{2}:\d{2}:\d{2}$/.test(q.time)) {
      if (!latestTime || q.time > latestTime) latestTime = q.time;
      if (q.date && (!latestByDate[q.date] || q.time > latestByDate[q.date])) latestByDate[q.date] = q.time;
    }
  }
  const rows = out.filter(q => q.code && q.price != null && q.prev).map(q => { const o = by.get(q.code) || {};
    return { code: q.code, name: q.name || o.name || "", market: o.market || q.market, price: q.price, chg: q.chg, chgPct: q.chgPct, vol: q.vol, value: q.vol != null ? +((q.vol * 1000 * q.price) / 1e8).toFixed(2) : null, o: q.open, h: q.high, l: q.low, date: q.date }; });
  Object.defineProperty(rows, "latestTime", { value: latestTime, enumerable: false });
  Object.defineProperty(rows, "latestByDate", { value: latestByDate, enumerable: false });
  return rows;
}

let memo = null; // 函式執行個體快取：盤中 8 秒、收盤 30 秒
const ymd = iso => iso.replace(/-/g, "");

// 收盤行情 Map 轉統一格式列
export function mapCloseToRows(m, dateStr) {
  const actualDate = m?.date || (isValidIsoDate(dateStr) ? dateStr : null);
  const entries = m instanceof Map ? [...m] : Array.isArray(m) ? m : Object.entries(m || {});
  return entries.map(([code, q]) => ({
    code,
    name: q.name,
    market: q.market,
    price: q.p,
    chg: q.p && q.pct != null ? +(q.p - q.p / (1 + q.pct / 100)).toFixed(2) : null,
    chgPct: q.pct,
    vol: q.v,
    value: q.v != null && q.p != null ? +((q.v * 1000 * q.p) / 1e8).toFixed(2) : null,
    o: null,
    h: null,
    l: null,
    date: actualDate
  })).filter(r => isStockOrEtf(r.code));
}

// 往前探測最近的收盤行情（可自訂交易日與日曆日上限，支援注入時鐘、休市判斷與查詢器）
export async function fetchRecentClose(arg1 = todayTaipei(), arg2 = 7) {
  let opts = {};
  if (typeof arg1 === "object" && arg1 !== null) {
    opts = arg1;
  } else {
    opts = { todayStr: arg1, maxCalendarDays: arg2, maxTradingDays: Math.min(arg2, 5) };
  }

  const {
    now = new Date(),
    todayStr = todayTaipei(now),
    maxTradingDays = 5,
    maxCalendarDays = 10,
    isHoliday = null,
    fetcher = closeToday
  } = opts;

  const maxIso = todayTaipei(now);
  const tp = new Date(now.getTime() + 8 * 3600e3);
  const minutes = tp.getUTCHours() * 60 + tp.getUTCMinutes();
  const isAfterClose = minutes >= 13 * 60 + 35;
  const isWeekday = tp.getUTCDay() % 6 !== 0;

  const checkHoliday = iso => {
    if (typeof isHoliday === "function") return isHoliday(iso);
    return holState(iso) === "closed";
  };

  const cur = new Date(todayStr + "T00:00:00Z");
  // 平日且已過收盤（13:35 後）且非假日，先試今天；否則從前一日往前找
  if (!(isWeekday && isAfterClose && !checkHoliday(todayStr))) {
    cur.setUTCDate(cur.getUTCDate() - 1);
  }

  let calendarDaysChecked = 0;
  let tradingDaysChecked = 0;

  while (calendarDaysChecked < maxCalendarDays && tradingDaysChecked < maxTradingDays) {
    calendarDaysChecked++;
    const dayOfWeek = cur.getUTCDay();
    const iso = cur.toISOString().slice(0, 10);

    if (dayOfWeek === 0 || dayOfWeek === 6 || checkHoliday(iso)) {
      cur.setUTCDate(cur.getUTCDate() - 1);
      continue;
    }

    tradingDaysChecked++;
    const dStr = ymd(iso);
    try {
      const res = await fetcher(dStr, { now });
      const m = res?.map || (res instanceof Map ? res : null);
      // 絕對不可將請求日期直接當成來源日期，必須以來源實際回傳並驗證的日期為準
      const actualDate = res?.date || null;
      const isMatched = Boolean(
        res?.isSourceDateMatched === true ||
        (res?.dateVerified === true && actualDate === iso)
      );

      if (m && m.size > 500 && actualDate && isValidIsoDate(actualDate, maxIso) && isMatched) {
        return {
          date: actualDate,
          map: m,
          sourceDate: actualDate,
          tseCount: res?.tseCount,
          otcCount: res?.otcCount,
          isSourceDateMatched: true,
          dateVerified: res?.dateVerified ?? true,
          dateConsistent: res?.dateConsistent ?? null
        };
      }
    } catch {}
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return null;
}

// 依時效性與資料品質嚴格映射 dataStatus，杜絕「不完整或日期未驗證卻宣告 live / confirmed」之矛盾
// 盤中要宣告 live，還要有來源自己的更新時間證明資料是新的（sourceState，見 _fresh.js）：
// 沒給或來源沒時間 → delayed；來源時間落後超過門檻 → delayed；未來時間或格式錯 → degraded。完整度不等於新鮮度，兩個都要過
export function deriveDataStatus({ isLiveSession, isToday, completeness, dateConsistent, dateVerified, sourceState = "missing" }) {
  const isHealthy = completeness === "complete" && dateConsistent === true && dateVerified === true;
  if (isLiveSession) {
    if (!isHealthy) return (completeness === "degraded" || dateConsistent === false || dateVerified === false) ? "degraded" : "partial";
    if (sourceState === "fresh") return "live";
    return sourceState === "future" || sourceState === "invalid" ? "degraded" : "delayed";
  }
  if (isToday) {
    if (isHealthy) return "confirmed";
    return (completeness === "degraded" || dateConsistent === false || dateVerified === false) ? "degraded" : "partial";
  }
  return "delayed";
}

export async function marketRows(opts = {}) {
  const {
    now = new Date(),
    today = todayTaipei(now),
    isHoliday = null,
    fetcher = null,
    fugleFetcher = null,
    misFetcher = null,
    rwdFetcher = closeToday
  } = opts;

  holWarm(); // 休市日表：session() 要靠它認出平日的國定假日

  // 自訂時鐘、自訂休市判定或自訂查詢器時，嚴格隔離快取，絕不污染正式環境快取
  const isCustom = Boolean(fetcher || fugleFetcher || misFetcher || rwdFetcher !== closeToday || isHoliday != null || opts.now != null || opts.today != null);
  if (!isCustom && memo && Date.now() - memo.at < (memo.v?.live ? 8000 : 30000)) return memo.v;

  const key = (process.env.FUGLE_API_KEY || "").trim();
  const notes = [];

  const checkHoliday = iso => {
    if (typeof isHoliday === "function") return isHoliday(iso);
    return holState(iso) === "closed";
  };

  // 休市日與交易時段判斷必須嚴格一致
  let sess = session(now);
  if (checkHoliday(today)) {
    sess = "closed";
  }

  const fetchedAt = now.toISOString();
  const done = v => {
    const out = {
      ...v,
      dataDate: v.date || null,
      sourceTime: v.time || null,
      fetchedAt,
      updateMode: v.live ? "live" : String(v.source || "").includes("OpenAPI") ? "daily" : "after_close",
      isFallback: Boolean(!v.live && (v.note || String(v.source || "").includes("OpenAPI"))),
    };
    if (!isCustom) memo = { at: Date.now(), v: out };
    return out;
  };

  // 1. 富果快照（有金鑰而且方案支援，或傳入自訂 fugleFetcher）
  if (key || fugleFetcher) {
    try {
      const base = "https://api.fugle.tw/marketdata/v1.0/stock/snapshot/quotes", h = { "X-API-KEY": key };
      const getF = fugleFetcher || (url => getJSON(url, h));
      const [t, o] = await Promise.all([getF(`${base}/TSE?type=ALLBUT0999`), getF(`${base}/OTC?type=ALLBUT0999`)]);
      const rows = [...parseFugleSnapshot(t, "上市"), ...parseFugleSnapshot(o, "上櫃")];
      const validation = validateMarketRows(rows, { today, now });
      const date = validation.primaryDate || null;

      if (validation.totalCount >= 500 && date && date <= today) {
        const isLiveSession = date === today && sess === "open";
        let fTime = null;
        for (const raw of [...(t?.data || []), ...(o?.data || [])]) {
          const u = Number(raw?.lastUpdated);
          if (u > 0) {
            const iso = new Date(Math.floor(u / 1000) + 8 * 3600e3).toISOString(), tm = iso.slice(11, 19);
            if (iso.slice(0, 10) === date && (!fTime || tm > fTime)) fTime = tm; // 只看這份行情那一天的更新時間
          }
        }
        const fresh = sourceFresh({ dataDate: date, sourceTime: fTime, now, maxLagMs: SRC_LAG.market });
        const dataStatus = deriveDataStatus({
          isLiveSession,
          isToday: date === today,
          completeness: validation.completeness,
          dateConsistent: validation.dateConsistent,
          dateVerified: validation.dateVerified,
          sourceState: fresh.state
        });
        return done({
          rows: validation.validRows,
          live: isLiveSession,
          sourceAgeSec: fresh.ageMs != null ? Math.round(fresh.ageMs / 1000) : null,
          sourceState: fresh.state,
          date,
          time: fTime,
          source: "富果行情快照（上市、上櫃）",
          note: null,
          coverage: validation.coverage,
          dataStatus,
          completeness: validation.completeness,
          sourceDate: date,
          dateVerified: validation.dateVerified,
          dateConsistent: validation.dateConsistent,
          sourceCapabilities: { hasOhlc: true, hasValue: true }
        });
      }
      notes.push("富果快照資料不足或日期異常");
    } catch (e) { notes.push(`富果快照拿不到（${e.message}）`); }
  }

  // 取得基準清單（OpenAPI 前一個交易日收盤，或透過 fetcher 注入）
  const getPrev = fetcher || (async () => {
    const [a, b] = await Promise.allSettled([
      getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll),
      getJSON("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll)
    ]);
    return [...(a.value || []), ...(b.value || [])];
  });

  let prev = [];
  try { prev = await getPrev(); } catch {}
  const prevDate = prev.find(r => r.date)?.date || null;
  const expectedCodes = new Set(prev.filter(r => isStockOrEtf(r.code)).map(r => r.code));

  // 2. 盤中即時：交易時段（平日 09:00~13:35 且 session 為 open）由 MIS 查詢全市場
  // 修正：不可因 prevDate === today 跳過 MIS，盤中無論 prevDate 為何都應嘗試取最新即時資料
  const tp = new Date(now.getTime() + 8 * 3600e3);
  const minutes = tp.getUTCHours() * 60 + tp.getUTCMinutes();
  const isTradingDay = tp.getUTCDay() % 6 !== 0 && !checkHoliday(today);
  const isTradingHours = isTradingDay && minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
  const canTryMis = prev.length > 0 && (sess === "open" || isTradingHours);

  if (canTryMis) {
    try {
      const rows = await misAll(prev, misFetcher || misFetch);
      const todayRows = rows.filter(r => r.date === today);
      const validation = validateMarketRows(todayRows, { expectedCodes, today, now });

      if (validation.totalCount >= 500 && validation.primaryDate === today) {
        const isLiveSession = sess === "open";
        const fresh = sourceFresh({ dataDate: today, sourceTime: rows.latestByDate?.[today] || null, now, maxLagMs: SRC_LAG.market });
        const dataStatus = deriveDataStatus({
          isLiveSession,
          isToday: true,
          completeness: validation.completeness,
          dateConsistent: validation.dateConsistent,
          dateVerified: validation.dateVerified,
          sourceState: fresh.state
        });
        return done({
          rows: validation.validRows,
          coverage: validation.coverage,
          live: isLiveSession,
          sourceAgeSec: fresh.ageMs != null ? Math.round(fresh.ageMs / 1000) : null,
          sourceState: fresh.state,
          date: today,
          time: rows.latestByDate?.[today] || null,
          source: sess === "open" ? "證交所 MIS 即時行情（上市、上櫃）" : "證交所 MIS（今天收盤）",
          note: null,
          dataStatus,
          completeness: validation.completeness,
          sourceDate: today,
          dateVerified: validation.dateVerified,
          dateConsistent: validation.dateConsistent,
          sourceCapabilities: { hasOhlc: true, hasValue: true }
        });
      }
      notes.push("MIS 資料不足或非今日行情");
    } catch (e) { notes.push(`MIS 拿不到（${e.message}）`); }
  }

  // 3. 收盤或非盤中備援：若 OpenAPI 已停滯（prevDate < today），或當前非交易時間 MIS 無法提供當日即時
  // 優先探測今日或最近交易日的證交所／櫃買收盤行情，避免停留於舊資料
  try {
    const recent = await fetchRecentClose({
      todayStr: today,
      now,
      isHoliday,
      fetcher: rwdFetcher
    });

    if (recent && recent.map && recent.map.size > 500) {
      const isFresher = !prevDate || recent.date >= prevDate;
      if (isFresher) {
        const rows = mapCloseToRows(recent.map, recent.date);
        const validation = validateMarketRows(rows, { expectedCodes, today, now });
        const dateVerified = recent.dateVerified != null ? Boolean(recent.dateVerified && validation.dateVerified) : validation.dateVerified;
        const dateConsistent = recent.dateConsistent != null ? Boolean(recent.dateConsistent && validation.dateConsistent) : validation.dateConsistent;
        const dataStatus = deriveDataStatus({
          isLiveSession: false,
          isToday: recent.date === today,
          completeness: validation.completeness,
          dateConsistent,
          dateVerified
        });

        return done({
          rows: validation.validRows,
          live: false,
          date: recent.date,
          time: null,
          source: recent.date === today ? "證交所、櫃買中心 今日收盤行情" : "證交所、櫃買中心 收盤行情",
          note: recent.date !== today && notes.length ? `今日即時暫未取得（${notes.join("；")}），顯示 ${recent.date} 收盤` : null,
          coverage: validation.coverage,
          dataStatus,
          completeness: validation.completeness,
          sourceDate: recent.sourceDate || recent.date,
          dateVerified,
          dateConsistent,
          sourceCapabilities: { hasOhlc: false, hasValue: true }
        });
      }
    }
  } catch (e) { notes.push(`收盤行情探測失敗（${e.message}）`); }

  // 4. 最後備援：OpenAPI
  if (prev.length) {
    const validation = validateMarketRows(prev, { expectedCodes, today, now });
    const isPrevDateValid = Boolean(prevDate && isValidIsoDate(prevDate, today));
    return done({
      rows: validation.validRows,
      live: false,
      date: isPrevDateValid ? prevDate : null,
      time: null,
      source: "證交所、櫃買中心 OpenAPI",
      note: notes.length ? `即時與最近收盤暫時拿不到（${notes.join("；")}），顯示 ${prevDate || "前次"} 資料` : null,
      coverage: validation.coverage,
      dataStatus: "delayed",
      completeness: validation.completeness,
      sourceDate: isPrevDateValid ? prevDate : null,
      dateVerified: Boolean(isPrevDateValid && validation.dateVerified),
      dateConsistent: Boolean(isPrevDateValid && validation.dateConsistent),
      sourceCapabilities: { hasOhlc: true, hasValue: true },
      fallbackReason: notes.join("；") || "使用預設 OpenAPI"
    });
  }

  throw new Error([...notes].filter(Boolean).join("；") || "沒有資料");
}
export const liveCache = (live, open = 20) => (live || session() !== "closed" ? `s-maxage=${open}, stale-while-revalidate=${open * 2}` : "s-maxage=300, stale-while-revalidate=900");
