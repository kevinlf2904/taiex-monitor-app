// 主要流程：選股「自訂條件」全市場選股、模擬交易（市價＋掛單）、交易日記、備份同步
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("工具流程", async () => {
  const { ctx, p, errs, KV } = await open(B, S.url, "watch.html");
  await p.evaluate(() => { setLt("screen"); W.scrG = "custom"; SC().uni = "market"; SC().rules = [{ k: "above", p: 20 }]; scSave(); renderList(); });
  await p.click("#lx [data-scrun]"); await p.waitForFunction(() => W.scanRes && !W.scanRes.busy, null, { timeout: 60000 });
  assert.equal(await p.evaluate(() => W.scanRes.total), 200);
  await p.waitForFunction(() => W.quotes.get("2330")?.price, null, { timeout: 20000 }); await p.evaluate(() => { setLt("tools"); W.tv = "paper"; renderList(); }); await p.waitForTimeout(300);
  await p.fill("#paCode", "2330"); await p.fill("#paSh", "1000"); await p.click('[data-paside="buy"]'); await p.waitForTimeout(300);
  await p.fill("#paCode", "2330"); await p.selectOption("#paType", "limit"); await p.fill("#paPx", "99999"); await p.click('[data-paside="sell"]'); await p.waitForTimeout(300);
  assert.deepEqual(await p.evaluate(() => [Object.keys(PA().pos), PA().orders.length]), [["2330"], 1]);
  await p.evaluate(() => { W.tv = "journal"; renderList(); }); await p.waitForTimeout(800);
  assert.ok(await p.evaluate(() => JR().length >= 1));
  await p.evaluate(() => { W.tv = "sync"; renderList(); }); await p.waitForTimeout(600); await p.click('#lx [data-sy="new"]'); await p.waitForTimeout(800);
  assert.equal(KV.size, 1);
  await ctx.close(); assert.deepEqual(errs, []);
});
