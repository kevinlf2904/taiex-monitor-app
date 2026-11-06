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
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} ${v}：沒有水平溢出`);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll("#lx *")].every(e => e.getBoundingClientRect().right <= innerWidth + 1 || getComputedStyle(e.parentElement).overflowX !== "visible")), `${width} ${v}：內容沒有超出畫面`);
    assert.deepEqual(await overlaps(p), [], `${width} ${v}：按鈕不重疊`);
    const small = await p.evaluate(() => [...document.querySelectorAll("#lx button, #lx [role=button]")].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5).map(e => e.innerText.trim().slice(0, 10)));
    assert.deepEqual(small, [], `${width} ${v}：觸控裝置上可以點的東西至少 44px 高`);
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
