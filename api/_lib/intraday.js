// 盤中分 K：給 learner/ 個股判讀的「盤中分 K」使用。
// GET /api/intraday?code=2330&tf=5    tf = 1、5、15、30、60（分鐘）；code 可以是 t00（加權指數）
// 有設定 FUGLE_API_KEY 時用富果 intraday/candles（1 分 K），否則改用 Yahoo Finance 1 分 K（可能有延遲）。
// GET /api/intraday?code=2330&tf=5&before=2026-10-01   往前載入那一天以前的分 K（Yahoo；1 分 K 約一個月內、5／15／30 分約兩個月、60 分約兩年）
// 美股（英文代號）一律用 Yahoo，時間是美東當地時間，量的單位是千股。
// 當天的資料一律先抓 1 分 K，再在伺服器端合成需要的週期。回傳 { ok, source, date, tf, prev, bars: [{ t: "09:05", o, h, l, c, v, a? }] }（a 是富果提供的當日均價），v 單位：張（指數為 0）。

import { isUS, usName, yahooBars, INTRADAY_LIMIT } from "./_yahoo.js";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const INDEX = { T00: { fugle: "IX0001", yahoo: "^TWII", name: "加權指數" } };
const ALIAS = { TAIEX: "T00", "加權": "T00", "加權指數": "T00", "大盤": "T00", TWII: "T00" };
export const TFS = [1, 5, 15, 30, 60];
const num = v => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);

