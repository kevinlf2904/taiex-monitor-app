// 庫存「交易紀錄」（ledger-ui.js）：搬移先預覽、按確認才寫入 kline:pf:v1、舊庫存不變；賣超擋下且不寫入；正常賣出算出已實現損益；
// 刪除會讓後面出錯時不讓刪；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("交易紀錄：預覽 → 確認建立 → 新增賣出（賣超擋下）→ 刪除影響範圍", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    const before = await p.evaluate(() => { localStorage.removeItem("kline:pf:v1"); W.hold = { 2330: { sh: 1000, cost: 500, d: "2025-03-10" }, NVDA: { sh: 10, cost: 100 }, 2454: { sh: -1, cost: 1 } };
      store.set("watch:hold", W.hold); W.holdMkt = "tw"; W.holdView = "tx"; setLt("hold"); return localStorage.getItem("kline:watch:hold"); });
    await p.waitForSelector("[data-lg=preview]", { timeout: 20000 });
    await p.click("[data-lg=preview]");
    let t = await p.evaluate(() => $("#lx").innerText);
    assert.match(t, /搬移預覽/); assert.match(t, /共 2 筆會建立、1 筆不搬/); assert.match(t, /2454[\s\S]*股數要大於 0/);
    assert.equal(await p.evaluate(() => localStorage.getItem("kline:pf:v1")), null, "預覽時不寫入");
    await p.click("[data-lg=commit]");
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
    assert.equal(st.v, 1); assert.equal(st.transactions.length, 2); assert.equal(st.migratedFrom, "kline:watch:hold"); assert.equal(st.method, "avg");
    assert.equal(await p.evaluate(() => localStorage.getItem("kline:watch:hold")), before, "舊庫存不變");
    t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /已建立交易紀錄（2 筆）/); assert.match(t, /持有中（2 檔）/);
    // 賣超：擋下、不寫入
    await p.click("[data-lg=add]"); await p.selectOption("#lgType", "sell");
    await p.fill("#lgForm [name=symbol]", "2330"); await p.fill("#lgForm [name=shares]", "5000"); await p.fill("#lgForm [name=price]", "600"); await p.fill("#lgForm [name=date]", "2026-01-05");
    await p.click("#lgForm button[type=submit]");
    t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /賣出 5000 股，但當時只持有 1000 股/);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 2, "賣超沒有寫入");
    // 正常賣出（手續費、稅填 0）
    await p.fill("#lgForm [name=shares]", "500"); await p.fill("#lgForm [name=fee]", "0"); await p.fill("#lgForm [name=tax]", "0");
    await p.click("#lgForm button[type=submit]");
    t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /已加入/); assert.match(t, /\+50,000/, "已實現 500 ×（600 − 500）");
    // 刪除 2330 的轉入：後面的賣出會變賣超 → 不讓刪
    const id = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.find(x => x.symbol === "2330" && x.type === "transfer_in").id);
    await p.click(`[data-lg=del][data-id="${id}"]`);
    t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /不能刪除：刪掉後有 1 筆交易會出錯/);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 3);
    // 刪除那筆賣出：可以刪
    const sid = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.find(x => x.type === "sell").id);
    await p.click(`[data-lg=del][data-id="${sid}"]`);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 2);
    // 展開成本變化
    await p.click('[data-lg=pos][data-c="2330"]'); t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /平均成本/);
    assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
