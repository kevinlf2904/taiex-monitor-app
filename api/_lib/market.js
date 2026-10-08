// 大盤總覽：給 learner/watch.html 的「大盤」分頁使用。
// GET /api/market
// 台股個股統計來自 _live.js：盤中用富果行情快照（即時，回 live: true、time），沒有金鑰時用證交所、櫃買中心 OpenAPI（前一個交易日收盤）；
// 盤中的加權、櫃買即時指數由看盤頁另外用 /api/quote 更新；盤中快取 20 秒：
//   breadth  漲跌家數（上市櫃股票＋ETF，和券商的「整體市場」口徑一樣）；漲停跌停用實際的漲跌停價判斷（依升降單位）
//   sectors  產業漲跌（以前一日市值加權的平均漲跌幅）與成交金額比重
//   contrib  加權指數貢獻點數排行（用發行股數與漲跌估算，只算上市普通股）
//   inst     三大法人買賣超金額（證交所 BFI82U，上市）
//   indices  電子、金融等類股指數（證交所 MI_INDEX）
//   us       美股四大指數（道瓊、那斯達克、S&P 500、費城半導體）與當日走勢（Yahoo Finance）
//   breadthBy、sectorsBy  上市、上櫃分開的漲跌家數與產業漲跌
//   world    國際指數，依地區分組（美國、日本、韓國、香港、中國、歐洲）

import { marketRows, liveCache } from "./_live.js";
import { getJSON, num, companies } from "./_tw.js";
import { yahooBars, quoteFromMeta } from "./_yahoo.js";

