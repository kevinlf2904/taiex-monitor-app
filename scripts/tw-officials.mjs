// 台灣政治人物財產申報（持股）：監察院「廉政專刊」每週出刊（PDF），刊登總統、院長、部會首長、立委、縣市長、議員等的財產申報，
// 其中「有價證券—股票」列出申報日當天的持股（名稱、所有人、股數）。這支程式讀最近的廉政專刊，整理成 learner/data/tw-officials.json，
// 給 learner/watch.html「國會」分頁的「台灣政治人物」使用。和美國國會不同：台灣申報的是「持股」不是「交易」，
// 所以用同一個人前後兩次申報的股數差，看出增持、減持、新進、出清（時間點是申報基準日，通常一年一次）。
// 來源：陽光法令主題網 廉政專刊電子書 https://sunshine.cy.gov.tw/News.aspx?n=17&sms=8861（網站只放最近 6 個月的完整內容，所以要持續累積）
//   --dump  只印出找到的期別、第一期 PDF 的頁數與前幾頁文字、含「股票」的段落，不寫檔（除錯用）

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const DATA = fileURLToPath(new URL("../learner/data/", import.meta.url)), DUMP = process.argv.includes("--dump");
const VER = 2; // 解析方式改版就加一，下次執行會把列表上的期別全部重讀
const BASE = "https://sunshine.cy.gov.tw", LIST = `${BASE}/News.aspx?n=17&sms=8861`;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner; +https://github.com/kevinlf2904/taiex-monitor-app)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getText = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.text(); };
const getBuf = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const decode = s => String(s).replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"');

// 列表頁（表格：序號、期別「廉政專刊第321期」、出刊日期「115-09-22」、電子書 PDF 下載連結）→ [{ no, date, pdf }]
export function parseList(html) {
  const out = [];
  for (const tr of String(html).split(/<tr[\s>]/i).slice(1)) {
    const no = tr.match(/廉政專刊第\s*(\d+)\s*期/)?.[1], dm = tr.match(/(\d{3})-(\d{2})-(\d{2})/), pdf = tr.match(/href="([^"]*Download\.ashx[^"]*)"/i)?.[1];
    if (no && pdf) out.push({ no: +no, date: dm ? `${+dm[1] + 1911}-${dm[2]}-${dm[3]}` : null, pdf: new URL(decode(pdf), BASE + "/").href });
  }
  return [...new Map(out.map(o => [o.no, o])).values()].sort((a, b) => b.no - a.no);
}

async function pdfLines(buf, maxPages = Infinity) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"), require = createRequire(import.meta.url), root = require.resolve("pdfjs-dist/package.json").replace(/package\.json$/, "");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), cMapUrl: root + "cmaps/", cMapPacked: true, standardFontDataUrl: root + "standard_fonts/", useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const c = await (await doc.getPage(i)).getTextContent(), rows = new Map();
    for (const it of c.items) { if (!it.str?.trim()) continue; const y = Math.round(it.transform[5] / 2) * 2; (rows.get(y) || rows.set(y, []).get(y)).push(it); }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, L]) => L.sort((a, b) => a.transform[4] - b.transform[4]).map(x => x.str.trim()).join(" | ")));
  }
  const n = doc.numPages; await doc.destroy(); return { n, pages };
}

