"use strict";
/* K線學堂共用的技術分析：訊號與策略、K 線型態、背離、市場結構與聰明錢、型態學、支撐壓力、回測、指標判讀、
   走勢模擬、斐波那契、籌碼與基本面摘要。需要先載入 core.js。K線學堂（index.html）與看盤（watch.html）共用。 */
/* ================= 訊號 ================= */
const crossUp = (a, b, i) => a[i - 1] != null && b[i - 1] != null && a[i] != null && b[i] != null && a[i - 1] <= b[i - 1] && a[i] > b[i];
const crossDn = (a, b, i) => a[i - 1] != null && b[i - 1] != null && a[i] != null && b[i] != null && a[i - 1] >= b[i - 1] && a[i] < b[i];
const Signals = {
  ma(D, I, s = 5, l = 20) { const a = I.ma(s), b = I.ma(l), m = []; for (let i = 1; i < D.length; i++) { if (crossUp(a, b, i)) m.push({ i, side: "buy", label: "黃金交叉" }); else if (crossDn(a, b, i)) m.push({ i, side: "sell", label: "死亡交叉" }); } return m; },
  rsi(D, I) { const r = I.rsi, m = []; for (let i = 1; i < D.length; i++) { if (r[i - 1] == null) continue; if (r[i - 1] < 30 && r[i] >= 30) m.push({ i, side: "buy", label: "脫離超賣" }); else if (r[i - 1] > 70 && r[i] <= 70) m.push({ i, side: "sell", label: "跌離超買" }); } return m; },
  kd(D, I) { const { K, D: d } = I.kd, m = []; for (let i = 1; i < D.length; i++) { if (crossUp(K, d, i) && d[i] < 20) m.push({ i, side: "buy", label: "低檔金叉" }); else if (crossDn(K, d, i) && d[i] > 80) m.push({ i, side: "sell", label: "高檔死叉" }); } return m; },
  macd(D, I) { const { dif, sig } = I.macd, m = []; for (let i = 1; i < D.length; i++) { if (crossUp(dif, sig, i)) m.push({ i, side: "buy", label: "DIF上穿" }); else if (crossDn(dif, sig, i)) m.push({ i, side: "sell", label: "DIF下穿" }); } return m; },
  // VWAP：收盤由下往上站上 VWAP、由上往下跌破 VWAP（只取 VWAP 本身向上／向下的那一側，減少盤整時的來回訊號）
  vwap(D, I) { const v = I.vwap, m = []; for (let i = 2; i < D.length; i++) { if (v[i] == null || v[i - 1] == null || v[i - 2] == null) continue; if (D[i].c > v[i] && D[i - 1].c <= v[i - 1] && v[i] >= v[i - 2]) m.push({ i, side: "buy", label: "站上VWAP" }); else if (D[i].c < v[i] && D[i - 1].c >= v[i - 1] && v[i] <= v[i - 2]) m.push({ i, side: "sell", label: "跌破VWAP" }); } return m; },
  boll(D, I) { const { up, lo } = I.boll, m = []; for (let i = 1; i < D.length; i++) { if (lo[i] == null || lo[i - 1] == null) continue; if (D[i].c < lo[i] && D[i - 1].c >= lo[i - 1]) m.push({ i, side: "buy", label: "跌破下軌" }); else if (D[i].c > up[i] && D[i - 1].c <= up[i - 1]) m.push({ i, side: "sell", label: "突破上軌" }); } return m; },
  vol(D, I) { const m = []; for (let i = 20; i < D.length; i++) if (D[i].v > 2 * I.vma[i - 1]) m.push({ i, side: D[i].c >= D[i].o ? "buy" : "sell", label: "爆量", note: true }); return m; },
  candle(D, I, only) {
    const m = [];
    for (let i = 5; i < D.length; i++) {
      const id = detectPattern(D, i);
      if (!id || (only && !only.includes(id))) continue;
      const P = PATTERNS[id];
      m.push({ i, pat: id, label: P.name, side: P.side === "note" ? (fellAt(D, i) ? "buy" : "sell") : P.side, note: P.side === "note" });
    }
    return m;
  },
  wr(D, I) { const r = I.wr, m = []; for (let i = 1; i < D.length; i++) { if (r[i - 1] == null) continue; if (r[i - 1] < -80 && r[i] >= -80) m.push({ i, side: "buy", label: "脫離超賣" }); else if (r[i - 1] > -20 && r[i] <= -20) m.push({ i, side: "sell", label: "跌離超買" }); } return m; },
  // 結構突破：dow 風格叫「延續 / 反轉」，smc 風格叫 BOS / CHoCH；附一條從被突破的轉折點畫到突破日的水平線
  structure(D, I, style = "smc", only) {
    return marketStructure(D).events.filter(e => !only || e.kind === only).map(e => ({ i: e.i, side: e.dir > 0 ? "buy" : "sell", label: style === "dow" ? (e.kind === "CHoCH" ? "反轉" : "延續") : e.kind,
      shapes: [{ pts: [[e.from, e.level], [e.i, e.level]], color: e.dir > 0 ? "up" : "down", dash: [4, 3], width: 1.3 }] }));
  },
  sweep(D) { return marketStructure(D).sweeps.map(s => ({ i: s.i, side: s.dir > 0 ? "buy" : "sell", label: "掃流動性", note: true })); },
  // 波段之後第一次回到 50%～78.6% 黃金區、並收出順勢 K 棒
  fib(D) {
    const f = fibLevels(D); if (!f) return [];
    const a = f.ret[3].price, b = f.ret[5].price, lo = Math.min(a, b), hi = Math.max(a, b);
    for (let i = f.b.i + 5; i < D.length; i++) { // 波段終點要右側 5 根才確認
      const d = D[i], inZone = f.up ? d.l <= hi && d.l >= lo - (hi - lo) * 0.5 : d.h >= lo && d.h <= hi + (hi - lo) * 0.5;
      if (inZone && (f.up ? d.c > d.o : d.c < d.o)) return [{ i, side: f.up ? "buy" : "sell", label: "回測黃金區" }];
      if (f.up ? d.c < f.a.p : d.c > f.a.p) break; // 跌破波段起點，這組回撤就失效了
    }
    return [];
  },
  chartPat(D, I, only) {
    return chartPatterns(D).filter(f => !only || only.includes(f.id)).map(f => {
      const P = CHART_PATTERNS[f.id], col = f.side === "buy" ? "up" : "down", lines = f.neck ? [f.neck] : f.lines;
      return { i: f.k, pat: f.id, side: f.side, label: `${P.name}${f.side === "buy" ? "突破" : "跌破"}`, shapes: [
        { pts: [...f.pts.map(t => [t.i, t.p]), [f.k, D[f.k].c]], color: "accent", width: 1.6 },
        ...lines.map(([a, b]) => ({ pts: [[a.i, a.p], [f.k + 3, lineAt(a, b, f.k + 3)]], color: "muted", dash: [5, 4], width: 1.2 })),
        { pts: [[f.k, f.target], [f.k + 15, f.target]], color: col, dash: [2, 3], width: 1.4, label: `目標 ${fmtP(f.target)}` },
      ] };
    });
  },
  // 型態學突破（逐日重算、只保留當天就看得到的突破）：給策略回測用，避免之後的資料把當時的訊號改掉
  chartPatLive(D, I, only) { const out = []; for (let k = 30; k < D.length; k++) out.push(...Signals.chartPat(D.slice(0, k + 1), I, only).filter(m => m.i === k)); return out; },
  // 背離：比較相鄰兩個轉折點的價格與指標；轉折點要右側 w 根才確認，所以標記畫在確認那天
  div(D, I, ind = "rsi", mode = "regular", upto = D.length) { return divergences(D, I, ind, mode, upto); },
};

/* ---------- K 線型態 ----------
   bars 是型態示意圖用的 [開, 高, 低, 收]，前面幾根是型態出現前的走勢（畫成淡色），最後 n 根是型態本身。 */
