/* ================= 庫存「交易紀錄」（投資組合第 4 階段 B） =================
   計算全部在 ledger.js（KLLedger）；這裡只負責畫面與「使用者確認後才寫入」。
   存檔：kline:pf:v1 → { v: 1, method, transactions, migratedFrom?, at }。
     · 第一次使用：「從現有庫存建立」先顯示搬移預覽（哪幾筆會變成股票轉入、哪幾筆不搬與原因），按「確認建立」才寫入；也可以從空白開始。
     · 截圖匯入：選項 1「庫存／持股」匯入為 transfer_in（帳本目前已有部位預設不勾選略過以免重複）；選項 2「成交明細／對帳單」匯入為 buy／sell（保留分批成交、空白手續費／稅依規則估算、0 維持 0、同日／降冪順序正規化並擋下賣超）。
     · 舊的 kline:watch:hold 不刪、不改；即時損益、持股分析、風險三個分頁照舊用它（有交易紀錄時在記憶體切換，舊資料不動）。
     · 每次寫入前都跑 KLLedger.validateStore，有錯誤就不寫（不會留下壞資料）。
   新增、修改：先試算，錯誤（賣超、日期不對、幣別錯…）擋下並說明；提醒（估算費用、可能重複…）要再按一次確認。
   刪除：先算影響範圍（之後哪幾筆會變、會不會讓後面的賣出變成賣超），會出錯就不讓刪，否則確認後刪除。
   雲端同步、備份檔本來就包含所有 kline: 開頭的資料，新存檔會一起同步與備份。不輸出 console、不送到任何外部服務。
   用到 watch.html 的 W、$、esc、store、renderList、nameOf、toast、ico、loadStocks、findCode、lookupCode、verifyCodes、holdSrcApply、showImpDialog、closeImport、impSetLive、imp；ledger.js 的 KLLedger。 */
const LG_KEY = "pf:v1"; // store 會加 kline: 前綴
const lgToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const lgLoad = () => { const s = store.get(LG_KEY, null); return s && typeof s === "object" && !Array.isArray(s) ? s : null; };
// 寫入前一定檢查；有錯誤就不寫，回傳錯誤
function lgSave(s) {
  const v = KLLedger.validateStore(s, { today: lgToday() });
  if (!v.ok) return v;
  store.set(LG_KEY, s); if (typeof holdSrcApply === "function") holdSrcApply(); return v; // 庫存各分頁的持股跟著更新（at 是建立時間，不改）
}
const LG_FIELDS = { // 每種交易要填的欄位
  buy: ["symbol", "shares", "price", "fee", "tax"], sell: ["symbol", "shares", "price", "fee", "tax", "dayTrade"], dividend: ["symbol", "amount", "tax"],
  stock_dividend: ["symbol", "shares", "ratio"], split: ["symbol", "ratio"], fraction_cash: ["symbol", "shares", "amount", "fee"],
  transfer_in: ["symbol", "shares", "price", "fee"], transfer_out: ["symbol", "shares"], deposit: ["amount"], withdraw: ["amount"], fee: ["amount", "ref"], other: ["symbol", "shares", "amount"]
};
const LG_LABEL = { symbol: "代號", shares: "股數", price: "價格（每股）", fee: "手續費（空白＝估算）", tax: "交易稅（空白＝估算）", amount: "金額", ratio: "比例", ref: "對應交易", dayTrade: "現股當沖" };
const lgMkt = c => (/^\d{4,6}[A-Z]?$/.test(c) ? "tw" : /^[A-Z][A-Z0-9]{0,5}([.-][A-Z]{1,3})?$/.test(c) ? "us" : null);
const lgMoney = (v, cur) => { if (v == null) return "—"; const x = cur === "USD" ? Math.round(+v * 100) / 100 : Math.round(+v); return (cur === "USD" ? "US$" : "") + (x === 0 ? 0 : x).toLocaleString(undefined, cur === "USD" ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}); }; // 四捨五入後是 0 就顯示 0，不顯示 −0
const lgSgn = (v, cur) => (v == null ? "—" : (v > 0 ? "+" : "") + lgMoney(v, cur));
const lgN = v => (v == null ? "—" : (+v).toLocaleString(undefined, { maximumFractionDigits: 4 }));

// 交易紀錄、績效的市場切換：全部／台股／美股（W.lg.mkt，只在這次開啟有效、不存檔）；總覽、配置、融資本來就是看整個投資組合
const LG_MKT = [["all", "全部"], ["tw", "台股"], ["us", "美股"]];
const lgMktSel = () => W.lg?.mkt || "all";
const lgCurOk = c => { const m = lgMktSel(); return m === "all" || (m === "us" ? c === "USD" : c !== "USD"); };
const lgMktSeg = () => `<div class="seg lgmkt" role="group" aria-label="市場">${LG_MKT.map(([k, t]) => `<button type="button" data-lg="mkt" data-v="${k}" aria-pressed="${lgMktSel() === k}">${t}</button>`).join("")}</div>`;
function renderLedger() {
  const L = (W.lg ||= { open: null, form: null, prev: null, msg: "" });
  $("#wl").innerHTML = "";
  const hs = $("#holdSeg"); if (hs) hs.hidden = true; // 上方舊庫存的台股／美股切換對交易紀錄沒有作用：藏起來，改用各頁自己的「全部／台股／美股」
  const S = lgLoad(), hasTx = !!(S && Array.isArray(S.transactions) && S.transactions.length);
  if (L.view === "margin") return renderMargin(); // 融資不需要交易紀錄
  if (L.view === "alloc") {
    if (hasTx && !W.hsrcLegacy) return renderAlloc(S);
    const leg = lgLegacyOpen();
    if ((hasTx && W.hsrcLegacy) || leg.open.length || leg.skipped.length) return renderAllocLegacy(leg, hasTx);
  }
  if (!S) return ($("#lx").innerHTML = L.prev ? lgPreviewHtml(L.prev) : lgIntroHtml());
  if (!L.view || L.view === "home") return renderHome(S); // 總覽（預設）：畫面在 pf-home.js，用到時才載入
  if (L.view === "thesis") return renderThesis(S); // 投資論點與近期事件：thesis.js＋pf-thesis.js，用到時才載入
  if (L.view === "report") return renderReport(S); // 可列印的投資組合報告：report.js＋pf-report.js（＋論點狀態用 thesis.js），用到時才載入
  if (L.view === "div") return renderDiv(S); // 股利現金流：divcal.js＋pf-divcal.js，用到時才載入
  if (L.view === "perf") return renderPerf(S);
  if (L.view === "margin") return renderMargin();
  if (L.view === "alloc") return renderAlloc(S);
  const quotes = new Map([...W.quotes].map(([c, q]) => [c, q?.price]).filter(([, p]) => p > 0));
  const R = KLLedger.buildLedger(S.transactions, { method: S.method, today: lgToday(), prices: quotes });
  const cur = ["TWD", "USD"].filter(c => (R.totals[c] || R.cash[c]) && lgCurOk(c));
  const open = R.positions.filter(p => p.open && lgCurOk(p.currency)), closed = R.positions.filter(p => !p.open && lgCurOk(p.currency));
  const curBox = c => { const T = R.totals[c] || {}, C = R.cash[c], P = open.filter(p => p.currency === c), miss = P.filter(p => p.marketValue == null).length, un = P.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    return `<div class="lgcur"><h4>${c === "USD" ? "美股（美元）" : "台股（台幣）"}</h4><dl>
      <dt>未實現損益</dt><dd class="${cls(un)}">${!P.length ? "—" : miss === P.length ? `—<small class="note">（還沒有報價）</small>` : lgSgn(un, c) + (miss ? `<small class="note">（${miss} 檔缺價格，沒算進來）</small>` : "")}</dd>
      <dt>已實現損益</dt><dd class="${cls(T.realizedPnl)}">${lgSgn(T.realizedPnl || 0, c)}</dd><dt>股息（稅後）</dt><dd>${lgMoney(T.dividends || 0, c)}</dd>
      <dt>手續費</dt><dd>${lgMoney(T.fees || 0, c)}</dd><dt>稅</dt><dd>${lgMoney(T.taxes || 0, c)}</dd>
      ${C?.tracked ? `<dt>現金</dt><dd class="${C.negative ? "lgwarn" : ""}">${lgMoney(C.balance, c)}${C.negative ? "（負數：可能漏記入金）" : ""}</dd>` : ""}</dl></div>`; };
  const bad = R.txs.filter(x => x.errors.length), pend = R.positions.filter(p => p.pending.length);
  const posRow = p => { const o = L.open === p.symbol;
    return `<li class="lgpos${o ? " open" : ""}"><button type="button" class="row lgprow" data-lg="pos" data-c="${esc(p.symbol)}" aria-expanded="${o}">
      <span class="nm">${esc(nameOf(p.symbol))}<span class="cd">${esc(p.symbol)}</span></span>
      <span><b>${lgN(p.shares)}</b><small>均價 ${p.avgCost == null ? "—" : lgN(+p.avgCost.toFixed(4))}</small></span>
      <span><b class="${cls(p.unrealizedPnl)}">${lgSgn(p.unrealizedPnl, p.currency)}</b><small>已實現 ${lgSgn(p.realizedPnl, p.currency)}</small></span>
      <span><small>股息 ${lgMoney(p.dividends, p.currency)}</small>${p.pending.length ? `<small class="lgwarn">⚠︎ 待確認</small>` : ""}</span></button>
      ${o ? `<div class="lghist">${p.pending.map(x => `<p class="note lgwarn">⚠︎ ${esc(x.message)}（${lgN(x.shares)} 股）</p>`).join("")}<table><thead><tr><th>日期</th><th>交易</th><th>持股</th><th>平均成本</th><th>總成本</th><th>已實現</th></tr></thead><tbody>${p.history.map(h => `<tr><td>${h.date}</td><td>${KLLedger.TYPE_LABEL[h.type]}</td><td>${lgN(h.shares)}</td><td>${h.avgCost == null ? "—" : lgN(+h.avgCost.toFixed(4))}</td><td>${lgMoney(h.costBasis, p.currency)}</td><td>${h.realized == null ? "" : lgSgn(h.realized, p.currency)}</td></tr>`).join("")}</tbody></table>${p.lots ? `<p class="note">尚未賣出的批次（FIFO）：${p.lots.map(l => `${l.date} ${lgN(l.shares)} 股、成本 ${lgMoney(l.cost, p.currency)}`).join("；") || "無"}</p>` : ""}</div>` : ""}</li>`; };
  const txRow = x => { const t = x.tx || {}, c = t.currency, d = t.type;
    const what = ["buy", "sell", "transfer_in"].includes(d) ? `${lgN(t.shares)} 股 × ${lgN(t.price)}` : ["stock_dividend", "transfer_out"].includes(d) ? `${lgN(t.shares)} 股` : d === "split" ? `比例 ${lgN(t.ratio)}` : d === "fraction_cash" ? `${lgN(t.shares)} 股 → ${lgMoney(t.amount, c)}` : t.amount != null ? lgMoney(t.amount, c) : t.shares != null ? `${lgN(t.shares)} 股` : "";
    const fee = (t.fee || t.tax) ? `<small>費 ${lgMoney(t.fee, c)}・稅 ${lgMoney(t.tax, c)}${t.feeEstimated ? "（估算）" : ""}</small>` : "";
    const iss = [...x.errors.map(e => `<li class="lgwarn">✕ ${esc(e.message)}</li>`), ...x.warnings.filter(w => w.code !== "fee_estimated").map(w => `<li>⚠︎ ${esc(w.message)}</li>`)].join("");
    return `<li class="lgtx${x.errors.length ? " err" : ""}"><span class="lgd">${esc(t.date || "")}</span><span><b>${KLLedger.TYPE_LABEL[d] || esc(d)}</b> ${t.symbol ? `${esc(nameOf(t.symbol))} <small class="note">${esc(t.symbol)}</small>` : ""}${x.mergedInto ? `<small class="note">（併入對應交易）</small>` : ""}</span>
      <span>${what}${fee}</span><span class="lgact"><button type="button" class="btn sm" data-lg="edit" data-id="${esc(x.id)}">修改</button><button type="button" class="btn sm" data-lg="del" data-id="${esc(x.id)}">刪除</button></span>${iss ? `<ul class="lgiss">${iss}</ul>` : ""}</li>`; };
  // 錯誤、待確認的提醒不分市場都顯示（不能因為切換就藏起來）；清單只列選到的市場
  const txs = R.txs.filter(x => lgCurOk(x.tx?.currency || "TWD")).sort((a, b) => String(b.tx?.date).localeCompare(String(a.tx?.date)) || b.index - a.index);
  const mk = lgMktSel() === "all" ? "" : `，只顯示${lgMktSel() === "us" ? "美股" : "台股"}；全部 ${R.txs.length} 筆`;
  $("#lx").innerHTML = lgViewSeg() + `<div class="lgbar">${lgMktSeg()}<span>成本算法：<b>${R.methodLabel}</b></span><button type="button" class="btn sm" data-lg="method">改用${S.method === "fifo" ? "加權平均" : "先進先出"}</button><button type="button" class="btn sm primary" data-lg="add">＋ 新增交易</button><button type="button" class="btn sm" data-lg="imp">${typeof ico === "function" ? ico("cam") : ""}截圖匯入</button><button type="button" class="btn sm" data-lg="csv">⬇ 匯出 CSV</button></div>
    ${L.msg ? `<p class="note lgmsg" role="status">${esc(L.msg)}</p>` : ""}
    ${bad.length ? `<p class="note lgwarn">✕ ${bad.length} 筆交易有錯誤，沒有算進去（下面標紅色的），請修改或刪除。</p>` : ""}${pend.length ? `<p class="note lgwarn">⚠︎ ${pend.map(p => esc(nameOf(p.symbol))).join("、")} 合股後有不足一股的部分還沒結算，股數與成本是暫時的；請新增一筆「零股現金結算」。</p>` : ""}
    ${L.form ? lgFormHtml(L.form, S) : ""}
    <div class="lgcurs">${cur.map(curBox).join("") || `<p class="note">${lgMktSel() === "all" ? "還沒有交易。" : `沒有${lgMktSel() === "us" ? "美股" : "台股"}的交易。`}</p>`}</div>
    <p class="note">台幣和美元分開計算，不相加。未實現損益用目前報價；費用標「估算」的是依預設費率算的，實際以券商對帳單為準。${S.migratedFrom ? `由舊庫存建立於 ${esc(String(S.at || "").slice(0, 10))}；舊庫存資料仍保留。` : ""}</p>
    ${open.length ? `<h4 class="lgh">持有中（${open.length} 檔）</h4><ul class="lglist">${open.map(posRow).join("")}</ul>` : ""}
    ${closed.length ? `<h4 class="lgh">已出清（${closed.length} 檔）</h4><ul class="lglist">${closed.map(posRow).join("")}</ul>` : ""}
    <h4 class="lgh">交易紀錄（${txs.length} 筆${mk}）</h4><ul class="lglist lgtxs">${txs.map(txRow).join("") || `<li class="note">還沒有交易。</li>`}</ul>`;
}
function lgIntroHtml() {
  const n = Object.keys(W.hold || {}).length;
  return `<div class="lgintro"><h4>交易紀錄</h4><p class="note">記下每一筆買進、賣出、股息、配股、拆股、入金出金，系統會算出平均成本（或先進先出）、已實現損益、股息與費用。資料只存在這台裝置（有開雲端同步的話會一起同步）。</p>
    ${n ? `<button type="button" class="btn primary" data-lg="preview">從現有庫存建立（先預覽，不會馬上改動）</button>` : ""}<button type="button" class="btn" data-lg="imp">${typeof ico === "function" ? ico("cam") : ""}截圖匯入（持股／對帳單）</button><button type="button" class="btn" data-lg="blank">從空白開始</button>
    <p class="note">從現有庫存建立：每一檔變成一筆「股票轉入」，成本用你記的平均成本；舊的庫存資料會保留，不會刪除。</p></div>`;
}
function lgPreviewHtml(P) {
  const ok = P.items.filter(i => i.action === "migrate"), skip = P.items.filter(i => i.action !== "migrate");
  return `<div class="lgprev"><h4>搬移預覽</h4><p class="note">確認後才會建立交易紀錄；舊的庫存資料不會被改動或刪除。</p>
    <table><thead><tr><th>代號</th><th>結果</th><th>內容</th></tr></thead><tbody>${ok.map(i => `<tr><td>${esc(i.symbol)}</td><td>股票轉入</td><td>${esc(i.tx.date)}・${lgN(i.tx.shares)} 股・每股成本 ${lgN(i.tx.price)}${i.problems.length ? `<br><small class="lgwarn">⚠︎ ${esc(i.problems.map(p => p.message).join("；"))}</small>` : ""}</td></tr>`).join("")}
    ${skip.map(i => `<tr class="lgwarn"><td>${esc(i.symbol || i.key)}</td><td>不搬</td><td>${esc(i.problems.map(p => p.message).join("；"))}</td></tr>`).join("")}</tbody></table>
    <p class="note">共 ${ok.length} 筆會建立、${skip.length} 筆不搬。</p>
    <div class="lgbar"><label>成本算法 <select id="lgMethod"><option value="avg">加權平均成本</option><option value="fifo">先進先出（FIFO）</option></select></label>
    <button type="button" class="btn primary" data-lg="commit" ${ok.length && P.ok ? "" : "disabled"}>確認建立</button><button type="button" class="btn" data-lg="cancel">取消</button></div></div>`;
}
function lgFormHtml(F, S) {
  const type = F.type || "buy", fs = LG_FIELDS[type], v = F.v || {};
  const refOpts = S.transactions.filter(t => t.type === "buy" || t.type === "sell" || t.type === "dividend").map(t => `<option value="${esc(t.id)}" ${v.ref === t.id ? "selected" : ""}>${esc(t.date)} ${KLLedger.TYPE_LABEL[t.type]} ${esc(t.symbol || "")}</option>`).join("");
  const inp = k => k === "dayTrade" ? `<label class="chk"><input type="checkbox" name="dayTrade" ${v.dayTrade ? "checked" : ""}> ${LG_LABEL[k]}</label>`
    : k === "ref" ? `<label>${LG_LABEL[k]}<select name="ref"><option value="">（不指定）</option>${refOpts}</select></label>`
    : `<label>${LG_LABEL[k]}${k === "ratio" ? (type === "split" ? "（一拆四填 4，五合一填 0.2）" : "（配 1 元股票股利填 0.1，可空白）") : ""}<input name="${k}" ${k === "symbol" ? `autocapitalize="characters" value="${esc(v.symbol || "")}"` : `inputmode="decimal" value="${esc(v[k] ?? "")}"`}></label>`;
  return `<form class="lgform" id="lgForm"><h4>${F.id ? "修改交易" : "新增交易"}</h4>
    <label>類型<select name="type" id="lgType">${KLLedger.TYPES.map(t => `<option value="${t}" ${t === type ? "selected" : ""}>${KLLedger.TYPE_LABEL[t]}</option>`).join("")}</select></label>
    <label>日期<input type="date" name="date" value="${esc(v.date || lgToday())}" max="${lgToday()}"></label>
    ${fs.includes("symbol") ? "" : `<label>市場<select name="market"><option value="tw" ${v.market !== "us" ? "selected" : ""}>台股（台幣）</option><option value="us" ${v.market === "us" ? "selected" : ""}>美股（美元）</option></select></label>`}
    ${fs.map(inp).join("")}<label class="wide">備註<input name="note" maxlength="200" value="${esc(v.note || "")}"></label>
    ${F.err ? `<ul class="lgiss">${F.err.map(e => `<li class="lgwarn">✕ ${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="lgbar"><button type="submit" class="btn primary">${F.id ? "儲存修改" : "加入"}</button><button type="button" class="btn" data-lg="close">取消</button></div></form>`;
}
// 表單 → 交易（空白的數字欄位不帶，讓引擎估算費用；市場由代號判斷，沒有代號的交易用選的市場）
function lgFromForm(form, F) {
  const fd = new FormData(form), type = fd.get("type"), o = { type, date: fd.get("date"), note: String(fd.get("note") || "").trim(), source: "manual" };
  for (const k of LG_FIELDS[type]) { if (k === "dayTrade") { o.dayTrade = fd.get("dayTrade") === "on"; continue; } const s = String(fd.get(k) ?? "").trim(); if (!s) continue; o[k] = k === "symbol" ? s.toUpperCase() : k === "ref" ? s : Number(s.replace(/,/g, "")); }
  const m = o.symbol ? lgMkt(o.symbol) : fd.get("market") === "us" ? "us" : "tw";
  o.market = m; o.currency = m === "us" ? "USD" : m === "tw" ? "TWD" : null;
  return F.id ? { ...o, id: F.id, v: 1 } : KLLedger.makeTx(o); // 修改：整筆用表單的內容重建（換了類型時，舊類型的欄位不會留下來），編號不變
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-lg]"); if (!b || !document.getElementById("lx")?.contains(b)) return;
  const L = (W.lg ||= {}), a = b.dataset.lg; L.msg = "";
  if (a === "preview") L.prev = KLLedger.previewMigration(W.hold || {}, { today: lgToday(), now: new Date().toISOString() });
  else if (a === "cancel") L.prev = null;
  else if (a === "commit") { const P = L.prev; if (!P?.store) return; const s = { ...P.store, method: $("#lgMethod")?.value === "fifo" ? "fifo" : "avg" };
    const v = lgSave(s); if (!v.ok) { L.prev = null; L.msg = "建立失敗：資料檢查沒有通過，沒有寫入。"; } else { L.prev = null; L.view = "tx"; L.msg = `已建立交易紀錄（${s.transactions.length} 筆）。舊的庫存資料仍保留。`; } }
  else if (a === "blank") { const v = lgSave({ v: 1, method: "avg", transactions: [], at: new Date().toISOString() }); if (v.ok) { L.view = "tx"; L.msg = "已建立空白的交易紀錄。"; } }
  else if (a === "add") L.form = { type: "buy", v: { date: lgToday() } };
  else if (a === "imp") return lgOpenImport();
  else if (a === "close") L.form = null;
  else if (a === "view") { L.view = b.dataset.v; L.form = null; }
  else if (a === "hsrcLedger") { W.hsrcLegacy = false; if (typeof holdSrcApply === "function") holdSrcApply(); }
  else if (a === "range") L.pfRange = b.dataset.v;
  else if (a === "mkt") L.mkt = b.dataset.v;
  else if (a === "pfreload") { W.fresh = Date.now() + 15000; pfExpire(); } // 重新抓（不用本機快取），但先留著上一次的資料：抓失敗時才有東西可以沿用
  else if (a === "mgadd") L.mgForm = { v: {} };
  else if (a === "mgclose") L.mgForm = null;
  else if (a === "mgedit") { const A = mgLoad().accounts.find(x => x.id === b.dataset.id); if (A) L.mgForm = { id: A.id, v: A }; }
  else if (a === "mgdel") { const S2 = mgLoad(), A = S2.accounts.find(x => x.id === b.dataset.id); if (A && confirm(`刪除「${A.name || "帳戶"}」的融資資料？（只刪這個試算，不影響券商）`)) { const r = mgSave({ ...S2, accounts: S2.accounts.filter(x => x.id !== A.id) }); L.msg = r.ok ? "已刪除。" : "刪除失敗：資料檢查沒有通過。"; } }
  else if (a === "csv") { const S = lgLoad(); if (!S) return; if (!S.transactions.length) { L.msg = "還沒有交易，沒有東西可以匯出。"; renderList(); return; } const url = URL.createObjectURL(new Blob([KLLedger.toCSV(S.transactions)], { type: "text/csv;charset=utf-8" })), el = document.createElement("a"); el.href = url; el.download = `交易紀錄-${lgToday()}.csv`; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); L.msg = `已匯出 ${S.transactions.length} 筆交易（CSV）。完整備份（可以匯回）請用「工具 → 備份同步 → 匯出備份檔」。`; }
  else if (a === "pos") L.open = L.open === b.dataset.c ? null : b.dataset.c;
  else if (a === "edit") { const t = lgLoad()?.transactions.find(x => x.id === b.dataset.id); if (t) L.form = { id: t.id, orig: t, type: t.type, v: { ...t } }; }
  else if (a === "method") { const S = lgLoad(); if (S && confirm(`整本帳改用「${S.method === "fifo" ? "加權平均成本" : "先進先出（FIFO）"}」重新計算？已實現損益會跟著改變。`)) { const v = lgSave({ ...S, method: S.method === "fifo" ? "avg" : "fifo" }); L.msg = v.ok ? "已改用新的成本算法重新計算。" : "改不了：資料檢查沒有通過。"; } }
  else if (a === "del") {
    const S = lgLoad(), id = b.dataset.id; if (!S) return;
    const I = KLLedger.deleteImpact(S.transactions, id, { method: S.method, today: lgToday() }); if (!I.ok) return;
    if (I.newErrors.length) { L.msg = `不能刪除：刪掉後有 ${I.newErrors.length} 筆交易會出錯（例如後面的賣出變成賣超），請先修改或刪除那些交易。`; }
    else { const p = I.position, txt = [`刪除這筆交易？`, I.affected.length ? `之後同一檔還有 ${I.affected.length} 筆交易，成本與已實現損益會重新計算。` : "", p?.before && p?.after ? `持股：${lgN(p.before.shares)} → ${lgN(p.after.shares)} 股；總成本：${lgN(p.before.costBasis)} → ${lgN(p.after.costBasis)}` : ""].filter(Boolean).join("\n");
      if (confirm(txt)) { const v = lgSave({ ...S, transactions: S.transactions.filter(t => t.id !== id) }); L.msg = v.ok ? "已刪除。" : "刪除失敗：資料檢查沒有通過，沒有改動。"; } }
  }
  else return;
  renderList();
});
document.addEventListener("change", e => { if (e.target.id !== "lgType" || !W.lg?.form) return; const form = e.target.form, fd = new FormData(form), v = {}; for (const [k, x] of fd) v[k] = x; W.lg.form = { ...W.lg.form, type: e.target.value, v, err: null }; renderList(); });
document.addEventListener("submit", e => {
  if (e.target.id === "mgForm") return mgSubmit(e);
  if (e.target.id === "lgImpForm") { e.preventDefault(); return lgSaveImport(); }
  if (e.target.id !== "lgForm") return; e.preventDefault();
  const L = W.lg, F = L.form, S = lgLoad(); if (!F || !S) return;
  const tx = lgFromForm(e.target, F), list = F.id ? S.transactions.map(t => (t.id === F.id ? tx : t)) : [...S.transactions, tx];
  const R = KLLedger.buildLedger(list, { method: S.method, today: lgToday() }), me = R.txs.find(x => x.id === tx.id);
  const newErr = R.txs.filter(x => x.errors.length && x.id !== tx.id);
  const fd = new FormData(e.target), v = {}; for (const [k, x] of fd) v[k] = x;
  if (me?.errors.length || newErr.length) { L.form = { ...F, v, err: [...(me?.errors || []).map(x => x.message), ...newErr.map(x => `會讓 ${x.tx?.date || ""} 的${KLLedger.TYPE_LABEL[x.tx?.type] || "交易"}出錯：${x.errors[0].message}`)] }; return renderList(); }
  const warn = (me?.warnings || []).map(w => w.message);
  if (warn.length && !confirm(`請確認：\n${warn.join("\n")}\n\n仍要${F.id ? "儲存" : "加入"}？`)) return;
  const r = lgSave({ ...S, transactions: list });
  if (!r.ok) { L.form = { ...F, v, err: ["資料檢查沒有通過，沒有儲存。"] }; return renderList(); }
  L.form = null; L.msg = F.id ? "已儲存修改。" : "已加入。"; renderList();
});

