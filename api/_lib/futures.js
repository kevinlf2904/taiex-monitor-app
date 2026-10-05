// 台指期近月（近全：夜盤＋日盤）：給 learner/watch.html 的「台指期」使用。
// GET /api/futures            → 報價（日盤、夜盤各一份，current 是正在交易或最近的一盤）＋ 1 分 K（夜盤 15:00–05:00、日盤 08:45–13:45）
// GET /api/futures?bars=0     → 只要報價（清單輪詢用，比較省）
// 近月合約：每月第三個星期三結算，結算日 13:30 以後改看下個月。代號 TXF＋月份字母（A＝1 月…L＝12 月）＋年份個位數，例如 2026 年 10 月 → TXFJ6。
// 有 FUGLE_API_KEY 時用富果期貨 API（含 1 分 K）；沒有或失敗時用期交所行情網站（只有報價）。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const num = v => { if (v == null || v === "" || v === "-") return null; const n = parseFloat(String(v).replace(/[,\s+]/g, "")); return Number.isFinite(n) ? n : null; };
const tpe = (ms = Date.now()) => new Date(ms + 8 * 3600e3); // 用 UTC 欄位讀台北時間
const iso = d => d.toISOString().slice(0, 10);
export const MONTHS = "ABCDEFGHIJKL";
// 台指期（TXF）、電子期（EXF）、金融期（FXF）：近月合約規則相同
export const FUT_NAMES = { TXF: "台指期", EXF: "電子期", FXF: "金融期" };

function thirdWednesday(y, m) { const d = new Date(Date.UTC(y, m, 1)); const first = (3 - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + first + 14)); }
export function nearMonth(ms = Date.now(), cid = "TXF") {
  const t = tpe(ms); let y = t.getUTCFullYear(), m = t.getUTCMonth();
  const s = thirdWednesday(y, m), today = iso(t), mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (today > iso(s) || (today === iso(s) && mins >= 13 * 60 + 30)) { m++; if (m > 11) { m = 0; y++; } }
  return { code: `${cid}${MONTHS[m]}${y % 10}`, ym: `${y}-${String(m + 1).padStart(2, "0")}`, month: m + 1, settle: iso(thirdWednesday(y, m)) };
}
// 交易時段：日盤 08:45–13:45（週一～五），夜盤 15:00–隔天 05:00（週一～五開盤）
export function sessionOf(ms = Date.now()) {
  const t = tpe(ms), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (d >= 1 && d <= 5 && m >= 525 && m < 825) return "day";
  if ((d >= 1 && d <= 5 && m >= 900) || (d >= 2 && d <= 6 && m < 300)) return "night";
  return "closed";
}
const hms = ms => tpe(ms).toISOString().slice(11, 19);
const toMs = x => { if (x == null) return null; if (typeof x === "number") return x > 1e15 ? x / 1000 : x > 1e12 ? x : x * 1000; const p = Date.parse(x); return Number.isFinite(p) ? p : null; };

