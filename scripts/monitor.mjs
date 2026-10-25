// 伺服器盤中巡檢（盤中監控 M2）：關掉網頁也會偵測。規則和網頁的盤中監控同一套（scripts/_engine.mjs 載入 learner/monitor.js 的 monScan、monMerge、monCheck）。
// 一次巡檢：確認交易日與時段 → 抓「大盤＋所有勾了盤中警示的人的庫存與自選」報價（api/_lib/quote.js，MIS 一次 40 檔）→ 檢查報價完整度 → 偵測 → 事件寫進 KV → 「■ 警示」推 Telegram。
// 交易日：和網頁同一套（learner/core.js 的 twHolSet、twDayState、mktSession，P1）。週末、09:00–13:35 以外直接結束；
//   休市日表說今天休市、或表拿不到（格式不對、沒有今年的日期）都不抓報價，記一筆略過原因（mon:<日期>:runs 的 skip）；加權報價不是今天的也一樣（第二道確認）。
// 報價：每一檔都要通過 monCheck（正數的價格與昨收、不是估價、今天的日期、有時間而且 3 分鐘內）；不能用的不判斷，執行紀錄寫出幾檔、什麼問題（網頁顯示「部分報價有問題」）。
//   加權指數不能用＝整輪失敗（不產生事件）；個股缺幾檔＝部分成功。
// KV：mon:<日期>（雜湊，事件 id → JSON，30 天過期）、mon:<日期>:runs（最後執行、成功、失敗、連續失敗、略過原因、問題檔數）；網頁從 GET /api/sync?op=mon 讀。
// 通知（每個人、每件事件、每個等級各自一份狀態，見 monNotify）：
//   monsent:<人>:<id>:<等級>  處理鎖（SET NX，2 分鐘）→ 結果：ok:<時間>／skip:cd／skip:quota／fail（2 天過期）；兩次巡檢同時跑也只有一個拿得到鎖
//   moncd:<人>:<代號>         同一檔 15 分鐘一則：送之前先佔住，送失敗就放掉
//   moncnt:<人>:<日期>        每天 20 則，算「送成功的」：送之前先預留一則，送失敗就退回
//   monretry:<人>:<日期>      送失敗的（id|等級 → 失敗次數）：下一輪再試，最多 3 次，之後記成 fail 不再送
//   大盤警示人人都收，個股警示只給庫存、自選裡有它的人。
// 需要的 GitHub secrets：KV_REST_API_URL、KV_REST_API_TOKEN、TELEGRAM_BOT_TOKEN；沒設定就直接結束。
//   --dry           不寫 KV、不送 Telegram：KV 用記憶體替身（有設定 KV 時照樣讀使用者清單），印出會產生的事件與會送的訊息
//   --force         不管現在是不是交易日、盤中（測試用，搭配 --dry）
//   --codes=2330,…  沒有使用者清單時（例如沒設定 KV）額外巡檢這些代號（只在 --dry 有用）
import { fileURLToPath } from "node:url";
import { engine } from "./_engine.mjs";
import { kv as kvReal, kvOn, tg as tgReal, hashObj, monKey } from "../api/_lib/sync.js";
import { callApi } from "./alerts-push.mjs";

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const KEEP = 30 * 86400, SENT = 2 * 86400, BATCH = 40, DAY_MAX = 20, COOL = 900, LEASE = 120, TRIES = 3;
const twDate = now => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
// 錯誤訊息只留前 80 字，Bot Token 的樣子（bot123:abc）一律遮掉
export const scrub = e => String(e?.message || e || "").replace(/bot\d+:[\w-]+/g, "bot***").replace(/\d{6,}:[\w-]{20,}/g, "***").slice(0, 80);

