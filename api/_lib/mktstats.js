// 大盤籌碼統計：給 learner/watch.html「大盤」分頁使用。
// GET /api/mktstats → { ok, orders, margin, futures }
//   orders   上市委買委賣（證交所 MI_5MINS：每 5 秒累積委託、成交統計，取最新一筆）
//            { date, time, bidCnt, bidVol, askCnt, askVol, dealCnt, dealVol, dealAmt（億） }
//   margin   上市融資融券（證交所 MI_MARGN 信用交易統計，收盤後公布）
//            { date, finBal（億）, finChg（億）, shortBal（張）, shortChg（張） }
//   futures  期貨三大法人淨未平倉（期交所，收盤後公布）＋散戶（＝法人反向，用小台估）
//            { date, rows: [{ who, tx, txChg, mtx, mtxChg }], retail: { mtx, mtxChg } }
// 每一塊各自抓，失敗的那塊回 null，不影響其他。
import { getJSON, num } from "./_tw.js";
import { pickTable } from "./daily.js";

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
const tpNow = () => new Date(Date.now() + 8 * 3600e3);
const keyIdx = (fields, re) => fields.findIndex(f => re.test(String(f).replace(/\s|<[^>]+>/g, "")));
const dashed = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
// 往前找最近有資料的一天（今天還沒公布、假日）
async function recent(fn, days = 6) {
  const t = tpNow();
  for (let k = 0; k < days; k++) { const d = new Date(t.getTime() - k * 864e5); if (d.getUTCDay() % 6 === 0) continue; try { const v = await fn(ymd(d)); if (v) return v; } catch {} }
  return null;
}

// ---------- 委買委賣 ----------
export function parseMi5(j, d) {
  const t = pickTable(j, /委託買進筆數/, /成交金額/); if (!t?.data?.length) return null;
  const f = t.fields, r = t.data[t.data.length - 1], g = re => num(r[keyIdx(f, re)]);
  return { date: dashed(d), time: String(r[keyIdx(f, /時間/)] ?? "").trim(), bidCnt: g(/委託買進筆數/), bidVol: g(/委託買進數量/), askCnt: g(/委託賣出筆數/), askVol: g(/委託賣出數量/),
    dealCnt: g(/成交筆數/), dealVol: g(/成交數量/), dealAmt: g(/成交金額/) != null ? +(g(/成交金額/) / 100).toFixed(2) : null }; // 成交金額單位：百萬元 → 億
}
const orders = () => recent(async d => parseMi5(await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_5MINS?date=${d}&response=json`, 12000), d));

// ---------- 融資融券 ----------
export function parseMargin(j, d) {
  const t = pickTable(j, /項目/, /今日餘額/); if (!t?.data?.length) return null;
  const f = t.fields, iP = keyIdx(f, /前日餘額/), iT = keyIdx(f, /今日餘額/), row = re => t.data.find(r => re.test(String(r[0]).replace(/\s/g, "")));
  const fin = row(/融資金額/), sh = row(/^融券/); if (!fin || !sh) return null;
  const fb = num(fin[iT]), fp = num(fin[iP]), sb = num(sh[iT]), sp = num(sh[iP]);
  if (fb == null || sb == null) return null;
  return { date: dashed(d), finBal: +(fb / 1e5).toFixed(2), finChg: fp != null ? +((fb - fp) / 1e5).toFixed(2) : null, shortBal: sb, shortChg: sp != null ? sb - sp : null }; // 仟元 → 億
}
const margin = () => recent(async d => parseMargin(await getJSON(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${d}&selectType=MS&response=json`, 12000), d));

