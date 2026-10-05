// 盤中即時報價：給 learner/ 的頂部加權指數、個股判讀的「即時」更新使用。
// GET /api/quote?codes=2330,0050,t00     （t00 = 加權指數、o00 = 櫃買指數；最多 10 檔）
// GET /api/quote?codes=...&src=mis        只用 MIS 批次查詢（最多 30 檔，給看盤的自選股清單用，不消耗富果額度）
// 美股（英文代號，例如 AAPL、^GSPC）一律用 Yahoo Finance，每檔另外標 us: true 與自己的交易時段 session。
// 預設來源：證交所「基本市況報導」MIS（免費、不用申請，約 5 秒一筆快照；這是給證交所網頁用的介面，沒有正式保證）。
// 在 Vercel 設定 FUGLE_API_KEY（富果行情 API 金鑰）時，改用富果，失敗再退回 MIS。
// 回傳 { ok, source, session: "pre"|"open"|"closed", time, quotes: [{ code, name, market, price, prev, open, high, low, vol, chg, chgPct, time, date, bids:[{p,v}], asks:[{p,v}], estimated }] }
// 張數單位：張；指數沒有成交量（vol 為 null）。

import { isUS, yahooQuote } from "./_yahoo.js";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json", "Accept-Language": "zh-TW" };
const INDEX = { T00: { mis: "tse_t00.tw", fugle: "IX0001", name: "加權指數" }, O00: { mis: "otc_o00.tw", fugle: "IX0043", name: "櫃買指數" } };
const ALIAS = { TAIEX: "T00", "加權": "T00", "加權指數": "T00", "大盤": "T00", TWII: "T00", "櫃買": "O00", "櫃買指數": "O00", TPEX: "O00" };
const cache = new Map(); // 同一個伺服器實例 4 秒內重複查詢直接回快取，避免太頻繁被證交所擋
let misCookie = "";

export const num = v => { if (v == null || v === "-" || v === "") return null; const n = parseFloat(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
// 台北時間的盤中狀態：週一到週五 08:30 試撮、09:00–13:30 交易（不含國定假日，假日時資料日期不是今天，前端會顯示「收盤」）
export function session(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600e3), day = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (day === 0 || day === 6) return "closed";
  if (m >= 8 * 60 + 30 && m < 9 * 60) return "pre";
  if (m >= 9 * 60 && m <= 13 * 60 + 35) return "open";
  return "closed";
}
export const todayTaipei = (now = new Date()) => new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
export function normCodes(raw, max = 10) {
  return [...new Set(String(raw || "").split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean).map(s => ALIAS[s] || s))]
    .filter(s => INDEX[s] || /^\d{4,6}[A-Z]?$/.test(s) || isUS(s)).slice(0, max);
}
const levels = (p, v) => { const ps = String(p || "").split("_"), vs = String(v || "").split("_"); return ps.map((x, k) => ({ p: num(x), v: num(vs[k]) })).filter(x => x.p != null && x.p > 0).slice(0, 5); };
// MIS 的一筆：z 最近成交價（"-" 代表這個快照沒有成交）、y 昨收、o/h/l 開高低、v 累計量（張）、a/f 委賣價量、b/g 委買價量、d 日期、t 時間
export function parseMis(m) {
  const code = String(m.c || "").toUpperCase(), isIdx = code === "T00" || code === "O00";
  const bids = levels(m.b, m.g), asks = levels(m.a, m.f), prev = num(m.y);
  let price = num(m.z), estimated = false;
  if (price == null) { price = num(m.pz) ?? (bids[0] && asks[0] ? +((bids[0].p + asks[0].p) / 2).toFixed(2) : bids[0]?.p ?? asks[0]?.p ?? null); estimated = price != null; }
  const d = String(m.d || ""), date = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null;
  return { code, name: m.n || (INDEX[code]?.name ?? ""), market: m.ex === "otc" ? "上櫃" : "上市", price, prev, open: num(m.o), high: num(m.h), low: num(m.l), vol: isIdx ? null : num(m.v),
    chg: price != null && prev ? +(price - prev).toFixed(2) : null, chgPct: price != null && prev ? +((price / prev - 1) * 100).toFixed(2) : null, time: m.t || null, date, bids, asks, estimated };
}
// 富果 intraday/quote
export function parseFugle(j, code) {
  const bids = (j.bids || []).map(x => ({ p: num(x.price), v: num(x.size) })).filter(x => x.p), asks = (j.asks || []).map(x => ({ p: num(x.price), v: num(x.size) })).filter(x => x.p);
  const price = num(j.lastPrice ?? j.closePrice), prev = num(j.previousClose ?? j.referencePrice), ts = j.lastUpdated ? new Date(Number(j.lastUpdated) / 1000) : null;
  const time = ts ? new Date(ts.getTime() + 8 * 3600e3).toISOString().slice(11, 19) : null;
  return { code, name: j.name || INDEX[code]?.name || "", market: j.market === "OTC" || j.exchange === "TPEx" ? "上櫃" : "上市", price, prev, open: num(j.openPrice), high: num(j.highPrice), low: num(j.lowPrice),
    vol: INDEX[code] ? null : num(j.total?.tradeVolume), chg: num(j.change), chgPct: num(j.changePercent), time, date: j.date || null, bids: bids.slice(0, 5), asks: asks.slice(0, 5), estimated: false };
}

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function misFetch(chs) {
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${chs.join("|")}&json=1&delay=0&_=${Date.now()}`;
  let j = null;
  try { j = await getJSON(url, misCookie ? { Cookie: misCookie } : {}); } catch {}
  if (!j || !Array.isArray(j.msgArray)) {
    // 有時候要先拿到 MIS 首頁的 session cookie 才查得到
    try { const r = await fetch("https://mis.twse.com.tw/stock/index.jsp", { headers: UA, signal: AbortSignal.timeout(6000) }); misCookie = (r.headers.get("set-cookie") || "").split(";")[0]; } catch {}
    j = await getJSON(url, misCookie ? { Cookie: misCookie } : {});
  }
  return Array.isArray(j?.msgArray) ? j.msgArray : [];
}
async function fromMis(codes) {
  // 不知道是上市還是上櫃，兩個都問，有資料的那個就是
  const chs = codes.flatMap(c => (INDEX[c] ? [INDEX[c].mis] : [`tse_${c.toLowerCase()}.tw`, `otc_${c.toLowerCase()}.tw`]));
  const rows = (await misFetch(chs)).map(parseMis).filter(q => q.code && (q.price != null || q.prev != null));
  return codes.map(c => rows.find(q => q.code === c)).filter(Boolean);
}
async function fromFugle(codes, key) {
  const out = [];
  for (const c of codes) {
    const sym = INDEX[c]?.fugle || c;
    out.push(parseFugle(await getJSON(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(sym)}`, { "X-API-KEY": key }), c));
  }
  return out;
}

