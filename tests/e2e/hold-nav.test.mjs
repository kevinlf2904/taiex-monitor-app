// 庫存分頁整併：兩層分頁併成一排主分頁（總覽、持股、績效、配置與風險、股利、論點、交易紀錄），「持股」「配置與風險」各有子分頁。
// 每個原有頁面都到得了、選取狀態正確、只有舊庫存時需要交易紀錄的頁面顯示建立說明、重新整理記得、手機不溢出、存檔不被改動。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, holdGo, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const OLD = { 2330: { sh: 1000, cost: 500, d: "2025-01-02" } };
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 }];
const MAIN = ["總覽", "持股", "績效", "配置與風險", "股利", "論點", "交易紀錄"];
const GROUP = { pnl: "stock", ana: "stock", alloc: "allocrisk", risk: "allocrisk", macro: "allocrisk", margin: "allocrisk" };
const PAGES = ["home", "pnl", "ana", "perf", "alloc", "risk", "macro", "margin", "div", "thesis", "tx"];
const NEED_LEDGER = ["home", "perf", "alloc", "div", "thesis", "tx"];
// 每一頁「內容是對的那一頁」的判斷：頁面自己的標記元素，或內部狀態（原本的畫面由這兩個狀態決定）
const MARK = { home: ".hmcard", perf: ".pfcard", alloc: ".alcard", tx: "[data-lg=add]", margin: "[data-lg=mgadd]", ana: "#wl .hhead.ana", thesis: "#lx .thev, #lx .thsum" };
const STATE = { pnl: ["pnl"], ana: ["ana"], risk: ["risk"], macro: ["macro"], home: ["tx", "home"], perf: ["tx", "perf"], alloc: ["tx", "alloc"], margin: ["tx", "margin"], div: ["tx", "div"], thesis: ["tx", "thesis"], tx: ["tx", "tx"] };
const state = p => p.evaluate(() => W.holdView === "tx" ? ["tx", W.lg?.view || "home"] : [W.holdView]);
const pressed = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel + ' button[aria-pressed="true"]')].map(b => b.innerText.trim()), sel);
const seed = (p, { ledger = true } = {}) => p.evaluate(([old, tx, ledger]) => { localStorage.setItem("kline:watch:hold", JSON.stringify(old)); if (ledger) localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: tx, at: "2026-11-01T00:00:00Z" })); else localStorage.removeItem("kline:pf:v1"); localStorage.setItem("kline:watch:hv", '"pnl"'); }, [OLD, TX, ledger]);
async function start(width, opt) { const o = await open(B, S.url, "watch.html", { width, touch: width < 500 }); await seed(o.p, opt); await o.p.reload(); await o.p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy))); await o.p.evaluate(() => { W.holdMkt = "tw"; setLt("hold"); }); await o.p.waitForSelector("#hvSeg"); return o; }

