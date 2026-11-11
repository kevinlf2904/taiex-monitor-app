// 熱門股與排行：給 learner/watch.html 的「台股熱門」「美股熱門」「排行」使用。
// GET /api/hot?market=tw&type=value      成交值排行（value）、成交量（volume）、漲幅（gain）、跌幅（loss）、外資買超（foreign）、投信買超（trust）
// GET /api/hot?market=us&type=active     美股最活躍（active）、漲幅（gain）、跌幅（loss）
// GET /api/hot?market=tw&type=rows&codes=2330,2454,…  指定代號的即時精簡行情 rows: [[代號, 價, 漲跌%, 成交金額（億）], …]（大盤「產業即時」用，最多 400 檔；codes=all 回全部上市櫃普通股）
// 台股成交值／量、漲跌幅排行用 _live.js（盤中是富果行情快照，沒有金鑰時是前一個交易日收盤）；法人買賣超是證交所 T86（收盤後公布，只有上市）。

import { usHot } from "./_yahoo.js";
import { marketRows, liveCache } from "./_live.js";
import { num, getJSON, rocDate } from "./_tw.js";
const pick = (r, ...keys) => { for (const k of keys) if (r[k] != null && r[k] !== "") return r[k]; return null; };
// 股票與 ETF（排除權證、債券等）
export const isStockOrEtf = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c);
function row(code, name, market, close, chg, volShares, value) {
  const prev = close != null && chg != null ? close - chg : null;
  return { code, name, market, price: close, chg, chgPct: prev ? +((chg / prev) * 100).toFixed(2) : null, vol: volShares != null ? Math.round(volShares / 1000) : null, value: value != null ? +(value / 1e8).toFixed(2) : null };
}
export function parseTwseAll(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({ ...row(String(r.Code).trim(), String(r.Name).trim(), "上市", num(r.ClosingPrice), num(r.Change), num(r.TradeVolume), num(r.TradeValue)), o: num(r.OpeningPrice), h: num(r.HighestPrice), l: num(r.LowestPrice), date: rocDate(r.Date) }))
    .filter(x => isStockOrEtf(x.code) && x.price > 0);
}
export function parseTpexAll(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({ ...row(String(pick(r, "SecuritiesCompanyCode", "Code") || "").trim(), String(pick(r, "CompanyName", "Name") || "").trim(), "上櫃", num(pick(r, "Close", "ClosingPrice")), num(pick(r, "Change")), num(pick(r, "TradingShares", "TradeVolume")), num(pick(r, "TransactionAmount", "TradeValue"))), o: num(pick(r, "Open", "OpeningPrice")), h: num(pick(r, "High", "HighestPrice")), l: num(pick(r, "Low", "LowestPrice")), date: rocDate(r.Date) }))
    .filter(x => isStockOrEtf(x.code) && x.price > 0);
}
// 證交所 T86：三大法人買賣超（股 → 張）
// 欄位名稱要「整個一樣」才算：真實表頭有 19 欄，「外資自營商買賣超股數」「自營商買賣超股數(自行買賣)」都包含「自營商買賣超股數」這幾個字，
// 用「包含」比對會把自營商欄誤配到外資自營商（#262 FIN-03）。來源沒給、或是 "--" 的欄位是 null，不是 0（和 api/_lib/daily.js 的 parseInst 一致）。
const lot = v => { const n = num(v); return n == null ? null : Math.round(n / 1000); };
export function parseT86(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const f = (j.fields || []).map(x => String(x).replace(/\s/g, "")), exact = (...ks) => f.findIndex(x => ks.includes(x));
  const iC = exact("證券代號"), iN = exact("證券名稱"), iF = exact("外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數", "外資買賣超股數"), iT = exact("投信買賣超股數"), iD = exact("自營商買賣超股數"), iA = exact("三大法人買賣超股數");
  if (iC < 0) return null; // 表頭認不得：不要用錯的欄位硬算
  const at = (r, i) => (i >= 0 ? lot(r[i]) : null);
  return j.data.map(r => ({ code: String(r[iC]).trim(), name: iN >= 0 ? String(r[iN]).trim() : "", market: "上市", foreign: at(r, iF), trust: at(r, iT), dealer: at(r, iD), total: at(r, iA) }))
    .filter(x => isStockOrEtf(x.code));
}
const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
async function t86Latest() {
  const d = new Date(Date.now() + 8 * 3600e3);
  for (let k = 0; k < 8; k++) {
    try { const rows = parseT86(await getJSON(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd(d)}&selectType=ALLBUT0999&response=json`)); if (rows && rows.length) return { date: `${ymd(d).slice(0, 4)}-${ymd(d).slice(4, 6)}-${ymd(d).slice(6)}`, rows }; } catch {}
    d.setDate(d.getDate() - 1);
  }
  return null;
}
const TW_TYPES = { value: "成交值", volume: "成交量", gain: "漲幅", loss: "跌幅", foreign: "外資買超", trust: "投信買超", etf: "ETF" };

export default async function handler(req, res, { marketFetcher = marketRows } = {}) {
  const market = req.query?.market === "us" ? "us" : "tw", type = String(req.query?.type || (market === "us" ? "active" : "value"));
  try {
    if (market === "us") {
      const h = await usHot(type);
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ ok: true, market, type, source: h.source, rows: h.rows.slice(0, 30) });
    }
    if (type === "rows") {
      const all = req.query?.codes === "all", want = new Set(String(req.query?.codes || "").split(",").map(c => c.trim()).filter(c => /^\d{4,6}[A-Z]?$/.test(c)).slice(0, 400)), L = await marketFetcher();
      res.setHeader("Cache-Control", liveCache(L.live, 10));
      return res.status(200).json({ ok: true, market, type, date: L.date, live: L.live, time: L.time, source: L.source, completeness: L.completeness || null, dataStatus: L.dataStatus || null, coverage: L.coverage || null, dateVerified: L.dateVerified ?? null, dateConsistent: L.dateConsistent ?? null, at: Date.now(), rows: L.rows.filter(r => (all ? /^\d{4}$/.test(r.code) : want.has(r.code))).map(r => [r.code, r.price, r.chgPct, r.value]) });
    }
    if (!TW_TYPES[type]) return res.status(400).json({ ok: false, error: `type 要是 ${Object.keys(TW_TYPES).join("、")} 其中之一` });
    let rows, date, source, live = false, time = null, L = null;
    if (type === "foreign" || type === "trust") {
      const t = await t86Latest(); if (!t) throw new Error("證交所三大法人資料暫時拿不到");
      rows = t.rows.filter(r => r[type] != null).sort((a, b) => b[type] - a[type]).slice(0, 30); // 沒有這一欄資料的不排進去 date = t.date; source = "證交所 三大法人買賣超（上市）";
    } else {
      L = await marketFetcher(); const all = L.rows.slice(); live = L.live;
      date = L.date || all.find(x => x.date)?.date || null; source = L.source; time = L.time;
      const liquid = all.filter(x => (x.vol || 0) >= 500); // 漲跌幅排行排除成交太少的
      rows = type === "etf" ? all.filter(x => /^00\d{2,4}[A-Z]?$/.test(x.code)).sort((x, y) => (y.value || 0) - (x.value || 0)) // ETF 排行：全部 ETF 依成交值（前端再依量、漲跌幅排序）
        : type === "value" ? all.sort((x, y) => (y.value || 0) - (x.value || 0)) : type === "volume" ? all.sort((x, y) => (y.vol || 0) - (x.vol || 0))
        : type === "gain" ? liquid.sort((x, y) => (y.chgPct ?? -1e9) - (x.chgPct ?? -1e9)) : liquid.sort((x, y) => (x.chgPct ?? 1e9) - (y.chgPct ?? 1e9));
      rows = rows.slice(0, type === "etf" ? 200 : 30).map(({ date: _, ...x }) => x);
    }
    res.setHeader("Cache-Control", type === "foreign" || type === "trust" ? "s-maxage=600, stale-while-revalidate=1800" : liveCache(live, 20));
    return res.status(200).json({ ok: true, market, type, label: TW_TYPES[type], date, live, time, source, completeness: L?.completeness || null, dataStatus: L?.dataStatus || null, coverage: L?.coverage || null, dateVerified: L?.dateVerified ?? null, dateConsistent: L?.dateConsistent ?? null, rows });
  } catch (e) { return res.status(200).json({ ok: false, error: `拿不到${market === "us" ? "美股熱門" : TW_TYPES[type] || ""}資料（${e.message}）` }); }
}
