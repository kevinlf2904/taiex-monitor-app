// 庫存截圖匯入：把券商 App「庫存／即時損益／持股分析」的截圖交給 AI 讀出每一檔的數字。
// POST /api/import  { images: ["data:image/jpeg;base64,...", ...] }（最多 4 張，頁面會先縮小）
// 回傳 { ok, rows: [{ name, code, shares, avgCost, price, chgPct, todayPnl, totalPnl, totalPnlPct, marketValue }] }
// 截圖上沒有的欄位是 null；股數與成本若沒寫，由頁面用「總損益與報酬率」或「市值與股價」推算，再讓使用者確認。
// 用 GEMINI_API_KEY（Gemini 會看圖）；沒有時用 ANTHROPIC_API_KEY。

import Anthropic from "@anthropic-ai/sdk";

const PROMPT = `這是台股或美股券商 App 的庫存（持股）畫面截圖。請把畫面上「每一檔持股」的數字讀出來，只輸出 JSON。
規則：
- 每一列是一檔股票或 ETF，可能是「名稱＋代號」兩行。代號是 4～6 碼數字（可能帶一個英文字母，例如 00403A），美股是英文代號。
- 數字照畫面抄，去掉千分位逗號與 % 符號；負數保留負號（綠色或有「-」的是負的）。
- 欄位對應：股價／成交價 → price；漲跌幅 → chgPct；今日損益 → todayPnl；總損益／累積損益／未實現損益 → totalPnl；總損益下方的百分比／報酬率 → totalPnlPct；市值 → marketValue；股數／庫存股數 → shares（若寫「張」要乘以 1000）；成本均價／平均成本 → avgCost。
- 畫面上沒有的欄位填 null，不要自己推算或猜。
- 上方的總計（今日損益合計、股票市值合計、圓餅圖）不要當成個股。
- 被截掉一半、看不清楚的列略過。`;
const SCHEMA = {
  type: "OBJECT",
  properties: { rows: { type: "ARRAY", items: { type: "OBJECT", properties: {
    name: { type: "STRING" }, code: { type: "STRING", nullable: true }, shares: { type: "NUMBER", nullable: true }, avgCost: { type: "NUMBER", nullable: true },
    price: { type: "NUMBER", nullable: true }, chgPct: { type: "NUMBER", nullable: true }, todayPnl: { type: "NUMBER", nullable: true },
    totalPnl: { type: "NUMBER", nullable: true }, totalPnlPct: { type: "NUMBER", nullable: true }, marketValue: { type: "NUMBER", nullable: true },
  }, required: ["name"] } } },
  required: ["rows"],
};
const FIELDS = ["shares", "avgCost", "price", "chgPct", "todayPnl", "totalPnl", "totalPnlPct", "marketValue"];
const numOrNull = v => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s%+]/g, "")); return Number.isFinite(n) ? n : null; };
export function cleanRows(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).map(r => {
    const code = String(r?.code ?? "").trim().toUpperCase().replace(/\s/g, "");
    const out = { name: String(r?.name ?? "").trim().slice(0, 30), code: /^(\d{4,6}[A-Z]?|[A-Z][A-Z0-9.-]{0,6})$/.test(code) ? code : null };
    FIELDS.forEach(k => (out[k] = numOrNull(r?.[k])));
    return out;
  }).filter(r => (r.name || r.code) && FIELDS.some(k => r[k] != null)).filter(r => { const k = r.code || r.name; if (seen.has(k)) return false; seen.add(k); return true; });
}
export function parseImages(images) {
  return (Array.isArray(images) ? images : []).slice(0, 4).map(s => String(s).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)).filter(Boolean).map(m => ({ mime: m[1], data: m[2] }));
}
const extractJSON = t => { const m = String(t || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

async function viaGemini(imgs, key) {
  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-2.5-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"])];
  const body = JSON.stringify({ contents: [{ role: "user", parts: [...imgs.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } })), { text: PROMPT }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: SCHEMA } });
  let last = null;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r, j;
      try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(40000) }); j = await r.json().catch(() => ({})); }
      catch (e) { last = { status: 504, message: e.message }; break; }
      if (r.status === 404) { last = { status: 404 }; break; }
      if ([429, 500, 502, 503, 504].includes(r.status)) { last = { status: r.status, message: j?.error?.message }; if (attempt === 0 && r.status !== 429) { await new Promise(res => setTimeout(res, 1200)); continue; } break; }
      if (!r.ok) return { ok: false, status: r.status, message: j?.error?.message || "" };
      const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      const parsed = extractJSON(text); if (!parsed) return { ok: false, status: 422, message: "讀不出表格" };
      return { ok: true, rows: parsed.rows, model: m };
    }
  }
  return { ok: false, status: last?.status || 503, message: last?.message || "" };
}
async function viaClaude(imgs) {
  const client = new Anthropic();
  const msg = await client.messages.create({ model: "claude-opus-5-5", max_tokens: 8000,
    messages: [{ role: "user", content: [...imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })), { type: "text", text: PROMPT + "\n只輸出 {\"rows\":[...]} 這個 JSON，不要其他文字。" }] }] });
  const parsed = extractJSON(msg.content.filter(b => b.type === "text").map(b => b.text).join(""));
  return parsed ? { ok: true, rows: parsed.rows, model: msg.model } : { ok: false, status: 422, message: "讀不出表格" };
}

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "只接受 POST" });
  const imgs = parseImages(req.body?.images);
  if (!imgs.length) return res.status(400).json({ ok: false, error: "請上傳庫存畫面的截圖（JPG／PNG）" });
  const gk = process.env.GEMINI_API_KEY, ck = process.env.ANTHROPIC_API_KEY;
  if (!gk && !ck) return res.status(200).json({ ok: false, error: "截圖匯入需要 AI 讀圖：請在 Vercel 設定 GEMINI_API_KEY（或 ANTHROPIC_API_KEY）。也可以改用「文字匯入」。" });
  try {
    let r = gk ? await viaGemini(imgs, gk) : null;
    if ((!r || !r.ok) && ck) r = await viaClaude(imgs);
    if (!r.ok) return res.status(200).json({ ok: false, error: r.status === 503 || r.status === 500 ? "AI 讀圖服務目前太忙，請過一兩分鐘再試。" : r.status === 429 ? "AI 讀圖的免費額度暫時用完，請稍後再試。" : r.status === 422 ? "沒有讀出持股表格，請確認截圖是庫存或即時損益的畫面。" : `AI 讀圖失敗（${r.status}）` });
    const rows = cleanRows(r.rows);
    if (!rows.length) return res.status(200).json({ ok: false, error: "截圖裡沒有讀到持股，請換一張清楚一點的庫存畫面。" });
    return res.status(200).json({ ok: true, rows, model: r.model });
  } catch (e) { return res.status(200).json({ ok: false, error: `讀圖失敗（${e.message}）` }); }
}