// 記憶體裡的 KV（--dry 與單元測試用）：支援這支程式用到的指令；讀不到時可以轉給真的 KV（只讀）
export function memKv(read = null) {
  const S = new Map(), H = new Map(), T = new Map();
  const has = k => S.has(k) || H.has(k);
  return async (cmd, k, ...a) => {
    switch (cmd) {
      case "GET": return S.has(k) ? S.get(k) : read ? read("GET", k) : null;
      case "SMEMBERS": return S.has(k) ? [...S.get(k)] : read ? read("SMEMBERS", k) : [];
      case "SET": { if ((a.includes("NX") && has(k)) || (a.includes("XX") && !has(k))) return null; S.set(k, String(a[0])); const i = a.indexOf("EX"); if (i >= 0) T.set(k, +a[i + 1]); else T.delete(k); return "OK"; }
      case "DEL": { const n = +S.delete(k) + +H.delete(k); T.delete(k); return n; }
      case "INCR": case "DECR": { const n = (+S.get(k) || 0) + (cmd === "INCR" ? 1 : -1); S.set(k, String(n)); return n; }
      case "EXPIRE": T.set(k, +a[0]); return 1;
      case "TTL": return T.get(k) ?? -1;
      case "HSET": { const h = H.get(k) || {}; for (let i = 0; i < a.length; i += 2) h[a[i]] = String(a[i + 1]); H.set(k, h); return a.length / 2; }
      case "HINCRBY": { const h = H.get(k) || {}; h[a[0]] = String((+h[a[0]] || 0) + +a[1]); H.set(k, h); return +h[a[0]]; }
      case "HDEL": { const h = H.get(k); if (!h || !(a[0] in h)) return 0; delete h[a[0]]; return 1; }
      case "HGETALL": return H.has(k) ? Object.entries(H.get(k)).flat() : [];
      default: throw new Error("memKv 不支援 " + cmd);
    }
  };
}

// 送一則警示給一個人。回傳：ok 送成功、dup 已經有人在處理或處理過、cd 同一檔 15 分鐘內送過、quota 今天滿 20 則、
// retry 送失敗（下一輪再試）、fail 失敗 3 次放棄、kverr KV 出錯（沒有送出）、skip 不是警示等級。
// 冷卻與額度都是「先佔住、送成功才算數」：送失敗就放掉，不會因為失敗而佔掉 15 分鐘或每天的 20 則。
// KV 沒有一次完成多個動作的保證，所以每一步都只靠單一指令的原子性（SET NX、INCR）；兩次巡檢同時跑時，處理鎖只有一個拿得到。
export async function monNotify(kv, h, e, date, send, now = Date.now()) {
  if (e.sev !== "alert") return "skip";
  const sk = `monsent:${h}:${e.id}:${e.level}`, cd = `moncd:${h}:${e.code}`, cnt = `moncnt:${h}:${date}`, rt = `monretry:${h}:${date}`, f = `${e.id}|${e.level}`;
  const me = `busy:${now}:${Math.random().toString(36).slice(2, 10)}`;
  const relCd = async () => { if ((await kv("GET", cd)) === me) await kv("DEL", cd); }; // 只放掉自己佔的（別人佔的不能動）
  const quiet = p => p.catch(() => {});
  try { if (!(await kv("SET", sk, me, "NX", "EX", LEASE))) return "dup"; } catch { return "kverr"; }
  let cdOk = false, qOk = false;
  try {
    if (!(await kv("SET", cd, me, "NX", "EX", COOL))) { await kv("SET", sk, "skip:cd", "EX", SENT); await quiet(kv("HDEL", rt, f)); return "cd"; }
    cdOk = true;
    const n = await kv("INCR", cnt); qOk = true; if (n === 1) await kv("EXPIRE", cnt, SENT);
    if (n > DAY_MAX) { await kv("DECR", cnt); qOk = false; await relCd(); cdOk = false; await kv("SET", sk, "skip:quota", "EX", SENT); await quiet(kv("HDEL", rt, f)); return "quota"; }
  } catch { // KV 出錯：還沒送，佔住的都放掉；處理鎖也放掉，下一輪（升級或在重試名單時）才會再試
    if (qOk) await quiet(kv("DECR", cnt)); if (cdOk) await quiet(relCd()); await quiet(kv("DEL", sk)); return "kverr";
  }
  try { await send(); }
  catch (x) {
    await quiet(kv("DECR", cnt)); await quiet(relCd());
    let t = TRIES; try { t = await kv("HINCRBY", rt, f, 1); await kv("EXPIRE", rt, SENT); } catch {}
    if (t >= TRIES) { await quiet(kv("SET", sk, "fail", "EX", SENT)); await quiet(kv("HDEL", rt, f)); return "fail"; }
    await quiet(kv("DEL", sk)); return "retry";
  }
  // 送出去了：之後就算記錄失敗也不重送（處理鎖 2 分鐘後消失，但它不在重試名單、也不是新事件，不會再被挑出來）
  await quiet(kv("SET", sk, `ok:${now}`, "EX", SENT)); await quiet(kv("HDEL", rt, f));
  return "ok";
}

