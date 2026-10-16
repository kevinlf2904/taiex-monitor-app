// 庫存：扣手續費與交易稅、含息（已領股息）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("庫存費稅與股息", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { W.hold = { 2330: { sh: 1000, cost: 90, d: "2025-06-01" }, "0050": { sh: 2000, cost: 80 } }; W.holdMkt = "tw"; setLt("hold"); });
  await p.waitForFunction(() => W.quotes.get("2330")?.price && W.hdivs?.["2330"], null, { timeout: 20000 });
  const base = await p.evaluate(() => holdPnL("2330", W.quotes.get("2330")));
  await p.click('#lTools [data-hopt="hfee"]'); await p.waitForTimeout(200);
  const fee = await p.evaluate(() => { const q = W.quotes.get("2330"), r = holdPnL("2330", q), mv = 1000 * q.price; return { r, exp: Math.max(20, Math.round(90000 * 0.001425)) + Math.max(20, Math.round(mv * 0.001425)) + Math.round(mv * 0.003) }; });
  assert.equal(fee.r.fee + fee.r.tax, fee.exp); assert.ok(Math.abs(base.pnl - fee.r.pnl - fee.exp) < 1e-6);
  const etfTax = await p.evaluate(() => { const q = W.quotes.get("0050"); return [holdPnL("0050", q).tax, Math.round(2000 * q.price * 0.001)]; }); assert.equal(etfTax[0], etfTax[1]);
  await p.click('#lTools [data-hopt="hdiv"]'); await p.waitForTimeout(200);
  const dv = await p.evaluate(() => [holdPnL("2330", W.quotes.get("2330")).dv, holdDiv("0050", W.hold["0050"])]);
  assert.equal(dv[0], 5500); assert.equal(dv[1].got, null); assert.equal(dv[1].yr, 10000);
  assert.match(await p.evaluate(() => $("#lx").innerText), /已領股息[\s\S]*5,500/);
  await ctx.close(); assert.deepEqual(errs, []);
});
