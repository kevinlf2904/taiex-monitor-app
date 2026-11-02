// 今日市場 V2：五工作區皆有對應視覺內容；來源日期與更新狀態可辨識；手機與桌面無水平溢位。
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const GLOBAL_TEST_GROUPS = [
  { id: "energy", name: "能源", codes: ["CL=F", "BZ=F", "NG=F", "HO=F", "RB=F"] },
  { id: "metal", name: "金屬", codes: ["GC=F", "SI=F", "HG=F", "PL=F", "PA=F", "ALI=F"] },
  { id: "agri", name: "農產", codes: ["ZS=F", "ZC=F", "ZW=F", "KC=F", "SB=F", "CT=F"] },
  { id: "ship", name: "航運", codes: ["BDRY", "BOAT"], note: "以航運 ETF 作為運價參考" },
  { id: "fx", name: "外匯", codes: ["DX-Y.NYB", "TWD=X", "JPY=X", "CNY=X", "HKD=X", "EUR=X", "GBP=X", "KRW=X", "AUD=X"] },
  { id: "rate", name: "美債殖利率", codes: ["^IRX", "^FVX", "^TNX", "^TYX"] },
  { id: "crypto", name: "加密貨幣", codes: ["BTC-USD", "ETH-USD"] }
];
const makeGlobalFixture = () => ({
  ok: true,
  source: "Yahoo Finance（可能延遲 10～15 分鐘）",
  sourceFetchedAt: "2026-10-26T02:30:00.000Z",
  at: Date.parse("2026-10-26T02:30:00.000Z"),
  failed: [],
  groups: GLOBAL_TEST_GROUPS.map((group, groupIndex) => ({
    id: group.id,
    name: group.name,
    ...(group.note ? { note: group.note } : {}),
    rows: group.codes.map((code, index) => ({
      code,
      name: code,
      price: 50 + groupIndex * 10 + index,
      chg: index - 1,
      chgPct: +((index - 1) * 0.2).toFixed(2),
      ...(code === "CL=F" ? {} : {
        dataDate: "2026-10-26",
        date: "2026-10-26",
        sourceTime: "10:29:00",
        time: "10:29:00",
        tz: "美東"
      }),
      source: "Yahoo Finance",
      dataStatus: code === "TWD=X" ? "stale" : "confirmed",
      updateMode: "scheduled"
    }))
  }))
});

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const selectWorkspace = async (page, id) => {
  await page.click('#lx [data-mc-tab="' + id + '"]');
  await page.waitForFunction(key => document.querySelector('#lx [data-mc-tab="' + key + '"]')?.getAttribute("aria-selected") === "true", id);
};