for (const width of [390, 1280]) {
  test(`${width}：只有一排主分頁；11 個頁面都到得了，選取狀態與內容正確；子分頁只在自己的群組出現`, async () => {
    const { ctx, p, errs } = await start(width);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#hvSeg button[data-nav]")].map(b => b.innerText.trim())), MAIN); // 手機上分頁列另有現成的「▾ 全部」展開鈕，不算主分頁
    for (const page of PAGES) {
      await holdGo(p, page);
      assert.deepEqual(await state(p), STATE[page], page + "：內部狀態");
      if (MARK[page]) await p.waitForSelector(MARK[page], { timeout: 30000 });
      assert.equal(await p.evaluate(() => document.querySelectorAll(".lgview").length), 0, page + "：沒有第二排主分頁");
      assert.equal((await pressed(p, "#hvSeg")).length, 1, page + "：主分頁只有一個選取");
      const sub = await p.evaluate(() => { const e = document.querySelector("#hsubSeg"); return e && !e.hidden ? [...e.querySelectorAll("button[data-nav]")].map(b => b.innerText.trim()) : null; });
      if (GROUP[page] === "stock") assert.deepEqual(sub, ["損益", "屬性分析"], page);
      else if (GROUP[page] === "allocrisk") assert.deepEqual(sub, ["配置", "風險", "總經敏感度", "融資"], page);
      else assert.equal(sub, null, page + "：沒有子分頁");
      if (sub) assert.equal((await pressed(p, "#hsubSeg")).length, 1, page + "：子分頁只有一個選取");
      const imp = await p.evaluate(() => !!document.querySelector("#lTools .imp-btns"));
      assert.equal(imp, GROUP[page] === "stock", page + "：編輯／匯入／匯出只在「持股」");
      assert.ok(await noHOverflow(p), page + "：沒有水平溢出");
      assert.equal(await p.evaluate(() => $("#dbg").hidden), true, page + "：切分頁不會跳出個股抽屜蓋住分頁列");
    }
    assert.deepEqual(await pressed(p, "#hvSeg"), ["交易紀錄"]);
    await ctx.close(); assert.deepEqual(errs, []);
  });

  test(`${width}：只有舊庫存時，需要交易紀錄的頁面顯示建立說明，其餘照常；存檔不被改動`, async () => {
    const { ctx, p, errs } = await start(width, { ledger: false });
    const snap = () => p.evaluate(() => ({ hold: localStorage.getItem("kline:watch:hold"), pf: localStorage.getItem("kline:pf:v1"), hv: localStorage.getItem("kline:watch:hv") }));
    const before = await snap();
    for (const page of PAGES) {
      await holdGo(p, page);
      if (NEED_LEDGER.includes(page)) { await p.waitForSelector("#lx .lgintro", { timeout: 30000 }); assert.match(await p.evaluate(() => $("#lx").innerText), /從現有庫存建立/, page); }
      else { await p.waitForTimeout(150); assert.equal(await p.evaluate(() => !!document.querySelector("#lx .lgintro")), false, page + "：不需要交易紀錄"); }
      assert.ok(["pnl", "ana", "risk", "macro", "tx"].includes(JSON.parse((await snap()).hv)), page + "：watch:hv 的值仍是原本那幾種");
    }
    const after = await snap(); assert.equal(after.hold, before.hold, "舊庫存一個字都沒變"); assert.equal(after.pf, null, "沒有偷偷建立交易紀錄");
    await ctx.close(); assert.deepEqual(errs, []);
  });

  test(`${width}：重新整理後記得主分頁；報告頁「總覽」保持選取、列印時不印分頁列；重畫不把分頁列捲回去`, async () => {
    const { ctx, p, errs } = await start(width);
    const again = async () => { await p.reload(); await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy))); await p.evaluate(() => setLt("hold")); await p.waitForSelector("#hvSeg"); };
    await holdGo(p, "ana"); await again(); assert.deepEqual(await pressed(p, "#hvSeg"), ["持股"]); assert.deepEqual(await pressed(p, "#hsubSeg"), ["屬性分析"]);
    await holdGo(p, "perf"); await again(); assert.deepEqual(await pressed(p, "#hvSeg"), ["總覽"], "交易紀錄底下的頁面重新整理後回到總覽（和原本一樣）");
    await p.waitForSelector("#lx [data-lg=view][data-v=report]", { timeout: 30000 }); await p.$eval("#lx [data-lg=view][data-v=report]", b => b.click());
    await p.waitForSelector("#lx .rpt", { timeout: 30000 }); assert.deepEqual(await pressed(p, "#hvSeg"), ["總覽"], "報告屬於總覽");
    await p.emulateMedia({ media: "print" }); assert.equal(await p.evaluate(() => { const e = document.querySelector("#hvSeg"), s = getComputedStyle(e); return s.visibility === "hidden" || s.display === "none" || !e.getClientRects().length; }), true, "列印時分頁列不印"); await p.emulateMedia({ media: "screen" });
    await holdGo(p, "tx"); await p.waitForSelector("[data-lg=add]");
    const view = () => p.evaluate(() => { const s = document.querySelector("#hvSeg"), b = s.querySelector('[aria-pressed="true"]').getBoundingClientRect(), r = s.getBoundingClientRect(); return { left: s.scrollLeft, in: b.left >= r.left - 1 && b.right <= r.right + 1 }; });
    const v1 = await view(); assert.ok(v1.in, "選到的主分頁看得到");
    await p.evaluate(() => renderList()); const v2 = await view(); assert.equal(v2.left, v1.left, "重畫後分頁列的位置不變"); assert.ok(v2.in);
    if (width < 500) { const h = await p.evaluate(() => Math.min(...[...document.querySelectorAll("#hvSeg button, #hsubSeg button")].map(e => e.getBoundingClientRect().height))); assert.ok(h >= 43.5, "手機上分頁按鈕至少 44px 高：" + h); }
    await ctx.close(); assert.deepEqual(errs, []);
  });
}