// 富果期貨報價 → 和 /api/quote 一樣的格式
export function parseFugleQuote(j, session) {
  if (!j || (j.lastPrice == null && j.closePrice == null)) return null;
  const price = num(j.lastPrice ?? j.closePrice), prev = num(j.referencePrice ?? j.previousClose), at = toMs(j.lastUpdated ?? j.lastTrade?.time);
  return { code: "TXF", symbol: j.symbol, name: j.name || "台指期", session, price, prev, open: num(j.openPrice), high: num(j.highPrice), low: num(j.lowPrice),
    vol: num(j.total?.tradeVolume ?? j.tradeVolume), chg: price != null && prev ? +(price - prev).toFixed(2) : num(j.change), chgPct: price != null && prev ? +((price / prev - 1) * 100).toFixed(2) : num(j.changePercent),
    time: at ? hms(at) : null, date: at ? iso(tpe(at)) : j.date || null, at };
}
export function parseFugleCandles(j, session) {
  return (j?.data || []).map(x => { const at = toMs(x.date ?? x.time); return at ? { at, d: iso(tpe(at)), t: hms(at).slice(0, 5), o: num(x.open), h: num(x.high), l: num(x.low), c: num(x.close), v: num(x.volume) || 0, s: session } : null; })
    .filter(b => b && b.o != null && b.c != null).sort((a, b) => a.at - b.at);
}
// 期交所行情網站 getQuoteList：MarketType 0 日盤、1 夜盤
export function parseTaifexList(j, near, session, cid = "TXF") {
  const L = j?.RtData?.QuoteList || j?.QuoteList || []; if (!Array.isArray(L) || !L.length) return null;
  const r = L.find(x => String(x.SymbolID || "").startsWith(near)) || L.find(x => new RegExp(`^${cid}[A-L]\\d`).test(String(x.SymbolID || "")) && num(x.CTotalVolume) > 0) || null;
  if (!r) return null;
  const price = num(r.CLastPrice), prev = num(r.CRefPrice), dt = String(r.CDate || ""), tm = String(r.CTime || "").padStart(6, "0");
  return { code: cid, symbol: String(r.SymbolID || "").replace(/-.*/, ""), name: r.DispCName || FUT_NAMES[cid], session, price, prev, open: num(r.COpenPrice), high: num(r.CHighPrice), low: num(r.CLowPrice), vol: num(r.CTotalVolume),
    chg: price != null && prev ? +(price - prev).toFixed(2) : num(r.CDiff), chgPct: price != null && prev ? +((price / prev - 1) * 100).toFixed(2) : num(r.CDiffRate),
    time: /^\d{6}$/.test(tm) ? `${tm.slice(0, 2)}:${tm.slice(2, 4)}:${tm.slice(4, 6)}` : null, date: /^\d{8}$/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6)}` : null };
}
// 近全：正在交易的那一盤；都收盤時取時間比較晚的那一盤
export function pickCurrent(day, night, sess) {
  if (sess === "day" && day) return day; if (sess === "night" && night) return night;
  if (day && night) return (night.at || Date.parse(`${night.date}T${night.time || "00:00:00"}+08:00`)) > (day.at || Date.parse(`${day.date}T${day.time || "00:00:00"}+08:00`)) ? night : day;
  return day || night || null;
}

async function getJSON(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fromFugle(sym, key, withBars) {
  const base = "https://api.fugle.tw/marketdata/v1.0/futopt/intraday", h = { headers: { "X-API-KEY": key } };
  const jobs = [getJSON(`${base}/quote/${sym}`, h), getJSON(`${base}/quote/${sym}?session=afterhours`, h)];
  if (withBars) jobs.push(getJSON(`${base}/candles/${sym}?timeframe=1`, h), getJSON(`${base}/candles/${sym}?timeframe=1&session=afterhours`, h));
  const [qd, qn, cd, cn] = await Promise.allSettled(jobs);
  const day = qd.status === "fulfilled" ? parseFugleQuote(qd.value, "day") : null, night = qn.status === "fulfilled" ? parseFugleQuote(qn.value, "night") : null;
  if (!day && !night) throw new Error(qd.reason?.message || "沒有報價");
  const bars = withBars ? [...(cn?.status === "fulfilled" ? parseFugleCandles(cn.value, "night") : []), ...(cd?.status === "fulfilled" ? parseFugleCandles(cd.value, "day") : [])].sort((a, b) => a.at - b.at) : [];
  return { day, night, bars, source: "富果期貨行情" };
}
async function fromTaifex(near, cid = "TXF") {
  const body = mt => JSON.stringify({ MarketType: mt, SymbolType: "F", KindID: "1", CID: cid, ExpireMonth: "", RowSize: "全部", PageNo: "", SortColumn: "", AscDesc: "A" });
  const post = mt => getJSON("https://mis.taifex.com.tw/futures/api/getQuoteList", { method: "POST", headers: { "Content-Type": "application/json" }, body: body(mt) });
  const [d, n] = await Promise.allSettled([post("0"), post("1")]);
  const day = d.status === "fulfilled" ? parseTaifexList(d.value, near, "day", cid) : null, night = n.status === "fulfilled" ? parseTaifexList(n.value, near, "night", cid) : null;
  if (!day && !night) throw new Error(d.reason?.message || "沒有報價");
  return { day, night, bars: [], source: "期交所行情網站" };
}

export default async function handler(req, res) {
  const cid = Object.hasOwn(FUT_NAMES, String(req.query?.cid || "").toUpperCase()) ? String(req.query.cid).toUpperCase() : "TXF", fname = FUT_NAMES[cid];
  const nm = nearMonth(Date.now(), cid), sess = sessionOf(), withBars = String(req.query?.bars ?? "1") !== "0", key = (process.env.FUGLE_API_KEY || "").trim(), errors = [];
  let r = null;
  if (key) { try { r = await fromFugle(nm.code, key, withBars); } catch (e) { errors.push(`富果：${e.message}`); } }
  if (!r) { try { r = await fromTaifex(nm.code, cid); } catch (e) { errors.push(`期交所：${e.message}`); } }
  if (!r) return res.status(200).json({ ok: false, error: `拿不到${fname}報價（${errors.join("；")}）` });
  const cur = pickCurrent(r.day, r.night, sess);
  res.setHeader("Cache-Control", `s-maxage=${sess === "closed" ? 60 : 5}, stale-while-revalidate=30`);
  return res.status(200).json({ ok: true, code: cid, name: `${fname} ${nm.month} 月`, symbol: nm.code, settle: nm.settle, session: sess, source: r.source,
    quote: cur ? { ...cur, code: cid, name: `${fname}近${cur.session === "night" ? "（夜盤）" : "（日盤）"}` } : null, day: r.day, night: r.night,
    bars: r.bars.map(({ at, ...b }) => b), note: r.bars.length ? null : key ? "富果沒有提供分 K" : "伺服器讀不到富果 API 金鑰（FUGLE_API_KEY），所以只有報價、沒有分時與分 K；請到「更多 → 資料來源狀態」檢查" });
}