for (const width of [390, 1280]) test("今日市場 V2：工作區視覺層級與資料標示 " + width, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.clock.setFixedTime(new Date("2026-10-26T10:30:00+08:00"));
  await p.evaluate(globalFixture => {
    W.quotes.set("T00", { code: "T00", name: "加權指數", price: 27500, prev: 27380, chg: 120, chgPct: 0.44, date: "2026-10-26", time: "10:30:00", sourceTime: "10:30:00", source: "證交所 MIS", open: 27400, high: 27550, low: 27390 });
    W.quotes.set("O00", { code: "O00", name: "櫃買指數", price: 260, chg: 1.2, chgPct: 0.46, date: "2026-10-26", time: "10:29:50", source: "櫃買中心" });
    W.quotes.set("TXF", { code: "TXF", name: "台指期", price: 27520, chg: 115, chgPct: 0.42, date: "2026-10-26", time: "10:29:40", source: "期交所" });
    store.set("watch:brief:snap:2026-10-26", {
      tradeDate: "2026-10-26", createdAt: "2026-10-26T08:30:00+08:00",
      keyLevels: { pressure: 133, pivot: 100, support: 72 },
      scenarios: {
        bull: { title: "多方", trigger: "站上分水嶺" },
        neutral: { title: "震盪", trigger: "區間整理" },
        bear: { title: "空方", trigger: "跌破支撐" }
      }
    });
    W.bf = {
      at: Date.now(),
      us: {
        ok: true, dataStatus: "confirmed", updateMode: "after_close", dataDate: "2026-10-23",
        sourceTime: "16:00", tz: "美東", source: "Yahoo Finance",
        indices: [
          { code: "^DJI", name: "道瓊工業", price: 47000, chgPct: 0.35, date: "2026-10-23", time: "16:00", source: "Yahoo Finance" },
          { code: "^GSPC", name: "S&P 500", price: 6800, chgPct: 0.5, date: "2026-10-23", time: "16:00", source: "Yahoo Finance" },
          { code: "^SOX", name: "費城半導體", price: 6400, chgPct: 1.1, date: "2026-10-23", time: "16:00", source: "Yahoo Finance" }
        ],
        macro: [{ code: "^TNX", name: "美國 10 年期公債殖利率", price: 4.2, chgPct: -0.2, date: "2026-10-23", time: "16:00" }],
        megas: [{ code: "TSM", name: "台積電 ADR", price: 205, chgPct: 0.8, date: "2026-10-23", time: "16:00" }]
      }
    };
    W.gl = globalFixture;
    W.tdPh = null;
    setLt("today");
    renderList();
  }, makeGlobalFixture());

  await p.waitForSelector("#lx .mc-overview-grid", { timeout: 15000 });
  assert.equal(await p.$$eval("#lx .mc-nav [data-mc-tab]", buttons => buttons.length), 5);
  assert.equal(await p.locator("#lx .mc-nav").getAttribute("role"), "tablist");
  assert.equal(await p.$$eval('#lx .mc-nav [role="tab"][aria-selected="true"]', tabs => tabs.length), 1);
  assert.equal(await p.$eval("#detail", drawer => drawer.hasAttribute("data-mc-section")), false,
    "今日市場不得把看盤頁的個股抽屜註冊為工作區內容");
  const dateAlignment = await p.evaluate(() => window.KLMarketCenter.flowAlignment(
    { quotes: new Map([["T00", { date: "2026-10-26" }]]) },
    { date: "2026-10-23" }
  ));
  assert.equal(dateAlignment.tone, "warn");
  assert.match(dateAlignment.note, /不是同日資料/);
  const sameDateAlignment = await p.evaluate(() => window.KLMarketCenter.flowAlignment(
    { quotes: new Map([["T00", { date: "2026-10-26" }]]) },
    { date: "2026-10-26" }
  ));
  assert.equal(sameDateAlignment.tone, "ok");
  await p.locator('#lx [data-mc-tab="overview"]').focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForFunction(() => document.querySelector('#lx [data-mc-tab="capital"]')?.getAttribute("aria-selected") === "true");
  await p.keyboard.press("Home");
  await p.waitForFunction(() => document.querySelector('#lx [data-mc-tab="overview"]')?.getAttribute("aria-selected") === "true");
  assert.ok(await p.$("#lx .mc-overview-grid .mc-panel"));
  assert.ok(await p.$("#lx .td-hero .td-main"));
  assert.ok(await p.$("#lx .td-hero .dh-core-grid"));
  const firstScreen = await p.evaluate(() => {
    const grid = document.querySelector("#lx .td-hero .dh-core-grid");
    const chart = document.querySelector("#lx .td-hero .td-ix");
    return { height: innerHeight, gridTop: grid?.getBoundingClientRect().top, gridBottom: grid?.getBoundingClientRect().bottom, chartTop: chart?.getBoundingClientRect().top };
  });
  assert.ok(firstScreen.gridTop < firstScreen.chartTop, "核心數字應在分時圖之前");
  assert.ok(firstScreen.gridBottom < firstScreen.height, "390px 第一屏內必須完整看見核心數字：" + JSON.stringify(firstScreen));
  await selectWorkspace(p, "capital");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-capital-panel")?.hidden), false);
  assert.match(await p.textContent("#lx .mc-capital-panel"), /法人資金流向排行/);
  await selectWorkspace(p, "global");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-global-panel")?.hidden), false);
  assert.match(await p.textContent("#lx .mc-global-panel"), /2026-10-23/);
  assert.match(await p.textContent("#lx .mc-global-panel"), /盤後更新/);
  assert.match(await p.textContent("#lx .mc-global-panel"), /費城半導體/);
  assert.equal(await p.$("#lx #td-sec-mac"), null,
    "完整全球矩陣已取代舊總經明細，不能重複顯示美股與國際行情");
  assert.equal(await p.$$eval("#lx .mc-global-shortcuts [data-tdgo]", buttons => buttons.length), 4,
    "整併後仍需保留前往既有市場工具的快捷入口");
  const oilMeta = await p.$$eval("#lx .mc-global-card", cards =>
    cards.find(card => card.querySelector(".mc-global-name span")?.textContent.trim() === "CL=F")
      ?.querySelector(".mc-global-meta")?.textContent || ""
  );
  assert.match(oilMeta, /日期未提供/, "非美股市場不可借用美股日期");
  assert.doesNotMatch(oilMeta, /2026-10-23/, "原油未提供日期時不得套用美股交易日");
  const internationalGroups = await p.$$eval('#lx .mc-global-group[data-mc-global-kind="international"]', groups =>
    groups.map(group => ({ id: group.dataset.mcGlobalGroup, count: group.querySelectorAll(".mc-global-card").length })));
  assert.equal(internationalGroups.length, 7, "國際市場應完整呈現 API 定義的 7 個分類");
  assert.equal(internationalGroups.reduce((sum, group) => sum + group.count, 0), 34, "不得因顯示上限截斷 34 個國際市場標的");
  assert.deepEqual(internationalGroups.map(group => group.id), ["energy", "metal", "agri", "ship", "fx", "rate", "crypto"]);
  const oilText = await p.$eval('#lx .mc-global-card[data-mc-code="CL=F"]', card => card.textContent);
  assert.match(oilText, /市場日期未提供/);
  assert.match(oilText, /來源時間未提供/);
  assert.doesNotMatch(oilText, /2026-10-23/, "原油不能借用美股市場日期");
  const globalText = await p.textContent("#lx .mc-global-panel");
  assert.match(globalText, /API 回應時間/);
  assert.match(globalText, /前端取得／快取時間/);
  const staleFx = await p.$eval('#lx .mc-global-card[data-mc-code="TWD=X"]', card => card.textContent);
  assert.match(staleFx, /來源資料過期/, "個別標的的過期狀態需獨立顯示");
  await selectWorkspace(p, "technical");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-tech-panel")?.hidden), false);
  const technicalText = await p.textContent("#lx .mc-tech-panel");
  assert.match(technicalText, /關鍵位階與攻防/);
  assert.match(technicalText, /133 點/);
  assert.match(technicalText, /100 點/);
  assert.match(technicalText, /72 點/);
  assert.equal(await p.$eval("#detail", drawer => drawer.hasAttribute("data-mc-section")), false,
    "切換技術攻防不得改動全站個股資訊抽屜");
  await selectWorkspace(p, "research");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-ai-panel")?.hidden), false);
  assert.equal(await p.evaluate(() => document.querySelector("#lx .dh-secs")?.hidden), true);

  const layout = await p.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    navButtons: [...document.querySelectorAll("#lx .mc-tab")].map(button => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    })
  }));
  assert.ok(layout.scrollWidth <= layout.width + 1, "V2 工作區不可造成水平溢位：" + JSON.stringify(layout));
  assert.ok(layout.navButtons.every(button => button.height >= 44 && button.width >= 44), "工作區按鈕須有足夠觸控尺寸");
  await selectWorkspace(p, "overview");
  await p.evaluate(() => { window.aiChat = () => new Promise(() => {}); });
  await p.click('#lx [data-tx="tdai"]');
  await p.waitForFunction(() => document.querySelector('#lx [data-mc-tab="research"]')?.getAttribute("aria-selected") === "true");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-ai-panel")?.hidden), false, "按 AI 整理後必須自動切換到 AI 研究");
  assert.ok(await p.$("#lx .mc-ai-panel .caibox"), "AI 整理結果必須留在可見的 AI 研究區");
  await ctx.close();
  assert.deepEqual(errs, []);
});


