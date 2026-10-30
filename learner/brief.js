/* ================= 工具「早報」「筆記追蹤」與提醒頁的「事件提醒」 =================
   早報：昨晚美股（/api/usmarket）、台指期夜盤（/api/futures）、今天的除權息與法說會（/api/calendar）、持股的新消息（/api/news）、
         今天要注意（離目標價 3% 以內、事件提醒），可以請 AI 整理成一段話。每天早上 07:40 排程也用同一套內容推播到 Telegram（scripts/morning-brief.mjs）。
   事件提醒：庫存（可選含自選）台股的營收公布、三率三升、法說會前一天。看盤開著時跳通知；綁定 Telegram 後收盤後也會推播（scripts/alerts-push.mjs）。
   筆記追蹤：每檔可以記筆記（記下當時的價格）、設目標價（寫進價格提醒，到價會通知），清單看現價離目標還差多少。
   evScan、revOf、briefParts、briefText 是純函式（不碰畫面），排程透過 scripts/_engine.mjs 載入，網頁和推播的內容才會一樣。
   用到 watch.html 的 W、esc、cls、getJ、store、renderList、nameOf、fmtP、toast、notify、mkSeg，tools.js 的 myCodes，earn.js 的 ER、erLoad，fundx.js 的 ehLoad，core.js 的 aiChat。 */
