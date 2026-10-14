/* ================= 看盤「工具」分頁：每日摘要、指標提醒、模擬交易、交易日記、多圖並排 =================
   這個檔案只定義函式（載入時 watch.html 的 W 還沒建立），由 watch.html 的清單分頁「工具」呼叫 renderTools()。
   資料都存在這台裝置的瀏覽器（localStorage）；指標用日 K 判斷，日 K 每 5 分鐘重抓一次。 */

const TOOLS_VIEWS = [["sum", "每日摘要"], ["alert", "指標提醒"], ["paper", "模擬交易"], ["journal", "交易日記"], ["multi", "多圖並排"]];
const toolsDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
// 日 K（6 個月）：5 分鐘內重複用
async function dailyFresh(c) {
  const M = (W.dk ||= new Map()), h = M.get(c); if (h && Date.now() - h.at < 300000) return h.p;
  const p = getJ(`/api/kline?code=${encodeURIComponent(c === "T00" ? "加權" : c === "O00" ? "櫃買" : c)}&months=6`).then(j => j.data || null).catch(() => null);
  M.set(c, { at: Date.now(), p }); return p;
}
const myCodes = () => [...new Set(W.groups.flatMap(g => g.list))].filter(c => !isIdx(c));

/* ---------- 指標條件 ---------- */
// [id, 名稱, 參數名稱（沒有就 null）, 預設參數, 判斷(D, I, p) → 最後一根成立就回傳說明]
const COND = [
  ["kdgc", "KD 低檔金叉（D<20）", null, null, (D, I) => { const n = D.length - 1, K = I.kd.K, d = I.kd.D; return K[n - 1] <= d[n - 1] && K[n] > d[n] && d[n] < 20 ? `K ${fmtN(K[n])} 上穿 D ${fmtN(d[n])}` : null; }],
  ["kddc", "KD 高檔死叉（D>80）", null, null, (D, I) => { const n = D.length - 1, K = I.kd.K, d = I.kd.D; return K[n - 1] >= d[n - 1] && K[n] < d[n] && d[n] > 80 ? `K ${fmtN(K[n])} 跌破 D ${fmtN(d[n])}` : null; }],
  ["macdgc", "MACD 金叉", null, null, (D, I) => { const n = D.length - 1, a = I.macd.dif, b = I.macd.sig; return a[n - 1] <= b[n - 1] && a[n] > b[n] ? `DIF ${fmtN(a[n], 2)} 上穿訊號線` : null; }],
  ["macddc", "MACD 死叉", null, null, (D, I) => { const n = D.length - 1, a = I.macd.dif, b = I.macd.sig; return a[n - 1] >= b[n - 1] && a[n] < b[n] ? `DIF ${fmtN(a[n], 2)} 跌破訊號線` : null; }],
  ["maup", "收盤站上均線", "天數", 20, (D, I, p) => { const n = D.length - 1, m = I.ma(p); return D[n - 1].c <= m[n - 1] && D[n].c > m[n] ? `收盤 ${fmtP(D[n].c)} 站上 MA${p} ${fmtP(m[n])}` : null; }],
  ["madn", "收盤跌破均線", "天數", 20, (D, I, p) => { const n = D.length - 1, m = I.ma(p); return D[n - 1].c >= m[n - 1] && D[n].c < m[n] ? `收盤 ${fmtP(D[n].c)} 跌破 MA${p} ${fmtP(m[n])}` : null; }],
  ["bollup", "收盤突破布林上軌", null, null, (D, I) => { const n = D.length - 1; return D[n].c > I.boll.up[n] && D[n - 1].c <= I.boll.up[n - 1] ? `收盤 ${fmtP(D[n].c)} 突破上軌 ${fmtP(I.boll.up[n])}` : null; }],
  ["bolldn", "收盤跌破布林下軌", null, null, (D, I) => { const n = D.length - 1; return D[n].c < I.boll.lo[n] && D[n - 1].c >= I.boll.lo[n - 1] ? `收盤 ${fmtP(D[n].c)} 跌破下軌 ${fmtP(I.boll.lo[n])}` : null; }],
  ["rsilt", "RSI 低於", "數值", 30, (D, I, p) => { const v = I.rsi[D.length - 1]; return v != null && v < p ? `RSI ${fmtN(v)} < ${p}` : null; }],
  ["rsigt", "RSI 高於", "數值", 70, (D, I, p) => { const v = I.rsi[D.length - 1]; return v != null && v > p ? `RSI ${fmtN(v)} > ${p}` : null; }],
  ["hi", "創 N 日新高（收盤）", "天數", 20, (D, I, p) => { const n = D.length - 1; return n >= p && D[n].c > Math.max(...D.slice(n - p, n).map(x => x.c)) ? `收盤 ${fmtP(D[n].c)} 創 ${p} 日新高` : null; }],
  ["lo", "創 N 日新低（收盤）", "天數", 20, (D, I, p) => { const n = D.length - 1; return n >= p && D[n].c < Math.min(...D.slice(n - p, n).map(x => x.c)) ? `收盤 ${fmtP(D[n].c)} 創 ${p} 日新低` : null; }],
  ["vol", "爆量（N 倍 20 日均量）", "倍數", 2, (D, I, p) => { const n = D.length - 1, a = I.vma[n - 1]; return a && D[n].v > a * p ? `量 ${fmtVol(D[n].v)} 是均量的 ${(D[n].v / a).toFixed(1)} 倍` : null; }],
  ["dull", "KD 高檔鈍化（連 3 天 K≥80）", null, null, (D, I) => { const sp = dullSpans(I.kd.K, 80, 20, 3).pop(); return sp && sp.side > 0 && sp.ic === D.length - 1 ? "K 值連 3 天 ≥ 80" : null; }],
  ...Object.entries(STRAT_DEFS).map(([k, s]) => [`s:${k}`, `策略訊號：${s.name}`, null, null, (D, I) => { const sg = stratRun(k, D, I).filter(x => x.i === D.length - 1).pop(); return sg ? `${sg.side === "buy" ? "買進" : "賣出"}訊號：${sg.label || s.name}` : null; }]),
];
const condOf = id => COND.find(x => x[0] === id);
const condName = (id, p) => { const C = condOf(id); if (!C) return id; const v = p ?? C[3]; return C[1].replace(/\bN\b/, v ?? "N"); };
function condCheck(r, D) { const C = condOf(r.cond); if (!C || !D || D.length < 30) return null; try { return C[4](D, indicators(D), r.p ?? C[3]); } catch { return null; } }
const IR = () => (W.irules ||= store.get("watch:irules", []) || []);
const irSave = () => store.set("watch:irules", IR());
// 每 5 分鐘檢查一次（看盤開著才會檢查）；同一條規則同一天只通知一次
async function irCheck(manual = false) {
  const L = IR().filter(r => r.on); if (!L.length || W.off) return; W.irAt = Date.now(); const day = toolsDay(), hits = [];
  for (const r of L) {
    const D = await dailyFresh(r.code), msg = condCheck(r, D); r.now = msg; r.chk = Date.now();
    if (msg) { hits.push({ r, msg }); if (r.last !== day) { r.last = day; notify(`${nameOf(r.code)} ${r.code}：${condName(r.cond, r.p)}`, msg); (W.irLog ||= store.get("watch:irlog", []) || []).unshift({ d: day, t: new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16), code: r.code, cond: r.cond, msg }); W.irLog.length = Math.min(W.irLog.length, 60); store.set("watch:irlog", W.irLog); } }
  }
  irSave(); if (W.lt === "tools") renderList(); if (manual) toast(hits.length ? `有 ${hits.length} 條成立` : "目前沒有條件成立");
}
function irStart() { if (W.irTimer) return; W.irTimer = setInterval(() => { if (document.visibilityState === "visible") irCheck(); }, 300000); setTimeout(() => irCheck(), 8000); }

