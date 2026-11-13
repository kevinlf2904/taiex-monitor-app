// 交易紀錄 →「總覽」（預設分頁）：總資產、今日損益、累積損益、現金比例、風險狀態、市場分布、主要持倉、資料時間；點進對應分頁；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-05", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];

test("總覽：預設分頁、重點數字、風險、分布、主要持倉、資料時間；點進配置", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
    await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = null; W.lgAl = null; W.holdView = "tx"; setLt("hold"); }, TX);
    await p.waitForSelector(".hmcard", { timeout: 30000 });
    const t = await p.evaluate(() => $("#lx").innerText);
    for (const k of ["投資組合總覽", "總資產（台幣）", "今日損益", "累積損益", "現金比例", "風險狀態", "市場分布", "主要持倉", "資料時間", "報價的時間是行情時間"]) assert.match(t, new RegExp(k), width + "：" + k);
    // 持股市值走勢：和績效頁共用日 K，載入後畫出 SVG（台股＋美股換成台幣）
    await p.waitForSelector(".hmcard .hmtrend path", { timeout: 30000 });
    const tr = await p.evaluate(() => [$(".hmcard .hmtrend").getAttribute("aria-label"), $(".hmcard").innerText]);
    assert.match(tr[0], /持股市值走勢：\d{4}-\d\d-\d\d/); assert.match(tr[1], /美股用每天的美元兌台幣匯率換算/); assert.match(tr[1], /不等於報酬/);
    assert.match(t, /美元兌台幣 32\.000/); assert.match(t, /單一持股占比偏高/, "2330 占比超過 30%");
    assert.equal(await p.evaluate(() => document.querySelector('[data-lg=view][data-v=home]').getAttribute("aria-pressed")), "true", "總覽是預設分頁");
    assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, width + "：沒有水平溢出");
    if (width < 500) { const h = await p.evaluate(() => Math.min(...[...document.querySelectorAll("#hvSeg button, .hmcard .lgbar .btn, .hmalerts .linkbtn, .hmrow")].map(e => e.getBoundingClientRect().height))); assert.ok(h >= 43.5, "手機上可點的按鈕至少 44px 高：" + h); }
    await p.click('.hmcard .pftile[data-v="alloc"]'); await p.waitForSelector(".alcard", { timeout: 30000 });
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
