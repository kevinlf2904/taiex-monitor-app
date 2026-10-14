/* ================= 圖表實驗室：組合策略回測、參數最佳化、滾動驗證（index.html 載入；只定義函式，畫面由 labxRender() 畫在 #advPanel） =================
   組合策略：兩、三個策略的訊號用「且／或」合起來（「且」＝在 N 根 K 棒內都出現同方向訊號才算），和各自單獨的成績比較。
   參數最佳化：選一個策略的兩個參數，各取幾個值做網格回測，畫成熱力圖；前 70% 資料用來找參數（樣本內），後 30% 驗證（樣本外），
   樣本內最好的參數在樣本外常常沒那麼好——這就是「過度擬合」。
   滾動驗證（walk-forward）：把後段資料切成幾個視窗，每個視窗只用它前面一段資料挑參數，再拿下一段沒看過的資料測試，把各段樣本外的成績串起來。
   交易設定（停損、停利、移動停利、手續費折扣、滑價）三個分頁共用，並同時算「不計成本」的報酬來比較。 */

const lxCls = v => (v > 0 ? "up" : v < 0 ? "down" : "");
const LX = { tab: "combo", a: "macd", b: "dmi", c: "", buy: "and", sell: "or", win: 3, opt: "kd", px: "", py: "", busy: false,
  stop: 0, take: 0, trail: 0, disc: 10, slip: 0, k: 5, ...(store.get("lxSet", null) || {}) };
