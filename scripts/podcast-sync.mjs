// 名人 Podcast 的排程整理（GitHub Actions 每 2 小時跑一次，見 .github/workflows/podcast-sync.yml）。
// 1. 依 learner/data/podcast/shows.json 到 Apple Podcasts 目錄找節目（或用填好的 feed），讀 RSS
// 2. 還沒整理的單集（新的優先，再往前補到一年內），用 AI 整理成重點與觀點：
//    - 有 GEMINI_API_KEY（GitHub Actions secret）：直接上傳音檔給 Gemini 聽完整集（沒有時間限制）
//    - 沒有：改呼叫已部署網站的 /api/podcast（SITE_URL，用 Vercel 上的金鑰；整集太長時改讀節目說明）
// 3. 寫進 learner/data/podcast/index.json，網頁打開就直接讀，不用等 AI。
// 選項（環境變數）：MAX_PER_RUN（每次最多整理幾集，預設 10）、BACKFILL（每個節目往前補幾集，預設 20）、DRY=1（不呼叫 AI）
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseRss, parseSum, PROMPT, uploadAudio, geminiJSON, fileState, fileDelete, itunes } from "../api/_lib/podcast.js";

const DIR = fileURLToPath(new URL("../learner/data/podcast/", import.meta.url));
const KEY = (process.env.GEMINI_API_KEY || "").trim(), SITE = (process.env.SITE_URL || "https://kline-school.vercel.app").replace(/\/$/, "");
const MAX = +process.env.MAX_PER_RUN || 10, BACK = +process.env.BACKFILL || 20, DRY = process.env.DRY === "1", KEEP = 60;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 和 learner/podcast.js 的 podHash 一樣（單集的 key）
export const podHash = s => { let h = 5381; for (const ch of String(s)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return h.toString(36); };
const twDate = iso => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getText(url, ms = 20000) { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, redirect: "follow", signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
async function site(path, body) {
  const r = await fetch(SITE + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(70000) } : { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null); if (!j) throw new Error(`網站回應 ${r.status}`); if (!j.ok) throw new Error(j.error || "失敗"); return j;
}

// 整理一集：先聽音檔，不行再讀節目說明
async function summarize(e, show) {
  const meta = { title: e.title, show: show.name, date: twDate(e.date), desc: e.desc }, notesOk = (e.desc || "").replace(/\s/g, "").length >= 40;
  if (KEY) {
    if (e.audio) {
      let up = null;
      try {
        up = await uploadAudio(e.audio, e.title, KEY, { dlMs: 120000, upMs: 180000 });
        for (let t = 0; up.state !== "ACTIVE"; t++) { if (up.state === "FAILED" || t > 60) throw new Error("音檔處理失敗"); await sleep(5000); up.state = await fileState(up.file, KEY); }
        const out = await geminiJSON([{ fileData: { mimeType: up.mime, fileUri: up.uri } }, { text: PROMPT(meta, "audio") }], KEY, Date.now() + 240000);
        const s = parseSum(out.text); if (s) return { ...s, mode: "audio", model: out.model };
        throw new Error("AI 回傳格式不對");
      } catch (err) { log("  聽音檔失敗：", err.message); if (/429|quota|RESOURCE_EXHAUSTED/i.test(err.message)) throw err; }
      finally { if (up?.file) fileDelete(up.file, KEY); }
    }
    if (!notesOk) throw new Error("沒有音檔、節目說明也太短");
    const out = await geminiJSON([{ text: PROMPT(meta, "notes") }], KEY, Date.now() + 120000), s = parseSum(out.text);
    if (!s) throw new Error("AI 回傳格式不對"); return { ...s, mode: "notes", model: out.model };
  }
  // 沒有金鑰：用網站的 API
  if (e.audio) {
    try {
      const up = await site("/api/podcast", { act: "upload", audio: e.audio, name: e.title });
      for (let t = 0, st = up.state; st !== "ACTIVE"; t++) { if (st === "FAILED" || t > 40) throw new Error("音檔處理失敗"); await sleep(4000); st = (await site(`/api/podcast?act=file&name=${encodeURIComponent(up.file)}`)).state; }
      const j = await site("/api/podcast", { act: "sum", ...meta, desc: "", uri: up.uri, mime: up.mime, file: up.file });
      return { tldr: j.tldr, points: j.points, sections: j.sections, calls: j.calls, topics: j.topics, mode: j.mode, model: j.model };
    } catch (err) { log("  網站聽音檔失敗：", err.message); if (/額度|429/.test(err.message)) throw err; }
  }
  if (!notesOk) throw new Error("沒有音檔、節目說明也太短");
  const j = await site("/api/podcast", { act: "sum", ...meta });
  return { tldr: j.tldr, points: j.points, sections: j.sections, calls: j.calls, topics: j.topics, mode: j.mode, model: j.model };
}

export async function main() {
  const cfg = JSON.parse(await readFile(DIR + "shows.json", "utf8"));
  const idx = await readFile(DIR + "index.json", "utf8").then(JSON.parse).catch(() => ({ shows: [], eps: {}, fails: {} }));
  idx.eps ||= {}; idx.fails ||= {};
  // 1. 節目
  const shows = [];
  for (const c of cfg.shows) {
    const old = idx.shows.find(s => s.q === c.q);
    try {
      let s = c.feed ? { name: c.name || c.q, feed: c.feed } : old?.feed ? old : null;
      if (!s) { const hit = (await itunes(c.q)).find(x => x.name.includes(c.must || c.q)); if (!hit) { log("找不到節目：", c.q); continue; } s = hit; }
      const p = parseRss(await getText(s.feed), 80);
      shows.push({ q: c.q, id: s.id || podHash(s.feed), name: p.show.name || s.name, author: p.show.author || s.author || "", art: p.show.art || s.art || "", feed: s.feed, eps: p.eps });
      log("節目：", p.show.name, `${p.eps.length} 集`);
    } catch (err) { log("節目讀取失敗：", c.q, err.message); if (old) shows.push({ ...old, eps: [] }); }
  }
  // 2. 待整理：每個節目最新的先、再往前補到 BACKFILL 集（一年內）；新的優先排在前面
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString(), todo = [];
  for (const s of shows) s.eps.filter(e => e.date >= yearAgo).slice(0, BACK).forEach((e, rank) => { const key = podHash(s.feed + "|" + e.guid); if (!idx.eps[key] && (idx.fails[key]?.n || 0) < 3) todo.push({ s, e, key, rank }); });
  todo.sort((a, b) => a.rank - b.rank || b.e.date.localeCompare(a.e.date));
  log(`待整理 ${todo.length} 集，這次最多 ${MAX} 集`, KEY ? "（Gemini 直接聽音檔）" : `（用網站 ${SITE}）`);
  let done = 0;
  for (const { s, e, key } of todo.slice(0, DRY ? 0 : MAX)) {
    log("整理：", s.name, e.title);
    try {
      const r = await summarize(e, s);
      idx.eps[key] = { feed: s.feed, guid: e.guid, title: e.title, date: e.date, audio: e.audio, link: e.link || "", dur: e.dur || null, show: s.name, ...r, at: Date.now() };
      delete idx.fails[key]; done++; log("  完成：", r.mode, `${r.calls.length} 個觀點`);
    } catch (err) {
      idx.fails[key] = { n: (idx.fails[key]?.n || 0) + 1, err: String(err.message).slice(0, 200), at: Date.now() }; log("  失敗：", err.message);
      if (/429|quota|額度|RESOURCE_EXHAUSTED/i.test(err.message)) { log("AI 額度用完，下次再繼續"); break; }
    }
    await sleep(process.env.GAP_MS ? +process.env.GAP_MS : KEY ? 15000 : 5000);
  }
  // 3. 寫檔：每個節目只留最近 KEEP 集已整理的
  const feeds = new Set(shows.map(s => s.feed)), byFeed = {};
  for (const [k, v] of Object.entries(idx.eps)) if (feeds.has(v.feed)) (byFeed[v.feed] ||= []).push([k, v]);
  const eps = Object.fromEntries(Object.values(byFeed).flatMap(L => L.sort((a, b) => b[1].date.localeCompare(a[1].date)).slice(0, KEEP)));
  const latest = Object.fromEntries(shows.map(s => [s.feed, s.eps.slice(0, 12).map(e => ({ guid: e.guid, title: e.title, date: e.date, audio: e.audio, link: e.link || "", dur: e.dur || null, desc: (e.desc || "").slice(0, 400) }))]));
  const out = { updated: new Date().toISOString(), engine: KEY ? "gemini" : "site", shows: shows.map(({ eps: _, ...s }) => s), latest, eps, fails: Object.fromEntries(Object.entries(idx.fails).filter(([k]) => !eps[k])), pending: Math.max(0, todo.length - done) };
  await writeFile(DIR + "index.json", JSON.stringify(out));
  log(`完成：這次整理 ${done} 集，共 ${Object.keys(eps).length} 集，還有 ${out.pending} 集待整理`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(err => { console.error(err); process.exit(1); });
