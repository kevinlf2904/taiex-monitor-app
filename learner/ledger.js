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
  const TYPE_LABEL = { buy: "買進", sell: "賣出", dividend: "現金股息", stock_dividend: "配股（除權）", split: "拆股／合股", fraction_cash: "零股現金結算", transfer_in: "股票轉入", transfer_out: "股票轉出", deposit: "入金", withdraw: "出金", fee: "費用", other: "其他公司行動", snapshot: "庫存快照" };
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

  // 與 KLRecon 共用 fp1 canonical 指紋規則（即使 recon.js 尚未載入也能驗證 initialTags.txHash）
  const canon = v => { if (v === null || typeof v !== "object") return JSON.stringify(v); if (Array.isArray(v)) return "[" + v.map(x => x === undefined ? "null" : canon(x)).join(",") + "]"; return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"; };
  const cyrb128 = str => {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) { k = str.charCodeAt(i); h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233); h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179); }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233); h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, "0")).join("");
  };
  const txFp = v => { if (root.KLRecon && typeof root.KLRecon.txFingerprint === "function") return root.KLRecon.txFingerprint(v); const s = canon(v ?? {}); return `fp1:${cyrb128(s)}:${s.length}`; };
  function getActiveBaselines(recon) {
    if (root.KLRecon && typeof root.KLRecon.activeBaselines === "function") return root.KLRecon.activeBaselines(recon);
    const map = new Map();
    if (!recon || !Array.isArray(recon.snapshots)) return map;
    for (const snap of recon.snapshots) {
      if (!snap || snap.status !== "confirmed") continue;
      const sym = symbolOf(snap.symbol); if (!sym) continue;
      const prev = map.get(sym);
      if (!prev || snap.date > prev.date) { map.set(sym, snap); continue; }
      if (snap.date === prev.date) {
        const su = snap.supersededBy == null, pu = prev.supersededBy == null;
        if ((su && !pu) || (su === pu && String(snap.confirmedAt || "") >= String(prev.confirmedAt || ""))) map.set(sym, snap);
      }
    }
    return map;
  }

  function getBaselineChains(recon, activeMap) {
    const chains = new Map();
    if (!activeMap || !activeMap.size) return chains;
    const snaps = recon && Array.isArray(recon.snapshots) ? recon.snapshots.filter(Boolean) : [];
    for (const [sym, B] of activeMap) {
      const chain = [B];
      const seen = new Set([B.id]);
      let cur = B;
      while (cur) {
        const cands = snaps.filter(s =>
          !seen.has(s.id) &&
          symbolOf(s.symbol) === sym &&
          (s.status === "superseded" || s.status === "confirmed") &&
          s.supersededBy === cur.id &&
          validDate(s.date) &&
          s.date <= cur.date
        );
        if (!cands.length) break;
        cands.sort((a, b) => a.date !== b.date ? (a.date < b.date ? 1 : -1) : String(b.confirmedAt || "").localeCompare(String(a.confirmedAt || "")));
        const prev = cands[0];
        seen.add(prev.id);
        chain.unshift(prev);
        cur = prev;
      }
      // 只沿 supersededBy 往前串：未經晉升／採信／結案明確接續的較早 confirmed 快照（例如較新基準存在時才標記的舊期初快照）
      // 不可當鏈頭，否則會把從未對過帳、可能不完整的前段交易拿來重算，讓整份帳本出錯而無法存檔
      chain.sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.id === B.id ? 1 : b.id === B.id ? -1 : String(a.confirmedAt || "").localeCompare(String(b.confirmedAt || ""))));
      // 同一天若有多張快照，只留當天最後一張錨點
      const dedup = [];
      for (const s of chain) {
        if (dedup.length && dedup[dedup.length - 1].date === s.date) dedup[dedup.length - 1] = s;
        else dedup.push(s);
      }
      chains.set(sym, dedup);
    }
    return chains;
  }

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
    let feeEst = raw.feeEst === true, taxEst = raw.taxEst === true;
    const tx = { v: VERSION, id, date, type, symbol, market, currency, shares: isNum(shares) ? shares : null, price: isNum(price) ? price : null, amount: isNum(amount) ? amount : null, ratio: isNum(ratio) ? ratio : null,
      fee: isNum(fee) ? fee : null, tax: isNum(tax) ? tax : null, feeEstimated: false, feeEst: false, taxEst: false, assetType: ["etf", "stock", "bond_etf"].includes(raw.assetType) ? raw.assetType : null, dayTrade: !!raw.dayTrade,
      ref: typeof raw.ref === "string" && raw.ref ? raw.ref : null, note: typeof raw.note === "string" ? raw.note.slice(0, 500) : "", source: typeof raw.source === "string" && raw.source ? raw.source.slice(0, 40) : "manual" };
    // 沒填手續費／稅：依規則估算並標示「估算」（填 0 代表真的是 0，不會被估算覆蓋）
    // 買進不收交易稅（台股證交稅、美股 SEC 費都只在賣出）：空白直接記 0，不算「估算」、不用再確認
    if (!errors.length && type === "buy" && tx.tax === null) tx.tax = 0;
    if (!errors.length && (type === "buy" || type === "sell") && (tx.fee === null || tx.tax === null)) {
      if (!tx.assetType) tx.assetType = market === "tw" && /^00\d{2,4}B$/.test(symbol) ? "bond_etf" : market === "tw" && /^00\d{2,4}[A-Z]?$/.test(symbol) ? "etf" : "stock"; // 00679B 這類尾碼 B 的是債券 ETF：證交稅 0（和 analysis.js 的 taxOf 同一條規則，#262 NEW-05）
      const est = estimateCosts(tx, opts.rules || DEFAULT_RULES);
      if (tx.fee === null) { tx.fee = est.fee; feeEst = true; }
      if (tx.tax === null) { tx.tax = est.tax; taxEst = true; }
      Wn("fee_estimated", "手續費或交易稅沒填，依費用規則估算");
    }
    tx.feeEst = feeEst; tx.taxEst = taxEst;
    tx.feeEstimated = feeEst || taxEst || raw.feeEstimated === true;
    if (type === "dividend" && tx.tax === null) tx.tax = 0;
    if (tx.fee === null) tx.fee = 0; if (tx.tax === null) tx.tax = 0;
    return { tx, errors, warnings };
  }

  // 整本帳共用核心：withReconcile=false 時與原 buildLedger 完全一致；withReconcile=true 整合 KLRecon 快照基準、期初標籤與同日順序。
  function computeLedger(txStoreOrList, reconStore, opts = {}, withReconcile = false) {
    let rawList = Array.isArray(txStoreOrList) ? txStoreOrList : [];
    let methodIn = opts.method;
    if (withReconcile && !Array.isArray(txStoreOrList) && txStoreOrList && typeof txStoreOrList === "object") {
      rawList = Array.isArray(txStoreOrList.transactions) ? txStoreOrList.transactions : [];
      if (opts.method === undefined) methodIn = txStoreOrList.method;
    }
    const emptyRecon = { hasSnapshot: false, snapshotCount: 0, openConflicts: [], pendingSymbols: [], unresolvedSameDayCount: 0, staleTags: [] };
    const method = methodIn === "fifo" ? "fifo" : methodIn == null || methodIn === "avg" ? "avg" : null;
    if (!method) return withReconcile ? { v: VERSION, status: "invalid", method: null, error: "invalid_method", positions: [], cash: {}, totals: {}, txs: [], reconcile: emptyRecon } : { v: VERSION, status: "invalid", method: null, error: "invalid_method", positions: [], cash: {}, totals: {}, txs: [] };
    const P = opts.prices, priceOf = c => { const v = P && typeof P.get === "function" ? P.get(c) : P ? P[c] : null; return isNum(v) && v > 0 ? v : null; };
    const rows = rawList.map((raw, i) => ({ i, raw, preSnapshot: false, sameDayRelation: null, ...checkTx(raw, opts) }));
    // 重複：同一個編號 → 錯誤；內容完全一樣（日期、類型、代號、股數、價格、金額、費用）→ 提醒，可能重複輸入
    const ids = new Map(), sig = new Map();
    for (const r of rows) {
      if (!r.tx) continue; const t = r.tx;
      if (t.id) { if (ids.has(t.id)) r.errors.push({ code: "duplicate_id", message: "交易編號重複，已略過後面那筆" }); else ids.set(t.id, r); }
      const s = [t.date, t.type, t.symbol, t.shares, t.price, t.amount, t.ratio, r.raw.fee ?? "", r.raw.tax ?? ""].join("|");
      if (sig.has(s)) r.warnings.push({ code: "possible_duplicate", message: "和另一筆交易內容完全一樣，請確認不是重複輸入" }); else sig.set(s, r);
    }
    // 另計費用（fee）掛在某筆交易上（ref）：
    for (const r of rows) { const t = r.tx; if (!t || t.type !== "fee" || !t.ref || r.errors.length) continue; const o = ids.get(t.ref);
      if (!o || !o.tx || o.errors.length) { r.errors.push({ code: "ref_not_found", message: "這筆費用對應的交易找不到，或那筆交易有錯誤" }); continue; }
      if (o.tx.currency !== t.currency) { r.errors.push({ code: "currency_mismatch", message: "費用的幣別和對應的交易不同" }); continue; }
      const trade = o.tx.type === "buy" || o.tx.type === "sell";
      if (trade) {
        if (o.extraFee) { r.errors.push({ code: "duplicate_fee", message: "這筆交易已經有另一筆另計費用" }); continue; }
        const legacyAmbiguous = o.tx.feeEstimated && !o.tx.feeEst && !o.tx.taxEst && typeof o.raw?.feeEst !== "boolean" && typeof o.raw?.taxEst !== "boolean";
        if (legacyAmbiguous && (o.tx.fee > 0 || o.tx.tax > 0)) { r.errors.push({ code: "duplicate_fee", message: "對應的舊交易未記錄各欄估算來源，請先直接修改原交易的手續費" }); continue; }
        if (o.tx.fee > 0 && !o.tx.feeEst) { r.errors.push({ code: "duplicate_fee", message: "對應的交易已經有手續費，不能再另外記一次" }); continue; }
        if (o.tx.feeEst) { o.tx.fee = 0; o.tx.feeEst = false; o.tx.feeEstimated = !!o.tx.taxEst; if (!o.tx.feeEstimated) o.warnings = o.warnings.filter(w => w.code !== "fee_estimated"); }
        o.extraFee = t.amount; o.tx.fee += t.amount; r.mergedInto = o.tx.id;
      } else r.feeSymbol = o.tx.symbol;
      if (t.date !== o.tx.date) r.warnings.push({ code: "fee_date_differs", message: `費用日期和對應的交易（${o.tx.date}）不同` }); }

    const baselines = withReconcile ? getActiveBaselines(reconStore) : new Map();
    const baselineChains = withReconcile ? getBaselineChains(reconStore, baselines) : new Map();
    // 0. 市場／幣別與大寫 symbol 約束：先以 reconStore 各檔建立 symMkt，再檢核交易
    const symMkt = new Map();
    if (withReconcile && reconStore && typeof reconStore === "object") {
      const seedMkt = item => {
        if (!item) return;
        const sym = symbolOf(item.symbol), m = item.market, cur = item.currency;
        if (sym && (m === "tw" || m === "us") && (cur === "TWD" || cur === "USD") && CURRENCY[m] === cur && !symMkt.has(sym)) {
          symMkt.set(sym, m + "/" + cur);
        }
      };
      for (const b of baselines.values()) seedMkt(b);
      if (Array.isArray(reconStore.snapshots)) for (const s of reconStore.snapshots) if (s && s.status !== "superseded") seedMkt(s);
      if (Array.isArray(reconStore.conflicts)) for (const c of reconStore.conflicts) if (c && c.status === "open" && c.kind !== "currency_conflict") seedMkt(c);
    }
    for (const r of rows) { const t = r.tx; if (!t || !t.symbol || r.errors.length) continue; const k = symMkt.get(t.symbol);
      if (!k) symMkt.set(t.symbol, t.market + "/" + t.currency); else if (k !== t.market + "/" + t.currency) r.errors.push({ code: "currency_conflict", message: "同一個代號前後的市場或幣別不一樣" }); }

    // 對帳期初標籤與同日順序判定
    const validTagTxIds = new Set(), staleTagIds = new Set(), staleTags = [];
    if (withReconcile && reconStore && reconStore.initialTags && typeof reconStore.initialTags === "object") {
      for (const [txId, tag] of Object.entries(reconStore.initialTags)) {
        if (!tag || tag.active !== true) continue;
        const r = ids.get(txId);
        if (!r || !r.tx) { staleTagIds.add(txId); staleTags.push({ txId, symbol: symbolOf(tag.symbol) || null, reason: "tx_missing" }); continue; }
        if (r.tx.type !== "transfer_in") { staleTagIds.add(txId); staleTags.push({ txId, symbol: r.tx.symbol || symbolOf(tag.symbol) || null, reason: "not_transfer_in" }); continue; }
        if (tag.txHash && txFp(r.raw) !== tag.txHash && txFp(r.tx) !== tag.txHash) { staleTagIds.add(txId); staleTags.push({ txId, symbol: r.tx.symbol || symbolOf(tag.symbol) || null, reason: "tx_hash_mismatch" }); continue; }
        validTagTxIds.add(txId);
      }
    }

    const unresolvedBySym = new Map();
    if (withReconcile) {
      for (const r of rows) {
        const t = r.tx;
        if (!t || r.errors.length || (t.type === "fee" && t.ref)) continue;
        const sym = t.symbol, B = sym ? baselines.get(sym) : null;
        if (!B) { r.sortBucket = CORP_FIRST.has(t.type) ? 0 : 1; continue; }
        const chain = baselineChains.get(sym) || [B];
        const B0 = chain[0];
        const isTagAnchor = validTagTxIds.has(t.id) || chain.some(s => !!s.tagTxId && t.id === s.tagTxId && !staleTagIds.has(t.id));
        const sameSnap = chain.find(s => s.date === t.date) || null;
        if (isTagAnchor) {
          r.preSnapshot = true; r.sameDayRelation = null; r.sortBucket = -1;
        } else if (t.date < B0.date) {
          r.preSnapshot = true; r.sameDayRelation = null; r.sortBucket = -2;
        } else if (sameSnap) {
          const relObj = reconStore?.sameDayRelations?.[t.id];
          let rel = "unresolved";
          if (relObj && typeof relObj === "object") {
            const rv = relObj.relation, idOk = !relObj.snapshotId || relObj.snapshotId === sameSnap.id;
            if ((rv === "before_snapshot" || rv === "after_snapshot") && relObj.snapshotDate === sameSnap.date && idOk) rel = rv;
          } else if (typeof r.raw?.snapshotRelation === "string") {
            const rv = r.raw.snapshotRelation;
            const idOk = !r.raw.snapshotId || r.raw.snapshotId === sameSnap.id;
            const dateOk = !r.raw.snapshotDate || r.raw.snapshotDate === sameSnap.date;
            if ((rv === "before_snapshot" || rv === "after_snapshot") && idOk && dateOk) rel = rv;
          }
          r.sameDayRelation = rel;
          if (rel === "before_snapshot") {
            // 若是第一張快照 B0 同日且在快照前，代表已含於 B0 期初內（preSnapshot=true）；若是後續快照 Si 同日且在快照前，屬於 (B0, Si) 期間交易，需在 Si 錨點（bucket 0）前套用（bucket -1）
            r.preSnapshot = sameSnap.id === B0.id;
            r.sortBucket = -1;
          } else if (rel === "unresolved") {
            r.preSnapshot = false; r.sortBucket = 1;
            const u = unresolvedBySym.get(sym) || { count: 0, shares: 0, date: sameSnap.date };
            u.count++; if (isNum(t.shares)) u.shares += t.shares;
            u.date = sameSnap.date;
            unresolvedBySym.set(sym, u);
          } else {
            r.preSnapshot = false; r.sortBucket = CORP_FIRST.has(t.type) ? 2 : 3;
          }
        } else {
          r.preSnapshot = false; r.sameDayRelation = null; r.sortBucket = CORP_FIRST.has(t.type) ? 4 : 5;
        }
      }
      // 另計費用跟隨其 ref 交易的 preSnapshot / sameDayRelation 與排序階段
      for (const r of rows) {
        const t = r.tx;
        if (!t || r.errors.length || !(r.mergedInto || r.feeSymbol)) continue;
        const o = ids.get(t.ref);
        if (o) {
          r.preSnapshot = !!o.preSnapshot;
          r.sameDayRelation = o.sameDayRelation ?? null;
          r.sortBucket = o.sortBucket;
        }
      }
    }

    const items = rows.map(r => ({ isAnchor: false, r, date: r.tx?.date || "9999", bucket: r.sortBucket ?? (CORP_FIRST.has(r.tx?.type) ? 0 : 1), i: r.i }));
    if (withReconcile) {
      for (const [sym, chain] of baselineChains) {
        for (let idx = 0; idx < chain.length; idx++) {
          const S = chain[idx];
          items.push({ isAnchor: true, sym, B: S, isFirstAnchor: idx === 0, isLastAnchor: idx === chain.length - 1, date: S.date, bucket: 0, i: -1 });
        }
      }
    }
    items.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      return a.i - b.i;
    });

    const pos = new Map(), cash = {}, totals = {};
    const C = cur => (cash[cur] ||= { balance: 0, deposits: 0, withdrawals: 0, tracked: false }), T = cur => (totals[cur] ||= { realizedPnl: 0, dividends: 0, fees: 0, taxes: 0, bought: 0, sold: 0 });
    const posOf = (t, sym = t.symbol) => { let p = pos.get(sym); if (!p) pos.set(sym, p = { symbol: sym, market: t.market, currency: t.currency, shares: 0, costBasis: 0, lots: [], realizedPnl: 0, dividends: 0, fees: 0, taxes: 0, firstDate: t.date, history: [], fraction: 0, hasSnapshot: false, snapshotDate: null, snapshotId: null, snapshotOrigin: null, snapshotScope: null, snapshotShares: null, snapshotAvgCost: null, firstSnapshotDate: null, firstSnapshotShares: null, firstSnapshotAvgCost: null, firstSnapshotOrigin: null }); return p; };
    const snap = (p, t, extra = {}) => p.history.push({ date: t.date, id: t.id, type: t.type, shares: p.shares, costBasis: r2(p.costBasis), avgCost: p.shares > EPS ? p.costBasis / p.shares : null, ...extra });
    const take = (p, n) => {
      if (method === "avg") { const c = p.shares > EPS ? p.costBasis * n / p.shares : 0; p.shares -= n; p.costBasis -= c; if (p.shares < EPS) { p.shares = 0; p.costBasis = 0; } return c; }
      let left = n, c = 0;
      while (left > EPS && p.lots.length) { const L = p.lots[0], k = Math.min(L.shares, left), lc = L.cost * k / L.shares; c += lc; L.cost -= lc; L.shares -= k; left -= k; if (L.shares < EPS) p.lots.shift(); }
      p.shares -= n; p.costBasis -= c; if (p.shares < EPS) { p.shares = 0; p.costBasis = 0; p.lots = []; } return c;
    };
    const add = (p, n, cost, t) => { p.shares += n; p.costBasis += cost; if (method === "fifo") p.lots.push({ date: t.date, id: t.id, shares: n, cost }); };

    for (const item of items) {
      if (item.isAnchor) {
        const { sym, B, isFirstAnchor } = item;
        const p = posOf({ symbol: sym, market: B.market, currency: B.currency, date: B.date }, sym);
        const prevShares = p.shares, prevCost = p.costBasis;
        if (isFirstAnchor || !p.firstSnapshotDate) {
          p.firstDate = B.date;
          p.firstSnapshotDate = B.date; p.firstSnapshotShares = B.shares; p.firstSnapshotAvgCost = B.avgCost ?? null; p.firstSnapshotOrigin = B.origin || "import";
        }
        p.hasSnapshot = true; p.snapshotDate = B.date; p.snapshotId = B.id; p.snapshotOrigin = B.origin || "import"; p.snapshotScope = B.scope || "partial"; p.snapshotShares = B.shares; p.snapshotAvgCost = B.avgCost ?? null;
        if (B.origin === "full_snapshot_close") {
          const deltaShares = isFirstAnchor ? 0 : r2(0 - prevShares);
          p.shares = 0; p.costBasis = 0; p.lots = [];
          p.history.push({ date: B.date, id: B.id, type: "snapshot", origin: "full_snapshot_close", shares: 0, costBasis: 0, avgCost: null, isSnapshot: true, isFirstSnapshot: !!isFirstAnchor, deltaShares, deltaCost: isFirstAnchor ? 0 : r2(0 - prevCost) });
        } else if (isNum(B.shares) && B.shares > 0 && isNum(B.avgCost) && B.avgCost > 0) {
          const initCost = r2(B.shares * B.avgCost);
          const deltaShares = isFirstAnchor ? 0 : r2(B.shares - prevShares);
          p.shares = B.shares; p.costBasis = initCost;
          p.lots = method === "fifo" ? [{ date: B.date, id: B.id, shares: B.shares, cost: initCost, isSnapshot: true }] : [];
          p.history.push({ date: B.date, id: B.id, type: "snapshot", shares: B.shares, costBasis: initCost, avgCost: B.avgCost, isSnapshot: true, isFirstSnapshot: !!isFirstAnchor, deltaShares, deltaCost: isFirstAnchor ? 0 : r2(initCost - prevCost) });
        }
        continue;
      }
      const r = item.r, t = r.tx; if (!t || r.errors.length) continue;
      if (r.preSnapshot) {
        if (!r.mergedInto) {
          const p = t.symbol ? posOf(t) : r.feeSymbol ? posOf(t, r.feeSymbol) : null;
          if (p && t.type !== "fee") p.history.push({ date: t.date, id: t.id, type: t.type, shares: 0, costBasis: 0, avgCost: null, preSnapshot: true });
        }
        r.applied = false; continue;
      }
      if (r.sameDayRelation === "unresolved") {
        if (!r.mergedInto) {
          const p = t.symbol ? posOf(t) : r.feeSymbol ? posOf(t, r.feeSymbol) : null;
          if (p && t.type !== "fee") p.history.push({ date: t.date, id: t.id, type: t.type, shares: p.shares, costBasis: r2(p.costBasis), avgCost: p.shares > EPS ? p.costBasis / p.shares : null, unresolved: true });
        }
        r.applied = false; continue;
      }
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
      else if (t.type === "stock_dividend") {
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
      else if (t.type === "fraction_cash") {
        if (t.shares > p.shares + EPS) { r.errors.push({ code: "oversell", message: `結算 ${t.shares} 股，但當時只持有 ${+p.shares.toFixed(6)} 股` }); continue; }
        const net = t.amount - t.fee - t.tax, cost = take(p, t.shares), pnl = net - cost; p.realizedPnl += pnl; p.fees += t.fee; p.taxes += t.tax; C(cur).balance += net;
        const S = T(cur); S.realizedPnl += pnl; S.fees += t.fee; S.taxes += t.tax; p.fraction = Math.max(0, p.fraction - t.shares); if (p.fraction < 1e-6) p.fraction = 0; snap(p, t, { realized: r2(pnl) });
      }
      else if (t.type === "transfer_in") { add(p, t.shares, t.shares * t.price + t.fee, t); p.fees += t.fee; T(cur).fees += t.fee; snap(p, t); }
      else if (t.type === "transfer_out") {
        if (t.shares > p.shares + EPS) { r.errors.push({ code: "over_transfer", message: `轉出 ${t.shares} 股，但當時只持有 ${+p.shares.toFixed(6)} 股` }); continue; }
        take(p, t.shares); snap(p, t);
      }
      else if (t.type === "deposit") { const c = C(cur); c.balance += t.amount; c.deposits += t.amount; c.tracked = true; }
      else if (t.type === "withdraw") { const c = C(cur); c.balance -= t.amount; c.withdrawals += t.amount; c.tracked = true; }
      else if (t.type === "fee") { C(cur).balance -= t.amount; T(cur).fees += t.amount; if (p) p.fees += t.amount; }
      else if (t.type === "other" && !p) { if (isNum(t.amount)) C(cur).balance += t.amount; r.warnings.push({ code: "other_action", message: "其他公司行動（只有金額）：只記現金，請確認" }); }
      else if (t.type === "other") {
        if (isNum(t.shares) && t.shares < 0 && -t.shares > p.shares + EPS) { r.errors.push({ code: "oversell", message: "股數減少超過持有數量" }); continue; }
        if (isNum(t.shares) && t.shares > 0) add(p, t.shares, 0, t); else if (isNum(t.shares) && t.shares < 0) take(p, -t.shares);
        if (isNum(t.amount)) { C(cur).balance += t.amount; }
        r.warnings.push({ code: "other_action", message: "其他公司行動：成本與損益依填的內容處理，請確認" }); snap(p, t);
      }
      r.applied = true;
    }

    for (const c of Object.values(cash)) if (c.tracked && c.balance < -0.005) c.negative = true;
    const openConflicts = withReconcile && Array.isArray(reconStore?.conflicts) ? reconStore.conflicts.filter(c => c && c.status === "open") : [];
    const positions = [...pos.values()].map(p => {
      const price = priceOf(p.symbol), mv = price != null && p.shares > EPS ? p.shares * price : p.shares > EPS ? null : 0;
      const pending = p.fraction > 1e-6 ? [{ code: "fraction_unsettled", shares: +p.fraction.toFixed(6), message: "合股後不足一股的部分還沒結算，股數與成本是暫時的" }] : [];
      if (withReconcile) {
        for (const c of openConflicts) {
          if (symbolOf(c.symbol) !== p.symbol) continue;
          pending.push({ code: c.kind || "recon_diff", conflictId: c.id, shares: c.diffShares ?? c.targetShares ?? null, baselineShares: c.baselineShares ?? null, targetShares: c.targetShares ?? null, diffShares: c.diffShares ?? null, market: c.market || p.market, message: c.message || (c.kind === "recon_diff" ? `對帳差異 ${c.diffShares ?? ""} 股` : "待對帳項目") });
        }
        const u = unresolvedBySym.get(p.symbol);
        if (u && !pending.some(x => x.code === "same_day_order")) {
          pending.push({ code: "same_day_order", shares: u.shares, count: u.count, market: p.market, message: `有 ${u.count} 筆與快照同日（${p.snapshotDate}）的交易尚未決定在快照前或後` });
        }
      }
      const basePos = { symbol: p.symbol, market: p.market, currency: p.currency, shares: +p.shares.toFixed(6), costBasis: r2(p.costBasis), avgCost: p.shares > EPS ? p.costBasis / p.shares : null,
        lastPrice: price, marketValue: mv == null ? null : r2(mv), unrealizedPnl: mv == null ? null : r2(mv - p.costBasis), realizedPnl: r2(p.realizedPnl), dividends: r2(p.dividends), fees: r2(p.fees), taxes: r2(p.taxes),
        open: p.shares > EPS, pending, lots: method === "fifo" ? p.lots.map(L => ({ date: L.date, id: L.id, shares: +L.shares.toFixed(6), cost: r2(L.cost) })) : null, firstDate: p.firstDate, history: p.history };
      if (!withReconcile) return basePos;
      return { ...basePos, hasSnapshot: !!p.hasSnapshot, snapshotDate: p.snapshotDate, snapshotId: p.snapshotId, snapshotOrigin: p.snapshotOrigin, snapshotScope: p.snapshotScope, snapshotShares: p.snapshotShares, snapshotAvgCost: p.snapshotAvgCost, firstSnapshotDate: p.firstSnapshotDate, firstSnapshotShares: p.firstSnapshotShares, firstSnapshotAvgCost: p.firstSnapshotAvgCost, firstSnapshotOrigin: p.firstSnapshotOrigin };
    }).sort((a, b) => (b.open - a.open) || a.symbol.localeCompare(b.symbol));
    for (const S of Object.values(totals)) for (const k of Object.keys(S)) S[k] = r2(S[k]);
    for (const c of Object.values(cash)) { c.balance = r2(c.balance); c.deposits = r2(c.deposits); c.withdrawals = r2(c.withdrawals); }
    const txs = rows.map(r => {
      const base = { index: r.i, id: r.tx?.id ?? null, tx: r.tx, applied: !!r.applied, errors: r.errors, warnings: r.warnings };
      if (r.mergedInto) base.mergedInto = r.mergedInto;
      if (withReconcile) { base.preSnapshot = !!r.preSnapshot; base.sameDayRelation = r.sameDayRelation ?? null; }
      return base;
    });
    const bad = txs.filter(x => x.errors.length).length;
    const pend = positions.filter(p => p.pending.length).length;
    if (!withReconcile) {
      return { v: VERSION, method, methodLabel: METHODS[method], status: !txs.length ? "empty" : bad ? "has_errors" : pend ? "needs_confirm" : "ok", errorCount: bad, pendingCount: pend, positions, cash, totals, txs };
    }
    const pendingSet = new Set();
    for (const p of positions) if (p.pending.length) pendingSet.add(p.symbol);
    for (const c of openConflicts) { const s = symbolOf(c.symbol); if (s) pendingSet.add(s); }
    for (const s of unresolvedBySym.keys()) pendingSet.add(s);
    const unresolvedSameDayCount = txs.filter(x => x.sameDayRelation === "unresolved").length;
    const status = !txs.length && !baselines.size ? "empty" : bad ? "has_errors" : (pend || openConflicts.length || unresolvedSameDayCount) ? "needs_confirm" : "ok";
    return {
      v: VERSION, method, methodLabel: METHODS[method], status, errorCount: bad, pendingCount: pend, positions, cash, totals, txs,
      reconcile: { hasSnapshot: baselines.size > 0, snapshotCount: baselines.size, openConflicts, pendingSymbols: [...pendingSet].sort(), unresolvedSameDayCount, staleTags }
    };
  }

  // 整本帳：依日期排序（同一天公司行動先、其他照輸入順序），逐筆套用；錯誤的交易不套用並列出原因。
  function buildLedger(list, opts = {}) { return computeLedger(list, null, opts, false); }
  // 統一對帳計算入口：結合 kline:pf:v1（或交易陣列）與 kline:pf:recon:v1，強制基準期初與市場別約束
  function buildReconciledLedger(txStoreOrList, reconStore, opts = {}) { return computeLedger(txStoreOrList, reconStore, opts, true); }

  // 新增交易前的檢查：把 tx 加進現有交易後重算，回傳這筆的錯誤與提醒（不改動傳進來的陣列）
  function previewAdd(list, tx, opts = {}) {
    const arr = [...(Array.isArray(list) ? list : (list?.transactions || [])), tx];
    const L = opts.recon ? buildReconciledLedger(arr, opts.recon, opts) : buildLedger(arr, opts);
    const me = L.txs[L.txs.length - 1];
    return { ok: !me.errors.length, errors: me.errors, warnings: me.warnings, ledger: L };
  }
  // 刪除交易的影響範圍：同一代號、在它之後的交易有哪些會改變（成本、已實現損益），以及刪掉後會不會出現賣超
  function deleteImpact(list, id, opts = {}) {
    const arr = Array.isArray(list) ? list : (list?.transactions || []), t = arr.find(x => x && x.id === id); if (!t) return { ok: false, code: "not_found" };
    const rBefore = opts.reconBefore !== undefined ? opts.reconBefore : opts.recon;
    const rAfter = opts.reconAfter !== undefined ? opts.reconAfter : opts.recon;
    const before = rBefore ? buildReconciledLedger(arr, rBefore, opts) : buildLedger(arr, opts);
    const after = rAfter ? buildReconciledLedger(arr.filter(x => x !== t), rAfter, opts) : buildLedger(arr.filter(x => x !== t), opts);
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
    const L = opts.recon != null ? buildReconciledLedger(s, opts.recon, { ...opts, method: s.method }) : buildLedger(s.transactions, { ...opts, method: s.method });
    return { ok: L.errorCount === 0, code: L.errorCount ? "has_errors" : "ok", errors: L.txs.filter(x => x.errors.length).map(x => ({ index: x.index, id: x.id, errors: x.errors })), ledger: L };
  }

  // CSV 匯出（給 Excel、Numbers）：開頭加 BOM 讓 Excel 認得 UTF-8；文字欄位開頭是 = + - @ 時前面加 ' ，避免被試算表當成公式執行（CSV 注入）
  const CSV_COLS = [["date", "日期"], ["type", "類型"], ["symbol", "代號"], ["market", "市場"], ["currency", "幣別"], ["shares", "股數"], ["price", "價格"], ["amount", "金額"], ["ratio", "比例"], ["fee", "手續費"], ["tax", "交易稅"], ["note", "備註"], ["source", "來源"], ["id", "編號"]];
  function toCSV(transactions) {
    const cell = (k, v) => { if (v == null) return ""; let t = k === "type" ? (TYPE_LABEL[v] || String(v)) : String(v); if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const rows = (Array.isArray(transactions) ? transactions : []).slice().sort((a, b) => String(a?.date).localeCompare(String(b?.date)));
    return "\ufeff" + [CSV_COLS.map(c => c[1]).join(","), ...rows.map(t => CSV_COLS.map(([k]) => cell(k, t?.[k])).join(","))].join("\r\n") + "\r\n";
  }
  // 備份檔裡的投資組合資料檢查（匯入前用）：鍵序無關，若存在 kline:pf:recon:v1 必須優先解析並驗證，通過才帶入 kline:pf:v1 檢查。
  function checkBackup(data, opts = {}) {
    const items = [], parse = v => { try { return { ok: true, v: JSON.parse(v) }; } catch { return { ok: false }; } };
    const hasRecon = Object.prototype.hasOwnProperty.call(data || {}, "kline:pf:recon:v1");
    let reconOk = false, parsedRecon = null;
    if (hasRecon) {
      const pr = parse(data["kline:pf:recon:v1"]);
      if (!pr.ok) {
        items.push({ key: "kline:pf:recon:v1", label: "對帳快照", ok: false, problems: ["不是正確的 JSON"] });
      } else if (!(opts.recon && typeof opts.recon.validateStore === "function")) {
        items.push({ key: "kline:pf:recon:v1", label: "對帳快照", ok: false, problems: ["沒有對帳快照的檢查程式，為了安全不匯入"] });
      } else {
        const vr = opts.recon.validateStore(pr.v, { today: opts.today, rejectPendingCommit: true });
        const summary = { snapshots: Array.isArray(pr.v?.snapshots) ? pr.v.snapshots.length : 0, conflicts: Array.isArray(pr.v?.conflicts) ? pr.v.conflicts.filter(c => c && c.status === "open").length : 0 };
        if (!vr.ok) {
          items.push({ key: "kline:pf:recon:v1", label: "對帳快照", ok: false, code: vr.code, problems: [vr.error || vr.code], summary });
        } else {
          reconOk = true; parsedRecon = pr.v;
          items.push({ key: "kline:pf:recon:v1", label: "對帳快照", ok: true, problems: [], summary });
        }
      }
    }
    for (const [key, raw] of Object.entries(data || {})) {
      if (key === "kline:pf:recon:v1") continue;
      if (key === STORE_KEY) {
        const p = parse(raw); if (!p.ok) { items.push({ key, label: "交易紀錄", ok: false, problems: ["不是正確的 JSON"] }); continue; }
        const vOpts = { today: opts.today };
        if (hasRecon && reconOk) vOpts.recon = parsedRecon;
        else if (!hasRecon && opts.reconStore) vOpts.recon = opts.reconStore;
        const v = validateStore(p.v, vOpts);
        const tx = Array.isArray(p.v?.transactions) ? p.v.transactions : [], ds = tx.map(t => t?.date).filter(Boolean).sort();
        items.push({ key, label: "交易紀錄", ok: v.ok, problems: v.ok ? [] : [v.code === "has_errors" ? `${v.errors.length} 筆交易有錯誤（例如：${v.errors[0].errors[0].message}）` : v.code === "unsupported_version" ? `版本 ${p.v?.v} 不支援（這版只認得 ${VERSION}）` : v.code],
          summary: { transactions: tx.length, from: ds[0] || null, to: ds[ds.length - 1] || null, method: p.v?.method || null } });
      } else if (key === "kline:pf:margin:v1") {
        const p = parse(raw); if (!p.ok) { items.push({ key, label: "融資帳戶", ok: false, problems: ["不是正確的 JSON"] }); continue; }
        const M = opts.margin; let ok = p.v && p.v.v === 1 && Array.isArray(p.v.accounts), problems = ok ? [] : ["格式或版本不對"];
        if (ok && !(M && typeof M.validateStore === "function")) { ok = false; problems = ["沒有融資資料的檢查程式，為了安全不匯入"]; }
        else if (ok) { const r = M.validateStore(p.v); if (!r.ok) { ok = false; problems = [`${new Set(r.errors.map(e => e.i)).size} 個帳戶資料不對（例如：${r.errors[0].code}）`]; } }
        items.push({ key, label: "融資帳戶", ok, problems, summary: { accounts: Array.isArray(p.v?.accounts) ? p.v.accounts.length : 0 } });
      } else if (key === "kline:pf:targets:v1") {
        const p = parse(raw); if (!p.ok) { items.push({ key, label: "目標配置", ok: false, problems: ["不是正確的 JSON"] }); continue; }
        const Rb = opts.rebal; let ok = !!(Rb && typeof Rb.validateStore === "function"), problems = ok ? [] : ["沒有目標配置的檢查程式，為了安全不匯入"];
        if (ok) { const r = Rb.validateStore(p.v); if (!r.ok) { ok = false; problems = [`目標配置資料不對（${r.errors[0]?.code || r.code} ${r.errors[0]?.error || ""}）`]; } }
        items.push({ key, label: "目標配置", ok, problems, summary: { items: p.v && p.v.targets && typeof p.v.targets === "object" ? Object.keys(p.v.targets).length : 0 } });
      } else if (key === "kline:pf:thesis:v1") {
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

  // 選項 1（持股截圖 → 股票轉入 transfer_in）：先比對現有帳本未平倉部位（含已確認快照）；
  function prepareHoldingsImport(rows, existingTxs = [], opts = {}) {
    const today = validDate(opts.today) ? opts.today : defaultToday();
    const existingArr = Array.isArray(existingTxs) ? existingTxs : [];
    const runner = seqTxs => opts.recon
      ? buildReconciledLedger(seqTxs, opts.recon, { method: opts.method, today, rules: opts.rules })
      : buildLedger(seqTxs, { method: opts.method, today, rules: opts.rules });
    const base = runner(existingArr);
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
    const combined = runner([...existingArr, ...enabled.map(it => it.tx)]);
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
  // 僅比對新匯入列與既有帳本（含 preSnapshot），絕不將同批截圖的兩筆分批成交誤報重複。
  function prepareTradesImport(rows, existingTxs = [], opts = {}) {
    const today = validDate(opts.today) ? opts.today : defaultToday();
    const existingArr = Array.isArray(existingTxs) ? existingTxs : [];
    const runner = seqTxs => opts.recon
      ? buildReconciledLedger(seqTxs, opts.recon, { method: opts.method, today, rules: opts.rules })
      : buildLedger(seqTxs, { method: opts.method, today, rules: opts.rules });
    const base = runner(existingArr);
    const baselines = opts.recon ? getActiveBaselines(opts.recon) : new Map();
    const existingByCore = new Map();
    for (const t of existingArr) {
      const sym = symbolOf(t?.symbol), sh = cleanNum(t?.shares), px = cleanNum(t?.price);
      if (t && (t.type === "buy" || t.type === "sell") && validDate(t.date) && sym && isNum(sh) && isNum(px)) {
        const key = [t.date, t.type, sym, sh, px].join("|");
        const ts = parseTimeSpan(t.time);
        const list = existingByCore.get(key) || [];
        list.push({ time: ts.present && ts.valid ? ts.text : null, note: typeof t.note === "string" ? t.note.trim() : "" });
        existingByCore.set(key, list);
      }
    }
    const timeMeta = new Map(), seqMeta = new Map();
    const items = (Array.isArray(rows) ? rows : []).map((raw, i) => {
      const on = raw?.on !== false;
      const side = raw?.type === "buy" || raw?.side === "buy" ? "buy" : raw?.type === "sell" || raw?.side === "sell" ? "sell" : null;
      const sym = symbolOf(raw?.symbol ?? raw?.code);
      const market = (raw?.market === "tw" || raw?.market === "us") ? raw.market : (sym ? inferMkt(sym, opts.market) : null);
      const currency = market ? CURRENCY[market] : null;
      const dRaw = raw?.date;
      const daIn = raw?.dateAssumed;
      const dateAssumed = daIn === "invalid" ? "invalid" : daIn === "missing" ? "missing" : dRaw == null ? (daIn || "today") : (daIn === "year" || daIn === "today" || daIn === "mdy" ? daIn : null);
      const date = (dateAssumed === "invalid" || dateAssumed === "missing") ? "" : (dRaw == null ? today : typeof dRaw === "string" ? dRaw.trim() : "");
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
      const it = { index: i, raw, on, dateAssumed, ...(altDate ? { altDate } : {}), ...(rawDate ? { rawDate } : {}), time, timeInvalid, type: side, symbol: sym, name: typeof raw?.name === "string" ? raw.name.trim() : "", shares: tx.shares, price: tx.price, fee: tx.fee, tax: tx.tax, dayTrade, date, market, currency, errors: [], warnings: [], tx, computed: null, reconcileHint: null };
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

    const sim = seq => runner([...existingArr, ...seq.map(it => it.tx)]);
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
      it.warnings = res?.warnings ? res.warnings.filter(w => w.code !== "possible_duplicate") : [];
      it.computed = res?.tx || null;
      if (it.dateAssumed === "missing" && !validDate(it.date)) {
        it.errors = it.errors.filter(e => e.code !== "invalid_date");
        it.errors.push({ code: "missing_date", message: "這筆交易沒有日期，請補填或套用截圖基準日" });
      }
      if (it.dateAssumed === "mdy" && validDate(it.date)) {
        it.errors.push({ code: "unconfirmed_date_format", message: it.altDate ? `截圖日期「${it.rawDate || it.date}」可能是月/日（${it.date}）或日/月（${it.altDate}），請確認或切換` : `截圖日期「${it.rawDate || it.date}」格式可能有歧義，請確認日期` });
      }
      if (it.timeInvalid) {
        it.errors.push({ code: "invalid_time", message: "成交時間格式不正確（請填 HH:MM 或 HH:MM:SS，或留空）" });
      }
      if (opts.recon && it.symbol && validDate(it.date)) {
        const B = baselines.get(it.symbol);
        if (B) {
          if (it.date < B.date) it.reconcileHint = "pre_snapshot";
          else if (it.date === B.date) {
            const rel = res?.sameDayRelation;
            it.reconcileHint = (rel === "before_snapshot" || rel === "after_snapshot") ? "post_snapshot" : "same_day_order";
          } else it.reconcileHint = "post_snapshot";
        }
      }
      if (it.on) {
        if (it.symbol && validDate(it.date) && isNum(it.shares) && isNum(it.price)) {
          const hits = existingByCore.get([it.date, it.type, it.symbol, it.shares, it.price].join("|")) || [];
          const ts = timeMeta.get(it), curTime = ts?.present && ts.valid ? ts.text : null, curNote = it.tx.note || "";
          const dupHit = hits.some(ex => {
            if (curTime && ex.time && curTime !== ex.time) return false;
            if (curNote && ex.note && curNote !== ex.note) return false;
            return true;
          });
          if (dupHit) it.warnings.push({ code: "possible_duplicate", message: "帳本裡同一天已有相同代號、方向、股數與價格的交易，請確認不是重複匯入" });
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
      transactions: ordered.map(it => (it.computed && !it.errors.length ? {
        ...it.tx,
        fee: it.computed.fee,
        tax: it.computed.tax,
        ...(it.computed.feeEstimated ? { feeEstimated: true } : {}),
        ...(it.computed.feeEst ? { feeEst: true } : {}),
        ...(it.computed.taxEst ? { taxEst: true } : {}),
        ...(it.computed.assetType && !it.tx.assetType ? { assetType: it.computed.assetType } : {})
      } : it.tx)),
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

  root.KLLedger = Object.freeze({ toCSV, checkBackup, VERSION, STORE_KEY, LEGACY_KEY, TYPES, TYPE_LABEL, METHODS, DEFAULT_RULES, estimateCosts, feeDiff, checkTx, buildLedger, buildReconciledLedger, previewAdd, deleteImpact, makeTx, previewMigration, validateStore, prepareHoldingsImport, prepareTradesImport });
})(typeof window !== "undefined" ? window : globalThis);
