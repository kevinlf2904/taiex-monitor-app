// 資金雷達的「今日」併進情報局「今日市場」盤後的資金雷達卡：資金雷達只剩動能矩陣、排行；舊的「今日」設定、網址、按鈕都帶到今日市場盤後；卡片裡的板塊、個股、回放都能點
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, watchFrame } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

// 假的法人資金資料（和 matrix-zoom、us 測試一樣直接換掉 flowAt、flowStocks、flowMood）
const fake = p => p.evaluate(() => {
  const sec = (id, name, net1, net5) => ({ id, name, kind: "產業", n: 3, q: "up", q1: "up", net1, prev1: 0, accel1: 0, net5, prev5: 0, accel: 0, pct1: 1, pct5: 2, f1: 0, tr1: 0, f5: 0, tr5: 0, buy1: 2, buy5: 2 });
  const A = [sec("s1", "半導體", 30, 80), sec("s2", "散熱", 12, 5), sec("s3", "航運", -20, -3), sec("s4", "金融", -8, 40)];
  const mem = c => ({ code: c, name: "股" + c, pct: [1], px: [100], amt: [3], f: [1], tr: [1] });
  W.mf.days = [{ date: "2026-10-26", rows: [] }];
  W.mf.model = { T: 1, dates: ["2026-10-26"], secs: A.map(x => ({ id: x.id, name: x.name, kind: "產業", mem: [mem("2330"), mem("2454")] })), stocks: [] };
  window.flowAt = () => A;
  window.flowStocks = () => [{ code: "2330", name: "台積電", a1: 25, mult: 4, a5: 30, f1: 20, tr1: 5, pct1: 1 }, { code: "2603", name: "長榮", a1: -15, mult: 1, a5: -10, f1: -10, tr1: -5, pct1: -2 }];
  window.flowMood = () => ({ score: 64, label: "偏樂觀", up: 600, dn: 300, lu: 12, ld: 2, net: 20, parts: [["漲跌家數", 0.33], ["法人", 0.2]] });
});

for (const [width, theme] of [[390, "dark"], [1280, "light"]]) test(`今日市場盤後的資金雷達卡：情緒、今天與近 5 日買最多、大戶異常、回放都在；資金雷達沒有「今日」 ${width} ${theme}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.clock.setFixedTime(new Date("2026-10-26T15:00:00+08:00"));
  await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await fake(p);
  await p.evaluate(() => { W.tdPh = { d: twDay(), ph: "post" }; setLt("today"); renderList(); });
  await p.waitForSelector("#lx .dh-card.flows", { timeout: 15000 });
  const t = await p.evaluate(() => $("#lx .dh-card.flows").innerText);
  assert.match(t, /法人情緒 64 分・偏樂觀/); assert.match(t, /情緒怎麼算的/);
  assert.match(t, /今天法人買最多的板塊：\s*半導體[\s\S]*散熱/); assert.match(t, /今天法人賣最多的板塊：\s*航運[\s\S]*金融/);
  assert.match(t, /近 5 日法人買超最多：\s*半導體[\s\S]*金融[\s\S]*散熱/); assert.match(t, /大戶異常（法人單日買賣金額最大）：\s*台積電[\s\S]*長榮/);
  assert.match(t, /主力資金雷達回放/); assert.match(t, /盤後總結/);
  assert.equal(await p.$$eval("#lx .dh-card.flows .mbar", L => L.length), 1, "情緒刻度");
  assert.equal(await p.$$eval("#lx", L => (L[0].innerText.match(/資金雷達・板塊輪動與資金流向/g) || []).length), 1, "資金卡只有一張");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  // 資金雷達只剩動能矩陣、排行
  await p.evaluate(() => setLt("money")); await p.waitForSelector("#lx .scrseg");
  assert.deepEqual(await p.$$eval("#lx .scrseg [data-mv]", L => L.map(b => b.textContent.trim())), ["動能矩陣", "排行"]);
  assert.equal(await p.evaluate(() => W.mf.view), "bubble");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("卡片裡的板塊、個股、回放、前往資金雷達都能點；板塊細節的返回回到動能矩陣 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.clock.setFixedTime(new Date("2026-10-26T15:00:00+08:00")); await fake(p);
  const post = () => p.evaluate(() => { W.tdPh = { d: twDay(), ph: "post" }; setLt("today"); renderList(); });
  await post(); await p.waitForSelector("#lx [data-tdsec]");
  await p.click('#lx [data-tdsec="s1"]'); await p.waitForFunction(() => W.lt === "money" && W.mf.view === "sector" && W.mf.sec === "s1");
  assert.match(await p.evaluate(() => $("#lx .gback").innerText), /返回[\s\S]*半導體/);
  await p.click("#lx .gback [data-mv]"); await p.waitForFunction(() => W.mf.view === "bubble");
  await post(); await p.waitForSelector('#lx [data-tdgo="replay"]'); await p.click('#lx [data-tdgo="replay"]');
  await p.waitForFunction(() => W.lt === "money" && W.mf.view === "bubble");
  await p.evaluate(() => mfPlay(false));
  await post(); await p.waitForSelector('#lx .dh-card.flows [data-sel="2330"]'); await p.click('#lx .dh-card.flows [data-sel="2330"]');
  await p.waitForFunction(() => W.sel === "2330");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("舊的「今日」：存過的設定改看動能矩陣（不改寫）、#radar/today 與大盤的「法人資金」都帶到今日市場盤後 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => localStorage.setItem("kline:watch:mfv", JSON.stringify("today")));
  await p.reload(); await p.waitForFunction(() => typeof W !== "undefined" && typeof setLt === "function");
  assert.equal(await p.evaluate(() => W.mf.view), "bubble"); assert.equal(await p.evaluate(() => localStorage.getItem("kline:watch:mfv")), JSON.stringify("today"), "沒有改寫使用者存的值");
  await p.evaluate(() => applyRoute("radar/today")); await p.waitForFunction(() => W.lt === "today");
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#lx details.dh-sec[open]")].map(d => d.dataset.tdbox)), ["live", "flow", "post"], "展開盤後整理、資金雷達與收盤驗證");
  await p.evaluate(() => { setLt("money"); W.tdPh = null; }); await p.evaluate(() => { const b = document.createElement("button"); b.dataset.mv = "today"; $("#lx").append(b); b.click(); });
  await p.waitForFunction(() => W.lt === "today" && W.tdPh?.ph === "post");
  await ctx.close(); assert.deepEqual(errs, []);
  // 首頁網址 #radar/today
  const r = await open(B, S.url, "index.html#radar/today", { width: 390, touch: true }), f = await watchFrame(r.p);
  await f.waitForFunction(() => W.lt === "today" && W.tdPh?.ph === "post");
  await r.ctx.close(); assert.deepEqual(r.errs, []);
});
