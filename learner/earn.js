/* ================= 情報局「財報」：台股（上市櫃月營收、季 EPS、獲利能力排行與產業比較）、美股（財報行事曆：實際 vs 預估） =================
   台股：/api/oapi?earn=1（證交所、櫃買中心開放資料合成一張表），每列 [代號, 名稱, 產業, 市場, 當月營收(億), 月增%, 年增%, 累計年增%, EPS, 季營收(億), 稅後淨利(億), 毛利率, 營益率, 淨利率]。
   美股：data/us-earn.json（排程每天兩次，scripts/us-earn.mjs），沒有檔案時問 /api/usearn；每列 [日期, 代號, 名稱, 市值(十億美元), 實際EPS, 預估EPS, 驚喜%, 時段, 財報季, 去年同期EPS]。
   月營收、EPS、獲利能力可以選產業看產業內排名（產業比較點產業也會切過去），全部排行的每家公司附「產業第幾名」。
   點公司展開營收、EPS 走勢圖（台股 /api/stockinfo、美股 /api/usinfo，用 watch.html 的 barLineSvg，有查價線）。
   行事曆、連續成長、三率轉折、我的持股、同業比較、小學堂、財報整體看法、美股財報週與營收驚喜在 earnx.js。
   用到 watch.html 的 W、esc、cls、getJ、store、renderList、barLineSvg、tmo，stockx.js 的 sxMd。 */
const ER_VIEWS = { tw: [["sum", "總覽"], ["cal", "行事曆"], ["rev", "月營收"], ["streak", "連續成長"], ["eps", "EPS"], ["pm", "獲利能力"], ["turn", "三率轉折"], ["ind", "產業比較"], ["my", "我的持股"], ["cmp", "同業比較"], ["learn", "小學堂"]],
  us: [["recent", "最近公布"], ["up", "即將公布"], ["week", "財報週"], ["beat", "優於預期"], ["miss", "低於預期"], ["rev", "營收驚喜"], ["learn", "小學堂"]] };
