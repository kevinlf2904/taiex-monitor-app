// 離線快取（PWA）：網站打開過一次之後，沒有網路時也能打開學堂、看盤，看到上次載入的資料。
// 頁面與程式（html、js、css）：先上網拿最新的，拿不到才用快取，所以部署新版時馬上生效，不會卡在舊版。
// 圖示、圖片、字型：先用快取。排程整理的資料（data/*.json）與變動慢的 API：先上網，失敗才用快取。
// 報價、分時、台指期等即時資料、雲端同步、AI、version.json（自動更新用）一律直接上網、不快取。
const C = "klinelab-v1", MAX_API = 400;
const LIVE = /^\/api\/(quote|intraday|futures|sync|chat|chart-read|import|podcast|status)\b/;
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(["./", "index.html", "watch.html"])).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(K => Promise.all(K.filter(k => k.startsWith("klinelab-") && k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const put = (req, res) => { if (res.ok && res.type === "basic") { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); } return res; };
async function trim() { const c = await caches.open(C), K = (await c.keys()).filter(r => new URL(r.url).pathname.startsWith("/api/")); for (const r of K.slice(0, Math.max(0, K.length - MAX_API))) await c.delete(r); }
const fromCache = async (req, opt) => (await caches.match(req, opt)) || null;
self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin || LIVE.test(u.pathname) || /version\.json$/.test(u.pathname) || req.cache === "no-store") return;
  if (req.mode === "navigate") { // 頁面：先上網；快取只存路徑（watch.html?embed=1… 都算同一頁），離線時用快取
    e.respondWith(fetch(req).then(r => put(u.pathname, r)).catch(async () => (await fromCache(u.pathname)) || (await fromCache(req, { ignoreSearch: true })) || (await fromCache("index.html")) || new Response("離線中，請連上網路後再試。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
    return;
  }
  if (/\.(png|jpe?g|svg|webp|ico|woff2?)$/i.test(u.pathname)) { e.respondWith(fromCache(req).then(m => m || fetch(req).then(r => put(req, r)))); return; }
  const api = u.pathname.startsWith("/api/");
  e.respondWith(fetch(req).then(r => { put(req, r); if (api && Math.random() < 0.05) trim(); return r; }).catch(async () => (await fromCache(req)) || (api ? new Response(JSON.stringify({ ok: false, error: "離線中，這份資料還沒有快取" }), { headers: { "Content-Type": "application/json" } }) : Response.error())));
});
// 通知（事件提醒、到價提醒）：點通知回到網站
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(L => (L[0] ? L[0].focus() : self.clients.openWindow("./")))); });
