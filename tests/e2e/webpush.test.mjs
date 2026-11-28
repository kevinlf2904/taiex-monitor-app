// 工具 → 備份同步 → 瀏覽器推播：伺服器有金鑰時出現「開啟推播」，訂閱資料（假的 PushManager）送到 /api/sync 的 wpsub；測試推播、關閉推播。390／1280 不溢出
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const KEY = "BOk" + "A".repeat(84);

for (const width of [390, 1280]) test(`瀏覽器推播 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  const ops = [];
  await ctx.route("**/api/sync**", r => { const q = r.request(); if (q.method() === "GET") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, kv: true, tg: false, wp: true, wpKey: KEY }) });
    const b = JSON.parse(q.postData() || "{}"); ops.push(b); r.fulfill({ contentType: "application/json", body: JSON.stringify(b.op === "push" ? { ok: true, at: Date.now(), tg: false, wp: ops.some(x => x.op === "wpsub") && !ops.some(x => x.op === "wpoff") } : b.op === "wpsub" ? { ok: true, sent: true } : { ok: true }) }); });
  await p.evaluate(k => {
    window.__unsub = 0; window.__key = null;
    Notification.requestPermission = async () => "granted";
    const sub = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/fake", keys: { p256dh: "p", auth: "a" } }), unsubscribe: async () => { __unsub++; return true; } };
    const reg = { pushManager: { getSubscription: async () => null, subscribe: async o => { __key = [...o.applicationServerKey].length; reg.pushManager.getSubscription = async () => sub; return sub; } } };
    navigator.serviceWorker.getRegistration = async () => reg; Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve(reg) });
    localStorage.setItem("kline-sync", JSON.stringify({ id: "test_sync_id_123456789012", auto: false, at: 1000, hash: 0 })); W.syncCfg = null; W.tv = "sync"; setLt("tools");
  }, KEY);
  await p.waitForSelector('#lx [data-sy="wpon"]');
  assert.match(await p.textContent("#lx"), /瀏覽器推播[\s\S]*不用 Telegram/);
  await p.click('#lx [data-sy="wpon"]'); await p.waitForSelector('#lx [data-sy="wptest"]');
  const sub = ops.find(x => x.op === "wpsub"); assert.ok(sub, JSON.stringify(ops.map(x => x.op)));
  assert.deepEqual(sub.sub, { endpoint: "https://fcm.googleapis.com/fcm/send/fake", keys: { p256dh: "p", auth: "a" } }); assert.equal(sub.id, "test_sync_id_123456789012");
  assert.equal(await p.evaluate(() => __key), 65, "公鑰轉成 65 位元組"); assert.ok(ops.findIndex(x => x.op === "push") < ops.findIndex(x => x.op === "wpsub"), "先上傳提醒條件再綁定");
  assert.match(await p.textContent("#lx"), /推播送到這台裝置/);
  await p.click('#lx [data-sy="wptest"]'); await p.waitForFunction(() => /已送出，看看通知/.test(document.body.innerText));
  assert.ok(await noHOverflow(p));
  await p.click('#lx [data-sy="wpoff"]'); await p.waitForSelector('#lx [data-sy="wpon"]');
  assert.equal(await p.evaluate(() => __unsub), 1, "關閉時也取消這台的訂閱"); assert.ok(ops.some(x => x.op === "wpoff"));
  await ctx.close(); assert.deepEqual(errs, []);
});
