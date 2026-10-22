// 收盤後 Telegram 提醒：讀雲端同步裡「有綁定 Telegram」的使用者的指標提醒與價格提醒，用收盤後的日 K 檢查，成立就推播；
// 另外推播追蹤的國會議員、13F 機構的新申報，以及庫存台股的內部人轉讓申報（情報局「大戶國會 → 我的追蹤」）；
// 有勾「事件提醒」的人，再加上庫存（可含自選）的營收公布、三率三升、法說會前一天（判斷用 learner/brief.js 的 evScan，和網頁一樣）。
// 在 .github/workflows/market-scan.yml 裡、全市場日 K 更新之後執行：台股直接用 .cache/allk.json，美股向 Yahoo 抓。
// 條件判斷用網站同一套程式（scripts/_engine.mjs 載入 learner/tools.js 的 COND），結果和網頁上的「指標提醒」一致。
// 需要的 GitHub secrets：KV_REST_API_URL、KV_REST_API_TOKEN（和 Vercel 上同一個 Upstash）、TELEGRAM_BOT_TOKEN；沒設定就直接結束。
// 同一個人同一天只送一次（KV 記 sent:<id>:<日期>，兩天後自動過期）。
//   --dry  只印出會送的內容，不送出

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { engine } from "./_engine.mjs";
import { kv, tg } from "../api/_lib/sync.js";

const CACHE = fileURLToPath(new URL("../.cache/allk.json", import.meta.url)), DRY = process.argv.includes("--dry");
const isTW = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function usDaily(code) {
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?range=1y&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }); const j = await r.json(), x = j?.chart?.result?.[0]; if (!x?.timestamp) return null;
    const q = x.indicators.quote[0], off = (x.meta.gmtoffset ?? 0) * 1000; return x.timestamp.map((t, k) => ({ d: new Date(t * 1000 + off).toISOString().slice(0, 10), o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], v: q.volume[k] ?? 0 })).filter(b => b.c != null); } catch { return null; }
}
// 一個人的提醒 → 成立的訊息列表
export function evalDoc(doc, dailyOf, E) {
  const out = [], nm = c => doc.names?.[c] || "";
  for (const r of doc.rules || []) { const D = dailyOf(r.code); const m = D ? E.condCheck(r, D) : null; if (m) out.push(`${nm(r.code)} ${r.code}：${E.condName(r.cond, r.p)} → ${m}`.trim()); }
  for (const a of doc.price || []) { const D = dailyOf(a.code); if (!D?.length) continue; const c = +(+D[D.length - 1].c).toFixed(2);
    if (a.up && c >= a.up) out.push(`${nm(a.code)} ${a.code}：收盤 ${c} 漲到 ${a.up} 以上`.trim()); if (a.dn && c <= a.dn) out.push(`${nm(a.code)} ${a.code}：收盤 ${c} 跌到 ${a.dn} 以下`.trim()); }
  return out;
}

// 追蹤對象的新申報（learner/data 裡排程整理好的檔案）：since 之後申報的才算；k 是去重用的鍵（同一筆只推一次）
export function evalFollow(doc, D, since) {
  const F = doc.follow || {}, out = [], pn = pid => D.cong?.people?.[pid]?.name || pid;
  for (const pid of F.cong || []) { const L = (D.cong?.trades || []).filter(t => t.pid === pid && t.filed >= since); if (!L.length) continue;
    const by = L.reduce((m, t) => m.set(t.filed, [...(m.get(t.filed) || []), t]), new Map());
    for (const [d, T] of by) out.push({ k: `c:${pid}:${d}`, m: `國會 ${pn(pid)} ${d.slice(5)} 申報：${[...new Set(T.map(t => `${t.k === "buy" ? "買" : t.k === "sell" ? "賣" : "換"} ${t.ticker}`))].slice(0, 8).join("、")}${T.length > 8 ? ` 等 ${T.length} 筆` : ""}` }); }
  for (const cik of F.f13 || []) { const f = (D.f13?.funds || []).find(x => x.cik === cik); if (!f || !(f.filed >= since)) continue; const n = c => f.rows.filter(r => r.chg === c).length;
    out.push({ k: `f:${cik}:${f.period}`, m: `13F ${f.who} 申報 ${f.period} 季底持股：新進 ${n("new")}、加碼 ${n("add")}、減碼 ${n("cut")}、出清 ${(f.sold || []).length}` }); }
  const mine = new Set(F.ins || []);
  for (const r of D.ins?.rows || []) if (mine.has(r.code) && r.d >= since) out.push({ k: `i:${r.code}:${r.d}:${r.who}:${r.sh}`, m: `內部人 ${r.name} ${r.code}：${r.who}（${r.role}）申報轉讓 ${Math.round((r.sh || 0) / 1000).toLocaleString()} 張（${r.how}）` });
  return out;
}
const readData = async f => { try { return JSON.parse(await readFile(fileURLToPath(new URL(`../learner/data/${f}`, import.meta.url)), "utf8")); } catch { return null; } };
// 直接呼叫網站的 API 處理程式（不用經過網址），回傳它的 JSON
export async function callApi(mod, query = {}) {
  let out = null; const res = { setHeader() {}, status() { return res; }, json(o) { out = o; return res; } };
  try { await (await mod).default({ method: "GET", query, headers: {} }, res); } catch (e) { return { ok: false, error: e.message }; }
  return out;
}
// 事件提醒要的資料：上市櫃月營收歷史（排程整理的 twse-rev／tpex-rev）、三率（earn-hist.json）、法說會（/api/calendar）
export async function evDataOf(E, cal) {
  const rev = {}; for (const f of ["twse-rev.json", "tpex-rev.json"]) for (const [c, v] of Object.entries((await readData(f)) || {})) { const r = Array.isArray(v) ? E.B.revOf(v[2]) : null; if (r) rev[c] = { ...r, name: v[0] }; }
  return { rev, pm: (await readData("earn-hist.json"))?.pm || null, conf: cal?.conf || [] };
}

