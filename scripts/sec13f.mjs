// 13F 機構持股：美國管理資產超過 1 億美元的機構每季要向 SEC 申報美股持股（Form 13F-HR，季底後 45 天內）。
// 這支程式讀幾家知名機構最近兩季的 13F，整理成 learner/data/f13.json，給 learner/watch.html「國會」分頁的「13F 機構」使用。
// GitHub Actions 每天跑一次（.github/workflows/sec13f.yml），有新申報才會變動。
// 來源（官方公開）：SEC EDGAR —— data.sec.gov 的申報清單、www.sec.gov/Archives 的資訊表（information table XML）；
//   13F 只有 CUSIP 和名稱：股票代號先用 OpenFIGI（CUSIP → 代號，免金鑰、每分鐘有次數限制）查，查過的記在 learner/data/f13-cusip.json；
//   查不到時再用 SEC 的 company_tickers.json 依公司名稱對照，都對不到就只顯示名稱。
// SEC 要求程式存取要帶「名稱＋email」格式的 User-Agent（沒有 email 會被擋 403）：預設用網站網域的地址（SEC 不接受 users.noreply.github.com）；
//   想換成自己的聯絡信箱，在 repo 的 Actions secrets 設 SEC_UA（例如「kline-school you@example.com」）。
// 注意：13F 只有「季底那天」的多頭持股，不含放空、現金、非美股；申報最晚在季底後 45 天，看到的是過去的部位。

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DATA = process.env.DATA_DIR ? process.env.DATA_DIR.replace(/\/?$/, "/") : fileURLToPath(new URL("../learner/data/", import.meta.url)); // DATA_DIR：本機模擬時改寫到別的資料夾
const OUT = DATA + "f13.json", CUSIP = DATA + "f13-cusip.json";
// SEC 規定 User-Agent 要能聯絡到人：「程式名稱/版本 (email)」。SEC_UA 可覆蓋；預設格式萬一被 403，改用之前驗證過 SEC 接受的「名稱 email」格式
const UAS = [(process.env.SEC_UA || "").trim() || "KlineSchool/1.0 (admin@kline-school.vercel.app)", "kline-school research admin@kline-school.vercel.app"];
let UA = UAS[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DUMP = process.argv.includes("--dump");

// 機構（CIK）與代表人物；名稱以 SEC 申報上的為準
export const FUNDS = [
  ["0001067983", "巴菲特 Warren Buffett"], ["0001336528", "艾克曼 Bill Ackman"], ["0001536411", "德魯肯米勒 Stanley Druckenmiller"],
  ["0001656456", "泰珀 David Tepper"], ["0001061768", "克拉曼 Seth Klarman"], ["0001029160", "索羅斯基金"], ["0001350694", "達利歐 Ray Dalio"],
  ["0001697748", "伍德 Cathie Wood"], ["0001709323", "李錄 Li Lu"], ["0001040273", "勒布 Dan Loeb"], ["0001079114", "艾因霍恩 David Einhorn"],
  ["0001167483", "老虎環球 Tiger Global"], ["0001135730", "Coatue"], ["0001061165", "Lone Pine"], ["0001649339", "貝瑞 Michael Burry"],
];

// SEC 的公平存取規則：每秒最多 10 次。所有 sec.gov 請求都經過這個節流（間隔至少 125ms，約每秒 8 次）
const SEC_GAP = 125; let secLast = 0;
async function throttle() { const w = secLast + SEC_GAP - Date.now(); if (w > 0) await sleep(w); secLast = Date.now(); }
// 讀 sec.gov：429／5xx／網路錯誤用指數退避重試（1、2、4、8 秒，有 Retry-After 就照它）；403 先換備用 User-Agent 再試一次；
// 解析前先檢查 HTTP 狀態與 Content-Type（拿到 HTML 錯誤頁就不要當 JSON 解析）
export async function get(url, type = "json", tries = 5) {
  let swapped = false;
  for (let k = 0; k < tries; k++) {
    let r;
    try { await throttle(); r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30000) }); }
    catch (e) { if (k === tries - 1) throw new Error(`連線失敗：${e.message}`); await sleep(1000 * 2 ** k); continue; }
    if (r.status === 403 && !swapped && UA !== UAS[1]) { console.log("::warning::SEC 回 403，改用備用 User-Agent"); UA = UAS[1]; swapped = true; k--; continue; }
    if (r.status === 429 || r.status >= 500) { if (k === tries - 1) throw new Error(`HTTP ${r.status}`); const ra = +r.headers.get("retry-after"); await sleep(ra > 0 ? Math.min(ra, 60) * 1000 : 1000 * 2 ** k); continue; }
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    const ct = r.headers.get("content-type") || "", body = await r.text();
    if (type === "json") { if (!/json/i.test(ct) && !/^\s*[[{]/.test(body)) throw new Error(`不是 JSON（${ct || "沒有 Content-Type"}）`); try { return JSON.parse(body); } catch { throw new Error("JSON 解析失敗"); } }
    return body;
  }
}

