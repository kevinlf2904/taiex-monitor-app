// 今日市場：分頁改名、#daily／#today 都能直達、四個資訊區的固定順序與時段預設展開、休市預設盤前、總經不重複、自訂分頁順序不受影響、手機第一屏看得到結論
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, watchFrame } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const selectWorkspace = async (p, id) => {
  await p.click(`#lx [data-mc-tab="${id}"]`);
  await p.waitForFunction(key => document.querySelector(`#lx [data-mc-tab="${key}"]`)?.getAttribute("aria-pressed") === "true", id);
};


const openOf = p => p.evaluate(() => [...document.querySelectorAll("#lx details.dh-sec[open]")].map(d => d.dataset.tdbox));
const nowOf = p => p.evaluate(() => document.querySelector("#lx details.dh-sec.now")?.dataset.tdbox);

for (const [width, theme] of [[390, "dark"], [1280, "light"]]) test(`今日市場：固定順序的區塊、四種時段預設展開現在那一塊、展開才畫內容 ${width} ${theme}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
  assert.match(await p.textContent('#lTabs [data-l="today"]'), /^今日市場$/);
  const CASES = [["2026-10-26T08:00:00+08:00", ["mac", "plan"], "plan", /盤前推演[\s\S]*(情境|推演)/], ["2026-10-26T10:00:00+08:00", ["plan"], "plan", /自選漲 \d+ 跌 \d+[\s\S]*盤中監控/],
    ["2026-10-26T15:00:00+08:00", ["flow", "plan"], "plan", /盤前情境・盤中確認・盤後驗證[\s\S]*盤後整理[\s\S]*下一交易日行動清單/], ["2026-10-25T10:00:00+08:00", ["mac", "plan"], "plan", /今天休市，下面是下一交易日 10\/26[\s\S]*最近交易日盤後整理/]];
  for (const [at, want, now, re] of CASES) {
    await p.clock.setFixedTime(new Date(at));
    await p.evaluate(() => { W.tdPh = null; setLt("today"); renderList(); });
    await p.waitForFunction(() => !!document.querySelector("#lx details.dh-sec"), null, { timeout: 15000 });
    assert.deepEqual(await p.$$eval("#lx details.dh-sec", L => L.map(d => d.dataset.tdbox)), ["flow", "mac", "mine", "plan"], "順序固定");
    assert.deepEqual(await openOf(p), want, at); assert.equal(await nowOf(p), now, `「現在」標在目前時段 ${at}`);
    await selectWorkspace(p, "technical");
    const technicalText = await p.evaluate(() => $("#lx").innerText);
    assert.match(technicalText, re, at); assert.match(technicalText, /今日市場[\s\S]*重新整理/);
    if (want.includes("flow")) {
      await selectWorkspace(p, "capital");
      assert.match(await p.evaluate(() => $("#lx").innerText), /市場資金流向[\s\S]*盤後總結/);
    }
    if (want.includes("mac") && at.startsWith("2026-10-25")) {
      // 休市時的最近交易日事件回顧屬於技術攻防的交易情境，不在全球總經區。
      await selectWorkspace(p, "technical");
      assert.match(await p.evaluate(() => $("#lx").innerText), /最近交易日事件回顧/);
    }
    assert.equal(await p.$$eval("#lx .dh-sec-b", L => L.length), want.length, "收合的區塊不畫內容");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `沒有橫向溢出 ${at}`);
    await p.waitForTimeout(300); assert.equal(await p.$$eval("#lx .fold-btn", L => L.length), 0, `不會被自動收合成「展開全部」 ${at}`);
  }
  // 點標題展開別的區塊：每秒重畫也不會收回去（同一天記在記憶體）
  await selectWorkspace(p, "overview");
  await p.click('#lx details[data-tdbox="mine"] > summary'); await p.waitForFunction(() => !!document.querySelector('#lx details[data-tdbox="mine"] .dh-sec-b'));
  await p.evaluate(() => { W.ticking = true; renderList(); W.ticking = false; renderList(); });
  assert.deepEqual(await openOf(p), ["mac", "mine", "plan"]);
  // 全部展開、全部收合
  await p.click("#lx [data-tdall]"); assert.equal((await openOf(p)).length, 4); assert.match(await p.textContent("#lx [data-tdall]"), /全部收合/);
  await p.click("#lx [data-tdall]"); assert.deepEqual(await openOf(p), []);
  assert.equal(await p.evaluate(() => Object.keys(localStorage).some(k => /tdPh|tdph|tdOpen|tdsec/i.test(k))), false, "展開狀態不存進瀏覽器");
  // 資料來源收起來
  assert.equal(await p.evaluate(() => $("#lx .dh-more").open), false);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("總經儀表板：昨晚美股只在這裡（核心卡已有的費半、那斯達克、台積電 ADR 不再列）；原物料外匯補台幣、原油；連到大盤子頁 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-26T08:00:00+08:00"));
  await p.evaluate(() => { W.bf = { at: Date.now(), us: { ok: true, date: "2026-10-25", indices: [{ code: "^DJI", name: "道瓊工業", price: 42000, chgPct: 0.5 }, { code: "^SOX", name: "費城半導體", price: 5800, chgPct: 1.6 }, { code: "^IXIC", name: "那斯達克", price: 18000, chgPct: 0.9 }], megas: [{ code: "TSM", name: "台積電 ADR", price: 190, chgPct: 2 }], macro: [{ code: "^TNX", name: "美國 10 年期公債殖利率", price: 4.21, chgPct: -0.5 }] } }; W.tdPh = null; setLt("today"); renderList(); });
  await selectWorkspace(p, "global");
  await p.waitForFunction(() => /台幣/.test(document.querySelector('#lx details[data-tdbox="mac"]')?.innerText || ""), null, { timeout: 15000 });
  const m = await p.evaluate(() => document.querySelector('#lx details[data-tdbox="mac"]').innerText);
  assert.match(m, /道瓊 \+0\.5%・美債 4\.21%・台幣 31\.20/, "摘要用核心卡沒有的數字"); assert.match(m, /昨晚美股[\s\S]*道瓊工業[\s\S]*美國 10 年期/); assert.match(m, /美元／台幣[\s\S]*原油/);
  assert.doesNotMatch(m, /費城半導體|那斯達克|台積電 ADR/, "核心卡已經有的不重複");
  await selectWorkspace(p, "technical");
  assert.equal(await p.evaluate(() => (document.querySelector('#lx details[data-tdbox="plan"] .td-plan-pre').innerText.match(/昨晚美股/g) || []).length), 0, "盤前推演不再列昨晚美股");
  await selectWorkspace(p, "global");
  await p.click('#lx [data-tdgo="mkt:gl"]'); await p.waitForFunction(() => W.lt === "mkt" && W.mkReg === "gl");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("盤中監控有進行中的警示：狀態列顯示「■ 警示 N 件」，點了到盤中監控 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-26T10:00:00+08:00"));
  await p.evaluate(() => { const d = W.today || twDay(); W.monE = { d, E: { [d + ":SYM:2330:up"]: { id: d + ":SYM:2330:up", type: "SYM", code: "2330", dir: "up", level: 3, sev: "alert", title: "台積電 漲停", msg: "x", first: Date.now(), last: Date.now(), state: "open", snaps: [], notified: [] } } }; W.tdPh = null; setLt("today"); renderList(); });
  await p.waitForSelector("#lx .dh-status-bar [data-l2mon]");
  assert.match(await p.textContent("#lx .dh-status-bar [data-l2mon]"), /■ 警示 1 件/); assert.match(await p.textContent('#lx details[data-tdbox="plan"] summary'), /■ 警示 1 件/);
  await p.click("#lx .dh-status-bar [data-l2mon]"); await p.waitForFunction(() => W.lt === "mon");
  await p.evaluate(() => clearTimeout(W.monTimer));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("手機第一屏：狀態列、位置燈號與加權、分時圖、核心數字都在一個螢幕內；沒資料的數字不留空格 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-26T10:00:00+08:00"));
  await p.evaluate(() => { setLt("today"); scrollTo(0, 0); $("#lx").scrollTop = 0; });
  await p.waitForSelector("#lx .dh-core-grid", { timeout: 15000 }); await p.waitForSelector("#lx .td-ix", { timeout: 15000 }); // 分時用大盤頁同一份走勢線（測試假資料 3 點）
  const r = await p.evaluate(() => { const top = s => document.querySelector(s)?.getBoundingClientRect().top; return { H: innerHeight, bar: top("#lx .dh-status-bar"), hero: top("#lx .td-main"), chart: top("#lx .td-ix"), grid: top("#lx .dh-core-grid"), miss: document.querySelectorAll("#lx .dh-core-card.missing").length, t00: document.querySelectorAll('#lx .td-side [data-dhcode="T00"]').length }; });
  assert.ok(r.bar < r.H && r.hero < r.H && r.chart < r.H && r.grid < r.H, `第一屏：${JSON.stringify(r)}`);
  assert.equal(r.miss, 0, "今日市場的數字列不放「資料暫缺」");
  // 位置只寫事實（分水嶺上方／下方…），不寫偏多偏空；「怎麼看」說明算法、回測與「不是預測」
  const hero = await p.evaluate(() => $("#lx .td-main").innerText);
  const chartInfo = await p.evaluate(() => ({
    title: document.querySelector("#lx .td-chart-head")?.innerText || "",
    meta: document.querySelector("#lx .td-chart-meta")?.innerText || "",
    yTicks: document.querySelectorAll("#lx .td-ix-y span").length,
    grid: document.querySelectorAll("#lx .td-ix-grid line").length,
    stats: document.querySelectorAll("#lx .td-ix-stats .td-ix-stat").length,
    note: document.querySelector("#lx .td-ix-note")?.innerText || "",
    legend: document.querySelector("#lx .td-ix-legend")?.innerText || ""
  }));
  assert.match(chartInfo.title, /加權分時/);
  assert.match(chartInfo.meta, /資料日期[\s\S]*2026-10-05[\s\S]*來源時間[\s\S]*10:30:05[\s\S]*狀態/);
  // 報價沒帶來源時寫「來源未提供」，不擅自標成證交所 MIS（可能是 Yahoo 備援）
  const noSrc = await p.evaluate(() => { const q = W.quotes.get("T00"); if (q) W.quotes.set("T00", { ...q, source: "" }); renderList(); return document.querySelector("#lx .td-chart-meta")?.innerText || ""; });
  assert.match(noSrc, /來源未提供/); assert.doesNotMatch(noSrc, /來源 證交所 MIS/);
  assert.equal(chartInfo.yTicks, 5, "縱軸有五個價格刻度");
  assert.equal(chartInfo.grid, 5, "走勢圖有對應的水平網格");
  assert.equal(chartInfo.stats, 4, "開盤、最高、最低、昨收四項數據");
  assert.match(chartInfo.note, /橫軸[\s\S]*縱軸[\s\S]*點數/);
  assert.match(chartInfo.legend, /分時路徑[\s\S]*昨收基準[\s\S]*壓力/);
  assert.doesNotMatch(hero, /偏多|偏空|偏弱|強勢|弱勢|看多|看空/); assert.match(hero, /現在位置\s*(壓力上方|分水嶺上方|分水嶺下方|支撐下方)\s*離分水嶺/);
  await p.click("#lx .td-help > summary"); const help = await p.evaluate(() => $("#lx .td-help").innerText);
  assert.match(help, /分水嶺[\s\S]*夜盤[\s\S]*近 14 日平均波動[\s\S]*不是預測漲跌[\s\S]*不是買賣建議/); assert.equal(r.t00, 0, "加權在最上面，數字列不重複");
  // 三個按鈕是圖示，文字給讀螢幕的人；按鈕至少 44px
  // 字型載入完才量；失敗時把實際尺寸與樣式寫進訊息（CI 日誌只看得到斷言訊息）
  await p.evaluate(() => document.fonts.ready);
  const btns = await p.evaluate(() => [...document.querySelectorAll("#lx .dh-status-bar [data-tx]")].map(b => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return { t: b.textContent.trim(), h: r.height, w: r.width, css: `${cs.display} ${cs.height}/${cs.minHeight} ${cs.boxSizing}`, vis: !!b.offsetParent }; }));
  assert.deepEqual(btns.map(b => [b.t, b.h >= 44]), [["↻重新整理", true], ["AI 整理", true], ["複製文字", true]], `按鈕尺寸：${JSON.stringify(btns)}`);
  // 早報的文字結論收在「盤前推演」裡面，外層不再是一大段字
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("#lx .dh-brief-summary")].filter(e => !e.closest("details[data-tdbox]")).length), 0);
  // 保留盤中監控圖、7 個交易日行事曆與盤前／盤後驗證圖；目前階段圖在區塊摘要，其他階段圖在展開內容內
  const V = await p.evaluate(() => ({ heat: document.querySelectorAll('#lx details[data-tdbox="plan"] > summary .td-heat span').length, tl: !!document.querySelector('#lx details[data-tdbox="plan"] > summary .td-tl'),
    cal: document.querySelectorAll('#lx details[data-tdbox="mine"] > summary .td-cal > span').length, post: !!document.querySelector('#lx details[data-tdbox="plan"] .td-plan-post .td-tl'), pre: !!document.querySelector('#lx details[data-tdbox="plan"] .td-plan-pre .td-sc') }));
  assert.ok(V.heat > 0 && V.tl && V.post && V.pre, JSON.stringify(V)); assert.equal(V.cal, 7, "7 個交易日");
  await p.waitForFunction(() => !!document.querySelector('#lx details[data-tdbox="plan"] .dh-sec-b'));
  assert.match(await p.evaluate(() => $('#lx details[data-tdbox="plan"] .td-plan-pre').innerText), /上漲|下跌|資料不足/);
  const marketSummary = await p.textContent("#lx .td-market-summary");
  assert.match(marketSummary, /今日市場摘要/); assert.match(marketSummary, /加權/);
  assert.match(marketSummary, /市場結構/);
  assert.doesNotMatch(marketSummary, /漲\s*\d+\s*／\s*跌\s*\d+\s*家/, "摘要不重複列出法人情緒卡中的漲跌家數");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("市場廣度：完整顯示上漲／平盤／下跌樣本、比例與資料日期 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-05T10:30:00+08:00"));
  await p.evaluate(() => {
    const d = twDay();
    W.quotes.set("T00", { code: "T00", name: "加權指數", price: 100, prev: 99, open: 99, high: 101, low: 98, chg: 1, chgPct: 1.01, vol: 1000, date: d, time: "10:30:05", source: "證交所 MIS" });
    const M = { T: 1, dates: [d], secs: [], stocks: new Map() };
    W.mf.model = M; // mfModel 是 watch.html 的 const，改 window.mfModel 不會生效；直接放進它回傳的 W.mf.model
    window.flowAt = () => [];
    window.flowMood = () => ({ up: 6, dn: 3, flat: 2, total: 11, lu: 1, ld: 0, avg: 0.65, score: 65, label: "偏樂觀" });
    W.ixSp = { ...(W.ixSp || {}), T00: { pts: [["09:00", 99], ["10:00", 100], ["10:30", 100.5]], prev: 99, win: [540, 810] } };
    W.tdPh = null; setLt("today"); renderList();
  });
  await p.waitForSelector("#lx .td-breadth");
  const r = await p.evaluate(() => {
    const el = document.querySelector("#lx .td-breadth");
    return {
      text: el?.innerText || "",
      label: el?.getAttribute("aria-label") || "",
      segments: [...(el?.querySelectorAll(".td-bb i") || [])].map(x => x.className),
      widths: [...(el?.querySelectorAll(".td-bb i") || [])].map(x => x.style.width)
    };
  });
  assert.match(r.text, /資料日期：2026-10-05/);
  assert.match(r.text, /有效個股 11 檔/);
  assert.match(r.text, /漲 6・54\.5%/); assert.match(r.text, /平 2・18\.2%/); assert.match(r.text, /跌 3・27\.3%/);
  assert.match(r.text, /漲停 1・跌停 0/); assert.match(r.text, /個股平均漲跌 \+0\.65%/);
  assert.match(r.label, /上漲 6 家、平盤 2 家、下跌 3 家，共 11 家/);
  assert.deepEqual(r.segments, ["up", "flat", "down"]);
  assert.deepEqual(r.widths, ["54.5%", "18.2%", "27.3%"]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("網址：#daily（原本的）和 #today（別名）都打開今日市場；自訂過的分頁順序不變 390", async () => {
  for (const h of ["daily", "today"]) {
    const { ctx, p, errs } = await open(B, S.url, `index.html#${h}`, { width: 390, touch: true });
    const f = await watchFrame(p);
    assert.equal(await p.evaluate(() => CUR_TAB), "intel", h);
    await f.waitForFunction(() => W.lt === "today"); assert.match(await f.textContent("#lx"), /今日市場/);
    await ctx.close(); assert.deepEqual(errs, []);
  }
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { store.set("watch:tabcfg", { order: ["money", "today", "earn"], hide: ["pod"] }); modeUi(); });
  const L = await p.evaluate(() => [...document.querySelectorAll("#lTabs [data-l]")].map(b => [b.dataset.l, b.textContent.trim()]));
  const at = l => L.findIndex(x => x[0] === l);
  assert.ok(at("money") < at("today") && at("today") < at("earn"), JSON.stringify(L)); assert.equal(L[at("today")][1], "今日市場");
  assert.deepEqual(await p.evaluate(() => store.get("watch:tabcfg")), { order: ["money", "today", "earn"], hide: ["pod"] }, "沒有改寫使用者的分頁設定");
  await ctx.close(); assert.deepEqual(errs, []);
});


