// 真實日 K 線：給 learner/ 的「輸入股票代號」使用。
// 由伺服器端代抓（瀏覽器直接連證交所會被 CORS 擋住），依序嘗試：
//   1. 證交所（上市個股 STOCK_DAY、加權指數 MI_5MINS_HIST ＋ FMTQIK 成交金額）
//   2. 櫃買中心（上櫃個股）
//   3. Yahoo Finance（.TW / .TWO / ^TWII），前兩者都失敗時的備援
// GET /api/kline?code=2382&months=6
// GET /api/kline?code=2382&months=12&before=2025-10-01   往前載入更早的資料（看盤的 K 線往左拉到底時用；這時先問 Yahoo，一次就拿得到）
// 回傳 { ok, code, name, market, source, unit, data: [{ d: "2026-09-01", o, h, l, c, v }] }，v 的單位見 unit。
// 加 &adj=1：每根多一個 ac（除權息、減資、分割還原後的收盤價，最後一根＝原始收盤價），並附 adj: { ok, source, basis, events, skipped, suspect }。
//   上市、上櫃個股用證交所、櫃買中心的官方參考價（含配股、減資），美股用 Yahoo 的除息與分割；suspect＝還原後仍超過漲跌幅限制的日子（可能沒還原到）。
//   報酬、波動、風險用 ac；K 線圖仍用原始的 o/h/l/c。指數不還原（加權是價格指數）；拿不到事件時 adj.ok=false、不給 ac。

// HTTP 標頭只能用 ASCII（中文會讓 fetch 直接丟出 ByteString 錯誤）
import { errText } from "./_err.js";
import { isUS, usName } from "./_yahoo.js";
import { session } from "./quote.js";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const INDEX_CODES = new Set(["TAIEX", "TWII", "^TWII", "加權", "加權指數", "大盤", "0000", "IX0001", "T00"]); // T00：和 /api/intraday、/api/quote 一樣的加權代號
// 櫃買指數：Yahoo ^TWOII（成交量單位是千股，和加權的成交金額不同）
const OTC_CODES = new Set(["櫃買", "櫃買指數", "OTC", "TPEX", "^TWOII", "TWOII", "O00"]);

