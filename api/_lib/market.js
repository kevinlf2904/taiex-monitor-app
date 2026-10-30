// 大盤總覽：給 learner/watch.html 的「大盤」分頁使用。
// GET /api/market
// 台股個股統計來自 _live.js：盤中用富果行情快照（即時，回 live: true、time），沒有金鑰時用證交所、櫃買中心 OpenAPI（前一個交易日收盤）；
// 盤中的加權、櫃買即時指數由看盤頁另外用 /api/quote 更新；盤中快取 10 秒：
//   breadth  漲跌家數（上市櫃股票＋ETF，和券商的「整體市場」口徑一樣）；漲停跌停用實際的漲跌停價判斷（依升降單位）
//   sectors  產業漲跌（以前一日市值加權的平均漲跌幅）與成交金額比重
//   contrib  加權指數貢獻點數排行（用發行股數與漲跌估算，只算上市普通股）
//   inst     三大法人買賣超金額（證交所 BFI82U，上市）
//   indices  電子、金融等類股指數（證交所 MI_INDEX）
//   us       美股四大指數（道瓊、那斯達克、S&P 500、費城半導體）與當日走勢（Yahoo Finance）
//   breadthBy、sectorsBy  上市、上櫃分開的漲跌家數與產業漲跌
//   world    國際指數，依地區分組（美國、日本、韓國、香港、中國、歐洲）

import { marketRows, liveCache } from "./_live.js";
import { getJSON, num, rocDate, companies } from "./_tw.js";
import { yahooBars, quoteFromMeta } from "./_yahoo.js";
import { extractTwseRwdDate, isValidIsoDate } from "./daily.js";
import { todayTaipei } from "./quote.js";

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
const NON_SECTOR_RE = /報酬|槓桿|反向|兩倍|熊|牛/;

// OpenAPI 的類股指數是「最近一個交易日收盤」，日期是民國年（1141007）
// 先驗證數值有效性，再依明確順序去重，杜絕無效列佔用名稱排除後續有效列之缺陷
export function parseMiIndex(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).map(r => {
    const rawName = String(r["指數"] ?? "").trim();
    if (!rawName || NON_SECTOR_RE.test(rawName)) return null;

    const close = num(r["收盤指數"]);
    if (close == null) return null; // 先檢查數值有效性，無效者絕不佔用 seen

    if (seen.has(rawName)) return null;
    seen.add(rawName);

    const sign = String(r["漲跌"] ?? "").includes("-") ? -1 : 1;
    const pts = num(r["漲跌點數"]);
    const pct = num(r["漲跌百分比"]);
    const d = rocDate(r["日期"]);

    return {
      name: rawName,
      date: d,
      close,
      chg: pts != null ? (pts === 0 ? 0 : sign * Math.abs(pts)) : null,
      chgPct: pct != null ? (pct === 0 ? 0 : sign * Math.abs(pct)) : null
    };
  }).filter(Boolean);
}

// 網站每日收盤行情（type=IND）：指數名稱、收盤指數、漲跌(+/-)、漲跌點數、漲跌百分比
export function parseMiIndexRwd(j) {
  const d = extractTwseRwdDate(j);
  const out = [];
  const seen = new Set();
  const tables = Array.isArray(j?.tables) ? j.tables : Array.isArray(j?.data) ? [j] : [];

  for (const t of tables) {
    if (!Array.isArray(t?.data)) continue;
    if (t.title && /報酬/.test(t.title)) continue; // 排除報酬指數表

    const f = (t.fields || []).map(x => String(x).replace(/\s/g, ""));
    const iName = f.findIndex(x => /指數/.test(x));
    const iClose = f.findIndex(x => /收盤/.test(x));
    const iSign = f.findIndex(x => /漲跌\(\+\/-\)/.test(x));
    const iPts = f.findIndex(x => /漲跌點數|^漲跌$/.test(x));
    const iPct = f.findIndex(x => /百分比/.test(x));

    for (const r of t.data) {
      const name = String((iName >= 0 ? r[iName] : r[0]) ?? "").trim();
      if (!name || NON_SECTOR_RE.test(name)) continue;

      const close = num(iClose >= 0 ? r[iClose] : r[1]);
      if (close == null) continue; // 先檢查收盤價有效性

      if (seen.has(name)) continue;
      seen.add(name);

      const rawSign = String((iSign >= 0 ? r[iSign] : r[2]) ?? "");
      const sign = rawSign.includes("-") ? -1 : rawSign.includes("+") ? 1 : 0;
      const pts = num(iPts >= 0 ? r[iPts] : r[3]);
      const pct = num(iPct >= 0 ? r[iPct] : r[4]);

      const chg = pts != null ? (pts === 0 ? 0 : (sign !== 0 ? sign * Math.abs(pts) : pts)) : null;
      const chgPct = pct != null ? (pct === 0 ? 0 : (sign !== 0 ? sign * Math.abs(pct) : pct)) : null;

      out.push({ name, date: d, close, chg, chgPct });
    }
  }
  return out;
}

