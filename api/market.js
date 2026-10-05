// 大盤總覽：給 learner/watch.html 的「大盤」分頁使用。
// GET /api/market
// 台股部分是「最近一個交易日」收盤後的統計（證交所、櫃買中心 OpenAPI），盤中的加權、櫃買即時指數由看盤頁另外用 /api/quote 更新：
//   breadth  個股漲跌分佈（上市櫃普通股與 ETF；漲停跌停以 ±9.5% 估）
//   sectors  產業漲跌（以前一日市值加權的平均漲跌幅）與成交金額比重
//   contrib  加權指數貢獻點數排行（用發行股數與漲跌估算，只算上市普通股）
//   inst     三大法人買賣超金額（證交所 BFI82U，上市）
//   indices  電子、金融等類股指數（證交所 MI_INDEX）
//   us       美股四大指數（道瓊、那斯達克、S&P 500、費城半導體）與當日走勢（Yahoo Finance）

import { parseTwseAll, parseTpexAll } from "./hot.js";
import { getJSON, num, companies } from "./_tw.js";
import { yahooBars, quoteFromMeta } from "./_yahoo.js";

const BUCKETS = [[">5%", 5, Infinity], ["3~5%", 3, 5], ["2~3%", 2, 3], ["1~2%", 1, 2], ["0~1%", 0, 1], ["0%", 0, 0], ["0~-1%", -1, 0], ["-1~-2%", -2, -1], ["-2~-3%", -3, -2], ["-3~-5%", -5, -3], ["<-5%", -Infinity, -5]];
export function breadth(rows) {
  const counts = BUCKETS.map(([label]) => ({ label, n: 0 }));
  let up = 0, down = 0, flat = 0, limUp = 0, limDn = 0;
  for (const r of rows) {
    const p = r.chgPct; if (p == null) continue;
    if (p > 0) up++; else if (p < 0) down++; else flat++;
    if (p >= 9.5) limUp++; if (p <= -9.5) limDn++;
    const k = p === 0 ? 5 : p > 0 ? BUCKETS.findIndex(([, lo, hi], i) => i < 5 && p > lo && p <= hi) : BUCKETS.findIndex(([, lo, hi], i) => i > 5 && p >= lo && p < hi);
    if (k >= 0) counts[k].n++;
  }
  return { up, down, flat, limUp, limDn, buckets: counts };
}
export function sectors(rows, info) {
  const by = new Map(); let total = 0;
  for (const r of rows) {
    const c = info.get(r.code); if (!c?.ind || r.price == null || r.chg == null) continue;
    const prev = r.price - r.chg, cap = (c.shares || 0) * prev;
    let s = by.get(c.ind); if (!s) by.set(c.ind, (s = { name: c.ind, cap: 0, chgCap: 0, value: 0, n: 0 }));
    s.cap += cap; s.chgCap += (c.shares || 0) * r.chg; s.value += r.value || 0; s.n++; total += r.value || 0;
  }
  return [...by.values()].filter(s => s.n >= 3).map(s => ({ name: s.name, n: s.n, pct: s.cap ? +((s.chgCap / s.cap) * 100).toFixed(2) : null, value: +s.value.toFixed(1), share: total ? +((s.value / total) * 100).toFixed(2) : null }))
    .sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
}
export function contributions(twse, info, taiexPrev) {
  const L = twse.filter(r => /^\d{4}$/.test(r.code) && info.get(r.code)?.shares && r.price != null && r.chg != null).map(r => ({ ...r, sh: info.get(r.code).shares }));
  const S = L.reduce((s, r) => s + (r.price - r.chg) * r.sh, 0); if (!S || !taiexPrev) return null;
  const out = L.map(r => ({ code: r.code, name: r.name, chgPct: r.chgPct, pts: +((r.chg * r.sh) / S * taiexPrev).toFixed(2) })).sort((a, b) => b.pts - a.pts);
  return { pos: out.filter(x => x.pts > 0).slice(0, 10), neg: out.filter(x => x.pts < 0).slice(-10).reverse() };
}
export function parseMiIndex(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => {
    const sign = String(r["漲跌"] ?? "").includes("-") ? -1 : 1, pts = num(r["漲跌點數"]), close = num(r["收盤指數"]);
    return { name: String(r["指數"] ?? "").trim(), close, chg: pts != null ? sign * Math.abs(pts) : null, chgPct: num(r["漲跌百分比"]) != null ? sign * Math.abs(num(r["漲跌百分比"])) : null };
  }).filter(x => x.name && x.close != null);
}
// BFI82U：單位名稱、買進金額、賣出金額、買賣差額（元）→ 億元
export function parseBfi82u(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const pick = re => j.data.filter(r => re.test(String(r[0]))).reduce((s, r) => s + (num(r[3]) || 0), 0) / 1e8;
  return { foreign: +pick(/外資/).toFixed(2), trust: +pick(/投信/).toFixed(2), dealer: +pick(/^自營商/).toFixed(2), total: +(j.data.filter(r => /合計/.test(String(r[0]))).reduce((s, r) => s + (num(r[3]) || 0), 0) / 1e8).toFixed(2) };
}
const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
async function instLatest() {
  const d = new Date(Date.now() + 8 * 3600e3);
  for (let k = 0; k < 7; k++) {
    try { const r = parseBfi82u(await getJSON(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=${ymd(d)}&response=json`)); if (r) return { date: `${ymd(d).slice(0, 4)}-${ymd(d).slice(4, 6)}-${ymd(d).slice(6)}`, ...r }; } catch {}
    d.setDate(d.getDate() - 1);
  }
  return null;
}
const US_IDX = [["^DJI", "道瓊工業"], ["^IXIC", "那斯達克"], ["^GSPC", "S&P 500"], ["^SOX", "費城半導體"]];
async function usIndices() {
  const r = await Promise.allSettled(US_IDX.map(async ([s, name]) => { const p = await yahooBars(s, 5, { isIdx: true }); const q = quoteFromMeta(s, p.meta); return { code: s, name, price: q.price, chg: q.chg, chgPct: q.chgPct, date: q.date, prev: q.prev, spark: p.bars.map(b => b.c) }; }));
  return r.filter(x => x.status === "fulfilled").map(x => x.value);
}

export default async function handler(req, res) {
  const [a, b, info, mi, inst, us] = await Promise.allSettled([
    getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll),
    getJSON("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll),
    companies(), getJSON("https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX").then(parseMiIndex), instLatest(), usIndices(),
  ]);
  const twse = a.value || [], tpex = b.value || [], all = [...twse, ...tpex], I = info.value || new Map(), M = mi.value || [];
  if (!all.length && !(us.value || []).length) return res.status(200).json({ ok: false, error: `拿不到大盤資料（${[a.reason?.message, b.reason?.message].filter(Boolean).join("；") || "沒有資料"}）` });
  const taiex = M.find(x => /^發行量加權股價指數$/.test(x.name));
  const pickIdx = ["電子類指數", "半導體類指數", "金融保險類指數", "航運類指數", "臺灣50指數", "櫃買指數"].map(n => M.find(x => x.name === n)).filter(Boolean);
  const stocks = all.filter(r => /^\d{4}$/.test(r.code));
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1800");
  return res.status(200).json({ ok: true, date: all.find(x => x.date)?.date || null, source: "證交所、櫃買中心 OpenAPI；美股 Yahoo Finance",
    breadth: stocks.length ? breadth(stocks) : null,
    sectors: I.size ? sectors(stocks, I) : null,
    contrib: I.size && taiex ? contributions(twse, I, taiex.close - (taiex.chg || 0)) : null,
    inst: inst.value || null, indices: pickIdx, us: us.value || [] });
}