test("手機首頁觸控尺寸與響應式排版回歸 (320px, 375px, 390px, 430px) 無溢位且按鈕 >= 44px", async () => {
  for (const width of [320, 375, 390, 430]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: true });
    await p.clock.setFixedTime(new Date("2026-10-26T10:00:00+08:00"));
    await p.evaluate(() => { setLt("today"); scrollTo(0, 0); $("#lx").scrollTop = 0; });
    await p.waitForSelector("#lx .dh-core-grid", { timeout: 15000 });
    await p.waitForSelector("#lx .td-ix", { timeout: 15000 });

    const layout = await p.evaluate(() => {
      const bar = document.querySelector("#lx .dh-status-bar");
      const left = document.querySelector("#lx .dh-sb-left");
      const titleBtns = document.querySelector("#lx .dh-title-btns");
      const btns = Array.from(document.querySelectorAll("#lx .dh-status-bar [data-tx]"));

      const barRect = bar ? bar.getBoundingClientRect() : null;
      const leftRect = left ? left.getBoundingClientRect() : null;
      const titleBtnsRect = titleBtns ? titleBtns.getBoundingClientRect() : null;

      const overlaps = leftRect && titleBtnsRect ? !(leftRect.right <= titleBtnsRect.left || leftRect.left >= titleBtnsRect.right || leftRect.bottom <= titleBtnsRect.top || leftRect.top >= titleBtnsRect.bottom) : false;
      const barOverflows = barRect ? barRect.right > window.innerWidth : false;

      return {
        barOverflows,
        overlaps,
        btns: btns.map(b => {
          const r = b.getBoundingClientRect();
          return [b.textContent.trim(), r.height >= 44, r.width >= 44];
        })
      };
    });

    assert.equal(layout.barOverflows, false, `視口 ${width}px 狀態列不溢出視窗`);
    assert.equal(layout.overlaps, false, `視口 ${width}px 狀態列左側與按鈕群不重疊`);
    assert.deepEqual(layout.btns, [["↻重新整理", true, true], ["AI 整理", true, true], ["複製文字", true, true]], `視口 ${width}px 按鈕觸控尺寸`);
    const jumps = await p.evaluate(() => [...document.querySelectorAll("#lx .mc-nav [data-mc-tab]")].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.mcTab, r.height >= 44, r.width >= 44]; }));
    assert.deepEqual(jumps, [["overview", true, true], ["capital", true, true], ["global", true, true], ["research", true, true], ["technical", true, true]], `視口 ${width}px 工作區導覽觸控尺寸`);
    await p.click('#lx [data-mc-tab="overview"]');
    await p.click('#lx details[data-tdbox="mine"] > summary');
    await p.waitForFunction(() => document.querySelector('#lx details[data-tdbox="mine"]')?.open && !!document.querySelector('#lx details[data-tdbox="mine"] .dh-sec-b'));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `視口 ${width}px 快速導覽沒有造成橫向溢出`);
    await ctx.close();
    assert.deepEqual(errs, []);
  }
});
