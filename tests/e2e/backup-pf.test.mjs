// 備份檔與投資組合：交易紀錄超過 150KB 也會帶進備份檔、雲端同步帶不到要提醒；匯入前檢查交易紀錄（壞資料整份不匯入、這台資料不變）；交易紀錄可以匯出 CSV。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const big = () => ({ v: 1, method: "avg", transactions: Array.from({ length: 400 }, (_, i) => ({ id: "t" + i, v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1, price: 100, fee: 0, tax: 0, note: "x".repeat(450) })) });

test("備份檔：大的交易紀錄也帶進去、雲端同步提醒；壞的投資組合資料整份不匯入", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(s => { localStorage.setItem("kline:pf:v1", JSON.stringify(s)); W.tv = "sync"; setLt("tools"); }, big());
  await p.waitForSelector('#lx [data-sy="export"]', { timeout: 20000 });
  assert.match(await p.evaluate(() => $("#lx").innerText), /交易紀錄或融資資料超過 150KB，雲端同步不會帶到/);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#lx [data-sy="export"]')]);
  const j = JSON.parse(readFileSync(await dl.path(), "utf8"));
  assert.equal(j.v, 2); assert.ok(j.data["kline:pf:v1"].length > 150000, "超過 150KB 的交易紀錄也在備份檔裡"); assert.equal(JSON.parse(j.data["kline:pf:v1"]).transactions.length, 400);
  // 壞資料：賣超的交易紀錄 → 整份不匯入（自選也不能被蓋掉）
  const before = await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:watch:groups")]);
  const bad = { app: "kline-school", v: 2, at: "2026-11-05T00:00:00Z", data: { "kline:watch:groups": JSON.stringify([{ name: "被蓋掉", list: [] }]), "kline:pf:v1": JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "s", v: 1, date: "2026-01-05", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 10, price: 1, fee: 0, tax: 0 }] }) } };
  await p.setInputFiles("#lx input[data-syfile]", { name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
  await p.waitForFunction(() => /投資組合資料有問題，沒有匯入/.test(document.body.innerText), null, { timeout: 15000 });
  assert.deepEqual(await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:watch:groups")]), before, "這台的資料維持原樣");
  // 版本太新也不匯入
  await p.setInputFiles("#lx input[data-syfile]", { name: "new.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...bad, v: 9 })) });
  await p.waitForFunction(() => /版本 9 比這個網站新/.test(document.body.innerText), null, { timeout: 15000 });
  await ctx.close(); assert.deepEqual(errs, []);
});

test("交易紀錄匯出 CSV", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 10, price: 100, fee: 0, tax: 0, note: "第一筆" }] })); W.lg = { view: "tx" }; W.holdView = "tx"; setLt("hold"); });
  await p.waitForSelector("[data-lg=csv]", { timeout: 20000 });
  await p.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return c.call(this); }; }); // 無頭瀏覽器的 blob 下載檔名一律是 download，直接看 <a download>
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-lg=csv]")]);
  const csv = readFileSync(await dl.path(), "utf8");
  assert.match(await p.evaluate(() => window.__dlName), /^交易紀錄-\d{4}-\d{2}-\d{2}\.csv$/); assert.ok(csv.startsWith("﻿日期,類型,代號")); assert.match(csv, /2026-01-05,買進,2330,tw,TWD,10,100,/);
  assert.match(await p.evaluate(() => $("#lx").innerText), /已匯出 1 筆交易（CSV）/);
  // 沒有交易：不下載空檔，提示一句
  await p.evaluate(() => { localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [], at: "x" })); window.__dlName = null; renderList(); });
  await p.click("[data-lg=csv]"); await p.waitForFunction(() => /還沒有交易，沒有東西可以匯出/.test($("#lx").innerText), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => window.__dlName), null, "沒有觸發下載");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("融資資料匯入：沒開過融資頁（KLMargin 還沒載入）也用完整檢查——壞帳戶整份拒絕、資料不變；正確的帳戶可以匯入", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { localStorage.setItem("kline:pf:margin:v1", JSON.stringify({ v: 1, accounts: [{ id: "keep", name: "原本的", type: "margin", source: "user", loan: 1000, collateral: [{ symbol: "2330", shares: 10 }] }] })); W.tv = "sync"; setLt("tools"); });
  await p.waitForSelector('#lx [data-sy="export"]', { timeout: 20000 });
  assert.equal(await p.evaluate(() => typeof KLMargin), "undefined", "還沒載入融資模組");
  const before = await p.evaluate(() => [localStorage.getItem("kline:pf:margin:v1"), localStorage.getItem("kline:watch:groups")]);
  const pack = accounts => Buffer.from(JSON.stringify({ app: "kline-school", v: 2, at: "2026-11-05T00:00:00Z", data: { "kline:watch:groups": JSON.stringify([{ name: "被蓋掉", list: [] }]), "kline:pf:margin:v1": JSON.stringify({ v: 1, accounts }) } }));
  for (const bad of [[{ id: "x", loan: -5, collateral: [{ symbol: "2330", shares: 1 }] }], [{ id: "y", loan: 5000, collateral: [] }], [{ id: "z", loan: 5000, rate: 3, collateral: [{ symbol: "2330", shares: 1 }] }]]) {
    await p.evaluate(() => { document.querySelectorAll(".toast").forEach(t => t.remove()); });
    await p.setInputFiles("#lx input[data-syfile]", { name: "bad.json", mimeType: "application/json", buffer: pack(bad) });
    await p.waitForFunction(() => /投資組合資料有問題，沒有匯入[\s\S]*融資帳戶/.test(document.body.innerText), null, { timeout: 15000 });
    assert.deepEqual(await p.evaluate(() => [localStorage.getItem("kline:pf:margin:v1"), localStorage.getItem("kline:watch:groups")]), before, JSON.stringify(bad) + "：資料維持原樣");
  }
  // 正確的帳戶：匯入成功（會重新載入頁面）
  await p.setInputFiles("#lx input[data-syfile]", { name: "good.json", mimeType: "application/json", buffer: pack([{ id: "ok", name: "新的", type: "margin", source: "broker", loan: 2000, rate: 0.06, collateral: [{ symbol: "2330", shares: 10 }] }]) });
  await p.waitForFunction(() => JSON.parse(localStorage.getItem("kline:pf:margin:v1") || "{}").accounts?.[0]?.id === "ok", null, { timeout: 15000 });
  await ctx.close(); assert.deepEqual(errs, []);
});
