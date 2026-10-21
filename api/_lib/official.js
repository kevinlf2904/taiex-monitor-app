// 情報局「大盤 → 官方公告」：證交所、櫃買中心開放資料裡的公告類資料，一次整理好回傳（learner/official.js）。
// GET /api/oapi?official=1 → { ok, at, news, abn, fines, ctrl, short3, alt, ipo, esb, dca, broker, block, margin, holiday }
//   news：上市櫃每日重大訊息；abn：投資理財節目異常推介個股；fines：金管會裁罰、違反資訊申報；ctrl：經營權異動；short3：董監持股不足連續 3 個月以上；
//   alt：變更交易、暫停交易、管理股票等；ipo：申請上市櫃、最近上市、首五日無漲跌幅、終止上市；esb：興櫃行情與月營收；dca：定期定額交易戶數排行；
//   broker：上櫃熱門股券商進出；block：鉅額交易；margin：融資融券增減最多；holiday：證交所開（休）市日期。欄位都在下面各函式註解。
// 資料集路徑、欄位名稱用 scripts/probe-live.mjs official 對過真實資料；同一份資料在這台機器上 15 分鐘內重複用（oapi.js 的 rowsOf）。
import { num, rocDate } from "./_tw.js";

const str = v => String(v ?? "").replace(/\s+/g, " ").trim(), cut = (v, n) => { const s = str(v); return s.length > n ? s.slice(0, n) + "…" : s; };
const get = (r, ...re) => { for (const x of re) { const k = Object.keys(r || {}).find(k => x.test(k.trim())); if (k != null && str(r[k]) !== "") return r[k]; } return ""; };
const codeOf = r => str(get(r, /^公司代號$/, /^股票代號$/, /^SecuritiesCompanyCode$/i, /^Code$/i));
const nameOf = r => str(get(r, /^公司名稱$/, /^股票名稱$/, /^CompanyName$/i, /^Name$/i));
const ok = c => /^\d{4,6}[A-Z]?$/.test(c);

// 每次需要的資料集：[鍵, 來源, 路徑]
export const OFFICIAL_SETS = [
  ["newsL", "twse", "/opendata/t187ap04_L"], ["newsO", "tpex", "/mopsfin_t187ap04_O"], ["abn", "twse", "/Announcement/BFZFZU_T"],
  ["fineL", "twse", "/opendata/t187ap22_L"], ["fineO", "tpex", "/mopsfin_t187ap22_O"], ["infoL", "twse", "/opendata/t187ap23_L"], ["infoO", "tpex", "/mopsfin_t187ap23_O"],
  ["ctrlL", "twse", "/opendata/t187ap24_L"], ["ctrlO", "tpex", "/mopsfin_t187ap24_O"], ["s3L", "twse", "/opendata/t187ap10_L"], ["s3O", "tpex", "/mopsfin_t187ap10_O"],
  ["altL", "twse", "/exchangeReport/TWT85U"], ["haltL", "twse", "/exchangeReport/TWTAWU"], ["cmodeO", "tpex", "/tpex_cmode"],
  ["applyL", "twse", "/company/applylistingLocal"], ["newL", "twse", "/company/newlisting"], ["delistL", "twse", "/company/suspendListingCsvAndHtml"], ["first5L", "twse", "/exchangeReport/TWT88U"],
  ["applyO", "tpex", "/tpex_esb_applicant_companies"], ["first5O", "tpex", "/tpex_ipo_no_limit"],
  ["esbQ", "tpex", "/tpex_esb_latest_statistics"], ["esbRev", "tpex", "/t187ap05_R"], ["dca", "twse", "/ETFReport/ETFRank"], ["broker", "tpex", "/tpex_active_broker_volume"],
  ["blockO", "tpex", "/tpex_daily_qutoes_block"], ["marginL", "twse", "/exchangeReport/MI_MARGN"], ["marginO", "tpex", "/tpex_mainboard_margin_balance"], ["holiday", "twse", "/holidaySchedule/holidaySchedule"],
];

