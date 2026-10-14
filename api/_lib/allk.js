// 全市場日 K（最近 130 個交易日，約 1800 檔）：給 learner/watch.html「條件選股」「相對強弱」選「全市場」時使用。
// GET /api/allk?s=0..9   → 代號第一碼是 s 的那一份；GET /api/allk?s=meta → 更新時間、日期、檔數
// 資料由排程 scripts/market-scan.mjs 每個交易日收盤後產生，放在 GitHub Release「market-data」（不進 git）；這裡代為讀取並讓 CDN 快取。
const REPO = (process.env.GITHUB_REPO || "kevinlf2904/taiex-monitor-app").trim();
export default async function handler(req, res) {
  const s = String(req.query?.s ?? "");
  if (!/^(\d|meta)$/.test(s)) return res.status(400).json({ ok: false, error: "s 要是 0–9 或 meta" });
  try {
    const r = await fetch(`https://github.com/${REPO}/releases/download/market-data/allk-${s}.json`, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(r.status === 404 ? "全市場資料還沒產生（排程第一次跑完後才有）" : `HTTP ${r.status}`);
    const body = await r.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    return res.status(200).send(body);
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
}
