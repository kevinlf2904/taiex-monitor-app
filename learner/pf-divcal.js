/* 投資組合「股利」分頁（投資研究第 6 批）：KLDivCal 算，這裡畫。未來 12 個月每個月大約領多少現金股利（台股）。
   資料：配息紀錄 /api/yield?hist=1（和庫存「已領股息」同一支，30 檔一批）；已公告的除權息 /api/calendar（和大盤行事曆、論點頁同一份）。
   不用 AI、不送持股資料到外部服務（只送代號查公開配息紀錄）、不存任何資料。
   用到 watch.html 的 W、$、esc、nameOf、getJ、renderList；ledger-ui.js 的 lgViewSeg、lgToday、lgMoney；ledger.js 的 KLLedger；divcal.js 的 KLDivCal。 */
const dvView = () => W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "div";
// 配息紀錄與已公告除權息：一次抓齊，分有資料／載入中／失敗；代號組合變了重抓，失敗 1 分鐘後自動重抓
function dvData(codes) {
  const key = codes.slice().sort().join(","), X = W.dvD;
  if (X && X.key === key && (X.busy || (X.ok && Date.now() - X.at < 30 * 60e3))) return X;
  if (X && X.key === key && X.fail && Date.now() - X.at < 60e3) { if (!W.dvT) W.dvT = setTimeout(() => { W.dvT = null; if (dvView()) renderList(); }, 60e3 - (Date.now() - X.at) + 500); return X; }
  W.dvD = { key, busy: true, at: Date.now() };
  const yields = (async () => { const hist = {}; for (let i = 0; i < codes.length; i += 30) { const j = await getJ(`/api/yield?codes=${codes.slice(i, i + 30).map(encodeURIComponent).join(",")}&hist=1`, true);
    (j?.rows || []).forEach(r => { hist[String(r.code).toUpperCase()] = r.divs || []; }); } return hist; })();
  const cal = W.cal?.rows ? Promise.resolve(W.cal) : getJ("/api/calendar", true).then(j => { if (j?.rows && !W.cal?.rows) W.cal = j; return j; }).catch(() => null);
  Promise.all([yields, cal]).then(([hist, c]) => { W.dvD = { key, ok: true, at: Date.now(), hist, cal: c?.rows || null }; })
    .catch(e => { W.dvD = { key, fail: true, msg: e.message || "", at: Date.now() }; }).finally(() => { if (dvView()) renderList(); });
  return W.dvD;
}
function renderDivView(S) {
  const head = lgViewSeg(), today = lgToday();
  const led = KLLedger.buildLedger(S.transactions, { method: S.method, today }), open = led.positions.filter(p => p.open);
  const tw = open.filter(p => p.market === "tw").map(p => p.symbol);
  if (!open.length) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">目前沒有持股。到「交易紀錄」新增買進後，這裡會預估未來 12 個月的股利。</p>`);
  if (!tw.length) return ($("#lx").innerHTML = head + `<section class="pfcard" data-nofold><h4>股利現金流</h4><p class="note">目前只有美股持股；美股的配息資料這裡還沒有，所以不估。</p></section>`);
  if (W.off) return ($("#lx").innerHTML = head + `<section class="pfcard" data-nofold><h4>股利現金流</h4><p class="note">需要部署到網站才能查配息紀錄。</p></section>`);
  const X = dvData(tw);
  if (X.busy) return ($("#lx").innerHTML = head + `<section class="pfcard" data-nofold><h4>股利現金流</h4>${skel("查持股的配息紀錄與除權息公告…", 3)}</section>`);
  if (X.fail) return ($("#lx").innerHTML = head + `<section class="pfcard" data-nofold><h4>股利現金流</h4><p class="note lgwarn" role="status">配息紀錄這次拿不到${X.msg ? `（${esc(X.msg)}）` : ""}，1 分鐘後自動再試。</p></section>`);
  const P = KLDivCal.plan({ positions: open.map(p => ({ symbol: p.symbol, market: p.market, shares: p.shares })), hist: X.hist, upcoming: X.cal || [], today });
  const m$ = v => lgMoney(v, "TWD"), mLab = m => `${m.slice(0, 4)}/${m.slice(5)}`, mx = Math.max(1, ...P.months.map(m => m.total));
  const tile = (k, v, sub = "") => `<div class="pftile"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = tile("未來 12 個月", m$(P.total), `已公告 ${m$(P.announced)}・預估 ${m$(P.est)}`) + tile("最多的月份", P.peak ? mLab(P.peak.month) : "—", P.peak ? m$(P.peak.total) : "")
    + tile("二代健保補充保費（估）", m$(P.nhi), "單次 ≥ 2 萬元扣 2.11%");
  const bars = `<ol class="dvbars" aria-label="每月股利">${P.months.map(m => `<li><span class="dvm">${mLab(m.month)}</span><span class="dvbar"><i style="width:${(m.total / mx * 100).toFixed(1)}%"></i></span><b>${m.total ? m$(m.total) : "—"}</b>${m.est ? `<small class="note">含預估</small>` : ""}</li>`).join("")}</ol>`;
  const ev = P.events.length ? `<ul class="dvev">${P.events.map(e => `<li><span class="dvd">${esc(e.date.slice(5).replace("-", "/"))}</span><button type="button" class="linkbtn" data-sel="${esc(e.code)}">${esc(nameOf(e.code))}</button>
      <span class="dvk dvk-${e.kind}">${e.kind === "announced" ? "已公告" : "預估"}</span><span class="dvamt">${m$(e.amount)}<small class="note">（每股 ${e.perShare} 元 × ${e.shares.toLocaleString()} 股${e.nhi ? `・健保 ${m$(e.nhi)}` : ""}）</small></span></li>`).join("")}</ul>`
    : `<p class="note">未來 12 個月沒有找到配息（持股過去 12 個月都沒有配息，也沒有公告）。</p>`;
  const miss = [P.noData.length && `沒有配息紀錄：${P.noData.map(c => esc(nameOf(c))).join("、")}`, P.skipped.length && `美股不估：${P.skipped.map(c => esc(nameOf(c))).join("、")}`, !X.cal && "除權息公告這次拿不到，全部用預估"].filter(Boolean);
  $("#lx").innerHTML = head + `<section class="pfcard" data-nofold><h4>股利現金流<small class="note">（未來 12 個月，台股）</small></h4><div class="pftiles">${tiles}</div>
    ${miss.length ? `<ul class="note lgwarn alissues">${miss.map(t => `<li>${t}</li>`).join("")}</ul>` : ""}
    <h5 class="pfh">每月</h5>${bars}<h5 class="pfh">每次配息</h5>${ev}
    <p class="note">已公告：除權息預告表的金額與除息日。預估：過去 12 個月每一次配息，照「明年同一天、同樣金額」往後推，不估成長或減少；同一檔 45 天內已經公告的就不再估。股數用今天持有的。依除息日排，實際入帳通常晚 3～6 週。只估現金股利；股票股利、所得稅另計。不是投資建議。</p></section>`;
}
(function () {
  if (document.getElementById("dvcss")) return; const st = document.createElement("style"); st.id = "dvcss";
  st.textContent = `.dvbars{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:4px}.dvbars .dvm{white-space:nowrap}.dvbars li{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content max-content;gap:8px;align-items:center;font-size:13px;font-variant-numeric:tabular-nums}
.dvbar{height:10px;background:var(--line);border-radius:3px;overflow:hidden}.dvbar i{display:block;height:100%;background:var(--accent);border-radius:3px}.dvbars li>small{min-width:3.5em}
.dvev{list-style:none;margin:0;padding:0}.dvev li{display:grid;grid-template-columns:max-content minmax(0,8em) auto minmax(0,1fr);gap:4px 8px;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--line);font-size:13px}
.dvd,.dvamt{font-variant-numeric:tabular-nums}.dvd{white-space:nowrap}.dvev .linkbtn{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvk{font-size:11px;padding:0 4px;border-radius:3px;border:1px solid var(--line);white-space:nowrap}
.dvamt small{margin-left:4px}
@media (max-width:560px){.dvbars li{grid-template-columns:max-content minmax(0,1fr) max-content}.dvbars li>small{display:none}.dvev li{grid-template-columns:max-content minmax(0,1fr) auto}.dvev li>.dvamt{grid-column:2/-1}}
@media (pointer:coarse){.dvev .linkbtn{min-height:44px}}`;
  document.head.appendChild(st);
})();