const EV_KINDS = [["rev", "營收公布", "每月 10 日前公布上個月營收時"], ["pm3", "三率三升", "季報出來，毛利率、營益率、淨利率都比上一季高"], ["conf", "法說會前一天", "下一個交易日要開法說會"], ["etf", "ETF 換股", "持有或自選的 ETF 新增、剔除成分股（近 7 天）"], ["brief", "每日早報", "每個交易日早上 07:40（Telegram）"], ["close", "收盤重點", "每個交易日收盤後，把今日重點（自選與庫存大漲跌、今明兩天除權息與法說會、ETF 換股、事件）推到 Telegram"], ["mon", "盤中警示", "伺服器盤中巡檢（約每 5–15 分鐘）發現大盤或庫存、自選的「■ 警示」時推到 Telegram；同一檔 15 分鐘最多一則、每天最多 20 則"]];
const EV_PUSH = ["brief", "close", "mon"]; // 只有 Telegram 推播的項目，網頁不跳通知（盤中警示在網頁上由盤中監控分頁自己通知）
const twDay = (ms = Date.now(), add = 0) => new Date(ms + 8 * 3600e3 + add * 864e5).toISOString().slice(0, 10);
// 下一個平日（不管國定假日）；watch.html 的除權息、法說會日期也用這個
const nextWd = d => { const t = new Date(d + "T00:00:00Z"); do t.setUTCDate(t.getUTCDate() + 1); while (t.getUTCDay() % 6 === 0); return t.toISOString().slice(0, 10); };
const qTxt = q => { const m = String(q || "").match(/^(\d{4})Q(\d)$/); return m ? `${m[1]} 年第 ${m[2]} 季` : q || ""; };
const ymPrev = (ym, n) => { const [y, m] = ym.split("-").map(Number), t = y * 12 + m - 1 - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const evPct = v => (v == null || !isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(+v).toFixed(1)}%`);
// 一檔的月營收歷史 { "2026-09": 千元 } → 最新一個月：營收（億）、年增、月增、比過去連續幾個月都高（12 個月以上才算「新高」）
function revOf(H) {
  const ks = Object.keys(H || {}).filter(k => H[k] != null).sort(), ym = ks.at(-1); if (!ym) return null;
  const v = H[ym], ly = H[ymPrev(ym, 12)], lm = H[ymPrev(ym, 1)]; let hi = 0;
  for (let i = 1; i <= 36; i++) { const p = H[ymPrev(ym, i)]; if (p == null) break; if (p >= v) { hi = 0; break; } hi = i; }
  return { ym, rev: v / 1e5, yoy: ly ? (v / ly - 1) * 100 : null, mom: lm ? (v / lm - 1) * 100 : null, hi: hi >= 12 ? hi : 0 };
}
// ETF 換股：etf-hold 排程記的變動事件（ev：[{ d, t: in/out, code, name }]），只看近 days 天、有股票代號的（期貨換月、現金不算）；同一天的合成一則
function etfEvOf(H, today = twDay(), days = 7) {
  const since = twDay(Date.parse(today + "T00:00:00Z"), -days), by = {};
  for (const e of H?.ev || []) if (e.code && e.d >= since && e.d <= today) ((by[e.d] ||= { in: [], out: [] })[e.t === "in" ? "in" : "out"]).push(e.name || e.code);
  return Object.entries(by).sort((a, b) => b[0].localeCompare(a[0])).map(([d, x]) => ({ d, in: x.in, out: x.out }));
}
const etfEvTxt = x => { const L = (w, A) => (A.length ? `${w} ${A.slice(0, 4).join("、")}${A.length > 4 ? ` 等 ${A.length} 檔` : ""}` : ""); return `${x.d.slice(5).replace("-", "/")} ${[L("新增", x.in), L("剔除", x.out)].filter(Boolean).join("，")}`; };
// 事件提醒：codes 是要看的代號；D = { rev: { 代號: revOf 的結果＋name }, pm: earn-hist.json 的 pm, conf: 法說會 [{ date, time, code, name, place }], etf: { ETF 代號: etf-hold 檔 }, names }
// 回傳 [{ kind, code, k（去重用：同一件事只通知一次）, m（訊息） }]
function evScan(codes, D, today = twDay()) {
  const S = new Set(codes), out = [], nm = (c, n) => D.names?.[c] || n || "";
  for (const c of S) { const r = D.rev?.[c]; if (!r?.ym || r.rev == null) continue;
    out.push({ kind: "rev", code: c, k: `r:${c}:${r.ym}`, m: `${nm(c, r.name)} ${c}：${+r.ym.slice(5)} 月營收 ${r.rev.toFixed(2)} 億，年增 ${evPct(r.yoy)}、月增 ${evPct(r.mom)}${r.hi ? `，創 ${r.hi} 個月新高` : ""}`.trim() }); }
  const q = D.pm?.q;
  for (const x of D.pm?.rows || []) if (S.has(x[0]) && x[7] > 0 && x[8] > 0 && x[9] > 0)
    out.push({ kind: "pm3", code: x[0], k: `p:${x[0]}:${q}`, m: `${nm(x[0], x[1])} ${x[0]}：${qTxt(q)}三率三升（毛利率 ${x[4]}%、營益率 ${x[5]}%、淨利率 ${x[6]}%，都比上一季高）` });
  const nd = nextWd(today);
  for (const x of D.conf || []) if (S.has(x.code) && x.date > today && x.date <= nd)
    out.push({ kind: "conf", code: x.code, k: `c:${x.code}:${x.date}`, m: `${nm(x.code, x.name)} ${x.code}：${x.date.slice(5).replace("-", "/")}${x.time ? " " + x.time : ""} 開法說會${x.place ? "（" + x.place + "）" : ""}` });
  for (const [c, H] of Object.entries(D.etf || {})) if (S.has(c)) for (const x of etfEvOf(H, today))
    out.push({ kind: "etf", code: c, k: `e:${c}:${x.d}`, m: `${nm(c, H.name)} ${c} 換股：${etfEvTxt(x)}` });
  return out;
}
// 早報內容：G = { us: /api/usmarket, fut: /api/futures?bars=0, cal: /api/calendar }，mine = { codes, names, news: { 代號: [{ title, source }] }, near: [{ code, px, to, dir }], ev: evScan 的結果 }
// 回傳 [{ t: 標題, L: [{ s: 文字, c: 代號（可點）, k: "up"/"down"/"" }] }]，沒有內容的段落不放
function briefParts(G, mine = {}, today = twDay()) {
  const P = [], tone = v => (v > 0 ? "up" : v < 0 ? "down" : ""), num = v => (v == null ? "—" : (+v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const nm = (c, n) => mine.names?.[c] || n || c, mineSet = new Set(mine.codes || []);
  const us = G.us?.ok ? [...(G.us.indices || []).filter(x => ["^DJI", "^IXIC", "^GSPC", "^SOX"].includes(x.code)), ...(G.us.megas || []).filter(x => ["TSM", "NVDA"].includes(x.code)), ...(G.us.macro || []).filter(x => ["^TNX", "DX-Y.NYB"].includes(x.code))] : [];
  if (us.length) P.push({ t: `昨晚美股${G.us.date ? `（美東 ${G.us.date.slice(5).replace("-", "/")}）` : ""}`, L: us.map(x => ({ s: `${x.name} ${num(x.price)}（${evPct(x.chgPct)}）`, c: x.code, k: tone(x.chgPct) })) });
  const f = G.fut?.ok ? G.fut.night?.price != null ? { ...G.fut.night, lab: "夜盤" } : G.fut.quote?.price != null ? { ...G.fut.quote, lab: G.fut.quote.session === "night" ? "夜盤" : "日盤" } : null : null;
  if (f) P.push({ t: "台指期", L: [{ s: `${f.lab} ${num(f.price)}（${f.chg > 0 ? "+" : ""}${num(f.chg)} 點，${evPct(f.chgPct)}）${f.time ? `・${f.time}` : ""}`, c: "TXF", k: tone(f.chg) }] });
  const cal = (G.cal?.rows || []).filter(x => x.date === today), conf = (G.cal?.conf || []).filter(x => x.date === today), mineFirst = (a, b) => mineSet.has(b.code) - mineSet.has(a.code);
  const L = [...cal.sort(mineFirst).slice(0, 8).map(x => ({ s: `${mineSet.has(x.code) ? "★ " : ""}${nm(x.code, x.name)} ${x.code} ${x.kind || "除權息"}${x.cash ? ` 現金 ${x.cash} 元` : ""}${x.stock ? ` 股票 ${x.stock} 元` : ""}`, c: x.code, k: "" })),
    ...conf.sort(mineFirst).slice(0, 8).map(x => ({ s: `${mineSet.has(x.code) ? "★ " : ""}${nm(x.code, x.name)} ${x.code} 法說會${x.time ? " " + x.time : ""}`, c: x.code, k: "" }))];
  if (cal.length > 8) L.push({ s: `…今天共 ${cal.length} 檔除權息`, c: null, k: "" });
  if (L.length) P.push({ t: "今天的除權息、法說會", L });
  const N = Object.entries(mine.news || {}).flatMap(([c, A]) => (A || []).slice(0, 2).map(n => ({ s: `${nm(c)}：${n.title}${n.source ? `（${n.source}）` : ""}`, c, k: "" })));
  if (N.length) P.push({ t: "持股新消息", L: N.slice(0, 10) });
  const W2 = [...(mine.near || []).map(x => ({ s: `${nm(x.code)} ${x.code} 現價 ${num(x.px)}，離目標 ${x.dir === "up" ? "≥" : "≤"} ${num(x.to)} 還差 ${Math.abs((x.to / x.px - 1) * 100).toFixed(1)}%`, c: x.code, k: "" })), ...(mine.ev || []).map(x => ({ s: x.m, c: x.code, k: "" }))];
  if (W2.length) P.push({ t: "今天要注意", L: W2.slice(0, 12) });
  return P;
}
const WEEK = "日一二三四五六";
function briefText(P, today = twDay()) {
  return `☀️ KLineLab 早報（${today.slice(5).replace("-", "/")} 週${WEEK[new Date(today + "T00:00:00Z").getUTCDay()]}）\n` + P.map(p => `\n【${p.t}】\n` + p.L.map(x => "• " + x.s).join("\n")).join("\n") + "\n\n整理自公開資料，不是買賣建議。";
}

/* ---------- 事件提醒的設定（存在 watch:evalert，雲端同步時一起上傳，推播排程讀這份） ---------- */
const EVA = () => (W.eva ||= { scope: "hold", ...(store.get("watch:evalert", null) || {}) });
const evaSave = () => store.set("watch:evalert", EVA());
const evCodes = () => { const S = EVA(), hold = Object.keys(W.hold || {}).filter(c => !W.hold[c]?.demo); return [...new Set([...hold, ...(S.scope === "all" ? myCodes() : [])])].filter(c => isTW(c)); };
function evaHtml() {
  const S = EVA(), n = evCodes().length;
  return `<h4>事件提醒 <span class="note">庫存${S.scope === "all" ? "＋自選" : ""}的台股 ${n} 檔</span></h4>
    <p class="note">勾選要通知的事件。看盤開著時跳通知；在「備份同步」綁定 Telegram 並上傳後，收盤後（早報是早上）也會推播到手機。</p>
    <div class="evopts">${EV_KINDS.map(([k, t, d]) => `<label class="evopt"><input type="checkbox" data-eva="${k}" ${S[k] ? "checked" : ""}><b>${t}</b><span class="note">${d}</span></label>`).join("")}</div>
    <div class="irform"><span class="note">範圍</span>${mkSeg("evscope", S.scope, [["hold", "只看庫存"], ["all", "庫存＋自選"]])}<button class="btn sm" data-tx="evnow">立即檢查</button></div>
    <ul class="tlist">${(W.evHits || []).slice(0, 20).map(x => `<li><button class="linkbtn" data-sel="${esc(x.code)}">${esc(x.m)}</button></li>`).join("") || `<li class="note">${W.evBusy ? "檢查中…" : "目前沒有新的事件"}</li>`}</ul>`;
}
// 網頁版的事件檢查：營收用財報分頁的上市櫃月營收表，三率用 data/earn-hist.json，法說會用 /api/calendar
// 網頁版讀 ETF 的 etf-hold 檔（只讀用得到的、6 小時內不重抓；沒有排程資料的 ETF 會 404，略過）
async function etfHoldLoad(codes) {
  const C = (W.etfH ||= {}), out = {};
  await Promise.all(codes.filter(c => /^00\d{2,4}[A-Z]?$/.test(c)).map(async c => {
    if (!C[c] || Date.now() - C[c].at > 6 * 3600e3) { try { const r = await fetch(`data/etf-hold/${encodeURIComponent(c)}.json`, { signal: tmo(10000) }); C[c] = { at: Date.now(), j: r.ok ? await r.json() : null }; } catch { C[c] = { at: Date.now(), j: null }; } }
    if (C[c].j) out[c] = C[c].j; }));
  return out;
}
async function evData() {
  await lazy("earn"); // 財報的程式（earn.js、fundx.js）用到才載入
  const [eh, cal] = await Promise.all([ehLoad(), W.cal?.conf ? W.cal : getJ("/api/calendar", true).catch(() => null)]); // ehLoad 在 fundx.js
  if (cal?.ok) W.cal = cal;
  const E = ER(); if (!E.data?.rows) await erLoad(); const R = ER().data, hi = new Map((eh?.streak?.rows || []).map(r => [r[0], r[7]]));
  const ym = R?.ym ? `${+R.ym.slice(0, -2) + 1911}-${R.ym.slice(-2)}` : null, rev = {};
  if (ym) for (const r of R.rows || []) if (r[4] != null) rev[r[0]] = { ym, name: r[1], rev: r[4], mom: r[5], yoy: r[6], hi: hi.get(r[0]) || 0 };
  return { rev, pm: eh?.pm, conf: cal?.conf || [], etf: await etfHoldLoad(evCodes()), names: W.names };
}
async function evCheck(quiet = false) {
  const S = EVA(), on = EV_KINDS.map(x => x[0]).filter(k => !EV_PUSH.includes(k) && S[k]); if (!on.length || W.off || W.evBusy) return;
  W.evBusy = true; if (!quiet) renderList();
  try {
    const hits = evScan(evCodes(), await evData()).filter(x => on.includes(x.kind)), seen = new Set(store.get("watch:evseen", []) || []), fresh = hits.filter(x => !seen.has(x.k));
    W.evHits = hits;
    if (fresh.length) { notify(`事件提醒（${fresh.length} 則）`, fresh.slice(0, 3).map(x => x.m).join("；")); store.set("watch:evseen", [...seen, ...fresh.map(x => x.k)].slice(-600)); }
    else if (!quiet) toast(hits.length ? "沒有新的事件（之前通知過的不再跳）" : "目前沒有符合的事件", 2500);
  } finally { W.evBusy = false; if (W.lt === "tools") renderList(); }
}
// 看盤開著時：打開 20 秒後檢查一次，之後每 2 小時一次
function evStart() { if (W.evTimer || W.off) return; W.evTimer = setInterval(() => document.visibilityState === "visible" && evCheck(true), 2 * 3600e3); setTimeout(() => evCheck(true), 20000); }

/* ---------- 早報 ---------- */
async function briefLoad(force = false) {
  const B = (W.bf ||= {}); if (W.off || B.busy || (!force && B.at && Date.now() - B.at < 10 * 60e3)) return;
  B.busy = true; renderList();
  const ok = p => p.then(j => j).catch(e => ({ ok: false, error: e.message }));
  const [us, fut, cal] = await Promise.all([ok(getJ("/api/usmarket")), ok(getJ("/api/futures?bars=0")), ok(getJ("/api/calendar", true))]);
  Object.assign(B, { us, fut, cal }); if (cal?.ok) W.cal = cal;
  const held = Object.keys(W.hold || {}).filter(c => isTW(c) || isUS(c)), list = (held.length ? held : myCodes()).slice(0, 5), since = Date.now() - 36 * 3600e3;
  B.news = {}; await Promise.all(list.map(async c => { try { const j = await getJ(`/api/news?code=${encodeURIComponent(c)}&q=${encodeURIComponent(nameOf(c) || c)}`, true); const L = (j.items || []).filter(x => !x.at || x.at > since).slice(0, 2); if (L.length) B.news[c] = L; } catch {} }));
  try { B.ev = evScan(evCodes(), await evData()).filter(x => x.kind === "conf" || (x.kind === "rev" && x.k.endsWith(twDay().slice(0, 7)))); } catch { B.ev = []; }
  B.busy = false; B.at = Date.now(); if (W.lt === "today") renderList();
}
function briefNear() {
  return Object.entries(W.alerts || {}).flatMap(([c, a]) => { const px = W.quotes.get(c)?.price; if (px == null) return [];
    return [["up", a.up], ["dn", a.dn]].filter(([, to]) => to && Math.abs(to / px - 1) <= 0.03).map(([dir, to]) => ({ code: c, px, to, dir })); });
}
const briefP = () => (W.bf?.at ? briefParts(W.bf, { codes: evCodes(), names: W.names, news: W.bf.news, near: briefNear(), ev: W.bf.ev }) : []);
// 早報的一段（標題＋幾行，可以點的代號連到個股頁）；今日市場的總經儀表板也用它畫「昨晚美股」
const bfSecHtml = p => `<div class="bfsec"><h4>${esc(p.t)}</h4><ul class="tlist">${p.L.map(x => `<li>${x.c && x.c !== "TXF" && !/^\^|=|DX-Y/.test(x.c) ? `<button class="linkbtn" data-sel="${esc(x.c)}">${esc(x.s)}</button>` : `<span class="${x.k}">${esc(x.s)}</span>`}</li>`).join("")}</ul></div>`;
// 盤前那一半（早報）：昨晚美股、台指期夜盤、今天的除權息與法說會、持股新消息、今天要注意
function briefBody(skip = []) {
  const B = W.bf; if (!B?.at && !B?.busy) setTimeout(() => briefLoad(), 0);
  const P = briefP().filter(p => !skip.some(k => p.t.startsWith(k)));
  return `${W.off ? `<p class="note">需要部署到網站才有早報資料。</p>` : B?.busy && !P.length ? `<p class="note">載入中…</p>` : ""}
    <div class="bfgrid">${P.map(bfSecHtml).join("")}</div>
    ${B?.at && !P.length ? `<p class="note">暫時沒有早報資料，稍後再按重新整理。</p>` : ""}`;
}
/* ---------- 今日重點（情報局分頁）：早報（盤前）＋每日摘要（盤中、盤後）整成一頁；自選最上面的今日重點卡是它的縮小版 ----------
   13:30 收盤前先看盤前那一半（昨晚美股、台指期、今天的行事曆），收盤後先看盤後那一半（大盤、自選漲跌、技術訊號）；重新整理、AI 整理、複製都只有一個 */
const tdAfter = (now = Date.now()) => new Date(now + 8 * 3600e3).toISOString().slice(11, 16) >= "13:30";

/* ---------- 每日市場決策中心：盤前預判、情境推演、盤後驗證與共同契約 ---------- */
const TW_HOURS = 8 * 3600e3;
const SNAPSHOT_STORAGE_NOTE = "快照儲存於瀏覽器 localStorage（鍵值 watch:brief:snap:YYYY-MM-DD）。受限於本機儲存機制，清除瀏覽器快取、更換裝置或無痕模式將無法保留歷史快照；非跨裝置雲端資料庫。";

function resolveTime(now = Date.now()) {
  const ms = typeof now === "number" ? now : (typeof now === "string" ? Date.parse(now) : (now instanceof Date ? now.getTime() : Date.now()));
  const twMs = ms + TW_HOURS;
  const d = new Date(twMs);
  const iso = d.toISOString();
  const twDate = iso.slice(0, 10);
  const hm = iso.slice(11, 16);
  const asOf = iso.slice(11, 19);
  const day = d.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  return { ms, twMs, twDate, hm, asOf, day, isWeekend };
}

function resolveHolidays(opts = {}) {
  if (opts.holidays !== undefined) {
    if (Array.isArray(opts.holidays)) return { list: opts.holidays, source: "caller_explicit" };
    if (opts.holidays === null) return { list: null, source: "caller_null" };
  }
  if (Array.isArray(opts.cal?.hol)) {
    return { list: opts.cal.hol, source: "opts_cal" };
  }
  if (typeof W !== "undefined" && Array.isArray(W?.cal?.hol)) {
    return { list: W.cal.hol, source: "global_w_cal" };
  }
  return { list: null, source: "none" };
}

// 休市日表裡的「開始交易日」「最後交易日」有開盤，不算休市（和 core.js 的 twHolSet、api/_lib/calendar.js 的 closedHol 同一條規則）
const holClosed = x => !/開始交易|最後交易/.test(Array.isArray(x) ? `${x[1] || ""}` : `${x?.name || ""}${x?.note || ""}`);
const holSetOf = holList => new Set((holList || []).filter(holClosed).map(x => x?.date || (Array.isArray(x) ? x[0] : null)).filter(Boolean));
function findLastTradeDate(fromDate, holList = null) { return stepTradeDate(fromDate, holList, -1); }
// 下一個交易日（跳過週末與休市日）：休市日的盤前推演以它為目標日
function findNextTradeDate(fromDate, holList = null) { return stepTradeDate(fromDate, holList, 1); }
function stepTradeDate(fromDate, holList, dir) {
  if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return null;
  const d = new Date(fromDate + "T00:00:00Z");
  const holSet = holSetOf(holList);
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() + dir);
    const dateStr = d.toISOString().slice(0, 10);
    const day = d.getUTCDay();
    const isWk = day === 0 || day === 6;
    const isHol = holSet.has(dateStr);
    if (!isWk && !isHol) {
      return dateStr;
    }
  }
  return null;
}

function isValidSnapshot(snap, expectedDate = null) {
  if (!snap || typeof snap !== "object") return false;
  if (!snap.tradeDate || typeof snap.tradeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snap.tradeDate)) return false;
  if (expectedDate && snap.tradeDate !== expectedDate) return false;
  if (!snap.createdAt || typeof snap.createdAt !== "string") return false;
  const kl = snap.keyLevels;
  if (!kl || typeof kl !== "object") return false;
  if (typeof kl.pressure !== "number" || !isFinite(kl.pressure) || kl.pressure <= 0) return false;
  if (typeof kl.pivot !== "number" || !isFinite(kl.pivot) || kl.pivot <= 0) return false;
  if (typeof kl.support !== "number" || !isFinite(kl.support) || kl.support <= 0) return false;
  if (kl.pressure <= kl.pivot || kl.pivot <= kl.support) return false;
  const sc = snap.scenarios;
  if (!sc || typeof sc !== "object") return false;
  if (!sc.bull?.title || !sc.bull?.trigger) return false;
  if (!sc.neutral?.title || !sc.neutral?.trigger) return false;
  if (!sc.bear?.title || !sc.bear?.trigger) return false;
  return true;
}

// 盤前推演快照每天一筆（watch:brief:snap:YYYY-MM-DD）：只留 20 天（春節連假也夠驗證），只清鍵名格式完全符合的，不碰其他資料
function briefSnapGc(now = Date.now(), ls = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!ls || briefSnapGc.done) return 0; briefSnapGc.done = true;
  const cut = new Date(now + 8 * 3600e3 - 20 * 864e5).toISOString().slice(0, 10), old = [];
  try { for (let i = 0; i < ls.length; i++) { const m = /^kline:watch:brief:snap:(\d{4}-\d{2}-\d{2})$/.exec(ls.key(i) || ""); if (m && m[1] < cut) old.push(m[0]); } old.forEach(k => ls.removeItem(k)); } catch {}
  return old.length;
}
function getBriefSnapshot(today, storeObj = null) {
  const targetDate = today || resolveTime().twDate;
  try {
    const s = storeObj || (typeof store !== "undefined" ? store : null);
    if (s?.get) {
      const snap = s.get("watch:brief:snap:" + targetDate, null);
      if (snap && isValidSnapshot(snap, targetDate)) {
        return snap;
      }
    }
  } catch {}
  return null;
}

function saveBriefSnapshot(today, plan, storeObj = null) {
  const targetDate = today || resolveTime().twDate;
  if (!targetDate || !isValidSnapshot(plan, targetDate)) return false;
  try {
    const s = storeObj || (typeof store !== "undefined" ? store : null);
    if (s?.get && s?.set) {
      const existing = s.get("watch:brief:snap:" + targetDate, null);
      if (existing && isValidSnapshot(existing, targetDate)) {
        return false; // 不得覆寫已保存的有效原始快照
      }
      s.set("watch:brief:snap:" + targetDate, plan);
      return true;
    }
  } catch {}
  return false;
}

function sessionStatus(now = Date.now(), opts = {}) {
  let timeVal = now;
  let options = opts;
  if (now && typeof now === "object" && !(now instanceof Date)) {
    options = now;
    timeVal = Date.now();
  }
  const { ms, twDate, hm, day, isWeekend } = resolveTime(timeVal);
  const tradeDate = options.tradeDate || twDate;
  const holInfo = resolveHolidays(options);
  const holList = holInfo.list;

  const calendarFailed = options.calendarStatus === "failed" || options.calendarStatus === "error" || Boolean(options.cal?.error);
  const calendarUnverified = calendarFailed || options.calendarStatus === "unknown" || options.isUnknown ||
    (holList === null && !isWeekend && options.calendarStatus !== "confirmed");

  if (calendarUnverified) {
    return {
      session: "unknown",
      status: "pending",
      label: "交易狀態待確認",
      hm,
      tradeDate,
      isWeekend,
      isClosed: null,
      calendarVerified: false,
      calendarStatus: calendarFailed ? "failed" : "unverified",
      warning: calendarFailed
        ? "官方交易日曆連線失敗，採安全降級處理，不假定為正常交易日"
        : "無法取得官方交易日曆，採安全降級處理"
    };
  }

  if (isWeekend) {
    const lastTradingDay = options.lastTradeDate || findLastTradeDate(tradeDate, holList);
    return {
      session: "closed",
      status: "closed",
      label: "週末休市",
      hm,
      tradeDate,
      lastTradeDate: lastTradingDay,
      isWeekend: true,
      isClosed: true,
      reason: "週末例行休市",
      displayNote: lastTradingDay
        ? `今日休市（週末例行休市）・顯示最近交易日 ${lastTradingDay.slice(5).replace("-", "/")} 收盤`
        : "今日休市（週末例行休市）",
      calendarVerified: true
    };
  }

  const hol = (holList || []).filter(holClosed).find(x => (x?.date === tradeDate) || (Array.isArray(x) && x[0] === tradeDate));
  if (hol) {
    const holName = hol.name || (Array.isArray(hol) ? hol[1] : null) || "官方公告休市";
    const lastTradingDay = options.lastTradeDate || findLastTradeDate(tradeDate, holList);
    return {
      session: "closed",
      status: "closed",
      label: "今日休市",
      hm,
      tradeDate,
      lastTradeDate: lastTradingDay,
      isWeekend: false,
      isClosed: true,
      reason: holName,
      holidayName: holName,
      displayNote: lastTradingDay
        ? `今日休市（${holName}）・顯示最近交易日 ${lastTradingDay.slice(5).replace("-", "/")} 收盤`
        : `今日休市（${holName}）`,
      calendarVerified: true
    };
  }

  if (hm < "09:00") {
    return { session: "pre", status: "preview", label: "盤前預判", hm, tradeDate, isWeekend: false, isClosed: false, calendarVerified: true };
  } else if (hm <= "13:30") {
    return { session: "live", status: "intraday", label: "盤中撮合", hm, tradeDate, isWeekend: false, isClosed: false, calendarVerified: true };
  } else if (hm < "15:00") {
    return { session: "post", status: "settling", label: "盤後結算", hm, tradeDate, isWeekend: false, isClosed: false, calendarVerified: true };
  } else {
    return { session: "post", status: "official", label: "盤後定案", hm, tradeDate, isWeekend: false, isClosed: false, calendarVerified: true };
  }
}

// 壓力、支撐的倍數（× 加權近 14 日平均波動）：probe-live 的 levels 模式印出的「網頁用的倍數」，資料 2021-11～2026-10
const LV_K = { up: 0.607, dn: 0.511 };
// 加權近 14 日平均波動（真實波幅，ATR14）：只用 before 那天以前的日 K（開盤前就知道的）
function briefAtr14(D, before) {
  const B = (D || []).filter(b => b && b.d < before && b.h > 0 && b.l > 0 && b.c > 0).slice(-15); if (B.length < 15) return null;
  let s = 0; for (let i = 1; i < 15; i++) s += Math.max(B[i].h - B[i].l, Math.abs(B[i].h - B[i - 1].c), Math.abs(B[i].l - B[i - 1].c));
  return s / 14;
}
function briefScenarios(G, today, basePrice, meta = {}) {
  const targetDate = today || resolveTime().twDate;
  if (!basePrice || !isFinite(basePrice) || basePrice <= 0) {
    return {
      status: "insufficient_data",
      tradeDate: targetDate,
      message: "缺少基準參考價，無法產生有效盤前關鍵位階"
    };
  }

  const us = G?.us?.indices || [];
  const soxObj = us.find(x => x.code === "^SOX");
  const ixicObj = us.find(x => x.code === "^IXIC");
  const tsmObj = (G?.us?.megas || []).find(x => x.code === "TSM");
  const futObj = G?.fut?.night || G?.fut?.quote;

  const soxPx = soxObj?.close ?? soxObj?.price;
  const isSoxValid = soxObj != null && typeof soxPx === "number" && isFinite(soxPx) && soxPx > 0 && soxObj.chgPct != null && isFinite(soxObj.chgPct);
  const sox = isSoxValid ? soxObj.chgPct : null;

  const ixicPx = ixicObj?.close ?? ixicObj?.price;
  const isIxicValid = ixicObj != null && typeof ixicPx === "number" && isFinite(ixicPx) && ixicPx > 0 && ixicObj.chgPct != null && isFinite(ixicObj.chgPct);
  const ixic = isIxicValid ? ixicObj.chgPct : null;

  const tsmPx = tsmObj?.close ?? tsmObj?.price;
  const isTsmValid = tsmObj != null && typeof tsmPx === "number" && isFinite(tsmPx) && tsmPx > 0 && tsmObj.chgPct != null && isFinite(tsmObj.chgPct);
  const tsm = isTsmValid ? tsmObj.chgPct : null;

  const futPx = futObj?.price ?? futObj?.close;
  const isFutPriceValid = futObj != null && typeof futPx === "number" && isFinite(futPx) && futPx > 0;
  let futChg = null;
  const rawFutChg = futObj?.chg ?? futObj?.changePoints;
  if (typeof rawFutChg === "number" && isFinite(rawFutChg)) {
    futChg = rawFutChg;
  } else if (isFutPriceValid) {
    const prev = futObj.prev ?? futObj.referencePrice ?? futObj.refPrice;
    const curContract = (typeof futObj.contract === "string" && futObj.contract.trim()) ? futObj.contract.trim() : null;
    const prevContract = (typeof futObj.prevContract === "string" && futObj.prevContract.trim()) ? futObj.prevContract.trim() : null;
    if (typeof prev === "number" && isFinite(prev) && prev > 0 && curContract && prevContract && curContract === prevContract) {
      futChg = Math.round(futPx - prev);
    }
  }
  const isFutValid = isFutPriceValid && futChg != null;

  // 必要指標：費半(^SOX)、那斯達克(^IXIC)、台指期夜盤(TXF)；選配指標：台積電 ADR(TSM)
  const requiredComplete = isSoxValid && isIxicValid && isFutValid;
  const allComplete = requiredComplete && isTsmValid;

  const macroStatus = !requiredComplete ? "partial_macro" : (allComplete ? "complete_macro" : "partial_macro");
  const macroNote = !requiredComplete
    ? "部分必要美股/期貨資料缺失，關鍵位階依基準價推估"
    : (allComplete ? "國際行情與選配指標完整" : "必要國際指標完整（缺少 TSM 選配行情）");

  const ref = basePrice;
  const shift = futChg != null ? Math.round(futChg * 0.85) : 0;
  const pivot = Math.round((ref + shift) / 10) * 10;
  // 間距：近 14 日平均波動 × 校準倍數（回測 scripts/levels-bt.mjs：過去約 5 年，壓力、支撐各約三成的日子盤中碰到）；拿不到日 K 才用舊的固定 0.6%
  const atr = Number.isFinite(meta.atr) && meta.atr > 0 ? meta.atr : null, delta = Math.max(80, Math.round(ref * 0.006));
  const pressure = pivot + (atr ? Math.round(LV_K.up * atr) : delta);
  const support = pivot - (atr ? Math.round(LV_K.dn * atr) : delta);

  return {
    tradeDate: targetDate,
    createdAt: meta.createdAt || new Date().toISOString(),
    source: meta.source || "Yahoo Finance、期交所夜盤",
    sourceAsOf: meta.sourceAsOf || null,
    refPriceDate: meta.refPriceDate || null,
    macroSignals: { sox, ixic, tsm, futChg },
    macroStatus,
    macroNote,
    keyLevels: { pressure, pivot, support },
    band: atr ? { basis: "atr14", atr: Math.round(atr), up: LV_K.up, dn: LV_K.dn } : { basis: "fixed", pct: 0.6 },
    scenarios: {
      bull: {
        title: "多方推進情境",
        trigger: `開高站穩分水嶺 ${pivot.toLocaleString()} 點，電子權值股帶量表態`,
        target: `挑戰關鍵壓力位 ${pressure.toLocaleString()} 點`,
        invalidation: `跌破分水嶺 ${pivot.toLocaleString()} 點且反抽無法站回`,
        bias: "看多"
      },
      neutral: {
        title: "區間震盪情境",
        trigger: `在支撐 ${support.toLocaleString()} 至壓力 ${pressure.toLocaleString()} 間狹幅拉鋸`,
        target: `個股題材輪動，權值量縮整理`,
        invalidation: `帶量跌破 ${support.toLocaleString()} 或突破 ${pressure.toLocaleString()}`,
        bias: "盤整"
      },
      bear: {
        title: "空方防守情境",
        trigger: `開低摜破分水嶺 ${pivot.toLocaleString()} 點並下探支撐 ${support.toLocaleString()} 點`,
        target: `回測前波整數防守位`,
        invalidation: `迅速強勢拉回站穩 ${pivot.toLocaleString()} 點`,
        bias: "看空"
      }
    },
    storageNote: SNAPSHOT_STORAGE_NOTE
  };
}

function evaluateDataStatus({ market = {}, G = {}, session = "post", tradeDate = null }) {
  const taiex = market?.taiex;
  if (!taiex || typeof taiex !== "object") {
    return {
      dataStatus: "missing",
      dataStatusLabel: "資料缺失",
      reason: "缺少加權指數行情資料",
      marketDate: null,
      sourceVerified: false,
      sourceType: "none",
      completeness: "none"
    };
  }

  const marketDate = taiex.date;
  if (!marketDate || typeof marketDate !== "string") {
    return {
      dataStatus: "insufficient",
      dataStatusLabel: "資料不足",
      reason: "加權指數缺少行情日期欄位",
      marketDate: null,
      sourceVerified: false,
      sourceType: taiex.source || "unknown",
      completeness: "missing_date"
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
    return {
      dataStatus: "corrupted",
      dataStatusLabel: "資料格式錯誤",
      reason: `加權指數行情日期格式無效（${marketDate}）`,
      marketDate,
      sourceVerified: false,
      sourceType: taiex.source || "unknown",
      completeness: "invalid_date"
    };
  }

  const px = taiex.close ?? taiex.price;
  if (px == null || !isFinite(px) || px <= 0) {
    return {
      dataStatus: "insufficient",
      dataStatusLabel: "資料不足",
      reason: "加權指數缺少有效收盤或即時價格",
      marketDate,
      sourceVerified: false,
      sourceType: taiex.source || "unknown",
      completeness: "missing_price"
    };
  }

  const chgPct = taiex.chgPct;
  const hasValidChgPct = chgPct != null && isFinite(chgPct);

  const hi = taiex.high;
  const lo = taiex.low;
  const hasHighLow = hi != null && lo != null && isFinite(hi) && isFinite(lo) && hi > 0 && lo > 0;

  if (hasHighLow) {
    if (hi < lo || px > hi || px < lo) {
      return {
        dataStatus: "corrupted",
        dataStatusLabel: "數值關係不合理",
        reason: `最高價(${hi})、最低價(${lo})與價格(${px})之數值關係矛盾`,
        marketDate,
        sourceVerified: false,
        sourceType: taiex.source || "unknown",
        completeness: "corrupted_hl"
      };
    }
  }

  const vol = taiex.vol ?? taiex.volume ?? taiex.amount;
  if (vol != null && (!isFinite(vol) || vol < 0)) {
    return {
      dataStatus: "corrupted",
      dataStatusLabel: "成交量無效",
      reason: `加權指數成交量數值無效（${vol}）`,
      marketDate,
      sourceVerified: false,
      sourceType: taiex.source || "unknown",
      completeness: "corrupted_volume"
    };
  }

  const officialSources = ["twse", "tpex", "mis", "taifex", "證交所", "櫃買中心", "期交所"];
  const rawSrc = String(taiex.source || "").toLowerCase();
  const isOfficialSource = officialSources.some(s => rawSrc.includes(s));
  const isThirdParty = /yahoo|google|cnyes|finmind/.test(rawSrc);
  const sourceVerified = isOfficialSource || isThirdParty;

  if (tradeDate && marketDate !== tradeDate) {
    if (session === "closed") {
      return {
        dataStatus: "stale",
        dataStatusLabel: "休市資料",
        reason: `休市期間顯示最近交易日（${marketDate}）收盤行情`,
        marketDate,
        sourceVerified,
        sourceType: taiex.source || "unknown",
        completeness: hasHighLow && hasValidChgPct ? "complete" : "partial"
      };
    } else if (marketDate < tradeDate) {
      return {
        dataStatus: "stale",
        dataStatusLabel: "過期資料",
        reason: `加權指數日期為歷史日期（${marketDate}），早於目標交易日（${tradeDate}）`,
        marketDate,
        sourceVerified,
        sourceType: taiex.source || "unknown",
        completeness: "stale"
      };
    } else {
      return {
        dataStatus: "date_mismatch",
        dataStatusLabel: "日期不一致",
        reason: `加權指數日期（${marketDate}）與分析交易日（${tradeDate}）不符`,
        marketDate,
        sourceVerified: false,
        sourceType: taiex.source || "unknown",
        completeness: "mismatched"
      };
    }
  }

  if (!hasHighLow || !hasValidChgPct) {
    return {
      dataStatus: "partial",
      dataStatusLabel: "部分資料",
      reason: "加權指數缺少完整高低點或有效漲跌幅",
      marketDate,
      sourceVerified,
      sourceType: taiex.source || "unknown",
      completeness: "missing_fields"
    };
  }

  const inst = market.inst || G?.inst;
  if (inst && typeof inst === "object" && session !== "live" && session !== "pre") {
    if (inst.date && inst.date !== marketDate) {
      return {
        dataStatus: "partial",
        dataStatusLabel: "法人日期不一致",
        reason: `三大法人籌碼日期（${inst.date}）與指數日期（${marketDate}）不一致`,
        marketDate,
        sourceVerified,
        sourceType: taiex.source || "unknown",
        completeness: "inst_date_mismatch"
      };
    }
  }

  if (session === "pre") {
    return {
      dataStatus: "preview",
      dataStatusLabel: "盤前預判",
      reason: "開盤前預估資料",
      marketDate,
      sourceVerified,
      sourceType: taiex.source || "unknown",
      completeness: "preview"
    };
  }

  if (session === "live") {
    return taiex.delayed
      ? { dataStatus: "delayed", dataStatusLabel: "延遲資料", reason: "行情有延遲", marketDate, sourceVerified, sourceType: taiex.source || "unknown", completeness: "live_delayed" }
      : { dataStatus: "live", dataStatusLabel: "即時資料", reason: "盤中撮合即時資料", marketDate, sourceVerified, sourceType: taiex.source || "unknown", completeness: "live_realtime" };
  }

  // session === "post"
  const hasInst = Boolean(inst && (inst.foreign != null || inst.total != null || inst.trust != null));
  if (hasInst) {
    if (isOfficialSource) {
      return { dataStatus: "official", dataStatusLabel: "官方收盤", reason: "加權指數與三大法人籌碼已正式定案", marketDate, sourceVerified: true, sourceType: "twse_official", completeness: "official_complete" };
    } else if (isThirdParty) {
      return { dataStatus: "verified", dataStatusLabel: "收盤定案", reason: "第三方完整收盤資料（非直接官方源）", marketDate, sourceVerified: true, sourceType: taiex.source, completeness: "third_party_complete" };
    } else {
      return { dataStatus: "unverified", dataStatusLabel: "未驗證來源", reason: "資料來源尚未確認官方授信", marketDate, sourceVerified: false, sourceType: taiex.source || "unknown", completeness: "unverified" };
    }
  }

  return { dataStatus: "partial", dataStatusLabel: "部分正式", reason: "指數已收盤，法人籌碼資料結算中", marketDate, sourceVerified: taiex.source || "unknown", completeness: "awaiting_inst" };
}

function verifyVolumeStatus(actual, plan) {
  const rawVol = actual?.volume ?? actual?.vol;

  if (rawVol == null) {
    return {
      actualVolume: null,
      volumeStatus: "missing",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（缺少成交量數據）",
      volumeReason: "缺少成交量數據",
      volumeBaseline: null
    };
  }

  if (typeof rawVol !== "number" || !isFinite(rawVol) || rawVol < 0) {
    return {
      actualVolume: null,
      volumeStatus: "invalid",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（成交量數值無效）",
      volumeReason: "成交量數值非有限正數",
      volumeBaseline: null
    };
  }

  if (rawVol === 0) {
    return {
      actualVolume: 0,
      volumeStatus: "zero_volume",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（成交量為 0）",
      volumeReason: "成交量為 0",
      volumeBaseline: null
    };
  }

  const baseObj = (actual?.baseline && typeof actual.baseline === "object") ? actual.baseline
    : (actual?.volumeBaseline && typeof actual.volumeBaseline === "object") ? actual.volumeBaseline
    : (plan?.volumeBaseline && typeof plan.volumeBaseline === "object") ? plan.volumeBaseline
    : null;

  const rawBase = baseObj
    ? (baseObj.volume ?? baseObj.val ?? baseObj.value)
    : (actual?.baselineVolume ?? actual?.volumeBaseline ?? actual?.avgVolume ?? actual?.vol5 ?? actual?.vol20 ?? plan?.volumeBaseline ?? plan?.keyLevels?.expectedVolume ?? null);

  if (rawBase == null || typeof rawBase !== "number" || !isFinite(rawBase) || rawBase <= 0) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（缺少均量比較基準）",
      volumeReason: "缺少有效均量比較基準",
      volumeBaseline: null
    };
  }

  const normUnit = u => {
    if (!u || typeof u !== "string") return null;
    const s = u.trim().toLowerCase();
    if (s === "shares" || s === "股") return "shares";
    if (s === "lots" || s === "張") return "lots";
    if (s === "billion" || s === "億" || s === "100m") return "billion";
    if (s === "contracts" || s === "口") return "contracts";
    return null;
  };

  const actualUnit = normUnit(actual?.volumeUnit ?? actual?.unit);
  const baseUnit = normUnit(baseObj?.unit ?? actual?.baselineUnit ?? actual?.baseUnit ?? plan?.baselineUnit);

  if (!actualUnit || !baseUnit) {
    const missing = !actualUnit && !baseUnit ? "實際量與均量" : (!actualUnit ? "實際量" : "均量");
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（缺少單位中繼資料，基準不可靠）",
      volumeReason: `缺少${missing}單位中繼資料，不可逕行比對`,
      volumeBaseline: rawBase
    };
  }

  if (actualUnit !== baseUnit) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: `量能未驗證（實際量與均量單位不一致：${actualUnit} vs ${baseUnit}）`,
      volumeReason: `實際量單位（${actualUnit}）與均量單位（${baseUnit}）不符，拒絕混用比較`,
      volumeBaseline: rawBase
    };
  }

  const normPeriod = p => {
    if (!p || typeof p !== "string") return null;
    const s = p.trim().toLowerCase();
    if (["full_day", "daily", "post", "close", "全日", "日盤", "收盤"].includes(s)) return "full_day";
    if (["intraday", "live", "spark", "盤中", "即時", "撮合"].includes(s)) return "intraday";
    return null;
  };

  // 不得讓缺少期間中繼的資料自動預設為 full_day 後直接確認量能
  const actualPeriod = normPeriod(actual?.volumePeriod ?? actual?.period ?? (actual?.session === "post" ? "full_day" : actual?.session === "live" ? "intraday" : null));
  const basePeriod = normPeriod(baseObj?.period ?? actual?.baselinePeriod ?? plan?.baselinePeriod);

  if (!actualPeriod || !basePeriod) {
    const missing = !actualPeriod && !basePeriod ? "實際量與均量" : (!actualPeriod ? "實際量" : "均量");
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（缺少期間中繼資料）",
      volumeReason: `缺少${missing}比較期間中繼資料，不可逕行假定為全日成交量`,
      volumeBaseline: rawBase
    };
  }

  if (actualPeriod === "intraday" && basePeriod === "full_day") {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（盤中累積量不可直接與全日均量比較）",
      volumeReason: "盤中累積量未換算，不可直接與全日均量比較",
      volumeBaseline: rawBase
    };
  }

  if (actualPeriod !== basePeriod) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: `量能未驗證（比較期間不相容：${actualPeriod} vs ${basePeriod}）`,
      volumeReason: `實際量期間（${actualPeriod}）與均量期間（${basePeriod}）不相容`,
      volumeBaseline: rawBase
    };
  }

  const actualDate = actual?.date ?? actual?.marketDate;
  const baseDate = baseObj?.date ?? actual?.baselineDate ?? plan?.baselineDate;
  const baseSource = baseObj?.source ?? actual?.baselineSource ?? plan?.baselineSource;

  if (!actualDate || typeof actualDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（缺少行情日期）",
      volumeReason: "缺少行情日期，無法驗證基準有效期限",
      volumeBaseline: rawBase
    };
  }

  if (!baseDate || typeof baseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（缺少均量基準有效日期）",
      volumeReason: "缺少均量基準日期或格式無效，無法確認是否過期",
      volumeBaseline: rawBase
    };
  }

  const tActual = new Date(actualDate).getTime();
  const tBase = new Date(baseDate).getTime();

  if (Number.isNaN(tActual) || Number.isNaN(tBase)) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（日期格式無效）",
      volumeReason: `行情日期（${actualDate}）或基準日期（${baseDate}）無法解析為有效日期`,
      volumeBaseline: rawBase
    };
  }

  if (baseDate > actualDate || tBase > tActual) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（均量基準日期晚於行情日期）",
      volumeReason: `均量日期（${baseDate}）超前於實際行情日期（${actualDate}），存在未來資訊嫌疑`,
      volumeBaseline: rawBase
    };
  }

  if (!baseSource || typeof baseSource !== "string" || !baseSource.trim()) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（缺少均量基準來源）",
      volumeReason: "缺少均量計算來源，基準不可靠",
      volumeBaseline: rawBase
    };
  }

  // 來源受信白名單與政策定義（禁止模糊 substring/includes 比對）
  // 政策理由與依據：
  // 1. 5ma (7天)：5 個交易日為 1 週；考慮週末 2 天，允許上限 7 個日曆天，超過整週無更新即失去 5 日即時性。
  // 2. 20ma (14天)：20 個交易日約為 1 個交易月；考慮連假與雙週跨期，允許上限 14 個日曆天，超過半個月未更新即失真。
  // 3. official (7天)：證交所/櫃買官方週報與統計發布週期為 7 個日曆天。
  // 4. snapshot/prev_day (4天)：盤前快照基準；涵蓋台股常態週末（3天）與 3~4 天連假，開盤當日仍可安全對齊，超過 4 天即廢棄。
  const VOLUME_BASELINE_WHITELIST = {
    "twse_5ma": { type: "5ma", maxDays: 7, label: "5日均量基準", allowedPeriods: ["full_day"] },
    "5ma": { type: "5ma", maxDays: 7, label: "5日均量基準", allowedPeriods: ["full_day"] },
    "tpex_5ma": { type: "5ma", maxDays: 7, label: "5日均量基準", allowedPeriods: ["full_day"] },
    "twse_20ma": { type: "20ma", maxDays: 14, label: "20日均量基準", allowedPeriods: ["full_day"] },
    "20ma": { type: "20ma", maxDays: 14, label: "20日均量基準", allowedPeriods: ["full_day"] },
    "tpex_20ma": { type: "20ma", maxDays: 14, label: "20日均量基準", allowedPeriods: ["full_day"] },
    "twse_official": { type: "official", maxDays: 7, label: "官方均量基準", allowedPeriods: ["full_day"] },
    "tpex_official": { type: "official", maxDays: 7, label: "官方均量基準", allowedPeriods: ["full_day"] },
    "twse_prev": { type: "prev_day", maxDays: 4, label: "盤前快照/前日量基準", allowedPeriods: ["full_day"] },
    "snapshot": { type: "snapshot", maxDays: 4, label: "盤前快照/前日量基準", allowedPeriods: ["full_day", "intraday"] },
    "pre_market": { type: "snapshot", maxDays: 4, label: "盤前快照/前日量基準", allowedPeriods: ["full_day", "intraday"] },
    "pre_market_snapshot": { type: "snapshot", maxDays: 4, label: "盤前快照/前日量基準", allowedPeriods: ["full_day", "intraday"] }
  };

  const srcKey = baseSource.trim().toLowerCase();
  const policy = VOLUME_BASELINE_WHITELIST[srcKey];

  if (!policy) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（均量基準來源不明）",
      volumeReason: `均量來源（${baseSource}）未在受信基準來源清單中，基準不可靠`,
      volumeBaseline: rawBase
    };
  }

  // 驗證均量基準期間是否屬於該來源白名單允許之期間
  if (!policy.allowedPeriods.includes(basePeriod)) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: `量能未驗證（比較期間不相容：${actualPeriod} vs ${basePeriod}）`,
      volumeReason: `來源 ${srcKey} 不支援期間「${basePeriod}」（僅支援：${policy.allowedPeriods.join("、")}）`,
      volumeBaseline: rawBase
    };
  }

  const diffMs = tActual - tBase;
  const diffDays = Math.round(diffMs / 86400e3);

  if (diffDays > policy.maxDays) {
    return {
      actualVolume: rawVol,
      volumeStatus: "unverified",
      volumeConfirmed: false,
      volumeRatio: null,
      volumeLabel: "量能未驗證（均量基準已過期）",
      volumeReason: `均量基準已過期（基準日 ${baseDate} 距行情日 ${actualDate} 達 ${diffDays} 天，已超過 ${policy.label} 之 ${policy.maxDays} 天上限）`,
      volumeBaseline: rawBase
    };
  }

  const ratio = +(rawVol / rawBase).toFixed(2);
  const ratioPct = Math.round(ratio * 100);

  if (ratio >= 1.0) {
    return {
      actualVolume: rawVol,
      volumeStatus: "confirmed",
      volumeConfirmed: true,
      volumeRatio: ratio,
      volumeLabel: `量能已確認（達全日基準量 ${ratioPct}%）`,
      volumeReason: `成交量 ${rawVol} ${actualUnit} 達基準均量 ${rawBase} ${baseUnit} 之 ${ratioPct}%`,
      volumeBaseline: rawBase
    };
  } else {
    return {
      actualVolume: rawVol,
      volumeStatus: "below_average",
      volumeConfirmed: false,
      volumeRatio: ratio,
      volumeLabel: `量能未確認（量能不足，僅達全日基準量 ${ratioPct}%）`,
      volumeReason: `成交量 ${rawVol} ${actualUnit} 僅達基準均量 ${rawBase} ${baseUnit} 之 ${ratioPct}%`,
      volumeBaseline: rawBase
    };
  }
}

function validatePlan(plan, actual) {
  if (!plan || !plan.keyLevels) {
    return {
      status: "missing_pre_market_plan",
      outcomeLabel: "缺少盤前預測，無法進行歷史驗證",
      analysisText: "缺少當日盤前預測快照，無法進行客觀歷史驗證（不可臨時生成預測冒充原始預測）。",
      pressureHit: null,
      supportHit: null,
      metKey: null
    };
  }

  const actualDate = actual?.date ?? actual?.marketDate;
  if (!actualDate) {
    return {
      status: "missing_quote_date",
      outcomeLabel: "缺少行情日期，無法驗證",
      analysisText: "行情資料缺少日期欄位，無法確認是否與預測日期一致，拒絕假定驗證。",
      pressureHit: null,
      supportHit: null,
      metKey: null
    };
  }

  if (plan.tradeDate && actualDate !== plan.tradeDate) {
    return {
      status: "date_mismatch",
      outcomeLabel: "日期不一致，無法驗證",
      analysisText: `行情日期（${actualDate}）與預測快照日期（${plan.tradeDate}）不一致，不同交易日不可混用。`,
      pressureHit: null,
      supportHit: null,
      metKey: null
    };
  }

  const px = actual?.close ?? actual?.price;
  const hi = actual?.high;
  const lo = actual?.low;
  const chg = actual?.chgPct;
  const rawVol = actual?.volume ?? actual?.vol;
  const rawBase = actual?.volumeBaseline ?? actual?.avgVolume ?? actual?.vol5 ?? actual?.vol20 ?? plan?.volumeBaseline ?? plan?.keyLevels?.expectedVolume ?? null;

  if (px == null || hi == null || lo == null || !isFinite(px) || !isFinite(hi) || !isFinite(lo) || px <= 0 || hi <= 0 || lo <= 0) {
    return {
      status: "insufficient_data",
      outcomeLabel: "行情資料不足，無法判定",
      analysisText: "實際行情缺少有效收盤價、最高價或最低價等必要欄位，降級為資料不足，不預設為守穩或未突破。",
      pressureHit: null,
      supportHit: null,
      metKey: null,
      actualVolume: null,
      volumeStatus: "insufficient_quote",
      volumeConfirmed: false,
      volumeLabel: "行情數據不足"
    };
  }

  const { pressure, pivot, support } = plan.keyLevels;
  const pressureHit = hi >= pressure;
  const supportHit = lo <= support;

  let metKey = "neutral";
  let outcomeLabel = "區間震盪（部分符合）";
  let observationText = "";

  if (px >= pressure) {
    metKey = "bull";
    outcomeLabel = pressureHit ? "多方推進情境（部分符合：收盤突破壓力）" : "多方觀察（收盤突破壓力位）";
    observationText = `收盤 ${px.toLocaleString()} 點站上關鍵壓力位 ${pressure.toLocaleString()} 點；盤中高點 ${hi.toLocaleString()} 點觸及壓力。`;
  } else if (px >= pivot) {
    metKey = "bull";
    outcomeLabel = pressureHit ? "多方推進情境（部分符合：達分水嶺且觸及壓力）" : "多方觀察（收盤高於分水嶺，未達壓力位）";
    observationText = `收盤 ${px.toLocaleString()} 點高於分水嶺 ${pivot.toLocaleString()} 點；高點 ${hi.toLocaleString()} 點${pressureHit ? "曾觸及壓力位" : "未達壓力位"}。單憑收盤高於分水嶺不足以判定多方條件全部成立，屬部分符合。`;
  } else if (px < support) {
    metKey = "bear";
    outcomeLabel = supportHit ? "空方防守情境（部分符合：跌破分水嶺並破支撐）" : "空方觀察（收盤低於支撐位）";
    observationText = `收盤 ${px.toLocaleString()} 點跌破關鍵支撐 ${support.toLocaleString()} 點；低點 ${lo.toLocaleString()} 點${supportHit ? "下探跌破支撐" : "曾測支撐"}。`;
  } else {
    metKey = "neutral";
    outcomeLabel = "區間震盪情境（部分符合：分水嶺至支撐拉鋸）";
    observationText = `收盤 ${px.toLocaleString()} 點介於支撐 ${support.toLocaleString()} 點與分水嶺 ${pivot.toLocaleString()} 點之間；低點 ${lo.toLocaleString()} 點${supportHit ? "曾回測支撐" : "守穩支撐"}，高點 ${hi.toLocaleString()} 點${pressureHit ? "曾測壓力" : "未達壓力"}。`;
  }

  // 量能驗證：價格結構與量能確認分開呈現，不以量能硬改價格結構
  const volRes = verifyVolumeStatus(actual, plan);
  const { actualVolume, volumeStatus, volumeConfirmed, volumeRatio, volumeLabel, volumeReason, volumeBaseline } = volRes;

  const chgStr = chg != null && isFinite(chg) ? `（${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%）` : "（漲跌幅未知）";
  const analysisText = `實際收盤 ${px.toLocaleString()} 點${chgStr}。${outcomeLabel}；${observationText}【${volumeLabel}】`;

  return {
    status: "verified",
    metKey,
    outcomeLabel,
    actualClose: px,
    actualHigh: hi,
    actualLow: lo,
    actualVolume,
    volumeStatus,
    volumeConfirmed,
    volumeRatio,
    volumeLabel,
    volumeReason,
    volumeBaseline,
    pressureHit,
    supportHit,
    closeAbovePivot: px >= pivot,
    analysisText,
    planCreatedAt: plan.createdAt
  };
}

function marketSnapshot({
  now = Date.now(),
  date = null,
  G = {},
  market = {},
  flows = {},
  snapshot = null,
  storeObj = null,
  holidays = undefined,
  cal = null,
  calendarStatus = null
} = {}) {
  const timeInfo = resolveTime(now);
  const targetTradeDate = date || timeInfo.twDate;

  const sess = sessionStatus(now, {
    holidays,
    cal,
    calendarStatus,
    tradeDate: targetTradeDate,
    lastTradeDate: market.taiex?.date
  });

  const dataEval = evaluateDataStatus({
    market,
    G,
    session: sess.session,
    tradeDate: targetTradeDate
  });

  const meta = {
    ...sess,
    tradeDate: targetTradeDate,
    marketDate: dataEval.marketDate,
    asOf: timeInfo.asOf,
    updatedAt: market.taiex?.time || market.taiex?.updatedAt || null,
    sourceNote: "證交所／櫃買中心／期交所／Yahoo Finance",
    dataStatus: dataEval.dataStatus,
    dataStatusLabel: dataEval.dataStatusLabel,
    dataStatusReason: dataEval.reason,
    sourceType: dataEval.sourceType,
    sourceVerified: dataEval.sourceVerified,
    completeness: dataEval.completeness,
    storageNote: SNAPSHOT_STORAGE_NOTE
  };

  let plan = null;
  if (snapshot && isValidSnapshot(snapshot, targetTradeDate)) {
    plan = snapshot;
  } else {
    plan = getBriefSnapshot(targetTradeDate, storeObj);
  }

  // 盤前且未有快照時才產生原始預測；盤中或盤後不可臨時編造
  if (!plan && sess.session === "pre") {
    plan = briefScenarios(G, targetTradeDate, market.taiex?.price, {
      source: "盤前預判模型",
      sourceAsOf: meta.asOf,
      refPriceDate: market.taiex?.date || null
    });
    if (isValidSnapshot(plan, targetTradeDate)) {
      saveBriefSnapshot(targetTradeDate, plan, storeObj);
    }
  }

  let validation = null;
  if (market.taiex) {
    validation = validatePlan(plan, {
      price: market.taiex.price,
      close: market.taiex.close ?? market.taiex.price,
      high: market.taiex.high,
      low: market.taiex.low,
      chgPct: market.taiex.chgPct,
      date: market.taiex.date // 不預設回填 targetTradeDate！
    });
  }

  return { meta, market, plan, flows, validation };
}

const briefFlowFmt = v => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)}億`);


/* ---------- 決策中心：核心市場卡、每日早報結論、資料狀態 ---------- */
// 核心數字列：今日市場用 opt.skip 拿掉最上面已經有的加權、opt.more 再補櫃買與台幣（有資料才放）；每張附當天走勢線
const tdSp = A => { const v = (A || []).filter(tdOk); if (v.length < 2) return ""; const mn = Math.min(...v), mx = Math.max(...v); return `<svg class="spark tsp" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="var(--${v.at(-1) >= v[0] ? "up" : "down"})" stroke-width="1.1" vector-effect="non-scaling-stroke" points="${v.map((y, i) => `${(i / (v.length - 1) * 100).toFixed(1)},${(22 - (mx > mn ? (y - mn) / (mx - mn) : 0.5) * 20).toFixed(1)}`).join(" ")}"/></svg>`; };
function coreMarketCardsHtml(market, G, sess, dataEval, opt = {}) {
  const tq = market?.taiex;
  const fq = G?.fut?.night || G?.fut?.quote || market?.futures;
  const us = G?.us?.indices || [];
  const sox = us.find(x => x.code === "^SOX");
  const ixic = us.find(x => x.code === "^IXIC");
  const tsm = (G?.us?.megas || []).find(x => x.code === "TSM");

  const isValidPrice = v => v != null && typeof v === "number" && isFinite(v) && v > 0;

  const skip = new Set(opt.skip || []), sp = (c, arr) => (typeof tsSpark === "function" && typeof W !== "undefined" && W.ixSp?.[c] ? tsSpark(W.ixSp[c]) : tdSp(arr));
  const card = (title, code, obj, fallbackSub = "") => {
    const px = obj?.price ?? obj?.close;
    if (skip.has(code) || (opt.more && !isValidPrice(px))) return ""; // 今日市場的數字列：沒資料的不放，不留「資料暫缺」空格
    if (!obj || !isValidPrice(px)) {
      return `<div class="dh-core-card missing" data-dhcode="${esc(code)}">
        <div class="dh-cc-head"><b>${esc(title)}</b><span class="note">${esc(code)}</span></div>
        <div class="dh-cc-val"><span class="dh-missing-tag">資料暫缺</span></div>
        <div class="dh-cc-sub note">${esc(fallbackSub || "等待連線更新")}</div>
      </div>`;
    }
    const chg = (typeof obj.chg === "number" && isFinite(obj.chg)) ? obj.chg : null;
    const pct = (typeof obj.chgPct === "number" && isFinite(obj.chgPct)) ? obj.chgPct : null;
    const hasValidPct = pct != null;
    const k = hasValidPct ? cls(chg ?? pct) : "";
    const pStr = fmtP(px);
    const pctStr = hasValidPct ? `${pct >= 0 ? "+" : ""}${(+pct).toFixed(2)}%` : "漲跌幅未知";
    const chgStr = chg != null ? `${chg >= 0 ? "+" : ""}${fmtP(chg)}` : "";
    const chgDisplay = hasValidPct ? (chgStr ? `${chgStr} (${pctStr})` : pctStr) : pctStr;

    const dDate = obj.dataDate || obj.date || "";
    const sTime = obj.sourceTime || obj.time || "";
    const src = obj.source || (code.startsWith("^") || code === "TSM" ? "Yahoo Finance" : code === "TXF" ? "期交所" : "證交所／櫃買中心");
    const uMode = obj.updateMode === "live" || sess.session === "live" ? "即時更新" : "盤後確認";
    const subTxt = (dDate && sTime && sTime !== dDate) ? `${dDate.slice(5).replace("-", "/")} ${sTime.slice(0, 5)}` : (sTime || dDate || fallbackSub || "收盤定案");
    const tip = `${title} (${code})｜資料日期：${dDate || "未提供"}｜來源時間：${sTime || "未提供"}｜來源：${src}｜類型：${uMode}`;

    return `<div class="dh-core-card" data-dhcode="${esc(code)}" title="${esc(tip)}">
      <div class="dh-cc-head"><b>${esc(title)}</b><span class="note">${esc(code)}</span></div>
      <div class="dh-cc-body">
        <div class="dh-cc-val ${k}">${pStr}</div>
        <div class="dh-cc-chg ${k}">${esc(chgDisplay)}</div>
      </div>
      <div class="dh-cc-sub note"><span>${esc(subTxt)}</span>${opt.more ? sp(code, obj.spark) : ""}</div>
    </div>`;
  };
  const tw = opt.more && typeof tdGlRows === "function" && typeof W !== "undefined" ? tdGlRows().find(r => r.c === "TWD=X") : null;

  return `<div class="dh-core-grid">
    ${card("加權指數", "T00", tq, sess.isClosed ? "最近交易日收盤" : dataEval.dataStatusLabel)}
    ${card("台指期夜盤", "TXF", fq, fq?.lab || "期交所")}
    ${card("費城半導體", "^SOX", sox, "美股主要指數")}
    ${card("那斯達克", "^IXIC", ixic, "美股主要指數")}
    ${card("台積電 ADR", "TSM", tsm, "美股存託憑證")}
    ${opt.more ? card("櫃買指數", "O00", market?.otc, "") + card("美元／台幣", "TWD=X", tw ? { price: tw.px, chgPct: tw.pct } : null, "") : ""}
  </div>`;
}

function dailyBriefSummaryHtml(G, plan) {
  const us = G?.us?.indices || [];
  const sox = us.find(x => x.code === "^SOX");
  const fut = G?.fut?.night || G?.fut?.quote;
  const p = plan?.keyLevels;

  const isValidPrice = v => v != null && typeof v === "number" && isFinite(v) && v > 0;
  const isSoxValid = Boolean(sox && isValidPrice(sox.close ?? sox.price) && sox.chgPct != null && isFinite(sox.chgPct));
  const isSoxExpired = Boolean(sox && (sox.stale || sox.expired));

  const futPx = fut?.price ?? fut?.close;
  const hasValidFutPrice = Boolean(fut && isValidPrice(futPx));
  const isFutExpired = Boolean(fut && (fut.stale || fut.expired));

  // 台指期漲跌點數判定（嚴格依據真實點數或有效現價與可確認同一合約之前收基準計算，禁止使用固定乘數）
  let fChg = null;
  const rawChg = fut?.chg ?? fut?.changePoints;
  if (typeof rawChg === "number" && isFinite(rawChg)) {
    // 只有來源提供可信且有效的實際漲跌點數時，才可直接採用
    fChg = rawChg;
  } else if (hasValidFutPrice) {
    const prev = fut.prev ?? fut.referencePrice ?? fut.refPrice;
    const curContract = (typeof fut.contract === "string" && fut.contract.trim()) ? fut.contract.trim() : null;
    const prevContract = (typeof fut.prevContract === "string" && fut.prevContract.trim()) ? fut.prevContract.trim() : null;
    // 若任一合約識別資料缺失或兩者不一致，不得自行相減，應回傳未知狀態 (fChg 為 null)
    if (isValidPrice(prev) && curContract && prevContract && curContract === prevContract) {
      fChg = Math.round(futPx - prev);
    }
  }

  const isFutValid = Boolean(fut && hasValidFutPrice && !isFutExpired);

  const missingItems = [];
  if (!isSoxValid) missingItems.push("費半指數行情");
  else if (isSoxExpired) missingItems.push("費半指數過期資料");

  if (!isFutValid) missingItems.push("台指期夜盤行情");
  else if (isFutExpired) missingItems.push("台指期夜盤過期資料");

  let lead = "";
  let upward = "";
  let downward = "";

  if (missingItems.length > 0) {
    lead = `資料不足，暫不判定（缺少必要行情：${missingItems.join("、")}）。`;
    upward = `缺少完整必要行情（${missingItems.join("、")}），暫不對上漲動能做單向研判。`;
    downward = "關鍵數據未齊全，請留意開盤不確定性，以客觀關鍵位階防守為準。";
  } else {
    // Both SOX and Fut are valid and not expired
    const sPct = sox.chgPct;
    const sPctStr = `${sPct >= 0 ? "+" : ""}${sPct.toFixed(2)}%`;

    if (fChg == null) {
      // 來源僅有漲跌幅但無有效基準前收價，或合約不符：顯示「夜盤漲跌點數未知」，不可自行估算，不轉為 0，不偏多或偏空
      lead = `美股費半（${sPctStr}）已更新，夜盤漲跌點數未知，早盤觀察權值股量能與分水嶺防守強度。`;
      if (sPct > 0.5) {
        upward = `費城半導體上漲 +${sPct.toFixed(2)}%，有助台股半導體與 AI 供應鏈開盤動能。`;
      } else if (sPct === 0) {
        upward = "費城半導體收在平盤（0.00%），科技股動能平穩，題材輪動為主。";
      } else if (sPct > 0) {
        upward = `費城半導體微揚 +${sPct.toFixed(2)}%，提供早盤基本支撐動能。`;
      } else {
        upward = "美股半導體偏弱，早盤多方需仰賴內資或金融傳產撐盤。";
      }
      downward = "夜盤漲跌點數未知，期貨端無有效點數依據，需密切留意多空分水嶺防守強度。";
    } else {
      // fChg 有真實點數依據
      // 檢查矛盾訊號
      if ((sPct >= 1.0 && fChg <= -100) || (sPct <= -1.0 && fChg >= 100)) {
        lead = `美股與期貨走勢分歧（費半 ${sPctStr}，夜盤 ${fChg >= 0 ? "+" : ""}${fChg} 點），訊號相互抵銷，早盤偏向多空拉鋸，嚴密觀察分水嶺防守。`;
        upward = sPct >= 1.0 ? `費城半導體大漲 +${sPct.toFixed(2)}%，但期貨夜盤走弱，開盤動能可能受制於避險情緒。` : `期貨夜盤逆勢走揚 +${fChg} 點，支撐早盤開盤表現，惟美股科技股重挫需防補跌。`;
        downward = "市場訊號存在明顯矛盾，避免單向追價，重點在於分水嶺防守位階是否被摜破。";
      } else if (sPct === 0 && fChg === 0) {
        // 真實零漲跌
        lead = "美股主要指數與台指期夜盤收在平盤（0.00% / 0 點），早盤動能中性，觀察開盤量能與位階拉鋸。";
        upward = "費城半導體收在平盤（0.00%），外盤無顯著利空，科技股以個股題材輪動為主。";
        downward = "國際行情無方向指引，權值股缺乏推升力道，需提防量縮拉回回測支撐。";
      } else {
        if (fChg > 50) {
          lead = `台指期夜盤走揚 +${fChg} 點，有利加權早盤開高挑戰關鍵位階。`;
        } else if (fChg < -50) {
          lead = `台指期夜盤走跌 ${fChg} 點，加權早盤面臨回測，留意分水嶺能否守穩。`;
        } else if (fChg === 0) {
          lead = `台指期夜盤收在平盤（0 點），費半變動 ${sPctStr}，早盤預估平穩開出。`;
        } else {
          lead = `美股費半（${sPctStr}）與台指期夜盤（${fChg >= 0 ? "+" : ""}${fChg} 點）已更新，早盤觀察權值股量能與分水嶺防守強度。`;
        }

        if (sPct > 0.5) {
          upward = `費城半導體上漲 +${sPct.toFixed(2)}%，有助台股半導體與 AI 供應鏈開盤動能。`;
        } else if (sPct === 0) {
          upward = "費城半導體收在平盤（0.00%），科技股動能平穩，題材輪動為主。";
        } else if (sPct > 0) {
          upward = `費城半導體微揚 +${sPct.toFixed(2)}%，提供早盤基本支撐動能。`;
        } else {
          upward = "美股半導體偏弱，早盤多方需仰賴內資或金融傳產撐盤。";
        }

        if (sPct < -0.5) {
          downward = `費城半導體下跌 ${sPct.toFixed(2)}%，科技權值股開盤面臨整理壓力。`;
        } else if (sPct === 0) {
          downward = "外部國際無顯著利空催化，主要觀察盤中權值賣壓與量能萎縮風險。";
        } else if (sPct < 0) {
          downward = `費城半導體微幅收低 ${sPct.toFixed(2)}%，留意開盤震盪壓回。`;
        } else {
          downward = "短線漲多乖離或美債殖利率波動風險，需密切留意多空分水嶺防守強度。";
        }
      }
    }
  }

  return `<div class="dh-brief-summary">
    <div class="dh-conclusion-box">
      <div class="dh-cbox-title">💡 今日市場結論與決策核心</div>
      <p class="dh-cbox-lead">${esc(lead)}</p>
    </div>
    <div class="dh-factor-grid">
      <div class="dh-factor bull">
        <div class="dh-fac-head">▲ 主要上漲驅動因素</div>
        <p>${esc(upward)}</p>
      </div>
      <div class="dh-factor bear">
        <div class="dh-fac-head">▼ 主要下跌觀察風險</div>
        <p>${esc(downward)}</p>
      </div>
    </div>
    ${p ? `<div class="dh-brief-levels">
      <span class="note">關鍵觀察指標：</span>
      <span class="dh-lvl pres">壓力 <b>${p.pressure.toLocaleString()}</b></span>
      <span class="dh-lvl piv">分水嶺 <b>${p.pivot.toLocaleString()}</b></span>
      <span class="dh-lvl supp">支撐 <b>${p.support.toLocaleString()}</b></span>
    </div>` : ""}
  </div>`;
}

function briefScenariosHtml(plan) {
  if (!plan?.keyLevels) return `<div class="dh-card"><div class="dh-head"><b>盤前情境推演與分水嶺</b><span class="note">無盤前推演快照</span></div><p class="note">缺少當日盤前預測快照。</p></div>`;
  const { pressure, pivot, support } = plan.keyLevels;
  const sc = plan.scenarios || {};
  return `<div class="dh-card">
    <div class="dh-head"><b>盤前情境推演與分水嶺</b><span class="note">早報推估・不可覆寫保存</span></div>
    <div class="dh-levels">
      <span class="dh-lvl pres">壓力 <b>${pressure.toLocaleString()}</b></span>
      <span class="dh-lvl piv">分水嶺 <b>${pivot.toLocaleString()}</b></span>
      <span class="dh-lvl supp">支撐 <b>${support.toLocaleString()}</b></span>
    </div>
    <div class="sc-grid">
      ${["bull", "neutral", "bear"].map(k => {
        const s = sc[k]; if (!s) return "";
        return `<div class="sc-card ${k}">
          <h5><b>${esc(s.title)}</b><span class="sc-bias ${k}">${{ bull: "站上分水嶺時", neutral: "在區間內時", bear: "跌破分水嶺時" }[k]}</span></h5>
          <p><b>條件：</b>${esc(s.trigger)}</p>
          <p><b>目標：</b>${esc(s.target)}</p>
          <p class="note"><b>失效：</b>${esc(s.invalidation)}</p>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function validateHtml(val, plan) {
  if (!val) {
    const p = plan?.keyLevels;
    return `<div class="dh-card val pending">
      <div class="dh-head"><b>早報情境與盤後驗證時序軸</b><span class="dh-tag live">時序進行中</span></div>
      <p class="dh-val-txt">盤前 08:30 已保存原始推演分水嶺與支撐壓力。盤中撮合中，收盤後將自動比對客觀高低點與收盤價。</p>
      ${p ? `<div class="dh-val-stats">
        <span>分水嶺：<b>${p.pivot.toLocaleString()}</b></span>
        <span>關鍵壓力：<b>${p.pressure.toLocaleString()}</b></span>
        <span>關鍵支撐：<b>${p.support.toLocaleString()}</b></span>
      </div>` : ""}
    </div>`;
  }
  if (val.status === "missing_pre_market_plan") {
    return `<div class="dh-card val"><div class="dh-head"><b>早報情境盤後驗證</b><span class="dh-tag missing">缺少盤前預測</span></div><p class="note">${esc(val.analysisText)}</p></div>`;
  }
  if (val.status === "insufficient_data" || val.status === "date_mismatch" || val.status === "missing_quote_date") {
    return `<div class="dh-card val"><div class="dh-head"><b>早報情境盤後驗證</b><span class="dh-tag missing">${esc(val.outcomeLabel)}</span></div><p class="note">${esc(val.analysisText)}</p></div>`;
  }
  return `<div class="dh-card val">
    <div class="dh-head"><b>早報情境盤後驗證</b><span class="dh-tag ${val.metKey}">${esc(val.outcomeLabel)}</span></div>
    <p class="dh-val-txt">${esc(val.analysisText)}</p>
    <div class="dh-val-stats">
      <span>實際收盤：<b>${val.actualClose.toLocaleString()}</b></span>
      <span>壓力位：<b>${val.pressureHit ? "✓ 曾觸及" : "未觸及"}</b></span>
      <span>支撐位：<b>${val.supportHit ? "⚠ 曾回測" : "✓ 守穩"}</b></span>
      <span>量能判定：<b class="${val.volumeConfirmed ? 'up' : (val.volumeStatus === 'below_average' ? 'down' : 'note')}">${esc(val.volumeLabel || "量能未驗證")}</b></span>
    </div>
  </div>`;
}

// 資金雷達卡（今日市場的盤後）：原本資金雷達的「今日」頁也併在這裡——法人情緒、今天與近 5 日法人買最多的板塊、大戶異常、雷達回放；板塊與個股都可以點
function flowsDecisionHtml(M) {
  const head = d => `<div class="dh-head"><b>資金雷達・板塊輪動與資金流向</b><span class="note">${d || "板塊輪動與法人資金"}</span></div>`;
  const go = `<div class="dh-flow-go"><button type="button" class="btn sm primary" data-tdgo="radar">前往資金雷達完整板塊與矩陣分析 ›</button><button type="button" class="btn sm" data-tdgo="replay">▶ 主力資金雷達回放（近 20 個交易日）</button></div>`;
  // 資金資料這頁只出現在這一張卡（原本盤後總結在下面又寫一次）；還沒有資料時的說明和盤後總結共用 tools.js 的 flowWaitNote
  if (!M) return `<div class="dh-card">${head()}<p class="note">${typeof flowWaitNote === "function" ? flowWaitNote() : "載入法人資金資料…"}</p>${go}</div>`;
  let mood = null;
  try { mood = typeof flowMood === "function" ? flowMood(M) : null; } catch {}
  let A = [];
  try { A = M.secs && typeof flowAt === "function" ? flowAt(M) : []; } catch {}
  let S = [];
  try { S = M.stocks && typeof flowStocks === "function" ? flowStocks(M) : []; } catch {}
  const top = (k, s) => A.filter(x => s * x[k] > 0).sort((a, b) => s * (b[k] - a[k])).slice(0, 3);
  const buy = top("net1", 1), sell = top("net1", -1), buy5 = top("net5", 1);
  const big = S.filter(x => /^\d{4}$/.test(x.code)), bb = big.reduce((m, x) => (!m || x.a1 > m.a1 ? x : m), null), bs = big.reduce((m, x) => (!m || x.a1 < m.a1 ? x : m), null);
  const odd = S.filter(x => x.mult >= 3 && Math.abs(x.a1) >= 3).length;
  const L = (x, v = x.net1) => `<button type="button" class="dh-sec-pill ${v > 0 ? "up" : "down"}" data-tdsec="${esc(x.id)}">${esc(x.name)} <b>${briefFlowFmt(v)}</b></button>`;
  const P = x => `<button type="button" class="dh-sec-pill ${x.a1 > 0 ? "up" : "down"}" data-sel="${esc(x.code)}">${esc(x.name)} <b>${briefFlowFmt(x.a1)}</b></button>`;
  const row = (t, pills, none) => `<div class="dh-fg"><span class="dh-fg-title">${t}</span><div class="dh-fg-pills">${pills || `<span class="note">${none}</span>`}</div></div>`;
  return `<div class="dh-card flows">
    ${head(M.dates?.[M.T - 1]?.slice(5).replace("-", "/"))}
    ${mood ? `<div class="dh-mood-row">
      <span class="dh-mood-badge ${mood.score >= 60 ? "bull" : mood.score <= 40 ? "bear" : "neutral"}">法人情緒 ${mood.score} 分・${mood.label}</span>
      <span class="note">上漲 ${mood.up} 家／下跌 ${mood.dn} 家（漲停 ${mood.lu || 0} / 跌停 ${mood.ld || 0}）</span>
    </div>
    <div class="mbar" role="img" aria-label="法人情緒 ${mood.score} 分（0 恐慌、100 樂觀）"><i style="left:${mood.score}%"></i></div><div class="mlab"><span>恐慌</span><span>樂觀</span></div>
    ${mood.parts ? `<details class="mkmore"><summary>情緒怎麼算的</summary><p class="note">${mood.parts.map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`).join("、")}（各自換成 −1～1 後平均，再換成 0～100）。法人合計 ${briefFlowFmt(mood.net)}。</p></details>` : ""}` : ""}
    ${M.secs && M.stocks ? `<div class="dh-flow-groups">
      ${row("今天法人買最多的板塊：", buy.map(x => L(x)).join(" "), "無顯著流入")}
      ${row("今天法人賣最多的板塊：", sell.map(x => L(x)).join(" "), "無顯著流出")}
      ${row("近 5 日法人買超最多：", buy5.map(x => L(x, x.net5)).join(" "), "近 5 日沒有買超的板塊")}
      ${row("大戶異常（法人單日買賣金額最大）：", [bb?.a1 > 0 ? P(bb) : "", bs?.a1 < 0 ? P(bs) : ""].join(" ").trim(), "沒有明顯的大額買賣")}
    </div>
    <p class="note" style="margin:6px 0">異常爆量個股（成交額逾前 4 日均量 3 倍且逾 3 億）：<b>${odd}</b> 檔${M.T < 10 ? `・目前只有 ${M.T} 個交易日，近 5 日與加速度要 10 天才準` : ""}</p>` : ""}
    ${go}
  </div>`;
}

function nextActionHtml(plan, val) {
  const p = plan?.keyLevels;
  return `<div class="dh-card act">
    <div class="dh-head"><b>下一交易日行動清單與紀律觀察</b></div>
    <ul class="tlist">
      <li><b>關鍵位階觀察：</b>${p ? `以壓力 ${p.pressure.toLocaleString()} 點、分水嶺 ${p.pivot.toLocaleString()} 點、支撐 ${p.support.toLocaleString()} 點為盤勢多空判斷基準。` : "待盤前計算分水嶺與支撐壓力。"}</li>
      <li><b>防守與停損紀律：</b>跌破分水嶺或支撐位時，嚴格審視庫存部位停損與減碼條件，不盲目逆勢攤平。</li>
      <li><b>動能與族群跟隨：</b>關注資金流入續強族群，不追高離乖離過大的過熱標的。</li>
    </ul>
    <p class="note" style="margin-top:4px">註：依據量化指標與公開資訊整理，僅為條件式推演，不是買賣建議。</p>
  </div>`;
}

function todayText() {
  const t = twDay(), P = briefP();
  const plan = getBriefSnapshot(t);
  const tq = W.quotes?.get?.("T00");
  const val = tq?.price ? validatePlan(plan, {
    price: tq.price,
    close: tq.price,
    high: tq.high,
    low: tq.low,
    chgPct: tq.chgPct,
    volume: tq.vol,
    date: tq.date
  }) : null;
  let txt = `📋 KLineLab 今日重點（${t.slice(5).replace("-", "/")} 週${WEEK[new Date(t + "T00:00:00Z").getUTCDay()]})\n`;
  if (P.length) txt += P.map(p => `\n【${p.t}】\n` + p.L.map(x => "• " + x.s).join("\n")).join("\n") + "\n";
  if (plan?.keyLevels) {
    txt += `\n【盤前關鍵價位】\n• 關鍵壓力：${plan.keyLevels.pressure.toLocaleString()} 點\n• 多空分水嶺：${plan.keyLevels.pivot.toLocaleString()} 點\n• 關鍵支撐：${plan.keyLevels.support.toLocaleString()} 點\n`;
  }
  if (val?.outcomeLabel) {
    txt += `\n【早報情境驗證】\n• ${val.analysisText}\n`;
  }
  txt += `\n【盤勢與自選】\n${sumText()}\n\n整理自公開資料，不是買賣建議。`;
  return txt;
}

// 今日市場的展開狀態：外部指定的時段（W.tdPh，例如 #radar/today、資金雷達原本的「今日」、今日重點卡的「看完整」）優先，否則只展開現在的時段
const TD_OPEN = { pre: ["pre", "mac"], live: ["live"], post: ["live", "flow", "sum", "post"], closed: ["pre", "mac", "live"], flow: ["flow"], sum: ["sum"], mine: ["mine"], mac: ["mac"] }; // 收盤後、休市日的「盤後整理」（大盤、自選與訊號）預設打開
function tdOpenState(t, phDef) {
  const want = W.tdPh?.d === t ? W.tdPh.ph : null, ph = want || phDef;
  if (W.tdOpen?.d !== t || W.tdOpen.ph !== ph) W.tdOpen = { d: t, ph, s: Object.fromEntries((TD_OPEN[ph] || []).map(k => [k, true])) };
  return W.tdOpen;
}
// 總經儀表板：早報的「昨晚美股」（美股指數、台積電 ADR、美債、美元指數）整段搬到這裡，盤前推演就不再列一次；
// 原物料外匯（大盤頁的 W.gl）只補早報沒有的台幣、原油、黃金。都是已經載入的資料；展開時沒有原物料外匯才補抓一次（同一支 /api/global，60 秒快取）
const TD_GL = [["TWD=X", "美元／台幣"], ["CL=F", "原油"], ["GC=F", "黃金"]];
const TD_CORE = new Set(["^SOX", "^IXIC", "TSM"]); // 核心卡已經有的，總經裡不再列
const tdUs = () => briefP().filter(p => p.t.startsWith("昨晚美股")).map(p => ({ ...p, L: p.L.filter(x => !TD_CORE.has(x.c)) })).filter(p => p.L.length);
const tdGlRows = () => { const G = W.gl?.ok ? (W.gl.groups || []).flatMap(g => g.rows || []) : []; return TD_GL.map(([c, n]) => { const x = G.find(r => r.code === c); return x?.price != null ? { c, n, px: x.price, pct: x.chgPct } : null; }).filter(Boolean); };
function tdMacSum() {
  const us = W.bf?.us?.ok ? [...(W.bf.us.indices || []), ...(W.bf.us.macro || [])] : [], f = c => us.find(x => x.code === c), dji = f("^DJI"), tnx = f("^TNX"), tw = tdGlRows().find(r => r.c === "TWD=X");
  const L = [dji?.chgPct != null && `道瓊 ${sgn(dji.chgPct, 1)}%`, tnx?.price != null && `美債 ${(+tnx.price).toFixed(2)}%`, tw && `台幣 ${(+tw.px).toFixed(2)}`].filter(Boolean);
  return L.length ? L.join("・") : "昨晚美股、利率、匯率、原物料";
}
function tdMacBody() {
  if (!W.gl && !W.glLoading && typeof loadGlobal === "function" && !W.off) loadGlobal().then(() => { if (W.gl && W.lt === "today") renderList(); }); // 載入中不重複觸發（loadGlobal 載入中會直接結束，重畫又呼叫它會變成無限迴圈）
  const P = tdUs(), R = tdGlRows();
  return `${P.length ? `<div class="bfgrid">${P.map(bfSecHtml).join("")}</div>` : `<p class="note">${W.off ? "需要部署到網站才有美股資料。" : W.bf?.busy ? "載入昨晚美股…" : "暫時沒有昨晚美股的資料。"}</p>`}
    ${R.length ? `<div class="dh-mac">${R.map(r => `<div><span class="note">${r.n}</span><b class="num">${(+r.px).toLocaleString(undefined, { maximumFractionDigits: r.c === "TWD=X" ? 3 : 2 })}</b>${r.pct != null ? `<span class="num ${cls(r.pct)}">${sgn(r.pct, 2)}%</span>` : ""}</div>`).join("")}</div>` : ""}
    <p class="dh-mac-go">${[["us", "美股大盤"], ["gl", "原物料外匯"], ["macro", "總經數據"], ["poly", "預測市場"]].map(([k, n]) => `<button type="button" class="linkbtn" data-tdgo="mkt:${k}">${n} ›</button>`).join("")}</p>
    <p class="note">原物料外匯來自 Yahoo Finance，可能延遲 10～15 分鐘；完整資料與對股市的影響在大盤頁。</p>`;
}
// 展開一個區塊才畫它的內容；全部展開／收合
// 點標題當下就記下來（報價每秒重畫，等 toggle 事件才記，剛好重畫時這一下會被吃掉）；toggle 時沒內容再補畫
document.addEventListener("click", e => { const sm = e.target.closest?.("details[data-tdbox] > summary"); if (!sm || W.lt !== "today" || !W.tdOpen) return; const d = sm.parentElement; W.tdOpen.s[d.dataset.tdbox] = !d.open; }, true);
document.addEventListener("toggle", e => { const d = e.target; if (!d.matches?.("details[data-tdbox]") || W.lt !== "today" || !W.tdOpen) return;
  W.tdOpen.s[d.dataset.tdbox] = d.open; if (d.open && !d.querySelector(".dh-sec-b")) renderList(); }, true);
document.addEventListener("click", e => { const b = e.target.closest("[data-tdall]"); if (!b || W.lt !== "today" || !W.tdOpen) return; const on = b.dataset.tdall === "1";
  for (const k of ["pre", "mac", "live", "flow", "sum", "mine", "post"]) W.tdOpen.s[k] = on; renderList(); });
// 今日市場「盤中」面板最上面一行：盤中監控今天的事件數（事件本體在盤中監控分頁，這裡只連過去）
function monLine() {
  if (typeof monE !== "function") return "";
  const L = Object.values(monE(W.today || twDay())), open = L.filter(e => e.state === "open").length, [st, txt] = monState();
  return `<p class="note dh-monline"><button type="button" class="linkbtn" data-l2mon>盤中監控：${L.length ? `今天 ${L.length} 件${open ? `（${open} 件進行中）` : ""}` : st === "on" ? "目前沒有事件" : esc(txt)} ›</button></p>`;
}
/* ---------- 今日市場的圖：外層看圖（價位、走勢、家數、強弱、行事曆），點開才是文字 ----------
   都用已經載入的資料（報價、W.ixSp 分時、早報、資金、盤中監控事件、行事曆），不新增 API；哪張圖沒資料就不畫，不留空格 */
const tdOk = v => typeof v === "number" && isFinite(v);
const tdMin = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; }; // "09:05" → 545
const tdMinOf = ms => { const t = new Date(ms + 8 * 3600e3); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const tdPctTxt = v => `${v > 0 ? "+" : ""}${(+v).toFixed(2)}%`;
// 正負長條（中線在中間）：rows = [[名稱, 長度用的值, 顯示文字?]]
function tdBars(rows) {
  rows = rows.filter(r => tdOk(r[1])); if (!rows.length) return "";
  const m = Math.max(...rows.map(r => Math.abs(r[1]))) || 1;
  return `<div class="td-bars">${rows.map(([n, v, t]) => { const w = Math.abs(v) / m * 50; return `<div><span class="note">${esc(n)}</span><span class="td-bar"><i class="${v >= 0 ? "up" : "down"}" style="left:${(v >= 0 ? 50 : 50 - w).toFixed(1)}%;width:${Math.max(w, 1).toFixed(1)}%"></i></span><b class="num ${cls(v)}">${esc(t ?? tdPctTxt(v))}</b></div>`; }).join("")}</div>`;
}
// 漲跌家數條
function tdBreadth(mood, d) {
  if (!mood || !tdOk(mood.up) || !tdOk(mood.dn) || mood.up + mood.dn <= 0) return "";
  const t = mood.up + mood.dn;
  return `<div class="td-breadth" role="img" aria-label="上漲 ${mood.up} 家、下跌 ${mood.dn} 家"><div class="td-bb"><i class="up" style="width:${(mood.up / t * 100).toFixed(1)}%"></i><i class="down" style="width:${(mood.dn / t * 100).toFixed(1)}%"></i></div>
    <div class="td-bl note"><span class="up">漲 ${mood.up}${mood.lu ? `・漲停 ${mood.lu}` : ""}</span><span>${d ? `${d} 上市櫃家數` : "上市櫃家數"}</span><span class="down">跌 ${mood.dn}${mood.ld ? `・跌停 ${mood.ld}` : ""}</span></div></div>`;
}
// 同一欄的價位標籤太近會疊在一起：由上往下排，間距至少 gap%
const tdSpread = (L, gap = 13) => { const S = [...L].sort((a, b) => a.y - b.y); for (let i = 1; i < S.length; i++) S[i].y = Math.max(S[i].y, S[i - 1].y + gap); return S; };
// 加權分時：今天的走勢線＋壓力／分水嶺／支撐／昨收＋最高最低＋盤中監控事件的時間點（W.ixSp 是大盤頁走勢線的同一份資料）
function tdIxChart(tq, kl, evs) {
  const S = W.ixSp?.T00;
  if (!S?.pts?.length && typeof loadIxSpark === "function" && !W.off && !W.ixSpBusy) loadIxSpark().then(() => { if (W.lt === "today" && W.ixSp?.T00) renderList(); }); // 抓不到或剛抓過不重畫，不會一直重抓
  const P = (S?.pts || []).map(([t, c]) => [tdMin(t) - 540, c]).filter(([x, c]) => x >= 0 && x <= 270 && tdOk(c));
  if (P.length < 2) return "";
  const prev = tdOk(S.prev) ? S.prev : tq?.prev, L = kl ? [["壓力", kl.pressure, "up"], ["分水嶺", kl.pivot, "piv"], ["支撐", kl.support, "down"]] : [];
  if (tdOk(prev)) L.push(["昨收", prev, "prev"]);
  const vs = [...P.map(p => p[1]), ...L.map(l => l[1])], lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.1 || 1;
  const Y = v => (hi + pad - v) / (hi - lo + 2 * pad) * 100, X = x => x / 270 * 100, f = v => v.toFixed(2);
  const last = P.at(-1), hp = P.reduce((m, p) => (p[1] > m[1] ? p : m)), lp = P.reduce((m, p) => (p[1] < m[1] ? p : m));
  const ev = (evs || []).filter(e => tdOk(e.first)).map(e => [tdMinOf(e.first) - 540, e]).filter(([x]) => x >= 0 && x <= 270);
  const lab = tdSpread(L.map(([n, v, k]) => ({ n, v, k, y: Y(v) })));
  return `<div class="td-ix" role="img" aria-label="加權指數今天的分時走勢，最新 ${fmtP(last[1])}">
    <div class="td-ix-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect class="rest" x="${f(X(last[0]))}" y="0" width="${f(100 - X(last[0]))}" height="100"/>
      ${L.map(([, v, k]) => `<line class="lv ${k}" x1="0" x2="100" y1="${f(Y(v))}" y2="${f(Y(v))}"/>`).join("")}
      ${ev.map(([x, e]) => `<line class="ev ${esc(e.sev)}" x1="${f(X(x))}" x2="${f(X(x))}" y1="0" y2="100"/>`).join("")}
      <polyline class="${last[1] >= (prev ?? P[0][1]) ? "up" : "down"}" points="${P.map(([x, c]) => `${f(X(x))},${f(Y(c))}`).join(" ")}"/>
    </svg>
      ${ev.map(([x, e]) => `<i class="dot ev ${esc(e.sev)}" style="left:${f(X(x))}%;top:0" title="${esc(e.title)}"></i>`).join("")}
      <i class="dot hi" style="left:${f(X(hp[0]))}%;top:${f(Y(hp[1]))}%"></i><span class="td-hl" style="left:${f(Math.min(X(hp[0]), 82))}%;top:${f(Y(hp[1]))}%">高 ${fmtP(hp[1])}</span>
      ${lp !== P[0] && lp[1] < hp[1] ? `<i class="dot lo" style="left:${f(X(lp[0]))}%;top:${f(Y(lp[1]))}%"></i><span class="td-hl lo" style="left:${f(Math.min(X(lp[0]), 82))}%;top:${f(Y(lp[1]))}%">低 ${fmtP(lp[1])}</span>` : ""}
      <i class="dot now" style="left:${f(X(last[0]))}%;top:${f(Y(last[1]))}%"></i>
    </div>
    <div class="td-ix-lv">${lab.map(l => `<span class="${l.k}" style="top:${f(Math.min(l.y, 96))}%">${l.n} <b class="num">${fmtP(l.v)}</b></span>`).join("")}</div>
    <div class="td-ix-t note"><span>09:00</span><span>10:30</span><span>12:00</span><span>13:30</span></div>
  </div>`;
}
// 最上面：加權現在在推估價位的哪一段（只寫位置，不寫偏多偏空——那不是預測）＋開高低＋分時；「怎麼看」說明算法與回測
function tdHero(tq, plan, evs) {
  if (!tdOk(tq?.price)) return "";
  const px = tq.price, kl = plan?.keyLevels, d = kl ? Math.round(px - kl.pivot) : null;
  const pos = kl ? (px >= kl.pressure ? "壓力上方" : px >= kl.pivot ? "分水嶺上方" : px > kl.support ? "分水嶺下方" : "支撐下方") : null;
  const ohl = [["開", tq.open], ["高", tq.high], ["低", tq.low]].filter(([, v]) => tdOk(v) && v > 0);
  return `<div class="td-main">
    <div class="td-head">
      ${pos ? `<div class="td-pos" role="img" aria-label="加權在推估的${pos}，離分水嶺 ${d} 點"><span class="note">現在位置</span><b>${pos}</b><span class="num note">離分水嶺 ${d > 0 ? "+" : ""}${d.toLocaleString()}</span></div>` : ""}
      <div class="td-px"><div><span class="note">加權</span> <b class="num">${fmtP(px)}</b>${tdOk(tq.chg) ? ` <span class="num ${cls(tq.chg)}">${tq.chg > 0 ? "+" : ""}${fmtP(tq.chg)}</span>` : ""}${tdOk(tq.chgPct) ? ` <span class="num ${cls(tq.chgPct)}">${tdPctTxt(tq.chgPct)}</span>` : ""}</div>
        ${ohl.length ? `<div class="note num">${ohl.map(([n, v]) => `${n} ${fmtP(v)}`).join("　")}</div>` : ""}</div>
    </div>
    ${tdIxChart(tq, kl, evs)}
    ${kl ? tdHelp(plan) : ""}
  </div>`;
}
// 盤後分析跟報價不是同一天（例：報價已是 10/29 收盤，資金雷達、盤後總結還是 10/28 的）：收盤後到盤後資料更新前，頂部提醒結論依據哪一天，避免拿前一天的結論看今天的盤
// 盤中不提醒（盤後分析本來就是前一交易日的，區塊標題已寫日期）；兩邊有一邊沒有日期也不提醒
function tdStaleNote(quoteDate, anaDate, session) {
  if (!quoteDate || !anaDate || anaDate >= quoteDate || (session !== "post" && session !== "closed")) return "";
  return `<div class="dh-stale" role="status">⚠️ 盤後分析更新中：目前結論依據 ${esc(anaDate)} 收盤資料，最新報價為 ${esc(quoteDate)}</div>`;
}
// 使用說明：價位怎麼算、準不準（回測數字來自 scripts/levels-bt.mjs，2024-11～2026-10 共 480 個交易日，沒參與調整的那一段）
function tdHelp(plan) {
  const kl = plan.keyLevels, f = plan.macroSignals?.futChg, b = plan.band || {}, n = v => Math.round(v).toLocaleString();
  return `<details class="td-help"><summary>怎麼看這些價位？</summary><ul class="tlist">
    <li><b>分水嶺 ${n(kl.pivot)}</b>：前一交易日收盤${tdOk(f) ? `，加上台指期夜盤漲跌 ${f > 0 ? "+" : ""}${n(f)} 點 × 0.85` : "（這天拿不到夜盤漲跌，就用收盤）"}。盤前算好就固定，盤中不會改。</li>
    <li><b>壓力 ${n(kl.pressure)}、支撐 ${n(kl.support)}</b>：${b.basis === "atr14" ? `分水嶺往上 ${b.up} 倍、往下 ${b.dn} 倍的「加權近 14 日平均波動」（這天約 ${n(b.atr)} 點）。波動大時自動放寬；過去約五年，大約三成的日子盤中碰得到壓力，三成碰得到支撐。` : "分水嶺上下各 0.6%（這天沒抓到近 14 日的日 K，用舊的固定寬度）。"}</li>
    <li><b>「分水嶺上方／下方」只說現在在哪裡，不是預測漲跌</b>：回測近兩年，開盤在分水嶺上方、收盤還留在上方的日子大約只有六成；分水嶺離當天收盤平均約 270 點。上方收跌、下方收漲都很常見。</li>
    <li>也試過加入費半、那斯達克、台積電 ADR 或用更複雜的公式，都沒有比較準，所以維持這個簡單的算法。只是參考，不是買賣建議。</li>
  </ul></details>`;
}
// 盤前推演：昨收 → 開盤 → 現在的實際路徑，再畫情境 A（往壓力）、B（往支撐）；下面是早報用到的美股與夜盤強弱
function tdPreViz(plan, tq) {
  const kl = plan?.keyLevels; if (!kl) return "";
  const pts = [["昨收", tq?.prev], ["開盤", tq?.open], ["現在", tq?.price]].filter(([, v]) => tdOk(v) && v > 0);
  const vs = [kl.pressure, kl.support, ...pts.map(p => p[1])], lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.12 || 1;
  const Y = v => (hi + pad - v) / (hi - lo + 2 * pad) * 100, n = pts.length, X = i => (n > 1 ? i / (n - 1) * 62 : 0), f = v => v.toFixed(2);
  const end = pts.at(-1), up = end ? end[1] >= kl.pivot : null, ms = plan.macroSignals || {}, ref = tq?.prev || kl.pivot;
  const lab = tdSpread([{ n: `A 壓力 ${fmtP(kl.pressure)}`, k: "up", y: Y(kl.pressure) }, { n: `分水嶺 ${fmtP(kl.pivot)}`, k: "piv", y: Y(kl.pivot) }, { n: `B 支撐 ${fmtP(kl.support)}`, k: "down", y: Y(kl.support) }], 16);
  const sc = `<div class="td-sc" role="img" aria-label="盤前推演：情境 A 往壓力 ${kl.pressure}、情境 B 往支撐 ${kl.support}">
    <div class="td-sc-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line class="lv piv" x1="0" x2="100" y1="${f(Y(kl.pivot))}" y2="${f(Y(kl.pivot))}"/>
      ${end ? `<line class="sa${up ? " on" : ""}" x1="${f(X(n - 1))}" y1="${f(Y(end[1]))}" x2="100" y2="${f(Y(kl.pressure))}"/><line class="sb${up === false ? " on" : ""}" x1="${f(X(n - 1))}" y1="${f(Y(end[1]))}" x2="100" y2="${f(Y(kl.support))}"/>` : ""}
      ${n > 1 ? `<polyline class="${end[1] >= pts[0][1] ? "up" : "down"}" points="${pts.map(([, v], i) => `${f(X(i))},${f(Y(v))}`).join(" ")}"/>` : ""}
    </svg>${pts.map(([t, v], i) => `<i class="dot${i === n - 1 ? " now" : ""}" style="left:${f(X(i))}%;top:${f(Y(v))}%"></i><span class="td-sc-x note" style="left:${f(X(i))}%">${t}</span>`).join("")}</div>
    <div class="td-ix-lv">${lab.map(l => `<span class="${l.k}" style="top:${f(Math.min(l.y, 94))}%">${l.n}</span>`).join("")}</div>
  </div>`;
  const dr = tdBars([["費半", ms.sox], ["那斯達克", ms.ixic], ["台積電 ADR", ms.tsm], ["台指期夜盤", tdOk(ms.futChg) && ref ? ms.futChg / ref * 100 : null, tdOk(ms.futChg) ? `${ms.futChg > 0 ? "+" : ""}${Math.round(ms.futChg)} 點` : null]]);
  return sc + (dr ? `<div class="td-cap note">早報用到的美股與夜盤</div>${dr}` : "");
}
// 總經：美股指數、利率、美元（早報）＋台幣、原油、黃金（原物料外匯）；費半、那斯達克、台積電 ADR 在上面的數字列
function tdMacViz() {
  const us = W.bf?.us?.ok ? [...(W.bf.us.indices || []), ...(W.bf.us.macro || [])].filter(x => !TD_CORE.has(x.code)) : [];
  const nm = { "^DJI": "道瓊", "^GSPC": "S&P 500", "^TNX": "美 10 年債", "DX-Y.NYB": "美元指數", "^VIX": "VIX", "^RUT": "羅素 2000", "^NDX": "NASDAQ-100" };
  const R = [...us.map(x => [nm[x.code] || x.name || x.code, x.chgPct, x.code === "^TNX" && tdOk(x.price) ? `${(+x.price).toFixed(2)}%` : null]), ...tdGlRows().map(r => [r.n, r.pct, r.c === "TWD=X" ? (+r.px).toFixed(2) : null])];
  return tdBars(R.filter(r => tdOk(r[1])).slice(0, 9));
}
// 盤中（盤後）：今天盤中監控事件的時間軸＋自選與庫存的熱度格（顏色深淺是漲跌幅，框起來的是庫存）
function tdLiveViz(evs, hold, pm) {
  const now = pm ? 270 : Math.min(Math.max(tdMinOf(Date.now()) - 540, 0), 270), X = x => (x / 270 * 100).toFixed(1);
  const ev = (evs || []).filter(e => tdOk(e.first)).map(e => [tdMinOf(e.first) - 540, e]).filter(([x]) => x >= 0 && x <= 270);
  const H = new Set(hold), L = [...new Set([...hold, ...myCodes()])].filter(c => !isIdx(c)).map(c => [c, W.quotes.get(c)?.chgPct]).filter(([, v]) => tdOk(v)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 12);
  const tl = `<div class="td-tl" role="img" aria-label="今天盤中監控 ${ev.length} 件"><div class="td-tl-bar"><i style="width:${X(now)}%"></i>${ev.map(([x, e]) => `<b class="${esc(e.sev)}" style="left:${X(x)}%" title="${esc(e.title)}"></b>`).join("")}</div><div class="td-ix-t note"><span>09:00</span><span>${ev.length ? `監控 ${ev.length} 件` : "盤中監控"}</span><span>13:30</span></div></div>`;
  const heat = L.length ? `<div class="td-heat">${L.map(([c, v]) => `<span class="${v >= 0 ? "up" : "down"}${H.has(c) ? " own" : ""}" style="--a:${(Math.min(Math.abs(v) / 5, 1) * 0.75 + 0.12).toFixed(2)}"><em>${esc(nameOf(c) || c)}</em><b class="num">${tdPctTxt(v)}</b></span>`).join("")}</div>` : "";
  return tl + heat;
}
// 資金雷達：近 5 日法人買超最多 3 個、賣超最多 2 個板塊＋大戶異常（今天的情緒與板塊在「盤後總結」）
function tdFlowViz(M) {
  if (!M) return "";
  let A = [], S = []; try { A = M.secs && typeof flowAt === "function" ? flowAt(M) : []; } catch {} try { S = M.stocks && typeof flowStocks === "function" ? flowStocks(M) : []; } catch {}
  const top = s => A.filter(x => tdOk(x.net5) && s * x.net5 > 0).sort((a, b) => s * (b.net5 - a.net5));
  const R = [...top(1).slice(0, 3), ...top(-1).slice(0, 2).reverse()].map(x => [x.name, x.net5, briefFlowFmt(x.net5)]);
  const big = S.filter(x => /^\d{4}$/.test(x.code) && tdOk(x.a1)), bb = big.reduce((m, x) => (!m || x.a1 > m.a1 ? x : m), null), bs = big.reduce((m, x) => (!m || x.a1 < m.a1 ? x : m), null);
  const bg = [bb?.a1 > 0 && `<span class="up">▲ ${esc(bb.name)} ${briefFlowFmt(bb.a1)}</span>`, bs?.a1 < 0 && `<span class="down">▼ ${esc(bs.name)} ${briefFlowFmt(bs.a1)}</span>`].filter(Boolean);
  return R.length || bg.length ? `${R.length ? `<div class="td-cap note">近 5 日法人買賣超（板塊）</div>${tdBars(R)}` : ""}${bg.length ? `<div class="td-big note">大戶異常 ${bg.join("")}</div>` : ""}` : "";
}
// 盤後總結：當天的計分板——加權、漲跌家數、法人情緒、異常個股＋今天法人買賣最多的板塊（文字與分享選項在點開後）
function tdSumViz(M, tq) {
  if (!M) return "";
  let mood = null, A = [], S = []; try { mood = typeof flowMood === "function" ? flowMood(M) : null; } catch {} try { A = M.secs && typeof flowAt === "function" ? flowAt(M) : []; } catch {} try { S = M.stocks && typeof flowStocks === "function" ? flowStocks(M) : []; } catch {}
  const d = M.dates?.[M.T - 1], ix = tq?.date === d && tdOk(tq?.chgPct) ? tq.chgPct : null, odd = S.filter(x => x.mult >= 3 && Math.abs(x.a1) >= 3).length;
  const g = mood && tdOk(mood.score) ? (() => { const a = Math.PI * (1 - mood.score / 100), x = 30 + 24 * Math.cos(a), y = 30 - 24 * Math.sin(a); return `<svg viewBox="0 0 60 34" aria-hidden="true"><path class="bg" d="M6 30A24 24 0 0 1 54 30"/><path class="${mood.score >= 50 ? "up" : "down"}" d="M6 30A24 24 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}"/></svg>`; })() : "";
  const K = [ix != null && [`加權`, `<b class="num ${cls(ix)}">${tdPctTxt(ix)}</b>`, ""],
    mood && tdOk(mood.up) && [`漲／跌家數`, `<b class="num"><span class="up">${mood.up}</span>／<span class="down">${mood.dn}</span></b>`, mood.lu || mood.ld ? `漲停 ${mood.lu || 0}・跌停 ${mood.ld || 0}` : ""],
    mood && tdOk(mood.score) && [`法人情緒`, `<span class="td-gauge">${g}<b class="num">${mood.score}</b></span>`, esc(mood.label)],
    S.length && [`異常個股`, `<b class="num">${odd}</b>`, "法人金額放大 3 倍"]].filter(Boolean);
  const top = s => A.filter(x => tdOk(x.net1) && s * x.net1 > 0).sort((a, b) => s * (b.net1 - a.net1));
  const R = [...top(1).slice(0, 3), ...top(-1).slice(0, 3).reverse()].map(x => [x.name, x.net1, briefFlowFmt(x.net1)]);
  return K.length || R.length ? `${K.length ? `<div class="td-kpi">${K.map(([n, v, sub]) => `<div><span class="note">${n}</span>${v}${sub ? `<small class="note">${sub}</small>` : ""}</div>`).join("")}</div>` : ""}${R.length ? `<div class="td-cap note">今天法人買賣最多的板塊</div>${tdBars(R)}` : ""}` : "";
}
// 我的重點：接下來 7 個交易日的小行事曆，點是庫存、自選的法說會、除權息、ETF 換股、事件提醒
function tdMineViz(t, mine) {
  const days = [t]; while (days.length < 7) days.push(nextWd(days.at(-1)));
  const E = {}, add = (d, k) => { if (days.includes(d)) (E[d] ||= []).push(k); };
  for (const x of W.cal?.rows || []) if (mine.has(x.code)) add(x.date, "div");
  for (const x of W.cal?.conf || []) if (mine.has(x.code)) add(x.date, "conf");
  for (const [c, x] of Object.entries(W.etfH || {})) if (mine.has(c) && x?.j) for (const e of etfEvOf(x.j, t, 0)) add(e.d, "etf");
  for (const x of (W.evHits || []).filter(x => x.kind !== "etf")) add(t, "ev");
  const K = [["conf", "法說會"], ["div", "除權息"], ["etf", "ETF 換股"], ["ev", "事件"]], cnt = k => Object.values(E).flat().filter(x => x === k).length;
  return `<div class="td-cal" role="img" aria-label="接下來 7 個交易日的事件">${days.map((d, i) => `<span class="${i ? "" : "today"}"><em>${WEEK[new Date(d + "T00:00:00Z").getUTCDay()]}</em><b class="num">${+d.slice(8)}</b><i>${(E[d] || []).slice(0, 4).map(k => `<u class="${k}"></u>`).join("")}</i></span>`).join("")}</div>
    <div class="td-legend note">${K.map(([k, n]) => `<span><u class="${k}"></u>${n} ${cnt(k)}</span>`).join("")}</div>`;
}
// 收盤驗證：今天交易時間走到哪＋目前對照推演的結果
function tdPostViz(tq, kl, val, pm) {
  const now = pm ? 270 : Math.min(Math.max(tdMinOf(Date.now()) - 540, 0), 270), px = tq?.price;
  return `<div class="td-tl"><div class="td-tl-bar"><i style="width:${(now / 270 * 100).toFixed(1)}%"></i></div><div class="td-ix-t note"><span>09:00</span><span>${pm ? "已收盤" : `還有 ${Math.floor((270 - now) / 60)} 小時 ${(270 - now) % 60} 分`}</span><span>13:30</span></div></div>
    ${kl && tdOk(px) ? `<div class="td-chk note">${[["站上分水嶺", px >= kl.pivot], ["突破壓力", px >= kl.pressure], ["守住支撐", px > kl.support]].map(([n, ok]) => `<span class="${ok ? "on" : ""}"><u></u>${n}</span>`).join("")}</div>` : ""}`;
}
// 加權近 14 日平均波動（推估壓力、支撐用）：同一個目標日只抓一次日 K（tools.js 的 dailyFresh，5 分鐘快取）
function tdAtrFor(t) {
  if (W.ixAtr?.t === t) return W.ixAtr;
  if (typeof dailyFresh !== "function" || W.off) return (W.ixAtr = { t, state: "fail" });
  W.ixAtr = { t, state: "loading" };
  dailyFresh("T00").then(D => { const a = briefAtr14(D, t); W.ixAtr = a ? { t, state: "ok", atr: a } : { t, state: "fail" }; if (W.lt === "today") renderList(); });
  return W.ixAtr;
}
function todayPage() {
  const nowMs = Date.now();
  const t = twDay(), cn = typeof twClosedNote === "function" ? twClosedNote(W.quotes?.get?.("T00")?.date) : null, pm = tdAfter(nowMs), C = W.syncCfg;
  const tq = W.quotes?.get?.("T00");
  const oq = W.quotes?.get?.("O00");
  const fq = W.quotes?.get?.("TXF");
  // 休市日表：行事曆載入了就用它，還沒有就用看盤一打開就抓的那份（core.js 的 TWHOL）
  const holL = W.cal?.hol || (typeof TWHOL !== "undefined" && TWHOL.set ? [...TWHOL.set].map(date => ({ date })) : undefined);
  const sess = sessionStatus(nowMs, { holidays: holL, lastTradeDate: tq?.date });

  const market = {
    taiex: tq ? {
      code: "T00",
      name: "加權指數",
      price: tq.price,
      close: tq.price,
      high: tq.high,
      low: tq.low,
      chg: tq.chg,
      chgPct: tq.chgPct,
      volume: tq.vol,
      date: tq.date,
      time: tq.time,
      source: tq.source || "twse"
    } : null,
    otc: oq ? {
      code: "O00",
      name: "櫃買指數",
      price: oq.price,
      chg: oq.chg,
      chgPct: oq.chgPct,
      date: oq.date
    } : null,
    futures: fq ? {
      code: "TXF",
      name: "台指期",
      price: fq.price,
      chg: fq.chg,
      chgPct: fq.chgPct,
      date: fq.date
    } : null
  };

  const dataEval = evaluateDataStatus({
    market,
    G: W.bf || {},
    session: sess.session,
    tradeDate: t
  });

  // 週末、休市日：盤前推演以下一個交易日為目標（以最近交易日收盤推估）；盤後驗證對照「報價那一天」的快照，不拿休市日的推演去比
  const target = sess.session === "closed" ? findNextTradeDate(t, holL || []) || t : t;
  let plan = getBriefSnapshot(target);
  if (!plan && (target !== t || sess.session === "pre" || !pm)) {
    const A = tdAtrFor(target); // 近 14 日平均波動還在抓：先畫、不存快照（快照存了就不改），抓到或確定抓不到才存
    plan = briefScenarios(W.bf, target, tq?.price, { atr: A.atr });
    if (plan && A.state !== "loading") saveBriefSnapshot(target, plan);
  }
  const vPlan = tq?.date ? (tq.date === target ? plan : getBriefSnapshot(tq.date)) : null;
  briefSnapGc();

  const val = tq?.price ? validatePlan(vPlan, {
    price: tq.price,
    close: tq.price,
    high: tq.high,
    low: tq.low,
    chgPct: tq.chgPct,
    volume: tq.vol,
    date: tq.date
  }) : null;
  const M = typeof mfModel === "function" ? mfModel() : null;

  // 下面的區塊固定照一天的順序排（盤前推演 → 總經 → 盤中 → 資金 → 我的重點 → 收盤驗證），一開始只展開「現在」那一塊；
  // 展開、收合記在記憶體（同一天），不存瀏覽器。區塊收合時不畫內容，展開才畫（toggle 事件裡重畫）
  const phDef = { pre: "pre", live: "live", post: "post", closed: "closed" }[sess.session] || (sess.hm < "09:00" ? "pre" : pm ? "post" : "live");
  const O = tdOpenState(t, phDef), when = { live: "盤中", pre: "前一交易日盤後", closed: "最近交易日盤後", post: "盤後" }[sess.session] || (pm ? "盤後" : "盤中"), sumHead = `<h4 class="tdsec">${when}・大盤、自選與訊號</h4>${sumBody()}`;
  const mine = todayParts().filter(([k]) => k !== "盤勢"), mon = typeof monE === "function" ? Object.values(monE(W.today || t)) : [], alerts = mon.filter(e => e.sev === "alert" && e.state === "open").length;
  const hold = Object.keys(W.hold || {}).filter(c => !W.hold[c]?.demo), D = todayData({ mine: new Set([...hold, ...myCodes()]), pct: c => (isIdx(c) ? null : W.quotes.get(c)?.chgPct), cal: null, today: t });
  const kl = plan?.keyLevels, A = M?.secs && typeof flowAt === "function" ? (() => { try { return flowAt(M); } catch { return []; } })() : [];
  const inS = A.filter(x => x.net1 > 0).sort((a, b) => b.net1 - a.net1)[0], outS = A.filter(x => x.net1 < 0).sort((a, b) => a.net1 - b.net1)[0];
  const SEC = [
    ["pre", "盤前推演", kl ? `分水嶺 ${kl.pivot.toLocaleString()}・支撐 ${kl.support.toLocaleString()}・壓力 ${kl.pressure.toLocaleString()}` : "昨晚台指期、今天的行事曆與推估價位", () => `
      ${target !== t && plan ? `<p class="note">今天休市，下面是下一交易日 ${target.slice(5).replace("-", "/")}（週${WEEK[new Date(target + "T00:00:00Z").getUTCDay()]}）的盤前推演${tq?.date ? `，以 ${tq.date.slice(5).replace("-", "/")} 收盤推估` : ""}。</p>` : ""}
      ${briefScenariosHtml(plan)}
      ${dailyBriefSummaryHtml(W.bf, plan)}
      <div class="dh-card">${briefBody(["昨晚美股"])}</div>`, () => tdPreViz(plan, tq)],
    ["mac", "總經儀表板", tdMacSum(), () => tdMacBody(), () => tdMacViz()],
    ["live", when === "盤中" ? "盤中動態" : when === "盤後" ? "盤後整理" : `${when}整理`, `${alerts ? `■ 警示 ${alerts} 件・` : mon.length ? `事件 ${mon.length} 件・` : ""}${D.n ? `自選與庫存 ${D.up} 漲 ${D.dn} 跌` : "大盤、自選與訊號"}`, () => `${monLine()}${sumHead}`, () => tdLiveViz(mon, hold, pm || sess.session === "closed")],
    ["flow", "資金雷達", inS || outS ? [inS && `${inS.name}流入`, outS && `${outS.name}流出`].filter(Boolean).join("、") : "法人資金與板塊輪動", () => flowsDecisionHtml(M), () => tdFlowViz(M)], // 資料狀態只在內容說一次
    ["sum", "盤後總結", M ? `${M.dates?.[M.T - 1]?.slice(5).replace("-", "/") || ""} 收盤後的一天整理` : "收盤後整理當天的盤面", () => (M && typeof sumFlowHtml === "function" ? sumFlowHtml(M) : `<p class="note">資金雷達有資料以後，這裡會把當天的漲跌家數、情緒與板塊整理成一段話（資料狀態見「資金雷達」）。</p>`), () => tdSumViz(M, tq)],
    ["mine", "我的重點", mine.length ? mine.map(([k]) => k).join("・") : "庫存與自選今天沒有特別的事", () => mine.length ? `<ul class="tdlist">${mine.map(([k, v]) => `<li><span class="tdk">${k}</span><span class="tdv">${v}</span></li>`).join("")}</ul>` : `<p class="note">庫存與自選今天沒有大漲跌、除權息、法說會、ETF 換股或事件提醒。</p>`, () => tdMineViz(t, new Set([...hold, ...myCodes()]))],
    ["post", "收盤驗證與下一步", val?.outcomeLabel || (pm ? "收盤後對照盤前推演" : "13:30 收盤後對照盤前推演"), () => `${validateHtml(val, vPlan)}${nextActionHtml(plan, val)}`, () => tdPostViz(tq, kl, val, pm || sess.session === "closed")]
  ];
  const now = { pre: "pre", live: "live", post: "post", closed: "pre" }[sess.session] || phDef, all = SEC.every(([k]) => O.s[k]);
  // 每一塊外層是圖（.dh-sec-v），點開才畫文字（.dh-sec-b）；圖畫不出來（沒有資料）就只剩一行摘要
  const viz = f => { try { return f() || ""; } catch (e) { console.warn("today viz", e); return ""; } };
  const secs = SEC.map(([k, name, sum, body, v]) => { const g = viz(v); return `<details class="dh-sec dh-sec-${k}${k === now ? " now" : ""}" data-tdbox="${k}"${O.s[k] ? " open" : ""}><summary><span class="dh-sec-t"><b>${name}</b>${k === now ? `<span class="dh-now">・現在</span>` : ""}</span><span class="dh-sec-s note">${esc(sum)}</span>${g ? `<span class="dh-sec-v">${g}</span>` : ""}</summary>${O.s[k] ? `<div class="dh-sec-b">${body()}</div>` : ""}</details>`; }).join("");

  const h = `<section class="csec td-page" data-nofold><!-- 區塊本來就能收合，不再被長內容自動收合整頁蓋掉 -->
    <h3 class="td-vh">今日市場</h3>
    <!-- 狀態列：時段、資料狀態、時間、盤中警示；右邊三個圖示按鈕（文字給讀螢幕的人） -->
    <div class="dh-status-bar">
      <div class="dh-sb-left">
        <span class="dh-badge ${sess.session}">${sess.label}</span>
        <span class="dh-tag status-${dataEval.dataStatus}">${dataEval.dataStatusLabel}</span>
        <span class="note">${sess.hm}・${t.slice(5).replace("-", "/")} 週${WEEK[new Date(t + "T00:00:00Z").getUTCDay()]}</span>
        ${alerts ? `<button type="button" class="dh-badge mon-alert" data-l2mon>■ 警示 ${alerts} 件 ›</button>` : ""}
      </div>
      <div class="dh-title-btns">
        <button type="button" class="td-ib" data-tx="tdre" title="重新整理">↻<span class="td-vh">重新整理</span></button>
        <button type="button" class="td-ib" data-tx="tdai" title="AI 整理">${ico("ai")}<span class="td-vh">AI 整理</span></button>
        <button type="button" class="td-ib" data-tx="tdtxt" title="複製文字">${ico("copy")}<span class="td-vh">複製文字</span></button>
        ${M ? `<button type="button" class="td-ib" data-mshare="share" title="分享今日盤面（圖片）">${ico("share")}<span class="td-vh">分享今日盤面</span></button>` : ""}
      </div>
    </div>
    ${tdStaleNote(tq?.date, M?.dates?.[M.T - 1], sess.session === "unknown" && pm ? "post" : sess.session)}
    ${sess.displayNote || cn ? `<div class="dh-note-bar note">📅 ${esc(sess.displayNote || cn[1])}</div>` : ""}
    ${W.tdAI ? `<div class="caibox">${W.tdAI.loading ? "AI 整理中…" : W.tdAI.err ? "⚠︎ " + esc(W.tdAI.err) : esc(W.tdAI.text).replace(/\n/g, "<br>")}</div>` : ""}
    <!-- 盤勢：位置燈號、加權與分時（左）；漲跌家數、其他核心數字（右，手機在下面） -->
    <div class="td-hero">
      ${tdHero(tq, plan, mon)}
      <div class="td-side">
        ${(() => { let mood = null; try { mood = M && typeof flowMood === "function" ? flowMood(M) : null; } catch {} return tdBreadth(mood, M?.dates?.[M.T - 1]?.slice(5).replace("-", "/")); })()}
        ${coreMarketCardsHtml(market, W.bf, sess, dataEval, { skip: tdOk(tq?.price) ? ["T00"] : [], more: true })}
      </div>
    </div>

    <!-- 詳細：固定順序的收合區塊，一開始只展開現在的時段 -->
    <div class="dh-secbar"><span class="note">外面看圖，點一塊看詳細文字</span><button type="button" class="linkbtn" data-tdall="${all ? "0" : "1"}">${all ? "全部收合" : "全部展開"}</button></div>
    <div class="dh-secs">${secs}</div>

    <!-- 細節：資料來源、資料透明度明細、本機儲存限制與免責（預設收起來） -->
    <details class="dh-more"><summary>資料資訊・來源與說明</summary>
      <div class="mk-dinfo-grid">
        <div><span>加權指數</span><b>${esc(tq?.date || "—")} ${esc(tq?.time || "")}（${esc(tq?.source || "證交所 MIS")}・${esc(dataEval.dataStatusLabel)}）</b></div>
        <div><span>櫃買指數</span><b>${esc(oq?.date || "—")} ${esc(oq?.time || "")}（${esc(oq?.source || "櫃買中心")}）</b></div>
        <div><span>台指期</span><b>${esc(fq?.date || "—")} ${esc(fq?.time || "")}（期交所）</b></div>
        <div><span>美股主要指數</span><b>${esc(W.bf?.us?.date || "—")} ${esc(W.bf?.us?.sourceTime || "")}（Yahoo Finance）</b></div>
        <div><span>關鍵價位模型</span><b>盤前快照推算（分水嶺／壓力／支撐屬模型推論，非官方即時行情）</b></div>
      </div>
      <p class="note">資料來源：Yahoo Finance、期交所、證交所、公開資訊觀測站；盤前推演快照暫存於瀏覽器 LocalStorage，更換裝置或清除瀏覽紀錄時不會同步保留；所有指標由程式客觀計算，僅供研究參考，不構成證券投資顧問或個股買賣建議。</p>
    </details>
    ${C?.kv && C?.tg ? `<p class="note">想每天在手機收到：<button type="button" class="linkbtn" data-tgone>📲 推到 Telegram</button>（早上早報、收盤後重點）。</p>` : ""}
  </section>`;
  return { h, note: "整理自 Yahoo Finance、期交所、證交所、公開資訊觀測站、新聞標題與即時報價；盤前預判快照存於本機瀏覽器 LocalStorage，清除瀏覽紀錄或跨裝置時不會同步；只是摘要，不是買賣建議。" };
}


/* ---------- 今日重點卡（自選分頁最上面）：盤勢一句話、持股／自選大漲跌、今明兩天的除權息與法說會、事件提醒、追蹤節目的新整理；點了直接過去 ---------- */
// 只用已經載好的資料（報價、行事曆、總經消息、節目索引）；行事曆、總經消息沒有的話背景補抓一次（30 分鐘內不重抓）
// 今日重點的內容（網頁的今日重點卡、收盤後 Telegram「收盤重點」共用，scripts/alerts-push.mjs 透過 _engine.mjs 載入）
// mine 是自選＋庫存的代號、pct(代號) 回傳漲跌%（指數回 null）、cal 是 /api/calendar 的 { rows, conf }、etf 是 ETF 代號 → etf-hold 檔
function todayData({ mine, pct, cal, etf = {}, today = twDay() }) {
  const t1 = nextWd(today), M = [...mine], P = M.map(c => [c, pct(c)]).filter(([, v]) => v != null && isFinite(v));
  return { today, t1, n: P.length, up: P.filter(([, v]) => v > 0).length, dn: P.filter(([, v]) => v < 0).length,
    mv: P.filter(([, v]) => Math.abs(v) >= 3).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])),
    cal: [...(cal?.rows || []).map(x => [x, x.kind || "除權息"]), ...(cal?.conf || []).map(x => [x, "法說會"])].filter(([x]) => mine.has(x.code) && (x.date === today || x.date === t1)),
    ee: M.filter(c => etf[c]).flatMap(c => etfEvOf(etf[c], today, 3).map(x => [c, x])) }; // 持有／自選的 ETF 近 3 天換股
}
// Telegram「收盤重點」的文字；ev 是 evScan 的事件訊息
function closeText(D, names = {}, ev = []) {
  const nm = c => names[c] || c, pc = v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`, L = [];
  if (D.n) L.push(`自選與庫存 ${D.n} 檔：上漲 ${D.up}、下跌 ${D.dn}`);
  if (D.mv.length) L.push(`大漲跌：${D.mv.slice(0, 6).map(([c, v]) => `${nm(c)} ${pc(v)}`).join("、")}${D.mv.length > 6 ? ` 等 ${D.mv.length} 檔` : ""}`);
  if (D.cal.length) L.push(`今明兩天：${D.cal.slice(0, 6).map(([x, w]) => `${x.date === D.today ? "今天" : "明天"} ${nm(x.code)} ${w}`).join("、")}`);
  if (D.ee.length) L.push(`ETF 換股：${D.ee.slice(0, 3).map(([c, x]) => `${nm(c)} ${etfEvTxt(x)}`).join("、")}`);
  for (const m of ev.slice(0, 5)) L.push(m);
  return L.length ? `📋 今日收盤重點（${D.today.slice(5).replace("-", "/")}）\n` + L.map(x => "• " + x).join("\n") : "";
}
function todayParts() {
  const P = [], hold = Object.keys(W.hold || {}).filter(c => !W.hold[c]?.demo), mine = new Set([...hold, ...myCodes()]), t = twDay(), nm = c => nameOf(c) || c;
  const ix = W.quotes.get("T00")?.chgPct, S = W.mn?.days?.[0]?.tw?.sum, EH = W.etfH || {};
  const D = todayData({ mine, pct: c => (isIdx(c) ? null : W.quotes.get(c)?.chgPct), cal: W.cal, etf: Object.fromEntries(Object.entries(EH).filter(([, x]) => x?.j).map(([c, x]) => [c, x.j])), today: t });
  // 加權漲跌是行情數字；後面那句是 AI 依新聞整理的，標出來（行情拿不到時這一列改叫「新聞」，不當成盤勢）
  if (ix != null || S?.head) P.push([ix != null ? "盤勢" : "新聞", `<button class="linkbtn" data-tdgo="mkt">${ix != null ? `加權 <b class="${cls(ix)}">${sgn(ix, 2)}%</b>${S?.head ? "　" : ""}` : ""}${S?.head ? (typeof aiTag === "function" ? aiTag() : "") + esc(S.head) : ""}</button>`]);
  if (D.mv.length) P.push(["大漲跌", D.mv.slice(0, 4).map(([c, v]) => `<button class="linkbtn" data-sel="${esc(c)}">${hold.includes(c) ? "★" : ""}${esc(nm(c))} <b class="${cls(v)}">${sgn(v, 1)}%</b></button>`).join("、") + (D.mv.length > 4 ? ` 等 ${D.mv.length} 檔` : "")]);
  if (D.cal.length) P.push(["今明兩天", D.cal.slice(0, 5).map(([x, w]) => `<button class="linkbtn" data-sel="${esc(x.code)}">${x.date === t ? "今天" : "明天"} ${esc(nm(x.code))} ${w}</button>`).join("、")]);
  if (D.ee.length) P.push(["ETF 換股", D.ee.slice(0, 3).map(([c, x]) => `<button class="linkbtn" data-sel="${esc(c)}">${esc(nm(c))} ${esc(etfEvTxt(x))}</button>`).join("、")]);
  const evh = (W.evHits || []).filter(x => x.kind !== "etf"); if (evh.length) P.push(["事件提醒", evh.slice(0, 3).map(x => `<button class="linkbtn" data-sel="${esc(x.code)}">${esc(x.m)}</button>`).join("、")]);
  if (typeof POD !== "undefined" && POD.srv?.eps && typeof podFollows === "function") {
    const F = new Set(podFollows().map(s => s.feed)), since = Date.now() - 24 * 3600e3, E = Object.values(POD.srv.eps).filter(e => F.has(e.feed) && Date.parse(e.date) > since);
    if (E.length) P.push(["節目", `<button class="linkbtn" data-tdgo="pod">追蹤的節目 24 小時內有 ${E.length} 集：${esc([...new Set(E.map(e => e.show))].slice(0, 2).join("、"))}${E.length > 2 ? "…" : ""}</button>`]);
  }
  return P;
}
function renderToday(show) {
  const el = $("#todayCard"); if (!el) return; if (!show || W.off) { el.hidden = true; return; }
  const T = (W.td ||= {}); if (!T.busy && Date.now() - (T.at || 0) > 30 * 60e3) { T.busy = true; T.at = Date.now();
    Promise.allSettled([W.cal ? null : getJ("/api/calendar", true).then(j => { if (j?.ok) W.cal = j; }), W.mn ? null : loadMnews(), etfHoldLoad([...new Set([...Object.keys(W.hold || {}), ...myCodes()])])]).finally(() => { T.busy = false; if (W.lt === "watch") renderToday(true); }); }
  if (!W.syncCfg && !W.cfgBusy) { W.cfgBusy = true; syncCfg().finally(() => { W.cfgBusy = false; if (W.lt === "watch") renderToday(true); }); } // 要知道伺服器有沒有設定 Telegram，才決定顯不顯示推播按鈕
  const P = todayParts(); if (!P.length) { el.hidden = true; return; }
  const h = `<details class="today" data-tdopen${store.get("watch:today", true) ? " open" : ""}><summary><b>今日重點</b><span class="note">${twDay().slice(5).replace("-", "/")}・${P.length} 項</span></summary>
    <ul>${P.map(([k, v]) => `<li><span class="tdk">${k}</span><span class="tdv">${v}</span></li>`).join("")}</ul><div class="tdbtns"><button type="button" class="linkbtn tdmore" data-tdgo="brief">看完整 ›</button><button type="button" class="linkbtn tdmore" data-tdcopy>📋 複製</button>${W.syncCfg?.kv && W.syncCfg?.tg ? `<button type="button" class="linkbtn tdmore" data-tgone>${syncGet().tg && EVA().close ? "✓ 收盤後推到 Telegram" : "📲 每天推到 Telegram"}</button>` : ""}</div></details>`; // 伺服器還沒設定 Telegram 就不顯示，不放一個按了才說不能用的按鈕
  if (el._h !== h) { el._h = h; el.innerHTML = h; } el.hidden = false; // 內容沒變就不重畫（每 5 秒報價更新時不閃）
}
document.addEventListener("toggle", e => { if (e.target.matches?.("[data-tdopen]")) store.set("watch:today", e.target.open); }, true);
// 一鍵推到 Telegram：沒有同步碼就自動建一組、勾好「收盤重點」「每日早報」並上傳；剩下的是打開機器人按「開始」、回來按「完成綁定」（同步、綁定用 tools.js 的備份同步）
function tgOneHtml() {
  const C = W.syncCfg, S = syncGet(), A = EVA();
  // 網站還沒設定好推播：一般訪客只看到「暫時不能用」和複製文字；設定方法（管理者用）只在 ?debug=1 顯示
  if (!C?.kv || !C?.tg) return `<div class="tgone"><h3>每天推到 Telegram</h3><p class="note">Telegram 推播暫時還不能使用。可以先複製今日重點，貼到 LINE、Telegram 或備忘錄。</p>
    <div class="irform"><button class="btn sm primary" data-tdcopy>📋 複製今日重點</button></div>${DEBUG ? `<p class="note">（除錯：${C?.kv ? "缺 TELEGRAM_BOT_TOKEN" : "缺雲端儲存 Upstash（KV_REST_API_URL）"}，在 Vercel 環境變數設定後重新部署）</p>` : ""}</div>`;
  const opts = [["close", "收盤重點", "每個交易日收盤後：自選與庫存的漲跌、大漲跌、今明兩天除權息與法說會、ETF 換股"], ["brief", "每日早報", "每個交易日早上 07:40：昨晚美股、台指期夜盤、今天的行事曆"]]
    .map(([k, t, d]) => `<label class="evopt"><input type="checkbox" data-tgk="${k}" ${A[k] ? "checked" : ""}><b>${t}</b><span class="note">${d}</span></label>`).join("");
  return `<div class="tgone"><h3>每天推到 Telegram</h3>${S.tg ? `<p class="note">✓ 已綁定，不用開著網頁也會收到。指標、價格、事件提醒也會一起推播。</p><div class="evopts">${opts}</div>
      <div class="irform"><button class="btn sm" data-tgone-test>傳測試訊息</button><button class="linkbtn" data-tgone-more>更多設定（備份同步）›</button></div>`
    : `<div class="evopts">${opts}</div><ol class="note tgsteps"><li>按「開啟機器人」，在 Telegram 按「開始（Start）」</li><li>回到這裡按「完成綁定」</li></ol>
      <div class="irform"><a class="btn sm" href="https://t.me/${esc(C.bot || "")}?start=${esc(W.syncTok || "")}" target="_blank" rel="noopener">開啟 @${esc(C.bot || "機器人")}</a><button class="btn sm primary" data-tgone-bind>完成綁定</button></div>
      <p class="note">已經自動建立同步碼並上傳自選、庫存（換裝置時在「工具 → 備份同步」輸入同一組就能接著用）。</p>`}</div>`;
}
async function tgOneOpen() {
  const C = await syncCfg(); if (C.kv && C.tg) { const A = EVA(); if (!syncGet().id) { syncSet({ id: syncNewId(), auto: true, at: 0, hash: 0 }); A.close = A.brief = true; evaSave(); } else if (!syncGet().tg) { A.close = true; evaSave(); }
    await syncPush(true); W.syncTok = await syncTok(syncGet().id); }
  openSheet(tgOneHtml(), false);
}
document.addEventListener("click", async e => { const t = e.target;
  if (t.closest("[data-tgone]")) return tgOneOpen();
  if (t.closest("[data-tdcopy]")) { // 今日重點的純文字（每項一行），貼到 LINE、備忘錄
    const L = [...document.querySelectorAll("#todayCard .today li")].map(li => `• ${li.querySelector(".tdk")?.textContent || ""}：${(li.querySelector(".tdv")?.textContent || "").replace(/\s+/g, " ").trim()}`);
    const txt = `今日重點（${twDay().slice(5).replace("-", "/")}）\n${L.join("\n")}\n— KLineLab K線情報局，僅供研究參考`;
    try { await navigator.clipboard.writeText(txt); toast("已複製今日重點"); } catch { toast("這個瀏覽器不能自動複製"); } return; }
  if (t.closest("[data-tgone-bind]")) { await syncClick({ sy: "tgbind" }); $("#sheetExtra").innerHTML = tgOneHtml(); return renderToday(W.lt === "watch"); }
  if (t.closest("[data-tgone-test]")) return syncClick({ sy: "tgtest" });
  if (t.closest("[data-tgone-more]")) { closeSheet(); W.tv = "sync"; return setLt("tools"); } });
