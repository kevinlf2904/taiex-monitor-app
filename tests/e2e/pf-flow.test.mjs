// 第 11 階段整合測試：用畫面操作走完整流程——建立投資組合 → 入金 → 新增買進 → 新增賣出 → 成本與已實現 → 行情（固定假報價）→ 總覽（股票＋現金＝總資產）→ 出金造成負現金 → 績效 → 風險（庫存改用交易紀錄）
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
    await p.selectOption("#lgForm [name=type]", o.type); await p.waitForSelector(`#lgForm [name=${Object.keys(o).filter(k => k !== "type" && k !== "date")[0]}]`);
    for (const [k, v] of Object.entries(o)) if (k !== "type") await p.fill(`#lgForm [name=${k}]`, String(v));
    await p.click("#lgForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#lgForm"), null, { timeout: 10000 }); };
  // 入金 50,160（剛好等於買進 90,020 − 賣出拿回 39,860，最後現金是 0）
  await add({ type: "deposit", date: "2026-01-02", amount: 50160 });
  await add({ type: "buy", date: "2026-01-05", symbol: "2330", shares: 1000, price: 90, fee: 20, tax: 0 });
  // 3. 賣出 400 股 @ 100，手續費 20、稅 120
  await add({ type: "sell", date: "2026-02-02", symbol: "2330", shares: 400, price: 100, fee: 20, tax: 120 });
  // 4. 成本與已實現：平均成本 (90,000 + 20) ÷ 1,000 ＝ 90.02；已實現 (40,000 − 20 − 120) − 400 × 90.02 ＝ 3,852
  const st = await p.evaluate(() => { const S = JSON.parse(localStorage.getItem("kline:pf:v1")), L = KLLedger.buildLedger(S.transactions, { method: S.method }), q = L.positions[0]; return { n: S.transactions.length, sh: q.shares, avg: q.avgCost, real: L.totals.TWD.realizedPnl, txt: $("#lx").innerText }; });
  assert.equal(st.n, 3); assert.equal(st.sh, 600); assert.ok(Math.abs(st.avg - 90.02) < 1e-9); assert.equal(st.real, 3852);
  assert.match(st.txt, /均價 90\.02/); assert.match(st.txt, /已實現損益\s*\+?3,852/);
  // 5～6. 行情（固定假報價 2330 = 100）→ 總覽：股票 60,000＋現金 0＝總資產 60,000；累積損益＝已實現 3,852＋未實現 600×(100−90.02)＝5,988 → 9,840
  await p.click("[data-lg=view][data-v=home]"); await p.waitForSelector(".hmcard .pftile", { timeout: 30000 });
  const sum = () => p.evaluate(() => { const S = JSON.parse(localStorage.getItem("kline:pf:v1")), L = KLLedger.buildLedger(S.transactions, { method: S.method }); return { O: KLOverview.summarize(L, W.lgAl.px, { today: "2026-11-06" }), txt: $(".hmcard").innerText }; });
  let h = await sum();
  assert.equal(h.O.stocks, 60000); assert.equal(h.O.cash, 0); assert.equal(h.O.cashTracked, true); assert.equal(h.O.total, 60000); assert.equal(h.O.cumulative.base, 9840);
  assert.match(h.txt, /總資產（台幣）\s*\$?60,000/); assert.match(h.txt, /累積損益\s*\+\$?9,840/);
  assert.match(h.txt, /現金比例\s*0\.0%\s*交易紀錄裡的入金扣掉買賣/, "有記入金、現金剛好是 0：不能說「沒有記入出金」");
  // 負現金：出金 1,000 → 現金 −1,000、總資產扣成 59,000，並標示
  await p.click("[data-lg=view][data-v=tx]"); await add({ type: "withdraw", date: "2026-02-03", amount: 1000 });
  await p.click("[data-lg=view][data-v=home]"); await p.waitForSelector(".hmcard .pftile", { timeout: 30000 }); h = await sum();
  assert.equal(h.O.cash, -1000); assert.equal(h.O.total, 59000); assert.match(h.txt, /總資產（台幣）\s*\$?59,000/); assert.match(h.txt, /現金餘額是負的/);
  // 7. 績效
  await p.click("[data-lg=view][data-v=perf]"); await p.waitForSelector(".pfcard", { timeout: 30000 }); assert.match(await p.evaluate(() => $("#lx").innerText), /台股（台幣）/);
  // 8. 風險（庫存分頁改用交易紀錄的持股）
  await p.evaluate(() => { W.holdView = "risk"; W.holdMkt = "tw"; renderList(); });
  await p.waitForFunction(() => W.holdLg && W.hold["2330"]?.sh === 600, null, { timeout: 15000 });
  assert.match(await p.evaluate(() => $("#lTools").innerText), /持股來自交易紀錄（4 筆交易）/);
  // 9. 匯出備份
  await p.evaluate(() => { W.tv = "sync"; setLt("tools"); }); await p.waitForSelector('#lx [data-sy="export"]', { timeout: 20000 });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#lx [data-sy="export"]')]);
  const file = readFileSync(await dl.path(), "utf8"), j = JSON.parse(file);
  assert.equal(JSON.parse(j.data["kline:pf:v1"]).transactions.length, 4, "備份檔裡有四筆交易");
  // 10. 清掉資料（模擬換手機），11. 還原備份
  await p.evaluate(() => localStorage.removeItem("kline:pf:v1"));
  await p.setInputFiles("#lx input[data-syfile]", { name: "backup.json", mimeType: "application/json", buffer: Buffer.from(file) });
  await p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length === 4; } catch { return false; } }, null, { timeout: 15000 });
  const back = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.deepEqual(back, JSON.parse(j.data["kline:pf:v1"]), "還原後的交易紀錄和備份前一模一樣");
  await ctx.close(); assert.deepEqual(errs, []);
});
