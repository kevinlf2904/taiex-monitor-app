// 版本號檢查的純函式（#312 PR F 前置）：只做判斷、不讀寫檔案也不連網路，供之後 PR D 的 pr-guard 匯入提醒用。
// 方案 A 共識：PR 完全沒改這四個版本檔時跳過檢查；只要改到其中一個，就檢查格式、遞增、四檔一致與 README 最新一節標題。
import { parseVersion, compareVersion } from "./bump-version.mjs";

export const VERSION_FILES = [
  "learner/version.json",
  "learner/index.html",
  "learner/watch.html",
  "learner/README.md",
];

const fileName = f => (typeof f === "string" ? f : f?.filename);

// 只要 PR 改動（含改名前的原路徑）觸及四個版本檔之一才檢查
export function touchesVersionFiles(files = []) {
  for (const f of files || []) {
    if (VERSION_FILES.includes(fileName(f))) return true;
    if (f && typeof f !== "string" && VERSION_FILES.includes(f.previous_filename)) return true;
  }
  return false;
}

function readContent(map, file) {
  if (!map || typeof map !== "object") return undefined;
  return Object.hasOwn(map, file) ? map[file] : undefined;
}

function tryParseVersion(v) {
  if (typeof v !== "string" || !v) return null;
  try {
    return parseVersion(v);
  } catch {
    return null;
  }
}

export function extractVersionJson(text) {
  if (typeof text !== "string" || !text.trim()) return { version: null, error: "learner/version.json 缺少或內容為空" };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { version: null, error: "learner/version.json 不是合法的 JSON" };
  }
  const v = typeof data?.v === "string" ? data.v.trim() : "";
  if (!v) return { version: null, error: "learner/version.json 缺少字串欄位 v" };
  return { version: v, error: null };
}

export function extractHtmlVersion(text, file = "HTML") {
  if (typeof text !== "string" || !text.trim()) return { version: null, error: `${file} 缺少或內容為空` };
  // 去掉 <script>、<style> 與註解，避免 watch.html 程式碼裡的「/版本 (\S+)/」這類字面樣式干擾比對
  const body = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const found = [...body.matchAll(/版本[ \t]+([^\s<"']+)/g)].map(m => m[1]);
  const uniq = [...new Set(found)];
  if (!uniq.length) return { version: null, error: `${file} 找不到「版本 ...」標記` };
  if (uniq.length > 1) return { version: null, error: `${file} 內出現多個不一致的版本字串：${uniq.join("、")}` };
  return { version: uniq[0], error: null };
}

export function extractReadmeLatestVersion(text) {
  if (typeof text !== "string" || !text.trim()) return { version: null, error: "learner/README.md 缺少或內容為空" };
  const norm = text.replace(/\r\n/g, "\n");
  // 與 scripts/bump-version.mjs 的 addSection 一致，只比對「### 標題（YYYY.MM.DD-N）」，避免說明章節的（檔案名／2 種口徑）誤判
  const matches = [...norm.matchAll(/^###\s+\S.*?（(\d{4}\.\d{2}\.\d{2}-\d+)）\s*$/gm)];
  if (!matches.length) return { version: null, error: "learner/README.md 找不到最新一節標題（### 標題（YYYY.MM.DD-N））" };
  return { version: matches[0][1].trim(), error: null };
}

export function extractAllVersions(filesMap = {}) {
  return {
    "learner/version.json": extractVersionJson(readContent(filesMap, "learner/version.json")),
    "learner/index.html": extractHtmlVersion(readContent(filesMap, "learner/index.html"), "learner/index.html"),
    "learner/watch.html": extractHtmlVersion(readContent(filesMap, "learner/watch.html"), "learner/watch.html"),
    "learner/README.md": extractReadmeLatestVersion(readContent(filesMap, "learner/README.md")),
  };
}

// files：PR 改動的檔案清單；base／head：包含四個版本檔內容的物件
// 回傳：{ checked, ok, problems }，只用於提醒、不擋合併
export function checkVersion({ files = [], base = {}, head = {} } = {}) {
  if (!touchesVersionFiles(files)) return { checked: false, ok: true, problems: [] };

  const problems = [];
  const headVers = extractAllVersions(head);

  for (const file of VERSION_FILES) {
    const item = headVers[file];
    if (item.error) {
      problems.push(item.error);
      item.valid = false;
      continue;
    }
    if (!tryParseVersion(item.version)) {
      problems.push(`${file} 的版號格式不對（${item.version}），應為 YYYY.MM.DD-N`);
      item.valid = false;
      continue;
    }
    item.valid = true;
  }

  const present = VERSION_FILES.filter(f => headVers[f].version !== null);
  const uniq = [...new Set(present.map(f => headVers[f].version))];
  if (uniq.length > 1) {
    problems.push(`四個檔案的版本號不一致：${present.map(f => `${f}=${headVers[f].version}`).join("、")}`);
  }

  const headJsonVer = headVers["learner/version.json"].valid ? headVers["learner/version.json"].version : null;
  const readmeVer = headVers["learner/README.md"].version;
  if (headJsonVer && readmeVer && readmeVer !== headJsonVer) {
    problems.push(`learner/README.md 最新一節標題版號（${readmeVer}）與 ${headJsonVer} 不符`);
  }

  const baseJson = extractVersionJson(readContent(base, "learner/version.json"));
  const baseParsed = baseJson.error ? null : tryParseVersion(baseJson.version);
  if (baseJson.error) {
    problems.push(`main（base）${baseJson.error}，無法比較版號`);
  } else if (!baseParsed) {
    problems.push(`main（base）的 learner/version.json 版號格式不對（${baseJson.version}），應為 YYYY.MM.DD-N`);
  } else {
    const compareTarget = headJsonVer || VERSION_FILES.map(f => headVers[f]).find(x => x.valid)?.version;
    if (compareTarget) {
      const headParsed = parseVersion(compareTarget);
      if (compareVersion(compareTarget, baseJson.version) <= 0) {
        problems.push(`head 版號（${compareTarget}）沒有大於 main（${baseJson.version}）`);
      } else if (headParsed.num <= baseParsed.num) {
        problems.push(`head 版號序號 N（${headParsed.num}）必須大於 main（${baseParsed.num}，N 不每日歸零）`);
      }
    }
  }

  return { checked: true, ok: problems.length === 0, problems };
}
