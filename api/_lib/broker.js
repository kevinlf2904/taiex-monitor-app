// 券商分點（主力進出）：給 learner/stockx.js 的「分點」使用（台股）。
// GET /api/broker?code=2330 → { ok, code, days: [...], tops: { 1, 5, 20 } }
//   days  每個交易日：{ d, vol（張）, net（前 15 大買超＋前 15 大賣超，張）, c5, c20（5／20 日集中度 %）, buyN, sellN（買超、賣超家數）}
//   tops  近 1／5／20 日的買方、賣方前 15 名分點：{ buy: [{ name, id, net（張）, avg（均價）}], sell: [...] }
// 籌碼集中度＝前 15 大買超分點的買超合計－前 15 大賣超分點的賣超合計，除以區間成交量。家數差＝買超家數－賣超家數。
// 來源：FinMind TaiwanStockTradingDailyReport（整理自證交所買賣日報表）。這個資料集要 FinMind「贊助會員」的
// FINMIND_TOKEN 才能用；沒有權限時回 { ok: false, needSponsor: true }，頁面會說明，不會編數字。
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const BASE = "https://api.finmindtrade.com/api/v4";
const ymd = d => d.toISOString().slice(0, 10);

class NeedSponsor extends Error {}
async function fetchDay(code, date, token) {
  const h = { ...UA, Authorization: `Bearer ${token}` };
  for (const url of [`${BASE}/taiwan_stock_trading_daily_report?data_id=${encodeURIComponent(code)}&date=${date}`,
    `${BASE}/data?dataset=TaiwanStockTradingDailyReport&data_id=${encodeURIComponent(code)}&start_date=${date}&end_date=${date}`]) {
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(9000) });
    const j = await r.json().catch(() => null);
    if (j && Array.isArray(j.data) && (r.ok && (!j.status || j.status === 200))) return j.data;
    const msg = String(j?.msg || "");
    if (/level|sponsor|backer|贊助|權限|permission/i.test(msg) || r.status === 402 || r.status === 403) throw new NeedSponsor(msg || `HTTP ${r.status}`);
  }
  return [];
}

// 一天的原始資料（每個分點、每個價位一列，單位：股）→ 每個分點的買、賣張數與均價
export function aggDay(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const id = String(r.securities_trader_id || r.securities_trader || ""), b = +r.buy || 0, s = +r.sell || 0, p = +r.price || 0; if (!id) continue;
    const x = by.get(id) || { id, name: String(r.securities_trader || id).trim(), b: 0, s: 0, bv: 0, sv: 0, bq: 0, sq: 0 };
    x.b += b; x.s += s; if (p > 0) { x.bv += p * b; x.sv += p * s; x.bq += b; x.sq += s; }
    by.set(id, x);
  }
  return by;
}
// 多天合併
function merge(maps) {
  const out = new Map();
  for (const m of maps) for (const [id, x] of m) { const y = out.get(id) || { id, name: x.name, b: 0, s: 0, bv: 0, sv: 0, bq: 0, sq: 0 }; for (const k of ["b", "s", "bv", "sv", "bq", "sq"]) y[k] += x[k]; out.set(id, y); }
  return out;
}
const lots = v => Math.round(v / 1000);
// 前 15 大買超、賣超與集中度
export function topOf(m) {
  const L = [...m.values()].map(x => ({ ...x, net: x.b - x.s })), vol = L.reduce((s, x) => s + x.b, 0);
  const buy = L.filter(x => x.net > 0).sort((a, b) => b.net - a.net), sell = L.filter(x => x.net < 0).sort((a, b) => a.net - b.net);
  const t15 = buy.slice(0, 15).reduce((s, x) => s + x.net, 0) + sell.slice(0, 15).reduce((s, x) => s + x.net, 0);
  const row = (x, side) => ({ name: x.name, id: x.id, net: lots(x.net), avg: side === "b" ? (x.bq ? +(x.bv / x.bq).toFixed(2) : null) : (x.sq ? +(x.sv / x.sq).toFixed(2) : null) });
  return { vol: lots(vol), net: lots(t15), conc: vol ? +(t15 / vol * 100).toFixed(2) : null, buyN: buy.length, sellN: sell.length,
    buy: buy.slice(0, 15).map(x => row(x, "b")), sell: sell.slice(0, 15).map(x => row(x, "s")) };
}
// days: [{ d, m }]（舊到新）→ 每日序列與近 1／5／20 日排行
export function summarize(days) {
  const out = days.map((x, i) => {
    const t = topOf(x.m), w = n => (i + 1 >= n ? topOf(merge(days.slice(i + 1 - n, i + 1).map(y => y.m))).conc : null);
    return { d: x.d, vol: t.vol, net: t.net, conc: t.conc, c5: w(5), c20: w(20), buyN: t.buyN, sellN: t.sellN, diff: t.buyN - t.sellN };
  });
  const tops = {}; for (const n of [1, 5, 20]) if (days.length >= n) { const t = topOf(merge(days.slice(-n).map(y => y.m))); tops[n] = { vol: t.vol, net: t.net, conc: t.conc, buy: t.buy, sell: t.sell, from: days.at(-n).d, to: days.at(-1).d }; }
  return { days: out, tops };
}

export default async function handler(req, res) {
  const code = String(req.query?.code || "").trim().toUpperCase();
  if (!/^\d{4,6}[A-Z]?$/.test(code)) return res.status(400).json({ ok: false, error: "代號格式不對" });
  const token = (process.env.FINMIND_TOKEN || "").trim();
  if (!token) return res.status(200).json({ ok: false, needSponsor: true, error: "還沒有設定 FINMIND_TOKEN。券商分點資料要 FinMind 贊助會員的金鑰。" });
  const want = Math.min(45, Math.max(5, +req.query?.days || 40)), days = [];
  const t = new Date(Date.now() + 8 * 3600e3), dates = [];
  for (let k = 0; dates.length < want + 15 && k < 90; k++) { const d = new Date(t.getTime() - k * 864e5); if (d.getUTCDay() % 6) dates.push(ymd(d)); }
  try {
    // 5 天一批往前抓，假日回空的跳過，湊滿 want 個交易日
    for (let i = 0; i < dates.length && days.length < want; i += 5) {
      const batch = await Promise.all(dates.slice(i, i + 5).map(d => fetchDay(code, d, token).then(rows => ({ d, rows }))));
      for (const x of batch) if (x.rows.length && days.length < want) days.push({ d: x.d, m: aggDay(x.rows) });
    }
  } catch (e) {
    if (e instanceof NeedSponsor) return res.status(200).json({ ok: false, needSponsor: true, error: `FinMind 回覆：${e.message}。券商分點要贊助會員才能用。` });
    if (!days.length) return res.status(200).json({ ok: false, error: e.message });
  }
  if (!days.length) return res.status(200).json({ ok: false, error: `找不到 ${code} 的分點資料` });
  days.sort((a, b) => a.d.localeCompare(b.d));
  res.setHeader("Cache-Control", "s-maxage=10800, stale-while-revalidate=86400");
  return res.status(200).json({ ok: true, code, source: "FinMind（證交所買賣日報表）", ...summarize(days) });
}