const CTX_DN = [[78, 80, 68, 70], [70, 72, 60, 61], [61, 63, 50, 52]], CTX_UP = [[22, 30, 20, 28], [28, 39, 27, 37], [37, 48, 36, 46]];
const PATTERNS = {
  hammer: { name: "錘子線", side: "buy", n: 1, bars: [...CTX_DN, [50, 52, 36, 51.5]], desc: "下跌後出現，下影線至少是實體兩倍：盤中殺低後被買盤拉回。" },
  hanging: { name: "吊人線", side: "sell", n: 1, bars: [...CTX_UP, [47, 49, 34, 48.5]], desc: "和錘子線同形，但出現在漲勢末端：盤中已有人大量賣出。" },
  invHammer: { name: "倒狀錘子", side: "buy", n: 1, bars: [...CTX_DN, [50, 63, 49.5, 51.5]], desc: "下跌後出現長上影線：買方開始試探，需要隔天收高確認。" },
  shooting: { name: "流星線", side: "sell", n: 1, bars: [...CTX_UP, [47, 61, 46.5, 46]], desc: "上漲後出現長上影線：衝高後被賣壓打回，漲勢可能到頂。" },
  doji: { name: "十字線", side: "note", n: 1, bars: [...CTX_DN, [51, 57, 45, 51]], desc: "開盤約等於收盤，多空拉鋸。出現在一段趨勢之後代表動能停頓。" },
  bullEngulf: { name: "多頭吞噬", side: "buy", n: 2, bars: [...CTX_DN, [51, 52, 46, 47], [45, 55, 44, 54]], desc: "下跌後一根紅K的實體完全包住前一根綠K：買方一舉扭轉局面。" },
  bearEngulf: { name: "空頭吞噬", side: "sell", n: 2, bars: [...CTX_UP, [46, 50, 45, 49], [51, 52, 42, 43]], desc: "上漲後一根綠K的實體完全包住前一根紅K：賣方全面反攻。" },
  bullHarami: { name: "多頭母子", side: "buy", n: 2, bars: [...CTX_DN, [60, 61, 44, 46], [48, 52, 47, 51]], desc: "長綠K之後出現一根小K，實體藏在前一根裡面：跌勢暫停。" },
  bearHarami: { name: "空頭母子", side: "sell", n: 2, bars: [...CTX_UP, [40, 57, 39, 55], [52, 53, 48, 49]], desc: "長紅K之後出現一根小K，實體藏在前一根裡面：漲勢暫停。" },
  piercing: { name: "貫穿線", side: "buy", n: 2, bars: [...CTX_DN, [60, 61, 48, 49], [46, 57, 45, 56]], desc: "長綠K後開低走高，收盤穿過前一根實體的一半以上。" },
  darkCloud: { name: "烏雲罩頂", side: "sell", n: 2, bars: [...CTX_UP, [40, 53, 39, 52], [55, 56, 44, 45]], desc: "長紅K後開高走低，收盤跌進前一根實體的一半以下。" },
  morningStar: { name: "晨星", side: "buy", n: 3, bars: [...CTX_DN, [60, 61, 47, 48], [45, 47, 42, 44], [46, 57, 45, 56]], desc: "長綠K、小實體星線、長紅K：三天完成由空轉多的換手。" },
  eveningStar: { name: "夜星", side: "sell", n: 3, bars: [...CTX_UP, [40, 53, 39, 52], [55, 58, 54, 56], [54, 55, 42, 43]], desc: "長紅K、小實體星線、長綠K：三天完成由多轉空的換手。" },
  soldiers: { name: "紅三兵", side: "buy", n: 3, bars: [[30, 33, 28, 31], [31, 32, 27, 29], [29, 31, 27, 30], [30, 37, 29, 36], [35, 43, 34, 42], [41, 49, 40, 48]], desc: "連續三根實體飽滿的紅K，每根都在前一根實體內開盤、收得更高。" },
  crows: { name: "黑三兵", side: "sell", n: 3, bars: [[70, 72, 68, 69], [69, 72, 68, 71], [71, 72, 69, 70], [70, 71, 63, 64], [65, 66, 57, 58], [59, 60, 51, 52]], desc: "連續三根實體飽滿的綠K，一路收低，賣壓持續湧出。" },
  gapUp: { name: "向上跳空", side: "buy", n: 1, bars: [[30, 34, 29, 33], [33, 37, 32, 36], [36, 40, 35, 39], [44, 50, 43, 49]], desc: "今天最低價高於昨天最高價，中間留下缺口：買盤急切。" },
  gapDown: { name: "向下跳空", side: "sell", n: 1, bars: [[70, 71, 66, 67], [67, 68, 63, 64], [64, 65, 60, 61], [56, 57, 48, 49]], desc: "今天最高價低於昨天最低價，中間留下缺口：賣壓沉重。" },
};
const fellAt = (D, k) => k >= 5 && D[k].c < D[k - 5].c * 0.97;
const roseAt = (D, k) => k >= 5 && D[k].c > D[k - 5].c * 1.03;
function barInfo(x) { const body = Math.abs(x.c - x.o); return { ...x, body, rng: x.h - x.l, up: x.c > x.o, dn: x.c < x.o, upper: x.h - Math.max(x.o, x.c), lower: Math.min(x.o, x.c) - x.l, mid: (x.o + x.c) / 2, top: Math.max(x.o, x.c), bot: Math.min(x.o, x.c) }; }
// 只用第 i 根以前的資料判斷；同一天符合多種型態時，取 K 棒數最多的
function detectPattern(D, i) {
  if (i < 5) return null;
  let avg = 0; for (let k = i - 10; k < i; k++) avg += Math.abs(D[Math.max(0, k)].c - D[Math.max(0, k)].o); avg /= 10;
  const x = barInfo(D[i]), p = barInfo(D[i - 1]), q = barInfo(D[i - 2]);
  const fell1 = fellAt(D, i - 1), rose1 = roseAt(D, i - 1);
  if (fellAt(D, i - 2) && q.dn && q.body > avg && p.body < q.body * 0.4 && p.top <= q.c + q.body * 0.15 && x.up && x.c > q.mid) return "morningStar";
  if (roseAt(D, i - 2) && q.up && q.body > avg && p.body < q.body * 0.4 && p.bot >= q.c - q.body * 0.15 && x.dn && x.c < q.mid) return "eveningStar";
  const three = [q, p, x];
  if (i >= 8 && !roseAt(D, i - 3) && three.every(b => b.up && b.body > avg * 0.6 && b.upper < b.body * 0.5) && q.c < p.c && p.c < x.c && p.o >= q.o && p.o <= q.c && x.o >= p.o && x.o <= p.c) return "soldiers";
  if (i >= 8 && !fellAt(D, i - 3) && three.every(b => b.dn && b.body > avg * 0.6 && b.lower < b.body * 0.5) && q.c > p.c && p.c > x.c && p.o <= q.o && p.o >= q.c && x.o <= p.o && x.o >= p.c) return "crows";
  if (fell1 && p.dn && x.up && x.o <= p.c && x.c >= p.o && x.body > p.body) return "bullEngulf";
  if (rose1 && p.up && x.dn && x.o >= p.c && x.c <= p.o && x.body > p.body) return "bearEngulf";
  if (fell1 && p.dn && p.body > avg && x.up && x.o < p.c && x.c > p.mid && x.c < p.o) return "piercing";
  if (rose1 && p.up && p.body > avg && x.dn && x.o > p.c && x.c < p.mid && x.c > p.o) return "darkCloud";
  if (fell1 && p.dn && p.body > avg * 1.2 && x.body < p.body * 0.5 && x.top <= p.o && x.bot >= p.c) return "bullHarami";
  if (rose1 && p.up && p.body > avg * 1.2 && x.body < p.body * 0.5 && x.top <= p.c && x.bot >= p.o) return "bearHarami";
  if (x.l > p.h * 1.001) return "gapUp";
  if (x.h < p.l * 0.999) return "gapDown";
  if (x.rng <= 0) return null;
  const fell = fellAt(D, i), rose = roseAt(D, i);
  if (x.body > 0 && x.lower >= 2 * x.body && x.upper <= x.rng * 0.15) return fell ? "hammer" : rose ? "hanging" : null;
  if (x.body > 0 && x.upper >= 2 * x.body && x.lower <= x.rng * 0.15) return fell ? "invHammer" : rose ? "shooting" : null;
  if (x.body <= x.rng * 0.08 && x.rng / x.c > 0.02 && (fell || rose)) return "doji";
  return null;
}
function patternSVG(id) {
  const P = PATTERNS[id], bars = P.bars, n = bars.length, W = 132, H = 84, pad = 6;
  const hi = Math.max(...bars.map(b => b[1])), lo = Math.min(...bars.map(b => b[2]));
  const Y = v => pad + (hi - v) / (hi - lo) * (H - pad * 2), step = (W - pad * 2) / n, bw = Math.min(14, step * 0.55);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${bars.map(([o, h, l, c], k) => {
    const x = pad + step * (k + 0.5), color = c > o ? "var(--up)" : c < o ? "var(--down)" : "var(--ink)", op = k < n - P.n ? 0.3 : 1;
    return `<g opacity="${op}"><line x1="${x}" x2="${x}" y1="${Y(h)}" y2="${Y(l)}" stroke="${color}" stroke-width="1.5"/><rect x="${x - bw / 2}" y="${Y(Math.max(o, c))}" width="${bw}" height="${Math.max(1.5, Y(Math.min(o, c)) - Y(Math.max(o, c)))}" fill="${color}"/></g>`;
  }).join("")}</svg>`;
}

/* ---------- 背離 ----------
   一般背離：價格創新高（低）、指標沒有 → 動能衰退，留意反轉。
   隱藏背離：價格沒創新高（低）、指標卻創了 → 趨勢中的回檔，偏向延續。 */
const DIV_IND = { rsi: "RSI", macd: "MACD", kd: "KD" };
function divergences(D, I, ind = "rsi", mode = "regular", upto = D.length, w = 3) {
  const S = ind === "rsi" ? I.rsi : ind === "macd" ? I.macd.dif : I.kd.K;
  return divergenceCore(D, S, ind, mode, upto, w, (v, bear) => ind === "macd" ? (bear ? v > 0 : v < 0) : (bear ? v >= 55 : v <= 45));
}
// S：任一條指標序列；zone 為 null 時不限制指標所在區間（例如截圖副圖沒有刻度時）
function divergenceCore(D, S, ind, mode, upto, w, zone) {
  if (!zone) zone = () => true;
  const { hi, lo } = pivots(D, w, upto), out = [];
  const push = (a, b, bear, hidden, pa, pb) => {
    const i = b + w; if (i >= upto) return;
    out.push({ i, side: bear ? "sell" : "buy", label: (hidden ? "隱藏" : "") + (bear ? "頂背離" : "底背離"), hidden,
      div: { ind, i1: a, i2: b, p1: pa, p2: pb, v1: S[a], v2: S[b] } });
  };
  const pairs = (list, f) => { for (let k = 1; k < list.length; k++) { const a = list[k - 1], b = list[k]; if (b - a < 5 || b - a > 45 || S[a] == null || S[b] == null) continue; f(a, b); } };
  pairs(hi, (a, b) => {
    if (mode !== "hidden" && D[b].h > D[a].h && S[b] < S[a] && zone(S[a], true)) push(a, b, true, false, D[a].h, D[b].h);
    if (mode !== "regular" && D[b].h < D[a].h && S[b] > S[a]) push(a, b, true, true, D[a].h, D[b].h);
  });
  pairs(lo, (a, b) => {
    if (mode !== "hidden" && D[b].l < D[a].l && S[b] > S[a] && zone(S[a], false)) push(a, b, false, false, D[a].l, D[b].l);
    if (mode !== "regular" && D[b].l > D[a].l && S[b] < S[a]) push(a, b, false, true, D[a].l, D[b].l);
  });
  return out.sort((x, y) => x.i - y.i);
}

// 轉折點（左右各 w 根都比它低 / 高）→ 支撐壓力
function pivots(D, w = 5, upto = D.length) {
  const hi = [], lo = [];
  for (let i = w; i < upto - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) { if (j === i) continue; if (D[j].h >= D[i].h) isH = false; if (D[j].l <= D[i].l) isL = false; }
    if (isH) hi.push(i); if (isL) lo.push(i);
  }
  return { hi, lo };
}
/* ---------- 市場結構（道氏理論 / 聰明錢） ----------
   轉折點要等右側 w 根 K 棒才確認，所以結構事件只用到「當時已經確認」的轉折點。 */
function zigzag(D, w = 3, upto = D.length) {
  const { hi, lo } = pivots(D, w, upto), all = [...hi.map(i => ({ i, p: D[i].h, type: "H" })), ...lo.map(i => ({ i, p: D[i].l, type: "L" }))].sort((a, b) => a.i - b.i), z = [];
  for (const s of all) {
    const last = z[z.length - 1];
    if (last && last.type === s.type) { if (s.type === "H" ? s.p > last.p : s.p < last.p) z[z.length - 1] = s; continue; }
    z.push(s);
  }
  z.forEach((s, k) => { const prev = z.slice(0, k).reverse().find(t => t.type === s.type); s.label = prev ? (s.type === "H" ? (s.p > prev.p ? "HH" : "LH") : (s.p > prev.p ? "HL" : "LL")) : s.type; s.conf = s.i + w; });
  return z;
}
function marketStructure(D, w = 3, upto = D.length) {
  const swings = zigzag(D, w, upto), events = [], sweeps = [], trend = Array(upto).fill(0);
  // 事件只能用「當天已確認」的轉折點：依確認時間逐一加入，同方向的轉折點只有更極端時才取代（和 zigzag 合併規則相同，
  // 但不會因為之後出現更高的高點，就回頭抹掉當時已經確認過的轉折點）
  const { hi, lo } = pivots(D, w, upto), raw = [...hi.map(i => ({ i, p: D[i].h, type: "H", conf: i + w })), ...lo.map(i => ({ i, p: D[i].l, type: "L", conf: i + w }))].sort((a, b) => a.i - b.i);
  let lastH = null, lastL = null, t = 0, si = 0, prev = null;
  for (let k = 0; k < upto; k++) {
    while (si < raw.length && raw[si].conf <= k) { const s = raw[si++]; if (prev && prev.type === s.type && !(s.type === "H" ? s.p > prev.p : s.p < prev.p)) continue; prev = s; if (s.type === "H") lastH = { ...s }; else lastL = { ...s }; }
    const x = D[k];
    if (lastH && !lastH.done && x.c > lastH.p) { events.push({ i: k, dir: 1, kind: t === -1 ? "CHoCH" : "BOS", level: lastH.p, from: lastH.i }); lastH.done = true; t = 1; }
    else if (lastH && !lastH.done && !lastH.swept && x.h > lastH.p && x.c < lastH.p) { sweeps.push({ i: k, dir: -1, level: lastH.p, from: lastH.i }); lastH.swept = true; }
    if (lastL && !lastL.done && x.c < lastL.p) { events.push({ i: k, dir: -1, kind: t === 1 ? "CHoCH" : "BOS", level: lastL.p, from: lastL.i }); lastL.done = true; t = -1; }
    else if (lastL && !lastL.done && !lastL.swept && x.l < lastL.p && x.c > lastL.p) { sweeps.push({ i: k, dir: 1, level: lastL.p, from: lastL.i }); lastL.swept = true; }
    trend[k] = t;
  }
  return { swings, events, sweeps, trend, w };
}
// 訂單塊（突破前最後一根反向 K 棒）與公平價值缺口（三根 K 棒之間的空白）
function smcZones(D, ms, upto = D.length) {
  const zones = [];
  let avg = 0; for (let k = 0; k < upto; k++) avg += D[k].h - D[k].l; avg /= upto;
  ms.events.forEach(e => {
    const sw = ms.swings.filter(s => s.type === (e.dir > 0 ? "L" : "H") && s.i < e.i).pop(); if (!sw) return;
    let ob = -1; for (let k = e.i - 1; k >= sw.i; k--) if (e.dir > 0 ? D[k].c < D[k].o : D[k].c > D[k].o) { ob = k; break; }
    if (ob < 0) ob = sw.i;
    const top = D[ob].h, bot = D[ob].l; let end = upto - 1, hit = false;
    for (let m = e.i + 1; m < upto; m++) if (e.dir > 0 ? D[m].l <= top : D[m].h >= bot) { end = m; hit = true; break; }
    zones.push({ kind: "OB", dir: e.dir, i1: ob, i2: end, top, bot, hit, at: e.i });
  });
  for (let i = 2; i < upto; i++) {
    const up = D[i].l - D[i - 2].h, dn = D[i - 2].l - D[i].h;
    if (Math.max(up, dn) < avg * 0.5) continue;
    const dir = up > 0 ? 1 : -1, top = dir > 0 ? D[i].l : D[i - 2].l, bot = dir > 0 ? D[i - 2].h : D[i].h;
    let end = upto - 1, hit = false;
    for (let m = i + 1; m < upto; m++) if (dir > 0 ? D[m].l <= top : D[m].h >= bot) { end = m; hit = true; break; }
    zones.push({ kind: "FVG", dir, i1: i - 2, i2: end, top, bot, hit, at: i });
  }
  return zones;
}

/* ---------- 型態學（頭肩、雙重頂底、三角形、箱型） ----------
   用轉折點連成的折線比對形狀；頸線被收盤突破才算完成，標記畫在突破那天。 */
const CHART_PATTERNS = {
  hsTop: { name: "頭肩頂", side: "sell", pts: [[0, 30], [14, 62], [28, 45], [44, 84], [60, 46], [76, 62], [88, 45], [100, 22]], lines: [[[28, 45], [60, 46]]], desc: "左肩、頭、右肩三個高點，頭最高。跌破兩個低點連成的頸線，代表多頭結束。" },
  hsBottom: { name: "頭肩底", side: "buy", pts: [[0, 70], [14, 38], [28, 55], [44, 16], [60, 54], [76, 38], [88, 55], [100, 78]], lines: [[[28, 55], [60, 54]]], desc: "頭肩頂的鏡像，出現在下跌之後。突破頸線且帶量，是常見的底部反轉。" },
  dTop: { name: "M 頭", side: "sell", pts: [[0, 28], [22, 80], [44, 52], [66, 79], [86, 50], [100, 26]], lines: [[[44, 52], [100, 52]]], desc: "兩個差不多高的高點，中間的低點就是頸線。又叫雙重頂。" },
  dBottom: { name: "W 底", side: "buy", pts: [[0, 72], [22, 20], [44, 48], [66, 21], [86, 50], [100, 74]], lines: [[[44, 48], [100, 48]]], desc: "兩個差不多低的低點，中間的高點是頸線。又叫雙重底。" },
  ascTri: { name: "上升三角", side: "buy", pts: [[0, 30], [16, 74], [30, 44], [48, 74], [64, 58], [80, 74], [100, 94]], lines: [[[16, 74], [80, 74]], [[30, 44], [64, 58]]], desc: "高點齊平、低點墊高。水平壓力被測試多次，向上突破的機率較高。" },
  descTri: { name: "下降三角", side: "sell", pts: [[0, 70], [16, 26], [30, 56], [48, 26], [64, 42], [80, 26], [100, 6]], lines: [[[16, 26], [80, 26]], [[30, 56], [64, 42]]], desc: "低點齊平、高點降低。水平支撐被測試多次，向下跌破的機率較高。" },
  symTri: { name: "對稱三角", side: "both", pts: [[0, 50], [12, 86], [28, 24], [46, 72], [62, 38], [76, 60], [88, 47], [100, 80]], lines: [[[12, 86], [76, 60]], [[28, 24], [62, 38]]], desc: "高點降低、低點墊高，價格越來越收斂。方向要等突破才知道。" },
  box: { name: "箱型整理", side: "both", pts: [[0, 40], [14, 74], [30, 44], [46, 75], [62, 45], [78, 74], [100, 94]], lines: [[[14, 74], [78, 74]], [[30, 44], [62, 45]]], desc: "高點、低點都差不多，在一個區間來回。突破上緣或跌破下緣才有方向。" },
};
const lineAt = (a, b, k) => a.p + (b.p - a.p) * (k - a.i) / (b.i - a.i || 1);
function chartPatterns(D, upto = D.length, w = 4) {
  const z = zigzag(D, w, upto), found = [], near = (a, b, t) => Math.abs(a - b) / Math.max(a, b) < t;
  // 從 start 之後找第一根收盤突破 f(k) 的 K 棒
  const brk = (start, f, up) => { for (let k = start; k < Math.min(upto, start + 30); k++) { const v = f(k); if (up ? D[k].c > v : D[k].c < v) return k; } return null; };
  const pre = (s, up) => { const j = Math.max(0, s.i - 20); return up ? D[j].c < s.p * 0.97 : D[j].c > s.p * 1.03; }; // 型態前要有一段趨勢
  for (let j = 0; j < z.length; j++) {
    const s = z.slice(Math.max(0, j - 4), j + 1), last = s[s.length - 1], start = last.conf;
    if (s.length === 5) {
      const [a, b, c, d, e] = s;
      if (a.type === "H" && c.p > a.p * 1.02 && c.p > e.p * 1.02 && near(a.p, e.p, 0.05) && pre(a, true)) {
        const k = brk(start, x => lineAt(b, d, x), false); if (k != null) found.push({ id: "hsTop", pts: s, neck: [b, d], k, target: lineAt(b, d, k) - (c.p - lineAt(b, d, c.i)) });
      }
      if (a.type === "L" && c.p < a.p * 0.98 && c.p < e.p * 0.98 && near(a.p, e.p, 0.05) && pre(a, false)) {
        const k = brk(start, x => lineAt(b, d, x), true); if (k != null) found.push({ id: "hsBottom", pts: s, neck: [b, d], k, target: lineAt(b, d, k) + (lineAt(b, d, c.i) - c.p) });
      }
    }
    if (s.length >= 3) {
      const [a, b, c] = s.slice(-3);
      if (a.type === "H" && near(a.p, c.p, 0.03) && (a.p - b.p) / a.p > 0.04 && c.i - a.i >= 8 && pre(a, true)) {
        const k = brk(start, () => b.p, false); if (k != null) found.push({ id: "dTop", pts: [a, b, c], neck: [b, { i: c.i, p: b.p }], k, target: b.p - (Math.max(a.p, c.p) - b.p) });
      }
      if (a.type === "L" && near(a.p, c.p, 0.03) && (b.p - a.p) / b.p > 0.04 && c.i - a.i >= 8 && pre(a, false)) {
        const k = brk(start, () => b.p, true); if (k != null) found.push({ id: "dBottom", pts: [a, b, c], neck: [b, { i: c.i, p: b.p }], k, target: b.p + (b.p - Math.min(a.p, c.p)) });
      }
    }
    if (s.length >= 4) {
      const q = s.slice(-4), H = q.filter(t => t.type === "H"), Lw = q.filter(t => t.type === "L");
      if (H.length === 2 && Lw.length === 2 && q[3].i - q[0].i >= 10) {
        const [h1, h2] = H, [l1, l2] = Lw, hFlat = near(h1.p, h2.p, 0.015), lFlat = near(l1.p, l2.p, 0.015), hDn = h2.p < h1.p * 0.985, lUp = l2.p > l1.p * 1.015, height = (Math.max(h1.p, h2.p) - Math.min(l1.p, l2.p)) / h1.p;
        let id = null;
        if (hFlat && lUp) id = "ascTri"; else if (hDn && lFlat) id = "descTri"; else if (hDn && lUp) id = "symTri"; else if (hFlat && lFlat && height > 0.04) id = "box";
        if (id) {
          const up = x => lineAt(h1, h2, x), dn = x => lineAt(l1, l2, x);
          let k = null, dir = 0;
          for (let x = start; x < Math.min(upto, start + 25); x++) { if (D[x].c > up(x)) { k = x; dir = 1; break; } if (D[x].c < dn(x)) { k = x; dir = -1; break; } }
          if (k != null) found.push({ id, pts: q, lines: [[h1, h2], [l1, l2]], k, dir, target: dir > 0 ? up(k) + (h1.p - l1.p) : dn(k) - (h1.p - l1.p) });
        }
      }
    }
  }
  // 重疊的只留一個（頭肩 > 雙重頂底 > 三角 > 箱型）
  const rank = { hsTop: 0, hsBottom: 0, dTop: 1, dBottom: 1, ascTri: 2, descTri: 2, symTri: 2, box: 3 }, kept = [];
  found.sort((a, b) => rank[a.id] - rank[b.id] || a.k - b.k).forEach(f => {
    const s0 = f.pts[0].i, s1 = f.k;
    if (kept.some(g => Math.min(s1, g.k) - Math.max(s0, g.pts[0].i) > 0.5 * Math.min(s1 - s0, g.k - g.pts[0].i))) return;
    f.side = CHART_PATTERNS[f.id].side === "both" ? (f.dir > 0 ? "buy" : "sell") : CHART_PATTERNS[f.id].side;
    kept.push(f);
  });
  return kept.sort((a, b) => a.k - b.k);
}
function chartPatternSVG(id) {
  const P = CHART_PATTERNS[id], W = 132, H = 84, pad = 8, X = x => pad + x / 100 * (W - 2 * pad), Y = p => pad + (100 - p) / 100 * (H - 2 * pad);
  const c = P.side === "buy" ? "var(--up)" : P.side === "sell" ? "var(--down)" : "var(--accent)";
  const ext = ([[x1, y1], [x2, y2]]) => { const x3 = 100, y3 = y1 + (y2 - y1) * (x3 - x1) / (x2 - x1); return `<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x3)}" y2="${Y(y3)}" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1.2"/>`; };
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${P.lines.map(ext).join("")}<polyline points="${P.pts.map(([x, p]) => `${X(x)},${Y(p)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function srLevels(D, upto = D.length) {
  const { hi, lo } = pivots(D, 5, upto), p = D[upto - 1].c, lines = [], used = [];
  const add = (price, kind, i) => { if (used.some(u => Math.abs(u - price) / price < 0.02)) return; used.push(price); lines.push({ price, kind, i }); };
  hi.map(i => ({ i, v: D[i].h })).filter(x => x.v > p).sort((a, b) => a.v - b.v).slice(0, 2).forEach(x => add(x.v, "壓力", x.i));
  lo.map(i => ({ i, v: D[i].l })).filter(x => x.v < p).sort((a, b) => b.v - a.v).slice(0, 2).forEach(x => add(x.v, "支撐", x.i));
  return lines;
}

/* ================= 回測 =================
   訊號出現後「隔日開盤價」成交；只做多、全額進出。
   成本：買賣各 0.1425% 手續費，賣出另付 0.3% 證交稅。 */
const FEE = 0.001425, TAX = 0.003;
// 回測：訊號出現的隔天以開盤價成交，只做多。
// opt.capital 初始資金（元）；opt.lot 每次買進的最小單位（1 = 零股、1000 = 整張）；opt.useBuy / opt.useSell 是否依買進／賣出訊號交易；
// opt.skip 要略過的訊號（key = 索引＋方向）。手續費 0.1425%（最低 20 元），賣出另計 0.3% 證交稅。
const btKey = s => `${s.i}${s.side}`;
// 證交稅率：股票 0.3%（預設）、ETF 0.1%、債券 ETF（00xxxB）停徵到 2026 年底
const taxOf = c => (/^00\d+B$/.test(c || "") ? 0 : /^00/.test(c || "") ? 0.001 : undefined);
function backtest(D, sigs, opt = {}) {
  const cap = opt.capital || 1e6, lot = opt.lot || 1, useBuy = opt.useBuy !== false, useSell = opt.useSell !== false, skip = opt.skip || new Set();
  const TX = opt.tax ?? TAX, fee = amt => Math.max(20, Math.floor(amt * FEE)), tax = amt => Math.floor(amt * TX); // 手續費與證交稅都是無條件捨去；ETF 證交稅 0.1%
  // 用手上的現金能買幾股（扣掉手續費後取整數單位）
  const canBuy = (money, px) => { let n = Math.floor(money / (px * (1 + FEE)) / lot) * lot; while (n > 0 && n * px + fee(n * px) > money) n -= lot; return n; };
  const at = {}; sigs.forEach(s => { if (s.note || skip.has(btKey(s))) return; if ((s.side === "buy" && useBuy) || (s.side === "sell" && useSell)) at[s.i] = s.side; });
  let cash = cap, sh = 0, pos = null, pending = !useBuy && useSell ? "buy" : null, peak = cap, mdd = 0, costs = 0, missed = 0;
  const trades = [];
  const sell = (i, px, open) => { const amt = sh * px, c = fee(amt) + tax(amt); costs += c; cash += amt - c; trades.push({ ...pos, xi: i, xpx: px, sh, pnl: amt - c - pos.cost, ret: (amt - c) / pos.cost - 1, open }); pos = null; sh = 0; };
  for (let i = 0; i < D.length; i++) {
    if (pending === "buy" && !pos) { const n = canBuy(cash, D[i].o); if (n > 0) { const amt = n * D[i].o, c = fee(amt); costs += c; cash -= amt + c; sh = n; pos = { i, px: D[i].o, cost: amt + c, start: i === 0 && !useBuy }; } else missed++; }
    else if (pending === "sell" && pos) sell(i, D[i].o, false);
    pending = null;
    const eq = cash + sh * D[i].c; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak);
    if (at[i]) pending = at[i];
  }
  const last = D.length - 1;
  if (pos) sell(last, D[last].c, true);
  const wins = trades.filter(t => t.pnl > 0).length;
  // 買進持有：同一筆資金，第一天開盤買進、最後一天收盤賣出（和策略用同樣的成本與交易單位）
  const bn = canBuy(cap, D[0].o), bAmt = bn * D[0].o, sAmt = bn * D[last].c, bhEnd = cap - bAmt - fee(bAmt) * (bn > 0) + (bn > 0 ? sAmt - fee(sAmt) - tax(sAmt) : 0);
  return { trades, cap, end: cash, total: cash / cap - 1, pnl: cash - cap, bh: bhEnd / cap - 1, bhEnd, bhShares: bn, mdd, costs, win: trades.length ? wins / trades.length : null, missed, tooSmall: canBuy(cap, Math.min(...D.map(d => d.o))) === 0 };
}

