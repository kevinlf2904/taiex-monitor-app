// 選股：給 learner/watch.html 的「選股」分頁使用。都是最近一個交易日收盤後的資料，只供參考。
// GET /api/screen → { ok, date, ratio: { up, down, flat }, lists: [{ id, title, desc, rows: [{ code, name, price, chgPct, note }] }] }
//   short   短多：漲幅 ≥ 4%、成交值 ≥ 3 億，依漲幅排序
//   chips   籌碼多：外資＋投信合計買超且收紅，依買超張數排序（證交所 T86，上市）
//   trust3  投信連買：最近 3 個交易日投信都買超
//   month   站上月線：收盤高於月均價 3% 以上且今天收紅（證交所 STOCK_DAY_AVG_ALL，上市）
//   yield   高殖利率：殖利率 ≥ 5%、本益比 > 0、成交量 ≥ 500 張（證交所 BWIBBU_ALL）
//   lowpe   低本益比：本益比 0～12、成交量 ≥ 500 張
// 每一張清單有 group：hot 熱門（當天價量）、chips 籌碼、fund 指標（營收、獲利、估值）、theme 題材（_concepts.js 的參考名單）
// 熱門：漲停、開盤漲停、漲停打開、急漲、強勢（收最高）、大幅震盪、開低走高、買氣強大、股價轉強（站上月均價）、跌停、急跌
// 指標：月營收年增／年減、月營收雙增、累計營收年增、毛利率、營益率、累計 EPS、虧損、股價淨值比 < 1（t187ap05、t187ap14、t187ap17，上市＋上櫃）

import { parseT86 } from "./hot.js";
import { marketRows, liveCache } from "./_live.js";
import { getJSON, num } from "./_tw.js";
import { CONCEPTS } from "./_concepts.js";

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
  const G = { short: "hot", month: "hot", chips: "chips", trust3: "chips", yield: "fund", lowpe: "fund" };
  return lists.map(L => ({ ...L, group: G[L.id] }));
}

// 台股升降單位與漲停價（前一天收盤 × 1.1，往下取到升降單位）
export const tick = p => (p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5);
export const limitPrice = (prev, up = true) => { const raw = prev * (up ? 1.1 : 0.9), t = tick(raw); return +((up ? Math.floor(raw / t + 1e-9) : Math.ceil(raw / t - 1e-9)) * t).toFixed(2); };
const pct = v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
// 熱門：只用當天的開高低收與成交量
export function hotLists(quotes, avg = []) {
  const st = quotes.filter(q => /^[1-9]\d{3}$/.test(q.code) && q.price > 0 && q.chg != null).map(q => { const prev = q.price - q.chg; return { q, prev, lu: limitPrice(prev), ld: limitPrice(prev, false) }; }).filter(x => x.prev > 0);
  const liquid = x => (x.q.vol || 0) >= 500, near = (a, b, p) => Math.abs(a - b) < tick(p) / 2;
  const mk = (id, title, desc, xs, sort, note, n = 50) => ({ id, group: "hot", title, desc, rows: xs.sort(sort).slice(0, n).map(x => row(x.q, note(x))) });
  const byChg = (a, b) => b.q.chgPct - a.q.chgPct, byVal = (a, b) => (b.q.value || 0) - (a.q.value || 0);
  const out = [
    mk("limit", "漲停股", "收盤鎖在漲停價", st.filter(x => near(x.q.price, x.lu, x.lu)), byVal, x => `成交值 ${x.q.value ?? "—"} 億`),
    mk("openLimit", "開盤漲停股", "一開盤就漲停", st.filter(x => x.q.o != null && near(x.q.o, x.lu, x.lu)), byVal, x => (near(x.q.price, x.lu, x.lu) ? "收盤仍漲停" : `收 ${pct(x.q.chgPct)}`)),
    mk("limitOpen", "漲停打開股", "盤中碰過漲停、收盤沒有鎖住", st.filter(x => x.q.h != null && near(x.q.h, x.lu, x.lu) && !near(x.q.price, x.lu, x.lu)), byChg, x => `收 ${pct(x.q.chgPct)}`),
    mk("surge", "急漲股", "漲幅 ≥ 5%", st.filter(x => x.q.chgPct >= 5 && liquid(x)), byChg, x => `成交值 ${x.q.value ?? "—"} 億`),
    mk("strong", "強勢股", "漲幅 ≥ 3% 且收在當天最高", st.filter(x => x.q.chgPct >= 3 && x.q.h != null && x.q.price >= x.q.h - tick(x.q.h) / 2 && liquid(x)), byChg, x => `量 ${(x.q.vol || 0).toLocaleString()} 張`),
    mk("buying", "買氣強大股", "成交值 ≥ 10 億且上漲 ≥ 2%", st.filter(x => (x.q.value || 0) >= 10 && x.q.chgPct >= 2), byVal, x => `成交值 ${x.q.value} 億`),
    mk("swing", "大幅震盪股", "最高與最低相差 ≥ 7%（以昨收計）", st.filter(x => x.q.h != null && x.q.l != null && (x.q.h - x.q.l) / x.prev >= 0.07 && liquid(x)), (a, b) => (b.q.h - b.q.l) / b.prev - (a.q.h - a.q.l) / a.prev, x => `振幅 ${(((x.q.h - x.q.l) / x.prev) * 100).toFixed(1)}%`),
    mk("lowHigh", "開低走高股", "開盤低於昨收、收盤翻紅，且收盤比開盤高 ≥ 3%", st.filter(x => x.q.o != null && x.q.o < x.prev && x.q.price > x.prev && (x.q.price - x.q.o) / x.prev >= 0.03 && liquid(x)), (a, b) => (b.q.price - b.q.o) / b.prev - (a.q.price - a.q.o) / a.prev, x => `開 ${pct((x.q.o / x.prev - 1) * 100)} → 收 ${pct(x.q.chgPct)}`),
  ];
  if (avg.length) { const A = new Map(avg.map(a => [a.code, a.avg]));
    out.push(mk("turn", "股價轉強股", "昨天在月均價之下、今天站上（上市）", st.filter(x => { const a = A.get(x.q.code); return a && x.prev < a && x.q.price > a && liquid(x); }), byChg, x => `月均價 ${A.get(x.q.code)}`)); }
  out.push(mk("limitDown", "跌停股", "收盤鎖在跌停價", st.filter(x => near(x.q.price, x.ld, x.ld)), byVal, x => `成交值 ${x.q.value ?? "—"} 億`),
    mk("plunge", "急跌股", "跌幅 ≥ 5%", st.filter(x => x.q.chgPct <= -5 && liquid(x)), (a, b) => a.q.chgPct - b.q.chgPct, x => `成交值 ${x.q.value ?? "—"} 億`));
  return out;
}

