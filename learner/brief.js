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
function todayText() {
  const t = twDay(), P = briefP();
  return `📋 KLineLab 今日重點（${t.slice(5).replace("-", "/")} 週${WEEK[new Date(t + "T00:00:00Z").getUTCDay()]}）\n`
    + (P.length ? P.map(p => `\n【${p.t}】\n` + p.L.map(x => "• " + x.s).join("\n")).join("\n") + "\n" : "")
    + `\n【盤勢與自選】\n${sumText()}\n\n整理自公開資料，不是買賣建議。`;
}
function todayPage() {
  const t = twDay(), cn = typeof twClosedNote === "function" ? twClosedNote(W.quotes.get("T00")?.date) : null, pm = tdAfter(), C = W.syncCfg;
  const pre = `<h4 class="tdsec">盤前・昨晚美股與今天的行事曆</h4>${briefBody()}`, post = `<h4 class="tdsec">${pm ? "盤後" : "盤中"}・大盤、自選與訊號</h4>${sumBody()}`;
  const h = `<section class="csec"><h3>今日重點 <span class="note">${t.slice(5).replace("-", "/")} 週${WEEK[new Date(t + "T00:00:00Z").getUTCDay()]}</span> <button class="btn sm" data-tx="tdre">↻ 重新整理</button> <button class="btn sm" data-tx="tdai">${ico("ai")}AI 整理</button> <button class="btn sm" data-tx="tdtxt">複製文字</button></h3>
    ${cn ? `<p class="note mkclosed">📅 ${esc(cn[1])}</p>` : ""}
    ${W.tdAI ? `<div class="caibox">${W.tdAI.loading ? "AI 整理中…" : W.tdAI.err ? "⚠︎ " + esc(W.tdAI.err) : esc(W.tdAI.text).replace(/\n/g, "<br>")}</div>` : ""}
    ${pm ? post + pre : pre + post}
    ${C?.kv && C?.tg ? `<p class="note">想每天在手機收到：<button type="button" class="linkbtn" data-tgone>📲 推到 Telegram</button>（早上早報、收盤後重點）。</p>` : ""}</section>`;
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
  if (v === "mkt") { W.mkReg = "tw"; setLt("mkt"); } else if (v === "pod") setLt("pod"); else if (v === "brief") setLt("today"); });

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
