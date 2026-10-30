// 雲端同步與 Telegram 提醒：給 learner/watch.html「工具 → 備份同步」使用。
// 需要在 Vercel 設定：
//   Upstash Redis（Vercel 的 Storage → Upstash for Redis，連到這個專案會自動加 KV_REST_API_URL、KV_REST_API_TOKEN；也接受 UPSTASH_REDIS_REST_URL／TOKEN）
//   TELEGRAM_BOT_TOKEN（選用：用 @BotFather 建立機器人取得；收盤後的提醒推播用）
// 沒設定時 cfg 會回 kv:false，網頁只提供「匯出／匯入備份檔」。
// 同步碼由瀏覽器產生（亂數 24 字），伺服器只存它的 SHA-256；知道同步碼才讀寫得到資料，所以同步碼要像密碼一樣保管。
// POST /api/sync { op: "push", id, data, base?, force? }   上傳（覆蓋）；data 是瀏覽器裡 kline: 開頭的設定與紀錄，最多 900KB；base＝這台上次同步時雲端的時間，雲端比它新就回 409 conflict（force: true 才覆蓋）
// POST /api/sync { op: "pull", id }         下載
// POST /api/sync { op: "tgbind", id }       找機器人收到的「/start 綁定碼」，記下 chat id 並回一則確認訊息
// POST /api/sync { op: "tgtest", id }       送一則測試訊息
// POST /api/sync { op: "tgoff", id }        解除 Telegram 綁定
// GET  /api/sync?op=cfg                     { kv, tg, bot }
// GET  /api/sync?op=mon&date=YYYY-MM-DD     伺服器盤中巡檢的事件與執行紀錄 { kv, events, runs }（scripts/monitor.mjs 寫入；沒設定 KV 時 kv:false）
// POST /api/sync { op: "waitlist", email, plan }  KLineLab Pro 候補名單（pro.html）：存在 KV 的 waitlist 雜湊（email → 時間、方案），同一個 IP 每小時最多 5 次
import { createHash } from "node:crypto";
import { userMsg } from "./_err.js";

