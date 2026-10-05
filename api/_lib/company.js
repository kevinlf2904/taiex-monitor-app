// 公司資訊：給 learner/watch.html 的「公司」分頁使用（台股）。
// GET /api/company?code=2330
// 來源：FinMind 開放資料（整理自公開資訊觀測站）＋證交所／櫃買中心 OpenAPI 的公司基本資料。
//   income   單季損益：營收、毛利、營業利益、稅後淨利、歸屬母公司淨利、EPS
//   balance  資產負債（季底）：總資產、總負債、權益、流動資產、流動負債
//   cash     單季現金流：營業、投資、籌資、資本支出、自由現金流（財報上是當年累計，這裡換算成單季）
//   dividend 每年股利：現金股利、股票股利、除息日
//   holders  股權分散：每週千張大戶（≥1000 張）與 400 張以上持股比例
//   profile  董事長、總經理、成立／上市日期、資本額、產業、網址、地址
// 金額單位：元（頁面再換成億）。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
export const num = v => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[,\s+%]/g, "")); return Number.isFinite(n) ? n : null; };
const qOf = d => { const [y, m] = String(d).split("-").map(Number); return `${y}Q${Math.ceil(m / 3)}`; };

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(9000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.msg || `HTTP ${r.status}`);
  return j;
}
async function finmind(dataset, code, start) {
  const token = (process.env.FINMIND_TOKEN || "").trim();
  const j = await getJSON(`https://api.finmindtrade.com/api/v4/data?dataset=${dataset}&data_id=${encodeURIComponent(code)}&start_date=${start}`, token ? { Authorization: `Bearer ${token}` } : {});
  if (!j || (j.status && j.status !== 200) || !Array.isArray(j.data)) throw new Error(j?.msg || "FinMind 沒有回傳資料");
  return j.data;
}
// 依英文 type 或中文科目名稱找值（排除 _per 這種百分比欄位）
function byDate(rows, spec) {
  const out = new Map();
  for (const r of rows) {
    const t = String(r.type || ""), o = String(r.origin_name || "").replace(/\s/g, ""); if (!r.date || /_per$/.test(t)) continue;
    for (const [k, types, names] of spec) {
      if (types.includes(t) || names.some(n => o === n)) { if (!out.has(r.date)) out.set(r.date, { d: r.date }); const x = out.get(r.date); if (x[k] == null) x[k] = num(r.value); break; }
    }
  }
  return [...out.values()].sort((a, b) => a.d.localeCompare(b.d));
}
export function parseIncome(rows) {
  return byDate(rows, [
    ["rev", ["Revenue"], ["營業收入合計", "營業收入"]], ["gp", ["GrossProfit"], ["營業毛利（毛損）", "營業毛利（毛損）淨額", "營業毛利"]],
    ["op", ["OperatingIncome"], ["營業利益（損失）", "營業利益"]], ["ni", ["IncomeAfterTaxes", "IncomeAfterTax"], ["本期淨利（淨損）", "本期淨利"]],
    ["nip", ["EquityAttributableToOwnersOfParent"], ["母公司業主（淨利／損）", "淨利（損）歸屬於母公司業主"]], ["eps", ["EPS"], ["基本每股盈餘"]],
  ]).filter(x => x.rev != null || x.eps != null).map(x => ({ q: qOf(x.d), ...x }));
}
export function parseBalance(rows) {
  return byDate(rows, [
    ["assets", ["TotalAssets"], ["資產總額", "資產總計"]], ["liab", ["Liabilities"], ["負債總額", "負債總計"]], ["equity", ["Equity"], ["權益總額", "權益總計"]],
    ["ca", ["CurrentAssets"], ["流動資產合計"]], ["cl", ["CurrentLiabilities"], ["流動負債合計"]], ["parentEq", ["EquityAttributableToOwnersOfParent"], ["歸屬於母公司業主之權益合計"]],
  ]).filter(x => x.assets != null).map(x => ({ q: qOf(x.d), ...x, liab: x.liab ?? (x.equity != null ? x.assets - x.equity : null), equity: x.equity ?? (x.liab != null ? x.assets - x.liab : null) }));
}
// 現金流量表是「當年累計」：Q2 = 上半年 − Q1，依此類推
export function parseCash(rows) {
  const cum = byDate(rows, [
    ["ocf", ["CashFlowsFromOperatingActivities", "NetCashInflowFromOperatingActivities"], ["營業活動之淨現金流入（流出）"]],
    ["icf", ["CashProvidedByInvestingActivities"], ["投資活動之淨現金流入（流出）"]],
    ["fcfFin", ["CashFlowsProvidedFromFinancingActivities"], ["籌資活動之淨現金流入（流出）"]],
    ["capex", ["PropertyAndPlantAndEquipment", "AcquisitionOfPropertyPlantAndEquipment"], ["取得不動產、廠房及設備"]],
  ]).filter(x => x.ocf != null);
  const byQ = new Map(cum.map(x => [qOf(x.d), x]));
  return cum.map(x => {
    const q = qOf(x.d), [y, n] = q.split("Q").map(Number), p = n > 1 ? byQ.get(`${y}Q${n - 1}`) : null;
    if (n > 1 && !p) return null; // 缺前一季就無法換算
    const d = k => (x[k] == null ? null : x[k] - (p?.[k] ?? 0));
    const ocf = d("ocf"), capex = d("capex");
    return { q, d: x.d, ocf, icf: d("icf"), fin: d("fcfFin"), capex, fcf: ocf != null ? ocf + (capex != null ? (capex > 0 ? -capex : capex) : 0) : null };
  }).filter(Boolean);
}
// 股利：依「股利所屬年度」彙總（盈餘＋公積）
export function parseDividend(rows) {
  const by = new Map();
  for (const r of rows) {
    const yr = String(r.year || "").replace(/[^\d]/g, ""), y = yr ? (+yr < 1911 ? +yr + 1911 : +yr) : r.date ? +String(r.date).slice(0, 4) - 1 : null; if (!y) continue;
    const cash = (num(r.CashEarningsDistribution) || 0) + (num(r.CashStatutorySurplus) || 0), stock = (num(r.StockEarningsDistribution) || 0) + (num(r.StockStatutorySurplus) || 0);
    const x = by.get(y) || { y, cash: 0, stock: 0, ex: null, pay: null, n: 0 };
    x.cash += cash; x.stock += stock; if (cash || stock) x.n++;
    const ex = String(r.CashExDividendTradingDate || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(ex) && (!x.ex || ex > x.ex)) x.ex = ex;
    const pay = String(r.CashDividendPaymentDate || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(pay) && (!x.pay || pay > x.pay)) x.pay = pay;
    by.set(y, x);
  }
  return [...by.values()].filter(x => x.cash || x.stock).sort((a, b) => a.y - b.y).map(x => ({ ...x, cash: +x.cash.toFixed(4), stock: +x.stock.toFixed(4) }));
}
// 股權分散：持股分級（股數）→ 400 張以上、1000 張以上的持股比例
const lowerOf = lv => { const m = String(lv).replace(/,/g, "").match(/(\d+)/); return m ? +m[1] : null; };
export function parseHolders(rows) {
  const by = new Map();
  for (const r of rows) {
    const lv = String(r.HoldingSharesLevel || ""), p = num(r.percent); if (!r.date || p == null || /total|合計|差異/i.test(lv)) continue;
    const lo = /more than/i.test(lv) ? lowerOf(lv) + 1 : lowerOf(lv); if (lo == null) continue;
    const x = by.get(r.date) || { d: r.date, b400: 0, b1000: 0, people1000: 0 };
    if (lo >= 400001) x.b400 += p; if (lo >= 1000001) { x.b1000 += p; x.people1000 += num(r.people) || 0; }
    by.set(r.date, x);
  }
  return [...by.values()].sort((a, b) => a.d.localeCompare(b.d)).map(x => ({ ...x, b400: +x.b400.toFixed(2), b1000: +x.b1000.toFixed(2) }));
}
// 公司基本資料（證交所 t187ap03_L 是中文欄位；櫃買中心是英文欄位）
const pickKey = (r, ...res) => { for (const re of res) { const k = Object.keys(r).find(k => re.test(k)); if (k && String(r[k]).trim()) return String(r[k]).trim(); } return null; };
const rocDate = s => { const m = String(s || "").match(/^(\d{2,4})(\d{2})(\d{2})$/) || String(s || "").match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/); if (!m) return s || null; const y = +m[1] < 1911 ? +m[1] + 1911 : +m[1]; return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`; };
export function parseProfile(r) {
  if (!r) return null;
  return { name: pickKey(r, /^公司名稱$/, /CompanyName$/i), short: pickKey(r, /^公司簡稱$/, /CompanyAbbreviation|Abbreviation/i), chairman: pickKey(r, /^董事長$/, /Chairman/i), ceo: pickKey(r, /^總經理$/, /GeneralManager|President/i),
    founded: rocDate(pickKey(r, /^成立日期$/, /DateOfIncorporation|Establish/i)), listed: rocDate(pickKey(r, /^上市日期$/, /^上櫃日期$/, /DateOfListing|ListingDate/i)), capital: num(pickKey(r, /^實收資本額/, /PaidIn.?Capital|Capital/i)),
    shares: num(pickKey(r, /已發行普通股數/, /IssueShares|IssuedShares/i)), web: pickKey(r, /^網址$/, /Web/i), address: pickKey(r, /^住址$/, /Address/i), spokesman: pickKey(r, /^發言人$/, /Spokesman/i) };
}
async function profileOf(code) {
  for (const url of ["https://openapi.twse.com.tw/v1/opendata/t187ap03_L", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"]) {
    try { const rows = await getJSON(url); const r = (Array.isArray(rows) ? rows : []).find(x => String(x["公司代號"] ?? x.SecuritiesCompanyCode ?? x.CompanyCode ?? "").trim() === code); if (r) return parseProfile(r); } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  const code = String(req.query?.code || "").trim().toUpperCase();
  if (!/^\d{4,6}[A-Z]?$/.test(code)) return res.status(400).json({ ok: false, error: "公司資訊目前只支援台股（4～6 碼代號）。" });
  const out = { ok: true, code, source: "FinMind（整理自公開資訊觀測站）、證交所／櫃買中心", income: [], balance: [], cash: [], dividend: [], holders: [], profile: null, errors: [] };
  const jobs = [
    ["income", () => finmind("TaiwanStockFinancialStatements", code, daysAgo(365 * 5 + 120)).then(parseIncome)],
    ["balance", () => finmind("TaiwanStockBalanceSheet", code, daysAgo(365 * 5 + 120)).then(parseBalance)],
    ["cash", () => finmind("TaiwanStockCashFlowsStatement", code, daysAgo(365 * 5 + 120)).then(parseCash)],
    ["dividend", () => finmind("TaiwanStockDividend", code, daysAgo(365 * 8)).then(parseDividend)],
    ["holders", () => finmind("TaiwanStockHoldingSharesPer", code, daysAgo(200)).then(parseHolders)],
  ];
  const prof = profileOf(code);
  for (const [k, run] of jobs) { try { out[k] = await run(); } catch (e) { out.errors.push(`${k}: ${e.message}`); } await sleep(100); }
  out.profile = await prof;
  if (!out.income.length && !out.balance.length && !out.dividend.length && !out.profile) return res.status(200).json({ ok: false, error: `找不到 ${code} 的公司資料（${out.errors[0] || "沒有資料"}）。可能是資料來源暫時忙碌或已達每小時次數上限，可在 Vercel 設定 FINMIND_TOKEN 提高上限。` });
  res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
  return res.status(200).json(out);
}