test("今日市場 V2.1：全球行情按需載入，過期後自動刷新且避免重複請求", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-26T10:30:00+08:00"));
  let globalHits = 0;
  await ctx.route("**/api/global", route => {
    globalHits += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: "Yahoo Finance",
        at: "2026-10-26T02:30:00.000Z",
        groups: [{ id: "energy", name: "能源", rows: [{ code: "CL=F", name: "原油", price: 65, chgPct: 0.2, dataStatus: "confirmed" }] }],
        failed: []
      })
    });
  });
  await p.evaluate(() => {
    W.bf = { us: { ok: true, dataStatus: "confirmed", updateMode: "after_close", dataDate: "2026-10-23", sourceTime: "16:00", tz: "美東", source: "Yahoo Finance", indices: [], macro: [], megas: [] } };
    W.gl = null;
    setLt("today");
    renderList();
  });
  // 總覽的「美元／台幣」卡片也讀國際行情：停在總覽就要抓一次（只一次），切到全球總經時資料還新，不再重抓
  await p.waitForFunction(() => W.gl?.ok === true && !W.glLoading);
  assert.equal(globalHits, 1, "市場總覽只發出一次初始請求");
  await p.evaluate(() => renderList());
  assert.equal(globalHits, 1, "總覽重畫不重複請求");
  await selectWorkspace(p, "global");
  assert.equal(globalHits, 1, "開啟全球總經時資料仍新，不重複請求");
  await p.evaluate(() => {
    W.gl.sourceFetchedAt = "2026-10-26T02:28:00.000Z";
    W.marketCenter.globalRefreshAttemptAt = Date.now() - 60_000;
  });
  await p.waitForFunction(() => !W.glLoading && W.marketCenter.globalRefreshAttemptAt >= Date.now(), { timeout: 20000 });
  assert.equal(globalHits, 2, "全球工作區停留期間，資料超過 60 秒應自動刷新");
  await ctx.close();
  assert.deepEqual(errs, []);
});

