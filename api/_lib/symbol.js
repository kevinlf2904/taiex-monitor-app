// 股票名稱／代號搜尋：給看盤「庫存匯入」用，手打或截圖讀到的名稱對不到代號時查一次。
// GET /api/symbol?q=space exploration → { ok, items: [{ code, name, market }] }
// 來源：Yahoo 奇摩股市的自動完成（台股、美股），再用 Yahoo Finance 搜尋補英文名稱。中文的美股名稱 Yahoo 查不到，網頁端另有對照表。
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" };
const US_EX = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NYS", "NAS"]);
export function pick(list) {
  const out = [];
  for (const r of list || []) {
    const sym = String(r.symbol || ""), ex = String(r.exch || r.exchange || ""), type = String(r.type || r.quoteType || "");
    let code = null, market = null;
    if (/^\d{4,6}[A-Z]?\.TWO?$/.test(sym)) { code = sym.replace(/\.TWO?$/, ""); market = sym.endsWith(".TWO") ? "上櫃" : "上市"; }
    else if (US_EX.has(ex) && /^[A-Z][A-Z.\-]{0,6}$/.test(sym) && /^(S|E|EQUITY|ETF)$/.test(type)) { code = sym.replace(".", "-"); market = "美股"; }
    if (code && !out.some(x => x.code === code)) out.push({ code, name: String(r.name || r.longname || r.shortname || sym).trim(), market });
  }
  return out;
}
export default async function handler(req, res) {
  const q = String(req.query?.q || "").trim().slice(0, 40);
  if (!q) return res.status(400).json({ ok: false, error: "請給要搜尋的名稱或代號" });
  const get = url => fetch(url, { headers: UA, signal: AbortSignal.timeout(6000) }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [a, b] = await Promise.all([get(`https://tw.stock.yahoo.com/_td-stock/api/resource/AutocompleteService;query=${encodeURIComponent(q)}`), /^[\x20-\x7e]+$/.test(q) ? get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`) : null]);
  const items = pick([...(a?.ResultSet?.Result || []), ...(b?.quotes || [])]).slice(0, 6);
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({ ok: true, q, items });
}