export default async function handler(req, res) {
  const misOnly = req.query?.src === "mis", all = normCodes(req.query?.codes ?? req.query?.code, misOnly ? 40 : 10);
  if (!all.length) return res.status(400).json({ ok: false, error: "請給股票代號，例如 ?codes=2330,t00（t00 是加權指數）。" });
  const us = all.filter(isUS), codes = all.filter(c => !isUS(c));
  // 只有美股：直接問 Yahoo
  const usQuotes = () => Promise.allSettled(us.map(yahooQuote)).then(r => r.filter(x => x.status === "fulfilled").map(x => x.value));
  if (!codes.length) {
    const hitU = cache.get("us:" + us.join(","));
    if (hitU && Date.now() - hitU.at < 15000) return res.status(200).json(hitU.body);
    const quotes = await usQuotes();
    if (!quotes.length) return res.status(200).json({ ok: false, session: session(), error: "暫時拿不到美股報價（Yahoo Finance），稍後再試。" });
    const body = { ok: true, source: "Yahoo Finance", session: session(), today: todayTaipei(), time: new Date().toISOString(), quotes, missing: us.filter(c => !quotes.some(q => q.code === c)) };
    cache.set("us:" + us.join(","), { at: Date.now(), body }); res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
    return res.status(200).json(body);
  }
  const usP = us.length ? usQuotes() : Promise.resolve([]);
  const key = (misOnly ? "mis:" : "") + all.join(","), hit = cache.get(key), sess = session();
  if (hit && Date.now() - hit.at < 4000) { res.setHeader("Cache-Control", "s-maxage=4"); return res.status(200).json(hit.body); }
  const fugleKey = (process.env.FUGLE_API_KEY || "").trim(), errors = [];
  for (const [source, run] of [...(fugleKey && !misOnly ? [["富果", () => fromFugle(codes, fugleKey)]] : []), ["證交所 MIS", () => fromMis(codes)]]) {
    try {
      const quotes = await run();
      if (quotes.length) {
        const uq = await usP; quotes.push(...uq);
        const body = { ok: true, source, session: sess, today: todayTaipei(), time: new Date().toISOString(), quotes, missing: all.filter(c => !quotes.some(q => q.code === c)) };
        cache.set(key, { at: Date.now(), body });
        // 盤中只快取幾秒；收盤後快取久一點
        res.setHeader("Cache-Control", sess === "closed" ? "s-maxage=120, stale-while-revalidate=600" : "s-maxage=4, stale-while-revalidate=10");
        return res.status(200).json(body);
      }
      errors.push(`${source}: 沒有資料`);
    } catch (e) { errors.push(`${source}: ${e.message}`); }
  }
  return res.status(200).json({ ok: false, session: sess, error: `暫時拿不到即時報價（${errors.join("；")}）。證交所可能暫時擋住了太頻繁的查詢，稍等一下會自動恢復。` });
}
