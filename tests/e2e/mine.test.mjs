// ★ 只看我的自選：財報、法說會、大戶國會共用一個開關；記在瀏覽器，重新整理還在
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const ROWS = [["2330", "台積電", "半導體業", "上市", 3300, 5.1, 36.2, 38.4, 15.2, 9300, 3980, 59.1, 49.5, 42.7], ["2317", "鴻海", "其他電子業", "上市", 7800, -3.2, 12.1, 18.0, 3.1, 18000, 430, 6.2, 2.9, 2.4],
  ["1101", "台泥", "水泥工業", "上市", 143, 6.0, 7.6, 3.3, 0.38, 713, 45.7, 18.2, 7.3, 6.4]];

for (const width of [390, 1280]) test(`★ 只看我的自選：財報、大戶國會一起過濾 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await ctx.route("**/api/oapi?earn=1", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: ROWS }) }));
  await p.evaluate(() => { W.groups = [{ name: "自選", list: ["2330"] }]; W.hold = { "1101": { sh: 1000, cost: 30 } }; store.set("watch:mine", false); W.mine = false; ER().view = "rev"; showList(); setLt("earn"); });
  await p.waitForSelector(".earn .erlist li");
  const names = () => p.$$eval(".earn .erlist .nm", L => L.map(x => x.firstChild.textContent.trim()));
  assert.equal((await names()).length, 3);
  await p.click("#lTools [data-mine]");
  assert.deepEqual((await names()).sort(), ["台泥", "台積電"], "只剩自選（台積電）和庫存（台泥）");
  assert.equal(await p.evaluate(() => store.get("watch:mine")), true, "記在瀏覽器");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "財報沒有橫向溢出");

  // 大戶國會：同一個開關，美國國會只列自選的代號
  const d = new Date().toISOString().slice(0, 10);
  await p.evaluate(d => { W.groups[0].list.push("NVDA"); W.cong = { cutoff: d, people: { a: { name: "Member A", chamber: "眾議院" }, b: { name: "Member B", chamber: "參議院" } },
    trades: ["NVDA", "AAPL", "NVDA", "MSFT"].map((t, i) => ({ ticker: t, asset: t + " Inc", assetType: "股票", k: "buy", owner: "本人", traded: d, filed: d, amount: [1001, 15000], pid: i % 2 ? "b" : "a", doc: "x" })) };
    W.cv = "home"; W.cview = "hot"; setLt("cong"); }, d);
  await p.waitForSelector("#lTools [data-mine]");
  assert.equal(await p.getAttribute("#lTools [data-mine]", "aria-pressed"), "true", "切到大戶國會一樣是開著");
  const tk = () => p.$$eval('#lx [data-cv^="stock:"]', L => [...new Set(L.map(x => x.dataset.cv.slice(6)))]);
  assert.deepEqual(await tk(), ["NVDA"]);
  await p.click("#lTools [data-mine]"); assert.deepEqual((await tk()).sort(), ["AAPL", "MSFT", "NVDA"], "關掉看全部");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "大戶國會沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});
