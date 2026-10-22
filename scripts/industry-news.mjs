// 產業新聞：產業地圖每個題材用題材名稱到 Google 新聞（RSS，公開免金鑰）抓最近兩天的標題，標出相關題材，寫進 learner/data/industry-news.json
// （「產業地圖 → 產業新聞」頁和題材內頁的「最新消息」用）。原本這個檔案是手動整理的，之後由排程每天更新（.github/workflows/industry-news.yml）。
// 有 GEMINI_API_KEY 時，把當天新加的標題整理成一句白話重點；沒有就只放標題。保留 60 天、最多 400 則。
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseRss } from "../api/_lib/news.js";
import { geminiJSON } from "../api/_lib/podcast.js";

const OUT = fileURLToPath(new URL("../learner/data/industry-news.json", import.meta.url)), MAP = fileURLToPath(new URL("../learner/industry.js", import.meta.url));
const KEY = (process.env.GEMINI_API_KEY || "").trim(), KEEP_DAYS = 60, MAX = 400, PER = 3, sleep = ms => new Promise(r => setTimeout(r, ms));
// 產業地圖的題材（industry.js 是給瀏覽器的檔案，用 Function 讀出 INDUSTRY_MAP）
export const themesOf = src => new Function(src + ";return INDUSTRY_MAP")().themes.map(t => ({ id: t.id, name: t.name, mk: t.mk }));
// 搜尋字：去掉括號裡的英文縮寫（「AI 先進封裝（CoWoS）」→「AI 先進封裝 CoWoS」），美股題材加「美股」
export const queryOf = t => `${t.name.replace(/[（(]([^）)]*)[）)]/g, " $1").replace(/\s+/g, " ").trim()}${t.mk === "us" ? " 美股" : ""}`;
const keyOf = s => String(s).replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "").replace(/[\s\p{P}]/gu, "").slice(0, 16);
// 新抓到的標題併進舊資料：同一則（前 16 個字一樣）只留一則，題材合併；超過 60 天的丟掉
export function mergeNews(old, got, now = Date.now()) {
  const M = new Map((old?.items || []).map(x => [keyOf(x.title), { ...x, themes: [...(x.themes || [])] }])), cut = new Date(now - KEEP_DAYS * 864e5 + 8 * 3600e3).toISOString().slice(0, 10);
  for (const x of got) { const k = keyOf(x.title), p = M.get(k); if (p) { for (const t of x.themes) if (!p.themes.includes(t)) p.themes.push(t); } else M.set(k, x); }
  return [...M.values()].filter(x => x.date >= cut).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX);
}
const PROMPT = L => `你是財經編輯。下面是產業新聞標題（只有標題與來源）。請用繁體中文、白話，為每一則寫一句 40 字以內的重點（只根據標題，不要編造數字），輸出 JSON 陣列，順序與輸入相同：["重點1","重點2",...]。只輸出 JSON。\n\n${L.map((x, i) => `${i + 1}. ${x.title}（${x.source || ""}）`).join("\n")}`;
async function rss(q) {
  const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return parseRss(await r.text(), 10);
}
export async function main({ get = rss, now = Date.now(), gap = 400 } = {}) {
  const T = themesOf(await readFile(MAP, "utf8")), got = [], errs = [], day = d => new Date(d + 8 * 3600e3).toISOString().slice(0, 10);
  for (const t of T) {
    try { for (const x of (await get(queryOf(t))).filter(x => x.at && now - x.at < 2 * 864e5).slice(0, PER)) got.push({ date: day(x.at), themes: [t.id], title: x.title, summary: "", source: x.source || "", url: x.link }); }
    catch (e) { errs.push(`${t.name}：${e.message}`); }
    await sleep(gap);
  }
  if (!got.length) { console.log("::warning::沒有抓到任何產業新聞，保留原本的資料；" + errs.slice(0, 3).join("；")); return null; }
  const old = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null), items = mergeNews(old, got, now);
  // 還沒有重點的新標題（最多 40 則）請 AI 一次整理
  const need = items.filter(x => !x.summary).slice(0, 40);
  if (KEY && need.length) { try { const r = await geminiJSON([{ text: PROMPT(need) }], KEY, Date.now() + 90000), m = String(r.text).match(/\[[\s\S]*\]/), A = m ? JSON.parse(m[0]) : [];
    need.forEach((x, i) => { if (typeof A[i] === "string") x.summary = A[i].slice(0, 120); }); } catch (e) { console.log("::warning::AI 重點整理失敗，只放標題：" + e.message); } }
  const out = { updated: day(now), items };
  await writeFile(OUT, JSON.stringify(out));
  console.log("完成：新抓", got.length, "則，共", items.length, "則", errs.length ? "；失敗 " + errs.length + " 個題材" : "");
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::產業新聞這次沒有更新：" + e.message); });
