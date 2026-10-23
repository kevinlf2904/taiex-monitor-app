// 資料來源狀態：檢查伺服器讀得到哪些金鑰、富果能不能連上。只回報「有沒有設定」，絕不回傳金鑰內容。
// GET /api/status
// GET /api/status?bench=1  美股報價速度比較：Yahoo 與 Finnhub 各抓 3 次 AAPL、NVDA，回報花多少毫秒與報價時間（Yahoo 是美東時間、Finnhub 是 UTC；不含金鑰）
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

async function bench() {
  const { yahooQuote } = await import("./_yahoo.js"), { finnhubQuote, finnhubOn } = await import("./_finnhub.js"), out = {};
  for (const [k, f] of [["yahoo", yahooQuote], ...(finnhubOn() ? [["finnhub", finnhubQuote]] : [])]) {
    const ms = [], px = []; let err = null;
    for (let i = 0; i < 3; i++) for (const s of ["AAPL", "NVDA"]) { const t0 = Date.now(); try { const q = await f(s); ms.push(Date.now() - t0); px.push(`${s}=${q.price}@${q.time || "?"}${k === "finnhub" ? "Z" : "ET"}`); } catch (e) { err = e.message; } }
    const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    out[k] = { n: ms.length, avgMs: avg(ms), maxMs: ms.length ? Math.max(...ms) : null, sample: px.slice(0, 2), err };
  }
  return out;
}
const LAST = { at: 0, v: null };
export default async function handler(req, res) {
  // bench 會連打 12 次報價：要帶伺服器設定的 STATUS_KEY 才跑，避免被拿來耗光 Finnhub 每分鐘的額度
  if (req.query?.bench) { const k = (process.env.STATUS_KEY || "").trim(); if (!k || req.query.key !== k) return res.status(403).json({ ok: false, error: "測速要帶 key" }); res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: true, bench: await bench(), at: new Date().toISOString() }); }
  // 網址多帶其他參數（例如亂數）會讓 CDN 快取對不到，每次都真的去連外部服務、耗掉額度：轉回標準網址；同一個執行個體 60 秒內也直接回上一次的結果
  if (Object.keys(req.query || {}).length) { res.setHeader("Location", "/api/status"); return res.status(308).end(); }
  if (Date.now() - LAST.at < 60e3) { res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120"); return res.status(200).json(LAST.v); }
  const rep = envReport();
  const [fugle, fred, finnhub] = await Promise.all([rep.set.FUGLE_API_KEY ? pingFugle(process.env.FUGLE_API_KEY) : null, rep.set.FRED_API_KEY ? pingFred(process.env.FRED_API_KEY) : null, rep.set.FINNHUB_API_KEY ? pingFinnhub(process.env.FINNHUB_API_KEY) : null]);
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120"); // 每分鐘最多真的連一次外部服務
  LAST.v = { ok: true, ...rep, fugle, fred, finnhub }; LAST.at = Date.now();
  return res.status(200).json(LAST.v);
}
