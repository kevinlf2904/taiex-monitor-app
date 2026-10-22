// 美股財報行事曆：每天兩次從 Nasdaq 整理過去、未來各兩週市值 50 億美元以上公司的財報（實際 EPS、預估、驚喜%），
// 存成 learner/data/us-earn.json，給情報局「財報 → 美股」。拿不到時保留原本的檔案，不讓排程失敗。
// 有 FINNHUB_API_KEY 時，市值 500 億美元以上的公司再問 Finnhub 營收實際值與預估（每列補 [10] 實際營收、[11] 預估營收，十億美元）。
// 最近 10 天公布、市值 200 億美元以上的公司再看英文新聞標題判斷財測上修／下修（[12] 1／-1／0、[13] 依據的標題）。
// 已公布的財報另外累積到 learner/data/us-earn-hist.json（給「歷史驚喜紀錄」與公布後股價反應）；手動執行時填 back 可以從 Nasdaq 補更早的歷史。
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildUsEarn } from "../api/_lib/usearn.js";
import { parseRss } from "../api/_lib/news.js";

const OUT = fileURLToPath(new URL("../learner/data/us-earn.json", import.meta.url)), HIST = fileURLToPath(new URL("../learner/data/us-earn-hist.json", import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms)), b2 = v => (v == null || !Number.isFinite(+v) || !+v ? null : Math.round(v / 1e7) / 100);
// Finnhub 的營收（美元）對到同一家公司、日期差 4 天內的那一列
export function addRevenue(rows, cal) {
  for (const r of rows) { const e = (cal[r[1]] || []).find(x => Math.abs(Date.parse(x.date) - Date.parse(r[0])) <= 4 * 864e5); if (e) { r[10] = b2(e.revenueActual); r[11] = b2(e.revenueEstimate); } }
  return rows;
}
// 財測：公布後的英文新聞標題有沒有寫上修／下修（Google 新聞）。回 { g: 1 上修／-1 下修／0 維持／null 看不出來, t: 依據的標題 }
const G_ON = /\b(guidance|outlook|forecasts?|projections?|full-year|fy\d{2,4}|sees|expects)\b/i;
const G_UP = /\b(rais(e|es|ed|ing)|lift(s|ed)?|boost(s|ed)?|hik(e|es|ed)|increas(e|es|ed)|upbeat|strong(er)?|above|tops?|better[- ]than|upgrades?|huge|robust|solid|bullish|record)\b/i;
const G_DN = /\b(cut(s|ting)?|lower(s|ed)?|slash(es|ed)?|reduc(e|es|ed)|weak(er)?|below|disappoint(s|ing)?|soft(er)?|warn(s|ed)?|trim(s|med)?|downbeat|miss(es)?|reduced|gloomy|sluggish)\b/i;
const G_KEEP = /\b(reaffirm(s|ed)?|maintain(s|ed)?|reiterat(e|es|ed)|in line|unchanged)\b/i;
export function guideOf(titles) {
  let up = 0, dn = 0, keep = 0, tu = "", td = "", tk = "";
  for (const t of titles) { if (!G_ON.test(t)) continue; const u = G_UP.test(t), d = G_DN.test(t);
    if (u && !d) { up++; tu ||= t; } else if (d && !u) { dn++; td ||= t; } else if (G_KEEP.test(t)) { keep++; tk ||= t; } }
  return up > dn ? { g: 1, t: tu } : dn > up ? { g: -1, t: td } : keep ? { g: 0, t: tk } : { g: null, t: "" };
}
async function guidance(rows, days = 10) {
  const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); let n = 0;
  for (const r of rows) { if (r[4] == null || r[3] < 20 || r[0] < cut) continue;
    try { const x = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`${r[1]} guidance OR outlook OR forecast when:10d`)}&hl=en-US&gl=US&ceid=US:en`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
      if (x.ok) { const G = guideOf(parseRss(await x.text(), 20).filter(it => !it.at || it.at >= Date.parse(r[0]) - 864e5).map(it => it.title)); r[12] = G.g; r[13] = G.t.slice(0, 160); n++; } } catch {}
    await sleep(400); }
  return n;
}
// 已公布（有實際 EPS）的財報併進歷史，同一家公司同一天只留一筆，保留三年
export function mergeHist(old, rows, now = Date.now()) {
  const M = new Map((old?.rows || []).map(r => [r[0] + r[1], r]));
  for (const r of rows) if (r[4] != null) M.set(r[0] + r[1], [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[10] ?? null, r[11] ?? null, r[12] ?? M.get(r[0] + r[1])?.[10] ?? null]);
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
  // BACK：往回抓幾天（手動執行時可以填 400 補一年多的歷史）；行事曆檔只留最近兩週，更早的只併進歷史
  const back = Math.min(1100, Math.max(14, +process.env.BACK || 14)), all = await buildUsEarn(30000, back), cut = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  if (!all.ok) { console.log("::warning::" + all.error + "，保留原本的資料"); return; }
  const v = { ...all, from: all.from < cut ? cut : all.from, rows: all.rows.filter(r => r[0] >= cut) };
  const key = process.env.FINNHUB_API_KEY;
  if (key) { const syms = [...new Set(v.rows.filter(r => r[3] >= 50).map(r => r[1]))]; addRevenue(v.rows, await finnhubCal(syms, v.from, v.to, key)); console.log("營收：問了", syms.length, "家，有營收", v.rows.filter(r => r[10] != null || r[11] != null).length, "筆"); }
  if (!process.env.NO_GUIDE) console.log("財測：查了", await guidance(v.rows), "家，上修", v.rows.filter(r => r[12] === 1).length, "、下修", v.rows.filter(r => r[12] === -1).length);
  await writeFile(OUT, JSON.stringify(v));
  const old = await readFile(HIST, "utf8").then(JSON.parse).catch(() => null); await writeFile(HIST, JSON.stringify(mergeHist(old, [...all.rows.filter(r => r[0] < cut), ...v.rows])));
  console.log("完成", v.rows.length, "筆", v.from, "～", v.to, back > 14 ? `；歷史補到 ${all.from}（${all.rows.length - v.rows.length} 筆）` : "", all.errors ? `（${all.errors} 天沒抓到）` : "");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::美股財報這次沒有更新：" + e.message); });
