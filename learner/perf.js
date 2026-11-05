/* 績效分析引擎（投資組合第 5 階段 A）：用交易紀錄（ledger.js）＋每日收盤價，算出真實、可追溯的績效。純函式，不讀寫存檔、不連網、不輸出 console。
   口徑（docs/portfolio/PERFORMANCE.md 有完整說明）：
   · 範圍：「證券部位」——只看股票、ETF 的市值，不含現金。投入／取出的現金流＝買進付出的錢、賣出拿回的錢、領到的股息、股票轉入轉出（用當天市價）。
   · 價格用「原始收盤價」，不用還原價：股息已經以現金流記錄，用還原價會重複計算。
   · 台幣、美元分開算，不相加（匯率是第 3 階段）。
   · 時間加權報酬（TWR）：每天的報酬＝（今天市值 − 今天淨投入）÷ 昨天市值 − 1，連乘；不受投入時點影響，用來和大盤比。
   · 資金加權報酬（XIRR／MWR）：考慮投入時點與金額的年化報酬。現金流不完整（舊庫存轉入用成本、價格有缺、歷史被截斷）時標「估算」並列出原因；算不出來時標「無法計算」，不硬算。
   · 年化：期間滿一年才年化；未滿一年的 TWR 不年化，資金加權報酬只給整段期間的值（period），不給年化值。
   · 最大回撤、恢復時間用 TWR 的淨值指數算。
   · 比較基準：同一段期間、同樣的日期；加權指數是價格指數（不含股息），結果會標示。
   瀏覽器裡是 window.KLPerf（要先載入 ledger.js）；測試用 node 的 vm 載入。 */