test("今日市場 AI 研究：工作區內就有「開始 AI 整理」，成功、失敗都留在研究區並可重試", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 600 });
    await p.evaluate(() => { W.tdPh = null; W.tdAI = null; setLt("today"); renderList(); });
    await p.click('#lx [data-mc-tab="research"]');
    assert.equal(await p.textContent("#lx .mc-ai-run"), "開始 AI 整理", width + "：研究區要有明顯的開始按鈕");
    assert.match(await p.textContent("#lx .mc-ai-panel"), /尚未產生 AI 摘要/);
    await p.click("#lx .mc-ai-run");
    await p.waitForFunction(() => /測試回覆/.test(document.querySelector("#lx .mc-ai-panel .caibox")?.textContent || ""));
    assert.equal(await p.textContent("#lx .mc-ai-run"), "重新整理");
    assert.equal(await p.evaluate(() => W.marketCenter.workspace), "research", "整理完仍停在 AI 研究");
    await p.evaluate(() => { window.aiChat = () => Promise.reject(new Error("伺服器尚未設定 GEMINI_API_KEY")); });
    await p.click("#lx .mc-ai-run");
    await p.waitForFunction(() => /⚠︎/.test(document.querySelector("#lx .mc-ai-panel .caibox")?.textContent || ""));
    assert.match(await p.textContent("#lx .mc-ai-panel .caibox"), /GEMINI_API_KEY/, "失敗原因要顯示在研究區");
    assert.equal(await p.textContent("#lx .mc-ai-run"), "重試 AI 整理");
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(sw <= 1, width + "：不可水平溢位");
    await ctx.close();
    assert.deepEqual(errs, []);
  }
});

