// 櫃買中心圖表資料：每個交易日收盤後把櫃買 OpenAPI 的「當月」資料累積成歷史，寫進 learner/data/tpex.json（情報局「大盤 → 櫃買」用，learner/tpex.js）。
// GitHub Actions 每個交易日跑兩次（.github/workflows/tpex-daily.yml）。櫃買 OpenAPI 的指數、量值只給當月，舊的日子沿用檔案裡的；
// 月營收歷史從公開資訊觀測站的上櫃彙總表補（mopsov.twse.com.tw，一個月一頁），公司逐月營收另存 learner/data/tpex-rev.json（只給排程算「創新高」用）。
// 格式：{ updated,
//   ix: { cols: ["d", "otc", "otcR", ...], rows: [["2026-10-01", 418.82, 778.92, ...]] }（舊到新；R＝報酬指數）
//   vol: [[d, 成交股數(億股), 成交金額(億元), 成交筆數(萬筆), 櫃買指數]]
//   wt: { cols: [類別...], rows: [[d, ...]] }（每日權證交易人數等）
//   gold: [[d, 代號, 名稱, 均價, 最高, 最低, 成交量]]
//   revm: [{ ym, n, up, ind: { 產業: [營收(億), 年增%, 月增%, 家數] }, hi: [[代號, 名稱, 產業, 營收(億), 年增%, 比較月數]] }]（舊到新）
//   snap: { date, pledge, short, fc, sus, sss, esb, gold, cb, wtu, wcb }（最新一天的清單；上市權證在 scripts/twse-daily.mjs） }
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { num, rocDate } from "../api/_lib/_tw.js";

const OUT = fileURLToPath(new URL("../learner/data/tpex.json", import.meta.url)), REV = fileURLToPath(new URL("../learner/data/tpex-rev.json", import.meta.url));
const API = "https://www.tpex.org.tw/openapi/v1", UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
export const KEEP = 750, REV_KEEP = 36, REV_NEW = 40, sleep = ms => new Promise(r => setTimeout(r, ms));
export const r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100), r1 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
export const str = v => String(v ?? "").replace(/\s+/g, " ").trim();

// 指數：[欄位前綴, 資料集, 價格指數欄, 報酬指數欄]（富櫃 200 只有當日，另外從 /tpex200_change 補）
export const IX = [["otc", "/tpex_reward_index", "TPExIndex", "TPExTotalReturnIndex"], ["t50", "/tpex50_index", "TPEx50Index", "TPEx50TotalReturnIndex"],
  ["hd", "/tphd_index", "TPExHighDividendYieldIndex", "TPExHighDividendYieldTotalReturnIndex"], ["cg", "/tpcgi_reward_index", "TPExCorporateGovernanceIndex", "TPExCorporateGovernanceReturnIndex"],
  ["ci", "/tpci_reward_index", "GTSMCompensationIndex", "GTSMCompensationTotalReturnIndex"], ["emp", "/tpex_emp88_reward_index", "GretaiLaborEmployment88Index", "GretaiLaborEmployment88TotalReturnIndex"]];
export const IX_COLS = ["d", ...[...IX.map(x => x[0]), "t200"].flatMap(k => [k, k + "R"])];

// 依日期合併：old 是 [[d, ...]]，add 是 Map(d → { 欄位: 值 })；新的值蓋過舊的，沒有的欄位保留舊值
export function mergeRows(old, add, cols, keep = KEEP) {
  const M = new Map((old || []).map(r => [r[0], r.slice()]));
  for (const [d, o] of add) { const r = M.get(d) || [d, ...cols.slice(1).map(() => null)]; cols.forEach((c, i) => { if (i && o[c] != null) r[i] = o[c]; }); M.set(d, r); }
  return [...M.values()].sort((a, b) => a[0].localeCompare(b[0])).slice(-keep);
}
export function ixAdd(sets, t200 = []) {
  const add = new Map(), at = d => add.get(d) || add.set(d, {}).get(d);
  for (const [k, , a, b] of IX) for (const r of sets[k] || []) { const d = rocDate(r.Date); if (!d) continue; const o = at(d); o[k] = num(r[a]); o[k + "R"] = num(r[b]); }
  for (const r of t200) { const d = rocDate(r["資料日期"]); if (!d) continue; const o = at(d); o[/報酬/.test(r["指數"]) ? "t200R" : "t200"] = num(r["收盤指數"]); }
  return add;
}
export const volRow = r => [rocDate(r.Date), r2(num(r.TradeVolume) / 1e8), r2(num(r.TradeAmount) / 1e8), r1(num(r.NumberOfTransactions) / 1e4), num(r.TPExIndex)];

