// 美股財報行事曆：每天兩次從 Nasdaq 整理過去、未來各兩週市值 50 億美元以上公司的財報（實際 EPS、預估、驚喜%），
// 存成 learner/data/us-earn.json，給情報局「財報 → 美股」。拿不到時保留原本的檔案，不讓排程失敗。
// 有 FINNHUB_API_KEY 時，市值 500 億美元以上的公司再問 Finnhub 營收實際值與預估（每列補 [10] 實際營收、[11] 預估營收，十億美元）。
// 已公布的財報另外累積到 learner/data/us-earn-hist.json（給「歷史驚喜紀錄」與公布後股價反應；Finnhub 免費版查不到過去的公布日，只能從排程開始記）。
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildUsEarn } from "../api/_lib/usearn.js";

const OUT = fileURLToPath(new URL("../learner/data/us-earn.json", import.meta.url)), HIST = fileURLToPath(new URL("../learner/data/us-earn-hist.json", import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms)), b2 = v => (v == null || !Number.isFinite(+v) || !+v ? null : Math.round(v / 1e7) / 100);
// Finnhub 的營收（美元）對到同一家公司、日期差 4 天內的那一列
export function addRevenue(rows, cal) {
  for (const r of rows) { const e = (cal[r[1]] || []).find(x => Math.abs(Date.parse(x.date) - Date.parse(r[0])) <= 4 * 864e5); if (e) { r[10] = b2(e.revenueActual); r[11] = b2(e.revenueEstimate); } }
  return rows;
}
// 已公布（有實際 EPS）的財報併進歷史，同一家公司同一天只留一筆，保留三年
export function mergeHist(old, rows, now = Date.now()) {
  const M = new Map((old?.rows || []).map(r => [r[0] + r[1], r]));
  for (const r of rows) if (r[4] != null) M.set(r[0] + r[1], [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[10] ?? null, r[11] ?? null]);
  const cut = new Date(now - 3 * 365 * 864e5).toISOString().slice(0, 10);
  return { updated: new Date(now).toISOString(), rows: [...M.values()].filter(r => r[0] >= cut).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])) };
}
async function finnhubCal(syms, from, to, key) {
  const out = {};
  for (const s of syms) { try { const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(s)}&from=${from}&to=${to}&token=${key}`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) out[s] = (await r.json())?.earningsCalendar || []; } catch {} await sleep(1100); } // 免費版每分鐘 60 次
  return out;
}
export async function main() {
  const v = await buildUsEarn(30000);
  if (!v.ok) { console.log("::warning::" + v.error + "，保留原本的資料"); return; }
  const key = process.env.FINNHUB_API_KEY;
  if (key) { const syms = [...new Set(v.rows.filter(r => r[3] >= 50).map(r => r[1]))]; addRevenue(v.rows, await finnhubCal(syms, v.from, v.to, key)); console.log("營收：問了", syms.length, "家，有營收", v.rows.filter(r => r[10] != null || r[11] != null).length, "筆"); }
  await writeFile(OUT, JSON.stringify(v));
  const old = await readFile(HIST, "utf8").then(JSON.parse).catch(() => null); await writeFile(HIST, JSON.stringify(mergeHist(old, v.rows)));
  console.log("完成", v.rows.length, "筆", v.from, "～", v.to, v.errors ? `（${v.errors} 天沒抓到）` : "");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::美股財報這次沒有更新：" + e.message); });
