/* ================= 情報局「財報」：上市櫃月營收、季 EPS、獲利能力排行與產業比較 =================
   資料：/api/oapi?earn=1（證交所、櫃買中心開放資料合成一張表），每列 [代號, 名稱, 產業, 市場, 當月營收(億), 月增%, 年增%, 累計年增%, EPS, 季營收(億), 稅後淨利(億), 毛利率, 營益率, 淨利率]。
   用到 watch.html 的 W、esc、cls、getJ、store、renderList、xhWrap（tschart.js）。 */
const ER_VIEWS = [["sum", "總覽"], ["rev", "月營收"], ["eps", "EPS"], ["pm", "獲利能力"], ["ind", "產業比較"]];
const ER_K = { c: 0, n: 1, i: 2, m: 3, rev: 4, mom: 5, yoy: 6, cum: 7, eps: 8, qrev: 9, ni: 10, gm: 11, om: 12, nm: 13 };
// 排行：[鍵, 標題, 欄位, 由大到小?, 說明]
const ER_RANKS = {
  rev: [["yoy", "年增最高", "yoy", 1, "當月營收和去年同月比"], ["yoyd", "年減最多", "yoy", 0, "當月營收比去年同月衰退最多"], ["mom", "月增最高", "mom", 1, "和上個月比"], ["cum", "累計年增最高", "cum", 1, "今年累計營收和去年同期比"], ["big", "營收最大", "rev", 1, "當月營收金額"]],
  eps: [["eps", "EPS 最高", "eps", 1, "本季基本每股盈餘（元）"], ["loss", "虧損", "eps", 0, "本季 EPS 為負"], ["ni", "淨利最大", "ni", 1, "本季稅後淨利（億）"]],
  pm: [["gm", "毛利率最高", "gm", 1, "營業毛利 ÷ 營業收入"], ["om", "營益率最高", "om", 1, "營業利益 ÷ 營業收入"], ["nm", "淨利率最高", "nm", 1, "稅後純益 ÷ 營業收入"]],
};
const ER = () => (W.er ||= { view: "sum", rk: {}, mk: "全部", min: true, ...(store.get("watch:er", null) || {}), data: null });
const erSave = () => { const E = ER(); store.set("watch:er", { view: E.view, rk: E.rk, mk: E.mk, min: E.min }); };
const erYm = s => (s && s.length >= 5 ? `${+s.slice(0, s.length - 2) + 1911} 年 ${+s.slice(-2)} 月` : "");
const erYq = s => { const m = String(s || "").match(/^(\d+)Q(\d)$/); return m ? `${+m[1] + 1911} 年第 ${m[2]} 季` : ""; };
async function erLoad(force = false) {
  const E = ER(); if (W.off || E.loading || (!force && E.data && Date.now() - E.data.at < 30 * 60e3)) return;
  E.loading = true; try { const j = await getJ("/api/oapi?earn=1"); E.data = { ...j, at: Date.now() }; } catch (e) { E.data = { err: e.message, at: Date.now() }; } finally { E.loading = false; }
  if (W.lt === "earn") renderList();
}
const erPct = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`), erNum = (v, d = 2) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d }));
const erFmt = (k, v) => (["yoy", "mom", "cum"].includes(k) ? erPct(v) : ["gm", "om", "nm"].includes(k) ? (v == null ? "—" : v.toFixed(1) + "%") : k === "eps" ? erNum(v) : erNum(v, 1) + " 億");
// 排行清單：每列名稱（點了看個股）、長條、數值、附帶資訊
function erList(L, k, sub) {
  const mx = Math.max(...L.map(r => Math.abs(r[ER_K[k]] || 0)), 1e-9);
  return `<ol class="erlist">${L.map((r, i) => { const v = r[ER_K[k]];
    return `<li><button data-sel="${esc(r[0])}"><span class="rk">${i + 1}</span><span class="nm">${esc(r[1])}<small>${esc(r[0])}・${esc(r[2] || "")}${r[3] === "上櫃" ? "・櫃" : ""}</small></span><i class="${v < 0 ? "neg" : ""}" style="--w:${(Math.abs(v || 0) / mx * 100).toFixed(1)}%"></i><b class="${["yoy", "mom", "cum", "eps", "ni"].includes(k) ? cls(v) : ""}">${erFmt(k, v)}</b><small class="ersub"><span class="ercode">${esc(r[0])}・</span>${sub(r)}</small></button></li>`; }).join("")}</ol>`;
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
  return `<ul class="erind">${I.map(g => `<li><span>${esc(g.n)}<small>${g.k} 家</small></span><i class="${g.yoy < 0 ? "neg" : ""}" style="--w:${(Math.abs(g.yoy) / mx * 100).toFixed(1)}%"></i><b class="${cls(g.yoy)}">${erPct(g.yoy)}</b><small class="ersub">營收 ${erNum(g.rev, 0)} 億・平均 EPS ${erNum(g.eps)}・毛利率 ${g.gm == null ? "—" : g.gm.toFixed(1) + "%"}</small></li>`).join("")}</ul>`;
}
function renderEarn() {
  const E = ER(), D = E.data; if (!D || (!D.loading && Date.now() - D.at > 30 * 60e3)) setTimeout(erLoad, 0);
  $("#lTools").innerHTML = `<div class="seg" role="group" aria-label="財報">${ER_VIEWS.map(([k, t]) => `<button data-erv="${k}" aria-pressed="${E.view === k}">${t}</button>`).join("")}</div>`;
  const box = $("#lx");
  if (W.off) { box.innerHTML = `<p class="note gnote">需要部署到網站才有財報資料。</p>`; return ""; }
  if (!D || D.err) { box.innerHTML = `<p class="note gnote">${D?.err ? "⚠ " + esc(D.err) : "向證交所、櫃買中心抓最新月營收與財報…"}</p>`; return ""; }
  const mk = E.mk, all = D.rows.filter(r => mk === "全部" || r[3] === mk), big = r => !E.min || (r[4] ?? 0) >= 1 || (r[9] ?? 0) >= 3; // 排除營收很小的公司（基期小，年增率容易失真）
  const seg = `<div class="erbar"><span class="mkseg">${["全部", "上市", "上櫃"].map(k => `<button data-ermk="${k}" aria-pressed="${mk === k}">${k}</button>`).join("")}</span>
    <label class="erchk"><input type="checkbox" data-ermin ${E.min ? "checked" : ""}> 排除小型公司（月營收 1 億以下）</label></div>`;
  const head = `<p class="note gnote">最新月營收：${erYm(D.ym)}・最新季報：${erYq(D.yq)}・${esc(D.source || "")}</p>`;
  let h = head + seg;
  const rank = (grp, key) => { const R = ER_RANKS[grp].find(x => x[0] === key) || ER_RANKS[grp][0], [, , f, desc] = R, k = ER_K[f];
    let L = all.filter(r => r[k] != null && big(r)); if (R[0] === "loss") L = L.filter(r => r[k] < 0); if (R[0] === "yoyd") L = L.filter(r => r[k] < 0);
    return { R, L: L.sort((a, b) => (desc ? b[k] - a[k] : a[k] - b[k])).slice(0, 50) }; };
  const tabs = (grp, cur) => `<div class="ichips erchips">${ER_RANKS[grp].map(([k, t]) => `<button class="ichip" data-errk="${grp}:${k}" aria-pressed="${cur === k}">${t}</button>`).join("")}</div>`;
  const subRev = r => `營收 ${erNum(r[4], 1)} 億・年增 ${erPct(r[6])}・月增 ${erPct(r[5])}`, subEps = r => `EPS ${erNum(r[8])}・淨利 ${erNum(r[10], 1)} 億・毛利率 ${r[11] == null ? "—" : r[11] + "%"}`, subPm = r => `毛利率 ${r[11] ?? "—"}%・營益率 ${r[12] ?? "—"}%・淨利率 ${r[13] ?? "—"}%`;
  if (E.view === "sum") {
    const withY = all.filter(r => r[6] != null && big(r)), up = withY.filter(r => r[6] > 0).length, epsN = all.filter(r => r[8] != null), loss = epsN.filter(r => r[8] < 0).length, I = erInd(all);
    const t = (grp, key, n) => { const { R, L } = rank(grp, key); return `<section class="mk"><h3>${R[1]}<span class="note">${R[4]}</span><button class="linkbtn" data-errk="${grp}:${key}" data-ergo="${grp}">看前 50 名 ›</button></h3>${erList(L.slice(0, n), R[2], grp === "rev" ? subRev : grp === "eps" ? subEps : subPm)}</section>`; };
    h += `<section class="mk"><h3>重點<span class="note">產業以月營收年增排序</span></h3><div class="d-kv sxkv"><div><span>營收年增家數</span><b class="up">${withY.length ? Math.round(up / withY.length * 100) : "—"}%</b></div><div><span>年增≥30%</span><b>${withY.filter(r => r[6] >= 30).length} 家</b></div>
      <div><span>本季虧損</span><b class="down">${loss} 家</b></div><div><span>最強產業</span><b>${esc(I[0]?.n || "—")}</b></div><div><span>最弱產業</span><b>${esc(I.at(-1)?.n || "—")}</b></div></div>
      <p class="note">月營收每月 10 號前公布、季報在季後 45 天內（第 4 季與年報在隔年 3 月底前）；月營收年增連續成長、EPS 創新高的公司常是法人追蹤的重點。</p></section>`
      + t("rev", "yoy", 10) + t("eps", "eps", 10) + t("pm", "gm", 10)
      + `<section class="mk"><h3>產業營收年增<span class="note">各產業當月營收合計和去年同月比</span><button class="linkbtn" data-ergo="ind">看全部產業 ›</button></h3>${erIndBars(I.slice(0, 8))}</section>`;
  } else if (E.view === "ind") {
    h += `<section class="mk"><h3>產業比較<span class="note">各產業當月營收合計年增率；下面是平均 EPS 與平均毛利率</span></h3>${erIndBars(erInd(all))}</section>`;
  } else {
    const grp = E.view, key = E.rk[grp] || ER_RANKS[grp][0][0], { R, L } = rank(grp, key);
    h += tabs(grp, key) + `<section class="mk"><h3>${R[1]}<span class="note">${R[4]}・前 ${L.length} 名</span></h3>${L.length ? erList(L, R[2], grp === "rev" ? subRev : grp === "eps" ? subEps : subPm) : `<p class="note">沒有符合的公司</p>`}</section>`;
  }
  box.innerHTML = `<div class="earn">${h}<p class="note" style="padding:4px 12px 12px">月營收、EPS、營益分析來自證交所與櫃買中心開放資料（公開資訊觀測站彙整），每天更新；點公司看個股。只整理公開數字，不構成投資建議。</p></div>`;
  return "";
}
$("#lx").addEventListener("click", e => { if (W.lt !== "earn") return; const b = e.target.closest("[data-errk],[data-ermk],[data-ergo]"); if (!b) return; const E = ER(), d = b.dataset;
  if (d.errk) { const [g, k] = d.errk.split(":"); E.rk[g] = k; } if (d.ergo) E.view = d.ergo; if (d.ermk) E.mk = d.ermk; erSave(); renderList(); });
$("#lx").addEventListener("change", e => { if (W.lt === "earn" && e.target.matches("[data-ermin]")) { ER().min = e.target.checked; erSave(); renderList(); } });
$("#lTools").addEventListener("click", e => { if (W.lt !== "earn") return; const b = e.target.closest("[data-erv]"); if (!b) return; ER().view = b.dataset.erv; erSave(); renderList(); });
