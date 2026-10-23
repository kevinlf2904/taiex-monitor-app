// 單一入口：/api/quote、/api/kline… 都由這個 function 依網址分派到 api/_lib/ 裡的處理程式。
// Vercel 免費方案（Hobby）一次部署最多 12 個 serverless function，api/ 底下每個檔案各算一個；
// 收成一個入口後網址不變，之後新增功能也不會超過上限。api/_lib/ 以底線開頭，不會被當成 function。

const ROUTES = {
  allk: () => import("./_lib/allk.js"),
  annual: () => import("./_lib/annual.js"),
  broker: () => import("./_lib/broker.js"),
  calendar: () => import("./_lib/calendar.js"),
  "chart-read": () => import("./_lib/chart-read.js"),
  chat: () => import("./_lib/chat.js"),
  company: () => import("./_lib/company.js"),
  confai: () => import("./_lib/confai.js"),
  daily: () => import("./_lib/daily.js"),
  etf: () => import("./_lib/etf.js"),
  flow: () => import("./_lib/flow.js"),
  futures: () => import("./_lib/futures.js"),
  global: () => import("./_lib/global.js"),
  hot: () => import("./_lib/hot.js"),
  mktstats: () => import("./_lib/mktstats.js"),
  import: () => import("./_lib/import.js"),
  intraday: () => import("./_lib/intraday.js"),
  kline: () => import("./_lib/kline.js"),
  macro: () => import("./_lib/macro.js"),
  market: () => import("./_lib/market.js"),
  news: () => import("./_lib/news.js"),
  oapi: () => import("./_lib/oapi.js"),
  quote: () => import("./_lib/quote.js"),
  screen: () => import("./_lib/screen.js"),
  stockinfo: () => import("./_lib/stockinfo.js"),
  status: () => import("./_lib/status.js"),
  sync: () => import("./_lib/sync.js"),
  podcast: () => import("./_lib/podcast.js"),
  poly: () => import("./_lib/poly.js"),
  stocks: () => import("./_lib/stocks.js"),
  symbol: () => import("./_lib/symbol.js"),
  tdcc: () => import("./_lib/tdcc.js"),
  usearn: () => import("./_lib/usearn.js"),
  usinfo: () => import("./_lib/usinfo.js"),
  usmarket: () => import("./_lib/usmarket.js"),
  warn: () => import("./_lib/warn.js"),
  yield: () => import("./_lib/yield.js"),
};
export const ROUTE_NAMES = Object.keys(ROUTES);
const AI_ROUTES = new Set(["chat", "chart-read", "import", "podcast", "confai"]);
// 問 AI（對話、讀圖）可能要幾十秒；其他服務幾秒內就回應。
// 只有這個入口檔的 config 會生效（api/_lib/ 裡的檔案不是 function，寫 config 沒有作用）；請求內容的上限是平台的 4.5MB，各處理程式自己再檢查大小
export const config = { maxDuration: 60 };
// Vercel 的 Node 執行環境解析網址時用到 url.parse()，每個執行個體都會印一次 DEP0169 警告、被記成錯誤日誌，把真正的錯誤淹沒：只濾掉這一個警告
const emitWarning = process.emitWarning;
process.emitWarning = function (w, ...a) { const code = typeof a[0] === "object" ? a[0]?.code : a[1]; if (code === "DEP0169") return; return emitWarning.call(this, w, ...a); };

export default async function handler(req, res) {
  const name = String(req.query?.route || "").toLowerCase();
  const load = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!load) return res.status(404).json({ ok: false, error: `沒有 /api/${name} 這個服務` });
  // 動態路由的參數（route）不要傳給各處理程式，避免和它們自己的查詢參數混在一起
  if (req.query) { const { route, ...rest } = req.query; req.query = rest; }
  // 會花錢的 AI 服務（POST）先檢查次數上限
  if (req.method === "POST" && AI_ROUTES.has(name)) { const { aiLimit } = await import("./_lib/_limit.js"), why = await aiLimit(req, name); if (why) return res.status(429).json({ ok: false, error: why }); }
  const mod = await load();
  return mod.default(req, res);
}
