// pr-guard workflow（#312 PR D）：只動自己管理的標籤與看板留言；workflow 權限最小、不用 pull_request_target、fork 不跑。全部用假資料，不連網路。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MANAGED, wantedLabels, planLabels, findBoard, boardBody, run } from "../scripts/pr-guard-run.mjs";
import { BOARD_MARK, formatBrief } from "../scripts/pr-guard.mjs";

const HEAD = "999920019e9a6af028af87fbfac816ab6f43627a";

test("pr-guard-run：標籤只加減 pr-guard 管理的，其他標籤不碰", () => {
  assert.deepEqual(planLabels(["bug", "high-risk", "needs-lock"], ["high-risk", "needs-390-1280"]), { add: ["needs-390-1280"], remove: ["needs-lock"] });
  assert.deepEqual(planLabels(["bug", "documentation"], []), { add: [], remove: [] }, "使用者自己貼的標籤不會被拿掉");
  assert.deepEqual(wantedLabels(["learner/watch.html"], [{ number: 2 }]), ["conflict-risk", "needs-390-1280", "needs-lock"]);
  assert.deepEqual(wantedLabels(["docs/a.md"], []), ["low-risk-candidate"]);
  for (const l of wantedLabels(["AGENTS.md", "learner/core.css", { filename: "tests/x.test.mjs", status: "removed" }], [{}])) assert.ok(l in MANAGED, l);
});

test("pr-guard-run：只認機器人貼的、帶記號的一般留言是看板；摘要不把看板自己算進 AI 留言", () => {
  const board = { id: 1, source: "comment", bot: true, body: `檢查（pr-guard）：\`${HEAD}\`\n${BOARD_MARK}` };
  assert.equal(findBoard([{ id: 2, source: "comment", bot: false, body: BOARD_MARK }, board]), board, "人貼的同記號留言不算");
  assert.equal(findBoard([{ id: 3, source: "review", bot: true, body: BOARD_MARK }]), null);
  const out = formatBrief({ pr: { number: 1, title: "t", head: { sha: HEAD, ref: "b" } }, files: ["docs/a.md"], comments: [board] });
  assert.match(out, /AI 留言：無/, "看板本身不列入");
  assert.doesNotMatch(out, /其他留言/);
});

test("pr-guard-run：其他留言依時間排序取最新；機器人的 review 保留、一般留言的機器人排除", () => {
  const comments = [
    ...Array.from({ length: 16 }, (_, i) => ({ id: 100 + i, source: "comment", created_at: `2026-01-${String(i + 1).padStart(2, "0")}`, body: `討論 ${i + 1}` })),
    { id: 7, source: "review", bot: true, created_at: "2026-02-01", body: "Copilot：這裡可能有空值" },
    { id: 8, source: "comment", bot: true, created_at: "2026-02-02", body: "[vc]: 部署預覽" },
  ];
  const out = formatBrief({ pr: { number: 1, title: "t", head: { sha: HEAD, ref: "b" } }, files: ["docs/a.md"], comments });
  assert.match(out, /其他留言（不是協作格式，請自行讀全文）：17 則/);
  assert.match(out, /（review）Copilot：這裡可能有空值/, "機器人送的 review 不能被濾掉");
  assert.doesNotMatch(out, /部署預覽/);
  assert.doesNotMatch(out, /討論 1｜/, "最舊的一則被截掉");
  assert.doesNotMatch(out, /討論 2｜/);
  assert.match(out, /討論 16｜/);
  assert.match(out, /較早的 2 則/);
});

