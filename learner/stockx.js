/* 個股「資訊」分頁：多空、達人觀點、籌碼日報、健檢、屬性、法人目標、法人主力、新聞、產業鏈、資券大戶、籌碼分佈、營收、獲利、財報、
   基金持股、除權息、行事曆、股東名單、個股資訊。
   資料都來自已有的 API：/api/stockinfo（W.info：法人、融資券、借券、本益比、營收、季 EPS）、/api/company（W.co：損益、資產負債、現金流、股利、
   股權分散、外資持股、公司資料）、/api/news（W.news）、日 K（W.daily）、名人 Podcast（POD）、產業地圖（IND）。
   免費資料源沒有的（券商目標價、基金持股明細、前十大股東）會清楚標示「估算」或告訴你去哪裡查，不會編數字。
   用到 watch.html 的 W、esc、cls、select、setDtab、loadInfo、loadCo、loadNews、barLineSvg、peBand、IND、indCodes、indChainData，
   analysis.js 的 signed、clsOf，core.js 的 indicators、$、store。 */
const SX_ITEMS = [["ls", "多空"], ["guru", "達人觀點"], ["daily", "籌碼日報"], ["check", "健檢"], ["attr", "屬性"], ["target", "法人目標"], ["inst", "法人主力"], ["branch", "分點主力"], ["news", "新聞"], ["chain", "產業鏈"], ["mb", "資券大戶"],
  ["dist", "籌碼分佈"], ["rev", "營收"], ["profit", "獲利"], ["fin", "財報"], ["fund", "基金持股"], ["div", "除權息"], ["cal", "行事曆"], ["holders", "股東名單"], ["info", "個股資訊"]];
