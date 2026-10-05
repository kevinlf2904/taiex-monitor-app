// 真實年化報酬：給 learner/savings.html（存股模擬器）的「抓真實年化率」使用。
// GET /api/annual?code=0050        台股代號（先試上市 .TW，再試上櫃 .TWO）
// GET /api/annual?code=S%26P%20500  常見指數名稱，改用追蹤它的 ETF（含息）估算
// GET /api/annual?code=VOO         英文代號直接當 Yahoo 代號
// 主要來源 Yahoo Finance 月線的「還原收盤價」（含配息再投入）；失敗時改用 FinMind 還原股價（台股）。
// 回傳近 1、3、5、10 年與上市以來的年化報酬（CAGR）和期間最大跌幅（月收盤計算，會比日線的跌幅小一些）。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };

// 指數名稱 → 追蹤它的 ETF（含息總報酬，美元計價）
export const ALIASES = {
  "S&P500": ["SPY", "S&P 500（以 SPY 估算）"], "SP500": ["SPY", "S&P 500（以 SPY 估算）"], "標普500": ["SPY", "S&P 500（以 SPY 估算）"], "標普": ["SPY", "S&P 500（以 SPY 估算）"],
  "道瓊": ["DIA", "道瓊（以 DIA 估算）"], "DOW": ["DIA", "道瓊（以 DIA 估算）"], "道瓊工業": ["DIA", "道瓊（以 DIA 估算）"],
  "那斯達克100": ["QQQ", "那斯達克 100（以 QQQ 估算）"], "那斯達克": ["QQQ", "那斯達克 100（以 QQQ 估算）"], "NASDAQ100": ["QQQ", "那斯達克 100（以 QQQ 估算）"], "NASDAQ": ["QQQ", "那斯達克 100（以 QQQ 估算）"],
  "費半": ["SOXX", "費城半導體（以 SOXX 估算）"], "費城半導體": ["SOXX", "費城半導體（以 SOXX 估算）"], "SOX": ["SOXX", "費城半導體（以 SOXX 估算）"],
  "台灣加權": ["^TWII", "台灣加權指數（未含息）"], "加權": ["^TWII", "台灣加權指數（未含息）"], "加權指數": ["^TWII", "台灣加權指數（未含息）"], "大盤": ["^TWII", "台灣加權指數（未含息）"],
  "全世界": ["VT", "全世界股票（以 VT 估算）"], "全球": ["VT", "全世界股票（以 VT 估算）"],
};

// 標的名稱（例如「0050 元大台灣50」「S&P 500」「VOO」）→ 要查的代號
export function resolve(raw) {
  const s = String(raw || "").trim(), first = s.split(/\s+/)[0].toUpperCase(), key = s.replace(/\s+/g, "").toUpperCase();
  if (/^\d{4,6}[A-Z]?$/.test(first)) return { kind: "tw", code: first };
  for (const [k, v] of Object.entries(ALIASES)) if (key === k.toUpperCase() || key.startsWith(k.toUpperCase())) return { kind: "us", symbol: v[0], label: v[1] };
  if (/^\^?[A-Z][A-Z0-9.\-]{0,9}$/.test(first)) return { kind: "us", symbol: first };
  return null;
}

