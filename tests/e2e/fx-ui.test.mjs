// 績效頁的「合併（台幣計價）」：有美股時抓匯率、換成台幣合併；損益拆成台股、美股股價與股息、匯率，三塊加總＝合計；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "a", v: 1, date: "2025-06-02", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 100, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2025-06-02", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const num = s => +String(s).replace(/[^\d.-]/g, "");

test("合併（台幣計價）：匯率、美元占比、損益三塊加總＝合計", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await ctx.route("**/api/kline?code=TWD%3DX**", r => { const d = [], t = new Date("2025-05-01T00:00:00Z"); while (t < new Date("2026-10-10T00:00:00Z")) { if (t.getUTCDay() % 6) d.push(t.toISOString().slice(0, 10)); t.setUTCDate(t.getUTCDate() + 1); }
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "TWD=X", data: d.map((x, i) => ({ d: x, o: 30, h: 30, l: 30, c: +(30 + i * 0.005).toFixed(3), v: 0 })) }) }); });
    await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "perf" }; W.lgPx = null; W.holdView = "tx"; setLt("hold"); }, TX);
    await p.waitForSelector(".pffx", { timeout: 30000 });
    const t = await p.evaluate(() => document.querySelector(".pffx").innerText);
    assert.match(t, /合併（台幣計價）/); assert.match(t, /÷ 累計投入 [+-][\d.]+%（不扣賣出、不看時點）/); assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /總報酬率/, "不把「總損益 ÷ 累計投入」叫做總報酬率"); assert.match(t, /美元部位占 \d+%/); assert.match(t, /匯率影響/); assert.match(t, /市場中間價，不是銀行實際買賣匯率/); assert.match(t, /美元兌台幣 30\.\d\d → 31\.\d\d/);
    const v = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".pffx dl dt")].map(dt => [dt.textContent, dt.nextElementSibling.textContent])));
    assert.ok(Math.abs(num(v["台股損益"]) + num(v["美股股價與股息（換成台幣）"]) + num(v["匯率影響"]) - num(v["合計"])) <= 2, JSON.stringify(v));
    assert.ok(num(v["匯率影響"]) > 0, "美元升值，匯率影響是正的");
    assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
