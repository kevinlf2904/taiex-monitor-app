"use strict";
/* K線學堂共用核心：工具函式、技術指標、指標開關、副圖訊號與 K 線圖（Chart）。
   learner/index.html（K線學堂）與 learner/watch.html（看盤）共用；一般 <script> 載入，定義在全域。 */
/* ================= 工具 ================= */
const $ = (s, r = document) => r.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("kline:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kline:" + k, JSON.stringify(v)); } catch {} },
};
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// 台股升降單位（檔位）
function tickOf(p) { return p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5; }
function roundTick(p) { const t = tickOf(p); return +(Math.round(p / t) * t).toFixed(2); }
function fmtP(p) { if (p == null) return "—"; const t = tickOf(p); return p.toFixed(t < 0.1 ? 2 : t < 1 ? 1 : 0); }
function fmtPct(x, d = 2) { return (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%"; }
function fmtN(x, d = 1) { return x == null ? "—" : x.toFixed(d); }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

/* ================= 指標 ================= */
function sma(a, n) { const o = Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function ema(a, n) { const o = Array(a.length).fill(null); const k = 2 / (n + 1); let e = null; for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; e = e == null ? a[i] : a[i] * k + e * (1 - k); o[i] = e; } return o; }
function rsiCalc(c, n = 14) {
  const o = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); }
  }
  return o;
}
function kdCalc(D, n = 9) {
  const K = Array(D.length).fill(null), Dd = Array(D.length).fill(null); let k = 50, d = 50;
  for (let i = n - 1; i < D.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, D[j].h); ll = Math.min(ll, D[j].l); }
    const rsv = hh === ll ? 50 : (D[i].c - ll) / (hh - ll) * 100;
    k = k * 2 / 3 + rsv / 3; d = d * 2 / 3 + k / 3; K[i] = k; Dd[i] = d;
  }
  return { K, D: Dd };
}
function macdCalc(c) {
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const dif = c.map((_, i) => i < 25 ? null : e12[i] - e26[i]);
  const sig = ema(dif, 9).map((v, i) => i < 33 ? null : v);
  const osc = dif.map((v, i) => sig[i] == null ? null : v - sig[i]);
  return { dif, sig, osc };
}
function bollCalc(c, n = 20, k = 2) {
  const mid = sma(c, n), up = [], lo = [], bw = [];
  for (let i = 0; i < c.length; i++) {
    if (mid[i] == null) { up.push(null); lo.push(null); bw.push(null); continue; }
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n); up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd); bw.push(2 * k * sd / mid[i]);
  }
  return { mid, up, lo, bw };
}
// 威廉指標 %R：收盤距離 n 日最高價的位置，0 到 −100
function wrCalc(D, n = 14) {
  const o = Array(D.length).fill(null);
  for (let i = n - 1; i < D.length; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, D[j].h); ll = Math.min(ll, D[j].l); } o[i] = hh === ll ? -50 : (hh - D[i].c) / (hh - ll) * -100; }
  return o;
}
// VWAP（成交量加權平均價）：典型價 (高+低+收)/3 依成交量加權。
// 分 K（日期欄有時間）每天開盤重新累計，就是當日均價線；日／週／月 K 用最近 20 根滾動計算（20 期 VWAP）。
function vwapCalc(D, n = 20) {
  const o = Array(D.length).fill(null), intraday = D.length && /\s\d{1,2}:\d{2}/.test(D[0].d);
  if (intraday) { let day = null, pv = 0, v = 0; D.forEach((x, i) => { const d = x.d.split(" ")[0]; if (d !== day) { day = d; pv = 0; v = 0; } const tp = (x.h + x.l + x.c) / 3, w = x.v || 0; pv += tp * w; v += w; o[i] = v ? pv / v : tp; }); return o; }
  for (let i = n - 1; i < D.length; i++) { let pv = 0, v = 0; for (let j = i - n + 1; j <= i; j++) { const w = D[j].v || 0; pv += (D[j].h + D[j].l + D[j].c) / 3 * w; v += w; } o[i] = v ? pv / v : null; }
  return o;
}
// 籌碼分佈（成本分佈／Volume Profile）：把 [a, b] 每根 K 棒的成交量依典型價附近分到各價位，越早的權重越低（每天衰減 3%）。
// 回傳各價位的量、目前價、獲利比例、平均成本、支撐（目前價以下量最多的價位）、壓力（以上量最多的價位）、70%／90% 籌碼區間。
function costDist(D, b = D.length - 1, n = 120, bins = 60, decay = 0.97) {
  const a = Math.max(0, b - n + 1), L = D.slice(a, b + 1); if (L.length < 10) return null;
  const lo = Math.min(...L.map(x => x.l)), hi = Math.max(...L.map(x => x.h)); if (!(hi > lo)) return null;
  const step = (hi - lo) / bins, w = Array(bins).fill(0), mids = w.map((_, k) => lo + (k + 0.5) * step);
  L.forEach((x, i) => {
    const wt = (x.v || 1) * Math.pow(decay, L.length - 1 - i), ka = Math.max(0, Math.floor((x.l - lo) / step)), kb = Math.min(bins - 1, Math.floor((x.h - lo) / step)), tp = (x.h + x.l + x.c) / 3, half = (x.h - x.l) / 2 || step;
    const fs = []; for (let k = ka; k <= kb; k++) fs.push(1 / (1 + Math.abs(mids[k] - tp) / half)); const tot = fs.reduce((s, f) => s + f, 0) || 1;
    fs.forEach((f, j) => (w[ka + j] += wt * f / tot));
  });
  const px = D[b].c, total = w.reduce((s, x) => s + x, 0) || 1;
  let sup = -1, pre = -1; w.forEach((x, k) => { if (mids[k] <= px) { if (sup < 0 || x > w[sup]) sup = k; } else if (pre < 0 || x > w[pre]) pre = k; });
  // 以平均成本為中心向兩側擴張，直到涵蓋 p 的籌碼
  const avg = w.reduce((s, x, k) => s + x * mids[k], 0) / total;
  const range = p => { let i = Math.max(0, Math.min(bins - 1, Math.floor((avg - lo) / step))), j = i, acc = w[i]; while (acc / total < p && (i > 0 || j < bins - 1)) { if (j >= bins - 1 || (i > 0 && w[i - 1] >= w[j + 1])) acc += w[--i]; else acc += w[++j]; } return [mids[i] - step / 2, mids[j] + step / 2]; };
  const r90 = range(0.9), r70 = range(0.7);
  return { w, mids, step, lo, hi, px, d: D[b].d, profit: w.reduce((s, x, k) => s + (mids[k] <= px ? x : 0), 0) / total, avg, sup: sup >= 0 ? mids[sup] : null, pre: pre >= 0 ? mids[pre] : null, r90, r70, overlap: (r70[1] - r70[0]) / ((r90[1] - r90[0]) || 1) };
}
function indicators(D) {
  const c = D.map(x => x.c), cache = {};
  return {
    c,
    ma: n => cache[n] || (cache[n] = sma(c, n)),
    vma: sma(D.map(x => x.v), 20),
    rsi: rsiCalc(c), kd: kdCalc(D), macd: macdCalc(c), boll: bollCalc(c), wr: wrCalc(D),
    get vwap() { return cache.vwap || (cache.vwap = vwapCalc(D)); },
    ...(() => { if (D[0].ov == null) return { io: null, io5: null }; const io = D.map(x => { const t = x.iv != null ? x.ov + x.iv : x.v; return t ? x.ov / t * 100 : 50; }); /* 外盤比＝外盤 ÷（外盤＋內盤），無法歸類的量不算進分母 */ return { io, io5: sma(io, 5) }; })(),
  };
}


/* ================= 圖表 ================= */
/* ---------- 技術指標開關 ----------
   一排可切換的小籤，分成「主圖」「副圖」兩組；狀態記在瀏覽器裡，下次打開還在。 */
function indicatorBar(host, key, groups, defaults, onChange) {
  let state = new Set(store.get("ind:" + key, defaults));
  const render = () => {
    host.innerHTML = groups.map(g => `<div class="ibar-g" role="group" aria-label="${g.title}"><span class="ibar-t">${g.title}</span>${g.items.map(it =>
      `<button type="button" class="ichip" data-id="${it.id}" aria-pressed="${state.has(it.id)}">${it.color ? `<i style="background:var(${it.color})"></i>` : ""}${it.label}</button>`).join("")}</div>`).join("");
  };
  host.addEventListener("click", e => {
    const b = e.target.closest("[data-id]"); if (!b) return;
    const id = b.dataset.id; state.has(id) ? state.delete(id) : state.add(id);
    store.set("ind:" + key, [...state]); render(); onChange(state);
  });
  render();
  return { has: id => state.has(id), get state() { return state; }, set(id, on) { on ? state.add(id) : state.delete(id); render(); }, setGroups(g) { groups = g; render(); } };
}
const MAIN_ITEMS = [{ id: "ma5", label: "MA5", color: "--s1" }, { id: "ma10", label: "MA10", color: "--accent" }, { id: "ma20", label: "MA20", color: "--s2" }, { id: "ma60", label: "MA60", color: "--s3" }, { id: "boll", label: "布林" }, { id: "vwap", label: "VWAP", color: "--vwap" }, { id: "vp", label: "籌碼分佈" }];
// 主圖選項：均線、布林、VWAP、籌碼分佈（Volume Profile）
const mainOpts = bar => ({ ma: maFrom(bar), boll: bar.has("boll"), vwap: bar.has("vwap"), vp: bar.has("vp") });
const SUB_ITEMS = [{ id: "vol", label: "成交量" }, { id: "kd", label: "KD" }, { id: "rsi", label: "RSI" }, { id: "macd", label: "MACD" }, { id: "wr", label: "威廉" }];
const maFrom = bar => [5, 10, 20, 60].filter(p => bar.has("ma" + p));
const subsFrom = (bar, ids = ["kd", "rsi", "macd", "wr", "inout"]) => ids.filter(id => bar.has(id));

