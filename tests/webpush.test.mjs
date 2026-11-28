// 瀏覽器推播（api/_lib/webpush.js）：用接收端的私鑰把加密內容解回來（RFC 8291）、驗 VAPID JWT 簽章（RFC 8292）、訂閱網址白名單、deliver 的成功與失敗。不連網，fetch 用替身
import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHmac, createDecipheriv, createPublicKey, verify } from "node:crypto";

const kp = () => { const E = createECDH("prime256v1"); E.generateKeys(); return E; };
const S = kp(); process.env.VAPID_PUBLIC_KEY = S.getPublicKey().toString("base64url"); process.env.VAPID_PRIVATE_KEY = Buffer.concat([Buffer.alloc(32 - S.getPrivateKey().length), S.getPrivateKey()]).toString("base64url"); process.env.VAPID_SUBJECT = "mailto:test@example.com";
const { encrypt, vapidAuth, cleanSub, sendPush, deliver, wpOn, wpPublicKey } = await import("../api/_lib/webpush.js");
const UA = kp(), AUTH = Buffer.alloc(16, 7), SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: UA.getPublicKey().toString("base64url"), auth: AUTH.toString("base64url") } };
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
// 接收端（瀏覽器）的解密，照 RFC 8291 自己寫一次
function decrypt(body) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), n = body[20], as = body.subarray(21, 21 + n), ct = body.subarray(21 + n), ua = UA.getPublicKey();
  const ikm = hmac(hmac(AUTH, UA.computeSecret(as)), Buffer.concat([Buffer.from("WebPush: info\0"), ua, as, Buffer.from([1])])), prk = hmac(salt, ikm);
  const d = createDecipheriv("aes-128-gcm", hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12));
  d.setAuthTag(ct.subarray(-16)); const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return { rs, n, text: pt.subarray(0, -1).toString(), pad: pt.at(-1) };
}

test("內容加密：接收端解得回來；每次的 salt 與臨時金鑰不同", () => {
  const a = encrypt("中文通知 🚨", SUB), b = encrypt("中文通知 🚨", SUB);
  assert.deepEqual(decrypt(a), { rs: 4096, n: 65, text: "中文通知 🚨", pad: 2 }); assert.ok(!a.equals(b));
  const bad = Buffer.from(a); bad[bad.length - 1] ^= 1; assert.throws(() => decrypt(bad), "被改過就解不開");
});

test("VAPID：JWT 的 aud、exp、sub，ES256 簽章用公鑰驗得過；k 是公鑰", () => {
  const now = Date.parse("2026-11-25T00:00:00Z"), h = vapidAuth(SUB.endpoint, undefined, now), [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  const [hd, cl, sg] = t.split("."), C = JSON.parse(Buffer.from(cl, "base64url"));
  assert.deepEqual(JSON.parse(Buffer.from(hd, "base64url")), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(C, { aud: "https://fcm.googleapis.com", exp: now / 1000 + 43200, sub: "mailto:test@example.com" });
  assert.equal(k, process.env.VAPID_PUBLIC_KEY);
  const P = S.getPublicKey(), pub = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: P.subarray(1, 33).toString("base64url"), y: P.subarray(33).toString("base64url") } });
  assert.ok(verify("sha256", Buffer.from(`${hd}.${cl}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sg, "base64url")));
  assert.equal(wpOn(), true); assert.equal(wpPublicKey(), process.env.VAPID_PUBLIC_KEY);
});

test("訂閱網址白名單：只接受各家推播服務的 https 網址與正確長度的金鑰", () => {
  assert.deepEqual(cleanSub(SUB), SUB);
  for (const ep of ["https://web.push.apple.com/QA", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=1"]) assert.ok(cleanSub({ ...SUB, endpoint: ep }), ep);
  for (const ep of ["http://fcm.googleapis.com/x", "https://evil.example.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://169.254.169.254/x", "not a url"])
    assert.equal(cleanSub({ ...SUB, endpoint: ep }), null, ep);
  assert.equal(cleanSub({ ...SUB, keys: { ...SUB.keys, auth: "short" } }), null); assert.equal(cleanSub({ ...SUB, keys: { p256dh: "AAAA", auth: SUB.keys.auth } }), null);
});

test("sendPush：標頭、成功、訂閱失效（404／410）；deliver：Telegram 與推播至少一個成功就算成功、失效的訂閱刪掉", async () => {
  const calls = [], f = st => async (u, o) => { calls.push([u, o]); return { status: st }; };
  let r = await sendPush(SUB, { title: "標題", body: "內容" }, { fetchImpl: f(201) });
  assert.deepEqual(r, { ok: true, gone: false, status: 201 });
  const [u, o] = calls[0]; assert.equal(u, SUB.endpoint); assert.equal(o.headers["Content-Encoding"], "aes128gcm"); assert.equal(o.headers.TTL, "86400"); assert.match(o.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(o.body).text), { title: "標題", body: "內容", url: "./" });
  assert.equal((await sendPush(SUB, {}, { fetchImpl: f(410) })).gone, true); assert.equal((await sendPush({ endpoint: "https://evil.example.com/" }, {}, { fetchImpl: f(201) })).gone, true, "不合格的訂閱不送");
  const store = { "wp:h1": JSON.stringify(SUB) }, kv = async (cmd, k) => (cmd === "GET" ? store[k] ?? null : cmd === "DEL" ? (delete store[k], 1) : null);
  const tgOk = async () => ({}), tgBad = async () => { throw new Error("tg down"); };
  assert.equal(await deliver({ h: "h1", chat: "1", text: "x", tg: tgOk, kv, push: async () => ({ ok: true }) }), 2);
  assert.equal(await deliver({ h: "h1", chat: "1", text: "x", tg: tgBad, kv, push: async () => ({ ok: true }) }), 1, "Telegram 壞了、推播成功也算成功");
  await assert.rejects(deliver({ h: "h1", chat: "1", text: "x", tg: tgBad, kv, push: async () => ({ ok: false, status: 500 }) }), /tg down/, "都失敗才丟錯");
  assert.equal(await deliver({ h: "h1", chat: null, text: "x", tg: tgOk, kv, push: async () => ({ ok: false, gone: true }) }), 0); assert.equal(store["wp:h1"], undefined, "失效的訂閱刪掉");
  assert.equal(await deliver({ h: "h2", chat: null, text: "x", tg: tgOk, kv, push: async () => assert.fail("沒訂閱不送") }), 0);
});
