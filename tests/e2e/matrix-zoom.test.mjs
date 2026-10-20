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

    // 3. 測試滑鼠滾輪放大 (wheel zoom)
    await p.evaluate(() => {
      const wrap = document.querySelector(".bwrap");
      const ev = new WheelEvent("wheel", { deltaY: -200, clientX: 200, clientY: 200, bubbles: true, cancelable: true });
      wrap.dispatchEvent(ev);
    });
    await p.waitForTimeout(100);
    const wheelZoomK = await p.evaluate(() => W.mf.zoom.k);
    assert.ok(wheelZoomK > 1.25, `滾輪放大後比例大於 1.25 (目前 ${wheelZoomK})`);

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

    // 6. 點擊還原按鈕
    await p.click('[data-mzoom="reset"]');
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(() => document.querySelector(".mf-zval")?.textContent), "100%", "點擊重設按鈕還原 100%");

    // 7. 驗證流線動畫 seamless keyframe 樣式存在
    const streamCss = await p.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.name === "mfStream") return rule.cssText;
          }
        } catch {}
      }
      return "";
    });
    assert.ok(streamCss.includes("24"), "mfStream 動畫設定無縫 -24 偏移循環");

    // 8. 驗證無橫向溢出
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "無橫向溢出");

    await ctx.close();
    assert.deepEqual(errs, []);
  });
}
