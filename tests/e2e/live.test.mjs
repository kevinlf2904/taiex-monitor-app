// 即時更新與版面：報價請求卡住時輪詢要能自己恢復；嵌在 K線學堂裡往下捲之後打開個股，抽屜要出現在看得到的地方而且能捲
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, mock, watchFrame } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
// 自己開 context 的測試也擋掉離線快取（sw.js）：service worker 轉送的請求不會經過下面的假資料（route）
test.after(async () => { await B.close(); S.close(); });

// 等嵌入的看盤頁程式跑完（CI 比較慢，固定等 2.5 秒有時還沒好）
test("報價請求卡住後會恢復更新", async () => {
  const ctx = await B.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" }); await mock(ctx);
  let n = 0, hung = false;
  await ctx.route("**/api/quote**", r => { if (++n === 3 && !hung) { hung = true; return; } // 第 3 個請求永遠不回應
    const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(Boolean);
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", session: "open", today: "2026-10-15", quotes: codes.map(c => ({ code: c, name: c, price: 100 + n, prev: 100, chg: n, chgPct: n / 100 })) }) }); });
  const p = await ctx.newPage(); await p.clock.install({ time: new Date("2026-10-15T02:00:00Z") }); // 台北 10:00 盤中
  await p.addInitScript(() => { window.W_TMO = 1500; });
  await p.goto(`${S.url}/learner/watch.html`);
  await p.waitForFunction(() => W.quotes.get("T00")?.price, null, { timeout: 15000 });
  await p.waitForTimeout(3000); assert.ok(hung); // 卡住的請求逾時後，每秒更新要繼續
  const after = n; await p.waitForTimeout(2200); assert.ok(n > after, `卡住之後沒有再更新（${after} → ${n}）`);
  await ctx.close();
});

test("嵌入模式往下捲後打開個股：抽屜在可見範圍、可以捲動", async () => {
  const ctx = await B.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" }); await mock(ctx); const p = await ctx.newPage();
  await p.goto(`${S.url}/learner/index.html`); await p.waitForTimeout(1500); await p.evaluate(() => goTab("watch"));
  const fr = await watchFrame(p); await fr.evaluate(() => setLt("cong")); await p.waitForTimeout(1200);
  await p.evaluate(() => { const f = document.querySelector("#watchFrame"); f.style.height = "5000px"; scrollTo(0, 1500); }); await p.waitForTimeout(300);
  await fr.evaluate(() => { select("2330"); setDtab("tech"); }); await p.waitForTimeout(2000);
  const st = await fr.evaluate(() => { const d = $("#detail"), r = d.getBoundingClientRect(); return { top: r.top, h: r.height, sh: d.scrollHeight }; });
  const ft = await p.evaluate(() => document.querySelector("#watchFrame").getBoundingClientRect().top);
  assert.ok(Math.abs(st.top + ft) < 5, `抽屜不在可見範圍（抽屜 ${st.top}、iframe ${ft}）`); assert.ok(st.h <= 900 && st.sh > st.h);
  const y0 = await fr.evaluate(() => $("#detail").scrollTop); await p.mouse.move(1200, 500); for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 200); await p.waitForTimeout(100); }
  assert.ok(await fr.evaluate(() => $("#detail").scrollTop) > y0);
  await ctx.close();
});

test("嵌入模式選單凍結：往下捲後分頁列固定在學堂標題列下方、可以點", async () => {
  const ctx = await B.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: "block" }); await mock(ctx); const p = await ctx.newPage();
  await p.goto(`${S.url}/learner/index.html`); await p.waitForTimeout(1500); await p.evaluate(() => goTab("watch"));
  const fr = await watchFrame(p); await fr.evaluate(() => setLt("cong")); await p.waitForTimeout(1500);
  assert.ok(await p.evaluate(() => $("#watchTabs").classList.contains("off")), "還沒捲動時不該出現");
  await p.evaluate(() => scrollTo(0, 1500)); await p.waitForTimeout(400);
  const st = await p.evaluate(() => { const n = $("#watchTabs"), r = n.getBoundingClientRect(); return { off: n.classList.contains("off"), top: r.top, hb: document.querySelector(".top").getBoundingClientRect().bottom, n: n.querySelectorAll("button").length }; });
  // 大戶國會在情報局：固定的分頁列只有情報局的分頁（搜尋＋今日市場＋盤中監控＋5 個）
  assert.ok(!st.off && Math.abs(st.top - st.hb) < 2 && st.n === 8, JSON.stringify(st));
  assert.equal(await p.evaluate(() => $("#tab-btn-intel").getAttribute("aria-selected")), "true");
  await p.click('#watchTabs [data-wl="ind"]'); await p.waitForTimeout(800); assert.equal(await fr.evaluate(() => W.lt), "ind");
  assert.equal(await p.evaluate(() => $('#watchTabs [aria-pressed="true"]')?.dataset.wl), "ind");
  await ctx.close();
});