const KV_URL = () => (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
const KV_TOKEN = () => (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const TG = () => (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const MAX = 900 * 1024, KEEP = 400 * 86400; // 同步資料 400 天沒更新就自動刪掉（每次上傳都會重新計時）
export const hashId = id => createHash("sha256").update(String(id)).digest("hex");
export const bindTok = h => h.slice(0, 24);
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
export const okId = id => /^[A-Za-z0-9_-]{20,64}$/.test(String(id || ""));

export const kvOn = () => !!(KV_URL() && KV_TOKEN());
export async function kv(...cmd) {
  const r = await fetch(KV_URL(), { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN()}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => null); if (!r.ok || j?.error) throw new Error(j?.error || `KV HTTP ${r.status}`); return j.result;
}
// 計數器加一並確保有過期時間：INCR 成功但 EXPIRE 失敗時鍵會永遠留著（沒帶時間的鍵，例如候補名單 wl:ip，會變成永久封鎖），之後每 20 次檢查一次補上
export async function incrTtl(k, ttl) { const n = await kv("INCR", k); if (n === 1 || (n % 20 === 0 && (await kv("TTL", k)) === -1)) await kv("EXPIRE", k, ttl); return n; }
export function redactTelegramSecrets(str, token) {
  if (!str) return "";
  let s = String(str);
  if (token) s = s.replaceAll(token, "[REDACTED_TOKEN]");
  // 徹底過濾任何可能出現在 URL 或錯誤訊息中的 Telegram bot token (格式如 /bot123456:ABC-DEF...)
  s = s.replace(/\/bot[0-9]+:[A-Za-z0-9_-]+/g, "/bot[REDACTED_TOKEN]");
  return s;
}

export function sanitizeTelegramError(err, token) {
  if (!err) return new Error("Unknown Telegram Error");
  const rawMsg = err.message || String(err);
  const safeMsg = redactTelegramSecrets(rawMsg, token);
  const safeErr = new Error(safeMsg);

  if (err.name) safeErr.name = redactTelegramSecrets(err.name, token);
  if (err.code) safeErr.code = redactTelegramSecrets(err.code, token);
  if (err.status) safeErr.status = err.status;
  if (err.stack) safeErr.stack = redactTelegramSecrets(err.stack, token);

  // 深度清洗 cause 鏈，確保原始未脫敏之物件絕不外流
  if (err.cause) {
    const rawCause = err.cause;
    const causeMsg = redactTelegramSecrets(rawCause?.message || String(rawCause), token);
    const cleanCause = new Error(causeMsg);
    if (rawCause?.name) cleanCause.name = redactTelegramSecrets(rawCause.name, token);
    if (rawCause?.code) cleanCause.code = redactTelegramSecrets(rawCause.code, token);
    if (rawCause?.status) cleanCause.status = rawCause.status;
    if (rawCause?.stack) cleanCause.stack = redactTelegramSecrets(rawCause.stack, token);
    cleanCause.toJSON = () => ({
      name: cleanCause.name,
      message: cleanCause.message,
      code: cleanCause.code
    });
    safeErr.cause = cleanCause;
  }

  // 避免 JSON 序列化洩漏
  safeErr.toJSON = () => ({
    name: safeErr.name,
    message: safeErr.message,
    code: safeErr.code,
    status: safeErr.status,
    cause: safeErr.cause ? (typeof safeErr.cause.toJSON === "function" ? safeErr.cause.toJSON() : safeErr.cause.message) : undefined
  });

  return safeErr;
}

export async function tg(method, body) {
  const token = TG();
  if (!token) throw new Error("尚未設定 TELEGRAM_BOT_TOKEN");
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(10000)
    });
    const j = await r.json().catch(() => null);
    if (!j?.ok) {
      const desc = j?.description ? redactTelegramSecrets(j.description, token) : `Telegram HTTP ${r.status}`;
      const apiErr = new Error(desc);
      apiErr.status = r.status;
      throw apiErr;
    }
    return j.result;
  } catch (err) {
    throw sanitizeTelegramError(err, token);
  }
}
let botName = null;
// 提醒用的摘要：指標提醒、價格提醒、股票名稱、追蹤對象；有綁 Telegram 才放進 alerts 清單，收盤後的排程只讀這份
export function alertDoc(data, chat) {
  const g = k => { try { return JSON.parse(data?.[ `kline:${k}` ] ?? "null"); } catch { return null; } };
  const rules = (g("watch:irules") || []).filter(r => r?.on && r.code && r.cond).map(r => ({ code: r.code, cond: r.cond, p: r.p ?? null }));
  const price = Object.entries(g("watch:alerts") || {}).map(([code, a]) => ({ code, up: a?.up ?? null, dn: a?.dn ?? null })).filter(a => a.up || a.dn);
  // 追蹤：國會議員、13F 機構（情報局「大戶國會 → 我的追蹤」），加上庫存台股（內部人轉讓申報）
  const F = g("watch:follow") || {}, ids = k => Object.keys(F[k] || {}).filter(x => typeof x === "string" && x.length < 80).slice(0, 50);
  const follow = { cong: ids("cong"), f13: ids("f13"), ins: [...new Set([...Object.keys(g("watch:hold") || {}), ...Object.keys(F.ins || {})])].filter(c => /^\d{4,6}[A-Z]?$/.test(c)).slice(0, 100) };
  // 事件提醒（工具 → 提醒 → 事件提醒）：營收公布、三率三升、法說會前一天、ETF 換股、每日早報、收盤重點；範圍是庫存台股（選「庫存＋自選」時加上自選）
  const E = g("watch:evalert") || {}, on = ["rev", "pm3", "conf", "etf", "brief", "close", "mon"].filter(k => E[k] === true), hold = g("watch:hold") || {};
  // 收盤重點（今日重點卡）：自選＋庫存全部（台股、美股都算）
  const mine = on.includes("close") ? [...new Set([...Object.keys(hold).filter(c => !hold[c]?.demo), ...(g("watch:groups") || []).flatMap(x => (Array.isArray(x?.list) ? x.list : []))])].filter(c => typeof c === "string" && /^(\d{4,6}[A-Z]?|[A-Z][A-Z.-]{0,6})$/.test(c)).slice(0, 200) : [];
  const evCodes = on.length ? [...new Set([...Object.keys(hold).filter(c => !hold[c]?.demo), ...(E.scope === "all" ? (g("watch:groups") || []).flatMap(x => (Array.isArray(x?.list) ? x.list : [])) : [])])].filter(c => typeof c === "string" && /^\d{4,6}[A-Z]?$/.test(c)).slice(0, 150) : [];
  // 盤中警示（scripts/monitor.mjs）：庫存台股（不含範例）＋自選台股，和網頁的盤中監控同一個範圍
  const mon = on.includes("mon") ? [...new Set([...Object.keys(hold).filter(c => !hold[c]?.demo), ...(g("watch:groups") || []).flatMap(x => (Array.isArray(x?.list) ? x.list : []))])].filter(c => typeof c === "string" && /^\d{4,6}[A-Z]?$/.test(c)).slice(0, 150) : [];
  return { chat, rules: rules.slice(0, 100), price: price.slice(0, 100), names: g("watch:names") || {}, follow, ev: { on, codes: evCodes, mine, mon } };
}
// 有任何要檢查的東西才放進收盤後的推播清單（早報只要勾了就算，沒有庫存也有大盤的部分）
export const docHas = d => !!(d.rules.length || d.price.length || d.follow?.cong.length || d.follow?.f13.length || d.follow?.ins.length || d.ev?.on.includes("brief") || d.ev?.on.includes("mon") || (d.ev?.on.includes("close") && d.ev.mine?.length) || (d.ev?.on.length && d.ev.codes.length));

