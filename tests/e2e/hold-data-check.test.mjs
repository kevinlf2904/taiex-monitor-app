// 庫存資料檢查：缺價格、價格過期、資料錯誤的持倉在損益頁列出來；正常的不列；不改動存檔；手機不溢出
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("庫存資料檢查：有問題的持倉列出原因，存檔不被改動", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    const r = await p.evaluate(async () => {
      W.hold = { 2330: { sh: 1000, cost: 90 }, 2317: { sh: 100, cost: 100, d: "2025-02-30" }, 2454: { sh: -5, cost: 100 } };
      store.set("watch:hold", W.hold); const before = localStorage.getItem("kline:watch:hold");
      W.holdMkt = "tw"; W.holdView = "pnl"; setLt("hold");
      await new Promise(res => setTimeout(res, 1500)); renderList();
      const d = document.querySelector("#lx .hdq"); return { before, after: localStorage.getItem("kline:watch:hold"), text: d?.textContent || "", sw: document.documentElement.scrollWidth };
    });
    assert.match(r.text, /資料檢查：2 筆持倉需要注意/, width + "：" + r.text);
    assert.match(r.text, /2454.*資料錯誤.*股數要大於 0/s); assert.match(r.text, /2317.*建倉日期格式不對/s);
    assert.doesNotMatch(r.text, /2330/, "正常的不列");
    assert.equal(r.after, r.before, "存檔沒有被改動"); assert.ok(r.sw <= width + 1 /* 和設定的螢幕寬度比（#249）*/, "沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("全部持股都還沒有報價：資料檢查仍然出現並列出缺價格；看不出市場的另外列出", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await ctx.route("**/api/quote**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", quotes: [] }) }));
    const r = await p.evaluate(async () => {
      W.quotes.clear(); W.hold = { 2330: { sh: 1000, cost: 90 }, 2317: { sh: 100, cost: 100 }, "AB_CD": { sh: 1, cost: 1 } };
      W.holdMkt = "tw"; W.holdView = "pnl"; setLt("hold"); W.quotes.clear();
      await new Promise(res => setTimeout(res, 1500)); W.quotes.clear(); renderList();
      return { text: document.querySelector("#lx .hdq")?.textContent || "", sw: document.documentElement.scrollWidth };
    });
    assert.match(r.text, /資料檢查：3 筆持倉需要注意/, width + "：" + r.text);
    assert.match(r.text, /2330.*缺價格/s); assert.match(r.text, /看不出是台股還是美股.*AB_CD/s);
    assert.ok(r.sw <= width + 1 /* 和設定的螢幕寬度比（#249）*/, "沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