// 一頁頁的文字行（欄位用「 | 」分隔）→ 每位申報人的申報：{ name, org, title, date, kind, stocks: [{ name, owner, sh, cur }] }
// 股票一列的實際版面：名稱（常帶很長的「(未能交付信託原因…)」，會斷成好幾行，括號前後都可能有字）| 所有人 | 股數 | 票面價額 | [外幣幣別] | 總額
// 做法：從行尾往前讀數字（與幣別），遇到第一個文字就是所有人；名稱＝前面累積的文字；括號沒關的話，後面的行（就算有數字）都算同一筆的備註
const T = l => String(l).replace(/\s*\|\s*/g, "").replace(/\s+/g, "");
const NUM = /^-?[\d,]+(\.\d+)?$/, CUR = /^(美元|港幣|日圓|日幣|歐元|人民幣|英鎊|澳幣|加幣|新加坡幣|新幣|瑞士法郎|韓元|泰銖|紐幣|南非幣)$/;
const open = s => (s.match(/[(（]/g) || []).length - (s.match(/[)）]/g) || []).length;
// 名稱清理：去掉括號備註、表頭殘字「新臺幣總額或折合新臺幣總額」、註記符號（1★、＊）、「股份有限公司」
export const cleanName = s => String(s).replace(/[(（][\s\S]*$/, "").replace(/新臺幣總額或折合新臺幣(總額)?/g, "").replace(/\d*★/g, "").replace(/[＊*]/g, "").replace(/\s+/g, "").replace(/股份有限公司$/, "").trim();
export function parseDecls(lines) {
  const out = []; let cur = null, sec = null, buf = "", row = null;
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k], t = T(raw); if (!t) continue;
    if (/^公職人員財產申報表/.test(t)) { cur = { name: "", org: "", title: "", date: null, kind: "", stocks: [] }; out.push(cur); sec = null; buf = ""; row = null; continue; }
    if (!cur || /^監察院公報/.test(t)) continue;
    if (t.startsWith("申報人姓名")) { cur.name = raw.split("|").map(x => x.trim()).filter(Boolean)[1] || ""; const prev = (lines[k - 1] || "").split("|").map(x => x.trim()).filter(x => x && !/^\d+\.$/.test(x)); if (!cur.org && prev.length) { cur.org = prev[0] || ""; cur.title = prev[1] || ""; } continue; }
    if (!cur.date) { const m = t.match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日(.{0,12}申報)/); if (m) { cur.date = `${+m[1] + 1911}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; cur.kind = m[4].replace(/[()（）]/g, ""); continue; } }
    if (/^1\.股票（總價額/.test(t)) { sec = "stock"; buf = ""; row = null; continue; }
    if (sec !== "stock") continue;
    if (/^2\.債券/.test(t) || /^（[九十]）/.test(t)) { sec = null; continue; }
    if (/^(名稱所有人股數|新臺幣總額或折合新臺幣|總額$|本欄空白)/.test(t)) continue;
    if (row && open(row.raw) > 0) { row.raw += t; continue; } // 上一筆的括號還沒關：這行是它的備註
    const cells = raw.split("|").map(x => x.trim()).filter(Boolean); let j = cells.length - 1, nums = [];
    while (j >= 0 && (NUM.test(cells[j]) || CUR.test(cells[j]))) { if (NUM.test(cells[j])) nums.unshift(cells[j]); j--; }
    if (nums.length >= 2 && j >= 0) { // 一筆持股
      const owner = cells[j], name = buf + cells.slice(0, j).join(""), curr = cells.slice(j + 1).find(c => CUR.test(c)) || "";
      row = { raw: name, name: "", owner, sh: +nums[0].replace(/,/g, ""), cur: curr }; cur.stocks.push(row); buf = "";
    } else buf += t;
  }
  for (const d of out) d.stocks = d.stocks.map(s => ({ name: cleanName(s.raw), owner: s.owner, sh: s.sh, cur: s.cur || undefined })).filter(s => s.name && s.sh > 0);
  return out.filter(d => d.name);
}

export async function main() {
  const list = parseList(await getText(LIST)); console.log("期別", list.slice(0, 20).map(x => `${x.no}(${x.date || "?"})`).join("、"));
  if (DUMP) {
    const x = list[0]; if (!x) { console.log((await getText(LIST)).slice(0, 2000)); return; }
    const pdf = { url: x.pdf }; console.log("第", x.no, "期", x.date, x.pdf);
    const buf = await getBuf(pdf.url); console.log("PDF 大小", buf.length);
    const { n, pages } = await pdfLines(buf, 40); console.log("頁數", n, "前 3 頁行數", pages.slice(0, 3).map(p => p.length));
    pages.slice(0, 3).forEach((p, i) => console.log(`--- 第 ${i + 1} 頁 ---\n` + p.slice(0, 60).join("\n")));
    const { pages: P } = await pdfLines(buf), all = P.flat(), D = parseDecls(all);
    console.log("申報人", D.length, "有股票", D.filter(d => d.stocks.length).length, "股票筆數", D.reduce((s, d) => s + d.stocks.length, 0));
    D.slice(0, 5).forEach(d => console.log("人", JSON.stringify({ ...d, stocks: d.stocks.length })));
    D.filter(d => !d.date || d.stocks.length > 60).slice(0, 3).forEach(d => { const k = all.findIndex(l => T(l).startsWith("申報人姓名") && l.includes(d.name)); console.log("⚠ 異常", d.name, d.date, d.stocks.length, "\n" + all.slice(Math.max(0, k - 6), k + 10).join("\n")); });
    D.filter(d => d.stocks.length).slice(0, 8).forEach(d => console.log("持股", d.name, d.org, d.title, d.date, d.kind, JSON.stringify(d.stocks.slice(0, 12).map(x => [x.name, x.owner, x.sh, x.raw]))));
    let shown = 0; for (let k = 0; k < all.length && shown < 4; k++) if (/^1\.股票（總價額/.test(T(all[k])) && !/本欄空白/.test(T(all[k + 3] || "") + T(all[k + 4] || ""))) { console.log("--- 原始股票段 ---\n" + all.slice(k, k + 28).join("\n")); shown++; k += 20; }
    return;
  }
  return run();
}
// 正常模式：讀還沒讀過的每一期，整理成 learner/data/tw-officials.json；讀過的期別記在 tw-officials-docs.json
export async function run() {
  const OUT = DATA + "tw-officials.json", DOCS = DATA + "tw-officials-docs.json";
  let old = { issues: [], decl: [] }, docs = { done: [] }; try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {} try { docs = JSON.parse(await readFile(DOCS, "utf8")); } catch {}
  const list = parseList(await getText(LIST)), onList = new Set(list.map(x => x.no));
  // 解析方式改版：列表上的期別全部重讀；網站已下架（超過 6 個月）的舊期別無法重讀，保留原本的結果
  if (docs._v !== VER) { console.log("解析版本更新，重讀列表上的期別"); old = { issues: (old.issues || []).filter(i => !onList.has(i.no)), decl: (old.decl || []).filter(d => !onList.has(d.issue)) }; docs = { done: (docs.done || []).filter(n => !onList.has(n)) }; }
  const todo = list.filter(x => !docs.done.includes(x.no)).slice(0, 40); console.log("要讀", todo.map(x => x.no).join("、") || "沒有新的期別");
  // 股票簡稱 → 代號（上市＋上櫃全部股票與 ETF 的當天行情名稱）
  const map = new Map(), close = new Map(); let pxDate = null; try { const { parseTwseAll, parseTpexAll } = await import("../api/_lib/hot.js"); const get = async u => (await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
    const [a, b] = await Promise.allSettled([get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL").then(parseTwseAll), get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes").then(parseTpexAll)]);
    for (const x of [...(a.value || []), ...(b.value || [])]) { const n = String(x.name).replace(/\s+/g, ""); if (n && !map.has(n)) map.set(n, x.code); if (x.price > 0) close.set(x.code, x.price); if (x.date && (!pxDate || x.date > pxDate)) pxDate = x.date; } } catch (e) { console.log("代號對照失敗", e.message); }
  const codeOf = n => map.get(n) || map.get(n.replace(/-?KY$/i, "-KY")) || map.get(n.replace(/股份有限公司$|公司$/, "")) || "";
  const decl = [...(old.decl || [])], seen = new Set(decl.map(d => `${d.pid}|${d.date}|${d.kind}`)), issues = [...(old.issues || [])];
  for (const x of todo) {
    try { const buf = await getBuf(x.pdf), { pages } = await pdfLines(buf), D = parseDecls(pages.flat()); let n = 0;
      for (const d of D) { if (!d.date) continue; const key = `${d.name}|${d.date}|${d.kind}`; if (seen.has(key)) continue; seen.add(key); n++;
        decl.push({ pid: d.name, name: d.name, org: d.org, title: d.title, date: d.date, kind: d.kind, issue: x.no, stocks: d.stocks.map(s => ({ name: s.name, code: s.cur ? "" : codeOf(s.name), owner: s.owner, sh: s.sh, cur: s.cur })) }); }
      docs.done.push(x.no); if (!issues.some(i => i.no === x.no)) issues.push({ no: x.no, date: x.date, pdf: x.pdf });
      console.log("第", x.no, "期", x.date, "申報", D.length, "人，新增", n, "，股票", D.reduce((a, d) => a + d.stocks.length, 0), "筆，對到代號", D.reduce((a, d) => a + d.stocks.filter(s => !s.cur && codeOf(s.name)).length, 0));
    } catch (e) { console.log("失敗", x.no, e.message); }
    await sleep(800);
  }
  issues.sort((a, b) => b.no - a.no);
  for (const i of issues) { const L = list.find(x => x.no === i.no); if (L && !i.pdf) i.pdf = L.pdf; } // 舊資料補上 PDF 連結（網站只留最近 6 個月）
  // 申報持股的最新收盤價（每個交易日更新），網頁用來算「持股市值」排行；拿不到就沿用上次的
  const held = new Set(decl.flatMap(d => d.stocks.map(x => x.code).filter(Boolean))), px = {};
  for (const c of held) { const v = close.get(c) ?? old.px?.[c]; if (v != null) px[c] = v; }
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), source: "監察院廉政專刊（陽光法令主題網）", pxDate: close.size ? pxDate : old.pxDate || null, px, issues, decl }));
  await writeFile(DOCS, JSON.stringify({ _v: VER, done: [...new Set(docs.done)].sort((a, b) => b - a) }));
  console.log("完成：", decl.length, "份申報，", new Set(decl.map(d => d.pid)).size, "人");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