const ER_K = { c: 0, n: 1, i: 2, m: 3, rev: 4, mom: 5, yoy: 6, cum: 7, eps: 8, qrev: 9, ni: 10, gm: 11, om: 12, nm: 13 };
// 排行：[鍵, 標題, 欄位, 由大到小?, 說明]
const ER_RANKS = {
  rev: [["yoy", "年增最高", "yoy", 1, "當月營收和去年同月比"], ["yoyd", "年減最多", "yoy", 0, "當月營收比去年同月衰退最多"], ["mom", "月增最高", "mom", 1, "和上個月比"], ["cum", "累計年增最高", "cum", 1, "今年累計營收和去年同期比"], ["big", "營收最大", "rev", 1, "當月營收金額"]],
  eps: [["eps", "EPS 最高", "eps", 1, "本季基本每股盈餘（元）"], ["loss", "虧損", "eps", 0, "本季 EPS 為負"], ["ni", "淨利最大", "ni", 1, "本季稅後淨利（億）"]],
  pm: [["gm", "毛利率最高", "gm", 1, "營業毛利 ÷ 營業收入"], ["om", "營益率最高", "om", 1, "營業利益 ÷ 營業收入"], ["nm", "淨利率最高", "nm", 1, "稅後純益 ÷ 營業收入"]],
};
const ER = () => (W.er ||= { reg: "tw", view: "sum", usv: "recent", rk: {}, mk: "全部", min: true, big: true, ...(store.get("watch:er", null) || {}), ...(store.get("watch:erx", null) || {}), data: null, us: null, tr: {}, open: null });
const erSave = () => { const E = ER(); store.set("watch:er", { reg: E.reg, view: E.view, usv: E.usv, rk: E.rk, mk: E.mk, min: E.min, big: E.big, ind: E.ind || "" }); };
const erYm = s => (s && s.length >= 5 ? `${+s.slice(0, s.length - 2) + 1911} 年 ${+s.slice(-2)} 月` : "");
const erYq = s => { const m = String(s || "").match(/^(\d+)Q(\d)$/); return m ? `${+m[1] + 1911} 年第 ${m[2]} 季` : ""; };
async function erLoad(force = false) {
  const E = ER(); if (W.off || E.loading || (!force && E.data && Date.now() - E.data.at < 30 * 60e3)) return;
  E.loading = true; try { const j = await getJ("/api/oapi?earn=1"); E.data = { ...j, at: Date.now() }; } catch (e) { E.data = { err: e.message, at: Date.now() }; } finally { E.loading = false; }
  if (W.lt === "earn") renderList();
}
// 美股：先讀排程檔（一天半內的），太舊或沒有才即時問 API
async function erUsLoad(force = false) {
  const E = ER(); if (W.off || E.usLoading || (!force && E.us && Date.now() - E.us.got < 30 * 60e3)) return;
  E.usLoading = true;
  try { let j = null; try { const r = await fetch("data/us-earn.json", { cache: "no-cache", signal: tmo(15000) }); j = r.ok ? await r.json() : null; } catch {}
    if (!j?.ok || Date.now() - Date.parse(j.at) > 36 * 3600e3) j = await getJ("/api/usearn").catch(e => (j?.ok ? j : Promise.reject(e)));
    E.us = { ...j, got: Date.now() }; } catch (e) { E.us = { err: e.message, got: Date.now() }; } finally { E.usLoading = false; }
  if (W.lt === "earn") renderList();
}
const erPct = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`), erNum = (v, d = 2) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d }));
const erFmt = (k, v) => (["yoy", "mom", "cum"].includes(k) ? erPct(v) : ["gm", "om", "nm"].includes(k) ? (v == null ? "—" : v.toFixed(1) + "%") : k === "eps" ? erNum(v) : erNum(v, 1) + " 億");
// 走勢圖：點公司展開／收起；資料第一次點開時才抓
async function erTrLoad(c, us) {
  const E = ER(); if (E.tr[c] || W.off) return; E.tr[c] = { loading: true };
  try { E.tr[c] = us ? await getJ(`/api/usinfo?code=${encodeURIComponent(c)}`) : await getJ(`/api/stockinfo?code=${encodeURIComponent(c)}`); } catch (e) { E.tr[c] = { err: e.message }; }
  if (W.lt === "earn" && E.open === c) renderList();
}
function erTrend(c, us) {
  const E = ER(), J = E.tr[c]; if (!J) setTimeout(() => erTrLoad(c, us), 0);
  const go = `<button type="button" class="btn sm" data-sel="${esc(c)}">看個股 ›</button>`;
  if (!J || J.loading) return `<div class="ertr"><p class="note">載入營收、EPS 走勢…</p></div>`;
  if (J.err) return `<div class="ertr"><p class="note">⚠︎ ${esc(J.err)}</p>${go}</div>`;
  let h = "";
  if (us) { const Q = J.fin?.q || [], Ea = J.earn || [], mg = r => (r.rev && r.ni != null ? +((r.ni / r.rev) * 100).toFixed(1) : null);
    if (Q.length) h += `<h4>單季營收<span class="note">柱＝營收（十億美元）、線＝淨利率</span></h4>${barLineSvg(Q.slice(-12).map(r => ({ label: r.p.slice(2), v: r.rev != null ? +(r.rev / 1e9).toFixed(2) : 0, y: mg(r) })), { bar: "var(--s3)", fmtV: v => v + "B" })}`;
    if (Ea.length) h += `<h4>EPS 實際 vs 預估<span class="note">柱＝實際 EPS、線＝比預估高（低）多少 %</span></h4>${barLineSvg(Ea.map(x => ({ label: `${String(x.y).slice(2)}Q${x.q}`, v: x.actual ?? 0, y: x.surp })), { bar: "var(--s2)", fmtV: v => v })}`; }
  else { const R = J.revenue || [], F = J.fin || [];
    if (R.length) h += `<h4>月營收<span class="note">柱＝營收（億）、線＝年增率</span></h4>${barLineSvg(R.slice(-24).map(r => ({ label: r.ym.slice(2).replace("-", "/"), v: +(r.rev / 1e8).toFixed(1), y: r.yoy })), { bar: "var(--s3)", fmtV: v => v + "億" })}`;
    if (F.length) h += `<h4>季 EPS<span class="note">柱＝每季 EPS（元）、線＝毛利率</span></h4>${barLineSvg(F.slice(-12).map(r => ({ label: String(r.q).slice(2), v: r.eps, y: r.gross })), { fmtV: v => v, fmtY: v => v + "%" })}`; }
  return `<div class="ertr">${h || `<p class="note">這檔沒有營收或 EPS 歷史資料。</p>`}${typeof exCompany === "function" ? exCompany(c, us, J) : ""}${frEarn(c, us, J)}<div class="ertrf">${go}<span class="note">移上去（手指按著滑）看每期數字</span></div></div>`;
}
// 排行清單：每列名稱、長條、數值、附帶資訊；點了展開走勢圖
function erList(L, k, sub) {
  const mx = Math.max(...L.map(r => Math.abs(r[ER_K[k]] || 0)), 1e-9), E = ER();
  return `<ol class="erlist">${L.map((r, i) => { const v = r[ER_K[k]], op = E.open === r[0];
    return `<li${op ? ' class="on"' : ""}><button data-ertr="${esc(r[0])}" aria-expanded="${op}"><span class="rk">${i + 1}</span><span class="nm">${esc(r[1])}<small>${esc(r[0])}・${esc(r[2] || "")}${r[3] === "上櫃" ? "・櫃" : ""}</small></span><i class="${v < 0 ? "neg" : ""}" style="--w:${(Math.abs(v || 0) / mx * 100).toFixed(1)}%"></i><b class="${["yoy", "mom", "cum", "eps", "ni"].includes(k) ? cls(v) : ""}">${erFmt(k, v)}</b><small class="ersub"><span class="ercode">${esc(r[0])}・</span>${sub(r)}</small></button>${op ? erTrend(r[0], false) : ""}</li>`; }).join("")}</ol>`;
}
// 產業彙總：月營收年增（合計）、平均 EPS、平均毛利率
function erInd(rows) {
  const G = new Map(); for (const r of rows) { if (!r[2]) continue; const g = G.get(r[2]) || { n: r[2], k: 0, cur: 0, ly: 0, eps: [], gm: [] };
    if (r[4] != null && r[6] != null && r[6] > -100) { g.cur += r[4]; g.ly += r[4] / (1 + r[6] / 100); } if (r[8] != null) g.eps.push(r[8]); if (r[11] != null) g.gm.push(r[11]); g.k++; G.set(r[2], g); }
  const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return [...G.values()].filter(g => g.k >= 3 && g.ly > 0).map(g => ({ n: g.n, k: g.k, rev: g.cur, yoy: (g.cur / g.ly - 1) * 100, eps: avg(g.eps), gm: avg(g.gm) })).sort((a, b) => b.yoy - a.yoy);
}
function erIndBars(I) {
  const mx = Math.max(...I.map(g => Math.abs(g.yoy)), 1);
  return `<ul class="erind">${I.map(g => `<li data-erindset="${esc(g.n)}" role="button" tabindex="0"><span>${esc(g.n)}<small>${g.k} 家</small></span><i class="${g.yoy < 0 ? "neg" : ""}" style="--w:${(Math.abs(g.yoy) / mx * 100).toFixed(1)}%"></i><b class="${cls(g.yoy)}">${erPct(g.yoy)}</b><small class="ersub">營收 ${erNum(g.rev, 0)} 億・平均 EPS ${erNum(g.eps)}・毛利率 ${g.gm == null ? "—" : g.gm.toFixed(1) + "%"}</small></li>`).join("")}</ul>`;
}
// 查一檔的走勢（不在排行裡的公司也能看）
const erLookup = us => { const E = ER(), c = E.look?.[us ? "us" : "tw"];
  return `<section class="mk erlook"><h3>查一檔的營收、EPS 走勢</h3><form class="oaq" data-erlook="${us ? "us" : "tw"}"><input name="c" placeholder="${us ? "美股代號（例 NVDA）" : "股票代號（例 2330）"}" value="${esc(c || "")}" aria-label="股票代號" autocapitalize="characters"><button class="btn sm primary">看走勢</button></form>${c ? erTrend(c, us) : ""}</section>`; };
function renderEarnUs(E) {
  const U = E.us; if (!U || (!E.usLoading && Date.now() - U.got > 30 * 60e3)) setTimeout(erUsLoad, 0);
  if (!U || U.err) return `<p class="note gnote">${U?.err ? "⚠︎ " + esc(U.err) : "抓美股財報行事曆…"}</p>`;
  const today = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), big = r => !E.big || r[3] >= 100, md = d => d.slice(5).replace("-", "/");
  const past = U.rows.filter(r => r[4] != null && big(r)), next = U.rows.filter(r => r[4] == null && r[0] >= today && big(r));
  const V = E.usv, L = V === "up" ? next.slice().sort((a, b) => a[0].localeCompare(b[0]) || b[3] - a[3]) : V === "beat" ? past.filter(r => r[6] != null).sort((a, b) => b[6] - a[6]) : V === "miss" ? past.filter(r => r[6] != null).sort((a, b) => a[6] - b[6]) : past.slice().sort((a, b) => b[0].localeCompare(a[0]) || b[3] - a[3]);
  const mx = Math.max(...L.map(r => Math.abs(r[6] || 0)), 1);
  const row = (r, i) => { const op = E.open === r[1], up = V === "up";
    return `<li${op ? ' class="on"' : ""}><button data-ertr="${esc(r[1])}" data-erus="1" aria-expanded="${op}"><span class="rk">${i + 1}</span><span class="nm">${esc(r[2])}<small>${esc(r[1])}</small></span>${up ? `<i style="--w:0%"></i><b>${md(r[0])}</b>` : `<i class="${r[6] < 0 ? "neg" : ""}" style="--w:${Math.min(100, Math.abs(r[6] || 0) / mx * 100).toFixed(1)}%"></i><b class="${cls(r[6])}">${r[6] == null ? "—" : erPct(r[6])}</b>`}
      <small class="ersub"><span class="ercode">${esc(r[1])}・</span>${up ? `${r[7] || "時間未定"}・預估 EPS ${erNum(r[5])}${r[9] != null ? `・去年同期 ${erNum(r[9])}` : ""}` : `${md(r[0])} ${r[7]}・實際 ${erNum(r[4])} vs 預估 ${erNum(r[5])}${r[6] == null ? "（驚喜% 待確認）" : ""}`}・市值 ${erNum(r[3] * 10, 0)} 億美元</small></button>${op ? erTrend(r[1], true) : ""}</li>`; };
  const beat = past.filter(r => r[6] != null && r[6] > 0).length, withS = past.filter(r => r[6] != null).length;
  return `<p class="note gnote">${esc(U.source || "")}・${md(U.from)}～${md(U.to)}・${new Date(Date.parse(U.at) + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ").replace("-", "/")} 更新</p>
    <div class="erbar"><label class="erchk"><input type="checkbox" data-erbig ${E.big ? "checked" : ""}> 只看市值 1,000 億美元以上</label></div>
    ${exOverallUs(past)}<section class="mk"><h3>重點</h3><div class="d-kv sxkv"><div><span>已公布</span><b>${past.length} 家</b></div><div><span>優於預期</span><b class="up">${withS ? Math.round(beat / withS * 100) : "—"}%</b></div><div><span>未來兩週公布</span><b>${next.length} 家</b></div></div>
      <p class="note">EPS 優於預期（驚喜）的比例常被拿來看整體財報季的好壞；個股財報公布後，股價反應多半看「和預估比」與財測，而不是數字本身。</p></section>
    ${V === "week" ? exWeek(E, U) : V === "rev" ? exUsRev(E, U, past) : V === "learn" ? exLearn() : `<section class="mk"><h3>${ER_VIEWS.us.find(x => x[0] === V)?.[1] || ""}<span class="note">${L.length} 家・點公司看營收、EPS 走勢</span></h3>${L.length ? `<ol class="erlist">${L.slice(0, 80).map(row).join("")}</ol>` : `<p class="note">沒有符合的公司</p>`}</section>`}${erLookup(true)}`;
}
function renderEarn() {
  const E = ER(), us = E.reg === "us";
  $("#lTools").innerHTML = `<div class="seg" role="group" aria-label="台股或美股">${[["tw", "台股"], ["us", "美股"]].map(([k, t]) => `<button data-erreg="${k}" aria-pressed="${E.reg === k}">${t}</button>`).join("")}</div>
    <div class="seg" role="group" aria-label="財報">${ER_VIEWS[E.reg].map(([k, t]) => `<button data-erv="${k}" aria-pressed="${(us ? E.usv : E.view) === k}">${t}</button>`).join("")}</div>`;
  const box = $("#lx"), foot = us ? "美股財報行事曆來自 Nasdaq（每天整理兩次），走勢來自 SEC 財報與 Finnhub；只整理公開數字，不構成投資建議。" : "月營收、EPS、營益分析來自證交所與櫃買中心開放資料（公開資訊觀測站彙整），每天更新；點公司看營收、EPS 走勢。只整理公開數字，不構成投資建議。";
  if (W.off) { box.innerHTML = `<p class="note gnote">需要部署到網站才有財報資料。</p>`; return ""; }
  if (us) { box.innerHTML = `<div class="earn us">${renderEarnUs(E)}<p class="note" style="padding:4px 12px 12px">${foot}</p></div>`; return ""; }
  const D = E.data; if (!D || (!D.loading && Date.now() - D.at > 30 * 60e3)) setTimeout(erLoad, 0);
  if (!D || D.err) { box.innerHTML = `<p class="note gnote">${D?.err ? "⚠︎ " + esc(D.err) : "向證交所、櫃買中心抓最新月營收與財報…"}</p>`; return ""; }
  const mk = E.mk, all = D.rows.filter(r => mk === "全部" || r[3] === mk), big = r => !E.min || (r[4] ?? 0) >= 1 || (r[9] ?? 0) >= 3; // 排除營收很小的公司（基期小，年增率容易失真）
  const seg = `<div class="erbar"><span class="mkseg">${["全部", "上市", "上櫃"].map(k => `<button data-ermk="${k}" aria-pressed="${mk === k}">${k}</button>`).join("")}</span>
    <label class="erchk"><input type="checkbox" data-ermin ${E.min ? "checked" : ""}> 排除小型公司（月營收 1 億以下）</label></div>`;
  const head = `<p class="note gnote">最新月營收：${erYm(D.ym)}・最新季報：${erYq(D.yq)}・${esc(D.source || "")}</p>`;
  let h = head + seg;
  // 排行：先算全部公司的排序，記下每家在自己產業裡第幾名；選了產業就只列那個產業（全部列出）
  const rank = (grp, key, ind = "") => { const R = ER_RANKS[grp].find(x => x[0] === key) || ER_RANKS[grp][0], [, , f, desc] = R, k = ER_K[f];
    let L = all.filter(r => r[k] != null && big(r)); if (R[0] === "loss") L = L.filter(r => r[k] < 0); if (R[0] === "yoyd") L = L.filter(r => r[k] < 0);
    L.sort((a, b) => (desc ? b[k] - a[k] : a[k] - b[k])); const ir = new Map(), cnt = new Map(); for (const r of L) { const n = (cnt.get(r[2]) || 0) + 1; cnt.set(r[2], n); ir.set(r[0], [n, 0]); } for (const r of L) ir.get(r[0])[1] = cnt.get(r[2]);
    return { R, ir, L: ind ? L.filter(r => r[2] === ind) : L.slice(0, 50) }; };
  const inds = [...all.reduce((m, r) => (r[2] ? m.set(r[2], (m.get(r[2]) || 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1]), ind = inds.some(x => x[0] === E.ind) ? E.ind : "";
  const indSel = `<label class="erind-sel"><span class="note">產業</span><select data-erind aria-label="選產業排名"><option value="">全部產業</option>${inds.map(([n, c]) => `<option value="${esc(n)}" ${n === ind ? "selected" : ""}>${esc(n)}（${c}）</option>`).join("")}</select></label>`;
  const withIr = (sub, ir) => r => { const x = ir.get(r[0]); return `${x && !ind && r[2] ? `${esc(r[2])}第 ${x[0]}／${x[1]}・` : ""}${sub(r)}`; };
  const tabs = (grp, cur) => `<div class="ichips erchips">${ER_RANKS[grp].map(([k, t]) => `<button class="ichip" data-errk="${grp}:${k}" aria-pressed="${cur === k}">${t}</button>`).join("")}</div>`;
  const subRev = r => `營收 ${erNum(r[4], 1)} 億・年增 ${erPct(r[6])}・月增 ${erPct(r[5])}`, subEps = r => `EPS ${erNum(r[8])}・淨利 ${erNum(r[10], 1)} 億・毛利率 ${r[11] == null ? "—" : r[11] + "%"}`, subPm = r => `毛利率 ${r[11] ?? "—"}%・營益率 ${r[12] ?? "—"}%・淨利率 ${r[13] ?? "—"}%`;
  if (E.view === "sum") {
    const withY = all.filter(r => r[6] != null && big(r)), up = withY.filter(r => r[6] > 0).length, epsN = all.filter(r => r[8] != null), loss = epsN.filter(r => r[8] < 0).length, I = erInd(all);
    const t = (grp, key, n) => { const { R, L } = rank(grp, key); return `<section class="mk"><h3>${R[1]}<span class="note">${R[4]}</span><button class="linkbtn" data-errk="${grp}:${key}" data-ergo="${grp}">看前 50 名 ›</button></h3>${erList(L.slice(0, n), R[2], grp === "rev" ? subRev : grp === "eps" ? subEps : subPm)}</section>`; };
    h += exOverallTw(D, all, big) + `<section class="mk"><h3>重點<span class="note">產業以月營收年增排序</span></h3><div class="d-kv sxkv"><div><span>營收年增家數</span><b class="up">${withY.length ? Math.round(up / withY.length * 100) : "—"}%</b></div><div><span>年增≥30%</span><b>${withY.filter(r => r[6] >= 30).length} 家</b></div>
      <div><span>本季虧損</span><b class="down">${loss} 家</b></div><div><span>最強產業</span><b>${esc(I[0]?.n || "—")}</b></div><div><span>最弱產業</span><b>${esc(I.at(-1)?.n || "—")}</b></div></div>
      <p class="note">月營收每月 10 號前公布、季報在季後 45 天內（第 4 季與年報在隔年 3 月底前）；月營收年增連續成長、EPS 創新高的公司常是法人追蹤的重點。點公司可以展開營收、EPS 走勢圖。</p></section>`
      + erLookup(false) + t("rev", "yoy", 10) + t("eps", "eps", 10) + t("pm", "gm", 10)
      + `<section class="mk"><h3>產業營收年增<span class="note">各產業當月營收合計和去年同月比</span><button class="linkbtn" data-ergo="ind">看全部產業 ›</button></h3>${erIndBars(I.slice(0, 8))}</section>`;
  } else if (EX_TW_VIEWS[E.view]) {
    const ok = new Set(all.filter(big).map(r => r[0])); h += EX_TW_VIEWS[E.view](E, D, r => ok.has(r[0]));
  } else if (E.view === "ind") {
    h += `<section class="mk"><h3>產業比較<span class="note">各產業當月營收合計年增率；點產業看產業內排名</span></h3>${erIndBars(erInd(all))}</section>`;
  } else {
    const grp = E.view, key = E.rk[grp] || ER_RANKS[grp][0][0], { R, L, ir } = rank(grp, key, ind);
    h += `<div class="erbar">${tabs(grp, key)}${indSel}</div><section class="mk"><h3>${ind ? `${esc(ind)}・` : ""}${R[1]}<span class="note">${R[4]}・${ind ? `產業內 ${L.length} 家` : `前 ${L.length} 名`}</span>${ind ? `<button class="linkbtn" data-erindset="">看全部產業 ›</button>` : ""}</h3>${L.length ? erList(L, R[2], withIr(grp === "rev" ? subRev : grp === "eps" ? subEps : subPm, ir)) : `<p class="note">沒有符合的公司</p>`}</section>`;
  }
  box.innerHTML = `<div class="earn tw">${h}<p class="note" style="padding:4px 12px 12px">${foot}</p></div>`;
  return "";
}
$("#lx").addEventListener("click", e => { if (W.lt !== "earn") return; const E = ER();
  const tr = e.target.closest("[data-ertr]"); if (tr) { E.open = E.open === tr.dataset.ertr ? null : tr.dataset.ertr; return renderList(); }
  const s = e.target.closest("[data-erindset]"); if (s) { E.ind = s.dataset.erindset; if (E.ind && !["rev", "eps", "pm"].includes(E.view)) E.view = "rev"; erSave(); renderList(); return goY(0); }
  const b = e.target.closest("[data-errk],[data-ermk],[data-ergo]"); if (!b) return; const d = b.dataset;
  if (d.errk) { const [g, k] = d.errk.split(":"); E.rk[g] = k; } if (d.ergo) E.view = d.ergo; if (d.ermk) E.mk = d.ermk; erSave(); renderList(); });
$("#lx").addEventListener("change", e => { if (W.lt !== "earn") return; if (e.target.matches("[data-erind]")) ER().ind = e.target.value; else if (e.target.matches("[data-ermin]")) ER().min = e.target.checked; else if (e.target.matches("[data-erbig]")) ER().big = e.target.checked; else return; erSave(); renderList(); });
$("#lx").addEventListener("submit", e => { const f = e.target.closest?.("[data-erlook]"); if (!f || W.lt !== "earn") return; e.preventDefault(); const E = ER(), c = String(f.c.value || "").trim().toUpperCase(); if (!c) return; (E.look ||= {})[f.dataset.erlook] = c; delete E.tr[c]; renderList(); });
$("#lTools").addEventListener("click", e => { if (W.lt !== "earn") return; const E = ER(), b = e.target.closest("[data-erv],[data-erreg]"); if (!b) return;
  if (b.dataset.erreg) E.reg = b.dataset.erreg; else if (E.reg === "us") E.usv = b.dataset.erv; else E.view = b.dataset.erv; E.open = null; erSave(); renderList(); });
