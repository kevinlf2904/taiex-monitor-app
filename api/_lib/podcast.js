// 名人 Podcast：給 learner/watch.html 的「名人」分頁使用。
// GET  /api/podcast?q=股癌                 搜尋節目（Apple Podcasts 目錄），回傳 { shows: [{ id, name, author, art, feed }] }
// GET  /api/podcast?feed=<RSS 網址>&n=30    讀節目的 RSS，回傳 { show, eps: [{ guid, title, date, desc, audio, mime, bytes, dur, link, img }] }
// GET  /api/podcast?act=cfg                 目前能不能用 AI 整理（有 GEMINI_API_KEY 才能「聽完整集」，只有 ANTHROPIC_API_KEY 時只能讀節目說明）
// POST /api/podcast { act: "upload", audio, name }          下載單集音檔、上傳到 Gemini Files（48 小時後自動刪除），回傳 { file, uri, mime, state }
// GET  /api/podcast?act=file&name=files/xxx                 查上傳的音檔處理好了沒（state: PROCESSING／ACTIVE／FAILED）
// POST /api/podcast { act: "sum", uri?, mime?, title, show, date, desc }
//      有 uri：Gemini 聽音檔整理；沒有：用節目說明（show notes）整理。回傳 { tldr, points, sections, calls, topics, mode, model }
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
export function parseRss(xml, n = 30) {
  const s = String(xml || ""), first = s.search(/<item[\s>]/i), head = first > 0 ? s.slice(0, first) : s;
  const show = { name: txt(head, "title"), author: txt(head, "itunes:author") || txt(head, "managingEditor"), art: attr(head, "itunes:image", "href") || txt(tag(head, "image"), "url"), desc: txt(head, "description").slice(0, 600), link: txt(head, "link") };
  const items = s.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const eps = items.slice(0, n).map(it => {
    const audio = attr(it, "enclosure", "url"), date = Date.parse(txt(it, "pubDate"));
    const desc = htmlText(tag(it, "content:encoded")) || txt(it, "description") || txt(it, "itunes:summary");
    return { guid: txt(it, "guid") || audio || txt(it, "title"), title: txt(it, "title"), date: Number.isFinite(date) ? new Date(date).toISOString() : null, desc: desc.slice(0, 6000),
      audio, mime: attr(it, "enclosure", "type") || "audio/mpeg", bytes: +attr(it, "enclosure", "length") || null, dur: durSec(txt(it, "itunes:duration")), link: txt(it, "link"), img: attr(it, "itunes:image", "href") || null };
  }).filter(e => e.title && e.date);
  return { show, eps };
}

