// 投資組合（總覽、交易紀錄、績效、配置、融資）：平板 768／834 不溢出、按鈕不重疊；只用鍵盤（Tab、Enter、空白鍵）也能切分頁、點總覽的卡片與持倉。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 200000 },
  { id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 0, tax: 0 },
  { id: "b", v: 1, date: "2026-01-05", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const MG = { v: 1, accounts: [{ id: "m", name: "融資", type: "margin", source: "user", loan: 10000, collateral: [{ symbol: "2330", shares: 100 }] }] };
const VIEWS = [["home", ".hmcard"], ["tx", ".lgcurs"], ["perf", ".pfcard"], ["alloc", ".alcard"], ["margin", ".pfsrc"]];
// 同一列可以點的東西互相重疊（寬度太窄被擠在一起）
const overlaps = p => p.evaluate(() => { const els = [...document.querySelectorAll("#lx button, #lx [role=button], #lx a")].filter(e => e.offsetParent && e.getClientRects().length), out = [];
  const R = els.map(e => e.getBoundingClientRect());
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i], b = R[j]; if (els[i].contains(els[j]) || els[j].contains(els[i])) continue; const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 2 && h > 2) out.push(`${els[i].innerText.slice(0, 12)}／${els[j].innerText.slice(0, 12)}`); }
  return out; });

for (const width of [768, 834]) test(`平板 ${width}：各分頁不溢出、按鈕不重疊`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: true });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  await p.evaluate(([tx, mg]) => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); store.set("pf:margin:v1", mg); W.lg = null; W.holdView = "tx"; setLt("hold"); }, [TX, MG]);
  for (const [v, sel] of VIEWS) {
    await p.evaluate(v => { W.lg.view = v; renderList(); }, v); await p.waitForSelector(`#lx ${sel}`, { timeout: 30000 });
    assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, `${width} ${v}：沒有水平溢出`);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll("#lx *")].every(e => e.getBoundingClientRect().right <= innerWidth + 1 || getComputedStyle(e.parentElement).overflowX !== "visible")), `${width} ${v}：內容沒有超出畫面`);
    assert.deepEqual(await overlaps(p), [], `${width} ${v}：按鈕不重疊`);
    const small = await p.evaluate(() => [...document.querySelectorAll("#lx button, #lx [role=button]")].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5).map(e => e.innerText.trim().slice(0, 10)));
    assert.deepEqual(small, [], `${width} ${v}：觸控裝置上可以點的東西至少 44px 高`);
    if (v === "tx") {
      assert.ok(await p.evaluate(() => [...document.querySelectorAll("#lx .lgtx .lgd")].every(e => e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).lineHeight || "20") * 1.5 + 2)), `${width}：交易清單的日期不折成兩行`);
      const note = await p.evaluate(() => $("#note")?.innerText || document.body.innerText);
      assert.match(note, /投資組合的資料（交易紀錄、融資帳戶）只存在這個瀏覽器；這台裝置沒有開雲端同步，不會上傳/); assert.doesNotMatch(note, /要在「編輯庫存」填買進日期/, "交易紀錄頁不顯示舊庫存的說明");
    }
  }
  await ctx.close(); assert.deepEqual(errs, []);
});

test("鍵盤：Tab 到分頁按 Enter 切換；總覽的卡片、持倉可以用 Enter／空白鍵打開；看得到焦點", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/api/kline?code=TWD%3DX**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: [{ d: "2026-10-05", o: 32, h: 32, l: 32, c: 32, v: 0 }] }) }));
  await p.evaluate(tx => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = null; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector(".hmcard", { timeout: 30000 });
  // 用 Tab 走到「績效」分頁（最多按 80 次），Enter 切過去
  const tabTo = async (pred, max = 80) => { for (let i = 0; i < max; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(pred)) return true; } return false; };
  assert.ok(await tabTo(() => document.activeElement?.matches?.("[data-lg=view][data-v=perf]")), "Tab 走得到「績效」分頁");
  const ring = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== "none"; });
  assert.ok(ring, "有焦點外框");
  await p.keyboard.press("Enter"); await p.waitForSelector(".pfcard, .pfsrc", { timeout: 30000 });
  assert.equal(await p.evaluate(() => W.lg.view), "perf");
  // 回總覽：Tab 到「總資產」卡片，按 Enter 到配置
  await p.evaluate(() => { W.lg.view = "home"; renderList(); }); await p.waitForSelector(".hmcard");
  assert.ok(await tabTo(() => document.activeElement?.matches?.(".pftile.hmgo[data-v=alloc]")), "Tab 走得到「總資產」卡片");
  await p.keyboard.press("Enter"); await p.waitForSelector(".alcard", { timeout: 30000 });
  // 主要持倉：Tab 到持倉列按空白鍵打開個股
  await p.evaluate(() => { W.lg.view = "home"; renderList(); }); await p.waitForSelector(".hmrow");
  assert.ok(await tabTo(() => document.activeElement?.matches?.(".hmrow")), "Tab 走得到持倉列");
  const code = await p.evaluate(() => document.activeElement.dataset.sel); await p.keyboard.press(" ");
  await p.waitForFunction(c => W.sel === c, code, { timeout: 10000 });
  await ctx.close(); assert.deepEqual(errs, []);
});

