// 真實日 K 線：給 learner/ 的「輸入股票代號」使用。
// 由伺服器端代抓（瀏覽器直接連證交所會被 CORS 擋住），依序嘗試：
//   1. 證交所（上市個股 STOCK_DAY、加權指數 MI_5MINS_HIST ＋ FMTQIK 成交金額）
//   2. 櫃買中心（上櫃個股）
//   3. Yahoo Finance（.TW / .TWO / ^TWII），前兩者都失敗時的備援
// GET /api/kline?code=2382&months=6
// GET /api/kline?code=2382&months=12&before=2025-10-01   往前載入更早的資料（看盤的 K 線往左拉到底時用；這時先問 Yahoo，一次就拿得到）
// 回傳 { ok, code, name, market, source, unit, data: [{ d: "2026-09-01", o, h, l, c, v }] }，v 的單位見 unit。

// HTTP 標頭只能用 ASCII（中文會讓 fetch 直接丟出 ByteString 錯誤）
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const INDEX_CODES = new Set(["TAIEX", "TWII", "^TWII", "加權", "加權指數", "大盤", "0000", "IX0001"]);

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

// 證交所 STOCK_DAY：fields 含 日期、成交股數、開盤價、最高價、最低價、收盤價
export function parseTwseStockDay(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const f = j.fields || [], iD = col(f, "日期"), iV = col(f, "成交股數"), iO = col(f, "開盤"), iH = col(f, "最高"), iL = col(f, "最低"), iC = col(f, "收盤");
  const name = (String(j.title || "").match(/\d{4,6}[A-Z]?\s+(\S+)/) || [])[1] || "";
  const rows = j.data.map((r) => ({ d: toISO(r[iD]), o: toNum(r[iO]), h: toNum(r[iH]), l: toNum(r[iL]), c: toNum(r[iC]), v: toNum(r[iV]) != null ? Math.round(toNum(r[iV]) / 1000) : 0 }))
    .filter((r) => r.d && r.o && r.h && r.l && r.c); // 停牌日的價格是 "--"
  return { name, rows };
}
// 櫃買中心 tradingStock：tables[0].fields 含 日 期、成交張數、開盤、最高、最低、收盤
export function parseTpex(j) {
  const t = j && Array.isArray(j.tables) ? j.tables[0] : j;
  if (!t || !Array.isArray(t.data) || !t.data.length) return null;
  const f = t.fields || [], iD = col(f, "日期"), iV = col(f, "成交張數", "成交仟股"), iO = col(f, "開盤"), iH = col(f, "最高"), iL = col(f, "最低"), iC = col(f, "收盤");
  const name = j.name || (String(t.title || j.title || "").match(/\d{4,6}[A-Z]?\s*(\S+)/) || [])[1] || "";
  const rows = t.data.map((r) => ({ d: toISO(r[iD]), o: toNum(r[iO]), h: toNum(r[iH]), l: toNum(r[iL]), c: toNum(r[iC]), v: toNum(r[iV]) ?? 0 }))
    .filter((r) => r.d && r.o && r.h && r.l && r.c);
  return { name, rows };
}
// 加權指數 MI_5MINS_HIST：fields 日期、開盤指數、最高指數、最低指數、收盤指數
export function parseTwseIndex(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return null;
  const f = j.fields || [], iD = col(f, "日期"), iO = col(f, "開盤"), iH = col(f, "最高"), iL = col(f, "最低"), iC = col(f, "收盤");
  return { name: "加權指數", rows: j.data.map((r) => ({ d: toISO(r[iD]), o: toNum(r[iO]), h: toNum(r[iH]), l: toNum(r[iL]), c: toNum(r[iC]), v: 0 })).filter((r) => r.d && r.c) };
}
// FMTQIK：每日成交金額（元）→ 億元
export function parseFmtqik(j) {
  if (!j || !/ok/i.test(j.stat || "") || !Array.isArray(j.data)) return new Map();
  const f = j.fields || [], iD = col(f, "日期"), iA = col(f, "成交金額");
  return new Map(j.data.map((r) => [toISO(r[iD]), Math.round((toNum(r[iA]) || 0) / 1e8)]));
}
export function parseYahoo(j) {
  const r = j?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return null;
  const tz = r.meta?.gmtoffset ?? 28800;
  const rows = r.timestamp.map((t, k) => ({ d: new Date((t + tz) * 1000).toISOString().slice(0, 10), o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], v: q.volume[k] != null ? Math.round(q.volume[k] / 1000) : 0 }))
    .filter((x) => x.o != null && x.h != null && x.l != null && x.c != null)
    .map((x) => ({ ...x, o: +x.o.toFixed(2), h: +x.h.toFixed(2), l: +x.l.toFixed(2), c: +x.c.toFixed(2) }));
  return { name: r.meta?.shortName || r.meta?.longName || "", rows };
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
  rows.forEach((r) => { r.v = vol.get(r.d) || 0; });
  return rows.length ? { name: "加權指數", rows, market: "指數", source: "證交所", unit: "億元" } : null;
}
async function fromYahoo(sym, months, anchor) {
  const span = anchor ? `period1=${Math.floor(anchor.getTime() / 1000) - months * 31 * 86400}&period2=${Math.floor(anchor.getTime() / 1000)}` : `range=${months <= 3 ? "3mo" : months <= 6 ? "6mo" : months <= 12 ? "1y" : "2y"}`;
  const p = parseYahoo(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${span}&interval=1d`));
  return p && p.rows.length ? { name: p.name, rows: p.rows, market: sym.endsWith(".TWO") ? "上櫃" : sym.startsWith("^") ? "指數" : "上市", source: "Yahoo Finance", unit: sym.startsWith("^") ? "千股" : "張" } : null;
}

export default async function handler(req, res) {
  const raw = String(req.query?.code || "").trim().toUpperCase();
  const months = Math.max(1, Math.min(24, parseInt(req.query?.months, 10) || 6));
  const isIndex = INDEX_CODES.has(raw) || INDEX_CODES.has(String(req.query?.code || "").trim());
  if (!isIndex && !/^\d{4,6}[A-Z]?$/.test(raw)) return res.status(400).json({ ok: false, error: "請輸入 4 到 6 碼的股票代號（例如 2330、0050、00891），或輸入「加權」看大盤。" });

  // before：只要這一天以前的資料（不含當天）
  const before = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.before || "")) ? String(req.query.before) : null;
  const anchor = before ? new Date(new Date(before + "T00:00:00Z").getTime() - 86400e3) : null;
  const tries = isIndex
    ? (before ? [() => fromYahoo("^TWII", months, anchor), () => fromTwseIndex(months, anchor)] : [() => fromTwseIndex(months), () => fromYahoo("^TWII", months)])
    : before
      ? [() => fromYahoo(`${raw}.TW`, months, anchor), () => fromYahoo(`${raw}.TWO`, months, anchor), () => fromTwse(raw, months, anchor), () => fromTpex(raw, months, anchor)]
      : [() => fromTwse(raw, months), () => fromTpex(raw, months), () => fromYahoo(`${raw}.TW`, months), () => fromYahoo(`${raw}.TWO`, months)];
  const errors = [];
  for (const t of tries) {
    try {
      const r = await t();
      if (r && r.rows.length >= (before ? 1 : 5)) {
        const seen = new Set(), data = r.rows.filter((x) => !seen.has(x.d) && seen.add(x.d) && (!before || x.d < before)).sort((a, b) => a.d.localeCompare(b.d));
        if (before && !data.length) continue;
        res.setHeader("Cache-Control", before ? "s-maxage=86400, stale-while-revalidate=604800" : "s-maxage=1800, stale-while-revalidate=86400");
        return res.status(200).json({ ok: true, code: isIndex ? "TAIEX" : raw, name: r.name, market: r.market, source: r.source, unit: r.unit, data });
      }
    } catch (e) { errors.push(e.message); }
  }
  if (before) return res.status(200).json({ ok: true, code: isIndex ? "TAIEX" : raw, data: [], end: true, note: `${before} 以前沒有更早的資料了。` });
  return res.status(200).json({ ok: false, error: `找不到 ${raw} 的資料。請確認代號是否正確；若是剛上市或停牌的股票，可能沒有足夠的交易日。${errors.length ? `（${errors[0]}）` : ""}` });
}
