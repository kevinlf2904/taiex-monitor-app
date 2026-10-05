// 股票代號與名稱清單：給 learner/watch.html 的搜尋（輸入「台積」也找得到 2330）。
// GET /api/stocks → { ok, list: [["2330", "台積電", "上市"], ...] }
// 來源：證交所 OpenAPI（上市，含 ETF）、櫃買中心 OpenAPI（上櫃）。清單一天更新一次就夠，快取一天。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const clean = s => String(s ?? "").trim();
export function parseTwse(rows) { return (Array.isArray(rows) ? rows : []).map(r => [clean(r.Code), clean(r.Name), "上市"]).filter(([c, n]) => /^\d{4,6}[A-Z]?$/.test(c) && n); }
export function parseTpex(rows) { return (Array.isArray(rows) ? rows : []).map(r => [clean(r.SecuritiesCompanyCode ?? r.Code), clean(r.CompanyName ?? r.Name), "上櫃"]).filter(([c, n]) => /^\d{4,6}[A-Z]?$/.test(c) && n); }

export default async function handler(req, res) {
  const [a, b] = await Promise.allSettled([
    getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwse),
    getJSON("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpex),
  ]);
  const seen = new Set(), list = [...(a.value || []), ...(b.value || [])].filter(([c]) => !seen.has(c) && seen.add(c));
  if (!list.length) return res.status(200).json({ ok: false, error: `拿不到股票清單（${[a.reason?.message, b.reason?.message].filter(Boolean).join("；")}）` });
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({ ok: true, count: list.length, list });
}