/* ---------- 模擬交易（紙上帳戶，台股，市價成交，含手續費與證交稅） ---------- */
const PAPER0 = () => ({ init: 1000000, cash: 1000000, pos: {}, hist: [] });
const PA = () => (W.paper ||= store.get("watch:paper", null) || PAPER0());
const paSave = () => store.set("watch:paper", PA());
const paperFee = v => Math.max(20, Math.round(v * 0.001425));
const paperTax = (c, v) => Math.round(v * (isEtf(c) ? 0.001 : 0.003));
function paperOrder(c, side, sh) {
  const A = PA(), q = W.quotes.get(c) || (c === W.sel ? W.detailQ : null), px = q?.price;
  if (!isTW(c) || isIdx(c)) return "模擬交易只支援台股、ETF";
  if (!px) return "還沒有這檔的報價，先在清單或個股頁讓它載入報價";
  if (!(sh > 0)) return "股數要大於 0";
  const v = Math.round(px * sh), fee = paperFee(v), P = A.pos[c];
  if (side === "buy") { if (v + fee > A.cash) return `現金不足（需要 ${(v + fee).toLocaleString()}，剩 ${Math.round(A.cash).toLocaleString()}）`; A.cash -= v + fee; A.pos[c] = P ? { sh: P.sh + sh, cost: P.cost + v + fee } : { sh, cost: v + fee }; A.hist.unshift({ t: Date.now(), c, side, sh, px, fee, tax: 0 }); }
  else { if (!P || P.sh < sh) return "持股不足"; const tax = paperTax(c, v), costPart = P.cost * sh / P.sh, pnl = v - fee - tax - costPart; A.cash += v - fee - tax; P.sh -= sh; P.cost -= costPart; if (!P.sh) delete A.pos[c]; A.hist.unshift({ t: Date.now(), c, side, sh, px, fee, tax, pnl: Math.round(pnl) }); }
  paSave(); if (W.paperJ !== false) jAdd({ d: toolsDay(), code: c, side, px, sh, reason: "模擬交易", tags: ["模擬"] }, true); return null;
}