export function normCode(raw) {
  const s = String(raw || "").trim().toUpperCase(), c = ALIAS[s] || s;
  return INDEX[c] || /^\d{4,6}[A-Z]?$/.test(c) || isUS(c) ? c : null;
}
// "2026-10-05T09:01:00.000+08:00" 或 epoch 秒 → 台北時間 "HH:MM"
export const hhmm = x => {
  if (typeof x === "string" && /T\d{2}:\d{2}/.test(x) && /\+08:00$/.test(x)) return x.slice(11, 16);
  const ms = typeof x === "number" ? (x < 1e12 ? x * 1000 : x) : Date.parse(x);
  return new Date(ms + 8 * 3600e3).toISOString().slice(11, 16);
};
// 1 分 K 合成 N 分 K：09:00–09:04 → 09:00 那根（以開始時間標示；open 是開盤的分鐘數，台股 540、美股 570）
export function aggregate(bars, tf, open = 540) {
  if (tf <= 1) return bars;
  const out = [];
  for (const b of bars) {
    const [h, m] = b.t.split(":").map(Number), mins = h * 60 + m, slot = Math.floor((mins - open) / tf) * tf + open;
    const t = `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}`, last = out[out.length - 1];
    if (last && last.t === t && last.d === b.d) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v; if (b.a != null) last.a = b.a; }
    else out.push({ ...b, t });
  }
  return out;
}
export function parseFugleCandles(j) {
  const bars = (j?.data || []).map(x => ({ d: String(x.date).slice(0, 10), t: hhmm(x.date), o: num(x.open), h: num(x.high), l: num(x.low), c: num(x.close), v: num(x.volume) || 0, ...(num(x.average) ? { a: num(x.average) } : {}) }))
    .filter(b => b.o && b.h && b.l && b.c).sort((a, b) => a.t.localeCompare(b.t));
  return { date: j?.date || null, bars };
}
export function parseYahooIntraday(j, isIdx) {
  const r = j?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return null;
  const bars = r.timestamp.map((t, k) => ({ d: new Date(t * 1000 + 8 * 3600e3).toISOString().slice(0, 10), t: hhmm(t), o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], v: isIdx || q.volume[k] == null ? 0 : Math.round(q.volume[k] / 1000) }))
    .filter(b => b.o != null && b.h != null && b.l != null && b.c != null && b.t >= "09:00" && b.t <= "13:30")
    .map(b => ({ ...b, o: +b.o.toFixed(2), h: +b.h.toFixed(2), l: +b.l.toFixed(2), c: +b.c.toFixed(2) }));
  const ts = r.timestamp[r.timestamp.length - 1];
  return { date: ts ? new Date(ts * 1000 + 8 * 3600e3).toISOString().slice(0, 10) : null, bars, prev: num(r.meta?.chartPreviousClose ?? r.meta?.previousClose), name: r.meta?.shortName || "" };
}

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fromFugle(code, key) {
  const sym = INDEX[code]?.fugle || code, h = { "X-API-KEY": key };
  const p = parseFugleCandles(await getJSON(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${encodeURIComponent(sym)}?timeframe=1`, h));
  if (!p.bars.length) return null;
  let prev = null, name = "";
  try { const q = await getJSON(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(sym)}`, h); prev = num(q.previousClose ?? q.referencePrice); name = q.name || ""; } catch {}
  return { ...p, prev, name, source: "富果" };
}
async function fromYahoo(code) {
  const isIdx = !!INDEX[code], syms = isIdx ? [INDEX[code].yahoo] : [`${code}.TW`, `${code}.TWO`];
  for (const s of syms) {
    try {
      const p = parseYahooIntraday(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1m&range=1d`), isIdx);
      if (p && p.bars.length) return { ...p, source: "Yahoo Finance（可能延遲）" };
    } catch {}
  }
  return null;
}

const ymd = sec => new Date(sec * 1000).toISOString().slice(0, 10);
const toMin = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
// 往前載入：一律問 Yahoo（富果的盤中 API 只有當天）
async function history(code, tf, before) {
  const us = isUS(code), lim = INTRADAY_LIMIT[tf] || INTRADAY_LIMIT[1], now = Date.now() / 1000, earliest = now - lim.back * 86400;
  const period2 = Date.parse(`${before}T00:00:00${us ? "-04:00" : "+08:00"}`) / 1000;
  if (!Number.isFinite(period2) || period2 <= earliest + 3600) return { bars: [], end: true, next: before };
  const period1 = Math.max(earliest, period2 - lim.chunk * 86400), isIdx = !!INDEX[code];
  const syms = us ? [code] : isIdx ? [INDEX[code].yahoo] : [`${code}.TW`, `${code}.TWO`];
  let last = null;
  for (const s of syms) {
    try {
      const p = await yahooBars(s, tf, { period1, period2, isIdx });
      if (!p) continue;
      const o = us ? toMin(p.session.open) : 540, c = us ? toMin(p.session.close) : 810;
      const bars = p.bars.filter(b => b.d < before && toMin(b.t) >= o && toMin(b.t) <= c);
      last = { bars, prev: p.prev, name: us ? usName(code, p.meta?.shortName) : "", session: us ? p.session : null };
      if (bars.length) break;
    } catch (e) { last = last || { error: e.message }; }
  }
  return { ...(last || {}), bars: last?.bars || [], end: period1 <= earliest + 1, next: ymd(period1 + (us ? -4 : 8) * 3600) };
}
async function usToday(code, tf) {
  const p = await yahooBars(code, 1);
  if (!p || !p.bars.length) return null;
  const o = toMin(p.session.open), c = toMin(p.session.close), day = p.bars[p.bars.length - 1].d;
  const bars = p.bars.filter(b => b.d === day && toMin(b.t) >= o && toMin(b.t) <= c);
  return { date: day, bars: aggregate(bars, tf, o), prev: p.prev, name: usName(code, p.meta?.shortName), session: p.session, source: "Yahoo Finance（美股可能延遲 15 分鐘）", unit: "千股" };
}

export default async function handler(req, res) {
  const code = normCode(req.query?.code), tf = TFS.includes(+req.query?.tf) ? +req.query.tf : 1;
  if (!code) return res.status(400).json({ ok: false, error: "請給股票代號，例如 ?code=2330&tf=5（t00 是加權指數，美股用英文代號）。" });
  const before = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.before || "")) ? String(req.query.before) : null, us = isUS(code);
  if (before) {
    const h = await history(code, tf, before);
    if (h.error && !h.bars.length && !h.end) return res.status(200).json({ ok: false, error: `拿不到更早的分 K（${h.error}）` });
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, code, tf, source: "Yahoo Finance", bars: h.bars, end: h.end, next: h.next, prev: h.prev ?? null, session: h.session || null, unit: us ? "千股" : "張" });
  }
  if (us) {
    try {
      const p = await usToday(code, tf);
      if (p) { res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120"); return res.status(200).json({ ok: true, code, tf, ...p }); }
    } catch (e) { return res.status(200).json({ ok: false, error: `拿不到 ${code} 的分 K（${e.message}）` }); }
    return res.status(200).json({ ok: false, error: `拿不到 ${code} 的分 K` });
  }
  const key = process.env.FUGLE_API_KEY, errors = [];
  for (const [name, run] of [...(key ? [["富果", () => fromFugle(code, key)]] : []), ["Yahoo", () => fromYahoo(code)]]) {
    try {
      const p = await run();
      if (p) {
        res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
        return res.status(200).json({ ok: true, code, name: p.name || INDEX[code]?.name || "", source: p.source, date: p.date, tf, prev: p.prev ?? null, bars: aggregate(p.bars.map(b => ({ d: p.date, ...b })), tf), unit: "張", session: { open: "09:00", close: "13:30" } });
      }
      errors.push(`${name}: 沒有資料`);
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  return res.status(200).json({ ok: false, error: `拿不到 ${code} 的盤中分 K（${errors.join("；")}）。${key ? "" : "設定富果 API 金鑰（FUGLE_API_KEY）會比較穩定。"}` });
}
