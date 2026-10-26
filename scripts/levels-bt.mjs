// 今日市場「位置燈號」的價位推估回測：比較幾種分水嶺、支撐壓力的算法，哪一種比較準。
// 純計算（buildDays、evalMethods）給單元測試用假資料測；抓資料（loadAll）只在 probe-live 的 levels 模式跑（GitHub Actions 才連得到 Yahoo、FinMind）。
// 每一天只用「那天開盤前」就知道的資料：前一交易日收盤、夜盤、前一晚美股、前 14 天的波動；有參數要配的方法只用前段（訓練期）配，後段（測試期）才算成績。

const UA = { "User-Agent": "Mozilla/5.0" };
const iso = d => new Date(d).toISOString().slice(0, 10);

// ---------- 抓資料 ----------
async function yahooDaily(sym, range = "5y") {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`, { headers: UA, signal: AbortSignal.timeout(20000) });
  const j = await r.json(), x = j?.chart?.result?.[0], q = x?.indicators?.quote?.[0], ts = x?.timestamp || [], off = x?.meta?.gmtoffset ?? 0;
  return ts.map((t, i) => ({ d: iso((t + off) * 1000), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter(b => b.c != null && b.o != null);
}
async function finmindFut(start, end) {
  const tok = (process.env.FINMIND_TOKEN || "").trim(), H = { ...UA, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, rows = [];
  for (let y = +start.slice(0, 4); y <= +end.slice(0, 4); y++) { // 一次一年，免費額度比較不會被擋
    const r = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesDaily&data_id=TX&start_date=${y}-01-01&end_date=${y}-12-31`, { headers: H, signal: AbortSignal.timeout(30000) });
    const j = await r.json(); rows.push(...(j.data || []));
  }
  return rows;
}
// 每個日期、每個時段取成交量最大的月合約（近月）；回 { 日期: { day: {c, contract}, night: {c, contract} } }
export function futByDate(rows) {
  const by = {};
  for (const r of rows || []) {
    const ct = String(r.contract_date || "").trim(); if (!/^\d{6}$/.test(ct)) continue; // 只要月合約（跳過週選、價差）
    const s = r.trading_session === "after_market" ? "night" : "day", v = +r.volume || 0, c = +r.close;
    if (!(c > 0)) continue; const k = ((by[r.date] ||= {})[s] ||= { v: -1 }); if (v > k.v) Object.assign(k, { v, c, contract: ct });
  }
  return by;
}
export async function loadAll() {
  const [tw, sox, ixic, tsm] = await Promise.all(["^TWII", "^SOX", "^IXIC", "TSM"].map(s => yahooDaily(s)));
  const fut = futByDate(await finmindFut(tw[0].d, tw.at(-1).d));
  return { tw, sox, ixic, tsm, fut };
}

// ---------- 整理成每一天的特徵（只用開盤前知道的） ----------
// nightOn：FinMind 盤後時段掛在哪一天——"same"＝掛在它所屬的交易日（盤後 15:00 開始、算下一個交易日），"prev"＝掛在開始那天
export function buildDays({ tw, sox, ixic, tsm, fut }, nightOn = "same") {
  const usPct = A => { const m = new Map(); A.forEach((b, i) => { if (i) m.set(b.d, (b.c / A[i - 1].c - 1) * 100); }); return m; };
  const S = usPct(sox || []), I = usPct(ixic || []), T = usPct(tsm || []);
  const lastUs = (m, d) => { let best = null; for (const [k, v] of m) if (k < d && (!best || k > best[0])) best = [k, v]; return best?.[1] ?? null; }; // 台股那天之前最後一個美股交易日
  const out = [];
  for (let i = 15; i < tw.length; i++) {
    const t = tw[i], p = tw[i - 1], d = t.d;
    const tr = tw.slice(i - 14, i).map((b, k) => Math.max(b.h - b.l, Math.abs(b.h - tw[i - 15 + k].c), Math.abs(b.l - tw[i - 15 + k].c))), atr = tr.reduce((a, b) => a + b, 0) / tr.length;
    const dayPrev = fut?.[p.d]?.day, night = nightOn === "same" ? fut?.[d]?.night : fut?.[p.d]?.night;
    const futChg = dayPrev && night && night.contract === dayPrev.contract ? night.c - dayPrev.c : null; // 同一個合約才相減（換月那天不算）
    out.push({ d, prev: p.c, o: t.o, h: t.h, l: t.l, c: t.c, atr, futChg, sox: lastUs(S, d), ixic: lastUs(I, d), tsm: lastUs(T, d) });
  }
  return out;
}

