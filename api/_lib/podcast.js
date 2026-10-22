// 名人 Podcast：給 learner/watch.html 的「名人」分頁使用。
// GET  /api/podcast?q=股癌                 搜尋節目（Apple Podcasts 目錄），回傳 { shows: [{ id, name, author, art, feed }] }
// GET  /api/podcast?yts=財經                 搜尋 YouTube 頻道，回傳 { shows: [...] }（feed 是頻道的影片 RSS）
// GET  /api/podcast?yt=@handle 或頻道網址     找出 YouTube 頻道的影片 RSS
// GET  /api/podcast?feed=<RSS 網址>&n=30    讀節目的 RSS，回傳 { show, eps: [{ guid, title, date, desc, audio, mime, bytes, dur, link, img }] }
// GET  /api/podcast?act=cfg                 目前能不能用 AI 整理（有 GEMINI_API_KEY 才能「聽完整集」，只有 ANTHROPIC_API_KEY 時只能讀節目說明）
// POST /api/podcast { act: "upload", audio, name }          下載單集音檔、上傳到 Gemini Files（48 小時後自動刪除），回傳 { file, uri, mime, state }
// GET  /api/podcast?act=file&name=files/xxx                 查上傳的音檔處理好了沒（state: PROCESSING／ACTIVE／FAILED）
// POST /api/podcast { act: "sum", uri?, mime?, video?, title, show, date, desc }
//      有 uri：Gemini 聽音檔整理；有 video（YouTube 影片網址）：Gemini 直接看影片整理；都沒有：用節目說明（show notes）整理。回傳 { tldr, points, sections, facts, risks, watch, calls, topics, mode, model }
//      calls：主持人明確看多／看空的個股或 ETF [{ code, name, market: "TW"|"US", dir: "bull"|"bear", quote }]
// 金鑰只放在 Vercel 環境變數（GEMINI_API_KEY／ANTHROPIC_API_KEY），不會出現在前端。整理結果只存在使用者的瀏覽器。

import Anthropic from "@anthropic-ai/sdk";
import { GEMINI_FALLBACKS } from "./chat.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" };
const MAX_AUDIO = 150 * 1024 * 1024; // Gemini Files 上限 2GB；這裡受伺服器記憶體限制，一小時左右的節目約 30～60MB
const GEMINI = "https://generativelanguage.googleapis.com";

// 只允許一般的 http(s) 網址，擋掉內網、本機與 IP 位址（避免被拿來打內部服務）
export function safeUrl(raw) {
  let u; try { u = new URL(String(raw || "")); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || /\.(local|internal|localhost)$/.test(h) || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  return u.toString();
}

// 內網位址：127/8、10/8、172.16/12、192.168/16、169.254/16、100.64/10（CGNAT）、0/8、組播；IPv6 的 ::1、fc00::/7、fe80::/10、對應到 IPv4 的 ::ffff:x.x.x.x
export function privIp(ip) {
  const s = String(ip || "").toLowerCase(), m4 = s.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m4) { const [a, b] = [+m4[1], +m4[2]]; return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("::ffff:");
}
// 抓外部網址：每一次跳轉都重新檢查網址，且網域解析出來的 IP 不能是內網（擋「看起來是公開網址、其實指到本機」的手法）
export async function safeFetch(raw, opts = {}, { hops = 5, lookup = null } = {}) {
  const dns = lookup || (await import("node:dns/promises")).lookup;
  let url = raw;
  for (let i = 0; i <= hops; i++) {
    const u = safeUrl(url); if (!u) throw new Error("網址不正確");
    let addrs; try { addrs = await dns(new URL(u).hostname, { all: true }); } catch { throw new Error("找不到這個網址"); }
    if (!addrs.length || addrs.some(a => privIp(a.address))) throw new Error("不允許連到這個網址");
    const r = await fetch(u, { ...opts, redirect: "manual" });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) return r;
    url = new URL(loc, u).toString();
  }
  throw new Error("網址跳轉太多次");
}
// 讀回應內容，超過上限就中止（不先把整個檔案讀進記憶體才發現太大）
export async function readCapped(r, max) {
  if (!r.body?.getReader) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > max) throw new Error("檔案太大"); return b; }
  const rd = r.body.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > max) { try { await rd.cancel(); } catch {} throw new Error("檔案太大"); } parts.push(value); }
  return Buffer.concat(parts.map(p => Buffer.from(p)));
}
const httpOnly = u => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");

