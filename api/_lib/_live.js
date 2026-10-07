// 全市場行情（上市＋上櫃每檔一列）：給 /api/market（大盤）、/api/hot（台股熱門、排行）、/api/screen（選股）共用。
// 順序：1. 富果「快照」API（需要 FUGLE_API_KEY 且方案支援）→ 2. 證交所 MIS 一次查全部（盤中即時、收盤後是今天收盤）
//       → 3. 收盤後的證交所／櫃買當天收盤行情 → 4. OpenAPI（前一個交易日，只有今天還沒開盤或全部失敗時才會用到）。
// 回傳 { rows, live, date, time, source, note }；rows 的格式和 hot.js 的 parseTwseAll 一樣：
//   { code, name, market, price, chg, chgPct, vol（張）, value（億元）, o, h, l, date }

import { parseTwseAll, parseTpexAll, isStockOrEtf } from "./hot.js";
import { session, todayTaipei, misFetch, parseMis } from "./quote.js";
import { closeToday } from "./daily.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const n = v => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);
async function getJSON(url, headers = {}, ms = 12000) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// 富果快照 → 統一格式。成交量單位：富果股票是「張」，保險起見用成交金額反推（金額 ÷（價 × 量）≈ 1000 代表量是張）
export function parseFugleSnapshot(j, market) {
  const date = typeof j?.date === "string" ? j.date.slice(0, 10) : null;
  return (Array.isArray(j?.data) ? j.data : []).map(r => {
    const code = String(r.symbol || "").trim(), price = n(r.closePrice ?? r.lastPrice), chg = n(r.change), vol = n(r.tradeVolume), value = n(r.tradeValue);
    const lots = vol != null && value != null && price ? value / (price * vol) > 100 : true, volLots = vol == null ? null : lots ? vol : Math.round(vol / 1000);
    const pct = n(r.changePercent) ?? (price != null && chg != null && price - chg ? +((chg / (price - chg)) * 100).toFixed(2) : null);
    return { code, name: String(r.name || "").trim(), market, price, chg, chgPct: pct, vol: volLots, value: value != null ? +(value / 1e8).toFixed(2) : null, o: n(r.openPrice), h: n(r.highPrice), l: n(r.lowPrice), date };
  }).filter(x => isStockOrEtf(x.code) && x.price > 0);
}

// MIS 一次查很多檔（每批 100 檔、同時 4 批），盤中與收盤後當天都有當天的價（收盤後 z 就是收盤價）
async function misAll(base) {
  const list = base.filter(r => isStockOrEtf(r.code)), out = [], B = 100;
  const batches = []; for (let i = 0; i < list.length; i += B) batches.push(list.slice(i, i + B));
  let k = 0; const worker = async () => { while (k < batches.length) { const bt = batches[k++];
    try { const rows = await misFetch(bt.map(r => `${r.market === "上櫃" ? "otc" : "tse"}_${r.code.toLowerCase()}.tw`)); out.push(...rows.map(parseMis)); } catch {} } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const by = new Map(base.map(r => [r.code, r]));
  return out.filter(q => q.code && q.price != null && q.prev).map(q => { const o = by.get(q.code) || {};
    return { code: q.code, name: q.name || o.name || "", market: o.market || q.market, price: q.price, chg: q.chg, chgPct: q.chgPct, vol: q.vol, value: q.vol != null ? +((q.vol * 1000 * q.price) / 1e8).toFixed(2) : null, o: q.open, h: q.high, l: q.low, date: q.date }; });
}

let memo = null; // 同一個函式執行個體 15 秒內重用，避免同時好幾個 API 重複向資料源要整個市場
const ymd = iso => iso.replace(/-/g, "");
export async function marketRows() {
  if (memo && Date.now() - memo.at < 15000) return memo.v;
  const key = (process.env.FUGLE_API_KEY || "").trim(), notes = [], today = todayTaipei(), sess = session(), done = v => { memo = { at: Date.now(), v }; return v; };
  // 1. 富果快照（有金鑰而且方案支援）
  if (key) {
    try {
      const base = "https://api.fugle.tw/marketdata/v1.0/stock/snapshot/quotes", h = { "X-API-KEY": key };
      const [t, o] = await Promise.all([getJSON(`${base}/TSE?type=ALLBUT0999`, h), getJSON(`${base}/OTC?type=ALLBUT0999`, h)]);
      const rows = [...parseFugleSnapshot(t, "上市"), ...parseFugleSnapshot(o, "上櫃")];
      if (rows.length > 500) { const date = rows.find(r => r.date)?.date || today; return done({ rows, live: date === today && sess !== "closed", date, time: null, source: "富果行情快照（上市、上櫃）", note: null }); }
      notes.push("富果快照沒有資料");
    } catch (e) { notes.push(`富果快照拿不到（${e.message}）`); }
  }
  // 前一個交易日收盤（OpenAPI）：當作代號清單，也是最後的備案
  const [a, b] = await Promise.allSettled([getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll), getJSON("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll)]);
  const prev = [...(a.value || []), ...(b.value || [])], prevDate = prev.find(r => r.date)?.date || null;
  // 2. 今天已經有新資料（盤中或收盤後）：MIS 一次查全部
  const tp = new Date(Date.now() + 8 * 3600e3), started = tp.getUTCDay() % 6 !== 0 && tp.getUTCHours() * 60 + tp.getUTCMinutes() >= 9 * 60; // 平日 9 點以後才會有今天的資料
  if (prev.length && prevDate !== today && started) {
    try { const rows = await misAll(prev); if (rows.length > 500 && rows.some(r => r.date === today)) return done({ rows: rows.filter(r => r.date === today), live: sess !== "closed", date: today, time: null, source: sess !== "closed" ? "證交所 MIS 即時行情（上市、上櫃）" : "證交所 MIS（今天收盤）", note: null }); notes.push("MIS 還沒有今天的資料"); }
    catch (e) { notes.push(`MIS 拿不到（${e.message}）`); }
    // 3. 收盤後：證交所、櫃買當天收盤行情
    if (sess === "closed") {
      try { const m = await closeToday(ymd(today)); if (m.size > 500) {
        const rows = [...m].map(([code, q]) => ({ code, name: q.name, market: q.market, price: q.p, chg: q.p && q.pct != null ? +(q.p - q.p / (1 + q.pct / 100)).toFixed(2) : null, chgPct: q.pct, vol: q.v, value: q.v != null ? +((q.v * 1000 * q.p) / 1e8).toFixed(2) : null, o: null, h: null, l: null, date: today })).filter(r => isStockOrEtf(r.code));
        return done({ rows, live: false, date: today, time: null, source: "證交所、櫃買中心 今日收盤行情", note: null }); } } catch (e) { notes.push(`今日收盤行情拿不到（${e.message}）`); }
    }
  }
  if (!prev.length) throw new Error([...notes, a.reason?.message, b.reason?.message].filter(Boolean).join("；") || "沒有資料");
  return done({ rows: prev, live: false, date: prevDate, time: null, source: "證交所、櫃買中心 OpenAPI", note: prevDate !== today && started && notes.length ? `今天的資料暫時拿不到（${notes.join("；")}），先顯示 ${prevDate} 收盤` : null });
}
// 快取時間：盤中短（幾十秒就更新），收盤後長
export const liveCache = (live, open = 20) => (live || session() !== "closed" ? `s-maxage=${open}, stale-while-revalidate=${open * 2}` : "s-maxage=300, stale-while-revalidate=900");
