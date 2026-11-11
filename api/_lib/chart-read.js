// 截圖判讀：把 K 線截圖交給 AI 看圖解說（給 learner/ 的「請 AI 解讀」「讓 AI 讀出數字」按鈕使用）。
// 用 GEMINI_API_KEY（Gemini 會看圖，Flash 為主）；沒有 Gemini 金鑰時才用 ANTHROPIC_API_KEY（要另外設 AI_CLAUDE_ENABLED=1 總開關，預設關閉）。
// Gemini 失敗改問 Claude 要再開 AI_CLAUDE_FALLBACK=1，而且算全站每天的備援上限（claude-fb），和截圖匯入一樣。
// 提示詞固定寫在伺服器端，前端只能送圖片與程式辨識的摘要，避免這個端點被拿去問任意問題。

import Anthropic from "@anthropic-ai/sdk";
import { aiLimit, WEB_TRIES, claudeFallbackOn, claudeUsable } from "./_limit.js";
import { geminiModels, GEMINI_ORDER } from "./_gemini.js";

const PROMPT = `你是一位耐心的台股技術分析老師。使用者上傳了一張看盤軟體的 K 線截圖，想學習怎麼讀圖。請用繁體中文、以教學口吻解說。

請依序使用以下標題（每個標題獨立一行，以「## 」開頭），每段 2–5 句或條列：
## 這張圖是什麼
（商品、週期、時間範圍、圖上有哪些指標；看不出來就說看不出來）
## 趨勢
## K 線與型態
## 指標
（只談圖上真的有顯示的指標，說明數值或位置代表什麼）
## 支撐與壓力
（看得到價格刻度時，給出大約價位）
## 學習重點
（從這張圖可以練習的 2–3 個觀念）
## 提醒

規則：只描述圖上看得到的東西，不要捏造數字；不要給買進或賣出建議，也不要預測價格；在「提醒」說明技術分析的限制。`;

// 「讓 AI 讀出數字」：只讀圖上印出的數字，回傳 JSON（前端解析後填進欄位）
const NUMS_PROMPT = `這是一張看盤軟體的 K 線截圖。請只讀出圖上「印出來的數字」，看不到或不確定就填 null，絕對不要估計或用刻度推算。
只回傳一個 JSON 物件，不要任何其他文字：
{"name": 商品名稱（含代號）,
 "date": 上方資料列的日期，格式 YYYY-MM-DD；看不到年份就填 "MM-DD",
 "rowFromRight": 資料列對應的是從右邊數來第幾根 K 棒（最後一根 = 1）。圖上有十字游標或選取線時數到游標那根；資料列日期在 X 軸日期標籤可以對照時用它推算；看不出來就填 null,
 "open": 資料列的開盤價, "high": 資料列的最高價, "low": 資料列的最低價, "close": 資料列的收盤價,
 "chartHigh": 價格區內標示最高價的數字標籤（通常在最高那根 K 棒旁邊）, "chartLow": 價格區內標示最低價的數字標籤,
 "indicators": [{"label": 名稱（例如 "MA5"、"布林上"、"SAR"、"K"、"DIF"、"成交量"）, "value": 數字}]（圖例上印出的數值，最多 12 個）}`;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Gemini 看圖：numbers 要 JSON（前端自己解析），解說要純文字。每一次呼叫都算額度，最多 WEB_TRIES 次、整個請求要在 60 秒內回完
async function viaGemini({ image, mediaType, text, numbers }, key, deadline) {
  const models = await geminiModels(key, GEMINI_ORDER.vision);
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text }] }],
    generationConfig: { temperature: numbers ? 0 : 0.4, maxOutputTokens: numbers ? 4096 : 8192, ...(numbers ? { responseMimeType: "application/json" } : {}) } });
  let last = null, calls = 0;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now(); if (calls++ >= WEB_TRIES || left < 5000) return { ok: false, status: last?.status || 504 };
      let r, j;
      try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(Math.min(45000, left - 1000)) }); j = await r.json().catch(() => ({})); }
      catch { last = { status: 504 }; break; }
      if (r.status === 404) { last = { status: 404 }; break; }
      if ([429, 500, 502, 503, 504].includes(r.status)) { last = { status: r.status }; if (attempt === 0 && r.status !== 429) { await new Promise(res => setTimeout(res, 1200)); continue; } break; }
      if (!r.ok) return { ok: false, status: r.status };
      const c = j.candidates?.[0], out = (c?.content?.parts || []).map(p => p.text || "").join("").trim();
      if (!out) return { ok: false, status: c?.finishReason === "SAFETY" || j.promptFeedback?.blockReason ? 451 : 422 };
      return { ok: true, text: out, truncated: c?.finishReason === "MAX_TOKENS", model: m };
    }
  }
  return { ok: false, status: last?.status || 503 };
}

