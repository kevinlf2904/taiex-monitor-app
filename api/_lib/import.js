// 庫存／交易明細截圖匯入：把券商 App「庫存／即時損益／持股分析」或「成交明細／對帳單」的截圖交給 AI 讀出每一列數字。
// POST /api/import  { images: ["data:image/jpeg;base64,...", ...], mode?: "holdings" | "trades" }（最多 4 張，頁面會先縮小）
// mode 省略或 "holdings"：回傳 { ok, mode: "holdings", rows: [{ name, code, shares, avgCost, price, chgPct, todayPnl, totalPnl, totalPnlPct, marketValue }] }
// mode === "trades"：回傳 { ok, mode: "trades", rows: [{ date, dateAssumed, time, side, name, code, shares, price, fee, tax, dayTrade, note }] }（相同日期／同價分批不自動合併去重）
// 截圖上沒有的欄位是 null；用 GEMINI_API_KEY（Gemini 會看圖）；沒有時用 ANTHROPIC_API_KEY（要另外設 AI_CLAUDE_ENABLED=1 總開關，預設關閉）。

import Anthropic from "@anthropic-ai/sdk";
import { aiLimit, WEB_TRIES, claudeFallbackOn, claudeUsable } from "./_limit.js";
import { userMsg } from "./_err.js";
import { geminiModels, GEMINI_ORDER } from "./_gemini.js";

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
const TRADES_PROMPT = `這是台股或美股券商 App 的「成交明細／成交回報／對帳單」截圖。請把畫面上「每一筆成交紀錄」讀出來，只輸出 JSON。
規則：
- 每一筆成交輸出一列；即使同一天、同一檔股票有多筆同價格分批成交，也要分別保留每一列，不要合併也不要去重。
- 欄位對應：
  · date：成交日期（照畫面抄，例如 YYYY-MM-DD、YYYY/MM/DD、民國年 115/05/12 或 MM/DD；畫面上真的沒寫日期填 null）
  · time：成交時間（例如 09:05:12 或 09:05；畫面上沒寫時間填 null）
  · side：買賣方向，買進填 "buy"，賣出填 "sell"（無法判斷填 null）
  · name：股票或 ETF 名稱
  · code：股票代號（台股 4～6 碼數字，可能帶一個英文字母如 00403A；美股英文代號如 NVDA、BRK-B；有 .TW／.TWO 後綴可去掉或保留；沒寫填 null）
  · shares：成交股數（若畫面寫「張」如 2張，請乘以 1000 變成股數 2000；寫股數就填股數）
  · price：成交單價
  · fee：手續費（畫面有明確寫 0 就填 0；沒有這一欄或空白填 null，不要自己估算）
  · tax：交易稅／證交稅（畫面有明確寫 0 就填 0；沒有這一欄或空白填 null，不要自己估算）
  · dayTrade：是否現股當沖（畫面有標「現沖／當沖／資沖／券沖」填 true，否則填 false）
  · note：委託單號、幣別或其他簡短附註（沒有填 null）
- 數字照畫面抄，去掉千分位逗號。
- 上方的合計、小計、欄位標題、成交股數為 0 的已撤銷／未成交委託不要當成成交紀錄。
- 被截掉一半、看不清楚的列略過。`;
const TRADES_SCHEMA = {
  type: "OBJECT",
  properties: { rows: { type: "ARRAY", items: { type: "OBJECT", properties: {
    date: { type: "STRING", nullable: true }, time: { type: "STRING", nullable: true }, side: { type: "STRING", nullable: true }, name: { type: "STRING", nullable: true }, code: { type: "STRING", nullable: true },
    shares: { type: "NUMBER", nullable: true }, price: { type: "NUMBER", nullable: true }, fee: { type: "NUMBER", nullable: true }, tax: { type: "NUMBER", nullable: true },
    dayTrade: { type: "BOOLEAN", nullable: true }, note: { type: "STRING", nullable: true },
  }, required: [] } } },
  required: ["rows"],
};

