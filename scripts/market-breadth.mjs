// 漲跌家數歷史：每個交易日上市、上櫃各有幾檔上漲、下跌（ADR 漲跌比、OBOS 超買超賣、ADL 騰落線用），寫進 learner/data/market/breadth.json。
// GitHub Actions 每個交易日收盤後跑（.github/workflows/market-breadth.yml）。舊的日子不會再變，沿用；一次最多補抓 MAX_NEW 天，慢慢往前補到 KEEP 天。
// 格式：{ updated, cols: ["d", "上市漲", "上市跌", "上櫃漲", "上櫃跌"], rows: [["2026-10-08", 520, 410, 400, 380], ...]（舊到新）}
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { closeToday } from "../api/_lib/daily.js";

const OUT = fileURLToPath(new URL("../learner/data/market/breadth.json", import.meta.url));
const KEEP = 260, MAX_NEW = 70, sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);

// 一天的漲跌家數：pct > 0 算上漲、< 0 算下跌（平盤不算）
export function countDay(m) {
  const n = { tw: [0, 0], otc: [0, 0] };
  for (const q of m.values()) { const k = q.market === "上櫃" ? "otc" : "tw"; if (q.pct > 0) n[k][0]++; else if (q.pct < 0) n[k][1]++; }
  return n;
}
export async function main({ fetchDay = closeToday, now = Date.now(), gap = 2500 } = {}) {
  const old = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
  const have = new Map((old?.rows || []).map(r => [r[0], r])), holes = new Set(old?.holes || []); // holes：沒開盤的平日（國定假日），不用每次再問
  let fetched = 0, wdays = 0;
  for (let k = 0; wdays < KEEP && fetched < MAX_NEW; k++) {
    const t = now - k * 864e5, d = ymd(t), wd = new Date(t + 8 * 3600e3).getUTCDay(); if (wd % 6 === 0) continue;
    wdays++;
    if ((have.has(d) || holes.has(d)) && k > 1) continue; // 今天、昨天重抓（櫃買資料比較晚出來）
    try { const m = await fetchDay(d.replace(/-/g, "")); if (m.size > 500) { const n = countDay(m); have.set(d, [d, n.tw[0], n.tw[1], n.otc[0], n.otc[1]]); holes.delete(d); console.log(d, n); } else if (k > 1 && m.size === 0) holes.add(d); }
    catch (e) { console.log(d, e.message); }
    fetched++; await sleep(gap);
  }
  const rows = [...have.values()].sort((a, b) => a[0].localeCompare(b[0])).slice(-KEEP);
  if (rows.length < 5) throw new Error(`只拿到 ${rows.length} 天，資料不夠`);
  const out = { updated: new Date(now).toISOString(), cols: ["d", "上市漲", "上市跌", "上櫃漲", "上櫃跌"], rows, holes: [...holes].filter(d => d >= rows[0][0]).sort() };
  await writeFile(OUT, JSON.stringify(out));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok", o.rows.length, "天")).catch(e => { console.error(e); process.exit(1); });