/* ================= 判讀 ================= */
function readout(D, I, i) {
  const out = [], c = D[i].c;
  const m5 = I.ma(5)[i], m20 = I.ma(20)[i], m60 = I.ma(60)[i];
  if (m5 != null && m20 != null) {
    let t, b;
    if (m60 != null && m5 > m20 && m20 > m60) { t = "多頭排列 5>20>60"; b = 1; }
    else if (m60 != null && m5 < m20 && m20 < m60) { t = "空頭排列 5<20<60"; b = -1; }
    else { t = m5 > m20 ? "短均在月線之上" : "短均在月線之下"; b = m5 > m20 ? 1 : -1; if (m60 == null) t += "（季線未成形）"; }
    out.push({ k: "均線", t, b });
    const bias = (c - m20) / m20;
    out.push({ k: "月線", t: `${c >= m20 ? "站上" : "跌破"}月線，乖離 ${fmtPct(bias, 1)}`, b: Math.abs(bias) > 0.08 ? 0 : (c >= m20 ? 1 : -1), x: Math.abs(bias) > 0.08 ? "乖離過大，留意拉回或反彈" : "" });
  }
  const r = I.rsi[i];
  if (r != null) out.push({ k: "RSI", t: `${fmtN(r)} ${r >= 70 ? "超買區" : r <= 30 ? "超賣區" : r >= 50 ? "偏強" : "偏弱"}`, b: r >= 70 ? 0 : r <= 30 ? 0 : r >= 50 ? 1 : -1, x: r >= 70 ? "強勢但過熱，可能鈍化也可能回檔" : r <= 30 ? "弱勢但跌深，可能鈍化也可能反彈" : "" });
  const K = I.kd.K[i], Dd = I.kd.D[i];
  if (K != null) out.push({ k: "KD", t: `K ${fmtN(K)} / D ${fmtN(Dd)}，${K > Dd ? "K在D上" : "K在D下"}${K >= 80 ? "，高檔" : K <= 20 ? "，低檔" : ""}`, b: K > Dd ? 1 : -1 });
  const { dif, sig, osc } = I.macd;
  if (sig[i] != null) {
    const grow = osc[i - 1] != null && Math.abs(osc[i]) > Math.abs(osc[i - 1]);
    out.push({ k: "MACD", t: `DIF 在訊號線${dif[i] > sig[i] ? "上" : "下"}，柱體${osc[i] >= 0 ? "正" : "負"}且${grow ? "放大" : "縮小"}`, b: dif[i] > sig[i] ? 1 : -1, x: dif[i] > 0 ? "DIF 在零軸上（中期偏多）" : "DIF 在零軸下（中期偏空）" });
  }
  const { up, lo, bw } = I.boll;
  if (up[i] != null) {
    const pb = (c - lo[i]) / (up[i] - lo[i]);
    const win = bw.slice(Math.max(0, i - 60), i + 1).filter(x => x != null);
    const squeeze = bw[i] <= Math.min(...win) * 1.1;
    out.push({ k: "布林", t: pb > 1 ? "收盤在上軌之外" : pb < 0 ? "收盤在下軌之外" : `位於通道 ${Math.round(pb * 100)}% 位置`, b: pb > 0.5 ? 1 : -1, x: squeeze ? "帶寬接近 60 日最窄，波動可能放大" : "" });
  }
  const wr = I.wr && I.wr[i];
  if (wr != null) out.push({ k: "威廉", t: `%R ${fmtN(wr)}${wr >= -20 ? "，超買區" : wr <= -80 ? "，超賣區" : ""}`, b: wr >= -20 || wr <= -80 ? 0 : wr > -50 ? 1 : -1, x: wr >= -20 ? "收盤接近近期高點，強勢時會鈍化" : wr <= -80 ? "收盤接近近期低點，弱勢時會鈍化" : "" });
  if (I.io && I.io[i] != null) { const a5 = I.io5[i] ?? I.io[i]; out.push({ k: "內外盤", t: `外盤比 ${Math.round(I.io[i])}%，5 日平均 ${Math.round(a5)}%`, b: a5 > 55 ? 1 : a5 < 45 ? -1 : 0, x: "外盤比高代表買方較主動，但可能有人對敲" }); }
  const ms = marketStructure(D, 3, i + 1), ev = ms.events[ms.events.length - 1];
  if (ev) out.push({ k: "結構", t: `${ev.dir > 0 ? "上升" : "下降"}結構（${i - ev.i ? i - ev.i + " 根前" : "今天"}${ev.dir > 0 ? "向上" : "向下"} ${ev.kind}）`, b: ev.dir, x: ev.kind === "CHoCH" ? "CHoCH：可能的趨勢反轉，等回測確認" : "BOS：順著原趨勢的結構突破" });
  const cp = chartPatterns(D, i + 1).filter(f => f.k >= i - 10).pop();
  if (cp) out.push({ k: "型態", t: `${CHART_PATTERNS[cp.id].name}${cp.side === "buy" ? "向上突破" : "向下跌破"}（${i - cp.k ? i - cp.k + " 根前" : "今天"}）`, b: cp.side === "buy" ? 1 : -1, x: `測量目標約 ${fmtP(cp.target)}` });
  for (let k = i; k >= Math.max(5, i - 2); k--) {
    const id = detectPattern(D, k);
    if (!id) continue;
    const P = PATTERNS[id], ago = i - k;
    out.push({ k: "K線", t: `${ago ? ago + " 根前" : "今天"}出現${P.name}`, b: P.side === "buy" ? 1 : P.side === "sell" ? -1 : 0, x: "型態要等隔天走勢確認" });
    break;
  }
  const dv = ["rsi", "macd"].flatMap(ind => divergences(D, I, ind, "all", i + 1)).filter(m => m.i >= i - 8).sort((a, b) => b.i - a.i)[0];
  if (dv) out.push({ k: "背離", t: `${DIV_IND[dv.div.ind]} ${dv.label}（${i - dv.i ? i - dv.i + " 根前" : "今天"}確認）`, b: dv.side === "buy" ? 1 : -1, x: dv.hidden ? "隱藏背離偏向原趨勢延續" : "動能衰退的警訊，要等價格確認" });
  if (I.vma[i - 1] && D[i].v) {
    const ratio = D[i].v / I.vma[i - 1], upDay = c >= D[i - 1].c;
    out.push({ k: "量能", t: `今日量為 20 日均量 ${ratio.toFixed(1)} 倍，${upDay ? "價漲" : "價跌"}${ratio > 1.2 ? "量增" : ratio < 0.8 ? "量縮" : "量平"}`, b: ratio > 1.2 ? (upDay ? 1 : -1) : 0 });
  }
  return out;
}
function renderReadout(el, items, wide) {
  el.innerHTML = items.map(x => `<div class="ro"><span class="k">${x.k}</span><span>${x.t}${x.x ? `<br><span class="note">${x.x}</span>` : ""}</span><span class="pill ${x.b > 0 ? "bull" : x.b < 0 ? "bear" : "flat"}">${x.b > 0 ? "偏多" : x.b < 0 ? "偏空" : "中性"}</span></div>`).join("");
  if (wide) el.classList.add("grid-ro");
}


