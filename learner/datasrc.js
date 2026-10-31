// 排程資料（learner/data/）改從 GitHub 讀最新版：排程每天往 main 寫幾十次資料，若每次都要 Vercel 重新部署才看得到，部署次數會用完。
// 網站上（https、非本機）的 learner/data/ 請求改問 raw.githubusercontent.com 的 main 分支（公開 repo、允許跨網域，CDN 約 5 分鐘更新）；
// GitHub 拿不到（離線、被擋、新檔還沒進 main）就退回網站上部署的那一份，所以不會比原本差。本機、測試（http://localhost）照舊讀網站上的檔案。
// 必須在其他程式之前載入（index.html、watch.html、savings.html 的第一個 script）。
(() => {
  const RAW = "https://raw.githubusercontent.com/kevinlf2904/taiex-monitor-app/main/learner/data/";
  const on = loc => loc.protocol === "https:" && !/^(localhost|127\.|\[::1\])/.test(loc.hostname);
  // 網址 → GitHub 上同一個資料檔的網址；不是 learner/data/ 的請求回 null
  const dataSrc = (url, loc = location) => {
    try {
      const u = new URL(url, loc.href);
      if (!on(loc) || u.origin !== loc.origin || !u.pathname.startsWith("/learner/data/")) return null;
      return RAW + u.pathname.slice("/learner/data/".length) + u.search;
    } catch { return null; }
  };
  self.dataSrc = dataSrc;
  if (typeof fetch !== "function" || self.__dataSrcPatched) return;
  self.__dataSrcPatched = true;
  const orig = fetch.bind(self);
  self.fetch = (input, init) => {
    const raw = dataSrc(typeof input === "string" || input instanceof URL ? String(input) : input?.url);
    if (!raw || (init?.method && init.method !== "GET")) return orig(input, init);
    return orig(raw, init).then(r => (r.ok ? r : orig(input, init)), () => orig(input, init));
  };
})();
