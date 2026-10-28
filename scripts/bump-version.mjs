// 合併前改版本號：一次改好 learner/index.html、learner/watch.html、learner/version.json，並在 learner/README.md 最新一節前面加「### 標題（版本）」。
// 用法：node scripts/bump-version.mjs "標題" ["這次改了什麼（可省略，之後再補）"]
// 版本格式 YYYY.MM.DD-N：日期是今天（台北時間），N 接著 version.json 目前的號碼加 1（N 不會每天歸零）。先合併最新 main 再執行，才不會跟別的 PR 撞號。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RE = /\d{4}\.\d{2}\.\d{2}-\d+/;
export const twToday = (ms = Date.now()) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
export function nextVersion(cur, today) {
  const m = String(cur || "").match(/^(\d{4}\.\d{2}\.\d{2})-(\d+)$/); if (!m) throw new Error(`version.json 的版本格式不對：${cur}`);
  return `${today.replace(/-/g, ".")}-${+m[2] + 1}`;
}
// README：在第一個「### …（版本）」前面插入新的一節；已經有這個版本就不重複加
export function addSection(md, title, ver, body = "") {
  if (md.includes(`（${ver}）`)) return md;
  const i = md.search(/^### .*（\d{4}\.\d{2}\.\d{2}-\d+）\s*$/m); if (i < 0) throw new Error("README 找不到更新紀錄（### 標題（版本））");
  return md.slice(0, i) + `### ${title}（${ver}）\n- ${body || "（待補：這次改了什麼）"}\n\n` + md.slice(i);
}
// html 裡的舊版本號全部換掉；一個都沒找到代表版本號在別的地方，停下來不要亂改
export function swap(text, from, to, file) { if (!text.includes(from)) throw new Error(`${file} 裡找不到目前的版本 ${from}`); return text.split(from).join(to); }

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [title, body] = process.argv.slice(2);
  if (!title) { console.error('用法：node scripts/bump-version.mjs "標題" ["這次改了什麼"]'); process.exit(1); }
  const f = p => path.join(ROOT, "learner", p), cur = JSON.parse(fs.readFileSync(f("version.json"), "utf8")).v, ver = nextVersion(cur, twToday());
  const out = {
    "version.json": JSON.stringify({ v: ver }) + "\n",
    "index.html": swap(fs.readFileSync(f("index.html"), "utf8"), cur, ver, "index.html"),
    "watch.html": swap(fs.readFileSync(f("watch.html"), "utf8"), cur, ver, "watch.html"),
    "README.md": addSection(fs.readFileSync(f("README.md"), "utf8"), title, ver, body)
  };
  for (const [k, v] of Object.entries(out)) fs.writeFileSync(f(k), v); // 全部算好才寫，中途出錯不會只改一半
  console.log(`${cur} → ${ver}（index.html、watch.html、version.json、README.md）；接著跑 node tests/unit.test.mjs`);
}