const hm = v => { const s = str(v).padStart(6, "0"); return /^\d{6}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : ""; };
// 重大訊息：[發言日期, 時間, 代號, 名稱, 市場, 主旨, 符合條款, 說明（截短）]，新到舊
export const newsRows = (L, O) => [[L, "上市"], [O, "上櫃"]].flatMap(([R, m]) => (R || []).map(r => [rocDate(get(r, /^發言日期$/)), hm(get(r, /^發言時間$/)), codeOf(r), nameOf(r), m, cut(get(r, /^主旨/), 120), str(get(r, /^符合條款$/)), cut(get(r, /^說明$/), 400)]))
  .filter(x => x[0] && x[2]).sort((a, b) => (b[0] + b[1]).localeCompare(a[0] + a[1]));
// 裁罰：[發函日期, 代號, 名稱, 市場, 類別, 事由, 法規, 處分]
export const fineRows = (fL, fO, iL, iO) => [
  ...[[fL, "上市"], [fO, "上櫃"]].flatMap(([R, m]) => (R || []).map(r => [rocDate(get(r, /^發函日期$/)), codeOf(r), nameOf(r), m, "金管會裁罰", cut(get(r, /^違規事由$/), 200), cut(get(r, /^違反法規$/), 120), cut(get(r, /^裁處情形$/), 120)])),
  ...[[iL, "上市"], [iO, "上櫃"]].flatMap(([R, m]) => (R || []).map(r => { const amt = num(get(r, /^裁罰金額/)); return [rocDate(get(r, /^發函日期$/)), codeOf(r), nameOf(r), m, "違反資訊申報", cut(get(r, /^違規事由$/), 200), cut(get(r, /違反資訊申報作業辦法條款|違反重大訊息/), 120), amt != null ? `罰 ${amt} 萬元` : ""]; })),
].filter(x => x[0] && x[1]).sort((a, b) => b[0].localeCompare(a[0]));
// 經營權異動：[日期, 代號, 名稱, 市場, 說明]
export const ctrlRows = (L, O) => [[L, "上市"], [O, "上櫃"]].flatMap(([R, m]) => (R || []).map(r => [rocDate(get(r, /^經營權異動日期$/)), codeOf(r), nameOf(r), m, cut(get(r, /^經營權異動說明$/), 200)]))
  .filter(x => x[0] && x[1]).sort((a, b) => b[0].localeCompare(a[0]));
