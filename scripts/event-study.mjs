// 財報事件回測：全市場上市櫃股票發生「月營收創新高、年增轉強、年增由負轉正、連續 6 個月年增、三率三升／三降」之後，
// 5／10／20 個交易日的平均報酬、中位數、勝率，以及和同期間全市場平均比（超額報酬），寫進 learner/data/event-study.json（看盤「財報 → 事件回測」）。
// 不偷看未來：月營收依規定次月 10 日前公布，一律用「次月 11 日（含）之後第一個交易日的收盤價」進場；
// 季報用法定期限隔天（Q1 5/16、Q2 8/15、Q3 11/15、Q4 隔年 4/1）之後第一個交易日。事件只用公布當時已經有的營收／財報數字判斷。
// 在 .github/workflows/market-scan.yml 裡、全市場日 K 更新之後執行：日 K 用 .cache/allk.json（最近約 260 個交易日），
// 營收用 learner/data/twse-rev.json、tpex-rev.json，三率用 learner/data/earn-pm.json。沒有日 K 快取時保留舊檔。
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const L = f => fileURLToPath(new URL(`../${f}`, import.meta.url)), OUT = L("learner/data/event-study.json");
export const NS = [5, 10, 20];
export const EV_TYPES = [
  ["high", "月營收創新高", "當月營收比過去至少 24 個月都高"],
  ["yoy30", "年增轉強", "月營收年增率從 30% 以下升到 30% 以上"],
  ["turn", "年增由負轉正", "上個月還比去年衰退、這個月轉成長"],
  ["streak6", "連 6 個月年增", "第一次達到連續 6 個月年增"],
  ["pm3", "三率三升", "毛利率、營益率、淨利率都比上一季高"],
  ["pm3d", "三率三降", "三率都比上一季低（對照組）"],
];
const ymAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number), t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const r4 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
// 公布日（之後第一個交易日進場）
export const revAnn = ym => `${ymAdd(ym, 1)}-11`;
export const qAnn = q => { const [y, s] = q.split("Q").map(Number); return s === 4 ? `${y + 1}-04-01` : `${y}-${["05-16", "08-15", "11-15"][s - 1]}`; };
// 一檔的月營收 { "2026-09": 千元 } → 事件 [{ t, p（期別）, ann }]；只用到該月（含）以前的營收
export function revEvents(H) {
  const ks = Object.keys(H || {}).filter(k => H[k] != null && H[k] > 0).sort(), out = [], yoy = k => { const a = H[k], b = H[ymAdd(k, -12)]; return a != null && b > 0 ? (a / b - 1) * 100 : null; };
  let run = 0;
  ks.forEach((k, i) => {
    const y = yoy(k), py = yoy(ymAdd(k, -1)), ann = revAnn(k);
    run = y != null && y > 0 ? run + 1 : 0;
    if (i >= 24 && ks.slice(0, i).every(p => H[p] < H[k])) out.push({ t: "high", p: k, ann });
    if (y != null && py != null && y >= 30 && py < 30) out.push({ t: "yoy30", p: k, ann });
    if (y != null && py != null && y > 0 && py < 0) out.push({ t: "turn", p: k, ann });
    if (run === 6) out.push({ t: "streak6", p: k, ann });
  });
  return out;
}
// 一檔每季的 [毛利率, 營益率, 淨利率]（{ "2026Q2": [...] }）→ 三率三升／三降
export function pmEvents(Q) {
  const qs = Object.keys(Q || {}).sort(), out = [];
  for (let i = 1; i < qs.length; i++) { const a = Q[qs[i]], b = Q[qs[i - 1]]; if (!a || !b || a.some(v => v == null) || b.some(v => v == null)) continue;
    const [y, s] = qs[i].split("Q").map(Number), [py, ps] = qs[i - 1].split("Q").map(Number); if (y * 4 + s - (py * 4 + ps) !== 1) continue; // 要是連續兩季
    if (a.every((v, j) => v > b[j])) out.push({ t: "pm3", p: qs[i], ann: qAnn(qs[i]) }); else if (a.every((v, j) => v < b[j])) out.push({ t: "pm3d", p: qs[i], ann: qAnn(qs[i]) }); }
  return out;
}
// 進場：公布日（含）之後第一個交易日；離公布日超過 7 天（停牌、資料缺）就不算
export function entryIdx(bars, ann) {
  let lo = 0, hi = bars.length; while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].d < ann) lo = m + 1; else hi = m; }
  return lo < bars.length && Date.parse(bars[lo].d) - Date.parse(ann) <= 7 * 864e5 ? lo : -1;
}
// 全市場等權指數（每天所有有資料的股票平均報酬連乘），超額報酬用
export function marketIndex(all) {
  const R = new Map();
  for (const b of all) for (let i = 1; i < b.length; i++) { const p = b[i - 1].c, c = b[i].c; if (!(p > 0) || !(c > 0)) continue; const r = c / p - 1; if (Math.abs(r) > 0.5) continue; const x = R.get(b[i].d) || [0, 0]; x[0] += r; x[1]++; R.set(b[i].d, x); }
  const M = new Map(); let v = 1; for (const d of [...R.keys()].sort()) { const [s, n] = R.get(d); v *= 1 + s / n; M.set(d, v); }
  return M;
}
const stat = A => { if (!A.length) return null; const s = [...A].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: A.length, avg: r4(A.reduce((x, y) => x + y, 0) / A.length), med: r4(q(0.5)), p25: r4(q(0.25)), p75: r4(q(0.75)), win: r4(A.filter(x => x > 0).length / A.length) }; };
// stocks: [{ c, n, ind, bars, rev, pm }] → 每種事件的統計、20 日報酬分佈、產業、最近的事件
export function study(stocks, M, Ns = NS) {
  const S = Object.fromEntries(EV_TYPES.map(([t]) => [t, { r: Object.fromEntries(Ns.map(n => [n, []])), x: Object.fromEntries(Ns.map(n => [n, []])), ind: new Map(), list: [] }]));
  for (const s of stocks) {
    const B = s.bars; if (!B?.length) continue;
    for (const e of [...revEvents(s.rev), ...pmEvents(s.pm)]) {
      const i = entryIdx(B, e.ann); if (i < 0) continue; const T = S[e.t], c0 = B[i].c, rec = [s.c, s.n, e.p, B[i].d];
      for (const n of Ns) { const j = i + n; if (j >= B.length || !(c0 > 0)) { rec.push(null); continue; } const r = B[j].c / c0 - 1, m0 = M.get(B[i].d), m1 = M.get(B[j].d); rec.push(r4(r));
        T.r[n].push(r); if (m0 && m1) T.x[n].push(r - (m1 / m0 - 1)); if (n === Ns.at(-1) && s.ind) { const g = T.ind.get(s.ind) || []; g.push(r); T.ind.set(s.ind, g); } }
      T.list.push(rec);
    }
  }
  const nL = Ns.at(-1), bins = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2]; // 20 日報酬分佈：< -20%、-20～-15%…、≥ 20%
  return EV_TYPES.map(([t, name, desc]) => { const T = S[t];
    return { t, name, desc, stats: Object.fromEntries(Ns.map(n => { const a = stat(T.r[n]), x = stat(T.x[n]); return [n, a ? { ...a, ex: x?.avg ?? null, exWin: x?.win ?? null } : null]; })),
      hist: [...bins, Infinity].map((b, k) => T.r[nL].filter(v => v < b && (k === 0 || v >= bins[k - 1])).length),
      ind: [...T.ind].filter(([, a]) => a.length >= 8).map(([g, a]) => { const z = stat(a); return [g, z.n, z.avg, z.win]; }).sort((a, b) => b[2] - a[2]).slice(0, 30),
      recent: T.list.sort((a, b) => b[3].localeCompare(a[3])).slice(0, 40) }; });
}
async function readJ(f) { try { return JSON.parse(await readFile(L(f), "utf8")); } catch { return null; } }
export async function main() {
  const H = await readJ(".cache/allk.json"); if (!H?.s) { console.log("::warning::沒有全市場日 K 快取，事件回測保留舊檔"); return null; }
  const rev = { ...((await readJ("learner/data/twse-rev.json")) || {}), ...((await readJ("learner/data/tpex-rev.json")) || {}) }, P = (await readJ("learner/data/earn-pm.json")) || {}, pm = {};
  for (const kind of Object.values(P)) for (const [q, rows] of Object.entries(kind || {})) for (const [c, v] of Object.entries(rows || {})) (pm[c] ||= {})[q] = [v[2], v[3], v[4]];
  const stocks = Object.entries(H.s).filter(([c]) => /^\d{4}$/.test(c)).map(([c, s]) => ({ c, n: s.n || rev[c]?.[0] || "", ind: rev[c]?.[1] || "", bars: s.b, rev: rev[c]?.[2], pm: pm[c] }));
  const M = marketIndex(stocks.map(s => s.bars)), days = [...M.keys()];
  const out = { updated: new Date().toISOString(), from: days[0] || null, to: days.at(-1) || null, stocks: stocks.length, ns: NS, types: study(stocks, M) };
  if (!out.types.some(T => T.stats[NS[0]]?.n)) { console.log("::warning::算不出任何事件，保留舊檔"); return null; }
  await writeFile(OUT, JSON.stringify(out));
  console.log("事件回測完成：", out.types.map(T => `${T.name} ${T.stats[20]?.n ?? 0} 筆`).join("、"), `（${out.from}～${out.to}）`);
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::事件回測這次沒有更新：" + e.message); });