const FIELDS = ["shares", "avgCost", "price", "chgPct", "todayPnl", "totalPnl", "totalPnlPct", "marketValue"];
const numOrNull = v => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s%+]/g, "")); return Number.isFinite(n) ? n : null; };
const halfWidth = s => String(s ?? "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/／/g, "/").replace(/－/g, "-").replace(/：/g, ":").trim();
const cleanCode = raw => {
  const s = halfWidth(raw).toUpperCase().replace(/\s+/g, "").replace(/^(\d{4,6}[A-Z]?)\.(?:TW|TWO)$/, "$1");
  return /^(\d{4,6}[A-Z]?|[A-Z][A-Z0-9.-]{0,6})$/.test(s) ? s : null;
};
const taipeiToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const validCal = (y, m, d) => {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const fmtCal = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parseAmbigSlash = (a, b, y, raw) => {
  const ab = validCal(y, a, b), ba = validCal(y, b, a);
  if (!ab && !ba) return { date: "", dateAssumed: "invalid", rawDate: raw };
  if (ab && ba && a !== b) return { date: fmtCal(y, a, b), dateAssumed: "mdy", altDate: fmtCal(y, b, a), rawDate: raw };
  return { date: fmtCal(y, ab ? a : b, ab ? b : a), dateAssumed: null };
};

export function parseTradeDate(raw, today = taipeiToday()) {
  const refToday = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) && validCal(+today.slice(0, 4), +today.slice(5, 7), +today.slice(8, 10)) ? today : taipeiToday();
  const s = halfWidth(raw);
  if (!s) return { date: refToday, dateAssumed: "today" };
  let m = s.match(/^(?:西元\s*)?(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?(?:$|[\sT(（].*)/);
  if (m) return validCal(+m[1], +m[2], +m[3]) ? { date: fmtCal(+m[1], +m[2], +m[3]), dateAssumed: null } : { date: "", dateAssumed: "invalid", rawDate: s };
  m = s.match(/^(\d{4})(\d{2})(\d{2})(?:$|[\sT(（].*)/);
  if (m) return validCal(+m[1], +m[2], +m[3]) ? { date: fmtCal(+m[1], +m[2], +m[3]), dateAssumed: null } : { date: "", dateAssumed: "invalid", rawDate: s };
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:$|[\sT(（].*)/);
  if (m) return parseAmbigSlash(+m[1], +m[2], +m[3], s);
  m = s.match(/^(民國\s*)?(\d{2,3})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?(?:$|[\sT(（].*)/);
  if (m && (m[1] || s.includes("年") || +m[2] >= 79)) {
    const y = +m[2] + 1911;
    return validCal(y, +m[3], +m[4]) ? { date: fmtCal(y, +m[3], +m[4]), dateAssumed: null } : { date: "", dateAssumed: "invalid", rawDate: s };
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})(?:$|[\sT(（].*)/);
  if (m && +m[3] >= 20 && +m[3] <= 78) return parseAmbigSlash(+m[1], +m[2], 2000 + +m[3], s);
  m = s.match(/^(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?(?:$|\s+(?!\d+[\/\-.月]).*|[T(（].*)/);
  if (m) {
    const mo = +m[1], d = +m[2], yr = +refToday.slice(0, 4);
    if (validCal(yr, mo, d)) {
      const cand = fmtCal(yr, mo, d);
      if (cand <= refToday) return { date: cand, dateAssumed: "year" };
    }
    if (validCal(yr - 1, mo, d)) {
      const prev = fmtCal(yr - 1, mo, d);
      if (prev <= refToday) return { date: prev, dateAssumed: "year" };
    }
    return { date: "", dateAssumed: "invalid", rawDate: s };
  }
  return { date: "", dateAssumed: "invalid", rawDate: s };
}

const cleanTimeOne = raw => {
  const s = halfWidth(raw);
  if (!s) return null;
  const m = s.match(/(?:^|[\sT])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*(AM|PM))?(?:$|[\s)）])/i);
  if (!m) return null;
  let hh = +m[1];
  const mm = +m[2], ss = m[3] != null ? +m[3] : null, ap = m[4] ? m[4].toUpperCase() : null;
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    if (ap === "PM" && hh < 12) hh += 12;
    else if (ap === "AM" && hh === 12) hh = 0;
  } else if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59 || (ss != null && (ss < 0 || ss > 59))) return null;
  const p2 = n => String(n).padStart(2, "0");
  return ss != null ? `${p2(hh)}:${p2(mm)}:${p2(ss)}` : `${p2(hh)}:${p2(mm)}`;
};
const cleanTime = (rawTime, rawDate) => cleanTimeOne(rawTime) ?? (rawTime == null || String(rawTime).trim() === "" ? cleanTimeOne(rawDate) : null);

const cleanSide = raw => {
  const t = halfWidth(raw).toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  if (/^(buy|b|bot|bought|long)$/.test(t) || (t.includes("買") && !t.includes("賣")) || t === "定期定額") return "buy";
  if (/^(sell|s|sld|sold|short)$/.test(t) || (t.includes("賣") && !t.includes("買"))) return "sell";
  return null;
};
const cleanShares = v => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const s = halfWidth(v).replace(/,/g, "");
  const zm = s.match(/^([+-]?[\d.]+)\s*張$/);
  if (zm) { const n = parseFloat(zm[1]) * 1000; return Number.isFinite(n) && n > 0 ? n : null; }
  const n = numOrNull(s.replace(/股/g, ""));
  return n != null && n > 0 ? n : null;
};
const nonNegOrNull = v => { const n = numOrNull(v); return n != null && n >= 0 ? n : null; };

