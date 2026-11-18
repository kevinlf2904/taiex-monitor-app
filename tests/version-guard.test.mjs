// 版本號檢查的純函式測試（#312 任務 1／PR F 前置）：全部使用固定假資料，不讀寫檔案、不連網路。
import test from "node:test";
import assert from "node:assert/strict";
import { VERSION_FILES, touchesVersionFiles, checkVersion } from "../scripts/version-guard.mjs";

// 貼近實際四個版本檔格式的固定假資料工廠（含 watch.html 的 <script> 與 README 說明小節）
function makeState(ver, { readmeTitle = "測試更新", watchExtra = "", readmeBody = "- 更新內容", prevReadme = "" } = {}) {
  return {
    "learner/version.json": JSON.stringify({ v: ver }) + "\n",
    "learner/index.html": `<footer><span>版本說明</span><span class="ver">版本 ${ver}</span></footer>\n`,
    "learner/watch.html": `<p><span class="num">版本 ${ver}</span></p>${watchExtra}\n<script>const re = /版本 (\\S+)/;</script>\n`,
    "learner/README.md": `# 說明\n\n## 功能\n\n### 介面（\`learner/core.css\`）\n- 說明\n\n### ${readmeTitle}（${ver}）\n${readmeBody}\n${prevReadme}`,
  };
}

const BASE_VER = "2026.11.17-241";
const BASE = makeState(BASE_VER, {
  readmeTitle: "庫存入口收斂與自動對帳",
  prevReadme: "\n### 選股訊號回測（2026.11.16-240）\n- 舊紀錄\n",
});

test("version-guard：清單固定涵蓋四個版本相關檔案", () => {
  assert.deepEqual(VERSION_FILES, [
    "learner/version.json",
    "learner/index.html",
    "learner/watch.html",
    "learner/README.md",
  ]);
});

test("version-guard：完全沒改四個版本檔時跳過檢查（方案 A，避免開發中誤報）", () => {
  assert.equal(touchesVersionFiles([]), false);
  assert.equal(touchesVersionFiles(["docs/notes.md", "scripts/pr-guard.mjs", { filename: "learner/core.js", status: "modified" }]), false);

  const r1 = checkVersion({
    files: ["scripts/pr-guard.mjs", { filename: "learner/core.js", status: "modified" }],
    base: BASE,
    head: makeState(BASE_VER),
  });
  assert.deepEqual(r1, { checked: false, ok: true, problems: [] });

  // 未觸及版本檔時，即使 base/head 為空也直接跳過
  const r2 = checkVersion({ files: ["docs/readme.md"], base: {}, head: {} });
  assert.deepEqual(r2, { checked: false, ok: true, problems: [] });
});

test("version-guard：只要改到四檔之一（含物件或改名原路徑）就觸發檢查", () => {
  for (const f of [
    "learner/version.json",
    "learner/index.html",
    "learner/watch.html",
    "learner/README.md",
    { filename: "learner/version.json", status: "modified" },
    { filename: "docs/moved.md", previous_filename: "learner/README.md", status: "renamed" },
  ]) {
    assert.equal(touchesVersionFiles([f]), true, JSON.stringify(f));
  }
});

test("version-guard：四個檔案版本號一致、格式正確、最新節帶版號且大於 main 時通過", () => {
  const head = makeState("2026.11.18-242", {
    readmeTitle: "PR 版本檢查",
    prevReadme: `\n### 庫存入口收斂與自動對帳（${BASE_VER}）\n- 舊紀錄\n`,
  });
  const res = checkVersion({
    files: ["learner/core.js", ...VERSION_FILES],
    base: BASE,
    head,
  });
  assert.deepEqual(res, { checked: true, ok: true, problems: [] });

  // 同一天序號遞增、或跨日序號從 1 起算（依 compareVersion 年＞月＞日＞號）也應通過
  assert.equal(checkVersion({
    files: [{ filename: "learner/index.html", status: "modified" }],
    base: BASE,
    head: makeState("2026.11.17-242", { prevReadme: `\n### 舊（${BASE_VER}）\n` }),
  }).ok, true);

  assert.equal(checkVersion({
    files: ["learner/version.json"],
    base: BASE,
    head: makeState("2026.11.18-1", { prevReadme: `\n### 舊（${BASE_VER}）\n` }),
  }).ok, true);
});

