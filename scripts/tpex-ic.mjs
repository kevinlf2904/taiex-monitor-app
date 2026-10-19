// 櫃買中心「產業價值鏈資訊平台」（ic.tpex.org.tw）：官方的產業 → 上中下游細分產業 → 公司清單。
// 大盤「產業即時」與資金雷達用它當細分產業（比證交所 30 多個大類細很多）。每週由 .github/workflows/tpex-ic.yml 更新。
// 輸出 learner/data/tpex-ic.json：{ updated, source, industries: [{ id, name, segs: [{ id, name, stage, codes: [[代號, 名稱], …] }] }] }
//   只收上市、上櫃公司（興櫃、外國企業沒有即時行情，不收）。
//   --dump  只印出抓到的數量，不寫檔
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = "https://ic.tpex.org.tw/", OUT = fileURLToPath(new URL("../learner/data/tpex-ic.json", import.meta.url)), DUMP = process.argv.includes("--dump");
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school research; +https://kline-school.vercel.app)" };
async function get(path, tries = 3) {
  for (let k = 0; ; k++) {
    try { const r = await fetch(BASE + path, { headers: UA, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
    catch (e) { if (k + 1 >= tries) throw e; await new Promise(r => setTimeout(r, 3000 * (k + 1))); }
  }
}
const clean = s => String(s).replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/◈/g, "／").replace(/\s+/g, " ").replace(/^[／\s]+|[／\s]+$/g, "").replace(/\s*／\s*/g, "／").trim();

// 首頁：introduce.php?ic=代碼 → 產業名稱
export function parseHome(html) {
  const out = new Map();
  for (const m of html.matchAll(/introduce\.php\?ic=(\w+)["'][^>]*>([\s\S]{0,300}?)<\/a>/g)) { const name = clean(m[2]); if (name && !out.has(m[1])) out.set(m[1], name); }
  return [...out].map(([id, name]) => ({ id, name }));
}
// 產業頁：每個細分產業（ic_link_XXXX）的名稱、上中下游，以及 companyList_XXXX 裡上市／上櫃公司
export function parseIndustry(html) {
  const H = html.replace(/\s+/g, " "), stages = [...H.matchAll(/chain-title-panel">\s*(上游|中游|下游)/g)].map(m => ({ at: m.index, s: m[1] }));
  const segs = [];
  for (const m of H.matchAll(/id="ic_link_(\w+)"[^>]*>([\s\S]{0,160}?)<\/div>/g)) {
    const id = m[1], name = clean(m[2]), stage = stages.filter(x => x.at < m.index).at(-1)?.s || "";
    const i = H.indexOf(`id="companyList_${id}"`); if (i < 0 || segs.some(g => g.id === id)) continue;
    const j = H.indexOf('id="companyList_', i + 10), block = H.slice(i, j < 0 ? undefined : j), codes = [], seen = new Set();
    let keep = true; // 依序讀「本國上市公司／本國上櫃公司／本國興櫃公司／外國企業」標題與公司連結
    for (const t of block.matchAll(/<b>([^<]*?(?:上市|上櫃|興櫃|外國|創櫃)[^<]*?)<\/b>|company_basic\.php\?stk_code=(\w+)"[^>]*title="([^"]*)"/g)) {
      if (t[1]) { keep = /上市|上櫃/.test(t[1]) && !/興櫃|外國|創櫃/.test(t[1]); continue; }
      if (keep && /^\d{4}$/.test(t[2]) && !seen.has(t[2])) { seen.add(t[2]); codes.push([t[2], clean(t[3])]); }
    }
    if (codes.length) segs.push({ id, name, stage, codes });
  }
  return segs;
}
export async function main() {
  const inds = parseHome(await get("index.php")); if (inds.length < 20) throw new Error(`首頁只讀到 ${inds.length} 個產業，格式可能改了`);
  const out = []; let k = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (k < inds.length) { const I = inds[k++];
    try { const segs = parseIndustry(await get(`introduce.php?ic=${I.id}`)); if (segs.length) out.push({ ...I, segs }); console.log(I.id, I.name, segs.length, "個細分產業", segs.reduce((a, g) => a + g.codes.length, 0), "檔"); }
    catch (e) { console.log(I.id, I.name, "失敗", e.message); } } }));
  out.sort((a, b) => inds.findIndex(x => x.id === a.id) - inds.findIndex(x => x.id === b.id));
  const nSeg = out.reduce((a, I) => a + I.segs.length, 0), nCode = new Set(out.flatMap(I => I.segs.flatMap(g => g.codes.map(c => c[0])))).size;
  console.log(`共 ${out.length} 個產業、${nSeg} 個細分產業、${nCode} 檔上市櫃公司`);
  if (out.length < inds.length * 0.7 || nCode < 800) throw new Error("抓到的太少，不覆蓋舊資料"); // 平台暫時有問題時保留上次的檔案
  if (DUMP) return;
  await mkdir(fileURLToPath(new URL("../learner/data/", import.meta.url)), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), source: "櫃買中心 產業價值鏈資訊平台 ic.tpex.org.tw", industries: out }));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
