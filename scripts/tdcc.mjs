// 集保股權分散：集保結算所每週公布每檔股票各持股級距的人數與比例（開放資料 1-5「集保戶股權分散表」，只有最新一週）。
// 每週累積成 learner/data/tdcc/<代號前兩碼>.json，給看盤個股「籌碼」頁畫大戶、散戶持股比例的週變化。
// 每檔一列：[資料日期, 千張大戶%, 400 張以上%, 50 張以下%, 總人數, 千張大戶人數]，保留最近 156 週（約 3 年）。
// rank.json：千張大戶持股比例本週、4／13／26／52 週變化最多、最少各 50 檔（大戶國會「千張大戶」的期間選擇）。
// 級距（股）：1＝1–999、2＝1,000–5,000 … 8＝40,001–50,000、12＝400,001–600,000、15＝1,000,001 以上、17＝合計。
//   --dump  只印出前幾列原始資料與整理結果，不寫檔
//   --backfill N [--minutes M]  補歷史：從集保網站（只保留最近一年）補 N 檔歷史最短的股票，最多跑 M 分鐘（預設 40）；每週排程也會順便補一些

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tdccWeeks } from "../api/_lib/tdcc.js";

const DIR = fileURLToPath(new URL("../learner/data/tdcc/", import.meta.url));
const URL1 = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5", KEEP = 156, DUMP = process.argv.includes("--dump");
const isCode = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c) && !/^000/.test(c); // 000 開頭是債券等，不是股票

