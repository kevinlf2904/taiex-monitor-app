// 列出這次 Claude Code session 每一步（每次模型回應）的 token 用量和累計總量，給回報時附上。
// 用法：node scripts/token-usage.mjs            只列上次執行之後新增的步驟＋整個 session 累計
//       node scripts/token-usage.mjs --all      列出全部步驟
//       node scripts/token-usage.mjs --no-save  不記錄「已回報到第幾步」（下次仍從同一處開始列）
//       node scripts/token-usage.mjs --file <紀錄檔.jsonl>  指定紀錄檔（預設找目前目錄對應的最新 session）
//       node scripts/token-usage.mjs --quota <額度.json>  加上訂閱額度使用率（5 小時／7 天）
// 額度資料：雲端 session 事件流的 rate_limit_event（list_events kinds=["rate_limit_event"]）才有，容器內沒有檔案可讀。
//   --quota 檔可以是 list_events 的原始回應，或精簡陣列 [{"t":"<ISO 時間>","h5":0.17,"d7":0.37,"h5r":<重置秒>,"d7r":<重置秒>}]（使用率 0–1）。
//   讀過的額度事件會存進狀態檔，下次只需給新的事件。每一步顯示「這步之後、下一步之前」最新的使用率；百分比是 1% 為單位，單步常看不出變化。
// 資料來源：~/.claude/projects/<目錄>/<session>.jsonl；子代理的紀錄在 <session>/subagents/*.jsonl，一併計入。
// 同一次回應在紀錄檔可能出現好幾行（usage 相同），依 message.id 去重，只算一次。
// 注意：token 與額度百分比的換算沒有公開；百分比以 rate_limit_event 回報的數字為準，不從 token 推算。
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