/* ================= 績效（投資組合第 5 階段 B）：perf.js 算，這裡畫 =================
   價格：每一檔 /api/kline 原始收盤（最多 24 個月；股息已經是現金流，不用還原價）；比較基準：台幣＝加權指數（價格指數，不含股息）、美元＝SPY 還原價（含息）。
   畫面：重點數字、淨值走勢 vs 比較基準（同一起點＝100）、回撤（另一張圖，不用雙軸）、月報酬表、歸因排行、估算原因與計算口徑。
   日期範圍：3 個月／6 個月／1 年／全部；圖上滑鼠或手指移動顯示當天數值。 */
const lgViewSeg = () => ""; // 分頁列搬到庫存上方的主分頁（watch.html 的 HOLD_NAV），這裡不再畫第二排；各頁仍會呼叫，所以留著
// 績效（perf.js）與匯率合併（fx.js）用到時才載入，照順序（fx.js 要用到 perf.js）
function lgPerfLib() {
  if (typeof KLPerf !== "undefined" && typeof KLFx !== "undefined") return Promise.resolve();
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  return (W.lgPerfP ||= (typeof KLPerf !== "undefined" ? Promise.resolve() : one("perf.js")).then(() => (typeof KLFx !== "undefined" ? null : one("fx.js"))).catch(e => { W.lgPerfP = null; throw e; }));
}
// 價格：同一組代號 10 分鐘內重複用；單一檔失敗不影響其他檔（引擎會標「沒有價格」）
// 資料來源與更新標示（第 9 階段，pfsrc.js）：抓失敗時 3 秒後自動重試一次，之後要按「重新載入」；平常 10 分鐘內共用
const pfTtl = (X, ok = 600000) => (X.failed && !X.retried ? 3000 : ok);
const pfExpire = (ks = ["lgPx", "lgAl", "lgMg"]) => ks.forEach(k => { if (W[k] && !W[k].busy && !W[k].refreshing) W[k] = { ...W[k], at: 0, failed: false, retried: false }; });
const pfRetryLater = X => { if (X.failed && !X.retried) setTimeout(() => { if (W.lt === "hold" && W.holdView === "tx") renderList(); }, 3100); };
// 開始抓：有上一次的資料就先留著顯示（refreshing），沒有才顯示載入中。tok：只有最新一次請求的結果能寫回，晚回來的舊請求不覆蓋新資料
function pfBegin(k, key, n) {
  const X = W[k], prev = X && (X.px || X.prices) ? X : null, tok = (W.lgTok = (W.lgTok || 0) + 1);
  W[k] = prev && prev.key === key ? { ...prev, refreshing: true, tok } : { key, busy: true, at: Date.now(), n, tok, items: prev?.items, px: undefined };
  return { prev, tok, retry: !!(prev?.failed && prev.key === key) };
}
// 交易日曆：週末不開；台股用證交所休市日表（只有今年的），美股用 core.js 的美股休市日；不知道回 null
const pfCal = {
  tradingDay: (m, d) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); if (w === 0 || w === 6) return false;
    if (m === "tw") return typeof TWHOL !== "undefined" && TWHOL.set && d.startsWith(TWHOL.year) ? !TWHOL.set.has(d) : null;
    return typeof usHolidayName === "function" ? !usHolidayName(d) : null; },
  todayOf: m => (m === "us" && typeof usIso === "function" ? usIso() : lgToday())
};
// 整理這次的狀態：每檔一筆紀錄，沒拿到的沿用上一次那筆（包括當初的取得時間）
function pfMeta(kind, cur, prevItems, syms) {
  if (typeof KLPfSrc === "undefined") return { items: prevItems || {}, meta: null };
  const M = KLPfSrc.mergeItems(prevItems, cur.items, syms);
  return { items: M.items, meta: KLPfSrc.summarize(kind, cur, M.items, syms, pfCal) };
}
// 這次拿到的價格表＋沿用上一次的（pfsrc.js 沒載入也照樣沿用，不讓畫面卡住）
const pfKeep = (prev, next, syms) => { if (typeof KLPfSrc !== "undefined") return KLPfSrc.keepLast(prev, next, syms).data; const out = next instanceof Map ? new Map(next) : { ...next }; for (const c of syms) { const v = prev instanceof Map ? prev.get(c) : prev?.[c]; if (v != null && (out instanceof Map ? !out.has(c) : out[c] == null)) out instanceof Map ? out.set(c, v) : (out[c] = v); } return out; };
function pfSrcLib() {
  if (typeof KLPfSrc !== "undefined") return Promise.resolve();
  return (W.lgSrcP ||= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "pfsrc.js"; sc.onload = ok; sc.onerror = () => { W.lgSrcP = null; no(new Error("pfsrc.js 載入失敗")); }; document.body.appendChild(sc); }));
}
const pfSrcSafe = () => pfSrcLib().catch(() => null); // 標示模組載入失敗不能讓價格資料一起失效
// 一行資料狀態：label＝哪一種資料（報價／日 K）；計算時間另外寫，不和行情時間混在一起
function pfSrcHtml(meta, label, calc = true) {
  const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16), rl = ` <button type="button" class="linkbtn" data-lg="pfreload">重新載入</button>`;
  if (typeof KLPfSrc === "undefined") return `<p class="note pfsrc pfsrc-warn" role="status">⚠︎ ${esc(label)}：資料狀態標示沒有載入，無法確認資料來源與是不是最新${rl}</p>`;
  if (!meta) return "";
  const D = KLPfSrc.describe(meta, { name: c => nameOf(c) }), icon = { ok: "ⓘ", warn: "⚠︎", error: "✕" }[D.level];
  return `<p class="note pfsrc pfsrc-${D.level}" role="status">${icon} ${esc(label)}：${D.parts.map(esc).join("・")}${calc ? `。計算時間 ${now}` : ""}${D.level !== "ok" ? rl : ""}</p>`;
}
function lgPerfData(S) {
  const syms = [...new Set(S.transactions.map(t => String(t.symbol || "").toUpperCase()).filter(Boolean))].sort(), curs = [...new Set(S.transactions.map(t => t.currency).filter(Boolean))];
  const key = syms.join(",") + "|" + curs.join(","), X = W.lgPx;
  if (X && X.key === key && (X.busy || X.refreshing || Date.now() - X.at < pfTtl(X))) return X;
  const { prev, tok, retry } = pfBegin("lgPx", key, syms.length);
  const kl = (c, q = "") => getJ(`/api/kline?code=${encodeURIComponent(c)}&months=24${q}`).catch(() => null);
  // 有美股時另外抓美元兌台幣（Yahoo TWD=X 日收盤，市場中間價），用來換成台幣合併
  Promise.all([Promise.all(syms.map(c => kl(c))), curs.includes("TWD") ? kl("加權") : null, curs.includes("USD") ? kl("SPY", "&adj=1") : null, curs.includes("USD") ? kl("TWD=X") : null, pfSrcSafe()]).then(([A, tw, us, fx]) => {
    if (W.lgPx?.tok !== tok) return;
    const fresh = {}; syms.forEach((c, i) => { if (A[i]?.data?.length) fresh[c] = A[i].data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })); });
    // 這次沒拿到的代號、基準、匯率沿用上一次的，不讓好資料被失敗蓋掉
    const now = new Date().toISOString(), cur = typeof KLPfSrc !== "undefined" ? KLPfSrc.klineItems(Object.fromEntries(syms.map((c, i) => [c, A[i]])), now) : { ok: Object.keys(fresh).length > 0 || !syms.length, items: {} };
    const { items, meta } = pfMeta("kline", cur, prev?.items, syms);
    const bench = {}; if (tw?.data?.length) bench.TWD = tw.data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })); else if (prev?.bench?.TWD) bench.TWD = prev.bench.TWD;
    if (us?.data?.length) bench.USD = us.data.map(x => ({ d: String(x.d).slice(0, 10), c: us.adj?.ok && x.ac > 0 ? x.ac : x.c })); else if (prev?.bench?.USD) bench.USD = prev.bench.USD;
    const fxs = fx?.data?.length ? fx.data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })) : prev?.fx || [];
    W.lgPx = { key, busy: false, at: Date.now(), tok, prices: pfKeep(prev?.prices, fresh, syms), bench, usAdj: us ? !!us?.adj?.ok : !!prev?.usAdj, fx: fxs, items, meta, failed: !cur.ok, retried: retry };
    pfRetryLater(W.lgPx); if (W.lt === "hold" && W.holdView === "tx" && ["perf", "home", undefined].includes(W.lg?.view)) renderList(); // 績效與總覽的走勢共用
  });
  return W.lgPx;
}
const pfPct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
function renderPerf(S) {
  const L = W.lg, head = lgViewSeg();
  if (W.off) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">需要部署到網站才有價格資料。</p>`);
  if (typeof KLPerf === "undefined" || typeof KLFx === "undefined") { $("#lx").innerHTML = head + skel("載入績效模組…"); lgPerfLib().then(() => renderList(), e => { $("#lx").innerHTML = head + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; }); return; }
  if (!S.transactions.length) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">還沒有交易，沒有績效可以算。</p>`);
  const X = lgPerfData(S);
  if (X.busy) return ($("#lx").innerHTML = head + skel(`載入 ${X.n} 檔持股與比較基準的日 K…`));
  const master = new Map((Array.isArray(W.stocks) ? W.stocks : []).map(r => [String(r[0]).toUpperCase(), r[3] || null]));
  const R = KLPerf.buildPerf(S.transactions, { method: S.method, today: lgToday(), prices: X.prices, bench: X.bench, benchName: { TWD: "加權指數（價格指數，不含股息）", USD: X.usAdj ? "S&P 500（SPY，含息還原）" : "S&P 500（SPY，不含息）" },
    classify: c => ({ assetType: /^00\d{2,4}[A-Z]?$/.test(c) || ["SPY", "QQQ", "VOO", "VTI", "SOXX", "TQQQ", "SOXL", "DIA", "IWM", "IVV", "VT", "SMH", "XLK", "SCHD", "VYM", "BND", "TLT", "GLD"].includes(c) ? "etf" : "stock", industry: master.get(c) || null }) });
  const range = L.pfRange || "all", rg = `<div class="seg pfrange" role="group" aria-label="日期範圍">${[["3m", "3 個月"], ["6m", "6 個月"], ["1y", "1 年"], ["all", "全期間"]].map(([k, t]) => `<button type="button" data-lg="range" data-v="${k}" aria-pressed="${range === k}">${t}</button>`).join("")}</div>`;
  // 台幣合併（含匯率拆解）只在「全部」顯示；台股／美股各看自己的幣別
  const cards = (R.byCurrency.USD && lgMktSel() === "all" ? pfFxCard(KLFx.combine(R, X.fx || [], { fxSource: "Yahoo Finance TWD=X 日收盤" })) : "") + Object.values(R.byCurrency).filter(C => lgCurOk(C.currency)).map(C => pfCard(C, range)).join("");
  $("#lx").innerHTML = head + `<div class="lgbar">${lgMktSeg()}${rg}<button type="button" class="btn sm" data-lg="pfreload">重新載入價格</button></div>` + pfSrcHtml(X.meta, "日 K")
    + (R.ledgerErrors ? `<p class="note lgwarn pfstatus" style="margin:4px 12px">✕ 有 ${R.ledgerErrors} 筆交易有錯誤，沒有算進績效；請到「交易紀錄」修改。下面的數字不完整。</p>` : "")
    + (R.status === "needs_confirm" ? `<p class="note lgwarn pfstatus" style="margin:4px 12px">⚠︎ 待確認：有部位合股後的零股還沒結算，股數與成本是暫時的，下面的績效也是暫時的。請到「交易紀錄」新增「零股現金結算」。</p>` : "")
    + (cards || `<p class="note" style="padding:12px">${lgMktSel() === "all" ? "沒有可以計算的持股。" : `沒有${lgMktSel() === "us" ? "美股" : "台股"}的部位。`}</p>`)
    + `<details class="pfbasis"><summary>計算口徑</summary><ul>
      <li>範圍是證券部位（股票、ETF 的市值），不含現金。買進付出的錢算投入；賣出拿回的錢、領到的股息算拿回。</li>
      <li>價格用原始收盤價；股息已經當成現金流，不再用還原價重複計算。台幣、美元分開算，不相加。</li>
      <li>「÷ 累計投入」＝總損益 ÷ 所有買進、轉入的金額加總（不扣掉賣出、股息拿回的錢，也不管投入的時間點），只是損益的相對大小，不是投資報酬率。要看報酬率請看時間加權或資金加權報酬。</li>
      <li>時間加權報酬（TWR）：不受投入時點影響，用來和大盤比。資金加權報酬：考慮投入時點與金額；滿一年才年化，未滿一年只給整段期間的值。</li>
      <li>最大回撤：用 TWR 淨值算從前高跌了多少；恢復天數是谷底到第一次回到前高。</li>
      <li>價格最多抓 24 個月，更早的交易會標「估算」。過去績效不代表未來。</li></ul></details>`;
}
function pfCard(C, range) {
  const cur = C.currency, P = C.pnl, m = C.mwr, B = C.bench, D = C.maxDrawdown;
  const est = m.status === "estimated" ? `<span class="pfbadge">估算</span>` : m.status === "unavailable" ? `<span class="pfbadge">無法計算</span>` : "";
  const cst = C.status === "needs_confirm" ? `<span class="pfbadge">待確認</span>` : C.status === "estimated" ? `<span class="pfbadge">含估算</span>` : "";
  const tile = (k, v, sub = "", c = "") => `<div class="pftile"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = [
    tile("總損益", lgSgn(P.total, cur), `÷ 累計投入 ${pfPct(P.totalPct)}（不扣賣出、不看時點）`, cls(P.total)),
    tile("時間加權報酬", pfPct(C.twr), C.twr == null ? "資料不足，無法計算" : C.annualizable ? `年化 ${pfPct(C.twrAnn)}` : "未滿一年，不年化", cls(C.twr)),
    tile("資金加權報酬" + est, m.status === "unavailable" ? "—" : m.annualized ? pfPct(m.value) : pfPct(m.period), m.status === "unavailable" ? (m.reasons?.includes("multiple_solutions") ? "無法確認是否為唯一解，不顯示" : "現金流算不出來") : m.annualized ? "年化（XIRR）" : "整段期間，未年化", cls(m.annualized ? m.value : m.period)),
    tile("最大回撤", D ? pfPct(D.dd) : "—", !D ? "資料不足，無法計算" : D.peak ? (D.recovered ? `${D.trough.slice(5)} 谷底，${D.recoveryDays} 天後回到前高` : `${D.peak.slice(5)} 前高，尚未回到`) : "期間內沒有回撤"),
    tile("相對比較基準", B ? pfPct(B.excess) : "—", B ? `${esc(B.name || "")} ${pfPct(B.ret)}` : "沒有比較基準資料", B ? cls(B.excess) : "")
  ].join("");
  const reasons = m.reasons?.length && m.status !== "ok" ? `<p class="note lgwarn pfreasons">⚠︎ ${m.status === "unavailable" ? "資金加權報酬無法計算" : "資金加權報酬是估算"}：${m.reasons.map(r => esc(KLPerf.REASON_LABEL[r] || r)).join("；")}。</p>` : "";
  const ISS = { pending: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 合股後的零股還沒結算`, transfer_out_prev_price: x => `${esc(nameOf(x.code))} ${x.d} 轉出用 ${x.priceDate} 的收盤價`, transfer_out_user_price: x => `${esc(nameOf(x.code))} ${x.d} 轉出使用手動填寫的價格`, transfer_out_no_price: x => `${esc(nameOf(x.code))} ${x.d} 轉出沒有市價，依成本估算或停止績效計算`, no_prices: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 拿不到價格`, history_truncated: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 的價格只抓得到最近 24 個月`, price_fallback: x => `${x.days} 天沒有收盤價，用交易價格代替`, stale_prices: x => `有價格停在 ${x.maxDays} 天前（可能停牌或資料缺漏）` };
  const iss = C.issues.length ? `<p class="note">資料提醒：${C.issues.map(x => (ISS[x.k] ? ISS[x.k](x) : esc(x.k))).join("；")}。</p>` : "";
  return `<section class="pfcard" data-nofold><h4>${cur === "USD" ? "美股（美元）" : "台股（台幣）"}${cst}<small class="note"> ${C.from ? `${C.from}～${C.to}・` : ""}資料到 ${esc(C.asOf || "")}</small></h4>
    <div class="pftiles">${tiles}</div>${reasons}${iss}
    ${pfCharts(C, range)}
    ${pfMonthly(C)}
    ${pfAttr(C)}
    <dl class="pfpnl"><dt>總投入</dt><dd>${lgMoney(P.invested, cur)}</dd><dt>拿回／轉出估值（賣出＋股息＋轉出）</dt><dd>${lgMoney(P.returned, cur)}</dd><dt>目前市值</dt><dd>${lgMoney(P.marketValue, cur)}</dd>
      <dt>已實現損益</dt><dd class="${cls(P.realized)}">${lgSgn(P.realized, cur)}</dd>${P.transferOutPnl ? `<dt>轉出損益（轉出市價 − 成本）</dt><dd class="${cls(P.transferOutPnl)}">${lgSgn(P.transferOutPnl, cur)}</dd>` : ""}<dt>未實現損益</dt><dd class="${cls(P.unrealized)}">${lgSgn(P.unrealized, cur)}</dd><dt>股息（稅後）</dt><dd>${lgMoney(P.dividends, cur)}</dd>
      <dt>手續費＋稅</dt><dd>${lgMoney(P.fees + P.taxes, cur)}</dd>${P.extraFees ? `<dt>其中另計費用</dt><dd>${lgMoney(P.extraFees, cur)}</dd>` : ""}${P.otherCash ? `<dt>其他公司行動現金</dt><dd>${lgSgn(P.otherCash, cur)}</dd>` : ""}</dl></section>`;
}
// 淨值走勢（組合 vs 比較基準，同一起點＝100）＋回撤；一張圖一個軸
function pfCharts(C, range) {
  if (!C.series.length) return `<p class="note" style="padding:8px 0">資料不足，無法計算走勢。</p>`;
  const all = C.series.filter(x => x.v > 0 || x.flow !== 0); if (all.length < 2) return `<p class="note" style="padding:8px 0">交易日太少，還畫不出走勢。</p>`;
  const end = all.at(-1).d, back = { "3m": 92, "6m": 183, "1y": 366 }[range], from = back ? new Date(Date.parse(end) - back * 864e5).toISOString().slice(0, 10) : all[0].d;
  // 起點：範圍前一天的收盤；「全部」或範圍從第一天開始時，用第一天開盤前（淨值 1、第一筆投入前），這樣圖上的報酬和上面的數字一致
  const k0 = all.findIndex(x => x.d >= from), base = k0 > 0 ? all[k0 - 1] : { d: all[0].d, index: 1, v: 0, start: true }, S = [base, ...all.slice(Math.max(0, k0))];
  if (S.length < 2) return `<p class="note">這段期間的資料太少。</p>`;
  const BB = W.lgPx?.bench?.[C.currency] ? KLPerf.priceBook(W.lgPx.bench[C.currency]) : null, bAt = d => BB?.at(d)?.c;
  const b0 = base.start ? (BB?.a.filter(x => x.d < base.d).at(-1)?.c ?? bAt(base.d)) : bAt(base.d);
  const pts = S.map(x => { const b = x.start ? b0 : bAt(x.d); return { d: x.d + (x.start ? "（起點）" : ""), p: 100 * x.index / base.index, b: b0 && b ? 100 * b / b0 : null, v: x.v }; });
  let pk = -Infinity; pts.forEach(x => { pk = Math.max(pk, x.p); x.dd = x.p / pk - 1; });
  const id = "pf" + C.currency; (W.lgPf ||= {})[id] = { pts, cur: C.currency };
  const W0 = 600, H1 = 180, H2 = 70, vals = pts.flatMap(x => [x.p, x.b].filter(v => v != null)), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || 1;
  const X = i => (i / (pts.length - 1)) * W0, Y = v => H1 - ((v - lo + pad) / (hi - lo + 2 * pad)) * H1, ddLo = Math.min(-0.01, ...pts.map(x => x.dd)), YD = v => (v / ddLo) * H2;
  const line = k => pts.map((x, i) => (x[k] == null ? null : `${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`)).filter(Boolean).join(" ");
  const ddPath = `M0,0 ${pts.map((x, i) => `L${X(i).toFixed(1)},${YD(x.dd).toFixed(1)}`).join(" ")} L${W0},0 Z`, last = pts.at(-1), y100 = Y(100);
  const bn = C.bench?.name ? esc(C.bench.name) : "比較基準";
  return `<div class="pfchart" data-pf="${id}"><div class="pflegend"><span><i class="pfk"></i>我的組合 <b>${pfPct(last.p / 100 - 1)}</b></span>${last.b != null ? `<span><i class="pfk bm"></i>${bn} <b>${pfPct(last.b / 100 - 1)}</b></span>` : ""}<small class="note">起點＝100</small></div>
    <div class="pfplot" style="height:${H1}px"><svg viewBox="0 0 ${W0} ${H1}" preserveAspectRatio="none" aria-hidden="true">
      ${y100 > 0 && y100 < H1 ? `<line x1="0" x2="${W0}" y1="${y100}" y2="${y100}" class="pfbase"/>` : ""}
      ${last.b != null ? `<polyline points="${line("b")}" class="pfline bm"/>` : ""}<polyline points="${line("p")}" class="pfline"/></svg>
      <span class="pfax hi">${hi.toFixed(0)}</span><span class="pfax lo">${lo.toFixed(0)}</span><i class="pfx" hidden></i><div class="pftip" hidden></div></div>
    <div class="pfdates"><span>${pts[0].d.slice(0, 10)}</span><span>${last.d}</span></div>
    <div class="pfsub">回撤（從前高跌了多少）<small class="note">最深 ${pfPct(Math.min(...pts.map(x => x.dd)))}</small></div>
    <div class="pfplot dd" style="height:${H2}px"><svg viewBox="0 0 ${W0} ${H2}" preserveAspectRatio="none" aria-hidden="true"><path d="${ddPath}" class="pfdd"/></svg><i class="pfx" hidden></i><div class="pftip" hidden></div></div>
    <table class="pfsr"><caption>每日淨值（起點＝100）</caption><thead><tr><th>日期</th><th>我的組合</th><th>${bn}</th><th>回撤</th></tr></thead><tbody>${pts.filter((_, i) => i % Math.ceil(pts.length / 40) === 0 || i === pts.length - 1).map(x => `<tr><td>${x.d}</td><td>${x.p.toFixed(2)}</td><td>${x.b == null ? "—" : x.b.toFixed(2)}</td><td>${pfPct(x.dd)}</td></tr>`).join("")}</tbody></table></div>`;
}
function pfMonthly(C) {
  if (!C.monthly.length) return "";
  const Y = [...new Set(C.monthly.map(m => m.p.slice(0, 4)))], M = new Map(C.monthly.map(m => [m.p, m])), YR = new Map(C.yearly.map(y => [y.p, y]));
  const cell = m => { if (!m) return `<td></td>`; const a = Math.min(1, Math.abs(m.r) / 0.1), col = m.r >= 0 ? "--up" : "--down";
    return `<td style="background:color-mix(in srgb, var(${col}) ${Math.round(a * 45)}%, transparent)" title="${m.p}：${pfPct(m.r)}${m.bench != null ? `，比較基準 ${pfPct(m.bench)}` : ""}${m.days < 15 ? `（只有 ${m.days} 個交易日）` : ""}">${pfPct(m.r, 1)}</td>`; };
  return `<h5 class="pfh">月報酬<small class="note">（時間加權；滑鼠停在格子上看比較基準）</small></h5><div class="pfmon"><table><thead><tr><th>年</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}月</th>`).join("")}<th>全年</th></tr></thead><tbody>
    ${Y.map(y => `<tr><th>${y}</th>${Array.from({ length: 12 }, (_, i) => cell(M.get(`${y}-${String(i + 1).padStart(2, "0")}`))).join("")}${cell(YR.get(y))}</tr>`).join("")}</tbody></table></div>`;
}
function pfAttr(C) {
  const A = C.attribution, cur = C.currency, top = A.bySymbol.filter(x => Math.abs(x.pnl) > 0.004).slice(0, 12), mx = Math.max(1, ...top.map(x => Math.abs(x.pnl)));
  if (!top.length) return "";
  const TY = { stock: "個股", etf: "ETF", unknown: "未分類" };
  return `<h5 class="pfh">誰賺誰賠<small class="note">（已實現＋未實現＋股息＋另計費用／公司行動）</small></h5><ul class="pfattr">${top.map(x => `<li><span class="nm">${esc(nameOf(x.symbol))}<small class="note"> ${esc(x.symbol)}</small></span><span class="pfbar"><i class="${x.pnl >= 0 ? "up" : "dn"}" style="width:${(Math.abs(x.pnl) / mx * 50).toFixed(1)}%"></i></span><b class="${cls(x.pnl)}">${lgSgn(x.pnl, cur)}</b></li>`).join("")}</ul>
    ${A.unattributed ? `<p class="note">沒有對應到個股的費用或現金：${lgSgn(A.unattributed, cur)}（和上面各檔加總＝總損益）</p>` : ""}<p class="note">依類型：${A.byType.map(g => `${TY[g.group] || esc(g.group)} ${lgSgn(g.pnl, cur)}`).join("、")}${A.byIndustry.some(g => g.group !== "unknown") ? `；依產業：${A.byIndustry.slice(0, 5).map(g => `${g.group === "unknown" ? "未分類" : esc(g.group)} ${lgSgn(g.pnl, cur)}`).join("、")}` : ""}；股息 ${lgMoney(A.dividends, cur)}、手續費與稅 ${lgSgn(A.feesAndTaxes, cur)}；匯率影響：${esc(A.fxNote)}。</p>`;
}
// 圖上的十字線與提示：滑鼠移動、手指點一下或左右拖曳，顯示最近那一天的數值（圖設 touch-action: pan-y，上下滑仍然捲動頁面）
function pfTip(e) {
  const plot = e.target.closest?.(".pfplot"); if (!plot) return; const box = plot.closest(".pfchart"), D = W.lgPf?.[box?.dataset.pf]; if (!D) return;
  const r = plot.getBoundingClientRect(), i = Math.max(0, Math.min(D.pts.length - 1, Math.round((e.clientX - r.left) / r.width * (D.pts.length - 1)))), x = D.pts[i];
  box.querySelectorAll(".pfx").forEach(el => { el.hidden = false; el.style.left = (i / (D.pts.length - 1) * 100) + "%"; });
  box.querySelectorAll(".pftip").forEach(el => { el.hidden = true; });
  const tip = plot.querySelector(".pftip"); tip.hidden = false; tip.style.left = Math.min(r.width - 150, Math.max(0, e.clientX - r.left + 8)) + "px";
  tip.innerHTML = `<b>${esc(x.d)}</b><br>我的組合 ${x.p.toFixed(2)}（${pfPct(x.p / 100 - 1)}）${x.b != null ? `<br>比較基準 ${x.b.toFixed(2)}（${pfPct(x.b / 100 - 1)}）` : ""}<br>回撤 ${pfPct(x.dd)}<br>市值 ${lgMoney(x.v, D.cur)}`;
}
document.addEventListener("pointermove", pfTip); document.addEventListener("pointerdown", pfTip);
document.addEventListener("pointerleave", e => { const box = e.target.closest?.(".pfchart"); if (!box) return; box.querySelectorAll(".pfx,.pftip").forEach(el => { el.hidden = true; }); }, true);
// 績效頁的樣式（放在這裡，不用改 watch.html）；顏色用網站的變數，深色模式自動跟著變
(function () {
  if (document.getElementById("pfcss")) return; const st = document.createElement("style"); st.id = "pfcss";
  st.textContent = `:root[data-theme="light"] #lx :is(.lgwarn,.pfsrc-warn,.pfsrc-error,.pfbadge,.hm-high .linkbtn,.hm-warn .linkbtn){color:#8a5300;border-color:#8a5300}@media (pointer:coarse){.lgview button,.btn[data-lg],.seg button[data-lg]{min-height:44px}.pfsrc .linkbtn{min-height:44px}}.pfsrc{margin:4px 12px;font-size:12px;overflow-wrap:anywhere}#lx .pfsrc-warn,#lx .pfsrc-error{color:var(--s1,#d98a0b)}.hmcard .pfsrc{margin:6px 0 0}.lgview{margin:8px 12px 0}@media (max-width:520px){.seg.lgview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:visible}.seg.lgview button{padding:5px 4px;border-left:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.seg.lgview button:nth-child(4n){border-right:0}}.pfrange{flex-wrap:wrap}
