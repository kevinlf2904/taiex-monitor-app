// .github/CODEOWNERS（#312 G1）：workflow、協作規則、部署設定都要有 owner，ruleset 開啟 Code Owner 審查（G2）後才擋得住
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rules = () => readFileSync(new URL(".github/CODEOWNERS", root), "utf8").split("\n")
  .map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.split(/\s+/));

// 照 GitHub 的規則找出某個路徑的 owner：最後一條符合的規則為準（只處理本檔用到的寫法：/目錄/ 與 /檔名）
function ownersOf(path) {
  let owners = null;
  for (const [pat, ...o] of rules()) {
    const p = pat.replace(/^\//, "");
    if (p.endsWith("/") ? path.startsWith(p) : path === p) owners = o;
  }
  return owners;
}

test("CODEOWNERS：放在 .github/，根目錄與 docs/ 沒有另一份（GitHub 只用找到的第一份）", () => {
  assert.ok(existsSync(new URL(".github/CODEOWNERS", root)));
  assert.ok(!existsSync(new URL("CODEOWNERS", root)));
  assert.ok(!existsSync(new URL("docs/CODEOWNERS", root)));
});

test("CODEOWNERS：每條規則都從 repo 根目錄寫起、只有 owner 帳號一位", () => {
  const r = rules();
  assert.ok(r.length > 0);
  for (const [pat, ...o] of r) {
    assert.match(pat, /^\/[^*?\s]+$/, `${pat} 要用 / 開頭的明確路徑，不用萬用字元`);
    assert.deepEqual(o, ["@kevinlf2904"], `${pat} 的 owner`);
  }
});

test("CODEOWNERS：workflow、本檔、範本、協作規則、AI 設定、部署設定都有 owner", () => {
  for (const p of [".github/workflows/ci.yml", ".github/workflows/pr-guard.yml", ".github/workflows/twse-daily.yml", ".github/CODEOWNERS",
    ".github/pull_request_template.md", "AGENTS.md", "CLAUDE.md", ".agent/rules/klinelab.md", ".agent/workflows/merge.md",
    ".claude/settings.json", "vercel.json"]) {
    assert.deepEqual(ownersOf(p), ["@kevinlf2904"], `${p} 要有 owner`);
  }
});

test("CODEOWNERS：一般程式、測試、文件與排程產物不需要 owner 核准（避免每個 PR 都卡使用者）", () => {
  for (const p of ["learner/watch.html", "learner/core.js", "tests/run.mjs", "docs/plans/x.md", "learner/data/x.json", "README.md", "scripts/commit-data.sh"]) {
    assert.equal(ownersOf(p), null, `${p} 不在 CODEOWNERS 範圍`);
  }
});
