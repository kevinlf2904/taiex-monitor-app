// 共用：Yahoo Finance（美股報價、分 K、熱門股）。檔名以底線開頭，Vercel 不會把它當成 API 路由。
// 美股代號：英文字母（AAPL、BRK-B、^GSPC 這類指數也可以）。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
export const num = v => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);
// 美股或其他 Yahoo 代號（不是台股數字代號）
export const isUS = c => /^\^?[A-Z][A-Z0-9]{0,5}([.-][A-Z]{1,2})?$/.test(String(c || "")) && !/^(T00|O00)$/.test(c);
export const US_NAMES = {
  AAPL: "蘋果", MSFT: "微軟", NVDA: "輝達", AMZN: "亞馬遜", GOOGL: "Alphabet", META: "Meta", TSLA: "特斯拉", AVGO: "博通", TSM: "台積電 ADR", AMD: "超微",
  NFLX: "Netflix", PLTR: "Palantir", INTC: "英特爾", MU: "美光", QCOM: "高通", ARM: "安謀", SMCI: "美超微", COST: "好市多", JPM: "摩根大通", BRK_B: "波克夏",
  SPY: "S&P 500 ETF", QQQ: "那斯達克 100 ETF", SOXX: "費半 ETF", TQQQ: "3 倍那斯達克", SOXL: "3 倍半導體", "^GSPC": "S&P 500", "^IXIC": "那斯達克", "^DJI": "道瓊", "^SOX": "費城半導體",
};
export const US_POPULAR = ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "GOOGL", "META", "AVGO", "TSM", "AMD", "PLTR", "NFLX", "MU", "INTC", "QCOM", "ARM", "SMCI", "COST", "JPM", "SPY", "QQQ", "SOXX", "TQQQ", "SOXL"];
export const usName = (sym, fallback) => US_NAMES[sym] || US_NAMES[sym.replace("-", "_")] || fallback || sym;

export async function getJSON(url, headers = {}, ms = 8000) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const chartURL = (sym, q) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${q}`;
// 交易時段（以交易所當地時間 HH:MM 表示）
const localHM = (sec, off) => new Date((sec + off) * 1000).toISOString().slice(11, 16);
export function sessionOf(meta, nowSec = Date.now() / 1000) {
  const p = meta?.currentTradingPeriod, off = meta?.gmtoffset ?? 0;
  if (!p?.regular) return { state: "closed", open: "09:30", close: "16:00" };
  const r = p.regular, pre = p.pre;
  const state = nowSec >= r.start && nowSec < r.end ? "open" : pre && nowSec >= pre.start && nowSec < pre.end ? "pre" : "closed";
  return { state, open: localHM(r.start, off), close: localHM(r.end, off) };
}
// Yahoo chart 的 meta → 和 /api/quote 相同格式的報價
export function quoteFromMeta(sym, meta, nowSec) {
  const price = num(meta.regularMarketPrice), prev = num(meta.chartPreviousClose ?? meta.previousClose), off = meta.gmtoffset ?? 0, t = meta.regularMarketTime;
  return { code: sym, name: usName(sym, meta.shortName || meta.longName), market: meta.exchangeName || meta.fullExchangeName || "美股", currency: meta.currency || "USD",
    price, prev, open: null, high: num(meta.regularMarketDayHigh), low: num(meta.regularMarketDayLow), vol: num(meta.regularMarketVolume),
    chg: price != null && prev ? +(price - prev).toFixed(2) : null, chgPct: price != null && prev ? +((price / prev - 1) * 100).toFixed(2) : null,
    time: t ? localHM(t, off) + ":" + new Date((t + off) * 1000).toISOString().slice(17, 19) : null, date: t ? new Date((t + off) * 1000).toISOString().slice(0, 10) : null,
    bids: [], asks: [], estimated: false, us: true, session: sessionOf(meta, nowSec) };
}
export async function yahooQuote(sym) {
  const j = await getJSON(chartURL(sym, "range=1d&interval=1d"));
  const r = j?.chart?.result?.[0]; if (!r?.meta) throw new Error("沒有資料");
  const q = quoteFromMeta(sym, r.meta), o = r.indicators?.quote?.[0];
  if (o?.open?.length) q.open = num(o.open[o.open.length - 1]);
  return q;
}
// 分 K：tf 分鐘；period 給秒（epoch），沒給就是最近一天。回傳交易所當地時間的日期與時間
const TF_INTERVAL = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "60m" };
export function parseYahooBars(j, isIdx = false, shares = false) {
  const r = j?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return null;
  const off = r.meta?.gmtoffset ?? 0;
  const bars = r.timestamp.map((t, k) => { const iso = new Date((t + off) * 1000).toISOString(); return { d: iso.slice(0, 10), t: iso.slice(11, 16), o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], v: isIdx || q.volume[k] == null ? 0 : shares ? q.volume[k] : Math.round(q.volume[k] / 1000) }; })
    .filter(b => b.o != null && b.h != null && b.l != null && b.c != null)
    .map(b => ({ ...b, o: +b.o.toFixed(2), h: +b.h.toFixed(2), l: +b.l.toFixed(2), c: +b.c.toFixed(2) }));
  return { bars, meta: r.meta, prev: num(r.meta?.chartPreviousClose ?? r.meta?.previousClose), session: sessionOf(r.meta) };
}
export async function yahooBars(sym, tf, { period1, period2, isIdx = false, shares = false } = {}) {
  const span = period1 && period2 ? `period1=${Math.floor(period1)}&period2=${Math.floor(period2)}` : "range=1d";
  return parseYahooBars(await getJSON(chartURL(sym, `${span}&interval=${TF_INTERVAL[tf] || "1m"}&includePrePost=false`)), isIdx, shares);
}
// 每種分 K 在 Yahoo 能往回查多久（天）、一次查幾天
export const INTRADAY_LIMIT = { 1: { back: 29, chunk: 7 }, 5: { back: 59, chunk: 20 }, 15: { back: 59, chunk: 30 }, 30: { back: 59, chunk: 45 }, 60: { back: 729, chunk: 180 } };

// 美股熱門：先試 Yahoo 的「最活躍」篩選，失敗時用內建的熱門清單
export async function usHot(type = "active") {
  const scr = { active: "most_actives", gain: "day_gainers", loss: "day_losers" }[type] || "most_actives";
  try {
    const j = await getJSON(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scr}&count=30`);
    const qs = j?.finance?.result?.[0]?.quotes;
    if (Array.isArray(qs) && qs.length) return { source: "Yahoo Finance 篩選", rows: qs.map(q => ({ code: q.symbol, name: usName(q.symbol, q.shortName || q.longName), price: num(q.regularMarketPrice), chg: num(q.regularMarketChange), chgPct: num(q.regularMarketChangePercent) != null ? +num(q.regularMarketChangePercent).toFixed(2) : null, vol: num(q.regularMarketVolume), us: true })) };
  } catch {}
  const rows = (await Promise.allSettled(US_POPULAR.map(yahooQuote))).filter(r => r.status === "fulfilled").map(r => r.value);
  if (type === "gain") rows.sort((a, b) => (b.chgPct ?? -1e9) - (a.chgPct ?? -1e9));
  else if (type === "loss") rows.sort((a, b) => (a.chgPct ?? 1e9) - (b.chgPct ?? 1e9));
  else rows.sort((a, b) => (b.vol ?? 0) * (b.price ?? 0) - (a.vol ?? 0) * (a.price ?? 0));
  return { source: "Yahoo Finance（熱門清單）", rows };
}
