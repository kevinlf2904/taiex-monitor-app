// 開工摘要（#312 PR B）：node scripts/pr-brief.mjs <PR 編號>
// 不能訂閱 PR 事件的 AI 開工時跑一行，就能看到最新 head SHA、CI test、風險標籤、大檔衝突，以及哪些 AI 留言是針對舊 SHA。
// 只讀不寫：用本機的 gh CLI 呼叫 GitHub REST API（GET），不留言、不貼標籤、不改任何東西。判斷邏輯在 scripts/pr-guard.mjs。
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { formatBrief, closingRefs } from "./pr-guard.mjs";

const REPO = process.env.PR_BRIEF_REPO || "kevinlf2904/taiex-monitor-app";

export function ghGet(path) {
  const out = execFileSync("gh", ["api", "-X", "GET", "--paginate", "--slurp", path], { encoding: "utf8", maxBuffer: 64 << 20 });
  const pages = JSON.parse(out);
  // --slurp 會把每一頁包成陣列：清單型的 API 把每頁接起來；物件型（例如 check-runs）只有一頁就回物件，多頁回各頁物件
  return Array.isArray(pages[0]) ? pages.flat() : pages.length === 1 ? pages[0] : pages;
}

// 機器人留言（Vercel 部署通知等）：GitHub 的 user.type 是 Bot
export const isBot = x => x?.user?.type === "Bot";

export async function collect(number, get = ghGet, repo = REPO) {
  const pr = get(`repos/${repo}/pulls/${number}`);
  const files = get(`repos/${repo}/pulls/${number}/files?per_page=100`);
  // AGENTS.md：開工要讀全部留言與審查——一般留言、review、行內審查留言三個來源都要讀
  const comments = [
    ...get(`repos/${repo}/issues/${number}/comments?per_page=100`).map(c => ({ id: c.id, created_at: c.created_at, body: c.body, bot: isBot(c), source: "comment" })),
    ...get(`repos/${repo}/pulls/${number}/reviews?per_page=100`).map(r => ({ id: r.id, created_at: r.submitted_at, body: r.body, commit_id: r.commit_id, bot: isBot(r), source: "review" })),
    ...get(`repos/${repo}/pulls/${number}/comments?per_page=100`).map(c => ({ id: c.id, created_at: c.created_at, body: c.body, commit_id: c.commit_id, path: c.path, bot: isBot(c), source: "inline" })),
  ];
  const checkRuns = [].concat(get(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`)).flatMap(p => p.check_runs || []);
  const open = get(`repos/${repo}/pulls?state=open&per_page=100`).filter(o => o.number !== pr.number);
  const others = open.map(o => ({ number: o.number, title: o.title, draft: o.draft, files: get(`repos/${repo}/pulls/${o.number}/files?per_page=100`) }));
  // 說明裡 Closes #N 的編號是否存在、是不是 PR（issues API 對 PR 也回資料，帶 pull_request 欄位）；查不到當成不存在
  const refs = closingRefs(pr.body).map(n => {
    try { const it = get(`repos/${repo}/issues/${n}`); return { number: n, exists: true, isPR: !!it?.pull_request }; }
    catch { return { number: n, exists: false, isPR: false }; }
  });
  return { pr, files, comments, checkRuns, others, refs };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const n = Number(process.argv[2]);
  if (!Number.isInteger(n) || n <= 0) { console.error("用法：node scripts/pr-brief.mjs <PR 編號>"); process.exit(2); }
  try { console.log(formatBrief(await collect(n))); }
  catch (e) { console.error(`讀不到 PR #${n}：${String(e.stderr || e.message || e).split("\n")[0]}`); process.exit(1); }
}