const LX_SET = ["stop", "take", "trail", "disc", "slip", "k"];
const lxStrats = () => Object.entries(STRAT_DEFS).filter(([k]) => !["pat"].includes(k));
// 回測選項：cost＝false 時不計手續費、證交稅、滑價（停損停利照樣用），拿來看成本吃掉多少
function lxOpt(cost = true) {
  const code = typeof labUsesReal === "function" && labUsesReal() ? REAL.cur?.code : null;
  return { capital: 1e6, stop: LX.stop / 100, take: LX.take / 100, trail: LX.trail / 100,
    fee: cost ? FEE * Math.max(0, Math.min(10, LX.disc)) / 10 : 0, minFee: cost ? 20 : 0, slip: cost ? LX.slip / 100 : 0, tax: cost ? taxOf(code) ?? TAX : 0 };
}
// 把幾組訊號合起來：mode and＝每一組在 win 根 K 棒內都有同方向的訊號（在最後一組到齊的那根標出）；or＝任一組有就算
function combineSigs(groups, side, mode, win) {
  const S = groups.map(g => g.filter(x => x.side === side).map(x => x.i).sort((a, b) => a - b)), out = new Set();
  if (mode === "or") S.flat().forEach(i => out.add(i));
  else { const all = [...new Set(S.flat())].sort((a, b) => a - b); all.forEach(i => { if (S.every(L => L.some(j => j <= i && j > i - win))) out.add(i); }); }
  // 「且」的時候，同一段連續成立只留第一根
  const L = [...out].sort((a, b) => a - b).filter((i, k, a) => mode === "or" || k === 0 || a[k - 1] < i - win);
  return L.map(i => ({ i, side, label: side === "buy" ? "組合買進" : "組合賣出" }));
}
function lxStats(D, sigs) { const bt = backtest(D, sigs, lxOpt()), raw = backtest(D, sigs, lxOpt(false)); return { n: sigs.length, trades: bt.trades.length, ret: bt.total, raw: raw.total, bh: bt.bh, win: bt.win, mdd: bt.mdd, stops: bt.trades.filter(t => /停損|停利/.test(t.why)).length }; }
const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
function lxCombo() {
  const D = lab.D, I = lab.I, ids = [LX.a, LX.b, LX.c].filter(Boolean), runs = ids.map(id => ({ id, s: stratRun(id, D, I) }));
  const sigs = [...combineSigs(runs.map(r => r.s), "buy", LX.buy, LX.win), ...combineSigs(runs.map(r => r.s), "sell", LX.sell, LX.win)].sort((a, b) => a.i - b.i);
  return { rows: [...runs.map(r => ({ name: STRAT_DEFS[r.id].name, ...lxStats(D, r.s) })), { name: `組合（買：${LX.buy === "and" ? "全部都要" : "任一個"}、賣：${LX.sell === "and" ? "全部都要" : "任一個"}）`, combo: true, ...lxStats(D, sigs) }], sigs };
}
// 參數值：從最小到最大取最多 n 個（照間距）
function lxValues(p, n = 7) { const [, , lo, hi, st] = p, k = Math.max(1, Math.round((hi - lo) / st)), step = Math.max(1, Math.ceil(k / (n - 1))), out = []; for (let j = 0; j <= k; j += step) out.push(+(lo + j * st).toFixed(4)); if (out[out.length - 1] !== hi) out.push(hi); return out.slice(0, n + 1); }
// 目前選的橫軸、縱軸參數，和所有要試的參數組合
function lxAxes() {
  const S = STRAT_DEFS[LX.opt]; if (!S?.params?.length) return null;
  const px = S.params.find(p => p[0] === LX.px) || S.params[0], py = S.params.find(p => p[0] === LX.py && p !== px) || S.params.find(p => p !== px) || null;
  const xs = lxValues(px), ys = py ? lxValues(py) : [null];
  return { px, py, xs, ys, combos: ys.flatMap(y => xs.map(x => ({ [px[0]]: x, ...(py ? { [py[0]]: y } : {}) }))) };
}
async function lxOptimize() {
  const A = lxAxes(), D = lab.D; if (!A || !D) return;
  const { px, py, xs, ys } = A, cut = Math.floor(D.length * 0.7), Din = D.slice(0, cut), Iin = indicators(Din), I = lab.I, O = lxOpt();
  LX.busy = true; LX.res = null; labxRender(); await new Promise(r => setTimeout(r, 30));
  const grid = ys.map(y => xs.map(x => { const p = { [px[0]]: x, ...(py ? { [py[0]]: y } : {}) }; try { return { p, ret: backtest(Din, stratRun(LX.opt, Din, Iin, p), O).total }; } catch { return { p, ret: null }; } }));
  const best = grid.flat().filter(g => g.ret != null).sort((a, b) => b.ret - a.ret)[0];
  // 樣本外：用全部資料算訊號（指標需要前面的資料暖機），只看樣本外那一段的交易
  const outOf = (p, o = O) => { const sig = stratRun(LX.opt, D, I, p).filter(x => x.i >= cut).map(x => ({ ...x, i: x.i - cut })); return backtest(D.slice(cut), sig, o).total; };
  LX.res = { D, px, py, xs, ys, grid, best, cut, bestOut: best ? outOf(best.p) : null, bestOutRaw: best ? outOf(best.p, lxOpt(false)) : null, defIn: backtest(Din, stratRun(LX.opt, Din, Iin), O).total, defOut: outOf({}), bhIn: Din[Din.length - 1].c / Din[0].c - 1, bhOut: D[D.length - 1].c / D[cut].c - 1 };
  LX.busy = false; labxRender();
}
/* 滾動驗證：前 30% 當第一段樣本內，後 70% 平均切成 K 個樣本外視窗；每個視窗的樣本內＝緊接在它前面、同樣長度的一段（滾動，不是一直加長）。
   訊號用全部資料算一次（指標只看過去，不會偷看未來），回測時只取那一段的訊號與 K 棒，每段期末平倉。 */
