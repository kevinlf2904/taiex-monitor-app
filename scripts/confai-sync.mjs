// 法說會重點的排程整理（GitHub Actions 每天跑一次，見 .github/workflows/confai-sync.yml）。
// 大公司（市值前 40＋最新月營收前 100，合計最多 MAX_CODES 家）到觀測站找法說會，最近一次已召開、有簡報的，還沒整理過就請 AI 讀簡報整理，
// 寫進 learner/data/confai.json（{ updated, sums: { 簡報檔名: { code, date, head, outlook…, model, at } }, cmps: { 這一季簡報檔名: { prev, tone, head, changes } } }）。
// 也會整理「上一季」的簡報，請 AI 比較兩季（更樂觀／差不多／更保守、哪些地方變了）。
// 網頁（learner/earnplus.js）先看這個檔，有整理好的直接顯示，不用等 AI、也不受網站 60 秒上限（大簡報下載慢時常超過）。
// 選項（環境變數）：MAX_PER_RUN（每次最多呼叫幾次 AI，預設 20）、MAX_CODES（最多看幾家，預設 100）、KEEP_DAYS（保留幾天，預設 400）、DRY=1（只列出要整理哪些）
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { confList, summarizeConf, pickConf, prevConf, compareConf } from "../api/_lib/confai.js";

const DATA = fileURLToPath(new URL("../learner/data/", import.meta.url)), OUT = DATA + "confai.json";
const KEY = (process.env.GEMINI_API_KEY || "").trim(), MAX = +process.env.MAX_PER_RUN || 20, MAXC = +process.env.MAX_CODES || 100, KEEP = +process.env.KEEP_DAYS || 400, DRY = process.env.DRY === "1";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readJ = async f => { try { return JSON.parse(await readFile(DATA + f, "utf8")); } catch { return null; } };

// 要看哪些公司：市值排行（market-after 排程）＋最新一個月營收最高的（twse-rev／tpex-rev 排程，單位千元）
export function bigCodes(after, revs, n = 100) {
  const cap = ((after?.ranks || []).find(r => r.id === "mcap")?.tabs?.[0]?.rows || []).map(r => r.c);
  const rev = Object.entries(Object.assign({}, ...revs.map(x => x || {}))).map(([c, v]) => { const m = Array.isArray(v) ? v[2] || {} : {}, k = Object.keys(m).sort().at(-1); return [c, k ? m[k] : 0]; })
    .filter(([c]) => /^\d{4}$/.test(c)).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  return [...new Set([...cap, ...rev])].slice(0, n);
}
// 只留 KEEP 天內的法說會
export function prune(sums, now = Date.now(), keep = KEEP) {
  const cut = new Date(now - keep * 86400e3).toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(sums || {}).filter(([, v]) => (v.date || "") >= cut));
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

async function main() {
  const old = (await readJ("confai.json")) || { sums: {} }, sums = prune(old.sums), cmps = Object.fromEntries(Object.entries(old.cmps || {}).filter(([f]) => sums[f]));
  const after = await readJ("market/after.json"), revs = [await readJ("twse-rev.json"), await readJ("tpex-rev.json")], codes = bigCodes(after, revs, MAXC);
  const names = Object.assign({}, ...revs.map(r => Object.fromEntries(Object.entries(r || {}).map(([c, v]) => [c, Array.isArray(v) ? v[0] : c]))));
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  log("看", codes.length, "家公司，已整理", Object.keys(sums).length, "份");
  // 每家：最近一次（f）、上一季（p）；還沒整理的、還沒比較的才排進來
  const todo = (await pool(codes, 4, async c => { try { const L = await confList(c), f = pickConf(L, today), p = prevConf(L, f, c); return f && (!sums[f.file] || (p && (!sums[p.file] || cmps[f.file]?.prev !== p.file))) ? { c, f, p } : null; } catch (e) { log(c, "找法說會失敗", e.message); return null; } })).filter(Boolean);
  log("要處理", todo.length, "家", todo.map(x => `${x.c}:${x.f.file}${x.p ? "←" + x.p.file : ""}`).join(" "));
  if (DRY || !KEY) { if (!KEY) log("沒有 GEMINI_API_KEY，只列出要整理的"); return; }
  let n = 0, fail = 0; // n＝這次呼叫 AI 的次數（整理簡報、比較兩季都算一次），到 MAX 就停
  const sum = async (c, x) => { if (sums[x.file]) return true; if (n >= MAX) return false; n++;
    try { const t0 = Date.now(), v = await summarizeConf(x.file, names[c] || c, KEY, Date.now() + 150000); sums[x.file] = { code: c, date: x.date, ...v, at: new Date().toISOString() }; log(c, x.file, "整理完成", `${Date.now() - t0}ms`, v.model); return true; }
    catch (e) { fail++; log(c, x.file, "整理失敗", e.message); return false; } };
  for (const { c, f, p } of todo) {
    if (n >= MAX) break; if (!(await sum(c, f)) || !p || !(await sum(c, p)) || cmps[f.file]?.prev === p.file || n >= MAX) continue; n++;
    try { cmps[f.file] = { prev: p.file, ...(await compareConf(sums[f.file], sums[p.file], names[c] || c, KEY, Date.now() + 60000)) }; log(c, "兩季比較", cmps[f.file].tone); }
    catch (e) { fail++; log(c, "比較失敗", e.message); }
  }
  if (!n && Object.keys(sums).length === Object.keys(old.sums || {}).length) { log("沒有新的，不寫檔"); return; } // 只改時間戳會多一次提交
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), sums, cmps }));
  log("呼叫 AI", n, "次，失敗", fail, "次；整理好的簡報", Object.keys(sums).length, "份、兩季比較", Object.keys(cmps).length, "家");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
