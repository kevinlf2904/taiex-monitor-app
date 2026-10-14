// 收盤後 Telegram 提醒：讀雲端同步裡「有綁定 Telegram」的使用者的指標提醒與價格提醒，用收盤後的日 K 檢查，成立就推播。
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

export async function main() {
  if (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) || !process.env.TELEGRAM_BOT_TOKEN) { console.log("沒有設定雲端儲存或 TELEGRAM_BOT_TOKEN，略過推播"); return; }
  const ids = (await kv("SMEMBERS", "alerts")) || []; console.log("有提醒的使用者", ids.length);
  if (!ids.length) return;
  let H = { s: {} }; try { H = JSON.parse(await readFile(CACHE, "utf8")); } catch { console.log("沒有全市場快取，台股提醒會略過"); }
  const E = engine(), us = new Map(), date = H.date || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const docs = [];
  for (const h of ids) { const v = await kv("GET", `alert:${h}`); if (v) docs.push([h, JSON.parse(v)]); }
  for (const [, d] of docs) for (const c of [...(d.rules || []), ...(d.price || [])].map(x => x.code)) if (!isTW(c) && !us.has(c)) { us.set(c, await usDaily(c)); await sleep(300); }
  const dailyOf = c => (isTW(c) ? H.s[c]?.b || null : us.get(c) || null);
  let sent = 0;
  for (const [h, d] of docs) {
    const msgs = evalDoc(d, dailyOf, E); if (!msgs.length || !d.chat) continue;
    const text = `🔔 K線看盤收盤提醒（${date}）\n` + msgs.map(m => "• " + m).join("\n") + "\n\n以收盤後日 K 判斷，不是買賣建議。";
    if (DRY) { console.log(h.slice(0, 8), text); continue; }
    if (!(await kv("SET", `sent:${h}:${date}`, "1", "NX", "EX", 172800))) continue;
    try { await tg("sendMessage", { chat_id: d.chat, text }); sent++; } catch (e) { console.log("送出失敗", h.slice(0, 8), e.message); }
    await sleep(100);
  }
  console.log("送出", sent, "則");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
