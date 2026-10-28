// 上市（證交所）圖表資料：情報局「大盤 → 上市」用（learner/tpex.js 和櫃買共用畫面），寫進 learner/data/twse.json，格式和 tpex.json 一樣的部分沿用。
// GitHub Actions 每個交易日跑兩次（.github/workflows/twse-daily.yml）。證交所 OpenAPI 的指數、量值只給當月，更早的月份從證交所網站的月報表補（一次補 MONTH_NEW 個月）；
// 類股指數 OpenAPI 只給當天，舊的日子從網站的每日收盤行情補（一次補 DAY_NEW 天）。月營收歷史從公開資訊觀測站的上市彙總表補，公司逐月營收另存 learner/data/twse-rev.json。
// 格式：{ updated,
//   ix:  { cols: ["d", "tx", "txR", "t50", "t50R", "frm", "frmR", 主題指數...], rows }（加權、台灣 50、寶島的價格與報酬指數，主題指數只有排程開始後的收盤）
//   sec: { cols: [類股指數名稱...], rows: [[d, ...]] }
//   vol: [[d, 成交股數(億股), 成交金額(億元), 成交筆數(萬筆), 加權指數]]
//   revm: 同 tpex.json
//   snap: { pledge, short, fc, sus, sss, wtu }（暫停當沖、停資停券預告、上市權證成交值最多的標的） }
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { num, rocDate } from "../api/_lib/_tw.js";
import { sleep, r1, r2, str, mergeRows, parseShort, warrantUnderL, mops, revUpdate, ymOf, ymBack, ymKey, REV_KEEP } from "./tpex-daily.mjs";

const OUT = fileURLToPath(new URL("../learner/data/twse.json", import.meta.url)), REV = fileURLToPath(new URL("../learner/data/twse-rev.json", import.meta.url));
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" }, MONTH_NEW = 40, DAY_NEW = 25;

// 指數：[欄位, OpenAPI 資料集, 欄位名, 網站月報表路徑, 網站欄位（比對 fields）]
export const LX = [["tx", "/indicesReport/MI_5MINS_HIST", "ClosingIndex", "TAIEX/MI_5MINS_HIST", /收盤/], ["txR", "/indicesReport/MFI94U", "TAIEXTotalReturnIndex", "TAIEX/MFI94U", /報酬指數/],
  ["t50", "/indicesReport/TAI50I", "Taiwan50Index", "FTSE/TAI50I", /^臺灣50指數$|^台灣50指數$/], ["t50R", "/indicesReport/TAI50I", "Taiwan50TotalReturnIndex", "FTSE/TAI50I", /50.*報酬/],
  ["frm", "/indicesReport/FRMSA", "FormosaIndex", null], ["frmR", "/indicesReport/FRMSA", "FormosaTotalReturnIndex", null]]; // 寶島指數網站沒有月報表，歷史從每日收盤行情補
// 每日收盤行情裡的主題指數（名稱完全比對，報酬、槓桿、反向不收）；寶島只用來補歷史
export const LTHEME = [["m100", /^臺灣中型100指數$/], ["hd", /^臺灣高股息指數$/], ["cg", /^臺灣公司治理100指數$/], ["emp", /^臺灣就業99指數$/], ["pay", /^臺灣高薪100指數$/], ["esg", /^臺灣永續指數$/]];
const LDAY = [...LTHEME, ["frm", /^寶島股價指數$/], ["frmR", /^寶島股價報酬指數$/]];
export const LX_COLS = ["d", ...LX.map(x => x[0]), ...LTHEME.map(x => x[0])];
// 類股指數：價格指數，不收報酬、槓桿、反向，也不收和細分類重複的大類（水泥窯製、塑膠化工、機電、化學生技醫療）
const isSec = n => /類指數$/.test(n) && !/報酬|槓桿|反向|兩倍/.test(n) && !/^(水泥窯製|塑膠化工|機電|化學生技醫療)類指數$/.test(n);

