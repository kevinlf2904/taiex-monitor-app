// 13F 機構持股：美國管理資產超過 1 億美元的機構每季要向 SEC 申報美股持股（Form 13F-HR，季底後 45 天內）。
// 這支程式讀幾家知名機構最近兩季的 13F，整理成 learner/data/f13.json，給 learner/watch.html「國會」分頁的「13F 機構」使用。
// GitHub Actions 每天跑一次（.github/workflows/sec13f.yml），有新申報才會變動。
// 來源（官方公開）：SEC EDGAR —— data.sec.gov 的申報清單、www.sec.gov/Archives 的資訊表（information table XML）；
//   13F 只有 CUSIP 和名稱：股票代號先用 OpenFIGI（CUSIP → 代號，免金鑰、每分鐘有次數限制）查，查過的記在 learner/data/f13-cusip.json；
//   查不到時再用 SEC 的 company_tickers.json 依公司名稱對照，都對不到就只顯示名稱。
// SEC 要求程式存取要帶「名稱＋email」格式的 User-Agent（沒有 email 會被擋 403）：預設用 repo 擁有者的 GitHub noreply 地址；
//   想換成自己的聯絡信箱，在 repo 的 Actions secrets 設 SEC_UA（例如「kline-school you@example.com」）。
// 注意：13F 只有「季底那天」的多頭持股，不含放空、現金、非美股；申報最晚在季底後 45 天，看到的是過去的部位。

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../learner/data/f13.json", import.meta.url)), CUSIP = fileURLToPath(new URL("../learner/data/f13-cusip.json", import.meta.url));
const UA = (process.env.SEC_UA || "").trim() || "kline-school-learner kevinlf2904@users.noreply.github.com";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DUMP = process.argv.includes("--dump");

// 機構（CIK）與代表人物；名稱以 SEC 申報上的為準
export const FUNDS = [
  ["0001067983", "巴菲特 Warren Buffett"], ["0001336528", "艾克曼 Bill Ackman"], ["0001536411", "德魯肯米勒 Stanley Druckenmiller"],
  ["0001656456", "泰珀 David Tepper"], ["0001061768", "克拉曼 Seth Klarman"], ["0001029160", "索羅斯基金"], ["0001350694", "達利歐 Ray Dalio"],
  ["0001697748", "伍德 Cathie Wood"], ["0001709323", "李錄 Li Lu"], ["0001040273", "勒布 Dan Loeb"], ["0001079114", "艾因霍恩 David Einhorn"],
  ["0001167483", "老虎環球 Tiger Global"], ["0001135730", "Coatue"], ["0001061165", "Lone Pine"], ["0001649339", "貝瑞 Michael Burry"],
];