.pfcard{margin:8px 12px 16px;padding:10px 12px;border-radius:6px;background:var(--surface-2)}.pfcard h4{margin:0 0 8px;font-size:14px}
.pftiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:8px}
.pftile{display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:6px;background:var(--surface);min-width:0}.pftile span{font-size:12px;color:var(--muted)}
.pftile b{font-size:18px;font-variant-numeric:tabular-nums}.pftile small{font-size:11px;color:var(--muted);overflow-wrap:anywhere}
.pfbadge{margin-left:4px;padding:0 4px;border-radius:3px;border:1px solid var(--s1,#d98a0b);color:var(--s1,#d98a0b);font-size:10px}
.pfchart{margin:8px 0}.pflegend{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:12px;margin-bottom:4px}
.pfk{display:inline-block;width:14px;height:2px;margin-right:4px;vertical-align:middle;background:var(--accent)}.pfk.bm{background:none;border-top:2px dashed var(--muted)}
.pfplot{position:relative;touch-action:pan-y}.pfplot svg{display:block;width:100%;height:100%;overflow:visible}
.pfline{fill:none;stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}.pfline.bm{stroke:var(--muted);stroke-dasharray:5 4}
.pfbase{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}.pfdd{fill:color-mix(in srgb,var(--muted) 35%,transparent);stroke:var(--muted);stroke-width:1;vector-effect:non-scaling-stroke}
.pfax{position:absolute;right:2px;font-size:10px;color:var(--muted);background:color-mix(in srgb,var(--surface-2) 80%,transparent);padding:0 2px}.pfax.hi{top:0}.pfax.lo{bottom:0}
.pfx{position:absolute;top:0;bottom:0;width:1px;background:var(--muted);pointer-events:none}
.pftip{position:absolute;top:4px;z-index:2;width:142px;padding:6px 8px;border-radius:6px;background:var(--surface);border:1px solid var(--line);font-size:11px;line-height:1.5;pointer-events:none;font-variant-numeric:tabular-nums}
.pfdates{display:flex;justify-content:space-between;font-size:10px;color:var(--muted)}.pfsub{margin-top:8px;font-size:12px}
.pfsr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.pfh{margin:12px 0 4px;font-size:13px}.pfmon{overflow-x:auto}.pfmon table{border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums;min-width:560px;width:100%}
.pfmon th,.pfmon td{padding:3px 4px;text-align:right;border:1px solid var(--surface-2)}.pfmon thead th{color:var(--muted);font-weight:400}
.pfattr{list-style:none;margin:0;padding:0}.pfattr li{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;gap:8px;align-items:center;padding:3px 0;font-size:12px}
.pfattr .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pfbar{position:relative;height:8px;background:linear-gradient(var(--line),var(--line)) 50% 0/1px 100% no-repeat}
.pfbar i{position:absolute;top:0;height:100%}.pfbar i.up{left:50%;border-radius:0 3px 3px 0;background:var(--up)}.pfbar i.dn{right:50%;border-radius:3px 0 0 3px;background:var(--down)}
.pfattr b{font-variant-numeric:tabular-nums;text-align:right}
.pfpnl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:12px 0 0;font-size:13px}.pfpnl dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.pfbasis{margin:4px 12px 16px;font-size:12px}.pfbasis ul{padding-left:1.2em;margin:4px 0}
#impSheet .lgimp-form{margin:0}
#impSheet .lgimp-method{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;font-size:13px}
#impSheet .lgimp-method select{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;padding:6px 8px;min-height:36px;font:inherit;font-size:max(1rem,1em)}
#impSheet .lgimp-method select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
#impSheet .lgimp-card:focus-visible,#impSheet .hg-wrap:focus-visible,#impSheet :is(button,input[type="checkbox"]):focus-visible{outline:2px solid var(--accent);outline-offset:1px}
#impSheet .lgimp-sub:has(input:disabled){opacity:.45;cursor:not-allowed}
#impSheet .hgrid td small[data-lgimp-meta]{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
#impSheet .hgrid th .pfsr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);clip:rect(0 0 0 0);white-space:nowrap}
#impSheet progress{width:100%;height:8px;margin:6px 0;accent-color:var(--accent)}
@media (pointer:coarse){#impSheet .lgimp-method select{min-height:44px}#impSheet .lgimp-sub{min-height:36px}}`;
  document.head.appendChild(st);
})();