async function viaClaude({ image, mediaType, text, numbers }, timeout = 55000) {
  const client = new Anthropic({ timeout, maxRetries: 0 }); // 要在 Vercel 的 60 秒內回完
  const msg = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: numbers ? 4000 : 16000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: image } }, { type: "text", text }] }],
  });
  if (msg.stop_reason === "refusal") return { ok: false, status: 451 };
  const out = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return out ? { ok: true, text: out, truncated: msg.stop_reason === "max_tokens", model: msg.model } : { ok: false, status: 422 };
}

const FAIL = s => s === 451 ? "AI 無法解讀這張圖片。" : s === 422 ? "AI 沒有回傳內容，請再試一次。" : s === 429 ? "AI 看圖的免費額度暫時用完，請稍後再試。" : s === 400 ? "圖片無法處理，請換一張 PNG 或 JPG。" : s === 500 || s === 503 ? "AI 看圖服務目前太忙，請過一兩分鐘再試。" : `AI 解讀失敗（${s}）`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "只接受 POST" });
  const gk = (process.env.GEMINI_API_KEY || "").trim(), ck = claudeUsable();
  if (!gk && !ck) return res.status(200).json({ ok: false, error: "伺服器尚未設定 GEMINI_API_KEY，無法使用 AI 解讀。" });

  const { image, mediaType, context, task } = req.body || {};
  const numbers = task === "numbers";
  if (typeof image !== "string" || !image || image.length > 5_500_000) return res.status(400).json({ ok: false, error: "圖片缺少或太大" });
  if (!MEDIA_TYPES.includes(mediaType)) return res.status(400).json({ ok: false, error: "不支援的圖片格式" });
  const ctx = numbers ? "" : typeof context === "string" && context ? `\n\n參考資料：程式在瀏覽器中自動辨識的結果如下，可能有誤，請以圖片為準。\n${context.slice(0, 3000)}` : "";
  const job = { image, mediaType, numbers, text: (numbers ? NUMS_PROMPT : PROMPT) + ctx };

  const t0 = Date.now();
  try {
    let r = gk ? await viaGemini(job, gk, t0 + 52000) : null;
    // 沒有 Gemini 金鑰才直接用 Claude；Gemini 失敗改問 Claude 要開 AI_CLAUDE_FALLBACK、時間還夠、而且沒超過備援的全站上限
    if (!r) r = await viaClaude(job);
    else if (!r.ok && ck && claudeFallbackOn() && Date.now() - t0 < 25000 && !(await aiLimit(req, "claude-fb"))) r = await viaClaude(job, 55000 - (Date.now() - t0));
    if (!r.ok) return res.status(200).json({ ok: false, error: FAIL(r.status) });
    return res.status(200).json({ ok: true, text: r.text, truncated: r.truncated, model: r.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(200).json({ ok: false, error: "AI 金鑰無效，請檢查伺服器設定。" });
    if (err instanceof Anthropic.RateLimitError) return res.status(200).json({ ok: false, error: "使用太頻繁，請稍後再試。" });
    if (err instanceof Anthropic.BadRequestError) return res.status(200).json({ ok: false, error: "圖片無法處理，請換一張 PNG 或 JPG。" });
    if (err instanceof Anthropic.APIError) return res.status(200).json({ ok: false, error: `AI 服務暫時無法使用（${err.status ?? "連線錯誤"}）` });
    return res.status(200).json({ ok: false, error: "解讀失敗，請稍後再試。" });
  }
}
