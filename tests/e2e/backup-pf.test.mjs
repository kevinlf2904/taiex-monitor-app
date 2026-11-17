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

test("備份檔含 kline:pf:recon:v1：鍵序無關先賣後買正常匯入、壞圖／跨市場衝突拒匯、pendingCommit 預設拒匯並可二次確認剔除後匯入", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true, time: "2026-10-05T04:00:00Z", tick: true });
  await p.evaluate(() => {
    localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "keep", v: 1, date: "2026-09-01", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 100, price: 150, fee: 0, tax: 0 }] }));
    localStorage.removeItem("kline:pf:recon:v1");
    W.tv = "sync"; setLt("tools");
  });
  await p.waitForSelector('#lx [data-sy="export"]', { timeout: 20000 });
  const before = await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:pf:recon:v1")]);

  // 1) base64 圖片／跨市場衝突 → 整份拒絕，資料不變
  const imgBad = {
    app: "kline-school", v: 2, at: "2026-10-05T00:00:00Z",
    data: {
      "kline:pf:recon:v1": JSON.stringify({
        v: 1,
        snapshots: [{ id: "s1", date: "2026-09-01", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, avgCost: 800, origin: "import", scope: "partial", status: "confirmed", note: "data:image/png;base64,AAA" }],
        conflicts: [], initialTags: {}, sameDayRelations: {}, imports: [], audit: [], pendingCommit: null,
      }),
    },
  };
  await p.setInputFiles("#lx input[data-syfile]", { name: "img-bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imgBad)) });
  await p.waitForFunction(() => /投資組合資料有問題，沒有匯入/.test(document.body.innerText), null, { timeout: 15000 });
  assert.deepEqual(await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:pf:recon:v1")]), before);

  const curConflict = {
    app: "kline-school", v: 2, at: "2026-10-05T00:00:00Z",
    data: {
      "kline:pf:v1": JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "t1", v: 1, date: "2026-09-10", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 900, fee: 0, tax: 0 }] }),
      "kline:pf:recon:v1": JSON.stringify({
        v: 1,
        snapshots: [{ id: "s1", date: "2026-09-01", symbol: "2330", market: "us", currency: "USD", shares: 100, avgCost: 180, origin: "import", scope: "partial", status: "confirmed", confirmedAt: "2026-09-01T00:00:00Z", supersededBy: null, batchId: "b1", note: "" }],
        conflicts: [], initialTags: {}, sameDayRelations: {}, imports: [], audit: [], pendingCommit: null,
      }),
    },
  };
  await p.evaluate(() => document.querySelectorAll(".toast").forEach(t => t.remove()));
  await p.setInputFiles("#lx input[data-syfile]", { name: "cur-bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(curConflict)) });
  await p.waitForFunction(() => /投資組合資料有問題，沒有匯入/.test(document.body.innerText), null, { timeout: 15000 });
  assert.deepEqual(await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:pf:recon:v1")]), before);

  // 2) pendingCommit != null：預設對話框按取消則拒匯（資料不動）；確認後剔除 WAL 並正常匯入（含 pf:v1 在 recon 之前先賣出）
  const walBackup = {
    app: "kline-school", v: 2, at: "2026-10-05T00:00:00Z",
    data: {
      "kline:pf:v1": JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "sell1", v: 1, date: "2026-09-25", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 200, price: 950, fee: 0, tax: 0 }] }),
      "kline:pf:recon:v1": JSON.stringify({
        v: 1,
        snapshots: [{ id: "s1", date: "2026-09-01", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, avgCost: 800, origin: "import", scope: "partial", status: "confirmed", confirmedAt: "2026-09-01T00:00:00Z", supersededBy: null, batchId: "b1", note: "" }],
        conflicts: [], initialTags: {}, sameDayRelations: {}, imports: [], audit: [],
        pendingCommit: { id: "wal-hung", op: "unknown_op", at: "2026-10-04T00:00:00Z" },
      }),
    },
  };
  p.removeAllListeners("dialog");
  let dialogMode = "dismiss_wal";
  p.on("dialog", async d => {
    if (dialogMode === "dismiss_wal") await d.dismiss();
    else await d.accept();
  });
  await p.evaluate(() => document.querySelectorAll(".toast").forEach(t => t.remove()));
  await p.setInputFiles("#lx input[data-syfile]", { name: "wal.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(walBackup)) });
  await p.waitForTimeout(500);
  assert.deepEqual(await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:pf:recon:v1")]), before, "取消剔除 pendingCommit 時維持拒匯");

  dialogMode = "accept_all";
  await p.setInputFiles("#lx input[data-syfile]", { name: "wal.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(walBackup)) });
  await p.waitForFunction(() => JSON.parse(localStorage.getItem("kline:pf:v1") || "{}").transactions?.[0]?.id === "sell1", null, { timeout: 15000 });
  const afterRecon = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1")));
  assert.equal(afterRecon.pendingCommit, null, "二次確認剔除後已清除 pendingCommit");
  assert.equal(afterRecon.snapshots[0].symbol, "2330", "先賣後買依快照驗證通過並完整匯入");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("雲端同步（mock /api/sync）：雙鍵成對上傳、超限雙鍵皆不帶、pendingCommit 暫停上傳、下載錯配拒絕套用", async () => {
  const { ctx, p, errs, KV } = await open(B, S.url, "watch.html", { width: 1280, time: "2026-10-05T04:00:00Z", tick: true });
  const pairRecon = {
    v: 1,
    snapshots: [{ id: "s1", date: "2026-09-01", symbol: "2330", market: "tw", currency: "TWD", shares: 500, avgCost: 850, origin: "import", scope: "partial", status: "confirmed", confirmedAt: "2026-09-01T00:00:00Z", supersededBy: null, batchId: "b1", note: "" }],
    conflicts: [], initialTags: {}, sameDayRelations: {}, imports: [], audit: [], pendingCommit: null,
  };
  await p.evaluate(r => {
    localStorage.setItem("kline-sync", JSON.stringify({ id: "SyncPairTest1234567890", auto: false, at: 0, hash: 0 }));
    localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "t1", v: 1, date: "2026-09-10", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 920, fee: 0, tax: 0 }] }));
    localStorage.setItem("kline:pf:recon:v1", JSON.stringify(r));
    W.tv = "sync"; setLt("tools");
  }, pairRecon);
  await p.waitForSelector('#lx [data-sy="push"]', { timeout: 20000 });

  // 1) 正常成對上傳
  await p.click('#lx [data-sy="push"]');
  await p.waitForFunction(() => /已上傳到雲端/.test(document.body.innerText), null, { timeout: 10000 });
  const cloud1 = KV.get("SyncPairTest1234567890")?.data;
  assert.ok(cloud1["kline:pf:v1"] && cloud1["kline:pf:recon:v1"], "正常成對時 kline:pf:v1 與 kline:pf:recon:v1 一起上傳");

  // 2) pf:v1 超過 150KB 時，連同 kline:pf:recon:v1 兩鍵皆不帶出
  await p.evaluate(b => {
    localStorage.setItem("kline:pf:v1", JSON.stringify(b));
    syncSet({ at: Date.now() + 1000 });
    renderList();
  }, big());
  await p.click('#lx [data-sy="push"]');
  await p.waitForTimeout(400);
  const cloud2 = KV.get("SyncPairTest1234567890")?.data;
  assert.equal("kline:pf:v1" in cloud2, false, "超限時不帶 pf:v1");
  assert.equal("kline:pf:recon:v1" in cloud2, false, "單鍵超限時成對另一鍵 kline:pf:recon:v1 亦不單獨上傳");

  // 3) pendingCommit != null 時暫停上傳（不打 push 蓋掉雲端）
  await p.evaluate(r => {
    localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [] }));
    localStorage.setItem("kline:pf:recon:v1", JSON.stringify({ ...r, pendingCommit: { id: "wal1", op: "import_trades" } }));
    renderList();
  }, pairRecon);
  await p.click('#lx [data-sy="push"]');
  await p.waitForFunction(() => /未完成的對帳提交，暫停雲端上傳/.test(document.body.innerText), null, { timeout: 10000 });

  // 4) 下載錯配（雲端 pf:v1 跨市場衝突／賣超）且本機清掉 pendingCommit → 拒絕套用、本機維持原樣
  await p.evaluate(r => {
    localStorage.setItem("kline:pf:recon:v1", JSON.stringify(r));
    renderList();
  }, pairRecon);
  KV.set("SyncPairTest1234567890", {
    at: Date.now() + 5000,
    data: {
      "kline:watch:groups": JSON.stringify([{ name: "不該被寫入", list: [] }]),
      "kline:pf:v1": JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "bad-sell", v: 1, date: "2026-09-10", type: "sell", symbol: "NVDA", market: "us", currency: "USD", shares: 99, price: 100, fee: 0, tax: 0 }] }),
      "kline:pf:recon:v1": JSON.stringify(pairRecon),
    },
  });
  const localBeforePull = await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:watch:groups")]);
  await p.click('#lx [data-sy="pull"]');
  await p.waitForFunction(() => /驗證未通過/.test(document.body.innerText), null, { timeout: 10000 });
  assert.deepEqual(await p.evaluate(() => [localStorage.getItem("kline:pf:v1"), localStorage.getItem("kline:watch:groups")]), localBeforePull, "錯配雲端資料整份拒絕套用");

  await ctx.close(); assert.deepEqual(errs, []);
});

