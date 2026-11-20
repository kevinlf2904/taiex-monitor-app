// 列出這次 Claude Code session 每一步（每次模型回應）的 token 用量和累計總量，給回報時附上。
// 用法：node scripts/token-usage.mjs            只列上次執行之後新增的步驟＋整個 session 累計
//       node scripts/token-usage.mjs --all      列出全部步驟
//       node scripts/token-usage.mjs --no-save  不記錄「已回報到第幾步」（下次仍從同一處開始列）
//       node scripts/token-usage.mjs --file <紀錄檔.jsonl>  指定紀錄檔（預設找目前目錄對應的最新 session）
// 資料來源：~/.claude/projects/<目錄>/<session>.jsonl；子代理的紀錄在 <session>/subagents/*.jsonl，一併計入。
// 同一次回應在紀錄檔可能出現好幾行（usage 相同），依 message.id 去重，只算一次。
// 注意：訂閱方案的額度只顯示百分比（/usage），token 與百分比的換算沒有公開，這裡只算 token。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FIELDS = ["input", "cacheWrite", "cacheRead", "output", "thinking"];

// 把一份 jsonl 文字解析成步驟陣列（依 message.id 去重，保留最後一筆）
export function parseSteps(text, source = "主對話") {
  const byId = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const m = j && j.message, u = m && m.usage;
    if (!u || typeof u !== "object") continue;
    const id = m.id || j.requestId || j.uuid || `line${byId.size}`;
    byId.set(id, {
      id, source, time: j.timestamp || "", model: m.model || "",
      input: Number(u.input_tokens) || 0,
      cacheWrite: Number(u.cache_creation_input_tokens) || 0,
      cacheRead: Number(u.cache_read_input_tokens) || 0,
      output: Number(u.output_tokens) || 0,
      thinking: Number(u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0,
    });
  }
  return [...byId.values()];
}

export function sumSteps(steps) {
  const t = Object.fromEntries(FIELDS.map(f => [f, 0]));
  for (const s of steps) for (const f of FIELDS) t[f] += s[f];
  t.total = t.input + t.cacheWrite + t.cacheRead + t.output;
  t.steps = steps.length;
  return t;
}

const n = v => v.toLocaleString("en-US");
// 台北時間 HH:MM:SS
const twTime = iso => { const d = Date.parse(iso); return Number.isFinite(d) ? new Date(d + 8 * 3600e3).toISOString().slice(11, 19) : "—"; };
const stepTotal = s => s.input + s.cacheWrite + s.cacheRead + s.output;

// 產生 markdown 報表；steps 已依時間排序，from 是要列明細的起始索引
export function render(steps, from = 0) {
  const out = [];
  const shown = steps.slice(from);
  const multi = new Set(steps.map(s => s.source)).size > 1;
  out.push(`**Token 用量逐步明細**（第 ${from + 1}–${steps.length} 步，共 ${shown.length} 步；時間為台北時間）`);
  out.push("");
  if (shown.length) {
    out.push(`| # | 時間 |${multi ? " 來源 |" : ""} 輸入 | 寫入快取 | 讀取快取 | 輸出（思考） | 小計 |`);
    out.push(`|---|---|${multi ? "---|" : ""}---:|---:|---:|---:|---:|`);
    shown.forEach((s, i) => out.push(`| ${from + i + 1} | ${twTime(s.time)} |${multi ? ` ${s.source} |` : ""} ${n(s.input)} | ${n(s.cacheWrite)} | ${n(s.cacheRead)} | ${n(s.output)}（${n(s.thinking)}） | ${n(stepTotal(s))} |`));
    const p = sumSteps(shown);
    out.push(`| 本段合計 | |${multi ? " |" : ""} ${n(p.input)} | ${n(p.cacheWrite)} | ${n(p.cacheRead)} | ${n(p.output)}（${n(p.thinking)}） | ${n(p.total)} |`);
  } else {
    out.push("（上次回報之後沒有新步驟）");
  }
  const t = sumSteps(steps);
  out.push("");
  out.push(`**Session 累計**：${n(t.steps)} 步｜輸入 ${n(t.input)}｜寫入快取 ${n(t.cacheWrite)}｜讀取快取 ${n(t.cacheRead)}｜輸出 ${n(t.output)}（思考 ${n(t.thinking)}）｜合計 ${n(t.total)}`);
  return out.join("\n");
}

// 找目前目錄對應的最新 session 紀錄檔；找不到就找所有專案中最新的
export function findSessionFile(cwd = process.cwd(), home = os.homedir()) {
  const root = path.join(home, ".claude", "projects");
  const newest = dir => {
    let best = null;
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!f.endsWith(".jsonl")) continue;
      const p = path.join(dir, f), mt = fs.statSync(p).mtimeMs;
      if (!best || mt > best.mt) best = { p, mt };
    }
    return best;
  };
  const own = newest(path.join(root, cwd.replace(/[^A-Za-z0-9]/g, "-")));
  if (own) return own.p;
  let best = null;
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const b = newest(path.join(root, d));
    if (b && (!best || b.mt > best.mt)) best = b;
  }
  return best && best.p;
}

// 讀主紀錄檔＋子代理紀錄檔，依時間排序
export function loadSteps(file) {
  const steps = parseSteps(fs.readFileSync(file, "utf8"));
  const subDir = path.join(file.replace(/\.jsonl$/, ""), "subagents");
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).filter(f => f.endsWith(".jsonl")).sort()) {
      steps.push(...parseSteps(fs.readFileSync(path.join(subDir, f), "utf8"), `子代理 ${f.replace(/\.jsonl$/, "").slice(0, 12)}`));
    }
  }
  const seen = new Set();
  return steps.filter(s => !seen.has(s.id) && seen.add(s.id)).sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf("--file");
  const file = fi >= 0 ? argv[fi + 1] : findSessionFile();
  if (!file || !fs.existsSync(file)) { console.error("找不到 session 紀錄檔（~/.claude/projects/*/*.jsonl）；可用 --file 指定"); process.exit(1); }
  const steps = loadSteps(file);
  const stateFile = path.join(os.homedir(), ".claude", "token-usage-state.json");
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  const last = Math.min(Number(state[file]) || 0, steps.length);
  console.log(render(steps, argv.includes("--all") ? 0 : last));
  if (!argv.includes("--no-save")) {
    state[file] = steps.length;
    try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch {}
  }
}
