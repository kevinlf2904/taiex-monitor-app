// 盤後資料：每個交易日收盤後整理全市場排行，寫進 learner/data/market/after.json，給 learner/after.js 的「盤後」分頁。
// GitHub Actions 跑（.github/workflows/market-after.yml），Vercel 不用每次向證交所抓一大堆資料。
//   hist   近 60 個交易日的大盤三大法人買賣超金額（BFI82U，上市，億元）與融資融券餘額（MI_MARGN，上市）
//   ranks  最近一個交易日的排行：市值、籌碼總覽、法人買賣超、外資持股、法人散戶對做、土洋對做、資券增減、營收、股利
//   fr     外資持股比率（代號 → %），下次執行時拿來算「持股比率增減」
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getJSON, num, companies } from "../api/_lib/_tw.js";
import { closeToday, parseInst, pickTable } from "../api/_lib/daily.js";
import { parseBfi82u } from "../api/_lib/market.js";
import { parseMargin } from "../api/_lib/mktstats.js";
import { parseRevenue, parseBw } from "../api/_lib/screen.js";

const OUT = fileURLToPath(new URL("../learner/data/market/after.json", import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymdOf = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
const dash = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, slash = d => `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6)}`, roc = d => `${+d.slice(0, 4) - 1911}/${d.slice(4, 6)}/${d.slice(6)}`;
const isCode = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c);
const clean = s => String(s ?? "").replace(/\s|<[^>]+>/g, "");
const tries = async urls => { for (const u of urls) { try { const j = await getJSON(u, 15000); if (pickTable(j, /代號/)) return j; } catch {} } return null; };

// 個股融資融券（證交所 MI_MARGN ALL、櫃買中心融資融券餘額）：欄位名稱重複（融資、融券都有「前日餘額」「今日餘額」），依出現順序取
export function parseMarginAll(j) {
  const out = new Map(), t = pickTable(j, /代號/, /餘額/); if (!t) return out;
  const f = t.fields.map(clean), all = re => f.map((x, i) => (re.test(x) ? i : -1)).filter(i => i >= 0);
  const iC = f.findIndex(x => /代號/.test(x)), iN = f.findIndex(x => /名稱/.test(x));
  // 證交所：前日餘額×2、今日餘額×2；櫃買：前資餘額、資餘額、前券餘額、券餘額
  let mP = f.findIndex(x => /前資餘額/.test(x)), mT = f.findIndex(x => /^資餘額/.test(x)), sP = f.findIndex(x => /前券餘額/.test(x)), sT = f.findIndex(x => /^券餘額/.test(x));
  if (mP < 0 || mT < 0) { const p = all(/前日餘額/), q = all(/今日餘額/); [mP, sP] = p; [mT, sT] = q; }
  if (mP == null || mT == null || mP < 0 || mT < 0) return out;
  for (const r of t.data) {
    const c = clean(r[iC]); if (!isCode(c)) continue;
    const m = num(r[mT]), mp = num(r[mP]), s = sT >= 0 ? num(r[sT]) : null, sp = sP >= 0 ? num(r[sP]) : null; if (m == null) continue;
    out.set(c, { name: clean(r[iN]), m, mChg: mp != null ? m - mp : null, s, sChg: s != null && sp != null ? s - sp : null }); // 單位：張
  }
  return out;
}
// 外資持股（證交所 MI_QFIIS）：代號 → 全體外資及陸資持股比率
export function parseQfiis(j) {
  const out = new Map(), t = pickTable(j, /證券代號/, /持股比率/); if (!t) return out;
  const f = t.fields.map(clean), iC = f.findIndex(x => /證券代號/.test(x)), iR = f.findIndex(x => /全體外資.*持股比率/.test(x)) >= 0 ? f.findIndex(x => /全體外資.*持股比率/.test(x)) : f.findIndex(x => /持股比率/.test(x));
  for (const r of t.data) { const c = clean(r[iC]), v = num(r[iR]); if (isCode(c) && v != null) out.set(c, v); }
  return out;
}

// 排行：每個排行有幾個小分頁（tabs），每個小分頁取前 N 名
const N = 40;
// 方向性的排行（買超、賣超、增加、減少）只放真的有買超／賣超的
const SIGNED = new Set(["f", "t", "d", "a", "aAmt", "mc", "sc", "frc"]);
const top = (arr, key, desc = true, n = N) => arr.filter(x => x[key] != null && Number.isFinite(x[key]) && (!SIGNED.has(key) || (desc ? x[key] > 0 : x[key] < 0))).sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key])).slice(0, n);
const yi = v => +(v / 1e8).toFixed(2);
export function buildRanks({ quotes, inst = new Map(), margin = new Map(), qfiis = new Map(), prevFr = {}, shares = new Map(), rev = [], bw = [] }) {
  // 每檔一列：c 代號、n 名稱、m 市場、p 收盤、pct 漲跌幅、v 成交張數
  const base = [...quotes].map(([c, q]) => {
    const i = inst.get(c), g = margin.get(c), sh = shares.get(c)?.shares, fr = qfiis.get(c);
    const x = { c, n: q.name, m: q.market === "上櫃" ? "櫃" : "市", p: q.p, pct: q.pct, v: q.v };
    if (i) { x.f = i[0]; x.t = i[1]; x.d = i[2]; x.a = i[0] + i[1] + i[2]; x.aAmt = yi(x.a * 1000 * q.p); x.fAmt = yi(i[0] * 1000 * q.p); x.tAmt = yi(i[1] * 1000 * q.p); x.dAmt = yi(i[2] * 1000 * q.p); }
    if (g) { x.mb = g.m; x.mc = g.mChg; x.sb = g.s; x.sc = g.sChg; if (g.m >= 1000 && g.s != null) x.sr = +(g.s / g.m * 100).toFixed(2); }
    if (sh) x.cap = yi(sh * q.p);
    if (fr != null) { x.fr = fr; if (prevFr[c] != null) x.frc = +(fr - prevFr[c]).toFixed(2); }
    return x;
  });
  const pick = (rows, keys) => rows.map(x => Object.fromEntries(["c", "n", "m", "p", "pct", ...keys].filter(k => x[k] != null).map(k => [k, x[k]])));
  const tab = (id, t, rows, keys) => ({ id, t, keys, rows: pick(rows, keys) });
  const ranks = [];
  ranks.push({ id: "mcap", title: "市值排行", desc: "收盤價 × 已發行普通股數（上市櫃公司，不含 ETF）", tabs: [tab("cap", "市值", top(base, "cap"), ["cap", "v"])] });
  ranks.push({ id: "chips", title: "籌碼總覽排行", desc: "三大法人合計買賣超，並列出融資、融券增減（張）", tabs: [
    tab("ab", "法人買超", top(base, "a"), ["f", "t", "d", "a", "mc", "sc"]), tab("as", "法人賣超", top(base, "a", false), ["f", "t", "d", "a", "mc", "sc"])] });
  ranks.push({ id: "inst", title: "法人買賣超排行", desc: "張數；金額＝張數 × 收盤價（估算，億元）", tabs: [
    tab("fb", "外資買超", top(base, "f"), ["f", "fAmt"]), tab("fs", "外資賣超", top(base, "f", false), ["f", "fAmt"]),
    tab("tb", "投信買超", top(base, "t"), ["t", "tAmt"]), tab("ts", "投信賣超", top(base, "t", false), ["t", "tAmt"]),
    tab("db", "自營買超", top(base, "d"), ["d", "dAmt"]), tab("ds", "自營賣超", top(base, "d", false), ["d", "dAmt"]),
    tab("abA", "合計買超金額", top(base, "aAmt"), ["a", "aAmt"]), tab("asA", "合計賣超金額", top(base, "aAmt", false), ["a", "aAmt"])] });
  ranks.push({ id: "hold", title: "法人持股排行", desc: "全體外資及陸資持股比率（證交所，上市）", tabs: [
    tab("fr", "外資持股最高", top(base, "fr"), ["fr", "frc"]), tab("fru", "持股比率增加", top(base, "frc"), ["fr", "frc"]), tab("frd", "持股比率減少", top(base, "frc", false), ["fr", "frc"])] });
  // 法人散戶對做：法人合計買超而融資減少（散戶賣），或相反；依兩邊較小的那一邊排序
  const vs = (a, b) => base.filter(x => x.a != null && x.mc != null && Math.sign(x.a) === a && Math.sign(x.mc) === b).map(x => ({ ...x, k: Math.min(Math.abs(x.a), Math.abs(x.mc)) }));
  ranks.push({ id: "vs", title: "法人散戶對做", desc: "法人＝三大法人合計；散戶以融資增減代表。依兩邊較小的張數排序", tabs: [
    tab("ib", "法人買・散戶賣", top(vs(1, -1), "k"), ["a", "mc"]), tab("is", "法人賣・散戶買", top(vs(-1, 1), "k"), ["a", "mc"])] });
  const ty = (a, b) => base.filter(x => x.f != null && Math.sign(x.f) === a && Math.sign(x.t) === b).map(x => ({ ...x, k: Math.min(Math.abs(x.f), Math.abs(x.t)) }));
  ranks.push({ id: "ty", title: "土洋法人對做", desc: "外資（洋）與投信（土）方向相反；依兩邊較小的張數排序", tabs: [
    tab("fbt", "外資買・投信賣", top(ty(1, -1), "k"), ["f", "t"]), tab("tbf", "投信買・外資賣", top(ty(-1, 1), "k"), ["f", "t"])] });
  ranks.push({ id: "mg", title: "資券增減排行", desc: "融資、融券餘額的單日增減（張）；券資比＝融券 ÷ 融資", tabs: [
    tab("mu", "融資增加", top(base, "mc"), ["mc", "mb"]), tab("md", "融資減少", top(base, "mc", false), ["mc", "mb"]),
    tab("su", "融券增加", top(base, "sc"), ["sc", "sb"]), tab("sd", "融券減少", top(base, "sc", false), ["sc", "sb"]), tab("sr", "券資比最高", top(base, "sr"), ["sr", "mb", "sb"])] });
  // 營收：千元 → 億元；年增率只看月營收 1 億以上
  const bq = new Map(base.map(x => [x.c, x]));
  const R = rev.filter(r => bq.has(r.code)).map(r => ({ ...bq.get(r.code), rev: +(r.rev / 1e5).toFixed(2), yoy: r.yoy, mom: r.mom, cum: r.cum, ym: r.ym }));
  const big = R.filter(x => x.rev >= 1), ym = R.find(x => x.ym)?.ym;
  ranks.push({ id: "rev", title: "營收總表排行", desc: `月營收（億元）${ym ? `・資料年月 ${ym}` : ""}；年增、月增、累計年增只看月營收 1 億以上`, tabs: [
    tab("yoy", "年增率", top(big, "yoy"), ["rev", "yoy", "mom"]), tab("mom", "月增率", top(big, "mom"), ["rev", "yoy", "mom"]), tab("cum", "累計年增", top(big, "cum"), ["rev", "cum", "yoy"]), tab("rv", "營收最高", top(R, "rev"), ["rev", "yoy", "mom"])] });
  const B = bw.filter(r => bq.has(r.code) && bq.get(r.code).v >= 300).map(r => ({ ...bq.get(r.code), dy: r.dy, pe: r.pe > 0 ? r.pe : null, pb: r.pb > 0 ? r.pb : null }));
  ranks.push({ id: "div", title: "股利總表排行", desc: "殖利率、本益比、股價淨值比（證交所 BWIBBU，上市；成交量 300 張以上）", tabs: [
    tab("dy", "殖利率最高", top(B, "dy"), ["dy", "pe", "pb"]), tab("pe", "本益比最低", top(B, "pe", false), ["pe", "dy", "pb"]), tab("pb", "淨值比最低", top(B, "pb", false), ["pb", "pe", "dy"])] });
  for (const r of ranks) r.tabs = r.tabs.filter(t => t.rows.length);
  return ranks.filter(r => r.tabs.length);
}

