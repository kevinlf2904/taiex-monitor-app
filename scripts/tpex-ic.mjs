// 櫃買中心「產業價值鏈資訊平台」（ic.tpex.org.tw）：官方的產業 → 上中下游細分產業 → 公司清單。
// 大盤「產業即時」用它當細分產業（比證交所 30 多個大類細很多）；資金雷達不用這份（用供應鏈題材＋官方產業別，見 docs/industry-taxonomy.md）。每週由 .github/workflows/tpex-ic.yml 更新。
// 輸出 learner/data/tpex-ic.json：{ updated, source, industries: [{ id, name, segs: [{ id, name, stage, codes: [[代號, 名稱], …] }] }] }
//   只收上市、上櫃公司（興櫃、外國企業沒有即時行情，不收）。
//   某些產業這次抓不到時：沿用上一份檔案裡同一個產業，標 stale: true 與 asOf（那份資料原本的更新時間），不會當成這次的新資料；
//   舊檔也沒有、或沿用超過 STALE_DAYS 天的，放進 missing（網站上就少這個產業，但看得出少了哪些）。
//   寫檔先寫暫存檔再改名，寫到一半中斷不會留下壞掉的正式檔。
//   --dump  只印出抓到的數量，不寫檔
import { writeFile, readFile, rename, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = "https://ic.tpex.org.tw/", OUT = fileURLToPath(new URL("../learner/data/tpex-ic.json", import.meta.url)), DUMP = process.argv.includes("--dump");
export const STALE_DAYS = 60;
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
// 舊檔裡一個產業的結構是否完整（舊檔可能是合法 JSON 但內容壞掉）：id、非空的 segs，每段有 id、name、codes（[代號, 名稱]）
const okCode = c => Array.isArray(c) && c.length >= 2 && typeof c[0] === "string" && typeof c[1] === "string";
const okSeg = g => !!g && typeof g === "object" && typeof g.id === "string" && typeof g.name === "string" && Array.isArray(g.codes) && g.codes.length > 0 && g.codes.every(okCode);
export const okIndustry = I => !!I && typeof I === "object" && typeof I.id === "string" && I.id !== "" && Array.isArray(I.segs) && I.segs.length > 0 && I.segs.every(okSeg);
// 這次抓到的（fresh，依首頁順序）＋上一份檔案（prev）→ 要寫出的內容。inds 是首頁的產業清單；首頁上已經沒有的產業不沿用
export function mergeWithPrev(inds, fresh, prev, now = new Date().toISOString()) {
  const F = new Map(fresh.map(I => [I.id, I])), P = new Map((Array.isArray(prev?.industries) ? prev.industries : []).filter(okIndustry).map(I => [I.id, I])); // 壞掉的紀錄直接略過，不讓整批中止
  const T = Date.parse(now), limit = T - STALE_DAYS * 864e5, industries = [], missing = [];
  // asOf 讀不到日期、比 STALE_DAYS 舊、或比這次執行還晚（舊檔時間寫錯、時鐘偏差；容許 1 天）都不沿用
  const usable = t => Number.isFinite(t) && t >= limit && t <= T + 864e5;
  for (const { id, name } of inds) {
    if (F.has(id)) { industries.push(F.get(id)); continue; }
    const old = P.get(id), asOf = old && (old.stale ? old.asOf : prev.updated);
    if (old && usable(Date.parse(asOf))) industries.push({ ...old, name, stale: true, asOf });
    else missing.push({ id, name });
  }
  return { updated: now, source: "櫃買中心 產業價值鏈資訊平台 ic.tpex.org.tw", industries, ...(missing.length ? { missing } : {}) };
}
// 先寫同目錄的暫存檔再改名（同一個檔案系統上 rename 是原子的）；失敗時刪掉暫存檔，正式檔保持原樣
export async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  try { await writeFile(tmp, text); await rename(tmp, file); } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
}
async function readPrev(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } } // 沒有舊檔或壞掉：當成沒有
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
  const data = mergeWithPrev(inds, out, await readPrev(OUT)), st = data.industries.filter(I => I.stale);
  if (st.length) console.log(`沿用上一份的產業 ${st.length} 個：${st.map(I => `${I.name}（${String(I.asOf).slice(0, 10)}）`).join("、")}`);
  if (data.missing) console.log(`這次沒有資料的產業 ${data.missing.length} 個：${data.missing.map(I => I.name).join("、")}`);
  if (DUMP) return;
  await mkdir(fileURLToPath(new URL("../learner/data/", import.meta.url)), { recursive: true });
  await writeAtomic(OUT, JSON.stringify(data));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