// 財報與營收（證交所 t187ap05_L / t187ap14_L / t187ap17_L，櫃買中心 mopsfin_t187ap05_O / 14_O / 17_O）：欄位名稱用關鍵字找
const keyOf = (r, ...res) => Object.keys(r).find(k => res.every(re => re.test(k.replace(/\s/g, ""))));
const codeOf = r => String(r[keyOf(r, /^公司代號$|SecuritiesCompanyCode|CompanyCode/)] ?? "").trim();
export function parseRevenue(rows) {
  if (!Array.isArray(rows) || !rows.length) return []; const r0 = rows[0];
  const kM = keyOf(r0, /當月營收/), kY = keyOf(r0, /去年同月增減/), kQ = keyOf(r0, /上月比較增減/), kC = keyOf(r0, /前期比較增減/), kYM = keyOf(r0, /^資料年月$/);
  return rows.map(r => ({ code: codeOf(r), rev: num(r[kM]), yoy: num(r[kY]), mom: num(r[kQ]), cum: num(r[kC]), ym: kYM ? String(r[kYM]) : null })).filter(x => x.code && x.rev != null);
}
export function parseEps(rows) {
  if (!Array.isArray(rows) || !rows.length) return []; const r0 = rows[0], kE = keyOf(r0, /基本每股盈餘/), kY = keyOf(r0, /^年度$/), kQ = keyOf(r0, /^季別$/);
  return rows.map(r => ({ code: codeOf(r), eps: num(r[kE]), q: kY && kQ ? `${+r[kY] + 1911}Q${r[kQ]}` : null })).filter(x => x.code && x.eps != null);
}
export function parseMargins(rows) {
  if (!Array.isArray(rows) || !rows.length) return []; const r0 = rows[0];
  const kG = keyOf(r0, /^毛利率/), kO = keyOf(r0, /^營業利益率/), kN = keyOf(r0, /^稅後純益率/);
  return rows.map(r => ({ code: codeOf(r), gm: num(r[kG]), om: num(r[kO]), nm: num(r[kN]) })).filter(x => x.code && (x.gm != null || x.om != null));
}
export function fundLists(quotes, { rev = [], eps = [], mg = [], bw = [] }) {
  const Q = new Map(quotes.filter(q => /^[1-9]\d{3}$/.test(q.code)).map(q => [q.code, q])), out = [];
  const mk = (id, title, desc, xs, sort, note, n = 60) => out.push({ id, group: "fund", title, desc, rows: xs.filter(x => Q.get(x.code)).sort(sort).slice(0, n).map(x => row(Q.get(x.code), note(x))) });
  if (rev.length) {
    const ym = rev.find(x => x.ym)?.ym, tag = ym ? `（${String(ym).slice(0, -2)}/${String(ym).slice(-2)}）` : "";
    mk("revYoy", "月營收年增 > 20%", `最新月營收比去年同月增加 20% 以上${tag}`, rev.filter(x => x.yoy > 20), (a, b) => b.yoy - a.yoy, x => `年增 ${pct(x.yoy)}`);
    mk("revBoth", "月營收雙增", `年增與月增都 > 0${tag}`, rev.filter(x => x.yoy > 0 && x.mom > 0), (a, b) => b.yoy - a.yoy, x => `年增 ${pct(x.yoy)}・月增 ${pct(x.mom)}`);
    mk("revCum", "累計營收年增 > 20%", `今年累計營收比去年同期增加 20% 以上${tag}`, rev.filter(x => x.cum > 20), (a, b) => b.cum - a.cum, x => `累計 ${pct(x.cum)}`);
    mk("revDown", "月營收年減 > 20%", `最新月營收比去年同月減少 20% 以上${tag}`, rev.filter(x => x.yoy < -20), (a, b) => a.yoy - b.yoy, x => `年減 ${pct(x.yoy)}`);
  }
  if (mg.length) {
    mk("gm30", "毛利率 > 30%", "最新一季財報的毛利率", mg.filter(x => x.gm > 30), (a, b) => b.gm - a.gm, x => `毛利率 ${x.gm}%`);
    mk("om10", "營益率 > 10%", "最新一季財報的營業利益率", mg.filter(x => x.om > 10), (a, b) => b.om - a.om, x => `營益率 ${x.om}%${x.nm != null ? `・純益率 ${x.nm}%` : ""}`);
  }
  if (eps.length) {
    const q = eps.find(x => x.q)?.q;
    mk("eps5", "累計 EPS > 5 元", `今年到${q ? ` ${q} ` : "最新一季"}的累計每股盈餘`, eps.filter(x => x.eps > 5), (a, b) => b.eps - a.eps, x => `EPS ${x.eps} 元`);
    mk("loss", "累計虧損", "今年累計每股盈餘小於 0", eps.filter(x => x.eps < 0), (a, b) => a.eps - b.eps, x => `EPS ${x.eps} 元`);
  }
  if (bw.length) mk("pb1", "股價淨值比 < 1", "股價低於每股淨值（上市）", bw.filter(x => x.pb > 0 && x.pb < 1 && (Q.get(x.code)?.vol || 0) >= 200), (a, b) => a.pb - b.pb, x => `淨值比 ${x.pb}`);
  return out;
}
export function themeLists(quotes) {
  const Q = new Map(quotes.map(q => [q.code, q]));
  return CONCEPTS.map(([id, title, codes]) => ({ id: "t:" + id, group: "theme", title, desc: "常被提到的代表股，不是完整名單", rows: codes.map(c => Q.get(c)).filter(Boolean).map(q => row(q, q.market || "")) }));
}
export const parseAvg = rows => (Array.isArray(rows) ? rows : []).map(r => ({ code: String(pick(r, "Code") || "").trim(), close: num(pick(r, "ClosingPrice")), avg: num(pick(r, "MonthlyAveragePrice")) })).filter(x => x.code && x.close && x.avg);
export const parseBw = rows => (Array.isArray(rows) ? rows : []).map(r => ({ code: String(pick(r, "Code") || "").trim(), pe: num(pick(r, "PEratio", "PeRatio")), dy: num(pick(r, "DividendYield")), pb: num(pick(r, "PBratio", "PbRatio")) })).filter(x => x.code);

