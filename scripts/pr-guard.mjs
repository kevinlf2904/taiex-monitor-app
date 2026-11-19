// PR 檢查的純函式（#312 PR B）：依 AGENTS.md 判斷改動檔案的風險、大檔鎖定與衝突、介面驗證需求，並解析 AI 協作留言。
// 只做判斷、不連網路也不寫任何東西；本機的 scripts/pr-brief.mjs 與之後的 pr-guard workflow 都用這裡的函式，結果才會一致。
// 判斷只是提醒：「測試沒有放寬斷言」「CSS 只改規則」這類程式看不出來的條件，仍由合併者確認（AGENTS.md「低風險例外」）。

// AGENTS.md「核心限制」：改這四個檔案前要先上鎖（「鎖：」draft PR）
export const BIG_FILES = ["learner/watch.html", "learner/index.html", "learner/core.js", "learner/brief.js"];

// 策略、回測、績效、帳務計算：AGENTS.md 要求獨立審查（不只 scripts/，learner/ 裡也有）。清單是提醒用，不保證完整
export const CROSS_REVIEW_FILES = [
  "learner/core.js", "learner/analysis.js", "learner/quant.js", "learner/sigstudy.js", "learner/labx.js",
  "learner/perf.js", "learner/recon.js", "learner/ledger.js", "learner/portfolio.js", "learner/rebal.js",
  "learner/stress.js", "learner/alloc.js", "learner/margin.js", "learner/divcal.js", "learner/overview.js",
  "scripts/_engine.mjs", "scripts/levels-bt.mjs", "scripts/signal-study.mjs", "scripts/event-study.mjs",
  "scripts/pattern-today.mjs", "scripts/theme-corr.mjs",
];

const RULE_FILES = ["AGENTS.md", "CLAUDE.md"];
const name = f => (typeof f === "string" ? f : f.filename);
const under = (p, dir) => p.startsWith(dir);

// 低風險例外的路徑範圍（只看路徑；刪除測試檔一律不算）
export function inLowRiskScope(f) {
  const p = name(f);
  if (RULE_FILES.includes(p) || under(p, ".agent/") || under(p, ".github/")) return false;
  if (under(p, "tests/")) return f.status !== "removed";
  if (p === "learner/core.css" || p === "learner/minimal.css") return true;
  if (under(p, "docs/")) return true;
  return p.endsWith(".md") && !under(p, "learner/data/");
}

// 高風險：協作規則、workflow、API、排程腳本、套件、部署設定、排程產物，以及策略／績效相關檔案
export function highRiskReason(f) {
  const p = name(f);
  if (RULE_FILES.includes(p) || under(p, ".agent/")) return "協作規則";
  if (under(p, ".github/workflows/")) return "workflow";
  if (under(p, ".github/")) return "GitHub 設定／範本";
  if (under(p, "api/")) return "API";
  if (under(p, "learner/data/")) return "排程產物（learner/data/）";
  if (CROSS_REVIEW_FILES.includes(p)) return "策略／回測／績效";
  if (under(p, "scripts/")) return "排程／腳本";
  if (p === "vercel.json") return "部署設定";
  if (p === "package.json" || p === "package-lock.json") return "套件";
  return null;
}

// 介面要做 390／1280 驗證：learner/ 底下的網頁、樣式、前端程式；版本號、說明文件與排程資料不算
export function needsUiVerify(f) {
  const p = name(f);
  if (!under(p, "learner/") || under(p, "learner/data/")) return false;
  if (p === "learner/version.json" || p.endsWith(".md")) return false;
  return /\.(html|css|js)$/.test(p);
}

