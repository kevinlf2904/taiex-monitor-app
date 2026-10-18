// 台指期 1 分 K 存檔：期交所行情網站只給「目前這一盤」的 1 分 K，所以每盤收盤後存一份，
// 看盤的台指期分 K 往左拉時讀這些檔，才看得到前幾天（和券商 App 一樣可以一直往前）。
// 輸出 learner/data/fut1m/TXF/<開盤日>-<day|night>.json（bars: [時間, 開, 高, 低, 收, 量, 日期]）與 index.json（依時間排序的盤別清單，留最近 120 盤）。
// 由 .github/workflows/fut-1m.yml 在日盤收盤後（台北 14:05）與夜盤收盤後（台北 05:20）執行。
//   --dump  只印出抓到的根數，不寫檔
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { nearMonth, fromTaifex } from "../api/_lib/futures.js";

const DIR = fileURLToPath(new URL("../learner/data/fut1m/TXF/", import.meta.url)), DUMP = process.argv.includes("--dump"), KEEP = 120;
const iso = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
// 一根 K 屬於哪一盤：夜盤從 15:00 開始、跨到隔天 05:00，用「開盤那天」當名字
export function sessionKey(b) { return b.s === "night" ? `${iso(b.at - 15 * 3600e3)}-night` : `${b.d}-day`; }
export function groupSessions(bars) {
  const m = new Map();
  for (const b of bars) { const k = sessionKey(b); (m.get(k) || m.set(k, []).get(k)).push(b); }
  return [...m].map(([k, L]) => { L.sort((a, b) => a.at - b.at); return { k, s: L[0].s, first: `${L[0].d} ${L[0].t}`, last: `${L.at(-1).d} ${L.at(-1).t}`, n: L.length, bars: L.map(b => [b.t, b.o, b.h, b.l, b.c, b.v, b.d]) }; });
}
export async function main() {
  const nm = nearMonth(), r = await fromTaifex(nm.code, "TXF", true), S = groupSessions(r.bars || []);
  console.log(nm.code, "共", r.bars?.length || 0, "根", S.map(x => `${x.k}:${x.n}`).join(" "));
  if (DUMP || !S.length) return;
  await mkdir(DIR, { recursive: true });
  const idx = await readFile(DIR + "index.json", "utf8").then(JSON.parse).catch(() => ({ sessions: [] }));
  for (const x of S) {
    // 盤中途抓到的不完整（例如排程延遲、剛好在交易中），之後再抓到比較多根的會蓋過去
    const old = idx.sessions.find(o => o.k === x.k); if (old && old.n >= x.n) continue;
    await writeFile(DIR + x.k + ".json", JSON.stringify({ k: x.k, s: x.s, contract: nm.code, bars: x.bars }));
    idx.sessions = [...idx.sessions.filter(o => o.k !== x.k), { k: x.k, s: x.s, first: x.first, last: x.last, n: x.n }];
  }
  idx.sessions.sort((a, b) => a.first.localeCompare(b.first));
  for (const o of idx.sessions.slice(0, Math.max(0, idx.sessions.length - KEEP))) await rm(DIR + o.k + ".json", { force: true });
  idx.sessions = idx.sessions.slice(-KEEP); idx.updated = new Date().toISOString();
  await writeFile(DIR + "index.json", JSON.stringify(idx));
  console.log("已存", idx.sessions.length, "盤");
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
