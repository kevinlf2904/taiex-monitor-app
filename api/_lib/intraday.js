// 盤中分 K：給 learner/ 個股判讀的「盤中分 K」使用。
// GET /api/intraday?code=2330&tf=5    tf = 1、5、15、30、60（分鐘）；code 可以是 t00（加權指數）、o00（櫃買指數）
// GET /api/intraday?code=t00&spark=1  只回當天每分鐘收盤 spark: [["09:00", 價], …]（大盤卡片的走勢線用，資料量小）
// 有設定 FUGLE_API_KEY 時用富果 intraday/candles（1 分 K），否則改用 Yahoo Finance 1 分 K（可能有延遲）。
// GET /api/intraday?code=2330&tf=5&before=2026-10-01   往前載入那一天以前的分 K（個股／美股 Yahoo；大盤指數優先 Fugle Historical Candles）
// 美股（英文代號）一律用 Yahoo，時間是美東當地時間，量的單位是千股。
// 當天的資料一律先抓 1 分 K，再在伺服器端合成需要的週期。回傳 { ok, source, date, tf, prev, bars: [{ t: "09:05", o, h, l, c, v, a? }] }（a 是富果提供的當日均價），v 單位：張；指數（t00、o00）沒有可靠的分 K 成交量（Yahoo 的 ^TWII 欄位全是 0、^TWOII 沒資料），v 一律是 null（不是 0），前端看到 null 就不畫量。

import { isUS, usName, yahooBars, INTRADAY_LIMIT } from "./_yahoo.js";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const INDEX = { T00: { fugle: "IX0001", yahoo: "^TWII", name: "加權指數" }, O00: { fugle: "IX0043", yahoo: "^TWOII", name: "櫃買指數" } };
const ALIAS = { TAIEX: "T00", "加權": "T00", "加權指數": "T00", "大盤": "T00", TWII: "T00", "櫃買": "O00", "櫃買指數": "O00", TWOII: "O00" };
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
    if (last && last.t === t && last.d === b.d) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v = last.v == null || b.v == null ? null : last.v + b.v; if (b.a != null) last.a = b.a; }
    else out.push({ ...b, t });
  }
  return out;
}
// 指數（IX0001、IX0043）的 volume 是那一分鐘的成交金額（元，不是累計；整天加總和證交所 MI_5MINS 的成交金額一致），輸出時換成億元（toYi）；
// 富果有給（≥ 0）就照用：0 是真的 0（13:25～13:29 收盤集合競價沒有成交，金額都算在 13:30 那根；當成缺值的話 60 分 K 最後一小時整根變 null）；
// 沒給、不合法或負數才是 null（缺失，不能當成 0）。
// 個股那一分鐘沒成交是 0，來源沒給量欄位時 v 記 0 並標 vNa: 1（前端均量跳過，和日 K 一樣）
export function parseFugleCandles(j, isIdx = false) {
  const bars = (j?.data || []).map(x => ({ d: String(x.date).slice(0, 10), t: hhmm(x.date), o: num(x.open), h: num(x.high), l: num(x.low), c: num(x.close), ...(isIdx ? (num(x.volume) != null && num(x.volume) >= 0 ? { v: num(x.volume) } : { v: null, vNa: 1 }) : num(x.volume) == null ? { v: 0, vNa: 1 } : { v: num(x.volume) }), ...(num(x.average) && !isIdx ? { a: num(x.average) } : {}) }))
    .filter(b => b.o && b.h && b.l && b.c).sort((a, b) => a.t.localeCompare(b.t));
  return { date: j?.date || null, bars };
}
export function parseYahooIntraday(j, isIdx) {
  const r = j?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return null;
  const bars = r.timestamp.map((t, k) => ({ d: new Date(t * 1000 + 8 * 3600e3).toISOString().slice(0, 10), t: hhmm(t), o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], ...(isIdx ? { v: null, vNa: 1 } : q.volume[k] == null ? { v: 0, vNa: 1 } : { v: Math.round(q.volume[k] / 1000) }) }))
    .filter(b => b.o != null && b.h != null && b.l != null && b.c != null && b.t >= "09:00" && b.t <= "13:30")
    .map(b => ({ ...b, o: +b.o.toFixed(2), h: +b.h.toFixed(2), l: +b.l.toFixed(2), c: +b.c.toFixed(2) }));
  const ts = r.timestamp[r.timestamp.length - 1];
  return { date: ts ? new Date(ts * 1000 + 8 * 3600e3).toISOString().slice(0, 10) : null, bars, prev: num(r.meta?.chartPreviousClose ?? r.meta?.previousClose), name: r.meta?.shortName || "" };
}

