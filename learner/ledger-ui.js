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
const lgMoney = (v, cur) => (v == null ? "—" : (cur === "USD" ? "US$" : "") + (cur === "USD" ? (+v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString()));
const lgSgn = (v, cur) => (v == null ? "—" : (v > 0 ? "+" : "") + lgMoney(v, cur));
const lgN = v => (v == null ? "—" : (+v).toLocaleString(undefined, { maximumFractionDigits: 4 }));

function renderLedger() {
  const L = (W.lg ||= { open: null, form: null, prev: null, msg: "" });
  $("#wl").innerHTML = "";
  const S = lgLoad();
  if (!S) return ($("#lx").innerHTML = L.prev ? lgPreviewHtml(L.prev) : lgIntroHtml());
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
  $("#lx").innerHTML = `<div class="lgbar"><span>成本算法：<b>${R.methodLabel}</b></span><button type="button" class="btn sm" data-lg="method">改用${S.method === "fifo" ? "加權平均" : "先進先出"}</button><button type="button" class="btn sm primary" data-lg="add">＋ 新增交易</button></div>
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
    const v = lgSave(s); if (!v.ok) { L.prev = null; L.msg = "建立失敗：資料檢查沒有通過，沒有寫入。"; } else { L.prev = null; L.msg = `已建立交易紀錄（${s.transactions.length} 筆）。舊的庫存資料仍保留。`; } }
  else if (a === "blank") { const v = lgSave({ v: 1, method: "avg", transactions: [], at: new Date().toISOString() }); if (v.ok) L.msg = "已建立空白的交易紀錄。"; }
  else if (a === "add") L.form = { type: "buy", v: { date: lgToday() } };
  else if (a === "close") L.form = null;
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
