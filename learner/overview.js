/* 投資組合總覽（第 8 階段）：總資產、今日損益、累積損益、現金比例、市場分布、主要持倉、風險狀態、資料更新時間。
   純函式，不讀寫存檔、不連網、不輸出 console。瀏覽器裡是 window.KLOverview；測試用 node 的 vm 載入。
   口徑（docs/portfolio/OVERVIEW.md）：
   · 全部換成台幣（美元用最新匯率）。沒有匯率時，總額只算台股並標示「美股沒有換算」，不把美元當台幣相加。
   · 今日損益：昨收就持有的股數 ×（現價 − 昨收）＋今天買進的 ×（現價 − 買進價）＋今天賣出的 ×（賣出價 − 昨收）；
     沒有報價或報價不是今天的不算（標示），不把舊報價的漲跌當成今天。
   · 累積損益：已實現＋未實現＋股息（稅後）− 另計費用；美元部分用「目前」匯率換算（標示：不是逐筆歷史匯率，精確的匯率拆解看績效頁）。
   · 風險狀態：單一持股超過 30%、前五大超過 80%、融資維持率接近或低於追繳線、有價格缺漏或過期。 */
(function (root) {
  "use strict";
  const VERSION = 1, EPS = 1e-9, isNum = v => typeof v === "number" && Number.isFinite(v), r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
  // L：KLLedger.buildLedger 的結果；quotes：代號 → { price, prev, chg, date, time }；opts：fx（{ rate, date }）、today（YYYY-MM-DD，台北）、margin（KLMargin.analyze 的結果陣列）、txs（原始交易，算今天的買賣）
  function summarize(L, quotes, opts = {}) {
    const Q = c => (quotes && typeof quotes.get === "function" ? quotes.get(c) : quotes?.[c]) || null, today = opts.today || null;
    const fx = opts.fx && isNum(opts.fx.rate) && opts.fx.rate > 0 ? opts.fx : null, conv = cur => (cur === "USD" ? (fx ? fx.rate : null) : 1);
    const open = (L?.positions || []).filter(p => p.open), issues = [];
    const txToday = (opts.txs || []).filter(t => t && t.date === today);
    const rows = [], noPrice = [], stale = [];
    let mv = 0, mvUsdNoFx = 0, cost = 0, day = 0, dayBase = 0, dayKnown = 0, soldOut = 0;
    for (const p of open) {
      const q = Q(p.symbol), k = conv(p.currency), px = q && isNum(q.price) && q.price > 0 ? q.price : null;
      if (px == null) noPrice.push(p.symbol);
      const value = px != null ? p.shares * px : p.costBasis, est = px == null;
      if (k == null) { mvUsdNoFx += value; rows.push({ symbol: p.symbol, currency: p.currency, shares: p.shares, price: px, value, valueBase: null, estimated: est }); continue; }
      mv += value * k; cost += p.costBasis * k;
      // 今日損益：只用今天的報價
      const qToday = q && px != null && (!today || !q.date || String(q.date).slice(0, 10) === today), prev = q && isNum(q.prev) && q.prev > 0 ? q.prev : (q && isNum(q.chg) && px != null ? px - q.chg : null);
      let d = null;
      if (qToday && prev != null) {
        const tt = txToday.filter(t => String(t.symbol || "").toUpperCase() === p.symbol);
        const bought = tt.filter(t => t.type === "buy").reduce((s, t) => s + t.shares, 0), sold = tt.filter(t => t.type === "sell").reduce((s, t) => s + t.shares, 0);
        const heldPrev = Math.max(0, p.shares - bought + sold);
        d = heldPrev * (px - prev) + tt.filter(t => t.type === "buy").reduce((s, t) => s + t.shares * (px - t.price), 0) + tt.filter(t => t.type === "sell").reduce((s, t) => s + t.shares * (t.price - prev), 0);
        day += d * k; dayBase += heldPrev * prev * k; dayKnown++;
      } else if (px != null && q?.date && today && String(q.date).slice(0, 10) !== today) stale.push(p.symbol);
      rows.push({ symbol: p.symbol, currency: p.currency, shares: p.shares, price: px, value, valueBase: value * k, day: d == null ? null : d * k, chgPct: isNum(q?.chgPct) ? q.chgPct : null, estimated: est, priceDate: q?.date || null, priceTime: q?.time || null });
    }
    // 今天賣光的部位（已經不在持股裡）也有今日損益：賣出價 − 昨收
    for (const t of txToday.filter(t => t.type === "sell")) { const sym = String(t.symbol || "").toUpperCase(); if (open.some(p => p.symbol === sym)) continue; const q = Q(sym), k = conv(t.currency); const prev = q && isNum(q.prev) ? q.prev : null; if (prev != null && k != null) { day += t.shares * (t.price - prev) * k; dayBase += t.shares * prev * k; soldOut++; } }
    const cashB = Object.entries(L?.cash || {}).reduce((s, [c, v]) => s + (v.tracked && v.balance > 0 && conv(c) != null ? v.balance * conv(c) : 0), 0);
    const total = mv + cashB;
    rows.forEach(r => { r.w = r.valueBase != null && total > EPS ? r4(r.valueBase / total) : null; });
    rows.sort((a, b) => (b.valueBase ?? -1) - (a.valueBase ?? -1));
    // 累積損益：已實現＋未實現＋股息−另計費用（各幣別先算，再用目前匯率換台幣）
    const cum = {}; let cumBase = 0, cumOk = true;
    for (const cur of ["TWD", "USD"]) {
      const T = L?.totals?.[cur]; const P = open.filter(p => p.currency === cur); if (!T && !P.length) continue;
      const un = rows.filter(r => r.currency === cur).reduce((s, r) => s + r.value, 0) - P.reduce((s, p) => s + p.costBasis, 0);
      // 另計費用（沒有併進買賣的，例如股息匯費）要扣；其他公司行動的現金要加（和績效頁同一個口徑）
      const app = (L?.txs || []).filter(x => x.applied && !x.errors.length && !x.mergedInto && x.tx?.currency === cur), xf = app.filter(x => x.tx.type === "fee").reduce((s, x) => s + x.tx.amount, 0), xo = app.filter(x => x.tx.type === "other" && isNum(x.tx.amount)).reduce((s, x) => s + x.tx.amount, 0);
      const v = (T?.realizedPnl || 0) + un + (T?.dividends || 0) - xf + xo; cum[cur] = r2(v);
      if (conv(cur) == null) cumOk = false; else cumBase += v * conv(cur);
    }
    const byMarket = {}; for (const r of rows) if (r.valueBase != null) byMarket[r.currency === "USD" ? "us" : "tw"] = (byMarket[r.currency === "USD" ? "us" : "tw"] || 0) + r.valueBase;
    if (cashB > EPS) byMarket.cash = cashB;
    const marketShare = Object.entries(byMarket).map(([g, v]) => ({ group: g, w: total > EPS ? r4(v / total) : 0 })).sort((a, b) => b.w - a.w);
    // 風險狀態
    const top = rows.filter(r => r.w != null), top5 = top.slice(0, 5).reduce((s, r) => s + r.w, 0), alerts = [];
    if (top[0] && top[0].w > 0.3) alerts.push({ k: "single_concentration", symbol: top[0].symbol, w: top[0].w, level: top[0].w > 0.5 ? "high" : "warn" });
    if (top.length >= 5 && top5 > 0.8) alerts.push({ k: "top5_concentration", w: r4(top5), level: "warn" });
    for (const m of opts.margin || []) if (m && (m.state === "call" || m.state === "liquidate" || m.state === "near")) alerts.push({ k: "margin", name: m.name, ratio: m.ratio, state: m.state, level: m.state === "near" ? "warn" : "high" });
    if (noPrice.length) { alerts.push({ k: "no_price", codes: noPrice, level: "info" }); issues.push({ k: "no_price", codes: noPrice }); }
    if (stale.length) { alerts.push({ k: "stale_quote", codes: stale, level: "info" }); issues.push({ k: "stale_quote", codes: stale }); }
    if (mvUsdNoFx > EPS) issues.push({ k: "no_fx" });
    if (!cumOk) issues.push({ k: "cum_no_fx" });
    const times = rows.map(r => r.priceDate && r.priceTime ? `${String(r.priceDate).slice(0, 10)} ${r.priceTime}` : r.priceDate).filter(Boolean).sort();
    return { v: VERSION, base: "TWD", total: r2(total), stocks: r2(mv), cash: r2(cashB), cashShare: total > EPS ? r4(cashB / total) : 0, usdNotConverted: r2(mvUsdNoFx),
      today: dayKnown || soldOut ? { pnl: r2(day), pct: dayBase > EPS ? day / dayBase : null, counted: dayKnown, of: open.length } : null,
      cumulative: { base: cumOk ? r2(cumBase) : null, byCurrency: cum, atCurrentFx: !!(cum.USD != null && fx) }, cost: r2(cost),
      marketShare, top: rows.slice(0, 5), positions: rows.length, alerts, issues,
      updated: { quotesFrom: times[0] || null, quotesTo: times[times.length - 1] || null, fx: fx ? { rate: fx.rate, date: fx.date || null } : null } };
  }
  const ALERT_LABEL = { single_concentration: "單一持股占比偏高", top5_concentration: "前五大持股合計超過 80%", margin: "融資維持率", no_price: "有持股沒有報價，用成本估算", stale_quote: "有持股的報價不是今天的，今日損益沒算它" };
  const ISSUE_LABEL = { no_fx: "沒有匯率，美股沒有換算進總資產", cum_no_fx: "沒有匯率，累積損益只算台股" };
  root.KLOverview = Object.freeze({ VERSION, summarize, ALERT_LABEL, ISSUE_LABEL });
})(typeof window !== "undefined" ? window : globalThis);
