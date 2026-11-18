// PR 檢查的純函式（#312 PR B）：風險分類要和 AGENTS.md「低風險例外」一致，留言解析要分得出舊 SHA。全部用固定假資料，不連網路。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, inLowRiskScope, highRiskReason, needsUiVerify, removedAsserts, lockedByTitle, bigFileConflicts, parseAiComment, summarizeComments, ciStatus, formatBrief, BIG_FILES } from "../scripts/pr-guard.mjs";
import { collect } from "../scripts/pr-brief.mjs";

const HEAD = "999920019e9a6af028af87fbfac816ab6f43627a";

test("pr-guard：純文件、純 CSS、新增測試是低風險候選", () => {
  for (const files of [["docs/a.md"], ["README.md", "learner/README.md"], ["learner/core.css"], ["learner/minimal.css", "docs/x.md"], ["tests/new.test.mjs"]]) {
    const c = classify(files);
    assert.ok(c.lowRisk, files.join(","));
    assert.deepEqual(c.labels.filter(l => l !== "needs-390-1280"), ["low-risk-candidate"], files.join(","));
  }
});

test("pr-guard：AGENTS.md 列為不適用的路徑都不是低風險，且標 high-risk", () => {
  for (const p of ["AGENTS.md", "CLAUDE.md", ".agent/rules/klinelab.md", ".agent/workflows/merge.md", ".github/workflows/ci.yml", ".github/pull_request_template.md", ".github/ISSUE_TEMPLATE/handoff.yml", "api/chat.js", "api/_lib/market.js", "scripts/bump-version.mjs", "package.json", "package-lock.json", "vercel.json", "learner/data/x.json"]) {
    assert.equal(inLowRiskScope(p), false, p);
    assert.ok(highRiskReason(p), p);
    const c = classify(["docs/a.md", p]);
    assert.equal(c.lowRisk, false, `混到 ${p} 就不是低風險`);
    assert.ok(c.labels.includes("high-risk"), p);
  }
});

test("pr-guard：一般前端 JS／HTML 不是低風險也不是 high-risk，但要 390／1280 驗證", () => {
  const c = classify(["learner/tools.js", "learner/pro.html"]);
  assert.equal(c.lowRisk, false);
  assert.equal(c.highRisk, false);
  assert.ok(c.labels.includes("needs-390-1280"));
});

test("pr-guard：策略／回測／績效檔案（含 learner/）要獨立審查並標 high-risk", () => {
  for (const p of ["learner/quant.js", "learner/perf.js", "learner/sigstudy.js", "learner/ledger.js", "learner/core.js", "scripts/levels-bt.mjs"]) {
    const c = classify([p]);
    assert.ok(c.highRisk, p);
    assert.ok(c.crossReview.includes(p), p);
  }
});

test("pr-guard：刪除測試檔、淨刪斷言要提醒；改寫同一行斷言不算", () => {
  assert.equal(inLowRiskScope({ filename: "tests/old.test.mjs", status: "removed" }), false, "刪除測試檔不算低風險");
  const del = { filename: "tests/a.test.mjs", status: "modified", patch: "@@\n-  assert.equal(a, 1);\n-  assert.ok(b);\n+  // 拿掉了\n" };
  assert.equal(removedAsserts(del), 2);
  assert.match(classify([del]).warnings.join(), /刪除了 2 行斷言/);
  const rewrite = { filename: "tests/a.test.mjs", status: "modified", patch: "@@\n-  assert.equal(a, 1);\n+  assert.equal(a, 2);\n" };
  assert.equal(removedAsserts(rewrite), 0);
  assert.equal(removedAsserts({ filename: "learner/x.js", patch: "-assert(1)" }), 0, "非測試檔不算");
});

test("pr-guard：前端新增 localStorage 程式要提醒並要求獨立審查", () => {
  const f = { filename: "learner/tools.js", status: "modified", patch: "@@\n+  localStorage.setItem('x', 1);\n" };
  const c = classify([f]);
  assert.match(c.warnings.join(), /localStorage/);
  assert.ok(c.crossReview.includes("learner/tools.js"));
});

test("pr-guard：390／1280 不含版本號、說明文件與排程資料", () => {
  for (const p of ["learner/version.json", "learner/README.md", "learner/data/a.json", "docs/a.md", "scripts/x.mjs"]) assert.equal(needsUiVerify(p), false, p);
  for (const p of ["learner/watch.html", "learner/core.css", "learner/tools.js"]) assert.equal(needsUiVerify(p), true, p);
});