async function dayData(d, gap) {
  const quotes = await closeToday(d); if (quotes.size < 500) return null;
  await sleep(gap);
  const inst = new Map();
  try { for (const [c, v] of parseInst(await getJSON(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${d}&selectType=ALLBUT0999&response=json`, 15000))) inst.set(c, v); } catch (e) { console.log("T86", e.message); }
  try { for (const [c, v] of parseInst(await tries([`https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=${slash(d)}&response=json`, `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&t=D&se=EW&d=${roc(d)}&o=json`]))) if (!inst.has(c)) inst.set(c, v); } catch (e) { console.log("tpex inst", e.message); }
  await sleep(gap);
  const margin = new Map();
  try { for (const [c, v] of parseMarginAll(await getJSON(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${d}&selectType=ALL&response=json`, 20000))) margin.set(c, v); } catch (e) { console.log("MI_MARGN", e.message); }
  try { for (const [c, v] of parseMarginAll(await tries([`https://www.tpex.org.tw/www/zh-tw/margin/balance?date=${slash(d)}&response=json`, `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json&d=${roc(d)}`]))) if (!margin.has(c)) margin.set(c, v); } catch (e) { console.log("tpex margin", e.message); }
  await sleep(gap);
  let qfiis = new Map();
  try { qfiis = parseQfiis(await getJSON(`https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?date=${d}&selectType=ALLBUT0999&response=json`, 20000)); } catch (e) { console.log("MI_QFIIS", e.message); }
  console.log(d, "行情", quotes.size, "法人", inst.size, "資券", margin.size, "外資持股", qfiis.size);
  return { quotes, inst, margin, qfiis };
}
async function histDay(d) {
  const [a, b] = await Promise.allSettled([getJSON(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=${d}&response=json`), getJSON(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${d}&selectType=MS&response=json`)]);
  const inst = a.status === "fulfilled" ? parseBfi82u(a.value) : null, mg = b.status === "fulfilled" ? parseMargin(b.value, d) : null;
  if (!inst && !mg) return null;
  return { d: dash(d), inst, margin: mg ? { finBal: mg.finBal, finChg: mg.finChg, shortBal: mg.shortBal, shortChg: mg.shortChg } : null };
}

