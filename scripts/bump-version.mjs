// 合併前改版本號：一次改好 learner/index.html、learner/watch.html、learner/version.json，並在 learner/README.md 最新一節前面加「### 標題（版本）」。
// 用法：node scripts/bump-version.mjs "標題" ["這次改了什麼（可省略，之後再補）"]
// 版本格式 YYYY.MM.DD-N：日期是今天（台北時間），N 接著 version.json 目前的號碼加 1（N 不會每天歸零）。先合併最新 main 再執行，才不會跟別的 PR 撞號。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_RE = /^(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/;

export const twToday = (ms = Date.now()) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

export function parseVersion(v) {
  const m = String(v || "").match(VERSION_RE);
  if (!m) throw new Error(`version.json 的版本格式不對：${v}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), num: Number(m[4]) };
}

export function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const left = [pa.year, pa.month, pa.day, pa.num];
  const right = [pb.year, pb.month, pb.day, pb.num];
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function nextVersion(cur, today) {
  const m = String(cur || "").match(/^((?:\d{4}\.\d{2}\.\d{2})-(\d+))$/);
  if (!m) throw new Error(`version.json 的版本格式不對：${cur}`);
  const currentNum = Number(m[2]);
  return `${today.replace(/-/g, ".")}-${currentNum + 1}`;
}

export function addSection(md, title, ver, body = "") {
  if (md.includes(`（${ver}）`)) return md;

  const matches = [...md.matchAll(/^###\s+.*?（(\d{4}\.\d{2}\.\d{2}-\d+)）\s*$/gm)];
  if (!matches.length) throw new Error("README 找不到更新紀錄（### 標題（版本））");

  let latestMatch = matches[0];
  for (const match of matches.slice(1)) {
    if (compareVersion(match[1], latestMatch[1]) > 0) latestMatch = match;
  }

  const section = `### ${title}（${ver}）\n- ${body || "（待補：這次改了什麼）"}\n\n`;
  return md.slice(0, latestMatch.index) + section + md.slice(latestMatch.index);
}

export function swap(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`${file} 裡找不到目前的版本 ${from}`);
  return text.split(from).join(to);
}

export function writeFileAtomically(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [title, body] = process.argv.slice(2);
  if (!title) {
    console.error('用法：node scripts/bump-version.mjs "標題" ["這次改了什麼"]');
    process.exit(1);
  }

  const learnerDir = path.join(ROOT, "learner");
  const versionJsonPath = path.join(learnerDir, "version.json");
  const indexPath = path.join(learnerDir, "index.html");
  const watchPath = path.join(learnerDir, "watch.html");
  const readmePath = path.join(learnerDir, "README.md");

  const cur = JSON.parse(fs.readFileSync(versionJsonPath, "utf8")).v;
  const ver = nextVersion(cur, twToday());

  const outputs = {
    "version.json": JSON.stringify({ v: ver }) + "\n",
    "index.html": swap(fs.readFileSync(indexPath, "utf8"), cur, ver, "index.html"),
    "watch.html": swap(fs.readFileSync(watchPath, "utf8"), cur, ver, "watch.html"),
    "README.md": addSection(fs.readFileSync(readmePath, "utf8"), title, ver, body),
  };

  for (const [name, content] of Object.entries(outputs)) {
    writeFileAtomically(path.join(learnerDir, name), content);
  }

  console.log(`${cur} → ${ver}（index.html、watch.html、version.json、README.md）；接著跑 node tests/unit.test.mjs`);
}
