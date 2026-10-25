// 今日市場（P3）：分頁改名、#daily／#today 都能直達、三個時段面板一次一個（預設目前時段）、休市預設盤前、自訂分頁順序不受影響、手機第一屏看得到結論
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, watchFrame } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const phOf = p => p.evaluate(() => [...document.querySelectorAll("#lx [data-tdph]")].find(b => b.getAttribute("aria-pressed") === "true")?.dataset.tdph);
const nowOf = p => p.evaluate(() => document.querySelector("#lx [data-tdph] .dh-now")?.closest("[data-tdph]").dataset.tdph);

for (const [width, theme] of [[390, "dark"], [1280, "light"]]) test(`今日市場：四種時段的預設面板與內容 ${width} ${theme}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
  assert.match(await p.textContent('#lTabs [data-l="today"]'), /^今日市場$/);
  const CASES = [["2026-10-26T08:00:00+08:00", "pre", /盤前・昨晚美股與今天的行事曆/], ["2026-10-26T10:00:00+08:00", "live", /盤中・大盤、自選與訊號[\s\S]*自選漲幅前 5/],
    ["2026-10-26T15:00:00+08:00", "post", /資金雷達・板塊輪動與資金流向[\s\S]*盤後・大盤、自選與訊號[\s\S]*下一交易日行動清單/], ["2026-10-25T10:00:00+08:00", "pre", /今天休市，下面是下一交易日 10\/26/]];
  for (const [at, want, re] of CASES) {
    await p.clock.setFixedTime(new Date(at));
    await p.evaluate(() => { W.tdPh = null; setLt("today"); renderList(); });
    await p.waitForFunction(() => !!document.querySelector("#lx [data-tdph]"), null, { timeout: 15000 });
    assert.equal(await phOf(p), want, at); assert.equal(await nowOf(p), want, `「現在」標在目前時段 ${at}`);
    const t = await p.evaluate(() => $("#lx").innerText);
    assert.match(t, re, at); assert.match(t, /今日市場[\s\S]*重新整理/);
    assert.equal(await p.$$eval("#lx .dh-panel", L => L.length), 1, "一次只畫一個面板");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `沒有橫向溢出 ${at}`);
  }
  // 切到別的時段：每秒重畫也不會跳回去（同一天記在記憶體）
  await p.click('#lx [data-tdph="post"]'); await p.evaluate(() => { W.ticking = true; renderList(); W.ticking = false; renderList(); });
  assert.equal(await phOf(p), "post");
  assert.equal(await p.evaluate(() => Object.keys(localStorage).some(k => /tdPh|tdph/i.test(k))), false, "時段選擇不存進瀏覽器");
  // 細節收起來
  assert.equal(await p.evaluate(() => $("#lx .dh-more").open), false);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("手機第一屏：狀態、核心卡、今日結論都在一個螢幕內；缺資料的核心卡縮小 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-26T10:00:00+08:00"));
  await p.evaluate(() => { setLt("today"); scrollTo(0, 0); $("#lx").scrollTop = 0; });
  await p.waitForSelector("#lx .dh-core-grid", { timeout: 15000 });
  const r = await p.evaluate(() => { const top = s => document.querySelector(s)?.getBoundingClientRect().top; return { H: innerHeight, bar: top("#lx .dh-status-bar"), grid: top("#lx .dh-core-grid"), sum: top("#lx .dh-brief-summary") ?? top("#lx .dh-conclusion-box"), miss: [...document.querySelectorAll("#lx .dh-core-card.missing")].map(e => e.getBoundingClientRect().height), full: [...document.querySelectorAll("#lx .dh-core-card:not(.missing)")].map(e => e.getBoundingClientRect().height) }; });
  assert.ok(r.bar < r.H && r.grid < r.H && r.sum < r.H, `第一屏：${JSON.stringify(r)}`);
  if (r.miss.length && r.full.length) assert.ok(Math.max(...r.miss) < Math.min(...r.full), "缺資料的卡比較矮");
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
