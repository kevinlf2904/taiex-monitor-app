// 每日總經消息彙整：台股、美股各用幾組總經關鍵字到 Google 新聞（RSS，公開免金鑰）抓最近一天的標題，
// 去重、依主題分類（利率、通膨、就業、景氣、貿易、匯率、債市、市場），有 AI 金鑰時再整理成「重點＋對股市的可能影響」。
// 結果寫進 learner/data/macro-news.json（保留 30 天），看盤「大盤 → 總經」最上面顯示。排程見 .github/workflows/macro-news.yml。
// AI：有 GEMINI_API_KEY 直接呼叫 Gemini；沒有就呼叫已部署網站的 /api/chat（用 Vercel 上的金鑰）；都失敗就只放分類好的標題。
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseRss } from "../api/_lib/news.js";
import { geminiJSON } from "../api/_lib/podcast.js";

const OUT = fileURLToPath(new URL("../learner/data/macro-news.json", import.meta.url));
const KEY = (process.env.GEMINI_API_KEY || "").trim(), SITE = (process.env.SITE_URL || "https://kline-school.vercel.app").replace(/\/$/, "");
const KEEP = 30, PER = 14;
export const QUERIES = {
  tw: ["台股 總經", "央行 利率 台灣", "台灣 外銷訂單 出口", "景氣燈號", "台灣 CPI 通膨", "新台幣 匯率", "台灣 GDP 經濟成長", "主計總處", "台股 大跌 原因"],
  us: ["聯準會 Fed 利率", "美國 CPI 通膨", "美國 非農 就業", "美債 殖利率", "美國 GDP", "FOMC 鮑爾", "美國 零售銷售 PMI", "美元指數", "美股 收盤 道瓊 那斯達克", "美股 大跌 原因"],
  world: ["歐洲央行 利率", "日本央行 日圓 升息", "中國 經濟 數據 GDP", "中國 人行 降息", "全球 經濟 IMF", "OPEC 原油", "歐元區 通膨", "日經 日本 經濟"],
};
export const TOPICS = [
  ["利率", /利率|升息|降息|央行|聯準會|Fed|FOMC|鮑爾|理監事|貨幣政策|點陣圖/i],
  ["通膨", /CPI|PCE|PPI|通膨|物價|核心/i],
  ["就業", /非農|就業|失業|薪資|初領|勞動/],
  ["景氣", /GDP|經濟成長|景氣|PMI|ISM|零售|消費|信心|衰退|領先指標/i],
  ["貿易", /出口|進口|外銷訂單|關稅|貿易|順差|逆差/],
  ["匯率", /新台幣|匯率|美元|日圓|人民幣|升值|貶值|DXY/i],
  ["債市", /殖利率|公債|美債|債券|國債/],
  ["原物料", /原油|OPEC|油價|銅價|黃金|天然氣|鐵礦/],
  // 盤勢：大盤大漲大跌的報導（通常會寫原因）；只有指數＋漲跌字眼才算，盤後紀錄、當沖選股這類不算
  ["盤勢", /(美股|道瓊|那斯達克|納斯達克|標普|費半|台股|加權指數|日經|股市|華爾街).{0,12}(大跌|重挫|暴跌|崩|跳水|急跌|下挫|收黑|大漲|狂飆|急漲|勁揚|收紅)|(大跌|重挫|暴跌|崩跌|大漲)的?原因/],
];
export const topicOf = t => (TOPICS.find(([, re]) => re.test(t)) || ["市場"])[0];
// 只留最近 hours 小時內、跟總經有關的標題；同一則新聞在不同關鍵字重複出現只留一次（去掉括號備註與標點後，前 14 個字一樣就算重複）
export function pick(lists, now = Date.now(), hours = 36, per = PER) {
  const seen = new Set(), out = [];
  for (const it of lists.flat().sort((a, b) => (b.at || 0) - (a.at || 0))) {
    if (!it.at || now - it.at > hours * 3600e3) continue;
    const k = it.title.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "").replace(/[\s\p{P}]/gu, "").slice(0, 14); if (seen.has(k)) continue; seen.add(k);
    const topic = topicOf(it.title); if (topic === "市場" && !/經濟|總經|財政|赤字|IMF|世界銀行|油價|黃金|衰退|央行/.test(it.title)) continue; // 「市場」類只留跟總經有關的（個股、當沖、公司活動不算）
    out.push({ ...it, topic });
  }
  return out.slice(0, per);
}
const PROMPT = (tw, us, world = []) => `你是財經編輯。下面是最近一天台灣、美國與世界（歐、日、中國、原物料）的總經新聞標題（只有標題、來源與時間）。請只根據標題整理，不要編造數字或標題沒提到的事。
用繁體中文、台灣用語，輸出 JSON：
{"tw":{"head":"一句話總結今天台灣總經重點（30 字內）","points":["3～5 條重點，每條 40 字內"],"impact":"對台股可能的影響（60 字內，用『可能』『留意』等保守語氣）"},
 "us":{"head":"...","points":["..."],"impact":"對美股（以及台股）可能的影響"},
 "world":{"head":"...","points":["..."],"impact":"對全球股市與台股可能的影響（例如日圓、人民幣、油價、出口需求）"}}
標題裡有美股、台股大漲大跌（盤勢）的報導時，那一邊的 head 先寫「大盤為什麼漲跌」（引用標題裡提到的原因，例如數據、財報、利率、地緣政治），points 第一條補充細節。
某一邊沒有新聞時，那一邊的 points 給空陣列、head 寫「今天沒有重要總經消息」。

【台灣】
${tw.map(x => `- ${x.title}（${x.source}）`).join("\n") || "（沒有）"}

【美國】
${us.map(x => `- ${x.title}（${x.source}）`).join("\n") || "（沒有）"}

【世界】
${world.map(x => `- ${x.title}（${x.source}）`).join("\n") || "（沒有）"}`;
export function parseSum(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null;
  try { const j = JSON.parse(m[0]); const ok = s => s && typeof s.head === "string" ? { head: s.head.slice(0, 80), points: (Array.isArray(s.points) ? s.points : []).filter(x => typeof x === "string").slice(0, 6).map(x => x.slice(0, 120)), impact: typeof s.impact === "string" ? s.impact.slice(0, 160) : "" } : null; return { tw: ok(j.tw), us: ok(j.us), world: ok(j.world) }; } catch { return null; }
}
async function summarize(tw, us, world) {
  const prompt = PROMPT(tw, us, world);
  // Gemini 先試（三個市場的摘要比較長，最多等 150 秒）；失敗或解析不出來就改用網站的 /api/chat
  if (KEY) { try { const r = await geminiJSON([{ text: prompt }], KEY, Date.now() + 150000), j = parseSum(r.text); if (j && (j.tw || j.us || j.world)) return { ...j, by: r.model }; console.log("::warning::Gemini 回應解析不出 JSON，改用網站"); } catch (e) { console.log("::warning::Gemini 失敗（" + e.message + "），改用網站"); } }
  const r = await fetch(SITE + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: prompt + "\n\n只輸出 JSON。" }] }), signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => null); if (!j?.ok) throw new Error(j?.error || `網站回應 ${r.status}`);
  return { ...parseSum(j.text), by: j.model || j.provider };
}
async function rss(q) {
  const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return parseRss(await r.text(), 20);
}
// 同一天跑第二次：新標題併進來（舊的保留），摘要換成新的
export function merge(old, day) {
  const days = (old?.days || []).filter(d => d.date !== day.date), prev = (old?.days || []).find(d => d.date === day.date);
  if (prev) for (const m of ["tw", "us", "world"]) { if (!day[m] || !prev[m]) continue; const have = new Set(day[m].items.map(x => x.title)); day[m].items = [...day[m].items, ...prev[m].items.filter(x => !have.has(x.title))].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, PER + 6); if (!day[m].sum && prev[m].sum) day[m].sum = prev[m].sum; }
  return { updated: day.at, days: [day, ...days].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, KEEP) };
}
export async function main() {
  const now = Date.now(), date = new Date(now + 8 * 3600e3).toISOString().slice(0, 10), got = { tw: [], us: [], world: [] }, errs = [];
  for (const m of ["tw", "us", "world"]) for (const q of QUERIES[m]) { try { got[m].push(await rss(q)); } catch (e) { errs.push(`${q}：${e.message}`); } await new Promise(r => setTimeout(r, 400)); }
  const tw = pick(got.tw, now), us = pick(got.us, now), world = pick(got.world, now);
  if (!tw.length && !us.length && !world.length) { console.log("::warning::沒有抓到任何總經新聞，保留原本的資料；" + errs.slice(0, 3).join("；")); return; }
  let sum = null; try { sum = await summarize(tw, us, world); } catch (e) { console.log("::warning::AI 摘要失敗，只放標題：" + e.message); }
  const day = { date, at: now, by: sum?.by || null, tw: { sum: sum?.tw || null, items: tw }, us: { sum: sum?.us || null, items: us }, world: { sum: sum?.world || null, items: world } };
  const old = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
  await writeFile(OUT, JSON.stringify(merge(old, day)));
  console.log("完成", date, "台灣", tw.length, "則、美國", us.length, "則", sum ? "，有 AI 摘要" : "", errs.length ? "；失敗：" + errs.join("；") : "");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::總經消息這次沒有更新：" + e.message); });