const ESSENTIAL_INDICES = ["發行量加權股價指數", "電子工業類指數", "半導體類指數", "金融保險類指數", "航運類指數", "臺灣50指數"];

function attachIndexMeta(rows, date, source, { reqDate = null, now = new Date() } = {}) {
  const maxIso = todayTaipei(now);
  const isDateValid = Boolean(date && isValidIsoDate(date, maxIso));
  const isDateMatched = Boolean(isDateValid && (!reqDate || date === reqDate));
  const names = new Set(rows.map(r => r.name));
  const missing = ESSENTIAL_INDICES.filter(n => {
    if (names.has(n)) return false;
    if (n === "電子工業類指數" && (names.has("電子類指數") || names.has("電子工業類指數"))) return false;
    return true;
  });

  rows.date = isDateValid ? date : null;
  rows.sourceDate = isDateValid ? date : null;
  rows.dateVerified = Boolean(isDateValid && isDateMatched);
  rows.isComplete = missing.length === 0 && rows.dateVerified;
  rows.missing = missing;
  rows.source = source + (rows.dateVerified ? "" : "（日期未驗證或不符）");
  return rows;
}

// 取得類股指數：OpenAPI 優先，若無資料或日期停滯則以 RWD 為備援
export async function fetchMiIndex(targetDate = null, { getJson = getJSON, now = new Date() } = {}) {
  let oapiRows = [];
  try {
    const j = await getJson("https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX", {}, 12000);
    oapiRows = parseMiIndex(j);
  } catch {}

  const oDate = oapiRows[0]?.date || null;
  const maxIso = todayTaipei(now);
  const isODateValid = Boolean(oDate && isValidIsoDate(oDate, maxIso));

  if (oapiRows.length && isODateValid && (!targetDate || oDate === targetDate || oDate >= targetDate)) {
    return attachIndexMeta(oapiRows, oDate, "證交所 OpenAPI", { reqDate: targetDate, now });
  }

  const probeDate = (targetDate || oDate || maxIso).replace(/-/g, "");
  try {
    const rwdJ = await getJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${probeDate}&type=IND&response=json`, {}, 15000);
    const rwdRows = parseMiIndexRwd(rwdJ);
    const rwdDate = rwdRows[0]?.date || null;
    const isRwdDateValid = Boolean(rwdDate && isValidIsoDate(rwdDate, maxIso));

    if (rwdRows.length && isRwdDateValid) {
      return attachIndexMeta(rwdRows, rwdDate, "證交所 RWD", { reqDate: targetDate, now });
    }
  } catch {}

  return attachIndexMeta(oapiRows, isODateValid ? oDate : null, "證交所 OpenAPI（降級）", { reqDate: targetDate, now });
}

// BFI82U：單位名稱、買進金額、賣出金額、買賣差額（元）→ 億元
export function parseBfi82u(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const pick = re => j.data.filter(r => re.test(String(r[0]))).reduce((s, r) => s + (num(r[3]) || 0), 0) / 1e8;
  return { foreign: +pick(/外資/).toFixed(2), trust: +pick(/投信/).toFixed(2), dealer: +pick(/^自營商/).toFixed(2), total: +(j.data.filter(r => /合計/.test(String(r[0]))).reduce((s, r) => s + (num(r[3]) || 0), 0) / 1e8).toFixed(2) };
}
const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
async function instLatest(fetchedAt = new Date().toISOString()) {
  const d = new Date(Date.now() + 8 * 3600e3), today = d.toISOString().slice(0, 10);
  for (let k = 0; k < 7; k++) {
    try {
      const r = parseBfi82u(await getJSON(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=${ymd(d)}&response=json`));
      if (r) {
        const date = `${ymd(d).slice(0, 4)}-${ymd(d).slice(4, 6)}-${ymd(d).slice(6)}`;
        return {
          date,
          dataDate: date,
          sourceTime: null,
          fetchedAt,
          source: "證交所 BFI82U",
          updateMode: "after_close",
          dataStatus: date === today ? "confirmed" : "pending",
          ...r,
        };
      }
    } catch {}
    d.setDate(d.getDate() - 1);
  }
  return null;
}
const US_IDX = [["^DJI", "道瓊工業"], ["^IXIC", "那斯達克"], ["^GSPC", "S&P 500"], ["^SOX", "費城半導體"]];
// 國際指數：依地區分組（Yahoo Finance，收盤或盤中延遲報價）
export const WORLD_IDX = [["us", "美國", [["^IXIC", "那斯達克"], ["^SOX", "費城半導體"], ["^NDX", "NASDAQ-100"], ["^DJI", "道瓊工業"], ["^GSPC", "S&P 500"], ["^VIX", "VIX 恐慌指數"]]],
  ["jp", "日本", [["^N225", "日經 225"]]], ["kr", "韓國", [["^KS11", "韓國綜合"]]], ["hk", "香港", [["^HSI", "恆生指數"]]],
  ["cn", "中國", [["000001.SS", "上證指數"], ["399001.SZ", "深證成指"]]], ["eu", "歐洲", [["^GDAXI", "德國 DAX"], ["^FTSE", "英國富時 100"], ["^STOXX50E", "歐洲 STOXX 50"]]]];