// ---------- 期貨三大法人 ----------
// 期交所資料（OpenAPI JSON 或 CSV）每列：日期、商品名稱、身份別、…、多空未平倉口數淨額
export function parseFutRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const keys = Object.keys(rows[0]), k = re => keys.find(x => re.test(x.replace(/\s/g, "")));
  const kD = k(/日期|Date/i), kP = k(/商品名稱|ContractName|Product/i), kW = k(/身份別|Identity|Item/i), kN = k(/未平倉口數淨額|NetOpenInterest.*Volume|OpenInterest.*Net.*Volume/i);
  if (!kP || !kW || !kN) return null;
  const by = new Map(); let date = null;
  for (const r of rows) {
    const p = String(r[kP] ?? ""), w = String(r[kW] ?? "").trim(), n = num(r[kN]), d = String(r[kD] ?? "").replace(/\D/g, "");
    const prod = /小型臺指|小型台指|Mini-TAIEX/i.test(p) ? "mtx" : /^臺股期貨$|^台股期貨$|TAIEX Futures/i.test(p.trim()) ? "tx" : null;
    const who = /外資|Foreign/i.test(w) ? "外資" : /投信|Investment Trust/i.test(w) ? "投信" : /自營|Dealer/i.test(w) ? "自營商" : null;
    if (!prod || !who || n == null || !/^\d{8}$/.test(d)) continue;
    if (!by.has(d)) by.set(d, {}); const D = by.get(d); (D[who] ||= {})[prod] = n; date = !date || d > date ? d : date;
  }
  if (!date) return null;
  const dates = [...by.keys()].sort(), prev = by.get(dates[dates.length - 2]), cur = by.get(date);
  const rowsOut = ["外資", "投信", "自營商"].map(who => ({ who, tx: cur[who]?.tx ?? null, mtx: cur[who]?.mtx ?? null, txChg: prev?.[who]?.tx != null && cur[who]?.tx != null ? cur[who].tx - prev[who].tx : null, mtxChg: prev?.[who]?.mtx != null && cur[who]?.mtx != null ? cur[who].mtx - prev[who].mtx : null }));
  const sum = (o, p) => ["外資", "投信", "自營商"].reduce((s, w) => s + (o?.[w]?.[p] ?? 0), 0);
  const retail = { mtx: -sum(cur, "mtx"), mtxChg: prev ? -(sum(cur, "mtx") - sum(prev, "mtx")) : null };
  return { date: dashed(date), rows: rowsOut, retail };
}
export function csvRows(text) {
  const lines = String(text).replace(/\r/g, "").split("\n").filter(l => l.trim()); if (lines.length < 2) return [];
  const head = lines[0].split(",").map(s => s.trim());
  return lines.slice(1).map(l => Object.fromEntries(l.split(",").map((v, i) => [head[i], v.trim()])));
}
async function futures() {
  try { // 1. 期交所 OpenAPI（只有最新一天，沒有增減）
    const j = await getJSON("https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate", 12000);
    const a = parseFutRows(j);
    // 2. 再用 CSV 下載近幾天，補上「增減」
    try {
      const t = tpNow(), end = t.toISOString().slice(0, 10).replace(/-/g, "/"), start = new Date(t.getTime() - 10 * 864e5).toISOString().slice(0, 10).replace(/-/g, "/");
      const r = await fetch("https://www.taifex.com.tw/cht/3/futContractsDateDown", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" }, body: `queryStartDate=${encodeURIComponent(start)}&queryEndDate=${encodeURIComponent(end)}`, signal: AbortSignal.timeout(12000) });
      if (r.ok) { const b = parseFutRows(csvRows(new TextDecoder("big5").decode(await r.arrayBuffer()))); if (b && (!a || b.date >= a.date)) return b; }
    } catch {}
    return a;
  } catch { return null; }
}

export default async function handler(req, res) {
  const [o, m, f] = await Promise.allSettled([orders(), margin(), futures()]);
  const out = { ok: true, orders: o.value || null, margin: m.value || null, futures: f.value || null };
  if (!out.orders && !out.margin && !out.futures) return res.status(200).json({ ok: false, error: "暫時拿不到證交所、期交所的統計資料" });
  const h = tpNow().getUTCHours() * 60 + tpNow().getUTCMinutes(), open = tpNow().getUTCDay() % 6 && h >= 540 && h <= 815;
  res.setHeader("Cache-Control", open ? "s-maxage=60, stale-while-revalidate=120" : "s-maxage=600, stale-while-revalidate=1800");
  return res.status(200).json(out);
}