export async function main() {
  // 沒設定就略過（推播是附加功能，不能讓整個資料排程失敗）。chat id 來自每個人在網頁上的綁定，所以不需要 TELEGRAM_CHAT_ID
  if (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) || !process.env.TELEGRAM_BOT_TOKEN) { console.log("::warning::沒有設定雲端儲存（KV_REST_API_URL）或 TELEGRAM_BOT_TOKEN，略過推播"); return; }
  const ids = (await kv("SMEMBERS", "alerts")) || []; console.log("有提醒的使用者", ids.length);
  if (!ids.length) return;
  let H = { s: {} }; try { H = JSON.parse(await readFile(CACHE, "utf8")); } catch { console.log("沒有全市場快取，台股提醒會略過"); }
  const E = engine(), us = new Map(), date = H.date || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const docs = [];
  for (const h of ids) { try { const v = await kv("GET", `alert:${h}`); if (v) docs.push([h, JSON.parse(v)]); } catch (e) { console.log("::warning::讀取提醒設定失敗", h.slice(0, 8), e.message); } }
  for (const [, d] of docs) for (const c of [...(d.rules || []), ...(d.price || [])].map(x => x.code)) if (!isTW(c) && !us.has(c)) { us.set(c, await usDaily(c)); await sleep(300); }
  const dailyOf = c => (isTW(c) ? H.s[c]?.b || null : us.get(c) || null);
  const FD = { cong: await readData("congress.json"), f13: await readData("f13.json"), ins: await readData("insider.json") }, since = new Date(Date.parse(date) - 4 * 864e5).toISOString().slice(0, 10);
  const evOn = docs.some(([, d]) => d.ev?.on?.some(k => k !== "brief")), ED = evOn ? await evDataOf(E, await callApi(import("../api/_lib/calendar.js"))) : null;
  let sent = 0;
  for (const [h, d] of docs) {
    if (!d.chat) continue;
    let msgs = []; try { msgs = evalDoc(d, dailyOf, E); } catch (e) { console.log("::warning::檢查條件失敗", h.slice(0, 8), e.message); }
    // 指標、價格提醒同一天只送一次；追蹤的新申報每一筆只送一次
    if (msgs.length && !DRY) { try { if (!(await kv("SET", `sent:${h}:${date}`, "1", "NX", "EX", 172800))) msgs = []; } catch (e) { console.log("::warning::KV 寫入失敗", e.message); msgs = []; } }
    const fol = [];
    const ev = ED && d.ev?.codes?.length ? E.B.evScan(d.ev.codes, { ...ED, names: d.names }, E.B.twDay()).filter(x => d.ev.on.includes(x.kind)).map(x => ({ k: "e:" + x.k, m: x.m })) : [];
    for (const x of [...evalFollow(d, FD, since), ...ev]) { if (DRY) { fol.push(x.m); continue; } try { if (await kv("SET", `seenf:${h}:${x.k}`, "1", "NX", "EX", x.k.startsWith("e:") ? 10368000 : 3456000)) fol.push(x.m); /* 事件記 120 天：同一季的三率三升不會再推 */ } catch {} }
    if (!msgs.length && !fol.length) continue;
    const text = `🔔 K線看盤收盤提醒（${date}）\n` + [...msgs, ...fol.slice(0, 20)].map(m => "• " + m).join("\n") + (fol.length > 20 ? `\n…另有 ${fol.length - 20} 則追蹤申報` : "") + "\n\n以收盤後日 K 與公開申報整理，不是買賣建議。";
    if (DRY) { console.log(h.slice(0, 8), text); continue; }
    try { await tg("sendMessage", { chat_id: d.chat, text }); sent++; } catch (e) { console.log("::warning::Telegram 送出失敗", h.slice(0, 8), e.message); }
    await sleep(100);
  }
  console.log("送出", sent, "則");
}
// 任何錯誤（KV 連不上、Telegram 掛掉…）都只印 warning、以成功結束：推播失敗不影響全市場資料已經上傳
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::Telegram 推播這次沒有完成：" + e.message); process.exitCode = 0; });
