// 殖利率：近 12 個月（365 天）的現金股利合計 ÷ 股價，給 learner/watch.html 的個股頁與 ETF 殖利率排行使用。
// GET /api/yield?codes=2330,0056,00679B → { ok, rows: [{ code, cash12, n, last: { d, cash }, price, yield }], missing }；加 &hist=1 另外附 divs: [[除息日, 每股現金]]
//   cash12 近 12 個月現金股利（元／股）、n 配息次數、months 近 12 個月在哪幾個月除息（存股「月月配組合」用）、last 最近一次配息、price 計算用的股價（Yahoo 最新價）、yield 殖利率（%）
// 配息紀錄：Yahoo Finance chart 的 events=div（上市 .TW、上櫃 .TWO，股票、ETF 都有）；Yahoo 沒有時改用 FinMind 除權息結果（只算「息」）。
// 股票股利不算進殖利率（只算現金）；同一個伺服器實例 6 小時內重複查詢直接用快取。

import { getJSON as yGet, num } from "./_yahoo.js";

const DAY = 864e5, cache = new Map(), TTL = 6 * 3600e3;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const okCode = c => /^\d{4,6}[A-Z]?$/.test(c);

// Yahoo chart（events=div）→ { divs: [{ d, cash }], price }；日期用台北時間
export function divsFromYahoo(j) {
  const r = j?.chart?.result?.[0]; if (!r?.meta) return null;
  const off = (r.meta.gmtoffset ?? 28800) * 1000;
  const divs = Object.values(r.events?.dividends || {}).map(x => ({ d: iso(x.date * 1000 + off), cash: num(x.amount) })).filter(x => x.cash > 0).sort((a, b) => a.d.localeCompare(b.d));
  return { divs, price: num(r.meta.regularMarketPrice) };
}
// FinMind TaiwanStockDividendResult → [{ d, cash }]（只取除息；除權息的「權＋息」分不開，略過）
export function divsFromFinmind(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => String(r.stock_or_cache_dividend || "").trim() === "息").map(r => ({ d: String(r.date).slice(0, 10), cash: num(r.stock_and_cache_dividend), price: num(r.before_price) }))
    .filter(x => x.cash > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.d)).sort((a, b) => a.d.localeCompare(b.d));
}
// 近 12 個月合計與殖利率
export function summarize(code, divs, price, now = Date.now()) {
  const from = iso(now - 365 * DAY), L = divs.filter(x => x.d > from), cash12 = +L.reduce((s, x) => s + x.cash, 0).toFixed(4), last = divs[divs.length - 1] || null;
  return { code, cash12, n: L.length, months: [...new Set(L.map(x => +x.d.slice(5, 7)))].sort((a, b) => a - b), last: last ? { d: last.d, cash: last.cash } : null, price: price ?? null, yield: price > 0 ? +((cash12 / price) * 100).toFixed(2) : null };
}

async function fromYahoo(code) {
  for (const sym of [`${code}.TW`, `${code}.TWO`]) {
    try { const r = divsFromYahoo(await yGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo&events=div`, {}, 7000)); if (r && r.price) return r; } catch {}
  }
  return null;
}
async function fromFinmind(code) {
  const token = (process.env.FINMIND_TOKEN || "").trim();
  const r = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockDividendResult&data_id=${code}&start_date=${iso(Date.now() - 3650 * DAY)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => null); if (!Array.isArray(j?.data)) throw new Error(j?.msg || `HTTP ${r.status}`);
  const divs = divsFromFinmind(j.data); return { divs, price: null };
}
export async function yieldOf(code) {
  const hit = cache.get(code); if (hit && Date.now() - hit.at < TTL) return hit.v;
  let r = await fromYahoo(code);
  if (!r || !r.divs.length) { try { const f = await fromFinmind(code); if (f.divs.length || !r) r = { divs: f.divs, price: r?.price ?? null, src: "FinMind 除權息結果" }; } catch {} }
  if (!r) return null;
  const v = { ...summarize(code, r.divs, r.price), divs: r.divs.map(x => [x.d, x.cash]), source: r.src || "Yahoo Finance 配息紀錄" };
  cache.set(code, { at: Date.now(), v }); return v;
}

export default async function handler(req, res) {
  const codes = [...new Set(String(req.query?.codes ?? req.query?.code ?? "").split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(okCode))].slice(0, 40);
  if (!codes.length) return res.status(400).json({ ok: false, error: "請給台股代號，例如 ?codes=2330,0056" });
  const out = []; let k = 0;
  const worker = async () => { while (k < codes.length) { const c = codes[k++]; try { const v = await yieldOf(c); if (v) out.push(v); } catch {} } };
  await Promise.all(Array.from({ length: Math.min(6, codes.length) }, worker));
  const hist = !!req.query?.hist, rows = codes.map(c => out.find(x => x.code === c)).filter(Boolean).map(({ divs, ...x }) => (hist ? { ...x, divs } : x)); // hist=1：附上近 10 年每次配息 [日期, 元]（庫存「已領股息」、存股試算用）
  if (!rows.length) return res.status(200).json({ ok: false, error: "暫時拿不到配息資料（Yahoo Finance、FinMind），稍後再試。" });
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json({ ok: true, source: "Yahoo Finance 配息紀錄（近 12 個月現金股利）", rows, missing: codes.filter(c => !rows.some(r => r.code === c)) });
}
