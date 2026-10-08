// ETF 年化報酬排行：把 learner/watch.html 裡 ETF 專區的每一檔，用 /api/annual 同一套算法（Yahoo 月線還原收盤，含息）
// 算出近 1、3、5、10 年與上市以來的年化報酬、最大跌幅，寫進 learner/data/etf-annual.json。
// GitHub Actions 每週跑一次（.github/workflows/market-hilo.yml 的 annual 工作），網頁打開就有排行；缺的再即時向 /api/annual 補。
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import annual from "../api/_lib/annual.js";

const ROOT = fileURLToPath(new URL("../learner/", import.meta.url)), OUT = ROOT + "data/etf-annual.json";
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 從 watch.html 的 ETF_CATS 取出 [代號, 名稱, 分類]
export function etfList(html) {
  const i = html.indexOf("const ETF_CATS = ["), j = html.indexOf("\n];", i); if (i < 0 || j < 0) return [];
  const out = [], seen = new Set();
  for (const line of html.slice(i, j).split("\n")) { // 一行一個分類：["id", "名稱", "說明", [[代號, 名稱], ...]],
    const m = line.match(/^\s*\["\w+", "([^"]+)", "[^"]*", \[(.*)\]\],?\s*$/); if (!m) continue;
    for (const x of m[2].matchAll(/\["([0-9A-Z]+)", "([^"]+)"\]/g)) if (!seen.has(x[1])) { seen.add(x[1]); out.push([x[1], x[2], m[1]]); }
  }
  return out;
}
const call = code => new Promise(resolve => { const res = { status() { return res; }, setHeader() {}, json(b) { resolve(b); } }; annual({ query: { code } }, res).catch(e => resolve({ ok: false, error: e.message })); });

export async function main({ gap = 800, fetcher = call } = {}) {
  const list = etfList(await readFile(ROOT + "watch.html", "utf8"));
  const rows = [];
  for (const [code, name, cat] of list) {
    const j = await fetcher(code);
    if (j?.ok) rows.push({ code, name, cat, first: j.first, last: j.last, adjusted: !!j.adjusted, p: Object.fromEntries(Object.entries(j.periods || {}).map(([k, v]) => [k, { cagr: v.cagr, mdd: v.mdd, years: v.years }])) });
    else console.log("失敗", code, j?.error);
    await sleep(gap);
  }
  const out = { updated: new Date().toISOString(), source: "Yahoo Finance 月線還原收盤（含配息再投入）", rows };
  await writeFile(OUT, JSON.stringify(out));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok", o.rows.length, "檔")).catch(e => { console.error(e); process.exit(1); });
