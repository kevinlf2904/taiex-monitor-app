// 集保股權分散：集保結算所每週公布每檔股票各持股級距的人數與比例（開放資料 1-5「集保戶股權分散表」，只有最新一週）。
// 每週累積成 learner/data/tdcc/<代號前兩碼>.json，給看盤個股「籌碼」頁畫大戶、散戶持股比例的週變化。
// 每檔一列：[資料日期, 千張大戶%, 400 張以上%, 50 張以下%, 總人數, 千張大戶人數]，保留最近 52 週。
// 級距（股）：1＝1–999、2＝1,000–5,000 … 8＝40,001–50,000、12＝400,001–600,000、15＝1,000,001 以上、17＝合計。
//   --dump  只印出前幾列原始資料與整理結果，不寫檔

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../learner/data/tdcc/", import.meta.url));
const URL1 = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5", KEEP = 52, DUMP = process.argv.includes("--dump");
const isCode = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c);

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

export async function main() {
  const r = await fetch(URL1, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); const csv = await r.text();
  const { date, rows } = parseTdcc(csv); if (!date || !rows.size) throw new Error("集保資料解析不到：" + csv.slice(0, 200));
  console.log("資料日期", date, "共", rows.size, "檔");
  if (DUMP) { console.log(csv.split(/\r?\n/).slice(0, 20).join("\n")); console.log(JSON.stringify([...rows].slice(0, 5))); return; }
  await mkdir(DIR, { recursive: true });
  const by = new Map(); for (const [c, row] of rows) { const k = c.slice(0, 2); (by.get(k) || by.set(k, []).get(k)).push([c, row]); }
  for (const [k, L] of by) {
    let cur = {}; try { cur = JSON.parse(await readFile(`${DIR}${k}.json`, "utf8")); } catch {}
    for (const [c, row] of L) { const a = (cur[c] ||= []); const i = a.findIndex(x => x[0] === row[0]); if (i >= 0) a[i] = row; else a.push(row); a.sort((x, y) => x[0].localeCompare(y[0])); if (a.length > KEEP) a.splice(0, a.length - KEEP); }
    await writeFile(`${DIR}${k}.json`, JSON.stringify(cur));
  }
  await writeFile(`${DIR}meta.json`, JSON.stringify({ updated: new Date().toISOString(), date, count: rows.size, source: "集保結算所開放資料 1-5 集保戶股權分散表" }));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
