// 法說會重點：公開資訊觀測站「法人說明會一覽表」找一家公司最近幾次法說會與簡報檔，AI 讀簡報（PDF）整理重點。
// GET  /api/confai?code=2330            → { ok, list: [{ date, time, note, file, en }] }（近 4 個月，新到舊；同一份簡報只留一次）
// POST /api/confai { code, file }        → { ok, head, outlook[], margin, capex, demand, risks[], quotes[], model, cached }
// 簡報檔放在 mopsov.twse.com.tw/nas/STR/（檔名＝代號＋法說會日期＋M／E＋序號）；同一份簡報整理過就存在 KV，之後直接回。
import { geminiJSON } from "./podcast.js";
import { kv, kvOn } from "./sync.js";
import { toIso } from "./calendar.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, MAX_MB = 15, TTL = 180 * 86400;
const strip = h => String(h).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export const okFile = (code, f) => typeof f === "string" && new RegExp(`^${code}\\d{8}[ME]\\d{3}\\.pdf$`, "i").test(f);
// 一覽表裡這家公司的列：[日期, 時間, 擇要訊息, 中文簡報檔, 英文簡報檔]
export function parseConfRows(html, code) {
  const out = [];
  for (const m of String(html || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]); if (cells.length < 8 || strip(cells[0]) !== code) continue;
    const files = cells.map(c => (c.match(/fileName\.value=["']?([\w.]+\.pdf)/i) || [])[1]).filter(Boolean);
    out.push({ date: toIso(strip(cells[2]).split(/[至~ ]/)[0]), time: strip(cells[3]), note: strip(cells[5]).slice(0, 300), file: files.find(f => /M\d{3}\.pdf$/i.test(f)) || null, en: files.find(f => /E\d{3}\.pdf$/i.test(f)) || null });
  }
  return out.filter(x => x.date);
}
async function monthRows(code, typek, y, m) {
  const r = await fetch("https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1", { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: `encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=${typek}&year=${y - 1911}&month=${String(m).padStart(2, "0")}`, signal: AbortSignal.timeout(12000) });
  return r.ok ? parseConfRows(await r.text(), code) : [];
}
export async function confList(code, months = 4) {
  const t = new Date(Date.now() + 8 * 3600e3), ym = Array.from({ length: months }, (_, i) => { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1)); return [d.getUTCFullYear(), d.getUTCMonth() + 1]; });
  const got = await Promise.allSettled(ym.flatMap(([y, m]) => ["sii", "otc"].map(k => monthRows(code, k, y, m)))), seen = new Set();
  return got.flatMap(x => (x.status === "fulfilled" ? x.value : [])).sort((a, b) => b.date.localeCompare(a.date))
    .filter(x => { const k = x.date + (x.file || ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}
const PROMPT = name => `你是台股研究員。這是「${name}」法人說明會的簡報。請只根據簡報內容整理，不要加簡報沒寫的數字或推測，用繁體中文、台灣用語，輸出 JSON：
{"head":"一句話總結這次法說會最重要的訊息（40 字內）",
 "outlook":["公司對下一季或全年的展望與指引，3～5 條，每條 50 字內，有數字就寫數字（營收、毛利率、營益率區間）"],
 "margin":"毛利率、營益率的表現與指引（60 字內，沒有就寫空字串）",
 "capex":"資本支出、擴產、新產能計畫（60 字內，沒有就寫空字串）",
 "demand":"各產品線、應用或地區的需求說法（80 字內）",
 "risks":["公司提到的風險或不確定因素，最多 3 條"],
 "quotes":["值得注意的原文重點句（簡報上的文字），最多 3 句"]}`;
const arr = (v, n, len) => (Array.isArray(v) ? v : []).filter(x => typeof x === "string" && x.trim()).slice(0, n).map(x => x.slice(0, len));
export function parseConfSum(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; let j; try { j = JSON.parse(m[0]); } catch { return null; }
  if (typeof j?.head !== "string") return null;
  const s = k => (typeof j[k] === "string" ? j[k].slice(0, 200) : "");
  return { head: j.head.slice(0, 80), outlook: arr(j.outlook, 6, 120), margin: s("margin"), capex: s("capex"), demand: s("demand"), risks: arr(j.risks, 3, 120), quotes: arr(j.quotes, 3, 160) };
}

export default async function handler(req, res) {
  const body = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) : {};
  const code = String(req.query?.code || body.code || "").trim().toUpperCase();
  if (!/^\d{4,6}[A-Z]?$/.test(code)) return res.status(400).json({ ok: false, error: "法說會只支援台股代號" });
  if (req.method !== "POST") {
    try { const list = await confList(code); res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400"); return res.status(200).json({ ok: true, code, list }); }
    catch (e) { return res.status(200).json({ ok: false, error: `拿不到法說會資料（${e.message}）` }); }
  }
  const file = String(body.file || ""), name = String(body.name || code).slice(0, 20);
  if (!okFile(code, file)) return res.status(400).json({ ok: false, error: "簡報檔名不對" });
  const ck = `confai:${file}`;
  if (kvOn()) { try { const v = await kv("GET", ck); if (v) return res.status(200).json({ ok: true, ...JSON.parse(v), cached: true }); } catch {} }
  const key = (process.env.GEMINI_API_KEY || "").trim(); if (!key) return res.status(200).json({ ok: false, error: "伺服器沒有設定 AI 金鑰（GEMINI_API_KEY）" });
  try {
    const v = await summarizeConf(file, name, key);
    if (kvOn()) { try { await kv("SET", ck, JSON.stringify(v), "EX", TTL); } catch {} }
    return res.status(200).json({ ok: true, ...v });
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
}
// 下載簡報、交給 Gemini 讀；排程或 probe-live 也可以直接呼叫
export async function summarizeConf(file, name, key, deadline = Date.now() + 55000) {
  const r = await fetch(`https://mopsov.twse.com.tw/nas/STR/${file}`, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok || !/pdf/i.test(r.headers.get("content-type") || "")) throw new Error(`簡報下載失敗（HTTP ${r.status}）`);
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_MB * 1048576) throw new Error(`簡報太大（${(buf.length / 1048576).toFixed(0)}MB）`);
  const out = await geminiJSON([{ inlineData: { mimeType: "application/pdf", data: buf.toString("base64") } }, { text: PROMPT(name) }], key, deadline), s = parseConfSum(out.text);
  if (!s) throw new Error("AI 回傳格式不對，請再試一次");
  return { ...s, file, model: out.model };
}
