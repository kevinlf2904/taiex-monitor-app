// 呼叫次數限制：會花錢的 AI 服務（對話、讀圖、匯入、節目摘要、法說會重點）每個 IP 每小時、全站每天各有上限，避免被人用程式一直打、燒掉 API 費用。
// 有 Upstash Redis（KV_REST_API_URL）時存在 KV，所有 serverless 執行個體共用。
// 沒有 KV（或 KV 暫時壞掉）時改用記憶體計數：每個執行個體各算各的、冷啟動就歸零，全站上限擋不住，所以改用保守的上限（每 IP 一半、每天十分之一），不會直接放行。
// 上限可用環境變數調整，每個服務分開設：AI_HOURLY_PER_IP_CHAT、AI_DAILY_CAP_CHART_READ…（服務名稱大寫、- 換成 _）；
// 舊的 AI_HOURLY_PER_IP、AI_DAILY_CAP 只能「調低」所有服務，不會把某個服務放寬到超過它自己的預設。
import { createHash } from "node:crypto";
import { kv, kvOn } from "./sync.js";

// [每 IP 每小時, 全站每天]；claude-fb＝Gemini 失敗改問 Claude（AI_CLAUDE_FALLBACK=1 才會用到）另外算一份全站上限
export const AI_LIMITS = { chat: [40, 1500], "chart-read": [10, 300], import: [10, 300], podcast: [6, 150], confai: [10, 200], "claude-fb": [5, 60] };
// 網站上一次請求最多打幾次 Gemini（模型忙線時換備用模型重試）：每一次都算錢，所以有上限；排程不受這個限制
export const WEB_TRIES = 3;
// Gemini 失敗時要不要改問 Claude（付費、比較貴）：預設不要，設 AI_CLAUDE_FALLBACK=1 才開，而且另外有全站每天上限（claude-fb）
export const claudeFallbackOn = () => process.env.AI_CLAUDE_FALLBACK === "1";

export const mem = new Map();
export const MAX_MEM = 5000;

// 優先採用邊緣反向代理（如 Vercel Edge）提供的 x-real-ip，防止攻擊者藉由偽造 x-forwarded-for 標頭繞過限流
export const ipOf = req => {
  const h = req?.headers || {};
  const realIp = String(h["x-real-ip"] || "").trim();
  if (realIp && realIp !== "?") return realIp;
  const fwd = String(h["x-forwarded-for"] || "").trim();
  if (fwd) {
    const parts = fwd.split(",").map(s => s.trim()).filter(Boolean);
    return parts[0] || "?";
  }
  return req?.socket?.remoteAddress || "?";
};

const envN = k => { const n = +process.env[k]; return Number.isFinite(n) && n > 0 ? n : null; };
// 這個服務實際的上限；shared＝計數是全站共用（KV）還是只在這個執行個體（記憶體）
export function limitsOf(name, shared = true) {
  const L = AI_LIMITS[name]; if (!L) return null;
  const tag = name.toUpperCase().replace(/-/g, "_"), cap = (own, all, def) => own ?? (all != null ? Math.min(all, def) : def);
  const perIp = cap(envN(`AI_HOURLY_PER_IP_${tag}`), envN("AI_HOURLY_PER_IP"), L[0]), perDay = cap(envN(`AI_DAILY_CAP_${tag}`), envN("AI_DAILY_CAP"), L[1]);
  return shared ? [perIp, perDay] : [Math.max(1, Math.ceil(perIp / 2)), Math.max(3, Math.ceil(perDay / 10))];
}

// 記憶體計數器：具備過期時間 (TTL) 與容量飽和防護。
// 容量滿載時優先清除過期項；若無過期項則安全拒絕新 key (fail-closed)，絕不淘汰未過期之有效計數以防限流被繞過。
export const memIncr = async (k, ttl = 3600, now = Date.now(), max = MAX_MEM) => {
  const exp = now + ttl * 1000;
  const entry = mem.get(k);

  if (entry) {
    if (now >= entry.expireAt) {
      entry.count = 1;
      entry.expireAt = exp;
    } else {
      entry.count += 1;
    }
    return entry.count;
  }

  // 容量達到上限時的處理策略
  if (mem.size >= max) {
    // 1. 優先清除已過期項目
    for (const [key, val] of mem) {
      if (now >= val.expireAt) mem.delete(key);
    }
    // 2. 若清除過期項目後仍達容量上限：採取保守降級策略 (fail-closed)，拒絕新增 key
    if (mem.size >= max) {
      const err = new Error("MEM_LIMIT_CAPACITY_FULL");
      err.code = "CAPACITY_FULL";
      throw err;
    }
  }

  mem.set(k, { count: 1, expireAt: exp });
  return 1;
};

const kvIncr = async (k, ttl) => { const n = await kv("INCR", k); if (n === 1) await kv("EXPIRE", k, ttl); return n; };

// 回傳 null＝可以通過；字串＝要擋下來的原因
export async function aiLimit(req, name, now = Date.now(), store = null) {
  if (!AI_LIMITS[name]) return null;
  const ip = createHash("sha256").update(ipOf(req)).digest("hex").slice(0, 16), hr = Math.floor(now / 3600e3), day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  const kIp = `rl:${name}:${ip}:${hr}`, kDay = `rl:${name}:day:${day}`;
  const check = async (incr, shared) => {
    const [perIp, perDay] = limitsOf(name, shared), [a, b] = await Promise.all([incr(kIp, 3600), incr(kDay, 2 * 86400)]);
    if (a > perIp) return `使用太頻繁了（每小時最多 ${perIp} 次），請稍後再試`;
    if (b > perDay) return "今天的 AI 使用量已達上限，明天再試";
    return null;
  };
  const shared = store || (kvOn() ? kvIncr : null);
  if (shared) {
    try {
      return await check(shared, true);
    } catch (e) {
      if (process.env.AI_LIMIT_STRICT === "1") {
        return "限流服務暫時異常，請稍後再試";
      }
      /* 計數器壞掉：可觀測警示並改用記憶體的保守上限，不直接放行 */
      console.warn("[aiLimit] KV 限流服務異常，退回本機記憶體保守限制:", e?.message);
    }
  }
  try {
    return await check((k, ttl) => memIncr(k, ttl, now), false);
  } catch (err) {
    if (err?.message === "MEM_LIMIT_CAPACITY_FULL" || err?.code === "CAPACITY_FULL") {
      console.warn(`[aiLimit] 記憶體限流容量已達上限 (${MAX_MEM})，拒絕新請求 (fail-closed):`, name);
      return "系統繁忙（限流容量已滿），請稍後再試";
    }
    throw err;
  }
}
