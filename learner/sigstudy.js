/* ================= 訊號回測（選股條件的歷史勝率）：網頁與排程（scripts/_engine.mjs）共用，最上層不碰畫面 =================
   把過去每一次「條件成立」找出來，看之後持有 5／10／20 個交易日的報酬。排程 scripts/signal-study.mjs 每天收盤後用全市場日 K 算好，
   寫進 data/signal-study.json，網頁只讀那個檔。
   規則：訊號日收盤後才知道條件成立 → 一律「隔天開盤」進場，第 n 根收盤出場，扣來回手續費 0.1425% × 2 與證交稅 0.3%。
   不偷看未來：每一天只拿「到那天為止」的 K 棒（D.slice(0, i + 1)）去算指標與判斷條件。
   限制：日 K 快取只有最近約 260 個交易日（扣掉暖機約 200 天），而且只有現在還在上市櫃的股票（倖存者偏差）。 */
const SIG_NS = [5, 10, 20], SIG_COST = 0.001425 * 2 + 0.003, SIG_WARM = 60, SIG_GAP = 5, SIG_MIN_LOTS = 500, SIG_MIN_N = 30;
const sigR4 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
// 第 i 根出訊號 → 第 i+1 根開盤買、第 i+n 根收盤賣；買不到（一字漲停）、資料不夠或價格異常回傳 null
function sigForward(D, i, n, cost = SIG_COST) {
  const e = D[i + 1], x = D[i + n], p = D[i]; if (!e || !x || !(e.o > 0) || !(x.c > 0) || !(p?.c > 0)) return null;
  if (e.o === e.h && e.h === e.l && e.l === e.c && e.o >= p.c * 1.095) return null; // 一字漲停鎖死，實際買不到
  for (let k = i + 1; k <= i + n; k++) if (!(D[k].c > 0) || Math.abs(D[k].c / D[k - 1].c - 1) > 0.5) return null; // 減資、分割等沒有還原的跳動
  return x.c / e.o - 1 - cost;
}
// defs: [{ id, hit(D, I) }]；回傳 [{ id, i }]。同一個條件 gap 根內重複成立只算第一次（避免連續好幾天都成立時樣本重疊）
function sigScan(D, defs, ind, { warm = SIG_WARM, gap = SIG_GAP, minLots = SIG_MIN_LOTS } = {}) {
  const out = [], last = {};
  for (let i = warm; i < D.length; i++) {
    if (!(D[i].v >= minLots)) continue;
    const P = D.slice(0, i + 1); let I = null;
    for (const f of defs) { if (last[f.id] != null && i - last[f.id] < gap) continue; let ok = null; try { ok = f.hit(P, (I ||= ind(P))); } catch {} if (ok) { out.push({ id: f.id, i }); last[f.id] = i; } }
  }
  return out;
}
// 全市場等權大盤（買進持有，不是每天再平衡）：同一天開盤等權買進當時每一檔、持有到同一天收盤賣出，扣同樣的成本。
// 回傳 { S: [{ b, j: Map 日期 → 第幾根 }], memo }，sigBench 依「進場日｜出場日」算一次後記住（全市場約 260 天 × 3 種天數）
function sigMarket(all) {
  return { S: all.filter(b => b?.length > 1).map(b => ({ b, j: new Map(b.map((x, k) => [x?.d, k])) })), memo: new Map() };
}
// 大盤在同一個視窗的報酬：每一檔都用 sigForward 的規則（一字漲停買不到、未還原的減資／分割不算），找不到那兩天的股票不算；沒有任何一檔回傳 null
function sigBench(M, D, i, n, cost = SIG_COST) {
  const da = D[i + 1]?.d, db = D[i + n]?.d; if (!da || !db) return null;
  const k = da + "|" + db; if (!M.memo.has(k)) { let s = 0, c = 0;
    for (const { b, j } of M.S) { const a = j.get(da), z = j.get(db); if (!(a >= 1) || !(z >= a)) continue; const r = sigForward(b, a - 1, z - a + 1, 0); if (r != null) { s += r; c++; } }
    M.memo.set(k, c ? s / c : null); }
  const m = M.memo.get(k); return m == null ? null : m - cost;
}
function sigStat(A) {
  if (!A.length) return null; const s = [...A].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: A.length, avg: sigR4(A.reduce((x, y) => x + y, 0) / A.length), med: sigR4(q(0.5)), p25: sigR4(q(0.25)), p75: sigR4(q(0.75)), win: sigR4(A.filter(x => x > 1e-9).length / A.length) }; // 1e-9：浮點誤差不算贏
}
// stocks: [{ c, n, bars }]、defs: [{ id, group, side, name, desc, hit }] → 每個條件的統計
function sigStudy(stocks, defs, ind, { ns = SIG_NS, cost = SIG_COST, warm = SIG_WARM, gap = SIG_GAP, minLots = SIG_MIN_LOTS } = {}) {
  const M = sigMarket(stocks.map(s => s.bars)), T = Object.fromEntries(defs.map(f => [f.id, { r: Object.fromEntries(ns.map(n => [n, []])), x: Object.fromEntries(ns.map(n => [n, []])), list: [] }]));
  for (const s of stocks) { const D = s.bars; if (!D || D.length <= warm) continue;
    for (const { id, i } of sigScan(D, defs, ind, { warm, gap, minLots })) { const rec = [s.c, s.n, D[i].d];
      for (const n of ns) { const r = sigForward(D, i, n, cost); rec.push(sigR4(r)); if (r == null) continue; T[id].r[n].push(r); const m = sigBench(M, D, i, n, cost); if (m != null) T[id].x[n].push(r - m); }
      T[id].list.push(rec); } }
  const nL = ns[ns.length - 1], bins = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2];
  return defs.map(f => { const t = T[f.id];
    return { id: f.id, group: f.group, side: f.side || null, name: f.name, desc: f.desc || "", stats: Object.fromEntries(ns.map(n => { const a = sigStat(t.r[n]), x = sigStat(t.x[n]); return [n, a ? { ...a, ex: x?.avg ?? null, exWin: x?.win ?? null } : null]; })),
      hist: [...bins, Infinity].map((b, k) => t.r[nL].filter(v => v < b && (k === 0 || v >= bins[k - 1])).length), recent: t.list.sort((a, b) => b[2].localeCompare(a[2])).slice(0, 30) }; });
}

