// 美股財報行事曆：每天兩次從 Nasdaq 整理過去、未來各兩週市值 50 億美元以上公司的財報（實際 EPS、預估、驚喜%），
// 存成 learner/data/us-earn.json，給情報局「財報 → 美股」。拿不到時保留原本的檔案，不讓排程失敗。
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildUsEarn } from "../api/_lib/usearn.js";

const OUT = fileURLToPath(new URL("../learner/data/us-earn.json", import.meta.url));
export async function main() {
  const v = await buildUsEarn(30000);
  if (!v.ok) { console.log("::warning::" + v.error + "，保留原本的資料"); return; }
  await writeFile(OUT, JSON.stringify(v));
  console.log("完成", v.rows.length, "筆", v.from, "～", v.to, v.errors ? `（${v.errors} 天沒抓到）` : "");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::美股財報這次沒有更新：" + e.message); });
