/* 資產配置分析（投資組合第 6 階段）：權重、前十大、市場／類型／幣別／產業分布、集中度、現金比重、ETF 穿透（成分股曝險、重複持股、產業曝險）。
   純函式，不讀寫存檔、不連網、不輸出 console。瀏覽器裡是 window.KLAlloc；測試用 node 的 vm 載入。
   口徑（docs/portfolio/ALLOCATION.md）：
   · 全部換成台幣（基準幣別）再算權重；美元用傳進來的匯率。沒有匯率時不合併，台股、美股各自算（標 no_fx），不把美元當台幣相加。
   · 市值：有現價用現價；沒有現價用成本並標「估算」。
   · ETF 穿透：ETF 的權重 × 成分股占比＝透過這檔 ETF 持有的曝險；加上直接持有的部分＝實際曝險。
     成分股只揭露前幾大時，剩下的歸到「其他（未揭露）」，不硬分攤。
     每一檔 ETF 的成分股日期分開列出；日期不同時標示（不當成同一時間的資料），日期離今天超過 45 天也標示。
   · 重複持股：兩檔 ETF 的重疊度＝共同成分股占比取小的加總；ETF 成分股和直接持有的股票重複也列出來。 */
(function (root) {
  "use strict";
  const VERSION = 1, EPS = 1e-9, DAY = 864e5;
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const r4 = v => Math.round(v * 1e4) / 1e4, r2 = v => Math.round(v * 100) / 100;
  const hhi = ws => ws.reduce((s, w) => s + w * w, 0);
  // 產業名稱統一：證交所股票清單是「半導體業」、ETF 產業分布是「半導體」，去掉結尾的「業」才不會同一個產業分成兩列
  const indName = v => (typeof v === "string" && v.trim() ? v.trim().replace(/(?<=[\u4e00-\u9fff])業$/, "") : null);
  const groupBy = (items, key) => { const m = new Map(); for (const x of items) { const k = key(x) ?? "unknown"; m.set(k, (m.get(k) || 0) + x.w); } return [...m].map(([g, w]) => ({ group: g, w: r4(w) })).sort((a, b) => b.w - a.w); };

  // positions：[{ symbol, name, market: tw|us, currency: TWD|USD, value（該幣別市值）, valueEstimated, assetType: stock|etf, industry }]
  // opts：fx（{ rate, date }，台幣／美元）、cash（{ TWD, USD }）、etf（代號 → { date, rows: [{ code, name, pct }], ind: { date, rows: [{ name, pct }] } }）、asOf（YYYY-MM-DD）、names（代號 → 名稱）
  function build(positions, opts = {}) {
    const P = (Array.isArray(positions) ? positions : []).filter(p => p && p.symbol && isNum(p.value) && p.value > EPS);
    const cash = opts.cash || {}, fx = opts.fx && isNum(opts.fx.rate) && opts.fx.rate > 0 ? opts.fx : null, issues = [];
    const hasUsd = P.some(p => p.currency === "USD") || (cash.USD || 0) > EPS;
    if (!P.length && !(cash.TWD > EPS) && !(cash.USD > EPS)) return { v: VERSION, status: "empty" };
    if (hasUsd && !fx) {
      // 沒有匯率：台股、美股各自算，不合併
      const out = { v: VERSION, status: "no_fx", base: null, byCurrency: {}, issues: [{ k: "no_fx" }] };
      for (const cur of ["TWD", "USD"]) { const sub = P.filter(p => p.currency === cur); if (sub.length || cash[cur] > EPS) out.byCurrency[cur] = core(sub, { ...opts, cash: { [cur]: cash[cur] || 0 }, toBase: () => 1, base: cur }); }
      return out;
    }
    const toBase = cur => (cur === "USD" ? fx.rate : 1);
    const res = core(P, { ...opts, toBase, base: "TWD" });
    return { v: VERSION, status: res.estimated ? "estimated" : "ok", base: "TWD", fx: fx ? { rate: fx.rate, date: fx.date || null } : null, ...res };
  }

  function core(P, opts) {
    const { toBase, base } = opts, cash = opts.cash || {}, issues = [], names = opts.names || {};
    const items = P.map(p => ({ ...p, vb: p.value * toBase(p.currency) }));
    const cashB = Object.entries(cash).reduce((s, [c, v]) => s + (isNum(v) && v > 0 ? v * toBase(c) : 0), 0);
    const total = items.reduce((s, x) => s + x.vb, 0) + cashB;
    if (total <= EPS) return { total: 0, holdings: [], issues: [{ k: "empty" }] };
    items.forEach(x => { x.w = x.vb / total; });
    const est = items.filter(x => x.valueEstimated); if (est.length) issues.push({ k: "value_estimated", codes: est.map(x => x.symbol) });
    const holdings = items.map(x => ({ symbol: x.symbol, name: x.name || names[x.symbol] || null, market: x.market, currency: x.currency, assetType: x.assetType || "stock", industry: indName(x.industry), value: r2(x.vb), w: r4(x.w), estimated: !!x.valueEstimated }))
      .sort((a, b) => b.w - a.w);
    const cashItem = cashB > EPS ? [{ w: cashB / total, market: "cash", assetType: "cash", currency: base, industry: "現金" }] : [];
    const all = [...items, ...cashItem];
    const byMarket = groupBy(all, x => x.market === "cash" ? "cash" : x.market), byType = groupBy(all, x => x.assetType || "stock");
    const byCurrency = groupBy([...items.map(x => ({ w: x.w, c: x.currency })), ...Object.entries(cash).filter(([, v]) => v > EPS).map(([c, v]) => ({ w: v * toBase(c) / total, c }))], x => x.c);
    // 產業（不穿透）：ETF 歸「ETF」，現金歸「現金」
    const byIndustry = groupBy(all, x => (x.assetType === "etf" ? "ETF" : indName(x.industry) || (x.assetType === "cash" ? "現金" : "unknown")));
    const ws = items.map(x => x.w), top = holdings[0] || null;
    const concentration = { top: top ? { symbol: top.symbol, w: top.w } : null, top5: r4(holdings.slice(0, 5).reduce((s, x) => s + x.w, 0)), hhi: r4(hhi(ws)), effN: ws.length ? r2(1 / hhi(ws.map(w => w / (1 - (cashB / total) || 1)))) : 0,
      market: byMarket.filter(g => g.group !== "cash")[0] || null };
    // ETF 穿透
    const look = lookThrough(items, opts, total);
    issues.push(...look.issues);
    const industryLT = look.industry.length ? look.industry : null;
    concentration.industryHhi = r4(hhi((industryLT || byIndustry).filter(g => g.group !== "unknown" && g.group !== "現金" && g.group !== "其他（未揭露）").map(g => g.w)));
    return { base, total: r2(total), cash: r2(cashB), cashShare: r4(cashB / total), holdings, top10: holdings.slice(0, 10), byMarket, byType, byCurrency, byIndustry, byIndustryLookThrough: industryLT, concentration, lookThrough: look, issues, estimated: issues.some(x => ["value_estimated", "etf_dates_differ", "etf_holdings_stale", "etf_partial"].includes(x.k)) };
  }

  function lookThrough(items, opts, total) {
    const E = opts.etf || {}, issues = [], exp = new Map(), ind = new Map(), dates = [], asOf = opts.asOf || null;
    const add = (code, name, w, via) => { const k = code || "(" + name + ")"; const o = exp.get(k) || { code: code || null, name: name || null, direct: 0, viaEtf: 0, via: [] }; if (via) { o.viaEtf += w; o.via.push({ etf: via, w: r4(w) }); } else o.direct += w; if (!o.name && name) o.name = name; exp.set(k, o); };
    const etfs = items.filter(x => x.assetType === "etf"), noData = [];
    for (const x of items) {
      if (x.assetType !== "etf") { add(x.symbol, x.name, x.w, null); const k = indName(x.industry) || "unknown"; ind.set(k, (ind.get(k) || 0) + x.w); continue; }
      const H = E[x.symbol];
      if (!H || !Array.isArray(H.rows) || !H.rows.length) { noData.push(x.symbol); add(x.symbol, x.name, x.w, null); ind.set("ETF（沒有成分股資料）", (ind.get("ETF（沒有成分股資料）") || 0) + x.w); continue; }
      const rows = H.rows.filter(r => isNum(r.pct) && r.pct > 0), covered = Math.min(100, rows.reduce((s, r) => s + r.pct, 0));
      for (const r of rows) add(r.code ? String(r.code).toUpperCase() : null, r.name, x.w * r.pct / 100, x.symbol);
      if (covered < 99.5) { add(null, "其他（未揭露）", x.w * (100 - covered) / 100, x.symbol); }
      dates.push({ etf: x.symbol, date: H.date || null, covered: r2(covered), n: rows.length, indDate: H.ind?.date || null });
      const ir = (H.ind?.rows || []).filter(r => isNum(r.pct) && r.pct > 0), icov = Math.min(100, ir.reduce((s, r) => s + r.pct, 0));
      if (ir.length) { for (const r of ir) { const k = indName(r.name) || "unknown"; ind.set(k, (ind.get(k) || 0) + x.w * r.pct / 100); } if (icov < 99.5) ind.set("其他（未揭露）", (ind.get("其他（未揭露）") || 0) + x.w * (100 - icov) / 100); }
      else ind.set("ETF（沒有產業資料）", (ind.get("ETF（沒有產業資料）") || 0) + x.w);
    }
    if (noData.length) issues.push({ k: "etf_no_holdings", codes: noData });
    const partial = dates.filter(d => d.covered < 90); if (partial.length) issues.push({ k: "etf_partial", list: partial.map(d => ({ etf: d.etf, covered: d.covered })) });
    const ds = [...new Set(dates.map(d => d.date).filter(Boolean))]; if (ds.length > 1) issues.push({ k: "etf_dates_differ", dates: dates.map(d => ({ etf: d.etf, date: d.date })) });
    if (asOf) { const old = dates.filter(d => d.date && (Date.parse(asOf) - Date.parse(d.date)) / DAY > 45); if (old.length) issues.push({ k: "etf_holdings_stale", list: old.map(d => ({ etf: d.etf, date: d.date })) }); }
    const exposure = [...exp.values()].map(o => ({ code: o.code, name: o.name, direct: r4(o.direct), viaEtf: r4(o.viaEtf), w: r4(o.direct + o.viaEtf), via: o.via })).sort((a, b) => b.w - a.w);
    // 重複持股：ETF 兩兩重疊度（共同成分股占比取小的加總）；ETF 成分股裡有直接持有的股票
    const pairs = [];
    for (let i = 0; i < etfs.length; i++) for (let j = i + 1; j < etfs.length; j++) {
      const A = E[etfs[i].symbol]?.rows, Bm = new Map((E[etfs[j].symbol]?.rows || []).filter(r => r.code).map(r => [String(r.code).toUpperCase(), r.pct])); if (!A || !Bm.size) continue;
      const common = A.filter(r => r.code && Bm.has(String(r.code).toUpperCase())).map(r => ({ code: String(r.code).toUpperCase(), name: r.name, a: r.pct, b: Bm.get(String(r.code).toUpperCase()) }));
      pairs.push({ a: etfs[i].symbol, b: etfs[j].symbol, overlap: r2(common.reduce((s, c) => s + Math.min(c.a, c.b), 0)), common: common.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b)).slice(0, 10), sameDate: (E[etfs[i].symbol]?.date || null) === (E[etfs[j].symbol]?.date || null) });
    }
    const dupDirect = exposure.filter(e => e.direct > EPS && e.viaEtf > EPS).map(e => ({ code: e.code, name: e.name, direct: e.direct, viaEtf: e.viaEtf, w: e.w, via: e.via.map(v => v.etf) }));
    const industry = etfs.some(x => E[x.symbol]?.ind?.rows?.length) ? [...ind].map(([g, w]) => ({ group: g, w: r4(w) })).sort((a, b) => b.w - a.w) : [];
    return { exposure, top: exposure.filter(e => e.code).slice(0, 15), pairs: pairs.sort((a, b) => b.overlap - a.overlap), dupDirect, dates, industry, issues };
  }
  const ISSUE_LABEL = { no_fx: "沒有匯率，台股與美股分開計算（不把美元當台幣相加）", value_estimated: "有持股沒有現價，用成本估算市值", etf_no_holdings: "有 ETF 拿不到成分股資料，沒有穿透",
    etf_partial: "有 ETF 只揭露部分成分股，剩下的歸到「其他（未揭露）」", etf_dates_differ: "各 ETF 的成分股資料日期不同，穿透結果是不同時間的組合", etf_holdings_stale: "有 ETF 的成分股資料超過 45 天" };
  root.KLAlloc = Object.freeze({ VERSION, build, ISSUE_LABEL });
})(typeof window !== "undefined" ? window : globalThis);
