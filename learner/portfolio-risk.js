/** Pure portfolio risk calculations. Benchmark dates define the session calendar. */
export const PORTFOLIO_RISK_VERSION = 2;
const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
const pos = x => typeof x === "number" && Number.isFinite(x) && x > 0;
const validDate = x => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(x + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === x;
};
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const moments = a => {
  if (a.length < 2) return { mean: null, variance: null };
  const m = mean(a);
  return { mean: m, variance: a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) };
};
const cov = (a, b, ma = mean(a), mb = mean(b)) =>
  a.length === b.length && a.length > 1 && ma !== null && mb !== null
    ? a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1) : null;
const corr = (a, b, am, bm) => {
  if (!(am.variance > 0) || !(bm.variance > 0)) return null;
  const c = cov(a, b, am.mean, bm.mean);
  return Number.isFinite(c) ? Math.max(-1, Math.min(1, c / Math.sqrt(am.variance * bm.variance))) : null;
};
const quantile = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), q = (s.length - 1) * p, lo = Math.floor(q), hi = Math.ceil(q);
  return s[lo] + (s[hi] - s[lo]) * (q - lo);
};
const compound = a => a.reduce((p, x) => p * (1 + x), 1) - 1;
const currencyFor = m => m === "tw" ? "TWD" : m === "us" ? "USD" : null;
function invalid(input, code, extra = []) {
  const hs = Array.isArray(input?.holdings) ? input.holdings : [];
  const rawTotalMV = hs.reduce((s, h) => s + (pos(h?.marketValue) ? h.marketValue : 0), 0);
  const totalMV = Number.isFinite(rawTotalMV) ? rawTotalMV : null;
  const excluded = hs.map(h => ({ symbol: typeof h?.symbol === "string" ? h.symbol.trim().toUpperCase() || null : null, reason: code }));
  return {
    schemaVersion: PORTFOLIO_RISK_VERSION, status: "invalid", market: input?.market ?? null,
    requestedAsOf: input?.asOf ?? null, effectiveAsOf: null, asOf: null, methodology: null, metrics: null,
    coverage: { totalHoldings: hs.length, includedHoldings: 0, excludedHoldings: hs.length,
      includedSymbols: 0, excludedSymbols: new Set(excluded.map(x => x.symbol)).size,
      sourcePositionRows: hs.length, totalMarketValue: totalMV, includedMarketValue: 0,
      excludedMarketValue: totalMV, marketValueCoverage: totalMV !== null && totalMV > 0 ? 0 : null,
      unvaluedHoldings: hs.filter(h => !pos(h?.marketValue)).length, observations: 0 },
    excluded, issues: [{ code, severity: "error" }, ...extra]
  };
}
function parse(rows, label, asOf, issues) {
  const prices = new Map(), invalidPrices = new Set(), conflicts = new Set();
  let malformed = 0, future = 0, duplicates = 0;
  if (!Array.isArray(rows)) {
    issues.push({ code: "missing_series", severity: "error", subject: label });
    return { prices, invalidPrices, conflicts, malformed: 1 };
  }
  for (const row of rows) {
    if (!obj(row) || !validDate(row.date)) { malformed++; continue; }
    if (asOf && row.date > asOf) { future++; continue; }
    if (!pos(row.adjustedClose)) { invalidPrices.add(row.date); continue; }
    if (prices.has(row.date)) {
      if (prices.get(row.date) === row.adjustedClose && !invalidPrices.has(row.date)) duplicates++;
      else conflicts.add(row.date);
    } else prices.set(row.date, row.adjustedClose);
  }
  if (malformed) issues.push({ code: "invalid_dates", severity: "error", subject: label, count: malformed });
  if (future) issues.push({ code: "future_observations_excluded", severity: "warning", subject: label, count: future });
  if (duplicates) issues.push({ code: "identical_duplicate_dates_deduplicated", severity: "warning", subject: label, count: duplicates });
  if (conflicts.size) issues.push({ code: "conflicting_duplicate_dates", severity: "error", subject: label, dates: [...conflicts] });
  if (invalidPrices.size) issues.push({ code: "invalid_price_observations", severity: "error", subject: label, dates: [...invalidPrices] });
  return { prices, invalidPrices, conflicts, malformed };
}
const repeatExcluded = (h, reason, details = {}) =>
  Array.from({ length: h.sourceRows }, () => ({ symbol: h.symbol, reason, ...details }));
