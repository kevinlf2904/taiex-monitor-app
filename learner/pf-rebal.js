/* 配置頁「目標配置與再平衡」區塊（投資研究第 2 批）：KLRebal 算，這裡畫。目標存在 kline:pf:targets:v1（寫入前檢查），只存在這個瀏覽器；
   雲端同步、備份檔會一起帶。不用 AI、不送資料到外部服務。費用用帳本的費用規則（KLLedger.estimateCosts）估算。
   用到 watch.html 的 W、$、esc、nameOf、store、toast、renderList；ledger-ui.js 的 lgMoney、lgIsEtf；ledger.js 的 KLLedger；rebal.js 的 KLRebal。 */
const RB_KEY = "pf:targets:v1"; // store 會加上 kline: 前綴
const rbLoad = () => { const s = store.get(RB_KEY, null); return s && s.v === 1 && s.targets && typeof s.targets === "object" ? s : { v: 1, targets: {}, band: 5 }; };
function rbSave(s) { const v = KLRebal.validateStore(s); if (!v.ok) return v; store.set(RB_KEY, { ...s, at: new Date().toISOString() }); return v; }
// open：未平倉部位；X：lgAllocData 的結果（px、fx）；cashB：帳本的現金（各幣別）
function rbSectionHtml(open, X, cashB) {
  const L = (W.lg ||= {}), st = rbLoad(), fx = X.fx?.rate ?? null;
  const tracked = Object.entries(cashB || {}).filter(([, v]) => v.tracked), cash = tracked.length ? tracked.reduce((s, [c, v]) => s + v.balance * (c === "USD" ? (fx || 0) : 1), 0) : null;
  const positions = open.map(p => ({ symbol: p.symbol, market: p.market, currency: p.currency, shares: p.shares, price: X.px.get(p.symbol)?.price ?? null, assetType: lgIsEtf(p.symbol) ? "etf" : "stock" }));
  const P = KLRebal.plan({ positions, fx, cash, targets: st.targets, band: st.band ?? 5, costs: t => KLLedger.estimateCosts(t) });
  const pct = v => (v == null ? "—" : (v * 100).toFixed(1) + "%"), has = Object.keys(st.targets).length > 0, AL = KLRebal.ACTION_LABEL;
  let body;
  if (L.rbEdit) {
    const inp = (k, v) => `<input type="number" inputmode="decimal" min="0" max="100" step="0.1" name="t_${esc(k)}" value="${v ?? ""}" aria-label="${esc(k === "CASH" ? "現金" : nameOf(k))} 目標百分比" placeholder="不設">`;
    body = `<form id="rbForm" class="rbform"><p class="note">每檔填目標占總資產的百分比；空白＝不設目標（這檔維持原樣，不買不賣）。現金可以不填，會是調整後剩下的。</p>
      <table class="altable rbtable"><thead><tr><th>持股</th><th>目前</th><th>目標 %</th></tr></thead><tbody>
      ${P.rows.map(r => `<tr><td>${esc(nameOf(r.symbol))} <small class="note">${esc(r.symbol)}</small></td><td>${pct(r.weight)}</td><td>${inp(r.symbol, st.targets[r.symbol])}</td></tr>`).join("")}
      <tr><td>現金</td><td>${P.total ? pct(P.cash / P.total) : "—"}</td><td>${inp("CASH", st.targets.CASH)}</td></tr></tbody></table>
      <label class="rbband">偏離多少才調整（百分點）<input type="number" inputmode="decimal" min="0" max="50" step="0.5" name="band" value="${st.band ?? 5}"></label>
      <div class="lgbar"><button type="submit" class="btn primary">儲存目標</button><button type="button" class="btn" data-rb="close">取消</button>${has ? `<button type="button" class="btn" data-rb="clear">清除全部目標</button>` : ""}</div></form>`;
  } else if (!has) body = `<p class="note">還沒設目標配置。設好每檔的目標比重後，這裡會算出偏離多少、要買賣多少股才回到目標。</p><div class="lgbar"><button type="button" class="btn sm primary" data-rb="edit">設定目標配置</button></div>`;
  else if (P.status === "invalid") body = `<p class="note">沒有可以計算的資產（持股都沒有報價、也沒有現金）。</p>`;
  else {
    const act = r => r.action === "buy" || r.action === "sell" ? `<b class="${r.action === "buy" ? "up" : "down"}">${AL[r.action]} ${r.tradeShares.toLocaleString()} 股</b>${r.lots ? `<small class="note">（${r.lots} 張${r.odd ? `＋${r.odd} 股` : ""}）</small>` : ""}<small class="note">約 ${lgMoney(r.grossBase, "TWD")}${r.costBase ? `・費稅 ${lgMoney(r.costBase, "TWD")}` : ""}</small>`
      : `<span class="note">${AL[r.action]}${r.reason === "within_band" ? "（在容許範圍內）" : r.reason === "less_than_one_share" ? "（差不到一股）" : ""}</span>`;
    body = `<div class="pftiles"><div class="pftile"><span>要買進</span><b>${lgMoney(P.buy, "TWD")}</b></div><div class="pftile"><span>要賣出（扣費稅）</span><b>${lgMoney(P.sell, "TWD")}</b></div>
      <div class="pftile"><span>費用與稅（估算）</span><b>${lgMoney(P.fees, "TWD")}</b></div><div class="pftile"><span>調整後現金</span><b class="${P.cashAfter < 0 ? "lgwarn" : ""}">${lgMoney(P.cashAfter, "TWD")}</b><small>${pct(P.cashWeightAfter)}${P.cashTarget != null ? `・目標 ${pct(P.cashTarget)}` : ""}</small></div></div>
      ${P.issues.length ? `<ul class="note lgwarn alissues">${P.issues.map(x => `<li>${esc(KLRebal.ISSUE_LABEL[x.k] || x.k)}${x.codes ? `：${x.codes.map(c => esc(nameOf(c))).join("、")}` : ""}${x.sum != null ? `（${x.sum}%）` : ""}${x.need != null ? `（還差 ${lgMoney(x.need, "TWD")}）` : ""}</li>`).join("")}</ul>` : ""}
      <ul class="rblist">${P.rows.map(r => `<li><div class="rbh"><span><b>${esc(nameOf(r.symbol))}</b> <small class="note">${esc(r.symbol)}</small></span><span class="rbw">目前 ${pct(r.weight)} → 目標 ${pct(r.target)}</span></div>
        <div class="rba">${act(r)}${r.weightAfter != null ? `<small class="note">調整後 ${pct(r.weightAfter)}</small>` : ""}</div></li>`).join("")}</ul>
      <div class="lgbar"><button type="button" class="btn sm" data-rb="edit">修改目標</button></div>`;
  }
  return `<section class="pfcard rbcard" data-nofold><h4>目標配置與再平衡<small class="note">（試算）</small></h4>${L.rbMsg ? `<p class="note lgmsg" role="status">${esc(L.rbMsg)}</p>` : ""}${body}
    <p class="note">用目前報價與匯率試算，股數取整數（台股可買零股；美股不假設券商支援碎股），費用依「交易紀錄」的費用規則估算。實際成交價會不同，也沒算市場衝擊；只是幫你看偏離多少，不是投資建議。目標只存在這個瀏覽器，有開雲端同步時會一起同步，備份檔也會帶。</p></section>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-rb]"); if (!b || typeof KLRebal === "undefined") return;
  const L = (W.lg ||= {}), a = b.dataset.rb; L.rbMsg = "";
  if (a === "edit") L.rbEdit = true; else if (a === "close") L.rbEdit = false;
  else if (a === "clear" && confirm("清除全部目標配置？（只刪這個試算的設定，不影響交易紀錄）")) { const r = rbSave({ v: 1, targets: {}, band: rbLoad().band ?? 5 }); L.rbEdit = false; L.rbMsg = r.ok ? "已清除目標配置。" : "清除失敗。"; }
  renderList();
});
document.addEventListener("submit", e => {
  if (e.target.id !== "rbForm") return; e.preventDefault();
  const L = (W.lg ||= {}), v = Object.fromEntries(new FormData(e.target)), targets = {};
  for (const [k, x] of Object.entries(v)) if (k.startsWith("t_") && String(x).trim() !== "") targets[k.slice(2)] = +x;
  const r = rbSave({ v: 1, targets, band: String(v.band).trim() === "" ? 5 : +v.band });
  if (!r.ok) { toast("沒有儲存：目標要是 0～100 的數字，容許範圍 0～50"); return; }
  L.rbEdit = false; L.rbMsg = "已儲存目標配置。"; renderList();
});
(function () {
  if (document.getElementById("rbcss")) return; const st = document.createElement("style"); st.id = "rbcss";
  st.textContent = `.rblist{list-style:none;margin:8px 0 0;padding:0}.rblist li{padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}.rbh{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.rbw{font-variant-numeric:tabular-nums;white-space:nowrap}.rba{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin-top:2px}.rbtable{width:100%}
.rbform .rbtable{min-width:0}.rbform input{width:6.5em;font:inherit}.rbband{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;margin:8px 0}@media (pointer:coarse){.btn[data-rb],.rbform .btn{min-height:44px}}`;
  document.head.appendChild(st);
})();
