/* 投資組合「論點」分頁（投資研究第 1 批）：KLThesis 算，這裡畫。每檔持股的投資論點（為什麼買、觀察什麼、什麼情況不成立、下次檢視）＋持股的近期事件。
   不用 AI、不送資料到任何外部服務；論點只存在這個瀏覽器（kline:pf:thesis:v1），雲端同步、備份檔會一起帶。
   事件資料：除權息與法說會用 /api/calendar（證交所、櫃買中心公開資料，和大盤的行事曆同一份）；美股財報用 data/us-earn.json（排程整理的 Nasdaq 公開行事曆），讀不到再問 /api/usearn。
   停損／停利（第 3 批）：每檔可設價格或「相對成本的百分比」，用配置頁同一份報價（lgAllocData）算距離與狀態；可一鍵寫進既有的到價提醒（watch:alerts，覆蓋前先確認）。
   財報指標（第 4 批）：台股持股帶入最新的月營收年增、累計年增、EPS、毛利率、營益率、淨利率（/api/oapi?earn=1，和情報局「財報」同一份，earn.js 的 ER／erLoad），
   「要觀察的」項目寫到這些指標時，旁邊直接顯示目前數字。美股沒有這份資料，不顯示。
   簡易估值（第 5 批）：台股持股顯示本益比、淨值比、殖利率（/api/screen?bw=1，證交所、櫃買中心每日公布，tools.js 的 mfValLoad 共用）與同產業本益比中位數；
   按「看歷史區間與情境價」才查這一檔的歷史本益比（/api/stockinfo，和個股頁同一支），算悲觀／中性／樂觀的情境價。只是粗估，不是投資建議。
   用到 watch.html 的 W、$、esc、nameOf、store、getJ、skel、toast、renderList；ledger-ui.js 的 lgViewSeg、lgToday、lgAllocData；ledger.js 的 KLLedger；thesis.js 的 KLThesis。 */
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
// 台股財報表：和財報頁共用（lazy 載入 earn.js）。分成三種狀態：有資料（rows）、載入中（busy）、失敗（fail：連不上、ok:false、沒有 rows）。
// 失敗後 1 分鐘內不重抓（避免重畫時一直重試），1 分鐘到了自己重畫一次、強制重抓
const thEarnView = () => W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "thesis";
function thEarn() {
  if (W.off) return null;
  const D = typeof ER === "function" ? ER().data : null;
  if (D?.rows) return D;
  const age = Math.min(Date.now() - (W.thEF || 0), D ? Date.now() - D.at : Infinity);
  if (!W.thEB && age >= 60e3) { W.thEB = true;
    lazy("earn").then(() => erLoad(true)).catch(() => {}).finally(() => { W.thEB = false; W.thEF = Date.now(); if (thEarnView()) renderList(); }); }
  if (W.thEB) return { busy: true };
  if (!W.thET) W.thET = setTimeout(() => { W.thET = null; if (thEarnView()) renderList(); }, Math.max(1e3, 60e3 - age + 500));
  return { fail: true, msg: D?.err || D?.error || "" };
}
// 全市場本益比、淨值比、殖利率（/api/screen?bw=1）：自己記有資料／載入中／失敗三種狀態，失敗不當成「沒有資料」；1 分鐘後自動重抓。
// 選股的 mfValLoad 失敗時會把 W.mfVal 設成 {}，所以只有「有內容」的 W.mfVal 才共用；這裡成功了也順便填給它
function thBw() {
  if (W.off) return null;
  if (W.mfVal && Object.keys(W.mfVal).length) return { rows: W.mfVal };
  const X = W.thBwD; if (X?.rows || X?.busy) return X;
  const age = X ? Date.now() - X.at : Infinity;
  if (age >= 60e3) {
    W.thBwD = { busy: true };
    getJ("/api/screen?bw=1", true).then(j => { if (!j?.rows || !Object.keys(j.rows).length) throw new Error("沒有資料"); W.thBwD = { rows: j.rows, at: Date.now() }; if (!(W.mfVal && Object.keys(W.mfVal).length)) W.mfVal = j.rows; })
      .catch(e => { W.thBwD = { fail: true, msg: e.message || "", at: Date.now() }; }).finally(() => { if (thEarnView()) renderList(); });
    return W.thBwD;
  }
  if (!W.thBT) W.thBT = setTimeout(() => { W.thBT = null; if (thEarnView()) renderList(); }, Math.max(1e3, 60e3 - age + 500));
  return X;
}
// 一檔的歷史本益比（按了才查）。getJ 遇到 ok:false 會丟錯誤 → 失敗狀態；有回應但沒有本益比 → none；記下有效資料的起訖日期
function thHist(c) {
  const V = (W.thVal ||= {}); if (V[c]?.busy || V[c]?.per) return; V[c] = { busy: true };
  getJ(`/api/stockinfo?code=${encodeURIComponent(c)}`).then(j => { const L = (j?.per || []).filter(x => x && x.pe > 0 && x.d);
    V[c] = L.length ? { per: L.map(x => x.pe), from: L[0].d, to: L[L.length - 1].d } : { none: true }; }).catch(e => { V[c] = { err: e.message || "查不到" }; })
    .finally(() => { if (thEarnView()) renderList(); });
}
const TH_EVERY = [["", "不改"], ["30", "30 天後"], ["90", "90 天後（一季）"], ["180", "180 天後"]];
function renderThesisView(S) {
  const head = lgViewSeg(), L = W.lg, today = lgToday();
  const led = KLLedger.buildLedger(S.transactions, { method: S.method, today }), open = led.positions.filter(p => p.open), codes = open.map(p => p.symbol);
  if (!codes.length) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">目前沒有持股。到「交易紀錄」新增買進後，就可以替每檔持股寫投資論點。</p>`);
  const st = thLoad(), Sm = KLThesis.summary(st, codes, today), X = W.off ? { busy: false } : thData(), SL = KLThesis.STATUS_LABEL;
  // 停損停利：有設的才抓報價（和配置頁共用）；每檔的價位與狀態
  const anyLv = codes.some(c => st.items[c]?.stop || st.items[c]?.take), Q = (anyLv || codes.some(c => /^\d/.test(c))) && !W.off ? lgAllocData(open) : null, pos = new Map(open.map(p => [p.symbol, p]));
  const LV = new Map(codes.map(c => { const price = Q?.px?.get(c)?.price ?? null; return [c, { ...KLThesis.levels(st.items[c], { avgCost: pos.get(c).avgCost, price }), price }]; }));
  const tw = codes.filter(c => /^\d/.test(c)), ED = tw.length ? thEarn() : null, ERow = new Map((ED?.rows || []).map(r => [String(r[0]), r]));
  const per = ED?.rows ? [typeof erYm === "function" ? erYm(ED.ym) : "", typeof erYq === "function" ? erYq(ED.yq) : ""] : ["", ""];
  const BW = tw.length ? thBw() : null;
  W.thLv = LV; const cnt = k => [...LV.values()].filter(x => k.includes(x.state)).length;
  const tile = (k, v, sub = "") => `<div class="pftile"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = tile("已寫論點", `${Sm.written}/${Sm.total}`, Sm.missing.length ? `還沒寫：${Sm.missing.slice(0, 4).map(c => esc(nameOf(c))).join("、")}${Sm.missing.length > 4 ? " 等" : ""}` : "每檔持股都寫了")
    + tile("該檢視", String(Sm.due), Sm.due ? "檢視日已到或已過" : "沒有到期的") + tile("論點動搖／失效", `${Sm.byStatus.weak}／${Sm.byStatus.broken}`, "照你自己記的狀態")
    + (anyLv ? tile("觸及停損／停利", `${cnt(["stop_hit"])}／${cnt(["take_hit"])}`, Q?.busy ? "載入報價…" : `接近的 ${cnt(["near_stop", "near_take"])} 檔（差 5% 以內）`) : "");
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
    const lv = LV.get(c), cur = pos.get(c).currency, px = v => (v == null ? "—" : `${+v.toFixed(2)}${cur === "USD" ? " 美元" : ""}`), pc = v => (v == null || lv.state.endsWith("_hit") ? "" : `（${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%）`); // 已觸及就不顯示距離
    const lvRow = lv.state === "none" ? "" : `<p class="thlv"><span class="thst thlv-${lv.state}">${esc(KLThesis.LEVEL_LABEL[lv.state])}</span>`
      + (it.stop ? `<span>停損 ${px(lv.stopPrice)}${pc(lv.toStop)}${it.stop.mode === "pct" ? `<small class="note">＝成本 ${it.stop.v}%</small>` : ""}</span>` : "")
      + (it.take ? `<span>停利 ${px(lv.takePrice)}${pc(lv.toTake)}${it.take.mode === "pct" ? `<small class="note">＝成本 +${it.take.v}%</small>` : ""}</span>` : "")
      + (Q?.busy && lv.state === "no_price" ? `<small class="note">載入報價…</small>` : "") + `</p>`;
    const ul = a => (a?.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="note">—</p>`);
    // 財報指標：台股才有；要觀察的項目對到指標就在旁邊標目前數字
    const K = /^\d/.test(c) && ERow.has(c) ? KLThesis.kpis(ERow.get(c)) : null, KM = new Map((K || []).map(x => [x.k, x]));
    const kv = x => `<b class="${x.bad ? "down" : ""}">${esc(x.text)}</b>`;
    const ulW = a => (a?.length ? `<ul>${a.map(x => { const m = KM.get(KLThesis.matchWatch(x)); return `<li>${esc(x)}${m && m.v != null ? ` <small class="thkv">目前 ${kv(m)}</small>` : ""}</li>`; }).join("")}</ul>` : `<p class="note">—</p>`);
    // 估值：本益比、淨值比、殖利率、同產業中位數；歷史區間與情境價按了才查
    const vRow = (() => {
      if (!/^\d/.test(c) || !BW) return "";
      if (BW.busy) return `<p class="note thval">載入估值資料…</p>`;
      if (BW.fail) return `<p class="note thval lgwarn">估值資料這次拿不到${BW.msg ? `（${esc(BW.msg)}）` : ""}，1 分鐘後自動再試。</p>`;
      const b = BW.rows?.[c]; if (!b) return `<p class="note thval">這檔沒有本益比資料（ETF 或資料還沒公布）。</p>`;
      const ind = ERow.get(c)?.[2], peers = ind ? [...ERow.values()].filter(r => r[2] === ind && String(r[0]) !== c).map(r => BW.rows[r[0]]?.[0]) : [];
      const H = W.thVal?.[c], V = KLThesis.valuation({ price: LV.get(c).price, pe: b[0], pb: b[1], dy: b[2], peers, hist: H?.per || [] }), n2 = v => (v == null ? "—" : String(+v.toFixed(2)));
      const pc = v => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
      const epsQ = ERow.get(c)?.[8], lossQ = typeof epsQ === "number" && epsQ < 0;
      let h = `<div class="thval"><span class="note">估值</span><span>本益比 <b>${V.peState === "ok" ? n2(V.pe) : V.peState === "missing" ? "無資料" : "—"}</b>${V.ind ? `<small class="note">（${esc(ind)}中位數 ${n2(V.ind.median)}，${V.ind.n} 家）</small>` : ""}</span><span>淨值比 <b>${n2(V.pb)}</b></span><span>殖利率 <b>${V.dy == null ? "—" : V.dy + "%"}</b></span></div>`;
      if (V.peState !== "ok") return h + `<p class="note thval">${V.peState === "missing" ? "這檔目前沒有本益比資料" : "本益比不是正數"}${lossQ ? "（財報表顯示本季 EPS 為負）" : ""}，不算情境價；可以改看淨值比。</p>`;
      if (!H) return h + `<div class="lgbar thval"><button type="button" class="btn sm" data-th="val" data-c="${esc(c)}">看歷史區間與情境價</button></div>`;
      if (H.busy) return h + `<p class="note thval">查這檔過去的本益比…</p>`;
      if (H.err) return h + `<p class="note thval lgwarn">歷史本益比這次拿不到（${esc(H.err)}）。</p><div class="lgbar thval"><button type="button" class="btn sm" data-th="val" data-c="${esc(c)}">再查一次</button></div>`;
      if (H.none) return h + `<p class="note thval">查得到這檔，但沒有歷史本益比資料，不算區間。</p>`;
      const span = `${esc(H.from.replace(/-/g, "/"))}～${esc(H.to.replace(/-/g, "/"))}，${H.per.length} 筆`;
      if (!V.band) return h + `<p class="note thval">歷史本益比只有 ${span}，不到 60 筆，不算區間。</p>`;
      return h + `<p class="note thval">${span}的本益比，20%～80% 落在 ${n2(V.band.lo)}～${n2(V.band.hi)}，目前在 ${V.band.pct}% 的位置（越低相對越便宜）。</p>`
        + (V.scen.length ? `<ul class="thscen">${V.scen.map(x => `<li><span>${KLThesis.SCEN_LABEL[x.k]}（本益比 ${n2(x.pe)}）</span><b>${n2(x.price)}</b><small class="${x.chg >= 0 ? "up" : "down"}">${pc(x.chg)}</small></li>`).join("")}</ul>
          <p class="note thval">情境價＝近四季 EPS（${n2(V.eps)}，用現價 ÷ 本益比反推）× 歷史本益比分位${V.ind?.price ? `；用同產業中位數算是 ${n2(V.ind.price)}` : ""}。只是粗估：沒算成長、利率與產業變化，不是目標價或投資建議。</p>` : "");
    })();
    const kRow = !/^\d/.test(c) ? "" : K ? `<div class="thkpi"><span class="note">最新財報${per[0] || per[1] ? `（營收 ${esc(per[0])}・季報 ${esc(per[1])}）` : ""}</span>${K.map(x => `<span>${esc(x.label)} ${kv(x)}</span>`).join("")}</div>`
      : ED?.busy ? `<p class="note thkpi">載入財報指標…</p>` : ED?.rows ? `<p class="note thkpi">這檔不在月營收／季報資料裡（ETF、新上市或興櫃）。</p>` : ED?.fail ? `<p class="note thkpi lgwarn">財報指標這次拿不到${ED.msg ? `（${esc(ED.msg)}）` : ""}，1 分鐘後自動再試。</p>` : "";
    return `<section class="pfcard thcard" data-nofold><div class="thh"><button type="button" class="linkbtn" data-sel="${esc(c)}"><b>${esc(nameOf(c))}</b> <small class="note">${esc(c)}</small></button>${has ? `<span class="thst thst-${s}">${SL[s]}</span>` : ""}${it.review ? `<span class="note${due ? " lgwarn" : ""}">下次檢視 ${esc(it.review)}${due ? "（到期）" : ""}</span>` : ""}</div>`
      + lvRow + kRow + vRow + (has ? `<div class="thgrid"><div><h5 class="pfh">為什麼買</h5><p>${esc(it.reason || "—")}</p></div><div><h5 class="pfh">要觀察的</h5>${ulW(it.watch)}</div><div><h5 class="pfh">什麼情況代表論點不成立</h5>${ul(it.kill)}</div></div>`
        + (it.log?.length ? `<p class="note thlast">最近檢視 ${esc(it.log[0].d)}${it.log[0].status ? `・${SL[it.log[0].status]}` : ""}：${esc(it.log[0].note || "—")}${it.log.length > 1 ? `（共 ${it.log.length} 筆）` : ""}</p>` : "")
        : `<p class="note">還沒寫這檔的投資論點。</p>`)
      + `<div class="lgbar"><button type="button" class="btn sm${has ? "" : " primary"}" data-th="edit" data-c="${esc(c)}">${has ? "修改論點" : "寫論點"}</button>${has ? `<button type="button" class="btn sm" data-th="log" data-c="${esc(c)}">加檢視紀錄</button>` : ""}${lv.stopPrice != null || lv.takePrice != null ? `<button type="button" class="btn sm" data-th="alert" data-c="${esc(c)}">設成到價提醒</button>` : ""}</div></section>`;
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
    <div class="throw">${["stop", "take"].map(k => { const x = it[k], pct = x?.mode === "pct";
      return `<label>${k === "stop" ? "停損" : "停利"}<span class="thlvin"><input type="number" inputmode="decimal" step="any" min="0" name="${k}" value="${x ? Math.abs(x.v) : ""}" placeholder="不設">
      <select name="${k}Mode" aria-label="${k === "stop" ? "停損" : "停利"}的單位"><option value="price" ${pct ? "" : "selected"}>價格</option><option value="pct" ${pct ? "selected" : ""}>${k === "stop" ? "成本跌 %" : "成本漲 %"}</option></select></span></label>`; }).join("")}</div>
    <p class="note">停損停利是你自己的紀錄：只在這裡顯示距離，不會自動下單；要通知可以按卡片上的「設成到價提醒」。百分比是相對平均成本。</p>
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
  if (a === "alert") { thAlert(b.dataset.c); return; }
  if (a === "val") { if (W.thVal?.[b.dataset.c]?.err) delete W.thVal[b.dataset.c]; thHist(b.dataset.c); renderList(); return; }
  if (a === "edit") { L.thEdit = b.dataset.c; L.thLog = null; } else if (a === "log") { L.thLog = b.dataset.c; L.thEdit = null; } else if (a === "close") { L.thEdit = L.thLog = null; }
  renderList();
});
// 把停損停利寫進到價提醒（watch:alerts，和個股頁的「價格提醒」同一份）：已經觸及的那一邊不寫；原本有提醒先確認
function thAlert(c) {
  const L = (W.lg ||= {}), lv = W.thLv?.get(c); if (!lv) return;
  const now = lv.price > 0 ? lv.price : null, r2 = v => Math.round(v * 100) / 100;
  const dn = lv.stopPrice != null && (now == null || lv.stopPrice < now) ? r2(lv.stopPrice) : null, up = lv.takePrice != null && (now == null || lv.takePrice > now) ? r2(lv.takePrice) : null;
  if (dn == null && up == null) { L.thMsg = `${nameOf(c)} 的現價已經超過停損或停利，沒有設提醒。`; renderList(); return; }
  const old = W.alerts?.[c], t = a => [a.up ? `漲到 ${a.up}` : "", a.dn ? `跌到 ${a.dn}` : ""].filter(Boolean).join("、");
  if (old && (old.up || old.dn) && !confirm(`${nameOf(c)} 已經有到價提醒（${t(old)}），要換成停損停利（${t({ up, dn })}）嗎？`)) return;
  W.alerts[c] = { up, dn, name: nameOf(c) }; store.set("watch:alerts", W.alerts);
  L.thMsg = `已設 ${nameOf(c)} 的到價提醒：${t({ up, dn })}。報價更新時觸發。`; renderList();
}
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
.thlv{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;margin:0 0 6px;font-size:13px;font-variant-numeric:tabular-nums}.thlv-stop_hit,.thlv-near_stop{color:var(--down);border-color:currentColor}.thlv-take_hit,.thlv-near_take{color:var(--up);border-color:currentColor}
.thkpi{display:flex;flex-wrap:wrap;gap:2px 12px;align-items:baseline;margin:0 0 8px;font-size:13px;font-variant-numeric:tabular-nums}.thkpi>.note{flex-basis:100%}.thkv{white-space:nowrap}
.thval{margin:0 0 6px;font-size:13px}div.thval:not(.lgbar){display:flex;flex-wrap:wrap;gap:2px 12px;align-items:baseline;font-variant-numeric:tabular-nums}
.thscen{list-style:none;margin:4px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:4px 12px;font-size:13px;font-variant-numeric:tabular-nums}.thscen li{display:flex;gap:8px;align-items:baseline;white-space:nowrap}
.thlvin{display:grid;grid-template-columns:minmax(4.5em,1fr) minmax(0,max-content);gap:6px}.thform .thlvin select{width:auto;max-width:100%}
.thform{display:grid;gap:8px}.thform label{display:grid;gap:4px;font-size:13px}.thform textarea,.thform input,.thform select{width:100%;min-width:0;box-sizing:border-box;font:inherit}.throw{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
@media (max-width:560px){.thev li{grid-template-columns:max-content minmax(0,1fr) auto}.thev li>.note{grid-column:2/-1}}
@media (pointer:coarse){.thev .linkbtn,.thcard .thh .linkbtn,.btn[data-th],.thform .btn{min-height:44px}}`;
  document.head.appendChild(st);
})();
