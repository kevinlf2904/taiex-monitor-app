/* 股利現金流行事曆（投資研究第 6 批）：依目前持股，預估未來 12 個月每個月大約領多少現金股利。
   純函式，不讀寫存檔、不連網、不輸出 console、不用 AI。瀏覽器裡是 window.KLDivCal；測試用 node 的 vm 載入。說明：docs/portfolio/DIVIDEND_CALENDAR.md
   口徑：
   · 已公告：除權息預告表（/api/calendar 的 rows）裡、今天以後、有現金股利的，用公告的金額與除息日。
   · 預估：過去 12 個月每一次配息（/api/yield?hist=1 的 divs），照「去年同一天再發一次、金額一樣」往後推；
     同一檔在前後 45 天內已經有公告的就不再估（同一次配息）。不推估成長或減少。
   · 股數用今天持有的股數；只算台股（美股的配息資料這裡沒有）。依除息日排，實際入帳通常晚 3～6 週。
   · 二代健保補充保費：單次股利 ≥ 2 萬元扣 2.11%（只估現金股利；股票股利、所得稅另計）。 */
(function (root) {
  "use strict";
  const VERSION = 1, DAY = 864e5, NHI_RATE = 0.0211, NHI_MIN = 20000, NEAR = 45;
  const isDate = v => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const t = Date.parse(v + "T00:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v; };
  const dn = d => Date.parse(d + "T00:00:00Z");
  const pos = v => typeof v === "number" && Number.isFinite(v) && v > 0, up = c => String(c || "").trim().toUpperCase(), r2 = v => Math.round(v * 100) / 100;
  // 加一年：2/29 變 2/28
  const nextYear = d => { const [y, m, dd] = d.split("-").map(Number), s = `${y + 1}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`; return isDate(s) ? s : `${y + 1}-02-28`; };
  const addMonths = (d, n) => { const [y, m] = d.split("-").map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; };

  // positions：[{ symbol, market, shares }]；hist：{ 代號: [[除息日, 每股現金], …] }；upcoming：/api/calendar 的 rows（{ date, code, cash }）
  function plan({ positions = [], hist = {}, upcoming = [], today, months = 12 } = {}) {
    if (!isDate(today)) return { v: VERSION, status: "invalid", reason: "bad_today", events: [], months: [] };
    const t0 = dn(today), endM = addMonths(today, months - 1), inWin = d => isDate(d) && d >= today && d.slice(0, 7) <= endM;
    const events = [], noData = [], skipped = [];
    for (const p of positions) {
      const c = up(p.symbol); if (!pos(p.shares)) continue;
      if (p.market !== "tw") { skipped.push(c); continue; }
      const H = Array.isArray(hist[c]) ? hist[c].filter(x => Array.isArray(x) && isDate(x[0]) && pos(x[1])) : null;
      const ann = (upcoming || []).filter(r => r && up(r.code) === c && pos(r.cash) && inWin(r.date)).map(r => ({ date: r.date, cash: r.cash }));
      const seen = new Set(), A = ann.filter(a => (seen.has(a.date) ? false : (seen.add(a.date), true)));
      for (const a of A) events.push({ date: a.date, code: c, perShare: a.cash, shares: p.shares, kind: "announced" });
      if (!H) { if (!A.length) noData.push(c); continue; }
      const last12 = H.filter(([d]) => dn(d) < t0 && dn(d) >= t0 - 365 * DAY);
      for (const [d, cash] of last12) {
        const nd = nextYear(d); if (!inWin(nd)) continue;
        if (A.some(a => Math.abs(dn(a.date) - dn(nd)) <= NEAR * DAY)) continue; // 這一次已經公告了
        events.push({ date: nd, code: c, perShare: cash, shares: p.shares, kind: "est", from: d });
      }
      if (!last12.length && !A.length) noData.push(c);
    }
    for (const e of events) { e.amount = r2(e.perShare * e.shares); e.nhi = e.amount >= NHI_MIN ? Math.round(e.amount * NHI_RATE) : 0; e.month = e.date.slice(0, 7); }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
    const M = []; for (let i = 0; i < months; i++) { const m = addMonths(today, i), L = events.filter(e => e.month === m);
      M.push({ month: m, total: r2(L.reduce((s, e) => s + e.amount, 0)), nhi: L.reduce((s, e) => s + e.nhi, 0), est: L.some(e => e.kind === "est"), n: L.length }); }
    const sum = k => r2(events.filter(e => !k || e.kind === k).reduce((s, e) => s + e.amount, 0));
    return { v: VERSION, status: events.length ? "ok" : "empty", today, events, months: M, total: sum(), announced: sum("announced"), est: sum("est"),
      nhi: events.reduce((s, e) => s + e.nhi, 0), noData, skipped, peak: M.reduce((b, m) => (m.total > (b?.total || 0) ? m : b), null) };
  }
  root.KLDivCal = Object.freeze({ VERSION, NHI_RATE, NHI_MIN, plan, nextYear, addMonths });
})(typeof window !== "undefined" ? window : globalThis);