// 副圖指標發出的訊號：{ i, si（第幾個副圖）, side, label, v（副圖上的位置） }
// strong：KD 只留低檔（D < 20）的金叉、高檔（D > 80）的死叉（和 KD 課程、策略用的門檻一致）；MACD 只留零軸上方的金叉、零軸下方的死叉（順勢的交叉）
function subSignals(D, I, subs, vis, kinds = {}, strong = false) {
  const out = [], n = Math.min(vis, D.length), st = k => (typeof strong === "object" ? !!strong?.[k] : !!strong); // strong 可以是 { kd, macd } 各自設定
  const cross = (a, b, si, up, dn, keep = () => true) => { for (let i = 1; i < n; i++) { if ([a[i], b[i], a[i - 1], b[i - 1]].some(v => v == null) || D[i].sim) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i] && keep("buy", b[i])) out.push({ i, si, side: "buy", label: up, v: a[i] });
    else if (a[i - 1] >= b[i - 1] && a[i] < b[i] && keep("sell", b[i])) out.push({ i, si, side: "sell", label: dn, v: a[i] }); } };
  const exit = (a, lo, hi, si, name) => { for (let i = 1; i < n; i++) { if (a[i] == null || a[i - 1] == null || D[i].sim) continue;
    if (a[i - 1] < lo && a[i] >= lo) out.push({ i, si, side: "buy", label: name + "脫離超賣", v: a[i] });
    else if (a[i - 1] > hi && a[i] <= hi) out.push({ i, si, side: "sell", label: name + "脫離超買", v: a[i] }); } };
  subs.forEach((S, si) => {
    if (kinds[typeof S === "string" ? S : "custom"] === false) return;
    if (S === "kd") cross(I.kd.K, I.kd.D, si, "KD金叉", "KD死叉", st("kd") ? (side, d) => (side === "buy" ? d < 20 : d > 80) : undefined);
    else if (S === "macd") cross(I.macd.dif, I.macd.sig, si, "MACD金叉", "MACD死叉", st("macd") ? (side, m) => (side === "buy" ? m > 0 : m < 0) : undefined);
    else if (S === "rsi") exit(I.rsi, 30, 70, si, "RSI");
    else if (S === "wr") exit(I.wr, -80, -20, si, "威廉");
    else if (S && S.custom && S.custom.lines.length >= 2 && S.custom.signals !== false) { const [a, b] = S.custom.names || []; cross(S.custom.lines[0], S.custom.lines[1], si, a && b ? `${a}上穿${b}` : "副圖金叉", a && b ? `${a}下穿${b}` : "副圖死叉"); }
  });
  return out.sort((a, b) => a.i - b.i);
}
// 要捲動的頁面：嵌在 K線學堂分頁（同網域 iframe、外框依內容長高）時捲動外層頁面
function pageScroller() { try { let w = window; while (w.parent !== w && w.parent.document) w = w.parent; return w; } catch { return window; } }
class Chart {
  constructor(host, { onHover, onRange } = {}) {
    this.host = host; this.onHover = onHover; this.onRange = onRange;
    this.legend = document.createElement("div"); this.legend.className = "legend";
    this.canvas = document.createElement("canvas"); this.ctx = this.canvas.getContext("2d");
    this.canvas.setAttribute("role", "img");
    // 縮放工具列：按鈕、Ctrl / ⌘ + 滾輪或雙指縮放，拖曳平移，雙擊還原
    this.bar = document.createElement("div"); this.bar.className = "zoombar";
    // 第二組：縱向（價格軸）放大縮小、圖表高度、對數座標，讓小波動也看得清楚
    this.bar.innerHTML = `<button type="button" data-z="out" aria-label="時間軸縮小" title="時間軸縮小（看更多 K 棒）">−</button><button type="button" data-z="in" aria-label="時間軸放大" title="時間軸放大（看更少 K 棒）">＋</button><button type="button" data-z="reset" aria-label="顯示全部並還原比例">全部</button><span class="zsep" aria-hidden="true"></span><button type="button" data-z="yin" aria-label="價格軸拉長" title="價格軸拉長：波動看起來更大（也可 Shift＋滾輪，或上下拖曳右側價格軸）">↕＋</button><button type="button" data-z="yout" aria-label="價格軸壓縮" title="價格軸壓縮">↕−</button><button type="button" data-z="sig" aria-pressed="true" title="主副圖對應：副圖指標發出訊號時，在主圖 K 線上標出位置（再按一次關閉）">對應</button><button type="button" data-z="scale" aria-expanded="false" title="主圖與副圖的比例、高度、對數座標、主副圖對應">設定 ▾</button>`;
    // 比例面板：主圖、副圖各自的縮放與高度（觸控裝置也能用按鈕操作）
    this.pop = document.createElement("div"); this.pop.className = "scalepop panel"; this.pop.hidden = true;
    host.append(this.legend, this.bar, this.pop, this.canvas);
    this.hover = null; this.view = null; this.ptrs = new Map(); this.yz = 1; this.yoff = 0; this.pz = {};
    Chart.all.push(this); this.syncBar();
    this.bar.addEventListener("click", e => {
      const z = e.target.closest("[data-z]")?.dataset.z;
      if (z === "in") this.zoom(0.6); else if (z === "out") this.zoom(1 / 0.6);
      else if (z === "reset") { this.resetScale(); }
      else if (z === "scale") { this.togglePop(); }
      else if (z === "sig") { Chart.setPref("sig", !Chart.prefs.sig); }
      else if (z === "yin") this.yZoom(1.5); else if (z === "yout") this.yZoom(1 / 1.5);
    });
    this.pop.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const d = b.dataset;
      if (d.p === "yin") this.yZoom(1.5); else if (d.p === "yout") this.yZoom(1 / 1.5);
      else if (d.p === "sin") this.subZoomAll(1.5); else if (d.p === "sout") this.subZoomAll(1 / 1.5);
      else if (d.p === "reset") this.resetScale();
      else if (d.mk) Chart.setPref("mk", d.mk);
      else if (d.kt) Chart.setPref("kt", d.kt);
      else if (d.h) Chart.setPref("h", +d.h); else if (d.sh) Chart.setPref("sh", +d.sh);
      else if (d.sk) Chart.setPref("sigKinds", { ...Chart.prefs.sigKinds, [d.sk]: !Chart.prefs.sigKinds[d.sk] });
      this.renderPop();
    });
    this.pop.addEventListener("change", e => { const t = e.target; if (t.dataset.pref) Chart.setPref(t.dataset.pref, t.checked); else if (t.dataset.strongall) Chart.setPref("sigStrongK", { ...Chart.prefs.sigStrongK, kd: t.checked, macd: t.checked }); });
    const cv = this.canvas;
    cv.addEventListener("pointerdown", e => {
      this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.ptrs.size === 1) {
        const pane = this.paneAt(e.offsetY), onAxis = !!this.geo && e.offsetX > this.geo.L + this.geo.pw;
        if (this.glide) { cancelAnimationFrame(this.glide); this.glide = 0; }
        this.drag = { x: e.offsetX, y: e.offsetY, cx: e.clientX, cy: e.clientY, t: performance.now(), vy: 0, touch: e.pointerType !== "mouse", dir: null, a: this.vw.fa, yz: this.yz, yoff: this.yoff, pane, pz: pane && pane.key !== "main" ? { ...this.paneZoom(pane.key) } : null, axis: onAxis && pane?.key === "main", subAxis: onAxis && pane && pane.key !== "main", moved: false };
      }
      if (this.ptrs.size === 2 && this.D) { this.tapOk = false; const [p, q] = [...this.ptrs.values()], { a, b } = this.range; this.smoothY = true; this.pinch = { d: Math.max(30, Math.hypot(p.x - q.x, p.y - q.y)), a: this.vw.fa, w: this.vw.w, mid: this.indexAt((p.x + q.x) / 2, true), mx: (p.x + q.x) / 2 }; this.drag = null; try { cv.setPointerCapture(e.pointerId); } catch {} }
      if (this.ptrs.size === 1) this.tapOk = true;
      if (e.pointerType === "mouse" && !this.pinned) this.hoverAt(e.offsetX);
    });
    cv.addEventListener("pointermove", e => {
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pinch && this.ptrs.size === 2) {
        // 雙指縮放：用兩指的實際距離（斜著捏也穩定），以一開始兩指中間那根 K 棒為中心，兩指一起移動時順便平移；每個畫面最多重畫一次
        const P = this.pinch, [p, q] = [...this.ptrs.values()], d = Math.max(30, Math.hypot(p.x - q.x, p.y - q.y)), G = this.geo;
        const w = P.w * P.d / d, shift = G ? ((p.x + q.x) / 2 - P.mx) / (G.pw / w) : 0;
        this.view = this.clampView(P.mid - (P.mid - P.a) * w / P.w - shift, w); this.req(); return;
      }
      if (this.drag && this.ptrs.size === 1 && this.geo) {
        const dx = e.offsetX - this.drag.x, dy = e.offsetY - this.drag.y, G = this.geo;
        // 圖表鎖定（放大後）時，頁面不會自己捲動：手勢一開始偏上下、又不是在拉價格軸或平移價格，就由這裡代替頁面捲動
        if (this.drag.touch && this.locked) {
          if (!this.drag.dir && Math.hypot(e.clientX - this.drag.cx, e.clientY - this.drag.cy) > 6) this.drag.dir = Math.abs(e.clientY - this.drag.cy) > Math.abs(e.clientX - this.drag.cx) * 1.2 ? "v" : "h";
          const wantsChartY = this.drag.axis || this.drag.subAxis || (this.yz > 1 && this.drag.y < G.top0 + G.mainH) || (this.drag.pz && this.drag.pz.z > 1);
          if (this.drag.dir === "v" && !wantsChartY) {
            const now = performance.now(), step = this.drag.lastCy == null ? e.clientY - this.drag.cy : e.clientY - this.drag.lastCy;
            pageScroller().scrollBy(0, -step); this.drag.vy = step / Math.max(1, now - (this.drag.lt || now - 16)); this.drag.lastCy = e.clientY; this.drag.lt = now; this.drag.moved = true; return;
          }
        }
        // 右側價格軸上下拖曳：拉長或壓縮價格軸
        if (this.drag.axis) { if (Math.abs(dy) > 2) { try { cv.setPointerCapture(e.pointerId); } catch {} this.yz = Math.max(0.5, Math.min(12, this.drag.yz * Math.exp(dy / 120))); this.req(); } return; }
        // 副圖右側刻度上下拖曳：只縮放這一個副圖
        if (this.drag.subAxis) { if (Math.abs(dy) > 2) { try { cv.setPointerCapture(e.pointerId); } catch {} this.pz[this.drag.pane.key] = { z: Math.max(0.5, Math.min(12, this.drag.pz.z * Math.exp(dy / 80))), off: this.drag.pz.off }; this.req(); } return; }
        // 副圖放大後，在副圖上下拖曳可以平移
        const sp = this.drag.pane && this.drag.pane.key !== "main" && this.drag.pz && this.drag.pz.z > 1 && Math.abs(dy) > 4 ? this.drag.pane : null;
        if (sp && Math.abs(dy) > Math.abs(dx)) { this.drag.moved = true; try { cv.setPointerCapture(e.pointerId); } catch {} this.pz[sp.key] = { z: this.drag.pz.z, off: Math.max(-1, Math.min(1, this.drag.pz.off + dy / sp.h)) }; this.req(); return; }
        const panX = Math.abs(dx) > 4 && this.view, panY = this.yz > 1 && Math.abs(dy) > 4 && this.drag.y < G.top0 + G.mainH;
        if (panX || panY) {
          this.drag.moved = true; try { cv.setPointerCapture(e.pointerId); } catch {}
          if (panX) { this.drag.bw ||= G.bw; this.smoothY = true; const now = performance.now(), fa0 = this.vw.fa; this.view = this.clampView(this.drag.a - dx / this.drag.bw, this.vw.w);
            const dt = now - (this.drag.vt || now - 16); this.drag.vx = 0.7 * (this.drag.vx || 0) + 0.3 * ((this.vw.fa - fa0) / Math.max(1, dt)); this.drag.vt = now; this.drag.panned = true; }
          if (panY) this.yoff = Math.max(-0.6, Math.min(0.6, this.drag.yoff + dy / G.mainH / this.yz));
          this.req(); return;
        }
      }
      // 滑鼠：十字線跟著游標（固定時不動）；手指：固定十字線後、圖沒有放大時，左右拖曳可以移動十字線
      if (this.drag && Math.hypot(e.offsetX - this.drag.x, e.offsetY - this.drag.y) > 6) this.tapOk = false;
      if (e.pointerType === "mouse" ? !this.pinned : this.pinned && !this.view && this.drag && !this.drag.moved) this.hoverAt(e.offsetX);
    });
    const up = e => {
      // 代替頁面捲動時，放開手指後讓頁面再滑一小段（慣性），手感接近一般捲動
      const d = this.drag; if (d && d.dir === "v" && Math.abs(d.vy) > 0.2 && e.type === "pointerup") { let v = d.vy * 16; const glide = () => { if (Math.abs(v) < 0.5) return; pageScroller().scrollBy(0, -v); v *= 0.94; requestAnimationFrame(glide); }; requestAnimationFrame(glide); }
      const wasPinch = !!this.pinch;
      // 橫向拖曳放開後的慣性：依最後的速度繼續滑，每個畫面減速
      if (d && d.panned && e.type === "pointerup" && Math.abs(d.vx || 0) > 0.002 && performance.now() - (d.vt || 0) < 80 && this.view) {
        let v = d.vx * 16, last = performance.now(); const go = now => { const dt = Math.min(40, now - last) / 16; last = now; v *= Math.pow(0.93, dt); const nv = this.clampView(this.vw.fa + v * dt, this.vw.w);
          if (!nv || Math.abs(v) < 0.01 || nv.fa === this.vw.fa) { this.glide = 0; this.smoothY = true; this.req(); return; } this.view = nv; this.draw(); this.glide = requestAnimationFrame(go); };
        this.smoothY = true; this.glide = requestAnimationFrame(go); }
      // 點一下（沒有拖曳）：固定十字線；固定時再點同一根 K 棒就取消
      if (e.type === "pointerup" && this.tapOk && this.drag && !this.drag.moved && this.D && this.ptrs.size === 1 && !this.drag.axis && !this.drag.subAxis) {
        const i = this.indexAt(e.offsetX); if (this.pinned && i === this.hover) { this.pinned = false; if (e.pointerType !== "mouse") this.hover = null; } else { this.pinned = true; this.hover = i; } this.req();
      }
      this.tapOk = false;
      this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null; if (!this.ptrs.size) this.drag = null;
      if (wasPinch && this.ptrs.size === 1) { const [r] = [...this.ptrs.values()]; this.drag = { x: r.x, y: r.y, cx: r.x, cy: r.y, t: performance.now(), vy: 0, touch: true, dir: "h", a: this.vw.fa, yz: this.yz, yoff: this.yoff, pane: null, pz: null, moved: true }; }
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", e => { up(e); if (!this.pinned) { this.hover = null; this.draw(); } });
    cv.addEventListener("dblclick", () => this.resetScale());
    cv.addEventListener("wheel", e => {
      if (!this.D) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.004), this.indexAt(e.offsetX, true)); }
      else if (e.shiftKey) {
        e.preventDefault(); const f = Math.exp(-(e.deltaY || e.deltaX) * 0.003), pane = this.paneAt(e.offsetY);
        if (pane && pane.key !== "main") { const z = this.paneZoom(pane.key); this.pz[pane.key] = { z: Math.max(0.5, Math.min(12, z.z * f)), off: z.off }; this.draw(); } else this.yZoom(f);
      }
      else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && this.view && this.geo) { e.preventDefault(); const { a, b } = this.range; this.smoothY = true; this.view = this.clampView(this.vw.fa + e.deltaX / this.geo.bw, this.vw.w); this.draw(); }
    }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(host);
  }
  static all = [];
  static keepView = false; // 即時報價更新最後一根 K 棒時，保留使用者的縮放與平移
  static PREF_KEYS = { h: "chartH", log: "chartLog", sh: "chartSubH", fit: "chartSubFit", sig: "chartSubSig", sigKinds: "chartSigKinds", sigStrong: "chartSigStrong", sigStrongK: "chartSigStrongK", mk: "chartMk", kt: "chartKt" };
  static prefs = { h: [1, 1.5, 2, 2.5].includes(+store.get("chartH", 1)) ? +store.get("chartH", 1) : 1, log: !!store.get("chartLog", false),
    sh: [1, 1.5, 2].includes(+store.get("chartSubH", 1)) ? +store.get("chartSubH", 1) : 1, fit: !!store.get("chartSubFit", false), sig: store.get("chartSubSig", true) !== false,
    sigStrong: store.get("chartSigStrong", true) !== false, mk: store.get("chartMk", "full") === "icon" ? "icon" : "full", kt: ["candle", "hollow", "ohlc", "line", "area"].includes(store.get("chartKt", "candle")) ? store.get("chartKt", "candle") : "candle",
    sigKinds: { kd: true, macd: true, rsi: true, wr: true, custom: true, ...(store.get("chartSigKinds", null) || {}) },
    // 「只看重點」每個副圖各自開關（舊版是全部共用一個 sigStrong）
    sigStrongK: { kd: store.get("chartSigStrong", true) !== false, macd: store.get("chartSigStrong", true) !== false, ...(store.get("chartSigStrongK", null) || {}) } };
  // 某個副圖要不要標訊號：「金叉死叉」或「只看重點」任一個開著就標；「只看重點」開著時只標重點交叉
  static sigShow(k) { const P = Chart.prefs; return P.sig && (P.sigKinds[k] !== false || !!P.sigStrongK[k]); }
  static SIG_KINDS = [["kd", "KD 交叉"], ["macd", "MACD 交叉"], ["rsi", "RSI 30／70"], ["wr", "威廉 −80／−20"], ["custom", "截圖副圖交叉"]];
  // 高度、對數座標、副圖貼合是全站共用的偏好：改了以後所有圖表一起重畫
  static setPref(k, v) { Chart.prefs[k] = v; store.set(Chart.PREF_KEYS[k], v); Chart.all.forEach(c => { c.syncBar(); c.draw(); if (!c.pop.hidden) c.renderPop(); }); }
  paneZoom(key) { return this.pz[key] || { z: 1, off: 0 }; }
  paneAt(y) { return (this.panes || []).find(p => y >= p.top - 5 && y <= p.top + p.h + 5) || null; }
  subZoomAll(f) { (this.panes || []).filter(p => p.key !== "main").forEach(p => { const z = this.paneZoom(p.key); this.pz[p.key] = { z: Math.max(0.5, Math.min(12, z.z * f)), off: z.off }; }); this.draw(); }
  // 放大或平移過的圖會「鎖定」：所有手勢都交給圖表（touch-action: none），避免拖曳圖表時整個頁面跟著捲動
  get locked() { return !!this.view || this.yz !== 1 || !!this.yoff || Object.values(this.pz).some(x => x.z !== 1 || x.off); }
  resetScale() { this.view = null; this.yz = 1; this.yoff = 0; this.pz = {}; this.draw(); if (!this.pop.hidden) this.renderPop(); }
  togglePop(open = this.pop.hidden) {
    Chart.all.forEach(c => { if (c !== this && !c.pop.hidden) c.togglePop(false); });
    this.pop.hidden = !open; this.bar.querySelector('[data-z="scale"]').setAttribute("aria-expanded", open);
    if (open) { this.renderPop(); Chart.closer ||= document.addEventListener("pointerdown", ev => Chart.all.forEach(c => { if (!c.pop.hidden && !c.pop.contains(ev.target) && !c.bar.contains(ev.target)) c.togglePop(false); })) || true; }
  }
  renderPop() {
    const P = Chart.prefs, seg = (k, vals, cur) => `<div class="pseg">${vals.map(v => `<button type="button" data-${k}="${v}" aria-pressed="${cur === v}">${v}×</button>`).join("")}</div>`;
    const sz = Object.values(this.pz).map(x => x.z), szTxt = sz.length ? `${+Math.max(...sz).toFixed(1)}×` : "1×";
    this.pop.innerHTML = `<div class="prow"><strong>主圖（價格）</strong><span class="pval">${+this.yz.toFixed(1)}×</span><div class="pseg"><button type="button" data-p="yout" aria-label="價格軸壓縮">↕−</button><button type="button" data-p="yin" aria-label="價格軸拉長">↕＋</button></div></div>
      <div class="prow"><span>高度</span>${seg("h", [1, 1.5, 2, 2.5], P.h)}</div>
      <label class="prow pchk"><input type="checkbox" data-pref="log" ${P.log ? "checked" : ""}><span>對數座標（同樣的漲跌幅一樣高）</span></label>
      <div class="prow"><strong>副圖（量、指標）</strong><span class="pval">${szTxt}</span><div class="pseg"><button type="button" data-p="sout" aria-label="副圖壓縮">↕−</button><button type="button" data-p="sin" aria-label="副圖拉長">↕＋</button></div></div>
      <div class="prow"><span>高度</span>${seg("sh", [1, 1.5, 2], P.sh)}</div>
      <label class="prow pchk"><input type="checkbox" data-pref="fit" ${P.fit ? "checked" : ""}><span>副圖自動貼合資料（KD、RSI 等固定刻度的指標也放大到填滿）</span></label>
      <div class="prow"><strong>主副圖對應</strong></div>
      <label class="prow pchk"><input type="checkbox" data-pref="sig" ${P.sig ? "checked" : ""}><span>副圖發出訊號時，在主圖 K 線上標出位置（空心圈＋名稱），副圖同一點以虛線對齊</span></label>
      <div class="prow pkinds" ${P.sig ? "" : "aria-disabled=\"true\""}>${Chart.SIG_KINDS.map(([k, t]) => `<button type="button" class="ichip" data-sk="${k}" aria-pressed="${P.sig && P.sigKinds[k]}" ${P.sig ? "" : "disabled"}>${t}</button>`).join("")}</div>
      <label class="prow pchk"><input type="checkbox" data-strongall="1" ${P.sigStrongK.kd && P.sigStrongK.macd ? "checked" : ""} ${P.sig ? "" : "disabled"}><span>只標重點交叉：KD 低檔（D&lt;20）金叉、高檔（D&gt;80）死叉；MACD 零軸上金叉、零軸下死叉。取消勾選則標出全部交叉</span></label>
      <div class="prow"><strong>K 線樣式</strong></div>
      <div class="prow"><div class="pseg kts">${[["candle", "實心K"], ["hollow", "空心K"], ["ohlc", "美國線"], ["line", "收盤線"], ["area", "面積圖"]].map(([k, t]) => `<button type="button" data-kt="${k}" aria-pressed="${P.kt === k}">${t}</button>`).join("")}</div></div>
      <div class="prow"><span>訊號標記</span><div class="pseg"><button type="button" data-mk="full" aria-pressed="${P.mk !== "icon"}">符號＋文字</button><button type="button" data-mk="icon" aria-pressed="${P.mk === "icon"}">只有符號</button></div></div>
      <p class="note" style="margin:0">策略與課程的訊號是 K 棒旁的三角形，文字會自動避開 K 棒；副圖指標的訊號（金叉、死叉等）是 K 棒下方（偏多）或上方（偏空）的半透明圓圈，用虛線連到副圖上的訊號點，點一下那根 K 棒就會加深並顯示名稱；每個副圖右上角可以直接開關。點一下圖表可以固定十字線，再點一次取消。</p>
      <div class="prow"><button type="button" class="btn sm" data-p="reset">全部還原</button></div>
      <p class="note">電腦：Shift＋滾輪縮放游標所在的圖，或上下拖曳右側刻度；放大後可上下拖曳平移。雙擊圖表還原。</p>`;
  }
  syncBar() {
    this.canvas.style.touchAction = this.locked ? "none" : "pan-y";
    this.host.classList.toggle("chart-locked", this.locked);
    this.bar.querySelector('[data-z="yin"]').setAttribute("aria-pressed", this.yz > 1.01);
    this.bar.querySelector('[data-z="sig"]').setAttribute("aria-pressed", Chart.prefs.sig);
    const scaled = Chart.prefs.h !== 1 || Chart.prefs.log || Chart.prefs.sh !== 1 || Chart.prefs.fit || Object.values(this.pz).some(x => x.z !== 1 || x.off);
    this.bar.querySelector('[data-z="scale"]').classList.toggle("on", scaled);
  }
  yZoom(f) { this.yz = Math.max(0.5, Math.min(12, this.yz * f)); if (this.yz <= 1) this.yoff = 0; this.draw(); }
  set(D, opts = {}) { if (D !== this.D && !Chart.keepView) { this.ysm = null; this.view = null; this.yz = 1; this.yoff = 0; this.pz = {}; } if (!Chart.keepView || this.hover == null || this.hover >= D.length) { this.hover = null; this.pinned = false; } this.D = D; this.I = opts.I || indicators(D); this.o = opts; this.draw(); return this; }
  get visible() { return this.o.visible ?? this.D.length; }
  get range() { return this.view || { a: 0, b: this.D.length - 1 }; }
  // 可見範圍：fa 是小數的起點（拖曳時一個像素一個像素地跟手，不會一次跳一根 K 棒），a、b 是整數索引（給計算用）
  clampView(a, w) { const N = this.D.length; w = Math.round(Math.max(Math.min(15, N), Math.min(N, w))); if (w >= N) return null; a = Math.max(0, Math.min(N - w, a)); return { a: Math.floor(a), b: Math.floor(a) + w - 1, fa: a, w }; }
  get vw() { const r = this.range; return { fa: r.fa ?? r.a, w: r.w ?? r.b - r.a + 1 }; }
  setWidth(w, anchor) { const { fa, w: ow } = this.vw; anchor = anchor ?? fa + ow / 2; const t = (anchor - fa) / ow; this.view = this.clampView(anchor - t * w, w); this.draw(); }
  zoom(f, anchor) { if (!this.D) return; this.setWidth(this.vw.w * f, anchor); }
  hoverAt(x) { const i = this.indexAt(x); if (i !== this.hover) { this.hover = i; this.req(); } }
  // 手勢中的重畫合併到下一個畫面（每個畫面最多畫一次），拖曳、縮放比較順
  req() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  indexAt(x, raw) { if (!this.geo) return null; const { L, bw, fa, a } = this.geo; const i = Math.floor(fa + (x - L) / bw); return raw ? i : Math.max(a, Math.min(Math.min(this.visible - 1, this.range.b), i)); }
  draw() {
    if (!this.D) return;
    const { D, I, o } = this, ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const W = this.host.clientWidth; if (!W) return;
    const narrow = W < 560;
    // 副圖可以疊好幾個：o.subs = ["kd", "macd", { custom }]；舊的 o.sub 也支援
    const subs = (o.subs || (o.sub ? [o.sub] : [])).filter(Boolean);
    const mainH = Math.round((narrow ? 230 : 300) * Chart.prefs.h), volH = o.noVol ? 0 : Math.round((narrow ? 52 : 66) * Chart.prefs.sh), subH = Math.round((subs.length > 1 ? (narrow ? 80 : 96) : (narrow ? 92 : 112)) * Chart.prefs.sh), gap = 10, axisH = 20;
    const H = mainH + gap + volH + subs.length * (gap + subH) + axisH + 8;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); this.canvas.style.height = H + "px"; } // 尺寸沒變就不重設（重設畫布很慢，拖曳時會閃）
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const col = { ink: cssVar("--ink"), muted: cssVar("--muted"), line: cssVar("--line"), up: cssVar("--up"), down: cssVar("--down"), s1: cssVar("--s1"), s2: cssVar("--s2"), s3: cssVar("--s3"), accent: cssVar("--accent"), band: cssVar("--band"), shade: cssVar("--shade"), surface: cssVar("--surface"), vwap: cssVar("--vwap") || "#f472b6" };
    const n = D.length, vis = this.visible, L = 8, R = narrow ? 48 : 58, pw = W - L - R;
    const { a: va, b: vb } = this.range, { fa, w: vwid } = this.vw, bw = pw / vwid, inV = i => i >= va - 1 && i <= vb + 1;
    this.geo = { L, bw, a: va, fa, pw, H, top0: 8, mainH };
    { const vt = 8 + mainH + gap, st = o.noVol ? vt : vt + volH + gap; this.panes = [{ key: "main", top: 8, h: mainH }, ...(o.noVol ? [] : [{ key: "vol", top: vt, h: volH }]), ...subs.map((_, k) => ({ key: "s" + k, top: st + k * (subH + gap), h: subH }))]; }
    this.syncBar();
    const X = i => L + bw * (i - fa + 0.5);
    this.bar.classList.toggle("zoomed", !!this.view);
    const top0 = 8, volTop = top0 + mainH + gap, subTop0 = o.noVol ? volTop : volTop + volH + gap;
    const fmtD = o.fmtD || (s => s.slice(5).replace("-", "/"));
    const MA_COL = { 5: col.s1, 10: col.accent, 20: col.s2, 60: col.s3 };
    const mas = (o.ma || []).map((n, k) => ({ n, a: I.ma(n), c: MA_COL[n] || [col.s1, col.s2, col.s3][k % 3] }));
    const F = o.future; // { from, p10, p25, p50, p75, p90 }：模擬區的機率帶

    // 比較其他股票：以畫面最左邊那根為基準，換算成同樣的漲跌幅畫在價格座標上（at：該日或之前最近的收盤）
    const cmpS = (o.compare || []).map(cp => {
      const ds = cp.pts, at = d => { let lo = 0, hi = ds.length - 1, r = -1; const key = String(d).slice(0, 10); while (lo <= hi) { const m = (lo + hi) >> 1; if (ds[m][0] <= key) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? ds[r][1] : null; };
      const a0 = Math.max(0, va), base = at(D[a0].d); return base ? { ...cp, at, k: D[a0].c / base } : null;
    }).filter(Boolean);
    // 價格範圍
    let lo = Infinity, hi = -Infinity;
    for (let i = va; i < Math.min(vis, vb + 1); i++) {
      lo = Math.min(lo, D[i].l); hi = Math.max(hi, D[i].h);
      for (const cp of cmpS) { const v = cp.at(D[i].d); if (v != null) { lo = Math.min(lo, v * cp.k); hi = Math.max(hi, v * cp.k); } }
      if (o.boll && I.boll.up[i] != null) { lo = Math.min(lo, I.boll.lo[i]); hi = Math.max(hi, I.boll.up[i]); }
      if (o.vwap && I.vwap[i] != null) { lo = Math.min(lo, I.vwap[i]); hi = Math.max(hi, I.vwap[i]); }
      if (F && i >= F.from) { lo = Math.min(lo, F.p25[i - F.from]); hi = Math.max(hi, F.p75[i - F.from]); } // 外圈機率帶超出就裁掉，真實 K 棒才不會被壓扁
    }
    // 對數座標：用 log(價格) 決定高度；縱向放大：以中間為準把價格範圍縮小，可上下平移（yoff）
    const logS = Chart.prefs.log && lo > 0, tf = logS ? Math.log : v => v, itf = logS ? Math.exp : v => v;
    let tlo = tf(lo), thi = tf(hi); const tpad = (thi - tlo) * 0.08 || Math.abs(thi) * 0.01 || 1; tlo -= tpad; thi += tpad;
    if (this.yz !== 1 || this.yoff) { const sp = thi - tlo, mid = (tlo + thi) / 2 + this.yoff * sp; tlo = mid - sp / this.yz / 2; thi = mid + sp / this.yz / 2; }
    // 拖曳、縮放時價格軸不要一下跳到新範圍：每個畫面往目標靠近 30%，靠近了才停（看起來是平順地伸縮，不會上下抖）
    if (this.ysm && this.smoothY) { const k = 0.3, nlo = this.ysm.lo + (tlo - this.ysm.lo) * k, nhi = this.ysm.hi + (thi - this.ysm.hi) * k;
      if (Math.abs(nlo - tlo) + Math.abs(nhi - thi) > (thi - tlo) * 0.002) { tlo = nlo; thi = nhi; this.needY = true; } else this.smoothY = this.ptrs.size > 0 || !!this.glide; }
    this.ysm = { lo: tlo, hi: thi };
    lo = itf(tlo); hi = itf(thi);
    const Y = p => top0 + (thi - tf(p)) / (thi - tlo) * mainH;

    ctx.font = `11px ${cssVar("--font-mono")}`; ctx.textBaseline = "middle";
    // 未揭曉區
    if (vis < n || o.cutoff != null) {
      const cx = Math.max(L, X((o.cutoff ?? vis) - 0.5));
      ctx.fillStyle = col.shade; ctx.fillRect(cx, top0, L + pw - cx, H - top0 - axisH - 8);
      ctx.strokeStyle = col.muted; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(cx, top0); ctx.lineTo(cx, H - axisH - 8); ctx.stroke(); ctx.setLineDash([]);
      if (vis < n) { ctx.fillStyle = col.muted; ctx.textAlign = "center"; ctx.font = `13px ${cssVar("--font-body")}`; ctx.fillText("？", (cx + L + pw) / 2, top0 + mainH / 2); ctx.font = `11px ${cssVar("--font-mono")}`; }
    }
    // 格線 + 價格座標
    const step = niceStep((hi - lo) / 5);
    ctx.textAlign = "left";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Y(v); ctx.strokeStyle = col.line; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(L, Math.round(y) + 0.5); ctx.lineTo(L + pw, Math.round(y) + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = col.muted; ctx.fillText(fmtP(v), L + pw + 6, y);
    }
    // 籌碼分佈（Volume Profile）：疊在主圖右側、半透明；用畫面最右邊那根 K 棒往前 120 根計算，平移時跟著更新
    const VP = this.vpData = o.vp ? costDist(D, Math.min(vis, vb + 1) - 1, o.vpN || 120, 70) : null;
    if (VP) {
      const mx = Math.max(...VP.w), maxW = pw * (narrow ? 0.34 : 0.26), bh = Math.max(1, Math.abs(Y(VP.mids[0]) - Y(VP.mids[0] + VP.step)));
      ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pw, mainH); ctx.clip();
      // 70% 籌碼區間的底色
      const y70a = Y(VP.r70[1]), y70b = Y(VP.r70[0]); ctx.fillStyle = col.ink; ctx.globalAlpha = 0.045; ctx.fillRect(L + pw - maxW, y70a, maxW, y70b - y70a);
      VP.w.forEach((x, k) => { const y = Y(VP.mids[k] + VP.step / 2), wd = x / mx * maxW; ctx.fillStyle = VP.mids[k] <= VP.px ? col.up : col.down; ctx.globalAlpha = VP.mids[k] <= VP.px ? 0.26 : 0.2; ctx.fillRect(L + pw - wd, y, wd, Math.max(1, bh - 0.6)); });
      ctx.globalAlpha = 1;
      const tag = (v, c, t) => { if (v == null) return; const y = Y(v); if (y < top0 || y > top0 + mainH) return; ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.setLineDash(t === "均" ? [5, 3] : []); ctx.beginPath(); ctx.moveTo(L + pw - maxW - 8, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); };
      tag(VP.pre, "#f0883e", "壓"); tag(VP.avg, col.muted, "均"); tag(VP.sup, "#4e9af1", "撐");
      ctx.restore();
      // 右側價格軸上的標籤（和富途一樣：橘＝壓力、灰＝平均成本、藍＝支撐）
      ctx.font = `600 10.5px ${cssVar("--font-mono")}`; ctx.textAlign = "left";
      const used = [];
      [[VP.pre, "#f0883e"], [VP.avg, "#8b8f98"], [VP.sup, "#3b82f6"]].forEach(([v, c]) => { if (v == null) return; let y = Y(v); if (y < top0 + 6 || y > top0 + mainH - 6) return; while (used.some(u => Math.abs(u - y) < 14)) y += 14; used.push(y); const t = fmtP(v), tw = ctx.measureText(t).width + 8; ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(L + pw + 2, y - 8, tw, 16, 3) : ctx.rect(L + pw + 2, y - 8, tw, 16); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText(t, L + pw + 6, y); });
      ctx.font = `11px ${cssVar("--font-mono")}`;
    }
    // 布林
    if (o.boll) {
      const { up, lo: lw, mid } = I.boll;
      ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pw, mainH); ctx.clip();
      ctx.fillStyle = col.band; ctx.beginPath(); let started = false;
      for (let i = 0; i < vis; i++) if (up[i] != null) { started ? ctx.lineTo(X(i), Y(up[i])) : ctx.moveTo(X(i), Y(up[i])); started = true; }
      for (let i = vis - 1; i >= 0; i--) if (lw[i] != null) ctx.lineTo(X(i), Y(lw[i]));
      ctx.fill(); ctx.restore();
      this.line(up, vis, X, Y, col.accent, 1, 0.7); this.line(lw, vis, X, Y, col.accent, 1, 0.7); this.line(mid, vis, X, Y, col.accent, 1, 0.45, [3, 3]);
    }
    // 支撐壓力
    (o.hlines || []).forEach(h => {
      const y = Y(h.price); if (y < top0 - 1 || y > top0 + mainH + 1) return; const c = h.color ? col[h.color] || h.color : h.kind === "壓力" ? col.down : col.up;
      ctx.strokeStyle = c; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(Math.max(L, X(h.i ?? 0)), y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]);
      const t = h.label || `${h.kind} ${fmtP(h.price)}`; ctx.textAlign = "right"; ctx.font = `11px ${cssVar("--font-body")}`; const tw = ctx.measureText(t).width; ctx.fillStyle = col.surface; ctx.globalAlpha = 0.85; ctx.fillRect(L + pw - 6 - tw, y - 19, tw + 4, 14); ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(t, L + pw - 4, y - 8); ctx.font = `11px ${cssVar("--font-mono")}`;
    });
    // 區塊（訂單塊、公平價值缺口）：畫在 K 棒後面，只畫到目前可見的範圍
    const cmap = { up: col.up, down: col.down, accent: col.accent, muted: col.muted, s2: col.s2, ink: col.ink };
    ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pw, mainH); ctx.clip();
    (o.zones || []).filter(z => z.at == null || z.at < vis).forEach(z => {
      const x1 = X(z.i1) - bw / 2, x2 = X(Math.min(z.i2, vis - 1)) + bw / 2, y1 = Y(z.top), y2 = Y(z.bot), c = z.color ? cmap[z.color] : z.dir > 0 ? col.up : col.down;
      ctx.fillStyle = c; ctx.globalAlpha = z.alpha ?? (z.kind === "FVG" ? 0.08 : 0.16); ctx.fillRect(x1, y1, x2 - x1, Math.max(2, y2 - y1)); ctx.globalAlpha = z.alpha != null ? Math.min(0.7, z.alpha * 4) : 0.7;
      ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(z.kind === "FVG" ? [3, 3] : []); ctx.strokeRect(x1, y1, x2 - x1, Math.max(2, y2 - y1)); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (x2 - x1 > 22) { ctx.fillStyle = c; ctx.textAlign = "left"; ctx.font = `600 10px ${cssVar("--font-body")}`; ctx.fillText(z.kind, x1 + 3, Math.max(y1, Math.min(y2, y1 + 7))); ctx.font = `11px ${cssVar("--font-mono")}`; }
    });
    ctx.restore();
    // 模擬區：底色、機率帶（10–90%、25–75%）、中位數
    if (F) {
      const fx = Math.max(L, X(F.from - 0.5));
      ctx.fillStyle = col.shade; ctx.fillRect(fx, top0, L + pw - fx, mainH);
      ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pw, mainH); ctx.clip();
      const band = (a, b, alpha) => { ctx.fillStyle = col.accent; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.moveTo(X(F.from - 1), Y(D[F.from - 1].c)); a.forEach((v, t) => ctx.lineTo(X(F.from + t), Y(v))); for (let t = b.length - 1; t >= 0; t--) ctx.lineTo(X(F.from + t), Y(b[t])); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; };
      band(F.p90, F.p10, 0.1); band(F.p75, F.p25, 0.16);
      ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(F.from - 1), Y(D[F.from - 1].c)); F.p50.forEach((v, t) => ctx.lineTo(X(F.from + t), Y(v))); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      ctx.fillStyle = col.accent; ctx.textAlign = "left"; ctx.font = `700 11px ${cssVar("--font-body")}`; if (fx < L + pw - 40) ctx.fillText("模擬", fx + 6, top0 + 10); ctx.font = `11px ${cssVar("--font-mono")}`;
    }
    // K 棒以下到標記為止都裁在價格區內（縱向放大時才不會畫到成交量區）
    ctx.save(); ctx.beginPath(); ctx.rect(0, top0, L + pw + 1, mainH); ctx.clip();
    const cw = Math.max(1, Math.min(14, bw * 0.66)), KT = o.ktype || Chart.prefs.kt, i0 = Math.max(0, va), i1 = Math.min(vis, vb + 1);
    if (KT === "line" || KT === "area") {
      // 收盤線／面積圖：只連收盤價
      const lc = D[i1 - 1] && D[i0] && D[i1 - 1].c >= D[i0].c ? col.up : col.down;
      if (KT === "area") { ctx.fillStyle = col.accent; ctx.globalAlpha = 0.14; ctx.beginPath(); for (let i = i0; i < i1; i++) i === i0 ? ctx.moveTo(X(i), Y(D[i].c)) : ctx.lineTo(X(i), Y(D[i].c)); ctx.lineTo(X(i1 - 1), top0 + mainH); ctx.lineTo(X(i0), top0 + mainH); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = KT === "area" ? col.accent : lc; ctx.lineWidth = 1.6; ctx.beginPath(); for (let i = i0; i < i1; i++) i === i0 ? ctx.moveTo(X(i), Y(D[i].c)) : ctx.lineTo(X(i), Y(D[i].c)); ctx.stroke();
    } else for (let i = i0; i < i1; i++) {
      const k = D[i], x = X(i), rising = k.c > k.o, upc = rising ? col.up : k.c < k.o ? col.down : col.ink;
      ctx.globalAlpha = k.sim ? 0.5 : 1;
      ctx.strokeStyle = upc; ctx.fillStyle = upc; ctx.lineWidth = 1;
      const xm = Math.round(x) + 0.5;
      if (KT === "ohlc") {
        // 美國線：高低一條直線，左邊短橫線是開盤、右邊是收盤
        const t = Math.max(2, Math.round(cw / 2)); ctx.lineWidth = bw > 6 ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(xm, Y(k.h)); ctx.lineTo(xm, Y(k.l)); ctx.moveTo(xm - t, Math.round(Y(k.o)) + 0.5); ctx.lineTo(xm, Math.round(Y(k.o)) + 0.5); ctx.moveTo(xm, Math.round(Y(k.c)) + 0.5); ctx.lineTo(xm + t, Math.round(Y(k.c)) + 0.5); ctx.stroke();
        continue;
      }
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)), bx = Math.round(x - cw / 2), bwid = Math.max(1, Math.round(cw)), bh = Math.max(1, y2 - y1);
      if (KT === "hollow" && rising && bwid >= 3) {
        // 空心 K 線：上漲的實體只畫外框，影線不穿過實體
        ctx.beginPath(); ctx.moveTo(xm, Y(k.h)); ctx.lineTo(xm, y1); ctx.moveTo(xm, y1 + bh); ctx.lineTo(xm, Y(k.l)); ctx.stroke();
        ctx.strokeRect(bx + 0.5, Math.round(y1) + 0.5, bwid - 1, Math.max(1, Math.round(bh) - 1));
      } else {
        ctx.beginPath(); ctx.moveTo(xm, Y(k.h)); ctx.lineTo(xm, Y(k.l)); ctx.stroke();
        ctx.fillRect(bx, y1, bwid, bh);
      }
    }
    ctx.globalAlpha = 1;
    this.cmpNow = [];
    cmpS.forEach(cp => {
      ctx.strokeStyle = cp.color; ctx.lineWidth = 1.6; ctx.beginPath(); let st = false;
      for (let i = i0; i < i1; i++) { const v = cp.at(D[i].d); if (v == null) continue; const y = Y(v * cp.k); st ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); st = true; }
      ctx.stroke();
      const v = cp.at(D[Math.min(this.hover ?? i1 - 1, i1 - 1)].d); this.cmpNow.push({ name: cp.name, color: cp.color, pct: v ? (v * cp.k / D[i0].c - 1) * 100 : null });
    });
    if (cmpS.length) { const hv = Math.min(this.hover ?? i1 - 1, i1 - 1); this.cmpSelf = (D[hv].c / D[i0].c - 1) * 100; }
    // 均線
    mas.forEach(m => this.line(m.a, vis, X, Y, m.c, 1.6));
    if (o.vwap) this.line(I.vwap, vis, X, Y, col.vwap, 1.8);
    // 折線、頸線、目標價、結構線（可來自設定或附在標記上；只畫到可見範圍）
    ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pw, mainH); ctx.clip();
    [...(o.shapes || []), ...(o.markers || []).filter(m => m.i < vis).flatMap(m => m.shapes || [])].forEach(sh => {
      if (!sh.pts?.length || sh.pts[0][0] >= vis) return;
      const pts = sh.pts.map(([i, p]) => [vis < n ? Math.min(i, vis - 1) : i, p]);
      const c = cmap[sh.color] || col.accent;
      ctx.strokeStyle = c; ctx.lineWidth = sh.width || 1.5; ctx.setLineDash(sh.dash || []); ctx.beginPath();
      pts.forEach(([i, p], k) => { const x = X(Math.min(i, n - 1)) + (i > n - 1 ? (i - n + 1) * bw : 0); k ? ctx.lineTo(x, Y(p)) : ctx.moveTo(x, Y(p)); }); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c; ctx.font = `600 10.5px ${cssVar("--font-body")}`;
      if (sh.label) { const [i, p] = pts[pts.length - 1]; ctx.textAlign = "right"; ctx.fillText(sh.label, Math.min(X(Math.min(i, vis - 1)), L + pw - 2), Y(p) - 6); }
      (sh.tags || []).filter(t => t.i < vis).forEach(t => { ctx.textAlign = "center"; ctx.fillText(t.text, X(t.i), Y(t.p) + (t.below ? 13 : -7)); });
      ctx.font = `11px ${cssVar("--font-mono")}`;
    });
    ctx.restore();
    // 背離連線：價格圖上連兩個轉折點，副圖顯示同一指標時也連起來
    const divs = (o.markers || []).filter(m => m.div && m.i < vis);
    const divLine = (x1, y1, x2, y2, c) => { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); [[x1, y1], [x2, y2]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a, b, 3, 0, Math.PI * 2); ctx.fill(); }); };
    ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pw, mainH); ctx.clip();
    divs.forEach(m => divLine(X(m.div.i1), Y(m.div.p1), X(m.div.i2), Y(m.div.p2), m.side === "buy" ? col.up : col.down));
    ctx.restore();
    // 標記
    const showLabels = o.labels !== false && bw >= 2.5 && Chart.prefs.mk !== "icon";
    const placed = [];
    // 文字標籤不能壓到 K 棒：找出標籤橫跨的那幾根 K 棒，買進訊號往下推到它們的最低點以下、賣出訊號往上推到最高點以上；推出主圖範圍就不畫字（滑到那根 K 棒時圖例會顯示）
    const clearY = (tx, tw, ty, down) => {
      const i0 = Math.max(va, Math.floor((tx - tw / 2 - L) / bw + va - 0.5)), i1 = Math.min(Math.min(vis, vb + 1) - 1, Math.ceil((tx + tw / 2 - L) / bw + va - 0.5));
      let ext = down ? -Infinity : Infinity; for (let i = i0; i <= i1; i++) { const k = D[i]; if (!k) continue; ext = down ? Math.max(ext, Y(k.l)) : Math.min(ext, Y(k.h)); }
      const y = down ? Math.max(ty, ext + 9) : Math.min(ty, ext - 8);
      return y > top0 + mainH - 5 || y < top0 + 6 ? null : y;
    };
    const label = (t, tx, ty, c, size) => { ctx.font = `600 ${size}px ${cssVar("--font-body")}`; ctx.textAlign = "center"; ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = col.surface; ctx.globalAlpha = 0.85; ctx.strokeText(t, tx, ty); ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(t, tx, ty); };
    // 副圖訊號：在副圖上交叉或離開超買超賣區的那一天，主圖K線也標出來（空心圈，和實心三角的課程／策略訊號區分）
    const sigs = this.sigs = Chart.prefs.sig && o.subSignals !== false ? subSignals(D, I, subs, vis, Object.fromEntries(["kd", "macd", "rsi", "wr", "custom"].map(k => [k, Chart.sigShow(k)])), Chart.prefs.sigStrongK) : [];
    (o.markers || []).filter(m => m.i < vis && m.i >= va && m.i <= vb).forEach(m => {
      const k = D[m.i], x = X(m.i), buy = m.side === "buy", c = m.note ? col.accent : buy ? col.up : col.down;
      const y = buy ? Y(k.l) + 8 : Y(k.h) - 8, s = 5;
      ctx.globalAlpha = m.dim ? 0.3 : 1; // 回測中被略過的訊號畫淡一點
      ctx.globalAlpha = (m.dim ? 0.3 : 1) * 0.9; ctx.fillStyle = c; ctx.beginPath();
      if (buy) { ctx.moveTo(x, y); ctx.lineTo(x - s, y + s * 1.5); ctx.lineTo(x + s, y + s * 1.5); }
      else { ctx.moveTo(x, y); ctx.lineTo(x - s, y - s * 1.5); ctx.lineTo(x + s, y - s * 1.5); }
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = m.dim ? 0.3 : 1;
      if (showLabels && m.label) {
        // 標籤互相重疊或會壓到 K 棒時改位置；放不下就不畫字（三角形照畫）
        ctx.font = `600 10.5px ${cssVar("--font-body")}`; const tw = ctx.measureText(m.label).width;
        const tx = Math.min(Math.max(x, L + tw / 2 + 2), L + pw - tw / 2 - 2), ty = clearY(tx, tw, buy ? y + s * 1.5 + 9 : y - s * 1.5 - 8, buy);
        if (ty != null && !placed.some(q => Math.abs(q.x - tx) < (q.w + tw) / 2 + 4 && Math.abs(q.y - ty) < 13)) { label(m.label, tx, ty, c, 10.5); placed.push({ x: tx, y: ty, w: tw }); }
        ctx.font = `11px ${cssVar("--font-mono")}`;
      }
      ctx.globalAlpha = 1;
    });
    // 同一天同方向的副圖訊號疊在一起：圈畫一次，標籤合併（例如「KD金叉・MACD金叉」）
    const sigAt = new Map(); sigs.filter(g => g.i >= va && g.i <= vb).forEach(g => { const k = g.i + g.side; sigAt.has(k) ? sigAt.get(k).push(g) : sigAt.set(k, [g]); });
    const marked = new Set((o.markers || []).map(m => m.i + m.side));
    // 副圖訊號：在那根 K 棒下方（偏多）或上方（偏空）畫半透明圓圈，再用虛線連到副圖上的訊號點；名稱在十字線停到那一天時顯示
    this.sigLinks = [];
    sigAt.forEach(gs => {
      if (marked.has(gs[0].i + gs[0].side)) return; // 同一天已有同方向的課程／策略標記（通常就是同一個訊號），不重複畫
      const g = gs[0], k = D[g.i], x = X(g.i), buy = g.side === "buy", c = buy ? col.up : col.down, r = Math.max(3, Math.min(5, bw * 0.45));
      const y = Math.max(top0 + r + 2, Math.min(top0 + mainH - r - 2, buy ? Y(k.l) + r + 5 : Y(k.h) - r - 5)), on = this.hover === g.i;
      ctx.fillStyle = c; ctx.globalAlpha = on ? 0.4 : 0.16; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.globalAlpha = on ? 1 : 0.6; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      if (gs.length > 1) { ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
      this.sigLinks.push({ i: g.i, side: g.side, x, y: buy ? y + r : y - r, c, on });
      if (on && Chart.prefs.mk !== "icon") { const t = gs.map(q => q.label).join("・"); ctx.font = `600 10px ${cssVar("--font-body")}`; const tw = ctx.measureText(t).width, tx = Math.min(Math.max(x, L + tw / 2 + 2), L + pw - tw / 2 - 2); label(t, tx, buy ? y + r + 12 : y - r - 6, c, 10); ctx.font = `11px ${cssVar("--font-mono")}`; }
    });

    ctx.restore();
    if (logS || this.yz !== 1) { ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.font = `10px ${cssVar("--font-body")}`; ctx.fillText([logS ? "對數座標" : "", this.yz !== 1 ? `價格軸 ${+this.yz.toFixed(1)}×` : ""].filter(Boolean).join("・"), L + 4, top0 + mainH - 8); ctx.font = `11px ${cssVar("--font-mono")}`; }
    // 成交量
    if (!o.noVol) {
    let vmax = 1; for (let i = va; i < Math.min(vis, vb + 1); i++) vmax = Math.max(vmax, D[i].v);
    { const vzz = this.paneZoom("vol"); vmax /= vzz.z; } // 成交量放大：從底部往上拉長
    ctx.save(); ctx.beginPath(); ctx.rect(0, volTop, W, volH); ctx.clip();
    ctx.globalAlpha = 0.6;
    for (let i = va; i < Math.min(vis, vb + 1); i++) { const k = D[i]; if (k.sim) continue; ctx.fillStyle = k.c >= k.o ? col.up : col.down; const h = k.v / vmax * (volH - 4); ctx.fillRect(Math.round(X(i) - cw / 2), volTop + volH - h, Math.max(1, Math.round(cw)), h); }
    ctx.globalAlpha = 1;
    this.line(I.vma, vis, X, v => volTop + volH - v / vmax * (volH - 4), col.muted, 1);
    ctx.restore();
    ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.font = `11px ${cssVar("--font-body")}`; ctx.fillText(o.volLabel || "量（張）", L + pw + 6, volTop + 6); ctx.font = `11px ${cssVar("--font-mono")}`;
    ctx.strokeStyle = col.line; ctx.beginPath(); ctx.moveTo(L, volTop - gap / 2); ctx.lineTo(L + pw, volTop - gap / 2); ctx.stroke();
    }

    // 副圖（可多個，由上往下排）
    subs.forEach((S, si) => {
      const sub = typeof S === "string" ? S : "custom", C0 = typeof S === "string" ? null : S.custom, subTop = subTop0 + si * (subH + gap);
      ctx.strokeStyle = col.line; ctx.beginPath(); ctx.moveTo(L, subTop - gap / 2); ctx.lineTo(L + pw, subTop - gap / 2); ctx.stroke();
      // 副圖縮放：手動倍數（pz）＋「自動貼合資料」；以可見資料的中心為準，所以 KD 停在高檔時也不會被放大到畫面外
      const pzz = this.paneZoom("s" + si);
      const Z = (sy0, series) => {
        let a = Infinity, b = -Infinity;
        series.forEach(arr => { if (!arr) return; for (let i = Math.max(0, va); i < Math.min(vis, vb + 1, arr.length); i++) { const v = arr[i]; if (v == null) continue; const y = sy0(v); if (y < a) a = y; if (y > b) b = y; } });
        if (!isFinite(a)) return sy0;
        let z = pzz.z; if (Chart.prefs.fit) z *= Math.max(1, Math.min(8, (subH - 14) / Math.max(4, b - a)));
        if (z === 1 && !pzz.off) return sy0;
        const c = (a + b) / 2, mid = subTop + subH / 2 + pzz.off * subH;
        return v => mid + (sy0(v) - c) * z;
      };
      ctx.save(); ctx.beginPath(); ctx.rect(0, subTop, W, subH); ctx.clip();
      const lvl = (v, sy) => { const y = sy(v); if (y < subTop - 2 || y > subTop + subH + 2) return; ctx.strokeStyle = col.line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.fillText(String(v), L + pw + 6, y); };
      if (sub === "rsi" || sub === "kd") {
        const sy = Z(v => subTop + (100 - v) / 100 * subH, sub === "rsi" ? [I.rsi] : [I.kd.K, I.kd.D]); this.subY = sy;
        const [a, b] = sub === "rsi" ? [70, 30] : [80, 20];
        ctx.fillStyle = col.band; ctx.fillRect(L, sy(100), pw, sy(a) - sy(100)); ctx.fillRect(L, sy(b), pw, sy(0) - sy(b));
        lvl(a, sy); lvl(b, sy);
        if (sub === "rsi") this.line(I.rsi, vis, X, sy, col.s2, 1.5);
        else { this.line(I.kd.K, vis, X, sy, col.s1, 1.5); this.line(I.kd.D, vis, X, sy, col.s3, 1.5); }
      } else if (sub === "wr") {
        const sy = Z(v => subTop + (-v) / 100 * subH, [I.wr]);
        ctx.fillStyle = col.band; ctx.fillRect(L, sy(0), pw, sy(-20) - sy(0)); ctx.fillRect(L, sy(-80), pw, sy(-100) - sy(-80));
        lvl(-20, sy); lvl(-80, sy);
        this.line(I.wr, vis, X, sy, col.s2, 1.5); this.subY = sy;
      } else if (sub === "inout" && I.io) {
        let m = 5; for (let i = 0; i < vis; i++) m = Math.max(m, Math.abs(I.io[i] - 50));
        const sy = Z(v => subTop + subH / 2 - (v - 50) / m * (subH / 2 - 4), [I.io, I.io5]);
        ctx.globalAlpha = 0.55;
        for (let i = va; i < Math.min(vis, vb + 1); i++) { const v = I.io[i]; ctx.fillStyle = v >= 50 ? col.up : col.down; const y0 = sy(50), y1 = sy(v); ctx.fillRect(Math.round(X(i) - cw / 2), Math.min(y0, y1), Math.max(1, Math.round(cw)), Math.max(1, Math.abs(y1 - y0))); }
        ctx.globalAlpha = 1; lvl(50, sy);
        this.line(I.io5, vis, X, sy, col.s1, 1.5); this.subY = sy;
      } else if (sub === "custom") {
        // 截圖讀出的副圖：值域依資料自動決定
        const C = C0, vals = [...C.lines.flat(), ...(C.bars || [])].filter(v => v != null);
        let lo = C.range ? C.range[0] : Math.min(...vals, C.bars ? 0 : Infinity), hi = C.range ? C.range[1] : Math.max(...vals, C.bars ? 0 : -Infinity);
        if (hi === lo) { hi += 1; lo -= 1; }
        const sy = Z(v => subTop + 4 + (hi - v) / (hi - lo) * (subH - 8), [...C.lines, ...(C.bars ? [C.bars] : [])]);
        (C.levels || []).forEach(v => lvl(v, sy));
        if (C.bars) { ctx.globalAlpha = 0.55; C.bars.forEach((v, i) => { if (i >= vis || !v || !inV(i)) return; ctx.fillStyle = C.barColor ? col[C.barColor] : v >= 0 ? col.up : col.down; const y0 = sy(0), y1 = sy(v); ctx.fillRect(Math.round(X(i) - cw / 2), Math.min(y0, y1), Math.max(1, Math.round(cw)), Math.max(1, Math.abs(y1 - y0))); }); ctx.globalAlpha = 1; if (C.zeroLine) lvl(0, sy); }
        C.lines.forEach((a, k) => this.line(a, vis, X, sy, [col.s1, col.s3, col.s2][k % 3], 1.5));
        // 第二組線（例如累計買超、融資餘額）用自己的刻度，數值標在右側
        if (C.lines2) {
          const v2 = C.lines2.flat().filter(v => v != null); let lo2 = Math.min(...v2), hi2 = Math.max(...v2); if (hi2 === lo2) { hi2 += 1; lo2 -= 1; }
          const sy2 = Z(v => subTop + 4 + (hi2 - v) / (hi2 - lo2) * (subH - 8), C.lines2);
          C.lines2.forEach((a, k) => this.line(a, vis, X, sy2, [col.s2, col.accent][k % 2], 1.5));
          ctx.fillStyle = col.muted; ctx.textAlign = "left"; const f2 = C.fmt || fmtN; ctx.fillText(f2(hi2), L + pw + 4, subTop + 10); ctx.fillText(f2(lo2), L + pw + 4, subTop + subH - 2);
        }
        this.subY = sy;
      } else if (sub === "macd") {
        const { dif, sig, osc } = I.macd; let m = 0;
        for (let i = 0; i < vis; i++) if (dif[i] != null) m = Math.max(m, Math.abs(dif[i]), Math.abs(sig[i] ?? 0), Math.abs(osc[i] ?? 0));
        m = m || 1; const sy = Z(v => subTop + subH / 2 - v / m * (subH / 2 - 4), [dif, sig, osc]); this.subY = sy;
        lvl(0, sy);
        ctx.globalAlpha = 0.55;
        for (let i = va; i < Math.min(vis, vb + 1); i++) if (osc[i] != null) { ctx.fillStyle = osc[i] >= 0 ? col.up : col.down; const y0 = sy(0), y1 = sy(osc[i]); ctx.fillRect(Math.round(X(i) - cw / 2), Math.min(y0, y1), Math.max(1, Math.round(cw)), Math.abs(y1 - y0)); }
        ctx.globalAlpha = 1;
        this.line(dif, vis, X, sy, col.s1, 1.5); this.line(sig, vis, X, sy, col.s3, 1.5);
      }
      const subY = this.subY || (v => subTop + (100 - v) / 100 * subH);
      ctx.save(); ctx.beginPath(); ctx.rect(L, subTop, pw, subH); ctx.clip();
      divs.filter(m => m.div.ind === (sub === "custom" ? "pane" : sub)).forEach(m => divLine(X(m.div.i1), subY(m.div.v1), X(m.div.i2), subY(m.div.v2), m.side === "buy" ? col.up : col.down));
      // 副圖上發出訊號的位置：半透明實心點；記下位置，等所有區塊畫完再用虛線連到主圖的圓圈
      sigs.filter(g => g.si === si && g.i >= va && g.i <= vb).forEach(g => {
        const x = X(g.i), y = subY(g.v), c = g.side === "buy" ? col.up : col.down, on = this.hover === g.i;
        ctx.fillStyle = c; ctx.globalAlpha = on ? 0.95 : 0.55; ctx.beginPath(); ctx.arc(x, y, on ? 4 : 3.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        const ln = (this.sigLinks || []).find(q => q.i === g.i && q.side === g.side); if (ln && ln.y2 == null) ln.y2 = y;
      });
      ctx.restore();
      ctx.restore(); // 副圖裁切結束
      ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.font = `11px ${cssVar("--font-body")}`;
      const ttl = sub === "custom" ? C0.title : { rsi: "RSI 14", kd: "KD 9", macd: "MACD", wr: "威廉 %R 14", inout: "外盤比（%）" }[sub] || "";
      ctx.fillText(ttl, L + 4, subTop + 8);
      // 縮放狀態標在標題旁邊，不壓到線
      if (pzz.z !== 1 || Chart.prefs.fit) { const tx = L + 4 + ctx.measureText(ttl).width + 10; ctx.fillStyle = col.accent; ctx.font = `10px ${cssVar("--font-body")}`; ctx.fillText(Chart.prefs.fit ? "貼合資料" + (pzz.z !== 1 ? `・${+pzz.z.toFixed(1)}×` : "") : `放大 ${+pzz.z.toFixed(1)}×`, tx, subTop + 8); }
      ctx.font = `11px ${cssVar("--font-mono")}`;
    });

    // 日期軸
    const axY = H - axisH / 2 - 4, every = Math.max(1, Math.ceil(64 / bw));
    ctx.fillStyle = col.muted; ctx.textAlign = "center";
    for (let i = Math.ceil(va / every) * every; i <= vb; i += every) { if (i >= vis && !o.cutoff) continue; ctx.fillText(fmtD(D[i].d), Math.min(Math.max(X(i), L + 18), L + pw - 18), axY); }

    // 主圖圓圈 ↔ 副圖訊號點：半透明虛線（游標停在那一天時加深）
    (this.sigLinks || []).filter(q => q.y2 != null).forEach(q => {
      ctx.strokeStyle = q.c; ctx.lineWidth = 1; ctx.globalAlpha = q.on ? 0.75 : 0.22; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(q.x) + 0.5, q.y); ctx.lineTo(Math.round(q.x) + 0.5, q.y2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    this.renderSigUi(subs);
    // 十字線
    const hi_ = this.hover != null && this.hover < vis ? this.hover : null;
    if (hi_ != null) {
      // 日期標籤（十字線固定時一直顯示，再點一下圖表取消）
      ctx.font = `600 10.5px ${cssVar("--font-mono")}`; const dt = fmtD(D[hi_].d), dw = ctx.measureText(dt).width + 10, dx = Math.min(Math.max(X(hi_) - dw / 2, L), L + pw - dw);
      ctx.fillStyle = this.pinned ? col.accent : col.ink; ctx.fillRect(dx, H - axisH - 6, dw, axisH - 2); ctx.fillStyle = col.surface; ctx.textAlign = "center"; ctx.fillText(dt, dx + dw / 2, H - axisH / 2 - 4); ctx.font = `11px ${cssVar("--font-mono")}`;
      ctx.strokeStyle = this.pinned ? col.accent : col.muted; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(Math.round(X(hi_)) + 0.5, top0); ctx.lineTo(Math.round(X(hi_)) + 0.5, H - axisH - 6); ctx.stroke();
      const y = Y(D[hi_].c); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = this.pinned ? col.accent : col.ink; ctx.fillRect(L + pw + 2, y - 9, R - 4, 18); ctx.fillStyle = col.surface; ctx.textAlign = "left"; ctx.fillText(fmtP(D[hi_].c), L + pw + 6, y);
    }
    this.canvas.setAttribute("aria-label", `K線圖，共 ${vis} 個交易日，最後收盤 ${fmtP(D[vis - 1].c)}`);
    this.renderLegend(hi_ ?? vis - 1, mas);
    if (this.onHover) this.onHover(hi_ ?? vis - 1);
    if (this.onRange) this.onRange(this.range, this);
    if (fa !== va) ctx.clearRect(0, top0, L - 0.5, H - axisH - 8 - top0); // 小數起點時最左邊那根 K 棒只露出一部分：把超出左邊界的部分擦掉
    if (this.needY) { this.needY = false; this.req(); }
  }
  // 副圖訊號開關：放在圖表上方的一列（不再疊在副圖上擋住線），每個副圖的「金叉死叉」「只看重點」各自獨立開關
  renderSigUi(subs) {
    if (!this.sigUi) {
      this.sigUi = document.createElement("div"); this.sigUi.className = "sigbar"; this.host.insertBefore(this.sigUi, this.canvas);
      this.sigUi.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; e.stopPropagation(); const P = Chart.prefs, k = b.dataset.sk || b.dataset.strongk;
        if (!P.sig) Chart.setPref("sig", true);
        if (b.dataset.sk) Chart.setPref("sigKinds", { ...P.sigKinds, [k]: P.sigKinds[k] === false });
        else if (b.dataset.strongk) Chart.setPref("sigStrongK", { ...P.sigStrongK, [k]: !P.sigStrongK[k] }); });
    }
    if (this.o.subSignals === false) { this.sigUi.innerHTML = ""; this.sigUi.hidden = true; return; }
    const P = Chart.prefs, NM = { kd: "KD", macd: "MACD", rsi: "RSI", wr: "威廉", custom: "副圖" };
    const html = subs.map(S => {
      const kind = typeof S === "string" ? S : "custom"; if (!["kd", "macd", "rsi", "wr"].includes(kind) && !(S?.custom?.lines?.length >= 2 && S.custom.signals !== false)) return "";
      const on = P.sig && P.sigKinds[kind] !== false, st = P.sig && !!P.sigStrongK[kind];
      return `<span class="sg"><em>${NM[kind]}</em><button type="button" data-sk="${kind}" aria-pressed="${on}" title="在主圖標出這個副圖的全部訊號">${kind === "rsi" || kind === "wr" ? "超買超賣" : "金叉死叉"}</button>${kind === "kd" || kind === "macd" ? `<button type="button" data-strongk="${kind}" aria-pressed="${st}" title="${kind === "kd" ? "KD 只標低檔（D<20）金叉、高檔（D>80）死叉" : "MACD 只標零軸上金叉、零軸下死叉"}">只看重點</button>` : ""}</span>`;
    }).join("");
    this.sigUi.hidden = !html; if (this.sigUi.innerHTML !== html) this.sigUi.innerHTML = html;
  }
  line(a, vis, X, Y, color, w, alpha = 1, dash) {
    const ctx = this.ctx, g = this.geo; ctx.save(); ctx.beginPath(); ctx.rect(g.L, 0, g.pw, g.H); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); let s = false;
    for (let i = 0; i < vis; i++) { if (a[i] == null) { s = false; continue; } s ? ctx.lineTo(X(i), Y(a[i])) : ctx.moveTo(X(i), Y(a[i])); s = true; }
    ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.restore();
  }
  renderLegend(i, mas) {
    const { D, I, o } = this, k = D[i], prev = D[i - 1], ch = prev ? (k.c - prev.c) / prev.c : 0, cls = ch > 0 ? "up" : ch < 0 ? "down" : "";
    const parts = [
      `<span><b>${k.sim ? `${k.d}（模擬，不是真實走勢）` : k.d.replace(/-/g, "/")}</b></span>`,
      `<span><b>開</b>${fmtP(k.o)}</span>`, `<span><b>高</b>${fmtP(k.h)}</span>`, `<span><b>低</b>${fmtP(k.l)}</span>`,
      `<span class="${cls}"><b>收</b>${fmtP(k.c)} ${prev ? fmtPct(ch) : ""}</span>`,
      ];
    if (!o.noVol) parts.push(`<span><b>量</b>${o.volLabel ? Math.round(k.v) : k.v.toLocaleString()}</span>`);
    mas.forEach(m => parts.push(`<span style="color:${m.c}"><b style="color:inherit">MA${m.n}</b>${fmtP(m.a[i])}</span>`));
    (this.sigs || []).filter(g => g.i === i).forEach(g => parts.push(`<span class="${g.side === "buy" ? "up" : "down"}"><b style="color:inherit">${g.side === "buy" ? "○ 偏多" : "○ 偏空"}</b>${g.label}</span>`));
    if (o.vwap) parts.push(`<span style="color:var(--vwap)"><b style="color:inherit">VWAP</b>${fmtP(I.vwap[i])}</span>`);
    if (o.vp && this.vpData) { const V = this.vpData; parts.push(`<span><b>籌碼</b>獲利 ${(V.profit * 100).toFixed(1)}%</span><span style="color:#f0883e"><b style="color:inherit">壓力</b>${fmtP(V.pre)}</span><span style="color:var(--muted)"><b style="color:inherit">均成本</b>${fmtP(V.avg)}</span><span style="color:#3b82f6"><b style="color:inherit">支撐</b>${fmtP(V.sup)}</span>`); }
    if (o.boll) parts.push(`<span style="color:var(--accent)"><b style="color:inherit">布林</b>${fmtP(I.boll.up[i])} / ${fmtP(I.boll.lo[i])}</span>`);
    (o.subs || (o.sub ? [o.sub] : [])).filter(Boolean).forEach(S => {
      const sub = typeof S === "string" ? S : "custom", C0 = typeof S === "string" ? null : S.custom;
      if (sub === "wr") parts.push(`<span style="color:var(--s2)"><b style="color:inherit">%R</b>${fmtN(I.wr[i])}</span>`);
      if (sub === "inout" && I.io) parts.push(`<span><b>外盤</b>${D[i].ov.toLocaleString()}</span><span><b>內盤</b>${D[i].iv.toLocaleString()}</span><span style="color:var(--s1)"><b style="color:inherit">外盤比</b>${fmtN(I.io[i])}%（5日 ${fmtN(I.io5[i])}%）</span>`);
      if (sub === "rsi") parts.push(`<span style="color:var(--s2)"><b style="color:inherit">RSI</b>${fmtN(I.rsi[i])}</span>`);
      if (sub === "kd") parts.push(`<span style="color:var(--s1)"><b style="color:inherit">K</b>${fmtN(I.kd.K[i])}</span><span style="color:var(--s3)"><b style="color:inherit">D</b>${fmtN(I.kd.D[i])}</span>`);
      if (sub === "macd") parts.push(`<span style="color:var(--s1)"><b style="color:inherit">DIF</b>${fmtN(I.macd.dif[i], 2)}</span><span style="color:var(--s3)"><b style="color:inherit">MACD</b>${fmtN(I.macd.sig[i], 2)}</span><span><b>OSC</b>${fmtN(I.macd.osc[i], 2)}</span>`);
      if (sub === "custom") {
        const f = C0.fmt || fmtN;
        if (C0.bars && C0.barName) parts.push(`<span><b>${C0.barName}</b>${f(C0.bars[i])}</span>`);
        C0.lines.forEach((a, n) => parts.push(`<span style="color:var(${["--s1", "--s3", "--s2"][n % 3]})"><b style="color:inherit">${C0.names[n]}</b>${f(a[i])}</span>`));
        (C0.lines2 || []).forEach((a, n) => parts.push(`<span style="color:var(${["--s2", "--accent"][n % 2]})"><b style="color:inherit">${C0.names2[n]}</b>${f(a[i])}</span>`));
      }
    });
    if (o.compare?.length && this.cmpNow) parts.push(`<span><b>比較</b>本檔 ${fmtPct((this.cmpSelf ?? 0) / 100)}</span>` + this.cmpNow.map(c => `<span style="color:${c.color}"><b style="color:inherit">${c.name}</b>${c.pct == null ? "—" : fmtPct(c.pct / 100)}</span>`).join(""));
    const mk = (o.markers || []).filter(m => m.i === i).map(m => m.label);
    if (mk.length) parts.push(`<span style="color:var(--accent)"><b style="color:inherit">訊號</b>${mk.join("、")}</span>`);
    this.legend.innerHTML = parts.join("");
  }
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
