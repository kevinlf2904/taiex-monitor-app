// 籌碼面與基本面：給 learner/ 個股判讀的「籌碼」「基本面」分頁使用。
// GET /api/stockinfo?code=2330
// 主要來源是 FinMind 開放資料（整理自證交所、櫃買中心、公開資訊觀測站）。
// 不設定也能用（匿名有每小時次數上限）；在 Vercel 設定 FINMIND_TOKEN（finmindtrade.com 免費註冊）可提高上限。
// 本益比、殖利率在 FinMind 失敗時，改抓證交所 BWIBBU（上市股）。
// 回傳的張數一律以「張」（1000 股）為單位。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
export const toNum = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/[,\s+%]/g, "")); return Number.isFinite(n) ? n : null; };

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(9000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.msg || `HTTP ${r.status}`);
  return j;
}
async function finmind(dataset, code, start) {
  const token = process.env.FINMIND_TOKEN;
  const j = await getJSON(`https://api.finmindtrade.com/api/v4/data?dataset=${dataset}&data_id=${encodeURIComponent(code)}&start_date=${start}`, token ? { Authorization: `Bearer ${token}` } : {});
  if (!j || (j.status && j.status !== 200) || !Array.isArray(j.data)) throw new Error(j?.msg || "FinMind 沒有回傳資料");
  return j.data;
}

