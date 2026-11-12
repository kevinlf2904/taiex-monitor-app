// 問助教聊天框：按 Enter 送出，但輸入法選字中（isComposing／舊版 Safari 的 keyCode 229）不能送出；Shift+Enter 換行
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("聊天框 Enter 不打斷輸入法選字", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 390, touch: true });
  const r = await p.evaluate(() => {
    const sent = []; window.chatAsk = q => sent.push(q); // 只看有沒有送出，不真的呼叫 AI
    const t = document.getElementById("chatInput"); t.value = "KD 鈍化";
    const key = (o = {}) => { const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: !!o.comp, shiftKey: !!o.shift }); if (o.k229) Object.defineProperty(e, "keyCode", { value: 229 }); t.dispatchEvent(e); return e.defaultPrevented; };
    const o = {};
    o.compPrevented = key({ comp: true }); o.afterComp = sent.length;
    key({ k229: true }); o.after229 = sent.length;
    o.shiftPrevented = key({ shift: true }); o.afterShift = sent.length;
    key(); o.sent = sent.slice();
    return o;
  });
  assert.equal(r.afterComp, 0, "選字中按 Enter 不送出"); assert.ok(r.compPrevented, "選字中的 Enter 也不插入換行");
  assert.equal(r.after229, 0, "舊版 Safari 的 keyCode 229 也要擋");
  assert.equal(r.afterShift, 0, "Shift+Enter 不送出"); assert.equal(r.shiftPrevented, false, "Shift+Enter 保留換行");
  assert.deepEqual(r.sent, ["KD 鈍化"], "一般 Enter 照常送出");
  await ctx.close(); assert.deepEqual(errs, []);
});
