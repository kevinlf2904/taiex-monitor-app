// 台股內部人持股轉讓：董事、監察人、經理人、持股超過 10% 的大股東要轉讓（賣出、贈與、信託…）股票前，必須先向主管機關申報。
// 這支程式從證交所、櫃買中心的 OpenAPI 找出「持股轉讓事前申報」的資料集，整理成 learner/data/insider.json，
// 給 learner/watch.html「工具 → 內部人申報」和個股頁使用。GitHub Actions 每個交易日跑（.github/workflows/insider.yml）。
// 資料集路徑由 OpenAPI 的 swagger.json 依名稱找（名稱含「轉讓」），欄位也依中文欄名判斷，換路徑或欄位順序也能讀。
// 申報後一個月內（盤後鉅額、一般交易）才可轉讓，所以「申報」不等於已經賣出；最近約 3 年的申報會累積保留。
//   --dump  只列出找到的資料集與前幾筆原始資料，不寫檔（除錯用）
//   --year 2025 [--minutes 80]  補更早的年份：從公開資訊觀測站「持股轉讓日報表」逐日查那一年上市、上櫃的申報，存到 learner/data/insider-arch/2025.json＋index.json
//     （OpenAPI 只有最近幾天；網頁選的期間比主檔早時才讀年份檔）。查過的日子記在年份檔的 days，時間不夠先存，再跑一次接著查。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../learner/data/insider.json", import.meta.url));
const UA = "Mozilla/5.0 (compatible; kline-school-learner; +https://github.com/kevinlf2904/taiex-monitor-app)";
const DUMP = process.argv.includes("--dump"), KEEP = 1100; // 保留約 3 年，網頁可以往前查
const get = async url => { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

const SOURCES = [["上市", "https://openapi.twse.com.tw/v1", "https://openapi.twse.com.tw/v1/swagger.json"], ["上櫃", "https://www.tpex.org.tw/openapi/v1", "https://www.tpex.org.tw/openapi/swagger.json"]];

// 民國或西元日期 → YYYY-MM-DD（1150105、115/01/05、2026-01-05、20260105）
export function toIso(s) {
  const t = String(s ?? "").trim(); let m;
  if ((m = t.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{2,3})[-/]?(\d{2})[-/]?(\d{2})$/))) return `${+m[1] + 1911}-${m[2]}-${m[3]}`;
  return null;
}
const num = s => { const v = +String(s ?? "").replace(/[,\s]/g, ""); return Number.isFinite(v) ? v : null; };
// swagger 裡名稱含「轉讓」的 GET 路徑（「持股未轉讓日報表」是申報後沒轉讓的追蹤，不算）
export function findPaths(sw) {
  return Object.entries(sw?.paths || {}).filter(([, v]) => v.get).map(([p, v]) => [p, `${v.get.summary || ""} ${v.get.description || ""} ${(v.get.tags || []).join(" ")}`]).filter(([, t]) => /轉讓/.test(t) && !/未轉讓/.test(t));
}
// 一筆原始資料 → 統一欄位；欄名用關鍵字找（上櫃的日期、代號、名稱是英文欄名）
// 股數：預定轉讓總股數、目前持有、轉讓後持股都是「自有持股＋保留運用決定權信託股數」兩欄相加；「轉讓方式及股數-轉讓股數」常是空的
export function normRow(r, market) {
  const ks = Object.keys(r), k = (...re) => { for (const e of re) { const x = ks.find(y => e.test(y)); if (x) return x; } };
  const sum = re => { const L = ks.filter(x => re.test(x)); if (!L.length) return null; const v = L.map(x => num(r[x])).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const kD = k(/申報日/, /出表日/, /^Date$/i, /日期/), kC = k(/公司代號/, /CompanyCode/i, /代號/), kN = k(/公司名稱/, /公司簡稱/, /CompanyName/i);
  const kW = k(/身分/, /職稱/), kP = k(/姓名/), kM = k(/轉讓方式/), kTo = k(/受讓人/), kR = k(/有效轉讓期間/, /期間/);
  const code = String(r[kC] ?? "").trim(), d = toIso(r[kD]); if (!/^\d{4,6}[A-Z]?$/.test(code) || !d) return null;
  const range = kR ? String(r[kR] ?? "").trim().split(/[~～-]/).map(toIso).filter(Boolean) : [];
  return { d, code, name: String(r[kN] ?? "").trim(), who: String(r[kP] ?? "").trim(), role: String(r[kW] ?? "").trim(), how: String(r[kM] ?? "").trim(),
    sh: sum(/^預定轉讓總股數/) ?? num(r[k(/轉讓股數/)]), hold: sum(/^目前持有股數/), after: sum(/^預定轉讓後持股/), to: kTo ? String(r[kTo] ?? "").trim() : "", from: range[0] || null, until: range[1] || range[0] || null, market };
}

export async function main() {
  let old = { rows: [] }; try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const got = [], notes = [], used = [];
  for (const [market, base, swUrl] of SOURCES) {
    let paths = [];
    try { paths = findPaths(await get(swUrl)); } catch (e) { notes.push(`${market} swagger：${e.message}`); }
    if (DUMP) console.log(market, "找到的資料集：", JSON.stringify(paths));
    for (const [p, t] of paths) {
      try { const j = await get(base + p), L = Array.isArray(j) ? j : j?.data || [];
        if (DUMP) console.log(market, p, t.trim(), "筆數", L.length, "欄位", JSON.stringify(Object.keys(L[0] || {})), "\n範例", JSON.stringify(L.slice(0, 2)));
        const rows = L.map(r => normRow(r, market)).filter(Boolean); if (rows.length) { got.push(...rows); used.push(`${market} ${t.trim().slice(0, 30)}`); } }
      catch (e) { notes.push(`${market} ${p}：${e.message}`); }
    }
  }
  if (DUMP) { console.log("整理後範例", JSON.stringify(got.slice(0, 5)), "共", got.length, "筆；", notes.join("；")); return { rows: got, notes }; }
  // 當天沒有任何申報（假日、沒人申報）或資料集暫時讀不到：保留原本累積的資料，不覆寫、不讓排程失敗
  if (!got.length) { console.log("::warning::這次沒讀到任何申報，保留原本的資料：" + (notes.join("；") || "資料集是空的")); return { rows: old.rows || [], notes, skipped: true }; }
  const from = new Date(Date.now() - KEEP * 864e5).toISOString().slice(0, 10), seen = new Set(), rows = [];
  for (const r of [...got, ...(old.rows || [])]) { const key = [r.d, r.code, r.who, r.how, r.sh].join("|"); if (r.d >= from && !seen.has(key)) { seen.add(key); rows.push(r); } }
  rows.sort((a, b) => b.d.localeCompare(a.d) || a.code.localeCompare(b.code));
  const out = { updated: new Date().toISOString(), source: "證交所、櫃買中心 OpenAPI：董監事、經理人及大股東持股轉讓事前申報", sets: used, rows, notes };
  await writeFile(OUT, JSON.stringify(out));
  return out;
}
// ---------- 補更早的年份（公開資訊觀測站 持股轉讓日報表） ----------
// 第一步（ajax_t56sb12_q1／q2）只回一張要再送的表單；直接送第二步：step=2、report＝SY（上市）／OY（上櫃），日期用民國年
const MOPS = "https://mopsov.twse.com.tw/mops/web/ajax_t56sb12", ARCH = fileURLToPath(new URL("../learner/data/insider-arch/", import.meta.url));
const cellsOf = tr => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
// 日報表 HTML → 和 OpenAPI 一樣的列（normRow 的欄位）。欄位依「申報日期」那格往後數：代號、名稱、身分、姓名、轉讓方式、轉讓股數、每日盤中最大得轉讓股數、受讓人、
// 目前持有（自有、信託）、預定轉讓總股數（自有、信託）、預定轉讓後持股（自有、信託）、有效轉讓期間
export function parseMopsDay(html, market) {
  const out = [];
  for (const m of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const c = cellsOf(m[1]), i = c.findIndex(x => /^\d{2,3}\/\d{2}\/\d{2}$/.test(x)); if (i < 0 || c.length < i + 16) continue;
    const d = toIso(c[i]), code = c[i + 1]; if (!d || !/^\d{4,6}[A-Z]?$/.test(code)) continue;
    const two = k => { const a = num(c[k]), b = num(c[k + 1]); return a == null && b == null ? null : (a || 0) + (b || 0); }, range = c[i + 15].split(/[~～]/).map(toIso).filter(Boolean);
    out.push({ d, code, name: c[i + 2], who: c[i + 4], role: c[i + 3], how: c[i + 5], sh: two(i + 11) ?? num(c[i + 6]), hold: two(i + 9), after: two(i + 13), to: c[i + 8], from: range[0] || null, until: range[1] || range[0] || null, market });
  }
  return out;
}
const mopsDay = async (iso, report) => { const [y, m, d] = iso.split("-"), body = `encodeURIComponent=1&step=2&year=${+y - 1911}&month=${m}&day=${d}&report=${report}&firstin=true`;
  for (let k = 0; ; k++) { const r = await fetch(MOPS, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(30000) }); const t = await r.text();
    if (r.ok && !/查詢過於頻繁|頻繁|稍後再試|安全性考量/.test(t)) return t; if (k >= 3) throw new Error(`HTTP ${r.status}${/頻繁/.test(t) ? "（查詢太頻繁）" : ""}`); await new Promise(z => setTimeout(z, 15000 * (k + 1))); } };
