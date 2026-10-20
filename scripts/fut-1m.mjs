// 台指期 1 分 K 存檔：期交所行情網站只給「目前這一盤」的 1 分 K，所以每盤收盤後存一份，
// 看盤的台指期分 K 往左拉時讀這些檔，才看得到前幾天（和券商 App 一樣可以一直往前）。
// 輸出 learner/data/fut1m/TXF/<開盤日>-<day|night>.json（bars: [時間, 開, 高, 低, 收, 量, 日期]）與 index.json（依時間排序的盤別清單，留最近 120 盤）。
// 由 .github/workflows/fut-1m.yml 在日盤收盤後（台北 14:05）與夜盤收盤後（台北 05:20）執行。
//   --dump  只印出抓到的根數，不寫檔
//   --backfill[=天數]  補歷史：改抓期交所「前 30 個交易日期貨每筆成交資料」壓縮檔，把台指期（TX）逐筆成交合成 1 分 K
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
  return [...m].map(([k, L]) => { L.sort((a, b) => a.at - b.at); return { k, s: L[0].s, mon: L[0].mon, first: `${L[0].d} ${L[0].t}`, last: `${L.at(-1).d} ${L.at(-1).t}`, n: L.length, bars: L.map(b => [b.t, b.o, b.h, b.l, b.c, b.v, b.d]) }; });
}
// 期交所逐筆成交 CSV（Daily_YYYY_MM_DD.csv）→ 台指期 1 分 K。2026-10 用 probe-live 看到的格式：
//   成交日期,商品代號,到期月份(週別),成交時間,成交價格,成交數量(B+S),近月價格,遠月價格,開盤集合競價
//   20261016,TX     ,202610     ,084500,47228,298,-,-,*
// 一個檔＝前一天 15:00 開始的夜盤（15:00～23:59 標前一天、00:00～05:00 標當天）＋當天日盤；成交數量是買賣雙邊合計，要除以 2。
// 價差單（202610/202611）不算；同一盤只取成交量最大的那個月份（近月，結算週會換到下個月）。
// 分 K 時間用「這一分鐘開始」，收盤集合競價（13:45:00、05:00:00）併進最後一根，和期交所行情網站的 1 分 K 一致。
export function ticksToBars(csv, sym = "TX") {
  const re = new RegExp(`^(\\d{8}),\\s*${sym}\\s*,\\s*(\\d{6})\\s*,\\s*(\\d{6}),\\s*([\\d.]+)\\s*,\\s*(\\d+)`, "gm"), by = new Map();
  for (const m of csv.matchAll(re)) {
    const [, dt, mon, tm, px, q] = m; let hh = +tm.slice(0, 2), mm = +tm.slice(2, 4); const night = hh >= 15 || hh < 5 || (hh === 5 && mm === 0);
    if (!night && (hh < 8 || (hh === 8 && mm < 45) || hh > 13 || (hh === 13 && mm > 45))) continue;
    if (hh === 13 && mm === 45) mm = 44; else if (hh === 5 && mm === 0) { hh = 4; mm = 59; } // 收盤集合競價併進最後一根
    const d = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6)}`, t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, at = Date.parse(`${d}T${t}:00+08:00`), s = night ? "night" : "day";
    const k = `${sessionKey({ s, at, d })}|${mon}`; let B = by.get(k); if (!B) by.set(k, (B = new Map()));
    const p = +px, v = +q / 2, b = B.get(at);
    if (!b) B.set(at, { at, d, t, o: p, h: p, l: p, c: p, v, s, n: +tm }); else { if (+tm < b.n) { b.o = p; b.n = +tm; } b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); b.c = p; b.v += v; } // 檔案依時間排序；保險起見開盤價用最早那筆
  }
  // 每一盤挑成交量最大的月份
  const best = new Map();
  for (const [k, B] of by) { const [sk, mon] = k.split("|"), vol = [...B.values()].reduce((a, b) => a + b.v, 0); if (!best.has(sk) || best.get(sk).vol < vol) best.set(sk, { mon, vol, B }); }
  return [...best.values()].flatMap(({ mon, B }) => [...B.values()].map(({ n, ...b }) => ({ ...b, v: Math.round(b.v), mon }))).sort((a, b) => a.at - b.at);
}
async function backfill(days) {
  const { execFileSync } = await import("node:child_process"), os = await import("node:os"), UA = { "User-Agent": "Mozilla/5.0" };
  const idx = await readFile(DIR + "index.json", "utf8").then(JSON.parse).catch(() => ({ sessions: [] })), have = new Set(idx.sessions.filter(o => o.n >= (o.s === "night" ? 800 : 290)).map(o => o.k));
  const all = [];
  for (let i = 0, got = 0; i < days * 1.6 + 6 && got < days; i++) {
    const dd = iso(Date.now() - i * 864e5); if ([0, 6].includes(new Date(dd + "T00:00:00Z").getUTCDay())) continue;
    const prevNight = iso(Date.parse(dd + "T12:00:00+08:00") - 864e5 * ([1].includes(new Date(dd + "T00:00:00Z").getUTCDay()) ? 3 : 1));
    if (have.has(`${dd}-day`) && have.has(`${prevNight}-night`)) { got++; continue; } // 這天的日盤與前一盤夜盤都已經有完整的檔
    const u = `https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_${dd.replace(/-/g, "_")}.zip`;
    try {
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(180000) });
      if (r.status !== 200 || /html/i.test(r.headers.get("content-type") || "")) { console.log(dd, "沒有檔（假日或超過 30 個交易日）"); continue; }
      const f = os.tmpdir() + `/fut-${dd}.zip`; await writeFile(f, Buffer.from(await r.arrayBuffer()));
      const csv = execFileSync("unzip", ["-p", f], { maxBuffer: 1 << 30 }).toString("latin1"), B = ticksToBars(csv); await rm(f, { force: true });
      console.log(dd, "逐筆→", B.length, "根", [...new Set(B.map(b => b.mon))].join(",")); all.push(...B); got++;
    } catch (e) { console.log(dd, "失敗", e.message); }
  }
  return all;
}
export async function main() {
  const bfArg = process.argv.find(a => a.startsWith("--backfill")), nm = nearMonth();
  const r = bfArg ? { bars: await backfill(+(bfArg.split("=")[1] || 30) || 30) } : await fromTaifex(nm.code, "TXF", true), S = groupSessions(r.bars || []);
  console.log(bfArg ? "補歷史" : nm.code, "共", r.bars?.length || 0, "根", S.map(x => `${x.k}:${x.n}`).join(" "));
  if (DUMP || !S.length) return;
  await mkdir(DIR, { recursive: true });
  const idx = await readFile(DIR + "index.json", "utf8").then(JSON.parse).catch(() => ({ sessions: [] }));
  for (const x of S) {
    // 盤中途抓到的不完整（例如排程延遲、剛好在交易中），之後再抓到比較多根的會蓋過去
    const old = idx.sessions.find(o => o.k === x.k); if (old && old.n >= x.n) continue;
    await writeFile(DIR + x.k + ".json", JSON.stringify({ k: x.k, s: x.s, contract: x.mon ? `TX${x.mon}` : nm.code, bars: x.bars }));
    idx.sessions = [...idx.sessions.filter(o => o.k !== x.k), { k: x.k, s: x.s, first: x.first, last: x.last, n: x.n }];
  }
  idx.sessions.sort((a, b) => a.first.localeCompare(b.first));
  for (const o of idx.sessions.slice(0, Math.max(0, idx.sessions.length - KEEP))) await rm(DIR + o.k + ".json", { force: true });
  idx.sessions = idx.sessions.slice(-KEEP); idx.updated = new Date().toISOString();
  await writeFile(DIR + "index.json", JSON.stringify(idx));
  console.log("已存", idx.sessions.length, "盤");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