// ---------- RSS ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = s => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const uncdata = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
// 節目說明是 HTML：換行保留、標籤拿掉
export const htmlText = s => decode(uncdata(s).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<li[^>]*>/gi, "・").replace(/<[^>]+>/g, ""))
  .replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
const esc = n => n.replace(/[:.]/g, m => "\\" + m);
const tag = (s, name) => { const m = s.match(new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, "i")); return m ? m[1] : ""; };
const attr = (s, name, a) => { const m = s.match(new RegExp(`<${esc(name)}\\s[^>]*?\\b${a}\\s*=\\s*["']([^"']+)["']`, "i")); return m ? decode(m[1]) : ""; };
const txt = (s, name) => htmlText(tag(s, name));
export function durSec(v) {
  const s = String(v || "").trim(); if (!s) return null;
  if (/^\d+$/.test(s)) return +s;
  const p = s.split(":").map(Number); if (p.some(x => !Number.isFinite(x))) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}
// YouTube 頻道的影片 RSS（Atom：<feed><entry>…）：每支影片的 video 是觀看網址（Gemini 可以直接看），沒有音檔；#shorts 短影片不收
export const ytWatch = id => (/^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : "");
export const isYtVideo = u => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(String(u || ""));
export function parseYt(xml, n = 30) {
  const s = String(xml || ""), first = s.search(/<entry[\s>]/i), head = first > 0 ? s.slice(0, first) : s;
  const show = { name: txt(head, "title"), author: txt(tag(head, "author"), "name"), art: "", desc: "", link: httpOnly(attr(head, "link", "href")), yt: true };
  const eps = (s.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []).map(it => {
    const id = txt(it, "yt:videoId"), date = Date.parse(txt(it, "published")), title = txt(it, "title"), video = ytWatch(id);
    return { guid: "yt:" + id, title, date: Number.isFinite(date) ? new Date(date).toISOString() : null, desc: txt(it, "media:description").slice(0, 6000), audio: "", video, mime: "", bytes: null, dur: null, link: video, img: httpOnly(attr(it, "media:thumbnail", "url")) || null };
  }).filter(e => e.title && e.date && e.video && !/#shorts?\b/i.test(e.title + " " + e.desc.slice(0, 200))).slice(0, n);
  return { show, eps };
}
export function parseRss(xml, n = 30) {
  const s = String(xml || ""), first = s.search(/<item[\s>]/i), head = first > 0 ? s.slice(0, first) : s;
  if (first < 0 && /<entry[\s>]/i.test(s) && /yt:videoId/.test(s)) return parseYt(s, n); // YouTube 頻道
  const show = { name: txt(head, "title"), author: txt(head, "itunes:author") || txt(head, "managingEditor"), art: attr(head, "itunes:image", "href") || txt(tag(head, "image"), "url"), desc: txt(head, "description").slice(0, 600), link: httpOnly(txt(head, "link")) };
  show.art = httpOnly(show.art);
  const items = s.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const eps = items.slice(0, n).map(it => {
    const audio = attr(it, "enclosure", "url"), date = Date.parse(txt(it, "pubDate"));
    const desc = htmlText(tag(it, "content:encoded")) || txt(it, "description") || txt(it, "itunes:summary");
    return { guid: txt(it, "guid") || audio || txt(it, "title"), title: txt(it, "title"), date: Number.isFinite(date) ? new Date(date).toISOString() : null, desc: desc.slice(0, 6000),
      audio: httpOnly(audio), mime: attr(it, "enclosure", "type") || "audio/mpeg", bytes: +attr(it, "enclosure", "length") || null, dur: durSec(txt(it, "itunes:duration")), link: httpOnly(txt(it, "link")), img: httpOnly(attr(it, "itunes:image", "href")) || null }; // 連結只收 http(s)，擋 javascript: 這類網址
  }).filter(e => e.title && e.date);
  return { show, eps };
}

// ---------- AI 整理 ----------
// 摘要格式版本：改了提示詞就加 1，排程會把每個節目最近幾集用新版重新整理
export const SUM_VER = 2;
export const PROMPT = (m, mode) => `你是財經 Podcast 與 YouTube 節目的整理編輯。${mode === "audio" ? "請聽附上的這一集完整音檔" : mode === "video" ? "請看附上的這支 YouTube 影片完整內容（以講者說的話為主，畫面上的圖表與字幕也可以參考）" : "這一集只有節目說明文字（沒有逐字稿），請只根據說明文字"}，用繁體中文整理成 JSON（只輸出 JSON，不要其他文字）：
{
  "tldr": "一句話摘要，60 字以內，講這集最重要的判斷",
  "points": ["重點 6～10 條，每條 60～140 字，具體寫出主持人的論點、理由與舉的例子"],
  "sections": [{ "title": "小標 6～14 字", "body": "250～450 字的段落，照節目討論的順序，寫出來龍去脈、主持人的推論過程、提到的數據與公司" }],
  "facts": ["節目提到的具體數字、日期、事件或財報資料 3～8 條，每條 50 字以內，照節目說的寫"],
  "risks": ["主持人提到的風險、反方看法或要小心的地方 1～4 條，每條 80 字以內"],
  "watch": ["主持人說接下來要觀察的指標、事件或時間點 1～4 條，每條 60 字以內"],
  "calls": [{ "name": "公司或 ETF 名稱", "code": "台股代號（4～6 碼，ETF 可能有字母結尾）或美股代號", "market": "TW 或 US", "dir": "bull 或 bear", "quote": "主持人說的原話或非常接近原話，60 字以內" }],
  "topics": ["這集討論的議題 2～4 個，每個 12 字以內，可以是問句"]
}
規則：
- sections 4～7 段，讀起來像一篇完整的節目筆記；facts、risks、watch 節目沒講就給空陣列；${mode === "audio" ? "" : "說明文字太少時 points、sections 可以少一點，不要硬湊；"}不要編造節目沒有講的內容、數字或公司。
- calls 只放主持人「明確表達看多或看空」的個股或 ETF（例如：看好、會漲、加碼、買進、續抱＝bull；看壞、轉空、減碼、賣出、避開＝bear）。只是提到、舉例、新聞轉述、廣告業配都不要放。
- 代號不確定時 code 留空字串，只填 name。美股寫英文代號（例如 NVDA）。同一檔只放一次。最多 12 檔，沒有就給空陣列。
- 不要加入你自己的投資建議。
節目：${m.show || ""}
單集：${m.title || ""}
日期：${m.date || ""}${mode === "audio" ? "" : `\n節目說明：\n${String(m.desc || "").slice(0, 6000)}`}`;

export function parseSum(text) {
  let s = String(text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a < 0 || b < a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const str = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const okCode = c => /^(\d{4,6}[A-Z]?|[A-Z]{1,5}(?:[.-][A-Z])?)$/.test(c);
  const seen = new Set();
  const calls = (Array.isArray(j.calls) ? j.calls : []).map(c => {
    const code = str(c?.code, 12).toUpperCase(), market = /^\d/.test(code) ? "TW" : code ? "US" : String(c?.market).toUpperCase() === "US" ? "US" : "TW";
    return { name: str(c?.name, 30), code: okCode(code) ? code : "", market, dir: /bear|空|賣|減/i.test(String(c?.dir)) ? "bear" : "bull", quote: str(c?.quote, 120) };
  }).filter(c => (c.name || c.code) && !seen.has(c.code || c.name) && seen.add(c.code || c.name)).slice(0, 15);
  return {
    tldr: str(j.tldr, 160),
    points: (Array.isArray(j.points) ? j.points : []).map(p => str(p, 320)).filter(Boolean).slice(0, 12),
    sections: (Array.isArray(j.sections) ? j.sections : []).map(x => ({ title: str(x?.title, 40), body: str(x?.body, 1200) })).filter(x => x.title && x.body).slice(0, 8),
    ...Object.fromEntries([["facts", 10, 120], ["risks", 5, 200], ["watch", 5, 160]].map(([k, n, len]) => [k, (Array.isArray(j[k]) ? j[k] : []).map(p => str(p, len)).filter(Boolean).slice(0, n)])),
    calls, topics: (Array.isArray(j.topics) ? j.topics : []).map(t => str(t, 30)).filter(Boolean).slice(0, 5),
  };
}

export async function geminiJSON(parts, key, deadline, extra = {}) {
  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-flash-latest", ...GEMINI_FALLBACKS])];
  const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 16384, ...extra } });
  let last = null;
  for (const m of models) {
    const left = deadline - Date.now(); if (left < 4000) break;
    try {
      const r = await fetch(`${GEMINI}/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(left - 1500) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { last = `${r.status} ${j?.error?.message || ""}`.trim(); if ([404, 429, 500, 502, 503, 504].includes(r.status)) continue; break; }
      const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      if (text) return { text, model: m };
      last = j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || "沒有回應";
    } catch (e) { last = e.name === "TimeoutError" ? "逾時" : e.message; }
  }
  throw new Error(last || "Gemini 沒有回應");
}
async function claudeJSON(prompt) {
  const client = new Anthropic({ timeout: 50000, maxRetries: 0 }); // 要在 Vercel 的 60 秒內回完
  const msg = await client.beta.messages.create({ model: "claude-opus-5-5", max_tokens: 12000, output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", messages: [{ role: "user", content: prompt }] });
  return { text: msg.content.filter(b => b.type === "text").map(b => b.text).join(""), model: msg.model };
}

// ---------- 音檔上傳到 Gemini Files（可續傳上傳的兩步驟：start → upload, finalize） ----------
export async function uploadAudio(url, name, key, { dlMs = 30000, upMs = 40000 } = {}) {
  const r = await safeFetch(url, { headers: UA, signal: AbortSignal.timeout(dlMs) });
  if (!r.ok) throw new Error(`下載音檔失敗（HTTP ${r.status}）`);
  const len = +r.headers.get("content-length") || 0; if (len > MAX_AUDIO) throw new Error(`音檔太大（${Math.round(len / 1048576)}MB），改用節目說明整理。`);
  const buf = await readCapped(r, MAX_AUDIO).catch(e => { throw new Error(/太大/.test(e.message) ? "音檔太大，改用節目說明整理。" : e.message); });
  let mime = (r.headers.get("content-type") || "").split(";")[0].trim(); if (!/^audio\//.test(mime)) mime = /\.m4a(\?|$)/i.test(url) ? "audio/mp4" : "audio/mpeg";
  const st = await fetch(`${GEMINI}/upload/v1beta/files`, { method: "POST", headers: { "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(buf.length), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" }, body: JSON.stringify({ file: { display_name: String(name || "podcast").slice(0, 100) } }), signal: AbortSignal.timeout(15000) });
  const up = st.headers.get("x-goog-upload-url"); if (!st.ok || !up) throw new Error(`上傳到 Gemini 失敗（HTTP ${st.status}）`);
  const fin = await fetch(up, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: buf, signal: AbortSignal.timeout(upMs) });
  const j = await fin.json().catch(() => ({})); if (!fin.ok || !j.file?.uri) throw new Error(`上傳到 Gemini 失敗（HTTP ${fin.status}）`);
  return { file: j.file.name, uri: j.file.uri, mime, state: j.file.state || "PROCESSING", mb: +(buf.length / 1048576).toFixed(1) };
}

// YouTube 影片給 Gemini：影片以說話為主，畫面每 20 秒取一張、低解析度，一小時的影片約十幾萬 token（不然整支高畫質很容易超過上限）
export const ytParts = (video, prompt) => [{ fileData: { fileUri: video }, videoMetadata: { fps: 0.05 } }, { text: prompt }];
export const YT_CFG = { mediaResolution: "MEDIA_RESOLUTION_LOW" };
// YouTube 頻道：搜尋（解析搜尋結果頁，不需要 API 金鑰）、用 @handle／頻道網址找頻道代號；影片 RSS 是 /feeds/videos.xml?channel_id=UC…
const YT = "https://www.youtube.com", ytFeed = id => `${YT}/feeds/videos.xml?channel_id=${id}`, YT_HDR = { ...UA, "Accept-Language": "zh-TW,zh;q=0.9" };
export function ytSearchParse(html) {
  const out = [], seen = new Set();
  const h = String(html);
  for (const m of h.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)) {
    const id = m[1], b = h.slice(m.index + m[0].length, m.index + m[0].length + 2500); if (seen.has(id)) continue; seen.add(id);
    const name = decode((b.match(/"title":\{"simpleText":"((?:[^"\\]|\\.)*)"/) || [])[1] || "").replace(/\\u0026/g, "&").replace(/\\"/g, '"');
    let art = (b.match(/"thumbnails":\[\{"url":"([^"]+)"/) || [])[1] || ""; if (art.startsWith("//")) art = "https:" + art;
    if (name) out.push({ id, name, author: name, art: httpOnly(art), feed: ytFeed(id), yt: true });
  }
  return out.slice(0, 12);
}
export function ytChannelParse(html) {
  const s = String(html), id = (s.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/) || s.match(/channel\/(UC[\w-]{22})/) || [])[1];
  if (!id) return null;
  const meta = p => decode((s.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`)) || [])[1] || "");
  return { id, name: meta("title") || id, author: meta("title"), art: httpOnly(meta("image")), feed: ytFeed(id), yt: true };
}
export async function ytSearch(q) {
  const r = await fetch(`${YT}/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`, { headers: YT_HDR, signal: AbortSignal.timeout(12000) }); // sp＝只找頻道
  if (!r.ok) throw new Error(`YouTube 搜尋失敗（HTTP ${r.status}）`); return ytSearchParse(await r.text());
}
// 輸入可以是 @handle、頻道網址（/@xxx、/channel/UC…、/c/xxx、/user/xxx）或頻道代號
export function ytInput(raw) {
  const v = String(raw || "").trim(); let m;
  if ((m = v.match(/(?:^|\/channel\/)(UC[\w-]{22})\b/))) return { id: m[1] };
  if ((m = v.match(/^@([\w.\-\u0080-\uffff]{2,60})$/) || v.match(/youtube\.com\/@([^/?#\s]+)/i))) return { path: "/@" + encodeURIComponent(decodeURIComponent(m[1])) };
  if ((m = v.match(/youtube\.com\/(c|user)\/([^/?#\s]+)/i))) return { path: `/${m[1]}/${encodeURIComponent(decodeURIComponent(m[2]))}` };
  return null;
}
export async function ytChannel(raw) {
  const k = ytInput(raw); if (!k) return null;
  const r = await fetch(YT + (k.id ? `/channel/${k.id}` : k.path), { headers: YT_HDR, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`找不到這個 YouTube 頻道（HTTP ${r.status}）`);
  return ytChannelParse(await r.text()) || (k.id ? { id: k.id, name: k.id, author: "", art: "", feed: ytFeed(k.id), yt: true } : null);
}

export async function itunes(q) {
  const u = `https://itunes.apple.com/search?media=podcast&entity=podcast&country=TW&limit=12&term=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.results || []).filter(x => x.feedUrl).map(x => ({ id: String(x.collectionId), name: x.collectionName, author: x.artistName, art: x.artworkUrl600 || x.artworkUrl100 || "", feed: x.feedUrl, n: x.trackCount || null, genre: x.primaryGenreName || "" }));
}

// 給排程整理（scripts/podcast-sync.mjs）用：查上傳的音檔處理好了沒、刪掉
export async function fileState(name, key) { const r = await fetch(`${GEMINI}/v1beta/${name}`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(10000) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`HTTP ${r.status}`); return j.state; }
export const fileDelete = (name, key) => fetch(`${GEMINI}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {});

export default async function handler(req, res) {
  const q = req.query || {}, gem = (process.env.GEMINI_API_KEY || "").trim(), claude = !!process.env.ANTHROPIC_API_KEY;
  try {
    if (req.method === "POST") {
      const b = req.body || {}, deadline = Date.now() + 55000;
      if (b.act === "upload") {
        if (!gem) return res.status(200).json({ ok: false, error: "聽完整集需要在 Vercel 設定 GEMINI_API_KEY；現在可以先用節目說明整理。" });
        const url = safeUrl(b.audio); if (!url) return res.status(400).json({ ok: false, error: "音檔網址不正確" });
        return res.status(200).json({ ok: true, ...(await uploadAudio(url, b.name, gem)) });
      }
      if (b.act === "sum") {
        const meta = { title: String(b.title || "").slice(0, 200), show: String(b.show || "").slice(0, 100), date: String(b.date || "").slice(0, 20), desc: String(b.desc || "").slice(0, 6000) };
        const uri = typeof b.uri === "string" && /^https:\/\/generativelanguage\.googleapis\.com\//.test(b.uri) ? b.uri : null, video = !uri && isYtVideo(b.video) ? b.video : null, mode = uri ? "audio" : video ? "video" : "notes";
        if (video && !gem) return res.status(200).json({ ok: false, error: "看 YouTube 影片需要在 Vercel 設定 GEMINI_API_KEY；現在可以先用影片說明整理。" });
        if (mode === "notes" && meta.desc.replace(/\s/g, "").length < 40) return res.status(200).json({ ok: false, error: "這集的節目說明太短，沒辦法只靠說明整理。" });
        let out;
        if (gem && video) out = await geminiJSON(ytParts(video, PROMPT(meta, mode)), gem, deadline, YT_CFG);
        else if (gem) out = await geminiJSON([...(uri ? [{ fileData: { mimeType: String(b.mime || "audio/mpeg"), fileUri: uri } }] : []), { text: PROMPT(meta, mode) }], gem, deadline);
        else if (claude && mode === "notes") out = await claudeJSON(PROMPT(meta, mode));
        else return res.status(200).json({ ok: false, error: "伺服器沒有設定 GEMINI_API_KEY（或 ANTHROPIC_API_KEY），無法用 AI 整理。" });
        if (uri && b.file && /^files\/[a-z0-9-]+$/i.test(b.file)) await fetch(`${GEMINI}/v1beta/${b.file}`, { method: "DELETE", headers: { "x-goog-api-key": gem }, signal: AbortSignal.timeout(5000) }).catch(() => {}); // 整理完就刪掉音檔（等它刪完，回應送出後函式可能就被凍結）
        const sum = parseSum(out.text); if (!sum) return res.status(200).json({ ok: false, error: "AI 回傳的格式不對，請再試一次。" });
        return res.status(200).json({ ok: true, ...sum, mode, model: out.model });
      }
      return res.status(400).json({ ok: false, error: "不支援的動作" });
    }
    if (q.act === "cfg") return res.status(200).json({ ok: true, audio: !!gem, notes: !!gem || claude, provider: gem ? "gemini" : claude ? "claude" : null });
    if (q.act === "file") {
      if (!gem) return res.status(200).json({ ok: false, error: "沒有 GEMINI_API_KEY" });
      const name = String(q.name || ""); if (!/^files\/[a-z0-9-]+$/i.test(name)) return res.status(400).json({ ok: false, error: "檔名不正確" });
      const r = await fetch(`${GEMINI}/v1beta/${name}`, { headers: { "x-goog-api-key": gem }, signal: AbortSignal.timeout(10000) }), j = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(200).json({ ok: false, error: `查不到上傳的音檔（HTTP ${r.status}）` });
      return res.status(200).json({ ok: true, state: j.state, uri: j.uri, mime: j.mimeType });
    }
    if (q.q) {
      const shows = await itunes(String(q.q).slice(0, 60));
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
      return res.status(200).json({ ok: true, shows });
    }
    if (q.yts) {
      const shows = await ytSearch(String(q.yts).slice(0, 60));
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
      return res.status(200).json({ ok: true, shows });
    }
    if (q.yt) {
      const ch = await ytChannel(String(q.yt).slice(0, 200)); if (!ch) return res.status(200).json({ ok: false, error: "看不懂這個 YouTube 頻道網址，請貼頻道首頁網址或 @帳號" });
      res.setHeader("Cache-Control", "s-maxage=86400");
      return res.status(200).json({ ok: true, shows: [ch] });
    }
    if (q.feed) {
      const url = safeUrl(q.feed); if (!url) return res.status(400).json({ ok: false, error: "RSS 網址不正確" });
      const r = await safeFetch(url, { headers: { ...UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return res.status(200).json({ ok: false, error: `讀不到這個節目的 RSS（HTTP ${r.status}）` });
      const p = parseRss((await readCapped(r, 15 * 1048576)).toString("utf8"), Math.max(1, Math.min(100, +q.n || 30)));
      if (!p.eps.length) return res.status(200).json({ ok: false, error: "這個 RSS 裡沒有單集" });
      res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
      return res.status(200).json({ ok: true, feed: url, ...p });
    }
    return res.status(400).json({ ok: false, error: "用法：?q=節目名稱、?yts=YouTube 頻道名稱、?yt=@帳號或頻道網址、?feed=RSS 網址、?act=cfg" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || "處理失敗" });
  }
}
