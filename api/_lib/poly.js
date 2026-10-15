// 預測市場：Polymarket 公開 API（gamma-api，不需要金鑰）裡會影響股市的賭盤，給 learner/watch.html「大盤 → 預測市場」使用。
// GET /api/poly → { ok, at, events: [{ id, title, url, cat, vol, vol24, end, markets: [{ q, label, yes, d1 }] }] }
// 依標籤抓成交量最大的進行中事件，再用關鍵字分類（聯準會、經濟數據、關稅貿易、地緣政治、美股、加密貨幣…），快取 5 分鐘。
const GAMMA = "https://gamma-api.polymarket.com/events";
const TAGS = ["fed-rates", "economy", "finance", "business", "tariffs", "geopolitics", "stocks", "crypto", "china", "taiwan", "politics"];
// [分類, 關鍵字]：第一個符合的分類；都不符合的事件不列（運動、娛樂…）
export const CATS = [
  ["聯準會與利率", /\bfed\b|fomc|interest rate|rate (cut|hike)|powell|federal reserve|bps\b|treasury yield|10-year/i],
  ["經濟數據與衰退", /recession|inflation|\bcpi\b|\bgdp\b|unemployment|jobs report|payroll|nonfarm|economy|pce\b|soft landing|stagflation/i],
  ["關稅與貿易", /tariff|trade (deal|war)|export control|sanction|customs/i],
  ["台海與地緣政治", /taiwan|china|xi jinping|invade|invasion|blockade|ukraine|russia|israel|iran|\bwar\b|ceasefire|nato|north korea|strait/i],
  ["美股與企業", /s&p|nasdaq|dow jones|\bspx\b|stock|nvidia|nvda|tesla|apple|microsoft|tsmc|ipo\b|earnings|market cap|largest company|\bai\b/i],
  ["美國政治與財政", /shutdown|debt ceiling|budget|government|trump|election|congress|senate|president/i],
  ["原物料與加密貨幣", /oil|crude|gold|bitcoin|\bbtc\b|ethereum|\beth\b|opec/i],
];
const J = s => { try { return Array.isArray(s) ? s : JSON.parse(s || "[]"); } catch { return []; } };
export const catOf = t => CATS.find(([, re]) => re.test(t))?.[0] || null;
export function normEvent(e) {
  const cat = catOf(`${e.title || ""} ${(e.tags || []).map(t => t.label).join(" ")}`); if (!cat) return null;
  const markets = (e.markets || []).filter(m => !m.closed && m.active !== false).map(m => { const o = J(m.outcomes), p = J(m.outcomePrices).map(Number), iy = o.findIndex(x => /^yes$/i.test(x));
    const yes = p.length ? (iy >= 0 ? p[iy] : p[0]) : null; return { q: m.question || "", label: m.groupItemTitle || (o.length === 2 && iy >= 0 ? "" : o[0] || ""), yes: Number.isFinite(yes) ? +yes.toFixed(4) : null, d1: Number.isFinite(+m.oneDayPriceChange) ? +(+m.oneDayPriceChange).toFixed(4) : null, vol: +m.volumeNum || +m.volume || 0 }; })
    .filter(m => m.yes != null).sort((a, b) => b.yes - a.yes).slice(0, 8);
  if (!markets.length) return null;
  return { id: String(e.id), title: e.title || "", url: e.slug ? `https://polymarket.com/event/${e.slug}` : "https://polymarket.com", cat, vol: Math.round(+e.volume || 0), vol24: Math.round(+e.volume24hr || 0), end: String(e.endDate || "").slice(0, 10) || null, markets };
}

let memo = null;
export default async function handler(req, res) {
  if (memo && Date.now() - memo.at < 120e3) { res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900"); return res.status(200).json(memo.v); }
  const got = await Promise.allSettled(TAGS.map(async t => { const r = await fetch(`${GAMMA}?active=true&closed=false&archived=false&limit=40&order=volume24hr&ascending=false&tag_slug=${t}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }));
  const seen = new Set(), events = [];
  for (const g of got) if (g.status === "fulfilled" && Array.isArray(g.value)) for (const e of g.value) { if (seen.has(String(e.id))) continue; seen.add(String(e.id)); const x = normEvent(e); if (x && x.vol >= 50000) events.push(x); }
  if (!events.length) return res.status(200).json({ ok: false, error: `暫時拿不到 Polymarket 資料（${got.map(g => g.reason?.message).filter(Boolean)[0] || "沒有符合的事件"}）` });
  events.sort((a, b) => b.vol24 - a.vol24);
  const v = { ok: true, at: new Date().toISOString(), source: "Polymarket（gamma-api 公開資料）", events: events.slice(0, 80) };
  memo = { at: Date.now(), v };
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
  return res.status(200).json(v);
}
