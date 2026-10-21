// 頂部導覽：情報局／看盤／K線學堂／存股；情報局與看盤共用看盤 iframe（mode 切換）；社群貼文用的網址路由
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const frame = async p => { for (let i = 0; i < 50; i++) { const f = p.frames().find(f => /watch\.html/.test(f.url())); if (f) { try { if (await f.evaluate(() => typeof W !== "undefined" && typeof applyRoute === "function")) return f; } catch {} } await p.waitForTimeout(200); } throw new Error("沒有看盤 iframe"); };

test("頂部只剩情報局、看盤、K線學堂、存股；學堂的課程與練習在次導覽", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch: width < 500 });
    assert.equal((await p.evaluate(() => $(".tabs").innerText)).replace(/\s+/g, " ").trim(), "情報局 看盤 K線學堂 存股");
    await p.click("#tab-btn-school"); assert.ok(await p.evaluate(() => !$("#schoolNav").hidden));
    assert.match(await p.evaluate(() => $("#schoolNav").innerText), /課程[\s\S]*AI 截圖診斷[\s\S]*圖表實驗室[\s\S]*判讀挑戰[\s\S]*觀念測驗[\s\S]*畫線練習/);
    await p.click('#schoolNav [data-tab="quiz"]'); assert.ok(await p.evaluate(() => !$("#view-quiz").hidden && $("#tab-btn-school").getAttribute("aria-selected") === "true"));
    await p.click("#tab-btn-savings"); await p.click("#tab-btn-school"); assert.ok(await p.evaluate(() => !$("#view-quiz").hidden), "回到學堂時打開上次的子頁");
    assert.ok(await p.evaluate(() => $("#socialBtn").hidden), "社群帳號還沒開，按鈕先藏著");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "橫向溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("情報局：五大情報（含財報）獨立在情報局，看盤裡不重複；網址路由直接打開子頁", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html#radar/matrix", { width: 1280 });
  let f = await frame(p);
  assert.equal(await p.evaluate(() => $("#tab-btn-intel").getAttribute("aria-selected")), "true");
  await p.waitForTimeout(300);
  assert.deepEqual(await f.evaluate(() => [W.lt, W.mf.view]), ["money", "bubble"]);
  const vis = () => f.evaluate(() => [...document.querySelectorAll("#lTabs [data-l]")].filter(b => !b.hidden).map(b => b.dataset.l).join());
  assert.equal(await vis(), "money,earn,ind,pod,cong");
  // 切到看盤：同一個 iframe 換成看盤的分頁組，回到上次的看盤分頁
  await p.click("#tab-btn-watch"); await p.waitForTimeout(300);
  assert.doesNotMatch(await vis(), /money|earn|ind|pod|cong/); assert.ok(!["money", "earn", "ind", "pod", "cong"].includes(await f.evaluate(() => W.lt)));
  // 看盤裡的連結跳到情報分頁：外層自動切到情報局
  await f.evaluate(() => setLt("cong")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => $("#tab-btn-intel").getAttribute("aria-selected")), "true");
  // 其他路由
  for (const [r, want] of [["congress/13f", ["cong", "f13"]], ["congress/tw", ["cong", "tw"]], ["supply/diagrams", ["ind", "gallery"]], ["podcast", ["pod", "home"]]]) {
    await p.evaluate(r => { location.hash = r; switchTab(r); }, r); await p.waitForTimeout(400);
    assert.deepEqual(await f.evaluate(() => [W.lt, W.lt === "cong" ? W.cv : W.lt === "ind" ? W.indS.view : POD.view]), want, r);
  }
  await p.waitForTimeout(300); assert.equal(await p.evaluate(() => location.hash), "#podcast/latest");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("watch.html 單獨打開也吃路由；?debug=1 才顯示資料來源狀態", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html#congress/insider", { width: 390, touch: true });
  await p.waitForTimeout(500);
  assert.deepEqual(await p.evaluate(() => [W.lt, W.cv]), ["cong", "ins"]);
  assert.equal(await p.evaluate(() => routeOf()), "congress/insider");
  assert.ok(await p.evaluate(() => DEBUG), "本機開發環境算 debug");
  assert.equal(await p.evaluate(() => { document.documentElement.removeAttribute("data-debug"); return getComputedStyle(document.querySelector(".st-link")).display; }), "none");
  await ctx.close(); assert.deepEqual(errs, []);
});
