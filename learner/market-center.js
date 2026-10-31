// KLineLab 今日市場決策中心：只整合既有 DOM 與資料，不建立第二套行情／分析來源。
(() => {
  "use strict";

  const WORKSPACES = Object.freeze([
    { id: "overview", label: "市場總覽", title: "市場總覽", description: "今日市場判讀、核心行情、市場廣度，以及你的持股與自選。" },
    { id: "capital", label: "資金籌碼", title: "資金與籌碼", description: "沿用既有法人資金流向模型；估算金額與題材分類口徑請以區塊說明為準。" },
    { id: "global", label: "全球總經", title: "全球與總經", description: "沿用既有國際市場與總經資料；各市場保留自己的交易日期與更新時間。" },
    { id: "research", label: "AI 研究", title: "AI 研究室", description: "目前顯示既有 AI 摘要。逐條來源、反證與失效條件尚未結構化，不將摘要包裝成完整研究報告。" },
    { id: "technical", label: "技術攻防", title: "技術攻防", description: "沿用既有盤前推演、盤中確認與盤後驗證；模型價位屬推論，不是即時行情。" }
  ]);

  const normalizeWorkspace = value =>
    WORKSPACES.some(item => item.id === value) ? value : "overview";

  function ensureState(W) {
    if (!W || typeof W !== "object") return null;
    if (!W.marketCenter || typeof W.marketCenter !== "object") {
      W.marketCenter = {
        workspace: "overview",
        selectedSector: null,
        selectedStock: null,
        analysisDate: null
      };
    }
    W.marketCenter.workspace = normalizeWorkspace(W.marketCenter.workspace);
    return W.marketCenter;
  }

  function installStyles(doc) {
    if (doc.getElementById("kl-market-center-style")) return;
    const style = doc.createElement("style");
    style.id = "kl-market-center-style";
    style.textContent = [
      ".mc-nav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin:14px 0 8px}",
      ".mc-tab{min-width:0;min-height:44px;padding:8px 7px;border:1px solid var(--line);border-radius:5px;background:var(--surface-2);color:var(--muted);font:inherit;font-size:13px;line-height:1.25;cursor:pointer}",
      ".mc-tab[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--ink);font-weight:600}",
      ".mc-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:12px 0 8px}",
      ".mc-heading h4{margin:0;font-size:16px;font-weight:650;color:var(--ink)}",
      ".mc-heading p{margin:0;color:var(--muted);font-size:12px}",
      ".mc-ai-panel{padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}",
      ".mc-ai-panel h4{margin:0 0 6px;font-size:15px}",
      ".mc-ai-panel>p{margin:0 0 10px;color:var(--muted);font-size:12.5px}",
      ".mc-ai-panel .caibox{margin-top:10px}",
      ".td-page [data-mc-section][hidden],.td-page [data-mc-workspace][hidden]{display:none!important}",
      "@media(max-width:640px){.mc-nav{display:flex;gap:6px;overflow-x:auto;overscroll-behavior-x:contain;padding:0 0 4px;scrollbar-width:none}.mc-nav::-webkit-scrollbar{display:none}.mc-tab{flex:0 0 auto;min-width:86px;min-height:44px;padding:9px 12px}.mc-heading{align-items:flex-start;flex-direction:column;gap:3px}}"
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
    if (!page.querySelector(".mc-nav")) {
      const nav = page.ownerDocument.createElement("nav");
      nav.className = "mc-nav";
      nav.setAttribute("aria-label", "今日市場工作區");
      nav.innerHTML = WORKSPACES.map(item =>
        '<button type="button" class="mc-tab" data-mc-tab="' + item.id + '" aria-pressed="false">' + item.label + "</button>"
      ).join("");
      const mobile = page.ownerDocument.defaultView?.matchMedia?.("(max-width: 640px)")?.matches;
      if (hero && mobile) hero.after(nav);
      else if (hero) page.insertBefore(nav, hero);
      else if (status) status.after(nav);
    }

    if (!page.querySelector(".mc-heading")) {
      const heading = page.ownerDocument.createElement("div");
      heading.className = "mc-heading";
      heading.innerHTML = '<h4 data-mc-title></h4><p data-mc-description></p>';
      const nav = page.querySelector(".mc-nav");
      if (nav) nav.after(heading);
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

    let research = page.querySelector(".mc-ai-panel");
    if (!research) {
      research = page.ownerDocument.createElement("section");
      research.className = "mc-ai-panel";
      research.dataset.mcSection = "research";
      research.innerHTML = '<h4>AI 市場摘要</h4><p>目前沿用既有 AI 摘要功能。來源逐條追溯、支持證據、反證及失效條件尚未形成結構化資料，因此不會以空白欄位或推測內容假裝已完成。</p><div class="mc-ai-content"></div>';
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
          // AI 摘要會寫進 research 工作區；由其他工作區啟動時先切到結果所在位置。
          const aiTrigger = target.closest && target.closest('[data-tx="tdai"]');
          // tdai 的既有處理器會先重畫 #lx，舊 .td-page 會被移除；因此延後後須重新取得新頁面。
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
    enhance
  });
})();