/* ---------- 交易日記：每一筆買賣記下理由，自動附上當天的技術面快照；統計勝率、賺賠比，和策略、買進持有比較 ---------- */
const JR = () => (W.journal ||= store.get("watch:journal", []) || []);
const jSave = () => store.set("watch:journal", JR());
async function jSnap(code, d) {
  const D = await dailyFresh(code); if (!D?.length) return null; let i = D.findIndex(x => String(x.d).slice(0, 10) > d); i = i < 0 ? D.length - 1 : i - 1; if (i < 30) return null;
  const I = indicators(D), m20 = I.ma(20)[i], m60 = I.ma(60)[i];
  return { d: String(D[i].d).slice(0, 10), c: D[i].c, kd: [I.kd.K[i], I.kd.D[i]].map(v => +fmtN(v)), rsi: +fmtN(I.rsi[i]), macd: I.macd.dif[i] > I.macd.sig[i] ? "DIF 在訊號線上" : "DIF 在訊號線下", ma: `${D[i].c >= m20 ? "站上" : "跌破"}月線${m60 ? `、${D[i].c >= m60 ? "站上" : "跌破"}季線` : ""}` };
}
async function jAdd(e, quiet = false) {
  const x = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...e, px: +e.px, sh: +e.sh, tags: e.tags || [] };
  JR().unshift(x); jSave(); if (!quiet) toast("已記到交易日記");
  x.snap = await jSnap(x.code, x.d).catch(() => null); jSave(); if (W.lt === "tools") renderList();
}
// 先進先出配對買賣 → 已實現的每一筆
function jClosed(list = JR()) {
  const lots = {}, out = []; [...list].sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id)).forEach(e => {
    const L = (lots[e.code] ||= []);
    if (e.side === "buy") L.push({ ...e, left: e.sh });
    else { let n = e.sh; while (n > 0 && L.length) { const b = L[0], k = Math.min(n, b.left); out.push({ code: e.code, in: b.d, out: e.d, sh: k, buy: b.px, sell: e.px, pnl: (e.px - b.px) * k, ret: e.px / b.px - 1, reason: b.reason }); b.left -= k; n -= k; if (!b.left) L.shift(); } }
  });
  return { closed: out, open: Object.entries(lots).flatMap(([c, L]) => L.map(b => ({ code: c, d: b.d, sh: b.left, px: b.px }))) };
}

