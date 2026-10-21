// 證交所、櫃買中心 OpenAPI 的所有公開資料集：給 learner/watch.html「工具 → 官方資料」與個股「財務 → 官方資料」使用。
// GET /api/oapi?src=twse|tpex&p=/opendata/t187ap45_L[&code=2330][&q=關鍵字][&limit=500]
//   → { ok, src, path, total, cols, rows, more }；code 只留這檔、q 任一欄含關鍵字。資料集清單在 learner/oapi.js 的 OAPI_CAT。
// GET /api/oapi?stock=2330 → { ok, code, items: [{ k, t, src, path, rows }] }：個股常用的官方資料（上市、上櫃都試，有資料的才回）。
// GET /api/oapi?earn=1 → { ok, ym, yq, rows: [[代號, 名稱, 產業, 市場, 當月營收(億), 月增%, 年增%, 累計年增%, EPS, 季營收(億), 稅後淨利(億), 毛利率, 營益率, 淨利率]] }：
//   情報局「財報」用，上市、上櫃的月營收（t187ap05）、季 EPS（t187ap14）、營益分析（t187ap17）合成一張表。
// 只連固定的兩個網域、路徑只允許英數字與 _ /，不會被拿去連別的網站。同一份資料在這台機器上 15 分鐘內重複用。

import { getJSON } from "./_tw.js";

const BASE = { twse: "https://openapi.twse.com.tw/v1", tpex: "https://www.tpex.org.tw/openapi/v1" };
const PATH_RE = /^\/[A-Za-z0-9_]+(\/[A-Za-z0-9_]+){0,2}$/;
const TTL = 15 * 60e3, MAX = 2000;
const cache = new Map();
export async function rowsOf(src, path) {
  const url = BASE[src] + path, hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = getJSON(url, 20000).then(j => (Array.isArray(j) ? j : []));
  cache.set(url, { at: Date.now(), p }); p.catch(() => cache.delete(url));
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return p;
}
// 各資料集的「代號」欄位名稱不一樣：公司代號、SecuritiesCompanyCode、Code、證券代號…
const CODE_KEYS = [/^公司代號$/, /^SecuritiesCompanyCode$/i, /^(證券代號|股票代號|有價證券代號)$/, /^(Code|StockCode|SecurityCode|CompanyCode|SecuritiesCode)$/i, /^STOCKsSecurityCode$/i, /^SecuritiesCompanyCodeAndCompanyName$/i, /^UnderlyingStockCode$/i, /^(標的代號|標的證券代號)$/];
export function codeKey(r0) {
  if (!r0) return null; const ks = Object.keys(r0);
  for (const re of CODE_KEYS) { const k = ks.find(x => re.test(String(x).trim())); if (k) return k; }
  return null;
}
export function filterRows(rows, { code, q } = {}) {
  let out = rows;
  if (code) { const k = codeKey(rows[0]); if (!k) return []; out = out.filter(r => { const v = String(r[k] ?? "").trim(); return v === code || v.startsWith(code + " ") || v.startsWith(code + "　"); }); }
  if (q) { const s = String(q).toLowerCase(); out = out.filter(r => Object.values(r).some(v => String(v ?? "").toLowerCase().includes(s))); }
  return out;
}
// 個股頁：常用的官方資料（[鍵, 標題, 上市路徑, 上櫃路徑]）
export const STOCK_SETS = [
  ["div", "股利分派", "/opendata/t187ap45_L", null],
  ["big", "持股逾 10% 大股東", "/opendata/t187ap02_L", "/mopsfin_t187ap02_O"],
  ["dir", "董監事持股餘額", "/opendata/t187ap11_L", "/mopsfin_t187ap11_O"],
  ["pledge", "董監持股質押", "/opendata/t187ap09_L", "/mopsfin_t187ap09_O"],
  ["ceo", "董事長是否兼任總經理", "/opendata/t187ap33_L", "/mopsfin_t187ap33_O"],
  ["agm", "股東會日期與電子投票", "/opendata/t187ap41_L", "/t187ap41_O"],
  ["pay", "董事酬金", "/opendata/t187ap29_A_L", "/mopsfin_t187ap29_A_O"],
  ["odd", "零股交易", "/exchangeReport/TWT53U", "/tpex_odd_stock"],
  ["dt", "當沖標的與統計", "/exchangeReport/TWTB4U", "/tpex_securities"],
  ["sbl", "可借券賣出股數", "/SBL/TWT96U", "/tpex_margin_sbl"],
  ["mon", "月成交資訊", "/exchangeReport/FMSRFK_ALL", null],
  ["ghg", "ESG：溫室氣體排放", "/opendata/t187ap46_L_1", "/t187ap46_O_1"],
  ["hr", "ESG：人力發展", "/opendata/t187ap46_L_5", "/t187ap46_O_5"],
  ["board", "ESG：董事會", "/opendata/t187ap46_L_6", "/t187ap46_O_6"],
];

