/* ================= 看盤「工具」分頁：每日摘要、指標提醒、模擬交易、交易日記、多圖並排 =================
   這個檔案只定義函式（載入時 watch.html 的 W 還沒建立），由 watch.html 的清單分頁「工具」呼叫 renderTools()。
   資料都存在這台裝置的瀏覽器（localStorage）；指標用日 K 判斷，日 K 每 5 分鐘重抓一次。 */

const TOOLS_VIEWS = [["sum", "每日摘要"], ["scan", "條件選股"], ["rs", "相對強弱"], ["cal", "我的行事曆"], ["ins", "內部人申報"], ["alert", "指標提醒"], ["paper", "模擬交易"], ["journal", "交易日記"], ["multi", "多圖並排"]];
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
  ...COND.map(([k, t, pn, pd, f]) => [`e:${k}`, `今天：${t}`, pn, pd, f]),
];
const SC = () => (W.scan ||= store.get("watch:scan", null) || { uni: "my", codes: "", rules: [{ k: "bull" }, { k: "e:macdgc" }] });
const scSave = () => store.set("watch:scan", { uni: SC().uni, codes: SC().codes, rules: SC().rules });
function scUniverse() {
  const U = SC().uni, hot = (W.hot?.tw?.rows || []).map(r => r.code), etf = (W.etfRank?.rows || []).map(r => r.code);
  const L = U === "my" ? myCodes().filter(isTW) : U === "hold" ? Object.keys(W.hold || {}).filter(isTW) : U === "hot" ? hot.slice(0, 60) : U === "etf" ? etf.slice(0, 60) : U === "all" ? [...myCodes().filter(isTW), ...Object.keys(W.hold || {}).filter(isTW), ...hot.slice(0, 60)] : String(SC().codes).toUpperCase().split(/[\s,，、]+/).filter(isTW);
  return [...new Set(L)].slice(0, 120);
}
async function scRun() {
  const S = SC(), uni = scUniverse(); if (!uni.length) return toast("股票範圍是空的");
  if (S.uni === "hot" && !W.hot?.tw) await loadHot("tw"); if (S.uni === "etf" && !W.etfRank) await loadEtfRank();
  const list = scUniverse(), R = (W.scanRes = { busy: true, done: 0, total: list.length, rows: [] }); renderList();
  const need = S.rules.some(r => r.k === "yld"); if (need) { list.forEach(c => yldWant(c)); await new Promise(r => setTimeout(r, 1500)); }
  let k = 0; const worker = async () => { while (k < list.length) { const c = list[k++], D = await dailyFresh(c); R.done++;
    if (D && D.length >= 65) { const I = indicators(D), hits = [];
      for (const r of S.rules) { const C = SCOND.find(x => x[0] === r.k); if (!C) continue; const p = r.p ?? C[3];
        const m = r.k === "yld" ? (() => { const y = yldNow(c, D[D.length - 1].c); return y != null && y >= p ? `殖利率 ${y.toFixed(2)}%` : null; })() : (() => { try { return C[4](D, I, p); } catch { return null; } })();
        if (!m) { hits.length = 0; hits.fail = true; break; } hits.push(m); }
      if (!hits.fail) R.rows.push({ c, hits, px: D[D.length - 1].c, chg: D.length > 1 ? D[D.length - 1].c / D[D.length - 2].c - 1 : 0 }); }
    if (R.done % 6 === 0 && W.tv === "scan") renderList(); } };
  await Promise.all(Array.from({ length: 6 }, worker)); R.busy = false; R.at = Date.now(); if (W.lt === "tools") renderList();
}