const KEY_RUNS = date => `${monKey(date)}:runs`;
async function runMark(kv, date, now, fields) { const rk = KEY_RUNS(date); await kv("HSET", rk, ...Object.entries(fields).flat()); await kv("EXPIRE", rk, KEEP); }

// 一次巡檢。deps 可換掉（測試用）：kv、tg、quotes(codes) → [quote]、holidays() → 證交所休市日表（[{ date, name }]，拿不到就 null）、now
export async function runOnce({ kv, tg, quotes, holidays, now = Date.now(), force = false, extra = [], log = console.log } = {}) {
  const { M, T } = engine(), date = twDate(now), at = new Date(now), rk = KEY_RUNS(date);
  Object.assign(T.TWHOL, { set: null, year: "", at: 0, failAt: 0, mark: null }); // 每次巡檢都重新判斷，不沿用上一次
  if (!force) {
    if (T.twDayState(at) === "closed") { log("週末，略過"); return { skipped: "weekend" }; }
    if (T.mktSession(at) !== "open") { log("不在交易時段（09:00–13:35），略過"); return { skipped: "session" }; }
    let hol = null; try { hol = await holidays(); } catch (e) { log("::warning::休市日表拿不到：" + scrub(e)); }
    const day = T.twHolSet(hol, at) ? T.twDayState(at) : "unknown";
    if (day !== "trade") { log(day === "closed" ? "今天休市，略過" : "::warning::休市日表拿不到或格式不對，交易日待確認，略過（不抓報價）"); await runMark(kv, date, now, { skip: day, skipAt: now }); return { skipped: day }; }
  }
  // 使用者：有綁 Telegram、勾了盤中警示（alertDoc 的 ev.mon）
  const users = [];
  for (const h of (await kv("SMEMBERS", "alerts")) || []) { try { const d = JSON.parse((await kv("GET", `alert:${h}`)) || "null"); if (d?.chat && d.ev?.on?.includes("mon")) users.push([h, d]); } catch {} }
  const codes = [...new Set([...users.flatMap(([, d]) => d.ev.mon || []), ...extra])].filter(c => /^\d{4,6}[A-Z]?$/.test(c)).slice(0, 400), all = ["T00", ...codes];
  log("盤中警示的使用者", users.length, "人、巡檢", all.length, "檔");
  // 報價：一批失敗只影響那一批（那些代號算「沒有報價」）；加權那一批失敗＝整輪失敗
  const Q = new Map(), errs = [];
  for (let i = 0; i < all.length; i += BATCH) { try { for (const q of await quotes(all.slice(i, i + BATCH))) if (q?.code) Q.set(q.code, q); } catch (e) { errs.push(scrub(e)); } }
  const A = M.monAudit(Q, all, date, now);
  if (A.t00 === "notoday") { log("加權報價不是今天的（休市），略過"); await runMark(kv, date, now, { skip: "notoday", skipAt: now }); return { skipped: "notoday" }; }
  if (A.t00 !== "ok") { // 來源失敗或加權報價不能用：記一筆失敗、不產生事件（網頁上連續 3 次會顯示「伺服器巡檢中斷」）
    const err = errs[0] || `加權指數${M.MON_BAD[A.t00] || "報價無效"}`;
    await runMark(kv, date, now, { last: now, err }); await kv("HINCRBY", rk, "fail", 1); await kv("HINCRBY", rk, "streak", 1);
    log("::warning::這輪不判斷：" + err); return { error: err, audit: A };
  }
  if (A.badN) log("::warning::部分報價有問題：" + M.monAuditTxt(A));
  const E = Object.fromEntries(Object.entries(hashObj(await kv("HGETALL", monKey(date)))).map(([k, v]) => { try { return [k, JSON.parse(v)]; } catch { return [k, null]; } }).filter(x => x[1]));
  const prev = E.__px ? E.__px.T00 : null; delete E.__px;
  const names = Object.assign({}, ...users.map(([, d]) => d.names || {}));
  const up = M.monMerge(E, M.monScan(Q, { today: date, codes: codes.map(c => ({ c })), prevPx: prev != null ? { T00: prev } : null, names, now }), now); // monScan 只用通過 monCheck 的報價
  for (const e of up) e.origin = "server";
  // 通知：這輪新開或升級的警示，加上之前送失敗、還在重試名單裡的（同一件、同一等級）
  const out = [], touched = new Set(up.map(e => e.id)), stat = {};
  for (const [h, d] of users) {
    const mine = e => e.code === "T00" || (d.ev.mon || []).includes(e.code);
    let retry = []; try { retry = Object.keys(hashObj(await kv("HGETALL", `monretry:${h}:${date}`))).map(f => { const i = f.lastIndexOf("|"); return E[f.slice(0, i)]?.level === +f.slice(i + 1) ? E[f.slice(0, i)] : null; }).filter(Boolean); } catch {}
    for (const e of [...new Set([...up, ...retry])].filter(e => e.sev === "alert" && mine(e))) {
      const text = `🚨 盤中警示 ${M.monTime(now).slice(0, 5)}\n${e.title}\n${e.msg}\n\n伺服器每 5–15 分鐘巡檢一次，行情達到條件不代表原因，也不是買賣建議。`;
      let err = "";
      const r = await monNotify(kv, h, e, date, async () => { try { await tg("sendMessage", { chat_id: d.chat, text }); } catch (x) { err = scrub(x); throw x; } }, now);
      stat[r] = (stat[r] || 0) + 1;
      if (r === "ok" || r === "retry" || r === "fail") { const n = e.notified.find(x => x.ch === "tg" && x.at === now) || (e.notified.push({ ch: "tg", at: now, ok: false, n: 0 }), e.notified.at(-1)); if (r === "ok") { n.ok = true; n.n++; out.push([h.slice(0, 8), text]); } else n.err = err || "送出失敗"; touched.add(e.id); }
    }
  }
  // 存回去：這輪新開、升級或通知狀態有變的事件，加上給下一輪判斷「穿越」用的上一輪價格
  const pairs = [...[...touched].flatMap(id => [id, JSON.stringify(E[id])]), "__px", JSON.stringify({ T00: Q.get("T00").price })];
  await kv("HSET", monKey(date), ...pairs); await kv("EXPIRE", monKey(date), KEEP);
  await runMark(kv, date, now, { last: now, lastOk: now, streak: 0, err: "", badN: A.badN, badTxt: A.badN ? M.monAuditTxt(A).slice(0, 80) : "" }); await kv("HINCRBY", rk, "ok", 1);
  log("事件", up.length, "件（新開或升級）、送出", out.length, "則", JSON.stringify(stat));
  return { up, sent: out, audit: A, stat };
}

