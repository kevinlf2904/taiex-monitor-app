// 財報進階資料：給情報局「財報」的連續成長、三率轉折、行事曆（月營收公布進度）。寫進 learner/data/earn-hist.json。
// GitHub Actions 每個交易日晚上跑（.github/workflows/earn-hist.yml），排在 twse-daily、tpex-daily 之後：
//   月營收：直接用排程已經存好的 learner/data/twse-rev.json、tpex-rev.json（{ 代號: [名稱, 產業, { "2026-09": 千元 }] }）
//   三率：公開資訊觀測站「營益分析彙總表」（ajax_t163sb06，上市 sii／上櫃 otc，一季一頁）。表上是當年度累計數，
//         單季 = 累計毛利（毛利率 × 營收）相減後再除以單季營收；原始累計數存在 learner/data/earn-pm.json，只重抓最近兩季。
// 格式：{ updated,
//   streak: { ym, rows: [[代號, 名稱, 產業, 市場, 年增連續月數, 最新年增%, 最新營收(億), 創幾個月新高(0＝沒有)]] }（連續 3 個月以上或創 12 個月以上新高才列）
//   pub:    { ym, n, total, codes: [...] }（最新月份已公布月營收的公司）
//   pm:     { q, qp, qy, rows: [[代號, 名稱, 產業, 市場, 毛利率, 營益率, 淨利率, 毛利率季變化, 營益率季變化, 淨利率季變化, 毛利率年變化, 營益率年變化, 淨利率年變化, 毛利率連續改善季數]] } }
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { num } from "../api/_lib/_tw.js";

const P = f => fileURLToPath(new URL(`../learner/data/${f}`, import.meta.url));
const r1 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10), r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymAdd = (k, n) => { const [y, m] = k.split("-").map(Number), t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; };
const qAdd = (k, n) => { const [y, q] = k.split("Q").map(Number), t = y * 4 + q - 1 + n; return `${Math.floor(t / 4)}Q${t % 4 + 1}`; };

// 月營收連續年增、創新高：rh 是 { 代號: [名稱, 產業, { ym: 千元 }] }，mk 是市場
export function revStreak(rh, mk, ym) {
  const out = [];
  for (const [c, [n, ind, H]] of Object.entries(rh || {})) {
    const v = H[ym]; if (v == null) continue;
    let s = 0; for (let k = ym; ; k = ymAdd(k, -1)) { const a = H[k], b = H[ymAdd(k, -12)]; if (a == null || !b || a <= b) break; s++; if (s >= 36) break; }
    const ly = H[ymAdd(ym, -12)], yoy = ly ? (v / ly - 1) * 100 : null;
    let hi = 0; for (let i = 1; i <= 36; i++) { const p = H[ymAdd(ym, -i)]; if (p == null) break; if (p >= v) { hi = 0; break; } hi = i; } // 比過去連續 i 個月都高
    if (hi < 12) hi = 0;
    if (s >= 3 || hi) out.push([c, n, ind, mk, s, r1(yoy), r2(v / 1e5), hi]);
  }
  return out;
}
// 營益分析彙總表（HTML）：每列 代號、名稱、營收(百萬)、毛利率、營益率、稅前純益率、稅後純益率（累計）
export function parsePmHtml(html) {
  const M = {};
  for (const m of String(html).matchAll(/<tr class='(?:even|odd)'>\s*<td>\s*([0-9A-Z]{4,6})\s*<\/td>\s*<td>([^<]*)<\/td>((?:\s*<td[^>]*>[^<]*<\/td>){5})/g)) {
    const v = [...m[3].matchAll(/<td[^>]*>([^<]*)</g)].map(x => num(x[1]));
    M[m[1]] = [m[2].trim(), v[0], v[1], v[2], v[4]]; // 名稱、營收、毛利率、營益率、淨利率
  }
  return M;
}
// 單季三率：Q1 就是累計；其他季用累計金額相減
export function singleQ(raw, q) {
  const cur = raw[q]; if (!cur) return null; const [, s] = q.split("Q").map(Number), prev = s > 1 ? raw[qAdd(q, -1)] : null; if (s > 1 && !prev) return null;
  const out = {};
  for (const [c, a] of Object.entries(cur)) {
    if (s === 1) { out[c] = [a[1], a[2], a[3], a[4]]; continue; }
    const b = prev[c]; if (!b || a[1] == null || b[1] == null) continue; const rv = a[1] - b[1]; if (!(rv > 0)) continue;
    const m = i => (a[i] == null || b[i] == null ? null : r2(((a[i] * a[1]) - (b[i] * b[1])) / rv));
    out[c] = [r2(rv), m(2), m(3), m(4)];
  }
  return out;
}
export function pmRows(raw, info) {
  const qs = Object.keys(raw).sort(), S = {}; for (const q of qs) { const s = singleQ(raw, q); if (s && Object.keys(s).length > 100) S[q] = s; }
  const sq = Object.keys(S).sort(), q = sq.at(-1); if (!q) return null;
  const qp = qAdd(q, -1), qy = qAdd(q, -4), d = (a, b) => (a == null || b == null ? null : r2(a - b)), rows = [];
  for (const [c, v] of Object.entries(S[q])) {
    const p = S[qp]?.[c], y = S[qy]?.[c], name = raw[q][c]?.[0] || "", [ind, mk] = info[c] || ["", ""];
    let k = 0; for (let t = q; S[t]?.[c] && S[qAdd(t, -1)]?.[c] && S[t][c][1] != null && S[qAdd(t, -1)][c][1] != null && S[t][c][1] > S[qAdd(t, -1)][c][1]; t = qAdd(t, -1)) k++;
    rows.push([c, name, ind, mk, v[1], v[2], v[3], d(v[1], p?.[1]), d(v[2], p?.[2]), d(v[3], p?.[3]), d(v[1], y?.[1]), d(v[2], y?.[2]), d(v[3], y?.[3]), k]);
  }
  return { q, qp: S[qp] ? qp : null, qy: S[qy] ? qy : null, rows };
}
async function mopsPm(kind, q) {
  const [y, s] = q.split("Q").map(Number);
  const r = await fetch("https://mopsov.twse.com.tw/mops/web/ajax_t163sb06", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)" },
    body: `encodeURIComponent=1&step=1&firstin=1&off=1&isQuery=Y&TYPEK=${kind}&year=${y - 1911}&season=${String(s).padStart(2, "0")}`, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return parsePmHtml(await r.text());
}