document.addEventListener("change", e => { const k = e.target.dataset?.tgk; if (!k) return; EVA()[k] = e.target.checked; evaSave(); syncPush(true); renderToday(W.lt === "watch"); });
document.addEventListener("click", e => { const g = e.target.closest("[data-tdgo]"); if (!g) return; const v = g.dataset.tdgo;
  if (v === "mkt") { W.mkReg = "tw"; setLt("mkt"); } else if (v === "pod") setLt("pod"); else if (v === "brief") { W.tdPh = { d: twDay(), ph: "mine" }; setLt("today"); } else if (v.startsWith("mkt:")) { W.mkReg = v.slice(4); store.set("watch:mkReg", W.mkReg); setLt("mkt"); } else if (v === "radar") { if (W.mf.view === "today" || W.mf.view === "sector") W.mf.view = "bubble"; setLt("money"); }
  else if (v === "replay") { W.mf.view = "bubble"; W.mf.rp.t = null; W.mf.rp.u = null; setLt("money"); setTimeout(() => mfPlay(true), 60); } });
// 今日市場資金雷達卡的板塊：打開資金雷達的板塊細節，返回鍵回到動能矩陣
document.addEventListener("click", e => { const b = e.target.closest("[data-tdsec]"); if (!b || W.lt !== "today") return; W.mf.back = "bubble"; setLt("money"); secOpen(b.dataset.tdsec); });

