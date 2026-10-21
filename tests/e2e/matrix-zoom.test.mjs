import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [1280, 390]) {
  test(`動能矩陣：支援滾動放大、按鈕縮放、拖曳平移與雙擊還原 (${width}px)`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    
    // 設定 Mock 數據並切換到動能矩陣
    await p.evaluate(() => {
      const A = [
        { id: "s1", name: "半導體", kind: "產業", n: 2, q: "up", q1: "up", net1: 1e8, prev1: 0, accel1: 1e8, net5: 5e9, prev5: 0, accel: 1e9, pct1: 1, pct5: 2, f1: 0, tr1: 0, f5: 0, tr5: 0, buy1: 2, buy5: 2 },
        { id: "s2", name: "散熱", kind: "產業", n: 3, q: "rot", q1: "rot", net1: -5e7, prev1: 0, accel1: -2e7, net5: 2e9, prev5: 0, accel: -5e8, pct1: -0.5, pct5: 1, f1: 0, tr1: 0, f5: 0, tr5: 0, buy1: 1, buy5: 2 }
      ];
      const mem = c => ({ code: c, name: "股" + c, pct: [1], px: [100], amt: [3], f: [1], tr: [1] });
      W.mf.days = [{ date: "2026-10-16", rows: [] }];
      W.mf.model = { T: 1, dates: ["2026-10-16"], secs: [{ id: "s1", name: "半導體", kind: "產業", mem: [mem("2330"), mem("2454")] }] };
      window.flowAt = () => A;
      window.flowStocks = () => [];
      window.flowMood = () => null;
      showList();
      setLt("money");
      W.mf.view = "bubble";
      W.mf.bw = "5";
      renderList();
    });
    await p.waitForSelector(".bwrap #mfb", { timeout: 10000 });

    // 1. 驗證預設 viewBox
    const initVb = await p.evaluate(() => document.getElementById("mfb").getAttribute("viewBox"));
    assert.ok(initVb, "初始有 viewBox");
    const initZoomText = await p.evaluate(() => document.querySelector(".mf-zval")?.textContent);
    assert.equal(initZoomText, "100%", "初始縮放為 100%");

    // 2. 測試按鈕放大
    await p.click('[data-mzoom="in"]');
    await p.waitForTimeout(100);
    const zoomInVb = await p.evaluate(() => document.getElementById("mfb").getAttribute("viewBox"));
    const zoomInText = await p.evaluate(() => document.querySelector(".mf-zval")?.textContent);
    assert.notEqual(zoomInVb, initVb, "點擊放大後 viewBox 改變");
    assert.equal(zoomInText, "125%", "放大後顯示 125%");
    assert.ok(await p.evaluate(() => document.querySelector(".bwrap").classList.contains("is-zoomed")), "有 is-zoomed 樣式");

    // 3. 一般滾輪要留給頁面捲動（不縮放、不擋預設行為），Ctrl／⌘＋滾輪（觸控板捏合）才縮放
    const plain = await p.evaluate(() => {
      const wrap = document.querySelector(".bwrap"), k0 = W.mf.zoom.k;
      const ev = new WheelEvent("wheel", { deltaY: -200, clientX: 200, clientY: 200, bubbles: true, cancelable: true });
      wrap.dispatchEvent(ev);
      return { blocked: ev.defaultPrevented, same: W.mf.zoom.k === k0, hint: !!wrap.querySelector(".wheel-hint") };
    });
    assert.deepEqual(plain, { blocked: false, same: true, hint: true }, "一般滾輪不縮放、頁面照常捲動，並提示用 Ctrl／⌘");
    await p.evaluate(() => {
      const wrap = document.querySelector(".bwrap");
      const ev = new WheelEvent("wheel", { deltaY: -200, clientX: 200, clientY: 200, ctrlKey: true, bubbles: true, cancelable: true });
      wrap.dispatchEvent(ev);
    });
    await p.waitForTimeout(100);
    const wheelZoomK = await p.evaluate(() => W.mf.zoom.k);
    assert.ok(wheelZoomK > 1.25, `Ctrl＋滾輪放大後比例大於 1.25 (目前 ${wheelZoomK})`);

    // 4. 測試雙擊還原 (double click reset)
    await p.evaluate(() => {
      const wrap = document.querySelector(".bwrap");
      wrap.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    await p.waitForTimeout(100);
    const resetVb = await p.evaluate(() => document.getElementById("mfb").getAttribute("viewBox"));
    const resetZoomText = await p.evaluate(() => document.querySelector(".mf-zval")?.textContent);
    assert.equal(resetZoomText, "100%", "雙擊後還原為 100%");
    assert.equal(resetVb, initVb, "雙擊後 viewBox 還原");

    // 5. 測試拖曳平移 (drag pan)
    await p.click('[data-mzoom="in"]');
    await p.click('[data-mzoom="in"]');
    await p.waitForTimeout(100);
    const prePanVb = await p.evaluate(() => document.getElementById("mfb").getAttribute("viewBox"));
    
    // 模擬在 .bwrap 上拖曳 100px
    await p.evaluate(() => {
      const wrap = document.querySelector(".bwrap");
      wrap.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 300, clientY: 300, bubbles: true }));
      wrap.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 200, clientY: 200, bubbles: true }));
      wrap.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 200, clientY: 200, bubbles: true }));
    });
    await p.waitForTimeout(100);
    const postPanVb = await p.evaluate(() => document.getElementById("mfb").getAttribute("viewBox"));
    assert.notEqual(postPanVb, prePanVb, `拖曳後 viewBox 平移位置改變 (原本 ${prePanVb} vs 現在 ${postPanVb})`);

    // 手機放大後，單指上下滑仍然捲動頁面（之前 touch-action: none 會讓手指在圖上時卡住、回不到最上面）
    if (width < 500) {
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".bwrap")).touchAction), "pan-y", "手機放大後仍可上下捲動頁面");
      await p.evaluate(() => scrollTo(0, 0)); const box = await p.locator(".bwrap").boundingBox();
      if (box.y > 200) await p.evaluate(y => scrollTo(0, y), box.y - 100);
      const y0 = await p.evaluate(() => scrollY), b = await p.locator(".bwrap").boundingBox(), cdp = await ctx.newCDPSession(p), x = b.x + b.width / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: b.y + 40 }] });
      for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: b.y + 40 + i * 25 }] }); await p.waitForTimeout(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(300);
      assert.ok(await p.evaluate(() => scrollY) < y0 || y0 === 0, `手指放在放大的矩陣上往下拉，頁面往上捲（${y0} → ${await p.evaluate(() => scrollY)}）`);
    }

    // 6. 點擊還原按鈕
    await p.click('[data-mzoom="reset"]');
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(() => document.querySelector(".mf-zval")?.textContent), "100%", "點擊重設按鈕還原 100%");

    // 7. 驗證流線動畫 seamless keyframe 樣式存在與模式過場動畫規則
    const animRules = await p.evaluate(() => {
      const found = {};
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.name === "mfStream") found.stream = rule.cssText;
            if (rule.name === "mfViewEnter") found.viewEnter = rule.cssText;
            if (rule.name === "mfFlowIn") found.flowIn = rule.cssText;
            if (rule.name === "mfTreeIn") found.treeIn = rule.cssText;
            if (rule.name === "mfHeatIn") found.heatIn = rule.cssText;
          }
        } catch {}
      }
      return found;
    });
    assert.ok(animRules.stream?.includes("24"), "mfStream 動畫設定無縫 -24 偏移循環");
    assert.ok(animRules.viewEnter, "mfViewEnter 視圖切換淡入動畫存在");
    assert.ok(animRules.flowIn, "mfFlowIn 移轉流向動畫存在");
    assert.ok(animRules.treeIn, "mfTreeIn 矩形樹圖動畫存在");
    assert.ok(animRules.heatIn, "mfHeatIn 熱力格動畫存在");

    // 8. 測試模式切換過場：移轉流向 (flow) -> 矩形樹圖 (tree) -> 熱力格 (heat)
    await p.click('[data-mviz="flow"]');
    await p.waitForSelector('.bwrap[data-viz="flow"]', { timeout: 3000 });
    assert.ok(await p.evaluate(() => document.querySelectorAll('.bwrap[data-viz="flow"] .bnode').length > 0), "移轉流向節點已渲染");

    await p.click('[data-mviz="tree"]');
    await p.waitForSelector('.bwrap[data-viz="tree"]', { timeout: 3000 });
    assert.ok(await p.evaluate(() => document.querySelectorAll('.bwrap[data-viz="tree"] .bnode').length > 0), "矩形樹圖節點已渲染");

    await p.click('[data-mviz="heat"]');
    await p.waitForSelector('.bwrap[data-viz="heat"]', { timeout: 3000 });
    assert.ok(await p.evaluate(() => document.querySelectorAll('.bwrap[data-viz="heat"] .bnode').length > 0), "熱力格節點已渲染");

    // 切回 bubble 象限圖
    await p.click('[data-mviz="bubble"]');
    await p.waitForSelector('.bwrap[data-viz="bubble"]', { timeout: 3000 });

    // 9. 驗證無橫向溢出
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "無橫向溢出");

    await ctx.close();
    assert.deepEqual(errs, []);
  });
}

