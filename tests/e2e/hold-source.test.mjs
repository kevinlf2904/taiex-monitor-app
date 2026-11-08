// 庫存各分頁的持股來源：有交易紀錄時改用交易紀錄算（成本含實際手續費、股息用帳本記的），舊庫存 watch:hold 完全不動；
// 可以切回看舊庫存；交易紀錄模式下編輯庫存／截圖匯入改成提示；交易紀錄改了庫存跟著變。固定假資料、手機與桌面
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const OLD = { 2330: { sh: 1000, cost: 500, d: "2025-01-02" } };
const TX = [{ id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 100, price: 90, fee: 20, tax: 0 },
  { id: "b", v: 1, date: "2026-03-05", type: "dividend", symbol: "2317", market: "tw", currency: "TWD", amount: 500, tax: 0 }];

test("有交易紀錄：庫存改用交易紀錄；舊庫存不動；可以切回；交易紀錄改了跟著變", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.evaluate(([old, tx]) => { localStorage.setItem("kline:watch:hold", JSON.stringify(old)); localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: tx, at: "2026-11-01T00:00:00Z" })); }, [OLD, TX]);
    await p.reload(); await p.evaluate(() => { W.holdView = "pnl"; W.holdMkt = "tw"; setLt("hold"); });
    await p.waitForFunction(() => W.holdLg && /股2317/.test($("#wl").innerText), null, { timeout: 30000 });
    const st = await p.evaluate(() => ({ codes: Object.keys(W.hold), bar: $("#lTools").innerText, impHidden: $("#lTools .imp-btns").hidden, wl: $("#wl").innerText, h: W.hold["2317"] }));
    assert.deepEqual(st.codes, ["2317"], "持股來自交易紀錄，不是舊庫存的 2330"); assert.doesNotMatch(st.wl, /股2330/);
    assert.match(st.bar, /持股來自交易紀錄（2 筆交易）/); assert.equal(st.impHidden, true, "交易紀錄模式不顯示編輯庫存");
    assert.equal(st.h.sh, 100); assert.ok(Math.abs(st.h.cost - 90.2) < 1e-9, "平均成本含實際手續費 (9000+20)/100"); assert.equal(st.h.d, "2026-01-05"); assert.equal(st.h.dv, 500);
    // 損益：成本已含手續費，不再估買進手續費；含息時扣帳本記的股息
    const pnl = await p.evaluate(() => { W.hfee = true; W.hdisc = 1; W.hdiv = true; return holdPnL("2317", { price: 100, chg: 1 }); });
    assert.equal(pnl.hc, 9020 - 500, "持有成本＝9,020（含實際手續費）− 股息 500"); assert.equal(pnl.divGot, 500); assert.equal(pnl.fee, 20, "只有賣出手續費 20（最低 20 元）");
    // 舊庫存寫入被擋下：localStorage 不變
    const kept = await p.evaluate(() => { const r = store.set("watch:hold", W.hold); return [r, localStorage.getItem("kline:watch:hold")]; });
    assert.equal(kept[0], false); assert.deepEqual(JSON.parse(kept[1]), OLD, "舊庫存完全不動");
    // 編輯庫存的入口改成提示
    await p.evaluate(() => $("#lTools [data-imp=edit]").click()); assert.match(await p.evaluate(() => $("#toast").textContent), /持股來自交易紀錄/);
    assert.equal(await p.evaluate(() => document.querySelector(".imp-modal:not([hidden]), #impBox:not([hidden])") ? 1 : 0), 0);
    // 改看舊庫存 → 2330；再切回交易紀錄
    await p.click("[data-hsrc=legacy]"); await p.waitForFunction(() => /股2330/.test($("#wl").innerText), null, { timeout: 15000 });
    assert.match(await p.evaluate(() => $("#lTools").innerText), /目前看的是舊庫存/); assert.equal(await p.evaluate(() => $("#lTools .imp-btns").hidden), false);
    await p.click("[data-hsrc=ledger]"); await p.waitForFunction(() => /股2317/.test($("#wl").innerText), null, { timeout: 15000 });
    // 交易紀錄有新交易 → 庫存跟著變（存檔時間改了）
    await p.evaluate(tx => { localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [...tx, { id: "c", v: 1, date: "2026-04-01", type: "buy", symbol: "2454", market: "tw", currency: "TWD", shares: 10, price: 1000, fee: 0, tax: 0 }], at: "2026-11-02T00:00:00Z" })); renderList(); }, TX);
    await p.waitForFunction(() => /股2454/.test($("#wl").innerText), null, { timeout: 15000 });
    // 修改一筆交易（筆數、建立時間 at 都沒變）也要跟著變；at 是建立時間，存檔不改它
    await p.evaluate(() => { const S = JSON.parse(localStorage.getItem("kline:pf:v1")); S.transactions[0].shares = 200; localStorage.setItem("kline:pf:v1", JSON.stringify(S)); renderList(); });
    await p.waitForFunction(() => W.hold["2317"]?.sh === 200, null, { timeout: 15000 });
    assert.equal(JSON.parse(await p.evaluate(() => localStorage.getItem("kline:pf:v1"))).at, "2026-11-02T00:00:00Z");
    assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem("kline:watch:hold"))), OLD, "全程舊庫存不變");
    assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, width + "：沒有水平溢出");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("沒有交易紀錄：照舊用舊庫存，可以編輯", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(old => { localStorage.setItem("kline:watch:hold", JSON.stringify(old)); localStorage.removeItem("kline:pf:v1"); }, OLD);
  await p.reload(); await p.evaluate(() => { W.holdView = "pnl"; W.holdMkt = "tw"; setLt("hold"); });
  await p.waitForFunction(() => /股2330/.test($("#wl").innerText), null, { timeout: 30000 });
  const st = await p.evaluate(() => ({ lg: W.holdLg, bar: $("#lTools").innerText, hidden: $("#lTools .imp-btns").hidden, w: store.set("watch:hold", W.hold) }));
  assert.equal(st.lg ?? null, null); assert.doesNotMatch(st.bar, /持股來自|舊庫存/); assert.equal(st.hidden, false); assert.equal(st.w, true, "沒有交易紀錄時可以寫舊庫存");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("交易紀錄只有美股：台股分頁說明到交易紀錄新增，不出現範例按鈕", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [{ id: "u", v: 1, date: "2026-01-05", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 1, price: 100, fee: 0, tax: 0 }], at: "x" })));
  await p.reload(); await p.evaluate(() => { W.holdView = "pnl"; W.holdMkt = "tw"; setLt("hold"); });
  await p.waitForFunction(() => W.holdLg && /交易紀錄裡目前沒有台股持股/.test($("#lx").innerText), null, { timeout: 30000 });
  assert.equal(await p.$("[data-hdemo=load]"), null);
  await ctx.close(); assert.deepEqual(errs, []);
});
