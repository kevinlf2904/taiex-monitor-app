/* 投資組合壓力情境（投資研究第 7 批）：台股、美股大盤漲跌、美元兌台幣變動、某個產業重挫時，整體資產（台幣）大約會變多少。
   純函式，不讀寫存檔、不連網、不輸出 console、不用 AI。瀏覽器裡是 window.KLStress；測試用 node 的 vm 載入。說明：docs/portfolio/STRESS.md
   口徑：
   · 每檔持股的價格變動＝Beta × 所屬市場的大盤變動（台股對加權指數、美股對 SPY）＋（屬於重挫產業時）產業變動；最多跌到 −100%。
     沒有 Beta 的（新上市、資料不夠）用 1，並列出來。
   · 美元資產（美股、美元現金）換回台幣時再乘上（1＋美元兌台幣變動）。台幣現金不變。
   · 只是線性粗估：沒有算相關性改變、流動性、融資追繳，不是預測，也不是投資建議。 */
(function (root) {
  "use strict";
  const VERSION = 1, num = v => typeof v === "number" && Number.isFinite(v), r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
  // 預設情境：tw／us＝大盤變動、fx＝美元兌台幣變動（＋＝美元升值、台幣貶值）、ind＝產業變動（要另外選產業）
  const PRESETS = [
    { k: "tw20", label: "台股大跌 20%", tw: -0.2, us: 0, fx: 0 },
    { k: "us20", label: "美股大跌 20%", tw: 0, us: -0.2, fx: 0 },
    { k: "crash", label: "全球股災（台股、美股都跌 25%，美元升 5%）", tw: -0.25, us: -0.25, fx: 0.05 },
    { k: "twdup", label: "台幣升值 10%（美元跌 10%）", tw: 0, us: 0, fx: -0.1 },
    { k: "twddn", label: "台幣貶值 10%（美元漲 10%）", tw: 0, us: 0, fx: 0.1 },
    { k: "ind30", label: "單一產業重挫 30%", tw: 0, us: 0, fx: 0, ind: -0.3 },
  ];
  const okShock = v => num(v) && v >= -1 && v <= 1;
  // positions：[{ symbol, market, currency, value（台幣）, beta, industry }]；cash：{ TWD, USD（都已換成台幣） }
  // s：{ tw, us, fx, ind, industry }（小數，−0.2＝跌 20%）
  function run({ positions = [], cash = {}, s = {} } = {}) {
    const S = { tw: s.tw ?? 0, us: s.us ?? 0, fx: s.fx ?? 0, ind: s.ind ?? 0, industry: s.industry || null };
    if (![S.tw, S.us, S.fx, S.ind].every(okShock)) return { v: VERSION, status: "invalid", reason: "bad_shock", rows: [] };
    const noBeta = [], rows = [];
    for (const p of positions) {
      if (!num(p.value) || p.value <= 0) continue;
      const usd = p.currency === "USD", mkt = p.market === "us" ? S.us : S.tw, b = num(p.beta) ? p.beta : 1;
      if (!num(p.beta) && mkt !== 0) noBeta.push(p.symbol);
      const hitInd = !!S.industry && S.ind !== 0 && p.industry === S.industry;
      const price = Math.max(-1, b * mkt + (hitInd ? S.ind : 0)), after = p.value * (1 + price) * (usd ? 1 + S.fx : 1);
      rows.push({ symbol: p.symbol, market: p.market, value: r2(p.value), beta: num(p.beta) ? r2(p.beta) : null, price: r4(price), fx: usd ? S.fx : 0, industryHit: hitInd, after: r2(after), change: r2(after - p.value) });
    }
    const cT = num(cash.TWD) ? cash.TWD : 0, cU = num(cash.USD) ? cash.USD : 0, cashAfter = cT + cU * (1 + S.fx);
    const before = rows.reduce((a, r) => a + r.value, 0) + cT + cU, after = rows.reduce((a, r) => a + r.after, 0) + cashAfter;
    if (!(before > 0)) return { v: VERSION, status: "invalid", reason: "no_assets", rows: [] };
    rows.sort((a, b) => a.change - b.change || a.symbol.localeCompare(b.symbol));
    return { v: VERSION, status: noBeta.length ? "estimated" : "ok", s: S, before: r2(before), after: r2(after), change: r2(after - before), pct: r4(after / before - 1),
      cashChange: r2(cashAfter - cT - cU), rows, noBeta, worst: rows.filter(r => r.change < 0).slice(0, 3).map(r => r.symbol) };
  }
  root.KLStress = Object.freeze({ VERSION, PRESETS, run });
})(typeof window !== "undefined" ? window : globalThis);
