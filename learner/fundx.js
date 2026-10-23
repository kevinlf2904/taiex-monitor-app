/* ================= 財報延伸：選股「條件組合」、財報「事件回測」「估值地圖」、庫存「總經敏感度」 =================
   條件組合：月營收連續年增、創新高、年增率、三率三升、毛利率、本益比（絕對值或低於同產業中位數）、殖利率、法人近幾日買超，任意組合，可以存成自己的組合。
     資料：data/earn-hist.json（連續年增、新高、三率）、/api/oapi?earn=1（月營收年增、產業）、/api/screen?bw=1（本益比、殖利率）、/api/daily（法人，和資金雷達同一份）。
   事件回測：data/event-study.json（scripts/event-study.mjs 每天收盤後用全市場日 K 算：營收創新高、三率三升…之後 5／10／20 天的報酬）。
   估值地圖：同產業每家公司的本益比（橫軸）× 月營收年增（縱軸），圓圈大小是營收，點一下看個股。
   總經敏感度：持股日報酬對美元兌台幣、美債 10 年期殖利率、費半、那斯達克的 Beta（quant.js 的 macroBeta），換算成「因子動一下，持股大約動多少」。
   用到 watch.html 的 W、esc、cls、getJ、store、renderList、nameOf、fmtP、toast、holdRows、loadMoney，earn.js 的 ER、erLoad、erPct，earnx.js 的 EX_TW_VIEWS、exNote，
   tools.js 的 mfValLoad、dailyFresh，quant.js 的 macroBeta、qMed、qCards、qP。 */
async function ehLoad() {
  if (W.ehist) return W.ehist; if (W.ehistP) return W.ehistP;
  return (W.ehistP = fetch("data/earn-hist.json", { cache: "no-cache", signal: tmo(20000) }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => { W.ehistP = null; if (j) W.ehist = j; return j; }));
}

/* ---------- 選股：條件組合 ---------- */
// [鍵, 名稱, 參數選項（null＝只有開關）, 預設參數, 單位, 需要的資料]
const CB_CONDS = [
  ["streak", "月營收連續年增", [3, 6, 12], 6, "個月以上", "eh"], ["hi", "月營收創新高", [12, 24, 36], 12, "個月新高", "eh"], ["yoy", "月營收年增", [10, 20, 30, 50], 20, "% 以上", "er"],
  ["pm3", "三率三升", null, true, "毛利率、營益率、淨利率都比上一季高", "eh"], ["gm", "毛利率", [20, 30, 40, 50], 30, "% 以上", "eh"],
  ["pe", "本益比", [10, 12, 15, 20, 30], 15, "倍以下（不含虧損）", "bw"], ["peInd", "本益比低於同產業中位數", null, true, "和同產業比相對便宜", "bw"], ["dy", "殖利率", [3, 4, 5, 6], 4, "% 以上", "bw"],
  ["inst", "三大法人合計買超", [1, 3, 5, 10], 5, "日", "mf"], ["trust", "投信合計買超", [1, 3, 5, 10], 3, "日", "mf"]];
