/* 匯率與台幣合併（投資組合第 3 階段）：把 perf.js 算出的台股、美股兩個部位，用每天的美元兌台幣匯率換成台幣後合併。純函式，不讀寫存檔、不連網、不輸出 console。
   口徑（docs/portfolio/FX.md）：
   · 匯率：每天一個值（台幣／1 美元，預設 Yahoo TWD=X 收盤，是市場中間價，不是銀行實際買賣匯率）；當天沒有就用之前最近的一天，超過 5 天標「估算」。
   · 美股部位每天的市值、現金流都用「當天」的匯率換成台幣；台股部位不換。兩邊日期不同（台美休市日不同）時，沒開市的一邊沿用前一天的市值、現金流為 0。
   · 合併後的時間加權報酬、資金加權報酬和 perf.js 同一套算法（不另外發明）。
   · 損益拆解（每天，可以完全對帳）：美股部位當天的台幣損益 ＝（今天市值 − 今天淨投入 − 昨天市值）× 今天匯率 ＋ 昨天市值 ×（今天匯率 − 昨天匯率）；
     前一項是「股價與股息」、後一項是「匯率」。台股部位只有前一項。加總＝合併後的總損益。
   瀏覽器裡是 window.KLFx（要先載入 ledger.js、perf.js）；測試用 node 的 vm 載入。 */
