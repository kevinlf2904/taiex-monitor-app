/* 投資論點追蹤與持股催化日曆（投資研究第 1 批）：每檔持股記下為什麼買、要觀察什麼、什麼情況代表論點不成立、下次什麼時候檢視，
   再把持股的除權息、法說會、美股財報日與論點檢視日排成一份「近期事件」。純函式，不讀寫存檔、不連網、不輸出 console、不用 AI。
   瀏覽器裡是 window.KLThesis；測試用 node 的 vm 載入。說明：docs/portfolio/THESIS.md
   存檔（由畫面寫入 localStorage 的 kline:pf:thesis:v1）：{ v: 1, items: { 代號: { reason, watch: [文字], kill: [文字], status, review, log: [{ d, status, note }], at } }, at } */
(function (root) {
  "use strict";
  const VERSION = 1, STORE_KEY = "kline:pf:thesis:v1", DAY = 864e5;
  const STATUS = ["hold", "watch", "weak", "broken"];
  const STATUS_LABEL = { hold: "論點成立", watch: "觀察中", weak: "論點動搖", broken: "論點失效" };
  const KIND_LABEL = { exdiv: "除權息", conf: "法說會", earn_us: "財報（美股）", review: "論點檢視" };
  const LIM = { text: 2000, item: 300, list: 20, log: 200, items: 500 };
  // 日期要真的存在：解析後轉回字串要一模一樣（2 月 30 日之類 JS 會自動進位成 3 月，要擋掉）
  const isDate = v => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const t = Date.parse(v + "T00:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v; };
  const up = c => String(c || "").trim().toUpperCase();
  const isCode = c => /^[0-9A-Z][0-9A-Z.\-]{0,11}$/.test(c);
  const dn = d => Date.parse(d + "T00:00:00Z");
  const addDays = (d, n) => new Date(dn(d) + n * DAY).toISOString().slice(0, 10);

  // 停損／停利：{ mode: "price"（價格）| "pct"（相對平均成本的百分比）, v }。停損的百分比要是負的（例如 −10）、停利要是正的
  const okLevel = (x, k) => !!x && typeof x === "object" && (x.mode === "price" ? typeof x.v === "number" && x.v > 0 && x.v < 1e7
    : x.mode === "pct" && typeof x.v === "number" && Number.isFinite(x.v) && (k === "stop" ? x.v < 0 && x.v > -100 : x.v > 0 && x.v <= 1000));
  // 一檔的論點：檢查格式，回傳錯誤代碼（空陣列＝沒問題）
  function checkItem(code, it) {
    const E = [], str = (v, n) => v == null || (typeof v === "string" && v.length <= n), list = v => v == null || (Array.isArray(v) && v.length <= LIM.list && v.every(x => typeof x === "string" && x.length <= LIM.item));
    if (!isCode(up(code))) E.push("invalid_code");
    if (!it || typeof it !== "object" || Array.isArray(it)) return [...E, "invalid_item"];
    if (!str(it.reason, LIM.text)) E.push("invalid_reason");
    if (!list(it.watch)) E.push("invalid_watch");
    if (!list(it.kill)) E.push("invalid_kill");
    if (it.status != null && !STATUS.includes(it.status)) E.push("invalid_status");
    if (it.review != null && !isDate(it.review)) E.push("invalid_review");
    for (const k of ["stop", "take"]) if (it[k] != null && !okLevel(it[k], k)) E.push("invalid_" + k);
    if (it.log != null && !(Array.isArray(it.log) && it.log.length <= LIM.log && it.log.every(x => x && isDate(x.d) && (x.status == null || STATUS.includes(x.status)) && str(x.note, LIM.text)))) E.push("invalid_log");
    return E;
  }
  // 整份存檔：寫入前與匯入備份前都要過
  function validateStore(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, code: "invalid_root", errors: [] };
    if (s.v !== VERSION) return { ok: false, code: "unsupported_version", errors: [] };
    if (!s.items || typeof s.items !== "object" || Array.isArray(s.items)) return { ok: false, code: "invalid_items", errors: [] };
    const keys = Object.keys(s.items); if (keys.length > LIM.items) return { ok: false, code: "too_many", errors: [] };
    const errors = []; for (const k of keys) { const e = checkItem(k, s.items[k]); if (e.length) errors.push({ code: k, errors: e }); }
    return { ok: !errors.length, code: errors.length ? "has_errors" : "ok", errors };
  }
  // 從表單文字整理成一筆論點：多行文字拆成清單（去掉空行、前後空白）
  const lines = t => String(t || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, LIM.list).map(x => x.slice(0, LIM.item));
  // 表單的停損／停利：空白＝不設；價格要大於 0；百分比停損自動變成負的、停利變成正的（使用者常打 10 表示 −10%）
  function levelFrom(val, mode, k) {
    const t = String(val ?? "").trim(); if (!t) return null; const n = Number(t); if (!Number.isFinite(n) || n === 0) return null;
    if (mode === "pct") { const v = k === "stop" ? -Math.abs(n) : Math.abs(n); return okLevel({ mode, v }, k) ? { mode, v } : null; }
    return n > 0 && okLevel({ mode: "price", v: n }, k) ? { mode: "price", v: n } : null;
  }
  function fromForm(v, prev = {}, now = null) {
    const lv = k => (v[k] === undefined ? prev[k] ?? null : levelFrom(v[k], v[k + "Mode"] === "pct" ? "pct" : "price", k));
    return { ...prev, stop: lv("stop"), take: lv("take"), reason: String(v.reason || "").trim().slice(0, LIM.text), watch: lines(v.watch), kill: lines(v.kill), status: STATUS.includes(v.status) ? v.status : prev.status || "hold", review: isDate(v.review) ? v.review : null, log: Array.isArray(prev.log) ? prev.log : [], ...(now ? { at: now } : {}) };
  }
  // 加一筆檢視紀錄（最新的在前面），同時更新目前狀態；下次檢視日往後排 every 天（沒給就不動）
  function addLog(it, { d, status, note }, every = null) {
    const log = [{ d, ...(STATUS.includes(status) ? { status } : {}), note: String(note || "").trim().slice(0, LIM.text) }, ...((it && it.log) || [])].slice(0, LIM.log);
    return { ...(it || {}), log, ...(STATUS.includes(status) ? { status } : {}), ...(every ? { review: addDays(d, every) } : {}) };
  }

  // 近期事件：只列持股（codes）的事件，today 起 days 天內；論點檢視日已經過了的列在最前面（標「過期」）
  // cal：/api/calendar 的回應（rows：除權息、conf：法說會）；us：美股財報行事曆的列 [日期, 代號, 名稱, …, 時段(7), 財報季(8)]
  function catalysts({ codes = [], cal = null, us = [], store = null, today, days = 60, name = c => c } = {}) {
    if (!isDate(today)) return [];
    const mine = new Set(codes.map(up)), end = addDays(today, days), inWin = d => isDate(d) && d >= today && d <= end, out = [];
    for (const r of (cal && cal.rows) || []) { const c = up(r && r.code); if (mine.has(c) && inWin(r.date)) out.push({ date: r.date, code: c, kind: "exdiv", text: `${r.kind || "除權息"}${r.cash ? `・現金 ${r.cash} 元` : ""}${r.stock ? `・股票 ${r.stock} 元` : ""}` }); }
    for (const r of (cal && cal.conf) || []) { const c = up(r && r.code); if (mine.has(c) && inWin(r.date)) out.push({ date: r.date, code: c, kind: "conf", text: `法說會${r.time ? ` ${r.time}` : ""}${r.place ? `・${r.place}` : ""}` }); }
    for (const r of us || []) { if (!Array.isArray(r)) continue; const c = up(r[1]); if (mine.has(c) && inWin(r[0])) out.push({ date: r[0], code: c, kind: "earn_us", text: `財報${r[8] ? ` ${r[8]}` : ""}${r[7] ? `・${r[7]}` : ""}${r[5] != null ? `・預估 EPS ${r[5]}` : ""}` }); }
    for (const [k, it] of Object.entries((store && store.items) || {})) {
      const c = up(k); if (!mine.has(c) || !it || !isDate(it.review)) continue;
      if (it.review < today) out.push({ date: it.review, code: c, kind: "review", overdue: true, text: `論點該檢視了（已過 ${Math.round((dn(today) - dn(it.review)) / DAY)} 天）` });
      else if (it.review <= end) out.push({ date: it.review, code: c, kind: "review", text: "論點檢視" });
    }
    // 同一天同一檔同一種只留一筆（資料源偶爾重複）；過期的檢視排最前面，其他依日期
    const seen = new Set(), uniq = out.filter(e => { const k = `${e.date}|${e.code}|${e.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return uniq.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || a.date.localeCompare(b.date) || a.code.localeCompare(b.code)).map(e => ({ ...e, name: name(e.code), label: KIND_LABEL[e.kind] }));
  }
  // 停損／停利檢查：avgCost＝平均成本、price＝現價（原幣）。回傳兩個價位、離現價多遠（現價要再跌／漲多少 %）、狀態
  // 狀態：stop_hit（跌破停損）、take_hit（漲過停利）、near_stop／near_take（差 near % 以內）、ok、none（沒設）、no_price、no_cost（用百分比但沒有成本）
  function levels(it, { avgCost = null, price = null, near = 5 } = {}) {
    const lp = x => (!x ? null : x.mode === "price" ? x.v : typeof avgCost === "number" && avgCost > 0 ? avgCost * (1 + x.v / 100) : null);
    const stopPrice = lp(it && it.stop), takePrice = lp(it && it.take), r4 = v => Math.round(v * 1e4) / 1e4;
    if (stopPrice == null && takePrice == null) return { state: it && (it.stop || it.take) ? "no_cost" : "none", stopPrice: null, takePrice: null };
    if (!(typeof price === "number" && price > 0)) return { state: "no_price", stopPrice, takePrice };
    const toStop = stopPrice == null ? null : r4(stopPrice / price - 1), toTake = takePrice == null ? null : r4(takePrice / price - 1);
    const state = stopPrice != null && price <= stopPrice ? "stop_hit" : takePrice != null && price >= takePrice ? "take_hit"
      : toStop != null && -toStop * 100 <= near ? "near_stop" : toTake != null && toTake * 100 <= near ? "near_take" : "ok";
    return { state, stopPrice: Math.round(stopPrice * 100) / 100 || null, takePrice: Math.round(takePrice * 100) / 100 || null, toStop, toTake };
  }
  // 財報指標（第 4 批）：/api/oapi?earn=1 的一列 [代號, 名稱, 產業, 市場, 當月營收(億), 月增%, 年增%, 累計年增%, EPS, 季營收(億), 稅後淨利(億), 毛利率, 營益率, 淨利率]
  // 「要觀察的」每一項用關鍵字對到一個指標（累計營收要比營收先比對）；對不到就不帶
  const KPI = [["cum", "累計營收年增", 7, "pct", /累計/], ["gm", "毛利率", 11, "rate", /毛利/], ["om", "營益率", 12, "rate", /營益|營業利益/], ["nm", "淨利率", 13, "rate", /淨利率|純益率/],
    ["eps", "EPS", 8, "num", /EPS|每股盈餘/i], ["yoy", "月營收年增", 6, "pct", /營收/]];
  const KPI_ORDER = ["yoy", "cum", "eps", "gm", "om", "nm"];
  const fmtKpi = (t, v) => (v == null ? "—" : t === "pct" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : t === "rate" ? `${v.toFixed(1)}%` : String(+v.toFixed(2)));
  function kpis(row) {
    if (!Array.isArray(row)) return [];
    const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return KPI_ORDER.map(k => { const d = KPI.find(x => x[0] === k), v = num(row[d[2]]);
      return { k, label: d[1], v, text: fmtKpi(d[3], v), period: k === "yoy" || k === "cum" ? "month" : "quarter", bad: v != null && ((k === "yoy" || k === "cum" || k === "eps") ? v < 0 : false) }; });
  }
  const matchWatch = t => { const s = String(t || ""); const d = KPI.find(x => x[4].test(s)); return d ? d[0] : null; };
  // 簡易估值（第 5 批）：price＝現價；pe／pb／dy＝目前本益比、淨值比、殖利率（證交所、櫃買中心每日公布）；peers＝同產業其他公司的本益比；hist＝這檔過去的本益比（每天一筆）
  // 近四季 EPS 用 現價 ÷ 本益比 反推；情境價＝EPS × 歷史本益比的 20%／50%／80% 分位（和個股頁的本益比色帶同一種算法）。本益比沒有資料（missing）或不是正數（nonpos）都不算；不在這裡判斷「虧損」（缺值不一定是虧損）。
  function valuation({ price = null, pe = null, pb = null, dy = null, peers = [], hist = [] } = {}) {
    const pos = v => typeof v === "number" && Number.isFinite(v) && v > 0, r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
    const qt = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    const out = { pe: pos(pe) ? pe : null, pb: pos(pb) ? pb : null, dy: typeof dy === "number" && Number.isFinite(dy) && dy >= 0 ? dy : null, peState: pos(pe) ? "ok" : typeof pe === "number" && Number.isFinite(pe) ? "nonpos" : "missing", eps: null, ind: null, band: null, scen: [] };
    if (pos(price) && out.pe) out.eps = r2(price / out.pe);
    const P = (peers || []).filter(pos).sort((a, b) => a - b);
    if (P.length >= 3) { const med = P.length % 2 ? P[(P.length - 1) / 2] : (P[P.length / 2 - 1] + P[P.length / 2]) / 2; out.ind = { median: r2(med), n: P.length, vs: out.pe ? r4(out.pe / med - 1) : null, price: out.eps ? r2(out.eps * med) : null }; }
    const H = (hist || []).filter(pos), S = H.slice().sort((a, b) => a - b), cur = out.pe;
    if (S.length >= 60) {
      out.band = { lo: qt(S, 0.2), mid: qt(S, 0.5), hi: qt(S, 0.8), n: S.length, pct: cur ? Math.round(S.filter(v => v <= cur).length / S.length * 100) : null };
      if (out.eps && pos(price)) out.scen = [["bear", out.band.lo], ["base", out.band.mid], ["bull", out.band.hi]].map(([k, m]) => ({ k, pe: m, price: r2(out.eps * m), chg: r4(out.eps * m / price - 1) }));
    }
    return out;
  }
  const SCEN_LABEL = { bear: "悲觀", base: "中性", bull: "樂觀" };
  const LEVEL_LABEL = { stop_hit: "已跌破停損", take_hit: "已漲過停利", near_stop: "接近停損", near_take: "接近停利", ok: "還沒觸及", none: "沒設停損停利", no_price: "沒有報價", no_cost: "沒有成本，百分比算不出價位" };
  // 摘要：幾檔有寫論點、幾檔該檢視、各狀態幾檔（只算目前持有的）
  function summary(store, codes, today) {
    const items = (store && store.items) || {}, S = { total: codes.length, written: 0, due: 0, byStatus: { hold: 0, watch: 0, weak: 0, broken: 0 }, missing: [] };
    for (const c of codes.map(up)) { const it = items[c]; if (!it || !(it.reason || (it.watch && it.watch.length) || (it.kill && it.kill.length))) { S.missing.push(c); continue; }
      S.written++; S.byStatus[it.status || "hold"]++; if (isDate(it.review) && isDate(today) && it.review <= today) S.due++; }
    return S;
  }
  root.KLThesis = Object.freeze({ VERSION, STORE_KEY, STATUS, STATUS_LABEL, KIND_LABEL, LIM, isDate, checkItem, validateStore, fromForm, addLog, catalysts, summary, addDays, levels, LEVEL_LABEL, levelFrom, kpis, matchWatch, valuation, SCEN_LABEL });
})(typeof window !== "undefined" ? window : globalThis);
