// Finnhub（免費版，需要 FINNHUB_API_KEY；每分鐘 60 次）：Yahoo 拿不到美股報價時的備援，以及美股個股的公司新聞。
// 只用在英文代號的美股個股（指數、期貨、匯率不支援）。金鑰放在請求標頭，不會出現在網址或錯誤訊息裡。
import { num, usName } from "./_yahoo.js";

const BASE = "https://finnhub.io/api/v1", key = () => (process.env.FINNHUB_API_KEY || "").trim();
export const finnhubOn = () => !!key();
export const finnhubOk = sym => /^[A-Z]{1,5}(\.[A-Z])?$/.test(String(sym || ""));
async function get(path, ms = 6000) {
  const r = await fetch(`${BASE}${path}`, { headers: { "X-Finnhub-Token": key(), Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`); return r.json();
}
// /quote → c 現價、d 漲跌、dp 漲跌%、h 高、l 低、o 開、pc 前收、t 秒
export function quoteFromFinnhub(sym, j) {
  const price = num(j?.c), prev = num(j?.pc); if (price == null || !price || !prev) return null;
  const t = num(j?.t), iso = t ? new Date(t * 1000).toISOString() : null;
  return { code: sym, name: usName(sym), market: "美股", currency: "USD", price, prev, open: num(j.o) || null, high: num(j.h) || null, low: num(j.l) || null, vol: null,
    chg: +(price - prev).toFixed(2), chgPct: +((price / prev - 1) * 100).toFixed(2), time: iso ? iso.slice(11, 19) : null, date: iso ? iso.slice(0, 10) : null,
    bids: [], asks: [], estimated: false, us: true, session: { state: "closed", open: "09:30", close: "16:00" }, src: "Finnhub" };
}
export async function finnhubQuote(sym) { if (!key() || !finnhubOk(sym)) throw new Error("Finnhub 不可用"); const q = quoteFromFinnhub(sym, await get(`/quote?symbol=${encodeURIComponent(sym)}`)); if (!q) throw new Error("沒有資料"); return q; }
// /company-news → [{ headline, source, url, datetime(秒) }]
export function newsFromFinnhub(L, limit = 20) {
  const seen = new Set();
  return (Array.isArray(L) ? L : []).map(x => ({ title: String(x?.headline || "").trim(), source: String(x?.source || ""), link: String(x?.url || ""), at: num(x?.datetime) ? x.datetime * 1000 : null }))
    .filter(x => x.title && /^https?:\/\//.test(x.link) && !seen.has(x.title) && seen.add(x.title)).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit);
}
export async function finnhubNews(sym, days = 7) {
  if (!key() || !finnhubOk(sym)) return []; const to = new Date(), from = new Date(Date.now() - days * 864e5), d = x => x.toISOString().slice(0, 10);
  return newsFromFinnhub(await get(`/company-news?symbol=${encodeURIComponent(sym)}&from=${d(from)}&to=${d(to)}`, 8000));
}
