/* ================= 情報局「盤中監控」（M1：這個頁面開著、在前景時才偵測） =================
   偵測規則與事件模型都是純函式（monScan、monMerge…），伺服器巡檢（M2：scripts/monitor.mjs 透過 scripts/_engine.mjs）用同一套；畫面在 monPage。
   範圍：大盤漲跌門檻、自選＋台股庫存的漲跌幅與漲跌停、今日市場的推估關鍵價位、既有到價提醒與指標提醒（只記錄，通知照原本的）、資料過期／來源失敗。
   事件 id＝交易日:類型:代號:方向，同一件事升級（例如跌 1% → 跌 2%）只更新 level，不會再開一件；資料過期時不判斷，避免不可靠的警示。
   事件存在這台瀏覽器（kline:watch:mon:v1:YYYY-MM-DD），每天最多 200 件、只留 20 天、不雲端同步（tools.js 的 SYNC_SKIP）。 */
const MON_MAX = 200, MON_KEEP = 20, MON_SNAPS = 20, MON_STALE = 180e3; // 報價超過 3 分鐘沒更新＝過期
const MON_LV = { IDX: [1, 2, 3], SYM: [5, 7] }; // 大盤 ±1/2/3%、個股 ±5/7%（漲跌停另外判斷）
const MON_SYM_SEV = ["watch", "alert", "alert"]; // 個股：5% 注意、7% 和漲跌停是警示（會推播）
const MON_SEV = ["info", "watch", "alert"], MON_SEV_TXT = { info: "● 留意", watch: "▲ 注意", alert: "■ 警示" };
const monKey = d => `watch:mon:v1:${d}`;
const monTime = t => new Date(t + 8 * 3600e3).toISOString().slice(11, 19); // 台灣時間 HH:MM:SS
// 報價可不可以拿來判斷：回傳 "ok" 或問題代碼。價格與昨收要是正數、不是估價、日期是今天、有時間而且 3 分鐘內（網頁與伺服器巡檢共用）
const MON_BAD = { missing: "沒有報價", price: "價格無效", estimated: "只有估價", nodate: "缺日期", notoday: "不是今天的", notime: "缺時間", stale: "超過 3 分鐘沒更新" };
function monCheck(q, today, now = Date.now()) {
  if (!q) return "missing";
  const pos = v => typeof v === "number" && isFinite(v) && v > 0;
  if (!pos(q.price) || !pos(q.prev)) return "price";
  if (q.estimated) return "estimated";
  if (!q.date) return "nodate";
  if (q.date !== today) return "notoday";
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(q.time || ""); if (!m) return "notime";
  if (now - (Date.parse(`${today}T00:00:00+08:00`) + ((+m[1] * 60 + +m[2]) * 60 + +(m[3] || 0)) * 1e3) > MON_STALE) return "stale";
  return "ok";
}
const monFresh = (q, today, now = Date.now()) => monCheck(q, today, now) === "ok";
// 一輪報價的完整度：哪些代號不能用、為什麼（不能用的不判斷，也不能當成「沒有事件」）
function monAudit(Q, codes, today, now = Date.now()) {
  const bad = {}; let ok = 0;
  for (const c of codes) { const r = monCheck(Q.get(c), today, now); if (r === "ok") ok++; else (bad[r] ||= []).push(c); }
  return { n: codes.length, ok, badN: codes.length - ok, bad, t00: codes.includes("T00") ? monCheck(Q.get("T00"), today, now) : null };
}
const monAuditTxt = a => Object.entries(a?.bad || {}).map(([k, L]) => `${MON_BAD[k] || k} ${L.length} 檔`).join("、");
// 一輪偵測：Q＝報價 Map（代號 → quote）、ctx＝{ today, codes: [{ c, hold }]（沒給 hold＝伺服器巡檢，標題不分庫存／自選）, plan（今日市場的推演快照）, prevPx（上一輪的價格）, names, now }
// 回傳候選事件 [{ id, type, code, dir, level, sev, title, msg, px, pct }]，還沒有和既有事件合併
function monScan(Q, ctx) {
  const out = [], { today, now = Date.now() } = ctx, nm = c => ctx.names?.[c] || Q.get(c)?.name || c, pc = v => `${v > 0 ? "+" : ""}${(+v).toFixed(2)}%`;
  const t0 = Q.get("T00");
  if (monFresh(t0, today, now) && t0.chgPct != null) {
    const a = Math.abs(t0.chgPct), lv = MON_LV.IDX.filter(x => a >= x).length, dir = t0.chgPct >= 0 ? "up" : "dn";
    if (lv) out.push({ id: `${today}:IDX:T00:${dir}`, type: "IDX", code: "T00", dir, level: lv, sev: MON_SEV[lv - 1], title: `加權指數${dir === "up" ? "漲" : "跌"}超過 ${MON_LV.IDX[lv - 1]}%`, msg: `加權 ${fmtP(t0.price)}（${pc(t0.chgPct)}）`, px: t0.price, pct: t0.chgPct });
    const kl = ctx.plan?.tradeDate === today ? ctx.plan.keyLevels : null, from = ctx.prevPx?.T00 ?? t0.open; // 只用今天的推演；「穿越」＝上一輪（沒有就用開盤價）在另一邊
    if (kl) for (const [k, v, d, txt] of [["pivot", kl.pivot, "dn", "跌破分水嶺"], ["pivot", kl.pivot, "up", "站上分水嶺"], ["support", kl.support, "dn", "跌破支撐"], ["pressure", kl.pressure, "up", "突破壓力"]])
      if (v && from != null && (d === "dn" ? t0.price < v && from >= v : t0.price > v && from <= v)) out.push({ id: `${today}:LEVEL:T00:${k}-${d}`, type: "LEVEL", code: "T00", dir: d, lv: v, level: 1, sev: k === "pivot" ? "info" : "watch", title: `加權${txt}（推估價位 ${v.toLocaleString()}）`, msg: `加權 ${fmtP(t0.price)}；價位是盤前推估，不是買賣建議`, px: t0.price, pct: t0.chgPct });
  }
  for (const { c, hold } of ctx.codes || []) {
    const q = Q.get(c); if (!monFresh(q, today, now) || q.chgPct == null || !q.prev) continue;
    const a = Math.abs(q.chgPct), dir = q.chgPct >= 0 ? "up" : "dn", who = hold == null ? "" : hold ? "庫存 " : "自選 ";
    const [lu, ld] = typeof twLimits === "function" ? twLimits(q.prev, /^00/.test(c)) : [null, null], lim = dir === "up" ? lu && q.price >= lu : ld && q.price <= ld;
    const lv = lim ? 3 : MON_LV.SYM.filter(x => a >= x).length;
    if (lv) out.push({ id: `${today}:SYM:${c}:${dir}`, type: "SYM", code: c, dir, level: lv, sev: MON_SYM_SEV[lv - 1], title: `${who}${nm(c)} ${lim ? (dir === "up" ? "漲停" : "跌停") : `${dir === "up" ? "漲" : "跌"}超過 ${MON_LV.SYM[lv - 1]}%`}`, msg: `${nm(c)} ${c} ${fmtP(q.price)}（${pc(q.chgPct)}）`, px: q.price, pct: q.chgPct });
  }
  return out;
}
// 候選事件併進今天的事件表 E（{ id: 事件 }）：新的開一件、同一件升級只更新 level 並加一筆快照；回傳這輪「新開或升級」的事件（要不要通知由呼叫的人決定）
function monMerge(E, cand, now = Date.now()) {
  const up = [];
  for (const x of cand) {
    const e = E[x.id], snap = { at: now, px: x.px, pct: x.pct };
    if (!e) { if (Object.keys(E).length >= MON_MAX) continue; E[x.id] = { ...x, first: now, last: now, state: "open", snaps: [snap], notified: [], origin: "client" }; up.push(E[x.id]); continue; }
    if (x.level > e.level) { Object.assign(e, { level: x.level, sev: x.sev, title: x.title, msg: x.msg, px: x.px, pct: x.pct, last: now }); e.snaps.push(snap); if (e.snaps.length > MON_SNAPS) e.snaps.splice(0, e.snaps.length - MON_SNAPS); up.push(e); }
  }
  return up;
}
// 既有提醒（到價、指標）觸發時記成事件：通知已經由原本的提醒送出，這裡只記錄
function monRule(E, today, code, title, msg, now = Date.now()) {
  const id = `${today}:RULE:${code}:${title}`; if (E[id] || Object.keys(E).length >= MON_MAX) return null;
  return (E[id] = { id, type: "RULE", code, dir: "", level: 1, sev: "watch", title, msg, first: now, last: now, state: "open", snaps: [], notified: [{ ch: "local", at: now, ok: true, via: "原本的提醒" }], origin: "client" });
}
// 資料異常：來源連續失敗或報價過期（只記一件，恢復後關閉）
function monData(E, today, bad, msg, now = Date.now()) {
  const id = `${today}:DATA:src:fail`, e = E[id];
  if (bad && !e) { if (Object.keys(E).length >= MON_MAX) return null; return (E[id] = { id, type: "DATA", code: "", dir: "", level: 1, sev: "watch", title: "報價來源異常", msg, first: now, last: now, state: "open", snaps: [], notified: [], origin: "client" }); }
  if (bad && e) { e.msg = msg; e.last = now; if (e.state === "closed") e.state = "open"; return null; }
  if (!bad && e && e.state === "open") { e.state = "closed"; e.last = now; e.msg += "（已恢復）"; }
  return null;
}
// 通知節流：只推「警示」等級、同一檔 15 分鐘最多一則、每天最多 20 則（和未來 Telegram 的規格一致）
function monShouldNotify(e, E, now = Date.now()) {
  if (e.sev !== "alert") return false;
  const sent = Object.values(E).flatMap(x => x.notified.filter(n => n.ok && n.ch === "local" && !n.via).map(n => ({ ...n, code: x.code })));
  if (sent.length >= 20) return false;
  return !sent.some(n => n.code === e.code && now - n.at < 15 * 60e3);
}
// 短代號（網址 #monitor/xxxxxxxx 用）
const monHash = id => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, "0"); };
// 清理：只刪鍵名完全符合 kline:watch:mon:v1:YYYY-MM-DD、超過 20 天的
/* ---------- 盤後驗證與歷史（只在這台瀏覽器，用日 K 的收盤檢查事件事後怎麼走） ----------
   大盤、個股：觸發價（第一筆快照）往同方向收得更遠＝延續；收在昨收和觸發價之間＝回吐；收到昨收的另一邊＝反轉。
   關鍵價位：收盤仍在突破／跌破的那一邊＝守住；收回來＝收回（假突破、假跌破）。提醒、資料事件不驗證。
   只是事後統計，幫忙調整門檻、判斷通知值不值得看，不是預測。 */
