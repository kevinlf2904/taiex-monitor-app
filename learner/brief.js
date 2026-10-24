/* ================= 工具「早報」「筆記追蹤」與提醒頁的「事件提醒」 =================
   早報：昨晚美股（/api/usmarket）、台指期夜盤（/api/futures）、今天的除權息與法說會（/api/calendar）、持股的新消息（/api/news）、
         今天要注意（離目標價 3% 以內、事件提醒），可以請 AI 整理成一段話。每天早上 07:40 排程也用同一套內容推播到 Telegram（scripts/morning-brief.mjs）。
   事件提醒：庫存（可選含自選）台股的營收公布、三率三升、法說會前一天。看盤開著時跳通知；綁定 Telegram 後收盤後也會推播（scripts/alerts-push.mjs）。
   筆記追蹤：每檔可以記筆記（記下當時的價格）、設目標價（寫進價格提醒，到價會通知），清單看現價離目標還差多少。
   evScan、revOf、briefParts、briefText 是純函式（不碰畫面），排程透過 scripts/_engine.mjs 載入，網頁和推播的內容才會一樣。
   用到 watch.html 的 W、esc、cls、getJ、store、renderList、nameOf、fmtP、toast、notify、mkSeg，tools.js 的 myCodes，earn.js 的 ER、erLoad，fundx.js 的 ehLoad，core.js 的 aiChat。 */
