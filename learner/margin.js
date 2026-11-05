/* 融資與擔保品風險（投資組合第 7 階段）：維持率、利息、可用額度、離追繳還有多遠、壓力測試（整體下跌、單一擔保品連續跌停）、需要補多少錢。
   純函式，不讀寫存檔、不連網、不輸出 console。瀏覽器裡是 window.KLMargin；測試用 node 的 vm 載入。
   重要（docs/portfolio/MARGIN.md）：
   · 每個帳戶都標資料來源：broker（券商實際資料）、user（使用者自己填）、estimate（系統估算）。結果一律是「試算」，不是券商的正式追繳通知或可借額度。
   · 門檻（追繳、補足到、斷頭）每個帳戶自己設定，並記錄來源與更新日期；預設值只是常見規定，畫面要提醒以券商為準。
   · 維持率＝擔保品市值 ÷ 借款（融資金額）。擔保品沒有現價時用使用者填的價格並標估算；兩者都沒有就不算。 */
(function (root) {
  "use strict";
  const VERSION = 1, DAY = 864e5, EPS = 1e-9;
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
  // 預設門檻：只是常見規定的參考，一律要使用者確認（source、asOf 會顯示在畫面上）
  const DEFAULT_RULES = {
    margin: { call: 1.30, topUpTo: 1.66, liquidate: null, maxLtv: 0.6, source: "台股融資常見規定：整戶維持率低於 130% 追繳、補足到 166%；上市股融資成數多為 6 成。各券商與個股不同，請以券商通知為準", asOf: "2026-11-01" },
    pledge: { call: 1.30, topUpTo: 1.40, liquidate: 1.20, maxLtv: 0.6, source: "不限用途款項借貸常見條件：維持率 130% 通知、120% 處分；各券商條件不同，請以合約為準", asOf: "2026-11-01" },
    other: { call: null, topUpTo: null, liquidate: null, maxLtv: null, source: "請依合約填寫", asOf: null }
  };
  const SHOCKS = [-0.05, -0.10, -0.15, -0.20, -0.30];
  const LIMIT3 = 1 - Math.pow(0.9, 3); // 台股連續三根跌停約 −27.1%
  // 帳戶：{ id, name, type: margin|pledge|other, source: broker|user|estimate, updatedAt, currency, loan, rate（年利率，0.065＝6.5%）, startDate, termDays,
  //         rules: { call, topUpTo, liquidate, maxLtv, source, asOf }, collateral: [{ symbol, shares, price（手填）, priceDate }], cashCollateral }
  // prices：代號 → { price, date }（現價）；today：YYYY-MM-DD
  function analyze(acct, prices = {}, today = null) {
    const issues = [], at = c => (prices && typeof prices.get === "function" ? prices.get(c) : prices[c]) || null;
    if (!acct || typeof acct !== "object") return { status: "invalid", issues: [{ k: "invalid_account" }] };
    const type = ["margin", "pledge", "other"].includes(acct.type) ? acct.type : "other", R = { ...DEFAULT_RULES[type], ...(acct.rules || {}) };
    const usedDefault = !acct.rules || ["call", "topUpTo", "liquidate"].every(k => acct.rules[k] == null);
    if (usedDefault) issues.push({ k: "default_rules" });
    const loan = isNum(acct.loan) && acct.loan > 0 ? acct.loan : null; if (!loan) issues.push({ k: "no_loan" });
    const cashC = isNum(acct.cashCollateral) && acct.cashCollateral > 0 ? acct.cashCollateral : 0;
    const col = (Array.isArray(acct.collateral) ? acct.collateral : []).map(c => {
      const q = at(String(c.symbol || "").toUpperCase()), live = q && isNum(q.price) && q.price > 0, manual = isNum(c.price) && c.price > 0, sh = isNum(c.shares) && c.shares > 0 ? c.shares : 0;
      const px = live ? q.price : manual ? c.price : null;
      return { symbol: String(c.symbol || "").toUpperCase(), shares: sh, price: px, priceDate: live ? q.date || null : c.priceDate || null, priceSource: live ? "quote" : manual ? "user" : null, value: px != null ? sh * px : null, haircut: isNum(c.haircut) ? c.haircut : null };
    });
    const noPx = col.filter(c => c.price == null), userPx = col.filter(c => c.priceSource === "user");
    if (noPx.length) issues.push({ k: "no_price", codes: noPx.map(c => c.symbol) });
    if (userPx.length) issues.push({ k: "user_price", codes: userPx.map(c => c.symbol) });
    const valued = col.filter(c => c.value != null), mv = valued.reduce((s, c) => s + c.value, 0) + cashC;
    const complete = !noPx.length && !!loan, ratio = loan && mv > EPS ? mv / loan : null;
    // 利息：從開始日到今天（簡單利息，年 365 天）
    const days = acct.startDate && today ? Math.max(0, Math.round((Date.parse(today) - Date.parse(acct.startDate)) / DAY)) : null;
    const interest = loan && isNum(acct.rate) && days != null ? loan * acct.rate * days / 365 : null;
    if (acct.termDays && days != null && days > acct.termDays) issues.push({ k: "term_expired", days, termDays: acct.termDays });
    else if (acct.termDays && days != null && acct.termDays - days <= 30) issues.push({ k: "term_soon", left: acct.termDays - days });
    // 可用額度（只有設定了最高成數才算）：擔保品市值 × 成數 − 借款
    const available = loan != null && isNum(R.maxLtv) && R.maxLtv > 0 ? Math.max(0, mv * R.maxLtv - loan) : null;
    // 離追繳還有多遠：擔保品（不含現金）要跌多少，維持率才會碰到追繳線
    const stockMv = mv - cashC, dropToCall = loan && isNum(R.call) && stockMv > EPS ? 1 - (R.call * loan - cashC) / stockMv : null;
    const dropToLiq = loan && isNum(R.liquidate) && stockMv > EPS ? 1 - (R.liquidate * loan - cashC) / stockMv : null;
    // 補足：維持率低於追繳線時，要補多少現金（補到 topUpTo），或要還多少錢
    const need = r => { if (!loan || !isNum(R.call) || r == null || r >= R.call) return null; const tgt = isNum(R.topUpTo) ? R.topUpTo : R.call; return { cash: r2(Math.max(0, tgt * loan - r * loan)), repay: r2(Math.max(0, loan - (r * loan) / tgt)) }; };
    const state = r => (r == null ? null : isNum(R.liquidate) && r < R.liquidate ? "liquidate" : isNum(R.call) && r < R.call ? "call" : isNum(R.call) && r < R.call * 1.1 ? "near" : "ok");
    // 壓力測試：所有股票擔保品同時下跌 x%（現金不跌）
    const stress = SHOCKS.map(x => { const m = stockMv * (1 + x) + cashC, r = loan ? m / loan : null; return { shock: x, value: r2(m), ratio: r == null ? null : r4(r), state: state(r), need: need(r) }; });
    // 單一擔保品連續三根跌停（約 −27.1%），其他不動：找出影響最大的那一檔
    const single = valued.map(c => { const m = mv - c.value * LIMIT3, r = loan ? m / loan : null; return { symbol: c.symbol, weight: mv > EPS ? r4(c.value / mv) : null, value: r2(m), ratio: r == null ? null : r4(r), state: state(r), need: need(r) }; }).sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity));
    const source = ["broker", "user", "estimate"].includes(acct.source) ? acct.source : "user";
    return { status: complete ? "ok" : loan ? "incomplete" : "invalid", source, official: false, id: acct.id || null, name: acct.name || null, type, currency: acct.currency || "TWD",
      rules: { call: R.call ?? null, topUpTo: R.topUpTo ?? null, liquidate: R.liquidate ?? null, maxLtv: R.maxLtv ?? null, source: R.source || null, asOf: R.asOf || null, isDefault: usedDefault },
      loan: loan == null ? null : r2(loan), collateralValue: r2(mv), cashCollateral: r2(cashC), collateral: col.map(c => ({ ...c, value: c.value == null ? null : r2(c.value), weight: c.value != null && mv > EPS ? r4(c.value / mv) : null })),
      ratio: ratio == null ? null : r4(ratio), state: state(ratio), need: need(ratio), interest: interest == null ? null : r2(interest), days, available: available == null ? null : r2(available),
      dropToCall: dropToCall == null ? null : r4(dropToCall), dropToLiquidate: dropToLiq == null ? null : r4(dropToLiq), stress, singleLimitDown: single, riskiest: single[0] || null, issues };
  }
  // 存檔 kline:pf:margin:v1 → { v: 1, accounts: [...] } 的格式檢查（寫入前用）
  function validateStore(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, code: "invalid_root" };
    if (s.v !== VERSION) return { ok: false, code: "unsupported_version" };
    if (!Array.isArray(s.accounts)) return { ok: false, code: "invalid_accounts" };
    const ids = new Set(), errors = [];
    s.accounts.forEach((a, i) => {
      if (!a || typeof a !== "object") return errors.push({ i, code: "invalid_account" });
      if (!a.id || ids.has(a.id)) errors.push({ i, code: "duplicate_or_missing_id" }); ids.add(a.id);
      if (!(isNum(a.loan) && a.loan > 0)) errors.push({ i, code: "invalid_loan" });
      if (a.rate != null && !(isNum(a.rate) && a.rate >= 0 && a.rate < 1)) errors.push({ i, code: "invalid_rate" });
      for (const k of ["call", "topUpTo", "liquidate", "maxLtv"]) { const v = a.rules?.[k]; if (v != null && !(isNum(v) && v > 0 && v < 10)) errors.push({ i, code: "invalid_rule_" + k }); }
      if (a.rules?.call != null && a.rules?.topUpTo != null && a.rules.topUpTo < a.rules.call) errors.push({ i, code: "topup_below_call" });
      (a.collateral || []).forEach((c, j) => { if (!c || !c.symbol || !(isNum(c.shares) && c.shares > 0)) errors.push({ i, j, code: "invalid_collateral" }); });
    });
    return { ok: !errors.length, errors };
  }
  const ISSUE_LABEL = { default_rules: "門檻用的是預設值（常見規定），請改成你券商或合約的條件", no_loan: "沒有填借款金額", no_price: "有擔保品沒有價格，沒算進市值",
    user_price: "有擔保品沒有現價，用你填的價格", term_expired: "借款已經超過期限", term_soon: "借款快到期了" };
  const SOURCE_LABEL = { broker: "券商資料", user: "自己填的", estimate: "系統估算" };
  root.KLMargin = Object.freeze({ VERSION, DEFAULT_RULES, SHOCKS, LIMIT3, analyze, validateStore, ISSUE_LABEL, SOURCE_LABEL });
})(typeof window !== "undefined" ? window : globalThis);
