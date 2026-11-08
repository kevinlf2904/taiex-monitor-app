// 最終驗收 DEF-02、DEF-04：桌面上投資組合（庫存 → 交易紀錄）用全寬版面，點持股打開右側抽屜；即時損益等清單型分頁維持雙欄；手機不受影響。
// 「‹ 返回」浮動按鈕出現時，捲到最下面內容不會被它蓋住。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 500000 },
  ...["2330", "2317", "2454", "2303", "2882", "0050"].map((s, i) => ({ id: "b" + i, v: 1, date: "2026-01-05", type: "buy", symbol: s, market: "tw", currency: "TWD", shares: 100, price: 100 + i * 10, fee: 0, tax: 0 }))];
const go = (p, hv, view = "home") => p.evaluate(([tx, hv, v]) => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: v }; W.holdView = hv; W.holdMkt = "tw"; setLt("hold"); }, [TX, hv, view]);

test("桌面 1280：投資組合全寬、點持股開右側抽屜；切到即時損益回到雙欄", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await go(p, "tx"); await p.waitForSelector(".hmcard .hmrow", { timeout: 30000 });
  const w = await p.evaluate(() => ({ wide: $("#main").classList.contains("wide"), lx: $("#lx").getBoundingClientRect().width }));
  assert.equal(w.wide, true, "交易紀錄（投資組合）用全寬"); assert.ok(w.lx > 1000, "內容寬度 " + w.lx);
  await p.click(".hmcard .hmrow"); await p.waitForFunction(() => $("#main").classList.contains("show-detail") && getComputedStyle($(".w-detail")).position === "fixed", null, { timeout: 10000 });
  await p.evaluate(() => { $("#main").classList.remove("show-detail"); W.holdView = "pnl"; renderList(); });
  assert.equal(await p.evaluate(() => $("#main").classList.contains("wide")), false, "即時損益維持雙欄（左清單、右個股）");
  await p.evaluate(() => { W.holdView = "tx"; renderList(); }); assert.equal(await p.evaluate(() => $("#main").classList.contains("wide")), true, "切回交易紀錄又是全寬");
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, 1280));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("手機 390：不用全寬（本來就是單欄）", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await go(p, "tx"); await p.waitForSelector(".hmcard", { timeout: 30000 });
  assert.equal(await p.evaluate(() => $("#main").classList.contains("wide")), false);
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const [width, touch] of [[390, true], [768, true], [1280, false]]) test(`「‹ 返回」按鈕不蓋住內容 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch });
  await go(p, "tx", "alloc"); await p.waitForSelector("#lx .alcard", { timeout: 30000 });
  await p.evaluate(() => { history.replaceState({ ...(history.state || {}), d: 1 }, ""); navBackUi(); });
  assert.equal(await p.evaluate(() => document.body.classList.contains("navback-on") && !$("#navBack").hidden), true);
  // 手機：空間只留在整頁最底部（頁尾後面），清單欄、主內容不另外留（不然內容和頁尾之間會多一大段空白）
  if (width < 900) assert.ok(await p.evaluate(() => parseFloat(getComputedStyle($(".w-list")).paddingBottom) < 40 && parseFloat(getComputedStyle($(".w-main")).paddingBottom) < 40), "清單欄、主內容沒有另外多留空間");
  // 捲動中途：往下捲按鈕先藏起來，往上捲再出現（整頁或桌面清單欄，看哪一層在捲）
  const sc = (f) => p.evaluate(f => { const l = $(".w-list"), own = l && l.scrollHeight > l.clientHeight + 4 && getComputedStyle(l).overflowY !== "visible"; const el = own ? l : document.scrollingElement; const max = el.scrollHeight - el.clientHeight; el.scrollTop = Math.round(max * f); return max; }, f);
  const max = await sc(0.2); await p.waitForTimeout(150);
  if (width === 390) assert.ok(max > 200, "前提：手機上頁面夠長，才測得到捲動中途"); if (max > 200) {
    await sc(0.5); await p.waitForFunction(() => $("#navBack").classList.contains("nb-away"), null, { timeout: 5000 });
    assert.equal(await p.evaluate(() => getComputedStyle($("#navBack")).pointerEvents), "none", "藏起來時不會擋住點擊");
    await sc(0.3); await p.waitForFunction(() => !$("#navBack").classList.contains("nb-away"), null, { timeout: 5000 });
  }
  // 捲到最下面（整頁和清單欄都捲到底），最後一段內容（含頁尾的版本號）要在按鈕上面
  await p.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); const l = $(".w-list"); if (l) l.scrollTop = l.scrollHeight; }); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => $("#navBack").classList.contains("nb-away")), false, "捲到底時按鈕出現");
  const r = await p.evaluate(() => { const b = $("#navBack").getBoundingClientRect(); let bottom = 0;
    for (const e of document.body.querySelectorAll("*")) { if (e.closest("#navBack, .qbar, #toast, #toTop, .sheet, [hidden]") || getComputedStyle(e).position === "fixed") continue; if (!e.offsetParent || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue; const q = e.getBoundingClientRect(); if (q.right > b.left && q.left < b.right && q.bottom > bottom && q.top < innerHeight) bottom = q.bottom; }
    return { lastBottom: bottom, btnTop: b.top }; });
  assert.ok(r.lastBottom <= r.btnTop + 1, `最後一行（底 ${Math.round(r.lastBottom)}）在按鈕（頂 ${Math.round(r.btnTop)}）上面`);
  await p.evaluate(() => { history.replaceState({ ...(history.state || {}), d: 0 }, ""); navBackUi(); });
  assert.equal(await p.evaluate(() => document.body.classList.contains("navback-on")), false, "按鈕收起來就不留空間");
  await ctx.close(); assert.deepEqual(errs, []);
});
