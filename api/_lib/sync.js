// 雲端同步與 Telegram 提醒：給 learner/watch.html「工具 → 備份同步」使用。
// 需要在 Vercel 設定：
//   Upstash Redis（Vercel 的 Storage → Upstash for Redis，連到這個專案會自動加 KV_REST_API_URL、KV_REST_API_TOKEN；也接受 UPSTASH_REDIS_REST_URL／TOKEN）
//   TELEGRAM_BOT_TOKEN（選用：用 @BotFather 建立機器人取得；收盤後的提醒推播用）
// 沒設定時 cfg 會回 kv:false，網頁只提供「匯出／匯入備份檔」。
// 同步碼由瀏覽器產生（亂數 24 字），伺服器只存它的 SHA-256；知道同步碼才讀寫得到資料，所以同步碼要像密碼一樣保管。
// POST /api/sync { op: "push", id, data }   上傳（覆蓋）；data 是瀏覽器裡 kline: 開頭的設定與紀錄，最多 900KB
// POST /api/sync { op: "pull", id }         下載
// POST /api/sync { op: "tgbind", id }       找機器人收到的「/start 綁定碼」，記下 chat id 並回一則確認訊息
// POST /api/sync { op: "tgtest", id }       送一則測試訊息
// POST /api/sync { op: "tgoff", id }        解除 Telegram 綁定
// GET  /api/sync?op=cfg                     { kv, tg, bot }
// POST /api/sync { op: "waitlist", email, plan }  KLineLab Pro 候補名單（pro.html）：存在 KV 的 waitlist 雜湊（email → 時間、方案），同一個 IP 每小時最多 5 次
import { createHash } from "node:crypto";

const KV_URL = () => (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
const KV_TOKEN = () => (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const TG = () => (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const MAX = 900 * 1024;
export const hashId = id => createHash("sha256").update(String(id)).digest("hex");
export const bindTok = h => h.slice(0, 24);
const okId = id => /^[A-Za-z0-9_-]{20,64}$/.test(String(id || ""));

export async function kv(...cmd) {
  const r = await fetch(KV_URL(), { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN()}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => null); if (!r.ok || j?.error) throw new Error(j?.error || `KV HTTP ${r.status}`); return j.result;
}
export async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TG()}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => null); if (!j?.ok) throw new Error(j?.description || `Telegram HTTP ${r.status}`); return j.result;
}
let botName = null;
// 提醒用的摘要：指標提醒、價格提醒、股票名稱；有綁 Telegram 才放進 alerts 清單，收盤後的排程只讀這份
export function alertDoc(data, chat) {
  const g = k => { try { return JSON.parse(data?.[`kline:${k}`] ?? "null"); } catch { return null; } };
  const rules = (g("watch:irules") || []).filter(r => r?.on && r.code && r.cond).map(r => ({ code: r.code, cond: r.cond, p: r.p ?? null }));
  const price = Object.entries(g("watch:alerts") || {}).map(([code, a]) => ({ code, up: a?.up ?? null, dn: a?.dn ?? null })).filter(a => a.up || a.dn);
  return { chat, rules: rules.slice(0, 100), price: price.slice(0, 100), names: g("watch:names") || {} };
}

