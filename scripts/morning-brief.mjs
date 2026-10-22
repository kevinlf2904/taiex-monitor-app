// 每日早報推播：每個交易日早上 07:40（台北），把昨晚美股、台指期夜盤、今天的除權息與法說會、持股新消息整理成一則 Telegram 訊息，
// 送給在看盤「工具 → 提醒 → 事件提醒」勾了「每日早報」、並在「備份同步」綁定 Telegram 的人（.github/workflows/morning-brief.yml）。
// 內容和網頁「工具 → 早報」是同一套（learner/brief.js 的 briefParts、briefText，透過 _engine.mjs 載入）；資料直接呼叫網站的 API 處理程式。
// 需要的 GitHub secrets：KV_REST_API_URL、KV_REST_API_TOKEN、TELEGRAM_BOT_TOKEN；沒設定就直接結束。同一個人同一天只送一次（KV brief:<id>:<日期>）。
//   --dry  只印出內容、不送出（不需要 KV，用範例持股）

import { fileURLToPath } from "node:url";
import { engine } from "./_engine.mjs";
import { kv, tg } from "../api/_lib/sync.js";
import { callApi, evDataOf } from "./alerts-push.mjs";

const DRY = process.argv.includes("--dry"), sleep = ms => new Promise(r => setTimeout(r, ms));
export const globalPart = async () => {
  const [us, fut, cal] = await Promise.all([callApi(import("../api/_lib/usmarket.js")), callApi(import("../api/_lib/futures.js"), { bars: "0" }), callApi(import("../api/_lib/calendar.js"))]);
  return { us, fut, cal };
};
export async function main() {
  const E = engine(), B = E.B, today = B.twDay();
  if (!DRY && (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) || !process.env.TELEGRAM_BOT_TOKEN)) { console.log("::warning::沒有設定雲端儲存（KV_REST_API_URL）或 TELEGRAM_BOT_TOKEN，略過早報"); return; }
  if (new Date(today + "T00:00:00Z").getUTCDay() % 6 === 0) { console.log("週末不送早報"); return; }
  let docs = [];
  if (DRY) docs = [["dry", { chat: null, names: { 2330: "台積電", 2317: "鴻海" }, ev: { on: ["brief"], codes: ["2330", "2317"] } }]];
  else for (const h of (await kv("SMEMBERS", "alerts")) || []) { try { const v = await kv("GET", `alert:${h}`), d = v ? JSON.parse(v) : null; if (d?.chat && d.ev?.on?.includes("brief")) docs.push([h, d]); } catch {} }
  console.log("要送早報的使用者", docs.length); if (!docs.length) return;
  const G = await globalPart();
  if ((G.cal?.hol || []).some(x => x.date === today)) { console.log("今天休市，不送早報"); return; }
  const ED = await evDataOf(E, G.cal), news = new Map();
  const newsOf = async (c, name) => {
    if (!news.has(c)) { const j = await callApi(import("../api/_lib/news.js"), { code: c, q: name || c }); news.set(c, (j?.items || []).filter(x => !x.at || Date.now() - x.at < 36 * 3600e3).slice(0, 2)); await sleep(300); }
    return news.get(c);
  };
  let sent = 0;
  for (const [h, d] of docs) {
    const codes = d.ev.codes || [], names = Object.fromEntries(codes.map(c => [c, d.names?.[c] || ED.rev[c]?.name || ""])), N = {};
    for (const c of codes.slice(0, 5)) { const L = await newsOf(c, names[c]); if (L.length) N[c] = L; }
    const ev = B.evScan(codes, { ...ED, names }, today).filter(x => x.kind === "conf"); // 營收、三率收盤後已經推過；早報只提醒明天的法說會
    const P = B.briefParts(G, { codes, names, news: N, ev }, today), text = B.briefText(P, today);
    if (!P.length) { console.log("::warning::早報沒有任何資料（來源都沒回應），這次不送"); continue; }
    if (DRY) { console.log(text); continue; }
    try { if (!(await kv("SET", `brief:${h}:${today}`, "1", "NX", "EX", 172800))) continue; } catch (e) { console.log("::warning::KV 寫入失敗", e.message); continue; }
    try { await tg("sendMessage", { chat_id: d.chat, text }); sent++; } catch (e) { console.log("::warning::Telegram 送出失敗", h.slice(0, 8), e.message); }
    await sleep(100);
  }
  console.log("送出早報", sent, "則");
}
// 失敗只印 warning：早報是附加功能
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::早報這次沒有送出：" + e.message); process.exitCode = 0; });
