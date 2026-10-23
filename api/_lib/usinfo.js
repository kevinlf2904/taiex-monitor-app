// 美股個股資料：給 learner/watch.html 美股個股的「財務」分頁（公司與指標、營收與獲利、分析師與財報）。
// GET /api/usinfo?code=AAPL
// 來源（都免費）：
//   Finnhub（FINNHUB_API_KEY，每分鐘 60 次）：profile2 公司資料、metric 關鍵指標、recommendation 分析師評等、earnings 近四季 EPS 實際 vs 預估
//   SEC EDGAR（免金鑰）：company_tickers 找 CIK，companyconcept 拿 10-Q／10-K 申報的營收、淨利（單季與年度）
// 每一塊各自抓，某一塊失敗不影響其他塊（errors 會寫是哪一塊）。金額單位：美元（頁面再換成億）。
import { finnhubOn, finnhubOk } from "./_finnhub.js";

const FH = "https://finnhub.io/api/v1", fhKey = () => (process.env.FINNHUB_API_KEY || "").trim();
export const SEC_UA = () => (process.env.SEC_UA || "").trim() || "KlineSchool/1.0 (admin@kline-school.vercel.app)";
const num = v => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);
async function fh(path) {
  const r = await fetch(`${FH}${path}`, { headers: { "X-Finnhub-Token": fhKey(), Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`); return r.json();
}
export async function sec(url) {
  const r = await fetch(url, { headers: { "User-Agent": SEC_UA(), Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`SEC HTTP ${r.status}`); return r.json();
}

// Finnhub /stock/profile2：marketCapitalization、shareOutstanding 是「百萬」
export function parseProfile(j) {
  if (!j || !j.name) return null;
  return { name: j.name, country: j.country || "", exchange: j.exchange || "", industry: j.finnhubIndustry || "", ipo: j.ipo || "", web: j.weburl || "", logo: j.logo || "",
    cap: num(j.marketCapitalization) != null ? j.marketCapitalization * 1e6 : null, shares: num(j.shareOutstanding) != null ? j.shareOutstanding * 1e6 : null, currency: j.currency || "USD" };
}
// Finnhub /stock/metric?metric=all → 挑常用的（百分比欄位本來就是 %）
const MET = [["pe", "peTTM", "peBasicExclExtraTTM"], ["pb", "pbQuarterly", "pbAnnual"], ["ps", "psTTM"], ["eps", "epsTTM", "epsBasicExclExtraItemsTTM"], ["roe", "roeTTM"], ["roa", "roaTTM"],
  ["gm", "grossMarginTTM"], ["om", "operatingMarginTTM"], ["nm", "netProfitMarginTTM"], ["revG", "revenueGrowthTTMYoy"], ["epsG", "epsGrowthTTMYoy"], ["div", "currentDividendYieldTTM", "dividendYieldIndicatedAnnual"],
  ["beta", "beta"], ["hi52", "52WeekHigh"], ["lo52", "52WeekLow"], ["ret52", "52WeekPriceReturnDaily"], ["de", "totalDebt/totalEquityQuarterly", "totalDebt/totalEquityAnnual"], ["cr", "currentRatioQuarterly", "currentRatioAnnual"]];
export function parseMetric(j) {
  const m = j?.metric; if (!m) return null; const o = {};
  for (const [k, ...src] of MET) { for (const s of src) { const v = num(m[s]); if (v != null) { o[k] = +v.toFixed(2); break; } } }
  return Object.keys(o).length ? o : null;
}
// Finnhub /stock/recommendation → 最近 6 個月的評等家數
export const parseRec = L => (Array.isArray(L) ? L : []).filter(x => x?.period).slice(0, 6).map(x => ({ period: String(x.period).slice(0, 7), sb: x.strongBuy || 0, b: x.buy || 0, h: x.hold || 0, s: x.sell || 0, ss: x.strongSell || 0 }));
// Finnhub /stock/earnings → 近四季 EPS 實際、預估、驚喜%
export const parseEarn = L => (Array.isArray(L) ? L : []).filter(x => x?.period).map(x => ({ period: String(x.period).slice(0, 10), q: x.quarter, y: x.year, actual: num(x.actual), est: num(x.estimate), surp: num(x.surprisePercent) != null ? +(+x.surprisePercent).toFixed(2) : null }))
  .sort((a, b) => a.period.localeCompare(b.period));

// SEC companyconcept → 單季（frame CY2025Q3）與年度（frame CY2025）；第四季沒單獨申報時用「年度 − 前三季」補
export function parseConcept(j) {
  const L = Object.values(j?.units || {})[0] || [], q = new Map(), y = new Map();
  for (const x of L) { const f = String(x.frame || ""), v = num(x.val); if (v == null) continue;
    if (/^CY\d{4}Q[1-4]$/.test(f)) q.set(f, { p: f.slice(2), v, end: x.end }); else if (/^CY\d{4}$/.test(f) && /10-K/.test(x.form || "")) y.set(f.slice(2), { p: f.slice(2), v, end: x.end }); }
  for (const [yr, a] of y) { const k = `CY${yr}Q4`; if (q.has(k)) continue; const p = [1, 2, 3].map(i => q.get(`CY${yr}Q${i}`)); if (p.every(Boolean)) q.set(k, { p: `${yr}Q4`, v: a.v - p.reduce((s, x) => s + x.v, 0), end: a.end, derived: true }); }
  const sort = m => [...m.values()].sort((a, b) => a.p.localeCompare(b.p));
  return { q: sort(q).slice(-12), y: sort(y).slice(-6) };
}
let TICK = null; // ticker → CIK（約 1 萬檔，同一個執行個體重用）
export async function cikOf(sym) {
  if (!TICK || Date.now() - TICK.at > 864e5) { const j = await sec("https://www.sec.gov/files/company_tickers.json"); const m = new Map(); for (const x of Object.values(j || {})) if (x?.ticker) m.set(String(x.ticker).toUpperCase(), x.cik_str); TICK = { m, at: Date.now() }; }
  const c = TICK.m.get(sym) ?? TICK.m.get(sym.replace(".", "-")); return c == null ? null : String(c).padStart(10, "0");
}
const REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"];
async function secFin(sym) {
  const cik = await cikOf(sym); if (!cik) throw new Error("SEC 找不到這個代號（可能是外國公司，申報 20-F）");
  const concept = async tag => parseConcept(await sec(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`));
  let rev = null; for (const t of REV) { try { const r = await concept(t); if (r.q.length || r.y.length) { if (!rev || (r.q.at(-1)?.p || "") > (rev.q.at(-1)?.p || "")) rev = r; } } catch {} } // 公司換過科目名稱時取最新的那個
  const [ni, gp, op] = await Promise.all(["NetIncomeLoss", "GrossProfit", "OperatingIncomeLoss"].map(t => concept(t).catch(() => null)));
  const pick = (r, k) => Object.fromEntries((r?.[k] || []).map(x => [x.p, x.v]));
  const rows = k => { const R = pick(rev, k), N = pick(ni, k), G = pick(gp, k), O = pick(op, k); return [...new Set([...Object.keys(R), ...Object.keys(N)])].sort().map(p => ({ p, rev: R[p] ?? null, ni: N[p] ?? null, gp: G[p] ?? null, op: O[p] ?? null })).slice(k === "q" ? -8 : -5); };
  return { cik, q: rows("q"), y: rows("y") };
}

export default async function handler(req, res) {
  const sym = String(req.query?.code || "").trim().toUpperCase();
  if (!finnhubOk(sym)) return res.status(400).json({ ok: false, error: "請給美股代號，例如 ?code=AAPL" });
  const errors = [], on = finnhubOn(), e = (k, p) => p.catch(err => { errors.push(`${k}：${err.message}`); return null; });
  const [pr, me, rc, ea, fin] = await Promise.all([
    on ? e("公司資料", fh(`/stock/profile2?symbol=${encodeURIComponent(sym)}`).then(parseProfile)) : null,
    on ? e("關鍵指標", fh(`/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all`).then(parseMetric)) : null,
    on ? e("分析師評等", fh(`/stock/recommendation?symbol=${encodeURIComponent(sym)}`).then(parseRec)) : null,
    on ? e("EPS", fh(`/stock/earnings?symbol=${encodeURIComponent(sym)}`).then(parseEarn)) : null,
    e("SEC 財報", secFin(sym)),
  ]);
  if (!on) errors.push("沒有設定 FINNHUB_API_KEY，公司資料、指標、分析師評等、EPS 拿不到");
  if (!pr && !me && !fin?.q?.length) return res.status(200).json({ ok: false, error: `拿不到 ${sym} 的公司資料（${errors.join("；")}）` });
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json({ ok: true, code: sym, profile: pr, metric: me, rec: rc || [], earn: ea || [], fin: fin ? { q: fin.q, y: fin.y } : null, cik: fin?.cik || null, errors,
    source: [on ? "Finnhub" : "", fin ? "SEC EDGAR" : ""].filter(Boolean).join("、") });
}
