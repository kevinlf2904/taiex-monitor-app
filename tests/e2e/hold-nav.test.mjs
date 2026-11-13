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
const NEED_LEDGER = ["home", "perf", "div", "thesis", "tx"];
// 每一頁「內容是對的那一頁」的判斷：頁面自己的標記元素，或內部狀態（原本的畫面由這兩個狀態決定）
const MARK = { home: ".hmcard", perf: ".pfcard", alloc: ".alcard", tx: "[data-lg=add]", margin: "[data-lg=mgadd]", ana: "#wl .hhead.ana", thesis: "#lx .thev, #lx .thsum",
  pnl: "#lx .yh-sum", risk: "#lx .hrisk:not(.msens)", macro: "#lx .hrisk.msens", div: "#lx .dvbars" };
const STATE = { pnl: ["pnl"], ana: ["ana"], risk: ["risk"], macro: ["macro"], home: ["tx", "home"], perf: ["tx", "perf"], alloc: ["tx", "alloc"], margin: ["tx", "margin"], div: ["tx", "div"], thesis: ["tx", "thesis"], tx: ["tx", "tx"] };
const state = p => p.evaluate(() => W.holdView === "tx" ? ["tx", W.lg?.view || "home"] : [W.holdView]);
const pressed = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel + ' button[aria-pressed="true"]')].map(b => b.innerText.trim()), sel);
const seed = (p, { ledger = true } = {}) => p.evaluate(([old, tx, ledger]) => { localStorage.setItem("kline:watch:hold", JSON.stringify(old)); if (ledger) localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: tx, at: "2026-11-01T00:00:00Z" })); else localStorage.removeItem("kline:pf:v1"); localStorage.setItem("kline:watch:hv", '"pnl"'); }, [OLD, TX, ledger]);
async function start(width, opt) { const o = await open(B, S.url, "watch.html", { width, touch: width < 500 }); await seed(o.p, opt); await o.p.reload(); await o.p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy))); await o.p.evaluate(() => { W.holdMkt = "tw"; setLt("hold"); }); await o.p.waitForSelector("#hvSeg"); return o; }

