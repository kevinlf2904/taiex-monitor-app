/* 交易紀錄引擎（投資組合第 4 階段 A）：交易格式、資料驗證、成本計算（加權平均／先進先出，一本帳只用一種）、已實現與未實現損益、
   股息、現金、股票轉入轉出、拆股合股、配股（除權）、手續費與交易稅規則（依市場設定，不寫死在計算裡）、舊庫存搬移預覽。
   純函式：不讀也不寫任何存檔、不輸出 console、不連網。畫面與「使用者確認後才寫入 kline:pf:v1」在下一個 PR（見 docs/portfolio/LEDGER.md）。
   瀏覽器裡是 window.KLLedger；測試用 node 的 vm 載入。 */
(function (root) {
  "use strict";
  const VERSION = 1, STORE_KEY = "kline:pf:v1", LEGACY_KEY = "kline:watch:hold";
  // 交易類型：買、賣、現金股息、配股（除權，拿到股票）、拆股／合股（ratio：一股變幾股，合股小於 1）、轉入、轉出、入金、出金、另計費用、其他公司行動
  const TYPES = ["buy", "sell", "dividend", "stock_dividend", "split", "transfer_in", "transfer_out", "deposit", "withdraw", "fee", "other"];
  const TYPE_LABEL = { buy: "買進", sell: "賣出", dividend: "現金股息", stock_dividend: "配股（除權）", split: "拆股／合股", transfer_in: "股票轉入", transfer_out: "股票轉出", deposit: "入金", withdraw: "出金", fee: "費用", other: "其他公司行動" };
  const NEEDS_SYMBOL = new Set(["buy", "sell", "dividend", "stock_dividend", "split", "transfer_in", "transfer_out", "other"]);
  const CORP_FIRST = new Set(["split", "stock_dividend", "other"]); // 同一天：公司行動（除權日開盤就生效）排在當天的買賣前面
  const CURRENCY = { tw: "TWD", us: "USD" };
  const METHODS = { avg: "加權平均成本", fifo: "先進先出（FIFO）" };
  // 預設費用規則：只是預設值，可整份換掉；每一項都有來源與日期。計算一律從 rules 讀，不在下面的程式裡寫費率
  const DEFAULT_RULES = {
    tw: { commission: 0.001425, discount: 1, minFee: 20, round: "floor", taxStock: 0.003, taxEtf: 0.001, taxDayTrade: 0.0015, dividendTax: 0,
      source: "證交所手續費上限 0.1425%、證券交易稅條例（股票 0.3%、ETF 0.1%、現股當沖 0.15%）；最低手續費 20 元是多數券商的做法，各券商不同", asOf: "2026-11-01" },
    us: { commission: 0, discount: 1, minFee: 0, round: "cent", secFee: 0, dividendTax: 0.3,
      source: "多數美國券商零佣金；台灣居民美股股息預扣 30%；SEC 規費費率常變動，預設 0，請依券商對帳單", asOf: "2026-11-01" }
  };
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const num = v => { if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null; const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN; return Number.isFinite(n) ? n : NaN; };
  const validDate = v => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === v; };
  const symbolOf = v => { const s = typeof v === "string" || typeof v === "number" ? String(v).trim().toUpperCase() : ""; return s && s.length <= 16 && /^\^?[A-Z0-9][A-Z0-9.=_-]*$/.test(s) ? s : null; };
  const r2 = v => Math.round(v * 100) / 100, EPS = 1e-9;

  // 手續費與交易稅估算（使用者沒填時才用）。assetType：stock／etf；dayTrade：現股當沖。回傳 { fee, tax }
  function estimateCosts(t, rules = DEFAULT_RULES) {
    const R = rules && rules[t.market]; if (!R || !(t.type === "buy" || t.type === "sell")) return { fee: 0, tax: 0 };
    const gross = t.shares * t.price, rd = v => (R.round === "floor" ? Math.floor(v + EPS) : r2(v));
    let fee = gross * (R.commission || 0) * (R.discount ?? 1); if (gross > 0) fee = Math.max(fee, R.minFee || 0); fee = rd(fee);
    let tax = 0;
    if (t.type === "sell") tax = t.market === "tw" ? rd(gross * (t.dayTrade ? R.taxDayTrade : t.assetType === "etf" ? R.taxEtf : R.taxStock)) : rd(gross * (R.secFee || 0));
    return { fee, tax };
  }

  // 一筆交易的格式檢查（不看前後文）：回傳 { tx（整理後）, errors, warnings }
  function checkTx(raw, opts = {}) {
    const errors = [], warnings = [], E = (code, msg) => errors.push({ code, message: msg }), Wn = (code, msg) => warnings.push({ code, message: msg });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { tx: null, errors: [{ code: "invalid_tx", message: "交易資料格式不正確" }], warnings };
    const type = TYPES.includes(raw.type) ? raw.type : null;
    if (!type) E("invalid_type", "交易類型不正確");
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null; if (!id) E("missing_id", "缺少交易編號");
    const date = validDate(raw.date) ? raw.date : null;
    if (!date) E("invalid_date", "交易日期格式不對或不存在");
    else { if (opts.today && date > opts.today) E("future_date", "交易日期在未來"); if (date < "1990-01-01") E("date_too_old", "交易日期早於 1990 年，請確認"); }
    const symbol = raw.symbol == null || raw.symbol === "" ? null : symbolOf(raw.symbol);
    if (type && NEEDS_SYMBOL.has(type) && !symbol) E("invalid_symbol", "股票代號格式不正確");
    const market = raw.market === "tw" || raw.market === "us" ? raw.market : null;
    if (!market) E("invalid_market", "市場要是台股（tw）或美股（us）");
    const currency = raw.currency === "TWD" || raw.currency === "USD" ? raw.currency : null;
    if (!currency) E("invalid_currency", "幣別要是 TWD 或 USD");
    else if (market && CURRENCY[market] !== currency) E("currency_mismatch", `${market === "tw" ? "台股" : "美股"}的幣別應該是 ${CURRENCY[market]}`);
    const shares = num(raw.shares), price = num(raw.price), amount = num(raw.amount), ratio = num(raw.ratio);
    let fee = num(raw.fee), tax = num(raw.tax);
    const needShares = ["buy", "sell", "stock_dividend", "transfer_in", "transfer_out"].includes(type);
    if (needShares && !(isNum(shares) && shares > 0)) E("invalid_shares", "股數要大於 0");
    if (needShares && isNum(shares) && shares > 0 && market === "tw" && !Number.isInteger(shares)) E("fractional_shares", "台股股數要是整數");
    if ((type === "buy" || type === "sell") && !(isNum(price) && price > 0)) E("invalid_price", "成交價格要大於 0");
    if (type === "transfer_in" && !(isNum(price) && price >= 0)) E("invalid_price", "轉入要填每股成本（可以是 0）");
    if (["dividend", "deposit", "withdraw", "fee"].includes(type) && !(isNum(amount) && amount > 0)) E("invalid_amount", "金額要大於 0");
    if (type === "split" && !(isNum(ratio) && ratio > 0 && ratio !== 1)) E("invalid_ratio", "拆股／合股比例要大於 0 且不是 1（一拆四填 4，五合一填 0.2）");
    if (type === "other" && !(isNum(shares) || isNum(amount))) E("invalid_other", "其他公司行動至少要填股數變動或金額");
    for (const [k, v] of [["fee", fee], ["tax", tax]]) if (Number.isNaN(v) || (isNum(v) && v < 0)) E("invalid_" + k, (k === "fee" ? "手續費" : "交易稅") + "不能是負數");
    const tx = { v: VERSION, id, date, type, symbol, market, currency, shares: isNum(shares) ? shares : null, price: isNum(price) ? price : null, amount: isNum(amount) ? amount : null, ratio: isNum(ratio) ? ratio : null,
      fee: isNum(fee) ? fee : null, tax: isNum(tax) ? tax : null, feeEstimated: false, assetType: raw.assetType === "etf" || raw.assetType === "stock" ? raw.assetType : null, dayTrade: !!raw.dayTrade,
      ref: typeof raw.ref === "string" && raw.ref ? raw.ref : null, note: typeof raw.note === "string" ? raw.note.slice(0, 500) : "", source: typeof raw.source === "string" && raw.source ? raw.source.slice(0, 40) : "manual" };
    // 沒填手續費／稅：依規則估算並標示「估算」（填 0 代表真的是 0，不會被估算覆蓋）
    if (!errors.length && (type === "buy" || type === "sell") && (tx.fee === null || tx.tax === null)) {
      if (!tx.assetType) tx.assetType = market === "tw" && /^00\d{2,4}[A-Z]?$/.test(symbol) ? "etf" : "stock";
      const est = estimateCosts(tx, opts.rules || DEFAULT_RULES);
      if (tx.fee === null) tx.fee = est.fee; if (tx.tax === null) tx.tax = est.tax; tx.feeEstimated = true;
      Wn("fee_estimated", "手續費或交易稅沒填，依費用規則估算");
    }
    if (type === "dividend" && tx.tax === null) tx.tax = 0;
    if (tx.fee === null) tx.fee = 0; if (tx.tax === null) tx.tax = 0;
    return { tx, errors, warnings };
  }

  // 整本帳：依日期排序（同一天公司行動先、其他照輸入順序），逐筆套用；錯誤的交易不套用並列出原因。
  // opts：method（avg／fifo，整本帳一種）、today、rules、prices（代號 → 現價，Map 或物件）
  function buildLedger(list, opts = {}) {
    const method = opts.method === "fifo" ? "fifo" : opts.method == null || opts.method === "avg" ? "avg" : null;
    if (!method) return { v: VERSION, status: "invalid", method: null, error: "invalid_method", positions: [], cash: {}, totals: {}, txs: [] };
    const P = opts.prices, priceOf = c => { const v = P && typeof P.get === "function" ? P.get(c) : P ? P[c] : null; return isNum(v) && v > 0 ? v : null; };
    const rows = (Array.isArray(list) ? list : []).map((raw, i) => ({ i, raw, ...checkTx(raw, opts) }));
    // 重複：同一個編號 → 錯誤；內容完全一樣（日期、類型、代號、股數、價格、金額、費用）→ 提醒，可能重複輸入
    const ids = new Map(), sig = new Map();
    for (const r of rows) {
      if (!r.tx) continue; const t = r.tx;
      if (t.id) { if (ids.has(t.id)) r.errors.push({ code: "duplicate_id", message: "交易編號重複，已略過後面那筆" }); else ids.set(t.id, r); }
      const s = [t.date, t.type, t.symbol, t.shares, t.price, t.amount, t.ratio, r.raw.fee ?? "", r.raw.tax ?? ""].join("|");
      if (sig.has(s)) r.warnings.push({ code: "possible_duplicate", message: "和另一筆交易內容完全一樣，請確認不是重複輸入" }); else sig.set(s, r);
    }
    // 另計費用（fee）掛在某筆買賣上（ref），而那筆已經有手續費 → 重複計算
    for (const r of rows) { const t = r.tx; if (!t || t.type !== "fee" || !t.ref) continue; const o = ids.get(t.ref);
      if (!o || !o.tx) r.errors.push({ code: "ref_not_found", message: "這筆費用對應的交易找不到" });
      else if ((o.tx.type === "buy" || o.tx.type === "sell") && o.tx.fee > 0 && !o.tx.feeEstimated) r.errors.push({ code: "duplicate_fee", message: "對應的交易已經有手續費，不能再另外記一次" });
      else if ((o.tx.type === "buy" || o.tx.type === "sell") && o.tx.feeEstimated) { o.tx.fee = 0; o.tx.tax = 0; o.warnings = o.warnings.filter(w => w.code !== "fee_estimated"); } } // 費用另外記了，原交易就不要再估算
    // 同一個代號只能有一個市場、一個幣別
    const symMkt = new Map();
    for (const r of rows) { const t = r.tx; if (!t || !t.symbol || r.errors.length) continue; const k = symMkt.get(t.symbol);
      if (!k) symMkt.set(t.symbol, t.market + "/" + t.currency); else if (k !== t.market + "/" + t.currency) r.errors.push({ code: "currency_conflict", message: "同一個代號前後的市場或幣別不一樣" }); }
    const order = rows.slice().sort((a, b) => { const da = a.tx?.date || "9999", db = b.tx?.date || "9999"; if (da !== db) return da < db ? -1 : 1;
      const ca = CORP_FIRST.has(a.tx?.type) ? 0 : 1, cb = CORP_FIRST.has(b.tx?.type) ? 0 : 1; return ca - cb || a.i - b.i; });
    const pos = new Map(), cash = {}, totals = {};
    const C = cur => (cash[cur] ||= { balance: 0, deposits: 0, withdrawals: 0, tracked: false }), T = cur => (totals[cur] ||= { realizedPnl: 0, dividends: 0, fees: 0, taxes: 0, bought: 0, sold: 0 });
    const posOf = t => { let p = pos.get(t.symbol); if (!p) pos.set(t.symbol, p = { symbol: t.symbol, market: t.market, currency: t.currency, shares: 0, costBasis: 0, lots: [], realizedPnl: 0, dividends: 0, fees: 0, taxes: 0, firstDate: t.date, history: [] }); return p; };
    const snap = (p, t, extra = {}) => p.history.push({ date: t.date, id: t.id, type: t.type, shares: p.shares, costBasis: r2(p.costBasis), avgCost: p.shares > EPS ? p.costBasis / p.shares : null, ...extra });
    // 從部位拿掉 n 股，回傳拿掉的成本（加權平均：按比例；FIFO：從最早的批次）
    const take = (p, n) => {
      if (method === "avg") { const c = p.shares > EPS ? p.costBasis * n / p.shares : 0; p.shares -= n; p.costBasis -= c; if (p.shares < EPS) { p.shares = 0; p.costBasis = 0; } return c; }
      let left = n, c = 0;
      while (left > EPS && p.lots.length) { const L = p.lots[0], k = Math.min(L.shares, left), lc = L.cost * k / L.shares; c += lc; L.cost -= lc; L.shares -= k; left -= k; if (L.shares < EPS) p.lots.shift(); }
      p.shares -= n; p.costBasis -= c; if (p.shares < EPS) { p.shares = 0; p.costBasis = 0; p.lots = []; } return c;
    };
    const add = (p, n, cost, t) => { p.shares += n; p.costBasis += cost; if (method === "fifo") p.lots.push({ date: t.date, id: t.id, shares: n, cost }); };
    for (const r of order) {
      const t = r.tx; if (!t || r.errors.length) continue;
      const cur = t.currency, p = t.symbol ? posOf(t) : null;
      if (t.type === "buy") { const cost = t.shares * t.price + t.fee + t.tax; add(p, t.shares, cost, t); p.fees += t.fee; p.taxes += t.tax; C(cur).balance -= cost; const S = T(cur); S.fees += t.fee; S.taxes += t.tax; S.bought += t.shares * t.price; snap(p, t); }
      else if (t.type === "sell") {
        if (t.shares > p.shares + EPS) { r.errors.push({ code: "oversell", message: `賣出 ${t.shares} 股，但當時只持有 ${+p.shares.toFixed(6)} 股` }); continue; }
        const proceeds = t.shares * t.price - t.fee - t.tax, cost = take(p, t.shares), pnl = proceeds - cost;
        p.realizedPnl += pnl; p.fees += t.fee; p.taxes += t.tax; C(cur).balance += proceeds; const S = T(cur); S.realizedPnl += pnl; S.fees += t.fee; S.taxes += t.tax; S.sold += t.shares * t.price; snap(p, t, { realized: r2(pnl) });
      }
      else if (t.type === "dividend") { const net = t.amount - t.tax; p.dividends += net; p.taxes += t.tax; C(cur).balance += net; const S = T(cur); S.dividends += net; S.taxes += t.tax;
        if (p.shares < EPS) r.warnings.push({ code: "dividend_without_position", message: "領股息時沒有持股（賣出後才發放的話可以忽略）" }); snap(p, t, { dividend: r2(net) }); }
      else if (t.type === "stock_dividend") { if (p.shares < EPS) r.warnings.push({ code: "stock_dividend_without_position", message: "配股時沒有持股" }); add(p, t.shares, 0, t); snap(p, t); } // 配股成本 0，平均成本下降
      else if (t.type === "split") {
        if (p.shares < EPS) { r.warnings.push({ code: "split_without_position", message: "拆股／合股時沒有持股，不影響" }); continue; }
        p.shares *= t.ratio; p.lots.forEach(L => { L.shares *= t.ratio; });
        if (t.market === "tw" && Math.abs(p.shares - Math.round(p.shares)) > 1e-6) r.warnings.push({ code: "fractional_after_split", message: "合股後有不足一股的部分，券商通常會退回現金，請另外記一筆" });
        snap(p, t);
      }
      else if (t.type === "transfer_in") { add(p, t.shares, t.shares * t.price + t.fee, t); p.fees += t.fee; T(cur).fees += t.fee; snap(p, t); } // 外部轉入：不動現金，成本用填的每股成本
      else if (t.type === "transfer_out") {
        if (t.shares > p.shares + EPS) { r.errors.push({ code: "over_transfer", message: `轉出 ${t.shares} 股，但當時只持有 ${+p.shares.toFixed(6)} 股` }); continue; }
        take(p, t.shares); snap(p, t);
      }
      else if (t.type === "deposit") { const c = C(cur); c.balance += t.amount; c.deposits += t.amount; c.tracked = true; }
      else if (t.type === "withdraw") { const c = C(cur); c.balance -= t.amount; c.withdrawals += t.amount; c.tracked = true; }
      else if (t.type === "fee") { C(cur).balance -= t.amount; T(cur).fees += t.amount; if (p) { p.fees += t.amount; } else if (t.ref && ids.get(t.ref)?.tx?.symbol) { const q = pos.get(ids.get(t.ref).tx.symbol); if (q) q.fees += t.amount; } }
      else if (t.type === "other") {
        if (isNum(t.shares) && t.shares < 0 && -t.shares > p.shares + EPS) { r.errors.push({ code: "oversell", message: "股數減少超過持有數量" }); continue; }
        if (isNum(t.shares) && t.shares > 0) add(p, t.shares, 0, t); else if (isNum(t.shares) && t.shares < 0) take(p, -t.shares);
        if (isNum(t.amount)) { C(cur).balance += t.amount; }
        r.warnings.push({ code: "other_action", message: "其他公司行動：成本與損益依填的內容處理，請確認" }); snap(p, t);
      }
      r.applied = true;
    }
    for (const c of Object.values(cash)) if (c.tracked && c.balance < -0.005) c.negative = true;
    const positions = [...pos.values()].map(p => { const price = priceOf(p.symbol), mv = price != null && p.shares > EPS ? p.shares * price : p.shares > EPS ? null : 0;
      return { symbol: p.symbol, market: p.market, currency: p.currency, shares: +p.shares.toFixed(6), costBasis: r2(p.costBasis), avgCost: p.shares > EPS ? p.costBasis / p.shares : null,
        lastPrice: price, marketValue: mv == null ? null : r2(mv), unrealizedPnl: mv == null ? null : r2(mv - p.costBasis), realizedPnl: r2(p.realizedPnl), dividends: r2(p.dividends), fees: r2(p.fees), taxes: r2(p.taxes),
        open: p.shares > EPS, lots: method === "fifo" ? p.lots.map(L => ({ date: L.date, id: L.id, shares: +L.shares.toFixed(6), cost: r2(L.cost) })) : null, firstDate: p.firstDate, history: p.history }; })
      .sort((a, b) => (b.open - a.open) || a.symbol.localeCompare(b.symbol));
    for (const S of Object.values(totals)) for (const k of Object.keys(S)) S[k] = r2(S[k]);
    for (const c of Object.values(cash)) { c.balance = r2(c.balance); c.deposits = r2(c.deposits); c.withdrawals = r2(c.withdrawals); }
    const txs = rows.map(r => ({ index: r.i, id: r.tx?.id ?? null, tx: r.tx, applied: !!r.applied, errors: r.errors, warnings: r.warnings }));
    const bad = txs.filter(x => x.errors.length).length;
    return { v: VERSION, method, methodLabel: METHODS[method], status: !txs.length ? "empty" : bad ? "has_errors" : "ok", errorCount: bad, positions, cash, totals, txs };
  }

  // 新增交易前的檢查：把 tx 加進現有交易後重算，回傳這筆的錯誤與提醒（不改動傳進來的陣列）
  function previewAdd(list, tx, opts = {}) { const L = buildLedger([...(Array.isArray(list) ? list : []), tx], opts), me = L.txs[L.txs.length - 1]; return { ok: !me.errors.length, errors: me.errors, warnings: me.warnings, ledger: L }; }
  // 刪除交易的影響範圍：同一代號、在它之後的交易有哪些會改變（成本、已實現損益），以及刪掉後會不會出現賣超
  function deleteImpact(list, id, opts = {}) {
    const arr = Array.isArray(list) ? list : [], t = arr.find(x => x && x.id === id); if (!t) return { ok: false, code: "not_found" };
    const before = buildLedger(arr, opts), after = buildLedger(arr.filter(x => x !== t), opts);
    const affected = t.symbol ? arr.filter(x => x && x !== t && symbolOf(x.symbol) === symbolOf(t.symbol) && String(x.date) >= String(t.date)).map(x => x.id) : [];
    const newErrors = after.txs.filter(x => x.errors.length && !before.txs.find(y => y.id === x.id && y.errors.length)).map(x => ({ id: x.id, errors: x.errors }));
    const pb = before.positions.find(p => p.symbol === symbolOf(t.symbol)), pa = after.positions.find(p => p.symbol === symbolOf(t.symbol));
    return { ok: true, affected, newErrors, position: t.symbol ? { before: pb ? { shares: pb.shares, costBasis: pb.costBasis, realizedPnl: pb.realizedPnl } : null, after: pa ? { shares: pa.shares, costBasis: pa.costBasis, realizedPnl: pa.realizedPnl } : null } : null };
  }

  // 新交易：補編號與版本（id 由呼叫端或 crypto 產生）
  function makeTx(fields, opts = {}) {
    const id = opts.id || (root.crypto && typeof root.crypto.randomUUID === "function" ? root.crypto.randomUUID() : "tx-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
    return { ...fields, v: VERSION, id };
  }

  // 舊庫存 { 代號: { sh, cost, d?, demo? } } → 搬移預覽：每筆變成一筆「股票轉入」（成本＝當時記的平均成本），範例持股與錯誤資料不搬。
  // 只產生預覽，不寫入；store 是確認後要寫進 kline:pf:v1 的內容。opts：today（沒有建倉日期時用）、market(symbol)（判斷台股美股）、now
  function previewMigration(raw, opts = {}) {
    const items = [], txs = [], today = validDate(opts.today) ? opts.today : null, mk = typeof opts.market === "function" ? opts.market : (s => (/^\d{4,6}[A-Z]?$/.test(s) ? "tw" : /^[A-Z][A-Z0-9]{0,5}([.-][A-Z]{1,3})?$/.test(s) ? "us" : null));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_root", items, store: null };
    const seen = new Set(); let k = 0;
    for (const key of Object.keys(raw)) {
      const row = raw[key], sym = symbolOf(key), it = { key, symbol: sym, action: "skip", problems: [] };
      items.push(it);
      if (!sym) { it.problems.push({ code: "invalid_symbol", message: "股票代號格式不正確" }); continue; }
      if (seen.has(sym)) { it.problems.push({ code: "duplicate_symbol", message: "同一個代號出現兩次（大小寫不同）" }); continue; }
      if (!row || typeof row !== "object") { it.problems.push({ code: "invalid_row", message: "這筆資料格式不正確" }); continue; }
      if (row.demo) { it.problems.push({ code: "demo", message: "範例持股不搬移" }); continue; }
      const sh = num(row.sh), cost = num(row.cost), market = mk(sym);
      if (!(isNum(sh) && sh > 0)) it.problems.push({ code: "invalid_shares", message: "股數要大於 0" });
      if (!(isNum(cost) && cost > 0)) it.problems.push({ code: "invalid_cost", message: "平均成本要大於 0" });
      if (!market) it.problems.push({ code: "market_unknown", message: "看不出是台股還是美股" });
      if (it.problems.length) continue;
      seen.add(sym);
      const hasDate = validDate(row.d) && (!today || row.d <= today), date = hasDate ? row.d : today;
      if (!date) { it.problems.push({ code: "no_date", message: "沒有建倉日期，也沒有今天的日期可用" }); continue; }
      const tx = { v: VERSION, id: opts.idPrefix ? `${opts.idPrefix}${++k}` : makeTx({}).id, date, type: "transfer_in", symbol: sym, market, currency: CURRENCY[market], shares: sh, price: cost, fee: 0, tax: 0,
        note: "從舊庫存轉入：成本是當時記的平均成本（可能已含手續費）" + (hasDate ? "" : "；原本沒有建倉日期，先用搬移當天"), source: "legacy" };
      it.action = "migrate"; it.tx = tx; if (!hasDate) it.problems.push({ code: "date_assumed", message: "沒有建倉日期，先用搬移當天，之後可以修改" });
      txs.push(tx);
    }
    const check = buildLedger(txs, { today: today || undefined });
    return { ok: check.errorCount === 0, items, summary: { migrate: txs.length, skip: items.length - txs.length },
      store: { v: VERSION, method: "avg", transactions: txs, migratedFrom: LEGACY_KEY, at: opts.now || null } };
  }

  // kline:pf:v1 存檔的一致性檢查（寫入前、讀出後都要跑）：版本、成本方法、編號唯一、每筆交易都能套用
  function validateStore(s, opts = {}) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, code: "invalid_root" };
    if (s.v !== VERSION) return { ok: false, code: "unsupported_version", v: s.v };
    if (s.method !== "avg" && s.method !== "fifo") return { ok: false, code: "invalid_method" };
    if (!Array.isArray(s.transactions)) return { ok: false, code: "invalid_transactions" };
    const L = buildLedger(s.transactions, { ...opts, method: s.method });
    return { ok: L.errorCount === 0, code: L.errorCount ? "has_errors" : "ok", errors: L.txs.filter(x => x.errors.length).map(x => ({ index: x.index, id: x.id, errors: x.errors })), ledger: L };
  }

  root.KLLedger = Object.freeze({ VERSION, STORE_KEY, LEGACY_KEY, TYPES, TYPE_LABEL, METHODS, DEFAULT_RULES, estimateCosts, checkTx, buildLedger, previewAdd, deleteImpact, makeTx, previewMigration, validateStore });
})(typeof window !== "undefined" ? window : globalThis);
