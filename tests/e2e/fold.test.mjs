// 長內容自動收合：長段落「展開全文」、長清單「展開其餘 N 項」、很長的區塊「展開全部」；重畫後記得展開狀態
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
for (const width of [390, 1280]) test(`長內容收合 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  const html = () => `<section class="mk"><h3>測試文章</h3><p id="lp">${"很長的一段文字，用來測試收合功能。".repeat(60)}</p><ul id="ll">${Array.from({ length: 30 }, (_, i) => `<li>第 ${i + 1} 項</li>`).join("")}</ul><p>短</p></section>`;
  await p.evaluate(h => { const d = document.createElement("div"); d.id = "ft"; d.innerHTML = h; document.body.prepend(d); }, html()); // 自己的區塊，不會被頁面的每秒重畫蓋掉
  await p.waitForSelector("#lp.fold-t + .fold-btn"); await p.waitForSelector("#ll + .fold-btn");
  assert.match(await p.textContent("#ll + .fold-btn"), /展開其餘 22 項/); assert.equal(await p.evaluate(() => [...document.querySelectorAll("#ll li")].filter(x => x.offsetHeight).length), 8);
  assert.equal(await p.evaluate(() => $("#ft").querySelectorAll(".fold-btn").length), 2, "短段落不收、整段區塊收了段落和清單後就不算太長");
  assert.ok(await p.evaluate(() => $("#lp").offsetHeight < $("#lp").scrollHeight));
  await p.click("#lp + .fold-btn"); assert.ok(await p.evaluate(() => $("#lp").offsetHeight >= $("#lp").scrollHeight - 1));
  await p.click("#ll + .fold-btn"); assert.equal(await p.evaluate(() => [...document.querySelectorAll("#ll li")].filter(x => x.offsetHeight).length), 30);
  // 每秒重畫：一樣的內容換成新的元素，展開狀態要保住
  await p.evaluate(h => { $("#ft").innerHTML = h; }, html()); await p.waitForSelector("#lp + .fold-btn");
  assert.equal(await p.evaluate(() => [$("#lp").classList.contains("fold-t"), $("#lp + .fold-btn").textContent, [...document.querySelectorAll("#ll li")].filter(x => x.offsetHeight).length].join()), "false,收合 ▴,30");
  await p.click("#lp + .fold-btn"); assert.ok(await p.evaluate(() => $("#lp").classList.contains("fold-t")));
  await ctx.close(); assert.deepEqual(errs, []);
});
