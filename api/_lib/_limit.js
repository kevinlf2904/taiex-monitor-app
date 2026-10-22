// 呼叫次數限制：會花錢的 AI 服務（對話、讀圖、匯入、節目摘要、法說會重點）每個 IP 每小時、全站每天各有上限，避免被人用程式一直打、燒掉 API 費用。
// 有 Upstash Redis（KV_REST_API_URL）時存在 KV，所有 serverless 執行個體共用；沒有時用記憶體（只擋得住同一個執行個體，聊勝於無）。
// 上限可用環境變數調整：AI_HOURLY_PER_IP（每 IP 每小時，預設依服務）、AI_DAILY_CAP（全站每天每個服務，預設依服務）。
import { createHash } from "node:crypto";
import { kv, kvOn } from "./sync.js";

// [每 IP 每小時, 全站每天]
export const AI_LIMITS = { chat: [40, 1500], "chart-read": [10, 300], import: [10, 300], podcast: [6, 150], confai: [10, 200] };
const mem = new Map();
const ipOf = req => String(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "").split(",")[0].trim() || "?";
// 回傳 null＝可以通過；字串＝要擋下來的原因
export async function aiLimit(req, name, now = Date.now(), store = null) {
  const L = AI_LIMITS[name]; if (!L) return null;
  const perIp = +process.env.AI_HOURLY_PER_IP || L[0], perDay = +process.env.AI_DAILY_CAP || L[1];
  const ip = createHash("sha256").update(ipOf(req)).digest("hex").slice(0, 16), hr = Math.floor(now / 3600e3), day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  const kIp = `rl:${name}:${ip}:${hr}`, kDay = `rl:${name}:day:${day}`;
  const incr = store || (kvOn() ? async (k, ttl) => { const n = await kv("INCR", k); if (n === 1) await kv("EXPIRE", k, ttl); return n; }
    : async k => { const n = (mem.get(k) || 0) + 1; mem.set(k, n); if (mem.size > 5000) mem.clear(); return n; });
  try {
    const [a, b] = await Promise.all([incr(kIp, 3600), incr(kDay, 2 * 86400)]);
    if (a > perIp) return `使用太頻繁了（每小時最多 ${perIp} 次），請稍後再試`;
    if (b > perDay) return "今天的 AI 使用量已達上限，明天再試";
  } catch { return null; } // 計數器壞掉時不要讓整個功能不能用
  return null;
}
