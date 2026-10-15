// 大盤：總經、預測市場、原物料外匯點進去看走勢
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [1280, 390]) test(`總經與預測市場 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => setLt("mkt")); await p.waitForTimeout(600);
  await p.click('#lx [data-mk="mkReg"][data-v="macro"]'); await p.waitForFunction(() => document.querySelector("#lx .mcsig"));
  assert.match(await p.evaluate(() => $("#lx").innerText), /薩姆規則[\s\S]*失業率/);
  await p.click('#lx [data-mk="mkReg"][data-v="poly"]'); await p.waitForFunction(() => document.querySelector("#lx .pmrows"));
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .mk.pm").length), 2);
  await p.click('#lx [data-mk="pmCat"][data-v="台海與地緣政治"]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .mk.pm").length), 1);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.click('#lx [data-mk="mkReg"][data-v="gl"]'); await p.waitForSelector('#lx [data-sel="CL=F"]');
  assert.equal(await p.evaluate(() => document.querySelectorAll('#lx [data-sel="TWD=X"], #lx [data-sel="DX-Y.NYB"]').length), 2);
  await p.click('#lx [data-sel="CL=F"]'); await p.waitForTimeout(800);
  assert.equal(await p.evaluate(() => W.sel), "CL=F"); assert.match(await p.evaluate(() => nameOf("CL=F")), /原油/);
  await ctx.close(); assert.deepEqual(errs, []);
});
