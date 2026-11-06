/* ================= 庫存「交易紀錄」（投資組合第 4 階段 B） =================
   計算全部在 ledger.js（KLLedger）；這裡只負責畫面與「使用者確認後才寫入」。
   存檔：kline:pf:v1 → { v: 1, method, transactions, migratedFrom?, at }。
     · 第一次使用：「從現有庫存建立」先顯示搬移預覽（哪幾筆會變成股票轉入、哪幾筆不搬與原因），按「確認建立」才寫入；也可以從空白開始。
     · 舊的 kline:watch:hold 不刪、不改；即時損益、持股分析、風險三個分頁照舊用它。
     · 每次寫入前都跑 KLLedger.validateStore，有錯誤就不寫（不會留下壞資料）。
   新增、修改：先試算，錯誤（賣超、日期不對、幣別錯…）擋下並說明；提醒（估算費用、可能重複…）要再按一次確認。
   刪除：先算影響範圍（之後哪幾筆會變、會不會讓後面的賣出變成賣超），會出錯就不讓刪，否則確認後刪除。
   雲端同步、備份檔本來就包含所有 kline: 開頭的資料，新存檔會一起同步與備份。不輸出 console、不送到任何外部服務。
   用到 watch.html 的 W、$、esc、store、renderList、nameOf、toast；ledger.js 的 KLLedger。 */
