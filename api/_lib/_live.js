// 全市場行情（上市＋上櫃每檔一列）：給 /api/market（大盤）、/api/hot（台股熱門、排行）、/api/screen（選股）共用。
// 盤中與收盤後當天優先用富果「快照」API（每檔最新成交價，幾秒內的資料），需要 FUGLE_API_KEY；
// 沒有金鑰、方案不支援或連不上時，改用證交所／櫃買中心 OpenAPI（前一個交易日收盤後的統計）。
// 回傳 { rows, live, date, time, source, note }；rows 的格式和 hot.js 的 parseTwseAll 一樣：
//   { code, name, market, price, chg, chgPct, vol（張）, value（億元）, o, h, l, date }

import { parseTwseAll, parseTpexAll, isStockOrEtf } from "./hot.js";
import { session, todayTaipei } from "./quote.js";

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

let memo = null; // 同一個函式執行個體 15 秒內重用，避免同時好幾個 API 重複向富果要整個市場
export async function marketRows() {
  if (memo && Date.now() - memo.at < 15000) return memo.v;
  const key = (process.env.FUGLE_API_KEY || "").trim(), notes = [];
  if (key) {
    try {
      const base = "https://api.fugle.tw/marketdata/v1.0/stock/snapshot/quotes", h = { "X-API-KEY": key };
      const [t, o] = await Promise.all([getJSON(`${base}/TSE?type=ALLBUT0999`, h), getJSON(`${base}/OTC?type=ALLBUT0999`, h)]);
      const rows = [...parseFugleSnapshot(t, "上市"), ...parseFugleSnapshot(o, "上櫃")];
      if (rows.length > 500) {
        const date = rows.find(r => r.date)?.date || todayTaipei(), time = String(t.time || t.lastUpdated || "") || null, sess = session();
        const v = { rows, live: date === todayTaipei() && sess !== "closed", date, time, source: "富果行情快照（上市、上櫃）", note: null };
        memo = { at: Date.now(), v }; return v;
      }
      notes.push("富果快照沒有資料");
    } catch (e) { notes.push(`富果快照拿不到（${e.message}）`); }
  }
  const [a, b] = await Promise.allSettled([getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll), getJSON("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll)]);
  const rows = [...(a.value || []), ...(b.value || [])];
  if (!rows.length) throw new Error([...notes, a.reason?.message, b.reason?.message].filter(Boolean).join("；") || "沒有資料");
  const v = { rows, live: false, date: rows.find(r => r.date)?.date || null, time: null, source: "證交所、櫃買中心 OpenAPI（前一個交易日收盤）", note: key ? notes.join("；") || null : "沒有設定富果金鑰，盤中顯示的是前一個交易日的統計" };
  memo = { at: Date.now(), v }; return v;
}
// 快取時間：盤中短（幾十秒就更新），收盤後長
export const liveCache = (live, open = 20) => (live || session() !== "closed" ? `s-maxage=${open}, stale-while-revalidate=${open * 2}` : "s-maxage=300, stale-while-revalidate=900");
