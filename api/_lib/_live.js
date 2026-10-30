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
import { withRetry, retryErr, errKind, singleFlight } from "./_retry.js";
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
    // 基準清單是 Map（代碼 → 上市／上櫃）時，上市、上櫃各自比對
    if (expectedCodes instanceof Map) {
      const want = { tse: 0, otc: 0 }, got = { tse: 0, otc: 0 };
      for (const [code, mk] of expectedCodes) { const k = mk === "上櫃" ? "otc" : "tse"; want[k]++; if (validByCode.has(code)) got[k]++; }
      benchmark.tseRatio = want.tse ? +(got.tse / want.tse).toFixed(4) : null;
      benchmark.otcRatio = want.otc ? +(got.otc / want.otc).toFixed(4) : null;
    }
  }
  // 基準清單夠完整時，complete 還要對基準清單達到 95%：估計母體（1000＋800）比實際上市櫃（約 2300 檔）少，
  // 只看估計母體的話，漏掉幾百檔仍會被算成 complete（PR #183 第二輪審查 P1-1）
  const benchOk = !benchmark?.isBenchmarkComplete || (benchmark.ratio >= 0.95 && (benchmark.tseRatio ?? 1) >= 0.95 && (benchmark.otcRatio ?? 1) >= 0.95);

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
    dateVerified &&
    benchOk
  ) {
    completeness = "complete";
  } else if (tseCount >= minTse && otcCount < 200) {
    completeness = "partial_tse_only";
  } else if (otcCount >= minOtc && tseCount < 200) {
    completeness = "partial_otc_only";
  } else if (tseCount > 0 && otcCount > 0 && (tseCount < minTse || otcCount < minOtc || marketRatio < 0.95 || tseMarketRatio < 0.95 || otcMarketRatio < 0.95 || !benchOk)) {
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
// 每批遇到暫時性錯誤（429、5xx、逾時、200 但沒資料或缺一大半）有限次重試（_retry.js），還是不行才拆成兩半再試一次；
// 遇到 403（被拒）或斷路器開著（例如連續 429）整輪停止，不再對 MIS 發請求。
// 時間：整體 15 秒（Vercel 函式上限 60 秒，前面有 OpenAPI 清單、後面還有收盤備援要跑）；每個請求的逾時也算在剩下的時間裡，期限過後才回來的資料不收。
// 請求數：一輪最多「批數 × 2 ＋ 4」次，持續 5xx 時不會打出幾百次請求。
// 回傳的 rows 帶不列舉的 stats：{ batches, okBatches, partialBatches, failedBatches, requested, received, missing, requests, retries, aborted, timedOut, capped, errors }
//   每個原始批次只算一次（拆半的兩半合起來算）；okBatches＝拿到 ≥ 95%，partialBatches＝有拿到但不到 95%，failedBatches＝完全沒拿到
export const MIS_ALL = { budgetMs: 15000, attempts: 3, baseMs: 250, maxMs: 2000, minShare: 0.5, okShare: 0.95 };
export async function misAll(base, fetcher = misFetch, opts = {}) {
  const { budgetMs = MIS_ALL.budgetMs, attempts = MIS_ALL.attempts, baseMs = MIS_ALL.baseMs, maxMs = MIS_ALL.maxMs, now = Date.now, sleep, rand } = opts;
  const list = base.filter(r => isStockOrEtf(r.code)), out = [], B = 100;
  const batches = []; for (let i = 0; i < list.length; i += B) batches.push(list.slice(i, i + B));
  const ch = r => `${r.market === "上櫃" ? "otc" : "tse"}_${r.code}.tw`;
  const deadline = now() + budgetMs, maxRequests = opts.maxRequests ?? batches.length * 2 + 4;
  const stats = { batches: batches.length, okBatches: 0, partialBatches: 0, failedBatches: 0, requested: list.length, received: 0, missing: 0, requests: 0, retries: 0, aborted: false, timedOut: false, capped: false, errors: [] };
  const note = e => { const k = errKind(e); if (stats.errors.length < 5 && !stats.errors.includes(k)) stats.errors.push(k); return k; };
  // 查一批（可能拆半），回傳拿到的筆數；統計由最外層的原始批次記
  const one = async (bt, depth = 0) => {
    if (stats.aborted) return 0;
    if (now() >= deadline) { stats.timedOut = true; return 0; }
    let best = [];
    try {
      await withRetry(async () => {
        if (stats.requests >= maxRequests) { stats.capped = true; throw retryErr("circuit", "這一輪 MIS 請求數到上限"); }
        stats.requests++;
        const got = await fetcher(bt.map(ch), { deadline });
        if (now() > deadline) { stats.timedOut = true; throw retryErr("timeout", "超過整體時間上限才回來，不收"); }
        if (!Array.isArray(got)) throw retryErr("bad_json", "MIS 回應格式不對");
        const parsed = got.map(parseMis).filter(q => q.code);
        if (parsed.length > best.length) best = parsed;
        if (!parsed.length) throw retryErr("empty", "MIS 這批沒有資料");
        if (parsed.length < bt.length * MIS_ALL.minShare) throw retryErr("incomplete", `MIS 這批只回 ${parsed.length}/${bt.length} 檔`);
      }, { attempts, baseMs, maxMs, deadline, now, sleep, rand, onRetry: e => { stats.retries++; note(e); } });
    } catch (e) {
      const k = note(e);
      if (k === "fatal" || (k === "circuit" && !stats.capped)) stats.aborted = true; // 被拒或斷路器開著：其他批次也不用再問
      else if (!best.length && depth < 1 && bt.length > 1 && now() < deadline && !stats.capped) { // 一直失敗：拆成兩半再試一次（可能是某一檔讓整批出錯）
        const h = Math.ceil(bt.length / 2);
        return (await one(bt.slice(0, h), depth + 1)) + (await one(bt.slice(h), depth + 1));
      }
    }
    out.push(...best);
    return best.length;
  };
  const top = async bt => {
    const got = await one(bt);
    stats.received += got; stats.missing += Math.max(0, bt.length - got);
    if (!got) stats.failedBatches++; else if (got < bt.length * MIS_ALL.okShare) stats.partialBatches++; else stats.okBatches++;
  };
  let k = 0; const worker = async () => { while (k < batches.length && !stats.aborted) await top(batches[k++]); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (; k < batches.length; k++) { stats.failedBatches++; stats.missing += batches[k].length; } // 中途停止：沒問到的批次也算失敗
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
  Object.defineProperty(rows, "stats", { value: stats, enumerable: false });
  return rows;
}

// MIS 少了哪些：「少 120 檔（2/23 批失敗、1 批不完整：timeout）」
const misMiss = st => [`少 ${st.missing} 檔`, st.failedBatches ? `${st.failedBatches}/${st.batches} 批失敗` : "", st.partialBatches ? `${st.partialBatches} 批不完整` : ""].filter(Boolean).join("、") + (st.errors?.length ? `：${st.errors.join("、")}` : "");
// 狀態嚴重度（越前面越嚴重，和前端 DATA_STATES 同一個順序；degraded 對應 unverified）
const SEVERITY = ["unavailable", "degraded", "stale", "partial", "delayed", "pending", "confirmed", "live"];
const worse = (a, b) => (SEVERITY.indexOf(a) < SEVERITY.indexOf(b) ? a : b);
let memo = null; // 函式執行個體快取：即時或盤中 8 秒、收盤後 30 秒（盤中拿到的是備援，也只留 8 秒，才會很快再問 MIS）
// 今天最後一筆有效的盤中全市場資料（MIS 或富果快照）：MIS 暫時失敗時先用它（標延遲或停滯），不直接退回昨天收盤
const prodStore = { lastGood: null };
export const KEEP_COMPLETE_MS = 120000; // 新拿到的只是部分資料時，2 分鐘內的完整資料優先（部分資料不覆蓋完整資料）
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
  // 自訂時鐘、自訂休市判定或自訂查詢器時，嚴格隔離快取，絕不污染正式環境快取
  const isCustom = Boolean(opts.fetcher || opts.fugleFetcher || opts.misFetcher || (opts.rwdFetcher && opts.rwdFetcher !== closeToday) || opts.isHoliday != null || opts.now != null || opts.today != null || opts.store);
  if (isCustom) return buildMarketRows(opts, true, opts.store || null);
  if (memo && Date.now() - memo.at < (memo.v?.live || memo.sess === "open" ? 8000 : 30000)) return memo.v;
  // 同一個執行個體同時進來的請求（大盤、熱門、選股）共用同一次查詢，不各自打一輪全市場 MIS
  return sharedBuild(opts);
}
const sharedBuild = singleFlight(opts => buildMarketRows(opts, false, prodStore));

async function buildMarketRows(opts, isCustom, store) {
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
    if (!isCustom) memo = { at: Date.now(), sess, v: out };
    // 今天的盤中全市場資料記成最後有效資料（部分資料不蓋掉 2 分鐘內的完整資料，見 keepOrNew）
    if (store && v.intraday && out.dataDate === today && out.rows?.length >= 500) store.lastGood = out;
    return out;
  };
  // 回傳最後一筆有效資料：數字不變，live 一律 false；來源時間還在門檻內標 delayed，超過標 stale；fetchedAt 保留當初抓的時間
  const lastGoodToday = () => (store?.lastGood?.dataDate === today && store.lastGood.rows?.length >= 500 ? store.lastGood : null);
  const keepLast = (lg, reason) => {
    const fresh = sourceFresh({ dataDate: lg.dataDate, sourceTime: lg.sourceTime, now, maxLagMs: SRC_LAG.market });
    const at = lg.sourceTime || String(lg.fetchedAt || "").slice(11, 19);
    const out = {
      ...lg,
      live: false,
      dataStatus: worse(lg.dataStatus || "delayed", fresh.state === "fresh" ? "delayed" : "stale"), // 本來就不完整的資料，沿用時不能變成比較輕的 delayed
      sourceState: fresh.state,
      sourceAgeSec: fresh.ageMs != null ? Math.round(fresh.ageMs / 1000) : null,
      isFallback: true,
      isLastGood: true,
      lastGoodAt: lg.fetchedAt,
      note: `${reason}，暫時沿用今天 ${at} 的最後一筆有效資料`,
      fallbackReason: reason
    };
    if (!isCustom) memo = { at: Date.now(), sess, v: out };
    return out;
  };
  // 新拿到的盤中資料不完整、而 2 分鐘內有完整的：沿用完整的（標延遲），不讓部分資料蓋掉
  const keepOrNew = v => {
    const lg = lastGoodToday();
    if (v.completeness !== "complete" && lg?.completeness === "complete" && now - Date.parse(lg.fetchedAt) <= KEEP_COMPLETE_MS)
      return keepLast(lg, `最新一次只拿到部分資料（${v.coverage?.got ?? v.rows.length}/${v.coverage?.want ?? "?"} 檔）`);
    return done(v);
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
        return (date === today ? keepOrNew : done)({
          intraday: date === today && sess === "open",
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
  const expectedCodes = new Map(prev.filter(r => isStockOrEtf(r.code)).map(r => [r.code, r.market])); // 代碼 → 上市／上櫃（給基準清單分市場比對）

  // 2. 盤中即時：交易時段（平日 09:00~13:35 且 session 為 open）由 MIS 查詢全市場
  // 修正：不可因 prevDate === today 跳過 MIS，盤中無論 prevDate 為何都應嘗試取最新即時資料
  const tp = new Date(now.getTime() + 8 * 3600e3);
  const minutes = tp.getUTCHours() * 60 + tp.getUTCMinutes();
  const isTradingDay = tp.getUTCDay() % 6 !== 0 && !checkHoliday(today);
  const isTradingHours = isTradingDay && minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
  // 要查哪些股票：OpenAPI 清單拿不到時，用今天最後有效資料的股票清單（以前清單一失敗就整個不問 MIS）
  const misBase = prev.length ? prev : lastGoodToday()?.rows || [];
  const canTryMis = misBase.length > 0 && (sess === "open" || isTradingHours);
  let misStats = null;

  if (canTryMis) {
    try {
      const rows = await misAll(misBase, misFetcher || misFetch, opts.misOpts);
      misStats = rows.stats || null;
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
        return keepOrNew({
          intraday: isLiveSession,
          misStats,
          rows: validation.validRows,
          coverage: validation.coverage,
          live: isLiveSession,
          sourceAgeSec: fresh.ageMs != null ? Math.round(fresh.ageMs / 1000) : null,
          sourceState: fresh.state,
          date: today,
          time: rows.latestByDate?.[today] || null,
          source: sess === "open" ? "證交所 MIS 即時行情（上市、上櫃）" : "證交所 MIS（今天收盤）",
          note: validation.completeness !== "complete" && misStats?.missing ? `MIS 這次不完整（${misMiss(misStats)}），漲跌家數等統計可能少算` : null,
          dataStatus,
          completeness: validation.completeness,
          sourceDate: today,
          dateVerified: validation.dateVerified,
          dateConsistent: validation.dateConsistent,
          sourceCapabilities: { hasOhlc: true, hasValue: true }
        });
      }
      notes.push(misStats?.missing ? `MIS 只拿到 ${todayRows.length} 檔今天的行情（${misMiss(misStats)}）` : "MIS 資料不足或非今日行情");
    } catch (e) { notes.push(`MIS 拿不到（${e.message}）`); }
    // 盤中 MIS 失敗：先用今天最後一筆有效資料，比昨天收盤接近現在
    const lg = sess === "open" ? lastGoodToday() : null;
    if (lg) return keepLast(lg, notes.join("；"));
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
        // 盤中卻只能顯示前一個交易日的收盤：交易日期過舊，標 stale（比 delayed 嚴重），不讓人以為只是慢幾秒
        const dataStatus = sess === "open" && recent.date !== today ? "stale" : deriveDataStatus({
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
          fallbackReason: recent.date !== today && notes.length ? notes.join("；") : undefined,
          misStats: misStats || undefined,
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
      dataStatus: sess === "open" && prevDate !== today ? "stale" : "delayed",
      misStats: misStats || undefined,
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