/* ---------- 未來走勢模擬（蒙地卡羅） ----------
   從截圖重建的 K 棒取出每日漲跌幅，隨機抽樣接成很多條未來路徑：
   不是預測，而是在「近期波動不變」的假設下，價格可能落在哪裡的機率分布。 */
function simulateFuture(D, { days = 20, mode = "trend", paths = 800, seed = 1, bias = 0 } = {}) {
  const n = D.length, r = mulberry32(seed), avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const rets = []; for (let i = Math.max(1, n - 120); i < n; i++) rets.push(Math.log(D[i].c / D[i - 1].c));
  const mean = avg(rets), sd = Math.sqrt(avg(rets.map(x => (x - mean) ** 2))) || 0.01, resid = rets.map(x => x - mean);
  const recent = D.slice(-60), ranges = recent.map(x => (x.h - x.l) / x.c), gaps = recent.slice(1).map((x, k) => (x.o - recent[k].c) / recent[k].c);
  let drift = 0;
  // 趨勢只延續一半、且有上限：避免把近期漲跌直接外推成大行情
  if (mode === "trend") drift = Math.max(-0.2 * sd, Math.min(0.2 * sd, avg(rets.slice(-20)) * 0.5));
  else if (mode === "tech" || mode === "smc") drift = bias * 0.12 * sd;
  const avgV = avg(D.slice(-20).map(x => x.v)); // 模擬區沿用近期均量，均量線才不會掉下去
  const last = D[n - 1].c, all = Array.from({ length: paths }, () => new Float64Array(days)), mx = new Float64Array(paths), mn = new Float64Array(paths);
  const avgRange = avg(ranges);
  for (let p = 0; p < paths; p++) {
    let c = last, hi = -Infinity, lo = Infinity;
    for (let t = 0; t < days; t++) { c *= Math.exp(drift + resid[Math.floor(r() * resid.length)]); all[p][t] = c; hi = Math.max(hi, c * (1 + avgRange / 2)); lo = Math.min(lo, c * (1 - avgRange / 2)); }
    mx[p] = hi; mn[p] = lo;
  }
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
  const bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  for (let t = 0; t < days; t++) { const col = Array.from(all, a => a[t]).sort((a, b) => a - b); bands.p10.push(q(col, 0.1)); bands.p25.push(q(col, 0.25)); bands.p50.push(q(col, 0.5)); bands.p75.push(q(col, 0.75)); bands.p90.push(q(col, 0.9)); }
  // 示範路徑：挑終點最接近中位數的那一條，畫成 K 棒
  const med = bands.p50[days - 1]; let best = 0; for (let p = 1; p < paths; p++) if (Math.abs(all[p][days - 1] - med) < Math.abs(all[best][days - 1] - med)) best = p;
  // 上下引線：從近期真實 K 棒的上影線、下影線比例抽樣（同一天成對抽），保留原股票「常留長上影」或「常有下影」的個性
  const ups = recent.map(x => (x.h - Math.max(x.o, x.c)) / x.c), dns = recent.map(x => (Math.min(x.o, x.c) - x.l) / x.c);
  let prev = last;
  const bars = Array.from(all[best], (c, t) => {
    const o = prev * (1 + gaps[Math.floor(r() * gaps.length)] * 0.6), j = Math.floor(r() * recent.length);
    const h = Math.max(o, c) + Math.max(0, ups[j]) * c, l = Math.min(o, c) - Math.max(0, dns[j]) * c; prev = c;
    return { d: `模擬 ${t + 1}`, o, h, l, c, v: avgV, sim: true };
  });
  const ends = Array.from(all, a => a[days - 1]).sort((a, b) => a - b);
  const r20 = rets.slice(-20), info = { n: rets.length, mean20: avg(r20), upShare: rets.filter(x => x > 0).length / (rets.length || 1), maxUp: Math.max(...rets), maxDn: Math.min(...rets),
    gapAbs: avg(gaps.map(Math.abs)), upW: avg(ups.map(x => Math.max(0, x))), dnW: avg(dns.map(x => Math.max(0, x))), best };
  return { bars, bands, sd, drift, last, paths, info,
    stats: { p10: q(ends, 0.1), p50: q(ends, 0.5), p90: q(ends, 0.9), up: ends.filter(x => x > last).length / paths },
    touch: (price, above) => Array.from(above ? mx : mn).filter(v => (above ? v >= price : v <= price)).length / paths };
}


