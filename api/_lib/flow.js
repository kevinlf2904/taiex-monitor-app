// 盤中籌碼流向：給 learner/watch.html 走勢分頁的「明細」「分價量」「大戶散戶」使用。
// GET /api/flow?code=2330
// 需要富果 API 金鑰（FUGLE_API_KEY）：用 intraday/trades（逐筆成交）與 intraday/volumes（分價量表）。
// 逐筆成交的買賣方向：成交價 ≥ 委賣價 → 外盤（主動買）；≤ 委買價 → 內盤（主動賣）；兩者之間用前一筆價格判斷（上漲算買、下跌算賣）。
// 大戶／散戶用「單筆成交金額」分：每分鐘的買賣量依金額分成 4 級（<100 萬、100–300 萬、300–1000 萬、≥1000 萬），由頁面依使用者選的門檻加總。
// 回傳 { ok, date, from, complete, trades: [最近 80 筆], minutes: [{ t, b: [4 級買量], s: [4 級賣量] }], vbp: [{ p, v, b, s }], unit: "張" }
import { errText } from "./_err.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const num = v => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);
export const BUCKETS = [100e4, 300e4, 1000e4]; // 單筆成交金額分級（元）
const PAGE = 500, MAX_PAGES = 16;

export const bucketOf = value => (value < BUCKETS[0] ? 0 : value < BUCKETS[1] ? 1 : value < BUCKETS[2] ? 2 : 3);
// 富果的時間是微秒（epoch），也接受秒、毫秒或 ISO 字串 → 台北時間 HH:MM:SS
export function hms(x) {
  let ms = typeof x === "number" ? x : Date.parse(x);
  if (!Number.isFinite(ms)) return null;
  if (ms > 1e15) ms = ms / 1000; else if (ms < 1e12) ms = ms * 1000;
  return new Date(ms + 8 * 3600e3).toISOString().slice(11, 19);
}
// 逐筆（時間由舊到新）→ 加上買賣方向
export function classify(trades) {
  let last = null, dir = 0;
  return trades.map(t => {
    const p = t.price;
    if (t.ask != null && p >= t.ask) dir = 1; else if (t.bid != null && p <= t.bid) dir = -1;
    else if (last != null && p !== last) dir = p > last ? 1 : -1; // 價格沒變就沿用上一筆的方向
    last = p;
    return { ...t, side: dir };
  });
}
export function summarize(trades) {
  const byMin = new Map();
  for (const t of trades) {
    if (!t.side || !t.size) continue;
    const m = t.t.slice(0, 5); let r = byMin.get(m); if (!r) byMin.set(m, (r = { t: m, b: [0, 0, 0, 0], s: [0, 0, 0, 0] }));
    (t.side > 0 ? r.b : r.s)[bucketOf(t.size * t.price * 1000)] += t.size;
  }
  return [...byMin.values()].sort((a, b) => a.t.localeCompare(b.t));
}
// 資金分佈：各級主動買、主動賣的成交金額（元）
export function moneyByBucket(trades) {
  const b = [0, 0, 0, 0], s = [0, 0, 0, 0];
  for (const t of trades) { if (!t.side || !t.size) continue; const v = t.size * t.price * 1000; (t.side > 0 ? b : s)[bucketOf(v)] += v; }
  return { b: b.map(Math.round), s: s.map(Math.round) };
}
export function parseTrades(j) {
  return (j?.data || []).map(x => ({ t: hms(x.time ?? x.at ?? x.date), price: num(x.price), size: num(x.size) ?? 0, bid: num(x.bid), ask: num(x.ask), serial: x.serial ?? null, raw: x.time }))
    .filter(x => x.t && x.price != null);
}
export function parseVolumes(j) {
  return (j?.data || []).map(x => ({ p: num(x.price), v: num(x.volume) ?? 0, b: num(x.volumeAtAsk) ?? null, s: num(x.volumeAtBid) ?? null })).filter(x => x.p != null).sort((a, b) => b.p - a.p);
}