/* ---------- 相對強弱（RS）：和加權指數比，近 20／60／120 日誰比較強 ---------- */
async function rsRun() {
  const list = (SC().uni === "custom" ? scUniverse() : [...new Set([...myCodes().filter(isTW), ...Object.keys(W.hold || {}).filter(isTW), ...(W.hot?.tw?.rows || []).slice(0, 60).map(r => r.code)])]).slice(0, 120);
  const R = (W.rsRes = { busy: true, done: 0, total: list.length, rows: [] }); renderList(); if (!W.hot?.tw) loadHot("tw");
  const T = await dailyFresh("T00"), ret = (D, n) => (D && D.length > n ? D[D.length - 1].c / D[D.length - 1 - n].c - 1 : null), tr = { 20: ret(T, 20), 60: ret(T, 60), 120: ret(T, 120) };
  let k = 0; const worker = async () => { while (k < list.length) { const c = list[k++], D = await dailyFresh(c); R.done++; if (!D || D.length < 25) continue;
    const row = { c, px: D[D.length - 1].c }; [20, 60, 120].forEach(n => { const r = ret(D, n); row["r" + n] = r; row["rs" + n] = r != null && tr[n] != null ? (1 + r) / (1 + tr[n]) - 1 : null; }); R.rows.push(row); } };
  await Promise.all(Array.from({ length: 6 }, worker)); R.tr = tr; R.busy = false; R.at = Date.now(); if (W.lt === "tools") renderList();
}

