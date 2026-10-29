import { getJSON, num, companies, rocDate } from "./_tw.js";
import { todayTaipei } from "./quote.js";

export function isValidIsoDate(iso, maxIso = null) {
  if (!iso || typeof iso !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  if (maxIso && iso > maxIso) return false;
  return true;
}

const keyIdx = (fields, ...res) => fields.findIndex(f => res.every(re => re.test(String(f).replace(/\s|<[^>]+>/g, ""))));
// 股 → 張；缺值（null、空字串、--、不是數字）回 null，不當成 0（真正的 0 保留 0）
export const lots = v => { const n = num(v); return n == null ? null : Math.round(n / 1000); };
const isCode = c => /^(\d{4}|00\d{2,4}[A-Z]?)$/.test(c);
// rwd 的回應有兩種：{ fields, data } 或 { tables: [{ fields, data }] }；挑出含有指定欄位的那一張表
export function pickTable(j, ...res) {
  const ts = Array.isArray(j?.tables) ? j.tables : j?.fields ? [j] : [];
  return ts.find(t => Array.isArray(t?.fields) && Array.isArray(t?.data) && res.every(re => keyIdx(t.fields, re) >= 0)) || null;
}
// 三大法人：外資（不含自營商）、投信、自營商（合計）
export function parseInst(j) {
  const t = pickTable(j, /證券代號|代號/, /投信/); if (!t) return new Map();
  const f = t.fields, iC = keyIdx(f, /證券代號|^代號$/), iF = keyIdx(f, /外陸資買賣超股數/, /不含/) >= 0 ? keyIdx(f, /外陸資買賣超股數/, /不含/) : keyIdx(f, /外資.*買賣超/),
    iT = keyIdx(f, /投信.*買賣超/), iD = keyIdx(f, /^自營商買賣超股數$/) >= 0 ? keyIdx(f, /^自營商買賣超股數$/) : keyIdx(f, /自營商.*買賣超/);
  const out = new Map();
  for (const r of t.data) { const c = String(r[iC] ?? "").trim(); if (isCode(c)) out.set(c, [lots(r[iF]), lots(r[iT]), lots(r[iD])]); }
  return out;
}
// 收盤行情：代號、名稱、收盤、漲跌（正負號在獨立欄位或寫在數字前面）、成交股數
export function parseQuotes(j) {
  const t = pickTable(j, /證券代號|代號/, /收盤/); if (!t) return new Map();
  const f = t.fields, iC = keyIdx(f, /證券代號|^代號$/), iN = keyIdx(f, /證券名稱|^名稱$/), iP = keyIdx(f, /收盤/), iS = keyIdx(f, /漲跌\(\+\/-\)/), iD = keyIdx(f, /漲跌價差|^漲跌$/), iV = keyIdx(f, /成交股數/);
  const out = new Map();
  for (const r of t.data) {
    const c = String(r[iC] ?? "").trim(), p = num(r[iP]); if (!isCode(c) || !(p > 0)) continue;
    // 漲跌價差拿不到（--、空白）時漲跌幅是 null，不寫成 0%（平盤的 0.00 照常是 0）
    const raw = String(r[iD] ?? ""), sgn = iS >= 0 ? (/-/.test(String(r[iS])) ? -1 : 1) : /^\s*-/.test(raw) ? -1 : 1, dn = num(raw.trim().replace(/^[+-](?=\d)/, "")), d = dn == null ? null : Math.abs(dn) * sgn, prev = d == null ? null : p - d;
    out.set(c, { name: String(r[iN] ?? "").trim(), p, pct: prev > 0 ? +((d / prev) * 100).toFixed(2) : null, v: lots(r[iV]) });
  }
  return out;
}
export function mergeDay(quotes, inst) {
  const rows = [];
  // 法人資料裡沒有這檔：外資、投信、自營商都是 null（沒有資料），不是買賣超 0 張
  for (const [c, q] of quotes) { const i = inst.get(c) || [null, null, null]; rows.push([c, q.name, q.p, q.pct, i[0], i[1], i[2], q.v]); }
  return rows;
}
const roc = d => `${+d.slice(0, 4) - 1911}/${d.slice(4, 6)}/${d.slice(6)}`, slash = d => `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6)}`;
const tries = async (urls, fetcher = getJSON) => { for (const u of urls) { try { const j = await fetcher(u, 12000); if (j && (pickTable(j, /代號/) || Array.isArray(j.aaData) || Array.isArray(j.tables) || j.reportDate || j.date)) return j; } catch {} } return null; };
// 舊版櫃買 JSON 是 { aaData: [[...]] } 沒有欄位名稱：代號、名稱、收盤、漲跌、開、高、低、均價、成交股數
const fixTpex = j => (j && !j.fields && !j.tables && Array.isArray(j.aaData) ? { fields: ["代號", "名稱", "收盤", "漲跌", "開盤", "最高", "最低", "均價", "成交股數"], data: j.aaData } : j);
const tpexQuoteUrls = d => [`https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=${slash(d)}&type=EW&response=json`, `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${roc(d)}&se=EW&o=json`];

export function extractTwseRwdDate(j) {
  if (!j) return null;
  if (j.date) {
    const d = rocDate(j.date);
    if (d && isValidIsoDate(d)) return d;
  }
  const titles = [j.title, ...(Array.isArray(j.tables) ? j.tables.map(t => t?.title) : [])].filter(Boolean);
  for (const t of titles) {
    const m = String(t).match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const y = +m[1] + 1911, mo = String(m[2]).padStart(2, "0"), da = String(m[3]).padStart(2, "0");
      const d = `${y}-${mo}-${da}`;
      if (isValidIsoDate(d)) return d;
    }
  }
  return null;
}

