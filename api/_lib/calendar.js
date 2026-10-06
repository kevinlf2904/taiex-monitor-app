// 理財行事曆（除權息）：給 learner/watch.html「大盤」的除權息行事曆使用。
// GET /api/calendar → { ok, rows: [{ date, code, name, kind, cash, stock, market }] }，依日期排序
// 來源：證交所「除權除息預告表」TWT48U（上市）、櫃買中心除權息預告（上櫃）；欄位名稱用關鍵字找，抓不到的市場就略過。
// 法說會：公開資訊觀測站「法人說明會一覽表」（本月與下個月，上市＋上櫃），回在 conf：[{ date, time, code, name, place, note, market }]

import { getJSON, num } from "./_tw.js";

const keyOf = (r, re) => Object.keys(r).find(k => re.test(String(k).replace(/\s/g, "")));
// 115年10月06日、115/10/06、1151006、20261006 → 2026-10-06
export function toIso(s) {
  const t = String(s ?? "").trim(); let m;
  if ((m = t.match(/^(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/))) { const y = +m[1] < 1911 ? +m[1] + 1911 : +m[1]; return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; }
  if ((m = t.match(/^(\d{3})(\d{2})(\d{2})$/))) return `${+m[1] + 1911}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const kindOf = v => { const t = String(v ?? ""); return /權息/.test(t) ? "權息" : /權/.test(t) ? "除權" : /息/.test(t) ? "除息" : t.trim() || "除權息"; };
// { fields: [...], data: [[...]] } 或物件陣列，都轉成同一種格式
export function parseCalendar(j, market) {
  let rows = [];
  if (Array.isArray(j?.data) && Array.isArray(j?.fields)) { const f = j.fields.map(x => String(x).replace(/\s/g, "")); rows = j.data.map(r => Object.fromEntries(f.map((k, i) => [k, r[i]]))); }
  else if (Array.isArray(j?.tables)) { const t = j.tables.find(x => Array.isArray(x?.fields) && Array.isArray(x?.data)); if (t) return parseCalendar(t, market); }
  else if (Array.isArray(j)) rows = j;
  if (!rows.length) return [];
  const r0 = rows[0];
  const kD = keyOf(r0, /除權除?息日期|除權息日期|^Date$|ExDividendDate|ExRightsDate/i), kC = keyOf(r0, /股票代號|證券代號|^代號$|^Code$|SecuritiesCompanyCode/i), kN = keyOf(r0, /^名稱$|股票名稱|證券名稱|公司名稱|^Name$|CompanyName/i);
  const kK = keyOf(r0, /^除權息$|權息|^Exdividend$|ExRightType|類別/i), kCash = keyOf(r0, /現金股利|CashDividend/i), kStock = keyOf(r0, /無償配股率|盈餘轉增資|股票股利|StockDividend/i);
  if (!kD || !kC) return [];
  return rows.map(r => ({ date: toIso(r[kD]), code: String(r[kC] ?? "").trim(), name: String(r[kN] ?? "").trim(), kind: kindOf(kK ? r[kK] : ""), cash: kCash ? num(r[kCash]) : null, stock: kStock ? num(r[kStock]) : null, market }))
    .filter(x => x.date && /^\d{4,6}[A-Z]?$/.test(x.code));
}

// 公開資訊觀測站回傳 HTML 表格：用表頭文字找欄位
const strip = h => String(h).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export function parseConf(html, market) {
  const rows = [...String(html || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => strip(c[1])));
  const hi = rows.findIndex(r => r.some(c => /公司代號/.test(c)) && r.some(c => /日期/.test(c))); if (hi < 0) return [];
  const H = rows[hi], at = re => H.findIndex(c => re.test(c)), iC = at(/公司代號/), iN = at(/公司名稱/), iD = at(/日期/), iT = at(/時間/), iP = at(/地點/), iM = at(/擇要|訊息/);
  return rows.slice(hi + 1).filter(r => r.length >= H.length - 1).map(r => ({ date: toIso(String(r[iD] ?? "").split(/[至~ ]/)[0]), time: iT >= 0 ? r[iT] : "", code: String(r[iC] ?? "").trim(), name: iN >= 0 ? r[iN] : "", place: iP >= 0 ? String(r[iP]).slice(0, 60) : "", note: iM >= 0 ? String(r[iM]).slice(0, 160) : "", market }))
    .filter(x => x.date && /^\d{4,6}[A-Z]?$/.test(x.code));
}
async function confList() {
  const t = new Date(Date.now() + 8 * 3600e3), months = [[t.getUTCFullYear(), t.getUTCMonth() + 1]]; months.push(months[0][1] === 12 ? [months[0][0] + 1, 1] : [months[0][0], months[0][1] + 1]);
  const jobs = months.flatMap(([y, m]) => [["sii", "上市"], ["otc", "上櫃"]].map(([k, mk]) => fetch("https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" },
    body: `encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=${k}&year=${y - 1911}&month=${String(m).padStart(2, "0")}`, signal: AbortSignal.timeout(12000) }).then(r => (r.ok ? r.text() : "")).then(h => parseConf(h, mk))));
  const r = await Promise.allSettled(jobs), seen = new Set();
  return r.flatMap(x => (x.status === "fulfilled" ? x.value : [])).filter(x => { const k = x.date + x.code; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.date.localeCompare(b.date));
}

export default async function handler(req, res) {
  const tries = [
    ["上市", "https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json"],
    ["上市", "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL"],
    ["上櫃", "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost"],
  ];
  const [got, cf] = await Promise.all([Promise.allSettled(tries.map(([m, u]) => getJSON(u, 12000).then(j => parseCalendar(j, m)))), confList().catch(() => [])]);
  const seen = new Set(), rows = [], errors = [];
  got.forEach((g, i) => { if (g.status !== "fulfilled") { errors.push(`${tries[i][0]}：${g.reason?.message}`); return; }
    for (const r of g.value) { const k = r.date + r.code; if (!seen.has(k)) { seen.add(k); rows.push(r); } } });
  if (!rows.length && !cf.length) return res.status(200).json({ ok: false, error: `拿不到除權息預告（${errors.join("；") || "沒有資料"}）` });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");
  return res.status(200).json({ ok: true, source: "證交所、櫃買中心除權除息預告；法說會：公開資訊觀測站", rows, conf: cf, errors });
}