export const toNum = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[,\s+]/g, ""));
  return Number.isFinite(n) ? n : null;
};
// 民國年 115/09/01、西元 2026/09/01、2026-09-01 → 2026-09-01
export const toISO = (s) => {
  const m = String(s).trim().match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  let y = +m[1]; if (y < 1911) y += 1911;
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
};
const col = (fields, ...keys) => fields.findIndex((f) => keys.some((k) => String(f).replace(/\s/g, "").includes(k)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
const monthsBack = (n, anchor) => { const out = [], d = anchor ? new Date(anchor) : new Date(); d.setDate(1); for (let k = 0; k < n; k++) { out.unshift(new Date(d)); d.setMonth(d.getMonth() - 1); } return out; };

async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// 成交量：來源沒給（null、"--"）時 v 記 0 並標 vNa: 1，前端的均量、量能判讀會跳過這根；不能當成真的沒有成交
export const volOf = (n, unit = 1) => (n == null || !Number.isFinite(n) ? { v: 0, vNa: 1 } : { v: Math.round(n / unit) });
export function fillVol(r, map) { const v = map.get(r.d); if (v == null) { r.v = 0; r.vNa = 1; } else { r.v = v; delete r.vNa; } }
// 證交所 STOCK_DAY：fields 含 日期、成交股數、開盤價、最高價、最低價、收盤價
export function parseTwseStockDay(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const f = j.fields || [], iD = col(f, "日期"), iV = col(f, "成交股數"), iO = col(f, "開盤"), iH = col(f, "最高"), iL = col(f, "最低"), iC = col(f, "收盤");
  const name = (String(j.title || "").match(/\d{4,6}[A-Z]?\s+(\S+)/) || [])[1] || "";
  const rows = j.data.map((r) => ({ d: toISO(r[iD]), o: toNum(r[iO]), h: toNum(r[iH]), l: toNum(r[iL]), c: toNum(r[iC]), ...volOf(toNum(r[iV]), 1000) }))
    .filter((r) => r.d && r.o && r.h && r.l && r.c); // 停牌日的價格是 "--"
  return { name, rows };
}
// 櫃買中心 tradingStock：tables[0].fields 含 日 期、成交張數、開盤、最高、最低、收盤
export function parseTpex(j) {
  const t = j && Array.isArray(j.tables) ? j.tables[0] : j;
  if (!t || !Array.isArray(t.data) || !t.data.length) return null;
  const f = t.fields || [], iD = col(f, "日期"), iV = col(f, "成交張數", "成交仟股"), iO = col(f, "開盤"), iH = col(f, "最高"), iL = col(f, "最低"), iC = col(f, "收盤");
  const name = j.name || (String(t.title || j.title || "").match(/\d{4,6}[A-Z]?\s*(\S+)/) || [])[1] || "";
  const rows = t.data.map((r) => ({ d: toISO(r[iD]), o: toNum(r[iO]), h: toNum(r[iH]), l: toNum(r[iL]), c: toNum(r[iC]), ...volOf(toNum(r[iV])) }))
    .filter((r) => r.d && r.o && r.h && r.l && r.c);
  return { name, rows };
}
// 加權指數 MI_5MINS_HIST：fields 日期、開盤指數、最高指數、最低指數、收盤指數
export function parseTwseIndex(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const f = j.fields || [], iD = col(f, "日期"), iO = col(f, "開盤"), iH = col(f, "最高"), iL = col(f, "最低"), iC = col(f, "收盤");
  return { name: "加權指數", rows: j.data.map((r) => ({ d: toISO(r[iD]), o: toNum(r[iO]), h: toNum(r[iH]), l: toNum(r[iL]), c: toNum(r[iC]), v: 0, vNa: 1 })).filter((r) => r.d && r.c) }; // 成交量之後用 FMTQIK 補
}
// FMTQIK：每日成交金額（元）→ 億元
export function parseFmtqik(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return new Map();
  const f = j.fields || [], iD = col(f, "日期"), iA = col(f, "成交金額");
  return new Map(j.data.filter((r) => toNum(r[iA]) != null).map((r) => [toISO(r[iD]), Math.round(toNum(r[iA]) / 1e8)]));
}
export function parseYahoo(j) {
  const r = j?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return null;
  const tz = r.meta?.gmtoffset ?? 28800;
  const rows = r.timestamp.map((t, k) => ({ d: new Date((t + tz) * 1000).toISOString().slice(0, 10), o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], ...volOf(q.volume[k], 1000) }))
    .filter((x) => x.o != null && x.h != null && x.l != null && x.c != null)
    .map((x) => ({ ...x, o: +x.o.toFixed(2), h: +x.h.toFixed(2), l: +x.l.toFixed(2), c: +x.c.toFixed(2) }));
  return { name: r.meta?.shortName || r.meta?.longName || "", rows };
}

// Yahoo 除息、分割事件（chart API 加 events=div,split）→ [{ d, kind: "div", amt } | { d, kind: "split", r }]，日期換成交易所當地日期；
// r＝一股變成幾股（0050 2025 年一拆四 → 4）。Yahoo 的配息金額已經依分割調整過。
export function parseYahooEvents(j) {
  const r = j?.chart?.result?.[0]; if (!r) return null;
  const tz = r.meta?.gmtoffset ?? 28800, day = t => new Date((t + tz) * 1000).toISOString().slice(0, 10), ev = [];
  for (const x of Object.values(r.events?.dividends || {})) { const a = +x?.amount, t = +x?.date; if (Number.isFinite(a) && a > 0 && Number.isFinite(t)) ev.push({ d: day(t), kind: "div", amt: a }); }
  for (const x of Object.values(r.events?.splits || {})) { const n = +x?.numerator, dn = +x?.denominator, t = +x?.date; if (n > 0 && dn > 0 && n !== dn && Number.isFinite(t)) ev.push({ d: day(t), kind: "split", r: n / dn }); }
  return ev.sort((a, b) => a.d.localeCompare(b.d) || a.kind.localeCompare(b.kind));
}
// 官方參考價：上市＝證交所 TWT49U「除權除息計算結果表」、TWTAUU「減資恢復買賣參考價格」；上櫃＝櫃買中心 exDailyQ「除權除息計算結果」、revivt「減資恢復買賣參考價」
// → [{ d, kind: "ref", f, why }]。
// f＝參考價 ÷ 前一天收盤：現金股息、配股（除權）、減資都包含在內，比用股息金額自己算更完整。欄位名稱用關鍵字找；民國或西元日期都可以
export function parseRefPrices(j, code, why) {
  let rows = [];
  if (Array.isArray(j?.data) && Array.isArray(j?.fields)) rows = j.data.map(r => Object.fromEntries(j.fields.map((k, i) => [String(k).replace(/\s/g, ""), r[i]])));
  else if (Array.isArray(j?.tables)) { for (const t of j.tables) { const x = parseRefPrices(t, code, why); if (x.length) return x; } return []; }
  else if (Array.isArray(j)) rows = j;
  if (!rows.length) return [];
  const ks = Object.keys(rows[0]), K = re => ks.find(k => re.test(String(k).replace(/\s/g, "")));
  const kD = K(/資料日期|恢復買賣日期|除權息日期|^日期$/), kC = K(/股票代號|證券代號|^代號$/), kP = K(/前收盤|最後交易日之收盤/), kR = K(/除權息參考價|恢復買賣參考價|恢復買賣開始日參考價/) || K(/參考價/);
  if (!kD || !kC || !kP || !kR) return [];
  const out = [];
  for (const r of rows) {
    if (String(r[kC] ?? "").trim().toUpperCase() !== code) continue;
    const ds = String(r[kD]).trim(), m7 = ds.match(/^(\d{3})(\d{2})(\d{2})$/), d = m7 ? `${+m7[1] + 1911}-${m7[2]}-${m7[3]}` : toISO(ds.replace(/年|月/g, "/").replace(/日/, "")), prev = toNum(r[kP]), ref = toNum(r[kR]);
    if (d && prev > 0 && ref > 0 && Math.abs(ref / prev - 1) > 1e-6 && ref / prev > 0.05 && ref / prev < 20) out.push({ d, kind: "ref", f: ref / prev, why });
  }
  return out;
}
// 還原收盤價 ac：rows 依日期由舊到新。splitAdjusted＝rows 的價格已經依分割調整（Yahoo 的 close 是），證交所、櫃買的原始價格不是。
// 1. 分割：除權日以前的價格除以 r。2. 除息：除息日 e 的因子 f＝1 − 股息 ÷ 前一個交易日收盤，e 以前的價格都乘上 f。
// 最後一根 ac＝原始收盤價；只處理期間內的事件（期間外的只會讓整段乘上同一個常數，不影響報酬）。因子不合理（股息超過前收盤一半）就略過並列在 skipped。
export function adjustRows(rows, ev, splitAdjusted = false, opts = {}) {
  const n = rows.length, events = [], skipped = [];
  if (!n || !Array.isArray(ev)) return { rows: rows.map(x => ({ ...x })), events, skipped, suspect: [] };
  const first = rows[0].d, last = rows[n - 1].d, inside = e => e.d > first && e.d <= last;
  // 官方參考價（kind: "ref"）只用在原始價格上；同一天有官方資料時，Yahoo 的除息與分割就不再用（避免配股被 Yahoo 記成分割而重複計算）
  // 「落在哪一根」：事件日不是交易日（例如颱風休市）時算在下一個交易日；官方與 Yahoo 的日期可能差一天（2002 2024 年官方 07-25、Yahoo 07-26），所以用落在哪一根來去重複
  const rowOf = d => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].d < d) lo = m + 1; else hi = m; } return lo; };
  const refs = splitAdjusted ? [] : ev.filter(e => e.kind === "ref" && inside(e)), refRows = new Set(refs.map(e => rowOf(e.d)));
  const splits = ev.filter(e => e.kind === "split" && inside(e) && !refRows.has(rowOf(e.d))), divs = ev.filter(e => (e.kind === "div" && inside(e) && !refRows.has(rowOf(e.d))) || refs.includes(e));
  const cs = rows.map(x => { let c = x.c; if (!splitAdjusted) for (const e of splits) if (x.d < e.d) c /= e.r; return c; });
  splits.forEach(e => events.push({ d: e.d, kind: "split", r: e.r, f: +(1 / e.r).toFixed(6), applied: !splitAdjusted }));
  const fac = new Array(n).fill(1); let F = 1, k = divs.length - 1;
  for (let i = n - 1; i >= 0; i--) {
    fac[i] = F;
    // 除息日落在 (前一根, 這一根]：從前一根開始往前都要乘上因子（除息日不是交易日時，算在下一個交易日）
    while (k >= 0 && i > 0 && divs[k].d > rows[i - 1].d && divs[k].d <= rows[i].d) {
      const e = divs[k];
      if (e.kind === "ref") { F *= e.f; events.push({ d: rows[i].d, kind: "ref", why: e.why, f: +e.f.toFixed(6) }); k--; continue; }
      const prev = cs[i - 1], f = prev > 0 ? 1 - e.amt / prev : NaN;
      if (f > 0.5 && f < 1) { F *= f; events.push({ d: rows[i].d, kind: "div", amt: e.amt, f: +f.toFixed(6) }); } else skipped.push({ d: e.d, kind: "div", amt: e.amt, why: "bad_factor" });
      k--;
    }
  }
  const out = rows.map((x, i) => ({ ...x, ac: +(cs[i] * fac[i]).toFixed(4) }));
  // 還原後仍有超過漲跌幅限制的單日（台股 10%）：多半是沒還原到的配股、減資或資料錯誤，列出來讓畫面提醒（風險計算會拿掉這些日子）
  const lim = opts.limit ?? 0.105, suspect = [];
  for (let i = 1; i < n; i++) { const r = out[i].ac / out[i - 1].ac - 1; if (Math.abs(r) > lim) suspect.push({ d: out[i].d, r: +r.toFixed(4) }); }
  return { rows: out, events: events.sort((a, b) => a.d.localeCompare(b.d)), skipped, suspect };
}
const ymdOf = d => d.replace(/-/g, "");
// 官方參考價（除權息＋減資），期間＝這段日 K；除權息那份拿不到就整個不用（回 null），改用 Yahoo
export async function officialRefs(code, from, to, otc = false) {
  try {
    const [a, b] = otc
      ? await Promise.all([getJSON(`https://www.tpex.org.tw/www/zh-tw/bulletin/exDailyQ?startDate=${from.replace(/-/g, "/")}&endDate=${to.replace(/-/g, "/")}&response=json`), getJSON(`https://www.tpex.org.tw/www/zh-tw/bulletin/revivt?startDate=${from.replace(/-/g, "/")}&endDate=${to.replace(/-/g, "/")}&response=json`).catch(() => null)])
      : await Promise.all([getJSON(`https://www.twse.com.tw/rwd/zh/exRight/TWT49U?startDate=${ymdOf(from)}&endDate=${ymdOf(to)}&response=json`), getJSON(`https://www.twse.com.tw/rwd/zh/reducation/TWTAUU?startDate=${ymdOf(from)}&endDate=${ymdOf(to)}&response=json`).catch(() => null)]);
    // 正常回應：證交所有 stat（期間內沒有事件時是「沒有符合條件的資料」）；櫃買中心有 tables
    if (!a || typeof a !== "object" || (otc ? !Array.isArray(a.tables) : typeof a.stat !== "string")) return null;
    return [...parseRefPrices(a, code, "除權息"), ...(b && typeof b === "object" ? parseRefPrices(b, code, "減資") : [])];
  } catch { return null; }
}
// 從「原始價格 ÷ Yahoo 價格」找分割：Yahoo 的價格已經依分割調整，比值在分割日會從 r 跳回 1（0050 一拆四：4 → 1）。
// Yahoo 的事件清單有時沒有分割（實測 0050 2025-06-18 就沒有），所以不能只靠事件。比值變動超過 15% 才算，回傳 [{ d, kind: "split", r, inferred: true }]
export function inferSplits(rawRows, yRows) {
  const Y = new Map((yRows || []).map(x => [x.d, x.c])), q = [];
  for (const x of rawRows || []) { const y = Y.get(x.d); if (y > 0 && x.c > 0) q.push([x.d, x.c / y]); }
  const out = [];
  // 和「上一個穩定的比值」比，新比值要在之後最多 3 天都維持（差不到 3%）：Yahoo 單日錯價、以及錯價隔天恢復都不會被當成分割
  const holds = i => q.slice(i + 1, i + 4).every(([, v]) => Math.abs(v / q[i][1] - 1) < 0.03);
  let base = q.length ? q[0][1] : null;
  for (let i = 1; i < q.length; i++) { const r = base / q[i][1]; if (Math.abs(r - 1) > 0.15 && holds(i)) { const nice = [2, 3, 4, 5, 10, 20, 0.5, 0.25, 0.2, 0.1].find(v => Math.abs(r / v - 1) < 0.03); out.push({ d: q[i][0], kind: "split", r: nice || +r.toFixed(4), inferred: true }); base = q[i][1]; }
    else if (Math.abs(q[i][1] / base - 1) < 0.03 || holds(i)) base = q[i][1]; } // 小幅、持續的變動（例如 Yahoo 把配股記成分割）跟著更新基準
  return out;
}
async function adjOf(sym, data, splitAdjusted, code, tw) {
  const p1 = Math.floor(Date.parse(data[0].d + "T00:00:00Z") / 1000) - 7 * 86400, p2 = Math.floor(Date.parse(data[data.length - 1].d + "T00:00:00Z") / 1000) + 3 * 86400;
  const useOfficial = !splitAdjusted && !!tw;
  const [yj, refs] = await Promise.all([getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`).catch(() => null),
    useOfficial ? officialRefs(code, data[0].d, data[data.length - 1].d, tw === "上櫃") : null]);
  let y = yj ? parseYahooEvents(yj) : null;
  // 原始價格：用和 Yahoo 價格的比值補上事件清單沒有的分割（同一天已有 Yahoo 分割就不重複）
  if (y && !splitAdjusted) { const have = new Set(y.filter(e => e.kind === "split").map(e => e.d)); y = [...y, ...inferSplits(data, parseYahoo(yj)?.rows).filter(e => !have.has(e.d))]; }
  if (!y && !refs) throw new Error("沒有除權息資料");
  const A = adjustRows(data, [...(y || []), ...(refs || [])], splitAdjusted, { limit: /\.TWO?$/.test(sym) ? 0.105 : 0.5 });
  return { ...A, basis: refs ? "official" : "yahoo", source: refs ? `${tw === "上櫃" ? "櫃買中心" : "證交所"}除權息與減資參考價＋Yahoo Finance（分割）` : "Yahoo Finance（除息、分割）", officialFailed: useOfficial && !refs };
}

async function fromTwse(code, months, anchor) {
  let name = "", rows = [];
  for (const [k, m] of monthsBack(months, anchor).entries()) {
    if (k) await sleep(250); // 證交所會擋短時間內的大量請求
    const p = parseTwseStockDay(await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ymd(m)}&stockNo=${code}&response=json`));
    if (!p) { if (k === months - 1 && !rows.length) return null; continue; }
    name = name || p.name; rows.push(...p.rows);
  }
  return rows.length ? { name, rows, market: "上市", source: "證交所", unit: "張" } : null;
}
async function fromTpex(code, months, anchor) {
  let name = "", rows = [];
  for (const [k, m] of monthsBack(months, anchor).entries()) {
    if (k) await sleep(250);
    const d = `${m.getFullYear()}/${String(m.getMonth() + 1).padStart(2, "0")}/01`;
    const p = parseTpex(await getJSON(`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${d}&response=json`));
    if (!p) continue;
    name = name || p.name; rows.push(...p.rows);
  }
  return rows.length ? { name, rows, market: "上櫃", source: "櫃買中心", unit: "張" } : null;
}
async function fromTwseIndex(months, anchor) {
  const rows = [], vol = new Map();
  for (const [k, m] of monthsBack(months, anchor).entries()) {
    if (k) await sleep(250);
    const p = parseTwseIndex(await getJSON(`https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date=${ymd(m)}&response=json`));
    if (p) rows.push(...p.rows);
    try { parseFmtqik(await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${ymd(m)}&response=json`)).forEach((v, d) => vol.set(d, v)); } catch {}
  }
  rows.forEach((r) => fillVol(r, vol));
  return rows.length ? { name: "加權指數", rows, market: "指數", source: "證交所", unit: "億元" } : null;
}
// 加權指數從 Yahoo 拿到時，成交量換成證交所 FMTQIK 的成交金額（億元），和證交所來源的單位一致；拿不到的日子標成沒有量（vNa），不混用千股
async function fillTaiexAmount(r) {
  const months = [...new Set(r.rows.map(x => x.d.slice(0, 7)))], vol = new Map();
  for (let k = 0; k < months.length; k += 4) await Promise.all(months.slice(k, k + 4).map(async m => {
    try { parseFmtqik(await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${m.replace("-", "")}01&response=json`)).forEach((v, d) => vol.set(d, v)); } catch {}
  }));
  r.rows.forEach(x => fillVol(x, vol));
  return { ...r, name: "加權指數", unit: "億元", source: vol.size ? "Yahoo Finance（成交金額：證交所）" : "Yahoo Finance" };
}
async function fromYahoo(sym, months, anchor) {
  const span = anchor ? `period1=${Math.floor(anchor.getTime() / 1000) - months * 31 * 86400}&period2=${Math.floor(anchor.getTime() / 1000)}` : `range=${months <= 3 ? "3mo" : months <= 6 ? "6mo" : months <= 12 ? "1y" : "2y"}`;
  const p = parseYahoo(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${span}&interval=1d`));
  const us = isUS(sym) && sym !== "^TWII";
  return p && p.rows.length ? { name: us ? usName(sym, p.name) : p.name, rows: p.rows, market: us ? "美股" : sym.endsWith(".TWO") ? "上櫃" : sym.startsWith("^") ? "指數" : "上市", source: "Yahoo Finance", unit: us || sym.startsWith("^") ? "千股" : "張" } : null;
}

export default async function handler(req, res) {
  const raw = String(req.query?.code || "").trim().toUpperCase();
  const months = Math.max(1, Math.min(24, parseInt(req.query?.months, 10) || 6));
  const isIndex = INDEX_CODES.has(raw) || INDEX_CODES.has(String(req.query?.code || "").trim());
  const isOtc = !isIndex && (OTC_CODES.has(raw) || OTC_CODES.has(String(req.query?.code || "").trim()));
  const us = !isIndex && !isOtc && isUS(raw);
  if (!isIndex && !isOtc && !us && !/^\d{4,6}[A-Z]?$/.test(raw)) return res.status(400).json({ ok: false, error: "請輸入 4 到 6 碼的股票代號（例如 2330、0050、00891），或輸入「加權」看大盤。" });

  // before：只要這一天以前的資料（不含當天）
  const before = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.before || "")) ? String(req.query.before) : null;
  const anchor = before ? new Date(new Date(before + "T00:00:00Z").getTime() - 86400e3) : null;
  const yIdx = async () => { const r = await fromYahoo("^TWII", months, anchor); return r ? fillTaiexAmount(r) : r; };
  const tries = us ? [() => fromYahoo(raw, months, anchor)] : isOtc ? [async () => { const r = await fromYahoo("^TWOII", months, anchor); return r && { ...r, name: "櫃買指數", market: "指數" }; }] : isIndex
    ? (before || months > 6 ? [yIdx, () => fromTwseIndex(months, anchor)] : [() => fromTwseIndex(months), yIdx])
    // 超過半年（名人觀點的 24 個月）：證交所要一個月一個月抓（24 次、上櫃股還要再試 24 次），很容易逾時；先問 Yahoo，一次就拿到
    : before || months > 6
      ? [() => fromYahoo(`${raw}.TW`, months, anchor), () => fromYahoo(`${raw}.TWO`, months, anchor), () => fromTwse(raw, months, anchor), () => fromTpex(raw, months, anchor)]
      : [() => fromTwse(raw, months), () => fromTpex(raw, months), () => fromYahoo(`${raw}.TW`, months), () => fromYahoo(`${raw}.TWO`, months)];
  const errors = [];
  for (const t of tries) {
    try {
      const r = await t();
      if (r && r.rows.length >= (before ? 1 : 5)) {
        const seen = new Set(), data = r.rows.filter((x) => !seen.has(x.d) && seen.add(x.d) && (!before || x.d < before)).sort((a, b) => a.d.localeCompare(b.d));
        if (before && !data.length) continue;
        let adj;
        if (req.query?.adj === "1" && !before) {
          if (isIndex || isOtc) adj = { ok: false, why: "index", note: "指數不還原（價格指數）" };
          else try { const ySym = us ? raw : `${raw}${r.market === "上櫃" ? ".TWO" : ".TW"}`, A = await adjOf(ySym, data, /^Yahoo/.test(r.source), raw, !us && (r.market === "上市" || r.market === "上櫃") ? r.market : null);
            data.splice(0, data.length, ...A.rows); adj = { ok: true, source: A.source, basis: A.basis, events: A.events, skipped: A.skipped, suspect: A.suspect, ...(A.officialFailed ? { officialFailed: true } : {}) };
          } catch (e) { adj = { ok: false, why: "fetch_failed", note: `拿不到除權息資料（${errText(e)}），用原始價格` }; }
        }
        res.setHeader("Cache-Control", before ? "s-maxage=86400, stale-while-revalidate=604800" : session() === "closed" ? "s-maxage=1800, stale-while-revalidate=3600" : "s-maxage=60, stale-while-revalidate=120");
        return res.status(200).json({ ok: true, code: isIndex ? "TAIEX" : isOtc ? "OTC" : raw, us, name: r.name, market: r.market, source: r.source, unit: r.unit, data, ...(adj ? { adj } : {}) });
      }
    } catch (e) { errors.push(errText(e)); }
  }
  // 只有每個來源都正常回應（沒有錯誤）卻沒有更早的資料，才告訴頁面「到底了」；連線失敗時讓頁面之後還能再拉
  if (before && !errors.length) return res.status(200).json({ ok: true, code: isIndex ? "TAIEX" : isOtc ? "OTC" : raw, data: [], end: true, note: `${before} 以前沒有更早的資料了。` });
  if (before) return res.status(200).json({ ok: false, error: `暫時拿不到更早的資料（${errors[0]}）` });
  return res.status(200).json({ ok: false, error: `找不到 ${raw} 的資料。請確認代號是否正確；若是剛上市或停牌的股票，可能沒有足夠的交易日。${errors.length ? `（${errors[0]}）` : ""}` });
}
