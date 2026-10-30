// 盤中即時報價：給 learner/ 的頂部加權指數、個股判讀的「即時」更新使用。
// GET /api/quote?codes=2330,0050,t00     （t00 = 加權指數、o00 = 櫃買指數；最多 10 檔）
// GET /api/quote?codes=...&src=mis        只用 MIS 批次查詢（最多 30 檔，給看盤的自選股清單用，不消耗富果額度）
// 美股（英文代號，例如 AAPL、^GSPC）一律用 Yahoo Finance，每檔另外標 us: true 與自己的交易時段 session。
// 預設來源：證交所「基本市況報導」MIS（免費、不用申請，約 5 秒一筆快照；這是給證交所網頁用的介面，沒有正式保證）。
// 在 Vercel 設定 FUGLE_API_KEY（富果行情 API 金鑰）時，改用富果，失敗再退回 MIS。
// 回傳 { ok, source, session: "pre"|"open"|"closed", time, quotes: [{ code, name, market, price, prev, open, high, low, vol, chg, chgPct, time, date, bids:[{p,v}], asks:[{p,v}], estimated }] }
// 張數單位：張；指數沒有成交量（vol 為 null）。

import { isUS, yahooQuote, getJSON as yGet, quoteFromMeta } from "./_yahoo.js";
import { finnhubQuote } from "./_finnhub.js";
import { holState, holWarm } from "./calendar.js";
import { withRetry, retryErr, errKind } from "./_retry.js";
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
  if (holState(t.toISOString().slice(0, 10)) === "closed") return "closed"; // 證交所公布的平日休市（國定假日）；還沒拿到休市日表時照舊只看時間
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
  const time = m.t || null;
  return { code, name: m.n || (INDEX[code]?.name ?? ""), market: m.ex === "otc" ? "上櫃" : "上市", price, prev, open: num(m.o), high: num(m.h), low: num(m.l), vol: isIdx ? null : num(m.v),
    chg: price != null && prev ? +(price - prev).toFixed(2) : null, chgPct: price != null && prev ? +((price / prev - 1) * 100).toFixed(2) : null, time, date, dataDate: date, sourceTime: time, bids, asks, estimated };
}
// 富果 intraday/quote
export function parseFugle(j, code) {
  const bids = (j.bids || []).map(x => ({ p: num(x.price), v: num(x.size) })).filter(x => x.p), asks = (j.asks || []).map(x => ({ p: num(x.price), v: num(x.size) })).filter(x => x.p);
  const price = num(j.lastPrice ?? j.closePrice), prev = num(j.previousClose ?? j.referencePrice), ts = j.lastUpdated ? new Date(Number(j.lastUpdated) / 1000) : null;
  const time = ts ? new Date(ts.getTime() + 8 * 3600e3).toISOString().slice(11, 19) : null;
  const date = j.date || null;
  return { code, name: j.name || INDEX[code]?.name || "", market: j.market === "OTC" || j.exchange === "TPEx" ? "上櫃" : "上市", price, prev, open: num(j.openPrice), high: num(j.highPrice), low: num(j.lowPrice),
    vol: INDEX[code] ? null : num(j.total?.tradeVolume), chg: num(j.change), chgPct: num(j.changePercent), time, date, dataDate: date, sourceTime: time, bids: bids.slice(0, 5), asks: asks.slice(0, 5), estimated: false };
}