// 伺服器盤中巡檢（scripts/monitor.mjs）在 KV 的資料：mon:<日期>（雜湊，事件 id → JSON，30 天過期）、mon:<日期>:runs（執行紀錄）
export const monKey = d => `mon:${d}`;
// Upstash 的 HGETALL 回 [欄位, 值, 欄位, 值…]；記憶體替身可能回物件，兩種都接受
export const hashObj = r => (Array.isArray(r) ? Object.fromEntries(r.reduce((a, v, i) => (i % 2 ? a[a.length - 1].push(v) : a.push([v]), a), [])) : r || {});
// 公開給網頁的事件：只留行情欄位，通知紀錄只留管道、時間、成功與否、人數
export function monPublic(raw) {
  return Object.values(hashObj(raw)).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(e => e?.id).slice(0, 200)
    .map(({ id, type, code, dir, level, sev, title, msg, px, pct, first, last, state, snaps, notified }) => ({ id, type, code, dir, level, sev, title, msg, px, pct, first, last, state, snaps: (snaps || []).slice(-20), notified: (notified || []).map(n => ({ ch: n.ch, at: n.at, ok: !!n.ok, n: n.n || 0, ...(n.err ? { err: String(n.err).slice(0, 80) } : {}) })), origin: "server" }));
}
// 執行紀錄：last 最後一次巡檢、lastOk 最後成功、streak 連續失敗、badN／badTxt 這輪有問題的報價、skip／skipAt 略過的原因（closed 休市、unknown 交易日待確認、notoday 加權報價不是今天）
export function monRuns(raw) {
  const r = hashObj(raw); if (!r.last && !r.skipAt) return null; const n = k => +r[k] || 0, s = k => (r[k] ? String(r[k]).slice(0, 80) : "");
  return { last: n("last"), lastOk: n("lastOk"), ok: n("ok"), fail: n("fail"), streak: n("streak"), err: s("err"), badN: n("badN"), badTxt: s("badTxt"), skip: ["closed", "unknown", "notoday"].includes(r.skip) ? r.skip : "", skipAt: n("skipAt") };
}

