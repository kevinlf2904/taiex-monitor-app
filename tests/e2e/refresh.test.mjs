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