export function cleanRows(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).map(r => {
    const out = { name: String(r?.name ?? "").trim().slice(0, 30), code: cleanCode(r?.code) };
    FIELDS.forEach(k => (out[k] = numOrNull(r?.[k])));
    return out;
  }).filter(r => (r.name || r.code) && FIELDS.some(k => r[k] != null)).filter(r => { const k = r.code || r.name; if (seen.has(k)) return false; seen.add(k); return true; });
}
export function cleanTradeRows(rows, opts = {}) {
  return (Array.isArray(rows) ? rows : []).map(r => {
    const pd = parseTradeDate(r?.date, opts.today);
    const time = cleanTime(r?.time, r?.date);
    const side = cleanSide(r?.side ?? r?.type);
    const code = cleanCode(r?.code ?? r?.symbol);
    const name = String(r?.name ?? "").trim().slice(0, 30);
    const shares = cleanShares(r?.shares);
    const px = numOrNull(r?.price);
    const price = px != null && px > 0 ? px : null;
    const fee = nonNegOrNull(r?.fee);
    const tax = nonNegOrNull(r?.tax);
    const dayTrade = Boolean(r?.dayTrade === true || /^(true|1|yes|y|是)$/i.test(String(r?.dayTrade ?? "").trim()) || /沖/.test(String(r?.side ?? "")));
    const note = r?.note == null ? "" : String(r.note).trim().slice(0, 200);
    return {
      date: pd.date, dateAssumed: pd.dateAssumed,
      ...(pd.altDate ? { altDate: pd.altDate } : {}),
      ...(pd.rawDate ? { rawDate: pd.rawDate } : {}),
      time, side, name, code, shares, price, fee, tax, dayTrade, note,
    };
  }).filter(r => (r.name || r.code) && (r.shares != null || r.price != null));
}
export function parseImages(images) {
  return (Array.isArray(images) ? images : []).slice(0, 4).map(s => String(s).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)).filter(Boolean).map(m => ({ mime: m[1], data: m[2] }));
}
const extractJSON = t => { const m = String(t || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

const MODES = {
  holdings: {
    prompt: PROMPT, schema: SCHEMA, claudeSuffix: "\n只輸出 {\"rows\":[...]} 這個 JSON，不要其他文字。", clean: rows => cleanRows(rows),
    errEmptyInput: "請上傳庫存畫面的截圖（JPG／PNG）", errNoKey: "截圖匯入需要 AI 讀圖：伺服器尚未設定 GEMINI_API_KEY，請改用下方其他匯入方式。",
    err422: "沒有讀出持股表格，請確認截圖是庫存或即時損益的畫面。", errEmpty: "截圖裡沒有讀到持股，請換一張清楚一點的庫存畫面。",
  },
  trades: {
    prompt: TRADES_PROMPT, schema: TRADES_SCHEMA, claudeSuffix: "\n只輸出 {\"rows\":[...]} 這個 JSON，不要其他文字。", clean: (rows, opts) => cleanTradeRows(rows, opts),
    errEmptyInput: "請上傳成交明細／對帳單畫面的截圖（JPG／PNG）", errNoKey: "截圖匯入需要 AI 讀圖：伺服器尚未設定 GEMINI_API_KEY。也可以改用「手動表格輸入」。",
    err422: "沒有讀出成交明細表格，請確認截圖是委託回報、成交回報或對帳單畫面。", errEmpty: "截圖裡沒有讀到成交明細，請換一張清楚一點的成交回報或對帳單畫面。",
  },
};

async function viaGemini(imgs, key, deadline = Date.now() + 52000, spec = MODES.holdings) {
  const models = await geminiModels(key, GEMINI_ORDER.vision); // 讀截圖表格要準：Flash 為主（_gemini.js）
  const body = JSON.stringify({ contents: [{ role: "user", parts: [...imgs.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } })), { text: spec.prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: spec.schema } });
  let last = null, calls = 0;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      // 每一次呼叫都算錢、整個請求要在 60 秒內回完：最多 WEB_TRIES 次，剩不到 5 秒就不再試
      const left = deadline - Date.now(); if (calls++ >= WEB_TRIES || left < 5000) return { ok: false, status: last?.status || 504, message: last?.message || "逾時" };
      let r, j;
      try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(Math.min(40000, left - 1000)) }); j = await r.json().catch(() => ({})); }
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
async function viaClaude(imgs, timeout = 55000, spec = MODES.holdings) {
  const client = new Anthropic({ timeout, maxRetries: 0 }); // 要在 Vercel 的 60 秒內回完
  const msg = await client.messages.create({ model: "claude-opus-5-5", max_tokens: 8000,
    messages: [{ role: "user", content: [...imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })), { type: "text", text: spec.prompt + spec.claudeSuffix }] }] });
  const parsed = extractJSON(msg.content.filter(b => b.type === "text").map(b => b.text).join(""));
  return parsed ? { ok: true, rows: parsed.rows, model: msg.model } : { ok: false, status: 422, message: "讀不出表格" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "只接受 POST" });
  const rawMode = req.body?.mode;
  const mode = rawMode == null || rawMode === "" ? "holdings" : rawMode;
  if (mode !== "holdings" && mode !== "trades") return res.status(400).json({ ok: false, error: "不支援的匯入模式" });
  const spec = MODES[mode];
  const imgs = parseImages(req.body?.images);
  if (!imgs.length) return res.status(400).json({ ok: false, error: spec.errEmptyInput });
  const gk = (process.env.GEMINI_API_KEY || "").trim(), ck = claudeUsable() ? process.env.ANTHROPIC_API_KEY : "";
  if (!gk && !ck) return res.status(200).json({ ok: false, error: spec.errNoKey });
  const t0 = Date.now();
  try {
    let r = gk ? await viaGemini(imgs, gk, t0 + 52000, spec) : null;
    // 沒有 Gemini 金鑰才直接用 Claude；Gemini 失敗改問 Claude 要開 AI_CLAUDE_FALLBACK、時間還夠、而且沒超過備援的全站上限
    if (!r && ck) r = await viaClaude(imgs, 55000, spec);
    else if (r && !r.ok && ck && claudeFallbackOn() && Date.now() - t0 < 25000 && !(await aiLimit(req, "claude-fb"))) r = await viaClaude(imgs, 55000 - (Date.now() - t0), spec);
    if (!r.ok) return res.status(200).json({ ok: false, error: r.status === 503 || r.status === 500 ? "AI 讀圖服務目前太忙，請過一兩分鐘再試。" : r.status === 429 ? "AI 讀圖的免費額度暫時用完，請稍後再試。" : r.status === 422 ? spec.err422 : `AI 讀圖失敗（${r.status}）` });
    const rows = spec.clean(r.rows);
    if (!rows.length) return res.status(200).json({ ok: false, error: spec.errEmpty });
    return res.status(200).json({ ok: true, mode, rows, model: r.model });
  } catch (e) { return res.status(200).json({ ok: false, error: userMsg(e, "讀圖失敗，請稍後再試", "import") }); }
}
