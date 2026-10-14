// ETF 殖利率排行：全部台股 ETF（上市＋上櫃，代號 00 開頭），用 /api/yield 同一套算法（Yahoo 配息紀錄，近 12 個月現金股利 ÷ 股價）
// 算出殖利率，寫進 learner/data/etf-yield.json。GitHub Actions 每個交易日收盤後跑一次（.github/workflows/etf-yield.yml）；
// 網頁打開就有排行，盤中再用即時股價重算殖利率。
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseTwseAll, parseTpexAll } from "../api/_lib/hot.js";
import { yieldOf } from "../api/_lib/yield.js";

const OUT = fileURLToPath(new URL("../learner/data/etf-yield.json", import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = async url => { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
export const isEtf = c => /^00\d{2,4}[A-Z]?$/.test(c);

export async function etfAll(get = getJSON) {
  const [a, b] = await Promise.allSettled([get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll), get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll)]);
  const seen = new Set();
  return [...(a.value || []), ...(b.value || [])].filter(x => isEtf(x.code) && !seen.has(x.code) && seen.add(x.code)).map(x => ({ code: x.code, name: x.name, market: x.market, vol: x.vol }));
}
export async function main({ gap = 350, list = null, calc = yieldOf } = {}) {
  const L = list || (await etfAll()); if (!L.length) throw new Error("拿不到 ETF 清單");
  const rows = [];
  for (const e of L) {
    try { const y = await calc(e.code); if (y) rows.push({ code: e.code, name: e.name, market: e.market, cash12: y.cash12, n: y.n, last: y.last, price: y.price, yield: y.yield }); } catch (err) { console.log("失敗", e.code, err.message); }
    await sleep(gap);
  }
  const out = { updated: new Date().toISOString(), source: "Yahoo Finance 配息紀錄（近 12 個月現金股利 ÷ 股價）", rows };
  await writeFile(OUT, JSON.stringify(out));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok", o.rows.length, "檔，有配息", o.rows.filter(r => r.n).length)).catch(e => { console.error(e); process.exit(1); });
