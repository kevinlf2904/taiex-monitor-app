// 盤中分 K：給 learner/ 個股判讀的「盤中分 K」使用。
// GET /api/intraday?code=2330&tf=5    tf = 1、5、15、30、60（分鐘）；code 可以是 t00（加權指數）
// 有設定 FUGLE_API_KEY 時用富果 intraday/candles（1 分 K），否則改用 Yahoo Finance 1 分 K（可能有延遲）。
// 一律先抓 1 分 K，再在伺服器端合成需要的週期。回傳 { ok, source, date, tf, prev, bars: [{ t: "09:05", o, h, l, c, v }] }，v 單位：張（指數為 0）。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const INDEX = { T00: { fugle: "IX0001", yahoo: "^TWII", name: "加權指數" } };
const ALIAS = { TAIEX: "T00", "加權": "T00", "加權指數": "T00", "大盤": "T00", TWII: "T00" };
export const TFS = [1, 5, 15, 30, 60];
const num = v => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);

export function normCode(raw) {
  const s = String(raw || "").trim().toUpperCase(), c = ALIAS[s] || s;
  return INDEX[c] || /^\d{4,6}[A-Z]?$/.test(c) ? c : null;
}
// "2026-10-05T09:01:00.000+08:00" 或 epoch 秒 → 台北時間 "HH:MM"
export const hhmm = x => {
  if (typeof x === "string" && /T\d{2}:\d{2}/.test(x) && /\+08:00$/.test(x)) return x.slice(11, 16);
  const ms = typeof x === "number" ? (x < 1e12 ? x * 1000 : x) : Date.parse(x);
  return new Date(ms + 8 * 3600e3).toISOString().slice(11, 16);
};
// 1 分 K 合成 N 分 K：09:00–09:04 → 09:00 那根（以開始時間標示）
export function aggregate(bars, tf) {
  if (tf <= 1) return bars;
  const out = [];
  for (const b of bars) {
    const [h, m] = b.t.split(":").map(Number), mins = h * 60 + m, slot = Math.floor((mins - 540) / tf) * tf + 540;
    const t = `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}`, last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v; }
    else out.push({ ...b, t });
  }
  return out;
}
export function parseFugleCandles(j) {
  const bars = (j?.data || []).map(x => ({ t: hhmm(x.date), o: num(x.open), h: num(x.high), l: num(x.low), c: num(x.close), v: num(x.volume) || 0 }))
    .filter(b => b.o && b.h && b.l && b.c).sort((a, b) => a.t.localeCompare(b.t));
  return { date: j?.date || null, bars };
}
export function parseYahooIntraday(j, isIdx) {
  const r = j?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return null;
  const bars = r.timestamp.map((t, k) => ({ t: hhmm(t), o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], v: isIdx || q.volume[k] == null ? 0 : Math.round(q.volume[k] / 1000) }))
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

export default async function handler(req, res) {
  const code = normCode(req.query?.code), tf = TFS.includes(+req.query?.tf) ? +req.query.tf : 1;
  if (!code) return res.status(400).json({ ok: false, error: "請給股票代號，例如 ?code=2330&tf=5（t00 是加權指數）。" });
  const key = process.env.FUGLE_API_KEY, errors = [];
  for (const [name, run] of [...(key ? [["富果", () => fromFugle(code, key)]] : []), ["Yahoo", () => fromYahoo(code)]]) {
    try {
      const p = await run();
      if (p) {
        res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
        return res.status(200).json({ ok: true, code, name: p.name || INDEX[code]?.name || "", source: p.source, date: p.date, tf, prev: p.prev ?? null, bars: aggregate(p.bars, tf) });
      }
      errors.push(`${name}: 沒有資料`);
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  return res.status(200).json({ ok: false, error: `拿不到 ${code} 的盤中分 K（${errors.join("；")}）。${key ? "" : "設定富果 API 金鑰（FUGLE_API_KEY）會比較穩定。"}` });
}
