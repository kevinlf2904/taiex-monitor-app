// 瀏覽器推播（Web Push）：不用 Telegram，直接推到手機、電腦的瀏覽器通知（iPhone 要先把網站「加入主畫面」，iOS 16.4 以上）。
// 只用 Node 內建的 crypto，不另外裝套件：
//   · 內容加密：RFC 8291（aes128gcm，ECDH P-256 ＋ HKDF ＋ AES-128-GCM）
//   · 伺服器身分：RFC 8292 VAPID（ES256 簽的 JWT）
// 需要的設定（Vercel 環境變數；GitHub Actions 的排程用同名 secrets）：VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY（base64url），VAPID_SUBJECT（mailto: 或 https: 開頭，選用）。
// 產生一組金鑰：node scripts/vapid-keys.mjs（只印在自己的終端機，不要貼進程式、提交、PR 或留言）。沒設定時 wpOn() 是 false，網頁不顯示這個選項，排程只送 Telegram。
// 訂閱的推播網址只接受各家瀏覽器的推播服務（Google、Mozilla、Apple、Microsoft），避免伺服器被拿去打任意網址。
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign } from "node:crypto";

const b64u = b => Buffer.from(b).toString("base64url"), unb64u = s => Buffer.from(String(s || ""), "base64url");
const VAPID = () => ({ pub: (process.env.VAPID_PUBLIC_KEY || "").trim(), priv: (process.env.VAPID_PRIVATE_KEY || "").trim(), sub: (process.env.VAPID_SUBJECT || "").trim() || "https://github.com/kevinlf2904/taiex-monitor-app" });
export const wpOn = () => { const v = VAPID(); return unb64u(v.pub).length === 65 && unb64u(v.priv).length === 32; };
export const wpPublicKey = () => (wpOn() ? VAPID().pub : null);

// 推播服務的網址白名單
const HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/i;
// 瀏覽器 PushSubscription.toJSON() → 檢查過的 { endpoint, keys: { p256dh, auth } }，不合格回 null
export function cleanSub(s) {
  let u; try { u = new URL(String(s?.endpoint || "")); } catch { return null; }
  if (u.protocol !== "https:" || !HOSTS.test(u.hostname) || u.username || u.password || u.port || String(s.endpoint).length > 1000) return null;
  const p = String(s?.keys?.p256dh || ""), a = String(s?.keys?.auth || "");
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p) || !/^[A-Za-z0-9_-]+={0,2}$/.test(a) || unb64u(p).length !== 65 || unb64u(p)[0] !== 4 || unb64u(a).length !== 16) return null;
  return { endpoint: u.href, keys: { p256dh: p.replace(/=+$/, ""), auth: a.replace(/=+$/, "") } };
}

const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
// RFC 8291：payload（Buffer）用訂閱的公鑰與 auth 加密，回傳整個請求 body（一個 record）
export function encrypt(payload, sub, { salt = randomBytes(16), ecdh = null } = {}) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth), E = ecdh || createECDH("prime256v1"); if (!ecdh) E.generateKeys();
  const as = E.getPublicKey(), secret = E.computeSecret(ua);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from("WebPush: info\0"), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm), cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const c = createCipheriv("aes-128-gcm", cek, nonce), body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = as.length;
  return Buffer.concat([head, as, body]);
}
// RFC 8292：Authorization 標頭（JWT 12 小時有效）
export function vapidAuth(endpoint, { pub, priv, sub } = VAPID(), now = Date.now()) {
  const P = unb64u(pub), key = createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: b64u(unb64u(priv)), x: b64u(P.subarray(1, 33)), y: b64u(P.subarray(33, 65)) } });
  const data = `${b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub }))}`;
  return `vapid t=${data}.${b64u(sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }))}, k=${b64u(P)}`;
}
// 送一則：msg＝{ title, body, url?, tag? }；回傳 { ok, gone（訂閱失效，該刪掉）, status }
export async function sendPush(sub0, msg, { fetchImpl = fetch, ttl = 86400 } = {}) {
  const sub = cleanSub(sub0); if (!sub) return { ok: false, gone: true, status: 0 };
  if (!wpOn()) return { ok: false, gone: false, status: 0, error: "沒有設定 VAPID 金鑰" };
  const payload = JSON.stringify({ title: String(msg.title || "K線看盤").slice(0, 80), body: String(msg.body || "").slice(0, 1500), url: msg.url || "./", tag: msg.tag || undefined });
  const r = await fetchImpl(sub.endpoint, { method: "POST", headers: { Authorization: vapidAuth(sub.endpoint), TTL: String(ttl), Urgency: "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" }, body: encrypt(payload, sub), signal: AbortSignal.timeout(15000) });
  return { ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status };
}
// 給排程用：同一則訊息送到這個人綁的 Telegram 與瀏覽器推播；至少一個成功就算成功，都失敗才丟出錯誤（呼叫的人照舊重試）。失效的推播訂閱順便刪掉
export async function deliver({ h, chat, text, title, url, tg, kv, push = sendPush }) {
  let ok = 0; const errs = [];
  if (chat && tg) { try { await tg("sendMessage", { chat_id: chat, text }); ok++; } catch (e) { errs.push(e); } }
  if (kv && wpOn()) {
    let sub = null; try { sub = JSON.parse((await kv("GET", `wp:${h}`)) || "null"); } catch {}
    if (sub) { try { const r = await push(sub, { title, body: text, url }); if (r.ok) ok++; else if (r.gone) await kv("DEL", `wp:${h}`).catch(() => {}); else errs.push(new Error(`推播 HTTP ${r.status}`)); } catch (e) { errs.push(e); } }
  }
  if (!ok && errs.length) throw errs[0];
  return ok;
}