const CB_PRESETS = [["成長股", { streak: 6, pm3: true }], ["價值成長", { yoy: 20, pe: 15 }], ["法人認養", { trust: 5, yoy: 10 }], ["高殖利率＋成長", { dy: 4, streak: 3 }]];
const CB = () => (W.cb ||= { c: store.get("watch:cb", null) || { ...CB_PRESETS[0][1] }, saved: store.get("watch:cbs", []) || [] });
const cbSave = () => { const S = CB(); store.set("watch:cb", S.c); store.set("watch:cbs", S.saved); };
const cbNeed = c => new Set(["er", ...CB_CONDS.filter(x => c[x[0]] != null && c[x[0]] !== false).map(x => x[5])]);
const cbDays = c => Math.max(c.inst || 0, c.trust || 0);
function cbMissing(c) {
  const N = cbNeed(c); return [...N].filter(k => (k === "eh" ? !W.ehist : k === "er" ? !ER().data?.rows : k === "bw" ? !W.mfVal : k === "mf" ? W.mf.days.length < cbDays(c) && !(W.mf.days.length && W.mf.tried?.size > cbDays(c) * 2 + 10) : false));
}
async function cbLoad() {
  const S = CB(), miss = cbMissing(S.c); if (S.busy || !miss.length || W.off) return; S.busy = true;
  S.tk = miss.join(","); // 同一組缺的資料只自動載入一次；抓不到時顯示「重試」，不會一直重抓
  try { await Promise.all(miss.map(k => (k === "eh" ? ehLoad() : k === "er" ? erLoad() : k === "bw" ? mfValLoad() : k === "mf" ? loadMoney(Math.max(cbDays(S.c), 1)) : null))); } catch {}
  S.busy = false; if (W.lt === "screen" && W.scrG === "combo") renderList();
}
function cbRows(c) {
  const R = (ER().data?.rows || []).filter(r => /^\d{4}$/.test(r[0])), EH = W.ehist, V = W.mfVal || {}, st = new Map((EH?.streak?.rows || []).map(r => [r[0], r])), pm = new Map((EH?.pm?.rows || []).map(r => [r[0], r]));
  const nd = cbDays(c), days = nd ? W.mf.days.slice(-nd) : [], flow = new Map();
  for (const D of days) for (const x of D.rows) { const f = flow.get(x[0]) || [0, 0]; f[0] += (x[4] || 0) + (x[5] || 0) + (x[6] || 0); f[1] += x[5] || 0; flow.set(x[0], f); }
  const peBy = new Map(); for (const r of R) { const pe = V[r[0]]?.[0]; if (pe > 0 && r[2]) (peBy.get(r[2]) || peBy.set(r[2], []).get(r[2])).push(pe); }
  const peMed = new Map([...peBy].map(([g, A]) => [g, qMed(A)]));
  const out = [];
  for (const r of R) {
    const s = st.get(r[0]), p = pm.get(r[0]), v = V[r[0]], f = flow.get(r[0]), x = { c: r[0], n: r[1], ind: r[2], yoy: r[6], s: s?.[4] ?? 0, hi: s?.[7] ?? 0, pm3: !!(p && p[7] > 0 && p[8] > 0 && p[9] > 0), gm: p?.[4] ?? r[11] ?? null, pe: v?.[0] ?? null, dy: v?.[2] ?? null, inst: f?.[0] ?? null, trust: f?.[1] ?? null, pem: peMed.get(r[2]) ?? null };
    if (c.streak && !(x.s >= c.streak)) continue; if (c.hi && !(x.hi >= c.hi)) continue; if (c.yoy && !(x.yoy >= c.yoy)) continue; if (c.pm3 && !x.pm3) continue; if (c.gm && !(x.gm >= c.gm)) continue;
    if (c.pe && !(x.pe > 0 && x.pe <= c.pe)) continue; if (c.peInd && !(x.pe > 0 && x.pem != null && x.pe < x.pem)) continue; if (c.dy && !(x.dy >= c.dy)) continue;
    if (c.inst && !(x.inst > 0)) continue; if (c.trust && !(x.trust > 0)) continue;
    out.push(x);
  }
  return out.sort((a, b) => (b.yoy ?? -1e9) - (a.yoy ?? -1e9));
}
function cbHtml() {
  const S = CB(), c = S.c, miss = cbMissing(c), on = CB_CONDS.filter(x => c[x[0]] != null && c[x[0]] !== false);
  const failed = miss.length && !S.busy && S.tk === miss.join(","); if (miss.length && !S.busy && !failed && !W.off) setTimeout(cbLoad, 0);
  const same = (a, b) => JSON.stringify(Object.entries(a).filter(([, v]) => v != null && v !== false).sort()) === JSON.stringify(Object.entries(b).filter(([, v]) => v != null && v !== false).sort());
  const R = miss.length ? null : cbRows(c), D = ER().data, nd = cbDays(c);
  return `<section class="csec cbx"><h3>條件組合 <span class="note">勾選條件，全部符合的才列出（台股上市櫃）</span></h3>
    <div class="cbpre"><span class="note">預設</span>${CB_PRESETS.map(([t, p], i) => `<button class="ichip" data-cbpre="${i}" aria-pressed="${same(c, p)}">${t}</button>`).join("")}
      ${S.saved.length ? `<span class="note">我的組合</span>${S.saved.map((x, i) => `<span class="cbsv"><button class="ichip" data-cbsv="${i}" aria-pressed="${same(c, x.c)}">${esc(x.name)}</button><button class="linkbtn" data-cbdel="${i}" aria-label="刪除 ${esc(x.name)}">✕</button></span>`).join("")}` : ""}</div>
    <div class="cbconds">${CB_CONDS.map(([k, t, opts, d, u]) => { const v = c[k], act = v != null && v !== false;
      return `<label class="cbc${act ? " on" : ""}"><input type="checkbox" data-cbk="${k}" ${act ? "checked" : ""}><b>${t}</b>${opts ? `${k === "inst" || k === "trust" ? `<span class="note">近</span>` : ""}<select data-cbp="${k}" aria-label="${t}">${opts.map(o => `<option value="${o}" ${(act ? v : d) === o ? "selected" : ""}>${o}</option>`).join("")}</select>` : ""}<span class="note">${u}</span></label>`; }).join("")}</div>
    <div class="irform"><button class="btn sm" data-cbsave>儲存這個組合</button><button class="btn sm" data-cbgrp ${R?.length ? "" : "disabled"}>結果存成自選群組</button></div>
    ${!on.length ? `<p class="note">至少勾一個條件。</p>` : !R ? `<p class="note">${W.off ? "需要部署到網站才有資料。" : `${failed ? "⚠︎ 暫時拿不到" : "載入"}${miss.map(k => ({ eh: "營收、三率", er: "月營收", bw: "本益比", mf: `法人（${nd} 日）` })[k]).join("、")}資料${failed ? `。<button class="btn sm" data-cbretry>重試</button>` : "…"}`}</p>`
      : `<h4>符合 ${R.length} 檔${R.length > 150 ? "（只列前 150 檔）" : ""} <span class="note">依月營收年增排序${D?.ym ? `・月營收 ${erYm(D.ym)}` : ""}${W.ehist?.pm?.q ? `・三率 ${esc(W.ehist.pm.q)}` : ""}${nd ? `・法人最近 ${Math.min(nd, W.mf.days.length)} 個交易日` : ""}</span></h4>
      ${R.length ? `<div class="ctbl"><table class="cbtbl"><thead><tr><th>股票</th><th>產業</th><th>年增</th><th>連續年增</th><th>三率</th><th>本益比</th><th>殖利率</th>${nd ? "<th>法人買超（張）</th>" : ""}</tr></thead><tbody>${R.slice(0, 150).map(x => `<tr>
        <td><button class="linkbtn" data-sel="${esc(x.c)}">${esc(x.n)} ${esc(x.c)}</button></td><td>${esc(x.ind || "")}</td><td class="${cls(x.yoy)}">${erPct(x.yoy)}</td><td>${x.s ? x.s + " 月" : "—"}${x.hi ? `<small class="note"> 新高 ${x.hi}</small>` : ""}</td>
        <td>${x.pm3 ? `<b class="up">三升</b>` : ""}${x.gm != null ? `<small class="note"> 毛利 ${x.gm}%</small>` : ""}</td><td>${x.pe > 0 ? x.pe.toFixed(1) : "—"}${x.pem != null && x.pe > 0 ? `<small class="note"> 業 ${x.pem.toFixed(1)}</small>` : ""}</td><td>${x.dy != null ? x.dy + "%" : "—"}</td>
        ${nd ? `<td class="${cls(c.trust && !c.inst ? x.trust : x.inst)}">${x.inst == null ? "—" : `${Math.round(x.inst).toLocaleString()}${x.trust ? `<small class="note"> 投信 ${Math.round(x.trust).toLocaleString()}</small>` : ""}`}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<p class="note">沒有同時符合的股票，試著放寬或拿掉一個條件。</p>`}`}</section>`;
}
$("#lx").addEventListener("change", e => {
  if (W.lt !== "screen" || W.scrG !== "combo") return; const t = e.target, S = CB(), C = k => CB_CONDS.find(x => x[0] === k);
  if (t.dataset.cbk) { const k = t.dataset.cbk, x = C(k); if (t.checked) S.c[k] = x[2] ? +(t.closest(".cbc").querySelector("select")?.value || x[3]) : true; else delete S.c[k]; cbSave(); renderList(); }
  else if (t.dataset.cbp) { const k = t.dataset.cbp; S.c[k] = +t.value; cbSave(); renderList(); }
});
$("#lx").addEventListener("click", e => {
  if (W.lt !== "screen" || W.scrG !== "combo") return; const b = e.target.closest("[data-cbpre],[data-cbsv],[data-cbdel],[data-cbsave],[data-cbgrp],[data-cbretry]"); if (!b) return; const S = CB(), d = b.dataset;
  if (b.hasAttribute("data-cbretry")) { S.tk = null; return cbLoad(); }
  if (d.cbpre != null) { S.c = { ...CB_PRESETS[+d.cbpre][1] }; cbSave(); return renderList(); }
  if (d.cbsv != null) { S.c = { ...S.saved[+d.cbsv].c }; cbSave(); return renderList(); }
  if (d.cbdel != null) { S.saved.splice(+d.cbdel, 1); cbSave(); return renderList(); }
  if (b.hasAttribute("data-cbsave")) { const n = prompt("組合名稱", CB_CONDS.filter(x => S.c[x[0]] != null).map(x => x[1]).slice(0, 2).join("＋")); if (!n?.trim()) return; S.saved = [...S.saved.filter(x => x.name !== n.trim()), { name: n.trim().slice(0, 20), c: { ...S.c } }].slice(-12); cbSave(); toast("已儲存", 1500); return renderList(); }
  if (b.hasAttribute("data-cbgrp")) { const R = cbRows(S.c).slice(0, 50).map(x => x.c), n = prompt(`把前 ${R.length} 檔存成自選群組，群組名稱`, "條件選股"); if (!n?.trim()) return;
    const g = W.groups.find(x => x.name === n.trim()); if (g) g.list = R; else W.groups.push({ name: n.trim().slice(0, 12), list: R }); saveGroups(); toast(`已存成「${n.trim()}」群組（${R.length} 檔）`); }
});

/* ---------- 財報 → 事件回測 ---------- */
async function evsLoad() {
  if (W.evsBusy || W.off) return; W.evsBusy = true;
  try { const r = await fetch("data/event-study.json", { cache: "no-cache", signal: tmo(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); W.evs = await r.json(); } catch (e) { W.evs = { err: e.message }; }
  W.evsBusy = false; if (W.lt === "earn") renderList();
}
const pc1 = v => (v == null ? "—" : qP(v)), pcw = v => (v == null ? "—" : `${Math.round(v * 100)}%`);
function fxEvt(E) {
  const J = W.evs; if (!J && !W.evsBusy) setTimeout(evsLoad, 0);
  if (!J?.types) return `<section class="mk"><h3>事件回測</h3><p class="note">${J?.err ? "還沒有回測資料：每個交易日收盤後由排程用全市場日 K 計算，第一次跑完後就會出現。" : "載入中…"}</p></section>`;
  const t = store.get("watch:erevt", "high"), T = J.types.find(x => x.t === t) || J.types[0], N = J.ns || [5, 10, 20], last = N.at(-1);
  const bins = ["< −20%", "−20～−15", "−15～−10", "−10～−5", "−5～0", "0～5", "5～10", "10～15", "15～20", "≥ 20%"], hm = Math.max(1, ...(T.hist || []));
  return `<section class="mk"><h3>財報事件回測<span class="note">${J.from}～${J.to}・${J.stocks} 檔上市櫃股票</span>${exNote("事件回測", "把過去發生同一種財報事件的股票全部找出來，看公布後持有 5、10、20 個交易日的報酬。月營收一律用次月 11 日之後第一個交易日的收盤價進場、季報用法定期限隔天之後，不會用到當時還沒公布的數字；不含手續費與稅。")}</h3>
    <div class="ichips erchips">${J.types.map(x => `<button class="ichip" data-erevt="${x.t}" aria-pressed="${x.t === T.t}">${esc(x.name)}</button>`).join("")}</div>
    <p class="note">${esc(T.desc)}。贏大盤＝和同一段期間全市場平均（等權）相比的超額報酬。</p>
    <div class="ctbl"><table class="evtbl"><thead><tr><th>持有</th><th>樣本</th><th>平均報酬</th><th>中位數</th><th>上漲機率</th><th>贏大盤（平均）</th><th>贏大盤機率</th></tr></thead><tbody>
      ${N.map(n => { const s = T.stats[n]; return `<tr><td>${n} 天</td><td>${s?.n ?? 0}</td><td class="${cls(s?.avg)}">${pc1(s?.avg)}</td><td class="${cls(s?.med)}">${pc1(s?.med)}</td><td>${pcw(s?.win)}</td><td class="${cls(s?.ex)}">${pc1(s?.ex)}</td><td>${pcw(s?.exWin)}</td></tr>`; }).join("")}</tbody></table></div>
    <h4>${last} 天報酬分佈</h4><div class="evhist">${(T.hist || []).map((v, i) => `<div title="${bins[i]}：${v} 筆"><i class="${i < 5 ? "dn" : "upb"}" style="height:${(v / hm * 100).toFixed(0)}%"></i><small>${bins[i].replace("%", "")}</small></div>`).join("")}</div>
    <h4>各種事件比一比 <span class="note">持有 ${last} 天</span></h4><div class="ctbl"><table><thead><tr><th>事件</th><th>樣本</th><th>平均報酬</th><th>上漲機率</th><th>贏大盤</th></tr></thead><tbody>
      ${J.types.map(x => { const s = x.stats[last]; return `<tr${x.t === T.t ? ' class="on"' : ""}><td><button class="linkbtn" data-erevt="${x.t}">${esc(x.name)}</button></td><td>${s?.n ?? 0}</td><td class="${cls(s?.avg)}">${pc1(s?.avg)}</td><td>${pcw(s?.win)}</td><td class="${cls(s?.ex)}">${pc1(s?.ex)}</td></tr>`; }).join("")}</tbody></table></div>
    ${T.ind?.length ? `<h4>哪些產業最有效 <span class="note">${esc(T.name)}後 ${last} 天，至少 8 筆的產業</span></h4><div class="ctbl"><table><thead><tr><th>產業</th><th>樣本</th><th>平均</th><th>上漲機率</th></tr></thead><tbody>${[...T.ind.slice(0, 5), ...(T.ind.length > 8 ? T.ind.slice(-3) : [])].map(r => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td><td class="${cls(r[2])}">${pc1(r[2])}</td><td>${pcw(r[3])}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <h4>最近發生的 ${esc(T.name)}</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>期別</th><th>進場日</th>${N.map(n => `<th>${n} 天</th>`).join("")}</tr></thead><tbody>
      ${(T.recent || []).slice(0, 20).map(r => `<tr><td><button class="linkbtn" data-sel="${esc(r[0])}">${esc(r[1] || nameOf(r[0]))} ${esc(r[0])}</button></td><td>${esc(r[2])}</td><td>${esc(r[3].slice(5).replace("-", "/"))}</td>${N.map((n, i) => `<td class="${cls(r[4 + i])}">${r[4 + i] == null ? `<span class="note">進行中</span>` : pc1(r[4 + i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">過去的統計不代表未來；樣本少（幾十筆以下）時結果容易被少數股票左右。</p></section>`;
}

/* ---------- 財報 → 估值地圖 ---------- */
function fxMap(E, D, ok) {
  const V = W.mfVal; if (!V && !W.mfValBusy && !W.off) { W.mfValBusy = true; mfValLoad().finally(() => { W.mfValBusy = false; if (W.lt === "earn") renderList(); }); }
  const rows = D.rows.filter(r => ok(r) && /^\d{4}$/.test(r[0]) && r[6] != null && r[2]), cnt = new Map(); for (const r of rows) cnt.set(r[2], (cnt.get(r[2]) || 0) + 1);
  const inds = [...cnt].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]), selInd = rows.find(r => r[0] === W.sel)?.[2];
  const ind = inds.some(x => x[0] === E.mapInd) ? E.mapInd : inds.some(x => x[0] === selInd) ? selInd : inds[0]?.[0];
  const sel = `<label class="erind-sel"><span class="note">產業</span><select data-fxmap aria-label="選產業">${inds.map(([n, c]) => `<option value="${esc(n)}" ${n === ind ? "selected" : ""}>${esc(n)}（${c}）</option>`).join("")}</select></label>`;
  if (!V) return `<section class="mk"><h3>同業估值地圖</h3><p class="note">${W.off ? "需要部署到網站才有資料。" : "載入本益比…"}</p></section>`;
  const P = rows.filter(r => r[2] === ind).map(r => ({ c: r[0], n: r[1], yoy: r[6], rev: r[4] || 0, pe: V[r[0]]?.[0] })).filter(p => p.pe > 0 && p.pe < 300);
  if (P.length < 3) return `<section class="mk"><h3>同業估值地圖</h3><div class="erbar">${sel}</div><p class="note">這個產業有本益比的公司太少（虧損公司沒有本益比）。</p></section>`;
  const Wd = 640, Hd = 380, pad = { l: 44, r: 14, t: 16, b: 34 }, peMax = Math.min(80, Math.max(...P.map(p => p.pe)) * 1.08), ys = P.map(p => Math.max(-60, Math.min(150, p.yoy)));
  const yLo = Math.min(-10, ...ys) - 5, yHi = Math.max(20, ...ys) + 5, X = v => pad.l + (Math.min(v, peMax) / peMax) * (Wd - pad.l - pad.r), Y = v => pad.t + (1 - (Math.max(yLo, Math.min(yHi, v)) - yLo) / (yHi - yLo)) * (Hd - pad.t - pad.b);
  const mPe = qMed(P.map(p => p.pe)), mY = qMed(P.map(p => p.yoy)), rMax = Math.max(...P.map(p => p.rev), 1e-9), big = new Set([...P].sort((a, b) => b.rev - a.rev).slice(0, 8).map(p => p.c));
  const tk = n => Array.from({ length: n + 1 }, (_, i) => i / n), cur = W.sel, pk = P.find(p => p.c === E.mapPick) || null, rr = p => 4 + 16 * Math.sqrt(p.rev / rMax);
  const svg = `<svg class="fxmap" viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="${esc(ind)} 本益比與營收年增">
    ${tk(4).map(f => { const v = f * peMax; return `<line x1="${X(v)}" x2="${X(v)}" y1="${pad.t}" y2="${Hd - pad.b}" class="gl"/><text x="${X(v)}" y="${Hd - pad.b + 14}" text-anchor="middle" class="ax">${v.toFixed(0)}</text>`; }).join("")}
    ${tk(4).map(f => { const v = yLo + f * (yHi - yLo); return `<line x1="${pad.l}" x2="${Wd - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${v.toFixed(0)}%</text>`; }).join("")}
    <line x1="${X(mPe)}" x2="${X(mPe)}" y1="${pad.t}" y2="${Hd - pad.b}" class="md"/><line x1="${pad.l}" x2="${Wd - pad.r}" y1="${Y(mY)}" y2="${Y(mY)}" class="md"/>
    <text x="${pad.l + 6}" y="${pad.t + 14}" class="qd">便宜＋成長</text><text x="${Wd - pad.r - 6}" y="${pad.t + 14}" text-anchor="end" class="qd">貴＋成長</text>
    <text x="${pad.l + 6}" y="${Hd - pad.b - 8}" class="qd">便宜＋衰退</text><text x="${Wd - pad.r - 6}" y="${Hd - pad.b - 8}" text-anchor="end" class="qd">貴＋衰退</text>
    <text x="${(pad.l + Wd - pad.r) / 2}" y="${Hd - 4}" text-anchor="middle" class="ax">本益比（倍）→</text>
    ${[...P].sort((a, b) => b.rev - a.rev).map(p => `<g data-fxpt="${esc(p.c)}" class="pt${p.c === cur ? " cur" : ""}${p === pk ? " pick" : ""}"><title>${esc(p.n)} ${p.c}：本益比 ${p.pe.toFixed(1)}、營收年增 ${erPct(p.yoy)}、月營收 ${p.rev.toFixed(1)} 億</title><circle cx="${X(p.pe).toFixed(1)}" cy="${Y(p.yoy).toFixed(1)}" r="${rr(p).toFixed(1)}" class="${p.yoy >= 0 ? "u" : "d"}"/>${big.has(p.c) || p.c === cur || p === pk ? `<text x="${X(p.pe).toFixed(1)}" y="${(Y(p.yoy) - 2 - rr(p)).toFixed(1)}" text-anchor="middle" class="lb">${esc(p.n.slice(0, 5))}</text>` : ""}</g>`).join("")}</svg>`;
  // 點圓圈：旁邊跳出資訊框（和產業中位數比、同業排第幾、象限），再點「看個股」才切換；點空白或 × 關掉
  const box = !pk ? "" : (() => { const lx = X(pk.pe) / Wd * 100, ty = Y(pk.yoy) / Hd * 100, n = P.length, peR = [...P].sort((a, b) => a.pe - b.pe).indexOf(pk) + 1, yR = [...P].sort((a, b) => b.yoy - a.yoy).indexOf(pk) + 1, dPe = (pk.pe / mPe - 1) * 100;
    const q = `${pk.pe <= mPe ? "便宜" : "貴"}＋${pk.yoy >= mY ? "成長" : "衰退"}`, g = pk.yoy > 0 ? pk.yoy / pk.pe : null;
    // 放左邊還是右邊：放得下（約占圖寬 42%）的那一邊裡，蓋到比較少圓圈的
    const cnt = (a, b) => P.filter(p => p !== pk && X(p.pe) / Wd * 100 > a && X(p.pe) / Wd * 100 < b).length, rightOk = lx + 44 < 100, leftOk = lx - 44 > 0;
    const right = rightOk && (!leftOk || cnt(lx, lx + 44) <= cnt(lx - 44, lx));
    return `<div class="fxtip" style="left:${lx.toFixed(1)}%;top:${ty.toFixed(1)}%;--tx:${right ? "14px" : "calc(-100% - 14px)"};--ty:${ty < 30 ? "-10%" : ty > 70 ? "-90%" : "-50%"}" role="dialog" aria-label="${esc(pk.n)} 估值">
      <div class="fxtip-h"><b>${esc(pk.n)}</b> <span class="note">${pk.c}</span><button type="button" class="fxtip-x" data-fxpt="" aria-label="關閉">×</button></div>
      <div class="fxtip-q">${q}<span class="note">（相對產業中位數）</span></div>
      <dl><dt>本益比</dt><dd>${pk.pe.toFixed(1)} 倍<small class="note">比中位數${dPe >= 0 ? "貴" : "便宜"} ${Math.abs(dPe).toFixed(0)}%</small><small class="note">同業第 ${peR} 低（共 ${n} 家）</small></dd>
        <dt>營收年增</dt><dd class="${pk.yoy >= 0 ? "up" : "down"}">${erPct(pk.yoy)}<small class="note">中位數 ${erPct(mY)}</small><small class="note">成長第 ${yR} 名</small></dd>
        <dt>月營收</dt><dd>${pk.rev.toFixed(1)} 億</dd>${g != null ? `<dt>成長÷本益比</dt><dd>${g.toFixed(2)}</dd>` : ""}</dl>
      <button type="button" class="btn sm primary" data-sel="${esc(pk.c)}">看個股 ›</button></div>`; })();
  const L = P.filter(p => p.yoy > 0).map(p => ({ ...p, g: p.yoy / p.pe })).sort((a, b) => b.g - a.g).slice(0, 12);
  return `<section class="mk${W.fxFull ? " fxfull" : ""}"><h3>同業估值地圖<span class="note">${esc(ind)}・${P.length} 家有本益比</span>${exNote("估值地圖", "橫軸是本益比（股價 ÷ 近四季 EPS，越左越便宜），縱軸是最新月營收年增（越上面成長越快），圓圈越大營收越大；虛線是產業中位數。左上角是「相對便宜又在成長」的公司，但便宜也可能有原因（例如獲利只是一次性的），要搭配營收與 EPS 趨勢看。")}</h3>
    <div class="erbar">${sel}<button type="button" class="btn sm fxfullbtn" data-fxfull aria-pressed="${!!W.fxFull}">${W.fxFull ? "✕ 縮小" : "⛶ 全螢幕"}</button></div><div class="fxmapbox">${svg}${box}</div>
    <p class="note">產業中位數：本益比 ${mPe.toFixed(1)} 倍、營收年增 ${erPct(mY)}。點圓圈看這家公司的估值細節。</p>
    ${L.length ? `<h4>成長 ÷ 本益比 <span class="note">年增率除以本益比，越高代表每一倍本益比換到的成長越多（類似 PEG 的倒數）</span></h4><ol class="tlist fxrank">${L.map(p => `<li><button class="linkbtn" data-sel="${esc(p.c)}">${esc(p.n)} ${p.c}</button> <span class="note">本益比 ${p.pe.toFixed(1)}・年增 ${erPct(p.yoy)}</span> <b>${p.g.toFixed(2)}</b></li>`).join("")}</ol>` : ""}</section>`;
}
Object.assign(EX_TW_VIEWS, { evt: fxEvt, map: fxMap });
$("#lx").addEventListener("click", e => { if (W.lt !== "earn") return; const b = e.target.closest("[data-erevt]"); if (b) { store.set("watch:erevt", b.dataset.erevt); renderList(); } });
$("#lx").addEventListener("change", e => { if (W.lt === "earn" && e.target.matches("[data-fxmap]")) { ER().mapInd = e.target.value; ER().mapPick = null; renderList(); } });
$("#lx").addEventListener("click", e => { if (W.lt !== "earn") return; const g = e.target.closest("[data-fxpt]"); // 估值地圖：點圓圈開資訊框、再點一次或點空白關掉
  if (g) { const c = g.dataset.fxpt; ER().mapPick = c && ER().mapPick !== c ? c : null; renderList(); } else if (ER().mapPick && e.target.closest(".fxmap") ) { ER().mapPick = null; renderList(); } });

/* ---------- 庫存 → 總經敏感度 ---------- */
// [代號, 名稱, 算法, 台股的落後天數, 情境說明, 情境的幅度, 為什麼重要]
const MACRO_F = [["TWD=X", "美元兌台幣", "pct", 0, "台幣貶值 1%", 0.01, "出口、外銷比重高的公司台幣貶值有匯兌收益；外資匯出時台幣常一起走貶"],
  ["^TNX", "美債 10 年期殖利率", "diff", 1, "殖利率上升 0.1 個百分點", 0.1, "殖利率上升，高本益比的成長股估值壓力大；金融股利差可能變好"],
  ["^SOX", "費城半導體", "pct", 1, "費半漲 1%", 0.01, "台股權值大多是半導體與電子供應鏈，晚上費半的表現常反映在隔天開盤"],
  ["^IXIC", "那斯達克", "pct", 1, "那指漲 1%", 0.01, "美國科技股的整體氣氛，AI、雲端、消費電子供應鏈特別相關"]];
async function msLoad(m, codes) {
  const key = m + ":" + codes.join(","); if (W.msens?.key === key && (W.msens.busy || Date.now() - W.msens.at < 30 * 60e3)) return; if (W.off) return;
  W.msens = { key, busy: true, at: Date.now() };
  const all = await Promise.all([...codes, ...MACRO_F.map(f => f[0])].map(c => dailyFresh(c).catch(() => null))), F = all.slice(codes.length);
  const rows = codes.map((c, i) => ({ c, b: MACRO_F.map(([, , kind, lag], k) => macroBeta(all[i], F[k], { kind, lag: isUS(c) ? 0 : lag })) }));
  W.msens = { key, at: Date.now(), rows, ok: F.map(Boolean) };
  if (W.lt === "hold" && W.holdView === "macro") renderList();
}
function renderHoldMacro() {
  const m = W.holdMkt, us = m === "us", R = holdRows(m), money = v => (us ? "US$" : "") + Math.round(v).toLocaleString(); $("#wl").innerHTML = "";
  if (!R.length) { $("#lx").innerHTML = `<p class="note" style="padding:12px">還沒有${us ? "美股" : "台股"}持股。</p>`; return; }
  const codes = R.map(r => r.c).sort(); msLoad(m, codes);
  const S = W.msens?.key === m + ":" + codes.join(",") ? W.msens : null;
  if (!S || S.busy) { $("#lx").innerHTML = `<p class="note" style="padding:12px">${W.off ? "需要部署到網站才有資料。" : `載入 ${codes.length} 檔持股與匯率、美債、費半、那指的日 K…`}</p>`; return; }
  const tot = R.reduce((s, r) => s + (r.mv ?? r.cost), 0), w = c => { const r = R.find(x => x.c === c); return tot ? (r.mv ?? r.cost) / tot : 0; };
  const eff = (b, k) => (b ? b.beta * MACRO_F[k][5] : null), port = MACRO_F.map((f, k) => { let s = 0, cov = 0; for (const r of S.rows) { const e = eff(r.b[k], k); if (e != null) { s += w(r.c) * e; cov += w(r.c); } } return cov > 0.5 ? { e: s, cov } : null; });
  const top = port.map((p, k) => [k, p ? Math.abs(p.e) : 0]).sort((a, b) => b[1] - a[1])[0]; // 每個因子都是「一個常見幅度的變動」，影響大小可以直接比
  const cell = (b, k) => { const e = eff(b, k); if (e == null) return `<td class="note">—</td>`; const a = Math.min(1, Math.abs(b.corr) / 0.6); return `<td class="${cls(e)}" style="--ms:${a.toFixed(2)}" title="相關係數 ${b.corr.toFixed(2)}、${b.n} 個交易日"><b>${qP(e, 2)}</b><small class="note">r ${b.corr.toFixed(2)}</small></td>`; };
  const scen = [[2, -3, "費半重挫 3%"], [0, -2, "台幣升值 2%（美元兌台幣 −2%）"], [1, 2.5, "美債殖利率大漲 0.25 個百分點"], [3, -2, "那指跌 2%"]].map(([k, mult, t]) => { const p = port[k]; return p ? [t, p.e * mult] : null; }).filter(Boolean);
  $("#lx").innerHTML = `<div class="hrisk msens">
    <p class="note">用最近約 6 個月的日報酬計算：每一格是「因子動一下，這檔持股平均會跟著動多少」（Beta × 情境幅度），r 是相關係數，越接近 ±1 越可靠（格子顏色越深）。台股對美股因子用前一晚的變動。是過去的統計，不代表未來。</p>
    ${qCards(port.map((p, k) => [MACRO_F[k][4], p ? qP(p.e, 2) : "—", p ? `組合約 ${money(tot * p.e)}` : "資料不夠", p ? cls(p.e) : ""]))}
    ${top && port[top[0]] ? `<p class="msum">你的${us ? "美股" : "台股"}持股最受「<b>${MACRO_F[top[0]][1]}</b>」影響：${MACRO_F[top[0]][4]}，組合平均約 ${qP(port[top[0]].e, 2)}。${esc(MACRO_F[top[0]][6])}。</p>` : ""}
    <div class="qx-tbl"><table class="mstbl"><thead><tr><th>持股</th><th>佔比</th>${MACRO_F.map(f => `<th>${f[4]}</th>`).join("")}</tr></thead><tbody>
      ${S.rows.map(r => `<tr><td><button class="linkbtn" data-sel="${r.c}">${esc(nameOf(r.c))}<small class="note"> ${r.c}</small></button></td><td>${(w(r.c) * 100).toFixed(1)}%</td>${r.b.map(cell).join("")}</tr>`).join("")}
      <tr class="tot"><td><b>整個組合</b></td><td>100%</td>${port.map(p => (p ? `<td class="${cls(p.e)}"><b>${qP(p.e, 2)}</b></td>` : `<td class="note">—</td>`)).join("")}</tr></tbody></table></div>
    ${scen.length ? `<h4 class="qx-h">情境試算</h4><ul class="qx-list tight">${scen.map(([t, e]) => `<li><b class="${cls(e)}">${qP(e, 1)}</b><span>${t}：組合約 ${money(tot * e)}</span></li>`).join("")}</ul>` : ""}
    <h4 class="qx-h">每個因子為什麼重要</h4><ul class="qx-list tight">${MACRO_F.map(f => `<li><b>${f[1]}</b><span>${f[6]}</span></li>`).join("")}</ul>
    <p class="note">${S.ok.every(Boolean) ? "" : "有些因子的資料暫時拿不到，那一欄會是空的。"}這是線性的估計：真的大跌時相關性通常會變高，實際影響可能更大。不是投資建議。</p></div>`;
}

/* ---------- 個股「財務」的同業 PK：同產業月營收最大的 4 家（自己不在前 4 就換掉第 4 名），比估值與三率 ---------- */
// 資料：財報分頁的上市櫃月營收＋季報總表（ER().data.rows）、本益比／股價淨值比／殖利率（W.mfVal，/api/screen?bw=1）
function fxPeer(c) {
  const D = ER().data, me = D.rows.find(r => r[0] === c); if (!me?.[2]) return "";
  const V = W.mfVal || {}, L = D.rows.filter(r => r[2] === me[2] && r[4] != null).sort((a, b) => b[4] - a[4]); if (L.length < 2) return "";
  const R = L.slice(0, 4); if (!R.includes(me)) R[R.length === 4 ? 3 : R.length] = me;
  const pct = v => (v == null ? "—" : v + "%");
  // [名稱, 取值, 顯示, 越大越好？]（本益比、股價淨值比越低越便宜）
  const F = [["本益比", r => (V[r[0]]?.[0] > 0 ? V[r[0]][0] : null), v => (v == null ? "—" : v), false], ["股價淨值比", r => V[r[0]]?.[1] ?? null, v => (v == null ? "—" : v), false], ["殖利率", r => V[r[0]]?.[2] ?? null, pct, true],
    ["毛利率", r => r[11], pct, true], ["營益率", r => r[12], pct, true], ["淨利率", r => r[13], pct, true], ["本季 EPS", r => r[8], v => erNum(v), true], ["月營收年增", r => r[6], erPct, true]];
  const best = f => { const v = R.map(f[1]).filter(x => x != null); return v.length > 1 ? (f[3] ? Math.max(...v) : Math.min(...v)) : null; };
  return `<section class="pkbox"><h3 class="fh">同業 PK<span class="note">${esc(me[2])}・月營收前 ${R.length} 大</span></h3><div class="cotbl-wrap"><table class="tbl excmp pktbl"><thead><tr><th></th>${R.map(r => `<th${r === me ? ' class="pkme"' : ""}><button class="linkbtn" data-sel="${esc(r[0])}">${esc(r[1])}</button></th>`).join("")}</tr></thead><tbody>
    ${F.map(f => { const b = best(f); return `<tr><td>${f[0]}</td>${R.map(r => { const v = f[1](r); return `<td class="${v != null && v === b ? "exbest" : ""}${r === me ? " pkme" : ""}">${f[2](v)}</td>`; }).join("")}</tr>`; }).join("")}</tbody></table></div>
    <p class="note">粗體是這一列最好的（本益比、股價淨值比越低越好）。三率、EPS 是最新一季，估值是最近交易日；不同產業標準差很多，同業比才有意義。</p></section>`;
}
// 估值地圖全螢幕（和動能矩陣的「⛶ 放大」一樣）：Esc 或再按一次縮小
$("#lx").addEventListener("click", e => { if (W.lt !== "earn" || !e.target.closest("[data-fxfull]")) return; W.fxFull = !W.fxFull; renderList(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && W.fxFull) { W.fxFull = false; renderList(); } });
