// 單一入口：/api/quote、/api/kline… 都由這個 function 依網址分派到 api/_lib/ 裡的處理程式。
// Vercel 免費方案（Hobby）一次部署最多 12 個 serverless function，api/ 底下每個檔案各算一個；
// 收成一個入口後網址不變，之後新增功能也不會超過上限。api/_lib/ 以底線開頭，不會被當成 function。

const ROUTES = {
  annual: () => import("./_lib/annual.js"),
  broker: () => import("./_lib/broker.js"),
  calendar: () => import("./_lib/calendar.js"),
  "chart-read": () => import("./_lib/chart-read.js"),
  chat: () => import("./_lib/chat.js"),
  company: () => import("./_lib/company.js"),
  daily: () => import("./_lib/daily.js"),
  flow: () => import("./_lib/flow.js"),
  futures: () => import("./_lib/futures.js"),
  global: () => import("./_lib/global.js"),
  hot: () => import("./_lib/hot.js"),
  mktstats: () => import("./_lib/mktstats.js"),
  import: () => import("./_lib/import.js"),
  intraday: () => import("./_lib/intraday.js"),
  kline: () => import("./_lib/kline.js"),
  market: () => import("./_lib/market.js"),
  news: () => import("./_lib/news.js"),
  quote: () => import("./_lib/quote.js"),
  screen: () => import("./_lib/screen.js"),
  stockinfo: () => import("./_lib/stockinfo.js"),
  status: () => import("./_lib/status.js"),
  podcast: () => import("./_lib/podcast.js"),
  stocks: () => import("./_lib/stocks.js"),
  usmarket: () => import("./_lib/usmarket.js"),
  warn: () => import("./_lib/warn.js"),
};
export const ROUTE_NAMES = Object.keys(ROUTES);
// 問 AI（對話、讀圖）可能要幾十秒；其他服務幾秒內就回應
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const name = String(req.query?.route || "").toLowerCase();
  const load = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!load) return res.status(404).json({ ok: false, error: `沒有 /api/${name} 這個服務` });
  // 動態路由的參數（route）不要傳給各處理程式，避免和它們自己的查詢參數混在一起
  if (req.query) { const { route, ...rest } = req.query; req.query = rest; }
  const mod = await load();
  return mod.default(req, res);
}