async function get(url, type = "json") {
  for (let k = 0; k < 3; k++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`); if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.fatal = true; throw e; }
      return type === "json" ? await r.json() : await r.text(); }
    catch (e) { if (e.fatal || k === 2) throw e; await sleep(1500 * (k + 1)); }
  }
}

// 資訊表 XML → [{ name, cls, cusip, value, sh, type, pc }]；標籤可能帶命名空間前綴（ns1:infoTable）
export function parseInfoTable(xml) {
  const tag = (s, t) => { const m = s.match(new RegExp(`<(?:\\w+:)?${t}>([\\s\\S]*?)</(?:\\w+:)?${t}>`, "i")); return m ? m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim() : ""; };
  return [...String(xml).matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)].map(m => ({ name: tag(m[1], "nameOfIssuer"), cls: tag(m[1], "titleOfClass"), cusip: tag(m[1], "cusip").toUpperCase(), value: +tag(m[1], "value").replace(/,/g, "") || 0, sh: +tag(m[1], "sshPrnamt").replace(/,/g, "") || 0, type: tag(m[1], "sshPrnamtType"), pc: tag(m[1], "putCall") }));
}
// 同一檔（CUSIP）可能分好幾列（不同經理人、帳戶）→ 合併；選擇權（Put／Call）另外算，不混進持股
export function mergeRows(rows) {
  const m = new Map();
  for (const r of rows) { const k = r.cusip + (r.pc ? ":" + r.pc.toUpperCase() : ""); const g = m.get(k) || m.set(k, { name: r.name, cls: r.cls, cusip: r.cusip, pc: r.pc ? r.pc.toUpperCase() : "", value: 0, sh: 0 }).get(k); g.value += r.value; g.sh += r.sh; }
  return [...m.values()];
}
const normName = s => String(s || "").toUpperCase().replace(/&AMP;/g, "&").replace(/\/[A-Z]{2,3}\/?/g, " ").replace(/[.,'"()/]/g, " ").replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HLDGS?|HOLDINGS?|GROUP|N ?V|S ?A|AG|SE|LP|L ?P|THE|COM|CL ?[A-C]|NEW|DEL|ORD|SHS|ADR|SPONSORED|SPON)\b/g, " ").replace(/\s+/g, " ").trim();
export function tickerMap(ct) {
  const m = new Map(); for (const x of Object.values(ct || {})) { const k = normName(x.title); if (k && !m.has(k)) m.set(k, x.ticker); } return m;
}
// 兩季比較：新進、加碼、減碼、出清（用股數比，避免股價漲跌影響）
export function compare(cur, prev) {
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

async function filingsOf(cik) {
  const j = await get(`https://data.sec.gov/submissions/CIK${cik}.json`), R = j.filings?.recent || {};
  const L = (R.form || []).map((f, i) => ({ form: f, acc: R.accessionNumber[i], filed: R.filingDate[i], period: R.reportDate[i] })).filter(x => x.form === "13F-HR");
  return { name: j.name, L };
}
async function holdingsOf(cik, acc) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, "")}`;
  const idx = await get(`${dir}/index.json`); await sleep(150);
  const items = (idx.directory?.item || []).map(x => x.name).filter(n => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  const pick = items.find(n => /info|table|13f/i.test(n)) || items[0]; if (!pick) throw new Error("找不到資訊表");
  const xml = await get(`${dir}/${pick}`, "text"); await sleep(150);
  return parseInfoTable(xml);
}

// 除錯：同一個網址換幾種 User-Agent 試，印出狀態碼與 SEC 回的訊息開頭（分辨是 User-Agent 問題還是來源 IP 被擋）
async function probe() {
  const url = "https://data.sec.gov/submissions/CIK0001067983.json";
  for (const ua of [UA, "kline-school research admin@kline-school.vercel.app", "Mozilla/5.0 (compatible; research; kevinlf2904@users.noreply.github.com)", "Sample Company Name AdminContact@sample.com"]) {
    for (const hdr of [{}, { Accept: "application/json", "Accept-Encoding": "gzip, deflate", Host: "data.sec.gov" }]) {
      try { const r = await fetch(url, { headers: { "User-Agent": ua, ...hdr }, signal: AbortSignal.timeout(20000) }); const t = await r.text(); console.log("probe", r.status, JSON.stringify(ua), Object.keys(hdr).length ? "+headers" : "", r.status === 200 ? "" : t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300)); }
      catch (e) { console.log("probe 失敗", ua, e.message); }
      await sleep(400);
    }
  }
  try { const ip = await (await fetch("https://api.ipify.org")).text(); console.log("runner IP", ip); } catch {}
}

export async function main() {
  if (DUMP) await probe();
  let tick = new Map(); try { tick = tickerMap(await get("https://www.sec.gov/files/company_tickers.json")); } catch (e) { console.log("代號對照表失敗", e.message); }
  let cmap = {}; try { cmap = JSON.parse(await readFile(CUSIP, "utf8")); } catch {}
  const funds = [], notes = [];
  for (const [cik, who] of FUNDS) {
    try {
      const { name, L } = await filingsOf(cik); await sleep(200);
      if (!L.length) { notes.push(`${who}：沒有 13F-HR`); continue; }
      const cur = mergeRows(await holdingsOf(cik, L[0].acc)), prev = L[1] ? mergeRows(await holdingsOf(cik, L[1].acc)) : [];
      if (Date.now() - Date.parse(L[0].period) > 400 * 864e5) { notes.push(`${who}：最近一份 13F 是 ${L[0].period}，已停止申報`); continue; }
      const total = cur.filter(r => !r.pc).reduce((s, r) => s + r.value, 0), { rows, sold } = compare(cur, prev);
      const fmt = r => ({ name: r.name, cls: r.cls, cusip: r.cusip, pc: r.pc || undefined, value: r.value, sh: r.sh, psh: r.psh, pct: total ? +((r.value / total) * 100).toFixed(2) : 0, chg: r.chg });
      rows.sort((a, b) => b.value - a.value);
      // 前 60 大持股＋所有新進、加減碼（變動的才有參考價值），出清的另列
      const keep = rows.filter((r, i) => i < 60 || r.chg !== "same").slice(0, 150).map(fmt);
      funds.push({ cik, who, name, period: L[0].period, filed: L[0].filed, prevPeriod: L[1]?.period || null, total, n: rows.filter(r => !r.pc).length, rows: keep, sold: sold.sort((a, b) => b.psh - a.psh).slice(0, 40).map(fmt), doc: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F-HR` });
      console.log("ok", who, name, L[0].period, "持股", rows.length, "前 3：", keep.slice(0, 3).map(r => `${r.name} ${r.pct}% ${r.chg}`).join("、"));
      if (DUMP) console.log(JSON.stringify(keep.slice(0, 3)), "出清", sold.length);
    } catch (e) { notes.push(`${who}：${e.message}`); console.log("失敗", who, e.message); }
    await sleep(300);
  }
  if (!funds.length) throw new Error("一家機構都讀不到：" + notes.join("；"));
  // 補股票代號：OpenFIGI → 名稱對照
  const all = funds.flatMap(f => [...f.rows, ...f.sold]); await figi([...new Set(all.map(r => r.cusip))], cmap);
  for (const r of all) r.ticker = cmap[r.cusip] || tick.get(normName(r.name)) || "";
  console.log("代號對到", all.filter(r => r.ticker).length, "/", all.length, "；例：", all.slice(0, 8).map(r => `${r.name}→${r.ticker}`).join("、"));
  if (!DUMP) await writeFile(CUSIP, JSON.stringify(cmap));
  const out = { updated: new Date().toISOString(), source: "SEC EDGAR Form 13F-HR", funds, notes };
  if (!DUMP) await writeFile(OUT, JSON.stringify(out));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(o => console.log("完成", o.funds.length, "家；", o.notes.join("；"))).catch(e => { console.error(e); process.exit(1); });