/* ---------- 看盤「選股 → 訊號回測」與 K 線格子上的勝率標記（只定義函式；畫面由 watch.html 的 renderList 呼叫） ---------- */
async function sgLoad() {
  if (W.sigBusy || W.off) return; W.sigBusy = true;
  try { const r = await fetch("data/signal-study.json", { cache: "no-cache", signal: tmo(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const j = await r.json(); W.sig = Array.isArray(j?.defs) ? j : { err: "格式不對" }; } catch (e) { W.sig = { err: e.message }; }
  W.sigBusy = false; if (W.lt === "screen" && (W.scrG === "sig" || W.scrG === "kline")) renderList();
}
const sgWin = v => (v == null ? "—" : `${Math.round(v * 100)}%`), sgEnough = (J, s) => !!s && s.n >= (J.minN || SIG_MIN_N);
// K 線格子下面的一行小字：資料檔有這個條件、20 天樣本夠才顯示。數字都是「買進持有」的結果，所以不寫「勝率」（看空型態會被看反）
function sgBadge(id) {
  const J = W.sig; if (!J) { if (!W.sigBusy && !W.off) setTimeout(sgLoad, 0); return ""; }
  const N = J.ns || SIG_NS, last = N[N.length - 1], s = (J.defs || []).find(x => x.id === id)?.stats?.[last];
  return sgEnough(J, s) ? `<small class="sgbadge">之後 ${last} 日：上漲機率 ${sgWin(s.win)}・贏大盤 ${qP(s.ex)}・${s.n} 筆</small>` : "";
}
function sgHtml() {
  const J = W.sig; if (!J && !W.sigBusy) setTimeout(sgLoad, 0);
  if (!J?.defs) return `<p class="note gnote">${W.off ? "需要部署到網站才有回測資料。" : J?.err ? "還沒有回測資料：每個交易日收盤後由排程用全市場日 K 計算，第一次跑完後就會出現。" : "載入中…"}</p>`;
  const N = J.ns || SIG_NS, n = N.includes(+store.get("watch:sign", 0)) ? +store.get("watch:sign", 0) : N[N.length - 1], last = N[N.length - 1], id = store.get("watch:sigid", ""), T = J.defs.find(x => x.id === id);
  // 排序看「型態準不準」：看多依贏大盤由高到低；看空的數字越低越準，所以反過來（獨立審查 R1）
  const key = x => { const s = x.stats?.[n]; return sgEnough(J, s) ? [1, s.ex == null ? -9 : x.side === "bear" ? -s.ex : s.ex] : [0, s?.n || 0]; };
  const L = [...J.defs].sort((a, b) => { const A = key(a), B = key(b); return B[0] - A[0] || B[1] - A[1]; });
  const bins = ["< −20%", "−20～−15", "−15～−10", "−10～−5", "−5～0", "0～5", "5～10", "10～15", "15～20", "≥ 20%"], hm = Math.max(1, ...(T?.hist || []));
  return `<p class="note gnote">${esc(J.from)}～${esc(J.to)}・${J.stocks} 檔上市櫃普通股。把過去每一次條件成立找出來：收盤後才知道訊號，所以一律隔天開盤買進、持有 ${n} 個交易日後收盤賣出，已扣手續費與證交稅（來回 ${((J.cost ?? SIG_COST) * 100).toFixed(3)}%）。贏大盤＝和同一天開盤等權買進全市場每一檔、持有到同一天賣出（同樣扣成本）比。排行依型態準不準：看多的贏大盤越高越前面，看空的越低越前面。</p>
    <div class="seg scrseg" role="group" aria-label="持有天數">${N.map(k => `<button data-sgn="${k}" aria-pressed="${k === n}">持有 ${k} 天</button>`).join("")}</div>
    <div class="ctbl sgwrap"><table class="evtbl sgtbl"><thead><tr><th>條件</th><th>樣本</th><th>平均報酬</th><th>上漲機率</th><th>贏大盤（平均）</th><th>贏大盤機率</th></tr></thead><tbody>
      ${L.map(x => { const s = x.stats?.[n], ok = sgEnough(J, s);
        return `<tr data-sgid="${esc(x.id)}"${x.id === id ? ' class="on"' : ""}><td><button class="linkbtn" data-sgid="${esc(x.id)}">${esc(x.name)}</button>${x.group === "kline" ? ` <small class="note sgside">${x.side === "bear" ? "看空" : "看多"}</small>` : ""}</td><td>${s?.n ?? 0}</td>${ok ? `<td class="${cls(s.avg)}">${qP(s.avg)}</td><td>${sgWin(s.win)}</td><td class="${cls(s.ex)}">${qP(s.ex)}</td><td>${sgWin(s.exWin)}</td>` : `<td colspan="4"><span class="note">樣本不足</span></td>`}</tr>`; }).join("")}</tbody></table></div>
    ${T ? `<section class="mk sgdetail"><h3>${esc(T.name)}<span class="note">${T.group === "kline" ? (T.side === "bear" ? "K 線組合・看空" : "K 線組合・看多") : "技術條件"}</span></h3>${T.desc ? `<p class="note">${esc(T.desc)}</p>` : ""}
      <div class="ctbl"><table class="evtbl"><thead><tr><th>持有</th><th>樣本</th><th>平均報酬</th><th>中位數</th><th>上漲機率</th><th>贏大盤（平均）</th><th>贏大盤機率</th></tr></thead><tbody>
        ${N.map(k => { const s = T.stats?.[k]; return `<tr><td>${k} 天</td><td>${s?.n ?? 0}</td><td class="${cls(s?.avg)}">${qP(s?.avg)}</td><td class="${cls(s?.med)}">${qP(s?.med)}</td><td>${sgWin(s?.win)}</td><td class="${cls(s?.ex)}">${qP(s?.ex)}</td><td>${sgWin(s?.exWin)}</td></tr>`; }).join("")}</tbody></table></div>
      ${sgEnough(J, T.stats?.[last]) ? "" : `<p class="note">樣本少於 ${J.minN || SIG_MIN_N} 筆，結果容易被少數股票左右，只能當參考。</p>`}
      <h4>${last} 天報酬分佈</h4><div class="evhist">${(T.hist || []).map((v, i) => `<div title="${bins[i]}：${v} 筆"><i class="${i < 5 ? "dn" : "upb"}" style="height:${(v / hm * 100).toFixed(0)}%"></i><small>${bins[i].replace("%", "")}</small></div>`).join("")}</div>
      ${T.recent?.length ? `<h4>最近出現的訊號</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>訊號日</th>${N.map(k => `<th>${k} 天</th>`).join("")}</tr></thead><tbody>
        ${T.recent.slice(0, 20).map(r => `<tr><td><button class="linkbtn" data-sel="${esc(r[0])}">${esc(r[1] || r[0])} ${esc(r[0])}</button></td><td>${esc(String(r[2]).slice(5).replace("-", "/"))}</td>${N.map((k, i) => `<td class="${cls(r[3 + i])}">${r[3 + i] == null ? `<span class="note">進行中</span>` : qP(r[3 + i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</section>` : `<p class="note gnote">點條件名稱看三種持有天數、報酬分佈與最近出現的股票。</p>`}
    <p class="note gnote">所有數字都是「買進後持有」的結果：看空的型態，上漲機率與贏大盤的數字越低，代表型態越準。只有最近約一年的資料，等於只看過一種行情；已下市的股票不在裡面；樣本少於 ${J.minN || SIG_MIN_N} 筆的不列機率。樣本數是訊號次數，不是互不相干的交易次數：同一檔相隔 ${SIG_GAP} 天以上就會再算一次，持有期間可能重疊，同一段行情也會讓很多檔同時出現訊號。過去表現不代表未來，不是投資建議。</p>`;
}
