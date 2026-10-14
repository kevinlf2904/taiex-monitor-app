// 籌碼補充：借券賣出、當日沖銷、選擇權 Put/Call 比，整理成 learner/data/chipx.json，給看盤個股「籌碼」頁與「大盤」頁使用。
// 來源：證交所、櫃買中心 OpenAPI（依 swagger 名稱找「借券」「當日沖銷」資料集）、期交所 OpenAPI（Put/Call 比）。
// 個股只存最新一天；Put/Call 比累積 120 天。欄名依中文關鍵字判斷。
//   --dump  只列出找到的資料集、欄位與前兩筆，不寫檔

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../learner/data/chipx.json", import.meta.url)), DUMP = process.argv.includes("--dump");
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner; +https://github.com/kevinlf2904/taiex-monitor-app)", Accept: "application/json" };
const get = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const num = s => { const v = +String(s ?? "").replace(/[,\s%]/g, ""); return s === "" || s == null || !Number.isFinite(v) ? null : v; };
export const toIso = s => { const t = String(s ?? "").trim(); let m; if ((m = t.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`; if ((m = t.match(/^(\d{2,3})[-/]?(\d{2})[-/]?(\d{2})$/))) return `${+m[1] + 1911}-${m[2]}-${m[3]}`; return null; };
const SRC = [["上市", "https://openapi.twse.com.tw/v1", "https://openapi.twse.com.tw/v1/swagger.json"], ["上櫃", "https://www.tpex.org.tw/openapi/v1", "https://www.tpex.org.tw/openapi/swagger.json"]];
const find = (sw, re, not) => Object.entries(sw?.paths || {}).filter(([, v]) => v.get).map(([p, v]) => [p, `${v.get.summary || ""} ${v.get.description || ""}`.trim()]).filter(([, t]) => re.test(t) && !(not && not.test(t)));
const keyOf = (ks, ...re) => { for (const e of re) { const x = ks.find(k => e.test(k)); if (x) return x; } };

// 借券：當日借券賣出、借券賣出餘額（股 → 張）
export function lendRow(r) {
  const ks = Object.keys(r), kc = keyOf(ks, /代號/, /Code/i), code = String(r[kc] ?? "").trim(); if (!/^(\d{4}|00\d{2,4}[A-Z]?)$/.test(code)) return null;
  const L = ks.filter(k => /借券|SecuritiesBorrowing|SBL/i.test(k)), sell = keyOf(L, /當日賣出/, /^SecuritiesBorrowingSale$/i, /賣出/), bal = keyOf(L, /當日餘額/, /SecuritiesBorrowingBalanceOfTheMarketDay/i, /餘額/);
  const v = k => (k ? num(r[k]) : null); if (v(sell) == null && v(bal) == null) return null;
  return [code, v(sell) != null ? Math.round(v(sell) / 1000) : null, v(bal) != null ? Math.round(v(bal) / 1000) : null];
}
// 當沖：當日沖銷成交股數占成交量比例（%）
export function dtRow(r) {
  const ks = Object.keys(r), kc = keyOf(ks, /代號/, /Code/i), code = String(r[kc] ?? "").trim(); if (!/^(\d{4}|00\d{2,4}[A-Z]?)$/.test(code)) return null;
  const kr = keyOf(ks, /比率|比例|占/), ks2 = keyOf(ks, /當日沖銷.*股數|沖銷.*成交股數/), kv = keyOf(ks, /^成交股數|總成交股數/);
  let pct = kr ? num(r[kr]) : null; if (pct == null && ks2 && kv && num(r[kv])) pct = (num(r[ks2]) / num(r[kv])) * 100;
  return pct == null ? null : [code, +pct.toFixed(2)];
}

export async function main() {
  let old = {}; try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const lend = {}, dt = {}, notes = [], used = []; let date = null;
  for (const [mk, base, sw] of SRC) {
    let S = null; try { S = await get(sw); } catch (e) { notes.push(`${mk} swagger：${e.message}`); continue; }
    const sets = [["lend", find(S, /借券賣出|借券.*餘額/, /月|費率/)]];
    if (DUMP) console.log(mk, JSON.stringify(sets));
    for (const [kind, paths] of sets) for (const [p, t] of paths) {
      try { const j = await get(base + p), L = Array.isArray(j) ? j : j?.data || [];
        if (DUMP) console.log(mk, kind, p, t, "筆數", L.length, "欄位", JSON.stringify(Object.keys(L[0] || {})), "\n範例", JSON.stringify(L.slice(0, 2)));
        let n = 0; for (const r of L) { const x = kind === "lend" ? lendRow(r) : dtRow(r); if (!x) continue; n++; if (kind === "lend") lend[x[0]] = x.slice(1); else dt[x[0]] = x[1];
          if (!date) { const kd = Object.keys(r).find(k => /日期|Date/i.test(k)); date = kd ? toIso(r[kd]) : null; } }
        if (n) used.push(`${mk} ${t.slice(0, 24)}（${n}）`); }
      catch (e) { notes.push(`${mk} ${p}：${e.message}`); }
    }
  }
  // 當沖（上市）：證交所「當日沖銷交易標的及成交量值」TWTB4U（OpenAPI 沒有個股當沖成交量），比例＝當沖成交股數 ÷ 當天成交股數（STOCK_DAY_ALL）
  try {
    const all = await get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"), vol = new Map(all.map(r => [String(r.Code).trim(), num(r.TradeVolume)]));
    const d0 = toIso(all[0]?.Date) || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), j = await get(`https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date=${d0.replace(/-/g, "")}&selectType=All&response=json`);
    const T = (j.tables || []).find(t => (t.fields || []).some(f => /當日沖銷交易成交股數/.test(f))) || (j.fields ? j : null);
    if (DUMP) console.log("TWTB4U", d0, j.stat, JSON.stringify((j.tables || []).map(t => t.fields)), JSON.stringify(T?.data?.slice(0, 2)));
    if (T) { const f = T.fields, iC = f.findIndex(x => /證券代號/.test(x)), iS = f.findIndex(x => /當日沖銷交易成交股數/.test(x)); let n = 0;
      for (const r of T.data || []) { const c = String(r[iC]).trim(), sh = num(r[iS]), v = vol.get(c); if (sh != null && v) { dt[c] = +((sh / v) * 100).toFixed(2); n++; } }
      if (n) { used.push(`上市 當日沖銷（${n}）`); date ||= d0; } }
  } catch (e) { notes.push(`當沖：${e.message}`); }
  // Put/Call 比（期交所）
  let pcr = old.pcr || [];
  try { const sw = await get("https://openapi.taifex.com.tw/swagger.json"), P = find(sw, /Put\/?Call|買賣權.*比/i); if (DUMP) console.log("期交所", JSON.stringify(P));
    for (const [p] of P.slice(0, 1)) { const L = await get("https://openapi.taifex.com.tw/v1" + p); if (DUMP) console.log("PCR 欄位", JSON.stringify(Object.keys(L[0] || {})), JSON.stringify(L.slice(0, 2)));
      for (const r of L) { const ks = Object.keys(r), d = toIso(r[keyOf(ks, /Date|日期/i)]), vol = num(r[keyOf(ks, /Volume.*Ratio|成交量.*比/i)]), oi = num(r[keyOf(ks, /OI.*Ratio|OpenInterest.*Ratio|未平倉.*比/i)]);
        if (d && (vol != null || oi != null)) { const i = pcr.findIndex(x => x[0] === d); const row = [d, vol, oi]; if (i >= 0) pcr[i] = row; else pcr.push(row); } }
      used.push("期交所 Put/Call 比"); } }
  catch (e) { notes.push(`期交所：${e.message}`); }
  pcr = pcr.sort((a, b) => a[0].localeCompare(b[0])).slice(-120);
  if (DUMP) { console.log("整理：借券", Object.keys(lend).length, "當沖", Object.keys(dt).length, "PCR", pcr.slice(-3), "日期", date, notes); return; }
  if (!Object.keys(lend).length && !Object.keys(dt).length && !(old.pcr || []).length && !pcr.length) { console.log("::warning::什麼都沒讀到，保留原本的資料：" + notes.join("；")); return; }
  if (!Object.keys(lend).length && !Object.keys(dt).length && pcr.length === (old.pcr || []).length && old.date) { console.log("::warning::借券、當沖都沒讀到（可能是假日），保留原本的資料：" + notes.join("；")); return; }
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), date, sets: used, notes, lend: Object.keys(lend).length ? lend : old.lend || {}, dt: Object.keys(dt).length ? dt : old.dt || {}, pcr }));
  console.log("完成", used.join("、"), notes.join("；"));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
