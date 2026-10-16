// 總經數據：每天從 FRED 抓一次，存成 learner/data/macro.json，給看盤「大盤 → 總經」使用。
// FRED 會擋掉部分雲端主機（網站的 /api/macro 在 Vercel 上常逾時），所以改由 GitHub Actions 排程抓（.github/workflows/macro.yml）。
// 抓不到任何數列時保留原本的檔案，不讓排程失敗。
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildMacro } from "../api/_lib/macro.js";

const OUT = fileURLToPath(new URL("../learner/data/macro.json", import.meta.url));
export async function main() {
  const v = await buildMacro(30000);
  if (!v.ok) { console.log("::warning::" + v.error + "，保留原本的資料"); return; }
  await writeFile(OUT, JSON.stringify(v));
  console.log("完成", v.series.length, "個數列", v.notes.length ? "；拿不到：" + v.notes.join("；") : "");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::總經這次沒有更新：" + e.message); });