test("動能矩陣回放：右側象限清單與數量跟著回放日期，播到最後一天停住，各種模式都沒有錯誤", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => {
    // 12 天、6 個板塊：前幾天 a 最大、後幾天 f 最大，象限清單第一名要跟著日期換
    const ids = ["a", "b", "c", "d", "e", "f"], T = 12, dates = Array.from({ length: T }, (_, t) => `2026-10-${String(t + 1).padStart(2, "0")}`);
    const at = t => ids.map((id, i) => { const big = t < 6 ? i === 0 : i === 5, v = (big ? 9e9 : (i + 1) * 1e9) * (1 + t / 20);
      return { id, name: "板塊" + id, kind: "題材", n: 3, q: "up", q1: "up", net1: v / 5, prev1: 0, accel1: 1e8, net5: v, prev5: 0, accel: 1e9 + i * 1e8, pct1: 1, pct5: 2, f1: 0, tr1: 0, f5: 0, tr5: 0, buy1: 2, buy5: 2 }; });
    W.mf.days = dates.map(date => ({ date, rows: [] }));
    W.mf.model = { T, dates, secs: [] };
    window.mfModel = () => W.mf.model;
    window.flowAt = (M, t = T - 1) => at(t);
    window.flowStocks = () => [];
    window.flowMood = () => null;
    showList(); setLt("money"); W.mf.view = "bubble"; W.mf.viz = "bubble"; W.mf.q = "up"; W.mf.rp.speed = 4; renderList();
  });
  await p.waitForSelector(".bwrap #mfb");
  const top = () => p.evaluate(() => document.querySelector(".mqlist li .nm")?.firstChild?.textContent);
  assert.equal(await top(), "板塊f", "最新一天第一名是 f");
  await p.click('[data-mrp="play"]');
  await p.waitForFunction(() => W.mf.rp.u != null && W.mf.rp.u < 6);
  assert.equal(await top(), "板塊a", "回放到前幾天時第一名換成 a");
  await p.waitForFunction(() => !W.mf.rp.playing, null, { timeout: 15000 });
  const end = await p.evaluate(() => ({ u: W.mf.rp.u, btn: document.querySelector('[data-mrp="play"]:not([data-mrp-top])').textContent }));
  assert.deepEqual(end, { u: 11, btn: "▶ 回放" }, "播到最後一天停住，按鈕變回播放");
  assert.equal(await top(), "板塊f");
  // 其他視覺化模式也能回放、拖滑桿
  let want = 11;
  for (const viz of ["heat", "flow", "tree"]) {
    await p.evaluate(v => { W.mf.viz = v; W.mf.rp.fl = null; renderList(); }, viz);
    await p.click('[data-mrp="prev"]'); await p.waitForFunction(() => !W.mf.rp.seeking, null, { timeout: 5000 }); // 等補間跑完（機器忙時 450ms 動畫會拉長）
    assert.equal(await p.evaluate(() => Math.round(W.mf.rp.u)), --want, `${viz} 上一天`);
    assert.ok(await p.evaluate(() => !document.getElementById("mfb").classList.contains("is-playing")), `${viz} 補間結束後恢復過場動畫`);
  }
  await ctx.close();
  assert.deepEqual(errs, []);
});
