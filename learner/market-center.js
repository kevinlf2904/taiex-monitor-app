// KLineLab 今日市場 V2：以既有行情與分析模型重排成視覺化決策儀表板，不建立第二套資料管線。
(() => {
  "use strict";

  const WORKSPACES = Object.freeze([
    { id: "overview", label: "市場總覽", title: "市場總覽", description: "先看加權走勢、個股廣度與族群資金，再查看自己的持倉。" },
    { id: "capital", label: "資金籌碼", title: "資金籌碼", description: "先核對法人資料日期，再看流入、流出與近五日輪動；金額為估算。" },
    { id: "global", label: "全球總經", title: "全球總經", description: "整合美股與國際市場行情；每個標的分別標示日期、來源時間與資料狀態。" },
    { id: "research", label: "AI 研究", title: "AI 研究室", description: "集中查看 AI 整理結果；資料不足或尚未產生時會明確標示。" },
    { id: "technical", label: "技術攻防", title: "技術攻防", description: "盤前關鍵位階、盤中確認與盤後驗證；模型推估不等於即時報價。" }
  ]);

  const normalizeWorkspace = value => WORKSPACES.some(item => item.id === value) ? value : "overview";
  const isNum = value => typeof value === "number" && Number.isFinite(value);
  const numberFmt = (value, digits = 2) => isNum(value) ? value.toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: 0 }) : "—";
  const signed = (value, digits = 2) => isNum(value) ? (value > 0 ? "+" : "") + value.toFixed(digits) : "—";
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const getQuote = (W, code) => {
    try { return W && W.quotes && typeof W.quotes.get === "function" ? W.quotes.get(code) || null : null; }
    catch { return null; }
  };

  function ensureState(W) {
    if (!W || typeof W !== "object") return null;
    if (!W.marketCenter || typeof W.marketCenter !== "object") {
      W.marketCenter = { workspace: "overview", selectedSector: null, selectedStock: null, analysisDate: null };
    }
    W.marketCenter.workspace = normalizeWorkspace(W.marketCenter.workspace);
    return W.marketCenter;
  }

  function readFlow(W) {
    let model = null, sectors = [], mood = null;
    try {
      if (typeof mfModel === "function") model = mfModel();
    } catch {}
    if (!model && W && W.mfModel && typeof W.mfModel === "object") model = W.mfModel;
    if (!model || !model.secs || !model.stocks || !model.T) return { model: null, sectors: [], mood: null, date: null };

    try { if (typeof flowAt === "function") sectors = flowAt(model) || []; } catch {}
    try { if (typeof flowMood === "function") mood = flowMood(model) || null; } catch {}
    const date = Array.isArray(model.dates) ? model.dates[model.T - 1] : null;
    const stocks = model.stocks instanceof Map ? Array.from(model.stocks.values()) : Object.values(model.stocks || {});
    const hasAmount = stocks.some(stock => Array.isArray(stock.amt) && stock.amt[model.T - 1] != null);
    return { model: hasAmount ? model : null, sectors: hasAmount ? sectors : [], mood, date };
  }

  function ensurePanel(page, selector, className, workspace, html) {
    let panel = page.querySelector(selector);
    if (!panel) {
      panel = page.ownerDocument.createElement("section");
      panel.className = className;
    }
    panel.dataset.mcSection = workspace;
    panel.innerHTML = html;
    return panel;
  }

  function flowMoney(value) {
    return isNum(value) ? (value > 0 ? "+" : "") + (Math.abs(value) >= 100 ? Math.round(value) : value.toFixed(1)) + " 億" : "—";
  }

  // 法人資料與加權行情必須先核對交易日期；日期不一致時只能當作另一交易日的參考。
  function flowAlignment(W, flow) {
    const quoteDate = getQuote(W, "T00")?.date || null;
    const flowDate = flow?.date || null;
    if (!flowDate) return {
      tone: "unknown", label: "法人日期未提供",
      note: "法人資料日期未提供，暫不判定是否與加權行情同日。",
      quoteDate, flowDate
    };
    if (!quoteDate) return {
      tone: "unknown", label: "加權日期未提供",
      note: "法人資料日期 " + flowDate + "；加權行情日期未提供，暫不判定是否同日。",
      quoteDate, flowDate
    };
    const aligned = String(flowDate).slice(0, 10) === String(quoteDate).slice(0, 10);
    return {
      tone: aligned ? "ok" : "warn",
      label: aligned ? "與加權同日" : "日期未對齊",
      note: aligned
        ? "法人資料與加權行情同為 " + flowDate + "。"
        : "法人資料日期 " + flowDate + "，加權行情日期 " + quoteDate + "，不是同日資料；請勿視為今日同步資金流向。",
      quoteDate, flowDate
    };
  }

  function flowRow(item, max) {
    const value = item.net1;
    if (!isNum(value)) return "";
    const width = Math.max(2, Math.min(100, Math.abs(value) / max * 100));
    const name = escapeHtml(item.name || "未命名板塊");
    const kind = value >= 0 ? "up" : "down";
    return '<div class="mc-flow-row">' +
      '<div class="mc-flow-name"><b>' + name + '</b><small>' + escapeHtml(item.kind || "板塊") + '</small></div>' +
      '<div class="mc-flow-track"><i class="' + kind + '" style="width:' + width.toFixed(1) + '%"></i></div>' +
      '<b class="mc-flow-value ' + kind + '">' + escapeHtml(flowMoney(value)) + '</b>' +
    '</div>';
  }

  function renderOverview(page, W, flow) {
    const hero = page.querySelector(".td-hero");
    const alignment = flowAlignment(W, flow);
    const gridHtml = '<div class="mc-panel-head"><div><span class="mc-eyebrow">MARKET BREADTH</span><h4>市場廣度</h4></div><span class="mc-date">' +
      escapeHtml(flow.date || "資料日期未提供") + '</span></div><div class="mc-breadth-mount"></div>';
    const sectorHtml = '<div class="mc-panel-head"><div><span class="mc-eyebrow">SECTOR MOMENTUM</span><h4>族群資金強弱</h4></div><span class="mc-date ' +
      alignment.tone + '">' + escapeHtml((flow.date || "法人日期未提供") + " · " + alignment.label) + '</span></div><div class="mc-overview-sector"></div>';
    const panel = ensurePanel(page, ".mc-overview-grid", "mc-overview-grid", "overview",
      '<section class="mc-panel mc-breadth-panel">' + gridHtml + '</section><section class="mc-panel mc-overview-sector-panel">' + sectorHtml + '</section>');
    const breadthMount = panel.querySelector(".mc-breadth-mount");
    const breadth = hero && hero.querySelector(".td-breadth");
    if (breadth && breadthMount && breadth.parentElement !== breadthMount) breadthMount.appendChild(breadth);
    if (!breadthMount || !breadthMount.children.length) {
      breadthMount.innerHTML = '<p class="mc-empty">市場廣度資料尚未與最新加權行情對齊；不以其他交易日資料補入。</p>';
    }
    // 手機第一屏優先呈現核心市場數字：將核心卡移到加權報價與分時圖之間。
    const side = hero && hero.querySelector(".td-side");
    const coreGrid = side && side.querySelector(".dh-core-grid");
    const main = hero && hero.querySelector(".td-main");
    const chart = main && main.querySelector(".td-ix");
    if (coreGrid && main) {
      coreGrid.classList.add("mc-core-grid");
      if (chart) chart.before(coreGrid);
      else main.appendChild(coreGrid);
    }
    if (side && !side.children.length) side.remove();
    const sectorMount = panel.querySelector(".mc-overview-sector");
    const list = (flow.sectors || []).filter(x => isNum(x.net1) && x.net1 !== 0).sort((a, b) => Math.abs(b.net1) - Math.abs(a.net1)).slice(0, 6);
    const max = Math.max(1, ...list.map(x => Math.abs(x.net1)));
    const alignmentNote = '<p class="mc-flow-alignment ' + alignment.tone + '" role="status">' + escapeHtml(alignment.note) + '</p>';
    sectorMount.innerHTML = list.length
      ? list.map(x => flowRow(x, max)).join("") + alignmentNote + '<p class="mc-data-note">依現有法人張數與收盤價估算；不同題材可能重複包含同一檔股票。</p>'
      : '<p class="mc-empty">尚無可比較的板塊法人金額，待資料完整後顯示。</p>' + alignmentNote;
    if (hero) hero.after(panel);
    const mine = page.querySelector("#td-sec-mine");
    if (mine) mine.dataset.mcSection = "overview";
  }

  function renderCapital(page, W, flow) {
    const alignment = flowAlignment(W, flow);
    const positive = (flow.sectors || []).filter(x => isNum(x.net1) && x.net1 > 0).sort((a, b) => b.net1 - a.net1).slice(0, 5);
    const negative = (flow.sectors || []).filter(x => isNum(x.net1) && x.net1 < 0).sort((a, b) => a.net1 - b.net1).slice(0, 5);
    const max = Math.max(1, ...positive.concat(negative).map(x => Math.abs(x.net1)));
    const html = '<div class="mc-panel-head"><div><span class="mc-eyebrow">INSTITUTIONAL FLOW</span><h4>法人資金流向排行</h4></div><span class="mc-date ' + alignment.tone + '">' +
      escapeHtml((flow.date || "法人日期未提供") + " · " + alignment.label) + '</span></div>' +
      '<p class="mc-flow-alignment ' + alignment.tone + '" role="status">' + escapeHtml(alignment.note) + '</p>' +
      '<div class="mc-flow-columns"><div><h5 class="up">資金流入</h5>' +
      (positive.length ? positive.map(x => flowRow(x, max)).join("") : '<p class="mc-empty">目前沒有可確認的淨流入板塊。</p>') +
      '</div><div><h5 class="down">資金流出</h5>' +
      (negative.length ? negative.map(x => flowRow(x, max)).join("") : '<p class="mc-empty">目前沒有可確認的淨流出板塊。</p>') +
      '</div></div>' +
      '<div class="mc-flow-foot"><span>資料日期：' + escapeHtml(flow.date || "未提供") + '</span><span>單位：億元（估算）</span></div>' +
      '<p class="mc-data-note">估算方式：三大法人買賣超張數 × 1,000 股 × 收盤價 ÷ 1 億。不是逐筆成交金額；缺值不代表零買賣超。</p>';
    const panel = ensurePanel(page, ".mc-capital-panel", "mc-panel mc-capital-panel", "capital", html);
    const sectionBar = page.querySelector(".dh-secbar");
    if (sectionBar) sectionBar.before(panel);
    const detail = page.querySelector("#td-sec-flow");
    if (detail) detail.dataset.mcSection = "capital";
  }


  const GLOBAL_REFRESH_MS = 60_000;
  const GLOBAL_REFRESH_POLL_MS = 15_000;
  const GLOBAL_STATUS_LABELS = {
    live: "供應商盤中報價（可能延遲）",
    delayed: "來源更新延遲",
    pending: "資料待確認",
    confirmed: "來源資料已回報",
    stale: "來源資料過期",
    partial: "資料不完整",
    holiday: "市場休市",
    unavailable: "無有效報價"
  };
  const GLOBAL_UPDATE_LABELS = { scheduled: "定時更新", after_close: "盤後更新" };

  function globalTimeLabel(value) {
    const ms = typeof value === "number" ? value : Date.parse(value || "");
    if (!Number.isFinite(ms)) return "未提供";
    const local = new Date(ms + 8 * 3600e3).toISOString();
    return local.slice(0, 10) + " " + local.slice(11, 19) + "（台北時間）";
  }

  function globalRowHtml(item, options = {}) {
    const code = item && item.code || "";
    const price = item && (item.price ?? item.close);
    const missing = price == null || (options.failedCodes && options.failedCodes.has(code));
    const statusKey = missing ? "unavailable" : item?.dataStatus || options.statusFallback || "";
    const statusLabel = GLOBAL_STATUS_LABELS[statusKey] || "狀態未提供";
    const date = item?.dataDate || item?.date || options.dateFallback || "市場日期未提供";
    const time = item?.sourceTime || item?.time || options.timeFallback || "來源時間未提供";
    const zone = item?.tz ? "（" + item.tz + "）" : "";
    const source = item?.source || options.sourceFallback || "來源未提供";
    const updateMode = item?.updateMode || options.updateFallback || "";
    const updateLabel = GLOBAL_UPDATE_LABELS[updateMode] || (updateMode ? "更新方式未提供" : "");
    const tone = ["stale", "partial", "delayed", "unavailable"].includes(statusKey) ? "warn" : "neutral";
    const change = item?.chgPct;
    return '<article class="mc-global-card" data-mc-code="' + escapeHtml(code) + '">' +
      '<div class="mc-global-name"><b>' + escapeHtml(item?.name || code || "未命名") + '</b><span>' + escapeHtml(code) + '</span></div>' +
      '<div class="mc-global-price">' + escapeHtml(numberFmt(price, 3)) + '</div>' +
      '<div class="mc-global-change ' + (isNum(change) ? (change > 0 ? "up" : change < 0 ? "down" : "flat") : "flat") + '">' +
        escapeHtml(isNum(change) ? signed(change) + "%" : "漲跌幅未提供") + '</div>' +
      '<div class="mc-global-meta">' + escapeHtml("資料日期 " + date + " · 來源時間 " + time + zone) + '</div>' +
      '<div class="mc-global-source">' + escapeHtml("來源：" + source) + '</div>' +
      '<div class="mc-global-status ' + tone + '"><span>' + escapeHtml(statusLabel) + '</span>' +
        (updateLabel ? '<small>' + escapeHtml(updateLabel) + '</small>' : '') + '</div>' +
    '</article>';
  }

  function globalGroupHtml(id, title, rows, options = {}) {
    const cards = rows.length
      ? '<div class="mc-global-grid">' + rows.map(item => globalRowHtml(item, options)).join("") + '</div>'
      : '<p class="mc-empty">目前沒有可顯示的資料。</p>';
    const note = options.note ? '<small>' + escapeHtml(options.note) + '</small>' : "";
    return '<details class="mc-global-group" data-mc-global-group="' + escapeHtml(id) +
      '" data-mc-global-kind="' + escapeHtml(options.kind || "international") + '"' + (options.open ? " open" : "") + '>' +
      '<summary><span class="mc-global-group-title"><b>' + escapeHtml(title) + '</b>' + note + '</span>' +
      '<span class="mc-global-group-count">' + rows.length + ' 項</span></summary>' +
      '<div class="mc-global-group-body">' + cards + '</div></details>';
  }

  function refreshGlobalIfNeeded(W) {
    const state = ensureState(W);
    if (!state || !W || W.lt !== "today" || state.workspace !== "global" || W.off ||
        document.visibilityState === "hidden" || W.glLoading || typeof loadGlobal !== "function") return false;
    const now = Date.now();
    const sourceAt = Date.parse(W.gl?.sourceFetchedAt || "");
    const localAt = Number(W.gl?.at);
    const freshnessAt = Number.isFinite(sourceAt) && sourceAt > 0 ? sourceAt :
      (Number.isFinite(localAt) ? localAt : 0);
    const stale = !W.gl?.ok || !freshnessAt || now - freshnessAt >= GLOBAL_REFRESH_MS;
    const lastAttempt = Number(state.globalRefreshAttemptAt) || 0;
    if (!stale || now - lastAttempt < GLOBAL_REFRESH_MS) return false;

    state.globalRefreshAttemptAt = now;
    const job = loadGlobal(true);
    if (typeof renderList === "function") renderList();
    Promise.resolve(job).then(() => {
      if (W.lt === "today" && state.workspace === "global" && typeof renderList === "function") renderList();
    }).catch(() => {});
    return true;
  }

  function syncGlobalRefreshTimer(W, active) {
    const state = ensureState(W);
    if (!state) return;
    if (active && !state.globalRefreshTimer) {
      state.globalRefreshTimer = setInterval(() => {
        const current = runtimeRef;
        if (!current || current.lt !== "today" || current.marketCenter?.workspace !== "global") {
          syncGlobalRefreshTimer(current, false);
          return;
        }
        refreshGlobalIfNeeded(current);
      }, GLOBAL_REFRESH_POLL_MS);
      state.globalRefreshVisibilityHandler = () => {
        if (document.visibilityState === "visible") refreshGlobalIfNeeded(runtimeRef);
      };
      document.addEventListener("visibilitychange", state.globalRefreshVisibilityHandler);
    } else if (!active && state.globalRefreshTimer) {
      clearInterval(state.globalRefreshTimer);
      state.globalRefreshTimer = null;
      if (state.globalRefreshVisibilityHandler) {
        document.removeEventListener("visibilitychange", state.globalRefreshVisibilityHandler);
        state.globalRefreshVisibilityHandler = null;
      }
    }
  }

  function renderGlobal(page, W) {
    const U = W && W.bf && W.bf.us || {};
    const usGroups = [
      { id: "us-indices", name: "美股主要指數", rows: Array.isArray(U.indices) ? U.indices : [], note: "指數與波動率", open: true },
      { id: "us-macro", name: "美股期貨與總經", rows: Array.isArray(U.macro) ? U.macro : [], note: "期貨、利率、美元與總經商品" },
      { id: "us-megas", name: "美股大型權值股", rows: Array.isArray(U.megas) ? U.megas : [], note: "大型公司與台積電 ADR" }
    ];
    const failedCodes = new Set(Array.isArray(W?.gl?.failed) ? W.gl.failed : []);
    const sourceGroups = W && W.gl && W.gl.ok && Array.isArray(W.gl.groups) ? W.gl.groups : [];
    const allGlobalRows = sourceGroups.flatMap(group => Array.isArray(group.rows) ? group.rows : []);
    const validCount = allGlobalRows.filter(item => item && item.price != null).length;
    const failedCount = new Set([...failedCodes, ...allGlobalRows.filter(item => !item || item.price == null).map(item => item?.code).filter(Boolean)]).size;
    const totalCount = allGlobalRows.length;
    const apiMs = Date.parse(W?.gl?.sourceFetchedAt || "");
    const apiAge = Number.isFinite(apiMs) && apiMs > 0 ? Date.now() - apiMs : Infinity;
    let apiStatus = "尚未載入（開啟此工作區後自動載入）";
    if (W?.glLoading) apiStatus = "國際行情更新中";
    else if (W?.gl?.refreshError) apiStatus = "更新失敗，保留上次有效資料";
    else if (W?.gl?.err || W?.gl?.ok === false) apiStatus = "國際行情暫時不可用";
    else if (W?.gl?.ok) {
      if (apiAge >= GLOBAL_REFRESH_MS) apiStatus = "API 回應已超過 60 秒";
      else if (failedCount) apiStatus = "部分標的缺值 " + validCount + "/" + totalCount;
      else apiStatus = "API 回應成功 " + validCount + "/" + totalCount;
    }
    const usStatus = GLOBAL_STATUS_LABELS[U.dataStatus] || "狀態未提供";
    const usUpdate = GLOBAL_UPDATE_LABELS[U.updateMode] || "更新方式未提供";
    const usDate = U.dataDate || U.date || "未提供";
    const usTime = U.sourceTime || "未提供";
    const usMeta = '<span>美股資料日期 <b>' + escapeHtml(usDate) + '</b></span>' +
      '<span>美股來源時間 <b>' + escapeHtml(usTime + (U.tz ? "（" + U.tz + "）" : "")) + '</b></span>' +
      '<span>美股狀態 <b>' + escapeHtml(usStatus) + '</b></span>' +
      '<span>美股更新方式 <b>' + escapeHtml(usUpdate) + '</b></span>' +
      '<span>美股來源 <b>' + escapeHtml(U.source || "Yahoo Finance") + '</b></span>';
    const globalMeta = '<span>國際 API 狀態 <b>' + escapeHtml(apiStatus) + '</b></span>' +
      '<span>API 回應時間 <b>' + escapeHtml(globalTimeLabel(W?.gl?.sourceFetchedAt)) + '</b></span>' +
      '<span>前端取得／快取時間 <b>' + escapeHtml(globalTimeLabel(W?.gl?.at)) + '</b></span>' +
      '<span>國際行情來源 <b>' + escapeHtml(W?.gl?.source || "Yahoo Finance") + '</b></span>';
    const usGroupsHtml = usGroups.filter(group => group.rows.length).map(group => globalGroupHtml(
      group.id, group.name, group.rows, {
        kind: "us", note: group.note, open: !!group.open,
        statusFallback: U.dataStatus, dateFallback: U.dataDate || U.date,
        timeFallback: U.sourceTime, sourceFallback: U.source, updateFallback: U.updateMode
      }
    )).join("");
    const globalGroupsHtml = sourceGroups.map(group => globalGroupHtml(
      group.id, group.name, Array.isArray(group.rows) ? group.rows : [], {
        kind: "international", note: group.note, open: group.id === "energy" || group.id === "fx",
        failedCodes, sourceFallback: W?.gl?.source
      }
    )).join("");
    const emptyText = W?.glLoading ? "國際行情載入中…" :
      W?.gl?.refreshError ? "更新失敗；暫時保留上一筆有效資料，請留意資料日期。" :
      W?.gl?.err ? "目前無法取得國際行情：" + W.gl.err :
      "尚未取得國際行情。切換到全球總經工作區後，系統會自動載入。";
    const contents = usGroupsHtml + globalGroupsHtml;
    const panelHtml = '<div class="mc-panel-head"><div><span class="mc-eyebrow">GLOBAL MARKETS</span><h4>全球市場矩陣</h4></div>' +
      '<span class="mc-status-chip">' + escapeHtml(apiStatus) + '</span></div>' +
      '<div class="mc-global-summary">' + usMeta + globalMeta + '</div>' +
      (contents ? '<div class="mc-global-groups">' + contents + '</div>' : '<p class="mc-empty">' + escapeHtml(emptyText) + '</p>') +
      (W?.gl?.refreshError ? '<p class="mc-data-note">最近一次更新失敗：' + escapeHtml(W.gl.refreshError) + '</p>' : '') +
      '<div class="mc-global-shortcuts" aria-label="延伸市場分析">' +
        '<span>延伸分析</span>' +
        '<button type="button" class="linkbtn" data-tdgo="mkt:us">美股大盤 ›</button>' +
        '<button type="button" class="linkbtn" data-tdgo="mkt:gl">原物料外匯 ›</button>' +
        '<button type="button" class="linkbtn" data-tdgo="mkt:macro">總經數據 ›</button>' +
        '<button type="button" class="linkbtn" data-tdgo="mkt:poly">預測市場 ›</button>' +
      '</div>' +
      '<p class="mc-data-note">API 回應時間與前端取得／快取時間不是市場交易時間；每個標的的日期、來源時間與狀態以該標的回傳值為準。未提供的欄位不借用其他市場資料補入。供應商盤中報價可能延遲，並非交易所逐筆即時。</p>';
    const panel = ensurePanel(page, ".mc-global-panel", "mc-panel mc-global-panel", "global", panelHtml);
    const sectionBar = page.querySelector(".dh-secbar");
    if (sectionBar) sectionBar.before(panel);
    // 新矩陣已完整涵蓋美股與 /api/global 標的；移除舊總經摘要，避免同一行情在同一工作區重複出現。
    page.querySelector("#td-sec-mac")?.remove();
  }

  function readTechnicalLevels(W) {
    try {
      const today = typeof twDay === "function" ? twDay() : todayTW();
      const holidays = W?.cal?.hol || (typeof TWHOL !== "undefined" && TWHOL.set ? [...TWHOL.set].map(date => ({ date })) : []);
      const quote = getQuote(W, "T00");
      const session = typeof sessionStatus === "function"
        ? sessionStatus(Date.now(), { holidays, lastTradeDate: quote?.date })
        : null;
      const target = session?.session === "closed" && typeof findNextTradeDate === "function"
        ? findNextTradeDate(today, holidays) || today
        : today;
      const snapshot = typeof getBriefSnapshot === "function" ? getBriefSnapshot(target) : null;
      const levels = snapshot?.keyLevels;
      if (!levels || !["pressure", "pivot", "support"].every(key => isNum(levels[key]) && levels[key] > 0)) return null;
      if (levels.pressure <= levels.pivot || levels.pivot <= levels.support) return null;
      return levels;
    } catch {
      return null;
    }
  }

  function renderTechnical(page, W) {
    const levelsData = readTechnicalLevels(W);
    const levels = [
      { key: "pressure", label: "壓力", value: levelsData?.pressure ?? null, desc: "突破後觀察是否站穩" },
      { key: "pivot", label: "多空分水嶺", value: levelsData?.pivot ?? null, desc: "盤勢位置的判讀基準" },
      { key: "support", label: "支撐", value: levelsData?.support ?? null, desc: "跌破後重新評估風險" }
    ];
    const q = getQuote(W, "T00");
    const position = page.querySelector(".td-pos");
    const priceText = isNum(q && q.price) ? numberFmt(q.price, 0) : "—";
    const levelHtml = levels.map(level => '<div class="mc-level-row ' + level.key + '"><span>' + escapeHtml(level.label) +
      '</span><b>' + escapeHtml(level.value == null ? "待更新" : numberFmt(level.value, 0) + " 點") + '</b><small>' +
      escapeHtml(level.desc) + '</small></div>').join("");
    const html = '<div class="mc-panel-head"><div><span class="mc-eyebrow">TECHNICAL MAP</span><h4>關鍵位階與攻防</h4></div><span class="mc-model-tag">模型推估</span></div>' +
      '<div class="mc-tech-current"><span>目前加權報價</span><b>' + escapeHtml(priceText) + '</b><small>' +
      escapeHtml(q && q.date ? q.date : "行情日期未提供") + ' · ' + escapeHtml(q && (q.sourceTime || q.time) || "來源時間未提供") + '</small></div>' +
      '<div class="mc-tech-ladder">' + levelHtml + '</div>' +
      '<div class="mc-tech-position">' + escapeHtml(position ? position.textContent.replace(/\s+/g, " ").trim() : "目前位置尚未取得") + '</div>' +
      '<p class="mc-data-note">壓力、分水嶺與支撐是盤前推演模型價位；請與當日實際報價及量能確認，不是即時成交價或保證支撐。</p>';
    const panel = ensurePanel(page, ".mc-tech-panel", "mc-panel mc-tech-panel", "technical", html);
    const sectionBar = page.querySelector(".dh-secbar");
    if (sectionBar) sectionBar.before(panel);

  }

  function installStyles(doc) {
    if (doc.getElementById("kl-market-center-style")) return;
    const style = doc.createElement("style");
    style.id = "kl-market-center-style";
    style.textContent = [
      ".td-page{--mc-card:var(--surface);--mc-soft:var(--surface-2);--mc-border:var(--line)}",
      ".mc-nav{display:flex;gap:8px;max-width:100%;min-width:0;margin:16px 0 10px;padding:0 0 5px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;scroll-snap-type:x proximity;scroll-padding-inline:8px}",
      ".mc-nav::-webkit-scrollbar{display:none}",
      ".mc-tab{position:relative;flex:1 0 auto;min-width:100px;min-height:46px;padding:10px 16px;border:1px solid var(--mc-border);border-radius:8px;background:var(--mc-soft);color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer;scroll-snap-align:start;transition:background .16s,border-color .16s,color .16s}",
      ".mc-tab[aria-selected=true],.mc-tab[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--ink);box-shadow:inset 0 -2px 0 var(--accent)}",
      ".mc-tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
      ".mc-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:8px 0 14px}",
      ".mc-heading h4{margin:0;font-size:20px;font-weight:750;letter-spacing:.01em;color:var(--ink)}",
      ".mc-heading p{margin:0;color:var(--muted);font-size:12px;line-height:1.5}",
      ".mc-panel{min-width:0;padding:16px;border:1px solid var(--mc-border);border-radius:12px;background:var(--mc-card);box-shadow:0 5px 18px rgba(0,0,0,.06)}",
      ".mc-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}",
      ".mc-panel-head h4{margin:3px 0 0;font-size:16px;font-weight:700;color:var(--ink)}",
      ".mc-eyebrow{font-size:10px;letter-spacing:.14em;font-weight:700;color:var(--muted)}",
      ".mc-date{font-size:11px;color:var(--muted);white-space:nowrap}",
      ".mc-date.warn,.mc-flow-alignment.warn{color:var(--down)}.mc-date.ok,.mc-flow-alignment.ok{color:var(--muted)}",
      ".mc-flow-alignment{margin:8px 0;color:var(--muted);font-size:11px;line-height:1.55}",
      ".mc-global-shortcuts{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--mc-border)}",
      ".mc-global-shortcuts>span{color:var(--muted);font-size:11px;font-weight:650}",
      ".mc-status-chip,.mc-model-tag{display:inline-flex;align-items:center;min-height:24px;padding:3px 9px;border:1px solid var(--mc-border);border-radius:999px;background:var(--mc-soft);color:var(--muted);font-size:11px;line-height:1.35}",
      ".td-page .td-hero{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:stretch;margin:0 0 14px}",
      ".td-page .td-main,.td-page .td-side{min-width:0;padding:16px;border:1px solid var(--mc-border);border-radius:12px;background:var(--mc-card);box-shadow:0 5px 18px rgba(0,0,0,.06)}",
      ".td-page .td-side{display:flex;flex-direction:column;gap:12px}",
      ".td-page .td-side .td-breadth{display:none}",
      ".mc-core-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:0;margin:8px 0 0;border-top:1px solid var(--line)}",
      ".mc-core-grid .dh-core-card{background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:8px 8px 8px 0}",
      ".mc-core-grid .dh-cc-head .note{display:none}.mc-core-grid .dh-cc-head b{font-size:12px;font-weight:400;color:var(--muted)}",
      ".mc-core-grid .dh-cc-sub{display:flex;align-items:center;justify-content:space-between;gap:4px}.mc-core-grid .dh-cc-sub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mc-core-grid .dh-cc-sub .spark{flex:none;width:36px;height:14px}",
      ".mc-overview-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin:0 0 14px}",
      ".mc-overview-grid .td-breadth{margin:0;padding:0;border:0;background:transparent}",
      ".mc-overview-grid .td-breadth-head{margin-bottom:5px}",
      ".mc-overview-grid .td-breadth-total{margin-bottom:10px}",
      ".mc-overview-grid .td-bb{height:14px;border-radius:5px;overflow:hidden}",
      ".mc-overview-grid .td-breadth-legend{display:flex;justify-content:space-between;gap:7px;flex-wrap:wrap;margin-top:9px}",
      ".mc-overview-grid .td-breadth-foot{margin-top:9px}",
      ".mc-flow-row{display:grid;grid-template-columns:minmax(90px,1.1fr) minmax(50px,1.5fr) minmax(55px,.7fr);gap:10px;align-items:center;margin:11px 0}",
      ".mc-flow-name{display:flex;flex-direction:column;min-width:0;gap:2px}",
      ".mc-flow-name b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:650}",
      ".mc-flow-name small{font-size:10px;color:var(--muted)}",
      ".mc-flow-track{height:9px;border-radius:8px;background:var(--mc-soft);overflow:hidden}",
      ".mc-flow-track i{display:block;height:100%;border-radius:8px}",
      ".mc-flow-track i.up{background:var(--up)}.mc-flow-track i.down{background:var(--down)}",
      ".mc-flow-value{text-align:right;white-space:nowrap;font:600 12px var(--font-num,monospace)}",
      ".mc-flow-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}",
      ".mc-flow-columns h5{margin:0 0 9px;font-size:12px}",
      ".mc-flow-foot,.mc-global-summary{display:flex;gap:8px 18px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--mc-border);color:var(--muted);font-size:11px}",
      ".mc-data-note{margin:12px 0 0;color:var(--muted);font-size:11px;line-height:1.6}",
      ".mc-empty{margin:8px 0;padding:12px;border:1px dashed var(--mc-border);border-radius:8px;color:var(--muted);font-size:12px;line-height:1.6}",
      ".mc-global-summary{padding:0 0 13px;border:0}",
      ".mc-global-summary span{display:inline-flex;gap:5px;align-items:baseline}",
      ".mc-global-summary b{color:var(--ink);font-weight:600}",
      ".mc-global-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}",
      ".mc-global-card{min-width:0;padding:12px;border:1px solid var(--mc-border);border-radius:9px;background:var(--mc-soft)}",
      ".mc-global-name{display:flex;justify-content:space-between;gap:6px;align-items:baseline}",
      ".mc-global-name b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mc-global-name span,.mc-global-source{font-size:10px;color:var(--muted)}",
      ".mc-global-price{margin-top:9px;font:700 20px var(--font-num,monospace);color:var(--ink);font-variant-numeric:tabular-nums}",
      ".mc-global-change{margin-top:2px;font:650 12px var(--font-num,monospace)}",
      ".mc-global-meta{margin-top:10px;font-size:10px;color:var(--muted);line-height:1.5}",
      ".mc-global-source{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mc-global-groups{display:grid;grid-template-columns:minmax(0,1fr);gap:11px}",
      ".mc-global-group{min-width:0;border:1px solid var(--mc-border);border-radius:10px;background:var(--mc-card);overflow:hidden}",
      ".mc-global-group>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:46px;padding:10px 13px;list-style:none;cursor:pointer;background:var(--mc-soft)}",
      ".mc-global-group>summary::-webkit-details-marker{display:none}",
      ".mc-global-group>summary:after{content:'＋';flex:none;color:var(--muted);font-size:13px}",
      ".mc-global-group[open]>summary:after{content:'－'}",
      ".mc-global-group-title{display:flex;flex-direction:column;gap:3px;min-width:0}",
      ".mc-global-group-title b{font-size:13px;color:var(--ink)}.mc-global-group-title small{font-size:10px;color:var(--muted)}",
      ".mc-global-group-count{flex:none;color:var(--muted);font-size:11px}",
      ".mc-global-group-body{padding:12px}",
      ".mc-global-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}",
      ".mc-global-status{display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-top:8px;font-size:10px;line-height:1.4}",
      ".mc-global-status small{color:var(--muted)}",
      ".mc-global-status.warn{color:var(--down)}.mc-global-status.neutral{color:var(--muted)}",
      ".mc-tech-current{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:9px;background:var(--mc-soft)}",
      ".mc-tech-current span,.mc-tech-current small{font-size:11px;color:var(--muted)}",
      ".mc-tech-current b{font:750 22px var(--font-num,monospace);color:var(--ink)}",
      ".mc-tech-ladder{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}",
      ".mc-level-row{display:flex;flex-direction:column;gap:5px;min-width:0;padding:12px;border:1px solid var(--mc-border);border-radius:9px;background:var(--mc-soft)}",
      ".mc-level-row span{font-size:11px;color:var(--muted)}.mc-level-row b{font:700 16px var(--font-num,monospace);color:var(--ink)}.mc-level-row small{font-size:10px;color:var(--muted);line-height:1.4}",
      ".mc-level-row.pressure{border-top:3px solid var(--down)}.mc-level-row.pivot{border-top:3px solid var(--accent)}.mc-level-row.support{border-top:3px solid var(--up)}",
      ".mc-tech-position{margin-top:10px;font-size:12px;color:var(--muted)}",
      ".mc-ai-panel{padding:18px;border:1px solid var(--mc-border);border-radius:12px;background:var(--mc-card);box-shadow:0 5px 18px rgba(0,0,0,.06)}",
      ".mc-ai-panel h4{margin:0 0 6px;font-size:17px}.mc-ai-panel>p{margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.6}.mc-ai-panel .caibox{margin-top:12px}",
      ".td-page .dh-sec{margin:0 0 12px;border:1px solid var(--mc-border);border-radius:12px;background:var(--mc-card);overflow:hidden}",
      ".td-page .dh-sec>summary{min-height:58px;padding:14px 16px;gap:12px}",
      ".td-page .dh-sec-b{padding:0 16px 16px}",
      ".td-page [data-mc-section][hidden]{display:none!important}",
      "@media(max-width:900px){.mc-global-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}",
      "@media(max-width:760px){.td-page .td-hero{grid-template-columns:minmax(0,1fr)}.mc-overview-grid{grid-template-columns:minmax(0,1fr)}.mc-global-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mc-flow-columns{grid-template-columns:minmax(0,1fr);gap:12px}.mc-heading{align-items:flex-start;flex-direction:column;gap:4px}}",
      "@media(max-width:430px){.mc-tab{flex:0 0 auto;min-width:90px;padding:9px 12px}.mc-panel{padding:13px}.td-page .td-main,.td-page .td-side{padding:10px}.td-page .td-main{gap:8px}.mc-core-grid{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:6px}.mc-core-grid .dh-core-card{padding:6px 5px}.mc-flow-row{grid-template-columns:minmax(82px,1fr) minmax(45px,1fr) minmax(50px,.7fr);gap:7px}.mc-tech-ladder{grid-template-columns:minmax(0,1fr)}.mc-level-row{display:grid;grid-template-columns:1fr auto;align-items:center}.mc-level-row small{grid-column:1/-1}.mc-global-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mc-global-price{font-size:17px}.mc-nav{margin:4px 0 2px}.mc-heading{margin:0 0 4px}.td-market-summary{margin-bottom:0}}"
    ].join("\n");
    (doc.head || doc.documentElement).appendChild(style);
  }

  function applyWorkspace(page, state, workspace) {
    state.workspace = normalizeWorkspace(workspace);
    const active = WORKSPACES.find(item => item.id === state.workspace) || WORKSPACES[0];
    page.querySelectorAll("[data-mc-tab]").forEach(button => {
      const selected = button.dataset.mcTab === active.id;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    page.querySelectorAll("[data-mc-section]").forEach(section => {
      section.hidden = section.dataset.mcSection !== active.id;
    });
    const sections = page.querySelector(".dh-secs");
    const sectionBar = page.querySelector(".dh-secbar");
    const isResearch = active.id === "research";
    if (sections) sections.hidden = isResearch;
    if (sectionBar) sectionBar.hidden = isResearch;
    const title = page.querySelector("[data-mc-title]");
    const description = page.querySelector("[data-mc-description]");
    if (title) title.textContent = active.title;
    if (description) description.textContent = active.description;
  }

  function activateWorkspace(button) {
    const currentPage = button.closest(".td-page");
    if (!currentPage || !stateRef) return false;
    const workspace = normalizeWorkspace(button.dataset.mcTab);
    applyWorkspace(currentPage, stateRef, workspace);
    syncGlobalRefreshTimer(runtimeRef, workspace === "global");
    if (workspace === "global") refreshGlobalIfNeeded(runtimeRef);
    button.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return true;
  }

  let stateRef = null;
  let runtimeRef = null;

  function enhance(host, W) {
    const page = host && host.matches && host.matches(".td-page") ? host : host && host.querySelector ? host.querySelector(".td-page") : null;
    const state = ensureState(W);
    if (!page || !state || !page.querySelector(".dh-status-bar")) return false;
    runtimeRef = W;
    installStyles(page.ownerDocument);

    page.querySelector(".td-quicknav")?.remove();
    const hero = page.querySelector(".td-hero");
    const status = page.querySelector(".dh-status-bar");
    const summary = page.querySelector(".td-market-summary");
    const nav = page.querySelector(".mc-nav") || page.ownerDocument.createElement("nav");
    if (!nav.classList.contains("mc-nav")) {
      nav.className = "mc-nav";
      nav.setAttribute("aria-label", "今日市場工作區");
      nav.setAttribute("role", "tablist");
      nav.setAttribute("aria-orientation", "horizontal");
      nav.innerHTML = WORKSPACES.map(item =>
        '<button type="button" class="mc-tab" role="tab" data-mc-tab="' + item.id +
        '" aria-selected="false" aria-pressed="false" tabindex="-1">' + item.label + "</button>"
      ).join("");
    }
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-orientation", "horizontal");
    const heading = page.querySelector(".mc-heading") || page.ownerDocument.createElement("div");
    if (!heading.classList.contains("mc-heading")) {
      heading.className = "mc-heading";
      heading.innerHTML = '<div><h4 data-mc-title></h4><p data-mc-description></p></div>';
    }
    if (hero) {
      hero.before(nav);
      nav.after(heading);
    } else if (status) {
      status.after(nav);
      nav.after(heading);
    }

    const assign = (selector, workspace) => {
      const element = page.querySelector(selector);
      if (element) element.dataset.mcSection = workspace;
      return element;
    };
    assign(".td-hero", "overview");
    assign("#td-sec-mine", "overview");
    assign("#td-sec-flow", "capital");
    assign("#td-sec-mac", "global");
    assign("#td-sec-plan", "technical");

    const flow = readFlow(W);
    renderOverview(page, W, flow);
    renderCapital(page, W, flow);
    renderGlobal(page, W);
    renderTechnical(page, W);

    let research = page.querySelector(".mc-ai-panel");
    if (!research) {
      research = page.ownerDocument.createElement("section");
      research.className = "mc-ai-panel";
      research.dataset.mcSection = "research";
      research.innerHTML = '<h4>AI 市場研究</h4><p>沿用既有 AI 整理結果。請同時檢查原始來源、資料日期與反證；摘要不等同完整研究報告。</p><div class="mc-ai-content"></div>';
      const bar = page.querySelector(".dh-secbar");
      if (bar) bar.before(research);
      else if (hero) hero.after(research);
    }
    const aiBox = page.querySelector(".caibox");
    const aiContent = research.querySelector(".mc-ai-content");
    if (aiBox && aiContent && aiBox.parentElement !== aiContent) aiContent.appendChild(aiBox);
    if (!aiBox && aiContent && !aiContent.textContent.trim()) {
      aiContent.textContent = "尚未產生 AI 摘要。可使用頁面上方的「AI 整理」功能；資料不足時應保留不確定性。";
    }

    const panelTargets = {
      overview: page.querySelector(".td-hero") || page.querySelector(".mc-overview-grid"),
      capital: page.querySelector(".mc-capital-panel"),
      global: page.querySelector(".mc-global-panel"),
      research: page.querySelector(".mc-ai-panel"),
      technical: page.querySelector(".mc-tech-panel")
    };
    page.querySelectorAll("[data-mc-tab]").forEach(button => {
      const target = panelTargets[button.dataset.mcTab];
      if (!target) return;
      const tabId = "mc-tab-" + button.dataset.mcTab;
      const panelId = "mc-panel-" + button.dataset.mcTab;
      button.id = tabId;
      button.setAttribute("aria-controls", panelId);
      target.id = panelId;
      target.setAttribute("role", "tabpanel");
      target.setAttribute("aria-labelledby", tabId);
      if (!target.hasAttribute("tabindex")) target.tabIndex = 0;
    });

    applyWorkspace(page, state, state.workspace);
    syncGlobalRefreshTimer(W, state.workspace === "global");
    refreshGlobalIfNeeded(W);
    if (!window.__klMarketCenterClickBound) {
      window.__klMarketCenterClickBound = true;
      // Capture phase: the existing AI handler redraws #lx and may detach the button before bubbling.
      document.addEventListener("click", event => {
        const target = event.target;
        const button = target.closest && target.closest("[data-mc-tab]");
        if (!button) {
          const aiTrigger = target.closest && target.closest('[data-tx="tdai"]');
          const aiHost = aiTrigger && document.getElementById("lx");
          if (aiHost && stateRef) {
            queueMicrotask(() => {
              const currentPage = aiHost.querySelector(".td-page");
              const currentState = stateRef;
              if (currentPage && currentState) applyWorkspace(currentPage, currentState, "research");
            });
          }
          return;
        }
        if (!stateRef) return;
        event.preventDefault();
        activateWorkspace(button);
      }, true);
      document.addEventListener("keydown", event => {
        const button = event.target.closest && event.target.closest("[data-mc-tab]");
        if (!button) return;
        const nav = button.closest(".mc-nav");
        if (!nav) return;
        const tabs = Array.from(nav.querySelectorAll("[data-mc-tab]"));
        const index = tabs.indexOf(button);
        if (index < 0 || !tabs.length) return;
        let nextIndex = index;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = tabs.length - 1;
        else return;
        event.preventDefault();
        const next = tabs[nextIndex];
        if (activateWorkspace(next)) next.focus({ preventScroll: true });
      }, true);
    }
    stateRef = state;
    return true;
  }

  window.KLMarketCenter = Object.freeze({
    workspaces: WORKSPACES,
    normalizeWorkspace,
    ensureState,
    applyWorkspace,
    readFlow,
    flowAlignment,
    enhance
  });
})();