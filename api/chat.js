// 「問問題」對話框：給 learner/ 右下角的對話框使用（部署在網站上時；在 Claude 裡開啟則改用頁面的 sample 能力）。
// 需要在 Vercel 專案設定環境變數 ANTHROPIC_API_KEY。
// 系統提示固定在伺服器端；前端只送對話內容與「目前畫面」的摘要，長度都有上限。

import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 60 };

const SYSTEM = `你是「K線學堂」裡的技術分析助教，對象是想學台股技術分析的初學者。請用繁體中文、口語但精確地回答。
- 優先回答使用者的問題；用得到時，引用「目前畫面」提供的數據（課程、指標讀數、截圖或個股的判讀結果），並說明你看的是哪個數字。
- 解釋觀念時舉具體例子；可以建議使用者到學堂的哪一課或哪個功能去練習（課程、圖表實驗室、判讀挑戰、個股判讀、觀念測驗）。
- 回答控制在 300 字以內，必要時用條列；不要用表格。
- 不提供個股買賣建議、目標價或明牌，也不保證任何結果；被問到時說明技術分析的限制，並把問題轉成「該怎麼判讀」。
- 不知道或畫面上沒有的資訊就直說，不要捏造數字。`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "只接受 POST" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ ok: false, error: "伺服器尚未設定 ANTHROPIC_API_KEY，無法使用對話功能。" });

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: "沒有訊息" });
  const turns = messages.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 4000) })).filter((m) => m.content);
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return res.status(400).json({ ok: false, error: "最後一則必須是使用者的問題" });
  const ctx = typeof context === "string" && context ? `\n\n目前畫面（由頁面自動產生，可能有誤）：\n${context.slice(0, 6000)}` : "";

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
    return res.status(200).json({ ok: true, text, truncated: msg.stop_reason === "max_tokens" });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(200).json({ ok: false, error: "ANTHROPIC_API_KEY 無效，請檢查伺服器設定。" });
    if (err instanceof Anthropic.RateLimitError) return res.status(200).json({ ok: false, error: "使用太頻繁，請稍後再試。" });
    if (err instanceof Anthropic.APIError) return res.status(200).json({ ok: false, error: `Claude 服務暫時無法使用（${err.status ?? "連線錯誤"}）` });
    return res.status(200).json({ ok: false, error: "回答失敗，請稍後再試。" });
  }
}