// OpenAPI 每日收盤行情（MI_INDEX）：一天所有指數 → { d, theme: {m100: 值}, sec: {名稱: 值} }
export function miIndex(rows) {
  const d = rocDate(rows?.[0]?.["日期"]), theme = {}, sec = {};
  for (const r of rows || []) { const n = str(r["指數"]), v = num(r["收盤指數"]); if (v == null) continue;
    const t = LTHEME.find(([, re]) => re.test(n)); if (t) theme[t[0]] = v; if (isSec(n)) sec[n] = v; }
  return { d, theme, sec };
}
// 網站的每日收盤行情（type=IND）：tables（價格指數、報酬指數各三張）裡第一欄是指數名稱、第二欄收盤指數
export function miIndexRwd(j) {
  const sec = {}, theme = {};
  for (const T of [...(j?.tables || []), j]) for (const r of T?.data || []) { const n = str(r[0]), v = num(r[1]); if (v == null) continue;
    const t = LDAY.find(([, re]) => re.test(n)); if (t) theme[t[0]] = v; if (isSec(n)) sec[n] = v; }
  return { sec, theme };
}
// 網站月報表（{ stat, fields, data }）→ Map(d → { 欄位: 值 })；pick 是 [[欄位, fields 比對]]
export function rwdMonth(j, pick) {
  const out = new Map(); if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return out;
  const f = (j.fields || []).map(str), idx = pick.map(([k, re]) => [k, f.findIndex((x, i) => i && re.test(x))]).filter(([, i]) => i > 0);
  for (const r of j.data) { const d = rocDate(r[0]); if (!d) continue; const o = {}; for (const [k, i] of idx) o[k] = num(r[i]); out.set(d, o); }
  return out;
}
// FMTQIK（OpenAPI 或網站）→ 量值列
export const fmtRow = r => [rocDate(r.Date), r2(num(r.TradeVolume) / 1e8), r2(num(r.TradeValue) / 1e8), r1(num(r.Transaction) / 1e4), num(r.TAIEX)];
export const fmtRwd = j => { const M = rwdMonth(j, [["v", /成交股數/], ["a", /成交金額/], ["n", /成交筆數/], ["e", /加權/]]);
  return [...M].map(([d, o]) => [d, { a: r2(o.v / 1e8), b: r2(o.a / 1e8), c: r1(o.n / 1e4), e: o.e }]); };
// 董監質押（上市）：每列一個級距，公司名稱是好幾個「代號 名稱」，沒有個別比例
export function parsePledgeL(rows) {
  const buckets = new Map(), top = [];
  for (const r of rows || []) { const k = str(r["百分比"]), L = [...String(r["公司名稱"] || "").matchAll(/(\d{4,6}[A-Z]?)\s+([^\s\d][^\s]*)/g)].map(m => [m[1], m[2], null, k]);
    buckets.set(k, (buckets.get(k) || 0) + L.length); top.push(...L); }
  const lv = k => -(num(k) ?? 0); // 比例高的級距排前面
  return { date: rocDate(rows?.[0]?.["出表日期"]), buckets: [...buckets], top: top.sort((a, b) => lv(a[3]) - lv(b[3])).slice(0, 80) };
}
// 暫停先賣後買當沖預告（TWTBAU1）、停資停券預告（BFI84U）：[代號, 名稱, 開始, 結束, 原因]
export const susRowsL = rows => (rows || []).map(r => [str(r.Code), str(r.Name), rocDate(r.StartDate), rocDate(r.EndDate), str(r.Reason)]).filter(r => r[0] && r[2]);

