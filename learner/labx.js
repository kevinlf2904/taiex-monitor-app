/* ================= 圖表實驗室：組合策略回測、參數最佳化（index.html 載入；只定義函式，畫面由 labxRender() 畫在 #advPanel） =================
   組合策略：兩、三個策略的訊號用「且／或」合起來（「且」＝在 N 根 K 棒內都出現同方向訊號才算），和各自單獨的成績比較。
   參數最佳化：選一個策略的兩個參數，各取幾個值做網格回測，畫成熱力圖；前 70% 資料用來找參數（樣本內），後 30% 驗證（樣本外），
   樣本內最好的參數在樣本外常常沒那麼好——這就是「過度擬合」。 */

const lxCls = v => (v > 0 ? "up" : v < 0 ? "down" : "");
const LX = { tab: "combo", a: "macd", b: "dmi", c: "", buy: "and", sell: "or", win: 3, opt: "kd", px: "", py: "", busy: false };
const lxStrats = () => Object.entries(STRAT_DEFS).filter(([k]) => !["pat"].includes(k));
// 把幾組訊號合起來：mode and＝每一組在 win 根 K 棒內都有同方向的訊號（在最後一組到齊的那根標出）；or＝任一組有就算
function combineSigs(groups, side, mode, win) {
  const S = groups.map(g => g.filter(x => x.side === side).map(x => x.i).sort((a, b) => a - b)), out = new Set();
  if (mode === "or") S.flat().forEach(i => out.add(i));
  else { const all = [...new Set(S.flat())].sort((a, b) => a - b); all.forEach(i => { if (S.every(L => L.some(j => j <= i && j > i - win))) out.add(i); }); }
  // 「且」的時候，同一段連續成立只留第一根
  const L = [...out].sort((a, b) => a - b).filter((i, k, a) => mode === "or" || k === 0 || a[k - 1] < i - win);
  return L.map(i => ({ i, side, label: side === "buy" ? "組合買進" : "組合賣出" }));
}
function lxStats(D, sigs) { const bt = backtest(D, sigs, { capital: 1e6 }); return { n: sigs.length, trades: bt.trades.length, ret: bt.total, bh: bt.bh, win: bt.win, mdd: bt.mdd }; }
const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
function lxCombo() {
  const D = lab.D, I = lab.I, ids = [LX.a, LX.b, LX.c].filter(Boolean), runs = ids.map(id => ({ id, s: stratRun(id, D, I) }));
  const sigs = [...combineSigs(runs.map(r => r.s), "buy", LX.buy, LX.win), ...combineSigs(runs.map(r => r.s), "sell", LX.sell, LX.win)].sort((a, b) => a.i - b.i);
  return { rows: [...runs.map(r => ({ name: STRAT_DEFS[r.id].name, ...lxStats(D, r.s) })), { name: `組合（買：${LX.buy === "and" ? "全部都要" : "任一個"}、賣：${LX.sell === "and" ? "全部都要" : "任一個"}）`, combo: true, ...lxStats(D, sigs) }], sigs };
}
// 參數值：從最小到最大取最多 n 個（照間距）
function lxValues(p, n = 7) { const [, , lo, hi, st] = p, k = Math.max(1, Math.round((hi - lo) / st)), step = Math.max(1, Math.ceil(k / (n - 1))), out = []; for (let j = 0; j <= k; j += step) out.push(+(lo + j * st).toFixed(4)); if (out[out.length - 1] !== hi) out.push(hi); return out.slice(0, n + 1); }
async function lxOptimize() {
  const S = STRAT_DEFS[LX.opt], D = lab.D; if (!S?.params?.length || !D) return;
  const px = S.params.find(p => p[0] === LX.px) || S.params[0], py = S.params.find(p => p[0] === LX.py && p !== px) || S.params.find(p => p !== px) || null;
  const cut = Math.floor(D.length * 0.7), Din = D.slice(0, cut), Iin = indicators(Din), I = lab.I, xs = lxValues(px), ys = py ? lxValues(py) : [null];
  LX.busy = true; LX.res = null; labxRender(); await new Promise(r => setTimeout(r, 30));
  const grid = ys.map(y => xs.map(x => { const p = { [px[0]]: x, ...(py ? { [py[0]]: y } : {}) }; try { return { p, ret: backtest(Din, stratRun(LX.opt, Din, Iin, p), { capital: 1e6 }).total }; } catch { return { p, ret: null }; } }));
  const best = grid.flat().filter(g => g.ret != null).sort((a, b) => b.ret - a.ret)[0];
  // 樣本外：用全部資料算訊號（指標需要前面的資料暖機），只看樣本外那一段的交易
  const outOf = p => { const sig = stratRun(LX.opt, D, I, p).filter(x => x.i >= cut).map(x => ({ ...x, i: x.i - cut })); return backtest(D.slice(cut), sig, { capital: 1e6 }).total; };
  LX.res = { px, py, xs, ys, grid, best, cut, bestOut: best ? outOf(best.p) : null, defIn: backtest(Din, stratRun(LX.opt, Din, Iin), { capital: 1e6 }).total, defOut: outOf({}), bhIn: Din[Din.length - 1].c / Din[0].c - 1, bhOut: D[D.length - 1].c / D[cut].c - 1 };
  LX.busy = false; labxRender();
}
function labxRender() {
  const host = document.getElementById("advPanel"); if (!host || !lab.D) return;
  const opt = sel => lxStrats().map(([k, s]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  let h = `<div class="ph"><h2>進階回測</h2><div class="seg" role="group">${[["combo", "組合策略"], ["opt", "參數最佳化"]].map(([k, t]) => `<button data-lxt="${k}" aria-pressed="${LX.tab === k}">${t}</button>`).join("")}</div></div><div class="lxbody">`;
  if (LX.tab === "combo") {
    const R = lxCombo();
    h += `<div class="lxform"><label>策略 A <select data-lx="a">${opt(LX.a)}</select></label><label>策略 B <select data-lx="b">${opt(LX.b)}</select></label><label>策略 C <select data-lx="c"><option value="">（不用）</option>${opt(LX.c)}</select></label>
      <label>買進 <select data-lx="buy"><option value="and" ${LX.buy === "and" ? "selected" : ""}>全部都要（且）</option><option value="or" ${LX.buy === "or" ? "selected" : ""}>任一個（或）</option></select></label>
      <label>賣出 <select data-lx="sell"><option value="or" ${LX.sell === "or" ? "selected" : ""}>任一個（或）</option><option value="and" ${LX.sell === "and" ? "selected" : ""}>全部都要（且）</option></select></label>
      <label>「且」要在幾根內 <input type="number" min="1" max="20" data-lx="win" value="${LX.win}" style="width:60px"></label></div>
      <div class="ctbl"><table><thead><tr><th>策略</th><th>訊號</th><th>交易</th><th>總報酬</th><th>勝率</th><th>最大回落</th></tr></thead><tbody>
      ${R.rows.map(r => `<tr${r.combo ? ' class="lxcombo"' : ""}><td>${esc(r.name)}</td><td>${r.n}</td><td>${r.trades}</td><td class="${lxCls(r.ret)}">${pct(r.ret)}</td><td>${r.trades ? Math.round(r.win * 100) + "%" : "—"}</td><td>${pct(-r.mdd)}</td></tr>`).join("")}
      <tr><td class="note">買進持有</td><td></td><td></td><td class="${lxCls(R.rows[0].bh)}">${pct(R.rows[0].bh)}</td><td></td><td></td></tr></tbody></table></div>
      <p class="note">每個策略用預設參數；回測方式同上面的回測（全部資金、隔天開盤成交、含手續費與證交稅）。「且」讓訊號變少、比較嚴格，「或」讓訊號變多。按「在圖上顯示組合訊號」可以看組合後的買賣點。</p>
      <button class="btn sm" data-lxshow>在圖上顯示組合訊號</button>`;
  } else {
    const S = STRAT_DEFS[LX.opt], ps = S?.params || [], R = LX.res;
    h += `<div class="lxform"><label>策略 <select data-lx="opt">${lxStrats().filter(([, s]) => s.params?.length).map(([k, s]) => `<option value="${k}" ${k === LX.opt ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <label>橫軸參數 <select data-lx="px">${ps.map(p => `<option value="${p[0]}" ${p[0] === LX.px ? "selected" : ""}>${esc(p[1])}</option>`).join("")}</select></label>
      ${ps.length > 1 ? `<label>縱軸參數 <select data-lx="py">${ps.map(p => `<option value="${p[0]}" ${p[0] === LX.py ? "selected" : ""}>${esc(p[1])}</option>`).join("")}</select></label>` : ""}
      <button class="btn sm primary" data-lxrun ${LX.busy ? "disabled" : ""}>${LX.busy ? "計算中…" : "開始最佳化"}</button></div>`;
    if (R) {
      const vals = R.grid.flat().map(g => g.ret).filter(v => v != null), mx = Math.max(...vals.map(Math.abs), 0.01);
      const col = v => (v == null ? "transparent" : v >= 0 ? `color-mix(in srgb, var(--up) ${Math.round(15 + 70 * v / mx)}%, transparent)` : `color-mix(in srgb, var(--down) ${Math.round(15 + 70 * -v / mx)}%, transparent)`);
      h += `<p class="note">樣本內：前 ${R.cut} 根（${lab.D[0].d}～${lab.D[R.cut - 1].d}）；樣本外：後 ${lab.D.length - R.cut} 根。格子是樣本內的總報酬，★ 是最好的一組。</p>
        <div class="ctbl"><table class="lxheat"><thead><tr><th>${R.py ? esc(R.py[1]) + " ＼ " : ""}${esc(R.px[1])}</th>${R.xs.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>
        ${R.grid.map((row, yi) => `<tr><th>${R.py ? R.ys[yi] : ""}</th>${row.map(g => `<td style="background:${col(g.ret)}">${g === R.best ? "★" : ""}${pct(g.ret, 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <div class="cokv three"><div><span>樣本內最好的參數</span><b>${R.best ? Object.entries(R.best.p).map(([k, v]) => `${esc(R.px[0] === k ? R.px[1] : R.py?.[1])} ${v}`).join("、") : "—"}</b><small>樣本內 ${pct(R.best?.ret)}</small></div>
        <div><span>拿到樣本外驗證</span><b class="${lxCls(R.bestOut)}">${pct(R.bestOut)}</b><small>預設參數樣本外 ${pct(R.defOut)}・買進持有 ${pct(R.bhOut)}</small></div>
        <div><span>判讀</span><b style="font-size:13px">${R.bestOut == null ? "—" : R.bestOut < R.defOut ? "最佳化後反而比預設差：過度擬合" : R.bestOut < (R.best?.ret ?? 0) / 2 ? "樣本外明顯變差，有過度擬合的跡象" : "樣本外也維持，參數比較穩定"}</b><small>看熱力圖：周圍格子也都不錯，才是穩定的參數區；只有一格特別好通常是巧合</small></div></div>`;
    } else h += `<p class="note">選一個策略與要調整的參數，按「開始最佳化」。每一格是一組參數在樣本內（前 70%）的回測報酬。</p>`;
  }
  host.innerHTML = h + `</div>`;
}
function labxEvents() {
  const host = document.getElementById("advPanel"); if (!host || host._lx) return; host._lx = true;
  host.addEventListener("click", e => { const b = e.target.closest("[data-lxt],[data-lxrun],[data-lxshow]"); if (!b) return;
    if (b.dataset.lxt) { LX.tab = b.dataset.lxt; labxRender(); }
    else if (b.hasAttribute("data-lxrun")) lxOptimize();
    else if (b.hasAttribute("data-lxshow")) { const R = lxCombo(); labChart.set(lab.D, { ...labChart.o, markers: R.sigs }); b.textContent = `圖上顯示 ${R.sigs.length} 個組合訊號（換策略或重畫會恢復）`; } });
  host.addEventListener("change", e => { const k = e.target.dataset.lx; if (!k) return; LX[k] = k === "win" ? Math.max(1, +e.target.value || 1) : e.target.value; if (k === "opt") { LX.px = ""; LX.py = ""; LX.res = null; } if (k === "px" || k === "py") LX.res = null; labxRender(); });
}