test("pr-guard：大檔要上鎖；和其他 PR 撞檔或撞到「鎖：」都列出，自己不算", () => {
  assert.deepEqual(classify(["learner/watch.html", "learner/tools.js"]).needsLock, ["learner/watch.html"]);
  assert.deepEqual(lockedByTitle("鎖：watch.html＋持股分頁"), ["learner/watch.html"]);
  assert.deepEqual(lockedByTitle("修正 watch.html 版面"), [], "不是「鎖：」開頭不算鎖定");
  const pr = { number: 10, files: ["learner/watch.html", "learner/core.js"] };
  const others = [
    { number: 10, title: "鎖：watch.html＋持股", files: ["learner/watch.html"] },
    { number: 11, title: "鎖：learner/core.js＋指標", draft: true, files: [] },
    { number: 12, title: "其他功能", files: ["learner/watch.html"] },
    { number: 13, title: "不相關", files: ["learner/tools.js"] },
  ];
  const got = bigFileConflicts(pr, others);
  assert.deepEqual(got.map(x => [x.number, x.lock, x.files]), [[11, true, ["learner/core.js"]], [12, false, ["learner/watch.html"]]]);
  assert.deepEqual(bigFileConflicts({ number: 1, files: [] }, others), []);
  assert.equal(BIG_FILES.length, 4);
});

test("pr-guard：解析 AI 留言第一行（類型、工具、→ 對象、SHA、結論）", () => {
  assert.deepEqual(parseAiComment(`審查（ChatGPT）：${HEAD} 可以合併\n\n內容`), { kind: "審查", from: "ChatGPT", to: null, sha: HEAD, verdict: "可以合併", line: `審查（ChatGPT）：${HEAD} 可以合併` });
  const r = parseAiComment("請求（Claude Code → Codex／ChatGPT）：`a513711` 請審查");
  assert.equal(r.kind, "請求"); assert.equal(r.from, "Claude Code"); assert.equal(r.to, "Codex／ChatGPT"); assert.equal(r.sha, "a513711");
  assert.equal(parseAiComment("驗證：390 正常").kind, "驗證");
  assert.equal(parseAiComment("驗證：390 正常").from, null);
  assert.equal(parseAiComment("## 審查（Codex）：`abc1234` 修改後再合併").verdict, "修改後再合併");
  assert.equal(parseAiComment("補充一下想法"), null);
  assert.equal(parseAiComment(""), null);
});

test("pr-guard：留言分成最新／舊 SHA／未附 SHA，短 SHA 比前綴，沒寫 SHA 不能當最新", () => {
  const list = summarizeComments([
    { id: 1, created_at: "t1", body: "審查（Codex）：`c6cd9df` 修改後再合併" },
    { id: 2, created_at: "t2", body: `審查（ChatGPT）：\`${HEAD.slice(0, 7)}\` 可以合併` },
    { id: 3, created_at: "t3", body: "[vc]: #abc 部署預覽" },
    { id: 4, created_at: "t4", body: "處置（Claude Code）：已處理" },
    { id: 5, created_at: "t5", body: "審查（Codex）：可以合併" },
    { id: 6, created_at: "t6", body: "驗證：390 正常" },
  ], HEAD);
  assert.deepEqual(list.map(x => [x.id, x.state]), [[1, "stale"], [2, "latest"], [4, "nosha"], [5, "nosha"], [6, "nosha"]]);
});

test("pr-guard：review 與行內留言也要讀；review 沒寫 SHA 時用 GitHub 記錄的 commit_id；重複的只列一次", () => {
  const list = summarizeComments([
    { id: 1, source: "review", created_at: "t1", body: "審查（Copilot）：修改後再合併", commit_id: HEAD },
    { id: 1, source: "review", created_at: "t1", body: "審查（Copilot）：修改後再合併", commit_id: HEAD },
    { id: 1, source: "comment", created_at: "t2", body: "審查（Codex）：`c6cd9df` 可以合併" },
    { id: 2, source: "inline", created_at: "t3", body: "審查（Codex）：這行有錯", commit_id: "c6cd9dfaaaa" },
  ], HEAD);
  assert.deepEqual(list.map(x => [x.source, x.id, x.state]), [["review", 1, "latest"], ["comment", 1, "stale"], ["inline", 2, "stale"]]);
});