// ---------- AI 整理 ----------
export const PROMPT = (m, mode) => `你是財經 Podcast 的整理編輯。${mode === "audio" ? "請聽附上的這一集完整音檔" : "這一集只有節目說明文字（沒有逐字稿），請只根據說明文字"}，用繁體中文整理成 JSON（只輸出 JSON，不要其他文字）：
{
  "tldr": "一句話摘要，60 字以內，講這集最重要的判斷",
  "points": ["重點 4～7 條，每條 40～90 字，具體寫出主持人的論點與理由"],
  "sections": [{ "title": "小標 6～14 字", "body": "120～220 字的段落" }],
  "calls": [{ "name": "公司或 ETF 名稱", "code": "台股代號（4～6 碼，ETF 可能有字母結尾）或美股代號", "market": "TW 或 US", "dir": "bull 或 bear", "quote": "主持人說的原話或非常接近原話，60 字以內" }],
  "topics": ["這集討論的議題 2～4 個，每個 12 字以內，可以是問句"]
}
規則：
- sections 2～4 段；${mode === "audio" ? "" : "說明文字太少時 points、sections 可以少一點，不要硬湊；"}不要編造節目沒有講的內容、數字或公司。
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
    points: (Array.isArray(j.points) ? j.points : []).map(p => str(p, 260)).filter(Boolean).slice(0, 8),
    sections: (Array.isArray(j.sections) ? j.sections : []).map(x => ({ title: str(x?.title, 40), body: str(x?.body, 700) })).filter(x => x.title && x.body).slice(0, 5),
    calls, topics: (Array.isArray(j.topics) ? j.topics : []).map(t => str(t, 30)).filter(Boolean).slice(0, 5),
  };
}

export async function geminiJSON(parts, key, deadline) {
  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-flash-latest", ...GEMINI_FALLBACKS])];
  const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 8192 } });
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
  const client = new Anthropic();
  const msg = await client.beta.messages.create({ model: "claude-opus-5-5", max_tokens: 6000, output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", messages: [{ role: "user", content: prompt }] });
  return { text: msg.content.filter(b => b.type === "text").map(b => b.text).join(""), model: msg.model };
}

// ---------- 音檔上傳到 Gemini Files（可續傳上傳的兩步驟：start → upload, finalize） ----------
export async function uploadAudio(url, name, key, { dlMs = 30000, upMs = 40000 } = {}) {
  const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(dlMs) });
  if (!r.ok) throw new Error(`下載音檔失敗（HTTP ${r.status}）`);
  const len = +r.headers.get("content-length") || 0; if (len > MAX_AUDIO) throw new Error(`音檔太大（${Math.round(len / 1048576)}MB），改用節目說明整理。`);
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_AUDIO) throw new Error("音檔太大，改用節目說明整理。");
  let mime = (r.headers.get("content-type") || "").split(";")[0].trim(); if (!/^audio\//.test(mime)) mime = /\.m4a(\?|$)/i.test(url) ? "audio/mp4" : "audio/mpeg";
  const st = await fetch(`${GEMINI}/upload/v1beta/files`, { method: "POST", headers: { "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(buf.length), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" }, body: JSON.stringify({ file: { display_name: String(name || "podcast").slice(0, 100) } }), signal: AbortSignal.timeout(15000) });
  const up = st.headers.get("x-goog-upload-url"); if (!st.ok || !up) throw new Error(`上傳到 Gemini 失敗（HTTP ${st.status}）`);
  const fin = await fetch(up, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: buf, signal: AbortSignal.timeout(upMs) });
  const j = await fin.json().catch(() => ({})); if (!fin.ok || !j.file?.uri) throw new Error(`上傳到 Gemini 失敗（HTTP ${fin.status}）`);
  return { file: j.file.name, uri: j.file.uri, mime, state: j.file.state || "PROCESSING", mb: +(buf.length / 1048576).toFixed(1) };
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
        const uri = typeof b.uri === "string" && /^https:\/\/generativelanguage\.googleapis\.com\//.test(b.uri) ? b.uri : null, mode = uri ? "audio" : "notes";
        if (mode === "notes" && meta.desc.replace(/\s/g, "").length < 40) return res.status(200).json({ ok: false, error: "這集的節目說明太短，沒辦法只靠說明整理。" });
        let out;
        if (gem) out = await geminiJSON([...(uri ? [{ fileData: { mimeType: String(b.mime || "audio/mpeg"), fileUri: uri } }] : []), { text: PROMPT(meta, mode) }], gem, deadline);
        else if (claude && mode === "notes") out = await claudeJSON(PROMPT(meta, mode));
        else return res.status(200).json({ ok: false, error: "伺服器沒有設定 GEMINI_API_KEY（或 ANTHROPIC_API_KEY），無法用 AI 整理。" });
        if (uri && b.file && /^files\/[a-z0-9-]+$/i.test(b.file)) fetch(`${GEMINI}/v1beta/${b.file}`, { method: "DELETE", headers: { "x-goog-api-key": gem } }).catch(() => {}); // 整理完就刪掉音檔
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
    if (q.feed) {
      const url = safeUrl(q.feed); if (!url) return res.status(400).json({ ok: false, error: "RSS 網址不正確" });
      const r = await fetch(url, { headers: { ...UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!r.ok) return res.status(200).json({ ok: false, error: `讀不到這個節目的 RSS（HTTP ${r.status}）` });
      const p = parseRss(await r.text(), Math.max(1, Math.min(100, +q.n || 30)));
      if (!p.eps.length) return res.status(200).json({ ok: false, error: "這個 RSS 裡沒有單集" });
      res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
      return res.status(200).json({ ok: true, feed: url, ...p });
    }
    return res.status(400).json({ ok: false, error: "用法：?q=節目名稱、?feed=RSS 網址、?act=cfg" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || "處理失敗" });
  }
}
