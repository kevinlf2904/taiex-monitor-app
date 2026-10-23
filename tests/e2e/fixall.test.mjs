// 全站稽核修正：漲跌停依升降單位、休市日標示、自選拿不到報價時說原因、K 線與報價對不上不硬接、指標一鍵組合與「更多」、外層浮動返回只在學堂存股出現
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, watchFrame } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`個股頁：漲跌停取到升降單位、休市標示、K 線與報價對不上時不硬接 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => { setLt("watch"); select("2330"); }); await p.waitForTimeout(1200);
  // 昨收 2420：漲停 2420×1.1＝2662，2420 這個價位一檔 5 元 → 2660；跌停 2178 → 2180
  await p.evaluate(() => { W.detailQ = { ...W.quotes.get("2330"), code: "2330", prev: 2420, price: 2660, chg: 240, chgPct: 9.92, date: "2026-10-22", time: "13:30:00" }; W.today = "2026-10-24"; renderDetailHead(); });
  const kv = await p.textContent("#dKv");
  assert.match(kv, /漲停\s*2660/); assert.match(kv, /跌停\s*2180/); assert.match(kv, /成交量（整股）/);
  assert.match(await p.textContent("#dTags"), /漲停/, "收在 2660 要標漲停");
  assert.match(await p.textContent("#dTime"), /2026\/10\/22[\s\S]*休市/, "10/24 是週六：日期旁標休市");
  // 報價昨收和 K 線最後一根差太多（例如減資）：不把今天接上去、標示待確認
  await p.evaluate(() => { const D = W.daily.data, n = D.length; mergeDaily({ code: "2330", price: 50, prev: 49, open: 49, high: 51, low: 48, vol: 1000, date: "2099-01-02" }); W.kn = n; });
  assert.equal(await p.evaluate(() => W.daily.data.length === W.kn && W.daily.data.at(-1).d !== "2099-01-02"), true, "沒有硬接一根 −90% 的 K 棒");
  await p.evaluate(() => { W.detailQ = { ...W.detailQ, prev: 49, price: 50 }; renderDetailHead(); });
  assert.match(await p.textContent("#dTags"), /K 線與報價待確認/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("大盤與頁首：今天沒有交易資料時說明休市、顯示最近交易日 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  // 颱風假這類臨時休市：證交所行事曆沒有，但報價日期停在前一個交易日
  await ctx.route("**/api/quote**", r => { const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(Boolean);
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", session: "closed", today: "2026-10-23", quotes: codes.map(c => ({ code: c, name: c, price: 100, prev: 101, chg: -1, chgPct: -0.99, date: "2026-10-22", time: "13:30:00", market: "上市" })) }) }); });
  await p.evaluate(() => { W.cal = { hol: [] }; showList(); setLt("mkt"); });
  await p.waitForSelector(".mkclosed", { timeout: 15000 });
  assert.match(await p.textContent(".mkclosed"), /(今天沒有成交資料（休市或暫停交易|尚未開盤)[\s\S]*10\/22 收盤/, "09:00 前是尚未開盤，之後是今天沒有交易");
  await p.evaluate(() => renderTop()); assert.match(await p.textContent("#statText"), /今日無交易|尚未開盤/, "頁首狀態不寫「收盤」，寫今天沒有交易");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("自選清單：報價全部拿不到時說原因、可以重試 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  const bad = r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: "證交所暫時連不到" }) });
  await ctx.route("**/api/quote**", bad);
  await p.evaluate(() => { W.quotes.clear(); W.busy = 0; setLt("watch"); tick(); });
  await p.waitForSelector("#wl .wl-err", { timeout: 15000 });
  assert.match(await p.textContent("#wl .wl-err"), /報價暫時拿不到（[^）]*證交所暫時連不到[^）]*）[\s\S]*重試/);
  await ctx.unroute("**/api/quote**", bad);
  await p.click("#wl [data-wlretry]"); await p.waitForFunction(() => !document.querySelector("#wl .wl-err"), null, { timeout: 15000 });
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`技術指標：一鍵組合、其餘收在「更多」 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => { store.set("ind:watch2", ["ma5", "ma20", "ma60", "vol", "kd"]); store.set("ind:watch2:more", false); setLt("watch"); select("2330"); });
  await p.waitForTimeout(800); await p.click('#dTabs [data-t="tech"]'); await p.evaluate(() => { $("#klInd").open = true; });
  const chips = () => p.$$eval("#dIbar .ichip[data-id]", L => L.map(b => b.textContent.trim()));
  const n0 = (await chips()).length; assert.ok(n0 <= 13, `先列常用的：${n0} 個`);
  await p.click('#dIbar [data-pre="1"]'); // 看趨勢
  assert.deepEqual(await p.evaluate(() => [...dIndBar.state].sort()), ["boll", "ma20", "ma60", "macd", "vol"]);
  assert.match(await p.textContent("#klIndSum"), /MACD/, "摘要跟著更新");
  assert.ok((await chips()).includes("MACD"), "開著的指標就算在「更多」裡也照樣列出");
  await p.click("#dIbar [data-more]"); assert.ok((await chips()).length >= 30, "展開更多");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("外層浮動返回：看盤、情報局不疊，學堂裡照常 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 390, touch: true });
  await p.evaluate(() => goTab("learn")); await p.evaluate(() => goTab("quiz")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => !!$("#navBackFab") && !$("#navBackFab").hidden), true, "學堂裡往下一頁，有返回");
  await p.evaluate(() => goTab("watch")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => !$("#navBackFab") || $("#navBackFab").hidden), true, "看盤裡面自己有返回，外層不疊");
  // 往下捲時浮動按鈕淡出，停下 0.7 秒就回來（「回到最上面」才按得到）
  await p.evaluate(() => goTab("learn")); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(100);
  await p.mouse.wheel(0, 1500); await p.waitForTimeout(120);
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains("fab-quiet")), true, "往下捲時淡出");
  await p.waitForTimeout(900);
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains("fab-quiet")), false, "停下來就回來");
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`今日重點（早報＋每日摘要）在情報局；今日重點卡「看完整」直接過去 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  assert.equal(await p.evaluate(() => TOOLS_VIEWS.some(x => ["today", "brief", "sum"].includes(x[0]))), false, "工具裡不再有早報、每日摘要");
  assert.equal(await p.evaluate(() => INTEL_LT[0]), "today", "情報局第一個分頁");
  await p.evaluate(() => { W.td = { at: Date.now() }; W.hold = { 1234: { sh: 1000, cost: 50 } }; W.quotes.set("1234", { ...(W.quotes.get("1234") || {}), chgPct: -4.2 }); setLt("watch"); renderList(); });
  await p.click('#todayCard [data-tdgo="brief"]'); await p.waitForTimeout(800);
  assert.equal(await p.evaluate(() => W.lt), "today");
  const t = await p.textContent("#lx");
  assert.match(t, /今日重點[\s\S]*重新整理[\s\S]*AI 整理[\s\S]*複製文字/);
  assert.match(t, /盤前・昨晚美股與今天的行事曆/); assert.match(t, /(盤中|盤後)・大盤、自選與訊號[\s\S]*自選漲幅前 5[\s\S]*技術訊號/);
  for (const k of ["tdre", "tdai", "tdtxt"]) assert.equal(await p.$$eval(`#lx [data-tx="${k}"]`, L => L.length), 1, `${k} 只有一個`);
  assert.match(await p.evaluate(() => todayText()), /今日重點[\s\S]*【盤勢與自選】[\s\S]*不是買賣建議/, "複製的文字包含早報和盤勢兩部分");
  await p.click('#lx [data-tx="tdai"]'); await p.waitForFunction(() => /測試回覆/.test($("#lx .caibox")?.innerText || ""));
  // 舊的分頁記錄（工具 → 早報、每日摘要、今日重點）都帶到情報局的今日重點
  for (const old of ["brief", "sum", "today"]) { await p.evaluate(o => { setLt("watch"); W.tv = o; setLt("tools"); }, old); await p.waitForTimeout(200); assert.equal(await p.evaluate(() => W.lt), "today", old); }
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("首頁：情報局的第一個分頁是今日重點，網址 #daily 直接打開；看盤的今日重點卡切到情報局 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html#daily", { width: 390, touch: true });
  const f = await watchFrame(p);
  assert.equal(await p.evaluate(() => CUR_TAB), "intel");
  await f.waitForFunction(() => W.lt === "today"); assert.match(await f.textContent("#lx"), /盤前・昨晚美股/);
  assert.equal(await f.evaluate(() => [...document.querySelectorAll("#lTabs [data-l]")].map(b => b.dataset.l).filter(inMode)[0]), "today", "情報局分頁列第一個");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("流量分析：只在正式網站載入，本機、預覽都不載；常見問題寫清楚只統計匿名瀏覽次數", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 1280 });
  const reqs = []; p.on("request", r => /_vercel\/insights/.test(r.url()) && reqs.push(r.url()));
  await p.reload(); await p.waitForTimeout(800);
  assert.deepEqual(reqs, [], "localhost 不載入"); assert.equal(await p.evaluate(() => typeof window.va), "undefined");
  const src = await (await import("node:fs/promises")).readFile(new URL("../../learner/va.js", import.meta.url), "utf8");
  assert.match(src, /location\.hostname !== "kline-school\.vercel\.app"/); assert.match(src, /window\.top !== window/, "嵌在首頁的看盤頁不重複計算");
  await p.goto(`${S.url}/learner/pro.html`); assert.match(await p.textContent("body"), /Vercel Web Analytics 統計匿名的瀏覽次數[\s\S]*不用 Cookie、不記錄你是誰/);
  await ctx.close(); assert.deepEqual(errs, []);
});
