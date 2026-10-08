/* 「盤後」分頁：盤後資料選單（大盤法人、資券歷史，市值、籌碼、法人、資券、營收、股利等排行）。
   資料是 GitHub Actions 每個交易日收盤後整理好的 data/market/after.json（scripts/market-after.mjs），頁面只讀這個檔。
   用到 watch.html 的 W、esc、cls、renderList、setLt、barLineSvg、loadMktStats，analysis.js 的 signed，core.js 的 $、store。 */
const AF_MENU = [
  ["大盤", [["sum", "法人資料總表"], ["go:mkt", "大盤分析"], ["inst", "大盤三大法人買賣超金額"], ["margin", "大盤融資融券餘額"]]],
  ["排行", [["r:mcap", "市值排行"], ["r:chips", "籌碼總覽排行"], ["r:inst", "法人買賣超排行"], ["r:hold", "法人持股排行"], ["r:vs", "法人散戶對做"], ["r:ty", "土洋法人對做"], ["r:mg", "資券增減排行"], ["r:rev", "營收總表排行"], ["r:div", "股利總表排行"]]],
  ["ETF", [["go:etfann", "ETF 績效（年化）排行"]]],
  ["主力", [["track", "主力追蹤（券商分點勝率）"]]],
];
// 欄位：名稱、格式（n 張數帶正負號、y 億元、p 百分比、x 一般數字）
const AF_COLS = { cap: ["市值(億)", "y0"], v: ["成交(張)", "x"], f: ["外資", "n"], t: ["投信", "n"], d: ["自營", "n"], a: ["合計", "n"], mc: ["融資增減", "n"], sc: ["融券增減", "n"],
  fAmt: ["金額(億)", "ys"], tAmt: ["金額(億)", "ys"], dAmt: ["金額(億)", "ys"], aAmt: ["金額(億)", "ys"], fr: ["外資持股", "p"], frc: ["增減", "ps"], mb: ["融資餘額", "x"], sb: ["融券餘額", "x"], sr: ["券資比", "p"],
  rev: ["營收(億)", "y"], yoy: ["年增", "ps"], mom: ["月增", "ps"], cum: ["累計年增", "ps"], dy: ["殖利率", "p"], pe: ["本益比", "x2"], pb: ["淨值比", "x2"] };