test("pr-guard：改名的檔案原路徑也要判斷；刪除測試檔標 test-deletion", () => {
  const moved = classify([{ filename: "docs/moved.md", previous_filename: "tests/a.test.mjs", status: "renamed" }]);
  assert.equal(moved.lowRisk, false, "把測試改名成文件等於刪除測試");
  assert.ok(moved.labels.includes("test-deletion"));
  const api = classify([{ filename: "docs/bar.md", previous_filename: "api/bar.js", status: "renamed" }]);
  assert.equal(api.lowRisk, false);
  assert.ok(api.labels.includes("high-risk"), "原路徑的高風險理由要帶出來");
  assert.match(api.reasons.join(), /api\/bar\.js：API/);
  assert.ok(classify([{ filename: "docs/b.md", previous_filename: "docs/a.md", status: "renamed" }]).lowRisk, "文件改名仍是低風險候選");
  const del = classify([{ filename: "tests/old.test.mjs", status: "removed" }]);
  assert.deepEqual(del.labels, ["test-deletion"]);
  assert.match(del.reasons.join(), /刪除測試檔：tests\/old\.test\.mjs/);
});

test("pr-guard：CI 只認同一 head SHA、completed、success", () => {
  const runs = [{ name: "test", head_sha: "old", status: "completed", conclusion: "success", started_at: "2" }];
  assert.equal(ciStatus(runs, HEAD).ok, false, "舊 SHA 不算");
  assert.equal(ciStatus([{ name: "test", head_sha: HEAD, status: "in_progress", started_at: "1" }], HEAD).ok, false, "進行中不算");
  assert.equal(ciStatus([{ name: "test", head_sha: HEAD, status: "completed", conclusion: "cancelled", started_at: "1" }], HEAD).ok, false, "cancelled 不算");
  assert.equal(ciStatus([{ name: "test", head_sha: HEAD, status: "completed", conclusion: "success", started_at: "1" }], HEAD).ok, true);
  assert.equal(ciStatus([
    { name: "test", head_sha: HEAD, status: "completed", conclusion: "success", started_at: "1" },
    { name: "test", head_sha: HEAD, status: "completed", conclusion: "failure", started_at: "2" },
  ], HEAD).ok, false, "以最新一次為準");
});

test("pr-brief：用假的 GitHub 回應組出摘要，不呼叫 gh", async () => {
  const fake = {
    "pulls/5": { number: 5, title: "改看盤", draft: false, head: { sha: HEAD, ref: "claude/x" } },
    "pulls/5/files": [{ filename: "learner/watch.html", status: "modified" }],
    "issues/5/comments": [{ id: 9, created_at: "t", body: "審查（Codex）：`0000000` 可以合併" }],
    "pulls/5/reviews": [{ id: 7, submitted_at: "t", body: "審查（ChatGPT）：修改後再合併", commit_id: HEAD }, { id: 8, submitted_at: "t", body: "Looks good overall", commit_id: HEAD }],
    "pulls/5/comments": [{ id: 70, created_at: "t", body: "這裡少了 await", path: "learner/watch.html", commit_id: HEAD }],
    [`commits/${HEAD}/check-runs`]: { check_runs: [{ name: "test", head_sha: HEAD, status: "completed", conclusion: "success", started_at: "1", html_url: "u" }] },
    "pulls?state=open": [{ number: 5 }, { number: 6, title: "鎖：watch.html＋持股", draft: true }],
    "pulls/6/files": [],
  };
  const get = path => { const k = path.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, ""); assert.ok(k in fake, k); return fake[k]; };
  const out = formatBrief(await collect(5, get, "o/r"));
  assert.match(out, new RegExp(`^檢查（pr-guard）：\`${HEAD}\``));
  assert.match(out, /CI：✅ test success/);
  assert.match(out, /needs-lock/);
  assert.match(out, /和 #6（鎖定中） 撞到：learner\/watch\.html/);
  assert.match(out, /〔舊 SHA〕審查（Codex） 可以合併/);
  assert.match(out, /〔最新〕審查（ChatGPT） 修改後再合併（review）/, "review 沒寫 SHA 時用 commit_id");
  assert.match(out, /其他審查留言（不是協作格式）：2 則/);
  assert.match(out, /（行內）learner\/watch\.html｜這裡少了 await/);
});

test("pr-guard：低風險路徑和 AGENTS.md「低風險例外」條文用的是同一組路徑", () => {
  const a = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  for (const k of ["`docs/**`", "`learner/core.css`", "`learner/minimal.css`", "`.github/workflows/**`", "`api/**`", "`scripts/**`", "`package*.json`", "`learner/data/**`", "`vercel.json`"]) assert.ok(a.includes(k), `AGENTS.md 改了「${k}」的話，scripts/pr-guard.mjs 要跟著改`);
});
