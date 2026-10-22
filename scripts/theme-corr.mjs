// 題材股價連動：把每個題材的公司（段落＋圖解產業鏈）做成等權指數，算題材之間的相關係數與領先落後，給「供應鏈 → 關聯」使用。
// 在 .github/workflows/market-scan.yml 裡、全市場日 K 更新之後執行：
//   台股日 K 用 .cache/allk.json（沒有快取時改讀 GitHub Release「market-data」的 allk-*.json，最近約 130 天）；
//   美、日、韓股用 Yahoo Finance 一年日 K（同一個快取資料夾保留 .cache/yk.json，Yahoo 抓不到時用舊的）。
// 輸出 learner/data/theme-corr.json：
//   ids[]、n[]（有報價的公司數）、ret[]（題材指數 1 週／1 月／3 月／1 年報酬 %）、
//   c：週報酬相關係數 ×100 的上三角（i<j，索引 triIdx）；x：扣掉各自大盤後的週報酬相關（大家都跟著大盤漲跌，x 才看得出真正一起動的題材）、
//   lead：[[先動的題材, 跟著動的題材, 隔日相關×100, 反方向×100, 樣本天數]]（例：美股今晚漲跌 → 台股明天）
import { readFile, writeFile, mkdir } from "node:fs/promises";
import vm from "node:vm"; import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url)), L = f => ROOT + f, OUT = L("learner/data/theme-corr.json");
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isTwCode = c => /^\d{4,6}[A-Z]?$/.test(c);
export const mkOf = c => (isTwCode(c) ? "tw" : /\.T$/.test(c) ? "jp" : /\.K[SQ]$/.test(c) ? "kr" : "us");
export const ySym = c => (/^\d{3}[0-9A-Z]\.T$|^\d{6}\.K[SQ]$|^\^/.test(c) ? c : /^[A-Z][A-Z.\-]{0,6}$/.test(c) ? c.replace(/\./g, "-") : null); // Yahoo 代號：BRK.B → BRK-B

// 題材與公司：industry.js（舊題材）＋ industry-pack.js（新題材與圖解產業鏈裡的代號）
export async function loadThemes() {
  const ctx = { INDUSTRY_PACK: [] }; vm.createContext(ctx);
  vm.runInContext((await readFile(L("learner/industry.js"), "utf8")).replace(/^const INDUSTRY_MAP/m, "var INDUSTRY_MAP"), ctx);
  vm.runInContext((await readFile(L("learner/industry-pack.js"), "utf8")).replace(/^const INDUSTRY_XREF/m, "var INDUSTRY_XREF"), ctx);
  const T = [...ctx.INDUSTRY_MAP.themes]; for (const t of ctx.INDUSTRY_PACK) if (!T.some(x => x.id === t.id)) T.push(t);
  // 題材指數只用同一個市場的公司（美股題材的台灣供應商不算進去），不然跨市場的題材會因為共用台股成員而假性相關
  return T.map(t => ({ id: t.id, mk: t.mk, codes: [...new Set([...t.segs.flatMap(g => g.c.map(x => x[0])), ...(ctx.INDUSTRY_XREF[t.id]?.cc || [])])].filter(c => mkOf(c) === t.mk) }));
}
// 收盤價 [[日期, 收盤]…] → Map(日期 → 日報酬)；一天漲跌超過 50% 當成資料錯誤（分割、除權沒還原）略過
export function dailyRet(rows) {
  const R = new Map();
  for (let i = 1; i < rows.length; i++) { const p = rows[i - 1][1], c = rows[i][1]; if (!(p > 0) || !(c > 0)) continue; const r = c / p - 1; if (Math.abs(r) <= 0.5) R.set(rows[i][0], r); }
  return R;
}
// 題材指數：每天有報價的成員平均報酬（等權）
export function themeRet(members) {
  const S = new Map(); for (const R of members) for (const [d, r] of R) { const x = S.get(d) || [0, 0]; x[0] += r; x[1]++; S.set(d, x); }
  return new Map([...S].sort((a, b) => a[0].localeCompare(b[0])).map(([d, [s, n]]) => [d, s / n]));
}
// 日報酬 → 週報酬（週一開始的那一週連乘）
export function weekly(R) {
  const W = new Map();
  for (const [d, r] of R) { const t = new Date(d + "T00:00:00Z"), k = new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); W.set(k, (W.get(k) ?? 1) * (1 + r)); }
  return new Map([...W].map(([k, v]) => [k, v - 1]));
}
export function corr(x, y) {
  const n = x.length; if (n < 3) return null; let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : null;
}
// 兩個 Map 的共同日期相關
export function corrMap(A, B, min = 20) { const x = [], y = []; for (const [d, v] of A) { const w = B.get(d); if (w != null) { x.push(v); y.push(w); } } return x.length >= min ? { r: corr(x, y), n: x.length } : null; }
// 領先：A 在 d 天的報酬 vs B 在 d 之後第一個交易日（4 天內）的報酬
export function leadCorr(A, B, min = 60) {
  const bd = [...B.keys()], x = [], y = []; let j = 0;
  for (const [d, v] of A) { while (j < bd.length && bd[j] <= d) j++; if (j >= bd.length) break; if (Date.parse(bd[j]) - Date.parse(d) > 4 * 864e5) continue; x.push(v); y.push(B.get(bd[j])); }
  return x.length >= min ? { r: corr(x, y), n: x.length } : null;
}
export const triIdx = (i, j, N) => (i < j ? (i * (2 * N - i - 1)) / 2 + (j - i - 1) : (j * (2 * N - j - 1)) / 2 + (i - j - 1));
// 題材指數的報酬（%）：最近 5／21／63／250 個交易日
export function trailing(R) { const a = [...R.values()]; return [5, 21, 63, 250].map(n => (a.length >= Math.min(n, 20) ? +((a.slice(-n).reduce((v, r) => v * (1 + r), 1) - 1) * 100).toFixed(1) : null)); }

