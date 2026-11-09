// _harness 的 hOverflow／noHOverflow 本身的回歸測試（#249）：其他 e2e 的水平溢出檢查都靠它，這裡確認它在手機模擬下真的抓得到溢出
// 舊寫法 scrollWidth <= innerWidth + 1 在 isMobile 時 innerWidth 會被內容撐大，永遠通過；這裡一併確認舊寫法確實會漏掉，證明測試情境有效
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, hOverflow, noHOverflow } from "./_harness.mjs";

const B = await (await chromium()).launch();
test.after(async () => { await B.close(); });
const VP = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const phone = async () => { const ctx = await B.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); return { ctx, p: await ctx.newPage() }; };

test("手機 390px：放 555px 寬的元素，hOverflow 回報溢出、noHOverflow 回傳 false（舊寫法會漏掉）", async () => {
  const { ctx, p } = await phone();
  await p.setContent(VP + '<body style="margin:0"><div style="width:555px;height:10px"></div></body>');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "情境有效：舊寫法在手機模擬下通過（innerWidth 被撐大）");
  assert.equal(await hOverflow(p), 165, "溢出 555 - 390 = 165px");
  assert.equal(await noHOverflow(p), false);
  await ctx.close();
});

test("手機 390px：內容沒有超出，noHOverflow 回傳 true", async () => {
  const { ctx, p } = await phone();
  await p.setContent(VP + '<body style="margin:0"><div style="width:390px;height:10px"></div><div style="width:100%;height:10px"></div></body>');
  assert.ok(await hOverflow(p) <= 0);
  assert.equal(await noHOverflow(p), true);
  await ctx.close();
});

test("傳入 iframe：和 iframe 自己的寬度比，iframe 內容溢出也抓得到", async () => {
  const { ctx, p } = await phone();
  const frameOf = async html => { await p.setContent(VP + '<body style="margin:0"><iframe style="width:300px;height:200px;border:0" srcdoc="' + html + '"></iframe></body>'); const h = await p.$("iframe"); const f = await h.contentFrame(); await f.waitForLoadState(); return f; };
  let f = await frameOf("<body style='margin:0'><div style='width:500px;height:10px'></div></body>");
  assert.equal(await hOverflow(f), 200, "iframe 寬 300、內容 500，溢出 200px");
  assert.equal(await noHOverflow(f), false);
  f = await frameOf("<body style='margin:0'><div style='width:100%;height:10px'></div></body>");
  assert.equal(await noHOverflow(f), true);
  await ctx.close();
});