async function getJSON(url, key) {
  const r = await fetch(url, { headers: { ...UA, "X-API-KEY": key }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// 同一個伺服器執行個體記住今天已經抓過的逐筆，下次只補最新的幾頁（富果免費方案每分鐘有次數上限）
const memo = new Map();
export const _resetFlowMemo = () => memo.clear(); // 測試用
const keyOf = t => `${t.raw}|${t.serial}|${t.price}|${t.size}`;
// 逐筆成交（富果由新到舊，用 offset 分頁）。要處理的狀況（#262 FIN-01）：
//   1. 盤中不斷有新成交插在最前面：後面幾頁的 offset 會位移，同一筆在相鄰兩頁都出現 → 這次抓到的要去重
//   2. 翻頁用「伺服器實際回的原始筆數」算：parseTrades 會濾掉沒有時間或價格的列，用濾完的筆數當頁長，offset 會算錯
//   3. 上一次存的只有「同一個交易日」才能接：換日了就丟掉，也不能繼承「完整」的旗標
//   4. 抓到上限（MAX_PAGES 頁）還沒碰到上一次存的資料：中間有缺口，不能接上舊的，也不能說「完整」
export async function fetchTrades(code, key, getFn = getJSON) {
  const base = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/trades/${encodeURIComponent(code)}`;
  const old = memo.get(code), got = new Set();
  let fresh = [], date = null, pageLen = null, complete = false, hit = false, seen = null;
  for (let k = 0; k < MAX_PAGES; k++) {
    const j = await getFn(`${base}?limit=${PAGE}&offset=${k * (pageLen || PAGE)}`, key);
    if (k === 0) { date = j?.date || null; seen = old && old.date === date ? new Set(old.trades.map(keyOf)) : null; } // 換日：上一次存的不能用
    const raw = Array.isArray(j?.data) ? j.data.length : 0, rows = parseTrades(j); // rows 由新到舊
    if (pageLen == null) pageLen = raw || PAGE;
    for (const r of rows) {
      const id = keyOf(r);
      if (seen && seen.has(id)) { hit = true; break; } // 碰到上一次已經有的：後面都是舊的
      if (got.has(id)) continue; // 同一頁範圍位移造成的重複
      got.add(id); fresh.push(r);
    }
    if (hit) break;
    if (!raw || raw < pageLen) { complete = true; break; } // 伺服器的清單到底了
  }
  let all, done;
  if (hit) { all = [...fresh, ...old.trades.slice().reverse()]; done = old.complete; } // 接得上：完整與否看上一次
  else { all = fresh; done = complete; }                                           // 接不上（沒有舊的、換日、或有缺口）：只用這次抓到的
  const out = { date, trades: all.reverse(), complete: done }; // 舊到新
  memo.set(code, out); if (memo.size > 60) memo.delete(memo.keys().next().value);
  return out;
}

export default async function handler(req, res) {
  const code = String(req.query?.code || "").trim().toUpperCase();
  if (!/^\d{4,6}[A-Z]?$/.test(code)) return res.status(400).json({ ok: false, error: "請給台股代號，例如 ?code=2330" });
  const key = (process.env.FUGLE_API_KEY || "").trim();
  if (!key) return res.status(200).json({ ok: false, needKey: true, error: "伺服器讀不到富果 API 金鑰（FUGLE_API_KEY），所以沒有大戶散戶與逐筆明細。如果已經在 Vercel 設定，請確認有勾選 Production，並重新部署一次；可以在「更多 → 資料來源狀態」檢查。" });
  try {
    const [tr, vo] = await Promise.allSettled([fetchTrades(code, key), getJSON(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/volumes/${encodeURIComponent(code)}`, key)]);
    if (tr.status !== "fulfilled") throw tr.reason;
    const T = classify(tr.value.trades);
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
    return res.status(200).json({ ok: true, code, date: tr.value.date, source: "富果逐筆成交", unit: "張", buckets: BUCKETS,
      complete: tr.value.complete, from: T[0]?.t || null, count: T.length,
      trades: T.slice(-80).reverse().map(({ t, price, size, side }) => ({ t, p: price, v: size, s: side })),
      minutes: summarize(T), money: moneyByBucket(T), vbp: vo.status === "fulfilled" ? parseVolumes(vo.value) : null });
  } catch (e) { return res.status(200).json({ ok: false, error: `拿不到 ${code} 的逐筆成交（${errText(e)}）` }); }
}
