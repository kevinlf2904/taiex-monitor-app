"use strict";
/* 量化分析（K線學堂與看盤共用，需要先載入 core.js、analysis.js）：
   1. 回測績效：年化報酬、夏普、索提諾、獲利因子、賺賠比、最大回撤與水下時間、連續虧損…（btMetrics）
   2. 拆開看：依進場時的行情（多頭／空頭／盤整）與波動高低分組，找出策略在哪種環境會失效（btBreakdown）
   3. 改善試算：同一組訊號換幾種常見的風險控制（停損、只做多頭、避開高波動、移動停利、半倉），前後指標對照（btVariants、btAdvice）
   4. 市場狀態：趨勢（均線＋ADX）、波動（ATR 在自己歷史的百分位）、量能（量比、漲跌日的量），適合與該避免的策略（marketState、stateAdvice）
   5. ATR 參考進出場與部位大小（atrSetup）
   6. 投資組合風險：相關係數、Beta、集中度、風險貢獻、大盤跌 20% 試算、再平衡與避險金額（portRisk、portPlan）
   7. 多因子：動能、價值、低波動、趨勢的百分位分數與每月再平衡回測（factorRaw、factorScore、factorBacktest）
   全部只用「到那一天為止」的資料，不偷看未來。上半部是純計算（tests/unit.test.mjs 直接載入檢查），下半部是共用的畫面片段。 */