test("今日市場總覽：沒切過全球總經也會補抓國際行情，美元／台幣卡片有值；警示用琥珀色不用漲跌色", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  let hits = 0;
  await ctx.route("**/api/global", r => { hits++; r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, at: new Date().toISOString(), groups: [{ id: "fx", name: "外匯", rows: [{ code: "TWD=X", name: "美元台幣", price: 32.1, chgPct: 0.1, dataStatus: "stale" }] }] }) }); });
  await p.evaluate(() => { W.gl = undefined; W.tdPh = null; setLt("today"); renderList(); });
  await p.waitForFunction(() => [...document.querySelectorAll("#lx .dh-core-card")].some(c => /美元／台幣[\s\S]*32\.1/.test(c.textContent)));
  assert.equal(hits, 1);
  await p.evaluate(() => renderList());
  assert.equal(hits, 1, "資料還新時重畫不重複抓");
  await p.click('#lx [data-mc-tab="global"]');
  await p.waitForSelector('#lx .mc-global-card[data-mc-code="TWD=X"] .mc-global-status.warn');
  const C = await p.evaluate(() => {
    const probe = document.createElement("i"); probe.style.color = "var(--warn)"; document.body.appendChild(probe);
    const warn = getComputedStyle(probe).color; probe.remove();
    return { status: getComputedStyle(document.querySelector('#lx .mc-global-card[data-mc-code="TWD=X"] .mc-global-status.warn')).color, warn };
  });
  assert.equal(C.status, C.warn, "過期狀態用 --warn");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("技術攻防：平日收盤後沒有今天的盤前快照，改顯示下一交易日預估位階且不存快照；有快照就照舊", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 600, time: new Date("2026-10-26T15:00:00+08:00") });
    const setup = snap => p.evaluate(snap => {
      W.cal = { hol: [] };
      W.quotes.set("T00", { code: "T00", name: "加權指數", price: 100, prev: 99, chg: 1, chgPct: 1.01, high: 101, low: 98, vol: 1000, date: "2026-10-26", time: "13:30:00", source: "證交所 MIS" });
      window.__saved = []; window.__asked = [];
      window.getBriefSnapshot = d => (snap && d === "2026-10-26" ? { keyLevels: { pressure: 130, pivot: 120, support: 115 } } : null);
      window.saveBriefSnapshot = (d, plan) => window.__saved.push(d);
      window.tdAtrFor = t => ({ t, state: "ok", atr: 2 });
      window.briefScenarios = (G, d, base) => { window.__asked.push([d, base]); return { tradeDate: d, keyLevels: { pressure: 110, pivot: 100, support: 90 } }; };
      W.tdPh = null; setLt("today"); renderList();
    }, snap);
    await setup(false);
    await selectWorkspace(p, "technical");
    let t = await p.textContent("#lx .mc-tech-panel");
    assert.match(t, /110 點[\s\S]*100 點[\s\S]*90 點/, width + "：收盤後要有位階數字，不是待更新");
    assert.match(t, /下一交易日 10\/27 的預估位階/);
    assert.doesNotMatch(t, /待更新/);
    assert.ok(await p.evaluate(() => window.__asked.some(([d, base]) => d === "2026-10-27" && base === 100)), "用今日收盤推算下一交易日");
    assert.ok(!(await p.evaluate(() => window.__saved.includes("2026-10-27"))), "預估不存快照，隔天盤前才用最新美股重新推演");
    await setup(true);
    await selectWorkspace(p, "technical");
    t = await p.textContent("#lx .mc-tech-panel");
    assert.match(t, /130 點[\s\S]*120 點[\s\S]*115 點/, "有今天的盤前快照就照舊顯示");
    assert.doesNotMatch(t, /預估位階/);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(sw <= 1, width + "：不可水平溢位");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("全球總經：CDN 快取造成的 1～6 分鐘延遲不算未更新，超過 7 分鐘才提示；工作區分頁只用 aria-selected", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true, time: new Date("2026-10-26T10:30:00+08:00") });
  const status = minutesAgo => p.evaluate(m => {
    const at = new Date(Date.now() - m * 60000).toISOString();
    W.gl = { ok: true, source: "Yahoo Finance", sourceFetchedAt: at, at: Date.now(), failed: [], groups: [{ id: "fx", name: "外匯", rows: [{ code: "TWD=X", name: "美元台幣", price: 32, chgPct: 0.1 }] }] };
    W.marketCenter = { ...(W.marketCenter || {}), workspace: "global", globalRefreshAttemptAt: Date.now() }; // 這次不重抓，只看狀態文字
    W.tdPh = null; setLt("today"); renderList();
    return document.querySelector("#lx .mc-global-panel .mc-status-chip")?.textContent;
  }, minutesAgo);
  assert.equal(await status(3), "API 回應成功 1/1", "CDN 快取內的延遲不提示");
  assert.equal(await status(10), "國際行情已 10 分鐘未更新");
  const tabs = await p.$$eval("#lx .mc-tab", L => L.map(b => [b.getAttribute("role"), b.hasAttribute("aria-pressed"), b.getAttribute("aria-selected")]));
  assert.equal(tabs.length, 5);
  assert.ok(tabs.every(([role, pressed]) => role === "tab" && !pressed), "分頁不該有 aria-pressed");
  assert.deepEqual(tabs.map(t => t[2]), ["false", "false", "true", "false", "false"]);
  await ctx.close(); assert.deepEqual(errs, []);
});