const EV_KINDS = [["rev", "營收公布", "每月 10 日前公布上個月營收時"], ["pm3", "三率三升", "季報出來，毛利率、營益率、淨利率都比上一季高"], ["conf", "法說會前一天", "下一個交易日要開法說會"], ["etf", "ETF 換股", "持有或自選的 ETF 新增、剔除成分股（近 7 天）"], ["brief", "每日早報", "每個交易日早上 07:40（Telegram）"], ["close", "收盤重點", "每個交易日收盤後，把今日重點（自選與庫存大漲跌、今明兩天除權息與法說會、ETF 換股、事件）推到 Telegram"]];
const EV_PUSH = ["brief", "close"]; // 只有 Telegram 推播的項目，網頁不跳通知
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
// 盤前那一半（早報）：昨晚美股、台指期夜盤、今天的除權息與法說會、持股新消息、今天要注意
function briefBody() {
  const B = W.bf; if (!B?.at && !B?.busy) setTimeout(() => briefLoad(), 0);
  const P = briefP();
  return `${W.off ? `<p class="note">需要部署到網站才有早報資料。</p>` : B?.busy && !P.length ? `<p class="note">載入中…</p>` : ""}
    <div class="bfgrid">${P.map(p => `<div class="bfsec"><h4>${esc(p.t)}</h4><ul class="tlist">${p.L.map(x => `<li>${x.c && x.c !== "TXF" && !/^\^|=|DX-Y/.test(x.c) ? `<button class="linkbtn" data-sel="${esc(x.c)}">${esc(x.s)}</button>` : `<span class="${x.k}">${esc(x.s)}</span>`}</li>`).join("")}</ul></div>`).join("")}</div>
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

function findLastTradeDate(fromDate, holList = null) {
  if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return null;
  const d = new Date(fromDate + "T00:00:00Z");
  const holSet = new Set((holList || []).map(x => x?.date || (Array.isArray(x) ? x[0] : null)).filter(Boolean));
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
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

  const calendarUnverified = options.calendarStatus === "unknown" || options.isUnknown ||
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
      warning: "無法取得官方交易日曆，採安全降級處理"
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

  const hol = (holList || []).find(x => (x?.date === tradeDate) || (Array.isArray(x) && x[0] === tradeDate));
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
  const sox = us.find(x => x.code === "^SOX")?.chgPct ?? 0;
  const ixic = us.find(x => x.code === "^IXIC")?.chgPct ?? 0;
  const tsm = (G?.us?.megas || []).find(x => x.code === "TSM")?.chgPct ?? 0;
  const futChg = G?.fut?.night?.chg ?? G?.fut?.quote?.chg ?? 0;
  const ref = basePrice;
  const shift = Math.round(futChg * 0.85);
  const pivot = Math.round((ref + shift) / 10) * 10;
  const delta = Math.max(80, Math.round(ref * 0.006));
  const pressure = pivot + delta;
  const support = pivot - delta;

  return {
    tradeDate: targetDate,
    createdAt: meta.createdAt || new Date().toISOString(),
    source: meta.source || "Yahoo Finance、期交所夜盤",
    sourceAsOf: meta.sourceAsOf || null,
    refPriceDate: meta.refPriceDate || null,
    macroSignals: { sox, ixic, tsm, futChg },
    keyLevels: { pressure, pivot, support },
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
  if (inst && typeof inst === "object") {
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

  if (px == null || hi == null || lo == null || !isFinite(px) || !isFinite(hi) || !isFinite(lo)) {
    return {
      status: "insufficient_data",
      outcomeLabel: "行情資料不足，無法判定",
      analysisText: "實際行情缺少收盤價、最高價或最低價等必要欄位，降級為資料不足，不預設為守穩或未突破。",
      pressureHit: null,
      supportHit: null,
      metKey: null
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

  const chgStr = chg != null && isFinite(chg) ? `（${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%）` : "（漲跌幅未知）";
  const analysisText = `實際收盤 ${px.toLocaleString()} 點${chgStr}。${outcomeLabel}；${observationText}`;

  return {
    status: "verified",
    metKey,
    outcomeLabel,
    actualClose: px,
    actualHigh: hi,
    actualLow: lo,
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
          <h5><b>${esc(s.title)}</b><span class="sc-bias ${k}">${esc(s.bias)}</span></h5>
          <p><b>條件：</b>${esc(s.trigger)}</p>
          <p><b>目標：</b>${esc(s.target)}</p>
          <p class="note"><b>失效：</b>${esc(s.invalidation)}</p>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function validateHtml(val) {
  if (!val) return `<div class="dh-card val"><div class="dh-head"><b>早報情境盤後驗證</b><span class="note">等待收盤定案後自動對照</span></div><p class="note">盤中進行中，收盤後將以早報儲存的原始關鍵點位進行實際走勢驗證。</p></div>`;
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
      <span>收盤：<b>${val.actualClose.toLocaleString()}</b></span>
      <span>壓力位：<b>${val.pressureHit ? "✓ 曾觸及" : "未觸及"}</b></span>
      <span>支撐位：<b>${val.supportHit ? "⚠ 曾回測" : "✓ 守穩"}</b></span>
    </div>
  </div>`;
}

function flowsDecisionHtml(M) {
  if (!M) {
    const F = W?.mf;
    if (!W?.off && F && !F.loading && !F.sumTry) { F.sumTry = true; setTimeout(() => loadMoney(10), 0); }
    return `<div class="dh-card"><div class="dh-head"><b>資金雷達</b><span class="note">板塊輪動與法人資金</span></div><p class="note">載入法人資金資料中…</p><button type="button" class="linkbtn" data-tdgo="radar">前往資金雷達完整分析 ›</button></div>`;
  }
  const mood = typeof flowMood === "function" ? flowMood(M) : null;
  const A = typeof flowAt === "function" ? flowAt(M) : [];
  const S = typeof flowStocks === "function" ? flowStocks(M) : [];
  const buy = A.filter(x => x.net1 > 0).sort((a, b) => b.net1 - a.net1).slice(0, 3);
  const sell = A.filter(x => x.net1 < 0).sort((a, b) => a.net1 - b.net1).slice(0, 3);
  const odd = S.filter(x => x.mult >= 3 && Math.abs(x.a1) >= 3).length;
  const L = x => `${esc(x.name)} <b class="${cls(x.net1)}">${briefFlowFmt(x.net1)}</b>`;

  return `<div class="dh-card">
    <div class="dh-head"><b>資金雷達・板塊輪動與資金流向</b><span class="note">${M.dates[M.T - 1]?.slice(5).replace("-", "/")}</span></div>
    ${mood ? `<p>法人情緒：<b>${mood.score} 分（${mood.label}）</b>・上漲 ${mood.up} 家／下跌 ${mood.dn} 家</p>` : ""}
    <p>資金流入前三板塊：${buy.length ? buy.map(L).join("、") : "無顯著流入"}</p>
    <p>資金流出前三板塊：${sell.length ? sell.map(L).join("、") : "無顯著流出"}</p>
    <p>異常爆量個股（逾前4日均量3倍且逾3億）：<b>${odd}</b> 檔</p>
    <div style="margin-top:6px"><button type="button" class="btn sm" data-tdgo="radar">前往資金雷達完整板塊與矩陣分析 ›</button></div>
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

function todayPage() {
  const nowMs = Date.now();
  const t = twDay(), cn = typeof twClosedNote === "function" ? twClosedNote(W.quotes?.get?.("T00")?.date) : null, pm = tdAfter(nowMs), C = W.syncCfg;
  const tq = W.quotes?.get?.("T00");
  const sess = sessionStatus(nowMs, { holidays: W.cal?.hol, lastTradeDate: tq?.date });

  let plan = getBriefSnapshot(t);
  if (!plan && (sess.session === "pre" || !pm)) {
    plan = briefScenarios(W.bf, t, tq?.price);
    if (plan) saveBriefSnapshot(t, plan);
  }

  const val = tq?.price ? validatePlan(plan, {
    price: tq.price,
    close: tq.price,
    high: tq.high,
    low: tq.low,
    chgPct: tq.chgPct,
    date: tq.date
  }) : null;
  const M = typeof mfModel === "function" ? mfModel() : null;

  const pre = `<h4 class="tdsec">盤前・昨晚美股與今天的行事曆</h4>${briefBody()}${briefScenariosHtml(plan)}`;
  const post = `<h4 class="tdsec">${pm ? "盤後" : "盤中"}・大盤、自選與訊號</h4>${pm && val ? validateHtml(val) : ""}${sumBody()}${flowsDecisionHtml(M)}${nextActionHtml(plan, val)}`;

  const style = `<style>
    .dh-status-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 10px; background: var(--surface-2); border-radius: 6px; font-size: 12.5px; margin-bottom: 8px; }
    .dh-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #fff; }
    .dh-badge.pre { background: #2563eb; }
    .dh-badge.live { background: #059669; }
    .dh-badge.post { background: #7c3aed; }
    .dh-badge.closed { background: var(--muted); }
    .dh-badge.unknown { background: #d97706; }
    .dh-card { padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); margin: 10px 0; font-size: 13px; line-height: 1.6; }
    .dh-card.val { border-color: var(--accent, #6366f1); background: var(--surface-2); }
    .dh-card.act { border-left: 3px solid var(--accent, #6366f1); }
    .dh-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
    .dh-head b { font-size: 13.5px; }
    .dh-levels { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
    .dh-lvl { padding: 3px 8px; border-radius: 4px; font-size: 12px; background: var(--surface-2); border: 1px solid var(--line); }
    .dh-lvl.pres b { color: var(--down); }
    .dh-lvl.piv b { color: var(--accent, #6366f1); }
    .dh-lvl.supp b { color: var(--up); }
    .sc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 8px; margin-top: 6px; }
    .sc-card { padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); }
    .sc-card.bull { border-left: 3px solid var(--up); }
    .sc-card.neutral { border-left: 3px solid var(--muted); }
    .sc-card.bear { border-left: 3px solid var(--down); }
    .sc-card h5 { margin: 0 0 4px; font-size: 12.5px; display: flex; justify-content: space-between; }
    .sc-card p { margin: 2px 0; font-size: 12px; }
    .sc-bias { font-size: 11px; padding: 1px 4px; border-radius: 3px; font-weight: 600; }
    .sc-bias.bull { background: rgba(220,38,38,0.1); color: var(--up); }
    .sc-bias.neutral { background: var(--surface); color: var(--muted); }
    .sc-bias.bear { background: rgba(37,99,235,0.1); color: var(--down); }
    .dh-tag { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; background: var(--surface); border: 1px solid var(--line); }
    .dh-tag.missing { background: var(--surface-2); color: var(--muted); }
    .dh-val-txt { margin: 4px 0 6px; font-size: 13px; font-weight: 500; }
    .dh-val-stats { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); }
    .dh-val-stats b { color: var(--ink); }
  </style>`;

  const h = `<section class="csec">${style}
    <div class="dh-status-bar">
      <div>
        <span class="dh-badge ${sess.session}">${sess.label}</span>
        <span class="note">資料時間 ${sess.hm}・${t.slice(5).replace("-", "/")} 週${WEEK[new Date(t + "T00:00:00Z").getUTCDay()]}</span>
      </div>
      ${sess.displayNote ? `<div class="note">${esc(sess.displayNote)}</div>` : tq?.price ? `<div>加權 <b>${fmtP(tq.price)}</b> <span class="${cls(tq.chg)}">${tq.chgPct >= 0 ? "+" : ""}${tq.chgPct ?? "—"}%</span></div>` : ""}
    </div>
    <h3>今日重點 <span class="note">${t.slice(5).replace("-", "/")} 週${WEEK[new Date(t + "T00:00:00Z").getUTCDay()]}</span> <button class="btn sm" data-tx="tdre">↻ 重新整理</button> <button class="btn sm" data-tx="tdai">${ico("ai")}AI 整理</button> <button class="btn sm" data-tx="tdtxt">複製文字</button></h3>
    ${cn ? `<p class="note mkclosed">📅 ${esc(cn[1])}</p>` : ""}
    ${W.tdAI ? `<div class="caibox">${W.tdAI.loading ? "AI 整理中…" : W.tdAI.err ? "⚠︎ " + esc(W.tdAI.err) : esc(W.tdAI.text).replace(/\n/g, "<br>")}</div>` : ""}
    ${pm ? post + pre : pre + post}
    ${C?.kv && C?.tg ? `<p class="note">想每天在手機收到：<button type="button" class="linkbtn" data-tgone>📲 推到 Telegram</button>（早上早報、收盤後重點）。</p>` : ""}
  </section>`;
  return { h, note: "整理自 Yahoo Finance、期交所、證交所、公開資訊觀測站、新聞標題與即時報價；只是摘要，不是買賣建議。" };
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
  if (v === "mkt") { W.mkReg = "tw"; setLt("mkt"); } else if (v === "pod") setLt("pod"); else if (v === "brief") setLt("today"); else if (v === "radar") setLt("money"); });

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
  el.innerHTML = `<div class="onb" role="note"><span>💡 初次使用？① 點任一股票代號，右邊會滑出個股抽屜（同業 PK、大戶與政治人物申報）　② <button type="button" class="linkbtn" data-onb="demo">✨ 一鍵載入台美股熱門自選範例</button>，立即體驗「★ 只看我的自選」過濾</span><button type="button" class="onb-x" data-onb="x" aria-label="關閉新手指引" title="關閉新手指引">✕</button></div>`;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-onb]"); if (!b) return;
  store.set("watch:onbOff", true);
  if (b.dataset.onb === "demo") { W.groups = ONB_DEMO.map(g => ({ ...g, list: [...g.list] })); W.gi = 0; saveGroups(); W.mine = true; store.set("watch:mine", true); toast("已載入熱門自選範例，並打開「★ 只看我的自選」"); setLt("earn"); }
  renderOnb(); renderList(); });
