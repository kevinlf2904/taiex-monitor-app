/* ================= 看盤「工具」分頁：每日摘要、指標提醒、模擬交易、交易日記、多圖並排 =================
   這個檔案只定義函式（載入時 watch.html 的 W 還沒建立），由 watch.html 的清單分頁「工具」呼叫 renderTools()。
   資料都存在這台裝置的瀏覽器（localStorage）；指標用日 K 判斷，日 K 每 5 分鐘重抓一次。 */

const TOOLS_VIEWS = [["sum", "每日摘要"], ["alert", "提醒"], ["chipx", "籌碼動向"], ["paper", "模擬交易"], ["journal", "交易日記"], ["multi", "多圖並排"], ["sync", "備份同步"]];
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
const PAPER0 = () => ({ init: 1000000, cash: 1000000, initUsd: 30000, usd: 30000, pos: {}, hist: [], orders: [], eqh: [] });
// 舊帳戶補上美股子帳戶、掛單、資產紀錄
const PA = () => { const A = (W.paper ||= store.get("watch:paper", null) || PAPER0()); if (A.usd == null) { A.usd = A.initUsd = 30000; } A.orders ||= []; A.eqh ||= []; return A; };
const paSave = () => store.set("watch:paper", PA());
const paUS = c => !isTW(c) && isUS(c);
// 台股：手續費 0.1425%（最低 20 元）、證交稅（股票 0.3%、ETF 0.1%）；美股：手續費 0（多數美股券商免佣），只算美元
const paperFee = (v, c) => (c && paUS(c) ? 0 : Math.max(20, Math.round(v * 0.001425)));
const paperTax = (c, v) => (paUS(c) ? 0 : Math.round(v * (isEtf(c) ? 0.001 : 0.003)));
const paPx = c => (W.quotes.get(c) || (c === W.sel ? W.detailQ : null))?.price;
function paperOrder(c, side, sh, px0 = null, how = "市價") {
  const A = PA(), px = px0 ?? paPx(c), us = paUS(c), ck = us ? "usd" : "cash";
  if (isIdx(c) || (!isTW(c) && !isUS(c))) return "請輸入台股或美股代號";
  if (!px) return "還沒有這檔的報價，先在清單或個股頁讓它載入報價";
  if (!(sh > 0)) return "股數要大於 0";
  const v = us ? +(px * sh).toFixed(2) : Math.round(px * sh), fee = paperFee(v, c), P = A.pos[c];
  if (side === "buy") { if (v + fee > A[ck]) return `${us ? "美元" : ""}現金不足（需要 ${(v + fee).toLocaleString()}，剩 ${(+A[ck].toFixed(2)).toLocaleString()}）`; A[ck] -= v + fee; A.pos[c] = P ? { sh: P.sh + sh, cost: P.cost + v + fee } : { sh, cost: v + fee }; A.hist.unshift({ t: Date.now(), c, side, sh, px, fee, tax: 0, how }); }
  else { if (!P || P.sh < sh) return "持股不足"; const tax = paperTax(c, v), costPart = P.cost * sh / P.sh, pnl = v - fee - tax - costPart; A[ck] += v - fee - tax; P.sh -= sh; P.cost -= costPart; if (!P.sh) delete A.pos[c]; A.hist.unshift({ t: Date.now(), c, side, sh, px, fee, tax, pnl: us ? +pnl.toFixed(2) : Math.round(pnl), how }); }
  paSave(); if (W.paperJ !== false) jAdd({ d: toolsDay(), code: c, side, px, sh, reason: `模擬交易（${how}）`, tags: ["模擬"] }, true); return null;
}
// 掛單：限價（買：價格 ≤ 限價、賣：價格 ≥ 限價）、停損（買：價格 ≥ 觸發價、賣：價格 ≤ 觸發價），用最新報價成交；看盤開著才會檢查
function paperFill() {
  const A = PA(); if (!A.orders.length) return 0; let n = 0;
  A.orders = A.orders.filter(o => { const px = paPx(o.c); if (!px) return true;
    const hit = o.type === "limit" ? (o.side === "buy" ? px <= o.px : px >= o.px) : (o.side === "buy" ? px >= o.px : px <= o.px); if (!hit) return true;
    const err = paperOrder(o.c, o.side, o.sh, px, o.type === "limit" ? `限價 ${o.px}` : `停損 ${o.px}`); if (err) { o.err = err; return true; } n++; toast(`掛單成交：${nameOf(o.c)} ${o.side === "buy" ? "買進" : "賣出"} ${o.sh} 股 @ ${fmtP(px)}`); return false; });
  if (n) paSave(); return n;
}
// 每天記一次總資產（台股帳戶、美股帳戶分開），畫資產曲線和大盤比較
function paEquity() {
  const A = PA(); let tw = A.cash, us = A.usd;
  for (const [c, p] of Object.entries(A.pos)) { const v = (paPx(c) ?? p.cost / p.sh) * p.sh; if (paUS(c)) us += v; else tw += v; }
  const d = toolsDay(), last = A.eqh[A.eqh.length - 1], row = [d, Math.round(tw), +us.toFixed(2)];
  if (last?.[0] === d) A.eqh[A.eqh.length - 1] = row; else A.eqh.push(row); if (A.eqh.length > 400) A.eqh.shift(); return { tw, us };
}
function paStart() { if (W.paTimer) return; W.paTimer = setInterval(() => { if (document.visibilityState === "visible" && PA().orders.length && paperFill() && W.lt === "tools" && W.tv === "paper") renderList(); }, 20000); }
// 資產曲線（%）vs 加權指數、S&P 500（SPY）：小型 SVG
async function paCurve() {
  const el = $("#paCurve"), A = PA(); if (!el || A.eqh.length < 2) { if (el) el.innerHTML = `<p class="note">累積兩天以上才畫得出資產曲線（每天打開模擬交易會記一次）。</p>`; return; }
  const from = A.eqh[0][0], T = await dailyFresh("T00"), S = await dailyFresh("SPY").catch(() => null), at = (D, d) => { let x = null; for (const k of D || []) { if (String(k.d).slice(0, 10) <= d) x = k.c; else break; } return x; };
  const ser = [["台股帳戶", A.eqh.map(r => r[1] / A.init - 1), "var(--up)"], ["美股帳戶", A.eqh.map(r => r[2] / A.initUsd - 1), "var(--gold)"], ["加權指數", A.eqh.map(r => (at(T, r[0]) && at(T, from) ? at(T, r[0]) / at(T, from) - 1 : null)), "var(--muted)"], ["SPY", A.eqh.map(r => (S && at(S, r[0]) && at(S, from) ? at(S, r[0]) / at(S, from) - 1 : null)), "var(--line)"]];
  const all = ser.flatMap(x => x[1]).filter(v => v != null), lo = Math.min(0, ...all), hi = Math.max(0, ...all), W0 = 600, H0 = 160, n = A.eqh.length, X = i => (i / (n - 1)) * (W0 - 8) + 4, Y = v => H0 - 6 - ((v - lo) / (hi - lo || 1)) * (H0 - 12);
  if (!el.isConnected) return;
  el.innerHTML = `<svg viewBox="0 0 ${W0} ${H0}" preserveAspectRatio="none" style="width:100%;height:160px"><line x1="0" x2="${W0}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-dasharray="3 3"/>${ser.map(([, v, col]) => `<polyline fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${v.map((x, i) => (x == null ? "" : `${X(i).toFixed(1)},${Y(x).toFixed(1)}`)).filter(Boolean).join(" ")}"/>`).join("")}</svg>
    <p class="note">${ser.map(([t, v, col]) => `<span style="color:${col}">━</span> ${t} ${v[n - 1] == null ? "—" : retPct(v[n - 1])}`).join("　")}（從 ${from} 起算）</p>`;
}

const J_TAGS = ["突破", "回檔買進", "均線", "指標訊號", "型態", "籌碼", "消息／基本面", "停損", "停利", "其他"];
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
    else { let n = e.sh; while (n > 0 && L.length) { const b = L[0], k = Math.min(n, b.left); out.push({ code: e.code, in: b.d, out: e.d, sh: k, buy: b.px, sell: e.px, pnl: (e.px - b.px) * k, ret: e.px / b.px - 1, reason: b.reason, tags: b.tags || [], xtags: e.tags || [] }); b.left -= k; n -= k; if (!b.left) L.shift(); } }
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
  try { set({ text: await aiChat(sumText(), "請只根據「目前畫面」的資料，整理成今天的盤後摘要：大盤、自選股表現、觸發的技術訊號、國會新申報，最後列出明天值得留意的 3 件事。不要給買賣建議，用繁體中文、條列。") }); } catch (e) { set({ err: e.message }); }
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

/* ---------- 條件選股：股票範圍 × 條件積木（全部成立才列出） ---------- */
// 狀態型條件（今天的狀態，不是「剛發生」）＋上面的事件型條件（COND，今天剛發生）
const SCOND = [
  ["above", "收盤在均線之上", "天數", 20, (D, I, p) => { const n = D.length - 1, m = I.ma(p)[n]; return m && D[n].c > m ? `在 MA${p} 上 ${((D[n].c / m - 1) * 100).toFixed(1)}%` : null; }],
  ["below", "收盤在均線之下", "天數", 20, (D, I, p) => { const n = D.length - 1, m = I.ma(p)[n]; return m && D[n].c < m ? `在 MA${p} 下 ${((1 - D[n].c / m) * 100).toFixed(1)}%` : null; }],
  ["bull", "均線多頭排列（5>20>60）", null, null, (D, I) => { const n = D.length - 1, a = I.ma(5)[n], b = I.ma(20)[n], c = I.ma(60)[n]; return c && a > b && b > c ? "多頭排列" : null; }],
  ["bear", "均線空頭排列（5<20<60）", null, null, (D, I) => { const n = D.length - 1, a = I.ma(5)[n], b = I.ma(20)[n], c = I.ma(60)[n]; return c && a < b && b < c ? "空頭排列" : null; }],
  ["klt", "K 值低於", "數值", 30, (D, I, p) => { const v = I.kd.K[D.length - 1]; return v != null && v < p ? `K ${fmtN(v)}` : null; }],
  ["kgt", "K 值高於", "數值", 70, (D, I, p) => { const v = I.kd.K[D.length - 1]; return v != null && v > p ? `K ${fmtN(v)}` : null; }],
  ["difpos", "MACD 的 DIF 在零軸上", null, null, (D, I) => (I.macd.dif[D.length - 1] > 0 ? "DIF > 0" : null)],
  ["difup", "DIF 在訊號線之上", null, null, (D, I) => { const n = D.length - 1; return I.macd.dif[n] > I.macd.sig[n] ? "DIF > 訊號線" : null; }],
  ["chg5", "近 5 日漲幅至少（%）", "%", 5, (D, I, p) => { const n = D.length - 1, r = (D[n].c / D[n - 5].c - 1) * 100; return r >= p ? `5 日 ${r >= 0 ? "+" : ""}${r.toFixed(1)}%` : null; }],
  ["chg5n", "近 5 日跌幅至少（%）", "%", 5, (D, I, p) => { const n = D.length - 1, r = (D[n].c / D[n - 5].c - 1) * 100; return r <= -p ? `5 日 ${r.toFixed(1)}%` : null; }],
  ["nearhi", "收盤距 60 日高點在（%）以內", "%", 3, (D, I, p) => { const n = D.length - 1, h = Math.max(...D.slice(-60).map(x => x.h)), g = (1 - D[n].c / h) * 100; return g <= p ? `距 60 日高 ${g.toFixed(1)}%` : null; }],
  ["volr", "今天量是 20 日均量的幾倍以上", "倍數", 1.5, (D, I, p) => { const n = D.length - 1, a = I.vma[n - 1]; return a && D[n].v >= a * p ? `量 ${(D[n].v / a).toFixed(1)} 倍` : null; }],
  ["minvol", "成交量至少（張）", "張", 500, (D, I, p) => (D[D.length - 1].v >= p ? `量 ${fmtVol(D[D.length - 1].v)} 張` : null)],
  ["yld", "殖利率至少（%）", "%", 4, null],
  ["big1k", "千張大戶持股週增加至少（百分點）", "百分點", 0.3, null],
  ["big1kdn", "千張大戶持股週減少至少（百分點）", "百分點", 0.3, null],
  ...COND.map(([k, t, pn, pd, f]) => [`e:${k}`, `今天：${t}`, pn, pd, f]),
];
const SC = () => (W.scan ||= store.get("watch:scan", null) || { uni: "my", codes: "", rules: [{ k: "bull" }, { k: "e:macdgc" }] });
const scSave = () => store.set("watch:scan", { uni: SC().uni, codes: SC().codes, rules: SC().rules });
function scUniverse() {
  const U = SC().uni, hot = (W.hot?.tw?.rows || []).map(r => r.code), etf = (W.etfRank?.rows || []).map(r => r.code);
  const L = U === "my" ? myCodes().filter(isTW) : U === "hold" ? Object.keys(W.hold || {}).filter(isTW) : U === "hot" ? hot.slice(0, 60) : U === "etf" ? etf.slice(0, 60) : U === "all" ? [...myCodes().filter(isTW), ...Object.keys(W.hold || {}).filter(isTW), ...hot.slice(0, 60)] : String(SC().codes).toUpperCase().split(/[\s,，、]+/).filter(isTW);
  return U === "market" ? Object.keys(W.allk?.k || {}) : [...new Set(L)].slice(0, 120);
}
async function scRun() {
  const S = SC(), uni = scUniverse(); if (!uni.length && S.uni !== "market") return toast("股票範圍是空的");
  if (S.uni === "hot" && !W.hot?.tw) await loadHot("tw"); if (S.uni === "etf" && !W.etfRank) await loadEtfRank();
  if (S.uni === "market") { W.scanRes = { busy: true, done: 0, total: 0, rows: [], loading: true }; renderList(); try { await allkLoad(); } catch (e) { W.scanRes = null; renderList(); return toast(e.message); } }
  const list = scUniverse(), R = (W.scanRes = { busy: true, done: 0, total: list.length, rows: [] }); renderList();
  const need = S.rules.some(r => r.k === "yld") && S.uni !== "market"; if (need) { list.forEach(c => yldWant(c)); await new Promise(r => setTimeout(r, 1500)); }
  if (S.rules.some(r => /^big1k/.test(r.k))) await Promise.all([...new Set(list.map(c => c.slice(0, 2)))].map(tdccShard));
  const mk = S.uni === "market";
  let k = 0; const worker = async () => { while (k < list.length) { const c = list[k++], D = mk ? allkD(c) : await dailyFresh(c); R.done++; if (mk && R.done % 40 === 0) await tick0();
    if (D && D.length >= 65) { const I = indicators(D), hits = [];
      for (const r of S.rules) { const C = SCOND.find(x => x[0] === r.k); if (!C) continue; const p = r.p ?? C[3];
        const m = r.k === "yld" ? (() => { const y = yldNow(c, D[D.length - 1].c); return y != null && y >= p ? `殖利率 ${y.toFixed(2)}%` : null; })()
          : /^big1k/.test(r.k) ? (() => { const x = tdccChg(c); return x == null ? null : r.k === "big1k" ? (x >= p ? `千張大戶 +${x}` : null) : (x <= -p ? `千張大戶 ${x}` : null); })()
          : (() => { try { return C[4](D, I, p); } catch { return null; } })();
        if (!m) { hits.length = 0; hits.fail = true; break; } hits.push(m); }
      if (!hits.fail) R.rows.push({ c, hits, px: D[D.length - 1].c, chg: D.length > 1 ? D[D.length - 1].c / D[D.length - 2].c - 1 : 0 }); }
    if (R.done % (mk ? 200 : 6) === 0 && scanVis()) renderList(); } };
  await Promise.all(Array.from({ length: mk ? 1 : 6 }, worker)); if (mk) R.rows.sort((a, b) => b.chg - a.chg); R.date = mk ? W.allk.date : null; R.busy = false; R.at = Date.now(); if (toolsOn()) renderList();
}

/* ---------- 相對強弱（RS）：和加權指數比，近 20／60／120 日誰比較強 ---------- */
// 相對強弱、多因子共用的範圍：條件選股選「自己輸入代號」時用那些代號，否則自選＋庫存＋台股熱門前 60
const rsUniverse = () => (SC().uni === "custom" && SC().codes ? String(SC().codes).toUpperCase().split(/[\s,，、]+/).filter(isTW) : [...new Set([...myCodes().filter(isTW), ...Object.keys(W.hold || {}).filter(isTW), ...(W.hot?.tw?.rows || []).slice(0, 60).map(r => r.code)])]).filter(c => !isIdx(c)).slice(0, 120);
async function rsRun() {
  const mk = W.rsU === "market"; if (mk) { W.rsRes = { busy: true, done: 0, total: 0, rows: [] }; renderList(); try { await allkLoad(); } catch (e) { W.rsRes = null; renderList(); return toast(e.message); } }
  const list = mk ? Object.keys(W.allk.k).slice(0, 5000) : rsUniverse();
  const R = (W.rsRes = { busy: true, done: 0, total: list.length, rows: [], mk }); renderList(); if (!W.hot?.tw && !mk) loadHot("tw");
  const T = await dailyFresh("T00"), ret = (D, n) => (D && D.length > n ? D[D.length - 1].c / D[D.length - 1 - n].c - 1 : null), tr = { 20: ret(T, 20), 60: ret(T, 60), 120: ret(T, 120) };
  let k = 0; const worker = async () => { while (k < list.length) { const c = list[k++], D = mk ? allkD(c) : await dailyFresh(c); R.done++; if (mk && R.done % 100 === 0) { await tick0(); if (rsVis()) renderList(); } if (!D || D.length < 25 || (mk && !(D[D.length - 1].v >= 100))) continue;
    const row = { c, px: D[D.length - 1].c }; [20, 60, 120].forEach(n => { const r = ret(D, n); row["r" + n] = r; row["rs" + n] = r != null && tr[n] != null ? (1 + r) / (1 + tr[n]) - 1 : null; }); R.rows.push(row); } };
  await Promise.all(Array.from({ length: mk ? 1 : 6 }, worker)); R.tr = tr; R.busy = false; R.at = Date.now(); if (toolsOn()) renderList();
}

/* ---------- 多因子排行（quant.js 的 factorRaw／factorScore）：動能、價值、低波動、趨勢的百分位分數，權重可調；
   前幾名附 ATR 參考停損與目標（marketState＋atrSetup），可以跑每月再平衡的歷史回測（factorBacktest，價值因子沒有歷史資料不算） ---------- */
const MF = () => (W.mfx ||= { w: { ...FACTOR_W0, ...(store.get("watch:mfw", null) || {}) }, uni: store.get("watch:mfu", "") || "", top: 10 });
const mfVis = () => W.lt === "screen" && W.scrG === "score" && W.scoreMode === "factor";
async function mfValLoad() { if (W.mfVal) return W.mfVal; try { const j = await getJ("/api/screen?bw=1", true); W.mfVal = j.ok ? j.rows : {}; } catch { W.mfVal = {}; } return W.mfVal; }
async function mfRun() {
  const S = MF(), mk = S.uni === "market"; W.mfRes = { busy: true, done: 0, total: 0, rows: [] }; W.mfBt = null; renderList();
  if (mk) { try { await allkLoad(); } catch (e) { W.mfRes = null; renderList(); return toast(e.message); } } else if (!W.hot?.tw) await loadHot("tw").catch(() => {});
  const list = mk ? Object.keys(W.allk.k) : rsUniverse(), R = (W.mfRes = { busy: true, done: 0, total: list.length, rows: [], mk }), V = await mfValLoad();
  let k = 0; const worker = async () => { while (k < list.length) { const c = list[k++], D = mk ? allkD(c) : await dailyFresh(c); R.done++; if (mk && R.done % 150 === 0) { await tick0(); if (mfVis()) renderList(); }
    if (!D || D.length < 72 || (mk && !(D[D.length - 1].v >= 300))) continue; const v = V[c], f = factorRaw(D, D.length - 1, v ? { pe: v[0] } : null); if (f) R.rows.push({ c, f, px: D[D.length - 1].c, pe: v?.[0] ?? null, D: mk ? null : D }); } };
  await Promise.all(Array.from({ length: mk ? 1 : 6 }, worker)); R.busy = false; R.at = Date.now(); R.val = Object.keys(V).length > 0; if (mfVis()) renderList();
}
// 歷史回測：自選＋熱門用約 2 年日 K（每月一期，約 20 期），全市場只有最近 130 個交易日（約 2～3 期，只能參考）
async function mfBacktest() {
  const S = MF(), R = W.mfRes; if (!R?.rows.length) return;
  W.mfBt = { busy: true }; renderList();
  const series = R.mk ? R.rows.map(r => ({ c: r.c, D: allkD(r.c) })) : await Promise.all(R.rows.map(async r => ({ c: r.c, D: await getJ(`/api/kline?code=${r.c}&months=24`).then(j => j.data || null).catch(() => null) })));
  W.mfBt = factorBacktest(series, S.w, { hold: 21, top: S.top }) || { err: "能回測的股票太少（至少 4 檔、各 75 根以上）" }; if (mfVis()) renderList();
}
function mfHtml() {
  const S = MF(), R = W.mfRes, B = W.mfBt, tw = Object.values(S.w).reduce((a, b) => a + b, 0) || 1;
  let h = `<section class="csec"><h3>多因子排行 <span class="seg sm" role="group">${[["", "自選＋熱門"], ["market", "全市場"]].map(([a, t]) => `<button data-mfu="${a}" aria-pressed="${S.uni === a}">${t}</button>`).join("")}</span> <button class="btn sm primary" data-mfrun ${R?.busy ? "disabled" : ""}>${R?.busy ? `計算中 ${R.done}/${R.total}…` : R ? "重新計算" : "開始計算"}</button></h3>
    <div class="qx-w">${FACTORS.map(([k, t]) => `<label title="${esc(FACTORS.find(x => x[0] === k)[2])}"><span>${t}</span><input type="range" min="0" max="50" step="5" value="${S.w[k]}" data-mfw="${k}" aria-label="${t}權重"><b>${Math.round(S.w[k] / tw * 100)}%</b></label>`).join("")}</div>
    <details class="mkmore"><summary>每個因子怎麼算</summary><ul class="note">${FACTORS.map(([, t, d]) => `<li><b>${t}</b>：${esc(d)}</li>`).join("")}<li>每個因子換算成範圍內的百分位（0～100，越高越好），再依上面的權重加權平均成總分。權重拉到 0 就是不看那個因子。</li></ul></details>`;
  if (!R) return h + `<p class="note">按「開始計算」。全市場第一次要下載約 3MB 的全市場日 K。</p></section>`;
  const rows = factorScore(R.rows.map(r => ({ ...r })), S.w), top = rows.slice(0, 30);
  const setups = top.map(r => { const D = r.D || (R.mk ? allkD(r.c) : null), St = D ? marketState(D) : null; return St ? { St, X: atrSetup(St) } : null; });
  h += `<p class="note">${R.busy ? "計算中…" : `共 ${rows.length} 檔有足夠資料${R.mk ? "（排除當天成交量不到 300 張）" : ""}；${R.val ? "本益比來自證交所、櫃買中心" : "本益比暫時拿不到，價值因子都給 50 分"}。`}</p>
    <div class="ctbl"><table><thead><tr><th>#</th><th>股票</th><th>收盤</th><th>總分</th>${FACTORS.map(([, t]) => `<th>${t}</th>`).join("")}<th>本益比</th><th>行情</th><th>ATR 參考停損／目標</th><th>報酬風險比</th></tr></thead><tbody>
    ${top.map((r, i) => { const X = setups[i]; return `<tr><td>${i + 1}</td><td><button class="linkbtn" data-tsel="${r.c}">${esc(nameOf(r.c))} ${r.c}</button></td><td>${fmtP(r.px)}</td><td><b class="${r.score >= 70 ? "up" : r.score <= 40 ? "down" : ""}">${r.score}</b></td>${FACTORS.map(([k]) => `<td>${r.s[k]}</td>`).join("")}<td>${r.pe > 0 ? r.pe.toFixed(1) : "—"}</td><td class="${X?.St.trend === "bull" ? "up" : X?.St.trend === "bear" ? "down" : ""}">${X ? REG_NAME[X.St.trend] : "—"}</td><td>${X?.X ? `${fmtP(X.X.stop)}／${fmtP(X.X.tgt)}` : "—"}</td><td class="${X?.X?.rr >= 2 ? "up" : X?.X?.rr < 1.5 ? "down" : ""}">${X?.X ? X.X.rr.toFixed(2) : "—"}</td></tr>`; }).join("") || `<tr><td colspan="12" class="note">${R.busy ? "…" : "沒有資料"}</td></tr>`}</tbody></table></div>`;
  if (top.length >= 4) { const n = Math.min(S.top, top.length);
    h += `<h4>投資組合範例 <span class="note">前 ${n} 名等權重，每檔 ${(100 / n).toFixed(0)}%，每月（約 21 個交易日）重新排名、再平衡</span></h4><p>${top.slice(0, n).map(r => `<button class="linkbtn" data-tsel="${r.c}">${esc(nameOf(r.c))}</button>`).join("、")}</p>
      <div class="irform"><button class="btn sm" data-mfbt ${B?.busy || R.busy ? "disabled" : ""}>${B?.busy ? "回測中…" : "回測這個權重（每月再平衡）"}</button>${R.mk ? `<span class="note">全市場只有最近 130 個交易日，回測期數很少</span>` : ""}</div>`;
    if (B && !B.busy) h += B.err ? `<p class="note">⚠ ${esc(B.err)}</p>` : B.short ? `<p class="note">資料只有 ${B.days} 個交易日，扣掉計算因子需要的 70 天後不夠一期。</p>`
      : `${qCards([["前 " + B.top + " 名累積", qP(B.ret), `${B.per.length} 期`, qC(B.ret)], ["同範圍等權重", qP(B.all), "全部股票平均", qC(B.all)], ["勝過同範圍", `${Math.round(B.hit * 100)}%`, "的期數"], ["平均每期超額", qP(B.ex, 2), "前幾名 − 全部平均", qC(B.ex)]])}
        <div class="ctbl"><table><thead><tr><th>期間</th><th>前 ${B.top} 名</th><th>全部平均</th><th>入選</th></tr></thead><tbody>${B.per.map(x => `<tr><td>${x.d.slice(2)}～${x.to.slice(5)}</td><td class="${cls(x.ret)}">${retPct(x.ret)}</td><td class="${cls(x.all)}">${retPct(x.all)}</td><td class="note">${x.codes.slice(0, 5).map(c => esc(nameOf(c))).join("、")}${x.codes.length > 5 ? "…" : ""}</td></tr>`).join("")}</tbody></table></div>
        <p class="note">回測用每一期當天為止的資料排名（不偷看未來），不含交易成本；歷史本益比拿不到，所以回測只用動能、低波動、趨勢三個因子。範圍是目前的股票清單，已經下市或被剔除的股票不在裡面（倖存者偏差），結果會偏樂觀。</p>`; }
  const ak = "mf"; if (top.length) QAI[ak] = { done: renderList, ctx: () => `多因子排行（權重：${FACTORS.map(([k, t]) => `${t} ${Math.round(S.w[k] / tw * 100)}%`).join("、")}；分數是範圍內的百分位）前 10 名：\n` + top.slice(0, 10).map((r, i) => `${i + 1}. ${nameOf(r.c)} ${r.c} 收盤 ${fmtP(r.px)}、總分 ${r.score}、${FACTORS.map(([k, t]) => `${t} ${r.s[k]}`).join("、")}、本益比 ${r.pe > 0 ? r.pe.toFixed(1) : "—"}${setups[i] ? `、行情 ${REG_NAME[setups[i].St.trend]}${setups[i].X ? `、ATR 參考停損 ${fmtP(setups[i].X.stop)} 目標 ${fmtP(setups[i].X.tgt)} 報酬風險比 ${setups[i].X.rr.toFixed(2)}` : ""}` : ""}`).join("\n"),
    q: "請只根據上面的分數與數字，說明前 5 名各自是靠哪些因子入選、技術面（行情、停損目標、報酬風險比）有什麼要注意的，以及這組權重偏向哪一種風格、在什麼市場環境容易失效。不要給買賣建議，用繁體中文、條列。" };
  return h + (top.length ? qAiBlock({ key: ak, R: W.qai?.[ak] }, "🤖 AI 說明前 5 名為什麼入選") : "") + `</section>`;
}

/* ---------- 營收、財報的法定公布期限（大盤「理財行事曆」用）：每月 10 日前公布上月營收；Q1 5/15、Q2 8/14、Q3 11/14、年報 3/31 ---------- */
function calDeadlines(a, b) {
  const out = [], y0 = +a.slice(0, 4);
  for (const y of [y0, y0 + 1]) { for (let m = 1; m <= 12; m++) { const d = `${y}-${String(m).padStart(2, "0")}-10`; if (d >= a && d <= b) out.push({ d, t: "上個月營收公布期限（每月 10 日前）" }); }
    for (const [md, t] of [["03-31", "年度財報公布期限"], ["05-15", "第一季財報公布期限"], ["08-14", "第二季（半年報）公布期限"], ["11-14", "第三季財報公布期限"]]) { const d = `${y}-${md}`; if (d >= a && d <= b) out.push({ d, t }); } }
  return out.sort((x, y) => x.d.localeCompare(y.d));
}

/* ---------- 畫面 ---------- */
// 這些畫面也被別的分頁借用：條件選股、相對強弱在「選股」，內部人申報在「申報」
const toolsOn = () => W.lt === "tools" || (W.lt === "screen" && (W.scrG === "custom" || W.scrG === "rs" || (W.scrG === "score" && W.scoreMode === "factor"))) || (W.lt === "cong" && (W.cv === "ins" || String(W.cv).startsWith("tw")));
const scanVis = () => W.lt === "screen" && W.scrG === "custom", rsVis = () => W.lt === "screen" && W.scrG === "rs", insVis = () => W.lt === "cong" && W.cv === "ins";
function renderTools() {
  if (!TOOLS_VIEWS.some(x => x[0] === W.tv)) W.tv = "sum";
  const v = W.tv;
  $("#lTools").innerHTML = `<div class="seg" role="group" aria-label="工具">${TOOLS_VIEWS.map(([k, t]) => `<button data-tv="${k}" aria-pressed="${v === k}">${t}</button>`).join("")}</div>`;
  const r = toolsBody(v); $("#lx").innerHTML = r.h; return r.note;
}
function toolsBody(v) {
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
      <h4>今天的指標提醒</h4><ul class="tlist">${(W.irLog ||= store.get("watch:irlog", []) || []).filter(x => x.d === toolsDay()).map(x => `<li>${x.t} ${esc(nameOf(x.code))} ${x.code}：${esc(x.msg)}</li>`).join("") || `<li class="note">沒有（在「提醒」設定條件）</li>`}</ul>
      <h4>國會新申報（最近 3 天）</h4><ul class="tlist">${cg.slice(0, 12).map(t => `<li>${esc(pName(t.pid))} ${t.k === "buy" ? "<b class='up'>買進</b>" : "<b class='down'>賣出</b>"} ${esc(t.ticker)} ${amtTxt(t.amount)} <span class="note">交易日 ${t.traded}</span></li>`).join("") || `<li class="note">沒有</li>`}</ul></section>`;
    note = "摘要用即時報價與日 K 整理；AI 整理只根據畫面上的資料，不是買賣建議。";
  } else if (v === "scan") {
    const S = SC(), R = W.scanRes, copt = sel => SCOND.map(([k, t]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(t)}</option>`).join("");
    h = `<section class="csec"><h3>條件選股</h3>
      <div class="irform"><label class="note">股票範圍 <select data-scu>${[["my", "自選股"], ["hold", "庫存"], ["hot", "台股熱門前 60"], ["etf", "ETF 成交值前 60"], ["all", "自選＋庫存＋熱門"], ["market", "全市場（上市櫃約 2300 檔）"], ["custom", "自己輸入代號"]].map(([k, t]) => `<option value="${k}" ${S.uni === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${S.uni === "custom" ? `<input data-scc value="${esc(S.codes || "")}" placeholder="代號用空白或逗號分開" style="flex:1;min-width:200px">` : ""}</div>
      <div class="scrules">${S.rules.map((r, i) => { const C = SCOND.find(x => x[0] === r.k); return `<div class="irform"><span class="note">${i ? "且" : "條件"}</span><select data-scr="${i}">${copt(r.k)}</select>${C?.[2] ? `<input type="number" step="any" data-scp="${i}" value="${r.p ?? C[3]}" style="width:80px" aria-label="${esc(C[2])}"><span class="note">${esc(C[2])}</span>` : ""}<button class="linkbtn" data-scdel="${i}">刪除</button></div>`; }).join("")}</div>
      <div class="irform"><button class="btn sm" data-scadd>＋ 加一個條件</button><button class="btn sm primary" data-scrun ${R?.busy ? "disabled" : ""}>${R?.loading ? "下載全市場資料…" : R?.busy ? `掃描中 ${R.done}/${R.total}…` : "開始選股"}</button></div>
      ${R ? `<h4>符合全部條件：${R.rows.length} 檔${R.busy ? "（掃描中）" : `／共掃描 ${R.total} 檔`}${R.rows.length > 200 ? "（只列前 200 檔，依漲跌幅排序）" : ""}</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>收盤</th><th>漲跌</th><th>符合的條件</th></tr></thead><tbody>${R.rows.slice(0, 200).map(x => `<tr><td><button class="linkbtn" data-tsel="${x.c}">${esc(nameOf(x.c))} ${x.c}</button></td><td>${fmtP(x.px)}</td><td class="${cls(x.chg)}">${(x.chg * 100).toFixed(2)}%</td><td>${x.hits.map(esc).join("・")}</td></tr>`).join("") || `<tr><td colspan="4" class="note">${R.busy ? "…" : "沒有股票同時符合全部條件，試著拿掉一個條件"}</td></tr>`}</tbody></table></div>` : ""}</section>`;
    note = (S.uni === "market" ? `全市場用排程每天收盤後整理的日 K（最近 130 個交易日${W.allk?.date ? "，資料日 " + W.allk.date : ""}），第一次要下載約 3MB；殖利率條件在全市場模式不檢查。` : "") + "用日 K（最近 6 個月）判斷；「今天：」開頭的是今天剛發生的事件（例如金叉），其他是目前的狀態。條件與範圍會記住。只是篩選工具，不是買賣建議。";
  } else if (v === "rs") {
    const R = W.rsRes, k = W.rsK || "rs60", rows = (R?.rows || []).filter(x => x[k] != null).sort((a, b) => b[k] - a[k]), n = rows.length;
    h = `<section class="csec"><h3>相對強弱排行 <span class="seg sm" role="group">${[["rs20", "20 日"], ["rs60", "60 日"], ["rs120", "120 日"]].map(([a, t]) => `<button data-rsk="${a}" aria-pressed="${k === a}">${t}</button>`).join("")}</span> <span class="seg sm" role="group">${[["", "自選＋熱門"], ["market", "全市場"]].map(([a, t]) => `<button data-rsu="${a}" aria-pressed="${(W.rsU || "") === a}">${t}</button>`).join("")}</span> <button class="btn sm primary" data-rsrun ${R?.busy ? "disabled" : ""}>${R?.busy ? `計算中 ${R.done}/${R.total}…` : R ? "重新計算" : "開始計算"}</button></h3>
      <p class="note">RS＝（1＋個股報酬）÷（1＋加權指數報酬）− 1，正的代表比大盤強。範圍：自選、庫存與台股熱門前 60（條件選股選「自己輸入代號」時改用那些代號）；選「全市場」時用排程整理的全部上市櫃股票（排除當天成交量不到 100 張的）。${R?.tr ? `同期加權指數：20 日 ${retPct(R.tr[20])}、60 日 ${retPct(R.tr[60])}、120 日 ${retPct(R.tr[120])}` : ""}</p>
      ${R ? `<div class="ctbl"><table><thead><tr><th>#</th><th>股票</th><th>收盤</th><th>20 日</th><th>60 日</th><th>120 日</th><th>RS（${k.slice(2)} 日）</th><th>百分位</th></tr></thead><tbody>${rows.slice(0, 300).map((x, i) => `<tr><td>${i + 1}</td><td><button class="linkbtn" data-tsel="${x.c}">${esc(nameOf(x.c))} ${x.c}</button></td><td>${fmtP(x.px)}</td><td class="${cls(x.r20)}">${retPct(x.r20)}</td><td class="${cls(x.r60)}">${retPct(x.r60)}</td><td class="${cls(x.r120)}">${retPct(x.r120)}</td><td class="${cls(x[k])}"><b>${retPct(x[k])}</b></td><td>${n > 1 ? Math.round((1 - i / (n - 1)) * 100) : 100}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;
    note = "相對強弱只看過去的價格表現，強勢股也可能隨時轉弱；百分位 100 是範圍內最強。";
  } else if (v === "mf") {
    h = mfHtml(); note = "多因子排行是把幾個常見的選股因子換成分數，幫你縮小研究範圍；ATR 停損與目標是教學用的參考計算，不是買賣建議。";
  } else if (v === "ins") {
    h = insHtml(); note = "內部人申報是公開資訊，可以當成籌碼面的參考；大股東轉讓的原因很多（繳稅、贈與、信託、資金需求），不一定代表看壞。";
  } else if (v === "chipx") {
    h = chipxHtml(); note = "集保每週六更新、借券／當沖／Put-Call 比每個交易日晚上更新（排程）。";
  } else if (v === "sync") {
    h = syncHtml(); note = "雲端同步只存同步碼的雜湊與你的設定，不需要帳號；同步碼遺失就無法取回雲端資料，記得也匯出一份備份檔。";
  } else if (v === "alert") {
    const L = IR(), opt = COND.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join("");
    h = `<section class="csec"><h3>提醒 <button class="btn sm" data-tx="irnow">立即檢查</button></h3><h4>技術指標與策略訊號</h4>
      <p class="note">看盤開著時每 5 分鐘用日 K 檢查一次，條件成立會跳通知（同一條件一天通知一次）。iPad／iPhone 要把網站「加入主畫面」再允許通知，才收得到系統通知；關掉網頁就不會檢查。</p>
      <form class="irform" id="irForm"><input id="irCode" placeholder="代號，例如 2330" value="${esc(W.sel && isTW(W.sel) ? W.sel : "")}" autocomplete="off"><select id="irCond">${opt}</select><input id="irP" type="number" step="any" placeholder="參數" style="width:80px"><button class="btn sm primary">＋ 新增</button></form>
      <div class="ctbl"><table><thead><tr><th>股票</th><th>條件</th><th>目前</th><th>上次通知</th><th></th></tr></thead><tbody>
      ${L.map((r, i) => `<tr><td><button class="linkbtn" data-tsel="${r.code}">${esc(nameOf(r.code))} ${r.code}</button></td><td>${esc(condName(r.cond, r.p))}${condOf(r.cond)?.[2] && !/\bN\b/.test(condOf(r.cond)[1]) ? `（${condOf(r.cond)[2]} ${r.p ?? condOf(r.cond)[3]}）` : ""}</td><td>${r.chk ? (r.now ? `<b class="up">成立</b>：${esc(r.now)}` : `<span class="note">未成立</span>`) : `<span class="note">尚未檢查</span>`}</td><td class="note">${r.last || "—"}</td><td><label class="note"><input type="checkbox" data-iron="${i}" ${r.on ? "checked" : ""}> 開</label> <button class="linkbtn" data-irdel="${i}">刪除</button></td></tr>`).join("") || `<tr><td colspan="5" class="note">還沒有條件。上面輸入代號、選條件就能新增。</td></tr>`}</tbody></table></div>
      <h4>價格提醒 <span class="note">在個股頁按「🔔 提醒」設定漲到、跌到某價</span></h4><div class="ctbl"><table><tbody>${Object.entries(W.alerts || {}).filter(([, a]) => a?.up || a?.dn).map(([c, a]) => `<tr><td><button class="linkbtn" data-tsel="${c}">${esc(nameOf(c))} ${c}</button></td><td>${a.up ? `漲到 <b class="up">${fmtP(a.up)}</b>` : ""}${a.up && a.dn ? "、" : ""}${a.dn ? `跌到 <b class="down">${fmtP(a.dn)}</b>` : ""}</td><td class="note">現價 ${fmtP(W.quotes.get(c)?.price)}</td><td><button class="linkbtn" data-paldel="${c}">刪除</button></td></tr>`).join("") || `<tr><td class="note">沒有價格提醒</td></tr>`}</tbody></table></div>
      <h4>最近的提醒紀錄</h4><ul class="tlist">${(W.irLog ||= store.get("watch:irlog", []) || []).slice(0, 20).map(x => `<li><span class="note">${x.d} ${x.t}</span> ${esc(nameOf(x.code))} ${x.code}：${esc(x.msg)}</li>`).join("") || "<li class='note'>沒有</li>"}</ul></section>`;
    note = "技術指標提醒與價格提醒都在這裡管理；綁定 Telegram（備份同步）後，收盤後也會推播。";
  } else if (v === "paper") {
    paperFill(); const A = PA(), E = paEquity(); paSave(); if (A.orders.length) paStart();
    const pos = Object.entries(A.pos).map(([c, p]) => { const px = paPx(c) ?? p.cost / p.sh; return { c, ...p, px, mv: px * p.sh, us: paUS(c) }; }), m = (v, us) => (us ? "$" + (+v.toFixed(2)).toLocaleString() : Math.round(v).toLocaleString());
    const kv = (t, eq, init, cash, us) => `<div><span>${t}</span><b class="${cls(eq - init)}">${m(eq, us)}</b><small>報酬 ${((eq / init - 1) * 100).toFixed(2)}%・現金 ${m(cash, us)}</small></div>`;
    const sel = W.sel && (isTW(W.sel) || isUS(W.sel)) && !isIdx(W.sel) ? W.sel : "";
    h = `<section class="csec"><h3>模擬交易 <span class="note">紙上帳戶・台股＋美股</span> <button class="linkbtn" data-tx="pareset">重設帳戶</button></h3>
      <div class="cokv three">${kv("台股帳戶（台幣）", E.tw, A.init, A.cash)}${kv("美股帳戶（美元）", E.us, A.initUsd, A.usd, true)}<div><span>持股</span><b>${pos.length} 檔</b><small>掛單 ${A.orders.length} 筆</small></div></div>
      <div id="paCurve" class="pacurve"></div>
      ${jRulesHtml(false)}
      <form class="irform" id="paForm"><input id="paCode" placeholder="代號（台股或美股）" value="${esc(sel)}" autocomplete="off" style="width:120px"><input id="paSh" type="number" min="1" step="1" value="${sel && paUS(sel) ? 10 : 1000}" style="width:90px"><span class="note">股</span>
        <select id="paType"><option value="mkt">市價</option><option value="limit">限價</option><option value="stop">停損／突破</option></select><input id="paPx" type="number" step="any" placeholder="掛單價" style="width:90px">
        <button class="btn sm primary" data-paside="buy">買進</button><button class="btn sm" data-paside="sell">賣出</button></form>
      <p class="note">市價用目前的即時報價成交。限價：買進在價格跌到限價以下、賣出在漲到限價以上時成交；停損／突破：賣出在跌破觸發價、買進在突破觸發價時成交（看盤開著時每 20 秒檢查）。台股手續費 0.1425%（最低 20 元）＋賣出證交稅（股票 0.3%、ETF 0.1%）；美股不收手續費、只算美元。每筆會自動記到交易日記（標「模擬」）。</p>
      ${A.orders.length ? `<h4>掛單中</h4><div class="ctbl"><table><tbody>${A.orders.map((o, i) => `<tr><td>${esc(nameOf(o.c))} ${o.c}</td><td>${o.side === "buy" ? "<b class='up'>買</b>" : "<b class='down'>賣</b>"} ${o.sh.toLocaleString()} 股</td><td>${o.type === "limit" ? "限價" : "停損／突破"} ${fmtP(o.px)}</td><td class="note">現價 ${fmtP(paPx(o.c))}${o.err ? "・⚠ " + esc(o.err) : ""}</td><td><button class="linkbtn" data-paodel="${i}">取消</button></td></tr>`).join("")}</tbody></table></div>` : ""}
      <div class="ctbl"><table><thead><tr><th>股票</th><th>股數</th><th>平均成本</th><th>現價</th><th>未實現損益</th></tr></thead><tbody>${pos.map(x => `<tr><td><button class="linkbtn" data-tsel="${x.c}">${esc(nameOf(x.c))} ${x.c}</button></td><td>${x.sh.toLocaleString()}</td><td>${fmtP(x.cost / x.sh)}</td><td>${fmtP(x.px)}</td><td class="${cls(x.mv - x.cost)}">${m(x.mv - x.cost, x.us)}（${((x.mv / x.cost - 1) * 100).toFixed(2)}%）</td></tr>`).join("") || `<tr><td colspan="5" class="note">還沒有持股</td></tr>`}</tbody></table></div>
      <h4>成交紀錄</h4><div class="ctbl"><table><tbody>${A.hist.slice(0, 40).map(x => `<tr><td class="note">${new Date(x.t + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ")}</td><td>${esc(nameOf(x.c))} ${x.c}</td><td>${x.side === "buy" ? "<b class='up'>買</b>" : "<b class='down'>賣</b>"} ${x.sh.toLocaleString()} 股 @ ${fmtP(x.px)} <span class="note">${esc(x.how || "市價")}</span></td><td class="note">${x.fee ? "費 " + x.fee : ""}${x.tax ? `・稅 ${x.tax}` : ""}</td><td class="${cls(x.pnl)}">${x.pnl != null ? "損益 " + x.pnl.toLocaleString() : ""}</td></tr>`).join("") || `<tr><td class="note">沒有</td></tr>`}</tbody></table></div></section>`;
    note = "模擬交易只記在這台裝置（可以在「備份同步」同步到其他裝置），用來練習，不會真的下單。"; setTimeout(paCurve, 0);
  } else if (v === "journal") {
    const { closed, open } = jClosed(), win = closed.filter(x => x.pnl > 0), loss = closed.filter(x => x.pnl <= 0), avg = a => (a.length ? a.reduce((s, x) => s + x.ret, 0) / a.length : 0);
    h = `<section class="csec"><h3>交易日記 <button class="linkbtn" data-tx="jexport">匯出</button> <button class="btn sm" data-tx="jai">🤖 AI 檢討</button></h3>
      ${W.jAI ? `<div class="caibox">${W.jAI.loading ? "AI 讀最近 20 筆交易中（約 10～30 秒）…" : W.jAI.err ? "⚠ " + esc(W.jAI.err) : esc(W.jAI.text).replace(/\n/g, "<br>") + (jRulesOf(W.jAI.text).length ? `<p><button class="btn sm primary" data-tx="jrsave">把這 ${jRulesOf(W.jAI.text).length} 條存成我的規則</button></p>` : "")}</div>` : ""}
      ${jRulesHtml()}
      <form class="irform" id="jForm"><input id="jD" type="date" value="${toolsDay()}"><input id="jCode" placeholder="代號" value="${esc(W.sel && isTW(W.sel) ? W.sel : "")}" autocomplete="off" style="width:90px"><select id="jSide"><option value="buy">買進</option><option value="sell">賣出</option></select><input id="jPx" type="number" step="any" placeholder="價格" style="width:90px"><input id="jSh" type="number" step="1" placeholder="股數" style="width:90px"><select id="jTag" aria-label="理由分類">${J_TAGS.map(t => `<option>${t}</option>`).join("")}</select><input id="jWhy" placeholder="理由（例如：突破月線＋量增）" style="flex:1;min-width:160px"><button class="btn sm primary">記下</button></form>
      <div class="cokv three"><div><span>已實現</span><b>${closed.length} 筆</b><small>未平倉 ${open.length} 筆</small></div><div><span>勝率</span><b>${closed.length ? Math.round(win.length / closed.length * 100) + "%" : "—"}</b><small>賺 ${win.length}・賠 ${loss.length}</small></div><div><span>平均賺／賠</span><b>${win.length ? "+" + (avg(win) * 100).toFixed(1) + "%" : "—"} ／ ${loss.length ? (avg(loss) * 100).toFixed(1) + "%" : "—"}</b><small>賺賠比 ${loss.length && win.length ? Math.abs(avg(win) / avg(loss)).toFixed(2) : "—"}・總損益 ${Math.round(closed.reduce((s, x) => s + x.pnl, 0)).toLocaleString()}</small></div></div>
      ${jTagStats(closed)}
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
  return { h, note };
}
// 依進場理由分類：哪一種理由的勝率、平均報酬最好（模擬交易的「模擬」標籤不算分類）
function jTagStats(closed) {
  const by = new Map(); for (const x of closed) { const t = (x.tags || []).find(t => t !== "模擬") || "未分類"; (by.get(t) || by.set(t, []).get(t)).push(x); }
  if (!by.size) return "";
  const rows = [...by].map(([t, L]) => ({ t, n: L.length, win: L.filter(x => x.pnl > 0).length / L.length, avg: L.reduce((s, x) => s + x.ret, 0) / L.length, pnl: L.reduce((s, x) => s + x.pnl, 0) })).sort((a, b) => b.avg - a.avg);
  return `<h4>依進場理由</h4><div class="ctbl"><table><thead><tr><th>理由</th><th>筆數</th><th>勝率</th><th>平均報酬</th><th>總損益</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.t)}</td><td>${r.n}</td><td>${Math.round(r.win * 100)}%</td><td class="${cls(r.avg)}">${retPct(r.avg)}</td><td class="${cls(r.pnl)}">${Math.round(r.pnl).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>${rows.length > 1 ? `<p class="note">${esc(rows[0].t)} 的平均報酬最好、${esc(rows[rows.length - 1].t)} 最差${rows.some(r => r.n < 5) ? "（筆數少於 5 的分類參考價值有限）" : ""}。</p>` : ""}`;
}
// AI 檢討：最近 20 筆已實現交易＋對應的日記（理由、當天技術面）＋賣出後 20 個交易日的走勢（看有沒有太早賣、錯過行情），
// 請 AI 找出反覆出現的錯誤、錯過的機會、行為偏誤，最後用「【規則】」列 3 條可以立刻執行的個人規則（可以存起來，下單時提醒）
const JRULES = () => (W.jrules ||= store.get("watch:jrules", []) || []);
const jrSave = () => store.set("watch:jrules", JRULES());
async function jAI() {
  const { closed } = jClosed(), last = closed.slice(-20); if (!last.length) return toast("還沒有已實現的交易（要有買、也有賣）");
  W.jAI = { loading: true }; renderList();
  const after = async x => { const D = await dailyFresh(x.code); if (!D?.length) return null; const i = D.findIndex(k => String(k.d).slice(0, 10) > x.out); return i < 0 ? null : D[Math.min(D.length - 1, i + 19)].c / x.sell - 1; };
  const aft = await Promise.all(last.map(x => after(x).catch(() => null))), from = last[0].in, L = JR().filter(e => e.d >= from).slice(0, 80);
  const txt = [`最近 ${last.length} 筆已實現交易（先進先出配對）：`, ...last.map((x, k) => `${k + 1}. ${nameOf(x.code)} ${x.code} ${x.in} 買 @${x.buy} → ${x.out} 賣 @${x.sell}，報酬 ${(x.ret * 100).toFixed(1)}%，進場分類:${(x.tags || []).join("/") || "無"}，理由:${x.reason || "無"}${aft[k] != null ? `，賣出後 20 個交易日又${aft[k] >= 0 ? "漲" : "跌"} ${(Math.abs(aft[k]) * 100).toFixed(1)}%` : ""}`),
    `同期的日記（含當天技術面）：`, ...L.map(e => `${e.d} ${e.side === "buy" ? "買" : "賣"} ${nameOf(e.code)} ${e.code} @${e.px} 分類:${(e.tags || []).join("/") || "無"} 理由:${e.reason || "無"}${e.snap ? ` 當天K${e.snap.kd[0]}/D${e.snap.kd[1]} RSI${e.snap.rsi} ${e.snap.macd} ${e.snap.ma}` : ""}`)].join("\n");
  try { W.jAI = { text: await aiChat(txt, "請只根據上面的交易紀錄分析：1) 反覆出現的錯誤（例如追高、指標過熱時買、停損太慢、虧損時加碼）2) 錯過的機會（賣出後又大漲、太早停利）3) 可能影響決策的行為偏誤（例如處分效應、過度自信、近因偏誤），每點都要指出是哪幾筆。最後一段用「【規則】」開頭，列出 3 條可以立刻執行、具體到數字的個人交易規則（例如「RSI 超過 75 不追買」「單筆虧損 7% 一定停損」），每條一行、用 1. 2. 3. 編號。用繁體中文，不要給個股買賣建議。") }; }
  catch (e) { W.jAI = { err: e.message }; }
  if (W.lt === "tools") renderList();
}
// 從 AI 回覆抓出「【規則】」後面編號的 3 條
const jRulesOf = t => { const m = String(t || "").split("【規則】")[1]; return m ? m.split("\n").map(x => x.replace(/^\s*(\d+[.、)）]|[-•＊*])\s*/, "").replace(/\*\*/g, "").trim()).filter(x => x.length >= 4).slice(0, 3) : []; };
const jRulesHtml = (edit = true) => { const R = JRULES(); return R.length || edit ? `<div class="jrules"><b>我的交易規則</b>${R.length ? `<ol>${R.map((r, i) => `<li>${esc(r.t)}${edit ? ` <button class="linkbtn" data-jrdel="${i}">刪除</button>` : ""}</li>`).join("")}</ol>` : `<p class="note">還沒有規則。按「AI 檢討」產生，或自己寫一條。</p>`}${edit ? `<form class="irform" id="jrForm"><input id="jrIn" placeholder="例如：單筆虧損 7% 一定停損" style="flex:1;min-width:180px"><button class="btn sm">＋ 加規則</button></form>` : ""}</div>` : ""; };
async function jBH() {
  for (const el of document.querySelectorAll("#lx [data-jbh]")) { const [c, a, b] = el.dataset.jbh.split("|"), D = await dailyFresh(c); if (!D?.length) continue;
    const p = d => { let x = null; for (const k of D) { if (String(k.d).slice(0, 10) <= d) x = k.c; else break; } return x; }, pa = p(a), pb = p(b); if (pa && pb && el.isConnected) { el.textContent = ((pb / pa - 1) * 100).toFixed(2) + "%"; el.className = cls(pb - pa); } }
}
const retPct = v => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
function toolsClick(e) {
  if (!toolsOn()) return; const b = e.target.closest("[data-tv],[data-tx],[data-tsel],[data-irdel],[data-paside],[data-paodel],[data-paldel],[data-jdel],[data-jrdel],[data-sy],[data-mm],[data-scadd],[data-scdel],[data-scrun],[data-rsk],[data-rsrun],[data-rsu],[data-mfu],[data-mfrun],[data-mfbt],[data-insf],[data-insbt]" + (W.lt === "cong" ? "" : ",[data-rkset]")); if (!b) return; const d = b.dataset;
  if (d.rkset != null) { const [k, v] = d.rkset.split(/:(.*)/s); W[k] = v; store.set("watch:" + k, v); return renderList(); }
  if (b.hasAttribute("data-scadd")) { SC().rules.push({ k: "above" }); scSave(); return renderList(); }
  if (d.scdel != null) { SC().rules.splice(+d.scdel, 1); scSave(); return renderList(); }
  if (b.hasAttribute("data-scrun")) return scRun();
  if (d.rsk) { W.rsK = d.rsk; return renderList(); }
  if (d.rsu != null) { W.rsU = d.rsu; W.rsRes = null; return renderList(); }
  if (d.sy) return syncClick(d);
  if (b.hasAttribute("data-insbt")) return insBtRun();
  if (d.insf) { W.insF = d.insf; W.insQ = ""; return renderList(); }
  if (b.hasAttribute("data-rsrun")) return rsRun();
  if (d.mfu != null) { MF().uni = d.mfu; store.set("watch:mfu", d.mfu); W.mfRes = W.mfBt = null; return renderList(); }
  if (b.hasAttribute("data-mfrun")) return mfRun();
  if (b.hasAttribute("data-mfbt")) return mfBacktest();
  if (d.tv && W.lt === "tools") { W.tv = d.tv; renderList(); navPush(); }
  else if (d.tsel) select(d.tsel);
  else if (d.tx === "sumre") { W.sum = null; W.dk = new Map(); renderList(); }
  else if (d.tx === "sumai") sumAI();
  else if (d.tx === "irnow") irCheck(true);
  else if (d.tx === "jai") jAI();
  else if (d.tx === "jrsave") { const L = jRulesOf(W.jAI?.text); W.jrules = [...L.map(t => ({ t, at: toolsDay() })), ...JRULES()].filter((x, i, a) => a.findIndex(y => y.t === x.t) === i).slice(0, 8); jrSave(); toast(`已存 ${L.length} 條規則，下單時會提醒`); renderList(); }
  else if (d.jrdel != null) { JRULES().splice(+d.jrdel, 1); jrSave(); renderList(); }
  else if (d.tx === "pareset") { if (confirm("重設模擬帳戶（清除持股、掛單與紀錄，回到台幣 100 萬＋美金 3 萬）？")) { W.paper = PAPER0(); paSave(); renderList(); } }
  else if (d.tx === "jexport") { const blob = new Blob([JSON.stringify(JR(), null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `交易日記-${toolsDay()}.json`; a.click(); }
  else if (d.irdel != null) { IR().splice(+d.irdel, 1); irSave(); renderList(); }
  else if (d.jdel) { W.journal = JR().filter(x => x.id !== d.jdel); jSave(); renderList(); }
  else if (d.mm) { W.multiMode = d.mm; renderList(); }
  else if (d.paside) { e.preventDefault(); const c = $("#paCode").value.trim().toUpperCase(), sh = Math.round(+$("#paSh").value), type = $("#paType").value, px = +$("#paPx").value;
    if (type !== "mkt") { if (!(px > 0)) return toast("請輸入掛單價"); if (!(sh > 0)) return toast("股數要大於 0"); if (isIdx(c) || (!isTW(c) && !isUS(c))) return toast("請輸入台股或美股代號"); PA().orders.push({ c, side: d.paside, sh, type, px, t: Date.now() }); paSave(); paStart(); toast(`已掛單：${type === "limit" ? "限價" : "停損／突破"} ${fmtP(px)}`); return renderList(); }
    const err = paperOrder(c, d.paside, sh); toast(err || `已${d.paside === "buy" ? "買進" : "賣出"} ${nameOf(c)} ${sh} 股`); if (!err) renderList(); }
  else if (d.paldel) { delete W.alerts[d.paldel]; store.set("watch:alerts", W.alerts); renderList(); if (typeof renderDetailHead === "function") renderDetailHead(); }
  else if (d.paodel != null) { PA().orders.splice(+d.paodel, 1); paSave(); renderList(); }
}
function toolsSubmit(e) {
  if (!toolsOn()) return; const f = e.target; e.preventDefault();
  if (f.id === "irForm") { const c = $("#irCode").value.trim().toUpperCase(), cond = $("#irCond").value, C = condOf(cond); if (!isTW(c) && !isUS(c)) return toast("請輸入代號"); IR().push({ code: c, cond, p: C?.[2] && $("#irP").value !== "" ? +$("#irP").value : C?.[3] ?? null, on: true }); irSave(); irStart(); renderList(); irCheck(); try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {} }
  else if (f.id === "jForm") { const c = $("#jCode").value.trim().toUpperCase(), px = +$("#jPx").value; if (!c || !(px > 0)) return toast("請輸入代號和價格"); jAdd({ d: $("#jD").value || toolsDay(), code: c, side: $("#jSide").value, px, sh: +$("#jSh").value || 0, reason: $("#jWhy").value.trim(), tags: [$("#jTag").value] }); }
  else if (f.id === "jrForm") { const t = $("#jrIn").value.trim(); if (t.length < 2) return toast("請輸入規則"); JRULES().unshift({ t, at: toolsDay() }); W.jrules = JRULES().slice(0, 8); jrSave(); renderList(); }
  else if (f.id === "mForm") { const L = [...f.querySelectorAll("[data-mc]")].map(x => x.value.trim().toUpperCase()).filter(Boolean).slice(0, 4); store.set("watch:multi", L); renderList(); }
}
function toolsChange(e) {
  if (!toolsOn()) return; const t = e.target, d = t.dataset;
  if (d.iron != null) { IR()[+d.iron].on = t.checked; irSave(); }
  else if (d.mfw) { MF().w[d.mfw] = +t.value; store.set("watch:mfw", MF().w); W.mfBt = null; renderList(); }
  else if (t.hasAttribute("data-syfile")) { if (t.files?.[0]) syncImport(t.files[0]); }
  else if (t.hasAttribute("data-syauto")) syncSet({ auto: t.checked });
  else if (d.scu != null) { SC().uni = t.value; scSave(); renderList(); }
  else if (d.scc != null) { SC().codes = t.value; scSave(); }
  else if (d.scr != null) { SC().rules[+d.scr] = { k: t.value }; scSave(); renderList(); }
  else if (d.twoq != null) { const q = t.value.trim(); if (q !== (W.twoQ || "")) { W.twoQ = q; setTimeout(renderList, 0); } }
  else if (d.insq != null) { const q = t.value.trim().toUpperCase(); if (q !== (W.insQ || "")) { W.insQ = q; setTimeout(renderList, 0); } } // 輸入框被移除時會再觸發一次 change，延後重畫避免巢狀重畫
  else if (d.scp != null) { SC().rules[+d.scp].p = t.value === "" ? null : +t.value; scSave(); }
}
// 多週期共振：日、週、月 K 的多空判讀放在一起，三個方向一致才算共振
function mtfHtml() {
  const base = W.daily?.data; if (!base || base.length < 120) return "";
  const per = [["日", base], ["週", agg(base, weekKey)], ["月", agg(base, d => d.slice(0, 7))]].map(([t, D]) => { if (!D || D.length < (t === "月" ? 18 : 30)) return [t, null]; const I = indicators(D), it = readout(D, I, D.length - 1), b = it.filter(x => x.b > 0).length, s = it.filter(x => x.b < 0).length, sc = it.length ? (b - s) / it.length : 0; return [t, sc > 0.1 ? 1 : sc < -0.1 ? -1 : 0]; });
  const ok = per.filter(x => x[1] != null), all = ok.length >= 2 && ok.every(x => x[1] === ok[0][1]) && ok[0][1] !== 0;
  return `<div class="mtf"><span class="note">多週期：</span>${per.map(([t, v]) => `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${t} ${v == null ? "資料不足" : v > 0 ? "偏多" : v < 0 ? "偏空" : "中性"}</span>`).join("・")} ${all ? `<b class="${ok[0][1] > 0 ? "up" : "down"}">→ ${ok.length} 個週期${ok[0][1] > 0 ? "偏多" : "偏空"}共振</b>` : `<span class="note">→ 方向不一致，還沒有共振</span>`}</div>`;
}

/* ---------- 國會：申報後超額報酬追蹤（申報公開的隔一個交易日收盤買進，持有 30／90 天，和 SPY 同期比） ---------- */
// 申報日當天的收盤前不一定看得到申報，所以用「申報日之後第一個交易日的收盤」進場，避免偷看；另外算「交易日進場」當對照（現實中做不到）
const CBT_H = [[21, "30 天"], [63, "90 天"]];
async function congBtRun(all) {
  const C = W.cong; if (!C?.trades?.length) return;
  // 只算一般股票的買進：代號要像美股代號（排除債券、選擇權、基金等非標準代號），交易日、申報日要是有效日期
  const okDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d), buys = C.trades.filter(t => t && t.k === "buy" && t.assetType === "股票" && /^[A-Z][A-Z.]{0,6}$/.test(t.ticker || "") && okDate(t.traded) && okDate(t.filed));
  const cnt = buys.reduce((m, t) => m.set(t.ticker, (m.get(t.ticker) || 0) + 1), new Map()), tick = [...cnt].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, all ? 250 : 60);
  const R = (W.cbt = { busy: true, done: 0, total: tick.length + 1, all }); renderList();
  const load = async T => { if (!Array.isArray(W.congK[T])) { try { const j = await getJ(`/api/kline?code=${encodeURIComponent(T)}&months=24`); W.congK[T] = j.data || []; } catch (e) { W.congK[T] = { err: e.message }; } } R.done++; if (R.done % 5 === 0 && W.lt === "cong" && W.cv === "bt") renderList(); };
  await load("SPY"); let k = 0; await Promise.all(Array.from({ length: 5 }, async () => { while (k < tick.length) await load(tick[k++]); }));
  const S = Array.isArray(W.congK.SPY) ? W.congK.SPY : [], sIdx = new Map(S.map((x, i) => [String(x?.d ?? "").slice(0, 10), i])), set = new Set(tick);
  // 同一檔在交易日前後 30 天內有幾個不同的人買 → 多人共同 vs 單一人物
  const crowd = t => new Set(buys.filter(x => x.ticker === t.ticker && Math.abs(Date.parse(x.traded) - Date.parse(t.traded)) <= 30 * 864e5).map(x => x.pid)).size;
  // 查不到 K 線、K 線太短、申報日之後還沒有交易日的筆數記成 N/A（跳過，不影響其他筆）
  R.na = { noK: 0, noDay: 0 };
  const px = (A, i) => { const c = A?.[i]?.c; return typeof c === "number" && c > 0 ? c : null; }, rr = (a, b) => (a && b ? b / a - 1 : null);
  R.rows = buys.filter(t => set.has(t.ticker)).map(t => {
    const D = W.congK[t.ticker]; if (!Array.isArray(D) || D.length < 5) { R.na.noK++; return null; } const ds = D.map(x => String(x?.d ?? "").slice(0, 10));
    // K 線開始之後才發生的交易才算（早於第一根 K 線時 findIndex 會回 0，誤用第一天的價）
    const iF = ds[0] <= t.filed ? ds.findIndex(d => d > t.filed) : -1, iT = ds[0] <= t.traded ? ds.findIndex(d => d >= t.traded) : -1; if (iF < 0) { R.na.noDay++; return null; }
    const ret = (i, h) => (i >= 0 && i + h < D.length ? rr(px(D, i), px(D, i + h)) : null);
    const spy = (i, h) => { if (i < 0 || i + h >= D.length) return null; const a = sIdx.get(ds[i]), b = sIdx.get(ds[i + h]); return a != null && b != null ? rr(px(S, a), px(S, b)) : null; };
    const o = { t, crowd: crowd(t), big: (t.amount?.[0] || 0) >= 50001 };
    CBT_H.forEach(([h]) => { o["f" + h] = ret(iF, h); o["s" + h] = spy(iF, h); o["t" + h] = ret(iT, h); });
    // 到今天為止：議員本人（交易日收盤買）與申報後買進（申報後收盤買）的報酬，用金額區間的中間值估算賺賠多少美元
    const L = D.length - 1, last = px(D, L), a = sIdx.get(ds[iF]), mid = cplMid(t.amount);
    Object.assign(o, { pF: px(D, iF), pT: iT >= 0 ? px(D, iT) : null, last, lastD: ds[L], nF: rr(px(D, iF), last), nT: iT >= 0 ? rr(px(D, iT), last) : null, nS: a != null && S.length ? rr(px(S, a), px(S, S.length - 1)) : null, mid });
    o.pnl = mid != null && o.nT != null ? mid * o.nT : null; return o;
  }).filter(Boolean);
  R.skipped = tick.filter(T => !Array.isArray(W.congK[T]) || !W.congK[T].length); R.busy = false; R.at = Date.now(); if (W.lt === "cong") renderList();
}
// 申報金額是區間（例如 $1,001–$15,000）：用中間值估算；只有下限（「$5,000,000 以上」）就用下限
const cplMid = a => (Array.isArray(a) && a[0] > 0 ? (a[1] > a[0] ? (a[0] + a[1]) / 2 : a[0]) : null);
const usd0 = v => (v == null ? "—" : `${v < 0 ? "-" : v > 0 ? "+" : ""}${usd(Math.round(Math.abs(v)))}`);
// 誰買了什麼、賺賠多少：每一筆買進申報到今天的報酬、估計損益，依人物、股票彙總
function cplHtml(L) {
  const P = (W.cpl ||= { sort: "pnl", who: "", all: false }), ok = x => typeof x === "number" && Number.isFinite(x), sum = a => a.reduce((x, y) => x + y, 0);
  const grp = (key) => [...L.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) || []), x]), new Map())].map(([k, G]) => { const T = G.filter(x => ok(x.nT)), F = G.filter(x => ok(x.nF)), V = G.filter(x => ok(x.pnl));
    return { k, G, n: G.length, inv: sum(V.map(x => x.mid)), pnl: sum(V.map(x => x.pnl)), rT: T.length ? sum(T.map(x => x.nT)) / T.length : null, rF: F.length ? sum(F.map(x => x.nF)) / F.length : null, win: T.length ? T.filter(x => x.nT > 0).length / T.length : null, who: new Set(G.map(x => x.t.pid)).size }; });
  const ord = { pnl: (a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity), loss: (a, b) => (a.pnl ?? Infinity) - (b.pnl ?? Infinity), ret: (a, b) => (b.rT ?? -9) - (a.rT ?? -9), n: (a, b) => b.n - a.n };
  const seg = [["pnl", "最賺"], ["loss", "最賠"], ["ret", "報酬率"], ["n", "筆數"]].map(([k, t]) => `<button class="btn sm ${P.sort === k ? "primary" : ""}" data-cpl="sort:${k}">${t}</button>`).join(" ");
  const ppl = grp(x => x.t.pid).sort(ord[P.sort]), stk = grp(x => x.t.ticker).sort(ord[P.sort]);
  const tot = grp(() => "all")[0];
  const rows = L.filter(x => !P.who || x.t.pid === P.who).sort({ pnl: (a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity), loss: (a, b) => (a.pnl ?? Infinity) - (b.pnl ?? Infinity), ret: (a, b) => (b.nT ?? -9) - (a.nT ?? -9), n: (a, b) => b.t.traded.localeCompare(a.t.traded) }[P.sort]), shown = P.all ? rows : rows.slice(0, 40);
  let h = `<p class="note">每一筆股票買進，從<strong>議員交易日的收盤價</strong>算到最新收盤（${esc(L.map(x => x.lastD).sort().pop() || "—")}）；損益用申報區間中間值 × 報酬率估算，之後有沒有賣掉看不出來，一律當作還抱著。「申報後買進」是申報公開後才買的報酬。</p>
    ${rkCards([{ t: "估計投入", sub: `${tot?.n || 0} 筆・${new Set(L.map(x => x.t.pid)).size} 人`, v: usd(Math.round(tot?.inv || 0)) }, { t: "估計損益", sub: `平均 ${retPct(tot?.rT)}・賺錢 ${tot?.win != null ? Math.round(tot.win * 100) + "%" : "—"}`, v: usd0(tot?.pnl), vc: cls(tot?.pnl) }, { t: "申報後買進（申報後買）", sub: `同期 SPY ${retPct((() => { const v = L.map(x => x.nS).filter(ok); return v.length ? sum(v) / v.length : null; })())}`, v: retPct(tot?.rF), vc: cls(tot?.rF) }])}
    <div class="mksegrow">${seg}</div>
    <h4>依人物</h4>${rkList(ppl.slice(0, 20).map(g => { const p = W.cong.people?.[g.k] || {}; return { attr: `data-cpl="who:${esc(g.k)}"`, mono: rkMono(rkInit(pName(g.k)), RK_C[p.chamber] || RK_C.眾議院), name: esc(pName(g.k)) + (P.who === g.k ? ' <span class="tw-tp">篩選中</span>' : ""), sub: `${esc(p.chamber || "")}・${g.n} 筆・投入 ${usd(Math.round(g.inv))}・賺錢 ${g.win != null ? Math.round(g.win * 100) + "%" : "—"}`, val: usd0(g.pnl), vc: cls(g.pnl), vsub: `平均 ${retPct(g.rT)}・申報後買進 ${retPct(g.rF)}` }; }))}
    <h4>依股票</h4>${rkList(stk.slice(0, 15).map(g => ({ attr: `data-copen="${esc(g.k)}"`, mono: rkMono(rkInit(g.k), cls(g.pnl) === "down" ? "#d0643f" : "#3fa36b"), name: esc(g.k), sub: `${g.who} 人買・${g.n} 筆・投入 ${usd(Math.round(g.inv))}`, val: usd0(g.pnl), vc: cls(g.pnl), vsub: `平均 ${retPct(g.rT)}・申報後買進 ${retPct(g.rF)}` })))}
    <h4>每一筆交易${P.who ? `：${esc(pName(P.who))} <button class="linkbtn" data-cpl="who:">看全部人</button>` : ""}</h4>
    ${rkList(shown.map(x => ({ no: x.t.traded.slice(5).replace("-", "/"), attr: `data-copen="${esc(x.t.ticker)}"`, mono: rkMono(rkInit(x.t.ticker), cls(x.nT) === "down" ? "#d0643f" : "#3fa36b"), name: `${esc(pName(x.t.pid))} 買 ${esc(x.t.ticker)}`, sub: `${x.t.filed} 申報・${x.t.amount ? `${usd(x.t.amount[0])}${x.t.amount[1] ? "–" + usd(x.t.amount[1]) : " 以上"}` : "—"}・${x.pT != null ? x.pT.toFixed(2) : "—"} → ${x.last != null ? x.last.toFixed(2) : "—"}`, val: usd0(x.pnl), vc: cls(x.pnl), vsub: `${retPct(x.nT)}・申報後買進 ${retPct(x.nF)}` })))}
    ${rows.length > 40 ? `<button class="btn sm" data-cpl="all:1">${P.all ? "只看前 40 筆" : `顯示全部 ${rows.length} 筆`}</button>` : ""}`;
  return h;
}
function cbtStat(L, h, key = "f") {
  const ok = x => typeof x === "number" && Number.isFinite(x), v = L.map(x => x[key + h]).filter(ok), ex = L.filter(x => ok(x[key + h]) && ok(x["s" + h])).map(x => x[key + h] - x["s" + h]); if (!v.length) return null;
  const srt = [...v].sort((a, b) => a - b);
  return { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, med: srt[srt.length >> 1], win: v.filter(x => x > 0).length / v.length, ex: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null, beat: ex.length ? ex.filter(x => x > 0).length / ex.length : null };
}
// 申報後買進回測：一句話結論＋流程圖＋分組長條（申報後買進 vs 同期 SPY），30／90 天可切換；第一次打開自動開始算
function cbtBar(label, s, sub, attr) {
  if (!s) return `<li class="cbt-row"><div class="cbt-l"><b>${label}</b><small class="note">${sub || ""}還不到持有天數</small></div></li>`;
  const spy = s.ex != null ? s.avg - s.ex : null, mx = Math.max(0.02, Math.abs(s.avg), Math.abs(spy || 0)), w = v => `${Math.min(100, (Math.abs(v) / mx) * 100).toFixed(0)}%`;
  return `<li class="cbt-row"${attr ? ` ${attr} role="button" tabindex="0"` : ""}><div class="cbt-l"><b>${label}</b><small class="note">${sub || ""}${s.n} 筆・賺錢 ${Math.round(s.win * 100)}%・贏 SPY ${s.beat != null ? Math.round(s.beat * 100) + "%" : "—"}</small></div>
    <div class="cbt-bars"><span><em>申報後買進</em><i class="${s.avg >= 0 ? "pos" : "neg"}" style="width:${w(s.avg)}"></i><b class="${cls(s.avg)}">${retPct(s.avg)}</b></span><span><em>SPY</em><i class="spy" style="width:${spy == null ? 0 : w(spy)}"></i><b>${retPct(spy)}</b></span></div></li>`;
}
function congBtHtml() {
  const R = W.cbt, H = W.cbtH === 63 ? 63 : 21, HT = H === 63 ? "90 天" : "30 天";
  if (!R && W.cong?.trades?.length && !W.cbtAuto) { W.cbtAuto = true; setTimeout(() => congBtRun(false), 0); }
  const run = `<button class="btn sm" data-cbt="60" ${R?.busy ? "disabled" : ""}>${R?.busy ? `載入股價 ${R.done}/${R.total}…` : "重新計算"}</button><button class="btn sm" data-cbt="all" ${R?.busy ? "disabled" : ""}>全部股票（較慢）</button>`;
  const lag = (() => { const L = (W.cong?.trades || []).filter(t => t.k === "buy").map(t => congDays(t.traded, t.filed)).filter(x => x >= 0).sort((a, b) => a - b); return L.length ? L[L.length >> 1] : null; })();
  let h = `<section class="csec tw-home">${rkHead("申報後超額報酬追蹤", "看到議員「申報買進」之後才跟著買，賺得到嗎？")}
    <ol class="cbt-flow"><li><b>議員交易</b><small>實際買進日</small></li><li><b>申報公開</b><small>${lag != null ? `中位數晚 ${lag} 天` : "最晚 45 天"}</small></li><li><b>申報後買進</b><small>公開後隔天收盤</small></li><li><b>持有 ${HT}</b><small>和同期 SPY 比</small></li></ol>
    <div class="tw-ctl">${rkSeg("data-rkset", "cbtH:" + H, [["cbtH:21", "持有 30 天"], ["cbtH:63", "持有 90 天"]])}${run}</div>`;
  if (!R?.rows) return h + `<p class="note">${R?.busy ? `正在載入股價（${R.done}/${R.total}）…算完會自動顯示。` : "準備計算…"}</p></section>`;
  const L = R.rows, a = cbtStat(L, H), t = cbtStat(L, H, "t"), view = ["grp", "ppl", "pnl"].includes(W.cbtv) ? W.cbtv : "grp", spyA = a && a.ex != null ? a.avg - a.ex : null;
  h += `<div class="cbt-head">${a ? `<p>過去 <b>${a.n}</b> 筆買進申報，如果每次都在公開後買進、持有 ${HT}：平均 <b class="${cls(a.avg)}">${retPct(a.avg)}</b>，同期 SPY <b>${retPct(spyA)}</b>；<b>${Math.round(a.win * 100)}%</b> 的交易賺錢，<b>${a.beat != null ? Math.round(a.beat * 100) : "—"}%</b> 贏過 SPY。</p>
      <p class="note">${a.ex != null ? (a.ex >= 0 ? `申報後買進平均多賺 SPY ${retPct(a.ex)}。` : `申報後買進平均輸 SPY ${retPct(Math.abs(a.ex)).replace("+", "")}，不如直接買大盤。`) : ""}如果能在議員交易當天就買（現實中做不到），平均 ${retPct(t?.avg)}——差距就是申報延遲吃掉的報酬。</p>` : `<p class="note">還沒有筆數到達持有 ${HT}。</p>`}</div>
    <div class="tw-ctl">${rkSeg("data-rkset", "cbtv:" + view, [["cbtv:grp", "哪一種申報比較好跟"], ["cbtv:ppl", "跟誰比較準"], ["cbtv:pnl", "誰賺最多"]])}</div>`;
  if (view === "grp") h += `<ul class="cbt-list">${cbtBar("全部買進申報", a)}${cbtBar("多人共同買進", cbtStat(L.filter(x => x.crowd >= 2), H), "前後 30 天 ≥ 2 人買・")}${cbtBar("單一人物", cbtStat(L.filter(x => x.crowd < 2), H))}${cbtBar("大額（下限 ≥ $50K）", cbtStat(L.filter(x => x.big), H))}${cbtBar("小額（$50K 以下）", cbtStat(L.filter(x => !x.big), H))}${cbtBar("眾議院", cbtStat(L.filter(x => W.cong.people?.[x.t.pid]?.chamber !== "參議院"), H))}${cbtBar("參議院", cbtStat(L.filter(x => W.cong.people?.[x.t.pid]?.chamber === "參議院"), H))}</ul>`;
  else if (view === "ppl") { const per = [...L.reduce((m, x) => m.set(x.t.pid, [...(m.get(x.t.pid) || []), x]), new Map())].map(([pid, G]) => ({ pid, G, s: cbtStat(G, H) })).filter(x => x.s && x.s.n >= 3).sort((a, b) => (b.s.ex ?? -9) - (a.s.ex ?? -9));
    h += `<p class="note">至少 3 筆、依「申報後買進 ${HT}贏 SPY 多少」排序；點人物看他的交易。</p><ul class="cbt-list">${per.slice(0, 30).map(x => cbtBar(esc(pName(x.pid)), x.s, `${esc(W.cong.people?.[x.pid]?.chamber || "")}・`, `data-cv="person:${esc(x.pid)}"`)).join("") || `<li class="note">還沒有人有 3 筆以上可算</li>`}</ul>`; }
  else h += cplHtml(L);
  h += `<p class="note">樣本：${L.length} 筆、${new Set(L.map(x => x.t.ticker)).size} 檔股票（資料從 ${L.map(x => x.t.filed).sort()[0] || "—"} 開始，時間還短、樣本小，結果容易被少數幾檔左右）。${R.skipped?.length ? `拿不到股價而略過：${R.skipped.slice(0, 12).map(esc).join("、")}${R.skipped.length > 12 ? ` 等 ${R.skipped.length} 檔` : ""}。` : ""}${R.na && (R.na.noK || R.na.noDay) ? `N/A（跳過）：查無 K 線 ${R.na.noK} 筆、申報後還沒有交易日 ${R.na.noDay} 筆。` : ""}沒算手續費、匯率與稅；過去的結果不代表未來。</p></section>`;
  return h;
}

/* ---------- 13F 機構持股 ---------- */
async function f13Load() { if (W.f13) return W.f13; try { const r = await fetch("data/f13.json", { cache: "no-cache" }); if (!r.ok) throw new Error(r.status === 404 ? "排程還沒跑完第一次" : `HTTP ${r.status}`); W.f13 = await r.json(); } catch (e) { W.f13 = { err: e.message, funds: [] }; } if (W.lt === "cong") renderList(); return W.f13; }
const F13_CHG = { new: ["新進", "up"], add: ["加碼", "up"], cut: ["減碼", "down"], sold: ["出清", "down"], same: ["持平", ""] };
const f13Tag = c => `<span class="ctag ${c === "new" || c === "add" ? "many" : c === "same" ? "" : "one"}">${F13_CHG[c]?.[0] || c}</span>`;
const f13Tk = r => (r.ticker ? `<button class="linkbtn ctk" data-copen="${esc(r.ticker)}">${esc(r.ticker)}</button>` : "") + `<div class="note cas">${esc(r.name)}${r.pc ? `（${r.pc === "PUT" ? "賣權" : "買權"}）` : ""}</div>`;
/* ---------- 13F 績效：用申報的持股（市值加權）算報酬，和 SPY 同期比 ----------
   上一季：上一季底的持股（股數）放到這一季底的報酬（季中買賣看不到，所以是「持股不動」的估計）。
   這一季：這一季底的持股放到今天。影子組合：申報公開後第一個交易日收盤買進到今天。 */
const usK = async T => { const K = (W.congK ||= {}); if (K[T] != null) return K[T]; try { const j = await getJ(`/api/kline?code=${encodeURIComponent(T.replace(/\./g, "-"))}&months=24`); K[T] = j.data || []; } catch (e) { K[T] = { err: e.message }; } return K[T]; };
const kOn = (D, d) => { if (!Array.isArray(D) || !D.length || String(D[0].d).slice(0, 10) > d) return null; let x = null; for (const b of D) { if (String(b.d).slice(0, 10) <= d) x = b; else break; } return x?.c > 0 ? x.c : null; };
const kAfter = (D, d) => { if (!Array.isArray(D) || !D.length || String(D[0].d).slice(0, 10) > d) return null; const b = D.find(x => String(x.d).slice(0, 10) > d); return b?.c > 0 ? b.c : null; };
const kLast = D => (Array.isArray(D) && D.length ? D[D.length - 1].c : null);
const f13Tks = f => [...new Set([...f.rows.filter(r => r.ticker && !r.pc).sort((a, b) => b.value - a.value).slice(0, 25), ...[...f.rows, ...f.sold].filter(r => r.ticker && !r.pc && r.psh > 0)].map(r => r.ticker))].slice(0, 45);
async function f13PerfRun(funds) {
  const T = [...new Set(["SPY", ...funds.flatMap(f13Tks)])].filter(t => W.congK?.[t] == null), R = (W.f13P = { busy: true, done: 0, total: T.length }); if (W.lt === "cong") renderList();
  let k = 0; await Promise.all(Array.from({ length: 5 }, async () => { while (k < T.length) { await usK(T[k++]); R.done++; if (R.done % 8 === 0 && W.lt === "cong") renderList(); } }));
  R.busy = false; R.at = Date.now(); if (W.lt === "cong") renderList();
}
function f13Perf(f) {
  const K = W.congK || {}, S = K.SPY, cur = f.rows.filter(r => r.ticker && !r.pc), w = (L, v) => { const ok = L.filter(x => x.r != null); const t = ok.reduce((a, x) => a + x[v], 0); return t ? { r: ok.reduce((a, x) => a + x[v] * x.r, 0) / t, cov: t } : null; };
  const now = cur.map(r => { const D = K[r.ticker], p0 = kOn(D, f.period), p1 = kLast(D), pf = kAfter(D, f.filed); return { ...r, p0, p1, pf, r: p0 && p1 ? p1 / p0 - 1 : null, rf: pf && p1 ? p1 / pf - 1 : null }; });
  const prevL = [...f.rows, ...f.sold].filter(r => r.ticker && !r.pc && r.psh > 0).map(r => { const D = K[r.ticker], a = kOn(D, f.prevPeriod), b = kOn(D, f.period); return { ...r, v0: a ? r.psh * a : 0, r: a && b ? b / a - 1 : null }; });
  const q = w(now, "value"), fo = w(now.map(x => ({ ...x, r: x.rf })), "value"), pv = f.prevPeriod ? w(prevL, "v0") : null;
  const sp = (a, b) => { const x = a && kOn(S, a), y = b ? kOn(S, b) : kLast(S); return x && y ? y / x - 1 : null; }, spF = (() => { const x = kAfter(S, f.filed), y = kLast(S); return x && y ? y / x - 1 : null; })();
  return { now, q, fo, pv, sQ: sp(f.period), sF: spF, sP: f.prevPeriod ? sp(f.prevPeriod, f.period) : null, cov: q ? q.cov / f.total : 0, last: Array.isArray(S) && S.length ? String(S[S.length - 1].d).slice(0, 10) : "" };
}
const f13Cell = (r, s) => `<td class="${cls(r)}"><b>${retPct(r)}</b>${s != null && r != null ? `<div class="note ${cls(r - s)}">${r - s >= 0 ? "贏" : "輸"} SPY ${retPct(Math.abs(r - s)).replace("+", "")}</div>` : ""}</td>`;
function f13PerfHtml(f) {
  const ready = [...f13Tks(f), "SPY"].every(t => W.congK?.[t] != null); // 抓不到的股票（{ err }）也算載入完成，不會一直重抓
  if (!ready) { if (!W.f13P?.busy) setTimeout(() => f13PerfRun([f]), 0); return `<h4>績效</h4><p class="note">載入股價 ${W.f13P?.done || 0}/${W.f13P?.total || "…"}</p>`; }
  const P = f13Perf(f);
  return `<h4>績效（和 SPY 同期比）</h4><div class="cokv three">
    <div><span>上一季持股的季度報酬</span><b class="${cls(P.pv?.r)}">${retPct(P.pv?.r)}</b><small>${f.prevPeriod || "—"} → ${f.period}・SPY ${retPct(P.sP)}</small></div>
    <div><span>本季持股到今天</span><b class="${cls(P.q?.r)}">${retPct(P.q?.r)}</b><small>${f.period} → ${P.last}・SPY ${retPct(P.sQ)}</small></div>
    <div><span>影子組合（申報後買進）到今天</span><b class="${cls(P.fo?.r)}">${retPct(P.fo?.r)}</b><small>${f.filed} 申報後買進・SPY ${retPct(P.sF)}</small></div></div>
    <div class="ctbl"><table><thead><tr><th>股票</th><th>占比</th><th>季底價 → 最新</th><th>報酬</th><th>貢獻</th></tr></thead><tbody>
    ${P.now.filter(x => x.r != null).sort((a, b) => b.value - a.value).slice(0, 25).map(x => `<tr><td>${f13Tk(x)}</td><td>${x.pct}%</td><td>${x.p0.toFixed(2)} → ${x.p1.toFixed(2)}</td><td class="${cls(x.r)}">${retPct(x.r)}</td><td class="${cls(x.r)}">${retPct((x.pct / 100) * x.r)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">市值加權、只算有股價的前 25 大持股（約占申報市值 ${Math.round(P.cov * 100)}%），不含選擇權。13F 只看得到季底持股：季中的買賣、放空、現金都不在裡面，所以是「持股不動」的估計，不是基金真正的績效；沒算股利與費用。</p>`;
}
function f13RankHtml(F) {
  const R = W.f13P, all = ["SPY", ...F.funds.flatMap(f13Tks)].every(t => W.congK?.[t] != null);
  const run = `<button class="btn sm primary" data-f13p="1" ${R?.busy ? "disabled" : ""}>${R?.busy ? `載入股價 ${R.done}/${R.total}…` : all ? "重新整理" : "計算全部機構的績效"}</button>`;
  if (!all || R?.busy) return `<h4>機構績效排行 ${run}</h4><p class="note">用每家機構申報的持股計算季度報酬與影子組合報酬，和 SPY 比（要載入約 ${new Set(F.funds.flatMap(f13Tks)).size} 檔股價）。</p>`;
  const L = F.funds.map(f => ({ f, P: f13Perf(f) })), k = W.f13Sort || "pv", v = o => (k === "pv" ? o.P.pv?.r : k === "q" ? o.P.q?.r : o.P.fo?.r) ?? -9;
  const seg = [["pv", "上一季"], ["q", "本季到今天"], ["fo", "影子組合到今天"]].map(([x, t]) => `<button class="btn sm ${k === x ? "primary" : ""}" data-f13s="${x}">${t}</button>`).join(" ");
  const sp = o => (k === "pv" ? o.P.sP : k === "q" ? o.P.sQ : o.P.sF);
  return `<h4>機構績效排行 ${run}</h4><div class="mksegrow">${seg}</div>${rkList(L.sort((a, b) => v(b) - v(a)).map(o => { const r = v(o) === -9 ? null : v(o), x = sp(o); return { attr: `data-cv="f13:${o.f.cik}"`, mono: rkMono(rkInit(o.f.who), RK_C.機構), name: esc(o.f.who), sub: `${o.f.period} 季底・${o.f.n} 檔`, val: retPct(r), vc: cls(r), vsub: x != null && r != null ? `<span class="${cls(r - x)}">${r - x >= 0 ? "贏" : "輸"} SPY ${retPct(Math.abs(r - x)).replace("+", "")}</span>` : `SPY ${retPct(x)}` }; }))}
    <p class="note">市值加權的持股報酬（持股不動的估計），和 SPY 同期比；季中買賣、放空、現金都看不到。</p>`;
}
function f13Html(arg) {
  const F = W.f13; if (!F) { f13Load(); return `<p class="note" style="padding:16px">載入中…</p>`; }
  if (F.err || !F.funds?.length) return `<p class="note" style="padding:16px">⚠ 13F 資料還沒有（${esc(F.err || "沒有資料")}）。資料由每天的排程從 SEC EDGAR 整理。</p>`;
  const sh = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : n), tk = r => esc(r.ticker || r.name), nm = r => `${esc(r.name)}${r.pc ? `（${r.pc === "PUT" ? "賣權" : "買權"}）` : ""}`;
  if (arg) {
    const f = F.funds.find(x => x.cik === arg); if (!f) return `<p class="note">找不到這家機構</p>`;
    // 歷史季度（data/f13-hist.json，排程每季累積）：選過去的季度就看那一季的持股與和前一季的差別
    if (W.f13H === undefined) { W.f13H = null; fetch("data/f13-hist.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(j => { W.f13H = j || {}; if (W.lt === "cong") renderList(); }); }
    const HP = W.f13H?.[f.cik]?.periods || [], qs = [...new Set([f.period, ...HP.map(p => p.period)])].sort().reverse(), qsel = qs.includes(W.f13Q) && W.f13Q !== f.period ? W.f13Q : null;
    const qbar = qs.length > 1 ? `<div class="mn-days mkseg">${qs.map(q => `<button type="button" data-rkset="f13Q:${q === f.period ? "" : q}" aria-pressed="${(qsel || f.period) === q}">${q.slice(0, 7).replace("-", "/")}${q === f.period ? "（最新）" : ""}</button>`).join("")}</div>` : `<p class="note">過去季度的持股由排程每天往前補（每次每家 2 季），之後就能在這裡切換季度。</p>`;
    if (qsel) { const i = HP.findIndex(p => p.period === qsel), P = HP[i], Q = HP[i + 1], key = r => r.cusip || r.name, prevM = new Map((Q?.rows || []).map(r => [key(r), r]));
      const rows = P.rows.map(r => { const o = prevM.get(key(r)), d = o ? r.sh / o.sh - 1 : null; return { ...r, chg: !Q ? "same" : !o ? "new" : d > 0.02 ? "add" : d < -0.02 ? "cut" : "same", psh: o?.sh || 0 }; }), out = Q ? Q.rows.filter(r => !P.rows.some(x => key(x) === key(r))) : [];
      return `<section class="csec tw-p">${rkPerson("", esc(f.who), `${esc(f.name)}　持股日期 ${qsel.replace(/-/g, "/")}（${String(P.filed || "").replace(/-/g, "/")} 申報）`)}${qbar}
        ${rkTotal(`${qsel.slice(0, 7).replace("-", "/")} 季底申報市值`, usd(P.total), `${P.n} 檔（這裡列前 40 大）${Q ? `・和 ${Q.period.slice(0, 7).replace("-", "/")} 比` : ""}`)}
        ${rkTop(rows.slice(0, 10).map(r => ({ label: r.ticker ? `<button class="linkbtn ctk" data-copen="${esc(r.ticker)}">${esc(r.ticker)}</button>` : esc(r.name), tag: Q ? F13_CHG[r.chg]?.[0] : "", sub: esc(r.name), pct: r.pct, val: usd(r.value), right: sh(r.sh) + " 股" })))}
        ${Q ? `<h4>這一季的變動（前 40 大持股範圍內）</h4>${rkList([...rows.filter(r => r.chg !== "same"), ...out.map(r => ({ ...r, chg: "sold", psh: r.sh, sh: 0 }))].map(r => ({ no: F13_CHG[r.chg]?.[0], attr: r.ticker ? `data-copen="${esc(r.ticker)}"` : "", mono: "", name: esc(r.ticker || r.name), sub: esc(r.name), val: r.chg === "sold" ? "0 股" : sh(r.sh) + " 股", vc: r.chg === "new" || r.chg === "add" ? "up" : "down", vsub: `上一季 ${sh(r.psh)}` })), "這一季前 40 大持股沒有變動")}` : ""}
        <p class="note">歷史季度只保留每季前 40 大持股，變動只比較這個範圍；最新一季的完整持股請切回「最新」。</p></section>`; }
    const tab = ["hold", "chg", "perf"].includes(W.f13Tab) ? W.f13Tab : "hold", top = f.rows.slice().sort((a, b) => b.value - a.value), shown = W.rkMore ? top : top.slice(0, 5), rest = top.slice(5), restV = rest.reduce((a, x) => a + x.value, 0);
    const chg = [...f.rows.filter(r => r.chg !== "same"), ...f.sold], cn = k => (k === "sold" ? f.sold.length : f.rows.filter(r => r.chg === k).length);
    return `<section class="csec tw-p">${rkPerson(rkMono(rkInit(f.who), RK_C.機構, true), esc(f.who), `${esc(f.name)}　持股日期 ${f.period.replace(/-/g, "/")}（${f.filed.replace(/-/g, "/")} 申報）`)}
      ${qbar}<p class="tw-lead">${esc(f.who)}在 ${f.period.replace(/-/g, "/")} 季底申報 ${f.n} 檔美股多頭部位，市值約 ${usd(f.total)}${top[0] ? `，最大持股是 ${tk(top[0])}（${top[0].pct}%）` : ""}；和上一季相比新進 ${cn("new")} 檔、加碼 ${cn("add")} 檔、減碼 ${cn("cut")} 檔、出清 ${cn("sold")} 檔。</p>
      ${rkTotal("申報市值（季底）", usd(f.total), `${f.n} 檔・<a href="${esc(f.doc)}" target="_blank" rel="noopener">SEC 原始申報</a>`)}
      ${rkTop(shown.map(r => ({ label: r.ticker ? `<button class="linkbtn ctk" data-copen="${esc(r.ticker)}">${esc(r.ticker)}</button>` : esc(r.name), tag: F13_CHG[r.chg]?.[0], sub: nm(r), pct: r.pct, val: usd(r.value), right: sh(r.sh) + " 股" })), rest.length ? `<li class="tw-rest"><div><b>${W.rkMore ? "收合" : `其他 ${rest.length} 檔`}</b>${W.rkMore ? "" : `<small class="note">${usd(restV)}・${f.total ? Math.round((restV / f.total) * 100) : 0}%</small>`}</div><button type="button" class="linkbtn" data-rkset="rkMore:${W.rkMore ? "" : "1"}">${W.rkMore ? "收合" : "展開"}</button></li>` : "")}
      <div class="tw-tabs seg" role="group">${[["hold", "持股"], ["chg", `本季變動 <span class="note">${chg.length}</span>`], ["perf", "機構影子組合回測"]].map(([k, t]) => `<button type="button" data-rkset="f13Tab:${k}" aria-pressed="${tab === k}">${t}</button>`).join("")}</div>
      ${tab === "hold" ? `<div class="ctbl tw-tbl"><table><thead><tr><th>股票</th><th>占比</th><th>市值</th><th>股數</th></tr></thead><tbody>${top.map(r => `<tr><td>${f13Tk(r)}</td><td class="num">${r.pct}%</td><td class="num">${usd(r.value)}</td><td class="num">${sh(r.sh)}</td></tr>`).join("")}</tbody></table></div>`
        : tab === "chg" ? rkList(chg.sort((a, b) => ["new", "add", "cut", "sold"].indexOf(a.chg) - ["new", "add", "cut", "sold"].indexOf(b.chg) || (b.value || 0) - (a.value || 0)).map(r => ({ no: F13_CHG[r.chg]?.[0], attr: r.ticker ? `data-copen="${esc(r.ticker)}"` : "", mono: rkMono(rkInit(r.ticker || r.name), r.chg === "new" || r.chg === "add" ? "#3fa36b" : "#d0643f"), name: tk(r), sub: nm(r), val: r.chg === "sold" ? "0 股" : sh(r.sh) + " 股", vc: r.chg === "new" || r.chg === "add" ? "up" : "down", vsub: `上一季 ${sh(r.psh)}${r.psh && r.chg !== "sold" ? `・${retPct(r.sh / r.psh - 1)}` : ""}` })), "本季沒有變動")
        : f13PerfHtml(f)}
      <p class="note">變動用股數比（±2% 以內算持平），不受股價漲跌影響。只列前 60 大與有變動的持股。</p></section>`;
  }
  // 首頁：機構排行（市值）、共同加碼、共同減碼、國會 × 13F、績效排行
  const agg = new Map(); for (const f of F.funds) for (const r of [...f.rows, ...f.sold]) { if (r.pc) continue; const k = r.ticker || r.cusip, g = agg.get(k) || agg.set(k, { r, up: [], dn: [], hold: 0 }).get(k); if (r.chg === "new" || r.chg === "add") g.up.push(f.who); else if (r.chg === "cut" || r.chg === "sold") g.dn.push(f.who); if (r.chg !== "sold") g.hold++; }
  const A = [...agg.values()], who = L => L.map(w => esc(w.split(" ")[0])).join("、"), view = ["funds", "up", "dn", "cong", "perf"].includes(W.f13v) ? W.f13v : "funds";
  const tot = F.funds.reduce((a, f) => a + f.total, 0), nNew = F.funds.reduce((a, f) => a + f.rows.filter(r => r.chg === "new").length, 0), nSold = F.funds.reduce((a, f) => a + f.sold.length, 0);
  let h = `<section class="csec tw-home">${rkHead("13F 機構持股", `管理資產 1 億美元以上的機構每季申報美股多頭持股，最晚季底後 45 天公開——看到的是<strong>上一季底</strong>的部位，現在可能已經不同；不含放空、現金與非美股。`)}
    ${rkCards([{ t: "追蹤機構", sub: "SEC Form 13F-HR", v: `${F.funds.length} 家` }, { t: "申報市值合計", sub: "季底", v: usd(tot) }, { t: "本季新進", sub: "各機構加總", v: `${nNew} 檔`, vc: "up" }, { t: "本季出清", sub: "各機構加總", v: `${nSold} 檔`, vc: "down" }])}
    <div class="tw-ctl">${rkSeg("data-rkset", "f13v:" + view, [["f13v:funds", "機構排行"], ["f13v:perf", "機構影子組合回測"], ["f13v:up", "共同加碼"], ["f13v:dn", "共同減碼"], ["f13v:cong", "國會 × 13F"]])}</div>`;
  if (view === "funds") h += `<button type="button" class="cbt-cta" data-rkset="f13v:perf"><b>13F 機構影子組合回測</b><small class="note">用每家機構申報的持股，算「季度持股報酬」和「申報公開後跟著買到今天」賺多少，和 SPY 比 ›</small></button>` + rkList(F.funds.slice().sort((a, b) => b.total - a.total).map(f => ({ attr: `data-cv="f13:${f.cik}"`, mono: rkMono(rkInit(f.who), RK_C.機構), name: esc(f.who), sub: `${f.rows.slice(0, 3).map(r => `${esc(r.ticker || r.name)} ${r.pct}%`).join("・")}`, val: usd(f.total), vsub: `${f.n} 檔・<span class="up">新進 ${f.rows.filter(r => r.chg === "new").length}</span>／<span class="down">出清 ${f.sold.length}</span>` })));
  else if (view === "up") h += `<h4>多家機構同時新進或加碼</h4>` + rkList(A.filter(g => g.up.length).sort((a, b) => b.up.length - a.up.length || a.dn.length - b.dn.length).slice(0, 30).map(g => ({ attr: g.r.ticker ? `data-copen="${esc(g.r.ticker)}"` : "", mono: rkMono(rkInit(g.r.ticker || g.r.name), "#3fa36b"), name: tk(g.r), sub: who(g.up), val: `${g.up.length} 家加碼`, vc: "up", vsub: `${g.dn.length ? `${g.dn.length} 家減碼・` : ""}${g.hold} 家持有` })));
  else if (view === "dn") h += `<h4>多家機構減碼或出清</h4>` + rkList(A.filter(g => g.dn.length).sort((a, b) => b.dn.length - a.dn.length).slice(0, 30).map(g => ({ attr: g.r.ticker ? `data-copen="${esc(g.r.ticker)}"` : "", mono: rkMono(rkInit(g.r.ticker || g.r.name), "#d0643f"), name: tk(g.r), sub: who(g.dn), val: `${g.dn.length} 家減碼`, vc: "down", vsub: `${g.up.length ? `${g.up.length} 家加碼・` : ""}${g.hold} 家持有` })));
  else if (view === "cong") h += f13CongHtml(A);
  else h += f13RankHtml(F);
  return h + `${(F.notes || []).length ? `<p class="note">⚠ ${F.notes.map(esc).join("；")}</p>` : ""}</section>`;
}
// 國會 × 13F：近 90 天議員買進的股票，對照機構本季是加碼還是減碼
function f13CongHtml(A) {
  if (!W.cong) { loadCong(); return `<h4>國會 × 13F</h4><p class="note">載入國會資料中…</p>`; }
  const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), buy = new Map();
  for (const t of W.cong.trades || []) if (t.k === "buy" && t.traded >= from && t.assetType === "股票") (buy.get(t.ticker) || buy.set(t.ticker, new Set()).get(t.ticker)).add(t.pid);
  const by = new Map(A.filter(g => g.r.ticker).map(g => [g.r.ticker, g])), same = [], opp = [];
  for (const [tk, P] of buy) { const g = by.get(tk); if (!g) continue; if (g.up.length) same.push({ tk, P, g }); if (g.dn.length && !g.up.length) opp.push({ tk, P, g }); }
  const tb = (L, t) => rkList(L.sort((a, b) => b.P.size + b.g.up.length - a.P.size - a.g.up.length).slice(0, 20).map(x => ({ attr: `data-cv="stock:${esc(x.tk)}"`, mono: rkMono(rkInit(x.tk), x.g.up.length ? "#3fa36b" : "#d0643f"), name: esc(x.tk), sub: esc(x.g.r.name), val: `${x.P.size} 位議員買進`, vc: "up", vsub: `機構 <span class="up">加碼 ${x.g.up.length}</span>／<span class="down">減碼 ${x.g.dn.length}</span>` })), t);
  return `<h4>議員在買、機構也在加碼</h4>${tb(same, "目前沒有兩邊同方向的股票")}<h4>方向相反：議員在買、機構在減碼</h4>${tb(opp, "沒有")}
    <p class="note">議員買進是近 90 天（依交易日）；機構動向是上一季 13F。兩者時間點不同，只能當作找研究題材的起點。</p>`;
}

/* ---------- 台股內部人持股轉讓事前申報 ---------- */
async function insLoad() { if (W.ins) return W.ins; try { const r = await fetch("data/insider.json", { cache: "no-cache" }); if (!r.ok) throw new Error(r.status === 404 ? "排程還沒跑完第一次" : `HTTP ${r.status}`); W.ins = await r.json(); } catch (e) { W.ins = { err: e.message, rows: [] }; } if (toolsOn() || W.dtab) renderList(); return W.ins; }
const insSh = n => (n == null ? "—" : `${Math.round(n / 1000).toLocaleString()} 張`);
// 申報後股價表現：只看「一般交易、盤後鉅額」這類在市場賣出的申報，申報日之後第一個交易日收盤起算 5、20 個交易日，和加權指數比
async function insBtRun() {
  const L = (W.ins?.rows || []).filter(r => /一般交易|盤後|鉅額|拍賣/.test(r.how)), codes = [...new Set(L.map(r => r.code))].slice(0, 80);
  const B = (W.insBt = { busy: true, done: 0, total: codes.length, rows: [] }); renderList(); const T = await dailyFresh("T00");
  const at = (D, d, h) => { if (!D?.length || String(D[0].d).slice(0, 10) > d) return null; const i = D.findIndex(x => String(x.d).slice(0, 10) > d); return i < 0 || i + h >= D.length ? null : D[i + h].c / D[i].c - 1; };
  for (const c of codes) { const D = await dailyFresh(c); B.done++; for (const r of L.filter(x => x.code === c)) { const o = { r }; [5, 20].forEach(h => { o["r" + h] = at(D, r.d, h); o["t" + h] = at(T, r.d, h); }); B.rows.push(o); } if (B.done % 5 === 0 && insVis()) renderList(); }
  B.busy = false; if (toolsOn()) renderList();
}
function insBtHtml() {
  const B = W.insBt; if (!B) return `<p class="note">董監大股東申報要在市場賣出之後，股價通常怎麼走？按「計算」用資料裡的申報算一次（只算一般交易、盤後鉅額這類市場賣出方式）。</p>`;
  const st = h => { const v = B.rows.filter(x => x["r" + h] != null), ex = v.filter(x => x["t" + h] != null).map(x => x["r" + h] - x["t" + h]); return v.length ? { n: v.length, avg: v.reduce((s, x) => s + x["r" + h], 0) / v.length, win: v.filter(x => x["r" + h] > 0).length / v.length, ex: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null } : null; };
  const s5 = st(5), s20 = st(20), cell = s => (s ? `<td>${s.n}</td><td class="${cls(s.avg)}">${retPct(s.avg)}</td><td>${Math.round(s.win * 100)}%</td><td class="${cls(s.ex)}">${retPct(s.ex)}</td>` : `<td colspan="4" class="note">還不到持有天數</td>`);
  return `<div class="ctbl"><table><thead><tr><th>期間</th><th>筆數</th><th>平均報酬</th><th>上漲比例</th><th>比大盤</th></tr></thead><tbody><tr><td>申報後 5 天</td>${cell(s5)}</tr><tr><td>申報後 20 天</td>${cell(s20)}</tr></tbody></table></div>
    <p class="note">資料從排程開始累積（最多約 3 年），樣本很少時結果不穩定；申報不等於已經賣出。</p>`;
}
function insHtml() {
  const I = W.ins; if (!I) { insLoad(); return `<p class="note">載入中…</p>`; }
  if (I.err || !I.rows?.length) return `<p class="note">⚠ 內部人申報資料還沒有（${esc(I.err || "沒有資料")}）。資料由每個交易日的排程從證交所、櫃買中心整理。</p>`;
  const mine = new Set([...myCodes(), ...Object.keys(W.hold || {})]), f = W.insF || "mine", q = (W.insQ || "").trim(), view = ["rank", "feed", "bt"].includes(W.insv) ? W.insv : "rank";
  const none = f === "mine" && !q && !I.rows.some(r => mine.has(r.code)); // 自選、庫存都沒有申報：直接看全部
  const L = I.rows.filter(r => (q ? r.code === q || (r.name || "").includes(q) : f === "mine" && !none ? mine.has(r.code) : true));
  // 期間：近 30／90／365 天或全部；「最新申報」可以按月份往前翻
  const IW = [30, 90, 365, 0].includes(+W.insW) ? +W.insW : 30, d30 = IW ? new Date(Date.now() - IW * 864e5).toISOString().slice(0, 10) : "0000", R30 = L.filter(r => r.d >= d30), mkt = r => /一般交易|盤後|鉅額|拍賣/.test(r.how), wTxt = IW ? `近 ${IW} 天` : "全部期間";
  const months = [...new Set(L.map(r => r.d.slice(0, 7)))].sort().reverse(), mon = months.includes(W.insM) ? W.insM : "";
  const by = [...R30.reduce((m, r) => { const g = m.get(r.code) || m.set(r.code, { code: r.code, name: r.name, n: 0, sh: 0, sell: 0, who: new Set() }).get(r.code); g.n++; g.sh += r.sh || 0; if (mkt(r)) g.sell += r.sh || 0; g.who.add(r.who); return m; }, new Map()).values()].sort((a, b) => b.sh - a.sh);
  const nm = r => esc(r.name || nameOf(r.code)), pct = r => (r.sh && r.hold ? Math.round((r.sh / r.hold) * 100) + "%" : "—");
  let h = `<section class="csec tw-home">${rkHead("內部人持股轉讓申報", "董事、監察人、經理人與持股 10% 以上的大股東，轉讓持股前要先申報，申報後一個月內才可轉讓——這是「打算轉讓」，不一定已經賣出。「贈與」「信託」通常和買賣無關，「一般交易」「盤後鉅額」才是在市場上賣。")}
    <div class="tw-ctl"><div class="tw-grp seg" role="group">${[["mine", "自選＋庫存"], ["all", "全部"]].map(([k, t]) => `<button type="button" data-insf="${k}" aria-pressed="${(none ? "all" : f) === k && !q}">${t}</button>`).join("")}</div><input data-insq value="${esc(q)}" placeholder="代號或名稱" aria-label="代號或名稱"></div>
    <div class="tw-ctl">${rkSeg("data-rkset", "insW:" + IW, [["insW:30", "近 30 天"], ["insW:90", "近 90 天"], ["insW:365", "近一年"], ["insW:0", "全部"]])}</div>
    ${rkCards([{ t: `${wTxt}申報`, sub: `${new Set(R30.map(r => r.code)).size} 檔股票`, v: `${R30.length} 筆` }, { t: "申報人", sub: "不重複", v: `${new Set(R30.map(r => r.who)).size} 位` }, { t: "轉讓張數合計", sub: wTxt, v: insSh(R30.reduce((a, r) => a + (r.sh || 0), 0)) }, { t: "市場賣出方式", sub: "一般交易、盤後鉅額", v: `${R30.filter(mkt).length} 筆`, vc: "down" }])}
    <div class="tw-ctl">${rkSeg("data-rkset", "insv:" + view, [["insv:rank", "轉讓最多"], ["insv:feed", "最新申報"], ["insv:bt", "申報後表現"]])}</div>`;
  if (none) h += `<p class="note">自選與庫存在資料期間內沒有內部人轉讓申報，下面先列出全市場。</p>`;
  if (view === "rank") h += `<h4>${wTxt}申報轉讓張數最多</h4>` + rkList(by.slice(0, 40).map(g => ({ attr: `data-tsel="${g.code}"`, mono: rkMono(rkInit(g.name || nameOf(g.code)), g.sell ? "#d0643f" : "#8a8f98"), name: `${esc(g.name || nameOf(g.code))} <span class="note">${g.code}</span>`, sub: `${g.n} 筆・${g.who.size} 人${g.sell ? `・市場賣出 ${insSh(g.sell)}` : "・贈與／信託等"}`, val: insSh(g.sh), vc: g.sell ? "down" : "" })), `${wTxt}沒有申報`);
  else if (view === "feed") h += `<div class="mn-days mkseg"><button type="button" data-rkset="insM:" aria-pressed="${!mon}">最新</button>${months.map(m => `<button type="button" data-rkset="insM:${m}" aria-pressed="${mon === m}">${m.replace("-", "/")}</button>`).join("")}</div>` + rkList((mon ? L.filter(r => r.d.startsWith(mon)) : L).slice(0, mon ? 400 : 150).map(r => ({ no: r.d.slice(5).replace("-", "/"), attr: `data-tsel="${r.code}"`, mono: rkMono(rkInit(r.name || nameOf(r.code)), mkt(r) ? "#d0643f" : "#8a8f98"), name: `${nm(r)} <span class="note">${r.code}</span>`, sub: `${esc(r.who)}（${esc(r.role)}）・${esc(r.how)}${r.to ? `・受讓 ${esc(r.to)}` : ""}`, val: insSh(r.sh), vc: mkt(r) ? "down" : "", vsub: `占持股 ${pct(r)}` })), "沒有申報");
  else h += `<h4>申報後股價表現 <button class="btn sm" data-insbt ${W.insBt?.busy ? "disabled" : ""}>${W.insBt?.busy ? `計算中 ${W.insBt.done}/${W.insBt.total}…` : "計算"}</button></h4>${insBtHtml()}`;
  return h + `<p class="note">資料：${esc(I.source || "")}・更新 ${I.updated ? new Date(Date.parse(I.updated) + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "—"}・保留最近約 3 年（從排程開始累積）。</p></section>`;
}

/* ---------- 備份同步：匯出／匯入備份檔；有雲端儲存時用同步碼在 iPad、手機之間同步；綁定 Telegram 收收盤後提醒 ---------- */
// 同步的內容：瀏覽器裡 kline: 開頭的設定與紀錄（自選、庫存、提醒、日記、模擬帳戶、錯題本…）；單筆超過 150KB 的多半是快取，不同步
const SYNC_K = "kline-sync";
const syncGet = () => { try { return JSON.parse(localStorage.getItem(SYNC_K) || "{}"); } catch { return {}; } };
const syncSet = o => { try { localStorage.setItem(SYNC_K, JSON.stringify({ ...syncGet(), ...o })); } catch {} };
function syncSnap() { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k?.startsWith("kline:")) continue; const v = localStorage.getItem(k); if (v != null && v.length < 150000) o[k] = v; } } catch {} return o; }
const syncHash = o => { let h = 0; const s = JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
function syncApply(data) { let n = 0; try { for (const [k, v] of Object.entries(data || {})) if (k.startsWith("kline:") && typeof v === "string") { localStorage.setItem(k, v); n++; } } catch {} return n; }
const syncNewId = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
async function syncTok(id) { const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id))); return [...b].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 24); }
async function syncApi(op, extra = {}) { const S = syncGet(); const r = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, id: S.id, ...extra }) }); return r.json(); }
async function syncCfg() { if (W.syncCfg) return W.syncCfg; try { W.syncCfg = await (await fetch("/api/sync?op=cfg")).json(); } catch { W.syncCfg = { kv: false }; } return W.syncCfg; }
async function syncPush(quiet) {
  const S = syncGet(); if (!S.id) return; const data = syncSnap(), h = syncHash(data);
  const j = await syncApi("push", { data, dev: navigator.userAgent.match(/iPad|iPhone|Android|Mac|Windows/)?.[0] || "" }).catch(e => ({ ok: false, error: e.message }));
  if (j.ok) { syncSet({ at: j.at, hash: h, tg: j.tg }); if (!quiet) toast("已上傳到雲端"); } else if (!quiet) toast("上傳失敗：" + (j.error || "")); W.syncErr = j.ok ? null : j.error; if (W.lt === "tools" && W.tv === "sync") renderList();
}
async function syncPull(ask = true) {
  const j = await syncApi("pull").catch(e => ({ ok: false, error: e.message })); if (!j.ok) return toast("下載失敗：" + (j.error || ""));
  if (ask && !confirm(`用雲端的資料（${new Date(j.at + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}${j.dev ? "，" + j.dev : ""}）覆蓋這台裝置？`)) return;
  const n = syncApply(j.data); syncSet({ at: j.at, hash: syncHash(syncSnap()), tg: j.tg }); toast(`已下載 ${n} 項，重新載入…`); setTimeout(() => location.reload(), 600);
}
// 開網頁時：雲端比這台新、而且這台上次同步後沒改過 → 自動下載；之後每分鐘檢查，有改動就自動上傳
async function syncBoot() {
  const S = syncGet(); if (!S.id || S.auto === false || W.off) return; const cfg = await syncCfg(); if (!cfg.kv) return;
  try { const j = await syncApi("pull"); if (j.ok && j.at > (S.at || 0) && syncHash(syncSnap()) === S.hash) { syncApply(j.data); syncSet({ at: j.at, hash: syncHash(syncSnap()), tg: j.tg }); toast("已從雲端同步最新資料，重新載入…"); return setTimeout(() => location.reload(), 800); } } catch {}
  setInterval(() => { const T = syncGet(); if (T.id && T.auto !== false && document.visibilityState === "visible" && syncHash(syncSnap()) !== T.hash) syncPush(true); }, 60000);
}
function syncExport() { const blob = new Blob([JSON.stringify({ app: "kline-school", at: new Date().toISOString(), data: syncSnap() })], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `K線學堂備份-${toolsDay()}.json`; a.click(); }
async function syncImport(file) {
  try { const j = JSON.parse(await file.text()); if (j.app !== "kline-school" || !j.data) throw new Error("不是 KLineLab 的備份檔");
    if (!confirm(`用備份檔（${String(j.at).slice(0, 16).replace("T", " ")}，${Object.keys(j.data).length} 項）覆蓋這台裝置的設定與紀錄？`)) return;
    toast(`已匯入 ${syncApply(j.data)} 項，重新載入…`); setTimeout(() => location.reload(), 600); } catch (e) { toast("匯入失敗：" + e.message); }
}
function syncHtml() {
  const S = syncGet(), C = W.syncCfg; if (!C) syncCfg().then(() => W.lt === "tools" && W.tv === "sync" && renderList());
  if (S.id && C?.tg && !W.syncTok) syncTok(S.id).then(t => { W.syncTok = t; if (W.lt === "tools" && W.tv === "sync") renderList(); });
  const n = Object.keys(syncSnap()).length, dirty = S.id && syncHash(syncSnap()) !== S.hash;
  let h = `<section class="csec"><h3>備份與同步</h3>
    <h4>備份檔</h4><p class="note">把這台裝置的自選、庫存、提醒、交易日記、模擬帳戶、錯題本、線型設定（共 ${n} 項）存成一個檔案，換裝置或清除瀏覽器資料後可以匯入。</p>
    <div class="irform"><button class="btn sm primary" data-sy="export">⬇ 匯出備份檔</button><label class="btn sm">⬆ 匯入備份檔<input type="file" accept="application/json,.json" data-syfile hidden></label></div>
    <h4>雲端同步</h4>`;
  if (!C) h += `<p class="note">檢查中…</p>`;
  else if (!C.kv) h += `<p class="note">網站還沒設定雲端儲存，目前只能用上面的備份檔。（管理者：在 Vercel 專案的 Storage 加上 Upstash for Redis，重新部署後這裡就能用同步碼。）</p>`;
  else if (!S.id) h += `<p class="note">第一台裝置按「建立同步碼」，再到另一台裝置輸入同一組同步碼，兩邊就會同步。同步碼等於密碼，不要給別人。</p>
    <div class="irform"><button class="btn sm primary" data-sy="new">建立同步碼</button><input data-syid placeholder="已經有同步碼？貼在這裡" style="flex:1;min-width:200px" autocomplete="off"><button class="btn sm" data-sy="join">加入</button></div>`;
  else h += `<div class="cokv three"><div><span>同步碼</span><b style="font-size:13px;word-break:break-all">${W.syShow ? esc(S.id) : "••••••••" + esc(S.id.slice(-4))}</b><small><button class="linkbtn" data-sy="show">${W.syShow ? "隱藏" : "顯示"}</button> <button class="linkbtn" data-sy="copy">複製</button></small></div>
      <div><span>上次同步</span><b>${S.at ? new Date(S.at + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ") : "—"}</b><small>${dirty ? "這台有新的改動" : "已是最新"}${W.syncErr ? "・⚠ " + esc(W.syncErr) : ""}</small></div>
      <div><span>自動同步</span><b><label class="note"><input type="checkbox" data-syauto ${S.auto !== false ? "checked" : ""}> 開</label></b><small>開網頁時下載、改動後自動上傳</small></div></div>
    <div class="irform"><button class="btn sm primary" data-sy="push">⬆ 上傳到雲端</button><button class="btn sm" data-sy="pull">⬇ 從雲端下載</button><button class="linkbtn" data-sy="leave">這台停止同步</button></div>`;
  h += `<h4>Telegram 收盤提醒</h4>`;
  if (!C?.tg) h += `<p class="note">${C?.kv ? "網站還沒設定 Telegram 機器人。" : "需要先設定雲端儲存。"}設定好後，「指標提醒」與個股的價格提醒會在每個交易日收盤後（約 16:10）檢查，成立就傳到 Telegram，不用開著網頁。</p>`;
  else if (!S.id) h += `<p class="note">先建立同步碼，提醒條件才會存到雲端讓收盤後的排程檢查。</p>`;
  else if (!S.tg) h += `<p class="note">1. 點下面的連結開啟 Telegram 機器人，按「開始（Start）」　2. 回到這裡按「完成綁定」。</p>
    <div class="irform"><a class="btn sm" href="https://t.me/${esc(C.bot || "")}?start=${esc(W.syncTok || "")}" target="_blank" rel="noopener">開啟 @${esc(C.bot || "機器人")}</a><button class="btn sm primary" data-sy="tgbind">完成綁定</button></div>`;
  else h += `<p class="note">✅ 已綁定。每個交易日收盤後檢查「指標提醒」（${IR().filter(r => r.on).length} 條）與價格提醒，成立就通知。改了提醒條件會自動上傳。</p><div class="irform"><button class="btn sm" data-sy="tgtest">傳測試訊息</button><button class="linkbtn" data-sy="tgoff">解除綁定</button></div>`;
  return h + `</section>`;
}
async function syncClick(d) {
  if (d.sy === "export") return syncExport();
  if (d.sy === "new") { syncSet({ id: syncNewId(), auto: true, at: 0, hash: 0 }); W.syShow = true; await syncPush(); return renderList(); }
  if (d.sy === "join") { const v = ($("#lx [data-syid]")?.value || "").trim(); if (!/^[A-Za-z0-9_-]{20,64}$/.test(v)) return toast("同步碼格式不對"); syncSet({ id: v, auto: true, at: 0, hash: 0 }); return syncPull(true); }
  if (d.sy === "show") { W.syShow = !W.syShow; return renderList(); }
  if (d.sy === "copy") { try { await navigator.clipboard.writeText(syncGet().id); toast("已複製同步碼"); } catch { W.syShow = true; renderList(); toast("請手動複製"); } return; }
  if (d.sy === "push") return syncPush();
  if (d.sy === "pull") return syncPull(true);
  if (d.sy === "leave") { if (confirm("這台裝置停止同步（雲端資料不會刪除，之後輸入同步碼可以再加入）？")) { localStorage.removeItem(SYNC_K); renderList(); } return; }
  if (d.sy === "tgbind") { await syncPush(true); const j = await syncApi("tgbind"); if (j.ok) { syncSet({ tg: true }); await syncPush(true); toast("已綁定 Telegram"); } else toast(j.error || "綁定失敗"); return renderList(); }
  if (d.sy === "tgtest") { const j = await syncApi("tgtest"); return toast(j.ok ? "已送出，看看 Telegram" : j.error || "失敗"); }
  if (d.sy === "tgoff") { const j = await syncApi("tgoff"); if (j.ok) { syncSet({ tg: false }); toast("已解除"); } return renderList(); }
}

/* ---------- 全市場日 K（/api/allk，排程每天收盤後更新）：條件選股、相對強弱選「全市場」時使用 ---------- */
async function allkLoad() {
  if (W.allk?.ok) return W.allk; if (W.allkP) return W.allkP;
  W.allkP = (async () => { const parts = await Promise.all([...Array(10).keys()].map(i => fetch(`/api/allk?s=${i}`).then(r => r.json()).catch(e => ({ ok: false, error: e.message }))));
    const bad = parts.find(p => !p.k); if (bad && parts.every(p => !p.k)) throw new Error(bad.error || "全市場資料暫時拿不到");
    const A = { ok: true, d: parts.find(p => p.d)?.d || [], date: parts.find(p => p.date)?.date, n: {}, k: {} };
    for (const p of parts) if (p.k) { Object.assign(A.n, p.n); Object.assign(A.k, p.k); }
    for (const [c, nm] of Object.entries(A.n)) if (nm && !W.names?.[c]) (W.names ||= {})[c] = nm;
    return (W.allk = A); })();
  try { return await W.allkP; } finally { W.allkP = null; }
}
function allkD(c) { const A = W.allk, a = A?.k?.[c]; if (!a) return null; const D = []; for (let i = 0; i < A.d.length; i++) if (a[3][i] != null) D.push({ d: A.d[i], o: a[0][i] ?? a[3][i], h: a[1][i] ?? a[3][i], l: a[2][i] ?? a[3][i], c: a[3][i], v: a[4][i] ?? 0 }); return D; }
const tick0 = () => new Promise(r => setTimeout(r, 0));

/* ---------- 集保大戶週資料（learner/data/tdcc/<前兩碼>.json）：選股條件「千張大戶週增減」與大戶動向排行 ---------- */
async function tdccShard(k) { W.tdcc ||= {}; if (W.tdcc[k]) return W.tdcc[k]; try { const r = await fetch(`data/tdcc/${k}.json`, { cache: "no-cache" }); W.tdcc[k] = r.ok ? await r.json() : {}; } catch { W.tdcc[k] = {}; } return W.tdcc[k]; }
const tdccChg = c => { const a = W.tdcc?.[c.slice(0, 2)]?.[c]; return a && a.length >= 2 ? +(a[a.length - 1][1] - a[a.length - 2][1]).toFixed(2) : null; };
async function chipxLoad() { if (W.chipx) return W.chipx; try { const r = await fetch("data/chipx.json", { cache: "no-cache" }); W.chipx = r.ok ? await r.json() : { err: `HTTP ${r.status}` }; } catch (e) { W.chipx = { err: e.message }; } return W.chipx; }
async function tdccRank() { if (W.tdccR) return W.tdccR; try { const r = await fetch("data/tdcc/rank.json", { cache: "no-cache" }); W.tdccR = r.ok ? await r.json() : { err: "還沒有排行（集保每週公布一次，累積兩週後才算得出週變化）" }; } catch (e) { W.tdccR = { err: e.message }; } return W.tdccR; }

// 籌碼動向：大戶週變化排行、借券賣出最多、當沖比例最高、選擇權 Put/Call 比
function chipxHtml() {
  const X = W.chipx, T = W.tdccR; if (!X) chipxLoad().then(() => W.lt === "tools" && renderList()); if (!T) tdccRank().then(() => W.lt === "tools" && renderList());
  const a = (c, extra = "") => `<button class="linkbtn" data-tsel="${c}">${esc(nameOf(c))} ${c}</button>${extra}`;
  const lend = Object.entries(X?.lend || {}).filter(([, v]) => v[0] > 0).sort((p, q) => q[1][0] - p[1][0]).slice(0, 25);
  const dt = Object.entries(X?.dt || {}).filter(([c]) => /^\d{4}$/.test(c)).sort((p, q) => q[1] - p[1]).slice(0, 25), pcr = (X?.pcr || []).slice(-20).reverse();
  const tb = (head, rows) => `<div class="ctbl"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="note">還沒有資料</td></tr>`}</tbody></table></div>`;
  return `<section class="csec"><h3>籌碼動向 <span class="note">${X?.date ? "資料日 " + X.date : ""}</span></h3>
    <h4>千張大戶持股週變化 ${T?.date ? `<span class="note">集保 ${T.date}</span>` : ""}</h4>
    ${T?.up ? `<div class="tgrid"><div>${tb(["增加最多", "週變化", "千張%"], T.up.slice(0, 15).map(r => `<tr><td>${a(r[0])}</td><td class="up">+${r[1]}</td><td>${r[2]}%</td></tr>`).join(""))}</div><div>${tb(["減少最多", "週變化", "千張%"], T.down.slice(0, 15).map(r => `<tr><td>${a(r[0])}</td><td class="down">${r[1]}</td><td>${r[2]}%</td></tr>`).join(""))}</div></div>` : `<p class="note">${esc(T ? T.err || "還沒有排行（集保每週公布一次，累積兩週後才算得出週變化）" : "載入中…")}</p>`}
    <p class="note">千張大戶＝持有 1000 張以上的股東，週變化是持股比例的百分點；大戶比例上升、散戶下降常被當成籌碼集中的跡象，但也可能只是集保帳戶移轉。</p>
    <h4>選擇權 Put/Call 比（臺指選擇權）</h4>${tb(["日期", "成交量 P/C", "未平倉 P/C"], pcr.map(r => `<tr><td>${r[0]}</td><td>${r[1] ?? "—"}%</td><td><b>${r[2] ?? "—"}%</b></td></tr>`).join(""))}
    <p class="note">未平倉 Put/Call 比＞100% 代表賣權（看跌保護）未平倉比買權多；常見的解讀是比例偏高時市場有支撐、偏低時過熱，但只是情緒參考。</p>
    <div class="tgrid"><div><h4>借券賣出最多（張）</h4>${tb(["股票", "當日借券賣出", "借券餘額"], lend.map(([c, v]) => `<tr><td>${a(c)}</td><td>${(v[0] ?? 0).toLocaleString()}</td><td>${(v[1] ?? 0).toLocaleString()}</td></tr>`).join(""))}</div>
    <div><h4>當沖比例最高（上市）</h4>${tb(["股票", "當沖比例"], dt.map(([c, v]) => `<tr><td>${a(c)}</td><td>${v}%</td></tr>`).join(""))}</div></div>
    <p class="note">借券賣出多半是法人避險或套利，不一定是看空；當沖比例高代表短線交易熱絡、波動可能較大。${(X?.notes || []).length ? "⚠ " + X.notes.map(esc).join("；") : ""}</p></section>`;
}

/* ---------- 個股頁：美股「達人觀點」加 13F 機構持股、國會交易；台股「籌碼總覽」加當沖比例、內部人申報 ---------- */
function usHoldersHtml(c) {
  if (!c || isTW(c) || !isUS(c) || isIdx(c)) return "";
  const re = () => { if (typeof sxRender === "function" && isSxSub()) sxRender(); };
  if (!W.f13) { f13Load().then(re); } if (!W.cong) { loadCong().then?.(re); }
  const F = W.f13, rows = (F?.funds || []).flatMap(f => [...f.rows, ...f.sold].filter(r => r.ticker === c && !r.pc).map(r => ({ f, r }))).sort((a, b) => b.r.pct - a.r.pct);
  const T = (W.cong?.trades || []).filter(t => t.ticker === c && t.traded >= new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10)), b = T.filter(t => t.k === "buy"), s = T.filter(t => t.k === "sell");
  let h = `<h3 class="sxh">機構持股（13F）<span class="note">${F?.funds?.length ? `追蹤的 ${F.funds.length} 家機構` : ""}</span></h3>`;
  h += !F ? `<p class="note">載入中…</p>` : rows.length ? `<div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th>機構</th><th>占該機構</th><th>股數</th><th>本季</th></tr></thead><tbody>${rows.map(({ f, r }) => `<tr><td>${esc(f.who)}<div class="note">${f.period}</div></td><td>${r.chg === "sold" ? "—" : r.pct + "%"}</td><td>${r.sh ? Math.round(r.sh).toLocaleString() : "0"}</td><td>${f13Tag(r.chg)}${r.psh && r.chg !== "same" && r.chg !== "sold" ? ` <span class="note">${retPct(r.sh / r.psh - 1)}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">追蹤的知名機構最近一季都沒有申報持有 ${esc(c)}。</p>`;
  h += `<h3 class="sxh">國會議員交易 <span class="note">近 180 天・依交易日</span></h3>`;
  h += !W.cong ? `<p class="note">載入中…</p>` : T.length ? `<p>買進 <b class="up">${new Set(b.map(t => t.pid)).size} 人／${b.length} 筆</b>、賣出 <b class="down">${new Set(s.map(t => t.pid)).size} 人／${s.length} 筆</b>。最近：${T.slice().sort((x, y) => y.traded.localeCompare(x.traded)).slice(0, 4).map(t => `${esc(pName(t.pid))} ${t.k === "buy" ? "買" : t.k === "sell" ? "賣" : "換"}（${t.traded}，${amtTxt(t.amount)}）`).join("、")}</p><p class="note">完整明細在「國會」分頁點這檔股票。</p>` : `<p class="note">近 180 天沒有議員申報交易 ${esc(c)}。</p>`;
  return h + `<p class="note">13F 是上一季底的部位、國會申報最晚交易後 45 天才公開，都不是即時動向。</p>`;
}
function chipsExtra(c) {
  const out = []; if (!isTW(c)) return out;
  const re = () => W.dtab === "chips" && typeof renderInfo === "function" && renderInfo();
  if (!W.chipx) chipxLoad().then(re); if (!W.ins) insLoad().then(re);
  const dt = W.chipx?.dt?.[c]; if (dt != null) out.push({ k: "當日沖銷", t: `當沖比例 ${dt}%（${W.chipx.date || ""}）${dt >= 40 ? "，短線交易很熱，波動可能放大" : dt >= 20 ? "，短線交易偏多" : ""}` });
  const L = (W.ins?.rows || []).filter(r => r.code === c);
  if (L.length) { const sh = L.reduce((s, r) => s + (r.sh || 0), 0), mkt = L.filter(r => /一般交易|盤後|鉅額|拍賣/.test(r.how)); out.push({ k: "內部人申報轉讓", t: `近 120 天 ${L.length} 筆、合計 ${Math.round(sh / 1000).toLocaleString()} 張${mkt.length ? `（其中 ${mkt.length} 筆是在市場賣出的方式）` : "（多為贈與、信託，和市場買賣無關）"}；最近 ${L[0].d} ${esc(L[0].role)} ${esc(L[0].who)} ${esc(L[0].how)} ${Math.round((L[0].sh || 0) / 1000).toLocaleString()} 張` }); }
  return out;
}
if (typeof SX === "object" && SX.guru) SX.guru = (orig => function () { return (orig.call(this) || "") + usHoldersHtml(W.sel); })(SX.guru);

/* ---------- 申報頁共用版型（和「台灣政治人物」同一套）：大標題、合計卡片、排行列表、前幾大占比 ----------
   呼叫端負責 esc()；attr 是整列按鈕的屬性（例如 data-cv="person:xxx"） */
const rkInit = s => { s = String(s || "").trim(); if (/^[A-Z][A-Z.\-]{0,5}$/.test(s)) return s.slice(0, 4); const w = s.replace(/^(巴菲特|the)\s+/i, ""); return /^[A-Za-z]/.test(w) ? w[0].toUpperCase() : [...w.replace(/\s/g, "")][0] || "?"; };
// 名字前的方塊圖標拿掉了（使用者覺得多餘）；保留函式，呼叫端不用改
const rkMono = () => "";
const rkHead = (title, desc) => `<h2 class="tw-h">${title}</h2>${desc ? `<p class="note">${desc}</p>` : ""}`;
const rkCards = L => `<div class="tw-sums">${L.map(c => `<${c.attr ? `button type="button" ${c.attr}` : "div"} class="tw-card"${c.on ? ' aria-pressed="true"' : ""}><b>${c.t}</b>${c.sub ? `<small class="note">${c.sub}</small>` : ""}<span class="${c.vc || ""}">${c.v}</span></${c.attr ? "button" : "div"}>`).join("")}</div>`;
const rkSeg = (attr, cur, opts) => `<div class="tw-grp seg" role="group">${opts.map(([k, t]) => `<button type="button" ${attr}="${k}" aria-pressed="${cur === k}">${t}</button>`).join("")}</div>`;
const rkList = (L, empty = "沒有資料") => `<ol class="tw-rank">${L.map((o, i) => `<li><button type="button" ${o.attr || ""}><span class="tw-no">${o.no ?? i + 1}</span>${o.mono}<span class="tw-who"><b>${o.name}</b><small class="note">${o.sub || ""}</small></span><span class="tw-v"><b class="${o.vc || ""}">${o.val}</b><small class="note">${o.vsub || ""}</small></span></button></li>`).join("") || `<li class="note" style="padding:12px 0">${empty}</li>`}</ol>`;
const rkPerson = (mono, name, sub) => `<div class="tw-head">${mono}<div><h2>${name}</h2><p>${sub}</p></div></div>`;
const rkTotal = (label, v, sub, extra = "") => `<div class="tw-total"><span class="note">${label}</span>${extra}<b>${v}</b>${sub ? `<small class="note">${sub}</small>` : ""}</div>`;
// 前幾大：[{ label, tag, sub, pct, val, right }]，pct 是 0～100
const rkTop = (L, more) => `<ol class="tw-top">${L.map((x, i) => `<li><span class="tw-rk">${i + 1}</span><div><b>${x.label}</b>${x.tag ? `<span class="tw-tp">${x.tag}</span>` : ""}${x.sub ? `<small class="note">${x.sub}</small>` : ""}<small>${x.pct != null ? `<b>${Math.round(x.pct)}%</b>・` : ""}${x.val || ""}</small></div><em>${x.right || ""}</em></li>`).join("")}${more || ""}</ol>`;
const RK_C = { 眾議院: "#3d7be0", 參議院: "#c24d6d", 個股: "#3fa36b", 機構: "#9b6bd6" };

/* ---------- 台灣政治人物財產申報（監察院廉政專刊，排程 scripts/tw-officials.mjs）：持股與前後兩次申報的變化 ---------- */
// 資料：{ updated, issues: [{ no, date }], decl: [{ pid, name, org, title, date, kind, issue, stocks: [{ name, code, owner, sh }] }] }
async function twoLoad() { if (W.two) return W.two; try { const r = await fetch("data/tw-officials.json", { cache: "no-cache" }); if (!r.ok) throw new Error(r.status === 404 ? "排程還沒跑完第一次" : `HTTP ${r.status}`); W.two = await r.json(); } catch (e) { W.two = { err: e.message, decl: [] }; } if (W.lt === "cong") renderList(); return W.two; }
// 每個人依申報日排序；持股依「代號（沒有就用名稱）」加總本人、配偶、子女
function twoPeople() {
  if (W.twoP?.src === W.two) return W.twoP.v; const by = new Map();
  for (const d of W.two?.decl || []) (by.get(d.pid) || by.set(d.pid, []).get(d.pid)).push(d);
  const key = s => s.code || s.name, sum = d => (d?.stocks || []).reduce((m, s) => m.set(key(s), { k: key(s), code: s.code, name: s.name, sh: (m.get(key(s))?.sh || 0) + (s.sh || 0) }), new Map());
  const v = [...by].map(([pid, L]) => { L.sort((a, b) => a.date.localeCompare(b.date)); const last = L[L.length - 1], prev = L[L.length - 2], A = sum(last), B = prev ? sum(prev) : null;
    const chg = !B ? [] : [...new Set([...A.keys(), ...B.keys()])].map(k => { const a = A.get(k), b = B.get(k), x = a || b; const d = (a?.sh || 0) - (b?.sh || 0); return { k, code: x.code, name: x.name, sh: a?.sh || 0, psh: b?.sh || 0, d, t: !b ? "new" : !a ? "sold" : d > 0 ? "add" : d < 0 ? "cut" : "same" }; }).filter(x => x.t !== "same");
    return { pid, name: last.name, org: last.org, title: last.title, last, prev, hold: [...A.values()], chg, n: L.length }; });
  W.twoP = { src: W.two, v }; return v;
}
const twoLot = n => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000).toLocaleString()} 張` : `${n.toLocaleString()} 股`);
const twoStk = s => (s.code ? `<button class="linkbtn" data-cv="tw:s:${esc(s.code)}">${esc(nameOf(s.code) !== s.code ? nameOf(s.code) : s.name || "")} ${s.code}</button>` : `<span>${esc(s.name)}</span>`);
const twoWho = p => `<button class="linkbtn" data-cv="tw:p:${esc(p.pid)}">${esc(p.name)}</button><span class="note"> ${esc([p.org, p.title].filter(Boolean).join("・"))}</span>`;
function twoNote() { return `資料：監察院廉政專刊（陽光法令主題網）${W.two?.updated ? `，最後更新 ${new Date(Date.parse(W.two.updated) + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}` : ""}。申報的是申報基準日的「持股」，不是交易；前後兩次申報（通常相隔一年或就職、卸任時）的股數差只代表這段期間增加或減少，不知道實際買賣日期與價格。持股含本人、配偶與未成年子女。僅供研究參考，不是買賣建議。`; }
// 持股損益：申報基準日之後第一個交易日的收盤價 → 最新收盤，乘上申報股數（假設一直持有；之後的買賣看不到）
async function twoBtLoad(codes) {
  const K = (W.twoK ||= {}), need = [...new Set(codes)].filter(c => c && K[c] === undefined); if (!need.length) return;
  const R = (W.twoBt = { busy: true, done: 0, total: need.length }); need.forEach(c => (K[c] = null)); if (W.lt === "cong") renderList();
  let k = 0; await Promise.all(Array.from({ length: 5 }, async () => { while (k < need.length) { const c = need[k++];
    try { const j = await getJ(`/api/kline?code=${encodeURIComponent(c)}&months=24`); K[c] = j.data || []; } catch { K[c] = []; }
    R.done++; if (R.done % 10 === 0 && W.lt === "cong") renderList(); } }));
  R.busy = false; R.at = Date.now(); if (W.lt === "cong") renderList();
}
function twoPnl(p) {
  const K = W.twoK || {}, date = p.last.date, rows = p.hold.filter(h => h.code && h.sh > 0).map(h => { const D = K[h.code]; if (!Array.isArray(D) || D.length < 2) return { ...h, na: D === null ? "載入中" : "沒有股價" };
    const ds = D.map(x => String(x?.d ?? "").slice(0, 10)), i = ds[0] <= date ? ds.findIndex(d => d > date) : -1; if (i < 0) return { ...h, na: ds[0] > date ? "申報日太早" : "還沒有交易日" };
    const p0 = D[i].c, p1 = D[D.length - 1].c; return p0 > 0 && p1 > 0 ? { ...h, p0, p1, d0: ds[i], d1: ds[D.length - 1], v0: h.sh * p0, v1: h.sh * p1, pnl: h.sh * (p1 - p0), r: p1 / p0 - 1 } : { ...h, na: "沒有股價" }; });
  const ok = rows.filter(x => x.pnl != null), v0 = ok.reduce((a, x) => a + x.v0, 0), v1 = ok.reduce((a, x) => a + x.v1, 0);
  return { rows, ok, v0, v1, pnl: v1 - v0, r: v0 ? v1 / v0 - 1 : null };
}
const twd = v => (v == null ? "—" : `${v < 0 ? "-" : ""}${Math.abs(v) >= 1e8 ? (Math.abs(v) / 1e8).toFixed(2) + " 億" : Math.abs(v) >= 1e4 ? Math.round(Math.abs(v) / 1e4).toLocaleString() + " 萬" : Math.round(Math.abs(v)).toLocaleString()}`);
const twdS = v => (v == null ? "—" : (v > 0 ? "+" : "") + twd(v));
function twoPnlHtml(p) {
  const codes = p.hold.filter(h => h.code).map(h => h.code); if (!codes.length) return "";
  if (codes.some(c => (W.twoK || {})[c] === undefined)) setTimeout(() => twoBtLoad(codes), 0);
  const X = twoPnl(p);
  return `<h4>持股損益（申報後到今天）</h4><p class="note">用申報基準日（${p.last.date}）之後第一個交易日的收盤價，到最新收盤價，乘上申報的股數；假設這段期間一直持有（之後有沒有買賣要等下一次申報才看得到）。</p>
    <div class="cokv three"><div><span>申報時市值</span><b>${twd(X.v0)}</b><small>${X.ok.length} 檔有股價</small></div><div><span>現在市值</span><b>${twd(X.v1)}</b><small>${esc(X.ok[0]?.d1 || "")}</small></div><div><span>估計損益</span><b class="${cls(X.pnl)}">${twdS(X.ok.length ? X.pnl : null)}</b><small class="${cls(X.r)}">${retPct(X.r)}</small></div></div>
    <div class="ctbl"><table><thead><tr><th>股票</th><th>股數</th><th>申報後價 → 最新</th><th>報酬</th><th>估計損益（元）</th></tr></thead><tbody>${X.rows.sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity)).map(x => `<tr><td>${twoStk(x)}</td><td>${twoLot(x.sh)}</td><td>${x.p0 != null ? `${x.p0} → ${x.p1}` : `<span class="note">${esc(x.na)}</span>`}</td><td class="${cls(x.r)}">${retPct(x.r)}</td><td class="${cls(x.pnl)}"><b>${twdS(x.pnl)}</b></td></tr>`).join("")}</tbody></table></div>`;
}
// 首頁：全部人的持股損益排行（按下才載入股價）
function twoRankHtml(P) {
  const R = W.twoBt, all = P.flatMap(p => p.hold.filter(h => h.code).map(h => h.code)), run = `<button class="btn sm primary" data-twbt="1" ${R?.busy ? "disabled" : ""}>${R?.busy ? `載入股價 ${R.done}/${R.total}…` : W.twoRank ? "重新整理" : "計算持股損益排行"}</button>`;
  let h = `<h4>持股損益排行 ${run}</h4>`;
  if (!W.twoRank || R?.busy) return h + `<p class="note">每個人最近一次申報的持股，從申報日算到今天賺賠多少（共 ${new Set(all).size} 檔股票，要載入一陣子）。</p>`;
  const L = P.map(p => ({ p, x: twoPnl(p) })).filter(o => o.x.ok.length), srt = W.twoRankS || "pnl", ord = { pnl: (a, b) => b.x.pnl - a.x.pnl, loss: (a, b) => a.x.pnl - b.x.pnl, ret: (a, b) => (b.x.r ?? -9) - (a.x.r ?? -9) }[srt];
  const seg = [["pnl", "最賺"], ["loss", "最賠"], ["ret", "報酬率"]].map(([k, t]) => `<button class="btn sm ${srt === k ? "primary" : ""}" data-twbt="s:${k}">${t}</button>`).join(" ");
  return h + `<div class="mksegrow">${seg}</div><div class="ctbl"><table><thead><tr><th>人物</th><th>申報日</th><th>申報時市值</th><th>現在市值</th><th>估計損益</th><th>報酬</th><th>${srt === "loss" ? "賠最多" : "賺最多"}</th></tr></thead><tbody>
    ${L.sort(ord).slice(0, 30).map(({ p, x }) => { const best = [...x.ok].sort((a, b) => (srt === "loss" ? a.pnl - b.pnl : b.pnl - a.pnl))[0]; return `<tr><td>${twoWho(p)}</td><td>${p.last.date}</td><td>${twd(x.v0)}</td><td>${twd(x.v1)}</td><td class="${cls(x.pnl)}"><b>${twdS(x.pnl)}</b></td><td class="${cls(x.r)}">${retPct(x.r)}</td><td>${best ? `${esc(nameOf(best.code) !== best.code ? nameOf(best.code) : best.name)} <span class="${cls(best.pnl)}">${twdS(best.pnl)}</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="note">${L.length} 人有股價可算。估計值：假設申報後一直持有、沒算股利與交易成本。</p>`;
}
// 分類（申報沒有黨籍，依職稱分組）、證券類型、金額格式（完整數字／億萬）
const TWO_GRP = [["all", "全部"], ["ly", "立法委員"], ["cy", "監察委員"], ["head", "縣市首長"], ["council", "議員"], ["gov", "其他官員"]];
const twoGrp = p => (/立法委員/.test(p.title) ? "ly" : /監察委員/.test(p.title) ? "cy" : /^(副)?(縣|市)長$/.test(p.title) ? "head" : /議員|議長/.test(p.title) ? "council" : "gov");
const TWO_GC = { ly: "#3d7be0", cy: "#9b6bd6", head: "#d2913a", council: "#3fa36b", gov: "#8a8f98" };
const twoType = s => (!s.code ? "其他" : /^00/.test(s.code) ? "ETF" : "個股");
const twoAmt = v => (v == null ? "—" : W.twoAmt === "short" ? (v >= 1e8 ? `${(v / 1e8).toFixed(2)} 億` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()} 萬` : Math.round(v).toLocaleString()) : `NT$ ${Math.round(v).toLocaleString()}`);
const twoLots = n => `${+(n / 1000).toFixed(2)} 張`;
const TWO_PAL = ["#3d6fd6", "#d0643f", "#3fa86b", "#a54bb3", "#c99a3b", "#3aa6b0", "#c24d6d", "#7a8a3a"];
// 最新收盤價：排程存在資料檔（px）；檔案還沒有價格時改問即時報價（每次 40 檔）
function twoPx(code) { return W.two?.px?.[code] ?? W.twoLive?.[code] ?? null; }
async function twoPxLoad() {
  if (W.twoLive || W.off || Object.keys(W.two?.px || {}).length) return; W.twoLive = {};
  const codes = [...new Set((W.two?.decl || []).flatMap(d => d.stocks.map(x => x.code).filter(Boolean)))];
  for (let i = 0; i < codes.length; i += 40) { try { const j = await getJ(`/api/quote?src=mis&codes=${codes.slice(i, i + 40).join(",")}`); for (const q of j.quotes || []) if (q.price ?? q.prev) W.twoLive[q.code] = q.price ?? q.prev; } catch {} }
  W.twoP = null; if (W.lt === "cong") renderList();
}
function twoVal(p) { // 最近一次申報的持股市值（有代號、有收盤價的才算）
  const rows = p.hold.map(h => { const px = h.code ? twoPx(h.code) : null; return { ...h, px, v: px != null ? px * h.sh : null }; }).sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || b.sh - a.sh);
  return { rows, total: rows.reduce((a, x) => a + (x.v || 0), 0), n: rows.length };
}
function twoHtml(arg = "") {
  const X = W.two; if (!X) { twoLoad(); return `<p class="note" style="padding:16px">載入中…</p>`; }
  if (X.err || !X.decl?.length) return `<p class="note" style="padding:16px">⚠ 台灣政治人物申報資料還沒有（${esc(X.err || "沒有資料")}）。資料由排程從監察院廉政專刊整理，每週更新。</p>`;
  twoPxLoad();
  const P = twoPeople(), [kind, id] = arg.split(/:(.*)/s);
  const tag = t => `<span class="ctag ${t === "new" || t === "add" ? "many" : "one"}">${{ new: "新進", add: "增持", cut: "減持", sold: "出清" }[t]}</span>`;
  const pxNote = X.pxDate ? `以 ${X.pxDate.replace(/-/g, "/")} 收盤價計算` : W.twoLive ? "以最新報價計算" : "以台股最新收盤價計算";
  const amtSeg = `<span class="tw-amt seg sm" role="group" aria-label="金額顯示">${[["full", "完整數字"], ["short", "億萬"]].map(([k, t]) => `<button type="button" data-twamt="${k}" aria-pressed="${(W.twoAmt || "full") === k}">${t}</button>`).join("")}</span>`;
  const mono = () => ""; // 名字前不放圖標
  if (kind === "p") {
    const p = P.find(x => x.pid === id); if (!p) return `<p class="note">找不到這個人</p>`;
    const V = twoVal(p), top = V.rows.filter(x => x.v), big = top[0], tab = W.twoTab === "chg" ? "chg" : "hold", owners = c => [...new Set((p.last.stocks || []).filter(s => (s.code || s.name) === c).map(s => s.owner).filter(Boolean))].join("、");
    const decls = (X.decl || []).filter(d => d.pid === p.pid).sort((a, b) => b.date.localeCompare(a.date)), pdf = no => (X.issues || []).find(i => i.no === no)?.pdf;
    const mates = P.filter(q => q !== p && twoGrp(q) === twoGrp(p) && (twoGrp(p) !== "gov" || q.org === p.org)).map(q => ({ q, v: twoVal(q).total })).sort((a, b) => b.v - a.v).slice(0, 12);
    const shown = W.twoMore ? top : top.slice(0, 5), rest = top.slice(5), restV = rest.reduce((a, x) => a + x.v, 0);
    // 歷次申報：選一次申報，下面的持股表與變動紀錄改看那一次（和它的前一次比）
    const di = Math.min(Math.max(0, +W.twoDi || 0), decls.length - 1), D = decls[di], DP = decls[di + 1], agg = d => (d?.stocks || []).reduce((m, x) => { const k = x.code || x.name, g = m.get(k) || m.set(k, { k, code: x.code, name: x.name, sh: 0, owners: new Set() }).get(k); g.sh += x.sh || 0; if (x.owner) g.owners.add(x.owner); return m; }, new Map());
    const A = agg(D), B = DP ? agg(DP) : null, dRows = [...A.values()].map(h => { const px = h.code ? twoPx(h.code) : null; return { ...h, px, v: px != null ? px * h.sh : null }; }).sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || b.sh - a.sh);
    const dChg = !B ? [] : [...new Set([...A.keys(), ...B.keys()])].map(k => { const a = A.get(k), b = B.get(k), x = a || b, d = (a?.sh || 0) - (b?.sh || 0); return { k, code: x.code, name: x.name, sh: a?.sh || 0, psh: b?.sh || 0, d, t: !b ? "new" : !a ? "sold" : d > 0 ? "add" : d < 0 ? "cut" : "same" }; }).filter(x => x.t !== "same");
    const dbar = decls.length > 1 ? `<div class="tw-sub"><h4>歷次申報（${decls.length} 次）</h4><div class="mn-days mkseg">${decls.map((d, i) => `<button type="button" data-rkset="twoDi:${i}" aria-pressed="${i === di}">${d.date.replace(/-/g, "/")} ${esc(d.kind.replace(/申報$/, ""))}</button>`).join("")}</div></div>` : "";
    return `<section class="csec tw-p">
      <div class="tw-head">${mono(p, true)}<div><h2>${esc(p.name)}</h2><p><span class="tw-dot" style="background:${TWO_GC[twoGrp(p)]}"></span>${esc([p.org, p.title].filter(Boolean).join("・"))}　申報日 ${p.last.date.replace(/-/g, "/")}</p></div></div>
      <p class="tw-lead">${esc(p.name)}為${esc(p.org || "")}${esc(p.title || "")}，依 ${p.last.date.replace(/-/g, "/")} 監察院財產申報資料，共持有 ${V.n} 檔有價證券${V.total ? `，總市值約 ${twoAmt(V.total)}` : ""}${big ? `，最大持股為${esc(nameOf(big.code) !== big.code ? nameOf(big.code) : big.name)}（${big.code}）` : ""}。</p>
      <div class="tw-total"><span class="note">股票市值，${pxNote}</span>${amtSeg}<b>${V.total ? twoAmt(V.total) : "—"}</b><small class="note">${V.n} 檔證券${V.n - top.length ? `（${V.n - top.length} 檔沒有上市櫃股價，未計入）` : ""}</small></div>
      ${top.length ? `<ol class="tw-top">${shown.map((x, i) => `<li><span class="tw-rk">${i + 1}</span><div><b>${twoStk(x)}</b><span class="tw-tp">${twoType(x)}</span><small class="note">${esc(owners(x.k))}</small><small><b>${Math.round(x.v / V.total * 100)}%</b>・${twoAmt(x.v)}</small></div><em>${twoLots(x.sh)}</em></li>`).join("")}
        ${rest.length ? `<li class="tw-rest"><div><b>${W.twoMore ? "收合" : `其他 ${rest.length} 檔`}</b>${W.twoMore ? "" : `<small class="note">${twoAmt(restV)}・${Math.round(restV / V.total * 100)}%</small>`}</div><button type="button" class="linkbtn" data-twmore="1">${W.twoMore ? "收合" : "展開"}</button></li>` : ""}</ol>` : ""}
      ${dbar}<div class="tw-tabs seg" role="group"><button type="button" data-twtab="hold" aria-pressed="${tab === "hold"}">持股${di ? `（${D.date.replace(/-/g, "/")}）` : ""}</button><button type="button" data-twtab="chg" aria-pressed="${tab === "chg"}">變動紀錄 <span class="note">${dChg.length}</span></button></div>
      ${tab === "hold" ? `<div class="ctbl tw-tbl"><table><thead><tr><th>名稱</th><th>類型</th><th>持有人</th><th>持有數量</th><th>現價</th></tr></thead><tbody>${dRows.map(x => `<tr><td>${twoStk(x)}</td><td><span class="tw-tp">${twoType(x)}</span></td><td>${esc([...x.owners].join("、") || "—")}</td><td class="num">${x.sh.toLocaleString()}</td><td class="num">${x.px != null ? `$${x.px}` : "--"}</td></tr>`).join("") || `<tr><td colspan="5" class="note">這次申報沒有股票</td></tr>`}</tbody></table></div>`
        : dChg.length ? `<p class="note">${DP.date.replace(/-/g, "/")} → ${D.date.replace(/-/g, "/")} 兩次申報的股數差（申報是持股，看不到實際買賣日期與價格）。</p><div class="ctbl tw-tbl"><table><thead><tr><th>股票</th><th>變化</th><th>上次</th><th>這次</th><th>差額</th></tr></thead><tbody>${dChg.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).map(c => `<tr><td>${twoStk(c)}</td><td>${tag(c.t)}</td><td class="num">${c.psh.toLocaleString()}</td><td class="num">${c.sh.toLocaleString()}</td><td class="num ${c.d > 0 ? "up" : "down"}">${c.d > 0 ? "+" : ""}${c.d.toLocaleString()}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="note">${DP ? "和前一次申報相比，持股沒有變化。" : "這是資料裡最早的一次申報，沒有更早的可以比。"}</p>`}
      ${mates.length ? `<div class="tw-sub"><h4>同為${twoGrp(p) === "gov" ? esc(p.org) : TWO_GRP.find(g => g[0] === twoGrp(p))[1]}</h4><div class="tw-chips">${mates.map(({ q }) => `<button type="button" data-cv="tw:p:${esc(q.pid)}">${esc(q.name)}</button>`).join("")}</div></div>` : ""}
      <div class="tw-sub"><h4>申報表 PDF</h4><div class="tw-chips">${decls.map(d => pdf(d.issue) ? `<a href="${esc(pdf(d.issue))}" target="_blank" rel="noopener">⤓ ${d.date} ${esc(d.kind.replace(/申報$/, ""))}申報</a>` : `<span class="note">${d.date} ${esc(d.kind)}（廉政專刊第 ${d.issue} 期）</span>`).join("")}</div></div>
      <details class="tw-more"><summary>申報後持股損益</summary>${twoPnlHtml(p)}</details></section>`;
  }
  if (kind === "s") {
    const H = P.map(p => ({ p, h: p.hold.find(x => x.code === id), c: p.chg.find(x => x.code === id) })).filter(x => x.h || x.c).sort((a, b) => (b.h?.sh || 0) - (a.h?.sh || 0));
    return `<section class="csec"><h3>${esc(nameOf(id))} ${esc(id)} <button class="btn sm" data-copen="${esc(id)}">在看盤開啟</button></h3><p class="note">${H.filter(x => x.h).length} 位政治人物最近一次申報持有；${H.filter(x => x.c && (x.c.t === "new" || x.c.t === "add")).length} 位比上一次申報增加、${H.filter(x => x.c && (x.c.t === "cut" || x.c.t === "sold")).length} 位減少。</p>
      <div class="ctbl"><table><thead><tr><th>人物</th><th>持股</th><th>市值</th><th>和上次相比</th><th>申報日</th></tr></thead><tbody>${H.map(x => `<tr><td>${twoWho(x.p)}</td><td>${x.h ? twoLot(x.h.sh) : "0"}</td><td>${x.h && twoPx(id) != null ? twoAmt(x.h.sh * twoPx(id)) : "—"}</td><td>${x.c ? `${tag(x.c.t)} <span class="${x.c.d > 0 ? "up" : "down"}">${x.c.d > 0 ? "+" : ""}${twoLot(x.c.d)}</span>` : `<span class="note">${x.p.prev ? "不變" : "只有一次申報"}</span>`}</td><td>${x.p.last.date}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  // 首頁：持股市值排行榜（分組、各組合計、排行），下面是原本的熱門持股、持股變化、損益排行、最近刊登
  const q = (W.twoQ || "").trim(), grp = TWO_GRP.some(g => g[0] === W.twoGrp) ? W.twoGrp : "all";
  const all = P.map(p => ({ p, g: twoGrp(p), ...twoVal(p) })), L = all.filter(o => (grp === "all" || o.g === grp) && (!q || o.p.name.includes(q) || (o.p.org || "").includes(q))).sort((a, b) => b.total - a.total || b.n - a.n);
  const sums = TWO_GRP.slice(1).map(([k, t]) => { const G = all.filter(o => o.g === k); return { k, t, n: G.length, v: G.reduce((a, o) => a + o.total, 0) }; }).filter(x => x.n);
  const hold = new Map(), chg = new Map();
  for (const p of P) { for (const h of p.hold) if (h.code) { const g = hold.get(h.code) || hold.set(h.code, { code: h.code, name: h.name, n: 0, sh: 0 }).get(h.code); g.n++; g.sh += h.sh; }
    for (const c of p.chg) if (c.code) { const g = chg.get(c.code) || chg.set(c.code, { code: c.code, name: c.name, up: [], dn: [] }).get(c.code); (c.d > 0 ? g.up : g.dn).push(p.name); } }
  const H = [...hold.values()].sort((a, b) => b.n - a.n || b.sh - a.sh).slice(0, 30), C = [...chg.values()].sort((a, b) => b.up.length - b.dn.length - (a.up.length - a.dn.length)).slice(0, 25);
  const recent = (X.decl || []).slice().sort((a, b) => b.issue - a.issue || b.date.localeCompare(a.date)).filter(d => !q || d.name.includes(q) || (d.org || "").includes(q)).slice(0, 40);
  return `<section class="csec tw-home"><h2 class="tw-h">持股市值排行榜</h2>
    <p class="note">${P.length} 位政治人物（${(X.issues || []).length} 期監察院廉政專刊）依最近一次申報的持股市值由高至低排列，${pxNote}${X.pxDate ? "，每個交易日更新" : ""}。</p>
    <div class="tw-ctl"><div class="tw-grp seg" role="group" aria-label="分類">${TWO_GRP.map(([k, t]) => `<button type="button" data-twgrp="${k}" aria-pressed="${grp === k}">${t}</button>`).join("")}</div>${amtSeg}<input data-twoq value="${esc(q)}" placeholder="搜尋姓名或機關" aria-label="搜尋姓名或機關"></div>
    <h4>各類持股市值合計</h4><div class="tw-sums">${sums.map(x => `<button type="button" data-twgrp="${x.k}" aria-pressed="${grp === x.k}"><b>${x.t}</b><small class="note">${x.n} 位</small><span>${twoAmt(x.v)}</span></button>`).join("")}</div>
    <ol class="tw-rank">${L.slice(0, W.twoN || 50).map((o, i) => `<li><button type="button" data-cv="tw:p:${esc(o.p.pid)}"><span class="tw-no">${i + 1}</span>${mono(o.p)}<span class="tw-who"><b>${esc(o.p.name)}</b><small class="note">${esc([o.p.org, o.p.title].filter(Boolean).join("・"))}</small></span><span class="tw-v"><b>${o.total ? twoAmt(o.total) : "—"}</b><small class="note">${o.n} 檔</small></span></button></li>`).join("") || `<li class="note">沒有符合的人</li>`}</ol>
    ${L.length > (W.twoN || 50) ? `<button class="btn sm" data-twn="1" type="button">再顯示 50 位（共 ${L.length} 位）</button>` : ""}
    <details class="tw-more"><summary>最多政治人物持有的股票、持股變化</summary><div class="tgrid"><div><h4>最多政治人物持有</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>人數</th><th>合計</th></tr></thead><tbody>${H.map(g => `<tr><td>${twoStk(g)}</td><td><b>${g.n}</b></td><td>${twoLot(g.sh)}</td></tr>`).join("") || `<tr><td colspan="3" class="note">沒有</td></tr>`}</tbody></table></div></div>
    <div><h4>持股變化（和上次申報相比）</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>增加</th><th>減少</th></tr></thead><tbody>${C.map(g => `<tr><td>${twoStk(g)}</td><td class="up">${g.up.length || ""} <span class="note">${g.up.slice(0, 3).map(esc).join("、")}</span></td><td class="down">${g.dn.length || ""} <span class="note">${g.dn.slice(0, 3).map(esc).join("、")}</span></td></tr>`).join("") || `<tr><td colspan="3" class="note">還沒有同一人兩次以上的申報（資料累積中）</td></tr>`}</tbody></table></div></div></div></details>
    <details class="tw-more"><summary>申報後持股損益排行</summary>${twoRankHtml(P)}</details>
    <details class="tw-more"><summary>最近刊登的申報</summary><ul class="cfeed">${recent.map(d => `<li><span class="note">第 ${d.issue} 期・${d.date}</span> ${twoWho(P.find(p => p.pid === d.pid) || d)} <span class="note">${esc(d.kind)}</span> ${d.stocks.length ? `持股 ${d.stocks.length} 檔` : `<span class="note">沒有股票</span>`}</li>`).join("") || `<li class="note">沒有符合的申報</li>`}</ul></details></section>`;
}
