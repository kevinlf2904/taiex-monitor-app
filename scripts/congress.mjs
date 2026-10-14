// 國會山交易：美國國會議員依《STOCK Act》申報的「定期交易報告」（Periodic Transaction Report，PTR）整理成
// learner/data/congress.json，給 learner/watch.html 的「國會」分頁使用。GitHub Actions 每天跑（.github/workflows/congress.yml）。
// 來源（都是官方公開資料）：
//   眾議院：書記官辦公室 disclosures-clerk.house.gov 每年的申報索引（{年}FD.zip 裡的 XML）＋每份 PTR 的 PDF（電子申報的 PDF 有文字，用 pdfjs 讀）
//   參議院：參議院電子申報系統 efdsearch.senate.gov（先同意使用條款，再查 PTR 清單、讀每份電子申報的 HTML 表格；紙本掃描的略過）
// 已經讀過的申報文件記在 learner/data/congress-docs.json，之後只讀新的。
// 交易日期（實際成交）和申報日期（公開）分開存：首頁「交易動態」看申報日期，30／90 天統計看交易日期。
// 金額只有區間（例如 $1,001 - $15,000），不是實際金額；標在股價圖上的是交易日的收盤價，不是實際成交價。

import { readFile, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../learner/data/", import.meta.url));
const UA = "Mozilla/5.0 (compatible; kline-school-learner; +https://github.com/kevinlf2904/taiex-monitor-app)";
const DAY = 864e5, iso = ms => new Date(ms).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 共用 ----------
// 01/15/2026 → 2026-01-15
export const mdy = s => { const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
// "$1,001 - $15,000" → [1001, 15000]；"Over $50,000,000" → [50000001, null]；"$1,000,001 +" 也當成以上
export function amountRange(s) {
  const t = String(s || "").replace(/\s+/g, " "), n = [...t.matchAll(/\$\s?([\d,]+)/g)].map(m => +m[1].replace(/,/g, ""));
  if (!n.length) return null;
  if (/over|\+|more than/i.test(t) || n.length === 1) return [/over|more than/i.test(t) ? n[0] + 1 : n[0], null];
  return [n[0], n[1]];
}
const OWNER = { SP: "配偶", JT: "共同", DC: "子女", self: "本人", spouse: "配偶", joint: "共同", child: "子女", dependent: "子女" };
export const ownerOf = s => { const t = String(s || "").trim().toLowerCase(); if (!t || t === "--") return "本人"; return OWNER[String(s).trim()] || Object.entries(OWNER).find(([k]) => t.includes(k.toLowerCase()))?.[1] || String(s).trim(); };
// 交易類型 → buy／sell／exchange；partial 部分賣出
export function kindOf(s) {
  const t = String(s || "").trim().toLowerCase();
  if (/^p\b|purchase/.test(t)) return { k: "buy" };
  if (/^s\b|sale/.test(t)) return { k: "sell", partial: /partial/.test(t) || undefined };
  if (/^e\b|exchange/.test(t)) return { k: "exchange" };
  return null;
}
const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cleanName = s => String(s || "").replace(/\b(The\s+)?(Hon\.?|Honorable|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+/gi, "").replace(/\s+/g, " ").trim();
async function get(url, opt = {}, tries = 3) {
  for (let k = 0; ; k++) {
    try { const r = await fetch(url, { ...opt, headers: { "User-Agent": UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000), redirect: opt.redirect || "follow" }); if (!r.ok && r.status !== 302) throw new Error(`HTTP ${r.status} ${url}`); return r; }
    catch (e) { if (k >= tries - 1) throw e; await sleep(1500 * (k + 1)); }
  }
}

// ---------- 眾議院 ----------
// 讀 zip（只用到 deflate／不壓縮兩種）→ { 檔名: Buffer }
export function unzip(buf) {
  const out = {}; let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) throw new Error("不是 zip 檔");
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString();
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), data = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    out[name] = method === 8 ? inflateRawSync(data) : data; p += 46 + nl + xl + cl;
  }
  return out;
}
// {年}FD.xml → [{ docId, name, state, filed, type }]，只留 PTR（FilingType P）
export function parseHouseIndex(xml) {
  const tag = (b, t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1]?.trim() || "";
  return [...String(xml).matchAll(/<Member>([\s\S]*?)<\/Member>/g)].map(m => m[1]).filter(b => tag(b, "FilingType") === "P")
    .map(b => ({ docId: tag(b, "DocID"), name: cleanName([tag(b, "First"), tag(b, "Last"), tag(b, "Suffix")].filter(Boolean).join(" ")), last: tag(b, "Last"), first: tag(b, "First"), state: tag(b, "StateDst"), filed: mdy(tag(b, "FilingDate")), year: tag(b, "Year") }))
    .filter(x => x.docId && x.filed);
}
// PTR PDF 的文字（一行一行）→ 交易。實際版面（pdfjs 讀出來）：每筆交易的第一行是「持有人 資產名稱… 類型 交易日 通知日 金額下限 -」，
// 資產名稱的後半、(代號) [資產類型]、金額上限常換到下一兩行，例如：
//   SP Accenture plc Class A Ordinary Shares S 05/08/2026 06/08/2026 $15,001 -
//   (ACN) [ST] $50,000
//   SP Taiwan Semiconductor P 05/08/2026 06/08/2026 $1,001 - $15,000
//   Manufacturing Company Ltd. (TSM)
//   [ST]
// 所以用「類型＋兩個日期＋金額」那一行當每筆的開頭，接著的幾行（到「F S:」「S O:」這類附註為止）併進來再找代號。只留股票（ST）、選擇權（OP）、ETF（EF）
const NOISE = /^(?:F\s?S|S\s?O|D|C|L)\s?:|^(?:Filing Status|Description|Subholding|Location|Comments?|ID Owner|Type Date|\$200\?|\*|Filing ID|I\s?V\s?D|I\s?P\s?O|C\s?S|Yes No|I CERTIFY|my knowledge|Digitally Signed)/i;
const TX = /^(.*?)\s*\b(P|S\s*\(\s*partial\s*\)|S|E)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Over\s+\$[\d,]+|\$[\d,]+(?:\s*-\s*(?:\$[\d,]+)?)?)\s*(.*)$/i;
const AMT_HI = { 1001: 15000, 15001: 50000, 50001: 100000, 100001: 250000, 250001: 500000, 500001: 1000000, 1000001: 5000000, 5000001: 25000000, 25000001: 50000000 };
export function parseHousePtrText(text) {
  const L = String(text).replace(/\u0000/g, "").split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean), out = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(TX); if (!m || NOISE.test(L[i])) continue;
    const cont = []; for (let k = i + 1; k < L.length && cont.length < 4; k++) { if (TX.test(L[k]) || NOISE.test(L[k])) break; cont.push(L[k]); }
    const joined = [m[1], m[6], ...cont].join(" ").replace(/\s+/g, " ").trim();
    const tk = joined.match(/\(\s*([A-Z][A-Z0-9.\-/]{0,9})\s*\)\s*\[\s*([A-Z]{2})\s*\]/); if (!tk) continue;
    const type = tk[2].toUpperCase(), kd = kindOf(m[2]); if (!["ST", "OP", "EF"].includes(type) || !kd) continue;
    let amt = amountRange(m[5]); if (amt && amt[1] == null && !/over/i.test(m[5])) { const hi = joined.slice(tk.index + tk[0].length).match(/\$\s?([\d,]+)/) || cont.join(" ").match(/\$\s?([\d,]+)/); amt = [amt[0], hi ? +hi[1].replace(/,/g, "") : AMT_HI[amt[0]] ?? null]; }
    let asset = joined.slice(0, tk.index).replace(/\$[\d,]+/g, "").trim(), owner = "本人"; const om = asset.match(/^(SP|JT|DC)\s+(.*)$/); if (om) { owner = ownerOf(om[1]); asset = om[2]; }
    out.push({ ticker: tk[1].replace(/\.$/, ""), asset: asset.slice(0, 90), assetType: type === "OP" ? "選擇權" : type === "EF" ? "ETF" : "股票", ...kd, owner, traded: mdy(m[3]), notified: mdy(m[4]), amount: amt });
  }
  return out;
}
export function houseMeta(text) {
  const t = String(text).replace(/\s+/g, " ");
  return { name: cleanName((t.match(/Name:\s*(.+?)\s+(?:Status|State\/District):/i) || [])[1] || ""), state: (t.match(/State\/District:\s*([A-Z]{2}\d{0,2})/) || [])[1] || "" };
}
async function pdfText(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent(), rows = new Map();
    for (const it of c.items) { if (!it.str?.trim()) continue; const y = Math.round(it.transform[5] / 2) * 2; (rows.get(y) || rows.set(y, []).get(y)).push(it); }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, L]) => lines.push(L.sort((a, b) => a.transform[4] - b.transform[4]).map(x => x.str).join(" ")));
  }
  await doc.destroy(); return lines.join("\n");
}
async function house(fromIso, seen, log) {
  const yNow = new Date().getUTCFullYear(), years = [...new Set([yNow, +fromIso.slice(0, 4)])], filings = [];
  for (const y of years) {
    try { const z = unzip(Buffer.from(await (await get(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${y}FD.zip`)).arrayBuffer())); const xml = Object.entries(z).find(([k]) => /\.xml$/i.test(k))?.[1]; if (xml) filings.push(...parseHouseIndex(xml.toString("utf8"))); }
    catch (e) { log(`眾議院 ${y} 索引失敗：${e.message}`); }
  }
  const todo = filings.filter(f => f.filed >= fromIso && !seen[`H${f.docId}`]); log(`眾議院 PTR：索引 ${filings.length} 份，要讀 ${todo.length} 份`);
  const trades = [], people = {};
  for (const f of todo) {
    const url = `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${f.year || f.filed.slice(0, 4)}/${f.docId}.pdf`;
    try {
      const txt = await pdfText(Buffer.from(await (await get(url)).arrayBuffer())), rows = parseHousePtrText(txt), meta = houseMeta(txt);
      const pid = "h-" + slug(`${f.last}-${f.first}-${f.state}`); people[pid] = { name: meta.name || f.name, chamber: "眾議院", state: f.state };
      rows.forEach(r => trades.push({ ...r, pid, filed: f.filed, doc: url }));
      seen[`H${f.docId}`] = rows.length || (txt.replace(/\s/g, "").length < 200 ? -1 : 0); // -1：掃描的紙本，讀不到文字
    } catch (e) { log(`  ${f.docId} 失敗：${e.message}`); }
    await sleep(250);
  }
  return { trades, people };
}

// ---------- 參議院 ----------
// 參議院 PTR 頁面的交易表格 → 交易（#、交易日、持有人、代號、資產名稱、資產類型、類型、金額、備註）
export function parseSenatePtrHtml(html) {
  const tb = (String(html).match(/<tbody>([\s\S]*?)<\/tbody>/i) || [])[1] || "", cell = s => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  const out = [];
  for (const r of tb.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const c = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => cell(m[1])); if (c.length < 8) continue;
    const [, date, owner, ticker, asset, atype, type, amt] = c, kd = kindOf(type); if (!kd) continue;
    const tk = (ticker.match(/[A-Z][A-Z0-9.\-]{0,9}/) || [])[0]; if (!tk || ticker === "--") continue;
    if (!/stock|option|etf|fund/i.test(atype) && atype) continue;
    out.push({ ticker: tk, asset, assetType: /option/i.test(atype) ? "選擇權" : /etf|fund/i.test(atype) ? "ETF" : "股票", ...kd, owner: ownerOf(owner), traded: mdy(date), amount: amountRange(amt) });
  }
  return out;
}
export function senateName(html) { const h = String(html); return cleanName(((h.match(/<h2[^>]*class="[^"]*filedReport[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) || h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/<[^>]+>/g, " ").replace(/\(.*?\)/g, "")); }
async function senate(fromIso, seen, log) {
  const base = "https://efdsearch.senate.gov", jar = new Map(), cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const keep = r => { const sc = r.headers.getSetCookie?.() || [r.headers.get("set-cookie") || ""]; sc.forEach(c => { const m = String(c).match(/^([^=;\s]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); }); return r; };
  const home = await (await get(`${base}/search/home/`).then(keep)).text();
  const tok = (home.match(/name="csrfmiddlewaretoken" value="([^"]+)"/) || [])[1]; if (!tok) throw new Error("拿不到參議院網站的 CSRF token");
  await get(`${base}/search/home/`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${base}/search/home/`, Cookie: cookie() }, body: new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: tok }) }).then(keep);
  const [y, m, d] = fromIso.split("-"), reports = [];
  for (let start = 0; start < 2000; start += 100) {
    const body = new URLSearchParams({ start: String(start), length: "100", report_types: "[11]", filer_types: "[]", submitted_start_date: `${m}/${d}/${y} 00:00:00`, submitted_end_date: "", candidate_state: "", senator_state: "", office_id: "", first_name: "", last_name: "", csrfmiddlewaretoken: tok });
    const j = await (await get(`${base}/search/report/data/`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${base}/search/`, "X-CSRFToken": jar.get("csrftoken") || tok, Cookie: cookie() }, body }).then(keep)).json();
    const rows = j?.data || []; rows.forEach(r => { const href = (String(r[3]).match(/href="([^"]+)"/) || [])[1]; if (href) reports.push({ first: cleanName(r[0]), last: cleanName(r[1]), office: String(r[2] || ""), href, filed: mdy(r[4]) }); });
    if (rows.length < 100) break; await sleep(500);
  }
  const todo = reports.filter(r => /\/ptr\//.test(r.href) && !seen[`S${r.href}`]); log(`參議院 PTR：清單 ${reports.length} 份（紙本 ${reports.filter(r => /\/paper\//.test(r.href)).length} 份略過），要讀 ${todo.length} 份`);
  const trades = [], people = {};
  for (const r of todo) {
    const url = base + r.href;
    try {
      const html = await (await get(url, { headers: { Cookie: cookie(), Referer: `${base}/search/` } }).then(keep)).text(), rows = parseSenatePtrHtml(html);
      const pid = "s-" + slug(`${r.last}-${r.first}`); people[pid] = { name: cleanName(`${r.first} ${r.last}`), chamber: "參議院", state: (r.office.match(/\(([A-Z]{2})\)/) || [])[1] || "" };
      rows.forEach(x => trades.push({ ...x, pid, filed: r.filed, doc: url })); seen[`S${r.href}`] = rows.length;
    } catch (e) { log(`  ${r.href} 失敗：${e.message}`); }
    await sleep(400);
  }
  return { trades, people };
}

// ---------- 合併、輸出 ----------
const tradeKey = t => [t.pid, t.ticker, t.k, t.traded, t.amount?.join("-"), t.owner, t.doc].join("|");
export function merge(prev, add, keepFrom) {
  const people = { ...(prev.people || {}), ...add.people }, map = new Map();
  [...(prev.trades || []), ...add.trades].filter(t => t.ticker && t.traded && (t.traded >= keepFrom || t.filed >= keepFrom)).forEach(t => map.set(tradeKey(t), t));
  const trades = [...map.values()].sort((a, b) => b.filed.localeCompare(a.filed) || b.traded.localeCompare(a.traded));
  const used = new Set(trades.map(t => t.pid));
  return { people: Object.fromEntries(Object.entries(people).filter(([k]) => used.has(k))), trades };
}
export async function main({ days = 200, log = console.log } = {}) {
  const prev = await readFile(DATA + "congress.json", "utf8").then(JSON.parse).catch(() => ({ trades: [], people: {} }));
  const seen = await readFile(DATA + "congress-docs.json", "utf8").then(JSON.parse).catch(() => ({}));
  // 解析器改版（眾議院 PDF 的換行版面）：之前讀到文字卻解析出 0 筆的文件重讀一次，期間拉回完整的 days 天
  const PARSER = 2, redo = seen._v !== PARSER; if (redo) { for (const k of Object.keys(seen)) if (k[0] === "H" && seen[k] === 0) delete seen[k]; seen._v = PARSER; }
  const fromIso = iso(Date.now() - (prev.trades?.length && !redo ? 45 : days) * DAY), notes = [], add = { trades: [], people: {} };
  for (const [name, fn] of [["眾議院", house], ["參議院", senate]]) {
    try { const r = await fn(fromIso, seen, log); add.trades.push(...r.trades); Object.assign(add.people, r.people); log(`${name}：新增 ${r.trades.length} 筆`); }
    catch (e) { notes.push(`${name}資料這次沒有更新（${e.message}）`); log(`${name}失敗：${e.message}`); }
  }
  const m = merge(prev, add, iso(Date.now() - 400 * DAY));
  const out = { updated: new Date().toISOString(), cutoff: m.trades.reduce((a, t) => (t.filed > a ? t.filed : a), ""), notes,
    sources: [["眾議院書記官 定期交易報告（PTR）", "https://disclosures-clerk.house.gov/FinancialDisclosure"], ["參議院電子申報系統 定期交易報告", "https://efdsearch.senate.gov/search/"]], ...m };
  await writeFile(DATA + "congress.json", JSON.stringify(out));
  await writeFile(DATA + "congress-docs.json", JSON.stringify(seen));
  return out;
}
// 除錯：node scripts/congress.mjs --dump 3 → 印出幾份「讀得到文字但解析出 0 筆」的眾議院 PTR 原文，對照格式用
async function dump(n) {
  const seen = await readFile(DATA + "congress-docs.json", "utf8").then(JSON.parse).catch(() => ({})), ids = Object.entries(seen).filter(([k, v]) => k[0] === "H" && v === 0 && k !== "_v").map(([k]) => k.slice(1)).slice(0, n);
  for (const id of ids) { const y = new Date().getUTCFullYear(); for (const yy of [y, y - 1]) { try { const txt = await pdfText(Buffer.from(await (await get(`https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${yy}/${id}.pdf`, {}, 1)).arrayBuffer())); console.log(`===== ${id} (${yy}) =====\n${txt.slice(0, 3000)}\n===== 解析：${JSON.stringify(parseHousePtrText(txt).slice(0, 3))}`); break; } catch {} } }
  const S = Object.entries(seen).filter(([k, v]) => k[0] === "S" && v === 0).map(([k]) => k.slice(1)).slice(0, 1); console.log("參議院 0 筆的例子：", S);
}
if (process.argv[2] === "--dump") dump(+process.argv[3] || 3).catch(e => { console.error(e); process.exit(1); });
else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("ok", o.trades.length, "筆，", Object.keys(o.people).length, "人，資料截止", o.cutoff)).catch(e => { console.error(e); process.exit(1); });
