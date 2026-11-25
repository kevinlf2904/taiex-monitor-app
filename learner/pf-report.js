/* 投資組合報告（投資研究第 8 批）：一頁看完總資產、累積損益、市場分布、持股明細、投資論點與風險提醒，可以用瀏覽器列印或存成 PDF。
   總覽的數字用 KLOverview.summarize（和總覽頁同一口徑）；持股明細與論點摘要用 KLReport.build。報價和配置頁共用（lgAllocData）。
   不用 AI、不送資料到外部服務、不存任何資料；列印只在這台裝置上。
   用到 watch.html 的 W、$、esc、nameOf、store、skel、renderList、dlBlob；taxrpt.js 的 KLTaxRpt（年度報稅彙整）；ledger-ui.js 的 lgViewSeg、lgToday、lgMoney、lgSgn、lgAllocData；ledger.js 的 KLLedger；overview.js、report.js、thesis.js。 */
function renderReportView(S) {
  const head = lgViewSeg(), today = lgToday(), back = `<button type="button" class="btn sm" data-lg="view" data-v="home">回總覽</button>`;
  if (W.off) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">需要部署到網站才有報價。</p>`);
  const recon = typeof lgReconLoad === "function" ? lgReconLoad() : null;
  const L = KLLedger.buildReconciledLedger(S, recon, { method: S.method, today }), open = L.positions.filter(p => p.open);
  const reconAlert = typeof lgReconAlertHtml === "function" ? lgReconAlertHtml(recon, L) : "";
  const reconPrintAlert = typeof lgReconAlertHtml === "function" ? lgReconAlertHtml(recon, L, { noButton: true }) : "";
  if (!S.transactions.length && !L.reconcile?.hasSnapshot && !(L.reconcile?.openConflicts?.length)) return ($("#lx").innerHTML = head + reconAlert + `<p class="note" style="padding:12px">還沒有交易，沒有報告可以產生。</p><div class="lgbar">${back}</div>`);
  const X = open.length ? lgAllocData(open) : { busy: false, px: new Map(), fx: null };
  if (X.busy) return ($("#lx").innerHTML = head + reconAlert + skel(`載入 ${open.length} 檔的報價…`));
  const O = KLOverview.summarize(L, X.px, { fx: X.fx, today, txs: S.transactions, margin: [], recon }), fx = X.fx?.rate ?? null;
  const th = store.get("pf:thesis:v1", null), cashT = Object.entries(L.cash || {}).filter(([, v]) => v.tracked), cash = cashT.length ? cashT.reduce((s, [c, v]) => s + v.balance * (c === "USD" ? fx || 0 : 1), 0) : null;
  const R = KLReport.build({ positions: open, px: X.px, fx, cash, thesis: th && th.v === 1 ? th : null, today });
  const m$ = v => (v == null ? "—" : lgMoney(v, "TWD")), w = v => (v == null ? "—" : (v * 100).toFixed(1) + "%"), pc = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`), n = v => (v == null ? "—" : (+v.toFixed(2)).toLocaleString());
  const SL = KLThesis.STATUS_LABEL, MK = { tw: "台股", us: "美股", cash: "現金" };
  const kv = (k, v, sub = "") => `<div><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const sum = kv("總資產（台幣）", m$(O.total), O.usdNotConverted ? `另有美股 US$${O.usdNotConverted.toLocaleString()} 沒有匯率` : "")
    + kv("累積損益", O.cumulative.base == null ? "—" : lgSgn(O.cumulative.base, "TWD"), O.cumulative.atCurrentFx ? "美元用目前匯率" : "已實現＋未實現＋股息")
    + kv("現金比例", w(O.cashShare)) + kv("持股檔數", String(R.rows.length));
  const mk = O.marketShare.length ? O.marketShare.map(x => `${MK[x.group] || esc(x.group)} ${w(x.w)}`).join("・") : "—";
  const table = `<div class="rptwrap"><table class="rpttbl"><thead><tr><th>持股</th><th>股數</th><th>均價</th><th>現價</th><th>市值（台幣）</th><th>比重</th><th>未實現</th><th>論點</th></tr></thead><tbody>
    ${R.rows.map(r => `<tr><td>${esc(nameOf(r.symbol))} <small class="note">${esc(r.symbol)}</small></td><td>${r.shares.toLocaleString()}</td><td>${n(r.avgCost)}</td><td>${r.price == null ? "—（用成本估）" : n(r.price)}${r.currency === "USD" ? " 美元" : ""}</td>
      <td>${m$(r.valueBase)}</td><td>${w(r.w)}</td><td class="${r.unreal > 0 ? "up" : r.unreal < 0 ? "down" : ""}">${r.unreal == null ? "—" : `${lgSgn(r.unreal, r.currency)}（${pc(r.unrealPct)}）`}</td>
      <td>${r.thesis ? `${SL[r.thesis.status] || ""}${r.thesis.due ? "・該檢視" : ""}` : "沒寫"}</td></tr>`).join("")}</tbody></table></div>`;
  const T = R.thesis, thList = R.rows.filter(r => r.thesis).map(r => `<li><b>${esc(nameOf(r.symbol))}</b>（${SL[r.thesis.status] || ""}${r.thesis.review ? `・下次檢視 ${esc(r.thesis.review)}${r.thesis.due ? "，已到期" : ""}` : ""}）${r.thesis.reason ? `：${esc(r.thesis.reason)}` : ""}</li>`).join("");
  const alerts = O.alerts.length ? `<ul class="rptth">${O.alerts.map(a => `<li>${esc(KLOverview.ALERT_LABEL[a.k] || a.k)}${a.symbol ? `：${esc(nameOf(a.symbol))} ${w(a.w)}` : a.k === "top5_concentration" ? `：${w(a.w)}` : a.codes ? `：${a.codes.map(c => esc(nameOf(c))).join("、")}` : ""}</li>`).join("")}</ul>` : `<p class="note">沒有需要注意的項目。</p>`;
  const snapNote = L.reconcile?.hasSnapshot ? `部分或全部持股以已確認庫存快照（${L.reconcile.snapshotCount} 檔基準）作為期初起算。` : "";
  const notes = [snapNote, R.priceEst.length && `沒有報價、用成本估市值：${R.priceEst.map(c => esc(nameOf(c))).join("、")}`, R.noFx.length && `沒有匯率、沒換算成台幣：${R.noFx.map(c => esc(nameOf(c))).join("、")}`].filter(Boolean);
  $("#lx").innerHTML = head + `${reconAlert}<div class="lgbar rptbar"><button type="button" class="btn sm primary" data-rpt="print">列印／存成 PDF</button>${back}</div>
  <article class="pfcard rpt" data-nofold><h4>投資組合報告<small class="note">（${esc(today)}）</small></h4>
    ${reconPrintAlert}
    <div class="rptkv">${sum}</div><p class="rptmk">市場分布：${mk}${fx ? `・美元兌台幣 ${fx.toFixed(3)}` : ""}</p>
    ${notes.length ? `<ul class="note lgwarn">${notes.map(t => `<li>${t}</li>`).join("")}</ul>` : ""}
    <h5 class="pfh">持股明細</h5>${R.rows.length ? table : `<p class="note">目前沒有持股。</p>`}
    <h5 class="pfh">投資論點<small class="note">（寫了 ${T.written}/${T.of} 檔${T.due.length ? `，${T.due.length} 檔該檢視` : ""}）</small></h5>
    ${thList ? `<ul class="rptth">${thList}</ul>` : `<p class="note">還沒寫投資論點。</p>`}${T.missing.length ? `<p class="note">還沒寫：${T.missing.map(c => esc(nameOf(c))).join("、")}</p>` : ""}
    <h5 class="pfh">風險提醒</h5>${alerts}
    ${rptTaxHtml(L, S.transactions, fx)}
    <p class="note">報價時間：${esc(O.updated.quotesTo || "—")}。總資產、累積損益和總覽頁同一口徑；未實現＝市值 − 持有成本（不含已實現與股息）。這份報告只在這台裝置產生，不會上傳；不是投資建議。</p></article>`;
}
/* 年度報稅彙整（KLTaxRpt）：預設前一年（五月申報的是前一年的所得）；只整理帳本有記的交易，不是報稅建議 */
function rptTaxYear(txs) { const Y = KLTaxRpt.years(txs), prev = String(+lgToday().slice(0, 4) - 1); return Y.includes(W.rptTaxY) ? W.rptTaxY : Y.includes(prev) ? prev : Y[0] || prev; }
function rptTaxHtml(L, txs, fx) {
  if (typeof KLTaxRpt === "undefined") return "";
  const Y = KLTaxRpt.years(txs), y = rptTaxYear(txs), R = KLTaxRpt.build({ L, txs, year: y, fx }); W.rptTax = { L, txs, fx, y };
  const tw = v => lgMoney(v, "TWD"), us = v => lgMoney(v, "USD"), sg = (v, c) => lgSgn(v, c), kv = (k, v, sub = "") => `<div><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const O = R.overseas;
  const body = R.empty ? `<p class="note">${esc(y)} 年沒有股利、賣出或手續費紀錄。</p>` : `
    <h6 class="rpttx-h">台股</h6><div class="rptkv">${kv("現金股利（總額）", tw(R.tw.divGross), `${R.tw.divN} 筆・已扣 ${tw(R.tw.divTax)}（多半是二代健保）`) + kv("已實現損益", sg(R.tw.realized, "TWD"), "證券交易所得目前停徵所得稅，只供對帳") + kv("手續費／證交稅", `${tw(R.tw.fees)}／${tw(R.tw.tradeTax)}`)}</div>
    <h6 class="rpttx-h">美股</h6><div class="rptkv">${kv("股息（總額）", us(R.us.divGross), `${R.us.divN} 筆・預扣 ${us(R.us.divTax)}`) + kv("已實現損益", sg(R.us.realized, "USD"), `獲利 ${us(R.us.gain)}・虧損 ${us(-R.us.loss)}（同年度可互抵）`) + kv("海外所得（估）", O.twd == null ? `${us(O.usd)}` : tw(O.twd), O.twd == null ? "沒有匯率，沒換算台幣" : O.over ? `超過 ${(O.min / 1e4).toLocaleString()} 萬：要計入基本所得額` : `未達 ${(O.min / 1e4).toLocaleString()} 萬：不用計入基本所得額`)}</div>
    ${R.nhiMiss.length ? `<p class="note lgwarn">單筆 2 萬元以上、帳本沒記扣款的台股股利：${R.nhiMiss.map(x => `${esc(nameOf(x.symbol))} ${esc(x.date.slice(5))} ${tw(x.amount)}（可能被扣 2.11%，約 ${tw(x.est)}）`).join("、")}。對一下入帳金額，有扣的話在交易的「稅」欄補上。</p>` : ""}
    ${R.rows.length ? `<div class="rptwrap"><table class="rpttbl rpttx-tbl"><thead><tr><th>股票</th><th>股利總額</th><th>已扣</th><th>已實現</th></tr></thead><tbody>${R.rows.map(r => `<tr><td>${esc(nameOf(r.symbol))} <small class="note">${esc(r.symbol)}</small></td><td>${r.divGross ? lgMoney(r.divGross, r.currency) : "—"}</td><td>${r.divTax ? lgMoney(r.divTax, r.currency) : "—"}</td><td class="${r.realized > 0 ? "up" : r.realized < 0 ? "down" : ""}">${r.realized ? sg(r.realized, r.currency) : "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  return `<h5 class="pfh">年度報稅彙整</h5>
    <div class="lgbar rpttx-bar">${Y.length > 1 ? `<span class="seg sm" role="group" aria-label="年度">${Y.slice(0, 6).map(v => `<button type="button" data-rpttx="${v}" aria-pressed="${v === y}">${v}</button>`).join("")}</span>` : `<span class="note">${esc(y)} 年</span>`}${R.empty ? "" : `<button type="button" class="btn sm" data-rpttx-csv>下載 CSV</button>`}</div>
    ${body}
    <p class="note">只整理帳本有記的交易：股利以交易金額為總額，「稅」欄當作已扣款；美股換算用目前匯率${fx ? `（${(+fx).toFixed(3)}）` : ""}，申報時依國稅局規定的匯率。最低稅負制的扣除額、股利所得合併或分開計稅請看存股頁的「實拿股息試算」與國稅局當年公告；扣繳憑單、券商對帳單才是申報依據，這裡不是報稅建議。</p>`;
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-rpt=print]")) return window.print();
  const y = e.target.closest("[data-rpttx]"); if (y) { W.rptTaxY = y.dataset.rpttx; return renderList(); }
  if (e.target.closest("[data-rpttx-csv]") && W.rptTax && typeof KLTaxRpt !== "undefined") { const T = W.rptTax, R = KLTaxRpt.build({ L: T.L, txs: T.txs, year: T.y, fx: T.fx }); dlBlob(new Blob([KLTaxRpt.toCSV(R, c => nameOf(c))], { type: "text/csv;charset=utf-8" }), `tax-summary-${T.y}.csv`); }
});
(function () {
  if (document.getElementById("rptcss")) return; const st = document.createElement("style"); st.id = "rptcss";
  st.textContent = `.rptkv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;margin:4px 0 8px}.rptkv>div{display:grid;gap:2px}.rptkv span,.rptkv small{font-size:12px;color:var(--muted)}.rptkv b{font-size:18px;font-variant-numeric:tabular-nums}
.rptmk{font-size:13px;margin:0 0 8px}.rptwrap{overflow-x:auto}.rpttbl{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}.rpttbl th,.rpttbl td{padding:4px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}.rpttbl th:first-child,.rpttbl td:first-child,.rpttbl td:last-child,.rpttbl th:last-child{text-align:left}
.rpttx-h{margin:8px 0 2px;font-size:13px;color:var(--muted)}.rpttx-bar{flex-wrap:wrap;gap:6px}
.rptth{margin:0;padding-left:1.2em;font-size:13px}.rptth li{margin:2px 0;overflow-wrap:anywhere}
@media (pointer:coarse){.rptbar .btn{min-height:44px}}
@media print{.rpttx-bar{display:none}body *{visibility:hidden}#lx .rpt,#lx .rpt *{visibility:visible}#lx .rpt{position:absolute;left:0;top:0;width:100%;margin:0;border:0;box-shadow:none;background:#fff;color:#000}
#lx .rpt .note,#lx .rpt small,#lx .rpt span{color:#333}#lx .rpt .up{color:#b00020}#lx .rpt .down{color:#006b2e}.rptwrap{overflow:visible}.rpttbl{font-size:11px}.rpttbl th,.rpttbl td{border-color:#999}}`;
  document.head.appendChild(st);
})();
