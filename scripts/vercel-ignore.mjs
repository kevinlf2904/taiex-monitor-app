// Vercel「Ignored Build Step」（vercel.json 的 ignoreCommand）：結束碼 0＝略過這次部署，1＝照常部署。
// 排程每天往 main 寫幾十次 learner/data/，網頁與 API 已改從 GitHub 讀最新資料（learner/datasrc.js、api/_lib/market.js），
// 所以「從上次成功部署到現在只改了 learner/data/」的提交不用重新部署。只要有一個檔案不是 learner/data/、或判斷不了（沒有上次部署的 SHA、
// 抓不到上次部署的提交），就照常部署，寧可多部署也不漏。
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// 檔案清單是不是全部都在 learner/data/ 底下（空清單不算：沒有變動時照常部署，交給 Vercel 判斷）
export const dataOnly = files => files.length > 0 && files.every(f => f.startsWith("learner/data/"));

// 錯誤訊息只留第一行、把網址遮掉（遠端網址可能帶權杖），寫進建置紀錄方便查原因
export const errLine = e => String(e?.stderr || e?.message || e).split("\n").map(s => s.trim()).find(Boolean)?.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<網址>").slice(0, 160) || "未知錯誤";

// Vercel 是淺層 clone（只有最近幾個提交）：上次成功部署的提交常常不在歷史裡（11/12 的建置紀錄：fatal: bad object，照常部署了 4 次只改資料的提交）。
// 依序試著把那個提交抓下來，抓到一次就能比：
//   1. 從 origin 直接抓那個提交（--depth=1 只要它的檔案樹，兩個提交比檔案差異不需要共同祖先）
//   2. origin 不能用時，改從公開的 GitHub 網址抓（repo 公開，不需要權杖）
//   3. 舊做法：往前多抓 200 個提交
export function fetchPlans(prev, env = process.env) {
  const plans = [["fetch", "--quiet", "--no-tags", "--depth=1", "origin", prev]];
  const { VERCEL_GIT_PROVIDER: p, VERCEL_GIT_REPO_OWNER: o, VERCEL_GIT_REPO_SLUG: s } = env;
  if (p === "github" && /^[\w.-]+$/.test(o || "") && /^[\w.-]+$/.test(s || "")) plans.push(["fetch", "--quiet", "--no-tags", "--depth=1", `https://github.com/${o}/${s}.git`, prev]);
  plans.push(["fetch", "--quiet", "--deepen=200"]);
  return plans;
}

export function decide({ prev = process.env.VERCEL_GIT_PREVIOUS_SHA, head = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD", env = process.env, git = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }) } = {}) {
  if (!prev) return { skip: false, why: "沒有上次部署的 SHA" };
  if (!/^[0-9a-f]{7,40}$/i.test(prev)) return { skip: false, why: "上次部署的 SHA 格式不對" };
  const diff = () => git(["diff", "--name-only", prev, head]).split("\n").map(s => s.trim()).filter(Boolean);
  let files = null; const tried = [];
  try { files = diff(); }
  catch (e) {
    tried.push(`比對：${errLine(e)}`);
    for (const plan of fetchPlans(prev, env)) {
      try { git(plan); files = diff(); break; }
      catch (e2) { tried.push(`${plan.includes("--deepen=200") ? "往前抓 200 個" : plan[4] === "origin" ? "從 origin 抓" : "從 GitHub 抓"}：${errLine(e2)}`); }
    }
  }
  if (!files) return { skip: false, why: `抓不到上次部署的提交，比不出差異（${tried.join("；")}）` };
  return dataOnly(files) ? { skip: true, why: `只改排程資料（${files.length} 個檔）` } : { skip: false, why: `有 ${files.filter(f => !f.startsWith("learner/data/")).length} 個非資料檔` };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const r = decide();
  console.log(`vercel-ignore：${r.skip ? "略過部署" : "照常部署"}（${r.why}）`);
  process.exit(r.skip ? 0 : 1);
}