function lxWalk(cost = true) {
  const A = lxAxes(), D = lab.D, I = lab.I; if (!A || !D) return null;
  const N = D.length, K = Math.max(2, Math.min(8, LX.k)), oos = Math.floor(N * 0.7 / K), isLen = N - K * oos, O = lxOpt(cost);
  if (oos < 15 || isLen < 30) return { short: true, N, K };
  const sigOf = A.combos.map(p => ({ p, s: stratRun(LX.opt, D, I, p) })), defS = stratRun(LX.opt, D, I);
  const seg = (s, a, b) => backtest(D.slice(a, b), s.filter(x => x.i >= a && x.i < b).map(x => ({ ...x, i: x.i - a })), O);
  const wins = [], eqW = [], eqD = []; let fW = 1, fD = 1;
  for (let k = 0; k < K; k++) {
    const oa = isLen + k * oos, ob = k === K - 1 ? N : oa + oos, ia = oa - isLen;
    const tried = sigOf.map(c => ({ p: c.p, s: c.s, ret: seg(c.s, ia, oa).total })), best = tried.reduce((m, t) => (t.ret > m.ret ? t : m), tried[0]);
    const btW = seg(best.s, oa, ob), btD = seg(defS, oa, ob), isD = seg(defS, ia, oa).total;
    btW.eq.forEach(v => eqW.push(fW * v / btW.cap)); btD.eq.forEach(v => eqD.push(fD * v / btD.cap));
    fW *= 1 + btW.total; fD *= 1 + btD.total;
    wins.push({ ia, oa, ob, p: best.p, isRet: best.ret, oosRet: btW.total, isDef: isD, oosDef: btD.total, trades: btW.trades.length });
  }
  const bh = backtest(D.slice(isLen), [], { ...O, useBuy: false, stop: 0, take: 0, trail: 0 }) /* 買進持有不用停損停利 */, eqB = bh.eq.map(v => v / bh.cap);
  return { A, N, K, oos, isLen, wins, eqW, eqD, eqB, totW: fW - 1, totD: fD - 1, totB: bh.total };
}
async function lxWalkRun() {
  if (!lab.D) return; LX.busy = true; LX.wf = null; labxRender(); await new Promise(r => setTimeout(r, 30));
  try { const r = lxWalk(true); LX.wf = r && !r.short ? { ...r, D: lab.D, raw: lxWalk(false) } : r && { ...r, D: lab.D }; } finally { LX.busy = false; labxRender(); }
}
// 樣本外串接資產曲線（SVG）：滾動驗證、固定預設參數、買進持有
function lxCurve(R) {
  const W = 640, H = 190, P = 8, all = [...R.eqW, ...R.eqD, ...R.eqB], lo = Math.min(...all, 1), hi = Math.max(...all, 1), n = R.eqW.length;
  const X = i => P + (W - 2 * P) * i / Math.max(1, n - 1), Y = v => P + (H - 2 * P - 14) * (hi - v) / (hi - lo || 1);
  const line = (a, c, d = "") => `<polyline fill="none" stroke="${c}" stroke-width="1.8" ${d} points="${a.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`;
  const cuts = R.wins.slice(1).map(w => X(w.oa - R.isLen)), D = lab.D;
  return `<svg class="lxcurve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="樣本外串接的資產曲線">
    <line x1="${P}" x2="${W - P}" y1="${Y(1)}" y2="${Y(1)}" stroke="var(--line)"/>${cuts.map(x => `<line x1="${x}" x2="${x}" y1="${P}" y2="${H - 20}" stroke="var(--line)" stroke-dasharray="3 3"/>`).join("")}
    ${line(R.eqB, "var(--muted)", 'stroke-dasharray="4 3"')}${line(R.eqD, "var(--s3)")}${line(R.eqW, "var(--s1)")}
    <text x="${P}" y="${H - 4}" font-size="11" fill="var(--muted)">${esc(D[R.isLen].d)}</text><text x="${W - P}" y="${H - 4}" font-size="11" fill="var(--muted)" text-anchor="end">${esc(D[R.N - 1].d)}</text></svg>
    <div class="lxleg"><span><i style="background:var(--s1)"></i>滾動驗證 ${pct(R.totW)}</span><span><i style="background:var(--s3)"></i>固定預設參數 ${pct(R.totD)}</span><span><i style="background:var(--muted)"></i>買進持有 ${pct(R.totB)}</span></div>`;
}
const lxP = (R, p) => Object.entries(p).map(([k, v]) => `${esc(R.A.px[0] === k ? R.A.px[1] : R.A.py?.[1] || k)} ${v}`).join("、");
function labxRender() {
  const host = document.getElementById("advPanel"); if (!host || !lab.D) return;
  if (LX.res && LX.res.D !== lab.D) LX.res = null; if (LX.wf && LX.wf.D !== lab.D) LX.wf = null; /* 換了走勢就清掉舊結果 */
  const opt = sel => lxStrats().map(([k, s]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const num = (k, t, mx, st, w = 58) => `<label>${t} <input type="number" min="0" max="${mx}" step="${st}" data-lx="${k}" value="${LX[k]}" style="width:${w}px" inputmode="decimal"></label>`;
  let h = `<div class="ph"><h2>進階回測</h2><div class="seg" role="group">${[["combo", "組合策略"], ["opt", "參數最佳化"], ["wf", "滾動驗證"]].map(([k, t]) => `<button data-lxt="${k}" aria-pressed="${LX.tab === k}">${t}</button>`).join("")}</div></div><div class="lxbody">`;
  // 交易設定：三個分頁共用
  h += `<details class="lxset"${LX.setOpen ? " open" : ""}><summary>交易設定：停損 ${LX.stop ? LX.stop + "%" : "不用"}・停利 ${LX.take ? LX.take + "%" : "不用"}・移動停利 ${LX.trail ? LX.trail + "%" : "不用"}・手續費 ${LX.disc >= 10 ? "不打折" : LX.disc + " 折"}・滑價 ${LX.slip}%</summary>
    <div class="lxform">${num("stop", "停損 %", 50, 0.5)}${num("take", "停利 %", 200, 1)}${num("trail", "移動停利 %", 50, 0.5)}${num("disc", "手續費折扣（折）", 10, 0.5)}${num("slip", "滑價 %（每邊）", 3, 0.05)}</div>
    <p class="note" style="margin:0 0 8px">0＝不用。手續費 0.1425% × 折扣（6 折就填 6，每筆最低 20 元），賣出另收證交稅 0.3%（ETF 0.1%）；滑價是成交價比預期差多少，買進往上加、賣出往下扣。
    進場一樣在訊號隔天開盤；停損、停利從進場隔天起，用每根 K 棒的最高、最低價判斷：盤中碰到就以停損（停利）價成交，開盤就跳空越過則以開盤價成交。移動停利是從持有期間的最高價回落幾 % 出場。</p></details>`;
  if (LX.tab === "combo") {
    const R = lxCombo();
    h += `<div class="lxform"><label>策略 A <select data-lx="a">${opt(LX.a)}</select></label><label>策略 B <select data-lx="b">${opt(LX.b)}</select></label><label>策略 C <select data-lx="c"><option value="">（不用）</option>${opt(LX.c)}</select></label>
      <label>買進 <select data-lx="buy"><option value="and" ${LX.buy === "and" ? "selected" : ""}>全部都要（且）</option><option value="or" ${LX.buy === "or" ? "selected" : ""}>任一個（或）</option></select></label>
      <label>賣出 <select data-lx="sell"><option value="or" ${LX.sell === "or" ? "selected" : ""}>任一個（或）</option><option value="and" ${LX.sell === "and" ? "selected" : ""}>全部都要（且）</option></select></label>
      <label>「且」要在幾根內 <input type="number" min="1" max="20" data-lx="win" value="${LX.win}" style="width:60px"></label></div>
      <div class="ctbl"><table><thead><tr><th>策略</th><th>訊號</th><th>交易</th><th>總報酬</th><th>不計成本</th><th>勝率</th><th>最大回落</th></tr></thead><tbody>
      ${R.rows.map(r => `<tr${r.combo ? ' class="lxcombo"' : ""}><td>${esc(r.name)}</td><td>${r.n}</td><td>${r.trades}${r.stops ? `<small class="note">（停損停利 ${r.stops}）</small>` : ""}</td><td class="${lxCls(r.ret)}">${pct(r.ret)}</td><td class="${lxCls(r.raw)}">${pct(r.raw)}</td><td>${r.trades ? Math.round(r.win * 100) + "%" : "—"}</td><td>${pct(-r.mdd)}</td></tr>`).join("")}
      <tr><td class="note">買進持有</td><td></td><td></td><td class="${lxCls(R.rows[0].bh)}">${pct(R.rows[0].bh)}</td><td></td><td></td><td></td></tr></tbody></table></div>
      <p class="note">每個策略用預設參數；回測方式同上面的回測（全部資金、隔天開盤成交），成本與停損停利照「交易設定」。「不計成本」是同樣的進出、但不收手續費、證交稅也沒有滑價，兩欄的差距就是成本吃掉的報酬——交易越多次差越多。「且」讓訊號變少、比較嚴格，「或」讓訊號變多。按「在圖上顯示組合訊號」可以看組合後的買賣點。</p>
      <button class="btn sm" data-lxshow>在圖上顯示組合訊號</button>`;
  } else {
    const S = STRAT_DEFS[LX.opt], ps = S?.params || [];
    h += `<div class="lxform"><label>策略 <select data-lx="opt">${lxStrats().filter(([, s]) => s.params?.length).map(([k, s]) => `<option value="${k}" ${k === LX.opt ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <label>橫軸參數 <select data-lx="px">${ps.map(p => `<option value="${p[0]}" ${p[0] === LX.px ? "selected" : ""}>${esc(p[1])}</option>`).join("")}</select></label>
      ${ps.length > 1 ? `<label>縱軸參數 <select data-lx="py">${ps.map(p => `<option value="${p[0]}" ${p[0] === LX.py ? "selected" : ""}>${esc(p[1])}</option>`).join("")}</select></label>` : ""}
      ${LX.tab === "wf" ? `<label>視窗數 <select data-lx="k">${[4, 5, 6].map(k => `<option value="${k}" ${+LX.k === k ? "selected" : ""}>${k} 段</option>`).join("")}</select></label>` : ""}
      <button class="btn sm primary" data-lxrun ${LX.busy ? "disabled" : ""}>${LX.busy ? "計算中…" : LX.tab === "wf" ? "開始滾動驗證" : "開始最佳化"}</button></div>`;
    if (LX.tab === "opt") h += lxOptHtml(); else h += lxWfHtml();
  }
  host.innerHTML = h + `</div>`;
}
function lxOptHtml() {
  const R = LX.res; if (!R) return `<p class="note">選一個策略與要調整的參數，按「開始最佳化」。每一格是一組參數在樣本內（前 70%）的回測報酬（含成本）。</p>`;
  const vals = R.grid.flat().map(g => g.ret).filter(v => v != null), mx = Math.max(...vals.map(Math.abs), 0.01);
  const col = v => (v == null ? "transparent" : v >= 0 ? `color-mix(in srgb, var(--up) ${Math.round(15 + 70 * v / mx)}%, transparent)` : `color-mix(in srgb, var(--down) ${Math.round(15 + 70 * -v / mx)}%, transparent)`);
  return `<p class="note">樣本內：前 ${R.cut} 根（${lab.D[0].d}～${lab.D[R.cut - 1].d}）；樣本外：後 ${lab.D.length - R.cut} 根。格子是樣本內的總報酬（含成本），★ 是最好的一組。</p>
    <div class="ctbl"><table class="lxheat"><thead><tr><th>${R.py ? esc(R.py[1]) + " ＼ " : ""}${esc(R.px[1])}</th>${R.xs.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>
    ${R.grid.map((row, yi) => `<tr><th>${R.py ? R.ys[yi] : ""}</th>${row.map(g => `<td style="background:${col(g.ret)}">${g === R.best ? "★" : ""}${pct(g.ret, 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="cokv three"><div><span>樣本內最好的參數</span><b>${R.best ? Object.entries(R.best.p).map(([k, v]) => `${esc(R.px[0] === k ? R.px[1] : R.py?.[1])} ${v}`).join("、") : "—"}</b><small>樣本內 ${pct(R.best?.ret)}</small></div>
    <div><span>拿到樣本外驗證</span><b class="${lxCls(R.bestOut)}">${pct(R.bestOut)}</b><small>不計成本 ${pct(R.bestOutRaw)}・預設參數樣本外 ${pct(R.defOut)}・買進持有 ${pct(R.bhOut)}</small></div>
    <div><span>判讀</span><b style="font-size:13px">${R.bestOut == null ? "—" : R.bestOut < R.defOut ? "最佳化後反而比預設差：過度擬合" : R.bestOut < (R.best?.ret ?? 0) / 2 ? "樣本外明顯變差，有過度擬合的跡象" : "樣本外也維持，參數比較穩定"}</b><small>看熱力圖：周圍格子也都不錯，才是穩定的參數區；只有一格特別好通常是巧合。只切一次樣本外可能剛好碰上順手的行情，可以再用「滾動驗證」多驗幾段。</small></div></div>`;
}
function lxWfHtml() {
  const R = LX.wf, why = `<details class="bt-help"><summary>為什麼滾動驗證比較不會「過度最佳化」？</summary><ul>
    <li>參數最佳化是在同一段資料裡挑成績最好的一組，等於拿考古題背答案；挑得越細，越容易挑到只是剛好配合那段雜訊的參數。</li>
    <li>滾動驗證每一段都只用<strong>當時以前</strong>的資料挑參數，再拿<strong>下一段還沒看過</strong>的資料測試，一直往後滾。串起來的樣本外報酬，比較接近「真的照這套方法、定期重新挑參數」會拿到的成績。</li>
    <li>只切一次 70%／30% 只驗證一次，可能剛好碰上適合的行情；滾動驗證驗了好幾段，運氣的成分比較小。</li>
    <li>怎麼看：滾動驗證贏過固定預設參數，最佳化才有幫助；如果輸了，代表挑出來的多半是雜訊。各段選到的參數跳來跳去、樣本內很好但樣本外常常變差，也是過度擬合的警訊。</li>
    <li>限制：資料越短每段越短，交易次數少，結果的隨機性大。模擬走勢選 500 天或用真實個股會比較有意義。</li></ul></details>`;
  if (!R) return `<p class="note">前 30% 的資料當第一段樣本內，後 70% 切成幾個視窗。每個視窗：用它前面同樣長度的一段（樣本內）試遍參數組合、挑報酬最好的，再拿這組參數到這個視窗（樣本外）實際回測；最後把各段樣本外的成績串起來，和「一直用預設參數」、「買進持有」比較。</p>${why}`;
  if (R.short) return `<p class="note" style="color:var(--down)">資料只有 ${R.N} 根，切成 ${R.K} 段後每段太短（至少要 15 根）。把走勢長度改成 250 或 500 天、減少視窗數，或改用真實個股。</p>${why}`;
  const D = R.D, dd = i => D[i].d.slice(2).replace(/-/g, "/"), sameP = new Set(R.wins.map(w => JSON.stringify(w.p))).size;
  const worse = R.wins.filter(w => w.oosRet < w.isRet).length;
  return `<p class="note">樣本內每段 ${R.isLen} 根、樣本外每段約 ${R.oos} 根；參數組合 ${R.A.combos.length} 組。報酬含成本，每段期末平倉（所以會多一次進出的成本）。</p>
    <div class="ctbl"><table><thead><tr><th>視窗</th><th>樣本內期間</th><th>樣本外期間</th><th>選到的參數</th><th>樣本內報酬</th><th>樣本外報酬</th><th>預設參數樣本外</th></tr></thead><tbody>
    ${R.wins.map((w, k) => `<tr><td>${k + 1}</td><td class="num">${dd(w.ia)}～${dd(w.oa - 1)}</td><td class="num">${dd(w.oa)}～${dd(w.ob - 1)}</td><td>${lxP(R, w.p)}</td><td class="${lxCls(w.isRet)}">${pct(w.isRet)}</td><td class="${lxCls(w.oosRet)}">${pct(w.oosRet)}<small class="note">（${w.trades} 筆）</small></td><td class="${lxCls(w.oosDef)}">${pct(w.oosDef)}</td></tr>`).join("")}
    <tr class="lxcombo"><td colspan="5">樣本外串接</td><td class="${lxCls(R.totW)}">${pct(R.totW)}</td><td class="${lxCls(R.totD)}">${pct(R.totD)}</td></tr></tbody></table></div>
    ${lxCurve(R)}
    <div class="cokv three"><div><span>滾動驗證（樣本外串接）</span><b class="${lxCls(R.totW)}">${pct(R.totW)}</b><small>不計成本 ${pct(R.raw?.totW)}</small></div>
    <div><span>固定預設參數／買進持有</span><b><span class="${lxCls(R.totD)}">${pct(R.totD)}</span>／<span class="${lxCls(R.totB)}">${pct(R.totB)}</span></b><small>同一段樣本外期間；預設參數不計成本 ${pct(R.raw?.totD)}</small></div>
    <div><span>判讀</span><b style="font-size:13px">${R.totW < R.totD ? "最佳化沒有幫助：挑出來的參數在下一段不管用" : R.totW < R.totB ? "比預設參數好，但還是輸給買進持有" : "滾動驗證勝出，參數在不同段都還有效"}</b><small>${worse} / ${R.K} 段樣本外比樣本內差；各段選到 ${sameP} 種不同參數${sameP > R.K / 2 ? "，參數不穩定" : ""}</small></div></div>${why}`;
}
function labxEvents() {
  const host = document.getElementById("advPanel"); if (!host || host._lx) return; host._lx = true;
  host.addEventListener("click", e => { const b = e.target.closest("[data-lxt],[data-lxrun],[data-lxshow]"); if (!b) return;
    if (b.dataset.lxt) { LX.tab = b.dataset.lxt; labxRender(); }
    else if (b.hasAttribute("data-lxrun")) (LX.tab === "wf" ? lxWalkRun : lxOptimize)();
    else if (b.hasAttribute("data-lxshow")) { const R = lxCombo(); labChart.set(lab.D, { ...labChart.o, markers: R.sigs }); b.textContent = `圖上顯示 ${R.sigs.length} 個組合訊號（換策略或重畫會恢復）`; } });
  host.addEventListener("toggle", e => { if (e.target.classList?.contains("lxset")) LX.setOpen = e.target.open; }, true);
  host.addEventListener("change", e => { const k = e.target.dataset.lx; if (!k) return;
    if (LX_SET.includes(k)) { const lim = { stop: 50, take: 200, trail: 50, disc: 10, slip: 3, k: 8 }[k]; LX[k] = Math.max(0, Math.min(lim, +e.target.value || 0)); if (k === "disc") LX.disc = LX.disc ? Math.max(1, LX.disc) : 10; store.set("lxSet", Object.fromEntries(LX_SET.map(x => [x, LX[x]]))); LX.res = null; LX.wf = null; }
    else LX[k] = k === "win" ? Math.max(1, +e.target.value || 1) : e.target.value;
    if (k === "opt") { LX.px = ""; LX.py = ""; LX.res = null; LX.wf = null; } if (k === "px" || k === "py") { LX.res = null; LX.wf = null; } labxRender(); });
}