// W 在 watch.html 後面的 script 才定義，所以選到哪一頁在第一次用到時再讀
const sxCur = () => (W.sx ||= SX_ITEMS.some(x => x[0] === store.get("watch:sx", "ls")) ? store.get("watch:sx", "ls") : "ls");
const sxN = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const sxPct = (v, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const sxYi = v => (v == null ? "—" : Math.abs(v) >= 1e8 ? (v / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " 億" : Math.round(v / 1e4).toLocaleString() + " 萬");
const sxSum = (a, k, n) => a.slice(-n).reduce((s, x) => s + (x[k] || 0), 0);
const sxMd = d => (d ? String(d).slice(5).replace("-", "/") : "");
const sxH = (t, sub = "") => `<h3 class="sxh">${t}${sub ? `<span class="note">${sub}</span>` : ""}</h3>`;
const sxKv = rows => `<div class="d-kv sxkv">${rows.filter(Boolean).map(([k, v, c = ""]) => `<div><span>${k}</span><b class="${c}">${v}</b></div>`).join("")}</div>`;
const sxLoad = msg => `<p class="note sxwait">${msg || (W.off ? "需要部署到網站才有資料。" : "載入中…")}</p>`;

function sxOpen() {
  const c = W.sel; if (!c) return;
  if (isTW(c) && W.info && W.info.code !== c) loadInfo(); // 正常情況 select 時已經在載入
  if (isTW(c) && W.co?.code !== c) loadCo();
  sxRender();
}
// 需要的資料：沒有就去載入
function sxNeed(what) {
  const c = W.sel;
  if (what === "news" && W.news?.code !== c) loadNews();
  if (what === "branch" && W.br?.code !== c) sxLoadBr();
  if (what === "guru" && typeof podLoadSrv === "function" && !POD.srv && !POD.srvLoading) { POD.srvLoading = true; podLoadSrv().then(() => { POD.srvLoading = false; podLoadPx(); if (W.dtab === "info") sxRender(); }); }
}
// 券商分點（/api/broker，要 FinMind 贊助會員）
async function sxLoadBr() {
  const c = W.sel; if (W.off) return;
  W.br = { code: c, loading: true };
  // 不用 getJ：ok:false 時還要讀 needSponsor
  try { const r = await fetch(`/api/broker?code=${c}`), j = await r.json().catch(() => null); if (W.sel !== c) return; W.br = j ? { ...j, code: c } : { code: c, err: r.status === 404 ? "這個環境沒有資料服務，部署到網站後才能用" : `服務回應 ${r.status}` }; }
  catch { if (W.sel === c) W.br = { code: c, err: "連不到伺服器（網路中斷？）" }; }
  if (W.sel === c && W.dtab === "info") sxRender();
}
function sxRender() {
  const box = $("#sxBox"); if (!box || W.dtab !== "info") return; sxCur();
  $("#sxNav").innerHTML = SX_ITEMS.map(([k, t]) => `<button data-sx="${k}" aria-pressed="${W.sx === k}">${t}</button>`).join("");
  const nav = $("#sxNav").querySelector('[aria-pressed="true"]'); if (nav && !sxRender.scrolled) { nav.scrollIntoView({ block: "nearest", inline: "center" }); sxRender.scrolled = true; }
  sxNeed(W.sx);
  let h = ""; try { h = SX[W.sx]() || ""; } catch (e) { console.error("stockx", W.sx, e); h = `<p class="note err">這一頁出錯了（${esc(e.message)}）</p>`; }
  box.innerHTML = h; postHeight();
}
const sxD = () => (W.daily?.data || []), sxI = () => (W.info && !W.info.err ? W.info : null), sxC = () => (W.co?.code === W.sel && !W.co.loading && !W.co.err ? W.co : null);
const sxPx = () => (W.detailQ || W.quotes.get(W.sel))?.price ?? sxD().at(-1)?.c ?? null;
// 近四季 EPS：stockinfo 的季資料不夠時，改用公司損益表的 EPS
const sxEps4 = I => { for (const f of [(I?.fin || []).slice(-4), (sxC()?.income || []).slice(-4)]) if (f.length === 4 && f.every(x => x.eps != null)) return +f.reduce((s, x) => s + x.eps, 0).toFixed(2); return null; };

// ---------- 多空：技術、籌碼、量價各給 +1／−1 ----------
function sxSignals() {
  const D = sxD(), I = sxI(); if (D.length < 30) return null;
  const ind = indicators(D), n = D.length - 1, c = D[n].c, m20 = ind.ma(20), m60 = ind.ma(60), out = [];
  const add = (k, v, t) => out.push({ k, v, t });
  if (m20[n] != null) add("月線", c > m20[n] ? 1 : -1, `收盤 ${sxN(c, 2)} ${c > m20[n] ? "站上" : "跌破"} 20 日均線 ${sxN(m20[n], 2)}`);
  if (m60[n] != null) add("季線", c > m60[n] ? 1 : -1, `${c > m60[n] ? "在" : "在"} 60 日均線 ${sxN(m60[n], 2)} ${c > m60[n] ? "之上" : "之下"}`);
  if (m20[n] != null && m20[n - 5] != null) add("均線方向", m20[n] > m20[n - 5] ? 1 : -1, `20 日均線${m20[n] > m20[n - 5] ? "上揚" : "下彎"}`);
  const K = ind.kd.K[n], Dk = ind.kd.D[n]; if (K != null) add("KD", K > Dk ? 1 : -1, `K ${K.toFixed(0)} ${K > Dk ? ">" : "<"} D ${Dk.toFixed(0)}${K > 80 ? "（高檔）" : K < 20 ? "（低檔）" : ""}`);
  const osc = ind.macd.osc[n]; if (osc != null) add("MACD", osc > 0 ? 1 : -1, `柱狀體${osc > 0 ? "翻紅" : "翻綠"}（${osc.toFixed(2)}）`);
  const vm = ind.vma[n], ch = c - D[n - 1].c; if (vm) add("量價", D[n].v > vm * 1.2 ? (ch >= 0 ? 1 : -1) : 0, `成交量 ${D[n].v > vm * 1.2 ? "放大" : "一般"}（20 日均量 ${sxN(vm)}），${ch >= 0 ? "收漲" : "收跌"}`);
  if (I?.inst?.length) { const s = sxSum(I.inst, "foreign", 5) + sxSum(I.inst, "trust", 5) + sxSum(I.inst, "dealer", 5); add("法人 5 日", s > 0 ? 1 : s < 0 ? -1 : 0, `三大法人 5 日合計 ${signed(s)} 張`); }
  if (I?.margin?.length > 5) { const M = I.margin, d = M.at(-1).marginBal - M.at(-6).marginBal, p = c - D[Math.max(0, n - 5)].c; add("融資", d > 0 && p < 0 ? -1 : d < 0 && p > 0 ? 1 : 0, `融資 5 日 ${signed(d)} 張${d > 0 && p < 0 ? "，股價跌融資增（籌碼凌亂）" : d < 0 && p > 0 ? "，股價漲融資減（籌碼安定）" : ""}`); }
  const score = Math.round((out.reduce((s, x) => s + x.v, 0) / (out.length || 1)) * 100);
  return { out, score, label: score >= 40 ? "偏多" : score >= 15 ? "略偏多" : score <= -40 ? "偏空" : score <= -15 ? "略偏空" : "盤整" };
}
// 分點主力：柱＝每日前 15 大買賣超合計（張，左軸），線＝5 日、20 日集中度（%，右軸）
function sxBrChart(D) {
  if (D.length < 2) return "";
  const Wv = 400, Hv = 190, L = 44, R = 32, T = 10, B = 22, n = D.length, cw = (Wv - L - R) / n;
  const nv = D.map(x => x.net), mx = Math.max(0, ...nv), mn = Math.min(0, ...nv), Yb = v => T + (mx - v) / ((mx - mn) || 1) * (Hv - T - B);
  const lv = D.flatMap(x => [x.c5, x.c20]).filter(v => v != null), lx = Math.max(0, ...lv), ln = Math.min(0, ...lv), Yl = v => T + (lx - v) / ((lx - ln) || 1) * (Hv - T - B);
  let g = `<line x1="${L}" x2="${Wv - R}" y1="${Yb(0).toFixed(1)}" y2="${Yb(0).toFixed(1)}" stroke="var(--line)"/>`;
  g += [mx, mn].filter(v => v).map(v => `<text x="${L - 4}" y="${Yb(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--muted)">${sxN(v)}</text>`).join("");
  g += [lx, ln].filter(v => v).map(v => `<text x="${Wv - R + 4}" y="${Yl(v).toFixed(1)}" dominant-baseline="middle" font-size="11" fill="var(--muted)">${v.toFixed(0)}%</text>`).join("");
  g += D.map((x, i) => `<rect x="${(L + i * cw + cw * 0.15).toFixed(1)}" y="${Math.min(Yb(x.net), Yb(0)).toFixed(1)}" width="${(cw * 0.7).toFixed(1)}" height="${Math.max(1, Math.abs(Yb(x.net) - Yb(0))).toFixed(1)}" fill="${x.net >= 0 ? "var(--up)" : "var(--down)"}" opacity=".75"/>`).join("");
  for (const [k, col] of [["c5", "#4a86e8"], ["c20", "#f0883e"]]) { const pts = D.map((x, i) => (x[k] == null ? null : `${(L + i * cw + cw / 2).toFixed(1)},${Yl(x[k]).toFixed(1)}`)).filter(Boolean); if (pts.length > 1) g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.6"/>`; }
  g += [0, n >> 1, n - 1].map(i => `<text x="${(L + i * cw + cw / 2).toFixed(1)}" y="${Hv - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${sxMd(D[i].d)}</text>`).join("");
  return `<svg class="sxbrchart" viewBox="0 0 ${Wv} ${Hv}" role="img" aria-label="分點買賣超與集中度">${g}</svg>
    <div class="sxlegend"><span><i style="background:var(--up)"></i><i style="background:var(--down)"></i>買賣超（張）</span><span><i style="background:#4a86e8"></i>5 日集中</span><span><i style="background:#f0883e"></i>20 日集中</span></div>`;
}
// 大戶：千張以上持股比例的面積圖
function sxAreaChart(P) {
  if (P.length < 2) return "";
  const Wv = 400, Hv = 160, L = 38, R = 18, T = 10, B = 22, n = P.length, vs = P.map(x => x.v), mx = Math.max(...vs), mn = Math.min(...vs), pad = (mx - mn) * 0.15 || 0.05;
  const X = i => L + i * (Wv - L - R) / (n - 1), Y = v => T + (mx + pad - v) / (mx - mn + pad * 2) * (Hv - T - B);
  const line = P.map((x, i) => `${X(i).toFixed(1)},${Y(x.v).toFixed(1)}`).join(" ");
  return `<svg class="sxbrchart" viewBox="0 0 ${Wv} ${Hv}" role="img" aria-label="千張大戶持股變化">
    ${[mx, mn].map(v => `<line x1="${L}" x2="${Wv - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${L - 4}" y="${Y(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--muted)">${v.toFixed(2)}</text>`).join("")}
    <polygon points="${X(0).toFixed(1)},${Hv - B} ${line} ${X(n - 1).toFixed(1)},${Hv - B}" fill="var(--accent-soft)"/><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    ${[0, n >> 1, n - 1].map(i => `<text x="${X(i).toFixed(1)}" y="${Hv - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${P[i].label}</text>`).join("")}</svg>`;
}
// 大戶持股分布：每週千張以上（大戶）與 50 張以下（散戶）
function sxBig(C) {
  const H = (C.holders || []).filter(x => x.b1000 != null).slice(-12); if (H.length < 2) return "";
  const arrow = (v, p, inv) => (p == null || v === p ? "" : `<span class="${(v > p) !== !!inv ? "up" : "down"}">${v > p ? "▲" : "▼"}</span>`);
  return `${sxH("千張以上大戶持股（%）", "每週集保")}${sxAreaChart(H.map(x => ({ label: sxMd(x.d), v: x.b1000 })))}
    <div class="cotbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>大戶持股</th><th>散戶持股</th><th>千張人數</th></tr></thead><tbody>${H.map((x, i) => [x, H[i - 1]]).reverse().map(([x, p]) => `<tr><td>${sxMd(x.d)}</td><td>${arrow(x.b1000, p?.b1000)}${x.b1000.toFixed(2)}</td><td>${x.r50 != null ? arrow(x.r50, p?.r50) + x.r50.toFixed(2) : "—"}</td><td>${sxN(x.people1000)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">大戶＝持股 1,000 張以上，散戶＝50 張以下。董監事（內部人）持股要到公開資訊觀測站查。</p>`;
}
const SX = {
  ls() {
    const S = sxSignals(); if (!S) return sxLoad();
    const pos = (S.score + 100) / 2;
    return `${sxH("多空研判", "技術＋籌碼，每一項 +1／0／−1 平均")}
      <div class="sxgauge"><div class="bar"><i style="left:calc(${pos}% - 6px)"></i></div><div class="lbl"><span class="down">偏空</span><b class="${cls(S.score)}">${S.label}（${S.score > 0 ? "+" : ""}${S.score}）</b><span class="up">偏多</span></div></div>
      <ul class="sxlist">${S.out.map(x => `<li><span class="${x.v > 0 ? "up" : x.v < 0 ? "down" : "muted"}">${x.v > 0 ? "▲ 多" : x.v < 0 ? "▼ 空" : "－ 中"}</span><b>${x.k}</b><span>${esc(x.t)}</span></li>`).join("")}</ul>
      <p class="note">這是把常見指標整理成一個分數，幫你快速看「現在偏哪一邊」，不是買賣建議；盤整時多空訊號常常互相打架。</p>`;
  },
  guru() {
    if (typeof podCalls !== "function") return sxLoad("名人 Podcast 模組沒有載入。");
    if (!POD.srv && POD.srvLoading) return sxLoad();
    const L = podCalls().filter(c => c.code === W.sel).sort((a, b) => b.date.localeCompare(a.date));
    if (!L.length) return `${sxH("達人觀點", "名人 Podcast 提到這檔的看多／看空")}<p class="note">追蹤的節目最近沒有明確提到 ${esc(nameOf(W.sel))}。到「名人」分頁可以加更多節目。</p>`;
    return `${sxH("達人觀點", `${L.length} 筆・名人 Podcast`)}${L.slice(0, 12).map(c => { const p = podPerf(c);
      return `<div class="sxcard"><div class="sxrow"><b>${esc(c.show)}</b><span class="pdir ${c.dir}">${c.dir === "bear" ? "看空" : "看多"}</span><span class="note">${c.date}</span>${p?.latest ? `<b class="${cls(p.latest.ex)}" style="margin-left:auto">${sxPct(p.latest.ex * 100, 1)}<small class="note"> 對大盤（${p.latest.n} 天）</small></b>` : p?.cur ? `<span class="note" style="margin-left:auto">目前 ${sxPct(p.cur.ex * 100, 1)}</span>` : ""}</div>
        ${c.quote ? `<blockquote>${esc(c.quote)}</blockquote>` : ""}<p class="note">${esc(c.title)}</p></div>`; }).join("")}
      <p class="note">AI 從節目整理的觀點，可能聽錯；表現是相對大盤的超額報酬。<button class="linkbtn" data-sxgo="pod">到名人看完整往績 ›</button></p>`;
  },
  daily() {
    const I = sxI(), D = sxD(), C = sxC(); if (!I) return sxLoad(W.info?.err);
    const pm = new Map(D.map((x, i) => [x.d, { c: x.c, ch: i ? x.c - D[i - 1].c : null }])), mg = new Map((I.margin || []).map((r, i, a) => [r.d, { m: i ? r.marginBal - a[i - 1].marginBal : null, s: i ? r.shortBal - a[i - 1].shortBal : null }])), fr = new Map((C?.foreign || []).map(r => [r.d, r.ratio]));
    const rows = (I.inst || []).slice(-10).reverse(); if (!rows.length) return `<p class="note">沒有法人資料。</p>`;
    const r0 = rows[0], tot = r0.foreign + r0.trust + r0.dealer, m0 = mg.get(r0.d);
    const say = `${sxMd(r0.d)} 三大法人合計${tot >= 0 ? "買超" : "賣超"} ${sxN(Math.abs(tot))} 張（外資 ${signed(r0.foreign)}、投信 ${signed(r0.trust)}、自營商 ${signed(r0.dealer)}）${m0?.m != null ? `，融資 ${signed(m0.m)} 張、融券 ${signed(m0.s)} 張` : ""}。`;
    return `${sxH("籌碼日報", "單位：張")}<p class="sxsay">${say}</p>
      <div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th>日期</th><th>收盤</th><th>外資</th><th>投信</th><th>自營</th><th>合計</th><th>融資</th><th>融券</th><th>外資持股</th></tr></thead><tbody>
      ${rows.map(r => { const p = pm.get(r.d), m = mg.get(r.d), t = r.foreign + r.trust + r.dealer;
        return `<tr><td>${sxMd(r.d)}</td><td class="${cls(p?.ch)}">${p ? sxN(p.c, 2) : "—"}</td><td class="${clsOf(r.foreign)}">${signed(r.foreign)}</td><td class="${clsOf(r.trust)}">${signed(r.trust)}</td><td class="${clsOf(r.dealer)}">${signed(r.dealer)}</td><td class="${clsOf(t)}"><b>${signed(t)}</b></td><td class="${clsOf(m?.m)}">${signed(m?.m)}</td><td class="${clsOf(m?.s)}">${signed(m?.s)}</td><td>${fr.has(r.d) ? fr.get(r.d).toFixed(2) + "%" : "—"}</td></tr>`; }).join("")}</tbody></table></div>`;
  },
  check() {
    const I = sxI(), C = sxC(), D = sxD(); if (!I && !C) return sxLoad(W.info?.err || W.co?.err);
    const clamp = v => Math.max(0, Math.min(100, Math.round(v))), dims = [];
    const eps4 = sxEps4(I), f = (I?.fin || []).at(-1);
    if (eps4 != null) dims.push(["獲利", clamp(50 + eps4 * 5 + (f?.net || 0)), `近四季 EPS ${eps4.toFixed(2)} 元${f?.net != null ? `、淨利率 ${f.net}%` : ""}`]);
    const rv = (I?.revenue || []).slice(-3).map(r => r.yoy).filter(v => v != null); if (rv.length) { const g = rv.reduce((s, x) => s + x, 0) / rv.length; dims.push(["成長", clamp(50 + g * 1.5), `近 3 個月營收年增平均 ${sxPct(g, 1)}`]); }
    const b = C?.balance?.at(-1); if (b?.assets) { const debt = b.liab / b.assets * 100, cr = b.cl ? b.ca / b.cl * 100 : null; dims.push(["安全", clamp(100 - debt + (cr ? Math.min(30, (cr - 100) / 5) : 0)), `負債比 ${debt.toFixed(1)}%${cr ? `、流動比 ${cr.toFixed(0)}%` : ""}`]); }
    const P = I?.per || []; if (P.length > 20) { const pe = P.at(-1).pe, xs = P.map(x => x.pe).filter(v => v > 0).sort((a, b) => a - b), med = xs[xs.length >> 1]; if (pe > 0 && med) dims.push(["價值", clamp(50 + (med - pe) / med * 100), `本益比 ${pe}（3 年中位數 ${med}）${P.at(-1).dy != null ? `、殖利率 ${P.at(-1).dy}%` : ""}`]); }
    if (I?.inst?.length) { const s = sxSum(I.inst, "foreign", 20) + sxSum(I.inst, "trust", 20), H = C?.holders || [], hd = H.length > 4 ? H.at(-1).b1000 - H.at(-5).b1000 : null; dims.push(["籌碼", clamp(50 + Math.sign(s) * Math.min(30, Math.log10(Math.abs(s) + 1) * 8) + (hd || 0) * 5), `外資＋投信 20 日 ${signed(s)} 張${hd != null ? `、千張大戶 4 週 ${sxPct(hd)}` : ""}`]); }
    const S = sxSignals(); if (S) dims.push(["技術", clamp(50 + S.score / 2), `多空分數 ${S.score > 0 ? "+" : ""}${S.score}（${S.label}）`]);
    if (dims.length < 3) return sxLoad();
    const avg = Math.round(dims.reduce((s, x) => s + x[1], 0) / dims.length), R = 80, cx = 110, cy = 100, pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / dims.length; return [cx + Math.cos(a) * R * v / 100, cy + Math.sin(a) * R * v / 100]; };
    const grid = [25, 50, 75, 100].map(v => `<polygon points="${dims.map((_, i) => pt(i, v).join(",")).join(" ")}" fill="none" stroke="var(--line)"/>`).join("");
    const poly = `<polygon points="${dims.map((d, i) => pt(i, d[1]).join(",")).join(" ")}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>`;
    const labels = dims.map((d, i) => { const [x, y] = pt(i, 122); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="var(--ink)">${d[0]}</text>`; }).join("");
    return `${sxH("健檢", `${dims.length} 個面向 0～100 分，自行計算`)}<div class="sxcheck"><svg viewBox="-14 -14 248 228" class="sxradar" role="img" aria-label="健檢雷達圖">${grid}${poly}${labels}</svg>
      <div><div class="sxscore"><b>${avg}</b><span class="note">/ 100 綜合</span></div><ul class="sxlist">${dims.map(d => `<li><b>${d[0]}</b><span class="sxbar"><i style="width:${d[1]}%"></i></span><span>${d[1]}</span><span class="note">${esc(d[2])}</span></li>`).join("")}</ul></div></div>
      <p class="note">分數是用公開財報、籌碼、技術資料套簡單公式算的，只用來快速比較強弱項，不是評等。</p>`;
  },
  attr() {
    const I = sxI(), C = sxC(), D = sxD(), px = sxPx(), tags = [];
    const sh = C?.profile?.shares, cap = sh && px ? sh * px : null;
    if (cap) tags.push([cap >= 3e11 ? "大型股" : cap >= 5e10 ? "中型股" : "小型股", `市值約 ${sxYi(cap)}`]);
    if (D.length > 21) { const r = D.slice(-21).map((x, i, a) => (i ? Math.log(x.c / a[i - 1].c) : 0)).slice(1), m = r.reduce((s, x) => s + x, 0) / r.length, v = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / r.length) * Math.sqrt(250) * 100; tags.push([v > 50 ? "高波動" : v > 25 ? "中波動" : "低波動", `年化波動 ${v.toFixed(0)}%（近 20 日）`]); }
    const per = I?.per?.at(-1); if (per?.dy >= 5) tags.push(["高殖利率", `殖利率 ${per.dy}%`]); if (per?.pe > 0 && per.pe < 12) tags.push(["低本益比", `本益比 ${per.pe}`]); if (per?.pe > 30) tags.push(["高本益比", `本益比 ${per.pe}`]);
    const rv = (I?.revenue || []).slice(-3).map(r => r.yoy).filter(v => v != null); if (rv.length && rv.reduce((s, x) => s + x, 0) / rv.length > 20) tags.push(["高成長", "近 3 個月營收年增平均 > 20%"]);
    const fr = C?.foreign?.at(-1)?.ratio; if (fr != null) tags.push([fr >= 50 ? "外資重押" : fr >= 20 ? "外資持股中等" : "內資股", `外資持股 ${fr.toFixed(1)}%`]);
    const b1 = C?.holders?.at(-1)?.b1000; if (b1 != null) tags.push([b1 >= 70 ? "大戶集中" : b1 <= 30 ? "散戶多" : "籌碼普通", `千張大戶持股 ${b1.toFixed(1)}%`]);
    const dv = (C?.dividend || []).filter(x => x.cash > 0); if (dv.length >= 5) tags.push(["穩定配息", `近 ${dv.length} 年有配現金`]);
    const th = (typeof IND !== "undefined" ? IND.themes : []).filter(t => indCodes(t).includes(W.sel));
    return `${sxH("屬性")}<div class="sxtags">${tags.map(([t, d]) => `<span class="sxtag"><b>${t}</b><small>${esc(d)}</small></span>`).join("") || `<p class="note">${C || I ? "資料不足" : "載入中…"}</p>`}</div>
      ${th.length ? `${sxH("題材", `${th.length} 個`)}<div class="sxtags">${th.map(t => `<button class="sxtag" data-sxind="${t.id}"><b>${esc(t.name)}</b><small>${esc(t.cat)}</small></button>`).join("")}</div>` : ""}`;
  },
  target() {
    const I = sxI(), px = sxPx(); if (!I) return sxLoad(W.info?.err);
    const eps4 = sxEps4(I), P = (I.per || []).map(x => x.pe).filter(v => v > 0).sort((a, b) => a - b);
    const note = `<p class="note">券商（法人）目標價來自付費研究報告，免費資料源沒有，所以這裡<b>不顯示任何券商目標價</b>。上面是用這檔自己過去 3 年的本益比區間 × 近四季 EPS 推估的「評價區間」，只是參考，不是法人報告。可以到券商 App 或財經新聞查「目標價」。</p>`;
    if (!eps4 || eps4 <= 0 || P.length < 20) return `${sxH("法人目標", "評價推估")}<p class="note">${eps4 != null && eps4 <= 0 ? "近四季虧損，不能用本益比估。" : "本益比或 EPS 資料不足，無法估算。"}</p>${note}`;
    const q = p => P[Math.min(P.length - 1, Math.floor(p * P.length))], lv = [["便宜", q(0.1)], ["偏低", q(0.3)], ["合理", q(0.5)], ["偏高", q(0.7)], ["昂貴", q(0.9)]].map(([k, pe]) => [k, pe, pe * eps4]);
    const lo = lv[0][2], hi = lv[4][2], pos = px ? Math.max(0, Math.min(100, (px - lo) / ((hi - lo) || 1) * 100)) : null;
    return `${sxH("法人目標", "評價推估（非券商報告）")}
      <div class="sxgauge"><div class="bar val">${pos != null ? `<i style="left:calc(${pos}% - 6px)"></i>` : ""}</div><div class="lbl"><span>${sxN(lo, 1)}</span><b>現價 ${sxN(px, 2)}</b><span>${sxN(hi, 1)}</span></div></div>
      <div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th>區間</th><th>本益比</th><th>推估股價</th><th>和現價比</th></tr></thead><tbody>${lv.map(([k, pe, p]) => `<tr><td>${k}</td><td>${pe.toFixed(1)}</td><td><b>${sxN(p, 1)}</b></td><td class="${cls(px ? p - px : null)}">${px ? sxPct((p / px - 1) * 100, 1) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">近四季 EPS ${eps4.toFixed(2)} 元；本益比區間取過去 3 年第 10／30／50／70／90 百分位。</p>${note}`;
  },
  inst() {
    const I = sxI(), C = sxC(); if (!I?.inst?.length) return sxLoad(W.info?.err);
    const A = I.inst, streak = k => { let n = 0; const s = Math.sign(A.at(-1)[k]); if (!s) return 0; for (let i = A.length - 1; i >= 0 && Math.sign(A[i][k]) === s; i--) n++; return n * s; };
    const ws = [["foreign", "外資"], ["trust", "投信"], ["dealer", "自營商"]];
    const st = v => (v > 0 ? `<span class="up">連買 ${v} 天</span>` : v < 0 ? `<span class="down">連賣 ${-v} 天</span>` : "—");
    const H = C?.holders || [], F = C?.foreign || [];
    return `${sxH("法人動向", "買賣超（張）")}<div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th></th><th>今日</th><th>5 日</th><th>20 日</th><th>60 日</th><th>連續</th></tr></thead><tbody>
      ${ws.map(([k, n]) => `<tr><td>${n}</td>${[1, 5, 20, 60].map(d => { const v = sxSum(A, k, d); return `<td class="${clsOf(v)}">${signed(v)}</td>`; }).join("")}<td>${st(streak(k))}</td></tr>`).join("")}</tbody></table></div>
      ${F.length ? `${sxH("外資持股比例", sxMd(F.at(-1).d))}${sxKv([["目前", F.at(-1).ratio.toFixed(2) + "%"], F.length > 20 && ["20 日變化", sxPct(F.at(-1).ratio - F.at(-21).ratio), cls(F.at(-1).ratio - F.at(-21).ratio)], F.at(-1).limit != null && ["持股上限", F.at(-1).limit + "%"]])}` : ""}
      ${H.length ? `${sxH("主力（千張大戶）", "每週集保")}${sxKv([["千張大戶持股", H.at(-1).b1000.toFixed(1) + "%"], H.length > 4 && ["4 週變化", sxPct(H.at(-1).b1000 - H.at(-5).b1000), cls(H.at(-1).b1000 - H.at(-5).b1000)], ["400 張以上", H.at(-1).b400 + "%"], ["千張大戶人數", sxN(H.at(-1).people1000)]])}` : ""}
      <p class="note">「主力」用集保的千張大戶持股變化代表（免費資料沒有券商分點）。外資、投信、自營商買賣超來自證交所。</p>`;
  },
  news() {
    const N = W.news; if (!N || N.code !== W.sel || N.loading) return sxLoad();
    if (N.err) return `<p class="note err">⚠ ${esc(N.err)}</p>`;
    return `${sxH("新聞", N.source || "")}<ul class="sxnews">${(N.items || []).slice(0, 15).map(x => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><span class="note">${esc(x.source || "")}${x.at ? "・" + new Date(x.at + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ").replace("-", "/") : ""}</span></li>`).join("") || `<li class="note">沒有新聞。</li>`}</ul>`;
  },
  chain() {
    const th = (typeof IND !== "undefined" ? IND.themes : []).filter(t => indCodes(t).includes(W.sel));
    if (!th.length) return `${sxH("產業鏈")}<p class="note">產業地圖裡還沒有收錄 ${esc(nameOf(W.sel))}。</p>`;
    return `${sxH("產業鏈", `${th.length} 個題材`)}${th.slice(0, 6).map(T => { const tiers = indChainData(T);
      return `<div class="sxcard"><div class="sxrow"><b>${esc(T.name)}</b><span class="note">${esc(T.cat)}</span><button class="linkbtn" data-sxind="${T.id}" style="margin-left:auto">看圖解 ›</button></div>
        ${tiers.map(g => { const mine = g.items.some(it => it.c.some(x => x[0] === W.sel));
          return `<div class="sxtier ${mine ? "me" : ""}"><span class="tt">${esc(g.tier)}${g.title ? "・" + esc(g.title) : ""}</span>${g.items.map(it => `<div class="ti"><small>${esc(it.name)}</small>${it.c.slice(0, 6).map(x => `<button class="sxco ${x[0] === W.sel ? "me" : ""}" ${okCode(String(x[0]).toUpperCase()) ? `data-sel="${esc(x[0])}"` : "disabled"}>${esc(x[1] || x[0])}</button>`).join("")}</div>`).join("")}</div>`; }).join("")}</div>`; }).join("")}`;
  },
  branch() {
    const B = W.br;
    if (!B || B.code !== W.sel || B.loading) return sxLoad();
    if (B.needSponsor || B.err || !B.ok) {
      return `${sxH("分點主力", "券商分點進出")}<div class="sxcard"><p>${esc(B.error || B.err || "暫時沒有分點資料")}</p>
        ${B.needSponsor ? `<p class="note">券商分點（哪一家券商、哪一個分點買賣多少）在證交所要輸入驗證碼才能查，免費 API 拿不到。要在這裡看到「主力動向、買賣方 Top15、籌碼集中度、家數差」，需要：</p>
        <ol class="note"><li>到 FinMind 官網升級為<b>贊助會員</b>（付費）。</li><li>把金鑰設定在 Vercel 的環境變數 <code>FINMIND_TOKEN</code>（已經設定過就不用改名字，升級後同一把金鑰就有權限）。</li><li>重新部署後，這一頁就會自動出現。</li></ol>` : ""}</div>
        <p class="note">沒有分點資料前，可以先看「法人主力」（三大法人＋千張大戶）和「籌碼分佈」。</p>`;
    }
    const n = +W.brRange || 1, T = B.tops?.[n] || B.tops?.[1]; if (!T) return `<p class="note">沒有分點資料。</p>`;
    const side = W.brSide === "sell" ? "sell" : "buy", L = T[side] || [], mx = Math.max(1, ...L.map(x => Math.abs(x.net)));
    const lab = T.conc == null ? "—" : T.conc >= 20 ? "大買" : T.conc >= 5 ? "買超" : T.conc <= -20 ? "大賣" : T.conc <= -5 ? "賣超" : "中性";
    const sh = sxC()?.profile?.shares, D = B.days || [];
    const chips = (k, cur, opts) => `<div class="cochips">${opts.map(([v, t]) => `<button data-${k}="${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join("")}</div>`;
    return `${sxH("分點主力", `${T.from === T.to ? sxMd(T.to) : sxMd(T.from) + "～" + sxMd(T.to)}・前 15 大分點`)}
      ${chips("brr", n, [[1, "近 1 日"], [5, "近 5 日"], [20, "近 20 日"]])}
      <div class="sxbrtop"><div class="sxbrlab"><small>主力動向</small><b class="${cls(T.conc)}">${lab}</b></div>
        ${sxKv([["籌碼集中", signed(T.net) + " 張", cls(T.net)], ["籌碼集中 %", sxPct(T.conc), cls(T.conc)], ["成交量", sxN(T.vol) + " 張"], sh && ["佔股本比重", sxPct(T.net * 1000 / sh * 100, 3), cls(T.net)], sh && ["區間週轉率", (T.vol * 1000 / sh * 100).toFixed(2) + "%"]])}</div>
      ${chips("brs", side, [["buy", "買方 Top15"], ["sell", "賣方 Top15"]])}
      <ul class="sxbrlist">${L.map(x => `<li><span>${esc(x.name)}</span><i class="${side === "buy" ? "up" : "down"}" style="width:${Math.abs(x.net) / mx * 100}%"></i><b>${sxN(Math.abs(x.net))} 張</b><small>${x.avg != null ? x.avg.toFixed(2) : "—"}</small></li>`).join("") || `<li class="note">沒有${side === "buy" ? "買超" : "賣超"}分點</li>`}</ul>
      ${sxH("主力買賣超與集中度", `近 ${D.length} 個交易日`)}${sxBrChart(D)}
      <div class="cotbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>買賣超</th><th>家數差</th><th>5 日集中</th><th>20 日集中</th></tr></thead><tbody>${D.slice(-20).reverse().map(x => `<tr><td>${sxMd(x.d)}</td><td class="${cls(x.net)}">${signed(x.net)}</td><td class="${cls(x.diff)}">${x.diff > 0 ? "+" : ""}${x.diff}</td><td class="${cls(x.c5)}">${x.c5 == null ? "—" : x.c5.toFixed(2)}</td><td class="${cls(x.c20)}">${x.c20 == null ? "—" : x.c20.toFixed(2)}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">籌碼集中＝前 15 大買超分點合計－前 15 大賣超分點合計，集中 %＝它 ÷ 成交量。家數差＝買超家數－賣超家數：主力集中買進、很多小分點賣出時是負的（籌碼集中）；正的代表買的分點多、籌碼分散。均價是該分點的買進（或賣出）均價。資料：${esc(B.source || "")}。</p>`;
  },
  mb() {
    const I = sxI(), C = sxC(); if (!I) return sxLoad(W.info?.err);
    const M = I.margin || [], m = M.at(-1), S = I.short || [], s = S.at(-1), H = C?.holders || [];
    const chg = (k, n) => (M.length > n ? m[k] - M.at(-1 - n)[k] : null);
    return `${sxH("融資融券", m ? sxMd(m.d) : "")}${m ? sxKv([["融資餘額", sxN(m.marginBal) + " 張"], ["融資 5 日", signed(chg("marginBal", 5)), clsOf(chg("marginBal", 5))], ["融資使用率", m.marginLimit ? (m.marginBal / m.marginLimit * 100).toFixed(1) + "%" : "—"], ["融券餘額", sxN(m.shortBal) + " 張"], ["融券 5 日", signed(chg("shortBal", 5)), clsOf(chg("shortBal", 5))], ["券資比", m.marginBal ? (m.shortBal / m.marginBal * 100).toFixed(1) + "%" : "—"]]) : `<p class="note">沒有融資融券資料（可能不能信用交易）。</p>`}
      ${s ? `${sxH("借券賣出", sxMd(s.d))}${sxKv([["借券賣出餘額", sxN(s.sBal) + " 張"], S.length > 5 && ["5 日變化", signed(s.sBal - S.at(-6).sBal), clsOf(-(s.sBal - S.at(-6).sBal))]])}` : ""}
      ${H.length ? `${sxH("大戶持股", "每週集保")}<div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th>週</th><th>千張大戶</th><th>400 張以上</th><th>千張人數</th></tr></thead><tbody>${H.slice(-8).reverse().map((h, i, a) => `<tr><td>${sxMd(h.d)}</td><td class="${cls(a[i + 1] ? h.b1000 - a[i + 1].b1000 : null)}">${h.b1000}%</td><td>${h.b400}%</td><td>${sxN(h.people1000)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="note">券資比高（融券多）時，股價上漲可能引發軋空；融資使用率高代表散戶槓桿多，下跌時容易斷頭賣壓。</p>`;
  },
  dist() {
    const C = sxC(); if (!C) return sxLoad(W.co?.err);
    const T = C.dist; if (!T?.levels?.length) return `<p class="note">沒有股權分散資料。</p>`;
    const mx = Math.max(...T.levels.map(x => x.pct || 0)), lots = lo => (lo >= 1000 ? Math.round(lo / 1000).toLocaleString() + " 張" : lo + " 股");
    const small = T.levels.filter(x => x.lo < 50001).reduce((s, x) => s + x.pct, 0), big = T.levels.filter(x => x.lo >= 400001).reduce((s, x) => s + x.pct, 0);
    return `${sxH("籌碼分佈（股權分散）", sxMd(T.d) + " 集保")}${sxKv([["散戶 ≤50 張", small.toFixed(1) + "%"], ["大戶 ≥400 張", big.toFixed(1) + "%"], ["總股東人數", sxN(T.levels.reduce((s, x) => s + (x.people || 0), 0))]])}
      <ul class="sxdist">${T.levels.map(x => `<li><span>${lots(x.lo)} 以上</span><i style="width:${(x.pct || 0) / mx * 100}%"></i><b>${(x.pct || 0).toFixed(2)}%</b><small class="note">${sxN(x.people)} 人</small></li>`).join("")}</ul>
      <p class="note">每一級距是持股數的下限。大戶比例上升、散戶人數減少，通常代表籌碼往少數人集中。價格的籌碼分佈（每個價位的成交量）在「走勢 → 分價量」。</p>${sxBig(C)}`;
  },
  rev() {
    const I = sxI(); if (!I) return sxLoad(W.info?.err);
    const R = I.revenue || []; if (!R.length) return `<p class="note">沒有營收資料（ETF 沒有營收）。</p>`;
    const last = R.at(-1), yr = R.filter(r => r.ym.slice(0, 4) === last.ym.slice(0, 4)), ly = R.filter(r => r.ym.slice(0, 4) === String(+last.ym.slice(0, 4) - 1) && +r.ym.slice(5) <= +last.ym.slice(5));
    const cum = yr.reduce((s, r) => s + r.rev, 0), cumL = ly.reduce((s, r) => s + r.rev, 0);
    return `${sxH("營收", `${last.ym.replace("-", "/")} 最新`)}${sxKv([["當月營收", sxYi(last.rev)], ["年增", sxPct(last.yoy, 1), cls(last.yoy)], ["月增", sxPct(last.mom, 1), cls(last.mom)], ["今年累計", sxYi(cum)], ["累計年增", cumL ? sxPct((cum / cumL - 1) * 100, 1) : "—", cls(cum - cumL)]])}
      ${barLineSvg(R.slice(-12).map(r => ({ label: r.ym.slice(5) + "月", v: +(r.rev / 1e8).toFixed(1), y: r.yoy })), { fmtV: v => v + "億" })}`;
  },
  profit() {
    const I = sxI(); if (!I) return sxLoad(W.info?.err);
    const F = I.fin || []; if (!F.length) return `<p class="note">沒有獲利資料。</p>`;
    const eps4 = sxEps4(I), f = F.at(-1);
    return `${sxH("獲利", f.q)}${sxKv([["單季 EPS", sxN(f.eps, 2) + " 元", cls(f.eps)], ["近四季 EPS", eps4 != null ? eps4.toFixed(2) + " 元" : "—"], ["毛利率", f.gross != null ? f.gross + "%" : "—"], ["營益率", f.op != null ? f.op + "%" : "—"], ["淨利率", f.net != null ? f.net + "%" : "—"]])}
      ${barLineSvg(F.slice(-8).map(r => ({ label: String(r.q).slice(2), v: r.eps, y: r.gross })), { fmtV: v => v, fmtY: v => v + "%" })}<p class="note">柱＝每季 EPS（元）、線＝毛利率。</p>
      <div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th>季度</th><th>EPS</th><th>毛利率</th><th>營益率</th><th>淨利率</th></tr></thead><tbody>${F.slice(-8).reverse().map(r => `<tr><td>${r.q}</td><td class="${cls(r.eps)}">${r.eps}</td><td>${r.gross ?? "—"}%</td><td>${r.op ?? "—"}%</td><td>${r.net ?? "—"}%</td></tr>`).join("")}</tbody></table></div>`;
  },
  fin() {
    const C = sxC(); if (!C) return sxLoad(W.co?.err);
    const i = C.income?.at(-1), b = C.balance?.at(-1), c = C.cash?.at(-1);
    return `${sxH("財報摘要", i?.q || "")}${i ? sxKv([["營收", sxYi(i.rev)], ["毛利", sxYi(i.gp)], ["營業利益", sxYi(i.op)], ["稅後淨利", sxYi(i.ni)], ["EPS", i.eps != null ? sxN(i.eps, 2) + " 元" : "—"]]) : ""}
      ${b ? `${sxH("資產負債", b.q)}${sxKv([["總資產", sxYi(b.assets)], ["總負債", sxYi(b.liab)], ["權益", sxYi(b.equity)], ["負債比", b.assets ? (b.liab / b.assets * 100).toFixed(1) + "%" : "—"], ["流動比", b.cl ? (b.ca / b.cl * 100).toFixed(0) + "%" : "—"]])}` : ""}
      ${c ? `${sxH("現金流", c.q)}${sxKv([["營業現金流", sxYi(c.ocf), cls(c.ocf)], ["投資現金流", sxYi(c.icf)], ["籌資現金流", sxYi(c.fin)], ["自由現金流", sxYi(c.fcf), cls(c.fcf)]])}` : ""}
      <p><button class="btn sm" data-sxgo="co">看完整財報（利潤表、資產負債表、現金流量表、財務指標）›</button></p>`;
  },
  fund() {
    const I = sxI(); if (!I?.inst?.length) return sxLoad(W.info?.err);
    const A = I.inst, sh = sxC()?.profile?.shares, lots = sh ? sh / 1000 : null;
    return `${sxH("基金持股", "用投信買賣超估算")}${sxKv([["投信 20 日", signed(sxSum(A, "trust", 20)) + " 張", clsOf(sxSum(A, "trust", 20))], ["投信 60 日", signed(sxSum(A, "trust", 60)) + " 張", clsOf(sxSum(A, "trust", 60))], ["投信 120 日", signed(sxSum(A, "trust", 120)) + " 張", clsOf(sxSum(A, "trust", 120))], lots && ["120 日佔股本", sxPct(sxSum(A, "trust", 120) / lots * 100)]])}
      ${barLineSvg(A.slice(-20).map(r => ({ label: sxMd(r.d), v: r.trust, y: null })), { fmtV: v => v })}
      <p class="note">投信買賣的就是國內基金（含 ETF）。每檔基金的持股明細由投信投顧公會每月公布，沒有免費 API，這裡用證交所的「投信買賣超」累計來看基金是在加碼還是減碼。</p>`;
  },
  div() {
    const C = sxC(); if (!C) return sxLoad(W.co?.err);
    const L = (C.dividend || []).slice().sort((a, b) => b.y - a.y), px = sxPx(), D = sxD(); if (!L.length) return `<p class="note">沒有配息紀錄。</p>`;
    const fill = x => { if (!x.ex || !D.length) return "—"; const i = D.findIndex(k => k.d >= x.ex); if (i <= 0) return x.ex > (D.at(-1)?.d || "") ? "還沒除息" : "—"; const pre = D[i - 1].c, j = D.slice(i).findIndex(k => k.h >= pre); return j >= 0 ? `<span class="up">已填息（${j + 1} 天）</span>` : `<span class="down">尚未填息</span>`; };
    const y0 = L[0];
    return `${sxH("除權息")}${sxKv([["最近現金股利", y0.cash ? y0.cash.toFixed(2) + " 元" : "—"], ["最近股票股利", y0.stock ? y0.stock.toFixed(2) + " 元" : "—"], ["現金殖利率", px && y0.cash ? (y0.cash / px * 100).toFixed(2) + "%" : "—"], ["除息日", y0.ex || "—"], ["發放日", y0.pay || "—"]])}
      <div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th>年度</th><th>現金</th><th>股票</th><th>除息日</th><th>發放日</th><th>填息</th></tr></thead><tbody>${L.slice(0, 10).map(x => `<tr><td>${x.y}</td><td>${x.cash ? x.cash.toFixed(2) : "—"}</td><td>${x.stock ? x.stock.toFixed(2) : "—"}</td><td>${x.ex || "—"}</td><td>${x.pay || "—"}</td><td>${fill(x)}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">年度是股利所屬的盈餘年度；填息＝除息後股價回到除息前一天的收盤。</p>`;
  },
  cal() {
    const C = sxC(), now = new Date(Date.now() + 8 * 3600e3), today = now.toISOString().slice(0, 10), y = now.getUTCFullYear(), ev = [];
    const m = now.getUTCMonth() + 1, nm = m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, "0")}-10`, thisM = `${y}-${String(m).padStart(2, "0")}-10`;
    ev.push([today <= thisM ? thisM : nm, `公布 ${today <= thisM ? (m === 1 ? 12 : m - 1) : m} 月營收（每月 10 日前）`]);
    [[`${y}-03-31`, `公布 ${y - 1} 年報（Q4）`], [`${y}-05-15`, "公布第一季財報"], [`${y}-08-14`, "公布第二季財報"], [`${y}-11-14`, "公布第三季財報"], [`${y + 1}-03-31`, `公布 ${y} 年報（Q4）`]].forEach(x => ev.push(x));
    (C?.dividend || []).forEach(x => { if (x.ex) ev.push([x.ex, `除息（${x.y} 年度現金 ${x.cash ? x.cash.toFixed(2) : 0} 元）`]); if (x.pay) ev.push([x.pay, `股利發放`]); });
    if (typeof podCalls === "function") podCalls().filter(c => c.code === W.sel).slice(0, 5).forEach(c => ev.push([c.date, `${c.show} ${c.dir === "bear" ? "看空" : "看多"}`]));
    const up = ev.filter(e => e[0] >= today).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 8), past = ev.filter(e => e[0] < today).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    const li = ([d, t]) => `<li><b>${d.replace(/-/g, "/")}</b><span>${esc(t)}</span></li>`;
    return `${sxH("即將到來")}<ul class="sxcal">${up.map(li).join("")}</ul>${past.length ? `${sxH("最近")}<ul class="sxcal past">${past.map(li).join("")}</ul>` : ""}
      <p class="note">營收、財報是法定最晚公布日（公司常提早公布）；除息日、發放日來自公司公告；股東會日期請以公開資訊觀測站為準。</p>`;
  },
  holders() {
    const C = sxC(); if (!C) return sxLoad(W.co?.err);
    const P = C.profile || {}, T = C.dist, top = T?.levels?.filter(x => x.lo >= 1000001) || [], F = C.foreign?.at(-1);
    return `${sxH("股東結構")}${sxKv([["董事長", esc(P.chairman || "—")], ["總經理", esc(P.ceo || "—")], ["千張以上股東", top.length ? sxN(top.reduce((s, x) => s + (x.people || 0), 0)) + " 人" : "—"], ["千張以上持股", top.length ? top.reduce((s, x) => s + x.pct, 0).toFixed(1) + "%" : "—"], ["外資持股", F ? F.ratio.toFixed(2) + "%" : "—"]])}
      <p class="note">前十大股東名單、董監事持股明細只在公開資訊觀測站（公司治理 → 董監事持股、股東會年報）公布，沒有免費 API，所以這裡不列名單。上面是從集保股權分散與外資持股整理的股東結構。</p>
      <p><a class="btn sm" href="https://mops.twse.com.tw/" target="_blank" rel="noopener">開啟公開資訊觀測站 ↗</a></p>`;
  },
  info() {
    const C = sxC(), P = C?.profile; if (!C) return sxLoad(W.co?.err); if (!P) return `<p class="note">沒有公司基本資料。</p>`;
    const px = sxPx(), cap = P.shares && px ? P.shares * px : null, ind = W.mf?.ind?.[W.sel];
    const row = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "");
    return `${sxH("個股資訊")}<table class="tbl sxinfo"><tbody>${row("公司名稱", esc(P.name))}${row("代號", W.sel)}${row("產業", esc(ind || ""))}${row("董事長", esc(P.chairman))}${row("總經理", esc(P.ceo))}${row("發言人", esc(P.spokesman))}
      ${row("成立日期", P.founded)}${row("上市櫃日期", P.listed)}${row("實收資本額", P.capital ? sxYi(P.capital) : "")}${row("發行股數", P.shares ? sxN(P.shares / 1000) + " 張" : "")}${row("市值", cap ? sxYi(cap) : "")}
      ${row("網址", P.web ? `<a href="${esc(/^https?:/.test(P.web) ? P.web : "https://" + P.web)}" target="_blank" rel="noopener">${esc(P.web)}</a>` : "")}${row("地址", esc(P.address))}</tbody></table>`;
  },
};
function sxInit() {
  W.brRange = store.get("watch:brr", 1); W.brSide = "buy";
  $("#sxNav").addEventListener("click", e => { const b = e.target.closest("[data-sx]"); if (!b) return; W.sx = b.dataset.sx; store.set("watch:sx", W.sx); sxRender.scrolled = false; sxRender(); });
  $("#sxBox").addEventListener("click", e => {
    const s = e.target.closest("[data-sel]"); if (s) { select(s.dataset.sel); return; }
    const g = e.target.closest("[data-sxgo]"); if (g) { if (g.dataset.sxgo === "co") setDtab("co"); else if (g.dataset.sxgo === "pod") { showList(); setLt("pod"); } return; }
    const t = e.target.closest("[data-sxind]"); if (t) { W.indS.open = t.dataset.sxind; showList(); setLt("ind"); return; }
    const r = e.target.closest("[data-brr]"); if (r) { W.brRange = +r.dataset.brr; store.set("watch:brr", W.brRange); sxRender(); return; }
    const sd = e.target.closest("[data-brs]"); if (sd) { W.brSide = sd.dataset.brs; sxRender(); }
  });
  const css = document.createElement("style"); css.textContent = `
.sxbrtop { display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: center; } .sxbrlab { text-align: center; } .sxbrlab small { display: block; color: var(--muted); } .sxbrlab b { font-size: 40px; font-weight: 500; }
@media (max-width: 420px) { .sxbrtop { grid-template-columns: 1fr; } }
.sxbrlist { list-style: none; margin: 6px 0 12px; padding: 0; } .sxbrlist li { display: grid; grid-template-columns: minmax(0, 7em) 1fr auto 4.6em; gap: 8px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
.sxbrlist li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .sxbrlist li i { height: 14px; border-radius: 3px; min-width: 2px; } .sxbrlist li i.up { background: var(--up); } .sxbrlist li i.down { background: var(--down); }
.sxbrlist li b { font-weight: 500; font-family: var(--font-num); } .sxbrlist li small { text-align: right; color: var(--muted); font-family: var(--font-num); }
.sxbrchart { width: 100%; height: auto; display: block; } .sxlegend { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 12px; color: var(--muted); margin: 4px 0 10px; } .sxlegend i { display: inline-block; width: 12px; height: 8px; border-radius: 2px; margin-right: 3px; }
.sxnav { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.sxnav button { flex: none; border: 1px solid var(--line); background: var(--surface-3); color: var(--muted); border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 13.5px; cursor: pointer; white-space: nowrap; }
.sxnav button[aria-pressed="true"] { background: var(--grad-strong); color: var(--on-strong); border-color: var(--strong-line); }
#sxBox { padding: 4px 14px 16px; } .sxh { font-size: 15px; font-weight: 500; margin: 14px 0 8px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; } .sxh .note { font-weight: 400; font-size: 12px; }
.sxkv { margin: 0 0 8px; } .sxsay { line-height: 1.7; margin: 0 0 8px; } .sxwait { padding: 12px 0; }
.sxtbl { font-size: 13px; } .sxtbl td, .sxtbl th { white-space: nowrap; }
.sxgauge { margin: 8px 0 12px; } .sxgauge .bar { position: relative; height: 10px; border-radius: 99px; background: linear-gradient(90deg, var(--down), var(--surface-3) 50%, var(--up)); }
.sxgauge .bar.val { background: linear-gradient(90deg, var(--down), var(--surface-3) 50%, var(--up)); } .sxgauge i { position: absolute; top: -4px; width: 12px; height: 18px; border-radius: 4px; background: var(--ink); border: 2px solid var(--surface); }
.sxgauge .lbl { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px; font-size: 13px; } .sxgauge .lbl b { font-size: 17px; font-weight: 500; }
.sxlist { list-style: none; margin: 0; padding: 0; } .sxlist li { display: grid; grid-template-columns: 52px 76px 1fr; gap: 8px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
.sxcheck { display: grid; grid-template-columns: minmax(0, 220px) 1fr; gap: 12px; align-items: center; } .sxradar { width: 100%; max-width: 240px; }
.sxcheck .sxlist li { grid-template-columns: 36px 1fr 28px; } .sxcheck .sxlist li .note { grid-column: 1 / -1; font-size: 12px; margin-top: -4px; }
.sxbar { height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; } .sxbar i { display: block; height: 100%; background: var(--accent); }
.sxscore b { font-size: 40px; font-weight: 300; font-family: var(--font-num); } @media (max-width: 560px) { .sxcheck { grid-template-columns: 1fr; } .sxradar { margin: 0 auto; } }
.sxtags { display: flex; flex-wrap: wrap; gap: 8px; } .sxtag { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm, 10px); background: var(--surface-3); color: var(--ink); font: inherit; text-align: left; } button.sxtag { cursor: pointer; }
.sxtag b { font-weight: 500; } .sxtag small { color: var(--muted); font-size: 12px; }
.sxcard { border: 1px solid var(--line); border-radius: var(--radius-md, 12px); padding: 10px 12px; margin: 8px 0; background: var(--surface-3); } .sxrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sxcard blockquote { margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 6px; }
.sxcard .pdir { font-size: 12px; padding: 1px 8px; border-radius: 99px; color: #fff; } .sxcard .pdir.bull { background: var(--up); } .sxcard .pdir.bear { background: var(--down); }
.sxtier { border-left: 3px solid var(--line); padding: 4px 0 4px 10px; margin: 8px 0; } .sxtier.me { border-left-color: var(--accent); } .sxtier .tt { font-size: 13px; color: var(--muted); }
.sxtier .ti { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px; } .sxtier .ti small { color: var(--muted); margin-right: 4px; }
.sxco { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 1px 9px; font: inherit; font-size: 12.5px; cursor: pointer; } .sxco.me { background: var(--grad-strong); color: var(--on-strong); border-color: var(--strong-line); } .sxco:disabled { cursor: default; opacity: .7; }
.sxdist { list-style: none; margin: 0; padding: 0; } .sxdist li { display: grid; grid-template-columns: 96px 1fr 58px 72px; gap: 8px; align-items: center; padding: 3px 0; font-size: 12.5px; } .sxdist i { display: block; height: 10px; border-radius: 3px; background: var(--accent); min-width: 1px; } .sxdist b { font-weight: 500; text-align: right; font-family: var(--font-num); }
.sxnews { list-style: none; margin: 0; padding: 0; } .sxnews li { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--line); } .sxnews a { color: var(--ink); text-decoration: none; } .sxnews a:hover { text-decoration: underline; }
.sxcal { list-style: none; margin: 0; padding: 0; } .sxcal li { display: grid; grid-template-columns: 96px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; } .sxcal li b { font-weight: 500; font-family: var(--font-num); } .sxcal.past { opacity: .7; }
.sxinfo th { text-align: left; color: var(--muted); font-weight: 400; width: 96px; white-space: nowrap; } .sxinfo td { text-align: left; }`;
  document.head.appendChild(css);
}
