// 總經數據：每天從 FRED 抓一次，存成 learner/data/macro.json，給看盤「大盤 → 總經」使用。
// FRED 會擋掉部分雲端主機（網站的 /api/macro 在 Vercel 上常逾時），所以改由 GitHub Actions 排程抓（.github/workflows/macro.yml）。
// 抓不到任何數列時保留原本的檔案，不讓排程失敗；只有幾個數列抓不到時，那幾個沿用上一次的資料（標 stale，資料日期照舊），不讓它們從畫面消失。
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildMacro } from "../api/_lib/macro.js";

const OUT = fileURLToPath(new URL("../learner/data/macro.json", import.meta.url));
// 這次沒抓到、上一次有的數列：沿用上一次的（標 stale）
export function keepMissing(v, old) {
  const have = new Set(v.series.map(x => x.id)), kept = (old?.series || []).filter(x => x?.id && !have.has(x.id)).map(x => ({ ...x, stale: true }));
  return kept.length ? { ...v, series: [...v.series, ...kept], kept: kept.map(x => x.id) } : v;
}
export async function main() {
  const v = await buildMacro(30000);
  if (!v.ok) { console.log("::warning::" + v.error + "，保留原本的資料"); return; }
  const old = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null), out = keepMissing(v, old);
  if (out.kept) console.log("沿用上一次的資料：" + out.kept.join("、"));
  await writeFile(OUT, JSON.stringify(out));
  console.log("完成", v.series.length, "個數列", v.notes.length ? "；拿不到：" + v.notes.join("；") : "");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::總經這次沒有更新：" + e.message); });