async function idxQuote([s, name]) {
  const p = await yahooBars(s, 5, { isIdx: true });
  const q = quoteFromMeta(s, p.meta);
  return {
    code: s, name, price: q.price, chg: q.chg, chgPct: q.chgPct, date: q.date, time: q.time, prev: q.prev,
    dataDate: q.dataDate || q.date || null,
    sourceTime: q.sourceTime || q.time || null,
    sourceTimeTW: q.sourceTimeTW || null,
    sourceDateTW: q.sourceDateTW || null,
    epochMs: q.epochMs || null,
    tz: q.tz || null,
    session: q.session?.state || "closed",
    subState: q.session?.subState || "closed",
    holiday: q.holiday || null,
    source: "Yahoo Finance",
    updateMode: q.updateMode || "scheduled",
    dataStatus: q.dataStatus || "confirmed",
    isStale: !!q.isStale,
    spark: p.bars.map(b => b.c),
  };
}
async function usIndices() {
  const r = await Promise.allSettled(US_IDX.map(idxQuote));
  return r.filter(x => x.status === "fulfilled").map(x => x.value);
}
async function worldIndices() {
  const flat = WORLD_IDX.flatMap(([region, , list]) => list.map(x => ({ region, x }))), r = await Promise.allSettled(flat.map(f => idxQuote(f.x)));
  return WORLD_IDX.map(([id, name]) => ({ id, name, rows: flat.map((f, k) => (f.region === id && r[k].status === "fulfilled" ? r[k].value : null)).filter(Boolean) })).filter(g => g.rows.length);
}

// 股價月新高／月新低：和「不含今天的前 20 個交易日」最高／最低收盤比（資料：learner/data/market/hilo.json，每天收盤後由排程更新）
export function newHiLo(rows, H, today) {
  if (!H?.days?.length || !H.closes) return null;
  const idx = H.days.map((d, i) => [d, i]).filter(([d]) => d < String(today || "").replace(/-/g, "")).slice(0, 20).map(([, i]) => i);
  if (idx.length < 15) return null;
  const by = { twse: { hi: 0, lo: 0 }, tpex: { hi: 0, lo: 0 } };
  for (const r of rows) {
    const a = H.closes[r.code]; if (!a || r.price == null) continue;
    const xs = idx.map(i => a[i]).filter(v => v != null); if (xs.length < 15) continue;
    const k = r.market === "上櫃" ? "tpex" : "twse";
    if (r.price > Math.max(...xs)) by[k].hi++; else if (r.price < Math.min(...xs)) by[k].lo++;
  }
  return { ...by, all: { hi: by.twse.hi + by.tpex.hi, lo: by.twse.lo + by.tpex.lo }, days: idx.length };
}
let hiloMemo = null;
async function hilo(host) {
  if (hiloMemo && Date.now() - hiloMemo.at < 600000) return hiloMemo.v;
  const base = process.env.SITE_URL || (host ? `https://${host}` : null); if (!base) return null;
  const v = await getJSON(`${base.replace(/\/$/, "")}/learner/data/market/hilo.json`).catch(() => null);
  hiloMemo = { at: Date.now(), v }; return v;
}

