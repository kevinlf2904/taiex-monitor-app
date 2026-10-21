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
  assert.match(await p.evaluate(() => $("#lx").innerText), /薩姆規則[\s\S]*最近的變化可能對股市造成的影響[\s\S]*美元兌日圓[\s\S]*套利交易[\s\S]*失業率[\s\S]*世界總經/);
  assert.match(await p.evaluate(() => $("#lx").textContent), /景氣循環位置[\s\S]*衰退警訊清單[\s\S]*全部指標的歷史位置與方向/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.click('#lx [data-mk="mkReg"][data-v="poly"]'); await p.waitForFunction(() => document.querySelector("#lx .pmrows"));
  assert.match(await p.evaluate(() => $("#lx").textContent), /聯準會利率路徑[\s\S]*降息機率 85%[\s\S]*資金注意力分布/);
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

test("每日總經消息", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  const it = (title, topic, h) => ({ title, source: "測試報", link: "https://example.com/" + encodeURIComponent(title), at: Date.parse("2026-10-17T00:00:00Z") - h * 3600e3, topic });
  const day = (date, sum) => ({ date, at: Date.parse(date + "T00:00:00Z"), by: sum ? "m" : null, tw: { sum: sum ? { head: "央行按兵不動", points: ["外銷訂單年增"], impact: "可能支撐電子股" } : null, items: [it("央行利率決議維持不變", "利率", 1), it("9 月外銷訂單創高", "貿易", 2)] }, us: { sum: null, items: [it("美國 CPI 高於預期", "通膨", 3)] }, world: { sum: null, items: [it("日本央行升息 日圓走強", "利率", 4)] } });
  await ctx.route("**/data/macro-news.json", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: 1, days: [day("2026-10-17", true), day("2026-10-16", false)] }) }));
  await p.evaluate(() => setLt("mkt")); await p.waitForTimeout(500);
  await p.click('#lx [data-mk="mkReg"][data-v="news"]'); await p.waitForSelector("#lx .mn-sum");
  const txt = await p.evaluate(() => $("#lx").innerText);
  assert.match(await p.evaluate(() => $("#lx").textContent), /主題熱度[\s\S]*新聞語氣/);
  assert.match(txt, /央行按兵不動[\s\S]*可能影響[\s\S]*外銷訂單創高[\s\S]*美國總經[\s\S]*CPI 高於預期[\s\S]*世界總經[\s\S]*日本央行升息/);
  await p.click('#lx [data-mk="mnDay"][data-v="2026-10-16"]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .mn-sum").length), 0);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await p.evaluate(() => store.get("watch:mkReg")), "news");
  await ctx.close(); assert.deepEqual(errs, []);
});
