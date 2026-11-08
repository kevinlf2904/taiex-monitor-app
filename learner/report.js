/* 投資組合報告（投資研究第 8 批）：把持股明細與投資論點整理成一份可以列印／存成 PDF 的報告；總資產、累積損益、市場分布、風險提醒沿用總覽（KLOverview）。
   純函式，不讀寫存檔、不連網、不輸出 console、不用 AI。瀏覽器裡是 window.KLReport；測試用 node 的 vm 載入。說明：docs/portfolio/REPORT.md
   口徑：
   · 市值＝股數 × 現價（原幣），沒有現價用成本估並標示；台幣市值用目前匯率換算，沒有匯率的美股不換算、不算比重。
   · 比重＝台幣市值 ÷（所有換算得到的持股市值＋有記錄的現金，負現金照扣）；和總覽同一口徑。
   · 未實現損益＝市值 − 持有成本（原幣，不含已實現與股息）。
   · 論點：只帶狀態、下次檢視日（到期標出）、為什麼買的前 80 字；沒寫的列出來。 */
(function (root) {
  "use strict";
  const VERSION = 1, num = v => typeof v === "number" && Number.isFinite(v), r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
  // positions：KLLedger.buildLedger 的未平倉部位；px：代號 → { price }（Map 或物件）；fx：美元兌台幣；cash：台幣計的現金（null＝沒記）；thesis：kline:pf:thesis:v1 的內容
  function build({ positions = [], px = null, fx = null, cash = null, thesis = null, today = null } = {}) {
    const get = c => (px && typeof px.get === "function" ? px.get(c) : px && px[c]) || null, items = (thesis && thesis.items) || {};
    const rows = positions.filter(p => p && p.open !== false && num(p.shares) && p.shares > 0).map(p => {
      const q = get(p.symbol), price = q && num(q.price) && q.price > 0 ? q.price : null, value = price != null ? p.shares * price : num(p.costBasis) ? p.costBasis : null;
      const rate = p.currency === "USD" ? (num(fx) && fx > 0 ? fx : null) : 1, it = items[p.symbol] || null;
      const has = !!(it && (it.reason || (it.watch && it.watch.length) || (it.kill && it.kill.length)));
      const reason = has && it.reason ? (it.reason.length > 80 ? it.reason.slice(0, 80) + "…" : it.reason) : "";
      return { symbol: p.symbol, market: p.market, currency: p.currency, shares: p.shares, avgCost: num(p.avgCost) ? r4(p.avgCost) : null, price, priceEst: price == null,
        value: value == null ? null : r2(value), valueBase: value == null || rate == null ? null : r2(value * rate), unreal: price != null && num(p.costBasis) ? r2(value - p.costBasis) : null,
        unrealPct: price != null && num(p.costBasis) && p.costBasis > 0 ? r4(value / p.costBasis - 1) : null,
        thesis: has ? { status: it.status || "hold", review: it.review || null, due: !!(it.review && today && it.review <= today), reason } : null };
    });
    const stocks = rows.reduce((s, r) => s + (r.valueBase || 0), 0), c = num(cash) ? cash : 0, gross = stocks + c;
    for (const r of rows) r.w = r.valueBase != null && gross > 0 ? r4(r.valueBase / gross) : null;
    rows.sort((a, b) => (b.valueBase ?? -1) - (a.valueBase ?? -1) || a.symbol.localeCompare(b.symbol));
    const written = rows.filter(r => r.thesis), by = { hold: 0, watch: 0, weak: 0, broken: 0 }; for (const r of written) by[r.thesis.status] = (by[r.thesis.status] || 0) + 1;
    return { v: VERSION, asOf: today, rows, stocks: r2(stocks), cash: r2(c), gross: r2(gross), noFx: rows.filter(r => r.valueBase == null && r.value != null).map(r => r.symbol),
      priceEst: rows.filter(r => r.priceEst).map(r => r.symbol),
      thesis: { written: written.length, of: rows.length, due: written.filter(r => r.thesis.due).map(r => r.symbol), byStatus: by, missing: rows.filter(r => !r.thesis).map(r => r.symbol) } };
  }
  root.KLReport = Object.freeze({ VERSION, build });
})(typeof window !== "undefined" ? window : globalThis);
