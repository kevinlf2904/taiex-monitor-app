/* 投資組合報告（投資研究第 8 批）：一頁看完總資產、累積損益、市場分布、持股明細、投資論點與風險提醒，可以用瀏覽器列印或存成 PDF。
   總覽的數字用 KLOverview.summarize（和總覽頁同一口徑）；持股明細與論點摘要用 KLReport.build。報價和配置頁共用（lgAllocData）。
   不用 AI、不送資料到外部服務、不存任何資料；列印只在這台裝置上。
   用到 watch.html 的 W、$、esc、nameOf、store、skel、renderList；ledger-ui.js 的 lgViewSeg、lgToday、lgMoney、lgSgn、lgAllocData；ledger.js 的 KLLedger；overview.js、report.js、thesis.js。 */
function renderReportView(S) {
  const head = lgViewSeg(), today = lgToday(), back = `<button type="button" class="btn sm" data-lg="view" data-v="home">回總覽</button>`;
  if (W.off) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">需要部署到網站才有報價。</p>`);
  const L = KLLedger.buildLedger(S.transactions, { method: S.method, today }), open = L.positions.filter(p => p.open);
  if (!S.transactions.length) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">還沒有交易，沒有報告可以產生。</p><div class="lgbar">${back}</div>`);
  const X = open.length ? lgAllocData(open) : { busy: false, px: new Map(), fx: null };
  if (X.busy) return ($("#lx").innerHTML = head + skel(`載入 ${open.length} 檔的報價…`));
  const O = KLOverview.summarize(L, X.px, { fx: X.fx, today, txs: S.transactions, margin: [] }), fx = X.fx?.rate ?? null;
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
  const notes = [R.priceEst.length && `沒有報價、用成本估市值：${R.priceEst.map(c => esc(nameOf(c))).join("、")}`, R.noFx.length && `沒有匯率、沒換算成台幣：${R.noFx.map(c => esc(nameOf(c))).join("、")}`].filter(Boolean);
  $("#lx").innerHTML = head + `<div class="lgbar rptbar"><button type="button" class="btn sm primary" data-rpt="print">列印／存成 PDF</button>${back}</div>
  <article class="pfcard rpt" data-nofold><h4>投資組合報告<small class="note">（${esc(today)}）</small></h4>
    <div class="rptkv">${sum}</div><p class="rptmk">市場分布：${mk}${fx ? `・美元兌台幣 ${fx.toFixed(3)}` : ""}</p>
    ${notes.length ? `<ul class="note lgwarn">${notes.map(t => `<li>${t}</li>`).join("")}</ul>` : ""}
    <h5 class="pfh">持股明細</h5>${R.rows.length ? table : `<p class="note">目前沒有持股。</p>`}
    <h5 class="pfh">投資論點<small class="note">（寫了 ${T.written}/${T.of} 檔${T.due.length ? `，${T.due.length} 檔該檢視` : ""}）</small></h5>
    ${thList ? `<ul class="rptth">${thList}</ul>` : `<p class="note">還沒寫投資論點。</p>`}${T.missing.length ? `<p class="note">還沒寫：${T.missing.map(c => esc(nameOf(c))).join("、")}</p>` : ""}
    <h5 class="pfh">風險提醒</h5>${alerts}
    <p class="note">報價時間：${esc(O.updated.quotesTo || "—")}。總資產、累積損益和總覽頁同一口徑；未實現＝市值 − 持有成本（不含已實現與股息）。這份報告只在這台裝置產生，不會上傳；不是投資建議。</p></article>`;
}
document.addEventListener("click", e => { if (e.target.closest("[data-rpt=print]")) window.print(); });
(function () {
  if (document.getElementById("rptcss")) return; const st = document.createElement("style"); st.id = "rptcss";
  st.textContent = `.rptkv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;margin:4px 0 8px}.rptkv>div{display:grid;gap:2px}.rptkv span,.rptkv small{font-size:12px;color:var(--muted)}.rptkv b{font-size:18px;font-variant-numeric:tabular-nums}
.rptmk{font-size:13px;margin:0 0 8px}.rptwrap{overflow-x:auto}.rpttbl{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}.rpttbl th,.rpttbl td{padding:4px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}.rpttbl th:first-child,.rpttbl td:first-child,.rpttbl td:last-child,.rpttbl th:last-child{text-align:left}
.rptth{margin:0;padding-left:1.2em;font-size:13px}.rptth li{margin:2px 0;overflow-wrap:anywhere}
@media (pointer:coarse){.rptbar .btn{min-height:44px}}
@media print{body *{visibility:hidden}#lx .rpt,#lx .rpt *{visibility:visible}#lx .rpt{position:absolute;left:0;top:0;width:100%;margin:0;border:0;box-shadow:none;background:#fff;color:#000}
#lx .rpt .note,#lx .rpt small,#lx .rpt span{color:#333}#lx .rpt .up{color:#b00020}#lx .rpt .down{color:#006b2e}.rptwrap{overflow:visible}.rpttbl{font-size:11px}.rpttbl th,.rpttbl td{border-color:#999}}`;
  document.head.appendChild(st);
})();
