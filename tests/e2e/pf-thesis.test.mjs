// 投資組合「論點」分頁：持股的近期事件（除權息、法說會、美股財報、論點檢視；只列持股）、寫論點、加檢視紀錄（狀態、下次檢視日）、
// 過期的檢視排最前面、存檔前檢查、備份匯入時用論點模組檢查；手機與桌面不溢出。全部固定假資料（行事曆、美股財報都用 mock）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 900, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const day = n => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10); // 台北日期往後 n 天
async function page(width) {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route("**/api/calendar**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: [{ date: day(12), code: "2330", name: "台積電", kind: "除息", cash: 5 }, { date: day(5), code: "9999", kind: "除息" }], conf: [{ date: day(7), code: "2330", time: "14:00", place: "台北" }], hol: [] }) }));
  await ctx.route("**/data/us-earn.json*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, at: new Date().toISOString(), rows: [[day(10), "NVDA", "NVIDIA", 4000, null, 1.2, null, "盤後", "Q3"], [day(10), "AAPL", "Apple", 3000, null, 2, null, "盤後", "Q4"]] }) }));
  await ctx.route("**/api/oapi?earn=1*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ym: "11510", yq: "115Q3", rows: [["2330", "台積電", "半導體業", "上市", 3000, -5.2, 12.34, 30, 15.2, 8000, 3000, 59.14, 49.5, 43.1], ["2454", "聯發科", "半導體業", "上市", 500, 1, -8, 2, 20, 1500, 300, 48, 20, 18]] }) }));
  await p.evaluate(tx => { localStorage.removeItem("kline:pf:thesis:v1"); W.cal = null; W.thD = null; /* 開頁時大盤可能已經用預設的假資料載入過行事曆 */ store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "thesis" }; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector("#lx .thev, #lx .thsum", { timeout: 30000 });
  await p.waitForFunction(() => /近期事件/.test($("#lx").innerText) && !/載入持股的除權息/.test($("#lx").innerText), null, { timeout: 30000 });
  return { ctx, p, errs };
}
const lx = p => p.evaluate(() => $("#lx").innerText);

for (const width of [390, 1280]) test(`論點分頁 ${width}：近期事件、寫論點、檢視紀錄、過期排前面`, async () => {
  const { ctx, p, errs } = await page(width);
  let t = await lx(p);
  assert.match(t, /已寫論點\s*0\/2/);
  // 逐筆比對事件（不能只找字：底下的說明也有「除權息」「法說會」這些字）
  const ev = await p.evaluate(() => [...document.querySelectorAll("#lx .thev li")].map(li => [li.querySelector(".thd").innerText, li.querySelector(".linkbtn").dataset.sel, li.querySelector(".thk").innerText]));
  assert.deepEqual(ev, [[day(7).slice(5), "2330", "法說會"], [day(10).slice(5), "NVDA", "財報（美股）"], [day(12).slice(5), "2330", "除權息"]]);
  assert.ok(await p.evaluate(() => [...document.querySelectorAll("#lx .thev .thd")].every(e => e.getBoundingClientRect().height < 30)), "日期一行");
  assert.doesNotMatch(t, /9999|Apple|AAPL/, "只列持股");
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  // 寫 2330 的論點
  await p.click('[data-th=edit][data-c="2330"]'); await p.waitForSelector("#thForm");
  await p.fill("#thForm [name=reason]", "先進製程領先、AI 需求"); await p.fill("#thForm [name=watch]", "毛利率\n\n海外廠進度"); await p.fill("#thForm [name=kill]", "毛利率連兩季低於 50%");
  await p.click("#thForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thForm"), null, { timeout: 10000 });
  const s1 = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:thesis:v1")));
  assert.equal(s1.items["2330"].reason, "先進製程領先、AI 需求"); assert.deepEqual(s1.items["2330"].watch, ["毛利率", "海外廠進度"]); assert.equal(s1.items["2330"].status, "hold");
  t = await lx(p); assert.match(t, /已儲存 .*的投資論點/); assert.match(t, /已寫論點\s*1\/2/); assert.match(t, /論點成立/);
  // 加檢視紀錄：狀態改成動搖，下次檢視 90 天後
  await p.click('[data-th=log][data-c="2330"]'); await p.waitForSelector("#thLogForm");
  await p.selectOption("#thLogForm [name=status]", "weak"); await p.fill("#thLogForm [name=note]", "毛利率季減 2 個百分點");
  await p.click("#thLogForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thLogForm"), null, { timeout: 10000 });
  const s2 = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:thesis:v1")).items["2330"]);
  assert.equal(s2.status, "weak"); assert.equal(s2.log.length, 1); assert.equal(s2.review, await p.evaluate(() => KLThesis.addDays(lgToday(), 90)));
  t = await lx(p); assert.match(t, /論點動搖/); assert.match(t, /最近檢視 .*毛利率季減 2 個百分點/); assert.match(t, /論點動搖／失效\s*1／0/);
  // 檢視日改成已過：排在近期事件最前面、標該檢視
  await p.evaluate(d => { const s = JSON.parse(localStorage.getItem("kline:pf:thesis:v1")); s.items["2330"].review = d; localStorage.setItem("kline:pf:thesis:v1", JSON.stringify(s)); renderList(); }, day(-3));
  const first = await p.evaluate(() => $("#lx .thev li").innerText); assert.match(first, /論點檢視/); assert.match(first, /已過 3 天/);
  assert.match(await lx(p), /該檢視\s*1/);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出（有內容後）");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("停損／停利：百分比相對成本、接近與觸及的狀態、設成到價提醒（已觸及的那邊不寫、原本有提醒先確認）", async () => {
  const { ctx, p, errs } = await page(390); // 假報價：2330＝100（成本 900，已跌破）、NVDA＝101（成本 100）
  await p.click('[data-th=edit][data-c="NVDA"]'); await p.waitForSelector("#thForm");
  await p.fill("#thForm [name=reason]", "GPU"); await p.fill("#thForm [name=stop]", "3"); await p.selectOption("#thForm [name=stopMode]", "pct"); await p.fill("#thForm [name=take]", "120");
  await p.click("#thForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thForm"), null, { timeout: 10000 });
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:thesis:v1")).items.NVDA.stop), { mode: "pct", v: -3 }, "停損打 3 存成 −3%");
  await p.click('[data-th=edit][data-c="NVDA"]'); await p.waitForSelector("#thForm");
  assert.ok(await p.evaluate(() => ["stop", "take"].every(n => document.querySelector(`#thForm [name=${n}]`).getBoundingClientRect().width >= 60)), "數字欄位夠寬（不被單位選單擠掉）");
  assert.equal(await p.evaluate(() => $("#thForm [name=stop]").value), "3"); await p.click("#thForm [data-th=close]");
  await p.click('[data-th=edit][data-c="2330"]'); await p.waitForSelector("#thForm");
  await p.fill("#thForm [name=reason]", "製程"); await p.fill("#thForm [name=stop]", "10"); await p.selectOption("#thForm [name=stopMode]", "pct");
  await p.click("#thForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thForm"), null, { timeout: 10000 });
  await p.waitForFunction(() => /接近停損/.test($("#lx").innerText) && /已跌破停損/.test($("#lx").innerText), null, { timeout: 30000 });
  const card = c => p.evaluate(c => [...document.querySelectorAll("#lx .thcard")].find(x => x.querySelector(`[data-sel="${c}"]`)).innerText, c);
  assert.match(await card("NVDA"), /停損 97 美元（-4.0%）＝成本 -3%/); assert.match(await card("NVDA"), /停利 120 美元（\+18.8%）/);
  assert.match(await card("2330"), /已跌破停損\s*停損 810＝成本 -10%/, "已觸及：不顯示距離"); assert.match(await lx(p), /觸及停損／停利\s*1／0/);
  // 2330 已跌破：不設提醒
  await p.click('[data-th=alert][data-c="2330"]'); await p.waitForFunction(() => /現價已經超過停損或停利/.test($("#lx").innerText));
  assert.equal(await p.evaluate(() => W.alerts["2330"] ?? null), null);
  // NVDA 原本有提醒：先確認；取消不改，確定才換
  await p.evaluate(() => { W.alerts.NVDA = { up: 150, dn: null, name: "NVIDIA" }; });
  p.removeAllListeners("dialog"); p.once("dialog", d => d.dismiss()); await p.click('[data-th=alert][data-c="NVDA"]'); await p.waitForTimeout(200);
  assert.deepEqual(await p.evaluate(() => W.alerts.NVDA.up), 150, "取消：不改");
  let msg = ""; p.once("dialog", d => { msg = d.message(); d.accept(); }); await p.click('[data-th=alert][data-c="NVDA"]');
  await p.waitForFunction(() => /已設 .*的到價提醒/.test($("#lx").innerText));
  assert.match(msg, /漲到 150/); const a = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:watch:alerts")).NVDA);
  assert.equal(a.up, 120); assert.equal(a.dn, 97);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, 390), "沒有水平溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`財報指標 ${width}：台股帶入最新指標、要觀察的項目旁邊標目前數字；美股不顯示`, async () => {
  const { ctx, p, errs } = await page(width);
  await p.click('[data-th=edit][data-c="2330"]'); await p.waitForSelector("#thForm");
  await p.fill("#thForm [name=reason]", "製程"); await p.fill("#thForm [name=watch]", "毛利率維持 55% 以上\n海外廠進度\n累計營收年增");
  await p.click("#thForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thForm"), null, { timeout: 10000 });
  await p.waitForFunction(() => document.querySelector("#lx .thkpi b"), null, { timeout: 30000 });
  const card = c => p.evaluate(c => [...document.querySelectorAll("#lx .thcard")].find(x => x.querySelector(`[data-sel="${c}"]`)).innerText, c);
  const t = await card("2330");
  assert.match(t, /最新財報（營收 2026 年 10 月・季報 2026 年第 3 季）/); assert.match(t, /月營收年增 \+12\.3%/); assert.match(t, /EPS 15\.2/); assert.match(t, /營益率 49\.5%/);
  const W2 = await p.evaluate(() => [...[...document.querySelectorAll("#lx .thcard")].find(x => x.querySelector('[data-sel="2330"]')).querySelectorAll(".thgrid li")].map(li => li.innerText));
  assert.deepEqual(W2, ["毛利率維持 55% 以上 目前 59.1%", "海外廠進度", "累計營收年增 目前 +30.0%"], "對到的才標");
  assert.doesNotMatch(await card("NVDA"), /最新財報|財報指標/, "美股不顯示");
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width), "沒有水平溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("停損／停利沒有報價：兩邊都寫進到價提醒、原本的單邊提醒確認後整個換掉；報價回來後每邊只通知一次", async () => {
  const { ctx, p, errs } = await page(390);
  await ctx.route("**/api/quote**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", quotes: [] }) })); // 之後的報價都拿不到
  await p.evaluate(() => { localStorage.setItem("kline:pf:thesis:v1", JSON.stringify({ v: 1, items: { NVDA: { reason: "GPU", stop: { mode: "price", v: 90 }, take: { mode: "price", v: 130 } } } }));
    W.lgAl = null; W.alerts.NVDA = { up: 150, dn: null, name: "NVIDIA" }; renderList(); });
  await p.waitForFunction(() => [...document.querySelectorAll("#lx .thcard")].some(x => x.querySelector('[data-sel="NVDA"]') && /沒有報價/.test(x.innerText)), null, { timeout: 30000 });
  let msg = ""; p.removeAllListeners("dialog"); p.once("dialog", d => { msg = d.message(); d.accept(); });
  await p.click('[data-th=alert][data-c="NVDA"]'); await p.waitForFunction(() => /已設 .*的到價提醒/.test($("#lx").innerText), null, { timeout: 10000 });
  assert.match(msg, /漲到 150/, "原本有提醒：先確認");
  const a = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:watch:alerts")).NVDA);
  assert.deepEqual([a.up, a.dn], [130, 90], "沒有報價：兩邊都寫，原本的 150 被換掉");
  // 報價回來：跌到 88 → 停損提醒觸發一次就清掉；停利還在；再檢查一次不會重複通知
  const n = await p.evaluate(() => { let k = 0; const o = window.notify; window.notify = () => { k++; }; W.quotes.set("NVDA", { code: "NVDA", price: 88, us: true, date: W.today }); checkAlerts(); checkAlerts(); window.notify = o; return k; });
  assert.equal(n, 1, "只通知一次");
  assert.deepEqual(await p.evaluate(() => [W.alerts.NVDA?.dn ?? null, W.alerts.NVDA?.up]), [null, 130]);
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const [kind, fail] of [["連不上", r => r.fulfill({ status: 500, body: "x" })], ["ok:false", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: "來源維護中" }) })]])
  test(`財報指標第一次${kind}：標「拿不到」（不是「不在資料裡」），節流時間到了重抓成功就換成數字`, async () => {
    const { ctx, p, errs } = await page(390);
    await p.waitForFunction(() => document.querySelector("#lx .thkpi b"), null, { timeout: 30000 }); // 開頁那次先載完
    let n = 0; const bad = r => { n++; return fail(r); };
    await ctx.route("**/api/oapi?earn=1*", bad); // 後註冊的先用：先失敗
    await p.evaluate(() => { W.fresh = Date.now() + 36e5; /* 不用快取，真的去問 */ ER().data = null; W.thEF = 0; renderList(); });
    await p.waitForFunction(() => /財報指標這次拿不到/.test($("#lx").innerText), null, { timeout: 30000 });
    const t = await p.evaluate(() => $("#lx").innerText);
    assert.doesNotMatch(t, /不在月營收／季報資料裡/, "來源失敗不能說成這檔沒資料"); assert.match(t, /1 分鐘後自動再試/);
    const n1 = n; await p.evaluate(() => renderList()); await p.waitForTimeout(300); assert.equal(n, n1, "1 分鐘內重畫不重抓");
    await ctx.unroute("**/api/oapi?earn=1*", bad);
    await p.evaluate(() => { W.thEF = Date.now() - 61e3; ER().data.at = Date.now() - 61e3; renderList(); }); // 假裝 1 分鐘過了
    await p.waitForFunction(() => document.querySelector("#lx .thkpi b"), null, { timeout: 30000 });
    assert.match(await p.evaluate(() => $("#lx").innerText), /月營收年增 \+12\.3%/); assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /財報指標這次拿不到/);
    await ctx.close(); assert.deepEqual(errs, []);
  });

