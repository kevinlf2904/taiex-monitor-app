// 雲端同步的結果要反映在「庫存 → 交易紀錄」底下的資料說明：開網頁下載失敗（連不上、伺服器回 ok:false）、背景上傳失敗、雲端服務不能用都要顯示；
// 下載成功會清掉舊的錯誤；停在交易紀錄頁時會自己更新（不用切頁）。全部用假的 /api/sync 回應，不連雲端。
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 10, price: 100, fee: 0, tax: 0 }];
const ID = "TEST-ONLY-NOT-A-REAL-CODE-0123456789";
// cfg：GET /api/sync?op=cfg 的回應；post：POST（pull／push）的處理
async function page(cfg, post) {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/sync**", r => { const q = r.request(); if (q.method() === "GET") return r.fulfill({ contentType: "application/json", body: JSON.stringify(cfg) }); return post(r, JSON.parse(q.postData() || "{}")); });
  await p.evaluate(([tx, id]) => { localStorage.setItem("kline-sync", JSON.stringify({ id, auto: true, at: Date.parse("2026-11-05T06:30:00Z"), hash: 1 })); localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: tx, at: "x" })); localStorage.setItem("kline:watch:hv", JSON.stringify("tx")); localStorage.setItem("kline:watch:lt", JSON.stringify("hold")); }, [TX, ID]);
  await p.reload(); await p.evaluate(() => { W.lg = { view: "tx" }; W.holdView = "tx"; setLt("hold"); });
  return { ctx, p, errs };
}
const body = p => p.evaluate(() => document.body.innerText);
const ok = j => r => r.fulfill({ contentType: "application/json", body: JSON.stringify(j) });

test("開網頁下載：連不上雲端 → 交易紀錄頁顯示最近一次同步失敗", async () => {
  const { ctx, p, errs } = await page({ ok: true, kv: true }, r => r.abort());
  await p.waitForFunction(() => /最近一次同步失敗/.test(document.body.innerText), null, { timeout: 15000 });
  await ctx.close(); assert.deepEqual(errs, []);
});

test("開網頁下載：伺服器回 ok:false → 顯示失敗；之後下載成功就清掉", async () => {
  let fail = true;
  const { ctx, p, errs } = await page({ ok: true, kv: true }, (r, b) => b.op === "pull" ? ok(fail ? { ok: false, error: "暫停服務" } : { ok: true, at: 1, data: {} })(r) : ok({ ok: true, at: 2 })(r));
  await p.waitForFunction(() => /最近一次同步失敗/.test(document.body.innerText), null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => W.syncErr), "暫停服務");
  fail = false; await p.evaluate(() => syncBoot());
  await p.waitForFunction(() => !/最近一次同步失敗/.test(document.body.innerText), null, { timeout: 15000 });
  await ctx.close(); assert.deepEqual(errs, []);
});

test("背景上傳失敗（含雲端有別台比較新的資料）：停在交易紀錄頁也會自己更新", async () => {
  let push = { ok: false, error: "上傳逾時" };
  const { ctx, p, errs } = await page({ ok: true, kv: true }, (r, b) => b.op === "pull" ? ok({ ok: true, at: 1, data: {} })(r) : ok(push)(r));
  await p.waitForTimeout(2500); assert.doesNotMatch(await body(p), /最近一次同步失敗/, "下載成功時沒有失敗");
  await p.evaluate(() => syncPush(true)); await p.waitForFunction(() => /最近一次同步失敗/.test(document.body.innerText), null, { timeout: 10000 });
  push = { ok: true, at: Date.parse("2026-11-07T01:00:00Z") }; await p.evaluate(() => syncPush(true));
  await p.waitForFunction(() => /最近一次成功同步：11-07 09:00/.test(document.body.innerText) && !/最近一次同步失敗/.test(document.body.innerText), null, { timeout: 10000 });
  push = { ok: false, conflict: true, at: 9 }; await p.evaluate(() => syncPush(true));
  await p.waitForFunction(() => /最近一次同步失敗/.test(document.body.innerText), null, { timeout: 10000 });
  assert.match(await p.evaluate(() => W.syncErr), /雲端有另一台裝置比較新的資料/, "衝突時也記成失敗（原本錯誤訊息是空的）");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("雲端服務不能用（kv:false）：開網頁後交易紀錄頁自己改成不會同步", async () => {
  const { ctx, p, errs } = await page({ ok: true, kv: false }, ok({ ok: true }));
  await p.waitForFunction(() => /雲端同步服務目前無法使用，資料不會同步/.test(document.body.innerText), null, { timeout: 15000 });
  assert.doesNotMatch(await body(p), /雲端服務正常時會一起同步/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("手動下載失敗（工具 → 備份同步按「下載」）：交易紀錄頁也顯示同步失敗", async () => {
  let pullFail = false;
  const { ctx, p, errs } = await page({ ok: true, kv: true }, (r, b) => b.op === "pull" ? (pullFail ? ok({ ok: false, error: "暫停服務" }) : ok({ ok: true, at: 1, data: {} }))(r) : ok({ ok: true, at: 2 })(r));
  await p.waitForTimeout(2500); assert.doesNotMatch(await body(p), /最近一次同步失敗/);
  pullFail = true; await p.evaluate(() => syncPull(false));
  await p.waitForFunction(() => /最近一次同步失敗/.test(document.body.innerText), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => W.syncErr), "暫停服務");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("手動下載：資料拿到了但寫不進這台（儲存空間不夠）→ 交易紀錄頁顯示同步失敗，這台資料維持原樣", async () => {
  const { ctx, p, errs } = await page({ ok: true, kv: true }, (r, b) => b.op === "pull" ? ok({ ok: true, at: 5, data: { "kline:watch:zz-quota-test": "x", "kline:pf:v1": JSON.stringify({ v: 1, method: "avg", transactions: [], at: "cloud" }) } })(r) : ok({ ok: true, at: 6 })(r));
  await p.waitForTimeout(2500); assert.doesNotMatch(await body(p), /最近一次同步失敗/);
  const before = await p.evaluate(() => localStorage.getItem("kline:pf:v1"));
  // 模擬空間不夠：寫雲端拿來的那一項時丟出 QuotaExceededError
  await p.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === "kline:watch:zz-quota-test") { const e = new Error("exceeded the quota"); e.name = "QuotaExceededError"; throw e; } return o.call(this, k, v); }; });
  await p.evaluate(() => syncPull(false));
  await p.waitForFunction(() => /最近一次同步失敗/.test(document.body.innerText), null, { timeout: 10000 });
  assert.match(await p.evaluate(() => W.syncErr), /儲存空間不夠/);
  assert.equal(await p.evaluate(() => localStorage.getItem("kline:pf:v1")), before, "交易紀錄維持原樣（沒有被雲端的蓋掉一半）");
  await ctx.close(); assert.deepEqual(errs, []);
});
