// 股價月新高／月新低用的歷史收盤：每檔最近 21 個交易日的收盤價（上市＋上櫃），寫進 learner/data/market/hilo.json。
// GitHub Actions 每個交易日收盤後跑（.github/workflows/market-hilo.yml）。/api/market 讀這個檔，
// 用「不含今天的前 20 個交易日」的最高／最低收盤，判斷今天（盤中即時）是不是創月新高、月新低。
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { closeToday } from "../api/_lib/daily.js";

const OUT = fileURLToPath(new URL("../learner/data/market/hilo.json", import.meta.url));
const N = 21, sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");

export async function main({ fetchDay = closeToday, now = Date.now(), gap = 2500 } = {}) {
  const old = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
  const cache = new Map((old?.days || []).map((d, i) => [d, Object.fromEntries(Object.entries(old.closes || {}).filter(([, a]) => a[i] != null).map(([c, a]) => [c, a[i]]))]));
  const days = [], maps = [];
  for (let k = 0; days.length < N && k < 45; k++) {
    const t = now - k * 864e5, d = ymd(t), wd = new Date(t + 8 * 3600e3).getUTCDay(); if (wd % 6 === 0) continue;
    let m = null;
    if (cache.has(d) && k > 1) m = cache.get(d); // 舊的日子不會再變，沿用；今天、昨天重抓
    else { try { const x = await fetchDay(d); if (x.size > 500) m = Object.fromEntries([...x].map(([c, q]) => [c, q.p])); } catch (e) { console.log(d, e.message); } await sleep(gap); }
    if (m && Object.keys(m).length > 500) { days.push(d); maps.push(m); console.log(d, Object.keys(m).length); }
  }
  if (days.length < 6) throw new Error(`只拿到 ${days.length} 天，資料不夠`);
  // 新到舊；每檔一列收盤（缺值放 null）
  const codes = [...new Set(maps.flatMap(m => Object.keys(m)))].sort();
  const closes = Object.fromEntries(codes.map(c => [c, maps.map(m => m[c] ?? null)]));
  const out = { updated: new Date(now).toISOString(), days, closes, cols: maps };
  await writeFile(OUT, JSON.stringify({ updated: out.updated, days, closes }));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok", o.days.length, "天", Object.keys(o.closes).length, "檔")).catch(e => { console.error(e); process.exit(1); });
