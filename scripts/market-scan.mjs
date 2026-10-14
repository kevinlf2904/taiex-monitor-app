// 全市場日 K：每個交易日收盤後，把上市櫃全部股票與 ETF（約 1800 檔）最近的日 K 整理好，給看盤「條件選股」「相對強弱」選「全市場」時使用。
// 做法：
//   1. 歷史日 K 存在 .cache/allk.json（不進 git，靠 GitHub Actions 的快取在每次執行之間保留）；第一次或有新上市的股票，用 Yahoo Finance 補一年。
//   2. 每天用證交所 STOCK_DAY_ALL、櫃買中心 tpex_mainboard_quotes（全部股票當天的開高低收量）接上最新一天。
//   3. 輸出最近 130 個交易日，依代號第一碼分成 10 份（out/allk-0.json … allk-9.json），由 workflow 上傳到 GitHub Release「market-data」，
//      網站透過 /api/allk?s=0..9 讀取（不放進 git，避免每天幾 MB 的資料讓 repo 越來越大）。
// 成交量單位：張（和 /api/kline 一樣）。
//   --dry   只更新快取、印統計，不輸出檔案

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseTwseAll, parseTpexAll } from "../api/_lib/hot.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url)), CACHE = ROOT + ".cache/allk.json", OUT = ROOT + "out/";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "application/json" };
const KEEP = 260, PUB = 130, DRY = process.argv.includes("--dry");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async (url, ms = 20000) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

// Yahoo 一年日 K → [{ d, o, h, l, c, v（張） }]
export async function yahooYear(code, market) {
  for (const sym of market === "上櫃" ? [`${code}.TWO`, `${code}.TW`] : [`${code}.TW`, `${code}.TWO`]) {
    try {
      const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1y&interval=1d`), r = j?.chart?.result?.[0]; if (!r?.timestamp) continue;
      const q = r.indicators.quote[0], off = (r.meta.gmtoffset ?? 28800) * 1000;
      const rows = r.timestamp.map((t, k) => ({ d: new Date(t * 1000 + off).toISOString().slice(0, 10), o: r2(q.open[k]), h: r2(q.high[k]), l: r2(q.low[k]), c: r2(q.close[k]), v: q.volume[k] != null ? Math.round(q.volume[k] / 1000) : 0 })).filter(x => x.c != null && x.o != null);
      if (rows.length) return rows;
    } catch {}
  }
  return null;
}
// 把今天的全市場資料接到每檔的歷史後面（同一天就覆蓋）
export function appendDay(H, list) {
  let n = 0;
  for (const x of list) {
    if (!x.date || !(x.price > 0)) continue;
    const s = (H.s[x.code] ||= { n: x.name, m: x.market, b: [] }); s.n = x.name || s.n; s.m = x.market;
    const bar = { d: x.date, o: r2(x.o ?? x.price), h: r2(x.h ?? x.price), l: r2(x.l ?? x.price), c: r2(x.price), v: x.vol ?? 0 };
    const last = s.b[s.b.length - 1]; if (last?.d === x.date) s.b[s.b.length - 1] = bar; else if (!last || last.d < x.date) { s.b.push(bar); n++; }
    if (s.b.length > KEEP) s.b.splice(0, s.b.length - KEEP);
  }
  return n;
}
// 分片輸出：共同日期軸（最近 PUB 個交易日），每檔 [o[], h[], l[], c[], v[]]，缺的日子放 null
export function shards(H) {
  const cnt = new Map(); for (const s of Object.values(H.s)) for (const b of s.b.slice(-PUB - 20)) cnt.set(b.d, (cnt.get(b.d) || 0) + 1);
  const total = Object.keys(H.s).length, axis = [...cnt].filter(([, n]) => n >= total * 0.3).map(([d]) => d).sort().slice(-PUB), idx = new Map(axis.map((d, i) => [d, i]));
  const out = Array.from({ length: 10 }, () => ({ d: axis, n: {}, m: {}, k: {} }));
  for (const [code, s] of Object.entries(H.s)) {
    const sh = out[+code[0]] || out[0], a = [[], [], [], [], []].map(() => Array(axis.length).fill(null)); let any = false;
    for (const b of s.b) { const i = idx.get(b.d); if (i == null) continue; a[0][i] = b.o; a[1][i] = b.h; a[2][i] = b.l; a[3][i] = b.c; a[4][i] = b.v; any = true; }
    if (!any) continue; sh.n[code] = s.n; sh.m[code] = s.m === "上櫃" ? 1 : 0; sh.k[code] = a;
  }
  return out;
}

export async function main() {
  let H = { s: {} }; try { H = JSON.parse(await readFile(CACHE, "utf8")); console.log("快取", Object.keys(H.s).length, "檔"); } catch { console.log("沒有快取，從頭建立"); }
  const [a, b] = await Promise.allSettled([get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll), get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll)]);
  const list = [...(a.value || []), ...(b.value || [])]; if (!list.length) throw new Error("拿不到今天的全市場資料：" + [a.reason?.message, b.reason?.message].filter(Boolean).join("；"));
  console.log("今天", list.length, "檔，日期", [...new Set(list.map(x => x.date))].join("、"));
  // 歷史不夠 70 天的（新股票或第一次）用 Yahoo 補一年；一次最多補 2500 檔，6 條並行
  const need = list.filter(x => (H.s[x.code]?.b.length || 0) < 70); let k = 0, ok = 0;
  console.log("需要補歷史", need.length, "檔");
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < need.length) { const x = need[k++]; const rows = await yahooYear(x.code, x.market);
    if (rows) { const s = (H.s[x.code] ||= { n: x.name, m: x.market, b: [] }), have = new Set(s.b.map(b => b.d)); s.b = [...s.b, ...rows.filter(r => !have.has(r.d))].sort((p, q) => p.d.localeCompare(q.d)).slice(-KEEP); ok++; }
    if (k % 200 === 0) console.log("補歷史", k, "/", need.length); await sleep(120); } }));
  console.log("補到", ok, "檔");
  const added = appendDay(H, list); console.log("接上今天", added, "檔");
  // 已下市（今天清單沒有、而且 10 個交易日沒更新）的移除
  const today = list[0].date, codes = new Set(list.map(x => x.code));
  for (const [c, s] of Object.entries(H.s)) if (!codes.has(c) && (!s.b.length || Date.parse(today) - Date.parse(s.b[s.b.length - 1].d) > 20 * 864e5)) delete H.s[c];
  H.updated = new Date().toISOString(); H.date = today;
  await mkdir(ROOT + ".cache", { recursive: true }); await writeFile(CACHE, JSON.stringify(H));
  if (DRY) return H;
  const S = shards(H); await mkdir(OUT, { recursive: true });
  for (const [i, s] of S.entries()) await writeFile(`${OUT}allk-${i}.json`, JSON.stringify({ updated: H.updated, date: today, ...s }));
  await writeFile(`${OUT}allk-meta.json`, JSON.stringify({ updated: H.updated, date: today, count: Object.keys(H.s).length, days: S[0].d.length, from: S[0].d[0] }));
  console.log("輸出", S.map(s => Object.keys(s.k).length).join("/"), "檔，", S[0].d.length, "天");
  return H;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