const QY = 252;
const qMean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const qSd = a => { if (a.length < 2) return 0; const m = qMean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const qRet = a => a.slice(1).map((v, i) => (a[i] > 0 ? v / a[i] - 1 : 0));
const qSma = (a, n) => { const o = Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const qCov = (a, b) => { const n = Math.min(a.length, b.length); if (n < 2) return 0; const ma = qMean(a.slice(0, n)), mb = qMean(b.slice(0, n)); let s = 0; for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb); return s / (n - 1); };
const qCorr = (a, b) => { const d = qSd(a) * qSd(b); return d > 0 ? qCov(a, b) / d : 0; };
const qMed = a => { const s = a.filter(v => v != null && Number.isFinite(v)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const qClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const qD10 = d => String(d || "").slice(0, 10);
// 這段資料涵蓋幾年（用日期算；分 K 只有幾天就回傳 null，不年化）
function qYears(D) { const a = Date.parse(qD10(D[0]?.d)), b = Date.parse(qD10(D[D.length - 1]?.d)); return a && b && b - a >= 20 * 864e5 ? (b - a) / (365.25 * 864e5) : null; }

/* ---------- 1. 回測績效指標（輸入 analysis.js 的 backtest() 結果與同一段 K 線） ---------- */
function btMetrics(bt, D) {
  const eq = bt.eq || [], T = bt.trades || [], yrs = qYears(D), ppy = yrs ? Math.max(1, (D.length - 1) / yrs) : QY;
  const r = qRet(eq), sd = qSd(r), dn = Math.sqrt(qMean(r.map(v => Math.min(0, v) ** 2)));
  const cagr = yrs && yrs >= 0.25 && bt.end > 0 ? (bt.end / bt.cap) ** (1 / yrs) - 1 : null, bhCagr = yrs && yrs >= 0.25 && bt.bh > -1 ? (1 + bt.bh) ** (1 / yrs) - 1 : null;
  const Wn = T.filter(t => t.pnl > 0), Ls = T.filter(t => t.pnl <= 0), gw = Wn.reduce((s, t) => s + t.pnl, 0), gl = -Ls.reduce((s, t) => s + t.pnl, 0);
  const avgW = Wn.length ? qMean(Wn.map(t => t.ret)) : null, avgL = Ls.length ? qMean(Ls.map(t => t.ret)) : null;
  let st = 0, maxSt = 0; for (const t of T) { st = t.pnl <= 0 ? st + 1 : 0; maxSt = Math.max(maxSt, st); }
  // 水下時間：資產低於前高的最長根數；回撤超過 10% 的次數
  let peak = -Infinity, uw = 0, maxUw = 0, dd10 = 0, deep = false;
  for (const v of eq) { if (v >= peak) { peak = v; uw = 0; deep = false; } else { uw++; maxUw = Math.max(maxUw, uw); if (!deep && 1 - v / peak >= 0.1) { dd10++; deep = true; } } }
  const held = T.reduce((s, t) => s + Math.max(0, t.xi - t.i), 0), rets = T.map(t => t.ret);
  return { yrs, ppy, cagr, bhCagr, total: bt.total, bh: bt.bh, mdd: bt.mdd, vol: sd * Math.sqrt(ppy),
    sharpe: sd > 0 ? (qMean(r) / sd) * Math.sqrt(ppy) : null, sortino: dn > 0 ? (qMean(r) / dn) * Math.sqrt(ppy) : null, calmar: cagr != null && bt.mdd > 0 ? cagr / bt.mdd : null,
    n: T.length, win: bt.win, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : null, avg: T.length ? qMean(rets) : null, avgW, avgL,
    payoff: avgW != null && avgL != null && avgL < 0 ? avgW / -avgL : null, best: T.length ? Math.max(...rets) : null, worst: T.length ? Math.min(...rets) : null,
    lossStreak: maxSt, uwBars: maxUw, dd10, curDd: eq.length ? 1 - eq[eq.length - 1] / Math.max(...eq) : 0,
    exposure: eq.length ? Math.min(1, held / eq.length) : 0, avgHold: T.length ? held / T.length : null, costs: bt.costs, costPct: bt.cap ? bt.costs / bt.cap : 0 };
}

/* ---------- 2. 行情分類與拆開看 ---------- */
// 每一根當時的行情（只用到那一天的資料）：收盤在 n 日均線之上、且均線 look 根內上升超過 th → 多頭；相反 → 空頭；其他 → 盤整
function regimes(D, n = 60, look = 20, th = 0.01) {
  const m = qSma(D.map(x => x.c), n);
  return D.map((x, i) => { const a = m[i], b = i >= look ? m[i - look] : null; if (a == null || b == null) return null; const s = a / b - 1; return x.c > a && s > th ? "bull" : x.c < a && s < -th ? "bear" : "range"; });
}
const REG_NAME = { bull: "多頭", bear: "空頭", range: "盤整" };
// 交易依「訊號那天」（進場前一根）的行情與波動分組；市場本身在各行情的表現當對照
function btBreakdown(bt, D) {
  const R = regimes(D), A = atrCalc(D, 14), T = bt.trades || [], at = t => Math.max(0, Math.min(D.length - 1, t.i - 1));
  const ap = i => (A[i] && D[i].c ? A[i] / D[i].c : null);
  const grp = key => { const g = {}; for (const t of T) { const k = key(t); if (k == null) continue; (g[k] ||= []).push(t); }
    return Object.fromEntries(Object.entries(g).map(([k, L]) => [k, { n: L.length, win: L.filter(t => t.pnl > 0).length / L.length, avg: qMean(L.map(t => t.ret)), sum: L.reduce((p, t) => p * (1 + t.ret), 1) - 1 }])); };
  const mkt = {}; for (let i = 1; i < D.length; i++) { const k = R[i - 1]; if (!k) continue; const o = (mkt[k] ||= { bars: 0, r: 1 }); o.bars++; o.r *= D[i].c / D[i - 1].c; }
  Object.values(mkt).forEach(o => (o.r -= 1));
  const med = qMed(T.map(t => ap(at(t))));
  const sorted = [...T].sort((a, b) => b.ret - a.ret);
  return { byReg: grp(t => R[at(t)]), mkt, byVol: med == null ? {} : grp(t => { const v = ap(at(t)); return v == null ? null : v > med ? "hi" : "lo"; }), volMed: med,
    best: sorted.slice(0, 3), worst: sorted.slice(-3).reverse().filter(t => t.ret < 0), atrMed: qMed(D.map((_, i) => ap(i))), reg: R, regNow: R[D.length - 1] };
}

/* ---------- 3. 改善試算 ---------- */
// run(sigs, optPatch) 用同一段資料重跑回測；off／Dref：訊號位置在 Dref（完整資料）裡要加 off，用來判斷當時的行情與波動
function btVariants(run, D, sigs, base = {}, off = 0, Dref = D) {
  const R = regimes(Dref), A = atrCalc(Dref, 14), ap = i => (A[i] && Dref[i].c ? A[i] / Dref[i].c : null), med = qMed(Dref.map((_, i) => ap(i))) || 0.02;
  const stopK = +qClamp(2 * med, 0.03, 0.15).toFixed(3), trK = +qClamp(3 * med, 0.05, 0.25).toFixed(3), sigMed = qMed(sigs.filter(s => s.side === "buy").map(s => ap(s.i + off))) ?? med;
  const pc = v => `${(v * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const V = [["base", "原始設定", {}, null],
    ["stop", `加 ${pc(stopK)} 停損（約 2 倍 ATR）`, { stop: stopK }, null],
    ["bull", "只在多頭行情買進", {}, s => s.side !== "buy" || R[s.i + off] === "bull"],
    ["calm", "波動偏高時不買（ATR% 高於中位數）", {}, s => s.side !== "buy" || (ap(s.i + off) ?? 0) <= sigMed],
    ["trail", `移動停利 ${pc(trK)}（約 3 倍 ATR）`, { trail: trK }, null],
    ["half", "每次只用一半資金", { size: "half" }, null]].filter(([k]) => !(k === "half" && base.size === "half") && !(k === "stop" && base.stop) && !(k === "trail" && base.trail));
  return V.map(([key, name, o, f]) => { try { const bt = run(f ? sigs.filter(f) : sigs, o); return { key, name, m: btMetrics(bt, D), n: bt.trades.length }; } catch { return null; } }).filter(Boolean);
}
// 從試算裡挑：降低風險（回撤變小、夏普沒有明顯變差）最多 3 項；提高報酬且不增加風險（報酬變高、回撤沒有變大）最多 2 項
function btAdvice(V) {
  const b = V.find(x => x.key === "base")?.m; if (!b) return { risk: [], ret: [] };
  const alt = V.filter(x => x.key !== "base" && x.n > 0), sh = m => m.sharpe ?? -9;
  const risk = alt.filter(x => x.m.mdd < b.mdd - 0.01 && sh(x.m) >= sh(b) - 0.15).sort((x, y) => x.m.mdd - y.m.mdd).slice(0, 3);
  const ret = alt.filter(x => x.m.total > b.total + 0.005 && x.m.mdd <= b.mdd + 0.005).sort((x, y) => y.m.total - x.m.total).slice(0, 2);
  return { risk, ret };
}
// 失效情境：哪一種行情、波動下平均虧損
function btFails(B) {
  const out = [];
  for (const [k, g] of Object.entries(B.byReg)) if (g.n >= 2 && g.avg < 0) out.push(`${REG_NAME[k]}時進場的 ${g.n} 筆平均 ${(g.avg * 100).toFixed(1)}%（勝率 ${Math.round(g.win * 100)}%）`);
  const h = B.byVol.hi, l = B.byVol.lo;
  if (h && l && h.n >= 2 && l.n >= 2 && Math.abs(h.avg - l.avg) > 0.01) out.push(`波動${h.avg < l.avg ? "偏高" : "偏低"}時表現較差（平均 ${(Math.min(h.avg, l.avg) * 100).toFixed(1)}% 對 ${(Math.max(h.avg, l.avg) * 100).toFixed(1)}%）`);
  return out;
}

/* ---------- 4. 市場狀態 ---------- */
// ADX（Wilder 平滑）：25 以上趨勢明確、20 以下沒有方向
function adxCalc(D, n = 14) {
  const o = Array(D.length).fill(null); if (D.length < 2 * n + 1) return o;
  let tr = 0, pd = 0, nd = 0, adx = null; const dx = [];
  for (let i = 1; i < D.length; i++) {
    const up = D[i].h - D[i - 1].h, dw = D[i - 1].l - D[i].l, t = Math.max(D[i].h - D[i].l, Math.abs(D[i].h - D[i - 1].c), Math.abs(D[i].l - D[i - 1].c));
    const p = up > dw && up > 0 ? up : 0, m = dw > up && dw > 0 ? dw : 0;
    if (i <= n) { tr += t; pd += p; nd += m; if (i < n) continue; } else { tr = tr - tr / n + t; pd = pd - pd / n + p; nd = nd - nd / n + m; }
    const pdi = tr ? (100 * pd) / tr : 0, ndi = tr ? (100 * nd) / tr : 0, x = pdi + ndi ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0;
    if (adx == null) { dx.push(x); if (dx.length === n) adx = qMean(dx); } else adx = (adx * (n - 1) + x) / n;
    if (adx != null) o[i] = adx;
  }
  return o;
}
// o.fast／o.slow：日線 20／60、週線 10／30
function marketState(D, o = {}) {
  const f = o.fast || 20, s = o.slow || 60; if (!D || D.length < s + 12) return null;
  const n = D.length - 1, C = D.map(x => x.c), c = C[n], mf = qSma(C, f), ms = qSma(C, s), slope = ms[n] / ms[n - 10] - 1, ad = adxCalc(D, 14)[n];
  const trend = c > ms[n] && mf[n] > ms[n] && slope > 0 ? "bull" : c < ms[n] && mf[n] < ms[n] && slope < 0 ? "bear" : "range";
  const A = atrCalc(D, 14), ap = A.map((v, i) => (v ? v / D[i].c : null)), hist = ap.slice(-250).filter(v => v != null), now = ap[n];
  const volPct = hist.length && now != null ? hist.filter(v => v <= now).length / hist.length : null, vol = volPct == null ? "mid" : volPct >= 0.8 ? "high" : volPct <= 0.2 ? "low" : "mid";
  // 沒有量的日子（vNa）不算進量比的平均
  const V = D.map(x => x.v || 0), Vk = D.map(x => (x.vNa ? null : x.v || 0)), okV = a => a.filter(v => v != null), hasVol = V.slice(-20).some(v => v > 0), vL = qMean(okV(Vk.slice(-s))), vr = hasVol && vL ? qMean(okV(Vk.slice(-5))) / vL : null;
  let up = 0, dn = 0, nu = 0, nd = 0; for (let i = Math.max(1, n - 19); i <= n; i++) { if (C[i] > C[i - 1]) { up += V[i]; nu++; } else if (C[i] < C[i - 1]) { dn += V[i]; nd++; } }
  const udr = hasVol && nu && nd && dn ? up / nu / (dn / nd) : null;
  let sr = []; try { sr = srLevels(D); } catch {}
  return { c, d: D[n].d, f, s, trend, slope, adx: ad, mf: mf[n], ms: ms[n], atr: A[n], atrPct: now, volPct, vol, hv: qSd(qRet(C.slice(-21))) * Math.sqrt(o.ppy || QY), vr, udr, hasVol, sr };
}
// 適合的策略類型與現在該避免的事（規則對照，不是預測）；strat：可以直接套用到 K 線的策略代號
function stateAdvice(S) {
  const fit = [], avoid = [], t = S.trend, strong = S.adx != null && S.adx >= 25, weak = S.adx != null && S.adx < 20;
  if (t === "bull") { fit.push(["趨勢跟隨：均線多頭排列時拉回到月線附近買、跌破季線出場", "ma"], ["突破策略：創新高且量增時進場", "hlb"]); avoid.push("逆勢放空、只因為「漲多了」就賣光"); if (S.vol === "high") avoid.push("追在長紅 K 之後（波動大，回檔也大）"); }
  else if (t === "bear") { fit.push(["空手或減碼，等反轉訊號（123 法則、2B 底）再進場", "r123"], ["反彈到季線附近減碼", null]); avoid.push("攤平向下買、把反彈當回升", "用超賣指標（RSI、KD 低檔）抄底"); }
  else { fit.push(["區間操作：靠近支撐買、靠近壓力賣", null], ["擺盪指標：RSI、KD 低檔金叉、布林下軌", "kd"]); avoid.push("均線交叉類的趨勢策略（盤整時容易來回被巴）"); if (weak) avoid.push("在區間中間追價"); }
  if (strong && t !== "range") fit.push([`ADX ${S.adx.toFixed(0)}：趨勢明確，順勢操作比猜轉折容易`, null]);
  if (S.vol === "high") { fit.push(["部位縮小、停損放寬到 2～3 倍 ATR", null]); avoid.push("滿倉操作、停損設太近（會被正常波動洗掉）"); }
  if (S.vol === "low") fit.push(["波動收斂：等帶量突破區間再跟（壓縮後常有大行情）", null]);
  if (S.vr != null && S.vr < 0.6) avoid.push("在量縮時追突破（容易假突破）");
  if (S.udr != null && S.udr < 0.8 && t === "bull") avoid.push("忽略量價背離：近 20 天下跌日的量比上漲日大");
  return { fit, avoid };
}

/* ---------- 5. ATR 參考進出場（教學用的設定，不是買賣建議） ---------- */
// 停損：收盤 − 2×ATR；下方 1～3 倍 ATR 內有支撐就放在支撐下方 0.5×ATR。目標：上方第一個至少 1.5 倍 ATR 遠的壓力，沒有就 3×ATR。
// 部位：帳戶 cap × 每筆風險 risk ÷ 每股風險，不超過帳戶能買的數量
function atrSetup(S, cap = 1e6, risk = 0.01, lot = 1) {
  const c = S?.c, a = S?.atr; if (!c || !a) return null;
  const sup = (S.sr || []).filter(x => x.kind === "支撐" && x.price < c - a && x.price > c - 3 * a).sort((x, y) => y.price - x.price)[0];
  const stop = sup ? sup.price - 0.5 * a : c - 2 * a, res = (S.sr || []).filter(x => x.kind === "壓力" && x.price >= c + 1.5 * a).sort((x, y) => x.price - y.price)[0];
  const tgt = res ? res.price : c + 3 * a, per = c - stop; if (!(per > 0) || !(stop > 0)) return null; // 波動比股價還大時（例如剛除權、資料異常）不給設定
  const sh = Math.max(0, Math.floor(Math.min((cap * risk) / per, cap / c) / lot) * lot);
  return { entry: c, stop, tgt, rr: (tgt - c) / per, per, perPct: per / c, sh, amt: sh * c, loss: sh * per, stopBy: sup ? "支撐下方" : "2 倍 ATR", tgtBy: res ? "上方壓力" : "3 倍 ATR" };
}

/* ---------- 總經敏感度：個股日報酬對總經因子（匯率、美債殖利率、費半…）的 Beta 與相關係數 ----------
   D：個股日 K；F：因子日 K。kind "pct"＝用漲跌幅（匯率、指數），"diff"＝用變動量（殖利率，單位是百分點）。
   lag 1：美股收盤在台股收盤之後，台股第 t 天的報酬對應「前一個台股交易日（含）到第 t 天（不含）」之間的美股變動；
   lag 0：同一天（匯率、美股看美股）。兩個台股交易日之間有好幾天因子資料時（連假）合起來算，每天的因子變動只用一次，不會用到未來。 */
function macroBeta(D, F, { kind = "pct", lag = 0, win = 120 } = {}) {
  if (!D?.length || !F?.length) return null;
  const day = x => String(x.d).slice(0, 10), fc = []; for (let i = 1; i < F.length; i++) { const a = F[i - 1].c, b = F[i].c; if (a > 0 && b > 0) fc.push([day(F[i]), kind === "diff" ? b - a : b / a - 1]); }
  const xs = [], ys = []; let j = 0;
  for (let i = 1; i < D.length; i++) {
    const a = D[i - 1].c, b = D[i].c, d0 = day(D[i - 1]), d1 = day(D[i]); if (!(a > 0) || !(b > 0)) continue;
    const inWin = d => (lag ? d >= d0 && d < d1 : d > d0 && d <= d1);
    while (j < fc.length && (lag ? fc[j][0] < d0 : fc[j][0] <= d0)) j++;
    let x = kind === "diff" ? 0 : 1, n = 0; for (let k = j; k < fc.length && inWin(fc[k][0]); k++) { x = kind === "diff" ? x + fc[k][1] : x * (1 + fc[k][1]); n++; }
    if (!n) continue; xs.push(kind === "diff" ? x : x - 1); ys.push(b / a - 1);
  }
  const X = xs.slice(-win), Y = ys.slice(-win), n = X.length; if (n < 40) return null;
  const mx = X.reduce((s, v) => s + v, 0) / n, my = Y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const u = X[i] - mx, w = Y[i] - my; sxy += u * w; sxx += u * u; syy += w * w; }
  return sxx > 0 && syy > 0 ? { beta: sxy / sxx, corr: sxy / Math.sqrt(sxx * syy), n } : null;
}

/* ---------- 6. 投資組合風險 ---------- */
// items：[{ c, mv, D }]（同一個市場的持股，日 K）；bench：大盤日 K。用最近 win 個共同交易日的日報酬
function portRisk(items, bench, win = 120) {
  const ok = items.filter(x => x.mv > 0 && x.D?.length > 30); if (!ok.length) return null;
  const map = D => new Map(D.map(b => [qD10(b.d), b.c])), M = ok.map(x => map(x.D)), B = bench?.length ? map(bench) : null;
  const dates = [...M[0].keys()].filter(d => M.every(m => m.has(d)) && (!B || B.has(d))).sort().slice(-(win + 1));
  if (dates.length < 30) return { short: true, n: dates.length };
  const ret = m => dates.slice(1).map((d, i) => m.get(d) / m.get(dates[i]) - 1), R = M.map(ret), Rb = B ? ret(B) : null;
  const tot = ok.reduce((s, x) => s + x.mv, 0), w = ok.map(x => x.mv / tot), Rp = R[0].map((_, t) => R.reduce((s, r, k) => s + w[k] * r[t], 0)), vp = qSd(Rp) ** 2;
  const beta = (a, b) => { const v = qSd(b) ** 2; return v > 0 ? qCov(a, b) / v : null; };
  const rows = ok.map((x, k) => ({ c: x.c, mv: x.mv, w: w[k], vol: qSd(R[k]) * Math.sqrt(QY), beta: Rb ? beta(R[k], Rb) : null, ctr: vp > 0 ? (w[k] * qCov(R[k], Rp)) / vp : w[k] })).sort((a, b) => b.w - a.w);
  const C = R.map(a => R.map(b => qCorr(a, b))), pairs = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) pairs.push({ a: ok[i].c, b: ok[j].c, r: C[i][j] });
  pairs.sort((a, b) => b.r - a.r);
  const off = pairs.length ? qMean(pairs.map(p => p.r)) : null, hhi = w.reduce((s, v) => s + v * v, 0), pBeta = Rb ? beta(Rp, Rb) : null;
  // 歷史壓力：這段期間大盤最差的連續 20 個交易日，組合同期表現
  let worst = null; if (Rb && Rb.length > 20) for (let i = 0; i + 20 <= Rb.length; i++) { const b = Rb.slice(i, i + 20).reduce((p, v) => p * (1 + v), 1) - 1; if (!worst || b < worst.b) worst = { b, p: Rp.slice(i, i + 20).reduce((p, v) => p * (1 + v), 1) - 1, from: dates[i], to: dates[i + 20] }; }
  const srt = [...Rp].sort((a, b) => a - b);
  return { n: dates.length - 1, from: dates[0], to: dates[dates.length - 1], tot, rows, codes: ok.map(x => x.c), C, pairs, avgCorr: off, hhi, effN: 1 / hhi, top: rows[0],
    vol: Math.sqrt(vp * QY), beta: pBeta, var95: srt[Math.floor(srt.length * 0.05)] ?? null, worst, stress: pBeta != null ? pBeta * -0.2 : null,
    stressRows: rows.map(r => ({ c: r.c, loss: r.mv * (r.beta ?? 1) * -0.2 })) };
}
// 依風險承受度：單一持股上限、目標 Beta；超過就建議減碼，Beta 太高就試算反向 ETF 的避險金額
const RISK_TOL = { low: ["保守", 0.15, 0.6], mid: ["穩健", 0.25, 0.85], high: ["積極", 0.4, 1.1] };
const RISK_TOL_OK = k => (RISK_TOL[k] ? k : "mid");
function portPlan(P, tol = "mid") {
  const [, cap, tb] = RISK_TOL[tol] || RISK_TOL.mid, trims = P.rows.filter(r => r.w > cap).map(r => ({ c: r.c, w: r.w, cut: (r.w - cap) * P.tot }));
  const hedge = P.beta != null && P.beta > tb ? (P.beta - tb) * P.tot : 0, pairs = P.pairs.filter(p => p.r >= 0.7).slice(0, 5);
  return { cap, tb, trims, hedge, pairs, after: P.stress != null ? Math.min(P.beta, tb) * -0.2 : null };
}

/* ---------- 7. 多因子 ---------- */
const FACTORS = [["mom", "動能", "近 60 日漲幅（扣掉最近 5 日，避開短線反轉）"], ["value", "價值", "盈餘殖利率（本益比的倒數）；虧損或沒有本益比給中間分"],
  ["lowvol", "低波動", "近 60 日每日漲跌的標準差，越小分數越高"], ["trend", "趨勢", "收盤在 60 日均線之上多少，加上均線 10 日的斜率"]];
const FACTOR_W0 = { mom: 30, value: 25, lowvol: 20, trend: 25 };
// 第 n 根為止的原始因子（至少要 70 根）；val：{ pe }
function factorRaw(D, n = D.length - 1, val = null) {
  if (!D || n < 70) return null; const C = D.map(x => x.c);
  const ma = qMean(C.slice(n - 59, n + 1)), ma0 = qMean(C.slice(n - 69, n - 9));
  return { mom: C[n - 5] / C[n - 65] - 1, lowvol: -qSd(qRet(C.slice(n - 60, n + 1))), trend: C[n] / ma - 1 + (ma / ma0 - 1), value: val?.pe > 0 ? 1 / val.pe : null };
}
// rows：[{ f }] → 每個因子在這群裡的百分位（0～100，沒有資料給 50）與加權總分；回傳依總分排序
function factorScore(rows, wts = FACTOR_W0) {
  const keys = FACTORS.map(x => x[0]), tw = keys.reduce((s, k) => s + (+wts[k] || 0), 0) || 1;
  const sorted = Object.fromEntries(keys.map(k => [k, rows.map(r => r.f?.[k]).filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b)]));
  const pr = (k, v) => { const a = sorted[k]; if (v == null || !Number.isFinite(v) || a.length < 2) return 50; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } let eq = 0; for (let i = lo; i < a.length && a[i] === v; i++) eq++; return Math.round(((lo + eq / 2) / a.length) * 100); };
  for (const r of rows) { r.s = Object.fromEntries(keys.map(k => [k, pr(k, r.f?.[k])])); r.score = Math.round(keys.reduce((s, k) => s + (+wts[k] || 0) * r.s[k], 0) / tw); }
  return rows.sort((a, b) => b.score - a.score);
}
// 每 hold 個交易日再平衡：用當天為止的資料算分（歷史本益比沒有，價值因子不算），買前 top 名等權重，持有到下次；和同一群股票等權重比
function factorBacktest(series, wts = FACTOR_W0, { hold = 21, top = 10 } = {}) {
  const S = series.filter(s => s.D?.length > 75).map(s => ({ ...s, idx: new Map(s.D.map((b, i) => [qD10(b.d), i])) })); if (S.length < 4) return null;
  const axis = [...new Set(S.flatMap(s => s.D.map(b => qD10(b.d))))].sort(), w2 = { ...wts, value: 0 }, per = [], N = Math.min(top, Math.floor(S.length / 2));
  for (let t = 70; t + hold < axis.length; t += hold) {
    const rows = S.map(s => { const k = s.idx.get(axis[t]), k2 = s.idx.get(axis[t + hold]); if (k == null || k2 == null || k < 70) return null; const f = factorRaw(s.D, k); return f ? { c: s.c, f, fwd: s.D[k2].c / s.D[k].c - 1 } : null; }).filter(Boolean);
    if (rows.length < N * 2) continue;
    const pick = factorScore(rows, w2).slice(0, N);
    per.push({ d: axis[t], to: axis[t + hold], ret: qMean(pick.map(r => r.fwd)), all: qMean(rows.map(r => r.fwd)), n: rows.length, codes: pick.map(r => r.c) });
  }
  if (!per.length) return { per, short: true, days: axis.length };
  const cum = k => per.reduce((p, x) => p * (1 + x[k]), 1) - 1, ex = per.map(x => x.ret - x.all);
  return { per, top: N, hold, ret: cum("ret"), all: cum("all"), hit: per.filter(x => x.ret > x.all).length / per.length, ex: qMean(ex), days: axis.length };
}

/* ======================= 畫面片段（兩個頁面共用；樣式在 core.css 的 .qx-*） ======================= */
const qEsc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const qP = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const qC = v => (v > 0 ? "up" : v < 0 ? "down" : "");
const qX = (v, d = 2) => (v == null ? "—" : v === Infinity ? "∞" : v.toFixed(d));
const qPx = v => (v == null ? "—" : typeof fmtP === "function" ? fmtP(v) : v.toFixed(2));
// 指標卡：k 名稱、v 數值、s 說明、c 顏色
const qCards = L => `<div class="qx-cards">${L.map(([k, v, s, c = ""]) => `<div><span>${k}</span><b class="${c}">${v}</b>${s ? `<small>${s}</small>` : ""}</div>`).join("")}</div>`;
// 回測完整報告：績效指標、風險卡、行情拆解、改善試算、AI 解讀按鈕；ai：{ key, R }（R＝AI 回覆狀態）
function btReportHtml(bt, M, B, V, opt = {}) {
  if (!bt?.trades?.length) return `<p class="note">回測期間裡沒有成交，沒有績效可以分析。</p>`;
  const dd = M.yrs ? `約 ${(M.uwBars / (M.ppy / 12)).toFixed(1)} 個月` : `${M.uwBars} 根`;
  let h = `<h4 class="qx-h">績效指標 <span class="note">${M.yrs ? `${M.yrs.toFixed(1)} 年・` : ""}${M.n} 筆交易</span></h4>` + qCards([
    ["年化報酬", M.cagr != null ? qP(M.cagr) : qP(M.total), M.cagr != null ? `總報酬 ${qP(M.total)}` : "期間不到 3 個月，不年化", qC(M.cagr ?? M.total)],
    ["買進持有年化", M.bhCagr != null ? qP(M.bhCagr) : qP(M.bh), "同期抱著不動", qC(M.bhCagr ?? M.bh)],
    ["夏普比率", qX(M.sharpe), M.sharpe == null ? "" : M.sharpe >= 1 ? "好（≥ 1）" : M.sharpe >= 0.5 ? "普通" : "偏低（< 0.5）"],
    ["索提諾", qX(M.sortino), "只算下跌的波動"],
    ["最大回撤", M.mdd ? `−${(M.mdd * 100).toFixed(1)}%` : "0%", `最長 ${dd} 沒創新高`, "down"],
    ["卡瑪比率", qX(M.calmar), "年化 ÷ 最大回撤"],
    ["勝率", M.win == null ? "—" : `${Math.round(M.win * 100)}%`, `${M.n} 筆`],
    ["獲利因子", qX(M.pf), "總賺 ÷ 總賠，> 1.5 較好"],
    ["平均每筆", qP(M.avg, 2), `賺 ${qP(M.avgW)}・賠 ${qP(M.avgL)}`, qC(M.avg)],
    ["賺賠比", qX(M.payoff), "平均賺 ÷ 平均賠"],
    ["持倉時間", `${Math.round(M.exposure * 100)}%`, M.avgHold != null ? `平均每筆 ${M.avgHold.toFixed(0)} 根` : ""],
    ["交易成本", qP(-M.costPct), "手續費＋稅佔本金"]]);
  // 風險卡
  h += `<h4 class="qx-h">風險報酬拆解</h4><ul class="qx-list">
    <li><b>單筆風險</b><span>平均虧損 ${qP(M.avgL)}，最差一筆 ${qP(M.worst)}；${M.worst != null && M.worst < -0.1 ? "單筆虧到 10% 以上，建議加停損。" : "單筆虧損控制在 10% 以內。"}</span></li>
    <li><b>報酬風險比</b><span>賺賠比 ${qX(M.payoff)}${M.win != null && M.payoff != null ? `，打平需要的勝率約 ${Math.round(100 / (1 + M.payoff))}%（目前 ${Math.round(M.win * 100)}%）` : ""}。</span></li>
    <li><b>回撤型態</b><span>最大回撤 ${(M.mdd * 100).toFixed(1)}%，回撤超過 10% 有 ${M.dd10} 次，最多連續虧 ${M.lossStreak} 筆；目前離高點 ${(M.curDd * 100).toFixed(1)}%。</span></li></ul>`;
  // 行情拆解
  const reg = Object.entries(B.byReg);
  if (reg.length) h += `<h4 class="qx-h">在不同行情的表現 <span class="note">依訊號那天的行情分組；季線（60 日均線）上揚且收盤在上＝多頭</span></h4><div class="qx-tbl"><table><thead><tr><th>行情</th><th>筆數</th><th>勝率</th><th>平均每筆</th><th>同期大盤（這檔）</th></tr></thead><tbody>${["bull", "range", "bear"].filter(k => B.byReg[k] || B.mkt[k]).map(k => { const g = B.byReg[k], m = B.mkt[k];
      return `<tr><td>${REG_NAME[k]}</td><td>${g?.n ?? 0}</td><td>${g ? Math.round(g.win * 100) + "%" : "—"}</td><td class="${qC(g?.avg)}">${g ? qP(g.avg, 2) : "—"}</td><td class="${qC(m?.r)}">${m ? `${qP(m.r)}<small class="note">（${m.bars} 根）</small>` : "—"}</td></tr>`; }).join("")}</tbody></table></div>`;
  const fails = btFails(B);
  h += `<ul class="qx-list">${B.best.length ? `<li><b>表現最好</b><span>${B.best.map(t => `${qD10(opt.D?.[t.i]?.d).slice(2)} 進場 ${qP(t.ret)}`).join("、")}</span></li>` : ""}${B.worst.length ? `<li><b>表現最差</b><span>${B.worst.map(t => `${qD10(opt.D?.[t.i]?.d).slice(2)} 進場 ${qP(t.ret)}${t.why && t.why !== "訊號" ? `（${qEsc(t.why)}）` : ""}`).join("、")}</span></li>` : ""}
    <li><b>容易失效</b><span>${fails.length ? fails.map(qEsc).join("；") : "交易筆數太少，或各種行情的表現差不多，看不出明顯的失效情境。"}</span></li></ul>`;
  // 改善試算
  if (V?.length > 1) { const A = btAdvice(V), b = V[0].m;
    h += `<h4 class="qx-h">改善試算 <span class="note">同一段資料、同一組訊號換風險控制；是「事後」比較，真的要用請換一段時間再驗證（實驗室有滾動驗證）</span></h4><div class="qx-tbl"><table><thead><tr><th>做法</th><th>總報酬</th><th>年化</th><th>夏普</th><th>最大回撤</th><th>勝率</th><th>筆數</th></tr></thead><tbody>${V.map(x => `<tr class="${x.key === "base" ? "qx-base" : ""}"><td>${qEsc(x.name)}</td><td class="${qC(x.m.total)}">${qP(x.m.total)}</td><td class="${qC(x.m.cagr)}">${qP(x.m.cagr)}</td><td class="${x.key !== "base" && (x.m.sharpe ?? -9) > (b.sharpe ?? -9) + 0.05 ? "up" : ""}">${qX(x.m.sharpe)}</td><td class="${x.key !== "base" && x.m.mdd < b.mdd - 0.005 ? "up" : x.key !== "base" && x.m.mdd > b.mdd + 0.005 ? "down" : ""}">−${(x.m.mdd * 100).toFixed(1)}%</td><td>${x.m.win == null ? "—" : Math.round(x.m.win * 100) + "%"}</td><td>${x.n}</td></tr>`).join("")}</tbody></table></div>
      <ul class="qx-list"><li><b>降低風險</b><span>${A.risk.length ? A.risk.map(x => `${qEsc(x.name)}：回撤 ${(b.mdd * 100).toFixed(1)}% → ${(x.m.mdd * 100).toFixed(1)}%`).join("；") : "試算的做法都沒有在不犧牲太多報酬下降低回撤。"}</span></li>
      <li><b>提高報酬（不增加回撤）</b><span>${A.ret.length ? A.ret.map(x => `${qEsc(x.name)}：報酬 ${qP(b.total)} → ${qP(x.m.total)}`).join("；") : "沒有找到不增加回撤又能提高報酬的做法。"}</span></li></ul>`; }
  if (opt.ai) h += qAiBlock(opt.ai, `${ico("ai")}AI 解讀這份回測`);
  return h;
}
// AI 區塊：{ key, R }；R＝undefined（還沒問）、{ loading }、{ err }、{ text }
function qAiBlock({ key, R }, label = `${ico("ai")}問 AI`) {
  return `<div class="qx-ai">${!R || R.err ? `<button type="button" class="btn sm" data-qai="${qEsc(key)}">${R?.err ? "再試一次" : label}</button>${R?.err ? ` <span class="note">⚠︎ ${qEsc(R.err)}</span>` : ""}`
    : R.loading ? `<p class="note">AI 整理中（約 10～30 秒）…</p>` : `<div class="qx-aitxt">${qEsc(R.text).replace(/\n/g, "<br>")}</div><p class="note">AI 只根據上面算出來的數字解讀，可能有誤，不是買賣建議。</p>`}</div>`;
}
// 回測報告轉成文字（給 AI 當資料）
function btReportText(M, B, V, name = "") {
  const L = [`策略：${name}`, `期間 ${M.yrs ? M.yrs.toFixed(1) + " 年" : "不到一個月"}、${M.n} 筆交易`, `總報酬 ${qP(M.total)}、年化 ${qP(M.cagr)}、買進持有 ${qP(M.bh)}（年化 ${qP(M.bhCagr)}）`,
    `夏普 ${qX(M.sharpe)}、索提諾 ${qX(M.sortino)}、最大回撤 ${(M.mdd * 100).toFixed(1)}%、卡瑪 ${qX(M.calmar)}、波動 ${qP(M.vol)}`,
    `勝率 ${M.win == null ? "—" : Math.round(M.win * 100) + "%"}、獲利因子 ${qX(M.pf)}、平均每筆 ${qP(M.avg, 2)}（賺 ${qP(M.avgW)}／賠 ${qP(M.avgL)}）、賺賠比 ${qX(M.payoff)}、最差一筆 ${qP(M.worst)}、最多連虧 ${M.lossStreak} 筆、持倉時間 ${Math.round(M.exposure * 100)}%、成本佔本金 ${qP(M.costPct)}`,
    ...Object.entries(B.byReg).map(([k, g]) => `${REG_NAME[k]}時進場 ${g.n} 筆：勝率 ${Math.round(g.win * 100)}%、平均 ${qP(g.avg, 2)}`),
    ...(V || []).map(x => `試算「${x.name}」：總報酬 ${qP(x.m.total)}、夏普 ${qX(x.m.sharpe)}、回撤 ${(x.m.mdd * 100).toFixed(1)}%、${x.n} 筆`)];
  return L.join("\n");
}
// 市場狀態卡（個股頁「市場狀態」）：S＝marketState 結果，tf＝「日線」「週線」
function stateHtml(S, tf, setup, opt = {}) {
  if (!S) return `<p class="note">${tf}資料不足（需要約 ${tf === "週線" ? "1 年半的日 K" : "4 個月的日 K"}）。</p>`;
  const T = { bull: ["多頭", "up"], bear: ["空頭", "down"], range: ["盤整", ""] }[S.trend], adv = stateAdvice(S), V = { high: "偏高", mid: "正常", low: "偏低" }[S.vol];
  const sr = S.sr || [], up = sr.filter(x => x.kind === "壓力").sort((a, b) => a.price - b.price), dn = sr.filter(x => x.kind === "支撐").sort((a, b) => b.price - a.price);
  let h = `<div class="qx-state"><div class="qx-badge ${T[1]}">${T[0]}</div><div><b>${tf}・${T[0]}${S.adx != null ? `（ADX ${S.adx.toFixed(0)}，${S.adx >= 25 ? "趨勢明確" : S.adx < 20 ? "沒有明確方向" : "趨勢普通"}）` : ""}</b>
    <small class="note">收盤 ${qPx(S.c)}；${S.f} 均 ${qPx(S.mf)}、${S.s} 均 ${qPx(S.ms)}（${S.slope >= 0 ? "上揚" : "下彎"} ${qP(S.slope)}）</small></div></div>`;
  h += qCards([["波動", V, `ATR ${qPx(S.atr)}（${qP(S.atrPct, 2).replace("+", "")}），在近一年的第 ${S.volPct == null ? "—" : Math.round(S.volPct * 100)} 百分位`, S.vol === "high" ? "down" : ""],
    ["量能", S.vr == null ? "—" : S.vr >= 1.3 ? "放量" : S.vr <= 0.7 ? "量縮" : "持平", S.vr == null ? "沒有成交量" : `5 日均量是 ${S.s} 日均量的 ${S.vr.toFixed(2)} 倍`],
    ["量價", S.udr == null ? "—" : S.udr >= 1.2 ? "價漲量增" : S.udr <= 0.8 ? "跌時量大" : "沒有明顯差別", S.udr == null ? "" : `近 20 根上漲日平均量 ÷ 下跌日 ＝ ${S.udr.toFixed(2)}`, S.udr >= 1.2 ? "up" : S.udr <= 0.8 ? "down" : ""],
    ["支撐／壓力", `${dn[0] ? qPx(dn[0].price) : "—"}／${up[0] ? qPx(up[0].price) : "—"}`, `${dn[0] ? `支撐 ${qP(dn[0].price / S.c - 1)}` : "下方沒有明顯支撐"}・${up[0] ? `壓力 ${qP(up[0].price / S.c - 1)}` : "上方沒有明顯壓力"}`]]);
  h += `<div class="qx-adv"><div><h5>適合的策略類型</h5><ul>${adv.fit.map(([t, k]) => `<li>${qEsc(t)}${k && opt.stratBtn ? ` <button type="button" class="linkbtn" data-qstrat="${k}">在 K 線上看 ›</button>` : ""}</li>`).join("")}</ul></div><div><h5>現在應避免</h5><ul>${adv.avoid.map(t => `<li>${qEsc(t)}</li>`).join("") || "<li class='note'>沒有特別要避免的</li>"}</ul></div></div>`;
  if (setup) h += setupHtml(setup, S, opt);
  return h;
}
// 市場狀態轉成文字（給 AI 當資料）
function stateText(S, tf, X) {
  if (!S) return `${tf}：資料不足`;
  const adv = stateAdvice(S), sr = (S.sr || []).map(x => `${x.kind} ${qPx(x.price)}（${qP(x.price / S.c - 1)}）`).join("、") || "沒有明顯的";
  return [`【${tf}】收盤 ${qPx(S.c)}（${qD10(S.d)}）；趨勢 ${REG_NAME[S.trend]}；${S.f} 均 ${qPx(S.mf)}、${S.s} 均 ${qPx(S.ms)}（${S.s} 均 10 根${S.slope >= 0 ? "上揚" : "下彎"} ${qP(S.slope)}）；ADX ${S.adx == null ? "—" : S.adx.toFixed(0)}`,
    `波動：ATR ${qPx(S.atr)}（股價的 ${(S.atrPct * 100).toFixed(2)}%），近一年第 ${S.volPct == null ? "—" : Math.round(S.volPct * 100)} 百分位；近 20 根年化波動 ${(S.hv * 100).toFixed(0)}%`,
    `量能：5 日均量是 ${S.s} 日均量的 ${S.vr == null ? "—" : S.vr.toFixed(2)} 倍；近 20 根上漲日平均量 ÷ 下跌日 ${S.udr == null ? "—" : S.udr.toFixed(2)}`, `支撐壓力：${sr}`,
    `規則對照：適合 ${adv.fit.map(x => x[0]).join("；")}；避免 ${adv.avoid.join("；") || "無"}`,
    ...(X ? [`ATR 參考設定：進場 ${qPx(X.entry)}、停損 ${qPx(X.stop)}（${X.stopBy}）、目標 ${qPx(X.tgt)}（${X.tgtBy}）、報酬風險比 ${X.rr.toFixed(2)}`] : [])].join("\n");
}
function setupHtml(X, S, opt = {}) {
  const bear = S.trend === "bear";
  return `<h5 class="qx-h">ATR 參考設定 <span class="note">教學用：示範怎麼用波動決定停損、目標與部位，不是買賣建議</span></h5>
    ${bear ? `<p class="note">⚠︎ 目前是空頭，順勢的做法是不做多；下面只示範計算方式。</p>` : ""}
    ${qCards([["參考進場", qPx(X.entry), "最新收盤"], ["停損", qPx(X.stop), `${X.stopBy}（−${(X.perPct * 100).toFixed(1)}%）`, "down"], ["目標", qPx(X.tgt), `${X.tgtBy}（${qP(X.tgt / X.entry - 1)}）`, "up"],
      ["報酬風險比", `${X.rr.toFixed(2)} : 1`, X.rr >= 2 ? "≥ 2，划算" : X.rr >= 1.5 ? "普通" : "< 1.5，不划算", X.rr >= 2 ? "up" : X.rr < 1.5 ? "down" : ""]])}
    ${opt.sizeForm ? `<div class="qx-size">${opt.sizeForm}<span>每筆最多虧 <b>${Math.round(X.loss).toLocaleString()}</b> 元 → 最多買 <b>${X.sh.toLocaleString()}</b> 股（約 ${Math.round(X.amt).toLocaleString()} 元）</span></div>` : ""}`;
}