// market：Map(市場 → 大盤日報酬)，算扣掉大盤的相關用
export function compute(themes, prices, { weeks = 52, market = new Map() } = {}) {
  const ok = [], ret = new Map(), wk = new Map(), wx = new Map(), nOf = new Map(), MW = new Map([...market].map(([k, R]) => [k, weekly(R)]));
  for (const t of themes) {
    const M = t.codes.map(c => prices.get(c)).filter(R => R?.size); if (!M.length) continue;
    const R = themeRet(M); if (R.size < 40) continue;
    ok.push(t); ret.set(t.id, R); nOf.set(t.id, M.length);
    const W = weekly(R), keys = [...W.keys()].slice(-weeks), m = MW.get(t.mk); wk.set(t.id, new Map(keys.map(k => [k, W.get(k)])));
    if (m) wx.set(t.id, new Map(keys.filter(k => m.has(k)).map(k => [k, W.get(k) - m.get(k)])));
  }
  const N = ok.length, c = new Array((N * (N - 1)) / 2).fill(null), x = c.slice(), lead = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const a = ok[i].id, b = ok[j].id, r = corrMap(wk.get(a), wk.get(b), 26), e = wx.has(a) && wx.has(b) ? corrMap(wx.get(a), wx.get(b), 26) : null;
    if (r?.r != null) c[triIdx(i, j, N)] = Math.round(r.r * 100); if (e?.r != null) x[triIdx(i, j, N)] = Math.round(e.r * 100); }
  for (const a of ok) for (const b of ok) {
    if (a === b) continue; const f = leadCorr(ret.get(a.id), ret.get(b.id)); if (!(f?.r >= 0.3)) continue;
    const back = leadCorr(ret.get(b.id), ret.get(a.id)); if (back?.r != null && f.r - back.r < 0.15) continue; // 兩個方向差不多就不是誰領先誰
    lead.push([a.id, b.id, Math.round(f.r * 100), back?.r != null ? Math.round(back.r * 100) : null, f.n]);
  }
  lead.sort((x, y) => y[2] - x[2]);
  const days = [...new Set(ok.flatMap(t => [...ret.get(t.id).keys()]))].sort();
  return { from: days[0] || null, to: days.at(-1) || null, weeks, ids: ok.map(t => t.id), n: ok.map(t => nOf.get(t.id)), ret: ok.map(t => trailing(ret.get(t.id))), c, x, lead: lead.slice(0, 120) };
}

