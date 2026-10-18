// 這一版新增：美股個股「財務」分頁（公司與指標、營收與獲利、分析師與財報）、台股大盤卡片的分時走勢線、動能矩陣「今日」
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`美股個股財務分頁、大盤走勢線、動能矩陣今日 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => { select("AAPL"); setDtab("fin"); }); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => $('#dTabs [data-t="fin"]').hidden), false);
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#sxNav [data-dsub]")].map(b => b.textContent)), ["公司與指標", "營收與獲利", "分析師與財報"]);
  await p.waitForFunction(() => /Apple Inc/.test($("#sxBox").innerText), null, { timeout: 15000 });
  assert.match(await p.evaluate(() => $("#sxBox").innerText), /市值[\s\S]*3,?500B|市值[\s\S]*3.5/);
  assert.match(await p.evaluate(() => $("#sxBox").innerText), /毛利率[\s\S]*46.5%/);
  await p.click('#sxNav [data-dsub="usfin"]'); await p.waitForTimeout(200);
  assert.match(await p.evaluate(() => $("#sxBox").innerText), /2026Q2[\s\S]*94B/);
  await p.click('#sxNav [data-dsub="usana"]'); await p.waitForTimeout(200);
  assert.match(await p.evaluate(() => $("#sxBox").innerText), /43 位分析師[\s\S]*強力買進 12/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // 美股指數、台股個股不受影響
  await p.evaluate(() => select("2330")); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => $('#dTabs [data-t="fin"]').textContent), "財務");
  // 台股大盤卡片：加權、櫃買、台指近都有走勢線（時間軸固定，所以 11:30 的點不會畫到最右邊）
  await p.evaluate(() => { showList?.(); setLt("mkt"); W.mkReg = "tw"; renderList(); });
  await p.waitForFunction(() => document.querySelectorAll("#mkCards .spark.tsp").length >= 3, null, { timeout: 15000 });
  const last = await p.evaluate(() => { const pl = document.querySelector('#mkCards [data-sel="T00"] .tsp polyline'); return +pl.getAttribute("points").trim().split(" ").at(-1).split(",")[0]; });
  assert.ok(last > 40 && last < 60, `11:30 應該在 09:00–13:30 的中間：${last}`);
  // 動能矩陣：近 5 日／今日切換，記住選擇
  await p.evaluate(() => { const A = ["up", "rot", "watch", "down"].map((q, i) => ({ id: "s" + i, name: "板塊" + i, kind: "產業", n: 5, q, q1: ["down", "watch", "rot", "up"][i], net1: (i - 1.5) * 1e8, prev1: 0, accel1: (i - 1.5) * 1e8, net5: (i + 1) * 1e9, prev5: 0, accel: 1e8, pct1: 0.5, pct5: 1, f1: 0, tr1: 0, f5: 0, tr5: 0, buy1: 2, buy5: 3 }));
    W.mf.days = [{ date: "2026-10-16", rows: [] }]; W.mf.model = { T: 1, dates: ["2026-10-16"] }; window.flowAt = () => A; window.flowStocks = () => []; window.flowMood = () => null; setLt("money"); W.mf.view = "bubble"; renderList(); });
  await p.click('[data-mset="bw"][data-v="1"]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => W.mf.bw), "1");
  assert.match(await p.evaluate(() => $("#lx").innerText), /只畫今日金額最大/);
  assert.equal(await p.evaluate(() => store.get("watch:mfbw")), "1");
  await p.click('#mfb [data-mbs="s0"]'); await p.waitForTimeout(200);
  assert.match(await p.evaluate(() => $("#lx .binfo").innerText), /今日淨流入[\s\S]*前一日/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});
