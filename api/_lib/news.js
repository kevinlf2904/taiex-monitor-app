// 個股新聞：給 learner/watch.html 個股頁的「新聞」分頁使用。
// GET /api/news?q=台積電&code=2330 → { ok, items: [{ title, source, link, at }] }
// 來源是 Google 新聞的 RSS 搜尋（公開、免金鑰）；只回傳標題、來源與連結，內文請點連結到原網站看。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/rss+xml, application/xml, text/xml" };
const unesc = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? unesc(m[1]) : ""; };

export function parseRss(xml, limit = 30) {
  const items = [], seen = new Set();
  for (const m of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1], source = tag(x, "source");
    let title = tag(x, "title"); if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(x, "link"), at = Date.parse(tag(x, "pubDate"));
    if (!title || !/^https?:\/\//.test(link) || seen.has(title)) continue;
    seen.add(title); items.push({ title, source, link, at: Number.isFinite(at) ? at : null });
  }
  return items.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit);
}

export default async function handler(req, res) {
  const q = String(req.query?.q || "").trim().slice(0, 40), code = String(req.query?.code || "").trim().toUpperCase().slice(0, 10);
  if (!q && !code) return res.status(400).json({ ok: false, error: "請提供股票名稱或代號" });
  // 台股用「名稱 代號」比較準；美股用代號加 stock
  const term = /^\d{4,6}[A-Z]?$/.test(code) ? `${q || code} ${code}` : /^[A-Z.^-]{1,8}$/.test(code) ? `${code} ${q && q !== code ? q : "stock"}` : q;
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(term)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`, { headers: UA, signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = parseRss(await r.text());
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ ok: true, q: term, source: "Google 新聞", items });
  } catch (e) { return res.status(200).json({ ok: false, error: `拿不到新聞（${e.message}）` }); }
}
