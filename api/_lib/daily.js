// 單日全市場資料：給 learner/watch.html「資金」分頁算板塊資金流向使用。
// GET /api/daily?date=20261005 → { ok, date, rows: [[代號, 名稱, 收盤, 漲跌幅%, 外資張, 投信張, 自營商張, 成交張], ...], tpex }
//   上市：證交所 T86（三大法人）＋ MI_INDEX（每日收盤行情）
//   上櫃：櫃買中心三大法人與收盤行情（抓不到就只有上市，tpex: false）
// GET /api/daily?meta=1 → { ok, ind: { 代號: 產業別 } }
// 假日或還沒收盤沒有資料時回 { ok: true, empty: true }。過去的日期不會再變，CDN 快取 30 天，所以同一天只會向證交所問一次。

import { getJSON, num, companies } from "./_tw.js";

const keyIdx = (fields, ...res) => fields.findIndex(f => res.every(re => re.test(String(f).replace(/\s|<[^>]+>/g, ""))));
const lots = v => { const n = num(v); return n == null ? 0 : Math.round(n / 1000); };
const isCode = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c);
// rwd 的回應有兩種：{ fields, data } 或 { tables: [{ fields, data }] }；挑出含有指定欄位的那一張表
export function pickTable(j, ...res) {
  const ts = Array.isArray(j?.tables) ? j.tables : j?.fields ? [j] : [];
  return ts.find(t => Array.isArray(t?.fields) && Array.isArray(t?.data) && res.every(re => keyIdx(t.fields, re) >= 0)) || null;
}
// 三大法人：外資（不含自營商）、投信、自營商（合計）
export function parseInst(j) {
  const t = pickTable(j, /證券代號|代號/, /投信/); if (!t) return new Map();
  const f = t.fields, iC = keyIdx(f, /證券代號|^代號$/), iF = keyIdx(f, /外陸資買賣超股數/, /不含/) >= 0 ? keyIdx(f, /外陸資買賣超股數/, /不含/) : keyIdx(f, /外資.*買賣超/),
    iT = keyIdx(f, /投信.*買賣超/), iD = keyIdx(f, /^自營商買賣超股數$/) >= 0 ? keyIdx(f, /^自營商買賣超股數$/) : keyIdx(f, /自營商.*買賣超/);
  const out = new Map();
  for (const r of t.data) { const c = String(r[iC] ?? "").trim(); if (isCode(c)) out.set(c, [lots(r[iF]), lots(r[iT]), lots(r[iD])]); }
  return out;
}
// 收盤行情：代號、名稱、收盤、漲跌（正負號在獨立欄位或寫在數字前面）、成交股數
export function parseQuotes(j) {
  const t = pickTable(j, /證券代號|代號/, /收盤/); if (!t) return new Map();
  const f = t.fields, iC = keyIdx(f, /證券代號|^代號$/), iN = keyIdx(f, /證券名稱|^名稱$/), iP = keyIdx(f, /收盤/), iS = keyIdx(f, /漲跌\(\+\/-\)/), iD = keyIdx(f, /漲跌價差|^漲跌$/), iV = keyIdx(f, /成交股數/);
  const out = new Map();
  for (const r of t.data) {
    const c = String(r[iC] ?? "").trim(), p = num(r[iP]); if (!isCode(c) || !(p > 0)) continue;
    const raw = String(r[iD] ?? ""), sgn = iS >= 0 ? (/-/.test(String(r[iS])) ? -1 : 1) : /^\s*-/.test(raw) ? -1 : 1, d = Math.abs(num(raw.replace(/^[+-]/, "")) || 0) * sgn, prev = p - d;
    out.set(c, { name: String(r[iN] ?? "").trim(), p, pct: prev > 0 ? +((d / prev) * 100).toFixed(2) : 0, v: lots(r[iV]) });
  }
  return out;
}
export function mergeDay(quotes, inst) {
  const rows = [];
  for (const [c, q] of quotes) { const i = inst.get(c) || [0, 0, 0]; rows.push([c, q.name, q.p, q.pct, i[0], i[1], i[2], q.v]); }
  return rows;
}
const roc = d => `${+d.slice(0, 4) - 1911}/${d.slice(4, 6)}/${d.slice(6)}`, slash = d => `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6)}`;
const tries = async urls => { for (const u of urls) { try { const j = await getJSON(u, 12000); if (pickTable(j, /代號/)) return j; } catch {} } return null; };
// 舊版櫃買 JSON 是 { aaData: [[...]] } 沒有欄位名稱：代號、名稱、收盤、漲跌、開、高、低、均價、成交股數
const fixTpex = j => (j && !j.fields && !j.tables && Array.isArray(j.aaData) ? { fields: ["代號", "名稱", "收盤", "漲跌", "開盤", "最高", "最低", "均價", "成交股數"], data: j.aaData } : j);
const tpexQuoteUrls = d => [`https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=${slash(d)}&type=EW&response=json`, `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${roc(d)}&se=EW&o=json`];
// 當天收盤行情（上市 MI_INDEX＋上櫃）：給 _live.js 收盤後用，回 Map(code → { name, p, pct, v, market })
export async function closeToday(d) {
  const [t, o] = await Promise.allSettled([getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${d}&type=ALLBUT0999&response=json`, 15000), tries(tpexQuoteUrls(d))]);
  const out = new Map();
  for (const [c, q] of t.status === "fulfilled" ? parseQuotes(t.value) : []) out.set(c, { ...q, market: "上市" });
  for (const [c, q] of o.status === "fulfilled" && o.value ? parseQuotes(fixTpex(o.value)) : []) if (!out.has(c)) out.set(c, { ...q, market: "上櫃" });
  return out;
}
async function tpexDay(d) {
  const [qj, ij] = await Promise.all([
    tries(tpexQuoteUrls(d)),
    tries([`https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=${slash(d)}&response=json`, `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&t=D&se=EW&d=${roc(d)}&o=json`]),
  ]);
  return qj ? mergeDay(parseQuotes(fixTpex(qj)), parseInst(ij)) : [];
}

export default async function handler(req, res) {
  // ?meta=1：每檔的產業別（證交所／櫃買中心公司基本資料），讓前端把個股歸到產業板塊
  if (req.query?.meta) {
    try { const m = await companies(), ind = {}; for (const [c, x] of m) if (x.ind) ind[c] = x.ind;
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); return res.status(200).json({ ok: true, ind }); }
    catch (e) { return res.status(200).json({ ok: false, error: `拿不到產業別（${e.message}）` }); }
  }
  const d = String(req.query?.date || "").replace(/\D/g, "");
  if (!/^20\d{6}$/.test(d)) return res.status(400).json({ ok: false, error: "date 要是 YYYYMMDD" });
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  if (d > today) return res.status(400).json({ ok: false, error: "不能查未來的日期" });
  const [q, i, o] = await Promise.allSettled([
    getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${d}&type=ALLBUT0999&response=json`, 15000),
    getJSON(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${d}&selectType=ALLBUT0999&response=json`, 15000),
    tpexDay(d),
  ]);
  const quotes = q.status === "fulfilled" ? parseQuotes(q.value) : new Map(), inst = i.status === "fulfilled" ? parseInst(i.value) : new Map();
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, past = d < today;
  if (!quotes.size || !inst.size) {
    // 證交所連不上時不要被當成假日快取起來
    if (q.status === "rejected" || i.status === "rejected") return res.status(200).json({ ok: false, error: `證交所資料暫時拿不到（${(q.reason || i.reason)?.message}）` });
    res.setHeader("Cache-Control", past ? "s-maxage=2592000" : "s-maxage=600");
    return res.status(200).json({ ok: true, date: iso, empty: true });
  }
  const tp = o.status === "fulfilled" ? o.value : [];
  res.setHeader("Cache-Control", past ? "s-maxage=2592000, stale-while-revalidate=86400" : "s-maxage=600, stale-while-revalidate=1200");
  return res.status(200).json({ ok: true, date: iso, rows: [...mergeDay(quotes, inst), ...tp], tpex: tp.length > 0, source: tp.length ? "證交所、櫃買中心" : "證交所（上櫃暫時拿不到）" });
}