// Yahoo 月線：取還原收盤價（含息）；沒有 adjclose 時退回收盤價並標示未含息
export function parseYahooMonthly(j) {
  const r = j?.chart?.result?.[0];
  if (!r || !Array.isArray(r.timestamp)) return null;
  const adj = r.indicators?.adjclose?.[0]?.adjclose, close = r.indicators?.quote?.[0]?.close || [];
  const vals = adj && adj.some(v => v != null) ? adj : close;
  const tz = r.meta?.gmtoffset ?? 0;
  const rows = r.timestamp.map((t, k) => ({ d: new Date((t + tz) * 1000).toISOString().slice(0, 7), v: vals[k] })).filter(x => x.v != null && x.v > 0);
  // 同一個月重複（最新一筆常是當月盤中）只留最後一筆
  const by = new Map(); rows.forEach(x => by.set(x.d, x.v));
  return { name: r.meta?.longName || r.meta?.shortName || "", currency: r.meta?.currency || "", adjusted: vals === adj, rows: [...by].map(([d, v]) => ({ d, v })) };
}
// FinMind 日線（還原股價或一般股價）→ 每月最後一個交易日
export function monthlyFromDaily(rows) {
  const by = new Map(); rows.filter(x => x.date && x.close > 0).sort((a, b) => a.date.localeCompare(b.date)).forEach(x => by.set(x.date.slice(0, 7), x.close));
  return [...by].map(([d, v]) => ({ d, v }));
}
const monthsBetween = (a, b) => { const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };
// 年化報酬（CAGR）與期間最大跌幅：用最後一個月往回 N 年；資料不夠長時回傳 null
export function stats(rows, years) {
  if (!rows || rows.length < 2) return null;
  const end = rows[rows.length - 1];
  let i0 = 0;
  if (years) { const need = years * 12; i0 = rows.findIndex(x => monthsBetween(x.d, end.d) <= need); if (i0 < 0 || monthsBetween(rows[i0].d, end.d) < need - 1) return null; }
  const start = rows[i0], n = monthsBetween(start.d, end.d) / 12;
  if (n < 0.5) return null;
  let peak = 0, mdd = 0;
  for (let k = i0; k < rows.length; k++) { peak = Math.max(peak, rows[k].v); mdd = Math.max(mdd, 1 - rows[k].v / peak); }
  return { cagr: +((Math.pow(end.v / start.v, 1 / n) - 1) * 100).toFixed(2), mdd: +(mdd * 100).toFixed(1), from: start.d, to: end.d, years: +n.toFixed(1) };
}
export function summarize(rows) {
  const out = {}; [1, 3, 5, 10].forEach(y => { const s = stats(rows, y); if (s) out[y] = s; });
  out.max = stats(rows, 0); return out;
}

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fromYahoo(symbol) {
  const p = parseYahooMonthly(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1mo&events=div%2Csplit`));
  return p && p.rows.length >= 7 ? { ...p, symbol, source: "Yahoo Finance" } : null;
}
async function fromFinMind(code) {
  const token = process.env.FINMIND_TOKEN, h = token ? { Authorization: `Bearer ${token}` } : {};
  for (const [ds, adjusted] of [["TaiwanStockPriceAdj", true], ["TaiwanStockPrice", false]]) {
    try {
      const j = await getJSON(`https://api.finmindtrade.com/api/v4/data?dataset=${ds}&data_id=${encodeURIComponent(code)}&start_date=2000-01-01`, h);
      const rows = monthlyFromDaily(Array.isArray(j?.data) ? j.data : []);
      if (rows.length >= 7) return { name: "", currency: "TWD", adjusted, rows, symbol: code, source: adjusted ? "FinMind 還原股價" : "FinMind（未含息）" };
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  const raw = String(req.query?.code || "").slice(0, 40), t = resolve(raw);
  if (!t) return res.status(400).json({ ok: false, error: `看不出「${raw}」是哪一檔。標的名稱請以台股代號開頭（例如「0050 元大台灣50」），或填英文代號（例如 VOO、SPY），或 S&P 500、道瓊、那斯達克100、費半。` });
  const tries = t.kind === "tw" ? [() => fromYahoo(`${t.code}.TW`), () => fromYahoo(`${t.code}.TWO`), () => fromFinMind(t.code)] : [() => fromYahoo(t.symbol)];
  const errors = [];
  for (const run of tries) {
    try {
      const p = await run();
      if (p) {
        res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
        return res.status(200).json({ ok: true, query: raw, symbol: p.symbol, label: t.label || "", name: p.name, currency: p.currency, adjusted: p.adjusted, source: p.source, first: p.rows[0].d, last: p.rows[p.rows.length - 1].d, periods: summarize(p.rows) });
      }
    } catch (e) { errors.push(e.message); }
  }
  return res.status(200).json({ ok: false, error: `抓不到 ${raw} 的歷史資料。${errors.length ? `（${errors[0]}）` : "請確認代號是否正確。"}` });
}
