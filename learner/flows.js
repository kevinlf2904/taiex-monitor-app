/* 板塊資金流向（看盤頁「資金」分頁）：只用公開資料自己算，不是任何網站的數據。
   - 個股金額（億元）＝ 三大法人買賣超（張）× 1000 股 × 收盤價 ÷ 1 億；用收盤價估算，和實際成交金額會有小誤差。
   - 板塊：產業地圖的台股題材（industry.js）＋證交所／櫃買中心的產業別。一檔股票可能同時屬於好幾個題材，每個題材都會算到它。
   - 四象限：橫軸是近 5 日淨流入，縱軸是「加速度」＝ 近 5 日 − 前 5 日。
       漲潮：淨流入且加速；輪動：淨流入但放緩；觀望：淨流出但放緩；退潮：淨流出且加速。
   days：[{ date, rows: [[代號, 名稱, 收盤, 漲跌%, 外資張, 投信張, 自營商張, 成交張], ...] }]，由舊到新。 */
const FLOW_Q = { up: ["漲潮", "加速流入", "#e8603c"], rot: ["輪動", "流入但放緩", "#e2b23a"], watch: ["觀望", "流出但放緩", "#9aa3ad"], down: ["退潮", "加速流出", "#22a87a"] };
const flowQuad = (net5, accel) => (net5 > 0 ? (accel > 0 ? "up" : "rot") : accel > 0 ? "watch" : "down");
const amtOf = (lots, px) => (lots * px) / 1e5; // 張 × 收盤價 → 億元

