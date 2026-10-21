// 美股財報行事曆：給 learner/watch.html 情報局「財報 → 美股」。
// GET /api/usearn → { ok, at, from, to, rows: [[日期, 代號, 名稱, 市值(十億美元), 實際EPS, 預估EPS, 驚喜%, 時段, 財報季, 去年同期EPS]] }
// 來源：Nasdaq 公開財報行事曆（每天一頁，過去的日子有實際 EPS 與驚喜%，未來的日子有預估與去年同期）。只留市值 50 億美元以上的公司。
// 排程（scripts/us-earn.mjs）每天整理兩次存成 learner/data/us-earn.json，網站讀不到檔案時才即時問這裡。
import { usName } from "./_yahoo.js";

const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" };
const money = v => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; }; // "$1.13"、"($0.25)" 是負數
const eps = v => { const s = String(v ?? "").trim(); if (!s || /N\/A/i.test(s)) return null; const n = money(s.replace(/[()]/g, "")); return n == null ? null : /^\(/.test(s) ? -n : n; };
const TIME = { "time-pre-market": "盤前", "time-after-hours": "盤後" };
// 驚喜% 只用 Nasdaq 給的：剛公布、還沒標驚喜的那幾小時，eps 欄有時是 GAAP 數字，和預估（調整後 EPS）口徑不同，自己換算會失真
export function parseDay(date, rows) {
  return (Array.isArray(rows) ? rows : []).map(r => { const cap = money(r.marketCap); if (!r.symbol || cap == null || cap < 5e9) return null; const a = eps(r.eps), f = eps(r.epsForecast), sp = parseFloat(r.surprise);
    return [date, String(r.symbol).trim(), usName(String(r.symbol).trim(), String(r.name || "").replace(/\s*\(The\)$/, "").trim()), Math.round(cap / 1e8) / 10, a, f, Number.isFinite(sp) ? sp : null, TIME[r.time] || "", String(r.fiscalQuarterEnding || ""), eps(r.lastYearEPS)]; }).filter(Boolean);
}
// 過去 back 天到未來 ahead 天（跳過週末），每天一頁，同時最多 5 個請求
export async function buildUsEarn(ms = 15000, back = 14, ahead = 14) {
  const days = []; for (let i = -back; i <= ahead; i++) { const d = new Date(Date.now() + i * 864e5); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); }
  const out = [], errs = []; let k = 0;
  await Promise.all(Array.from({ length: 5 }, async () => { while (k < days.length) { const day = days[k++];
    try { const r = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${day}`, { headers: H, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const j = await r.json(); out.push(...parseDay(day, j?.data?.rows)); }
    catch (e) { errs.push(`${day} ${e.message}`); } } }));
  if (!out.length) return { ok: false, error: `拿不到美股財報行事曆（${errs[0] || "沒有資料"}）` };
  out.sort((a, b) => a[0].localeCompare(b[0]) || b[3] - a[3]);
  return { ok: true, source: "Nasdaq 財報行事曆", at: new Date().toISOString(), from: days[0], to: days.at(-1), rows: out, errors: errs.length };
}
export default async function handler(req, res) {
  const v = await buildUsEarn(9000);
  if (v.ok) res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");
  return res.status(200).json(v);
}
