// 訊號回測（選股條件的歷史勝率）：全市場上市櫃普通股過去每一次「技術條件／K 線組合成立」之後，
// 持有 5／10／20 個交易日的平均報酬、中位數、上漲機率，以及和同期間全市場平均比（贏大盤），寫進 learner/data/signal-study.json（看盤「選股 → 訊號回測」）。
// 計算在 learner/sigstudy.js（和網頁同一份，透過 scripts/_engine.mjs 載入）：
//   - 不偷看未來：每一天只拿到那天為止的 K 棒判斷；訊號日收盤後才知道 → 隔天開盤進場，第 n 根收盤出場
//   - 扣來回手續費 0.1425% × 2 與證交稅 0.3%；隔天一字漲停買不到、單日跳動超過 50%（未還原的減資／分割）不算
//   - 同一檔同一條件 5 根內重複成立只算一次；訊號日成交量不到 500 張不算；前 60 根暖機不出訊號
// 條件：learner/tools.js 的 COND（不含「策略訊號」，那些會讓全市場計算多好幾倍時間）用預設參數，加上 learner/analysis.js 的 KPAT（K 線組合）。
// 在 .github/workflows/market-scan.yml 裡、全市場日 K 更新之後執行：日 K 用 .cache/allk.json（最近約 260 個交易日）。
// 限制（網頁上也會寫）：只有約一年的資料、只有現在還在上市櫃的股票（倖存者偏差）。沒有日 K 快取或算不出樣本時保留舊檔。
// 輸出：{ updated, from, to, stocks, ns, cost, minN, defs: [{ id, group, side, name, desc, stats: { 5|10|20: { n, avg, med, p25, p75, win, ex, exWin } | null }, hist: [10 格], recent: [[代號, 名稱, 訊號日, r5, r10, r20]] }] }
//   --dry  只印統計，不寫檔
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { engine } from "./_engine.mjs";

const L = f => fileURLToPath(new URL(`../${f}`, import.meta.url));
const r5 = v => Math.round(v * 1e5) / 1e5;

// 條件清單：[{ id, group, side, name, desc, hit(D, I) }]；id 的 k: 開頭和 learner/watch.html 的 CSCANS 一樣
export function sigDefs(E = engine()) {
  const nm = C => (/\bN\b/.test(C[1]) ? E.condName(C[0]) : C[3] != null ? `${C[1]} ${C[3]}${C[2] === "天數" ? " 天" : ""}` : C[1]);
  return [...E.COND.filter(C => !C[0].startsWith("s:") && typeof C[4] === "function").map(C => ({ id: "c:" + C[0], group: "tech", side: null, name: nm(C), desc: "", hit: (D, I) => C[4](D, I, C[3]) })),
    ...E.KPAT.map(k => ({ id: "k:" + k.id, group: "kline", side: k.side, name: k.name, desc: k.desc, hit: D => k.hit(D) }))];
}
// H 是全市場快取 { date, s: { 代號: { n, b: [{ d, o, h, l, c, v（張） }] } } }；沒有任何樣本回傳 null
export function build(H, E = engine(), now = new Date()) {
  const G = E.G, stocks = Object.entries(H?.s || {}).filter(([c, s]) => /^[1-9]\d{3}$/.test(c) && s?.b?.length > G.SIG_WARM).map(([c, s]) => ({ c, n: s.n || c, bars: s.b }));
  if (!stocks.length) return null;
  const defs = G.sigStudy(stocks, sigDefs(E), E.indicators); if (!defs.some(x => x.stats[G.SIG_NS[0]]?.n)) return null;
  const days = stocks.flatMap(s => [s.bars[0].d, s.bars.at(-1).d]).sort();
  return { updated: now.toISOString(), from: days[0], to: days.at(-1), stocks: stocks.length, ns: [...G.SIG_NS], cost: r5(G.SIG_COST), minN: G.SIG_MIN_N, defs };
}
export async function main({ cache = process.env.SIG_CACHE || L(".cache/allk.json"), out = L("learner/data/signal-study.json"), dry = process.argv.includes("--dry") } = {}) {
  let H; try { H = JSON.parse(await readFile(cache, "utf8")); } catch { console.log("::warning::沒有全市場日 K 快取，訊號回測保留舊檔"); return null; }
  const t = Date.now(), R = build(H); if (!R) { console.log("::warning::算不出任何訊號樣本，訊號回測保留舊檔"); return null; }
  const last = R.ns.at(-1);
  console.log(`訊號回測完成（${R.from}～${R.to}・${R.stocks} 檔・${Math.round((Date.now() - t) / 1000)} 秒）：`, R.defs.map(x => `${x.name} ${x.stats[last]?.n ?? 0} 筆`).join("、"));
  if (!dry) await writeFile(out, JSON.stringify(R));
  return R;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::訊號回測這次沒有更新：" + e.message); });
