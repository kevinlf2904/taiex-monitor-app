// 稽核收尾：離線提示只在真的斷網時出現、新手 30 秒上手指引條、只有圖示的按鈕都有 aria-label 與 title
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("離線提示：連線正常時收到 offline 事件也不顯示；真的斷網 3 秒才顯示，連回來立刻收起", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => dispatchEvent(new Event("offline"))); await p.waitForTimeout(3500);
  assert.equal(await p.$("#netBar"), null, "navigator.onLine 是 true 就不顯示");
  await ctx.setOffline(true); await p.waitForTimeout(1000); assert.equal(await p.$("#netBar"), null, "剛斷線不馬上跳");
  await p.waitForSelector("#netBar", { timeout: 4000 }); assert.match(await p.textContent("#netBar"), /離線中/);
  await ctx.setOffline(false); await p.waitForFunction(() => !document.getElementById("netBar"), null, { timeout: 1000 });
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`新手指引條：載入熱門自選範例、打開只看我的自選 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500, onboard: true });
  await p.waitForSelector("#onbBar:not([hidden]) .onb");
  assert.match(await p.textContent("#onbBar"), /初次使用[\s\S]*個股抽屜[\s\S]*一鍵載入台美股熱門自選範例[\s\S]*只看我的自選/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await p.click('[data-onb="demo"]');
  assert.deepEqual(await p.evaluate(() => [W.groups[0].list.includes("2330"), W.groups[1].list.includes("NVDA"), W.mine, W.lt, store.get("watch:onbOff")]), [true, true, true, "earn", true]);
  assert.equal(await p.isHidden("#onbBar"), true, "載入後收起");
  await p.reload(); await p.waitForTimeout(600); assert.equal(await p.isHidden("#onbBar"), true, "重新整理不再出現（自選已經存過）");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("新手指引條：按 ✕ 關掉就不再出現", async () => {
  const { ctx, p } = await open(B, S.url, "watch.html", { width: 390, touch: true, onboard: true });
  await p.waitForSelector("#onbBar:not([hidden])"); await p.click('[data-onb="x"]');
  assert.equal(await p.isHidden("#onbBar"), true); assert.equal(await p.evaluate(() => store.get("watch:groups", null)), null, "關掉不會動到自選");
  await p.reload(); await p.waitForTimeout(600); assert.equal(await p.isHidden("#onbBar"), true);
  await ctx.close();
});

// 只有圖示或符號的按鈕（✕、＋、−、↑、☆、SVG）：要有繁體中文 aria-label，也要有 title
const iconBtns = () => [...document.querySelectorAll("button")].filter(b => !b.hidden && !/[\p{Script=Han}A-Za-z0-9]/u.test(b.textContent || "") && b.getClientRects().length)
  .filter(b => !b.getAttribute("aria-label") || !b.title).map(b => `${b.id}.${b.className}「${b.textContent.trim()}」`);
for (const width of [390, 1280]) test(`只有圖示的按鈕都有 aria-label 與 title ${width}`, async () => {
  const { ctx, p } = await open(B, S.url, "index.html", { width, touch: width < 500 });
  await p.evaluate(() => scrollTo(0, 2000)); await p.waitForTimeout(800);
  assert.deepEqual(await p.evaluate(iconBtns), [], "首頁（標題列、回到最上面、問題回報）");
  const w = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  for (const lt of ["watch", "money", "earn", "ind", "cong"]) { await w.p.evaluate(lt => setLt(lt), lt); await w.p.waitForTimeout(400); assert.deepEqual(await w.p.evaluate(iconBtns), [], `看盤 ${lt}`); }
  await ctx.close(); await w.ctx.close();
});

test("移出自選可以復原（星號、清單上的移除鍵）", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { W.groups = [{ name: "自選", list: ["2330", "2317", "2454"] }]; W.gi = 0; saveGroups(); setLt("watch"); renderList(); });
  await p.evaluate(() => { document.body.insertAdjacentHTML("beforeend", wStar("2317")); document.body.lastElementChild.click(); }); // 隨處的 ☆／★（排行、題材、抽屜…）都是 wStar
  assert.deepEqual(await p.evaluate(() => W.groups[0].list), ["2330", "2454"]);
  await p.waitForSelector("#toast:not([hidden]) .toast-undo"); await p.click("#toast .toast-undo");
  assert.deepEqual(await p.evaluate(() => [W.groups[0].list, store.get("watch:groups")[0].list]), [["2330", "2317", "2454"], ["2330", "2317", "2454"]], "放回原位、也存起來");
  await p.evaluate(() => { W.editing = true; renderList(); }); await p.click('[data-rm="2454"]');
  assert.deepEqual(await p.evaluate(() => W.groups[0].list), ["2330", "2317"]);
  await p.click("#toast .toast-undo"); assert.deepEqual(await p.evaluate(() => W.groups[0].list), ["2330", "2317", "2454"]);
  await ctx.close(); assert.deepEqual(errs, []);
});