// 董監質押：每一級距一筆，CompanyName 是很多行「代號  名稱  比例」
export function parsePledge(rows) {
  const buckets = [], list = [];
  for (const r of rows || []) { const L = [...String(r.CompanyName || "").matchAll(/(\d{4,6}[A-Z]?)\s+(\S+)\s+(-?[\d.]+)/g)].map(m => [m[1], m[2], +m[3]]); buckets.push([str(r.Percent), L.length]); list.push(...L); }
  return { date: rocDate(rows?.[0]?.Date), buckets, top: list.sort((a, b) => b[2] - a[2]).slice(0, 80) };
}
// 董監持股不足：[代號, 名稱, 應持有(張), 實際(張), 不足(張), 不足比例%]
export function parseShort(rows) {
  const k = (r, re) => r[Object.keys(r).find(x => re.test(x))];
  return { date: rocDate(rows?.[0]?.["出表日期"]), rows: (rows || []).map(r => { const need = num(k(r, /董事.*應持有/)) || 0, have = num(k(r, /董事.*本人實際/)) || 0, lack = num(k(r, /董事.*不足股數/)) || Math.max(0, need - have);
    return [str(r["公司代號"]), str(r["公司名稱"]), Math.round(need / 1000), Math.round(have / 1000), Math.round(lack / 1000), need ? r1(lack / need * 100) : null]; }).sort((a, b) => (b[5] || 0) - (a[5] || 0)) };
}
// 暫停當沖、暫停融券預告：[代號, 名稱, 開始, 結束, 原因]
export const susRows = (rows, a, b) => (rows || []).map(r => [str(r.SecuritiesCompanyCode), str(r.CompanyName), rocDate(r[a]), rocDate(r[b]), str(r.Reason)]).filter(r => r[0] && r[2]);
// 權證：依標的加總當日成交值（元 → 萬元），分認購、認售
export function warrantUnder(rows) {
  const M = new Map();
  for (const r of rows || []) { const v = num(r.TradeValue) || 0; if (!v) continue; const c = str(r.UnderlyingStockCode), g = M.get(c) || M.set(c, [c, str(r.UnderlyingStock), 0, 0, 0, num(r.UnderlyingStockClosePrice), num(r["UnderlyingStock PriceChange"])]).get(c);
    if (/售/.test(r.Name)) g[3] += v; else g[2] += v; g[4]++; }
  return [...M.values()].map(g => [g[0], g[1], Math.round(g[2] / 1e4), Math.round(g[3] / 1e4), g[4], g[5], g[6]]).sort((a, b) => b[2] + b[3] - a[2] - a[3]).slice(0, 60);
}
// 上市權證（證交所 t187ap42_L 只有權證名稱、沒有標的代號）：用名稱開頭比對股票簡稱（取最長的），加總成交金額 → 和 warrantUnder 同樣格式
export function warrantUnderL(rows, names) {
  const by = new Map(); for (const [c, n] of names) { const k = n.slice(0, 2); (by.get(k) || by.set(k, []).get(k)).push([c, n]); }
  for (const L of by.values()) L.sort((a, b) => b[1].length - a[1].length);
  const M = new Map();
  for (const r of rows || []) { const v = num(r["成交金額"]) || 0; if (!v) continue; const w = str(r["權證名稱"]), hit = (by.get(w.slice(0, 2)) || []).find(([, n]) => w.startsWith(n)); if (!hit) continue;
    const g = M.get(hit[0]) || M.set(hit[0], [hit[0], hit[1], 0, 0, 0, null, null]).get(hit[0]); if (/售/.test(w.slice(hit[1].length))) g[3] += v; else g[2] += v; g[4]++; }
  return [...M.values()].map(g => [g[0], g[1], Math.round(g[2] / 1e4), Math.round(g[3] / 1e4), g[4], null, null]).sort((a, b) => b[2] + b[3] - a[2] - a[3]).slice(0, 60);
}
// 上櫃牛熊證：有成交的 [代號, 名稱, 標的, 收盤, 成交值(萬)]
export const wcbRows = R => (R || []).map(r => [str(r.Code), str(r.Name), str(r.UnderlyingStock), num(r.Close), Math.round((num(r.TradeValue) || 0) / 1e4)]).filter(x => x[4] > 0).sort((a, b) => b[4] - a[4]).slice(0, 40);
// 公開資訊觀測站上櫃月營收彙總表（big5 HTML）：每個產業一張表，每列 代號、名稱、當月、上月、去年當月、月增%、年增%…（千元）
export function parseMops(html) {
  const out = []; let ind = "";
  for (const m of html.matchAll(/產業別：([^<]+)<|<tr align=right><td align=center>\s*([0-9A-Z]{4,6})\s*<\/td><td align=left>([^<]*)<\/td>((?:<[tT][dD][^>]*>[^<]*<\/[tT][dD]>){5})/g)) {
    if (m[1]) { ind = m[1].trim(); continue; }
    const v = [...m[4].matchAll(/<[tT][dD][^>]*>([^<]*)</g)].map(x => num(x[1]));
    out.push({ c: m[2], n: str(m[3]), ind, cur: v[0], last: v[1], ly: v[2], mom: v[3], yoy: v[4] });
  }
  return out;
}
// 一個月的產業彙總與創新高：rh 是 { 代號: [名稱, 產業, { ym: 營收 }] }
export function revMonth(ym, rows, rh) {
  const ind = {}, hi = []; let up = 0;
  const prev = (k, n) => { const [y, m] = k.split("-").map(Number), t = y * 12 + m - 1 - n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; };
  for (const r of rows) { if (r.cur == null) continue;
    const g = ind[r.ind] ||= [0, 0, 0, 0]; g[0] += r.cur; if (r.ly) g[1] += r.ly; if (r.last) g[2] += r.last; g[3]++;
    if (r.mom > 0 && r.yoy > 0) up++;
    const H = rh[r.c]?.[2] || {}, past = Array.from({ length: 24 }, (_, i) => H[prev(ym, i + 1)]).filter(v => v != null);
    if (past.length >= 12 && r.cur > Math.max(...past)) hi.push([r.c, r.n, r.ind, r2(r.cur / 1e5), r1(r.yoy), past.length]); }
  return { ym, n: rows.length, up, ind: Object.fromEntries(Object.entries(ind).map(([k, g]) => [k, [r2(g[0] / 1e5), g[1] ? r1((g[0] / g[1] - 1) * 100) : null, g[2] ? r1((g[0] / g[2] - 1) * 100) : null, g[3]]])),
    hi: hi.sort((a, b) => b[3] - a[3]) };
}
export const ymOf = t => { const d = new Date(t + 8 * 3600e3); return [d.getUTCFullYear(), d.getUTCMonth() + 1]; };
export const ymBack = ([y, m], n) => { const t = y * 12 + m - 1 - n; return [Math.floor(t / 12), t % 12 + 1]; };
export const ymKey = ([y, m]) => `${y}-${String(m).padStart(2, "0")}`;