const BUCKETS = [[">5%", 5, Infinity], ["3~5%", 3, 5], ["2~3%", 2, 3], ["1~2%", 1, 2], ["0~1%", 0, 1], ["0%", 0, 0], ["0~-1%", -1, 0], ["-1~-2%", -2, -1], ["-2~-3%", -3, -2], ["-3~-5%", -5, -3], ["<-5%", -Infinity, -5]];
// 升降單位（股票、ETF 不同）與漲跌停價：昨收 ×1.1（×0.9）再依升降單位往內取
export const tick = (p, etf) => (etf ? (p < 50 ? 0.01 : 0.05) : p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5);
export function limits(prev, etf) {
  const up0 = prev * 1.1, dn0 = prev * 0.9, tu = tick(up0, etf), td = tick(dn0, etf);
  return { up: +(Math.floor(up0 / tu + 1e-9) * tu).toFixed(2), dn: +(Math.ceil(dn0 / td - 1e-9) * td).toFixed(2) };
}
export function breadth(rows) {
  const counts = BUCKETS.map(([label]) => ({ label, n: 0 }));
  let up = 0, down = 0, flat = 0, limUp = 0, limDn = 0;
  for (const r of rows) {
    const p = r.chgPct; if (p == null) continue;
    if (p > 0) up++; else if (p < 0) down++; else flat++;
    const prev = r.price != null && r.chg != null ? r.price - r.chg : null;
    if (prev > 0 && !/[LRK]$/.test(r.code)) { const L = limits(prev, /^00/.test(r.code)); if (r.price >= L.up - 1e-6) limUp++; if (r.price <= L.dn + 1e-6) limDn++; } // 槓桿／反向 ETF 沒有漲跌停
    else if (prev == null) { if (p >= 9.5) limUp++; if (p <= -9.5) limDn++; }
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
// OpenAPI 的類股指數是「最近一個交易日收盤」，日期是民國年（1141007）
const rocDate = v => { const s = String(v ?? "").replace(/\D/g, ""); return s.length === 7 ? `${+s.slice(0, 3) + 1911}-${s.slice(3, 5)}-${s.slice(5)}` : s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null; };
export function parseMiIndex(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => {
    const sign = String(r["漲跌"] ?? "").includes("-") ? -1 : 1, pts = num(r["漲跌點數"]), close = num(r["收盤指數"]);
    return { name: String(r["指數"] ?? "").trim(), date: rocDate(r["日期"]), close, chg: pts != null ? sign * Math.abs(pts) : null, chgPct: num(r["漲跌百分比"]) != null ? sign * Math.abs(num(r["漲跌百分比"])) : null };
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
// 國際指數：依地區分組（Yahoo Finance，收盤或盤中延遲報價）
export const WORLD_IDX = [["us", "美國", [["^IXIC", "那斯達克"], ["^SOX", "費城半導體"], ["^NDX", "NASDAQ-100"], ["^DJI", "道瓊工業"], ["^GSPC", "S&P 500"], ["^VIX", "VIX 恐慌指數"]]],
  ["jp", "日本", [["^N225", "日經 225"]]], ["kr", "韓國", [["^KS11", "韓國綜合"]]], ["hk", "香港", [["^HSI", "恆生指數"]]],
  ["cn", "中國", [["000001.SS", "上證指數"], ["399001.SZ", "深證成指"]]], ["eu", "歐洲", [["^GDAXI", "德國 DAX"], ["^FTSE", "英國富時 100"], ["^STOXX50E", "歐洲 STOXX 50"]]]];
async function idxQuote([s, name]) { const p = await yahooBars(s, 5, { isIdx: true }); const q = quoteFromMeta(s, p.meta); return { code: s, name, price: q.price, chg: q.chg, chgPct: q.chgPct, date: q.date, prev: q.prev, spark: p.bars.map(b => b.c) }; }
async function usIndices() {
  const r = await Promise.allSettled(US_IDX.map(idxQuote));
  return r.filter(x => x.status === "fulfilled").map(x => x.value);
}
async function worldIndices() {
  const flat = WORLD_IDX.flatMap(([region, , list]) => list.map(x => ({ region, x }))), r = await Promise.allSettled(flat.map(f => idxQuote(f.x)));
  return WORLD_IDX.map(([id, name]) => ({ id, name, rows: flat.map((f, k) => (f.region === id && r[k].status === "fulfilled" ? r[k].value : null)).filter(Boolean) })).filter(g => g.rows.length);
}

export default async function handler(req, res) {
  const [a, b, info, mi, inst, us, world] = await Promise.allSettled([
    marketRows(), null,
    companies(), getJSON("https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX").then(parseMiIndex), instLatest(), usIndices(), worldIndices(),
  ]);
  const L = a.value, all = L?.rows || [], twse = all.filter(r => r.market === "上市"), tpex = all.filter(r => r.market === "上櫃"), I = info.value || new Map(), M = mi.value || [];
  if (!all.length && !(us.value || []).length) return res.status(200).json({ ok: false, error: `拿不到大盤資料（${a.reason?.message || "沒有資料"}）` });
  const taiex = M.find(x => /^發行量加權股價指數$/.test(x.name));
  const pickIdx = ["電子類指數", "半導體類指數", "金融保險類指數", "航運類指數", "臺灣50指數", "櫃買指數"].map(n => M.find(x => x.name === n)).filter(Boolean);
  const stocks = all.filter(r => /^\d{4}$/.test(r.code));
  res.setHeader("Cache-Control", liveCache(L?.live, 20));
  return res.status(200).json({ ok: true, date: L?.date || all.find(x => x.date)?.date || null, live: !!L?.live, time: L?.time || null, note: L?.note || null, source: `${L?.source || "證交所、櫃買中心 OpenAPI"}；美股 Yahoo Finance`,
    breadth: all.length ? breadth(all) : null, coverage: L?.coverage || null,
    sectors: I.size ? sectors(stocks, I) : null,
    // 上市、上櫃分開看（看盤頁可以切換）
    breadthBy: { twse: breadth(twse), tpex: breadth(tpex) },
    sectorsBy: I.size ? { twse: sectors(twse.filter(r => /^\d{4}$/.test(r.code)), I), tpex: sectors(tpex.filter(r => /^\d{4}$/.test(r.code)), I) } : null,
    world: world.value || [],
    contrib: I.size && taiex ? contributions(twse, I, taiex.close - (taiex.chg || 0)) : null,
    inst: inst.value || null, indices: pickIdx, us: us.value || [] });
}