function afFmt(v, f) {
  if (v == null) return ["—", ""];
  if (f === "n") return [signed(v), cls(v)];
  if (f === "ys") return [(v > 0 ? "+" : "") + v.toFixed(2), cls(v)];
  if (f === "y") return [v.toLocaleString(undefined, { maximumFractionDigits: 2 }), ""];
  if (f === "y0") return [Math.round(v).toLocaleString(), ""];
  if (f === "p") return [v.toFixed(2) + "%", ""];
  if (f === "ps") return [(v > 0 ? "+" : "") + v.toFixed(2) + "%", cls(v)];
  if (f === "x2") return [v.toFixed(2), ""];
  return [Math.round(v).toLocaleString(), ""];
}
const afView = () => (W.afView ||= store.get("watch:af", "menu"));
async function loadAfter(force = false) {
  if (W.afLoading || (!force && W.af && Date.now() - W.af.at < 10 * 60e3)) return;
  W.afLoading = true;
  try { const r = await fetch(`data/market/after.json?t=${Math.floor(Date.now() / 6e5)}`); if (!r.ok) throw new Error(r.status === 404 ? "盤後資料還沒產生（每個交易日 17:40 後由排程更新）" : `讀取失敗（${r.status}）`); W.af = { ...(await r.json()), at: Date.now() }; }
  catch (e) { W.af = { err: e.message, at: Date.now() }; }
  finally { W.afLoading = false; }
  if (W.lt === "after") renderList();
}
function afBack(title, sub = "") { return `<div class="afhead"><button class="btn sm" data-af="menu">‹ 盤後</button><b>${esc(title)}</b>${sub ? `<span class="note">${sub}</span>` : ""}</div>`; }
function renderAfter() {
  const A = W.af, v = afView(), box = $("#lx");
  $("#lTools").innerHTML = `<span class="note">${A?.date ? `盤後資料・${A.date.replace(/-/g, "/")}` : "盤後資料"}</span>`;
  let h = "";
  if (v === "menu") {
    h = AF_MENU.map(([g, L]) => `<h3 class="afgrp">${g}</h3><ul class="afmenu">${L.map(([k, t]) => `<li><button data-af="${k}">${t}<span>›</span></button></li>`).join("")}</ul>`).join("");
  } else if (!A || A.err) {
    h = afBack("盤後資料") + `<p class="note" style="padding:12px">${A?.err ? "⚠ " + esc(A.err) : "載入中…"}</p>`;
  } else if (v === "track") {
    h = afBack("主力追蹤") + `<div class="sxcard" style="margin:12px"><p>「勝率王、獲利王、報酬率王、主力王」是把<b>每一個券商分點、在每一檔股票</b>的買賣都記下來，模擬當沖、隔日沖、1 天到 1 季的損益，再排名。</p>
      <p class="note">這需要全市場、每天、每個分點的明細（證交所買賣日報表要輸入驗證碼，免費 API 拿不到；FinMind 要贊助會員，而且全市場一天就是數十萬筆，要另外架資料庫計算）。目前先不做，避免顯示不準的數字。</p>
      <p class="note">單一個股的分點進出、主力買賣超與集中度，請看個股頁「資訊 → 分點主力」。</p></div>`;
  } else if (v === "sum") {
    const H = A.hist || [], L = H.at(-1), s = (n, k) => H.slice(-n).reduce((t, x) => t + (x.inst?.[k] || 0), 0), M = W.mks;
    if (!M && !W.mksLoading) loadMktStats().then(() => { if (W.lt === "after") renderList(); });
    const yi = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);
    h = afBack("法人資料總表", L ? L.d.replace(/-/g, "/") : "") + `<div class="cotbl-wrap"><table class="tbl aftbl"><thead><tr><th>上市（億元）</th><th>今日</th><th>近 5 日</th><th>近 20 日</th></tr></thead><tbody>
      ${[["外資", "foreign"], ["投信", "trust"], ["自營商", "dealer"], ["合計", "total"]].map(([t, k]) => `<tr><td>${t}</td>${[L?.inst?.[k], s(5, k), s(20, k)].map(v => `<td class="${cls(v)}">${yi(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${L?.margin ? `<h3 class="afgrp">融資融券（上市）</h3><div class="d-kv sxkv"><div><span>融資餘額</span><b>${L.margin.finBal} 億</b></div><div><span>融資增減</span><b class="${cls(L.margin.finChg)}">${yi(L.margin.finChg)} 億</b></div><div><span>融券餘額</span><b>${L.margin.shortBal?.toLocaleString()} 張</b></div><div><span>融券增減</span><b class="${cls(L.margin.shortChg)}">${signed(L.margin.shortChg)} 張</b></div></div>` : ""}
      ${M?.futures?.rows ? `<h3 class="afgrp">期貨三大法人淨未平倉（口）<span class="note">${esc(M.futures.date || "")}</span></h3><div class="cotbl-wrap"><table class="tbl aftbl"><thead><tr><th></th><th>台指期</th><th>增減</th><th>小台</th><th>增減</th></tr></thead><tbody>${M.futures.rows.map(r => `<tr><td>${r.who}</td>${[r.tx, r.txChg, r.mtx, r.mtxChg].map(v => `<td class="${cls(v)}">${signed(v)}</td>`).join("")}</tr>`).join("")}${M.futures.retail ? `<tr><td>散戶（估）</td><td>—</td><td>—</td>${[M.futures.retail.mtx, M.futures.retail.mtxChg].map(v => `<td class="${cls(v)}">${signed(v)}</td>`).join("")}</tr>` : ""}</tbody></table></div>` : M?.err ? "" : `<p class="note" style="padding:0 12px">期貨法人載入中…</p>`}
      <p class="note" style="padding:0 12px">三大法人金額是證交所 BFI82U（只有上市）；期貨是期交所，散戶＝法人小台的反向（估算）。</p>`;
  } else if (v === "inst" || v === "margin") {
    const H = (A.hist || []).slice(-20), isI = v === "inst";
    const items = H.map(x => ({ label: x.d.slice(5).replace("-", "/"), v: isI ? x.inst?.total ?? 0 : x.margin?.finBal ?? 0, y: isI ? null : null }));
    h = afBack(isI ? "大盤三大法人買賣超金額" : "大盤融資融券餘額", isI ? "上市・億元" : "上市") + (H.length ? `<div style="padding:0 8px">${barLineSvg(items, { fmtV: x => Math.round(x) })}</div>` : "")
      + `<div class="cotbl-wrap"><table class="tbl aftbl"><thead><tr><th>日期</th>${isI ? "<th>外資</th><th>投信</th><th>自營商</th><th>合計</th>" : "<th>融資餘額(億)</th><th>增減</th><th>融券(張)</th><th>增減</th>"}</tr></thead><tbody>
      ${[...H].reverse().map(x => `<tr><td>${x.d.slice(5).replace("-", "/")}</td>${isI ? ["foreign", "trust", "dealer", "total"].map(k => { const n = x.inst?.[k]; return `<td class="${cls(n)}">${n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(2)}</td>`; }).join("")
        : `<td>${x.margin?.finBal ?? "—"}</td><td class="${cls(x.margin?.finChg)}">${x.margin?.finChg == null ? "—" : (x.margin.finChg > 0 ? "+" : "") + x.margin.finChg.toFixed(2)}</td><td>${x.margin?.shortBal?.toLocaleString() ?? "—"}</td><td class="${cls(x.margin?.shortChg)}">${signed(x.margin?.shortChg)}</td>`}</tr>`).join("")}</tbody></table></div>`;
  } else if (v.startsWith("r:")) {
    const R = (A.ranks || []).find(r => r.id === v.slice(2));
    if (!R) h = afBack("排行") + `<p class="note" style="padding:12px">這個排行今天沒有資料。</p>`;
    else {
      const ti = (W.afTab ||= {})[R.id] || R.tabs[0].id, T = R.tabs.find(t => t.id === ti) || R.tabs[0];
      h = afBack(R.title, A.date.replace(/-/g, "/")) + `<div class="cochips afchips">${R.tabs.map(t => `<button data-aft="${R.id}:${t.id}" aria-pressed="${t.id === T.id}">${esc(t.t)}</button>`).join("")}</div>
        <div class="cotbl-wrap"><table class="tbl aftbl afrank"><thead><tr><th>#</th><th>股票</th><th>收盤</th>${T.keys.map(k => `<th>${AF_COLS[k]?.[0] || k}</th>`).join("")}</tr></thead><tbody>
        ${T.rows.map((r, i) => `<tr data-sel="${esc(r.c)}"><td class="note">${i + 1}</td><td class="afnm"><b>${esc(r.n || r.c)}</b><small>${esc(r.c)}${r.m === "櫃" ? "・櫃" : ""}</small></td><td><b>${r.p ?? "—"}</b><small class="${cls(r.pct)}">${r.pct == null ? "" : (r.pct > 0 ? "+" : "") + r.pct.toFixed(2) + "%"}</small></td>${T.keys.map(k => { const [s, c] = afFmt(r[k], AF_COLS[k]?.[1]); return `<td class="${c}">${s}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="note" style="padding:4px 12px">${esc(R.desc || "")}。點股票看個股。</p>`;
    }
  }
  box.innerHTML = `<div class="after">${h}</div>`;
  return A?.updated ? `資料：證交所、櫃買中心盤後資料，${new Date(A.updated).toLocaleString("zh-TW", { hour12: false })} 更新` : "";
}
function afterInit() {
  $("#lx").addEventListener("click", e => {
    if (W.lt !== "after") return;
    const b = e.target.closest("[data-af]");
    if (b) { const k = b.dataset.af;
      if (k === "go:mkt") { setLt("mkt"); return; }
      if (k === "go:etfann") { W.etfCat = "ann"; store.set("watch:etf", "ann"); setLt("etf"); return; }
      W.afView = k; store.set("watch:af", k); renderList(); scrollTo({ top: 0 }); return; }
    const t = e.target.closest("[data-aft]"); if (t) { const [r, id] = t.dataset.aft.split(":"); (W.afTab ||= {})[r] = id; renderList(); }
  });
  const css = document.createElement("style"); css.textContent = `
.after { padding-bottom: 16px; } .afgrp { margin: 14px 12px 6px; font-size: 13px; font-weight: 500; color: var(--muted); }
.afmenu { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); } .afmenu li { border-bottom: 1px solid var(--line); }
.afmenu button { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 14px 12px; background: none; border: 0; color: var(--ink); font: inherit; font-size: 16px; text-align: left; cursor: pointer; }
.afmenu button span { color: var(--muted); } .afmenu button:hover { background: var(--hover, rgba(127,127,127,.08)); }
.afhead { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex-wrap: wrap; } .afhead b { font-size: 16px; font-weight: 500; }
.afchips { padding: 0 12px 8px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; } .afchips button { white-space: nowrap; flex-shrink: 0; }
.aftbl { width: 100%; font-size: 13px; } .aftbl td, .aftbl th { white-space: nowrap; text-align: right; } .aftbl td:first-child, .aftbl th:first-child, .afrank td:nth-child(2), .afrank th:nth-child(2) { text-align: left; }
.afrank tr[data-sel] { cursor: pointer; } .afrank td small { display: block; font-size: 11px; color: var(--muted); } .afrank td small.up { color: var(--up); } .afrank td small.down { color: var(--down); }
.afnm b { font-weight: 500; } `;
  document.head.appendChild(css);
}
