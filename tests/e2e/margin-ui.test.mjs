// 交易紀錄 →「融資」：新增帳戶（表單）、維持率、壓力測試、單一擔保品連續跌停、試算聲明與門檻來源；錯誤資料擋下不寫入；刪除要確認；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("融資：新增帳戶、維持率、壓力測試、試算聲明；壞資料擋下", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.evaluate(() => { localStorage.removeItem("kline:pf:margin:v1"); W.lg = { view: "margin" }; W.lgMg = null; W.holdView = "tx"; setLt("hold"); });
    await p.waitForSelector("[data-lg=mgadd]", { timeout: 30000 });
    let t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /不是券商的正式追繳通知/); assert.match(t, /還沒有融資或借款資料/);
    await p.click("[data-lg=mgadd]");
    // 壞資料：借款 0 → 擋下
    await p.fill("#mgForm [name=loan]", "0"); await p.fill("#mgForm [name=collateral]", "2330 1000"); await p.click("#mgForm button[type=submit]");
    t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /借款金額要大於 0/); assert.equal(await p.evaluate(() => localStorage.getItem("kline:pf:margin:v1")), null, "沒有寫入");
    // 正常資料：借 60,000，擔保 2330 1000 股（假報價約 100）→ 維持率約 167%
    await p.fill("#mgForm [name=name]", "我的融資"); await p.fill("#mgForm [name=loan]", "60000"); await p.fill("#mgForm [name=rate]", "6.5"); await p.fill("#mgForm [name=call]", "130"); await p.fill("#mgForm [name=topUpTo]", "166"); await p.fill("#mgForm [name=ruleSource]", "測試券商");
    await p.click("#mgForm button[type=submit]");
    await p.waitForSelector(".mgcard", { timeout: 20000 });
    t = await p.evaluate(() => $("#lx").innerText);
    for (const k of ["我的融資", "自己填的", "維持率", "再跌多少會追繳", "壓力測試", "全部跌 30%", "連三根跌停", "門檻來源：測試券商"]) assert.match(t, new RegExp(k), width + "：" + k);
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:margin:v1"))); assert.equal(st.v, 1); assert.equal(st.accounts[0].loan, 60000); assert.equal(st.accounts[0].rules.call, 1.3);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "：沒有水平溢出");
    // 刪除（harness 自動按確定）
    await p.click("[data-lg=mgdel]"); assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:margin:v1")).accounts.length), 0);
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
