// 國際原物料、外匯、利率：給 learner/watch.html「大盤」分頁的「國際」使用。
// GET /api/global → { ok, groups: [{ id, name, note?, rows: [{ code, name, price, chg, chgPct, spark }] }] }
// 資料：Yahoo Finance（期貨、匯率可能延遲 10～15 分鐘）。外匯是「1 美元換多少」（美元指數除外）。快取 60 秒。
import { usItem } from "./usmarket.js";

export const GROUPS = [
  ["energy", "能源", [["CL=F", "西德州原油 WTI"], ["BZ=F", "布蘭特原油"], ["NG=F", "天然氣"], ["HO=F", "熱燃油"], ["RB=F", "汽油"]]],
  ["metal", "金屬", [["GC=F", "黃金"], ["SI=F", "白銀"], ["HG=F", "銅"], ["PL=F", "白金"], ["PA=F", "鈀金"], ["ALI=F", "鋁"]]],
  ["agri", "農產", [["ZS=F", "黃豆"], ["ZC=F", "玉米"], ["ZW=F", "小麥"], ["KC=F", "咖啡"], ["SB=F", "糖"], ["CT=F", "棉花"]]],
  ["ship", "航運", [["BDRY", "乾散貨航運 ETF（追蹤 BDI 期貨）"], ["BOAT", "全球航運 ETF"]], "BDI、SCFI 沒有免費即時資料，用追蹤運價的 ETF 參考"],
  ["fx", "外匯（1 美元兌換）", [["DX-Y.NYB", "美元指數"], ["TWD=X", "台幣"], ["JPY=X", "日圓"], ["CNY=X", "人民幣"], ["HKD=X", "港幣"], ["EUR=X", "歐元"], ["GBP=X", "英鎊"], ["KRW=X", "韓元"], ["AUD=X", "澳幣"]]],
  ["rate", "美債殖利率（%）", [["^IRX", "13 週國庫券"], ["^FVX", "5 年期"], ["^TNX", "10 年期"], ["^TYX", "30 年期"]]],
  ["crypto", "加密貨幣", [["BTC-USD", "比特幣"], ["ETH-USD", "以太幣"]]],
];

export default async function handler(req, res) {
  const groups = await Promise.all(GROUPS.map(async ([id, name, list, note]) => {
    const rows = (await Promise.allSettled(list.map(x => usItem(x, true)))).map((r, i) => (r.status === "fulfilled" ? r.value : { code: list[i][0], name: list[i][1], price: null }));
    return { id, name, ...(note ? { note } : {}), rows };
  }));
  if (!groups.some(g => g.rows.some(r => r.price != null))) return res.status(200).json({ ok: false, error: "暫時拿不到國際行情（Yahoo Finance），稍後再試。" });
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({ ok: true, source: "Yahoo Finance（可能延遲 10～15 分鐘）", at: new Date().toISOString(), groups });
}