(function (root) {
  "use strict";
  const VERSION = 1, DAY = 864e5, EPS = 1e-9, STALE_DAYS = 5;
  const r2 = v => Math.round(v * 100) / 100, dnum = d => Date.parse(d + "T00:00:00Z");
  // perfResult：KLPerf.buildPerf 的結果；fxSeries：[{ d, c }]（台幣／美元）
  function combine(perfResult, fxSeries, opts = {}) {
    const P = root.KLPerf; if (!P) return { v: VERSION, status: "invalid", error: "no_perf" };
    const TW = perfResult?.byCurrency?.TWD, US = perfResult?.byCurrency?.USD;
    if (!US) return { v: VERSION, status: "no_usd", note: "沒有美股部位，不需要換匯" };
    // 任一部位因為資料不足沒有績效序列（例如零成本部位轉出又沒有價格），合併結果也不能算
    if (!US.series.length || (TW && !TW.series.length && TW.twr == null)) return { v: VERSION, status: "unavailable", reasons: ["sleeve_unavailable"] };
    const FX = P.priceBook(fxSeries);
    if (!FX.a.length) return { v: VERSION, status: "unavailable", reasons: ["no_fx"] };
    const tw = new Map((TW?.series || []).map(x => [x.d, x])), us = new Map(US.series.map(x => [x.d, x]));
    const cal = [...new Set([...tw.keys(), ...us.keys()])].sort();
    const est = new Set(US.mwr?.reasons || []); (TW?.mwr?.reasons || []).forEach(r => est.add(r));
    let vT = 0, vU = 0, pfx = null, prev = null, idx = 1, staleMax = 0, firstFx = null;
    const days = [], flows = [];
    const sum = { twPnl: 0, usLocal: 0, usFx: 0 };
    for (const d of cal) {
      const a = tw.get(d), b = us.get(d), q = FX.at(d);
      if (a) vT = a.v; if (b) vU = b.v;
      const fT = a ? a.flow : 0, fU = b ? b.flow : 0;
      if (!q) { if (vU > EPS || Math.abs(fU) > EPS) { est.add("fx_missing_early"); } }
      const rate = q ? q.c : (FX.a[0].c); if (!firstFx) firstFx = rate;
      if (q && q.d < d) staleMax = Math.max(staleMax, Math.round((dnum(d) - dnum(q.d)) / DAY));
      const V = vT + vU * rate, F = fT + fU * rate;
      // 台股部位、美股部位各自當天的損益（台幣）
      if (prev) { sum.twPnl += vT - fT - prev.vT; sum.usLocal += (vU - fU - prev.vU) * rate; sum.usFx += prev.vU * (rate - prev.rate); }
      else { sum.twPnl += vT - fT; sum.usLocal += (vU - fU) * rate; }
      const r = prev && prev.V > EPS ? (V - F) / prev.V - 1 : F > EPS ? V / F - 1 : null;
      if (r != null) idx *= 1 + r;
      days.push({ d, v: r2(V), flow: r2(F), r, i: idx, rate, usShare: V > EPS ? vU * rate / V : null });
      if (Math.abs(F) > EPS) flows.push({ d, f: F });
      prev = { V, vT, vU, rate };
    }
    if (staleMax > STALE_DAYS) est.add("fx_stale");
    const first = days.find(x => x.v > EPS), last = days.at(-1), active = [...days].reverse().find(x => x.v > EPS || Math.abs(x.flow) > EPS) || last;
    const spanDays = first ? Math.round((dnum(active.d) - dnum(first.d)) / DAY) : 0, twr = days.some(x => x.r != null) ? last.i - 1 : null;
    const xf = flows.map(f => ({ d: f.d, cf: -f.f })); if (last && last.v > EPS) xf.push({ d: last.d, cf: last.v });
    const xSpan = xf.length > 1 ? Math.max(1, Math.round((dnum(xf.at(-1).d) - dnum(xf[0].d)) / DAY)) : 1;
    const XA = spanDays >= 365 ? P.xirrInfo(xf) : null, XP = P.xirrInfo(xf, xSpan), reasons = [...est];
    const bad = x => x && (x.status === "multiple" || x.status === "ambiguous"), multi = bad(XP) || bad(XA);
    const mwr = multi ? { value: null, period: null, status: "unavailable", reasons: ["multiple_solutions", ...reasons] }
      : XP.status !== "ok" && XA?.status !== "ok" ? { value: null, period: null, status: "unavailable", reasons: ["no_solution", ...reasons] }
      : { value: XA?.status === "ok" ? XA.roots[0] : null, period: XP.status === "ok" ? XP.roots[0] : null, annualized: XA?.status === "ok", status: reasons.length ? "estimated" : "ok", reasons };
    const total = sum.twPnl + sum.usLocal + sum.usFx, invested = flows.filter(f => f.f > 0).reduce((s, f) => s + f.f, 0);
    const fxNow = FX.at(last.d);
    return {
      v: VERSION, status: reasons.length ? "estimated" : "ok", base: "TWD", from: first ? first.d : null, to: last ? last.d : null, spanDays,
      fx: { source: opts.fxSource || null, rate: fxNow ? fxNow.c : null, date: fxNow ? fxNow.d : null, first: firstFx, change: fxNow && firstFx ? fxNow.c / firstFx - 1 : null },
      marketValue: r2(last.v), usdShare: last.usShare, twr, twrAnn: twr != null && spanDays >= 365 ? Math.pow(1 + twr, 365 / spanDays) - 1 : null, annualizable: spanDays >= 365, mwr,
      pnl: { total: r2(total), invested: r2(invested), totalPct: invested > EPS ? total / invested : null, twStocks: r2(sum.twPnl), usPrice: r2(sum.usLocal), usFx: r2(sum.usFx) },
      series: days.map(x => ({ d: x.d, v: x.v, flow: x.flow, index: +x.i.toFixed(8), rate: x.rate, usShare: x.usShare })),
      monthly: P.periodReturns(days.filter(x => x.r != null), d => d.slice(0, 7)), maxDrawdown: P.drawdown(days.filter(x => x.v > EPS || x.r != null).map(x => ({ d: x.d, i: x.i }))),
      reasons
    };
  }
  const REASON_LABEL = { fx_stale: `有日子的匯率是 ${STALE_DAYS} 天以前的（資料缺漏）`, fx_missing_early: "最早幾天沒有匯率資料，用最早一筆匯率代替", no_fx: "拿不到匯率資料，不能合併計算", sleeve_unavailable: "台股或美股部位資料不足，不能合併計算" };
  root.KLFx = Object.freeze({ VERSION, combine, REASON_LABEL, STALE_DAYS });
})(typeof window !== "undefined" ? window : globalThis);
