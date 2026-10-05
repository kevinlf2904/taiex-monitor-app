// 資料來源狀態：檢查伺服器讀得到哪些金鑰、富果能不能連上。只回報「有沒有設定」，絕不回傳金鑰內容。
// GET /api/status
// 常見問題：在 Vercel 加了環境變數，但沒有勾 Production（或 Preview），或加完沒有重新部署 → 執行時讀不到。

const KEYS = ["FUGLE_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "FINMIND_TOKEN"];
export function envReport(env = process.env) {
  const set = Object.fromEntries(KEYS.map(k => [k, !!(env[k] && String(env[k]).trim())]));
  // 名稱相近但不完全一樣的變數（例如多了空白、大小寫不同、拼錯），只列名稱
  const similar = Object.keys(env).filter(n => /fugle|gemini|finmind|anthropic/i.test(n) && !KEYS.includes(n));
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

export default async function handler(req, res) {
  const rep = envReport();
  const fugle = rep.set.FUGLE_API_KEY ? await pingFugle(process.env.FUGLE_API_KEY) : null;
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, ...rep, fugle });
}