export async function main({ now = Date.now(), gap = 2500 } = {}) {
  const old = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
  // 1. 歷史：補齊近 60 個交易日，今天和昨天重抓（盤後資料可能晚公布）
  const hist = new Map((old?.hist || []).map(x => [x.d, x]));
  for (let k = 0, got = 0; got < 60 && k < 90; k++) {
    const t = now - k * 864e5, d = ymdOf(t); if (new Date(t + 8 * 3600e3).getUTCDay() % 6 === 0) continue;
    if (hist.has(dash(d)) && k > 1) { got++; continue; }
    if (k > 40 && hist.size >= 20) break; // 第一次跑先補 40 天就好
    try { const x = await histDay(d); if (x) { hist.set(x.d, x); got++; } } catch (e) { console.log(d, e.message); }
    await sleep(gap);
  }
  // 2. 排行：最近一個有收盤資料的交易日
  let day = null, date = null;
  for (let k = 0; k < 7 && !day; k++) { const t = now - k * 864e5, d = ymdOf(t); if (new Date(t + 8 * 3600e3).getUTCDay() % 6 === 0) continue; try { day = await dayData(d, gap); if (day) date = d; } catch (e) { console.log(d, e.message); } }
  if (!day) throw new Error("拿不到最近交易日的收盤資料");
  const [co, revL, revO, bwL] = await Promise.allSettled([companies(), getJSON("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", 20000), getJSON("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", 20000), getJSON("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", 20000)]);
  // 外資持股比率增減：和上一次（不同日期）的比
  const prevFr = old?.frDate && old.frDate !== dash(date) ? old.fr || {} : old?.frPrev || {};
  const ranks = buildRanks({ ...day, prevFr, shares: co.value || new Map(), rev: [...parseRevenue(revL.value), ...parseRevenue(revO.value)], bw: parseBw(bwL.value) });
  const out = { updated: new Date(now).toISOString(), date: dash(date), hist: [...hist.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-60), ranks,
    fr: Object.fromEntries(day.qfiis), frDate: dash(date), frPrev: prevFr };
  await mkdir(fileURLToPath(new URL("../learner/data/market/", import.meta.url)), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok", o.date, "歷史", o.hist.length, "天", "排行", o.ranks.map(r => r.id + ":" + r.tabs.length).join(" "))).catch(e => { console.error(e); process.exit(1); });
