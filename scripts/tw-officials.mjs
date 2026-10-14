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

// 一頁頁的文字行（欄位用「 | 」分隔）→ 每位申報人的申報：{ name, org, title, date, kind, stocks: [{ name, owner, sh, raw }] }
const T = l => l.replace(/\s*\|\s*/g, "").replace(/\s+/g, "");
const NUM = /^-?[\d,]+(\.\d+)?$/;
export function parseDecls(lines) {
  const out = []; let cur = null, sec = null, frag = [], lastRow = null;
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k], t = T(raw); if (!t) continue;
    if (/^公職人員財產申報表$/.test(t)) { cur = { name: "", org: "", title: "", date: null, kind: "", stocks: [] }; out.push(cur); sec = null; frag = []; lastRow = null; continue; }
    if (!cur) continue;
    if (/^監察院公報/.test(t)) continue; // 頁尾
    if (t.startsWith("申報人姓名")) { cur.name = raw.split("|").map(x => x.trim()).filter(Boolean)[1] || ""; const prev = (lines[k - 1] || "").split("|").map(x => x.trim()).filter(x => x && !/^\d+\.$/.test(x)); if (!cur.org && prev.length) { cur.org = prev[0] || ""; cur.title = prev[1] || ""; } continue; }
    if (!cur.date) { const m = t.match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日(.*申報)$/); if (m) { cur.date = `${+m[1] + 1911}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; cur.kind = m[4].replace(/[()（）]/g, ""); continue; } }
    if (/^1\.股票（總價額/.test(t)) { sec = "stock"; frag = []; lastRow = null; continue; }
    if (sec === "stock" && /^2\.債券/.test(t)) { sec = null; continue; }
    if (sec !== "stock") continue;
    if (/^(名稱所有人股數|新臺幣總額或折合新臺幣|總額|本欄空白)/.test(t)) continue;
    const cells = raw.split("|").map(x => x.trim()).filter(Boolean), nums = cells.filter(c => NUM.test(c));
    if (nums.length >= 2) { // 一筆持股：名稱（可能斷行） | 所有人 | 股數 | 票面價額 | 總額
      const txt = cells.filter(c => !NUM.test(c)), owner = txt.length >= 2 ? txt[txt.length - 1] : txt.length === 1 && !frag.length ? "" : txt[txt.length - 1] || "";
      const nm = [...frag, ...(txt.length >= 2 ? txt.slice(0, -1) : txt.length === 1 && !frag.length ? txt : [])].join("");
      lastRow = { name: nm, owner, sh: +nums[0].replace(/,/g, ""), raw: [...frag, raw].join(" / ") }; cur.stocks.push(lastRow); frag = [];
    } else if (lastRow && frag.length === 0 && lastRow._pre !== false && cells.length === 1 && k + 1 < lines.length && T(lines[k + 1]).match(/[\d,]{2,}/) == null && !/^2\.債券/.test(T(lines[k + 1]))) {
      lastRow.name += t; lastRow.raw += " / " + raw; // 名稱的後半段（下一行不是另一筆）
    } else frag.push(t);
  }
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
    D.filter(d => d.stocks.length).slice(0, 8).forEach(d => console.log("持股", d.name, d.org, d.title, d.date, d.kind, JSON.stringify(d.stocks.slice(0, 12).map(x => [x.name, x.owner, x.sh, x.raw]))));
    let shown = 0; for (let k = 0; k < all.length && shown < 4; k++) if (/^1\.股票（總價額/.test(T(all[k])) && !/本欄空白/.test(T(all[k + 3] || "") + T(all[k + 4] || ""))) { console.log("--- 原始股票段 ---\n" + all.slice(k, k + 28).join("\n")); shown++; k += 20; }
    return;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
