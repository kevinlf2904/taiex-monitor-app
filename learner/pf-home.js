/* 投資組合總覽畫面（第 8 階段）：KLOverview 算，這裡畫。資料沿用 ledger-ui.js 的 lgAllocData（報價、匯率，10 分鐘內共用）與融資帳戶（mgLoad／mgPrices）。
   內容：總資產、今日損益、累積損益、現金比例、市場分布、主要持倉、風險狀態、資料更新時間；每一塊都可以點進對應的分頁看詳細。
   用到 watch.html 的 W、$、esc、nameOf、cls、skel、renderList；ledger-ui.js 的 pfSrcHtml、lgPerfLib、lgPerfData、lgViewSeg、lgToday、lgMoney、lgSgn、lgAllocData、lgIsEtf、alBars、mgLoad、mgPrices、mgLib；
   ledger.js 的 KLLedger；overview.js 的 KLOverview；margin.js 的 KLMargin（有融資帳戶時才載入）。 */
const HM_MKT = { tw: "台股", us: "美股", cash: "現金" };
// 持股市值走勢：和績效頁共用日 K（lgPerfData，10 分鐘內共用），perf.js、fx.js 用到時才載入。台股＋美股（每天的匯率換成台幣），不含現金
function hmTrendData(S) {
  if (typeof KLPerf === "undefined" || typeof KLFx === "undefined") { lgPerfLib().then(() => renderList(), () => { W.hmTrendErr = true; renderList(); }); return { busy: true }; }
  const P = lgPerfData(S); if (P.busy) return { busy: true };
  const R = KLPerf.buildPerf(S.transactions, { method: S.method, today: lgToday(), prices: P.prices || {} }), U = R.byCurrency?.USD, T = R.byCurrency?.TWD;
  if (U) { const F = KLFx.combine(R, P.fx || []); if (F.series?.length) return { series: F.series, fx: true, est: F.status === "estimated" }; return { series: T?.series || [], twOnly: true }; }
  return { series: T?.series || [], est: T?.status === "estimated" };
}
function hmTrend(D) {
  if (W.hmTrendErr) return `<p class="note">走勢需要的計算模組載入失敗，請重新整理。</p>`;
  if (D.busy) return `<p class="note">載入走勢（各持股的日 K）…</p>`;
  const from = new Date(Date.now() + 8 * 3600e3 - 365 * 864e5).toISOString().slice(0, 10), pts = (D.series || []).filter(x => x.d >= from && Number.isFinite(x.v));
  if (pts.length < 2) return `<p class="note">資料不夠畫走勢（至少要兩天的價格）。</p>`;
  const W0 = 600, H0 = 120, lo = Math.min(...pts.map(x => x.v)), hi = Math.max(...pts.map(x => x.v)), sp = hi - lo || 1, X = i => (i / (pts.length - 1)) * W0, Y = v => H0 - 6 - ((v - lo) / sp) * (H0 - 12);
  const path = pts.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x.v).toFixed(1)}`).join(" "), a = pts[0], b = pts[pts.length - 1];
  return `<svg class="hmtrend" viewBox="0 0 ${W0} ${H0}" preserveAspectRatio="none" role="img" aria-label="持股市值走勢：${esc(a.d)} ${lgMoney(a.v, "TWD")}，${esc(b.d)} ${lgMoney(b.v, "TWD")}"><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="hmtrax note"><span>${esc(a.d)}<br>${lgMoney(a.v, "TWD")}</span><span>最高 ${lgMoney(hi, "TWD")}<br>最低 ${lgMoney(lo, "TWD")}</span><span>${esc(b.d)}<br>${lgMoney(b.v, "TWD")}</span></div>
    <p class="note">持股市值（台幣，不含現金），最近一年、每天收盤價計算${D.fx ? "；美股用每天的美元兌台幣匯率換算" : ""}${D.twOnly ? "；⚠︎ 沒有匯率，只畫台股" : ""}${D.est ? "；部分資料是估算（看績效頁的說明）" : ""}。市值的變化包含買進、賣出，不等於報酬，報酬請看「績效」。</p>`;
}
function renderHomeView(S) {
  const head = lgViewSeg();
  if (W.off) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">需要部署到網站才有報價。</p>`);
  const L = KLLedger.buildLedger(S.transactions, { method: S.method, today: lgToday() }), open = L.positions.filter(p => p.open);
  if (!S.transactions.length) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">還沒有交易。到「交易紀錄」新增，或從現有庫存建立。</p>`);
  const X = open.length ? lgAllocData(open) : { busy: false, px: new Map(), fx: null };
  if (X.busy) return ($("#lx").innerHTML = head + skel(`載入 ${open.length} 檔的報價…`));
  // 融資帳戶：有資料才載入融資模組與擔保品報價
  const MG = mgLoad(); let margin = [], mgMeta = null;
  if (MG.accounts.length) {
    if (typeof KLMargin === "undefined") { mgLib().then(() => renderList(), () => {}); }
    else { const syms = [...new Set(MG.accounts.flatMap(a => (a.collateral || []).map(c => String(c.symbol).toUpperCase())))], P = mgPrices(syms); if (!P.busy) { margin = MG.accounts.map(a => KLMargin.analyze(a, P.px, lgToday())); mgMeta = P.meta || null; } }
  }
  const R = KLOverview.summarize(L, X.px, { fx: X.fx, today: lgToday(), txs: S.transactions, margin });
  const tile = (k, v, sub = "", c = "", go = "") => `<div class="pftile${go ? " hmgo" : ""}"${go ? ` data-lg="view" data-v="${go}" role="button" tabindex="0"` : ""}><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const pct = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`), w = v => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const T = R.today, C = R.cumulative;
  const tiles = [
    tile("總資產（台幣）", lgMoney(R.total, "TWD"), R.usdNotConverted ? `另有美股 US$${R.usdNotConverted.toLocaleString()} 沒有匯率，沒算進來` : `股票 ${lgMoney(R.stocks, "TWD")}${R.cash > 0 ? `＋現金 ${lgMoney(R.cash, "TWD")}` : R.cash < 0 ? `－負現金 ${lgMoney(-R.cash, "TWD")}` : ""}`, "", "alloc"),
    tile("今日損益", T ? lgSgn(T.pnl, "TWD") : "—", T ? `${pct(T.pct)}・${T.counted}/${T.of} 檔有今天報價` : "還沒有今天的報價", T ? cls(T.pnl) : ""),
    tile("累積損益", C.base == null ? "—" : lgSgn(C.base, "TWD"), C.base == null ? "沒有匯率，只能分開看" : C.atCurrentFx ? "美元用目前匯率換算；匯率拆解看績效" : "已實現＋未實現＋股息", C.base == null ? "" : cls(C.base), "perf"),
    tile("現金比例", w(R.cashShare), R.cash < 0 ? "現金是負的，可能漏記入金" : R.cash ? "交易紀錄裡的入金扣掉買賣" : "沒有記入出金，現金不計", "")].join("");
  const LV = { high: "⛔", warn: "⚠︎", info: "ⓘ" };
  const alertTxt = a => a.k === "single_concentration" ? `${esc(nameOf(a.symbol))} 一檔占 ${w(a.w)}` : a.k === "top5_concentration" ? `前五大合計 ${w(a.w)}` : a.k === "margin" ? `${esc(a.name || "融資")} 維持率 ${w(a.ratio)}（${{ near: "接近追繳線", call: "低於追繳線", liquidate: "低於處分線" }[a.state]}，試算）` : a.codes ? a.codes.map(c => esc(nameOf(c))).join("、") : "";
  const goOf = a => (a.k === "margin" ? "margin" : a.k.endsWith("concentration") ? "alloc" : "tx");
  const alerts = R.alerts.length ? `<ul class="hmalerts">${R.alerts.map(a => `<li class="hm-${a.level}"><button type="button" class="linkbtn" data-lg="view" data-v="${goOf(a)}">${LV[a.level]} ${esc(KLOverview.ALERT_LABEL[a.k])}：${alertTxt(a)}</button></li>`).join("")}</ul>` : `<p class="note">✓ 沒有需要注意的集中度或融資風險。</p>`;
  const top = R.top.length ? `<ul class="hmtop">${R.top.map(r => `<li><button type="button" class="row hmrow" data-sel="${esc(r.symbol)}"><span class="nm">${esc(nameOf(r.symbol))}<small class="note"> ${esc(r.symbol)}</small></span><span>${w(r.w)}</span><span>${r.valueBase == null ? "—" : lgMoney(r.valueBase, "TWD")}${r.estimated ? "<small class=\"note\">（成本估算）</small>" : ""}</span><span class="${cls(r.chgPct)}">${r.chgPct == null ? "—" : (r.chgPct > 0 ? "+" : "") + r.chgPct.toFixed(2) + "%"}</span></button></li>`).join("")}</ul>` : `<p class="note">目前沒有持股。</p>`;
  const upd = `報價 ${R.updated.quotesFrom ? (R.updated.quotesFrom === R.updated.quotesTo ? esc(R.updated.quotesFrom) : `${esc(R.updated.quotesFrom)}～${esc(R.updated.quotesTo)}`) : "—"}${R.updated.fx ? `・美元兌台幣 ${R.updated.fx.rate.toFixed(3)}（${esc(R.updated.fx.date || "")}，Yahoo 收盤中間價${X.fx?.kept ? "；這次沒拿到，沿用上一次的" : ""}）` : ""}・計算時間 ${new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16)}`;
  const iss = R.issues.filter(x => KLOverview.ISSUE_LABEL[x.k]).map(x => esc(KLOverview.ISSUE_LABEL[x.k])).join("；");
  $("#lx").innerHTML = head + `<section class="pfcard hmcard"><h4>投資組合總覽</h4><div class="pftiles">${tiles}</div>${iss ? `<p class="note lgwarn">⚠︎ ${iss}。</p>` : ""}
    <h5 class="pfh">風險狀態</h5>${alerts}
    <div class="algrid"><div><h5 class="pfh">市場分布</h5>${R.marketShare.length ? alBars(R.marketShare, g => HM_MKT[g] || esc(g)) : `<p class="note">—</p>`}</div>
      <div><h5 class="pfh">主要持倉<small class="note">（前五大，點一下看個股）</small></h5>${top}</div></div>
    <h5 class="pfh">持股市值走勢</h5>${hmTrend(hmTrendData(S))}
    ${pfSrcHtml(X.meta, "報價", false)}${mgMeta ? pfSrcHtml(mgMeta, "融資擔保品報價", false) : ""}
    <p class="note hmupd">資料時間：${upd}。報價的時間是行情時間，不是計算時間。</p>
    <div class="lgbar"><button type="button" class="btn sm" data-lg="pfreload">重新載入報價</button></div></section>`;
}
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".hmgo")) { e.preventDefault(); e.target.click(); } });
(function () {
  if (document.getElementById("hmcss")) return; const st = document.createElement("style"); st.id = "hmcss";
  st.textContent = `.hmgo{cursor:pointer}.hmgo:hover,.hmgo:focus-visible{outline:1px solid var(--line)}
.hmalerts{list-style:none;margin:0;padding:0}.hmalerts li{padding:2px 0;font-size:13px}.hmalerts .linkbtn{text-align:left}.hm-high .linkbtn,.hm-warn .linkbtn{color:var(--s1,#d98a0b)}
.hmtop{list-style:none;margin:0;padding:0}.hmrow{display:grid;grid-template-columns:minmax(0,1.4fr) 3.6em minmax(0,1fr) 4.6em;gap:6px;width:100%;text-align:left;font-size:12px;font-variant-numeric:tabular-nums;padding:4px 0}
.hmrow .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hmrow span:not(.nm){text-align:right}.hmupd{margin-top:8px}.hmtrend{display:block;width:100%;height:120px;margin-top:4px}.hmtrax{display:flex;justify-content:space-between;gap:8px;font-size:11px;font-variant-numeric:tabular-nums}.hmtrax span:nth-child(2){text-align:center}.hmtrax span:last-child{text-align:right}
@media (pointer:coarse){.hmcard .lgbar .btn,.hmalerts .linkbtn,.hmrow{min-height:44px;display:inline-flex;align-items:center}.hmrow{display:grid}}`;
  document.head.appendChild(st);
})();