/* ---------- 我的行事曆：自選＋庫存的除權息、法說會，加上營收、財報公布期限 ---------- */
async function calLoad() { if (W.cal && !W.cal.err) return W.cal; try { W.cal = await getJ("/api/calendar", true); } catch (e) { W.cal = { err: e.message }; } return W.cal; }
function calEvents() {
  const mine = new Set([...myCodes(), ...Object.keys(W.hold || {})]), today = toolsDay(), end = new Date(Date.now() + 70 * 864e5).toISOString().slice(0, 10), out = [];
  (W.cal?.rows || []).filter(r => mine.has(r.code) && r.date >= today && r.date <= end).forEach(r => out.push({ d: r.date, code: r.code, t: `${r.kind || "除權息"}${r.cash ? `：現金 ${r.cash} 元` : ""}${r.stock ? `、股票 ${r.stock} 元` : ""}`, k: "div" }));
  (W.cal?.conf || []).filter(r => mine.has(r.code) && r.date >= today && r.date <= end).forEach(r => out.push({ d: r.date, code: r.code, t: `法說會${r.time ? " " + r.time : ""}${r.place ? "・" + r.place : ""}`, k: "conf" }));
  // 固定的公布期限：每月 10 日前公布上月營收；財報 Q1 5/15、Q2 8/14、Q3 11/14、年報 3/31（上市櫃公司一般規定）
  const y = +today.slice(0, 4);
  for (let m = 0; m < 3; m++) { const dt = new Date(Date.UTC(y, +today.slice(5, 7) - 1 + m, 10)).toISOString().slice(0, 10); if (dt >= today && dt <= end) out.push({ d: dt, t: "上個月營收公布期限（每月 10 日前）", k: "rev" }); }
  [[`${y}-03-31`, "年度財報公布期限"], [`${y}-05-15`, "第一季財報公布期限"], [`${y}-08-14`, "第二季（半年報）公布期限"], [`${y}-11-14`, "第三季財報公布期限"], [`${y + 1}-03-31`, "年度財報公布期限"]].forEach(([d, t]) => { if (d >= today && d <= end) out.push({ d, t, k: "fin" }); });
  return out.sort((a, b) => a.d.localeCompare(b.d));
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
  } else if (v === "scan") {
    const S = SC(), R = W.scanRes, copt = sel => SCOND.map(([k, t]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(t)}</option>`).join("");
    h = `<section class="csec"><h3>條件選股</h3>
      <div class="irform"><label class="note">股票範圍 <select data-scu>${[["my", "自選股"], ["hold", "庫存"], ["hot", "台股熱門前 60"], ["etf", "ETF 成交值前 60"], ["all", "自選＋庫存＋熱門"], ["custom", "自己輸入代號"]].map(([k, t]) => `<option value="${k}" ${S.uni === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${S.uni === "custom" ? `<input data-scc value="${esc(S.codes || "")}" placeholder="代號用空白或逗號分開" style="flex:1;min-width:200px">` : ""}</div>
      <div class="scrules">${S.rules.map((r, i) => { const C = SCOND.find(x => x[0] === r.k); return `<div class="irform"><span class="note">${i ? "且" : "條件"}</span><select data-scr="${i}">${copt(r.k)}</select>${C?.[2] ? `<input type="number" step="any" data-scp="${i}" value="${r.p ?? C[3]}" style="width:80px" aria-label="${esc(C[2])}"><span class="note">${esc(C[2])}</span>` : ""}<button class="linkbtn" data-scdel="${i}">刪除</button></div>`; }).join("")}</div>
      <div class="irform"><button class="btn sm" data-scadd>＋ 加一個條件</button><button class="btn sm primary" data-scrun ${R?.busy ? "disabled" : ""}>${R?.busy ? `掃描中 ${R.done}/${R.total}…` : "開始選股"}</button></div>
      ${R ? `<h4>符合全部條件：${R.rows.length} 檔${R.busy ? "（掃描中）" : `／共掃描 ${R.total} 檔`}</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>收盤</th><th>漲跌</th><th>符合的條件</th></tr></thead><tbody>${R.rows.map(x => `<tr><td><button class="linkbtn" data-tsel="${x.c}">${esc(nameOf(x.c))} ${x.c}</button></td><td>${fmtP(x.px)}</td><td class="${cls(x.chg)}">${(x.chg * 100).toFixed(2)}%</td><td>${x.hits.map(esc).join("・")}</td></tr>`).join("") || `<tr><td colspan="4" class="note">${R.busy ? "…" : "沒有股票同時符合全部條件，試著拿掉一個條件"}</td></tr>`}</tbody></table></div>` : ""}</section>`;
    note = "用日 K（最近 6 個月）判斷；「今天：」開頭的是今天剛發生的事件（例如金叉），其他是目前的狀態。條件與範圍會記住。只是篩選工具，不是買賣建議。";
  } else if (v === "rs") {
    const R = W.rsRes, k = W.rsK || "rs60", rows = (R?.rows || []).filter(x => x[k] != null).sort((a, b) => b[k] - a[k]), n = rows.length;
    h = `<section class="csec"><h3>相對強弱排行 <span class="seg sm" role="group">${[["rs20", "20 日"], ["rs60", "60 日"], ["rs120", "120 日"]].map(([a, t]) => `<button data-rsk="${a}" aria-pressed="${k === a}">${t}</button>`).join("")}</span> <button class="btn sm primary" data-rsrun ${R?.busy ? "disabled" : ""}>${R?.busy ? `計算中 ${R.done}/${R.total}…` : R ? "重新計算" : "開始計算"}</button></h3>
      <p class="note">RS＝（1＋個股報酬）÷（1＋加權指數報酬）− 1，正的代表比大盤強。範圍：自選、庫存與台股熱門前 60（條件選股選「自己輸入代號」時改用那些代號）。${R?.tr ? `同期加權指數：20 日 ${retPct(R.tr[20])}、60 日 ${retPct(R.tr[60])}、120 日 ${retPct(R.tr[120])}` : ""}</p>
      ${R ? `<div class="ctbl"><table><thead><tr><th>#</th><th>股票</th><th>收盤</th><th>20 日</th><th>60 日</th><th>120 日</th><th>RS（${k.slice(2)} 日）</th><th>百分位</th></tr></thead><tbody>${rows.map((x, i) => `<tr><td>${i + 1}</td><td><button class="linkbtn" data-tsel="${x.c}">${esc(nameOf(x.c))} ${x.c}</button></td><td>${fmtP(x.px)}</td><td class="${cls(x.r20)}">${retPct(x.r20)}</td><td class="${cls(x.r60)}">${retPct(x.r60)}</td><td class="${cls(x.r120)}">${retPct(x.r120)}</td><td class="${cls(x[k])}"><b>${retPct(x[k])}</b></td><td>${n > 1 ? Math.round((1 - i / (n - 1)) * 100) : 100}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;
    note = "相對強弱只看過去的價格表現，強勢股也可能隨時轉弱；百分位 100 是範圍內最強。";
  } else if (v === "cal") {
    if (!W.cal) calLoad().then(() => W.lt === "tools" && renderList());
    const E = calEvents(), by = E.reduce((m, e) => ((m[e.d] ||= []).push(e), m), {});
    h = `<section class="csec"><h3>我的行事曆 <span class="note">自選與庫存・未來 70 天</span></h3>
      ${W.cal?.err ? `<p class="note">⚠ 除權息、法說會資料暫時拿不到（${esc(W.cal.err)}），只列固定的公布期限。</p>` : ""}
      ${Object.entries(by).map(([d, L]) => `<div class="calday"><b>${d.slice(5).replace("-", "/")}（${"日一二三四五六"[new Date(d + "T00:00:00Z").getUTCDay()]}）</b><ul class="tlist">${L.map(e => `<li><span class="ctag ${e.k === "div" ? "many" : "one"}">${{ div: "除權息", conf: "法說會", rev: "營收", fin: "財報" }[e.k]}</span> ${e.code ? `<button class="linkbtn" data-tsel="${e.code}">${esc(nameOf(e.code))} ${e.code}</button> ` : ""}${esc(e.t)}</li>`).join("")}</ul></div>`).join("") || `<p class="note">${W.cal ? "未來 70 天沒有自選、庫存的除權息或法說會。" : "載入中…"}</p>`}</section>`;
    note = "除權息來自證交所、櫃買中心的預告表，法說會來自公開資訊觀測站；營收、財報是法定公布期限（實際日期公司可能提早）。";
  } else if (v === "ins") {
    h = insHtml(); note = "內部人申報是公開資訊，可以當成籌碼面的參考；大股東轉讓的原因很多（繳稅、贈與、信託、資金需求），不一定代表看壞。";
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
const retPct = v => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
function toolsClick(e) {
  if (W.lt !== "tools") return; const b = e.target.closest("[data-tv],[data-tx],[data-tsel],[data-irdel],[data-paside],[data-jdel],[data-mm],[data-scadd],[data-scdel],[data-scrun],[data-rsk],[data-rsrun],[data-insf]"); if (!b) return; const d = b.dataset;
  if (b.hasAttribute("data-scadd")) { SC().rules.push({ k: "above" }); scSave(); return renderList(); }
  if (d.scdel != null) { SC().rules.splice(+d.scdel, 1); scSave(); return renderList(); }
  if (b.hasAttribute("data-scrun")) return scRun();
  if (d.rsk) { W.rsK = d.rsk; return renderList(); }
  if (d.insf) { W.insF = d.insf; W.insQ = ""; return renderList(); }
  if (b.hasAttribute("data-rsrun")) return rsRun();
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
function toolsChange(e) {
  if (W.lt !== "tools") return; const t = e.target, d = t.dataset;
  if (d.iron != null) { IR()[+d.iron].on = t.checked; irSave(); }
  else if (d.scu != null) { SC().uni = t.value; scSave(); renderList(); }
  else if (d.scc != null) { SC().codes = t.value; scSave(); }
  else if (d.scr != null) { SC().rules[+d.scr] = { k: t.value }; scSave(); renderList(); }
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

/* ---------- 國會：申報後跟單回測（申報公開的隔一個交易日收盤買進，持有 30／90 天，和 SPY 同期比） ---------- */
// 申報日當天的收盤前不一定看得到申報，所以用「申報日之後第一個交易日的收盤」進場，避免偷看；另外算「交易日進場」當對照（現實中做不到）
const CBT_H = [[21, "30 天"], [63, "90 天"]];
async function congBtRun(all) {
  const C = W.cong; if (!C?.trades?.length) return;
  const buys = C.trades.filter(t => t.k === "buy" && t.assetType === "股票" && /^[A-Z][A-Z.]{0,6}$/.test(t.ticker));
  const cnt = buys.reduce((m, t) => m.set(t.ticker, (m.get(t.ticker) || 0) + 1), new Map()), tick = [...cnt].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, all ? 250 : 60);
  const R = (W.cbt = { busy: true, done: 0, total: tick.length + 1, all }); renderList();
  const load = async T => { if (!Array.isArray(W.congK[T])) { try { const j = await getJ(`/api/kline?code=${encodeURIComponent(T)}&months=12`); W.congK[T] = j.data || []; } catch (e) { W.congK[T] = { err: e.message }; } } R.done++; if (R.done % 5 === 0 && W.lt === "cong" && W.cv === "bt") renderList(); };
  await load("SPY"); let k = 0; await Promise.all(Array.from({ length: 5 }, async () => { while (k < tick.length) await load(tick[k++]); }));
  const S = Array.isArray(W.congK.SPY) ? W.congK.SPY : [], sIdx = new Map(S.map((x, i) => [String(x.d).slice(0, 10), i])), set = new Set(tick);
  // 同一檔在交易日前後 30 天內有幾個不同的人買 → 多人共同 vs 單一人物
  const crowd = t => new Set(buys.filter(x => x.ticker === t.ticker && Math.abs(Date.parse(x.traded) - Date.parse(t.traded)) <= 30 * 864e5).map(x => x.pid)).size;
  R.rows = buys.filter(t => set.has(t.ticker)).map(t => {
    const D = W.congK[t.ticker]; if (!Array.isArray(D) || D.length < 5) return null; const ds = D.map(x => String(x.d).slice(0, 10));
    const iF = ds.findIndex(d => d > t.filed), iT = ds.findIndex(d => d >= t.traded); if (iF < 0) return null;
    const ret = (i, h) => (i >= 0 && i + h < D.length ? D[i + h].c / D[i].c - 1 : null);
    const spy = (i, h) => { if (i < 0 || i + h >= D.length) return null; const a = sIdx.get(ds[i]), b = sIdx.get(ds[i + h]); return a != null && b != null ? S[b].c / S[a].c - 1 : null; };
    const o = { t, crowd: crowd(t), big: (t.amount?.[0] || 0) >= 50001 };
    CBT_H.forEach(([h]) => { o["f" + h] = ret(iF, h); o["s" + h] = spy(iF, h); o["t" + h] = ret(iT, h); }); return o;
  }).filter(Boolean);
  R.skipped = tick.filter(T => !Array.isArray(W.congK[T]) || !W.congK[T].length); R.busy = false; R.at = Date.now(); if (W.lt === "cong") renderList();
}
function cbtStat(L, h, key = "f") {
  const v = L.map(x => x[key + h]).filter(x => x != null), ex = L.filter(x => x[key + h] != null && x["s" + h] != null).map(x => x[key + h] - x["s" + h]); if (!v.length) return null;
  const srt = [...v].sort((a, b) => a - b);
  return { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, med: srt[srt.length >> 1], win: v.filter(x => x > 0).length / v.length, ex: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null, beat: ex.length ? ex.filter(x => x > 0).length / ex.length : null };
}
function congBtHtml() {
  const R = W.cbt, run = `<button class="btn sm primary" data-cbt="60" ${R?.busy ? "disabled" : ""}>${R?.busy ? `載入股價 ${R.done}/${R.total}…` : R ? "重新計算" : "開始回測（筆數最多的 60 檔）"}</button> <button class="btn sm" data-cbt="all" ${R?.busy ? "disabled" : ""}>全部股票（較慢）</button>`;
  let h = `<section class="csec"><h3>申報後跟單回測 ${run}</h3>
    <p class="note">問題：看到議員「申報買進」後才跟著買，賺得到嗎？做法：每一筆股票買進申報，在<strong>申報日之後第一個交易日的收盤</strong>買進，持有約 30 天（21 個交易日）與 90 天（63 個交易日），和同期間的 SPY（標普 500 ETF）比。「交易日進場」是假設在議員實際交易那天就買——現實中看不到，只用來看申報延遲吃掉多少報酬。</p>`;
  if (!R?.rows) return h + `</section>`;
  const L = R.rows, row = (t, G) => `<tr><td>${t}</td>${CBT_H.map(([hh]) => { const s = cbtStat(G, hh); return s ? `<td>${s.n}</td><td class="${cls(s.avg)}">${retPct(s.avg)}</td><td>${retPct(s.med)}</td><td>${Math.round(s.win * 100)}%</td><td class="${cls(s.ex)}"><b>${retPct(s.ex)}</b></td><td>${s.beat != null ? Math.round(s.beat * 100) + "%" : "—"}</td>` : `<td colspan="6" class="note">還不到持有期間</td>`; }).join("")}</tr>`;
  const head = `<thead><tr><th rowspan="2">分組</th>${CBT_H.map(([, t]) => `<th colspan="6">持有 ${t}</th>`).join("")}</tr><tr>${CBT_H.map(() => "<th>筆數</th><th>平均</th><th>中位數</th><th>賺錢比例</th><th>贏 SPY（平均）</th><th>贏 SPY 比例</th>").join("")}</tr></thead>`;
  const tf = cbtStat(L, 21, "t"), tn = cbtStat(L, 63, "t");
  h += `<div class="ctbl"><table>${head}<tbody>${row("全部買進申報", L)}${row("多人共同（前後 30 天 ≥ 2 人買）", L.filter(x => x.crowd >= 2))}${row("單一人物", L.filter(x => x.crowd < 2))}${row("大額（下限 ≥ $50K）", L.filter(x => x.big))}${row("小額（$50K 以下）", L.filter(x => !x.big))}${row("眾議院", L.filter(x => W.cong.people?.[x.t.pid]?.chamber !== "參議院"))}${row("參議院", L.filter(x => W.cong.people?.[x.t.pid]?.chamber === "參議院"))}</tbody></table></div>
    <p class="note">對照：如果能在<strong>交易日</strong>就買，30 天平均 ${retPct(tf?.avg)}、90 天平均 ${retPct(tn?.avg)}（現實中做不到，差距就是申報延遲的成本）。</p>`;
  const per = [...L.reduce((m, x) => m.set(x.t.pid, [...(m.get(x.t.pid) || []), x]), new Map())].map(([pid, G]) => ({ pid, G, s: cbtStat(G, 21) })).filter(x => x.s && x.s.n >= 3).sort((a, b) => (b.s.ex ?? -9) - (a.s.ex ?? -9));
  h += `<h4>依人物（至少 3 筆，依 30 天贏 SPY 排序）</h4><div class="ctbl"><table>${head}<tbody>${per.slice(0, 25).map(x => row(`<button class="linkbtn" data-cv="person:${esc(x.pid)}">${esc(pName(x.pid))}</button>`, x.G)).join("")}</tbody></table></div>
    <p class="note">樣本：${L.length} 筆買進申報、${new Set(L.map(x => x.t.ticker)).size} 檔股票（資料從 ${L.map(x => x.t.filed).sort()[0] || "—"} 開始，時間還短、樣本小，結果容易被少數幾檔左右）。${R.skipped?.length ? `拿不到股價而略過：${R.skipped.slice(0, 12).map(esc).join("、")}${R.skipped.length > 12 ? ` 等 ${R.skipped.length} 檔` : ""}。` : ""}沒算手續費、匯率與稅；過去的結果不代表未來。</p></section>`;
  return h;
}

/* ---------- 13F 機構持股 ---------- */
async function f13Load() { if (W.f13) return W.f13; try { const r = await fetch("data/f13.json", { cache: "no-cache" }); if (!r.ok) throw new Error(r.status === 404 ? "排程還沒跑完第一次" : `HTTP ${r.status}`); W.f13 = await r.json(); } catch (e) { W.f13 = { err: e.message, funds: [] }; } if (W.lt === "cong") renderList(); return W.f13; }
const F13_CHG = { new: ["新進", "up"], add: ["加碼", "up"], cut: ["減碼", "down"], sold: ["出清", "down"], same: ["持平", ""] };
const f13Tag = c => `<span class="ctag ${c === "new" || c === "add" ? "many" : c === "same" ? "" : "one"}">${F13_CHG[c]?.[0] || c}</span>`;
const f13Tk = r => (r.ticker ? `<button class="linkbtn ctk" data-copen="${esc(r.ticker)}">${esc(r.ticker)}</button>` : "") + `<div class="note cas">${esc(r.name)}${r.pc ? `（${r.pc === "PUT" ? "賣權" : "買權"}）` : ""}</div>`;
function f13Html(arg) {
  const F = W.f13; if (!F) { f13Load(); return `<p class="note" style="padding:16px">載入中…</p>`; }
  if (F.err || !F.funds?.length) return `<p class="note" style="padding:16px">⚠ 13F 資料還沒有（${esc(F.err || "沒有資料")}）。資料由每天的排程從 SEC EDGAR 整理。</p>`;
  if (arg) {
    const f = F.funds.find(x => x.cik === arg); if (!f) return `<p class="note">找不到這家機構</p>`;
    const sh = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : n);
    return `<section class="csec"><h3>${esc(f.who)} <span class="note">${esc(f.name)}</span> <a class="note" href="${esc(f.doc)}" target="_blank" rel="noopener">SEC 原始申報</a></h3>
      <div class="cokv three"><div><span>持股日期（季底）</span><b>${f.period}</b><small>${f.filed} 申報・上一季 ${f.prevPeriod || "—"}</small></div><div><span>申報市值</span><b>${usd(f.total)}</b><small>${f.n} 檔</small></div><div><span>本季變動</span><b><span class="up">新進 ${f.rows.filter(r => r.chg === "new").length}・加碼 ${f.rows.filter(r => r.chg === "add").length}</span></b><small><span class="down">減碼 ${f.rows.filter(r => r.chg === "cut").length}・出清 ${f.sold.length}</span></small></div></div>
      <div class="ctbl"><table><thead><tr><th>股票</th><th>占比</th><th>市值</th><th>股數</th><th>上一季股數</th><th>變動</th></tr></thead><tbody>
      ${f.rows.map(r => `<tr><td>${f13Tk(r)}</td><td>${r.pct}%</td><td>${usd(r.value)}</td><td>${sh(r.sh)}</td><td>${sh(r.psh)}</td><td>${f13Tag(r.chg)}${r.psh && r.chg !== "same" ? ` <span class="note">${retPct(r.sh / r.psh - 1)}</span>` : ""}</td></tr>`).join("")}
      ${f.sold.map(r => `<tr><td>${f13Tk(r)}</td><td>—</td><td>—</td><td>0</td><td>${sh(r.psh)}</td><td>${f13Tag("sold")}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">變動用股數比（±2% 以內算持平），不受股價漲跌影響。只列前 60 大與有變動的持股。</p></section>`;
  }
  // 機構共同動向：同一檔有幾家新進／加碼、幾家減碼／出清
  const agg = new Map(); for (const f of F.funds) for (const r of [...f.rows, ...f.sold]) { if (r.pc) continue; const k = r.ticker || r.cusip, g = agg.get(k) || agg.set(k, { r, up: [], dn: [], hold: 0 }).get(k); if (r.chg === "new" || r.chg === "add") g.up.push(f.who); else if (r.chg === "cut" || r.chg === "sold") g.dn.push(f.who); if (r.chg !== "sold") g.hold++; }
  const A = [...agg.values()], top = A.filter(g => g.up.length).sort((a, b) => b.up.length - a.up.length || a.dn.length - b.dn.length).slice(0, 25), out = A.filter(g => g.dn.length).sort((a, b) => b.dn.length - a.dn.length).slice(0, 15);
  const who = L => L.map(w => esc(w.split(" ")[0])).join("、");
  return `<section class="csec"><h3>13F 機構持股 <span class="note">${F.funds.length} 家・SEC Form 13F-HR</span></h3>
    <p class="note">管理資產 1 億美元以上的機構每季要申報美股多頭持股，最晚在季底後 45 天公開——看到的是<strong>上一季底</strong>的部位，現在可能已經不同；不含放空、現金與非美股。</p>
    <div class="ctbl"><table><thead><tr><th>機構</th><th>持股日期</th><th>市值</th><th>檔數</th><th>前 3 大</th><th>新進／出清</th></tr></thead><tbody>
    ${F.funds.map(f => `<tr><td><button class="linkbtn" data-cv="f13:${f.cik}">${esc(f.who)}</button><div class="note cas">${esc(f.name)}</div></td><td>${f.period}<div class="note">${f.filed} 申報</div></td><td>${usd(f.total)}</td><td>${f.n}</td><td>${f.rows.slice(0, 3).map(r => `${esc(r.ticker || r.name)} ${r.pct}%`).join("<br>")}</td><td><span class="up">${f.rows.filter(r => r.chg === "new").length}</span>／<span class="down">${f.sold.length}</span></td></tr>`).join("")}</tbody></table></div>
    <h4>多家機構同時新進或加碼</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>新進／加碼</th><th>減碼／出清</th><th>持有家數</th></tr></thead><tbody>${top.map(g => `<tr><td>${f13Tk(g.r)}</td><td class="up"><b>${g.up.length}</b> <span class="note">${who(g.up)}</span></td><td class="down">${g.dn.length || ""} <span class="note">${who(g.dn)}</span></td><td>${g.hold}</td></tr>`).join("")}</tbody></table></div>
    <h4>多家機構減碼或出清</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>減碼／出清</th><th>新進／加碼</th></tr></thead><tbody>${out.map(g => `<tr><td>${f13Tk(g.r)}</td><td class="down"><b>${g.dn.length}</b> <span class="note">${who(g.dn)}</span></td><td class="up">${g.up.length || ""}</td></tr>`).join("")}</tbody></table></div>
    ${(F.notes || []).length ? `<p class="note">⚠ ${F.notes.map(esc).join("；")}</p>` : ""}</section>`;
}

/* ---------- 台股內部人持股轉讓事前申報 ---------- */
async function insLoad() { if (W.ins) return W.ins; try { const r = await fetch("data/insider.json", { cache: "no-cache" }); if (!r.ok) throw new Error(r.status === 404 ? "排程還沒跑完第一次" : `HTTP ${r.status}`); W.ins = await r.json(); } catch (e) { W.ins = { err: e.message, rows: [] }; } if (W.lt === "tools" || W.dtab) renderList(); return W.ins; }
const insSh = n => (n == null ? "—" : `${Math.round(n / 1000).toLocaleString()} 張`);
function insTable(L) {
  return `<div class="ctbl"><table><thead><tr><th>申報日</th><th>股票</th><th>申報人</th><th>身分</th><th>轉讓方式</th><th>轉讓股數</th><th>目前持股</th><th>占持股</th></tr></thead><tbody>${L.map(r => `<tr><td>${r.d}</td><td><button class="linkbtn" data-tsel="${r.code}">${esc(r.name || nameOf(r.code))} ${r.code}</button></td><td>${esc(r.who)}</td><td>${esc(r.role)}</td><td>${esc(r.how)}${r.to ? `<div class="note">受讓：${esc(r.to)}</div>` : ""}</td><td>${insSh(r.sh)}</td><td>${insSh(r.hold)}</td><td>${r.sh && r.hold ? Math.round((r.sh / r.hold) * 100) + "%" : "—"}</td></tr>`).join("") || `<tr><td colspan="8" class="note">沒有申報</td></tr>`}</tbody></table></div>`;
}
function insHtml() {
  const I = W.ins; if (!I) { insLoad(); return `<p class="note">載入中…</p>`; }
  if (I.err || !I.rows?.length) return `<p class="note">⚠ 內部人申報資料還沒有（${esc(I.err || "沒有資料")}）。資料由每個交易日的排程從證交所、櫃買中心整理。</p>`;
  const mine = new Set([...myCodes(), ...Object.keys(W.hold || {})]), f = W.insF || "mine", q = (W.insQ || "").trim();
  const L = I.rows.filter(r => (q ? r.code === q || (r.name || "").includes(q) : f === "mine" ? mine.has(r.code) : true));
  const by = [...I.rows.filter(r => r.d >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).reduce((m, r) => { const g = m.get(r.code) || m.set(r.code, { code: r.code, name: r.name, n: 0, sh: 0, who: new Set() }).get(r.code); g.n++; g.sh += r.sh || 0; g.who.add(r.who); return m; }, new Map()).values()].sort((a, b) => b.sh - a.sh).slice(0, 15);
  return `<section class="csec"><h3>內部人持股轉讓申報 <span class="seg sm" role="group">${[["mine", "自選＋庫存"], ["all", "全部"]].map(([k, t]) => `<button data-insf="${k}" aria-pressed="${f === k && !q}">${t}</button>`).join("")}</span> <input data-insq value="${esc(q)}" placeholder="代號或名稱" style="width:110px"></h3>
    <p class="note">董事、監察人、經理人與持股 10% 以上的大股東，要轉讓持股前必須先申報；申報後一個月內才可轉讓，所以這是「打算轉讓」，不一定已經賣出。轉讓方式是「贈與」「信託」通常和買賣無關，「一般交易」「盤後鉅額」才是在市場上賣。</p>
    ${!L.length && f === "mine" && !q ? `<p class="note">自選與庫存最近 120 天沒有內部人轉讓申報；點上面的「全部」看全市場（共 ${I.rows.length} 筆）。</p>` : insTable(L.slice(0, 150))}
    <h4>近 30 天申報轉讓張數最多</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>申報筆數</th><th>人數</th><th>轉讓股數合計</th></tr></thead><tbody>${by.map(g => `<tr><td><button class="linkbtn" data-tsel="${g.code}">${esc(g.name || nameOf(g.code))} ${g.code}</button></td><td>${g.n}</td><td>${g.who.size}</td><td>${insSh(g.sh)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">資料：${esc(I.source || "")}・更新 ${I.updated ? new Date(Date.parse(I.updated) + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "—"}・保留最近 120 天。</p></section>`;
}
