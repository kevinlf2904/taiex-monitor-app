/* 配置頁「壓力情境」區塊（投資研究第 7 批）：KLStress 算，這裡畫。選一個情境（或自訂），看整體資產（台幣）大約會變多少、哪幾檔影響最大。
   Beta：按「用日 K 算 Beta」才載入持股與大盤的日 K（和庫存「風險」頁同一套 portRisk，台股對加權指數、美股對 SPY）；還沒算之前全部用 1。
   不用 AI、不送持股資料到外部服務、不存任何資料（選的情境只留在這次開著的頁面）。
   用到 watch.html 的 W、$、esc、nameOf、dailyAdj、dailyFresh、renderList；quant.js 的 portRisk；ledger-ui.js 的 lgMoney、lgIsEtf；stress.js 的 KLStress。 */
const stView = () => W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "alloc";
// 每檔 Beta：按了才算；分台股、美股各自對自己的大盤
function stBetaLoad(open) {
  const key = open.map(p => p.symbol).sort().join(","); if (W.stB?.key === key && (W.stB.busy || W.stB.beta)) return;
  W.stB = { key, busy: true };
  const grp = m => open.filter(p => p.market === m).map(p => p.symbol), one = async (m, codes) => {
    if (!codes.length) return {}; const bench = m === "us" ? "SPY" : "T00";
    const all = await Promise.all([...codes, bench].map(c => (c === "T00" ? dailyFresh(c).then(D => D && { D }) : dailyAdj(c)).catch(() => null)));
    const B = all[codes.length]?.D; if (!B) throw new Error(m === "us" ? "SPY 日 K 拿不到" : "加權指數日 K 拿不到");
    const P = portRisk(codes.map((c, i) => ({ c, mv: 1, D: all[i]?.D || null })), B);
    return Object.fromEntries((P?.rows || []).filter(r => typeof r.beta === "number" && Number.isFinite(r.beta)).map(r => [r.c, r.beta]));
  };
  Promise.all([one("tw", grp("tw")), one("us", grp("us"))]).then(([a, b]) => { W.stB = { key, beta: { ...a, ...b }, at: Date.now() }; })
    .catch(e => { W.stB = { key, err: e.message || "拿不到" }; }).finally(() => { if (stView()) renderList(); });
}
function stSectionHtml(open, X, cashB) {
  const L = (W.lg ||= {}), fx = X.fx?.rate ?? null, key = open.map(p => p.symbol).sort().join(","), B = W.stB?.key === key ? W.stB : null;
  const ind = new Map((Array.isArray(W.stocks) ? W.stocks : []).map(r => [String(r[0]).toUpperCase(), r[3] || null]));
  const usdOk = !open.some(p => p.currency === "USD") || fx;
  const positions = open.map(p => { const q = X.px.get(p.symbol), v = (q ? p.shares * q.price : p.costBasis) * (p.currency === "USD" ? fx || 0 : 1);
    return { symbol: p.symbol, market: p.market, currency: p.currency, value: v, beta: B?.beta?.[p.symbol] ?? null, industry: lgIsEtf(p.symbol) ? null : ind.get(p.symbol) || null }; });
  const cash = { TWD: cashB?.TWD?.tracked ? cashB.TWD.balance : 0, USD: cashB?.USD?.tracked && fx ? cashB.USD.balance * fx : 0 };
  const inds = [...new Set(positions.map(p => p.industry).filter(Boolean))].sort();
  const sel = L.st || { k: "tw20" }, pre = KLStress.PRESETS.find(p => p.k === sel.k), industry = sel.industry && inds.includes(sel.industry) ? sel.industry : inds[0] || null;
  const s = sel.k === "custom" ? { tw: sel.tw ?? 0, us: sel.us ?? 0, fx: sel.fx ?? 0 } : pre ? { tw: pre.tw, us: pre.us, fx: pre.fx, ind: pre.ind || 0, industry: pre.ind ? industry : null } : { tw: -0.2 };
  const R = usdOk ? KLStress.run({ positions, cash, s }) : null, m$ = v => lgMoney(v, "TWD"), pc = v => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const seg = `<div class="stpre" role="group" aria-label="情境">${KLStress.PRESETS.map(p => `<button type="button" class="btn sm" data-pst="${p.k}" aria-pressed="${sel.k === p.k}">${esc(p.label)}</button>`).join("")}<button type="button" class="btn sm" data-pst="custom" aria-pressed="${sel.k === "custom"}">自訂</button></div>`;
  const indSel = pre?.ind ? (inds.length ? `<label class="stind">重挫的產業<select data-pst-ind>${inds.map(i => `<option ${i === industry ? "selected" : ""}>${esc(i)}</option>`).join("")}</select></label>` : `<p class="note">持股沒有產業資料（美股、ETF 不分產業），這個情境沒有影響。</p>`) : "";
  const v100 = v => (v == null ? "" : String(+(v * 100).toFixed(1)));
  const custom = sel.k === "custom" ? `<form id="stForm" class="stform"><label>台股大盤 %<input type="number" inputmode="decimal" step="0.5" min="-100" max="100" name="tw" value="${v100(sel.tw ?? 0)}"></label>
    <label>美股大盤 %<input type="number" inputmode="decimal" step="0.5" min="-100" max="100" name="us" value="${v100(sel.us ?? 0)}"></label><label>美元兌台幣 %<input type="number" inputmode="decimal" step="0.5" min="-50" max="50" name="fx" value="${v100(sel.fx ?? 0)}"></label>
    <button type="submit" class="btn sm primary">試算</button></form>` : "";
  const beta = B?.busy ? `<p class="note">載入持股與大盤的日 K、計算 Beta…</p>` : B?.err ? `<p class="note lgwarn">Beta 這次算不出來（${esc(B.err)}），先全部用 1。<button type="button" class="btn sm" data-pst="beta">再算一次</button></p>`
    : B?.beta ? `<p class="note">Beta 用近 120 個交易日的日報酬算（台股對加權指數、美股對 SPY）。</p>` : `<p class="note">目前每檔 Beta 都先用 1（和大盤同漲同跌）。<button type="button" class="btn sm" data-pst="beta">用日 K 算 Beta</button></p>`;
  let body;
  if (!R) body = `<p class="note lgwarn">有美股但沒有匯率，算不出台幣總值。</p>`;
  else if (R.status === "invalid") body = `<p class="note lgwarn">${R.reason === "bad_shock" ? "變動要在 −100%～+100% 之間（美元 −50%～+50%）。" : "沒有可以計算的資產。"}</p>`;
  else body = `<div class="pftiles"><div class="pftile"><span>目前總資產</span><b>${m$(R.before)}</b></div><div class="pftile"><span>情境下的變化</span><b class="${R.change < 0 ? "down" : R.change > 0 ? "up" : ""}">${R.change > 0 ? "+" : ""}${m$(R.change)}</b><small>${pc(R.pct)}</small></div>
      <div class="pftile"><span>情境下的總資產</span><b>${m$(R.after)}</b>${R.cashChange ? `<small>美元現金 ${R.cashChange > 0 ? "+" : ""}${m$(R.cashChange)}</small>` : ""}</div></div>
    ${R.noBeta.length && B?.beta ? `<p class="note lgwarn">算不出 Beta、用 1 的：${R.noBeta.map(c => esc(nameOf(c))).join("、")}</p>` : ""}
    <ul class="stlist">${R.rows.filter(r => r.change !== 0).slice(0, 10).map(r => `<li><span><b>${esc(nameOf(r.symbol))}</b> <small class="note">${esc(r.symbol)}${r.beta != null ? `・Beta ${r.beta}` : ""}${r.industryHit ? "・重挫產業" : ""}</small></span>
      <span class="stv"><b class="${r.change < 0 ? "down" : "up"}">${r.change > 0 ? "+" : ""}${m$(r.change)}</b><small class="note">價格 ${pc(r.price)}${r.fx ? `・匯率 ${pc(r.fx)}` : ""}</small></span></li>`).join("") || `<li class="note">這個情境對持股沒有影響。</li>`}</ul>`;
  return `<section class="pfcard stcard" data-nofold><h4>壓力情境<small class="note">（試算）</small></h4>${seg}${indSel}${custom}${beta}${body}
    <p class="note">每檔價格變動＝Beta × 大盤變動（＋屬於重挫產業時再加上產業變動，最多跌 100%）；美元資產換回台幣再乘上匯率變動。只是線性粗估：沒算相關性改變、流動性、融資追繳，不是預測，也不是投資建議。</p></section>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-pst]"); if (!b || typeof KLStress === "undefined") return;
  const L = (W.lg ||= {}), k = b.dataset.pst;
  if (k === "beta") { if (W.stB?.err) W.stB = null; const S = lgLoad(); if (S) stBetaLoad(KLLedger.buildLedger(S.transactions, { method: S.method, today: lgToday() }).positions.filter(p => p.open)); renderList(); return; }
  L.st = { ...(L.st || {}), k }; renderList();
});
document.addEventListener("change", e => { const t = e.target.closest("[data-pst-ind]"); if (!t) return; const L = (W.lg ||= {}); L.st = { ...(L.st || {}), industry: t.value }; renderList(); });
document.addEventListener("submit", e => {
  if (e.target.id !== "stForm") return; e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target)), f = x => (String(x).trim() === "" ? 0 : +x / 100), L = (W.lg ||= {});
  L.st = { ...(L.st || {}), k: "custom", tw: f(v.tw), us: f(v.us), fx: f(v.fx) }; renderList();
});
(function () {
  if (document.getElementById("stcss")) return; const st = document.createElement("style"); st.id = "stcss";
  st.textContent = `.stpre{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}#lx .stpre .btn{background:var(--surface-2);border:1px solid var(--line);border-radius:4px}#lx .stpre .btn[aria-pressed="true"]{border:2px solid var(--accent);font-weight:600}
.stind,.stform label{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:13px}.stind{margin:0 0 8px}.stform{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:0 0 8px}.stform input{width:6em;font:inherit}
.stlist{list-style:none;margin:8px 0 0;padding:0}.stlist li{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}.stv{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-variant-numeric:tabular-nums}
@media (pointer:coarse){.btn[data-pst],.stform .btn{min-height:44px}.stind select,.stform input{min-height:44px}}`;
  document.head.appendChild(st);
})();
