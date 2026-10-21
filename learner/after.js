/* 「盤後」分頁：盤後資料選單（大盤法人、資券歷史，市值、籌碼、法人、資券、營收、股利等排行）。
   資料是 GitHub Actions 每個交易日收盤後整理好的 data/market/after.json（scripts/market-after.mjs），頁面只讀這個檔。
   用到 watch.html 的 W、esc、cls、renderList、setLt、barLineSvg、loadMktStats，analysis.js 的 signed，core.js 的 $、store。 */
const AF_MENU = [
  ["大盤", [["sum", "法人資料總表"], ["go:mkt", "大盤分析"], ["inst", "大盤三大法人買賣超金額"], ["margin", "大盤融資融券餘額"]]],
  ["排行", [["r:mcap", "市值排行"], ["r:chips", "籌碼總覽排行"], ["r:inst", "法人買賣超排行"], ["r:hold", "法人持股排行"], ["r:vs", "法人散戶對做"], ["r:ty", "土洋法人對做"], ["r:mg", "資券增減排行"], ["r:rev", "營收總表排行"], ["r:div", "股利總表排行"]]],
  ["ETF", [["go:etfann", "ETF 績效（年化）排行"]]],
  ["籌碼", [["fr", "外資持股（類股比率、持股前 20 名、增減）"], ["chipx", "籌碼動向（千張大戶、借券、當沖、Put/Call）"]]],
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
const afView = () => { const v = (W.afView ||= store.get("watch:af", "menu")); return v === "track" ? (W.afView = "menu") : v; };
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
  $("#lTools").innerHTML = rankHub() + `<span class="note">${A?.date ? `盤後資料・${A.date.replace(/-/g, "/")}` : "盤後資料"}</span>`;
  let h = "";
  if (v === "menu") {
    h = AF_MENU.map(([g, L]) => `<h3 class="afgrp">${g}</h3><ul class="afmenu">${L.map(([k, t]) => `<li><button data-af="${k}">${t}<span>›</span></button></li>`).join("")}</ul>`).join("");
  } else if (v === "chipx") {
    h = afBack("籌碼動向") + chipxHtml(); // 籌碼動向原本在工具，跟盤後排行性質一樣，搬來這裡
  } else if (v === "fr") {
    h = afBack("外資持股", "證交所、櫃買中心") + afFrHtml();
  } else if (!A || A.err) {
    h = afBack("盤後資料") + `<p class="note" style="padding:12px">${A?.err ? "⚠ " + esc(A.err) : "載入中…"}</p>`;
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
    const items = H.map(x => ({ label: x.d.slice(5).replace("-", "/"), v: x.inst?.total ?? 0, y: null }));
    // 融資融券：融資餘額線＋每日增減柱、融券餘額柱（整段歷史）
    const HM = (A.hist || []).filter(x => x.margin), mgc = HM.length > 1 ? tsChart({ dates: HM.map(x => x.d), panels: [
      { h: 120, series: [{ name: "融資餘額(億)", vals: HM.map(x => x.margin.finBal ?? null), color: "var(--up)", wide: true }, { name: "融資增減(億)", vals: HM.map(x => x.margin.finChg ?? null), color: "var(--s1)", neg: "var(--down)", type: "bar", axis: "r" }] },
      { h: 100, series: [{ name: "融券餘額(張)", vals: HM.map(x => x.margin.shortBal ?? null), color: "var(--down)", type: "bar" }, { name: "融券增減(張)", vals: HM.map(x => x.margin.shortChg ?? null), color: "var(--s3)", axis: "r" }] }] }) : "";
    h = afBack(isI ? "大盤三大法人買賣超金額" : "大盤融資融券餘額", isI ? "上市・億元" : "上市") + (H.length ? `<div style="padding:0 8px">${isI ? barLineSvg(items, { fmtV: x => Math.round(x) }) : mgc}</div>` : "")
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
// 外資持股：證交所 MI_QFIIS_cat／MI_QFIIS_sort_20、櫃買 tpex_3insti_qfii_industry／tpex_3insti_qfii（經 /api/oapi）＋盤後資料的個股外資持股增減
const afKey = (r, re) => Object.keys(r || {}).find(k => re.test(k)), afNum = v => { const n = parseFloat(String(v ?? "").replace(/[,%\s]/g, "")); return Number.isFinite(n) ? n : null; };
async function afFrLoad() {
  if (W.off) return; W.afFr = { loading: true };
  const get = (src, p) => getJ(`/api/oapi?src=${src}&p=${encodeURIComponent(p)}&limit=60`).then(j => j.rows || []).catch(() => null);
  const [tc, tt, oc, ot] = await Promise.all([get("twse", "/fund/MI_QFIIS_cat"), get("twse", "/fund/MI_QFIIS_sort_20"), get("tpex", "/tpex_3insti_qfii_industry"), get("tpex", "/tpex_3insti_qfii")]);
  const cat = rows => { if (!rows?.length) return null; const kN = afKey(rows[0], /IndustryCat|Industry/), kP = afKey(rows[0], /^Percentage$|PercentageOfShares/), kC = afKey(rows[0], /^Numbers$|NumberOfCompanies/);
    return rows.map(r => ({ n: String(r[kN] ?? "").trim(), v: afNum(r[kP]), k: afNum(r[kC]) })).filter(x => x.n && x.v != null).sort((a, b) => b.v - a.v); };
  const top = rows => { if (!rows?.length) return null; const kC = afKey(rows[0], /^Code$|SecuritiesCompanyCode/), kN = afKey(rows[0], /^Name$|CompanyName/), kP = afKey(rows[0], /^SharesHeldPer$|PercentageOfSharesOC/), kL = afKey(rows[0], /^Upperlimit$|UpperLimit/i);
    return rows.map(r => ({ c: String(r[kC] ?? "").trim(), n: String(r[kN] ?? "").trim(), v: afNum(r[kP]), lim: afNum(r[kL]) })).filter(x => x.c && x.v != null).sort((a, b) => b.v - a.v).slice(0, 20); };
  W.afFr = { at: Date.now(), 上市: { cat: cat(tc), top: top(tt) }, 上櫃: { cat: cat(oc), top: top(ot) } };
  if (W.lt === "after" && afView() === "fr") renderList();
}
const afBars = (L, { max, fmt = v => v.toFixed(2) + "%", sel } = {}) => { const mx = max ?? Math.max(...L.map(x => Math.abs(x.v)), 1);
  return `<ul class="afbars">${L.map(x => `<li>${sel ? `<button class="linkbtn" data-sel="${esc(x.c)}">${esc(x.n || x.c)}<small>${esc(x.c)}</small></button>` : `<span>${esc(x.n)}${x.k ? `<small>${x.k} 家</small>` : ""}</span>`}<i class="${x.v < 0 ? "neg" : ""}" style="--w:${Math.min(100, Math.abs(x.v) / mx * 100).toFixed(1)}%"></i><b class="${x.cls || ""}">${fmt(x.v)}</b></li>`).join("")}</ul>`; };
function afFrHtml() {
  const F = W.afFr; if (!F || (!F.loading && Date.now() - F.at > 30 * 60e3)) setTimeout(afFrLoad, 0);
  const m = (W.afFrM ||= store.get("watch:affrm", "上市")), D = F?.[m], A = W.af;
  const seg = `<div class="cochips afchips">${["上市", "上櫃"].map(k => `<button data-affrm="${k}" aria-pressed="${m === k}">${k}</button>`).join("")}</div>`;
  // 個股外資持股增減（盤後資料：今天 vs 前一個交易日，百分點）
  let chg = "";
  if (A?.fr && A?.frPrev) { const L = Object.entries(A.fr).map(([c, v]) => ({ c, v: A.frPrev[c] != null ? +(v - A.frPrev[c]).toFixed(2) : null })).filter(x => x.v != null && x.v !== 0);
    const up = L.slice().sort((a, b) => b.v - a.v).slice(0, 10), dn = L.slice().sort((a, b) => a.v - b.v).slice(0, 10), nm = x => ({ ...x, n: nameOf(x.c), cls: cls(x.v) }), mx = Math.max(...[...up, ...dn].map(x => Math.abs(x.v)), 0.01), f = v => (v > 0 ? "+" : "") + v.toFixed(2);
    if (up.length) chg = `<h3 class="afgrp">上市櫃外資持股增加最多 <span class="note">${esc((A.frDate || "").replace(/-/g, "/"))} 比前一個交易日，百分點</span></h3>${afBars(up.map(nm), { max: mx, fmt: f, sel: 1 })}
      <h3 class="afgrp">上市櫃外資持股減少最多</h3>${afBars(dn.map(nm), { max: mx, fmt: f, sel: 1 })}`; }
  if (W.off) return seg + `<p class="note" style="padding:12px">需要部署到網站才有資料。</p>`;
  if (!D) return seg + `<p class="note" style="padding:12px">${F?.loading || !F ? "向證交所、櫃買中心抓資料…" : "⚠ 暫時拿不到外資持股資料"}</p>` + chg;
  return seg + (D.cat ? `<h3 class="afgrp">各類股外資持股比率 <span class="note">外資持有股數 ÷ 發行股數</span></h3>${afBars(D.cat, { max: 100 })}` : "")
    + (D.top ? `<h3 class="afgrp">外資持股比率前 20 名</h3>${afBars(D.top.map(x => ({ ...x, n: x.n || nameOf(x.c) })), { max: 100, sel: 1 })}` : "") + chg
    + `<p class="note" style="padding:4px 12px">類股與前 20 名來自證交所 MI_QFIIS、櫃買中心僑外資持股比例表（每個交易日更新）；增減來自盤後資料。點股票看個股的外資持股走勢。</p>`;
}
function afterInit() {
  $("#lx").addEventListener("click", e => {
    if (W.lt !== "after") return;
    const b = e.target.closest("[data-af]");
    if (b) { const k = b.dataset.af;
      if (k === "go:mkt") { setLt("mkt"); return; }
      if (k === "go:etfann") { W.etfCat = "ann"; store.set("watch:etf", "ann"); setLt("etf"); return; }
      W.afView = k; store.set("watch:af", k); renderList(); goY(0); return; }
    const fm = e.target.closest("[data-affrm]"); if (fm) { W.afFrM = fm.dataset.affrm; store.set("watch:affrm", W.afFrM); return renderList(); }
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
.aftbl:not(.afrank) td:first-child, .aftbl:not(.afrank) th:first-child, .afrank td:nth-child(2), .afrank th:nth-child(2) { position: sticky; left: 0; background: var(--surface, var(--bg)); z-index: 1; }
.afrank tr[data-sel] { cursor: pointer; } .afrank td small { display: block; font-size: 11px; color: var(--muted); } .afrank td small.up { color: var(--up); } .afrank td small.down { color: var(--down); }
.afnm b { font-weight: 500; }
.afbars { list-style: none; margin: 0 12px; padding: 0; } .afbars li { display: grid; grid-template-columns: minmax(0, 9em) minmax(0, 1fr) 4.6em; gap: 8px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.afbars li > span, .afbars li > button { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; } .afbars small { margin-left: 5px; font-size: 11px; color: var(--muted); }
.afbars i { height: 8px; border-radius: 4px; background: linear-gradient(90deg, var(--s3) var(--w), var(--surface-2) var(--w)); } .afbars i.neg { background: linear-gradient(90deg, var(--down) var(--w), var(--surface-2) var(--w)); }
.afbars b { font: 500 12.5px var(--font-num); text-align: right; } `;
  document.head.appendChild(css);
}
