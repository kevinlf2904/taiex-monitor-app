// Vercel「Ignored Build Step」（vercel.json 的 ignoreCommand）：結束碼 0＝略過這次部署，1＝照常部署。
// 排程每天往 main 寫幾十次 learner/data/，網頁與 API 已改從 GitHub 讀最新資料（learner/datasrc.js、api/_lib/market.js），
// 所以「從上次成功部署到現在只改了 learner/data/」的提交不用重新部署。只要有一個檔案不是 learner/data/、或判斷不了（沒有上次部署的 SHA、
// git 歷史不夠深），就照常部署，寧可多部署也不漏。
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// 檔案清單是不是全部都在 learner/data/ 底下（空清單不算：沒有變動時照常部署，交給 Vercel 判斷）
export const dataOnly = files => files.length > 0 && files.every(f => f.startsWith("learner/data/"));

export function decide({ prev = process.env.VERCEL_GIT_PREVIOUS_SHA, head = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD", git = args => execFileSync("git", args, { encoding: "utf8" }) } = {}) {
  if (!prev) return { skip: false, why: "沒有上次部署的 SHA" };
  // Vercel 是淺層 clone（大約最近 10 個提交）：連續略過好幾次後，上次部署的提交可能不在歷史裡，先往前多抓一些再比一次
  const diff = () => git(["diff", "--name-only", prev, head]).split("\n").map(s => s.trim()).filter(Boolean);
  let files;
  try { files = diff(); }
  catch {
    try { git(["fetch", "--quiet", "--deepen=200"]); files = diff(); }
    catch { return { skip: false, why: "git 歷史不夠深，比不出差異" }; }
  }
  return dataOnly(files) ? { skip: true, why: `只改排程資料（${files.length} 個檔）` } : { skip: false, why: `有 ${files.filter(f => !f.startsWith("learner/data/")).length} 個非資料檔` };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const r = decide();
  console.log(`vercel-ignore：${r.skip ? "略過部署" : "照常部署"}（${r.why}）`);
  process.exit(r.skip ? 0 : 1);
}
