// 「問問題」對話框：給 learner/ 右下角的對話框使用（部署在網站上時；在 Claude 裡開啟則改用頁面的 sample 能力）。
// 在 Vercel 專案設定其中一個環境變數：
//   GEMINI_API_KEY    → 用 Google Gemini 回答（有免費額度，到 Google AI Studio 申請）；兩個都設時優先用它
//   ANTHROPIC_API_KEY → 用 Claude 回答（依用量付費）
//   GEMINI_MODEL      → 選填，指定 Gemini 模型（預設 gemini-flash-latest，找不到時改用 gemini-2.5-flash）
// 系統提示固定在伺服器端；前端只送對話內容與「目前畫面」的摘要，長度都有上限。

import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 60 };

const SYSTEM = `你是「K線學堂」裡的技術分析助教，對象是想學台股技術分析的初學者。請用繁體中文、口語但精確地回答。
- 優先回答使用者的問題；用得到時，引用「目前畫面」提供的數據（課程、指標讀數、截圖或個股的判讀結果），並說明你看的是哪個數字。
- 解釋觀念時舉具體例子；可以建議使用者到學堂的哪一課或哪個功能去練習（課程、圖表實驗室、判讀挑戰、個股判讀、觀念測驗）。
- 回答控制在 300 字以內，必要時用條列；不要用表格。
- 不提供個股買賣建議、目標價或明牌，也不保證任何結果；被問到時說明技術分析的限制，並把問題轉成「該怎麼判讀」。
- 不知道或畫面上沒有的資訊就直說，不要捏造數字。`;

const GEMINI_DEFAULT = "gemini-flash-latest";
// Gemini REST API：角色是 user / model，系統提示放在 systemInstruction
// 503（模型過載）、500、429（太忙）時：同一個模型等一下重試一次，再換下一個備用模型
export const GEMINI_FALLBACKS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-lite-latest"];
const retryable = s => s === 503 || s === 500 || s === 502 || s === 504 || s === 429;
export async function askGemini(system, turns, key, model = process.env.GEMINI_MODEL, { wait = ms => new Promise(r => setTimeout(r, ms)), deadline = Date.now() + 50000 } = {}) {
  const models = [...new Set([model || GEMINI_DEFAULT, GEMINI_DEFAULT, ...GEMINI_FALLBACKS])];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: 4096, temperature: 0.6 },
  });
  let last = null;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now(); if (left < 3000) return { ok: false, status: last?.status || 504, message: last?.message || "逾時" };
      let r, j;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(Math.min(30000, left)),
        });
        j = await r.json().catch(() => ({}));
      } catch (e) { last = { status: 504, message: e.message }; break; } // 逾時或連線錯誤：直接換下一個模型
      if (r.status === 404) { last = { status: 404, message: j?.error?.message || "" }; break; } // 模型名稱不存在（舊模型下架），換下一個
      if (retryable(r.status)) { last = { status: r.status, message: j?.error?.message || "" }; if (attempt === 0 && r.status !== 429) await wait(1200); else break; continue; }
      if (!r.ok) return { ok: false, status: r.status, message: j?.error?.message || "" };
      const c = j.candidates?.[0];
      if (!c) return { ok: false, blocked: true, message: j.promptFeedback?.blockReason || "" };
      const text = (c.content?.parts || []).map((p) => p.text || "").join("").trim();
      if (!text) return { ok: false, blocked: c.finishReason === "SAFETY" || c.finishReason === "PROHIBITED_CONTENT", message: c.finishReason || "" };
      return { ok: true, text, truncated: c.finishReason === "MAX_TOKENS", model: m };
    }
  }
  return { ok: false, status: last?.status || 404, message: last?.message || "找不到可用的 Gemini 模型" };
}
function geminiError(r) {
  if (r.blocked) return "這個問題無法回答，換個方式問問看。";
  if (r.status === 429) return "Gemini 免費額度暫時用完或問得太頻繁，請等一下再試（免費方案有每分鐘、每天的次數上限）。";
  if (r.status === 400 && /api key/i.test(r.message)) return "GEMINI_API_KEY 無效，請檢查 Vercel 的環境變數。";
  if (r.status === 403) return "GEMINI_API_KEY 沒有權限，請確認金鑰是在 Google AI Studio 建立的。";
  if (r.status === 404) return "找不到可用的 Gemini 模型，請在 Vercel 設定 GEMINI_MODEL（例如 gemini-2.5-flash）。";
  if (r.status === 503 || r.status === 500 || r.status === 502) return `Gemini 目前太忙（${r.status}，Google 那邊的模型暫時過載），已經自動重試並換過備用模型都不行，請過一兩分鐘再問一次。`;
  if (r.status === 504) return "Gemini 回應逾時，請再試一次。";
  return `Gemini 服務暫時無法使用（${r.status ?? "連線錯誤"}）`;
}

export default async function handler(req, res) {
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  // GET：只回報目前接的是哪個 AI（不呼叫模型、不花額度），給對話框顯示用
  if (req.method === "GET") {
    const provider = geminiKey ? "gemini" : process.env.ANTHROPIC_API_KEY ? "claude" : null;
    return res.status(200).json({ ok: true, provider, model: provider === "gemini" ? process.env.GEMINI_MODEL || GEMINI_DEFAULT : provider === "claude" ? "claude-opus-5-5" : null });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "只接受 GET 或 POST" });
  if (!geminiKey && !process.env.ANTHROPIC_API_KEY) return res.status(200).json({ ok: false, error: "伺服器尚未設定 GEMINI_API_KEY（或 ANTHROPIC_API_KEY），無法使用對話功能。" });

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: "沒有訊息" });
  const turns = messages.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 4000) })).filter((m) => m.content);
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return res.status(400).json({ ok: false, error: "最後一則必須是使用者的問題" });
  const ctx = typeof context === "string" && context ? `\n\n目前畫面（由頁面自動產生，可能有誤）：\n${context.slice(0, 6000)}` : "";

  if (geminiKey) {
    try {
      const r = await askGemini(SYSTEM + ctx, turns, geminiKey);
      if (!r.ok && !r.blocked && retryable(r.status) && process.env.ANTHROPIC_API_KEY) return askClaude(); // 有設 Claude 金鑰時，Gemini 忙線就改問 Claude
      return res.status(200).json(r.ok ? { ok: true, text: r.text, truncated: r.truncated, provider: "gemini", model: r.model } : { ok: false, error: geminiError(r), provider: "gemini" });
    } catch { return res.status(200).json({ ok: false, error: "連不到 Gemini 服務，請稍後再試。" }); }
  }

  return askClaude();
  async function askClaude() {
  const client = new Anthropic();
  try {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM + ctx,
      messages: turns,
    });
    if (msg.stop_reason === "refusal") return res.status(200).json({ ok: false, error: "這個問題無法回答，換個方式問問看。" });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) return res.status(200).json({ ok: false, error: "沒有收到回答，請再試一次。" });
    return res.status(200).json({ ok: true, text, truncated: msg.stop_reason === "max_tokens", provider: "claude", model: msg.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(200).json({ ok: false, error: "ANTHROPIC_API_KEY 無效，請檢查伺服器設定。" });
    if (err instanceof Anthropic.RateLimitError) return res.status(200).json({ ok: false, error: "使用太頻繁，請稍後再試。" });
    if (err instanceof Anthropic.APIError) return res.status(200).json({ ok: false, error: `Claude 服務暫時無法使用（${err.status ?? "連線錯誤"}）` });
    return res.status(200).json({ ok: false, error: "回答失敗，請稍後再試。" });
  }
}
}
