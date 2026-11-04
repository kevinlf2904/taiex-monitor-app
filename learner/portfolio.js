/* 投資組合資料基礎（第 1 階段）：把庫存（舊版 kline:watch:hold）整理成統一格式，並逐筆標出資料狀態。純函式，不寫入任何存檔。
   延續 GPT PR #218 的檢查邏輯，修正它的問題：讀對存檔位置（kline:watch:hold）、範例持股要標出來、市場與資產類型先查股票清單（/api/stocks），查不到才依代號推測並標示「推測」。
   一筆持倉：代號、名稱、市場、幣別、資產類型、股數、平均成本、總成本、最新價格、最新市值、未實現損益與報酬率、價格日期與時間、資料狀態。
   資料狀態：valid（正常）、warning（可以用但有提醒）、incomplete（缺價格，算不出市值）、stale（價格比應有交易日舊）、invalid（股數或成本不對，不能用）。
   新的存檔位置 kline:pf:v1 只先定義；目前不寫入、不搬移、不刪除舊資料（要搬移時另外經使用者同意，見 docs/portfolio/DATA_CONTRACT.md）。
   瀏覽器裡是 window.KLPortfolio；測試用 node 的 vm 載入。 */
(function (root) {
  "use strict";
  const VERSION = 1, LEGACY_KEY = "kline:watch:hold", NEXT_KEY = "kline:pf:v1";
  const STATUSES = ["valid", "warning", "incomplete", "stale", "invalid"];
  const STATUS_LABEL = { valid: "正常", warning: "有提醒", incomplete: "缺價格", stale: "價格過期", invalid: "資料錯誤" };
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const posNum = v => { if (typeof v === "string" && !v.trim()) return null; const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
  const validDate = v => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === v; };
  const symbolOf = v => { const s = (typeof v === "string" || typeof v === "number") ? String(v).trim().toUpperCase() : ""; return s && s.length <= 16 && /^\^?[A-Z0-9][A-Z0-9.=_-]*$/.test(s) ? s : null; };
  const TW_RE = /^\d{4,6}[A-Z]?$/, TW_ETF_RE = /^00\d{2,4}[A-Z]?$/, FUT = new Set(["TXF"]);
  const US_ETF = new Set(["SPY", "QQQ", "VOO", "VTI", "SOXX", "TQQQ", "SOXL", "DIA", "IWM", "IVV", "VT", "SMH", "XLK", "SCHD", "VYM", "VEA", "VWO", "BND", "TLT", "IEF", "GLD", "ARKK"]);

  // 市場與資產類型：先查股票清單（[代號, 名稱, 上市／上櫃, 產業]）；查不到才依代號推測，並標 source: "heuristic"
  function classify(sym, master) {
    const m = master && master.get(sym);
    if (m) return { market: "tw", exchange: m.exchange === "上櫃" ? "tpex" : "twse", assetType: TW_ETF_RE.test(sym) ? "etf" : "stock", name: m.name || null, industry: m.industry || null, source: "master" };
    if (FUT.has(sym)) return { market: "tw", exchange: "taifex", assetType: "future", name: null, industry: null, source: "heuristic" };
    if (TW_RE.test(sym)) return { market: "tw", exchange: null, assetType: TW_ETF_RE.test(sym) ? "etf" : "stock", name: null, industry: null, source: "heuristic" };
    if (/^[A-Z][A-Z0-9]{0,5}([.-][A-Z]{1,3})?$/.test(sym)) return { market: "us", exchange: null, assetType: US_ETF.has(sym) ? "etf" : "stock", name: null, industry: null, source: "heuristic" };
    return { market: null, exchange: null, assetType: null, name: null, industry: null, source: "unknown" };
  }
  const masterOf = list => { const m = new Map(); (Array.isArray(list) ? list : []).forEach(r => { if (Array.isArray(r) && r[0]) m.set(String(r[0]).toUpperCase(), { name: r[1] || null, exchange: r[2] || null, industry: r[3] || null }); }); return m; };
  const CURRENCY = { tw: "TWD", us: "USD" };

  // 舊版庫存 { 代號: { sh, cost, d?, demo? } } → 統一格式。opts：master（/api/stocks 的 list）、quotes（Map 或物件：代號 → 報價）、expectedDate（{ tw, us }：應有的最新交易日）、names
  function normalizeHoldings(raw, opts = {}) {
    const issues = [], items = [], master = masterOf(opts.master), Q = opts.quotes, quoteOf = c => (Q && typeof Q.get === "function" ? Q.get(c) : Q ? Q[c] : null) || null;
    const exp = opts.expectedDate || {}, names = opts.names || {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { schemaVersion: VERSION, status: "invalid", items, issues: [{ code: "invalid_root", message: "庫存資料必須是以股票代號為鍵的物件" }], summary: summarize(items) };
    const seen = new Set();
    for (const key of Object.keys(raw)) {
      const row = raw[key], sym = symbolOf(key), why = [], warn = [];
      if (!sym) { items.push(bad(key, "invalid_symbol", "股票代號格式不正確")); continue; }
      if (seen.has(sym)) { items.push(bad(sym, "duplicate_symbol", "同一個代號出現兩次（大小寫不同），已略過後面那筆")); continue; }
      if (!row || typeof row !== "object" || Array.isArray(row)) { items.push(bad(sym, "invalid_row", "這筆資料格式不正確")); continue; }
      const shares = posNum(row.sh), avgCost = posNum(row.cost);
      if (shares === null) why.push(["invalid_shares", "股數要大於 0"]);
      if (avgCost === null) why.push(["invalid_cost", "平均成本要大於 0"]);
      if (why.length) { const it = bad(sym, why[0][0], why.map(w => w[1]).join("；")); it.isDemo = !!row.demo; items.push(it); continue; }
      seen.add(sym);
      const k = classify(sym, master);
      if (k.source === "heuristic") warn.push(["market_inferred", k.market === "us" ? "美股沒有代號清單，市場依代號格式推測" : "股票清單裡沒有這個代號，市場依代號格式推測"]);
      if (k.source === "unknown") warn.push(["market_unknown", "看不出是哪個市場"]);
      let openedAt = null;
      if (row.d != null && row.d !== "") { if (validDate(row.d)) openedAt = row.d; else warn.push(["invalid_opened_at", "建倉日期格式不對，已略過日期"]); }
      if (row.demo) warn.push(["demo", "這是範例持股，不是真實部位"]);
      const q = quoteOf(sym), price = q && posNum(q.price), priceDate = q && validDate(String(q.date || "").slice(0, 10)) ? String(q.date).slice(0, 10) : null;
      const costBasis = shares * avgCost, marketValue = price ? shares * price : null;
      let status = "valid";
      if (!price) status = "incomplete";
      else {
        const e = k.market && exp[k.market];
        if ((e && priceDate && priceDate < e) || (q && q.isStale === true)) status = "stale";
        if (price / avgCost > 50 || price / avgCost < 0.02) warn.push(["price_far_from_cost", "現價和成本差距超過 50 倍，可能是股票分割、減資或成本輸入錯誤"]);
      }
      if (status === "valid" && warn.length) status = "warning";
      items.push({
        symbol: sym, name: k.name || names[sym] || (q && q.name) || null, market: k.market, currency: k.market ? CURRENCY[k.market] : null, exchange: k.exchange, assetType: k.assetType, industry: k.industry, classifiedBy: k.source,
        shares, avgCost, costBasis, lastPrice: price || null, marketValue, unrealizedPnl: marketValue === null ? null : marketValue - costBasis, unrealizedPct: marketValue === null ? null : (marketValue - costBasis) / costBasis,
        priceDate, priceTime: q && q.time ? String(q.time) : null, priceSource: q && q.source ? String(q.source) : null, openedAt, isDemo: !!row.demo,
        status, issues: warn.map(([code, message]) => ({ code, message })).concat(status === "incomplete" ? [{ code: "missing_price", message: "還沒有報價，算不出市值" }] : status === "stale" ? [{ code: "stale_price", message: "報價日期比應有的交易日舊" + (priceDate ? "（" + priceDate + "）" : "") }] : [])
      });
    }
    return { schemaVersion: VERSION, status: items.length && items.every(i => i.status === "valid") ? "ready" : items.some(i => i.status !== "invalid") ? "partial" : items.length ? "invalid" : "empty", items, issues, summary: summarize(items) };
  }
  function bad(symbol, code, message) { return { symbol, name: null, market: null, currency: null, exchange: null, assetType: null, industry: null, classifiedBy: null, shares: null, avgCost: null, costBasis: null, lastPrice: null, marketValue: null, unrealizedPnl: null, unrealizedPct: null, priceDate: null, priceTime: null, priceSource: null, openedAt: null, isDemo: false, status: "invalid", issues: [{ code, message }] }; }
  // 統計：各狀態筆數；市值與成本「依幣別分開加總」，台幣和美元不相加；範例持股與不能用的不算
  function summarize(items) {
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0])), byCurrency = {};
    for (const it of items) {
      byStatus[it.status]++;
      if (it.status === "invalid" || it.isDemo || !it.currency) continue;
      const c = (byCurrency[it.currency] ||= { positions: 0, costBasis: 0, marketValue: 0, valuedPositions: 0 });
      c.positions++; c.costBasis += it.costBasis; if (it.marketValue !== null) { c.marketValue += it.marketValue; c.valuedPositions++; }
    }
    return { total: items.length, byStatus, byCurrency, demoCount: items.filter(i => i.isDemo).length };
  }
  // 只讀舊版存檔：storage 要有 getItem；讀不到、不是 JSON 都回報錯，不改動原始資料
  function readLegacy(storage) {
    if (!storage || typeof storage.getItem !== "function") return { ok: false, code: "no_storage", raw: null };
    let s; try { s = storage.getItem(LEGACY_KEY); } catch { return { ok: false, code: "storage_read_failed", raw: null }; }
    if (s == null || s === "") return { ok: true, raw: {} };
    try { return { ok: true, raw: JSON.parse(s) }; } catch { return { ok: false, code: "invalid_json", raw: null }; }
  }

  root.KLPortfolio = Object.freeze({ VERSION, LEGACY_KEY, NEXT_KEY, STATUSES, STATUS_LABEL, classify, normalizeHoldings, summarize, readLegacy });
})(typeof window !== "undefined" ? window : globalThis);