// 資訊表 XML → [{ name, cls, cusip, value, sh, type, pc }]；標籤可能帶命名空間前綴（ns1:infoTable）
export function parseInfoTable(xml) {
  const n = v => { const x = +String(v).replace(/[,\s]/g, ""); return Number.isFinite(x) ? x : 0; };
  const tag = (s, t) => { const m = s.match(new RegExp(`<(?:\\w+:)?${t}>([\\s\\S]*?)</(?:\\w+:)?${t}>`, "i")); return m ? m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim() : ""; };
  return [...String(xml).matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)].map(m => ({ name: tag(m[1], "nameOfIssuer"), cls: tag(m[1], "titleOfClass"), cusip: tag(m[1], "cusip").toUpperCase(), value: n(tag(m[1], "value")), sh: n(tag(m[1], "sshPrnamt")), type: tag(m[1], "sshPrnamtType"), pc: tag(m[1], "putCall") }));
}
// 同一檔（CUSIP）可能分好幾列（不同經理人、帳戶）→ 合併；選擇權（Put／Call）另外算，不混進持股
// 債券（sshPrnamtType＝PRN，面額不是股數）不算；部分機構的 value 仍用「千美元」申報 → 用每股隱含價格判斷（中位數低於 1 美元就是千元單位）
// 缺欄位的列：沒有 CUSIP 或股數不是正數就略過；type 缺的當成股票（SH）
export function mergeRows(rows) {
  const m = new Map(), st = (Array.isArray(rows) ? rows : []).filter(r => r && r.cusip && !/PRN/i.test(r.type || "") && r.sh > 0 && Number.isFinite(r.value));
  const px = st.filter(r => !r.pc).map(r => r.value / r.sh).sort((a, b) => a - b), unit = px.length && px[px.length >> 1] < 1 ? 1000 : 1;
  for (const r0 of st) { const r = { ...r0, value: r0.value * unit }; const k = r.cusip + (r.pc ? ":" + r.pc.toUpperCase() : ""); const g = m.get(k) || m.set(k, { name: r.name, cls: r.cls, cusip: r.cusip, pc: r.pc ? r.pc.toUpperCase() : "", value: 0, sh: 0 }).get(k); g.value += r.value; g.sh += r.sh; }
  return [...m.values()];
}
const normName = s => String(s || "").toUpperCase().replace(/&AMP;/g, "&").replace(/\/[A-Z]{2,3}\/?/g, " ").replace(/[.,'"()/]/g, " ").replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HLDGS?|HOLDINGS?|GROUP|N ?V|S ?A|AG|SE|LP|L ?P|THE|COM|CL ?[A-C]|NEW|DEL|ORD|SHS|ADR|SPONSORED|SPON)\b/g, " ").replace(/\s+/g, " ").trim();
export function tickerMap(ct) {
  const m = new Map(); for (const x of Object.values(ct || {})) { const k = normName(x.title); if (k && !m.has(k)) m.set(k, x.ticker); } return m;
}
// 兩季比較：新進、加碼、減碼、出清（用股數比，避免股價漲跌影響）
export function compare(cur = [], prev = []) {
  const P = new Map(prev.map(r => [r.cusip + r.pc, r])), C = new Set(cur.map(r => r.cusip + r.pc));
  const rows = cur.map(r => { const p = P.get(r.cusip + r.pc); const chg = !p ? "new" : r.sh > p.sh * 1.02 ? "add" : r.sh < p.sh * 0.98 ? "cut" : "same"; return { ...r, psh: p?.sh ?? 0, chg }; });
  const sold = prev.filter(r => !C.has(r.cusip + r.pc)).map(r => ({ ...r, psh: r.sh, sh: 0, value: 0, chg: "sold" }));
  return { rows, sold };
}

// OpenFIGI：一次最多 10 個 CUSIP、沒金鑰每分鐘 25 次；找美國交易所的普通股代號
async function figi(cusips, map) {
  const todo = cusips.filter(c => !(c in map));
  for (let i = 0; i < todo.length; i += 10) {
    const part = todo.slice(i, i + 10);
    try { const r = await fetch("https://api.openfigi.com/v3/mapping", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify(part.map(c => ({ idType: "ID_CUSIP", idValue: c, exchCode: "US" }))), signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await sleep(30000); i -= 10; continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`);
      (await r.json()).forEach((x, k) => { const d = x.data || []; map[part[k]] = (d.find(y => y.marketSector === "Equity" && /Common|ETP|REIT|ADR|Depositary/i.test(y.securityType2 || y.securityType || "")) || d[0])?.ticker || ""; }); }
    catch (e) { console.log("OpenFIGI 失敗", e.message); return; }
    await sleep(2600);
  }
}

// 申報清單 → 每一季一份：優先用原始 13F-HR；那一季只有修訂版（13F-HR/A）時改用最新的修訂版。欄位缺漏的略過
export function pickFilings(R = {}) {
  const at = (k, i) => (Array.isArray(R[k]) ? R[k][i] : undefined), by = new Map();
  (Array.isArray(R.form) ? R.form : []).forEach((f, i) => { if (f !== "13F-HR" && f !== "13F-HR/A") return; const acc = at("accessionNumber", i), filed = at("filingDate", i) || "", period = at("reportDate", i) || filed;
    if (!acc || !period) return; const cur = by.get(period); if (!cur || (cur.form !== "13F-HR" && (f === "13F-HR" || filed > cur.filed))) by.set(period, { form: f, acc, filed, period }); });
  return [...by.values()].sort((a, b) => b.period.localeCompare(a.period));
}
async function filingsOf(cik) {
  const j = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  return { name: j?.name || "", L: pickFilings(j?.filings?.recent) };
}
async function holdingsOf(cik, acc) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, "")}`;
  const idx = await get(`${dir}/index.json`);
  const items = (idx.directory?.item || []).map(x => x.name).filter(n => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  const pick = items.find(n => /info|table|13f/i.test(n)) || items[0]; if (!pick) throw new Error("找不到資訊表");
  const xml = await get(`${dir}/${pick}`, "text");
  return parseInfoTable(xml);
}

export async function main() {
  let tick = new Map(); try { tick = tickerMap(await get("https://www.sec.gov/files/company_tickers.json")); } catch (e) { console.log("代號對照表失敗", e.message); }
  let cmap = {}; try { cmap = JSON.parse(await readFile(CUSIP, "utf8")); } catch {}
  let old = null; try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const funds = [], notes = [], oldOf = cik => (old?.funds || []).find(f => f.cik === cik);
  for (const [cik, who] of FUNDS) {
    try {
      const { name, L } = await filingsOf(cik);
      if (!L.length) { notes.push(`${who}：沒有 13F-HR`); continue; }
      const cur = mergeRows(await holdingsOf(cik, L[0].acc)), prev = L[1] ? mergeRows(await holdingsOf(cik, L[1].acc)) : [];
      const age = Date.now() - Date.parse(L[0].period); if (!Number.isFinite(age) || age > 230 * 864e5) { notes.push(`${who}：最近一份 13F 是 ${L[0].period}，已停止申報`); continue; }
      // 占比用全部申報市值（含選擇權的標的市值）當分母，只申報選擇權的機構才不會超過 100%
      const total = cur.reduce((s, r) => s + r.value, 0), { rows, sold } = compare(cur, prev);
      const fmt = r => ({ name: r.name, cls: r.cls, cusip: r.cusip, pc: r.pc || undefined, value: r.value, sh: r.sh, psh: r.psh, pct: total ? +((r.value / total) * 100).toFixed(2) : 0, chg: r.chg });
      rows.sort((a, b) => b.value - a.value);
      // 前 60 大持股＋所有新進、加減碼（變動的才有參考價值），出清的另列
      const keep = rows.filter((r, i) => i < 60 || r.chg !== "same").slice(0, 150).map(fmt);
      funds.push({ cik, who, name, period: L[0].period, filed: L[0].filed, form: L[0].form, prevPeriod: L[1]?.period || null, total, n: rows.filter(r => !r.pc).length, rows: keep, sold: sold.sort((a, b) => b.psh - a.psh).slice(0, 40).map(fmt), doc: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F-HR` });
      console.log("ok", who, name, L[0].period, "持股", rows.length, "前 3：", keep.slice(0, 3).map(r => `${r.name} ${r.pct}% ${r.chg}`).join("、"));
      if (DUMP) console.log(JSON.stringify(keep.slice(0, 3)), "出清", sold.length);
    } catch (e) { // 這家讀不到：沿用上次的資料（標 stale），不讓單一機構的錯誤清掉它
      const o = oldOf(cik); if (o) { funds.push({ ...o, stale: true }); notes.push(`${who}：這次讀取失敗（${e.message}），沿用上次 ${o.period} 的資料`); } else notes.push(`${who}：${e.message}`);
      console.log("::warning::失敗", who, e.message); }
  }
  if (!funds.some(f => !f.stale)) { console.log("::warning::一家機構都讀不到，保留原本的資料檔不覆蓋：" + notes.join("；")); return old || { funds: [], notes }; }
  // 補股票代號：OpenFIGI → 名稱對照
  const all = funds.flatMap(f => [...(f.rows || []), ...(f.sold || [])]); await figi([...new Set(all.map(r => r.cusip))], cmap);
  for (const r of all) r.ticker = cmap[r.cusip] || tick.get(normName(r.name)) || "";
  console.log("代號對到", all.filter(r => r.ticker).length, "/", all.length, "；例：", all.slice(0, 8).map(r => `${r.name}→${r.ticker}`).join("、"));
  if (!DUMP) await writeFile(CUSIP, JSON.stringify(cmap));
  const out = { updated: new Date().toISOString(), source: "SEC EDGAR Form 13F-HR", funds, notes };
  if (!DUMP) await writeFile(OUT, JSON.stringify(out));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("完成", o?.funds?.length ?? 0, "家；", (o?.notes || []).join("；"))).catch(e => { console.error(e); process.exit(1); });
