// CI 分份（#312 PR C）：瀏覽器測試分成幾份平行跑時，每個檔案剛好跑一次、不漏不重複；單元測試一定要登記。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UNIT, e2eFiles, shard, pick, unregistered } from "./run.mjs";

test("CI 分份：任何份數下，每個瀏覽器測試檔剛好落在一份，各份數量最多差 1", () => {
  const all = e2eFiles();
  assert.ok(all.length > 0);
  for (let n = 1; n <= 6; n++) {
    const parts = Array.from({ length: n }, (_, i) => shard(all, i + 1, n));
    const flat = parts.flat();
    assert.equal(flat.length, all.length, `${n} 份：總數要相同`);
    assert.equal(new Set(flat).size, all.length, `${n} 份：不能重複`);
    assert.deepEqual([...flat].sort(), [...all].sort(), `${n} 份：不能漏`);
    const sizes = parts.map(p => p.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${n} 份：${sizes}`);
  }
});

test("CI 分份：參數不對就丟錯，不會默默跑 0 個檔案", () => {
  for (const [k, n] of [[0, 3], [4, 3], [1, 0], [1.5, 3], [NaN, 3]]) assert.throws(() => shard([1, 2, 3], k, n), /分份參數不對/, `${k}/${n}`);
  for (const bad of ["--e2e=abc", "--e2e=1/3/4", "--e2e=0/3", "--e2e=1/", "--e2e=/3", "--e2e=1.5/3", "--e2e=-1/3"]) assert.throws(() => pick([bad]), /分份參數不對/, bad);
  assert.throws(() => pick(["--e2e=4/3"]), /分份參數不對/);
  assert.throws(() => pick(["--unit", "--e2e=1/3"]), /不能同時用/);
  assert.throws(() => pick(["--e2e=1/3", "--e2e=2/3"]), /只能給一次/);
  assert.throws(() => pick(["--unti"]), /不認得的參數/, "打錯字不能默默跑全部");
  assert.throws(() => pick(["--e2e=1/3", "extra"]), /不認得的參數/);
});

test("CI 分份：--unit 只跑單元測試、--e2e 只跑瀏覽器測試、不帶參數跑全部", () => {
  assert.deepEqual(pick(["--unit"]), UNIT);
  assert.ok(pick(["--e2e=1/3"]).every(f => f.includes("/e2e/")));
  assert.equal(pick([]).length, UNIT.length + e2eFiles().length);
});

test("CI 分份：tests/ 底下的單元測試檔都登記在 UNIT", () => {
  assert.deepEqual(unregistered(), []);
});

test("CI 分份：ci.yml 保留名為 test 的彙總檢查，而且等所有分份都成功才算通過", () => {
  const y = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(y, /^  test:\n/m, "合併門檻看的是名為 test 的檢查（AGENTS.md），不能改名");
  assert.match(y, /needs: \[unit, e2e\]/);
  assert.match(y, /node tests\/run\.mjs --unit/);
  assert.match(y, /node tests\/run\.mjs --e2e=\$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\}/, "份數用 job-total，不會跟 matrix 對不上");
  assert.match(y, /^  test:\n    needs: \[unit, e2e\]\n    if: always\(\) &&/m, "test 要 always()，前面失敗時才會回報失敗而不是 skipped");
  assert.match(y, /fail-fast: false/, "一份失敗其他份照跑");
  const pw = y.match(/mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/), npm = y.match(/playwright@([\d.]+)/);
  assert.ok(pw && npm, "e2e 用 Playwright 官方容器，npm 也裝 playwright");
  assert.equal(pw[1], npm[1], "容器版本要和 npm 裝的 playwright 一致，否則找不到瀏覽器");
  assert.match(y, /options: --ipc=host/, "容器的 /dev/shm 太小，chromium 會崩潰");
  assert.match(y, /needs\.unit\.result.*success/s);
  assert.match(y, /needs\.e2e\.result.*success/s);
});