// CSV → { date, rows: Map(code → [date, p1000, p400, p50, people, people1000]) }
export function parseTdcc(csv) {
  const lines = String(csv).replace(/^﻿/, "").split(/\r?\n/).filter(Boolean), out = new Map(); let date = null;
  for (const ln of lines.slice(1)) {
    const f = ln.split(",").map(s => s.replace(/"/g, "").trim()); if (f.length < 6) continue;
    const [d, code, lv, people, , pct] = f, L = +lv; if (!isCode(code) || !(L >= 1)) continue;
    date ||= /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null;
    const g = out.get(code) || out.set(code, { p1000: 0, p400: 0, p50: 0, people: 0, n1000: 0 }).get(code), p = +pct || 0, n = +people || 0;
    if (L === 15) { g.p1000 += p; g.n1000 += n; } if (L >= 12 && L <= 15) g.p400 += p; if (L <= 8) g.p50 += p; if (L === 17) g.people = n;
  }
  const rows = new Map(); for (const [c, g] of out) rows.set(c, [date, +g.p1000.toFixed(2), +g.p400.toFixed(2), +g.p50.toFixed(2), g.people, g.n1000]);
  return { date, rows };
}

// 一檔的週資料加一列（同一天就取代），依日期排序、只留 KEEP 週
export function addRow(a, row) { const i = a.findIndex(x => x[0] === row[0]); if (i >= 0) a[i] = row; else a.push(row); a.sort((x, y) => x[0].localeCompare(y[0])); if (a.length > KEEP) a.splice(0, a.length - KEEP); return a; }
// 排行：每檔最新一週和 n 週前（找不到剛好那週就用最接近、差不到 10 天的）比；[代號, 千張變化, 千張%, 50 張以下變化, 總人數變化]
export const PERIODS = [1, 4, 13, 26, 52];
export function rankOf(all, date, n) {
  const target = Date.parse(date) - n * 7 * 864e5, chg = []; let from = null;
  for (const [c, a] of all) {
    const q = a[a.length - 1]; if (!q || q[0] !== date || !(q[4] >= 100)) continue;
    let p = null; if (n === 1) p = a[a.length - 2]; else for (let i = a.length - 2, best = 10.5 * 864e5; i >= 0; i--) { const gap = Math.abs(Date.parse(a[i][0]) - target); if (gap < best) { best = gap; p = a[i]; } if (Date.parse(a[i][0]) < target - 10 * 864e5) break; }
    if (!p) continue; if (!from || p[0] < from) from = p[0];
    chg.push([c, +(q[1] - p[1]).toFixed(2), q[1], +(q[3] - p[3]).toFixed(2), q[4] - p[4]]);
  }
  chg.sort((x, y) => y[1] - x[1]);
  return chg.length ? { from, n: chg.length, up: chg.slice(0, 50), down: chg.slice(-50).reverse() } : null;
}
async function loadAll() { const by = new Map(); for (const f of (await readdir(DIR).catch(() => []))) if (/^\d{2}\.json$/.test(f)) { try { by.set(f.slice(0, 2), JSON.parse(await readFile(DIR + f, "utf8"))); } catch {} } return by; }
// 補歷史：歷史最短的 N 檔（同樣短就先補股東人數多的），從集保網站查網站上有、資料裡沒有的週次
async function backfill(by, n, minutes) {
  const tried = JSON.parse(await readFile(`${DIR}bf.json`, "utf8").catch(() => "{}")), soon = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10); // 查過但網站也沒有更早資料的（新上市…），30 天內不再查
  const t0 = Date.now(), L = [...by.values()].flatMap(o => Object.entries(o)).filter(([c, a]) => isCode(c) && a.length && a.length < 50 && !(tried[c] > soon)).sort((x, y) => x[1].length - y[1].length || (y[1].at(-1)[4] || 0) - (x[1].at(-1)[4] || 0)).slice(0, n);
  let done = 0, rows = 0;
  for (const [c, a] of L) {
    if (Date.now() - t0 > minutes * 60e3) { console.log(`補歷史：時間到，先補到這裡（${done}／${L.length} 檔）`); break; }
    try { const r = await tdccWeeks(c, { to: new Date(Date.parse(a[0][0]) - 864e5).toISOString().slice(0, 10) }); for (const row of r.rows) addRow(a, row); rows += r.rows.length; tried[c] = new Date().toISOString().slice(0, 10); } catch (e) { console.log(`  ${c} 失敗：${e.message}`); }
    done++; if (done % 25 === 0) console.log(`補歷史：${done}／${L.length} 檔，新增 ${rows} 週`);
  }
  await writeFile(`${DIR}bf.json`, JSON.stringify(tried));
  console.log(`補歷史完成：${done} 檔、新增 ${rows} 週`);
}
export async function main() {
  const bi = process.argv.indexOf("--backfill"), BF = bi > 0 ? +process.argv[bi + 1] || 0 : 60, mi = process.argv.indexOf("--minutes"), MIN = mi > 0 ? +process.argv[mi + 1] || 40 : 10;
  const r = await fetch(URL1, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); const csv = await r.text();
  const { date, rows } = parseTdcc(csv); if (!date || !rows.size) throw new Error("集保資料解析不到：" + csv.slice(0, 200));
  console.log("資料日期", date, "共", rows.size, "檔");
  if (DUMP) { console.log(csv.split(/\r?\n/).slice(0, 20).join("\n")); console.log(JSON.stringify([...rows].slice(0, 5))); return; }
  await mkdir(DIR, { recursive: true });
  const by = await loadAll();
  for (const [c, row] of rows) { const k = c.slice(0, 2), o = by.get(k) || by.set(k, {}).get(k); addRow((o[c] ||= []), row); }
  if (BF > 0) await backfill(by, BF, MIN);
  for (const [k, o] of by) await writeFile(`${DIR}${k}.json`, JSON.stringify(o));
  // 大戶動向排行：千張大戶持股比例變化（百分點）最多、最少各 50 檔；本週的放最上層（舊格式），4／13／26／52 週放 per
  const all = [...by.values()].flatMap(o => Object.entries(o)), per = {};
  for (const n of PERIODS) { const x = rankOf(all, date, n); if (x) per[n] = x; }
  const dates = [...new Set(all.flatMap(([, a]) => a.map(x => x[0])))].sort().reverse().slice(0, KEEP);
  await writeFile(`${DIR}rank.json`, JSON.stringify({ date, ...(per[1] || { up: [], down: [], n: 0 }), per, dates, shards: [...by.keys()].sort() }));
  await writeFile(`${DIR}meta.json`, JSON.stringify({ updated: new Date().toISOString(), date, count: rows.size, first: dates.at(-1), source: "集保結算所開放資料 1-5 集保戶股權分散表；更早的週次由集保網站查詢補齊" }));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