// 轉折點折線＋HH / HL / LH / LL 標籤
function zigzagShape(D, tags = true) {
  const z = zigzag(D, 3);
  return { pts: z.map(s => [s.i, s.p]), color: "s2", width: 1.4, tags: tags ? z.map(s => ({ i: s.i, p: s.p, text: s.label, below: s.type === "L" })) : [] };
}
// 聰明錢區塊：訂單塊、公平價值缺口與 50% 均衡線
function smcExtra(D) {
  const ms = marketStructure(D), z = ms.swings, n = D.length;
  const zones = smcZones(D, ms).filter(x => x.kind === "OB" || !x.hit || x.i2 - x.i1 < 25);
  const lastH = [...z].reverse().find(s => s.type === "H"), lastL = [...z].reverse().find(s => s.type === "L");
  const shapes = lastH && lastL ? [{ pts: [[Math.min(lastH.i, lastL.i), (lastH.p + lastL.p) / 2], [n - 1, (lastH.p + lastL.p) / 2]], color: "muted", dash: [6, 4], width: 1.2, label: "均衡 50%" }] : [];
  return { zones, shapes };
}

// 可疊在 K 線上的分析（看盤、截圖練習共用），每一項都對應一堂課；聰明錢拆成五項可以分開看
const OVERLAY_ITEMS = [{ id: "sr", label: "支撐壓力" }, { id: "fib", label: "斐波那契" }, { id: "zz", label: "道氏結構" },
  { id: "smcS", label: "BOS／CHoCH" }, { id: "smcL", label: "流動性" }, { id: "smcOB", label: "訂單塊" }, { id: "smcFVG", label: "FVG" }, { id: "smcPD", label: "溢價折價" },
  { id: "candle", label: "K線型態" }, { id: "cpat", label: "型態學" }, { id: "div", label: "背離" }, { id: "volx", label: "爆量" }];