// 額度事件：接受 list_events 原始回應（任意深度找 created_at＋unifiedWindows）或精簡陣列；回傳依時間排序、去重的 [{t,h5,d7,h5r,d7r}]
export function parseQuota(data) {
  const out = [];
  const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const walk = (o, at) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, at)); return; }
    if (typeof o.t === "string" && ("h5" in o || "d7" in o)) {
      out.push({ t: o.t, h5: num(o.h5), d7: num(o.d7), h5r: num(o.h5r), d7r: num(o.d7r) });
      return;
    }
    const t = typeof o.created_at === "string" ? o.created_at : at;
    const w = o.unifiedWindows;
    if (w && typeof w === "object" && t) {
      const a = w.five_hour || {}, b = w.seven_day || {};
      out.push({ t, h5: num(a.utilization), d7: num(b.utilization), h5r: num(a.resetsAt), d7r: num(b.resetsAt) });
      return;
    }
    for (const v of Object.values(o)) walk(v, t);
  };
  walk(data);
  const seen = new Map();
  for (const q of out) if (Number.isFinite(Date.parse(q.t))) seen.set(`${q.t}|${q.h5}|${q.d7}`, q);
  return [...seen.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

// 某時間點（含）之前最新的一筆
const quotaAt = (quota, ms) => { let q = null; for (const e of quota) if (Date.parse(e.t) <= ms) q = e; return q; };
// 每一步之後的額度：下一步開始前（最後一步則到最後）最新的一筆事件；事件只在使用率變動等時機才有，沒有新事件就沿用前一筆
export function attachQuota(steps, quota) {
  if (!quota || !quota.length) return steps;
  return steps.map((s, i) => {
    const until = i + 1 < steps.length ? Date.parse(steps[i + 1].time) : Infinity;
    return { ...s, quota: quotaAt(quota, until) };
  });
}

const pct = v => (v == null ? "—" : `${Math.round(v * 100)}%`);
const twReset = sec => (sec == null ? "" : new Date(sec * 1000 + 8 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " "));
const delta = (a, b) => { if (a == null || b == null) return ""; const d = Math.round(b * 100) - Math.round(a * 100); return `（${d >= 0 ? "+" : ""}${d}）`; };

// 產生 markdown 報表；steps 已依時間排序，from 是要列明細的起始索引；quota 是 parseQuota 的結果（可省略）
export function render(steps, from = 0, quota = []) {
  const out = [];
  const hasQ = quota.length > 0;
  const all = attachQuota(steps, quota);
  const shown = all.slice(from);
  const multi = new Set(steps.map(s => s.source)).size > 1;
  out.push(`**Token 用量逐步明細**（第 ${from + 1}–${steps.length} 步，共 ${shown.length} 步；時間為台北時間）`);
  out.push("");
  if (shown.length) {
    out.push(`| # | 時間 |${multi ? " 來源 |" : ""} 輸入 | 寫入快取 | 讀取快取 | 輸出（思考） | 小計 |${hasQ ? " 額度 5h／7d |" : ""}`);
    out.push(`|---|---|${multi ? "---|" : ""}---:|---:|---:|---:|---:|${hasQ ? "---:|" : ""}`);
    shown.forEach((s, i) => out.push(`| ${from + i + 1} | ${twTime(s.time)} |${multi ? ` ${s.source} |` : ""} ${n(s.input)} | ${n(s.cacheWrite)} | ${n(s.cacheRead)} | ${n(s.output)}（${n(s.thinking)}） | ${n(stepTotal(s))} |${hasQ ? ` ${s.quota ? `${pct(s.quota.h5)}／${pct(s.quota.d7)}` : "—"} |` : ""}`));
    const p = sumSteps(shown);
    out.push(`| 本段合計 | |${multi ? " |" : ""} ${n(p.input)} | ${n(p.cacheWrite)} | ${n(p.cacheRead)} | ${n(p.output)}（${n(p.thinking)}） | ${n(p.total)} |${hasQ ? " |" : ""}`);
  } else {
    out.push("（上次回報之後沒有新步驟）");
  }
  const t = sumSteps(steps);
  out.push("");
  out.push(`**Session 累計**：${n(t.steps)} 步｜輸入 ${n(t.input)}｜寫入快取 ${n(t.cacheWrite)}｜讀取快取 ${n(t.cacheRead)}｜輸出 ${n(t.output)}（思考 ${n(t.thinking)}）｜合計 ${n(t.total)}`);
  if (hasQ) {
    const last = quota[quota.length - 1];
    // 本段起點：本段第一步之前最新的一筆；沒有就用 session 第一筆
    const segStart = shown.length ? quotaAt(quota, Date.parse(shown[0].time) - 1) : last;
    const a = segStart || quota[0], first = quota[0];
    const line = (name, k, kr) => `${name} ${pct(last[k])}｜本段 ${pct(a[k])}→${pct(last[k])}${delta(a[k], last[k])}｜session ${pct(first[k])}→${pct(last[k])}${delta(first[k], last[k])}${(r => (r != null ? `｜重置 ${twReset(r)}` : ""))([...quota].reverse().map(e => e[kr]).find(v => v != null))}`;
    out.push(`**額度使用率**（${twTime(last.t)} 為止；session 起點是第一筆額度事件，已含第一步）：`);
    out.push(`- ${line("5 小時", "h5", "h5r")}`);
    out.push(`- ${line("7 天", "d7", "d7r")}`);
  }
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
  // 舊格式是數字；新格式 {n, quota}
  const prev = typeof state[file] === "object" && state[file] ? state[file] : { n: Number(state[file]) || 0, quota: [] };
  const last = Math.min(Number(prev.n) || 0, steps.length);
  const qi = argv.indexOf("--quota");
  let quota = parseQuota(prev.quota || []);
  if (qi >= 0) {
    const qf = argv[qi + 1];
    if (!qf || !fs.existsSync(qf)) { console.error(`找不到額度檔：${qf || "（沒給路徑）"}`); process.exit(1); }
    quota = parseQuota([quota, JSON.parse(fs.readFileSync(qf, "utf8"))]);
  }
  console.log(render(steps, argv.includes("--all") ? 0 : last, quota));
  if (!argv.includes("--no-save")) {
    state[file] = { n: steps.length, quota };
    try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch {}
  }
}