async function api(p) { const r = await fetch(API + p, { headers: UA, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${p} HTTP ${r.status}`); const j = await r.json().catch(() => null); return Array.isArray(j) ? j : []; }
// 觀測站月營收彙總表：otc＝上櫃、sii＝上市
export async function mops([y, m], kind = "otc") {
  const r = await fetch(`https://mopsov.twse.com.tw/nas/t21/${kind}/t21sc03_${y - 1911}_${m}_0.html`, { headers: { "User-Agent": UA["User-Agent"] }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) return []; return parseMops(new TextDecoder("big5").decode(await r.arrayBuffer()));
}

// 月營收：最近兩個月每次重抓（公司會更正），更早的缺幾個月補幾個月；rh（公司逐月營收）就地更新，回傳 Map(ym → revMonth)
export async function revUpdate(oldRevm, rh, now, getMops, gap) {
  const cur = ymOf(now), have = new Set((oldRevm || []).map(x => x.ym)), revm = new Map((oldRevm || []).map(x => [x.ym, x])); let fetched = 0;
  const months = Array.from({ length: REV_KEEP }, (_, i) => ymBack(cur, i + 1)).reverse(); // 舊到新，創新高要先有前面的月份
  for (const ym of months) { const k = ymKey(ym), recent = ym[0] * 12 + ym[1] >= cur[0] * 12 + cur[1] - 2;
    if (have.has(k) && !recent) continue; if (fetched >= REV_NEW) break;
    let rows = []; try { rows = await getMops(ym); } catch (e) { console.log("觀測站失敗", k, e.message); } fetched++; await sleep(gap);
    if (rows.length < 100) continue;
    for (const r of rows) { const x = rh[r.c] ||= [r.n, r.ind, {}]; x[0] = r.n; x[1] = r.ind; if (r.cur != null) x[2][k] = r.cur; if (r.last != null && x[2][ymKey(ymBack(ym, 1))] == null) x[2][ymKey(ymBack(ym, 1))] = r.last; if (r.ly != null && x[2][ymKey(ymBack(ym, 12))] == null) x[2][ymKey(ymBack(ym, 12))] = r.ly; }
    revm.set(k, revMonth(k, rows, rh)); console.log("月營收", k, rows.length, "家，創新高", revm.get(k).hi.length); }
  const cut = ymKey(ymBack(cur, REV_KEEP + 26)); for (const x of Object.values(rh)) for (const k of Object.keys(x[2])) if (k < cut) delete x[2][k];
  return revm;
}

export async function main({ get = api, getMops = mops, now = Date.now(), gap = 800, out: OUT_ = OUT, rev: REV_ = REV } = {}) {
  const old = await readFile(OUT_, "utf8").then(JSON.parse).catch(() => ({})), rh = await readFile(REV_, "utf8").then(JSON.parse).catch(() => ({}));
  const safe = async p => { try { const L = await get(p); await sleep(gap); return L; } catch (e) { console.log("失敗", p, e.message); return null; } };
  const sets = {}; for (const [k, p] of IX) sets[k] = await safe(p) || [];
  const ix = mergeRows(old.ix?.rows, ixAdd(sets, await safe("/tpex200_change") || []), IX_COLS);
  const vol = mergeRows(old.vol, new Map((await safe("/tpex_daily_trading_index") || []).map(volRow).filter(r => r[0]).map(r => [r[0], { a: r[1], b: r[2], c: r[3], e: r[4] }])), ["d", "a", "b", "c", "e"]);
  const ws = await safe("/tpex_warrant_statistics") || [], wcols = [...new Set([...(old.wt?.cols || []), ...ws.map(r => str(r.Category))])];
  const wadd = new Map(); for (const r of ws) { const d = rocDate(r.Date); if (d) (wadd.get(d) || wadd.set(d, {}).get(d))[str(r.Category)] = num(r.Statistics); }
  const wt = { cols: wcols, rows: mergeRows((old.wt?.rows || []).map(r => [r[0], ...wcols.map((c, i) => r[i + 1] ?? null)]), wadd, ["d", ...wcols]) };
  const gl = await safe("/tpex_gold_latest") || [], gnew = gl.map(r => [rocDate(r.Date), str(r.GoldCode), str(r.GoldShortName), num(r["TradingAvg."]), num(r.TradingHighest), num(r.TradingLowest), num(r.TradingVolume)]).filter(r => r[0]);
  const gold = [...new Map([...(old.gold || []), ...gnew].map(r => [r[0] + r[1], r])).values()].sort((a, b) => a[0].localeCompare(b[0])).slice(-KEEP * 2);
  const revm = await revUpdate(old.revm, rh, now, getMops, gap);
  // 最新一天的清單
  const snap = { ...(old.snap || {}) }, put = (k, v) => { if (v != null) snap[k] = v; };
  const pl = await safe("/mopsfin_t187ap09_O"); if (pl?.length) put("pledge", parsePledge(pl));
  const sh = await safe("/mopsfin_t187ap08_O"); if (sh) put("short", parseShort(sh));
  const f15 = await safe("/mopsfin_t187ap15_O"), f16 = await safe("/mopsfin_t187ap16_O"); if (f15 || f16) put("fc", { a: (f15 || []).slice(0, 200), b: (f16 || []).slice(0, 200) });
  const it = await safe("/tpex_intraday_trading_pre"); if (it) put("sus", susRows(it, "FirstDayToSuspendSellThenBuy", "DayOfReinstatingSellThenBuy"));
  const mt = await safe("/tpex_margin_trading_term"); if (mt) put("sss", susRows(mt, "ShortSaleSuspensionStartDate", "ShortSaleSuspensionEndDate"));
  const es = await safe("/tpex_esb_eps_rank"); if (es?.length) put("esb", { date: rocDate(es[0].Date), rows: es.map(r => [+r.Rank, str(r.SecuritiesCompanyCode), str(r.CompanyName), num(r.EPS)]) });
  if (gl.length) put("gold", gl.map(r => ({ d: rocDate(r.Date), t: str(r.Time), code: str(r.GoldCode), name: str(r.GoldShortName), buy: num(r["QuotedBuyingB.Price"]), sell: num(r["QuotedSellingS.Price"]), chg: r2(num(r.QuotedSellingChange)), avg: num(r["TradingAvg."]), pavg: num(r["TradingPreAvg."]), hi: num(r.TradingHighest), lo: num(r.TradingLowest), last: num(r["TradingLatestTradingInfo.LatestPrice"]), vol: num(r.TradingVolume), n: num(r.TradingTransaction) })));
  const cb = await safe("/bond_cb_daily"); if (cb?.length) put("cb", { date: rocDate(cb[0].Date), rows: cb.map(r => [str(r.FinancialInstitutionsCode), str(r.FinancialInstitutionsName), num(r.ParValueOfPurchase), num(r.AmountOfPurchase), num(r.ParValueOfSell), num(r.AmountOfSell)]) });
  const wq = await safe("/tpex_warrant_daily_quts"); if (wq?.length) put("wtu", { date: rocDate(wq[0].Date), rows: warrantUnder(wq) });
  const wb = await safe("/tpex_warrant_wcb_daily_quts"); if (wb) put("wcb", { date: rocDate(wb[0]?.Date) || "", rows: wcbRows(wb) });
  const out = { updated: new Date(now).toISOString(), ix: { cols: IX_COLS, rows: ix }, vol, wt, gold, revm: [...revm.values()].sort((a, b) => a.ym.localeCompare(b.ym)).slice(-REV_KEEP), snap };
  if (!ix.length && !out.revm.length) throw new Error("櫃買中心、觀測站都沒拿到資料");
  await writeFile(OUT_, JSON.stringify(out)); await writeFile(REV_, JSON.stringify(rh));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok 指數", o.ix.rows.length, "天、量值", o.vol.length, "天、月營收", o.revm.length, "個月")).catch(e => { console.error(e); process.exit(1); });
