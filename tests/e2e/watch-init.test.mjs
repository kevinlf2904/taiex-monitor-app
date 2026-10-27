// 看盤頁前端初始化與共用函式測試 (Phase 1 P0: 前端重複宣告與初始化驗證)
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const [modeDesc, pagePath, width, touch] of [
  ["桌面版看盤頁 (1280px)", "watch.html", 1280, false],
  ["手機版看盤頁 (390px)", "watch.html", 390, true],
  ["嵌入式看盤頁 (1280px, embed=1)", "watch.html?embed=1", 1280, false],
  ["情報局子頁模式 (1280px, mode=intel)", "watch.html?mode=intel", 1280, false]
]) {
  test(`看盤頁載入無語法/重複宣告錯誤且成功初始化：${modeDesc}`, async () => {
    const { ctx, p, errs } = await open(B, S.url, pagePath, { width, touch });

    // 1. 驗證無任何 SyntaxError 或 Identifier has already been declared 錯誤
    assert.deepEqual(errs, [], `頁面錯誤：${JSON.stringify(errs)}`);

    // 2. 驗證核心物件與函式初始化成功
    const res = await p.evaluate(() => {
      return {
        hasW: typeof W !== "undefined" && typeof W.quotes !== "undefined",
        hasSetLt: typeof setLt === "function",
        hasSelect: typeof select === "function",
        hasShowList: typeof showList === "function",
        hasQuoteTimestamp: typeof quoteTimestamp === "function",
        hasParseTimeToSec: typeof parseTimeToSec === "function",
        hasIsQuoteStale: typeof isQuoteStale === "function",
        hasEvalDataStatus: typeof evalDataStatus === "function",
        hasMktStatusTag: typeof mktStatusTag === "function",
      };
    });

    assert.ok(res.hasW, "W 必須成功初始化");
    assert.ok(res.hasSetLt, "setLt 必須為可執行函式");
    assert.ok(res.hasSelect, "select 必須為可執行函式");
    assert.ok(res.hasShowList, "showList 必須為可執行函式");
    assert.ok(res.hasQuoteTimestamp, "quoteTimestamp 必須為可執行函式");
    assert.ok(res.hasParseTimeToSec, "parseTimeToSec 必須為可執行函式");
    assert.ok(res.hasIsQuoteStale, "isQuoteStale 必須為可執行函式");
    assert.ok(res.hasEvalDataStatus, "evalDataStatus 必須為可執行函式");
    assert.ok(res.hasMktStatusTag, "mktStatusTag 必須為可執行函式");

    // 3. 測試行情時間解析與過期判定
    const quoteTest = await p.evaluate(() => {
      const q1 = { date: "2026-10-27", time: "10:30:00", price: 100 };
      const qOld = { date: "2026-10-27", time: "09:30:00", price: 99 };
      const qNew = { date: "2026-10-27", time: "11:00:00", price: 101 };
      const qIso = { time: "2026-10-27T03:00:00Z", price: 102 };

      return {
        tsQ1: quoteTimestamp(q1),
        tsIso: quoteTimestamp(qIso),
        sec1030: parseTimeToSec("10:30:00"),
        sec930: parseTimeToSec("9:30:00"),
        isStaleOld: isQuoteStale(qOld, q1),     // 舊資料覆蓋新資料應回傳 true (被擋下)
        isStaleNew: isQuoteStale(qNew, q1),     // 新資料覆蓋舊資料應回傳 false (允許)
        isStaleSame: isQuoteStale(q1, q1),       // 相同時間應回傳 false
        isStaleNoDate: isQuoteStale({ time: "10:30:00" }, q1), // 缺日期應保守擋下 (true)
      };
    });

    assert.ok(Number.isFinite(quoteTest.tsQ1), "quoteTimestamp 必須能解析標準日期時間");
    assert.ok(Number.isFinite(quoteTest.tsIso), "quoteTimestamp 必須能解析 ISO 時間字串");
    assert.equal(quoteTest.sec1030, 37800, "10:30:00 應為 37800 秒");
    assert.equal(quoteTest.sec930, 34200, "9:30:00 應為 34200 秒");
    assert.equal(quoteTest.isStaleOld, true, "舊報價不得覆蓋較新報價");
    assert.equal(quoteTest.isStaleNew, false, "新報價應允許更新");
    assert.equal(quoteTest.isStaleNoDate, true, "缺少日期之報價不得覆蓋完整報價");

    await ctx.close();
  });
}