async function readJ(f) { try { return JSON.parse(await readFile(f, "utf8")); } catch { return null; } }
const get = async (url, ms = 20000) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
// 台股：全市場日 K 快取；沒有就讀 Release 的分片（最近 130 天）
async function twPrices() {
  const H = await readJ(L(".cache/allk.json")), P = new Map();
  if (H?.s) { for (const [c, s] of Object.entries(H.s)) P.set(c, s.b.map(b => [b.d, b.c])); return { P, src: `.cache/allk.json（${Object.keys(H.s).length} 檔）` }; }
  const base = "https://github.com/kevinlf2904/taiex-monitor-app/releases/download/market-data/";
  for (let i = 0; i < 10; i++) { try { const j = await (await fetch(`${base}allk-${i}.json`, { signal: AbortSignal.timeout(60000) })).json(); for (const [c, a] of Object.entries(j.k || {})) P.set(c, j.d.map((d, k) => [d, a[3][k]]).filter(x => x[1] != null)); } catch (e) { console.log(`  allk-${i} 讀不到：${e.message}`); } }
  return { P, src: `Release allk（${P.size} 檔）` };
}
// 美日韓：Yahoo 一年日 K；抓不到的用上次存的
async function yahooPrices(syms) {
  const C = (await readJ(L(".cache/yk.json"))) || {}, todo = [...syms]; let k = 0, ok = 0, fail = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < todo.length) { const c = todo[k++], s = ySym(c);
    try { const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1y&interval=1d`), r = j?.chart?.result?.[0]; if (!r?.timestamp) throw new Error("沒有資料");
      const q = r.indicators.adjclose?.[0]?.adjclose || r.indicators.quote[0].close, off = (r.meta.gmtoffset ?? 0) * 1000;
      C[c] = r.timestamp.map((t, i) => [new Date(t * 1000 + off).toISOString().slice(0, 10), q[i] == null ? null : Math.round(q[i] * 1e4) / 1e4]).filter(x => x[1] != null); ok++;
    } catch { fail++; } await sleep(150); } }));
  console.log(`Yahoo：${ok} 檔更新、${fail} 檔沒抓到（用舊資料 ${todo.filter(c => C[c]).length - ok} 檔）`);
  await mkdir(L(".cache"), { recursive: true }); await writeFile(L(".cache/yk.json"), JSON.stringify(C));
  return new Map(todo.filter(c => C[c]?.length).map(c => [c, C[c]]));
}

export async function main() {
  const themes = await loadThemes(), all = [...new Set(themes.flatMap(t => t.codes))];
  const IDX = { us: "SPY", jp: "^N225", kr: "^KS11" }; // 大盤：台股用全市場等權，其他用指數
  const { P, src } = await twPrices(), Y = await yahooPrices([...all.filter(c => !isTwCode(c) && ySym(c)), ...Object.values(IDX)]);
  const prices = new Map(); for (const c of all) { const rows = isTwCode(c) ? P.get(c) : Y.get(c); if (rows?.length > 20) prices.set(c, dailyRet(rows)); }
  const market = new Map([["tw", themeRet([...P.values()].filter(r => r.length > 20).map(dailyRet))], ...Object.entries(IDX).filter(([, s]) => Y.get(s)?.length > 20).map(([k, s]) => [k, dailyRet(Y.get(s))])]);
  console.log(`題材 ${themes.length} 個、公司 ${all.length} 檔，有報價 ${prices.size} 檔（台股：${src}）；大盤：${[...market.keys()].join("、")}`);
  const R = compute(themes, prices, { market });
  if (R.ids.length < 10) { console.log(`::warning::只算得出 ${R.ids.length} 個題材，保留舊檔`); return null; }
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), ...R }));
  console.log(`題材連動完成：${R.ids.length} 個題材、${R.from}～${R.to}、領先關係 ${R.lead.length} 組`);
  return R;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::題材連動這次沒有更新：" + e.message); });