const LG_KEY = "pf:v1"; // store 會加 kline: 前綴
const lgToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const lgLoad = () => { const s = store.get(LG_KEY, null); return s && typeof s === "object" && !Array.isArray(s) ? s : null; };
// 寫入前一定檢查；有錯誤就不寫，回傳錯誤
function lgSave(s) {
  const v = KLLedger.validateStore(s, { today: lgToday() });
  if (!v.ok) return v;
  store.set(LG_KEY, s); return v;
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

function renderLedger() {
  const L = (W.lg ||= { open: null, form: null, prev: null, msg: "" });
  $("#wl").innerHTML = "";
  const S = lgLoad();
  if (L.view === "margin") return renderMargin(); // 融資不需要交易紀錄
  if (!S) return ($("#lx").innerHTML = L.prev ? lgPreviewHtml(L.prev) : lgIntroHtml());
  if (!L.view || L.view === "home") return renderHome(S); // 總覽（預設）：畫面在 pf-home.js，用到時才載入
  if (L.view === "perf") return renderPerf(S);
  if (L.view === "margin") return renderMargin();
  if (L.view === "alloc") return renderAlloc(S);
  const quotes = new Map([...W.quotes].map(([c, q]) => [c, q?.price]).filter(([, p]) => p > 0));
  const R = KLLedger.buildLedger(S.transactions, { method: S.method, today: lgToday(), prices: quotes });
  const cur = ["TWD", "USD"].filter(c => R.totals[c] || R.cash[c]);
  const open = R.positions.filter(p => p.open), closed = R.positions.filter(p => !p.open);
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
  const txs = R.txs.slice().sort((a, b) => String(b.tx?.date).localeCompare(String(a.tx?.date)) || b.index - a.index);
  $("#lx").innerHTML = lgViewSeg() + `<div class="lgbar"><span>成本算法：<b>${R.methodLabel}</b></span><button type="button" class="btn sm" data-lg="method">改用${S.method === "fifo" ? "加權平均" : "先進先出"}</button><button type="button" class="btn sm primary" data-lg="add">＋ 新增交易</button><button type="button" class="btn sm" data-lg="csv">⬇ 匯出 CSV</button></div>
    ${L.msg ? `<p class="note lgmsg" role="status">${esc(L.msg)}</p>` : ""}
    ${bad.length ? `<p class="note lgwarn">✕ ${bad.length} 筆交易有錯誤，沒有算進去（下面標紅色的），請修改或刪除。</p>` : ""}${pend.length ? `<p class="note lgwarn">⚠︎ ${pend.map(p => esc(nameOf(p.symbol))).join("、")} 合股後有不足一股的部分還沒結算，股數與成本是暫時的；請新增一筆「零股現金結算」。</p>` : ""}
    ${L.form ? lgFormHtml(L.form, S) : ""}
    <div class="lgcurs">${cur.map(curBox).join("") || `<p class="note">還沒有交易。</p>`}</div>
    <p class="note">台幣和美元分開計算，不相加。未實現損益用目前報價；費用標「估算」的是依預設費率算的，實際以券商對帳單為準。${S.migratedFrom ? `由舊庫存建立於 ${esc(String(S.at || "").slice(0, 10))}；舊庫存資料仍保留。` : ""}</p>
    ${open.length ? `<h4 class="lgh">持有中（${open.length} 檔）</h4><ul class="lglist">${open.map(posRow).join("")}</ul>` : ""}
    ${closed.length ? `<h4 class="lgh">已出清（${closed.length} 檔）</h4><ul class="lglist">${closed.map(posRow).join("")}</ul>` : ""}
    <h4 class="lgh">交易紀錄（${txs.length} 筆）</h4><ul class="lglist lgtxs">${txs.map(txRow).join("") || `<li class="note">還沒有交易。</li>`}</ul>`;
}
function lgIntroHtml() {
  const n = Object.keys(W.hold || {}).length;
  return `<div class="lgintro"><h4>交易紀錄</h4><p class="note">記下每一筆買進、賣出、股息、配股、拆股、入金出金，系統會算出平均成本（或先進先出）、已實現損益、股息與費用。資料只存在這台裝置（有開雲端同步的話會一起同步）。</p>
    ${n ? `<button type="button" class="btn primary" data-lg="preview">從現有庫存建立（先預覽，不會馬上改動）</button>` : ""}<button type="button" class="btn" data-lg="blank">從空白開始</button>
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
  else if (a === "close") L.form = null;
  else if (a === "view") { L.view = b.dataset.v; L.form = null; }
  else if (a === "range") L.pfRange = b.dataset.v;
  else if (a === "pfreload") { W.lgPx = null; W.lgAl = null; W.lgMg = null; }
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
const lgViewSeg = () => `<div class="seg lgview" role="group" aria-label="總覽、交易紀錄、績效、配置或融資">${[["home", "總覽"], ["tx", "交易紀錄"], ["perf", "績效"], ["alloc", "配置"], ["margin", "融資"]].map(([k, t]) => `<button type="button" data-lg="view" data-v="${k}" aria-pressed="${(W.lg?.view || "home") === k}">${t}</button>`).join("")}</div>`;
// 績效（perf.js）與匯率合併（fx.js）用到時才載入，照順序（fx.js 要用到 perf.js）
function lgPerfLib() {
  if (typeof KLPerf !== "undefined" && typeof KLFx !== "undefined") return Promise.resolve();
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  return (W.lgPerfP ||= (typeof KLPerf !== "undefined" ? Promise.resolve() : one("perf.js")).then(() => (typeof KLFx !== "undefined" ? null : one("fx.js"))).catch(e => { W.lgPerfP = null; throw e; }));
}
// 價格：同一組代號 10 分鐘內重複用；單一檔失敗不影響其他檔（引擎會標「沒有價格」）
function lgPerfData(S) {
  const syms = [...new Set(S.transactions.map(t => String(t.symbol || "").toUpperCase()).filter(Boolean))].sort(), curs = [...new Set(S.transactions.map(t => t.currency).filter(Boolean))];
  const key = syms.join(",") + "|" + curs.join(","), X = W.lgPx;
  if (X && X.key === key && (X.busy || Date.now() - X.at < 600000)) return X;
  W.lgPx = { key, busy: true, at: Date.now(), n: syms.length };
  const kl = (c, q = "") => getJ(`/api/kline?code=${encodeURIComponent(c)}&months=24${q}`).catch(() => null);
  // 有美股時另外抓美元兌台幣（Yahoo TWD=X 日收盤，市場中間價），用來換成台幣合併
  Promise.all([Promise.all(syms.map(c => kl(c))), curs.includes("TWD") ? kl("加權") : null, curs.includes("USD") ? kl("SPY", "&adj=1") : null, curs.includes("USD") ? kl("TWD=X") : null]).then(([A, tw, us, fx]) => {
    const prices = {}; syms.forEach((c, i) => { if (A[i]?.data?.length) prices[c] = A[i].data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })); });
    const bench = {}; if (tw?.data?.length) bench.TWD = tw.data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c }));
    if (us?.data?.length) bench.USD = us.data.map(x => ({ d: String(x.d).slice(0, 10), c: us.adj?.ok && x.ac > 0 ? x.ac : x.c }));
    W.lgPx = { key, busy: false, at: Date.now(), prices, bench, usAdj: !!us?.adj?.ok, fx: fx?.data?.length ? fx.data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })) : [] };
    if (W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "perf") renderList();
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
  const range = L.pfRange || "all", rg = `<div class="seg pfrange" role="group" aria-label="日期範圍">${[["3m", "3 個月"], ["6m", "6 個月"], ["1y", "1 年"], ["all", "全部"]].map(([k, t]) => `<button type="button" data-lg="range" data-v="${k}" aria-pressed="${range === k}">${t}</button>`).join("")}</div>`;
  const cards = (R.byCurrency.USD ? pfFxCard(KLFx.combine(R, X.fx || [], { fxSource: "Yahoo Finance TWD=X 日收盤" })) : "") + Object.values(R.byCurrency).map(C => pfCard(C, range)).join("");
  $("#lx").innerHTML = head + `<div class="lgbar">${rg}<button type="button" class="btn sm" data-lg="pfreload">重新載入價格</button></div>`
    + (R.ledgerErrors ? `<p class="note lgwarn pfstatus" style="margin:4px 12px">✕ 有 ${R.ledgerErrors} 筆交易有錯誤，沒有算進績效；請到「交易紀錄」修改。下面的數字不完整。</p>` : "")
    + (R.status === "needs_confirm" ? `<p class="note lgwarn pfstatus" style="margin:4px 12px">⚠︎ 待確認：有部位合股後的零股還沒結算，股數與成本是暫時的，下面的績效也是暫時的。請到「交易紀錄」新增「零股現金結算」。</p>` : "")
    + (cards || `<p class="note" style="padding:12px">沒有可以計算的持股。</p>`)
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
  return `<section class="pfcard"><h4>${cur === "USD" ? "美股（美元）" : "台股（台幣）"}${cst}<small class="note"> ${C.from ? `${C.from}～${C.to}・` : ""}資料到 ${esc(C.asOf || "")}</small></h4>
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
  st.textContent = `@media (pointer:coarse){.lgview button{min-height:44px}}.lgview{margin:8px 12px 0}.pfrange{flex-wrap:wrap}
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
.pfbasis{margin:4px 12px 16px;font-size:12px}.pfbasis ul{padding-left:1.2em;margin:4px 0}`;
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
  if (X && X.key === key && (X.busy || Date.now() - X.at < 300000)) return X;
  W.lgMg = { key, busy: true, at: Date.now() };
  getJ(`/api/quote?codes=${syms.map(encodeURIComponent).join(",")}`).catch(() => null).then(q => {
    const px = {}; for (const x of q?.quotes || []) if (x && x.price > 0) px[String(x.code).toUpperCase()] = { price: x.price, date: x.date || null, name: x.name || null };
    W.lgMg = { key, busy: false, at: Date.now(), px }; if (W.lt === "hold" && W.holdView === "tx" && ["margin", "home", undefined].includes(W.lg?.view)) renderList();
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
  $("#lx").innerHTML = head + `<div class="lgbar"><button type="button" class="btn sm primary" data-lg="mgadd">＋ 新增融資／借款帳戶</button><button type="button" class="btn sm" data-lg="pfreload">重新載入報價</button></div>`
    + (L.msg ? `<p class="note lgmsg" role="status">${esc(L.msg)}</p>` : "") + warn + form
    + (cards || `<p class="note" style="padding:12px">還沒有融資或借款資料。按「新增」填入借款金額、擔保品與券商的門檻，就能看維持率與下跌時的風險。</p>`);
}
function mgCard(R, a) {
  const pc = v => (v == null ? "—" : (v * 100).toFixed(1) + "%"), money = v => lgMoney(v, R.currency), tile = (k, v, sub = "", c = "") => `<div class="pftile"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const st = R.state ? `<span class="pfbadge mg-${R.state}">${MG_STATE[R.state]}</span>` : "", src = `<span class="pfbadge">${KLMargin.SOURCE_LABEL[R.source]}</span>`;
  const done = R.status === "estimated" ? `<span class="pfbadge">含估算</span>` : R.status === "incomplete" ? `<span class="pfbadge mg-call">資料不完整</span>` : "";
  const PS = { quote: "報價", user: "你填的價格" };
  const colTable = R.collateral.length ? `<h5 class="pfh">擔保品<small class="note">（價格、日期、來源）</small></h5><table class="altable mgtable mgcol"><thead><tr><th>代號</th><th>股數</th><th>價格</th><th>價格日期</th><th>來源</th><th>市值</th><th>占比</th></tr></thead><tbody>
    ${R.collateral.map(c => `<tr><td>${esc(nameOf(c.symbol))}<small class="note"> ${esc(c.symbol)}</small></td><td>${lgN(c.shares)}</td><td>${c.price == null ? "—" : lgN(c.price)}</td><td>${esc(c.priceDate || "—")}</td><td>${c.priceSource ? PS[c.priceSource] : "沒有價格，沒算進市值"}</td><td>${c.value == null ? "—" : money(c.value)}</td><td>${pc(c.weight)}</td></tr>`).join("")}
    ${R.cashCollateral ? `<tr><td>現金擔保</td><td></td><td></td><td></td><td>你填的</td><td>${money(R.cashCollateral)}</td><td>${pc(R.collateralValue ? R.cashCollateral / R.collateralValue : null)}</td></tr>` : ""}</tbody></table>` : "";
  const iss = R.issues.map(x => esc(KLMargin.ISSUE_LABEL[x.k] || x.k) + (x.codes ? `：${x.codes.map(esc).join("、")}` : "")).join("；");
  const needTxt = n => (n ? `補現金 ${money(n.cash)} 或還款 ${money(n.repay)}` : "—");
  return `<section class="pfcard mgcard"><h4>${esc(R.name || "借款帳戶")}<small class="note"> ${MG_TYPE[R.type]}</small>${src}${st}${done}</h4>
    <div class="pftiles">${[tile("維持率", pc(R.ratio), R.rules.call ? `追繳線 ${pc(R.rules.call)}${R.rules.liquidate ? `・處分線 ${pc(R.rules.liquidate)}` : ""}` : "沒有設定追繳線"),
      tile("借款", money(R.loan), R.interest != null ? `已計利息約 ${money(R.interest)}（${R.days} 天）` : ""), tile("擔保品市值", money(R.collateralValue), R.cashCollateral ? `含現金 ${money(R.cashCollateral)}` : ""),
      tile("再跌多少會追繳", R.dropToCall == null ? "—" : R.dropToCall <= 0 ? "已低於追繳線" : pc(R.dropToCall), R.dropToLiquidate != null ? `跌 ${pc(R.dropToLiquidate)} 會被處分` : ""),
      tile("可用額度（試算）", R.available == null ? "—" : money(R.available), R.rules.maxLtv ? `成數 ${pc(R.rules.maxLtv)}` : "沒有設定成數")].join("")}</div>
    ${R.need ? `<p class="note lgwarn">⚠︎ 目前低於追繳線：試算要${needTxt(R.need)}才回到 ${pc(R.rules.topUpTo || R.rules.call)}。</p>` : ""}${iss ? `<p class="note lgwarn">⚠︎ ${iss}。</p>` : ""}
    ${colTable}
    <h5 class="pfh">壓力測試<small class="note">（股票擔保品同時下跌，現金不跌）</small></h5>
    <table class="altable mgtable"><thead><tr><th>情境</th><th>擔保品市值</th><th>維持率</th><th>狀態</th><th>要補</th></tr></thead><tbody>
      ${R.stress.map(x => `<tr><td>全部跌 ${(-x.shock * 100).toFixed(0)}%</td><td>${money(x.value)}</td><td>${pc(x.ratio)}</td><td>${x.state ? MG_STATE[x.state] : "—"}</td><td>${needTxt(x.need)}</td></tr>`).join("")}
      ${R.singleLimitDown.slice(0, 3).map(x => `<tr><td>${esc(nameOf(x.symbol))} 連三根跌停（約 −27%）</td><td>${money(x.value)}</td><td>${pc(x.ratio)}</td><td>${x.state ? MG_STATE[x.state] : "—"}</td><td>${needTxt(x.need)}</td></tr>`).join("")}</tbody></table>
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
  L.mgForm = null; L.msg = F.id ? "已儲存。" : "已加入。"; W.lgMg = null; renderList();
}
(function () {
  if (document.getElementById("mgcss")) return; const st = document.createElement("style"); st.id = "mgcss";
  st.textContent = `.mgnote{margin:4px 12px}.mgtable td:first-child{text-align:left}.mgtable{min-width:520px}.mgtable th,.mgtable td{white-space:nowrap}.mgcard .altable{display:block;overflow-x:auto}.pfbadge.mg-call,.pfbadge.mg-liquidate{background:color-mix(in srgb,var(--s1,#d98a0b) 20%,transparent)}
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
function lgAllocData(P) {
  const syms = P.map(p => p.symbol).sort(), etfs = syms.filter(lgIsEtf), key = syms.join(","), X = W.lgAl;
  if (X && X.key === key && (X.busy || Date.now() - X.at < 600000)) return X;
  W.lgAl = { key, busy: true, at: Date.now(), n: syms.length };
  if (!W.stocks && typeof loadStocks === "function") loadStocks().catch(() => {});
  Promise.all([syms.length ? getJ(`/api/quote?codes=${syms.map(encodeURIComponent).join(",")}`).catch(() => null) : null,
    P.some(p => p.currency === "USD") ? getJ(`/api/kline?code=${encodeURIComponent("TWD=X")}&months=1`).catch(() => null) : null,
    Promise.all(etfs.map(c => getJ(`/api/etf?code=${encodeURIComponent(c)}`).catch(() => null)))]).then(([q, fx, E]) => {
    const px = new Map((q?.quotes || []).filter(x => x && x.price > 0).map(x => [String(x.code).toUpperCase(), x])), last = fx?.data?.length ? fx.data[fx.data.length - 1] : null;
    const etf = {}; etfs.forEach((c, i) => { const j = E[i]; if (j?.hold?.rows?.length) etf[c] = { date: j.hold.date || null, rows: j.hold.rows.map(r => ({ code: r.code || null, name: r.name || null, pct: r.pct })), ind: j.ind?.rows?.length ? { date: j.ind.date || null, rows: j.ind.rows } : null }; });
    W.lgAl = { key, busy: false, at: Date.now(), px, fx: last ? { rate: last.c, date: String(last.d).slice(0, 10) } : null, etf };
    if (W.lt === "hold" && W.holdView === "tx" && ["alloc", "home", undefined].includes(W.lg?.view)) renderList(); // 配置與總覽共用
  });
  return W.lgAl;
}
function renderAlloc(S) {
  const head = lgViewSeg();
  if (W.off) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">需要部署到網站才有價格資料。</p>`);
  if (typeof KLAlloc === "undefined") { $("#lx").innerHTML = head + skel("載入配置模組…"); lgAllocLib().then(() => renderList(), e => { $("#lx").innerHTML = head + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; }); return; }
  const L = KLLedger.buildLedger(S.transactions, { method: S.method, today: lgToday() }), open = L.positions.filter(p => p.open);
  if (!open.length) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">目前沒有持股，沒有配置可以看。</p>`);
  const X = lgAllocData(open); if (X.busy) return ($("#lx").innerHTML = head + skel(`載入 ${X.n} 檔的報價${open.some(p => lgIsEtf(p.symbol)) ? "與 ETF 成分股" : ""}…`));
  const ind = new Map((Array.isArray(W.stocks) ? W.stocks : []).map(r => [String(r[0]).toUpperCase(), r[3] || null]));
  const pos = open.map(p => { const q = X.px.get(p.symbol); return { symbol: p.symbol, name: q?.name || nameOf(p.symbol), market: p.market, currency: p.currency, value: q ? p.shares * q.price : p.costBasis, valueEstimated: !q, assetType: lgIsEtf(p.symbol) ? "etf" : "stock", industry: ind.get(p.symbol) || null }; });
  const cash = {}; for (const [c, v] of Object.entries(L.cash || {})) if (v.tracked && v.balance > 0) cash[c] = v.balance;
  const R = KLAlloc.build(pos, { fx: X.fx, cash, etf: X.etf, asOf: lgToday(), names: Object.fromEntries(pos.map(p => [p.symbol, p.name])) });
  const issues = (R.issues || []).map(x => `<li>${esc(KLAlloc.ISSUE_LABEL[x.k] || x.k)}${x.codes ? `：${x.codes.map(c => (nameOf(c) && nameOf(c) !== c ? `${esc(nameOf(c))} ${esc(c)}` : esc(c))).join("、")}` : x.list ? `：${x.list.map(l => `${esc(l.etf)}${l.date ? " " + l.date : ""}${l.covered != null ? ` 揭露 ${l.covered}%` : ""}`).join("、")}` : x.dates ? `：${x.dates.map(d => `${esc(d.etf)} ${d.date || "—"}`).join("、")}` : ""}</li>`).join("");
  const body = R.status === "no_fx" ? Object.values(R.byCurrency).map(C => alSection(C, `${C.base === "USD" ? "美股（美元）" : "台股（台幣）"}`)).join("") : alSection(R, "全部資產（台幣計價）");
  $("#lx").innerHTML = head + `<div class="lgbar"><button type="button" class="btn sm" data-lg="pfreload">重新載入報價</button>${R.fx ? `<small class="note">美元兌台幣 ${R.fx.rate.toFixed(3)}（${esc(R.fx.date || "")}，Yahoo TWD=X 收盤）</small>` : ""}</div>`
    + (issues ? `<ul class="note lgwarn alissues">${issues}</ul>` : "") + body
    + `<details class="pfbasis"><summary>計算口徑</summary><ul><li>權重＝市值 ÷ 總資產（台幣計價；美元用最新匯率換算）。有記入金、出金時，現金也算進總資產。</li>
      <li>沒有現價的持股用成本估算市值，並標示。美股沒有產業資料，歸「未分類」。</li>
      <li>ETF 穿透：ETF 權重 × 成分股占比＝透過 ETF 持有的曝險；只揭露部分成分股時，剩下的歸「其他（未揭露）」。各 ETF 的成分股日期可能不同，會分開列出。</li>
      <li>重疊度：兩檔 ETF 共同成分股的占比取小的加總。有效檔數＝1 ÷ 權重平方和（不含現金）。市值規模、投資策略的分類還沒有資料。</li></ul></details>`;
}
const AL_MKT = { tw: "台股", us: "美股", cash: "現金" }, AL_TYPE = { stock: "個股", etf: "ETF", cash: "現金" };
const alPct = w => (w == null ? "—" : (w * 100).toFixed(1) + "%");
const alBars = (rows, label = g => esc(g)) => `<ul class="albars">${rows.map(r => `<li><span class="nm">${label(r.group)}</span><span class="albar"><i style="width:${Math.max(0.5, r.w * 100).toFixed(1)}%"></i></span><b>${alPct(r.w)}</b></li>`).join("")}</ul>`;
function alSection(R, title) {
  const C = R.concentration, LT = R.lookThrough, cur = R.base;
  const tile = (k, v, sub = "") => `<div class="pftile"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = [tile("總資產", lgMoney(R.total, cur), R.cash ? `含現金 ${lgMoney(R.cash, cur)}` : "不含現金（沒有記入出金）"),
    tile("最大單一持股", C.top ? alPct(C.top.w) : "—", C.top ? esc(nameOf(C.top.symbol)) : ""), tile("前五大合計", alPct(C.top5)),
    tile("有效檔數", C.effN ? C.effN.toFixed(1) : "—", "權重越集中，數字越小"), tile("現金比重", alPct(R.cashShare))].join("");
  const top = R.top10.map(h => ({ group: h.symbol, w: h.w, h }));
  const lt = LT && LT.top.length && LT.exposure.some(e => e.viaEtf > 0 || e.notLookedThrough) ? `<h5 class="pfh">ETF 穿透後的實際持股<small class="note">（直接持有＋透過 ETF）</small></h5>
    <table class="altable"><thead><tr><th>股票</th><th>合計</th><th>直接</th><th>透過 ETF</th></tr></thead><tbody>${LT.top.map(e => `<tr><td>${esc(e.name || nameOf(e.code))}<small class="note"> ${esc(e.code)}${e.notLookedThrough ? "（ETF，沒有成分股資料，未穿透）" : ""}</small></td><td><b>${alPct(e.w)}</b></td><td>${e.direct ? alPct(e.direct) : "—"}</td><td>${e.viaEtf ? alPct(e.viaEtf) : "—"}</td></tr>`).join("")}</tbody></table>
    ${LT.dupDirect.length ? `<p class="note">重複持有（直接買了，ETF 裡也有）：${LT.dupDirect.slice(0, 6).map(d => `${esc(d.name || d.code)}（直接 ${alPct(d.direct)}＋ETF ${alPct(d.viaEtf)}）`).join("、")}</p>` : ""}
    ${LT.pairs.length ? `<p class="note">ETF 重疊度：${LT.pairs.slice(0, 5).map(p => `${esc(p.a)} × ${esc(p.b)} ${p.overlap.toFixed(1)}%${p.sameDate ? "" : "（資料日期不同）"}`).join("、")}</p>` : ""}
    <p class="note">成分股資料日期：${LT.dates.map(d => `${esc(d.etf)} ${d.date || "—"}（揭露 ${d.covered}%）`).join("、")}</p>` : "";
  return `<section class="pfcard alcard"><h4>${title}${R.estimated ? `<span class="pfbadge">含估算</span>` : ""}</h4><div class="pftiles">${tiles}</div>
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
  const head = `<section class="pfcard pffx"><h4>合併（台幣計價）`;
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
function renderHome(S) {
  if (typeof renderHomeView === "function" && typeof KLOverview !== "undefined") return renderHomeView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入總覽…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  (W.lgHomeP ||= one("overview.js").then(() => one("pf-home.js")).catch(e => { W.lgHomeP = null; throw e; })).then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}
