/* ================= 情報局「盤中監控」（M1：這個頁面開著、在前景時才偵測） =================
   偵測規則與事件模型都是純函式（monScan、monMerge…），排程（scripts/_engine.mjs）之後可以直接重用；畫面在 watch.html 的 monPage。
   範圍：大盤漲跌門檻、自選＋台股庫存的漲跌幅與漲跌停、今日市場的推估關鍵價位、既有到價提醒與指標提醒（只記錄，通知照原本的）、資料過期／來源失敗。
   事件 id＝交易日:類型:代號:方向，同一件事升級（例如跌 1% → 跌 2%）只更新 level，不會再開一件；資料過期時不判斷，避免不可靠的警示。
   事件存在這台瀏覽器（kline:watch:mon:v1:YYYY-MM-DD），每天最多 200 件、只留 20 天、不雲端同步（tools.js 的 SYNC_SKIP）。 */
const MON_MAX = 200, MON_KEEP = 20, MON_SNAPS = 20, MON_STALE = 180e3; // 報價超過 3 分鐘沒更新＝過期
const MON_LV = { IDX: [1, 2, 3], SYM: [5, 7] }; // 大盤 ±1/2/3%、個股 ±5/7%（漲跌停另外判斷）
const MON_SYM_SEV = ["watch", "alert", "alert"]; // 個股：5% 注意、7% 和漲跌停是警示（會推播）
const MON_SEV = ["info", "watch", "alert"], MON_SEV_TXT = { info: "● 留意", watch: "▲ 注意", alert: "■ 警示" };
const monKey = d => `watch:mon:v1:${d}`;
// 報價可不可以拿來判斷：今天的、有成交價、不是估價、3 分鐘內（盤中）
function monFresh(q, today, now = Date.now()) {
  if (!q || q.price == null || !isFinite(q.price) || q.estimated) return false;
  if (q.date && q.date !== today) return false;
  if (q.time && /^\d{2}:\d{2}/.test(q.time)) { const [h, m, s = 0] = q.time.split(":").map(Number), t = Date.parse(`${today}T00:00:00+08:00`) + ((h * 60 + m) * 60 + s) * 1e3; if (now - t > MON_STALE) return false; }
  return true;
}
// 一輪偵測：Q＝報價 Map（代號 → quote）、ctx＝{ today, codes: [{ c, hold }], plan（今日市場的推演快照）, prevPx（上一輪的價格）, names, now }
// 回傳候選事件 [{ id, type, code, dir, level, sev, title, msg, px, pct }]，還沒有和既有事件合併
function monScan(Q, ctx) {
  const out = [], { today, now = Date.now() } = ctx, nm = c => ctx.names?.[c] || Q.get(c)?.name || c, pc = v => `${v > 0 ? "+" : ""}${(+v).toFixed(2)}%`;
  const t0 = Q.get("T00");
  if (monFresh(t0, today, now) && t0.chgPct != null) {
    const a = Math.abs(t0.chgPct), lv = MON_LV.IDX.filter(x => a >= x).length, dir = t0.chgPct >= 0 ? "up" : "dn";
    if (lv) out.push({ id: `${today}:IDX:T00:${dir}`, type: "IDX", code: "T00", dir, level: lv, sev: MON_SEV[lv - 1], title: `加權指數${dir === "up" ? "漲" : "跌"}超過 ${MON_LV.IDX[lv - 1]}%`, msg: `加權 ${fmtP(t0.price)}（${pc(t0.chgPct)}）`, px: t0.price, pct: t0.chgPct });
    const kl = ctx.plan?.tradeDate === today ? ctx.plan.keyLevels : null, from = ctx.prevPx?.T00 ?? t0.open; // 只用今天的推演；「穿越」＝上一輪（沒有就用開盤價）在另一邊
    if (kl) for (const [k, v, d, txt] of [["pivot", kl.pivot, "dn", "跌破分水嶺"], ["pivot", kl.pivot, "up", "站上分水嶺"], ["support", kl.support, "dn", "跌破支撐"], ["pressure", kl.pressure, "up", "突破壓力"]])
      if (v && from != null && (d === "dn" ? t0.price < v && from >= v : t0.price > v && from <= v)) out.push({ id: `${today}:LEVEL:T00:${k}-${d}`, type: "LEVEL", code: "T00", dir: d, level: 1, sev: k === "pivot" ? "info" : "watch", title: `加權${txt}（推估價位 ${v.toLocaleString()}）`, msg: `加權 ${fmtP(t0.price)}；價位是盤前推估，不是買賣建議`, px: t0.price, pct: t0.chgPct });
  }
  for (const { c, hold } of ctx.codes || []) {
    const q = Q.get(c); if (!monFresh(q, today, now) || q.chgPct == null || !q.prev) continue;
    const a = Math.abs(q.chgPct), dir = q.chgPct >= 0 ? "up" : "dn", who = hold ? "庫存" : "自選";
    const [lu, ld] = typeof twLimits === "function" ? twLimits(q.prev, /^00/.test(c)) : [null, null], lim = dir === "up" ? lu && q.price >= lu : ld && q.price <= ld;
    const lv = lim ? 3 : MON_LV.SYM.filter(x => a >= x).length;
    if (lv) out.push({ id: `${today}:SYM:${c}:${dir}`, type: "SYM", code: c, dir, level: lv, sev: MON_SYM_SEV[lv - 1], title: `${who} ${nm(c)} ${lim ? (dir === "up" ? "漲停" : "跌停") : `${dir === "up" ? "漲" : "跌"}超過 ${MON_LV.SYM[lv - 1]}%`}`, msg: `${nm(c)} ${c} ${fmtP(q.price)}（${pc(q.chgPct)}）`, px: q.price, pct: q.chgPct });
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
  const sent = Object.values(E).flatMap(x => x.notified.filter(n => n.ok && !n.via).map(n => ({ ...n, code: x.code })));
  if (sent.length >= 20) return false;
  return !sent.some(n => n.code === e.code && now - n.at < 15 * 60e3);
}
// 短代號（網址 #monitor/xxxxxxxx 用）
const monHash = id => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, "0"); };
// 清理：只刪鍵名完全符合 kline:watch:mon:v1:YYYY-MM-DD、超過 20 天的
function monGc(now = Date.now(), ls = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!ls) return 0; const cut = new Date(now + 8 * 3600e3 - MON_KEEP * 864e5).toISOString().slice(0, 10), old = [];
  try { for (let i = 0; i < ls.length; i++) { const m = /^kline:watch:mon:v1:(\d{4}-\d{2}-\d{2})$/.exec(ls.key(i) || ""); if (m && m[1] < cut) old.push(m[0]); } old.forEach(k => ls.removeItem(k)); } catch {}
  return old.length;
}
// 監控狀態：區分「監控中」「暫停（切走、背景）」「未開盤／休市」「不知道有沒有開盤」「來源失敗」「資料過期」
function monStatus({ day, sess, hidden, err, staleN, lastOk, now = Date.now() }) {
  if (day === "closed") return ["closed", "今天休市，不監控"];
  if (day === "unknown") return ["unknown", "還不能確認今天有沒有開盤（休市日表抓不到），先不監控"];
  if (sess !== "open") return ["closed", sess === "pre" ? "試撮中，09:00 開盤後開始監控" : "不在交易時段（09:00–13:30），不監控"];
  if (hidden) return ["paused", "畫面切走或在背景，監控暫停；回到情報局或看盤就繼續"];
  if (err) return ["error", `報價來源失敗：${err}`];
  if (staleN) return ["stale", `有 ${staleN} 檔報價超過 3 分鐘沒更新，這些先不判斷`];
  if (!lastOk) return ["loading", "第一次抓報價中…"];
  return ["on", "監控中（這個頁面開著、在前景時才偵測，關掉就停）"];
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
  M.staleN = all.filter(c => Q.get(c) && !monFresh(Q.get(c), today, now)).length; M.n = all.length;
  monData(E, today, M.fails >= 2, M.err || "", now); // 連續兩次失敗才記一件，恢復後自動關閉
  if (!M.err) {
    const up = monMerge(E, monScan(Q, { today, codes, plan: typeof getBriefSnapshot === "function" ? getBriefSnapshot(today) : null, prevPx: M.prevPx, names: W.names, now }), now);
    for (const e of up) if (monShouldNotify(e, E, now)) { notify(e.title, e.msg); e.notified.push({ ch: "local", at: now, ok: true }); }
    M.prevPx = { T00: Q.get("T00")?.price };
  }
  for (const x of (W.irLog ||= store.get("watch:irlog", []) || []).filter(x => x.d === today)) monRule(E, today, x.code, `指標提醒：${nameOf(x.code)} ${x.code}`, x.msg, now); // 指標提醒（tools.js 每 5 分鐘檢查、已經通知過）
  monSave(today); if (W.lt === "mon") renderList(); return M;
}
// 一打開清一次 20 天前的事件
function monLoop() { clearTimeout(W.monTimer); if (!W.monGcAt) { W.monGcAt = Date.now(); monGc(); } if (W.off) return; W.monTimer = setTimeout(() => monTick().finally(monLoop), MON_EVERY); }
// 到價提醒觸發時記一件（通知已經由 checkAlerts 送出）
function monAlertHit(c, title, msg) { const d = W.today || twDay(); if (monRule(monE(d), d, c, title, msg)) monSave(d); }
function monState() { const M = W.mon || {}; return monStatus({ day: twDayState(), sess: mktSession(), hidden: monHidden(), err: M.fails ? M.err : null, staleN: M.staleN, lastOk: M.okAt }); }
const monTime = t => new Date(t + 8 * 3600e3).toISOString().slice(11, 19);
function monPage() {
  const d = W.today || twDay(), E = monE(d), L = Object.values(E).sort((a, b) => (a.state === "open") - (b.state === "open") || b.last - a.last).reverse(), [st, txt] = monState(), M = W.mon || {}, codes = monCodes();
  const empty = { on: "今天目前沒有觸發事件（監控正常）。", loading: "第一次抓報價中…", paused: "監控暫停中，這段時間沒有偵測。", closed: "現在不在交易時段，沒有監控。", unknown: "還不能確認今天有沒有開盤，先不監控。", error: "報價來源失敗，現在沒有資料——不代表沒有事件。", stale: "部分報價過期，這些代號先不判斷。" }[st];
  const row = e => `<li><button type="button" class="mon-ev ${e.sev}${e.state === "closed" ? " done" : ""}" data-mon="${monHash(e.id)}"><span class="mon-sev">${MON_SEV_TXT[e.sev]}</span><b>${esc(e.title)}</b><span class="note">${esc(e.msg)}</span><span class="note mon-t">${monTime(e.first)}${e.snaps.length > 1 ? `・更新 ${e.snaps.length - 1} 次` : ""}${e.state === "closed" ? "・已結束" : ""}</span></button></li>`;
  const h = `<section class="csec mon">
    <div class="dh-status-bar"><div class="dh-sb-left"><span class="dh-badge mon-${st}">${{ on: "監控中", loading: "載入中", paused: "暫停", closed: "未開盤／休市", unknown: "交易日待確認", error: "來源失敗", stale: "資料過期" }[st]}</span><span class="note">${esc(txt)}</span></div></div>
    <h3>盤中監控 <span class="note">${d.slice(5).replace("-", "/")}</span></h3>
    <p class="note">監控範圍：大盤＋自選 ${codes.filter(x => !x.hold).length} 檔＋台股庫存 ${codes.filter(x => x.hold).length} 檔，每 20 秒一次${M.okAt ? `・最後成功 ${monTime(M.okAt)}` : ""}${M.fails ? `・連續失敗 ${M.fails} 次` : ""}。只推「■ 警示」到這台裝置（同一檔 15 分鐘最多一則、每天最多 20 則）；到價、指標提醒照原本的方式通知，這裡一起記錄。</p>
    ${L.length ? `<ul class="mon-list">${L.map(row).join("")}</ul>` : `<p class="note mon-empty">${empty}</p>`}
    <details class="dh-more"><summary>怎麼判斷的</summary><p class="note">大盤漲跌超過 1%、2%、3%；自選與庫存漲跌超過 5%、7% 或漲跌停；加權穿越今日市場的推估分水嶺、支撐、壓力。同一檔同一方向一天只開一件，幅度變大時更新同一件。報價超過 3 分鐘沒更新、不是今天的、或只是估價時不判斷。事件只代表行情達到條件，不代表原因，也不是買賣建議。事件存在這台裝置 20 天，不會雲端同步。</p></details>
  </section>`;
  return { h, note: "盤中監控只在這個頁面開著、在前景時偵測；關掉或切到 K線學堂、存股就暫停。" };
}
function monDetail(hash) {
  const d = W.today || twDay(), e = Object.values(monE(d)).find(x => monHash(x.id) === hash); if (!e) return toast("找不到這件事件（可能是別天的）");
  W.monSel = hash; navPush?.("replace");
  openSheet(`<h3>${esc(e.title)}</h3><p class="note">${MON_SEV_TXT[e.sev]}・${{ IDX: "大盤", SYM: "個股", LEVEL: "關鍵價位", RULE: "提醒", DATA: "資料" }[e.type] || e.type}・${monTime(e.first)} 開始${e.last !== e.first ? `・${monTime(e.last)} 更新` : ""}・${e.state === "closed" ? "已結束" : "進行中"}</p>
    <p>${esc(e.msg)}</p>
    ${e.snaps.length ? `<h4>當時的報價</h4><ul class="tlist">${e.snaps.map(s => `<li>${monTime(s.at)}　${fmtP(s.px)}　<span class="${cls(s.pct)}">${s.pct >= 0 ? "+" : ""}${(+s.pct).toFixed(2)}%</span></li>`).join("")}</ul>` : ""}
    <h4>通知</h4><p class="note">${e.notified.length ? e.notified.map(n => `${monTime(n.at)} ${n.via ? `由${n.via}通知` : n.ok ? "已通知這台裝置" : `通知失敗：${esc(n.err || "")}`}`).join("；") : "沒有通知（只推「■ 警示」等級）"}</p>
    ${e.code && e.code !== "T00" ? `<p><button type="button" class="btn sm" data-sel="${esc(e.code)}">看 ${esc(nameOf(e.code))} 個股頁 ›</button></p>` : ""}
    <p class="note">事件只代表行情達到條件，不代表原因，也不是買賣建議。</p>`, false);
}
document.addEventListener("click", e => { if (e.target.closest("[data-l2mon]")) return setLt("mon"); const b = e.target.closest("[data-mon]"); if (b && typeof W !== "undefined" && W.lt === "mon") monDetail(b.dataset.mon); });