// 財報總表：欄位名稱上市是中文、上櫃有些是英文，用關鍵字找
const kOf = (r, re) => Object.keys(r || {}).find(k => re.test(k)), nOf = v => { const n = parseFloat(String(v ?? "").replace(/[,\s%]/g, "")); return Number.isFinite(n) ? n : null; };
const r1 = v => (v == null ? null : Math.round(v * 10) / 10), r2 = v => (v == null ? null : Math.round(v * 100) / 100);
export function earnRows({ revL = [], revO = [], epsL = [], epsO = [], pmL = [], pmO = [] }) {
  const M = new Map(), get = (c, n, m) => { if (!M.has(c)) M.set(c, [c, n, "", m, null, null, null, null, null, null, null, null, null, null]); return M.get(c); };
  let ym = "", yq = "";
  for (const [rows, m] of [[revL, "上市"], [revO, "上櫃"]]) { const r0 = rows[0]; if (!r0) continue; const k = { c: kOf(r0, /公司代號|SecuritiesCompanyCode/), n: kOf(r0, /公司名稱|CompanyName/), i: kOf(r0, /產業別|Industry/), ym: kOf(r0, /資料年月/),
      cur: kOf(r0, /當月營收$/), mom: kOf(r0, /上月比較增減/), yoy: kOf(r0, /去年同月增減/), cum: kOf(r0, /前期比較增減/) };
    for (const r of rows) { const c = String(r[k.c] ?? "").trim(); if (!/^\d{4}[A-Z]?$/.test(c)) continue; const x = get(c, String(r[k.n] ?? "").trim(), m); x[2] = String(r[k.i] ?? "").trim();
      x[4] = r2(nOf(r[k.cur]) / 1e5); x[5] = r1(nOf(r[k.mom])); x[6] = r1(nOf(r[k.yoy])); x[7] = r1(nOf(r[k.cum])); ym = ym || String(r[k.ym] ?? ""); } }
  for (const rows of [epsL, epsO]) { const r0 = rows[0]; if (!r0) continue; const k = { c: kOf(r0, /公司代號|SecuritiesCompanyCode/), e: kOf(r0, /基本每股盈餘/), rev: kOf(r0, /^營業收入$/), ni: kOf(r0, /稅後淨利/), y: kOf(r0, /^年度$|^Year$/), q: kOf(r0, /季別/), i: kOf(r0, /產業別/) };
    for (const r of rows) { const x = M.get(String(r[k.c] ?? "").trim()); if (!x) continue; x[8] = r2(nOf(r[k.e])); x[9] = r2(nOf(r[k.rev]) / 1e5); x[10] = r2(nOf(r[k.ni]) / 1e5); if (!x[2] && k.i) x[2] = String(r[k.i] ?? "").trim(); yq = yq || `${r[k.y]}Q${r[k.q]}`; } }
  for (const rows of [pmL, pmO]) { const r0 = rows[0]; if (!r0) continue; const k = { c: kOf(r0, /公司代號|SecuritiesCompanyCode/), g: kOf(r0, /^毛利率/), o: kOf(r0, /^營業利益率/), n: kOf(r0, /^稅後純益率/) };
    for (const r of rows) { const x = M.get(String(r[k.c] ?? "").trim()); if (!x) continue; x[11] = r1(nOf(r[k.g])); x[12] = r1(nOf(r[k.o])); x[13] = r1(nOf(r[k.n])); } }
  return { ym, yq, rows: [...M.values()] };
}

export default async function handler(req, res) {
  const q = req.query || {}, code = String(q.code || q.stock || "").trim().toUpperCase();
  if (code && !/^\d{4,6}[A-Z]?$/.test(code)) return res.status(400).json({ ok: false, error: "代號格式不對" });
  if (q.earn) {
    const get = (src, p) => rowsOf(src, p).catch(() => []);
    const [revL, revO, epsL, epsO, pmL, pmO] = await Promise.all([get("twse", "/opendata/t187ap05_L"), get("tpex", "/mopsfin_t187ap05_O"), get("twse", "/opendata/t187ap14_L"), get("tpex", "/mopsfin_t187ap14_O"), get("twse", "/opendata/t187ap17_L"), get("tpex", "/mopsfin_187ap17_O")]);
    const E = earnRows({ revL, revO, epsL, epsO, pmL, pmO });
    if (!E.rows.length) return res.status(200).json({ ok: false, error: "證交所、櫃買中心的財報資料暫時連不到" });
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");
    return res.status(200).json({ ok: true, source: "證交所、櫃買中心開放資料（月營收、各產業 EPS、營益分析）", ...E });
  }
  if (q.stock) {
    const got = await Promise.all(STOCK_SETS.map(async ([k, t, a, b]) => {
      for (const [src, path] of [["twse", a], ["tpex", b]]) {
        if (!path) continue;
        try { const rows = filterRows(await rowsOf(src, path), { code }); if (rows.length) return { k, t, src, path, rows: rows.slice(-24) }; } catch { /* 這一份暫時抓不到就跳過 */ }
      }
      return null;
    }));
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");
    return res.status(200).json({ ok: true, code, items: got.filter(Boolean) });
  }
  const src = String(q.src || ""), path = String(q.p || "");
  if (!BASE[src] || !PATH_RE.test(path)) return res.status(400).json({ ok: false, error: "資料集參數不對" });
  let rows;
  try { rows = await rowsOf(src, path); } catch (e) { return res.status(200).json({ ok: false, error: `${src === "twse" ? "證交所" : "櫃買中心"}暫時連不到（${e.message}）` }); }
  const out = filterRows(rows, { code, q: q.q ? String(q.q).slice(0, 40) : "" }), lim = Math.max(1, Math.min(MAX, +q.limit || 500));
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");
  return res.status(200).json({ ok: true, src, path, total: out.length, all: rows.length, cols: rows[0] ? Object.keys(rows[0]) : [], codeKey: codeKey(rows[0]), rows: out.slice(0, lim), more: out.length > lim });
}
