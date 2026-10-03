// 截圖判讀：把 K 線截圖交給 Claude 看圖解說（給 learner/ 的「請 Claude 解讀」按鈕使用）。
// 需要在 Vercel 專案設定環境變數 ANTHROPIC_API_KEY。
// 提示詞固定寫在伺服器端，前端只能送圖片與程式辨識的摘要，避免這個端點被拿去問任意問題。

import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: "4mb" } } };

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

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "只接受 POST" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ ok: false, error: "伺服器尚未設定 ANTHROPIC_API_KEY，無法使用 Claude 解讀。" });

  const { image, mediaType, context } = req.body || {};
  if (typeof image !== "string" || !image || image.length > 5_500_000) return res.status(400).json({ ok: false, error: "圖片缺少或太大" });
  if (!MEDIA_TYPES.includes(mediaType)) return res.status(400).json({ ok: false, error: "不支援的圖片格式" });
  const ctx = typeof context === "string" && context ? `\n\n參考資料：程式在瀏覽器中自動辨識的結果如下，可能有誤，請以圖片為準。\n${context.slice(0, 3000)}` : "";

  const client = new Anthropic();
  try {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT + ctx },
        ],
      }],
    });
    if (msg.stop_reason === "refusal") return res.status(200).json({ ok: false, error: "Claude 無法解讀這張圖片。" });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) return res.status(200).json({ ok: false, error: "Claude 沒有回傳內容，請再試一次。" });
    return res.status(200).json({ ok: true, text, truncated: msg.stop_reason === "max_tokens" });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(200).json({ ok: false, error: "ANTHROPIC_API_KEY 無效，請檢查伺服器設定。" });
    if (err instanceof Anthropic.RateLimitError) return res.status(200).json({ ok: false, error: "使用太頻繁，請稍後再試。" });
    if (err instanceof Anthropic.BadRequestError) return res.status(200).json({ ok: false, error: "圖片無法處理，請換一張 PNG 或 JPG。" });
    if (err instanceof Anthropic.APIError) return res.status(200).json({ ok: false, error: `Claude 服務暫時無法使用（${err.status ?? "連線錯誤"}）` });
    return res.status(200).json({ ok: false, error: "解讀失敗，請稍後再試。" });
  }
}
