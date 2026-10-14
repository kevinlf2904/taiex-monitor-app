// 冒煙測試：學堂與看盤的每個分頁、子頁都打開一次，不能有任何頁面錯誤，也不能出現水平捲動
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const [width, touch] of [[1180, false], [390, true]]) {
  test(`學堂所有分頁（${width}px）`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch });
    for (const t of ["learn", "lab", "challenge", "draw", "quiz", "shot", "savings"]) { await p.evaluate(t => goTab(t), t); await p.waitForTimeout(500); }
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); await ctx.close();
    assert.deepEqual(errs, []); assert.ok(over <= 1, `水平捲動 ${over}px`);
  });
  test(`看盤所有分頁與工具、國會子頁（${width}px）`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch });
    for (const l of ["watch", "hold", "tools", "mkt", "screen", "money", "ind", "etf", "pod", "cong", "tw", "us", "rank", "after"]) { await p.evaluate(l => setLt(l), l); await p.waitForTimeout(400); }
    await p.evaluate(() => setLt("tools")); for (const v of await p.evaluate(() => TOOLS_VIEWS.map(x => x[0]))) { await p.evaluate(v => { W.tv = v; renderList(); }, v); await p.waitForTimeout(500); }
    await p.evaluate(() => setLt("screen")); for (const g of ["smart", "custom", "score", "rs", "kline"]) { await p.evaluate(g => { W.scrG = g; renderList(); }, g); await p.waitForTimeout(400); }
    await p.evaluate(() => setLt("cong")); for (const v of ["home", "bt", "f13", "tw", "ins"]) { await p.evaluate(v => { W.cv = v; renderList(); }, v); await p.waitForTimeout(400); }
    for (const c of ["2330", "NVDA"]) { await p.evaluate(c => select(c), c); await p.waitForTimeout(800); for (const t of ["ovw", "trend", "tech", "chips", "fin"]) { await p.evaluate(t => setDtab(t), t); await p.waitForTimeout(400); } }
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); await ctx.close();
    assert.deepEqual(errs, []); assert.ok(over <= 1, `水平捲動 ${over}px`);
  });
}