test("第五輪 P2-2 & P3-3：舊備份缺 recon:v1 時處理本機 recon:v1（pendingCommit 阻擋、保留時配對拒匯、確認清除時移除殘留快照），且無 navigator.locks 時非 pf 同步／匯入不誤鎖", async () => {
  const { ctx, p, errs, KV } = await open(B, S.url, "watch.html", { width: 1280, time: "2026-10-05T04:00:00Z", tick: true });
  const localRecon2330 = {
    v: 1,
    snapshots: [{ id: "s2330", date: "2026-09-01", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, avgCost: 850, origin: "import", scope: "partial", status: "confirmed", confirmedAt: "2026-09-01T00:00:00Z", supersededBy: null, batchId: "b1", note: "" }],
    conflicts: [], initialTags: {}, sameDayRelations: {}, imports: [], audit: [], pendingCommit: null,
  };

  // 1) 本機有 pendingCommit 時，匯入僅含 kline:pf:v1 的舊備份必須阻擋
  await p.evaluate(r => {
    localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [] }));
    localStorage.setItem("kline:pf:recon:v1", JSON.stringify({ ...r, pendingCommit: { id: "wal-local", op: "import_trades" } }));
    W.tv = "sync"; setLt("tools");
  }, localRecon2330);
  await p.waitForSelector('#lx [data-sy="export"]', { timeout: 20000 });
  const legacyV2 = {
    app: "kline-school", v: 2, at: "2026-10-05T00:00:00Z",
    data: {
      "kline:pf:v1": JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "only2317", v: 1, date: "2026-09-15", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 100, price: 150, fee: 0, tax: 0 }] }),
    },
  };
  await p.setInputFiles("#lx input[data-syfile]", { name: "legacy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacyV2)) });
  await p.waitForFunction(() => /未完成的對帳提交/.test(document.body.innerText), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 0, "本機 pendingCommit 未解時不可覆蓋 pf:v1");

  // 2) 本機無 pendingCommit 但有 2330 快照；匯入缺 recon:v1 且與本機 2330 快照幣別衝突的備份，若使用者選擇「取消清除（保留本機快照）」→ 配對檢查失敗並拒匯
  await p.evaluate(r => {
    localStorage.setItem("kline:pf:recon:v1", JSON.stringify(r));
    document.querySelectorAll(".toast").forEach(t => t.remove());
  }, localRecon2330);
  const legacyConflictWithLocalRecon = {
    app: "kline-school", v: 2, at: "2026-10-05T00:00:00Z",
    data: {
      "kline:pf:v1": JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "bad-cur", v: 1, date: "2026-09-15", type: "buy", symbol: "2330", market: "us", currency: "USD", shares: 10, price: 150, fee: 0, tax: 0 }] }),
    },
  };
  p.removeAllListeners("dialog");
  let clearChoice = "keep_local_recon";
  p.on("dialog", async d => {
    if (clearChoice === "keep_local_recon" && /不含對帳快照/.test(d.message())) await d.dismiss();
    else await d.accept();
  });
  await p.setInputFiles("#lx input[data-syfile]", { name: "legacy-conflict.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacyConflictWithLocalRecon)) });
  await p.waitForFunction(() => /投資組合資料有問題，沒有匯入/.test(document.body.innerText), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 0, "保留本機快照時，配對衝突整份拒匯");

  // 3) 匯入不含 recon:v1 的舊備份（只有 2317），確認一併清除本機對帳快照 → 匯入後本機 recon:v1 被清除，不會殘留 2330 快照
  clearChoice = "clear_local_recon";
  await p.evaluate(() => document.querySelectorAll(".toast").forEach(t => t.remove()));
  await p.setInputFiles("#lx input[data-syfile]", { name: "legacy-ok.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacyV2)) });
  await p.waitForFunction(() => JSON.parse(localStorage.getItem("kline:pf:v1") || "{}").transactions?.[0]?.id === "only2317", null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => localStorage.getItem("kline:pf:recon:v1")), null, "確認清除後本機不殘留無關的 kline:pf:recon:v1");

  // 4) P3-3：當環境不支援 navigator.locks 時，不含 kline:pf: 的備份匯入與雲端下載仍可正常套用
  await p.waitForTimeout(900);
  await p.waitForFunction(() => typeof setLt === "function" && typeof W !== "undefined", null, { timeout: 15000 });
  await p.evaluate(() => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
    localStorage.setItem("kline-sync", JSON.stringify({ id: "NoLocksWatchOnly123456", auto: false, at: 0, hash: 0 }));
    W.tv = "sync"; setLt("tools"); renderList();
  });
  await p.waitForSelector('#lx [data-sy="pull"]', { timeout: 15000 });
  KV.set("NoLocksWatchOnly123456", {
    at: Date.now() + 5000,
    data: { "kline:watch:groups": JSON.stringify([{ name: "雲端自選", list: ["2330"] }]) },
  });
  await p.click('#lx [data-sy="pull"]');
  await p.waitForFunction(() => /雲端自選/.test(localStorage.getItem("kline:watch:groups") || ""), null, { timeout: 15000 });
  await p.waitForTimeout(900);
  await p.waitForFunction(() => typeof setLt === "function" && typeof W !== "undefined", null, { timeout: 15000 });
  await p.evaluate(() => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
    W.tv = "sync"; setLt("tools"); renderList();
  });
  await p.waitForSelector("#lx input[data-syfile]", { state: "attached", timeout: 15000 });
  const watchOnlyBackup = {
    app: "kline-school", v: 2, at: "2026-10-05T00:00:00Z",
    data: { "kline:watch:groups": JSON.stringify([{ name: "備份自選", list: ["2317"] }]) },
  };
  await p.setInputFiles("#lx input[data-syfile]", { name: "watch-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(watchOnlyBackup)) });
  await p.waitForFunction(() => /備份自選/.test(localStorage.getItem("kline:watch:groups") || ""), null, { timeout: 15000 });

  await ctx.close(); assert.deepEqual(errs, []);
});

