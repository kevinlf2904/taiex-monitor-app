// 美股大盤：給 learner/watch.html「大盤」分頁的「美股」使用。
// GET /api/usmarket → { ok, session, date, indices, macro, sectors, megas }
//   indices  主要指數（道瓊、那斯達克、S&P 500、費半、NASDAQ-100、羅素 2000、VIX），含當日 5 分走勢（spark）
//   macro    指數期貨、10 年期公債殖利率、美元指數、黃金、原油、比特幣
//   sectors  SPDR 類股 ETF（11 大類＋半導體 SMH），依漲跌幅排序
//   megas    權值股（蘋果、微軟、輝達…）
// 資料：Yahoo Finance（可能延遲 15 分鐘），時間是美東時間。盤中快取 30 秒、收盤後 5 分鐘。

import { yahooBars, quoteFromMeta, lastUsTradingDate } from "./_yahoo.js";

export const US_IDX = [["^DJI", "道瓊工業"], ["^IXIC", "那斯達克"], ["^GSPC", "S&P 500"], ["^SOX", "費城半導體"], ["^NDX", "NASDAQ-100"], ["^RUT", "羅素 2000"], ["^VIX", "VIX 恐慌指數"]];
export const US_MACRO = [["ES=F", "S&P 期貨"], ["NQ=F", "那斯達克期貨"], ["YM=F", "道瓊期貨"], ["^TNX", "10 年期公債殖利率"], ["DX-Y.NYB", "美元指數"], ["GC=F", "黃金"], ["CL=F", "原油 WTI"], ["BTC-USD", "比特幣"]];
export const US_SECTORS = [["XLK", "科技"], ["SMH", "半導體"], ["XLC", "通訊服務"], ["XLY", "非必需消費"], ["XLF", "金融"], ["XLV", "醫療保健"], ["XLI", "工業"], ["XLE", "能源"], ["XLB", "原物料"], ["XLP", "必需消費"], ["XLU", "公用事業"], ["XLRE", "房地產"]];
export const US_MEGAS = [["AAPL", "蘋果"], ["MSFT", "微軟"], ["NVDA", "輝達"], ["GOOGL", "Alphabet"], ["AMZN", "亞馬遜"], ["META", "Meta"], ["TSLA", "特斯拉"], ["AVGO", "博通"], ["TSM", "台積電 ADR"], ["BRK-B", "波克夏"]];

// 一檔：當日 5 分 K（拿走勢線），報價用 meta
export async function usItem([sym, name], spark = true) {
  const p = await yahooBars(sym, 5, { isIdx: sym.startsWith("^") });
  if (!p?.meta) throw new Error("沒有資料");
  const q = quoteFromMeta(sym, p.meta);
  return {
    code: sym,
    name,
    price: q.price,
    chg: q.chg,
    chgPct: q.chgPct,
    prev: q.prev,
    high: q.high,
    low: q.low,
    date: q.date,
    time: q.time,
    dataDate: q.dataDate || q.date || null,
    sourceTime: q.sourceTime || q.time || null,
    sourceTimeTW: q.sourceTimeTW || null,
    sourceDateTW: q.sourceDateTW || null,
    epochMs: q.epochMs || null,
    tz: q.tz || null,
    session: q.session?.state || "closed",
    subState: q.session?.subState || q.session?.state || "closed",
    holiday: q.holiday || q.session?.holiday || null,
    source: q.source || "Yahoo Finance",
    updateMode: q.updateMode || "scheduled",
    dataStatus: q.dataStatus || "confirmed",
    isStale: !!q.isStale,
    expectedDate: q.expectedDate || null,
    spark: spark ? p.bars.map(b => b.c).filter(v => v != null) : undefined,
  };
}
const settle = async (list, spark) => (await Promise.allSettled(list.map(x => usItem(x, spark)))).filter(r => r.status === "fulfilled").map(r => r.value);

export default async function handler(req, res) {
  const fetchedAt = new Date().toISOString();
  const cal = lastUsTradingDate(Date.now());
  const [indices, macro, sectors, megas] = await Promise.all([settle(US_IDX, true), settle(US_MACRO, true), settle(US_SECTORS, false), settle(US_MEGAS, false)]);
  if (!indices.length && !sectors.length) return res.status(200).json({ ok: false, error: "暫時拿不到美股資料（Yahoo Finance），稍後再試。" });
  const coreIdx = indices.filter(x => x.code !== "^VIX" && !x.isStale && x.date);
  const ref = coreIdx.find(x => x.code === "^GSPC") || coreIdx[0] || indices.find(x => x.code === "^GSPC") || indices[0] || sectors[0] || {};
  const session = ref.session || "closed";
  const subState = ref.subState || (cal.holiday ? "holiday" : session);
  const date = ref.date || cal.expectedDate || null;
  const hasStale = indices.some(x => x.isStale) || indices.length < US_IDX.length;
  const dataStatus = cal.holiday && session === "closed" ? "holiday" : hasStale ? (coreIdx.length ? "partial" : "stale") : ref.dataStatus || (session === "open" ? "live" : "confirmed");
  const updateMode = session === "open" || session === "pre" || session === "post" ? "scheduled" : "after_close";
  sectors.sort((a, b) => (b.chgPct ?? -1e9) - (a.chgPct ?? -1e9));
  res.setHeader("Cache-Control", session === "open" ? "s-maxage=30, stale-while-revalidate=60" : "s-maxage=300, stale-while-revalidate=900");
  return res.status(200).json({
    ok: true,
    source: "Yahoo Finance（可能延遲 15 分鐘，美東時間）",
    session,
    subState,
    holiday: cal.holiday || null,
    tz: cal.tzAbbr,
    expectedDate: cal.expectedDate,
    date,
    dataDate: date,
    sourceTime: ref.sourceTime || ref.time || null,
    sourceTimeTW: ref.sourceTimeTW || null,
    fetchedAt,
    updateMode,
    dataStatus,
    indices,
    macro,
    sectors,
    megas,
  });
}
