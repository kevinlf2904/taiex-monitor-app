// 清單上方的「↻ 更新」：按下後顯示「更新中…」、好了跳「已更新」，而且真的重抓（不拿本機快取裡 30 分鐘前存的官方公告）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`更新鍵有反應、會重抓 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  let n = 0;
  await ctx.route(/\/api\/oapi\?official=1/, async r => { n++; await new Promise(x => setTimeout(x, 400)); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, at: new Date().toISOString(), source: "測試", miss: [], news: [] }) }); });
  await p.reload(); await p.waitForTimeout(600); // 假資料要在開頁前掛好（電腦版開頁時個股徽章就會抓一次）
  await p.evaluate(() => { showList(); W.mkReg = "off"; setLt("mkt"); }); await p.waitForFunction(() => W.offc && !W.offBusy);
  const n0 = n; assert.ok(n0 >= 1);
  const btn = '#lTools [data-gx="mktRefresh"]';
  await (width < 500 ? p.tap(btn) : p.click(btn));
  await p.waitForFunction(() => /更新中/.test(document.querySelector('#lTools [data-gx="mktRefresh"]')?.textContent || "")); // 按下去馬上看得到在更新
  await p.waitForFunction(() => /已更新/.test(document.getElementById("toast").textContent) && !document.getElementById("toast").hidden);
  assert.equal(n, n0 + 1, "有重新問伺服器，不是拿本機快取");
  assert.match(await p.textContent(btn), /↻ 更新$/); assert.equal(await p.$eval(btn, b => b.disabled), false);
  // 選股、資金流向的更新鍵也一樣
  await p.evaluate(() => setLt("screen")); await p.waitForTimeout(300);
  for (const k of ["scrRefresh"]) { const s = `#lTools [data-gx="${k}"]`; if (!(await p.$(s))) continue; await p.$eval(s, b => b.click()); await p.waitForFunction(() => /已更新/.test(document.getElementById("toast").textContent)); }
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`美股大盤「今天為什麼跌」：指數、盤勢頭條、每小時總經摘要、AI 整理 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) }), now = Date.now(), day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  await ctx.route("**/api/usmarket", r => J(r, { ok: true, date: "2026-10-22", session: "open", source: "測試", indices: [{ code: "^GSPC", name: "S&P 500", price: 5800, chg: -120, chgPct: -2.1 }, { code: "^IXIC", name: "那斯達克", price: 18000, chg: -560, chgPct: -3.0 }], sectors: [{ code: "XLK", name: "科技", chgPct: -3.5 }], megas: [{ code: "NVDA", name: "輝達", price: 120, chgPct: -5 }], macro: [] }));
  await ctx.route("**/api/news**", r => J(r, { ok: true, items: [{ title: "美股重挫 那斯達克跌3% 晶片股遭拋售", source: "測試報", link: "https://example.com/a", at: now - 1800e3 }] }));
  await ctx.route("**/data/macro-news.json", r => J(r, { updated: now, days: [{ date: day, at: now, us: { sum: { head: "通膨高於預期，降息延後，美股重挫", points: [], impact: "科技股承壓" }, items: [{ title: "美國CPI高於預期 美股大跌", topic: "盤勢", source: "測試", link: "https://example.com/b", at: now - 600e3 }] }, tw: { items: [] } }] }));
  await p.evaluate(() => { showList(); W.mkReg = "us"; setLt("mkt"); });
  await p.waitForFunction(() => /晶片股遭拋售/.test(document.querySelector("#lx .uswhy")?.innerText || ""));
  const t = await p.textContent("#lx .uswhy");
  assert.match(t, /美股今天為什麼跌？/); assert.match(t, /那斯達克 -3\.00%/); assert.match(t, /通膨高於預期，降息延後/); assert.match(t, /CPI高於預期 美股大跌/);
  await p.click('#lx .uswhy [data-qai="uswhy"]'); await p.waitForFunction(() => /測試回覆/.test(document.querySelector("#lx .uswhy")?.innerText || ""));
  if (process.env.SHOT) await p.locator("#lx .uswhy").screenshot({ path: `${process.env.SHOT}/uswhy-${width}.png` });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "不橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});