/* ---------- 筆記追蹤：W.notes = { 代號: [{ at, t, px }] }；目標價就是價格提醒（W.alerts） ---------- */
const NT = () => (W.notes ||= store.get("watch:notes", {}) || {});
const ntSave = () => store.set("watch:notes", NT());
const ntCodes = () => [...new Set([...Object.keys(NT()).filter(c => NT()[c]?.length), ...Object.entries(W.alerts || {}).filter(([, a]) => a?.up || a?.dn).map(([c]) => c)])];
async function ntQuotes() { // 追蹤清單的代號不一定在自選裡：30 秒內沒有報價的補抓一次
  const need = ntCodes().filter(c => !W.quotes.get(c)); if (!need.length || W.off || W.ntBusy || Date.now() - (W.ntAt || 0) < 30000) return;
  W.ntBusy = true; W.ntAt = Date.now();
  try { for (let i = 0; i < need.length; i += 40) { const j = await getJ(`/api/quote?codes=${need.slice(i, i + 40).join(",")}`); j.quotes.forEach(q => W.quotes.set(q.code, q)); } } catch {}
  W.ntBusy = false; if (W.lt === "tools" && W.tv === "notes") renderList();
}
function ntHtml() {
  setTimeout(ntQuotes, 0);
  const rows = ntCodes().map(c => { const q = W.quotes.get(c), a = W.alerts?.[c] || {}, N = NT()[c] || [], px = q?.price ?? null, first = N.at(-1)?.px ?? null;
    const dist = to => (to && px ? (to / px - 1) * 100 : null), du = dist(a.up), dd = dist(a.dn), near = Math.min(...[du, dd].filter(x => x != null).map(Math.abs));
    return { c, q, a, N, px, first, du, dd, near: isFinite(near) ? near : 1e9 }; }).sort((x, y) => x.near - y.near);
  const bar = (from, now, to) => { if (from == null || now == null || !to || from === to) return ""; const p = Math.max(0, Math.min(100, ((now - from) / (to - from)) * 100)); return `<span class="ntbar" title="從記筆記時的價格走到目標的進度"><i style="width:${p.toFixed(0)}%"></i></span>`; };
  const h = `<section class="csec"><h3>筆記與到價追蹤</h3>
    <form class="irform" id="ntForm"><input id="ntCode" placeholder="代號" value="${esc(W.sel && !isIdx(W.sel) ? W.sel : "")}" style="width:90px" autocomplete="off"><input id="ntText" placeholder="筆記：為什麼注意這檔、想在哪裡進出…" style="flex:1;min-width:180px" autocomplete="off">
      <input id="ntUp" type="number" step="any" placeholder="漲到" style="width:84px"><input id="ntDn" type="number" step="any" placeholder="跌到" style="width:84px"><button class="btn sm primary">＋ 記下</button></form>
    <p class="note">記筆記時會一起記下當時的價格；填「漲到／跌到」會設成價格提醒（到價會通知，綁定 Telegram 後收盤後也推播）。</p>
    ${rows.length ? `<div class="ctbl"><table class="nttbl"><thead><tr><th>股票</th><th>現價</th><th>目標</th><th>還差</th><th>筆記</th><th></th></tr></thead><tbody>${rows.map(r => `<tr>
      <td><button class="linkbtn" data-sel="${esc(r.c)}">${esc(nameOf(r.c))} ${esc(r.c)}</button></td><td class="${cls(r.q?.chg)}">${r.px != null ? fmtP(r.px) : "—"}</td>
      <td>${r.a.up ? `≥ <b class="up">${r.a.up}</b>` : ""}${r.a.up && r.a.dn ? "<br>" : ""}${r.a.dn ? `≤ <b class="down">${r.a.dn}</b>` : ""}${!r.a.up && !r.a.dn ? `<span class="note">未設</span>` : ""}</td>
      <td>${r.du != null ? `${evPct(r.du)}${bar(r.first, r.px, r.a.up)}` : ""}${r.du != null && r.dd != null ? "<br>" : ""}${r.dd != null ? `${evPct(r.dd)}${bar(r.first, r.px, r.a.dn)}` : ""}</td>
      <td class="ntnotes">${r.N.slice(0, 3).map((n, i) => `<div><span class="note">${new Date(n.at + 8 * 3600e3).toISOString().slice(5, 10).replace("-", "/")}${n.px != null ? ` @${fmtP(n.px)}` : ""}</span> ${esc(n.t)} <button class="linkbtn" data-ntdel="${esc(r.c)}:${i}" aria-label="刪除這則筆記">✕</button></div>`).join("")}${r.N.length > 3 ? `<span class="note">…另 ${r.N.length - 3} 則</span>` : ""}</td>
      <td><button class="btn sm" data-ntclr="${esc(r.c)}">清除</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="note">還沒有筆記或目標價。上面輸入代號和筆記，或在個股頁按「提醒」設定目標價。</p>`}</section>`;
  return { h, note: "依「離目標最近」排序；進度條是從記第一則筆記時的價格走到目標價的比例。" };
}
// 個股頁的情報徽章：這檔有筆記時顯示（watch.html 的 intelData 會呼叫）
function ntBadge(c) { const N = NT()[c]; return N?.length ? { k: "note", g: "筆記", t: `${N.length} 則・${N[0].t.slice(0, 14)}${N[0].t.length > 14 ? "…" : ""}` } : null; }

$("#lx").addEventListener("submit", e => {
  if (e.target.id !== "ntForm") return; e.preventDefault();
  const c = $("#ntCode").value.trim().toUpperCase(), t = $("#ntText").value.trim(), up = +$("#ntUp").value, dn = +$("#ntDn").value;
  if (!isTW(c) && !isUS(c)) return toast("請輸入代號");
  if (!t && !(up > 0) && !(dn > 0)) return toast("請寫筆記或填目標價");
  const px = W.quotes.get(c)?.price ?? (c === W.sel ? W.detailQ?.price : null) ?? null;
  if (t) { (NT()[c] ||= []).unshift({ at: Date.now(), t: t.slice(0, 300), px }); ntSave(); }
  if (up > 0 || dn > 0) { const a = W.alerts[c] || {}; W.alerts[c] = { up: up > 0 ? up : a.up ?? null, dn: dn > 0 ? dn : a.dn ?? null, name: nameOf(c) }; store.set("watch:alerts", W.alerts); }
  W.ntAt = 0; toast("已記下", 1500); renderList();
});
$("#lx").addEventListener("change", e => { const k = e.target.dataset?.eva; if (!k || W.lt !== "tools") return; EVA()[k] = e.target.checked; evaSave(); if (e.target.checked && !EV_PUSH.includes(k)) { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {} evStart(); } renderList(); });
$("#lx").addEventListener("click", e => {
  if (W.lt !== "tools" && W.lt !== "today") return; const b = e.target.closest("[data-ntdel],[data-ntclr],[data-mk='evscope'],[data-tx='tdre'],[data-tx='tdai'],[data-tx='tdtxt'],[data-tx='evnow']"); if (!b) return;
  const d = b.dataset;
  if (d.ntdel) { const [c, i] = d.ntdel.split(":"); NT()[c]?.splice(+i, 1); if (!NT()[c]?.length) delete NT()[c]; ntSave(); return renderList(); }
  if (d.ntclr) { if (!confirm(`清除 ${nameOf(d.ntclr)} ${d.ntclr} 的筆記和目標價？`)) return; delete NT()[d.ntclr]; ntSave(); delete W.alerts[d.ntclr]; store.set("watch:alerts", W.alerts); return renderList(); }
  if (d.mk === "evscope") { EVA().scope = d.v; evaSave(); return renderList(); }
  if (d.tx === "evnow") return evCheck();
  if (d.tx === "tdre") { W.sum = null; W.dk = new Map(); W.tdAI = null; if (W.mf) W.mf.sumTry = false; return briefLoad(true); }
  if (d.tx === "tdtxt") { navigator.clipboard?.writeText(todayText()).then(() => toast("已複製", 1500), () => toast("複製失敗")); return; }
  if (d.tx === "tdai") { if (W.tdAI?.loading) return; W.tdAI = { loading: true }; renderList(); // 整理中不能重複按
    aiChat(todayText(), `請用繁體中文、白話，整理成 6 句以內的今日重點：${tdAfter() ? "今天大盤和我的自選怎麼走、觸發了哪些訊號、明天要留意的事" : "昨晚美股和台指期夜盤代表今天開盤可能的氣氛、今天要注意的事件、和我的持股有關的消息"}。只根據上面的資料，不要編造數字，最後提醒這不是買賣建議。`)
      .then(t => { W.tdAI = { text: t }; }, err => { W.tdAI = { err: err.message }; }).finally(() => renderList()); }
});

/* ---------- 新手 30 秒上手指引：還沒自己編過自選（watch:groups 沒存過）、也沒按過 ✕ 才顯示；所有分頁最上面一條，單色、可關閉 ---------- */
const ONB_DEMO = [{ name: "自選", list: ["2330", "2317", "2454", "2382", "3231", "2308", "0050"] }, { name: "美股", list: ["NVDA", "AAPL", "MSFT", "TSM", "AVGO"] }];
function renderOnb() {
  const el = document.getElementById("onbBar"); if (!el) return;
  const show = !W.off && !store.get("watch:groups", null) && !store.get("watch:onbOff", false); el.hidden = !show; if (!show || el.firstChild) return;
  el.innerHTML = `<div class="onb" role="note"><span>💡 初次使用？三步上手：① 點任一股票代號，右邊會滑出個股抽屜（同業 PK、大戶與政治人物申報）　② <button type="button" class="linkbtn" data-onb="demo">✨ 一鍵載入台美股熱門自選範例</button>，體驗「★ 只看我的自選」過濾　③ <button type="button" class="linkbtn" data-onb="hold">到「庫存」載入範例投資組合</button>，看含稅費的損益與風險分析</span><button type="button" class="onb-x" data-onb="x" aria-label="關閉新手指引" title="關閉新手指引">✕</button></div>`;
}
// 範例自選（空群組、★ 只看我的自選卻什麼都沒有時的「載入範例」）：只放進目前這個群組，不動其他群組
const ONB_FILL = ["2330", "2317", "2454", "NVDA", "AAPL"];
document.addEventListener("click", e => { const b = e.target.closest("[data-onb]"); if (!b) return;
  if (b.dataset.onb === "fill") { const g = W.groups?.[W.gi]; if (!g) return; g.list = [...new Set([...g.list, ...ONB_FILL])]; saveGroups(); toast("已放入範例自選：台積電、鴻海、聯發科、輝達、蘋果（可以隨時移除）"); return renderList(); }
  store.set("watch:onbOff", true);
  if (b.dataset.onb === "hold") { setLt("hold"); renderOnb(); return; }
  if (b.dataset.onb === "demo") { W.groups = ONB_DEMO.map(g => ({ ...g, list: [...g.list] })); W.gi = 0; saveGroups(); W.mine = true; store.set("watch:mine", true); toast("已載入熱門自選範例，並打開「★ 只看我的自選」"); setLt("earn"); }
  renderOnb(); renderList(); });
