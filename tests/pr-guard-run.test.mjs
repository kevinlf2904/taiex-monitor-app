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

function fake({ labels = [], boardBody: old = null, repoLabels = [], pr = {}, fail = {} } = {}) {
  const fixtures = {
    "pulls/5": { number: 5, title: "改看盤", draft: false, labels: labels.map(name => ({ name })), head: { sha: HEAD, ref: "claude/x" }, ...pr },
    "pulls/5/files": [{ filename: "learner/watch.html", status: "modified" }],
    "issues/5/comments": old ? [{ id: 900, user: { type: "Bot" }, created_at: "t", body: old }] : [],
    "pulls/5/reviews": [], "pulls/5/comments": [],
    [`commits/${HEAD}/check-runs`]: { check_runs: [] },
    "pulls?state=open": [{ number: 5 }],
  };
  const get = p => { const k = p.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, ""); assert.ok(k in fixtures, k); return fixtures[k]; };
  const calls = [];
  const write = (method, path, body) => {
    const p = path.replace(/^repos\/o\/r\//, "");
    calls.push([method, p, body]);
    const f = fail[`${method} ${p}`];
    if (f) throw Object.assign(new Error("gh: failed"), { stderr: `gh: Something (HTTP ${f})` });
    if (method === "GET" && !repoLabels.some(l => path.endsWith(`/labels/${encodeURIComponent(l)}`))) throw Object.assign(new Error("gh"), { stderr: "gh: Not Found (HTTP 404)" });
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

test("pr-guard-run：已關閉、已合併、fork 來的 PR 不寫任何東西", async () => {
  for (const pr of [{ state: "closed" }, { state: "closed", merged_at: "t" }, { state: "open", head: { sha: HEAD, ref: "x", repo: { full_name: "someone/fork" } } }, { state: "open", head: { sha: HEAD, ref: "x", repo: null } }]) {
    const f = fake({ pr });
    const out = [];
    await run(5, { get: f.get, write: f.write, repo: "o/r", log: s => out.push(s) });
    assert.deepEqual(f.calls, [], JSON.stringify(pr));
    assert.match(out.join(), /略過/);
  }
  const same = fake({ pr: { state: "open", head: { sha: HEAD, ref: "x", repo: { full_name: "o/r" } } } });
  await run(5, { get: same.get, write: same.write, repo: "o/r", log: () => {} });
  assert.ok(same.calls.length > 0, "同 repo 的 open PR 照常處理");
});

test("pr-guard-run：標籤 API 冪等：別人先建好（422）、要拿掉的已不在（404）當成功；其他錯誤照常失敗", async () => {
  const race = fake({ fail: { "POST labels": 422 } });
  await run(5, { get: race.get, write: race.write, repo: "o/r", log: () => {} });
  assert.ok(race.calls.some(([m, p]) => m === "POST" && p === "issues/5/comments"), "422 之後照樣貼標籤、發看板");
  const gone = fake({ labels: ["needs-390-1280", "needs-lock", "high-risk"], fail: { "DELETE issues/5/labels/high-risk": 404 } });
  await run(5, { get: gone.get, write: gone.write, repo: "o/r", log: () => {} });
  assert.ok(gone.calls.some(([m]) => m === "POST"), "404 之後照樣發看板");
  const down = fake({ fail: { "GET labels/needs-390-1280": 500 } });
  await assert.rejects(run(5, { get: down.get, write: down.write, repo: "o/r", log: () => {} }), e => /HTTP 500/.test(e.stderr), "500 不能當成標籤不存在去建立");
  assert.ok(!down.calls.some(([m, p]) => m === "POST" && p === "labels"));
});

test("pr-guard-run：人寫的留言提到看板記號也不會被藏起來", () => {
  const human = { id: 9, source: "comment", bot: false, created_at: "t", body: `審查（ChatGPT）：\`${HEAD}\` 可以合併\n看板記號是 ${BOARD_MARK}` };
  const review = { id: 10, source: "review", bot: false, created_at: "t2", body: `備註：${BOARD_MARK}` };
  const out = formatBrief({ pr: { number: 1, title: "t", head: { sha: HEAD, ref: "b" } }, files: ["docs/a.md"], comments: [human, review] });
  assert.match(out, /〔最新〕審查（ChatGPT） 可以合併/);
  assert.match(out, /（review）備註/);
  assert.equal(findBoard([human, review]), null);
});

test("pr-guard workflow：同一 PR 各種事件同一個 concurrency 組；只處理 open 的 PR；workflow_run 也擋 fork", () => {
  const y = readFileSync(new URL("../.github/workflows/pr-guard.yml", import.meta.url), "utf8");
  assert.match(y, /group: pr-guard-board-\$\{\{ github\.event\.pull_request\.number \|\| github\.event\.issue\.number \|\| github\.event\.workflow_run\.pull_requests\[0\]\.number \|\|/);
  assert.doesNotMatch(y, /^concurrency:/m, "concurrency 不能放在 workflow 層：被 if 略過的執行（例如機器人留言）會把正在跑的那次取消");
  assert.match(y, /^  board:\n(?:    #.*\n)*    concurrency:\n/m, "concurrency 要放在 board job 裡");
  assert.match(y, /github\.event\.pull_request\.state == 'open'/);
  assert.match(y, /github\.event\.issue\.state == 'open'/);
  assert.match(y, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
});

test("pr-guard-run：說明裡 Closes #N 會查 GitHub，看板列出不存在或是 PR 的編號", async () => {
  const f = fake({ pr: { body: "## 誰做的\nClaude Code，Closes #12、Closes #7" } });
  const get0 = f.get;
  const get = p => /\/issues\/12$/.test(p) ? (() => { throw new Error("HTTP 404"); })() : /\/issues\/7$/.test(p) ? { number: 7, pull_request: {} } : get0(p);
  const out = [];
  await run(5, { dry: true, get, write: f.write, repo: "o/r", log: s => out.push(s) });
  const board = out.join("\n");
  assert.match(board, /Closes #12 指向不存在的編號/);
  assert.match(board, /Closes #7 是 PR 不是 Issue/);
  assert.match(board, /「## 改了什麼」段落|缺少「## 改了什麼」/);
});
