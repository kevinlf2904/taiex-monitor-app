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
  function fromForm(v, prev = {}, now = null) {
    return { ...prev, reason: String(v.reason || "").trim().slice(0, LIM.text), watch: lines(v.watch), kill: lines(v.kill), status: STATUS.includes(v.status) ? v.status : prev.status || "hold", review: isDate(v.review) ? v.review : null, log: Array.isArray(prev.log) ? prev.log : [], ...(now ? { at: now } : {}) };
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
  // 摘要：幾檔有寫論點、幾檔該檢視、各狀態幾檔（只算目前持有的）
  function summary(store, codes, today) {
    const items = (store && store.items) || {}, S = { total: codes.length, written: 0, due: 0, byStatus: { hold: 0, watch: 0, weak: 0, broken: 0 }, missing: [] };
    for (const c of codes.map(up)) { const it = items[c]; if (!it || !(it.reason || (it.watch && it.watch.length) || (it.kill && it.kill.length))) { S.missing.push(c); continue; }
      S.written++; S.byStatus[it.status || "hold"]++; if (isDate(it.review) && isDate(today) && it.review <= today) S.due++; }
    return S;
  }
  root.KLThesis = Object.freeze({ VERSION, STORE_KEY, STATUS, STATUS_LABEL, KIND_LABEL, LIM, isDate, checkItem, validateStore, fromForm, addLog, catalysts, summary, addDays });
})(typeof window !== "undefined" ? window : globalThis);