function group(holdings, market, currency, asOf, issues) {
  const groups = new Map(), excluded = [];
  for (const h of holdings) {
    const symbol = typeof h?.symbol === "string" ? h.symbol.trim().toUpperCase() : "";
    if (!symbol) { excluded.push({ symbol: null, reason: "invalid_symbol" }); continue; }
    if (!groups.has(symbol)) groups.set(symbol, []);
    groups.get(symbol).push(h);
  }
  const candidates = [];
  for (const [symbol, rows] of groups) {
    const mv = rows.reduce((s, h) => s + (pos(h?.marketValue) ? h.marketValue : 0), 0);
    let reason = null;
    if (!Number.isFinite(mv)) reason = "market_value_overflow";
    else if (rows.some(h => h?.market !== market)) reason = rows.some(h => h?.market == null) ? "missing_market" : "market_mismatch";
    else if (rows.some(h => h?.currency !== currency)) reason = rows.some(h => h?.currency == null) ? "missing_currency" : "currency_mismatch";
    else if (rows.some(h => !pos(h?.marketValue))) reason = "invalid_market_value";
    else if (rows.some(h => !Array.isArray(h?.daily))) reason = "missing_series";
    if (reason) {
      excluded.push(...rows.map(() => ({ symbol, reason })));
      issues.push({ code: reason, severity: "error", subject: symbol });
      continue;
    }
    const parsed = rows.map((h, i) => parse(h.daily, symbol + "#" + (i + 1), asOf, issues));
    if (parsed.some(p => p.malformed || p.conflicts.size || p.invalidPrices.size)) {
      const why = parsed.some(p => p.conflicts.size) ? "conflicting_duplicate_dates" :
        parsed.some(p => p.invalidPrices.size) ? "invalid_price_observations" : "invalid_dates";
      excluded.push(...rows.map(() => ({ symbol, reason: why })));
      continue;
    }
    const first = parsed[0].prices;
    if (first.size < 31) {
      excluded.push(...rows.map(() => ({ symbol, reason: "insufficient_history" })));
      issues.push({ code: "insufficient_history", severity: "warning", subject: symbol, availablePrices: first.size });
      continue;
    }
    const same = parsed.every(p => p.prices.size === first.size && [...first].every(([d, v]) => p.prices.get(d) === v));
    if (!same) {
      excluded.push(...rows.map(() => ({ symbol, reason: "conflicting_duplicate_symbol_series" })));
      issues.push({ code: "conflicting_duplicate_symbol_series", severity: "error", subject: symbol });
      continue;
    }
    if (rows.length > 1) issues.push({ code: "duplicate_symbol_positions_merged", severity: "info", subject: symbol, sourceRows: rows.length });
    candidates.push({ symbol, marketValue: mv, sourceRows: rows.length, prices: first });
  }
  return { candidates, excluded };
}
export function analyzePortfolioRisk(input) {
  if (!obj(input) || !["tw", "us"].includes(input.market) || !Array.isArray(input.holdings) || !Array.isArray(input.benchmark))
    return invalid(input, "invalid_input");
  const currency = currencyFor(input.market), asOf = input.asOf ?? null;
  const window = input.window ?? 120, confidence = input.confidenceLevel ?? 0.95, shock = input.benchmarkShock ?? -0.2;
  if ((asOf !== null && !validDate(asOf)) || !Number.isInteger(window) || window < 30 || window > 1000 ||
      !Number.isFinite(confidence) || confidence <= 0.5 || confidence >= 1 || !Number.isFinite(shock) || shock >= 0 || shock < -1 ||
      input.currency !== currency || input.benchmarkMarket !== input.market || input.benchmarkCurrency !== currency)
    return invalid(input, "invalid_parameters_or_market_metadata");
  const issues = [], bm = parse(input.benchmark, "benchmark", asOf, issues);
  if (bm.malformed || bm.conflicts.size || bm.invalidPrices.size) return invalid(input, "invalid_benchmark_series", issues);
  const benchmark = bm.prices, allDates = [...benchmark.keys()].sort();
  if (allDates.length < 31) return invalid(input, "insufficient_benchmark_history",
    [{ code: "insufficient_benchmark_history", severity: "error", availablePrices: allDates.length }]);
  const grouped = group(input.holdings, input.market, currency, asOf, issues);
  const excluded = [...grouped.excluded];
  let candidates = [...grouped.candidates];
  const totalMV = input.holdings.reduce((s, h) => s + (pos(h?.marketValue) ? h.marketValue : 0), 0);
  if (!Number.isFinite(totalMV)) return invalid(input, "total_market_value_overflow", issues);
  if (!candidates.length) return invalid(input, "no_eligible_holdings", issues);
  if (asOf) {
    const gap = Math.floor((Date.parse(asOf + "T00:00:00Z") - Date.parse(allDates[allDates.length - 1] + "T00:00:00Z")) / 86400000);
    if (gap > 7) issues.push({ code: "stale_analysis", severity: "warning", requestedAsOf: asOf, benchmarkLatestDate: allDates[allDates.length - 1], calendarDayGap: gap });
  }
  if (candidates.some(c => [...c.prices.keys()].some(d => d > allDates[allDates.length - 1])))
    issues.push({ code: "benchmark_lags_holdings", severity: "warning", benchmarkLatestDate: allDates[allDates.length - 1] });
  const latestIndex = allDates.length - 1, firstWindow = Math.max(0, allDates.length - (window + 1));
  let startIndex = firstWindow;
  const fresh = [];
  for (const c of candidates) {
    const overlap = [...c.prices.keys()].filter(d => benchmark.has(d)).sort();
    if (!overlap.length) {
      excluded.push(...repeatExcluded(c, "no_benchmark_overlap")); continue;
    }
    const last = overlap[overlap.length - 1], lag = latestIndex - allDates.indexOf(last);
    if (lag > 3) {
      excluded.push(...repeatExcluded(c, "stale_series", { staleBenchmarkSessions: lag, lastDate: last }));
      issues.push({ code: "stale_series", severity: "error", subject: c.symbol, staleBenchmarkSessions: lag, lastDate: last });
      continue;
    }
    startIndex = Math.max(startIndex, allDates.indexOf(overlap[0]));
    fresh.push(c);
  }
  candidates = fresh;
  if (!candidates.length) return invalid(input, "no_fresh_holdings", issues);
  let dates = allDates.slice(startIndex);
  if (dates.length > window + 1) dates = dates.slice(-(window + 1));
  const aligned = [];
  for (const c of candidates) {
    const missing = dates.filter(d => !c.prices.has(d));
    if (missing.length) {
      excluded.push(...repeatExcluded(c, "missing_benchmark_session_observation", { dates: missing.slice(0, 20) }));
      issues.push({ code: "missing_benchmark_session_observation", severity: "error", subject: c.symbol, count: missing.length });
    } else aligned.push(c);
  }
  candidates = aligned;
  if (!candidates.length) return invalid(input, "no_fully_aligned_holdings", issues);
  if (dates.length < 31) return invalid(input, "insufficient_common_history", issues);
  const br = dates.slice(1).map((d, i) => benchmark.get(d) / benchmark.get(dates[i]) - 1);
  if (br.some(x => !Number.isFinite(x) || x <= -1)) return invalid(input, "invalid_benchmark_return");
  const limit = input.market === "tw" ? 0.105 : 0.5;
  const badBm = br.findIndex(x => Math.abs(x) >= limit);
  if (badBm >= 0) return invalid(input, "extreme_benchmark_return",
    [{ code: "extreme_benchmark_return", severity: "error", date: dates[badBm + 1], return: br[badBm], threshold: limit }]);
  const usable = [];
  for (const c of candidates) {
    const r = dates.slice(1).map((d, i) => c.prices.get(d) / c.prices.get(dates[i]) - 1);
    if (r.some(x => !Number.isFinite(x) || x <= -1)) {
      excluded.push(...repeatExcluded(c, "invalid_return")); issues.push({ code: "invalid_return", severity: "error", subject: c.symbol }); continue;
    }
    const extreme = r.findIndex(x => Math.abs(x) >= limit);
    if (extreme >= 0) {
      excluded.push(...repeatExcluded(c, "extreme_return"));
      issues.push({ code: "extreme_return", severity: "error", subject: c.symbol, date: dates[extreme + 1], return: r[extreme], threshold: limit });
      continue;
    }
    let run = 0, maxRun = 0;
    for (const v of r) { run = v === 0 ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    if (maxRun >= 5) issues.push({ code: "possible_suspension_or_flat_price", severity: "warning", subject: c.symbol, consecutiveZeroReturnDays: maxRun });
    usable.push({ ...c, returns: r });
  }
  candidates = usable;
  if (!candidates.length) return invalid(input, "no_valid_return_series", issues);
  const includedMV = candidates.reduce((s, c) => s + c.marketValue, 0);
  if (!pos(includedMV) || !Number.isFinite(includedMV)) return invalid(input, "invalid_included_market_value", issues);
  const weights = candidates.map(c => c.marketValue / includedMV);
  const pr = br.map((_, i) => candidates.reduce((s, c, j) => s + weights[j] * c.returns[i], 0));
  if (pr.some(x => !Number.isFinite(x) || x <= -1)) return invalid(input, "invalid_portfolio_return", issues);
  const pm = moments(pr), bmom = moments(br), pv = pm.variance, bv = bmom.variance;
  if (![pm.mean, pv, bmom.mean, bv].every(Number.isFinite)) return invalid(input, "non_finite_moments", issues);
  const betaOf = r => bv > 0 ? cov(r, br) / bv : null, portfolioBeta = betaOf(pr);
  const am = candidates.map(c => moments(c.returns));
  const matrix = candidates.map((a, i) => candidates.map((b, j) => corr(a.returns, b.returns, am[i], am[j])));
  const pairs = [];
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++)
    pairs.push({ a: candidates[i].symbol, b: candidates[j].symbol, correlation: matrix[i][j] });
  const pairValues = pairs.map(p => p.correlation).filter(Number.isFinite);
  const rows = candidates.map((c, i) => {
    const contribution = pv > 0 ? weights[i] * cov(c.returns, pr) / pv : null;
    return { symbol: c.symbol, marketValue: c.marketValue, weight: weights[i],
      annualizedVolatility: am[i].variance === null ? null : Math.sqrt(am[i].variance * 252),
      beta: betaOf(c.returns), varianceContribution: contribution, riskContribution: contribution,
      riskContributionType: "portfolio_variance_share" };
  }).sort((a, b) => b.weight - a.weight);
  const tailP = 1 - confidence, enough = pr.length * tailP >= 5;
  const tailQ = enough ? quantile(pr, tailP) : null;
  if (!enough) issues.push({ code: "insufficient_var_sample", severity: "warning", observations: pr.length, confidenceLevel: confidence, expectedTailObservations: pr.length * tailP, minimumTailObservations: 5 });
  const varReturn = tailQ === null ? null : Math.max(0, -tailQ);
  const tail = tailQ === null ? [] : pr.filter(x => x <= tailQ);
  const esReturn = tail.length ? Math.max(0, -mean(tail)) : null;
  const worst = (a, field) => {
    if (a.length < 20) return null;
    let best = null;
    for (let i = 0; i + 20 <= a.length; i++) {
      const value = compound(a.slice(i, i + 20));
      if (!best || value < best[field]) best = { from: dates[i], to: dates[i + 20], [field]: value };
    }
    return best;
  };
  const hhi = weights.reduce((s, w) => s + w * w, 0), coverage = totalMV > 0 ? includedMV / totalMV : null;
  if (coverage !== null && coverage < 0.8) issues.push({ code: "low_market_value_coverage", severity: "warning", marketValueCoverage: coverage, threshold: 0.8 });
  if (excluded.length) issues.push({ code: "excluded_positions", severity: "warning", count: excluded.length });
  const shockReturn = portfolioBeta === null ? null : portfolioBeta * shock;
  const shockLoss = shockReturn === null ? null : Math.max(0, -shockReturn) * includedMV;
  if ((shockLoss !== null && !Number.isFinite(shockLoss)) || (coverage !== null && !Number.isFinite(coverage)))
    return invalid(input, "non_finite_risk_amount", issues);
  const status = excluded.length || issues.some(i => i.severity === "warning" || i.severity === "error") ? "partial" : "ready";
  return {
    schemaVersion: PORTFOLIO_RISK_VERSION, status, market: input.market,
    requestedAsOf: asOf, effectiveAsOf: dates[dates.length - 1], asOf: dates[dates.length - 1],
    methodology: { analysisType: "current_weights_historical_scenario", returnType: "adjusted_close",
      weightMode: "current_market_value_within_included_subportfolio", riskScope: "included_holdings_only",
      sessionCalendar: "benchmark_series_authoritative", missingSessionPolicy: "exclude_incomplete_holding",
      varMethod: "historical_simulation_linear_interpolated_quantile", confidenceLevel: confidence,
      varMinimumExpectedTailObservations: 5, holdingPeriodDays: 1, annualizationDays: 252,
      benchmarkShock: shock, extremeReturnThreshold: limit },
    coverage: { totalHoldings: input.holdings.length, includedHoldings: candidates.reduce((s, c) => s + c.sourceRows, 0),
      excludedHoldings: excluded.length, includedSymbols: candidates.length,
      excludedSymbols: new Set(excluded.map(x => x.symbol)).size, sourcePositionRows: input.holdings.length,
      totalMarketValue: totalMV, includedMarketValue: includedMV, excludedMarketValue: Math.max(0, totalMV - includedMV),
      marketValueCoverage: coverage, unvaluedHoldings: input.holdings.filter(h => !pos(h?.marketValue)).length,
      observations: pr.length, benchmarkSessions: dates.length, from: dates[0], to: dates[dates.length - 1] },
    metrics: { totalMarketValue: totalMV, includedMarketValue: includedMV,
      annualizedVolatility: pv === null ? null : Math.sqrt(pv * 252), beta: portfolioBeta,
      correlationMatrix: candidates.map((c, i) => ({ symbol: c.symbol, values: matrix[i] })), pairs,
      averagePairCorrelation: pairValues.length ? mean(pairValues) : null,
      pairCorrelationCount: pairValues.length, pairCount: pairs.length, hhi, effectiveHoldings: 1 / hhi, rows,
      tailReturnQuantile: tailQ, valueAtRiskReturn: varReturn,
      valueAtRiskAmount: varReturn === null ? null : varReturn * includedMV,
      expectedShortfallReturn: esReturn, expectedShortfallAmount: esReturn === null ? null : esReturn * includedMV,
      benchmarkWorst20Days: worst(br, "benchmarkReturn"), portfolioWorst20Days: worst(pr, "portfolioReturn"),
      benchmarkShockPortfolioReturn: shockReturn, benchmarkShockEstimatedLoss: shockLoss,
      benchmarkShockEstimatedLossScope: "included_holdings_only" },
    excluded, issues
  };
}