/* ---------- 每日摘要 ---------- */
async function sumBuild() {
  const S = (W.sum = { busy: true, at: Date.now(), sig: [] }); renderList();
  const L = myCodes().filter(c => isTW(c)).slice(0, 30);
  for (const c of L) {
    const D = await dailyFresh(c); if (!D || D.length < 60) continue;
    const ev = COND.filter(x => ["kdgc", "kddc", "macdgc", "macddc", "bollup", "bolldn", "hi", "lo", "vol", "dull"].includes(x[0])).map(x => { const m = condCheck({ cond: x[0] }, D); return m ? condName(x[0]).replace(/（.*/, "") : null; }).filter(Boolean);
    const n = D.length - 1, m60 = indicators(D).ma(60); if (D[n - 1].c >= m60[n - 1] && D[n].c < m60[n]) ev.push("跌破季線"); if (D[n - 1].c <= m60[n - 1] && D[n].c > m60[n]) ev.push("站上季線");
    if (ev.length) S.sig.push({ c, ev, d: String(D[n].d).slice(0, 10) });
  }
  if (!W.cong && typeof loadCong === "function") await loadCong();
  S.busy = false; S.at = Date.now(); if (W.lt === "tools") renderList();
}
function sumText() {
  const q = c => W.quotes.get(c), mv = myCodes().map(c => ({ c, q: q(c) })).filter(x => x.q?.chgPct != null).sort((a, b) => b.q.chgPct - a.q.chgPct);
  const lines = [`日期：${toolsDay()}`, ...["T00", "O00"].map(c => q(c)).filter(Boolean).map(x => `${x.name || x.code}：${fmtP(x.price)}（${x.chgPct >= 0 ? "+" : ""}${x.chgPct}%）`)];
  if (mv.length) lines.push(`自選漲幅前段：${mv.slice(0, 5).map(x => `${nameOf(x.c)} ${x.q.chgPct >= 0 ? "+" : ""}${x.q.chgPct}%`).join("、")}`, `自選跌幅前段：${mv.slice(-5).reverse().map(x => `${nameOf(x.c)} ${x.q.chgPct}%`).join("、")}`);
  (W.sum?.sig || []).forEach(s => lines.push(`${nameOf(s.c)} ${s.c}：${s.ev.join("、")}`));
  (W.irLog || []).filter(x => x.d === toolsDay()).forEach(x => lines.push(`提醒：${nameOf(x.code)} ${x.msg}`));
  const cg = (W.cong?.trades || []).filter(t => t.filed >= new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)).slice(0, 15);
  cg.forEach(t => lines.push(`國會新申報：${pName(t.pid)} ${t.k === "buy" ? "買進" : "賣出"} ${t.ticker} ${amtTxt(t.amount)}（交易日 ${t.traded}）`));
  return lines.join("\n");
}
async function sumAI() {
  const set = x => { W.sumAI = x; if (W.lt === "tools") renderList(); }; if (W.off) return set({ err: "需要部署到網站才能使用" });
  set({ loading: true });
  try { const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: sumText(), messages: [{ role: "user", content: "請只根據「目前畫面」的資料，整理成今天的盤後摘要：大盤、自選股表現、觸發的技術訊號、國會新申報，最後列出明天值得留意的 3 件事。不要給買賣建議，用繁體中文、條列。" }] }) });
    const k = await r.json(); if (!k.ok) throw new Error(k.error || "AI 沒有回答"); set({ text: k.text }); } catch (e) { set({ err: e.message }); }
}

/* ---------- 多圖並排 ---------- */
function multiCodes() { const s = store.get("watch:multi", null); return Array.isArray(s) && s.length ? s : myCodes().slice(0, 4); }
async function multiDraw() {
  const mode = W.multiMode || "codes", boxes = [...document.querySelectorAll("#lx [data-mbox]")]; W.multiCharts = [];
  for (const el of boxes) {
    const [kind, v] = el.dataset.mbox.split(":"); let D = null, title = "";
    if (mode === "codes") { D = await dailyFresh(v); title = `${nameOf(v)} ${v}・日 K`; }
    else { const base = await dailyFresh(W.sel || "T00"); title = `${nameOf(W.sel || "T00")}・${{ D: "日 K", W: "週 K", M: "月 K", Q: "季 K" }[v]}`;
      D = !base ? null : v === "D" ? base : v === "W" ? agg(base, weekKey) : v === "M" ? agg(base, d => d.slice(0, 7)) : agg(base, d => d.slice(0, 4) + "Q" + Math.ceil(+d.slice(5, 7) / 3)); }
    if (!el.isConnected) return; el.querySelector("h4").textContent = title; const host = el.querySelector(".mchart");
    if (!D?.length) { host.innerHTML = `<p class="note" style="padding:12px">拿不到資料</p>`; continue; }
    host.innerHTML = ""; const ch = new Chart(host); ch.set(D, { ma: [5, 20, 60].filter(n => D.length > n), noVol: !D.some(x => x.v), subs: ["kd"], subSignals: false }); W.multiCharts.push(ch);
  }
}

