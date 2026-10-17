// ETF 基本資料與成分股：給 learner/watch.html 個股頁的「ETF」分頁使用。
// GET /api/etf?code=0050 → { ok, code, info: { 名稱、發行公司、規模…, kv: [[欄位, 值]] }, hold: { date, rows: [{ name, code, pct, sh }] },
//                            month: { date, rows: [{ name, code, sh, pct, chg }] }, ind: { date, rows: [{ name, pct }] } }
// 來源：MoneyDJ 理財網 ETF 頁面（基本資料 Basic0004、全部持股 Basic0007b、月持股明細與產業分布 Basic0007a），台股與美股 ETF 都有。
// 成分股變動（納入、剔除）需要前後兩次的持股，由排程 scripts/etf-holdings.mjs 每天存一份比對（learner/data/etf-hold/<代號>.json）。

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "text/html" };
const BASE = "https://www.moneydj.com/ETF/X/Basic/";
const cache = new Map();
const txt = s => String(s || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const num = s => { const v = parseFloat(String(s).replace(/[,%+\s]/g, "")); return Number.isFinite(v) ? v : null; };
const ymd = s => { const m = String(s || "").match(/(\d{4})\/(\d{2})\/(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
// 「台積電(2330.TW)」「NVIDIA Corp(NVDA.US)」→ 名稱、代號（台股去掉 .TW／.TWO）
export function splitName(s) {
  const t = txt(s), m = t.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!m) return { name: t, code: null };
  const raw = m[2].trim(), code = raw.replace(/\.(TW|TWO|US)$/i, "").toUpperCase();
  return { name: m[1].trim(), code: /^[0-9A-Z.\-]{1,10}$/.test(code) ? code : null };
}
// 基本資料：表格裡 <th>欄位</th><td>值</td> 一對一對
export function parseInfo(html) {
  const kv = [];
  for (const m of String(html).matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) { const k = txt(m[1]), v = txt(m[2]); if (k && k.length <= 12 && v && !kv.some(x => x[0] === k)) kv.push([k, v]); }
  const g = k => kv.find(x => x[0] === k)?.[1] || null;
  const aum = g("ETF規模"), am = aum && aum.match(/([\d,.]+)\s*\(百萬([^)]*)\)/);
  return { name: g("ETF名稱"), issuer: g("發行公司"), index: g("追蹤指數") || g("基準指數"), since: ymd(g("成立日期")), listed: ymd(g("上市日期")), n: num(g("成分股數")),
    aum: am ? num(am[1]) * 1e6 : null, cur: am ? am[2] || null : null, fee: num(g("經理費(%)")), ter: num(g("總管理費用(%)")), freq: g("配息頻率"), yield: num(g("殖利率(%)")),
    prem: num(g("折溢價(%)")), sd: num(g("年化標準差(%)")), kind: g("投資標的"), region: g("投資區域"), lev: g("槓桿多空註記") || null, mgr: g("經理人"), strategy: g("投資策略"), kv: kv.filter(([k]) => !/文件下載|官方網站|查看/.test(k)) };
}
// 全部持股：「個股名稱｜投資比例(%)｜持有股數 / 口數」
export function parseAll(html) {
  const h = String(html), i = h.indexOf("全部持股"), seg = i >= 0 ? h.slice(i) : h, date = ymd((seg.match(/資料日期：\s*(\d{4}\/\d{2}\/\d{2})/) || [])[1]);
  const rows = [];
  for (const m of seg.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>\s*([-\d.,]+)\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>/gi)) { const n = splitName(m[1]); if (n.name) rows.push({ ...n, pct: num(m[2]), sh: num(m[3]) }); }
  return { date, rows };
}
// 月持股明細（投信每月公告）：「股票名稱｜持股(千股)｜比例｜增減」；產業分布：「產業｜投資金額｜比例(%)」
export function parseMonth(html) {
  const h = String(html), i = h.indexOf("持股明細"), seg = i >= 0 ? h.slice(i) : "", date = ymd((seg.match(/資料日期：\s*(\d{4}\/\d{2}\/\d{2})/) || [])[1]), rows = [];
  for (const m of seg.matchAll(/<tr[^>]*>\s*<td[^>]*>([^<]{1,40})<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) rows.push({ name: txt(m[1]).replace(/\*$/, ""), sh: num(m[2]) != null ? num(m[2]) * 1000 : null, pct: num(m[3]), chg: num(txt(m[4])) });
  const j = h.indexOf("持股依產業表格"), iseg = j >= 0 ? h.slice(j, h.indexOf("持股依產業表格 End", j) > 0 ? h.indexOf("持股依產業表格 End", j) : j + 20000) : "", idate = ymd((h.slice(Math.max(0, j - 400), j + 400).match(/資料日期：\s*(\d{4}\/\d{2}\/\d{2})/) || [])[1]), ind = [];
  for (const m of iseg.matchAll(/<tr[^>]*>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>([^<]{1,30})<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)\s*<\/td>/gi)) ind.push({ name: txt(m[1]), pct: num(m[3]) });
  return { month: { date, rows }, ind: { date: idate || date, rows: ind } };
}
async function page(p, id, ms) { const r = await fetch(`${BASE}${p}.xdjhtm?etfid=${encodeURIComponent(id)}`, { headers: UA, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
export async function etfData(code, ms = 15000) {
  const c = String(code || "").trim().toUpperCase(), tw = /^\d{4,6}[A-Z]?$/.test(c);
  for (const id of tw ? [c + ".TW", c + ".TWO"] : [c]) {
    const [b, a, m] = await Promise.allSettled([page("Basic0004", id, ms), page("Basic0007b", id, ms), page("Basic0007a", id, ms)]);
    const info = b.status === "fulfilled" ? parseInfo(b.value) : null, hold = a.status === "fulfilled" ? parseAll(a.value) : { rows: [] }, mo = m.status === "fulfilled" ? parseMonth(m.value) : { month: { rows: [] }, ind: { rows: [] } };
    if (!info?.name && !hold.rows.length) continue;
    const byName = new Map(hold.rows.map(r => [r.name, r.code])); mo.month.rows.forEach(r => { r.code = byName.get(r.name) || null; });
    return { ok: true, code: c, src: id, info, hold, month: mo.month, ind: mo.ind, source: "MoneyDJ 理財網", link: `${BASE}Basic0004.xdjhtm?etfid=${id}` };
  }
  return { ok: false, code: c, error: "MoneyDJ 查不到這檔 ETF 的資料" };
}
export default async function handler(req, res) {
  const code = String(req.query?.code || "").trim().toUpperCase();
  if (!/^[0-9A-Z.\-]{1,10}$/.test(code)) return res.status(400).json({ ok: false, error: "請給 ETF 代號，例如 ?code=0050" });
  const hit = cache.get(code); if (hit && Date.now() - hit.at < 3 * 3600e3) return res.status(200).json(hit.body);
  try {
    const body = await etfData(code);
    if (body.ok) { cache.set(code, { at: Date.now(), body }); res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400"); }
    return res.status(200).json(body);
  } catch (e) { return res.status(200).json({ ok: false, code, error: `拿不到 ETF 資料（${e.message}）` }); }
}