const MON_VERDICT = { cont: ["延續", "收盤比觸發時走得更遠"], fade: ["回吐", "收盤回到昨收和觸發價之間"], rev: ["反轉", "收盤跑到昨收的另一邊"], hold: ["守住", "收盤仍在突破／跌破的那一邊"], fail: ["收回", "收盤收回價位另一邊（假突破／假跌破）"] };
const MON_VTYPES = ["IDX", "SYM", "LEVEL"];
function monVerify(e, close) {
  if (!e || !MON_VTYPES.includes(e.type) || !(close > 0)) return null;
  const up = e.dir === "up";
  if (e.type === "LEVEL") {
    const lv = +e.lv || +((/推估價位 ([\d,.]+)/.exec(e.title || "") || [])[1] || "").replace(/,/g, ""); if (!(lv > 0)) return null;
    return { res: (up ? close > lv : close < lv) ? "hold" : "fail", close, lv };
  }
  const s0 = e.snaps?.[0] || e, px = +s0.px, pct = +s0.pct; if (!(px > 0) || !isFinite(pct) || pct <= -100) return null;
  const prev = px / (1 + pct / 100), cp = (close / prev - 1) * 100;
  const res = up ? (close >= px ? "cont" : close > prev ? "fade" : "rev") : (close <= px ? "cont" : close < prev ? "fade" : "rev");
  return { res, close, pct: Math.round(cp * 100) / 100 };
}
// 一天的事件表 E 用收盤表 closes（代號 → 收盤）驗證；已驗證的不重算。回傳這次新驗證幾件
function monVerifyDay(E, closes, now = Date.now()) {
  let n = 0;
  for (const e of Object.values(E || {})) { if (e.verify || !MON_VTYPES.includes(e.type)) continue; const v = monVerify(e, closes?.[e.code]); if (v) { e.verify = { ...v, at: now }; n++; } }
  return n;
}
// 多天的統計：days＝[{ d, E }]；回傳總件數、各類型件數與驗證結果、反轉／收回比例（樣本太少時 rate 是 null）
function monStats(days) {
  const T = { IDX: {}, SYM: {}, LEVEL: {}, RULE: {}, DATA: {} }, add = (o, k) => (o[k] = (o[k] || 0) + 1);
  let n = 0, alert = 0;
  for (const { E } of days || []) for (const e of Object.values(E || {})) { n++; if (e.sev === "alert") alert++; const t = T[e.type] || (T[e.type] = {}); add(t, "n"); if (e.verify) { add(t, "v"); add(t, e.verify.res); } }
  const rate = (t, bad) => (t.v >= 5 ? (t[bad] || 0) / t.v : null);
  return { days: (days || []).length, n, alert, T, revRate: { IDX: rate(T.IDX, "rev"), SYM: rate(T.SYM, "rev"), LEVEL: rate(T.LEVEL, "fail") } };
}
function monGc(now = Date.now(), ls = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!ls) return 0; const cut = new Date(now + 8 * 3600e3 - MON_KEEP * 864e5).toISOString().slice(0, 10), old = [];
  try { for (let i = 0; i < ls.length; i++) { const m = /^kline:watch:mon:v1:(\d{4}-\d{2}-\d{2})$/.exec(ls.key(i) || ""); if (m && m[1] < cut) old.push(m[0]); } old.forEach(k => ls.removeItem(k)); } catch {}
  return old.length;
}
// 監控狀態：區分「監控中」「暫停（切走、背景）」「未開盤／休市」「不知道有沒有開盤」「來源失敗」「資料過期」
function monStatus({ day, sess, hidden, err, staleN, audit, lastOk, now = Date.now() }) {
  if (audit?.badN && day === "trade" && sess === "open" && !hidden && !err) return ["stale", `${audit.t00 && audit.t00 !== "ok" ? `加權指數報價${MON_BAD[audit.t00]}，大盤先不判斷；` : ""}${audit.badN}／${audit.n} 檔報價有問題（${monAuditTxt(audit)}），這些先不判斷，不代表它們沒有事件`];
  if (day === "closed") return ["closed", "今天休市，不監控"];
  if (day === "unknown") return ["unknown", "還不能確認今天有沒有開盤（休市日表抓不到），先不監控"];
  if (sess !== "open") return ["closed", sess === "pre" ? "試撮中，09:00 開盤後開始監控" : "不在交易時段（09:00–13:30），不監控"];
  if (hidden) return ["paused", "畫面切走或在背景，監控暫停；回到情報局或看盤就繼續"];
  if (err) return ["error", `報價來源失敗：${err}`];
  if (staleN) return ["stale", `有 ${staleN} 檔報價超過 3 分鐘沒更新，這些先不判斷`];
  if (!lastOk) return ["loading", "第一次抓報價中…"];
  return ["on", "監控中（這個頁面開著、在前景時才偵測，關掉就停）"];
}
// 伺服器巡檢（scripts/monitor.mjs）的事件併進這台的事件表：沒有的加進來、等級比較高的升級；回傳變動幾件
function monSrvMerge(E, list) {
  let n = 0;
  for (const s of Array.isArray(list) ? list : []) {
    if (!s?.id || typeof s.id !== "string" || !MON_SEV.includes(s.sev)) continue; const e = E[s.id];
    if (!e) { if (Object.keys(E).length >= MON_MAX) continue; E[s.id] = { ...s, snaps: (s.snaps || []).slice(-MON_SNAPS), notified: s.notified || [], origin: "server" }; n++; }
    else if (s.level > e.level) { Object.assign(e, { level: s.level, sev: s.sev, title: s.title, msg: s.msg, px: s.px, pct: s.pct, last: s.last }); n++; }
  }
  return n;
}
// 伺服器巡檢的狀態：沒有今天的執行紀錄＝沒在跑；連續 3 次失敗＝中斷；超過 20 分鐘沒跑＝延遲（GitHub 排程常會晚幾分鐘）
// 略過（休市、交易日待確認、加權報價不是今天）的紀錄比最後一次巡檢新時，顯示略過的原因；部分報價有問題時寫出檔數
const MON_SKIP = { closed: "今天休市", unknown: "休市日表拿不到，交易日待確認", notoday: "加權報價不是今天的（可能臨時休市）" };
function monSrvState(runs, now = Date.now()) {
  if (runs?.skipAt && !(runs.last > runs.skipAt)) return ["skip", `伺服器巡檢暫停：${MON_SKIP[runs.skip] || runs.skip}（${monTime(runs.skipAt)}）`];
  if (!runs?.last) return ["off", "伺服器巡檢今天沒有執行：只有這個頁面開著時偵測"];
  if (runs.streak >= 3) return ["down", `伺服器巡檢中斷（連續 ${runs.streak} 次失敗${runs.err ? `：${runs.err}` : ""}${runs.lastOk ? `；最後成功 ${monTime(runs.lastOk)}` : ""}）`];
  if (now - runs.last > 20 * 60e3) return ["late", `伺服器巡檢延遲：最後一次 ${monTime(runs.last)}`];
  if (runs.streak) return ["fail", `伺服器巡檢最近一次失敗（${runs.err || "報價拿不到"}）${runs.lastOk ? `，最後成功 ${monTime(runs.lastOk)}` : ""}`];
  if (runs.badN) return ["partial", `伺服器巡檢 ${monTime(runs.last)}：${runs.badN} 檔報價有問題（${runs.badTxt || "資料不完整"}），這些沒有判斷`];
  return ["ok", `伺服器巡檢正常：最後一次 ${monTime(runs.last)}（約每 5–15 分鐘）`];
}