// 候補名單的一筆：email 轉小寫並檢查格式，方案只收 pro／team
export function waitlistEntry(email, plan, now = Date.now()) {
  const e = String(email || "").trim().toLowerCase(); if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return { email: e, doc: JSON.stringify({ at: now, plan: plan === "team" ? "team" : "pro" }) };
}
export default async function handler(req, res) {
  const q = req.query || {}, b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}, op = b.op || q.op;
  const hasKv = !!(KV_URL() && KV_TOKEN()), hasTg = !!TG();
  if (op === "cfg") {
    if (hasTg && !botName) { try { botName = (await tg("getMe")).username; } catch {} }
    return res.status(200).json({ ok: true, kv: hasKv, tg: hasTg && hasKv, bot: botName });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "請用 POST" });
  if (!hasKv) return res.status(200).json({ ok: false, error: "伺服器還沒設定雲端儲存（Upstash Redis），目前只能用匯出／匯入備份檔。" });
  if (op === "waitlist") {
    const w = waitlistEntry(b.email, b.plan); if (!w) return res.status(400).json({ ok: false, error: "Email 格式不對" });
    try { const ip = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "?", rk = `wl:ip:${hashId(ip).slice(0, 16)}`, n = await kv("INCR", rk); if (n === 1) await kv("EXPIRE", rk, 3600);
      if (n > 5) return res.status(429).json({ ok: false, error: "太多次了，請一小時後再試" });
      await kv("HSET", "waitlist", w.email, w.doc); return res.status(200).json({ ok: true }); }
    catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
  }
  if (!okId(b.id)) return res.status(400).json({ ok: false, error: "同步碼格式不對" });
  const h = hashId(b.id), key = `sync:${h}`;
  try {
    if (op === "push") {
      const data = b.data && typeof b.data === "object" ? b.data : null; if (!data) return res.status(400).json({ ok: false, error: "沒有資料" });
      const body = JSON.stringify({ at: Date.now(), dev: String(b.dev || "").slice(0, 40), data }); if (body.length > MAX) return res.status(413).json({ ok: false, error: `資料太大（${Math.round(body.length / 1024)}KB，上限 900KB）` });
      await kv("SET", key, body);
      const chat = await kv("GET", `tg:${h}`);
      if (chat) { const doc = alertDoc(data, chat); if (doc.rules.length || doc.price.length) { await kv("SET", `alert:${h}`, JSON.stringify(doc)); await kv("SADD", "alerts", h); } else { await kv("DEL", `alert:${h}`); await kv("SREM", "alerts", h); } }
      return res.status(200).json({ ok: true, at: Date.now(), tg: !!chat });
    }
    if (op === "pull") { const v = await kv("GET", key); if (!v) return res.status(200).json({ ok: false, error: "雲端沒有這個同步碼的資料" }); const j = JSON.parse(v); return res.status(200).json({ ok: true, ...j, tg: !!(await kv("GET", `tg:${h}`)) }); }
    if (op === "tgbind") {
      if (!hasTg) return res.status(200).json({ ok: false, error: "伺服器還沒設定 TELEGRAM_BOT_TOKEN" });
      const tok = bindTok(h), ups = await tg("getUpdates", { limit: 100, allowed_updates: ["message"] });
      const m = [...ups].reverse().find(u => String(u.message?.text || "").trim() === `/start ${tok}`);
      if (!m) return res.status(200).json({ ok: false, error: "還沒收到綁定訊息：請先點連結開啟機器人並按「開始（Start）」，再回來按完成綁定。" });
      const chat = m.message.chat.id; await kv("SET", `tg:${h}`, String(chat));
      await tg("sendMessage", { chat_id: chat, text: "✅ K線看盤已綁定。收盤後符合你設定的指標或價格提醒時，會在這裡通知你。" });
      const v = await kv("GET", key); if (v) { const doc = alertDoc(JSON.parse(v).data, String(chat)); if (doc.rules.length || doc.price.length) { await kv("SET", `alert:${h}`, JSON.stringify(doc)); await kv("SADD", "alerts", h); } }
      return res.status(200).json({ ok: true });
    }
    if (op === "tgtest") { const chat = await kv("GET", `tg:${h}`); if (!chat) return res.status(200).json({ ok: false, error: "還沒綁定 Telegram" }); await tg("sendMessage", { chat_id: chat, text: "🔔 測試通知：K線看盤的提醒會像這樣送到這裡。" }); return res.status(200).json({ ok: true }); }
    if (op === "tgoff") { await kv("DEL", `tg:${h}`); await kv("DEL", `alert:${h}`); await kv("SREM", "alerts", h); return res.status(200).json({ ok: true }); }
    return res.status(400).json({ ok: false, error: "不認得的 op" });
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
}
