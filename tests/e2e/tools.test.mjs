// 主要流程：選股「自訂條件」全市場選股、模擬交易（市價＋掛單）、交易日記、備份同步
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("工具流程", async () => {
  const { ctx, p, errs, KV } = await open(B, S.url, "watch.html");
  await p.evaluate(() => { setLt("screen"); W.scrG = "custom"; SC().uni = "market"; SC().rules = [{ k: "above", p: 20 }]; scSave(); renderList(); });
  await p.click("#lx [data-scrun]"); await p.waitForFunction(() => W.scanRes && !W.scanRes.busy, null, { timeout: 60000 });
  assert.equal(await p.evaluate(() => W.scanRes.total), 200);
  await p.waitForFunction(() => W.quotes.get("2330")?.price, null, { timeout: 20000 }); await p.evaluate(() => { setLt("tools"); W.tv = "paper"; renderList(); }); await p.waitForTimeout(300);
  await p.fill("#paCode", "2330"); await p.fill("#paSh", "1000"); await p.click('[data-paside="buy"]'); await p.waitForTimeout(300);
  await p.fill("#paCode", "2330"); await p.selectOption("#paType", "limit"); await p.fill("#paPx", "99999"); await p.click('[data-paside="sell"]'); await p.waitForTimeout(300);
  assert.deepEqual(await p.evaluate(() => [Object.keys(PA().pos), PA().orders.length]), [["2330"], 1]);
  await p.evaluate(() => { W.tv = "journal"; renderList(); }); await p.waitForTimeout(800);
  assert.ok(await p.evaluate(() => JR().length >= 1));
  await p.evaluate(() => { W.tv = "sync"; renderList(); }); await p.waitForTimeout(600); await p.click('#lx [data-sy="new"]'); await p.waitForTimeout(800);
  assert.equal(KV.size, 1);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("備份同步：雲端比較新時不自動蓋掉，讓使用者選；寫入失敗時還原、不留下新舊混合的資料 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/sync**", r => { const q = r.request(); if (q.method() === "GET") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, kv: true, tg: false }) });
    const b = JSON.parse(q.postData() || "{}"); if (b.op === "push") return r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify(b.force ? { ok: true, at: 9000 } : { ok: false, conflict: true, at: 5000, dev: "iPhone", error: "雲端有另一台裝置比較新的資料" }) });
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  await p.evaluate(() => { localStorage.setItem("kline-sync", JSON.stringify({ id: "test_sync_id_123456789012", auto: true, at: 1000, hash: 0 })); W.tv = "sync"; setLt("tools"); });
  await p.evaluate(() => syncPush(true));
  assert.deepEqual(await p.evaluate(() => [W.syncConflict?.at, syncGet().at]), [5000, 1000], "衝突：記下雲端版本，這台的同步時間不動");
  await p.evaluate(() => renderList()); await p.waitForSelector('#lx [data-sy="force"]');
  assert.match(await p.textContent("#lx .csec"), /iPhone[\s\S]*比較新的資料[\s\S]*用雲端的[\s\S]*用這台的/);
  await p.click('#lx [data-sy="force"]'); // 確認視窗由測試環境自動按確定
  await p.waitForFunction(() => !W.syncConflict && syncGet().at === 9000);
  // 寫入失敗（儲存空間不夠）：已經寫的改回原值，新增的拿掉
  const r = await p.evaluate(() => { localStorage.setItem("kline:watch:t1", "old1"); const set = Storage.prototype.setItem; let n = 0;
    Storage.prototype.setItem = function (k, v) { if (k.startsWith("kline:watch:t") && ++n === 3) throw new DOMException("full", "QuotaExceededError"); return set.call(this, k, v); };
    let err = null; try { syncApply({ "kline:watch:t1": "new1", "kline:watch:t2": "new2", "kline:watch:t3": "new3" }); } catch (e) { err = e.message; } finally { Storage.prototype.setItem = set; }
    return [err, localStorage.getItem("kline:watch:t1"), localStorage.getItem("kline:watch:t2"), localStorage.getItem("kline:watch:t3")]; });
  assert.match(r[0], /儲存空間不夠/); assert.deepEqual(r.slice(1), ["old1", null, null], "失敗後資料維持原樣");
  await ctx.close(); assert.deepEqual(errs.filter(e => !/409/.test(e)), []);
});