// 板塊清單：題材（產業地圖台股）＋產業別（ind: { 代號: 產業別 }）
function flowSectors(ind) {
  const out = (typeof INDUSTRY_MAP !== "undefined" ? INDUSTRY_MAP.themes : []).filter(t => t.mk === "tw").map(t => ({ id: t.id, name: t.name, kind: "題材", codes: [...new Set(t.segs.flatMap(g => g.c.map(x => x[0])))] }));
  if (ind) { const by = {}; for (const [c, n] of Object.entries(ind)) if (/^\d{4}$/.test(c)) (by[n] ||= []).push(c);
    for (const [n, codes] of Object.entries(by)) if (codes.length >= 3) out.push({ id: "ind:" + n, name: n, kind: "產業", codes }); }
  return out;
}
// 整理成：stocks（每檔每天的金額）與 sectors（每個板塊每天的淨額與平均漲跌）
function flowModel(days, sectors) {
  const T = days.length, stocks = new Map();
  days.forEach((d, t) => { for (const [c, nm, px, pct, f, tr, dl, v] of d.rows) {
    let s = stocks.get(c); if (!s) stocks.set(c, (s = { code: c, name: nm, px: Array(T).fill(null), pct: Array(T).fill(null), amt: Array(T).fill(0), f: Array(T).fill(0), tr: Array(T).fill(0), lots: Array(T).fill(0), v: Array(T).fill(0) }));
    s.name = nm || s.name; s.px[t] = px; s.pct[t] = pct; s.amt[t] = amtOf(f + tr + dl, px); s.f[t] = amtOf(f, px); s.tr[t] = amtOf(tr, px); s.lots[t] = f + tr + dl; s.v[t] = v || 0; } });
  const secs = sectors.map(S => { const mem = S.codes.map(c => stocks.get(c)).filter(Boolean); if (!mem.length) return null;
    const sum = k => Array.from({ length: T }, (_, t) => mem.reduce((a, s) => a + s[k][t], 0));
    const pct = Array.from({ length: T }, (_, t) => { const v = mem.map(s => s.pct[t]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
    return { ...S, mem, net: sum("amt"), f: sum("f"), tr: sum("tr"), pct }; }).filter(Boolean);
  return { dates: days.map(d => d.date), T, stocks, secs };
}
const winSum = (a, t, n) => { let s = 0; for (let k = Math.max(0, t - n + 1); k <= t; k++) s += a[k] || 0; return s; };
const winPct = (a, t, n) => { let p = 1; for (let k = Math.max(0, t - n + 1); k <= t; k++) p *= 1 + (a[k] || 0) / 100; return (p - 1) * 100; };
// 某一天（t）每個板塊的指標
function flowAt(M, t = M.T - 1) {
  return M.secs.map(S => {
    const net5 = winSum(S.net, t, 5), prev5 = t >= 5 ? winSum(S.net, t - 5, 5) : 0, accel = net5 - prev5;
    const m5 = S.mem.map(s => ({ s, a: winSum(s.amt, t, 5) })), top = m5.slice().sort((a, b) => b.a - a.a)[0];
    return { id: S.id, name: S.name, kind: S.kind, net1: S.net[t] || 0, net5, prev5, accel, f5: winSum(S.f, t, 5), tr5: winSum(S.tr, t, 5), f1: S.f[t] || 0, tr1: S.tr[t] || 0,
      pct1: S.pct[t] || 0, pct5: winPct(S.pct, t, 5), n: S.mem.length, buy1: S.mem.filter(s => s.amt[t] > 0).length, buy5: m5.filter(x => x.a > 0).length,
      top: top && top.a > 0 ? top.s.name : null, topSell: m5.slice().sort((a, b) => a.a - b.a)[0]?.s.name || null, q: flowQuad(net5, accel) };
  });
}
// 個股：當日金額、近 5 日、異常倍數
function flowStocks(M, t = M.T - 1) {
  const out = [];
  for (const s of M.stocks.values()) { if (s.px[t] == null) continue;
    const a1 = s.amt[t], prior = [1, 2, 3, 4].map(k => Math.abs(s.amt[t - k] || 0)), avg = prior.reduce((a, b) => a + b, 0) / 4;
    out.push({ code: s.code, name: s.name, px: s.px[t], pct1: s.pct[t], a1, a5: winSum(s.amt, t, 5), f1: s.f[t], tr1: s.tr[t], pct5: winPct(s.pct, t, 5), mult: avg > 0.05 ? Math.abs(a1) / avg : null, v: s.v[t] }); }
  return out;
}
// 今日情緒（0 恐慌 ～ 100 樂觀）：上漲家數比、平均漲跌、漲跌停、法人淨買超，各換成 −1～1 再平均
function flowMood(M, t = M.T - 1) {
  const st = [...M.stocks.values()].filter(s => /^\d{4}$/.test(s.code) && s.pct[t] != null);
  if (!st.length) return null;
  const up = st.filter(s => s.pct[t] > 0).length, dn = st.filter(s => s.pct[t] < 0).length, lu = st.filter(s => s.pct[t] >= 9.5).length, ld = st.filter(s => s.pct[t] <= -9.5).length;
  const avg = st.reduce((a, s) => a + s.pct[t], 0) / st.length, net = st.reduce((a, s) => a + s.amt[t], 0);
  const parts = [["上漲家數比", (up - dn) / Math.max(1, up + dn)], ["平均漲跌", Math.tanh(avg / 1.5)], ["漲跌停", (lu - ld) / (lu + ld + 5)], ["法人淨買超", Math.tanh(net / 300)]];
  const score = Math.round(50 + 50 * parts.reduce((a, p) => a + p[1], 0) / parts.length);
  return { score, label: score < 20 ? "極度恐慌" : score < 40 ? "偏恐慌" : score <= 60 ? "中性" : score <= 80 ? "偏樂觀" : "極度樂觀", up, dn, lu, ld, avg, net, parts };
}
const flowFmt = v => `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)}億`;
// 盤後總結：把數字填進固定句型（不用 AI，不會亂編）
function flowSummary(M, mood, mkPct) {
  const A = flowAt(M), buy = A.filter(x => x.net1 > 0).sort((a, b) => b.net1 - a.net1).slice(0, 3), sell = A.filter(x => x.net1 < 0).sort((a, b) => a.net1 - b.net1).slice(0, 3);
  const S = flowStocks(M), odd = S.filter(x => x.mult >= 3 && Math.abs(x.a1) >= 3).length, L = x => `${x.name}（${flowFmt(x.net1)}）`;
  return `${mkPct != null ? `台股${mkPct >= 0 ? "上漲" : "下跌"} ${Math.abs(mkPct).toFixed(2)}%。` : ""}${mood ? `上漲 ${mood.up} 家、下跌 ${mood.dn} 家，情緒 ${mood.score}（${mood.label}）。` : ""}`
    + (buy.length ? `法人買超最多的板塊是${L(buy[0])}${buy.length > 1 ? `，其次${buy.slice(1).map(L).join("、")}` : ""}；` : "")
    + (sell.length ? `賣超最多的是${L(sell[0])}${sell.length > 1 ? `，其次${sell.slice(1).map(L).join("、")}` : ""}。` : "")
    + `法人買賣金額明顯放大（超過前 4 天平均 3 倍、3 億以上）的個股有 ${odd} 檔。`;
}
