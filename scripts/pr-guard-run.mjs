// pr-guard workflow 用（#312 PR D）：node scripts/pr-guard-run.mjs <PR 編號>
// 讀 PR（scripts/pr-brief.mjs 的 collect，只讀）→ 依 scripts/pr-guard.mjs 判斷 → 同步 pr-guard 管理的標籤、原地更新一則狀態看板留言。
// 只動自己管理的標籤（MANAGED 裡的）與帶 BOARD_MARK 的機器人留言；不合併、不推送、不改程式。只是提醒，不擋合併。
// 本機也能跑（需要 gh 有寫入權限）；加 --dry-run 只印出會做什麼。
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { classify, bigFileConflicts, formatBrief, BOARD_MARK, isBoard, httpStatus } from "./pr-guard.mjs";
import { collect, ghGet } from "./pr-brief.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "kevinlf2904/taiex-monitor-app";

// pr-guard 管理的標籤：名稱、顏色、說明。不在這裡的標籤一律不碰
export const MANAGED = {
  "low-risk-candidate": ["0e8a16", "路徑都在低風險例外範圍（仍須合併者確認斷言沒放寬、CSS 只改規則）"],
  "high-risk": ["b60205", "協作規則、workflow、API、腳本、套件、部署、排程產物或策略回測績效：需獨立審查"],
  "needs-lock": ["fbca04", "改到大檔（watch.html、index.html、core.js、brief.js），先確認「鎖：」draft PR"],
  "conflict-risk": ["d93f0b", "和其他開著的 PR 改到同一個大檔"],
  "needs-390-1280": ["1d76db", "介面檔案：需要 390／1280 驗證"],
  "test-deletion": ["b60205", "刪除測試檔：不適用低風險例外，需人工審查"],
};

// 這個 PR 應該有哪些 pr-guard 標籤
export function wantedLabels(files, conflicts) {
  const w = new Set(classify(files).labels);
  if (conflicts.length) w.add("conflict-risk");
  return [...w].filter(l => l in MANAGED).sort();
}

// 目前標籤 → 要加哪些、要拿掉哪些（只動 MANAGED 裡的）
export function planLabels(current, wanted) {
  const cur = new Set(current), want = new Set(wanted);
  return {
    add: wanted.filter(l => !cur.has(l)),
    remove: current.filter(l => l in MANAGED && !want.has(l)),
  };
}

// 找到之前貼過的看板留言：一般留言、機器人帳號、帶記號（isBoard 已包含這三個條件）
export const findBoard = comments => comments.find(isBoard) || null;

// httpStatus 移到 scripts/pr-guard.mjs（pr-brief 也要用），這裡保留匯出
export { httpStatus };

export const boardBody = data => `${formatBrief(data)}\n\n---\n_pr-guard 自動產生，每次推送、留言、審查或 CI 結束時原地更新；只是提醒，不擋合併，判斷依據見 scripts/pr-guard.mjs。_\n${BOARD_MARK}`;

function gh(method, path, body) {
  const args = ["api", "-X", method, path];
  if (body) args.push("--input", "-");
  return execFileSync("gh", args, { encoding: "utf8", input: body ? JSON.stringify(body) : undefined, stdio: ["pipe", "pipe", "pipe"] });
}

export async function run(number, { dry = false, get = ghGet, write = gh, repo = REPO, log = console.log } = {}) {
  const data = await collect(number, get, repo);
  // 已關閉／已合併的 PR、fork 來的 PR 不寫任何東西（ci 在 PR 關閉後才跑完、本機手動執行時也一樣）
  if (data.pr.state && data.pr.state !== "open") { log(`#${number} 已${data.pr.merged_at ? "合併" : "關閉"}，略過`); return []; }
  // head.repo 為 null＝來源 fork 已刪除，一樣當成 fork 略過（#317 Antigravity P3）；假資料沒有 repo 欄位時照常處理
  if (data.pr.head && "repo" in data.pr.head && (!data.pr.head.repo || data.pr.head.repo.full_name !== repo)) { log(`#${number} 來自 fork（或來源已刪除），略過`); return []; }
  const conflicts = bigFileConflicts({ number, files: data.files }, data.others);
  const current = (data.pr.labels || []).map(l => l.name);
  const { add, remove } = planLabels(current, wantedLabels(data.files, conflicts));
  const body = boardBody(data);
  const old = findBoard(data.comments);
  const actions = [];
  for (const l of add) actions.push(["label+", l]);
  for (const l of remove) actions.push(["label-", l]);
  if (!old) actions.push(["comment+"]);
  else if (old.body.trim() !== body.trim()) actions.push(["comment~", old.id]);
  if (dry) { log(JSON.stringify({ number, add, remove, comment: actions.find(a => a[0].startsWith("comment"))?.[0] || "不變" })); log(body); return actions; }
  // 冪等：標籤不存在（404）才建立；同時有別次執行先建好了（422）就當成功；要拿掉的標籤已經不在（404）也當成功。其他錯誤照常失敗
  const ok = (fn, ...codes) => { try { return fn(); } catch (e) { if (codes.includes(httpStatus(e))) return null; throw e; } };
  for (const l of add) {
    try { write("GET", `repos/${repo}/labels/${encodeURIComponent(l)}`); }
    catch (e) {
      if (httpStatus(e) !== 404) throw e;
      ok(() => write("POST", `repos/${repo}/labels`, { name: l, color: MANAGED[l][0], description: MANAGED[l][1] }), 422);
    }
  }
  if (add.length) write("POST", `repos/${repo}/issues/${number}/labels`, { labels: add });
  for (const l of remove) ok(() => write("DELETE", `repos/${repo}/issues/${number}/labels/${encodeURIComponent(l)}`), 404);
  if (!old) write("POST", `repos/${repo}/issues/${number}/comments`, { body });
  else if (old.body.trim() !== body.trim()) write("PATCH", `repos/${repo}/issues/comments/${old.id}`, { body });
  log(`#${number}：標籤 +[${add}] -[${remove}]；看板 ${old ? (old.body.trim() === body.trim() ? "不變" : "更新") : "新增"}`);
  return actions;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const nums = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const dry = process.argv.includes("--dry-run");
  if (!nums.length) { console.error("用法：node scripts/pr-guard-run.mjs <PR 編號…> [--dry-run]"); process.exit(2); }
  let failed = 0;
  for (const n of nums) {
    try { await run(n, { dry }); }
    catch (e) { failed++; console.error(`#${n} 失敗：${String(e.stderr || e.message || e).split("\n")[0]}`); }
  }
  process.exit(failed ? 1 : 0);
}