async function getJSON(url, headers = {}, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
// 富果暫時性錯誤（429、5xx、逾時、網路）再試一次；403、401、404（權限、方案）不重試，直接改用 Yahoo
export async function getJSONRetry(url, headers = {}, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), waitMs = 400 } = {}) {
  try { return await getJSON(url, headers, fetchImpl); }
  catch (e) { if (e.status && e.status !== 429 && e.status < 500) throw e; await sleep(waitMs); return getJSON(url, headers, fetchImpl); }
}
// 指數成交金額：元 → 億元（兩位小數）；null 照舊是 null
export const toYi = v => (v == null ? null : +(v / 1e8).toFixed(2));
export async function fromFugle(code, key, opts = {}) {
  const sym = INDEX[code]?.fugle || code, h = { "X-API-KEY": key };
  const p = parseFugleCandles(await getJSONRetry(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${encodeURIComponent(sym)}?timeframe=1`, h, opts), !!INDEX[code]);
  if (!p.bars.length) return null;
  let prev = null, name = "";
  try { const q = await getJSON(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(sym)}`, h, opts.fetchImpl); prev = num(q.previousClose ?? q.referencePrice); name = q.name || ""; } catch {}
  return { ...p, prev, name, source: "富果" };
}
export async function fromYahoo(code, { fetchImpl = fetch } = {}) {
  const isIdx = !!INDEX[code], syms = isIdx ? [INDEX[code].yahoo] : [`${code}.TW`, `${code}.TWO`];
  for (const s of syms) {
    try {
      const p = parseYahooIntraday(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1m&range=1d`, {}, fetchImpl), isIdx);
      if (p && p.bars.length) return { ...p, source: "Yahoo Finance（可能延遲）" };
    } catch {}
  }
  return null;
}

const ymd = sec => new Date(sec * 1000).toISOString().slice(0, 10);
const toMin = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };

const HISTORY_START_DATE = "2023-05-23";
const HISTORY_CHUNK_DAYS = 30;
const shiftYmd = (day, delta) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const validYmd = day => {
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day;
};

function parseFugleHistoryCandles(j) {
  const bars = (Array.isArray(j?.data) ? j.data : []).map(x => {
    const date = String(x.date || ""), volume = num(x.volume);
    return {
      d: date.slice(0, 10), t: hhmm(date),
      o: num(x.open), h: num(x.high), l: num(x.low), c: num(x.close),
      ...(volume != null && volume >= 0 ? { v: volume } : { v: null, vNa: 1 }),
    };
  }).filter(b => validYmd(b.d) && b.o != null && b.h != null && b.l != null && b.c != null)
    .sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
  return bars;
}

function indexHistoryBounds(before) {
  if (!validYmd(before)) return { from: null, to: null, end: true, next: before, error: "before 日期無效" };
  const to = shiftYmd(before, -1);
  if (to < HISTORY_START_DATE) return { from: null, to, end: true, next: before };
  const candidate = shiftYmd(to, -(HISTORY_CHUNK_DAYS - 1));
  const from = candidate < HISTORY_START_DATE ? HISTORY_START_DATE : candidate;
  return { from, to, end: from === HISTORY_START_DATE, next: from };
}

async function indexHistory(code, tf, before, { fetchImpl = fetch, sleep, yahooBarsImpl = yahooBars } = {}) {
  const bounds = indexHistoryBounds(before);
  const base = {
    bars: [], prev: null, name: INDEX[code].name, session: null, unit: "億元",
    end: bounds.end, next: bounds.next, amountNa: true,
  };
  if (bounds.error) return { ...base, error: bounds.error, source: "Fugle Historical Candles" };
  if (!bounds.from) return { ...base, source: "Fugle Historical Candles" };

  const key = (process.env.FUGLE_API_KEY || "").trim();
  let fugleError = null;
  if (key) {
    const params = new URLSearchParams({
      timeframe: String(tf), from: bounds.from, to: bounds.to,
      fields: "open,high,low,close,volume", sort: "asc",
    });
    const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${encodeURIComponent(INDEX[code].fugle)}?${params}`;
    try {
      const j = await getJSONRetry(url, { "X-API-KEY": key }, { fetchImpl, sleep });
      const rawBars = parseFugleHistoryCandles(j);
      const bars = rawBars.map(b => ({ ...b, v: b.v == null ? null : toYi(b.v) }));
      return { ...base, bars, source: "Fugle Historical Candles", amountNa: !bars.some(b => b.v != null) };
    } catch (e) {
      if (e.status === 404) return { ...base, source: "Fugle Historical Candles" };
      fugleError = e;
    }
  }

  const reason = !key ? "未設定 FUGLE_API_KEY" :
    [401, 403].includes(fugleError?.status) ? "Fugle 權限不可用" :
    `Fugle 暫時無法取得（${fugleError?.message || "未知錯誤"}）`;
  const period1 = Date.parse(`${bounds.from}T00:00:00+08:00`) / 1000;
  const period2 = Date.parse(`${shiftYmd(bounds.to, 1)}T00:00:00+08:00`) / 1000;
  try {
    const p = await yahooBarsImpl(INDEX[code].yahoo, tf, { period1, period2, isIdx: true });
    const bars = (p?.bars || []).filter(b =>
      b.d >= bounds.from && b.d <= bounds.to && toMin(b.t) >= 540 && toMin(b.t) <= 810
    ).map(b => ({ ...b, v: null, vNa: 1 }))
      .sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
    if (bars.length) return {
      ...base, bars, prev: p.prev ?? null,
      source: `Yahoo Finance（歷史價格備援；${reason}；成交金額暫缺）`,
    };
    return { ...base, error: `${reason}；Yahoo Finance 備援沒有可用價格資料`, source: "Yahoo Finance（歷史價格備援；成交金額暫缺）" };
  } catch (e) {
    return { ...base, error: `${reason}；Yahoo Finance 備援失敗（${e.message}）`, source: "Yahoo Finance（歷史價格備援；成交金額暫缺）" };
  }
}

// 個股及美股歷史維持原本 Yahoo 行為與資料單位。
async function yahooHistory(code, tf, before, yahooBarsImpl = yahooBars) {
  const us = isUS(code), lim = INTRADAY_LIMIT[tf] || INTRADAY_LIMIT[1], now = Date.now() / 1000, earliest = now - lim.back * 86400;
  const period2 = Date.parse(`${before}T00:00:00${us ? "-04:00" : "+08:00"}`) / 1000;
  if (!Number.isFinite(period2) || period2 <= earliest + 3600) return { bars: [], end: true, next: before };
  const period1 = Math.max(earliest, period2 - lim.chunk * 86400), isIdx = false;
  const syms = us ? [code] : [`${code}.TW`, `${code}.TWO`];
  let last = null;
  for (const s of syms) {
    try {
      const p = await yahooBarsImpl(s, tf, { period1, period2, isIdx });
      if (!p) continue;
      const o = us ? toMin(p.session.open) : 540, c = us ? toMin(p.session.close) : 810;
      const bars = p.bars.filter(b => b.d < before && toMin(b.t) >= o && toMin(b.t) <= c);
      last = { bars, prev: p.prev, name: us ? usName(code, p.meta?.shortName) : "", session: us ? p.session : null };
      if (bars.length) break;
    } catch (e) { last = last || { error: e.message }; }
  }
  return { ...(last || {}), bars: last?.bars || [], end: period1 <= earliest + 1, next: ymd(period1 + (us ? -4 : 8) * 3600) };
}
async function history(code, tf, before, opts = {}) {
  return INDEX[code] ? indexHistory(code, tf, before, opts) : yahooHistory(code, tf, before, opts.yahooBarsImpl || yahooBars);
}
async function usToday(code, tf) {
  const p = await yahooBars(code, 1);
  if (!p || !p.bars.length) return null;
  const o = toMin(p.session.open), c = toMin(p.session.close), day = p.bars[p.bars.length - 1].d;
  const bars = p.bars.filter(b => b.d === day && toMin(b.t) >= o && toMin(b.t) <= c);
  return { date: day, bars: aggregate(bars, tf, o), prev: p.prev, name: usName(code, p.meta?.shortName), session: p.session, source: "Yahoo Finance（美股可能延遲 15 分鐘）", unit: "千股" };
}

// 單位：個股「張」、美股「千股」、指數（t00、o00）是成交金額「億元」（富果才有；Yahoo 沒有，v 是 null）
export default async function handler(req, res, { fetchImpl = fetch, sleep, yahooBarsImpl = yahooBars } = {}) {
  const code = normCode(req.query?.code), tf = TFS.includes(+req.query?.tf) ? +req.query.tf : 1;
  if (!code) return res.status(400).json({ ok: false, error: "請給股票代號，例如 ?code=2330&tf=5（t00 是加權指數，美股用英文代號）。" });
  const before = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.before || "")) ? String(req.query.before) : null, us = isUS(code);
  if (before) {
    const h = await history(code, tf, before, { fetchImpl, sleep, yahooBarsImpl });
    const empty = !h.bars.length;
    res.setHeader("Cache-Control", empty ? "no-store, max-age=0" : "s-maxage=3600, stale-while-revalidate=86400");
    if (h.error && empty && !h.end) return res.status(200).json({ ok: false, empty: true, error: `拿不到更早的分 K（${h.error}）` });
    return res.status(200).json({
      ok: true, code, tf, source: h.source || "Yahoo Finance", bars: h.bars,
      end: h.end, next: h.next, prev: h.prev ?? null, name: h.name || "",
      session: h.session || null, unit: us ? "千股" : INDEX[code] ? "億元" : "張",
      ...(INDEX[code] ? { amountNa: h.amountNa ?? !h.bars.some(b => b.v != null) } : {}),
      ...(empty ? { empty: true } : {}),
    });
  }
  if (us) {
    try {
      const p = await usToday(code, tf);
      if (p) { res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120"); return res.status(200).json({ ok: true, code, tf, ...p }); }
    } catch (e) { return res.status(200).json({ ok: false, error: `拿不到 ${code} 的分 K（${e.message}）` }); }
    return res.status(200).json({ ok: false, error: `拿不到 ${code} 的分 K` });
  }
  const key = (process.env.FUGLE_API_KEY || "").trim(), errors = [];
  for (const [name, run] of [...(key ? [["富果", () => fromFugle(code, key, { fetchImpl, sleep })]] : []), ["Yahoo", () => fromYahoo(code, { fetchImpl })]]) {
    try {
      const p = await run();
      if (p) {
        res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
        if (req.query?.spark) return res.status(200).json({ ok: true, code, source: p.source, date: p.date, prev: p.prev ?? null, spark: p.bars.map(b => [b.t, b.c]), session: { open: "09:00", close: "13:30" } });
        const idx = !!INDEX[code], bars = aggregate(p.bars.map(b => ({ d: p.date, ...b })), tf);
        // 指數：先用元合成 N 分 K 再換億元（不會因為每根先四捨五入而累積誤差）；整段都沒有成交金額時標 amountNa（前端顯示「成交金額暫缺」，不是 0）
        const out = idx ? bars.map(b => ({ ...b, v: toYi(b.v) })) : bars;
        return res.status(200).json({ ok: true, code, name: p.name || INDEX[code]?.name || "", source: p.source, date: p.date, tf, prev: p.prev ?? null, bars: out, unit: idx ? "億元" : "張", ...(idx ? { amountNa: !out.some(b => b.v != null) } : {}), session: { open: "09:00", close: "13:30" } });
      }
      errors.push(`${name}: 沒有資料`);
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  return res.status(200).json({ ok: false, error: `拿不到 ${code} 的盤中分 K（${errors.join("；")}）。${key ? "" : "設定富果 API 金鑰（FUGLE_API_KEY）會比較穩定。"}` });
}