/* ---------- 網頁：每 20 秒抓一次「大盤＋自選＋台股庫存」的報價（不放進每秒的報價更新），偵測、存檔、通知 ---------- */
const MON_EVERY = 20e3, MON_BATCH = 40; // /api/quote?src=mis 一次最多 40 檔（api/_lib/quote.js），超過就分批
const monE = d => (W.monE?.d === d ? W.monE.E : (W.monE = { d, E: store.get(monKey(d), null)?.ev || {} }).E);
const monSave = d => store.set(monKey(d), { v: 1, ev: monE(d) });
// 要監控的代號：自選（全部清單）＋庫存（台股、不含範例），去重；大盤另外算
function monCodes() {
  const hold = Object.keys(W.hold || {}).filter(c => !W.hold[c]?.demo && isTW(c)), mine = myCodes().filter(isTW), seen = new Set();
  return [...hold.map(c => ({ c, hold: true })), ...mine.map(c => ({ c, hold: false }))].filter(x => !seen.has(x.c) && seen.add(x.c));
}
const monHidden = () => document.visibilityState === "hidden" || (typeof frameOff === "function" && frameOff());
async function monTick(now = Date.now()) {
  const M = (W.mon ||= { okAt: 0, err: null, fails: 0, prevPx: {}, staleN: 0 }), day = twDayState(), sess = mktSession();
  M.at = now; if (day !== "trade" || sess !== "open" || monHidden() || W.off) return M;
  const today = W.today || twDay(), codes = monCodes(), all = ["T00", ...codes.map(x => x.c)];
  try {
    for (let i = 0; i < all.length; i += MON_BATCH) { const j = await getJ(`/api/quote?codes=${all.slice(i, i + MON_BATCH).map(encodeURIComponent).join(",")}&src=mis`); j.quotes.forEach(q => W.quotes.set(q.code, q)); }
    Object.assign(M, { okAt: Date.now(), err: null, fails: 0 });
  } catch (e) { M.err = e.message || "報價拿不到"; M.fails++; }
  const E = monE(today), Q = W.quotes;
  M.audit = monAudit(Q, all, today, now); M.staleN = M.audit.badN; M.n = all.length; // 沒抓到、過期、不是今天的…都算，畫面上寫出檔數
  monData(E, today, M.fails >= 2, M.err || "", now); // 連續兩次失敗才記一件，恢復後自動關閉
  if (!M.err) {
    const up = monMerge(E, monScan(Q, { today, codes, plan: typeof getBriefSnapshot === "function" ? getBriefSnapshot(today) : null, prevPx: M.prevPx, names: W.names, now }), now);
    for (const e of up) if (monShouldNotify(e, E, now)) { notify(e.title, e.msg); e.notified.push({ ch: "local", at: now, ok: true }); }
    M.prevPx = { T00: Q.get("T00")?.price };
  }
  for (const x of (W.irLog ||= store.get("watch:irlog", []) || []).filter(x => x.d === today)) monRule(E, today, x.code, `指標提醒：${nameOf(x.code)} ${x.code}`, x.msg, now); // 指標提醒（tools.js 每 5 分鐘檢查、已經通知過）
  if (!(M.srvAt > now - MON_SRV_EVERY)) { M.srvAt = now; await monSrvPull(today, E); }
  monSave(today); if (W.lt === "mon") renderList(); return M;
}
// 伺服器巡檢的事件（/api/sync?op=mon），2 分鐘拿一次；拿不到就算了，這台照樣自己偵測
const MON_SRV_EVERY = 120e3;
async function monSrvPull(d, E) {
  try { const j = await getJ(`/api/sync?op=mon&date=${d}`); if (!j?.ok || !j.kv) return; W.mon.runs = j.runs || null; monSrvMerge(E, j.events); } catch {}
}
// 一打開清一次 20 天前的事件
function monLoop() { clearTimeout(W.monTimer); if (!W.monGcAt) { W.monGcAt = Date.now(); monGc(); } if (W.off) return; W.monTimer = setTimeout(() => monTick().finally(monLoop), MON_EVERY); }
// 到價提醒觸發時記一件（通知已經由 checkAlerts 送出）
function monAlertHit(c, title, msg) { const d = W.today || twDay(); if (monRule(monE(d), d, c, title, msg)) monSave(d); }
function monState() { const M = W.mon || {}; return monStatus({ day: twDayState(), sess: mktSession(), hidden: monHidden(), err: M.fails ? M.err : null, staleN: M.staleN, audit: M.err ? null : M.audit, lastOk: M.okAt }); }
// 這台瀏覽器存了哪幾天的事件（新的在前）；今天用記憶體裡的那份
function monDays() {
  const out = []; try { for (let i = 0; i < localStorage.length; i++) { const m = /^kline:watch:mon:v1:(\d{4}-\d{2}-\d{2})$/.exec(localStorage.key(i) || ""); if (m) out.push(m[1]); } } catch {}
  return [...new Set(out)].sort().reverse();
}
const monDayE = d => (d === (W.today || twDay()) ? monE(d) : store.get(monKey(d), null)?.ev || {});
const monDaySave = (d, E) => (d === (W.today || twDay()) ? monSave(d) : store.set(monKey(d), { v: 1, ev: E }));
// 今天收盤（13:35）以後才驗證今天；用日 K 那天的收盤，日 K 還沒有那天就下次再驗
function monVerifyDue(d, now = Date.now()) { const t = W.today || twDay(); return d < t || (d === t && twDayState() === "trade" && new Date(now + 8 * 3600e3).toISOString().slice(11, 16) >= "13:35"); }
async function monVerifyRun() {
  if (W.monV?.busy || W.off) return; W.monV = { busy: true }; let n = 0, miss = 0;
  try {
    const days = monDays().filter(d => monVerifyDue(d)), need = new Map();
    for (const d of days) for (const e of Object.values(monDayE(d))) if (!e.verify && MON_VTYPES.includes(e.type)) need.set(e.code, [...(need.get(e.code) || []), d]);
    const K = (W.monK ||= {});
    for (const c of need.keys()) if (!K[c]) { try { K[c] = (await getJ(`/api/kline?code=${c === "T00" ? encodeURIComponent("加權") : encodeURIComponent(c)}&months=2`))?.data || []; } catch { K[c] = null; } }
    for (const d of days) {
      const E = monDayE(d), closes = {};
      for (const c of new Set(Object.values(E).map(e => e.code))) { const b = (K[c] || []).find(x => String(x.d).slice(0, 10) === d); if (b?.c > 0) closes[c] = b.c; }
      const k = monVerifyDay(E, closes); if (k) { n += k; monDaySave(d, E); }
      miss += Object.values(E).filter(e => !e.verify && MON_VTYPES.includes(e.type)).length;
    }
    W.monV = { at: Date.now(), n, miss };
  } catch (e) { W.monV = { err: e.message || "驗證失敗", at: Date.now() }; }
  if (W.lt === "mon") renderList();
}
const monVPill = e => (e.verify ? `<span class="mon-v ${e.verify.res}" title="${esc(MON_VERDICT[e.verify.res][1])}">盤後：${MON_VERDICT[e.verify.res][0]}${e.verify.pct != null ? ` ${e.verify.pct >= 0 ? "+" : ""}${e.verify.pct.toFixed(2)}%` : ""}</span>` : "");
function monHistHtml() {
  const t = W.today || twDay(), days = monDays().slice(0, MON_KEEP), D = days.map(d => ({ d, E: monDayE(d) })), S = monStats(D), V = W.monV;
  if (!V && !W.off) setTimeout(monVerifyRun, 0);
  const pc = r => (r == null ? "—" : `${Math.round(r * 100)}%`), T = S.T, vn = k => T[k].v || 0;
  const cards = [["事件", S.n, `近 ${S.days} 天・警示 ${S.alert} 件`], ["大盤反轉", pc(S.revRate.IDX), `已驗證 ${vn("IDX")} 件・延續 ${T.IDX.cont || 0}・回吐 ${T.IDX.fade || 0}`], ["個股反轉", pc(S.revRate.SYM), `已驗證 ${vn("SYM")} 件・延續 ${T.SYM.cont || 0}・回吐 ${T.SYM.fade || 0}`], ["價位收回", pc(S.revRate.LEVEL), `已驗證 ${vn("LEVEL")} 件・守住 ${T.LEVEL.hold || 0}`]];
  const open = W.monHd ?? days[0];
  const day = ({ d, E }) => { const L = Object.values(E).sort((a, b) => a.first - b.first), al = L.filter(e => e.sev === "alert").length;
    return `<li class="mon-day"><button type="button" class="mon-dh" data-mond="${d}" aria-expanded="${d === open}"><b>${d.slice(5).replace("-", "/")}${d === t ? "（今天）" : ""}</b><span class="note">${L.length} 件${al ? `・警示 ${al}` : ""}${L.some(e => e.verify) ? `・已驗證 ${L.filter(e => e.verify).length}` : ""}</span></button>
      ${d === open ? (L.length ? `<ul class="mon-list">${L.map(e => `<li><button type="button" class="mon-ev ${e.sev}" data-mon="${monHash(e.id)}" data-mon-d="${d}"><span class="mon-sev">${MON_SEV_TXT[e.sev]}</span><b>${esc(e.title)}</b><span class="note">${esc(e.msg)}</span><span class="note mon-t">${monTime(e.first)}</span>${monVPill(e)}</button></li>`).join("")}</ul>` : `<p class="note">這天沒有事件。</p>`) : ""}</li>`; };
  return `<div class="qx-cards mon-stats">${cards.map(([k, v, s]) => `<div class="qx-card"><span class="note">${k}</span><b class="num">${v}</b><span class="note">${s}</span></div>`).join("")}</div>
    <p class="note">${V?.busy ? "用日 K 收盤驗證中…" : V?.err ? `驗證失敗：${esc(V.err)}` : V ? `盤後驗證：這次新驗證 ${V.n} 件${V.miss ? `，${V.miss} 件還沒有那天的日 K（收盤後資料更新了再驗）` : ""}。` : ""} 反轉／收回比例在已驗證滿 5 件時才算。${days.length ? "" : "這台瀏覽器還沒有事件紀錄。"} <button type="button" class="linkbtn" data-monvr>重新驗證</button></p>
    ${days.length ? `<ul class="mon-days">${D.map(day).join("")}</ul>` : ""}
    <details class="dh-more"><summary>盤後驗證怎麼算</summary><p class="note">${Object.values(MON_VERDICT).map(([a, b]) => `${a}：${b}`).join("；")}。用那天日 K 的收盤，和觸發當下的價格、昨收比較（昨收由觸發時的漲跌幅換算）。事件只存在這台瀏覽器 ${MON_KEEP} 天，不同步到其他裝置。只是事後統計，不是預測，也不是買賣建議。</p></details>`;
}
function monPage() {
  const d = W.today || twDay(), E = monE(d), L = Object.values(E).sort((a, b) => (a.state === "open") - (b.state === "open") || b.last - a.last).reverse(), [st, txt] = monState(), M = W.mon || {}, codes = monCodes();
  const empty = { on: "今天目前沒有觸發事件（監控正常）。", loading: "第一次抓報價中…", paused: "監控暫停中，這段時間沒有偵測。", closed: "現在不在交易時段，沒有監控。", unknown: "還不能確認今天有沒有開盤，先不監控。", error: "報價來源失敗，現在沒有資料——不代表沒有事件。", stale: "部分報價有問題（見上方），這些代號先不判斷——不代表沒有事件。" }[st];
  const row = e => `<li><button type="button" class="mon-ev ${e.sev}${e.state === "closed" ? " done" : ""}" data-mon="${monHash(e.id)}"><span class="mon-sev">${MON_SEV_TXT[e.sev]}</span><b>${esc(e.title)}</b><span class="note">${esc(e.msg)}</span><span class="note mon-t">${e.origin === "server" ? "伺服器・" : ""}${monTime(e.first)}${e.snaps.length > 1 ? `・更新 ${e.snaps.length - 1} 次` : ""}${e.state === "closed" ? "・已結束" : ""}</span>${monVPill(e)}</button></li>`;
  const h = `<section class="csec mon">
    <div class="dh-status-bar"><div class="dh-sb-left"><span class="dh-badge mon-${st}">${{ on: "監控中", loading: "載入中", paused: "暫停", closed: "未開盤／休市", unknown: "交易日待確認", error: "來源失敗", stale: "資料不完整" }[st]}</span><span class="note">${esc(txt)}</span></div></div>
    <h3>盤中監控 <span class="note">${d.slice(5).replace("-", "/")}</span></h3>
    <div class="seg sm mon-vsel" role="group" aria-label="檢視">${[["today", "今天"], ["hist", "近 20 天與盤後驗證"]].map(([k, n]) => `<button type="button" data-monv="${k}" aria-pressed="${(W.monView || "today") === k}">${n}</button>`).join("")}</div>
    <p class="note mon-srv">${esc(monSrvState(M.runs)[1])}</p>
    <p class="note">監控範圍：大盤＋自選 ${codes.filter(x => !x.hold).length} 檔＋台股庫存 ${codes.filter(x => x.hold).length} 檔，每 20 秒一次${M.okAt ? `・最後成功 ${monTime(M.okAt)}` : ""}${M.fails ? `・連續失敗 ${M.fails} 次` : ""}。只推「■ 警示」到這台裝置（同一檔 15 分鐘最多一則、每天最多 20 則）；到價、指標提醒照原本的方式通知，這裡一起記錄。</p>
    ${W.monView === "hist" ? monHistHtml() : `${L.length ? `<ul class="mon-list">${L.map(row).join("")}</ul>` : `<p class="note mon-empty">${empty}</p>`}
    <details class="dh-more"><summary>怎麼判斷的</summary><p class="note">大盤漲跌超過 1%、2%、3%；自選與庫存漲跌超過 5%、7% 或漲跌停；加權穿越今日市場的推估分水嶺、支撐、壓力。同一檔同一方向一天只開一件，幅度變大時更新同一件。報價超過 3 分鐘沒更新、不是今天的、或只是估價時不判斷。事件只代表行情達到條件，不代表原因，也不是買賣建議。事件存在這台裝置 20 天，不會雲端同步。伺服器巡檢開著時，關掉頁面也會檢查（GitHub 排程，約每 5–15 分鐘），它找到的標「伺服器」；在「工具 → 提醒」勾「盤中警示」並綁定 Telegram，會收到「■ 警示」。</p></details>`}
  </section>`;
  return { h, note: "盤中監控只在這個頁面開著、在前景時偵測；關掉或切到 K線學堂、存股就暫停。" };
}
function monDetail(hash, day) {
  const d = day || W.today || twDay(), e = Object.values(monDayE(d)).find(x => monHash(x.id) === hash); if (!e) return toast("找不到這件事件（可能是別天的）");
  W.monSel = hash; navPush?.("replace");
  openSheet(`<h3>${esc(e.title)}</h3><p class="note">${MON_SEV_TXT[e.sev]}・${{ IDX: "大盤", SYM: "個股", LEVEL: "關鍵價位", RULE: "提醒", DATA: "資料" }[e.type] || e.type}・${monTime(e.first)} 開始${e.last !== e.first ? `・${monTime(e.last)} 更新` : ""}・${e.state === "closed" ? "已結束" : "進行中"}</p>
    <p>${esc(e.msg)}</p>
    ${e.snaps.length ? `<h4>當時的報價</h4><ul class="tlist">${e.snaps.map(s => `<li>${monTime(s.at)}　${fmtP(s.px)}　<span class="${cls(s.pct)}">${s.pct >= 0 ? "+" : ""}${(+s.pct).toFixed(2)}%</span></li>`).join("")}</ul>` : ""}
    ${e.verify ? `<h4>盤後驗證</h4><p>${monVPill(e)}<span class="note">收盤 ${fmtP(e.verify.close)}${e.verify.lv ? `，價位 ${(+e.verify.lv).toLocaleString()}` : ""}：${esc(MON_VERDICT[e.verify.res][1])}</span></p>` : MON_VTYPES.includes(e.type) ? `<p class="note">收盤後到「近 20 天與盤後驗證」會用日 K 收盤檢查這件事件後來怎麼走。</p>` : ""}
    <h4>通知</h4><p class="note">${e.notified.length ? e.notified.map(n => `${monTime(n.at)} ${n.via ? `由${n.via}通知` : n.ch === "tg" ? (n.ok ? `Telegram 推播 ${n.n || 1} 人` : `Telegram 失敗：${esc(n.err || "")}`) : n.ok ? "已通知這台裝置" : `通知失敗：${esc(n.err || "")}`}`).join("；") : "沒有通知（只推「■ 警示」等級）"}</p>
    ${e.code && e.code !== "T00" ? `<p><button type="button" class="btn sm" data-sel="${esc(e.code)}">看 ${esc(nameOf(e.code))} 個股頁 ›</button></p>` : ""}
    <p class="note">事件只代表行情達到條件，不代表原因，也不是買賣建議。</p>`, false);
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-l2mon]")) return setLt("mon");
  if (typeof W === "undefined" || W.lt !== "mon") return;
  const v = e.target.closest("[data-monv]"); if (v) { W.monView = v.dataset.monv; return renderList(); }
  const h = e.target.closest("[data-mond]"); if (h) { W.monHd = W.monHd === h.dataset.mond || (W.monHd == null && h.getAttribute("aria-expanded") === "true") ? "" : h.dataset.mond; return renderList(); }
  if (e.target.closest("[data-monvr]")) { W.monV = null; return monVerifyRun(); }
  const b = e.target.closest("[data-mon]"); if (b) monDetail(b.dataset.mon, b.dataset.monD);
});
