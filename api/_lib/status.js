// 資料來源狀態：檢查伺服器讀得到哪些金鑰、富果能不能連上。只回報「有沒有設定」，絕不回傳金鑰內容。
// GET /api/status
// 常見問題：在 Vercel 加了環境變數，但沒有勾 Production（或 Preview），或加完沒有重新部署 → 執行時讀不到。

const KEYS = ["FUGLE_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "FINMIND_TOKEN", "FRED_API_KEY", "FINNHUB_API_KEY"];
export function envReport(env = process.env) {
  const set = Object.fromEntries(KEYS.map(k => [k, !!(env[k] && String(env[k]).trim())]));
  // 名稱相近但不完全一樣的變數（例如多了空白、大小寫不同、拼錯），只列名稱
  const similar = Object.keys(env).filter(n => /fugle|gemini|finmind|anthropic|fred|finnhub/i.test(n) && !KEYS.includes(n));
  const spaced = KEYS.filter(k => env[k] && env[k] !== String(env[k]).trim());
  return { set, similar, spaced, vercelEnv: env.VERCEL_ENV || null };
}
async function pingFugle(key) {
  try {
    const r = await fetch("https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330", { headers: { "X-API-KEY": key.trim() }, signal: AbortSignal.timeout(6000) });
    if (r.ok) return { ok: true };
    return { ok: false, status: r.status, hint: r.status === 401 || r.status === 403 ? "金鑰無效或沒有權限，請到富果開發者網站確認金鑰" : r.status === 429 ? "超過富果免費方案每分鐘的次數上限，稍等再試" : `富果回應 ${r.status}` };
  } catch (e) { return { ok: false, hint: `連不到富果（${e.message}）` }; }
}

// FRED、Finnhub：用最小的一次請求確認金鑰有效（金鑰放在網址或標頭，回報只有狀態碼與提示，不含金鑰）
async function ping(url, headers, bad) {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) }); if (r.ok) return { ok: true };
    return { ok: false, status: r.status, hint: r.status === 400 || r.status === 401 || r.status === 403 ? bad : r.status === 429 ? "超過免費方案的次數上限，稍後會恢復" : `服務回應 ${r.status}` };
  } catch (e) { return { ok: false, hint: `連不到（${e.name === "TimeoutError" ? "逾時" : "網路錯誤"}）` }; }
}
const pingFred = key => ping(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${encodeURIComponent(key.trim())}&file_type=json&limit=1`, { Accept: "application/json" }, "金鑰無效，請到 fredaccount.stlouisfed.org/apikeys 確認");
const pingFinnhub = key => ping("https://finnhub.io/api/v1/quote?symbol=AAPL", { "X-Finnhub-Token": key.trim(), Accept: "application/json" }, "金鑰無效，請到 finnhub.io/dashboard 確認");

export default async function handler(req, res) {
  const rep = envReport();
  const [fugle, fred, finnhub] = await Promise.all([rep.set.FUGLE_API_KEY ? pingFugle(process.env.FUGLE_API_KEY) : null, rep.set.FRED_API_KEY ? pingFred(process.env.FRED_API_KEY) : null, rep.set.FINNHUB_API_KEY ? pingFinnhub(process.env.FINNHUB_API_KEY) : null]);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, ...rep, fugle, fred, finnhub });
}