export default async function handler(req, res) {
  const both = async (l, o, parse) => { const r = await Promise.allSettled([getJSON(l, 15000), getJSON(o, 15000)]); return r.flatMap(x => (x.status === "fulfilled" ? parse(x.value) : [])); };
  const [a, b, t, avg, bw, rev, eps, mg] = await Promise.allSettled([
    marketRows(), null,
    t86Days(3),
    getJSON("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL").then(parseAvg),
    getJSON("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL").then(parseBw),
    both("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", parseRevenue),
    both("https://openapi.twse.com.tw/v1/opendata/t187ap14_L", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O", parseEps),
    both("https://openapi.twse.com.tw/v1/opendata/t187ap17_L", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap17_O", parseMargins),
  ]);
  const L = a.value, quotes = L?.rows || [];
  if (!quotes.length) return res.status(200).json({ ok: false, error: `拿不到選股資料（${a.reason?.message || "沒有資料"}）` });
  const st = quotes.filter(q => /^\d{4}$/.test(q.code));
  res.setHeader("Cache-Control", liveCache(L.live, 30));
  return res.status(200).json({ ok: true, date: L.date || quotes.find(q => q.date)?.date || null, live: L.live, time: L.time, source: L.live ? `${L.source}；法人、財報為最近公布` : "證交所、櫃買中心 OpenAPI",
    ratio: { up: st.filter(q => q.chgPct > 0).length, down: st.filter(q => q.chgPct < 0).length, flat: st.filter(q => q.chgPct === 0).length },
    lists: [...hotLists(quotes, avg.value || []), ...buildLists({ quotes, t86: t.value || [], avg: avg.value || [], bw: bw.value || [] }),
      ...fundLists(quotes, { rev: rev.value || [], eps: eps.value || [], mg: mg.value || [], bw: bw.value || [] }), ...themeLists(quotes)] });
}