async function getJSON(url, headers = {}, ms = 6000, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; const ra = +r.headers?.get?.("retry-after"); if (ra > 0) e.retryAfterMs = ra * 1000; throw e; }
  return r.json();
}
// MIS 斷路器（所有用到 MIS 的地方共用：報價、大盤、熱門、選股；開著時直接改用備援，畫面不會一直「載入中」）：
//   連續 5 次網路錯誤或逾時 → 30 秒；被拒絕（403 等）→ 60 秒；連續 2 次 429（限流）→ 照 Retry-After，沒給就 15 秒（最多 60 秒）
// 以前一次逾時就關 30 秒：全市場 4 批同時查時，一批逾時會讓其他批次全部失敗，大盤就只剩部分資料
let misDownUntil = 0, misNetFails = 0, misRateFails = 0;
export const MIS = { timeoutMs: 5000, netTrip: 5, netDownMs: 30000, denyDownMs: 60000, rateTrip: 2, rateDownMs: 15000, rateMaxMs: 60000 };
export function misReset() { misDownUntil = 0; misNetFails = 0; misRateFails = 0; misCookie = ""; } // 測試用
// deadline：這次查詢（含換 cookie）最晚要在什麼時候結束；每個請求的逾時取「單次上限」和「剩下的時間」比較短的那個，不會超過期限
export async function misFetch(chs, { fetchImpl = fetch, now = Date.now, timeoutMs = MIS.timeoutMs, deadline = Infinity } = {}) {
  if (now() < misDownUntil) throw retryErr("circuit", "連不上（稍後再試）");
  // 自己的整體期限到了（overDeadline）不算 MIS 的錯，不累計斷路器
  const left = () => { const ms = Math.min(timeoutMs, deadline - now()); if (ms <= 0) throw Object.assign(retryErr("timeout", "超過整體時間上限"), { overDeadline: true }); return ms; };
  try { const out = await misFetchRaw(chs, fetchImpl, left); misNetFails = 0; misRateFails = 0; return out; }
  catch (e) {
    const k = errKind(e);
    if (k === "fatal") misDownUntil = now() + MIS.denyDownMs;
    else if (k === "rate") { if (++misRateFails >= MIS.rateTrip) { misDownUntil = now() + Math.min(MIS.rateMaxMs, e.retryAfterMs || MIS.rateDownMs); misRateFails = 0; } }
    else if ((k === "network" || k === "timeout") && !e.overDeadline) { if (++misNetFails >= MIS.netTrip) { misDownUntil = now() + MIS.netDownMs; misNetFails = 0; } }
    throw e;
  }
}
// 一次查詢：HTTP 錯誤帶狀態碼丟出（交給重試分類）；回應不是 { msgArray: [...] } 或第一次被拒（403）時，先拿 MIS 首頁的 session cookie 再查一次
async function misFetchRaw(chs, fetchImpl = fetch, left = () => MIS.timeoutMs) {
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${chs.join("|")}&json=1&delay=0&_=${Date.now()}`;
  const get = () => getJSON(url, misCookie ? { Cookie: misCookie } : {}, left(), fetchImpl);
  let j = null;
  try { j = await get(); }
  catch (e) { if (e?.status !== 403 && errKind(e) !== "bad_json") throw e; }
  if (!Array.isArray(j?.msgArray)) {
    try { const r = await fetchImpl("https://mis.twse.com.tw/stock/index.jsp", { headers: UA, signal: AbortSignal.timeout(left()) }); misCookie = (r.headers?.get?.("set-cookie") || "").split(";")[0]; } catch {}
    j = await get();
  }
  if (!Array.isArray(j?.msgArray)) throw retryErr("bad_json", "MIS 回應格式不對（沒有 msgArray）");
  return j.msgArray;
}
async function fromMis(codes) {
  // 不知道是上市還是上櫃，兩個都問，有資料的那個就是
  const chs = codes.flatMap(c => (INDEX[c] ? [INDEX[c].mis] : [`tse_${c}.tw`, `otc_${c}.tw`]));
  // 暫時性錯誤（429、5xx、逾時、空回應）最多再試 1 次、整體 3.5 秒內（每個請求的逾時也算在 3.5 秒裡）；403 不重試，直接改用備援
  const deadline = Date.now() + 3500;
  const rows = (await withRetry(async () => { const r = await misFetch(chs, { timeoutMs: 3000, deadline }); if (!r.length) throw retryErr("empty", "MIS 沒有資料"); return r; }, { attempts: 2, deadline }))
    .map(parseMis).filter(q => q.code && (q.price != null || q.prev != null));
  return codes.map(c => rows.find(q => q.code === c)).filter(Boolean);
}
// Yahoo Finance 備援：加權 ^TWII、櫃買 ^TWOII，個股先試上市 .TW 再試上櫃 .TWO（Yahoo 的台股報價可能延遲幾分鐘）
const YIDX = { T00: "^TWII", O00: "^TWOII" };
async function yahooTw(c) {
  for (const sym of YIDX[c] ? [YIDX[c]] : [`${c}.TW`, `${c}.TWO`]) {
    try { const j = await yGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m`, {}, 5000), r = j?.chart?.result?.[0];
      if (!r?.meta?.regularMarketPrice) continue;
      const q = quoteFromMeta(sym, r.meta), o = r.indicators?.quote?.[0];
      const open = o?.open?.find(v => v != null);
      return { ...q, code: c, name: INDEX[c]?.name || "", market: sym.endsWith(".TWO") || c === "O00" ? "上櫃" : "上市", currency: undefined, us: undefined, session: undefined,
        open: open != null ? +open.toFixed(2) : null, vol: INDEX[c] ? null : q.vol != null ? Math.round(q.vol / 1000) : null, delayed: true };
    } catch {}
  }
  return null;
}
async function fromYahooTw(codes) {
  const out = []; let k = 0; const worker = async () => { while (k < codes.length) { const q = await yahooTw(codes[k++]); if (q) out.push(q); } };
  await Promise.all(Array.from({ length: Math.min(8, codes.length) }, worker));
  return codes.map(c => out.find(q => q.code === c)).filter(Boolean);
}
// 富果只拿來補指數（清單模式最多 40 檔，全部問富果會超過每分鐘額度）；3 秒內重複使用
const fugleIdx = new Map();
async function fugleIndex(c, key) { const h = fugleIdx.get(c); if (h && Date.now() - h.at < 3000) return h.q; const [q] = await fromFugle([c], key); fugleIdx.set(c, { at: Date.now(), q }); return q; }
async function fromBackup(codes, key) {
  const idx = key ? codes.filter(c => INDEX[c]) : [], got = [];
  for (const c of idx) { try { got.push(await fugleIndex(c, key)); } catch {} }
  const rest = codes.filter(c => !got.some(q => q.code === c));
  if (rest.length) got.push(...(await fromYahooTw(rest)));
  return codes.map(c => got.find(q => q.code === c)).filter(Boolean);
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
  holWarm(); // 休市日表（12 小時更新一次，不等它；第一次拿到之前 session() 照舊只看週末與時間）
  const misOnly = req.query?.src === "mis", all = normCodes(req.query?.codes ?? req.query?.code, misOnly ? 40 : 10);
  if (!all.length) return res.status(400).json({ ok: false, error: "請給股票代號，例如 ?codes=2330,t00（t00 是加權指數）。" });
  const us = all.filter(isUS), codes = all.filter(c => !isUS(c));
  // 只有美股：直接問 Yahoo
  // Yahoo 拿不到的美股個股，改問 Finnhub（有設定 FINNHUB_API_KEY 才會用；回傳的 src 標示來源）
  const usQuotes = () => Promise.allSettled(us.map(c => yahooQuote(c).catch(() => finnhubQuote(c)))).then(r => r.filter(x => x.status === "fulfilled").map(x => x.value));
  if (!codes.length) {
    const hitU = cache.get("us:" + us.join(","));
    if (hitU && Date.now() - hitU.at < 15000) return res.status(200).json(hitU.body);
    const quotes = await usQuotes();
    if (!quotes.length) return res.status(200).json({ ok: false, session: session(), error: "暫時拿不到美股報價（Yahoo Finance），稍後再試。" });
    const nowIso = new Date().toISOString();
    const srcName = quotes.some(q => q.src === "Finnhub") ? "Yahoo Finance（部分備援：Finnhub）" : "Yahoo Finance";
    const enriched = quotes.map(q => ({ ...q, dataDate: q.dataDate || q.date || null, sourceTime: q.sourceTime || q.time || null, fetchedAt: nowIso, source: q.src || "Yahoo Finance", updateMode: q.updateMode || "scheduled" }));
    const body = { ok: true, source: srcName, session: session(), today: todayTaipei(), time: nowIso, fetchedAt: nowIso, updateMode: "scheduled", quotes: enriched, missing: us.filter(c => !quotes.some(q => q.code === c)) };
    cache.set("us:" + us.join(","), { at: Date.now(), body }); res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
    return res.status(200).json(body);
  }
  const usP = us.length ? usQuotes() : Promise.resolve([]);
  const key = (misOnly ? "mis:" : "") + all.join(","), hit = cache.get(key), sess = session();
  if (hit && Date.now() - hit.at < (sess === "closed" ? 30000 : 900)) { res.setHeader("Cache-Control", sess === "closed" ? "s-maxage=30" : "s-maxage=1"); return res.status(200).json(hit.body); }
  const fugleKey = (process.env.FUGLE_API_KEY || "").trim(), errors = [];
  for (const [source, run] of [...(fugleKey && !misOnly ? [["富果", () => fromFugle(codes, fugleKey)]] : []), ["證交所 MIS", () => fromMis(codes)], [fugleKey ? "富果指數＋Yahoo（備援）" : "Yahoo Finance（備援，可能延遲）", () => fromBackup(codes, fugleKey)]]) {
    try {
      const quotes = await run();
      if (quotes.length) {
        const uq = await usP; quotes.push(...uq);
        const nowIso = new Date().toISOString(), isFallback = errors.length > 0, today = todayTaipei();
        const enriched = quotes.map(q => ({
          ...q,
          dataDate: q.dataDate || q.date || null,
          sourceTime: q.sourceTime ?? q.time ?? null,
          fetchedAt: nowIso,
          source: q.us ? (q.src || "Yahoo Finance") : source,
          updateMode: q.us ? (q.updateMode || "scheduled") : (sess === "open" || sess === "pre" ? "live" : "after_close"),
          isFallback: Boolean(isFallback || q.delayed),
        }));
        const body = { ok: true, source, backup: isFallback ? errors.join("；") : undefined, isFallback, session: sess, today, time: nowIso, fetchedAt: nowIso, updateMode: sess === "open" || sess === "pre" ? "live" : "after_close", quotes: enriched, missing: all.filter(c => !quotes.some(q => q.code === c)) };
        cache.set(key, { at: Date.now(), body });
        // 盤中只快取幾秒；收盤後快取久一點
        res.setHeader("Cache-Control", sess === "closed" ? "s-maxage=120, stale-while-revalidate=600" : "s-maxage=1, stale-while-revalidate=2"); // 盤中每秒更新
        return res.status(200).json(body);
      }
      errors.push(`${source}: 沒有資料`);
    } catch (e) { errors.push(`${source}: ${e.message}`); }
  }
  return res.status(200).json({ ok: false, session: sess, error: `暫時拿不到即時報價（${errors.join("；")}）。證交所可能暫時擋住了太頻繁的查詢，稍等一下會自動恢復。` });
}