// 手機與桌面：交易日期不折行、不溢出、不壓到「修改／刪除」；交易紀錄頁的說明依雲端同步有沒有開而不同（不能說「不會上傳」卻其實會同步）
for (const width of [390, 1280]) test(`交易清單日期與資料說明 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(tx => { localStorage.removeItem("kline-sync"); store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); W.lg = { view: "tx" }; W.holdView = "tx"; setLt("hold"); }, TX);
  await p.waitForSelector("#lx .lgtx .lgd", { timeout: 30000 });
  const g = await p.evaluate(() => [...document.querySelectorAll("#lx .lgtx")].map(li => { const d = li.querySelector(".lgd").getBoundingClientRect(), b = li.querySelector(".lgact")?.getBoundingClientRect(), lh = parseFloat(getComputedStyle(li.querySelector(".lgd")).lineHeight) || 20;
    return { oneLine: d.height < lh * 1.5 + 2, inside: d.right <= innerWidth + 1, clear: !b || d.right <= b.left + 1 || d.bottom <= b.top + 1 }; }));
  assert.ok(g.length && g.every(x => x.oneLine), `${width}：日期一行`); assert.ok(g.every(x => x.inside), `${width}：日期沒有超出畫面`); assert.ok(g.every(x => x.clear), `${width}：日期沒有壓到修改／刪除`);
  assert.ok(await p.evaluate(w => document.documentElement.scrollWidth <= w + 1, width) /* 和設定的螢幕寬度比：手機模擬時 innerWidth 會跟著內容一起變寬，比它永遠不會失敗 */, `${width}：沒有水平溢出`);
  assert.match(await p.evaluate(() => document.body.innerText), /這台裝置沒有開雲端同步，不會上傳/);
  // 有同步碼時依實際狀態：自動同步關閉、雲端服務不能用、正常（寫最近一次成功同步的時間）；都不能說「不會上傳」也不能斷言已經同步
  const T = async (sync, cfg) => { await p.evaluate(([s, c]) => { localStorage.setItem("kline-sync", JSON.stringify(s)); W.syncCfg = c; W.syncErr = null; renderList(); }, [sync, cfg]); return p.evaluate(() => document.body.innerText); };
  const ID = "TEST-ONLY-NOT-A-REAL-CODE";
  let t = await T({ id: ID, auto: false }, null); assert.match(t, /自動同步已關閉，要到「工具 → 備份同步」手動上傳才會同步/); assert.doesNotMatch(t, /會一起同步|不會上傳/);
  t = await T({ id: ID, auto: true }, { kv: false }); assert.match(t, /雲端同步服務目前無法使用，資料不會同步/); assert.doesNotMatch(t, /會一起同步/);
  t = await T({ id: ID, auto: true, at: 0 }, { kv: true }); assert.match(t, /雲端服務正常時會一起同步/); assert.match(t, /還沒有成功同步過/); assert.doesNotMatch(t, /不會上傳/);
  t = await T({ id: ID, auto: true, at: Date.parse("2026-11-05T06:30:00Z") }, { kv: true }); assert.match(t, /最近一次成功同步：11-05 14:30/);
  await p.evaluate(() => { W.syncErr = "測試"; renderList(); }); assert.match(await p.evaluate(() => document.body.innerText), /最近一次同步失敗/);
  await p.evaluate(() => { W.syncCfg = null; W.syncErr = null; });
  await p.evaluate(() => localStorage.removeItem("kline-sync"));
  await ctx.close(); assert.deepEqual(errs, []);
});