export async function main({ now = Date.now(), getPm = mopsPm, gap = 1500, dir = P } = {}) {
  const rd = f => readFile(dir(f), "utf8").then(JSON.parse).catch(() => ({}));
  const [L, O, raw0] = await Promise.all([rd("twse-rev.json"), rd("tpex-rev.json"), rd("earn-pm.json")]);
  // 最新月份：至少三成公司已經公布的月份
  const months = {}; for (const R of [L, O]) for (const [, , H] of Object.values(R)) for (const k of Object.keys(H)) months[k] = (months[k] || 0) + 1;
  const total = Object.keys(L).length + Object.keys(O).length, ks = Object.keys(months).sort(), ym = [...ks].reverse().find(k => months[k] >= total * 0.3) || ks.at(-1);
  const streak = ym ? { ym, rows: [...revStreak(L, "上市", ym), ...revStreak(O, "上櫃", ym)].sort((a, b) => b[4] - a[4] || (b[5] ?? -1e9) - (a[5] ?? -1e9)) } : null;
  const latest = ks.at(-1), codes = latest ? [...Object.entries(L), ...Object.entries(O)].filter(([, x]) => x[2][latest] != null).map(([c]) => c) : [];
  const pub = latest ? { ym: latest, n: codes.length, total, codes } : null;
  // 三率：最近 9 季（要算去年同季的單季數字），已經有的只重抓最近兩季
  const raw = { sii: raw0.sii || {}, otc: raw0.otc || {} }, d = new Date(now + 8 * 3600e3), qNow = `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  for (const kind of ["sii", "otc"]) for (let i = 1; i <= 10; i++) { const q = qAdd(qNow, -i); if (raw[kind][q] && i > 3) continue;
    try { const M = await getPm(kind, q); if (Object.keys(M).length > 100) raw[kind][q] = M; console.log("營益分析", kind, q, Object.keys(M).length, "家"); } catch (e) { console.log("營益分析失敗", kind, q, e.message); } await sleep(gap); }
  for (const kind of ["sii", "otc"]) for (const q of Object.keys(raw[kind])) if (q < qAdd(qNow, -12)) delete raw[kind][q];
  const info = {}; for (const [R, mk] of [[L, "上市"], [O, "上櫃"]]) for (const [c, x] of Object.entries(R)) info[c] = [x[1], mk];
  const pmL = pmRows(raw.sii, info), pmO = pmRows(raw.otc, info);
  const pm = pmL || pmO ? { q: pmL?.q || pmO?.q, qp: pmL?.qp || pmO?.qp, qy: pmL?.qy || pmO?.qy, rows: [...(pmL?.rows || []).map(r => (r[3] ? r : (r[3] = "上市", r))), ...(pmO?.rows || []).map(r => (r[3] ? r : (r[3] = "上櫃", r)))] } : null;
  const out = { updated: new Date(now).toISOString(), streak, pub, pm };
  if (!streak && !pm) throw new Error("月營收、營益分析都沒有資料");
  await writeFile(dir("earn-hist.json"), JSON.stringify(out)); await writeFile(dir("earn-pm.json"), JSON.stringify(raw));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok 連續成長", o.streak?.rows.length, "家、三率", o.pm?.rows.length, "家", o.pm?.q)).catch(e => { console.error(e); process.exit(1); });