function fake({ labels = [], boardBody: old = null, repoLabels = [] } = {}) {
  const fixtures = {
    "pulls/5": { number: 5, title: "改看盤", draft: false, labels: labels.map(name => ({ name })), head: { sha: HEAD, ref: "claude/x" } },
    "pulls/5/files": [{ filename: "learner/watch.html", status: "modified" }],
    "issues/5/comments": old ? [{ id: 900, user: { type: "Bot" }, created_at: "t", body: old }] : [],
    "pulls/5/reviews": [], "pulls/5/comments": [],
    [`commits/${HEAD}/check-runs`]: { check_runs: [] },
    "pulls?state=open": [{ number: 5 }],
  };
  const get = p => { const k = p.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, ""); assert.ok(k in fixtures, k); return fixtures[k]; };
  const calls = [];
  const write = (method, path, body) => {
    calls.push([method, path.replace(/^repos\/o\/r\//, ""), body]);
    if (method === "GET" && !repoLabels.some(l => path.endsWith(`/labels/${encodeURIComponent(l)}`))) throw new Error("404");
    return "{}";
  };
  return { get, write, calls };
}

test("pr-guard-run：第一次跑會建立缺少的標籤、貼標籤、新增看板留言", async () => {
  const f = fake({ repoLabels: ["needs-lock"] });
  await run(5, { get: f.get, write: f.write, repo: "o/r", log: () => {} });
  const m = f.calls.map(([method, path]) => `${method} ${path}`);
  assert.ok(m.includes("POST labels"), "沒有的標籤要先建立");
  assert.ok(!f.calls.some(([method, path, body]) => method === "POST" && path === "labels" && body.name === "needs-lock"), "已存在的標籤不重建");
  const add = f.calls.find(([method, path]) => method === "POST" && path === "issues/5/labels");
  assert.deepEqual(add[2].labels, ["needs-390-1280", "needs-lock"]);
  const post = f.calls.find(([method, path]) => method === "POST" && path === "issues/5/comments");
  assert.match(post[2].body, /^檢查（pr-guard）：/);
  assert.ok(post[2].body.endsWith(BOARD_MARK));
  assert.ok(f.calls.every(([method, path]) => !/merges|pulls\/5\/merge|git\/refs|contents\//.test(path) || method === "GET"), "不合併、不推送、不改檔");
});

test("pr-guard-run：內容沒變就不更新留言；有變就原地更新同一則；拿掉不再適用的標籤", async () => {
  const first = fake();
  const body = boardBody(await (await import("../scripts/pr-brief.mjs")).collect(5, first.get, "o/r"));
  const same = fake({ labels: ["needs-390-1280", "needs-lock"], boardBody: body });
  await run(5, { get: same.get, write: same.write, repo: "o/r", log: () => {} });
  assert.deepEqual(same.calls, [], "什麼都不用做");
  const changed = fake({ labels: ["needs-390-1280", "needs-lock", "high-risk", "bug"], boardBody: `舊內容\n${BOARD_MARK}` });
  await run(5, { get: changed.get, write: changed.write, repo: "o/r", log: () => {} });
  const m = changed.calls.map(([method, path]) => `${method} ${path}`);
  assert.deepEqual(m, ["DELETE issues/5/labels/high-risk", "PATCH issues/comments/900"], "只拿掉 high-risk，bug 不碰；看板原地更新，不新增第二則");
});

test("pr-guard-run：--dry-run 不寫任何東西", async () => {
  const f = fake();
  const out = [];
  await run(5, { dry: true, get: f.get, write: f.write, repo: "o/r", log: s => out.push(s) });
  assert.deepEqual(f.calls, []);
  assert.match(out.join("\n"), /"add":\["needs-390-1280","needs-lock"\]/);
});

test("pr-guard workflow：權限最小、不用 pull_request_target、fork 與機器人留言不跑、會在 ci 結束後更新", () => {
  const y = readFileSync(new URL("../.github/workflows/pr-guard.yml", import.meta.url), "utf8");
  const code = y.split("\n").filter(l => !l.trimStart().startsWith("#")).join("\n");
  assert.doesNotMatch(code, /pull_request_target/, "不能用 pull_request_target");
  assert.match(code, /^permissions:\n  contents: read\n  pull-requests: write\n(?!  )/m, "權限只有 contents: read 與 pull-requests: write");
  assert.doesNotMatch(code, /secrets\./, "不碰密鑰");
  assert.match(code, /head\.repo\.full_name == github\.repository/, "fork 的 PR 不跑");
  assert.match(code, /comment\.user\.type != 'Bot'/, "機器人留言不觸發，避免自己叫自己");
  assert.match(code, /workflows: \[ci\]/);
  assert.match(code, /concurrency:/);
  assert.match(code, /node scripts\/pr-guard-run\.mjs \$PR_NUMBERS/, "PR 編號經環境變數傳入，不直接嵌進指令");
  assert.match(code, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/, "只執行預設分支的腳本，不執行 PR 改過的程式（有寫入權限）");
  assert.match(code, /persist-credentials: false/);
  for (const m of code.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} 要用 commit SHA 固定版本`);
});
