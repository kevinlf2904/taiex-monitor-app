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
  const b64 = s => ({ encoding: "base64", content: Buffer.from(s, "utf8").toString("base64") });
  const fake = {
    "pulls/5": { number: 5, title: "改看盤", draft: false, base: { ref: "main" }, head: { sha: HEAD, ref: "claude/x" } },
    "pulls/5/files": [{ filename: "learner/watch.html", status: "modified" }],
    "issues/5/comments": [
      { id: 9, created_at: "t", body: "審查（Codex）：`0000000` 可以合併", user: { type: "User" } },
      { id: 10, created_at: "t", body: "先不要合併，等我確認\n第二行", user: { type: "User" } },
      { id: 11, created_at: "t", body: "[vc]: #abc 部署預覽", user: { login: "vercel[bot]", type: "Bot" } },
    ],
    "pulls/5/reviews": [{ id: 7, submitted_at: "t", body: "審查（ChatGPT）：修改後再合併", commit_id: HEAD }, { id: 8, submitted_at: "t", body: "Looks good overall", commit_id: HEAD }],
    "pulls/5/comments": [{ id: 70, created_at: "t", body: "這裡少了 await", path: "learner/watch.html", commit_id: HEAD }],
    [`commits/${HEAD}/check-runs`]: { check_runs: [{ name: "test", head_sha: HEAD, status: "completed", conclusion: "success", started_at: "1", html_url: "u" }] },
    "pulls?state=open": [{ number: 5 }, { number: 6, title: "鎖：watch.html＋持股", draft: true }],
    "pulls/6/files": [],
    "contents/learner/version.json?ref=main": b64('{"v":"2026.11.17-241"}\n'),
    [`contents/learner/version.json?ref=${HEAD}`]: b64('{"v":"2026.11.18-242"}\n'),
    [`contents/learner/index.html?ref=${HEAD}`]: b64("<footer>版本 2026.11.18-242</footer>"),
    [`contents/learner/watch.html?ref=${HEAD}`]: b64("<div>版本 2026.11.18-242</div>"),
    [`contents/learner/README.md?ref=${HEAD}`]: b64("### 改看盤（2026.11.18-242）\n- 更新"),
  };
  const get = path => { const k = path.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, ""); assert.ok(k in fake, k); return fake[k]; };
  const out = formatBrief(await collect(5, get, "o/r"));
  assert.match(out, new RegExp(`^檢查（pr-guard）：\`${HEAD}\``));
  assert.match(out, /CI：✅ test success/);
  assert.match(out, /needs-lock/);
  assert.match(out, /和 #6（鎖定中） 撞到：learner\/watch\.html/);
  assert.match(out, /版本號：✅ 四檔一致且已遞增（2026\.11\.17-241 → 2026\.11\.18-242）/);
  assert.match(out, /〔舊 SHA〕審查（Codex） 可以合併/);
  assert.match(out, /〔最新〕審查（ChatGPT） 修改後再合併（review）/, "review 沒寫 SHA 時用 commit_id");
  assert.match(out, /其他留言（不是協作格式，請自行讀全文）：3 則/, "一般留言、review、行內各一則；機器人留言不算");
  assert.match(out, /（留言）先不要合併，等我確認｜/, "使用者的一般留言不能漏掉");
  assert.match(out, /（review）Looks good overall｜/);
  assert.match(out, /（行內）learner\/watch\.html｜這裡少了 await/);
  assert.doesNotMatch(out, /部署預覽/, "機器人留言排除");
  assert.equal(out.match(/審查（Codex）/g).length, 1, "協作格式的留言不重複列在其他留言");
});

