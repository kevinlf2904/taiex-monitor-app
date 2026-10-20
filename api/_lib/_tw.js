// 共用：證交所、櫃買中心 OpenAPI 的公司基本資料（產業別、發行股數）。檔名以底線開頭，Vercel 不會把它當成 API 路由。

export const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
export const num = v => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[,\s+]/g, "")); return Number.isFinite(n) ? n : null; };
export const rocDate = v => { const s = String(v ?? "").replace(/\D/g, ""); return s.length === 7 ? `${+s.slice(0, 3) + 1911}-${s.slice(3, 5)}-${s.slice(5)}` : s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null; };
export async function getJSON(url, headersOrMs = 9000, ms = 9000) {
  const isMs = typeof headersOrMs === "number", h = isMs ? UA : { ...UA, ...headersOrMs }, t = isMs ? headersOrMs : ms;
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(t) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// 證交所產業別代碼（櫃買中心沿用同一套）
export const INDUSTRY = {
  "01": "水泥", "02": "食品", "03": "塑膠", "04": "紡織纖維", "05": "電機機械", "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙", "10": "鋼鐵", "11": "橡膠",
  "12": "汽車", "14": "建材營造", "15": "航運", "16": "觀光餐旅", "17": "金融保險", "18": "貿易百貨", "19": "綜合", "20": "其他", "21": "化學", "22": "生技醫療",
  "23": "油電燃氣", "24": "半導體", "25": "電腦及週邊", "26": "光電", "27": "通信網路", "28": "電子零組件", "29": "電子通路", "30": "資訊服務", "31": "其他電子",
  "32": "文化創意", "33": "農業科技", "34": "電子商務", "35": "綠能環保", "36": "數位雲端", "37": "運動休閒", "38": "居家生活", "80": "管理股票",
};
const findKey = (r, re) => Object.keys(r).find(k => re.test(k));
// t187ap03_L（上市）、mopsfin_t187ap03_O（上櫃）→ Map(code → { ind, shares })
export function parseCompanies(rows) {
  const out = new Map(); if (!Array.isArray(rows) || !rows.length) return out;
  const r0 = rows[0], kC = findKey(r0, /^公司代號$|SecuritiesCompanyCode|CompanyCode/), kI = findKey(r0, /產業別|IndustryCode|Industry/), kS = findKey(r0, /已發行普通股|IssueShares|IssuedShares|ShareCapital.*Shares/);
  for (const r of rows) {
    const c = String(r[kC] ?? "").trim(); if (!/^\d{4,6}[A-Z]?$/.test(c)) continue;
    const code = String(r[kI] ?? "").trim().padStart(2, "0");
    out.set(c, { ind: INDUSTRY[code] || (r[kI] && !/^\d+$/.test(String(r[kI]).trim()) ? String(r[kI]).trim() : null), shares: kS ? num(r[kS]) : null });
  }
  return out;
}
export async function companies() {
  const [a, b] = await Promise.allSettled([
    getJSON("https://openapi.twse.com.tw/v1/opendata/t187ap03_L").then(parseCompanies),
    getJSON("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O").then(parseCompanies),
  ]);
  return new Map([...(a.value || []), ...(b.value || [])]);
}