// diff 裡淨刪掉的斷言行數（刪掉的減新增的；只看測試檔、有 patch 才算）。改寫同一行斷言不算刪除
export function removedAsserts(f) {
  if (typeof f === "string" || !f.patch || !under(f.filename, "tests/")) return 0;
  const lines = f.patch.split("\n"), isAssert = l => /\bassert\b|\bexpect\(/.test(l);
  const del = lines.filter(l => l.startsWith("-") && !l.startsWith("---") && isAssert(l)).length;
  const add = lines.filter(l => l.startsWith("+") && !l.startsWith("+++") && isAssert(l)).length;
  return Math.max(0, del - add);
}

// 前端程式新增了 localStorage 相關的行（AGENTS.md：新增資料鍵要用獨立前綴與版本）
export function addsLocalStorage(f) {
  if (typeof f === "string" || !f.patch || !under(f.filename, "learner/")) return false;
  return f.patch.split("\n").some(l => l.startsWith("+") && !l.startsWith("+++") && /localStorage/.test(l));
}

// 改名的檔案：原路徑視為「刪除」、新路徑視為「新增」一起判斷（例如把 tests/ 或 api/ 的檔案改名成 docs/ 不能變成低風險）
export function expandRenames(files) {
  return files.map(f => (typeof f === "string" ? { filename: f } : f)).flatMap(f =>
    f.status === "renamed" && f.previous_filename ? [{ ...f, status: "added" }, { filename: f.previous_filename, status: "removed" }] : [f]);
}

// 刪除測試檔（AGENTS.md：刪除測試不適用低風險例外，要人工審查）
export const isTestDeletion = f => typeof f !== "string" && f.status === "removed" && under(f.filename, "tests/");

// files：字串，或 GitHub「PR 檔案」API 的物件（filename、status、patch、previous_filename）
export function classify(files) {
  const list = expandRenames(files);
  const reasons = [];
  const high = list.map(f => [f.filename, highRiskReason(f)]).filter(([, r]) => r);
  const lowRisk = list.length > 0 && list.every(inLowRiskScope);
  const needsLock = list.map(name).filter(p => BIG_FILES.includes(p));
  const crossReview = list.map(name).filter(p => CROSS_REVIEW_FILES.includes(p));
  const ui = list.filter(needsUiVerify).map(name);
  const warnings = [];
  for (const f of list) {
    const n = removedAsserts(f);
    if (n) warnings.push(`${f.filename} 刪除了 ${n} 行斷言，請確認沒有放寬測試`);
    if (addsLocalStorage(f)) { warnings.push(`${f.filename} 新增了 localStorage 相關程式，請確認使用獨立前綴與版本、不清除既有資料`); crossReview.includes(f.filename) || crossReview.push(f.filename); }
  }
  const labels = [];
  if (lowRisk) { labels.push("low-risk-candidate"); reasons.push("所有檔案都在低風險例外的路徑範圍內（仍須合併者確認斷言沒有放寬、CSS 只改規則）"); }
  if (high.length) { labels.push("high-risk"); for (const [p, r] of high) reasons.push(`${p}：${r}`); }
  if (crossReview.length) reasons.push(`需要獨立審查：${crossReview.join("、")}`);
  const deletedTests = list.filter(isTestDeletion).map(name);
  if (deletedTests.length) { labels.push("test-deletion"); reasons.push(`刪除測試檔：${deletedTests.join("、")}（不適用低風險例外，需要人工審查）`); }
  if (needsLock.length) labels.push("needs-lock");
  if (ui.length) labels.push("needs-390-1280");
  if (!list.length) reasons.push("沒有改動檔案");
  return { labels, lowRisk, highRisk: high.length > 0, needsLock, crossReview, ui, deletedTests, warnings, reasons };
}

// 「鎖：learner/watch.html＋區塊」標題裡提到的大檔
export function lockedByTitle(title = "") {
  if (!/^\s*鎖[:：]/.test(title)) return [];
  return BIG_FILES.filter(f => title.includes(f) || title.includes(f.split("/").pop()));
}

// 和其他開著的 PR 撞到同一個大檔。pr：{ number, files }；others：[{ number, title, draft, files }]
// 自己這個 PR 不算；其他 PR 不管是改到大檔，還是「鎖：」標題鎖住大檔，都列出來
export function bigFileConflicts(pr, others) {
  const mine = new Set(expandRenames(pr.files).map(name).filter(p => BIG_FILES.includes(p)));
  const out = [];
  for (const o of others) {
    if (o.number === pr.number) continue;
    const theirs = new Set([...expandRenames(o.files || []).map(name).filter(p => BIG_FILES.includes(p)), ...lockedByTitle(o.title)]);
    const both = [...mine].filter(p => theirs.has(p));
    if (both.length) out.push({ number: o.number, title: o.title, lock: lockedByTitle(o.title).length > 0, files: both });
  }
  return out;
}

// AI 協作留言第一行：「審查（Codex）：`abc1234` …」「請求（Claude Code → ChatGPT）：…」「驗證：…」
const KINDS = "審查|驗證|處置|交接|請求|檢查|討論";
const HEAD_RE = new RegExp(`^\\s*(?:#+\\s*)?(${KINDS})(?:（([^）]*)）)?\\s*[:：]`);
export function parseAiComment(body = "") {
  const first = String(body).split("\n").find(l => l.trim()) || "";
  const m = first.match(HEAD_RE);
  if (!m) return null;
  const [from, to] = (m[2] || "").split(/\s*→\s*/).map(s => s.trim());
  const sha = (first.match(/\b[0-9a-f]{7,40}\b/) || [])[0] || null;
  const verdict = (first.match(/可以合併|修改後再合併|不建議合併/) || [])[0] || null;
  return { kind: m[1], from: from || null, to: to || null, sha, verdict, line: first.trim() };
}

// SHA 是否指同一個提交（短 SHA 比前綴）
export const sameSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

// comments：[{ id, created_at, body, source?, commit_id? }]，來源可以是一般留言、review 或 inline review comment。
// 回傳看得懂的 AI 留言與它針對的版本：latest（最新 head SHA）、stale（舊 SHA，審查不算數）、nosha（沒寫 SHA，無法核對，不能當成最新）。
// 第一行沒寫 SHA、但 GitHub 記錄了 review 針對的提交（commit_id）時，用 commit_id 判斷。同一來源同一 id 只列一次。
export function summarizeComments(comments, headSha) {
  const seen = new Set(), out = [];
  for (const c of comments) {
    const key = `${c.source || "comment"}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ai = parseAiComment(c.body);
    if (!ai) continue;
    const sha = ai.sha || c.commit_id || null;
    out.push({ id: c.id, at: c.created_at, source: c.source || "comment", ...ai, sha, state: !sha ? "nosha" : sameSha(sha, headSha) ? "latest" : "stale" });
  }
  return out;
}

// 判斷 CI test 是否算通過（AGENTS.md「測試與品質」：同一 head SHA、completed、success）
export function ciStatus(checkRuns, headSha, name = "test") {
  const runs = checkRuns.filter(r => r.name === name && r.head_sha === headSha);
  if (!runs.length) return { ok: false, text: `沒有 ${headSha.slice(0, 7)} 的 ${name} 結果` };
  const r = runs.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)) || (b.id || 0) - (a.id || 0))[0];
  if (r.status !== "completed") return { ok: false, text: `${name} 進行中（${r.status}）` };
  return { ok: r.conclusion === "success", text: `${name} ${r.conclusion}`, url: r.html_url };
}

// 給人和 AI 看的摘要（pr-brief 印在終端機；之後 workflow 也用同一段文字貼留言）
const STATE = { latest: "〔最新〕", stale: "〔舊 SHA〕", nosha: "〔未附 SHA〕" };
const SOURCE = { comment: "（留言）", review: "（review）", inline: "（行內）" };

// ---- PR 說明檢查（#312 PR E）：只提醒、不擋合併 ----
// .github/pull_request_template.md 的五個段落，都要有內容（範本裡的 <!-- 註解 --> 不算）
export const TEMPLATE_SECTIONS = ["誰做的", "改了什麼", "還沒做完", "測試", "驗證重點"];

// GitHub 不會把 HTML 註解、程式碼區塊裡的字當成標題或關閉關鍵字。
// 逐行掃描，同時記住「在 ``` / ~~~ 區塊裡」和「在 <!-- 註解裡」兩種狀態：區塊裡的 <!-- 只是文字，註解裡的 ``` 也不算區塊。
// 回傳 [{ line, code, prose }]：code＝這行在 fenced code block 裡（含開頭與結尾的 ``` 行，原樣保留）；
// 其他行 line 已去掉 HTML 註解（`行內程式碼` 裡的 <!-- 不算註解），prose 再去掉行內程式碼（給關閉關鍵字用）。
// 行內程式碼照 CommonMark：結尾要是長度完全相同的反引號串，可以在同一段落內跨行（#320 ChatGPT P3）；
// 整段都找不到結尾就當一般文字。空行、標題、--- ／ ===、``` 區塊開頭、清單項目開頭、> 引用、< 開頭的 HTML 都會結束段落，
// 標題行本身也不會往下延伸。拿不準時寧可當成段落結束：最多多算一個 Closes（多提醒），不會漏算（#324 ChatGPT P2）。
const BLOCK_END = /^\s*$|^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|[-=]+[ \t]*$|(?:[-*_][ \t]*){3,}$|[-*+][ \t]|\d{1,9}[.)][ \t]|>|<[A-Za-z!?/])/;
const tickRun = (s, n, from = 0) => { for (const r of s.slice(from).matchAll(/`+/g)) if (r[0].length === n) return from + r.index; return -1; };
export function markdownLines(body = "") {
  const out = [];
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  let fence = null, inComment = false, span = 0; // span＝跨行中的行內程式碼反引號數
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (fence) {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out.push({ line, code: true });
      continue;
    }
    let text = line, kept = "", prose = "", start = 0;
    if (span) {
      const close = tickRun(line, span);
      if (close < 0) { out.push({ line, code: false, prose: "" }); continue; }
      kept = line.slice(0, close + span); prose = " "; start = close + span; span = 0;
    } else if (inComment) {
      const end = text.indexOf("-->");
      if (end < 0) { out.push({ line: "", code: false, prose: "" }); continue; }
      text = text.slice(end + 3); inComment = false;
    } else {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`"))) { fence = m[1]; out.push({ line, code: true }); continue; }
    }
    for (let i = start; i < text.length;) {
      if (text[i] === "`") {
        const n = text.slice(i).match(/^`+/)[0].length;
        const close = tickRun(text, n, i + n);
        if (close >= 0) { kept += text.slice(i, close + n); prose += " "; i = close + n; continue; }
        // 同一行沒有結尾：往下找同一段落（標題行不往下找）
        if (!/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
          let j = k + 1;
          while (j < lines.length && !BLOCK_END.test(lines[j]) && tickRun(lines[j], n) < 0) j++;
          if (j < lines.length && !BLOCK_END.test(lines[j])) { kept += text.slice(i); prose += " "; span = n; break; }
        }
        kept += text.slice(i, i + n); prose += text.slice(i, i + n); i += n; continue;
      }
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        if (end < 0) { inComment = true; break; }
        i = end + 3; continue;
      }
      prose += text[i]; kept += text[i++];
    }
    out.push({ line: kept, code: false, prose });
  }
  return out;
}

// 依「## 標題」切段落；程式碼區塊裡的「## 」不算標題，但區塊本身算段落內容（例如貼測試輸出）。內容去掉 HTML 註解與空白
export function sections(body = "") {
  const out = {};
  let cur = null;
  for (const { line, code } of markdownLines(body)) {
    const m = !code && line.match(/^##\s+(.+?)\s*$/);
    if (m) { cur = m[1]; out[cur] = ""; continue; }
    if (cur !== null) out[cur] += line + "\n";
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

// 說明裡「Closes／Fixes／Resolves #N」關閉的編號（GitHub 認得的關閉關鍵字）；HTML 註解、程式碼區塊、`行內程式碼` 裡的不算
export function closingRefs(body = "") {
  const prose = markdownLines(body).filter(x => !x.code).map(x => x.prose).join("\n");
  return [...new Set([...prose.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)].map(m => Number(m[1])))];
}

// gh api 失敗時的 HTTP 狀態碼（gh 會在錯誤訊息印出「HTTP 404」之類）；看不出來回 0
export const httpStatus = e => Number((`${e?.stderr ?? ""}\n${e?.message ?? e}`.match(/HTTP (\d{3})/) || [])[1]) || 0;

// refs：[{ number, exists, isPR, error }]（由 GitHub API 查到的，見 scripts/pr-brief.mjs 的 collect）
// exists 只有查到 404 才是 false；403／429／5xx 等查詢失敗時 exists 是 null、error 是狀態碼，只提醒「查詢失敗」，不說編號不存在
export function checkTemplate({ body = "", files = [], refs = [], headSha = "" } = {}) {
  const problems = [], notes = [];
  const sec = sections(body);
  for (const name of TEMPLATE_SECTIONS) {
    if (!(name in sec)) problems.push(`PR 說明缺少「## ${name}」段落`);
    else if (!sec[name]) problems.push(`「## ${name}」是空的（只有範本註解不算；沒有就寫「無」）`);
  }
  for (const r of refs) {
    if (r.exists == null) notes.push(`Closes #${r.number} 查詢失敗${r.error ? `（HTTP ${r.error}）` : ""}：無法確認編號是否存在，請自行確認`);
    else if (!r.exists) problems.push(`Closes #${r.number} 指向不存在的編號（AGENTS.md：不得虛構編號）`);
    else if (r.isPR) problems.push(`Closes #${r.number} 是 PR 不是 Issue`);
  }
  const test = sec["測試"] || "";
  // 不在低風險例外的路徑範圍（含刪除測試檔）就不能寫「是」；沒有檔案清單時不判斷
  if (files.length && !classify(files).lowRisk && /低風險例外[^\n]*?[：:]\s*[*`「]*是/.test(test)) problems.push("有檔案不在低風險例外範圍，「低風險例外」不能寫「是」");
  const shas = [...new Set((String(body || "").match(/\b[0-9a-f]{40}\b/g) || []))];
  if (headSha && shas.length && !shas.some(x => x === headSha)) notes.push(`說明裡寫的 SHA 都不是最新 head（${headSha.slice(0, 7)}）：推送後記得更新測試結果對應的 SHA`);
  return { ok: problems.length === 0, problems, notes };
}

// pr-guard 狀態看板留言的記號（.github/workflows/pr-guard.yml 用它找到同一則留言原地更新；摘要本身不列入留言清單）
export const BOARD_MARK = "<!-- pr-guard -->";
// 看板＝機器人貼的一般留言、內文帶記號；人寫的留言就算提到記號字串也不算（不會被藏起來）
export const isBoard = x => !!x?.bot && (x.source || "comment") === "comment" && String(x.body || "").includes(BOARD_MARK);

export function formatBrief({ pr, files, comments = [], checkRuns = [], others = [], refs = [] }) {
  const head = pr.head.sha;
  const c = classify(files);
  const ci = ciStatus(checkRuns, head);
  const conflicts = bigFileConflicts({ number: pr.number, files }, others);
  comments = comments.filter(x => !isBoard(x));
  const ai = summarizeComments(comments, head).sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))); // 三種來源依時間排在一起
  const aiKeys = new Set(ai.map(a => `${a.source}:${a.id}`));
  // 不是協作格式的留言（使用者的決定、一般討論、review、行內審查）也不能當作不存在：列出筆數與第一行，依時間排序後取最新的。
  // 只排除一般留言裡的機器人留言（例如 Vercel 部署通知）；機器人送的 review／行內審查（例如 Copilot，AGENTS.md 的大型 PR 審查）一律保留
  const otherComments = comments
    .filter(x => !(x.bot && (x.source || "comment") === "comment") && String(x.body || "").trim() && !aiKeys.has(`${x.source || "comment"}:${x.id}`))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const L = [];
  L.push(`檢查（pr-guard）：\`${head}\``, "");
  L.push(`#${pr.number} ${pr.title}${pr.draft ? "（draft）" : ""}｜分支 ${pr.head.ref}｜${files.length} 個檔案`);
  L.push(`CI：${ci.ok ? "✅" : "⏳／❌"} ${ci.text}${ci.url ? `（${ci.url}）` : ""}`);
  L.push(`標籤：${c.labels.length ? c.labels.join("、") : "無"}`);
  for (const r of c.reasons) L.push(`- ${r}`);
  for (const w of c.warnings) L.push(`- ⚠️ ${w}`);
  if (c.needsLock.length) L.push(`- 改到大檔：${c.needsLock.join("、")}（要先確認「鎖：」draft PR）`);
  for (const x of conflicts) L.push(`- ⚠️ 和 #${x.number}${x.lock ? "（鎖定中）" : ""} 撞到：${x.files.join("、")}`);
  if (c.ui.length) L.push(`- 介面檔案：需要 390／1280 驗證（Antigravity；Antigravity 是實作者時由 Claude Code）`);
  if (!c.lowRisk && !c.highRisk && files.length) L.push("- 不在低風險例外範圍，也不在 high-risk 清單：照一般審查（清單沒列到不代表低風險）");
  const t = checkTemplate({ body: pr.body, files, refs, headSha: head });
  L.push("", t.problems.length ? `PR 說明：⚠️ ${t.problems.length} 項待補（只是提醒）` : "PR 說明：✅ 五個段落都有內容");
  for (const x of t.problems) L.push(`- ${x}`);
  for (const x of t.notes) L.push(`- 提醒：${x}`);
  L.push("", ai.length ? "AI 留言：" : "AI 留言：無");
  for (const a of ai) L.push(`- ${STATE[a.state]}${a.kind}${a.from ? `（${a.from}${a.to ? ` → ${a.to}` : ""}）` : ""}${a.verdict ? ` ${a.verdict}` : ""}${a.source === "comment" ? "" : SOURCE[a.source]}｜${a.at || ""}｜${a.id}`);
  if (ai.some(a => a.state === "nosha")) L.push("- ⚠️ 有留言沒寫 SHA，無法確認針對哪個版本，請補留言或重新審查");
  if (otherComments.length) {
    L.push(`其他留言（不是協作格式，請自行讀全文）：${otherComments.length} 則`);
    for (const x of otherComments.slice(-15)) L.push(`- ${SOURCE[x.source || "comment"]}${x.path ? `${x.path}｜` : ""}${String(x.body).trim().split("\n")[0].slice(0, 80)}｜${x.created_at || ""}｜${x.id}`);
    if (otherComments.length > 15) L.push(`- （只列最新 15 則，較早的 ${otherComments.length - 15} 則請到 PR 頁面看）`);
  }
  return L.join("\n");
}
