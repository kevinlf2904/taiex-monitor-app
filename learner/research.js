/* AI 研究室（今日市場「AI 研究」工作區）的資料契約與研究引擎：純函式，不碰 DOM 以外的狀態、不抓資料、不存資料。
   流程：market-center.js 的 researchInput(W) 收集已載入的原始資料 → buildSnapshot() 正規化成「研究資料」（每筆有來源、交易日、更新時間、狀態、信心）
   → gate() 判斷資料夠不夠（不夠就不呼叫 AI，省額度）→ contextText()／prompt() 組成送給 AI 的內容（只送編號過的資料，限制長度）
   → parseReport() 檢查 AI 回傳：格式、引用的資料編號是否存在、數字是否對得上資料 → renderReport() 畫出報告（客觀數據由程式直接列，不經 AI）。
   規格見 docs/ai-research/PHASE_1_DATA_CONTRACT.md、PHASE_2_ENGINE_SPEC.md。瀏覽器裡是 window.KLResearch；測試用 node 的 vm 載入。 */
(function (root) {
  "use strict";
  const VERSION = 1;
  const STATUSES = ["realtime", "delayed", "after_hours", "estimated", "partial", "stale", "unavailable"];
  const STATUS_LABEL = { realtime: "即時", delayed: "延遲", after_hours: "盤後／收盤", estimated: "估算", partial: "部分資料", stale: "過期", unavailable: "未取得" };
  const CONF = { high: "高", medium: "中", low: "低" };
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const day = v => (v ? String(v).slice(0, 10) : null);
  const MAX_CONTEXT = 5000; // 伺服器收 6000 字，留空間給提問

  // 一筆研究資料：缺欄位一律給明確的預設（null／false／low），不補數字
  function rec(o) {
    const r = {
      id: String(o.id), label: String(o.label || o.id), value: isNum(o.value) || typeof o.value === "string" ? o.value : null, unit: o.unit || "",
      symbol: o.symbol || null, market: o.market || "TW", source: o.source || "來源未提供", tradeDate: day(o.tradeDate), updatedAt: o.updatedAt || null,
      tz: o.tz || (o.market === "US" ? "America/New_York" : "Asia/Taipei"), dataStatus: STATUSES.includes(o.dataStatus) ? o.dataStatus : "unavailable",
      isEstimated: !!o.isEstimated, isPartial: !!o.isPartial, confidence: CONF[o.confidence] ? o.confidence : "low", kind: o.kind || "data", note: o.note || ""
    };
    if (r.value == null && r.dataStatus !== "unavailable") r.dataStatus = "unavailable";
    if (r.dataStatus === "unavailable") r.confidence = "low";
    return r;
  }

  // 台股報價的狀態：盤中且來源是即時（富果、證交所 MIS）→ realtime；盤中但是備援來源 → delayed；收盤後同一天 → after_hours；比應有的交易日舊 → stale
  function twQuoteStatus(q, expected, session) {
    if (!q || !isNum(q.price)) return "unavailable";
    if (q.estimated) return "estimated";
    if (expected && day(q.date) && day(q.date) < expected) return "stale";
    if (session === "open") return q.isFallback || q.updateMode === "scheduled" || !/富果|MIS|證交所|twse|fugle/i.test(String(q.source || "")) ? "delayed" : "realtime";
    return "after_hours";
  }
  const US_STATUS = { live: "delayed", delayed: "delayed", confirmed: "after_hours", pending: "partial", partial: "partial", stale: "stale", holiday: "after_hours", unavailable: "unavailable" };

  // 原始資料 → 研究資料快照。input 由 market-center.js 的 researchInput(W) 產生（也可以在測試裡直接給）
  function buildSnapshot(input) {
    const I = input || {}, now = isNum(I.now) ? I.now : Date.now(), expected = day(I.expectedDate), session = I.session || "unknown";
    const R = [], gaps = [], warn = [];
    const push = o => { const r = rec(o); R.push(r); if (r.dataStatus === "unavailable") gaps.push(r.label + "：未取得"); else if (r.dataStatus === "stale") gaps.push(r.label + "：資料過期（" + (r.tradeDate || "日期未提供") + "）"); return r; };

    // 台股指數：價格與漲跌幅分開兩筆（AI 引用時才知道數字是哪一個）
    for (const [code, name] of [["T00", "加權指數"], ["O00", "櫃買指數"]]) {
      const q = I.quotes && I.quotes[code], st = twQuoteStatus(q, expected, session);
      const base = { symbol: code, market: "TW", source: (q && q.source) || "來源未提供", tradeDate: q && q.date, updatedAt: q && (q.fetchedAt || (q.date && q.time ? q.date + "T" + q.time + "+08:00" : null)), dataStatus: st, confidence: st === "realtime" || st === "after_hours" ? "high" : st === "delayed" ? "medium" : "low" };
      push({ ...base, id: "tw." + code + ".price", label: name, value: q && isNum(q.price) ? q.price : null, unit: "點" });
      push({ ...base, id: "tw." + code + ".chg", label: name + "漲跌幅", value: q && isNum(q.chgPct) ? q.chgPct : null, unit: "%" });
    }
    const tq = I.quotes && I.quotes.T00, qDate = tq && day(tq.date);

    // 市場廣度：要和加權同一天才算今天；不同天標 stale 並寫明日期
    const m = I.breadth;
    if (m && m.breadth && isNum(m.breadth.up) && isNum(m.breadth.down)) {
      const same = qDate && day(m.date) === qDate, st = !same ? "stale" : m.live ? "realtime" : "after_hours", part = !isNum(m.breadth.flat);
      const b = { market: "TW", source: m.source || "證交所、櫃買中心", tradeDate: m.date, updatedAt: m.date && m.time ? day(m.date) + "T" + m.time + "+08:00" : null, dataStatus: part && st !== "stale" ? "partial" : st, isPartial: part, confidence: same ? "high" : "low", note: same ? "" : "和加權不同日" };
      push({ ...b, id: "tw.breadth.up", label: "上漲家數", value: m.breadth.up, unit: "家" });
      push({ ...b, id: "tw.breadth.down", label: "下跌家數", value: m.breadth.down, unit: "家" });
      if (isNum(m.breadth.limUp)) push({ ...b, id: "tw.breadth.limUp", label: "漲停家數", value: m.breadth.limUp, unit: "家" });
      if (isNum(m.breadth.limDn)) push({ ...b, id: "tw.breadth.limDn", label: "跌停家數", value: m.breadth.limDn, unit: "家" });
    } else push({ id: "tw.breadth.up", label: "市場廣度", value: null, market: "TW" });

    // 法人：金額是「買賣超張數 × 收盤價」估算，一律 isEstimated；資料日和加權不同日要寫出來（盤中看到前一交易日是正常的，但不能說成今天）
    const F = I.flow;
    if (F && F.date && Array.isArray(F.sectors) && F.sectors.length) {
      const diff = qDate && day(F.date) !== qDate, note = diff ? "法人資料日 " + day(F.date) + "，和加權（" + qDate + "）不同日" : "";
      if (diff) warn.push(note);
      const b = { market: "TW", source: "證交所、櫃買中心三大法人買賣超（金額為估算）", tradeDate: F.date, dataStatus: "estimated", isEstimated: true, confidence: "medium", note };
      if (F.mood) {
        push({ ...b, id: "tw.flow.score", label: "法人情緒分數（0 恐慌～100 樂觀）", value: F.mood.score, unit: "分" });
        if (isNum(F.mood.net)) push({ ...b, id: "tw.flow.net", label: "法人合計淨買超", value: +F.mood.net.toFixed(1), unit: "億元" });
      }
      const pick = sign => F.sectors.filter(x => isNum(x.net1) && x.net1 * sign > 0).sort((a, b2) => (b2.net1 - a.net1) * sign).slice(0, 5); // 雜訊控制：各取前五
      [[1, "in"], [-1, "out"]].forEach(([sign, k]) => pick(sign).forEach((x, i) => {
        const id = "tw.flow." + k + (i + 1), nm = x.name || "未命名族群";
        push({ ...b, id: id + ".net1", label: nm + " 法人淨額", value: +x.net1.toFixed(1), unit: "億元", note: [note, "外資 " + (isNum(x.f1) ? x.f1.toFixed(1) : "—") + "、投信 " + (isNum(x.tr1) ? x.tr1.toFixed(1) : "—") + " 億"].filter(Boolean).join("；") });
        if (isNum(x.net5)) push({ ...b, id: id + ".net5", label: nm + " 近 5 日法人淨額", value: +x.net5.toFixed(1), unit: "億元" });
        if (isNum(x.pct1)) push({ ...b, id: id + ".pct1", label: nm + " 族群漲跌", value: +x.pct1.toFixed(2), unit: "%", dataStatus: "after_hours", isEstimated: false, confidence: "high" });
      }));
    } else push({ id: "tw.flow.net", label: "法人資金流向", value: null, market: "TW", note: F && F.label ? F.label : "" });

    // 關鍵價位：一律是模型推估（isEstimated），和實際報價分開；另外算好加權離各價位的距離，AI 不用自己算
    const L = I.levels;
    if (L && ["pressure", "pivot", "support"].every(k => isNum(L[k]))) {
      const b = { market: "TW", symbol: "T00", source: "KLineLab 技術攻防模型（" + (L.estimate ? "收盤後推估下一交易日" : "盤前推演") + "）", tradeDate: L.forDate, dataStatus: "estimated", isEstimated: true, confidence: "medium", kind: "model" };
      [["pressure", "關鍵壓力（模型推估）"], ["pivot", "多空分水嶺（模型推估）"], ["support", "關鍵支撐（模型推估）"]].forEach(([k, nm]) => push({ ...b, id: "lv." + k, label: nm, value: Math.round(L[k]), unit: "點" }));
      if (tq && isNum(tq.price) && qDate === day(L.forDate)) [["pressure", "壓力"], ["pivot", "分水嶺"], ["support", "支撐"]].forEach(([k, nm]) => push({ ...b, id: "calc.toLv." + k, label: "加權減" + nm + "（正數＝在上方）", value: Math.round(tq.price - L[k]), unit: "點", source: "程式計算：加權報價 − 模型價位", kind: "calc" }));
    } else push({ id: "lv.pivot", label: "技術攻防價位", value: null, market: "TW" });

    // 美股、總經：保留美東時區與各自的資料日；provider 的盤中報價可能延遲，所以 live 也標 delayed
    const U = I.us || {}, us = (Array.isArray(U.rows) ? U.rows : []).filter(x => x && x.code).slice(0, 10);
    if (us.length) us.forEach(x => push({ id: "us." + x.code + ".chg", label: (x.name || x.code) + " 漲跌幅", value: isNum(x.chgPct) ? +x.chgPct.toFixed(2) : null, unit: "%", symbol: x.code, market: "US", source: U.source || "Yahoo Finance", tradeDate: U.dataDate, updatedAt: U.sourceTime ? (U.dataDate || "") + " " + U.sourceTime + "（美東）" : null, tz: "America/New_York", dataStatus: US_STATUS[U.dataStatus] || "partial", confidence: U.dataStatus === "confirmed" ? "high" : "medium" }));
    else push({ id: "us.^GSPC.chg", label: "美股主要指數", value: null, market: "US" });

    // 匯率、原物料、VIX：抓取時間超過 6 小時算過期
    const G = I.global || {}, gAge = G.fetchedAt ? now - Date.parse(G.fetchedAt) : Infinity;
    (Array.isArray(G.rows) ? G.rows : []).forEach(x => push({ id: "gl." + x.code + ".price", label: x.name || x.code, value: isNum(x.price) ? x.price : null, unit: "", symbol: x.code, market: "GLOBAL", source: G.source || "Yahoo Finance", updatedAt: G.fetchedAt || null, tz: "UTC", dataStatus: gAge > 6 * 3600e3 ? "stale" : "delayed", confidence: "medium", note: isNum(x.chgPct) ? "漲跌 " + x.chgPct.toFixed(2) + "%" : "" }));

    // 新聞摘要：是文字不是行情，只當參考來源（可以引用，但不能當數字依據）
    const N = I.news;
    ["tw", "us", "world"].forEach(k => { const s = N && N[k] && N[k].sum; if (s && s.head) push({ id: "news." + k, label: { tw: "台灣", us: "美國", world: "世界" }[k] + "總經新聞摘要", value: String(s.head).slice(0, 80) + (Array.isArray(s.points) && s.points[0] ? "；" + String(s.points[0]).slice(0, 80) : ""), market: k === "tw" ? "TW" : k === "us" ? "US" : "GLOBAL", source: "Google 新聞標題（AI 整理，非行情）", tradeDate: N.date, dataStatus: "after_hours", confidence: "low", kind: "news" }); });
    if (!N || !N.date) gaps.push("總經新聞摘要：未取得");

    return { version: VERSION, generatedAt: now, session, expectedDate: expected, records: R, gaps: [...new Set(gaps)], warnings: warn };
  }

  // 資料夠不夠產生研究報告：加權必須有、不能過期；另外五類（廣度、法人、價位、美股、匯率原物料）至少要有兩類。不夠就不呼叫 AI
  function gate(snap) {
    const ok = id => snap.records.some(r => r.id.startsWith(id) && r.dataStatus !== "unavailable" && r.dataStatus !== "stale");
    if (!ok("tw.T00.price")) return { ok: false, reason: "加權指數報價未取得或已過期，先不產生研究報告" };
    const groups = [["tw.breadth", "市場廣度"], ["tw.flow", "法人資金"], ["lv.", "關鍵價位"], ["us.", "美股"], ["gl.", "匯率原物料"]].filter(([p]) => ok(p));
    if (groups.length < 2) return { ok: false, reason: "可用的資料類別只有 " + groups.length + " 類（至少要 2 類），資料不足，先不產生研究報告" };
    return { ok: true, groups: groups.map(g => g[1]) };
  }

  // 送給 AI 的資料表：一行一筆、有編號；未取得的只列在「缺漏」裡，不佔資料行。不放「現在時間」，同樣的資料才能命中伺服器快取
  function contextText(snap) {
    const fmt = v => (typeof v === "string" ? v : isNum(v) ? String(v) : "—");
    const lines = snap.records.filter(r => r.dataStatus !== "unavailable").map(r => [r.id, r.label, fmt(r.value) + (r.unit ? " " + r.unit : ""), (r.tradeDate || "日期未提供") + (r.market === "US" ? "（美東）" : ""), STATUS_LABEL[r.dataStatus] + (r.isEstimated ? "・估算" : ""), "信心" + CONF[r.confidence], r.source, r.note].filter(Boolean).join(" | "));
    let out = "資料表（編號 | 名稱 | 數值 | 資料日 | 狀態 | 信心 | 來源 | 備註）：\n" + lines.join("\n");
    out += "\n缺漏與過期：" + (snap.gaps.length ? snap.gaps.join("；") : "無");
    if (snap.warnings.length) out += "\n注意：" + snap.warnings.join("；");
    return out.length > MAX_CONTEXT ? out.slice(0, MAX_CONTEXT) : out;
  }

  const SECTIONS = ["summary", "bull", "bear", "sectors", "levels", "scenarios", "risks", "unknowns", "conclusion"];
  function prompt(snap) {
    const ph = snap.session === "open" ? "盤中" : snap.session === "post" ? "收盤後" : snap.session === "pre" ? "盤前" : "休市或時段未確認";
    return "現在是台股" + ph + "。請只根據資料表寫研究報告，用繁體中文，只輸出一個 JSON 物件，不要有其他文字。格式：\n" +
      '{"status":"ok","summary":"兩三句的研究摘要","bull":[{"text":"支持上漲的證據","refs":["資料編號"]}],"bear":[{"text":"支持下跌的證據","refs":[]}],' +
      '"sectors":[{"text":"強勢或弱勢族群與法人資金變化","refs":[]}],"levels":[{"text":"關鍵價位說明","refs":[]}],' +
      '"scenarios":[{"type":"bull","trigger":"觸發條件","watch":"觀察指標","invalidation":"失效條件","refs":[]},{"type":"neutral",…},{"type":"bear",…}],' +
      '"risks":[{"text":"可能推翻結論的資料或事件","refs":[]}],"unknowns":["尚未取得或無法驗證的資訊"],"conclusion":{"text":"條件式結論（如果…則…）","refs":[]}}\n' +
      "規則：1. 每一點都要在 refs 填資料表裡的編號，數字只能用資料表裡出現的，不要自己計算新數字（距離價位的點數已經算好在 calc 開頭的編號）。" +
      "2. 多方、空方各 2～4 點，分開寫，不能只用技術指標推測。3. 標示估算的資料（法人金額、模型價位）要說是估算或推估，不能說成官方數據；新聞摘要只能當消息面參考。" +
      "4. 資料日不同的不要說成同一天，要寫出日期。5. 情境推演一定要有 bull、neutral、bear 三種。6. 結論要是條件式，不要確定性預測，不要買賣建議或目標價。" +
      "7. 如果資料不足以判斷，status 填 \"insufficient\"，unknowns 寫缺什麼，其他欄位可以留空陣列。";
  }

  // 數字檢查：AI 文字裡的數字要能在資料表裡找到（允許四捨五入、正負號、千分位）；日期、時間、小整數（1～10）、常見週期不算
  const SAFE = new Set([20, 60, 120, 240]);
  function numbersIn(text) {
    const t = String(text || "").replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, " ").replace(/\b\d{1,2}[/]\d{1,2}\b/g, " ").replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ").replace(/[A-Za-z][\w.^=]*\d[\w.^=]*/g, " ");
    return (t.match(/\d[\d,]*(\.\d+)?/g) || []).map(s => +s.replace(/,/g, "")).filter(n => Number.isFinite(n));
  }
  function numberOk(n, vals) {
    if ((Number.isInteger(n) && n <= 10) || SAFE.has(n)) return true;
    return vals.some(v => { const a = Math.abs(v); return Math.abs(n - a) <= Math.max(0.051, a * 0.0005) || Math.abs(n - Math.round(a)) < 1e-9 || Math.abs(n - +a.toFixed(1)) < 1e-9; });
  }

  // 檢查 AI 回傳：解析 JSON → 欄位齊不齊 → 引用編號存在嗎 → 數字對得上嗎。問題記在 issues，有問題的那一點標「未驗證」，不默默刪掉
  function parseReport(text, snap) {
    const issues = [], ids = new Set(snap.records.filter(r => r.dataStatus !== "unavailable").map(r => r.id));
    const vals = snap.records.filter(r => isNum(r.value)).map(r => r.value).concat(snap.records.flatMap(r => numbersIn(r.note)));
    let j = null;
    try { const s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""); j = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)); } catch {}
    if (!j || typeof j !== "object") return { ok: false, error: "AI 回應格式錯誤（不是 JSON），已改為只顯示客觀數據", issues: ["format"] };
    if (j.status === "insufficient") return { ok: true, insufficient: true, report: { unknowns: Array.isArray(j.unknowns) ? j.unknowns.map(String).slice(0, 8) : [] }, issues };
    const item = (x, where) => {
      const o = typeof x === "string" ? { text: x, refs: [] } : x && typeof x === "object" ? x : null; if (!o) return null;
      const txt = [o.text, o.trigger, o.watch, o.invalidation].filter(Boolean).map(String).join(" ");
      const refs = (Array.isArray(o.refs) ? o.refs : []).map(String), bad = refs.filter(r => !ids.has(r)), good = refs.filter(r => ids.has(r));
      if (bad.length) issues.push({ type: "ref", where, refs: bad });
      const nums = numbersIn(txt).filter(n => !numberOk(n, vals)); if (nums.length) issues.push({ type: "number", where, nums });
      return { ...o, refs: good, unverified: !!(nums.length || (!good.length && where !== "unknowns")), badRefs: bad, badNums: nums };
    };
    const list = (k, max) => (Array.isArray(j[k]) ? j[k] : []).slice(0, max).map(x => item(x, k)).filter(Boolean);
    const report = { summary: item({ text: String(j.summary || ""), refs: j.summaryRefs || [] }, "summary"), bull: list("bull", 4), bear: list("bear", 4), sectors: list("sectors", 4), levels: list("levels", 4),
      scenarios: list("scenarios", 3), risks: list("risks", 4), unknowns: (Array.isArray(j.unknowns) ? j.unknowns : []).map(String).slice(0, 8), conclusion: item(j.conclusion || {}, "conclusion") };
    report.summary.unverified = report.summary.badNums.length > 0; // 摘要不強制附編號，只檢查數字
    const missing = ["bull", "bear", "scenarios"].filter(k => !report[k].length); if (missing.length) issues.push({ type: "missing", where: missing.join("、") });
    const types = report.scenarios.map(s => s.type); if (!["bull", "neutral", "bear"].every(t => types.includes(t))) issues.push({ type: "scenario", where: "scenarios" });
    if (!report.conclusion || !report.conclusion.text) issues.push({ type: "missing", where: "conclusion" });
    return { ok: true, report, issues };
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtV = r => (isNum(r.value) ? r.value.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : esc(r.value)) + (r.unit ? " " + esc(r.unit) : "");
  // 客觀數據：程式直接從快照列出，不經過 AI
  function factsHtml(snap) {
    const rows = snap.records.filter(r => r.kind !== "news" && r.kind !== "calc");
    return '<details class="rs-facts"><summary>客觀數據（' + rows.filter(r => r.dataStatus !== "unavailable").length + ' 筆，程式直接列出，不經 AI）</summary><div class="rs-tbl" role="table">' +
      rows.map(r => '<div class="rs-row" role="row"><span class="rs-k">' + esc(r.label) + '</span><span class="rs-v">' + (r.dataStatus === "unavailable" ? "—" : fmtV(r)) + '</span><span class="rs-m">' +
        esc([r.tradeDate || "", STATUS_LABEL[r.dataStatus] + (r.isEstimated && r.dataStatus !== "estimated" ? "・估算" : ""), r.source].filter(Boolean).join("・")) + '</span></div>').join("") + '</div></details>';
  }
  function itemHtml(x, snap) {
    const src = x.refs.map(id => snap.records.find(r => r.id === id)).filter(Boolean);
    const cite = src.length ? '<span class="rs-cite">' + src.map(r => esc(r.label) + (r.tradeDate ? "（" + esc(r.tradeDate) + "）" : "")).join("、") + "</span>" : "";
    return '<li' + (x.unverified ? ' class="rs-unv"' : "") + '>' + esc(x.text) + (x.unverified ? ' <span class="rs-flag">⚠︎ 未能對照資料' + (x.badNums && x.badNums.length ? "（" + x.badNums.join("、") + "）" : "") + "</span>" : "") + cite + "</li>";
  }
  const SC = { bull: "偏多情境", neutral: "中性情境", bear: "偏空情境" };
  function renderReport(parsed, snap, meta) {
    const M = meta || {}, P = parsed || {}, R = P.report || {}, sec = (t, body) => (body ? '<section class="rs-sec"><h5>' + t + "</h5>" + body + "</section>" : "");
    const ul = (arr) => (arr && arr.length ? "<ul>" + arr.map(x => itemHtml(x, snap)).join("") + "</ul>" : "");
    const unknowns = [...new Set([...(R.unknowns || []), ...snap.gaps])];
    let h = "";
    if (!P.ok) h += '<p class="rs-err" role="status">⚠︎ ' + esc(P.error || "AI 研究暫時無法產生") + "</p>";
    else if (P.insufficient) h += '<p class="rs-err" role="status">資料不足，AI 沒有產生結論。</p>';
    else {
      if (R.summary && R.summary.text) h += sec("研究摘要", '<p class="rs-sum">' + esc(R.summary.text) + (R.summary.unverified ? ' <span class="rs-flag">⚠︎ 未能對照資料</span>' : "") + "</p>");
      h += '<div class="rs-two">' + sec("多方論點", ul(R.bull) || '<p class="note">沒有足夠證據</p>') + sec("空方論點", ul(R.bear) || '<p class="note">沒有足夠證據</p>') + "</div>";
      h += sec("產業與資金變化", ul(R.sectors)) + sec("關鍵價位（模型推估，非實際報價）", ul(R.levels));
      if (R.scenarios && R.scenarios.length) h += sec("情境推演", '<div class="rs-sc">' + R.scenarios.map(s => '<div class="rs-sc-c ' + esc(s.type) + (s.unverified ? " rs-unv" : "") + '"><b>' + (SC[s.type] || esc(s.type)) + "</b>" +
        [["觸發", s.trigger], ["觀察", s.watch], ["失效", s.invalidation]].filter(x => x[1]).map(x => "<p><span>" + x[0] + "</span>" + esc(x[1]) + "</p>").join("") + "</div>").join("") + "</div>");
      h += sec("風險與反證", ul(R.risks));
      if (R.conclusion && R.conclusion.text) h += sec("研究結論（條件式）", "<ul>" + itemHtml(R.conclusion, snap) + "</ul>");
    }
    h += sec("未知事項", unknowns.length ? "<ul>" + unknowns.map(u => "<li>" + esc(u) + "</li>").join("") + "</ul>" : '<p class="note">無</p>');
    h += factsHtml(snap);
    const issues = (P.issues || []).filter(x => x && x.type);
    const badRef = issues.filter(x => x.type === "ref").length, badNum = issues.filter(x => x.type === "number").length;
    const hm = at => new Date(at + 8 * 3600e3).toISOString().slice(11, 16);
    h += '<p class="note rs-meta">' + [M.at ? "AI 整理於 " + hm(M.at) : "", M.model ? "模型 " + esc(M.model) : "", M.cached ? "沿用快取" : "",
      badRef ? "有 " + badRef + " 處引用了不存在的資料編號（已移除）" : "", badNum ? "有 " + badNum + " 處數字對不上資料（已標 ⚠︎）" : "", "AI 可能出錯，數字以客觀數據為準，不是買賣建議"].filter(Boolean).join("・") + "</p>";
    return '<div class="rs-report">' + h + "</div>";
  }

  // 研究歷史的資料結構（只定義，不存檔；要啟用保存需另外經使用者同意，見 IMPLEMENTATION_PLAN.md）
  function historyRecord(snap, parsed, meta) {
    const R = (parsed && parsed.report) || {}, M = meta || {};
    return { researchId: "rs-" + (M.at || snap.generatedAt).toString(36), researchType: "market_daily", symbol: "T00", market: "TW", createdAt: new Date(M.at || snap.generatedAt).toISOString(),
      dataSnapshot: snap.records.map(r => ({ id: r.id, value: r.value, tradeDate: r.tradeDate, dataStatus: r.dataStatus })), sourceReferences: [...new Set(snap.records.filter(r => r.dataStatus !== "unavailable").map(r => r.source))],
      model: M.model || null, conclusion: R.conclusion ? R.conclusion.text : null, bullCase: (R.bull || []).map(x => x.text), bearCase: (R.bear || []).map(x => x.text),
      invalidationConditions: (R.scenarios || []).map(s => s.invalidation).filter(Boolean), followUpStatus: "pending" };
  }

  const API = Object.freeze({ VERSION, STATUSES, STATUS_LABEL, SECTIONS, rec, twQuoteStatus, buildSnapshot, gate, contextText, prompt, numbersIn, numberOk, parseReport, renderReport, factsHtml, historyRecord });
  root.KLResearch = API;
})(typeof window !== "undefined" ? window : globalThis);