export async function main() {
  const DRY = process.argv.includes("--dry"), force = process.argv.includes("--force");
  if (!DRY && (!kvOn() || !process.env.TELEGRAM_BOT_TOKEN)) { console.log("::warning::沒有設定雲端儲存（KV_REST_API_URL）或 TELEGRAM_BOT_TOKEN，略過盤中巡檢"); return; }
  const kv = DRY ? memKv(kvOn() ? kvReal : null) : kvReal;
  const tg = DRY ? async (m, b) => console.log("[dry] 會送出：", String(b.chat_id).slice(0, 3) + "…", "\n" + b.text) : tgReal;
  const quotes = async codes => { const j = await callApi(import("../api/_lib/quote.js"), { codes: codes.join(","), src: "mis" }); if (!j?.ok) throw new Error(j?.error || "報價失敗"); return j.quotes; };
  const holidays = async () => { const j = await callApi(import("../api/_lib/calendar.js"), { hol: "1" }); return j?.holOk ? j.hol : null; };
  const r = await runOnce({ kv, tg, quotes, holidays, force, extra: DRY ? String(arg("codes") || "").split(",").filter(Boolean) : [] });
  if (DRY) for (const e of r.up || []) console.log(`[dry] ${e.sev} ${e.id}：${e.title}／${e.msg}`);
}
// 任何錯誤都只印 warning、以成功結束：巡檢失敗不能讓排程一直紅（失敗次數記在 KV，網頁上看得到）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::盤中巡檢這次沒有完成：" + scrub(e)); process.exitCode = 0; });