export function extractTpexDate(j) {
  if (!j) return null;
  const raw = j.date || j.reportDate || j.Date || (Array.isArray(j.tables) ? j.tables[0]?.date : null);
  if (raw) {
    const d = rocDate(raw);
    if (d && isValidIsoDate(d)) return d;
  }
  const titles = [j.title, ...(Array.isArray(j.tables) ? j.tables.map(t => t?.title) : [])].filter(Boolean);
  for (const t of titles) {
    const m = String(t).match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const y = +m[1] + 1911, mo = String(m[2]).padStart(2, "0"), da = String(m[3]).padStart(2, "0");
      const d = `${y}-${mo}-${da}`;
      if (isValidIsoDate(d)) return d;
    }
  }
  return null;
}

// 當天收盤行情（上市 MI_INDEX＋上櫃）：給 _live.js 收盤後用，回 Map(code → { name, p, pct, v, market })
// 分別驗證 tseDate 與 otcDate，區分 requestedDate、sourceDate、dateVerified、dateConsistent
export async function closeToday(d, { fetchJson = getJSON, now = new Date() } = {}) {
  const dStr = String(d || "").replace(/\D/g, "");
  const out = new Map();
  out.map = out;
  const maxIso = todayTaipei(now);

  if (!/^20\d{6}$/.test(dStr)) {
    out.ok = false;
    out.error = "無效的日期格式，需為 YYYYMMDD";
    out.date = null;
    out.requestedDate = null;
    out.reqDate = null;
    out.sourceDate = null;
    out.dateVerified = false;
    out.dateConsistent = false;
    out.isSourceDateMatched = false;
    return out;
  }
  const reqIso = `${dStr.slice(0, 4)}-${dStr.slice(4, 6)}-${dStr.slice(6)}`;
  out.requestedDate = reqIso;
  out.reqDate = reqIso;

  if (!isValidIsoDate(reqIso, maxIso)) {
    out.ok = false;
    out.error = "無效的日曆日期或為未來日期";
    out.date = null;
    out.sourceDate = null;
    out.dateVerified = false;
    out.dateConsistent = false;
    out.isSourceDateMatched = false;
    return out;
  }

  const [t, o] = await Promise.allSettled([
    fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dStr}&type=ALLBUT0999&response=json`, 15000),
    tries(tpexQuoteUrls(dStr), fetchJson)
  ]);

  const tseVal = t.status === "fulfilled" ? t.value : null;
  const isTseEmpty = !tseVal || /沒有符合條件/.test(String(tseVal.stat || ""));
  const tseQuotes = isTseEmpty ? new Map() : parseQuotes(tseVal);
  const tseDate = isTseEmpty ? null : extractTwseRwdDate(tseVal);
  const tseDateValid = Boolean(tseDate && isValidIsoDate(tseDate, maxIso));

  const otcVal = o.status === "fulfilled" && o.value ? o.value : null;
  const isOtcEmpty = !otcVal || /沒有符合條件/.test(String(otcVal?.stat || ""));
  const otcQuotes = isOtcEmpty ? new Map() : parseQuotes(fixTpex(otcVal));
  const otcDate = isOtcEmpty ? null : extractTpexDate(otcVal);
  const otcDateValid = Boolean(otcDate && isValidIsoDate(otcDate, maxIso));

  for (const [c, q] of tseQuotes) out.set(c, { ...q, market: "上市" });
  for (const [c, q] of otcQuotes) if (!out.has(c)) out.set(c, { ...q, market: "上櫃" });

  const hasTse = tseQuotes.size > 0;
  const hasOtc = otcQuotes.size > 0;

  let actualDate = null;
  let dateConsistent = false;
  let dateVerified = false;

  if (hasTse && hasOtc) {
    if (tseDateValid && otcDateValid && tseDate === otcDate) {
      dateConsistent = true;
      dateVerified = true;
      actualDate = tseDate;
    } else {
      // 兩市場皆有資料但日期不一致，或有市場日期未驗證：不可冒充一致！
      dateConsistent = false;
      dateVerified = false;
      actualDate = null;
    }
  } else if (hasTse && !hasOtc) {
    // 僅上市有資料
    dateConsistent = false;
    dateVerified = tseDateValid;
    actualDate = tseDateValid ? tseDate : null;
  } else if (!hasTse && hasOtc) {
    // 僅上櫃有資料
    dateConsistent = false;
    dateVerified = otcDateValid;
    actualDate = otcDateValid ? otcDate : null;
  } else {
    dateConsistent = false;
    dateVerified = false;
    actualDate = null;
  }

  out.ok = out.size > 0;
  out.date = actualDate;
  out.sourceDate = actualDate;
  out.tseDate = tseDateValid ? tseDate : null;
  out.otcDate = otcDateValid ? otcDate : null;
  out.tseCount = tseQuotes.size;
  out.otcCount = otcQuotes.size;
  out.dateConsistent = dateConsistent;
  out.dateVerified = dateVerified;
  out.isSourceDateMatched = Boolean(dateVerified && actualDate && actualDate === reqIso);
  return out;
}
async function tpexDay(d) {
  const [qj, ij] = await Promise.all([
    tries(tpexQuoteUrls(d)),
    tries([`https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=${slash(d)}&response=json`, `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&t=D&se=EW&d=${roc(d)}&o=json`]),
  ]);
  return qj ? mergeDay(parseQuotes(fixTpex(qj)), parseInst(ij)) : [];
}

export default async function handler(req, res) {
  // ?meta=1：每檔的產業別（證交所／櫃買中心公司基本資料），讓前端把個股歸到產業板塊
  if (req.query?.meta) {
    try { const m = await companies(), ind = {}; for (const [c, x] of m) if (x.ind) ind[c] = x.ind;
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); return res.status(200).json({ ok: true, ind }); }
    catch (e) { return res.status(200).json({ ok: false, error: `拿不到產業別（${e.message}）` }); }
  }
  const d = String(req.query?.date || "").replace(/\D/g, "");
  if (!/^20\d{6}$/.test(d)) return res.status(400).json({ ok: false, error: "date 要是 YYYYMMDD" });
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  if (d > today) return res.status(400).json({ ok: false, error: "不能查未來的日期" });
  const [q, i, o] = await Promise.allSettled([
    getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${d}&type=ALLBUT0999&response=json`, 15000),
    getJSON(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${d}&selectType=ALLBUT0999&response=json`, 15000),
    tpexDay(d),
  ]);
  const quotes = q.status === "fulfilled" ? parseQuotes(q.value) : new Map(), inst = i.status === "fulfilled" ? parseInst(i.value) : new Map();
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, past = d < today;
  if (!quotes.size || !inst.size) {
    // 證交所連不上時不要被當成假日快取起來
    if (q.status === "rejected" || i.status === "rejected") return res.status(200).json({ ok: false, error: `證交所資料暫時拿不到（${(q.reason || i.reason)?.message}）` });
    // 證交所明確說「沒有符合條件的資料」才是休市，可以快取 30 天；其他空回應（維護中、只回一半）只快取 10 分鐘
    const holiday = /沒有符合條件/.test(String(q.value?.stat || "")) && /沒有符合條件/.test(String(i.value?.stat || ""));
    res.setHeader("Cache-Control", past && holiday ? "s-maxage=2592000" : "s-maxage=600");
    // 有行情、法人還沒公布（今天收盤後到下午公布前）：不是休市，標 pending，前端之後會再問
    return res.status(200).json({ ok: true, date: iso, empty: true, ...(quotes.size && !holiday ? { pending: "inst" } : {}) });
  }
  const tp = o.status === "fulfilled" ? o.value : [];
  // 上櫃抓不到：只快取 10 分鐘（原本過去的日子一律 30 天，少了上櫃的結果會留一個月）
  res.setHeader("Cache-Control", past && tp.length ? "s-maxage=2592000, stale-while-revalidate=86400" : "s-maxage=600, stale-while-revalidate=1200");
  return res.status(200).json({ ok: true, date: iso, rows: [...mergeDay(quotes, inst), ...tp], tpex: tp.length > 0, ...(tp.length ? {} : { partial: ["tpex"] }), source: tp.length ? "證交所、櫃買中心" : "證交所（上櫃暫時拿不到）" });
}