// 舊版的「聰明錢」一顆按鈕 → 拆開後的四項（在建立指標列之前把存好的選擇換掉）
function overlayMigrate(key) {
  const v = store.get("ind:" + key, null); if (!Array.isArray(v) || !v.includes("smc")) return;
  store.set("ind:" + key, [...new Set(v.flatMap(id => (id === "smc" ? ["smcS", "smcL", "smcOB", "smcFVG"] : [id])))]);
}
function overlayBuild(D, I, has, opt = {}) {
  const ex = { markers: [], shapes: [], zones: [], hlines: [] }; if (D.length < 30) return ex;
  const on = has;
  const safe = f => { try { f(); } catch {} };
  if (on("sr") && !opt.noLines) safe(() => ex.hlines.push(...srLevels(D)));
  if (on("fib")) safe(() => { if (!opt.noLines) ex.hlines.push(...fibLines(D)); const f = fibShape(D); if (f) ex.shapes.push(f); });
  if (on("zz")) safe(() => { ex.shapes.push(zigzagShape(D)); ex.markers.push(...Signals.structure(D, I, "dow")); });
  if (on("smcS")) safe(() => { if (!on("zz")) ex.shapes.push(zigzagShape(D, false)); ex.markers.push(...Signals.structure(D, I, "smc")); });
  if (on("smcL")) safe(() => { ex.shapes.push(...eqShapes(D)); ex.markers.push(...Signals.sweep(D)); });
  if (on("smcOB") || on("smcFVG")) safe(() => { const ms = marketStructure(D);
    ex.zones.push(...smcZones(D, ms).filter(x => (x.kind === "OB" && on("smcOB")) || (x.kind === "FVG" && on("smcFVG") && (!x.hit || x.i2 - x.i1 < 25)))); });
  if (on("smcPD")) safe(() => { const p = premiumDiscount(D); ex.zones.push(...p.zones); ex.shapes.push(...p.shapes.filter(Boolean).filter(s => !(on("fib") && s.color === "accent"))); });
  if (on("candle")) safe(() => ex.markers.push(...Signals.candle(D, I)));
  if (on("cpat")) safe(() => ex.markers.push(...Signals.chartPat(D, I)));
  if (on("div")) safe(() => ex.markers.push(...Signals.div(D, I, "rsi"), ...Signals.div(D, I, "macd")));
  if (on("volx")) safe(() => ex.markers.push(...Signals.vol(D, I)));
  return ex;
}

// 等高點 / 等低點（EQH / EQL）：兩個相鄰的轉折高點幾乎一樣高，上方堆滿停損單，是 SMC 眼中的流動性池
function eqLevels(D, upto = D.length) {
  let avg = 0; for (let k = 0; k < upto; k++) avg += D[k].h - D[k].l; avg /= upto;
  const z = zigzag(D, 3, upto), out = [];
  for (const type of ["H", "L"]) {
    const sw = z.filter(s => s.type === type);
    for (let k = 1; k < sw.length; k++) {
      const a = sw[k - 1], b = sw[k];
      if (Math.abs(a.p - b.p) > avg * 0.35 || b.i - a.i > 40) continue;
      const lvl = type === "H" ? Math.max(a.p, b.p) : Math.min(a.p, b.p);
      let end = upto - 1; for (let m = b.i + 1; m < upto; m++) if (type === "H" ? D[m].h > lvl : D[m].l < lvl) { end = m; break; }
      out.push({ type, i1: a.i, i2: b.i, end, price: lvl, taken: end < upto - 1 });
    }
  }
  return out;
}
function eqShapes(D) {
  return eqLevels(D).map(e => ({ pts: [[e.i1, e.price], [e.end, e.price]], color: e.type === "H" ? "down" : "up", dash: [2, 3], width: 1.4, label: e.type === "H" ? "EQH 買方流動性" : "EQL 賣方流動性" }));
}

/* ---------- 斐波那契回撤與延伸 ----------
   取最近一段明顯的波段（較大的轉折視窗），從起點量到終點：
   回撤 23.6%～78.6% 是回檔可能停下來的位置，延伸 127.2%、161.8% 是突破後常見的目標。 */
const FIB_RET = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1], FIB_EXT = [1.272, 1.618];
function fibSwing(D, upto = D.length) {
  const z = zigzag(D, 5, upto); if (z.length < 2) return null;
  const legs = []; for (let k = Math.max(0, z.length - 6); k < z.length - 1; k++) legs.push({ a: z[k], b: z[k + 1], amp: Math.abs(z[k + 1].p - z[k].p) });
  const big = Math.max(...legs.map(l => l.amp));
  // 最近一段夠大就用最近的；太小（只是回檔裡的小波）就退回前面那段大波段
  const leg = [...legs].reverse().find(l => l.amp >= big * 0.6);
  return { a: leg.a, b: leg.b, up: leg.b.p > leg.a.p };
}
function fibLevels(D, upto = D.length) {
  const s = fibSwing(D, upto); if (!s) return null;
  const rng = s.b.p - s.a.p;
  return { ...s, ret: FIB_RET.map(r => ({ r, price: s.b.p - rng * r })), ext: FIB_EXT.map(r => ({ r, price: s.a.p + rng * r })) };
}
const fibPct = r => `${+(r * 100).toFixed(1)}%`;
function fibLines(D, ext = true) {
  const f = fibLevels(D); if (!f) return [];
  return [...f.ret.map(l => ({ price: l.price, label: `${fibPct(l.r)}  ${fmtP(l.price)}`, i: Math.min(f.a.i, f.b.i), color: l.r === 0.618 || l.r === 0.5 ? "accent" : "muted" })),
    ...(ext ? f.ext.map(l => ({ price: l.price, label: `延伸 ${fibPct(l.r)}  ${fmtP(l.price)}`, i: f.b.i, color: "s2" })) : [])];
}
function fibShape(D) { const f = fibLevels(D); return f ? { pts: [[f.a.i, f.a.p], [f.b.i, f.b.p]], color: "accent", dash: [4, 3], width: 1.6 } : null; }
// 溢價 / 折價區與最佳進場區（OTE，回撤 61.8%～78.6%）
function premiumDiscount(D) {
  const f = fibLevels(D); if (!f) return { zones: [], shapes: [] };
  const n = D.length, eq = (f.a.p + f.b.p) / 2, hi = Math.max(f.a.p, f.b.p), lo = Math.min(f.a.p, f.b.p), i1 = Math.min(f.a.i, f.b.i);
  const o1 = f.ret[4].price, o2 = f.ret[5].price;
  return {
    zones: [{ kind: "溢價區", dir: -1, i1, i2: n - 1, top: hi, bot: eq, alpha: 0.05 }, { kind: "折價區", dir: 1, i1, i2: n - 1, top: eq, bot: lo, alpha: 0.05 },
      { kind: "OTE", dir: f.up ? 1 : -1, color: "accent", alpha: 0.14, i1: f.b.i, i2: n - 1, top: Math.max(o1, o2), bot: Math.min(o1, o2) }],
    shapes: [{ pts: [[i1, eq], [n - 1, eq]], color: "muted", dash: [6, 4], width: 1.2, label: "均衡 50%" }, fibShape(D)],
  };
}


const fmtLots = v => (v == null ? "—" : Math.round(v).toLocaleString());
// 副圖：三大法人（柱：合計買賣超；線：外資累計）
function instSub(rows) {
  let cum = 0;
  return { title: "三大法人買賣超（張）　柱：三大合計　線：外資累計（右軸）", bars: rows.map(r => (r ? r.foreign + r.trust + r.dealer : null)), barName: "三大合計", lines: [], names: [],
    lines2: [rows.map(r => (r ? (cum += r.foreign) : null))], names2: ["外資累計"], zeroLine: true, fmt: fmtLots };
}
// 副圖：融資（柱：每日增減；線：融資餘額）
function marginSub(rows) {
  return { title: "融資（張）　柱：每日增減　線：融資餘額（右軸）", bars: rows.map((r, i) => (r && rows[i - 1] ? r.marginBal - rows[i - 1].marginBal : null)), barName: "融資增減", lines: [], names: [],
    lines2: [rows.map(r => (r ? r.marginBal : null))], names2: ["融資餘額"], zeroLine: true, fmt: fmtLots };
}