export async function archive(year, { minutes = 80, log = console.log } = {}) {
  const y = +year, today = new Date().toISOString().slice(0, 10); if (!(y >= 2008 && `${y}` <= today.slice(0, 4))) throw new Error(`年份不對：${year}`);
  const f = `${ARCH}${y}.json`, prev = await readFile(f, "utf8").then(JSON.parse).catch(() => ({ rows: [], days: {} })), days = prev.days || {}, rows = [...(prev.rows || [])], seen = new Set(rows.map(r => [r.d, r.code, r.who, r.how, r.sh].join("|")));
  const deadline = Date.now() + minutes * 60e3; let left = 0, fail = 0;
  for (let t = Date.parse(`${y}-01-01`); t <= Date.parse(`${y}-12-31`); t += 864e5) {
    const iso = new Date(t).toISOString().slice(0, 10), wd = new Date(t).getUTCDay(); if (iso >= today || wd === 0 || wd === 6) continue;
    for (const [rep, market] of [["SY", "上市"], ["OY", "上櫃"]]) {
      const key = `${iso}:${rep}`; if (days[key] != null) continue; if (Date.now() > deadline) { left++; continue; }
      try { const L = parseMopsDay(await mopsDay(iso, rep), market); for (const r of L) { const k = [r.d, r.code, r.who, r.how, r.sh].join("|"); if (!seen.has(k)) { seen.add(k); rows.push(r); } } days[key] = L.length; }
      catch (e) { fail++; log(`  ${key} 失敗：${e.message}`); }
      await new Promise(z => setTimeout(z, 1200));
    }
  }
  rows.sort((a, b) => b.d.localeCompare(a.d) || a.code.localeCompare(b.code));
  const done = !left && !fail, out = { year: y, updated: new Date().toISOString(), done, source: "公開資訊觀測站 股權轉讓事前申報－上市、上櫃公司持股轉讓日報表", rows, days };
  await mkdir(ARCH, { recursive: true }); await writeFile(f, JSON.stringify(out));
  const idx = await readFile(`${ARCH}index.json`, "utf8").then(JSON.parse).catch(() => ({ years: {} })), D = rows.map(r => r.d).sort();
  idx.years[y] = { n: rows.length, from: D[0] || null, to: D.at(-1) || null, done }; idx.updated = out.updated; await writeFile(`${ARCH}index.json`, JSON.stringify(idx));
  log(`${y} 年：${rows.length} 筆申報${done ? "，查完了" : `，還有 ${left} 天沒查、${fail} 天失敗（再跑一次會接著查）`}`);
  return out;
}
if (process.argv[2] === "--year") archive(process.argv[3], { minutes: +(process.argv[process.argv.indexOf("--minutes") + 1]) || 80 }).catch(e => { console.error(e); process.exit(1); });
else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log(o.skipped ? "沒有更新" : "完成", o.rows?.length ?? 0, "筆", (o.notes || []).join("；"))).catch(e => { console.error(e); process.exit(1); });