/* ================= 融資與擔保品（投資組合第 7 階段）：margin.js 算，這裡畫 =================
   存檔：kline:pf:margin:v1 → { v: 1, accounts: [...] }（和交易紀錄分開；寫入前跑 KLMargin.validateStore，不通過不寫）。
   結果一律是「試算」：每個帳戶標資料來源（券商資料／自己填的／系統估算），門檻寫出來源與日期，畫面寫明不是券商正式追繳通知或可借額度。 */
const MG_KEY = "pf:margin:v1", mgLoad = () => { const s = store.get(MG_KEY, null); return s && s.v === 1 && Array.isArray(s.accounts) ? s : { v: 1, accounts: [] }; };
function mgSave(s) { const v = KLMargin.validateStore(s); if (v.ok) store.set(MG_KEY, s); return v; }
function mgLib() {
  if (typeof KLMargin !== "undefined") return Promise.resolve();
  return (W.lgMgP ||= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "margin.js"; sc.onload = ok; sc.onerror = () => { W.lgMgP = null; no(new Error("margin.js 載入失敗")); }; document.body.appendChild(sc); }));
}
function mgPrices(syms) {
  const key = syms.slice().sort().join(","), X = W.lgMg; if (!syms.length) return { busy: false, px: {} };
  if (X && X.key === key && (X.busy || X.refreshing || Date.now() - X.at < pfTtl(X, 300000))) return X;
  const { prev, tok, retry } = pfBegin("lgMg", key, syms.length);
  Promise.all([getJ(`/api/quote?codes=${syms.map(encodeURIComponent).join(",")}`).catch(() => null), pfSrcSafe()]).then(([q]) => {
    if (W.lgMg?.tok !== tok) return;
    const px = {}; for (const x of q?.quotes || []) if (x && x.price > 0) px[String(x.code).toUpperCase()] = { price: x.price, date: x.dataDate || x.date || null, name: x.name || null };
    const cur = typeof KLPfSrc !== "undefined" ? KLPfSrc.quoteItems(q, new Date().toISOString()) : { ok: !!q?.ok && (q.quotes || []).some(x => x && x.price > 0), items: {} }, { items, meta } = pfMeta("quote", cur, prev?.items, syms);
    W.lgMg = { key, busy: false, at: Date.now(), tok, px: pfKeep(prev?.px, px, syms), items, meta, failed: !cur.ok, retried: retry };
    pfRetryLater(W.lgMg); if (W.lt === "hold" && W.holdView === "tx" && ["margin", "home", undefined].includes(W.lg?.view)) renderList();
  });
  return W.lgMg;
}
const MG_TYPE = { margin: "融資（證券金融）", pledge: "不限用途借貸（股票質押）", other: "其他借款" }, MG_STATE = { ok: "正常", near: "接近追繳線", call: "低於追繳線", liquidate: "低於處分線" };
function renderMargin() {
  const head = lgViewSeg(), L = W.lg;
  if (typeof KLMargin === "undefined") { $("#lx").innerHTML = head + skel("載入融資模組…"); mgLib().then(() => renderList(), e => { $("#lx").innerHTML = head + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; }); return; }
  const S = mgLoad(), syms = [...new Set(S.accounts.flatMap(a => (a.collateral || []).map(c => String(c.symbol).toUpperCase())))], X = W.off ? { busy: false, px: {} } : mgPrices(syms);
  const warn = `<p class="note lgwarn mgnote">⚠︎ 這裡都是<b>試算</b>：用你填的借款、門檻與目前報價計算，不是券商的正式追繳通知或可借額度；實際以券商通知與合約為準。</p>`;
  const form = L.mgForm ? mgFormHtml(L.mgForm) : "";
  if (X.busy) return ($("#lx").innerHTML = head + skel("載入擔保品報價…"));
  const cards = S.accounts.map(a => mgCard(KLMargin.analyze(a, X.px, lgToday()), a)).join("");
  $("#lx").innerHTML = head + `<div class="lgbar"><button type="button" class="btn sm primary" data-lg="mgadd">＋ 新增融資／借款帳戶</button><button type="button" class="btn sm" data-lg="pfreload">重新載入報價</button></div>` + (syms.length ? pfSrcHtml(X.meta, "擔保品報價") : "")
    + (L.msg ? `<p class="note lgmsg" role="status">${esc(L.msg)}</p>` : "") + warn + form
    + (cards || `<p class="note" style="padding:12px">還沒有融資或借款資料。按「新增」填入借款金額、擔保品與券商的門檻，就能看維持率與下跌時的風險。</p>`);
}
function mgCard(R, a) {
  const pc = v => (v == null ? "—" : (v * 100).toFixed(1) + "%"), money = v => lgMoney(v, R.currency), tile = (k, v, sub = "", c = "") => `<div class="pftile"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const st = R.state ? `<span class="pfbadge mg-${R.state}">${MG_STATE[R.state]}</span>` : "", src = `<span class="pfbadge">${KLMargin.SOURCE_LABEL[R.source]}</span>`;
  const done = R.status === "estimated" ? `<span class="pfbadge">含估算</span>` : R.status === "incomplete" ? `<span class="pfbadge mg-call">資料不完整</span>` : "";
  const PS = { quote: "報價", user: "你填的價格" };
  const colTable = R.collateral.length ? `<h5 class="pfh">擔保品<small class="note">（價格、日期、來源）</small></h5><div class="mgscroll"><table class="altable mgtable mgwrapped mgcol"><thead><tr><th>代號</th><th>股數</th><th>價格</th><th>價格日期</th><th>來源</th><th>市值</th><th>占比</th></tr></thead><tbody>
    ${R.collateral.map(c => `<tr><td>${esc(nameOf(c.symbol))}<small class="note"> ${esc(c.symbol)}</small></td><td>${lgN(c.shares)}</td><td>${c.price == null ? "—" : lgN(c.price)}</td><td>${esc(c.priceDate || "—")}</td><td>${c.priceSource ? PS[c.priceSource] : "沒有價格，沒算進市值"}</td><td>${c.value == null ? "—" : money(c.value)}</td><td>${pc(c.weight)}</td></tr>`).join("")}
    ${R.cashCollateral ? `<tr><td>現金擔保</td><td></td><td></td><td></td><td>你填的</td><td>${money(R.cashCollateral)}</td><td>${pc(R.collateralValue ? R.cashCollateral / R.collateralValue : null)}</td></tr>` : ""}</tbody></table></div>` : "";
  const iss = R.issues.map(x => esc(KLMargin.ISSUE_LABEL[x.k] || x.k) + (x.codes ? `：${x.codes.map(esc).join("、")}` : "")).join("；");
  const needTxt = n => (n ? `補現金 ${money(n.cash)} 或還款 ${money(n.repay)}` : "—");
  return `<section class="pfcard mgcard" data-nofold><h4>${esc(R.name || "借款帳戶")}<small class="note"> ${MG_TYPE[R.type]}</small>${src}${st}${done}</h4>
    <div class="pftiles">${[tile("維持率", pc(R.ratio), R.rules.call ? `追繳線 ${pc(R.rules.call)}${R.rules.liquidate ? `・處分線 ${pc(R.rules.liquidate)}` : ""}` : "沒有設定追繳線"),
      tile("借款", money(R.loan), R.interest != null ? `已計利息約 ${money(R.interest)}（${R.days} 天）` : ""), tile("擔保品市值", money(R.collateralValue), R.cashCollateral ? `含現金 ${money(R.cashCollateral)}` : ""),
      tile("再跌多少會追繳", R.dropToCall == null ? "—" : R.dropToCall <= 0 ? "已低於追繳線" : pc(R.dropToCall), R.dropToLiquidate != null ? `跌 ${pc(R.dropToLiquidate)} 會被處分` : ""),
      tile("可用額度（試算）", R.available == null ? "—" : money(R.available), R.rules.maxLtv ? `成數 ${pc(R.rules.maxLtv)}` : "沒有設定成數")].join("")}</div>
    ${R.need ? `<p class="note lgwarn">⚠︎ 目前低於追繳線：試算要${needTxt(R.need)}才回到 ${pc(R.rules.topUpTo || R.rules.call)}。</p>` : ""}${iss ? `<p class="note lgwarn">⚠︎ ${iss}。</p>` : ""}
    ${colTable}
    <h5 class="pfh">壓力測試<small class="note">（股票擔保品同時下跌，現金不跌）</small></h5>
    <div class="mgscroll"><table class="altable mgtable mgwrapped"><thead><tr><th>情境</th><th>擔保品市值</th><th>維持率</th><th>狀態</th><th>要補</th></tr></thead><tbody>
      ${R.stress.map(x => `<tr><td>全部跌 ${(-x.shock * 100).toFixed(0)}%</td><td>${money(x.value)}</td><td>${pc(x.ratio)}</td><td>${x.state ? MG_STATE[x.state] : "—"}</td><td>${needTxt(x.need)}</td></tr>`).join("")}
      ${R.singleLimitDown.slice(0, 3).map(x => `<tr><td>${esc(nameOf(x.symbol))} 連三根跌停（約 −27%）</td><td>${money(x.value)}</td><td>${pc(x.ratio)}</td><td>${x.state ? MG_STATE[x.state] : "—"}</td><td>${needTxt(x.need)}</td></tr>`).join("")}</tbody></table></div>
    ${R.riskiest ? `<p class="note">風險最大的擔保品：${esc(nameOf(R.riskiest.symbol))}（占擔保品 ${pc(R.riskiest.weight)}）。</p>` : ""}
    <p class="note">門檻來源：${esc(R.rules.source || "未填")}${R.rules.asOf ? `（${esc(R.rules.asOf)}）` : ""}${R.rules.isDefault ? "；<b>目前是預設值，請改成你的券商條件</b>" : ""}。資料更新：${esc(a.updatedAt || "—")}。</p>
    <div class="lgbar"><button type="button" class="btn sm" data-lg="mgedit" data-id="${esc(a.id)}">修改</button><button type="button" class="btn sm" data-lg="mgdel" data-id="${esc(a.id)}">刪除</button></div></section>`;
}
function mgFormHtml(F) {
  const v = F.v || {}, r = v.rules || {}, pc = x => (x == null ? "" : +(x * 100).toFixed(2));
  const col = (v.collateral || []).map(c => `${c.symbol} ${c.shares}${c.price ? " " + c.price : ""}`).join("\n");
  const inp = (n, l, val, extra = "") => `<label>${l}<input name="${n}" value="${esc(val ?? "")}" ${extra}></label>`;
  return `<form class="lgform" id="mgForm"><h4>${F.id ? "修改借款帳戶" : "新增借款帳戶"}</h4>
    ${inp("name", "名稱", v.name || "", 'maxlength="30"')}
    <label>類型<select name="type">${Object.entries(MG_TYPE).map(([k, t]) => `<option value="${k}" ${v.type === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>資料來源<select name="source">${Object.entries({ broker: "券商資料（對帳單、App）", user: "自己估的", estimate: "系統估算" }).map(([k, t]) => `<option value="${k}" ${(v.source || "user") === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    ${inp("loan", "借款（融資）金額", v.loan, 'inputmode="decimal"')}${inp("rate", "年利率 %", pc(v.rate), 'inputmode="decimal"')}${inp("startDate", "開始日", v.startDate || "", 'type="date"')}${inp("termDays", "期限（天，可空白）", v.termDays, 'inputmode="numeric"')}
    ${inp("call", "追繳線 %（空白＝預設）", pc(r.call), 'inputmode="decimal"')}${inp("topUpTo", "補足到 %", pc(r.topUpTo), 'inputmode="decimal"')}${inp("liquidate", "處分線 %（可空白）", pc(r.liquidate), 'inputmode="decimal"')}${inp("maxLtv", "最高成數 %（可空白）", pc(r.maxLtv), 'inputmode="decimal"')}
    ${inp("ruleSource", "門檻來源（例如券商名稱、合約）", r.source || "", 'maxlength="60"')}${inp("cashCollateral", "現金擔保（可空白）", v.cashCollateral, 'inputmode="decimal"')}
    <label class="wide">擔保品（一行一檔：代號 股數 [價格]；沒有報價時才用你填的價格）<textarea name="collateral" rows="4">${esc(col)}</textarea></label>
    ${F.err ? `<ul class="lgiss">${F.err.map(e => `<li class="lgwarn">✕ ${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="lgbar"><button type="submit" class="btn primary">${F.id ? "儲存修改" : "加入"}</button><button type="button" class="btn" data-lg="mgclose">取消</button></div></form>`;
}
const MG_ERR = { no_collateral: "至少要有一檔股票擔保品或現金擔保", invalid_loan: "借款金額要大於 0", invalid_rate: "年利率要在 0～100% 之間", topup_below_call: "「補足到」不能低於追繳線", invalid_collateral: "擔保品格式：代號 股數 [價格]，股數要大於 0", duplicate_or_missing_id: "帳戶編號重複" };
function mgSubmit(e) {
  e.preventDefault(); const L = W.lg, F = L.mgForm, fd = new FormData(e.target), n = k => { const t = String(fd.get(k) ?? "").trim().replace(/,/g, ""); return t === "" ? null : Number(t); }, pct = k => (n(k) == null ? null : n(k) / 100);
  const lines = String(fd.get("collateral") || "").split(/\n/).map(l => l.trim()).filter(Boolean);
  const collateral = lines.map(l => { const [c, sh, px] = l.split(/[\s,，]+/); return { symbol: String(c || "").toUpperCase(), shares: Number(sh), ...(px ? { price: Number(px) } : {}) }; });
  const rules = { call: pct("call"), topUpTo: pct("topUpTo"), liquidate: pct("liquidate"), maxLtv: pct("maxLtv"), source: String(fd.get("ruleSource") || "").trim() || null, asOf: lgToday() };
  for (const k of ["call", "topUpTo", "liquidate", "maxLtv"]) if (rules[k] == null) delete rules[k];
  const acct = { id: F.id || (crypto.randomUUID ? crypto.randomUUID() : "mg-" + Date.now()), name: String(fd.get("name") || "").trim() || "借款帳戶", type: fd.get("type"), source: fd.get("source"), currency: "TWD",
    loan: n("loan"), rate: pct("rate"), startDate: fd.get("startDate") || null, termDays: n("termDays"), cashCollateral: n("cashCollateral"), rules: Object.keys(rules).some(k => !["source", "asOf"].includes(k)) || rules.source ? rules : undefined, collateral, updatedAt: lgToday() };
  const S = mgLoad(), next = { ...S, accounts: F.id ? S.accounts.map(x => (x.id === F.id ? acct : x)) : [...S.accounts, acct] }, v = mgSave(next);
  if (!v.ok) { L.mgForm = { ...F, v: acct, err: [...new Set(v.errors.map(x => MG_ERR[x.code] || x.code))] }; return renderList(); }
  L.mgForm = null; L.msg = F.id ? "已儲存。" : "已加入。"; pfExpire(["lgMg"]); renderList();
}
(function () {
  if (document.getElementById("mgcss")) return; const st = document.createElement("style"); st.id = "mgcss";
  st.textContent = `.mgnote{margin:4px 12px}.mgtable td:first-child{text-align:left}.mgtable{min-width:520px}.mgtable th,.mgtable td{white-space:nowrap}.mgscroll{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}/* 手機上表格比畫面寬：只有表格自己左右滑，不撐開整頁 */.pfbadge.mg-call,.pfbadge.mg-liquidate{background:color-mix(in srgb,var(--s1,#d98a0b) 20%,transparent)}
.altable{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.altable th,.altable td{padding:3px 4px;text-align:right;border-bottom:1px solid var(--line)}.altable th:first-child{text-align:left}
#mgForm textarea{width:100%;min-width:0;font:inherit}`;
  document.head.appendChild(st);
})();
/* ================= 配置（投資組合第 6 階段）：alloc.js 算，這裡畫 =================
   持股：交易紀錄裡還持有的部位；市值用 /api/quote 現價，沒有現價用成本（標估算）；美元用 TWD=X 最新收盤換成台幣；有記入出金時現金也算進總資產。
   ETF 穿透：每一檔 ETF 用 /api/etf 的全部持股與產業分布（各自有資料日期）。產業：股票清單（上市櫃產業別）；美股沒有產業資料就是「未分類」。 */
function lgAllocLib() {
  if (typeof KLAlloc !== "undefined") return Promise.resolve();
  return (W.lgAllocP ||= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "alloc.js"; sc.onload = ok; sc.onerror = () => { W.lgAllocP = null; no(new Error("alloc.js 載入失敗")); }; document.body.appendChild(sc); }));
}
const LG_US_ETF = new Set(["SPY", "QQQ", "VOO", "VTI", "SOXX", "TQQQ", "SOXL", "DIA", "IWM", "IVV", "VT", "SMH", "XLK", "SCHD", "VYM", "VEA", "VWO", "BND", "TLT", "IEF", "GLD", "ARKK"]);
const lgIsEtf = c => /^00\d{2,4}[A-Z]?$/.test(c) || LG_US_ETF.has(c);
const lgAssetType = (c, m = "tw") => { const s = String(c || "").trim().toUpperCase(); return m === "tw" && /^00\d{2,4}B$/.test(s) ? "bond_etf" : lgIsEtf(s) ? "etf" : "stock"; };
function lgLegacyOpen() {
  const raw = W.holdLg ? (W.holdOwn || {}) : (W.hold || W.holdOwn || {});
  if (typeof KLPortfolio === "undefined") return { open: [], skipped: [], demoCount: 0 };
  const R = KLPortfolio.normalizeHoldings(raw, { master: W.stocks, names: W.names }), open = [], skipped = [];
  let demoCount = 0;
  for (const it of R.items) {
    if (it.status === "invalid") { skipped.push({ symbol: it.symbol, msg: it.issues?.[0]?.message || "資料格式不對" }); continue; }
    if (!it.market || !it.currency) { skipped.push({ symbol: it.symbol, msg: "看不出市場，無法換算" }); continue; }
    if (it.isDemo) { demoCount++; continue; }
    if (it.assetType === "future") { skipped.push({ symbol: it.symbol, msg: "期貨不納入配置與再平衡" }); continue; }
    open.push({ symbol: it.symbol, name: it.name, market: it.market, currency: it.currency, shares: it.shares, costBasis: it.costBasis, assetType: lgAssetType(it.symbol, it.market), industry: it.industry });
  }
  return { open, skipped, demoCount };
}
function lgAllocData(P, opts = {}) {
  const syms = P.map(p => p.symbol).sort(), etfs = syms.filter(lgIsEtf), key = syms.join(","), needFx = P.some(p => p.currency === "USD") || !!opts?.needFx, X = W.lgAl;
  if (X && X.key === key && (!needFx || X.hadFxReq) && (X.busy || X.refreshing || Date.now() - X.at < pfTtl(X))) return X;
  const { prev, tok, retry } = pfBegin("lgAl", key, syms.length); // 上一次的資料：代號組合變了也沿用相同代號的報價
  if (!W.stocks && typeof loadStocks === "function") loadStocks().catch(() => {});
  Promise.all([syms.length ? getJ(`/api/quote?codes=${syms.map(encodeURIComponent).join(",")}`).catch(() => null) : null,
    needFx ? getJ(`/api/kline?code=${encodeURIComponent("TWD=X")}&months=1`).catch(() => null) : null,
    Promise.all(etfs.map(c => getJ(`/api/etf?code=${encodeURIComponent(c)}`).catch(() => null))), pfSrcSafe()]).then(([q, fx, E]) => {
    if (W.lgAl?.tok !== tok) return;
    const fresh = new Map((q?.quotes || []).filter(x => x && x.price > 0).map(x => [String(x.code).toUpperCase(), x])), last = fx?.data?.length ? fx.data[fx.data.length - 1] : null;
    const cur = typeof KLPfSrc !== "undefined" ? KLPfSrc.quoteItems(q, new Date().toISOString()) : { ok: !!q?.ok && (q.quotes || []).some(x => x && x.price > 0), items: {} }, { items, meta } = pfMeta("quote", cur, prev?.items, syms);
    const etf = {}; etfs.forEach((c, i) => { const j = E[i]; if (j?.hold?.rows?.length) etf[c] = { date: j.hold.date || null, rows: j.hold.rows.map(r => ({ code: r.code || null, name: r.name || null, pct: r.pct })), ind: j.ind?.rows?.length ? { date: j.ind.date || null, rows: j.ind.rows } : null }; else if (prev?.etf?.[c]) etf[c] = prev.etf[c]; });
    // 匯率：這次沒拿到就沿用上一次的並標示
    const fxv = last ? { rate: last.c, date: String(last.d).slice(0, 10) } : prev?.fx ? { ...prev.fx, kept: true } : null;
    W.lgAl = { key, hadFxReq: needFx, busy: false, at: Date.now(), tok, px: pfKeep(prev?.px, fresh, syms), fx: fxv, etf, items, meta, failed: syms.length ? !cur.ok : false, retried: retry };
    pfRetryLater(W.lgAl); if (W.lt === "hold" && W.holdView === "tx" && ["alloc", "home", "thesis", "report", undefined].includes(W.lg?.view)) renderList(); // 配置、總覽、論點（停損停利）、報告共用
  });
  return W.lgAl;
}
function rbLib() {
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  return (W.lgRbP ||= (typeof KLRebal !== "undefined" ? Promise.resolve() : one("rebal.js")).then(() => one("pf-rebal.js")).then(() => { if (W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "alloc") renderList(); }).catch(e => { W.lgRbP = null; }));
}
function stLib() {
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  return (W.lgStP ||= (typeof KLStress !== "undefined" ? Promise.resolve() : one("stress.js")).then(() => one("pf-stress.js")).then(() => { if (W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "alloc") renderList(); }).catch(e => { W.lgStP = null; }));
}
function renderAlloc(S) {
  const L = KLLedger.buildLedger(S.transactions, { method: S.method, today: lgToday() }), open = L.positions.filter(p => p.open);
  if (!open.length) return ($("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">目前沒有持股，沒有配置可以看。</p>`);
  return renderAllocBody(open, L.cash, { legacy: false });
}
function renderAllocLegacy(leg, hasTx) {
  return renderAllocBody(leg.open, {}, { legacy: true, hasTx, skipped: leg.skipped, demoCount: leg.demoCount });
}
function renderAllocBody(open, cashB, meta = {}) {
  const head = lgViewSeg();
  const banner = meta.legacy ? `<div class="lgbar" style="padding-bottom:0"><span class="note lgwarn">目前看的是<b>舊庫存</b>（${meta.hasTx ? "這次切換檢視" : "沒有交易紀錄"}，<b>現金未知，未納入計算</b>；配置基準僅含納入持股）。</span><button type="button" class="btn sm" data-lg="view" data-v="tx">到交易紀錄建立完整帳本</button>${meta.hasTx ? `<button type="button" class="btn sm" data-lg="hsrcLedger">改回交易紀錄</button>` : ""}</div>` : "";
  const extraIssues = [
    ...(meta.demoCount > 0 ? [`<li>已略過 ${meta.demoCount} 筆範例持股（不是真實部位）；如不需要請到「持股 → 編輯庫存」移除。</li>`] : []),
    ...(meta.skipped?.length ? [`<li>略過 ${meta.skipped.length} 筆無法算入的舊庫存：${meta.skipped.map(x => `${esc(nameOf(x.symbol) || x.symbol)} ${esc(x.symbol)}（${esc(x.msg)}）`).join("、")}。</li>`] : [])
  ];
  if (!open.length) return ($("#lx").innerHTML = head + banner + (extraIssues.length ? `<ul class="note lgwarn alissues">${extraIssues.join("")}</ul><p class="note" style="padding:12px">目前沒有可納入計算的持股。</p>` : `<p class="note" style="padding:12px">目前沒有持股，沒有配置可以看。</p>`));
  if (W.off) return ($("#lx").innerHTML = head + banner + `<p class="note" style="padding:12px">需要部署到網站才有價格資料。</p>`);
  if (typeof KLAlloc === "undefined") { $("#lx").innerHTML = head + skel("載入配置模組…"); lgAllocLib().then(() => renderList(), e => { $("#lx").innerHTML = head + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; }); return; }
  const X = lgAllocData(open, { needFx: !!(cashB?.USD?.tracked && cashB.USD.balance) });
  if (X.busy) return ($("#lx").innerHTML = head + banner + skel(`載入 ${X.n} 檔的報價${open.some(p => lgIsEtf(p.symbol)) ? "與 ETF 成分股" : ""}…`));
  const ind = new Map((Array.isArray(W.stocks) ? W.stocks : []).map(r => [String(r[0]).toUpperCase(), r[3] || null]));
  const pos = open.map(p => { const q = X.px.get(p.symbol); return { symbol: p.symbol, name: q?.name || p.name || nameOf(p.symbol), market: p.market, currency: p.currency, value: q ? p.shares * q.price : p.costBasis, valueEstimated: !q, assetType: lgIsEtf(p.symbol) ? "etf" : "stock", industry: p.industry || ind.get(p.symbol) || null }; });
  const cash = {}, hasCash = Object.values(cashB || {}).some(v => v.tracked); for (const [c, v] of Object.entries(cashB || {})) if (v.tracked && v.balance > 0) cash[c] = v.balance;
  const R = KLAlloc.build(pos, { fx: X.fx, cash, etf: X.etf, asOf: lgToday(), names: Object.fromEntries(pos.map(p => [p.symbol, p.name])) });
  const issues = extraIssues.concat((R.issues || []).map(x => `<li>${esc(KLAlloc.ISSUE_LABEL[x.k] || x.k)}${x.codes ? `：${x.codes.map(c => (nameOf(c) && nameOf(c) !== c ? `${esc(nameOf(c))} ${esc(c)}` : esc(c))).join("、")}` : x.list ? `：${x.list.map(l => `${esc(l.etf)}${l.date ? " " + l.date : ""}${l.covered != null ? ` 揭露 ${l.covered}%` : ""}`).join("、")}` : x.dates ? `：${x.dates.map(d => `${esc(d.etf)} ${d.date || "—"}`).join("、")}` : ""}</li>`)).join("");
  const body = R.status === "no_fx" ? Object.values(R.byCurrency).map(C => alSection(C, `${C.base === "USD" ? "美股（美元）" : "台股（台幣）"}`, meta)).join("") : alSection(R, meta.legacy ? "全部納入持股（台幣計價・現金未知）" : "全部資產（台幣計價）", meta);
  $("#lx").innerHTML = head + banner + `<div class="lgbar"><button type="button" class="btn sm" data-lg="pfreload">重新載入報價</button>${R.fx ? `<small class="note">美元兌台幣 ${R.fx.rate.toFixed(3)}（${esc(R.fx.date || "")}，Yahoo TWD=X 收盤${X.fx?.kept ? "，這次沒拿到，沿用上一次的" : ""}）</small>` : ""}</div>` + pfSrcHtml(X.meta, "報價")
    + (issues ? `<ul class="note lgwarn alissues">${issues}</ul>` : "") + body
    + (typeof rbSectionHtml === "function" && typeof KLRebal !== "undefined" ? rbSectionHtml(open, X, cashB, meta) : (rbLib(), `<p class="note" style="padding:0 12px">載入再平衡試算…</p>`)) // 目標配置與再平衡（rebal.js＋pf-rebal.js，用到時才載入）
    + (typeof stSectionHtml === "function" && typeof KLStress !== "undefined" ? stSectionHtml(open, X, cashB) : (stLib(), `<p class="note" style="padding:0 12px">載入壓力情境…</p>`)) // 壓力情境（stress.js＋pf-stress.js，用到時才載入）
    + `<details class="pfbasis"><summary>計算口徑</summary><ul><li>權重＝市值 ÷ ${hasCash ? "總資產" : "納入持股合計"}（台幣計價；美元用最新匯率換算）。${hasCash ? "有記入金、出金時，現金也算進總資產。" : "目前沒有現金紀錄，現金未知、未納入計算。"}</li>
      <li>沒有現價的持股用成本估算市值，並標示。美股沒有產業資料，歸「未分類」。</li>
      <li>ETF 穿透：ETF 權重 × 成分股占比＝透過 ETF 持有的曝險；只揭露部分成分股時，剩下的歸「其他（未揭露）」。各 ETF 的成分股日期可能不同，會分開列出。</li>
      <li>重疊度：兩檔 ETF 共同成分股的占比取小的加總。有效檔數＝1 ÷ 權重平方和（不含現金）。市值規模、投資策略的分類還沒有資料。</li>
      <li>費用估算口徑：再平衡試算會套用持股頁「手續費折扣」（<code>watch:hdisc</code>）與債券 ETF 免稅；交易紀錄新增時若留空未填費用，目前仍以預設費率估算。</li></ul></details>`;
}
const AL_MKT = { tw: "台股", us: "美股", cash: "現金" }, AL_TYPE = { stock: "個股", etf: "ETF", cash: "現金" };
const alPct = w => (w == null ? "—" : (w * 100).toFixed(1) + "%");
const alBars = (rows, label = g => esc(g)) => `<ul class="albars">${rows.map(r => `<li><span class="nm">${label(r.group)}</span><span class="albar"><i style="width:${Math.max(0.5, r.w * 100).toFixed(1)}%"></i></span><b>${alPct(r.w)}</b></li>`).join("")}</ul>`;
function alSection(R, title, meta = {}) {
  const C = R.concentration, LT = R.lookThrough, cur = R.base;
  const tile = (k, v, sub = "") => `<div class="pftile"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = [tile(meta.legacy ? "納入持股市值" : "總資產", lgMoney(R.total, cur), R.cash ? `含現金 ${lgMoney(R.cash, cur)}` : meta.legacy ? "現金未知（未納入）" : "不含現金（沒有記入出金）"),
    tile("最大單一持股", C.top ? alPct(C.top.w) : "—", C.top ? esc(nameOf(C.top.symbol)) : ""), tile("前五大合計", alPct(C.top5)),
    tile("有效檔數", C.effN ? C.effN.toFixed(1) : "—", "權重越集中，數字越小"), tile("現金比重", meta.legacy ? "未知（未納入）" : alPct(R.cashShare))].join("");
  const top = R.top10.map(h => ({ group: h.symbol, w: h.w, h }));
  const lt = LT && LT.top.length && LT.exposure.some(e => e.viaEtf > 0 || e.notLookedThrough) ? `<h5 class="pfh">ETF 穿透後的實際持股<small class="note">（直接持有＋透過 ETF）</small></h5>
    <table class="altable"><thead><tr><th>股票</th><th>合計</th><th>直接</th><th>透過 ETF</th></tr></thead><tbody>${LT.top.map(e => `<tr><td>${esc(e.name || nameOf(e.code))}<small class="note"> ${esc(e.code)}${e.notLookedThrough ? "（ETF，沒有成分股資料，未穿透）" : ""}</small></td><td><b>${alPct(e.w)}</b></td><td>${e.direct ? alPct(e.direct) : "—"}</td><td>${e.viaEtf ? alPct(e.viaEtf) : "—"}</td></tr>`).join("")}</tbody></table>
    ${LT.dupDirect.length ? `<p class="note">重複持有（直接買了，ETF 裡也有）：${LT.dupDirect.slice(0, 6).map(d => `${esc(d.name || d.code)}（直接 ${alPct(d.direct)}＋ETF ${alPct(d.viaEtf)}）`).join("、")}</p>` : ""}
    ${LT.pairs.length ? `<p class="note">ETF 重疊度：${LT.pairs.slice(0, 5).map(p => `${esc(p.a)} × ${esc(p.b)} ${p.overlap.toFixed(1)}%${p.sameDate ? "" : "（資料日期不同）"}`).join("、")}</p>` : ""}
    <p class="note">成分股資料日期：${LT.dates.map(d => `${esc(d.etf)} ${d.date || "—"}（揭露 ${d.covered}%）`).join("、")}</p>` : "";
  return `<section class="pfcard alcard" data-nofold><h4>${title}${R.estimated ? `<span class="pfbadge">含估算</span>` : ""}</h4><div class="pftiles">${tiles}</div>
    <h5 class="pfh">前十大持股</h5>${alBars(top, g => `${esc(nameOf(g))}<small class="note"> ${esc(g)}</small>`)}
    <div class="algrid"><div><h5 class="pfh">市場</h5>${alBars(R.byMarket, g => AL_MKT[g] || esc(g))}</div><div><h5 class="pfh">類型</h5>${alBars(R.byType, g => AL_TYPE[g] || esc(g))}</div>
      <div><h5 class="pfh">幣別</h5>${alBars(R.byCurrency)}</div><div><h5 class="pfh">產業前五大${R.byIndustryLookThrough ? "（ETF 穿透後）" : ""}</h5>${alBars((R.byIndustryLookThrough || R.byIndustry).slice(0, 5), g => (g === "unknown" ? "未分類" : esc(g)))}</div></div>
    ${lt}</section>`;
}
(function () {
  if (document.getElementById("alcss")) return; const st = document.createElement("style"); st.id = "alcss";
  st.textContent = `.albars{list-style:none;margin:0;padding:0}.albars li{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.4fr) 3.6em;gap:8px;align-items:center;padding:2px 0;font-size:12px}
.albars .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.albar{height:8px;border-radius:4px;background:var(--surface)}.albar i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.albars b{text-align:right;font-variant-numeric:tabular-nums}.algrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px}
.altable{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.altable th,.altable td{padding:3px 4px;text-align:right;border-bottom:1px solid var(--line)}.altable th:first-child,.altable td:first-child{text-align:left}
.alissues{margin:4px 12px;padding-left:1.2em}`;
  document.head.appendChild(st);
})();
// 合併（台幣計價）：美股部位每天用當天匯率換成台幣，和台股部位加總；損益拆成台股、美股股價與股息、匯率三塊（加總＝合併總損益）
function pfFxCard(F) {
  const head = `<section class="pfcard pffx" data-nofold><h4>合併（台幣計價）`;
  if (F.status === "unavailable") return `${head}<span class="pfbadge">無法計算</span></h4><p class="note lgwarn">⚠︎ ${(F.reasons || []).map(r => esc(KLFx.REASON_LABEL[r] || r)).join("；")}。台股、美股的績效分開看下面。</p></section>`;
  const P = F.pnl, m = F.mwr, est = m.status === "estimated" ? `<span class="pfbadge">估算</span>` : m.status === "unavailable" ? `<span class="pfbadge">無法計算</span>` : "";
  const tile = (k, v, sub = "", c = "") => `<div class="pftile"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const reasons = F.reasons.length ? `<p class="note lgwarn pfreasons">⚠︎ 含估算：${F.reasons.map(r => esc(KLFx.REASON_LABEL[r] || KLPerf.REASON_LABEL[r] || r)).join("；")}。</p>` : "";
  return `${head}${F.status !== "ok" ? `<span class="pfbadge">含估算</span>` : ""}<small class="note"> ${F.from || ""}～${F.to || ""}</small></h4>
    <div class="pftiles">${[
      tile("總市值", lgMoney(F.marketValue, "TWD"), `美元部位占 ${F.usdShare == null ? "—" : (F.usdShare * 100).toFixed(0) + "%"}`),
      tile("總損益", lgSgn(P.total, "TWD"), `÷ 累計投入 ${pfPct(P.totalPct)}（不扣賣出、不看時點）`, cls(P.total)),
      tile("時間加權報酬", pfPct(F.twr), F.annualizable ? `年化 ${pfPct(F.twrAnn)}` : "未滿一年，不年化", cls(F.twr)),
      tile("資金加權報酬" + est, m.status === "unavailable" ? "—" : m.annualized ? pfPct(m.value) : pfPct(m.period), m.status === "unavailable" ? "現金流證明不了唯一解或算不出來" : m.annualized ? "年化（XIRR）" : "整段期間，未年化", cls(m.annualized ? m.value : m.period)),
      tile("匯率影響", lgSgn(P.usFx, "TWD"), F.fx.change == null ? "" : `美元兌台幣 ${F.fx.first?.toFixed(2)} → ${F.fx.rate?.toFixed(2)}（${pfPct(F.fx.change)}）`, cls(P.usFx))].join("")}</div>${reasons}
    <dl class="pfpnl"><dt>台股損益</dt><dd class="${cls(P.twStocks)}">${lgSgn(P.twStocks, "TWD")}</dd><dt>美股股價與股息（換成台幣）</dt><dd class="${cls(P.usPrice)}">${lgSgn(P.usPrice, "TWD")}</dd>
      <dt>匯率影響</dt><dd class="${cls(P.usFx)}">${lgSgn(P.usFx, "TWD")}</dd><dt>合計</dt><dd class="${cls(P.total)}"><b>${lgSgn(P.total, "TWD")}</b></dd></dl>
    <p class="note">匯率：${F.fx.rate == null ? "—" : F.fx.rate.toFixed(3)}（${esc(F.fx.date || "")}，${esc(F.fx.source || "")}；是市場中間價，不是銀行實際買賣匯率，換匯成本沒有算進去）。美股每天的市值與現金流都用當天匯率換算。</p></section>`;
}

// 總覽（第 8 階段）：畫面與計算在 pf-home.js、overview.js，用到時才依序載入
function renderThesis(S) {
  if (typeof renderThesisView === "function" && typeof KLThesis !== "undefined") return renderThesisView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入投資論點…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  (W.lgThP ||= (typeof KLThesis !== "undefined" ? Promise.resolve() : one("thesis.js")).then(() => one("pf-thesis.js")).catch(e => { W.lgThP = null; throw e; })).then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}
function renderReport(S) {
  if (typeof renderReportView === "function" && typeof KLReport !== "undefined" && typeof KLOverview !== "undefined" && typeof KLThesis !== "undefined") return renderReportView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入報告…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  const need = [["KLOverview", "overview.js"], ["KLThesis", "thesis.js"], ["KLReport", "report.js"]].filter(([g]) => typeof window[g] === "undefined").map(([, f]) => f);
  (W.lgRpP ||= need.reduce((p, f) => p.then(() => one(f)), Promise.resolve()).then(() => (typeof renderReportView === "function" ? null : one("pf-report.js"))).catch(e => { W.lgRpP = null; throw e; }))
    .then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}
function renderDiv(S) {
  if (typeof renderDivView === "function" && typeof KLDivCal !== "undefined") return renderDivView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入股利現金流…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  (W.lgDvP ||= (typeof KLDivCal !== "undefined" ? Promise.resolve() : one("divcal.js")).then(() => one("pf-divcal.js")).catch(e => { W.lgDvP = null; throw e; })).then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}
function renderHome(S) {
  if (typeof renderHomeView === "function" && typeof KLOverview !== "undefined") return renderHomeView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入總覽…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  (W.lgHomeP ||= one("overview.js").then(() => one("pf-home.js")).catch(e => { W.lgHomeP = null; throw e; })).then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}

/* ================= 交易紀錄截圖匯入（選項 1 持股轉入 ＋ 選項 2 成交明細對帳單） ================= */
let _lgImpUid = 0;
function lgImpState() {
  return (W.lgImp ||= { step: "choose", kind: null, rows: [], method: lgLoad()?.method || "avg", busy: false, dupOk: false, dupSig: "", blurred: new Set(), edited: new Set(), saveTok: 0 });
}
const lgImpHalf = s => String(s ?? "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/／/g, "/").replace(/－/g, "-").trim();
const normImpCode = s => lgImpHalf(s).toUpperCase().replace(/\s+/g, "").replace(/^(\d{4,6}[A-Z]?)\.(?:TW|TWO)$/, "$1");
const okImpCode = c => {
  const s = normImpCode(c);
  return !!s && !!lgMkt(s) && !(typeof isIdx === "function" && isIdx(s));
};
const isBadImpSym = s => {
  const t = lgImpHalf(s).toUpperCase().replace(/\s+/g, "");
  if (!t || okImpCode(t)) return false;
  return !/[\u4e00-\u9fff]/.test(t) && /^[\^A-Z0-9.=_-]{1,20}$/.test(t);
};
function lgStockName(c, fallback = "") {
  const s = normImpCode(c);
  if (!s) return fallback;
  const qn = W.quotes?.get?.(s)?.name;
  if (qn && qn !== s) return qn;
  if (W.names?.[s] && W.names[s] !== s) return W.names[s];
  const st = Array.isArray(W.stocks) ? W.stocks.find(x => String(x[0]).toUpperCase() === s) : null;
  if (st?.[1]) return st[1];
  if (typeof nameOf === "function") {
    const n = nameOf(s);
    if (n && n !== s) return n;
  }
  return fallback;
}
function lgResolveCodeInput(rawCode, rawName) {
  const rawC = String(rawCode ?? "").trim();
  const rawN = String(rawName ?? "").trim();
  for (const s of [rawC, rawN]) {
    if (!s) continue;
    const nc = normImpCode(s);
    if (okImpCode(nc)) return { code: nc, badSym: "", name: lgStockName(nc, rawN && rawN !== nc ? rawN : "") };
  }
  if (rawC && !isBadImpSym(rawC) && typeof findCode === "function") {
    const fc = findCode(rawC, false);
    if (fc && okImpCode(fc)) {
      const nc = normImpCode(fc);
      return { code: nc, badSym: "", name: lgStockName(nc, rawN || rawC) };
    }
  }
  if (!rawC && rawN && typeof findCode === "function") {
    const fc = findCode(rawN, false);
    if (fc && okImpCode(fc)) {
      const nc = normImpCode(fc);
      return { code: nc, badSym: "", name: lgStockName(nc, rawN) };
    }
  }
  if (rawC && isBadImpSym(rawC)) return { code: "", badSym: lgImpHalf(rawC).toUpperCase().replace(/\s+/g, ""), name: rawN || rawC };
  if (!rawC && rawN && isBadImpSym(rawN)) return { code: "", badSym: lgImpHalf(rawN).toUpperCase().replace(/\s+/g, ""), name: rawN };
  return { code: "", badSym: "", name: rawN || rawC };
}
const roundImpTwSh = sh => {
  const r = Math.round(sh);
  if (r >= 1000) {
    const k = Math.round(r / 1000) * 1000;
    if (Math.abs(r - k) / k < 0.015) return k;
  }
  return r;
};
function lgDeriveHoldingRow(raw) {
  const res = lgResolveCodeInput(raw?.code, raw?.name);
  const code = res.code;
  const px = raw?.price != null ? +raw.price : (code ? W.quotes?.get?.(code)?.price : null);
  let sh = raw?.shares != null ? +raw.shares : (raw?.sh != null ? +raw.sh : null);
  let cost = raw?.avgCost != null ? +raw.avgCost : (raw?.cost != null ? +raw.cost : null);
  let how = "", derivedSh = false;
  if (sh > 0 && cost != null && cost >= 0) how = "截圖上的股數與成本";
  else if (sh > 0 && raw?.totalPnl != null && px > 0) { cost = (sh * px - +raw.totalPnl) / sh; how = "用股數與總損益推算成本"; }
  else if (!(sh > 0) && raw?.marketValue > 0 && px > 0) {
    sh = +raw.marketValue / px; derivedSh = true;
    if (cost == null && raw?.totalPnl != null && sh > 0) cost = (+raw.marketValue - +raw.totalPnl) / sh;
    how = "用市值推算股數" + (cost != null && cost >= 0 ? "與成本" : "，請填成本");
  } else if (!(sh > 0) && raw?.totalPnl != null && raw?.totalPnlPct && px > 0) {
    const ct = +raw.totalPnl / (+raw.totalPnlPct / 100), mv = ct + +raw.totalPnl;
    sh = mv / px; derivedSh = true; cost = sh > 0 ? ct / sh : null; how = "用總損益與報酬率推算";
  } else if (!(sh > 0) && raw?.todayPnl != null && raw?.chgPct && px > 0) {
    const chg = px - px / (1 + +raw.chgPct / 100);
    sh = chg ? +raw.todayPnl / chg : null; derivedSh = true; how = "用今日損益推算股數（誤差較大），請填成本";
  } else how = "截圖上看不出股數或成本，請手動填";
  if (derivedSh && sh > 0) sh = lgMkt(code) === "us" ? +sh.toFixed(4) : roundImpTwSh(sh);
  if (raw?.avgCost == null && raw?.cost == null && cost != null && cost >= 0) cost = +cost.toFixed(cost >= 100 ? 1 : 2);
  const dIn = typeof raw?.d === "string" && raw.d.trim() ? raw.d.trim() : typeof raw?.date === "string" && raw.date.trim() ? raw.date.trim() : "";
  return {
    _uid: ++_lgImpUid,
    on: typeof raw?.on === "boolean" ? raw.on : undefined,
    code, badSym: res.badSym, name: res.name,
    sh: sh != null && Number.isFinite(sh) && sh > 0 ? sh : null,
    cost: cost != null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    d: dIn, dTouched: !!dIn,
    how, verifyErr: null, _fresh: false, _lookingUp: false, _lookupSeq: 0
  };
}
function lgMapTradeRow(raw) {
  const res = lgResolveCodeInput(raw?.code, raw?.name);
  const side = raw?.side === "buy" || raw?.type === "buy" ? "buy" : raw?.side === "sell" || raw?.type === "sell" ? "sell" : "";
  const sh = raw?.shares != null ? +raw.shares : (raw?.sh != null ? +raw.sh : null);
  const px = raw?.price != null ? +raw.price : null;
  const fee = raw?.fee === 0 ? 0 : (raw?.fee != null && Number.isFinite(+raw.fee) ? +raw.fee : null);
  const tax = raw?.tax === 0 ? 0 : (raw?.tax != null && Number.isFinite(+raw.tax) ? +raw.tax : null);
  return {
    _uid: ++_lgImpUid,
    on: raw?.on !== false,
    date: typeof raw?.date === "string" ? raw.date.trim() : lgToday(),
    dateAssumed: raw?.dateAssumed === "year" || raw?.dateAssumed === "today" ? raw.dateAssumed : null,
    side, code: res.code, badSym: res.badSym, name: res.name,
    shares: sh != null && Number.isFinite(sh) ? sh : null,
    price: px != null && Number.isFinite(px) ? px : null,
    fee, tax,
    dayTrade: side === "sell" && !!raw?.dayTrade,
    note: typeof raw?.note === "string" ? raw.note.trim() : "",
    verifyErr: null, _fresh: false, _lookingUp: false, _lookupSeq: 0
  };
}
function lgNewBlankRow(kind) {
  if (kind === "holdings") {
    return { _uid: ++_lgImpUid, on: true, code: "", badSym: "", name: "", sh: null, cost: null, d: lgToday(), dTouched: true, how: "", verifyErr: null, _fresh: true, _lookingUp: false, _lookupSeq: 0 };
  }
  return { _uid: ++_lgImpUid, on: true, date: lgToday(), dateAssumed: null, side: "buy", code: "", badSym: "", name: "", shares: null, price: null, fee: null, tax: null, dayTrade: false, note: "", verifyErr: null, _fresh: true, _lookingUp: false, _lookupSeq: 0 };
}
function lgImpErrField(kind, code) {
  if (code === "invalid_date" || code === "future_date" || code === "date_too_old") return kind === "holdings" ? "d" : "date";
  if (code === "invalid_type") return "side";
  if (["invalid_symbol", "invalid_market", "invalid_currency", "currency_mismatch", "currency_conflict", "verify_symbol"].includes(code)) return "code";
  if (["invalid_shares", "fractional_shares", "oversell", "over_transfer"].includes(code)) return kind === "holdings" ? "sh" : "shares";
  if (code === "invalid_price") return kind === "holdings" ? "cost" : "price";
  if (code === "invalid_fee") return "fee";
  if (code === "invalid_tax") return "tax";
  return "code";
}
function lgImpErrMsg(err, r) {
  if (!err) return "";
  if (err.code === "invalid_symbol") return r.name && !r.code && !r.badSym ? `找不到「${r.name}」的代號，請輸入台股或美股代號` : "請輸入台股或美股代號（例如 2330、NVDA）";
  if (err.code === "invalid_market") return "僅支援台股與美股（例如 2330、NVDA，不支援指數、期貨或海外市場）";
  if (err.code === "invalid_type") return "請選擇買進或賣出";
  return err.message || "";
}
function lgPrepare(S, opts = {}) {
  const existing = lgLoad();
  const existingTxs = Array.isArray(existing?.transactions) ? existing.transactions : [];
  const method = existing ? existing.method : (S.method === "fifo" ? "fifo" : "avg");
  const today = lgToday();
  const mktFn = sym => (okImpCode(sym) ? lgMkt(sym) : null);
  const idPrefix = opts.finalIds ? undefined : "lgimp-p-";
  let P;
  if (S.kind === "holdings") {
    const mapped = S.rows.map(r => ({
      on: r.on,
      symbol: r.code || r.badSym || "",
      name: r.name,
      shares: r.sh,
      avgCost: r.cost,
      date: r.dTouched ? r.d : (r.d || null),
      how: r.how,
      source: "import"
    }));
    P = KLLedger.prepareHoldingsImport(mapped, existingTxs, { method, today, market: mktFn, ...(idPrefix ? { idPrefix } : {}) });
  } else {
    const mapped = S.rows.map(r => {
      const sym = r.code || r.badSym || "", m = sym && okImpCode(sym) ? lgMkt(sym) : null;
      return {
        on: r.on !== false,
        date: r.date ?? "",
        dateAssumed: r.dateAssumed || null,
        side: r.side || "",
        symbol: sym,
        name: r.name,
        shares: r.shares,
        price: r.price,
        fee: r.fee,
        tax: r.tax,
        ...(m ? { assetType: lgAssetType(sym, m) } : {}),
        dayTrade: r.side === "sell" && !!r.dayTrade,
        note: r.note || "",
        source: "import"
      };
    });
    P = KLLedger.prepareTradesImport(mapped, existingTxs, { method, today, market: mktFn, ...(idPrefix ? { idPrefix } : {}) });
  }
  let extraErr = 0;
  for (const it of P.items) {
    const r = S.rows[it.index];
    if (r?.verifyErr && !it.errors.some(e => e.code === "verify_symbol")) {
      it.errors.push({ code: "verify_symbol", message: r.verifyErr });
      if (it.on) extraErr++;
    }
  }
  if (extraErr > 0) {
    P.errorCount += extraErr;
    P.ok = P.selectedCount > 0 && P.errorCount === 0;
  }
  return P;
}
function lgImpFieldErrors(kind, errors) {
  const m = new Map();
  for (const e of errors || []) {
    const k = lgImpErrField(kind, e.code);
    if (!m.has(k)) m.set(k, e);
  }
  return m;
}
function lgImpSeedErrors(S, P) {
  for (const it of P.items) {
    const r = S.rows[it.index];
    if (!r || !it.on || r._fresh || !it.errors.length) continue;
    for (const e of it.errors) S.blurred.add(`${r._uid}:${lgImpErrField(S.kind, e.code)}`);
  }
}
function lgImpChooseHtml() {
  return `<p class="note">選擇要匯入哪一種券商 App 截圖。系統會先讓你在表格核對並檢查錯誤，按下確認後才會寫入交易紀錄（<code>kline:pf:v1</code>）；舊庫存（<code>kline:watch:hold</code>）完全不動。</p>
    <div class="lgimp-cards">
      <button type="button" class="lgimp-card" data-lgimp-pick="holdings">
        <strong>1. 庫存／持股截圖</strong>
        <small>匯入為「股票轉入」，手續費與稅為 0。帳本裡已經持有的部位會預設略過（不勾選），避免重複計算。</small>
      </button>
      <button type="button" class="lgimp-card" data-lgimp-pick="trades">
        <strong>2. 成交明細／對帳單截圖</strong>
        <small>匯入為「買進／賣出」，保留分批成交紀錄；空白費用依預設規則估算（0 元維持 0），自動依時間排序並擋下賣超。</small>
      </button>
    </div>
    <div class="row2"><button type="button" class="btn sm" data-ic="close">取消</button></div>`;
}
function lgImpRowHtml(r, i, kind, item, today) {
  const uid = r._uid;
  const codeVal = r.code || r.badSym || r.name || "";
  const dupWarn = (item?.warnings || []).filter(w => w.code !== "fee_estimated").map(w => w.message).join("；");
  if (kind === "holdings") {
    const dVal = r.dTouched ? (r.d || "") : (item?.date || today);
    const meta = [r._lookingUp ? "查詢代號中…" : "", !r._lookingUp && r.code ? lgStockName(r.code, r.name) : "", !r._lookingUp && item?.duplicateOpen ? (item.on ? `帳本已有 ${lgN(item.existingShares)} 股` : item.skipReason) : (!r._lookingUp && r.how && r.how !== "截圖上的股數與成本" ? r.how : "")].filter(Boolean).join("・");
    return `<tr data-row="${i}" data-uid="${uid}">
      <td><input type="checkbox" data-lgimp-uid="${uid}" data-lgimp-k="on" aria-label="匯入第 ${i + 1} 列" ${item?.on ? "checked" : ""}></td>
      <td><input class="code" data-lgimp-uid="${uid}" data-lgimp-k="code" value="${esc(codeVal)}" placeholder="2330 或 NVDA" autocomplete="off" autocapitalize="characters" aria-label="代號或名稱" aria-invalid="false">
        <small id="lgim-${uid}" data-lgimp-meta="${uid}"${meta ? "" : " hidden"}>${esc(meta)}</small>
        <small id="lgie-${uid}-code" class="lgimp-err" hidden></small></td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="sh" value="${r.sh ?? ""}" placeholder="1000" aria-label="股數" aria-invalid="false">
        <small id="lgie-${uid}-sh" class="lgimp-err" hidden></small></td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="cost" value="${r.cost ?? ""}" placeholder="650" aria-label="每股成本" aria-invalid="false">
        <small id="lgie-${uid}-cost" class="lgimp-err" hidden></small></td>
      <td><input type="date" data-lgimp-uid="${uid}" data-lgimp-k="d" value="${esc(dVal)}" max="${today}" aria-label="轉入日期" aria-invalid="false">
        <small data-lgimp-dtag="${uid}" class="lgimp-tag"${item?.dateAssumed === "today" ? "" : " hidden"}>${item?.dateAssumed === "today" ? "未含日期，已帶入今天" : ""}</small>
        <small id="lgie-${uid}-d" class="lgimp-err" hidden></small></td>
      <td><button type="button" class="hg-del" data-lgimp-del="${uid}" aria-label="刪除第 ${i + 1} 列">✕</button></td>
    </tr>`;
  }
  const dTagText = r.dateAssumed === "year" ? "年份待確認（請核對）" : r.dateAssumed === "today" ? "未含日期，已帶入今天" : "";
  const est = item?.on && !item?.errors?.length && (r.side === "buy" || r.side === "sell") && item?.computed?.feeEstimated
    ? [r.fee == null ? `手續費估 ${lgN(item.computed.fee)}` : "", r.side === "sell" && r.tax == null ? `稅估 ${lgN(item.computed.tax)}` : ""].filter(Boolean).join("・")
    : "";
  const meta = [r._lookingUp ? "查詢代號中…" : "", !r._lookingUp && r.code ? lgStockName(r.code, r.name) : "", !r._lookingUp ? est : ""].filter(Boolean).join("・");
  return `<tr data-row="${i}" data-uid="${uid}">
    <td><input type="checkbox" data-lgimp-uid="${uid}" data-lgimp-k="on" aria-label="匯入第 ${i + 1} 列" ${item?.on ? "checked" : ""}></td>
    <td><input type="date" data-lgimp-uid="${uid}" data-lgimp-k="date" value="${esc(r.date ?? "")}" max="${today}" aria-label="成交日期" aria-invalid="false">
      <small data-lgimp-dtag="${uid}" class="lgimp-tag"${dTagText ? "" : " hidden"}>${esc(dTagText)}</small>
      <small id="lgie-${uid}-date" class="lgimp-err" hidden></small></td>
    <td><select data-lgimp-uid="${uid}" data-lgimp-k="side" aria-label="方向" aria-invalid="false">
        <option value=""${!r.side ? " selected" : ""}>請選擇</option>
        <option value="buy"${r.side === "buy" ? " selected" : ""}>買進</option>
        <option value="sell"${r.side === "sell" ? " selected" : ""}>賣出</option>
      </select>
      <label class="lgimp-sub"><input type="checkbox" data-lgimp-uid="${uid}" data-lgimp-k="dayTrade" ${r.side === "sell" && r.dayTrade ? "checked" : ""} ${r.side === "sell" ? "" : "disabled"}> 現股當沖</label>
      <small id="lgie-${uid}-side" class="lgimp-err" hidden></small></td>
    <td><input class="code" data-lgimp-uid="${uid}" data-lgimp-k="code" value="${esc(codeVal)}" placeholder="2330 或 NVDA" autocomplete="off" autocapitalize="characters" aria-label="代號或名稱" aria-invalid="false">
      <small id="lgim-${uid}" data-lgimp-meta="${uid}"${meta ? "" : " hidden"}>${esc(meta)}</small>
      <small data-lgimp-warn="${uid}" class="lgimp-tag"${dupWarn ? "" : " hidden"}>${dupWarn ? "⚠︎ " + esc(dupWarn) : ""}</small>
      <small id="lgie-${uid}-code" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="shares" value="${r.shares ?? ""}" placeholder="1000" aria-label="股數" aria-invalid="false">
      <small id="lgie-${uid}-shares" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="price" value="${r.price ?? ""}" placeholder="900" aria-label="單價" aria-invalid="false">
      <small id="lgie-${uid}-price" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="fee" value="${r.fee ?? ""}" placeholder="估算" aria-label="手續費" aria-invalid="false">
      <small id="lgie-${uid}-fee" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="tax" value="${r.tax ?? ""}" placeholder="估算" aria-label="交易稅" aria-invalid="false">
      <small id="lgie-${uid}-tax" class="lgimp-err" hidden></small></td>
    <td><input class="lgimp-note" data-lgimp-uid="${uid}" data-lgimp-k="note" maxlength="200" value="${esc(r.note || "")}" placeholder="選填" aria-label="備註"></td>
    <td><button type="button" class="hg-del" data-lgimp-del="${uid}" aria-label="刪除第 ${i + 1} 列">✕</button></td>
  </tr>`;
}
function lgImpReviewHtml(S, P) {
  const isHold = S.kind === "holdings", today = lgToday(), existing = lgLoad();
  const intro = isHold
    ? "核對後將匯入為交易紀錄的「股票轉入」（手續費與稅為 0）。帳本目前已經持有的股票預設不勾選，以免重複計算；未勾選的列不會寫入。"
    : "核對每一筆成交明細（依日期由舊到新排序套用）。同天分批成交都會保留；手續費／稅填 0 維持 0，空白則依預設費率估算。";
  const cols = isHold
    ? `<th scope="col">匯入</th><th scope="col">代號／名稱</th><th scope="col">股數<small>美股可填小數</small></th><th scope="col">每股成本</th><th scope="col">轉入日期<small>空白預設今天</small></th><th scope="col"><span class="pfsr">刪除</span></th>`
    : `<th scope="col">匯入</th><th scope="col">成交日期</th><th scope="col">方向<small>賣出可勾當沖</small></th><th scope="col">代號／名稱</th><th scope="col">股數</th><th scope="col">單價</th><th scope="col">手續費<small>空白＝估算</small></th><th scope="col">交易稅<small>空白＝估算</small></th><th scope="col">備註</th><th scope="col"><span class="pfsr">刪除</span></th>`;
  const rowsHtml = S.rows.map((r, i) => lgImpRowHtml(r, i, S.kind, P.items[i], today)).join("");
  return `<form class="lgimp-form" id="lgImpForm" novalidate>
    <p class="note lgimp-intro">${intro}</p>
    <div class="lgimp-mid">
      <div class="lgimp-msg err" id="lgImpGlobalErr" hidden></div>
      <div class="hg-wrap" tabindex="0" role="region" aria-labelledby="impTitle">
        <table class="hgrid ${isHold ? "lgimp-h" : "lgimp-t"}">
          <thead><tr>${cols}</tr></thead>
          <tbody id="lgImpTbody">${rowsHtml}</tbody>
        </table>
      </div>
      <div class="row2" style="margin:8px 0">
        <button type="button" class="btn sm" data-lgimp-add>＋ 新增一列</button>
        <button type="button" class="btn sm" data-lgimp-shot>＋ 再加截圖</button>
        <button type="button" class="btn sm" data-lgimp-back>改選匯入類型</button>
      </div>
      ${!existing ? `<label class="lgimp-method">成本算法 <select id="lgImpMethod" data-lgimp-method><option value="avg"${S.method === "avg" ? " selected" : ""}>加權平均成本</option><option value="fifo"${S.method === "fifo" ? " selected" : ""}>先進先出（FIFO）</option></select></label>` : ""}
      ${isHold ? `<label class="lgimp-sub" style="white-space:normal" id="lgImpIncOpenWrap"><input type="checkbox" id="lgImpIncOpen" data-lgimp-open> <span id="lgImpIncOpenLbl">包含帳本已有部位（0 檔）</span></label>` : ""}
      <label class="lgimp-dup" id="lgImpDupWrap" hidden><input type="checkbox" id="lgImpDup" data-lgimp-dup> <span id="lgImpDupTxt"></span></label>
    </div>
    <div class="lgimp-foot">
      <p class="lgimp-sum" id="lgImpSum"></p>
      <div class="row2"><button type="submit" class="btn primary sm" id="lgImpSave"></button><button type="button" class="btn sm" data-ic="close">取消</button></div>
    </div>
  </form>`;
}
function lgSyncImportUI(opts = {}) {
  const S = lgImpState(), form = $("#lgImpForm");
  if (!form || S.step !== "review") return null;
  const P = lgPrepare(S), today = lgToday(), isHold = S.kind === "holdings", ae = document.activeElement;
  let visibleErrCount = 0;
  for (let i = 0; i < S.rows.length; i++) {
    const r = S.rows[i], item = P.items[i], tr = form.querySelector(`tr[data-uid="${r._uid}"]`);
    if (!tr) continue;
    tr.dataset.row = String(i);
    const delBtn = tr.querySelector("[data-lgimp-del]");
    if (delBtn) delBtn.setAttribute("aria-label", `刪除第 ${i + 1} 列`);
    const fieldErrs = item ? lgImpFieldErrors(S.kind, item.errors) : new Map();
    const rowShownErrs = [];
    const fields = isHold ? ["code", "sh", "cost", "d"] : ["date", "side", "code", "shares", "price", "fee", "tax"];
    for (const k of fields) {
      const inp = tr.querySelector(`[data-lgimp-k="${k}"]`), errEl = document.getElementById(`lgie-${r._uid}-${k}`);
      const eObj = item?.on && S.blurred.has(`${r._uid}:${k}`) ? fieldErrs.get(k) : null;
      if (eObj) { visibleErrCount++; rowShownErrs.push({ k, msg: lgImpErrMsg(eObj, r) }); }
      if (inp) {
        inp.setAttribute("aria-invalid", eObj ? "true" : "false");
        const desc = [];
        if (eObj) desc.push(`lgie-${r._uid}-${k}`);
        if (k === "code") {
          const m = tr.querySelector(`[data-lgimp-meta="${r._uid}"]`);
          if (m && !m.hidden) desc.push(m.id);
        }
        if (desc.length) inp.setAttribute("aria-describedby", desc.join(" "));
        else inp.removeAttribute("aria-describedby");
        if (ae !== inp && isHold && k === "d" && !r.dTouched && item?.date && inp.value !== item.date) inp.value = item.date;
      }
      if (errEl) {
        const msg = eObj ? lgImpErrMsg(eObj, r) : "";
        errEl.textContent = msg;
        errEl.hidden = !msg;
      }
    }
    const onInp = tr.querySelector('[data-lgimp-k="on"]');
    if (onInp) {
      const want = !!item?.on;
      if (onInp.checked !== want) onInp.checked = want;
      onInp.setAttribute("aria-label", `匯入第 ${i + 1} 列`);
    }
    if (!isHold) {
      const dtInp = tr.querySelector('[data-lgimp-k="dayTrade"]');
      if (dtInp) {
        const canDt = r.side === "sell";
        dtInp.disabled = !canDt;
        const wantDt = canDt && !!r.dayTrade;
        if (dtInp.checked !== wantDt) dtInp.checked = wantDt;
      }
      const dTag = tr.querySelector(`[data-lgimp-dtag="${r._uid}"]`);
      if (dTag) {
        const t = r.dateAssumed === "year" ? "年份待確認（請核對）" : r.dateAssumed === "today" ? "未含日期，已帶入今天" : "";
        dTag.textContent = t;
        dTag.hidden = !t;
      }
      const wTag = tr.querySelector(`[data-lgimp-warn="${r._uid}"]`);
      if (wTag) {
        const w = (item?.warnings || []).filter(x => x.code !== "fee_estimated").map(x => x.message).join("；");
        wTag.textContent = w ? "⚠︎ " + w : "";
        wTag.hidden = !w;
      }
    } else {
      const dTag = tr.querySelector(`[data-lgimp-dtag="${r._uid}"]`);
      if (dTag) {
        const showT = item?.dateAssumed === "today";
        dTag.textContent = showT ? "未含日期，已帶入今天" : "";
        dTag.hidden = !showT;
      }
    }
    const metaEl = tr.querySelector(`[data-lgimp-meta="${r._uid}"]`);
    if (metaEl) {
      const parts = [];
      if (r._lookingUp) parts.push("查詢代號中…");
      else {
        if (r.code) parts.push(lgStockName(r.code, r.name) || r.code);
        if (isHold) {
          if (item?.duplicateOpen) parts.push(item.on ? `帳本已有 ${lgN(item.existingShares)} 股` : item.skipReason);
          else if (r.how && r.how !== "截圖上的股數與成本") parts.push(r.how);
        } else if (item?.on && !item?.errors?.length && (r.side === "buy" || r.side === "sell") && item?.computed?.feeEstimated) {
          const est = [r.fee == null ? `手續費估 ${lgN(item.computed.fee)}` : "", r.side === "sell" && r.tax == null ? `稅估 ${lgN(item.computed.tax)}` : ""].filter(Boolean).join("・");
          if (est) parts.push(est);
        }
      }
      const mTxt = parts.join("・");
      metaEl.textContent = mTxt;
      metaEl.hidden = !mTxt;
      const codeInp = tr.querySelector('[data-lgimp-k="code"]');
      if (codeInp) {
        const desc = [];
        if (rowShownErrs.some(x => x.k === "code")) desc.push(`lgie-${r._uid}-code`);
        if (mTxt) desc.push(metaEl.id);
        if (desc.length) codeInp.setAttribute("aria-describedby", desc.join(" "));
        else codeInp.removeAttribute("aria-describedby");
      }
    }
    const hasWarn = !rowShownErrs.length && (item?.warnings || []).some(w => w.code !== "fee_estimated");
    tr.classList.toggle("bad", rowShownErrs.length > 0);
    tr.classList.toggle("warn", hasWarn);
    tr.classList.toggle("skip-existing", isHold && !item?.on && !!item?.duplicateOpen);
  }
  const incOpenEl = $("#lgImpIncOpen"), incOpenLbl = $("#lgImpIncOpenLbl");
  if (incOpenEl && isHold) {
    const openItems = P.items.filter(it => it.duplicateOpen);
    const nOpen = openItems.length, nChk = openItems.filter(it => it.on).length;
    incOpenEl.disabled = nOpen === 0;
    incOpenEl.checked = nOpen > 0 && nChk === nOpen;
    incOpenEl.indeterminate = nOpen > 0 && nChk > 0 && nChk < nOpen;
    if (incOpenLbl) incOpenLbl.textContent = `包含帳本已有部位（${nOpen} 檔）`;
  }
  const dupWrap = $("#lgImpDupWrap"), dupEl = $("#lgImpDup"), dupTxt = $("#lgImpDupTxt");
  const dupSig = (P.duplicates || []).map(it => [it.tx.date, it.tx.type, it.tx.symbol, it.tx.shares, it.tx.price].join("|")).sort().join(";");
  if (S.dupSig !== dupSig) {
    S.dupSig = dupSig;
    if (!dupSig) S.dupOk = false;
  }
  if (dupWrap && dupEl && dupTxt) {
    const nDup = (P.duplicates || []).length;
    dupWrap.hidden = nDup === 0;
    if (nDup > 0) {
      const syms = [...new Set(P.duplicates.map(it => it.tx.symbol).filter(Boolean))].join("、");
      dupTxt.textContent = `偵測到 ${nDup} 筆可能與帳本重複的交易（${syms}）。若確認不是重複匯入，請勾選確認後再儲存。`;
      if (dupEl.checked !== S.dupOk) dupEl.checked = S.dupOk;
      if (S.dupOk) dupEl.setAttribute("aria-invalid", "false");
    } else {
      dupEl.checked = false;
      dupEl.setAttribute("aria-invalid", "false");
    }
  }
  const globalErr = $("#lgImpGlobalErr");
  if (globalErr) {
    if (P.newErrors?.length) {
      const msgs = P.newErrors.map(x => `${x.date || ""} ${x.symbol || ""}：${x.errors?.[0]?.message || "出錯"}`).join("；");
      globalErr.textContent = `⚠︎ 匯入後會讓帳本既有的交易出錯（${msgs}），請調整日期或股數。`;
      globalErr.hidden = false;
    } else {
      globalErr.textContent = "";
      globalErr.hidden = true;
    }
  }
  const sumEl = $("#lgImpSum");
  if (sumEl) {
    const ex = lgLoad();
    const mNote = ex ? ` 沿用帳本「${KLLedger.METHODS[ex.method] || ex.method}」。` : "";
    if (isHold) {
      sumEl.textContent = `共讀取 ${S.rows.length} 列，將匯入 ${P.selectedCount} 筆「股票轉入」${P.existingOpenCount ? `（帳本已有 ${P.existingOpenCount} 檔，預設略過）` : ""}，手續費與稅為 0；不會改動舊庫存。${mNote}`;
    } else {
      sumEl.textContent = `共 ${S.rows.length} 列，將匯入 ${P.selectedCount} 筆成交交易（依時間由舊到新排序套用）${P.feeEstimatedCount ? `；${P.feeEstimatedCount} 筆空白費用依預設費率估算` : ""}。${mNote}`;
    }
  }
  const saveBtn = $("#lgImpSave");
  if (saveBtn) {
    saveBtn.disabled = !!S.busy;
    saveBtn.textContent = S.busy ? "確認代號中…" : (isHold ? `匯入 ${P.selectedCount} 筆轉入` : `匯入 ${P.selectedCount} 筆交易`);
  }
  if (opts.announceRow != null && opts.announceKey) {
    const idx = S.rows.findIndex(r => String(r._uid) === String(opts.announceRow));
    if (idx >= 0) {
      const it = P.items[idx], fe = it?.on ? lgImpFieldErrors(S.kind, it.errors) : new Map();
      const hit = fe.get(opts.announceKey);
      if (hit) impSetLive("⚠︎ " + lgImpErrMsg(hit, S.rows[idx]), "err");
      else if (!visibleErrCount && !$("#impLive")?.hidden) impSetLive("");
    }
  }
  return P;
}
function lgOpenImport() {
  if (typeof loadStocks === "function") loadStocks().catch(() => {});
  const S = (W.lgImp = { step: "choose", kind: null, rows: [], method: lgLoad()?.method || "avg", busy: false, dupOk: false, dupSig: "", blurred: new Set(), edited: new Set(), saveTok: (W.lgImp?.saveTok || 0) + 1 });
  impSetLive("");
  showImpDialog("截圖匯入到交易紀錄", lgImpChooseHtml(), { wide: false, scope: "ledger", focus: '[data-lgimp-pick="holdings"]', forceFocus: true });
  return S;
}
function lgOnImportBusy(count, mode) {
  const S = lgImpState();
  S.step = "busy"; S.kind = mode === "trades" ? "trades" : "holdings"; S.busy = true;
  impSetLive("");
  const lbl = S.kind === "trades" ? "成交明細／對帳單" : "庫存／持股";
  const html = `<progress max="100"></progress><p class="note">正在讀取 ${count} 張${lbl}截圖…（AI 讀圖約需 10～30 秒）</p>
    <div class="row2"><button type="button" class="btn sm" data-ic="close">取消</button></div>`;
  showImpDialog(S.kind === "trades" ? "匯入成交明細" : "匯入庫存轉入", html, { wide: false, scope: "ledger", focus: '#impBody [data-ic="close"]', forceFocus: true });
}
function lgOnImportRows(rows, mode) {
  const S = lgImpState(), kind = mode === "trades" ? "trades" : "holdings";
  const prevRows = S.kind === kind ? S.rows : [];
  S.kind = kind; S.step = "review"; S.busy = false;
  if (kind === "holdings") {
    const incoming = (Array.isArray(rows) ? rows : []).map(lgDeriveHoldingRow);
    const merged = prevRows.slice();
    for (const x of incoming) {
      const idx = merged.findIndex(y => (x.code && y.code === x.code) || (x.badSym && y.badSym === x.badSym) || (!x.code && !x.badSym && y.name === x.name));
      if (idx >= 0) {
        const p = merged[idx];
        merged[idx] = {
          ...p,
          code: x.code || p.code, badSym: x.code ? "" : (x.badSym || p.badSym), name: x.name || p.name,
          sh: x.sh != null ? x.sh : p.sh, cost: x.cost != null ? x.cost : p.cost,
          d: p.dTouched ? p.d : (x.d || p.d), dTouched: p.dTouched || x.dTouched,
          how: x.how || p.how, on: p.on, verifyErr: null, _fresh: false
        };
      } else merged.push(x);
    }
    S.rows = merged;
  } else {
    S.rows = [...prevRows, ...(Array.isArray(rows) ? rows : []).map(lgMapTradeRow)];
  }
  const P = lgPrepare(S);
  lgImpSeedErrors(S, P);
  impSetLive("");
  showImpDialog(kind === "trades" ? "核對成交明細匯入" : "核對庫存轉入", lgImpReviewHtml(S, P), { wide: true, scope: "ledger", focus: false });
  lgSyncImportUI();
  ($('#impBody [aria-invalid="true"]') || $('#impBody input.code') || $('#lgImpSave'))?.focus?.({ preventScroll: true });
}
function lgOnImportErr(msg) {
  const S = lgImpState();
  S.busy = false;
  const errTxt = msg || "讀圖失敗，請稍後再試";
  if (S.rows.length > 0 && S.kind) {
    S.step = "review";
    const P = lgPrepare(S);
    showImpDialog(S.kind === "trades" ? "核對成交明細匯入" : "核對庫存轉入", lgImpReviewHtml(S, P), { wide: true, scope: "ledger", focus: false });
    lgSyncImportUI();
    $("#lgImpSave")?.focus?.({ preventScroll: true });
    impSetLive("⚠︎ " + errTxt + "（已保留原本資料）", "err");
    return;
  }
  S.step = "err";
  const html = `<p class="note">可以重新上傳清楚一點的截圖、改選匯入類型，或改用手動表格輸入。</p>
    <div class="row2">
      <button type="button" class="btn primary sm" data-lgimp-retry>重新選擇截圖</button>
      <button type="button" class="btn sm" data-lgimp-blank>改用手動表格輸入</button>
      <button type="button" class="btn sm" data-lgimp-back>改選匯入類型</button>
      <button type="button" class="btn sm" data-ic="close">關閉</button>
    </div>`;
  showImpDialog("截圖匯入失敗", html, { wide: false, scope: "ledger", focus: "[data-lgimp-retry]", forceFocus: true });
  impSetLive("⚠︎ " + errTxt, "err");
}
function lgImpReadNum(el) {
  if (!el) return null;
  if (el.validity?.badInput) return NaN;
  const s = String(el.value ?? "").trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function lgOnImportInput(e) {
  const S = lgImpState(), t = e.target;
  if (S.step !== "review" || t.type === "checkbox" || t.tagName === "SELECT") return;
  const uid = t.dataset?.lgimpUid, k = t.dataset?.lgimpK;
  if (!uid || !k) return;
  const r = S.rows.find(x => String(x._uid) === String(uid));
  if (!r) return;
  r._fresh = false;
  S.edited.add(`${uid}:${k}`);
  S.blurred.delete(`${uid}:${k}`);
  if (k === "code") {
    const res = lgResolveCodeInput(t.value, "");
    r.code = res.code; r.badSym = res.badSym; r.name = res.name; r.verifyErr = null;
  } else if (k === "d") {
    if (t.value) { r.d = t.value; r.dTouched = true; } else { r.d = ""; r.dTouched = false; }
  } else if (k === "date") {
    r.date = t.value; r.dateAssumed = null;
  } else if (k === "note") {
    r.note = String(t.value || "").trim();
  } else if (["sh", "cost", "shares", "price", "fee", "tax"].includes(k)) {
    r[k] = lgImpReadNum(t);
  }
  lgSyncImportUI();
}
function lgOnImportChange(e) {
  const S = lgImpState(), t = e.target;
  if (S.step !== "review") return;
  if (t.matches("[data-lgimp-method]")) { S.method = t.value === "fifo" ? "fifo" : "avg"; lgSyncImportUI(); return; }
  if (t.matches("[data-lgimp-dup]")) { S.dupOk = !!t.checked; if (S.dupOk && !$("#impLive")?.hidden) impSetLive(""); lgSyncImportUI(); return; }
  if (t.matches("[data-lgimp-open]")) {
    const P = lgPrepare(S), want = !!t.checked;
    for (const it of P.items) if (it.duplicateOpen) S.rows[it.index].on = want;
    lgSyncImportUI();
    return;
  }
  const uid = t.dataset?.lgimpUid, k = t.dataset?.lgimpK;
  if (!uid || !k) return;
  const r = S.rows.find(x => String(x._uid) === String(uid));
  if (!r) return;
  if (k === "on") {
    r.on = !!t.checked;
    if (!r.on) r.verifyErr = null;
    lgSyncImportUI();
    return;
  }
  if (k === "dayTrade") {
    r.dayTrade = r.side === "sell" && !!t.checked;
    lgSyncImportUI();
    return;
  }
  if (k === "side") {
    r.side = t.value;
    if (r.side !== "sell") r.dayTrade = false;
    r._fresh = false;
    S.edited.add(`${uid}:side`);
    S.blurred.add(`${uid}:side`);
    lgSyncImportUI({ announceRow: uid, announceKey: "side" });
    return;
  }
  if (k === "date" || k === "d") {
    r._fresh = false;
    S.edited.add(`${uid}:${k}`);
    S.blurred.add(`${uid}:${k}`);
    lgSyncImportUI({ announceRow: uid, announceKey: k });
    return;
  }
  if (k === "code") {
    const v = t.value.trim();
    const res = lgResolveCodeInput(v, "");
    r.code = res.code; r.badSym = res.badSym; r.name = res.name; r.verifyErr = null;
    if (res.code && document.activeElement !== t) t.value = res.code;
    if (!res.code && !res.badSym && v && !W.off && typeof lookupCode === "function") {
      r._lookingUp = true;
      const seq = ++r._lookupSeq;
      lgSyncImportUI();
      lookupCode(v).then(x => {
        if ($("#impSheet")?.hidden || r._lookupSeq !== seq || !S.rows.includes(r)) return;
        r._lookingUp = false;
        const nc = x ? normImpCode(x) : "";
        if (nc && okImpCode(nc)) {
          r.code = nc; r.badSym = ""; r.name = lgStockName(nc, v); r.verifyErr = null;
          if (document.activeElement !== t) t.value = nc;
        }
        lgSyncImportUI();
      }, () => {
        if ($("#impSheet")?.hidden || r._lookupSeq !== seq || !S.rows.includes(r)) return;
        r._lookingUp = false;
        lgSyncImportUI();
      });
      return;
    }
    lgSyncImportUI();
  }
}
function lgOnImportBlur(e) {
  const S = lgImpState(), t = e.target;
  if (S.step !== "review" || $("#impSheet")?.hidden || e.relatedTarget?.closest?.("button")) return;
  const uid = t.dataset?.lgimpUid, k = t.dataset?.lgimpK;
  if (!uid || !k) return;
  if (S.edited.has(`${uid}:${k}`) || S.blurred.has(`${uid}:${k}`)) {
    S.blurred.add(`${uid}:${k}`);
    lgSyncImportUI({ announceRow: uid, announceKey: k });
  }
}
function lgOnImportClick(e) {
  const S = lgImpState(), t = e.target;
  const pick = t.closest("[data-lgimp-pick]");
  if (pick) { S.kind = pick.dataset.lgimpPick === "trades" ? "trades" : "holdings"; $("#impFile")?.click(); return; }
  if (t.closest("[data-lgimp-retry]")) { $("#impFile")?.click(); return; }
  if (t.closest("[data-lgimp-back]")) {
    S.step = "choose"; S.rows = []; S.dupOk = false; S.dupSig = ""; S.blurred.clear(); S.edited.clear();
    impSetLive("");
    showImpDialog("截圖匯入到交易紀錄", lgImpChooseHtml(), { wide: false, scope: "ledger", focus: '[data-lgimp-pick="holdings"]', forceFocus: true });
    return;
  }
  if (t.closest("[data-lgimp-blank]")) {
    const kind = S.kind || "trades";
    S.kind = kind; S.step = "review"; S.busy = false; S.dupOk = false; S.dupSig = ""; S.blurred.clear(); S.edited.clear();
    S.rows = [lgNewBlankRow(kind)];
    const P = lgPrepare(S);
    impSetLive("");
    showImpDialog(kind === "trades" ? "核對成交明細匯入" : "核對庫存轉入", lgImpReviewHtml(S, P), { wide: true, scope: "ledger", focus: '#lgImpTbody input[data-lgimp-k="code"]', forceFocus: true });
    lgSyncImportUI();
    return;
  }
  if (t.closest("[data-lgimp-shot]")) { $("#impFile")?.click(); return; }
  if (t.closest("[data-lgimp-add]")) {
    if (S.step !== "review") return;
    const r = lgNewBlankRow(S.kind);
    const idx = S.rows.length;
    S.rows.push(r);
    const tbody = $("#lgImpTbody");
    if (tbody) {
      tbody.insertAdjacentHTML("beforeend", lgImpRowHtml(r, idx, S.kind, null, lgToday()));
      lgSyncImportUI();
      tbody.querySelector(`tr[data-uid="${r._uid}"] input[data-lgimp-k="code"]`)?.focus();
    }
    return;
  }
  const del = t.closest("[data-lgimp-del]");
  if (del && S.step === "review") {
    const uid = del.dataset.lgimpDel, idx = S.rows.findIndex(x => String(x._uid) === String(uid));
    if (idx < 0) return;
    S.rows.splice(idx, 1);
    for (const key of [...S.blurred]) if (key.startsWith(`${uid}:`)) S.blurred.delete(key);
    for (const key of [...S.edited]) if (key.startsWith(`${uid}:`)) S.edited.delete(key);
    const tr = $("#lgImpTbody")?.querySelector(`tr[data-uid="${uid}"]`);
    const nextBtn = tr?.nextElementSibling?.querySelector("[data-lgimp-del]") || tr?.previousElementSibling?.querySelector("[data-lgimp-del]") || $("[data-lgimp-add]");
    tr?.remove();
    lgSyncImportUI();
    if (!$('#lgImpForm [aria-invalid="true"]') && !$("#impLive")?.hidden) impSetLive("");
    try { nextBtn?.focus({ preventScroll: true }); } catch {}
  }
}
async function lgSaveImport() {
  const S = lgImpState();
  if (S.step !== "review" || S.busy) return;
  const P0 = lgPrepare(S);
  if (P0.selectedCount === 0) {
    impSetLive("⚠︎ 請至少勾選一列要匯入的資料。", "err");
    try { ($('#lgImpTbody [data-lgimp-k="on"]') || $("[data-lgimp-add]"))?.focus({ preventScroll: true }); } catch {}
    return;
  }
  const myTok = ++S.saveTok;
  S.busy = true;
  const saveBtn = $("#lgImpSave");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "確認代號中…"; }
  try {
    if (!W.off && typeof loadStocks === "function") {
      await loadStocks().catch(() => {});
      if (myTok !== S.saveTok || $("#impSheet")?.hidden) return;
    }
    for (const r of S.rows) {
      if (r.on === false || r.code || r.badSym || !r.name) continue;
      if (typeof findCode === "function") {
        const fc = findCode(r.name, false);
        if (fc && okImpCode(fc)) { r.code = normImpCode(fc); r.name = lgStockName(r.code, r.name); r.verifyErr = null; continue; }
      }
      if (!W.off && typeof lookupCode === "function") {
        const c = await lookupCode(r.name);
        if (myTok !== S.saveTok || $("#impSheet")?.hidden) return;
        const nc = c ? normImpCode(c) : "";
        if (nc && okImpCode(nc)) {
          r.code = nc; r.name = lgStockName(nc, r.name); r.verifyErr = null;
          const inp = $("#lgImpTbody")?.querySelector(`tr[data-uid="${r._uid}"] [data-lgimp-k="code"]`);
          if (inp && document.activeElement !== inp) inp.value = nc;
        } else if (c && isBadImpSym(c)) {
          r.badSym = lgImpHalf(c).toUpperCase().replace(/\s+/g, "");
        }
      }
    }
    let P = lgPrepare(S);
    if (!P.ok || P.errorCount > 0) {
      S.busy = false;
      for (const it of P.items) {
        const r = S.rows[it.index];
        if (!r || !it.on) continue;
        for (const e of it.errors) S.blurred.add(`${r._uid}:${lgImpErrField(S.kind, e.code)}`);
      }
      lgSyncImportUI();
      const firstErr = P.newErrors?.length ? "匯入後會讓帳本既有的交易出錯，請先調整。" : "有欄位格式或數字不對（例如賣超或缺少代號），請修正標記的欄位後再試。";
      impSetLive("⚠︎ " + firstErr, "err");
      try { $('#lgImpForm [aria-invalid="true"]')?.focus({ preventScroll: true }); } catch {}
      return;
    }
    if (!W.off && typeof verifyCodes === "function") {
      const codes = [...new Set(P.items.filter(it => it.on && S.rows[it.index]?.code).map(it => S.rows[it.index].code))];
      for (const r of S.rows) r.verifyErr = null;
      if (codes.length) {
        const wrong = await verifyCodes(codes);
        if (myTok !== S.saveTok || $("#impSheet")?.hidden) return;
        if (wrong && wrong.size > 0) {
          S.busy = false;
          for (const it of P.items) {
            const r = S.rows[it.index];
            if (it.on && r?.code && wrong.has(r.code)) {
              r.verifyErr = `查不到代號 ${r.code}，請確認是否為有效的台股或美股代號`;
              S.blurred.add(`${r._uid}:code`);
            }
          }
          lgSyncImportUI();
          impSetLive(`⚠︎ 查不到代號：${[...wrong].join("、")}，請修正後再匯入。`, "err");
          try { $('#lgImpForm [aria-invalid="true"]')?.focus({ preventScroll: true }); } catch {}
          return;
        }
      }
    }
    if (P.duplicates?.length > 0 && !S.dupOk) {
      S.busy = false;
      lgSyncImportUI();
      const dupEl = $("#lgImpDup");
      if (dupEl) {
        dupEl.setAttribute("aria-invalid", "true");
        try { dupEl.focus({ preventScroll: true }); } catch {}
      }
      impSetLive("⚠︎ 偵測到可能與帳本重複的交易，請先勾選確認後再匯入。", "err");
      return;
    }
    const finalP = lgPrepare(S, { finalIds: true });
    if (!finalP.ok) {
      S.busy = false;
      lgSyncImportUI();
      impSetLive("⚠︎ 請修正錯誤後再匯入。", "err");
      return;
    }
    const cur = lgLoad();
    const next = cur
      ? { ...cur, transactions: [...cur.transactions, ...finalP.transactions] }
      : { v: 1, method: S.method === "fifo" ? "fifo" : "avg", transactions: finalP.transactions, at: new Date().toISOString() };
    const v = lgSave(next);
    if (!v.ok) {
      S.busy = false;
      lgSyncImportUI();
      impSetLive("✕ 資料檢查未通過，沒有寫入：" + (v.errors?.[0]?.errors?.[0]?.message || v.code), "err");
      return;
    }
    const msg = S.kind === "holdings"
      ? `已匯入 ${finalP.transactions.length} 筆持股轉入到交易紀錄（舊庫存不變）。`
      : `已匯入 ${finalP.transactions.length} 筆成交交易到交易紀錄。`;
    S.busy = false;
    W.lg = { ...(W.lg || {}), view: "tx", prev: null, form: null, msg };
    if (typeof pfExpire === "function") pfExpire();
    closeImport();
    renderList();
    const impBtn = document.querySelector('#lx [data-lg="imp"]');
    if (document.activeElement === document.body && impBtn?.isConnected) {
      try { impBtn.focus({ preventScroll: true }); } catch {}
    }
  } finally {
    if (myTok === S.saveTok && !$("#impSheet")?.hidden) {
      S.busy = false;
      lgSyncImportUI();
    }
  }
}
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target?.form?.id === "lgImpForm" && (e.isComposing || e.keyCode === 229)) e.preventDefault();
});

