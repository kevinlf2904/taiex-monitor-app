/* 目標配置與再平衡試算（投資研究第 2 批）：每檔持股（和現金）設目標比重，算出目前偏離多少、要買賣多少股才回到目標、大約的手續費與稅、調整後的現金。
   純函式，不讀寫存檔、不連網、不輸出 console、不用 AI。瀏覽器裡是 window.KLRebal；測試用 node 的 vm 載入。說明：docs/portfolio/REBALANCE.md
   口徑：
   · 全部換成台幣比（美股用目前匯率；沒有匯率的美股不能算，列出來）。總資產＝持股市值＋有記錄的現金（負現金照扣）。
   · 有設目標的持股才調整；沒設目標的維持原樣（不買不賣）。現金是調整後剩下的（買花掉、賣拿回），不另外下單。
   · 調整後比重：持股照目前報價算市值、費稅從現金扣；分母是調整後總資產（原總資產 − 費稅），所有持股與現金加起來 100%。
   · 偏離在容許範圍內（目標 ± band 個百分點）就不動。股數取整數（台股可以買零股；美股不假設券商支援碎股），賣出不超過持有股數。
   · 只是試算：不含市場衝擊、價格會變、不是投資建議。 */
(function (root) {
  "use strict";
  const VERSION = 1, STORE_KEY = "kline:pf:targets:v1", EPS = 1e-9, CASH = "CASH";
  const isNum = v => typeof v === "number" && Number.isFinite(v), r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
  const up = c => String(c || "").trim().toUpperCase(), isCode = c => c === CASH || /^[0-9A-Z][0-9A-Z.\-]{0,11}$/.test(c);

  // 存檔：{ v: 1, targets: { 代號或 CASH: 百分比(0～100) }, band: 百分點(0～50), at }
  function validateStore(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, code: "invalid_root", errors: [] };
    if (s.v !== VERSION) return { ok: false, code: "unsupported_version", errors: [] };
    if (!s.targets || typeof s.targets !== "object" || Array.isArray(s.targets)) return { ok: false, code: "invalid_targets", errors: [] };
    const errors = [];
    for (const [k, v] of Object.entries(s.targets)) { if (!isCode(up(k))) errors.push({ code: k, error: "invalid_code" }); else if (!(isNum(v) && v >= 0 && v <= 100)) errors.push({ code: k, error: "invalid_weight" }); }
    if (Object.keys(s.targets).length > 300) errors.push({ code: "*", error: "too_many" });
    if (s.band != null && !(isNum(s.band) && s.band >= 0 && s.band <= 50)) errors.push({ code: "band", error: "invalid_band" });
    return { ok: !errors.length, code: errors.length ? "has_errors" : "ok", errors };
  }

  // positions：[{ symbol, market, currency, shares, price(原幣), assetType }]；fx：台幣／美元；cash：台幣（可為負，null＝沒有記錄現金）
  // targets：{ 代號: 百分比, CASH: 百分比 }；band：容許偏離（百分點）；costs(t)：{ fee, tax }（t＝{ type, market, shares, price, assetType }），用帳本的費用規則
  function plan({ positions = [], fx = null, cash = null, targets = {}, band = 5, costs = null } = {}) {
    const rate = c => (c === "USD" ? (isNum(fx) && fx > 0 ? fx : null) : 1), issues = [], T = {};
    for (const [k, v] of Object.entries(targets || {})) if (isNum(v) && v >= 0) T[up(k)] = v;
    const rows = [], noPrice = [], noFx = [];
    for (const p of positions) {
      const c = up(p.symbol), k = rate(p.currency);
      if (!(isNum(p.price) && p.price > 0)) { noPrice.push(c); continue; }
      if (k == null) { noFx.push(c); continue; }
      rows.push({ symbol: c, market: p.market, currency: p.currency, assetType: p.assetType || "stock", shares: p.shares, price: p.price, rate: k, value: p.shares * p.price * k, target: T[c] ?? null });
    }
    if (noPrice.length) issues.push({ k: "no_price", codes: noPrice });
    if (noFx.length) issues.push({ k: "no_fx", codes: noFx });
    const cashKnown = isNum(cash), cashV = cashKnown ? cash : 0, stocks = rows.reduce((s, r) => s + r.value, 0), total = stocks + cashV;
    if (!(total > EPS)) return { v: VERSION, status: "invalid", reason: "no_assets", cashKnown, rows: [], issues };
    // 目標加總：有設目標的＋沒設目標的持股目前比重＋現金目標（只在現金已知時套用）
    const managed = rows.filter(r => r.target != null), unmanagedW = rows.filter(r => r.target == null).reduce((s, r) => s + r.value / total * 100, 0);
    const rawCashT = T[CASH] ?? null, cashT = cashKnown ? rawCashT : null, setSum = managed.reduce((s, r) => s + r.target, 0), sum = setSum + unmanagedW + (cashT ?? 0);
    if (!cashKnown && rawCashT != null) issues.push({ k: "cash_target_ignored", target: rawCashT });
    if (cashT != null && Math.abs(sum - 100) > 0.5) issues.push({ k: "sum", sum: r2(sum) });
    if (cashT == null && setSum + unmanagedW > 100 + 0.5) issues.push({ k: "over", sum: r2(setSum + unmanagedW) });
    const C = typeof costs === "function" ? costs : () => ({ fee: 0, tax: 0 });
    let buy = 0, sell = 0, fees = 0, turnover = 0;
    const out = rows.map(r => {
      const w = r.value / total * 100, base = { symbol: r.symbol, currency: r.currency, price: r.price, shares: r.shares, value: r2(r.value), weight: r4(w / 100), target: r.target == null ? null : r4(r.target / 100) };
      if (r.target == null) return { ...base, valueAfter: r.value, action: "keep", reason: "no_target" };
      const diffW = r.target - w, diffV = r.target / 100 * total - r.value;
      if (Math.abs(diffW) <= band + EPS) return { ...base, valueAfter: r.value, diff: r4(diffW / 100), diffValue: r2(diffV), action: "hold", reason: "within_band" };
      const unit = r.price * r.rate; let n = Math.trunc(diffV / unit);
      if (n < 0) n = Math.max(n, -Math.floor(r.shares + EPS)); // 賣出不超過持有
      if (n === 0) return { ...base, valueAfter: r.value, diff: r4(diffW / 100), diffValue: r2(diffV), action: "hold", reason: "less_than_one_share" };
      const type = n > 0 ? "buy" : "sell", sh = Math.abs(n), gross = sh * r.price, c = C({ type, market: r.market, shares: sh, price: r.price, assetType: r.assetType }) || { fee: 0, tax: 0 };
      const cost = ((c.fee || 0) + (c.tax || 0)) * r.rate, grossB = gross * r.rate;
      if (type === "buy") buy += grossB + cost; else sell += grossB - cost; fees += cost; turnover += grossB;
      return { ...base, valueAfter: r.value + n * unit, diff: r4(diffW / 100), diffValue: r2(diffV), action: type, tradeShares: sh, lots: r.market === "tw" ? Math.floor(sh / 1000) : null, odd: r.market === "tw" ? sh % 1000 : null,
        gross: r2(gross), grossBase: r2(grossB), fee: r2(c.fee || 0), tax: r2(c.tax || 0), costBase: r2(cost) };
    }).sort((a, b) => Math.abs(b.diffValue || 0) - Math.abs(a.diffValue || 0));
    // 調整後：持股照現價算市值，費稅從現金變動扣；總資產／試算基準＝調整後持股市值＋調整後現金（或淨現金變動＝原基準 − 費稅），每檔都用它當分母
    const netCashDelta = sell - buy, cashAfter = cashKnown ? cashV + netCashDelta : null, totalAfter = out.reduce((s, r) => s + r.valueAfter, 0) + (cashKnown ? cashAfter : netCashDelta);
    for (const r of out) { r.weightAfter = totalAfter > EPS ? r4(r.valueAfter / totalAfter) : null; r.valueAfter = r2(r.valueAfter); }
    if (cashKnown && cashAfter < -0.5) issues.push({ k: "cash_short", need: r2(-cashAfter) });
    if (!cashKnown) issues.push({ k: "no_cash" });
    return { v: VERSION, status: issues.some(x => ["no_price", "no_fx", "sum", "over", "cash_short", "no_cash", "cash_target_ignored"].includes(x.k)) ? "estimated" : "ok",
      cashKnown, total: r2(total), stocks: r2(stocks), cash: cashKnown ? r2(cashV) : null,
      band, rows: out, buy: r2(buy), sell: r2(sell), fees: r2(fees), turnover: r2(turnover), turnoverPct: r4(turnover / total),
      cashAfter: cashKnown ? r2(cashAfter) : null, netCashDelta: r2(netCashDelta), cashTarget: cashT == null ? null : r4(cashT / 100),
      totalAfter: r2(totalAfter), cashWeightAfter: cashKnown && totalAfter > EPS ? r4(cashAfter / totalAfter) : null, targetSum: r2(sum), issues };
  }
  const ISSUE_LABEL = { no_price: "有持股沒有報價，沒算進來", no_fx: "沒有匯率，美股沒算進來", sum: "目標加總不是 100%", over: "目標加總超過 100%（超出可調整水位）", cash_short: "現金不夠：照這樣調整要先賣其他持股或入金", no_cash: "現金未知（未納入計算，試算基準僅含已納入持股合計，非完整總資產）", cash_target_ignored: "現金未知，已存的現金目標本次不套用" };
  const ACTION_LABEL = { buy: "買進", sell: "賣出", hold: "不用動", keep: "沒設目標" };
  root.KLRebal = Object.freeze({ VERSION, STORE_KEY, CASH, validateStore, plan, ISSUE_LABEL, ACTION_LABEL });
})(typeof window !== "undefined" ? window : globalThis);
