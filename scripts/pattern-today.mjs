// 今日符合型態的個股：K線學堂的型態課（K 線型態、型態學、缺口）與錯題本下面列出「今天收盤出現這個型態」的真實個股。
// 在 .github/workflows/market-scan.yml 裡、全市場日 K 更新之後執行，用 .cache/allk.json（market-scan.mjs 剛接上今天）。
// 判斷用網站同一套程式（scripts/_engine.mjs 載入 learner/analysis.js 的 detectPattern、Signals.chartPat、Signals.gaps），課程範例圖上標的位置和這裡一致。
// 只看上市櫃股票（不含 00 開頭的 ETF）、今天成交 500 張以上；每個型態取成交值最大的 12 檔。
// 寫 learner/data/pattern-today.json：{ date, n: 掃了幾檔, hits: { 型態 id: [[代號, 名稱, 收盤, 漲跌%], …] } }
//   --dry  只印統計，不寫檔

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { engine } from "./_engine.mjs";

const CACHE = fileURLToPath(new URL("../.cache/allk.json", import.meta.url)), OUT = fileURLToPath(new URL("../learner/data/pattern-today.json", import.meta.url));
const TOP = 12, MIN_LOTS = 500;

// H 是全市場快取 { date, s: { 代號: { n, b: [{ d, o, h, l, c, v（張） }] } } }
export function patternHits(H, E = engine()) {
  const { Signals, detectPattern } = E.S, all = {}, date = H.date; let n = 0;
  for (const [c, s] of Object.entries(H.s || {})) {
    const D = s.b; if (!/^[1-9]\d{3}$/.test(c) || !D || D.length < 60) continue;
    const L = D.length - 1, x = D[L]; if (x.d !== date || !(x.v >= MIN_LOTS) || !D[L - 1]?.c) continue; n++;
    const ids = new Set(), I = E.indicators(D), id = detectPattern(D, L); if (id) ids.add(id);
    try { for (const m of Signals.chartPat(D, I)) if (m.i === L) ids.add(m.pat); } catch {}
    try { for (const m of Signals.gaps(D, I)) if (m.i === L) ids.add(m.pat); } catch {}
    for (const k of ids) (all[k] ||= []).push([c, s.n || c, x.c, +((x.c / D[L - 1].c - 1) * 100).toFixed(2), x.c * x.v]);
  }
  const hits = Object.fromEntries(Object.entries(all).map(([k, L]) => [k, L.sort((a, b) => b[4] - a[4]).slice(0, TOP).map(r => r.slice(0, 4))]));
  return { date, n, hits };
}

export async function main() {
  let H; try { H = JSON.parse(await readFile(CACHE, "utf8")); } catch { console.log("::warning::沒有全市場快取（.cache/allk.json），略過"); return; }
  const R = patternHits(H); console.log(R.date, "掃了", R.n, "檔；", Object.entries(R.hits).map(([k, L]) => `${k} ${L.length}`).join("、"));
  if (!R.n) { console.log("今天沒有資料（休市或還沒更新），不寫檔"); return; }
  if (!process.argv.includes("--dry")) await writeFile(OUT, JSON.stringify(R));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::今日型態沒有完成：" + e.message); process.exitCode = 0; });
