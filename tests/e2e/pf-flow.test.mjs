// 第 11 階段整合測試：用畫面操作走完整流程——建立投資組合 → 新增買進 → 新增賣出 → 成本與已實現 → 行情（固定假報價）→ 總覽損益 → 績效 → 風險（庫存改用交易紀錄）
// → 匯出備份 → 清掉資料 → 還原備份 → 資料完全回來。固定假資料，不連外部服務
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("完整流程：建立 → 買 → 賣 → 成本 → 行情 → 損益 → 績效 → 風險 → 備份 → 還原", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { localStorage.removeItem("kline:pf:v1"); localStorage.removeItem("kline:watch:hold"); W.hold = {}; W.holdOwn = W.hold; W.lg = null; W.holdView = "tx"; setLt("hold"); });
  // 1. 建立空白的交易紀錄
  await p.click("[data-lg=blank]"); await p.waitForSelector("[data-lg=add]", { timeout: 20000 });
  // 2. 買進 2330 1,000 股 @ 90，手續費 20
  const add = async (o) => { await p.click("[data-lg=add]"); await p.waitForSelector("#lgForm");
    await p.selectOption("#lgForm [name=type]", o.type); await p.waitForSelector("#lgForm [name=shares]");
    for (const [k, v] of Object.entries(o)) if (k !== "type") await p.fill(`#lgForm [name=${k}]`, String(v));
    await p.click("#lgForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#lgForm"), null, { timeout: 10000 }); };
  await add({ type: "buy", date: "2026-01-05", symbol: "2330", shares: 1000, price: 90, fee: 20, tax: 0 });
  // 3. 賣出 400 股 @ 100，手續費 20、稅 120
  await add({ type: "sell", date: "2026-02-02", symbol: "2330", shares: 400, price: 100, fee: 20, tax: 120 });
  // 4. 成本與已實現：平均成本 (90,000 + 20) ÷ 1,000 ＝ 90.02；已實現 (40,000 − 20 − 120) − 400 × 90.02 ＝ 3,852
  const st = await p.evaluate(() => { const S = JSON.parse(localStorage.getItem("kline:pf:v1")), L = KLLedger.buildLedger(S.transactions, { method: S.method }), q = L.positions[0]; return { n: S.transactions.length, sh: q.shares, avg: q.avgCost, real: L.totals.TWD.realizedPnl, txt: $("#lx").innerText }; });
  assert.equal(st.n, 2); assert.equal(st.sh, 600); assert.ok(Math.abs(st.avg - 90.02) < 1e-9); assert.equal(st.real, 3852);
  assert.match(st.txt, /均價 90\.02/); assert.match(st.txt, /已實現損益\s*\+?3,852/);
  // 5～6. 行情（固定假報價 2330 = 100）→ 總覽：總資產、累積損益（已實現 3,852 ＋ 未實現 600×(100−90.02)＝5,988 → 9,840）
  await p.click("[data-lg=view][data-v=home]"); await p.waitForSelector(".hmcard .pftile", { timeout: 30000 });
  const home = await p.evaluate(() => $(".hmcard").innerText);
  assert.match(home, /總資產（台幣）\s*\$?60,000/); assert.match(home, /累積損益\s*\+\$?9,840/);
  // 7. 績效
  await p.click("[data-lg=view][data-v=perf]"); await p.waitForSelector(".pfcard", { timeout: 30000 }); assert.match(await p.evaluate(() => $("#lx").innerText), /台股（台幣）/);
  // 8. 風險（庫存分頁改用交易紀錄的持股）
  await p.evaluate(() => { W.holdView = "risk"; W.holdMkt = "tw"; renderList(); });
  await p.waitForFunction(() => W.holdLg && W.hold["2330"]?.sh === 600, null, { timeout: 15000 });
  assert.match(await p.evaluate(() => $("#lTools").innerText), /持股來自交易紀錄（2 筆交易）/);
  // 9. 匯出備份
  await p.evaluate(() => { W.tv = "sync"; setLt("tools"); }); await p.waitForSelector('#lx [data-sy="export"]', { timeout: 20000 });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#lx [data-sy="export"]')]);
  const file = readFileSync(await dl.path(), "utf8"), j = JSON.parse(file);
  assert.equal(JSON.parse(j.data["kline:pf:v1"]).transactions.length, 2, "備份檔裡有兩筆交易");
  // 10. 清掉資料（模擬換手機），11. 還原備份
  await p.evaluate(() => localStorage.removeItem("kline:pf:v1"));
  await p.setInputFiles("#lx input[data-syfile]", { name: "backup.json", mimeType: "application/json", buffer: Buffer.from(file) });
  await p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length === 2; } catch { return false; } }, null, { timeout: 15000 });
  const back = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.deepEqual(back, JSON.parse(j.data["kline:pf:v1"]), "還原後的交易紀錄和備份前一模一樣");
  await ctx.close(); assert.deepEqual(errs, []);
});
