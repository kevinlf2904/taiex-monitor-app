// ETF 成分股變動：每個交易日晚上抓一次 ETF 的全部持股（MoneyDJ，見 api/_lib/etf.js），和上次存的比對，
// 記下「納入」「剔除」的成分股，存成 learner/data/etf-hold/<代號>.json（最新持股、上一次持股、最近一年的變動事件）。
// 追蹤的 ETF：看盤「ETF 專區」分類裡的台股 ETF，加上常見的美股 ETF。網頁上其他 ETF 仍可即時看持股，只是沒有變動紀錄。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { etfData } from "../api/_lib/etf.js";

const DIR = fileURLToPath(new URL("../learner/data/etf-hold/", import.meta.url)), WATCH = fileURLToPath(new URL("../learner/watch.html", import.meta.url));
const US = ["SPY", "QQQ", "VOO", "VTI", "IVV", "DIA", "IWM", "SOXX", "SMH", "XLK", "SCHD", "VYM", "VT", "ARKK", "TQQQ", "SOXL"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = r => r[0] || r[1];
// 前後兩次持股 → 納入、剔除（只看成分股名單；股數每天會隨申購贖回變動，不算）
export function diff(prev, cur, d) {
  const P = new Map(prev.map(r => [key(r), r])), C = new Map(cur.map(r => [key(r), r])), ev = [];
  for (const [k, r] of C) if (!P.has(k)) ev.push({ d, t: "in", code: r[0], name: r[1], pct: r[2] });
  for (const [k, r] of P) if (!C.has(k)) ev.push({ d, t: "out", code: r[0], name: r[1], pct: r[2] });
  return ev;
}
export function update(old, code, data, now = new Date()) {
  const rows = data.hold.rows.map(r => [r.code, r.name, r.pct, r.sh]), date = data.hold.date || now.toISOString().slice(0, 10);
  if (old && old.date === date) return { ...old, name: data.info?.name || old.name }; // 同一天的資料，不重複比對
  const ev = old?.rows?.length ? diff(old.rows, rows, date) : [], cut = new Date(now.getTime() - 400 * 864e5).toISOString().slice(0, 10);
  return { code, name: data.info?.name || old?.name || code, date, rows, prev: old?.rows?.length ? { date: old.date, rows: old.rows } : old?.prev || null, ev: [...ev, ...(old?.ev || [])].filter(e => e.d >= cut).slice(0, 300), since: old?.since || date };
}
export async function main() {
  const html = await readFile(WATCH, "utf8"), cats = html.slice(html.indexOf("const ETF_CATS"), html.indexOf("];", html.indexOf("const ETF_CATS")));
  const tw = [...new Set([...cats.matchAll(/\["(00\d{2,4}[A-Z]?)", "/g)].map(m => m[1]))], codes = [...tw, ...US], index = { updated: new Date().toISOString(), codes: {} };
  await mkdir(DIR, { recursive: true }); let ok = 0, fail = [];
  for (const c of codes) {
    try { const data = await etfData(c, 20000); if (!data.ok || !data.hold?.rows?.length) { fail.push(c); continue; }
      const f = DIR + c + ".json", old = await readFile(f, "utf8").then(JSON.parse).catch(() => null), nu = update(old, c, data);
      await writeFile(f, JSON.stringify(nu)); index.codes[c] = { name: nu.name, date: nu.date, n: nu.rows.length, ev: nu.ev.length }; ok++;
      if (nu.ev.length && nu.ev[0].d === nu.date && old?.date !== nu.date) console.log(c, nu.name, "變動：", nu.ev.filter(e => e.d === nu.date).map(e => (e.t === "in" ? "+" : "-") + e.name).join(" "));
    } catch (e) { fail.push(`${c}(${e.message})`); }
    await sleep(600);
  }
  await writeFile(DIR + "index.json", JSON.stringify(index));
  console.log("完成", ok, "檔", fail.length ? "；失敗：" + fail.join("、") : "");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.log("::warning::ETF 持股這次沒有更新：" + e.message); });