// 董監持股不足連續 N 個月：欄位是「連續不足達 N 個月」、值是代號（可能多個）→ [代號, 月數, 市場]
export function short3Rows(L, O) {
  const out = new Map();
  for (const [R, m] of [[L, "上市"], [O, "上櫃"]]) for (const r of R || []) for (const [k, v] of Object.entries(r)) {
    const mm = k.match(/連續不足(?:達)?(\d+)個月|逾(\d+)年/); if (!mm) continue; const n = mm[1] ? +mm[1] : +mm[2] * 12 + 1;
    for (const c of String(v ?? "").match(/\d{4,6}[A-Z]?/g) || []) if (!out.has(c) || out.get(c)[1] < n) out.set(c, [c, n, m]);
  }
  return [...out.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
// 變更交易、暫停交易、管理股票…：[代號, 名稱, 市場, 標籤]
export function altRows(alt, halt, cmode) {
  const out = [];
  for (const r of alt || []) if (ok(codeOf(r))) out.push([codeOf(r), nameOf(r), "上市", str(r.PeriodicCallAuctionTrading) ? "分盤集合競價" : "變更交易"]);
  for (const r of halt || []) if (ok(codeOf(r))) out.push([codeOf(r), nameOf(r), "上市", `暫停交易 ${rocDate(r.TradingHaltDate) || ""}${r.TradingResumptionDate ? `～${rocDate(r.TradingResumptionDate) || ""}` : ""}`]);
  const F = [["AlteredTrading", "變更交易"], ["PeriodicTrading", "分盤交易"], ["ManagedStock", "管理股票"], ["MatchingFrequency", "撮合頻率調整"], ["SuspensionOfTrading", "停止交易"], ["FinancialAnnouncements", "財報異常"]];
  for (const r of cmode || []) { const c = codeOf(r); if (!ok(c)) continue; const t = F.filter(([k]) => /[YＹ]/i.test(str(get(r, new RegExp(`^${k}$`))))).map(x => x[1]); if (t.length) out.push([c, nameOf(r), "上櫃", t.join("、")]); }
  return out;
}
// 新股：申請上市（證交所這份欄位名稱錯位一格，用位置對）、申請上櫃、最近上市、首五日無漲跌幅、終止上市；只留最近兩年
export function ipoPack({ applyL = [], newL = [], delistL = [], first5L = [], applyO = [], first5O = [] }, now = Date.now()) {
  const since = new Date(now - 730 * 864e5).toISOString().slice(0, 10), recent = d => d && d >= since;
  const apply = [
    ...applyL.map(r => [str(r.Company), str(r.ApplicationDate), "上市", rocDate(r.Chairman), str(r.Underwriter), num(r.UnderwritingPrice), rocDate(r.ApprovedListingDate) ? "已上市" : "審查中"]),
    ...applyO.map(r => [codeOf(r), nameOf(r), "上櫃", rocDate(r.Date), str(r.LeadUnderwriter), num(r.OfferingPrice), rocDate(r.ListingDate) ? "已上櫃" : str(r.Note) || "審查中"]),
  ].filter(x => ok(x[0]) && recent(x[3])).sort((a, b) => b[3].localeCompare(a[3]));
  const listed = newL.map(r => [codeOf(r), str(r.Company), "上市", rocDate(r.ListingDate) || rocDate(r.ApprovedListingDate), num(r.UnderwritingPrice), str(r.Underwriter), str(r.Note)])
    .filter(x => ok(x[0]) && recent(x[3])).sort((a, b) => b[3].localeCompare(a[3]));
  const f5 = new Map();
  for (const r of first5L) { const c = str(r.SecurCode); if (ok(c) && !f5.has(c)) f5.set(c, [c, str(r.SecurName), "上市", rocDate(r["1stTradingDate"]), rocDate(r["5thTradingDate"]), num(r.PriceUnderwritten)]); }
  for (const r of first5O) { const c = codeOf(r); if (ok(c) && !f5.has(c)) f5.set(c, [c, nameOf(r), "上櫃", rocDate(r.StartDateForStabilizationOperation), rocDate(r.EndDateForStabilizationOperation), num(r.UnderwritingPrice)]); }
  const delist = delistL.map(r => [str(r.Code), str(r.Company), rocDate(r.DelistingDate)]).filter(x => recent(x[2])).sort((a, b) => b[2].localeCompare(a[2]));
  return { apply: apply.slice(0, 150), listed: listed.slice(0, 100), first5: [...f5.values()], delist };
}
// 興櫃：行情 [代號, 名稱, 均價, 前日均價, 漲跌%, 成交股數]、月營收 [代號, 名稱, 產業, 營收(億), 年增%, 月增%]
export function esbPack(Q = [], R = []) {
  const quotes = Q.map(r => { const a = num(r.Average), p = num(r.PreviousAveragePrice); return [codeOf(r), nameOf(r), a, p, a && p ? Math.round((a / p - 1) * 1e4) / 100 : null, num(r.TransactionVolume)]; }).filter(x => ok(x[0]) && x[2] != null);
  const rev = R.map(r => [codeOf(r), nameOf(r), str(get(r, /^產業別$/)), Math.round((num(get(r, /當月營收$/)) || 0) / 1e3) / 100, num(get(r, /去年同月增減/)), num(get(r, /上月比較增減/))]).filter(x => ok(x[0]));
  const ym = str(get(R[0], /^資料年月$/)), date = rocDate(Q[0]?.Date);
  return { date, ym: ym ? `${+ym.slice(0, ym.length - 2) + 1911}-${ym.slice(-2)}` : "", quotes, rev: rev.map(x => [...x.slice(0, 4), x[4] != null ? Math.round(x[4] * 10) / 10 : null, x[5] != null ? Math.round(x[5] * 10) / 10 : null]) };
}
// 定期定額交易戶數排行：[名次, 股票代號, 股票名稱, 股票戶數, ETF 代號, ETF 名稱, ETF 戶數]
export const dcaRows = R => (R || []).map(r => [num(r.No), str(r.STOCKsSecurityCode), str(r.STOCKsName), num(r.STOCKsNumberofTradingAccounts), str(r.ETFsSecurityCode), str(r.ETFsName), num(r.ETFsNumberofTradingAccounts)]).filter(x => x[0]);
// 上櫃熱門股券商進出：[股票名次, 代號, 名稱, [[券商, 買進股數, 賣出股數]...]]
export function brokerRows(R) {
  const M = new Map();
  for (const r of R || []) { const m = str(r.SecuritiesCompanyCodeAndCompanyName).match(/^(.*)\((\w+)\)$/); if (!m) continue; const g = M.get(m[2]) || M.set(m[2], [num(r.StockRanking), m[2], m[1], []]).get(m[2]); g[3].push([str(r.SecuritiesFirmsCode), num(r.TotalPurchaseShares) || 0, num(r.TotalSellShares) || 0]); }
  return [...M.values()].sort((a, b) => a[0] - b[0]);
}
// 鉅額交易（上櫃逐筆）：[日期, 代號, 名稱, 類型, 價格, 股數, 金額(萬)]
export const blockRows = R => (R || []).map(r => [rocDate(r.Date), str(r.Code), str(r.Name), str(r.TransactionType), num(r.TradePrice), num(r.NumberOfSharesTraded), Math.round((num(r.TradeValue) || 0) / 1e4)]).filter(x => x[1]).sort((a, b) => b[6] - a[6]);
// 融資融券：每檔 [代號, 名稱, 市場, 融資餘額(張), 融資增減, 融券餘額, 融券增減]，回傳增加、減少最多各 40 檔與市場合計
export function marginPack(L = [], O = []) {
  const rows = [
    ...L.map(r => { const b = num(r["融資今日餘額"]), pb = num(r["融資前日餘額"]), s = num(r["融券今日餘額"]), ps = num(r["融券前日餘額"]); return [codeOf(r), nameOf(r), "上市", b, b != null && pb != null ? b - pb : null, s, s != null && ps != null ? s - ps : null]; }),
    ...O.map(r => { const b = num(r.MarginPurchaseBalance), pb = num(r.MarginPurchaseBalancePreviousDay), s = num(r.ShortSaleBalance), ps = num(r.ShortSaleBalancePreviousDay); return [codeOf(r), nameOf(r), "上櫃", b, b != null && pb != null ? b - pb : null, s, s != null && ps != null ? s - ps : null]; }),
  ].filter(x => ok(x[0]) && x[3] != null);
  const sum = (m, i) => rows.filter(x => x[2] === m).reduce((a, x) => a + (x[i] || 0), 0);
  return { date: rocDate(O[0]?.Date) || "", up: [...rows].sort((a, b) => (b[4] || 0) - (a[4] || 0)).slice(0, 40), dn: [...rows].sort((a, b) => (a[4] || 0) - (b[4] || 0)).slice(0, 40), sUp: [...rows].sort((a, b) => (b[6] || 0) - (a[6] || 0)).slice(0, 40),
    tot: ["上市", "上櫃"].map(m => [m, sum(m, 3), sum(m, 4), sum(m, 5), sum(m, 6)]) };
}
export const holidayRows = R => (R || []).map(r => [rocDate(r.Date), str(r.Name), str(r.Description)]).filter(x => x[0]);

// 全部整理成一包（raw 是 { 鍵: 列陣列 }）
export function officialPack(raw, now = Date.now()) {
  const R = k => raw[k] || [];
  return {
    news: newsRows(R("newsL"), R("newsO")),
    abn: R("abn").filter(r => ok(codeOf(r))).map(r => [rocDate(r.Date), codeOf(r), nameOf(r)]),
    abnDate: rocDate(R("abn")[0]?.Date) || "",
    fines: fineRows(R("fineL"), R("fineO"), R("infoL"), R("infoO")),
    ctrl: ctrlRows(R("ctrlL"), R("ctrlO")),
    short3: short3Rows(R("s3L"), R("s3O")),
    alt: altRows(R("altL"), R("haltL"), R("cmodeO")),
    ipo: ipoPack({ applyL: R("applyL"), newL: R("newL"), delistL: R("delistL"), first5L: R("first5L"), applyO: R("applyO"), first5O: R("first5O") }, now),
    esb: esbPack(R("esbQ"), R("esbRev")),
    dca: dcaRows(R("dca")),
    broker: brokerRows(R("broker")),
    block: blockRows(R("blockO")),
    margin: marginPack(R("marginL"), R("marginO")),
    holiday: holidayRows(R("holiday")),
  };
}
