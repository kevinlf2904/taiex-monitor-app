/* 投資組合「論點」分頁（投資研究第 1 批）：KLThesis 算，這裡畫。每檔持股的投資論點（為什麼買、觀察什麼、什麼情況不成立、下次檢視）＋持股的近期事件。
   不用 AI、不送資料到任何外部服務；論點只存在這個瀏覽器（kline:pf:thesis:v1），雲端同步、備份檔會一起帶。
   事件資料：除權息與法說會用 /api/calendar（證交所、櫃買中心公開資料，和大盤的行事曆同一份）；美股財報用 data/us-earn.json（排程整理的 Nasdaq 公開行事曆），讀不到再問 /api/usearn。
   用到 watch.html 的 W、$、esc、nameOf、store、getJ、skel、toast、renderList；ledger-ui.js 的 lgViewSeg、lgToday；ledger.js 的 KLLedger；thesis.js 的 KLThesis。 */
const TH_KEY = "pf:thesis:v1"; // store 會加上 kline: 前綴
const thLoad = () => { const s = store.get(TH_KEY, null); return s && s.v === 1 && s.items && typeof s.items === "object" ? s : { v: 1, items: {} }; };
// 寫入前一定檢查；有錯誤就不寫
function thSave(s) { const v = KLThesis.validateStore(s); if (!v.ok) return v; store.set(TH_KEY, { ...s, at: new Date().toISOString() }); return v; }
// 事件資料：30 分鐘內共用；抓不到的標示出來，不當成「沒有事件」
function thData() {
  const X = W.thD; if (X && (X.busy || Date.now() - X.at < 30 * 60e3)) return X;
  W.thD = { busy: true, at: Date.now() };
  const us = (async () => { if (typeof ER === "function" && ER().us?.rows) return ER().us; // 財報頁已經載入過就共用
    let j = null; try { const r = await fetch("data/us-earn.json", { cache: "no-cache" }); j = r.ok ? await r.json() : null; } catch {}
    if (!j?.ok || Date.now() - Date.parse(j.at) > 36 * 3600e3) j = await getJ("/api/usearn").catch(() => (j?.ok ? j : null));
    return j; })();
  Promise.all([W.cal?.rows ? Promise.resolve(W.cal) : getJ("/api/calendar", true).catch(() => null), us]).then(([cal, u]) => {
    if (cal && !W.cal?.rows) W.cal = cal;
    W.thD = { busy: false, at: Date.now(), cal: cal?.rows ? cal : null, us: u?.rows || null };
    if (W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "thesis") renderList();
  });
  return W.thD;
}
const TH_EVERY = [["", "不改"], ["30", "30 天後"], ["90", "90 天後（一季）"], ["180", "180 天後"]];
function renderThesisView(S) {
  const head = lgViewSeg(), L = W.lg, today = lgToday();
  const led = KLLedger.buildLedger(S.transactions, { method: S.method, today }), codes = led.positions.filter(p => p.open).map(p => p.symbol);
  if (!codes.length) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">目前沒有持股。到「交易紀錄」新增買進後，就可以替每檔持股寫投資論點。</p>`);
  const st = thLoad(), Sm = KLThesis.summary(st, codes, today), X = W.off ? { busy: false } : thData(), SL = KLThesis.STATUS_LABEL;
  const tile = (k, v, sub = "") => `<div class="pftile"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = tile("已寫論點", `${Sm.written}/${Sm.total}`, Sm.missing.length ? `還沒寫：${Sm.missing.slice(0, 4).map(c => esc(nameOf(c))).join("、")}${Sm.missing.length > 4 ? " 等" : ""}` : "每檔持股都寫了")
    + tile("該檢視", String(Sm.due), Sm.due ? "檢視日已到或已過" : "沒有到期的") + tile("論點動搖／失效", `${Sm.byStatus.weak}／${Sm.byStatus.broken}`, "照你自己記的狀態");
  // 近期事件
  let ev;
  if (X.busy) ev = `<p class="note">載入持股的除權息、法說會、財報日期…</p>`;
  else {
    const E = KLThesis.catalysts({ codes, cal: X.cal, us: X.us, store: st, today, days: 60, name: c => nameOf(c) });
    const miss = [!X.cal && "除權息與法說會", !X.us && codes.some(c => !/^\d/.test(c)) && "美股財報日"].filter(Boolean);
    ev = (E.length ? `<ul class="thev">${E.map(e => `<li class="${e.overdue ? "th-over" : ""}"><span class="thd">${esc(e.date.slice(5))}</span><button type="button" class="linkbtn" data-sel="${esc(e.code)}">${esc(e.name)}</button><span class="thk thk-${e.kind}">${esc(e.label)}</span><span class="note">${esc(e.text)}</span></li>`).join("")}</ul>` : `<p class="note">未來 60 天沒有找到持股的除權息、法說會、財報日或論點檢視日。</p>`)
      + (miss.length ? `<p class="note lgwarn">⚠︎ ${miss.join("、")}這次拿不到，上面可能不完整。</p>` : "")
      + `<p class="note">只列你持有的股票。除權息、法說會：證交所與櫃買中心公開資料；美股財報日：Nasdaq 公開行事曆。台股財報與月營收沒有逐家公布日，請以公司公告為準。</p>`;
  }
  // 每檔論點
  const card = c => {
    const it = st.items[c] || {}, has = !!(it.reason || it.watch?.length || it.kill?.length), s = it.status || "hold", due = it.review && it.review <= today;
    if (L.thEdit === c) return thForm(c, it);
    if (L.thLog === c) return thLogForm(c, it);
    const ul = a => (a?.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="note">—</p>`);
    return `<section class="pfcard thcard" data-nofold><div class="thh"><button type="button" class="linkbtn" data-sel="${esc(c)}"><b>${esc(nameOf(c))}</b> <small class="note">${esc(c)}</small></button>${has ? `<span class="thst thst-${s}">${SL[s]}</span>` : ""}${it.review ? `<span class="note${due ? " lgwarn" : ""}">下次檢視 ${esc(it.review)}${due ? "（到期）" : ""}</span>` : ""}</div>`
      + (has ? `<div class="thgrid"><div><h5 class="pfh">為什麼買</h5><p>${esc(it.reason || "—")}</p></div><div><h5 class="pfh">要觀察的</h5>${ul(it.watch)}</div><div><h5 class="pfh">什麼情況代表論點不成立</h5>${ul(it.kill)}</div></div>`
        + (it.log?.length ? `<p class="note thlast">最近檢視 ${esc(it.log[0].d)}${it.log[0].status ? `・${SL[it.log[0].status]}` : ""}：${esc(it.log[0].note || "—")}${it.log.length > 1 ? `（共 ${it.log.length} 筆）` : ""}</p>` : "")
        : `<p class="note">還沒寫這檔的投資論點。</p>`)
      + `<div class="lgbar"><button type="button" class="btn sm${has ? "" : " primary"}" data-th="edit" data-c="${esc(c)}">${has ? "修改論點" : "寫論點"}</button>${has ? `<button type="button" class="btn sm" data-th="log" data-c="${esc(c)}">加檢視紀錄</button>` : ""}</div></section>`;
  };
  $("#lx").innerHTML = head + `<section class="pfcard thsum" data-nofold><h4>投資論點與近期事件</h4><div class="pftiles">${tiles}</div>
      ${L.thMsg ? `<p class="note lgmsg" role="status">${esc(L.thMsg)}</p>` : ""}<h5 class="pfh">近期事件（60 天內）</h5>${ev}
      <p class="note">論點是你自己的紀錄（為什麼買、觀察什麼、什麼情況不成立），不是投資建議；只存在這個瀏覽器，有開雲端同步時會一起同步，備份檔也會帶。</p></section>`
    + codes.map(card).join("");
}
function thForm(c, it) {
  const SL = KLThesis.STATUS_LABEL, ta = (n, v, ph) => `<textarea name="${n}" rows="3" placeholder="${ph}">${esc(v)}</textarea>`;
  return `<section class="pfcard thcard" data-nofold><form id="thForm" class="thform" data-c="${esc(c)}"><h4>${esc(nameOf(c))} <small class="note">${esc(c)}</small> 的投資論點</h4>
    <label>為什麼買${ta("reason", it.reason || "", "例如：先進製程領先、AI 需求帶動營收")}</label>
    <label>要觀察的（一行一項）${ta("watch", (it.watch || []).join("\n"), "例如：毛利率、海外廠進度、月營收年增率")}</label>
    <label>什麼情況代表論點不成立（一行一項）${ta("kill", (it.kill || []).join("\n"), "例如：毛利率連兩季低於 50%、失去主要客戶")}</label>
    <div class="throw"><label>目前狀態<select name="status">${KLThesis.STATUS.map(s => `<option value="${s}" ${s === (it.status || "hold") ? "selected" : ""}>${SL[s]}</option>`).join("")}</select></label>
    <label>下次檢視<input type="date" name="review" value="${esc(it.review || KLThesis.addDays(lgToday(), 90))}"></label></div>
    <div class="lgbar"><button type="submit" class="btn primary">儲存</button><button type="button" class="btn" data-th="close">取消</button></div></form></section>`;
}
function thLogForm(c, it) {
  const SL = KLThesis.STATUS_LABEL;
  return `<section class="pfcard thcard" data-nofold><form id="thLogForm" class="thform" data-c="${esc(c)}"><h4>${esc(nameOf(c))} 的檢視紀錄</h4>
    <div class="throw"><label>日期<input type="date" name="d" value="${esc(lgToday())}" max="${esc(lgToday())}"></label>
    <label>檢視後的狀態<select name="status">${KLThesis.STATUS.map(s => `<option value="${s}" ${s === (it.status || "hold") ? "selected" : ""}>${SL[s]}</option>`).join("")}</select></label>
    <label>下次檢視<select name="every">${TH_EVERY.map(([v, t]) => `<option value="${v}" ${v === "90" ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
    <label>這次看到什麼<textarea name="note" rows="3" placeholder="例如：法說會維持全年展望；毛利率季減 2 個百分點"></textarea></label>
    <div class="lgbar"><button type="submit" class="btn primary">加入紀錄</button><button type="button" class="btn" data-th="close">取消</button></div></form></section>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-th]"); if (!b || typeof KLThesis === "undefined") return;
  const L = (W.lg ||= {}), a = b.dataset.th; L.thMsg = "";
  if (a === "edit") { L.thEdit = b.dataset.c; L.thLog = null; } else if (a === "log") { L.thLog = b.dataset.c; L.thEdit = null; } else if (a === "close") { L.thEdit = L.thLog = null; }
  renderList();
});
document.addEventListener("submit", e => {
  if (!["thForm", "thLogForm"].includes(e.target.id)) return; e.preventDefault();
  const L = (W.lg ||= {}), c = e.target.dataset.c, v = Object.fromEntries(new FormData(e.target)), st = thLoad(), prev = st.items[c] || {};
  const it = e.target.id === "thForm" ? KLThesis.fromForm(v, prev, new Date().toISOString())
    : (KLThesis.isDate(v.d) ? KLThesis.addLog(prev, { d: v.d, status: v.status, note: v.note }, v.every ? +v.every : null) : null);
  if (!it) { toast("日期不對"); return; }
  const r = thSave({ ...st, items: { ...st.items, [c]: it } });
  if (!r.ok) { toast("沒有儲存：資料檢查沒有通過（字數太多或格式不對）"); return; }
  L.thEdit = L.thLog = null; L.thMsg = e.target.id === "thForm" ? `已儲存 ${nameOf(c)} 的投資論點。` : `已加入 ${nameOf(c)} 的檢視紀錄。`; renderList();
});
(function () {
  if (document.getElementById("thcss")) return; const st = document.createElement("style"); st.id = "thcss";
  st.textContent = `.thev{list-style:none;margin:0;padding:0}.thev li{display:grid;grid-template-columns:max-content minmax(0,7em) auto minmax(0,1fr);gap:4px 8px;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--line);font-size:13px}
.thev .thd{font-variant-numeric:tabular-nums;white-space:nowrap}.thev .linkbtn{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.thk{font-size:11px;padding:0 4px;border-radius:3px;border:1px solid var(--line);white-space:nowrap}
.th-over .thd,.th-over .thk{color:var(--s1,#d98a0b)}:root[data-theme="light"] #lx .th-over :is(.thd,.thk){color:#8a5300}
.thh{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;margin-bottom:6px}.thst{font-size:11px;padding:0 6px;border-radius:3px;border:1px solid var(--line)}.thst-weak,.thst-broken{color:var(--s1,#d98a0b);border-color:currentColor}
:root[data-theme="light"] #lx .thst-weak,:root[data-theme="light"] #lx .thst-broken{color:#8a5300}
.thgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px}.thgrid p,.thgrid ul{margin:0;font-size:13px;overflow-wrap:anywhere}.thgrid ul{padding-left:1.2em}.thlast{margin:6px 0 0}
.thform{display:grid;gap:8px}.thform label{display:grid;gap:4px;font-size:13px}.thform textarea,.thform input,.thform select{width:100%;min-width:0;box-sizing:border-box;font:inherit}.throw{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
@media (max-width:560px){.thev li{grid-template-columns:max-content minmax(0,1fr) auto}.thev li>.note{grid-column:2/-1}}
@media (pointer:coarse){.thev .linkbtn,.thcard .thh .linkbtn{min-height:44px}}`;
  document.head.appendChild(st);
})();