/* ---------- 畫面 ---------- */
function renderTools() {
  const v = W.tv || "sum";
  $("#lTools").innerHTML = `<div class="seg" role="group" aria-label="工具">${TOOLS_VIEWS.map(([k, t]) => `<button data-tv="${k}" aria-pressed="${v === k}">${t}</button>`).join("")}</div>`;
  let h = "", note = "";
  if (v === "sum") {
    const S = W.sum; if (!S && !W.off) setTimeout(sumBuild, 0);
    const q = c => W.quotes.get(c), mv = myCodes().map(c => ({ c, q: q(c) })).filter(x => x.q?.chgPct != null).sort((a, b) => b.q.chgPct - a.q.chgPct);
    const row = x => `<li><button class="linkbtn" data-tsel="${x.c}">${esc(nameOf(x.c))} <span class="note">${x.c}</span></button> <b class="${cls(x.q.chg)}">${x.q.chgPct >= 0 ? "+" : ""}${(+x.q.chgPct).toFixed(2)}%</b></li>`;
    const cg = (W.cong?.trades || []).filter(t => t.filed >= new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10));
    h = `<section class="csec"><h3>每日盤後摘要 <span class="note">${toolsDay()}</span> <button class="btn sm" data-tx="sumre">↻ 重新整理</button> <button class="btn sm" data-tx="sumai">🤖 AI 整理</button></h3>
      ${W.sumAI ? `<div class="caibox">${W.sumAI.loading ? "AI 整理中…" : W.sumAI.err ? "⚠ " + esc(W.sumAI.err) : esc(W.sumAI.text).replace(/\n/g, "<br>")}</div>` : ""}
      <div class="tgrid"><div><h4>大盤</h4><ul class="tlist">${["T00", "O00", "TXF"].map(c => q(c) ? `<li>${esc(q(c).name || nameOf(c))} <b>${fmtP(q(c).price)}</b> <span class="${cls(q(c).chg)}">${q(c).chgPct >= 0 ? "+" : ""}${q(c).chgPct ?? "—"}%</span></li>` : "").join("")}</ul></div>
      <div><h4>自選漲幅前 5</h4><ul class="tlist">${mv.slice(0, 5).map(row).join("") || "<li class='note'>等待報價…</li>"}</ul></div>
      <div><h4>自選跌幅前 5</h4><ul class="tlist">${mv.slice(-5).reverse().map(row).join("") || "<li class='note'>等待報價…</li>"}</ul></div></div>
      <h4>自選股今天觸發的技術訊號 ${S?.busy ? `<span class="note">掃描中…</span>` : ""}</h4><ul class="tlist">${(S?.sig || []).map(s => `<li><button class="linkbtn" data-tsel="${s.c}">${esc(nameOf(s.c))} ${s.c}</button>：${s.ev.map(esc).join("、")} <span class="note">${s.d}</span></li>`).join("") || `<li class="note">${S?.busy ? "…" : "沒有（掃描自選股最多 30 檔的日 K：KD／MACD 交叉、布林突破、20 日新高新低、爆量、鈍化、季線）"}</li>`}</ul>
      <h4>今天的指標提醒</h4><ul class="tlist">${(W.irLog ||= store.get("watch:irlog", []) || []).filter(x => x.d === toolsDay()).map(x => `<li>${x.t} ${esc(nameOf(x.code))} ${x.code}：${esc(x.msg)}</li>`).join("") || `<li class="note">沒有（在「指標提醒」設定條件）</li>`}</ul>
      <h4>國會新申報（最近 3 天）</h4><ul class="tlist">${cg.slice(0, 12).map(t => `<li>${esc(pName(t.pid))} ${t.k === "buy" ? "<b class='up'>買進</b>" : "<b class='down'>賣出</b>"} ${esc(t.ticker)} ${amtTxt(t.amount)} <span class="note">交易日 ${t.traded}</span></li>`).join("") || `<li class="note">沒有</li>`}</ul></section>`;
    note = "摘要用即時報價與日 K 整理；AI 整理只根據畫面上的資料，不是買賣建議。";
  } else if (v === "alert") {
    const L = IR(), opt = COND.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join("");
    h = `<section class="csec"><h3>指標條件提醒 <button class="btn sm" data-tx="irnow">立即檢查</button></h3>
      <p class="note">看盤開著時每 5 分鐘用日 K 檢查一次，條件成立會跳通知（同一條件一天通知一次）。iPad／iPhone 要把網站「加入主畫面」再允許通知，才收得到系統通知；關掉網頁就不會檢查。</p>
      <form class="irform" id="irForm"><input id="irCode" placeholder="代號，例如 2330" value="${esc(W.sel && isTW(W.sel) ? W.sel : "")}" autocomplete="off"><select id="irCond">${opt}</select><input id="irP" type="number" step="any" placeholder="參數" style="width:80px"><button class="btn sm primary">＋ 新增</button></form>
      <div class="ctbl"><table><thead><tr><th>股票</th><th>條件</th><th>目前</th><th>上次通知</th><th></th></tr></thead><tbody>
      ${L.map((r, i) => `<tr><td><button class="linkbtn" data-tsel="${r.code}">${esc(nameOf(r.code))} ${r.code}</button></td><td>${esc(condName(r.cond, r.p))}${condOf(r.cond)?.[2] && !/\bN\b/.test(condOf(r.cond)[1]) ? `（${condOf(r.cond)[2]} ${r.p ?? condOf(r.cond)[3]}）` : ""}</td><td>${r.chk ? (r.now ? `<b class="up">成立</b>：${esc(r.now)}` : `<span class="note">未成立</span>`) : `<span class="note">尚未檢查</span>`}</td><td class="note">${r.last || "—"}</td><td><label class="note"><input type="checkbox" data-iron="${i}" ${r.on ? "checked" : ""}> 開</label> <button class="linkbtn" data-irdel="${i}">刪除</button></td></tr>`).join("") || `<tr><td colspan="5" class="note">還沒有條件。上面輸入代號、選條件就能新增。</td></tr>`}</tbody></table></div>
      <h4>最近的提醒紀錄</h4><ul class="tlist">${(W.irLog ||= store.get("watch:irlog", []) || []).slice(0, 20).map(x => `<li><span class="note">${x.d} ${x.t}</span> ${esc(nameOf(x.code))} ${x.code}：${esc(x.msg)}</li>`).join("") || "<li class='note'>沒有</li>"}</ul></section>`;
    note = "價格提醒（漲到、跌到某價）在個股頁的「🔔 提醒」設定；這裡是技術指標與策略訊號的提醒。";
  } else if (v === "paper") {
    const A = PA(), pos = Object.entries(A.pos).map(([c, p]) => { const px = W.quotes.get(c)?.price ?? p.cost / p.sh; return { c, ...p, px, mv: px * p.sh }; }), mv = pos.reduce((s, x) => s + x.mv, 0), eq = A.cash + mv;
    h = `<section class="csec"><h3>模擬交易 <span class="note">台股紙上帳戶</span> <button class="linkbtn" data-tx="pareset">重設帳戶</button></h3>
      <div class="cokv three"><div><span>總資產</span><b class="${cls(eq - A.init)}">${Math.round(eq).toLocaleString()}</b><small>報酬 ${((eq / A.init - 1) * 100).toFixed(2)}%（起始 ${A.init.toLocaleString()}）</small></div><div><span>現金</span><b>${Math.round(A.cash).toLocaleString()}</b></div><div><span>持股市值</span><b>${Math.round(mv).toLocaleString()}</b><small>${pos.length} 檔</small></div></div>
      <form class="irform" id="paForm"><input id="paCode" placeholder="代號" value="${esc(W.sel && isTW(W.sel) ? W.sel : "")}" autocomplete="off"><input id="paSh" type="number" min="1" step="1" value="1000" style="width:90px"><span class="note">股</span><button class="btn sm primary" data-paside="buy">市價買進</button><button class="btn sm" data-paside="sell">市價賣出</button></form>
      <p class="note">用目前的即時報價成交；手續費 0.1425%（最低 20 元），賣出另扣證交稅（股票 0.3%、ETF 0.1%）。每筆會自動記到交易日記（標「模擬」）。</p>
      <div class="ctbl"><table><thead><tr><th>股票</th><th>股數</th><th>平均成本</th><th>現價</th><th>未實現損益</th></tr></thead><tbody>${pos.map(x => `<tr><td><button class="linkbtn" data-tsel="${x.c}">${esc(nameOf(x.c))} ${x.c}</button></td><td>${x.sh.toLocaleString()}</td><td>${fmtP(x.cost / x.sh)}</td><td>${fmtP(x.px)}</td><td class="${cls(x.mv - x.cost)}">${Math.round(x.mv - x.cost).toLocaleString()}（${((x.mv / x.cost - 1) * 100).toFixed(2)}%）</td></tr>`).join("") || `<tr><td colspan="5" class="note">還沒有持股</td></tr>`}</tbody></table></div>
      <h4>成交紀錄</h4><div class="ctbl"><table><tbody>${A.hist.slice(0, 40).map(x => `<tr><td class="note">${new Date(x.t + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ")}</td><td>${esc(nameOf(x.c))} ${x.c}</td><td>${x.side === "buy" ? "<b class='up'>買</b>" : "<b class='down'>賣</b>"} ${x.sh.toLocaleString()} 股 @ ${fmtP(x.px)}</td><td class="note">費 ${x.fee}${x.tax ? `・稅 ${x.tax}` : ""}</td><td class="${cls(x.pnl)}">${x.pnl != null ? "損益 " + x.pnl.toLocaleString() : ""}</td></tr>`).join("") || `<tr><td class="note">沒有</td></tr>`}</tbody></table></div></section>`;
    note = "模擬交易只記在這台裝置，用來練習，不會真的下單。";
  } else if (v === "journal") {
    const { closed, open } = jClosed(), win = closed.filter(x => x.pnl > 0), loss = closed.filter(x => x.pnl <= 0), avg = a => (a.length ? a.reduce((s, x) => s + x.ret, 0) / a.length : 0);
    h = `<section class="csec"><h3>交易日記 <button class="linkbtn" data-tx="jexport">匯出</button></h3>
      <form class="irform" id="jForm"><input id="jD" type="date" value="${toolsDay()}"><input id="jCode" placeholder="代號" value="${esc(W.sel && isTW(W.sel) ? W.sel : "")}" autocomplete="off" style="width:90px"><select id="jSide"><option value="buy">買進</option><option value="sell">賣出</option></select><input id="jPx" type="number" step="any" placeholder="價格" style="width:90px"><input id="jSh" type="number" step="1" placeholder="股數" style="width:90px"><input id="jWhy" placeholder="理由（例如：突破月線＋量增）" style="flex:1;min-width:160px"><button class="btn sm primary">記下</button></form>
      <div class="cokv three"><div><span>已實現</span><b>${closed.length} 筆</b><small>未平倉 ${open.length} 筆</small></div><div><span>勝率</span><b>${closed.length ? Math.round(win.length / closed.length * 100) + "%" : "—"}</b><small>賺 ${win.length}・賠 ${loss.length}</small></div><div><span>平均賺／賠</span><b>${win.length ? "+" + (avg(win) * 100).toFixed(1) + "%" : "—"} ／ ${loss.length ? (avg(loss) * 100).toFixed(1) + "%" : "—"}</b><small>賺賠比 ${loss.length && win.length ? Math.abs(avg(win) / avg(loss)).toFixed(2) : "—"}・總損益 ${Math.round(closed.reduce((s, x) => s + x.pnl, 0)).toLocaleString()}</small></div></div>
      ${closed.length ? `<h4>已實現（先進先出）</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>進場</th><th>出場</th><th>報酬</th><th>同期買進持有</th></tr></thead><tbody>${closed.slice(-30).reverse().map((x, k) => `<tr><td>${esc(nameOf(x.code))} ${x.code}</td><td>${x.in} @ ${fmtP(x.buy)}</td><td>${x.out} @ ${fmtP(x.sell)}</td><td class="${cls(x.ret)}">${(x.ret * 100).toFixed(2)}%</td><td class="note" data-jbh="${x.code}|${x.in}|${x.out}">—</td></tr>`).join("")}</tbody></table></div>` : ""}
      <h4>每一筆</h4><ul class="tlist">${JR().slice(0, 60).map(e => `<li><span class="note">${e.d}</span> ${e.side === "buy" ? "<b class='up'>買</b>" : "<b class='down'>賣</b>"} <button class="linkbtn" data-tsel="${e.code}">${esc(nameOf(e.code))} ${e.code}</button> ${e.sh ? e.sh.toLocaleString() + " 股" : ""} @ ${fmtP(e.px)} ${e.tags?.length ? `<span class="ctag one">${e.tags.map(esc).join("・")}</span>` : ""}<br><span>${esc(e.reason || "")}</span>${e.snap ? `<br><span class="note">當天：K ${e.snap.kd[0]}／D ${e.snap.kd[1]}・RSI ${e.snap.rsi}・${esc(e.snap.macd)}・${esc(e.snap.ma)}</span>` : ""} <button class="linkbtn" data-jdel="${e.id}">刪除</button></li>`).join("") || `<li class="note">還沒有紀錄。每次買賣記下理由，之後回頭看哪些理由真的賺錢。</li>`}</ul></section>`;
    note = "日記只存在這台裝置（可以匯出備份）；「當天」是記錄日期那根日 K 的指標，「同期買進持有」是同一段期間抱著不動的報酬。";
    setTimeout(jBH, 0);
  } else if (v === "multi") {
    const mode = W.multiMode || "codes", codes = multiCodes();
    h = `<section class="csec"><h3>多圖並排 <span class="seg sm" role="group">${[["codes", "4 檔股票"], ["tf", "同一檔 4 個週期"]].map(([k, t]) => `<button data-mm="${k}" aria-pressed="${mode === k}">${t}</button>`).join("")}</span></h3>
      ${mode === "codes" ? `<form class="irform" id="mForm">${[0, 1, 2, 3].map(i => `<input data-mc="${i}" value="${esc(codes[i] || "")}" placeholder="代號" style="width:90px" autocomplete="off">`).join("")}<button class="btn sm primary">套用</button></form>` : `<p class="note">${esc(nameOf(W.sel || "T00"))} ${W.sel || "T00"} 的日、週、月、季 K（在清單點其他股票就會換）</p>`}
      <div class="mgrid">${(mode === "codes" ? codes.slice(0, 4).map(c => "c:" + c) : ["t:D", "t:W", "t:M", "t:Q"]).map(k => `<div class="mbox" data-mbox="${esc(k)}"><h4>…</h4><div class="mchart chartbox"></div></div>`).join("")}</div></section>`;
    note = "每張圖都可以縮放、拖曳；點標題下方的圖會顯示當天數值。";
    setTimeout(multiDraw, 0);
  }
  $("#lx").innerHTML = h; return note;
}
async function jBH() {
  for (const el of document.querySelectorAll("#lx [data-jbh]")) { const [c, a, b] = el.dataset.jbh.split("|"), D = await dailyFresh(c); if (!D?.length) continue;
    const p = d => { let x = null; for (const k of D) { if (String(k.d).slice(0, 10) <= d) x = k.c; else break; } return x; }, pa = p(a), pb = p(b); if (pa && pb && el.isConnected) { el.textContent = ((pb / pa - 1) * 100).toFixed(2) + "%"; el.className = cls(pb - pa); } }
}
function toolsClick(e) {
  if (W.lt !== "tools") return; const b = e.target.closest("[data-tv],[data-tx],[data-tsel],[data-irdel],[data-paside],[data-jdel],[data-mm]"); if (!b) return; const d = b.dataset;
  if (d.tv) { W.tv = d.tv; renderList(); navPush(); }
  else if (d.tsel) select(d.tsel);
  else if (d.tx === "sumre") { W.sum = null; W.dk = new Map(); renderList(); }
  else if (d.tx === "sumai") sumAI();
  else if (d.tx === "irnow") irCheck(true);
  else if (d.tx === "pareset") { if (confirm("重設模擬帳戶（清除持股與紀錄，回到 100 萬）？")) { W.paper = PAPER0(); paSave(); renderList(); } }
  else if (d.tx === "jexport") { const blob = new Blob([JSON.stringify(JR(), null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `交易日記-${toolsDay()}.json`; a.click(); }
  else if (d.irdel != null) { IR().splice(+d.irdel, 1); irSave(); renderList(); }
  else if (d.jdel) { W.journal = JR().filter(x => x.id !== d.jdel); jSave(); renderList(); }
  else if (d.mm) { W.multiMode = d.mm; renderList(); }
  else if (d.paside) { e.preventDefault(); const c = $("#paCode").value.trim().toUpperCase(), err = paperOrder(c, d.paside, Math.round(+$("#paSh").value)); toast(err || `已${d.paside === "buy" ? "買進" : "賣出"} ${nameOf(c)} ${$("#paSh").value} 股`); if (!err) renderList(); }
}
function toolsSubmit(e) {
  if (W.lt !== "tools") return; const f = e.target; e.preventDefault();
  if (f.id === "irForm") { const c = $("#irCode").value.trim().toUpperCase(), cond = $("#irCond").value, C = condOf(cond); if (!isTW(c) && !isUS(c)) return toast("請輸入代號"); IR().push({ code: c, cond, p: C?.[2] && $("#irP").value !== "" ? +$("#irP").value : C?.[3] ?? null, on: true }); irSave(); irStart(); renderList(); irCheck(); try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {} }
  else if (f.id === "jForm") { const c = $("#jCode").value.trim().toUpperCase(), px = +$("#jPx").value; if (!c || !(px > 0)) return toast("請輸入代號和價格"); jAdd({ d: $("#jD").value || toolsDay(), code: c, side: $("#jSide").value, px, sh: +$("#jSh").value || 0, reason: $("#jWhy").value.trim() }); }
  else if (f.id === "mForm") { const L = [...f.querySelectorAll("[data-mc]")].map(x => x.value.trim().toUpperCase()).filter(Boolean).slice(0, 4); store.set("watch:multi", L); renderList(); }
}
function toolsChange(e) { if (W.lt === "tools" && e.target.dataset.iron != null) { IR()[+e.target.dataset.iron].on = e.target.checked; irSave(); } }
// 多週期共振：日、週、月 K 的多空判讀放在一起，三個方向一致才算共振
function mtfHtml() {
  const base = W.daily?.data; if (!base || base.length < 120) return "";
  const per = [["日", base], ["週", agg(base, weekKey)], ["月", agg(base, d => d.slice(0, 7))]].map(([t, D]) => { if (!D || D.length < (t === "月" ? 18 : 30)) return [t, null]; const I = indicators(D), it = readout(D, I, D.length - 1), b = it.filter(x => x.b > 0).length, s = it.filter(x => x.b < 0).length, sc = it.length ? (b - s) / it.length : 0; return [t, sc > 0.1 ? 1 : sc < -0.1 ? -1 : 0]; });
  const ok = per.filter(x => x[1] != null), all = ok.length >= 2 && ok.every(x => x[1] === ok[0][1]) && ok[0][1] !== 0;
  return `<div class="mtf"><span class="note">多週期：</span>${per.map(([t, v]) => `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${t} ${v == null ? "資料不足" : v > 0 ? "偏多" : v < 0 ? "偏空" : "中性"}</span>`).join("・")} ${all ? `<b class="${ok[0][1] > 0 ? "up" : "down"}">→ ${ok.length} 個週期${ok[0][1] > 0 ? "偏多" : "偏空"}共振</b>` : `<span class="note">→ 方向不一致，還沒有共振</span>`}</div>`;
}
