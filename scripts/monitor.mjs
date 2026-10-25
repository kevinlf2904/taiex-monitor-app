// 伺服器盤中巡檢（盤中監控 M2）：關掉網頁也會偵測。規則和網頁的盤中監控同一套（scripts/_engine.mjs 載入 learner/monitor.js 的 monScan、monMerge）。
// 一次巡檢：抓「大盤＋所有勾了盤中警示的人的庫存與自選」報價（api/_lib/quote.js，MIS 一次 40 檔）→ 偵測 → 事件寫進 KV → 「■ 警示」推 Telegram。
// KV：mon:<日期>（雜湊，事件 id → JSON，30 天過期）、mon:<日期>:runs（最後執行、成功、失敗、連續失敗次數）；網頁從 GET /api/sync?op=mon 讀。
// 通知：每個人只收自己庫存、自選的個股警示（大盤警示人人都收）；同一件同一等級只送一次（monsent:<人>:<id>:<等級>，2 天過期）、
//      同一檔 15 分鐘最多一則（moncd:<人>:<代號>）、每天最多 20 則（moncnt:<人>:<日期>）。
// 不在 09:00–13:30、加權報價不是今天的（休市）：什麼都不做、也不記執行紀錄。今日市場的推估價位存在各人的瀏覽器，伺服器不判斷「穿越關鍵價位」。
// 需要的 GitHub secrets：KV_REST_API_URL、KV_REST_API_TOKEN、TELEGRAM_BOT_TOKEN；沒設定就直接結束。
//   --dry           不寫 KV、不送 Telegram：KV 用記憶體替身（有設定 KV 時照樣讀使用者清單），印出會產生的事件與會送的訊息
//   --force         不管現在是不是盤中（測試用，搭配 --dry）
//   --codes=2330,…  沒有使用者清單時（例如沒設定 KV）額外巡檢這些代號（只在 --dry 有用）
import { fileURLToPath } from "node:url";
import { engine } from "./_engine.mjs";
import { kv as kvReal, kvOn, tg as tgReal, hashObj, monKey } from "../api/_lib/sync.js";
import { callApi } from "./alerts-push.mjs";

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const KEEP = 30 * 86400, SENT = 2 * 86400, BATCH = 40, DAY_MAX = 20, COOL = 900;
const twNow = (now = Date.now()) => new Date(now + 8 * 3600e3), twDate = now => twNow(now).toISOString().slice(0, 10);
const inSession = now => { const t = twNow(now), m = t.getUTCHours() * 60 + t.getUTCMinutes(); return t.getUTCDay() % 6 !== 0 && m >= 9 * 60 && m <= 13 * 60 + 35; };

// 記憶體裡的 KV（--dry 與單元測試用）：支援這支程式用到的指令；讀不到時可以轉給真的 KV（只讀）
export function memKv(read = null) {
  const S = new Map(), H = new Map(), T = new Map();
  const has = k => S.has(k) || H.has(k);
  return async (cmd, k, ...a) => {
    switch (cmd) {
      case "GET": return S.has(k) ? S.get(k) : read ? read("GET", k) : null;
      case "SMEMBERS": return S.has(k) ? [...S.get(k)] : read ? read("SMEMBERS", k) : [];
      case "SET": { if (a.includes("NX") && has(k)) return null; S.set(k, a[0]); const i = a.indexOf("EX"); if (i >= 0) T.set(k, +a[i + 1]); return "OK"; }
      case "INCR": { const n = (+S.get(k) || 0) + 1; S.set(k, String(n)); return n; }
      case "EXPIRE": T.set(k, +a[0]); return 1;
      case "HSET": { const h = H.get(k) || {}; for (let i = 0; i < a.length; i += 2) h[a[i]] = String(a[i + 1]); H.set(k, h); return a.length / 2; }
      case "HINCRBY": { const h = H.get(k) || {}; h[a[0]] = String((+h[a[0]] || 0) + +a[1]); H.set(k, h); return +h[a[0]]; }
      case "HGETALL": return H.has(k) ? Object.entries(H.get(k)).flat() : [];
      case "TTL": return T.get(k) ?? -1;
      default: throw new Error("memKv 不支援 " + cmd);
    }
  };
}

// 這則警示要不要送給這個人（冪等＋節流），會送才回 true；順序：同一件同等級送過就不送 → 同檔 15 分鐘 → 每天 20 則
export async function monAllow(kv, h, e, date) {
  if (e.sev !== "alert") return false;
  if (!(await kv("SET", `monsent:${h}:${e.id}:${e.level}`, "1", "NX", "EX", SENT))) return false;
  if (!(await kv("SET", `moncd:${h}:${e.code}`, "1", "NX", "EX", COOL))) return false;
  const n = await kv("INCR", `moncnt:${h}:${date}`); if (n === 1) await kv("EXPIRE", `moncnt:${h}:${date}`, SENT);
  return n <= DAY_MAX;
}