for (const width of [390, 1280]) {
  test(`${width}：只有一排主分頁；11 個頁面都到得了，選取狀態與內容正確；子分頁只在自己的群組出現`, async () => {
    const { ctx, p, errs } = await start(width);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#hvSeg button[data-nav]")].map(b => b.innerText.trim())), MAIN); // 手機上分頁列另有現成的「▾ 全部」展開鈕，不算主分頁
    // 桌面：一開始在雙欄的「持股」而且已經選了個股（個股頁開著）；切到全寬頁面時不能變成抽屜彈出來蓋住畫面
    if (width > 900) assert.deepEqual(await p.evaluate(() => [$("#main").classList.contains("show-detail"), !!W.sel, wideMode()]), [true, true, false], "前提：雙欄、個股頁開著");
    for (const page of PAGES) {
      await holdGo(p, page);
      if (width > 900 && page === "home") assert.deepEqual(await p.evaluate(() => [wideMode(), $("#main").classList.contains("show-detail"), $("#dbg").hidden]), [true, false, true], "持股 → 總覽：全寬、抽屜關著、沒有背景遮罩");
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
      else if (page === "alloc") { await p.waitForSelector("#lx .alcard", { timeout: 30000 }); await p.waitForSelector("#lx .rbcard", { timeout: 30000 }); assert.equal(await p.evaluate(() => !!document.querySelector("#lx .lgintro")), false, "alloc：有舊庫存時直接顯示配置與再平衡"); }
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

// Issue #298：「配置與風險」四個子分頁在電腦版同一種版面（全寬），切換時寬度與主分頁列高度不變；風險、總經敏感度點持股用右側抽屜
test("1280：配置、風險、總經敏感度、融資都是全寬，內容寬度與主分頁列高度相同；風險／總經頁點持股開抽屜、Esc 關閉", async () => {
  const { ctx, p, errs } = await start(1280);
  const box = {};
  for (const page of ["alloc", "risk", "macro", "margin"]) {
    await holdGo(p, page); await p.waitForSelector(MARK[page], { timeout: 30000 });
    box[page] = await p.evaluate(() => ({ wide: $("#main").classList.contains("wide"), lx: Math.round($("#lx").getBoundingClientRect().width), hv: Math.round($("#hvSeg").getBoundingClientRect().height), wl: $("#wl").hidden, dbg: $("#dbg").hidden }));
    assert.equal(box[page].wide, true, page + "：全寬"); assert.equal(box[page].wl, true, page + "：左邊的清單區收起來，不留空白欄"); assert.equal(box[page].dbg, true, page);
    assert.ok(await noHOverflow(p), page + "：沒有水平溢出");
  }
  for (const page of ["risk", "macro", "margin"]) { assert.equal(box[page].lx, box.alloc.lx, page + "：內容寬度和配置一樣"); assert.equal(box[page].hv, box.alloc.hv, page + "：主分頁列高度和配置一樣"); }
  assert.ok(box.alloc.hv < 60, "主分頁列是 1 排：" + box.alloc.hv);
  for (const page of ["risk", "macro"]) {
    await holdGo(p, page); await p.waitForSelector(MARK[page], { timeout: 30000 });
    await p.click(`${MARK[page]} table [data-sel="2330"]`);
    await p.waitForFunction(() => $("#main").classList.contains("show-detail") && !$("#dbg").hidden); assert.equal(await p.evaluate(() => W.sel), "2330", page + "：點持股開右側抽屜");
    await p.keyboard.press("Escape"); await p.waitForFunction(() => !$("#main").classList.contains("show-detail") && $("#dbg").hidden);
    assert.equal(await p.evaluate(() => W.holdView), page, page + "：關掉抽屜後還在同一頁");
  }
  // 全寬下的排版：指標卡一排最多 4 張（不擠成 8 張一排、也不拉成扁條）；說明文字不拉滿整頁；總經頁因子名稱那一欄夠寬
  await holdGo(p, "risk"); await p.waitForSelector(MARK.risk);
  const rk = await p.evaluate(() => { const C = [...document.querySelectorAll("#lx .hrisk .qx-cards > div")], rows = {}; C.forEach(c => { const y = Math.round(c.getBoundingClientRect().top); rows[y] = (rows[y] || 0) + 1; }); return { n: C.length, max: Math.max(...Object.values(rows)), note: document.querySelector("#lx .hrisk > p.note").getBoundingClientRect().width }; });
  assert.ok(rk.n >= 6, "風險頁有指標卡：" + rk.n); assert.ok(rk.max <= 4, "指標卡一排最多 4 張：" + rk.max); assert.ok(rk.note <= 960, "說明文字限制閱讀寬度：" + rk.note);
  await holdGo(p, "macro"); await p.waitForSelector(MARK.macro);
  const mc = await p.evaluate(() => { const L = [...document.querySelectorAll("#lx .msens .qx-list")].pop(), b = L.querySelector("li > b"); return { w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(b).lineHeight) }; });
  assert.ok(mc.w >= 90, "因子名稱那一欄夠寬：" + mc.w); assert.ok(mc.h <= mc.lh * 2 + 2, "因子名稱不被擠成直行：" + mc.h);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("390：風險、總經敏感度維持手機版面（不是全寬模式），不溢出；因子名稱不被擠成直行", async () => {
  const { ctx, p, errs } = await start(390);
  for (const page of ["risk", "macro"]) {
    await holdGo(p, page); await p.waitForSelector(MARK[page], { timeout: 30000 });
    assert.equal(await p.evaluate(() => $("#main").classList.contains("wide")), false, page); assert.ok(await noHOverflow(p), page + "：沒有水平溢出");
  }
  const mc = await p.evaluate(() => { const L = [...document.querySelectorAll("#lx .msens .qx-list")].pop(), b = L.querySelector("li > b"); return { h: b.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(b).lineHeight) }; });
  assert.ok(mc.h <= mc.lh * 3 + 2, "因子名稱最多折 3 行：" + mc.h);
  await ctx.close(); assert.deepEqual(errs, []);
});

// #299 審查補測：點背景關抽屜；只有一檔、切到沒有持股的美股時版面仍是全寬；盤中每秒更新時背景的風險／總經頁不重畫（開著抽屜看盤不閃）
test("1280：風險、總經敏感度點背景關抽屜；切到沒有持股的美股仍是全寬；盤中每秒更新不重畫背景", async () => {
  const { ctx, p, errs } = await start(1280);
  for (const page of ["risk", "macro"]) {
    await holdGo(p, page); await p.waitForSelector(MARK[page], { timeout: 30000 });
    await p.click(`${MARK[page]} table [data-sel="2330"]`); await p.waitForFunction(() => $("#main").classList.contains("show-detail") && !$("#dbg").hidden);
    // 盤中：fastTick 每秒呼叫 renderList（W.ticking＝true）；風險、總經頁用收盤資料，背景不該被整頁換掉
    const same = await p.evaluate(() => { const el = $("#lx").firstElementChild; W.lastPtr = 0; /* lastPtr 歸零：不然「剛點過 0.9 秒內不重畫」那條會先擋住，測不到這一條 */ W.ticking = true; try { renderList(); } finally { W.ticking = false; } return $("#lx").firstElementChild === el; });
    assert.equal(same, true, page + "：盤中每秒更新不重畫背景");
    await p.mouse.click(40, 600); await p.waitForFunction(() => !$("#main").classList.contains("show-detail") && $("#dbg").hidden);
    assert.equal(await p.evaluate(() => W.holdView), page, page + "：點背景關掉抽屜後還在同一頁");
    // 假資料只有台股一檔：切到美股（沒有持股）時顯示提示，版面仍是全寬、清單區收起、不溢出
    await p.click('#holdSeg [data-hm="us"]'); await p.waitForFunction(() => W.holdMkt === "us");
    assert.match(await p.evaluate(() => $("#lx").innerText), /還沒有美股持股/, page + "：美股沒有持股的提示");
    assert.deepEqual(await p.evaluate(() => [$("#main").classList.contains("wide"), $("#wl").hidden]), [true, true], page + "：美股也是全寬");
    assert.ok(await noHOverflow(p), page + "：美股不溢出");
    await p.click('#holdSeg [data-hm="tw"]'); await p.waitForFunction(() => W.holdMkt === "tw");
  }
  await ctx.close(); assert.deepEqual(errs, []);
});
