// ETF 個股頁：「ETF」分頁（基本資料、成分股、成分股變動），沒有營收、財報、健檢這些個股才有的子頁
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`ETF 分頁 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => { select("0050"); setDtab("fin"); }); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => $('#dTabs [data-t="fin"]').textContent), "ETF");
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#sxNav [data-dsub]")].map(b => b.textContent)), ["基本資料", "成分股", "成分股變動", "配息"]);
  await p.waitForFunction(() => /測試投信/.test($("#sxBox").innerText), null, { timeout: 15000 });
  assert.match(await p.evaluate(() => $("#sxBox").innerText), /規模[\s\S]*半年配[\s\S]*半導體/);
  await p.click('#sxNav [data-dsub="etfhold"]'); await p.waitForTimeout(200);
  assert.match(await p.evaluate(() => $("#sxBox").innerText), /3 檔[\s\S]*台積電[\s\S]*56.6%/);
  await p.click('#sxNav [data-dsub="etfchg"]'); await p.waitForTimeout(300);
  assert.match(await p.evaluate(() => $("#sxBox").innerText), /納入[\s\S]*奇鋐[\s\S]*剔除[\s\S]*台泥[\s\S]*每月權重增減[\s\S]*聯發科/);
  // 總覽沒有健檢、評價推估、產業鏈
  await p.evaluate(() => setDtab("ovw")); await p.waitForTimeout(200);
  const ov = await p.evaluate(() => [...document.querySelectorAll("#sxNav [data-dsub]")].map(b => b.textContent).join(","));
  assert.ok(!/健檢|評價推估|屬性與產業鏈/.test(ov), ov);
  // 美股 ETF 也有 ETF 分頁；一般個股還是「財務」
  await p.evaluate(() => select("SPY")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => $('#dTabs [data-t="fin"]').hidden), false);
  await p.evaluate(() => select("2330")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => $('#dTabs [data-t="fin"]').textContent), "財務");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});