export default async function handler(req, res, { marketFetcher = marketRows } = {}) {
  const fetchedAt = new Date().toISOString();
  const [a, b, info, inst, us, world] = await Promise.allSettled([
    marketFetcher(), hilo(req.headers?.host),
    companies(), instLatest(fetchedAt), usIndices(), worldIndices(),
  ]);
  const L = a.value, all = L?.rows || [], twse = all.filter(r => r.market === "上市"), tpex = all.filter(r => r.market === "上櫃"), I = info.value || new Map();
  const M = await fetchMiIndex(L?.date);
  if (!all.length && !(us.value || []).length) return res.status(200).json({ ok: false, error: `拿不到大盤資料（${a.reason?.message || "沒有資料"}）` });
  const taiex = M.find(x => /^發行量加權股價指數$/.test(x.name));
  const pickIdx = ["電子類指數", "半導體類指數", "金融保險類指數", "航運類指數", "臺灣50指數", "櫃買指數"].map(n => M.find(x => x.name === n || (n === "電子類指數" && x.name === "電子工業類指數"))).filter(Boolean);
  const stocks = all.filter(r => /^\d{4}$/.test(r.code));
  const mktDate = L?.date || all.find(x => x.date)?.date || null;
  const mktTime = L?.time || L?.sourceTime || null;
  const updateMode = L?.live ? "live" : L?.updateMode || "after_close";
  // 附帶的資料（新高新低、產業、法人、美股、世界指數）抓失敗或是空的：列在 failed（前端註明暫缺），快取縮短，不讓缺一塊的結果留 5 分鐘
  const failed = [["hilo", b, v => v], ["sectors", info, v => v?.size], ["inst", inst, v => v], ["us", us, v => v?.length], ["world", world, v => v?.length]].filter(([, r, has]) => r.status === "rejected" || !has(r.value)).map(([k]) => k);
  res.setHeader("Cache-Control", failed.length && !L?.live ? "s-maxage=30, stale-while-revalidate=60" : liveCache(L?.live, 10));
  return res.status(200).json({
    ok: true,
    failed,
    date: mktDate,
    dataDate: mktDate,
    live: !!L?.live,
    time: mktTime,
    sourceTime: mktTime,
    fetchedAt: L?.fetchedAt || fetchedAt,
    updateMode,
    isFallback: !!L?.isFallback,
    isLastGood: !!L?.isLastGood, // 盤中 MIS 暫時失敗，沿用今天最後一筆有效資料（lastGoodAt 是當初抓到的時間）
    lastGoodAt: L?.lastGoodAt || null,
    fallbackReason: L?.fallbackReason || null,
    sourceState: L?.sourceState || null,
    misStats: L?.misStats ? { batches: L.misStats.batches, okBatches: L.misStats.okBatches, partialBatches: L.misStats.partialBatches, failedBatches: L.misStats.failedBatches, retries: L.misStats.retries, requests: L.misStats.requests, received: L.misStats.received, requested: L.misStats.requested, missing: L.misStats.missing, timedOut: L.misStats.timedOut, errors: L.misStats.errors } : null,
    note: L?.note || null,
    source: `${L?.source || "證交所、櫃買中心 OpenAPI"}；美股 Yahoo Finance`,
    breadth: all.length ? breadth(all) : null,
    coverage: L?.coverage || null,
    completeness: L?.completeness || null,
    dataStatus: L?.dataStatus || null,
    dateVerified: L?.dateVerified ?? null,
    dateConsistent: L?.dateConsistent ?? null,
    indicesVerified: M?.dateVerified ?? null,
    indicesComplete: M?.isComplete ?? null,
    indicesSource: M?.source || "證交所 MI_INDEX",
    newHL: newHiLo(all, b.value, mktDate),
    sectors: I.size ? sectors(stocks, I) : null,
    // 上市、上櫃分開看（看盤頁可以切換）
    breadthBy: { twse: breadth(twse), tpex: breadth(tpex) },
    totalsBy: Object.fromEntries([["twse", twse], ["tpex", tpex], ["all", all]].map(([k, R]) => [k, { value: +R.reduce((t, r) => t + (r.value || 0), 0).toFixed(1), vol: R.reduce((t, r) => t + (r.vol || 0), 0) }])),
    sectorsBy: I.size ? { twse: sectors(twse.filter(r => /^\d{4}$/.test(r.code)), I), tpex: sectors(tpex.filter(r => /^\d{4}$/.test(r.code)), I) } : null,
    world: world.value || [],
    contrib: I.size && taiex ? contributions(twse, I, taiex.close - (taiex.chg || 0)) : null,
    inst: inst.value || null,
    indices: pickIdx,
    us: us.value || [],
  });
}
