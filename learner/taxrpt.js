/* 年度報稅彙整：從交易紀錄整理某一年的現金股利、已扣稅款、已實現損益、手續費與證交稅，給申報綜合所得稅、最低稅負制時對帳用。
   純函式，不讀寫存檔、不連網、不輸出 console、不用 AI。瀏覽器裡是 window.KLTaxRpt；測試用 node 的 vm 載入。說明：docs/portfolio/TAX_REPORT.md
   輸入：KLLedger.buildReconciledLedger（或 buildLedger）的結果 L（用 positions[].history 的已實現與股息，和投資組合同一口徑）、
        交易清單 txs（股息的總額與扣繳要從交易本身讀）、年份 year、美元兌台幣 fx（只用來估海外所得有沒有到 100 萬，沒有就不換算）。
   口徑：
   · 台股現金股利：總額＝交易金額，扣款＝交易的「稅」欄（通常是二代健保補充保費）；單筆 2 萬元以上、帳本沒記扣款的列出來提醒（可能被扣了 2.11% 沒記）。
   · 台股已實現：證券交易所得目前停徵所得稅，只列出來對帳。
   · 美股：股息總額與預扣稅（通常 30%）；已實現損益是海外財產交易所得，同一年度盈虧可以互抵，虧損不能抵股息。
   · 海外所得＝美股股息總額＋max(0, 美股已實現)，換算台幣後未達 100 萬元不用計入基本所得額；到了要不要繳稅還要看扣除額，以國稅局當年公告為準。
   · 只整理帳本有記的交易，不是報稅建議；扣繳憑單、券商對帳單才是申報依據。 */
(function (root) {
  "use strict";
  const VERSION = 1, OVERSEAS_MIN = 1000000, NHI_MIN = 20000, NHI_RATE = 0.0211;
  const r2 = v => Math.round(v * 100) / 100, num = v => typeof v === "number" && Number.isFinite(v);
  const yearOf = d => (typeof d === "string" && /^\d{4}-/.test(d) ? d.slice(0, 4) : null);

  // 帳本裡出現過的年份（新的在前）
  function years(txs) { return [...new Set((txs || []).map(t => yearOf(t && t.date)).filter(Boolean))].sort().reverse(); }

  function build({ L, txs = [], year, fx = null } = {}) {
    const Y = String(year || ""), byId = new Map((txs || []).filter(t => t && t.id).map(t => [t.id, t]));
    const mk = () => ({ divGross: 0, divTax: 0, divNet: 0, divN: 0, realized: 0, gain: 0, loss: 0, fees: 0, tradeTax: 0, sold: 0 });
    const M = { tw: mk(), us: mk() }, rows = new Map(), nhiMiss = [], unknown = [];
    const row = p => { const k = p.symbol; if (!rows.has(k)) rows.set(k, { symbol: k, market: p.market, currency: p.currency, divGross: 0, divTax: 0, realized: 0 }); return rows.get(k); };
    for (const p of (L && L.positions) || []) {
      const m = M[p.market]; if (!m) { unknown.push(p.symbol); continue; }
      for (const h of p.history || []) {
        if (yearOf(h.date) !== Y) continue;
        if (num(h.realized)) { const r = row(p); r.realized += h.realized; m.realized += h.realized; if (h.realized >= 0) m.gain += h.realized; else m.loss += h.realized; }
        if (num(h.dividend)) {
          const t = byId.get(h.id), gross = t && num(t.amount) ? t.amount : h.dividend, tax = t && num(t.tax) ? t.tax : 0, r = row(p);
          r.divGross += gross; r.divTax += tax; m.divGross += gross; m.divTax += tax; m.divNet += gross - tax; m.divN++;
          if (p.market === "tw" && gross >= NHI_MIN && !(tax > 0)) nhiMiss.push({ symbol: p.symbol, date: h.date, amount: r2(gross), est: Math.round(gross * NHI_RATE) });
        }
      }
    }
    // 手續費、證交稅（買賣與零股結算）：直接從交易讀，台股是台幣、美股是美元
    for (const t of txs || []) {
      if (!t || yearOf(t.date) !== Y || !["buy", "sell", "fraction_cash"].includes(t.type)) continue; const m = M[t.market]; if (!m) continue;
      if (num(t.fee)) m.fees += t.fee; if (t.type !== "buy" && num(t.tax)) m.tradeTax += t.tax;
      if (t.type === "sell" && num(t.shares) && num(t.price)) m.sold += t.shares * t.price;
    }
    for (const m of Object.values(M)) for (const k of Object.keys(m)) m[k] = k === "divN" ? m[k] : r2(m[k]);
    const usOverseas = M.us.divGross + Math.max(0, M.us.realized), rate = num(fx) && fx > 0 ? fx : null;
    const overseasTWD = rate ? Math.round(usOverseas * rate) : null;
    return {
      v: VERSION, year: Y, tw: M.tw, us: M.us,
      rows: [...rows.values()].map(r => ({ ...r, divGross: r2(r.divGross), divTax: r2(r.divTax), realized: r2(r.realized) })).sort((a, b) => a.market.localeCompare(b.market) || (b.divGross + Math.abs(b.realized)) - (a.divGross + Math.abs(a.realized)) || a.symbol.localeCompare(b.symbol)),
      overseas: { usd: r2(usOverseas), twd: overseasTWD, fx: rate, over: overseasTWD == null ? null : overseasTWD >= OVERSEAS_MIN, min: OVERSEAS_MIN },
      nhiMiss, unknown,
      empty: !rows.size && !M.tw.fees && !M.us.fees,
    };
  }

  // 匯出 CSV（有 BOM，Excel 打得開）：每檔一列＋小計；開頭是 = + - @ 的文字前面加 ' 防止被當成公式
  function toCSV(R, name = c => c) {
    const q = v => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const L = [["年度", "市場", "代號", "名稱", "幣別", "現金股利總額", "已扣稅款／保費", "已實現損益"].join(",")];
    for (const r of R.rows) L.push([R.year, r.market === "tw" ? "台股" : "美股", r.symbol, name(r.symbol), r.currency, r.divGross, r.divTax, r.realized].map(q).join(","));
    for (const [k, m, c] of [["台股小計", R.tw, "TWD"], ["美股小計", R.us, "USD"]]) L.push([R.year, k, "", "", c, m.divGross, m.divTax, m.realized].map(q).join(","));
    L.push([R.year, "手續費", "", "", "TWD／USD", R.tw.fees, R.us.fees, ""].map(q).join(","));
    if (R.overseas.twd != null) L.push([R.year, "海外所得（估）", "", "", "TWD", R.overseas.twd, "", ""].map(q).join(","));
    return "﻿" + L.join("\n") + "\n";
  }

  root.KLTaxRpt = Object.freeze({ VERSION, OVERSEAS_MIN, NHI_MIN, NHI_RATE, years, build, toCSV });
})(typeof window !== "undefined" ? window : globalThis);
