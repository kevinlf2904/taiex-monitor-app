// 庫存「交易紀錄」（ledger-ui.js）：搬移先預覽、按確認才寫入 kline:pf:v1、舊庫存不變；賣超擋下且不寫入；正常賣出算出已實現損益；
// 刪除會讓後面出錯時不讓刪；手機與桌面不溢出、沒有 console 錯誤。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("交易紀錄：預覽 → 確認建立 → 新增賣出（賣超擋下）→ 刪除影響範圍", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    const before = await p.evaluate(() => { localStorage.removeItem("kline:pf:v1"); W.hold = { 2330: { sh: 1000, cost: 500, d: "2025-03-10" }, NVDA: { sh: 10, cost: 100 }, 2454: { sh: -1, cost: 1 } };
      store.set("watch:hold", W.hold); W.holdMkt = "tw"; W.holdView = "tx"; setLt("hold"); return localStorage.getItem("kline:watch:hold"); });
    await p.waitForSelector("[data-lg=preview]", { timeout: 20000 });
    await p.click("[data-lg=preview]");
    let t = await p.evaluate(() => $("#lx").innerText);
    assert.match(t, /搬移預覽/); assert.match(t, /共 2 筆會建立、1 筆不搬/); assert.match(t, /2454[\s\S]*股數要大於 0/);
    assert.equal(await p.evaluate(() => localStorage.getItem("kline:pf:v1")), null, "預覽時不寫入");
    await p.click("[data-lg=commit]");
    await p.waitForSelector("[data-lg=add]");
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
    assert.equal(st.v, 1); assert.equal(st.transactions.length, 2); assert.equal(st.migratedFrom, "kline:watch:hold"); assert.equal(st.method, "avg");
    assert.equal(await p.evaluate(() => localStorage.getItem("kline:watch:hold")), before, "舊庫存不變");
    t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /已建立交易紀錄（2 筆）/); assert.match(t, /持有中（2 檔）/);
    // 賣超：擋下、不寫入
    await p.click("[data-lg=add]"); await p.selectOption("#lgType", "sell");
    await p.fill("#lgForm [name=symbol]", "2330"); await p.fill("#lgForm [name=shares]", "5000"); await p.fill("#lgForm [name=price]", "600"); await p.fill("#lgForm [name=date]", "2026-01-05");
    await p.click("#lgForm button[type=submit]");
    await p.waitForFunction(() => /賣出 5000 股，但當時只持有 1000 股/.test($("#lx")?.innerText || ""));
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 2, "賣超沒有寫入");
    // 正常賣出（手續費、稅填 0）
    await p.fill("#lgForm [name=shares]", "500"); await p.fill("#lgForm [name=fee]", "0"); await p.fill("#lgForm [name=tax]", "0");
    await p.click("#lgForm button[type=submit]");
    await p.waitForFunction(() => !document.querySelector("#lgForm"));
    t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /已加入/); assert.match(t, /\+50,000/, "已實現 500 ×（600 − 500）");
    // 刪除 2330 的轉入：後面的賣出會變賣超 → 不讓刪
    const id = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.find(x => x.symbol === "2330" && x.type === "transfer_in").id);
    await p.click(`[data-lg=del][data-id="${id}"]`);
    await p.waitForFunction(() => /不能刪除：刪掉後有 1 筆交易會出錯/.test($("#lx")?.innerText || ""));
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 3);
    // 刪除那筆賣出：可以刪
    const sid = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.find(x => x.type === "sell").id);
    await p.click(`[data-lg=del][data-id="${sid}"]`);
    await p.waitForFunction(() => JSON.parse(localStorage.getItem("kline:pf:v1") || "{}").transactions?.length === 2);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.length), 2);
    // 展開成本變化
    await p.click('[data-lg=pos][data-c="2330"]'); t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /平均成本/);
    assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("Issue #303：新增交易未填手續費依 watch:hdisc 折扣估算並快照寫入，後續改折扣或改備註不溯及改寫歷史交易", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280, touch: false });
  const submitOk = async () => {
    await p.click("#lgForm button[type=submit]");
    await p.waitForFunction(() => !document.querySelector("#lgForm"));
  };
  await p.evaluate(() => {
    localStorage.removeItem("kline:pf:v1");
    W.hdisc = 0.28; store.set("watch:hdisc", 0.28);
    W.holdMkt = "tw"; W.holdView = "tx"; setLt("hold");
  });
  await p.waitForSelector("[data-lg=blank]", { timeout: 20000 });
  await p.click("[data-lg=blank]");
  await p.waitForSelector("[data-lg=add]");
  assert.match(await p.evaluate(() => $("#lx").innerText), /台股手續費 2\.8 折/);

  // 1. 新增買進 2330 1000 股 @ 500（未填手續費與稅）→ 按 2.8 折估算手續費 199 並寫入快照
  await p.click("[data-lg=add]");
  await p.fill("#lgForm [name=symbol]", "2330");
  await p.fill("#lgForm [name=shares]", "1000");
  await p.fill("#lgForm [name=price]", "500");
  await p.fill("#lgForm [name=date]", "2026-03-02");
  await submitOk();
  let pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.equal(pf.transactions.length, 1);
  assert.equal(pf.transactions[0].fee, 199, "1000×500×0.001425×0.28 = 199 快照寫入 localStorage");
  assert.equal(pf.transactions[0].tax, 0);
  assert.equal(pf.transactions[0].feeEstimated, true);
  assert.match(await p.evaluate(() => $("#lx").innerText), /費 199・稅 0（估算）/);
  assert.match(await p.evaluate(() => $("#lx").innerText), /均價 500\.199/);

  // 2. 將 watch:hdisc 改為 1（原價）並重繪：既有交易的手續費 199 與均價 500.199 不可被溯及改寫
  await p.evaluate(() => { W.hdisc = 1; store.set("watch:hdisc", 1); renderList(); });
  assert.match(await p.evaluate(() => $("#lx").innerText), /費 199・稅 0（估算）/);
  assert.match(await p.evaluate(() => $("#lx").innerText), /均價 500\.199/);

  // 3. 編輯該筆交易僅修改備註與日期（不改股數、價格、代號、手續費）：手續費維持 199 與（估算）標記，不會被新折扣重算為 712
  const txId = pf.transactions[0].id;
  await p.click(`[data-lg=edit][data-id="${txId}"]`);
  await p.fill("#lgForm [name=date]", "2026-03-03");
  await p.fill("#lgForm [name=note]", "長期部位");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.equal(pf.transactions[0].fee, 199, "僅改日期與備註時保留原快照手續費 199");
  assert.equal(pf.transactions[0].feeEstimated, true);
  assert.equal(pf.transactions[0].date, "2026-03-03");
  assert.equal(pf.transactions[0].note, "長期部位");

  // 4. 審查 P2：修改估算交易的股數、價格或代號（未動手續費欄）→ 自動丟棄過期快照並依新交易金額重新估算，保留 feeEstimated: true
  await p.evaluate(() => { W.hdisc = 0.28; store.set("watch:hdisc", 0.28); renderList(); });
  await p.click(`[data-lg=edit][data-id="${txId}"]`);
  await p.fill("#lgForm [name=shares]", "2000");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.equal(pf.transactions[0].fee, 399, "股數改為 2000 股時自動重估手續費 floor(2000×500×0.001425×0.28)=399，不殘留舊 199");
  assert.equal(pf.transactions[0].feeEstimated, true, "重估後仍標示 feeEstimated: true");

  await p.click(`[data-lg=edit][data-id="${txId}"]`);
  await p.fill("#lgForm [name=price]", "600");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.equal(pf.transactions[0].fee, 478, "價格改為 600 時自動重估手續費 floor(2000×600×0.001425×0.28)=478");
  assert.equal(pf.transactions[0].feeEstimated, true);

  await p.click(`[data-lg=edit][data-id="${txId}"]`);
  await p.fill("#lgForm [name=symbol]", "NVDA");
  await p.fill("#lgForm [name=shares]", "10");
  await p.fill("#lgForm [name=price]", "100");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.equal(pf.transactions[0].fee, 0, "代號改為美股 NVDA 時自動依美股規則重估手續費 0，不殘留舊台股手續費");
  assert.equal(pf.transactions[0].feeEstimated, true);

  // 5. 使用者手動輸入實際手續費（改回 2330 並手動填 fee=180）→ 視為實際填入值，不再標記 feeEstimated
  await p.click(`[data-lg=edit][data-id="${txId}"]`);
  await p.fill("#lgForm [name=symbol]", "2330");
  await p.fill("#lgForm [name=shares]", "1000");
  await p.fill("#lgForm [name=price]", "500");
  await p.fill("#lgForm [name=fee]", "180");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.equal(pf.transactions[0].fee, 180, "使用者手動填入 180 元作為實際手續費");
  assert.equal(!!pf.transactions[0].feeEstimated, false, "手動填入後不再標記為估算");
  assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /費 180・稅 0（估算）/);

  // 6. 再次編輯並將手續費欄位清空為空白：依目前 watch:hdisc = 1 重新估算為 712 並恢復 feeEstimated: true
  await p.evaluate(() => { W.hdisc = 1; store.set("watch:hdisc", 1); renderList(); });
  await p.click(`[data-lg=edit][data-id="${txId}"]`);
  await p.fill("#lgForm [name=fee]", "");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.equal(pf.transactions[0].fee, 712, "主動清空手續費後依目前原價重估為 712");
  assert.equal(pf.transactions[0].feeEstimated, true);
  assert.equal(pf.transactions[0].feeEst, true);

  // 先擴充買進股數為 10,000 股，供後續賣出部分手填／全估算／全手填五種編輯情境測試
  await p.evaluate(() => { W.hdisc = 0.28; store.set("watch:hdisc", 0.28); renderList(); });
  await p.click(`[data-lg=edit][data-id="${txId}"]`);
  await p.fill("#lgForm [name=shares]", "10000");
  await submitOk();

  // 7. 必補回歸 (1)：手填 fee=50、tax 留白（賣出 1000 股 @ 500）→ 編輯股數改 2000／價格改 600 → fee 維持手填 50，tax 依新計費基礎重估；僅改備註則完全保留快照
  await p.click("[data-lg=add]");
  await p.selectOption("#lgType", "sell");
  await p.fill("#lgForm [name=symbol]", "2330");
  await p.fill("#lgForm [name=shares]", "1000");
  await p.fill("#lgForm [name=price]", "500");
  await p.fill("#lgForm [name=fee]", "50");
  await p.fill("#lgForm [name=date]", "2026-03-04");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  const s1Id = pf.transactions[1].id;
  assert.deepEqual([pf.transactions[1].fee, pf.transactions[1].tax, !!pf.transactions[1].feeEstimated, !!pf.transactions[1].feeEst, !!pf.transactions[1].taxEst], [50, 1500, true, false, true]);

  await p.click(`[data-lg=edit][data-id="${s1Id}"]`);
  await p.fill("#lgForm [name=shares]", "2000");
  await p.fill("#lgForm [name=price]", "600");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.deepEqual([pf.transactions[1].fee, pf.transactions[1].tax, !!pf.transactions[1].feeEstimated, !!pf.transactions[1].feeEst, !!pf.transactions[1].taxEst], [50, 3600, true, false, true], "手填 fee=50 不被清除，tax 重估為 2000×600×0.003=3600");

  await p.click(`[data-lg=edit][data-id="${s1Id}"]`);
  await p.fill("#lgForm [name=note]", "手填手續費保留");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.deepEqual([pf.transactions[1].fee, pf.transactions[1].tax, !!pf.transactions[1].feeEst, !!pf.transactions[1].taxEst], [50, 3600, false, true], "僅改備註完全保留部分手填快照");

  // 8. 必補回歸 (2)：fee 留白、手填 tax=1200（賣出 1000 股 @ 500，2.8 折 fee=199）→ 編輯股數改 2000／價格改 600 → fee 依新基礎重估為 478，tax 維持手填 1200
  await p.click("[data-lg=add]");
  await p.selectOption("#lgType", "sell");
  await p.fill("#lgForm [name=symbol]", "2330");
  await p.fill("#lgForm [name=shares]", "1000");
  await p.fill("#lgForm [name=price]", "500");
  await p.fill("#lgForm [name=tax]", "1200");
  await p.fill("#lgForm [name=date]", "2026-03-05");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  const s2Id = pf.transactions[2].id;
  assert.deepEqual([pf.transactions[2].fee, pf.transactions[2].tax, !!pf.transactions[2].feeEstimated, !!pf.transactions[2].feeEst, !!pf.transactions[2].taxEst], [199, 1200, true, true, false]);

  await p.click(`[data-lg=edit][data-id="${s2Id}"]`);
  await p.fill("#lgForm [name=shares]", "2000");
  await p.fill("#lgForm [name=price]", "600");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.deepEqual([pf.transactions[2].fee, pf.transactions[2].tax, !!pf.transactions[2].feeEstimated, !!pf.transactions[2].feeEst, !!pf.transactions[2].taxEst], [478, 1200, true, true, false], "fee 重估為 478，手填 tax=1200 不被清除");

  // 9. 必補回歸 (3) & (4)：兩欄都空白而估算 vs 兩欄都手填（賣出）→ 編輯計費基礎後，兩欄皆估算者同步重估、兩欄皆手填者完全保留
  await p.click("[data-lg=add]");
  await p.selectOption("#lgType", "sell");
  await p.fill("#lgForm [name=symbol]", "2330");
  await p.fill("#lgForm [name=shares]", "1000");
  await p.fill("#lgForm [name=price]", "500");
  await p.fill("#lgForm [name=date]", "2026-03-06");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  const s3Id = pf.transactions[3].id;
  assert.deepEqual([pf.transactions[3].fee, pf.transactions[3].tax, !!pf.transactions[3].feeEst, !!pf.transactions[3].taxEst], [199, 1500, true, true]);

  await p.click(`[data-lg=edit][data-id="${s3Id}"]`);
  await p.fill("#lgForm [name=shares]", "2000");
  await p.fill("#lgForm [name=price]", "600");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.deepEqual([pf.transactions[3].fee, pf.transactions[3].tax, !!pf.transactions[3].feeEst, !!pf.transactions[3].taxEst], [478, 3600, true, true], "兩欄皆估算時編輯計費基礎後兩欄皆重估");

  await p.click("[data-lg=add]");
  await p.selectOption("#lgType", "sell");
  await p.fill("#lgForm [name=symbol]", "2330");
  await p.fill("#lgForm [name=shares]", "1000");
  await p.fill("#lgForm [name=price]", "500");
  await p.fill("#lgForm [name=fee]", "60");
  await p.fill("#lgForm [name=tax]", "1400");
  await p.fill("#lgForm [name=date]", "2026-03-07");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  const s4Id = pf.transactions[4].id;
  assert.deepEqual([pf.transactions[4].fee, pf.transactions[4].tax, !!pf.transactions[4].feeEstimated], [60, 1400, false]);

  await p.click(`[data-lg=edit][data-id="${s4Id}"]`);
  await p.fill("#lgForm [name=shares]", "2000");
  await p.fill("#lgForm [name=price]", "600");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  assert.deepEqual([pf.transactions[4].fee, pf.transactions[4].tax, !!pf.transactions[4].feeEstimated], [60, 1400, false], "兩欄皆手填時編輯計費基礎後兩欄皆保留");

  // 10. 舊資料僅有 aggregate feeEstimated（無 feeEst／taxEst）時編輯計費基礎：採保守策略保留原值，不靜默覆蓋
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("kline:pf:v1"));
    s.transactions.push({ v: 1, id: "legacy-est", date: "2026-03-08", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 500, fee: 55, tax: 1500, feeEstimated: true, note: "", source: "manual" });
    localStorage.setItem("kline:pf:v1", JSON.stringify(s));
    renderList();
  });
  await p.click('[data-lg=edit][data-id="legacy-est"]');
  await p.fill("#lgForm [name=shares]", "1500");
  await submitOk();
  pf = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")));
  const legTx = pf.transactions.find(x => x.id === "legacy-est");
  assert.deepEqual([legTx.shares, legTx.fee, legTx.tax, !!legTx.feeEstimated], [1500, 55, 1500, true], "舊資料無個別來源時保守保留原費稅，不靜默刪除");

  // 11. 另計費用（type="fee" 掛 ref）E2E 回歸：
  // (a) 手填 fee=50／估算 tax=3600（s1Id）、全手填（s4Id）、舊資料（legacy-est）皆擋下 duplicate_fee，不覆蓋原費稅
  await p.click("[data-lg=add]");
  await p.selectOption("#lgType", "fee");
  await p.fill("#lgForm [name=amount]", "80");
  await p.fill("#lgForm [name=date]", "2026-03-04");
  await p.selectOption("#lgForm [name=ref]", s1Id);
  await p.click("#lgForm button[type=submit]");
  await p.waitForFunction(() => /已經有手續費/.test($("#lgForm .lgiss")?.textContent || ""));
  assert.match(await p.textContent("#lgForm .lgiss"), /已經有手續費/, "手填 fee／估算 tax 掛另計費用須擋下");

  await p.selectOption("#lgForm [name=ref]", s4Id);
  await p.click("#lgForm button[type=submit]");
  await p.waitForFunction(() => /已經有手續費/.test($("#lgForm .lgiss")?.textContent || ""));
  assert.match(await p.textContent("#lgForm .lgiss"), /已經有手續費/, "全手填掛另計費用須擋下");

  await p.selectOption("#lgForm [name=ref]", "legacy-est");
  await p.click("#lgForm button[type=submit]");
  await p.waitForFunction(() => /未記錄各欄估算來源/.test($("#lgForm .lgiss")?.textContent || ""));
  assert.match(await p.textContent("#lgForm .lgiss"), /未記錄各欄估算來源/, "舊資料無個別來源時掛另計費用須保守擋下");

  // (b) 估算 fee=478／手填 tax=1200（s2Id）：掛另計費用 80 僅取代估算 fee，保留手填 tax=1200，且不再顯示（估算）
  await p.fill("#lgForm [name=date]", "2026-03-05");
  await p.selectOption("#lgForm [name=ref]", s2Id);
  await submitOk();
  const s2Row = await p.locator(".lgtx").filter({ hasText: "2026-03-05" }).filter({ hasText: "賣出" }).first().textContent();
  assert.match(s2Row, /費 80・稅 1,200/);
  assert.doesNotMatch(s2Row, /費 80・稅 1,200（估算）/, "估算 fee 被實際另計費用取代且 tax 為手填時，不再標記（估算）");

  // (c) 全估算賣出（s3Id：估算 fee=478／估算 tax=3600）：掛另計費用 90 僅取代估算 fee，保留估算 tax=3600 與（估算）標記
  await p.click("[data-lg=add]");
  await p.selectOption("#lgType", "fee");
  await p.fill("#lgForm [name=amount]", "90");
  await p.fill("#lgForm [name=date]", "2026-03-06");
  await p.selectOption("#lgForm [name=ref]", s3Id);
  await submitOk();
  const s3Row = await p.locator(".lgtx").filter({ hasText: "2026-03-06" }).filter({ hasText: "賣出" }).first().textContent();
  assert.match(s3Row, /費 90・稅 3,600（估算）/, "僅取代估算 fee 為 90，保留估算 tax=3600 與（估算）標記");

  await ctx.close(); assert.deepEqual(errs, []);
});


