// 選股：給 learner/watch.html 的「選股」分頁使用。都是最近一個交易日收盤後的資料，只供參考。
// GET /api/screen → { ok, date, ratio: { up, down, flat }, lists: [{ id, title, desc, rows: [{ code, name, price, chgPct, note }] }] }
//   short   短多：漲幅 ≥ 4%、成交值 ≥ 3 億，依漲幅排序
//   chips   籌碼多：外資＋投信合計買超且收紅，依買超張數排序（證交所 T86，上市）
//   trust3  投信連買：最近 3 個交易日投信都買超
//   month   站上月線：收盤高於月均價 3% 以上且今天收紅（證交所 STOCK_DAY_AVG_ALL，上市）
//   yield   高殖利率：殖利率 ≥ 5%、本益比 > 0、成交量 ≥ 500 張（證交所 BWIBBU_ALL）
//   lowpe   低本益比：本益比 0～12、成交量 ≥ 500 張

import { parseTwseAll, parseTpexAll, parseT86 } from "./hot.js";
import { getJSON, num } from "./_tw.js";

const pick = (r, ...ks) => { for (const k of ks) if (r[k] != null && r[k] !== "") return r[k]; return null; };
const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
async function t86Days(n) {
  const d = new Date(Date.now() + 8 * 3600e3), out = [];
  for (let k = 0; k < 12 && out.length < n; k++) {
    try { const rows = parseT86(await getJSON(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd(d)}&selectType=ALLBUT0999&response=json`)); if (rows && rows.length) out.push(rows); } catch {}
    d.setDate(d.getDate() - 1);
  }
  return out; // 新到舊
}
const row = (q, note) => ({ code: q.code, name: q.name, price: q.price, chgPct: q.chgPct, note });
export function buildLists({ quotes, t86 = [], avg = [], bw = [] }) {
  const Q = new Map(quotes.map(q => [q.code, q])), liquid = q => (q?.vol || 0) >= 500, stock = c => /^\d{4}$/.test(c);
  const lists = [];
  lists.push({ id: "short", title: "短多", desc: "漲幅 ≥ 4%、成交值 ≥ 3 億", rows: quotes.filter(q => stock(q.code) && q.chgPct >= 4 && (q.value || 0) >= 3).sort((a, b) => b.chgPct - a.chgPct).slice(0, 30).map(q => row(q, `成交值 ${q.value.toFixed(1)} 億`)) });
  if (t86[0]) lists.push({ id: "chips", title: "籌碼多", desc: "外資＋投信買超、收紅（上市）", rows: t86[0].filter(r => r.foreign + r.trust > 0 && Q.get(r.code)?.chgPct > 0).sort((a, b) => (b.foreign + b.trust) - (a.foreign + a.trust)).slice(0, 30).map(r => row(Q.get(r.code), `外資 ${r.foreign.toLocaleString()}・投信 ${r.trust.toLocaleString()} 張`)) });
  if (t86.length >= 3) {
    const days = t86.slice(0, 3).map(rows => new Map(rows.map(r => [r.code, r.trust])));
    const codes = [...days[0].keys()].filter(c => days.every(m => (m.get(c) || 0) > 0) && Q.get(c));
    lists.push({ id: "trust3", title: "投信連買", desc: "最近 3 個交易日投信都買超（上市）", rows: codes.map(c => ({ c, s: days.reduce((s, m) => s + m.get(c), 0) })).sort((a, b) => b.s - a.s).slice(0, 30).map(({ c, s }) => row(Q.get(c), `3 日買超 ${s.toLocaleString()} 張`)) });
  }
  if (avg.length) lists.push({ id: "month", title: "站上月線", desc: "收盤高於月均價 3% 以上、今天收紅（上市）", rows: avg.map(a => ({ a, q: Q.get(a.code) })).filter(({ a, q }) => q && liquid(q) && q.chgPct > 0 && a.avg && a.close / a.avg >= 1.03).sort((x, y) => y.a.close / y.a.avg - x.a.close / x.a.avg).slice(0, 30).map(({ a, q }) => row(q, `高於月均價 ${((a.close / a.avg - 1) * 100).toFixed(1)}%`)) });
  if (bw.length) {
    lists.push({ id: "yield", title: "高殖利率", desc: "殖利率 ≥ 5%、成交量 ≥ 500 張（上市）", rows: bw.filter(b => b.dy >= 5 && b.pe > 0 && liquid(Q.get(b.code))).sort((a, b) => b.dy - a.dy).slice(0, 30).map(b => row(Q.get(b.code), `殖利率 ${b.dy}%・本益比 ${b.pe}`)) });
    lists.push({ id: "lowpe", title: "低本益比", desc: "本益比 0～12、成交量 ≥ 500 張（上市）", rows: bw.filter(b => b.pe > 0 && b.pe <= 12 && liquid(Q.get(b.code))).sort((a, b) => a.pe - b.pe).slice(0, 30).map(b => row(Q.get(b.code), `本益比 ${b.pe}・殖利率 ${b.dy ?? "—"}%`)) });
  }
  return lists;
}
export const parseAvg = rows => (Array.isArray(rows) ? rows : []).map(r => ({ code: String(pick(r, "Code") || "").trim(), close: num(pick(r, "ClosingPrice")), avg: num(pick(r, "MonthlyAveragePrice")) })).filter(x => x.code && x.close && x.avg);
export const parseBw = rows => (Array.isArray(rows) ? rows : []).map(r => ({ code: String(pick(r, "Code") || "").trim(), pe: num(pick(r, "PEratio", "PeRatio")), dy: num(pick(r, "DividendYield")), pb: num(pick(r, "PBratio", "PbRatio")) })).filter(x => x.code);

export default async function handler(req, res) {
  const [a, b, t, avg, bw] = await Promise.allSettled([
    getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll),
    getJSON("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll),
    t86Days(3),
    getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL").then(parseAvg),
    getJSON("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL").then(parseBw),
  ]);
  const quotes = [...(a.value || []), ...(b.value || [])];
  if (!quotes.length) return res.status(200).json({ ok: false, error: `拿不到選股資料（${[a.reason?.message, b.reason?.message].filter(Boolean).join("；") || "沒有資料"}）` });
  const st = quotes.filter(q => /^\d{4}$/.test(q.code));
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
  return res.status(200).json({ ok: true, date: quotes.find(q => q.date)?.date || null, source: "證交所、櫃買中心 OpenAPI",
    ratio: { up: st.filter(q => q.chgPct > 0).length, down: st.filter(q => q.chgPct < 0).length, flat: st.filter(q => q.chgPct === 0).length },
    lists: buildLists({ quotes, t86: t.value || [], avg: avg.value || [], bw: bw.value || [] }).filter(l => l.rows.length) });
}