test("version-guard：版本號沒有大於 main 時回報問題", () => {
  for (const notNewer of [BASE_VER, "2026.11.17-240", "2026.11.16-999"]) {
    const res = checkVersion({
      files: ["learner/watch.html"],
      base: BASE,
      head: makeState(notNewer),
    });
    assert.equal(res.checked, true, notNewer);
    assert.equal(res.ok, false, notNewer);
    assert.ok(res.problems.length >= 1, notNewer);
    assert.match(res.problems.join("\n"), /大於|main/, notNewer);
  }
});

test("version-guard：四個檔案版本號不一致（任一檔漏改或 HTML 內部有兩處不一致）時回報問題", () => {
  const newVer = "2026.11.18-242";
  for (const staleFile of VERSION_FILES) {
    const head = makeState(newVer);
    head[staleFile] = BASE[staleFile];
    const res = checkVersion({ files: VERSION_FILES, base: BASE, head });
    assert.equal(res.checked, true, staleFile);
    assert.equal(res.ok, false, staleFile);
    assert.match(res.problems.join("\n"), new RegExp(staleFile.replace(".", "\\.")), staleFile);
  }

  // 單一 HTML 檔出現兩個不同版本字串也應偵測
  const splitWatch = makeState(newVer, { watchExtra: `<span>版本 ${BASE_VER}</span>` });
  const rSplit = checkVersion({ files: ["learner/watch.html"], base: BASE, head: splitWatch });
  assert.equal(rSplit.checked, true);
  assert.equal(rSplit.ok, false);
  assert.match(rSplit.problems.join("\n"), /watch\.html/);
});

test("version-guard：版本格式不是 YYYY.MM.DD-N 或 version.json 毀損時回報問題（不拋錯崩潰）", () => {
  for (const badVer of ["1.2.3", "2026.11.18", "2026.1.18-242", "v2026.11.18-242", "2026.11.18-abc"]) {
    const res = checkVersion({
      files: VERSION_FILES,
      base: BASE,
      head: makeState(badVer),
    });
    assert.equal(res.checked, true, badVer);
    assert.equal(res.ok, false, badVer);
    assert.match(res.problems.join("\n"), /格式|YYYY\.MM\.DD-N/, badVer);
  }

  const badJson = makeState("2026.11.18-242");
  badJson["learner/version.json"] = "{not-json";
  const rJson = checkVersion({ files: ["learner/version.json"], base: BASE, head: badJson });
  assert.equal(rJson.checked, true);
  assert.equal(rJson.ok, false);
  assert.match(rJson.problems.join("\n"), /version\.json/);

  const badBase = makeState("2026.11.18-242");
  const rBase = checkVersion({
    files: VERSION_FILES,
    base: makeState("bad-base"),
    head: badBase,
  });
  assert.equal(rBase.checked, true);
  assert.equal(rBase.ok, false);
  assert.match(rBase.problems.join("\n"), /main|base|格式/);
});

test("version-guard：README 沒在最新一節標題帶入新版號時回報問題", () => {
  const newVer = "2026.11.18-242";

  // 1. README 完全沒新增章節（維持舊版號）
  const staleReadme = makeState(newVer);
  staleReadme["learner/README.md"] = BASE["learner/README.md"];
  const r1 = checkVersion({ files: VERSION_FILES, base: BASE, head: staleReadme });
  assert.equal(r1.ok, false);
  assert.match(r1.problems.join("\n"), /README\.md/);

  // 2. README 加了標題但沒帶版本、只寫在內文
  const proseOnly = makeState(newVer);
  proseOnly["learner/README.md"] = `# 說明\n\n### 沒帶版本的標題\n- 版本 ${newVer}\n\n### 舊功能（${BASE_VER}）\n- 舊\n`;
  const r2 = checkVersion({ files: VERSION_FILES, base: BASE, head: proseOnly });
  assert.equal(r2.ok, false);
  assert.match(r2.problems.join("\n"), /README\.md/);

  // 3. 新版章節加在舊版下方，而非最上方最新一節
  const appendedBottom = makeState(newVer);
  appendedBottom["learner/README.md"] = `# 說明\n\n### 舊功能（${BASE_VER}）\n- 舊\n\n### 放錯位置的新功能（${newVer}）\n- 新\n`;
  const r3 = checkVersion({ files: VERSION_FILES, base: BASE, head: appendedBottom });
  assert.equal(r3.ok, false);
  assert.match(r3.problems.join("\n"), /README\.md/);

  // 4. README 找不到任何版本章節標題
  const noSection = makeState(newVer);
  noSection["learner/README.md"] = `# 說明\n\n只有一般文字 ${newVer}\n`;
  const r4 = checkVersion({ files: VERSION_FILES, base: BASE, head: noSection });
  assert.equal(r4.ok, false);
  assert.match(r4.problems.join("\n"), /README\.md/);
});
