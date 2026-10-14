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

// 列表頁 → [{ no, date, url }]（第 N 期、出刊日期 115-09-22、內容頁）
export function parseList(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a[^>]+href="([^"]*News_Content\.aspx\?n=17[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const t = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(), no = t.match(/第\s*(\d+)\s*期/)?.[1]; if (!no) continue;
    out.push({ no: +no, url: new URL(decode(m[1]), BASE + "/").href, title: t });
  }
  for (const m of String(html).matchAll(/第\s*(\d+)\s*期[^<]{0,40}?(\d{3})-(\d{2})-(\d{2})/g)) { const x = out.find(o => o.no === +m[1]); if (x && !x.date) x.date = `${+m[2] + 1911}-${m[3]}-${m[4]}`; }
  return [...new Map(out.map(o => [o.no, o])).values()].sort((a, b) => b.no - a.no);
}
// 內容頁 → PDF 下載連結（排除只有目錄的）
export const pdfLinks = html => [...String(html).matchAll(/href="([^"]*Download\.ashx[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ url: new URL(decode(m[1]), BASE + "/").href, name: decode(m[2].replace(/<[^>]+>/g, "")).trim() }));

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

export async function main() {
  const list = parseList(await getText(LIST)); console.log("期別", list.slice(0, 20).map(x => `${x.no}(${x.date || "?"})`).join("、"));
  if (DUMP) {
    const x = list[0]; if (!x) { const h = await getText(LIST); console.log("長度", h.length, "\n連結", JSON.stringify([...new Set([...h.matchAll(/News_Content[^"'\s>]*/g)].map(m => m[0]))].slice(0, 20)));
      for (const m of [...h.matchAll(/第\s*\d+\s*期/g)].slice(0, 6)) console.log("…", h.slice(Math.max(0, m.index - 300), m.index + 200).replace(/\s+/g, " "));
      console.log("含 iframe／api：", JSON.stringify([...h.matchAll(/(iframe[^>]+src="[^"]+"|\/api\/[^"']+|\.ashx[^"']*)/gi)].map(m => m[0]).slice(0, 15))); return; }
    const html = await getText(x.url), L = pdfLinks(html); console.log("第", x.no, "期 連結", JSON.stringify(L));
    const pdf = L.find(l => /\.pdf|專刊/i.test(l.name) && !/目錄/.test(l.name)) || L[0]; if (!pdf) { console.log(html.slice(0, 3000)); return; }
    const buf = await getBuf(pdf.url); console.log("PDF 大小", buf.length);
    const { n, pages } = await pdfLines(buf, 40); console.log("頁數", n, "前 3 頁行數", pages.slice(0, 3).map(p => p.length));
    pages.slice(0, 3).forEach((p, i) => console.log(`--- 第 ${i + 1} 頁 ---\n` + p.slice(0, 60).join("\n")));
    const all = pages.flat(), k = all.findIndex(l => /股票/.test(l)); console.log("--- 第一個「股票」附近 ---\n" + (k >= 0 ? all.slice(Math.max(0, k - 30), k + 50).join("\n") : "（前 40 頁沒有）"));
    return;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
