// KLineLab 今日市場 V2：以既有行情與分析模型重排成視覺化決策儀表板，不建立第二套資料管線。
(() => {
  "use strict";

  const WORKSPACES = Object.freeze([
    { id: "overview", label: "市場總覽", title: "市場總覽", description: "先看指數位置、盤面廣度與族群強弱，再進入個人持倉。" },
    { id: "capital", label: "資金籌碼", title: "資金籌碼", description: "三大法人估算流向、板塊輪動與資金加速度；資料以收盤日為準。" },
    { id: "global", label: "全球總經", title: "全球總經", description: "美股、半導體、波動率、利率與匯率；各市場分別標示日期與更新方式。" },
    { id: "research", label: "AI 研究", title: "AI 研究室", description: "沿用現有 AI 整理結果；資料不足或尚未產生時清楚標示。" },
    { id: "technical", label: "技術攻防", title: "技術攻防", description: "盤前關鍵位階、盤中確認與盤後驗證；推估價位不等於即時行情。" }
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

  function quoteMeta(q, fallbackDate, fallbackMode) {
    const date = q && (q.dataDate || q.date) || fallbackDate || "日期未提供";
    const time = q && (q.sourceTime || q.time) || "來源時間未提供";
    const source = q && q.source || "來源未提供";
    const mode = q && (q.updateModeText || q.updateMode) || fallbackMode || "更新方式未提供";
    return { date, time, source, mode };
  }

  function quoteCard(title, code, q, fallbackDate, fallbackMode) {
    const price = q && (q.price ?? q.close);
    const change = q && q.chgPct;
    const meta = quoteMeta(q, fallbackDate, fallbackMode);
    const state = q && q.date && q.date === todayTW() ? "今日資料" : "最近交易日";
    const tone = isNum(change) ? (change > 0 ? "up" : change < 0 ? "down" : "flat") : "flat";
    return '<article class="mc-market-card">' +
      '<div class="mc-market-card-head"><b>' + escapeHtml(title) + '</b><span>' + escapeHtml(code) + '</span></div>' +
      '<div class="mc-market-card-value ' + tone + '">' + escapeHtml(numberFmt(price, 2)) + '</div>' +
      '<div class="mc-market-card-change ' + tone + '">' + escapeHtml(isNum(change) ? signed(change) + "%" : "漲跌幅未提供") + '</div>' +
      '<div class="mc-market-card-meta">' + escapeHtml(meta.date) + ' · ' + escapeHtml(meta.time) + '</div>' +
      '<div class="mc-market-card-foot"><span>' + escapeHtml(state) + '</span><span>' + escapeHtml(meta.source) + '</span></div>' +
    '</article>';
  }

  function flowMoney(value) {
    return isNum(value) ? (value > 0 ? "+" : "") + (Math.abs(value) >= 100 ? Math.round(value) : value.toFixed(1)) + " 億" : "—";
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
    let hero = page.querySelector(".td-hero");
    const gridHtml = '<div class="mc-panel-head"><div><span class="mc-eyebrow">MARKET BREADTH</span><h4>市場廣度</h4></div><span class="mc-date">' +
      escapeHtml(flow.date || "資料日期未提供") + '</span></div><div class="mc-breadth-mount"></div>';
    const sectorHtml = '<div class="mc-panel-head"><div><span class="mc-eyebrow">SECTOR MOMENTUM</span><h4>族群資金強弱</h4></div><span class="mc-date">' +
      escapeHtml(flow.date || "法人資料待更新") + '</span></div><div class="mc-overview-sector"></div>';
    const panel = ensurePanel(page, ".mc-overview-grid", "mc-overview-grid", "overview",
      '<section class="mc-panel mc-breadth-panel">' + gridHtml + '</section><section class="mc-panel mc-overview-sector-panel">' + sectorHtml + '</section>');
    const breadthMount = panel.querySelector(".mc-breadth-mount");
    const breadth = hero && hero.querySelector(".td-breadth");
    if (breadth && breadthMount && breadth.parentElement !== breadthMount) breadthMount.appendChild(breadth);
    if (!breadthMount || !breadthMount.children.length) {
      breadthMount.innerHTML = '<p class="mc-empty">市場廣度資料尚未與最新加權行情對齊；不以其他交易日資料補入。</p>';
    }
    const sectorMount = panel.querySelector(".mc-overview-sector");
    const list = flow.sectors.filter(x => isNum(x.net1) && x.net1 !== 0).sort((a, b) => Math.abs(b.net1) - Math.abs(a.net1)).slice(0, 6);
    const max = Math.max(1, ...list.map(x => Math.abs(x.net1)));
    sectorMount.innerHTML = list.length
      ? list.map(x => flowRow(x, max)).join("") + '<p class="mc-data-note">依現有法人張數與收盤價估算；不同題材可能重複包含同一檔股票。</p>'
      : '<p class="mc-empty">尚無可比較的同日板塊法人金額，待資料完整後顯示。</p>';
    if (hero) hero.after(panel);
    const mine = page.querySelector("#td-sec-mine");
    if (mine) mine.dataset.mcSection = "overview";
  }

  function renderCapital(page, flow) {
    const positive = flow.sectors.filter(x => isNum(x.net1) && x.net1 > 0).sort((a, b) => b.net1 - a.net1).slice(0, 5);
    const negative = flow.sectors.filter(x => isNum(x.net1) && x.net1 < 0).sort((a, b) => a.net1 - b.net1).slice(0, 5);
    const max = Math.max(1, ...positive.concat(negative).map(x => Math.abs(x.net1)));
    const html = '<div class="mc-panel-head"><div><span class="mc-eyebrow">INSTITUTIONAL FLOW</span><h4>法人資金流向排行</h4></div><span class="mc-date">' +
      escapeHtml(flow.date || "資料日期未提供") + '</span></div>' +
      '<div class="mc-flow-columns"><div><h5 class="up">資金流入</h5>' +
      (positive.length ? positive.map(x => flowRow(x, max)).join("") : '<p class="mc-empty">目前沒有可確認的淨流入板塊。</p>') +
      '</div><div><h5 class="down">資金流出</h5>' +
      (negative.length ? negative.map(x => flowRow(x, max)).join("") : '<p class="mc-empty">目前沒有可確認的淨流出板塊。</p>') +
      '</div></div>' +
      '<div class="mc-flow-foot"><span>統計日期：' + escapeHtml(flow.date || "未提供") + '</span><span>單位：億元（估算）</span></div>' +
      '<p class="mc-data-note">估算方式：三大法人買賣超張數 × 1,000 股 × 收盤價 ÷ 1 億。不是逐筆成交金額；缺值不代表零買賣超。</p>';
    const panel = ensurePanel(page, ".mc-capital-panel", "mc-panel mc-capital-panel", "capital", html);
    const sectionBar = page.querySelector(".dh-secbar");
    if (sectionBar) sectionBar.before(panel);
    const detail = page.querySelector("#td-sec-flow");
    if (detail) detail.dataset.mcSection = "capital";
  }

  function renderGlobal(page, W) {
    const U = W && W.bf && W.bf.us || {};
    const rows = []
      .concat(Array.isArray(U.indices) ? U.indices : [])
      .concat(Array.isArray(U.macro) ? U.macro : [])
      .concat(Array.isArray(U.megas) ? U.megas : []);
    const extra = W && W.gl && W.gl.ok && Array.isArray(W.gl.groups)
      ? W.gl.groups.flatMap(group => Array.isArray(group.rows) ? group.rows : []) : [];
    const byCode = new Map();
    rows.concat(extra).forEach(item => {
      if (item && item.code && !byCode.has(item.code)) byCode.set(item.code, item);
    });
    const cards = Array.from(byCode.values()).slice(0, 15).map(item => {
      const price = item.price ?? item.close;
      const change = item.chgPct;
      const tone = isNum(change) ? (change > 0 ? "up" : change < 0 ? "down" : "flat") : "flat";
      const date = item.dataDate || item.date || U.dataDate || U.date || "日期未提供";
      const time = item.sourceTime || item.time || U.sourceTime || "來源時間未提供";
      const zone = item.tz ? "（" + item.tz + "）" : "";
      const source = item.source || U.source || "來源未提供";
      return '<article class="mc-global-card"><div class="mc-global-name"><b>' + escapeHtml(item.name || item.code) + '</b><span>' + escapeHtml(item.code) + '</span></div>' +
        '<div class="mc-global-price">' + escapeHtml(numberFmt(price, 3)) + '</div>' +
        '<div class="mc-global-change ' + tone + '">' + escapeHtml(isNum(change) ? signed(change) + "%" : "漲跌幅未提供") + '</div>' +
        '<div class="mc-global-meta">' + escapeHtml(date) + ' · ' + escapeHtml(time + zone) + '</div>' +
        '<div class="mc-global-source">' + escapeHtml(source) + '</div></article>';
    }).join("");
    const stateLabels = { live: "供應商盤中報價（可能延遲）", confirmed: "收盤確認", partial: "資料不完整", stale: "過期資料", holiday: "休市資料", unavailable: "無資料" };
    const updateLabels = { scheduled: "定時更新", after_close: "盤後更新" };
    const status = stateLabels[U.dataStatus] || "狀態未提供";
    const update = updateLabels[U.updateMode] || "更新方式未提供";
    const panelHtml = '<div class="mc-panel-head"><div><span class="mc-eyebrow">GLOBAL MARKETS</span><h4>全球市場矩陣</h4></div><span class="mc-status-chip">' + escapeHtml(status) + '</span></div>' +
      '<div class="mc-global-summary"><span>資料日期 <b>' + escapeHtml(U.dataDate || U.date || "未提供") + '</b></span><span>來源時間 <b>' + escapeHtml(U.sourceTime || "未提供") + (U.tz ? "（" + escapeHtml(U.tz) + "）" : "") + '</b></span><span>更新方式 <b>' + escapeHtml(update) + '</b></span><span>來源 <b>' + escapeHtml(U.source || "Yahoo Finance") + '</b></span></div>' +
      (cards ? '<div class="mc-global-grid">' + cards + '</div>' : '<p class="mc-empty">全球市場資料尚未取得；不以其他市場或其他日期的價格代填。</p>') +
      '<p class="mc-data-note">美股行情使用其自身交易日期與來源時間；供應商盤中報價可能延遲，並非交易所逐筆即時。</p>';
    const panel = ensurePanel(page, ".mc-global-panel", "mc-panel mc-global-panel", "global", panelHtml);
    const sectionBar = page.querySelector(".dh-secbar");
    if (sectionBar) sectionBar.before(panel);
    const detail = page.querySelector("#td-sec-mac");
    if (detail) detail.dataset.mcSection = "global";
  }

  function parseLevel(caption, label) {
    const match = String(caption || "").match(new RegExp(label + "\\s+([0-9,]+)"));
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function renderTechnical(page, W) {
    const detail = page.querySelector("#td-sec-plan");
    const caption = detail && detail.querySelector(".dh-sec-s") ? detail.querySelector(".dh-sec-s").textContent : "";
    const levels = [
      { key: "pressure", label: "壓力", value: parseLevel(caption, "壓力"), desc: "突破後觀察是否站穩" },
      { key: "pivot", label: "多空分水嶺", value: parseLevel(caption, "分水嶺"), desc: "盤勢位置的判讀基準" },
      { key: "support", label: "支撐", value: parseLevel(caption, "支撐"), desc: "跌破後重新評估風險" }
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
    if (detail) detail.dataset.mcSection = "technical";
  }

  function installStyles(doc) {
    if (doc.getElementById("kl-market-center-style")) return;
    const style = doc.createElement("style");
    style.id = "kl-market-center-style";
    style.textContent = [
      ".td-page{--mc-card:var(--surface);--mc-soft:var(--surface-2);--mc-border:var(--line)}",
      ".mc-nav{display:flex;gap:8px;margin:16px 0 10px;padding:0 0 5px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}",
      ".mc-nav::-webkit-scrollbar{display:none}",
      ".mc-tab{position:relative;flex:1 0 auto;min-width:100px;min-height:46px;padding:10px 16px;border:1px solid var(--mc-border);border-radius:8px;background:var(--mc-soft);color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .16s,border-color .16s,color .16s}",
      ".mc-tab[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--ink);box-shadow:inset 0 -2px 0 var(--accent)}",
      ".mc-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:8px 0 14px}",
      ".mc-heading h4{margin:0;font-size:20px;font-weight:750;letter-spacing:.01em;color:var(--ink)}",
      ".mc-heading p{margin:0;color:var(--muted);font-size:12px;line-height:1.5}",
      ".mc-panel{min-width:0;padding:16px;border:1px solid var(--mc-border);border-radius:12px;background:var(--mc-card);box-shadow:0 5px 18px rgba(0,0,0,.06)}",
      ".mc-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}",
      ".mc-panel-head h4{margin:3px 0 0;font-size:16px;font-weight:700;color:var(--ink)}",
      ".mc-eyebrow{font-size:10px;letter-spacing:.14em;font-weight:700;color:var(--muted)}",
      ".mc-date{font-size:11px;color:var(--muted);white-space:nowrap}",
      ".mc-status-chip,.mc-model-tag{display:inline-flex;align-items:center;min-height:24px;padding:3px 9px;border:1px solid var(--mc-border);border-radius:999px;background:var(--mc-soft);color:var(--muted);font-size:11px;line-height:1.35}",
      ".td-page .td-hero{display:grid!important;grid-template-columns:minmax(0,1.45fr) minmax(270px,.9fr);gap:14px;align-items:stretch;margin:0 0 14px}",
      ".td-page .td-main,.td-page .td-side{min-width:0;padding:16px;border:1px solid var(--mc-border);border-radius:12px;background:var(--mc-card);box-shadow:0 5px 18px rgba(0,0,0,.06)}",
      ".td-page .td-side{display:flex;flex-direction:column;gap:12px}",
      ".td-page .td-side .td-breadth{display:none}",
      ".td-page .td-ix{min-height:180px}",
      ".td-page .td-ix-plot{min-height:180px}",
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
      "@media(max-width:760px){.td-page .td-hero{grid-template-columns:minmax(0,1fr)}.mc-overview-grid{grid-template-columns:minmax(0,1fr)}.mc-global-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mc-flow-columns{grid-template-columns:minmax(0,1fr);gap:12px}.mc-heading{align-items:flex-start;flex-direction:column;gap:4px}}",
      "@media(max-width:430px){.mc-tab{flex:0 0 auto;min-width:90px;padding:9px 12px}.mc-panel{padding:13px}.td-page .td-main,.td-page .td-side{padding:12px}.mc-flow-row{grid-template-columns:minmax(82px,1fr) minmax(45px,1fr) minmax(50px,.7fr);gap:7px}.mc-tech-ladder{grid-template-columns:minmax(0,1fr)}.mc-level-row{display:grid;grid-template-columns:1fr auto;align-items:center}.mc-level-row small{grid-column:1/-1}.mc-global-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mc-global-price{font-size:17px}}"
    ].join("\n");
    (doc.head || doc.documentElement).appendChild(style);
  }

  function applyWorkspace(page, state, workspace) {
    state.workspace = normalizeWorkspace(workspace);
    const active = WORKSPACES.find(item => item.id === state.workspace) || WORKSPACES[0];
    page.querySelectorAll("[data-mc-tab]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.mcTab === active.id));
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

  let stateRef = null;

  function enhance(host, W) {
    const page = host && host.matches && host.matches(".td-page") ? host : host && host.querySelector ? host.querySelector(".td-page") : null;
    const state = ensureState(W);
    if (!page || !state || !page.querySelector(".dh-status-bar")) return false;
    installStyles(page.ownerDocument);

    page.querySelector(".td-quicknav")?.remove();
    const hero = page.querySelector(".td-hero");
    const status = page.querySelector(".dh-status-bar");
    const summary = page.querySelector(".td-market-summary");
    const nav = page.querySelector(".mc-nav") || page.ownerDocument.createElement("nav");
    if (!nav.classList.contains("mc-nav")) {
      nav.className = "mc-nav";
      nav.setAttribute("aria-label", "今日市場工作區");
      nav.innerHTML = WORKSPACES.map(item =>
        '<button type="button" class="mc-tab" data-mc-tab="' + item.id + '" aria-pressed="false">' + item.label + "</button>"
      ).join("");
    }
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
    renderCapital(page, flow);
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

    applyWorkspace(page, state, state.workspace);
    if (!window.__klMarketCenterClickBound) {
      window.__klMarketCenterClickBound = true;
      document.addEventListener("click", event => {
        const target = event.target;
        const button = target.closest && target.closest("[data-mc-tab]");
        if (!button) {
          const aiTrigger = target.closest && target.closest('[data-tx="tdai"]');
          const aiHost = aiTrigger && document.getElementById("lx");
          if (aiHost && stateRef) {
            queueMicrotask(() => {
              const currentPage = aiHost.querySelector(".td-page");
              if (currentPage && stateRef) applyWorkspace(currentPage, stateRef, "research");
            });
          }
          return;
        }
        const currentPage = button.closest(".td-page");
        if (!currentPage || !stateRef) return;
        event.preventDefault();
        applyWorkspace(currentPage, stateRef, button.dataset.mcTab);
      });
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
    enhance
  });
})();