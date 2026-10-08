// 熱門股與排行：給 learner/watch.html 的「台股熱門」「美股熱門」「排行」使用。
// GET /api/hot?market=tw&type=value      成交值排行（value）、成交量（volume）、漲幅（gain）、跌幅（loss）、外資買超（foreign）、投信買超（trust）
// GET /api/hot?market=us&type=active     美股最活躍（active）、漲幅（gain）、跌幅（loss）
// 台股成交值／量、漲跌幅排行用 _live.js（盤中是富果行情快照，沒有金鑰時是前一個交易日收盤）；法人買賣超是證交所 T86（收盤後公布，只有上市）。

import { usHot } from "./_yahoo.js";
import { marketRows, liveCache } from "./_live.js";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const num = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[,\s+]/g, "")); return Number.isFinite(n) ? n : null; };
const pick = (r, ...keys) => { for (const k of keys) if (r[k] != null && r[k] !== "") return r[k]; return null; };
// 股票與 ETF（排除權證、債券等）
export const isStockOrEtf = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c);
async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const rocDate = s => { const m = String(s || "").match(/^(\d{3})(\d{2})(\d{2})$/); return m ? `${+m[1] + 1911}-${m[2]}-${m[3]}` : /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null; };
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
export function parseT86(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const f = (j.fields || []).map(x => String(x).replace(/\s/g, "")), at = (...ks) => f.findIndex(x => ks.every(k => x.includes(k)));
  const iC = at("證券代號"), iN = at("證券名稱"), iF = at("外陸資買賣超股數", "不含"), iF2 = at("外資買賣超股數"), iT = at("投信買賣超股數"), iD = at("自營商買賣超股數"), iA = at("三大法人買賣超股數");
  return j.data.map(r => ({ code: String(r[iC]).trim(), name: String(r[iN]).trim(), market: "上市", foreign: Math.round((num(r[iF >= 0 ? iF : iF2]) || 0) / 1000), trust: Math.round((num(r[iT]) || 0) / 1000), dealer: Math.round((num(r[iD]) || 0) / 1000), total: Math.round((num(r[iA]) || 0) / 1000) }))
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

export default async function handler(req, res) {
  const market = req.query?.market === "us" ? "us" : "tw", type = String(req.query?.type || (market === "us" ? "active" : "value"));
  try {
    if (market === "us") {
      const h = await usHot(type);
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ ok: true, market, type, source: h.source, rows: h.rows.slice(0, 30) });
    }
    if (!TW_TYPES[type]) return res.status(400).json({ ok: false, error: `type 要是 ${Object.keys(TW_TYPES).join("、")} 其中之一` });
    let rows, date, source, live = false, time = null;
    if (type === "foreign" || type === "trust") {
      const t = await t86Latest(); if (!t) throw new Error("證交所三大法人資料暫時拿不到");
      rows = t.rows.sort((a, b) => b[type] - a[type]).slice(0, 30); date = t.date; source = "證交所 三大法人買賣超（上市）";
    } else {
      const L = await marketRows(), all = L.rows.slice(); live = L.live;
      date = L.date || all.find(x => x.date)?.date || null; source = L.source; time = L.time;
      const liquid = all.filter(x => (x.vol || 0) >= 500); // 漲跌幅排行排除成交太少的
      rows = type === "etf" ? all.filter(x => /^00\d{2,4}[A-Z]?$/.test(x.code)).sort((x, y) => (y.value || 0) - (x.value || 0)) // ETF 排行：全部 ETF 依成交值（前端再依量、漲跌幅排序）
        : type === "value" ? all.sort((x, y) => (y.value || 0) - (x.value || 0)) : type === "volume" ? all.sort((x, y) => (y.vol || 0) - (x.vol || 0))
        : type === "gain" ? liquid.sort((x, y) => (y.chgPct ?? -1e9) - (x.chgPct ?? -1e9)) : liquid.sort((x, y) => (x.chgPct ?? 1e9) - (y.chgPct ?? 1e9));
      rows = rows.slice(0, type === "etf" ? 200 : 30).map(({ date: _, ...x }) => x);
    }
    res.setHeader("Cache-Control", type === "foreign" || type === "trust" ? "s-maxage=600, stale-while-revalidate=1800" : liveCache(live, 20));
    return res.status(200).json({ ok: true, market, type, label: TW_TYPES[type], date, live, time, source, rows });
  } catch (e) { return res.status(200).json({ ok: false, error: `拿不到${market === "us" ? "美股熱門" : TW_TYPES[type] || ""}資料（${e.message}）` }); }
}
