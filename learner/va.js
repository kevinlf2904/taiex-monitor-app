// Vercel 流量分析（Web Analytics）：只統計匿名的瀏覽次數、從哪裡來、手機或電腦，不用 Cookie、不記個人身分。
// 只在正式網站、最上層頁面載入：本機、預覽網址、嵌在首頁裡的看盤頁和存股頁都不算（不會一頁算兩次）。要在 Vercel 專案的 Analytics 頁按「啟用」才會開始累積。
(() => {
  try {
    if (location.hostname !== "kline-school.vercel.app" || window.top !== window) return;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    const s = document.createElement("script"); s.defer = true; s.src = "/_vercel/insights/script.js"; document.head.appendChild(s);
  } catch { /* 拿不到 window.top 之類的情況就不統計 */ }
})();
