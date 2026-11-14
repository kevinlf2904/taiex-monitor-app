/* 交易紀錄引擎（投資組合第 4 階段 A）：交易格式、資料驗證、成本計算（加權平均／先進先出，一本帳只用一種）、已實現與未實現損益、
   股息、現金、股票轉入轉出、拆股合股、配股（除權）、手續費與交易稅規則（依市場設定，不寫死在計算裡）、舊庫存搬移預覽。
   純函式：不讀也不寫任何存檔、不輸出 console、不連網。畫面與「使用者確認後才寫入 kline:pf:v1」在下一個 PR（見 docs/portfolio/LEDGER.md）。
   瀏覽器裡是 window.KLLedger；測試用 node 的 vm 載入。 */
(function (root) {
  "use strict";
  const VERSION = 1, STORE_KEY = "kline:pf:v1", LEGACY_KEY = "kline:watch:hold";
  // 交易類型：買、賣、現金股息、配股（除權，拿到股票）、拆股／合股（ratio：一股變幾股，合股小於 1）、零股現金結算（合股後不足一股的部分換成現金）、
  // 轉入、轉出、入金、出金、另計費用、其他公司行動
  const TYPES = ["buy", "sell", "dividend", "stock_dividend", "split", "fraction_cash", "transfer_in", "transfer_out", "deposit", "withdraw", "fee", "other"];
  const TYPE_LABEL = { buy: "買進", sell: "賣出", dividend: "現金股息", stock_dividend: "配股（除權）", split: "拆股／合股", fraction_cash: "零股現金結算", transfer_in: "股票轉入", transfer_out: "股票轉出", deposit: "入金", withdraw: "出金", fee: "費用", other: "其他公司行動" };
  const NEEDS_SYMBOL = new Set(["buy", "sell", "dividend", "stock_dividend", "split", "fraction_cash", "transfer_in", "transfer_out"]); // other：只有金額（例如現金補償）時可以不填代號
  const CORP_FIRST = new Set(["split", "stock_dividend", "other"]); // 同一天：公司行動（除權日開盤就生效）排在當天的買賣前面
  const CURRENCY = { tw: "TWD", us: "USD" };
  const METHODS = { avg: "加權平均成本", fifo: "先進先出（FIFO）" };
  // 預設費用規則：只是預設值，可整份換掉；每一項都有來源與日期。計算一律從 rules 讀，不在下面的程式裡寫費率
  const DEFAULT_RULES = {
    tw: { commission: 0.001425, discount: 1, discountBuy: null, discountSell: null, minFee: 20, round: "floor", taxStock: 0.003, taxEtf: 0.001, taxBondEtf: 0, taxDayTrade: 0.0015, dividendTax: 0,
      source: "證交所手續費上限 0.1425%、證券交易稅條例（股票 0.3%、ETF 0.1%、現股當沖 0.15%）；債券 ETF 證交稅停徵（到期日以法令公告為準，請自行確認）；最低手續費 20 元是多數券商的做法，各券商不同；買賣可設不同折扣（discountBuy、discountSell）", asOf: "2026-11-01" },
    us: { commission: 0, discount: 1, discountBuy: null, discountSell: null, minFee: 0, round: "cent", secFee: 0, dividendTax: 0.3,
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
    const disc = (t.type === "buy" ? R.discountBuy : R.discountSell) ?? R.discount ?? 1;
    let fee = gross * (R.commission || 0) * disc; if (gross > 0) fee = Math.max(fee, R.minFee || 0); fee = rd(fee);
    let tax = 0;
    if (t.type === "sell") tax = t.market === "tw" ? rd(gross * (t.dayTrade ? R.taxDayTrade : t.assetType === "bond_etf" ? (R.taxBondEtf ?? R.taxEtf) : t.assetType === "etf" ? R.taxEtf : R.taxStock)) : rd(gross * (R.secFee || 0));
    return { fee, tax };
  }
  // 實際費用和規則估算的差距（使用者填了實際手續費、稅時，看看券商收的和預設規則差多少）
  function feeDiff(t, rules = DEFAULT_RULES) { if (!t || !(t.type === "buy" || t.type === "sell") || !isNum(t.fee) || !isNum(t.tax)) return null; const e = estimateCosts(t, rules); return { estFee: e.fee, estTax: e.tax, fee: t.fee, tax: t.tax, diffFee: r2(t.fee - e.fee), diffTax: r2(t.tax - e.tax) }; }

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
    const needShares = ["buy", "sell", "stock_dividend", "fraction_cash", "transfer_in", "transfer_out"].includes(type);
    if (needShares && !(isNum(shares) && shares > 0)) E("invalid_shares", "股數要大於 0");
    if (needShares && type !== "fraction_cash" && isNum(shares) && shares > 0 && market === "tw" && !Number.isInteger(shares)) E("fractional_shares", "台股股數要是整數");
    if (type === "fraction_cash" && !(isNum(amount) && amount >= 0)) E("invalid_amount", "零股結算要填拿到的現金（沒有就填 0）");
    if ((type === "buy" || type === "sell") && !(isNum(price) && price > 0)) E("invalid_price", "成交價格要大於 0");
    if (type === "transfer_in" && !(isNum(price) && price >= 0)) E("invalid_price", "轉入要填每股成本（可以是 0）");
    if (["dividend", "deposit", "withdraw", "fee"].includes(type) && !(isNum(amount) && amount > 0)) E("invalid_amount", "金額要大於 0");
    if (type === "split" && !(isNum(ratio) && ratio > 0 && ratio !== 1)) E("invalid_ratio", "拆股／合股比例要大於 0 且不是 1（一拆四填 4，五合一填 0.2）");
    if (type === "other" && !(isNum(shares) || isNum(amount))) E("invalid_other", "其他公司行動至少要填股數變動或金額");
    if (type === "other" && isNum(shares) && !symbol) E("invalid_symbol", "有股數變動的公司行動要填股票代號");
    if (type === "stock_dividend" && raw.ratio != null && !(isNum(ratio) && ratio > 0)) E("invalid_ratio", "配股率要大於 0（每股配幾股，例如配 1 元股票股利＝0.1）");
    for (const [k, v] of [["fee", fee], ["tax", tax]]) if (Number.isNaN(v) || (isNum(v) && v < 0)) E("invalid_" + k, (k === "fee" ? "手續費" : "交易稅") + "不能是負數");
    const tx = { v: VERSION, id, date, type, symbol, market, currency, shares: isNum(shares) ? shares : null, price: isNum(price) ? price : null, amount: isNum(amount) ? amount : null, ratio: isNum(ratio) ? ratio : null,
      fee: isNum(fee) ? fee : null, tax: isNum(tax) ? tax : null, feeEstimated: false, assetType: ["etf", "stock", "bond_etf"].includes(raw.assetType) ? raw.assetType : null, dayTrade: !!raw.dayTrade,
      ref: typeof raw.ref === "string" && raw.ref ? raw.ref : null, note: typeof raw.note === "string" ? raw.note.slice(0, 500) : "", source: typeof raw.source === "string" && raw.source ? raw.source.slice(0, 40) : "manual" };
    // 沒填手續費／稅：依規則估算並標示「估算」（填 0 代表真的是 0，不會被估算覆蓋）
    // 買進不收交易稅（台股證交稅、美股 SEC 費都只在賣出）：空白直接記 0，不算「估算」、不用再確認
    if (!errors.length && type === "buy" && tx.tax === null) tx.tax = 0;
    if (!errors.length && (type === "buy" || type === "sell") && (tx.fee === null || tx.tax === null)) {
      if (!tx.assetType) tx.assetType = market === "tw" && /^00\d{2,4}B$/.test(symbol) ? "bond_etf" : market === "tw" && /^00\d{2,4}[A-Z]?$/.test(symbol) ? "etf" : "stock"; // 00679B 這類尾碼 B 的是債券 ETF：證交稅 0（和 analysis.js 的 taxOf 同一條規則，#262 NEW-05）
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
    // 另計費用（fee）掛在某筆交易上（ref）：
    //   對應的買賣已經有手續費 → 重複計算，擋下；原交易的手續費是估算的 → 不再估算。
    //   對應買賣的費用併進那筆交易（買進算進成本、賣出從已實現損益扣），和日期先後無關；其他交易的費用記在那一檔
    for (const r of rows) { const t = r.tx; if (!t || t.type !== "fee" || !t.ref || r.errors.length) continue; const o = ids.get(t.ref);
      if (!o || !o.tx || o.errors.length) { r.errors.push({ code: "ref_not_found", message: "這筆費用對應的交易找不到，或那筆交易有錯誤" }); continue; }
      if (o.tx.currency !== t.currency) { r.errors.push({ code: "currency_mismatch", message: "費用的幣別和對應的交易不同" }); continue; }
      const trade = o.tx.type === "buy" || o.tx.type === "sell";
      if (trade && (o.tx.fee > 0 || o.tx.tax > 0) && !o.tx.feeEstimated) { r.errors.push({ code: "duplicate_fee", message: "對應的交易已經有手續費或交易稅，不能再另外記一次" }); continue; }
      if (trade && o.tx.feeEstimated) { o.tx.fee = 0; o.tx.tax = 0; o.tx.feeEstimated = false; o.warnings = o.warnings.filter(w => w.code !== "fee_estimated"); }
      if (trade) { if (o.extraFee) { r.errors.push({ code: "duplicate_fee", message: "這筆交易已經有另一筆另計費用" }); continue; } o.extraFee = t.amount; o.tx.fee += t.amount; r.mergedInto = o.tx.id; }
      else r.feeSymbol = o.tx.symbol;
      if (t.date !== o.tx.date) r.warnings.push({ code: "fee_date_differs", message: `費用日期和對應的交易（${o.tx.date}）不同` }); }
    // 同一個代號只能有一個市場、一個幣別
    const symMkt = new Map();
    for (const r of rows) { const t = r.tx; if (!t || !t.symbol || r.errors.length) continue; const k = symMkt.get(t.symbol);
      if (!k) symMkt.set(t.symbol, t.market + "/" + t.currency); else if (k !== t.market + "/" + t.currency) r.errors.push({ code: "currency_conflict", message: "同一個代號前後的市場或幣別不一樣" }); }
    const order = rows.slice().sort((a, b) => { const da = a.tx?.date || "9999", db = b.tx?.date || "9999"; if (da !== db) return da < db ? -1 : 1;
      const ca = CORP_FIRST.has(a.tx?.type) ? 0 : 1, cb = CORP_FIRST.has(b.tx?.type) ? 0 : 1; return ca - cb || a.i - b.i; });
    const pos = new Map(), cash = {}, totals = {};
    const C = cur => (cash[cur] ||= { balance: 0, deposits: 0, withdrawals: 0, tracked: false }), T = cur => (totals[cur] ||= { realizedPnl: 0, dividends: 0, fees: 0, taxes: 0, bought: 0, sold: 0 });
    const posOf = (t, sym = t.symbol) => { let p = pos.get(sym); if (!p) pos.set(sym, p = { symbol: sym, market: t.market, currency: t.currency, shares: 0, costBasis: 0, lots: [], realizedPnl: 0, dividends: 0, fees: 0, taxes: 0, firstDate: t.date, history: [], fraction: 0 }); return p; };
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
      if (r.mergedInto) { r.applied = true; continue; } // 已經併進對應的買賣（成本或已實現損益裡）
      const cur = t.currency, p = t.symbol ? posOf(t) : r.feeSymbol ? posOf(t, r.feeSymbol) : null;
      if (t.type === "buy") { const cost = t.shares * t.price + t.fee + t.tax; add(p, t.shares, cost, t); p.fees += t.fee; p.taxes += t.tax; C(cur).balance -= cost; const S = T(cur); S.fees += t.fee; S.taxes += t.tax; S.bought += t.shares * t.price; snap(p, t); }
      else if (t.type === "sell") {
        if (t.shares > p.shares + EPS) { r.errors.push({ code: "oversell", message: `賣出 ${t.shares} 股，但當時只持有 ${+p.shares.toFixed(6)} 股` }); continue; }
        const proceeds = t.shares * t.price - t.fee - t.tax, cost = take(p, t.shares), pnl = proceeds - cost;
        p.realizedPnl += pnl; p.fees += t.fee; p.taxes += t.tax; C(cur).balance += proceeds; const S = T(cur); S.realizedPnl += pnl; S.fees += t.fee; S.taxes += t.tax; S.sold += t.shares * t.price; snap(p, t, { realized: r2(pnl) });
      }
      else if (t.type === "dividend") { const net = t.amount - t.tax; p.dividends += net; p.taxes += t.tax; C(cur).balance += net; const S = T(cur); S.dividends += net; S.taxes += t.tax;
        if (p.shares < EPS) r.warnings.push({ code: "dividend_without_position", message: "領股息時沒有持股（賣出後才發放的話可以忽略）" }); snap(p, t, { dividend: r2(net) }); }
      else if (t.type === "stock_dividend") { // 配股成本 0，平均成本下降；有填配股率時和持股核對（台股不足一股的部分通常發現金，所以用無條件捨去比較）
        if (p.shares < EPS) r.warnings.push({ code: "stock_dividend_without_position", message: "配股時沒有持股" });
        else if (isNum(t.ratio)) { const exp = p.shares * t.ratio, lo = t.market === "tw" ? Math.floor(exp + EPS) : exp; if (Math.abs(t.shares - lo) > Math.max(1, lo * 0.001) && Math.abs(t.shares - exp) > 1e-6) r.warnings.push({ code: "stock_dividend_mismatch", message: `依配股率應該約 ${+lo.toFixed(4)} 股，填的是 ${t.shares} 股，請對照券商入帳` }); }
        add(p, t.shares, 0, t); snap(p, t); }
      else if (t.type === "split") {
        if (p.shares < EPS) { r.warnings.push({ code: "split_without_position", message: "拆股／合股時沒有持股，不影響" }); continue; }
        p.shares *= t.ratio; p.lots.forEach(L => { L.shares *= t.ratio; });
        const frac = p.shares - Math.floor(p.shares + 1e-9);
        if (t.market === "tw" && frac > 1e-6) { p.fraction = frac; r.warnings.push({ code: "fractional_after_split", message: `合股後有 ${+frac.toFixed(6)} 股不足一股，要再記一筆「零股現金結算」；結算前這部分標為待確認` }); }
        snap(p, t);
      }
      else if (t.type === "fraction_cash") { // 零股換現金：拿掉這些股數的成本，拿到的現金和成本的差是已實現損益
        if (t.shares > p.shares + EPS) { r.errors.push({ code: "oversell", message: `結算 ${t.shares} 股，但當時只持有 ${+p.shares.toFixed(6)} 股` }); continue; }
        const net = t.amount - t.fee - t.tax, cost = take(p, t.shares), pnl = net - cost; p.realizedPnl += pnl; p.fees += t.fee; p.taxes += t.tax; C(cur).balance += net;
        const S = T(cur); S.realizedPnl += pnl; S.fees += t.fee; S.taxes += t.tax; p.fraction = Math.max(0, p.fraction - t.shares); if (p.fraction < 1e-6) p.fraction = 0; snap(p, t, { realized: r2(pnl) });
      }
      else if (t.type === "transfer_in") { add(p, t.shares, t.shares * t.price + t.fee, t); p.fees += t.fee; T(cur).fees += t.fee; snap(p, t); } // 外部轉入：不動現金，成本用填的每股成本
      else if (t.type === "transfer_out") {
        if (t.shares > p.shares + EPS) { r.errors.push({ code: "over_transfer", message: `轉出 ${t.shares} 股，但當時只持有 ${+p.shares.toFixed(6)} 股` }); continue; }
        take(p, t.shares); snap(p, t);
      }
      else if (t.type === "deposit") { const c = C(cur); c.balance += t.amount; c.deposits += t.amount; c.tracked = true; }
      else if (t.type === "withdraw") { const c = C(cur); c.balance -= t.amount; c.withdrawals += t.amount; c.tracked = true; }
      else if (t.type === "fee") { C(cur).balance -= t.amount; T(cur).fees += t.amount; if (p) p.fees += t.amount; }
      else if (t.type === "other" && !p) { if (isNum(t.amount)) C(cur).balance += t.amount; r.warnings.push({ code: "other_action", message: "其他公司行動（只有金額）：只記現金，請確認" }); } // 純現金，沒有對應的持股
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
        open: p.shares > EPS, pending: p.fraction > 1e-6 ? [{ code: "fraction_unsettled", shares: +p.fraction.toFixed(6), message: "合股後不足一股的部分還沒結算，股數與成本是暫時的" }] : [], lots: method === "fifo" ? p.lots.map(L => ({ date: L.date, id: L.id, shares: +L.shares.toFixed(6), cost: r2(L.cost) })) : null, firstDate: p.firstDate, history: p.history }; })
      .sort((a, b) => (b.open - a.open) || a.symbol.localeCompare(b.symbol));
    for (const S of Object.values(totals)) for (const k of Object.keys(S)) S[k] = r2(S[k]);
    for (const c of Object.values(cash)) { c.balance = r2(c.balance); c.deposits = r2(c.deposits); c.withdrawals = r2(c.withdrawals); }
    const txs = rows.map(r => ({ index: r.i, id: r.tx?.id ?? null, tx: r.tx, applied: !!r.applied, errors: r.errors, warnings: r.warnings }));
    const bad = txs.filter(x => x.errors.length).length;
    const pend = positions.filter(p => p.pending.length).length;
    return { v: VERSION, method, methodLabel: METHODS[method], status: !txs.length ? "empty" : bad ? "has_errors" : pend ? "needs_confirm" : "ok", errorCount: bad, pendingCount: pend, positions, cash, totals,
      txs: txs.map(x => (rows[x.index].mergedInto ? { ...x, mergedInto: rows[x.index].mergedInto } : x)) };
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

  // CSV 匯出（給 Excel、Numbers）：開頭加 BOM 讓 Excel 認得 UTF-8；文字欄位開頭是 = + - @ 時前面加 ' ，避免被試算表當成公式執行（CSV 注入）
  const CSV_COLS = [["date", "日期"], ["type", "類型"], ["symbol", "代號"], ["market", "市場"], ["currency", "幣別"], ["shares", "股數"], ["price", "價格"], ["amount", "金額"], ["ratio", "比例"], ["fee", "手續費"], ["tax", "交易稅"], ["note", "備註"], ["source", "來源"], ["id", "編號"]];
  function toCSV(transactions) {
    const cell = (k, v) => { if (v == null) return ""; let t = k === "type" ? (TYPE_LABEL[v] || String(v)) : String(v); if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const rows = (Array.isArray(transactions) ? transactions : []).slice().sort((a, b) => String(a?.date).localeCompare(String(b?.date)));
    return "\ufeff" + [CSV_COLS.map(c => c[1]).join(","), ...rows.map(t => CSV_COLS.map(([k]) => cell(k, t?.[k])).join(","))].join("\r\n") + "\r\n";
  }
  // 備份檔裡的投資組合資料檢查（匯入前用）：data＝{ 存檔鍵: JSON 字串 }。交易紀錄跑 validateStore；融資帳戶檢查格式與版本（有 KLMargin 時跑它的 validateStore）。
  // 回傳 { ok, items: [{ key, label, ok, problems, summary }] }；任何一項不通過，整份都不要匯入
  function checkBackup(data, opts = {}) {
    const items = [], parse = v => { try { return { ok: true, v: JSON.parse(v) }; } catch { return { ok: false }; } };
    for (const [key, raw] of Object.entries(data || {})) {
      if (key === STORE_KEY) {
        const p = parse(raw); if (!p.ok) { items.push({ key, label: "交易紀錄", ok: false, problems: ["不是正確的 JSON"] }); continue; }
        const v = validateStore(p.v, { today: opts.today });
        const tx = Array.isArray(p.v?.transactions) ? p.v.transactions : [], ds = tx.map(t => t?.date).filter(Boolean).sort();
        items.push({ key, label: "交易紀錄", ok: v.ok, problems: v.ok ? [] : [v.code === "has_errors" ? `${v.errors.length} 筆交易有錯誤（例如：${v.errors[0].errors[0].message}）` : v.code === "unsupported_version" ? `版本 ${p.v?.v} 不支援（這版只認得 ${VERSION}）` : v.code],
          summary: { transactions: tx.length, from: ds[0] || null, to: ds[ds.length - 1] || null, method: p.v?.method || null } });
      } else if (key === "kline:pf:margin:v1") {
        const p = parse(raw); if (!p.ok) { items.push({ key, label: "融資帳戶", ok: false, problems: ["不是正確的 JSON"] }); continue; }
        // 一定要用融資模組的完整檢查（借款、利率、擔保品、門檻…）；沒有檢查程式就不接受，不降級成只看版本
        const M = opts.margin; let ok = p.v && p.v.v === 1 && Array.isArray(p.v.accounts), problems = ok ? [] : ["格式或版本不對"];
        if (ok && !(M && typeof M.validateStore === "function")) { ok = false; problems = ["沒有融資資料的檢查程式，為了安全不匯入"]; }
        else if (ok) { const r = M.validateStore(p.v); if (!r.ok) { ok = false; problems = [`${new Set(r.errors.map(e => e.i)).size} 個帳戶資料不對（例如：${r.errors[0].code}）`]; } }
        items.push({ key, label: "融資帳戶", ok, problems, summary: { accounts: Array.isArray(p.v?.accounts) ? p.v.accounts.length : 0 } });
      } else if (key === "kline:pf:targets:v1") {
        // 目標配置：用再平衡模組的完整檢查；沒有檢查程式就不接受
        const p = parse(raw); if (!p.ok) { items.push({ key, label: "目標配置", ok: false, problems: ["不是正確的 JSON"] }); continue; }
        const Rb = opts.rebal; let ok = !!(Rb && typeof Rb.validateStore === "function"), problems = ok ? [] : ["沒有目標配置的檢查程式，為了安全不匯入"];
        if (ok) { const r = Rb.validateStore(p.v); if (!r.ok) { ok = false; problems = [`目標配置資料不對（${r.errors[0]?.code || r.code} ${r.errors[0]?.error || ""}）`]; } }
        items.push({ key, label: "目標配置", ok, problems, summary: { items: p.v && p.v.targets && typeof p.v.targets === "object" ? Object.keys(p.v.targets).length : 0 } });
      } else if (key === "kline:pf:thesis:v1") {
        // 投資論點：一樣要用論點模組的完整檢查；沒有檢查程式就不接受
        const p = parse(raw); if (!p.ok) { items.push({ key, label: "投資論點", ok: false, problems: ["不是正確的 JSON"] }); continue; }
        const Th = opts.thesis; let ok = !!(Th && typeof Th.validateStore === "function"), problems = ok ? [] : ["沒有投資論點的檢查程式，為了安全不匯入"];
        if (ok) { const r = Th.validateStore(p.v); if (!r.ok) { ok = false; problems = [r.errors.length ? `${r.errors.length} 檔的論點資料不對（例如：${r.errors[0].code} ${r.errors[0].errors[0]}）` : `格式或版本不對（${r.code}）`]; } }
        items.push({ key, label: "投資論點", ok, problems, summary: { items: p.v && p.v.items && typeof p.v.items === "object" ? Object.keys(p.v.items).length : 0 } });
      } else if (key.startsWith("kline:pf:")) items.push({ key, label: key, ok: false, problems: ["不認得的投資組合資料（可能是比較新的版本），為了安全不匯入"] });
    }
    return { ok: items.every(x => x.ok), items };
  }

  const defaultToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const inferMkt = (sym, fn) => { const m = typeof fn === "function" ? fn(sym) : (/^\d{4,6}[A-Z]?$/.test(sym) ? "tw" : /^[A-Z][A-Z0-9]{0,5}([.-][A-Z]{1,3})?$/.test(sym) ? "us" : null); return m === "tw" || m === "us" ? m : null; };
  const cleanNum = v => { if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null; const s = typeof v === "string" ? v.trim().replace(/,/g, "") : v; const n = typeof s === "number" || typeof s === "string" ? Number(s) : NaN; return Number.isFinite(n) ? n : NaN; };

  // 選項 1（持股截圖 → 股票轉入 transfer_in）：先比對現有帳本（kline:pf:v1）未平倉部位；
  // 同一代號若目前已有持股，預設不勾選（on: false）並標示帳本已有股數，以免重複計算；未持有的預設勾選。不改動傳入資料。
  function prepareHoldingsImport(rows, existingTxs = [], opts = {}) {
    const today = validDate(opts.today) ? opts.today : defaultToday();
    const existingArr = Array.isArray(existingTxs) ? existingTxs : [];
    const base = buildLedger(existingArr, { method: opts.method, today, rules: opts.rules });
    const openMap = new Map(base.positions.filter(p => p.open && p.shares > EPS).map(p => [p.symbol, p]));
    const items = (Array.isArray(rows) ? rows : []).map((raw, i) => {
      const sym = symbolOf(raw?.symbol ?? raw?.code);
      const shares = cleanNum(raw?.shares ?? raw?.sh);
      const cost = cleanNum(raw?.avgCost ?? raw?.price ?? raw?.cost);
      const dRaw = raw?.date ?? raw?.d;
      const dStr = typeof dRaw === "string" ? dRaw.trim() : "";
      const dateAssumed = !dStr ? "today" : null;
      const date = dStr || today;
      const market = (raw?.market === "tw" || raw?.market === "us") ? raw.market : (sym ? inferMkt(sym, opts.market) : null);
      const currency = market ? CURRENCY[market] : null;
      const existingPos = sym ? openMap.get(sym) || null : null;
      const duplicateOpen = !!existingPos;
      const existingShares = existingPos ? existingPos.shares : 0;
      const skipReason = duplicateOpen ? `帳本已有 ${+existingShares.toFixed(6)} 股，預設略過以免重複` : null;
      const on = typeof raw?.on === "boolean" ? raw.on : !duplicateOpen;
      const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : (opts.idPrefix ? `${opts.idPrefix}${i + 1}` : makeTx({}).id);
      const note = typeof raw?.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 500) : "截圖匯入庫存：股票轉入";
      const tx = {
        v: VERSION, id, date, type: "transfer_in", symbol: sym, market, currency,
        shares: isNum(shares) ? shares : Number.isNaN(shares) ? raw?.shares ?? raw?.sh : null,
        price: isNum(cost) ? cost : Number.isNaN(cost) ? raw?.avgCost ?? raw?.price ?? raw?.cost : null,
        fee: 0, tax: 0, note,
        source: typeof raw?.source === "string" && raw.source.trim() ? raw.source.trim().slice(0, 40) : "import"
      };
      return { index: i, raw, on, duplicateOpen, existingShares, skipReason, dateAssumed, symbol: sym, name: typeof raw?.name === "string" ? raw.name.trim() : "", shares: tx.shares, price: tx.price, date, market, currency, how: typeof raw?.how === "string" ? raw.how : "", errors: [], warnings: [], tx };
    });
    const enabled = items.filter(it => it.on);
    const combined = buildLedger([...existingArr, ...enabled.map(it => it.tx)], { method: opts.method, today, rules: opts.rules });
    const byId = new Map(combined.txs.slice(existingArr.length).map(x => [x.id, x]));
    const newErrors = [];
    for (let k = 0; k < existingArr.length; k++) {
      const bef = base.txs[k]?.errors?.length || 0, aft = combined.txs[k]?.errors || [];
      if (aft.length > bef) newErrors.push({ id: combined.txs[k].id, errors: aft });
    }
    let errorCount = newErrors.length;
    const duplicates = [];
    for (const it of items) {
      const res = it.on ? byId.get(it.tx.id) : checkTx(it.tx, { today, rules: opts.rules });
      it.errors = res?.errors ? res.errors.slice() : [];
      it.warnings = res?.warnings ? res.warnings.slice() : [];
      if (it.on && it.errors.length) errorCount++;
      if (it.on && it.warnings.some(w => w.code === "possible_duplicate")) duplicates.push(it);
    }
    return {
      ok: enabled.length > 0 && errorCount === 0,
      canSaveEmpty: enabled.length === 0,
      items,
      transactions: enabled.map(it => it.tx),
      existingOpenCount: items.filter(it => it.duplicateOpen).length,
      selectedCount: enabled.length,
      errorCount,
      newErrors,
      duplicates,
      storeErrorCount: combined.errorCount
    };
  }

  function parseTimeSpan(raw) {
    if (raw == null) return { present: false, valid: true, text: null, lo: null, hi: null };
    const s = String(raw).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/：/g, ":").trim();
    if (!s) return { present: false, valid: true, text: null, lo: null, hi: null };
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*(AM|PM))?$/i);
    if (!m) return { present: true, valid: false, text: s, lo: null, hi: null };
    let hh = +m[1];
    const mm = +m[2], ss = m[3] != null ? +m[3] : null, ap = m[4] ? m[4].toUpperCase() : null;
    if (ap) {
      if (hh < 1 || hh > 12) return { present: true, valid: false, text: s, lo: null, hi: null };
      if (ap === "PM" && hh < 12) hh += 12;
      else if (ap === "AM" && hh === 12) hh = 0;
    } else if (hh < 0 || hh > 23) return { present: true, valid: false, text: s, lo: null, hi: null };
    if (mm < 0 || mm > 59 || (ss != null && (ss < 0 || ss > 59))) return { present: true, valid: false, text: s, lo: null, hi: null };
    const p2 = n => String(n).padStart(2, "0");
    const base = hh * 3600 + mm * 60;
    if (ss != null) return { present: true, valid: true, text: `${p2(hh)}:${p2(mm)}:${p2(ss)}`, lo: base + ss, hi: base + ss };
    return { present: true, valid: true, text: `${p2(hh)}:${p2(mm)}`, lo: base, hi: base + 59 };
  }

  // 選項 2（成交明細／對帳單截圖 → buy／sell）：保留空白 fee/tax 為 null（觸發估算，explicit 0 維持 0），
  // 僅依「不同日期」或同一天「可驗證成交時間（互斥區間）／序號」排序；沒有時間的同日買賣不自動反轉以免掩蓋賣超，須明確確認或補時間後才可存檔。
  function prepareTradesImport(rows, existingTxs = [], opts = {}) {
    const today = validDate(opts.today) ? opts.today : defaultToday();
    const existingArr = Array.isArray(existingTxs) ? existingTxs : [];
    const base = buildLedger(existingArr, { method: opts.method, today, rules: opts.rules });
    const existingCore = new Set(existingArr.map(t => {
      const sym = symbolOf(t?.symbol), sh = cleanNum(t?.shares), px = cleanNum(t?.price);
      return t && (t.type === "buy" || t.type === "sell") && validDate(t.date) && sym && isNum(sh) && isNum(px)
        ? [t.date, t.type, sym, sh, px].join("|") : null;
    }).filter(Boolean));
    const timeMeta = new Map(), seqMeta = new Map();
    const items = (Array.isArray(rows) ? rows : []).map((raw, i) => {
      const on = raw?.on !== false;
      const side = raw?.type === "buy" || raw?.side === "buy" ? "buy" : raw?.type === "sell" || raw?.side === "sell" ? "sell" : null;
      const sym = symbolOf(raw?.symbol ?? raw?.code);
      const market = (raw?.market === "tw" || raw?.market === "us") ? raw.market : (sym ? inferMkt(sym, opts.market) : null);
      const currency = market ? CURRENCY[market] : null;
      const dRaw = raw?.date;
      const daIn = raw?.dateAssumed;
      const dateAssumed = daIn === "invalid" ? "invalid" : dRaw == null ? (daIn || "today") : (daIn === "year" || daIn === "today" || daIn === "mdy" ? daIn : null);
      const date = dateAssumed === "invalid" ? "" : (dRaw == null ? today : typeof dRaw === "string" ? dRaw.trim() : "");
      const altDate = typeof raw?.altDate === "string" ? raw.altDate.trim() : "";
      const rawDate = typeof raw?.rawDate === "string" ? raw.rawDate.trim() : "";
      const rawTime = typeof raw?.rawTime === "string" ? raw.rawTime.trim() : "";
      const ts = parseTimeSpan(raw?.time);
      const timeInvalid = (ts.present && !ts.valid) || (!ts.present && raw?.timeInvalid === true);
      const time = ts.present ? ts.text : (raw?.timeInvalid === true && rawTime ? rawTime : null);
      const seq = cleanNum(raw?.seq);
      const shares = cleanNum(raw?.shares ?? raw?.sh);
      const price = cleanNum(raw?.price);
      const fee = cleanNum(raw?.fee);
      const tax = cleanNum(raw?.tax);
      const assetType = ["etf", "stock", "bond_etf"].includes(raw?.assetType) ? raw.assetType : null;
      const dayTrade = !!raw?.dayTrade;
      const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, 500) : "";
      const source = typeof raw?.source === "string" && raw.source.trim() ? raw.source.trim().slice(0, 40) : "import";
      const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : (opts.idPrefix ? `${opts.idPrefix}${i + 1}` : makeTx({}).id);
      const tx = {
        v: VERSION, id, date, ...(ts.present && ts.valid ? { time: ts.text } : {}), type: side, symbol: sym, market, currency,
        shares: isNum(shares) ? shares : Number.isNaN(shares) ? raw?.shares ?? raw?.sh : null,
        price: isNum(price) ? price : Number.isNaN(price) ? raw?.price : null,
        fee: fee === null ? null : (isNum(fee) ? fee : raw?.fee),
        tax: tax === null ? null : (isNum(tax) ? tax : raw?.tax),
        ...(assetType ? { assetType } : {}),
        ...(dayTrade ? { dayTrade: true } : {}),
        note, source
      };
      const it = { index: i, raw, on, dateAssumed, ...(altDate ? { altDate } : {}), ...(rawDate ? { rawDate } : {}), time, timeInvalid, type: side, symbol: sym, name: typeof raw?.name === "string" ? raw.name.trim() : "", shares: tx.shares, price: tx.price, fee: tx.fee, tax: tx.tax, dayTrade, date, market, currency, errors: [], warnings: [], tx, computed: null };
      timeMeta.set(it, ts);
      seqMeta.set(it, seq);
      return it;
    });
    const enabled = items.filter(it => it.on);
    const ordered = enabled.map((it, slot) => ({ it, slot })).sort((a, b) => {
      const va = validDate(a.it.date), vb = validDate(b.it.date);
      if (va !== vb) return va ? -1 : 1;
      if (!va || a.it.date === b.it.date) return a.slot - b.slot;
      return a.it.date < b.it.date ? -1 : 1;
    }).map(x => x.it);

    const byDaySym = new Map();
    ordered.forEach((it, idx) => {
      if (validDate(it.date) && it.symbol) {
        const k = `${it.date}|${it.symbol}`;
        let g = byDaySym.get(k);
        if (!g) byDaySym.set(k, g = []);
        g.push(idx);
      }
    });
    const verifiableGroups = new Set();
    for (const [k, idxs] of byDaySym) {
      if (idxs.length < 2) continue;
      const grp = idxs.map(i => ordered[i]);
      const allTimed = grp.every(it => { const ts = timeMeta.get(it); return ts.present && ts.valid; });
      let timeDisjoint = false;
      if (allTimed) {
        timeDisjoint = true;
        const fifoMode = opts.method === "fifo";
        for (let a = 0; a < grp.length && timeDisjoint; a++) {
          for (let b = a + 1; b < grp.length; b++) {
            if (fifoMode || grp[a].type !== grp[b].type) {
              const ta = timeMeta.get(grp[a]), tb = timeMeta.get(grp[b]);
              if (!(ta.hi < tb.lo || tb.hi < ta.lo)) { timeDisjoint = false; break; }
            }
          }
        }
      }
      if (timeDisjoint) {
        verifiableGroups.add(k);
        const sorted = grp.map((it, pos) => ({ it, pos, ts: timeMeta.get(it) })).sort((a, b) => (a.ts.lo - b.ts.lo) || (a.ts.hi - b.ts.hi) || (a.pos - b.pos));
        idxs.forEach((slotIdx, p) => { ordered[slotIdx] = sorted[p].it; });
        continue;
      }
      const noBadTime = grp.every(it => !it.timeInvalid);
      const seqs = grp.map(it => seqMeta.get(it));
      if (noBadTime && seqs.every(isNum) && new Set(seqs).size === seqs.length) {
        verifiableGroups.add(k);
        const sorted = grp.map((it, pos) => ({ it, pos, sq: seqs[pos] })).sort((a, b) => (a.sq - b.sq) || (a.pos - b.pos));
        idxs.forEach((slotIdx, p) => { ordered[slotIdx] = sorted[p].it; });
      }
    }

    const sim = seq => buildLedger([...existingArr, ...seq.map(it => it.tx)], { method: opts.method, today, rules: opts.rules });
    const combined = sim(ordered);
    const byId = new Map(combined.txs.slice(existingArr.length).map(x => [x.id, x]));
    const newErrors = [];
    for (let k = 0; k < existingArr.length; k++) {
      const bef = base.txs[k]?.errors?.length || 0, aft = combined.txs[k]?.errors || [];
      if (aft.length > bef) newErrors.push({ id: combined.txs[k].id, date: combined.txs[k].tx?.date || "", symbol: combined.txs[k].tx?.symbol || "", type: combined.txs[k].tx?.type || "", errors: aft });
    }
    let errorCount = newErrors.length, feeEstimatedCount = 0;
    const duplicates = [];
    for (const it of items) {
      const res = it.on ? byId.get(it.tx.id) : checkTx(it.tx, { today, rules: opts.rules });
      it.errors = res?.errors ? res.errors.slice() : [];
      it.warnings = res?.warnings ? res.warnings.slice() : [];
      it.computed = res?.tx || null;
      if (it.dateAssumed === "mdy" && validDate(it.date)) {
        it.errors.push({ code: "unconfirmed_date_format", message: it.altDate ? `截圖日期「${it.rawDate || it.date}」可能是月/日（${it.date}）或日/月（${it.altDate}），請確認或切換` : `截圖日期「${it.rawDate || it.date}」格式可能有歧義，請確認日期` });
      }
      if (it.timeInvalid) {
        it.errors.push({ code: "invalid_time", message: "成交時間格式不正確（請填 HH:MM 或 HH:MM:SS，或留空）" });
      }
      if (it.on) {
        if ((it.tx.fee == null || it.tx.tax == null) && it.symbol && isNum(it.shares) && isNum(it.price) && existingCore.has([it.date, it.type, it.symbol, it.shares, it.price].join("|")) && !it.warnings.some(w => w.code === "possible_duplicate")) {
          it.warnings.push({ code: "possible_duplicate", message: "帳本裡同一天已有相同代號、方向、股數與價格的交易，請確認不是重複匯入" });
        }
        if (it.errors.length) errorCount++;
        if (it.computed?.feeEstimated) feeEstimatedCount++;
        if (it.warnings.some(w => w.code === "possible_duplicate")) duplicates.push(it);
      }
    }

    const ambiguousSameDay = [];
    let sameDayOversell = false;
    for (const [k, idxs] of byDaySym) {
      if (idxs.length < 2) continue;
      const grp = idxs.map(i => ordered[i]);
      const buyCount = grp.filter(it => it.type === "buy").length;
      const sellCount = grp.filter(it => it.type === "sell").length;
      const mixedSides = buyCount > 0 && sellCount > 0;
      const affectsFifo = opts.method === "fifo" && (buyCount > 1 || sellCount > 1);
      if (!mixedSides && !affectsFifo) continue;
      if (verifiableGroups.has(k)) continue;
      if (grp.some(it => it.errors.some(e => e.code === "oversell"))) sameDayOversell = true;
      if (grp.some(it => it.errors.length > 0)) continue;
      let affectsOversell = false;
      if (mixedSides) {
        const alt = ordered.slice();
        for (let m = 0; m < idxs.length; m++) alt[idxs[m]] = ordered[idxs[idxs.length - 1 - m]];
        const altComb = sim(alt);
        const altById = new Map(altComb.txs.slice(existingArr.length).map(x => [x.id, x]));
        affectsOversell = grp.some(it => altById.get(it.tx.id)?.errors?.some(e => e.code === "oversell"));
      }
      ambiguousSameDay.push({ date: grp[0].date, symbol: grp[0].symbol, rowIndices: grp.map(it => it.index), affectsOversell, affectsFifo, mixedSides });
    }
    const needsOrderConfirm = ambiguousSameDay.length > 0 && opts.orderConfirmed !== true;

    return {
      ok: enabled.length > 0 && errorCount === 0 && !needsOrderConfirm,
      canSaveEmpty: enabled.length === 0,
      items,
      transactions: ordered.map(it => it.tx),
      selectedCount: enabled.length,
      errorCount,
      newErrors,
      duplicates,
      ambiguousSameDay,
      needsOrderConfirm,
      sameDayOversell,
      feeEstimatedCount,
      storeErrorCount: combined.errorCount
    };
  }

  root.KLLedger = Object.freeze({ toCSV, checkBackup, VERSION, STORE_KEY, LEGACY_KEY, TYPES, TYPE_LABEL, METHODS, DEFAULT_RULES, estimateCosts, feeDiff, checkTx, buildLedger, previewAdd, deleteImpact, makeTx, previewMigration, validateStore, prepareHoldingsImport, prepareTradesImport });
})(typeof window !== "undefined" ? window : globalThis);