async function oapi(p) { const r = await fetch("https://openapi.twse.com.tw/v1" + p, { headers: UA, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${p} HTTP ${r.status}`); const j = await r.json().catch(() => null); if (!Array.isArray(j)) throw new Error(`${p} 回的不是資料（可能在維護）`); return j; } // 維護頁面當成失敗，沿用上次的清單，不要被空清單蓋掉
async function rwd(p) { const r = await fetch("https://www.twse.com.tw/rwd/zh/" + p + (p.includes("?") ? "&" : "?") + "response=json", { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${p} HTTP ${r.status}`); return r.json(); }

export async function main({ get = oapi, getRwd = rwd, getMops = ym => mops(ym, "sii"), now = Date.now(), gap = 1200, out: OUT_ = OUT, rev: REV_ = REV } = {}) {
  const old = await readFile(OUT_, "utf8").then(JSON.parse).catch(() => ({})), rh = await readFile(REV_, "utf8").then(JSON.parse).catch(() => ({}));
  const safe = async p => { try { const L = await get(p); await sleep(gap); return L; } catch (e) { console.log("失敗", p, e.message); return null; } };
  const web = async p => { try { const j = await getRwd(p); await sleep(gap); return j; } catch (e) { console.log("失敗", p, e.message); return null; } };
  // 當月：OpenAPI
  const add = new Map(), at = d => add.get(d) || add.set(d, {}).get(d), sets = {};
  for (const [k, p, f] of LX) { const L = sets[p] ||= await safe(p) || []; for (const r of L) { const d = rocDate(r.Date); if (d) at(d)[k] = num(r[f]); } }
  const mi = miIndex(await safe("/exchangeReport/MI_INDEX") || []); if (mi.d) Object.assign(at(mi.d), mi.theme);
  const vadd = new Map((await safe("/exchangeReport/FMTQIK") || []).map(fmtRow).filter(r => r[0]).map(r => [r[0], { a: r[1], b: r[2], c: r[3], e: r[4] }]));
  // 更早的月份：網站月報表，缺哪個月補哪個月（當月和上個月每次重抓）
  const cur = ymOf(now), have = new Set((old.vol || []).map(r => r[0].slice(0, 7))), haveIx = new Set((old.ix?.rows || []).filter(r => r[1] != null && r[2] != null).map(r => r[0].slice(0, 7)));
  let n = 0;
  for (let i = 0; i < REV_KEEP; i++) { const ym = ymBack(cur, i), k = ymKey(ym), q = `date=${ym[0]}${String(ym[1]).padStart(2, "0")}01`;
    if (i >= 2 && have.has(k) && haveIx.has(k)) continue; if (n++ >= MONTH_NEW) break;
    if (i || !vadd.size || i === 0) {
      for (const [d, o] of fmtRwd(await web(`afterTrading/FMTQIK?${q}`))) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !o || o.e == null || o.a == null) continue;
        const curV = vadd.get(d);
        if (!curV || curV.e == null || i === 0) vadd.set(d, o);
      }
    }
    const maxAddDate = [...add.keys()].sort().pop(), maxVaddDate = [...vadd.keys()].sort().pop();
    const addNeedsCatchup = maxVaddDate && (!maxAddDate || maxAddDate < maxVaddDate);
    if (!i && add.size && !addNeedsCatchup) continue;
    for (const path of [...new Set(LX.map(x => x[3]).filter(Boolean))]) for (const [d, o] of rwdMonth(await web(`${path}?${q}`), LX.filter(x => x[3] === path).map(x => [x[0], x[4]])))
      for (const [c, v] of Object.entries(o)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v != null && at(d)[c] == null) at(d)[c] = v; }
  const vol = mergeRows(old.vol, vadd, ["d", "a", "b", "c", "e"]);
  // 類股指數：今天的 OpenAPI，加上往前補沒有的交易日（日期以量值的交易日為準）
  const scols = [...new Set([...(old.sec?.cols || []), ...Object.keys(mi.sec)])], sadd = new Map(); if (mi.d) sadd.set(mi.d, mi.sec);
  const shave = new Set((old.sec?.rows || []).map(r => r[0])), need = vol.map(r => r[0]).filter(d => !shave.has(d) && d !== mi.d).reverse().slice(0, DAY_NEW);
  for (const d of need) { const R = miIndexRwd(await web(`afterTrading/MI_INDEX?date=${d.replace(/-/g, "")}&type=IND`)); if (!Object.keys(R.sec).length) continue;
    for (const c of Object.keys(R.sec)) if (!scols.includes(c)) scols.push(c); sadd.set(d, R.sec);
    for (const [c, v] of Object.entries(R.theme)) if (at(d)[c] == null) at(d)[c] = v; }
  const sec = { cols: scols, rows: mergeRows((old.sec?.rows || []).map(r => [r[0], ...scols.map((c, i) => r[i + 1] ?? null)]), sadd, ["d", ...scols], 250) };
  const ix = mergeRows(old.ix?.rows, add, LX_COLS);
  const revm = await revUpdate(old.revm, rh, now, getMops, gap);
  // 最新一天的清單
  const snap = { ...(old.snap || {}) }, put = (k, v) => { if (v != null) snap[k] = v; };
  const pl = await safe("/opendata/t187ap09_L"); if (pl?.length) put("pledge", parsePledgeL(pl));
  const sh = await safe("/opendata/t187ap08_L"); if (sh) put("short", parseShort(sh));
  const f15 = await safe("/opendata/t187ap15_L"), f16 = await safe("/opendata/t187ap16_L"); if (f15 || f16) put("fc", { a: (f15 || []).slice(0, 200), b: (f16 || []).slice(0, 200) });
  const su = await safe("/exchangeReport/TWTBAU1"); if (su) put("sus", susRowsL(su));
  const ss = await safe("/exchangeReport/BFI84U"); if (ss) put("sss", susRowsL(ss));
  const wl = await safe("/opendata/t187ap42_L"), mg = wl?.length ? await safe("/exchangeReport/MI_MARGN") : null;
  if (wl?.length && mg?.length) put("wtu", { date: rocDate(wl[0]["交易日期"]), rows: warrantUnderL(wl, mg.map(r => [str(r["股票代號"]), str(r["股票名稱"])]).filter(x => x[0] && x[1])) });
  const out = { updated: new Date(now).toISOString(), ix: { cols: LX_COLS, rows: ix }, sec, vol, revm: [...revm.values()].sort((a, b) => a.ym.localeCompare(b.ym)).slice(-REV_KEEP), snap };
  if (!ix.length && !vol.length && !out.revm.length) throw new Error("證交所、觀測站都沒拿到資料");
  await writeFile(OUT_, JSON.stringify(out)); await writeFile(REV_, JSON.stringify(rh));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok 指數", o.ix.rows.length, "天、類股", o.sec.rows.length, "天、量值", o.vol.length, "天、月營收", o.revm.length, "個月")).catch(e => { console.error(e); process.exit(1); });
