// 產生一組瀏覽器推播（Web Push）用的 VAPID 金鑰：node scripts/vapid-keys.mjs
// 印出來的兩行只貼到 Vercel 環境變數與 GitHub Actions secrets（VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY），不要貼進程式、提交、PR 或留言。
// 換金鑰之後，已經訂閱的瀏覽器要重新按一次「開啟推播」。
import { createECDH } from "node:crypto";
const E = createECDH("prime256v1"); E.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${E.getPublicKey().toString("base64url")}`);
const k = E.getPrivateKey(), d = Buffer.concat([Buffer.alloc(32 - k.length), k]); // 私鑰前面是 0 的位元組會被省掉，補回 32 位元組
console.log(`VAPID_PRIVATE_KEY=${d.toString("base64url")}`);