// ---------- 算法 ----------
const band0 = x => Math.max(80, Math.round(x.prev * 0.006));
// 最小平方法（含截距），X 是特徵陣列
function ols(X, y) {
  const n = X[0].length + 1, A = Array.from({ length: n }, () => Array(n + 1).fill(0));
  X.forEach((r, i) => { const v = [1, ...r]; for (let a = 0; a < n; a++) { for (let b = 0; b < n; b++) A[a][b] += v[a] * v[b]; A[a][n] += v[a] * y[i]; } });
  for (let c = 0; c < n; c++) { let m = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r; [A[c], A[m]] = [A[m], A[c]]; if (Math.abs(A[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; } }
  return A.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}
const fitLin = (train, feats) => { const T = train.filter(x => feats.every(f => x[f] != null)); if (T.length < 30) return null; const w = ols(T.map(x => feats.map(f => (f === "futChg" ? x[f] : x[f] * x.prev / 100))), T.map(x => x.c - x.prev)); return x => (feats.every(f => x[f] != null) ? x.prev + w[0] + feats.reduce((s, f, k) => s + w[k + 1] * (f === "futChg" ? x[f] : x[f] * x.prev / 100), 0) : null); };
// 每個方法：fit(訓練資料) → (x) => { pivot, band }；pivot 回 null 代表那天資料不夠，不算
export const METHODS = [
  ["昨收（什麼都不看）", () => x => ({ pivot: x.prev, band: band0(x) })],
  ["目前：昨收＋夜盤×0.85", () => x => ({ pivot: x.prev + (x.futChg ?? 0) * 0.85, band: band0(x) })],
  ["目前（只算有夜盤的日子）", () => x => (x.futChg == null ? null : { pivot: x.prev + x.futChg * 0.85, band: band0(x) })],
  ["夜盤（係數用訓練期配）", tr => { const f = fitLin(tr, ["futChg"]); return x => (f && f(x) != null ? { pivot: f(x), band: band0(x) } : null); }],
  ["美股：費半＋那指（配係數）", tr => { const f = fitLin(tr, ["sox", "ixic"]); return x => (f && f(x) != null ? { pivot: f(x), band: band0(x) } : null); }],
  ["夜盤＋費半＋那指＋ADR（配係數）", tr => { const f = fitLin(tr, ["futChg", "sox", "ixic", "tsm"]); return x => (f && f(x) != null ? { pivot: f(x), band: band0(x) } : null); }],
  ["目前分水嶺＋間距 0.5×ATR14", () => x => (x.futChg == null ? null : { pivot: x.prev + x.futChg * 0.85, band: Math.round(0.5 * x.atr) })],
  ["目前分水嶺＋間距 0.75×ATR14", () => x => (x.futChg == null ? null : { pivot: x.prev + x.futChg * 0.85, band: Math.round(0.75 * x.atr) })]
];

// ---------- 成績 ----------
// mae：分水嶺離收盤幾點；dir：分水嶺相對昨收的方向，和收盤相對昨收的方向一樣的比例；keep：開盤在分水嶺哪一邊，收盤還在同一邊的比例（燈號「開盤就定調」有多可靠）；
// inBand：收盤落在支撐～壓力之間；hitP／hitS：盤中碰到壓力／支撐；gapMae：分水嶺離開盤幾點
export function score(days, pred) {
  const R = days.map(x => [x, pred(x)]).filter(([, p]) => p && Number.isFinite(p.pivot));
  if (!R.length) return null;
  const n = R.length, avg = f => R.reduce((s, r) => s + f(...r), 0) / n, pct = f => Math.round(avg((x, p) => (f(x, p) ? 1 : 0)) * 1000) / 10;
  const D = R.filter(([x, p]) => p.pivot !== x.prev && x.c !== x.prev);
  return { n, mae: Math.round(avg((x, p) => Math.abs(x.c - p.pivot))), gapMae: Math.round(avg((x, p) => Math.abs(x.o - p.pivot))),
    dir: D.length ? Math.round(D.filter(([x, p]) => Math.sign(p.pivot - x.prev) === Math.sign(x.c - x.prev)).length / D.length * 1000) / 10 : null,
    keep: pct((x, p) => (x.o >= p.pivot) === (x.c >= p.pivot)), inBand: pct((x, p) => x.c <= p.pivot + p.band && x.c >= p.pivot - p.band),
    hitP: pct((x, p) => x.h >= p.pivot + p.band), hitS: pct((x, p) => x.l <= p.pivot - p.band), band: Math.round(avg((x, p) => p.band)) };
}
// 前 split 比例當訓練期、後面當測試期
export function evalMethods(days, split = 0.6) {
  const k = Math.floor(days.length * split), train = days.slice(0, k), test = days.slice(k);
  return METHODS.map(([name, fit]) => { const pred = fit(train); return { name, train: score(train, pred), test: score(test, pred) }; });
}