// 一次巡檢。deps 可換掉（測試用）：kv、tg、quotes(codes) → [quote]、now
export async function runOnce({ kv, tg, quotes, now = Date.now(), force = false, extra = [], log = console.log } = {}) {
  const E0 = engine(), M = E0.M, date = twDate(now), rk = `${monKey(date)}:runs`;
  if (!force && !inSession(now)) { log("不在交易時段，略過"); return { skipped: "session" }; }
  // 使用者：有綁 Telegram、勾了盤中警示（alertDoc 的 ev.mon）
  const users = [];
  for (const h of (await kv("SMEMBERS", "alerts")) || []) { try { const d = JSON.parse((await kv("GET", `alert:${h}`)) || "null"); if (d?.chat && d.ev?.on?.includes("mon")) users.push([h, d]); } catch {} }
  const codes = [...new Set([...users.flatMap(([, d]) => d.ev.mon || []), ...extra])].filter(c => /^\d{4,6}[A-Z]?$/.test(c)).slice(0, 400), all = ["T00", ...codes];
  log("盤中警示的使用者", users.length, "人、巡檢", all.length, "檔");
  const Q = new Map();
  try { for (let i = 0; i < all.length; i += BATCH) for (const q of await quotes(all.slice(i, i + BATCH))) Q.set(q.code, q); if (!Q.get("T00")) throw new Error("沒有加權指數的報價"); }
  catch (e) { // 來源失敗：記一筆失敗、不產生事件（網頁上連續 3 次會顯示「伺服器巡檢中斷」）
    await kv("HSET", rk, "last", now, "err", String(e.message || e).slice(0, 80)); await kv("HINCRBY", rk, "fail", 1); await kv("HINCRBY", rk, "streak", 1); await kv("EXPIRE", rk, KEEP);
    log("::warning::報價拿不到：" + e.message); return { error: e.message };
  }
  if (Q.get("T00").date && Q.get("T00").date !== date) { log("加權報價不是今天的（休市）"); return { skipped: "closed" }; }
  const E = Object.fromEntries(Object.entries(hashObj(await kv("HGETALL", monKey(date)))).map(([k, v]) => { try { return [k, JSON.parse(v)]; } catch { return [k, null]; } }).filter(x => x[1]));
  const prev = E.__px ? E.__px.T00 : null; delete E.__px;
  const names = Object.assign({}, ...users.map(([, d]) => d.names || {}));
  const up = M.monMerge(E, M.monScan(Q, { today: date, codes: codes.map(c => ({ c })), prevPx: prev != null ? { T00: prev } : null, names, now }), now);
  for (const e of up) e.origin = "server";
  // 通知：大盤人人有份，個股只給庫存或自選裡有它的人
  const out = [];
  for (const e of up) {
    if (e.sev !== "alert") continue; let n = 0, err = "";
    for (const [h, d] of users) {
      if (e.code !== "T00" && !(d.ev.mon || []).includes(e.code)) continue;
      if (!(await monAllow(kv, h, e, date))) continue;
      const text = `🚨 盤中警示 ${M.monTime(now).slice(0, 5)}\n${e.title}\n${e.msg}\n\n伺服器每 5–15 分鐘巡檢一次，行情達到條件不代表原因，也不是買賣建議。`;
      out.push([h.slice(0, 8), text]);
      try { await tg("sendMessage", { chat_id: d.chat, text }); n++; } catch (x) { err = String(x.message || x).slice(0, 80); }
    }
    if (n || err) e.notified.push({ ch: "tg", at: now, ok: !!n, n, ...(err ? { err } : {}) });
  }
  // 存回去：這輪新開或升級的事件，加上給下一輪判斷「穿越」用的上一輪價格
  const pairs = [...up.flatMap(e => [e.id, JSON.stringify(e)]), "__px", JSON.stringify({ T00: Q.get("T00").price })];
  await kv("HSET", monKey(date), ...pairs); await kv("EXPIRE", monKey(date), KEEP);
  await kv("HSET", rk, "last", now, "lastOk", now, "streak", 0, "err", ""); await kv("HINCRBY", rk, "ok", 1); await kv("EXPIRE", rk, KEEP);
  log("事件", up.length, "件（新開或升級）、送出", out.length, "則");
  return { up, sent: out };
}

export async function main() {
  const DRY = process.argv.includes("--dry"), force = process.argv.includes("--force");
  if (!DRY && (!kvOn() || !process.env.TELEGRAM_BOT_TOKEN)) { console.log("::warning::沒有設定雲端儲存（KV_REST_API_URL）或 TELEGRAM_BOT_TOKEN，略過盤中巡檢"); return; }
  const kv = DRY ? memKv(kvOn() ? kvReal : null) : kvReal;
  const tg = DRY ? async (m, b) => console.log("[dry] 會送出：", String(b.chat_id).slice(0, 3) + "…", "\n" + b.text) : tgReal;
  const quotes = async codes => { const j = await callApi(import("../api/_lib/quote.js"), { codes: codes.join(","), src: "mis" }); if (!j?.ok) throw new Error(j?.error || "報價失敗"); return j.quotes; };
  const r = await runOnce({ kv, tg, quotes, force, extra: DRY ? String(arg("codes") || "").split(",").filter(Boolean) : [] });
  if (DRY) for (const e of r.up || []) console.log(`[dry] ${e.sev} ${e.id}：${e.title}／${e.msg}`);
}
// 任何錯誤都只印 warning、以成功結束：巡檢失敗不能讓排程一直紅（失敗次數記在 KV，網頁上看得到）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::盤中巡檢這次沒有完成：" + e.message); process.exitCode = 0; });
