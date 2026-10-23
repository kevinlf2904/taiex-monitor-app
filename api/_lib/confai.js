// 法說會重點：公開資訊觀測站「法人說明會一覽表」找一家公司最近幾次法說會與簡報檔，AI 讀簡報（PDF）整理重點。
// GET  /api/confai?code=2330            → { ok, list: [{ date, time, note, file, en }] }（今年和去年，新到舊，含已排定還沒開的；同一天同一份簡報只留一次）
// POST /api/confai { code, file }        → { ok, head, outlook[], margin, capex, demand, risks[], quotes[], model, cached }
// POST /api/confai { op: "cmp", code, file, prev, a, b } → { ok, tone, head, changes: [{ k, now, before }] }（a、b＝這次、上一季的整理結果，AI 比較兩份文字，不再讀簡報）
// 簡報檔放在 mopsov.twse.com.tw/nas/STR/（檔名＝代號＋法說會日期＋M／E＋序號）；同一份簡報整理過就存在 KV，之後直接回。
import { geminiJSON, uploadBuf, fileState, fileDelete } from "./podcast.js";
import { kv, kvOn } from "./sync.js";
import { toIso } from "./calendar.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" }, MAX_MB = 45, INLINE_MB = 12, TTL = 180 * 86400;
const strip = h => String(h).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim(); // 觀測站的文字夾了很多 &#8206;（看不見的方向符號）
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
// 用 co_id 單查一家公司整年（月份留空），一次約 1 秒；上市、上櫃、興櫃都查，查不到的那邊回空表
async function yearRows(code, typek, y) {
  const r = await fetch("https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1", { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: `encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=${typek}&co_id=${code}&year=${y - 1911}&month=`, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`觀測站 HTTP ${r.status}`); return parseConfRows(await r.text(), code);
}
export async function confList(code) {
  const y = new Date(Date.now() + 8 * 3600e3).getUTCFullYear(), got = await Promise.allSettled([y, y - 1].flatMap(yy => ["sii", "otc", "rotc"].map(k => yearRows(code, k, yy)))), seen = new Set();
  if (got.every(x => x.status === "rejected")) throw new Error(got[0].reason?.message || "觀測站沒有回應");
  return got.flatMap(x => (x.status === "fulfilled" ? x.value : [])).sort((a, b) => b.date.localeCompare(a.date))
    .filter(x => { const k = x.date + (x.file || ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}
// 要整理哪一場：最近一次已經召開、有簡報的（還沒開的常沒有簡報）；learner/earnplus.js 的 epConf 用同一個規則
export const pickConf = (L, today) => L.find(x => x.file && x.date <= today) || L.find(x => x.file) || null;
// 上一季：比 f 的簡報早 40 天以上、不同檔的最近一份（簡報檔名＝代號＋日期＋M＋序號，用檔名的日期比較，同一份簡報在多場論壇重複用也不會誤判）
const fileDay = (code, f) => String(f || "").slice(code.length, code.length + 8);
export function prevConf(L, f, code) {
  if (!f?.file) return null; const d0 = Date.parse(fileDay(code, f.file).replace(/(\d{4})(\d\d)(\d\d)/, "$1-$2-$3"));
  return L.find(x => x.file && x.file !== f.file && d0 - Date.parse(fileDay(code, x.file).replace(/(\d{4})(\d\d)(\d\d)/, "$1-$2-$3")) >= 40 * 864e5) || null;
}
// 兩季比較：只把兩份整理好的重點（文字）交給 AI，請它說哪些地方變了；tone＝更樂觀／差不多／更保守
const CMP_PROMPT = name => `你是台股研究員。下面是「${name}」最近兩次法說會簡報的重點整理（新的是「這一季」，舊的是「上一季」）。請只根據這兩份整理比較，不要加沒寫到的數字或推測，用繁體中文、台灣用語，輸出 JSON：
{"tone":"更樂觀 或 差不多 或 更保守（整體展望和上一季比）",
 "head":"一句話說最大的變化（40 字內）",
 "changes":[{"k":"項目（例：營收展望、毛利率指引、資本支出、需求、風險）","now":"這一季怎麼說（40 字內）","before":"上一季怎麼說（40 字內）"}]}
changes 最多 5 項，只列真的有變化的；兩份都沒提到的項目不要列。`;
const slim = v => { const S = (x, n) => (typeof x === "string" ? x.slice(0, n) : ""), A = x => (Array.isArray(x) ? x.filter(y => typeof y === "string").slice(0, 6).map(y => y.slice(0, 160)) : []);
  return { head: S(v?.head, 120), outlook: A(v?.outlook), margin: S(v?.margin, 240), capex: S(v?.capex, 240), demand: S(v?.demand, 240), risks: A(v?.risks) }; };
export function parseConfCmp(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; let j; try { j = JSON.parse(m[0]); } catch { return null; }
  const tone = ["更樂觀", "差不多", "更保守"].find(t => String(j?.tone || "").includes(t)); if (!tone) return null;
  const s = (x, n) => (typeof x === "string" ? x.slice(0, n) : "");
  return { tone, head: s(j.head, 80), changes: (Array.isArray(j.changes) ? j.changes : []).filter(c => c && typeof c.k === "string").slice(0, 5).map(c => ({ k: s(c.k, 20), now: s(c.now, 120), before: s(c.before, 120) })) };
}
export async function compareConf(a, b, name, key, deadline = Date.now() + 40000) {
  const out = await geminiJSON([{ text: CMP_PROMPT(name) + "\n\n【這一季】\n" + JSON.stringify(slim(a)) + "\n\n【上一季】\n" + JSON.stringify(slim(b)) }], key, deadline, {}, "gemini-flash-lite-latest");
  const r = parseConfCmp(out.text); if (!r) throw new Error("AI 回傳格式不對，請再試一次"); return { ...r, model: out.model };
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
  if (body.op === "cmp") { // 兩季比較：同一組簡報比過就存起來
    const prev = String(body.prev || ""); if (!okFile(code, prev) || !body.a?.head || !body.b?.head) return res.status(400).json({ ok: false, error: "比較的資料不完整" });
    const ck2 = `confcmp:${file}:${prev}`;
    if (kvOn()) { try { const v = await kv("GET", ck2); if (v) return res.status(200).json({ ok: true, ...JSON.parse(v), cached: true }); } catch {} }
    const key = (process.env.GEMINI_API_KEY || "").trim(); if (!key) return res.status(200).json({ ok: false, error: "伺服器沒有設定 AI 金鑰（GEMINI_API_KEY）" });
    try { const v = { ...(await compareConf(body.a, body.b, name, key)), file, prev }; if (kvOn()) { try { await kv("SET", ck2, JSON.stringify(v), "EX", TTL); } catch {} } return res.status(200).json({ ok: true, ...v }); }
    catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
  }
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
  const r = await fetch(`https://mopsov.twse.com.tw/nas/STR/${file}`, { headers: UA, signal: AbortSignal.timeout(25000) }); // 大簡報（15MB 以上）15 秒可能下載不完
  if (!r.ok || !/pdf/i.test(r.headers.get("content-type") || "")) throw new Error(`簡報下載失敗（HTTP ${r.status}）`);
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_MB * 1048576) throw new Error(`簡報太大（${(buf.length / 1048576).toFixed(0)}MB）`);
  // 小檔直接夾帶；大檔（base64 後會超過 Gemini 單次請求 20MB）先上傳到 Gemini 檔案區，用完刪掉
  let up = null;
  try {
    if (buf.length > INLINE_MB * 1048576) { up = await uploadBuf(buf, "application/pdf", file, key, 30000); for (let t = 0; up.state !== "ACTIVE"; t++) { if (up.state === "FAILED" || t > 20) throw new Error("AI 處理簡報失敗"); await new Promise(x => setTimeout(x, 1500)); up.state = await fileState(up.file, key); } }
    const doc = up ? { fileData: { mimeType: "application/pdf", fileUri: up.uri } } : { inlineData: { mimeType: "application/pdf", data: buf.toString("base64") } };
    const out = await geminiJSON([doc, { text: PROMPT(name) }], key, deadline, {}, "gemini-flash-lite-latest"), s = parseConfSum(out.text); // 讀幾十頁簡報，lite 約 10～20 秒，一般型號實測可能超過 60 秒
    if (!s) throw new Error("AI 回傳格式不對，請再試一次");
    return { ...s, file, model: out.model };
  } finally { if (up?.file) fileDelete(up.file, key); }
}
