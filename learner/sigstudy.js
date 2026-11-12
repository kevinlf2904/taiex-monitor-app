/* ================= 訊號回測（選股條件的歷史勝率）：網頁與排程（scripts/_engine.mjs）共用，最上層不碰畫面 =================
   把過去每一次「條件成立」找出來，看之後持有 5／10／20 個交易日的報酬。排程 scripts/signal-study.mjs 每天收盤後用全市場日 K 算好，
   寫進 data/signal-study.json，網頁只讀那個檔。
   規則：訊號日收盤後才知道條件成立 → 一律「隔天開盤」進場，第 n 根收盤出場，扣來回手續費 0.1425% × 2 與證交稅 0.3%。
   不偷看未來：每一天只拿「到那天為止」的 K 棒（D.slice(0, i + 1)）去算指標與判斷條件。
   限制：日 K 快取只有最近約 260 個交易日（扣掉暖機約 200 天），而且只有現在還在上市櫃的股票（倖存者偏差）。 */
const SIG_NS = [5, 10, 20], SIG_COST = 0.001425 * 2 + 0.003, SIG_WARM = 60, SIG_GAP = 5, SIG_MIN_LOTS = 500, SIG_MIN_N = 30;
const sigR4 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
// 第 i 根出訊號 → 第 i+1 根開盤買、第 i+n 根收盤賣；買不到（一字漲停）、資料不夠或價格異常回傳 null
function sigForward(D, i, n, cost = SIG_COST) {
  const e = D[i + 1], x = D[i + n], p = D[i]; if (!e || !x || !(e.o > 0) || !(x.c > 0) || !(p?.c > 0)) return null;
  if (e.o === e.h && e.h === e.l && e.l === e.c && e.o >= p.c * 1.095) return null; // 一字漲停鎖死，實際買不到
  for (let k = i + 1; k <= i + n; k++) if (!(D[k].c > 0) || Math.abs(D[k].c / D[k - 1].c - 1) > 0.5) return null; // 減資、分割等沒有還原的跳動
  return x.c / e.o - 1 - cost;
}
// defs: [{ id, hit(D, I) }]；回傳 [{ id, i }]。同一個條件 gap 根內重複成立只算第一次（避免連續好幾天都成立時樣本重疊）
function sigScan(D, defs, ind, { warm = SIG_WARM, gap = SIG_GAP, minLots = SIG_MIN_LOTS } = {}) {
  const out = [], last = {};
  for (let i = warm; i < D.length; i++) {
    if (!(D[i].v >= minLots)) continue;
    const P = D.slice(0, i + 1); let I = null;
    for (const f of defs) { if (last[f.id] != null && i - last[f.id] < gap) continue; let ok = null; try { ok = f.hit(P, (I ||= ind(P))); } catch {} if (ok) { out.push({ id: f.id, i }); last[f.id] = i; } }
  }
  return out;
}
// 全市場等權大盤：Map 日期 → { v: 收盤對收盤的平均漲跌連乘出來的淨值, o: 當天「開盤到收盤」的平均漲跌 }，算「贏大盤」用
function sigMarket(all) {
  const R = new Map();
  for (const b of all) for (let i = 1; i < (b?.length || 0); i++) { const p = b[i - 1]?.c, x = b[i], c = x?.c; if (!(p > 0) || !(c > 0)) continue; const r = c / p - 1; if (Math.abs(r) > 0.5) continue;
    const t = R.get(x.d) || [0, 0, 0, 0]; t[0] += r; t[1]++; if (x.o > 0) { t[2] += c / x.o - 1; t[3]++; } R.set(x.d, t); }
  const M = new Map(); let v = 1; for (const d of [...R.keys()].sort()) { const [s, n, so, no] = R.get(d); v *= 1 + s / n; M.set(d, { v, o: no ? so / no : 0 }); }
  return M;
}
// 大盤在同一個視窗的報酬：和個股一樣第 i+1 根開盤買（當天只算開盤到收盤）、第 i+n 根收盤賣，也扣同樣的成本；沒有那天的大盤資料回傳 null
function sigBench(M, D, i, n, cost = SIG_COST) {
  const a = M.get(D[i + 1]?.d), b = M.get(D[i + n]?.d);
  return a && b ? (1 + a.o) * (b.v / a.v) - 1 - cost : null;
}
function sigStat(A) {
  if (!A.length) return null; const s = [...A].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: A.length, avg: sigR4(A.reduce((x, y) => x + y, 0) / A.length), med: sigR4(q(0.5)), p25: sigR4(q(0.25)), p75: sigR4(q(0.75)), win: sigR4(A.filter(x => x > 1e-9).length / A.length) }; // 1e-9：浮點誤差不算贏
}
// stocks: [{ c, n, bars }]、defs: [{ id, group, side, name, desc, hit }] → 每個條件的統計
function sigStudy(stocks, defs, ind, { ns = SIG_NS, cost = SIG_COST, warm = SIG_WARM, gap = SIG_GAP, minLots = SIG_MIN_LOTS } = {}) {
  const M = sigMarket(stocks.map(s => s.bars)), T = Object.fromEntries(defs.map(f => [f.id, { r: Object.fromEntries(ns.map(n => [n, []])), x: Object.fromEntries(ns.map(n => [n, []])), list: [] }]));
  for (const s of stocks) { const D = s.bars; if (!D || D.length <= warm) continue;
    for (const { id, i } of sigScan(D, defs, ind, { warm, gap, minLots })) { const rec = [s.c, s.n, D[i].d];
      for (const n of ns) { const r = sigForward(D, i, n, cost); rec.push(sigR4(r)); if (r == null) continue; T[id].r[n].push(r); const m = sigBench(M, D, i, n, cost); if (m != null) T[id].x[n].push(r - m); }
      T[id].list.push(rec); } }
  const nL = ns[ns.length - 1], bins = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2];
  return defs.map(f => { const t = T[f.id];
    return { id: f.id, group: f.group, side: f.side || null, name: f.name, desc: f.desc || "", stats: Object.fromEntries(ns.map(n => { const a = sigStat(t.r[n]), x = sigStat(t.x[n]); return [n, a ? { ...a, ex: x?.avg ?? null, exWin: x?.win ?? null } : null]; })),
      hist: [...bins, Infinity].map((b, k) => t.r[nL].filter(v => v < b && (k === 0 || v >= bins[k - 1])).length), recent: t.list.sort((a, b) => b[2].localeCompare(a[2])).slice(0, 30) }; });
}