// 副圖：賣空（柱：每日融券賣出＋借券賣出；線：融券＋借券賣出餘額）
function shortSub(rows) {
  const t = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
  return { title: "賣空（張）　柱：融券＋借券賣出　線：賣空餘額（右軸）", bars: rows.map(r => (r ? t(r.mSell, r.sSell) : null)), barName: "賣空量", lines: [], names: [], barColor: "down",
    lines2: [rows.map(r => (r ? t(r.mBal, r.sBal) : null))], names2: ["賣空餘額"], fmt: fmtLots };
}
// 賣空摘要：最新一天的賣空量、佔成交量、餘額、5 日變化與回補天數（餘額 ÷ 20 日均量）
function shortStats(D, rows) {
  const S = (rows || []).filter(r => r.mBal != null || r.sBal != null); if (!S.length) return null;
  const last = S[S.length - 1], tot = r => (r.mBal || 0) + (r.sBal || 0), sell = (last.mSell || 0) + (last.sSell || 0);
  const bar = D?.find(x => x.d === last.d), i = D ? D.findIndex(x => x.d === last.d) : -1;
  const v20 = i >= 0 ? D.slice(Math.max(0, i - 19), i + 1).reduce((a, x) => a + (x.v || 0), 0) / Math.min(20, i + 1) : 0;
  const p5 = S[S.length - 6];
  return { d: last.d, sell, ratio: bar?.v ? sell / bar.v : null, mBal: last.mBal, sBal: last.sBal, bal: tot(last), chg5: p5 ? tot(last) - tot(p5) : null, days: v20 ? tot(last) / v20 : null };
}
const alignByDate = (D, rows) => { const m = new Map(rows.map(r => [r.d, r])); return D.map(d => m.get(d.d) || null); };
const signed = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`);
const clsOf = v => (v > 0 ? "up" : v < 0 ? "down" : "");
function streak(rows, k) { const last = rows[rows.length - 1]?.[k]; if (!last) return 0; let n = 0; for (let i = rows.length - 1; i >= 0 && Math.sign(rows[i][k]) === Math.sign(last); i--) n++; return n * Math.sign(last); }
function chipsSummary(j, D) {
  const out = [], inst = j.inst, mg = j.margin;
  if (inst.length) {
    const sum = (k, n) => inst.slice(-n).reduce((a, r) => a + r[k], 0);
    [["foreign", "外資"], ["trust", "投信"], ["dealer", "自營商"]].forEach(([k, t]) => {
      const st = streak(inst, k);
      out.push({ k: t, t: `最近一天 ${signed(inst.at(-1)[k])} 張；5 日 ${signed(sum(k, 5))}、20 日 ${signed(sum(k, 20))} 張${st ? `；連續${st > 0 ? "買超" : "賣超"} ${Math.abs(st)} 天` : ""}`, v: sum(k, 20) });
    });
  }
  if (mg.length >= 21) {
    const a = mg.at(-21).marginBal, b = mg.at(-1).marginBal, chg = a ? b / a - 1 : 0;
    const pc = D.length > 20 ? D.at(-1).c / D.at(-21).c - 1 : 0;
    const quad = pc >= 0 ? (chg >= 0 ? "價漲資增：散戶追價，籌碼偏凌亂，漲勢容易後繼無力" : "價漲資減：籌碼沉澱、由法人或大戶接手，較健康") : (chg >= 0 ? "價跌資增：散戶逢低攤平，下跌可能還沒結束" : "價跌資減：融資退場、賣壓釋放，可能接近落底");
    out.push({ k: "融資", t: `融資餘額 ${fmtLots(b)} 張，20 日 ${fmtPct(chg, 1)}；股價 20 日 ${fmtPct(pc, 1)} → ${quad}`, v: 0 });
    const last = mg.at(-1);
    if (last.marginBal) out.push({ k: "融券", t: `融券餘額 ${fmtLots(last.shortBal)} 張，券資比 ${(last.shortBal / last.marginBal * 100).toFixed(1)}%${last.shortBal / last.marginBal > 0.3 ? "（偏高，上漲時可能出現軋空）" : ""}${last.marginLimit ? `；融資使用率 ${(last.marginBal / last.marginLimit * 100).toFixed(1)}%` : ""}`, v: 0 });
  }
  return out;
}

function fundSummary(j, D) {
  const out = [];
  const per = j.per.filter(r => r.pe != null && r.pe > 0);
  if (j.per.length) {
    const last = j.per.at(-1), pes = per.map(r => r.pe).sort((a, b) => a - b);
    const rank = last.pe > 0 && pes.length > 20 ? pes.filter(v => v <= last.pe).length / pes.length : null;
    out.push({ k: "估值", t: `本益比 ${last.pe > 0 ? last.pe.toFixed(1) + " 倍" : "—（近四季虧損）"}${rank != null ? `，在近 ${Math.round(per.length / 245 * 10) / 10} 年的 ${Math.round(rank * 100)}% 位置（區間 ${pes[0].toFixed(1)}～${pes.at(-1).toFixed(1)} 倍）${rank < 0.2 ? "，相對便宜" : rank > 0.8 ? "，相對昂貴" : ""}` : ""}；股價淨值比 ${last.pb != null ? last.pb.toFixed(2) + " 倍" : "—"}；殖利率 ${last.dy != null ? last.dy.toFixed(2) + "%" : "—"}` });
  }
  if (j.revenue.length) {
    const rv = j.revenue, last = rv.at(-1); let up = 0; for (let i = rv.length - 1; i >= 0 && rv[i].yoy > 0; i--) up++;
    const acc = rv.length >= 3 && rv.at(-1).yoy > rv.at(-2).yoy && rv.at(-2).yoy > rv.at(-3).yoy;
    out.push({ k: "營收", t: `${last.ym.replace("-", " 年 ")} 月營收 ${(last.rev / 1e8).toFixed(1)} 億，年增 ${last.yoy != null ? last.yoy + "%" : "—"}、月增 ${last.mom != null ? last.mom + "%" : "—"}${up >= 2 ? `；已連續 ${up} 個月年增` : ""}${acc ? "，而且年增率連續擴大（成長加速）" : ""}` });
  }
  if (j.fin.length) {
    const f = j.fin, ttm = f.slice(-4).reduce((a, x) => a + x.eps, 0), prev = f.length >= 8 ? f.slice(-8, -4).reduce((a, x) => a + x.eps, 0) : null, l = f.at(-1);
    out.push({ k: "獲利", t: `${l.q} EPS ${l.eps.toFixed(2)} 元；近四季合計 ${ttm.toFixed(2)} 元${prev ? `（前四季 ${prev.toFixed(2)} 元，${fmtPct(ttm / prev - 1, 1)}）` : ""}${l.gross != null ? `；毛利率 ${l.gross}%、營益率 ${l.op ?? "—"}%、淨利率 ${l.net ?? "—"}%` : ""}` });
    if (f.length >= 2 && l.gross != null && f.at(-2).gross != null) { const p2 = f.at(-2), three = l.gross > p2.gross && l.op > p2.op && l.net > p2.net, [y, qq] = String(l.q).split("Q"), ly = f.find(x => x.q === `${+y - 1}Q${qq}`), yoy = ly && ly.gross != null && l.gross > ly.gross && l.op > ly.op && l.net > ly.net;
      if (three) out.push({ k: "三率", t: yoy ? "毛利率、營益率、淨利率都比上一季與去年同期高（三率三升）" : "毛利率、營益率、淨利率都比上一季高（季增三升；三率三升還要比去年同期高）" }); }
  }
  return out;
}

/* ---------- K 線組合選股：只看最後一根（今天）是否剛完成這個組合 ----------
   名稱沿用台股常見的叫法，但各家定義不一，這裡把條件寫死在 desc，畫面上照實顯示。 */
const KPAT = (() => {
  const red = (D, i) => D[i].c > D[i].o, black = (D, i) => D[i].c < D[i].o, chg = (D, i) => D[i].c / D[i - 1].c - 1, body = (D, i) => Math.abs(D[i].c - D[i].o) / D[i - 1].c;
  const hi = (D, a, b) => Math.max(...D.slice(a, b + 1).map(x => x.h)), lo = (D, a, b) => Math.min(...D.slice(a, b + 1).map(x => x.l)), avgV = (D, a, b) => D.slice(a, b + 1).reduce((s, x) => s + (x.v || 0), 0) / (b - a + 1);
  const pc = v => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const cannon = (D, n, up) => body(D, n - 2) >= 0.01 && body(D, n) >= 0.01 && (up ? red(D, n - 2) && black(D, n - 1) && red(D, n) && D[n - 1].c >= Math.min(D[n - 2].o, D[n - 2].c) && D[n].c > D[n - 2].c
    : black(D, n - 2) && red(D, n - 1) && black(D, n) && D[n - 1].c <= Math.max(D[n - 2].o, D[n - 2].c) && D[n].c < D[n - 2].c);
  const box = (D, n, k) => (hi(D, n - k, n - 1) - lo(D, n - k, n - 1)) / D[n - 1].c;
  const vee = (D, n, up) => { // 先跌（漲）≥ 7%，再收復一半以上；轉折點在最近 2～4 根
    for (let m = n - 4; m <= n - 2; m++) { if (m < 6) continue;
      const ext = up ? Math.max(...D.slice(m - 6, m).map(x => x.c)) : Math.min(...D.slice(m - 6, m).map(x => x.c)), mv = D[m].c / ext - 1;
      const isExt = D.slice(m - 2, n + 1).every(x => (up ? x.c >= D[m].c : x.c <= D[m].c));
      if (isExt && (up ? mv <= -0.07 : mv >= 0.07) && Math.abs(D[n].c - D[m].c) >= Math.abs(ext - D[m].c) * 0.5 && (up ? red(D, n) && D[n].c > D[n - 1].c : black(D, n) && D[n].c < D[n - 1].c)) return `${up ? "跌" : "漲"} ${pc(mv)} 後收復 ${Math.round(Math.abs(D[n].c - D[m].c) / Math.abs(ext - D[m].c) * 100)}%`;
    } return null; };
  const L = [
    ["boom", "bull", "噴薄而出", "前 10 天盤整（高低差 < 10%），今天漲 ≥ 4%、收盤突破盤整高點，量 ≥ 前 10 天均量 2 倍",
      (D, n) => box(D, n, 10) < 0.1 && chg(D, n) >= 0.04 && D[n].c > hi(D, n - 10, n - 1) && D[n].v >= 2 * avgV(D, n - 10, n - 1) ? `漲 ${pc(chg(D, n))}・量 ${(D[n].v / avgV(D, n - 10, n - 1)).toFixed(1)} 倍` : null],
    ["sky", "bull", "直上青雲", "連續 5 根紅 K、收盤一天比一天高，5 天合計漲 ≥ 8%",
      (D, n) => [0, 1, 2, 3, 4].every(k => red(D, n - k) && D[n - k].c > D[n - k - 1].c) && D[n].c / D[n - 5].c - 1 >= 0.08 ? `5 天 ${pc(D[n].c / D[n - 5].c - 1)}` : null],
    ["vrev", "bull", "V 型反轉", "最近 6 天內跌 ≥ 7% 打出低點，之後收復跌幅一半以上，今天收紅",
      (D, n) => vee(D, n, true)],
    ["cannon2", "bull", "疊疊多方炮", "紅黑紅黑紅：連續兩組多方炮，收盤一組比一組高",
      (D, n) => cannon(D, n, true) && cannon(D, n - 2, true) && D[n].c > D[n - 2].c && D[n - 2].c > D[n - 4].c ? `5 天 ${pc(D[n].c / D[n - 5].c - 1)}` : null],
    ["cannon", "bull", "多方炮", "兩紅夾一黑：兩根紅 K 實體都 ≥ 1%，中間的黑 K 沒跌破前一根紅 K 的實體，今天紅 K 收在前一根紅 K 之上",
      (D, n) => cannon(D, n, true) ? `今天 ${pc(chg(D, n))}` : null],
    ["sesame", "bull", "芝麻開花", "前 4 根都是小 K（實體 < 1.5%）、高低差 < 5%，今天長紅 ≥ 3% 突破這段高點",
      (D, n) => [1, 2, 3, 4].every(k => body(D, n - k) < 0.015) && box(D, n, 4) < 0.05 && red(D, n) && chg(D, n) >= 0.03 && D[n].c > hi(D, n - 4, n - 1) ? `今天 ${pc(chg(D, n))}` : null],
    ["engulf", "bull", "一手遮天", "前 5 天下跌 ≥ 3% 後，今天一根紅 K 的實體包住前 3 根 K 棒的實體",
      (D, n) => D[n - 1].c / D[n - 6].c - 1 <= -0.03 && red(D, n) && D[n].o <= Math.min(...[1, 2, 3].map(k => Math.min(D[n - k].o, D[n - k].c))) && D[n].c >= Math.max(...[1, 2, 3].map(k => Math.max(D[n - k].o, D[n - k].c))) ? `今天 ${pc(chg(D, n))}` : null],
    ["sword", "bull", "彈劍長嘯", "多頭（收盤在 20 日均線上）中先出現一根小 K 休息，今天長紅 ≥ 3% 並創 20 日收盤新高",
      (D, n) => { const m20 = D.slice(n - 20, n).reduce((s, x) => s + x.c, 0) / 20; return D[n - 1].c > m20 && body(D, n - 1) < 0.01 && red(D, n) && chg(D, n) >= 0.03 && D[n].c >= Math.max(...D.slice(n - 20, n).map(x => x.c)) ? `今天 ${pc(chg(D, n))}・創 20 日新高` : null; }],
    ["bcannon", "bear", "空方炮", "兩黑夾一紅：兩根黑 K 實體都 ≥ 1%，中間的紅 K 沒漲過前一根黑 K 的實體，今天黑 K 收在前一根黑 K 之下",
      (D, n) => cannon(D, n, false) ? `今天 ${pc(chg(D, n))}` : null],
    ["drop", "bear", "直下深淵", "連續 5 根黑 K、收盤一天比一天低，5 天合計跌 ≥ 8%",
      (D, n) => [0, 1, 2, 3, 4].every(k => black(D, n - k) && D[n - k].c < D[n - k - 1].c) && D[n].c / D[n - 5].c - 1 <= -0.08 ? `5 天 ${pc(D[n].c / D[n - 5].c - 1)}` : null],
    ["avrev", "bear", "倒 V 反轉", "最近 6 天內漲 ≥ 7% 做出高點，之後回吐漲幅一半以上，今天收黑",
      (D, n) => vee(D, n, false)],
    ["topblack", "bear", "高檔長黑", "昨天收盤在 20 日高點附近（3% 內），今天跌 ≥ 4%、量 ≥ 前 10 天均量 1.5 倍",
      (D, n) => D[n - 1].c >= hi(D, n - 20, n - 1) * 0.97 && chg(D, n) <= -0.04 && D[n].v >= 1.5 * avgV(D, n - 10, n - 1) ? `跌 ${pc(chg(D, n))}` : null],
    ["breakdown", "bear", "跌破盤整", "前 10 天盤整（高低差 < 10%），今天跌 ≥ 3%、收盤跌破盤整低點",
      (D, n) => box(D, n, 10) < 0.1 && chg(D, n) <= -0.03 && D[n].c < lo(D, n - 10, n - 1) ? `跌 ${pc(chg(D, n))}` : null],
  ];
  return L.map(([id, side, name, desc, fn]) => ({ id, side, name, desc, hit(D) { const n = D?.length - 1; if (!(n >= 25)) return null; try { return fn(D, n); } catch { return null; } } }));
})();

/* ---------- 走勢分析：模擬之前先把目前的技術面講清楚（用了哪些分析、各自偏多或偏空、在模擬裡扮演什麼角色） ----------
   use：dir＝決定模擬方向、range＝決定波動範圍、prob＝用來算碰到價位的機率、ref＝只供參考（模擬沒有用） */
function trendAnalysis(D, I, mode = "trend") {
  const n = D.length - 1, c = D[n].c, out = [], pc = v => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const add = (k, t, b, use) => out.push({ k, t, b, use });
  const m20 = I.ma(20), m60 = I.ma(60);
  if (m20[n] != null) {
    const s20 = m20[n - 5] ? m20[n] / m20[n - 5] - 1 : 0;
    add("均線趨勢", `收盤${c >= m20[n] ? "在" : "跌破"}月線（${fmtP(m20[n])}）${m60[n] != null ? `、${c >= m60[n] ? "在" : "跌破"}季線（${fmtP(m60[n])}）` : ""}；月線 5 天${s20 >= 0 ? "上彎" : "下彎"} ${pc(s20)}`,
      (c >= m20[n] ? 1 : -1) + (s20 > 0 ? 1 : -1) > 0 ? 1 : (c >= m20[n] ? 1 : -1) + (s20 > 0 ? 1 : -1) < 0 ? -1 : 0, mode === "tech" ? "dir" : "ref");
  }
  if (n >= 20) { const r20 = c / D[n - 20].c - 1; add("近 20 根漲跌", `${pc(r20)}，平均每天 ${pc(r20 / 20)}`, r20 > 0.02 ? 1 : r20 < -0.02 ? -1 : 0, mode === "trend" ? "dir" : "ref"); }
  try {
    const z = zigzag(D, 3).slice(-4), H = z.filter(s => s.type === "H"), L = z.filter(s => s.type === "L");
    if (H.length >= 2 && L.length >= 2) { const hh = H[1].p > H[0].p, hl = L[1].p > L[0].p;
      add("道氏結構", hh && hl ? "高點、低點都墊高（HH＋HL），上升結構" : !hh && !hl ? "高點、低點都降低（LH＋LL），下降結構" : `高點${hh ? "墊高" : "降低"}、低點${hl ? "墊高" : "降低"}，結構不明確（盤整或轉折中）`, hh && hl ? 1 : !hh && !hl ? -1 : 0, "ref"); }
    const ms = marketStructure(D), ev = ms.events[ms.events.length - 1];
    if (ev) add("聰明錢結構", `${n - ev.i} 根前${ev.dir > 0 ? "向上" : "向下"} ${ev.kind}（${ev.kind === "CHoCH" ? "趨勢轉變" : "趨勢延續"}），突破價 ${fmtP(ev.level)}`, ev.dir, mode === "smc" ? "dir" : "ref");
    const zs = smcZones(D, ms).filter(x => !x.hit), up = zs.filter(x => x.dir < 0 && x.bot > c).sort((a, b) => a.bot - b.bot)[0], dn = zs.filter(x => x.dir > 0 && x.top < c).sort((a, b) => b.top - a.top)[0];
    if (up || dn) add("訂單塊／FVG", `${up ? `上方空方區 ${fmtP(up.bot)}～${fmtP(up.top)}（${pc(up.bot / c - 1)}）` : "上方沒有未回補的空方區"}；${dn ? `下方多方區 ${fmtP(dn.bot)}～${fmtP(dn.top)}（${pc(dn.top / c - 1)}）` : "下方沒有未回補的多方區"}`, 0, "prob");
  } catch {}
  try { const S = srLevels(D), r = S.filter(x => x.kind === "壓力").sort((a, b) => a.price - b.price)[0], s = S.filter(x => x.kind === "支撐").sort((a, b) => b.price - a.price)[0];
    if (r || s) add("支撐壓力", `${r ? `壓力 ${fmtP(r.price)}（${pc(r.price / c - 1)}）` : "上方沒有明顯壓力"}；${s ? `支撐 ${fmtP(s.price)}（${pc(s.price / c - 1)}）` : "下方沒有明顯支撐"}`, 0, "ref"); } catch {}
  try { const f = fibLevels(D); if (f) { const r = Math.abs(f.b.p - c) / Math.abs(f.b.p - f.a.p);
    add("斐波那契", `最近一段${f.up ? "上漲" : "下跌"}波段已回撤 ${(r * 100).toFixed(0)}%；61.8% 在 ${fmtP(f.ret[4].price)}`, f.up ? (r < 0.5 ? 1 : 0) : (r < 0.5 ? -1 : 0), "prob"); } } catch {}
  if (I.rsi[n] != null) add("RSI", `${I.rsi[n].toFixed(0)}（${I.rsi[n] > 70 ? "超買，短線容易拉回" : I.rsi[n] < 30 ? "超賣，短線容易反彈" : I.rsi[n] >= 50 ? "多方較強" : "空方較強"}）`, I.rsi[n] > 70 ? -1 : I.rsi[n] < 30 ? 1 : I.rsi[n] >= 50 ? 1 : -1, mode === "tech" ? "dir" : "ref");
  if (I.kd.K[n] != null) add("KD", `K ${I.kd.K[n].toFixed(0)}／D ${I.kd.D[n].toFixed(0)}，K ${I.kd.K[n] >= I.kd.D[n] ? "在 D 之上" : "在 D 之下"}`, I.kd.K[n] >= I.kd.D[n] ? 1 : -1, mode === "tech" ? "dir" : "ref");
  if (I.macd.osc[n] != null) add("MACD", `柱狀體${I.macd.osc[n] >= 0 ? "為正（紅）" : "為負（綠）"}且${Math.abs(I.macd.osc[n]) >= Math.abs(I.macd.osc[n - 1] ?? 0) ? "放大" : "縮小"}`, I.macd.osc[n] >= 0 ? 1 : -1, mode === "tech" ? "dir" : "ref");
  if (D.some(x => x.v)) { const v20 = D.slice(Math.max(0, n - 20), n).reduce((s, x) => s + (x.v || 0), 0) / Math.min(20, n); if (v20) add("量能", `最後一根量是 20 日均量的 ${(D[n].v / v20).toFixed(1)} 倍${D[n].v > 1.5 * v20 ? "（放量）" : D[n].v < 0.6 * v20 ? "（量縮）" : ""}`, 0, "ref"); }
  const rets = D.slice(-121).map((x, k, a) => (k ? Math.log(x.c / a[k - 1].c) : null)).filter(v => v != null), mu = rets.reduce((s, v) => s + v, 0) / (rets.length || 1), sd = Math.sqrt(rets.reduce((s, v) => s + (v - mu) ** 2, 0) / (rets.length || 1));
  add("波動度", `近 ${rets.length} 根每日漲跌的標準差約 ${(sd * 100).toFixed(1)}%，決定模擬機率帶的寬度`, 0, "range");
  return out;
}