(function (root) {
  "use strict";
  const VERSION = 1, DAY = 864e5, EPS = 1e-9;
  const r2 = v => Math.round(v * 100) / 100, dnum = d => Date.parse(d + "T00:00:00Z");
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  // 價格序列 [{ d, c }] → 依日期排序、去掉壞價格；查「d 當天或之前最後一個收盤價」
  function priceBook(series) {
    const a = (Array.isArray(series) ? series : []).filter(x => x && typeof x.d === "string" && isNum(+x.c) && +x.c > 0).map(x => ({ d: x.d.slice(0, 10), c: +x.c })).sort((x, y) => x.d.localeCompare(y.d));
    const at = d => { let lo = 0, hi = a.length - 1, ans = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { ans = a[m]; lo = m + 1; } else hi = m - 1; } return ans; };
    return { a, at, first: a.length ? a[0].d : null };
  }
  // 內部報酬率：flows [{ d, cf }]，cf 以投資人角度（投入為負、拿回為正）。unitDays＝365 是年化（XIRR）；傳整段期間的天數，就是「整段期間」的資金加權報酬（不年化）。
  // 在合理區間掃描變號區間；多次正負反轉時，有限網格不能證明根唯一，採保守 ambiguous，避免把漏掉的切線根誤報成唯一解。
  // 一個根：status "ok"；沒有根："none"；超過一個根（現金流正負來回好幾次時會發生）："multiple"——不任選一個
  function xirrInfo(flows, unitDays = 365) {
    // Same-day cash flows must be netted before checking sign changes; otherwise their
    // input order can create artificial sign reversals and false ambiguity.
    const byDate = new Map();
    for (const f of Array.isArray(flows) ? flows : []) if (f && typeof f.d === "string" && isNum(f.cf)) byDate.set(f.d, (byDate.get(f.d) || 0) + f.cf);
    const F = [...byDate].map(([d, cf]) => ({ d, cf })).filter(f => Math.abs(f.cf) > EPS).sort((a, b) => a.d.localeCompare(b.d));
    if (F.length < 2 || !F.some(f => f.cf > 0) || !F.some(f => f.cf < 0)) return { status: "none", roots: [] };
    let signChanges = 0, lastSign = 0;
    for (const f of F) { const sign = Math.sign(f.cf); if (lastSign && sign !== lastSign) signChanges++; lastSign = sign; }
    const t0 = dnum(F[0].d), npv = r => F.reduce((s, f) => s + f.cf / Math.pow(1 + r, (dnum(f.d) - t0) / DAY / unitDays), 0);
    const N = 4000, a = Math.log(1e-12), b = Math.log(1e6 + 1), grid = Array.from({ length: N + 1 }, (_, k) => -1 + Math.exp(a + (b - a) * k / N));
    const roots = []; let pr = null, pv = null;
    for (const r of grid) { const v = npv(r); if (!isNum(v)) { pr = null; continue; }
      if (Math.abs(v) < 1e-12) { if (!roots.some(x => Math.abs(x - r) < 1e-9)) roots.push(r); }
      else if (pr != null && pv * v < 0) { let lo = pr, hi = r, flo = pv; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2, fm = npv(m); if (!isNum(fm)) break; if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; } if (hi - lo < 1e-13) break; } roots.push((lo + hi) / 2); }
      pr = r; pv = v; }
    const uniq = roots.sort((x, y) => x - y).filter((x, i, A) => !i || Math.abs(x - A[i - 1]) > 1e-7);
    // A finite grid can miss an even-multiplicity (tangent) root or two very close roots.
    // With multiple cash-flow sign reversals, do not claim uniqueness unless the scan
    // actually finds multiple roots; conservatively mark the result ambiguous otherwise.
    const status = uniq.length > 1 ? "multiple" : signChanges > 1 ? "ambiguous" : uniq.length === 1 ? "ok" : "none";
    return { status, roots: uniq };
  }
  const xirr = (flows, unitDays = 365) => { const X = xirrInfo(flows, unitDays); return X.status === "ok" ? X.roots[0] : null; };
  // 期間報酬：把每日報酬依月、季、年連乘
  function periodReturns(days, key) {
    const out = new Map();
    for (const x of days) { if (x.r == null) continue; const k = key(x.d), o = out.get(k) || { p: k, g: 1, bg: 1, b: false, n: 0 }; o.g *= 1 + x.r; o.n++; if (x.br != null) { o.bg *= 1 + x.br; o.b = true; } out.set(k, o); }
    return [...out.values()].map(o => ({ p: o.p, r: o.g - 1, bench: o.b ? o.bg - 1 : null, days: o.n }));
  }
  // 最大回撤與恢復時間：idx [{ d, i }]（淨值指數）。回撤＝從前高跌了多少；恢復＝跌到谷底後，第一次回到前高要幾天（還沒回到就是 null）
  function drawdown(idx) {
    if (!idx || !idx.length) return null;
    let pk = idx[0], best = { dd: 0, peak: null, trough: null, pi: null };
    for (const x of idx) { if (x.i > pk.i) pk = x; const dd = x.i / pk.i - 1; if (dd < best.dd - EPS) best = { dd, peak: pk.d, trough: x.d, pi: pk.i }; }
    if (!best.peak) return { dd: 0, peak: null, trough: null, recovered: null, recoveryDays: null, durationDays: 0 };
    const after = idx.find(x => x.d > best.trough && x.i >= best.pi - EPS), end = after ? after.d : idx[idx.length - 1].d;
    return { dd: best.dd, peak: best.peak, trough: best.trough, recovered: after ? after.d : null, recoveryDays: after ? Math.round((dnum(after.d) - dnum(best.trough)) / DAY) : null, durationDays: Math.round((dnum(end) - dnum(best.peak)) / DAY) };
  }

  // 主函式。opts：method（avg／fifo）、prices（代號 → [{ d, c }] 原始收盤）、bench（{ TWD: [{d,c}], USD: [{d,c}] }，可省略）、benchName、
  //   asOf（算到哪一天，預設各價格的最後一天）、today、classify(symbol) → { assetType, industry }（可省略）
  function buildPerf(txs, opts = {}) {
    const LG = root.KLLedger; if (!LG) return { v: VERSION, status: "invalid", error: "no_ledger" };
    const L = LG.buildLedger(txs, { method: opts.method, today: opts.today });
    if (L.status === "invalid") return { v: VERSION, status: "invalid", error: L.error };
    const books = {}; for (const [c, s] of Object.entries(opts.prices || {})) books[String(c).toUpperCase()] = priceBook(s);
    const cls = typeof opts.classify === "function" ? opts.classify : (c => ({ assetType: /^00\d{2,4}[A-Z]?$/.test(c) ? "etf" : "stock", industry: null }));
    const applied = L.txs.filter(x => x.applied && !x.errors.length && !x.mergedInto && x.tx);
    // 整體狀態：有錯誤的交易（沒算進去）＞有待確認的部位（合股零股還沒結算，股數與成本是暫時的）＞正常
    const out = { v: VERSION, method: L.method, status: L.errorCount ? "has_errors" : L.pendingCount ? "needs_confirm" : "ok", ledgerErrors: L.errorCount, pendingCount: L.pendingCount || 0, byCurrency: {} };
    const refSym = new Map(L.txs.filter(x => x.tx?.id).map(x => [x.tx.id, x.tx.symbol || null])); // 另計費用對應哪一檔
    for (const cur of ["TWD", "USD"]) {
      const T = applied.filter(x => x.tx.currency === cur).map(x => x.tx); if (!T.some(t => t.symbol)) continue;
      const P = L.positions.filter(p => p.currency === cur), issues = [], est = new Set();
      const pend = P.filter(p => p.pending?.length); if (pend.length) { issues.push({ k: "pending", codes: pend.map(p => p.symbol) }); est.add("pending_confirm"); }
      // 另計費用（沒有併進買賣的，例如股息匯費）與其他公司行動的現金：要同時進入現金流與總損益，才能對帳
      const extra = { fees: 0, other: 0, transferOutPnl: 0, bySym: new Map(), unattributed: 0 }, addSym = (sym, v) => { if (sym) extra.bySym.set(sym, (extra.bySym.get(sym) || 0) + v); else extra.unattributed += v; };
      const priceAt = (sym, d) => books[sym]?.at(d) || null;
      // 持股（每一檔在每一天的股數）：用交易引擎的 history（已處理賣超、拆股、配股、零股），同一天取最後一筆
      const H = new Map(P.map(p => [p.symbol, p.history.map(h => [h.date, h.shares])]));
      const sharesAt = (sym, d) => { const h = H.get(sym); if (!h) return 0; let s = 0; for (const [hd, sh] of h) { if (hd <= d) s = sh; else break; } return s; };
      // 現金流（證券部位角度：+ 投入、− 拿回）
      const flows = [];
      for (const t of T) {
        const px = t.symbol ? priceAt(t.symbol, t.date) : null, mkt = n => (px && px.d === t.date ? n * px.c : null);
        if (t.type === "buy") flows.push({ d: t.date, f: t.shares * t.price + t.fee + t.tax });
        else if (t.type === "sell") flows.push({ d: t.date, f: -(t.shares * t.price - t.fee - t.tax) });
        else if (t.type === "dividend") flows.push({ d: t.date, f: -(t.amount - t.tax) });
        else if (t.type === "fraction_cash") flows.push({ d: t.date, f: -(t.amount - t.fee - t.tax) });
        else if (t.type === "transfer_in") { const v = mkt(t.shares); if (v == null) { est.add("transfer_at_cost"); flows.push({ d: t.date, f: t.shares * t.price + t.fee, atCost: true }); } else flows.push({ d: t.date, f: v + t.fee }); if (t.source === "legacy") est.add("legacy_transfer"); }
        else if (t.type === "transfer_out") {
          const pos = P.find(p => p.symbol === t.symbol), hist = pos?.history || [], hi = hist.findIndex(h => h.id === t.id && h.type === "transfer_out");
          const transferCost = hi > 0 ? Math.max(0, (hist[hi - 1].costBasis || 0) - (hist[hi].costBasis || 0)) : null;
          let v = mkt(t.shares);
          if (v == null && px) { v = t.shares * px.c; est.add("transfer_out_prev_price"); issues.push({ k: "transfer_out_prev_price", d: t.date, priceDate: px.d, code: t.symbol }); }
          if (v == null && isNum(t.price) && t.price > 0) { v = t.shares * t.price; est.add("transfer_out_user_price"); issues.push({ k: "transfer_out_user_price", d: t.date, code: t.symbol }); }
          if (v == null && transferCost > EPS) { v = transferCost; est.add("transfer_out_no_price"); issues.push({ k: "transfer_out_no_price", d: t.date, code: t.symbol, fallback: "cost" }); }
          if (v == null) { est.add("transfer_out_no_price"); issues.push({ k: "transfer_out_no_price", d: t.date, code: t.symbol, fallback: "unavailable" }); }
          else if (transferCost != null) { const gain = v - transferCost; extra.transferOutPnl += gain; addSym(t.symbol, gain); }
          flows.push({ d: t.date, f: -(v ?? 0) });
        }
        else if (t.type === "fee") { flows.push({ d: t.date, f: t.amount }); extra.fees += t.amount; addSym(t.symbol || (t.ref ? refSym.get(t.ref) : null), -t.amount); }
        else if (t.type === "other" && isNum(t.amount)) { flows.push({ d: t.date, f: -t.amount }); extra.other += t.amount; addSym(t.symbol, t.amount); est.add("other_action"); }
      }
      flows.sort((a, b) => a.d.localeCompare(b.d));
      const syms = P.map(p => p.symbol), start = flows.length ? flows[0].d : T[0].date;
      const lastPx = syms.map(s => books[s]?.a.at(-1)?.d).filter(Boolean).sort().at(-1) || null;
      const asOf = opts.asOf || lastPx || start;
      const missing = syms.filter(s => !books[s] || !books[s].a.length);
      if (missing.length) issues.push({ k: "no_prices", codes: missing });
      const trunc = syms.filter(s => books[s]?.first && books[s].first > (P.find(p => p.symbol === s).firstDate || start));
      if (trunc.length) { issues.push({ k: "history_truncated", codes: trunc }); est.add("history_truncated"); }
      // 交易日曆：所有持股價格的日期＋比較基準的交易日（持股停牌、缺資料也看得出來）＋現金流日期＋算到哪一天
      const BB0 = opts.bench && opts.bench[cur] ? priceBook(opts.bench[cur]) : null;
      const cal = [...new Set([...syms.flatMap(s => (books[s]?.a || []).map(x => x.d)), ...(BB0 ? BB0.a.map(x => x.d) : []), ...flows.map(f => f.d), ...(opts.asOf ? [opts.asOf] : [])])].filter(d => d >= start && d <= asOf).sort();
      const flowAt = new Map(); for (const f of flows) flowAt.set(f.d, (flowAt.get(f.d) || 0) + f.f);
      // 沒有價格時用最近一筆交易的價格（標「估算」）
      const lastTradePx = (sym, d) => { let v = null; for (const t of T) if (t.symbol === sym && t.date <= d && isNum(t.price) && t.price > 0) v = t.price; return v; };
      const BB = BB0;
      const days = []; let prevV = null, idxV = 1, prevB = null, fallbackDays = 0, staleMax = 0;
      for (const d of cal) {
        let v = 0, fb = false;
        for (const s of syms) { const sh = sharesAt(s, d); if (sh <= EPS) continue; const p = priceAt(s, d); let c = p ? p.c : null;
          if (p && p.d < d) staleMax = Math.max(staleMax, Math.round((dnum(d) - dnum(p.d)) / DAY));
          if (c == null) { c = lastTradePx(s, d); fb = true; } if (c != null) v += sh * c; }
        if (fb) { fallbackDays++; est.add("price_fallback"); }
        const f = flowAt.get(d) || 0, b = BB ? BB.at(d) : null;
        // 當天報酬：一般日子現金流算在收盤後；前一天市值是 0（第一天或出清後重新買）時，現金流算在開盤（報酬＝收盤市值 ÷ 投入 − 1）
        const r = prevV != null && prevV > EPS ? (v - f) / prevV - 1 : f > EPS ? v / f - 1 : null;
        const br = r != null && b && prevB ? b.c / prevB.c - 1 : null;
        if (r != null) idxV *= 1 + r;
        days.push({ d, v: r2(v), flow: r2(f), r, i: idxV, br });
        prevV = v; if (b) prevB = b;
      }
      if (fallbackDays) issues.push({ k: "price_fallback", days: fallbackDays });
      if (staleMax > 7) { issues.push({ k: "stale_prices", maxDays: staleMax }); est.add("stale_prices"); }
      const val = days.filter(x => x.r != null), first = days.find(x => x.v > EPS), last = days.at(-1), missingTransferOutValue = issues.some(x => x.k === "transfer_out_no_price" && x.fallback === "unavailable");
      // 年化用「實際有投資的期間」：從第一天到最後一天還有市值或現金流的日子；出清後價格資料再長，也不會被算成投資滿一年
      const active = [...days].reverse().find(x => x.v > EPS || Math.abs(x.flow) > EPS) || last;
      const twr = !missingTransferOutValue && val.length ? days.at(-1).i - 1 : null, spanDays = first && active ? Math.round((dnum(active.d) - dnum(first.d)) / DAY) : 0;
      const twrAnn = !missingTransferOutValue && twr != null && spanDays >= 365 ? Math.pow(1 + twr, 365 / spanDays) - 1 : null;
      // 資金加權（XIRR）：投資人角度，投入為負、拿回為正，最後一天的市值當成拿回
      const xf = flows.filter(f => f.d <= asOf).map(f => ({ d: f.d, cf: -f.f })); if (last && last.v > EPS) xf.push({ d: last.d, cf: last.v });
      // 滿一年：年化 XIRR；未滿一年：只給整段期間的資金加權報酬（不年化，短期年化會誇大到沒有意義）
      const reasons = [...est], xSpan = xf.length > 1 ? Math.max(1, Math.round((dnum(xf[xf.length - 1].d) - dnum(xf[0].d)) / DAY)) : 1;
      const XA = xSpan >= 365 ? xirrInfo(xf) : null, XP = xirrInfo(xf, xSpan), multi = ["multiple", "ambiguous"].includes(XP.status) || ["multiple", "ambiguous"].includes(XA?.status);
      const mwrAnn = XA?.status === "ok" ? XA.roots[0] : null, mwrPeriod = XP.status === "ok" ? XP.roots[0] : null;
      const mwr = multi ? { value: null, period: null, status: "unavailable", reasons: ["multiple_solutions", ...reasons], roots: XP.roots.length > 1 ? XP.roots : XA.roots }
        : mwrAnn == null && mwrPeriod == null ? { value: null, period: null, status: "unavailable", reasons: ["no_solution", ...reasons] }
        : { value: mwrAnn, period: mwrPeriod, annualized: mwrAnn != null, status: reasons.length ? "estimated" : "ok", reasons };
      // 比較基準：同一段期間
      let bench = null;
      // 起點用第一天之前最後一個收盤（組合第一天的報酬是從買進價算起，基準也要從前一天收盤算），沒有更早的才用當天
      if (BB && first && last) { const b0 = BB.a.filter(x => x.d < first.d).at(-1) || BB.at(first.d), b1 = BB.at(last.d); if (b0 && b1) bench = { name: opts.benchName?.[cur] || null, ret: b1.c / b0.c - 1, excess: twr == null ? null : twr - (b1.c / b0.c - 1), from: b0.d, to: b1.d, priceIndex: cur === "TWD" }; }
      // 損益（由交易引擎）：總投入＝買進＋轉入的金額；總損益＝已實現＋未實現＋股息（手續費、稅已經在成本與已實現裡，不重複扣）
      const Tt = L.totals[cur] || {}, mvNow = P.reduce((s, p) => { const sh = p.shares; if (sh <= EPS) return s; const px = priceAt(p.symbol, asOf); return s + sh * (px ? px.c : (lastTradePx(p.symbol, asOf) || 0)); }, 0);
      const costNow = P.reduce((s, p) => s + p.costBasis, 0), unreal = mvNow - costNow;
      const inflow = flows.filter(f => f.f > 0).reduce((s, f) => s + f.f, 0), outflow = -flows.filter(f => f.f < 0).reduce((s, f) => s + f.f, 0);
      // 總損益＝已實現＋未實現＋股息（稅後）−另計費用＋其他公司行動現金。買賣的手續費、稅已經在成本與已實現裡，不重複扣
      const total = missingTransferOutValue ? null : (Tt.realizedPnl || 0) + extra.transferOutPnl + unreal + (Tt.dividends || 0) - extra.fees + extra.other;
      const pnl = { invested: r2(inflow), returned: r2(outflow), netInvested: r2(inflow - outflow), marketValue: r2(mvNow), costBasis: r2(costNow), unrealized: r2(unreal), realized: r2((Tt.realizedPnl || 0) + extra.transferOutPnl), transferOutPnl: r2(extra.transferOutPnl), dividends: r2(Tt.dividends || 0), fees: r2(Tt.fees || 0), taxes: r2(Tt.taxes || 0), extraFees: r2(extra.fees), otherCash: r2(extra.other), total: total == null ? null : r2(total), totalPct: total != null && inflow > EPS ? total / inflow : null };
      // 歸因：每一檔的損益（已實現＋未實現＋股息）與占總損益的比例；依資產類型、產業加總；股息、費稅另外列；匯率還沒有
      const bySymbol = missingTransferOutValue ? [] : P.map(p => { const px = priceAt(p.symbol, asOf), mv = p.shares > EPS ? p.shares * (px ? px.c : (lastTradePx(p.symbol, asOf) || 0)) : 0, u = mv - p.costBasis, ex = extra.bySym.get(p.symbol) || 0, t = p.realizedPnl + u + p.dividends + ex, k = cls(p.symbol) || {};
        return { symbol: p.symbol, assetType: k.assetType || null, industry: k.industry || null, realized: r2(p.realizedPnl), unrealized: r2(u), dividends: r2(p.dividends), extra: r2(ex), fees: r2(p.fees), taxes: r2(p.taxes), pnl: r2(t), share: Math.abs(total) > EPS ? t / total : null }; })
        .sort((a, b) => b.pnl - a.pnl);
      const group = key => { const m = new Map(); for (const x of bySymbol) { const g = x[key] || "unknown"; m.set(g, (m.get(g) || 0) + x.pnl); } return [...m].map(([g, v]) => ({ group: g, pnl: r2(v), share: Math.abs(total) > EPS ? v / total : null })).sort((a, b) => b.pnl - a.pnl); };
      // 沒有對應到任何一檔的另計費用／公司行動現金另外列，讓「每一檔加總＋未歸屬＝總損益」
      const attribution = { bySymbol, unattributed: r2(extra.unattributed), byType: group("assetType"), byIndustry: group("industry"), dividends: r2(Tt.dividends || 0), feesAndTaxes: r2(-(Tt.fees || 0) - (Tt.taxes || 0)), fx: null, fxNote: "匯率影響要等第 3 階段（匯率）" };
      const ym = d => d.slice(0, 7), yq = d => `${d.slice(0, 4)}Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`, yy = d => d.slice(0, 4);
      const series = days.map(x => ({ d: x.d, v: x.v, flow: x.flow, index: +x.i.toFixed(8) }));
      out.byCurrency[cur] = {
        currency: cur, from: first ? first.d : null, to: last ? last.d : null, activeTo: active ? active.d : null, spanDays, asOf, status: pend.length ? "needs_confirm" : reasons.length ? "estimated" : "ok",
        twr, twrAnn, annualizable: !missingTransferOutValue && spanDays >= 365, mwr, bench,
        monthly: missingTransferOutValue ? [] : periodReturns(val, ym), quarterly: missingTransferOutValue ? [] : periodReturns(val, yq), yearly: missingTransferOutValue ? [] : periodReturns(val, yy),
        maxDrawdown: !missingTransferOutValue && val.length ? drawdown(days.filter(x => x.v > EPS || x.r != null).map(x => ({ d: x.d, i: x.i }))) : null,
        pnl, attribution, series: missingTransferOutValue ? [] : series, issues, estimated: reasons
      };
    }
    if (!Object.keys(out.byCurrency).length) out.status = "empty";
    return out;
  }
  const REASON_LABEL = { legacy_transfer: "有從舊庫存轉入的部位（成本是當時記的平均成本，買進日期與金額不一定準）", transfer_at_cost: "股票轉入那天沒有市價，用成本當投入金額", transfer_out_no_price: "股票轉出那天沒有價格", history_truncated: "價格歷史比第一筆交易晚開始，前面一段只能用交易價格估", price_fallback: "有些日子沒有收盤價，用最近一筆交易的價格代替", no_solution: "現金流算不出報酬率（例如只有投入、沒有市值）",
    multiple_solutions: "現金流正負多次反轉，可能有多重解或無法確認唯一解，因此不任選一個", pending_confirm: "有部位合股後的零股還沒結算，股數與成本是暫時的",
    stale_prices: "有價格停在超過 7 天前（可能停牌或資料缺漏），市值可能不是最新", transfer_out_prev_price: "股票轉出那天沒有收盤價，用之前的收盤價計算", transfer_out_user_price: "股票轉出沒有收盤價，改用手動填寫的價格估算", transfer_out_no_price: "股票轉出沒有可用市價，改用轉出成本估算；若連成本也無法確認，績效停止計算", other_action: "有其他公司行動的現金，計入總損益與報酬，請確認性質" };
  root.KLPerf = Object.freeze({ VERSION, buildPerf, xirr, xirrInfo, drawdown, periodReturns, priceBook, REASON_LABEL });
})(typeof window !== "undefined" ? window : globalThis);