// 候補名單的一筆：email 轉小寫並檢查格式，方案只收 pro／team
export function waitlistEntry(email, plan, now = Date.now()) {
  const e = String(email || "").trim().toLowerCase(); if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return { email: e, doc: JSON.stringify({ at: now, plan: ["team", "pro", "beta"].includes(plan) ? plan : "beta" }) };
}
export default async function handler(req, res) {
  let b; try { b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; } catch { return res.status(400).json({ ok: false, error: "資料格式不對" }); }
  const q = req.query || {}, op = b.op || q.op;
  const hasKv = !!(KV_URL() && KV_TOKEN()), hasTg = !!TG();
  if (op === "cfg") {
    if (hasTg && !botName) { try { botName = (await tg("getMe")).username; } catch {} }
    // limiter：AI 限流是全站共用（KV）還是每個執行個體各自計算（沒有 KV，_limit.js 退回記憶體保守上限，不能當成全站統一配額）；只回狀態，不回任何設定值
    return res.status(200).json({ ok: true, kv: hasKv, tg: hasTg && hasKv, bot: botName, limiter: hasKv ? "shared" : "per_instance" });
  }
  if (op === "mon") { // 伺服器盤中巡檢的事件（公開的行情事件，不含任何使用者資料）
    const date = String(q.date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "日期格式不對" });
    if (!hasKv) return res.status(200).json({ ok: true, kv: false, events: [], runs: null });
    try { const [ev, runs] = await Promise.all([kv("HGETALL", monKey(date)), kv("HGETALL", `${monKey(date)}:runs`)]);
      res.setHeader?.("Cache-Control", "public, max-age=30, s-maxage=60");
      return res.status(200).json({ ok: true, kv: true, events: monPublic(ev), runs: monRuns(runs) }); }
    catch (e) { return res.status(200).json({ ok: false, error: userMsg(e, "雲端儲存暫時連不到", "sync") }); }
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "請用 POST" });
  // reason：not_configured＝伺服器沒設定（要管理者到 Vercel 設定）；unavailable＝有設定但暫時連不到（稍後重試會恢復）
  if (!hasKv) return res.status(200).json({ ok: false, reason: "not_configured", error: "伺服器還沒設定雲端儲存（Upstash Redis），目前只能用匯出／匯入備份檔。" });
  if (op === "waitlist") {
    const w = waitlistEntry(b.email, b.plan); if (!w) return res.status(400).json({ ok: false, error: "Email 格式不對" });
    try { const rk = `wl:ip:${hashId(ipOf(req)).slice(0, 16)}`, n = await incrTtl(rk, 3600);
      if (n > 5) return res.status(429).json({ ok: false, error: "太多次了，請一小時後再試" });
      await kv("HSET", "waitlist", w.email, w.doc); return res.status(200).json({ ok: true }); }
    catch (e) { return res.status(200).json({ ok: false, error: userMsg(e, "雲端儲存暫時連不到，請稍後再試", "sync") }); }
  }
  if (!okId(b.id)) return res.status(400).json({ ok: false, error: "同步碼格式不對" });
  const h = hashId(b.id), key = `sync:${h}`;
  const ipHash = hashId(ipOf(req)).slice(0, 16);
  const hr = Math.floor(Date.now() / 3600e3);
  try {
    if (op === "push") {
      // 每個 IP 每小時最多上傳 30 次：避免被人用程式一直塞新的同步碼，把雲端空間塞滿
      const rk = `sp:ip:${ipHash}:${hr}`, n = await incrTtl(rk, 3600);
      if (n > 30) return res.status(429).json({ ok: false, error: "上傳太頻繁了，請一小時後再試" });
      const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : null; if (!data) return res.status(400).json({ ok: false, error: "沒有資料或資料格式不對" });
      // 版本檢查：網頁帶 base（這台上次同步時雲端的時間）；雲端已經被別台裝置更新過（at > base）就不覆蓋，回 409 讓使用者選。force＝使用者確認要用這台蓋掉。舊版網頁沒帶 base 照舊直接覆蓋
      const base = b.base == null ? null : Number(b.base);
      if (base != null && Number.isFinite(base) && b.force !== true) { const cur = await kv("GET", key); let c = null; try { c = cur ? JSON.parse(cur) : null; } catch {} if (c && +c.at > base) return res.status(409).json({ ok: false, conflict: true, at: +c.at, dev: String(c.dev || ""), error: "雲端有另一台裝置比較新的資料" }); }
      const at = Date.now(), body = JSON.stringify({ at, dev: String(b.dev || "").slice(0, 40), data }); if (body.length > MAX) return res.status(413).json({ ok: false, error: `資料太大（${Math.round(body.length / 1024)}KB，上限 900KB）` });
      await kv("SET", key, body, "EX", KEEP);
      const chat = await kv("GET", `tg:${h}`);
      if (chat) { const doc = alertDoc(data, chat); if (docHas(doc)) { await kv("SET", `alert:${h}`, JSON.stringify(doc)); await kv("SADD", "alerts", h); } else { await kv("DEL", `alert:${h}`); await kv("SREM", "alerts", h); } }
      return res.status(200).json({ ok: true, at, tg: !!chat });
    }
    if (op === "pull") {
      // 1. IP 總下載頻率限制（每 IP 每小時最多 60 次）
      const rk = `pl:ip:${ipHash}:${hr}`, n = await incrTtl(rk, 3600);
      if (n > 60) return res.status(429).json({ ok: false, error: "讀取太頻繁了，請一小時後再試" });

      // 2. 暴力破解防護：每個 IP 失敗嘗試次數限制（每小時最多 15 次失敗）
      const fk = `pl:fail:${ipHash}:${hr}`;
      const failCount = +(await kv("GET", fk) || 0);
      if (failCount >= 15) return res.status(429).json({ ok: false, error: "錯誤嘗試次數過多，請一小時後再試" });

      const v = await kv("GET", key);
      if (!v) {
        const fn = await incrTtl(fk, 3600);
        return res.status(200).json({ ok: false, error: "雲端沒有這個同步碼的資料" });
      }
      let j;
      try { j = JSON.parse(v); } catch { return res.status(200).json({ ok: false, error: "同步資料格式毀損" }); }
      // 3. 過期檢查（KEEP 為 400 天）
      if (j?.at && (Date.now() - j.at > KEEP * 1000)) {
        return res.status(200).json({ ok: false, error: "同步資料已過期" });
      }
      return res.status(200).json({ ok: true, ...j, tg: !!(await kv("GET", `tg:${h}`)) });
    }
    if (op === "tgbind") {
      // 頻率限制：每個 IP 每小時最多嘗試 10 次
      const rk = `tgb:ip:${ipHash}:${hr}`, n = await incrTtl(rk, 3600);
      if (n > 10) return res.status(429).json({ ok: false, error: "綁定嘗試太頻繁了，請稍後再試" });

      if (!hasTg) return res.status(200).json({ ok: false, reason: "tg_not_configured", error: "伺服器還沒設定 Telegram 推播" });
      const tok = bindTok(h), ups = await tg("getUpdates", { limit: 100, allowed_updates: ["message"] });
      const m = [...ups].reverse().find(u => String(u.message?.text || "").trim() === `/start ${tok}`);
      if (!m) return res.status(200).json({ ok: false, error: "還沒收到綁定訊息：請先點連結開啟機器人並按「開始（Start）」，再回來按完成綁定。" });
      const chat = m.message.chat.id; await kv("SET", `tg:${h}`, String(chat));
      await tg("sendMessage", { chat_id: chat, text: "✅ K線看盤已綁定。收盤後符合你設定的指標或價格提醒時，會在這裡通知你。" });
      const v = await kv("GET", key); if (v) { const doc = alertDoc(JSON.parse(v).data, String(chat)); if (docHas(doc)) { await kv("SET", `alert:${h}`, JSON.stringify(doc)); await kv("SADD", "alerts", h); } }
      return res.status(200).json({ ok: true });
    }
    if (op === "tgtest") {
      // 頻率限制：每個同步碼每 10 分鐘最多發送 3 次測試訊息，避免濫發
      const tenMin = Math.floor(Date.now() / 600e3);
      const rk = `tgt:h:${h.slice(0, 16)}:${tenMin}`, n = await incrTtl(rk, 600);
      if (n > 3) return res.status(429).json({ ok: false, error: "測試訊息發送太頻繁，請稍後再試" });
      if (!hasTg) return res.status(200).json({ ok: false, reason: "tg_not_configured", error: "伺服器還沒設定 Telegram 推播" }); // 沒設定就明說，不要回「暫時連不到」

      const chat = await kv("GET", `tg:${h}`); if (!chat) return res.status(200).json({ ok: false, error: "還沒綁定 Telegram" });
      await tg("sendMessage", { chat_id: chat, text: "🔔 測試通知：K線看盤的提醒會像這樣送到這裡。" });
      return res.status(200).json({ ok: true });
    }
    if (op === "tgoff") {
      // 頻率限制：每個 IP 每小時最多 15 次解除綁定
      const rk = `tgo:ip:${ipHash}:${hr}`, n = await incrTtl(rk, 3600);
      if (n > 15) return res.status(429).json({ ok: false, error: "操作太頻繁，請稍後再試" });

      await kv("DEL", `tg:${h}`); await kv("DEL", `alert:${h}`); await kv("SREM", "alerts", h);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: "不認得的 op" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "unavailable", error: userMsg(e, "雲端儲存或 Telegram 暫時連不到，請稍後再試", "sync") });
  }
}