test("pr-guard：低風險路徑和 docs/merge.md「低風險例外」條文用的是同一組路徑", () => {
  const a = readFileSync(new URL("../docs/merge.md", import.meta.url), "utf8");
  for (const k of ["`docs/**`", "`docs/merge.md`", "`learner/core.css`", "`learner/minimal.css`", "`.github/workflows/**`", "`api/**`", "`scripts/**`", "`package*.json`", "`learner/data/**`", "`vercel.json`"]) assert.ok(a.includes(k), `docs/merge.md 改了「${k}」的話，scripts/pr-guard.mjs 要跟著改`);
  assert.match(readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8"), /docs\/merge\.md/, "AGENTS.md 要指向 docs/merge.md");
});

test("pr-guard：docs/merge.md 是協作規則，不算低風險；其他 docs 仍是低風險", () => {
  assert.equal(inLowRiskScope("docs/merge.md"), false);
  assert.equal(highRiskReason("docs/merge.md"), "協作規則");
  assert.equal(inLowRiskScope("docs/realtime-setup.md"), true);
});

// ---- PR 說明檢查（#312 PR E）----
import { checkTemplate, sections, closingRefs, TEMPLATE_SECTIONS } from "../scripts/pr-guard.mjs";
const TEMPLATE = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
const filled = (over = {}) => TEMPLATE_SECTIONS.map(n => `## ${n}\n${over[n] ?? `${n}的內容`}\n`).join("\n");

test("PR 說明檢查：五個段落和 .github/pull_request_template.md 一致", () => {
  assert.deepEqual(Object.keys(sections(TEMPLATE)), TEMPLATE_SECTIONS, "範本改了段落名稱，scripts/pr-guard.mjs 要跟著改");
});

test("PR 說明檢查：照抄範本（只有註解）或漏段落會提醒；都有內容就通過", () => {
  const raw = checkTemplate({ body: TEMPLATE });
  assert.equal(raw.problems.length, 5, "只有範本註解＝五段都空");
  assert.match(raw.problems.join(), /「## 誰做的」是空的/);
  const miss = checkTemplate({ body: filled().replace(/## 驗證重點[\s\S]*$/, "") });
  assert.deepEqual(miss.problems, ["PR 說明缺少「## 驗證重點」段落"]);
  assert.deepEqual(checkTemplate({ body: filled({ "還沒做完": "無" }) }).problems, [], "寫「無」算有內容");
  assert.equal(checkTemplate({ body: "" }).problems.length, 5, "空說明不會丟錯");
  assert.equal(checkTemplate({ body: null }).problems.length, 5);
});

test("PR 說明檢查：Closes #N 要存在而且是 Issue；Refs 不算關閉", () => {
  assert.deepEqual(closingRefs("Closes #12，fixes #5、Resolves #12；Refs #312"), [12, 5]);
  const r = checkTemplate({ body: filled(), refs: [{ number: 12, exists: false }, { number: 5, exists: true, isPR: true }, { number: 7, exists: true, isPR: false }] });
  assert.deepEqual(r.problems, ["Closes #12 指向不存在的編號（AGENTS.md：不得虛構編號）", "Closes #5 是 PR 不是 Issue"]);
});

test("PR 說明檢查：high-risk 卻寫「低風險例外：是」要提醒；寫「否」或低風險檔案不提醒", () => {
  const yes = filled({ "測試": "1. 本機通過\n3. 低風險例外：**是**（只改 docs）" });
  assert.match(checkTemplate({ body: yes, files: ["scripts/x.mjs"] }).problems.join(), /「低風險例外」不能寫「是」/);
  assert.deepEqual(checkTemplate({ body: yes, files: ["docs/a.md"] }).problems, []);
  assert.deepEqual(checkTemplate({ body: filled({ "測試": "3. 低風險例外：**否**（改到 scripts/**）" }), files: ["scripts/x.mjs"] }).problems, []);
});

test("PR 說明檢查：寫的 SHA 不是最新 head 只提醒、不算問題", () => {
  const sha = "a".repeat(40), head = "b".repeat(40);
  const r = checkTemplate({ body: filled({ "測試": `CI（${sha}）通過` }), headSha: head });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join(), /不是最新 head（bbbbbbb）/);
  assert.deepEqual(checkTemplate({ body: filled({ "測試": `CI（${head}）通過` }), headSha: head }).notes, []);
  assert.deepEqual(checkTemplate({ body: filled(), headSha: head }).notes, [], "沒寫 SHA 不提醒");
});

// #312 pr-guard 後續待辦（#319 審查 P3）：註解、程式碼區塊不算；只有 404 才算編號不存在；「低風險例外：是」看 !lowRisk
test("PR 說明檢查：程式碼區塊裡的「## 」不算段落標題，區塊本身算內容；註解裡的標題不算", () => {
  const body = filled({ "測試": "```\n## 誰做的\n# tests 45\n```", "還沒做完": "<!--\n## 驗證重點\n-->\n無" });
  const sec = sections(body);
  assert.deepEqual(Object.keys(sec), TEMPLATE_SECTIONS, "區塊與註解裡的「## 」不會多切出段落");
  assert.match(sec["測試"], /# tests 45/, "只貼測試輸出的程式碼區塊算有內容");
  assert.equal(sec["還沒做完"], "無");
  assert.deepEqual(checkTemplate({ body }).problems, []);
  const tilde = sections("## 測試\n~~~\n## 假標題\n~~~\n## 驗證重點\nx");
  assert.deepEqual(Object.keys(tilde), ["測試", "驗證重點"], "~~~ 區塊也一樣");
  assert.deepEqual(Object.keys(sections("## 測試\n```js\n## 沒關的區塊\n")), ["測試"], "沒關閉的區塊到結尾都算區塊");
});

test("PR 說明檢查：Closes #N 在註解、程式碼區塊、行內程式碼裡不算關閉", () => {
  const body = [
    "Closes #1",
    "<!-- Closes #2 -->",
    "<!-- 範本說明：fixes #3",
    "-->",
    "```",
    "Resolves #4",
    "```",
    "~~~text",
    "closes #5",
    "~~~",
    "例如 `Closes #6` 這樣寫",
    "``fixes #7``，最後 fixes #8",
  ].join("\n");
  assert.deepEqual(closingRefs(body), [1, 8]);
  assert.deepEqual(closingRefs("<!-- 沒關閉的註解 Closes #9"), [], "沒關閉的註解到結尾都不算");
  assert.deepEqual(closingRefs("```js`\nCloses #10"), [10], "資訊字串含反引號就不是區塊開頭");
});

test("PR 說明檢查：Closes #N 查詢失敗只提醒，不說編號不存在", () => {
  const r = checkTemplate({ body: filled(), refs: [{ number: 12, exists: null, error: 403 }, { number: 13, exists: null, error: null }] });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join("\n"), /Closes #12 查詢失敗（HTTP 403）/);
  assert.match(r.notes.join("\n"), /Closes #13 查詢失敗：/);
  assert.doesNotMatch(r.notes.join("\n"), /不存在的編號/);
});

test("pr-brief：查 Closes #N 只有 404 算不存在，403／429／5xx 算查詢失敗", async () => {
  const codes = { 21: 404, 22: 403, 23: 429, 24: 502 };
  const body = filled({ "改了什麼": "Closes #20 Closes #21 Closes #22 Closes #23 Closes #24 Closes #25" });
  const fake = {
    "pulls/5": { number: 5, title: "x", draft: false, body, head: { sha: HEAD, ref: "claude/x" } },
    "pulls/5/files": [{ filename: "docs/a.md", status: "modified" }],
    "issues/5/comments": [], "pulls/5/reviews": [], "pulls/5/comments": [],
    [`commits/${HEAD}/check-runs`]: { check_runs: [] },
    "pulls?state=open": [{ number: 5 }],
    "issues/20": { number: 20 },
  };
  const get = path => {
    const k = path.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, "");
    const n = Number((k.match(/^issues\/(\d+)$/) || [])[1]);
    if (codes[n]) throw Object.assign(new Error("gh: failed"), { stderr: `gh: Something (HTTP ${codes[n]})` });
    if (n === 25) throw new Error("spawn gh ENOENT");
    assert.ok(k in fake, k); return fake[k];
  };
  const data = await collect(5, get, "o/r");
  assert.deepEqual(data.refs.map(r => [r.number, r.exists, r.error]), [[20, true, undefined], [21, false, undefined], [22, null, 403], [23, null, 429], [24, null, 502], [25, null, null]]);
  const out = formatBrief(data);
  assert.match(out, /Closes #21 指向不存在的編號/);
  for (const n of [22, 23, 24]) assert.match(out, new RegExp(`提醒：Closes #${n} 查詢失敗（HTTP ${codes[n]}）`));
  assert.match(out, /提醒：Closes #25 查詢失敗：/, "看不出狀態碼也不能說不存在");
  assert.doesNotMatch(out, /#2[2-5] 指向不存在/);
});

test("PR 說明檢查：「低風險例外：是」只要有檔案不在低風險範圍就提醒（不只 high-risk）", () => {
  const yes = filled({ "測試": "3. 低風險例外：**是**" });
  for (const files of [["learner/foo.js"], ["docs/a.md", "learner/foo.js"], [{ filename: "tests/a.test.mjs", status: "removed" }]]) {
    assert.match(checkTemplate({ body: yes, files }).problems.join(), /不在低風險例外範圍，「低風險例外」不能寫「是」/, JSON.stringify(files));
  }
  assert.deepEqual(checkTemplate({ body: yes, files: ["docs/a.md", "tests/a.test.mjs"] }).problems, [], "全部在範圍內不提醒");
  assert.deepEqual(checkTemplate({ body: yes }).problems, [], "沒有檔案清單不判斷");
});

test("PR 說明檢查：程式碼區塊裡的 <!-- 只是文字，不會吞掉區塊後的段落與 Closes（#320 ChatGPT P2）", () => {
  const body = "## 測試\n```\n<!-- example in code sample\n```\n## 驗證重點\n有提供驗證內容\nCloses #7";
  assert.deepEqual(Object.keys(sections(body)), ["測試", "驗證重點"]);
  assert.match(sections(body)["測試"], /<!-- example/, "區塊內容原樣保留");
  assert.equal(sections(body)["驗證重點"], "有提供驗證內容\nCloses #7");
  assert.deepEqual(closingRefs(body), [7]);
  const tilde = "~~~html\n<!-- 開頭\n~~~\nfixes #8\n## 測試\nx";
  assert.deepEqual(closingRefs(tilde), [8]);
  assert.deepEqual(Object.keys(sections(tilde)), ["測試"]);
  // 反過來：註解裡的 ``` 不算區塊開頭，註解結束後照常解析
  const fenceInComment = "<!--\n```\nCloses #9\n-->\nCloses #10\n## 測試\nx";
  assert.deepEqual(closingRefs(fenceInComment), [10]);
  assert.deepEqual(Object.keys(sections(fenceInComment)), ["測試"]);
  // 行內程式碼裡的 <!-- 也只是文字
  const inline = "用 `<!--` 開頭的註解，Closes #11\n## 測試\nx";
  assert.deepEqual(closingRefs(inline), [11]);
  assert.deepEqual(Object.keys(sections(inline)), ["測試"]);
  // 同一行有多段註解、註解跨行後同一行還有內容
  assert.deepEqual(closingRefs("a <!-- Closes #1 --> Closes #2 <!-- fixes #3 --> b\n<!-- x\ny --> Resolves #4"), [2, 4]);
});

test("PR 說明檢查：行內程式碼要長度相同的反引號才算關閉，且不跨段落配對（#320 Antigravity P3）", () => {
  assert.deepEqual(closingRefs("例如 `` `foo` Closes #99 `` 不算關閉"), [], "雙反引號裡含單反引號");
  assert.deepEqual(closingRefs("## 改了什麼\n提到 `未閉合反引號\n\nCloses #42\n\n## 測試\n跑 `ok` 過了"), [42], "沒關閉的反引號不會跨段落吞掉 Closes");
  assert.deepEqual(closingRefs("用 `a ```<!-- b` 說明\nCloses #77"), [77], "``` 不能關閉單反引號");
  assert.deepEqual(Object.keys(sections("用 `a ```<!-- b` 說明\n## 測試\nx")), ["測試"]);
  assert.deepEqual(closingRefs("```js` 不是區塊，Closes #5"), [5], "資訊字串含反引號的 ``` 行是一般文字");
  assert.deepEqual(closingRefs("``x`` `Closes #5` ```Closes #6``` Closes #7"), [7], "不同長度的行內程式碼各自配對");
});

test("PR 說明檢查：行內程式碼可以在同一段落內跨行，空行／標題／區塊會結束段落（#320 ChatGPT P3）", () => {
  assert.deepEqual(closingRefs("`example\nCloses #42\n`"), [], "同段落跨行的行內程式碼");
  assert.deepEqual(closingRefs("前 ``a\nb ` Closes #1\nc`` 後 Closes #2"), [2], "跨行時一樣要長度相同的反引號");
  assert.deepEqual(closingRefs("`a\nx <!-- b\nc` Closes #3 -->"), [3], "跨行程式碼裡的 <!-- 不是註解，程式碼結束後的 Closes 照算");
  assert.deepEqual(closingRefs("`a\n<!-- b\nc` Closes #3 -->"), [], "<!-- 在行首是 HTML 區塊，會結束段落，註解裡的 Closes 不算");
  assert.deepEqual(closingRefs("`沒關閉\nCloses #4\n還是沒關閉"), [4], "整段都找不到結尾就是一般文字");
  assert.deepEqual(closingRefs("`沒關閉\nCloses #5\n\n後一段才有 ` Closes #6"), [5, 6], "空行結束段落，不跨段配對");
  assert.deepEqual(closingRefs("`沒關閉\nCloses #7\n## 標題 `\nfixes #8"), [7, 8], "標題結束段落");
  assert.deepEqual(closingRefs("`沒關閉\nCloses #9\n```\n`\n```\nfixes #10"), [9, 10], "區塊開頭結束段落");
  assert.deepEqual(closingRefs("`沒關閉\nCloses #11\n---\n` fixes #12"), [11, 12], "--- 結束段落；後面那個反引號自己也沒關閉，是一般文字");
  assert.deepEqual(closingRefs("- 項目 `a\n- Closes #13 `"), [13], "新的清單項目結束段落");
  assert.deepEqual(closingRefs("- 項目 `a\n  Closes #14 ` b"), [], "同一項目的續行仍在同段落");
  assert.deepEqual(closingRefs("## 標題 `a\nCloses #15 `"), [15], "標題行裡的反引號不往下一行配對");
  assert.deepEqual(closingRefs("`open\n> Closes #42\n`"), [42], "> 引用結束段落（#324 ChatGPT P2）");
  assert.deepEqual(closingRefs("`open\n   > fixes #43\n`"), [43], "前面最多 3 個空格的 > 也算");
  assert.deepEqual(closingRefs("`open\n<div>\nCloses #44\n</div>\n`"), [44], "HTML 區塊結束段落");
  assert.deepEqual(closingRefs("`open\n<!-- x -->\nCloses #45 `"), [45], "<!-- 開頭的行也結束段落");
  // #324 Antigravity P2／P3：段落邊界與區塊開頭用同一套判斷；行內標籤不中斷段落；HTML 區塊裡的反引號只是文字
  assert.deepEqual(closingRefs("`open\n```foo` bar\nCloses #42\n`"), [42], "資訊字串含反引號的 ``` 行不是區塊，也不結束段落");
  assert.deepEqual(closingRefs("`open\n<span> `\nCloses #46\n`"), [46], "行內標籤不結束段落");
  assert.deepEqual(closingRefs("`open\n<https://example.com> `\nCloses #47\n`"), [47], "autolink 不結束段落");
  assert.deepEqual(closingRefs("`open\n<!-- x --> `\nCloses #48\n`"), [48], "<!-- 開頭的 HTML 區塊裡，反引號不開始行內程式碼");
  assert.deepEqual(closingRefs("<!-- a\nb\n--> `\nCloses #49\n`"), [49], "跨行註解結束那一行也一樣");
  assert.deepEqual(closingRefs("<div>\nfoo `\nCloses #50\n`\n</div>"), [50], "HTML 區塊裡到空行為止都是文字");
  assert.deepEqual(closingRefs("<div>\n\n`a\nCloses #51\n`"), [], "空行後 HTML 區塊結束，恢復一般解析");
  const body = "## 改了什麼\n說明 `a\n## 測試` 不算標題\nx`\n## 驗證重點\ny";
  assert.deepEqual(Object.keys(sections(body)), ["改了什麼", "測試` 不算標題", "驗證重點"], "## 開頭的行本身會結束段落，所以照樣是標題");
});

test("httpStatus：stderr 只有空白時也看 message", async () => {
  const { httpStatus } = await import("../scripts/pr-guard.mjs");
  assert.equal(httpStatus({ stderr: "\n", message: "HTTP 404" }), 404);
  assert.equal(httpStatus({ stderr: "gh: Not Found (HTTP 404)", message: "Command failed" }), 404);
  assert.equal(httpStatus(new Error("spawn gh ENOENT")), 0);
  assert.equal(httpStatus("HTTP 502"), 502);
});

// ---- 版本號檢查串接（#312 PR F）----
test("版本號檢查串接（#312 PR F）：沒改四個版本檔時不抓檔案、看板不列版本號區塊", async () => {
  const seen = [];
  const fake = {
    "pulls/5": { number: 5, title: "只改腳本", draft: false, base: { ref: "main" }, head: { sha: HEAD, ref: "gemini/x" } },
    "pulls/5/files": [{ filename: "scripts/pr-guard.mjs", status: "modified" }],
    "issues/5/comments": [], "pulls/5/reviews": [], "pulls/5/comments": [],
    [`commits/${HEAD}/check-runs`]: { check_runs: [] },
    "pulls?state=open": [{ number: 5 }],
  };
  const get = path => {
    const k = path.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, "");
    seen.push(k);
    assert.ok(!k.startsWith("contents/"), `未改版本檔不應讀取 ${k}`);
    assert.ok(k in fake, k);
    return fake[k];
  };
  const data = await collect(5, get, "o/r");
  assert.deepEqual(data.version.errors, []);
  assert.equal(seen.some(k => k.startsWith("contents/")), false);
  const out = formatBrief(data);
  assert.doesNotMatch(out, /版本號：/);
  assert.doesNotMatch(formatBrief({ pr: { number: 1, title: "t", head: { sha: HEAD, ref: "b" } }, files: ["docs/a.md"], version: { checked: false, ok: true, problems: [] } }), /版本號：/);
});

test("版本號檢查串接（#312 PR F）：改到版本檔但未升版或不一致時列出問題與純文件忽略提醒（#318 P3-3）", () => {
  const base = { "learner/version.json": '{"v":"2026.11.17-241"}\n' };
  const same = {
    "learner/version.json": '{"v":"2026.11.17-241"}\n',
    "learner/index.html": "<p>版本 2026.11.17-241</p>",
    "learner/watch.html": "<p>版本 2026.11.17-241</p>",
    "learner/README.md": "### 補充說明（2026.11.17-241）\n- 補充文件\n",
  };
  const outDoc = formatBrief({
    pr: { number: 8, title: "補充學堂說明", head: { sha: HEAD, ref: "docs" } },
    files: ["learner/README.md"],
    version: { base, head: same },
  });
  assert.match(outDoc, /版本號：⚠️ 1 項待確認（只是提醒）/);
  assert.match(outDoc, /head 版號（2026\.11\.17-241）沒有大於 main（2026\.11\.17-241）/);
  assert.match(outDoc, /若僅純文件／測試修改，依 AGENTS\.md 不需升版，可忽略此提醒/);

  const mismatch = {
    "learner/version.json": '{"v":"2026.11.18-242"}\n',
    "learner/index.html": "<p>版本 2026.11.17-241</p>",
    "learner/watch.html": "<p>版本 2026.11.18-242</p>",
    "learner/README.md": "### 新功能（2026.11.18-242）\n- 新增\n",
  };
  const outMix = formatBrief({
    pr: { number: 9, title: "漏改 index", head: { sha: HEAD, ref: "feat" } },
    files: ["learner/version.json", "learner/watch.html"],
    version: { base, head: mismatch },
  });
  assert.match(outMix, /版本號：⚠️ 1 項待確認（只是提醒）/);
  assert.match(outMix, /四個檔案的版本號不一致/);
  assert.match(outMix, /若僅純文件／測試修改，依 AGENTS\.md 不需升版，可忽略此提醒/);
});

test("版本號檢查串接（#312 PR F）：讀版本檔只有 404 算缺少，403／429／5xx 算查詢失敗；超過 1MB 退回讀 git/blobs", async () => {
  const b64 = s => ({ encoding: "base64", content: Buffer.from(s, "utf8").toString("base64") });
  const baseFixtures = {
    "pulls/5": { number: 5, title: "改看盤", draft: false, base: { ref: "main" }, head: { sha: HEAD, ref: "gemini/x" } },
    "pulls/5/files": [{ filename: "learner/watch.html", status: "modified" }],
    "issues/5/comments": [], "pulls/5/reviews": [], "pulls/5/comments": [],
    [`commits/${HEAD}/check-runs`]: { check_runs: [] },
    "pulls?state=open": [{ number: 5 }],
  };

  // 1. 超過 1MB（encoding: "none"、content 為空）改由 git/blobs/<sha> 讀取
  const largeFixtures = {
    ...baseFixtures,
    "contents/learner/version.json?ref=main": b64('{"v":"2026.11.17-241"}\n'),
    [`contents/learner/version.json?ref=${HEAD}`]: b64('{"v":"2026.11.18-242"}\n'),
    [`contents/learner/index.html?ref=${HEAD}`]: b64("<footer>版本 2026.11.18-242</footer>"),
    [`contents/learner/watch.html?ref=${HEAD}`]: { encoding: "none", content: "", size: 1500000, sha: "blobsha123" },
    "git/blobs/blobsha123": b64("<div>版本 2026.11.18-242</div>"),
    [`contents/learner/README.md?ref=${HEAD}`]: b64("### 大檔測試（2026.11.18-242）\n- 更新"),
  };
  const getLarge = p => { const k = p.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, ""); assert.ok(k in largeFixtures, k); return largeFixtures[k]; };
  const outLarge = formatBrief(await collect(5, getLarge, "o/r"));
  assert.match(outLarge, /版本號：✅ 四檔一致且已遞增（2026\.11\.17-241 → 2026\.11\.18-242）/);

  // 2. 404 算缺少檔案
  const notFoundFixtures = {
    ...baseFixtures,
    "contents/learner/version.json?ref=main": b64('{"v":"2026.11.17-241"}\n'),
    [`contents/learner/index.html?ref=${HEAD}`]: b64("<footer>版本 2026.11.18-242</footer>"),
    [`contents/learner/watch.html?ref=${HEAD}`]: b64("<div>版本 2026.11.18-242</div>"),
    [`contents/learner/README.md?ref=${HEAD}`]: b64("### 缺檔（2026.11.18-242）\n- 更新"),
  };
  const get404 = p => {
    const k = p.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, "");
    if (k === `contents/learner/version.json?ref=${HEAD}`) throw Object.assign(new Error("gh: Not Found"), { stderr: "gh: Not Found (HTTP 404)" });
    assert.ok(k in notFoundFixtures, k); return notFoundFixtures[k];
  };
  const data404 = await collect(5, get404, "o/r");
  assert.deepEqual(data404.version.errors, []);
  const out404 = formatBrief(data404);
  assert.match(out404, /版本號：⚠️ \d+ 項待確認（只是提醒）/);
  assert.match(out404, /learner\/version\.json 缺少或內容為空/);

  // 3. 403／429／502 只提醒查詢失敗，不誤報為檔案缺少
  const getErr = p => {
    const k = p.replace(/^repos\/[^/]+\/[^/]+\//, "").replace(/[?&]per_page=\d+/, "");
    if (k === "contents/learner/version.json?ref=main") throw Object.assign(new Error("gh: Forbidden"), { stderr: "gh: rate limit (HTTP 403)" });
    if (k === `contents/learner/watch.html?ref=${HEAD}`) throw Object.assign(new Error("gh: Bad Gateway"), { stderr: "gh: Bad Gateway (HTTP 502)" });
    if (k in largeFixtures) return largeFixtures[k];
    assert.fail(k);
  };
  const dataErr = await collect(5, getErr, "o/r");
  assert.equal(dataErr.version.errors.length, 2);
  const outErr = formatBrief(dataErr);
  assert.match(outErr, /版本號：⚠️ 查詢失敗（只是提醒）/);
  assert.match(outErr, /提醒：main（main） 的 learner\/version\.json 查詢失敗（HTTP 403）：無法確認版本號，請自行確認/);
  assert.match(outErr, /提醒：head（9999200） 的 learner\/watch\.html 查詢失敗（HTTP 502）：無法確認版本號，請自行確認/);
  assert.doesNotMatch(outErr, /缺少或內容為空/);
});
