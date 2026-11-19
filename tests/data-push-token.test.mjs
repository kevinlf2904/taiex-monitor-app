// 排程改用 GitHub App token 推送（#312、docs/ruleset-setup.md 第二階段前置 3）：
// main 開 ruleset 後，預設 GITHUB_TOKEN 不能加進 bypass，24 支寫回 main 的排程要改用排程專用 App 換發的 token。
// 檢查：每個呼叫 commit-data.sh 的 step 前面都有換 token 的 step（token 只有 1 小時，所以緊接在 commit 前換）、
// 外部 action 都固定到 commit SHA（G4）、commit-data.sh 會把 checkout 存的 token 換成 App token，沒設定 App 時維持原樣。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const wfDir = new URL(".github/workflows/", root);
const APP_ACTION = "actions/create-github-app-token@f418cff399f7aef4c2f0ad47e25ca7a6abbdd6fc";
const dataWorkflows = () => readdirSync(wfDir).filter(f => f.endsWith(".yml"))
  .map(f => [f, readFileSync(new URL(f, wfDir), "utf8")]).filter(([, t]) => t.includes("commit-data.sh"));
const stepsOf = t => t.split(/\n(?=      - )/).slice(1);

test("App token：寫回 main 的排程有 24 支（含 earn-hist 的 workflow_run）", () => {
  const w = dataWorkflows().map(([f]) => f);
  assert.equal(w.length, 24, w.join("、"));
  assert.ok(w.includes("earn-hist.yml"));
});

test("App token：每個 commit step 前一步都換 App token，並用 DATA_PUSH_TOKEN 傳給 commit-data.sh", () => {
  let n = 0;
  for (const [f, t] of dataWorkflows()) {
    const steps = stepsOf(t);
    steps.forEach((s, i) => {
      if (!s.includes("commit-data.sh")) return;
      n++;
      const prev = steps[i - 1];
      const id = prev.match(/\n {8}id: (\S+)/)?.[1];
      assert.ok(id, `${f}：commit step 前一步要是有 id 的換 token step`);
      assert.ok(prev.includes(`uses: ${APP_ACTION} # v3.4.0`), `${f}：要用固定 SHA 的 create-github-app-token`);
      assert.ok(prev.includes("client-id: ${{ vars.DATA_APP_CLIENT_ID }}"), `${f}：client-id 讀 repo 變數`);
      assert.ok(prev.includes("private-key: ${{ secrets.DATA_APP_PRIVATE_KEY }}"), `${f}：私鑰讀 secrets`);
      assert.ok(prev.includes("permission-contents: write"), `${f}：token 只要 contents: write`);
      assert.ok(!/permission-(?!contents)/.test(prev), `${f}：不要要求其他權限`);
      assert.ok(prev.includes("if: ${{ github.ref == 'refs/heads/main' && vars.DATA_APP_CLIENT_ID != '' }}"), `${f}：只在 main、且設定了 App 時換 token`);
      assert.ok(s.includes(`DATA_PUSH_TOKEN: \${{ steps.${id}.outputs.token }}`), `${f}：commit step 要用前一步的 token`);
      assert.match(s.match(/\n {8}if: (.*)/)?.[1] || "", /refs\/heads\/main/, `${f}：commit step 只在 main 執行`);
    });
    // 同一支 workflow 裡 id 不能重複
    const ids = [...t.matchAll(/\n {8}id: (datatoken\d*)/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${f}：換 token 的 step id 重複`);
  }
  assert.equal(n, 27, "commit step 數量變了，請確認新加的寫回也有換 token");
});

test("App token：寫回 main 的排程，外部 action 都固定到完整 commit SHA（G4）", () => {
  for (const [f, t] of dataWorkflows()) {
    for (const m of t.matchAll(/uses:\s*(\S+)/g)) {
      if (m[1].startsWith("./")) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${f}：${m[1]} 要固定到 commit SHA`);
    }
  }
});

test("App token：除了 ci.yml，沒有 workflow 會被推到 main 觸發（App token 的推送會觸發 on: push）", () => {
  for (const f of readdirSync(wfDir).filter(f => f.endsWith(".yml"))) {
    const on = readFileSync(new URL(f, wfDir), "utf8").split(/\njobs:/)[0];
    if (f === "ci.yml") continue;
    assert.ok(!/\n {2}push:/.test(on), `${f} 有 on: push，App token 寫回資料時會被觸發`);
  }
  // ci.yml 的 push 只看程式路徑，不含 learner/data/*.json（commit-data.sh 也固定加 [skip ci]）
  const ci = readFileSync(new URL("ci.yml", wfDir), "utf8");
  const paths = ci.match(/\n {2}push:\n[\s\S]*?paths: \[(.*)\]/)[1];
  assert.ok(!/learner\/\*\*"|learner\/data|\*\*\.json"/.test(paths), paths);
  assert.ok(readFileSync(new URL("scripts/commit-data.sh", root), "utf8").includes('git commit -q -m "$msg [skip ci]"'));
});

// commit-data.sh 實際跑一次：本機 bare repo 當遠端，模擬 checkout 存好的 extraheader
function runCommit(env) {
  const d = mkdtempSync(join(tmpdir(), "data-push-"));
  try {
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
    git(d, "init", "-q", "--bare", "-b", "main", "remote.git");
    git(d, "clone", "-q", join(d, "remote.git"), "work");
    const w = join(d, "work");
    git(w, "config", "user.name", "t"); git(w, "config", "user.email", "t@example.com");
    git(w, "commit", "-q", "--allow-empty", "-m", "init"); git(w, "push", "-q", "origin", "HEAD:main");
    const key = "http.https://github.com/.extraheader";
    git(w, "config", "--local", key, "AUTHORIZATION: basic b2xkLXRva2Vu");
    writeFileSync(join(w, "x.json"), "{}\n");
    const out = execFileSync("bash", [new URL("scripts/commit-data.sh", root).pathname, "測試", "x.json"],
      { cwd: w, encoding: "utf8", env: { ...process.env, GITHUB_REF_NAME: "main", GITHUB_SERVER_URL: "https://github.com", COMMIT_NAME: "t", ...env } });
    return { out, headers: git(w, "config", "--local", "--get-all", key).split("\n"), remoteLog: git(join(d, "remote.git"), "log", "-1", "--format=%s", "main") };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

test("commit-data.sh：有 DATA_PUSH_TOKEN 時把 checkout 的 token 整個換成 App token，且只留一條", () => {
  const r = runCommit({ DATA_PUSH_TOKEN: "app-token-123" });
  assert.deepEqual(r.headers, [`AUTHORIZATION: basic ${Buffer.from("x-access-token:app-token-123").toString("base64")}`]);
  assert.ok(r.out.includes("::add-mask::"), "base64 後的 token 也要遮蔽");
  assert.ok(!r.out.includes("app-token-123"), "不能把 token 印出來");
  assert.equal(r.remoteLog, "測試 [skip ci]");
});

test("commit-data.sh：沒有 DATA_PUSH_TOKEN（還沒設定 App）時沿用原本的 token，照樣寫回", () => {
  const r = runCommit({ DATA_PUSH_TOKEN: "" });
  assert.deepEqual(r.headers, ["AUTHORIZATION: basic b2xkLXRva2Vu"]);
  assert.ok(r.out.includes("用預設 GITHUB_TOKEN 推送"));
  assert.equal(r.remoteLog, "測試 [skip ci]");
});