// 三大法人：外資（含外資自營商）、投信、自營商（自行買賣＋避險），買賣超單位：股 → 張
export function parseInst(rows) {
  const by = new Map();
  for (const r of rows) {
    const d = r.date, name = String(r.name || ""), net = ((toNum(r.buy) || 0) - (toNum(r.sell) || 0)) / 1000;
    if (!by.has(d)) by.set(d, { d, foreign: 0, trust: 0, dealer: 0 });
    const x = by.get(d);
    if (/^Foreign/i.test(name)) x.foreign += net;
    else if (/Investment_Trust/i.test(name)) x.trust += net;
    else if (/^Dealer/i.test(name)) x.dealer += net;
  }
  return [...by.values()].sort((a, b) => a.d.localeCompare(b.d)).map((x) => ({ d: x.d, foreign: Math.round(x.foreign), trust: Math.round(x.trust), dealer: Math.round(x.dealer) }));
}
// 融資融券餘額（張）
export function parseMargin(rows) {
  return rows.map((r) => ({ d: r.date, marginBal: toNum(r.MarginPurchaseTodayBalance), shortBal: toNum(r.ShortSaleTodayBalance), marginLimit: toNum(r.MarginPurchaseLimit) }))
    .filter((r) => r.d && r.marginBal != null).sort((a, b) => a.d.localeCompare(b.d));
}
export function parsePer(rows) {
  return rows.map((r) => ({ d: r.date, pe: toNum(r.PER), pb: toNum(r.PBR), dy: toNum(r.dividend_yield) })).filter((r) => r.d).sort((a, b) => a.d.localeCompare(b.d));
}
// 證交所 BWIBBU：fields 含 日期、殖利率(%)、本益比、股價淨值比
export function parseBwibbu(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return [];
  const f = (j.fields || []).map((x) => String(x).replace(/\s/g, "")), at = (k) => f.findIndex((x) => x.includes(k));
  const iD = at("日期"), iY = at("殖利率"), iP = at("本益比"), iB = at("淨值比");
  return j.data.map((r) => {
    const m = String(r[iD]).match(/(\d{2,4})[年/-](\d{1,2})[月/-](\d{1,2})/); if (!m) return null;
    const y = +m[1] < 1911 ? +m[1] + 1911 : +m[1];
    return { d: `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, pe: toNum(r[iP]), pb: toNum(r[iB]), dy: toNum(r[iY]) };
  }).filter(Boolean);
}
// 月營收：FinMind 的 date 是公布月份，revenue_year / revenue_month 才是營收所屬月份
export function parseRevenue(rows) {
  const list = rows.map((r) => ({ ym: `${r.revenue_year}-${String(r.revenue_month).padStart(2, "0")}`, rev: toNum(r.revenue) })).filter((r) => r.rev != null && !/undefined/.test(r.ym));
  const map = new Map(list.map((r) => [r.ym, r.rev]));
  const shift = (ym, k) => { const [y, m] = ym.split("-").map(Number), t = y * 12 + (m - 1) + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
  return [...new Map(list.map((r) => [r.ym, r])).values()].sort((a, b) => a.ym.localeCompare(b.ym)).map((r) => {
    const ly = map.get(shift(r.ym, -12)), lm = map.get(shift(r.ym, -1));
    return { ym: r.ym, rev: r.rev, yoy: ly ? +((r.rev / ly - 1) * 100).toFixed(1) : null, mom: lm ? +((r.rev / lm - 1) * 100).toFixed(1) : null };
  });
}
// 綜合損益表（單季）：EPS 與三率
export function parseFin(rows) {
  const q = new Map();
  const pick = (r, types, names) => types.includes(r.type) || names.some((n) => String(r.origin_name || "").includes(n));
  for (const r of rows) {
    const d = r.date; if (!d) continue;
    if (!q.has(d)) q.set(d, { d });
    const x = q.get(d), v = toNum(r.value);
    if (pick(r, ["EPS"], ["基本每股盈餘"])) x.eps = v;
    else if (pick(r, ["Revenue"], ["營業收入合計"])) x.rev = v;
    else if (pick(r, ["GrossProfit"], ["營業毛利（毛損）", "營業毛利"])) x.gp = v;
    else if (pick(r, ["OperatingIncome"], ["營業利益（損失）", "營業利益"])) x.op = v;
    else if (pick(r, ["IncomeAfterTaxes", "IncomeAfterTax"], ["本期淨利（淨損）"])) x.ni = v;
  }
  return [...q.values()].filter((x) => x.eps != null).sort((a, b) => a.d.localeCompare(b.d)).map((x) => {
    const [y, m] = x.d.split("-").map(Number), pct = (v) => (x.rev && v != null ? +((v / x.rev) * 100).toFixed(1) : null);
    return { q: `${y}Q${Math.ceil(m / 3)}`, eps: x.eps, gross: pct(x.gp), op: pct(x.op), net: pct(x.ni) };
  });
}

export default async function handler(req, res) {
  const code = String(req.query?.code || "").trim().toUpperCase();
  if (!/^\d{4,6}[A-Z]?$/.test(code)) return res.status(400).json({ ok: false, error: "請輸入 4 到 6 碼的股票代號；加權指數沒有個股的籌碼與財報資料。" });
  const out = { ok: true, code, source: "FinMind（整理自證交所、櫃買中心、公開資訊觀測站）", inst: [], margin: [], per: [], revenue: [], fin: [], errors: [] };
  const jobs = [
    ["inst", () => finmind("TaiwanStockInstitutionalInvestorsBuySell", code, daysAgo(120)).then(parseInst)],
    ["margin", () => finmind("TaiwanStockMarginPurchaseShortSale", code, daysAgo(120)).then(parseMargin)],
    ["per", () => finmind("TaiwanStockPER", code, daysAgo(365 * 3)).then(parsePer)],
    ["revenue", () => finmind("TaiwanStockMonthRevenue", code, daysAgo(365 * 2 + 60)).then(parseRevenue)],
    ["fin", () => finmind("TaiwanStockFinancialStatements", code, daysAgo(365 * 3)).then(parseFin)],
  ];
  for (const [k, run] of jobs) {
    try { out[k] = await run(); } catch (e) { out.errors.push(`${k}: ${e.message}`); }
    await sleep(120);
  }
  // 本益比備援：證交所 BWIBBU（最近 3 個月）
  if (!out.per.length) {
    try {
      const d = new Date(); d.setDate(1);
      for (let k = 0; k < 3; k++) {
        const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
        out.per.unshift(...parseBwibbu(await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU?date=${ymd}&stockNo=${code}&response=json`)));
        d.setMonth(d.getMonth() - 1); await sleep(250);
      }
      out.per.sort((a, b) => a.d.localeCompare(b.d));
      if (out.per.length) out.perSource = "證交所";
    } catch (e) { out.errors.push(`per(TWSE): ${e.message}`); }
  }
  const any = out.inst.length || out.margin.length || out.per.length || out.revenue.length || out.fin.length;
  if (!any) return res.status(200).json({ ok: false, error: `找不到 ${code} 的籌碼與財報資料。可能是資料來源暫時無法連線或已達每小時次數上限（可在 Vercel 設定 FINMIND_TOKEN 提高上限）。（${out.errors[0] || "沒有資料"}）` });
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json(out);
}