test("存檔前檢查擋下太長的內容；備份匯入要用論點模組檢查（沒有檢查程式不匯入）", async () => {
  const { ctx, p, errs } = await page(1280);
  await p.click('[data-th=edit][data-c="2330"]'); await p.waitForSelector("#thForm");
  await p.evaluate(() => { $("#thForm [name=reason]").removeAttribute("maxlength"); $("#thForm [name=reason]").value = "x".repeat(2001); });
  // fromForm 會截到 2000 字：仍然能存（不讓使用者打的字整段消失），但不會超過上限
  await p.click("#thForm button[type=submit]"); await p.waitForFunction(() => !document.querySelector("#thForm"), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:thesis:v1")).items["2330"].reason.length), 2000);
  const r = await p.evaluate(() => {
    const good = JSON.stringify({ v: 1, items: { 2330: { reason: "x", status: "hold" } } }), bad = JSON.stringify({ v: 1, items: { 2330: { status: "爆了" } } });
    return [KLLedger.checkBackup({ "kline:pf:thesis:v1": good }, { thesis: KLThesis }).ok, KLLedger.checkBackup({ "kline:pf:thesis:v1": bad }, { thesis: KLThesis }).ok, KLLedger.checkBackup({ "kline:pf:thesis:v1": good }, {}).ok,
      Object.keys(syncSnap(true)).includes("kline:pf:thesis:v1")];
  });
  assert.deepEqual(r, [true, false, false, true], "好的可以、壞的不行、沒有檢查程式不行；備份檔會帶論點");
  await ctx.close(); assert.deepEqual(errs, []);
});
