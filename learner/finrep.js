/* 財報分析與財報下載：個股「財務 → 財報分析」（台股、美股）和情報局「財報」展開的公司都用這裡。
   台股用 /api/company（W.co：單季損益、資產負債、現金流、股利）＋/api/stockinfo（W.info：月營收、季 EPS）；美股用 /api/usinfo（W.usi：SEC 季報、Finnhub 指標、EPS 驚喜）。
   分析只用財報上的數字照公式算（成長、獲利能力、ROE、財務體質、現金流、配息），每一項標「優／中／弱」並寫出怎麼算、怎麼看；不是投資建議。
   下載：整理好的 CSV（Excel 直接開，中文不會亂碼）、官方財報 PDF（公開資訊觀測站電子書）或 SEC EDGAR 申報。
   用到 watch.html 的 W、esc、getJ、dlBlob、renderList，stockx.js 的 SX、sxC、sxI、sxLoad、sxH、usWait。 */
const frSum = (a, k, n, from = 0) => { const L = a.slice(a.length - from - n, a.length - from); return L.length === n && L.every(x => x[k] != null) ? L.reduce((s, x) => s + x[k], 0) : null; };
const frChg = (a, b) => (a != null && b != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);
const frPctTxt = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const frGrade = (v, good, ok, inv = false) => (v == null ? null : (inv ? v <= good : v >= good) ? "優" : (inv ? v <= ok : v >= ok) ? "中" : "弱");
// 單季比率（%）和一年前同季比
function frMargin(Q, k) {
  const r = (x) => (x && x.rev && x[k] != null ? (x[k] / x.rev) * 100 : null), now = r(Q.at(-1)), ago = r(Q.at(-5));
  return { now, ago, d: now != null && ago != null ? now - ago : null };
}
function frMarginItem(name, M, what) {
  if (M.now == null) return null;
  return [name, `${M.now.toFixed(1)}%${M.ago != null ? `（一年前 ${M.ago.toFixed(1)}%）` : ""}`, M.d == null ? "中" : M.d >= 1 ? "優" : M.d > -1 ? "中" : "弱",
    `最新一季${what} ÷ 營收。和一年前同一季比${M.d == null ? "（資料不夠一年，無法比）" : M.d >= 1 ? "變好，產品組合或定價能力提升" : M.d > -1 ? "差不多" : "變差，要留意成本上升或價格競爭"}。`];
}
// 台股：損益（單季、元）、資產負債（季底）、現金流（單季）、股利、月營收
function frTW(C, I) {
  const Q = (C?.income || []).filter(x => x.rev != null), B = C?.balance || [], Cs = C?.cash || [], R = I?.revenue || [], F = I?.fin || [], out = [];
  const rev4 = frSum(Q, "rev", 4), rev4p = frSum(Q, "rev", 4, 4), rg = frChg(rev4, rev4p);
  if (rg != null) out.push(["營收成長", frPctTxt(rg), frGrade(rg, 10, 0), "近四季營收合計和前四季比。10% 以上算成長快，負的代表生意在縮小。"]);
  const R3 = R.slice(-3).filter(r => r.yoy != null), ry = R3.length === 3 ? R3.reduce((s, r) => s + r.yoy, 0) / 3 : null;
  if (ry != null) out.push(["月營收動能", frPctTxt(ry), frGrade(ry, 10, -5), `最近三個月（${R3[0].ym.replace("-", "/")}～${R3[2].ym.replace("-", "/")}）營收年增率平均，比季報早反映生意變化。`]);
  const EQ = Q.filter(x => x.eps != null).length >= 8 ? Q : F, eps4 = frSum(EQ, "eps", 4), eps4p = frSum(EQ, "eps", 4, 4), eg = eps4p != null && eps4p > 0 ? frChg(eps4, eps4p) : null;
  if (eps4 != null) out.push(["EPS 成長", `近四季 ${eps4.toFixed(2)} 元${eg != null ? `（${frPctTxt(eg)}）` : ""}`, eps4 <= 0 ? "弱" : eg == null ? "中" : frGrade(eg, 10, 0), "近四季每股盈餘合計和前四季比；虧損或衰退要先弄清楚原因（一次性損失還是本業變差）。"]);
  out.push(frMarginItem("毛利率", frMargin(Q, "gp"), "毛利"), frMarginItem("營業利益率", frMargin(Q, "op"), "營業利益"));
  const ni4 = frSum(Q, Q.every(x => x.nip != null) ? "nip" : "ni", 4), eqK = B.at(-1)?.parentEq != null ? "parentEq" : "equity", eqA = B.at(-1)?.[eqK], eqB = B.at(-5)?.[eqK] ?? B[0]?.[eqK];
  const roe = ni4 != null && eqA > 0 ? (ni4 / ((eqA + (eqB > 0 ? eqB : eqA)) / 2)) * 100 : null;
  if (roe != null) out.push(["ROE 股東權益報酬率", `${roe.toFixed(1)}%`, frGrade(roe, 15, 8), "近四季淨利 ÷ 平均股東權益：公司拿股東的錢一年賺幾 %。15% 以上很好，8% 以下偏低。"]);
  const b = B.at(-1), debt = b?.assets ? (b.liab / b.assets) * 100 : null, cr = b?.ca != null && b?.cl ? (b.ca / b.cl) * 100 : null;
  if (debt != null) out.push(["負債比", `${debt.toFixed(1)}%`, frGrade(debt, 50, 70, true), `總負債 ÷ 總資產（${b.q}）。50% 以下穩健；銀行、保險本來就靠負債營運，負債比 90% 以上是正常的。`]);
  if (cr != null) out.push(["流動比率", `${cr.toFixed(0)}%`, frGrade(cr, 150, 100), "流動資產 ÷ 流動負債：一年內能變現的資產夠不夠還一年內到期的債。100% 以下短期資金比較緊。"]);
  const ocf4 = frSum(Cs, "ocf", 4), q4 = frSum(Q, "ni", 4), fcf4 = frSum(Cs, "fcf", 4), cq = ocf4 != null && q4 > 0 ? ocf4 / q4 : null;
  if (cq != null) out.push(["獲利含金量", `${cq.toFixed(2)} 倍`, frGrade(cq, 1, 0.7), "近四季營業現金流 ÷ 淨利。大於 1 代表賺的是真的收到的現金；長期小於 1 要留意應收帳款、存貨堆積。"]);
  if (fcf4 != null) out.push(["自由現金流", frYi(fcf4), fcf4 > 0 ? "優" : "弱", "近四季營業現金流扣掉資本支出。正的才有餘力配息、還債；擴廠期間短暫為負不一定是壞事。"]);
  const dv = (C?.dividend || []).at(-1), payout = dv && eps4 > 0 ? (dv.cash / eps4) * 100 : null;
  if (payout != null) out.push(["配息率", `${payout.toFixed(0)}%`, payout > 100 ? "弱" : payout >= 30 ? "優" : "中", `最近一次現金股利 ${dv.cash} 元（${dv.y} 年度）÷ 近四季 EPS。超過 100% 代表配的比賺的多，難以持續。`]);
  return frWrap(out.filter(Boolean), Q.at(-1)?.q);
}
// 美股：SEC 季報（美元）＋Finnhub 指標（已是 %）
function frUS(U) {
  const Q = (U?.fin?.q || []).filter(x => x.rev != null), M = U?.metric || {}, E = (U?.earn || []).filter(x => x.surp != null), out = [];
  const rg = frChg(frSum(Q, "rev", 4), frSum(Q, "rev", 4, 4)) ?? M.revG ?? null;
  if (rg != null) out.push(["營收成長", frPctTxt(rg), frGrade(rg, 10, 0), "近四季營收和前四季比（季報不夠時用 Finnhub 的近四季年增）。"]);
  if (M.epsG != null) out.push(["EPS 成長", frPctTxt(M.epsG), frGrade(M.epsG, 10, 0), "近四季每股盈餘年增（Finnhub）。"]);
  const gm = frMargin(Q, "gp"), om = frMargin(Q, "op");
  out.push(gm.now != null ? frMarginItem("毛利率", gm, "毛利") : M.gm != null ? ["毛利率", `${(+M.gm).toFixed(1)}%`, "中", "近四季毛利 ÷ 營收（Finnhub）。"] : null);
  out.push(om.now != null ? frMarginItem("營業利益率", om, "營業利益") : M.om != null ? ["營業利益率", `${(+M.om).toFixed(1)}%`, "中", "近四季營業利益 ÷ 營收（Finnhub）。"] : null);
  if (M.roe != null) out.push(["ROE 股東權益報酬率", `${(+M.roe).toFixed(1)}%`, frGrade(M.roe, 15, 8), "近四季淨利 ÷ 股東權益。大量買回庫藏股的公司權益很小，ROE 會被放大。"]);
  if (M.de != null) out.push(["負債權益比", `${(+M.de).toFixed(2)} 倍`, frGrade(M.de, 1, 2, true), "總負債 ÷ 股東權益（Finnhub）。1 倍以下穩健；銀行、公用事業本來就高。"]);
  if (M.cr != null) out.push(["流動比率", `${(+M.cr).toFixed(2)} 倍`, frGrade(M.cr, 1.5, 1), "流動資產 ÷ 流動負債。1 倍以下短期資金比較緊（現金多的大公司例外）。"]);
  if (E.length) { const n = E.filter(x => x.surp > 0).length; out.push(["財報優於預期", `${n}／${E.length} 季`, n / E.length >= 0.75 ? "優" : n / E.length >= 0.5 ? "中" : "弱", "最近幾季 EPS 比分析師預估高的次數。常常優於預期代表公司財測保守、執行力好。"]); }
  return frWrap(out.filter(Boolean), Q.at(-1)?.p);
}
const frYi = v => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toLocaleString(undefined, { maximumFractionDigits: 1 })} 億` : `${Math.round(v / 1e4).toLocaleString()} 萬`);
function frWrap(items, q) {
  const n = g => items.filter(x => x[2] === g).length, good = n("優"), bad = n("弱");
  const tone = !items.length ? "" : good - bad >= 3 ? "財務體質偏強" : bad - good >= 2 ? "財務體質偏弱" : "財務體質普通";
  const pick = g => items.filter(x => x[2] === g).slice(0, 3).map(x => x[0]).join("、");
  const sum = items.length ? `${tone}（優 ${good} 項、弱 ${bad} 項）。${good ? `強項：${pick("優")}。` : ""}${bad ? `要留意：${pick("弱")}。` : ""}` : "";
  return { items, q, sum, tone };
}
// 畫面：總評＋每一項＋下載按鈕
function frView(A, c, us) {
  const dl = `<div class="frdl"><button type="button" class="btn sm" data-frdl="${esc(c)}">⬇ 下載財報 CSV</button>${frLinks(c, us)}</div>`;
  if (!A.items.length) return `<p class="note">財報資料不夠，無法分析。</p>${dl}`;
  return `<p class="frsum ${A.tone.includes("強") ? "up" : A.tone.includes("弱") ? "down" : ""}">${esc(A.sum)}</p>
    <ul class="frlist">${A.items.map(([k, v, g, t]) => `<li><span class="frg ${g === "優" ? "up" : g === "弱" ? "down" : "muted"}">${g}</span><b>${esc(k)}</b><span class="frv">${esc(v)}</span><small class="note">${esc(t)}</small></li>`).join("")}</ul>${dl}
    <p class="note">依${A.q ? ` ${esc(A.q)} 為止的` : ""}財報數字照公式計算，「優／中／弱」是一般經驗值，不同產業標準不同；只是整理，不是投資建議。</p>`;
}
function frLinks(c, us) {
  if (us) { const cik = W.usi?.code === c ? W.usi.cik : FR.us[c]?.cik;
    return `<a class="btn sm" target="_blank" rel="noopener" href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&${cik ? `CIK=${encodeURIComponent(cik)}` : `ticker=${encodeURIComponent(c)}`}&type=10-&dateb=&owner=include&count=40">SEC 申報（10-Q／10-K）↗</a>`; }
  const y = new Date().getFullYear() - 1911;
  return `<a class="btn sm" target="_blank" rel="noopener" href="https://doc.twse.com.tw/server-java/t57sb01?step=1&colorchg=1&co_id=${encodeURIComponent(c)}&year=${y}&mtype=A">官方財報 PDF ↗</a><a class="btn sm" target="_blank" rel="noopener" href="https://doc.twse.com.tw/server-java/t57sb01?step=1&colorchg=1&co_id=${encodeURIComponent(c)}&year=${y - 1}&mtype=A">去年 ↗</a>`;
}
// CSV：一個檔案分段放各張表，數字不加千分位，Excel 打開就能算
const frCell = v => (v == null ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100) : /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const frRows = (title, head, rows) => (rows.length ? [[title], head, ...rows, []] : []);
const frR = (a, b) => (a != null && b ? (a / b) * 100 : null);
function frCsv(c, us) {
  let L;
  if (us) { const U = W.usi?.code === c ? W.usi : FR.us[c], Q = U?.fin?.q || [], Y = U?.fin?.y || [], H = ["期間", "營收", "毛利", "營業利益", "淨利", "毛利率%", "淨利率%"], row = r => [r.p, r.rev, r.gp, r.op, r.ni, frR(r.gp, r.rev), frR(r.ni, r.rev)];
    L = [[`${c} 財報（單位：美元；來源：SEC EDGAR、Finnhub）`], [], ...frRows("單季損益", H, Q.map(row)), ...frRows("年度損益", H, Y.map(row)),
      ...frRows("EPS 實際與預估", ["年", "季", "實際 EPS", "預估 EPS", "驚喜%"], (U?.earn || []).map(x => [x.y, x.q, x.actual, x.est, x.surp])),
      ...frRows("指標（近四季）", ["項目", "數值"], Object.entries(U?.metric || {}).map(([k, v]) => [k, v]))]; }
  else { const C = W.co?.code === c ? W.co : FR.co[c], I = W.info?.code === c ? W.info : ER().tr[c];
    L = [[`${c} 財報（單位：新台幣元；來源：公開資訊觀測站、證交所）`], [],
      ...frRows("單季損益", ["季度", "營收", "毛利", "營業利益", "稅後淨利", "歸屬母公司淨利", "EPS", "毛利率%", "營益率%", "淨利率%"], (C?.income || []).map(r => [r.q, r.rev, r.gp, r.op, r.ni, r.nip, r.eps, frR(r.gp, r.rev), frR(r.op, r.rev), frR(r.ni, r.rev)])),
      ...frRows("資產負債（季底）", ["季度", "總資產", "總負債", "權益", "流動資產", "流動負債", "負債比%", "流動比率%"], (C?.balance || []).map(r => [r.q, r.assets, r.liab, r.equity, r.ca, r.cl, frR(r.liab, r.assets), frR(r.ca, r.cl)])),
      ...frRows("現金流（單季）", ["季度", "營業現金流", "投資現金流", "籌資現金流", "資本支出", "自由現金流"], (C?.cash || []).map(r => [r.q, r.ocf, r.icf, r.fin, r.capex, r.fcf])),
      ...frRows("月營收", ["年月", "營收", "月增%", "年增%"], (I?.revenue || []).map(r => [r.ym, r.rev, r.mom, r.yoy])),
      ...frRows("股利", ["股利所屬年度", "現金股利（元）", "股票股利（元）"], (C?.dividend || []).map(r => [r.y, r.cash, r.stock]))]; }
  return L.map(r => r.map(frCell).join(",")).join("\r\n");
}
const FR = { co: {}, us: {} };
function frDownload(c, us) {
  const csv = frCsv(c, us); if (csv.split("\r\n").length < 6) { toast("這檔還沒有可以下載的財報資料"); return; }
  dlBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `${c}-financials.csv`); toast("已下載財報 CSV（Excel 可以直接開）");
}
// 情報局「財報」展開的公司：美股直接用走勢圖已抓的 /api/usinfo；台股按了才抓 /api/company（次數有上限）
function frEarn(c, us, J) {
  if (us) { FR.us[c] = J; return `<h4>財報分析<span class="note">SEC 季報＋Finnhub 指標</span></h4>${frView(frUS(J), c, true)}`; }
  const C = FR.co[c];
  if (!C) return `<div class="frdl"><button type="button" class="btn sm" data-frco="${esc(c)}">財報分析與下載 ›</button></div>`;
  if (C.loading) return `<p class="note">載入損益表、資產負債表、現金流量表…</p>`;
  if (C.err || C.ok === false) return `<p class="note">⚠ ${esc(C.err || C.error || "拿不到財報")}</p>`;
  return `<h4>財報分析<span class="note">損益、資產負債、現金流</span></h4>${frView(frTW(C, J), c, false)}`;
}
async function frLoadCo(c) {
  if (FR.co[c] && !FR.co[c].err) return; FR.co[c] = { loading: true }; if (W.lt === "earn") renderList();
  try { FR.co[c] = await getJ(`/api/company?code=${encodeURIComponent(c)}`); } catch (e) { FR.co[c] = { err: e.message }; }
  if (W.lt === "earn") renderList();
}
Object.assign(SX, {
  fana: () => {
    if (isUSStk(W.sel)) { const w = usWait(); if (w) return w; return `<div class="tw-p">${sxH("財報分析", "SEC 季報＋Finnhub 指標")}${frView(frUS(W.usi), W.sel, true)}</div>`; }
    const C = sxC(), I = sxI(); if (!C) return sxLoad(W.co?.err);
    return `<div class="tw-p">${sxH("財報分析", "損益、資產負債、現金流、月營收")}${frView(frTW(C, I), W.sel, false)}</div>`;
  },
});
document.addEventListener("click", e => {
  const d = e.target.closest("[data-frdl]"); if (d) { e.stopPropagation(); return frDownload(d.dataset.frdl, !isTW(d.dataset.frdl)); }
  const b = e.target.closest("[data-frco]"); if (b) { e.stopPropagation(); frLoadCo(b.dataset.frco); }
}, true);
{ const css = document.createElement("style"); css.textContent = `.frsum { margin: 6px 0 8px; font-weight: 500; line-height: 1.5; }
.frlist { list-style: none; margin: 0; padding: 0; } .frlist li { display: grid; grid-template-columns: 2.2em minmax(0, 1fr) auto; gap: 2px 8px; align-items: baseline; padding: 7px 0; border-top: 1px solid var(--line); }
.frlist li:first-child { border-top: 0; } .frlist b { font-weight: 500; font-size: 14px; } .frlist .frv { font: 500 14px var(--font-num); text-align: right; white-space: nowrap; }
.frlist small { grid-column: 2 / -1; font-size: 12px; line-height: 1.45; } .frg { font-size: 12px; text-align: center; border-radius: 4px; padding: 1px 0; background: var(--surface-2); }
.frdl { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; } .frdl .btn { text-decoration: none; }
@media (max-width: 420px) { .frlist li { grid-template-columns: 2.2em minmax(0, 1fr); } .frlist .frv { grid-column: 2; text-align: left; } }`; document.head.appendChild(css); }
