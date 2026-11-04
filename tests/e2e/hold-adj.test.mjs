// 庫存風險用還原價：持股的日 K 要求 adj=1，用 ac（除息、分割還原）算報酬；有還原的寫出「用還原後的價格」，拿不到的寫出哪幾檔用原始價格；K 線圖不受影響
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const days = n => { const a = [], d = new Date("2026-04-01T00:00:00Z"); while (a.length < n) { if (d.getUTCDay() % 6) a.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return a; };

test("庫存風險：持股改用還原價（0050 一拆四不再像跌 75%）；拿不到除權息資料的持股寫出來", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    const D = days(130), urls = [];
    // 0050：第 60 天一拆四（原始價 188 → 47），ac 是還原後的連續價格
    await ctx.route("**/api/kline?code=0050**", r => { urls.push(r.request().url()); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "0050", name: "元大台灣50", market: "上市", source: "證交所", adj: { ok: true, source: "t", events: [{ d: D[60], kind: "split", r: 4 }], skipped: [] },
      data: D.map((d, i) => { const ac = 47 * (1 + Math.sin(i / 5) * 0.03), c = i < 60 ? ac * 4 : ac; return { d, o: c, h: c, l: c, c: +c.toFixed(2), ac: +ac.toFixed(4), v: 1000 }; }) }) }); });
    await ctx.route("**/api/kline?code=2317**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "2317", name: "鴻海", market: "上市", source: "證交所", adj: { ok: false, why: "fetch_failed" },
      data: D.map((d, i) => ({ d, o: 100, h: 101, l: 99, c: 100 + Math.cos(i / 4) * 3, v: 1000 })) }) }));
    await p.evaluate(() => { W.hold = { "0050": { sh: 1000, cost: 40 }, 2317: { sh: 1000, cost: 90 } }; W.holdMkt = "tw"; W.holdView = "risk"; setLt("hold"); });
    await p.waitForSelector(".hrisk", { timeout: 20000 });
    const t = await p.evaluate(() => $("#lx").innerText);
    assert.ok(urls.some(u => /adj=1/.test(u)), "持股日 K 要求還原價");
    assert.match(t, /持股用除息、分割還原後的價格/); assert.match(t, /2317 拿不到除權息資料，用原始價格計算/);
    assert.doesNotMatch(t, /異常單日.*0050/s, "分割那天不再被當成異常單日");
    assert.match(t, /價格指數，不含股息/);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
